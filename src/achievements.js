// Achievements: one-time badges that reward lifetime play milestones.
//
// This module is pure and deterministic so it can be unit-tested in isolation:
// the game feeds it an aggregate `progress` object (lifetime counters) plus the
// list of already-unlocked ids, and asks which new badges should fire.
//
// Each achievement is `{ id, icon, name, desc, coins, test(progress) }`.
// `coins` is the one-time payout granted when the badge unlocks.

export const ACHIEVEMENTS = [
  {
    id: "first_pop",
    icon: "👆",
    name: "First Pop",
    desc: "Pop your very first cluster.",
    coins: 10,
    test: (p) => p.pops >= 1,
  },
  {
    id: "chain_5",
    icon: "⚡",
    name: "Combo Master",
    desc: "Reach a ×5 combo by chaining pops.",
    coins: 40,
    test: (p) => p.bestCombo >= 5,
  },
  {
    id: "big_group",
    icon: "💥",
    name: "Big Bang",
    desc: "Pop a single cluster of 8 or more.",
    coins: 30,
    test: (p) => p.biggestGroup >= 8,
  },
  {
    id: "fever_1",
    icon: "🔥",
    name: "Fever Pitch",
    desc: "Fill the gauge and trigger Fever mode.",
    coins: 25,
    test: (p) => p.fevers >= 1,
  },
  {
    id: "clear_5",
    icon: "🏁",
    name: "On a Roll",
    desc: "Clear 5 campaign levels.",
    coins: 50,
    test: (p) => p.levelsCleared >= 5,
  },
  {
    id: "stars_15",
    icon: "⭐",
    name: "Star Collector",
    desc: "Earn 15 stars across the campaign.",
    coins: 60,
    test: (p) => p.totalStars >= 15,
  },
  {
    id: "defuse_1",
    icon: "🛡️",
    name: "Bomb Squad",
    desc: "Tap a falling problem to defuse it.",
    coins: 20,
    test: (p) => p.defuses >= 1,
  },
  {
    id: "coins_500",
    icon: "💰",
    name: "High Roller",
    desc: "Earn 500 coins in total from play.",
    coins: 50,
    test: (p) => p.coinsEarned >= 500,
  },
];

// Lifetime progress counters the achievements test against.
export const DEFAULT_PROGRESS = {
  pops: 0,
  bestCombo: 0,
  biggestGroup: 0,
  fevers: 0,
  levelsCleared: 0,
  totalStars: 0,
  defuses: 0,
  coinsEarned: 0,
};

// Fields that record a personal best (take the max of old/new) rather than
// accumulating. Everything else is summed.
const MAX_FIELDS = new Set([
  "bestCombo",
  "biggestGroup",
  "levelsCleared",
  "totalStars",
]);

// Fold a `delta` into a progress object, returning a NEW object (never mutates
// the input). Max-fields keep the higher value; the rest add up.
export function mergeProgress(progress, delta) {
  const out = { ...DEFAULT_PROGRESS, ...(progress || {}) };
  for (const k of Object.keys(delta || {})) {
    const v = delta[k] || 0;
    if (MAX_FIELDS.has(k)) out[k] = Math.max(out[k] || 0, v);
    else out[k] = (out[k] || 0) + v;
  }
  return out;
}

// Look up an achievement definition by id.
export function getAchievement(id) {
  return ACHIEVEMENTS.find((a) => a.id === id) || null;
}

// Given current progress and the already-unlocked ids, return the ids of
// achievements that should newly unlock (test passes and not already held),
// in definition order.
export function newlyUnlocked(progress, unlocked) {
  const have = new Set(unlocked || []);
  return ACHIEVEMENTS.filter((a) => !have.has(a.id) && a.test(progress)).map(
    (a) => a.id
  );
}

// Sum the coin payout for a list of achievement ids (unknown ids contribute 0).
export function coinsForAchievements(ids) {
  return (ids || []).reduce((sum, id) => {
    const a = getAchievement(id);
    return sum + (a ? a.coins : 0);
  }, 0);
}
