// Level definitions with a smooth difficulty curve.
// Each level is generated from its index so the campaign is fully deterministic.
//
// The campaign is effectively endless: levels are generated on the fly from
// their index (zero are stored), difficulty ramps up to a fair peak and then
// plateaus so every level stays winnable no matter how high you climb, and
// chapters continue procedurally past the hand-authored worlds.

import { hashSeed } from "./rng.js";
import { milestoneType, bossConfig } from "./milestones.js";

// Total campaign length. The campaign is generative, so this is just a sane
// upper bound (clamps absurd ids); play runs from level 1 up to here.
export const LEVEL_COUNT = 9999;

// Difficulty ramps with the level number up to this cap, then plateaus at a
// fair peak. Past the cap every level is equally hard (the journey continues
// through fresh boards + procedural chapters), so the campaign never becomes
// mathematically impossible. Levels 1..DIFFICULTY_CAP keep their exact original
// tuning (d === n there), so the hand-authored arc is unchanged.
export const DIFFICULTY_CAP = 60;

// World map chapters -------------------------------------------------------
// The campaign is grouped into themed chapters of 8 levels each so the level
// map reads as a journey across distinct "worlds" rather than one long list.
// This is purely organisational metadata (presentation + flavour); it does not
// change difficulty, which is driven by the per-level helpers below.
export const CHAPTER_SIZE = 8;
export const CHAPTERS = [
  { id: 1, name: "Bubble Meadow", icon: "🌱" },
  { id: 2, name: "Frosty Peaks", icon: "❄️" },
  { id: 3, name: "Thunder Valley", icon: "⚡" },
  { id: 4, name: "Crystal Caverns", icon: "💎" },
  { id: 5, name: "Cosmic Finale", icon: "🌌" },
];

// Hand-authored levels (the first CHAPTERS.length chapters). Beyond this the
// level map streams in procedural chapters as the player climbs.
export const AUTHORED_LEVELS = CHAPTERS.length * CHAPTER_SIZE;

// Procedural chapter flavour used once the authored chapters run out. The pool
// cycles deterministically; each full cycle past the first appends a Roman
// numeral so names stay distinct forever (e.g. "Aurora Reach II").
const PROC_CHAPTERS = [
  { name: "Aurora Reach", icon: "🌠" },
  { name: "Ember Hollow", icon: "🔥" },
  { name: "Tidal Expanse", icon: "🌊" },
  { name: "Verdant Wilds", icon: "🍃" },
  { name: "Obsidian Depths", icon: "🪨" },
  { name: "Solar Spire", icon: "☀️" },
  { name: "Nebula Drift", icon: "🌫️" },
  { name: "Mirage Sands", icon: "🏜️" },
];

// Minimal Roman numeral for chapter-cycle suffixes (always a positive int).
function romanize(num) {
  const map = [
    ["M", 1000],
    ["CM", 900],
    ["D", 500],
    ["CD", 400],
    ["C", 100],
    ["XC", 90],
    ["L", 50],
    ["XL", 40],
    ["X", 10],
    ["IX", 9],
    ["V", 5],
    ["IV", 4],
    ["I", 1],
  ];
  let r = "";
  let n = num;
  for (const [sym, val] of map) {
    while (n >= val) {
      r += sym;
      n -= val;
    }
  }
  return r || "I";
}

