// DOM-based UI: menus, level map, shop, themes, HUD, modals, toasts.
import { Storage } from "./storage.js";
import { LEVEL_COUNT, getLevel, CHAPTER_SIZE, AUTHORED_LEVELS, chapterForLevel } from "./levels.js";
import { milestoneType } from "./milestones.js";
import {
  THEMES,
  getTheme,
  isThemeUnlocked,
  applyThemeCss,
} from "./themes.js";
import {
  Economy,
  POWERUP_INFO,
  COIN_PACKS,
  STARTER_PACK,
  isPowerupUnlocked,
  nextPowerupUnlock,
  powerupUnlockLevel,
  unlockedPowerups,
} from "./economy.js";
import { Monetization } from "./monetization.js";
import { Audio } from "./audio.js";
import {
  getDailyModifier,
  getStreak,
  getFreezeTokens,
  alreadyPlayedToday,
} from "./daily.js";
import {
  getTournamentBest,
  getTournamentModifier,
  tournamentDaysLeft,
} from "./tournament.js";
import {
  ACHIEVEMENT_CATEGORIES,
  categoryStatus,
  claimableCount,
} from "./achievements.js";
import {
  CALENDAR_REWARDS,
  CALENDAR_CYCLE,
  calendarStatus,
} from "./calendar.js";
import {
  SEASON_TIERS,
  SEASON_TIER_COUNT,
  seasonStatus,
  tierReward,
} from "./season.js";
import { todayKey, weekKey } from "./rng.js";
import {
  ensureQuests,
  questDef,
  isQuestComplete,
  isQuestClaimable,
  questsClaimable,
} from "./quests.js";
import { buildStats as buildStatsData, formatStat } from "./stats.js";
import {
  canCrackPiggy,
  piggyFillPct,
  PIGGY_CAP,
  PIGGY_MIN_CRACK,
  PIGGY_CRACK_PRICE,
} from "./piggy.js";
import {
  PUZZLES,
  PUZZLE_COUNT,
  getPuzzle,
  isPuzzleUnlocked,
  puzzlesSolved,
} from "./puzzle.js";
import {
  PET_CATALOG,
  COSMETICS,
  getPet,
  getCosmetic,
  petBuffs,
  petActive,
  PET_FEATURE_INFO,
  isPetFeatureUnlocked,
  nextPetFeatureUnlock,
  petFeatureUnlockLevel,
  levelForXp,
  levelProgress,
  MAX_PET_LEVEL,
  CRATE_COST,
  LEGENDARY_CRATE,
  premiumPets,
  getTrait,
  SUPPORT_SLOTS,
  activeSynergies,
} from "./pets.js";
import {
  GEM_CATALOG,
  GEM_TIERS,
  socketsForLevel,
  getGemDef,
  getGemTier,
  gemKey,
  parseGemKey,
  gemLabel,
  gemIcon,
  gemValue,
  gemDustCost,
  gemTierIndex,
  maxGemTierForLevel,
  levelForGemTier,
  gemBuffLabel,
  socketDustCost,
  unsocketDustRefund,
  FUSE_COUNT,
  fusedGemKey,
  canFuseTier,
  prevGemTier,
} from "./gems.js";
import {
  TECH_TREE,
  techTierAt,
  techNode,
  pendingTechTier,
  hasPendingTech,
  techTiersUnlocked,
} from "./tech.js";

const $ = (id) => document.getElementById(id);

class UIManager {
  constructor() {
    this.cb = {};
    this.el = {};
    // Optional override (ms) for the hold-to-buy repeat rate. When null, the
    // rate comes from the persisted `buyRepeatMs` setting (default 500ms = 2/s).
    this.buyHoldInterval = null;
    this.buyHoldMax = null;
  }

  init() {
    const ids = [
      "menu", "levelmap", "shop", "themes", "hud", "win", "lose",
      "menu-coins", "lm-coins", "shop-coins", "themes-coins", "hud-coins",
      "level-grid", "shop-list", "theme-list",
      "level-brief", "brief-title", "brief-sub", "brief-stats", "brief-replay", "brief-objective", "brief-hazards", "brief-tools", "brief-cancel", "brief-start",
      "achievements", "achv-list", "achv-count", "btn-achievements", "achv-back",
      "achv-badge", "achv-collect-all",
      "calendar", "cal-grid", "cal-status", "cal-claim", "cal-back",
      "btn-calendar", "cal-badge",
      "quests", "quests-list", "quests-back", "btn-quests", "quests-badge",
      "stats", "stats-profile", "stats-lifetime", "stats-back", "btn-stats",
      "puzzle", "puzzle-list", "puzzle-back", "btn-puzzle", "puzzle-badge",
      "season", "season-track", "season-coins", "season-back", "season-buy",
      "season-xp-label", "season-xp-fill", "btn-season", "season-badge",
      "chest", "chest-icon", "chest-title", "chest-sub", "chest-rewards", "chest-ok",
      "cb-toggle", "cb-toggle-state",
      "hints-toggle", "hints-toggle-state",
      "rm-toggle", "rm-toggle-state",
      "buy-batch-pref", "buy-speed-pref",
      "pets", "pets-coins", "pets-crate", "pet-party", "pet-gems", "pet-gem-tip", "pet-store", "pet-list", "pet-detail",
      "gem-forge", "gemforge-body", "gemforge-dust", "gemforge-back",
      "pause", "pause-sub", "pause-summary", "pause-resume", "pause-shop", "pause-themes", "pause-retry", "pause-menu",
      "pet-confirm", "pet-confirm-sub", "pet-confirm-ok", "pet-confirm-cancel",
      "gem-remove", "gem-remove-sub", "gem-remove-ok", "gem-remove-cancel",
      "pet-reveal", "pet-reveal-confetti", "pet-reveal-congrats", "pet-reveal-glow",
      "pet-reveal-icon", "pet-reveal-name", "pet-reveal-rarity", "pet-reveal-ability",
      "pet-reveal-desc", "pet-reveal-close", "pet-reveal-equip",
      "btn-pets", "pets-back", "hud-pet", "hud-pet-icon", "hud-pet-buff", "pets-badge",
      "btn-continue", "daily-summary",
      "hud-mode-label", "hud-score", "hud-target", "hud-target-wrap", "hud-target-label",
      "hud-moves", "hud-moves-label", "hud-progress-fill", "hud-status",
      "hud-objective", "hud-objective-text",
      "power-meter", "power-fill", "power-label",
      "fever-meter", "fever-fill", "fever-label",
      "powerups", "pu-slot-0", "pu-slot-1", "pu-slot-2",
      "loadout", "loadout-list", "loadout-sub", "loadout-close",
      "tool-unlock", "tool-unlock-icon", "tool-unlock-name", "tool-unlock-level",
      "tool-unlock-desc", "tool-unlock-lesson", "tool-unlock-ok",
      "magnet-gauge", "mg-needle",
      "events-layer",
      "combo-banner", "toast",      "win-stars", "win-score", "win-reward", "win-double", "win-next", "win-menu",
      "win-stats", "win-coins", "win-coins-num",
      "win-chest", "win-chest-art", "win-chest-burst", "win-chest-hint", "win-reward-reveal", "win-choice", "win-choice-list",
      "lose-score", "lose-revive", "lose-retry", "lose-menu", "lose-tip",
      "isolated", "iso-msg", "iso-pick", "iso-giveup",
      "btn-daily",
      "btn-tournament", "tournament-summary",
      "btn-timeattack",
      "btn-sound",
      "btn-tutorial", "tutorial", "coach-progress", "coach-title",
      "coach-body", "coach-hint", "coach-next", "coach-skip",
    ];
    ids.forEach((id) => (this.el[id] = $(id)));
    this._wireStaticButtons();
    this._organizeMenuSections();
  }

  bind(callbacks) {
    this.cb = callbacks;
  }

  _wireStaticButtons() {
    const click = (id, fn) => {
      const e = $(id);
      if (e) e.addEventListener("click", () => { Audio.click(); fn(); });
    };

    // Main menu
    click("btn-continue", () => this.cb.resumeCampaign && this.cb.resumeCampaign());
    click("btn-play", () => this.showScreen("levelmap"));
    click("btn-endless", () => this.cb.startEndless && this.cb.startEndless());
    click("btn-daily", () => this.cb.startDaily && this.cb.startDaily());
    click("btn-tournament", () => this.cb.startTournament && this.cb.startTournament());
    click("btn-timeattack", () => this.cb.startTimeAttack && this.cb.startTimeAttack());
    click("btn-shop", () => this.showScreen("shop"));
    click("btn-themes", () => this.showScreen("themes"));
    click("btn-achievements", () => this.showScreen("achievements"));
    click("btn-calendar", () => this.showScreen("calendar"));
    click("btn-quests", () => this.showScreen("quests"));
    click("btn-stats", () => this.showScreen("stats"));
    click("btn-puzzle", () => this.showScreen("puzzle"));
    click("btn-season", () => this.showScreen("season"));
    click("btn-pets", () => this.openPetOverlay());
    click("btn-tutorial", () => this.cb.startTutorial && this.cb.startTutorial());

    // Back buttons
    click("lm-back", () => this.showScreen("menu"));
    click("brief-cancel", () => this.closeLevelBrief());
    click("brief-start", () => this.startBriefedLevel());
    // Shop can be reached from the menu OR popped open mid-level when the
    // player taps an empty tool slot. In the latter case, returning resumes the
    // paused level instead of dropping back to the menu.
    click("shop-back", () => this.closeShop());
    click("themes-back", () => this.closeThemes());
    click("achv-back", () => this.showScreen("menu"));
    click("achv-collect-all", () => this._claimAllAchievements());
    click("cal-back", () => this.showScreen("menu"));
    click("quests-back", () => this.showScreen("menu"));
    click("stats-back", () => this.showScreen("menu"));
    click("puzzle-back", () => this.showScreen("menu"));
    click("cal-claim", () => this._claimCalendar());
    click("season-back", () => this.showScreen("menu"));
    click("season-buy", () => this._buySeasonPremium());
    click("pets-back", () => this.closePetOverlay());
    click("gemforge-back", () => this.closeGemForge());
    click("chest-ok", () => this.showScreen("achievements"));
    click("btn-back", () => this.openPauseOverlay());
    click("pause-resume", () => this.closePauseOverlay(true));
    click("pause-shop", () => this._pauseGoShop());
    click("pause-themes", () => this._pauseGoThemes());
    click("pause-retry", () => this._pauseRetry());
    click("pause-menu", () => this._pauseMenu());

    // In-game pet badge doubles as a shortcut to the companion manager.
    click("hud-pet", () => this.openPetOverlay());

    // Switch-companion confirmation (only seen when changing pets mid-level).
    click("pet-confirm-cancel", () => this._cancelEquip());
    click("pet-confirm-ok", () => this._confirmEquip());

    // Gem-removal warning (gems shatter into a small dust refund when removed).
    click("gem-remove-cancel", () => this._cancelUnsocket());
    click("gem-remove-ok", () => this._confirmUnsocket());

    // New-companion celebration buttons.
    click("pet-reveal-close", () => this._closePetReveal());
    click("pet-reveal-equip", () => this._equipFromReveal());

    // Colourblind symbols toggle (lives on the Themes screen).
    click("cb-toggle", () => {
      const settings = { ...(Storage.get("settings") || {}) };
      const on = !settings.colorblind;
      settings.colorblind = on;
      Storage.set("settings", settings);
      if (this.cb.onColorblindChange) this.cb.onColorblindChange(on);
      this._refreshColorblindToggle();
    });

    // Idle-hint assist toggle (Themes screen, next to colourblind).
    click("hints-toggle", () => {
      const settings = { ...(Storage.get("settings") || {}) };
      const on = settings.hints === false; // currently off → turning on
      settings.hints = on;
      Storage.set("settings", settings);
      if (this.cb.onHintsChange) this.cb.onHintsChange(on);
      this._refreshHintsToggle();
    });

    // Reduced-motion accessibility toggle (Themes screen).
    click("rm-toggle", () => {
      const settings = { ...(Storage.get("settings") || {}) };
      const on = !settings.reducedMotion;
      settings.reducedMotion = on;
      Storage.set("settings", settings);
      if (this.cb.onReducedMotionChange) this.cb.onReducedMotionChange(on);
      this._refreshReducedMotionToggle();
    });

    document.querySelectorAll("[data-buy-max]").forEach((btn) => {
      btn.addEventListener("click", () => {
        Audio.click();
        const settings = { ...(Storage.get("settings") || {}) };
        settings.buyBatchMax = Number(btn.dataset.buyMax) || 10;
        Storage.set("settings", settings);
        this._refreshBuyPrefs();
      });
    });
    document.querySelectorAll("[data-buy-ms]").forEach((btn) => {
      btn.addEventListener("click", () => {
        Audio.click();
        const settings = { ...(Storage.get("settings") || {}) };
        settings.buyRepeatMs = Number(btn.dataset.buyMs) || 500;
        Storage.set("settings", settings);
        this._refreshBuyPrefs();
      });
    });

    // Sound
    click("btn-sound", () => {
      const muted = Audio.toggleMute();
      this.el["btn-sound"].textContent = muted ? "♪̸" : "♪";
      this.el["btn-sound"].style.opacity = muted ? "0.5" : "1";
    });

    // Power-up quick-access slots. A short tap arms the slot's power-up; a
    // long-press opens the loadout picker so the player can swap which tool
    // lives in that slot (keeps the HUD to three buttons as we add power-ups).
    this._slots = Array.from(document.querySelectorAll(".powerup-btn"));
    this._slots.forEach((btn) => {
      const slot = Number(btn.dataset.slot);
      let timer = null;
      let longFired = false;
      const startHold = () => {
        longFired = false;
        btn.classList.add("holding");
        timer = setTimeout(() => {
          longFired = true;
          btn.classList.remove("holding");
          Audio.click();
          this.openLoadoutPicker(slot);
        }, 450);
      };
      const cancelHold = () => {
        btn.classList.remove("holding");
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      };
      btn.addEventListener("pointerdown", startHold);
      btn.addEventListener("pointerup", cancelHold);
      btn.addEventListener("pointerleave", cancelHold);
      btn.addEventListener("pointercancel", cancelHold);
      btn.addEventListener("click", () => {
        // A long-press already opened the picker — don't also arm.
        if (longFired) {
          longFired = false;
          return;
        }
        Audio.click();
        const type = btn.dataset.pu;
        if (type && this.cb.armPowerup) this.cb.armPowerup(type, btn);
      });
    });

    // Loadout picker: close button + tap-outside dismiss.
    click("loadout-close", () => this.closeLoadoutPicker());
    click("tool-unlock-ok", () => this.cb.toolUnlockContinue && this.cb.toolUnlockContinue());
    if (this.el["loadout"]) {
      this.el["loadout"].addEventListener("click", (e) => {
        if (e.target === this.el["loadout"]) this.closeLoadoutPicker();
      });
    }

    // Win modal
    click("win-next", () => this.cb.nextLevel && this.cb.nextLevel());
    click("win-menu", () => this.cb.quitToMenu && this.cb.quitToMenu());
    const wd = $("win-double");
    if (wd) wd.addEventListener("click", () => this.cb.doubleCoins && this.cb.doubleCoins());
    const choiceList = $("win-choice-list");
    if (choiceList) {
      choiceList.addEventListener("click", (e) => {
        const btn = e.target.closest(".win-choice-btn");
        if (!btn || btn.disabled) return;
        this.claimWinChoice(btn.dataset.choice);
      });
    }
    // Tap the reward chest to burst it open and reveal the coins.
    const wc = $("win-chest");
    if (wc) wc.addEventListener("click", () => this.openWinChest());

    // Lose modal
    click("lose-retry", () => this.cb.retryLevel && this.cb.retryLevel());
    click("lose-menu", () => this.cb.quitToMenu && this.cb.quitToMenu());
    const lr = $("lose-revive");
    if (lr) lr.addEventListener("click", () => this.cb.reviveLevel && this.cb.reviveLevel());

    // Lone-bubble rescue modal
    click("iso-pick", () => this.cb.rescuePick && this.cb.rescuePick());
    click("iso-giveup", () => this.cb.rescueGiveUp && this.cb.rescueGiveUp());

    // Tutorial coach
    click("coach-next", () => this.cb.tutorialNext && this.cb.tutorialNext());
    click("coach-skip", () => this.cb.tutorialSkip && this.cb.tutorialSkip());

    // Reflect saved mute state
    if (Storage.get("muted")) {
      this.el["btn-sound"].textContent = "♪̸";
      this.el["btn-sound"].style.opacity = "0.5";
    }
  }

  _organizeMenuSections() {
    const menu = document.querySelector(".menu-tiles");
    if (!menu || menu.dataset.grouped === "true") return;
    const groups = [
      ["Play", ["btn-endless", "btn-timeattack", "btn-puzzle"]],
      ["Events", ["btn-daily", "btn-tournament", "btn-quests", "btn-calendar"]],
      ["Progress", ["btn-pets", "btn-achievements", "btn-season", "btn-stats"]],
      ["Shop & Settings", ["btn-shop", "btn-themes"]],
    ];
    const buttons = new Map();
    groups.flatMap(([, ids]) => ids).forEach((id) => {
      const btn = this.el[id] || $(id);
      if (btn) buttons.set(id, btn);
    });
    menu.innerHTML = "";
    groups.forEach(([title, ids]) => {
      const section = document.createElement("section");
      section.className = "menu-group";
      section.setAttribute("aria-label", title);
      const heading = document.createElement("h3");
      heading.className = "menu-group-title";
      heading.textContent = title;
      const grid = document.createElement("div");
      grid.className = "menu-group-grid";
      ids.forEach((id) => {
        const btn = buttons.get(id);
        if (btn) grid.appendChild(btn);
      });
      section.appendChild(heading);
      section.appendChild(grid);
      menu.appendChild(section);
    });
    menu.dataset.grouped = "true";
  }

  // ---- Screen switching -------------------------------------------------
  hideScreens() {
    ["menu", "levelmap", "shop", "themes", "achievements", "calendar", "quests", "stats", "puzzle", "season", "pets"].forEach((s) =>
      this.el[s].classList.add("hidden")
    );
  }

  openPauseOverlay() {
    if (!(this.cb.isLevelActive && this.cb.isLevelActive())) {
      if (this.cb.quitToMenu) this.cb.quitToMenu();
      return;
    }
    if (this.cb.pauseGame) this.cb.pauseGame();
    this._pauseOpen = true;
    this._renderPauseSummary();
    if (this.el["pause"]) this.el["pause"].classList.remove("hidden");
  }

  closePauseOverlay(resume = true) {
    if (this.el["pause"]) this.el["pause"].classList.add("hidden");
    const wasOpen = !!this._pauseOpen;
    this._pauseOpen = false;
    if (resume && wasOpen && this.cb.resumeGame) {
      this.cb.resumeGame();
      this.showHud(true);
    }
  }

  _renderPauseSummary() {
    const wrap = this.el["pause-summary"];
    if (!wrap) return;
    const mode = this.el["hud-mode-label"] ? this.el["hud-mode-label"].textContent : "Run";
    const score = this.el["hud-score"] ? this.el["hud-score"].textContent : "0";
    const movesLabel = this.el["hud-moves-label"] ? this.el["hud-moves-label"].textContent : "Moves";
    const moves = this.el["hud-moves"] ? this.el["hud-moves"].textContent : "0";
    const targetLabel = this.el["hud-target-label"] ? this.el["hud-target-label"].textContent : "Target";
    const target = this.el["hud-target"] ? this.el["hud-target"].textContent : "0";
    wrap.innerHTML =
      `<div><span>Run</span><b>${mode}</b></div>` +
      `<div><span>Score</span><b>${score}</b></div>` +
      `<div><span>${movesLabel}</span><b>${moves}</b></div>` +
      `<div><span>${targetLabel}</span><b>${target}</b></div>`;
  }

