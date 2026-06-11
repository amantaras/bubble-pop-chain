import { describe, it, expect } from "vitest";
import {
  groupScore,
  comboMultiplier,
  clearBonus,
  starsForScore,
  coinReward,
  powerGain,
} from "../../src/scoring.js";
import { getLevel, starThresholds } from "../../src/levels.js";

describe("scoring", () => {
  it("groupScore is 0 for groups smaller than 2", () => {
    expect(groupScore(0)).toBe(0);
    expect(groupScore(1)).toBe(0);
  });

  it("groupScore rewards bigger groups disproportionately", () => {
    expect(groupScore(2)).toBe(10);
    expect(groupScore(3)).toBe(30);
    expect(groupScore(4)).toBe(60);
    // per-bubble value increases with size
    expect(groupScore(6) / 6).toBeGreaterThan(groupScore(3) / 3);
  });

  it("comboMultiplier grows then caps at 5", () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(2)).toBe(2);
    expect(comboMultiplier(100)).toBe(5);
  });

  it("clearBonus increases with moves left", () => {
    expect(clearBonus(0)).toBe(500);
    expect(clearBonus(3)).toBe(950);
    expect(clearBonus(10)).toBeGreaterThan(clearBonus(5));
  });

  it("starsForScore maps to thresholds 0..3", () => {
    const level = getLevel(5);
    const t = starThresholds(level);
    expect(starsForScore(level, t.one - 1)).toBe(0);
    expect(starsForScore(level, t.one)).toBe(1);
    expect(starsForScore(level, t.two)).toBe(2);
    expect(starsForScore(level, t.three)).toBe(3);
    expect(starsForScore(level, t.three + 10_000)).toBe(3);
  });

  it("powerGain is non-negative, capped, and rewards points + combo", () => {
    expect(powerGain(0, 0)).toBe(0);
    expect(powerGain(-100, 0)).toBe(0); // never negative
    expect(powerGain(1_000_000, 100)).toBe(0.5); // capped
    // More points and longer combos charge faster.
    expect(powerGain(500, 3)).toBeGreaterThan(powerGain(100, 1));
    // A single modest pop cannot fill the meter alone.
    expect(powerGain(300, 1)).toBeLessThan(1);
  });

  it("coinReward pays a score slice plus a per-star bonus", () => {
    // 20 coins per star, no score component when score < 100.
    expect(coinReward(0, 0)).toBe(0);
    expect(coinReward(0, 3)).toBe(60);
    // Score slice: floor(score / 100).
    expect(coinReward(200, 0)).toBe(2);
    expect(coinReward(200, 2)).toBe(2 + 40);
    // More stars always pay strictly more for the same score.
    expect(coinReward(500, 3)).toBeGreaterThan(coinReward(500, 2));
    expect(coinReward(500, 2)).toBeGreaterThan(coinReward(500, 1));
    // Never negative for odd inputs.
    expect(coinReward(-100, -1)).toBe(0);
  });
});
