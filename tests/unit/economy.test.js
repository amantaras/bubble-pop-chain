import { describe, it, expect, beforeEach } from "vitest";
import { Storage } from "../../src/storage.js";
import { Economy, POWERUP_INFO } from "../../src/economy.js";

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

  it("catalogs the Magnet, Chain Bolt and Pick with the Magnet most expensive", () => {
    for (const t of ["magnet", "chainBolt", "pick"]) {
      expect(POWERUP_INFO[t]).toBeTruthy();
      expect(POWERUP_INFO[t].price).toBeGreaterThan(0);
    }
    expect(POWERUP_INFO.magnet.price).toBe(500);
    // The Magnet is the dearest power-up of all.
    const prices = Object.values(POWERUP_INFO).map((p) => p.price);
    expect(POWERUP_INFO.magnet.price).toBe(Math.max(...prices));
  });

  it("buys and uses a Magnet like any other power-up", () => {
    Economy.addCoins(POWERUP_INFO.magnet.price);
    const start = Economy.getPowerup("magnet");
    expect(Economy.buyPowerup("magnet")).toBe(true);
    expect(Economy.getPowerup("magnet")).toBe(start + 1);
    expect(Economy.usePowerup("magnet")).toBe(true);
    expect(Economy.getPowerup("magnet")).toBe(start);
  });
});
