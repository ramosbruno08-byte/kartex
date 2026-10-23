'use strict';

/* ---------------- Kart ---------------- */
const KART_W = 36;
const KART_H = 52;

class Kart {
  constructor(id, color, colorDark, startLane) {
    this.id = id;
    this.color = color;
    this.colorDark = colorDark;
    this.lane = startLane;
    this.reset();
  }

  reset() {
    const pose = track.poseAt(0.001, this.lane);
    this.x = pose.x;
    this.y = pose.y;
    this.angle = pose.angle;
    this.vx = 0;
    this.vy = 0;
    this.speed = 0;
    this.lap = 0;
    this.lastS = 0;
    this.crossedStart = false;
    this.finished = false;
    this.state = 'normal';
    this.spinAngle = 0;
    this.spinStartAngle = 0;
    this.spinDuration = 0;
    this.spinTimer = 0;
    this.preSpinX = 0;
    this.preSpinY = 0;
    this.preSpinAngle = 0;
    this.preSpinVX = 0;
    this.preSpinVY = 0;
    this.hitCooldown = 0;
    this.input = { accel: false, brake: false, left: false, right: false };
    this.particles = [];
  }

  update(dt, isActive) {
    if (this.hitCooldown > 0) this.hitCooldown -= dt;

    if (this.state === 'spinning') {
      this.spinTimer += dt;
      const progress = clamp(this.spinTimer / this.spinDuration, 0, 1);
      this.spinAngle = this.spinStartAngle + progress * TAU * 2;
      if (progress >= 1) {
        this.x = this.preSpinX;
        this.y = this.preSpinY;
        this.angle = this.preSpinAngle;
        this.vx = this.preSpinVX;
        this.vy = this.preSpinVY;
        this.state = 'normal';
        this.spinTimer = 0;
      }
      this.updateParticles(dt);
      return;
    }

    if (!isActive) return;

    const MAX_SPEED = 380;
    const ACCEL = 820;
    const BRAKE = 1100;
    const DRAG = 0.92;
    const TURN_SPEED = 3.6;
    const GRIP = 0.98;

    const steer = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);

    if (this.input.accel) {
      this.speed = Math.min(MAX_SPEED, this.speed + ACCEL * dt);
    } else if (this.input.brake) {
      this.speed = Math.max(-MAX_SPEED * 0.45, this.speed - BRAKE * dt);
    } else {
      this.speed *= Math.pow(DRAG, dt * 60);
      if (Math.abs(this.speed) < 5) this.speed = 0;
    }

    const angleVel = steer * TURN_SPEED * (0.3 + 0.7 * Math.min(1, Math.abs(this.speed) / 120));
    this.angle += angleVel * dt * (this.speed >= 0 ? 1 : -1);

