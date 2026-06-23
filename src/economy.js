// Coin economy and power-up inventory.
import { Storage } from "./storage.js";
import { todayKey } from "./rng.js";

export const POWERUP_INFO = {
  undo: { name: "Undo", icon: "↶", desc: "Takes back your last move", price: 90 },
  bomb: { name: "Bomb", icon: "💥", desc: "Clears a 3×3 area", price: 150 },
  colorClear: { name: "Color Clear", icon: "🌈", desc: "Removes one whole color", price: 250 },
  paint: { name: "Paint", icon: "🎨", desc: "Changes one bubble to a smart suggested color", price: 180 },
  shuffle: { name: "Shuffle", icon: "🔀", desc: "Reshuffles the board", price: 100 },
  chainBolt: { name: "Chain Bolt", icon: "⚡", desc: "Clears a full row and column", price: 300 },
  pick: { name: "Pick", icon: "🔨", desc: "Removes a single bubble", price: 120 },
  magnet: { name: "Magnet", icon: "🧲", desc: "Pull same-color bubbles together — time the gauge!", price: 500 },
};

export const POWERUP_UNLOCKS = [
  { type: "undo", level: 6, lesson: "Tap Undo after a move goes wrong. It spends one charge and restores the board, score, moves, and any tool you spent on that move." },
  { type: "shuffle", level: 8, lesson: "Tap Shuffle when the board feels stuck. It spends one charge and immediately reshuffles the bubbles into a fresh, playable board." },
  { type: "bomb", level: 10, lesson: "Tap Bomb, then tap the board. It clears a 3×3 area, which is perfect for breaking crowded corners or opening space near the bottom." },
  { type: "colorClear", level: 13, lesson: "Tap Color Clear, then tap a bubble colour. Every bubble of that colour disappears, setting up huge cascades and emergency clears." },
  { type: "pick", level: 16, lesson: "Tap Pick, then tap one bubble. Use it to remove a lone blocker, trigger a special bubble, or rescue a board that is almost solved." },
  { type: "paint", level: 18, lesson: "Tap Paint, choose one bubble, then pick from the three suggested colours. The best swatch makes the biggest new group for your next pop." },
  { type: "chainBolt", level: 20, lesson: "Tap Chain Bolt, then tap a cell. It clears that whole row and column, and any special bubbles in the strike can chain for extra impact." },
  { type: "magnet", level: 24, lesson: "Tap Magnet, choose a plain bubble, then tap again when the dial hits green. A strong lock pulls that colour into one giant poppable cluster." },
];

const UNLOCK_BY_TYPE = Object.fromEntries(POWERUP_UNLOCKS.map((u) => [u.type, u]));

export function powerupUnlock(type) {
  return UNLOCK_BY_TYPE[type] || null;
}

export function powerupUnlockLevel(type) {
  return powerupUnlock(type)?.level || Infinity;
}

export function isPowerupUnlocked(type, level = Storage.get("maxUnlockedLevel")) {
  return !!POWERUP_INFO[type] && Math.max(1, Number(level) || 1) >= powerupUnlockLevel(type);
}

export function unlockedPowerups(level = Storage.get("maxUnlockedLevel")) {
  return POWERUP_UNLOCKS.filter((u) => isPowerupUnlocked(u.type, level)).map((u) => u.type);
}

export function lockedPowerupRewardCoins(type, amount = 1) {
  const info = POWERUP_INFO[type];
  const n = Math.max(1, Number(amount) || 1);
  return Math.max(50, Math.round(((info && info.price) || 100) * 0.6)) * n;
}

export function resolveRewardForUnlocks(reward = {}, level = Storage.get("maxUnlockedLevel")) {
  const out = { ...reward };
  if (out.powerup && !isPowerupUnlocked(out.powerup, level)) {
    out.coins = (out.coins || 0) + lockedPowerupRewardCoins(out.powerup, out.powerupAmount || 1);
    delete out.powerup;
    delete out.powerupAmount;
  }
  return out;
}

