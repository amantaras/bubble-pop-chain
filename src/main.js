// Game orchestrator: canvas loop, state machine, and all session logic.
import { Board, NORMAL, RAINBOW, ICE, LIGHTNING, STONE, BOMB, MULTIPLIER, COIN, VINE } from "./grid.js";
import { Renderer, themeMotif } from "./renderer.js";
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
import {
  Economy,
  POWERUP_INFO,
  STARTER_PACK,
  isPowerupUnlocked,
  lockedPowerupRewardCoins,
  powerupUnlockLevel,
  powerupsUnlockedBetween,
  resolveRewardForUnlocks,
} from "./economy.js";
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
  PROBLEM_EFFECT_FREEZE,
  PROBLEM_EFFECT_MOVES,
  PROBLEM_EFFECT_SCATTER,
  PROBLEM_EFFECT_SHUFFLE,
  PROBLEM_EFFECT_VINE,
  nextEventDelay,
  pickEventType,
  rollProblemEffect,
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
  isPetFeatureUnlocked,
  petFeaturesUnlockedBetween,
  PET_XP_PER_LEVEL,
  DUP_XP,
  CRATE_COST,
  LEGENDARY_CRATE,
  PET_CATALOG,
  PET_FEATURE_GRANTS,
  pityRarityFloor,
  nextPity,
  dustValue,
  PITY_EPIC,
  PITY_LEGENDARY,
  rollTrait,
  getTrait,
  TRAITS,
  partyBuffs,
  partyTotalBuffs,
  activeSynergies,
  SYNERGIES,
  SUPPORT_SLOTS,
} from "./pets.js";
import {
  GEM_CATALOG,
  GEM_TIERS,
  socketsForLevel,
  socketBuffs,
  socketActiveMods,
  rollGem,
  gemDustCost,
  gemKey,
  getGemDef,
  getGemTier,
  parseGemKey,
  gemLabel,
  canSocketGemAtLevel,
  maxGemTierForLevel,
  levelForGemTier,
  socketDustCost,
  unsocketDustRefund,
  MAX_SOCKETS,
  FUSE_COUNT,
  nextGemTier,
  prevGemTier,
  canFuseTier,
  fusedGemKey,
} from "./gems.js";
import {
  TECH_TREE,
  techNode,
  techTierOf,
  pendingTechTier,
  hasPendingTech,
  canPickTech,
  techTiersUnlocked,
} from "./tech.js";
import { calendarStatus, advanceCalendar } from "./calendar.js";
import {
  ensureQuests,
  applyQuestProgress,
  claimQuest,
  questsClaimable,
} from "./quests.js";
import {
  piggyDeposit,
  canCrackPiggy,
  PIGGY_CRACK_PRODUCT,
} from "./piggy.js";
import {
  getPuzzle,
  puzzleStars,
  isPuzzleUnlocked,
  PUZZLE_COUNT,
} from "./puzzle.js";
import {
  seasonStatus,
  addSeasonXp,
  claimTier,
  tierReward,
  unlockPremium,
  SEASON_PREMIUM_PRODUCT,
} from "./season.js";
import { makeRng, todayKey, weekKey } from "./rng.js";
const TOP_INSET = 168;
const BOTTOM_INSET = 120;
const COMBO_WINDOW = 1.6; // seconds before a combo resets
// Seconds of inactivity before the idle "hint" assist highlights a valid move.
const HINT_DELAY = 5;
// Charged-blast cue stays visible while charge is ready so the recommended
// double-tap target remains obvious until the player spends it.
const BLAST_CUE_DURATION = Infinity;
// Magnet gauge: half-width of the green "sweet" band, in gauge units (0..1).
// Strength tapers from 1 (dead on the sweet spot) to 0 at this distance.
// Widened from 0.2 → 0.3 so the green zone is more forgiving to lock onto.
const MAGNET_HALF = 0.3;
// How many of every power-up the tutorial temporarily loads so the player can
// experiment freely with each tool. The player's real, larger stashes are
// never reduced (we top up to at least this many) and are restored afterwards.
const TUTORIAL_TOOL_STOCK = 10;
// Undo keeps only a small recent rewind history. The number of times a player
// can use it comes from the Undo tool stock in the economy.
const UNDO_STACK_LIMIT = 3;

// Time Attack: a fast score-rush mode where the board refills endlessly and the
// only limit is the clock. Players chase a personal best within the window.
const TIME_ATTACK_SECONDS = 60;
const SCREEN_TIME_SECONDS = 180;
const EVENT_BOARD_IDLE_GRACE = 8;

// Coins dropped per treasure "coin" bubble cleared in a pop (outside the
// tutorial, which never touches the real economy).
const COIN_BUBBLE_VALUE = 12;

