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
  // Accessibility / display settings.
  settings: { colorblind: false },
  powerups: { bomb: 1, colorClear: 1, shuffle: 1, chainBolt: 0, pick: 0, magnet: 1 },
  // The three power-ups shown in the HUD's quick-access slots. Players swap
  // them via a long-press picker so the bar never overflows as we add tools.
  loadout: ["bomb", "colorClear", "magnet"],
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
  // Lifetime achievement state: `unlocked` is the list of earned badge ids and
  // `progress` accumulates the counters those badges test against.
  achievements: {
    unlocked: [],
    progress: {
      pops: 0,
      bestCombo: 0,
      biggestGroup: 0,
      fevers: 0,
      levelsCleared: 0,
      totalStars: 0,
      defuses: 0,
      coinsEarned: 0,
    },
  },
  // Tracks the daily-capped "watch an ad for coins" reward. `date` is the
  // local day key it was last claimed on; `count` resets to 0 each new day.
  adRewards: { date: null, count: 0 },
  // Pet companions. `owned` maps petId → { xp, cosmetics:[ids], cosmetic } for
  // every pet the player has collected; `equipped` is the active pet's id;
  // `crates` is the number of unopened pet crates. New players start with
  // Sparky equipped and one starter crate so the system is usable immediately.
  pets: {
    owned: { sparky: { xp: 0, cosmetics: ["default"], cosmetic: "default" } },
    equipped: "sparky",
    crates: 1,
  },
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

  // Read the lifetime achievement state, always returning a well-formed
  // `{ unlocked: [...], progress: {...} }` (safe for old saves).
  getAchievementState() {
    const a = this.data.achievements || {};
    return {
      unlocked: Array.isArray(a.unlocked) ? a.unlocked.slice() : [],
      progress: { ...(a.progress || {}) },
    };
  }

  // Persist a new achievement state (unlocked ids + progress counters).
  setAchievementState(state) {
    this.data.achievements = {
      unlocked: Array.isArray(state.unlocked) ? state.unlocked.slice() : [],
      progress: { ...(state.progress || {}) },
    };
    this.save();
  }

  // The three quick-access HUD power-up slots, always a length-3 array.
  getLoadout() {
    const lo = this.data.loadout;
    if (!Array.isArray(lo) || lo.length === 0) {
      return [...DEFAULT_SAVE.loadout];
    }
    return lo.slice();
  }

  // Place `type` in slot `index`. If it already lives in another slot the two
  // are swapped so the loadout keeps three distinct tools. Returns true on
  // success.
  setLoadoutSlot(index, type) {
    const lo = this.getLoadout();
    if (index < 0 || index >= lo.length) return false;
    const existing = lo.indexOf(type);
    if (existing !== -1 && existing !== index) {
      lo[existing] = lo[index];
    }
    lo[index] = type;
    this.set("loadout", lo);
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

  // ---- Pet companions ---------------------------------------------------
  // Always returns a well-formed { owned, equipped, crates } (safe for old
  // saves that predate the pet system).
  getPetState() {
    const p = this.data.pets || {};
    return {
      owned: p.owned && typeof p.owned === "object" ? p.owned : {},
      equipped: p.equipped || null,
      crates: p.crates || 0,
    };
  }

  _writePets(state) {
    this.data.pets = {
      owned: state.owned,
      equipped: state.equipped,
      crates: Math.max(0, state.crates || 0),
    };
    this.save();
  }

  ownsPet(id) {
    const p = this.getPetState();
    return !!p.owned[id];
  }

  // Add a pet to the collection. Returns true only the first time (so duplicate
  // crate pulls can be redirected to bonus XP by the caller).
  grantPet(id) {
    const p = this.getPetState();
    if (p.owned[id]) return false;
    p.owned[id] = { xp: 0, cosmetics: ["default"], cosmetic: "default" };
    this._writePets(p);
    return true;
  }

  addPetXp(id, amount) {
    const p = this.getPetState();
    if (!p.owned[id]) return;
    p.owned[id].xp = (p.owned[id].xp || 0) + amount;
    this._writePets(p);
  }

  equipPet(id) {
    const p = this.getPetState();
    if (!p.owned[id]) return false;
    p.equipped = id;
    this._writePets(p);
    return true;
  }

  getEquippedPet() {
    const p = this.getPetState();
    if (!p.equipped || !p.owned[p.equipped]) return null;
    return { id: p.equipped, ...p.owned[p.equipped] };
  }

  addCrates(n) {
    const p = this.getPetState();
    p.crates = Math.max(0, (p.crates || 0) + n);
    this._writePets(p);
  }

  // Consume one crate. Returns true if one was available and spent.
  consumeCrate() {
    const p = this.getPetState();
    if ((p.crates || 0) <= 0) return false;
    p.crates -= 1;
    this._writePets(p);
    return true;
  }

  // Add a cosmetic to a pet. Returns true if newly granted (idempotent).
  grantCosmetic(petId, cosmeticId) {
    const p = this.getPetState();
    const pet = p.owned[petId];
    if (!pet) return false;
    if (!Array.isArray(pet.cosmetics)) pet.cosmetics = ["default"];
    if (pet.cosmetics.includes(cosmeticId)) return false;
    pet.cosmetics.push(cosmeticId);
    this._writePets(p);
    return true;
  }

  setCosmetic(petId, cosmeticId) {
    const p = this.getPetState();
    const pet = p.owned[petId];
    if (!pet) return false;
    pet.cosmetic = cosmeticId;
    this._writePets(p);
    return true;
  }

  reset() {
    this.data = deepDefault(null);
    this.save();
  }
}

export const Storage = new StorageManager();
