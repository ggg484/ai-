// 音频总线。
// 有平台宿主时：所有声音走 Builda.audio（平台静音开关才会生效）。
// 本地无宿主时：用 WebAudio 合成占位音，避免骨架版一片死寂。
// 正式音频放到 assets/audio/sfx/*.ogg，随 assets.zip 上传后自动替换。

import { hasHost, playSfx, vibrate } from '../platform/builda.js';

class AudioBus {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.enabled = true;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.38;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 1.2);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    } catch (e) { this.ctx = null; }
  }

  play(name, opts) {
    opts = opts || {};
    if (hasHost) {
      playSfx(name, { volume: typeof opts.volume === 'number' ? opts.volume : 1 });
      return;
    }
    if (!this.enabled || !this.ctx) return;
    this.synth(name, opts);
  }

  noise(dur, gain, filterType, f0, f1) {
    if (!this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, gain), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = this.ctx.createBiquadFilter();
    f.type = filterType || 'lowpass';
    f.frequency.setValueAtTime(f0 || 2000, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  tone(freq, dur, gain, type, slideTo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(Math.max(0.0001, gain), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  synth(name, opts) {
    const vol = typeof opts.volume === 'number' ? opts.volume : 1;
    switch (name) {
      case 'shot_rifle':
        this.noise(0.13, 0.55 * vol, 'lowpass', 4200, 500);
        this.tone(95, 0.09, 0.25 * vol, 'triangle', 55);
        break;
      case 'shot_pistol':
        this.noise(0.09, 0.42 * vol, 'highpass', 900, 240);
        this.tone(150, 0.06, 0.16 * vol, 'square', 80);
        break;
      case 'hit':
        this.tone(1350, 0.05, 0.18 * vol, 'square');
        break;
      case 'headshot':
        this.tone(1900, 0.09, 0.2 * vol, 'sine', 1400);
        this.noise(0.05, 0.12 * vol, 'highpass', 2500);
        break;
      case 'reload':
        this.tone(380, 0.04, 0.12 * vol, 'square');
        setTimeout(() => this.tone(520, 0.05, 0.12 * vol, 'square'), 180);
        break;
      case 'empty':
        this.tone(720, 0.03, 0.1 * vol, 'square');
        break;
      case 'step':
        this.noise(0.045, 0.1 * vol, 'lowpass', 700, 260);
        break;
      case 'beep':
        this.tone(1180, 0.07, 0.16 * vol, 'square');
        break;
      case 'plant':
        this.tone(420, 0.18, 0.15 * vol, 'sawtooth', 760);
        break;
      case 'explode':
        this.noise(0.9, 0.7 * vol, 'lowpass', 1800, 90);
        this.tone(70, 0.7, 0.3 * vol, 'sine', 30);
        break;
      case 'throw':
        this.noise(0.12, 0.28 * vol, 'highpass', 1600, 420);
        break;
      case 'he_bounce':
        this.tone(560, 0.035, 0.08 * vol, 'square');
        this.noise(0.035, 0.1 * vol, 'highpass', 2200);
        break;
      case 'he_explode':
        this.noise(1.0, 0.85 * vol, 'lowpass', 2200, 70);
        this.tone(64, 0.8, 0.38 * vol, 'sine', 26);
        break;
      case 'flash_explode':
        this.noise(0.22, 0.5 * vol, 'highpass', 5200, 1200);
        this.tone(2100, 0.16, 0.22 * vol, 'sine', 700);
        break;
      case 'smoke_pop':
        this.tone(170, 0.12, 0.14 * vol, 'triangle', 90);
        this.noise(0.55, 0.22 * vol, 'lowpass', 900, 180);
        break;
      case 'molotov_break':
        this.noise(0.2, 0.42 * vol, 'highpass', 3000, 500);
        this.tone(110, 0.16, 0.2 * vol, 'triangle', 60);
        this.noise(0.6, 0.18 * vol, 'lowpass', 700, 160);
        break;
      case 'fire':
        this.noise(0.45, 0.14 * vol, 'lowpass', 620, 180);
        break;
      case 'win':
        this.tone(523, 0.12, 0.12 * vol);
        setTimeout(() => this.tone(784, 0.16, 0.12 * vol), 120);
        break;
      case 'lose':
        this.tone(320, 0.14, 0.12 * vol, 'triangle');
        setTimeout(() => this.tone(220, 0.22, 0.12 * vol, 'triangle'), 140);
        break;
      default:
        break;
    }
  }

  vibrate(level) { vibrate(level); }
}

export const audio = new AudioBus();
