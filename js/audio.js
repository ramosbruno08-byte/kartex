'use strict';

/* Áudio 100% procedural (WebAudio). Nenhum arquivo externo. */
class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engines = [];
    this.muted = false;
    this.noiseBuffer = null;
    this.failed = false;
  }

  ensure() {
    if (this.failed) return false;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.failed = true; return false; }
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.55;
        this.master.connect(this.ctx.destination);
        this.buildNoise();
      } catch (e) {
        this.failed = true;
        return false;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(function () {});
    }
    return true;
  }

  buildNoise() {
    const len = Math.floor(this.ctx.sampleRate * 0.6);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buf;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
    }
  }

  startEngines() {
    if (!this.ensure() || this.engines.length) return;
    for (let i = 0; i < 2; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 60;
      const sub = this.ctx.createOscillator();
      sub.type = 'square';
      sub.frequency.value = 30;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 480;
      filter.Q.value = 2;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      const subGain = this.ctx.createGain();
      subGain.gain.value = 0.35;
      osc.connect(filter);
      sub.connect(subGain);
      subGain.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      osc.start();
      sub.start();
      this.engines.push({ osc: osc, sub: sub, filter: filter, gain: gain });
    }
  }

  updateEngines(karts, active) {
    if (!this.ctx || !this.engines.length) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < this.engines.length; i++) {
      const e = this.engines[i];
      const k = karts[i];
      if (!k) { e.gain.gain.setTargetAtTime(0, t, 0.1); continue; }
      const speed = Math.hypot(k.vx, k.vy);
      const throttle = k.input.accel ? 1 : 0;
      let g = active ? 0.012 + Math.min(0.028, speed * 0.00007) + throttle * 0.01 : 0;
      if (k.state === 'spinning') g *= 0.15;
      e.gain.gain.setTargetAtTime(this.muted ? 0 : g, t, 0.08);
      e.osc.frequency.setTargetAtTime(46 + speed * 0.17, t, 0.06);
      e.sub.frequency.setTargetAtTime(23 + speed * 0.085, t, 0.06);
      e.filter.frequency.setTargetAtTime(330 + speed * 2.0 + throttle * 180, t, 0.07);
    }
  }

  beep(freq, dur, type, vol) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.07, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  noise(dur, vol, freq) {
    if (!this.ensure() || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(freq || 900, t);
    filt.frequency.exponentialRampToValueAtTime(140, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol || 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  hit(strength) {
    const s = Math.max(0.4, Math.min(1.6, strength || 1));
    this.noise(0.16 + s * 0.06, 0.1 * s, 700);
    this.beep(90 + s * 20, 0.09, 'triangle', 0.05 * s);
  }

  spin() {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.linearRampToValueAtTime(880, t + 0.5);
    osc.frequency.linearRampToValueAtTime(300, t + 1.1);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 900;
    filt.Q.value = 3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.075, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
    osc.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 1.2);
    this.noise(0.9, 0.05, 1400);
  }

  lap() {
    this.beep(660, 0.09, 'square', 0.04);
    this.beep(880, 0.12, 'square', 0.04);
  }

  countdown(n) {
    if (n > 0) this.beep(440, 0.14, 'square', 0.07);
    else this.beep(880, 0.45, 'square', 0.09);
  }

  finish() {
    if (!this.ensure()) return;
    const notes = [523, 659, 784, 1046];
    for (let i = 0; i < notes.length; i++) {
      setTimeout(() => this.beep(notes[i], 0.28, 'square', 0.06), i * 130);
    }
    this.noise(0.5, 0.07, 1800);
  }
}
