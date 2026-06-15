import { describe, it, expect } from "vitest";
import {
  DAILY_QUESTS,
  WEEKLY_QUESTS,
  DAILY_COUNT,
  WEEKLY_COUNT,
  questDef,
  ensureQuests,
  applyQuestProgress,
  isQuestComplete,
  isQuestClaimable,
  claimQuest,
  questsClaimable,
} from "../../src/quests.js";

describe("quests", () => {
  it("looks up a quest template by id and returns null for unknown ids", () => {
    expect(questDef("d_pop150")).toMatchObject({ metric: "bubbles", goal: 150 });
    expect(questDef("nope")).toBe(null);
  });

  it("rolls the configured number of distinct daily and weekly quests", () => {
    const s = ensureQuests(null, "2026-01-02", "2026-W01");
    expect(s.daily).toHaveLength(DAILY_COUNT);
    expect(s.weekly).toHaveLength(WEEKLY_COUNT);
    const ids = s.daily.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    s.daily.forEach((e) =>
      expect(DAILY_QUESTS.some((q) => q.id === e.id)).toBe(true)
    );
    s.weekly.forEach((e) =>
      expect(WEEKLY_QUESTS.some((q) => q.id === e.id)).toBe(true)
    );
  });

  it("is deterministic for a given day/week key", () => {
    const a = ensureQuests(null, "2026-03-10", "2026-W11");
    const b = ensureQuests(null, "2026-03-10", "2026-W11");
    expect(a.daily.map((e) => e.id)).toEqual(b.daily.map((e) => e.id));
    expect(a.weekly.map((e) => e.id)).toEqual(b.weekly.map((e) => e.id));
  });

  it("rerolls daily quests on a day change but keeps the weekly within the week", () => {
    const day1 = ensureQuests(null, "2026-01-05", "2026-W02");
    // Make progress so we can prove the reroll resets it.
    day1.daily[0].progress = 999;
    const day2 = ensureQuests(day1, "2026-01-06", "2026-W02");
    expect(day2.daily.every((e) => e.progress === 0)).toBe(true);
    // Same week → weekly entries are untouched (same ids, preserved progress).
    expect(day2.weekly.map((e) => e.id)).toEqual(day1.weekly.map((e) => e.id));
  });

  it("rerolls the weekly quest on a week change", () => {
    const w1 = ensureQuests(null, "2026-01-05", "2026-W02");
    w1.weekly[0].progress = 50;
    const w2 = ensureQuests(w1, "2026-01-12", "2026-W03");
    expect(w2.weekly.every((e) => e.progress === 0)).toBe(true);
  });

  it("accumulates count-mode progress and tracks max-mode progress", () => {
    let state = {
      dayKey: "d",
      weekKey: "w",
      daily: [
        { id: "d_pop150", progress: 0, claimed: false },
        { id: "d_combo5", progress: 0, claimed: false },
      ],
      weekly: [],
    };
    ({ state } = applyQuestProgress(state, { bubbles: 40, combo: 3 }));
    ({ state } = applyQuestProgress(state, { bubbles: 30, combo: 2 }));
    expect(state.daily[0].progress).toBe(70); // count: 40 + 30
    expect(state.daily[1].progress).toBe(3); // max: max(3, 2)
  });

  it("caps progress at the goal and reports newly-complete quests once", () => {
    let state = {
      dayKey: "d",
      weekKey: "w",
      daily: [{ id: "d_pop150", progress: 140, claimed: false }],
      weekly: [],
    };
    let res = applyQuestProgress(state, { bubbles: 100 });
    expect(res.state.daily[0].progress).toBe(150); // capped at goal
    expect(res.newlyComplete).toBe(1);
    // Already complete → no further newlyComplete events.
    res = applyQuestProgress(res.state, { bubbles: 50 });
    expect(res.newlyComplete).toBe(0);
  });

  it("treats a completed unclaimed quest as claimable", () => {
    const done = { id: "d_pop150", progress: 150, claimed: false };
    const partial = { id: "d_pop150", progress: 10, claimed: false };
    const taken = { id: "d_pop150", progress: 150, claimed: true };
    expect(isQuestComplete(done)).toBe(true);
    expect(isQuestClaimable(done)).toBe(true);
    expect(isQuestClaimable(partial)).toBe(false);
    expect(isQuestClaimable(taken)).toBe(false);
  });

  it("claims a completed quest and refuses to claim it twice", () => {
    const state = {
      dayKey: "d",
      weekKey: "w",
      daily: [{ id: "d_pop150", progress: 150, claimed: false }],
      weekly: [],
    };
    const res = claimQuest(state, "daily", 0);
    expect(res).not.toBe(null);
    expect(res.reward).toEqual({ coins: 60 });
    expect(res.state.daily[0].claimed).toBe(true);
    // Re-claim on the new state returns null.
    expect(claimQuest(res.state, "daily", 0)).toBe(null);
  });

  it("returns null when claiming an incomplete quest", () => {
    const state = {
      dayKey: "d",
      weekKey: "w",
      daily: [{ id: "d_pop150", progress: 10, claimed: false }],
      weekly: [],
    };
    expect(claimQuest(state, "daily", 0)).toBe(null);
  });

  it("counts how many quests are ready to claim", () => {
    const state = {
      dayKey: "d",
      weekKey: "w",
      daily: [
        { id: "d_pop150", progress: 150, claimed: false },
        { id: "d_combo5", progress: 5, claimed: false },
        { id: "d_fever2", progress: 1, claimed: false },
      ],
      weekly: [{ id: "w_win15", progress: 15, claimed: false }],
    };
    expect(questsClaimable(state)).toBe(3);
    expect(questsClaimable(null)).toBe(0);
  });

  it("never mutates the input state", () => {
    const state = {
      dayKey: "d",
      weekKey: "w",
      daily: [{ id: "d_pop150", progress: 0, claimed: false }],
      weekly: [],
    };
    const snapshot = JSON.stringify(state);
    applyQuestProgress(state, { bubbles: 50 });
    claimQuest(
      { ...state, daily: [{ id: "d_pop150", progress: 150, claimed: false }] },
      "daily",
      0
    );
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
