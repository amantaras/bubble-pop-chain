// DOM-based UI: menus, level map, shop, themes, HUD, modals, toasts.
import { Storage } from "./storage.js";
import { LEVEL_COUNT, getLevel } from "./levels.js";
import {
  THEMES,
  getTheme,
  isThemeUnlocked,
  applyThemeCss,
} from "./themes.js";
import { Economy, POWERUP_INFO, COIN_PACKS } from "./economy.js";
import { Monetization } from "./monetization.js";
import { Audio } from "./audio.js";

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
      "btn-continue",
      "hud-mode-label", "hud-score", "hud-target", "hud-target-wrap",
      "hud-moves", "hud-moves-label", "hud-progress-fill",
      "pu-bomb-count", "pu-color-count", "pu-shuffle-count",
      "combo-banner", "toast",
      "win-stars", "win-score", "win-reward", "win-double", "win-next", "win-menu",
      "lose-score", "lose-revive", "lose-retry", "lose-menu",
      "btn-sound",
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

    // Power-up buttons
    document.querySelectorAll(".powerup-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const type = btn.dataset.pu;
        if (this.cb.armPowerup) this.cb.armPowerup(type, btn);
      });
    });

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
    if (name === "menu") this.updateContinue();
    if (name === "levelmap") this.buildLevelMap();
    if (name === "shop") this.buildShop();
    if (name === "themes") this.buildThemes();
  }

  // Show a "Continue" entry on the menu when a campaign level is in progress.
  updateContinue() {
    const btn = this.el["btn-continue"];
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
      const stars = Storage.getStars(i);
      const starStr = locked
        ? ""
        : "★".repeat(stars) + "☆".repeat(3 - stars);
      cell.innerHTML = locked
        ? `<span class="lock">🔒</span>`
        : `<span class="num">${i}</span><span class="lvl-stars">${starStr}</span>`;
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

    // Coin packs
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
      buy.textContent = pack.ad ? "▶ " + pack.label : pack.label;
      buy.addEventListener("click", async () => {
        if (pack.ad) {
          await Monetization.showRewardedAd("coins");
        }
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
    if (s.target !== undefined) this.el["hud-target"].textContent = s.target;
    if (s.progress !== undefined)
      this.el["hud-progress-fill"].style.width = `${Math.min(100, s.progress * 100)}%`;
    this.refreshCoins();
  }

  updatePowerups() {
    this.el["pu-bomb-count"].textContent = Economy.getPowerup("bomb");
    this.el["pu-color-count"].textContent = Economy.getPowerup("colorClear");
    this.el["pu-shuffle-count"].textContent = Economy.getPowerup("shuffle");
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
  }

  showWin({ stars, score, rewardText, showNext, showDouble }) {
    const starEls = this.el["win-stars"].querySelectorAll(".star");
    starEls.forEach((el, i) => el.classList.toggle("on", i < stars));
    this.el["win-score"].textContent = score;
    this.el["win-reward"].textContent = rewardText || "";
    this.el["win-next"].style.display = showNext ? "" : "none";
    this.el["win-double"].style.display = showDouble ? "" : "none";
    this.showHud(false);
    this.el["win"].classList.remove("hidden");
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
}

export const UI = new UIManager();
