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
import { Economy, POWERUP_INFO, COIN_PACKS, STARTER_PACK } from "./economy.js";
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
import { todayKey } from "./rng.js";
import {
  PET_CATALOG,
  COSMETICS,
  getPet,
  getCosmetic,
  petBuffs,
  petActive,
  levelForXp,
  levelProgress,
  MAX_PET_LEVEL,
  CRATE_COST,
  LEGENDARY_CRATE,
  premiumPets,
} from "./pets.js";

const $ = (id) => document.getElementById(id);

class UIManager {
  constructor() {
    this.cb = {};
    this.el = {};
    // Optional override (ms) for the hold-to-buy repeat rate. When null, the
    // rate comes from the persisted `buyRepeatMs` setting (default 500ms = 2/s).
    this.buyHoldInterval = null;
  }

  init() {
    const ids = [
      "menu", "levelmap", "shop", "themes", "hud", "win", "lose",
      "menu-coins", "lm-coins", "shop-coins", "themes-coins", "hud-coins",
      "level-grid", "shop-list", "theme-list",
      "achievements", "achv-list", "achv-count", "btn-achievements", "achv-back",
      "achv-badge", "achv-collect-all",
      "calendar", "cal-grid", "cal-status", "cal-claim", "cal-back",
      "btn-calendar", "cal-badge",
      "season", "season-track", "season-coins", "season-back", "season-buy",
      "season-xp-label", "season-xp-fill", "btn-season", "season-badge",
      "chest", "chest-icon", "chest-title", "chest-sub", "chest-rewards", "chest-ok",
      "cb-toggle", "cb-toggle-state",
      "hints-toggle", "hints-toggle-state",
      "pets", "pets-coins", "pets-crate", "pet-store", "pet-list", "pet-detail",
      "pet-confirm", "pet-confirm-sub", "pet-confirm-ok", "pet-confirm-cancel",
      "pet-reveal", "pet-reveal-confetti", "pet-reveal-congrats", "pet-reveal-glow",
      "pet-reveal-icon", "pet-reveal-name", "pet-reveal-rarity", "pet-reveal-ability",
      "pet-reveal-desc", "pet-reveal-close", "pet-reveal-equip",
      "btn-pets", "pets-back", "hud-pet", "hud-pet-icon", "hud-pet-buff",
      "btn-continue", "daily-summary",
      "hud-mode-label", "hud-score", "hud-target", "hud-target-wrap", "hud-target-label",
      "hud-moves", "hud-moves-label", "hud-progress-fill",
      "hud-objective", "hud-objective-text",
      "btn-undo", "hud-undo-count",
      "power-meter", "power-fill", "power-label",
      "fever-meter", "fever-fill", "fever-label",
      "powerups", "pu-slot-0", "pu-slot-1", "pu-slot-2",
      "loadout", "loadout-list", "loadout-sub", "loadout-close",
      "magnet-gauge", "mg-needle",
      "events-layer",
      "combo-banner", "toast",      "win-stars", "win-score", "win-reward", "win-double", "win-next", "win-menu",
      "win-stats", "win-coins", "win-coins-num",
      "win-chest", "win-chest-art", "win-chest-burst", "win-chest-hint", "win-reward-reveal",
      "lose-score", "lose-revive", "lose-retry", "lose-menu",
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
    click("btn-season", () => this.showScreen("season"));
    click("btn-pets", () => this.openPetOverlay());
    click("btn-tutorial", () => this.cb.startTutorial && this.cb.startTutorial());

    // Back buttons
    click("lm-back", () => this.showScreen("menu"));
    // Shop can be reached from the menu OR popped open mid-level when the
    // player taps an empty tool slot. In the latter case, returning resumes the
    // paused level instead of dropping back to the menu.
    click("shop-back", () => this.closeShop());
    click("themes-back", () => this.showScreen("menu"));
    click("achv-back", () => this.showScreen("menu"));
    click("achv-collect-all", () => this._claimAllAchievements());
    click("cal-back", () => this.showScreen("menu"));
    click("cal-claim", () => this._claimCalendar());
    click("season-back", () => this.showScreen("menu"));
    click("season-buy", () => this._buySeasonPremium());
    click("pets-back", () => this.closePetOverlay());
    click("chest-ok", () => this.showScreen("achievements"));
    click("btn-back", () => this.cb.quitToMenu && this.cb.quitToMenu());

    // Undo last move (HUD). Disabled state is reflected by `updateUndo`.
    click("btn-undo", () => this.cb.undoMove && this.cb.undoMove());

    // In-game pet badge doubles as a shortcut to the companion manager.
    click("hud-pet", () => this.openPetOverlay());

    // Switch-companion confirmation (only seen when changing pets mid-level).
    click("pet-confirm-cancel", () => this._cancelEquip());
    click("pet-confirm-ok", () => this._confirmEquip());

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

  // ---- Screen switching -------------------------------------------------
  hideScreens() {
    ["menu", "levelmap", "shop", "themes", "achievements", "calendar", "season", "pets"].forEach((s) =>
      this.el[s].classList.add("hidden")
    );
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
      this.refreshSeasonBadge();
    }
    if (name === "levelmap") this.buildLevelMap();
    if (name === "shop") this.buildShop();
    if (name === "themes") {
      this.buildThemes();
      this._refreshColorblindToggle();
      this._refreshHintsToggle();
    }
    if (name === "achievements") this.buildAchievements();
    if (name === "calendar") this.buildCalendar();
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
    const overGame = !!(this.cb.isLevelActive && this.cb.isLevelActive());
    this._petOverlayOverGame = overGame;
    this._selectedPet = null;
    if (overGame && this.cb.pauseGame) this.cb.pauseGame();
    this.hideModals();
    this.buildPets();
    this.refreshCoins();
    if (this.el["pets"]) this.el["pets"].classList.remove("hidden");
  }

  closePetOverlay() {
    const overGame = this._petOverlayOverGame;
    this._petOverlayOverGame = false;
    this._pendingEquipId = null;
    if (this.el["pet-confirm"]) this.el["pet-confirm"].classList.add("hidden");
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
    if (this.el["pet-reveal-desc"]) this.el["pet-reveal-desc"].textContent = pet.desc || "";

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
    const snap = Storage.get("activeSession");
    if (snap && snap.mode === "campaign" && !snap.ended) {
      const sub = btn.querySelector(".cta-sub");
      if (sub) sub.textContent = `Resume Level ${snap.levelId}`;
      btn.classList.remove("hidden");
      if (play) play.classList.remove("btn-primary");
    } else {
      btn.classList.add("hidden");
      if (play) play.classList.add("btn-primary");
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
        cell.addEventListener("click", () => {
          Audio.click();
          this.cb.startLevel && this.cb.startLevel(i);
        });
      }
      grid.appendChild(cell);
    }
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

  // Wire a buy button so a single tap buys once and holding it keeps buying at
  // the configured interval. `action()` performs one purchase and returns
  // `false` to stop the repeat (e.g. out of coins / sold out).
  _attachHoldRepeat(btn, action) {
    let timer = null;
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const fire = () => {
      if (action() === false) stop();
    };
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      stop();
      fire();
      timer = setInterval(fire, this._buyHoldMs());
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
      btn.addEventListener(ev, stop),
    );
    // Keyboard accessibility: Enter/Space buys once (no auto-repeat needed —
    // the OS key-repeat already re-fires keydown while held).
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fire();
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
    const puText = Object.entries(STARTER_PACK.powerups)
      .map(([type, n]) => `${POWERUP_INFO[type].icon}×${n}`)
      .join(" ");
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

  buildShop() {
    const list = this.el["shop-list"];
    list.innerHTML = "";

    // One-time Starter Pack — a prominent value bundle at the very top.
    this._buildStarterPackItem(list);
    // Power-ups
    Object.entries(POWERUP_INFO).forEach(([type, info]) => {
      const owned = Economy.getPowerup(type);
      const item = document.createElement("div");
      item.className = "shop-item";
      item.dataset.pu = type;
      item.innerHTML = `
        <span class="si-icon">${info.icon}</span>
        <div class="si-body">
          <div class="si-title">${info.name} <span class="si-owned" style="color:var(--text-dim);font-weight:600">×${owned}</span></div>
          <div class="si-desc">${info.desc}</div>
        </div>`;
      const buy = document.createElement("button");
      buy.className = "buy-btn";
      buy.innerHTML = `<span class="coin-dot"></span>${info.price}`;
      // Hold to keep buying at the configured rate (default 2/sec). The owned
      // count + coin balance update in place so the held button is never torn
      // down mid-repeat (a full rebuildShop would cancel the hold).
      this._attachHoldRepeat(buy, () => {
        if (Economy.buyPowerup(type)) {
          Audio.coin();
          this.toast(`${info.name} purchased!`);
          const ownedEl = item.querySelector(".si-owned");
          if (ownedEl) ownedEl.textContent = `×${Economy.getPowerup(type)}`;
          this.refreshCoins();
          this.updatePowerups();
          return true;
        }
        this.toast("Not enough coins");
        return false;
      });
      item.appendChild(buy);
      list.appendChild(item);
    });

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
  buildPets() {
    const { owned } = Storage.getPetState();
    // Default the detail selection to the equipped pet (or first owned one).
    if (!this._selectedPet || !PET_CATALOG.find((p) => p.id === this._selectedPet)) {
      const eq = Storage.getPetState().equipped;
      this._selectedPet = eq || PET_CATALOG[0].id;
    }
    this._buildPetCrate();
    this._buildPetStore();
    this._buildPetList(owned);
    this._buildPetDetail(owned);
  }

  _buildPetCrate() {
    const wrap = this.el["pets-crate"];
    if (!wrap) return;
    const { crates } = Storage.getPetState();
    wrap.innerHTML = "";
    const info = document.createElement("div");
    info.className = "crate-info";
    info.innerHTML = `<span class="crate-icon">🎁</span><div><div class="crate-title">Pet Crates</div><div class="crate-sub">You have <b id="crate-count">${crates}</b> — open one to win a pet!</div></div>`;

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
        this.toast(`${pet.icon} ${pet.name} +XP (duplicate)`);
      }
    });

