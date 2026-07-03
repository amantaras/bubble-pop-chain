import { describe, it, expect } from "vitest";
import {
  getLevel,
  starThresholds,
  LEVEL_COUNT,
  CHAPTERS,
  CHAPTER_SIZE,
  chapterForLevel,
  objectiveForLevel,
  featuredMechanicIds,
  NEW_MECHANIC_IDS,
  MAX_NEW_MECHANICS_PER_BOARD,
} from "../../src/levels.js";

import { downpourForLevel, DOWNPOUR_MIN_LEVEL } from "../../src/levels.js";

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

  it("coin bubbles ramp in from level 8 and not before", () => {
    expect(getLevel(7).specials.coin || 0).toBe(0);
    expect(getLevel(8).specials.coin).toBeGreaterThan(0);
    expect(getLevel(39).specials.coin).toBeGreaterThanOrEqual(
      getLevel(8).specials.coin
    );
    expect(getLevel(39).specials.coin).toBeLessThanOrEqual(0.035);
  });

  it("vine bubbles ramp in from level 20 and not before", () => {
    expect(getLevel(19).specials.vine || 0).toBe(0);
    // Level 21 is not a boss, so its vine rate is live once past the ramp.
    expect(getLevel(21).specials.vine).toBeGreaterThan(0);
    expect(getLevel(39).specials.vine).toBeLessThanOrEqual(0.02);
  });

  it("sequence (Chain Reactor) bubbles ramp in from level 24 and not before", () => {
    expect(getLevel(23).specials.sequence || 0).toBe(0);
    expect(getLevel(24).specials.sequence).toBeGreaterThan(0);
    expect(getLevel(39).specials.sequence).toBeGreaterThanOrEqual(
      getLevel(24).specials.sequence
    );
    expect(getLevel(39).specials.sequence).toBeLessThanOrEqual(0.03);
  });

  it("bosses do NOT suppress sequence bubbles (a reward, not a hazard)", () => {
    // Level 60 is a boss beyond level 24, so sequence should stay live there,
    // unlike ice/stone/vine which bosses always force to 0.
    const boss = getLevel(60);
    expect(boss.boss).toBeTruthy();
    expect(boss.specials.sequence).toBeGreaterThan(0);
  });

  it("bosses suppress random stone bubbles (hand-placed frozen core only)", () => {
    // Level 20 is a boss; its random stone rate is forced to 0.
    const boss = getLevel(20);
    expect(boss.boss).toBeTruthy();
    expect(boss.specials.stone || 0).toBe(0);
    // Vines are a creeping threat, also suppressed on bosses.
    expect(boss.specials.vine || 0).toBe(0);
  });

  it("tether bubbles ramp in from level 28 and not before", () => {
    expect(getLevel(27).specials.tether || 0).toBe(0);
    expect(getLevel(28).specials.tether).toBeGreaterThan(0);
    // Rate climbs with level but stays capped. Checked at level 35 (before
    // Bloom unlocks at 36) so the mechanic rotation budget — which only
    // engages once the tether/polarity/bloom pool exceeds its cap — can't
    // incidentally exclude tether from this particular comparison level.
    expect(getLevel(35).specials.tether).toBeGreaterThanOrEqual(
      getLevel(28).specials.tether
    );
    expect(getLevel(35).specials.tether).toBeLessThanOrEqual(0.03);
  });

  it("bosses do NOT suppress tether bubbles (a reward, not a hazard)", () => {
    // Level 60 is a boss beyond level 28, so tether should stay live there,
    // unlike ice/stone/vine which bosses always force to 0.
    const boss = getLevel(60);
    expect(boss.boss).toBeTruthy();
    expect(boss.specials.tether).toBeGreaterThan(0);
  });

  it("polarity bubbles ramp in from level 32 and not before", () => {
    expect(getLevel(31).specials.polarity || 0).toBe(0);
    expect(getLevel(32).specials.polarity).toBeGreaterThan(0);
    // Rate climbs with level but stays capped. Checked at level 35 (before
    // Bloom unlocks at 36) so the mechanic rotation budget can't incidentally
    // exclude polarity from this particular comparison level.
    expect(getLevel(35).specials.polarity).toBeGreaterThanOrEqual(
      getLevel(32).specials.polarity
    );
    expect(getLevel(35).specials.polarity).toBeLessThanOrEqual(0.03);
  });

  it("bosses do NOT suppress polarity bubbles (a reward, not a hazard)", () => {
    const boss = getLevel(60);
    expect(boss.boss).toBeTruthy();
    expect(boss.specials.polarity).toBeGreaterThan(0);
  });

  it("bloom bubbles ramp in from level 36 and not before", () => {
    expect(getLevel(35).specials.bloom || 0).toBe(0);
    expect(getLevel(36).specials.bloom).toBeGreaterThan(0);
  });

  it("bosses do NOT suppress bloom bubbles (a reward, not a hazard)", () => {
    // Level 50 is a boss beyond level 36 where the rotation budget happens to
    // feature bloom — proving bosses don't force it to 0 like ice/stone/vine.
    const boss = getLevel(50);
    expect(boss.boss).toBeTruthy();
    expect(boss.specials.bloom).toBeGreaterThan(0);
  });

  it("tether, polarity and bloom are NOT all three featured on every board once bloom unlocks", () => {
    // The pool (3) now exceeds MAX_NEW_MECHANICS_PER_BOARD (2), so the budget
    // must actually trim at least one of them on SOME level beyond 36 — this
    // is the concrete proof the rotation engages for real, not just infra.
    let sawSuppression = false;
    for (let n = 36; n <= 200; n++) {
      const sp = getLevel(n).specials;
      const activeCount = ["tether", "polarity", "bloom"].filter((id) => sp[id] > 0).length;
      if (activeCount < 3) {
        sawSuppression = true;
        break;
      }
    }
    expect(sawSuppression).toBe(true);
  });

  it("never features MORE than MAX_NEW_MECHANICS_PER_BOARD of tether/polarity/bloom on one board", () => {
    for (const n of [36, 40, 55, 61, 100, 250, 1000]) {
      const sp = getLevel(n).specials;
      const activeCount = ["tether", "polarity", "bloom"].filter((id) => sp[id] > 0).length;
      expect(activeCount).toBeLessThanOrEqual(2);
    }
  });

  it("tether and polarity happen to both be featured at level 60 (bloom is the one rotated out there)", () => {
    // Level 60's rotation deterministically spares tether+polarity and
    // excludes bloom (see the "never features MORE than..." test above for
    // the general guarantee) — this documents that concrete, reproducible
    // outcome for this specific level.
    const lvl = getLevel(60);
    expect(lvl.specials.tether).toBeGreaterThan(0);
    expect(lvl.specials.polarity).toBeGreaterThan(0);
    expect(lvl.specials.bloom || 0).toBe(0);
  });

  describe("featuredMechanicIds (board mechanic budget)", () => {
    it("returns every id unchanged when the pool is at or under the cap", () => {
      expect(featuredMechanicIds([], "seed-empty", 2)).toEqual([]);
      const one = featuredMechanicIds(["a"], "seed-1", 2);
      expect(one).toEqual(["a"]);
      const two = featuredMechanicIds(["a", "b"], "seed-2", 2);
      expect(two.slice().sort()).toEqual(["a", "b"]);
    });

    it("caps the featured set once the pool exceeds the cap, deterministically by seed", () => {
      const ids = ["a", "b", "c", "d", "e"];
      const a = featuredMechanicIds(ids, "level-42", 2);
      const b = featuredMechanicIds(ids, "level-42", 2);
      expect(a).toHaveLength(2);
      expect(a).toEqual(b); // same seed -> same featured subset (reproducible)
      for (const id of a) expect(ids).toContain(id);
    });

    it("rotates which subset is featured across different seeds", () => {
      const ids = ["a", "b", "c", "d", "e", "f"];
      const seen = new Set();
      for (let i = 0; i < 20; i++) {
        seen.add(featuredMechanicIds(ids, `level-${i}`, 2).slice().sort().join(","));
      }
      expect(seen.size).toBeGreaterThan(1); // varies rather than a fixed pick
    });

    it("today's real pool (Tether + Polarity + Bloom) now exceeds the cap, so the rotation genuinely trims one per board", () => {
      // Documents the current state of the rotation: with three real ids now
      // registered, the pool exceeds MAX_NEW_MECHANICS_PER_BOARD, so this is
      // no longer just dormant infrastructure — it actively rotates which two
      // of the three are featured on any given board (see the dedicated
      // "never features MORE than..." / "NOT all three featured" tests above
      // for the concrete proof).
      expect(NEW_MECHANIC_IDS.length).toBeGreaterThan(MAX_NEW_MECHANICS_PER_BOARD);
    });
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

  it("downpour kicks in only on advanced, non-milestone campaign levels", () => {
    // Below the threshold: no Tetris-style pressure anywhere in the early game.
    expect(downpourForLevel(1)).toBeNull();
    expect(downpourForLevel(20)).toBeNull();
    expect(downpourForLevel(DOWNPOUR_MIN_LEVEL - 1)).toBeNull();
    // The threshold level itself (30) is a boss milestone, so it's suppressed;
    // the first ordinary level past it gets the gentlest cadence.
    expect(downpourForLevel(30)).toBeNull(); // boss
    expect(downpourForLevel(35)).toBeNull(); // treasure
    expect(downpourForLevel(31)).toEqual({ interval: 6 });
  });

  it("downpour cadence tightens with difficulty then floors at every 3 moves", () => {
    expect(downpourForLevel(31).interval).toBe(6);
    expect(downpourForLevel(41).interval).toBe(5);
    expect(downpourForLevel(51).interval).toBe(4);
    // Past the difficulty cap it plateaus at the fastest (every 3 moves).
    expect(downpourForLevel(61).interval).toBe(3);
    expect(downpourForLevel(9991).interval).toBe(3);
    // Never faster than every 3 moves, so boards always stay clearable.
    for (const n of [31, 55, 120, 500, 9999]) {
      const d = downpourForLevel(n);
      if (d) expect(d.interval).toBeGreaterThanOrEqual(3);
    }
  });

  it("getLevel carries its downpour config", () => {
    expect(getLevel(31).downpour).toEqual(downpourForLevel(31));
    expect(getLevel(10).downpour).toBeNull();
  });
});