  _pauseGoShop() {
    this.closePauseOverlay(false);
    this._shopOverGame = true;
    this.hideScreens();
    this.hideModals();
    this.showScreen("shop");
  }

  _pauseGoThemes() {
    this.closePauseOverlay(false);
    this._themesOverGame = true;
    this.hideScreens();
    this.hideModals();
    this.showScreen("themes");
  }

  _pauseRetry() {
    this.closePauseOverlay(false);
    if (this.cb.retryLevel) this.cb.retryLevel();
  }

  _pauseMenu() {
    this.closePauseOverlay(false);
    if (this.cb.quitToMenu) this.cb.quitToMenu();
  }

  showScreen(name) {
    this.hideScreens();
    this.hideModals();
    this.showHud(false);
    if (name && this.el[name]) this.el[name].classList.remove("hidden");
    this.refreshCoins();
    if (name === "menu") {
      this.updateContinue();
      this.updateDailySummary();
      this.updateTournamentSummary();
      this.refreshAchievementsBadge();
      this.refreshCalendarBadge();
      this.refreshQuestsBadge();
      this.refreshSeasonBadge();
      this.refreshPuzzleBadge();
      this.refreshPetsBadge();
      this.refreshPetAccess();
    }
    if (name === "levelmap") this.buildLevelMap();
    if (name === "shop") this.buildShop();
    if (name === "themes") {
      this.buildThemes();
      this._refreshColorblindToggle();
      this._refreshHintsToggle();
      this._refreshReducedMotionToggle();
      this._refreshBuyPrefs();
    }
    if (name === "achievements") this.buildAchievements();
    if (name === "calendar") this.buildCalendar();
    if (name === "quests") this.buildQuests();
    if (name === "stats") this.buildStats();
    if (name === "puzzle") this.buildPuzzles();
    if (name === "season") this.buildSeason();
  }

  // Open the shop focused on a specific power-up, highlighting and scrolling to
  // it. When invoked mid-level (the player tapped an empty tool slot) the live
  // level is paused and remembered so closing the shop resumes it.
  openShopForPowerup(type) {
    const overGame = !!(this.cb.isLevelActive && this.cb.isLevelActive());
    this._shopOverGame = overGame;
    if (overGame && this.cb.pauseGame) this.cb.pauseGame();
    this.showScreen("shop");
    this._highlightShopPowerup(type);
  }

  // Leave the shop: resume the paused level if we opened over one, otherwise
  // fall back to the menu (the default entry point).
  closeShop() {
    if (this._shopOverGame) {
      this._shopOverGame = false;
      this.hideScreens();
      this.hideModals();
      if (this.cb.resumeGame) this.cb.resumeGame();
      this.showHud(true);
      return;
    }
    this.showScreen("menu");
  }

  closeThemes() {
    if (this._themesOverGame) {
      this._themesOverGame = false;
      this.hideScreens();
      this.hideModals();
      if (this.cb.resumeGame) this.cb.resumeGame();
      this.showHud(true);
      return;
    }
    this.showScreen("menu");
  }

  // Visually mark a shop power-up row and bring it into view.
  _highlightShopPowerup(type) {
    const list = this.el["shop-list"];
    if (!list || !type) return;
    list
      .querySelectorAll(".shop-item.highlight")
      .forEach((n) => n.classList.remove("highlight"));
    const item = list.querySelector(`.shop-item[data-pu="${type}"]`);
    if (item) {
      item.classList.add("highlight");
      item.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  // ---- Pet companion manager (solid overlay over menu or live level) ----
  // Opens the rich pet UI (#pets) as a full-screen solid overlay. When opened
  // over a running level the game is paused and input disabled; closing resumes
  // play. Opened from the menu it behaves like a normal screen.
  openPetOverlay() {
    if (!this._petFeatureUnlocked("pets")) {
      const next = nextPetFeatureUnlock(Storage.get("maxUnlockedLevel"));
      this.toast(next ? `Pets unlock at Level ${next.level}` : "Pets are locked");
      return;
    }
    const overGame = !!(this.cb.isLevelActive && this.cb.isLevelActive());
    this._petOverlayOverGame = overGame;
    this._selectedPet = null;
    if (overGame && this.cb.pauseGame) this.cb.pauseGame();
    this.hideModals();
    if (this.el["gem-forge"]) this.el["gem-forge"].classList.add("hidden");
    this.buildPets();
    this.refreshCoins();
    if (this.el["pets"]) this.el["pets"].classList.remove("hidden");
  }

  closePetOverlay() {
    const overGame = this._petOverlayOverGame;
    this._petOverlayOverGame = false;
    this._pendingEquipId = null;
    if (this.el["pet-confirm"]) this.el["pet-confirm"].classList.add("hidden");
    if (this.el["gem-forge"]) this.el["gem-forge"].classList.add("hidden");
    if (this.el["pets"]) this.el["pets"].classList.add("hidden");
    if (overGame) {
      if (this.cb.resumeGame) this.cb.resumeGame();
      this.showHud(true);
    } else {
      this.showScreen("menu");
    }
  }

  // Equip request from the pet detail panel. Mid-level switches restart the
  // level, so we confirm first; from the menu we equip immediately.
  _requestEquip(pet) {
    if (
      this._petOverlayOverGame &&
      this.cb.isLevelActive &&
      this.cb.isLevelActive()
    ) {
      this._pendingEquipId = pet.id;
      if (this.el["pet-confirm-sub"]) {
        this.el["pet-confirm-sub"].textContent =
          `Equipping ${pet.icon} ${pet.name} restarts this level from the beginning.`;
      }
      if (this.el["pet-confirm"]) this.el["pet-confirm"].classList.remove("hidden");
      return;
    }
    if (this.cb.equipPet && this.cb.equipPet(pet.id)) {
      this.toast(`${pet.icon} ${pet.name} equipped!`);
      this.buildPets();
    }
  }

  _cancelEquip() {
    this._pendingEquipId = null;
    if (this.el["pet-confirm"]) this.el["pet-confirm"].classList.add("hidden");
  }

  _confirmEquip() {
    const id = this._pendingEquipId;
    this._pendingEquipId = null;
    if (this.el["pet-confirm"]) this.el["pet-confirm"].classList.add("hidden");
    if (!id) return;
    // Equip + restart the level fresh with the new companion, then drop the
    // overlay so the player lands straight back in the (restarted) level.
    this._petOverlayOverGame = false;
    if (this.el["pets"]) this.el["pets"].classList.add("hidden");
    if (this.cb.equipPetAndRestart) this.cb.equipPetAndRestart(id);
  }

  // Big celebration when a brand-new companion is won (from a crate, the
  // legendary crate, or a premium store purchase). Duplicates skip this and
  // just toast +XP — the fanfare is reserved for genuinely new pets.
  showPetReveal(res) {
    const pet = res && getPet(res.petId);
    const modal = this.el["pet-reveal"];
    if (!pet || !modal) {
      if (pet) this.toast(`New pet! ${pet.icon} ${pet.name}`);
      return;
    }
    this._revealPetId = pet.id;
    const rarity = res.premium ? "premium" : pet.rarity;
    const colorFor = {
      common: "#7ddc8f",
      rare: "#5b9fff",
      epic: "#b478ff",
      legendary: "#ffc850",
      premium: "#ff6ec7",
    };
    const color = colorFor[rarity] || "#7ddc8f";
    const ability =
      (pet.ability && pet.ability.label) || (pet.active && pet.active.label) || "Special ability";

    const card = modal.querySelector(".pet-reveal-card");
    if (card) card.style.setProperty("--pr-color", color);

    const congrats = this.el["pet-reveal-congrats"];
    if (congrats) {
      congrats.textContent =
        rarity === "premium" || rarity === "legendary"
          ? "🎉 LEGENDARY Companion!"
          : "🎉 New Companion!";
    }
    if (this.el["pet-reveal-icon"]) this.el["pet-reveal-icon"].textContent = pet.icon;
    if (this.el["pet-reveal-name"]) this.el["pet-reveal-name"].textContent = pet.name;
    const rar = this.el["pet-reveal-rarity"];
    if (rar) {
      rar.textContent = rarity === "premium" ? "premium legendary" : rarity;
      rar.style.color = color;
      rar.style.borderColor = color;
    }
    if (this.el["pet-reveal-ability"])
      this.el["pet-reveal-ability"].textContent = `✨ ${ability}`;
    if (this.el["pet-reveal-desc"]) {
      const tr = res.trait ? getTrait(res.trait) : null;
      this.el["pet-reveal-desc"].textContent = tr
        ? `${pet.desc || ""}  ${tr.icon} ${tr.label}: ${tr.desc}`
        : pet.desc || "";
    }

    Audio.coin();
    this.hideModals();
    modal.classList.remove("hidden");
    // Restart the icon entrance animation on every reveal.
    const icon = this.el["pet-reveal-icon"];
    if (icon) {
      icon.classList.remove("pr-pop");
      // Force reflow so re-adding the class replays the keyframes.
      void icon.offsetWidth;
      icon.classList.add("pr-pop");
    }
    this._playPetConfetti(color);
  }

  _playPetConfetti(color) {
    const layer = this.el["pet-reveal-confetti"];
    if (!layer) return;
    layer.innerHTML = "";
    if (this._motionOff()) return;
    const colors = ["#ffd24d", "#ff6ec7", "#5b9fff", "#7ddc8f", color || "#b478ff"];
    const N = 26;
    for (let i = 0; i < N; i++) {
      const bit = document.createElement("span");
      bit.className = "pr-confetti-bit";
      bit.style.left = `${Math.random() * 100}%`;
      bit.style.background = colors[i % colors.length];
      layer.appendChild(bit);
      if (bit.animate) {
        const dx = (Math.random() - 0.5) * 90;
        const rot = (Math.random() - 0.5) * 720;
        bit.animate(
          [
            { transform: "translate(-50%, -16px) rotate(0deg)", opacity: 0 },
            {
              transform: `translate(calc(-50% + ${dx * 0.4}px), 50px) rotate(${rot * 0.4}deg)`,
              opacity: 1,
              offset: 0.2,
            },
            {
              transform: `translate(calc(-50% + ${dx}px), 280px) rotate(${rot}deg)`,
              opacity: 0,
            },
          ],
          {
            duration: 1100 + Math.random() * 700,
            delay: Math.random() * 250,
            easing: "cubic-bezier(.2,.6,.3,1)",
            fill: "forwards",
          }
        );
      }
    }
  }

  _closePetReveal() {
    if (this.el["pet-reveal"]) this.el["pet-reveal"].classList.add("hidden");
    const layer = this.el["pet-reveal-confetti"];
    if (layer) layer.innerHTML = "";
  }

  // "Equip & Play" from the reveal: route through the normal equip path so a
  // mid-level switch still gets its restart confirmation.
  _equipFromReveal() {
    const pet = getPet(this._revealPetId);
    this._closePetReveal();
    if (pet) this._requestEquip(pet);
  }

  // Show a "Continue" entry on the menu when a campaign level is in progress.
  updateContinue() {
    const btn = this.el["btn-continue"];
    if (!btn) return;
    const play = $("btn-play");
    const nudge = $("play-nudge");
    const snap = Storage.get("activeSession");
    if (snap && snap.mode === "campaign" && !snap.ended) {
      const sub = btn.querySelector(".cta-sub");
      if (sub) sub.textContent = `Resume Level ${snap.levelId}`;
      btn.classList.remove("hidden");
      if (play) play.classList.remove("btn-primary");
      if (nudge) nudge.textContent = "Map";
    } else {
      btn.classList.add("hidden");
      if (play) play.classList.add("btn-primary");
      if (nudge) {
        const fresh = Storage.get("maxUnlockedLevel") <= 1 && !Storage.get("tutorialDone");
        nudge.textContent = fresh ? "Start here" : "Next level";
      }
    }
  }

  // Daily summary on the menu: today's modifier, streak and freeze tokens.
  updateDailySummary() {
    const el = this.el["daily-summary"];
    if (!el) return;
    const mod = getDailyModifier();
    const streak = getStreak();
    const freeze = getFreezeTokens();
    const done = alreadyPlayedToday();
    const parts = [
      `<span class="ds-mod">${mod.label}</span>`,
      `<span class="ds-streak">${streak}🔥</span>`,
    ];
    if (freeze > 0) parts.push(`<span class="ds-freeze">${freeze}❄️</span>`);
    if (done) parts.push(`<span class="ds-done">✓ played</span>`);
    el.innerHTML = parts.join("");

    // The daily can be completed only once per day, so lock its menu tile once
    // today's run is recorded — a tap then just confirms it's done (startDaily
    // also guards, so the lock can never be bypassed).
    const tile = this.el["btn-daily"];
    if (tile) {
      tile.classList.toggle("locked", done);
      tile.setAttribute("aria-disabled", done ? "true" : "false");
    }
  }

  updateTournamentSummary() {
    const el = this.el["tournament-summary"];
    if (!el) return;
    const mod = getTournamentModifier();
    const best = getTournamentBest();
    const days = tournamentDaysLeft();
    const parts = [`<span class="ds-mod">🏆 ${mod.label}</span>`];
    if (best > 0) parts.push(`<span class="ds-streak">Best ${best}</span>`);
    parts.push(`<span class="ds-freeze">${days}d left</span>`);
    el.innerHTML = parts.join("");
  }

  refreshCoins() {
    const c = Economy.coins;
    ["menu-coins", "lm-coins", "shop-coins", "themes-coins", "hud-coins", "pets-coins", "season-coins"].forEach(
      (id) => {
        if (this.el[id]) this.el[id].textContent = c;
      }
    );
  }

  // ---- Level map --------------------------------------------------------
  buildLevelMap() {
    const grid = this.el["level-grid"];
    grid.innerHTML = "";
    const maxUnlocked = Storage.get("maxUnlockedLevel");
    const teaser = this._buildNextUnlockTeaser(maxUnlocked);
    if (teaser) grid.appendChild(teaser);
    // The campaign is endless, so render a window: every cleared/authored level
    // plus one preview chapter beyond the player's current progress. This keeps
    // the DOM bounded (it grows with progress, not to LEVEL_COUNT) while still
    // letting the player scroll back to replay any earlier level.
    const progressEnd =
      (Math.ceil(maxUnlocked / CHAPTER_SIZE) + 1) * CHAPTER_SIZE;
    const renderEnd = Math.min(
      LEVEL_COUNT,
      Math.max(AUTHORED_LEVELS, progressEnd)
    );
    for (let i = 1; i <= renderEnd; i++) {
      // Insert a chapter header before the first level of each chapter so the
      // map reads as a journey across themed worlds (authored + procedural).
      if ((i - 1) % CHAPTER_SIZE === 0) {
        const ch = chapterForLevel(i);
        if (ch) {
          const chapterDone = maxUnlocked > ch.endLevel;
          const chapterLocked = maxUnlocked < i;
          const header = document.createElement("div");
          header.className = "chapter-header";
          if (chapterDone) header.classList.add("done");
          if (chapterLocked) header.classList.add("locked");
          header.innerHTML = `<span class="ch-icon">${ch.icon}</span><span class="ch-name">${ch.name}</span><span class="ch-range">${ch.startLevel}–${ch.endLevel}</span>`;
          grid.appendChild(header);
        }
      }
      const cell = document.createElement("div");
      cell.className = "level-cell";
      const locked = i > maxUnlocked;
      if (locked) cell.classList.add("locked");
      const mtype = milestoneType(i);
      if (mtype) cell.classList.add(`milestone-${mtype}`);
      const stars = Storage.getStars(i);
      const starStr = locked
        ? ""
        : "★".repeat(stars) + "☆".repeat(3 - stars);
      const badge = mtype === "boss" ? "👹" : mtype === "treasure" ? "🎁" : "";
      const best = Storage.getLevelScore(i);
      const bestStr =
        !locked && best > 0 ? `<span class="lvl-best">🏆 ${best}</span>` : "";
      cell.innerHTML = locked
        ? `<span class="lock">🔒</span>${badge ? `<span class="lvl-badge">${badge}</span>` : ""}`
        : `${badge ? `<span class="lvl-badge">${badge}</span>` : ""}<span class="num">${i}</span><span class="lvl-stars">${starStr}</span>${bestStr}`;
      if (!locked) {
        cell.tabIndex = 0;
        cell.setAttribute("role", "button");
        cell.setAttribute("aria-label", `Level ${i}`);
        cell.addEventListener("click", () => {
          Audio.click();
          this.openLevelBrief(i);
        });
        cell.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          Audio.click();
          this.openLevelBrief(i);
        });
      }
      grid.appendChild(cell);
    }
  }

  openLevelBrief(levelId) {
    const level = getLevel(levelId);
    if (!level || !this.el["level-brief"]) {
      this.cb.startLevel && this.cb.startLevel(levelId);
      return;
    }
    this._briefLevelId = levelId;
    const mtype = level.milestone;
    this.el["brief-title"].textContent = `${mtype === "boss" ? "Boss" : mtype === "treasure" ? "Treasure" : "Level"} ${levelId}`;
    this.el["brief-sub"].textContent = this._briefSubtitle(level);
    this.el["brief-stats"].innerHTML =
      `<div><b>${level.target}</b><span>Target</span></div>` +
      `<div><b>${level.moves}</b><span>Moves</span></div>` +
      `<div><b>${level.colors}</b><span>Colors</span></div>`;
    this._setBriefSection("brief-replay", "Replay record", this._briefReplay(levelId));
    this._setBriefSection("brief-objective", level.objective ? "🎯 Bonus objective" : "", level.objective ? level.objective.label : "");
    this._setBriefSection("brief-hazards", "Board traits", this._briefHazards(level));
    this._setBriefSection("brief-tools", "Suggested tools", this._briefTools(level));
    if (this.el["brief-start"]) this.el["brief-start"].textContent = Storage.getStars(levelId) ? "Replay" : "Start";
    this.el["level-brief"].classList.remove("hidden");
  }

  closeLevelBrief() {
    if (this.el["level-brief"]) this.el["level-brief"].classList.add("hidden");
    const cell = this._briefLevelId
      ? this.el["level-grid"]?.querySelector(`.level-cell[aria-label="Level ${this._briefLevelId}"]`)
      : null;
    if (cell) cell.focus({ preventScroll: true });
  }

  startBriefedLevel() {
    const levelId = this._briefLevelId;
    this.closeLevelBrief();
    if (levelId && this.cb.startLevel) this.cb.startLevel(levelId);
  }

  _setBriefSection(id, title, body) {
    const el = this.el[id];
    if (!el) return;
    el.classList.toggle("hidden", !body);
    el.innerHTML = body ? `<b>${title}</b><span>${body}</span>` : "";
  }

  _briefSubtitle(level) {
    if (level.milestone === "boss") return "Break the boss objective before the board runs dry.";
    if (level.milestone === "treasure") return "Clear the vault for a one-time treasure payout.";
    return "Clear every bubble and beat the score target.";
  }

  _briefReplay(levelId) {
    const stars = Storage.getStars(levelId);
    const best = Storage.getLevelScore(levelId);
    if (!stars && !best) return "";
    const starText = stars ? `${"★".repeat(stars)}${"☆".repeat(3 - stars)}` : "No stars yet";
    return best ? `${starText} • Best ${best}` : starText;
  }

  _briefHazards(level) {
    const traits = [];
    const specials = level.specials || {};
    if (level.boss) traits.push("boss objective");
    if (level.downpour) traits.push("downpour rows");
    if (specials.ice) traits.push("ice");
    if (specials.stone) traits.push("stone");
    if (specials.vine) traits.push("vines");
    if (specials.lightning) traits.push("lightning");
    if (specials.bomb) traits.push("bomb bubbles");
    if (specials.coin) traits.push("coin bubbles");
    return traits.length ? traits.join(" • ") : "Clean board. Build big groups and keep cascades alive.";
  }

