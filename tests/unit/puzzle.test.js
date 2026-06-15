import { describe, it, expect } from "vitest";
import {
  PUZZLES,
  PUZZLE_COUNT,
  PUZZLE_STAR_RATIOS,
  getPuzzle,
  puzzleStars,
  isPuzzleUnlocked,
  puzzlesSolved,
} from "../../src/puzzle.js";

describe("puzzle mode", () => {
  it("exposes a non-empty, well-formed puzzle ladder", () => {
    expect(PUZZLE_COUNT).toBe(PUZZLES.length);
    expect(PUZZLE_COUNT).toBeGreaterThan(0);
    for (const p of PUZZLES) {
      expect(p.cols).toBeGreaterThan(0);
      expect(p.rows).toBeGreaterThan(0);
      expect(p.colors).toBeGreaterThanOrEqual(3);
      expect(p.moves).toBeGreaterThan(0);
      expect(Number.isFinite(p.seed)).toBe(true);
    }
  });

  it("builds a level-like definition with a stable id and clear-the-board goal", () => {
    const def = getPuzzle(0);
    expect(def.id).toBe("puzzle-1");
    expect(def.puzzleIndex).toBe(0);
    expect(def.target).toBe(0);
    expect(def.cols).toBe(PUZZLES[0].cols);
    expect(def.moves).toBe(PUZZLES[0].moves);
    expect(typeof def.specials).toBe("object");
  });

  it("clamps out-of-range indices into the ladder", () => {
    expect(getPuzzle(-5).puzzleIndex).toBe(0);
    expect(getPuzzle(9999).puzzleIndex).toBe(PUZZLE_COUNT - 1);
  });

  it("awards more stars the more moves are left over", () => {
    const total = 40;
    // No headroom → 1 star; comfortable → 2; lots to spare → 3.
    expect(puzzleStars(0, total)).toBe(1);
    expect(puzzleStars(Math.ceil(total * PUZZLE_STAR_RATIOS.two), total)).toBe(2);
    expect(puzzleStars(Math.ceil(total * PUZZLE_STAR_RATIOS.three), total)).toBe(3);
    expect(puzzleStars(total, total)).toBe(3);
  });

  it("never returns fewer than 1 or more than 3 stars", () => {
    for (let left = 0; left <= 50; left++) {
      const s = puzzleStars(left, 50);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(3);
    }
  });

  it("unlocks the first puzzle always and the rest only after a solve", () => {
    expect(isPuzzleUnlocked(0, {})).toBe(true);
    expect(isPuzzleUnlocked(1, {})).toBe(false);
    expect(isPuzzleUnlocked(1, { 0: 1 })).toBe(true);
    expect(isPuzzleUnlocked(1, { 0: 3 })).toBe(true);
    // A previous puzzle that exists but is unsolved keeps the next one locked.
    expect(isPuzzleUnlocked(2, { 0: 3 })).toBe(false);
    expect(isPuzzleUnlocked(2, { 0: 3, 1: 2 })).toBe(true);
  });

  it("treats indices past the ladder as locked", () => {
    expect(isPuzzleUnlocked(PUZZLE_COUNT, { [PUZZLE_COUNT - 1]: 3 })).toBe(false);
  });

  it("counts solved puzzles (≥1 star)", () => {
    expect(puzzlesSolved({})).toBe(0);
    expect(puzzlesSolved({ 0: 1, 1: 0, 2: 3 })).toBe(2);
    expect(puzzlesSolved(null)).toBe(0);
  });
});
