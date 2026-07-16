import { describe, it, expect } from "vitest";
import {
  PUZZLES,
  PUZZLE_COUNT,
  PUZZLE_STAR_RATIOS,
  PUZZLE_TYPE_META,
  getPuzzle,
  puzzleStars,
  isPuzzleUnlocked,
  puzzlesSolved,
  puzzleTypeMeta,
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
    // The original ladder defaults to the classic "clear the whole board" goal.
    expect(def.puzzleType).toBe("clear");
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

// New objective types (13+): a puzzle can now demand something narrower than
// "pop everything", reusing the exact boss archetypes from milestones.js so
// the mechanic is already proven — only the puzzle *data* is new.
describe("puzzle objective types", () => {
  it("resolves objective metadata for every type, defaulting unknowns to clear", () => {
    for (const type of Object.keys(PUZZLE_TYPE_META)) {
      const meta = puzzleTypeMeta(type);
      expect(meta.icon).toBeTruthy();
      expect(meta.label).toBeTruthy();
      expect(meta.hudLabel).toBeTruthy();
      expect(meta.intro).toBeTruthy();
    }
    expect(puzzleTypeMeta("nonsense")).toBe(PUZZLE_TYPE_META.clear);
    expect(puzzleTypeMeta(undefined)).toBe(PUZZLE_TYPE_META.clear);
  });

  it("grew the ladder beyond the original 12 clear-the-board puzzles", () => {
    expect(PUZZLE_COUNT).toBeGreaterThan(12);
    // The original 12 are completely untouched (still implicitly "clear").
    for (let i = 0; i < 12; i++) {
      expect(getPuzzle(i).puzzleType).toBe("clear");
    }
  });

  it("includes at least one frozen, one stone and one colour puzzle beyond index 12", () => {
    const types = new Set();
    for (let i = 12; i < PUZZLE_COUNT; i++) types.add(getPuzzle(i).puzzleType);
    expect(types.has("frozen")).toBe(true);
    expect(types.has("stone")).toBe(true);
    expect(types.has("color")).toBe(true);
  });

  it("passes through core/vault sizing for frozen/stone puzzles, fitting inside the board", () => {
    for (let i = 0; i < PUZZLE_COUNT; i++) {
      const def = getPuzzle(i);
      if (def.puzzleType === "frozen") {
        expect(def.coreW).toBeGreaterThan(0);
        expect(def.coreH).toBeGreaterThan(0);
        expect(def.coreW).toBeLessThan(def.cols);
        expect(def.coreH).toBeLessThan(def.rows);
      } else if (def.puzzleType === "stone") {
        expect(def.vaultW).toBeGreaterThan(0);
        expect(def.vaultH).toBeGreaterThan(0);
        expect(def.vaultW).toBeLessThan(def.cols);
        expect(def.vaultH).toBeLessThan(def.rows);
      } else if (def.puzzleType === "color") {
        expect(def.coreW).toBeUndefined();
        expect(def.vaultW).toBeUndefined();
      }
    }
  });

  it("still unlocks/solves sequentially across the extended ladder", () => {
    expect(isPuzzleUnlocked(12, {})).toBe(false);
    expect(isPuzzleUnlocked(12, { 11: 1 })).toBe(true);
    expect(isPuzzleUnlocked(PUZZLE_COUNT - 1, {})).toBe(false);
  });
});

// Extended ladder (19+): grew the ladder again beyond the original 18-puzzle
// set with tighter budgets and bigger cores/vaults, still reusing the exact
// same objective types and board-size ceiling (9x11) the campaign itself
// already proves out at high levels.
describe("extended puzzle ladder (19+)", () => {
  it("grew the ladder beyond the prior 18-puzzle set", () => {
    expect(PUZZLE_COUNT).toBeGreaterThanOrEqual(24);
    // Puzzles 1-18 keep their exact original seeds (fixed boards must never
    // silently change under existing players who have already solved them).
    const originalSeeds = [
      101, 202, 303, 404, 505, 606, 707, 808, 909, 1010, 1111, 1212,
      1313, 1414, 1515, 1616, 1717, 1818,
    ];
    expect(PUZZLES.slice(0, 18).map((p) => p.seed)).toEqual(originalSeeds);
  });

  it("never exceeds the campaign's own proven max board size (9 cols x 11 rows)", () => {
    for (let i = 18; i < PUZZLE_COUNT; i++) {
      const def = getPuzzle(i);
      expect(def.cols).toBeLessThanOrEqual(9);
      expect(def.rows).toBeLessThanOrEqual(11);
    }
  });

  it("keeps every extended-ladder core/vault strictly inside its board", () => {
    for (let i = 18; i < PUZZLE_COUNT; i++) {
      const def = getPuzzle(i);
      if (def.puzzleType === "frozen") {
        expect(def.coreW).toBeLessThan(def.cols);
        expect(def.coreH).toBeLessThan(def.rows);
      } else if (def.puzzleType === "stone") {
        expect(def.vaultW).toBeLessThan(def.cols);
        expect(def.vaultH).toBeLessThan(def.rows);
      }
    }
  });
});
