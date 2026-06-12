import { describe, it, expect } from "vitest";
import {
  SEASON_XP_PER_TIER,
  SEASON_TIERS,
  SEASON_TIER_COUNT,
  SEASON_PREMIUM_PRODUCT,
  tiersUnlocked,
  tierReward,
  canClaim,
  seasonStatus,
  addSeasonXp,
  claimTier,
  unlockPremium,
} from "../../src/season.js";

describe("season — constants", () => {
  it("exposes a 10-tier ladder with free + premium rewards", () => {
    expect(SEASON_TIER_COUNT).toBe(10);
    expect(SEASON_TIERS).toHaveLength(10);
    for (const tier of SEASON_TIERS) {
      expect(tier.free).toBeTruthy();
      expect(tier.premium).toBeTruthy();
    }
    expect(SEASON_PREMIUM_PRODUCT).toBe("season_premium");
    expect(SEASON_XP_PER_TIER).toBe(100);
  });
});

describe("season — tiersUnlocked", () => {
  it("unlocks one tier per full XP threshold and never exceeds the ladder", () => {
    expect(tiersUnlocked(0)).toBe(0);
    expect(tiersUnlocked(99)).toBe(0);
    expect(tiersUnlocked(100)).toBe(1);
    expect(tiersUnlocked(250)).toBe(2);
    expect(tiersUnlocked(99999)).toBe(SEASON_TIER_COUNT);
  });

  it("treats negative/garbage XP as zero", () => {
    expect(tiersUnlocked(-50)).toBe(0);
  });
});

describe("season — tierReward", () => {
  it("returns the right track reward and null for out-of-range", () => {
    expect(tierReward(0, "free")).toEqual({ coins: 30 });
    expect(tierReward(0, "premium")).toEqual({ coins: 80 });
    expect(tierReward(1, "premium")).toEqual({ powerup: "bomb" });
    expect(tierReward(99, "free")).toBeNull();
  });
});

describe("season — canClaim", () => {
  it("only allows unlocked, unclaimed tiers", () => {
    const state = { xp: 150, claimedFree: [], claimedPrem: [], premium: false };
    expect(canClaim(state, 0, "free")).toBe(true); // unlocked
    expect(canClaim(state, 1, "free")).toBe(false); // tier 2 needs 200 xp
  });

  it("gates premium claims behind ownership", () => {
    const free = { xp: 150, premium: false };
    expect(canClaim(free, 0, "premium")).toBe(false);
    const paid = { xp: 150, premium: true };
    expect(canClaim(paid, 0, "premium")).toBe(true);
  });

  it("rejects already-claimed tiers and bad indexes", () => {
    const state = { xp: 300, claimedFree: [0], premium: true, claimedPrem: [1] };
    expect(canClaim(state, 0, "free")).toBe(false);
    expect(canClaim(state, 1, "premium")).toBe(false);
    expect(canClaim(state, -1, "free")).toBe(false);
    expect(canClaim(state, 50, "free")).toBe(false);
  });
});

describe("season — seasonStatus", () => {
  it("reports progress, tier, and claimable counts", () => {
    const st = seasonStatus({ xp: 150, premium: false });
    expect(st.unlocked).toBe(1);
    expect(st.tier).toBe(1);
    expect(st.intoTier).toBe(50);
    expect(st.progress).toBeCloseTo(0.5, 5);
    expect(st.claimableFree).toBe(1);
    expect(st.claimablePremium).toBe(0); // premium not owned
    expect(st.claimable).toBe(1);
  });

  it("counts premium rewards once the pass is owned", () => {
    const st = seasonStatus({ xp: 250, premium: true });
    expect(st.unlocked).toBe(2);
    expect(st.claimableFree).toBe(2);
    expect(st.claimablePremium).toBe(2);
    expect(st.claimable).toBe(4);
  });

  it("clamps progress at the top of the ladder", () => {
    const st = seasonStatus({ xp: 99999, premium: false });
    expect(st.maxed).toBe(true);
    expect(st.progress).toBe(1);
    expect(st.tier).toBe(SEASON_TIER_COUNT - 1);
  });

  it("handles empty/legacy state defensively", () => {
    const st = seasonStatus(undefined);
    expect(st.xp).toBe(0);
    expect(st.unlocked).toBe(0);
    expect(st.claimable).toBe(0);
  });
});

describe("season — addSeasonXp", () => {
  it("accumulates XP without mutating the input", () => {
    const a = { xp: 40, claimedFree: [] };
    const b = addSeasonXp(a, 70);
    expect(b.xp).toBe(110);
    expect(a.xp).toBe(40); // untouched
  });

  it("ignores negative/garbage amounts", () => {
    expect(addSeasonXp({ xp: 10 }, -5).xp).toBe(10);
    expect(addSeasonXp({ xp: 10 }, undefined).xp).toBe(10);
  });
});

describe("season — claimTier", () => {
  it("records a claim and is idempotent", () => {
    const state = { xp: 150, claimedFree: [], premium: false };
    const next = claimTier(state, 0, "free");
    expect(next).toBeTruthy();
    expect(next.claimedFree).toContain(0);
    // Re-claiming the same tier returns null (nothing to grant).
    expect(claimTier(next, 0, "free")).toBeNull();
  });

  it("refuses premium claims until the pass is owned", () => {
    const free = { xp: 150, premium: false };
    expect(claimTier(free, 0, "premium")).toBeNull();
    const paid = unlockPremium(free);
    const next = claimTier(paid, 0, "premium");
    expect(next.claimedPrem).toContain(0);
  });

  it("does not mutate the input state", () => {
    const state = { xp: 150, claimedFree: [] };
    claimTier(state, 0, "free");
    expect(state.claimedFree).toEqual([]);
  });
});

describe("season — unlockPremium", () => {
  it("flips the premium flag without mutating the input", () => {
    const a = { xp: 0, premium: false };
    const b = unlockPremium(a);
    expect(b.premium).toBe(true);
    expect(a.premium).toBe(false);
  });
});
