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
    // Sample across the ramp plus a few extreme levels (the campaign is
    // generative, so we spot-check rather than iterate all 9999).
    const sample = [1, 5, 12, 22, 40, 60, 99, 250, 1000, LEVEL_COUNT];
    for (const n of sample) {
      const lvl = getLevel(n);
      expect(lvl.cols).toBeGreaterThanOrEqual(6);
      expect(lvl.cols).toBeLessThanOrEqual(9);
      expect(lvl.rows).toBeGreaterThanOrEqual(8);
      expect(lvl.rows).toBeLessThanOrEqual(11);
      expect(lvl.colors).toBeLessThanOrEqual(6);
      expect(lvl.moves).toBeGreaterThanOrEqual(6);
      expect(lvl.target).toBeGreaterThan(0);
    }
  });

  it("difficulty ramps then plateaus at the cap so endless levels stay winnable", () => {
    // Two high, non-milestone levels share the capped difficulty, so all the
    // scaling fields match (only identity — seed/chapter/objective — differs).
    const a = getLevel(61);
    const b = getLevel(9991);
    for (const k of ["cols", "rows", "colors", "moves", "target"]) {
      expect(b[k]).toBe(a[k]);
    }
    expect(b.specials).toEqual(a.specials);
    // The plateau is the peak: a capped level is at least as hard as level 40.
    expect(getLevel(9991).target).toBeGreaterThanOrEqual(getLevel(40).target);
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

  it("bomb bubbles ramp in from level 16 and not before", () => {
    expect(getLevel(15).specials.bomb || 0).toBe(0);
    expect(getLevel(16).specials.bomb).toBeGreaterThan(0);
    // Rate climbs with level but stays very sparse (capped at 0.03).
    expect(getLevel(39).specials.bomb).toBeGreaterThanOrEqual(
      getLevel(16).specials.bomb
    );
    expect(getLevel(39).specials.bomb).toBeLessThanOrEqual(0.03);
  });

  it("multiplier bubbles ramp in from level 12 and not before", () => {
    expect(getLevel(11).specials.multiplier || 0).toBe(0);
    expect(getLevel(12).specials.multiplier).toBeGreaterThan(0);
    // Rate climbs with level but stays sparse (capped at 0.04).
    expect(getLevel(39).specials.multiplier).toBeGreaterThanOrEqual(
      getLevel(12).specials.multiplier
    );
    expect(getLevel(39).specials.multiplier).toBeLessThanOrEqual(0.04);
  });

  it("bosses suppress random stone bubbles (hand-placed frozen core only)", () => {
    // Level 20 is a boss; its random stone rate is forced to 0.
    const boss = getLevel(20);
    expect(boss.boss).toBeTruthy();
    expect(boss.specials.stone || 0).toBe(0);
  });

  it("resolves a well-formed chapter for every level, authored or procedural", () => {
    // Every level (including far-future procedural ones) maps to a chapter whose
    // range contains it. Sample densely early + a few extreme levels.
    const sample = [
      1, 8, 9, 40, 41, 48, 49, 96, 97, 250, 1000, 9999,
    ];
    for (const n of sample) {
      const ch = chapterForLevel(n);
      expect(ch.name).toBeTruthy();
      expect(ch.icon).toBeTruthy();
      expect(n).toBeGreaterThanOrEqual(ch.startLevel);
      expect(n).toBeLessThanOrEqual(ch.endLevel);
    }
  });

  it("generates procedural chapters past the authored worlds", () => {
    // The 5 authored chapters cover levels 1–40; level 41 opens a procedural
    // chapter with its own name/icon and a contiguous range.
    const authored = chapterForLevel(40);
    expect(CHAPTERS.map((c) => c.name)).toContain(authored.name);
    const proc = chapterForLevel(41);
    expect(CHAPTERS.map((c) => c.name)).not.toContain(proc.name);
    expect(proc.startLevel).toBe(41);
    expect(proc.endLevel).toBe(48);
    // Names stay distinct after a full cycle (Roman-numeral suffix).
    const farLater = chapterForLevel(41 + CHAPTERS.length * CHAPTER_SIZE * 100);
    expect(farLater.name).toBeTruthy();
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
    // Cover the full ramp plus extreme levels; objective goals must stay
    // bounded (achievable) on the endless plateau.
    const sample = [3, 4, 6, 7, 12, 19, 60, 99, 1000, 9999];
    for (const n of sample) {
      if (n % 5 === 0) continue; // milestone level, handled above
      const obj = objectiveForLevel(n);
      expect(obj).toBeTruthy();
      expect(["combo", "group", "nopowerup"]).toContain(obj.type);
      expect(obj.bonus).toBeGreaterThan(0);
      expect(typeof obj.label).toBe("string");
      if (obj.type !== "nopowerup") {
        expect(obj.goal).toBeGreaterThan(0);
        expect(obj.goal).toBeLessThanOrEqual(12); // capped, stays achievable
      }
      // Deterministic per level.
      expect(objectiveForLevel(n)).toEqual(obj);
    }
  });

  it("getLevel carries its bonus objective", () => {
    expect(getLevel(3).objective).toEqual(objectiveForLevel(3));
    expect(getLevel(5).objective).toBeNull();
  });
});