  _briefTools(level) {
    const unlocked = new Set(unlockedPowerups());
    const picks = [];
    const add = (type) => {
      if (unlocked.has(type) && POWERUP_INFO[type] && !picks.includes(type)) picks.push(type);
    };
    const specials = level.specials || {};
    if (level.boss) add("chainBolt"), add("bomb"), add("pick");
    if (specials.stone || specials.vine || specials.ice) add("pick"), add("bomb");
    if (level.objective && level.objective.type === "group") add("magnet"), add("colorClear");
    if (level.objective && level.objective.type === "combo") add("shuffle"), add("magnet");
    add("undo");
    add("shuffle");
    add("bomb");
    return picks.length
      ? picks.slice(0, 3).map((type) => `${POWERUP_INFO[type].icon} ${POWERUP_INFO[type].name}`).join(" • ")
      : "Tools unlock after Level 5.";
  }

  _nextProgressUnlock(maxUnlocked) {
    const tool = nextPowerupUnlock(maxUnlocked);
    const pet = nextPetFeatureUnlock(maxUnlocked);
    if (tool && (!pet || tool.level <= pet.level)) {
      const info = POWERUP_INFO[tool.type];
      return info ? { level: tool.level, icon: info.icon, name: info.name, kind: "Tool" } : null;
    }
    if (pet) {
      const info = PET_FEATURE_INFO[pet.feature];
      return info ? { level: pet.level, icon: info.icon, name: info.name, kind: "Pets" } : null;
    }
    return null;
  }

  _buildNextUnlockTeaser(maxUnlocked) {
    const next = this._nextProgressUnlock(maxUnlocked);
    if (!next) return null;
    const card = document.createElement("div");
    card.className = "next-unlock-teaser";
    card.innerHTML =
      `<span class="nut-icon">${next.icon}</span>` +
      `<span class="nut-copy"><b>Next unlock: ${next.name}</b><span>${next.kind} opens at Level ${next.level}</span></span>`;
    return card;
  }

  // ---- Shop -------------------------------------------------------------
  // Resolved hold-to-buy repeat interval in ms (explicit override wins, else
  // the persisted setting, else the 500ms / 2-per-second default).
  _buyHoldMs() {
    if (typeof this.buyHoldInterval === "number" && this.buyHoldInterval > 0) {
      return this.buyHoldInterval;
    }
    const s = Storage.get("settings");
    const ms = s && Number(s.buyRepeatMs);
    return ms > 0 ? ms : 500;
  }

  _buyHoldMax() {
    const override = Number(this.buyHoldMax);
    const s = Storage.get("settings");
    const saved = s && Number(s.buyBatchMax);
    const requested = override > 0 ? override : saved > 0 ? saved : 10;
    return Math.max(1, Math.min(10, Math.floor(requested)));
  }

