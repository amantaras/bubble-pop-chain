import { describe, it, expect, beforeEach } from "vitest";
import { Storage } from "../../src/storage.js";
import {
  getDailyLevel,
  recordDaily,
  alreadyPlayedToday,
  getStreak,
  getDailyModifier,
  getDailyGoals,
  dailyStarsForScore,
  rewardForStreak,
  getFreezeTokens,
  DAILY_MODIFIERS,
} from "../../src/daily.js";

const DAY = 86400000;

describe("daily challenge", () => {
  beforeEach(() => {
    localStorage.clear();
    Storage.reset();
  });

  it("produces the same seeded board for a given day", () => {
    const d = new Date(2026, 5, 11);
    expect(getDailyLevel(d).seed).toBe(getDailyLevel(d).seed);
    expect(getDailyLevel(d).key).toBe("2026-06-11");
  });

  it("produces a different board on a different day", () => {
    const a = getDailyLevel(new Date(2026, 5, 11));
    const b = getDailyLevel(new Date(2026, 5, 12));
    expect(a.seed).not.toBe(b.seed);
  });

  it("starts with no play recorded and zero streak", () => {
    expect(alreadyPlayedToday(new Date(2026, 5, 11))).toBe(false);
    expect(getStreak()).toBe(0);
  });

  it("recording marks today as played", () => {
    const today = new Date(2026, 5, 11);
    recordDaily(1000, 0, today);
    expect(alreadyPlayedToday(today)).toBe(true);
    expect(getStreak()).toBe(1);
  });

  it("continues the streak on consecutive days", () => {
    const d1 = new Date(2026, 5, 11);
    const d2 = new Date(d1.getTime() + DAY);
    const d3 = new Date(d1.getTime() + 2 * DAY);
    expect(recordDaily(100, 0, d1).streak).toBe(1);
    expect(recordDaily(100, 0, d2).streak).toBe(2);
    expect(recordDaily(100, 0, d3).streak).toBe(3);
  });

  it("resets the streak after a missed day", () => {
    const d1 = new Date(2026, 5, 11);
    const skipped = new Date(d1.getTime() + 2 * DAY);
    recordDaily(100, 0, d1);
    const res = recordDaily(100, 0, skipped);
    expect(res.streak).toBe(1);
  });

  it("same-day replay keeps the best score and does not bump the streak", () => {
    const d1 = new Date(2026, 5, 11);
    recordDaily(500, 0, d1);
    const res = recordDaily(900, 0, d1);
    expect(res.isNew).toBe(false);
    expect(res.streak).toBe(1);
    expect(Storage.get("daily").lastScore).toBe(900);
  });

  it("tracks the best streak ever", () => {
    const d1 = new Date(2026, 5, 11);
    const d2 = new Date(d1.getTime() + DAY);
    recordDaily(1, 0, d1);
    const r = recordDaily(1, 0, d2);
    expect(r.bestStreak).toBeGreaterThanOrEqual(2);
  });
});

describe("daily retention engine", () => {
  beforeEach(() => {
    localStorage.clear();
    Storage.reset();
  });

  it("picks a deterministic modifier from the day's key", () => {
    const d = new Date(2026, 5, 11);
    const a = getDailyModifier(d);
    const b = getDailyModifier(d);
    expect(a.id).toBe(b.id);
    expect(DAILY_MODIFIERS.some((m) => m.id === a.id)).toBe(true);
    // The modifier is baked into the daily level config.
    expect(getDailyLevel(d).modifier.id).toBe(a.id);
  });

  it("daily goals rise across tiers and map to 0..3 stars", () => {
    const level = getDailyLevel(new Date(2026, 5, 11));
    const g = getDailyGoals(level);
    expect(g.one).toBeLessThan(g.two);
    expect(g.two).toBeLessThan(g.three);
    expect(dailyStarsForScore(g, 0)).toBe(0);
    expect(dailyStarsForScore(g, g.one)).toBe(1);
    expect(dailyStarsForScore(g, g.two)).toBe(2);
    expect(dailyStarsForScore(g, g.three)).toBe(3);
  });

  it("reward cycles weekly and day 7 grants a freeze token", () => {
    expect(rewardForStreak(1).coins).toBeGreaterThan(0);
    expect(rewardForStreak(7).freeze).toBe(true);
    expect(rewardForStreak(8).coins).toBe(rewardForStreak(1).coins); // cycles
    expect(rewardForStreak(7).coins).toBeGreaterThan(rewardForStreak(1).coins);
  });

  it("awards the streak reward and a freeze token on day 7", () => {
    const start = new Date(2026, 5, 1);
    let res;
    for (let i = 0; i < 7; i++) {
      res = recordDaily(100, 0, new Date(start.getTime() + i * DAY));
    }
    expect(res.streak).toBe(7);
    expect(res.freezeAwarded).toBe(true);
    expect(getFreezeTokens()).toBe(1);
    expect(res.coins).toBe(rewardForStreak(7).coins);
  });

  it("a freeze token rescues a single missed day", () => {
    const start = new Date(2026, 5, 1);
    // Build a 7-day streak to earn one freeze token.
    for (let i = 0; i < 7; i++) {
      recordDaily(100, 0, new Date(start.getTime() + i * DAY));
    }
    expect(getFreezeTokens()).toBe(1);
    // Skip exactly one day (day index 8 missed), play on day index 9.
    const rescued = recordDaily(100, 0, new Date(start.getTime() + 8 * DAY));
    expect(rescued.usedFreeze).toBe(true);
    expect(rescued.streak).toBe(8); // streak preserved
    expect(getFreezeTokens()).toBe(0); // token consumed
  });

  it("records best daily stars", () => {
    const d1 = new Date(2026, 5, 11);
    recordDaily(5000, 2, d1);
    recordDaily(9000, 3, d1); // same-day replay keeps the best
    expect(Storage.get("daily").bestStars).toBe(3);
  });
});
