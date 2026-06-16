import { describe, it, expect } from "vitest";
import {
  MAX_SOCKETS,
  GEM_TIERS,
  GEM_CATALOG,
  GEM_DUST_COST,
  GEM_TIER_WEIGHTS,
  socketsForLevel,
  getGemDef,
  getGemTier,
  gemKey,
  parseGemKey,
  gemLabel,
  gemIcon,
  gemValue,
  socketBuffs,
  socketActiveMods,
  gemDustCost,
  rollGem,
  GEM_TIER_MIN_LEVEL,
  gemTierIndex,
  levelForGemTier,
  maxGemTierForLevel,
  canSocketGemAtLevel,
  SOCKET_DUST_COST,
  socketDustCost,
  UNSOCKET_REFUND_RATIO,
  unsocketDustRefund,
  gemBuffLabel,
  FUSE_COUNT,
  nextGemTier,
  prevGemTier,
  canFuseTier,
  fusedGemKey,
} from "../../src/gems.js";
import { makeRng } from "../../src/rng.js";

describe("gems — catalog & tiers", () => {
  it("has 3 ordered tiers with ascending multipliers", () => {
    expect(GEM_TIERS).toHaveLength(3);
    expect(GEM_TIERS.map((t) => t.id)).toEqual(["chipped", "polished", "brilliant"]);
    expect(GEM_TIERS[0].mult).toBe(1);
    expect(GEM_TIERS[1].mult).toBe(2);
    expect(GEM_TIERS[2].mult).toBe(3);
  });

  it("has 6 gems each with a distinct type and buff key", () => {
    expect(GEM_CATALOG).toHaveLength(6);
    const types = GEM_CATALOG.map((g) => g.type);
    expect(new Set(types).size).toBe(6);
    for (const g of GEM_CATALOG) {
      expect(typeof g.buff.key).toBe("string");
      expect(typeof g.buff.per).toBe("number");
      expect(typeof g.icon).toBe("string");
      expect(typeof g.color).toBe("string");
    }
  });

  it("MAX_SOCKETS is 2", () => {
    expect(MAX_SOCKETS).toBe(2);
  });
});

describe("gems — socketsForLevel", () => {
  it("unlocks sockets at level 2 then 4", () => {
    expect(socketsForLevel(1)).toBe(0);
    expect(socketsForLevel(2)).toBe(1);
    expect(socketsForLevel(3)).toBe(1);
    expect(socketsForLevel(4)).toBe(2);
    expect(socketsForLevel(5)).toBe(2);
  });

  it("is clamped for junk input", () => {
    expect(socketsForLevel(0)).toBe(0);
    expect(socketsForLevel(undefined)).toBe(0);
    expect(socketsForLevel(-3)).toBe(0);
  });
});

