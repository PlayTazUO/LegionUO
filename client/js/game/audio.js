import { settings } from './settings.js';
import { withServerParam } from './serverCache.js';

function volumeGain(base) {
  return Math.max(0.0001, base * (settings.get('audioVolume') / 100));
}

const FOOTSTEP_BASE = 0x012;
const FOOTSTEP_COUNT = 5;

export class AudioManager {
  constructor(config = {}) {
    this.config = config;
    this.ctx = null;
    this.master = null;
    this.music = null;
    this.musicSource = null;
    this.musicBuffers = new Map();
    this.musicPending = new Map();
    this.buffers = new Map();
    this.pending = new Map();
    this.failed = new Set();
  }

  get enabled() {
    return !!settings.get('audioEnabled');
  }

  ensure() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 1;
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  loadSample(id) {
    const key = id >>> 0;
    if (this.buffers.has(key)) return this.buffers.get(key);
    if (this.failed.has(key)) return null;
    if (this.pending.has(key)) return null;
    const ctx = this.ensure();
    if (!ctx) return null;
    const promise = fetch(withServerParam(`/api/sound/${key}.wav`, this.config))
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then((data) => (data ? ctx.decodeAudioData(data) : null))
      .then((buffer) => {
        if (buffer) this.buffers.set(key, buffer);
        else this.failed.add(key);
        return buffer;
      })
      .catch(() => {
        this.failed.add(key);
        return null;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return null;
  }

  playSample(id, gainScale = 1) {
    const ctx = this.ensure();
    if (!ctx) return false;
    const buffer = this.buffers.get(id >>> 0) || this.loadSample(id);
    if (!buffer) return false;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volumeGain(gainScale);
    source.connect(gain).connect(this.master || ctx.destination);
    source.start();
    return true;
  }

  play(id) {
    if (!this.enabled || !id) return;
    if (this.playSample(id, 0.55)) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 180 + ((id | 0) % 40) * 18;
    gain.gain.value = volumeGain(0.02);
    osc.connect(gain).connect(this.master || ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);
    osc.stop(ctx.currentTime + 0.1);
  }

  footstep({ run = false, mounted = false, tile = 0 } = {}) {
    if (!this.enabled || !settings.get('footsteps')) return;
    const id = FOOTSTEP_BASE + (mounted ? 1 : Math.abs(tile | 0) % FOOTSTEP_COUNT);
    if (this.playSample(id, run ? 0.4 : 0.5)) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const base = mounted ? 90 : 145 + (tile % 5) * 14;
    osc.type = mounted ? 'triangle' : 'square';
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(55, base * 0.72), now + (run ? 0.05 : 0.07));
    gain.gain.setValueAtTime(volumeGain(run ? 0.012 : 0.016), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (run ? 0.06 : 0.085));
    osc.connect(gain).connect(this.master || ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  warning() {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(720, now);
    osc.frequency.exponentialRampToValueAtTime(480, now + 0.18);
    gain.gain.setValueAtTime(volumeGain(0.03), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.connect(gain).connect(this.master || ctx.destination);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  loadMusic(index) {
    const key = index >>> 0;
    if (this.musicBuffers.has(key)) return this.musicBuffers.get(key);
    if (this.musicPending.has(key)) return null;
    const ctx = this.ensure();
    if (!ctx) return null;
    const promise = fetch(withServerParam(`/api/music/${key}.mp3`, this.config))
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then((data) => (data ? ctx.decodeAudioData(data) : null))
      .then((buffer) => {
        if (buffer) {
          this.musicBuffers.set(key, buffer);
          if (this.music === key && !this.musicSource) this.playMusic(key);
        }
        return buffer;
      })
      .catch(() => null)
      .finally(() => this.musicPending.delete(key));
    this.musicPending.set(key, promise);
    return null;
  }

  playMusic(index) {
    if (!this.enabled) return;
    if (index === this.music && this.musicSource) return;
    this.stopMusic();
    this.music = index;
    const ctx = this.ensure();
    if (!ctx) return;
    const buffer = this.musicBuffers.get(index >>> 0) || this.loadMusic(index);
    if (!buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = volumeGain(0.55);
    source.connect(gain).connect(this.master || ctx.destination);
    source.start();
    this.musicSource = source;
  }

  stopMusic() {
    this.music = null;
    if (this.musicSource) {
      try {
        this.musicSource.stop();
      } catch {
        /* ignore */
      }
      this.musicSource = null;
    }
  }
}
