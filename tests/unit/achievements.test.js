import { describe, it, expect } from "vitest";
import {
  ACHIEVEMENTS,
  DEFAULT_PROGRESS,
  mergeProgress,
  newlyUnlocked,
  getAchievement,
  coinsForAchievements,
} from "../../src/achievements.js";

describe("achievements definitions", () => {
  it("has unique ids and well-formed entries", () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ACHIEVEMENTS) {
      expect(typeof a.id).toBe("string");
      expect(typeof a.name).toBe("string");
      expect(typeof a.desc).toBe("string");
      expect(typeof a.icon).toBe("string");
      expect(a.coins).toBeGreaterThan(0);
      expect(typeof a.test).toBe("function");
    }
  });

  it("getAchievement looks up by id (and returns null for unknown)", () => {
    expect(getAchievement("first_pop").name).toBe("First Pop");
    expect(getAchievement("nope")).toBe(null);
  });
});

describe("mergeProgress", () => {
  it("sums counters and keeps the max for best-fields, without mutating input", () => {
    const base = { ...DEFAULT_PROGRESS, pops: 3, bestCombo: 4 };
    const next = mergeProgress(base, { pops: 2, bestCombo: 2, biggestGroup: 9 });
    expect(next.pops).toBe(5); // added
    expect(next.bestCombo).toBe(4); // max kept (4 > 2)
    expect(next.biggestGroup).toBe(9); // max from 0
    // input untouched
    expect(base.pops).toBe(3);
    expect(base.biggestGroup).toBe(0);
  });

  it("fills missing fields from defaults", () => {
    const next = mergeProgress(undefined, { fevers: 1 });
    expect(next.fevers).toBe(1);
    expect(next.pops).toBe(0);
  });
});

describe("newlyUnlocked", () => {
  it("returns only achievements that pass and are not already held", () => {
    const progress = mergeProgress(DEFAULT_PROGRESS, { pops: 1, fevers: 1 });
    const fresh = newlyUnlocked(progress, []);
    expect(fresh).toContain("first_pop");
    expect(fresh).toContain("fever_1");
    // already-held ones are excluded
    const fresh2 = newlyUnlocked(progress, ["first_pop"]);
    expect(fresh2).not.toContain("first_pop");
    expect(fresh2).toContain("fever_1");
  });

  it("nothing unlocks from a zero progress", () => {
    expect(newlyUnlocked({ ...DEFAULT_PROGRESS }, [])).toEqual([]);
  });

  it("threshold badges fire only at the boundary", () => {
    const below = mergeProgress(DEFAULT_PROGRESS, { bestCombo: 4 });
    expect(newlyUnlocked(below, [])).not.toContain("chain_5");
    const at = mergeProgress(DEFAULT_PROGRESS, { bestCombo: 5 });
    expect(newlyUnlocked(at, [])).toContain("chain_5");
  });
});

describe("coinsForAchievements", () => {
  it("sums payouts and ignores unknown ids", () => {
    const a = getAchievement("first_pop").coins;
    const b = getAchievement("fever_1").coins;
    expect(coinsForAchievements(["first_pop", "fever_1"])).toBe(a + b);
    expect(coinsForAchievements(["first_pop", "bogus"])).toBe(a);
    expect(coinsForAchievements([])).toBe(0);
  });
});
