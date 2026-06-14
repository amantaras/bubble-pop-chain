// Game orchestrator: canvas loop, state machine, and all session logic.
import { Board, RAINBOW, ICE, LIGHTNING, STONE } from "./grid.js";
import { Renderer } from "./renderer.js";
import { ParticleSystem, popStyleForGroup } from "./particles.js";
import {
  ScreenShake,
  FloatingText,
  PetAnim,
  AlienShip,
  BubbleFinale,
  BUBBLE_FINALE_VARIANTS,
} from "./animations.js";
import { Input, vibrate } from "./input.js";
import { Audio } from "./audio.js";
import { Storage } from "./storage.js";
import { getTheme, applyThemeCss } from "./themes.js";
import { getLevel, LEVEL_COUNT } from "./levels.js";
import {
  treasureReward,
  bossReward,
} from "./milestones.js";
import {
  groupScore,
  comboMultiplier,
  comboTier,
  cascadeBonus,
  cascadeTier,
  clearBonus,
  starsForScore,
  coinReward,
  powerGain,
  feverGain,
  feverPoints,
  FEVER_DURATION,
} from "./scoring.js";
import { Economy, POWERUP_INFO, STARTER_PACK } from "./economy.js";
import { Monetization } from "./monetization.js";
import { UI } from "./ui.js";
import {
  getDailyLevel,
  recordDaily,
  alreadyPlayedToday,
  getStreak,
  getDailyGoals,
  dailyStarsForScore,
  getFreezeTokens,
} from "./daily.js";
import {
  getTournamentLevel,
  getTournamentGoals,
  tournamentRank,
  recordTournament,
  getTournamentBest,
} from "./tournament.js";
import {
  Tutorial,
  buildTutorialBoard,
  decorateSpecials,
} from "./tutorial.js";
import {
  EVENT_GIFT,
  EVENT_PROBLEM,
  EVENT_FALL_TIME,
  EVENT_FIRST_DELAY,
  DEFUSE_REWARD,
  SCATTER_COUNT,
  nextEventDelay,
  pickEventType,
  rollGiftReward,
} from "./events.js";
import {
  mergeProgress,
  getCategory,
  categoryStatus,
  claimableCount,
  claimableCategories,
  aggregateChestRewards,
  rollChest,
} from "./achievements.js";
import {
  petBuffs,
  neutralBuffs,
  petActive,
  shooterStats,
  levelForXp,
  rollCrate,
  rollLegendaryCrate,
  getPet,
  getCosmetic,
  PET_XP_PER_LEVEL,
  DUP_XP,
  CRATE_COST,
  LEGENDARY_CRATE,
  PET_CATALOG,
} from "./pets.js";
import { calendarStatus, advanceCalendar } from "./calendar.js";
import {
  seasonStatus,
  addSeasonXp,
  claimTier,
  tierReward,
  unlockPremium,
  SEASON_PREMIUM_PRODUCT,
} from "./season.js";
import { makeRng, todayKey } from "./rng.js";
const TOP_INSET = 168;
const BOTTOM_INSET = 120;
const COMBO_WINDOW = 1.6; // seconds before a combo resets
// Seconds of inactivity before the idle "hint" assist highlights a valid move.
const HINT_DELAY = 5;
// Magnet gauge: half-width of the green "sweet" band, in gauge units (0..1).
// Strength tapers from 1 (dead on the sweet spot) to 0 at this distance.
// Widened from 0.2 → 0.3 so the green zone is more forgiving to lock onto.
const MAGNET_HALF = 0.3;
// How many of every power-up the tutorial temporarily loads so the player can
// experiment freely with each tool. The player's real, larger stashes are
// never reduced (we top up to at least this many) and are restored afterwards.
const TUTORIAL_TOOL_STOCK = 10;
// "Undo last move" budget: how many times a player may take back a move per
// level, and how deep the rewind history goes. Limited so it's a safety net,
// not a way to brute-force a level. Undo state is per-session and ephemeral
// (it is NOT persisted across reloads — a resumed level starts fresh).
const UNDO_BUDGET = 3;

// Time Attack: a fast score-rush mode where the board refills endlessly and the
// only limit is the clock. Players chase a personal best within the window.
const TIME_ATTACK_SECONDS = 60;

class Game {
  constructor() {
    this.canvas = document.getElementById("game-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.renderer = new Renderer(this.ctx);
    this.renderer.colorblind = !!(Storage.get("settings") || {}).colorblind;
    // Idle-hint assist, toggleable on the Themes screen (default on).
    this.hintsEnabled = (Storage.get("settings") || {}).hints !== false;
    this.particles = new ParticleSystem();
    this.floating = new FloatingText();
    this.shake = new ScreenShake();
    this.petAnim = new PetAnim();
    this.alienShip = new AlienShip();
    this.finale = new BubbleFinale();
    this.theme = getTheme(Storage.get("currentTheme"));
    this.session = null;
    this.tutorial = null;
    this.W = 0;
    this.H = 0;
    this.lastTime = 0;
    this._endTimer = null;
    // Falling gift/problem events.
    this.eventTimer = 0; // seconds until the next spawn
    this.activeEvent = false; // a token is currently on screen
  }

  init() {
    applyThemeCss(this.theme);
    UI.init();
    Monetization.init();
    UI.bind({
      startLevel: (id) => this.startCampaign(id),
      startEndless: () => this.startEndless(),
      startDaily: () => this.startDaily(),
      startTournament: () => this.startTournament(),
      startTimeAttack: () => this.startTimeAttack(),
      quitToMenu: () => this.quitToMenu(),
      resumeCampaign: () => this.resumeCampaign(),
      armPowerup: (type, btn) => this.armPowerup(type, btn),
      nextLevel: () => this.nextLevel(),
      retryLevel: () => this.retryLevel(),
      reviveLevel: () => this.reviveLevel(),
      doubleCoins: () => this.doubleCoins(),
      startTutorial: () => this.startTutorial(),
      tutorialNext: () => this.tutorial && this.tutorial.next(),
      tutorialSkip: () => this.tutorial && this.tutorial.skip(),
      undoMove: () => this.undoMove(),
      onThemeChange: (t) => {
        this.theme = t;
        // Swap the backing track live when the theme changes mid-session.
        if (this.session) Audio.startMusic(t.id);
      },
      onColorblindChange: (on) => {
        this.renderer.colorblind = !!on;
      },
      onHintsChange: (on) => {
        this.hintsEnabled = !!on;
        if (!on && this.session) this.session.hint = null;
      },
      openCrate: () => this.openCrate(),
      buyCrate: () => this.buyCrate(),
      buyLegendaryCrate: () => this.buyLegendaryCrate(),
      equipPet: (id) => this.equipPet(id),
      buyPremiumPet: (id) => this.buyPremiumPet(id),
      buyCosmetic: (petId, cos) => this.buyCosmetic(petId, cos),
      isLevelActive: () => this.isLevelActive(),
      pauseGame: () => this.pauseForOverlay(),
      resumeGame: () => this.resumeFromOverlay(),
      equipPetAndRestart: (id) => this.equipPetAndRestart(id),
      rescuePick: () => this._rescueWithPick(),
      rescueGiveUp: () => this._giveUpRescue(),
      claimAchievement: (id) => this.claimAchievement(id),
      claimAllAchievements: () => this.claimAllAchievements(),
      claimCalendar: () => this.claimCalendar(),
      claimSeasonTier: (index, track) => this.claimSeasonTier(index, track),
      buySeasonPremium: () => this.buySeasonPremium(),
      buyStarterPack: () => this.buyStarterPack(),
    });

    this.input = new Input(this.canvas, {
      onTap: (x, y) => this.handleTap(x, y),
      onDoubleTap: (x, y) => this.handleDoubleTap(x, y),
      onLongPressStart: (x, y) => this.previewAt(x, y),
      onLongPressMove: (x, y) => this.previewAt(x, y),
      onLongPressEnd: (x, y) => this.commitPreview(x, y),
      onSwipe: (dir, x0, y0) => this.handleSwipe(dir, x0, y0),
      shouldDeferTap: () => this.isBlastReady(),
    });
    this.input.setEnabled(false);

    // Unlock audio on first interaction.
    const unlock = () => {
      Audio.unlock();
      window.removeEventListener("pointerdown", unlock);
    };
    window.addEventListener("pointerdown", unlock);

    window.addEventListener("resize", () => this.resize());
    this.resize();
    UI.showScreen("menu");

    // Recover the real inventory if a previous tutorial was interrupted (e.g.
    // the page was reloaded mid-tutorial) before it could restore the snapshot.
    this._restoreTutorialInventory();

    // First-time players are walked through the interactive tutorial.
    if (!Storage.get("firstRunDone")) {
      this.startTutorial();
    }

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () =>
        navigator.serviceWorker.register("sw.js").catch(() => {})
      );
    }

