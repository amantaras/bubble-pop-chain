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
});
