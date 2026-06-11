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

export function starsForScore(level, score) {
  const t = starThresholds(level);
  if (score >= t.three) return 3;
  if (score >= t.two) return 2;
  if (score >= t.one) return 1;
  return 0;
}
