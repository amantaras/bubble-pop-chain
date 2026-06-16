import { describe, it, expect } from "vitest";
import {
  TECH_TREE,
  TECH_NODE_IDS,
  MAX_TECH_TIERS,
  techTierAt,
  techTierOptions,
  techNode,
  techTierOf,
  techTiersUnlocked,
  pendingTechTier,
  hasPendingTech,
  canPickTech,
  techBuffs,
  techActiveMods,
} from "../../src/tech.js";

describe("tech tree — structure", () => {
  it("has MAX_TECH_TIERS tiers, each with exactly two options", () => {
    expect(TECH_TREE).toHaveLength(MAX_TECH_TIERS);
    expect(MAX_TECH_TIERS).toBe(4);
    for (const tier of TECH_TREE) {
      expect(tier.options).toHaveLength(2);
    }
  });

  it("tiers unlock at strictly increasing levels 2..5", () => {
    const mins = TECH_TREE.map((t) => t.minLevel);
    expect(mins).toEqual([2, 3, 4, 5]);
  });

  it("has unique node ids across the whole tree", () => {
    const set = new Set(TECH_NODE_IDS);
    expect(set.size).toBe(TECH_NODE_IDS.length);
    expect(TECH_NODE_IDS.length).toBe(MAX_TECH_TIERS * 2);
  });

  it("every node carries icon, name, desc and a non-empty mods object", () => {
    for (const id of TECH_NODE_IDS) {
      const node = techNode(id);
      expect(node).toBeTruthy();
      expect(typeof node.icon).toBe("string");
      expect(node.name.length).toBeGreaterThan(0);
      expect(node.desc.length).toBeGreaterThan(0);
      expect(Object.keys(node.mods).length).toBeGreaterThan(0);
    }
  });

  it("techNode returns null for unknown ids", () => {
    expect(techNode("nope")).toBeNull();
  });

  it("techTierOf maps a node to its 0-based tier (and -1 for unknown)", () => {
    expect(techTierOf("t1_power")).toBe(0);
    expect(techTierOf("t4_mastery")).toBe(3);
    expect(techTierOf("missing")).toBe(-1);
  });

  it("techTierAt / techTierOptions expose tier data by index", () => {
    expect(techTierAt(0).tier).toBe(1);
    expect(techTierAt(99)).toBeNull();
    expect(techTierOptions(1).map((o) => o.id)).toEqual(["t2_charge", "t2_frenzy"]);
    expect(techTierOptions(99)).toEqual([]);
  });
});

describe("tech tree — unlock + pending logic", () => {
  it("techTiersUnlocked counts tiers whose minLevel <= level", () => {
    expect(techTiersUnlocked(1)).toBe(0);
    expect(techTiersUnlocked(2)).toBe(1);
    expect(techTiersUnlocked(3)).toBe(2);
    expect(techTiersUnlocked(4)).toBe(3);
    expect(techTiersUnlocked(5)).toBe(4);
    expect(techTiersUnlocked(99)).toBe(4);
  });

  it("pendingTechTier is the first unlocked tier with no chosen node", () => {
    expect(pendingTechTier([], 1)).toBe(-1); // nothing unlocked yet
    expect(pendingTechTier([], 2)).toBe(0); // tier 0 unlocked, unpicked
    expect(pendingTechTier(["t1_power"], 2)).toBe(-1); // tier 0 picked, tier1 locked
    expect(pendingTechTier(["t1_power"], 3)).toBe(1); // tier1 now unlocked
    expect(pendingTechTier(["t1_power", "t2_frenzy"], 5)).toBe(2);
  });

  it("hasPendingTech mirrors pendingTechTier", () => {
    expect(hasPendingTech([], 1)).toBe(false);
    expect(hasPendingTech([], 2)).toBe(true);
    expect(hasPendingTech(["t1_fortune"], 2)).toBe(false);
  });

  it("canPickTech only allows a node in the currently-pending tier", () => {
    // At Lv.2, tier 0 is pending.
    expect(canPickTech([], "t1_power", 2)).toBe(true);
    expect(canPickTech([], "t1_fortune", 2)).toBe(true);
    // Can't skip ahead to a locked tier.
    expect(canPickTech([], "t2_charge", 2)).toBe(false);
    // Can't re-pick a tier already chosen.
    expect(canPickTech(["t1_power"], "t1_fortune", 3)).toBe(false);
    // After picking tier 0, tier 1 becomes pickable at Lv.3.
    expect(canPickTech(["t1_power"], "t2_charge", 3)).toBe(true);
    // Unknown node never pickable.
    expect(canPickTech([], "ghost", 2)).toBe(false);
  });
});

describe("tech tree — buff aggregation", () => {
  it("techBuffs is neutral for no chosen nodes", () => {
    expect(techBuffs([])).toEqual({
      scoreMult: 1,
      coinMult: 1,
      powerMult: 1,
      feverMult: 1,
      startCharge: 0,
    });
    expect(techBuffs(undefined)).toEqual({
      scoreMult: 1,
      coinMult: 1,
      powerMult: 1,
      feverMult: 1,
      startCharge: 0,
    });
  });

  it("techBuffs sums passive deltas as 1 + total per axis", () => {
    // t1_power +6% score, t1_fortune +8% coins
    const b = techBuffs(["t1_power", "t1_fortune"]);
    expect(b.scoreMult).toBeCloseTo(1.06, 6);
    expect(b.coinMult).toBeCloseTo(1.08, 6);
  });

  it("t4_overdrive lifts all four passive axes by 10%", () => {
    const b = techBuffs(["t4_overdrive"]);
    expect(b.scoreMult).toBeCloseTo(1.1, 6);
    expect(b.coinMult).toBeCloseTo(1.1, 6);
    expect(b.powerMult).toBeCloseTo(1.1, 6);
    expect(b.feverMult).toBeCloseTo(1.1, 6);
  });

  it("techBuffs ignores unknown node ids", () => {
    expect(techBuffs(["ghost", "t1_power"]).scoreMult).toBeCloseTo(1.06, 6);
  });

  it("techActiveMods is neutral for no chosen nodes", () => {
    expect(techActiveMods([])).toEqual({
      cooldownDelta: 0,
      countDelta: 0,
      strengthMult: 1,
    });
  });

  it("techActiveMods sums cooldown/count and multiplies strength", () => {
    // t3_haste cooldownDelta -1 ; t4_mastery countDelta +1, strengthMult 1.15
    const m = techActiveMods(["t3_haste", "t4_mastery"]);
    expect(m.cooldownDelta).toBe(-1);
    expect(m.countDelta).toBe(1);
    expect(m.strengthMult).toBeCloseTo(1.15, 6);
  });
});