    requestAnimationFrame((t) => this.loop(t));
  }

  resize() {
    // Render at the device's full pixel ratio (capped at 3) so bubbles stay
    // pin-sharp on high-DPI/Retina screens instead of being upscaled and blurry.
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = Math.floor(this.W * dpr);
    this.canvas.height = Math.floor(this.H * dpr);
    this.canvas.style.width = this.W + "px";
    this.canvas.style.height = this.H + "px";
    this.canvas._dpr = dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.session) {
      this.session.board.layout(this.W, this.H, TOP_INSET, this._bottomInset());
    }
  }

  // Bottom space to reserve when laying out the board. During the tutorial the
  // coach card is pinned to the bottom of the screen, so the board must sit
  // above it — reserve the card's actual on-screen height (measured live) plus
  // a small gap so no bubbles ever hide behind the card.
  _bottomInset() {
    const s = this.session;
    if (s && s.mode === "tutorial") {
      const overlay = document.getElementById("tutorial");
      const card = overlay && overlay.querySelector(".coach-card");
      if (card) {
        // Use offsetHeight (transform-independent) + the overlay's bottom
        // padding so the slide-in animation never skews the measurement.
        const h = card.offsetHeight;
        if (h > 0) {
          const padB = parseFloat(getComputedStyle(overlay).paddingBottom) || 0;
          return Math.max(BOTTOM_INSET, Math.round(h + padB + 16));
        }
      }
      return 320; // sensible default before the card has been rendered
    }
    return BOTTOM_INSET;
  }

  // Re-run board layout against the current insets. Called when the tutorial
  // coach card changes size between steps so the board stays clear of it.
  relayoutBoard() {
    if (this.session) {
      this.session.board.layout(this.W, this.H, TOP_INSET, this._bottomInset());
    }
  }

  // ---- Session setup ----------------------------------------------------
  _newStats() {
    // Per-run counters surfaced on the level-complete recap screen.
    return { pops: 0, swipes: 0, blasts: 0, powerups: 0, bestCombo: 0, cleared: 0 };
  }

  // The buffs the currently equipped pet provides (neutral if none).
  _equippedBuffs() {
    const eq = Storage.getEquippedPet();
    if (!eq) return neutralBuffs();
    return petBuffs(eq.id, levelForXp(eq.xp || 0));
  }

  // The active board action the equipped pet performs (or null for passive pets).
  _equippedActive() {
    const eq = Storage.getEquippedPet();
    if (!eq) return null;
    return petActive(eq.id, levelForXp(eq.xp || 0));
  }

  // Award XP to the equipped pet for completing a level. Returns a short reward
  // string ("🐾 Sparky reached Lv.3!" / "🐾 Sparky +12 XP") or "" if no pet.
  _awardPetXp() {
    const eq = Storage.getEquippedPet();
    if (!eq) return "";
    const before = levelForXp(eq.xp || 0);
    Storage.addPetXp(eq.id, PET_XP_PER_LEVEL);
    const after = levelForXp((eq.xp || 0) + PET_XP_PER_LEVEL);
    const pet = getPet(eq.id);
    const name = pet ? `${pet.icon} ${pet.name}` : "Pet";
    if (after > before) return `🐾 ${name} reached Lv.${after}!`;
    return `🐾 ${name} +${PET_XP_PER_LEVEL} XP`;
  }

  _newSession(mode, level) {
    clearTimeout(this._endTimer);
    const board = new Board(
      level.cols,
      level.rows,
      level.colors,
      level.seed,
      level.specials
    );
    // Boss levels seed a frozen core that must be shattered to win.
    let bossCoreTotal = 0;
    if (mode === "campaign" && level.milestone === "boss" && level.boss) {
      bossCoreTotal = board.placeFrozenCore(level.boss.coreW, level.boss.coreH);
    }
    const buffs = this._equippedBuffs();
    const active = this._equippedActive();
    this.session = {
      mode,
      level,
      board,
      score: 0,
      movesLeft: level.moves,
      combo: 0,
      comboTimer: 0,
      fever: 0,
      feverActive: false,
      feverTimer: 0,
      armed: null,
      ended: false,
      coinsEarned: 0,
      doubled: false,
      revived: false,
      rescuing: false,
      gaveUp: false,
      preview: null,
      power: buffs.startCharge,
      petBuffs: buffs,
      petActive: active,
      petTimer: active ? active.cooldown : 0,
      petPicking: false,
      shiftTokens: mode === "campaign" ? 0 : 5,
      stats: this._newStats(),
      bossCoreTotal,
      objective: (mode === "campaign" && level.objective) || null,
      objectiveMet: false,
      usedPowerup: false,
      undoStack: [],
      undosLeft: UNDO_BUDGET,
      // Time Attack countdown (seconds). Unused by other modes.
      timeLeft: mode === "timeattack" ? TIME_ATTACK_SECONDS : 0,
    };
    this._enterSession();
    if (mode === "campaign") this._persistSession();
  }

  // Shared UI/state setup used by both fresh and resumed sessions.
  _enterSession() {
    const board = this.session.board;
    this.session.magnet = null;
    this.paused = false;
    board.layout(this.W, this.H, TOP_INSET, this._bottomInset());
    this.particles.particles.length = 0;
    this.particles.rings.length = 0;
    this.floating.items.length = 0;
    UI.hideScreens();
    UI.hideModals();
    UI.hideMagnetGauge();
    UI.clearFallingEvents();
    this.activeEvent = false;
    // Tutorial gates input step-by-step, so falling events stay disabled there.
    this.eventTimer =
      this.session.mode === "tutorial" ? Infinity : EVENT_FIRST_DELAY;
    UI.showHud(true);
    UI.clearArmedPowerups();
    UI.updatePowerups();
    UI.updatePower(this.session.power || 0, (this.session.power || 0) >= 1);
    UI.updateFever(this.session.fever || 0, !!this.session.feverActive);
    UI.updatePetHud(this.session.mode === "tutorial" ? null : Storage.getEquippedPet());
    this._syncAlienShip();
    this.input.setEnabled(true);
    this.refreshHud();
    // Kick off the current theme's background track (no-op if already playing
    // this theme, so it keeps flowing across level restarts).
    Audio.startMusic(this.theme.id);
    // Announce the bonus objective at the start of a fresh campaign level.
    const s = this.session;
    if (
      s.mode === "campaign" &&
      s.objective &&
      !s.objectiveMet &&
      s.score === 0
    ) {
      UI.toast(`🎯 Bonus: ${s.objective.label} (+${s.objective.bonus})`, 2600);
    }
  }

  // Deploy or retire the premium Nova gunship for the current session. The ship
  // only flies for a real (non-tutorial) session whose equipped pet is the
  // autonomous shooter; its firepower is read from the pet's level.
  _syncAlienShip() {
    const s = this.session;
    const act = s && s.petActive;
    if (s && s.mode !== "tutorial" && act && act.type === "shooter") {
      const eq = Storage.getEquippedPet();
      const stats = shooterStats(levelForXp(eq ? eq.xp || 0 : 0));
      this.alienShip.start(stats, s.board);
    } else {
      this.alienShip.stop();
    }
  }

  // ---- Resume of an in-progress campaign level -------------------------
  hasResumableSession() {
    const snap = Storage.get("activeSession");
    return !!(snap && snap.mode === "campaign" && !snap.ended);
  }

  resumeLevelId() {
    const snap = Storage.get("activeSession");
    return snap && snap.mode === "campaign" ? snap.levelId : null;
  }

  resumeCampaign() {
    const snap = Storage.get("activeSession");
    if (!snap || snap.mode !== "campaign") return this.quitToMenu();
    clearTimeout(this._endTimer);
    const level = getLevel(snap.levelId);
    const board = new Board(
      level.cols,
      level.rows,
      level.colors,
      level.seed,
      level.specials
    );
    board.layout(this.W, this.H, TOP_INSET, this._bottomInset());
    board.restore(snap.grid, snap.types);
    this.session = {
      mode: "campaign",
      level,
      board,
      score: snap.score,
      movesLeft: snap.movesLeft,
      combo: 0,
      comboTimer: 0,
      fever: 0,
      feverActive: false,
      feverTimer: 0,
      armed: null,
      ended: false,
      coinsEarned: 0,
      doubled: false,
      revived: !!snap.revived,
      preview: null,
      power: 0,
      petBuffs: this._equippedBuffs(),
      petActive: this._equippedActive(),
      petTimer: (this._equippedActive() || { cooldown: 0 }).cooldown,
      petPicking: false,
      shiftTokens: 0,
      stats: snap.stats || this._newStats(),
      bossCoreTotal: snap.bossCoreTotal || board.frozenRemaining(),
      objective: level.objective || null,
      objectiveMet: !!snap.objectiveMet,
      usedPowerup: !!snap.usedPowerup,
      undoStack: [],
      undosLeft: UNDO_BUDGET,
    };
    this._enterSession();
  }

  // Persist or clear the in-progress campaign snapshot.
  _persistSession() {
    const s = this.session;
    if (!s || s.mode !== "campaign" || s.ended) return;
    Storage.set("activeSession", {
      mode: "campaign",
      levelId: s.level.id,
      score: s.score,
      movesLeft: s.movesLeft,
      revived: s.revived,
      ended: false,
      grid: s.board.serialize(),
      types: s.board.serializeTypes(),
      stats: s.stats,
      bossCoreTotal: s.bossCoreTotal || 0,
      objectiveMet: !!s.objectiveMet,
      usedPowerup: !!s.usedPowerup,
    });
  }

  _clearActiveSession() {
    if (Storage.get("activeSession")) Storage.set("activeSession", null);
  }

  startCampaign(id) {
    this._newSession("campaign", getLevel(id));
  }

  startEndless() {
    const lvl = {
      cols: 8,
      rows: 11,
      colors: 5,
      moves: 9999,
      target: 0,
      id: "endless",
      specials: { rainbow: 0.04, ice: 0.07 },
    };
    this._newSession("endless", lvl);
    this.session.movesLeft = 9999;
  }

  startTimeAttack() {
    // A 60-second score rush on an endlessly-refilling board. No move limit —
    // the clock is the only constraint. Chase your personal best.
    const lvl = {
      cols: 8,
      rows: 11,
      colors: 5,
      moves: 9999,
      target: 0,
      id: "timeattack",
      specials: { rainbow: 0.06, ice: 0.05 },
    };
    this._newSession("timeattack", lvl);
    this.session.movesLeft = 9999;
    this.session.timeLeft = TIME_ATTACK_SECONDS;
    UI.toast(`Time Attack — ${TIME_ATTACK_SECONDS}s on the clock!`);
  }

  startDaily() {
    // The daily challenge can be completed only once per day. Once today's run
    // is in the books, refuse to start a fresh board and nudge the player to
    // come back tomorrow (the menu's Daily tile is locked to match).
    if (alreadyPlayedToday()) {
      UI.updateDailySummary();
      UI.toast(`Daily done! Back tomorrow • Streak ${getStreak()}🔥`);
      return;
    }
    const lvl = getDailyLevel();
    this._newSession("daily", lvl);
    this.session.movesLeft = 9999;
    this.session.goals = getDailyGoals(lvl);
    const mod = lvl.modifier;
    if (mod) {
      UI.toast(`Today: ${mod.label} — ${mod.desc}`);
    }
  }

  startTournament() {
    // The weekly tournament is a replayable high-score chase on one seeded
    // board that lasts the whole ISO week — beat your own best to climb ranks.
    const lvl = getTournamentLevel();
    this._newSession("tournament", lvl);
    this.session.movesLeft = 9999;
    this.session.goals = getTournamentGoals(lvl);
    const mod = lvl.modifier;
    if (mod) {
      UI.toast(`This week: ${mod.label} — ${mod.desc}`);
    }
  }

  // ---- Interactive tutorial --------------------------------------------
  // A real, playable session in "tutorial" mode on a fully-controlled board.
  // The Tutorial controller gates progress: each "do this" step only advances
  // when the matching action is observed (see `_tut(...)` call sites). The
  // session never ends on its own and never touches the campaign save.
  startTutorial() {
    if (this.tutorial && this.tutorial.active) return;
    clearTimeout(this._endTimer);
    // Load a generous, complete practice inventory so the player can freely
    // try every tool (and pet) during the sandbox. The real inventory is
    // snapshotted first and restored when the tutorial ends — see
    // _stockTutorialInventory / _restoreTutorialInventory.
    this._stockTutorialInventory();
    const cols = 7;
    const rows = 9;
    const colors = 4;
    const board = new Board(cols, rows, colors, 7);
    const { colors: g, types } = buildTutorialBoard(cols, rows, colors);
    decorateSpecials(types);
    board.restore(g, types);
    this.session = {
      mode: "tutorial",
      level: { id: "tutorial", cols, rows, colors, target: 0 },
      board,
      score: 0,
      movesLeft: 9999,
      combo: 0,
      comboTimer: 0,
      fever: 0,
      feverActive: false,
      feverTimer: 0,
      armed: null,
      ended: false,
      coinsEarned: 0,
      doubled: false,
      revived: false,
      preview: null,
      power: 0,
      petBuffs: neutralBuffs(),
      petActive: null,
      petTimer: 0,
      petPicking: false,
      shiftTokens: 99,
      undoStack: [],
      undosLeft: UNDO_BUDGET,
    };
    this._enterSession();
    this.tutorial = new Tutorial({
      game: this,
      ui: UI,
      onFinish: () => this.finishTutorial(),
    });
    this.tutorial.start();
  }

  finishTutorial() {
    this.tutorial = null;
    // Hand the player back exactly the inventory they had before the tutorial
    // loaded its practice stock — never overwrite what they really own.
    this._restoreTutorialInventory();
    Storage.set("firstRunDone", true);
    this.session = null;
    this.input.setEnabled(false);
    Audio.stopMusic();
    UI.showScreen("menu");
  }

  // Temporarily load a complete, generous inventory for the tutorial sandbox so
  // the player can experiment with EVERY tool and pet. The real inventory is
  // snapshotted into `tutorialBackup` first (only once — a restart before
  // finishing keeps the original snapshot) and that snapshot is persisted, so a
  // mid-tutorial reload can still recover it. The player's real counts are
  // never reduced: each tool is topped up to at least TUTORIAL_TOOL_STOCK.
  _stockTutorialInventory() {
    if (!Storage.get("tutorialBackup")) {
      Storage.set("tutorialBackup", {
        powerups: { ...Storage.get("powerups") },
        loadout: Storage.getLoadout(),
        pets: JSON.parse(JSON.stringify(Storage.get("pets"))),
      });
    }
    const real = Storage.get("tutorialBackup").powerups || {};
    const stocked = { ...real };
    for (const type of Object.keys(POWERUP_INFO)) {
      stocked[type] = Math.max(real[type] || 0, TUTORIAL_TOOL_STOCK);
    }
    Storage.set("powerups", stocked);
    // Load every companion too, leaving the equipped pet untouched.
    const pets = JSON.parse(JSON.stringify(Storage.get("pets")));
    pets.owned = pets.owned || {};
    for (const pet of PET_CATALOG) {
      if (!pets.owned[pet.id]) {
        pets.owned[pet.id] = { xp: 0, cosmetics: ["default"], cosmetic: "default" };
      }
    }
    Storage.set("pets", pets);
  }

  // Restore the player's real inventory snapshot taken by
  // _stockTutorialInventory and clear the backup. Safe to call when no backup
  // exists (no-op), so it also recovers cleanly after an interrupted tutorial.
  _restoreTutorialInventory() {
    const backup = Storage.get("tutorialBackup");
    if (!backup) return;
    if (backup.powerups) Storage.set("powerups", { ...backup.powerups });
    if (backup.loadout) Storage.set("loadout", backup.loadout.slice());
    if (backup.pets) Storage.set("pets", JSON.parse(JSON.stringify(backup.pets)));
    Storage.set("tutorialBackup", null);
  }

  // ---- Pet companion actions (driven by the Pets screen) ----------------
  // Open one crate: consumes a crate, rolls a pet (very rarely a premium
  // surprise — see PREMIUM_DROP_CHANCE), grants it (or converts a duplicate
  // into bonus XP). Returns { petId, isNew, premium } or null when no crate was
  // available. The roll is seeded so opens are reproducible in tests via
  // `?e2e=1` + a fixed seed counter.
  openCrate() {
    if (!Storage.consumeCrate()) return null;
    this._crateSeed = ((this._crateSeed || 1) * 1664525 + 1013904223) >>> 0;
    const seed = (this._crateSeed ^ ((Date.now() >>> 0) || 1)) >>> 0;
    const { petId, premium } = rollCrate(makeRng(seed));
    const isNew = Storage.grantPet(petId);
    if (!isNew) Storage.addPetXp(petId, DUP_XP);
    return { petId, isNew, premium: !!premium };
  }

  // Buy one crate with coins. Returns true on success.
  buyCrate() {
    if (Economy.spendCoins(CRATE_COST)) {
      Storage.addCrates(1);
      return true;
    }
    return false;
  }

  // Buy + open the premium Legendary Crate via the (mock) IAP provider. Boosted
  // odds (see rollLegendaryCrate): always a legendary, often a premium pet.
  // Returns { petId, isNew, premium } on success, or null if the purchase fails.
  async buyLegendaryCrate() {
    const res = await Monetization.purchase(LEGENDARY_CRATE.product);
    if (!res || !res.ok) return null;
    this._crateSeed = ((this._crateSeed || 1) * 1664525 + 1013904223) >>> 0;
    const seed = (this._crateSeed ^ ((Date.now() >>> 0) || 1)) >>> 0;
    const { petId, premium } = rollLegendaryCrate(makeRng(seed));
    const isNew = Storage.grantPet(petId);
    if (!isNew) Storage.addPetXp(petId, DUP_XP);
    return { petId, isNew, premium: !!premium };
  }

  // Equip a pet you own; refreshes the live session's buffs if mid-level.
  equipPet(id) {
    if (!Storage.equipPet(id)) return false;
    if (this.session && !this.session.ended) {
      this.session.petBuffs = this._equippedBuffs();
      this.session.petActive = this._equippedActive();
      this.session.petTimer = this.session.petActive
        ? this.session.petActive.cooldown
        : 0;
    }
    UI.updatePetHud(Storage.getEquippedPet());
    return true;
  }

  // True while a real (non-tutorial) level is being played. Used by the pet
  // overlay to decide whether switching companions should warn + restart.
  isLevelActive() {
    return !!(
      this.session &&
      !this.session.ended &&
      this.session.mode !== "tutorial"
    );
  }

  // Freeze the running level while the pet overlay is open over it.
  pauseForOverlay() {
    this.paused = true;
    if (this.input) this.input.setEnabled(false);
    // Suspend any in-flight gift/problem token so it doesn't keep falling (and
    // miss) while the player is on another window.
    UI.pauseFallingEvents();
  }

  // Resume the level when the pet overlay closes without a companion switch.
  resumeFromOverlay() {
    this.paused = false;
    if (this.input) this.input.setEnabled(true);
    UI.resumeFallingEvents();
  }

  // Equip a different companion and restart the current level from scratch so
  // the new buffs apply to a fresh board. Invoked from the overlay's confirm.
  equipPetAndRestart(id) {
    Storage.equipPet(id);
    this.paused = false;
    this.retryLevel();
  }


  async buyPremiumPet(id) {
    const pet = getPet(id);
    if (!pet || !pet.premium) return false;
    const res = await Monetization.purchase(pet.product || `pet_${id}`);
    if (!res || !res.ok) return false;
    Storage.grantPet(id);
    return true;
  }

  // Buy the one-time Starter Pack bundle via the (mock) IAP provider. Grants
  // coins + a spread of power-ups + a pet crate, then flags the save so it can
  // never be bought again. Returns { ok, owned?, pack? }.
  async buyStarterPack() {
    if (Storage.get("starterPack")) return { ok: false, owned: true };
    const res = await Monetization.purchase(STARTER_PACK.id);
    if (!res || !res.ok) return { ok: false };
    Economy.addCoins(STARTER_PACK.coins);
    Object.entries(STARTER_PACK.powerups).forEach(([type, n]) =>
      Economy.addPowerup(type, n)
    );
    if (STARTER_PACK.crates) Storage.addCrates(STARTER_PACK.crates);
    Storage.set("starterPack", true);
    return { ok: true, pack: STARTER_PACK };
  }

  // Buy a cosmetic tint for a pet with coins. Returns true on success.
  buyCosmetic(petId, cosmetic) {
    const cos = getCosmetic(cosmetic.id || cosmetic);
    if (!cos) return false;
    if (Storage.ownsPet(petId) === false) return false;
    if (Economy.spendCoins(cos.price)) {
      Storage.grantCosmetic(petId, cos.id);
      Storage.setCosmetic(petId, cos.id);
      return true;
    }
    return false;
  }

  // Set up the board/meter for a tutorial step that needs a precondition.
  tutorialGrant(kind) {
    const s = this.session;
    if (!s) return;
    if (kind === "power") {
      s.power = 1;
      UI.updatePower(1, true);
    } else if (kind === "fever") {
      // Demonstrate Fever: fill the gauge and trigger it so the player sees
      // the bar top out and the FEVER banner fire.
      this._startFever();
    } else if (kind === "specials") {
      // Re-assert a visible Rainbow + Ice so the explanation always matches
      // what's on the board, regardless of what the player popped earlier.
      const b = s.board;
      const midR = Math.floor(b.rows / 2);
      const midC = Math.floor(b.cols / 2);
      const place = (c, r, t) => {
        if (b.grid[c] && b.grid[c][r] !== -1) {
          b.types[c][r] = t;
          const sp = b.spriteGrid[c] && b.spriteGrid[c][r];
          if (sp) sp.type = t;
        }
      };
      place(midC, midR, RAINBOW);
      place(Math.min(b.cols - 1, midC + 1), midR, ICE);
    } else if (kind === "magnet") {
      // Give the magnet a full, scattered board so demonstrating the pull is
      // always possible no matter what the player popped earlier.
      const b = s.board;
      const { colors: g, types } = buildTutorialBoard(
        b.cols,
        b.rows,
        s.level.colors || 4
      );
      decorateSpecials(types);
      b.restore(g, types);
    } else if (kind === "lightning") {
      // Fresh practice board with a lightning bubble parked inside a guaranteed
      // cluster so popping it always triggers a strike and advances the step.
      const b = s.board;
      const { colors: g, types } = buildTutorialBoard(
        b.cols,
        b.rows,
        s.level.colors || 4
      );
      decorateSpecials(types);
      this._placeTutorialLightning(types);
      b.restore(g, types);
    } else if (kind === "stone") {
      // Fresh practice board with a locked stone parked next to a guaranteed
      // cluster, so popping that cluster always shatters it and advances.
      const b = s.board;
      const { colors: g, types } = buildTutorialBoard(
        b.cols,
        b.rows,
        s.level.colors || 4
      );
      decorateSpecials(types);
      this._placeTutorialStone(types);
      b.restore(g, types);
    } else if (kind === "event") {
      this._spawnTutorialEvent();
    } else if (kind === "undo") {
      // Guarantee there is a move to take back so the player can try Undo, and
      // refill the undo budget for the demo.
      s.undosLeft = UNDO_BUDGET;
      if (!Array.isArray(s.undoStack) || s.undoStack.length === 0) {
        this._pushUndo();
      }
    }
    // "bomb": tutorial bypasses the economy (see armPowerup/applyPowerup).
  }

  // Drop a LIGHTNING bubble into a corner 2×2 block of the practice board (a
  // guaranteed same-colour cluster), so the lightning step can always be cleared.
  _placeTutorialLightning(types) {
    if (types && types[0] && types[0][0] !== undefined) types[0][0] = LIGHTNING;
  }

  // Lock a STONE bubble at (2,0) — orthogonally adjacent to the guaranteed
  // top-left colour cluster — so popping that cluster always shatters it and
  // advances the stone step. Keep the cluster itself stone-free.
  _placeTutorialStone(types) {
    if (types && types[2] && types[2][0] !== undefined) types[2][0] = STONE;
  }

  // Rebuild the controlled practice board so the tutorial never runs out of
  // poppable clusters no matter how much the player pops/blasts.
  _refillTutorialBoard() {
    const s = this.session;
    if (!s || s.mode !== "tutorial") return;
    const b = s.board;
    const { colors: g, types } = buildTutorialBoard(
      b.cols,
      b.rows,
      s.level.colors || 4
    );
    decorateSpecials(types);
    // Keep a lightning bubble available while the lightning step is active.
    if (this.tutorial && this.tutorial.stepId === "lightning") {
      this._placeTutorialLightning(types);
    }
    // Keep a stone bubble available while the stone step is active.
    if (this.tutorial && this.tutorial.stepId === "stone") {
      this._placeTutorialStone(types);
    }
    b.restore(g, types);
    b.layout(this.W, this.H, TOP_INSET, this._bottomInset());
  }

  // Drop a forgiving gift token for the tutorial's "Gifts & Problems" step. It
  // falls slowly and re-spawns if missed, so the step always advances once the
  // player taps it. (Auto-spawns stay disabled in tutorial mode.)
  _spawnTutorialEvent() {
    UI.clearFallingEvents();
    this.activeEvent = true;
    const desc = { type: EVENT_GIFT, reward: { type: "coins", coins: 30 } };
    this._activeEventDesc = desc;
    UI.spawnFallingEvent(
      { type: EVENT_GIFT, leftPct: 50, fallTime: 6 },
      {
        onTap: () => this._onEventTap(desc),
        onMiss: () => {
          // Keep offering a token until the player taps one in the tutorial.
          if (
            this.tutorial &&
            this.tutorial.active &&
            this.tutorial.stepId === "events"
          ) {
            this._spawnTutorialEvent();
          } else {
            this._resolveEvent();
          }
        },
      }
    );
  }

  // Notify the tutorial that an action happened in the real game.
  _tut(type) {
    if (this.tutorial && this.tutorial.active) this.tutorial.onAction(type);
  }

  // Track progress toward the level's optional bonus objective. Combo/group
  // objectives latch as soon as they're reached; "nopowerup" is evaluated at
  // finish from the usedPowerup flag. Purely additive — never affects win/stars.
  _trackObjective({ combo = 0, group = 0 } = {}) {
    const s = this.session;
    if (!s || s.mode !== "campaign" || s.objectiveMet) return;
    const obj = s.objective;
    if (!obj) return;
    if (obj.type === "combo" && combo >= obj.goal) s.objectiveMet = true;
    else if (obj.type === "group" && group >= obj.goal) s.objectiveMet = true;
    if (s.objectiveMet) {
      Audio.coin();
      this.floating.spawn(this.W / 2, this.H * 0.32, "🎯 Objective!", "#5be3ff", 28);
      this.refreshHud();
    }
  }

  // A power-up tool was spent this level (used by the "nopowerup" objective).
  _markPowerupUsed() {
    const s = this.session;
    if (s && s.mode === "campaign") s.usedPowerup = true;
  }

  // ---- Undo last move ---------------------------------------------------
  // Snapshot the move-reversible session state BEFORE a committed move so the
  // player can take it back. `refund` optionally records a consumable to give
  // back on undo ({ powerup: type }). The stack is capped at UNDO_BUDGET to
  // bound memory; the oldest snapshot is dropped when it overflows.
  _pushUndo(refund = null) {
    const s = this.session;
    if (!s || s.ended) return;
    if (!Array.isArray(s.undoStack)) s.undoStack = [];
    if ((s.undosLeft || 0) <= 0) return; // no budget — don't bother recording
    s.undoStack.push({
      grid: s.board.serialize(),
      types: s.board.serializeTypes(),
      score: s.score,
      movesLeft: s.movesLeft,
      combo: s.combo,
      comboTimer: s.comboTimer,
      power: s.power,
      fever: s.fever,
      feverActive: s.feverActive,
      feverTimer: s.feverTimer,
      shiftTokens: s.shiftTokens,
      petTimer: s.petTimer,
      objectiveMet: s.objectiveMet,
      usedPowerup: s.usedPowerup,
      stats: s.stats ? { ...s.stats } : null,
      refund: refund || null,
    });
    if (s.undoStack.length > UNDO_BUDGET) s.undoStack.shift();
  }

  // Can the player undo right now? Needs an active, idle (non-animating)
  // session, a remaining budget, and at least one recorded snapshot.
  canUndo() {
    const s = this.session;
    if (!s || s.ended) return false;
    if (s.finishing || s.petPicking) return false; // mid-animation
    if (s.magnet && s.magnet.aiming) return false; // mid magnet aim
    if ((s.undosLeft || 0) <= 0) return false;
    return Array.isArray(s.undoStack) && s.undoStack.length > 0;
  }

  // Take back the most recent move: restore the board and all move-reversible
  // state, refund any consumable that move spent, and consume one undo charge.
  // Returns true if a move was undone.
  undoMove() {
    const s = this.session;
    if (!this.canUndo()) {
      if (s && !s.ended) UI.toast("Nothing to undo");
      return false;
    }
    const snap = s.undoStack.pop();
    s.board.restore(snap.grid, snap.types);
    s.board.layout(this.W, this.H, TOP_INSET, this._bottomInset());
    s.score = snap.score;
    s.movesLeft = snap.movesLeft;
    s.combo = snap.combo;
    s.comboTimer = snap.comboTimer;
    s.power = snap.power;
    s.fever = snap.fever;
    s.feverActive = snap.feverActive;
    s.feverTimer = snap.feverTimer;
    s.shiftTokens = snap.shiftTokens;
    s.petTimer = snap.petTimer;
    s.objectiveMet = snap.objectiveMet;
    s.usedPowerup = snap.usedPowerup;
    if (snap.stats) s.stats = { ...snap.stats };
    // Refund any tool the undone move consumed.
    if (snap.refund && snap.refund.powerup) {
      Economy.addPowerup(snap.refund.powerup, 1);
    }
    // Cancel any transient in-progress state.
    s.preview = null;
    s.armed = null;
    s.magnet = null;
    s.hint = null;
    s.idleTime = 0;
    s.undosLeft = Math.max(0, (s.undosLeft || 0) - 1);

    UI.clearArmedPowerups();
    UI.hideMagnetGauge();
    UI.updatePowerups();
    UI.updatePower(s.power, s.power >= 1);
    UI.updateFever(s.fever, !!s.feverActive);
    this.refreshHud();
    if (s.mode === "campaign") this._persistSession();
    Audio.click();
    vibrate(12);
    UI.toast(`↶ Undo (${s.undosLeft} left)`);
    this._noteActivity();
    this._tut("undo");
    return true;
  }

  // ---- HUD --------------------------------------------------------------
  refreshHud() {
    const s = this.session;
    if (!s) return;
    // Undo control: show the remaining budget; enabled only when a move can be
    // taken back right now.
    UI.updateUndo(s.undosLeft || 0, this.canUndo());
    // Bonus objective chip (campaign non-boss levels only).
    UI.updateObjective(
      s.mode === "campaign" && s.level.milestone !== "boss" ? s.objective : null,
      s.objectiveMet
    );
    if (s.mode === "campaign") {
      const mtype = s.level.milestone;
      const badge = mtype === "boss" ? "👹 " : mtype === "treasure" ? "🎁 " : "";
      if (mtype === "boss") {
        const remaining = s.board.frozenRemaining();
        const total = s.bossCoreTotal || remaining || 1;
        UI.updateHud({
          modeLabel: `${badge}Level ${s.level.id}`,
          score: s.score,
          movesLabel: "Moves",
          moves: s.movesLeft,
          showTarget: true,
          targetLabel: "Core",
          target: remaining,
          progress: 1 - remaining / total,
        });
        return;
      }
      UI.updateHud({
        modeLabel: `${badge}Level ${s.level.id}`,
        score: s.score,
        movesLabel: "Moves",
        moves: s.movesLeft,
        showTarget: true,
        targetLabel: "Target",
        target: s.level.target,
        progress: s.score / s.level.target,
      });
    } else if (s.mode === "tutorial") {
      UI.updateHud({
        modeLabel: "Tutorial",
        score: s.score,
        movesLabel: "",
        moves: "",
        showTarget: false,
        progress: 0,
      });
    } else if (s.mode === "endless") {
      UI.updateHud({
        modeLabel: "Endless",
        score: s.score,
        movesLabel: "Best",
        moves: Storage.get("highScoreEndless"),
        showTarget: false,
        progress: 1 - s.board.countRemaining() / (s.board.cols * s.board.rows),
      });
    } else if (s.mode === "timeattack") {
      UI.updateHud({
        modeLabel: "Time Attack",
        score: s.score,
        movesLabel: "Time",
        moves: Math.ceil(s.timeLeft) + "s",
        showTarget: false,
        progress: Math.max(0, s.timeLeft / TIME_ATTACK_SECONDS),
      });
    } else {
      UI.updateHud({
        modeLabel: "Daily",
        score: s.score,
        movesLabel: "Streak",
        moves: getStreak(),
        showTarget: false,
        progress: 1 - s.board.countRemaining() / (s.board.cols * s.board.rows),
      });
    }
  }

  // ---- Input handling ---------------------------------------------------
  handleTap(px, py) {
    const s = this.session;
    if (!s || s.ended) return;
    this._noteActivity();

    // A magnet is mid-aim: the next tap locks in the swinging strength gauge.
    if (s.magnet && s.magnet.aiming) {
      this.lockMagnet();
      return;
    }

    const cell = s.board.cellAtPixel(px, py);

    // Arming the magnet: the first tap picks the target bubble and starts the
    // strength gauge (a second tap then locks it — handled above).
    if (s.armed === "magnet") {
      if (!cell) return;
      this.beginMagnet(cell.c, cell.r);
      return;
    }

    if (s.armed) {
      if (!cell) return; // need a valid bubble target
      this.applyPowerup(s.armed, cell.c, cell.r);
      return;
    }

    if (!cell) return;
    this.popAt(cell.c, cell.r);
  }

  // ---- Swipe left/right: Shift a whole row (2048-style) -----------------
  handleSwipe(dir, x0, y0) {
    const s = this.session;
    if (!s || s.ended || s.armed) return;
    this._noteActivity();
    if (dir !== "left" && dir !== "right") return; // only horizontal shifts

    const r = s.board.rowAtPixel(y0);
    if (r === null) return;

    // A shift is a move: campaign spends a move, endless/daily spend a token.
    if (s.mode === "campaign") {
      if (s.movesLeft <= 0) return;
    } else if (s.shiftTokens <= 0) {
      UI.toast("No shifts left");
      return;
    }

    // Record an undo snapshot before the shift mutates the board; discard it if
    // the row turns out to be empty (no real move happened).
    this._pushUndo();
    if (!s.board.shiftRow(r, dir)) {
      if (Array.isArray(s.undoStack)) s.undoStack.pop();
      return; // empty row — nothing to shift
    }

    s.preview = null;
    s.board.settle();
    if (s.mode === "campaign") s.movesLeft -= 1;
    else s.shiftTokens -= 1;
    if (s.stats) s.stats.swipes += 1;

    Audio.pop(1, 3);
    vibrate(16);
    UI.toast(dir === "left" ? "◀ Row shifted" : "Row shifted ▶");
    this.refreshHud();
    this._tut("swipe");
    this.afterMove();
  }

  // ---- Long-press: Preview & Plan --------------------------------------
  // Projected points for popping a group of size n at the current combo.
  projectedPoints(n) {
    if (n < 2) return 0;
    return Math.round(groupScore(n) * comboMultiplier(this.session.combo));
  }

  // Highlight the group under the finger and show its projected score.
  previewAt(px, py) {
    const s = this.session;
    if (!s || s.ended || s.armed) return;
    this._noteActivity();
    const cell = s.board.cellAtPixel(px, py);
    if (!cell) {
      s.preview = null;
      return;
    }
    const group = s.board.getGroupAt(cell.c, cell.r);
    if (group.length < 2) {
      s.preview = null;
      return;
    }
    s.preview = {
      cells: group,
      points: this.projectedPoints(group.length),
      size: group.length,
    };
    this._tut("preview");
  }

  // Release: pop the previewed group if the finger is still on a valid one.
  commitPreview(px, py) {
    const s = this.session;
    if (!s || s.ended) return;
    const had = s.preview;
    s.preview = null;
    if (s.armed) return;
    const cell = s.board.cellAtPixel(px, py);
    if (!cell || !had) return;
    if (s.board.getGroupAt(cell.c, cell.r).length >= 2) {
      this.popAt(cell.c, cell.r);
    }
  }

  popAt(c, r) {
    const s = this.session;
    s.preview = null;
    const group = s.board.getGroupAt(c, r);
    if (group.length < 2) {
      vibrate(8);
      return;
    }

    // Record an undo snapshot before this move mutates the board.
    this._pushUndo();

    // Lightning bubbles in the group discharge along their row + column,
    // expanding the cleared set. Score reflects everything cleared.
    const struck = group.some((p) => s.board.isLightning(p.c, p.r));
    const cells = struck ? s.board.lightningStrike(group) : group;

    // Score with combo multiplier.
    const base = groupScore(cells.length);
    const mult = comboMultiplier(s.combo);
    const comboPoints = Math.round(base * mult);
    // Cascade / chain-reaction bonus: a flat, escalating reward for keeping the
    // chain alive (popping again before the combo window closes). `s.combo` is
    // still the PRE-pop count here, so this pop's chain length is combo + 1.
    const chainLen = s.combo + 1;
    const cascade = cascadeBonus(chainLen);
    const points = Math.round(
      feverPoints(comboPoints + cascade, s.feverActive) * s.petBuffs.scoreMult
    );
    s.score += points;
    s.combo += 1;
    s.comboTimer = COMBO_WINDOW;

    // Charge the Power meter (from the combo points, independent of Fever).
    this._addPower(powerGain(comboPoints, s.combo) * s.petBuffs.powerMult);
    // Build the Fever gauge — quick chains fill it and trigger double points.
    this._addFever(feverGain(s.combo) * s.petBuffs.feverMult);

    if (struck) {
      const p = s.board.targetPixel(c, r);
      this.floating.spawn(p.x, p.y - 28, "⚡ ZAP!", "#9fe8ff", 30);
      Audio.powerup();
    }
    this._popCells(cells, points, cells.length, s.combo, struck ? 1.3 : 1);

    // Cascade callout: a distinct, escalating chain-reaction flourish above the
    // pop when the chain pays a cascade bonus (separate from the centre combo
    // banner so the two read as different rewards).
    if (cascade > 0) {
      const p = s.board.targetPixel(c, r);
      const ct = cascadeTier(chainLen);
      this.floating.spawn(
        p.x,
        p.y - 52,
        `🔗 ${ct ? ct.label : "Cascade"} +${cascade}`,
        "#7ef0d0",
        ct && ct.tier >= 2 ? 30 : 26
      );
      if (s.stats) s.stats.bestCascade = Math.max(s.stats.bestCascade || 0, chainLen);
    }

    if (s.stats) {
      s.stats.pops += 1;
      s.stats.bestCombo = Math.max(s.stats.bestCombo, s.combo);
    }
    this._recordProgress({
      pops: 1,
      bestCombo: s.combo,
      biggestGroup: cells.length,
    });
    if (s.mode === "campaign") s.movesLeft -= 1;
    this.refreshHud();
    this._tut("pop");
    if (struck) this._tut("lightning");
    if (s.combo >= 2) this._tut("combo");
    // Bonus objective progress: a big combo or a single large group.
    this._trackObjective({ combo: s.combo, group: group.length });
    this.afterMove();
  }

  // ---- Charged Blast (double-tap when the Power meter is full) ----------
  isBlastReady() {
    const s = this.session;
    return !!(s && !s.ended && !s.armed && s.power >= 1);
  }

  _addPower(amount) {
    const s = this.session;
    if (!s) return;
    const was = s.power;
    s.power = Math.max(0, Math.min(1, s.power + amount));
    UI.updatePower(s.power, s.power >= 1);
    if (s.power >= 1 && was < 1) {
      Audio.powerup();
      UI.toast("⚡ Charged! Double-tap to blast");
    }
  }

  // ---- Fever mode -------------------------------------------------------
  // Build the Fever gauge from chained pops; when it tops out, kick off Fever.
  _addFever(amount) {
    const s = this.session;
    if (!s || s.feverActive) return;
    s.fever = Math.max(0, Math.min(1, s.fever + amount));
    UI.updateFever(s.fever, false);
    if (s.fever >= 1) this._startFever();
  }

  // Enter Fever: a few seconds where every point earned is doubled.
  _startFever() {
    const s = this.session;
    if (!s) return;
    s.feverActive = true;
    s.feverTimer = FEVER_DURATION;
    s.fever = 1;
    UI.updateFever(1, true);
    Audio.powerup();
    UI.toast("🔥 FEVER! Double points!");
    this.floating.spawn(this.W / 2, this.H * 0.4, "FEVER ×2!", "#ff5b8a", 34);
    this._tut("fever");
    this._recordProgress({ fevers: 1 });
  }

  // ---- Achievements -----------------------------------------------------
  // Fold a progress delta into the lifetime achievement state. Progress accrues
  // automatically, but coins are NOT auto-paid: clearing a tier instead makes a
  // chest claimable on the Achievements screen. We toast when a new chest
  // becomes available. Tutorial play never counts. Returns the number of newly
  // claimable chests created by this delta.
  _recordProgress(delta) {
    const s = this.session;
    if (s && s.mode === "tutorial") return 0;
    if (this.tutorial && this.tutorial.active) return 0;
    const state = Storage.getAchievementState();
    const before = claimableCount(state.progress, state.claims);
    const progress = mergeProgress(state.progress, delta);
    Storage.setAchievementState({ progress, claims: state.claims });
    const after = claimableCount(progress, state.claims);
    const gained = after - before;
    if (gained > 0) this._announceChestReady(gained);
    UI.refreshAchievementsBadge();
    return gained;
  }

  // Toast that one or more achievement chests are ready to collect.
  _announceChestReady(count = 1) {
    Audio.coin();
    const msg =
      count > 1
        ? `🎁 ${count} reward chests ready!`
        : "🎁 Reward chest ready to collect!";
    UI.toast(msg, 2200);
  }

  // Collect the chest for a claimable category tier. Validates that a chest is
  // actually due, rolls its contents with a seeded RNG, grants the coins, tools
  // and (rarely) a pet, advances the category to the next tier and returns a
  // reward summary for the reveal UI — or null if nothing was claimable.
  claimAchievement(categoryId) {
    const cat = getCategory(categoryId);
    if (!cat) return null;
    const state = Storage.getAchievementState();
    const st = categoryStatus(cat, state.progress, state.claims);
    if (!st.claimable) return null;

    // Seeded roll, mirroring the crate-open pattern so opens are reproducible.
    this._crateSeed = ((this._crateSeed || 1) * 1664525 + 1013904223) >>> 0;
    const seed = (this._crateSeed ^ ((Date.now() >>> 0) || 1)) >>> 0;
    const rng = makeRng(seed);
    const chest = rollChest(rng, { tierIndex: st.tierIndex, coins: st.tier.coins });

    // Grant coins (guaranteed tier payout + bonus).
    const coins = chest.coins + chest.bonusCoins;
    if (coins > 0) Economy.addCoins(coins);

    // Grant power-up tools.
    const powerups = chest.powerups.map(({ id, n }) => {
      Economy.addPowerup(id, n);
      const info = POWERUP_INFO[id] || {};
      return { id, n, name: info.name || id, icon: info.icon || "✨" };
    });

    // Rarely, a pet. New pets join the collection; duplicates grant XP.
    let pet = null;
    if (chest.petRoll) {
      const { petId, premium } = rollCrate(rng);
      const isNew = Storage.grantPet(petId);
      if (!isNew) Storage.addPetXp(petId, DUP_XP);
      const def = getPet(petId) || {};
      pet = {
        id: petId,
        isNew,
        premium: !!premium,
        name: def.name || petId,
        icon: def.icon || "🐾",
        rarity: def.rarity || "common",
      };
    }

    // Advance the category: record one more claimed tier.
    const claims = { ...state.claims, [cat.id]: st.claimed + 1 };
    Storage.setAchievementState({ progress: state.progress, claims });

    UI.refreshCoins();
    UI.refreshAchievementsBadge();

    return {
      category: cat,
      tier: st.tier,
      tierIndex: st.tierIndex,
      coins,
      baseCoins: chest.coins,
      bonusCoins: chest.bonusCoins,
      powerups,
      pet,
    };
  }

  // Collect EVERY claimable achievement chest in one go. A category can have
  // several earned-but-uncollected tiers stacked up at once (e.g. a metric that
  // blew past multiple thresholds), so we keep claiming — one tier per category
  // per pass — until nothing is claimable anywhere. All the coins/tools/pets are
  // aggregated into a single reward summary for the "Collect All" reveal, and
  // returned — or null if nothing was claimable.
  claimAllAchievements() {
    const rewards = [];
    // Bounded loop: every successful claim advances a category's claimed-tier
    // count, so the claimable set strictly shrinks and this always terminates.
    for (let guard = 0; guard < 1000; guard++) {
      const state = Storage.getAchievementState();
      const ids = claimableCategories(state.progress, state.claims);
      if (!ids.length) break;
      let progressed = false;
      for (const id of ids) {
        const reward = this.claimAchievement(id);
        if (reward) {
          rewards.push(reward);
          progressed = true;
        }
      }
      if (!progressed) break; // safety: avoid spinning if a claim can't advance
    }
    if (!rewards.length) return null;
    return aggregateChestRewards(rewards);
  }

  // Claim today's login-calendar reward (idempotent per day). Returns a recap
  // object for the UI, or null when nothing is claimable right now.
  claimCalendar() {
    const key = todayKey();
    const state = Storage.get("loginCalendar");
    const st = calendarStatus(state, key);
    if (!st.claimable) return null;

    const reward = st.reward || {};
    const coins = reward.coins || 0;
    if (coins > 0) Economy.addCoins(coins);
    let powerup = null;
    if (reward.powerup) {
      Economy.addPowerup(reward.powerup, 1);
      const info = POWERUP_INFO[reward.powerup] || {};
      powerup = { id: reward.powerup, name: info.name || reward.powerup, icon: info.icon || "✨" };
    }
    let crate = 0;
    if (reward.crate) {
      Storage.addCrates(reward.crate);
      crate = reward.crate;
    }

    Storage.set("loginCalendar", advanceCalendar(state, key));

    UI.refreshCoins();
    UI.refreshCalendarBadge();

    return { index: st.index, coins, powerup, crate, day: st.day + 1 };
  }

  // ---- Season Pass ------------------------------------------------------
  // Award season XP for completing play (campaign/daily wins). Updates the
  // saved track and refreshes the menu badge. Tutorial play never counts.
  _awardSeasonXp(amount) {
    if (!amount) return;
    if (this.session && this.session.mode === "tutorial") return;
    Storage.set("season", addSeasonXp(Storage.get("season"), amount));
    UI.refreshSeasonBadge();
  }

  // Claim a reward tier on a track ("free" | "premium"). Idempotent: grants the
  // reward and records the claim only when the tier is unlocked + unclaimed
  // (and, for premium, the pass is owned). Returns a recap, or null otherwise.
  claimSeasonTier(index, track) {
    const state = Storage.get("season");
    const next = claimTier(state, index, track);
    if (!next) return null;

    const reward = tierReward(index, track) || {};
    const coins = reward.coins || 0;
    if (coins > 0) Economy.addCoins(coins);
    let powerup = null;
    if (reward.powerup) {
      Economy.addPowerup(reward.powerup, 1);
      const info = POWERUP_INFO[reward.powerup] || {};
      powerup = { id: reward.powerup, name: info.name || reward.powerup, icon: info.icon || "✨" };
    }
    let crate = 0;
    if (reward.crate) {
      Storage.addCrates(reward.crate);
      crate = reward.crate;
    }

    Storage.set("season", next);
    UI.refreshCoins();
    UI.refreshSeasonBadge();
    return { index, track, coins, powerup, crate };
  }

  // Buy the premium Season Pass (mock IAP). Unlocks the premium track so all
  // already-earned premium tiers become claimable. Returns true on success.
  async buySeasonPremium() {
    const res = await Monetization.purchase(SEASON_PREMIUM_PRODUCT);
    if (!res || !res.ok) return false;
    Storage.set("season", unlockPremium(Storage.get("season")));
    UI.refreshSeasonBadge();
    return true;
  }

  handleDoubleTap(px, py) {
    const s = this.session;
    if (!s || s.ended) return;
    this._noteActivity();
    // While aiming a magnet, any second tap just locks the gauge.
    if (s.magnet && s.magnet.aiming) {
      this.lockMagnet();
      return;
    }
    const cell = s.board.cellAtPixel(px, py);
    if (!cell) return;
    if (this.isBlastReady()) {
      this.chargedBlast(cell.c, cell.r);
    } else {
      // Not charged — behave like a normal pop.
      this.popAt(cell.c, cell.r);
    }
  }

  chargedBlast(c, r) {
    const s = this.session;
    s.preview = null;
    const cells = s.board.blastArea(c, r);
    if (!cells.length) return;
    // Record an undo snapshot (the spent charge is restored from the snapshot).
    this._pushUndo();
    s.power = 0;
    UI.updatePower(0, false);
    const points = Math.round(
      feverPoints(groupScore(Math.max(2, cells.length)), s.feverActive) *
        s.petBuffs.scoreMult
    );
    s.score += points;
    this._popCells(cells, points, cells.length, 1, 1.1);
    if (s.stats) s.stats.blasts += 1;
    Audio.powerup();
    this.floating.spawn(this.W / 2, this.H / 2, "CHARGED BLAST!", "#ff6ec7", 30);
    this.refreshHud();
    this._tut("blast");
    this.afterMove();
  }

  applyPowerup(type, c, r) {
    const s = this.session;
    let cells = [];
    if (type === "bomb") cells = s.board.bombArea(c, r);
    else if (type === "colorClear") cells = s.board.colorCells(s.board.grid[c][r]);
    else if (type === "chainBolt") cells = s.board.crossCells(c, r);
    else if (type === "pick") cells = [{ c, r }];
    if (cells.length === 0) return;

    // Tutorial mode bypasses the economy so it never spends real inventory.
    if (s.mode !== "tutorial" && !Economy.usePowerup(type)) return;
    // Record an undo snapshot, refunding the spent tool on undo.
    this._pushUndo(s.mode === "tutorial" ? null : { powerup: type });
    this._markPowerupUsed();
    const points = Math.round(
      feverPoints(groupScore(Math.max(2, cells.length)), s.feverActive) *
        s.petBuffs.scoreMult
    );
    s.score += points;
    this._popCells(cells, points, cells.length, 1, 0.6);
    if (s.stats) s.stats.powerups += 1;
    Audio.powerup();
    s.armed = null;
    UI.clearArmedPowerups();
    UI.updatePowerups();
    this.refreshHud();
    this._tut("powerup");
    this.afterMove();
  }

  // ---- Magnet: timing-gauge gather --------------------------------------
  // Step 1 (after arming 🧲): tapping a plain bubble locks the target colour
  // and starts a strength gauge that sweeps back and forth (driven by the game
  // loop). The board update loop animates `s.magnet.value`.
  beginMagnet(c, r) {
    const s = this.session;
    if (!s || s.ended) return;
    const b = s.board;
    if (b.grid[c][r] === -1 || b.isRainbow(c, r) || b.types[c][r] !== 0) {
      UI.toast("Aim the magnet at a plain bubble");
      return;
    }
    if (b.colorCells(b.grid[c][r]).length < 2) {
      UI.toast("Need more of that colour");
      return;
    }
    s.magnet = {
      c,
      r,
      color: b.grid[c][r],
      value: 0,
      dir: 1,
      aiming: true,
      // Randomise where the green sweet spot sits along the sweep so the
      // player can't just lock at the centre every time. Kept away from the
      // extremes so it's always comfortably reachable.
      sweet: 0.22 + Math.random() * 0.56,
    };
    Audio.click();
    UI.showMagnetGauge(s.magnet.sweet);
    UI.updateMagnetGauge(0);
    UI.toast("🧲 Tap to set strength — aim for green!");
  }

  // Step 2: lock the gauge. Closeness to the green centre = magnet strength, so
  // a perfect hit pulls the whole colour into one connected blob.
  lockMagnet() {
    const s = this.session;
    if (!s || !s.magnet || !s.magnet.aiming) return;
    const { c, r, color, value } = s.magnet;
    const sweet = s.magnet.sweet == null ? 0.5 : s.magnet.sweet;
    const strength = Math.max(0, 1 - Math.abs(value - sweet) / MAGNET_HALF);

    // The bubble we aimed at may have been recoloured (or cleared) while the
    // gauge swept — re-anchor onto a still-present bubble of the target colour
    // so the magnet always gathers an EXISTING colour at a valid location.
    let anchor = { c, r };
    if (
      s.board.grid[c][r] !== color ||
      s.board.types[c][r] !== 0
    ) {
      anchor = s.board.firstCellOfColor(color);
    }
    // The whole colour is gone (or down to a single bubble) — nothing useful to
    // gather. Cancel the aim without spending a charge.
    if (!anchor || s.board.colorCells(color).length < 2) {
      s.magnet = null;
      s.armed = null;
      UI.clearArmedPowerups();
      UI.hideMagnetGauge();
      UI.toast("Magnet fizzled — no bubbles to pull");
      return;
    }

    // Spend a real charge (tutorial bypasses the economy).
    if (s.mode !== "tutorial" && !Economy.usePowerup("magnet")) {
      s.magnet = null;
      s.armed = null;
      UI.clearArmedPowerups();
      UI.hideMagnetGauge();
      return;
    }

    s.magnet = null;
    s.armed = null;
    UI.clearArmedPowerups();
    UI.hideMagnetGauge();
    UI.updatePowerups();

    // Record an undo snapshot before the gather relocates bubbles; refund the
    // magnet charge on undo.
    this._pushUndo(s.mode === "tutorial" ? null : { powerup: "magnet" });
    const res = s.board.magnetGather(anchor.c, anchor.r, color, strength);
    this._markPowerupUsed();
    Audio.powerup();
    vibrate(strength > 0.85 ? 28 : 14);
    const t = s.board.targetPixel(anchor.c, anchor.r);
    const label = strength > 0.85 ? "PERFECT MAGNET!" : `MAGNET ×${res.gathered}`;
    this.floating.spawn(t.x, t.y, label, strength > 0.85 ? "#5be3ff" : "#ffffff", 28);
    if (s.stats) s.stats.powerups += 1;
    this.refreshHud();
    this._tut("magnet");
    this.afterMove();
  }

  // ---- Active pet companion actions ------------------------------------
  // Counts down the equipped pet's cooldown each move; when it fires, the pet
  // helps on the board. Never runs in the tutorial sandbox.
  _maybePetAction() {
    const s = this.session;
    if (!s || s.ended || s.mode === "tutorial") return;
    const act = s.petActive;
    if (!act) return;
    s.petTimer -= 1;
    if (s.petTimer > 0) return;
    s.petTimer = act.cooldown;
    if (act.type === "cleanse") this._petCleanse(act);
    else if (act.type === "gather") this._petGather(act);
    else if (act.type === "diagonal") this._petDiagonal(act);
    else if (act.type === "pick") this._petPick(act);
    else if (act.type === "quake") this._petQuake(act);
    else if (act.type === "cyclone") this._petCyclone(act);
    else if (act.type === "magma") this._petMagma(act);
    else if (act.type === "tidal") this._petTidal(act);
  }

  // 🐱 Whiskers: pounce on lone, hard-to-match bubbles and clear them.
  _petCleanse(act) {
    const s = this.session;
    const cells = s.board.isolatedCells().slice(0, Math.max(1, act.count));
    if (!cells.length) return;
    const raw = cells.length * 14;
    const points = Math.round(
      feverPoints(raw, s.feverActive) * s.petBuffs.scoreMult
    );
    s.score += points;
    // Pet ability flourish over the cleared bubbles.
    const targets = cells.map((cell) => s.board.targetPixel(cell.c, cell.r));
    const anchor = targets.reduce(
      (a, t) => ({ x: a.x + t.x / targets.length, y: a.y + t.y / targets.length }),
      { x: 0, y: 0 }
    );
    this.petAnim.play({
      kind: "cleanse",
      icon: this._equippedPetIcon("🐱"),
      anchor,
      targets,
      color: "#9be7ff",
    });
    this._popCells(cells, points, cells.length, 1, 0.6);
    Audio.powerup();
    this.floating.spawn(anchor.x, anchor.y - 36, "Pounce!", "#9be7ff", 26);
    this.refreshHud();
  }

  // 🐶 Rover: fetch a whole colour together into one connected blob to pop.
  _petGather(act) {
    const s = this.session;
    const color = s.board.dominantColor();
    if (color === null || color === undefined) return;
    const anchor = s.board.firstCellOfColor(color);
    if (!anchor) return;
    // Snapshot the scattered cells of this colour BEFORE gathering so the
    // animation can reel them toward the anchor.
    const before = s.board.cellsOfColor
      ? s.board.cellsOfColor(color)
      : [];
    const res = s.board.magnetGather(anchor.c, anchor.r, color, act.strength);
    if (!res || res.gathered <= 1) return;
    const anchorPx = s.board.targetPixel(anchor.c, anchor.r);
    const cells = (before.length ? before : [anchor]).slice(0, 14);
    const targets = cells.map((cell) => s.board.targetPixel(cell.c, cell.r));
    this.petAnim.play({
      kind: "gather",
      icon: this._equippedPetIcon("🐶"),
      anchor: anchorPx,
      targets,
      // Track the live board: if the player pops the anchor or any of these
      // bubbles while the leash is still reeling, the animation re-homes to the
      // surviving bubbles instead of pulling toward an emptied cell.
      board: s.board,
      anchorCell: anchor,
      cells,
      color: "#ffd35b",
    });
    Audio.powerup();
    this.floating.spawn(anchorPx.x, anchorPx.y - 36, "Fetch!", "#ffd35b", 26);
    this.refreshHud();
  }

  // ☄️ Comet: blast the longest diagonal streak of one colour clean off the
  // board — a line the orthogonal flood-fill behind tapping can never clear.
  _petDiagonal(act) {
    const s = this.session;
    const cells = s.board.diagonalRun(3);
    if (cells.length < 3) return;
    const raw = cells.length * 16;
    const points = Math.round(
      feverPoints(raw, s.feverActive) * s.petBuffs.scoreMult
    );
    s.score += points;
    const targets = cells.map((cell) => s.board.targetPixel(cell.c, cell.r));
    const anchor = targets.reduce(
      (a, t) => ({ x: a.x + t.x / targets.length, y: a.y + t.y / targets.length }),
      { x: 0, y: 0 }
    );
    this.petAnim.play({
      kind: "diagonal",
      icon: this._equippedPetIcon("☄️"),
      anchor,
      targets,
      color: "#ffd35b",
    });
    this._popCells(cells, points, cells.length, 1, 0.7);
    Audio.powerup();
    this.floating.spawn(anchor.x, anchor.y - 36, "Streak!", "#ffd35b", 26);
    this.refreshHud();
  }

  // 🦅 Talon: hunt the MOST isolated bubbles and pick them off one by one.
  // Each bubble stays on the board until the hawk's beak actually reaches it,
  // then it's destroyed in that beat's `onHit` — so Talon never pecks an empty
  // cell. Gravity settles and the board is re-evaluated once, in `onDone`, when
  // the whole flourish ends (afterMove defers its checks via `session.petPicking`).
  _petPick(act) {
    const s = this.session;
    const cells = s.board.mostIsolatedCells(Math.max(1, act.count));
    if (!cells.length) return;
    // Capture each target's resting pixel + colour up front. Crucially, the
    // bubbles are NOT removed yet — the hawk destroys each one exactly when its
    // beak reaches it (see onHit below), and gravity only settles once the whole
    // flourish ends (onDone). This guarantees Talon always pecks a bubble that
    // actually exists, instead of stabbing at an empty cell whose bubble was
    // already cleared and dropped away.
    const pixels = cells.map((cell) => s.board.targetPixel(cell.c, cell.r));
    const palette = this.theme.bubbles;
    const hexes = cells.map((cell) => {
      const ci = s.board.grid[cell.c][cell.r];
      const idx = ((ci % palette.length) + palette.length) % palette.length;
      return palette[idx] || "#ffd35b";
    });
    const raw = cells.length * 16;
    const points = Math.round(
      feverPoints(raw, s.feverActive) * s.petBuffs.scoreMult
    );
    s.score += points;
    // The pick now resolves the board itself when the animation finishes, so
    // afterMove must defer win/deadlock checks until then (guarded by this flag).
    s.petPicking = true;
    const anchor = pixels.reduce(
      (a, t) => ({ x: a.x + t.x / pixels.length, y: a.y + t.y / pixels.length }),
      { x: 0, y: 0 }
    );
    this.petAnim.play({
      kind: "pick",
      icon: this._equippedPetIcon("🦅"),
      anchor,
      targets: pixels,
      color: "#ffd35b",
      onHit: (i) => {
        const cell = cells[i];
        const t = pixels[i];
        if (!cell || !t) return;
        // Destroy the bubble right as the beak lands on it — but only if it's
        // still there (it may have been popped by the player mid-flourish).
        if (s.board && s.board.grid[cell.c][cell.r] !== -1) {
          s.board.forceRemove(cell.c, cell.r);
          if (s.stats) s.stats.cleared += 1;
        }
        this.particles.burst(t.x, t.y, hexes[i] || "#ffd35b", 12, 0.7);
        this.particles.sparkle(t.x, t.y, "#ffffff", 6);
        this.shake.add(0.12);
        Audio.pop(1, 2);
        vibrate(8);
      },
      onDone: () => {
        // All pecks have landed: drop everything into place, then let the board
        // resolve normally (win / deadlock / next pet action).
        if (s.board) s.board.settle();
        s.petPicking = false;
        this.refreshHud();
        this.afterMove();
      },
    });
    this.floating.spawn(anchor.x, anchor.y - 36, "Pick!", "#ffd35b", 26);
    this.refreshHud();
  }

  // 🌍 Quake: a board-wide tremor that resettles every bubble so identical
  // colours land together in big connected groups — a fresh batch of matches
  // for the player to pop (a "match-maker", not a destroyer).
  _petQuake(act) {
    const s = this.session;
    const changed = s.board.quakeRegroup();
    if (!changed.length) return;
    const anchor = {
      x: s.board.originX + s.board.boardW / 2,
      y: s.board.originY + s.board.boardH / 2,
    };
    const targets = changed
      .slice(0, 16)
      .map((cell) => s.board.targetPixel(cell.c, cell.r));
    this.petAnim.play({
      kind: "cleanse",
      icon: this._equippedPetIcon("🌍"),
      anchor,
      targets,
      color: "#c9a16b",
    });
    this.shake.add(0.5);
    Audio.powerup();
    vibrate(24);
    this.floating.spawn(anchor.x, anchor.y - 36, "Quake!", "#c9a16b", 28);
    this.refreshHud();
  }

  // 🌪️ Cyclone: a targeted vortex that sorts each column by colour into tall,
  // ready-to-pop vertical runs (another match-maker, not a destroyer).
  _petCyclone(act) {
    const s = this.session;
    const changed = s.board.cycloneSort();
    if (!changed.length) return;
    const targets = changed
      .slice(0, 16)
      .map((cell) => s.board.targetPixel(cell.c, cell.r));
    const anchor = targets.reduce(
      (a, t) => ({ x: a.x + t.x / targets.length, y: a.y + t.y / targets.length }),
      { x: 0, y: 0 }
    );
    this.petAnim.play({
      kind: "gather",
      icon: this._equippedPetIcon("🌪️"),
      anchor,
      targets,
      color: "#8fe3ff",
    });
    Audio.powerup();
    this.floating.spawn(anchor.x, anchor.y - 36, "Cyclone!", "#8fe3ff", 28);
    this.refreshHud();
  }

  // 🌋 Magma: a volcanic eruption that clears the fullest vertical lane(s)
  // outright. The number of lanes grows as the pet levels up.
  _petMagma(act) {
    const s = this.session;
    const n = Math.max(1, Math.round(act.count || 1));
    const cols = s.board.fullestColumns(n);
    let cells = [];
    for (const c of cols) cells = cells.concat(s.board.columnCells(c));
    if (!cells.length) return;
    const raw = cells.length * 15;
    const points = Math.round(
      feverPoints(raw, s.feverActive) * s.petBuffs.scoreMult
    );
    s.score += points;
    const targets = cells.map((cell) => s.board.targetPixel(cell.c, cell.r));
    const anchor = targets.reduce(
      (a, t) => ({ x: a.x + t.x / targets.length, y: a.y + t.y / targets.length }),
      { x: 0, y: 0 }
    );
    this.petAnim.play({
      kind: "diagonal",
      icon: this._equippedPetIcon("🌋"),
      anchor,
      targets,
      color: "#ff7a3c",
    });
    this._popCells(cells, points, cells.length, 1, 1.1);
    Audio.powerup();
    this.floating.spawn(anchor.x, anchor.y - 36, "Magma!", "#ff7a3c", 28);
    this.refreshHud();
  }

  // 🌊 Tidal: a flood that wipes every bubble of the board's dominant colour
  // off in one mighty wave.
  _petTidal(act) {
    const s = this.session;
    const color = s.board.dominantColor();
    if (color === null || color === undefined) return;
    const cells = s.board.cellsOfColor(color);
    if (cells.length < 2) return;
    const raw = cells.length * 15;
    const points = Math.round(
      feverPoints(raw, s.feverActive) * s.petBuffs.scoreMult
    );
    s.score += points;
    const targets = cells.map((cell) => s.board.targetPixel(cell.c, cell.r));
    const anchor = targets.reduce(
      (a, t) => ({ x: a.x + t.x / targets.length, y: a.y + t.y / targets.length }),
      { x: 0, y: 0 }
    );
    this.petAnim.play({
      kind: "cleanse",
      icon: this._equippedPetIcon("🌊"),
      anchor,
      targets,
      color: "#3fb6ff",
    });
    this._popCells(cells, points, cells.length, 1, 1.2);
    Audio.powerup();
    this.floating.spawn(anchor.x, anchor.y - 36, "Tidal Wave!", "#3fb6ff", 30);
    this.refreshHud();
  }

  // ---- Premium Nova gunship hits ---------------------------------------
  // The gunship's cannon reaches the lowest bubble in a column and blasts it.
  // Returns true if a bubble was destroyed.
  _shipHitColumn(c) {
    const s = this.session;
    if (!s || s.ended) return false;
    const cell = s.board.bottomBubble(c);
    if (!cell) return false;
    const points = Math.round(
      feverPoints(12, s.feverActive) * s.petBuffs.scoreMult
    );
    s.score += points;
    this._popCells([cell], points, 1, 1, 0.5);
    if (s.stats) s.stats.shipHits = (s.stats.shipHits || 0) + 1;
    this.refreshHud();
    this._afterShip();
    return true;
  }

  // A levelled-up gunship periodically drops a nuke: an area blast that clears
  // the bottom bubbles across a few columns around its current position.
  _shipNuke(centerCol) {
    const s = this.session;
    if (!s || s.ended) return;
    const cells = s.board.bottomBlock(centerCol, 1, 2);
    if (!cells.length) return;
    const raw = cells.length * 18;
    const points = Math.round(
      feverPoints(raw, s.feverActive) * s.petBuffs.scoreMult
    );
    s.score += points;
    this._popCells(cells, points, cells.length, 1, 1.2);
    if (s.stats) s.stats.shipHits = (s.stats.shipHits || 0) + cells.length;
    const px = s.board.targetPixel(centerCol, s.board.rows - 1);
    this.floating.spawn(px.x, px.y - 30, "NUKE!", "#ff7bf0", 30);
    Audio.powerup();
    this.refreshHud();
    this._afterShip();
  }

  // Re-evaluate the board after a gunship blast. The ship only ends the level by
  // clearing the board (a win); it never triggers the deadlock/rescue or
  // out-of-moves loss paths — those stay driven by the player's own moves.
  _afterShip() {
    const s = this.session;
    if (!s || s.ended) return;
    if (s.board.isCleared()) {
      s.score += clearBonus(Math.max(0, s.movesLeft));
      this._scheduleEnd(true, "cleared");
    }
  }

  // Icon of the currently equipped pet (falls back to a default emoji).
  _equippedPetIcon(fallback) {
    const eq = Storage.getEquippedPet && Storage.getEquippedPet();
    if (eq && eq.id) {
      const def = PET_CATALOG.find((p) => p.id === eq.id);
      if (def && def.icon) return def.icon;
    }
    return fallback;
  }

  _popCells(cells, points, groupSize, combo, shakePower = 1) {
    const s = this.session;
    const fx = s.board.removeCells(cells, this.theme);
    if (s.stats) s.stats.cleared += fx.length;
    // A neighbouring pop shattered a locked stone bubble — let the tutorial's
    // stone step advance, no matter which pop path triggered it.
    if (fx.stonesBroken) this._tut("stone");
    // Pick one of five escalating explosion styles by group size — the bigger
    // the group, the more impactful the animation (more particles, then rings,
    // a flash bloom and a sparkle shower at the top end).
    const style = popStyleForGroup(groupSize);
    this._lastPopStyle = style.style;
    let cx = 0,
      cy = 0;
    let centreHex = "#ffffff";
    for (const f of fx) {
      const hex = this.theme.bubbles[f.colorIndex % this.theme.bubbles.length];
      centreHex = hex;
      this.particles.burst(f.x, f.y, hex, style.perCell, style.power * shakePower);
      cx += f.x;
      cy += f.y;
    }
    if (fx.length) {
      cx /= fx.length;
      cy /= fx.length;
      // Expanding shockwave rings at the group's centre, escalating with style.
      for (let i = 0; i < style.rings; i++) {
        this.particles.ring(cx, cy, centreHex, {
          maxRadius: 46 + groupSize * 6 + i * 28,
          width: 5 - i,
          life: 0.42 + i * 0.12,
        });
      }
      // The biggest pops add a soft white flash bloom and a sparkle shower.
      if (style.flash) {
        this.particles.ring(cx, cy, "#ffffff", {
          maxRadius: 38 + groupSize * 3,
          life: 0.26,
          fill: true,
        });
      }
      if (style.sparkle) this.particles.sparkle(cx, cy, centreHex, style.sparkle);
      const big = groupSize >= 6;
      this.floating.spawn(cx, cy, `+${points}`, big ? "#ffd35b" : "#ffffff", big ? 32 : 26);
    }
    s.board.settle();

    Audio.pop(combo, groupSize);
    vibrate(groupSize >= 8 ? 30 : groupSize >= 5 ? 24 : 12);
    this.shake.add(Math.min(0.6, 0.08 + groupSize * 0.02) * shakePower * (style.flash ? 1.3 : 1));

    if (combo >= 2) {
      const t = comboTier(combo);
      if (t) UI.showCombo(`${t.label}! ×${combo}`, t.className);
    }
  }

  // ---- Power-up arming --------------------------------------------------
  armPowerup(type, btn) {
    const s = this.session;
    const inTutorial = s.mode === "tutorial";
    if (!inTutorial && Economy.getPowerup(type) <= 0) {
      // Out of this tool — take the player straight to the shop with it already
      // highlighted so they can stock up, then return to the level.
      UI.openShopForPowerup(type);
      return;
    }
    if (type === "shuffle") {
      if (!inTutorial) Economy.usePowerup(type);
      this._markPowerupUsed();
      this._pushUndo(inTutorial ? null : { powerup: "shuffle" });
      s.board.shuffle();
      Audio.powerup();
      UI.updatePowerups();
      UI.toast("Shuffled!");
      this.afterMove();
      return;
    }
    // Toggle arm for targeted power-ups.
    if (s.armed === type) {
      s.armed = null;
      if (s.magnet) {
        s.magnet = null;
        UI.hideMagnetGauge();
      }
      UI.clearArmedPowerups();
    } else {
      s.armed = type;
      if (s.magnet) {
        s.magnet = null;
        UI.hideMagnetGauge();
      }
      UI.clearArmedPowerups();
      if (btn) btn.classList.add("armed");
      const hint = {
        bomb: "Tap to drop bomb",
        colorClear: "Tap a color to clear it",
        chainBolt: "Tap to fire a row + column bolt",
        pick: "Tap a single bubble to remove it",
        magnet: "Tap a plain bubble to aim the magnet",
      }[type];
      UI.toast(hint || "Tap the board");
    }
  }

  // ---- End-of-move evaluation ------------------------------------------
  afterMove() {
    if (this.session) {
      // Any resolved move resets the idle-hint timer.
      this.session.idleTime = 0;
      this.session.hint = null;
    }
    const s = this.session;
    // The tutorial is a sandbox: it never wins, loses, or persists — but it
    // must never strand the player either. Top the practice board back up
    // whenever they've popped it down low (or run out of moves) so there are
    // always fresh clusters to keep trying the gestures on.
    if (s.mode === "tutorial") {
      if (!s.board.hasMoves() || s.board.countRemaining() <= s.board.cols) {
        this._refillTutorialBoard();
      }
      return;
    }
    if (!s || s.ended) return;
    // A last-bubble finale is mid-flight; it will resolve the board itself.
    if (s.finishing) return;
    // Talon's pick is mid-flourish (bubbles are being pecked off one by one). It
    // will settle gravity and call afterMove() again itself when it finishes, so
    // skip win/deadlock checks — and don't let another pet action fire over it.
    if (s.petPicking) return;

    // Active pet companions physically help on the board every few moves
    // (gathering a colour, or zapping isolated bubbles) before we evaluate the
    // board state — so their help counts toward the win/deadlock checks below.
    this._maybePetAction();

    // _maybePetAction may have just launched Talon's pick (async). If so, defer
    // the rest until its onDone re-runs afterMove on the settled board.
    if (s.petPicking) return;

    // A single un-poppable bubble is left: rather than strand the player on a
    // jam (a lone bubble can never form a group of 2+), give it a celebratory
    // glow-and-explode finale — one of several random styles — that clears the
    // board, then let the normal clear logic resolve the level.
    if (s.board.countRemaining() === 1 && !this.finale.active) {
      this._startLastBubbleFinale();
      return;
    }

    if (s.board.isCleared()) {
      if (s.mode === "endless") {
        // Reward and refill for continuous play.
        const bonus = clearBonus(0);
        s.score += bonus;
        this.floating.spawn(this.W / 2, this.H / 2, "BOARD CLEAR!", "#5bff9b", 30);
        s.board = new Board(8, 11, 5, (Math.random() * 1e9) | 0, {
          rainbow: 0.04,
          ice: 0.07,
        });
        s.board.layout(this.W, this.H, TOP_INSET, this._bottomInset());
        this.refreshHud();
        return;
      }
      // Campaign / daily: clearing the board wins with a bonus.
      s.score += clearBonus(Math.max(0, s.movesLeft));
      this._scheduleEnd(true, "cleared");
      return;
    }

    const deadlock = this._isDeadlocked();

    // The board is playable again (e.g. a Pick made bubbles fall into matches):
    // clear any rescue state so a future jam re-shows the friendly prompt.
    if (!deadlock) {
      s.rescuing = false;
      s.gaveUp = false;
    }

    if (s.mode === "campaign") {
      if (s.level.milestone === "boss") {
        // Boss objective: shatter the entire frozen core before moves run out.
        if (s.board.frozenRemaining() === 0) {
          s.score += clearBonus(Math.max(0, s.movesLeft));
          this._scheduleEnd(true, "boss");
          return;
        }
        if (s.movesLeft <= 0 || deadlock) {
          // Lone-bubble jam: offer the Pick rescue before failing the boss.
          if (deadlock && this._offerIsolatedRescue()) return;
          this._scheduleEnd(false, "bossfail");
          return;
        }
      } else if (s.movesLeft <= 0 || deadlock) {
        const won = s.score >= s.level.target;
        // If the board jammed on un-poppable lone bubbles and the player hasn't
        // hit the target yet, offer the Pick tool instead of losing outright.
        if (!won && deadlock && this._offerIsolatedRescue()) return;
        this._scheduleEnd(won, won ? "target" : "fail");
      }
    } else if (s.mode === "endless") {
      if (deadlock) {
        if (this._offerIsolatedRescue()) return;
        this._scheduleEnd(false, "gameover");
      }
    } else if (s.mode === "daily") {
      if (deadlock) this._scheduleEnd(true, "daily");
    } else if (s.mode === "tournament") {
      if (deadlock) this._scheduleEnd(true, "tournament");
    } else if (s.mode === "timeattack") {
      // The clock — not the board — ends Time Attack, so keep play flowing: a
      // deadlocked board refills with fresh bubbles instead of ending the run.
      if (deadlock && !s.ended) {
        s.board.refill();
        UI.toast("Board refilled — keep popping!");
      }
    }

    // Save the in-progress campaign so it can be resumed later.
    this._persistSession();
  }

  // ---- Lone-bubble rescue (isolated single bubbles) ---------------------
  // True when the board is genuinely stuck: no tap-match exists AND no swipe the
  // player can still afford would realign bubbles into a fresh match. Row shifts
  // are real moves, so the level must never be declared deadlocked while a
  // useful swipe (and a move/token to spend on it) is still available.
  _isDeadlocked() {
    const s = this.session;
    if (s.board.hasMoves()) return false;
    const canShift =
      s.mode === "campaign" ? s.movesLeft > 0 : s.shiftTokens > 0;
    if (canShift && s.board.hasShiftMove()) return false;
    return true;
  }

  // When the board jams on single bubbles that can't be popped normally, we
  // don't strand or instantly fail the player: we surface a friendly prompt
  // pointing them at the Pick 🔨 tool (which removes one bubble at a time).
  // Returns true when the rescue takes over the deadlock (caller must NOT end
  // the level); false to let the level end normally.
  _offerIsolatedRescue() {
    const s = this.session;
    if (!s || s.ended) return false;
    if (s.gaveUp) return false; // player already chose to end this jam
    if (s.board.isCleared()) return false; // nothing to rescue

    if (s.rescuing) {
      // Already rescuing: keep the level alive so the player can keep using
      // Pick. Only re-surface the prompt if they can no longer act.
      if (!this._canRescue()) this._showIsolatedHelp();
      return true;
    }
    s.rescuing = true;
    this._showIsolatedHelp();
    return true;
  }

  // The deadlock is escapable if the player owns a Pick or can afford to buy one.
  _canRescue() {
    return (
      Economy.getPowerup("pick") > 0 ||
      Economy.coins >= POWERUP_INFO.pick.price
    );
  }

  _showIsolatedHelp() {
    const s = this.session;
    if (!s) return;
    this.input.setEnabled(false); // the prompt takes over until dismissed
    const pickCount = Economy.getPowerup("pick");
    UI.showIsolatedHelp({
      pickCount,
      canBuy: pickCount <= 0 && Economy.coins >= POWERUP_INFO.pick.price,
      pickPrice: POWERUP_INFO.pick.price,
    });
  }

  // "Use Pick" — buy one if needed, then arm it so the next tap clears a lone
  // bubble. The player stays in the level (rescue mode) until the board clears,
  // they hit the target, or they give up.
  _rescueWithPick() {
    const s = this.session;
    if (!s) return;
    if (Economy.getPowerup("pick") <= 0) {
      if (!Economy.buyPowerup("pick")) {
        UI.toast("Not enough coins for a Pick");
        return;
      }
      UI.updatePowerups();
      UI.refreshCoins();
    }
    UI.hideIsolatedHelp();
    UI.showHud(true);
    this.input.setEnabled(true);
    this.armPowerup("pick");
    UI.toast("Tap a lone bubble to remove it 🔨");
  }

  // "Give Up" — stop rescuing and let the level end with its natural outcome.
  _giveUpRescue() {
    const s = this.session;
    if (!s) return;
    s.gaveUp = true;
    s.rescuing = false;
    UI.hideIsolatedHelp();
    this.afterMove(); // re-evaluate: rescue is declined, so the level ends
  }

  // ---- Last-bubble finale ----------------------------------------------
  // Kick off the glow-then-explode finale for the single remaining bubble. A
  // random explosion style is chosen. Input is suspended while it plays; when
  // it finishes the (now empty) board resolves the level via afterMove().
  _startLastBubbleFinale() {
    const s = this.session;
    const cell = s.board.firstFilledCell();
    if (!cell) return;
    s.finishing = true;
    this.input.setEnabled(false);
    this.alienShip.stop();
    const px = s.board.targetPixel(cell.c, cell.r);
    const palette = this.theme.bubbles;
    const ci = s.board.grid[cell.c][cell.r];
    const hex = palette[((ci % palette.length) + palette.length) % palette.length] || "#ffffff";
    const radius = s.board.cell * 0.46;
    const variant = (Math.random() * BUBBLE_FINALE_VARIANTS) | 0;
    s.finaleVariant = variant; // exposed for inspection / tests
    Audio.powerup();
    this.finale.play({
      x: px.x,
      y: px.y,
      radius,
      color: hex,
      variant,
      onExplode: (v) => this._lastBubbleExplode(cell, v, px, hex),
      onDone: () => this._lastBubbleResolve(),
    });
  }

  // The blast moment: force-clear the final bubble and fire a variant-flavoured
  // particle burst, screen shake, and sound on top of the drawn explosion.
  _lastBubbleExplode(cell, variant, px, hex) {
    const s = this.session;
    if (!s) return;
    s.board.forceRemove(cell.c, cell.r);
    s.board.settle();
    this._finaleParticles(variant, px.x, px.y, hex);
    this.shake.add(0.5);
    vibrate(30);
    Audio.pop(4, 8);
    this.floating.spawn(px.x, px.y - 30, "CLEAR!", "#ffd35b", 30);
  }

  // Particle flavour per explosion style (the drawn shapes live in BubbleFinale).
  _finaleParticles(variant, x, y, hex) {
    const white = "#ffffff";
    switch (variant) {
      case 0: // supernova
        this.particles.burst(x, y, white, 26, 1.6);
        this.particles.burst(x, y, hex, 22, 1.2);
        break;
      case 1: // shockwave
        this.particles.burst(x, y, hex, 18, 1.4);
        this.particles.sparkle(x, y, white, 16);
        break;
      case 2: // starburst
        this.particles.burst(x, y, hex, 24, 1.1);
        this.particles.sparkle(x, y, hex, 14);
        break;
      case 3: // flash bloom
        this.particles.sparkle(x, y, white, 22);
        this.particles.burst(x, y, hex, 14, 0.9);
        break;
      default: // firework
        this.particles.burst(x, y, white, 16, 1.8);
        this.particles.sparkle(x, y, hex, 18);
        break;
    }
  }

  // The finale finished: the board is empty, so re-enable input and let the
  // standard clear logic decide the outcome (campaign/daily win, or endless
  // board-clear refill).
  _lastBubbleResolve() {
    const s = this.session;
    if (!s) return;
    s.finishing = false;
    this.input.setEnabled(true);
    this.afterMove();
  }

  _scheduleEnd(won, reason) {
    const s = this.session;
    s.ended = true;
    s.rescuing = false;
    UI.hideIsolatedHelp();
    this.input.setEnabled(false);
    UI.clearFallingEvents();
    this.alienShip.stop();
    this.activeEvent = false;
    clearTimeout(this._endTimer);
    this._endTimer = setTimeout(() => this._finish(won, reason), 480);
  }

  async _finish(won, reason) {
    const s = this.session;
    this._clearActiveSession();

    if (s.mode === "campaign") {
      if (won) {
        const stars = Math.max(1, starsForScore(s.level, s.score));
        Storage.recordLevelResult(s.level.id, stars);
        // Per-level personal best: celebrate when the player beats their prior
        // best for this level (first clears don't count as a "new best").
        const bestInfo = Storage.recordLevelScore(s.level.id, s.score);
        const coins = Math.round(coinReward(s.score, stars) * s.petBuffs.coinMult);

        // Milestone rewards are paid only on the first clear so they can never
        // be farmed by replaying. Score coins above still apply every time.
        const mtype = s.level.milestone;
        const rewardBits = [];
        if (bestInfo.isNewBest) rewardBits.push("🏆 New best score!");
        let bonusCoins = 0;
        if (mtype && Storage.recordMilestone(s.level.id)) {
          if (mtype === "treasure") {
            const tr = treasureReward(s.level.id);
            bonusCoins = tr.bonus;
            Economy.addPowerup(tr.powerup, 1);
            const info = POWERUP_INFO[tr.powerup];
            rewardBits.push(`🎁 +${tr.bonus} bonus coins`);
            rewardBits.push(`Free ${info.icon} ${info.name}`);
            // Treasure milestones also drop a pet crate.
            Storage.addCrates(1);
            rewardBits.push(`🐾 Pet Crate`);
          } else if (mtype === "boss") {
            const br = bossReward(s.level.id);
            bonusCoins = br.jackpot;
            rewardBits.push(`👹 Boss jackpot +${br.jackpot} coins`);
            if (br.theme && Storage.grantTheme(br.theme)) {
              rewardBits.push(`🎨 Theme unlocked: ${getTheme(br.theme).name}`);
            }
          }
          if (bonusCoins) Economy.addCoins(bonusCoins);
        }

        // Bonus objective: pay extra coins if the level's optional challenge
        // was met. "nopowerup" resolves from the usedPowerup flag at finish;
        // combo/group objectives latch during play. Purely additive reward.
        let objectiveBonus = 0;
        if (s.objective) {
          const met =
            s.objective.type === "nopowerup" ? !s.usedPowerup : s.objectiveMet;
          if (met) {
            objectiveBonus = s.objective.bonus;
            Economy.addCoins(objectiveBonus);
            rewardBits.push(`🎯 Objective: +${objectiveBonus} coins`);
          }
        }

        const totalCoins = coins + bonusCoins + objectiveBonus;
        s.coinsEarned = totalCoins;
        Economy.addCoins(coins);
        const petBit = this._awardPetXp();
        if (petBit) rewardBits.push(petBit);
        this._recordProgress({
          levelsCleared: Storage.get("maxUnlockedLevel") - 1,
          totalStars: Storage.totalStars(),
          coinsEarned: totalCoins,
        });
        // Season Pass XP scales with the star result of the clear.
        this._awardSeasonXp(30 + stars * 15);
        Audio.win();
        UI.setWinTitle(
          mtype === "boss"
            ? "Boss Defeated!"
            : mtype === "treasure"
            ? "Treasure Cleared!"
            : reason === "cleared"
            ? "Board Cleared!"
            : "Level Clear!"
        );
        UI.showWin({
          stars,
          score: s.score,
          coins: totalCoins,
          rewardText: rewardBits.join("  •  "),
          stats: this._winStats(s, s.level.moves - s.movesLeft),
          showNext: s.level.id < LEVEL_COUNT,
          showDouble: !Monetization.isAdsRemoved(),
        });
        await Monetization.maybeShowInterstitial(s.level.id);
      } else {
        Audio.lose();
        UI.showLose({
          score: s.score,
          showRevive: !s.revived,
          title: s.movesLeft <= 0 ? "Out of Moves" : "No Moves Left",
        });
      }
    } else if (s.mode === "endless") {
      const prevBest = Storage.get("highScoreEndless");
      if (s.score > prevBest) Storage.set("highScoreEndless", s.score);
      const coins = Math.round(Math.floor(s.score / 200) * s.petBuffs.coinMult);
      Economy.addCoins(coins);
      this._awardPetXp();
      this._awardSeasonXp(Math.min(60, 10 + Math.floor(s.score / 800)));
      Audio.lose();
      UI.showLose({
        score: s.score,
        showRevive: !s.revived,
        title: s.score > prevBest ? "New Best!" : "Game Over",
      });
    } else if (s.mode === "daily") {
      const goals = s.goals || getDailyGoals(s.level);
      const stars = dailyStarsForScore(goals, s.score);
      const info = recordDaily(s.score, stars);
      // Score coins plus the streak-cycle reward (only on the first play/day).
      const coins =
        Math.round(Math.floor(s.score / 150) * s.petBuffs.coinMult) +
        (info.coins || 0);
      s.coinsEarned = coins;
      Economy.addCoins(coins);
      this._awardSeasonXp(40);
      Audio.win();
      UI.setWinTitle("Daily Complete");
      const bits = [`Streak ${info.streak}🔥`];
      if (info.freezeAwarded) bits.push("❄️ Freeze earned!");
      else if (info.usedFreeze) bits.push("❄️ Freeze used");
      const petBit = this._awardPetXp();
      if (petBit) bits.push(petBit);
      const moves = s.stats
        ? s.stats.pops + s.stats.swipes + s.stats.blasts + s.stats.powerups
        : 0;
      UI.showWin({
        stars,
        score: s.score,
        coins,
        stats: this._winStats(s, moves),
        rewardText: bits.join("  •  "),
        showNext: false,
        showDouble: !Monetization.isAdsRemoved(),
      });
    } else if (s.mode === "tournament") {
      const goals = s.goals || getTournamentGoals(s.level);
      const rank = tournamentRank(goals, s.score);
      const info = recordTournament(s.score);
      const coins = Math.round(Math.floor(s.score / 150) * s.petBuffs.coinMult);
      s.coinsEarned = coins;
      Economy.addCoins(coins);
      this._awardSeasonXp(40);
      Audio.win();
      UI.setWinTitle(info.isNewBest ? "New Weekly Best!" : "Tournament Run");
      const bits = [`${rank.icon} ${rank.label}`, `Best ${info.best}`];
      const petBit = this._awardPetXp();
      if (petBit) bits.push(petBit);
      const moves = s.stats
        ? s.stats.pops + s.stats.swipes + s.stats.blasts + s.stats.powerups
        : 0;
      UI.showWin({
        stars: rank.tier === 0 ? 1 : Math.min(3, rank.tier),
        score: s.score,
        coins,
        stats: this._winStats(s, moves),
        rewardText: bits.join("  •  "),
        showNext: false,
        showDouble: !Monetization.isAdsRemoved(),
      });
    } else if (s.mode === "timeattack") {
      const prevBest = Storage.get("highScoreTimeAttack");
      const isNewBest = s.score > prevBest;
      if (isNewBest) Storage.set("highScoreTimeAttack", s.score);
      const coins = Math.round(Math.floor(s.score / 150) * s.petBuffs.coinMult);
      s.coinsEarned = coins;
      Economy.addCoins(coins);
      this._awardSeasonXp(30);
      Audio.win();
      UI.setWinTitle("Time's Up!");
      const stars = s.score >= 6000 ? 3 : s.score >= 3000 ? 2 : 1;
      const bits = [
        isNewBest && prevBest > 0 ? "🏆 New Best!" : `Best ${Math.max(prevBest, s.score)}`,
      ];
      const petBit = this._awardPetXp();
      if (petBit) bits.push(petBit);
      const moves = s.stats
        ? s.stats.pops + s.stats.swipes + s.stats.blasts + s.stats.powerups
        : 0;
      UI.showWin({
        stars,
        score: s.score,
        coins,
        stats: this._winStats(s, moves),
        rewardText: bits.join("  •  "),
        showNext: false,
        showDouble: !Monetization.isAdsRemoved(),
      });
    }
    UI.refreshCoins();
  }

  // Build the recap stat rows shown on the level-complete window.
  _winStats(s, movesUsed) {
    const st = s.stats || this._newStats();
    return [
      { label: "Moves", value: Math.max(0, movesUsed) },
      { label: "Swipes", value: st.swipes },
      { label: "Best Combo", value: "×" + Math.max(1, st.bestCombo) },
      { label: "Popped", value: st.cleared },
    ];
  }

  // ---- Modal actions ----------------------------------------------------
  nextLevel() {
    const s = this.session;
    if (s && s.mode === "campaign") this.startCampaign(s.level.id + 1);
  }

  retryLevel() {
    const s = this.session;
    if (!s) return this.quitToMenu();
    if (s.mode === "campaign") this.startCampaign(s.level.id);
    else if (s.mode === "endless") this.startEndless();
    else if (s.mode === "timeattack") this.startTimeAttack();
    else if (s.mode === "tournament") this.startTournament();
    else this.startDaily();
  }

  async reviveLevel() {
    const s = this.session;
    if (!s) return;
    const ok = await Monetization.showRewardedAd("a revive");
    if (!ok) return;
    s.revived = true;
    s.ended = false;
    UI.hideModals();
    UI.showHud(true);
    this.input.setEnabled(true);
    if (s.mode === "campaign") {
      s.movesLeft += 5;
      UI.toast("+5 moves!");
    } else {
      s.board.shuffle();
      UI.toast("Board shuffled — keep going!");
    }
    this.refreshHud();
    this._persistSession();
  }

  async doubleCoins() {
    const s = this.session;
    if (!s || s.doubled) return;
    const ok = await Monetization.showRewardedAd("double coins");
    if (!ok) return;
    s.doubled = true;
    Economy.addCoins(s.coinsEarned);
    UI.refreshCoins();
    UI.bumpWinCoins(s.coinsEarned * 2);
    UI.toast(`+${s.coinsEarned} bonus coins!`);
    document.getElementById("win-double").style.display = "none";
  }

  // Back during the tutorial just exits the tutorial cleanly.
  quitToMenu() {
    if (this.tutorial && this.tutorial.active) {
      this.tutorial.skip();
      return;
    }
    clearTimeout(this._endTimer);
    // Keep the in-progress campaign snapshot so the player can resume it;
    // it is only cleared when the level is actually finished.
    this._persistSession();
    this.session = null;
    this.input.setEnabled(false);
    UI.clearFallingEvents();
    this.alienShip.stop();
    Audio.stopMusic();
    this.activeEvent = false;
    UI.showScreen("menu");
  }

  // ---- Main loop --------------------------------------------------------
  update(dt) {
    this.shake.update(dt);
    this.particles.update(dt);
    this.floating.update(dt);
    this.petAnim.update(dt);
    this.finale.update(dt);
    if (this.session && !this.paused) {
      this.session.board.update(dt);
      // Time Attack: drain the clock; when it hits zero the run ends (the score
      // banked so far is the result).
      if (this.session.mode === "timeattack" && !this.session.ended) {
        this.session.timeLeft = Math.max(0, this.session.timeLeft - dt);
        this.refreshHud();
        if (this.session.timeLeft <= 0) {
          this._scheduleEnd(true, "timeattack");
        }
      }
      if (this.session.combo > 0) {
        this.session.comboTimer -= dt;
        if (this.session.comboTimer <= 0) this.session.combo = 0;
      }
      // Drain the Fever timer; the gauge empties over the duration and Fever
      // ends when it runs out.
      if (this.session.feverActive) {
        this.session.feverTimer -= dt;
        const frac = Math.max(0, this.session.feverTimer / FEVER_DURATION);
        UI.updateFever(frac, true);
        if (this.session.feverTimer <= 0) {
          this.session.feverActive = false;
          this.session.fever = 0;
          UI.updateFever(0, false);
        }
      }
      // Sweep the magnet strength gauge back and forth while aiming.
      const m = this.session.magnet;
      if (m && m.aiming) {
        const speed = 1.7; // full sweeps per second-ish
        m.value += m.dir * speed * dt;
        if (m.value >= 1) {
          m.value = 1;
          m.dir = -1;
        } else if (m.value <= 0) {
          m.value = 0;
          m.dir = 1;
        }
        UI.updateMagnetGauge(m.value);
      }
      // Drive the premium Nova gunship (real-time auto-shooter) while play is
      // live. It performs its destruction through the same pop/score path as a
      // manual move, so scoring and win-detection stay consistent.
      if (this.alienShip.active && !this.session.ended) {
        this.alienShip.update(dt, this.session.board, {
          hitColumn: (c) => this._shipHitColumn(c),
          nuke: (c) => this._shipNuke(c),
        });
      }
      this._updateEvents(dt);
      this._updateHint(dt);
    }
  }

  // ---- Idle-hint assist -------------------------------------------------
  // Clear any pending hint and reset the idle timer (called on every input).
  _noteActivity() {
    const s = this.session;
    if (!s) return;
    s.idleTime = 0;
    s.hint = null;
  }

  // After HINT_DELAY seconds of inactivity, surface the largest poppable group
  // as a gentle nudge. Suppressed in the tutorial, when disabled, or while the
  // player is mid-gesture (arming, previewing, aiming, or chaining a combo).
  _updateHint(dt) {
    const s = this.session;
    if (!s || s.ended || s.mode === "tutorial") return;
    if (!this.hintsEnabled) {
      s.hint = null;
      return;
    }
    if (s.armed || s.preview || (s.magnet && s.magnet.aiming) || s.combo > 0) {
      s.idleTime = 0;
      s.hint = null;
      return;
    }
    s.idleTime = (s.idleTime || 0) + dt;
    if (s.idleTime >= HINT_DELAY && !s.hint) {
      s.hint = s.board.findHint();
    }
  }

  // ---- Falling gift/problem events --------------------------------------
  // Count down to the next token and spawn one when ready. Suspended during
  // the tutorial (eventTimer === Infinity), once a session has ended, and
  // while the magnet gauge is being aimed (its overlay would hide the token).
  _updateEvents(dt) {
    const s = this.session;
    if (!s || s.ended || s.mode === "tutorial") return;
    if (this.activeEvent) return;
    if (s.magnet && s.magnet.aiming) return;
    if (this.eventTimer === Infinity) return;
    this.eventTimer -= dt;
    if (this.eventTimer <= 0) this._spawnEvent();
  }

  // Roll and drop a new token. `forced` ("gift"|"problem") is used by tests.
  _spawnEvent(forced) {
    const s = this.session;
    if (!s || s.ended) return;
    this.activeEvent = true;
    const type = forced || pickEventType();
    const desc = { type };
    if (type === EVENT_GIFT) desc.reward = rollGiftReward();
    // Kept as a handle so deterministic tests can pin the reward before a tap.
    this._activeEventDesc = desc;
    UI.spawnFallingEvent(
      { type, leftPct: 15 + Math.random() * 70, fallTime: EVENT_FALL_TIME },
      {
        onTap: () => this._onEventTap(desc),
        onMiss: () => this._onEventMiss(desc),
      }
    );
  }

  // Public test hook: force-spawn a specific event type immediately.
  spawnEvent(type) {
    if (this.activeEvent) UI.clearFallingEvents();
    this.activeEvent = false;
    this._spawnEvent(type === EVENT_PROBLEM ? EVENT_PROBLEM : EVENT_GIFT);
  }

  _resolveEvent() {
    this.activeEvent = false;
    this.eventTimer = nextEventDelay();
  }

  _onEventTap(desc) {
    const s = this.session;
    if (!s || s.ended) {
      this._resolveEvent();
      return;
    }
    const cx = this.W / 2;
    const cy = this.H * 0.42;
    if (desc.type === EVENT_PROBLEM) {
      // Defused in time: small relief reward, no scatter.
      Economy.addCoins(DEFUSE_REWARD);
      this.floating.spawn(cx, cy, `DEFUSED +${DEFUSE_REWARD}`, "#5be3ff", 28);
      this.particles.burst(cx, cy, "#5be3ff", 16, 0.6);
      UI.toast(`⚠️ Defused! +${DEFUSE_REWARD} coins`);
      Audio.powerup();
      this._recordProgress({ defuses: 1 });
    } else {
      const reward = desc.reward || rollGiftReward();
      if (reward.type === "crate") {
        Storage.addCrates(1);
        this.floating.spawn(cx, cy, "🎁 Pet Crate!", "#c9a3ff", 28);
        UI.toast("🎁 Gift: a Pet Crate! Open it in the Pets menu");
      } else if (reward.type === "powerup") {
        Economy.addPowerup(reward.powerup, 1);
        UI.updatePowerups();
        const name = (POWERUP_INFO[reward.powerup] || {}).name || "Power-up";
        this.floating.spawn(cx, cy, `+1 ${name}`, "#5bff9b", 28);
        UI.toast(`🎁 Gift: +1 ${name}!`);
      } else {
        Economy.addCoins(reward.coins);
        this.floating.spawn(cx, cy, `+${reward.coins}`, "#ffd35b", 30);
        UI.toast(`🎁 Gift: +${reward.coins} coins!`);
      }
      this.particles.burst(cx, cy, "#ffd35b", 22, 0.8);
      Audio.powerup();
    }
    this.refreshHud();
    vibrate(20);
    this._tut("event");
    this._resolveEvent();
  }

  _onEventMiss(desc) {
    const s = this.session;
    if (s && !s.ended && desc.type === EVENT_PROBLEM) {
      // A problem left to fall scatters nearby bubbles, breaking up groups.
      const board = s.board;
      const anchor = board.randomFilledCell();
      if (anchor) {
        const cells = board.scatterArea(anchor.c, anchor.r, SCATTER_COUNT);
        for (const cell of cells) {
          const t = board.targetPixel(cell.c, cell.r);
          this.particles.burst(t.x, t.y, "#ff4d63", 10, 0.7);
        }
        this.shake.add(0.3);
        UI.toast("⚠️ Bubbles scattered!");
        Audio.lose();
        vibrate(40);
      }
    }
    this._resolveEvent();
  }

  render(time) {
    const ctx = this.ctx;
    this.renderer.drawBackground(this.W, this.H, this.theme, time);
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    if (this.session) {
      this.renderer.drawBoardFrame(this.session.board);
      // While aiming a magnet, shake the target-colour bubbles harder the
      // closer the gauge needle is to the (randomised) green sweet spot.
      let aim = null;
      const m = this.session.magnet;
      if (m && m.aiming) {
        const sweet = m.sweet == null ? 0.5 : m.sweet;
        const closeness = Math.max(0, 1 - Math.abs(m.value - sweet) / MAGNET_HALF);
        aim = { color: m.color, intensity: closeness, time };
      }
      this.renderer.drawBubbles(this.session.board, this.theme, aim);
      if (this.session.preview) {
        this.renderer.drawPreview(
          this.session.board,
          this.session.preview,
          this.theme
        );
      } else if (this.session.hint) {
        this.renderer.drawHint(this.session.board, this.session.hint, time);
      }
    }
    this.finale.draw(ctx, time);
    this.particles.draw(ctx);
    this.floating.draw(ctx);
    this.petAnim.draw(ctx);
    if (this.alienShip.active) this.alienShip.draw(ctx);
    ctx.restore();
  }

  loop(time) {
    const dt = Math.min(0.05, (time - this.lastTime) / 1000 || 0);
    this.lastTime = time;
    this.update(dt);
    this.render(time);
    requestAnimationFrame((t) => this.loop(t));
  }
}

const game = new Game();
game.init();

// Test hook: expose internals ONLY when explicitly requested via `?e2e=1`.
// Production sessions (no query param) are unaffected and stay clean.
if (typeof location !== "undefined" && /(?:\?|&)e2e=1\b/.test(location.search)) {
  window.__bpc = {
    game,
    Storage,
    Economy,
    Monetization,
    UI,
    getLevel,
    pets: { petBuffs, petActive, levelForXp, rollCrate, rollLegendaryCrate, getPet },
    calendar: { calendarStatus, advanceCalendar, todayKey },
    season: { seasonStatus, addSeasonXp, claimTier, tierReward },
    popStyle: popStyleForGroup,
    cascade: { cascadeBonus, cascadeTier },
    tournament: { getTournamentLevel, getTournamentGoals, tournamentRank, getTournamentBest },
    timeattack: { seconds: TIME_ATTACK_SECONDS },
    Audio,
  };
}
