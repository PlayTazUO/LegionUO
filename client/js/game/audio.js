export class AudioManager {
  constructor() {
    this.enabled = new URLSearchParams(location.search).has('audio');
    this.ctx = null;
    this.music = null;
  }

  ensure() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
    }
    return this.ctx;
  }

  play(id) {
    const ctx = this.ensure();
    if (!ctx || id === 0) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 180 + (id % 40) * 18;
    gain.gain.value = 0.02;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);
    osc.stop(ctx.currentTime + 0.1);
  }

  footstep({ run = false, mounted = false, tile = 0 } = {}) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const base = mounted ? 90 : 145 + (tile % 5) * 14;
    osc.type = mounted ? 'triangle' : 'square';
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(55, base * 0.72), now + (run ? 0.05 : 0.07));
    gain.gain.setValueAtTime(run ? 0.012 : 0.016, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (run ? 0.06 : 0.085));
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  playMusic(index) {
    this.music = index;
  }

  stopMusic() {
    this.music = null;
  }
}