describe("gems — tier level-gating", () => {
  it("gemTierIndex maps tiers to the weakest→strongest ladder", () => {
    expect(gemTierIndex("chipped")).toBe(0);
    expect(gemTierIndex("polished")).toBe(1);
    expect(gemTierIndex("brilliant")).toBe(2);
    expect(gemTierIndex("bogus")).toBe(0); // falls back to lowest tier
  });

  it("levelForGemTier requires a higher level for stronger tiers", () => {
    expect(levelForGemTier("chipped")).toBe(GEM_TIER_MIN_LEVEL.chipped);
    expect(levelForGemTier("polished")).toBe(GEM_TIER_MIN_LEVEL.polished);
    expect(levelForGemTier("brilliant")).toBe(GEM_TIER_MIN_LEVEL.brilliant);
    expect(levelForGemTier("chipped")).toBeLessThan(levelForGemTier("polished"));
    expect(levelForGemTier("polished")).toBeLessThan(levelForGemTier("brilliant"));
  });

  it("maxGemTierForLevel widens the allowed tier as a pet levels up", () => {
    expect(maxGemTierForLevel(1)).toBe(-1); // no sockets yet
    expect(maxGemTierForLevel(2)).toBe(0); // chipped only
    expect(maxGemTierForLevel(3)).toBe(0);
    expect(maxGemTierForLevel(4)).toBe(1); // up to polished
    expect(maxGemTierForLevel(5)).toBe(2); // up to brilliant
  });

  it("tier unlock tracks socket unlock (first socket = chipped)", () => {
    // Wherever a pet first has a socket it can hold at least the lowest tier.
    for (let lvl = 1; lvl <= 6; lvl++) {
      if (socketsForLevel(lvl) > 0) expect(maxGemTierForLevel(lvl)).toBeGreaterThanOrEqual(0);
      else expect(maxGemTierForLevel(lvl)).toBe(-1);
    }
  });

  it("canSocketGemAtLevel gates a too-strong gem on a low-level pet", () => {
    expect(canSocketGemAtLevel("ruby:chipped", 2)).toBe(true);
    expect(canSocketGemAtLevel("ruby:polished", 2)).toBe(false);
    expect(canSocketGemAtLevel("ruby:brilliant", 2)).toBe(false);
    expect(canSocketGemAtLevel("ruby:polished", 4)).toBe(true);
    expect(canSocketGemAtLevel("ruby:brilliant", 4)).toBe(false);
    expect(canSocketGemAtLevel("ruby:brilliant", 5)).toBe(true);
  });

  it("canSocketGemAtLevel rejects gems on a socketless level-1 pet and junk keys", () => {
    expect(canSocketGemAtLevel("ruby:chipped", 1)).toBe(false);
    expect(canSocketGemAtLevel("not-a-gem", 5)).toBe(false);
    expect(canSocketGemAtLevel("", 5)).toBe(false);
  });
});

describe("gems — keys & lookups", () => {
  it("composes and parses a type:tier key", () => {
    const k = gemKey("ruby", "brilliant");
    expect(k).toBe("ruby:brilliant");
    const p = parseGemKey(k);
    expect(p.type).toBe("ruby");
    expect(p.tier).toBe("brilliant");
    expect(p.def.name).toBe("Ruby");
  });

  it("parseGemKey returns null for bad input", () => {
    expect(parseGemKey("nope")).toBeNull();
    expect(parseGemKey("unknown:chipped")).toBeNull();
    expect(parseGemKey(null)).toBeNull();
  });

  it("getGemTier falls back to the lowest tier", () => {
    expect(getGemTier("garbage").id).toBe("chipped");
    expect(getGemTier("polished").id).toBe("polished");
  });

  it("getGemDef resolves a known gem or null", () => {
    expect(getGemDef("emerald").name).toBe("Emerald");
    expect(getGemDef("nope")).toBeNull();
  });

  it("gemLabel and gemIcon read a key", () => {
    expect(gemLabel("ruby:brilliant")).toBe("Brilliant Ruby");
    expect(gemIcon("ruby:chipped")).toBe("🔴");
    expect(gemLabel("bad")).toBe("");
  });

  it("gemValue is base per × tier multiplier", () => {
    // ruby per=0.04
    expect(gemValue("ruby:chipped")).toBeCloseTo(0.04, 5);
    expect(gemValue("ruby:polished")).toBeCloseTo(0.08, 5);
    expect(gemValue("ruby:brilliant")).toBeCloseTo(0.12, 5);
    expect(gemValue("bad")).toBe(0);
  });
});

