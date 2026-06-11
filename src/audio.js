// Procedural sound effects via the Web Audio API (no asset files).
import { Storage } from "./storage.js";

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = Storage.get("muted");
  }

  _ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
  }

  // Call from a user gesture to unlock audio on mobile.
  unlock() {
    this._ensure();
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    Storage.set("muted", m);
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  _tone(freq, dur, type = "sine", gain = 0.3, slideTo = null) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  pop(comboLevel = 0, groupSize = 2) {
    this._ensure();
    // Pitch rises with combo and group size for a satisfying climb.
    const base = 320 + comboLevel * 70 + Math.min(groupSize, 12) * 14;
    this._tone(base, 0.12, "triangle", 0.28, base * 1.5);
    this._tone(base * 2, 0.08, "sine", 0.12);
  }

  powerup() {
    this._ensure();
    this._tone(220, 0.18, "sawtooth", 0.22, 660);
    this._tone(440, 0.22, "triangle", 0.18, 880);
  }

  click() {
    this._ensure();
    this._tone(520, 0.05, "square", 0.12);
  }

  win() {
    this._ensure();
    const notes = [523, 659, 784, 1047];
    notes.forEach((n, i) => setTimeout(() => this._tone(n, 0.25, "triangle", 0.3), i * 110));
  }

  lose() {
    this._ensure();
    const notes = [392, 311, 262];
    notes.forEach((n, i) => setTimeout(() => this._tone(n, 0.3, "sine", 0.28), i * 130));
  }

  coin() {
    this._ensure();
    this._tone(880, 0.08, "square", 0.16, 1320);
  }
}

export const Audio = new AudioEngine();