// Downpour relief: every successful rain tick grants one extra move, regardless
// of how many bubbles were added in that drop.
const DOWNPOUR_MOVES_PER_DROP = 1;

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
    this._pendingToolUnlock = null;
    this._pendingToolUnlocks = [];
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
      startPuzzle: (i) => this.startPuzzle(i),
      quitToMenu: () => this.quitToMenu(),
      resumeCampaign: () => this.resumeCampaign(),
      armPowerup: (type, btn) => this.armPowerup(type, btn),
      nextLevel: () => this.nextLevel(),
      retryLevel: () => this.retryLevel(),
      reviveLevel: () => this.reviveLevel(),
      doubleCoins: () => this.doubleCoins(),
      claimWinChoice: (id) => this.claimWinChoice(id),
      winRewardsSettled: () => this._showPendingProgressUnlock(),
      suggestLoadout: () => this.suggestLoadout(),
      choosePaintColor: (color) => this.confirmPaintColor(color),
      cancelPaint: () => this.cancelPaint(),
      startTutorial: () => this.startTutorial(),
      tutorialNext: () => this.tutorial && this.tutorial.next(),
      tutorialSkip: () => this.tutorial && this.tutorial.skip(),
      toolUnlockContinue: () => this._continueAfterToolUnlock(),
      undoMove: () => this.undoMove(),
      isTutorial: () => this.session && this.session.mode === "tutorial",
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
      onReducedMotionChange: (on) => {
        this._applyReducedMotion(on);
      },
      openCrate: () => this.openCrate(),
      buyCrate: () => this.buyCrate(),
      buyLegendaryCrate: () => this.buyLegendaryCrate(),
      equipPet: (id) => this.equipPet(id),
      toggleSupport: (id) => this.toggleSupport(id),
      craftGem: (type, tier) => this.craftGem(type, tier),
      fuseGem: (key) => this.fuseGem(key),
      forgeTier: (type, tier) => this.forgeTier(type, tier),
      socketGem: (petId, slot, key) => this.socketGem(petId, slot, key),
      unsocketGem: (petId, slot) => this.unsocketGem(petId, slot),
      pickPetTech: (petId, nodeId) => this.pickPetTech(petId, nodeId),
      petHasPendingTech: (petId) => this.petHasPendingTech(petId),
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
      claimQuest: (scope, index) => this.claimQuestReward(scope, index),
      claimSeasonTier: (index, track) => this.claimSeasonTier(index, track),
      buySeasonPremium: () => this.buySeasonPremium(),
      buyStarterPack: () => this.buyStarterPack(),
      crackPiggy: () => this.crackPiggy(),
    });

    this.input = new Input(this.canvas, {
      onTap: (x, y) => this.handleTap(x, y),
      onDoubleTap: (x, y) => this.handleDoubleTap(x, y),
      onDragStart: (x, y) => this.handleDragStart(x, y),
      onDragMove: (x0, y0, x1, y1) => this.handleDragMove(x0, y0, x1, y1),
      onDragEnd: (x0, y0, x1, y1) => this.handleDragEnd(x0, y0, x1, y1),
      onLongPressStart: (x, y) => this.previewAt(x, y),
      onLongPressMove: (x, y) => this.previewAt(x, y),
      onLongPressEnd: (x, y) => this.commitPreview(x, y),
      onSwipe: (dir, x0, y0, x1, y1) => this.handleSwipe(dir, x0, y0, x1, y1),
      shouldDeferTap: () => this.isBlastReady(),
    });
    this.input.setEnabled(false);

    // Apply the saved reduced-motion accessibility setting (gates screen shake,
    // particle volume, and large CSS animations).
    this._applyReducedMotion(!!(Storage.get("settings") || {}).reducedMotion);

    // Unlock audio on first interaction.
    const unlock = () => {
      Audio.unlock();
      window.removeEventListener("pointerdown", unlock);
    };
    window.addEventListener("pointerdown", unlock);

    window.addEventListener("resize", () => this.resize());
    this.resize();
    const finishStartup = () => {
      UI.showScreen("menu");
      UI.hideSplash();

      // Recover the real inventory if a previous tutorial was interrupted (e.g.
      // the page was reloaded mid-tutorial) before it could restore the snapshot.
      this._restoreTutorialInventory();

      // First-time players are walked through the interactive tutorial.
      if (!Storage.get("firstRunDone")) {
        this.startTutorial();
      }
    };

    if (this._shouldShowStartupSplash()) {
      UI.showSplash();
      window.setTimeout(() => UI.finishSplash(), this._startupSplashDuration());
      window.setTimeout(finishStartup, this._startupSplashDuration() + 420);
    } else {
      finishStartup();
    }

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () =>
        navigator.serviceWorker.register("sw.js").catch(() => {})
      );
    }

    requestAnimationFrame((t) => this.loop(t));
  }

  _shouldShowStartupSplash() {
    const params = new URLSearchParams(window.location.search);
    const e2e = params.has("e2e");
    return !e2e || params.has("splash");
  }

  _startupSplashDuration() {
    const params = new URLSearchParams(window.location.search);
    return params.has("e2e") ? 180 : 1350;
  }

  // Apply the reduced-motion accessibility setting. When on: screen shake is
  // disabled, particle bursts emit far fewer particles (and skip shockwave
  // rings), and a body class neutralises large CSS animations. Honoured live
  // from the Themes-screen toggle and at startup from the saved setting.
  _applyReducedMotion(on) {
    this.reducedMotion = !!on;
    this.shake.motionScale = this.reducedMotion ? 0 : 1;
    this.particles.motionScale = this.reducedMotion ? 0.45 : 1;
    this.renderer.reducedMotion = this.reducedMotion;
    if (typeof document !== "undefined" && document.body)
      document.body.classList.toggle("reduced-motion", this.reducedMotion);
    UI.reducedMotion = this.reducedMotion;
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

  // Build the party roster (lead + support pets) as petBuffs/partyBuffs members.
  _partyMembers() {
    if (!isPetFeatureUnlocked("pets", Storage.get("maxUnlockedLevel"))) return [];
    const members = [];
    const eq = Storage.getEquippedPet();
    const socketsUnlocked = isPetFeatureUnlocked("gems", Storage.get("maxUnlockedLevel"));
    const techUnlocked = isPetFeatureUnlocked("tech", Storage.get("maxUnlockedLevel"));
    if (eq) members.push({ id: eq.id, level: levelForXp(eq.xp || 0), trait: eq.trait, sockets: socketsUnlocked ? Storage.getSockets(eq.id) : [], tech: techUnlocked ? Storage.getPetTech(eq.id) : [], role: "lead" });
    if (!isPetFeatureUnlocked("party", Storage.get("maxUnlockedLevel"))) return members;
    for (const id of Storage.getPartySupports()) {
      if (!Storage.ownsPet(id) || id === (eq && eq.id)) continue;
      members.push({
        id,
        level: levelForXp((Storage.getPetState().owned[id] || {}).xp || 0),
        trait: Storage.getPetTrait(id),
        sockets: socketsUnlocked ? Storage.getSockets(id) : [],
        tech: techUnlocked ? Storage.getPetTech(id) : [],
        role: "support",
      });
    }
    return members;
  }

  // The combined passive buffs from the whole party (lead + supports) including
  // any matched set synergies. Neutral when no pet is equipped.
  _equippedBuffs() {
    const members = this._partyMembers();
    if (!members.length) return neutralBuffs();
    return partyTotalBuffs(members);
  }

  // The synergies currently active for the player's party (for HUD/UI).
  _activeSynergies() {
    return activeSynergies(this._partyMembers());
  }

  // The active board action the equipped pet performs (or null for passive pets).
  _equippedActive() {
    if (!isPetFeatureUnlocked("abilities", Storage.get("maxUnlockedLevel"))) return null;
    const eq = Storage.getEquippedPet();
    if (!eq) return null;
    const sockets = isPetFeatureUnlocked("gems", Storage.get("maxUnlockedLevel")) ? Storage.getSockets(eq.id) : [];
    const tech = isPetFeatureUnlocked("tech", Storage.get("maxUnlockedLevel")) ? Storage.getPetTech(eq.id) : [];
    return petActive(eq.id, levelForXp(eq.xp || 0), eq.trait, sockets, tech);
  }

  // Roll a fresh personality trait for a newly-acquired pet, advancing the
  // shared crate seed so each grant gets a different (seeded) trait.
  _rollPetTrait() {
    this._crateSeed = ((this._crateSeed || 1) * 1664525 + 1013904223) >>> 0;
    const seed = (this._crateSeed ^ ((Date.now() >>> 0) || 1)) >>> 0;
    return rollTrait(makeRng(seed));
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
    if (after > before) {
      // A level-up may unlock a new tech-tree tier to pick.
      const tech = Storage.getPetTech(eq.id);
      const pick = hasPendingTech(tech, after) ? " — pick an upgrade in Pets!" : "";
      return `🐾 ${name} reached Lv.${after}!${pick}`;
    }
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
    // Boss levels seed an archetype objective that must be met to win.
    let bossCoreTotal = 0;
    let bossKind = null;
    let bossTargetColor = -1;
    if (mode === "campaign" && level.milestone === "boss" && level.boss) {
      const cfg = level.boss;
      bossKind = cfg.kind;
      if (cfg.kind === "stone") {
        bossCoreTotal = board.placeStoneVault(cfg.vaultW, cfg.vaultH);
      } else if (cfg.kind === "color") {
        const dc = board.dominantColor();
        bossTargetColor = dc == null ? -1 : dc;
        bossCoreTotal =
          bossTargetColor >= 0 ? board.colorCells(bossTargetColor).length : 0;
      } else {
        bossCoreTotal = board.placeFrozenCore(cfg.coreW, cfg.coreH);
      }
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
      archerAim: null,
      shiftTokens: mode === "campaign" || mode === "puzzle" ? 0 : 5,
      stats: this._newStats(),
      bossCoreTotal,
      bossKind,
      bossTargetColor,
      objective: (mode === "campaign" && level.objective) || null,
      objectiveMet: false,
      usedPowerup: false,
      undoStack: [],
      undosLeft: 0,
      // Downpour (advanced campaign levels): a fresh row drops from the top
      // every `interval` resolved moves; `movesSinceDrop` paces that cadence.
      downpour: (mode === "campaign" && level.downpour) || null,
      movesSinceDrop: 0,
      // Time Attack countdown (seconds). Unused by other modes.
      timeLeft: mode === "timeattack" ? TIME_ATTACK_SECONDS : 0,
      screenTimeLeft: this._screenTimeLimit(mode, level),
      screenTimeShown: Math.ceil(this._screenTimeLimit(mode, level)),
      boardInteracted: false,
      boardIdleTime: EVENT_BOARD_IDLE_GRACE + 1,
    };
    this._enterSession();
    if (mode === "campaign") this._persistSession();
  }

  _screenTimeLimit(mode, level = {}) {
    if (mode === "campaign")
      return level.milestone === "boss" ? SCREEN_TIME_SECONDS + 30 : SCREEN_TIME_SECONDS;
    if (mode === "puzzle") return 150;
    if (mode === "daily" || mode === "tournament") return SCREEN_TIME_SECONDS;
    return 0;
  }

  // Shared UI/state setup used by both fresh and resumed sessions.
  _enterSession() {
    const board = this.session.board;
    this._pendingToolUnlock = null;
    this._pendingToolUnlocks = [];
    this.session.magnet = null;
    this.session.paint = null;
    this.session.archerAim = null;
    this.paused = false;
    board.layout(this.W, this.H, TOP_INSET, this._bottomInset());
    this.particles.particles.length = 0;
    this.particles.rings.length = 0;
    this.floating.items.length = 0;
    UI.hideScreens();
    UI.hideModals();
    UI.clearRescueTool();
    UI.hideMagnetGauge();
    UI.hidePaintChoices();
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
    if ((this.session.power || 0) >= 1) this._showBlastCue();
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
    // Announce the boss archetype objective so the player knows the goal.
    if (
      s.mode === "campaign" &&
      s.level.milestone === "boss" &&
      s.level.boss &&
      s.score === 0
    ) {
      const cfg = s.level.boss;
      const how =
        cfg.kind === "stone"
          ? "Pop beside the locked stones to shatter the vault!"
          : cfg.kind === "color"
          ? "Clear every marked bubble off the board!"
          : "Shatter the whole frozen core!";
      UI.toast(`👹 ${cfg.label}: ${how}`, 3000);
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
      archerAim: null,
      shiftTokens: 0,
      stats: snap.stats || this._newStats(),
      bossCoreTotal: snap.bossCoreTotal || board.frozenRemaining(),
      bossKind: snap.bossKind || (level.boss ? level.boss.kind : null),
      bossTargetColor:
        snap.bossTargetColor == null ? -1 : snap.bossTargetColor,
      objective: level.objective || null,
      objectiveMet: !!snap.objectiveMet,
      usedPowerup: !!snap.usedPowerup,
      undoStack: [],
      undosLeft: 0,
      downpour: level.downpour || null,
      movesSinceDrop: snap.movesSinceDrop || 0,
      screenTimeLeft:
        snap.screenTimeLeft == null
          ? this._screenTimeLimit("campaign", level)
          : Math.max(0, snap.screenTimeLeft),
      screenTimeShown: Math.ceil(
        snap.screenTimeLeft == null
          ? this._screenTimeLimit("campaign", level)
          : Math.max(0, snap.screenTimeLeft)
      ),
      boardInteracted: !!snap.boardInteracted,
      boardIdleTime:
        snap.boardIdleTime == null
          ? EVENT_BOARD_IDLE_GRACE + 1
          : Math.max(0, snap.boardIdleTime),
      paint: null,
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
      bossKind: s.bossKind || null,
      bossTargetColor: s.bossTargetColor == null ? -1 : s.bossTargetColor,
      objectiveMet: !!s.objectiveMet,
      usedPowerup: !!s.usedPowerup,
      movesSinceDrop: s.movesSinceDrop || 0,
      screenTimeLeft: s.screenTimeLeft || 0,
      screenTimeShown: s.screenTimeShown || Math.ceil(s.screenTimeLeft || 0),
      boardInteracted: !!s.boardInteracted,
      boardIdleTime: s.boardIdleTime || 0,
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

  startPuzzle(index) {
    // Puzzle Mode: clear the entire board within a fixed move budget. Refuse to
    // start a puzzle that hasn't been unlocked yet (solve the prior one first).
    if (!isPuzzleUnlocked(index, Storage.getPuzzleStarsMap())) {
      UI.toast("🔒 Solve the previous puzzle to unlock this one");
      return;
    }
    const lvl = getPuzzle(index);
    this._newSession("puzzle", lvl);
    this.session.movesLeft = lvl.moves;
    UI.toast(`🧩 Puzzle ${lvl.puzzleIndex + 1} — clear the board in ${lvl.moves} moves!`);
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
      undosLeft: 0,
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
  _petFeatureUnlocked(feature) {
    return isPetFeatureUnlocked(feature, Storage.get("maxUnlockedLevel"));
  }

  // Open one crate: consumes a crate, rolls a pet (very rarely a premium
  // surprise — see PREMIUM_DROP_CHANCE), grants it (or converts a duplicate
  // into bonus XP). Returns { petId, isNew, premium } or null when no crate was
  // available. The roll is seeded so opens are reproducible in tests via
  // `?e2e=1` + a fixed seed counter.
  openCrate() {
    if (!this._petFeatureUnlocked("crates")) return null;
    if (!Storage.consumeCrate()) return null;
    this._crateSeed = ((this._crateSeed || 1) * 1664525 + 1013904223) >>> 0;
    const seed = (this._crateSeed ^ ((Date.now() >>> 0) || 1)) >>> 0;
    const floor = pityRarityFloor(Storage.getPity());
    const { petId, rarity, premium } = rollCrate(
      makeRng(seed),
      floor ? { floor } : {}
    );
    Storage.setPity(nextPity(Storage.getPity(), rarity));
    const trait = this._rollPetTrait();
    const isNew = Storage.grantPet(petId, trait);
    let dust = 0;
    if (!isNew) {
      Storage.addPetXp(petId, DUP_XP);
      dust = dustValue(rarity);
      Storage.addDust(dust);
    }
    // A crate sometimes also drops a loose gem (~35%); rarer pulls bias higher.
    let gem = null;
    if (makeRng((seed ^ 0x9e3779b9) >>> 0)() < 0.35) {
      gem = this._grantRolledGem(rarity === "legendary" ? 0.6 : rarity === "epic" ? 0.3 : 0);
    }
    return { petId, isNew, premium: !!premium, rarity, dust, gem, trait: isNew ? trait : null };
  }

  // Buy one crate with coins. Returns true on success.
  buyCrate() {
    if (!this._petFeatureUnlocked("crates")) return false;
    if (Economy.spendCoins(CRATE_COST)) {
      Storage.addCrates(1);
      return true;
    }
    return false;
  }

  // Craft (buy) a specific NON-premium pet outright with Pet Dust — the
  // duplicate currency. Lets a player escape bad crate luck and target a pet
  // they want. Returns { ok, petId, rarity, cost } or { ok:false, reason }.
  craftPet(petId) {
    if (!this._petFeatureUnlocked("crates")) return { ok: false, reason: "locked" };
    const pet = getPet(petId);
    if (!pet) return { ok: false, reason: "unknown" };
    if (pet.premium) return { ok: false, reason: "premium" };
    if (Storage.ownsPet(petId)) return { ok: false, reason: "owned" };
    const cost = dustCost(pet.rarity);
    if (!Storage.spendDust(cost)) return { ok: false, reason: "dust" };
    const trait = this._rollPetTrait();
    Storage.grantPet(petId, trait);
    return { ok: true, petId, rarity: pet.rarity, cost, trait };
  }

  // Buy + open the premium Legendary Crate via the (mock) IAP provider. Boosted
  // odds (see rollLegendaryCrate): always a legendary, often a premium pet.
  // Returns { petId, isNew, premium } on success, or null if the purchase fails.
  async buyLegendaryCrate() {
    if (!this._petFeatureUnlocked("crates")) return null;
    const res = await Monetization.purchase(LEGENDARY_CRATE.product);
    if (!res || !res.ok) return null;
    this._crateSeed = ((this._crateSeed || 1) * 1664525 + 1013904223) >>> 0;
    const seed = (this._crateSeed ^ ((Date.now() >>> 0) || 1)) >>> 0;
    const { petId, rarity, premium } = rollLegendaryCrate(makeRng(seed));
    Storage.setPity(nextPity(Storage.getPity(), rarity));
    const trait = this._rollPetTrait();
    const isNew = Storage.grantPet(petId, trait);
    let dust = 0;
    if (!isNew) {
      Storage.addPetXp(petId, DUP_XP);
      dust = dustValue(rarity);
      Storage.addDust(dust);
    }
    // The premium crate always includes a bonus gem (biased toward high tiers).
    const gem = this._grantRolledGem(0.7);
    return { petId, isNew, premium: !!premium, rarity, dust, gem, trait: isNew ? trait : null };
  }
  equipPet(id) {
    if (!this._petFeatureUnlocked("pets")) return false;
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

  // Toggle a pet in/out of the party support slots. Supports only lend passive
  // buffs (no active board move), so this safely refreshes the live session's
  // buffs without restarting the level. Returns the new support id list.
  toggleSupport(id) {
    if (!this._petFeatureUnlocked("party")) return Storage.getPartySupports();
    const supports = Storage.toggleSupport(id);
    if (this.session && !this.session.ended) {
      this.session.petBuffs = this._equippedBuffs();
    }
    return supports;
  }

  // ---- Gems & sockets ---------------------------------------------------
  // Re-apply the equipped party's buffs + active stats to the live session
  // (used after a socket change, which can alter both passive buffs and the
  // active pet's cooldown). Keeps the current petTimer if it's already shorter
  // so a socket swap never *delays* a pending action.
  _refreshPetSession() {
    if (!this.session || this.session.ended) return;
    this.session.petBuffs = this._equippedBuffs();
    const active = this._equippedActive();
    this.session.petActive = active;
    if (active) {
      this.session.petTimer = Math.min(this.session.petTimer || active.cooldown, active.cooldown);
    } else {
      this.session.petTimer = 0;
    }
  }

  // Craft a gem (type + tier) by spending Pet Dust. Returns
  // { ok, key, cost } or { ok:false, reason }.
  craftGem(type, tier) {
    if (!this._petFeatureUnlocked("gems")) return { ok: false, reason: "locked" };
    if (!getGemDef(type)) return { ok: false, reason: "unknown" };
    const tierId = getGemTier(tier).id;
    const cost = gemDustCost(tierId);
    if (!Storage.spendDust(cost)) return { ok: false, reason: "dust" };
    const key = gemKey(type, tierId);
    Storage.addGem(key, 1);
    return { ok: true, key, cost };
  }

  // Fuse FUSE_COUNT identical gems of `key` into one gem of the next tier up
  // (e.g. 3 chipped rubies → 1 polished ruby). No dust cost — a pure way to
  // upgrade a pile of weak duplicates. Returns { ok, from, to } or
  // { ok:false, reason }.
  fuseGem(key) {
    if (!this._petFeatureUnlocked("gems")) return { ok: false, reason: "locked" };
    const up = fusedGemKey(key);
    if (!up) return { ok: false, reason: "top" }; // unknown or already top-tier
    if (Storage.gemCount(key) < FUSE_COUNT) return { ok: false, reason: "count" };
    if (!Storage.fuseGems(key, up, FUSE_COUNT)) return { ok: false, reason: "count" };
    return { ok: true, from: key, to: up };
  }

  // Smart forge: make ONE gem of (type, tier), preferring to FUSE the tier below
  // when the player has enough of it, otherwise spending dust. Clicking the
  // target tier on the ladder is all the player does — the game picks the
  // cheapest source (gems first, then dust). Returns
  // { ok, key, via:"fuse"|"dust", cost } or { ok:false, reason }.
  forgeTier(type, tier) {
    if (!this._petFeatureUnlocked("gems")) return { ok: false, reason: "locked" };
    if (!getGemDef(type)) return { ok: false, reason: "unknown" };
    const tierId = getGemTier(tier).id;
    const key = gemKey(type, tierId);
    // Prefer fusion: consume FUSE_COUNT of the tier directly below (free).
    const below = prevGemTier(tierId);
    if (below) {
      const belowKey = gemKey(type, below);
      if (Storage.gemCount(belowKey) >= FUSE_COUNT &&
          Storage.fuseGems(belowKey, key, FUSE_COUNT)) {
        return { ok: true, key, via: "fuse", from: belowKey };
      }
    }
    // Fall back to crafting with dust.
    const cost = gemDustCost(tierId);
    if (!Storage.spendDust(cost)) return { ok: false, reason: "dust" };
    Storage.addGem(key, 1);
    return { ok: true, key, via: "dust", cost };
  }

  // Slot a gem from inventory into a pet's socket. `slot` is bounded by how many
  // sockets the pet has unlocked at its current level. Returns true on success
  // and refreshes the live session if the pet is the active lead.
  socketGem(petId, slot, key) {
    if (!this._petFeatureUnlocked("gems")) return false;
    const lvl = levelForXp((Storage.getPetState().owned[petId] || {}).xp || 0);
    // A gem's tier must be unlocked by the pet's level (stronger gems need a
    // higher level — see GEM_TIER_MIN_LEVEL).
    if (!canSocketGemAtLevel(key, lvl)) return false;
    if (Storage.gemCount(key) <= 0) return false;
    // Embuing a gem costs dust (separate from crafting). Reject if too poor.
    const g = parseGemKey(key);
    const cost = g ? socketDustCost(g.tier) : 0;
    if (Storage.getDust() < cost) return false;
    const maxSlots = socketsForLevel(lvl);
    if (!Storage.socketGem(petId, slot, key, maxSlots)) return false;
    if (cost > 0) Storage.spendDust(cost);
    this._refreshPetSession();
    return true;
  }

  // Remove a gem from a pet's socket. The gem is SHATTERED (destroyed) and the
  // player recovers only a fraction of the embue cost as dust — always less than
  // they paid. Returns { key, dust } on success (or null if the slot was empty)
  // and refreshes the live session.
  unsocketGem(petId, slot) {
    if (!this._petFeatureUnlocked("gems")) return null;
    const key = Storage.unsocketGem(petId, slot);
    if (!key) return null;
    const g = parseGemKey(key);
    const dust = g ? unsocketDustRefund(g.tier) : 0;
    if (dust > 0) Storage.addDust(dust);
    this._refreshPetSession();
    return { key, dust };
  }

  // Pick a tech-tree node for an owned pet. Validates the pick is legal at the
  // pet's current level (the node's tier must be the currently-pending tier),
  // records it, and live-refreshes the running session if it's the active lead.
  // Returns { ok:true, node } or { ok:false, reason }.
  pickPetTech(petId, nodeId) {
    if (!this._petFeatureUnlocked("tech")) return { ok: false, reason: "locked" };
    if (!Storage.ownsPet(petId)) return { ok: false, reason: "unowned" };
    const lvl = levelForXp((Storage.getPetState().owned[petId] || {}).xp || 0);
    const chosen = Storage.getPetTech(petId);
    if (!canPickTech(chosen, nodeId, lvl)) return { ok: false, reason: "locked" };
    if (!Storage.addPetTech(petId, nodeId)) return { ok: false, reason: "owned" };
    this._refreshPetSession();
    return { ok: true, node: techNode(nodeId) };
  }

  // Whether an owned pet has a tech-tier ready to pick (drives the Pets badge).
  petHasPendingTech(petId) {
    if (!this._petFeatureUnlocked("tech")) return false;
    if (!Storage.ownsPet(petId)) return false;
    const lvl = levelForXp((Storage.getPetState().owned[petId] || {}).xp || 0);
    return hasPendingTech(Storage.getPetTech(petId), lvl);
  }

  // Roll a gem reward and add it to inventory (used by crate/event drops).
  // `tierBias` nudges toward better tiers for richer sources. Returns the key.
  _grantRolledGem(tierBias = 0) {
    this._crateSeed = ((this._crateSeed || 1) * 1664525 + 1013904223) >>> 0;
    const seed = (this._crateSeed ^ ((Date.now() >>> 0) || 1)) >>> 0;
    const key = rollGem(makeRng(seed), { tierBias });
    Storage.addGem(key, 1);
    return key;
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
    if (!this._petFeatureUnlocked("crates")) return false;
    const pet = getPet(id);
    if (!pet || !pet.premium) return false;
    const res = await Monetization.purchase(pet.product || `pet_${id}`);
    if (!res || !res.ok) return false;
    Storage.grantPet(id, this._rollPetTrait());
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

  // Drip a finished level's earnings into the Piggy Bank (capped). Tutorial
  // play never banks. The coins stay locked until the player cracks the piggy.
  _depositPiggy(score) {
    const s = this.session;
    if (s && s.mode === "tutorial") return;
    if (this.tutorial && this.tutorial.active) return;
    const balance = Storage.get("piggyBank") || 0;
    const { balance: next, added } = piggyDeposit(balance, score);
    if (added > 0) Storage.set("piggyBank", next);
  }

  // Crack the Piggy Bank open: a one-time (mock) purchase that pays the entire
  // banked balance into the coin wallet and empties the vault. Returns a result
  // the shop UI can toast — `{ ok, amount }` on success, or a locked/failed flag.
  async crackPiggy() {
    const balance = Storage.get("piggyBank") || 0;
    if (!canCrackPiggy(balance)) return { ok: false, locked: true, balance };
    const res = await Monetization.purchase(PIGGY_CRACK_PRODUCT);
    if (!res || !res.ok) return { ok: false };
    Economy.addCoins(balance);
    Storage.set("piggyBank", 0);
    return { ok: true, amount: balance };
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
    } else if (kind === "paint") {
      const b = s.board;
      const { colors: g, types } = buildTutorialBoard(
        b.cols,
        b.rows,
        Math.max(4, s.level.colors || 4)
      );
      decorateSpecials(types);
      b.restore(g, types);
      Economy.addPowerup("paint", Math.max(0, 1 - Economy.getPowerup("paint")));
      this._ensureToolInLoadout("paint");
      UI.updatePowerups();
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
    } else if (kind === "bombbubble") {
      // Fresh practice board with a BOMB bubble parked inside a guaranteed
      // cluster, so popping it always detonates the 3×3 blast and advances.
      const b = s.board;
      const { colors: g, types } = buildTutorialBoard(
        b.cols,
        b.rows,
        s.level.colors || 4
      );
      decorateSpecials(types);
      this._placeTutorialBomb(types);
      b.restore(g, types);
    } else if (kind === "multiplier") {
      // Fresh practice board with a gold MULTIPLIER bubble parked inside a
      // guaranteed cluster, so popping it always boosts the score and advances.
      const b = s.board;
      const { colors: g, types } = buildTutorialBoard(
        b.cols,
        b.rows,
        s.level.colors || 4
      );
      decorateSpecials(types);
      this._placeTutorialMultiplier(types);
      b.restore(g, types);
    } else if (kind === "coinbubble") {
      // Fresh practice board with a treasure COIN bubble parked inside a
      // guaranteed cluster, so popping it always drops coins and advances.
      const b = s.board;
      const { colors: g, types } = buildTutorialBoard(
        b.cols,
        b.rows,
        s.level.colors || 4
      );
      decorateSpecials(types);
      this._placeTutorialCoin(types);
      b.restore(g, types);
    } else if (kind === "vine") {
      // Fresh practice board with a creeping VINE bubble parked inside a
      // guaranteed cluster, so popping it always clears the threat and advances.
      const b = s.board;
      const { colors: g, types } = buildTutorialBoard(
        b.cols,
        b.rows,
        s.level.colors || 4
      );
      decorateSpecials(types);
      this._placeTutorialVine(types);
      b.restore(g, types);
    } else if (kind === "event") {
      this._spawnTutorialEvent();
    } else if (kind === "undo") {
      // Guarantee there is a move to take back so the player can try Undo, and
      // grant practice Undo stock for the demo.
      Economy.addPowerup("undo", Math.max(0, 1 - Economy.getPowerup("undo")));
      s.undosLeft = Economy.getPowerup("undo");
      this._ensureToolInLoadout("undo");
      UI.updatePowerups();
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

  // Drop a BOMB bubble into a corner 2×2 block of the practice board (a
  // guaranteed same-colour cluster), so the bomb-bubble step can always be
  // cleared and triggers the 3×3 detonation.
  _placeTutorialBomb(types) {
    if (types && types[0] && types[0][0] !== undefined) types[0][0] = BOMB;
  }

  // Drop a gold MULTIPLIER bubble into a corner 2×2 block of the practice board
  // (a guaranteed same-colour cluster), so the multiplier step can always be
  // cleared and boosts the pop's score.
  _placeTutorialMultiplier(types) {
    if (types && types[0] && types[0][0] !== undefined) types[0][0] = MULTIPLIER;
  }

  // Drop a treasure COIN bubble into a corner 2×2 block of the practice board
  // (a guaranteed same-colour cluster), so the coin step can always be cleared
  // and drops coins.
  _placeTutorialCoin(types) {
    if (types && types[0] && types[0][0] !== undefined) types[0][0] = COIN;
  }

  // Drop a creeping VINE bubble into a corner 2×2 block of the practice board
  // (a guaranteed same-colour cluster), so the vine step can always be cleared
  // by popping that cluster.
  _placeTutorialVine(types) {
    if (types && types[0] && types[0][0] !== undefined) types[0][0] = VINE;
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
    // Keep a bomb bubble available while the bomb-bubble step is active.
    if (this.tutorial && this.tutorial.stepId === "bombbubble") {
      this._placeTutorialBomb(types);
    }
    // Keep a multiplier bubble available while the multiplier step is active.
    if (this.tutorial && this.tutorial.stepId === "multiplier") {
      this._placeTutorialMultiplier(types);
    }
    // Keep a coin bubble available while the coin step is active.
    if (this.tutorial && this.tutorial.stepId === "coinbubble") {
      this._placeTutorialCoin(types);
    }
    // Keep a vine bubble available while the vine step is active.
    if (this.tutorial && this.tutorial.stepId === "vine") {
      this._placeTutorialVine(types);
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
  // back on undo ({ powerup: type }). The stack is capped at UNDO_STACK_LIMIT to
  // bound memory; the oldest snapshot is dropped when it overflows.
  _pushUndo(refund = null) {
    const s = this.session;
    if (!s || s.ended) return;
    if (!Array.isArray(s.undoStack)) s.undoStack = [];
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
      screenTimeLeft: s.screenTimeLeft || 0,
      screenTimeShown: s.screenTimeShown || Math.ceil(s.screenTimeLeft || 0),
      boardInteracted: !!s.boardInteracted,
      boardIdleTime: s.boardIdleTime || 0,
      refund: refund || null,
    });
    if (s.undoStack.length > UNDO_STACK_LIMIT) s.undoStack.shift();
  }

  // Can the player undo right now? Needs an active, idle (non-animating)
  // session and at least one recorded snapshot. Stock is checked when the Undo
  // tool is used so the shop can open from the loadout when the player is out.
  canUndo() {
    const s = this.session;
    if (!s || s.ended) return false;
    if (s.finishing || s.petPicking || s.archerAim) return false; // mid-animation / aim
    if (s.magnet && s.magnet.aiming) return false; // mid magnet aim
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
    const inTutorial = s.mode === "tutorial";
    if (!inTutorial && !Economy.usePowerup("undo")) {
      UI.openShopForPowerup("undo");
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
    s.screenTimeLeft = snap.screenTimeLeft || s.screenTimeLeft || 0;
    s.screenTimeShown = snap.screenTimeShown || Math.ceil(s.screenTimeLeft || 0);
    s.boardInteracted = !!snap.boardInteracted;
    s.boardIdleTime = snap.boardIdleTime || 0;
    if (snap.stats) s.stats = { ...snap.stats };
    // Refund any tool the undone move consumed.
    if (snap.refund && snap.refund.powerup) {
      Economy.addPowerup(snap.refund.powerup, 1);
    }
    // Cancel any transient in-progress state.
    s.preview = null;
    s.armed = null;
    s.magnet = null;
    s.paint = null;
    s.archerAim = null;
    s.hint = null;
    s.idleTime = 0;
    s.undosLeft = Economy.getPowerup("undo");

    UI.clearArmedPowerups();
    UI.hideMagnetGauge();
    UI.hidePaintChoices();
    UI.updatePowerups();
    UI.updatePower(s.power, s.power >= 1);
    UI.updateFever(s.fever, !!s.feverActive);
    this.refreshHud();
    if (s.mode === "campaign") this._persistSession();
    Audio.click();
    vibrate(12);
    UI.toast(`↶ Undo (${inTutorial ? "practice" : `${s.undosLeft} left`})`);
    this._noteActivity();
    this._tut("undo");
    return true;
  }

  // ---- HUD --------------------------------------------------------------
  // Remaining count for the current boss archetype's objective (0 = defeated).
  // Frozen → unbroken ice; Stone → locked stones; Colour → bubbles of the
  // hunted colour. Non-boss levels report 0.
  _bossObjectiveRemaining() {
    const s = this.session;
    if (!s || !s.level || s.level.milestone !== "boss") return 0;
    if (s.bossKind === "stone") return s.board.stoneRemaining();
    if (s.bossKind === "color")
      return s.bossTargetColor >= 0
        ? s.board.colorCells(s.bossTargetColor).length
        : 0;
    return s.board.frozenRemaining();
  }

  refreshHud() {
    const s = this.session;
    if (!s) return;
    const status = this._hudStatus();
    // Bonus objective chip (campaign non-boss levels only).
    UI.updateObjective(
      s.mode === "campaign" && s.level.milestone !== "boss" ? s.objective : null,
      s.objectiveMet
    );
    if (s.mode === "campaign") {
      const mtype = s.level.milestone;
      const badge = mtype === "boss" ? "👹 " : mtype === "treasure" ? "🎁 " : "";
      if (mtype === "boss") {
        const remaining = this._bossObjectiveRemaining();
        const total = s.bossCoreTotal || remaining || 1;
        UI.updateHud({
          modeLabel: `${badge}Level ${s.level.id}`,
          score: s.score,
          movesLabel: "Moves",
          moves: s.movesLeft,
          showTarget: true,
          targetLabel: (s.level.boss && s.level.boss.hudLabel) || "Core",
          target: remaining,
          progress: 1 - remaining / total,
          status,
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
        status,
      });
    } else if (s.mode === "tutorial") {
      UI.updateHud({
        modeLabel: "Tutorial",
        score: s.score,
        movesLabel: "",
        moves: "",
        showTarget: false,
        progress: 0,
        status,
      });
    } else if (s.mode === "endless") {
      UI.updateHud({
        modeLabel: "Endless",
        score: s.score,
        movesLabel: "Best",
        moves: Storage.get("highScoreEndless"),
        showTarget: false,
        progress: 1 - s.board.countRemaining() / (s.board.cols * s.board.rows),
        status,
      });
    } else if (s.mode === "timeattack") {
      UI.updateHud({
        modeLabel: "Time Attack",
        score: s.score,
        movesLabel: "Time",
        moves: Math.ceil(s.timeLeft) + "s",
        showTarget: false,
        progress: Math.max(0, s.timeLeft / TIME_ATTACK_SECONDS),
        status,
      });
    } else if (s.mode === "puzzle") {
      const left = s.board.countRemaining();
      const total = s.board.cols * s.board.rows;
      UI.updateHud({
        modeLabel: `🧩 Puzzle ${s.level.puzzleIndex + 1}`,
        score: s.score,
        movesLabel: "Moves",
        moves: s.movesLeft,
        showTarget: true,
        targetLabel: "Left",
        target: left,
        progress: total > 0 ? 1 - left / total : 0,
        status,
      });
    } else {
      UI.updateHud({
        modeLabel: "Daily",
        score: s.score,
        movesLabel: "Streak",
        moves: getStreak(),
        showTarget: false,
        progress: 1 - s.board.countRemaining() / (s.board.cols * s.board.rows),
        status,
      });
    }
  }

  _priorityStatus(s) {
    if (!s || !s.board) return null;
    if (s.archerAim) {
      const cells = (s.archerAim.cells || []).length;
      if (s.archerAim.tooShort || cells === 0) return { icon: "🏹", text: "Pull back", kind: "priority" };
      return { icon: "🏹", text: `${cells} bubble shot`, kind: "priority" };
    }
    if (s.armed === "paint") return { icon: "🖌", text: "Paint a setup", kind: "priority" };
    if (s.armed) return { icon: "✦", text: "Pick a target", kind: "priority" };
    if (typeof s.board.vineCount === "function" && s.board.vineCount() > 0) return { icon: "🌿", text: "Clear vines", kind: "priority" };
    if (s.level && s.level.boss) return { icon: "👹", text: "Boss target", kind: "priority" };
    if (s.downpour && (s.movesSinceDrop || 0) >= Math.max(0, s.downpour.interval - 2)) return { icon: "🌧", text: "Rain soon", kind: "priority" };
    if (s.objective && !s.objectiveMet) return { icon: "🎯", text: s.objective.label || "Bonus goal", kind: "priority" };
    if (s.petActive && s.petTimer <= 1) return { icon: "✦", text: "Pet next", kind: "priority" };
    return null;
  }

  _hudStatus() {
    const s = this.session;
    if (!s) return [];
    const items = [];
    const priority = this._priorityStatus(s);
    if (priority) items.push(priority);
    if ((s.screenTimeLeft || 0) > 0)
      items.push({ icon: "⏱", text: `${Math.ceil(s.screenTimeLeft)}s`, kind: "time" });
    if ((s.power || 0) >= 1) items.push({ icon: "⚡", text: "Blast ready", kind: "ready" });
    else if ((s.power || 0) >= 0.65) items.push({ icon: "⚡", text: "Charge close", kind: "charge" });
    if (s.feverActive) items.push({ icon: "🔥", text: "Fever x2", kind: "fever" });
    else if ((s.fever || 0) >= 0.75) items.push({ icon: "🔥", text: "Fever close", kind: "fever" });
    if (s.hint) items.push({ icon: "◎", text: "Hint on", kind: "hint" });
    const undoStock = Economy.getPowerup("undo");
    if (undoStock > 0) items.push({ icon: "↶", text: `${undoStock} undo`, kind: "undo" });
    if (s.shiftTokens > 0) items.push({ icon: "↔", text: `${s.shiftTokens} shift`, kind: "shift" });
    if (s.petActive && s.petTimer <= 1 && !priority) items.push({ icon: "✦", text: "Pet soon", kind: "pet" });
    return items.slice(0, 4);
  }

  // ---- Input handling ---------------------------------------------------
  // Resolve a magnet tap to the intended visible plain bubble. Normally the
  // grid cell under the tap is enough, but during in-flight sprite animation a
  // bubble's drawn position can be offset from its logical cell. In that case,
  // snap to the nearest visible NORMAL bubble close to the tap.
  _magnetTargetFromTap(px, py) {
    const s = this.session;
    if (!s || !s.board) return null;
    const b = s.board;
    const cell = b.cellAtPixel(px, py);
    if (cell && b.types[cell.c][cell.r] === NORMAL && !b.isRainbow(cell.c, cell.r)) {
      return cell;
    }

    let best = null;
    const maxDist = b.cell * 0.65;
    const maxDist2 = maxDist * maxDist;
    for (let c = 0; c < b.cols; c++) {
      for (let r = 0; r < b.rows; r++) {
        if (b.grid[c][r] === -1 || b.types[c][r] !== NORMAL || b.isRainbow(c, r)) continue;
        const sp = b.spriteGrid[c] && b.spriteGrid[c][r];
        const cx = sp ? sp.x : b.targetPixel(c, r).x;
        const cy = sp ? sp.y : b.targetPixel(c, r).y;
        const dx = px - cx;
        const dy = py - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > maxDist2) continue;
        if (!best || d2 < best.d2) best = { c, r, d2 };
      }
    }
    return best ? { c: best.c, r: best.r } : cell;
  }

  // Resolve an armed-tool tap to the intended visible bubble. During in-flight
  // animation, a bubble can be drawn offset from its logical cell; this makes
  // bomb/pick/chain/color-clear follow what the player tapped visually.
  _toolTargetFromTap(px, py) {
    const s = this.session;
    if (!s || !s.board) return null;
    const b = s.board;
    const cell = b.cellAtPixel(px, py);

    let best = null;
    const maxDist = b.cell * 2.5;
    const maxDist2 = maxDist * maxDist;
    for (let c = 0; c < b.cols; c++) {
      for (let r = 0; r < b.rows; r++) {
        if (b.grid[c][r] === -1) continue;
        const sp = b.spriteGrid[c] && b.spriteGrid[c][r];
        const cx = sp ? sp.x : b.targetPixel(c, r).x;
        const cy = sp ? sp.y : b.targetPixel(c, r).y;
        const dx = px - cx;
        const dy = py - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > maxDist2) continue;
        if (!best || d2 < best.d2) best = { c, r, d2 };
      }
    }

    if (best) return { c: best.c, r: best.r };
    if (cell && b.grid[cell.c][cell.r] !== -1) return cell;
    return null;
  }

  handleTap(px, py) {
    const s = this.session;
    if (!s || s.ended) return;
    if (s.archerAim) {
      UI.toast("Drag to aim Archer's arrow");
      return;
    }
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
      const target = this._magnetTargetFromTap(px, py);
      if (!target) return;
      this._noteBoardActivity();
      this.beginMagnet(target.c, target.r);
      return;
    }

    if (s.armed === "paint") {
      const target = this._toolTargetFromTap(px, py);
      if (!target) return;
      this._noteBoardActivity();
      this.beginPaint(target.c, target.r);
      return;
    }

    if (s.armed) {
      const target = this._toolTargetFromTap(px, py);
      if (!target) return; // need a valid bubble target
      this._noteBoardActivity();
      this.applyPowerup(s.armed, target.c, target.r);
      return;
    }

    if (!cell) return;
    this._noteBoardActivity();
    this.popAt(cell.c, cell.r);
  }

  // ---- Swipe left/right: Shift a whole row (2048-style) -----------------
  handleSwipe(dir, x0, y0) {
    const s = this.session;
    if (!s || s.ended || s.armed) return;
    this._noteActivity();
    if (dir !== "left" && dir !== "right") return; // only horizontal shifts

    const r = s.board.rowAtSwipePixel(y0);
    if (r === null) return;

    // A shift is a move: campaign/puzzle spend a move, endless/daily spend a token.
    if (s.mode === "campaign" || s.mode === "puzzle") {
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
    this._noteBoardActivity();

    s.preview = null;
    s.board.settle();
    if (s.mode === "campaign" || s.mode === "puzzle") s.movesLeft -= 1;
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
    if (!s || s.ended || s.armed || s.archerAim) return;
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
    if (s.archerAim) return;
    const had = s.preview;
    s.preview = null;
    if (s.armed) return;
    const cell = s.board.cellAtPixel(px, py);
    if (!cell || !had) return;
    if (s.board.getGroupAt(cell.c, cell.r).length >= 2) {
      this.popAt(cell.c, cell.r);
    }
  }

  // Expand a cleared set through chained special strikes until it stabilizes:
  // lightning bubbles add row+column cells, bomb bubbles add 3x3 cells. Newly
  // included specials can trigger further expansions in later passes.
  _resolveSpecialStrikes(cells) {
    const s = this.session;
    if (!s || !cells || !cells.length) {
      return { cells: cells || [], hitLightning: false, hitBomb: false };
    }
    let out = cells;
    let hitLightning = false;
    let hitBomb = false;
    for (let guard = 0; guard < 64; guard++) {
      const before = out.length;
      const hasLightning = out.some((p) => s.board.isLightning(p.c, p.r));
      const hasBomb = out.some((p) => s.board.isBomb(p.c, p.r));
      if (hasLightning) {
        hitLightning = true;
        out = s.board.lightningStrike(out);
      }
      if (hasBomb) {
        hitBomb = true;
        out = s.board.bombStrike(out);
      }
      if (out.length === before) break;
    }
    return { cells: out, hitLightning, hitBomb };
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

    // Lightning bubbles discharge along their row + column; Bomb bubbles
    // detonate a 3×3 area. Either expands the cleared set; score reflects
    // everything cleared.
    const strike = this._resolveSpecialStrikes(group);
    const struckBolt = strike.hitLightning;
    const struckBomb = strike.hitBomb;
    const cells = strike.cells;
    const struck = struckBolt || struckBomb;

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
    // Gold “multiplier” bubbles in the popped group multiply THIS pop's score
    // (×2 each, stacking, capped at ×8). They don't expand the cleared set and
    // don't feed Power/Fever — it's a pure score reward.
    const multCount = group.filter((p) => s.board.isMultiplier(p.c, p.r)).length;
    const scoreMult = multCount > 0 ? Math.min(8, Math.pow(2, multCount)) : 1;
    const finalPoints = points * scoreMult;
    s.score += finalPoints;
    s.combo += 1;
    s.comboTimer = COMBO_WINDOW;

    // Charge the Power meter (from the combo points, independent of Fever).
    this._addPower(powerGain(comboPoints, s.combo) * s.petBuffs.powerMult, true);
    // Build the Fever gauge — quick chains fill it and trigger double points.
    this._addFever(feverGain(s.combo) * s.petBuffs.feverMult);

    if (struckBolt) {
      const p = s.board.targetPixel(c, r);
      this.floating.spawn(p.x, p.y - 28, "⚡ ZAP!", "#9fe8ff", 30);
      Audio.powerup();
    }
    if (struckBomb) {
      const p = s.board.targetPixel(c, r);
      this.floating.spawn(p.x, p.y - 28, "💥 BOOM!", "#ffb066", 30);
      Audio.powerup();
    }
    if (multCount > 0) {
      const p = s.board.targetPixel(c, r);
      this.floating.spawn(p.x, p.y - 28, `✨ ×${scoreMult}!`, "#ffd35b", 32);
      Audio.powerup();
    }
    // Treasure "coin" bubbles in the cleared set drop bonus coins straight into
    // the wallet (the tutorial never touches the real economy).
    const coinCount = cells.filter((p) => s.board.isCoin(p.c, p.r)).length;
    // Whether the cleared set included a creeping vine bubble (captured before
    // _popCells/_tut may rebuild the board, so the flag stays accurate).
    const vinePopped = cells.some((p) => s.board.isVine(p.c, p.r));
    // Count of special bubbles in the cleared set (also captured before the
    // board is cleared) for daily/weekly quest progress.
    const specialsPopped = cells.filter(
      (p) =>
        s.board.isLightning(p.c, p.r) ||
        s.board.isBomb(p.c, p.r) ||
        s.board.isMultiplier(p.c, p.r) ||
        s.board.isCoin(p.c, p.r) ||
        s.board.isVine(p.c, p.r)
    ).length;
    if (coinCount > 0) {
      const coinsDropped = coinCount * COIN_BUBBLE_VALUE;
      if (s.mode !== "tutorial") {
        Economy.addCoins(coinsDropped);
        if (s.stats) s.stats.coinBubbles = (s.stats.coinBubbles || 0) + coinCount;
      }
      const p = s.board.targetPixel(c, r);
      this.floating.spawn(p.x, p.y - 28, `🪙 +${coinsDropped}`, "#ffe08a", 30);
      Audio.powerup();
    }
    this._popCells(cells, finalPoints, cells.length, s.combo, struck ? 1.3 : 1);
    if (this.isBlastReady()) this._showBlastCue();

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
    // Quest progress: bubbles cleared, combo reached, group size, and any
    // special bubbles (lightning/bomb/multiplier/coin/vine) in the cleared set.
    this._recordQuestProgress({
      bubbles: cells.length,
      combo: s.combo,
      group: group.length,
      specials: specialsPopped,
    });
    if (s.mode === "campaign" || s.mode === "puzzle") s.movesLeft -= 1;
    this.refreshHud();
    this._tut("pop");
    if (struckBolt) this._tut("lightning");
    if (struckBomb) this._tut("bombbubble");
    if (multCount > 0) this._tut("multiplier");
    if (coinCount > 0) this._tut("coinbubble");
    if (vinePopped) this._tut("vine");
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

  // Choose the blast target that would clear the most cells right now.
  _bestBlastTarget() {
    const s = this.session;
    if (!s || !s.board) return null;
    let best = null;
    let bestCount = -1;
    for (let c = 0; c < s.board.cols; c++) {
      for (let r = 0; r < s.board.rows; r++) {
        if (s.board.grid[c][r] === -1) continue;
        const strike = this._resolveSpecialStrikes(s.board.blastArea(c, r));
        const count = strike.cells.length;
        if (count > bestCount) {
          bestCount = count;
          best = { c, r, count };
        }
      }
    }
    return best;
  }

  // Surface a short-lived board cue when Charged Blast becomes available so
  // players can see where a double-tap would do the most immediate damage.
  _showBlastCue() {
    const s = this.session;
    if (!this.isBlastReady()) {
      if (s) s.blastCue = null;
      return;
    }
    const best = this._bestBlastTarget();
    if (!best) {
      s.blastCue = null;
      return;
    }
    s.blastCue = {
      c: best.c,
      r: best.r,
      timer: BLAST_CUE_DURATION,
      duration: BLAST_CUE_DURATION,
      count: best.count,
    };
  }

  _addPower(amount, deferCue = false) {
    const s = this.session;
    if (!s) return;
    const was = s.power;
    s.power = Math.max(0, Math.min(1, s.power + amount));
    UI.updatePower(s.power, s.power >= 1);
    if (s.power >= 1 && was < 1) {
      Audio.powerup();
      UI.toast("⚡ Charged! Double-tap to blast");
      if (deferCue) s.blastCue = null;
      else this._showBlastCue();
    } else if (s.power < 1) {
      s.blastCue = null;
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
    Audio.fever();
    UI.toast("🔥 FEVER! Double points!");
    this.floating.spawn(this.W / 2, this.H * 0.4, "FEVER ×2!", "#ff5b8a", 34);
    this._tut("fever");
    this._recordProgress({ fevers: 1 });
    this._recordQuestProgress({ fevers: 1 });
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

  // ---- Daily & Weekly Quests --------------------------------------------
  // Fold a quest metric delta into the active daily/weekly quests. Quests are
  // refreshed for the current day/week first, then progressed; a toast fires
  // when a quest becomes newly complete. Tutorial play never counts.
  _recordQuestProgress(deltas) {
    const s = this.session;
    if (s && s.mode === "tutorial") return;
    if (this.tutorial && this.tutorial.active) return;
    if (!deltas) return;
    const current = ensureQuests(Storage.get("quests"), todayKey(), weekKey());
    const { state, newlyComplete } = applyQuestProgress(current, deltas);
    Storage.set("quests", state);
    if (newlyComplete > 0) {
      Audio.coin();
      UI.toast(
        newlyComplete > 1
          ? `✅ ${newlyComplete} quests complete!`
          : "✅ Quest complete — claim your reward!",
        2200
      );
    }
    UI.refreshQuestsBadge();
  }

  _resolvePowerupReward(type, amount = 1) {
    const n = Math.max(1, Number(amount) || 1);
    if (isPowerupUnlocked(type)) {
      const info = POWERUP_INFO[type] || {};
      return { coins: 0, powerup: { id: type, n, name: info.name || type, icon: info.icon || "✨" } };
    }
    return { coins: lockedPowerupRewardCoins(type, n), powerup: null };
  }

  _grantPowerupReward(type, amount = 1) {
    const reward = this._resolvePowerupReward(type, amount);
    if (reward.powerup) Economy.addPowerup(reward.powerup.id, reward.powerup.n);
    else if (reward.coins) Economy.addCoins(reward.coins);
    return reward;
  }

  // Claim a completed quest's reward (called from the Quests UI). Grants the
  // reward (coins / power-up / crate / season XP), persists the claim, and
  // returns a reward summary for the toast — or null if not claimable.
  claimQuestReward(scope, index) {
    const current = ensureQuests(Storage.get("quests"), todayKey(), weekKey());
    const res = claimQuest(current, scope, index);
    if (!res) {
      Storage.set("quests", current);
      return null;
    }
    const r = resolveRewardForUnlocks(res.reward || {});
    if (r.coins) Economy.addCoins(r.coins);
    if (r.powerup) Economy.addPowerup(r.powerup, 1);
    if (r.crate) Storage.addCrates(r.crate);
    if (r.seasonXp) this._awardSeasonXp(r.seasonXp);
    Storage.set("quests", res.state);
    UI.refreshQuestsBadge();
    return { reward: r, label: res.def ? res.def.label : "" };
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
    let coins = chest.coins + chest.bonusCoins;
    if (coins > 0) Economy.addCoins(coins);

    // Grant power-up tools.
    const powerups = [];
    chest.powerups.forEach(({ id, n }) => {
      const reward = this._grantPowerupReward(id, n);
      if (reward.powerup) powerups.push(reward.powerup);
      else coins += reward.coins;
    });

    // Rarely, a pet. New pets join the collection; duplicates grant XP.
    let pet = null;
    if (chest.petRoll) {
      const { petId, premium } = rollCrate(rng);
      const isNew = Storage.grantPet(petId, rollTrait(rng));
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

    const reward = resolveRewardForUnlocks(st.reward || {});
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

    const reward = resolveRewardForUnlocks(tierReward(index, track) || {});
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
    if (s.archerAim) {
      UI.toast("Release a drag to fire the arrow");
      return;
    }
    this._noteActivity();
    // While aiming a magnet, any second tap just locks the gauge.
    if (s.magnet && s.magnet.aiming) {
      this.lockMagnet();
      return;
    }
    const cell = s.board.cellAtPixel(px, py);
    if (!cell) return;
    this._noteBoardActivity();
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
    const strike = this._resolveSpecialStrikes(s.board.blastArea(c, r));
    const cells = strike.cells;
    if (!cells.length) return;
    // Record an undo snapshot (the spent charge is restored from the snapshot).
    this._pushUndo();
    s.power = 0;
    s.blastCue = null;
    UI.updatePower(0, false);
    const basePoints = Math.round(
      feverPoints(groupScore(Math.max(2, cells.length)), s.feverActive) *
        s.petBuffs.scoreMult
    );
    const multCount = cells.filter((p) => s.board.isMultiplier(p.c, p.r)).length;
    const scoreMult = multCount > 0 ? Math.min(8, Math.pow(2, multCount)) : 1;
    const points = basePoints * scoreMult;
    s.score += points;

    const coinCount = cells.filter((p) => s.board.isCoin(p.c, p.r)).length;
    const vinePopped = cells.some((p) => s.board.isVine(p.c, p.r));
    if (coinCount > 0) {
      const coinsDropped = coinCount * COIN_BUBBLE_VALUE;
      if (s.mode !== "tutorial") {
        Economy.addCoins(coinsDropped);
        if (s.stats) s.stats.coinBubbles = (s.stats.coinBubbles || 0) + coinCount;
      }
      const p = s.board.targetPixel(c, r);
      this.floating.spawn(p.x, p.y - 28, `🪙 +${coinsDropped}`, "#ffe08a", 30);
      Audio.powerup();
    }
    if (multCount > 0) {
      const p = s.board.targetPixel(c, r);
      this.floating.spawn(p.x, p.y - 28, `✨ ×${scoreMult}!`, "#ffd35b", 32);
      Audio.powerup();
    }

    this._popCells(
      cells,
      points,
      cells.length,
      1,
      strike.hitLightning || strike.hitBomb ? 1.2 : 1.1
    );
    if (s.stats) s.stats.blasts += 1;
    Audio.blast();
    this.floating.spawn(this.W / 2, this.H / 2, "CHARGED BLAST!", "#ff6ec7", 30);
    this.refreshHud();
    this._tut("blast");
    if (multCount > 0) this._tut("multiplier");
    if (coinCount > 0) this._tut("coinbubble");
    if (vinePopped) this._tut("vine");
    this.afterMove();
  }

  applyPowerup(type, c, r) {
    const s = this.session;
    if (!s || s.ended) return;
    let cells = [];
    if (type === "bomb") cells = s.board.bombArea(c, r);
    else if (type === "colorClear") cells = s.board.colorCells(s.board.grid[c][r]);
    else if (type === "chainBolt") cells = s.board.crossCells(c, r);
    else if (type === "pick") cells = [{ c, r }];
    const strike = this._resolveSpecialStrikes(cells);
    const hitLightning = strike.hitLightning;
    const hitBomb = strike.hitBomb;
    cells = strike.cells;
    if (cells.length === 0) return;

    // Tutorial mode bypasses the economy so it never spends real inventory.
    if (s.mode !== "tutorial" && !Economy.usePowerup(type)) return;
    // Record an undo snapshot, refunding the spent tool on undo.
    this._pushUndo(s.mode === "tutorial" ? null : { powerup: type });
    this._markPowerupUsed();
    const basePoints = Math.round(
      feverPoints(groupScore(Math.max(2, cells.length)), s.feverActive) *
        s.petBuffs.scoreMult
    );
    const multCount = cells.filter((p) => s.board.isMultiplier(p.c, p.r)).length;
    const scoreMult = multCount > 0 ? Math.min(8, Math.pow(2, multCount)) : 1;
    const points = basePoints * scoreMult;
    s.score += points;

    const coinCount = cells.filter((p) => s.board.isCoin(p.c, p.r)).length;
    const vinePopped = cells.some((p) => s.board.isVine(p.c, p.r));
    if (coinCount > 0) {
      const coinsDropped = coinCount * COIN_BUBBLE_VALUE;
      if (s.mode !== "tutorial") {
        Economy.addCoins(coinsDropped);
        if (s.stats) s.stats.coinBubbles = (s.stats.coinBubbles || 0) + coinCount;
      }
      const p = s.board.targetPixel(c, r);
      this.floating.spawn(p.x, p.y - 28, `🪙 +${coinsDropped}`, "#ffe08a", 30);
      Audio.powerup();
    }

    this._popCells(cells, points, cells.length, 1, 0.6);
    if (hitLightning) {
      const p = s.board.targetPixel(c, r);
      this.floating.spawn(p.x, p.y - 28, "⚡ ZAP!", "#9fe8ff", 30);
      Audio.powerup();
    }
    if (hitBomb) {
      const p = s.board.targetPixel(c, r);
      this.floating.spawn(p.x, p.y - 28, "💥 BOOM!", "#ffb066", 30);
      Audio.powerup();
    }
    if (multCount > 0) {
      const p = s.board.targetPixel(c, r);
      this.floating.spawn(p.x, p.y - 28, `✨ ×${scoreMult}!`, "#ffd35b", 32);
      Audio.powerup();
    }
    if (s.stats) s.stats.powerups += 1;
    Audio.powerup();
    s.armed = null;
    UI.clearArmedPowerups();
    UI.updatePowerups();
    this.refreshHud();
    this._tut("powerup");
    if (hitLightning) this._tut("lightning");
    if (hitBomb) this._tut("bombbubble");
    if (multCount > 0) this._tut("multiplier");
    if (coinCount > 0) this._tut("coinbubble");
    if (vinePopped) this._tut("vine");
    this.afterMove();
  }

  beginPaint(c, r) {
    const s = this.session;
    if (!s || s.ended) return;
    const suggestions = s.board.suggestRecolors(c, r, 3);
    if (!suggestions.length) {
      UI.toast("Paint needs a recolourable bubble");
      return;
    }
    s.paint = { c, r, suggestions };
    Audio.click();
    UI.showPaintChoices({
      suggestions,
      palette: (this.theme && this.theme.bubbles) || [],
      current: s.board.grid[c][r],
    });
    UI.toast("🎨 Pick the smartest colour");
  }

  cancelPaint() {
    const s = this.session;
    if (!s) return;
    s.paint = null;
    s.armed = null;
    UI.hidePaintChoices();
    UI.clearArmedPowerups();
  }

  confirmPaintColor(color) {
    const s = this.session;
    if (!s || s.ended || !s.paint) return;
    const { c, r } = s.paint;
    const suggestions = s.board.suggestRecolors(c, r, 3);
    const picked = suggestions.find((opt) => opt.color === color);
    if (!picked) {
      this.cancelPaint();
      UI.toast("That paint choice is no longer available");
      return;
    }
    if (s.mode !== "tutorial" && !Economy.usePowerup("paint")) {
      this.cancelPaint();
      return;
    }
    this._pushUndo(s.mode === "tutorial" ? null : { powerup: "paint" });
    if (!s.board.recolorCell(c, r, color)) {
      if (Array.isArray(s.undoStack)) s.undoStack.pop();
      if (s.mode !== "tutorial") Economy.addPowerup("paint", 1);
      this.cancelPaint();
      return;
    }
    this._markPowerupUsed();
    s.paint = null;
    s.armed = null;
    UI.hidePaintChoices();
    UI.clearArmedPowerups();
    UI.updatePowerups();
    Audio.powerup();
    vibrate(14);
    const p = s.board.targetPixel(c, r);
    this.floating.spawn(p.x, p.y - 22, `🎨 ${picked.groupSize}`, "#ffffff", 28);
    if (s.stats) s.stats.powerups += 1;
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
    if (b.grid[c][r] === -1 || b.isRainbow(c, r) || b.types[c][r] !== NORMAL) {
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
      s.board.types[c][r] !== NORMAL
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

  // ---- Archer pet: drag-to-fire skill shot -----------------------------
  handleDragStart(x, y) {
    const s = this.session;
    if (!s || !s.archerAim || s.ended) return;
    const cell = s.board.cellAtPixel(x, y);
    if (cell) s.archerAim.anchor = cell;
    s.archerAim.start = { x, y };
    s.archerAim.end = { x, y };
    s.archerAim.cells = [];
    s.preview = null;
    this._noteActivity();
  }

  handleDragMove(x0, y0, x1, y1) {
    const s = this.session;
    if (!s || !s.archerAim || s.ended) return;
    const aim = s.archerAim;
    aim.start = aim.start || { x: x0, y: y0 };
    aim.end = { x: x1, y: y1 };
    const path = this._archerPath(aim);
    aim.cells = path.cells;
    aim.power = path.power;
    aim.sweet = path.sweet;
    aim.strength = path.strength;
    aim.tooShort = path.tooShort;
    aim.good = path.good;
    this._noteActivity();
    this.refreshHud();
  }

  handleDragEnd(x0, y0, x1, y1) {
    const s = this.session;
    if (!s || !s.archerAim || s.ended) return false;
    this.handleDragMove(x0, y0, x1, y1);
    this.fireArcherArrow();
    return true;
  }

  _startArcherAim(act) {
    const s = this.session;
    if (!s || s.ended || !s.board || !s.board.countRemaining()) return;
    const anchor = s.board.randomFilledCell(s.board.rng) || s.board.firstFilledCell();
    if (!anchor) return;
    const p = s.board.targetPixel(anchor.c, anchor.r);
    s.archerAim = {
      act,
      anchor,
      start: { x: p.x, y: p.y },
      end: { x: p.x, y: p.y },
      cells: [],
      power: 0,
      strength: 0,
      sweet: 0.68,
      tooShort: true,
      good: false,
    };
    s.preview = null;
    s.armed = null;
    UI.clearArmedPowerups();
    Audio.powerup();
    UI.toast("🏹 Archer ready — pull back, release to shoot");
    this.refreshHud();
  }

  _archerPath(aim) {
    const s = this.session;
    if (!s || !aim || !aim.start || !aim.end) {
      return { cells: [], power: 0, strength: 0, sweet: 0.68, tooShort: true, good: false };
    }
    const pullDx = aim.end.x - aim.start.x;
    const pullDy = aim.end.y - aim.start.y;
    const dist = Math.hypot(pullDx, pullDy);
    const tooShort = dist < s.board.cell * 0.55;
    const power = Math.max(0, Math.min(1, dist / Math.max(1, s.board.cell * 3.2)));
    const sweet = aim.sweet == null ? 0.68 : aim.sweet;
    const good = Math.abs(power - sweet) <= 0.12;
    const strength = tooShort ? 0 : Math.max(0.35, 1 - Math.abs(power - sweet) / 0.42);
    const hits = Math.max(2, Math.round((aim.act.count || 2) + power * 2 + strength * 3));
    const shotDx = -pullDx;
    const shotDy = -pullDy;
    return {
      cells: tooShort ? [] : s.board.arrowRay(aim.anchor.c, aim.anchor.r, shotDx, shotDy, hits),
      power,
      strength,
      sweet,
      tooShort,
      good,
      shotDx,
      shotDy,
    };
  }

  fireArcherArrow() {
    const s = this.session;
    if (!s || s.ended || !s.archerAim) return;
    const aim = s.archerAim;
    const path = this._archerPath(aim);
    const cells = path.cells;
    if (path.tooShort) {
      UI.toast("Pull farther back to fire Archer's arrow");
      aim.tooShort = true;
      aim.cells = [];
      aim.power = path.power;
      aim.strength = 0;
      this.refreshHud();
      return;
    }
    s.archerAim = null;
    if (!cells.length) {
      UI.toast("Archer missed — aim through bubbles next time");
      this.refreshHud();
      return;
    }
    const raw = cells.length * (path.good ? 26 : 18);
    const points = Math.round(
      feverPoints(raw, s.feverActive) * s.petBuffs.scoreMult
    );
    s.score += points;
    const targets = cells.map((cell) => s.board.targetPixel(cell.c, cell.r));
    const anchorPx = s.board.targetPixel(aim.anchor.c, aim.anchor.r);
    this.petAnim.play({
      kind: "arrow",
      icon: this._equippedPetIcon("🏹"),
      anchor: anchorPx,
      targets,
      color: "#c9ff7a",
      shotDx: path.shotDx,
      shotDy: path.shotDy,
    });
    this._popCells(cells, points, cells.length, 1, 0.9 + path.strength * 0.35);
    Audio.powerup();
    vibrate(path.good ? 30 : 12);
    this.floating.spawn(anchorPx.x, anchorPx.y - 36, path.good ? "Bullseye!" : "Arrow!", path.good ? "#b7ff5b" : "#c9ff7a", 28);
    if (s.stats) s.stats.petArrows = (s.stats.petArrows || 0) + cells.length;
    this.refreshHud();
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
    else if (act.type === "paint") this._petPaint(act);
    else if (act.type === "quake") this._petQuake(act);
    else if (act.type === "cyclone") this._petCyclone(act);
    else if (act.type === "magma") this._petMagma(act);
    else if (act.type === "tidal") this._petTidal(act);
    else if (act.type === "archer") this._startArcherAim(act);
  }

  // 🐱 Whiskers: pounce on lone, hard-to-match bubbles and clear them.
  _petCleanse(act) {
    const s = this.session;
    const cells = s.board.mostIsolatedCells(Math.max(1, act.count));
    if (!cells.length) return;
    const pixels = cells.map((cell) => s.board.targetPixel(cell.c, cell.r));
    const palette = this.theme.bubbles;
    const hexes = cells.map((cell) => {
      const ci = s.board.grid[cell.c][cell.r];
      const idx = ((ci % palette.length) + palette.length) % palette.length;
      return palette[idx] || "#9be7ff";
    });
    const raw = cells.length * 14;
    const points = Math.round(
      feverPoints(raw, s.feverActive) * s.petBuffs.scoreMult
    );
    s.score += points;
    // Pet ability flourish over the cleared bubbles.
    const anchor = pixels.reduce(
      (a, t) => ({ x: a.x + t.x / pixels.length, y: a.y + t.y / pixels.length }),
      { x: 0, y: 0 }
    );
    this.petAnim.play({
      kind: "cleanse",
      icon: this._equippedPetIcon("🐱"),
      anchor,
      targets: pixels,
      color: "#9be7ff",
    });
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const t = pixels[i];
      const fx = s.board.forceRemove(cell.c, cell.r);
      if (!fx) continue;
      if (s.stats) s.stats.cleared += 1;
      this.particles.burst(t.x, t.y, hexes[i] || "#9be7ff", 12, 0.7);
      this.particles.sparkle(t.x, t.y, "#ffffff", 6);
    }
    s.board.settle();
    this.shake.add(0.14 + cells.length * 0.03);
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

  // 🖌️ Luma: recolour nearby awkward bubbles to match one anchor, creating a
  // fresh cluster the player can pop next.
  _petPaint(act) {
    const s = this.session;
    const anchor = s.board.mostIsolatedCells(1)[0] || s.board.randomFilledCell(s.board.rng);
    if (!anchor) return;
    const cells = s.board.paintArea(anchor.c, anchor.r, Math.max(1, act.count));
    if (!cells.length) return;
    const anchorPx = s.board.targetPixel(anchor.c, anchor.r);
    const targets = [anchor, ...cells].map((cell) => s.board.targetPixel(cell.c, cell.r));
    this.petAnim.play({
      kind: "gather",
      icon: this._equippedPetIcon("🖌️"),
      anchor: anchorPx,
      targets,
      color: "#ff8bd1",
    });
    this.shake.add(0.12 + cells.length * 0.02);
    Audio.powerup();
    this.floating.spawn(anchorPx.x, anchorPx.y - 36, "Paint!", "#ff8bd1", 26);
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
      this.particles.spriteBurst(f.x, f.y, style.style, style.power * shakePower);
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
    if (!s || s.ended) return;
    const inTutorial = s.mode === "tutorial";
    const rescuePick = s.rescuing && type === "pick";
    if (!inTutorial && !rescuePick && !isPowerupUnlocked(type)) {
      UI.toast(`${(POWERUP_INFO[type] || {}).name || "Tool"} unlocks at Level ${powerupUnlockLevel(type)}`);
      return;
    }
    if (!inTutorial && Economy.getPowerup(type) <= 0) {
      // Out of this tool — take the player straight to the shop with it already
      // highlighted so they can stock up, then return to the level.
      UI.openShopForPowerup(type);
      return;
    }
    if (type === "undo") {
      this.undoMove();
      UI.updatePowerups();
      this.refreshHud();
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
      if (s.paint) {
        s.paint = null;
        UI.hidePaintChoices();
      }
      UI.clearArmedPowerups();
    } else {
      s.armed = type;
      if (s.magnet) {
        s.magnet = null;
        UI.hideMagnetGauge();
      }
      if (s.paint) {
        s.paint = null;
        UI.hidePaintChoices();
      }
      UI.clearArmedPowerups();
      const armedBtn = btn || document.querySelector(`.powerup-btn[data-pu="${type}"]`);
      if (armedBtn) armedBtn.classList.add("armed");
      const hint = {
        bomb: "Tap to drop bomb",
        colorClear: "Tap a color to clear it",
        paint: "Tap a bubble to repaint it",
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
    // Guard FIRST against a stale async callback firing after the level was
    // quit or already ended — e.g. Talon's pick `onDone` or the last-bubble
    // finale's `onDone` resolve on a later frame, by which point the session
    // may be null (quit to menu) or already resolved. Reading `s.mode` below
    // would otherwise throw "Cannot read properties of null".
    if (!s || s.ended) return;
    // Any resolved move resets the idle-hint timer.
    s.idleTime = 0;
    s.hint = null;
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
    // A last-bubble finale is mid-flight; it will resolve the board itself.
    if (s.finishing) return;
    // Talon's pick is mid-flourish (bubbles are being pecked off one by one). It
    // will settle gravity and call afterMove() again itself when it finishes, so
    // skip win/deadlock checks — and don't let another pet action fire over it.
    if (s.petPicking || s.archerAim) return;

    // Active pet companions physically help on the board every few moves
    // (gathering a colour, or zapping isolated bubbles) before we evaluate the
    // board state — so their help counts toward the win/deadlock checks below.
    this._maybePetAction();

    // _maybePetAction may have just launched Talon's pick (async) or Archer's
    // player-aimed shot. Defer the rest until that action resolves.
    if (s.petPicking || s.archerAim) return;

    // Vine threat: any vine bubbles left on the board creep into one adjacent
    // ordinary bubble on every resolved move. The player stops the spread by
    // popping the vine cluster. (Tutorial returned above; a finale or pet
    // flourish is skipped via the guards above so it never double-spreads.)
    this._spreadVines();

    // A single un-poppable bubble is left: rather than strand the player on a
    // jam (a lone bubble can never form a group of 2+), give it a celebratory
    // glow-and-explode finale — one of several random styles — that clears the
    // board, then let the normal clear logic resolve the level.
    if (s.board.countRemaining() === 1 && !this.finale.active) {
      if (!s.board.isIdle()) {
        s.pendingFinale = true;
        return;
      }
      s.pendingFinale = false;
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
      // Puzzle Mode: clearing the whole board within the move budget is the win.
      if (s.mode === "puzzle") {
        s.score += clearBonus(Math.max(0, s.movesLeft));
        this._scheduleEnd(true, "puzzle");
        return;
      }
      // Campaign / daily: clearing the board wins with a bonus.
      s.score += clearBonus(Math.max(0, s.movesLeft));
      this._scheduleEnd(true, "cleared");
      return;
    }

    // Downpour pressure (advanced campaign levels): a fresh row drops in from
    // the top every few moves. Runs only after the win/finale checks above, so
    // a clearing move still wins; if a drop buries a column the level is lost.
    if (this._downpour()) return;

    const deadlock = this._isDeadlocked();

    // The board is playable again (e.g. a Pick made bubbles fall into matches):
    // clear any rescue state so a future jam re-shows the friendly prompt.
    if (!deadlock) {
      s.rescuing = false;
      s.gaveUp = false;
    }

    if (s.mode === "campaign") {
      if (s.level.milestone === "boss") {
        // Boss objective: meet the archetype goal before moves run out.
        if (this._bossObjectiveRemaining() === 0) {
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
        // Reaching the score target is not enough to clear a campaign board:
        // if bubbles remain, the player must keep clearing/rescue them.
        if (deadlock && this._offerIsolatedRescue()) return;
        this._scheduleEnd(false, "fail");
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
    } else if (s.mode === "puzzle") {
      // A puzzle is solved by clearing the board (handled above). Running out
      // of moves before that fails the attempt. If the board instead jams on
      // bubbles that can never be popped or shifted into a match (a genuine
      // deadlock with moves to spare), the player has done all they can — sweep
      // the un-poppable stragglers in a finale and award the clear.
      if (s.movesLeft <= 0) {
        this._scheduleEnd(false, "puzzlefail");
      } else if (deadlock) {
        this._finishPuzzleStragglers();
      }
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

  // Creep the vine threat by one cell per resolved move. Plays only on a live
  // gameplay board (never the tutorial sandbox, which returns earlier). A small
  // cue marks the new growth so the player notices the threat expanding.
  _spreadVines() {
    const s = this.session;
    if (!s || s.ended || s.mode === "tutorial") return;
    if (!s.board || typeof s.board.spreadVines !== "function") return;
    const sprouted = s.board.spreadVines();
    if (!sprouted) return;
    const p = s.board.targetPixel(sprouted.c, sprouted.r);
    this.floating.spawn(p.x, p.y - 24, "🌿", "#7ff0a0", 18);
  }

  // Downpour pressure for advanced campaign levels: tick a per-move counter and,
  // every `interval` resolved moves, drop a fresh row of bubbles in from the top
  // (Board.dropRow animates them falling onto each column's stack). The board
  // climbs toward the ceiling; the player is buried only when an entire rain
  // tick finds no room in any column. Returns true when it ended the level.
  _downpour() {
    const s = this.session;
    if (!s || s.ended || s.mode !== "campaign") return false;
    if (!s.downpour || typeof s.board.dropRow !== "function") return false;
    if (this.finale.active) return false; // never drop mid clear-finale
    s.movesSinceDrop = (s.movesSinceDrop || 0) + 1;
    const interval = Math.max(1, s.downpour.interval || 6);
    if (s.movesSinceDrop < interval) return false;
    s.movesSinceDrop = 0;

    const { added, buried } = s.board.dropRow();
    if (added && added.length) {
      Audio.pop(1, 2);
      vibrate(12);
      this.floating.spawn(this.W / 2, TOP_INSET + 18, "🌧️ Downpour!", "#9fd8ff", 24);
      // Rain relief: one extra move per drop event.
      const bonusMoves = DOWNPOUR_MOVES_PER_DROP;
      s.movesLeft = (s.movesLeft || 0) + bonusMoves;
      this.floating.spawn(
        this.W / 2,
        TOP_INSET + 42,
        `+${bonusMoves} Move${bonusMoves === 1 ? "" : "s"}`,
        "#c9ff9d",
        20
      );
    }
    if (buried && buried.length >= s.board.cols) {
      // Once the score target is already met, downpour should not steal the
      // win condition; pressure only applies while you're still chasing target.
      const target = s.level && typeof s.level.target === "number" ? s.level.target : 0;
      if (target > 0 && s.score >= target) return false;
      // Every column was blocked at the top — nowhere left to rain.
      this._scheduleEnd(false, "buried");
      return true;
    }
    this.refreshHud();
    return false;
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
      s.mode === "campaign" || s.mode === "puzzle"
        ? s.movesLeft > 0
        : s.shiftTokens > 0;
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
    if (!isPowerupUnlocked("pick")) return false;

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

  // The deadlock is escapable if Pick is unlocked and the player owns or can buy one.
  _canRescue() {
    if (!isPowerupUnlocked("pick")) return false;
    return Economy.getPowerup("pick") > 0 || Economy.coins >= POWERUP_INFO.pick.price;
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

  _ensureToolInLoadout(type) {
    const loadout = Storage.getLoadout();
    if (loadout.includes(type)) return;
    const slot = loadout.findIndex((item) => !item);
    Storage.setLoadoutSlot(slot === -1 ? 0 : slot, type);
  }

  // "Use Pick" — buy one if needed, then arm it so the next tap clears a lone
  // bubble. The player stays in the level (rescue mode) until the board clears
  // or they give up.
  _rescueWithPick() {
    const s = this.session;
    if (!s) return;
    if (!isPowerupUnlocked("pick")) return;
    if (Economy.getPowerup("pick") <= 0) {
      if (!Economy.buyPowerup("pick")) {
        UI.toast("Not enough coins for a Pick");
        return;
      }
      UI.updatePowerups();
      UI.refreshCoins();
    }
    this._ensureToolInLoadout("pick");
    UI.showRescueTool("pick");
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
    UI.clearRescueTool();
    UI.hideIsolatedHelp();
    this.afterMove(); // re-evaluate: rescue is declined, so the level ends
  }

  // ---- Puzzle straggler sweep ------------------------------------------
  // When a puzzle board deadlocks on un-poppable bubbles (no group to pop and
  // no shift that creates one) but moves remain, the player has cleared
  // everything that *can* be cleared. Burst the remaining stragglers in one
  // celebratory sweep and resolve the level as a solved puzzle.
  _finishPuzzleStragglers() {
    const s = this.session;
    if (!s || s.finishing || s.ended) return;
    s.finishing = true;
    this.input.setEnabled(false);
    this.alienShip.stop();
    const palette = this.theme.bubbles;
    for (let c = 0; c < s.board.cols; c++) {
      for (let r = 0; r < s.board.rows; r++) {
        if (s.board.grid[c][r] === -1) continue;
        const px = s.board.targetPixel(c, r);
        const ci = s.board.grid[c][r];
        const hex =
          palette[((ci % palette.length) + palette.length) % palette.length] ||
          "#ffffff";
        this.particles.burst(px.x, px.y, hex, 14, 1.2);
        s.board.forceRemove(c, r);
      }
    }
    s.board.settle();
    Audio.pop(4, 8);
    this.shake.add(0.5);
    vibrate(30);
    this.floating.spawn(this.W / 2, this.H / 2, "BOARD CLEAR!", "#ffd35b", 30);
    s.finishing = false;
    s.score += clearBonus(Math.max(0, s.movesLeft));
    this._scheduleEnd(true, "puzzle");
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
    // Drop any in-flight pet/finale flourish so its async onDone can't re-run
    // afterMove after the session has resolved.
    this.petAnim.clear();
    this.finale.cancel();
    this.activeEvent = false;
    clearTimeout(this._endTimer);

    const start = performance.now();
    const maxWaitMs = 5600;
    const waitStepMs = 40;
    const finishWhenSettled = () => {
      const cur = this.session;
      if (!cur) return;
      const settled = !cur.board || cur.board.isIdle();
      const timedOut = performance.now() - start >= maxWaitMs;
      if (settled || timedOut) {
        this._finish(won, reason);
        return;
      }
      this._endTimer = setTimeout(finishWhenSettled, waitStepMs);
    };

    // Keep a short baseline pause so the final action still breathes, then
    // wait for any remaining board animation frames before showing the modal.
    this._endTimer = setTimeout(finishWhenSettled, 220);
  }

  async _finish(won, reason) {
    const s = this.session;
    this._clearActiveSession();

    // The Piggy Bank banks a slice of every finished level's score (capped).
    this._depositPiggy(s.score);

    if (s.mode === "campaign") {
      if (won) {
        const stars = Math.max(1, starsForScore(s.level, s.score));
        const unlockedBefore = Storage.get("maxUnlockedLevel");
        Storage.recordLevelResult(s.level.id, stars);
        const unlockedAfter = Storage.get("maxUnlockedLevel");
        const toolUnlocks = powerupsUnlockedBetween(unlockedBefore, unlockedAfter);
        const petUnlocks = petFeaturesUnlockedBetween(unlockedBefore, unlockedAfter);
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
            rewardBits.push(`🎁 +${tr.bonus} bonus coins`);
            const toolReward = this._resolvePowerupReward(tr.powerup, 1);
            if (toolReward.powerup) {
              Economy.addPowerup(toolReward.powerup.id, toolReward.powerup.n);
              rewardBits.push(`Free ${toolReward.powerup.icon} ${toolReward.powerup.name}`);
            } else {
              bonusCoins += toolReward.coins;
              rewardBits.push(`Locked-tool bonus: +${toolReward.coins} coins`);
            }
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
        toolUnlocks.forEach((unlock) => this._grantToolUnlock(unlock));
        petUnlocks.forEach((unlock) => this._grantPetFeatureUnlock(unlock));

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
        this._pendingWinChoices = this._buildWinChoices(s, stars, unlockedBefore);
        this._recordProgress({
          levelsCleared: Storage.get("maxUnlockedLevel") - 1,
          totalStars: Storage.totalStars(),
          coinsEarned: totalCoins,
        });
        // Season Pass XP scales with the star result of the clear.
        this._awardSeasonXp(30 + stars * 15);
        // Quest progress: a campaign level was won.
        this._recordQuestProgress({ levelsWon: 1 });
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
          rewardChoices: this._pendingWinChoices,
          hasPendingUnlock: !!this._pendingToolUnlock,
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
          title:
            reason === "buried"
              ? "Buried!"
              : reason === "timeout"
              ? "Time's Up!"
              : s.movesLeft <= 0
              ? "Out of Moves"
              : "No Moves Left",
          tip: this._loseTip(s, reason),
          tools: this._loseToolHints(s.level),
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
    } else if (s.mode === "puzzle") {
      const idx = s.level.puzzleIndex;
      if (won) {
        const stars = puzzleStars(s.movesLeft, s.level.moves);
        const res = Storage.recordPuzzleResult(idx, stars);
        const coins = Math.round(
          (Math.floor(s.score / 200) + stars * 25) * s.petBuffs.coinMult
        );
        s.coinsEarned = coins;
        Economy.addCoins(coins);
        this._awardSeasonXp(20 + stars * 10);
        Audio.win();
        UI.setWinTitle("Puzzle Solved!");
        const bits = [];
        if (res.firstSolve && idx + 1 < PUZZLE_COUNT) {
          bits.push(`🔓 Puzzle ${idx + 2} unlocked`);
        } else if (res.isNewBest) {
          bits.push("🏆 New best!");
        }
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
          // Advance straight into the next puzzle if it now exists.
          showNext: idx + 1 < PUZZLE_COUNT,
          showDouble: !Monetization.isAdsRemoved(),
        });
      } else {
        Audio.lose();
        // No revive: a puzzle is defined by its fixed move budget, so the only
        // way forward is to retry the same board from scratch.
        UI.showLose({
          score: s.score,
          showRevive: false,
          title: s.movesLeft <= 0 ? "Out of Moves" : "Stuck!",
        });
      }
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
  _showPendingProgressUnlock() {
    if (!this._pendingToolUnlock) return false;
    UI.showToolUnlock(this._pendingToolUnlock);
    return true;
  }

  nextLevel() {
    if (this._showPendingProgressUnlock()) return;
    const s = this.session;
    if (s && s.mode === "campaign") this.startCampaign(s.level.id + 1);
    else if (s && s.mode === "puzzle") this.startPuzzle(s.level.puzzleIndex + 1);
  }

  _grantToolUnlock(unlock) {
    const info = POWERUP_INFO[unlock.type];
    if (!info) return;
    if (Economy.getPowerup(unlock.type) <= 0) Economy.addPowerup(unlock.type, 1);
    this._ensureToolInLoadout(unlock.type);
    this._queueProgressUnlock(unlock);
  }

  _grantPetFeatureUnlock(unlock) {
    if (!unlock || !unlock.feature) return;
    if (unlock.feature === "pets") {
      if (!Storage.ownsPet("sparky")) Storage.grantPet("sparky", "balanced");
      Storage.equipPet("sparky");
    } else if (unlock.feature === "crates") {
      if (Storage.getPetState().crates <= 0) Storage.addCrates(PET_FEATURE_GRANTS.crates.crates);
    } else if (unlock.feature === "abilities") {
      Storage.addDust(PET_FEATURE_GRANTS.abilities.dust);
    } else if (unlock.feature === "party") {
      Storage.addDust(PET_FEATURE_GRANTS.party.dust);
    }
    this._queueProgressUnlock(unlock);
    UI.refreshPetAccess();
    UI.updatePetHud(Storage.getEquippedPet());
  }

  _buildWinChoices(session, stars, unlockedLevel = Storage.get("maxUnlockedLevel")) {
    this._winChoiceClaimed = false;
    if (!session || session.mode !== "campaign") return [];
    const levelId = session.level ? session.level.id : 1;
    const choices = [
      {
        id: "coins",
        icon: "🪙",
        title: `+${60 + stars * 30} coins`,
        desc: "Bank a little extra now",
        reward: { type: "coins", amount: 60 + stars * 30 },
      },
      {
        id: "seasonxp",
        icon: "⭐",
        title: "+20 season XP",
        desc: "Push the reward track forward",
        reward: { type: "seasonxp", amount: 20 },
      },
    ];
    const tools = this._suggestedToolsForLevel(session.level).filter((type) => isPowerupUnlocked(type, unlockedLevel));
    const tool = tools.find((type) => Economy.getPowerup(type) < 3) || tools[0];
    if (tool && POWERUP_INFO[tool]) {
      choices.push({
        id: `tool:${tool}`,
        icon: POWERUP_INFO[tool].icon,
        title: `+1 ${POWERUP_INFO[tool].name}`,
        desc: "Prep for the next tricky board",
        reward: { type: "tool", tool, amount: 1 },
      });
    }
    if (isPetFeatureUnlocked("pets", Storage.get("maxUnlockedLevel")) && Storage.getEquippedPet()) {
      choices.push({
        id: "petxp",
        icon: "🐾",
        title: "+18 pet XP",
        desc: "Level your lead companion faster",
        reward: { type: "petxp", amount: 18 },
      });
    } else if (isPetFeatureUnlocked("crates", Storage.get("maxUnlockedLevel"))) {
      choices.push({
        id: "dust",
        icon: "✨",
        title: "+12 Pet Dust",
        desc: "Save toward gems and companions",
        reward: { type: "dust", amount: 12 },
      });
    }
    if (isPetFeatureUnlocked("crates", Storage.get("maxUnlockedLevel")) && levelId % 3 === 0) {
      choices.push({
        id: "crate",
        icon: "🧰",
        title: "+1 pet crate",
        desc: "Open a new companion roll",
        reward: { type: "crate", amount: 1 },
      });
    }
    return choices.slice(0, 3);
  }

  claimWinChoice(id) {
    if (!id || !this._pendingWinChoices || this._winChoiceClaimed) return false;
    const choice = this._pendingWinChoices.find((c) => c.id === id);
    if (!choice) return false;
    const reward = choice.reward || {};
    if (reward.type === "coins") Economy.addCoins(reward.amount || 0);
    else if (reward.type === "tool") this._grantPowerupReward(reward.tool, reward.amount || 1);
    else if (reward.type === "seasonxp") this._awardSeasonXp(reward.amount || 0);
    else if (reward.type === "petxp") {
      const pet = Storage.getEquippedPet();
      if (!pet) return false;
      Storage.addPetXp(pet.id, reward.amount || 0);
      UI.updatePetHud(Storage.getEquippedPet());
    } else if (reward.type === "dust") Storage.addDust(reward.amount || 0);
    else if (reward.type === "crate") Storage.addCrates(reward.amount || 1);
    else return false;
    this._winChoiceClaimed = true;
    UI.refreshCoins();
    UI.updatePowerups();
    return true;
  }

  _suggestedToolsForLevel(level) {
    const specials = (level && level.specials) || {};
    const picks = [];
    const add = (type) => {
      if (!picks.includes(type)) picks.push(type);
    };
    if (level && level.boss) add("chainBolt"), add("bomb"), add("pick");
    if (specials.stone || specials.vine || specials.ice) add("pick"), add("bomb");
    if (specials.lightning || specials.bomb) add("colorClear"), add("chainBolt");
    if (level && level.objective && level.objective.type === "group") add("magnet"), add("paint"), add("colorClear");
    if (level && level.objective && level.objective.type === "combo") add("shuffle"), add("paint"), add("magnet");
    if (level && level.moves <= 10) add("undo"), add("shuffle");
    add("undo");
    add("shuffle");
    add("bomb");
    return picks;
  }

  suggestLoadout() {
    const s = this.session;
    if (!s || s.mode !== "campaign") return false;
    const tools = this._suggestedToolsForLevel(s.level).filter((type) => isPowerupUnlocked(type));
    if (!tools.length) return false;
    tools.slice(0, 3).forEach((type, index) => Storage.setLoadoutSlot(index, type));
    UI.updatePowerups();
    return true;
  }

  _loseTip(session, reason) {
    const level = session && session.level;
    if (reason === "buried") return "Keep the top rows open. Clear tall columns before downpour pressure stacks up.";
    if (reason === "timeout") return "Keep popping to stay ahead of the clock. Waiting will not bring extra gifts.";
    if (level && level.boss) return "Focus the boss objective first. Score usually follows once the locked core starts breaking.";
    if (level && level.objective && level.objective.type === "combo") return "Use smaller pops to extend the combo chain instead of spending every large group at once.";
    if (level && level.objective && level.objective.type === "group") return "Leave matching colors connected for one bigger group before cashing it in.";
    if (session && session.score < level.target) return "Aim for larger groups and cascades early; the target is easier before the board gets sparse.";
    return "You had the score. Spend tools late to clean up isolated blockers and finish the board.";
  }

  _loseToolHints(level) {
    return this._suggestedToolsForLevel(level)
      .filter((type) => isPowerupUnlocked(type) && POWERUP_INFO[type])
      .slice(0, 3)
      .map((type) => `${POWERUP_INFO[type].icon} ${POWERUP_INFO[type].name}`);
  }

  _queueProgressUnlock(unlock) {
    this._pendingToolUnlocks.push(unlock);
    if (!this._pendingToolUnlock) this._pendingToolUnlock = this._pendingToolUnlocks.shift();
  }

  _continueAfterToolUnlock() {
    const s = this.session;
    UI.hideModals();
    this._pendingToolUnlock = this._pendingToolUnlocks.shift() || null;
    if (this._pendingToolUnlock) {
      UI.showToolUnlock(this._pendingToolUnlock);
      return;
    }
    if (s && s.mode === "campaign") this.startCampaign(s.level.id + 1);
    else this.quitToMenu();
  }

  retryLevel() {
    const s = this.session;
    if (!s) return this.quitToMenu();
    if (s.mode === "campaign") this.startCampaign(s.level.id);
    else if (s.mode === "endless") this.startEndless();
    else if (s.mode === "timeattack") this.startTimeAttack();
    else if (s.mode === "tournament") this.startTournament();
    else if (s.mode === "puzzle") this.startPuzzle(s.level.puzzleIndex);
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
    this._pendingToolUnlock = null;
    this.session = null;
    this.input.setEnabled(false);
    UI.clearFallingEvents();
    this.alienShip.stop();
    UI.clearRescueTool();
    // Drop any in-flight pet/finale flourish so its async onDone can't fire
    // afterMove on the now-null session (or the next level's fresh one).
    this.petAnim.clear();
    this.finale.cancel();
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
      if (
        this.session.pendingFinale &&
        !this.session.ended &&
        !this.session.finishing &&
        this.session.board.isIdle()
      ) {
        this.session.pendingFinale = false;
        this.afterMove();
      }
      this._updateScreenTimer(dt);
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
      if (this.isBlastReady()) {
        const best = this._bestBlastTarget();
        if (best) {
          if (!this.session.blastCue) this._showBlastCue();
          else {
            this.session.blastCue.c = best.c;
            this.session.blastCue.r = best.r;
            this.session.blastCue.count = best.count;
          }
        } else {
          this.session.blastCue = null;
        }
      } else if (this.session.blastCue) {
        this.session.blastCue = null;
      }
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

  _noteBoardActivity() {
    const s = this.session;
    if (!s) return;
    s.boardInteracted = true;
    s.boardIdleTime = 0;
  }

  _updateScreenTimer(dt) {
    const s = this.session;
    if (!s || s.ended || !s.screenTimeLeft) return;
    const beforeShown = Math.ceil(s.screenTimeLeft);
    s.screenTimeLeft = Math.max(0, s.screenTimeLeft - dt);
    const afterShown = Math.ceil(s.screenTimeLeft);
    if (afterShown !== beforeShown || afterShown !== s.screenTimeShown) {
      s.screenTimeShown = afterShown;
      this.refreshHud();
    }
    if (s.screenTimeLeft > 0) return;
    if (s.mode === "campaign") this._scheduleEnd(false, "timeout");
    else if (s.mode === "puzzle") this._scheduleEnd(false, "puzzlefail");
    else if (s.mode === "daily") this._scheduleEnd(true, "daily");
    else if (s.mode === "tournament") this._scheduleEnd(true, "tournament");
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
    s.boardIdleTime = Math.min(EVENT_BOARD_IDLE_GRACE + 1, (s.boardIdleTime || 0) + dt);
    if (!s.boardInteracted || s.boardIdleTime > EVENT_BOARD_IDLE_GRACE) return;
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
    if (type === EVENT_PROBLEM) desc.effect = rollProblemEffect();
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
      } else if (reward.type === "gem") {
        const key = this._grantRolledGem(0.2);
        const g = parseGemKey(key);
        const icon = g ? g.def.icon : "💎";
        this.floating.spawn(cx, cy, `${icon} Gem!`, "#bde0fe", 28);
        UI.toast(`🎁 Gift: a ${gemLabel(key)}! Socket it in the Pets menu`);
      } else if (reward.type === "powerup") {
        const toolReward = this._grantPowerupReward(reward.powerup, 1);
        UI.updatePowerups();
        if (toolReward.powerup) {
          this.floating.spawn(cx, cy, `+1 ${toolReward.powerup.name}`, "#5bff9b", 28);
          UI.toast(`🎁 Gift: +1 ${toolReward.powerup.name}!`);
        } else {
          this.floating.spawn(cx, cy, `+${toolReward.coins}`, "#ffd35b", 30);
          UI.toast(`🎁 Gift: +${toolReward.coins} coins!`);
        }
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
      this._applyProblemEffect(desc.effect || rollProblemEffect());
    }
    this._resolveEvent();
  }

  _applyProblemEffect(effect) {
    const s = this.session;
    if (!s || s.ended) return false;
    const board = s.board;
    let cells = [];
    let toast = "⚠️ Problem landed!";
    let color = "#ff4d63";
    if (effect === PROBLEM_EFFECT_SHUFFLE) {
      board.shuffle();
      cells = this._sampleFilledCells(10);
      toast = "⚠️ Board scrambled!";
      color = "#ffb347";
    } else if (effect === PROBLEM_EFFECT_MOVES) {
      const penalty = s.mode === "timeattack" ? 5 : 2;
      if (s.mode === "timeattack") {
        s.timeLeft = Math.max(0, (s.timeLeft || 0) - penalty);
        toast = `⚠️ -${penalty}s penalty!`;
      } else if (Number.isFinite(s.movesLeft)) {
        s.movesLeft = Math.max(0, s.movesLeft - penalty);
        toast = `⚠️ -${penalty} moves!`;
      }
      cells = this._sampleFilledCells(6);
      color = "#ffd35b";
    } else if (effect === PROBLEM_EFFECT_FREEZE) {
      cells = this._freezeRandomCells(3);
      toast = "⚠️ Bubbles frozen!";
      color = "#9be7ff";
    } else if (effect === PROBLEM_EFFECT_VINE) {
      cells = this._seedProblemVine();
      toast = "⚠️ Vine sprouted!";
      color = "#68d66b";
    } else {
      const anchor = board.randomFilledCell();
      if (anchor) cells = board.scatterArea(anchor.c, anchor.r, SCATTER_COUNT);
      toast = "⚠️ Bubbles scattered!";
    }
    for (const cell of cells) {
      const t = board.targetPixel(cell.c, cell.r);
      this.particles.burst(t.x, t.y, color, 10, 0.7);
    }
    this.shake.add(0.3);
    UI.toast(toast);
    Audio.lose();
    vibrate(40);
    this.refreshHud();
    return true;
  }

  _sampleFilledCells(count = 6) {
    const s = this.session;
    const out = [];
    if (!s || !s.board) return out;
    for (let c = 0; c < s.board.cols; c++)
      for (let r = 0; r < s.board.rows; r++)
        if (s.board.grid[c][r] !== -1) out.push({ c, r });
    return out.slice(0, Math.max(0, count));
  }

  _freezeRandomCells(count = 3) {
    const s = this.session;
    const board = s && s.board;
    if (!board) return [];
    const cells = [];
    for (let c = 0; c < board.cols; c++)
      for (let r = 0; r < board.rows; r++)
        if (board.grid[c][r] !== -1 && board.types[c][r] === NORMAL)
          cells.push({ c, r });
    const chosen = cells.slice(0, Math.max(0, count));
    for (const cell of chosen) {
      board.types[cell.c][cell.r] = ICE;
      const sp = board.spriteGrid[cell.c][cell.r];
      if (sp) sp.scale = 0.6;
    }
    return chosen;
  }

  _seedProblemVine() {
    const s = this.session;
    const board = s && s.board;
    if (!board) return [];
    const cell = board.randomFilledCell();
    if (!cell || board.types[cell.c][cell.r] !== NORMAL) return [];
    board.types[cell.c][cell.r] = VINE;
    const sp = board.spriteGrid[cell.c][cell.r];
    if (sp) sp.scale = 0.6;
    return [cell];
  }

  render(time) {
    const ctx = this.ctx;
    this.renderer.drawBackground(this.W, this.H, this.theme, time);
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    if (this.session) {
      this.renderer.drawBoardFrame(this.session.board);
      // Downpour: warn the player when the rising stack climbs into the top
      // rows, so being buried never feels unfair.
      if (this.session.downpour) {
        const dangerRows = 2;
        const top = this.session.board.topFilledRow();
        if (top <= dangerRows) {
          const proximity = (dangerRows + 1 - top) / (dangerRows + 1);
          this.renderer.drawDangerLine(
            this.session.board,
            time,
            dangerRows,
            proximity
          );
        }
      }
      // While aiming a magnet, shake the target-colour bubbles harder the
      // closer the gauge needle is to the (randomised) green sweet spot.
      let aim = null;
      const m = this.session.magnet;
      if (m && m.aiming) {
        const sweet = m.sweet == null ? 0.5 : m.sweet;
        const closeness = Math.max(0, 1 - Math.abs(m.value - sweet) / MAGNET_HALF);
        aim = { color: m.color, intensity: closeness, time };
      }
      const markColor =
        this.session.bossKind === "color" ? this.session.bossTargetColor : -1;
      this.renderer.drawBubbles(this.session.board, this.theme, aim, markColor);
      if (this.session.archerAim) {
        this.renderer.drawArcherAim(this.session.board, this.session.archerAim, time);
      }
      if (this.session.blastCue) {
        const cue = this.session.blastCue;
        if (this.session.board.grid[cue.c]?.[cue.r] === -1) this.session.blastCue = null;
        else this.renderer.drawBlastCue(this.session.board, cue, time);
      }
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
    pets: { petBuffs, petActive, levelForXp, rollCrate, rollLegendaryCrate, getPet, PET_CATALOG, pityRarityFloor, nextPity, dustValue, PITY_EPIC, PITY_LEGENDARY, rollTrait, getTrait, TRAITS, partyBuffs, partyTotalBuffs, activeSynergies, SYNERGIES, SUPPORT_SLOTS },
    gems: { GEM_CATALOG, GEM_TIERS, socketsForLevel, socketBuffs, socketActiveMods, rollGem, gemKey, parseGemKey, gemDustCost, getGemDef, getGemTier, gemLabel, canSocketGemAtLevel, maxGemTierForLevel, levelForGemTier, socketDustCost, unsocketDustRefund, MAX_SOCKETS, FUSE_COUNT, nextGemTier, prevGemTier, canFuseTier, fusedGemKey },
    tech: { TECH_TREE, techNode, techTierOf, pendingTechTier, hasPendingTech, canPickTech, techTiersUnlocked },
    calendar: { calendarStatus, advanceCalendar, todayKey },
    season: { seasonStatus, addSeasonXp, claimTier, tierReward },
    quests: { ensureQuests, applyQuestProgress, claimQuest, questsClaimable, todayKey, weekKey },
    piggy: { piggyDeposit, canCrackPiggy },
    puzzle: { getPuzzle, puzzleStars, isPuzzleUnlocked, PUZZLE_COUNT },
    popStyle: popStyleForGroup,
    cascade: { cascadeBonus, cascadeTier },
    tournament: { getTournamentLevel, getTournamentGoals, tournamentRank, getTournamentBest },
    timeattack: { seconds: TIME_ATTACK_SECONDS },
    themeMotif,
    Audio,
  };
}
