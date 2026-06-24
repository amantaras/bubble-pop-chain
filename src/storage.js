// Persistent save data backed by localStorage.

const KEY = "bpc_save_v1";

// Max party support slots backing the equipped lead pet. Kept in sync with
// pets.js SUPPORT_SLOTS (storage stays dependency-free of the pets module).
const MAX_SUPPORTS = 2;

const DEFAULT_SAVE = {
  version: 1,
  maxUnlockedLevel: 1,
  stars: {}, // { [levelId]: 0..3 }
  levelScores: {}, // { [levelId]: best score } — per-level personal best
  highScoreEndless: 0,
  highScoreTimeAttack: 0,
  coins: 0,
  ownedThemes: ["aurora"],
  currentTheme: "aurora",
  adsRemoved: false,
  // One-time "Starter Pack" IAP — true once purchased so it can't be bought again.
  starterPack: false,
  muted: false,
  // Accessibility / display settings.
  // buyRepeatMs: how often a held shop buy button repeats a purchase
  // (default 500ms = 2 per second).
  // buyBatchMax: max items bought by one held press, hard-capped to 10.
  // reducedMotion: when on, screen shake is disabled, particle volume is cut,
  // and large CSS animations are neutralised (also auto-honoured from the OS
  // `prefers-reduced-motion` setting via CSS).
  settings: { colorblind: false, hints: true, reducedMotion: false, buyRepeatMs: 500, buyBatchMax: 10 },
  powerups: { undo: 0, bomb: 0, colorClear: 0, paint: 0, shuffle: 0, chainBolt: 0, pick: 0, extraMoves: 0, magnet: 0 },
  // The three power-ups shown in the HUD's quick-access slots. Players swap
  // them via a long-press picker so the bar never overflows as we add tools.
  loadout: [null, null, null],
  daily: {
    lastDate: null,
    streak: 0,
    bestStreak: 0,
    lastScore: 0,
    bestStars: 0,
    freezeTokens: 0,
  },
  // Weekly tournament: local best-score chase for the current ISO week.
  tournament: { weekKey: null, best: 0, plays: 0 },
  // Daily & weekly quests: a rotating set of small goals. `daily`/`weekly` hold
  // the active quest tracking entries ({id, progress, claimed}); they reset
  // when `dayKey`/`weekKey` roll over (see quests.js `ensureQuests`).
  quests: { dayKey: null, weekKey: null, daily: [], weekly: [] },
  // Piggy Bank: coins passively banked as you finish levels (capped). They stay
  // locked until the one-time "crack open" purchase pays out the whole vault.
  piggyBank: 0,
  // Puzzle Mode: best star rating earned per puzzle index ({ [index]: 0..3 }).
  // A puzzle unlocks the next one once it has been solved (≥1 star).
  puzzle: { stars: {} },
  firstRunDone: false,
  activeSession: null, // snapshot of an in-progress campaign level (resume)
  // Rolling 7-day login reward cycle: { lastClaim: "YYYY-MM-DD"|null, day }.
  loginCalendar: { lastClaim: null, day: 0 },
  // Season Pass progression: earned XP, claimed tier indices per track, and
  // whether the premium pass has been purchased.
  season: { xp: 0, claimedFree: [], claimedPrem: [], premium: false },
  milestonesCleared: [], // level ids whose one-time milestone reward was paid
  // Lifetime achievement state: `progress` accumulates the lifetime counters
  // the tiered categories test against, and `claims` maps a category id to the
  // number of its tiers the player has collected a chest for.
  achievements: {
    claims: {},
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
  // `crates` is the number of unopened pet crates. New players start with no
  // pet surface; Sparky and the first crate arrive from campaign progression.
  pets: {
    owned: {},
    equipped: null,
    crates: 0,
    // Party support slots — up to 2 extra pets that lend a fraction of their
    // passive buffs alongside the equipped lead (see pets.js partyBuffs).
    party: { supports: [] },
    // Pet Dust — earned from duplicate crate pulls, spent to craft a chosen pet.
    dust: 0,
    // Pity counters: opens since the last epic / legendary, for the crate
    // guarantee (see pets.js pityRarityFloor / nextPity).
    pity: { sinceEpic: 0, sinceLegendary: 0 },
  },
  // Loose gem inventory — earned from crates / events / Dust crafting, slotted
  // into a pet's sockets for extra buffs. Maps a gem key "type:tier" → count.
  gems: {},
  // While the interactive tutorial is running it temporarily loads a generous,
  // complete inventory so the player can experiment with every tool and pet.
  // The player's REAL inventory (power-ups, loadout, pets) is snapshotted here
  // first and restored verbatim when the tutorial ends. Persisting the snapshot
  // means a mid-tutorial page reload can still recover the real inventory
  // instead of leaving the inflated practice counts behind. `null` when no
  // tutorial is in progress.
  tutorialBackup: null,
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

  // Per-level personal best score.
  getLevelScore(levelId) {
    return (this.data.levelScores && this.data.levelScores[levelId]) || 0;
  }

  // Record a level score, keeping only the highest. Returns
  // `{ best, isNewBest }` — `isNewBest` is true only when this run beat the
  // previous best (and there was a previous best to beat).
  recordLevelScore(levelId, score) {
    if (!this.data.levelScores) this.data.levelScores = {};
    const prev = this.data.levelScores[levelId] || 0;
    const isNewBest = prev > 0 && score > prev;
    if (score > prev) {
      this.data.levelScores[levelId] = score;
      this.save();
    }
    return { best: Math.max(prev, score), isNewBest };
  }

  // ---- Puzzle Mode progress --------------------------------------------
  // Best star rating earned on a puzzle (0 if never solved).
  getPuzzleStars(index) {
    const p = this.data.puzzle;
    return (p && p.stars && p.stars[index]) || 0;
  }

  // The full puzzle index→best-stars map (used for unlock checks + progress).
  getPuzzleStarsMap() {
    return (this.data.puzzle && this.data.puzzle.stars) || {};
  }

  // Record a solved puzzle, keeping only the best star rating. Returns
  // `{ best, isNewBest, firstSolve }` — `firstSolve` is true the first time the
  // puzzle is solved at all, `isNewBest` when this run beat a prior star count.
  recordPuzzleResult(index, stars) {
    if (!this.data.puzzle) this.data.puzzle = { stars: {} };
    if (!this.data.puzzle.stars) this.data.puzzle.stars = {};
    const prev = this.data.puzzle.stars[index] || 0;
    const firstSolve = prev === 0;
    const isNewBest = stars > prev;
    if (stars > prev) {
      this.data.puzzle.stars[index] = stars;
      this.save();
    }
    return { best: Math.max(prev, stars), isNewBest, firstSolve };
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
  // `{ progress: {...}, claims: {...} }` (safe for old saves).
  getAchievementState() {
    const a = this.data.achievements || {};
    return {
      progress: { ...(a.progress || {}) },
      claims: { ...(a.claims || {}) },
    };
  }

  // Persist a new achievement state (progress counters + per-category claims).
  setAchievementState(state) {
    this.data.achievements = {
      progress: { ...(state.progress || {}) },
      claims: { ...(state.claims || {}) },
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
    if (!type) {
      lo[index] = null;
      this.set("loadout", lo);
      return true;
    }
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
    const pity = p.pity && typeof p.pity === "object" ? p.pity : {};
    const party = p.party && typeof p.party === "object" ? p.party : {};
    return {
      owned: p.owned && typeof p.owned === "object" ? p.owned : {},
      equipped: p.equipped || null,
      crates: p.crates || 0,
      dust: p.dust || 0,
      party: { supports: Array.isArray(party.supports) ? party.supports : [] },
      pity: {
        sinceEpic: pity.sinceEpic || 0,
        sinceLegendary: pity.sinceLegendary || 0,
      },
    };
  }

  _writePets(state) {
    this.data.pets = {
      owned: state.owned,
      equipped: state.equipped,
      crates: Math.max(0, state.crates || 0),
      dust: Math.max(0, state.dust || 0),
      party: {
        supports: Array.isArray(state.party && state.party.supports)
          ? state.party.supports
          : [],
      },
      pity: {
        sinceEpic: Math.max(0, (state.pity && state.pity.sinceEpic) || 0),
        sinceLegendary: Math.max(0, (state.pity && state.pity.sinceLegendary) || 0),
      },
    };
    this.save();
  }

  ownsPet(id) {
    const p = this.getPetState();
    return !!p.owned[id];
  }

  // Add a pet to the collection. Returns true only the first time (so duplicate
  // crate pulls can be redirected to bonus XP by the caller). A `trait`
  // (rolled on acquisition) is stored on the new entry; defaults to balanced.
  grantPet(id, trait = "balanced") {
    const p = this.getPetState();
    if (p.owned[id]) return false;
    p.owned[id] = {
      xp: 0,
      cosmetics: ["default"],
      cosmetic: "default",
      trait: trait || "balanced",
      sockets: [],
      tech: [],
    };
    this._writePets(p);
    return true;
  }

  // The trait id of an owned pet (or null if not owned). Old saves without a
  // trait field resolve to balanced via pets.getTrait's fallback.
  getPetTrait(id) {
    const p = this.getPetState();
    return p.owned[id] ? p.owned[id].trait || "balanced" : null;
  }

  // The chosen tech-tree node ids for an owned pet (always a fresh array; old
  // saves without a tech field resolve to an empty array).
  getPetTech(id) {
    const p = this.getPetState();
    const pet = p.owned[id];
    if (!pet) return [];
    return Array.isArray(pet.tech) ? pet.tech.slice() : [];
  }

  // Record a chosen tech-tree node for an owned pet (idempotent per node id).
  // Returns true when newly added. Caller validates the pick is legal.
  addPetTech(id, nodeId) {
    const p = this.getPetState();
    const pet = p.owned[id];
    if (!pet) return false;
    if (!Array.isArray(pet.tech)) pet.tech = [];
    if (pet.tech.includes(nodeId)) return false;
    pet.tech.push(nodeId);
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
    // The lead can't also occupy a support slot.
    if (Array.isArray(p.party.supports)) {
      p.party.supports = p.party.supports.filter((s) => s !== id);
    }
    this._writePets(p);
    return true;
  }

  // ---- Party support slots ---------------------------------------------
  // The (up to 2) support pet ids backing the equipped lead.
  getPartySupports() {
    const p = this.getPetState();
    return Array.isArray(p.party.supports) ? p.party.supports.slice() : [];
  }

  // Toggle a pet in/out of the support slots. Must be owned and not the lead.
  // Adds when there is room (cap MAX_SUPPORTS), removes when already present.
  // Returns the new support list.
  toggleSupport(id) {
    const p = this.getPetState();
    let s = Array.isArray(p.party.supports) ? p.party.supports.slice() : [];
    if (!p.owned[id] || id === p.equipped) return s;
    if (s.includes(id)) {
      s = s.filter((x) => x !== id);
    } else if (s.length < MAX_SUPPORTS) {
      s.push(id);
    }
    p.party.supports = s;
    this._writePets(p);
    return s;
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

  // ---- Pet Dust (duplicate currency) -----------------------------------
  getDust() {
    return this.getPetState().dust;
  }

  // Add (or subtract) dust; clamps at 0. Returns the new balance.
  addDust(n) {
    const p = this.getPetState();
    p.dust = Math.max(0, (p.dust || 0) + n);
    this._writePets(p);
    return p.dust;
  }

  // Spend dust if affordable. Returns true on success.
  spendDust(n) {
    const p = this.getPetState();
    if ((p.dust || 0) < n) return false;
    p.dust -= n;
    this._writePets(p);
    return true;
  }

  // ---- Crate pity counters ---------------------------------------------
  getPity() {
    return this.getPetState().pity;
  }

  setPity(pity) {
    const p = this.getPetState();
    p.pity = {
      sinceEpic: Math.max(0, (pity && pity.sinceEpic) || 0),
      sinceLegendary: Math.max(0, (pity && pity.sinceLegendary) || 0),
    };
    this._writePets(p);
  }

  // ---- Gems (loose inventory) + sockets --------------------------------
  // The loose gem inventory, a map of gem key "type:tier" → count.
  getGems() {
    const g = this.data.gems;
    return g && typeof g === "object" ? { ...g } : {};
  }

  // How many of a given gem key the player holds.
  gemCount(key) {
    return Math.max(0, this.getGems()[key] || 0);
  }

  // Add (or subtract) gems of a key; clamps at 0 and prunes empties. Returns
  // the new count for that key.
  addGem(key, n = 1) {
    const g = this.getGems();
    const next = Math.max(0, (g[key] || 0) + n);
    if (next <= 0) delete g[key];
    else g[key] = next;
    this.data.gems = g;
    this.save();
    return next;
  }

  // Spend one gem of a key if available. Returns true on success.
  spendGem(key) {
    if (this.gemCount(key) <= 0) return false;
    this.addGem(key, -1);
    return true;
  }

  // Fuse `count` identical gems of `key` into a single `upKey` (next tier up).
  // Atomic: only proceeds when the player holds at least `count`. Returns true
  // on success. The caller resolves `upKey` (see gems.fusedGemKey).
  fuseGems(key, upKey, count = 3) {
    if (!upKey || this.gemCount(key) < count) return false;
    this.addGem(key, -count);
    this.addGem(upKey, 1);
    return true;
  }

  // The socket array for an owned pet (empty slots are null). Always returns a
  // fresh array; never the stored reference.
  getSockets(id) {
    const p = this.getPetState();
    const pet = p.owned[id];
    if (!pet) return [];
    return Array.isArray(pet.sockets) ? pet.sockets.slice() : [];
  }

  // Slot a gem (key) into a pet's socket index. The gem must be in inventory;
  // any gem already in that slot is returned to inventory first. Returns true
  // on success. `maxSlots` bounds how many sockets the pet has unlocked.
  socketGem(id, slot, key, maxSlots) {
    const p = this.getPetState();
    const pet = p.owned[id];
    if (!pet) return false;
    if (slot < 0 || (maxSlots != null && slot >= maxSlots)) return false;
    if (this.gemCount(key) <= 0) return false;
    const sockets = Array.isArray(pet.sockets) ? pet.sockets.slice() : [];
    while (sockets.length <= slot) sockets.push(null);
    // Return the displaced gem (if any) to inventory.
    if (sockets[slot]) this.addGem(sockets[slot], 1);
    this.spendGem(key);
    sockets[slot] = key;
    pet.sockets = sockets;
    this._writePets(p);
    return true;
  }

  // Remove the gem from a pet's socket index. The gem is NOT returned to the
  // inventory — removal SHATTERS it (the caller converts it to a partial dust
  // refund). Returns the removed gem key (or null if the slot was empty).
  unsocketGem(id, slot) {
    const p = this.getPetState();
    const pet = p.owned[id];
    if (!pet || !Array.isArray(pet.sockets)) return null;
    const key = pet.sockets[slot];
    if (!key) return null;
    pet.sockets[slot] = null;
    this._writePets(p);
    return key;
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
