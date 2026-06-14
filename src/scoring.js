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

// Escalating combo feedback. As consecutive pops climb, the on-screen combo
// banner ramps through named tiers with progressively hotter styling. The
// `min` is the combo count at which the tier kicks in; `className` keys the
// banner's visual intensity (defined in styles.css). Ordered low -> high.
export const COMBO_TIERS = [
  { min: 2, label: "Nice", className: "ct-1" },
  { min: 4, label: "Great", className: "ct-2" },
  { min: 6, label: "Awesome", className: "ct-3" },
  { min: 9, label: "Amazing", className: "ct-4" },
  { min: 13, label: "Unstoppable", className: "ct-5" },
];

// Resolve the highest combo tier reached for a given combo count, or null when
// the combo is below the first threshold (no banner). Returns a copy with the
// 0-based `tier` index so callers can drive escalating effects.
export function comboTier(combo) {
  let found = null;
  for (let i = 0; i < COMBO_TIERS.length; i++) {
    if (combo >= COMBO_TIERS[i].min) found = { tier: i, ...COMBO_TIERS[i] };
  }
  return found;
}

// ---- Cascade / chain-reaction bonus ----------------------------------
// Keeping a chain alive (popping again before the combo window closes) triggers
// a cascade: each successive pop pays a FLAT, escalating bonus on top of the
// multiplicative combo score. Where the combo multiplier rewards *big* groups,
// the cascade bonus rewards *sustaining the chain* — so stringing together many
// small pops is worthwhile too. `chain` is the number of pops in the current
// unbroken chain (1 = the opening pop, which never pays a cascade). Capped so
// it stays a spice rather than the whole meal.
export const CASCADE_MIN = 2; // chain length at which a cascade first pays out
export const CASCADE_STEP = 30; // flat points added per chain step past the first
export const CASCADE_CAP = 360; // max cascade bonus from a single pop

export function cascadeBonus(chain) {
  if (chain < CASCADE_MIN) return 0;
  return Math.min(CASCADE_CAP, CASCADE_STEP * (chain - 1));
}

// Named cascade tiers for the escalating chain-reaction callout. `min` is the
// chain length at which the tier kicks in. Ordered low -> high.
export const CASCADE_TIERS = [
  { min: 2, label: "Cascade" },
  { min: 4, label: "Chain Reaction" },
  { min: 6, label: "Avalanche" },
  { min: 9, label: "Meltdown" },
];

// Resolve the highest cascade tier reached for a given chain length, or null
// when the chain is below the first threshold.
export function cascadeTier(chain) {
  let found = null;
  for (let i = 0; i < CASCADE_TIERS.length; i++) {
    if (chain >= CASCADE_TIERS[i].min) found = { tier: i, ...CASCADE_TIERS[i] };
  }
  return found;
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