  // Wire a buy button so a single tap buys once and holding it keeps buying at
  // the configured interval, capped to the configured batch size (max 10).
  // `action()` performs one purchase and returns `false` to stop the repeat
  // (e.g. out of coins / sold out).
  _attachHoldRepeat(btn, action, feedback = {}) {
    let timer = null;
    let holdCount = 0;
    let keyHeld = false;
    let blockedUntilRelease = false;
    const setFeedback = (state) => {
      if (feedback.update) feedback.update(state);
    };
    const clearTimer = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const stop = () => {
      clearTimer();
      if (holdCount > 0) setFeedback({ phase: "idle", count: holdCount, max: this._buyHoldMax() });
      holdCount = 0;
      blockedUntilRelease = false;
    };
    const fire = () => {
      if (btn.disabled || blockedUntilRelease) return false;
      const max = this._buyHoldMax();
      if (holdCount >= max) {
        blockedUntilRelease = true;
        clearTimer();
        setFeedback({ phase: "capped", count: holdCount, max });
        return false;
      }
      holdCount += 1;
      setFeedback({ phase: "buying", count: holdCount, max });
      if (action({ count: holdCount, max }) === false) {
        blockedUntilRelease = true;
        clearTimer();
        setFeedback({ phase: "blocked", count: holdCount, max });
        return false;
      }
      if (holdCount >= max) {
        blockedUntilRelease = true;
        clearTimer();
        setFeedback({ phase: "capped", count: holdCount, max });
        return false;
      }
      return true;
    };
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      stop();
      if (fire()) timer = setInterval(fire, this._buyHoldMs());
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
      btn.addEventListener(ev, stop),
    );
    // Keyboard accessibility: Enter/Space buys once (no auto-repeat needed —
    // the OS key-repeat already re-fires keydown while held).
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (!keyHeld) {
          stop();
          keyHeld = true;
        }
        fire();
      }
    });
    btn.addEventListener("keyup", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        keyHeld = false;
        stop();
      }
    });
  }

  // Render the one-time Starter Pack bundle. Always shown (so it reads as
  // "Owned ✓" after purchase); the buy goes through the mock IAP.
  _buildStarterPackItem(list) {
    const owned = !!Storage.get("starterPack");
    const item = document.createElement("div");
    item.className = "shop-item shop-starter";
    item.dataset.pack = "starter";
    const unlocked = unlockedPowerups();
    const visibleTools = Object.entries(STARTER_PACK.powerups)
      .filter(([type]) => unlocked.includes(type))
      .map(([type, n]) => `${POWERUP_INFO[type].icon}×${n}`);
    const lockedCount = Object.keys(STARTER_PACK.powerups).length - visibleTools.length;
    const puText = visibleTools.length
      ? `${visibleTools.join(" ")}${lockedCount ? ` · ${lockedCount} future tool stash` : ""}`
      : "tool stash unlocks as you progress";
    item.innerHTML = `
      <span class="si-icon">🎁</span>
      <div class="si-body">
        <div class="si-title">${STARTER_PACK.name} <span class="si-badge">BEST VALUE</span></div>
        <div class="si-desc">🪙 ${STARTER_PACK.coins} coins · ${puText} · 🧰×${STARTER_PACK.crates} crate</div>
      </div>`;
    const buy = document.createElement("button");
    buy.id = "shop-starter-buy";
    buy.className = "buy-btn" + (owned ? " owned" : "");
    buy.textContent = owned ? "Owned ✓" : STARTER_PACK.price;
    if (!owned) {
      buy.addEventListener("click", async () => {
        if (!this.cb.buyStarterPack) return;
        buy.disabled = true;
        const res = await this.cb.buyStarterPack();
        if (res && res.ok) {
          Audio.coin();
          this.toast("Starter Pack unlocked — enjoy!");
          this.refreshCoins();
          this.updatePowerups();
          this.buildShop();
        } else {
          buy.disabled = false;
          this.toast(res && res.owned ? "Already owned" : "Purchase failed");
        }
      });
    }
    item.appendChild(buy);
    list.appendChild(item);
  }

  // The Piggy Bank shop card: shows the banked balance + fill bar, and a
  // "Crack open" button that pays out the whole vault via a one-time purchase.
  _buildPiggyItem(list) {
    const balance = Storage.get("piggyBank") || 0;
    const pct = Math.round(piggyFillPct(balance) * 100);
    const canCrack = canCrackPiggy(balance);
    const item = document.createElement("div");
    item.className = "shop-item shop-piggy";
    item.dataset.pack = "piggy";
    item.innerHTML = `
      <span class="si-icon">🐷</span>
      <div class="si-body">
        <div class="si-title">Piggy Bank</div>
        <div class="si-desc">🪙 <span class="piggy-balance">${formatStat(
          balance
        )}</span> / ${formatStat(PIGGY_CAP)} banked from play</div>
        <div class="piggy-bar"><div class="piggy-bar-fill" style="width:${pct}%"></div></div>
        <div class="si-desc piggy-hint">${
          canCrack
            ? "Crack it open to collect every coin!"
            : `Keep playing — crack at ${formatStat(PIGGY_MIN_CRACK)} coins`
        }</div>
      </div>`;
    const buy = document.createElement("button");
    buy.id = "shop-piggy-crack";
    buy.className = "buy-btn" + (canCrack ? "" : " owned");
    buy.textContent = canCrack ? `Crack ${PIGGY_CRACK_PRICE}` : "Locked";
    buy.disabled = !canCrack;
    if (canCrack) {
      buy.addEventListener("click", async () => {
        if (!this.cb.crackPiggy) return;
        buy.disabled = true;
        const res = await this.cb.crackPiggy();
        if (res && res.ok) {
          Audio.coin();
          this.toast(`🐷 Piggy cracked — +🪙 ${formatStat(res.amount)}!`);
          this.refreshCoins();
          this.buildShop();
        } else {
          buy.disabled = false;
          this.toast("Purchase failed");
        }
      });
    }
    item.appendChild(buy);
    list.appendChild(item);
  }

  buildShop() {
    const list = this.el["shop-list"];
    list.innerHTML = "";

    this._shopSection(list, "Featured", "Limited bundles and banked rewards");
    // One-time Starter Pack — a prominent value bundle at the very top.
    this._buildStarterPackItem(list);
    // Piggy Bank — coins banked passively from play, unlocked by cracking it.
    this._buildPiggyItem(list);
    this._shopSection(list, "Power-ups", "New tools unlock as the campaign opens up");
    // Power-ups
    const available = unlockedPowerups();
    if (!available.length) {
      const next = nextPowerupUnlock();
      const empty = document.createElement("div");
      empty.className = "shop-empty-tools";
      empty.innerHTML = `<b>Tools unlock after Level 5</b><span>${next ? `First up: ${POWERUP_INFO[next.type].icon} ${POWERUP_INFO[next.type].name} at Level ${next.level}.` : "All tools are unlocked."}</span>`;
      list.appendChild(empty);
    }
    available.forEach((type) => {
      const info = POWERUP_INFO[type];
      const owned = Economy.getPowerup(type);
      const affordable = Economy.coins >= info.price;
      const item = document.createElement("div");
      item.className = "shop-item" + (affordable ? "" : " cannot-afford");
      item.dataset.pu = type;
      item.innerHTML = `
        <span class="si-icon">${info.icon}</span>
        <div class="si-body">
          <div class="si-title">${info.name} <span class="si-owned" style="color:var(--text-dim);font-weight:600">×${owned}</span></div>
          <div class="si-desc">${info.desc}</div>
        </div>`;
      const buy = document.createElement("button");
      buy.className = "buy-btn" + (affordable ? "" : " need-coins");
      buy.innerHTML = `<span class="coin-dot"></span>${info.price}`;
      buy.title = affordable ? `Buy ${info.name}` : `Need ${info.price - Economy.coins} more coins`;
      const normalLabel = buy.innerHTML;
      const feedback = ({ phase, count, max }) => {
        buy.classList.toggle("buying", phase === "buying");
        buy.classList.toggle("capped", phase === "capped");
        if (phase === "buying" || phase === "capped") {
          buy.textContent = phase === "capped" ? `Limit ${count}/${max}` : `Buying ${count}/${max}`;
        } else if (phase === "blocked") {
          buy.textContent = "Stopped";
        } else {
          buy.innerHTML = normalLabel;
        }
      };
      // Hold to keep buying at the configured rate (default 2/sec). The owned
      // count + coin balance update in place so the held button is never torn
      // down mid-repeat (a full rebuildShop would cancel the hold).
      this._attachHoldRepeat(buy, () => {
        if (Economy.buyPowerup(type)) {
          Audio.coin();
          this.toast(`${info.name} purchased!`);
          item.classList.toggle("bought", true);
          const ownedEl = item.querySelector(".si-owned");
          if (ownedEl) ownedEl.textContent = `×${Economy.getPowerup(type)}`;
          this.refreshCoins();
          this.updatePowerups();
          const canStillBuy = Economy.coins >= info.price;
          item.classList.toggle("cannot-afford", !canStillBuy);
          buy.classList.toggle("need-coins", !canStillBuy);
          buy.title = canStillBuy ? `Buy ${info.name}` : `Need ${info.price - Economy.coins} more coins`;
          return true;
        }
        this.toast("Not enough coins");
        return false;
      }, { update: feedback });
      item.appendChild(buy);
      list.appendChild(item);
    });

    this._shopSection(list, "Coins & Upgrades", "Daily coin grants, packs and ad removal");
    // Free coins via an opt-in rewarded ad — daily-capped with an escalating
    // payout, so watching a few ads a day is worthwhile but never unlimited.
    const ad = Economy.adCoinState();
    const freeItem = document.createElement("div");
    freeItem.className = "shop-item";
    freeItem.innerHTML = `
      <span class="si-icon">🎬</span>
      <div class="si-body">
        <div class="si-title">Free Coins</div>
        <div class="si-desc">${
          ad.remaining > 0
            ? `Watch an ad for +${ad.nextAmount} coins · ${ad.remaining} left today`
            : "Daily free coins done — come back tomorrow!"
        }</div>
      </div>`;
    const freeBtn = document.createElement("button");
    freeBtn.id = "shop-free-coins";
    freeBtn.className = "buy-btn" + (ad.remaining <= 0 ? " owned" : "");
    freeBtn.textContent = ad.remaining > 0 ? `▶ +${ad.nextAmount}` : "Done ✓";
    if (ad.remaining > 0) {
      freeBtn.addEventListener("click", async () => {
        await Monetization.showRewardedAd("coins");
        const got = Economy.claimAdCoins();
        if (got > 0) {
          Audio.coin();
          this.toast(`+${got} coins!`);
          this.refreshCoins();
          this.buildShop();
        }
      });
    }
    freeItem.appendChild(freeBtn);
    list.appendChild(freeItem);

    // Coin packs (mock IAP)
    COIN_PACKS.forEach((pack) => {
      const item = document.createElement("div");
      item.className = "shop-item";
      item.innerHTML = `
        <span class="si-icon">🪙</span>
        <div class="si-body">
          <div class="si-title">${pack.name}</div>
          <div class="si-desc">+${pack.amount} coins</div>
        </div>`;
      const buy = document.createElement("button");
      buy.className = "buy-btn";
      buy.textContent = pack.label;
      buy.addEventListener("click", async () => {
        Economy.addCoins(pack.amount);
        Audio.coin();
        this.toast(`+${pack.amount} coins!`);
        this.refreshCoins();
        this.buildShop();
      });
      item.appendChild(buy);
      list.appendChild(item);
    });

    // Remove ads
    const adsItem = document.createElement("div");
    adsItem.className = "shop-item";
    const removed = Monetization.isAdsRemoved();
    adsItem.innerHTML = `
      <span class="si-icon">🚫</span>
      <div class="si-body">
        <div class="si-title">Remove Ads</div>
        <div class="si-desc">No more interstitials. Rewarded ads stay optional.</div>
      </div>`;
    const adsBtn = document.createElement("button");
    adsBtn.className = "buy-btn" + (removed ? " owned" : "");
    adsBtn.textContent = removed ? "Owned ✓" : "$2.99";
    if (!removed) {
      adsBtn.addEventListener("click", async () => {
        const res = await Monetization.purchase("remove_ads");
        if (res.ok) {
          this.toast("Ads removed. Thank you!");
          this.buildShop();
        }
      });
    }
    adsItem.appendChild(adsBtn);
    list.appendChild(adsItem);
  }

  _shopSection(list, title, sub) {
    const section = document.createElement("div");
    section.className = "shop-section-head";
    section.innerHTML = `<span class="shop-section-title">${title}</span><span class="shop-section-sub">${sub}</span>`;
    list.appendChild(section);
  }

  // ---- Themes -----------------------------------------------------------
  buildThemes() {
    const list = this.el["theme-list"];
    list.innerHTML = "";
    const totalStars = Storage.totalStars();
    const owned = Storage.get("ownedThemes");
    const current = Storage.get("currentTheme");

    THEMES.forEach((theme) => {
      const unlocked = isThemeUnlocked(theme, totalStars, owned);
      const isActive = current === theme.id;
      const item = document.createElement("div");
      item.className = "theme-item";

      const swatch = document.createElement("div");
      swatch.className = "theme-swatch";
      theme.bubbles.slice(0, 4).forEach((c) => {
        const sp = document.createElement("span");
        sp.style.background = c;
        swatch.appendChild(sp);
      });

      const body = document.createElement("div");
      body.className = "ti-body";
      let reqText = theme.desc;
      if (!unlocked) {
        reqText =
          theme.price > 0
            ? `Buy for ${theme.price} coins`
            : `Unlock at ${theme.unlockStars}★ (${totalStars}/${theme.unlockStars})`;
      }
      body.innerHTML = `<div class="ti-title">${theme.name}</div><div class="ti-desc">${reqText}</div>`;

      const btn = document.createElement("button");
      btn.className = "buy-btn";
      if (isActive) {
        btn.textContent = "Active";
        btn.classList.add("active-tag");
      } else if (unlocked) {
        btn.textContent = "Use";
        btn.classList.add("owned");
        btn.addEventListener("click", () => {
          Storage.set("currentTheme", theme.id);
          applyThemeCss(getTheme(theme.id));
          Audio.click();
          if (this.cb.onThemeChange) this.cb.onThemeChange(getTheme(theme.id));
          this.buildThemes();
        });
      } else if (theme.price > 0) {
        btn.innerHTML = `<span class="coin-dot"></span>${theme.price}`;
        btn.addEventListener("click", () => {
          if (Economy.spendCoins(theme.price)) {
            const list2 = [...Storage.get("ownedThemes"), theme.id];
            Storage.set("ownedThemes", list2);
            Audio.coin();
            this.toast(`${theme.name} unlocked!`);
            this.refreshCoins();
            this.buildThemes();
          } else {
            this.toast("Not enough coins");
          }
        });
      } else {
        btn.textContent = "🔒";
        btn.disabled = true;
      }

      item.appendChild(swatch);
      item.appendChild(body);
      item.appendChild(btn);
      list.appendChild(item);
    });
  }

  // Reflect the saved colourblind setting on the Themes-screen toggle.
  _refreshColorblindToggle() {
    const on = !!(Storage.get("settings") || {}).colorblind;
    if (this.el["cb-toggle"]) {
      this.el["cb-toggle"].classList.toggle("on", on);
      this.el["cb-toggle"].setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (this.el["cb-toggle-state"])
      this.el["cb-toggle-state"].textContent = on ? "On" : "Off";
  }

  // Reflect the saved idle-hint setting on the Themes-screen toggle.
  _refreshHintsToggle() {
    const on = (Storage.get("settings") || {}).hints !== false;
    if (this.el["hints-toggle"]) {
      this.el["hints-toggle"].classList.toggle("on", on);
      this.el["hints-toggle"].setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (this.el["hints-toggle-state"])
      this.el["hints-toggle-state"].textContent = on ? "On" : "Off";
  }

  // Reflect the saved reduced-motion setting on the Themes-screen toggle.
  _refreshReducedMotionToggle() {
    const on = !!(Storage.get("settings") || {}).reducedMotion;
    if (this.el["rm-toggle"]) {
      this.el["rm-toggle"].classList.toggle("on", on);
      this.el["rm-toggle"].setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (this.el["rm-toggle-state"])
      this.el["rm-toggle-state"].textContent = on ? "On" : "Off";
  }

  _refreshBuyPrefs() {
    const settings = Storage.get("settings") || {};
    const max = this._buyHoldMax();
    const ms = Number(settings.buyRepeatMs) > 0 ? Number(settings.buyRepeatMs) : 500;
    document.querySelectorAll("[data-buy-max]").forEach((btn) => {
      const on = Number(btn.dataset.buyMax) === max;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
    document.querySelectorAll("[data-buy-ms]").forEach((btn) => {
      const on = Number(btn.dataset.buyMs) === ms;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  // True when motion should be dialled down — either the in-game reduced-motion
  // setting is on, or the OS `prefers-reduced-motion` accessibility preference
  // is set. Used to skip purely decorative bursts (confetti, chest sparkles).
  _motionOff() {
    if (this.reducedMotion) return true;
    return !!(
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  // ---- Achievements -----------------------------------------------------
  buildAchievements() {
    const list = this.el["achv-list"];
    if (!list) return;
    list.innerHTML = "";
    const { progress, claims } = Storage.getAchievementState();

    let ready = 0;
    ACHIEVEMENT_CATEGORIES.forEach((cat) => {
      const st = categoryStatus(cat, progress, claims);
      if (st.claimable) ready += 1;

      const item = document.createElement("div");
      item.className =
        "achv-item" +
        (st.claimable ? " claimable" : "") +
        (st.maxed ? " maxed" : "");

      const icon = document.createElement("div");
      icon.className = "achv-icon";
      icon.textContent = cat.icon;

      const body = document.createElement("div");
      body.className = "achv-body";

      const head = document.createElement("div");
      head.className = "achv-head";
      head.innerHTML =
        `<span class="achv-name">${cat.name}</span>` +
        `<span class="achv-tier">${
          st.maxed ? "MAX" : `Tier ${st.level}/${st.totalTiers}`
        }</span>`;

      const bar = document.createElement("div");
      bar.className = "achv-bar";
      const fill = document.createElement("div");
      fill.className = "achv-bar-fill";
      fill.style.width = `${Math.round(st.progress01 * 100)}%`;
      bar.appendChild(fill);

      const meta = document.createElement("div");
      meta.className = "achv-meta";
      if (st.maxed) {
        meta.innerHTML = `<span class="achv-desc">All tiers complete!</span>`;
      } else {
        meta.innerHTML =
          `<span class="achv-desc">${Math.min(st.value, st.goal)} / ${st.goal} ${cat.unit}</span>` +
          `<span class="achv-reward"><span class="coin-dot"></span>${st.tier.coins}</span>`;
      }

      body.appendChild(head);
      body.appendChild(bar);
      body.appendChild(meta);

      const action = document.createElement("div");
      action.className = "achv-action";
      if (st.claimable) {
        const btn = document.createElement("button");
        btn.className = "buy-btn achv-claim";
        btn.textContent = "Collect 🎁";
        btn.addEventListener("click", () => this._claimAchievement(cat.id));
        action.appendChild(btn);
      } else if (st.maxed) {
        action.innerHTML = `<span class="achv-done">✓</span>`;
      }

      item.appendChild(icon);
      item.appendChild(body);
      item.appendChild(action);
      list.appendChild(item);
    });

    if (this.el["achv-count"]) {
      this.el["achv-count"].textContent = ready
        ? `${ready} ready 🎁`
        : "All collected";
    }
    const collectAll = this.el["achv-collect-all"];
    if (collectAll) collectAll.classList.toggle("hidden", ready < 1);
    this.refreshAchievementsBadge();
  }

  // Collect a category's chest via the game, then reveal its contents and
  // rebuild the screen so the category shows its next tier.
  _claimAchievement(categoryId) {
    if (!this.cb.claimAchievement) return;
    const reward = this.cb.claimAchievement(categoryId);
    if (!reward) {
      this.buildAchievements();
      return;
    }
    this._showChestReveal(reward);
    this.buildAchievements();
  }

  // Collect EVERY claimable chest at once. The model updates synchronously
  // (coins/tools/pets granted immediately), then a cosmetic "sweep" sends a
  // flying gift up from each collected row before an aggregate reveal lists
  // everything that dropped.
  _claimAllAchievements() {
    if (!this.cb.claimAllAchievements) return;
    const list = this.el["achv-list"];
    const rows = list
      ? Array.from(list.querySelectorAll(".achv-item.claimable"))
      : [];
    const agg = this.cb.claimAllAchievements();
    if (!agg || !agg.count) {
      this.buildAchievements();
      return;
    }
    // Capture row positions and launch the flying-gift sweep BEFORE we rebuild
    // the list (which removes the rows we are animating from).
    this._playCollectAllSweep(rows);
    this.buildAchievements();
    this._showCollectAllReveal(agg);
  }

  // A celebratory sweep: each collected row launches a gift that flies up to
  // the top of the screen, staggered, ending in a sparkle burst. Purely
  // cosmetic and self-cleaning; safe if Web Animations aren't available.
  _playCollectAllSweep(rows) {
    if (!rows || !rows.length || typeof document === "undefined") return;
    const layer = document.createElement("div");
    layer.className = "collect-all-fx";
    document.body.appendChild(layer);
    const vw = window.innerWidth || 360;
    const vh = window.innerHeight || 640;
    const destX = vw / 2;
    const destY = Math.max(40, vh * 0.12);
    let last = 0;
    rows.forEach((row, i) => {
      const r = row.getBoundingClientRect();
      const startX = r.left + r.width / 2;
      const startY = r.top + r.height / 2;
      const tok = document.createElement("div");
      tok.className = "caf-token";
      tok.textContent = "🎁";
      tok.style.left = `${startX}px`;
      tok.style.top = `${startY}px`;
      layer.appendChild(tok);
      const delay = i * 90;
      const dur = 720;
      last = Math.max(last, delay + dur);
      const dx = destX - startX;
      const dy = destY - startY;
      if (tok.animate) {
        tok.animate(
          [
            { transform: "translate(-50%,-50%) scale(0.4)", opacity: 0 },
            { transform: "translate(-50%,-50%) scale(1.25)", opacity: 1, offset: 0.18 },
            {
              transform: `translate(calc(-50% + ${dx * 0.55}px), calc(-50% + ${dy * 0.55}px)) scale(1.05)`,
              opacity: 1,
              offset: 0.62,
            },
            {
              transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.45)`,
              opacity: 0,
            },
          ],
          { duration: dur, delay, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }
        );
      }
    });
    // A little sparkle pop where the gifts gather.
    const burst = document.createElement("div");
    burst.className = "caf-burst";
    burst.style.left = `${destX}px`;
    burst.style.top = `${destY}px`;
    layer.appendChild(burst);
    if (burst.animate) {
      burst.animate(
        [
          { transform: "translate(-50%,-50%) scale(0)", opacity: 0 },
          { transform: "translate(-50%,-50%) scale(6)", opacity: 0.9, offset: 0.6 },
          { transform: "translate(-50%,-50%) scale(10)", opacity: 0 },
        ],
        { duration: 520, delay: Math.max(0, last - 360), easing: "ease-out", fill: "forwards" }
      );
    }
    setTimeout(() => layer.remove(), last + 400);
  }

  // Reveal everything a "Collect All" pass dropped, reusing the chest modal.
  _showCollectAllReveal(agg) {
    const modal = this.el["chest"];
    if (!modal) {
      this.toast(`🎁 +${agg.coins} coins from ${agg.count} chests!`);
      return;
    }
    Audio.coin();
    if (this.el["chest-icon"]) this.el["chest-icon"].textContent = "🎁";
    if (this.el["chest-title"])
      this.el["chest-title"].textContent = `Collected ${agg.count} chest${
        agg.count === 1 ? "" : "s"
      }!`;
    if (this.el["chest-sub"])
      this.el["chest-sub"].textContent = "Every reward is yours.";

    const rewards = this.el["chest-rewards"];
    if (rewards) {
      rewards.innerHTML = "";
      const row = (icon, label, cls = "") => {
        const el = document.createElement("div");
        el.className = "chest-row" + (cls ? ` ${cls}` : "");
        el.innerHTML = `<span class="chest-row-ic">${icon}</span><span class="chest-row-tx">${label}</span>`;
        rewards.appendChild(el);
      };
      row(`<span class="coin-dot"></span>`, `<b>+${agg.coins}</b> coins`);
      agg.powerups.forEach((p) => row(p.icon, `<b>${p.name}</b> ×${p.n}`));
      agg.pets.forEach((pet) => {
        const tag = pet.isNew ? "New pet!" : "+XP (duplicate)";
        row(
          pet.icon,
          `<b>${pet.name}</b> — ${tag}`,
          pet.premium ? "chest-pet premium" : "chest-pet"
        );
      });
    }

    this.hideModals();
    modal.classList.remove("hidden");
  }

  // Show the chest-opening reveal modal listing everything the chest dropped.
  _showChestReveal(reward) {
    const modal = this.el["chest"];
    if (!modal) {
      // No modal markup — fall back to a toast so rewards are never silent.
      this.toast(`🎁 +${reward.coins} coins!`);
      return;
    }
    Audio.coin();
    if (this.el["chest-icon"]) this.el["chest-icon"].textContent = "🎁";
    if (this.el["chest-title"])
      this.el["chest-title"].textContent = `${reward.category.name} — Tier ${
        reward.tierIndex + 1
      }`;
    if (this.el["chest-sub"])
      this.el["chest-sub"].textContent = "Chest opened!";

    const rewards = this.el["chest-rewards"];
    if (rewards) {
      rewards.innerHTML = "";
      const row = (icon, label, cls = "") => {
        const el = document.createElement("div");
        el.className = "chest-row" + (cls ? ` ${cls}` : "");
        el.innerHTML = `<span class="chest-row-ic">${icon}</span><span class="chest-row-tx">${label}</span>`;
        rewards.appendChild(el);
      };
      row(
        `<span class="coin-dot"></span>`,
        `<b>+${reward.coins}</b> coins`
      );
      reward.powerups.forEach((p) =>
        row(p.icon, `<b>${p.name}</b> ×${p.n}`)
      );
      if (reward.pet) {
        const tag = reward.pet.isNew ? "New pet!" : "+XP (duplicate)";
        row(
          reward.pet.icon,
          `<b>${reward.pet.name}</b> — ${tag}`,
          reward.pet.premium ? "chest-pet premium" : "chest-pet"
        );
      }
    }

    this.hideModals();
    modal.classList.remove("hidden");
  }

  // Toggle the little "chests waiting" badge on the menu's Trophies tile.
  refreshAchievementsBadge() {
    const badge = this.el["achv-badge"];
    if (!badge) return;
    const { progress, claims } = Storage.getAchievementState();
    const n = claimableCount(progress, claims);
    if (n > 0) {
      badge.textContent = n > 9 ? "9+" : String(n);
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  // ---- Login calendar / daily gifts ------------------------------------
  _calRewardLabel(reward) {
    const bits = [];
    if (reward.coins) bits.push(`${reward.coins} coins`);
    if (reward.powerup) {
      const info = POWERUP_INFO[reward.powerup] || {};
      bits.push(`${info.icon || "✨"} ${info.name || reward.powerup}`);
    }
    if (reward.crate) bits.push(`📦 crate`);
    return bits.join(" + ");
  }

  _calRewardIcon(reward) {
    if (reward.crate) return "📦";
    if (reward.powerup) {
      const info = POWERUP_INFO[reward.powerup] || {};
      return info.icon || "✨";
    }
    return "🪙";
  }

  buildCalendar() {
    const grid = this.el["cal-grid"];
    if (!grid) return;
    const state = Storage.get("loginCalendar");
    const st = calendarStatus(state, todayKey());
    grid.innerHTML = "";

    CALENDAR_REWARDS.forEach((reward, i) => {
      const cell = document.createElement("div");
      let cls = "cal-day";
      // Within the current cycle, days before the next index are collected,
      // the next index is today's (claimable), and the rest are upcoming.
      if (i < st.index) cls += " collected";
      else if (i === st.index && st.claimable) cls += " today";
      else if (i === st.index && !st.claimable) cls += " done";
      if (i === CALENDAR_CYCLE - 1) cls += " grand";
      cell.className = cls;
      cell.innerHTML =
        `<span class="cal-daynum">Day ${i + 1}</span>` +
        `<span class="cal-icon">${this._calRewardIcon(reward)}</span>` +
        `<span class="cal-amt">${this._calRewardLabel(reward)}</span>`;
      grid.appendChild(cell);
    });

    const status = this.el["cal-status"];
    if (status) status.textContent = `Day ${(st.day % CALENDAR_CYCLE) + 1}/${CALENDAR_CYCLE}`;

    const btn = this.el["cal-claim"];
    if (btn) {
      btn.disabled = !st.claimable;
      btn.textContent = st.claimable ? "Claim today's gift" : "Come back tomorrow";
    }
    this.refreshCalendarBadge();
  }

  _claimCalendar() {
    if (!this.cb.claimCalendar) return;
    const reward = this.cb.claimCalendar();
    if (!reward) {
      this.buildCalendar();
      return;
    }
    Audio.coin();
    const bits = [];
    if (reward.coins) bits.push(`+${reward.coins} coins`);
    if (reward.powerup) bits.push(`${reward.powerup.icon} ${reward.powerup.name}`);
    if (reward.crate) bits.push(`📦 crate`);
    this.toast(`🎁 ${bits.join(" + ")}`);
    this.buildCalendar();
  }

  // Show a badge on the menu's Gifts tile whenever today's reward is unclaimed.
  refreshCalendarBadge() {
    const badge = this.el["cal-badge"];
    if (!badge) return;
    const st = calendarStatus(Storage.get("loginCalendar"), todayKey());
    if (st.claimable) {
      badge.textContent = "!";
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  // ---- Daily & Weekly Quests --------------------------------------------
  buildQuests() {
    const list = this.el["quests-list"];
    if (!list) return;
    // Refresh the active quests for today/this week, then persist so the menu
    // badge and the screen agree even on the first open of a new day/week.
    const state = ensureQuests(Storage.get("quests"), todayKey(), weekKey());
    Storage.set("quests", state);
    list.innerHTML = "";

    const section = (title, sub, entries, scope) => {
      const head = document.createElement("div");
      head.className = "quests-head";
      head.innerHTML = `<span class="quests-head-title">${title}</span><span class="quests-head-sub">${sub}</span>`;
      list.appendChild(head);
      entries.forEach((entry, i) => {
        const def = questDef(entry.id);
        if (!def) return;
        const complete = isQuestComplete(entry);
        const claimable = isQuestClaimable(entry);
        const pct = Math.max(0, Math.min(1, entry.progress / def.goal));
        const row = document.createElement("div");
        row.className =
          "quest" + (claimable ? " claimable" : entry.claimed ? " claimed" : "");
        row.innerHTML =
          `<div class="quest-info">` +
          `<span class="quest-label">${def.label}</span>` +
          `<span class="quest-reward">${this._questRewardLabel(def.reward)}</span>` +
          `<div class="quest-bar"><div class="quest-bar-fill" style="width:${Math.round(
            pct * 100
          )}%"></div></div>` +
          `<span class="quest-progress">${Math.min(
            entry.progress,
            def.goal
          )}/${def.goal}</span>` +
          `</div>`;
        const btn = document.createElement("button");
        btn.className = "quest-claim";
        if (entry.claimed) {
          btn.textContent = "Claimed ✓";
          btn.disabled = true;
        } else if (claimable) {
          btn.textContent = "Claim";
          btn.disabled = false;
          btn.addEventListener("click", () => this._claimQuest(scope, i));
        } else {
          btn.textContent = complete ? "Claim" : "In progress";
          btn.disabled = true;
        }
        row.appendChild(btn);
        list.appendChild(row);
      });
    };

    section("Daily Quests", "Reset every day", state.daily, "daily");
    section("Weekly Quest", "Resets every week", state.weekly, "weekly");
    this.refreshQuestsBadge();
  }

  _questRewardLabel(reward) {
    if (!reward) return "";
    const bits = [];
    if (reward.coins) bits.push(`🪙 ${reward.coins}`);
    if (reward.powerup) {
      const info = POWERUP_INFO[reward.powerup];
      bits.push(`${info ? info.icon : "🎁"} ${info ? info.name : reward.powerup}`);
    }
    if (reward.crate) bits.push("📦 Crate");
    if (reward.seasonXp) bits.push(`⭐ ${reward.seasonXp} XP`);
    return bits.join(" · ");
  }

  _claimQuest(scope, index) {
    if (!this.cb.claimQuest) return;
    const res = this.cb.claimQuest(scope, index);
    if (!res) {
      this.buildQuests();
      return;
    }
    Audio.coin();
    this.toast(`🎁 ${this._questRewardLabel(res.reward)}`);
    this.buildQuests();
  }

  // Show a badge on the menu's Quests tile whenever a reward is ready to claim.
  refreshQuestsBadge() {
    const badge = this.el["quests-badge"];
    if (!badge) return;
    const state = ensureQuests(Storage.get("quests"), todayKey(), weekKey());
    const n = questsClaimable(state);
    if (n > 0) {
      badge.textContent = String(n);
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  // Show a badge on the menu Pets tile when any owned pet has a tech-tree
  // upgrade ready to pick. Counts pets, not pending tiers.
  refreshPetsBadge() {
    const badge = this.el["pets-badge"];
    if (!badge) return;
    if (!this._petFeatureUnlocked("pets") || !this._petFeatureUnlocked("tech")) {
      badge.classList.add("hidden");
      return;
    }
    let n = 0;
    if (this.cb.petHasPendingTech) {
      const owned = Storage.getPetState().owned || {};
      for (const id of Object.keys(owned)) {
        if (this.cb.petHasPendingTech(id)) n++;
      }
    }
    if (n > 0) {
      badge.textContent = String(n);
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  // ---- Stats / Profile dashboard ----------------------------------------
  // Render the read-only profile + lifetime totals. All data is sourced from
  // the save via the pure `stats.js` aggregator, so this is purely a view.
  buildStats() {
    const save = {
      achievements: Storage.get("achievements"),
      pets: Storage.get("pets"),
      ownedThemes: Storage.get("ownedThemes"),
      maxUnlockedLevel: Storage.get("maxUnlockedLevel"),
      coins: Economy.coins,
      highScoreEndless: Storage.get("highScoreEndless"),
      highScoreTimeAttack: Storage.get("highScoreTimeAttack"),
      daily: Storage.get("daily"),
    };
    const data = buildStatsData(save);
    this._fillStatGrid(this.el["stats-profile"], data.profile);
    this._fillStatGrid(this.el["stats-lifetime"], data.lifetime);
  }

  _fillStatGrid(grid, rows) {
    if (!grid) return;
    grid.innerHTML = "";
    rows.forEach((row) => {
      const cell = document.createElement("div");
      cell.className = "stat-cell";
      cell.innerHTML =
        `<span class="stat-ic" aria-hidden="true">${row.icon}</span>` +
        `<span class="stat-val">${formatStat(row.value)}</span>` +
        `<span class="stat-label">${row.label}</span>`;
      grid.appendChild(cell);
    });
  }

  // ---- Puzzle Mode ------------------------------------------------------
  // Render the puzzle ladder: a numbered grid of fixed challenges. Each cell
  // shows its board size and best star rating; locked puzzles (the next one
  // isn't reached until the prior is solved) show a padlock.
  buildPuzzles() {
    const grid = this.el["puzzle-list"];
    if (!grid) return;
    grid.innerHTML = "";
    const starsMap = Storage.getPuzzleStarsMap();
    for (let i = 0; i < PUZZLE_COUNT; i++) {
      const def = PUZZLES[i];
      const unlocked = isPuzzleUnlocked(i, starsMap);
      const stars = starsMap[i] || 0;
      const cell = document.createElement("div");
      cell.className = "puzzle-cell";
      if (!unlocked) cell.classList.add("locked");
      if (stars >= 1) cell.classList.add("solved");
      const starStr = "★".repeat(stars) + "☆".repeat(3 - stars);
      cell.innerHTML = unlocked
        ? `<span class="pz-num">${i + 1}</span>` +
          `<span class="pz-size">${def.cols}×${def.rows}</span>` +
          `<span class="pz-stars">${starStr}</span>` +
          `<span class="pz-moves">${def.moves} moves</span>`
        : `<span class="pz-lock">🔒</span><span class="pz-num">${i + 1}</span>`;
      if (unlocked) {
        cell.addEventListener("click", () => {
          Audio.click();
          this.cb.startPuzzle && this.cb.startPuzzle(i);
        });
      }
      grid.appendChild(cell);
    }
  }

  // Menu badge: how many unlocked puzzles are still waiting to be solved.
  refreshPuzzleBadge() {
    const badge = this.el["puzzle-badge"];
    if (!badge) return;
    const starsMap = Storage.getPuzzleStarsMap();
    let n = 0;
    for (let i = 0; i < PUZZLE_COUNT; i++) {
      if (isPuzzleUnlocked(i, starsMap) && (starsMap[i] || 0) === 0) n++;
    }
    if (n > 0) {
      badge.textContent = String(n);
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  // ---- Season Pass ------------------------------------------------------
  buildSeason() {
    const track = this.el["season-track"];
    if (!track) return;
    const state = Storage.get("season");
    const st = seasonStatus(state);

    // XP / tier header.
    const label = this.el["season-xp-label"];
    if (label) {
      label.textContent = st.maxed
        ? `Tier ${SEASON_TIER_COUNT} — Season complete!`
        : `Tier ${st.tier + 1} · ${st.intoTier}/${st.perTier} XP`;
    }
    const fill = this.el["season-xp-fill"];
    if (fill) fill.style.width = `${Math.round(st.progress * 100)}%`;

    const buy = this.el["season-buy"];
    if (buy) {
      buy.classList.toggle("hidden", st.premium);
      buy.textContent = "Unlock Premium";
    }

    // Tier ladder: free + premium reward per row.
    track.innerHTML = "";
    SEASON_TIERS.forEach((tier, i) => {
      const unlocked = i < st.unlocked;
      const row = document.createElement("div");
      row.className = "season-row" + (unlocked ? " unlocked" : " locked");

      const num = document.createElement("div");
      num.className = "season-tier-num";
      num.textContent = i + 1;
      row.appendChild(num);

      row.appendChild(this._seasonReward(state, i, "free", unlocked, st));
      row.appendChild(this._seasonReward(state, i, "premium", unlocked, st));
      track.appendChild(row);
    });
    this.refreshSeasonBadge();
  }

  _seasonReward(state, index, trackName, unlocked, st) {
    const reward = tierReward(index, trackName) || {};
    const cell = document.createElement("div");
    cell.className = `season-cell season-${trackName}`;
    const claimedList = trackName === "premium" ? "claimedPrem" : "claimedFree";
    const claimed = (state[claimedList] || []).includes(index);
    const premiumLocked = trackName === "premium" && !st.premium;
    const claimable = unlocked && !claimed && !premiumLocked;

    if (claimed) cell.classList.add("claimed");
    if (claimable) cell.classList.add("claimable");
    if (premiumLocked) cell.classList.add("prem-locked");

    cell.innerHTML =
      `<span class="season-ic">${this._calRewardIcon(reward)}</span>` +
      `<span class="season-amt">${this._calRewardLabel(reward)}</span>` +
      (claimed ? `<span class="season-tick">✓</span>` : "");

    if (claimable) {
      cell.setAttribute("role", "button");
      cell.addEventListener("click", () => {
        Audio.click();
        this._claimSeasonTier(index, trackName);
      });
    }
    return cell;
  }

  _claimSeasonTier(index, track) {
    if (!this.cb.claimSeasonTier) return;
    const reward = this.cb.claimSeasonTier(index, track);
    if (!reward) {
      this.buildSeason();
      return;
    }
    Audio.coin();
    const bits = [];
    if (reward.coins) bits.push(`+${reward.coins} coins`);
    if (reward.powerup) bits.push(`${reward.powerup.icon} ${reward.powerup.name}`);
    if (reward.crate) bits.push(`📦 crate`);
    this.toast(`⭐ ${bits.join(" + ")}`);
    this.buildSeason();
  }

  async _buySeasonPremium() {
    if (!this.cb.buySeasonPremium) return;
    const ok = await this.cb.buySeasonPremium();
    if (ok) this.toast("⭐ Premium Season Pass unlocked!");
    this.buildSeason();
  }

  // Badge on the menu's Season tile whenever a reward tier is claimable.
  refreshSeasonBadge() {
    const badge = this.el["season-badge"];
    if (!badge) return;
    const st = seasonStatus(Storage.get("season"));
    if (st.claimable > 0) {
      badge.textContent = st.claimable > 9 ? "9+" : String(st.claimable);
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  // ---- Pets -------------------------------------------------------------
  _petFeatureUnlocked(feature) {
    return isPetFeatureUnlocked(feature, Storage.get("maxUnlockedLevel"));
  }

  refreshPetAccess() {
    const petsUnlocked = this._petFeatureUnlocked("pets");
    const tile = this.el["btn-pets"];
    if (!tile) return;
    tile.classList.toggle("hidden", !petsUnlocked);
    const sub = tile.querySelector(".tile-sub");
    if (sub) sub.textContent = petsUnlocked ? "Companions" : "Unlocks later";
  }

  _petFeatureLockHtml(feature, body) {
    const info = PET_FEATURE_INFO[feature] || { icon: "🔒", name: "Locked", lesson: "Keep clearing campaign levels." };
    const level = petFeatureUnlockLevel(feature);
    return `<div class="pet-feature-lock"><span class="pfl-icon">${info.icon}</span><span class="pfl-copy"><b>${info.name} unlocks at Level ${level}</b><span>${body || info.lesson}</span></span></div>`;
  }

  buildPets() {
    if (!this._petFeatureUnlocked("pets")) return;
    const { owned } = Storage.getPetState();
    // Default the detail selection to the equipped pet (or first owned one).
    if (!this._selectedPet || !PET_CATALOG.find((p) => p.id === this._selectedPet)) {
      const eq = Storage.getPetState().equipped;
      this._selectedPet = eq || PET_CATALOG[0].id;
    }
    this._buildPetCrate();
    if (this._petFeatureUnlocked("party")) this._buildPetParty();
    else if (this.el["pet-party"]) this.el["pet-party"].innerHTML = "";
    if (this._petFeatureUnlocked("gems")) this._buildPetGems();
    else if (this.el["pet-gems"]) this.el["pet-gems"].innerHTML = "";
    if (this._petFeatureUnlocked("crates")) this._buildPetStore();
    else if (this.el["pet-store"]) this.el["pet-store"].innerHTML = "";
    this._buildPetList(owned);
    this._buildPetDetail(owned);
  }

  // Party summary: the equipped lead + up to SUPPORT_SLOTS support slots, plus
  // any active set synergies. Supports lend a fraction of their passive buffs.
  _buildPetParty() {
    const wrap = this.el["pet-party"];
    if (!wrap) return;
    const st = Storage.getPetState();
    const lead = st.equipped && st.owned[st.equipped] ? getPet(st.equipped) : null;
    const supports = Storage.getPartySupports();
    const slotHtml = (petId, role) => {
      const p = petId ? getPet(petId) : null;
      const cls = role === "lead" ? "pp-slot pp-lead" : "pp-slot";
      if (!p) return `<div class="${cls} pp-empty" title="Empty support slot">＋</div>`;
      return `<div class="${cls}" title="${p.name}"><span class="pp-icon">${p.icon}</span><span class="pp-role">${role === "lead" ? "Lead" : "Support"}</span></div>`;
    };
    let html = `<div class="pp-title">Party</div><div class="pp-slots">`;
    html += slotHtml(lead ? lead.id : null, "lead");
    for (let i = 0; i < SUPPORT_SLOTS; i++) html += slotHtml(supports[i] || null, "support");
    html += `</div>`;

    // Active synergies (built from the live party roster).
    const members = [];
    if (lead) members.push({ id: lead.id });
    for (const id of supports) members.push({ id });
    const syn = activeSynergies(members);
    html += `<div class="pp-syn">`;
    if (syn.length) {
      html += syn
        .map((s) => `<span class="pp-syn-chip" title="${s.desc}">${s.icon} ${s.label}</span>`)
        .join("");
    } else {
      html += `<span class="pp-syn-none">No active synergy — fill your party to unlock bonuses.</span>`;
    }
    html += `</div>`;
    wrap.innerHTML = html;
  }

  _buildPetCrate() {
    const wrap = this.el["pets-crate"];
    if (!wrap) return;
    if (!this._petFeatureUnlocked("crates")) {
      wrap.innerHTML = this._petFeatureLockHtml("crates", "Your first companion can level up now. More pets arrive soon.");
      return;
    }
    const { crates, dust } = Storage.getPetState();
    wrap.innerHTML = "";
    const info = document.createElement("div");
    info.className = "crate-info";
    const dustText = this._petFeatureUnlocked("gems")
      ? `✨ <b id="dust-count">${dust}</b> Pet Dust — craft & embue gems`
      : "Duplicate pets become XP now. Pet Dust becomes useful later.";
    info.innerHTML = `<span class="crate-icon crate-art crate-art-pet" aria-hidden="true"><span class="ca-glow"></span><span class="ca-lid"></span><span class="ca-body"></span><span class="ca-band"></span><span class="ca-lock"></span><span class="ca-gem ca-g1"></span><span class="ca-gem ca-g2"></span></span><div><div class="crate-title">Pet Crates</div><div class="crate-sub">You have <b id="crate-count">${crates}</b> — open one to win a pet!</div><div class="crate-dust">${dustText}</div></div>`;

    const openBtn = document.createElement("button");
    openBtn.className = "buy-btn pet-open-btn";
    openBtn.id = "crate-open";
    openBtn.textContent = "Open";
    openBtn.disabled = crates <= 0;
    openBtn.addEventListener("click", () => {
      if (!this.cb.openCrate) return;
      const res = this.cb.openCrate();
      if (!res) {
        this.toast("No crates to open");
        return;
      }
      const pet = getPet(res.petId);
      Audio.coin();
      this._selectedPet = res.petId;
      this.buildPets();
      if (res.isNew) {
        this.showPetReveal(res);
      } else {
        const dustTxt = res.dust ? ` (+${res.dust}✨ dust)` : "";
        this.toast(`${pet.icon} ${pet.name} +XP${dustTxt} (duplicate)`);
      }
    });

    const buyBtn = document.createElement("button");
    buyBtn.className = "buy-btn pet-buy-crate";
    buyBtn.id = "crate-buy";
    buyBtn.innerHTML = `<span class="coin-dot"></span>${CRATE_COST}`;
    const crateLabel = buyBtn.innerHTML;
    const crateFeedback = ({ phase, count, max }) => {
      buyBtn.classList.toggle("buying", phase === "buying");
      buyBtn.classList.toggle("capped", phase === "capped");
      if (phase === "buying" || phase === "capped") {
        buyBtn.textContent = phase === "capped" ? `Limit ${count}/${max}` : `Buying ${count}/${max}`;
      } else if (phase === "blocked") {
        buyBtn.textContent = "Stopped";
      } else {
        buyBtn.innerHTML = crateLabel;
      }
    };
    this._attachHoldRepeat(buyBtn, () => {
      if (this.cb.buyCrate && this.cb.buyCrate()) {
        Audio.coin();
        this.toast("Crate purchased!");
        const count = wrap.querySelector("#crate-count");
        if (count) count.textContent = Storage.getPetState().crates;
        openBtn.disabled = false;
        this.refreshCoins();
        return true;
      } else {
        this.toast("Not enough coins");
        return false;
      }
    }, { update: crateFeedback });

    const btns = document.createElement("div");
    btns.className = "crate-btns";
    btns.appendChild(openBtn);
    btns.appendChild(buyBtn);
    wrap.appendChild(info);
    wrap.appendChild(btns);
  }

  // The Pet Store: where the most valuable (premium) companions live. They're
  // bought directly with real money, or — very rarely (<1%) — surprise you out
  // of an ordinary crate. The premium Legendary Crate gives boosted odds.
  _buildPetStore() {
    const wrap = this.el["pet-store"];
    if (!wrap) return;
    const { owned } = Storage.getPetState();
    wrap.innerHTML = "";

    const head = document.createElement("div");
    head.className = "store-head";
    head.innerHTML =
      `<span class="store-title">💎 Pet Store</span>` +
      `<span class="store-note">Premium companions — buy here, or a rare (&lt;1%) crate surprise.</span>`;
    wrap.appendChild(head);

    // Premium Legendary Crate (real-money, boosted odds).
    const legend = document.createElement("div");
    legend.className = "store-item store-legend";
    legend.innerHTML =
      `<span class="store-icon crate-art crate-art-legend" aria-hidden="true"><span class="ca-glow"></span><span class="ca-lid"></span><span class="ca-body"></span><span class="ca-band"></span><span class="ca-lock"></span><span class="ca-gem ca-g1"></span><span class="ca-gem ca-g2"></span></span>` +
      `<div class="store-meta"><div class="store-name">Legendary Crate</div>` +
      `<div class="store-sub">Guaranteed legendary — high chance of a premium pet!</div></div>`;
    const legendBtn = document.createElement("button");
    legendBtn.className = "buy-btn store-buy";
    legendBtn.id = "legend-crate-buy";
    legendBtn.textContent = LEGENDARY_CRATE.price;
    legendBtn.addEventListener("click", async () => {
      Audio.click();
      legendBtn.disabled = true;
      const res = this.cb.buyLegendaryCrate && (await this.cb.buyLegendaryCrate());
      if (res) {
        const pet = getPet(res.petId);
        Audio.coin();
        this._selectedPet = res.petId;
        this.buildPets();
        if (res.isNew) {
          this.showPetReveal(res);
        } else {
          this.toast(`${pet.icon} ${pet.name} +XP (duplicate)`);
        }
      } else {
        legendBtn.disabled = false;
        this.toast("Purchase failed");
      }
    });
    legend.appendChild(legendBtn);
    wrap.appendChild(legend);

    // Premium pets, each buyable directly with real money.
    premiumPets().forEach((pet) => {
      const has = !!owned[pet.id];
      const item = document.createElement("div");
      item.className = `store-item rarity-${pet.rarity}`;
      item.innerHTML =
        `<span class="store-icon">${pet.icon}</span>` +
        `<div class="store-meta"><div class="store-name">${pet.name} ` +
        `<span class="pd-rarity tag-premium">premium</span></div>` +
        `<div class="store-sub">${pet.desc}</div></div>`;
      const btn = document.createElement("button");
      btn.className = "buy-btn store-buy";
      btn.dataset.pet = pet.id;
      if (has) {
        btn.textContent = "Owned";
        btn.disabled = true;
        btn.classList.add("active-tag");
      } else {
        btn.textContent = pet.price;
        btn.addEventListener("click", async () => {
          Audio.click();
          btn.disabled = true;
          const ok = this.cb.buyPremiumPet && (await this.cb.buyPremiumPet(pet.id));
          if (ok) {
            this._selectedPet = pet.id;
            this.buildPets();
            this.showPetReveal({ petId: pet.id, isNew: true, premium: true });
          } else {
            btn.disabled = false;
            this.toast("Purchase failed");
          }
        });
      }
      item.appendChild(btn);
      wrap.appendChild(item);
    });
  }

  _buildPetList(owned) {
    const list = this.el["pet-list"];
    if (!list) return;
    list.innerHTML = "";
    const equipped = Storage.getPetState().equipped;
    PET_CATALOG.forEach((pet) => {
      const has = !!owned[pet.id];
      const card = document.createElement("button");
      card.className = `pet-card rarity-${pet.rarity}`;
      card.dataset.pet = pet.id;
      if (has) card.classList.add("owned");
      else card.classList.add("locked");
      if (pet.id === this._selectedPet) card.classList.add("selected");
      if (equipped === pet.id) card.classList.add("equipped");

      const lvl = has ? levelForXp(owned[pet.id].xp || 0) : 0;
      const cos = has ? getCosmetic(owned[pet.id].cosmetic) : null;
      const hue = cos ? cos.hue : 0;
      const tag = pet.premium && !has ? "premium" : pet.rarity;
      const pendingTech = has && this.cb.petHasPendingTech && this.cb.petHasPendingTech(pet.id);
      card.innerHTML =
        `<span class="pet-icon" style="filter:hue-rotate(${hue}deg)">${has ? pet.icon : (pet.premium ? "💎" : "❓")}</span>` +
        `<span class="pet-name">${has ? pet.name : (pet.premium ? "Premium" : "???")}</span>` +
        `<span class="pet-tag tag-${tag}">${has ? "Lv." + lvl : tag}</span>` +
        (equipped === pet.id ? `<span class="pet-eqbadge">✓</span>` : "") +
        (pendingTech ? `<span class="pet-techbadge" title="Tech upgrade ready">🧬</span>` : "");
      card.addEventListener("click", () => {
        Audio.click();
        this._selectedPet = pet.id;
        this.buildPets();
      });
      list.appendChild(card);
    });
  }

  _buildPetDetail(owned) {
    const panel = this.el["pet-detail"];
    if (!panel) return;
    const pet = getPet(this._selectedPet);
    if (!pet) {
      panel.innerHTML = "";
      return;
    }
    const has = !!owned[pet.id];
    const equipped = Storage.getPetState().equipped;
    panel.innerHTML = "";

    const head = document.createElement("div");
    head.className = "pd-head";
    const lvl = has ? levelForXp(owned[pet.id].xp || 0) : 1;
    const cos = has ? getCosmetic(owned[pet.id].cosmetic) : getCosmetic("default");
    head.innerHTML =
      `<span class="pd-icon" style="filter:hue-rotate(${cos.hue}deg)">${pet.icon}</span>` +
      `<div class="pd-meta"><div class="pd-name">${pet.name} <span class="pd-rarity tag-${pet.rarity}">${pet.rarity}</span></div>` +
      `<div class="pd-desc">${pet.desc}</div>` +
      `<div class="pd-ability">${this._petAbilityText(pet, has ? lvl : 1)}</div></div>`;
    panel.appendChild(head);
    panel.appendChild(this._buildPetGuide(pet, has, equipped === pet.id));

    if (has) {
      // XP / level bar.
      const prog = levelProgress(owned[pet.id].xp || 0);
      const bar = document.createElement("div");
      bar.className = "pd-xp";
      bar.innerHTML =
        `<div class="pd-xp-top"><span>Lv.${prog.level}${prog.max ? " (MAX)" : ""}</span>` +
        `<span>${prog.max ? "" : prog.toNext + " XP to next"}</span></div>` +
        `<div class="pd-xp-bar"><div class="pd-xp-fill" style="width:${Math.round(prog.progress * 100)}%"></div></div>`;
      panel.appendChild(bar);

      // Personality trait (rolled on acquisition).
      const trait = getTrait(owned[pet.id].trait);
      const traitEl = document.createElement("div");
      traitEl.className = "pd-trait";
      traitEl.innerHTML =
        `<span class="pd-trait-icon">${trait.icon}</span>` +
        `<span class="pd-trait-name">${trait.label}</span>` +
        `<span class="pd-trait-desc">${trait.desc}</span>`;
      panel.appendChild(traitEl);

      // Gem sockets (unlock with level; tap to socket / unsocket a gem).
      if (this._petFeatureUnlocked("gems")) panel.appendChild(this._buildSocketRow(pet, lvl, owned[pet.id]));

      // Technology tree (pick one upgrade per level-up tier).
      if (this._petFeatureUnlocked("tech")) panel.appendChild(this._buildPetTech(pet, lvl, owned[pet.id]));

      // Equip button.
      const equip = document.createElement("button");
      equip.className = "buy-btn pet-equip-btn";
      equip.id = "pet-equip";
      if (equipped === pet.id) {
        equip.textContent = "Equipped";
        equip.classList.add("active-tag");
        equip.disabled = true;
      } else {
        equip.textContent = "Equip";
        equip.classList.add("owned");
        equip.addEventListener("click", () => {
          Audio.click();
          this._requestEquip(pet);
        });
      }
      const actions = document.createElement("div");
      actions.className = "pd-action-row";
      actions.appendChild(equip);

      // Support-slot toggle (only for owned pets that aren't the current lead).
      if (this._petFeatureUnlocked("party") && equipped !== pet.id) {
        const supports = Storage.getPartySupports();
        const inParty = supports.includes(pet.id);
        const full = supports.length >= SUPPORT_SLOTS;
        const sup = document.createElement("button");
        sup.className = "buy-btn pet-support-btn";
        sup.id = "pet-support";
        if (inParty) {
          sup.textContent = "In Party ✓";
          sup.classList.add("active-tag");
        } else if (full) {
          sup.textContent = "Party Full";
          sup.disabled = true;
        } else {
          sup.textContent = "Add to Party";
          sup.classList.add("owned");
        }
        sup.addEventListener("click", () => {
          if (sup.disabled) return;
          Audio.click();
          if (this.cb.toggleSupport) this.cb.toggleSupport(pet.id);
          this.buildPets();
        });
        actions.appendChild(sup);
      }
      if (this._petFeatureUnlocked("gems")) {
        const forge = document.createElement("button");
        forge.className = "buy-btn pd-forge-btn";
        forge.textContent = "Gem Forge";
        forge.addEventListener("click", () => {
          Audio.click();
          this.openGemForge();
        });
        actions.appendChild(forge);
      }
      panel.appendChild(actions);

      // Cosmetics row.
      panel.appendChild(this._buildCosmetics(pet, owned[pet.id]));
    } else if (pet.premium) {
      const buy = document.createElement("button");
      buy.className = "buy-btn pet-premium-btn";
      buy.id = "pet-premium-buy";
      buy.textContent = `Unlock ${pet.price}`;
      buy.addEventListener("click", async () => {
        Audio.click();
        buy.disabled = true;
        const ok = this.cb.buyPremiumPet && (await this.cb.buyPremiumPet(pet.id));
        if (ok) {
          this.toast(`${pet.icon} ${pet.name} unlocked!`);
          this._selectedPet = pet.id;
          this.buildPets();
        } else {
          buy.disabled = false;
          this.toast("Purchase failed");
        }
      });
      panel.appendChild(buy);
    } else {
      const hint = document.createElement("div");
      hint.className = "pd-locked-hint";
      hint.textContent = `Open Pet Crates to win ${pet.name}. Duplicate pulls turn into ✨ Pet Dust you can spend on gems.`;
      panel.appendChild(hint);
    }
  }

  _buildPetGuide(pet, has, equipped) {
    const guide = document.createElement("div");
    guide.className = "pd-guide";
    const mode = pet.active ? "Active" : "Passive";
    const gems = has ? "Socket gems" : "Win in crates";
    const party = equipped ? "Lead pet" : "Party option";
    guide.innerHTML =
      `<span class="pd-guide-chip">${has ? "Owned" : "Locked"}</span>` +
      (this._petFeatureUnlocked("abilities") ? `<span class="pd-guide-chip">${mode}</span>` : "") +
      (this._petFeatureUnlocked("gems") ? `<span class="pd-guide-chip">${gems}</span>` : "") +
      (this._petFeatureUnlocked("party") ? `<span class="pd-guide-chip">${party}</span>` : "");
    return guide;
  }

  _petAbilityText(pet, level) {
    if (pet.active) {
      const a = petActive(pet.id, level);
      if (pet.active.type === "cleanse")
        return `🐾 ${a.label} (clears ${a.count} every ${a.cooldown} moves)`;
      return `🐾 ${a.label} (every ${a.cooldown} moves)`;
    }
    const b = petBuffs(pet.id, level);
    const key = pet.ability.key;
    if (key === "startCharge")
      return `🐾 ${pet.ability.label} (+${Math.round(b.startCharge * 100)}% charge)`;
    const pct = Math.round((b[key] - 1) * 100);
    return `🐾 ${pet.ability.label} (+${pct}%)`;
  }

  // A pet's gem-socket row: one button per unlocked socket (level-gated).
  // Empty slots open the gem picker; filled slots pop their gem back out.
  _buildSocketRow(pet, lvl, state) {
    const wrap = document.createElement("div");
    wrap.className = "pd-sockets";
    const max = socketsForLevel(lvl);
    const sockets = state && Array.isArray(state.sockets) ? state.sockets : [];
    const title = document.createElement("div");
    title.className = "pd-sockets-title";
    title.textContent = "💎 Gem Sockets";
    wrap.appendChild(title);
    if (max <= 0) {
      const hint = document.createElement("div");
      hint.className = "pd-sockets-hint";
      hint.textContent = "Unlocks at Lv.2 (a 2nd socket at Lv.4).";
      wrap.appendChild(hint);
      return wrap;
    }
    const row = document.createElement("div");
    row.className = "pd-socket-row";
    for (let i = 0; i < max; i++) {
      const key = sockets[i] || null;
      const slot = document.createElement("button");
      slot.className = "socket-slot" + (key ? " filled" : " empty");
      slot.dataset.slot = String(i);
      if (key) {
        const g = parseGemKey(key);
        slot.innerHTML = `<span class="ss-gem">${gemIcon(key)}</span>`;
        slot.title = `${gemLabel(key)} (${gemBuffLabel(key)}) — tap to remove`;
        if (g) slot.style.borderColor = g.def.color;
        slot.addEventListener("click", () => {
          Audio.click();
          this._requestUnsocket(pet, i, key);
        });
      } else {
        slot.textContent = "＋";
        slot.title = "Tap to socket a gem";
        slot.addEventListener("click", () => {
          Audio.click();
          this._gemPicker = { petId: pet.id, slot: i };
          this._gemPickSel = null;
          this._buildPetGems();
          this._buildPetDetail(Storage.getPetState().owned);
        });
      }
      row.appendChild(slot);
    }
    wrap.appendChild(row);

    // Caption: what each filled socket is currently granting, so the live buff
    // is legible at a glance.
    const filled = sockets.filter(Boolean);
    if (filled.length) {
      const caps = document.createElement("div");
      caps.className = "pd-socket-buffs";
      caps.innerHTML = filled
        .map(
          (key) =>
            `<span class="pd-socket-buff">${gemIcon(key)} ${gemBuffLabel(key)}</span>`
        )
        .join("");
      wrap.appendChild(caps);
    }
    return wrap;
  }

  // A pet's technology tree: four tiers, each unlocked at a level-up (Lv.2→5).
  // The player picks ONE of two nodes per tier; the choice is permanent. The
  // currently-pending tier is highlighted and its options are clickable; locked
  // future tiers show the level required.
  _buildPetTech(pet, lvl, state) {
    const wrap = document.createElement("div");
    wrap.className = "pd-tech";
    const chosen = state && Array.isArray(state.tech) ? state.tech : [];
    const pending = pendingTechTier(chosen, lvl);
    const unlocked = techTiersUnlocked(lvl);
    const title = document.createElement("div");
    title.className = "pd-tech-title";
    title.innerHTML = `🧬 Tech Tree` + (pending >= 0 ? `<span class="pd-tech-pip">Pick!</span>` : "");
    wrap.appendChild(title);
    for (let i = 0; i < TECH_TREE.length; i++) {
      const tier = techTierAt(i);
      const tierEl = document.createElement("div");
      tierEl.className = "pd-tech-tier";
      const chosenNode = tier.options.find((o) => chosen.includes(o.id));
      if (chosenNode) {
        // Already picked — show the locked-in node.
        tierEl.classList.add("picked");
        const node = document.createElement("div");
        node.className = "pd-tech-node chosen";
        node.innerHTML =
          `<span class="tn-icon">${chosenNode.icon}</span>` +
          `<span class="tn-name">${chosenNode.name}</span>` +
          `<span class="tn-desc">${chosenNode.desc}</span>` +
          `<span class="tn-check">✓</span>`;
        tierEl.appendChild(node);
      } else if (i === pending) {
        // The tier the player can pick right now — both options clickable.
        tierEl.classList.add("pending");
        const head = document.createElement("div");
        head.className = "pd-tech-head";
        head.textContent = `Tier ${tier.tier} — choose one`;
        tierEl.appendChild(head);
        const opts = document.createElement("div");
        opts.className = "pd-tech-opts";
        for (const o of tier.options) {
          const btn = document.createElement("button");
          btn.className = "pd-tech-node opt";
          btn.dataset.node = o.id;
          btn.innerHTML =
            `<span class="tn-icon">${o.icon}</span>` +
            `<span class="tn-name">${o.name}</span>` +
            `<span class="tn-desc">${o.desc}</span>`;
          btn.addEventListener("click", () => {
            Audio.click();
            if (this.cb.pickPetTech) {
              const res = this.cb.pickPetTech(pet.id, o.id);
              if (res && res.ok) {
                Audio.powerup();
                this.toast(`${o.icon} ${o.name} unlocked!`);
              }
            }
            this.buildPets();
          });
          opts.appendChild(btn);
        }
        tierEl.appendChild(opts);
      } else {
        // Locked future tier — show the level required to unlock it.
        tierEl.classList.add("locked");
        const lock = document.createElement("div");
        lock.className = "pd-tech-lock";
        lock.innerHTML =
          `<span class="tl-icon">🔒</span>` +
          `<span class="tl-text">Tier ${tier.tier} — reach Lv.${tier.minLevel}</span>`;
        tierEl.appendChild(lock);
      }
      wrap.appendChild(tierEl);
    }
    return wrap;
  }

  // Removing a gem destroys it for a partial dust refund — confirm first so the
  // player understands they won't get the gem (or the full embue cost) back.
  _requestUnsocket(pet, slot, key) {
    this._pendingUnsocket = { petId: pet.id, slot };
    const g = parseGemKey(key);
    const refund = g ? unsocketDustRefund(g.tier) : 0;
    const paid = g ? socketDustCost(g.tier) : 0;
    if (this.el["gem-remove-sub"]) {
      this.el["gem-remove-sub"].innerHTML =
        `Removing <b>${gemLabel(key)}</b> <b>shatters</b> it — you do <b>not</b> get the gem back. ` +
        `You'll recover only <b>✨${refund} dust</b> of the ✨${paid} spent to embue it.`;
    }
    if (this.el["gem-remove"]) this.el["gem-remove"].classList.remove("hidden");
  }

  _cancelUnsocket() {
    this._pendingUnsocket = null;
    if (this.el["gem-remove"]) this.el["gem-remove"].classList.add("hidden");
  }

  _confirmUnsocket() {
    const req = this._pendingUnsocket;
    this._pendingUnsocket = null;
    if (this.el["gem-remove"]) this.el["gem-remove"].classList.add("hidden");
    if (!req || !this.cb.unsocketGem) return;
    const res = this.cb.unsocketGem(req.petId, req.slot);
    if (res) {
      Audio.blast();
      this.toast(`Gem shattered — recovered ✨${res.dust} dust`);
    }
    this.buildPets();
  }

  // A short "magical embue" flourish played when a gem is bound into a socket.
  // One of 5 randomly-chosen variants keeps repeated socketing fresh. Honours
  // reduced-motion (skips the burst but still records the variant for parity).
  _playSocketMagic() {
    const variant = Math.floor(Math.random() * 5);
    this._lastSocketMagic = variant;
    if (this._motionOff() || typeof document === "undefined") return variant;
    const fx = document.createElement("div");
    fx.className = "socket-magic";
    fx.dataset.variant = String(variant);
    // A ring, a glyph, and a scatter of sparks — styled per variant in CSS.
    const glyphs = ["✦", "✧", "❂", "✺", "❖"];
    fx.innerHTML =
      `<span class="sm-ring"></span><span class="sm-glyph">${glyphs[variant]}</span>` +
      Array.from({ length: 6 }, (_, i) => `<span class="sm-spark sm-spark-${i}"></span>`).join("");
    document.body.appendChild(fx);
    setTimeout(() => fx.remove(), 1000);
    return variant;
  }

  // Gem inventory + crafting panel (and the in-place gem picker when slotting).
  _buildPetGems() {
    const wrap = this.el["pet-gems"];
    if (!wrap) return;
    const gems = Storage.getGems();
    const dust = Storage.getDust();
    wrap.innerHTML = "";

    // Picker mode: choosing which inventory gem to slot into a pet socket. The
    // panel lives above the pet detail in the DOM, so render it as a centered
    // overlay (pg-picking) — otherwise the picker opens off-screen above the
    // socket the player just tapped.
    if (this._gemPicker) {
      wrap.classList.add("pg-picking");
      const { petId, slot } = this._gemPicker;
      const pet = getPet(petId);
      const ownedPet = Storage.getPetState().owned[petId] || {};
      const lvl = levelForXp(ownedPet.xp || 0);
      const maxTier = maxGemTierForLevel(lvl);
      const card = document.createElement("div");
      card.className = "pg-picker-card";

      const head = document.createElement("div");
      head.className = "pg-pick-head";
      head.innerHTML =
        `<span class="pg-pick-title">Socket a gem</span>` +
        `<span class="pg-pick-sub">${pet ? pet.name : "Pet"} · Slot ${slot + 1} · Lv.${lvl}</span>`;
      card.appendChild(head);

      const keys = Object.keys(gems).filter((k) => gems[k] > 0);
      // Strongest first: higher tier, then larger buff magnitude — so the most
      // powerful gems lead and the "BEST" badge lands on the top one you can use.
      keys.sort((a, b) => {
        const ga = parseGemKey(a), gb = parseGemKey(b);
        const ta = ga ? gemTierIndex(ga.tier) : -1;
        const tb = gb ? gemTierIndex(gb.tier) : -1;
        if (tb !== ta) return tb - ta;
        return Math.abs(gemValue(b)) - Math.abs(gemValue(a));
      });
      const socketable = (key) => {
        const g = parseGemKey(key);
        if (!g) return false;
        if (gemTierIndex(g.tier) > maxTier) return false;
        return dust >= socketDustCost(g.tier);
      };
      const bestKey = keys.find(socketable) || null;
      // Default the selection to the strongest gem the player can actually
      // socket, so a single tap on Embue equips the best option.
      if (!this._gemPickSel || !gems[this._gemPickSel]) {
        this._gemPickSel = bestKey || keys[0] || null;
      }
      const sel = this._gemPickSel;

      if (!keys.length) {
        const empty = document.createElement("div");
        empty.className = "pg-empty";
        empty.textContent = "No gems yet — craft one in the Gem Forge, or find them in crates & gifts.";
        card.appendChild(empty);
      } else {
        const gridWrap = document.createElement("div");
        gridWrap.className = "pg-pick-gridwrap";
        const grid = document.createElement("div");
        grid.className = "pg-pick-grid";
        for (const key of keys) {
          const g = parseGemKey(key);
          const tierIdx = g ? gemTierIndex(g.tier) : 0;
          const tierLocked = g ? tierIdx > maxTier : true;
          const cost = g ? socketDustCost(g.tier) : 0;
          const tooPoor = !tierLocked && dust < cost;
          const cell = document.createElement("button");
          cell.className =
            "pg-pick-cell" +
            (key === sel ? " sel" : "") +
            (tierLocked ? " locked" : "") +
            (tooPoor ? " poor" : "") +
            (key === bestKey ? " best" : "");
          cell.dataset.gem = key;
          if (g) cell.style.setProperty("--gc", g.def.color);
          cell.title = gemLabel(key) + " — " + gemBuffLabel(key);
          cell.innerHTML =
            `<span class="pg-pc-count">×${gems[key]}</span>` +
            (key === bestKey ? `<span class="pg-pc-best">★ BEST</span>` : "") +
            (g ? this._gemVis(g.type, g.tier) : "") +
            `<span class="pg-pc-stars">${"◆".repeat(tierIdx + 1)}</span>` +
            (tierLocked ? `<span class="pg-pc-lock">🔒</span>` : "");
          cell.addEventListener("click", () => {
            Audio.click();
            this._gemPickSel = key;
            this._buildPetGems();
          });
          grid.appendChild(cell);
        }
        gridWrap.appendChild(grid);
        card.appendChild(gridWrap);

        // Selected-gem detail: big visual, exact buff, and a power bar so the
        // player can clearly see what they picked and how strong it is.
        const sg = parseGemKey(sel);
        const sTierIdx = sg ? gemTierIndex(sg.tier) : 0;
        const sLocked = sg ? sTierIdx > maxTier : true;
        const sCost = sg ? socketDustCost(sg.tier) : 0;
        const sPoor = !sLocked && dust < sCost;
        const powerPct = Math.round(((sTierIdx + 1) / GEM_TIERS.length) * 100);
        const detail = document.createElement("div");
        detail.className = "pg-pick-detail";
        detail.innerHTML =
          `<div class="pg-pd-top">` +
            `<span class="pg-pd-vis">${sg ? this._gemVis(sg.type, sg.tier) : ""}</span>` +
            `<div class="pg-pd-info">` +
              `<div class="pg-pd-name">${gemLabel(sel)}` +
                `<span class="pg-pd-stars">${"◆".repeat(sTierIdx + 1)}</span></div>` +
              `<div class="pg-pd-buff">${gemBuffLabel(sel)}</div>` +
            `</div>` +
            `<span class="pg-pd-have">×${gems[sel]}</span>` +
          `</div>` +
          `<div class="pg-pd-power">` +
            `<span class="pg-pd-plabel">Power</span>` +
            `<span class="pg-pd-bar"><span class="pg-pd-fill" style="width:${powerPct}%;background:${sg ? sg.def.color : "#888"}"></span></span>` +
            `<span class="pg-pd-tier">${getGemTier(sg ? sg.tier : "chipped").label}</span>` +
          `</div>`;
        card.appendChild(detail);

        const actions = document.createElement("div");
        actions.className = "pg-pick-actions";
        const embue = document.createElement("button");
        embue.className = "buy-btn pg-pick-embue";
        embue.id = "gem-picker-embue";
        embue.dataset.gem = sel;
        if (sLocked && sg) {
          embue.disabled = true;
          embue.textContent = `🔒 Needs Lv.${levelForGemTier(sg.tier)}`;
        } else if (sPoor) {
          embue.disabled = true;
          embue.textContent = `Need ✨${sCost} Dust`;
        } else {
          embue.innerHTML = `Embue <span class="pg-embue-cost">✨${sCost}</span>`;
          embue.addEventListener("click", () => {
            Audio.click();
            if (this.cb.socketGem && this.cb.socketGem(petId, slot, sel)) {
              Audio.fever();
              this._playSocketMagic();
              this.toast(`Embued ${gemLabel(sel)} (${gemBuffLabel(sel)})`);
              this._gemPicker = null;
              this._gemPickSel = null;
              this.buildPets();
            } else {
              this.toast("Not enough Dust");
            }
          });
        }
        actions.appendChild(embue);
        card.appendChild(actions);
      }

      const cap = document.createElement("div");
      cap.className = "pg-pick-cap";
      cap.innerHTML =
        (maxTier >= 0
          ? `Embue up to <b>${getGemTier(GEM_TIERS[maxTier].id).label}</b> at Lv.${lvl}.`
          : `No gem tiers unlocked yet.`) +
        ` You have ✨<b>${dust}</b> Dust.`;
      card.appendChild(cap);

      const cancel = document.createElement("button");
      cancel.className = "pg-pick-cancel";
      cancel.id = "gem-picker-cancel";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => {
        Audio.click();
        this._gemPicker = null;
        this._gemPickSel = null;
        this.buildPets();
      });
      card.appendChild(cancel);
      wrap.appendChild(card);
      return;
    }
    wrap.classList.remove("pg-picking");

    // Normal mode: a compact launcher card only. Crafting, fusing and browsing
    // the gem bag now live in their own dedicated destination (the Gem Forge
    // overlay) so they don't crowd the Pets screen — mirroring how mobile RPGs
    // keep the crafting bench separate from the contextual inventory/equip flow
    // (Genshin's synthesis bench, Diablo Immortal's jeweler). Socketing stays
    // contextual here (tap a pet's socket → the picker above).
    const owned = Object.keys(gems).filter((k) => gems[k] > 0);
    const gemTotal = owned.reduce((a, k) => a + gems[k], 0);
    const card = document.createElement("button");
    card.className = "gem-launch";
    card.id = "gem-launch";
    card.innerHTML =
      `<span class="gl-icon">💎</span>` +
      `<span class="gl-text">` +
      `<span class="gl-title">Gem Forge</span>` +
      `<span class="gl-sub">${gemTotal} gem${gemTotal === 1 ? "" : "s"} · ✨ ${dust} Dust · craft, fuse &amp; manage</span>` +
      `</span>` +
      `<span class="gl-go">›</span>`;
    card.addEventListener("click", () => {
      Audio.click();
      this.openGemForge();
    });
    wrap.appendChild(card);
  }

  // Open the dedicated Gem Forge destination (layers over the Pets overlay).
  openGemForge() {
    this._renderGemManager();
    if (this.el["gem-forge"]) this.el["gem-forge"].classList.remove("hidden");
  }

  closeGemForge() {
    if (this.el["gem-forge"]) this.el["gem-forge"].classList.add("hidden");
    // Refresh the launcher card on the Pets screen (gem count / dust changed).
    this._buildPetGems();
  }

  // Render the Bag / Forge manager into the dedicated Gem Forge body. The two
  // concerns are split into tabs so only one shows at a time.
  _renderGemManager() {
    const wrap = this.el["gemforge-body"];
    if (!wrap) return;
    const gems = Storage.getGems();
    const dust = Storage.getDust();
    if (this.el["gemforge-dust"]) this.el["gemforge-dust"].textContent = dust;
    wrap.innerHTML = "";

    const tab = this._gemTab === "forge" ? "forge" : "bag";
    const tabs = document.createElement("div");
    tabs.className = "pg-tabs";
    for (const [id, label] of [["bag", "🎒 Bag"], ["forge", "⚒️ Forge"]]) {
      const b = document.createElement("button");
      b.className = "pg-tab" + (tab === id ? " active" : "");
      b.dataset.tab = id;
      b.textContent = label;
      b.addEventListener("click", () => {
        Audio.click();
        this._gemTab = id;
        this._renderGemManager();
      });
      tabs.appendChild(b);
    }
    wrap.appendChild(tabs);

    if (tab === "forge") this._buildGemForge(wrap, gems, dust);
    else this._buildGemBag(wrap, gems);
  }

  // A distinct CSS gem visual for a (type, tier) so the three tiers are clearly
  // different at a glance — not just the same emoji with stars. The gem colour
  // comes from the type; the CUT, glow and size escalate with the tier
  // (chipped = small matte chip, polished = glossy gem, brilliant = faceted
  // sparkling diamond). Driven entirely by `data-tier` + `--gc` in styles.css.
  _gemVis(type, tierId) {
    const def = getGemDef(type);
    const col = def ? def.color : "#9aa";
    const tid = getGemTier(tierId).id;
    return (
      `<span class="gemv" data-tier="${tid}" style="--gc:${col}">` +
      `<span class="gemv-core"></span>` +
      `<span class="gemv-shine"></span>` +
      `</span>`
    );
  }

  // 🎒 Bag tab: market-standard inventory layout — a dense grid of small gem
  // icons (count badge + tier stars), with a single detail/action panel below
  // for the SELECTED gem (its buff + a clear fusion action). This replaces the
  // old wall of 18 big labelled cards, mirroring how gear/material bags work in
  // most mobile RPGs (Diablo Immortal, Raid, AFK Arena): pick an icon → act.
  _buildGemBag(wrap, gems) {
    const keys = Object.keys(gems).filter((k) => gems[k] > 0);
    if (!keys.length) {
      const empty = document.createElement("div");
      empty.className = "pg-empty";
      empty.textContent =
        "No gems yet — forge one in the ⚒️ Forge tab, or find them in crates & gifts.";
      wrap.appendChild(empty);
      this._gemSel = null;
      return;
    }
    // Strongest tier first, then group by type so the grid reads top-down.
    keys.sort((a, b) => {
      const ga = parseGemKey(a), gb = parseGemKey(b);
      const ta = ga ? gemTierIndex(ga.tier) : -1;
      const tb = gb ? gemTierIndex(gb.tier) : -1;
      if (tb !== ta) return tb - ta;
      return (ga ? ga.type : "").localeCompare(gb ? gb.type : "");
    });
    // Keep selection valid across rebuilds; default to the strongest gem.
    if (!this._gemSel || !gems[this._gemSel]) this._gemSel = keys[0];
    const sel = this._gemSel;

    const grid = document.createElement("div");
    grid.className = "pg-grid2";
    for (const key of keys) {
      const g = parseGemKey(key);
      const tierIdx = g ? gemTierIndex(g.tier) : 0;
      const cell = document.createElement("button");
      cell.className = "pg-cell" + (key === sel ? " sel" : "");
      cell.dataset.gem = key;
      if (g) cell.style.borderColor = g.def.color;
      cell.title = `${gemLabel(key)} — ${gemBuffLabel(key)}`;
      cell.innerHTML =
        `<span class="pg-cell-count">${gems[key]}</span>` +
        `<span class="pg-cell-icon">${g ? this._gemVis(g.type, g.tier) : gemIcon(key)}</span>` +
        `<span class="pg-cell-stars">${"★".repeat(tierIdx + 1)}</span>`;
      cell.addEventListener("click", () => {
        Audio.click();
        this._gemSel = key;
        this._renderGemManager();
      });
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);

    // Detail / action panel for the selected gem.
    const g = parseGemKey(sel);
    const tierIdx = g ? gemTierIndex(g.tier) : 0;
    const panel = document.createElement("div");
    panel.className = "pg-sel";
    panel.innerHTML =
      `<div class="pg-sel-head">` +
      `<span class="pg-sel-icon"${g ? ` style="text-shadow:0 0 12px ${g.def.color}"` : ""}>${g ? this._gemVis(g.type, g.tier) : gemIcon(sel)}</span>` +
      `<div class="pg-sel-info">` +
      `<div class="pg-sel-name">${gemLabel(sel)} <span class="pg-sel-stars">${"★".repeat(tierIdx + 1)}</span></div>` +
      `<div class="pg-sel-buff">${gemBuffLabel(sel)}</div>` +
      `<div class="pg-sel-hint">Tap an empty socket on a pet below to embue ↓</div>` +
      `</div>` +
      `<span class="pg-sel-count">×${gems[sel]}</span>` +
      `</div>`;

    const fuseRow = document.createElement("div");
    fuseRow.className = "pg-fuse-row";
    const up = g && canFuseTier(g.tier) ? fusedGemKey(sel) : null;
    if (up) {
      const upG = parseGemKey(up);
      const can = gems[sel] >= FUSE_COUNT;
      const fb = document.createElement("button");
      fb.className = "pg-fuse-btn";
      fb.dataset.gem = sel;
      fb.disabled = !can;
      fb.innerHTML =
        `<span class="pg-fuse-main">⬆ Fuse ${FUSE_COUNT}</span>` +
        `<span class="pg-fuse-sub">${FUSE_COUNT}× ${getGemTier(g.tier).label} → 1 ${getGemTier(upG.tier).label}</span>`;
      fb.title = can
        ? `Fuse ${FUSE_COUNT}× ${gemLabel(sel)} → 1 ${gemLabel(up)}`
        : `Need ${FUSE_COUNT}× ${gemLabel(sel)} to fuse (have ${gems[sel]})`;
      fb.addEventListener("click", (e) => {
        e.stopPropagation();
        Audio.click();
        if (!this.cb.fuseGem) return;
        const res = this.cb.fuseGem(sel);
        if (res && res.ok) {
          Audio.fever();
          this.toast(`Fused ${FUSE_COUNT}× ${gemLabel(res.from)} → ${gemLabel(res.to)}!`);
          this._gemSel = res.to; // follow the upgraded gem
          this._renderGemManager();
        } else {
          this.toast(`Need ${FUSE_COUNT} to fuse`);
        }
      });
      fuseRow.appendChild(fb);
      if (!can) {
        const note = document.createElement("span");
        note.className = "pg-fuse-note";
        note.textContent = `Collect ${FUSE_COUNT - gems[sel]} more to fuse`;
        fuseRow.appendChild(note);
      }
    } else {
      const top = document.createElement("span");
      top.className = "pg-fuse-top";
      top.textContent = "✦ Top tier — already the strongest";
      fuseRow.appendChild(top);
    }
    panel.appendChild(fuseRow);
    wrap.appendChild(panel);
  }

  // ⚒️ Forge tab: pick ONE gem type from a compact icon row, then see just that
  // gem's description and its three tier craft buttons — 3 buttons at a time
  // instead of the old wall of 18.
  _buildGemForge(wrap, gems, dust) {
    const sel =
      this._gemForgeType && getGemDef(this._gemForgeType)
        ? this._gemForgeType
        : GEM_CATALOG[0].type;
    this._gemForgeType = sel;

    const types = document.createElement("div");
    types.className = "pg-forge-types";
    for (const def of GEM_CATALOG) {
      const b = document.createElement("button");
      b.className = "pg-forge-type" + (def.type === sel ? " active" : "");
      b.dataset.gem = def.type;
      b.style.borderColor = def.color;
      b.innerHTML = `<span class="pg-ft-icon">${def.icon}</span>`;
      b.title = def.name;
      b.addEventListener("click", () => {
        Audio.click();
        this._gemForgeType = def.type;
        this._renderGemManager();
      });
      types.appendChild(b);
    }
    wrap.appendChild(types);

    const def = getGemDef(sel);
    const card = document.createElement("div");
    card.className = "pg-forge-card";
    card.innerHTML =
      `<div class="pg-cc-head"><span class="pg-cc-icon">${this._gemVis(sel, "brilliant")}</span><span class="pg-cc-name">${def.name}</span></div>` +
      `<div class="pg-cc-desc">${def.desc}</div>` +
      `<div class="pg-forge-hint">Tap a tier to make one. Higher tiers <b>fuse ${FUSE_COUNT} of the tier below</b> when you have them — otherwise they spend ✨ Dust. Tap again to make more.</div>`;
    // Tier ladder: chipped → polished → brilliant, left to right with arrows so
    // the upgrade path reads at a glance. Each node is a one-tap forge button
    // that prefers to FUSE the tier below (free) before spending dust.
    const ladder = document.createElement("div");
    ladder.className = "pg-cc-ladder";
    GEM_TIERS.forEach((t, i) => {
      if (i > 0) {
        const arrow = document.createElement("span");
        arrow.className = "pg-ladder-arrow";
        arrow.setAttribute("aria-hidden", "true");
        arrow.textContent = "→";
        ladder.appendChild(arrow);
      }
      const cost = gemDustCost(t.id);
      const have = gems[gemKey(sel, t.id)] || 0;
      // Smart source: fuse FUSE_COUNT of the tier below if owned, else dust.
      const below = prevGemTier(t.id);
      const belowHave = below ? (gems[gemKey(sel, below)] || 0) : 0;
      const canFuse = !!below && belowHave >= FUSE_COUNT;
      const canDust = dust >= cost;
      const b = document.createElement("button");
      b.className = "pg-craft-btn" + (canFuse ? " can-fuse" : "");
      b.dataset.gem = sel;
      b.dataset.tier = t.id;
      b.style.setProperty("--gem-col", def.color);
      const costLabel = canFuse
        ? `<span class="pg-cb-cost pg-cb-fuse">⬆ ${FUSE_COUNT} ${getGemTier(below).label}</span>`
        : `<span class="pg-cb-cost">✨${cost}</span>`;
      b.innerHTML =
        `<span class="pg-cb-icon">${this._gemVis(sel, t.id)}</span>` +
        `<span class="pg-cb-stars">${"★".repeat(i + 1)}</span>` +
        `<span class="pg-cb-tier">${t.label}</span>` +
        costLabel +
        `<span class="pg-cb-have">have ${have}</span>`;
      b.disabled = !canFuse && !canDust;
      b.title = canFuse
        ? `Fuse ${FUSE_COUNT}× ${getGemTier(below).label} ${def.name} → one ${t.label} ${def.name} (free)`
        : canDust
          ? `Forge one ${t.label} ${def.name} for ✨${cost} Dust`
          : `Need ✨${cost} Dust (or ${FUSE_COUNT}× ${below ? getGemTier(below).label + " " : ""}${def.name}) to forge a ${t.label}`;
      b.addEventListener("click", () => {
        Audio.click();
        if (!this.cb.forgeTier) return;
        const res = this.cb.forgeTier(sel, t.id);
        if (res && res.ok) {
          Audio.fever();
          const made = gemLabel(gemKey(sel, t.id));
          this.toast(
            res.via === "fuse"
              ? `Fused ${FUSE_COUNT}× ${getGemTier(below).label} → ${made}!`
              : `Forged ${made}!`
          );
          this._renderGemManager();
        } else {
          this.toast("Not enough Dust");
        }
      });
      ladder.appendChild(b);
    });
    card.appendChild(ladder);
    wrap.appendChild(card);
  }

  _buildCosmetics(pet, state) {
    const wrap = document.createElement("div");
    wrap.className = "pd-cosmetics";
    const owned = Array.isArray(state.cosmetics) ? state.cosmetics : ["default"];
    const selected = state.cosmetic || "default";
    const title = document.createElement("div");
    title.className = "pd-cos-title";
    title.textContent = "Looks";
    wrap.appendChild(title);
    const row = document.createElement("div");
    row.className = "pd-cos-row";
    COSMETICS.forEach((cos) => {
      const has = owned.includes(cos.id);
      const chip = document.createElement("button");
      chip.className = "cos-chip";
      chip.dataset.cos = cos.id;
      if (selected === cos.id) chip.classList.add("selected");
      chip.innerHTML =
        `<span class="cos-swatch" style="filter:hue-rotate(${cos.hue}deg)">${pet.icon}</span>` +
        `<span class="cos-name">${cos.name}</span>` +
        (has
          ? ""
          : `<span class="cos-price"><span class="coin-dot"></span>${cos.price}</span>`);
      chip.addEventListener("click", () => {
        Audio.click();
        if (has) {
          Storage.setCosmetic(pet.id, cos.id);
          this.buildPets();
        } else if (this.cb.buyCosmetic && this.cb.buyCosmetic(pet.id, cos)) {
          Audio.coin();
          this.toast(`${cos.name} unlocked!`);
          this.refreshCoins();
          this.buildPets();
        } else {
          this.toast("Not enough coins");
        }
      });
      row.appendChild(chip);
    });
    wrap.appendChild(row);
    return wrap;
  }

  // Small in-game HUD indicator of the active pet companion + its buff.
  updatePetHud(pet) {
    const el = this.el["hud-pet"];
    if (!el) return;
    if (!pet || !this._petFeatureUnlocked("pets")) {
      el.classList.add("hidden");
      return;
    }
    const def = getPet(pet.id);
    if (!def) {
      el.classList.add("hidden");
      return;
    }
    const lvl = levelForXp(pet.xp || 0);
    const cos = getCosmetic(pet.cosmetic);
    const icon = this.el["hud-pet-icon"];
    const buff = this.el["hud-pet-buff"];
    if (icon) {
      icon.textContent = def.icon;
      icon.style.filter = `hue-rotate(${cos.hue}deg)`;
    }
    if (buff) {
      const label = def.active ? def.active.label : def.ability.label;
      buff.textContent = `Lv.${lvl}`;
      el.title = label;
    }
    el.classList.remove("hidden");
  }

  // ---- HUD --------------------------------------------------------------
  showHud(show) {
    this.el["hud"].classList.toggle("hidden", !show);
  }

  updateHud(s) {
    if (s.modeLabel !== undefined) this.el["hud-mode-label"].textContent = s.modeLabel;
    if (s.score !== undefined) this.el["hud-score"].textContent = s.score;
    if (s.movesLabel !== undefined) this.el["hud-moves-label"].textContent = s.movesLabel;
    if (s.moves !== undefined) this.el["hud-moves"].textContent = s.moves;
    if (s.showTarget !== undefined)
      this.el["hud-target-wrap"].style.visibility = s.showTarget ? "visible" : "hidden";
    if (s.targetLabel !== undefined && this.el["hud-target-label"])
      this.el["hud-target-label"].textContent = s.targetLabel;
    if (s.target !== undefined) this.el["hud-target"].textContent = s.target;
    if (s.progress !== undefined)
      this.el["hud-progress-fill"].style.width = `${Math.min(100, s.progress * 100)}%`;
    if (s.status !== undefined) this.updateHudStatus(s.status);
    this.refreshCoins();
  }

  updateHudStatus(items) {
    const wrap = this.el["hud-status"];
    if (!wrap) return;
    const chips = (items || []).filter((it) => it && it.text);
    wrap.classList.toggle("hidden", chips.length === 0);
    wrap.innerHTML = chips
      .map((it) => `<span class="hud-status-chip ${it.kind || ""}">${it.icon ? `<b>${it.icon}</b>` : ""}${it.text}</span>`)
      .join("");
  }

  // Show/hide the bonus-objective chip in the HUD. `obj` is the level objective
  // ({ label, bonus, ... }) or null to hide it; `met` toggles the achieved look.
  updateObjective(obj, met) {
    const chip = this.el["hud-objective"];
    if (!chip) return;
    if (!obj) {
      chip.classList.add("hidden");
      return;
    }
    chip.classList.remove("hidden");
    chip.classList.toggle("met", !!met);
    const txt = this.el["hud-objective-text"];
    if (txt) txt.textContent = met ? `${obj.label} ✓` : obj.label;
  }

  updatePowerups() {
    const loadout = Storage.getLoadout();
    const tutorial = this.cb.isTutorial && this.cb.isTutorial();
    (this._slots || []).forEach((btn, i) => {
      const type = loadout[i];
      const unlocked = type && (tutorial || isPowerupUnlocked(type) || type === this._rescueTool);
      const info = unlocked ? POWERUP_INFO[type] : null;
      const owned = type ? Economy.getPowerup(type) : 0;
      btn.dataset.pu = unlocked ? type : "";
      btn.dataset.stock = unlocked ? String(owned) : "";
      btn.classList.toggle("empty", !unlocked);
      btn.classList.toggle("no-stock", !!unlocked && owned <= 0);
      btn.classList.toggle("has-stock", !!unlocked && owned > 0);
      const icon = btn.querySelector(".pu-icon");
      const count = btn.querySelector(".pu-count");
      if (icon) icon.textContent = info ? info.icon : "＋";
      if (count) count.textContent = unlocked ? owned : "";
      btn.setAttribute("aria-label", info ? `${info.name} (hold to change)` : "Empty slot");
    });
  }

  showRescueTool(type) {
    this._rescueTool = type;
    this.updatePowerups();
  }

  clearRescueTool() {
    if (!this._rescueTool) return;
    this._rescueTool = null;
    this.updatePowerups();
  }

  // ---- Loadout picker ---------------------------------------------------
  // Long-pressing a HUD slot opens the tools unlocked so far so the player can
  // choose which one occupies that quick-access slot.
  openLoadoutPicker(slot) {
    this._loadoutSlot = slot;
    const loadout = Storage.getLoadout();
    const list = this.el["loadout-list"];
    if (!list) return;
    const available = this.cb.isTutorial && this.cb.isTutorial()
      ? Object.keys(POWERUP_INFO)
      : unlockedPowerups();
    if (this.el["loadout-sub"])
      this.el["loadout-sub"].textContent = available.length
        ? `Choose the power-up for slot ${slot + 1}.`
        : "Tools unlock after Level 5.";
    list.innerHTML = "";
    if (!available.length) {
      const next = nextPowerupUnlock();
      const empty = document.createElement("div");
      empty.className = "loadout-empty";
      empty.textContent = next
        ? `${POWERUP_INFO[next.type].icon} ${POWERUP_INFO[next.type].name} unlocks at Level ${next.level}.`
        : "No tools are available yet.";
      list.appendChild(empty);
    }
    available.forEach((type) => {
      const info = POWERUP_INFO[type];
      const where = loadout.indexOf(type);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "loadout-item" + (loadout[slot] === type ? " active" : "");
      row.dataset.pu = type;
      const tag =
        where !== -1 && where !== slot
          ? `<span class="li-slot">Slot ${where + 1}</span>`
          : loadout[slot] === type
          ? `<span class="li-slot li-current">Equipped</span>`
          : "";
      row.innerHTML =
        `<span class="li-icon">${info.icon}</span>` +
        `<span class="li-text"><span class="li-name">${info.name}</span>` +
        `<span class="li-desc">${info.desc}</span></span>` +
        `<span class="li-own">×${Economy.getPowerup(type)}</span>${tag}`;
      row.addEventListener("click", () => {
        Audio.click();
        this.assignLoadout(slot, type);
        this.closeLoadoutPicker();
      });
      list.appendChild(row);
    });
    if (available.length && this.cb.suggestLoadout) {
      const suggest = document.createElement("button");
      suggest.type = "button";
      suggest.className = "loadout-suggest";
      suggest.innerHTML = `<span>✨</span><b>Suggest loadout</b><small>Match tools to this level</small>`;
      suggest.addEventListener("click", () => {
        Audio.click();
        const ok = this.cb.suggestLoadout && this.cb.suggestLoadout();
        this.updatePowerups();
        this.toast(ok ? "Suggested tools equipped" : "No better suggestion yet");
        this.closeLoadoutPicker();
      });
      list.appendChild(suggest);
    }
    this.el["loadout"].classList.remove("hidden");
  }

  assignLoadout(slot, type) {
    if (type && !isPowerupUnlocked(type)) {
      const info = POWERUP_INFO[type];
      this.toast(`${info ? info.name : "Tool"} unlocks at Level ${powerupUnlockLevel(type)}`);
      return false;
    }
    const ok = Storage.setLoadoutSlot(slot, type);
    if (ok) this.updatePowerups();
    return ok;
  }

  closeLoadoutPicker() {
    if (this.el["loadout"]) this.el["loadout"].classList.add("hidden");
  }

  // ---- Magnet strength gauge -------------------------------------------
  // A circular dial shown over the board while a magnet is being aimed; the
  // needle sweeps a 270° arc, the player taps to lock it, and proximity to the
  // green sweet spot decides the pull strength. The sweet spot is randomised
  // per use, so the green band is rotated to wherever `sweet` (0..1) lands.
  showMagnetGauge(sweet = 0.5) {
    const g = this.el["magnet-gauge"];
    if (!g) return;
    g.classList.remove("hidden");
    const ring = g.querySelector(".mg-ring");
    if (ring) {
      // value 0.5 maps to the top of the dial; rotate the ring so its green
      // band lines up with the needle angle at `sweet`.
      const deg = (sweet - 0.5) * 270;
      ring.style.transform = `rotate(${deg}deg)`;
    }
  }

  updateMagnetGauge(value) {
    const n = this.el["mg-needle"];
    if (!n) return;
    const v = Math.min(1, Math.max(0, value));
    // value 0 → -135° (left/red), 0.5 → 0° (top/green), 1 → +135° (right/red).
    const deg = (v - 0.5) * 270;
    n.style.transform = `translate(-50%, -100%) rotate(${deg}deg)`;
  }

  hideMagnetGauge() {
    if (this.el["magnet-gauge"]) this.el["magnet-gauge"].classList.add("hidden");
  }

  // Charge meter (0..1). `ready` highlights the bar when a blast is available.
  updatePower(frac, ready) {
    if (this.el["power-fill"])
      this.el["power-fill"].style.width = `${Math.min(100, frac * 100)}%`;
    if (this.el["power-meter"])
      this.el["power-meter"].classList.toggle("ready", !!ready);
    if (this.el["power-label"])
      this.el["power-label"].textContent = ready ? "DOUBLE-TAP" : "CHARGE";
  }

  // Fever meter (0..1). `active` is true while Fever (double points) is running
  // — the bar glows hot and the label switches to "×2 FEVER".
  updateFever(frac, active) {
    if (this.el["fever-fill"])
      this.el["fever-fill"].style.width = `${Math.min(100, Math.max(0, frac) * 100)}%`;
    if (this.el["fever-meter"])
      this.el["fever-meter"].classList.toggle("fever-active", !!active);
    if (this.el["fever-label"])
      this.el["fever-label"].textContent = active ? "×2 FEVER" : "FEVER";
  }

  clearArmedPowerups() {
    document.querySelectorAll(".powerup-btn").forEach((b) => b.classList.remove("armed"));
  }

  showCombo(text, cls) {
    const b = this.el["combo-banner"];
    b.textContent = text;
    // Reset to the base banner, then apply this tier's escalating intensity
    // class (ct-1..ct-5) so higher combos read bigger/hotter.
    b.className = "combo-banner";
    if (cls) b.classList.add(cls);
    void b.offsetWidth; // reflow to restart animation
    b.classList.add("show");
  }

  // ---- Modals -----------------------------------------------------------
  hideModals() {
    this.el["win"].classList.add("hidden");
    this.el["lose"].classList.add("hidden");
    if (this.el["pause"]) this.el["pause"].classList.add("hidden");
    if (this.el["isolated"]) this.el["isolated"].classList.add("hidden");
    if (this.el["loadout"]) this.el["loadout"].classList.add("hidden");
    if (this.el["tool-unlock"]) this.el["tool-unlock"].classList.add("hidden");
    if (this.el["chest"]) this.el["chest"].classList.add("hidden");
    if (this.el["pet-confirm"]) this.el["pet-confirm"].classList.add("hidden");
    if (this.el["pet-reveal"]) this.el["pet-reveal"].classList.add("hidden");
  }

  showWin({ stars, score, coins = 0, rewardText, stats, showNext, showDouble, rewardChoices = [] }) {
    const starEls = this.el["win-stars"].querySelectorAll(".star");
    starEls.forEach((el, i) => el.classList.toggle("on", i < stars));

    // Render the per-run recap stats grid.
    const grid = this.el["win-stats"];
    if (grid) {
      grid.innerHTML = "";
      (stats || []).forEach(({ label, value }) => {
        const cell = document.createElement("div");
        cell.className = "win-stat";
        cell.innerHTML =
          `<span class="win-stat-val">${value}</span>` +
          `<span class="win-stat-lbl">${label}</span>`;
        grid.appendChild(cell);
      });
    }

    this.el["win-reward"].textContent = rewardText || "";
    this.el["win-next"].style.display = showNext ? "" : "none";
    // The coins, reward line and "double coins" offer stay sealed inside the
    // chest until the player taps it open. Remember whether the double-coins
    // offer should appear after opening.
    this._winShowDouble = !!showDouble;
    this._winCoinsPending = coins;
    this._winChestOpened = false;
    this._winRewardChoices = rewardChoices || [];
    this._winChoiceClaimed = false;
    this.el["win-double"].style.display = "none";
    if (this.el["win-coins-num"]) this.el["win-coins-num"].textContent = "0";
    const reveal = this.el["win-reward-reveal"];
    if (reveal) reveal.classList.add("is-sealed"), reveal.classList.remove("revealed");
    const chest = this.el["win-chest"];
    const art = this.el["win-chest-art"];
    if (chest) chest.classList.remove("opened");
    if (this.el["win-chest-hint"]) this.el["win-chest-hint"].style.display = "";
    if (art) {
      art.classList.remove("open");
      // Restart the shake animation cleanly each time the screen shows.
      art.classList.remove("shaking");
      void art.offsetWidth;
      art.classList.add("shaking");
    }
    if (this.el["win-chest-burst"]) this.el["win-chest-burst"].innerHTML = "";
    this._renderWinChoices(false);

    this.showHud(false);
    this.el["win"].classList.remove("hidden");

    // Count the score up from zero immediately (the score is the achievement);
    // the coin payout is revealed only once the chest is opened.
    this._animateNumber(this.el["win-score"], score, 700);
  }

  showToolUnlock(unlock) {
    const info = unlock.feature ? PET_FEATURE_INFO[unlock.feature] : POWERUP_INFO[unlock.type];
    if (!info || !this.el["tool-unlock"]) return;
    this.hideModals();
    this.showHud(false);
    this.el["tool-unlock-icon"].textContent = info.icon;
    this.el["tool-unlock-name"].textContent = info.name;
    this.el["tool-unlock-level"].textContent = `Unlocked at Level ${unlock.level}`;
    this.el["tool-unlock-desc"].textContent = info.desc;
    this.el["tool-unlock-lesson"].textContent = unlock.lesson || info.lesson;
    this.el["tool-unlock"].classList.remove("hidden");
  }

  // Burst the reward chest open: stop the shake, flip the lid, fling a shower
  // of coins, then reveal + count up the coin payout. Idempotent per win.
  openWinChest() {
    if (this._winChestOpened) return;
    this._winChestOpened = true;
    Audio.coin();
    const art = this.el["win-chest-art"];
    if (art) {
      art.classList.remove("shaking");
      art.classList.add("open");
    }
    if (this.el["win-chest"]) this.el["win-chest"].classList.add("opened");
    this._spawnChestBurst();
    const reveal = this.el["win-reward-reveal"];
    if (reveal) {
      reveal.classList.remove("is-sealed");
      void reveal.offsetWidth;
      reveal.classList.add("revealed");
    }
    if (this._winShowDouble) this.el["win-double"].style.display = "";
    // Let the lid pop before the coins start tallying.
    setTimeout(() => this._animateCoins(this._winCoinsPending || 0), 180);
    this._renderWinChoices(true);
  }

  _renderWinChoices(visible) {
    const box = this.el["win-choice"];
    const list = this.el["win-choice-list"];
    if (!box || !list) return;
    const choices = this._winRewardChoices || [];
    box.classList.toggle("hidden", !visible || !choices.length || this._winChoiceClaimed);
    list.innerHTML = "";
    if (!visible || !choices.length || this._winChoiceClaimed) return;
    choices.forEach((choice) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "win-choice-btn";
      btn.dataset.choice = choice.id;
      btn.innerHTML = `<span class="wcb-icon">${choice.icon}</span><span><b>${choice.title}</b><small>${choice.desc}</small></span>`;
      list.appendChild(btn);
    });
  }

  claimWinChoice(id) {
    if (!id || this._winChoiceClaimed) return false;
    const choice = (this._winRewardChoices || []).find((c) => c.id === id);
    if (!choice) return false;
    const ok = this.cb.claimWinChoice && this.cb.claimWinChoice(id);
    if (!ok) return false;
    this._winChoiceClaimed = true;
    this._renderWinChoices(false);
    this.toast(`${choice.icon} ${choice.title} claimed`);
    return true;
  }

  // Fling a handful of coin/sparkle glyphs out of the chest along random arcs.
  _spawnChestBurst() {
    const host = this.el["win-chest-burst"];
    if (!host) return;
    host.innerHTML = "";
    if (this._motionOff()) return;
    const glyphs = ["🪙", "🪙", "🪙", "✨", "⭐"];
    const n = 12;
    for (let i = 0; i < n; i++) {
      const s = document.createElement("span");
      s.textContent = glyphs[i % glyphs.length];
      const ang = (-Math.PI / 2) + (Math.random() - 0.5) * Math.PI * 1.1;
      const dist = 38 + Math.random() * 46;
      s.style.setProperty("--tx", `${Math.cos(ang) * dist}px`);
      s.style.setProperty("--ty", `${Math.sin(ang) * dist}px`);
      s.style.setProperty("--r", `${(Math.random() - 0.5) * 360}deg`);
      s.style.animationDelay = `${Math.random() * 0.12}s`;
      host.appendChild(s);
    }
    // Clean up the burst nodes once they've finished animating.
    setTimeout(() => {
      if (host) host.innerHTML = "";
    }, 1100);
  }

  // Re-run the coin counter (e.g. after a "double coins" reward).
  bumpWinCoins(total) {
    this._animateCoins(total);
  }

  _animateCoins(to) {
    const el = this.el["win-coins-num"];
    const wrap = this.el["win-coins"];
    if (!el) return;
    if (wrap) {
      wrap.classList.remove("pulse");
      void wrap.offsetWidth;
      wrap.classList.add("pulse");
    }
    this._animateNumber(el, to, 900);
  }

  // Tween an element's text content from its current value to `to`.
  _animateNumber(el, to, dur = 700) {
    if (!el) return;
    if (el._raf) cancelAnimationFrame(el._raf);
    const from = 0;
    const target = Math.round(to);
    if (dur <= 0) {
      el.textContent = target;
      return;
    }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      el.textContent = Math.round(from + (target - from) * eased);
      if (t < 1) el._raf = requestAnimationFrame(tick);
      else {
        el.textContent = target;
        el._raf = null;
      }
    };
    el._raf = requestAnimationFrame(tick);
  }

  setWinTitle(text) {
    document.querySelector("#win .modal-title").textContent = text;
  }

  showLose({ score, showRevive, title, tip, tools }) {
    if (title) document.querySelector("#lose .modal-title").textContent = title;
    this.el["lose-score"].textContent = score;
    this.el["lose-revive"].style.display = showRevive ? "" : "none";
    const tipBox = this.el["lose-tip"];
    if (tipBox) {
      const toolLine = tools && tools.length ? `<span class="lose-tip-tools">Try: ${tools.join(" • ")}</span>` : "";
      tipBox.classList.toggle("hidden", !tip && !toolLine);
      tipBox.innerHTML = tip || toolLine ? `<b>Next attempt</b><span>${tip || ""}</span>${toolLine}` : "";
    }
    this.showHud(false);
    this.el["lose"].classList.remove("hidden");
  }

  // Lone-bubble rescue prompt: explains the Pick tool when the board jams on
  // single bubbles. The action button adapts to whether the player owns a
  // Pick, can buy one, or has neither (informational only).
  showIsolatedHelp({ pickCount = 0, canBuy = false, pickPrice = 0 } = {}) {
    const msg = this.el["iso-msg"];
    const pick = this.el["iso-pick"];
    const give = this.el["iso-giveup"];
    if (pickCount > 0) {
      if (msg)
        msg.innerHTML =
          "These single bubbles can't be popped on their own. Don't panic — " +
          `use your <b>Pick \uD83D\uDD28</b> to remove them one by one! ` +
          `<span class="iso-have">You have ${pickCount}.</span>`;
      if (pick) {
        pick.style.display = "";
        pick.textContent = `Use Pick \uD83D\uDD28 (${pickCount})`;
      }
      if (give) give.textContent = "Give Up";
    } else if (canBuy) {
      if (msg)
        msg.innerHTML =
          "These single bubbles can't be popped on their own. Don't panic — " +
          "the <b>Pick \uD83D\uDD28</b> tool removes them. Grab one now!";
      if (pick) {
        pick.style.display = "";
        pick.textContent = `Buy Pick \uD83D\uDD28 (${pickPrice})`;
      }
      if (give) give.textContent = "Give Up";
    } else {
      if (msg)
        msg.innerHTML =
          "These single bubbles can't be popped on their own. The " +
          "<b>Pick \uD83D\uDD28</b> tool removes them — grab one from the Shop " +
          "next time!";
      if (pick) pick.style.display = "none";
      if (give) give.textContent = "End Level";
    }
    this.showHud(false);
    this.el["isolated"].classList.remove("hidden");
  }

  hideIsolatedHelp() {
    if (this.el["isolated"]) this.el["isolated"].classList.add("hidden");
  }

  // ---- Falling events (gift / problem) ----------------------------------
  // Drop a tappable token from the top of the screen. `cb.onTap` fires when the
  // player taps it in time; `cb.onMiss` fires if it falls off-screen untouched.
  // Outcomes are guarded so only one of them ever runs per token.
  spawnFallingEvent({ type, leftPct = 50, fallTime = 3.8 } = {}, cb = {}) {
    const layer = this.el["events-layer"];
    if (!layer) return null;
    const isProblem = type === "problem";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "falling-event";
    btn.className = `falling-event ${isProblem ? "problem" : "gift"}`;
    btn.textContent = isProblem ? "⚠️" : "🎁";
    btn.setAttribute(
      "aria-label",
      isProblem ? "Problem — tap to defuse" : "Gift — tap to collect",
    );
    btn.style.left = `${leftPct}%`;
    btn.style.setProperty("--fe-fall", `${fallTime}s`);

    let done = false;
    const finish = (handler) => {
      if (done) return;
      done = true;
      btn.remove();
      if (handler) handler();
    };
    btn.addEventListener("click", () => {
      Audio.click();
      finish(cb.onTap);
    });
    btn.addEventListener("animationend", (e) => {
      if (e.animationName === "fe-fall") finish(cb.onMiss);
    });

    layer.appendChild(btn);
    return btn;
  }

  // Remove any in-flight token without firing its callbacks (used when a
  // session ends or the player quits to the menu).
  clearFallingEvents() {
    const layer = this.el["events-layer"];
    if (layer) {
      layer.innerHTML = "";
      // Drop any lingering pause state so the next session's tokens are visible.
      layer.classList.remove("paused");
    }
  }

  // Freeze any in-flight token's fall (and hide the layer) while the player is
  // away from the playing window — e.g. browsing the shop or the pet manager.
  // The CSS animation is paused, so it never fires its miss handler; resuming
  // continues the fall from exactly where it left off.
  pauseFallingEvents() {
    const layer = this.el["events-layer"];
    if (layer) layer.classList.add("paused");
  }

  resumeFallingEvents() {
    const layer = this.el["events-layer"];
    if (layer) layer.classList.remove("paused");
  }

  // ---- Toast ------------------------------------------------------------
  toast(msg, ms = 1600) {
    const t = this.el["toast"];
    t.textContent = msg;
    t.classList.remove("hidden");
    void t.offsetWidth;
    t.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.classList.add("hidden"), 250);
    }, ms);
  }

  // ---- Tutorial coach ---------------------------------------------------
  // Render one tutorial step. Action steps hide the "Next" button so the only
  // way forward is to perform the move (the tutorial advances on observation);
  // informational steps show the button with the step's call-to-action label.
  showTutorialStep({ index, total, step }) {
    if (!this.el["tutorial"]) return;
    this.el["coach-title"].textContent = step.title;
    this.el["coach-body"].textContent = step.body;

    const isButton = step.advance === "button";
    const hint = this.el["coach-hint"];
    if (hint) {
      hint.textContent = isButton ? "" : step.hint || "";
      hint.classList.toggle("hidden", isButton || !step.hint);
    }
    const next = this.el["coach-next"];
    if (next) {
      next.textContent = step.cta || "Next";
      next.classList.toggle("hidden", !isButton);
    }

    // Progress dots.
    const prog = this.el["coach-progress"];
    if (prog) {
      prog.innerHTML = "";
      for (let i = 0; i < total; i++) {
        const dot = document.createElement("span");
        dot.className =
          "dot" + (i < index ? " done" : i === index ? " current" : "");
        prog.appendChild(dot);
      }
    }

    this.el["tutorial"].classList.remove("hidden");
  }

  hideTutorial() {
    if (this.el["tutorial"]) this.el["tutorial"].classList.add("hidden");
  }
}

export const UI = new UIManager();
