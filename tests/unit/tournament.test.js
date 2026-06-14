import { describe, it, expect, beforeEach } from "vitest";
import { Storage } from "../../src/storage.js";
import { weekKey } from "../../src/rng.js";
import {
  getTournamentLevel,
  getTournamentModifier,
  getTournamentGoals,
  tournamentRank,
  tournamentRankIndex,
  recordTournament,
  getTournamentBest,
  tournamentDaysLeft,
  currentWeekKey,
  TOURNAMENT_MODIFIERS,
  TOURNAMENT_RANKS,
} from "../../src/tournament.js";

const DAY = 86400000;

describe("weekly tournament", () => {
  beforeEach(() => {
    localStorage.clear();
    Storage.reset();
  });

  it("produces the same seeded board for a given week", () => {
    const d = new Date(2026, 5, 10); // Wednesday
    expect(getTournamentLevel(d).seed).toBe(getTournamentLevel(d).seed);
    expect(getTournamentLevel(d).key).toBe(weekKey(d));
    expect(getTournamentLevel(d).id).toBe("tournament");
  });

  it("shares one board across the whole ISO week but changes the next", () => {
    const mon = new Date(2026, 5, 8); // Monday
    const sun = new Date(2026, 5, 14); // Sunday (same ISO week)
    const nextMon = new Date(2026, 5, 15); // next Monday
    expect(weekKey(mon)).toBe(weekKey(sun));
    expect(getTournamentLevel(mon).seed).toBe(getTournamentLevel(sun).seed);
    expect(weekKey(nextMon)).not.toBe(weekKey(mon));
    expect(getTournamentLevel(nextMon).seed).not.toBe(getTournamentLevel(mon).seed);
  });

  it("formats the week key as ISO YYYY-Www", () => {
    expect(weekKey(new Date(2026, 0, 5))).toMatch(/^\d{4}-W\d{2}$/);
    // Jan 1 2021 is a Friday → still ISO week 53 of 2020.
    expect(weekKey(new Date(2021, 0, 1))).toBe("2020-W53");
    // Jan 4 is always in ISO week 1.
    expect(weekKey(new Date(2026, 0, 4))).toMatch(/-W01$/);
  });

  it("picks a deterministic modifier from the catalogue", () => {
    const d = new Date(2026, 5, 10);
    const m = getTournamentModifier(d);
    expect(m).toBe(getTournamentModifier(d));
    expect(TOURNAMENT_MODIFIERS.some((x) => x.id === m.id)).toBe(true);
    expect(getTournamentLevel(d).modifier.id).toBe(m.id);
  });

  it("every modifier applies cleanly to the base board", () => {
    const base = { id: "tournament", cols: 8, rows: 11, colors: 5, specials: {} };
    for (const m of TOURNAMENT_MODIFIERS) {
      const out = m.apply({ ...base });
      expect(out.cols).toBeGreaterThan(0);
      expect(out.rows).toBeGreaterThan(0);
      expect(out.colors).toBeGreaterThan(0);
    }
  });

  it("builds an ascending four-tier goal ladder", () => {
    const lvl = getTournamentLevel(new Date(2026, 5, 10));
    const g = getTournamentGoals(lvl);
    expect(g.silver).toBeLessThan(g.gold);
    expect(g.gold).toBeLessThan(g.platinum);
    expect(g.platinum).toBeLessThan(g.diamond);
  });

  it("maps scores onto the rank ladder", () => {
    const g = { silver: 100, gold: 200, platinum: 300, diamond: 400 };
    expect(tournamentRankIndex(g, 0)).toBe(0);
    expect(tournamentRankIndex(g, 100)).toBe(1);
    expect(tournamentRankIndex(g, 250)).toBe(2);
    expect(tournamentRankIndex(g, 300)).toBe(3);
    expect(tournamentRankIndex(g, 9999)).toBe(4);
    expect(tournamentRank(g, 0).id).toBe("bronze");
    expect(tournamentRank(g, 9999).id).toBe("diamond");
    expect(TOURNAMENT_RANKS).toHaveLength(5);
  });

  it("records and keeps the highest weekly best", () => {
    const d = new Date(2026, 5, 10);
    let info = recordTournament(500, d);
    expect(info.isNewBest).toBe(true);
    expect(info.best).toBe(500);
    expect(info.plays).toBe(1);

    info = recordTournament(300, d); // lower — best stays
    expect(info.isNewBest).toBe(false);
    expect(info.best).toBe(500);
    expect(info.prevBest).toBe(500);
    expect(info.plays).toBe(2);

    info = recordTournament(800, d); // new high
    expect(info.isNewBest).toBe(true);
    expect(info.best).toBe(800);
    expect(getTournamentBest(d)).toBe(800);
  });

  it("resets the best when a new week starts", () => {
    const d = new Date(2026, 5, 10);
    recordTournament(900, d);
    expect(getTournamentBest(d)).toBe(900);
    const nextWeek = new Date(d.getTime() + 7 * DAY);
    expect(getTournamentBest(nextWeek)).toBe(0); // stale best ignored
    const info = recordTournament(120, nextWeek);
    expect(info.best).toBe(120);
    expect(info.weekKey).toBe(currentWeekKey(nextWeek));
  });

  it("reports days remaining in the ISO week (Mon=7 … Sun=1)", () => {
    expect(tournamentDaysLeft(new Date(2026, 5, 8))).toBe(7); // Monday
    expect(tournamentDaysLeft(new Date(2026, 5, 14))).toBe(1); // Sunday
  });
});
