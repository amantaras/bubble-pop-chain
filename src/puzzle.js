// Puzzle Mode — a curated ladder of hand-tuned move-limited challenges on a
// fixed, deterministic board (same seed for every player, every attempt).
//
// The original ladder (puzzles 1-12) has a single objective: clear the WHOLE
// board within the move budget. That is still the default (`type: "clear"`),
// but puzzles 13+ borrow the campaign's boss archetypes (milestones.js —
// frozen core / stone vault / colour hunt) to give a puzzle a narrower, more
// interesting goal than "pop everything": e.g. shatter a locked ice core while
// ordinary bubbles are still scattered around it, forcing the player to plan a
// path INTO the core instead of just clearing outward-in. Each objective type
// reuses grid.js mechanics that already ship (and are already tested) for
// bosses, so no new board mechanic had to be invented — just a new *goal*
// layered on the same puzzle skeleton (fixed board, move budget, star rating).
//
// This module is pure data + helpers (no DOM, no Board) so it is trivially
// unit-testable; main.js turns a puzzle definition into a real playable session.

// Objective metadata, keyed by `type`. `hudLabel` mirrors the boss HUD
// (Core/Stone/Left) so the in-game readout is instantly familiar; `intro` is
// the short phrase used in the puzzle-start toast ("<icon> Puzzle N — <intro>
// in M moves!").
export const PUZZLE_TYPE_META = {
  clear: { icon: "🧩", label: "Clear Board", hudLabel: "Left", intro: "clear the whole board" },
  frozen: { icon: "🧊", label: "Ice Core", hudLabel: "Core", intro: "shatter the ice core" },
  stone: { icon: "🪨", label: "Stone Vault", hudLabel: "Stone", intro: "break every locked stone" },
  color: { icon: "🎯", label: "Colour Hunt", hudLabel: "Left", intro: "clear every bubble of the hunted colour" },
};

// Resolve a puzzle's objective metadata, defaulting to the classic "clear"
// goal for unknown/omitted types so old data never breaks.
export function puzzleTypeMeta(type) {
  return PUZZLE_TYPE_META[type] || PUZZLE_TYPE_META.clear;
}

// The authored puzzle ladder. Boards start small with few colours and grow in
// size and palette. Move budgets are deliberately generous on the opener and
// tighten as the ladder climbs so later puzzles demand efficient solutions.
// `seed` fixes the board so every attempt (and every player) sees the same one.
// `type` (default "clear") selects the win condition; `coreW/coreH` size a
// frozen puzzle's ice core (`Board.placeFrozenCore`) and `vaultW/vaultH` size a
// stone puzzle's vault (`Board.placeStoneVault`) — a "color" puzzle needs no
// extra sizing, it hunts the board's own dominant colour like the boss does.
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
  // ---- New objective types (13+): win before the board is fully clear ----
  { cols: 7, rows: 9, colors: 5, seed: 1313, moves: 26, type: "frozen", coreW: 2, coreH: 2 },
  { cols: 7, rows: 9, colors: 5, seed: 1414, moves: 24, type: "stone", vaultW: 3, vaultH: 2 },
  { cols: 7, rows: 10, colors: 5, seed: 1515, moves: 22, type: "color" },
  { cols: 8, rows: 10, colors: 6, seed: 1616, moves: 30, type: "frozen", coreW: 3, coreH: 2 },
  { cols: 8, rows: 10, colors: 6, seed: 1717, moves: 28, type: "stone", vaultW: 4, vaultH: 2 },
  { cols: 8, rows: 11, colors: 6, seed: 1818, moves: 26, type: "color" },
  // ---- Extended ladder (19+): bigger cores/vaults, tighter budgets, and the
  // ladder's first 9-column boards (still within the campaign's own proven
  // max board size — levels.js colsForLevel/rowsForLevel top out at 9x11 too).
  { cols: 8, rows: 11, colors: 6, seed: 1919, moves: 24, type: "frozen", coreW: 3, coreH: 3 },
  { cols: 9, rows: 11, colors: 6, seed: 2020, moves: 32, specials: { ice: 0.06, rainbow: 0.03 } },
  { cols: 9, rows: 11, colors: 6, seed: 2121, moves: 24, type: "stone", vaultW: 4, vaultH: 3 },
  { cols: 9, rows: 11, colors: 6, seed: 2222, moves: 20, type: "color" },
  { cols: 9, rows: 11, colors: 6, seed: 2323, moves: 26, specials: { ice: 0.07, rainbow: 0.04 }, type: "frozen", coreW: 3, coreH: 3 },
  { cols: 9, rows: 11, colors: 6, seed: 2424, moves: 22, type: "stone", vaultW: 4, vaultH: 3 },
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
// (or, for the newer objective types, meeting the narrower goal) — not a score
// — is the win condition. `puzzleType` defaults to "clear"; `coreW/coreH`/
// `vaultW/vaultH` are undefined for types that don't use them.
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
    puzzleType: p.type || "clear",
    coreW: p.coreW,
    coreH: p.coreH,
    vaultW: p.vaultW,
    vaultH: p.vaultH,
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
