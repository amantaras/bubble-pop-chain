// Level definitions with a smooth difficulty curve.
// Each level is generated from its index so the campaign is fully deterministic.

import { hashSeed } from "./rng.js";
import { milestoneType, bossConfig } from "./milestones.js";

export const LEVEL_COUNT = 40;

// World map chapters -------------------------------------------------------
// The 40-level campaign is grouped into themed chapters of 8 levels each so the
// level map reads as a journey across distinct "worlds" rather than one long
// list. This is purely organisational metadata (presentation + flavour); it
// does not change difficulty, which is driven by the per-level helpers below.
export const CHAPTER_SIZE = 8;
export const CHAPTERS = [
  { id: 1, name: "Bubble Meadow", icon: "🌱" },
  { id: 2, name: "Frosty Peaks", icon: "❄️" },
  { id: 3, name: "Thunder Valley", icon: "⚡" },
  { id: 4, name: "Crystal Caverns", icon: "💎" },
  { id: 5, name: "Cosmic Finale", icon: "🌌" },
];

// Resolve the chapter a (1-based) level belongs to, including its level range.
export function chapterForLevel(id) {
  const n = Math.max(1, Math.min(LEVEL_COUNT, id));
  const index = Math.floor((n - 1) / CHAPTER_SIZE);
  const base = CHAPTERS[index] || CHAPTERS[CHAPTERS.length - 1];
  const startLevel = index * CHAPTER_SIZE + 1;
  const endLevel = Math.min(LEVEL_COUNT, startLevel + CHAPTER_SIZE - 1);
  return { ...base, index, startLevel, endLevel };
}

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
  // Lightning bubbles ramp in from level 14 — a rarer, powerful treat that
  // clears a full row + column when its group pops.
  const lightning = n >= 14 ? Math.min(0.04, 0.012 + (n - 14) * 0.0012) : 0;
  return { rainbow, ice, lightning };
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

  // Milestone beats every 5 levels (treasure) and 10 levels (boss).
  const milestone = milestoneType(n);
  const specials = specialsForLevel(n);
  let moveBudget = moves;
  let boss = null;
  if (milestone === "boss") {
    boss = bossConfig(n);
    // Bosses use a hand-placed frozen core, so suppress random ice and grant
    // extra moves to keep the objective fair.
    specials.ice = 0;
    moveBudget = moves + boss.extraMoves;
  }

  return {
    id: n,
    cols,
    rows,
    colors,
    moves: moveBudget,
    target,
    specials,
    seed: hashSeed(`level-${n}-bpc`),
    milestone,
    boss,
    chapter: chapterForLevel(n),
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
