// Scoring rules and combo logic.
import { starThresholds } from "./levels.js";

// Bigger groups score disproportionately more, encouraging planning.
// 2 -> 10, 3 -> 30, 4 -> 60, 5 -> 100, n -> 10 * n * (n-1)/2 ... we use a
// simple escalating formula.
export function groupScore(n) {
  if (n < 2) return 0;
  return 5 * n * (n - 1);
}

// Combo multiplier grows with consecutive pops within a short window.
// combo 0 -> x1, then +0.5 each step, capped.
export function comboMultiplier(combo) {
  return Math.min(1 + combo * 0.5, 5);
}

// Clearing the whole board grants a big bonus proportional to moves left.
export function clearBonus(movesLeft) {
  return 500 + movesLeft * 150;
}

// How much a pop charges the Power meter (0..1 scale). Bigger groups and longer
// combos charge faster, so skilful play earns the Charged Blast sooner. The
// per-pop gain is capped so a single lucky move can never fill the meter alone.
export function powerGain(points, combo) {
  const gain = points / 2600 + combo * 0.035;
  return Math.max(0, Math.min(0.5, gain));
}

// ---- Fever mode -------------------------------------------------------
// Sustained chaining fills a Fever gauge. When it tops out the player enters
// Fever for a few seconds, during which every point earned is doubled. The
// gauge drains over the duration and resets once Fever ends.
export const FEVER_DURATION = 6; // seconds of doubled scoring once triggered
export const FEVER_MULTIPLIER = 2; // score multiplier while Fever is active

// Fever gauge charge per pop (0..1 scale). Longer combos fill it much faster,
// so quick chains are the way in. Capped so a single big pop can't fill it
// alone — Fever is a reward for sustained chaining, not one lucky tap.
export function feverGain(combo) {
  return Math.max(0, Math.min(0.34, 0.05 + combo * 0.045));
}

// Apply the Fever multiplier to a points value when Fever is active.
export function feverPoints(points, active) {
  return active ? Math.round(points * FEVER_MULTIPLIER) : points;
}

export function starsForScore(level, score) {
  const t = starThresholds(level);
  if (score >= t.three) return 3;
  if (score >= t.two) return 2;
  if (score >= t.one) return 1;
  return 0;
}

// Coins awarded for finishing a campaign level: a slice of the score plus a
// flat per-star bonus, so a higher star rating always pays out more coins.
// Tuned so a player clearing levels at ~2 stars can afford a cheap power-up
// (100–150) roughly every 2–3 levels without watching ads.
export function coinReward(score, stars) {
  return Math.floor(Math.max(0, score) / 100) + Math.max(0, stars) * 20;
}
