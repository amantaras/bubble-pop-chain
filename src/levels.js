// Level definitions with a smooth difficulty curve.
// Each level is generated from its index so the campaign is fully deterministic.

import { hashSeed } from "./rng.js";

export const LEVEL_COUNT = 40;

// Difficulty curve helpers ---------------------------------------------------
function colsForLevel(n) {
  if (n <= 5) return 6;
  if (n <= 12) return 7;
  if (n <= 22) return 8;
  return 9;
}
function rowsForLevel(n) {
  if (n <= 5) return 8;
  if (n <= 12) return 9;
  if (n <= 22) return 10;
  return 11;
}
function colorsForLevel(n) {
  if (n <= 3) return 3;
  if (n <= 9) return 4;
  if (n <= 20) return 5;
  return 6;
}

// Special-bubble spawn rates ramp in as the campaign progresses so early
// levels stay simple and later ones gain extra strategy.
function specialsForLevel(n) {
  const rainbow = n >= 6 ? Math.min(0.05, 0.015 + (n - 6) * 0.0015) : 0;
  const ice = n >= 10 ? Math.min(0.1, 0.03 + (n - 10) * 0.003) : 0;
  return { rainbow, ice };
}

export function getLevel(id) {
  const n = Math.max(1, Math.min(LEVEL_COUNT, id));
  const cols = colsForLevel(n);
  const rows = rowsForLevel(n);
  const colors = colorsForLevel(n);
  const cells = cols * rows;

  // Move budget tightens as levels progress.
  const moves = Math.max(6, Math.round(cells / 6) + 6 - Math.floor(n / 8));

  // Target score scales with board size and level number.
  const target = Math.round(
    cells * (10 + n * 2.4) * (1 + colors * 0.05)
  );

  return {
    id: n,
    cols,
    rows,
    colors,
    moves,
    target,
    specials: specialsForLevel(n),
    seed: hashSeed(`level-${n}-bpc`),
  };
}

// Star thresholds: 1 star = reach target; 2 & 3 reward surplus score.
export function starThresholds(level) {
  return {
    one: level.target,
    two: Math.round(level.target * 1.35),
    three: Math.round(level.target * 1.8),
  };
}
