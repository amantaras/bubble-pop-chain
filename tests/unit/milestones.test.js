import { describe, it, expect } from "vitest";
import {
  MILESTONE_EVERY,
  isMilestone,
  milestoneType,
  treasureReward,
  bossReward,
  bossConfig,
} from "../../src/milestones.js";
import { getLevel } from "../../src/levels.js";

describe("milestones", () => {
  it("fires every 5 levels", () => {
    expect(MILESTONE_EVERY).toBe(5);
    expect(isMilestone(5)).toBe(true);
    expect(isMilestone(10)).toBe(true);
    expect(isMilestone(4)).toBe(false);
    expect(isMilestone(7)).toBe(false);
    expect(isMilestone(0)).toBe(false);
  });

  it("alternates treasure and boss beats", () => {
    expect(milestoneType(5)).toBe("treasure");
    expect(milestoneType(15)).toBe("treasure");
    expect(milestoneType(25)).toBe("treasure");
    expect(milestoneType(35)).toBe("treasure");
    expect(milestoneType(10)).toBe("boss");
    expect(milestoneType(20)).toBe("boss");
    expect(milestoneType(30)).toBe("boss");
    expect(milestoneType(40)).toBe("boss");
    expect(milestoneType(1)).toBe(null);
    expect(milestoneType(12)).toBe(null);
  });

  it("never schedules two of the same beat back to back", () => {
    const beats = [];
    for (let i = 1; i <= 40; i++) {
      const t = milestoneType(i);
      if (t) beats.push(t);
    }
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i]).not.toBe(beats[i - 1]);
    }
  });

  it("treasure rewards scale and rotate the free power-up", () => {
    expect(treasureReward(5)).toEqual({ idx: 1, bonus: 125, powerup: "shuffle" });
    expect(treasureReward(15)).toEqual({ idx: 2, bonus: 150, powerup: "bomb" });
    expect(treasureReward(25)).toEqual({ idx: 3, bonus: 175, powerup: "colorClear" });
    expect(treasureReward(35)).toEqual({ idx: 4, bonus: 200, powerup: "chainBolt" });
    expect(treasureReward(10)).toBe(null); // bosses are not treasures
    expect(treasureReward(7)).toBe(null);
  });

  it("boss rewards scale and grant cosmetic themes in order", () => {
    expect(bossReward(10)).toEqual({ idx: 1, jackpot: 325, theme: "sunset" });
    expect(bossReward(20)).toEqual({ idx: 2, jackpot: 400, theme: "forest" });
    expect(bossReward(30)).toEqual({ idx: 3, jackpot: 475, theme: "candy" });
    expect(bossReward(40)).toEqual({ idx: 4, jackpot: 550, theme: "mono" });
    expect(bossReward(5)).toBe(null);
  });

  it("boss config grows the frozen core with the boss number", () => {
    const c10 = bossConfig(10);
    const c40 = bossConfig(40);
    expect(c10.coreCount).toBe(c10.coreW * c10.coreH);
    expect(c40.coreCount).toBeGreaterThan(c10.coreCount);
    expect(c40.extraMoves).toBeGreaterThan(c10.extraMoves);
    expect(bossConfig(15)).toBe(null);
  });

  it("the core always fits inside its boss level board", () => {
    for (const id of [10, 20, 30, 40]) {
      const lvl = getLevel(id);
      const cfg = bossConfig(id);
      if (cfg.kind === "frozen") {
        expect(cfg.coreW).toBeLessThanOrEqual(lvl.cols);
        expect(cfg.coreH).toBeLessThanOrEqual(lvl.rows);
      } else if (cfg.kind === "stone") {
        expect(cfg.vaultW).toBeLessThanOrEqual(lvl.cols);
        expect(cfg.vaultH).toBeLessThanOrEqual(lvl.rows);
      }
    }
  });

  it("boss archetypes rotate frozen → stone → color across the four bosses", () => {
    const f = bossConfig(10);
    expect(f.kind).toBe("frozen");
    expect(f.label).toBe("Frozen Core");
    expect(f.hudLabel).toBe("Core");

    const s = bossConfig(20);
    expect(s.kind).toBe("stone");
    expect(s.label).toBe("Stone Vault");
    expect(s.hudLabel).toBe("Stone");
    expect(s.objectiveCount).toBe(s.vaultW * s.vaultH);
    // A 2-row vault keeps every stone reachable by an adjacent pop.
    expect(s.vaultH).toBe(2);

    const c = bossConfig(30);
    expect(c.kind).toBe("color");
    expect(c.label).toBe("Colour Purge");
    expect(c.hudLabel).toBe("Left");
    // The colour boss has no fixed block — its target is chosen at runtime.
    expect(c.coreW).toBeUndefined();

    expect(bossConfig(40).kind).toBe("frozen");

    // Every archetype grants extra moves to keep the objective fair.
    for (const cfg of [f, s, c]) expect(cfg.extraMoves).toBeGreaterThan(0);
  });

  it("high boss objectives stay board-sized (tier cap) for the endless campaign", () => {
    // A very deep boss still produces a vault/core that fits the largest board
    // (cols ≤ 9, rows ≤ 11) instead of growing without bound.
    for (const id of [500, 1000, 9990]) {
      const cfg = bossConfig(id);
      expect(cfg).toBeTruthy();
      const lvl = getLevel(id);
      if (cfg.kind === "frozen") {
        expect(cfg.coreW).toBeLessThanOrEqual(lvl.cols);
        expect(cfg.coreH).toBeLessThanOrEqual(lvl.rows);
      } else if (cfg.kind === "stone") {
        expect(cfg.vaultW).toBeLessThanOrEqual(lvl.cols);
        expect(cfg.vaultH).toBeLessThanOrEqual(lvl.rows);
      }
      // Bonus moves stay sane (not thousands).
      expect(cfg.extraMoves).toBeLessThanOrEqual(40);
    }
  });
});

describe("levels with milestones", () => {
  it("tags milestone levels and gives bosses extra moves + a core", () => {
    const treasure = getLevel(5);
    expect(treasure.milestone).toBe("treasure");
    expect(treasure.boss).toBe(null);

    const boss = getLevel(10);
    expect(boss.milestone).toBe("boss");
    expect(boss.boss).toMatchObject({ coreW: expect.any(Number) });
    // Bosses suppress random ice so only the hand-placed core is frozen.
    expect(boss.specials.ice).toBe(0);

    // Boss move budget exceeds the equivalent non-milestone budget.
    const plain = getLevel(11);
    expect(boss.moves).toBeGreaterThan(plain.moves);
  });

  it("non-milestone levels carry no milestone metadata", () => {
    const lvl = getLevel(3);
    expect(lvl.milestone).toBe(null);
    expect(lvl.boss).toBe(null);
  });
});