    const buyBtn = document.createElement("button");
    buyBtn.className = "buy-btn pet-buy-crate";
    buyBtn.id = "crate-buy";
    buyBtn.innerHTML = `<span class="coin-dot"></span>${CRATE_COST}`;
    buyBtn.addEventListener("click", () => {
      if (this.cb.buyCrate && this.cb.buyCrate()) {
        Audio.coin();
        this.toast("Crate purchased!");
        this.refreshCoins();
        this.buildPets();
      } else {
        this.toast("Not enough coins");
      }
    });

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
      `<span class="store-icon">🧰</span>` +
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
      card.innerHTML =
        `<span class="pet-icon" style="filter:hue-rotate(${hue}deg)">${has ? pet.icon : (pet.premium ? "💎" : "❓")}</span>` +
        `<span class="pet-name">${has ? pet.name : (pet.premium ? "Premium" : "???")}</span>` +
        `<span class="pet-tag tag-${tag}">${has ? "Lv." + lvl : tag}</span>` +
        (equipped === pet.id ? `<span class="pet-eqbadge">✓</span>` : "");
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
      panel.appendChild(equip);

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
      hint.textContent = "Find this pet by opening crates.";
      panel.appendChild(hint);
    }
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
    if (!pet) {
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
    if (!show) this.updateUndo(0, false);
  }

  // Reflect the Undo control: `count` is the remaining budget, `enabled`
  // whether a move can be taken back right now. Hidden once the budget is gone.
  updateUndo(count, enabled) {
    const btn = this.el["btn-undo"];
    if (!btn) return;
    const show = (count || 0) > 0;
    btn.classList.toggle("hidden", !show);
    btn.classList.toggle("disabled", !enabled);
    btn.disabled = !enabled;
    const num = this.el["hud-undo-count"];
    if (num) num.textContent = count || 0;
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
    this.refreshCoins();
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
    (this._slots || []).forEach((btn, i) => {
      const type = loadout[i];
      const info = POWERUP_INFO[type];
      btn.dataset.pu = type || "";
      const icon = btn.querySelector(".pu-icon");
      const count = btn.querySelector(".pu-count");
      if (icon) icon.textContent = info ? info.icon : "＋";
      if (count) count.textContent = type ? Economy.getPowerup(type) : "";
      btn.setAttribute("aria-label", info ? `${info.name} (hold to change)` : "Empty slot");
    });
  }

  // ---- Loadout picker ---------------------------------------------------
  // Long-pressing a HUD slot opens this list of EVERY power-up so the player
  // can choose which one occupies that quick-access slot.
  openLoadoutPicker(slot) {
    this._loadoutSlot = slot;
    const loadout = Storage.getLoadout();
    const list = this.el["loadout-list"];
    if (!list) return;
    if (this.el["loadout-sub"])
      this.el["loadout-sub"].textContent = `Choose the power-up for slot ${slot + 1}.`;
    list.innerHTML = "";
    Object.entries(POWERUP_INFO).forEach(([type, info]) => {
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
    this.el["loadout"].classList.remove("hidden");
  }

  assignLoadout(slot, type) {
    Storage.setLoadoutSlot(slot, type);
    this.updatePowerups();
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
    if (this.el["isolated"]) this.el["isolated"].classList.add("hidden");
    if (this.el["loadout"]) this.el["loadout"].classList.add("hidden");
    if (this.el["chest"]) this.el["chest"].classList.add("hidden");
    if (this.el["pet-confirm"]) this.el["pet-confirm"].classList.add("hidden");
    if (this.el["pet-reveal"]) this.el["pet-reveal"].classList.add("hidden");
  }

  showWin({ stars, score, coins = 0, rewardText, stats, showNext, showDouble }) {
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

    this.showHud(false);
    this.el["win"].classList.remove("hidden");

    // Count the score up from zero immediately (the score is the achievement);
    // the coin payout is revealed only once the chest is opened.
    this._animateNumber(this.el["win-score"], score, 700);
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
  }

  // Fling a handful of coin/sparkle glyphs out of the chest along random arcs.
  _spawnChestBurst() {
    const host = this.el["win-chest-burst"];
    if (!host) return;
    host.innerHTML = "";
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

  showLose({ score, showRevive, title }) {
    if (title) document.querySelector("#lose .modal-title").textContent = title;
    this.el["lose-score"].textContent = score;
    this.el["lose-revive"].style.display = showRevive ? "" : "none";
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
