import { describe, it, expect } from "vitest";
import {
  PET_CATALOG,
  COSMETICS,
  RARITIES,
  RARITY_WEIGHTS,
  MAX_PET_LEVEL,
  PET_XP_PER_LEVEL,
  DUP_XP,
  CRATE_COST,
  getPet,
  getCosmetic,
  xpForLevel,
  levelForXp,
  levelProgress,
  abilityValue,
  neutralBuffs,
  petBuffs,
  petActive,
  petsOfRarity,
  crateRarity,
  rollCrate,
  rollLegendaryCrate,
  premiumPets,
  PREMIUM_DROP_CHANCE,
  LEGENDARY_CRATE,
} from "../../src/pets.js";
import { makeRng } from "../../src/rng.js";

describe("pets catalog", () => {
  it("has unique ids and valid rarities", () => {
    const ids = new Set();
    for (const p of PET_CATALOG) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(RARITIES).toContain(p.rarity);
      expect(typeof p.icon).toBe("string");
      // Each pet is either passive (ability) or active, never neither/both.
      const passive = !!p.ability;
      const active = !!p.active;
      expect(passive || active).toBe(true);
      expect(passive && active).toBe(false);
    }
  });

  it("only premium pets carry a price/product, and they are passive side-grades", () => {
    for (const p of PET_CATALOG) {
      if (p.premium) {
        expect(typeof p.product).toBe("string");
        expect(p.product.startsWith("pet_")).toBe(true);
        // Premium pets are passive side-grades (not active board powers).
        expect(!!p.ability).toBe(true);
      } else {
        expect(p.product).toBeUndefined();
      }
    }
  });

  it("keeps the strongest score booster (draco) earnable for free", () => {
    const draco = getPet("draco");
    expect(draco).toBeTruthy();
    expect(draco.premium).toBe(false);
    expect(draco.ability.key).toBe("scoreMult");
  });

  it("provides at least one gather and one cleanse active pet, both free", () => {
    const gather = PET_CATALOG.find((p) => p.active && p.active.type === "gather");
    const cleanse = PET_CATALOG.find((p) => p.active && p.active.type === "cleanse");
    expect(gather).toBeTruthy();
    expect(cleanse).toBeTruthy();
    expect(gather.premium).toBe(false);
    expect(cleanse.premium).toBe(false);
  });

  it("provides a free diagonal-blasting active pet", () => {
    const diag = PET_CATALOG.find((p) => p.active && p.active.type === "diagonal");
    expect(diag).toBeTruthy();
    expect(diag.premium).toBe(false);
    const act = petActive(diag.id, 1);
    expect(act.type).toBe("diagonal");
    expect(act.cooldown).toBeGreaterThan(0);
  });

  it("getPet / getCosmetic return defaults for unknown ids", () => {
    expect(getPet("nope")).toBeNull();
    expect(getCosmetic("nope")).toBe(COSMETICS[0]);
    expect(getCosmetic("default").id).toBe("default");
  });
});

describe("pet leveling", () => {
  it("xpForLevel is monotonic and starts at 0", () => {
    expect(xpForLevel(1)).toBe(0);
    let prev = -1;
    for (let l = 1; l <= MAX_PET_LEVEL; l++) {
      const x = xpForLevel(l);
      expect(x).toBeGreaterThan(prev);
      prev = x;
    }
  });

  it("levelForXp maps xp onto the right level and caps at MAX", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(xpForLevel(2))).toBe(2);
    expect(levelForXp(xpForLevel(2) - 1)).toBe(1);
    expect(levelForXp(999999)).toBe(MAX_PET_LEVEL);
  });

  it("levelProgress reports max at top level", () => {
    const top = levelProgress(xpForLevel(MAX_PET_LEVEL));
    expect(top.max).toBe(true);
    expect(top.level).toBe(MAX_PET_LEVEL);
    expect(top.toNext).toBe(0);
    const mid = levelProgress(xpForLevel(2));
    expect(mid.max).toBe(false);
    expect(mid.progress).toBeGreaterThanOrEqual(0);
    expect(mid.progress).toBeLessThanOrEqual(1);
  });
});

describe("pet buffs", () => {
  it("neutral buffs are identity multipliers", () => {
    const b = neutralBuffs();
    expect(b).toEqual({
      powerMult: 1,
      feverMult: 1,
      scoreMult: 1,
      coinMult: 1,
      startCharge: 0,
    });
  });

  it("passive buffs scale with level", () => {
    // Sparky: powerMult +0.08 / level.
    expect(petBuffs("sparky", 1).powerMult).toBeCloseTo(1.08);
    expect(petBuffs("sparky", 5).powerMult).toBeCloseTo(1.4);
    // Clover: coinMult.
    expect(petBuffs("clover", 2).coinMult).toBeCloseTo(1.1);
    // Gizmo: startCharge is additive (capped at 1).
    expect(petBuffs("gizmo", 5).startCharge).toBeCloseTo(0.5);
  });

  it("active-only pets return neutral passive buffs", () => {
    expect(petBuffs("rover", 5)).toEqual(neutralBuffs());
    expect(petBuffs("whiskers", 5)).toEqual(neutralBuffs());
  });

  it("abilityValue is 0 for active/unknown pets", () => {
    expect(abilityValue(getPet("rover"), 5)).toBe(0);
    expect(abilityValue(null, 3)).toBe(0);
  });
});

