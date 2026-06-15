// Procedural sound effects via the Web Audio API (no asset files).
import { Storage } from "./storage.js";

// ---- Per-theme background music profiles ------------------------------
// Each visual theme gets its own evolving, fully procedural backing track (no
// audio files). A profile defines the melodic scale the wandering lead draws
// from, a short bass figure, the tempo, the oscillator timbres, and the gentle
// per-voice gains. Pure data so it can be unit-tested without Web Audio.
export const MUSIC_PROFILES = {
  // Aurora — bright, airy major-pentatonic shimmer.
  aurora: {
    id: "aurora",
    tempo: 300,
    wave: "triangle",
    bassWave: "sine",
    noteDur: 0.26,
    melodyGain: 0.12,
    bassGain: 0.16,
    scale: [330, 392, 440, 494, 587, 659, 740, 880],
    bass: [110, 147, 165, 98],
  },
  // Sunset — warm, slower, wistful minor.
  sunset: {
    id: "sunset",
    tempo: 360,
    wave: "sine",
    bassWave: "sine",
    noteDur: 0.32,
    melodyGain: 0.13,
    bassGain: 0.16,
    scale: [294, 349, 392, 440, 523, 587, 698],
    bass: [98, 131, 147, 87],
  },
  // Bioluminescent forest — mysterious dorian colour.
  forest: {
    id: "forest",
    tempo: 320,
    wave: "sawtooth",
    bassWave: "triangle",
    noteDur: 0.24,
    melodyGain: 0.08,
    bassGain: 0.14,
    scale: [311, 370, 415, 466, 554, 622, 698],
    bass: [104, 117, 139, 93],
  },
  // Candy Pop — fast, bubbly, bright major.
  candy: {
    id: "candy",
    tempo: 250,
    wave: "square",
    bassWave: "triangle",
    noteDur: 0.18,
    melodyGain: 0.06,
    bassGain: 0.13,
    scale: [349, 392, 440, 523, 587, 698, 784, 880],
    bass: [131, 165, 196, 147],
  },
  // Ultraviolet — moody, slow, brooding minor.
  mono: {
    id: "mono",
    tempo: 380,
    wave: "sawtooth",
    bassWave: "sine",
    noteDur: 0.3,
    melodyGain: 0.07,
    bassGain: 0.15,
    scale: [277, 330, 370, 440, 494, 554, 659],
    bass: [92, 110, 123, 82],
  },
};

// Resolve a theme id to its music profile, falling back to the default track.
export function musicProfile(themeId) {
  return MUSIC_PROFILES[themeId] || MUSIC_PROFILES.aurora;
}

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = Storage.get("muted");
    this._musicGain = null;
    this.music = { theme: null, playing: false, timer: null, step: 0, idx: 0, profile: null };
  }

  _ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    // A dedicated, quieter sub-bus for background music so it sits under SFX.
    this._musicGain = this.ctx.createGain();
    this._musicGain.gain.value = 0.5;
    this._musicGain.connect(this.master);
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

  // Entering Fever: a hot, rising three-note fanfare distinct from the generic
  // power-up blip, so the "double points!" moment reads instantly by ear.
  fever() {
    this._ensure();
    const notes = [330, 494, 740];
    notes.forEach((n, i) =>
      setTimeout(() => this._tone(n, 0.22, "sawtooth", 0.26, n * 1.5), i * 70)
    );
    this._tone(165, 0.5, "triangle", 0.18, 247);
  }

  // Charged Blast detonation: a punchy descending boom, beefier and lower than
  // a normal pop so the screen-clearing AoE feels weighty.
  blast() {
    this._ensure();
    this._tone(180, 0.3, "square", 0.3, 60);
    this._tone(420, 0.16, "sawtooth", 0.2, 120);
    this._tone(90, 0.4, "sine", 0.22, 40);
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

  // ---- Background music -------------------------------------------------
  // A single quiet music voice that plays a wandering melody over a simple bass
  // figure, both drawn from the active theme's profile. Routed through a
  // dedicated sub-bus so it always sits beneath the SFX, and silenced by the
  // master gain whenever the game is muted.
  _musicTone(freq, dur, type, gain) {
    if (!this.ctx || this.muted || !this._musicGain) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this._musicGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  // Advance the generative sequence by one step: wander the lead up/down the
  // scale and pulse the bass on every fourth (down-)beat.
  _musicStep() {
    const m = this.music;
    if (!m.playing || !m.profile) return;
    const p = m.profile;
    const move = [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)];
    m.idx = Math.max(0, Math.min(p.scale.length - 1, m.idx + move));
    this._musicTone(p.scale[m.idx], p.noteDur, p.wave, p.melodyGain);
    if (m.step % 4 === 0) {
      const bass = p.bass[Math.floor(m.step / 4) % p.bass.length];
      this._musicTone(bass, p.noteDur * 2.2, p.bassWave, p.bassGain);
    }
    m.step = (m.step + 1) % 64;
  }

  // Start (or switch to) the background track for a theme. Restarting with the
  // same theme is a no-op so the groove keeps flowing across level restarts.
  // Safe no-op when Web Audio is unavailable (tests/SSR).
  startMusic(themeId) {
    this._ensure();
    if (!this.ctx) return;
    const profile = musicProfile(themeId);
    if (this.music.playing && this.music.profile && this.music.profile.id === profile.id) {
      return;
    }
    this.stopMusic();
    this.music.profile = profile;
    this.music.theme = profile.id;
    this.music.playing = true;
    this.music.step = 0;
    this.music.idx = Math.floor(profile.scale.length / 2);
    this.music.timer = setInterval(() => this._musicStep(), profile.tempo);
  }

  // Stop the background track and clear its scheduler.
  stopMusic() {
    if (this.music.timer) clearInterval(this.music.timer);
    this.music.timer = null;
    this.music.playing = false;
    this.music.theme = null;
    this.music.profile = null;
  }

  // Lightweight snapshot of the music state for tests/UI.
  musicState() {
    return { playing: this.music.playing, theme: this.music.theme };
  }
}

export const Audio = new AudioEngine();
