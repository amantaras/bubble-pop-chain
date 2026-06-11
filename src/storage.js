// Persistent save data backed by localStorage.

const KEY = "bpc_save_v1";

const DEFAULT_SAVE = {
  version: 1,
  maxUnlockedLevel: 1,
  stars: {}, // { [levelId]: 0..3 }
  highScoreEndless: 0,
  coins: 0,
  ownedThemes: ["aurora"],
  currentTheme: "aurora",
  adsRemoved: false,
  muted: false,
  powerups: { bomb: 1, colorClear: 1, shuffle: 1, chainBolt: 0, pick: 0, magnet: 1 },
  daily: {
    lastDate: null,
    streak: 0,
    bestStreak: 0,
    lastScore: 0,
    bestStars: 0,
    freezeTokens: 0,
  },
  firstRunDone: false,
  activeSession: null, // snapshot of an in-progress campaign level (resume)
  milestonesCleared: [], // level ids whose one-time milestone reward was paid
};

function deepDefault(saved) {
  // Merge saved over defaults so new fields always exist.
  const out = JSON.parse(JSON.stringify(DEFAULT_SAVE));
  if (saved && typeof saved === "object") {
    for (const k of Object.keys(DEFAULT_SAVE)) {
      if (saved[k] === undefined) continue;
      if (
        typeof DEFAULT_SAVE[k] === "object" &&
        DEFAULT_SAVE[k] !== null &&
        !Array.isArray(DEFAULT_SAVE[k])
      ) {
        out[k] = { ...DEFAULT_SAVE[k], ...saved[k] };
      } else {
        out[k] = saved[k];
      }
    }
  }
  return out;
}

class StorageManager {
  constructor() {
    this.data = this._read();
  }

  _read() {
    try {
      const raw = localStorage.getItem(KEY);
      return deepDefault(raw ? JSON.parse(raw) : null);
    } catch (e) {
      return deepDefault(null);
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch (e) {
      /* storage may be unavailable (private mode) — ignore */
    }
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  // Convenience helpers
  getStars(levelId) {
    return this.data.stars[levelId] || 0;
  }

  recordLevelResult(levelId, stars) {
    const prev = this.getStars(levelId);
    if (stars > prev) {
      this.data.stars[levelId] = stars;
    }
    if (levelId + 1 > this.data.maxUnlockedLevel) {
      this.data.maxUnlockedLevel = levelId + 1;
    }
    this.save();
  }

  totalStars() {
    return Object.values(this.data.stars).reduce((a, b) => a + b, 0);
  }

  // Has the one-time reward for this milestone level already been paid?
  hasClearedMilestone(levelId) {
    return (this.data.milestonesCleared || []).includes(levelId);
  }

  // Record a first milestone clear. Returns true only the first time, so the
  // bonus coins / power-ups / themes can never be farmed by replaying.
  recordMilestone(levelId) {
    if (!Array.isArray(this.data.milestonesCleared)) {
      this.data.milestonesCleared = [];
    }
    if (this.data.milestonesCleared.includes(levelId)) return false;
    this.data.milestonesCleared.push(levelId);
    this.save();
    return true;
  }

  // Grant ownership of a theme (e.g. a boss reward). Returns true if newly added.
  grantTheme(themeId) {
    const owned = this.data.ownedThemes || (this.data.ownedThemes = []);
    if (owned.includes(themeId)) return false;
    owned.push(themeId);
    this.save();
    return true;
  }

  reset() {
    this.data = deepDefault(null);
    this.save();
  }
}

export const Storage = new StorageManager();