// Resolve the chapter a (1-based) level belongs to, including its level range.
// Authored chapters come first; beyond them chapters are generated procedurally
// so the world map can run effectively forever.
export function chapterForLevel(id) {
  const n = Math.max(1, Math.min(LEVEL_COUNT, id));
  const index = Math.floor((n - 1) / CHAPTER_SIZE);
  let base;
  if (index < CHAPTERS.length) {
    base = CHAPTERS[index];
  } else {
    const k = index - CHAPTERS.length;
    const pool = PROC_CHAPTERS[k % PROC_CHAPTERS.length];
    const cycle = Math.floor(k / PROC_CHAPTERS.length); // 0, 1, 2, ...
    const suffix = cycle > 0 ? ` ${romanize(cycle + 1)}` : "";
    base = { id: index + 1, name: pool.name + suffix, icon: pool.icon };
  }
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
  // Stone bubbles ramp in from level 18 — locked obstacles you can't tap, only
  // shatter by popping a neighbour. Kept sparse so boards stay solvable.
  const stone = n >= 18 ? Math.min(0.06, 0.02 + (n - 18) * 0.002) : 0;
  // Bomb bubbles ramp in from level 16 — a rare, powerful treat that detonates
  // a 3×3 area when its group pops. Kept very sparse so it stays a surprise.
  const bomb = n >= 16 ? Math.min(0.03, 0.01 + (n - 16) * 0.001) : 0;
  // Gold multiplier bubbles ramp in from level 12 — a rewarding treat that
  // multiplies the score of the pop that clears them. Kept sparse.
  const multiplier = n >= 12 ? Math.min(0.04, 0.012 + (n - 12) * 0.0012) : 0;
  // Treasure coin bubbles ramp in from level 8 — a friendly early reward that
  // drops bonus coins when popped. Kept sparse so they stay a treat.
  const coin = n >= 8 ? Math.min(0.035, 0.012 + (n - 8) * 0.001) : 0;
  // Vine bubbles ramp in from level 20 — a creeping threat that spreads to an
  // adjacent bubble every move until its cluster is popped. Kept very sparse so
  // the board stays solvable and the tension reads as a puzzle, not a flood.
  const vine = n >= 20 ? Math.min(0.02, 0.006 + (n - 20) * 0.0006) : 0;
  return { rainbow, ice, lightning, stone, bomb, multiplier, coin, vine };
}

// Bonus objectives ----------------------------------------------------------
// Each ordinary campaign level carries an optional bonus objective: an extra
// challenge layered on top of the score target. Meeting it pays bonus coins on
// the win screen, but it never affects the win/star outcome — the score target
// stays the primary goal. Objectives are deterministic per level (derived from
// the level number) so the campaign is reproducible, and they are skipped on
// the first couple of levels and on milestone (treasure/boss) beats, which
// already carry their own identity.
export function objectiveForLevel(n) {
  if (n <= 2 || milestoneType(n)) return null;
  // Goals scale with difficulty but plateau with the curve so they stay
  // achievable on the endless plateau (an objective is a bonus, never a gate).
  const d = Math.min(n, DIFFICULTY_CAP);
  const kinds = ["combo", "group", "nopowerup"];
  const kind = kinds[(n - 3) % kinds.length];
  if (kind === "combo") {
    const goal = 3 + Math.floor(d / 12); // 3 → 8 across the ramp
    return {
      type: "combo",
      goal,
      bonus: 40 + goal * 10,
      label: `Reach a ×${goal} combo`,
    };
  }
  if (kind === "group") {
    const goal = 5 + Math.floor(d / 14); // 5 → 9 across the ramp
    return {
      type: "group",
      goal,
      bonus: 40 + goal * 8,
      label: `Pop a group of ${goal}+`,
    };
  }
  // nopowerup — clear the level without spending any power-up tool.
  return { type: "nopowerup", goal: 0, bonus: 90, label: "Win without power-ups" };
}

export function getLevel(id) {
  const n = Math.max(1, Math.min(LEVEL_COUNT, id));
  // Difficulty ramps with the level number then plateaus at the cap so the
  // endless campaign stays winnable. The level identity (seed, milestone beats,
  // chapter, objective rotation) still uses the real index `n`.
  const d = Math.min(n, DIFFICULTY_CAP);
  const cols = colsForLevel(d);
  const rows = rowsForLevel(d);
  const colors = colorsForLevel(d);
  const cells = cols * rows;

  // Move budget tightens as levels progress (then plateaus with the curve).
  const moves = Math.max(6, Math.round(cells / 6) + 6 - Math.floor(d / 8));

  // Target score scales with board size and difficulty.
  const target = Math.round(
    cells * (10 + d * 2.4) * (1 + colors * 0.05)
  );

  // Milestone beats every 5 levels (treasure) and 10 levels (boss).
  const milestone = milestoneType(n);
  const specials = specialsForLevel(d);
  let moveBudget = moves;
  let boss = null;
  if (milestone === "boss") {
    boss = bossConfig(n);
    // Bosses use a hand-placed frozen core, so suppress random ice and grant
    // extra moves to keep the objective fair.
    specials.ice = 0;
    specials.stone = 0;
    specials.vine = 0;
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
    objective: objectiveForLevel(n),
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
