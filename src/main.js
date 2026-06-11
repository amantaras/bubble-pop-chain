// Game orchestrator: canvas loop, state machine, and all session logic.
import { Board } from "./grid.js";
import { Renderer } from "./renderer.js";
import { ParticleSystem } from "./particles.js";
import { ScreenShake, FloatingText } from "./animations.js";
import { Input, vibrate } from "./input.js";
import { Audio } from "./audio.js";
import { Storage } from "./storage.js";
import { getTheme, applyThemeCss } from "./themes.js";
import { getLevel, LEVEL_COUNT } from "./levels.js";
import {
  groupScore,
  comboMultiplier,
  clearBonus,
  starsForScore,
} from "./scoring.js";
import { Economy } from "./economy.js";
import { Monetization } from "./monetization.js";
import { UI } from "./ui.js";
import {
  getDailyLevel,
  recordDaily,
  alreadyPlayedToday,
  getStreak,
} from "./daily.js";

const TOP_INSET = 168;
const BOTTOM_INSET = 120;
const COMBO_WINDOW = 1.6; // seconds before a combo resets

class Game {
  constructor() {
    this.canvas = document.getElementById("game-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.renderer = new Renderer(this.ctx);
    this.particles = new ParticleSystem();
    this.floating = new FloatingText();
    this.shake = new ScreenShake();
    this.theme = getTheme(Storage.get("currentTheme"));
    this.session = null;
    this.W = 0;
    this.H = 0;
    this.lastTime = 0;
    this._endTimer = null;
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
      onThemeChange: (t) => {
        this.theme = t;
      },
    });

