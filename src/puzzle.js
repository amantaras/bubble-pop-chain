// Puzzle Mode — a curated ladder of hand-tuned "clear the whole board in a
// limited number of moves" challenges.
//
// Unlike the campaign (win by reaching a score target) or the endless modes,
// a puzzle is only solved when EVERY bubble is cleared off the board within its
// move budget. Each puzzle is a fixed, deterministic board (fixed seed), so the
// same challenge is presented to every player and a clever solution always
// replays the same way. Puzzles unlock in order: solving one opens the next.
//
// This module is pure data + helpers (no DOM, no Board) so it is trivially
// unit-testable; main.js turns a puzzle definition into a real playable session.

// The authored puzzle ladder. Boards start small with few colours and grow in
// size and palette. Move budgets are deliberately generous on the opener and
// tighten as the ladder climbs so later puzzles demand efficient solutions.
// `seed` fixes the board so every attempt (and every player) sees the same one.
export const PUZZLES = [
  { cols: 4, rows: 5, colors: 3, seed: 101, moves: 40 },
  { cols: 5, rows: 6, colors: 3, seed: 202, moves: 30 },
  { cols: 5, rows: 7, colors: 4, seed: 303, moves: 28 },
  { cols: 6, rows: 7, colors: 4, seed: 404, moves: 28 },
  { cols: 6, rows: 8, colors: 4, seed: 505, moves: 26, specials: { ice: 0.05 } },
  { cols: 7, rows: 8, colors: 5, seed: 606, moves: 30 },
  { cols: 7, rows: 9, colors: 5, seed: 707, moves: 30, specials: { ice: 0.06 } },
  { cols: 8, rows: 9, colors: 5, seed: 808, moves: 32 },
  { cols: 8, rows: 10, colors: 5, seed: 909, moves: 34, specials: { ice: 0.06 } },
  { cols: 8, rows: 10, colors: 6, seed: 1010, moves: 34 },
  { cols: 8, rows: 11, colors: 6, seed: 1111, moves: 36, specials: { ice: 0.07 } },
  { cols: 8, rows: 11, colors: 6, seed: 1212, moves: 38, specials: { ice: 0.05, rainbow: 0.03 } },
];

// Total number of authored puzzles in the ladder.
export const PUZZLE_COUNT = PUZZLES.length;

// Star thresholds, expressed as the fraction of the move budget still unspent
// when the board is cleared. Finishing with lots of moves to spare is a clean,
// efficient solve (3 stars); scraping in at the buzzer still earns 1 star.
export const PUZZLE_STAR_RATIOS = { three: 0.3, two: 0.12 };

// Turn a puzzle index into a level-like definition the session engine can run.
// Out-of-range indices clamp into the ladder so callers never get null. The id
// is a stable string ("puzzle-N") and `target` is 0 because clearing the board
// — not a score — is the win condition.
export function getPuzzle(index) {
  const i = Math.max(0, Math.min(PUZZLE_COUNT - 1, index | 0));
  const p = PUZZLES[i];
  return {
    id: `puzzle-${i + 1}`,
    puzzleIndex: i,
    cols: p.cols,
    rows: p.rows,
    colors: p.colors,
    seed: p.seed,
    moves: p.moves,
    target: 0,
    specials: p.specials || {},
  };
}

// Star rating for a solved puzzle, from the moves left over the total budget.
// Always at least 1 (this is only called on a win). More headroom = more stars.
export function puzzleStars(movesLeft, totalMoves) {
  const total = Math.max(1, totalMoves | 0);
  const left = Math.max(0, movesLeft | 0);
  const ratio = left / total;
  if (ratio >= PUZZLE_STAR_RATIOS.three) return 3;
  if (ratio >= PUZZLE_STAR_RATIOS.two) return 2;
  return 1;
}

// A puzzle is unlocked when the one before it has been solved (≥1 star). The
// first puzzle is always open. `starsMap` maps a puzzle index to its best stars.
export function isPuzzleUnlocked(index, starsMap) {
  const i = index | 0;
  if (i <= 0) return true;
  if (i >= PUZZLE_COUNT) return false;
  const prev = (starsMap && starsMap[i - 1]) || 0;
  return prev >= 1;
}

// How many puzzles have been solved (≥1 star), for menu/progress display.
export function puzzlesSolved(starsMap) {
  if (!starsMap) return 0;
  let n = 0;
  for (let i = 0; i < PUZZLE_COUNT; i++) {
    if ((starsMap[i] || 0) >= 1) n++;
  }
  return n;
}
