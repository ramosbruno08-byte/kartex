'use strict';

/* ---------------- utilidades globais ---------------- */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resampleClosed(raw, N) {
  const n = raw.length;
  const cum = [0];
  for (let i = 0; i < n; i++) {
    const a = raw[i];
    const b = raw[(i + 1) % n];
    cum.push(cum[i] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cum[n];
  const out = [];
  let j = 0;
  for (let k = 0; k < N; k++) {
    const target = (total * k) / N;
    while (j < n - 1 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = (target - cum[j]) / seg;
    const a = raw[j];
    const b = raw[(j + 1) % n];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

function makeClosedPath(points) {
  const path = new Path2D();
  if (!points.length) return path;
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y);
  path.closePath();
  return path;
}

/* ---------------- pista ---------------- */
class Track {
  constructor() {
    this.halfWidth = 112;
    this.rng = mulberry32(0x4b415254);

    const CX = 1300, CY = 780, RX = 950, RY = 540;
    const POW = 2 / 2.8;
    const STEPS = 2400;
    const raw = [];
    for (let i = 0; i < STEPS; i++) {
      const th = Math.PI / 2 + (i / STEPS) * TAU;
      const c = Math.cos(th);
      const s = Math.sin(th);
      let m = 1 + 0.03 * Math.sin(4 * th + 0.7);
      const d = wrapAngle(th - (3 * Math.PI) / 2);
      m -= 0.13 * Math.exp(-Math.pow(d / 0.42, 2));
      raw.push({
        x: CX + RX * Math.sign(c) * Math.pow(Math.abs(c), POW) * m,
        y: CY + RY * Math.sign(s) * Math.pow(Math.abs(s), POW) * m
      });
    }

    this.samples = resampleClosed(raw, 1400);
    const N = this.samples.length;
    this.N = N;

    this.tangents = [];
    this.normals = [];
    for (let i = 0; i < N; i++) {
      const a = this.samples[(i - 1 + N) % N];
      const b = this.samples[(i + 1) % N];
      let dx = b.x - a.x, dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      this.tangents.push({ x: dx, y: dy });
      this.normals.push({ x: -dy, y: dx });
    }

    this.totalLength = 0;
    for (let i = 0; i < N; i++) {
      const a = this.samples[i];
      const b = this.samples[(i + 1) % N];
      this.totalLength += Math.hypot(b.x - a.x, b.y - a.y);
    }

    // curvatura (variação de tangente numa janela)
    this.turn = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      const a = this.tangents[(i - 3 + N) % N];
      const b = this.tangents[(i + 3) % N];
      const cross = a.x * b.y - a.y * b.x;
      const dot = a.x * b.x + a.y * b.y;
      this.turn[i] = Math.atan2(cross, dot);
    }

    const mask = new Array(N).fill(false);
    for (let i = 0; i < N; i++) {
      if (Math.abs(this.turn[i]) > 0.045) {
        for (let d = -14; d <= 14; d++) mask[(i + d + N) % N] = true;
      }
    }
    const ranges = [];
    let start = -1;
    for (let i = 0; i < N; i++) {
      if (mask[i] && start < 0) start = i;
      if (!mask[i] && start >= 0) { ranges.push([start, i]); start = -1; }
    }
    if (start >= 0) ranges.push([start, N]);
    if (ranges.length > 1 && mask[0] && mask[N - 1]) {
      const last = ranges.pop();
      const first = ranges.shift();
      ranges.push([last[0], first[1] + N]);
    }
    this.cornerRanges = ranges;
    this.cornerMask = mask;

    // limites
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const p of this.samples) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    this.bounds = { minX, minY, maxX, maxY };
    this.center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };

    this.buildPaths();
    this.buildDecor();
  }

  buildPaths() {
    const N = this.N;
    const hw = this.halfWidth;
    const off = (i, side, dist) => ({
      x: this.samples[i].x + this.normals[i].x * side * dist,
      y: this.samples[i].y + this.normals[i].y * side * dist
    });

    this.edgeA = [];
    this.edgeB = [];
    this.innerA = [];
    this.innerB = [];
    this.barrierA = [];
    this.barrierB = [];
    for (let i = 0; i < N; i++) {
      this.edgeA.push(off(i, 1, hw));
      this.edgeB.push(off(i, -1, hw));
      this.innerA.push(off(i, 1, hw - 7));
      this.innerB.push(off(i, -1, hw - 7));
      this.barrierA.push(off(i, 1, hw + 19));
      this.barrierB.push(off(i, -1, hw + 19));
    }

    const surface = new Path2D();
    surface.moveTo(this.edgeA[0].x, this.edgeA[0].y);
    for (let i = 1; i < N; i++) surface.lineTo(this.edgeA[i].x, this.edgeA[i].y);
    for (let i = N - 1; i >= 0; i--) surface.lineTo(this.edgeB[i].x, this.edgeB[i].y);
    surface.closePath();
    this.surfacePath = surface;

    this.innerPathA = makeClosedPath(this.innerA);
    this.innerPathB = makeClosedPath(this.innerB);
    this.barrierPathA = makeClosedPath(this.barrierA);
    this.barrierPathB = makeClosedPath(this.barrierB);
    this.centerPath = makeClosedPath(this.samples);

    // posições de setas de direção
    this.arrows = [];
    for (let i = 30; i < N; i += 135) {
      if (this.cornerMask[i]) continue;
      this.arrows.push(i);
    }

    // pilhas de pneus nas curvas
    this.tires = [];
    for (const r of this.cornerRanges) {
      const len = r[1] - r[0];
      const step = Math.max(34, Math.floor(len / 4));
      for (let i = r[0] + 16; i < r[1] - 8; i += step) {
        const idx = ((i % N) + N) % N;
        const side = this.turn[idx] > 0 ? -1 : 1;
        const p = off(idx, side, hw + 33);
        this.tires.push({ x: p.x, y: p.y, s: 0.8 + this.rng() * 0.5 });
      }
    }
  }

  buildDecor() {
    const rng = this.rng;
    const hw = this.halfWidth;
    this.trees = [];
    this.tufts = [];
    this.blotches = [];

    let guard = 0;
    while (this.trees.length < 52 && guard++ < 900) {
      const x = -220 + rng() * 3000;
      const y = -220 + rng() * 1900;
      const n = this.nearest(x, y);
      if (n.dist > hw + 150) {
        this.trees.push({
          x, y,
          r: 22 + rng() * 26,
          tone: rng(),
          kind: rng() > 0.72 ? 'bush' : 'tree'
        });
      }
    }

    guard = 0;
    while (this.tufts.length < 280 && guard++ < 1400) {
      const x = -120 + rng() * 2800;
      const y = -120 + rng() * 1700;
      const n = this.nearest(x, y);
      if (n.dist > hw + 30) {
        this.tufts.push({ x, y, a: rng() * TAU, s: 0.6 + rng() * 0.8 });
      }
    }

    guard = 0;
    while (this.blotches.length < 150 && guard++ < 1200) {
      const i = Math.floor(rng() * this.N);
      const lane = (rng() * 2 - 1) * (hw - 18);
      const p = this.samples[i];
      const normal = this.normals[i];
      this.blotches.push({
        x: p.x + normal.x * lane,
        y: p.y + normal.y * lane,
        rx: 5 + rng() * 22,
        ry: 3 + rng() * 9,
        rot: rng() * TAU,
        a: 0.025 + rng() * 0.05
      });
    }
  }

  nearest(x, y) {
    const pts = this.samples;
    const N = this.N;
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < N; i += 2) {
      const dx = pts[i].x - x;
      const dy = pts[i].y - y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; bi = i; }
    }
    const j = (bi + 1) % N;
    const dx2 = pts[j].x - x, dy2 = pts[j].y - y;
    if (dx2 * dx2 + dy2 * dy2 < bd) { bd = dx2 * dx2 + dy2 * dy2; bi = j; }

    let best = null;
    for (let k = -2; k <= 2; k++) {
      const i = ((bi + k) % N + N) % N;
      const a = pts[i];
      const b = pts[(i + 1) % N];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const L2 = ex * ex + ey * ey || 1;
      let t = ((x - a.x) * ex + (y - a.y) * ey) / L2;
      t = clamp(t, 0, 1);
      const px = a.x + ex * t;
      const py = a.y + ey * t;
      const d = Math.hypot(x - px, y - py);
      if (!best || d < best.dist) {
        const len = Math.sqrt(L2);
        best = {
          dist: d,
          px, py,
          index: i,
          s: (i + t) / N,
          tx: ex / len,
          ty: ey / len,
          nx: -ey / len,
          ny: ex / len
        };
      }
    }
    return best;
  }

  poseAt(s, lane) {
    const N = this.N;
    let f = s * N;
    f = ((f % N) + N) % N;
    const i = Math.floor(f);
    const t = f - i;
    const a = this.samples[i];
    const b = this.samples[(i + 1) % N];
    const ta = this.tangents[i];
    const tb = this.tangents[(i + 1) % N];
    let tx = ta.x + (tb.x - ta.x) * t;
    let ty = ta.y + (tb.y - ta.y) * t;
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    return {
      x: a.x + (b.x - a.x) * t - ty * (lane || 0),
      y: a.y + (b.y - a.y) * t + tx * (lane || 0),
      angle: Math.atan2(ty, tx),
      tx, ty
    };
  }

  /* -------- render -------- */
  render() {
    const hw = this.halfWidth;

    if (!this.grassGrad) {
      this.grassGrad = ctx.createLinearGradient(0, 0, 0, 1500);
      this.grassGrad.addColorStop(0, '#1b4b2c');
      this.grassGrad.addColorStop(0.55, '#164226');
      this.grassGrad.addColorStop(1, '#113a20');
      this.asphaltGrad = ctx.createLinearGradient(0, 0, 0, 1500);
      this.asphaltGrad.addColorStop(0, '#484d5b');
      this.asphaltGrad.addColorStop(0.5, '#3d424f');
      this.asphaltGrad.addColorStop(1, '#343945');
    }

    // grama
    ctx.fillStyle = this.grassGrad;
    ctx.fillRect(-2600, -2200, 7400, 6200);

    ctx.fillStyle = 'rgba(255,255,255,.018)';
    for (let x = -2600; x < 4800; x += 320) {
      ctx.fillRect(x, -2200, 160, 6200);
    }

    // tufos de grama
    ctx.strokeStyle = 'rgba(150,220,140,.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < this.tufts.length; i++) {
      const t = this.tufts[i];
      const dx = Math.cos(t.a) * 4 * t.s;
      const dy = Math.sin(t.a) * 4 * t.s;
      ctx.moveTo(t.x - dx, t.y - dy);
      ctx.lineTo(t.x + dx, t.y + dy);
    }
    ctx.stroke();

    // árvores
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.beginPath();
      ctx.ellipse(t.x + 8, t.y + 10, t.r * 1.04, t.r * 0.78, 0, 0, TAU);
      ctx.fill();
      const dark = t.tone > 0.5 ? '#0e3520' : '#103a22';
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(60,130,70,.55)';
      ctx.beginPath();
      ctx.arc(t.x - t.r * 0.24, t.y - t.r * 0.28, t.r * 0.62, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(130,200,110,.18)';
      ctx.beginPath();
      ctx.arc(t.x - t.r * 0.34, t.y - t.r * 0.4, t.r * 0.28, 0, TAU);
      ctx.fill();
    }

    // sombra da pista
    ctx.save();
    ctx.translate(13, 17);
    ctx.fillStyle = 'rgba(0,0,0,.24)';
    ctx.fill(this.surfacePath);
    ctx.restore();

    // asfalto
    ctx.fillStyle = this.asphaltGrad;
    ctx.fill(this.surfacePath);

    // textura
    ctx.save();
    ctx.clip(this.surfacePath);
    for (let i = 0; i < this.blotches.length; i++) {
      const b = this.blotches[i];
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.fillStyle = 'rgba(12,14,20,' + b.a + ')';
      ctx.beginPath();
      ctx.ellipse(0, 0, b.rx, b.ry, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // linha central tracejada
    ctx.save();
    ctx.strokeStyle = 'rgba(255,226,130,.22)';
    ctx.lineWidth = 4;
    ctx.setLineDash([20, 26]);
    ctx.stroke(this.centerPath);
    ctx.restore();

    // zebras / bordas
    this.drawKerbs();

    ctx.strokeStyle = 'rgba(233,238,247,.86)';
    ctx.lineWidth = 5;
    ctx.stroke(this.innerPathA);
    ctx.stroke(this.innerPathB);

    ctx.strokeStyle = 'rgba(20,24,32,.55)';
    ctx.lineWidth = 2;
    ctx.stroke(this.surfacePath);

    // barreiras
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#e9edf5';
    ctx.lineWidth = 10;
    ctx.stroke(this.barrierPathA);
    ctx.stroke(this.barrierPathB);
    ctx.save();
    ctx.strokeStyle = '#d8394a';
    ctx.lineWidth = 10;
    ctx.setLineDash([30, 30]);
    ctx.stroke(this.barrierPathA);
    ctx.setLineDash([30, 30]);
    ctx.lineDashOffset = 30;
    ctx.stroke(this.barrierPathB);
    ctx.restore();
    ctx.lineCap = 'round';

    // setas de sentido
    for (let i = 0; i < this.arrows.length; i++) {
      const idx = this.arrows[i];
      const p = this.samples[idx];
      const n = this.normals[idx];
      const t = this.tangents[idx];
      ctx.save();
      ctx.translate(p.x + n.x * 52, p.y + n.y * 52);
      ctx.rotate(Math.atan2(t.y, t.x));
      ctx.fillStyle = 'rgba(255,255,255,.15)';
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-7, -13);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-7, 13);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // pilhas de pneus
    for (let i = 0; i < this.tires.length; i++) {
      const t = this.tires[i];
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath();
      ctx.ellipse(t.x + 4, t.y + 5, 13 * t.s, 8 * t.s, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#17191f';
      ctx.beginPath();
      ctx.arc(t.x, t.y, 11 * t.s, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#30343e';
      ctx.beginPath();
      ctx.arc(t.x, t.y, 6.5 * t.s, 0, TAU);
      ctx.fill();
    }

    this.drawStartLine();
  }

  drawKerbs() {
    const N = this.N;
    const hw = this.halfWidth;
    for (const r of this.cornerRanges) {
      for (let i = r[0]; i < r[1] - 4; i += 6) {
        const i0 = ((i % N) + N) % N;
        const i1 = ((i + 6) % N + N) % N;
        const col = (Math.floor(i / 8) % 2 === 0) ? '#e8454f' : '#f0f3f8';
        for (const side of [1, -1]) {
          const a = this.samples[i0];
          const b = this.samples[i1];
          const na = this.normals[i0];
          const nb = this.normals[i1];
          const ax = a.x + na.x * side * (hw - 1);
          const ay = a.y + na.y * side * (hw - 1);
          const bx = b.x + nb.x * side * (hw - 1);
          const by = b.y + nb.y * side * (hw - 1);
          const cx = b.x + nb.x * side * (hw + 16);
          const cy = b.y + nb.y * side * (hw + 16);
          const dx = a.x + na.x * side * (hw + 16);
          const dy = a.y + na.y * side * (hw + 16);
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.lineTo(cx, cy);
          ctx.lineTo(dx, dy);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
  }

  drawStartLine() {
    const p = this.samples[0];
    const t = this.tangents[0];
    const ang = Math.atan2(t.y, t.x);
    const hw = this.halfWidth;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ang);
    const depth = 38;
    const rows = 3;
    const cols = 14;
    const cw = depth / rows;
    const ch = (hw * 2) / cols;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#f4f6fa' : '#171a21';
        ctx.fillRect(-depth / 2 + r * cw, -hw + c * ch, cw + 0.4, ch + 0.4);
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillRect(-depth / 2 - 6, -hw, 3, hw * 2);
    ctx.fillStyle = '#1a1e27';
    for (const side of [1, -1]) {
      ctx.beginPath();
      ctx.arc(0, side * (hw + 28), 9, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#ffd84d';
      ctx.beginPath();
      ctx.arc(0, side * (hw + 28), 4, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#1a1e27';
    }
    ctx.restore();
  }
}