describe("gems — socketBuffs (passive aggregation)", () => {
  it("returns neutral buffs for no sockets", () => {
    const b = socketBuffs([]);
    expect(b).toEqual({ scoreMult: 1, coinMult: 1, powerMult: 1, feverMult: 1, startCharge: 0 });
  });

  it("a ruby raises scoreMult only", () => {
    const b = socketBuffs(["ruby:polished"]);
    expect(b.scoreMult).toBeCloseTo(1.08, 5);
    expect(b.coinMult).toBe(1);
  });

  it("a diamond boosts all four passive axes (allMult)", () => {
    const b = socketBuffs(["diamond:chipped"]);
    expect(b.scoreMult).toBeCloseTo(1.02, 5);
    expect(b.coinMult).toBeCloseTo(1.02, 5);
    expect(b.powerMult).toBeCloseTo(1.02, 5);
    expect(b.feverMult).toBeCloseTo(1.02, 5);
  });

  it("an emerald (active-only) contributes nothing to passive buffs", () => {
    const b = socketBuffs(["emerald:brilliant"]);
    expect(b).toEqual({ scoreMult: 1, coinMult: 1, powerMult: 1, feverMult: 1, startCharge: 0 });
  });

  it("stacks two gems", () => {
    const b = socketBuffs(["ruby:chipped", "citrine:chipped"]);
    expect(b.scoreMult).toBeCloseTo(1.04, 5);
    expect(b.coinMult).toBeCloseTo(1.05, 5);
  });

  it("ignores nulls and bad keys", () => {
    const b = socketBuffs([null, "bad", "ruby:chipped"]);
    expect(b.scoreMult).toBeCloseTo(1.04, 5);
  });
});

describe("gems — socketActiveMods", () => {
  it("emerald lowers active cooldown", () => {
    const m = socketActiveMods(["emerald:chipped"]);
    expect(m.cooldownDelta).toBe(-1);
  });

  it("brilliant emerald lowers cooldown by 3", () => {
    const m = socketActiveMods(["emerald:brilliant"]);
    expect(m.cooldownDelta).toBe(-3);
  });

  it("passive gems contribute no active mods", () => {
    const m = socketActiveMods(["ruby:brilliant", "diamond:chipped"]);
    expect(m).toEqual({ cooldownDelta: 0, countDelta: 0, strengthMult: 1 });
  });
});

describe("gems — dust cost", () => {
  it("escalates by tier", () => {
    expect(gemDustCost("chipped")).toBe(40);
    expect(gemDustCost("polished")).toBe(120);
    expect(gemDustCost("brilliant")).toBe(300);
    expect(GEM_DUST_COST.chipped).toBe(40);
  });

  it("unknown tier falls back to chipped cost", () => {
    expect(gemDustCost("garbage")).toBe(40);
  });
});

describe("gems — embue (socket) cost & shatter refund", () => {
  it("socketDustCost escalates by tier and is cheaper than crafting", () => {
    expect(socketDustCost("chipped")).toBe(20);
    expect(socketDustCost("polished")).toBe(60);
    expect(socketDustCost("brilliant")).toBe(150);
    expect(SOCKET_DUST_COST.brilliant).toBe(150);
    for (const t of ["chipped", "polished", "brilliant"]) {
      expect(socketDustCost(t)).toBeLessThan(gemDustCost(t));
    }
  });

  it("unknown tier falls back to chipped embue cost", () => {
    expect(socketDustCost("garbage")).toBe(20);
  });

  it("unsocketDustRefund always returns LESS dust than embuing cost", () => {
    for (const t of ["chipped", "polished", "brilliant"]) {
      const refund = unsocketDustRefund(t);
      expect(refund).toBeGreaterThanOrEqual(0);
      expect(refund).toBeLessThan(socketDustCost(t));
    }
    // 40% of the embue cost, floored.
    expect(unsocketDustRefund("chipped")).toBe(Math.floor(20 * UNSOCKET_REFUND_RATIO));
    expect(unsocketDustRefund("brilliant")).toBe(Math.floor(150 * UNSOCKET_REFUND_RATIO));
  });
});

