import { describe, it, expect, beforeEach } from "vitest";
import { Storage } from "../../src/storage.js";
import {
  Economy,
  POWERUP_INFO,
  POWERUP_UNLOCKS,
  COIN_PACKS,
  STARTER_PACK,
  AD_COIN_REWARDS,
  AD_COIN_DAILY_CAP,
  isPowerupUnlocked,
  nextPowerupUnlock,
  lockedPowerupRewardCoins,
  powerupUnlockLevel,
  powerupsUnlockedBetween,
  resolveRewardForUnlocks,
  unlockedPowerups,
} from "../../src/economy.js";

describe("economy", () => {
  beforeEach(() => {
    localStorage.clear();
    Storage.reset();
  });

  it("adds and clamps coins at zero", () => {
    Economy.addCoins(100);
    expect(Economy.coins).toBe(100);
    Economy.addCoins(-1000);
    expect(Economy.coins).toBe(0);
  });

  it("spendCoins succeeds only with sufficient balance", () => {
    Economy.addCoins(100);
    expect(Economy.spendCoins(40)).toBe(true);
    expect(Economy.coins).toBe(60);
    expect(Economy.spendCoins(1000)).toBe(false);
    expect(Economy.coins).toBe(60);
  });

  it("usePowerup decrements only when available", () => {
    Storage.set("powerups", { bomb: 0, colorClear: 0, shuffle: 0 });
    Economy.addPowerup("bomb", 2);
    expect(Economy.getPowerup("bomb")).toBe(2);
    expect(Economy.usePowerup("bomb")).toBe(true);
    expect(Economy.usePowerup("bomb")).toBe(true);
    expect(Economy.usePowerup("bomb")).toBe(false);
    expect(Economy.getPowerup("bomb")).toBe(0);
  });

  it("buyPowerup deducts the correct price and grants one", () => {
    Storage.set("maxUnlockedLevel", powerupUnlockLevel("bomb"));
    const price = POWERUP_INFO.bomb.price;
    Economy.addCoins(price + 10);
    const startCount = Economy.getPowerup("bomb");
    expect(Economy.buyPowerup("bomb")).toBe(true);
    expect(Economy.getPowerup("bomb")).toBe(startCount + 1);
    expect(Economy.coins).toBe(10);
  });

  it("buyPowerup fails without enough coins", () => {
    const startCount = Economy.getPowerup("colorClear");
    expect(Economy.buyPowerup("colorClear")).toBe(false);
    expect(Economy.getPowerup("colorClear")).toBe(startCount);
  });

  it("rejects unknown power-up types", () => {
    expect(Economy.buyPowerup("nope")).toBe(false);
  });

  it("locks all tools for the first five campaign levels", () => {
    for (let level = 1; level <= 5; level++) {
      expect(unlockedPowerups(level)).toEqual([]);
      for (const type of Object.keys(POWERUP_INFO)) {
        expect(isPowerupUnlocked(type, level)).toBe(false);
      }
    }
    expect(nextPowerupUnlock(5)).toMatchObject({ type: "undo", level: 6 });
  });

  it("unlocks tools gradually in a fixed campaign order", () => {
    expect(POWERUP_UNLOCKS.map((u) => u.type)).toEqual([
      "undo",
      "shuffle",
      "bomb",
      "colorClear",
      "pick",
      "paint",
      "chainBolt",
      "magnet",
    ]);
    expect(unlockedPowerups(6)).toEqual(["undo"]);
    expect(unlockedPowerups(16)).toEqual(["undo", "shuffle", "bomb", "colorClear", "pick"]);
    expect(unlockedPowerups(18)).toEqual(["undo", "shuffle", "bomb", "colorClear", "pick", "paint"]);
    expect(unlockedPowerups(24)).toEqual(POWERUP_UNLOCKS.map((u) => u.type));
    expect(powerupsUnlockedBetween(5, 10).map((u) => u.type)).toEqual(["undo", "shuffle", "bomb"]);
  });

  it("does not sell locked power-ups even when the player has enough coins", () => {
    Economy.addCoins(9999);
    const start = Economy.getPowerup("magnet");
    expect(Economy.buyPowerup("magnet")).toBe(false);
    expect(Economy.getPowerup("magnet")).toBe(start);
    expect(Economy.coins).toBe(9999);

    Storage.set("maxUnlockedLevel", powerupUnlockLevel("magnet"));
    expect(Economy.buyPowerup("magnet")).toBe(true);
    expect(Economy.getPowerup("magnet")).toBe(start + 1);
  });

  it("converts locked power-up rewards into usable coin rewards", () => {
    Storage.set("maxUnlockedLevel", 1);
    expect(lockedPowerupRewardCoins("bomb")).toBe(90);
    expect(resolveRewardForUnlocks({ powerup: "bomb" })).toEqual({ coins: 90 });
    expect(resolveRewardForUnlocks({ coins: 40, powerup: "shuffle" })).toEqual({ coins: 100 });
  });

  it("keeps reward power-ups once that tool is unlocked", () => {
    Storage.set("maxUnlockedLevel", powerupUnlockLevel("bomb"));
    expect(resolveRewardForUnlocks({ coins: 40, powerup: "bomb" })).toEqual({ coins: 40, powerup: "bomb" });
  });

  it("catalogs the Magnet, Chain Bolt, Pick and Paint with the Magnet most expensive", () => {
    for (const t of ["magnet", "chainBolt", "pick", "paint"]) {
      expect(POWERUP_INFO[t]).toBeTruthy();
      expect(POWERUP_INFO[t].price).toBeGreaterThan(0);
    }
    expect(POWERUP_INFO.magnet.price).toBe(500);
    // The Magnet is the dearest power-up of all.
    const prices = Object.values(POWERUP_INFO).map((p) => p.price);
    expect(POWERUP_INFO.magnet.price).toBe(Math.max(...prices));
  });

  it("buys and uses a Magnet like any other power-up", () => {
    Storage.set("maxUnlockedLevel", powerupUnlockLevel("magnet"));
    Economy.addCoins(POWERUP_INFO.magnet.price);
    const start = Economy.getPowerup("magnet");
    expect(Economy.buyPowerup("magnet")).toBe(true);
    expect(Economy.getPowerup("magnet")).toBe(start + 1);
    expect(Economy.usePowerup("magnet")).toBe(true);
    expect(Economy.getPowerup("magnet")).toBe(start);
  });

  describe("starter pack bundle", () => {
    it("bundles coins, several power-ups, and a crate", () => {
      expect(STARTER_PACK.id).toBe("starter_pack");
      expect(STARTER_PACK.coins).toBeGreaterThan(0);
      expect(Object.keys(STARTER_PACK.powerups).length).toBeGreaterThanOrEqual(2);
      Object.entries(STARTER_PACK.powerups).forEach(([type, n]) => {
        // Every bundled power-up is a real catalog tool, granted positively.
        expect(POWERUP_INFO[type]).toBeTruthy();
        expect(n).toBeGreaterThan(0);
      });
      expect(STARTER_PACK.crates).toBeGreaterThanOrEqual(1);
      expect(typeof STARTER_PACK.price).toBe("string");
    });
  });

  describe("daily ad-coin reward (watch ad for coins)", () => {
    const day1 = new Date("2026-06-11T09:00:00Z");
    const day2 = new Date("2026-06-12T09:00:00Z");

    it("does not offer unlimited free coins (no ad coin pack)", () => {
      // The only coin packs left are paid IAP — the free reward is capped.
      expect(COIN_PACKS.some((p) => p.ad)).toBe(false);
    });

    it("starts the day with the full cap and the first reward queued", () => {
      const s = Economy.adCoinState(day1);
      expect(s.count).toBe(0);
      expect(s.remaining).toBe(AD_COIN_DAILY_CAP);
      expect(s.nextAmount).toBe(AD_COIN_REWARDS[0]);
    });

    it("pays an escalating reward and caps at the daily limit", () => {
      let total = 0;
      for (let i = 0; i < AD_COIN_DAILY_CAP; i++) {
        const got = Economy.claimAdCoins(day1);
        expect(got).toBe(AD_COIN_REWARDS[i]);
        total += got;
      }
      expect(Economy.coins).toBe(total);
      // The cap is now reached: further claims pay nothing and grant no coins.
      expect(Economy.adCoinState(day1).remaining).toBe(0);
      expect(Economy.adCoinState(day1).nextAmount).toBe(0);
      expect(Economy.claimAdCoins(day1)).toBe(0);
      expect(Economy.coins).toBe(total);
    });

    it("resets the cap at the start of a new day", () => {
      Economy.claimAdCoins(day1);
      Economy.claimAdCoins(day1);
      expect(Economy.adCoinState(day1).count).toBe(2);
      // A new day restores the full allowance and the first-watch payout.
      const s2 = Economy.adCoinState(day2);
      expect(s2.count).toBe(0);
      expect(s2.remaining).toBe(AD_COIN_DAILY_CAP);
      expect(Economy.claimAdCoins(day2)).toBe(AD_COIN_REWARDS[0]);
    });
  });
});
