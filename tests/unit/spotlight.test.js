import { describe, it, expect, beforeEach } from "vitest";
import { Storage } from "../../src/storage.js";
import { periodKey } from "../../src/rng.js";
import {
  getSpotlightLevel,
  getSpotlightModifier,
  getSpotlightGoals,
  spotlightTiersReached,
  spotlightTierInfo,
  recordSpotlight,
  getSpotlightBest,
  getSpotlightClaimedTiers,
  spotlightDaysLeft,
  currentSpotlightKey,
  SPOTLIGHT_PERIOD_DAYS,
  SPOTLIGHT_MODIFIERS,
  SPOTLIGHT_TIERS,
  SPOTLIGHT_TIER_REWARDS,
} from "../../src/spotlight.js";

const DAY = 86400000;

describe("Spotlight Challenge", () => {
  beforeEach(() => {
    localStorage.clear();
    Storage.reset();
  });

  it("produces the same seeded board for a given rotation", () => {
    const d = new Date(2026, 5, 10);
    expect(getSpotlightLevel(d).seed).toBe(getSpotlightLevel(d).seed);
    expect(getSpotlightLevel(d).key).toBe(periodKey(d, SPOTLIGHT_PERIOD_DAYS));
    expect(getSpotlightLevel(d).id).toBe("spotlight");
  });

  it("shares one board across the whole rotation but changes the next", () => {
    const day0 = new Date(2026, 5, 9); // first day of a 3-day rotation
    const day2 = new Date(day0.getTime() + 2 * DAY); // last day, same rotation
    const nextRotation = new Date(day0.getTime() + 3 * DAY);
    expect(currentSpotlightKey(day0)).toBe(currentSpotlightKey(day2));
    expect(getSpotlightLevel(day0).seed).toBe(getSpotlightLevel(day2).seed);
    expect(currentSpotlightKey(nextRotation)).not.toBe(currentSpotlightKey(day0));
    expect(getSpotlightLevel(nextRotation).seed).not.toBe(getSpotlightLevel(day0).seed);
  });

  it("picks a deterministic modifier from the catalogue", () => {
    const d = new Date(2026, 5, 10);
    const m = getSpotlightModifier(d);
    expect(m).toBe(getSpotlightModifier(d));
    expect(SPOTLIGHT_MODIFIERS.some((x) => x.id === m.id)).toBe(true);
    expect(getSpotlightLevel(d).modifier.id).toBe(m.id);
  });

  it("every modifier applies cleanly to the base board", () => {
    const base = { id: "spotlight", cols: 8, rows: 10, colors: 5, specials: {} };
    for (const m of SPOTLIGHT_MODIFIERS) {
      const out = m.apply({ ...base });
      expect(out.cols).toBeGreaterThan(0);
      expect(out.rows).toBeGreaterThan(0);
      expect(out.colors).toBeGreaterThan(0);
    }
  });

  it("builds an ascending three-tier goal ladder", () => {
    const lvl = getSpotlightLevel(new Date(2026, 5, 10));
    const g = getSpotlightGoals(lvl);
    expect(g.bronze).toBeLessThan(g.silver);
    expect(g.silver).toBeLessThan(g.gold);
  });

  it("maps scores onto the tier ladder", () => {
    const g = { bronze: 100, silver: 200, gold: 300 };
    expect(spotlightTiersReached(g, 0)).toBe(0);
    expect(spotlightTiersReached(g, 100)).toBe(1);
    expect(spotlightTiersReached(g, 250)).toBe(2);
    expect(spotlightTiersReached(g, 999)).toBe(3);
    expect(spotlightTierInfo(0).id).toBe("none");
    expect(spotlightTierInfo(3).id).toBe("gold");
    expect(SPOTLIGHT_TIERS).toHaveLength(4);
  });

  it("records and keeps the highest rotation best", () => {
    const d = new Date(2026, 5, 10);
    let info = recordSpotlight(500, d);
    expect(info.isNewBest).toBe(true);
    expect(info.best).toBe(500);
    expect(info.plays).toBe(1);

    info = recordSpotlight(300, d); // lower — best stays
    expect(info.isNewBest).toBe(false);
    expect(info.best).toBe(500);
    expect(info.prevBest).toBe(500);
    expect(info.plays).toBe(2);

    info = recordSpotlight(800, d); // new high
    expect(info.isNewBest).toBe(true);
    expect(info.best).toBe(800);
    expect(getSpotlightBest(d)).toBe(800);
  });

  it("pays each tier reward exactly once per rotation", () => {
    const d = new Date(2026, 5, 10);
    const goals = getSpotlightGoals(getSpotlightLevel(d));

    // First run crosses bronze only.
    let info = recordSpotlight(goals.bronze, d);
    expect(info.tiersReached).toBe(1);
    expect(info.newlyClaimedTiers).toEqual([1]);
    expect(info.coinsAwarded).toBe(SPOTLIGHT_TIER_REWARDS[0]);
    expect(getSpotlightClaimedTiers(d)).toEqual([1]);

    // Replaying with the same score pays nothing new.
    info = recordSpotlight(goals.bronze, d);
    expect(info.newlyClaimedTiers).toEqual([]);
    expect(info.coinsAwarded).toBe(0);

    // A better run crossing silver AND gold in one jump pays both at once.
    info = recordSpotlight(goals.gold, d);
    expect(info.tiersReached).toBe(3);
    expect(info.newlyClaimedTiers).toEqual([2, 3]);
    expect(info.coinsAwarded).toBe(SPOTLIGHT_TIER_REWARDS[1] + SPOTLIGHT_TIER_REWARDS[2]);
    expect(getSpotlightClaimedTiers(d)).toEqual([1, 2, 3]);

    // Nothing left to pay now — every tier was already reached.
    info = recordSpotlight(goals.gold, d);
    expect(info.newlyClaimedTiers).toEqual([]);
    expect(info.coinsAwarded).toBe(0);
  });

  it("resets the best and claimed tiers when a new rotation starts", () => {
    const d = new Date(2026, 5, 10);
    const goals = getSpotlightGoals(getSpotlightLevel(d));
    recordSpotlight(goals.gold, d);
    expect(getSpotlightBest(d)).toBe(goals.gold);
    expect(getSpotlightClaimedTiers(d)).toEqual([1, 2, 3]);

    const nextRotation = new Date(d.getTime() + SPOTLIGHT_PERIOD_DAYS * DAY);
    expect(getSpotlightBest(nextRotation)).toBe(0); // stale best ignored
    expect(getSpotlightClaimedTiers(nextRotation)).toEqual([]);

    const info = recordSpotlight(120, nextRotation);
    expect(info.best).toBe(120);
    expect(info.periodKey).toBe(currentSpotlightKey(nextRotation));
  });

  it("reports days remaining in the rotation (first day=period length … last day=1)", () => {
    const day0 = new Date(2026, 5, 9);
    const dayLast = new Date(day0.getTime() + (SPOTLIGHT_PERIOD_DAYS - 1) * DAY);
    expect(spotlightDaysLeft(day0)).toBe(SPOTLIGHT_PERIOD_DAYS);
    expect(spotlightDaysLeft(dayLast)).toBe(1);
  });
});
