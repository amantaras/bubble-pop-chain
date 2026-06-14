import { describe, it, expect } from "vitest";
import {
  groupScore,
  comboMultiplier,
  comboTier,
  COMBO_TIERS,
  cascadeBonus,
  cascadeTier,
  CASCADE_TIERS,
  CASCADE_MIN,
  CASCADE_STEP,
  CASCADE_CAP,
  clearBonus,
  starsForScore,
  coinReward,
  powerGain,
  feverGain,
  feverPoints,
  FEVER_MULTIPLIER,
  FEVER_DURATION,
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

  it("comboTier is null below the first threshold", () => {
    expect(comboTier(0)).toBeNull();
    expect(comboTier(1)).toBeNull();
  });

  it("comboTier escalates through the tiers at their thresholds", () => {
    expect(comboTier(2).className).toBe("ct-1");
    expect(comboTier(3).className).toBe("ct-1");
    expect(comboTier(4).className).toBe("ct-2");
    expect(comboTier(6).className).toBe("ct-3");
    expect(comboTier(9).className).toBe("ct-4");
    expect(comboTier(13).className).toBe("ct-5");
    expect(comboTier(99).className).toBe("ct-5"); // stays at the top tier
  });

  it("comboTier returns ascending tiers with labels and a 0-based index", () => {
    expect(comboTier(2).tier).toBe(0);
    expect(comboTier(13).tier).toBe(COMBO_TIERS.length - 1);
    expect(typeof comboTier(2).label).toBe("string");
    // thresholds strictly increase so tiers can never overlap
    for (let i = 1; i < COMBO_TIERS.length; i++) {
      expect(COMBO_TIERS[i].min).toBeGreaterThan(COMBO_TIERS[i - 1].min);
    }
  });

  it("cascadeBonus pays nothing until the chain reaches CASCADE_MIN", () => {
    expect(cascadeBonus(0)).toBe(0);
    expect(cascadeBonus(1)).toBe(0);
    expect(cascadeBonus(CASCADE_MIN - 1)).toBe(0);
    expect(cascadeBonus(CASCADE_MIN)).toBeGreaterThan(0);
  });

  it("cascadeBonus escalates by a flat step per chain link, then caps", () => {
    expect(cascadeBonus(2)).toBe(CASCADE_STEP);
    expect(cascadeBonus(3)).toBe(CASCADE_STEP * 2);
    expect(cascadeBonus(4)).toBe(CASCADE_STEP * 3);
    // monotonic non-decreasing
    for (let n = 2; n < 40; n++) {
      expect(cascadeBonus(n + 1)).toBeGreaterThanOrEqual(cascadeBonus(n));
    }
    // never exceeds the cap
    expect(cascadeBonus(1000)).toBe(CASCADE_CAP);
  });

  it("cascadeTier is null below the first threshold then escalates", () => {
    expect(cascadeTier(1)).toBeNull();
    expect(cascadeTier(2).tier).toBe(0);
    expect(cascadeTier(CASCADE_TIERS[CASCADE_TIERS.length - 1].min).tier).toBe(
      CASCADE_TIERS.length - 1
    );
    expect(cascadeTier(999).tier).toBe(CASCADE_TIERS.length - 1);
    expect(typeof cascadeTier(2).label).toBe("string");
    // thresholds strictly increase so tiers can never overlap
    for (let i = 1; i < CASCADE_TIERS.length; i++) {
      expect(CASCADE_TIERS[i].min).toBeGreaterThan(CASCADE_TIERS[i - 1].min);
    }
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

  it("feverGain is non-negative, capped, and rewards longer combos", () => {
    expect(feverGain(0)).toBeGreaterThan(0);
    expect(feverGain(0)).toBeCloseTo(0.05, 5);
    // Longer combos fill the gauge faster.
    expect(feverGain(3)).toBeGreaterThan(feverGain(1));
    // Capped so a single big combo can't fill it alone.
    expect(feverGain(100)).toBe(0.34);
    // A single pop (combo 0) cannot fill the gauge.
    expect(feverGain(0)).toBeLessThan(1);
  });

  it("feverPoints doubles only when fever is active", () => {
    expect(FEVER_MULTIPLIER).toBe(2);
    expect(FEVER_DURATION).toBeGreaterThan(0);
    expect(feverPoints(100, false)).toBe(100);
    expect(feverPoints(100, true)).toBe(200);
    expect(feverPoints(0, true)).toBe(0);
  });
});