describe("pet active actions", () => {
  it("returns null for passive pets", () => {
    expect(petActive("sparky", 3)).toBeNull();
    expect(petActive("nope", 3)).toBeNull();
  });

  it("gather cooldown shortens and strength grows with level", () => {
    const lo = petActive("rover", 1);
    const hi = petActive("rover", 5);
    expect(lo.type).toBe("gather");
    expect(hi.cooldown).toBeLessThan(lo.cooldown);
    expect(hi.cooldown).toBeGreaterThanOrEqual(3); // minCooldown floor
    expect(hi.strength).toBeGreaterThan(lo.strength);
    expect(hi.strength).toBeLessThanOrEqual(1);
  });

  it("cleanse clears more bubbles at higher level", () => {
    const lo = petActive("whiskers", 1);
    const hi = petActive("whiskers", 5);
    expect(lo.type).toBe("cleanse");
    expect(lo.count).toBe(1);
    expect(hi.count).toBe(5);
    expect(hi.cooldown).toBeLessThanOrEqual(lo.cooldown);
  });
});

describe("crate rolls", () => {
  it("petsOfRarity never includes premium pets", () => {
    for (const r of RARITIES) {
      for (const p of petsOfRarity(r)) expect(p.premium).toBe(false);
    }
  });

  it("rollCrate is deterministic for a fixed seed", () => {
    const a = rollCrate(makeRng(1234));
    const b = rollCrate(makeRng(1234));
    expect(a).toEqual(b);
    expect(typeof a.petId).toBe("string");
    expect(typeof a.premium).toBe("boolean");
  });

  it("rollCrate with premiumChance 0 never yields a premium pet", () => {
    const seen = new Set();
    for (let s = 0; s < 400; s++) {
      const { petId, premium } = rollCrate(makeRng(s * 7919 + 1), {
        premiumChance: 0,
      });
      seen.add(petId);
      expect(premium).toBe(false);
      expect(getPet(petId).premium).toBe(false);
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
    expect(seen.has("aurora")).toBe(false);
    expect(seen.has("gizmo")).toBe(false);
  });

  it("rollCrate with premiumChance 1 always yields a premium pet", () => {
    const { petId, premium } = rollCrate(makeRng(7), { premiumChance: 1 });
    expect(premium).toBe(true);
    expect(getPet(petId).premium).toBe(true);
  });

  it("premium drops are rare with the default chance", () => {
    expect(PREMIUM_DROP_CHANCE).toBeGreaterThan(0);
    expect(PREMIUM_DROP_CHANCE).toBeLessThan(0.01);
    let premiums = 0;
    const N = 2000;
    for (let s = 0; s < N; s++) {
      if (rollCrate(makeRng(s * 104729 + 3)).premium) premiums++;
    }
    // Should be in the low single-digit percent ballpark, well under 5%.
    expect(premiums / N).toBeLessThan(0.05);
  });

  it("premiumPets returns only premium catalog entries", () => {
    const prem = premiumPets();
    expect(prem.length).toBeGreaterThan(0);
    for (const p of prem) expect(p.premium).toBe(true);
    expect(prem.map((p) => p.id).sort()).toEqual(["aurora", "gizmo"]);
  });

  it("rollLegendaryCrate without premium yields a legendary pet", () => {
    const { petId, premium, rarity } = rollLegendaryCrate(makeRng(99), {
      premiumChance: 0,
    });
    expect(premium).toBe(false);
    expect(rarity).toBe("legendary");
    expect(getPet(petId).rarity).toBe("legendary");
    expect(getPet(petId).premium).toBe(false);
  });

  it("rollLegendaryCrate with premiumChance 1 yields a premium pet", () => {
    const { petId, premium } = rollLegendaryCrate(makeRng(5), {
      premiumChance: 1,
    });
    expect(premium).toBe(true);
    expect(getPet(petId).premium).toBe(true);
  });

  it("LEGENDARY_CRATE has a product id, price and boosted odds", () => {
    expect(typeof LEGENDARY_CRATE.product).toBe("string");
    expect(LEGENDARY_CRATE.product.startsWith("crate_")).toBe(true);
    expect(typeof LEGENDARY_CRATE.price).toBe("string");
    expect(LEGENDARY_CRATE.premiumChance).toBeGreaterThan(PREMIUM_DROP_CHANCE);
  });

  it("crateRarity respects the weight ladder edges", () => {
    // rng→0 always lands in the first (common) bucket.
    expect(crateRarity(() => 0)).toBe("common");
    // rng→just under 1 lands in the last (legendary) bucket.
    expect(crateRarity(() => 0.999999)).toBe("legendary");
  });

  it("constants are sane", () => {
    expect(CRATE_COST).toBeGreaterThan(0);
    expect(PET_XP_PER_LEVEL).toBeGreaterThan(0);
    expect(DUP_XP).toBeGreaterThan(0);
    expect(RARITY_WEIGHTS.common).toBeGreaterThan(RARITY_WEIGHTS.legendary);
  });
});
