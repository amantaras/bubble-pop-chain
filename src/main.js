// Game orchestrator: canvas loop, state machine, and all session logic.
import { Board, RAINBOW, ICE } from "./grid.js";
import { Renderer } from "./renderer.js";
import { ParticleSystem } from "./particles.js";
import { ScreenShake, FloatingText, PetAnim } from "./animations.js";
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
  clearBonus,
  starsForScore,
  coinReward,
  powerGain,
  feverGain,
  feverPoints,
  FEVER_DURATION,
} from "./scoring.js";
import { Economy, POWERUP_INFO } from "./economy.js";
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
  newlyUnlocked,
  coinsForAchievements,
  getAchievement,
} from "./achievements.js";
import {
  petBuffs,
  neutralBuffs,
  petActive,
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
import { makeRng } from "./rng.js";

const TOP_INSET = 168;
const BOTTOM_INSET = 120;
const COMBO_WINDOW = 1.6; // seconds before a combo resets
// Magnet gauge: half-width of the green "sweet" band, in gauge units (0..1).
// Strength tapers from 1 (dead on the sweet spot) to 0 at this distance.
// Widened from 0.2 → 0.3 so the green zone is more forgiving to lock onto.
const MAGNET_HALF = 0.3;

class Game {
  constructor() {
    this.canvas = document.getElementById("game-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.renderer = new Renderer(this.ctx);
    this.renderer.colorblind = !!(Storage.get("settings") || {}).colorblind;
    this.particles = new ParticleSystem();
    this.floating = new FloatingText();
    this.shake = new ScreenShake();
    this.petAnim = new PetAnim();
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
      onThemeChange: (t) => {
        this.theme = t;
      },
      onColorblindChange: (on) => {
        this.renderer.colorblind = !!on;
      },
      openCrate: () => this.openCrate(),
      buyCrate: () => this.buyCrate(),
      buyLegendaryCrate: () => this.buyLegendaryCrate(),
      equipPet: (id) => this.equipPet(id),
      buyPremiumPet: (id) => this.buyPremiumPet(id),
      buyCosmetic: (petId, cos) => this.buyCosmetic(petId, cos),
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
      preview: null,
      power: buffs.startCharge,
      petBuffs: buffs,
      petActive: active,
      petTimer: active ? active.cooldown : 0,
      shiftTokens: mode === "campaign" ? 0 : 5,
      stats: this._newStats(),
      bossCoreTotal,
    };
    this._enterSession();
    if (mode === "campaign") this._persistSession();
  }

  // Shared UI/state setup used by both fresh and resumed sessions.
  _enterSession() {
    const board = this.session.board;
    this.session.magnet = null;
    board.layout(this.W, this.H, TOP_INSET, this._bottomInset());
    this.particles.particles.length = 0;
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
    this.input.setEnabled(true);
    this.refreshHud();
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
      shiftTokens: 0,
      stats: snap.stats || this._newStats(),
      bossCoreTotal: snap.bossCoreTotal || board.frozenRemaining(),
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

  startDaily() {
    const lvl = getDailyLevel();
    this._newSession("daily", lvl);
    this.session.movesLeft = 9999;
    this.session.goals = getDailyGoals(lvl);
    const mod = lvl.modifier;
    if (alreadyPlayedToday()) {
      UI.toast(`Replaying today • Streak ${getStreak()}🔥`);
    } else if (mod) {
      UI.toast(`Today: ${mod.label} — ${mod.desc}`);
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
      shiftTokens: 99,
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
    Storage.set("firstRunDone", true);
    this.session = null;
    this.input.setEnabled(false);
    UI.showScreen("menu");
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

  // Purchase a premium pet via the (mock) IAP provider, then grant it.
  async buyPremiumPet(id) {
    const pet = getPet(id);
    if (!pet || !pet.premium) return false;
    const res = await Monetization.purchase(pet.product || `pet_${id}`);
    if (!res || !res.ok) return false;
    Storage.grantPet(id);
    return true;
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
    } else if (kind === "event") {
      this._spawnTutorialEvent();
    }
    // "bomb": tutorial bypasses the economy (see armPowerup/applyPowerup).
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

  // ---- HUD --------------------------------------------------------------
  refreshHud() {
    const s = this.session;
    if (!s) return;
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

    if (!s.board.shiftRow(r, dir)) return; // empty row — nothing to shift

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

    // Score with combo multiplier.
    const base = groupScore(group.length);
    const mult = comboMultiplier(s.combo);
    const comboPoints = Math.round(base * mult);
    const points = Math.round(
      feverPoints(comboPoints, s.feverActive) * s.petBuffs.scoreMult
    );
    s.score += points;
    s.combo += 1;
    s.comboTimer = COMBO_WINDOW;

    // Charge the Power meter (from the combo points, independent of Fever).
    this._addPower(powerGain(comboPoints, s.combo) * s.petBuffs.powerMult);
    // Build the Fever gauge — quick chains fill it and trigger double points.
    this._addFever(feverGain(s.combo) * s.petBuffs.feverMult);

    this._popCells(group, points, group.length, s.combo);

    if (s.stats) {
      s.stats.pops += 1;
      s.stats.bestCombo = Math.max(s.stats.bestCombo, s.combo);
    }
    this._recordProgress({
      pops: 1,
      bestCombo: s.combo,
      biggestGroup: group.length,
    });
    if (s.mode === "campaign") s.movesLeft -= 1;
    this.refreshHud();
    this._tut("pop");
    if (s.combo >= 2) this._tut("combo");
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
  // Fold a progress delta into the lifetime achievement state, unlock any
  // badges that newly qualify, pay their one-time coin rewards and announce
  // them. Tutorial play never counts toward achievements. Returns the list of
  // newly unlocked ids.
  _recordProgress(delta) {
    const s = this.session;
    if (s && s.mode === "tutorial") return [];
    if (this.tutorial && this.tutorial.active) return [];
    const state = Storage.getAchievementState();
    const progress = mergeProgress(state.progress, delta);
    const fresh = newlyUnlocked(progress, state.unlocked);
    const unlocked = state.unlocked.concat(fresh);
    Storage.setAchievementState({ unlocked, progress });
    if (fresh.length) {
      const coins = coinsForAchievements(fresh);
      if (coins > 0) Economy.addCoins(coins);
      fresh.forEach((id, i) => this._announceAchievement(getAchievement(id), i));
      UI.refreshCoins();
    }
    return fresh;
  }

  // Toast an unlocked badge. Multiple simultaneous unlocks are spaced out so
  // each is readable.
  _announceAchievement(ach, index = 0) {
    if (!ach) return;
    const show = () => {
      Audio.coin();
      UI.toast(`🏆 ${ach.icon} ${ach.name}  +${ach.coins}`, 2000);
    };
    if (index === 0) show();
    else setTimeout(show, index * 2100);
  }

  handleDoubleTap(px, py) {
    const s = this.session;
    if (!s || s.ended) return;
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

    const res = s.board.magnetGather(c, r, color, strength);
    Audio.powerup();
    vibrate(strength > 0.85 ? 28 : 14);
    const t = s.board.targetPixel(c, r);
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
    const targets = (before.length ? before : [anchor])
      .map((cell) => s.board.targetPixel(cell.c, cell.r))
      .slice(0, 14);
    this.petAnim.play({
      kind: "gather",
      icon: this._equippedPetIcon("🐶"),
      anchor: anchorPx,
      targets,
      color: "#ffd35b",
    });
    Audio.powerup();
    this.floating.spawn(anchorPx.x, anchorPx.y - 36, "Fetch!", "#ffd35b", 26);
    this.refreshHud();
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
    let cx = 0,
      cy = 0;
    for (const f of fx) {
      const hex = this.theme.bubbles[f.colorIndex % this.theme.bubbles.length];
      this.particles.burst(f.x, f.y, hex, 10 + Math.min(groupSize, 14), shakePower);
      cx += f.x;
      cy += f.y;
    }
    if (fx.length) {
      cx /= fx.length;
      cy /= fx.length;
      const big = groupSize >= 6;
      this.floating.spawn(cx, cy, `+${points}`, big ? "#ffd35b" : "#ffffff", big ? 32 : 26);
    }
    s.board.settle();

    Audio.pop(combo, groupSize);
    vibrate(groupSize >= 5 ? 24 : 12);
    this.shake.add(Math.min(0.5, 0.08 + groupSize * 0.02) * shakePower);

    if (combo >= 2) {
      UI.showCombo(`Combo ×${combo}!`);
    }
  }

  // ---- Power-up arming --------------------------------------------------
  armPowerup(type, btn) {
    const s = this.session;
    const inTutorial = s.mode === "tutorial";
    if (!inTutorial && Economy.getPowerup(type) <= 0) {
      UI.toast("None left — buy in Shop");
      return;
    }
    if (type === "shuffle") {
      if (!inTutorial) Economy.usePowerup(type);
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

    // Active pet companions physically help on the board every few moves
    // (gathering a colour, or zapping isolated bubbles) before we evaluate the
    // board state — so their help counts toward the win/deadlock checks below.
    this._maybePetAction();

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

    const deadlock = !s.board.hasMoves();

    if (s.mode === "campaign") {
      if (s.level.milestone === "boss") {
        // Boss objective: shatter the entire frozen core before moves run out.
        if (s.board.frozenRemaining() === 0) {
          s.score += clearBonus(Math.max(0, s.movesLeft));
          this._scheduleEnd(true, "boss");
          return;
        }
        if (s.movesLeft <= 0 || deadlock) {
          this._scheduleEnd(false, "bossfail");
          return;
        }
      } else if (s.movesLeft <= 0 || deadlock) {
        const won = s.score >= s.level.target;
        this._scheduleEnd(won, won ? "target" : "fail");
      }
    } else if (s.mode === "endless") {
      if (deadlock) this._scheduleEnd(false, "gameover");
    } else if (s.mode === "daily") {
      if (deadlock) this._scheduleEnd(true, "daily");
    }

    // Save the in-progress campaign so it can be resumed later.
    this._persistSession();
  }

  _scheduleEnd(won, reason) {
    const s = this.session;
    s.ended = true;
    this.input.setEnabled(false);
    UI.clearFallingEvents();
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
        const coins = Math.round(coinReward(s.score, stars) * s.petBuffs.coinMult);

        // Milestone rewards are paid only on the first clear so they can never
        // be farmed by replaying. Score coins above still apply every time.
        const mtype = s.level.milestone;
        const rewardBits = [];
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

        const totalCoins = coins + bonusCoins;
        s.coinsEarned = totalCoins;
        Economy.addCoins(coins);
        const petBit = this._awardPetXp();
        if (petBit) rewardBits.push(petBit);
        this._recordProgress({
          levelsCleared: Storage.get("maxUnlockedLevel") - 1,
          totalStars: Storage.totalStars(),
          coinsEarned: totalCoins,
        });
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
    this.activeEvent = false;
    UI.showScreen("menu");
  }

  // ---- Main loop --------------------------------------------------------
  update(dt) {
    this.shake.update(dt);
    this.particles.update(dt);
    this.floating.update(dt);
    this.petAnim.update(dt);
    if (this.session) {
      this.session.board.update(dt);
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
      this._updateEvents(dt);
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
      }
    }
    this.particles.draw(ctx);
    this.floating.draw(ctx);
    this.petAnim.draw(ctx);
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
  };
}
