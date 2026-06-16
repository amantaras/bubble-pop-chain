import { describe, it, expect, beforeEach } from "vitest";
import { Storage } from "../../src/storage.js";

describe("storage", () => {
  beforeEach(() => {
    localStorage.clear();
    Storage.reset();
  });

  it("provides sane defaults", () => {
    expect(Storage.get("coins")).toBe(0);
    expect(Storage.get("maxUnlockedLevel")).toBe(1);
    expect(Storage.get("currentTheme")).toBe("aurora");
    expect(Storage.get("ownedThemes")).toContain("aurora");
    expect(Storage.get("adsRemoved")).toBe(false);
  });

  it("time attack high score defaults to 0 and round-trips", () => {
    expect(Storage.get("highScoreTimeAttack")).toBe(0);
    Storage.set("highScoreTimeAttack", 4200);
    expect(Storage.get("highScoreTimeAttack")).toBe(4200);
  });

  it("starter pack is unowned by default and round-trips", () => {
    expect(Storage.get("starterPack")).toBe(false);
    Storage.set("starterPack", true);
    expect(Storage.get("starterPack")).toBe(true);
  });

  it("idle move hints are on by default", () => {
    expect((Storage.get("settings") || {}).hints).toBe(true);
  });

  it("persists set() values to localStorage", () => {
    Storage.set("coins", 500);
    const raw = JSON.parse(localStorage.getItem("bpc_save_v1"));
    expect(raw.coins).toBe(500);
  });

  it("recordLevelResult only upgrades stars and unlocks the next level", () => {
    Storage.recordLevelResult(1, 2);
    expect(Storage.getStars(1)).toBe(2);
    expect(Storage.get("maxUnlockedLevel")).toBe(2);
    // a worse later attempt does not lower the record
    Storage.recordLevelResult(1, 1);
    expect(Storage.getStars(1)).toBe(2);
    // a better attempt upgrades it
    Storage.recordLevelResult(1, 3);
    expect(Storage.getStars(1)).toBe(3);
  });

  it("totalStars sums all recorded stars", () => {
    Storage.recordLevelResult(1, 3);
    Storage.recordLevelResult(2, 2);
    expect(Storage.totalStars()).toBe(5);
  });

  it("level best score defaults to 0 and is unset initially", () => {
    expect(Storage.getLevelScore(3)).toBe(0);
  });

  it("recordLevelScore keeps the highest and flags a genuine new best", () => {
    // First clear: a best is set but it is NOT a "new best" (nothing to beat).
    let res = Storage.recordLevelScore(3, 500);
    expect(res.best).toBe(500);
    expect(res.isNewBest).toBe(false);
    expect(Storage.getLevelScore(3)).toBe(500);

    // A lower score does not lower the record and is not a new best.
    res = Storage.recordLevelScore(3, 300);
    expect(res.best).toBe(500);
    expect(res.isNewBest).toBe(false);
    expect(Storage.getLevelScore(3)).toBe(500);

    // Beating the record is a new best and updates the stored value.
    res = Storage.recordLevelScore(3, 800);
    expect(res.best).toBe(800);
    expect(res.isNewBest).toBe(true);
    expect(Storage.getLevelScore(3)).toBe(800);
  });

  it("reset restores a complete default save", () => {
    Storage.set("coins", 999);
    Storage.reset();
    // Every documented default key must be present after a reset.
    for (const key of [
      "version",
      "maxUnlockedLevel",
      "stars",
      "highScoreEndless",
      "highScoreTimeAttack",
      "coins",
      "ownedThemes",
      "currentTheme",
      "adsRemoved",
      "muted",
      "powerups",
      "loadout",
      "adRewards",
      "daily",
    ]) {
      expect(Storage.get(key)).not.toBeUndefined();
    }
    expect(Storage.get("coins")).toBe(0);
  });

  it("activeSession defaults to null and round-trips an object snapshot", () => {
    expect(Storage.get("activeSession")).toBeNull();
    const snap = {
      mode: "campaign",
      levelId: 3,
      score: 420,
      movesLeft: 7,
      revived: false,
      ended: false,
      grid: [[0, 1], [-1, 2]],
    };
    Storage.set("activeSession", snap);
    const raw = JSON.parse(localStorage.getItem("bpc_save_v1"));
    expect(raw.activeSession).toEqual(snap);
    // Clearing it stores null again.
    Storage.set("activeSession", null);
    expect(Storage.get("activeSession")).toBeNull();
  });

  it("tutorialBackup defaults to null and round-trips the inventory snapshot", () => {
    // No tutorial in progress → no backup.
    expect(Storage.get("tutorialBackup")).toBeNull();
    const snap = {
      powerups: { bomb: 42, colorClear: 0, shuffle: 3, chainBolt: 0, pick: 0, magnet: 1 },
      loadout: ["pick", "shuffle", "chainBolt"],
      pets: {
        owned: { sparky: { xp: 0, cosmetics: ["default"], cosmetic: "default" } },
        equipped: "sparky",
        crates: 1,
      },
    };
    Storage.set("tutorialBackup", snap);
    const raw = JSON.parse(localStorage.getItem("bpc_save_v1"));
    expect(raw.tutorialBackup).toEqual(snap);
    // Clearing it (tutorial finished) stores null again.
    Storage.set("tutorialBackup", null);
    expect(Storage.get("tutorialBackup")).toBeNull();
  });

  it("records milestone clears exactly once (non-farmable)", () => {
    expect(Storage.hasClearedMilestone(5)).toBe(false);
    expect(Storage.recordMilestone(5)).toBe(true);
    expect(Storage.hasClearedMilestone(5)).toBe(true);
    // Replaying the same milestone never pays out again.
    expect(Storage.recordMilestone(5)).toBe(false);
    expect(Storage.get("milestonesCleared")).toEqual([5]);
    // A different milestone records independently.
    expect(Storage.recordMilestone(10)).toBe(true);
    expect(Storage.get("milestonesCleared")).toEqual([5, 10]);
  });

  it("achievement state defaults are well-formed and round-trip", () => {
    const init = Storage.getAchievementState();
    expect(init.claims).toEqual({});
    expect(init.progress.pops).toBe(0);
    expect(init.progress.totalStars).toBe(0);
    // Persisting and reading back keeps the shape.
    Storage.setAchievementState({
      claims: { popper: 2 },
      progress: { pops: 3, bestCombo: 5 },
    });
    const after = Storage.getAchievementState();
    expect(after.claims).toEqual({ popper: 2 });
    expect(after.progress.pops).toBe(3);
    expect(after.progress.bestCombo).toBe(5);
    // It really hit localStorage.
    const raw = JSON.parse(localStorage.getItem("bpc_save_v1"));
    expect(raw.achievements.claims).toEqual({ popper: 2 });
  });

  it("settings default to colorblind off and round-trip", () => {
    expect(Storage.get("settings")).toEqual({
      colorblind: false,
      hints: true,
      reducedMotion: false,
      buyRepeatMs: 500,
    });
    Storage.set("settings", { colorblind: true });
    expect(Storage.get("settings").colorblind).toBe(true);
    const raw = JSON.parse(localStorage.getItem("bpc_save_v1"));
    expect(raw.settings.colorblind).toBe(true);
  });

  it("reduced-motion defaults to off and round-trips", () => {
    expect((Storage.get("settings") || {}).reducedMotion).toBe(false);
    const s = { ...Storage.get("settings"), reducedMotion: true };
    Storage.set("settings", s);
    expect(Storage.get("settings").reducedMotion).toBe(true);
    const raw = JSON.parse(localStorage.getItem("bpc_save_v1"));
    expect(raw.settings.reducedMotion).toBe(true);
  });

  it("hold-to-buy repeat rate defaults to 500ms (2 per second) and round-trips", () => {
    expect(Storage.get("settings").buyRepeatMs).toBe(500);
    const s = { ...Storage.get("settings"), buyRepeatMs: 250 };
    Storage.set("settings", s);
    expect(Storage.get("settings").buyRepeatMs).toBe(250);
  });

  it("grantTheme adds a theme to ownership only once", () => {
    expect(Storage.get("ownedThemes")).not.toContain("forest");
    expect(Storage.grantTheme("forest")).toBe(true);
    expect(Storage.get("ownedThemes")).toContain("forest");
    expect(Storage.grantTheme("forest")).toBe(false);
    // Already-owned default themes are not re-added.
    expect(Storage.grantTheme("aurora")).toBe(false);
  });

  describe("power-up loadout (quick-access HUD slots)", () => {
    it("defaults to three distinct power-ups", () => {
      const lo = Storage.getLoadout();
      expect(lo).toHaveLength(3);
      expect(new Set(lo).size).toBe(3);
      expect(lo).toEqual(["bomb", "colorClear", "magnet"]);
    });

    it("getLoadout returns a copy, not the live array", () => {
      const lo = Storage.getLoadout();
      lo[0] = "shuffle";
      expect(Storage.getLoadout()[0]).toBe("bomb");
    });

    it("setLoadoutSlot places a new power-up in a slot and persists it", () => {
      expect(Storage.setLoadoutSlot(1, "shuffle")).toBe(true);
      expect(Storage.getLoadout()).toEqual(["bomb", "shuffle", "magnet"]);
      const raw = JSON.parse(localStorage.getItem("bpc_save_v1"));
      expect(raw.loadout).toEqual(["bomb", "shuffle", "magnet"]);
    });

    it("swaps when the chosen power-up already occupies another slot", () => {
      // magnet is in slot 2; assigning it to slot 0 swaps slot 0's bomb into 2.
      Storage.setLoadoutSlot(0, "magnet");
      expect(Storage.getLoadout()).toEqual(["magnet", "colorClear", "bomb"]);
      expect(new Set(Storage.getLoadout()).size).toBe(3);
    });

    it("rejects out-of-range slot indices", () => {
      expect(Storage.setLoadoutSlot(-1, "bomb")).toBe(false);
      expect(Storage.setLoadoutSlot(3, "bomb")).toBe(false);
      expect(Storage.getLoadout()).toEqual(["bomb", "colorClear", "magnet"]);
    });
  });

  describe("pets", () => {
    it("starts with Sparky owned, equipped, and one starter crate", () => {
      const p = Storage.getPetState();
      expect(p.equipped).toBe("sparky");
      expect(p.owned.sparky).toBeTruthy();
      expect(p.crates).toBe(1);
      expect(Storage.ownsPet("sparky")).toBe(true);
      expect(Storage.ownsPet("draco")).toBe(false);
    });

    it("grantPet is idempotent (true only the first time)", () => {
      expect(Storage.grantPet("draco")).toBe(true);
      expect(Storage.grantPet("draco")).toBe(false);
      expect(Storage.ownsPet("draco")).toBe(true);
      expect(Storage.getPetState().owned.draco.xp).toBe(0);
    });

    it("stores a trait on a granted pet and reads it back", () => {
      Storage.grantPet("draco", "swift");
      expect(Storage.getPetState().owned.draco.trait).toBe("swift");
      expect(Storage.getPetTrait("draco")).toBe("swift");
      // Default trait is balanced when none is given.
      Storage.grantPet("clover");
      expect(Storage.getPetTrait("clover")).toBe("balanced");
      // Unowned pets report no trait.
      expect(Storage.getPetTrait("ghost")).toBeNull();
    });

    it("starter Sparky carries the balanced trait", () => {
      expect(Storage.getPetTrait("sparky")).toBe("balanced");
    });

    it("accumulates XP only for owned pets", () => {
      Storage.addPetXp("sparky", 40);
      expect(Storage.getPetState().owned.sparky.xp).toBe(40);
      Storage.addPetXp("ghost", 40); // not owned — no-op
      expect(Storage.getPetState().owned.ghost).toBeUndefined();
    });

    it("equips only owned pets and updates getEquippedPet", () => {
      expect(Storage.equipPet("draco")).toBe(false);
      Storage.grantPet("draco");
      expect(Storage.equipPet("draco")).toBe(true);
      const eq = Storage.getEquippedPet();
      expect(eq.id).toBe("draco");
      expect(eq.xp).toBe(0);
    });

    it("adds and consumes crates without going negative", () => {
      Storage.addCrates(2);
      expect(Storage.getPetState().crates).toBe(3); // 1 starter + 2
      expect(Storage.consumeCrate()).toBe(true);
      expect(Storage.consumeCrate()).toBe(true);
      expect(Storage.consumeCrate()).toBe(true);
      expect(Storage.consumeCrate()).toBe(false); // none left
      expect(Storage.getPetState().crates).toBe(0);
    });

    it("grants and selects cosmetics idempotently", () => {
      expect(Storage.grantCosmetic("sparky", "sunset")).toBe(true);
      expect(Storage.grantCosmetic("sparky", "sunset")).toBe(false);
      expect(Storage.setCosmetic("sparky", "sunset")).toBe(true);
      expect(Storage.getPetState().owned.sparky.cosmetic).toBe("sunset");
      // Cosmetics on an unowned pet are rejected.
      expect(Storage.grantCosmetic("ghost", "ocean")).toBe(false);
    });

    it("persists pet state across a fresh read", () => {
      Storage.grantPet("draco");
      Storage.addCrates(4);
      const raw = JSON.parse(localStorage.getItem("bpc_save_v1"));
      expect(raw.pets.owned.draco).toBeTruthy();
      expect(raw.pets.crates).toBe(5);
    });

    it("defaults dust and pity to zero", () => {
      const p = Storage.getPetState();
      expect(p.dust).toBe(0);
      expect(p.pity).toEqual({ sinceEpic: 0, sinceLegendary: 0 });
    });

    it("adds, spends and clamps dust", () => {
      expect(Storage.getDust()).toBe(0);
      expect(Storage.addDust(50)).toBe(50);
      expect(Storage.getDust()).toBe(50);
      expect(Storage.spendDust(30)).toBe(true);
      expect(Storage.getDust()).toBe(20);
      expect(Storage.spendDust(999)).toBe(false); // can't overspend
      expect(Storage.getDust()).toBe(20);
      Storage.addDust(-100); // never goes negative
      expect(Storage.getDust()).toBe(0);
    });

    it("reads and writes pity counters", () => {
      Storage.setPity({ sinceEpic: 4, sinceLegendary: 9 });
      expect(Storage.getPity()).toEqual({ sinceEpic: 4, sinceLegendary: 9 });
      Storage.setPity({ sinceEpic: -3, sinceLegendary: 0 }); // clamps to 0
      expect(Storage.getPity()).toEqual({ sinceEpic: 0, sinceLegendary: 0 });
    });

    it("persists dust and pity across a fresh read", () => {
      Storage.addDust(75);
      Storage.setPity({ sinceEpic: 3, sinceLegendary: 7 });
      const raw = JSON.parse(localStorage.getItem("bpc_save_v1"));
      expect(raw.pets.dust).toBe(75);
      expect(raw.pets.pity).toEqual({ sinceEpic: 3, sinceLegendary: 7 });
    });
  });
});