describe("gems — gemBuffLabel", () => {
  it("describes passive gem buffs as a percentage of the right stat", () => {
    expect(gemBuffLabel("ruby:chipped")).toBe("+4% Score");
    expect(gemBuffLabel("ruby:brilliant")).toBe("+12% Score");
    expect(gemBuffLabel("citrine:polished")).toBe("+10% Coins");
    expect(gemBuffLabel("sapphire:chipped")).toBe("+6% Charge");
    expect(gemBuffLabel("amber:chipped")).toBe("+6% Fever");
    expect(gemBuffLabel("diamond:brilliant")).toBe("+6% all stats");
  });

  it("describes the emerald as a cooldown reduction in moves", () => {
    expect(gemBuffLabel("emerald:chipped")).toBe("-1 move ability cooldown");
    expect(gemBuffLabel("emerald:brilliant")).toBe("-3 move ability cooldown");
  });

  it("returns empty string for a junk key", () => {
    expect(gemBuffLabel("nope")).toBe("");
  });
});

describe("gems — rollGem (seeded)", () => {
  it("is deterministic for a fixed seed", () => {
    const a = rollGem(makeRng(12345));
    const b = rollGem(makeRng(12345));
    expect(a).toBe(b);
    expect(parseGemKey(a)).not.toBeNull();
  });

  it("produces valid keys across many seeds", () => {
    for (let s = 0; s < 50; s++) {
      const k = rollGem(makeRng(s + 1));
      const p = parseGemKey(k);
      expect(p).not.toBeNull();
      expect(GEM_TIERS.map((t) => t.id)).toContain(p.tier);
    }
  });

  it("tierBias nudges toward higher tiers on average", () => {
    const tierIndex = (k) => GEM_TIERS.findIndex((t) => t.id === parseGemKey(k).tier);
    let low = 0;
    let high = 0;
    for (let s = 0; s < 300; s++) {
      low += tierIndex(rollGem(makeRng(s + 1), { tierBias: 0 }));
      high += tierIndex(rollGem(makeRng(s + 1), { tierBias: 1 }));
    }
    expect(high).toBeGreaterThan(low);
  });

  it("weight table favours chipped at no bias", () => {
    expect(GEM_TIER_WEIGHTS.chipped).toBeGreaterThan(GEM_TIER_WEIGHTS.polished);
    expect(GEM_TIER_WEIGHTS.polished).toBeGreaterThan(GEM_TIER_WEIGHTS.brilliant);
  });
});

describe("gems — fusion", () => {
  it("requires 3 gems to fuse", () => {
    expect(FUSE_COUNT).toBe(3);
  });

  it("nextGemTier climbs the ladder, null at the top", () => {
    expect(nextGemTier("chipped")).toBe("polished");
    expect(nextGemTier("polished")).toBe("brilliant");
    expect(nextGemTier("brilliant")).toBeNull();
  });

  it("nextGemTier resolves unknown tiers via getGemTier fallback (chipped)", () => {
    expect(nextGemTier("garbage")).toBe("polished");
  });

  it("canFuseTier is true for all but the top tier", () => {
    expect(canFuseTier("chipped")).toBe(true);
    expect(canFuseTier("polished")).toBe(true);
    expect(canFuseTier("brilliant")).toBe(false);
  });

  it("fusedGemKey maps a key one tier up, same type", () => {
    expect(fusedGemKey("ruby:chipped")).toBe("ruby:polished");
    expect(fusedGemKey("citrine:polished")).toBe("citrine:brilliant");
    expect(fusedGemKey("diamond:brilliant")).toBeNull();
    expect(fusedGemKey("nope")).toBeNull();
  });

  it("prevGemTier walks down the ladder, null at the bottom", () => {
    expect(prevGemTier("brilliant")).toBe("polished");
    expect(prevGemTier("polished")).toBe("chipped");
    expect(prevGemTier("chipped")).toBeNull();
  });

  it("prevGemTier resolves unknown tiers via getGemTier fallback (chipped -> null)", () => {
    expect(prevGemTier("garbage")).toBeNull();
  });
});