export function nextPowerupUnlock(level = Storage.get("maxUnlockedLevel")) {
  const current = Math.max(1, Number(level) || 1);
  return POWERUP_UNLOCKS.find((u) => u.level > current) || null;
}

export function powerupsUnlockedBetween(fromLevel, toLevel) {
  const from = Math.max(1, Number(fromLevel) || 1);
  const to = Math.max(1, Number(toLevel) || 1);
  return POWERUP_UNLOCKS.filter((u) => u.level > from && u.level <= to);
}

// Coin packs purchasable with real money through the monetization provider. The free "watch an ad
// for coins" reward is handled separately by the daily-capped ad reward below
// so it can never be farmed for unlimited coins.
export const COIN_PACKS = [
  { id: "coins_med", name: "Bag of Coins", amount: 1500, label: "$1.99", ad: false },
  { id: "coins_large", name: "Chest of Coins", amount: 5000, label: "$4.99", ad: false },
];

// One-time "Starter Pack" bundle through the monetization provider. A heavily-discounted kickstart of
// coins + a spread of power-ups + a pet crate, buyable exactly once. It is
// purely additive value (never required to progress) and is gated by the
// `starterPack` save flag so it can be bought a single time.
export const STARTER_PACK = {
  id: "starter_pack",
  name: "Starter Pack",
  price: "$1.99",
  coins: 2000,
  powerups: { undo: 3, bomb: 3, colorClear: 2, shuffle: 2, magnet: 1 },
  crates: 1,
};

// Free "watch an ad for coins" reward. It is capped per day and the payout
// escalates with each watch, so players form a daily habit of watching a few
// ads without trivialising the economy (which an unlimited reward would).
export const AD_COIN_REWARDS = [150, 250, 400];
export const AD_COIN_DAILY_CAP = AD_COIN_REWARDS.length;

class EconomyManager {
  get coins() {
    return Storage.get("coins");
  }

  addCoins(n) {
    Storage.set("coins", Math.max(0, this.coins + n));
    return this.coins;
  }

  spendCoins(n) {
    if (this.coins < n) return false;
    Storage.set("coins", this.coins - n);
    return true;
  }

  getPowerup(type) {
    return Storage.get("powerups")[type] || 0;
  }

  addPowerup(type, n = 1) {
    const p = { ...Storage.get("powerups") };
    p[type] = (p[type] || 0) + n;
    Storage.set("powerups", p);
  }

  usePowerup(type) {
    const p = { ...Storage.get("powerups") };
    if (!p[type] || p[type] <= 0) return false;
    p[type] -= 1;
    Storage.set("powerups", p);
    return true;
  }

  // Buy one power-up with coins. Returns true on success.
  buyPowerup(type, opts = {}) {
    const info = POWERUP_INFO[type];
    if (!info) return false;
    if (!opts.ignoreUnlock && !isPowerupUnlocked(type)) return false;
    if (!this.spendCoins(info.price)) return false;
    this.addPowerup(type, 1);
    return true;
  }

  // Current daily ad-coin reward state, auto-resetting at the start of a new
  // local day. `nextAmount` is what the next watch would pay (0 when capped).
  adCoinState(date = new Date()) {
    const today = todayKey(date);
    const raw = Storage.get("adRewards") || { date: null, count: 0 };
    const count = raw.date === today ? raw.count : 0;
    const remaining = Math.max(0, AD_COIN_DAILY_CAP - count);
    return {
      count,
      remaining,
      cap: AD_COIN_DAILY_CAP,
      nextAmount: remaining > 0 ? AD_COIN_REWARDS[count] : 0,
    };
  }

  // Claim one daily ad-coin reward (call after the rewarded ad resolves).
  // Returns the coins granted, or 0 when the daily cap is already reached.
  claimAdCoins(date = new Date()) {
    const state = this.adCoinState(date);
    if (state.remaining <= 0) return 0;
    const amount = state.nextAmount;
    Storage.set("adRewards", { date: todayKey(date), count: state.count + 1 });
    this.addCoins(amount);
    return amount;
  }
}

export const Economy = new EconomyManager();
