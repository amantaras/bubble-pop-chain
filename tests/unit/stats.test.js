import { describe, it, expect } from "vitest";
import {
  formatStat,
  lifetimeStats,
  profileStats,
  buildStats,
} from "../../src/stats.js";

describe("stats / profile dashboard", () => {
  it("formats integers with thousands separators", () => {
    expect(formatStat(0)).toBe("0");
    expect(formatStat(42)).toBe("42");
    expect(formatStat(1000)).toBe("1,000");
    expect(formatStat(1234567)).toBe("1,234,567");
  });

  it("clamps and rounds non-integer or negative inputs", () => {
    expect(formatStat(-5)).toBe("0");
    expect(formatStat(12.7)).toBe("13");
    expect(formatStat(undefined)).toBe("0");
    expect(formatStat(null)).toBe("0");
  });

  it("surfaces lifetime totals from achievement progress", () => {
    const save = {
      achievements: {
        progress: {
          pops: 1234,
          bestCombo: 9,
          biggestGroup: 14,
          fevers: 7,
          levelsCleared: 12,
          totalStars: 30,
          defuses: 4,
          coinsEarned: 8888,
        },
      },
    };
    const rows = lifetimeStats(save);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(byKey.pops).toBe(1234);
    expect(byKey.bestCombo).toBe(9);
    expect(byKey.biggestGroup).toBe(14);
    expect(byKey.coinsEarned).toBe(8888);
    // Every row has an icon + label for rendering.
    rows.forEach((r) => {
      expect(typeof r.icon).toBe("string");
      expect(r.label.length).toBeGreaterThan(0);
    });
  });

  it("defaults lifetime totals to zero for an empty save", () => {
    const rows = lifetimeStats({});
    expect(rows).toHaveLength(8);
    rows.forEach((r) => expect(r.value).toBe(0));
  });

  it("builds the profile snapshot from current state", () => {
    const save = {
      maxUnlockedLevel: 23,
      coins: 540,
      highScoreEndless: 9100,
      highScoreTimeAttack: 4200,
      ownedThemes: ["aurora", "sunset", "mono"],
      pets: { owned: { sparky: {}, rover: {}, comet: {} } },
      daily: { streak: 4, bestStreak: 11 },
    };
    const rows = profileStats(save);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(byKey.levelReached).toBe(23);
    expect(byKey.coins).toBe(540);
    expect(byKey.endlessBest).toBe(9100);
    expect(byKey.timeAttackBest).toBe(4200);
    expect(byKey.pets).toBe(3);
    expect(byKey.themes).toBe(3);
    expect(byKey.streak).toBe(4);
    expect(byKey.bestStreak).toBe(11);
  });

  it("uses safe defaults for a brand-new profile", () => {
    const rows = profileStats({});
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(byKey.levelReached).toBe(1); // never below level 1
    expect(byKey.coins).toBe(0);
    expect(byKey.pets).toBe(0);
    expect(byKey.themes).toBe(0);
    expect(byKey.streak).toBe(0);
  });

  it("buildStats returns both sections in render order", () => {
    const data = buildStats({});
    expect(data.profile).toHaveLength(8);
    expect(data.lifetime).toHaveLength(8);
  });
});
