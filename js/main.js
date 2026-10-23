'use strict';

/* ---------------- Jogo Principal ---------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });

const DESIGN_W = 1280;
const DESIGN_H = 720;

let totalLaps = 5;
let track = null;
let karts = [];
let audio = null;
let game = {
  state: 'menu',
  phase: 0,
  phaseTimer: 0,
  winner: null,
  camera: { x: 0, y: 0, zoom: 1, targetZoom: 1 },
  shake: { x: 0, y: 0, time: 0 },
  keys: {},
  lastTime: 0
};

const COUNTDOWN = ['3', '2', '1', 'VÁ!'];

const KEYS = {
  P1: { accel: 'KeyW', brake: 'KeyS', left: 'KeyA', right: 'KeyD' },
  P2: { accel: 'ArrowUp', brake: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }
};

function init() {
  track = new Track();
  karts = [
    new Kart(0, '#ff4757', '#8f1e30', -30),
    new Kart(1, '#4d8dff', '#1d419c', 30)
  ];
  audio = new AudioSys();
  audio.ensure();
  game.state = 'menu';
  updateLapUI();
  resize();
  requestAnimationFrame(loop);
}

function resize() {
  const stage = document.getElementById('stage');
  const rect = stage.getBoundingClientRect();
  const scale = Math.min(rect.width / DESIGN_W, rect.height / DESIGN_H);
  canvas.style.transform = `scale(${scale})`;
}

function updateLapUI() {
  document.getElementById('lapsValue').textContent = totalLaps;
  document.getElementById('total1').textContent = totalLaps;
  document.getElementById('total2').textContent = totalLaps;
  document.getElementById('lap1').textContent = '0';
  document.getElementById('lap2').textContent = '0';
}

function startRace() {
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  game.state = 'countdown';
  game.phase = 3;
  game.phaseTimer = 0;
  game.shake.time = 0;
  for (const k of karts) k.reset();
  audio.startEngines();
}

function restartRace() {
  document.getElementById('result').classList.add('hidden');
  startRace();
}

function showMenu() {
  document.getElementById('result').classList.add('hidden');
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('menu').classList.remove('hidden');
  game.state = 'menu';
}

function loop(ts) {
  const dt = Math.min(1/30, (ts - game.lastTime) / 1000);
  game.lastTime = ts;

  if (game.shake.time > 0) {
    game.shake.time -= dt;
    game.shake.x = (Math.random() - 0.5) * 8 * (game.shake.time / 0.5);
    game.shake.y = (Math.random() - 0.5) * 8 * (game.shake.time / 0.5);
  } else {
    game.shake.x = game.shake.y = 0;
  }

  handleInput();

  if (game.state === 'countdown') {
    game.phaseTimer += dt;
    if (game.phaseTimer >= 1) {
      game.phaseTimer = 0;
      game.phase--;
      if (game.phase >= 0) audio.countdown(game.phase);
    }
    if (game.phase < 0) {
      game.state = 'racing';
    }
  } else if (game.state === 'racing') {
    updateRace(dt);
  } else if (game.state === 'finished') {
    game.phaseTimer += dt;
  }

  render();
  requestAnimationFrame(loop);
}

function handleInput() {
  const k1 = game.keys;
  karts[0].input.accel = !!k1[KEYS.P1.accel];
  karts[0].input.brake = !!k1[KEYS.P1.brake];
  karts[0].input.left = !!k1[KEYS.P1.left];
  karts[0].input.right = !!k1[KEYS.P1.right];

  karts[1].input.accel = !!k1[KEYS.P2.accel];
  karts[1].input.brake = !!k1[KEYS.P2.brake];
  karts[1].input.left = !!k1[KEYS.P2.left];
  karts[1].input.right = !!k1[KEYS.P2.right];
}

function updateRace(dt) {
  const active = game.state === 'racing';
  for (const k of karts) k.update(dt, active);

  checkCollisions();

  audio.updateEngines(karts, active);
  updateCamera(dt);
  updateHUD();
}

function checkCollisions() {
  const k1 = karts[0];
  const k2 = karts[1];
  if (k1.state === 'spinning' || k2.state === 'spinning') return;

  const dx = k2.x - k1.x;
  const dy = k2.y - k1.y;
  const dist = Math.hypot(dx, dy);
  const minDist = KART_W * 0.7;

  if (dist < minDist && dist > 0.1) {
    const nx = dx / dist;
    const ny = dy / dist;

    const a1 = k1.angle;
    const a2 = k2.angle;
    const back1 = Math.cos(a1) * nx + Math.sin(a1) * ny;
    const front2 = -(Math.cos(a2) * nx + Math.sin(a2) * ny);

    const vRel = (k2.vx - k1.vx) * nx + (k2.vy - k1.vy) * ny;

    // k2 bate na traseira do k1
    if (vRel > 30 && back1 > 0.55 && front2 > 0.55) {
      k2.triggerSpin();
      game.shake.time = 0.35;
      audio.hit(1.4);
      return;
    }
    // k1 bate na traseira do k2
    const front1 = Math.cos(a1) * nx + Math.sin(a1) * ny;
    const back2 = -(Math.cos(a2) * nx + Math.sin(a2) * ny);
    if (-vRel > 30 && front1 > 0.55 && back2 > 0.55) {
      k1.triggerSpin();
      game.shake.time = 0.35;
      audio.hit(1.4);
      return;
    }

    // empurrão lateral/frontal suave
    const push = (minDist - dist) * 0.5;
    k1.x -= nx * push * 0.5;
    k1.y -= ny * push * 0.5;
    k2.x += nx * push * 0.5;
    k2.y += ny * push * 0.5;

    const perpX = -ny;
    const perpY = nx;
    const lat1 = (k1.vx * perpX + k1.vy * perpY) * 0.3;
    const lat2 = (k2.vx * perpX + k2.vy * perpY) * 0.3;
    k1.vx += perpX * lat1;
    k1.vy += perpY * lat1;
    k2.vx -= perpX * lat2;
    k2.vy -= perpY * lat2;

    audio.hit(0.7);
  }
}

function updateCamera(dt) {
  const k1 = karts[0];
  const k2 = karts[1];
  const cx = (k1.x + k2.x) * 0.5;
  const cy = (k1.y + k2.y) * 0.5;
  const dist = Math.hypot(k2.x - k1.x, k2.y - k1.y);

  const targetX = cx;
  const targetY = cy;
  const minZoom = 0.55;
  const maxZoom = 1.0;
  const idealZoom = clamp(1.0 - dist * 0.0006, minZoom, maxZoom);

  game.camera.x = lerp(game.camera.x, targetX, 1 - Math.pow(0.001, dt));
  game.camera.y = lerp(game.camera.y, targetY, 1 - Math.pow(0.001, dt));
  game.camera.zoom = lerp(game.camera.zoom, idealZoom, 1 - Math.pow(0.02, dt));
}

function updateHUD() {
  for (let i = 0; i < 2; i++) {
    const k = karts[i];
    document.getElementById(`lap${i+1}`).textContent = Math.min(k.lap, totalLaps);
    document.getElementById(`spd${i+1}`).style.width = `${Math.min(100, Math.abs(k.speed) / 380 * 100)}%`;

    const panel = document.getElementById(`panel${i+1}`);
    if (k.state === 'spinning') panel.classList.add('spinning');
    else panel.classList.remove('spinning');

    // posição
    const posText = k.lap >= totalLaps ? '🏁' : `${k.lap}/${totalLaps}`;
    document.getElementById(`pos${i+1}`).textContent = posText;
  }
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, DESIGN_W, DESIGN_H);

  const cam = game.camera;
  const z = cam.zoom;
  const tx = DESIGN_W/2 - cam.x * z + game.shake.x * z;
  const ty = DESIGN_H/2 - cam.y * z + game.shake.y * z;
  ctx.setTransform(z, 0, 0, z, tx, ty);

  track.render();

  // poeira dos karts (desenhada antes dos karts)
  for (const k of karts) {
    if (k.state !== 'spinning') k.addDust();
  }

  // ordem: o que está atrás desenha primeiro
  const order = karts[0].lap > karts[1].lap ? [1, 0] :
                karts[1].lap > karts[0].lap ? [0, 1] :
                karts[0].lastS > karts[1].lastS ? [1, 0] : [0, 1];
  for (const idx of order) karts[idx].render();

  drawCenterMsg();
}

function drawCenterMsg() {
  const el = document.getElementById('center-msg');
  if (game.state === 'countdown') {
    const txt = COUNTDOWN[game.phase];
    if (txt) {
      el.textContent = txt;
      el.className = txt === 'VÁ!' ? 'show go' : 'show';
    } else el.className = '';
  } else {
    el.className = '';
  }
}

game.onFinish = function(winnerId) {
  game.state = 'finished';
  game.winner = winnerId;
  game.phaseTimer = 0;

  const winnerKart = karts[winnerId];
  document.getElementById('winner').textContent = `JOGADOR\n${winnerId === 0 ? 'VERMELHO' : 'AZUL'}\nVENCEU!`;
  document.getElementById('winner').className = winnerId === 0 ? 'red' : 'blue';
  document.getElementById('resultSub').textContent = `${totalLaps} voltas completadas`;

  audio.finish();

  setTimeout(() => {
    document.getElementById('result').classList.remove('hidden');
  }, 600);
};

/* ---------------- Eventos ---------------- */
window.addEventListener('keydown', (e) => {
  game.keys[e.code] = true;

  if (game.state === 'menu') {
    if (e.code === 'Enter' || e.code === 'Space') startRace();
  } else if (game.state === 'finished') {
    if (e.code === 'Space') restartRace();
    else if (e.code === 'Escape') showMenu();
  } else if (game.state === 'racing' || game.state === 'countdown') {
    if (e.code === 'Escape') showMenu();
    if (e.code === 'KeyR') restartRace();
    if (e.code === 'KeyM') audio.setMuted(!audio.muted);
    if (e.code === 'KeyF') {
      const el = document.documentElement;
      if (!document.fullscreenElement) el.requestFullscreen();
      else document.exitFullscreen();
    }
  }
});

window.addEventListener('keyup', (e) => {
  game.keys[e.code] = false;
});

document.getElementById('minus').addEventListener('click', () => {
  totalLaps = Math.max(3, totalLaps - 1);
  updateLapUI();
});
document.getElementById('plus').addEventListener('click', () => {
  totalLaps = Math.min(7, totalLaps + 1);
  updateLapUI();
});
document.getElementById('startBtn').addEventListener('click', startRace);
document.getElementById('againBtn').addEventListener('click', restartRace);
document.getElementById('menuBtn').addEventListener('click', showMenu);

window.addEventListener('resize', resize);

/* ---------------- Inicialização ---------------- */
init();