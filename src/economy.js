// Coin economy and power-up inventory.
import { Storage } from "./storage.js";
import { todayKey } from "./rng.js";

export const POWERUP_INFO = {
  bomb: { name: "Bomb", icon: "💥", desc: "Clears a 3×3 area", price: 150 },
  colorClear: { name: "Color Clear", icon: "🌈", desc: "Removes one whole color", price: 250 },
  shuffle: { name: "Shuffle", icon: "🔀", desc: "Reshuffles the board", price: 100 },
  chainBolt: { name: "Chain Bolt", icon: "⚡", desc: "Clears a full row and column", price: 300 },
  pick: { name: "Pick", icon: "🔨", desc: "Removes a single bubble", price: 120 },
  magnet: { name: "Magnet", icon: "🧲", desc: "Pull same-color bubbles together — time the gauge!", price: 500 },
};

// Coin packs purchasable with real money (mock IAP). The free "watch an ad
// for coins" reward is handled separately by the daily-capped ad reward below
// so it can never be farmed for unlimited coins.
export const COIN_PACKS = [
  { id: "coins_med", name: "Bag of Coins", amount: 1500, label: "$1.99", ad: false },
  { id: "coins_large", name: "Chest of Coins", amount: 5000, label: "$4.99", ad: false },
];

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
  buyPowerup(type) {
    const info = POWERUP_INFO[type];
    if (!info) return false;
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
