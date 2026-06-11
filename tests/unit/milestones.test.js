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
    expect(treasureReward(5)).toEqual({ idx: 1, bonus: 125, powerup: "magnet" });
    expect(treasureReward(15)).toEqual({ idx: 2, bonus: 150, powerup: "bomb" });
    expect(treasureReward(25)).toEqual({ idx: 3, bonus: 175, powerup: "colorClear" });
    expect(treasureReward(35)).toEqual({ idx: 4, bonus: 200, powerup: "shuffle" });
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
      expect(cfg.coreW).toBeLessThanOrEqual(lvl.cols);
      expect(cfg.coreH).toBeLessThanOrEqual(lvl.rows);
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
