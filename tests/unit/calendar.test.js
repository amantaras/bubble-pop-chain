import { describe, it, expect } from "vitest";
import {
  CALENDAR_REWARDS,
  CALENDAR_CYCLE,
  calendarStatus,
  advanceCalendar,
} from "../../src/calendar.js";

describe("calendar rewards table", () => {
  it("has a 7-day cycle", () => {
    expect(CALENDAR_CYCLE).toBe(7);
    expect(CALENDAR_REWARDS).toHaveLength(7);
  });

  it("every day grants something", () => {
    CALENDAR_REWARDS.forEach((r) => {
      expect(r.coins || r.powerup || r.crate).toBeTruthy();
    });
  });

  it("day 7 is the grand prize with coins and a crate", () => {
    const grand = CALENDAR_REWARDS[6];
    expect(grand.crate).toBeGreaterThan(0);
    expect(grand.coins).toBeGreaterThan(0);
  });
});

describe("calendarStatus", () => {
  it("a fresh save is claimable on day 0 (reward index 0)", () => {
    const st = calendarStatus({ lastClaim: null, day: 0 }, "2024-01-01");
    expect(st.claimable).toBe(true);
    expect(st.index).toBe(0);
    expect(st.reward).toBe(CALENDAR_REWARDS[0]);
    expect(st.day).toBe(0);
  });

  it("is not claimable again the same day", () => {
    const st = calendarStatus({ lastClaim: "2024-01-01", day: 1 }, "2024-01-01");
    expect(st.claimable).toBe(false);
    expect(st.claimedToday).toBe(true);
  });

  it("becomes claimable on the next day", () => {
    const st = calendarStatus({ lastClaim: "2024-01-01", day: 1 }, "2024-01-02");
    expect(st.claimable).toBe(true);
    expect(st.index).toBe(1);
    expect(st.reward).toBe(CALENDAR_REWARDS[1]);
  });

  it("wraps the reward index after a full cycle", () => {
    const st = calendarStatus({ lastClaim: "2024-01-07", day: 7 }, "2024-01-08");
    expect(st.index).toBe(0);
    expect(st.reward).toBe(CALENDAR_REWARDS[0]);
  });

  it("handles a missing/undefined state", () => {
    const st = calendarStatus(undefined, "2024-01-01");
    expect(st.claimable).toBe(true);
    expect(st.index).toBe(0);
  });
});

describe("advanceCalendar", () => {
  it("increments the day count and stamps the claim key", () => {
    const next = advanceCalendar({ lastClaim: null, day: 0 }, "2024-01-01");
    expect(next).toEqual({ lastClaim: "2024-01-01", day: 1 });
  });

  it("after claiming, status reports not claimable that day", () => {
    let state = { lastClaim: null, day: 0 };
    state = advanceCalendar(state, "2024-01-01");
    const st = calendarStatus(state, "2024-01-01");
    expect(st.claimable).toBe(false);
  });

  it("supports a full week walk-through across distinct days", () => {
    let state = { lastClaim: null, day: 0 };
    for (let i = 0; i < 7; i++) {
      const key = `2024-01-0${i + 1}`;
      const st = calendarStatus(state, key);
      expect(st.claimable).toBe(true);
      expect(st.index).toBe(i);
      state = advanceCalendar(state, key);
    }
    expect(state.day).toBe(7);
    // Day 8 wraps to reward index 0 again.
    const wrap = calendarStatus(state, "2024-01-08");
    expect(wrap.index).toBe(0);
  });
});