    const fx = Math.cos(this.angle) * this.speed;
    const fy = Math.sin(this.angle) * this.speed;
    this.vx = lerp(this.vx, fx, 1 - Math.pow(GRIP, dt * 60));
    this.vy = lerp(this.vy, fy, 1 - Math.pow(GRIP, dt * 60));

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    this.handleTrackCollision();
    this.checkLap();
    this.updateParticles(dt);
  }

  handleTrackCollision() {
    const near = track.nearest(this.x, this.y);
    const dist = near.dist;
    const hw = track.halfWidth;
    const margin = 8;

    if (dist > hw + margin) {
      const overlap = dist - (hw + margin);
      const pushX = near.nx * overlap * 1.5;
      const pushY = near.ny * overlap * 1.5;
      this.x += pushX;
      this.y += pushY;
      this.vx = -this.vx * 0.35 + pushX * 8;
      this.vy = -this.vy * 0.35 + pushY * 8;
      this.speed = Math.hypot(this.vx, this.vy);
      if (this.speed > 0) this.angle = Math.atan2(this.vy, this.vx);
      audio.hit(1.3);
    } else if (dist < hw - 110) {
      const overlap = (hw - 110) - dist;
      const pushX = -near.nx * overlap * 1.2;
      const pushY = -near.ny * overlap * 1.2;
      this.x += pushX;
      this.y += pushY;
      this.vx = -this.vx * 0.25 + pushX * 6;
      this.vy = -this.vy * 0.25 + pushY * 6;
      this.speed = Math.hypot(this.vx, this.vy);
      if (this.speed > 0) this.angle = Math.atan2(this.vy, this.vx);
    }
  }

  checkLap() {
    const near = track.nearest(this.x, this.y);
    const s = near.s;
    const crossed = this.lastS > 0.97 && s < 0.03;
    if (crossed && !this.crossedStart) {
      this.lap++;
      this.crossedStart = true;
      audio.lap();
      if (this.lap >= totalLaps && !this.finished) {
        this.finished = true;
        game.onFinish(this.id);
      }
    } else if (!crossed && this.lastS < 0.9) {
      this.crossedStart = false;
    }
    this.lastS = s;
  }

  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.alpha = p.life / p.maxLife;
    }
  }

  addDust() {
    if (Math.abs(this.speed) < 80) return;
    const backX = this.x - Math.cos(this.angle) * (KART_H * 0.45);
    const backY = this.y - Math.sin(this.angle) * (KART_H * 0.45);
    for (let i = 0; i < 2; i++) {
      const ang = this.angle + (Math.random() - 0.5) * 0.6 + Math.PI;
      const spd = 30 + Math.random() * 70;
      this.particles.push({
        x: backX, y: backY,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 0.25 + Math.random() * 0.2,
        maxLife: 0.45,
        alpha: 1,
        size: 2.5 + Math.random() * 3
      });
    }
  }

  triggerSpin() {
    if (this.state === 'spinning') return;
    this.preSpinX = this.x;
    this.preSpinY = this.y;
    this.preSpinAngle = this.angle;
    this.preSpinVX = this.vx;
    this.preSpinVY = this.vy;
    this.spinStartAngle = this.angle;
    this.spinAngle = this.angle;
    this.spinDuration = 1.1;
    this.spinTimer = 0;
    this.state = 'spinning';
    this.hitCooldown = 1.5;
    audio.spin();
  }

  render() {
    ctx.save();
    ctx.translate(this.x, this.y);
    if (this.state === 'spinning') {
      ctx.rotate(this.spinAngle);
    } else {
      ctx.rotate(this.angle);
    }

    // sombra
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath();
    ctx.ellipse(4, 8, KART_W * 0.52, KART_H * 0.26, 0, 0, TAU);
    ctx.fill();

    // chassis
    const r = 6;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.roundRect(-KART_W/2, -KART_H/2, KART_W, KART_H, r);
    ctx.fill();

    // capô
    ctx.fillStyle = this.colorDark;
    ctx.beginPath();
    ctx.roundRect(-KART_W/2 + 4, -KART_H/2 + 4, KART_W - 8, KART_H * 0.5, r - 2);
    ctx.fill();

    // cockpit
    ctx.fillStyle = '#0e1320';
    ctx.beginPath();
    ctx.roundRect(-KART_W/2 + 8, -KART_H/2 + 12, KART_W - 16, KART_H * 0.38, r - 3);
    ctx.fill();

    // volante
    ctx.strokeStyle = '#2a3040';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -KART_H/2 + 26, 5, 0, TAU);
    ctx.stroke();

    // assento
    ctx.fillStyle = '#1a1f30';
    ctx.beginPath();
    ctx.roundRect(-KART_W/2 + 10, -KART_H/2 + 34, KART_W - 20, KART_H * 0.3, r - 3);
    ctx.fill();

    // luz traseira
    ctx.fillStyle = '#ff3344';
    ctx.beginPath();
    ctx.roundRect(-KART_W/2 + 5, KART_H/2 - 10, KART_W - 10, 6, 2);
    ctx.fill();

    // rodas
    ctx.fillStyle = '#0f1116';
    for (const [wx, wy] of [[-KART_W/2 - 6, -KART_H/2 + 10], [KART_W/2 + 6, -KART_H/2 + 10], [-KART_W/2 - 6, KART_H/2 - 10], [KART_W/2 + 6, KART_H/2 - 10]]) {
      ctx.beginPath();
      ctx.ellipse(wx, wy, 12, 6, 0, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#2a2e36';
    for (const [wx, wy] of [[-KART_W/2 - 6, -KART_H/2 + 10], [KART_W/2 + 6, -KART_H/2 + 10], [-KART_W/2 - 6, KART_H/2 - 10], [KART_W/2 + 6, KART_H/2 - 10]]) {
      ctx.beginPath();
      ctx.ellipse(wx, wy, 6, 3, 0, 0, TAU);
      ctx.fill();
    }

    // número
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.id === 0 ? '1' : '2', 0, 4);

    // partículas de poeira
    for (const p of this.particles) {
      ctx.globalAlpha = p.alpha * 0.6;
      ctx.fillStyle = '#6a7a90';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }
}