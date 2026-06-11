// Coin economy and power-up inventory.
import { Storage } from "./storage.js";

export const POWERUP_INFO = {
  bomb: { name: "Bomb", icon: "💥", desc: "Clears a 3×3 area", price: 150 },
  colorClear: { name: "Color Clear", icon: "🌈", desc: "Removes one whole color", price: 250 },
  shuffle: { name: "Shuffle", icon: "🔀", desc: "Reshuffles the board", price: 100 },
};

export const COIN_PACKS = [
  { id: "coins_small", name: "Pouch of Coins", amount: 500, label: "Watch ad", ad: true },
  { id: "coins_med", name: "Bag of Coins", amount: 1500, label: "$1.99", ad: false },
  { id: "coins_large", name: "Chest of Coins", amount: 5000, label: "$4.99", ad: false },
];

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
}

export const Economy = new EconomyManager();
