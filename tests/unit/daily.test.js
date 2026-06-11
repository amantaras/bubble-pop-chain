import { describe, it, expect, beforeEach } from "vitest";
import { Storage } from "../../src/storage.js";
import {
  getDailyLevel,
  recordDaily,
  alreadyPlayedToday,
  getStreak,
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
    recordDaily(1000, today);
    expect(alreadyPlayedToday(today)).toBe(true);
    expect(getStreak()).toBe(1);
  });

  it("continues the streak on consecutive days", () => {
    const d1 = new Date(2026, 5, 11);
    const d2 = new Date(d1.getTime() + DAY);
    const d3 = new Date(d1.getTime() + 2 * DAY);
    expect(recordDaily(100, d1).streak).toBe(1);
    expect(recordDaily(100, d2).streak).toBe(2);
    expect(recordDaily(100, d3).streak).toBe(3);
  });

  it("resets the streak after a missed day", () => {
    const d1 = new Date(2026, 5, 11);
    const skipped = new Date(d1.getTime() + 2 * DAY);
    recordDaily(100, d1);
    const res = recordDaily(100, skipped);
    expect(res.streak).toBe(1);
  });

  it("same-day replay keeps the best score and does not bump the streak", () => {
    const d1 = new Date(2026, 5, 11);
    recordDaily(500, d1);
    const res = recordDaily(900, d1);
    expect(res.isNew).toBe(false);
    expect(res.streak).toBe(1);
    expect(Storage.get("daily").lastScore).toBe(900);
  });

  it("tracks the best streak ever", () => {
    const d1 = new Date(2026, 5, 11);
    const d2 = new Date(d1.getTime() + DAY);
    recordDaily(1, d1);
    const r = recordDaily(1, d2);
    expect(r.bestStreak).toBeGreaterThanOrEqual(2);
  });
});
