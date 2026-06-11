// DOM-based UI: menus, level map, shop, themes, HUD, modals, toasts.
import { Storage } from "./storage.js";
import { LEVEL_COUNT, getLevel } from "./levels.js";
import { milestoneType } from "./milestones.js";
import {
  THEMES,
  getTheme,
  isThemeUnlocked,
  applyThemeCss,
} from "./themes.js";
import { Economy, POWERUP_INFO, COIN_PACKS } from "./economy.js";
import { Monetization } from "./monetization.js";
import { Audio } from "./audio.js";
import {
  getDailyModifier,
  getStreak,
  getFreezeTokens,
  alreadyPlayedToday,
} from "./daily.js";

const $ = (id) => document.getElementById(id);

class UIManager {
  constructor() {
    this.cb = {};
    this.el = {};
  }

  init() {
    const ids = [
      "menu", "levelmap", "shop", "themes", "hud", "win", "lose",
      "menu-coins", "lm-coins", "shop-coins", "themes-coins", "hud-coins",
      "level-grid", "shop-list", "theme-list",
      "btn-continue", "daily-summary",
      "hud-mode-label", "hud-score", "hud-target", "hud-target-wrap", "hud-target-label",
      "hud-moves", "hud-moves-label", "hud-progress-fill",
      "power-meter", "power-fill", "power-label",
      "powerups", "pu-slot-0", "pu-slot-1", "pu-slot-2",
      "loadout", "loadout-list", "loadout-sub", "loadout-close",
      "magnet-gauge", "mg-needle",
      "events-layer",
      "combo-banner", "toast",      "win-stars", "win-score", "win-reward", "win-double", "win-next", "win-menu",
      "win-stats", "win-coins", "win-coins-num",
      "lose-score", "lose-revive", "lose-retry", "lose-menu",
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
    click("btn-shop", () => this.showScreen("shop"));
    click("btn-themes", () => this.showScreen("themes"));
    click("btn-tutorial", () => this.cb.startTutorial && this.cb.startTutorial());

    // Back buttons
    click("lm-back", () => this.showScreen("menu"));
    click("shop-back", () => this.showScreen("menu"));
    click("themes-back", () => this.showScreen("menu"));
    click("btn-back", () => this.cb.quitToMenu && this.cb.quitToMenu());

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

    // Lose modal
    click("lose-retry", () => this.cb.retryLevel && this.cb.retryLevel());
    click("lose-menu", () => this.cb.quitToMenu && this.cb.quitToMenu());
    const lr = $("lose-revive");
    if (lr) lr.addEventListener("click", () => this.cb.reviveLevel && this.cb.reviveLevel());

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
    ["menu", "levelmap", "shop", "themes"].forEach((s) =>
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
    }
    if (name === "levelmap") this.buildLevelMap();
    if (name === "shop") this.buildShop();
    if (name === "themes") this.buildThemes();
  }

  // Show a "Continue" entry on the menu when a campaign level is in progress.
  updateContinue() {    const btn = this.el["btn-continue"];
    if (!btn) return;
    const play = $("btn-play");
    const snap = Storage.get("activeSession");
    if (snap && snap.mode === "campaign" && !snap.ended) {
      btn.textContent = `Continue • Level ${snap.levelId}`;
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
  }

  refreshCoins() {
    const c = Economy.coins;
    ["menu-coins", "lm-coins", "shop-coins", "themes-coins", "hud-coins"].forEach(
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
    for (let i = 1; i <= LEVEL_COUNT; i++) {
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
      cell.innerHTML = locked
        ? `<span class="lock">🔒</span>${badge ? `<span class="lvl-badge">${badge}</span>` : ""}`
        : `${badge ? `<span class="lvl-badge">${badge}</span>` : ""}<span class="num">${i}</span><span class="lvl-stars">${starStr}</span>`;
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
  buildShop() {
    const list = this.el["shop-list"];
    list.innerHTML = "";

    // Power-ups
    Object.entries(POWERUP_INFO).forEach(([type, info]) => {
      const owned = Economy.getPowerup(type);
      const item = document.createElement("div");
      item.className = "shop-item";
      item.innerHTML = `
        <span class="si-icon">${info.icon}</span>
        <div class="si-body">
          <div class="si-title">${info.name} <span style="color:var(--text-dim);font-weight:600">×${owned}</span></div>
          <div class="si-desc">${info.desc}</div>
        </div>`;
      const buy = document.createElement("button");
      buy.className = "buy-btn";
      buy.innerHTML = `<span class="coin-dot"></span>${info.price}`;
      buy.addEventListener("click", () => {
        if (Economy.buyPowerup(type)) {
          Audio.coin();
          this.toast(`${info.name} purchased!`);
          this.buildShop();
          this.refreshCoins();
        } else {
          this.toast("Not enough coins");
        }
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
    this.refreshCoins();
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

  clearArmedPowerups() {
    document.querySelectorAll(".powerup-btn").forEach((b) => b.classList.remove("armed"));
  }

  showCombo(text) {
    const b = this.el["combo-banner"];
    b.textContent = text;
    b.classList.remove("hidden", "show");
    void b.offsetWidth; // reflow to restart animation
    b.classList.add("show");
  }

  // ---- Modals -----------------------------------------------------------
  hideModals() {
    this.el["win"].classList.add("hidden");
    this.el["lose"].classList.add("hidden");
    if (this.el["loadout"]) this.el["loadout"].classList.add("hidden");
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
    this.el["win-double"].style.display = showDouble ? "" : "none";
    this.showHud(false);
    this.el["win"].classList.remove("hidden");

    // Count the score and coins up from zero for a rewarding finish.
    this._animateNumber(this.el["win-score"], score, 700);
    this._animateCoins(coins);
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
    if (layer) layer.innerHTML = "";
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