    this.input = new Input(this.canvas, (x, y) => this.handleTap(x, y));
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

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () =>
        navigator.serviceWorker.register("sw.js").catch(() => {})
      );
    }

    requestAnimationFrame((t) => this.loop(t));
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = Math.floor(this.W * dpr);
    this.canvas.height = Math.floor(this.H * dpr);
    this.canvas.style.width = this.W + "px";
    this.canvas.style.height = this.H + "px";
    this.canvas._dpr = dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.session) {
      this.session.board.layout(this.W, this.H, TOP_INSET, BOTTOM_INSET);
    }
  }

  // ---- Session setup ----------------------------------------------------
  _newSession(mode, level) {
    clearTimeout(this._endTimer);
    const board = new Board(level.cols, level.rows, level.colors, level.seed);
    this.session = {
      mode,
      level,
      board,
      score: 0,
      movesLeft: level.moves,
      combo: 0,
      comboTimer: 0,
      armed: null,
      ended: false,
      coinsEarned: 0,
      doubled: false,
      revived: false,
    };
    this._enterSession();
    if (mode === "campaign") this._persistSession();
  }

  // Shared UI/state setup used by both fresh and resumed sessions.
  _enterSession() {
    const board = this.session.board;
    board.layout(this.W, this.H, TOP_INSET, BOTTOM_INSET);
    this.particles.particles.length = 0;
    this.floating.items.length = 0;
    UI.hideScreens();
    UI.hideModals();
    UI.showHud(true);
    UI.clearArmedPowerups();
    UI.updatePowerups();
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
    const board = new Board(level.cols, level.rows, level.colors, level.seed);
    board.layout(this.W, this.H, TOP_INSET, BOTTOM_INSET);
    board.restore(snap.grid);
    this.session = {
      mode: "campaign",
      level,
      board,
      score: snap.score,
      movesLeft: snap.movesLeft,
      combo: 0,
      comboTimer: 0,
      armed: null,
      ended: false,
      coinsEarned: 0,
      doubled: false,
      revived: !!snap.revived,
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
    });
  }

  _clearActiveSession() {
    if (Storage.get("activeSession")) Storage.set("activeSession", null);
  }

  startCampaign(id) {
    this._newSession("campaign", getLevel(id));
  }

  startEndless() {
    const lvl = { cols: 8, rows: 11, colors: 5, moves: 9999, target: 0, id: "endless" };
    this._newSession("endless", lvl);
    this.session.movesLeft = 9999;
  }

  startDaily() {
    const lvl = getDailyLevel();
    this._newSession("daily", lvl);
    this.session.movesLeft = 9999;
    if (alreadyPlayedToday()) {
      UI.toast(`Replaying today • Streak ${getStreak()}🔥`);
    }
  }

  // ---- HUD --------------------------------------------------------------
  refreshHud() {
    const s = this.session;
    if (!s) return;
    if (s.mode === "campaign") {
      UI.updateHud({
        modeLabel: `Level ${s.level.id}`,
        score: s.score,
        movesLabel: "Moves",
        moves: s.movesLeft,
        showTarget: true,
        target: s.level.target,
        progress: s.score / s.level.target,
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
    const cell = s.board.cellAtPixel(px, py);

    if (s.armed) {
      if (!cell) return; // need a valid bubble target
      this.applyPowerup(s.armed, cell.c, cell.r);
      return;
    }

    if (!cell) return;
    this.popAt(cell.c, cell.r);
  }

  popAt(c, r) {
    const s = this.session;
    const group = s.board.getGroupAt(c, r);
    if (group.length < 2) {
      vibrate(8);
      return;
    }

    // Score with combo multiplier.
    const base = groupScore(group.length);
    const mult = comboMultiplier(s.combo);
    const points = Math.round(base * mult);
    s.score += points;
    s.combo += 1;
    s.comboTimer = COMBO_WINDOW;

    this._popCells(group, points, group.length, s.combo);

    if (s.mode === "campaign") s.movesLeft -= 1;
    this.refreshHud();
    this.afterMove();
  }

  applyPowerup(type, c, r) {
    const s = this.session;
    let cells = [];
    if (type === "bomb") cells = s.board.bombArea(c, r);
    else if (type === "colorClear") cells = s.board.colorCells(s.board.grid[c][r]);
    if (cells.length === 0) return;

    if (!Economy.usePowerup(type)) return;
    const points = groupScore(Math.max(2, cells.length));
    s.score += points;
    this._popCells(cells, points, cells.length, 1, 0.6);
    Audio.powerup();
    s.armed = null;
    UI.clearArmedPowerups();
    UI.updatePowerups();
    this.refreshHud();
    this.afterMove();
  }

  _popCells(cells, points, groupSize, combo, shakePower = 1) {
    const s = this.session;
    const fx = s.board.removeCells(cells, this.theme);
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
    if (!s || s.ended) return;
    if (Economy.getPowerup(type) <= 0) {
      UI.toast("None left — buy in Shop");
      return;
    }
    if (type === "shuffle") {
      Economy.usePowerup(type);
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
      UI.clearArmedPowerups();
    } else {
      s.armed = type;
      UI.clearArmedPowerups();
      btn.classList.add("armed");
      UI.toast(type === "bomb" ? "Tap to drop bomb" : "Tap a color to clear it");
    }
  }

  // ---- End-of-move evaluation ------------------------------------------
  afterMove() {
    const s = this.session;
    if (!s || s.ended) return;

    if (s.board.isCleared()) {
      if (s.mode === "endless") {
        // Reward and refill for continuous play.
        const bonus = clearBonus(0);
        s.score += bonus;
        this.floating.spawn(this.W / 2, this.H / 2, "BOARD CLEAR!", "#5bff9b", 30);
        s.board = new Board(8, 11, 5, (Math.random() * 1e9) | 0);
        s.board.layout(this.W, this.H, TOP_INSET, BOTTOM_INSET);
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
      if (s.movesLeft <= 0 || deadlock) {
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
        const coins = Math.floor(s.score / 120) + stars * 15;
        s.coinsEarned = coins;
        Economy.addCoins(coins);
        Audio.win();
        UI.setWinTitle(reason === "cleared" ? "Board Cleared!" : "Level Clear!");
        UI.showWin({
          stars,
          score: s.score,
          rewardText: `+${coins} coins`,
          showNext: s.level.id < LEVEL_COUNT,
          showDouble: !Monetization.isAdsRemoved(),
        });
        await Monetization.maybeShowInterstitial();
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
      const coins = Math.floor(s.score / 200);
      Economy.addCoins(coins);
      Audio.lose();
      UI.showLose({
        score: s.score,
        showRevive: !s.revived,
        title: s.score > prevBest ? "New Best!" : "Game Over",
      });
    } else if (s.mode === "daily") {
      const info = recordDaily(s.score);
      const coins = Math.floor(s.score / 150) + 30;
      s.coinsEarned = coins;
      Economy.addCoins(coins);
      Audio.win();
      UI.setWinTitle("Daily Complete");
      UI.showWin({
        stars: 0,
        score: s.score,
        rewardText: `Streak ${info.streak}🔥  +${coins} coins`,
        showNext: false,
        showDouble: !Monetization.isAdsRemoved(),
      });
    }
    UI.refreshCoins();
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
    UI.toast(`+${s.coinsEarned} bonus coins!`);
    document.getElementById("win-double").style.display = "none";
  }

  quitToMenu() {
    clearTimeout(this._endTimer);
    // Keep the in-progress campaign snapshot so the player can resume it;
    // it is only cleared when the level is actually finished.
    this._persistSession();
    this.session = null;
    this.input.setEnabled(false);
    UI.showScreen("menu");
  }

  // ---- Main loop --------------------------------------------------------
  update(dt) {
    this.shake.update(dt);
    this.particles.update(dt);
    this.floating.update(dt);
    if (this.session) {
      this.session.board.update(dt);
      if (this.session.combo > 0) {
        this.session.comboTimer -= dt;
        if (this.session.comboTimer <= 0) this.session.combo = 0;
      }
    }
  }

  render(time) {
    const ctx = this.ctx;
    this.renderer.drawBackground(this.W, this.H, this.theme, time);
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    if (this.session) {
      this.renderer.drawBoardFrame(this.session.board);
      this.renderer.drawBubbles(this.session.board, this.theme);
    }
    this.particles.draw(ctx);
    this.floating.draw(ctx);
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
  window.__bpc = { game, Storage, Economy, Monetization, UI, getLevel };
}
