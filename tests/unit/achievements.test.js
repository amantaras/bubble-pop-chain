import { describe, it, expect } from "vitest";
import {
  ACHIEVEMENT_CATEGORIES,
  DEFAULT_PROGRESS,
  mergeProgress,
  getCategory,
  categoryStatus,
  claimableCount,
  claimableCategories,
  rollChest,
  CHEST_POWERUPS,
} from "../../src/achievements.js";

// A deterministic rng stub: replays a fixed sequence of [0,1) values, then
// repeats the last one. Lets us pin down rollChest's branches exactly.
function seq(values) {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i += 1;
    return v;
  };
}

describe("achievement categories", () => {
  it("have unique ids, metrics and well-formed escalating tiers", () => {
    const ids = ACHIEVEMENT_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const cat of ACHIEVEMENT_CATEGORIES) {
      expect(typeof cat.id).toBe("string");
      expect(typeof cat.name).toBe("string");
      expect(typeof cat.icon).toBe("string");
      expect(typeof cat.unit).toBe("string");
      expect(cat.metric in DEFAULT_PROGRESS).toBe(true);
      expect(cat.tiers.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < cat.tiers.length; i++) {
        const t = cat.tiers[i];
        expect(t.goal).toBeGreaterThan(0);
        expect(t.coins).toBeGreaterThan(0);
        if (i > 0) {
          // goals and rewards both escalate
          expect(t.goal).toBeGreaterThan(cat.tiers[i - 1].goal);
          expect(t.coins).toBeGreaterThan(cat.tiers[i - 1].coins);
        }
      }
    }
  });

  it("getCategory looks up by id (null for unknown)", () => {
    expect(getCategory("popper").name).toBe("Popper");
    expect(getCategory("nope")).toBe(null);
  });
});

describe("mergeProgress", () => {
  it("sums counters and keeps the max for best-fields, without mutating input", () => {
    const base = { ...DEFAULT_PROGRESS, pops: 3, bestCombo: 4 };
    const next = mergeProgress(base, { pops: 2, bestCombo: 2, biggestGroup: 9 });
    expect(next.pops).toBe(5); // added
    expect(next.bestCombo).toBe(4); // max kept (4 > 2)
    expect(next.biggestGroup).toBe(9); // max from 0
    expect(base.pops).toBe(3); // input untouched
    expect(base.biggestGroup).toBe(0);
  });

  it("fills missing fields from defaults", () => {
    const next = mergeProgress(undefined, { fevers: 1 });
    expect(next.fevers).toBe(1);
    expect(next.pops).toBe(0);
  });
});

describe("categoryStatus", () => {
  const popper = getCategory("popper"); // tiers: 1,100,500,1000,5000

  it("reports the current tier, progress and claimable flag", () => {
    // Fresh player with 0 claims and 0 pops: tier 1, not yet claimable.
    let st = categoryStatus(popper, { pops: 0 }, {});
    expect(st.level).toBe(1);
    expect(st.goal).toBe(1);
    expect(st.claimable).toBe(false);
    expect(st.maxed).toBe(false);

    // Reach the first goal: now claimable.
    st = categoryStatus(popper, { pops: 1 }, {});
    expect(st.claimable).toBe(true);
    expect(st.progress01).toBe(1);

    // After claiming tier 1, the bar tracks the next goal (100).
    st = categoryStatus(popper, { pops: 1 }, { popper: 1 });
    expect(st.level).toBe(2);
    expect(st.goal).toBe(100);
    expect(st.claimable).toBe(false);
    expect(st.progress01).toBeCloseTo(0.01, 5);
  });

  it("clamps progress and reports maxed when every tier is claimed", () => {
    const st = categoryStatus(popper, { pops: 999999 }, { popper: 5 });
    expect(st.maxed).toBe(true);
    expect(st.claimable).toBe(false);
    expect(st.progress01).toBe(1);
  });

  it("does not over-claim past the final tier", () => {
    const st = categoryStatus(popper, { pops: 999999 }, { popper: 99 });
    expect(st.claimed).toBe(popper.tiers.length);
    expect(st.maxed).toBe(true);
  });
});

describe("claimableCount / claimableCategories", () => {
  it("counts and lists exactly the categories with a chest waiting", () => {
    const progress = mergeProgress(DEFAULT_PROGRESS, { pops: 1, fevers: 1 });
    expect(claimableCount(progress, {})).toBe(2);
    const ids = claimableCategories(progress, {});
    expect(ids).toContain("popper");
    expect(ids).toContain("fever");
    // Once popper's first tier is claimed it drops out (next goal is far away).
    expect(claimableCategories(progress, { popper: 1 })).toEqual(["fever"]);
  });

  it("is zero on a fresh, untouched profile", () => {
    expect(claimableCount({ ...DEFAULT_PROGRESS }, {})).toBe(0);
  });
});

describe("rollChest", () => {
  it("always returns the guaranteed tier coins plus a bonus", () => {
    const chest = rollChest(seq([0.5, 0.99, 0.99, 0.99]), {
      tierIndex: 0,
      coins: 100,
    });
    expect(chest.coins).toBe(100);
    expect(chest.bonusCoins).toBeGreaterThanOrEqual(0);
  });

  it("drops a power-up when the tool roll succeeds", () => {
    // rng: bonus=0, tool-roll=0 (<chance), tool-pick=0 (first powerup),
    // double-roll=0.99 (single), pet=0.99 (no pet)
    const chest = rollChest(seq([0, 0, 0, 0.99, 0.99]), {
      tierIndex: 0,
      coins: 50,
    });
    expect(chest.powerups.length).toBe(1);
    expect(CHEST_POWERUPS).toContain(chest.powerups[0].id);
    expect(chest.powerups[0].n).toBe(1);
    expect(chest.petRoll).toBe(false);
  });

  it("can flag a rare pet when the pet roll lands", () => {
    // bonus, tool-roll fail (0.99 > chance), pet roll = 0.001 (<chance)
    const chest = rollChest(seq([0.1, 0.99, 0.001]), {
      tierIndex: 0,
      coins: 30,
    });
    expect(chest.powerups.length).toBe(0);
    expect(chest.petRoll).toBe(true);
  });

  it("is deterministic for the same seeded sequence", () => {
    const values = [0.2, 0.1, 0.3, 0.4, 0.5, 0.6];
    const a = rollChest(seq(values), { tierIndex: 2, coins: 200 });
    const b = rollChest(seq(values), { tierIndex: 2, coins: 200 });
    expect(a).toEqual(b);
  });
});
