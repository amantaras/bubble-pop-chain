import { describe, it, expect } from "vitest";
import {
  getLevel,
  starThresholds,
  LEVEL_COUNT,
  CHAPTERS,
  CHAPTER_SIZE,
  chapterForLevel,
  objectiveForLevel,
} from "../../src/levels.js";

describe("levels", () => {
  it("exposes a positive level count", () => {
    expect(LEVEL_COUNT).toBeGreaterThan(0);
  });

  it("clamps ids into the valid range", () => {
    expect(getLevel(0).id).toBe(1);
    expect(getLevel(-5).id).toBe(1);
    expect(getLevel(LEVEL_COUNT + 99).id).toBe(LEVEL_COUNT);
  });

  it("is deterministic (same seed per id)", () => {
    expect(getLevel(7).seed).toBe(getLevel(7).seed);
    expect(getLevel(7).seed).not.toBe(getLevel(8).seed);
  });

  it("difficulty curve scales up across all 4 colour tiers", () => {
    expect(getLevel(1).colors).toBe(3);
    expect(getLevel(6).colors).toBe(4);
    expect(getLevel(15).colors).toBe(5);
    expect(getLevel(30).colors).toBe(6);
  });

  it("board grows and stays within sane bounds", () => {
    const early = getLevel(1);
    const late = getLevel(LEVEL_COUNT);
    expect(late.cols).toBeGreaterThanOrEqual(early.cols);
    expect(late.rows).toBeGreaterThanOrEqual(early.rows);
    for (let n = 1; n <= LEVEL_COUNT; n++) {
      const lvl = getLevel(n);
      expect(lvl.cols).toBeGreaterThanOrEqual(6);
      expect(lvl.rows).toBeGreaterThanOrEqual(8);
      expect(lvl.moves).toBeGreaterThanOrEqual(6);
      expect(lvl.target).toBeGreaterThan(0);
    }
  });

  it("targets rise with level number", () => {
    expect(getLevel(20).target).toBeGreaterThan(getLevel(2).target);
  });

  it("star thresholds are strictly increasing", () => {
    const t = starThresholds(getLevel(10));
    expect(t.two).toBeGreaterThan(t.one);
    expect(t.three).toBeGreaterThan(t.two);
  });

  it("lightning bubbles ramp in from level 14 and not before", () => {
    expect(getLevel(13).specials.lightning || 0).toBe(0);
    expect(getLevel(14).specials.lightning).toBeGreaterThan(0);
    // Rate climbs with level but stays capped.
    expect(getLevel(40).specials.lightning).toBeGreaterThanOrEqual(
      getLevel(14).specials.lightning
    );
    expect(getLevel(40).specials.lightning).toBeLessThanOrEqual(0.04);
  });

  it("stone bubbles ramp in from level 18 and not before", () => {
    expect(getLevel(17).specials.stone || 0).toBe(0);
    expect(getLevel(18).specials.stone).toBeGreaterThan(0);
    // Rate climbs with level but stays capped (level 39 is a non-boss level).
    expect(getLevel(39).specials.stone).toBeGreaterThanOrEqual(
      getLevel(18).specials.stone
    );
    expect(getLevel(39).specials.stone).toBeLessThanOrEqual(0.06);
  });

  it("bosses suppress random stone bubbles (hand-placed frozen core only)", () => {
    // Level 20 is a boss; its random stone rate is forced to 0.
    const boss = getLevel(20);
    expect(boss.boss).toBeTruthy();
    expect(boss.specials.stone || 0).toBe(0);
  });

  it("groups every level into a chapter and covers the whole campaign", () => {
    // Chapters tile the campaign contiguously with no gaps or overlaps.
    expect(CHAPTERS.length * CHAPTER_SIZE).toBeGreaterThanOrEqual(LEVEL_COUNT);
    for (let n = 1; n <= LEVEL_COUNT; n++) {
      const ch = chapterForLevel(n);
      expect(ch.name).toBeTruthy();
      expect(ch.icon).toBeTruthy();
      expect(n).toBeGreaterThanOrEqual(ch.startLevel);
      expect(n).toBeLessThanOrEqual(ch.endLevel);
    }
  });

  it("chapter boundaries land on CHAPTER_SIZE multiples", () => {
    expect(chapterForLevel(1).startLevel).toBe(1);
    expect(chapterForLevel(CHAPTER_SIZE).endLevel).toBe(CHAPTER_SIZE);
    expect(chapterForLevel(CHAPTER_SIZE + 1).startLevel).toBe(CHAPTER_SIZE + 1);
    // Successive levels stay in the same chapter until the size boundary.
    expect(chapterForLevel(1).id).toBe(chapterForLevel(CHAPTER_SIZE).id);
    expect(chapterForLevel(1).id).not.toBe(
      chapterForLevel(CHAPTER_SIZE + 1).id
    );
  });

  it("getLevel carries its chapter metadata", () => {
    const lvl = getLevel(10);
    expect(lvl.chapter).toBeTruthy();
    expect(lvl.chapter.name).toBe(chapterForLevel(10).name);
  });

  it("bonus objectives are skipped early and on milestone beats", () => {
    expect(objectiveForLevel(1)).toBeNull();
    expect(objectiveForLevel(2)).toBeNull();
    // 5/10/15... are treasure/boss milestone levels — no extra objective.
    expect(objectiveForLevel(5)).toBeNull();
    expect(objectiveForLevel(10)).toBeNull();
  });

  it("ordinary levels get a deterministic, well-formed objective", () => {
    for (let n = 3; n <= LEVEL_COUNT; n++) {
      const obj = objectiveForLevel(n);
      if (n % 5 === 0) continue; // milestone level, handled above
      expect(obj).toBeTruthy();
      expect(["combo", "group", "nopowerup"]).toContain(obj.type);
      expect(obj.bonus).toBeGreaterThan(0);
      expect(typeof obj.label).toBe("string");
      if (obj.type !== "nopowerup") expect(obj.goal).toBeGreaterThan(0);
      // Deterministic per level.
      expect(objectiveForLevel(n)).toEqual(obj);
    }
  });

  it("getLevel carries its bonus objective", () => {
    expect(getLevel(3).objective).toEqual(objectiveForLevel(3));
    expect(getLevel(5).objective).toBeNull();
  });
});
