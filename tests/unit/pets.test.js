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
  cratePremiumPets,
  shooterStats,
  PREMIUM_DROP_CHANCE,
  LEGENDARY_CRATE,
  PITY_EPIC,
  PITY_LEGENDARY,
  DUST_PER_DUP,
  dustValue,
  dustCost,
  pityRarityFloor,
  nextPity,
  TRAITS,
  getTrait,
  rollTrait,
  SUPPORT_SLOTS,
  SUPPORT_FRACTION,
  partyBuffs,
  partyTotalBuffs,
  activeSynergies,
  applySynergies,
  SYNERGIES,
  PET_FEATURE_UNLOCKS,
  PET_FEATURE_INFO,
  PET_FEATURE_GRANTS,
  petFeatureUnlockLevel,
  isPetFeatureUnlocked,
  petFeaturesUnlockedBetween,
  nextPetFeatureUnlock,
  petAvatarSrc,
  petSpriteSrc,
  EGG_INCUBATE_MOVES,
  eggReady,
  advanceEgg,
} from "../../src/pets.js";
import { makeRng } from "../../src/rng.js";

describe("pets catalog", () => {
  it("drips pet systems into campaign progression", () => {
    expect(PET_FEATURE_UNLOCKS.map((u) => [u.feature, u.level])).toEqual([
      ["pets", 12],
      ["crates", 14],
      ["abilities", 16],
      ["party", 18],
      ["gems", 22],
      ["tech", 26],
    ]);
    for (const unlock of PET_FEATURE_UNLOCKS) {
      expect(PET_FEATURE_INFO[unlock.feature]).toBeTruthy();
      expect(petFeatureUnlockLevel(unlock.feature)).toBe(unlock.level);
      expect(isPetFeatureUnlocked(unlock.feature, unlock.level - 1)).toBe(false);
      expect(isPetFeatureUnlocked(unlock.feature, unlock.level)).toBe(true);
    }
    expect(nextPetFeatureUnlock(1).feature).toBe("pets");
    expect(petFeaturesUnlockedBetween(13, 18).map((u) => u.feature)).toEqual(["crates", "abilities", "party"]);
  });

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

  it("exposes local avatar art for every pet and animation sprites where needed", () => {
    const skyboltAsset = "./assets/pets/kenney-space-shooter/playerShip3_red.png";
    for (const pet of PET_CATALOG) {
      const avatar = petAvatarSrc(pet);
      expect(avatar).toBeTruthy();
      expect(avatar).toMatch(/^\.\/assets\/pets\/(avatars\/.+\.png|kenney-space-shooter\/.+\.png)$/);
      expect(avatar).not.toMatch(/^https?:/);
    }
    expect(petAvatarSrc("skybolt")).toBe(skyboltAsset);
    expect(petSpriteSrc("skybolt")).toBe(skyboltAsset);
    expect(petAvatarSrc({ id: "skybolt", name: "Skybolt" })).toBe(skyboltAsset);
    expect(petSpriteSrc({ id: "skybolt", name: "Skybolt" })).toBe(skyboltAsset);
    expect(petAvatarSrc("rover")).toBe("./assets/pets/avatars/rover.png");
    expect(petSpriteSrc("rover")).toBe("./assets/pets/avatars/rover.png");
    expect(petAvatarSrc("missing")).toBeNull();
    expect(petSpriteSrc(null)).toBeNull();
  });

  it("only premium pets carry a price/product", () => {
    for (const p of PET_CATALOG) {
      if (p.premium) {
        expect(typeof p.product).toBe("string");
        expect(p.product.startsWith("pet_")).toBe(true);
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

  it("provides a free pick (Talon) active pet whose count scales with level", () => {
    const pick = PET_CATALOG.find((p) => p.active && p.active.type === "pick");
    expect(pick).toBeTruthy();
    expect(pick.premium).toBe(false);
    const l1 = petActive(pick.id, 1);
    const l5 = petActive(pick.id, MAX_PET_LEVEL);
    expect(l1.type).toBe("pick");
    expect(l1.count).toBe(2); // baseCount
    expect(l5.count).toBeGreaterThan(l1.count); // picks off more as it levels up
    expect(l5.cooldown).toBeLessThan(l1.cooldown); // and fires more often
  });

  it("getPet / getCosmetic return defaults for unknown ids", () => {
    expect(getPet("nope")).toBeNull();
    expect(getCosmetic("nope")).toBe(COSMETICS[0]);
    expect(getCosmetic("default").id).toBe("default");
  });

  it("ships the four elemental active pets, all free, with the right rarity", () => {
    const want = [
      { id: "quake", type: "quake", rarity: "rare" },
      { id: "cyclone", type: "cyclone", rarity: "epic" },
      { id: "magma", type: "magma", rarity: "epic" },
      { id: "tidal", type: "tidal", rarity: "legendary" },
    ];
    for (const w of want) {
      const pet = getPet(w.id);
      expect(pet).toBeTruthy();
      expect(pet.premium).toBe(false);
      expect(pet.rarity).toBe(w.rarity);
      expect(pet.active.type).toBe(w.type);
      const act = petActive(w.id, 1);
      expect(act.type).toBe(w.type);
      expect(act.cooldown).toBeGreaterThan(0);
    }
  });

  it("adds long-progression pets with distinct passive goals and Luma paint setup", () => {
    const expected = [
      { id: "mochi", key: "scoreMult", rarity: "common" },
      { id: "sprout", key: "feverMult", rarity: "common" },
      { id: "amp", key: "powerMult", rarity: "epic" },
      { id: "prism", key: "startCharge", rarity: "epic" },
      { id: "midas", key: "coinMult", rarity: "legendary" },
    ];
    for (const item of expected) {
      const pet = getPet(item.id);
      expect(pet).toBeTruthy();
      expect(pet.premium).toBe(false);
      expect(pet.rarity).toBe(item.rarity);
      expect(pet.ability.key).toBe(item.key);
    }
    const luma = getPet("luma");
    expect(luma.premium).toBe(false);
    expect(luma.rarity).toBe("rare");
    expect(luma.active.type).toBe("paint");
    const early = petActive("luma", 1);
    const late = petActive("luma", MAX_PET_LEVEL);
    expect(early.count).toBe(3);
    expect(late.count).toBeGreaterThan(early.count);
    expect(late.cooldown).toBeLessThan(early.cooldown);
  });

  it("Magma clears more lanes as it levels up, on a longer cooldown", () => {
    const l1 = petActive("magma", 1);
    const l5 = petActive("magma", MAX_PET_LEVEL);
    // baseCount 1, countPer 0.25 -> level 5 reaches 2 lanes when rounded.
    expect(Math.round(l1.count)).toBe(1);
    expect(Math.round(l5.count)).toBeGreaterThanOrEqual(2);
    expect(l5.cooldown).toBeLessThanOrEqual(l1.cooldown);
    expect(l5.cooldown).toBeGreaterThanOrEqual(4); // minCooldown floor
  });

  it("provides a free Archer skill-shot pet whose arrow pierces more at high level", () => {
    const archer = getPet("archer");
    expect(archer).toBeTruthy();
    expect(archer.premium).toBe(false);
    expect(archer.rarity).toBe("epic");
    expect(archer.active.type).toBe("archer");
    const early = petActive("archer", 1);
    const late = petActive("archer", MAX_PET_LEVEL);
    expect(early.type).toBe("archer");
    expect(early.count).toBe(2);
    expect(late.count).toBeGreaterThan(early.count);
    expect(late.cooldown).toBeLessThan(early.cooldown);
  });

  it("provides a free Skybolt bomber pet whose bomb count scales with level", () => {
    const skybolt = getPet("skybolt");
    expect(skybolt).toBeTruthy();
    expect(skybolt.premium).toBe(false);
    expect(skybolt.rarity).toBe("legendary");
    expect(skybolt.active.type).toBe("bomber");
    const early = petActive("skybolt", 1);
    const late = petActive("skybolt", MAX_PET_LEVEL);
    expect(early.type).toBe("bomber");
    expect(early.count).toBe(4);
    expect(late.count).toBeGreaterThan(early.count);
    expect(late.cooldown).toBeLessThan(early.cooldown);
  });

  it("keeps craft dust costs derived from duplicate dust values", () => {
    for (const rarity of RARITIES) {
      expect(dustCost(rarity)).toBe(dustValue(rarity) * 10);
    }
    expect(dustCost("unknown")).toBe(dustValue("common") * 10);
  });

  it("defines starter grants for early pet economy unlocks", () => {
    expect(PET_FEATURE_GRANTS.crates).toEqual({ crates: 2 });
    expect(PET_FEATURE_GRANTS.abilities.dust).toBeGreaterThanOrEqual(50);
    expect(PET_FEATURE_GRANTS.party.dust).toBeGreaterThanOrEqual(50);
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

  it("uses a long-form 12-level XP curve", () => {
    expect(MAX_PET_LEVEL).toBe(12);
    expect(xpForLevel(2)).toBeGreaterThan(PET_XP_PER_LEVEL);
    expect(xpForLevel(5)).toBeGreaterThan(500);
    expect(xpForLevel(MAX_PET_LEVEL)).toBeGreaterThan(5000);
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
    // Sparky grows across the longer curve without exploding balance mid-game.
    expect(petBuffs("sparky", 1).powerMult).toBeCloseTo(1.08);
    expect(petBuffs("sparky", 5).powerMult).toBeCloseTo(1.2144);
    expect(petBuffs("sparky", MAX_PET_LEVEL).powerMult).toBeCloseTo(1.4496);
    // Clover: coinMult.
    expect(petBuffs("clover", 2).coinMult).toBeCloseTo(1.071);
    // Gizmo: startCharge is additive (capped at 1).
    expect(petBuffs("gizmo", MAX_PET_LEVEL).startCharge).toBeCloseTo(0.562);
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
    const hi = petActive("whiskers", MAX_PET_LEVEL);
    expect(lo.type).toBe("cleanse");
    expect(lo.count).toBe(1);
    expect(hi.count).toBe(6);
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
    expect(prem.map((p) => p.id).sort()).toEqual(["aurora", "gizmo", "nova"]);
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

  it("rollCrate honours a rarity floor (pity)", () => {
    // Force a roll that would otherwise be common up to the epic floor.
    const r = rollCrate(() => 0, { floor: "epic", premiumChance: 0 });
    expect(RARITIES.indexOf(r.rarity)).toBeGreaterThanOrEqual(
      RARITIES.indexOf("epic")
    );
    expect(getPet(r.petId).rarity).toBe(r.rarity);
  });

  it("rollCrate floor never lowers a higher roll", () => {
    // rng→~1 normally lands legendary; an epic floor must not pull it down.
    const r = rollCrate(() => 0.999999, { floor: "epic", premiumChance: 0 });
    expect(r.rarity).toBe("legendary");
  });
});

describe("pity timer", () => {
  it("exposes sensible thresholds", () => {
    expect(PITY_EPIC).toBeGreaterThan(0);
    expect(PITY_LEGENDARY).toBeGreaterThan(PITY_EPIC);
  });

  it("pityRarityFloor returns null until a threshold is reached", () => {
    expect(pityRarityFloor({ sinceEpic: 0, sinceLegendary: 0 })).toBe(null);
    expect(pityRarityFloor({ sinceEpic: PITY_EPIC - 2, sinceLegendary: 0 })).toBe(
      null
    );
  });

  it("pityRarityFloor guarantees epic on the threshold open", () => {
    // sinceEpic+1 reaches PITY_EPIC.
    expect(
      pityRarityFloor({ sinceEpic: PITY_EPIC - 1, sinceLegendary: 0 })
    ).toBe("epic");
  });

  it("pityRarityFloor guarantees legendary with precedence over epic", () => {
    expect(
      pityRarityFloor({
        sinceEpic: PITY_EPIC - 1,
        sinceLegendary: PITY_LEGENDARY - 1,
      })
    ).toBe("legendary");
  });

  it("pityRarityFloor tolerates a missing/empty pity object", () => {
    expect(pityRarityFloor()).toBe(null);
    expect(pityRarityFloor({})).toBe(null);
  });

  it("nextPity increments both counters on a low roll", () => {
    expect(nextPity({ sinceEpic: 2, sinceLegendary: 5 }, "common")).toEqual({
      sinceEpic: 3,
      sinceLegendary: 6,
    });
    expect(nextPity({ sinceEpic: 2, sinceLegendary: 5 }, "rare")).toEqual({
      sinceEpic: 3,
      sinceLegendary: 6,
    });
  });

  it("nextPity resets the epic counter on an epic roll", () => {
    expect(nextPity({ sinceEpic: 7, sinceLegendary: 12 }, "epic")).toEqual({
      sinceEpic: 0,
      sinceLegendary: 13,
    });
  });

  it("nextPity resets both counters on a legendary roll", () => {
    expect(nextPity({ sinceEpic: 7, sinceLegendary: 25 }, "legendary")).toEqual({
      sinceEpic: 0,
      sinceLegendary: 0,
    });
  });

  it("nextPity tolerates a missing pity object", () => {
    expect(nextPity(undefined, "common")).toEqual({
      sinceEpic: 1,
      sinceLegendary: 1,
    });
  });

  it("repeated common opens eventually guarantee an epic then legendary", () => {
    let pity = { sinceEpic: 0, sinceLegendary: 0 };
    let firstEpicAt = -1;
    let firstLegendAt = -1;
    for (let open = 1; open <= PITY_LEGENDARY; open++) {
      const floor = pityRarityFloor(pity);
      // Simulate the worst case: always roll the lowest allowed rarity.
      const rarity = floor || "common";
      if (rarity === "epic" && firstEpicAt < 0) firstEpicAt = open;
      if (rarity === "legendary" && firstLegendAt < 0) firstLegendAt = open;
      pity = nextPity(pity, rarity);
    }
    expect(firstEpicAt).toBe(PITY_EPIC);
    expect(firstLegendAt).toBe(PITY_LEGENDARY);
  });
});

describe("mystery egg hatching", () => {
  it("a freshly-started egg is not ready", () => {
    const egg = { rolled: { petId: "sparky", isNew: true }, movesLeft: EGG_INCUBATE_MOVES };
    expect(eggReady(egg)).toBe(false);
  });

  it("an egg with 0 (or negative) moves left is ready", () => {
    expect(eggReady({ rolled: {}, movesLeft: 0 })).toBe(true);
    expect(eggReady({ rolled: {}, movesLeft: -3 })).toBe(true);
  });

  it("a falsy egg is never ready", () => {
    expect(eggReady(null)).toBe(false);
    expect(eggReady(undefined)).toBe(false);
  });

  it("advanceEgg decrements movesLeft by one and preserves the rolled result", () => {
    const egg = { rolled: { petId: "sparky", isNew: true }, movesLeft: 3 };
    const next = advanceEgg(egg);
    expect(next.movesLeft).toBe(2);
    expect(next.rolled).toBe(egg.rolled);
  });

  it("advanceEgg floors at 0, never goes negative", () => {
    const egg = { rolled: {}, movesLeft: 0 };
    expect(advanceEgg(egg).movesLeft).toBe(0);
  });

  it("advanceEgg is a no-op once the egg is already ready", () => {
    const egg = { rolled: {}, movesLeft: 0 };
    expect(advanceEgg(egg)).toBe(egg);
  });

  it("advanceEgg tolerates a falsy egg (returns it unchanged)", () => {
    expect(advanceEgg(null)).toBe(null);
    expect(advanceEgg(undefined)).toBe(undefined);
  });

  it("a full incubation walk-through reaches ready after exactly EGG_INCUBATE_MOVES steps", () => {
    let egg = { rolled: { petId: "sparky", isNew: true }, movesLeft: EGG_INCUBATE_MOVES };
    let steps = 0;
    while (!eggReady(egg)) {
      egg = advanceEgg(egg);
      steps++;
      expect(steps).toBeLessThanOrEqual(EGG_INCUBATE_MOVES); // safety net
    }
    expect(steps).toBe(EGG_INCUBATE_MOVES);
    expect(egg.rolled.petId).toBe("sparky");
  });
});

describe("pet dust", () => {
  it("dust table covers every rarity and rises with rarity", () => {
    for (const r of RARITIES) {
      expect(DUST_PER_DUP[r]).toBeGreaterThan(0);
    }
    expect(DUST_PER_DUP.legendary).toBeGreaterThan(DUST_PER_DUP.common);
  });

  it("dustValue maps rarity to the duplicate table", () => {
    for (const r of RARITIES) {
      expect(dustValue(r)).toBe(DUST_PER_DUP[r]);
    }
  });

  it("dustValue falls back to common for unknown rarity", () => {
    expect(dustValue("mythic")).toBe(DUST_PER_DUP.common);
  });
});

describe("Nova premium gunship", () => {
  it("is a premium, store-only, active shooter", () => {
    const nova = getPet("nova");
    expect(nova).toBeTruthy();
    expect(nova.premium).toBe(true);
    expect(nova.storeOnly).toBe(true);
    expect(nova.product).toBe("pet_nova");
    expect(nova.active && nova.active.type).toBe("shooter");
  });

  it("is excluded from crate surprise rolls (purchasable with $$$ only)", () => {
    // Store-only pets must never appear as a crate premium surprise.
    expect(cratePremiumPets().some((p) => p.id === "nova")).toBe(false);
    // Forcing the premium branch in both crate types never yields Nova.
    for (let i = 0; i < 200; i++) {
      const rng = makeRng(i + 1);
      expect(rollCrate(rng, { premiumChance: 1 }).petId).not.toBe("nova");
      expect(rollLegendaryCrate(makeRng(i + 7), { premiumChance: 1 }).petId).not.toBe(
        "nova"
      );
    }
  });

  it("still appears in the Pet Store list", () => {
    expect(premiumPets().some((p) => p.id === "nova")).toBe(true);
  });
});

describe("shooterStats progression", () => {
  it("clamps level to 1..MAX and reports it", () => {
    expect(shooterStats(0).level).toBe(1);
    expect(shooterStats(-5).level).toBe(1);
    expect(shooterStats(99).level).toBe(MAX_PET_LEVEL);
    expect(shooterStats(3).level).toBe(3);
  });

  it("gets strictly stronger as it levels: faster, more cannons, then nukes", () => {
    const levels = [1, 4, 7, 10, MAX_PET_LEVEL].map(shooterStats);
    // Fire interval never increases (it gets faster or holds).
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i].fireInterval).toBeLessThanOrEqual(levels[i - 1].fireInterval);
      expect(levels[i].shots).toBeGreaterThanOrEqual(levels[i - 1].shots);
      expect(levels[i].moveSpeed).toBeGreaterThanOrEqual(levels[i - 1].moveSpeed);
    }
    // L1 is a single slow cannon; the top level fires multiple and unlocks nukes.
    expect(levels[0].shots).toBe(1);
    expect(levels[0].nuke).toBe(false);
    expect(levels[4].shots).toBeGreaterThan(1);
    expect(levels[4].nuke).toBe(true);
    expect(levels[4].nukeInterval).toBeGreaterThan(0);
    expect(levels[4].fireInterval).toBeLessThan(levels[0].fireInterval);
  });
});

describe("pet traits", () => {
  it("defines a non-empty trait table with stable shape", () => {
    expect(Array.isArray(TRAITS)).toBe(true);
    expect(TRAITS.length).toBeGreaterThanOrEqual(5);
    const ids = new Set();
    for (const t of TRAITS) {
      expect(typeof t.id).toBe("string");
      expect(typeof t.icon).toBe("string");
      expect(typeof t.label).toBe("string");
      expect(typeof t.desc).toBe("string");
      expect(typeof t.mods).toBe("object");
      ids.add(t.id);
    }
    expect(ids.size).toBe(TRAITS.length); // ids are unique
    // Balanced is the neutral default and must exist with empty mods.
    const balanced = TRAITS.find((t) => t.id === "balanced");
    expect(balanced).toBeTruthy();
    expect(Object.keys(balanced.mods).length).toBe(0);
  });

  it("getTrait resolves known ids and falls back to balanced for unknown/missing", () => {
    expect(getTrait("swift").id).toBe("swift");
    expect(getTrait("nope").id).toBe("balanced");
    expect(getTrait(undefined).id).toBe("balanced");
    expect(getTrait(null).id).toBe("balanced");
  });

  it("rollTrait is deterministic for a seeded rng and always in range", () => {
    const a = rollTrait(makeRng(123));
    const b = rollTrait(makeRng(123));
    expect(a).toBe(b);
    const valid = new Set(TRAITS.map((t) => t.id));
    for (let s = 0; s < 50; s++) {
      expect(valid.has(rollTrait(makeRng(s)))).toBe(true);
    }
  });

  it("balanced trait leaves petActive/petBuffs identical to no trait", () => {
    // Rover (active gather pet) and Sparky (passive) cover both paths.
    expect(petActive("rover", 3, "balanced")).toEqual(petActive("rover", 3));
    expect(petBuffs("sparky", 3, "balanced")).toEqual(petBuffs("sparky", 3));
  });

  it("swift trait shortens an active pet's cooldown by one (min 1)", () => {
    const base = petActive("rover", 1);
    const swift = petActive("rover", 1, "swift");
    expect(swift.cooldown).toBe(Math.max(1, base.cooldown - 1));
  });

  it("mighty trait boosts an active pet's count and strength", () => {
    const base = petActive("rover", 2);
    const mighty = petActive("rover", 2, "mighty");
    expect(mighty.count).toBe(base.count + 1);
    expect(mighty.strength).toBeGreaterThan(base.strength);
    expect(mighty.strength).toBeLessThanOrEqual(1);
  });

  it("passive traits stack their multipliers onto pet buffs", () => {
    const lucky = petBuffs("sparky", 1, "lucky");
    const base = petBuffs("sparky", 1, "balanced");
    expect(lucky.coinMult).toBeCloseTo(base.coinMult * 1.2, 6);
    const keen = petBuffs("sparky", 1, "keen");
    expect(keen.scoreMult).toBeCloseTo(base.scoreMult * 1.15, 6);
    const fiery = petBuffs("sparky", 1, "fiery");
    expect(fiery.powerMult).toBeCloseTo(base.powerMult * 1.2, 6);
    expect(fiery.feverMult).toBeCloseTo(base.feverMult * 1.15, 6);
  });

  it("active-only pets gain passive value from traits", () => {
    // Rover has no passive ability, but a Lucky trait still pays coins.
    const buffs = petBuffs("rover", 3, "lucky");
    expect(buffs.coinMult).toBeCloseTo(1.2, 6);
    // And a balanced/active-only pet is fully neutral.
    expect(petBuffs("rover", 3, "balanced")).toEqual(neutralBuffs());
  });
});

describe("party & synergies", () => {
  it("exposes party slot constants", () => {
    expect(SUPPORT_SLOTS).toBe(2);
    expect(SUPPORT_FRACTION).toBeGreaterThan(0);
    expect(SUPPORT_FRACTION).toBeLessThan(1);
  });

  it("an empty party is neutral", () => {
    expect(partyBuffs([])).toEqual(neutralBuffs());
    expect(partyBuffs(null)).toEqual(neutralBuffs());
  });

  it("a lone lead applies its full buffs", () => {
    const m = [{ id: "sparky", level: 1, trait: "balanced", role: "lead" }];
    expect(partyBuffs(m).powerMult).toBeCloseTo(1.08, 6); // sparky per 0.08 × lvl1
  });

  it("supports contribute only a FRACTION of their passive buffs", () => {
    const m = [
      { id: "sparky", level: 1, trait: "balanced", role: "lead" }, // power 1.08
      { id: "clover", level: 1, trait: "balanced", role: "support" }, // coin 1.05
    ];
    const b = partyBuffs(m);
    expect(b.powerMult).toBeCloseTo(1.08, 6); // lead only
    // clover's +0.05 coin scaled by SUPPORT_FRACTION (0.35) → 1 + 0.05*0.35.
    expect(b.coinMult).toBeCloseTo(1 + 0.05 * SUPPORT_FRACTION, 6);
  });

  it("a full party of 3 grants the Full Party synergy", () => {
    const m = [{ id: "sparky" }, { id: "clover" }, { id: "rover" }];
    const syn = activeSynergies(m).map((s) => s.id);
    expect(syn).toContain("full_party");
  });

  it("two legendary pets grant Legendary Might", () => {
    const m = [{ id: "draco" }, { id: "tidal" }];
    const ids = activeSynergies(m).map((s) => s.id);
    expect(ids).toContain("legendary_might");
  });

  it("two coin pets grant Fortune Hunters", () => {
    const m = [{ id: "clover" }, { id: "aurora" }];
    const ids = activeSynergies(m).map((s) => s.id);
    expect(ids).toContain("fortune");
  });

  it("two active pets grant the Strike Team synergy", () => {
    const m = [{ id: "rover" }, { id: "whiskers" }];
    const ids = activeSynergies(m).map((s) => s.id);
    expect(ids).toContain("strike_team");
  });

  it("no synergy for a thin/mismatched party", () => {
    expect(activeSynergies([{ id: "sparky" }])).toEqual([]);
    expect(activeSynergies([])).toEqual([]);
  });

  it("applySynergies multiplies the matching buff fields", () => {
    const fortune = SYNERGIES.find((s) => s.id === "fortune");
    const out = applySynergies(neutralBuffs(), [fortune]);
    expect(out.coinMult).toBeCloseTo(1.25, 6);
    expect(out.scoreMult).toBe(1); // untouched
  });

  it("partyTotalBuffs folds set synergies onto the aggregated buffs", () => {
    const m = [
      { id: "draco", level: 1, trait: "balanced", role: "lead" },
      { id: "tidal", level: 1, trait: "balanced", role: "support" },
    ];
    const base = partyBuffs(m);
    const total = partyTotalBuffs(m);
    // Legendary Might (+12% score) is active, so total beats base on score.
    expect(total.scoreMult).toBeCloseTo(base.scoreMult * 1.12, 6);
  });
});

describe("gem sockets fold into pet buffs/active", () => {
  it("a socketed ruby raises a passive pet's scoreMult", () => {
    const base = petBuffs("sparky", 3);
    const withGem = petBuffs("sparky", 3, "balanced", ["ruby:polished"]);
    expect(withGem.scoreMult).toBeCloseTo(base.scoreMult * 1.08, 6);
    // Other axes unchanged by a ruby.
    expect(withGem.powerMult).toBeCloseTo(base.powerMult, 6);
  });

  it("a diamond lifts all four passive axes", () => {
    const base = petBuffs("sparky", 3);
    const withGem = petBuffs("sparky", 3, "balanced", ["diamond:chipped"]);
    expect(withGem.scoreMult).toBeCloseTo(base.scoreMult * 1.02, 6);
    expect(withGem.coinMult).toBeCloseTo(base.coinMult * 1.02, 6);
    expect(withGem.powerMult).toBeCloseTo(base.powerMult * 1.02, 6);
    expect(withGem.feverMult).toBeCloseTo(base.feverMult * 1.02, 6);
  });

  it("undefined sockets leaves buffs unchanged (backward compatible)", () => {
    expect(petBuffs("sparky", 3, "balanced", undefined)).toEqual(petBuffs("sparky", 3));
  });

  it("an emerald shortens an active pet's cooldown", () => {
    const base = petActive("rover", 3);
    const withGem = petActive("rover", 3, "balanced", ["emerald:chipped"]);
    expect(withGem.cooldown).toBe(base.cooldown - 1);
  });

  it("active cooldown never drops below 1 even with a strong emerald", () => {
    const withGem = petActive("rover", 5, "balanced", ["emerald:brilliant", "emerald:brilliant"]);
    expect(withGem.cooldown).toBeGreaterThanOrEqual(1);
  });
});

describe("tech-tree nodes fold into pet buffs/active", () => {
  it("a chosen score node raises a pet's scoreMult on top of gems", () => {
    const base = petBuffs("sparky", 3);
    const withTech = petBuffs("sparky", 3, "balanced", [], ["t1_power"]);
    expect(withTech.scoreMult).toBeCloseTo(base.scoreMult * 1.06, 6);
    expect(withTech.coinMult).toBeCloseTo(base.coinMult, 6);
  });

  it("gems and tech stack multiplicatively on the same axis", () => {
    const base = petBuffs("sparky", 3);
    const both = petBuffs("sparky", 3, "balanced", ["ruby:polished"], ["t1_power"]);
    expect(both.scoreMult).toBeCloseTo(base.scoreMult * 1.08 * 1.06, 6);
  });

  it("t4_overdrive lifts all four passive axes", () => {
    const base = petBuffs("sparky", 3);
    const t = petBuffs("sparky", 3, "balanced", [], ["t4_overdrive"]);
    expect(t.scoreMult).toBeCloseTo(base.scoreMult * 1.1, 6);
    expect(t.coinMult).toBeCloseTo(base.coinMult * 1.1, 6);
    expect(t.powerMult).toBeCloseTo(base.powerMult * 1.1, 6);
    expect(t.feverMult).toBeCloseTo(base.feverMult * 1.1, 6);
  });

  it("undefined tech leaves buffs unchanged (backward compatible)", () => {
    expect(petBuffs("sparky", 3, "balanced", [], undefined)).toEqual(petBuffs("sparky", 3));
    expect(petActive("rover", 3, "balanced", [], undefined)).toEqual(petActive("rover", 3));
  });

  it("t3_haste shortens an active pet's cooldown", () => {
    const base = petActive("rover", 3);
    const withTech = petActive("rover", 3, "balanced", [], ["t3_haste"]);
    expect(withTech.cooldown).toBe(base.cooldown - 1);
  });

  it("t4_mastery boosts an active pet's count and strength", () => {
    const base = petActive("rover", 2);
    const withTech = petActive("rover", 2, "balanced", [], ["t4_mastery"]);
    expect(withTech.count).toBe(base.count + 1);
    expect(withTech.strength).toBeGreaterThan(base.strength);
    expect(withTech.strength).toBeLessThanOrEqual(1);
  });
});

