// Achievements: tiered, collectible goals that reward lifetime play.
//
// Each *category* tracks one lifetime metric (e.g. total pops) and has an
// escalating ladder of *tiers* — clearing a tier fills its progress bar and
// makes a CHEST claimable. The player collects the chest on the Achievements
// screen: it always pays coins and can also drop power-up tools and, very
// rarely, a pet. After collecting, the category advances to the next tier.
//
// This module is pure and deterministic so it can be unit-tested in isolation.
// The game feeds it an aggregate `progress` object (lifetime counters) and a
// `claims` map (how many tiers each category has been collected for), and asks
// for per-category status, the claimable count, and seeded chest contents.

// A category: { id, icon, name, metric, unit, tiers: [{ goal, coins }] }.
// `metric` is the key in the progress object; tiers escalate in `goal`/`coins`.
export const ACHIEVEMENT_CATEGORIES = [
  {
    id: "popper",
    icon: "👆",
    name: "Popper",
    metric: "pops",
    unit: "pops",
    tiers: [
      { goal: 1, coins: 10 },
      { goal: 100, coins: 60 },
      { goal: 500, coins: 150 },
      { goal: 1000, coins: 300 },
      { goal: 5000, coins: 750 },
    ],
  },
  {
    id: "combo",
    icon: "⚡",
    name: "Combo Master",
    metric: "bestCombo",
    unit: "× combo",
    tiers: [
      { goal: 5, coins: 40 },
      { goal: 8, coins: 90 },
      { goal: 12, coins: 180 },
      { goal: 16, coins: 320 },
      { goal: 20, coins: 600 },
    ],
  },
  {
    id: "bigbang",
    icon: "💥",
    name: "Big Bang",
    metric: "biggestGroup",
    unit: "in a group",
    tiers: [
      { goal: 8, coins: 30 },
      { goal: 12, coins: 80 },
      { goal: 16, coins: 170 },
      { goal: 20, coins: 320 },
      { goal: 25, coins: 600 },
    ],
  },
  {
    id: "fever",
    icon: "🔥",
    name: "Fever Pitch",
    metric: "fevers",
    unit: "fevers",
    tiers: [
      { goal: 1, coins: 25 },
      { goal: 10, coins: 80 },
      { goal: 25, coins: 180 },
      { goal: 50, coins: 350 },
      { goal: 100, coins: 700 },
    ],
  },
  {
    id: "campaign",
    icon: "🏁",
    name: "Trailblazer",
    metric: "levelsCleared",
    unit: "levels",
    tiers: [
      { goal: 5, coins: 50 },
      { goal: 10, coins: 120 },
      { goal: 15, coins: 220 },
      { goal: 20, coins: 380 },
      { goal: 25, coins: 700 },
    ],
  },
  {
    id: "stars",
    icon: "⭐",
    name: "Star Collector",
    metric: "totalStars",
    unit: "stars",
    tiers: [
      { goal: 15, coins: 60 },
      { goal: 30, coins: 140 },
      { goal: 50, coins: 260 },
      { goal: 75, coins: 440 },
      { goal: 100, coins: 800 },
    ],
  },
  {
    id: "defuser",
    icon: "🛡️",
    name: "Bomb Squad",
    metric: "defuses",
    unit: "defused",
    tiers: [
      { goal: 1, coins: 20 },
      { goal: 10, coins: 70 },
      { goal: 25, coins: 160 },
      { goal: 50, coins: 320 },
      { goal: 100, coins: 650 },
    ],
  },
  {
    id: "wealth",
    icon: "💰",
    name: "High Roller",
    metric: "coinsEarned",
    unit: "coins earned",
    tiers: [
      { goal: 500, coins: 50 },
      { goal: 2000, coins: 120 },
      { goal: 5000, coins: 250 },
      { goal: 10000, coins: 450 },
      { goal: 25000, coins: 900 },
    ],
  },
];

// Lifetime progress counters the categories test against.
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

// Look up a category definition by id.
export function getCategory(id) {
  return ACHIEVEMENT_CATEGORIES.find((c) => c.id === id) || null;
}

// Compute the live status of one category given lifetime progress and how many
// of its tiers have already been claimed. Returns a rich descriptor the UI can
// render directly:
//   { claimed, value, maxed, tierIndex, tier, goal, prevGoal,
//     progress01, claimable, level, totalTiers }
export function categoryStatus(cat, progress, claims) {
  const totalTiers = cat.tiers.length;
  const claimed = Math.max(
    0,
    Math.min(totalTiers, (claims && claims[cat.id]) || 0)
  );
  const value = Math.max(0, (progress && progress[cat.metric]) || 0);
  const maxed = claimed >= totalTiers;
  const tierIndex = maxed ? totalTiers - 1 : claimed;
  const tier = cat.tiers[tierIndex];
  const goal = tier.goal;
  const prevGoal = tierIndex > 0 ? cat.tiers[tierIndex - 1].goal : 0;
  const progress01 = maxed ? 1 : Math.max(0, Math.min(1, value / goal));
  const claimable = !maxed && value >= goal;
  return {
    claimed,
    value,
    maxed,
    tierIndex,
    tier,
    goal,
    prevGoal,
    progress01,
    claimable,
    level: claimed + 1,
    totalTiers,
  };
}

// How many categories currently have a chest waiting to be collected.
export function claimableCount(progress, claims) {
  return ACHIEVEMENT_CATEGORIES.reduce(
    (n, cat) => n + (categoryStatus(cat, progress, claims).claimable ? 1 : 0),
    0
  );
}

// The ids of every category with a chest ready to collect, in definition order.
export function claimableCategories(progress, claims) {
  return ACHIEVEMENT_CATEGORIES.filter(
    (cat) => categoryStatus(cat, progress, claims).claimable
  ).map((c) => c.id);
}

// The power-up tools a chest can drop.
export const CHEST_POWERUPS = [
  "bomb",
  "colorClear",
  "paint",
  "shuffle",
  "chainBolt",
  "pick",
];

// Chance a chest contains a pet. Deliberately very low — pets are a treat.
export const CHEST_PET_CHANCE = 0.04;

// Roll the contents of a chest for a freshly cleared tier. Pure + seeded: `rng`
// is a function returning [0,1). Returns:
//   { coins, bonusCoins, powerups: [{ id, n }], petRoll: boolean }
// `coins` is the guaranteed tier payout; `bonusCoins` is a small extra; tools
// get more likely (and can double up) at higher tiers; `petRoll` signals the
// caller to roll a pet from the crate pool (kept out of this pure module so it
// stays free of pet-catalog coupling).
export function rollChest(rng, opts = {}) {
  const tierIndex = Math.max(0, opts.tierIndex || 0);
  const coins = Math.max(0, opts.coins || 0);
  const out = { coins, bonusCoins: 0, powerups: [], petRoll: false };

  // A modest coin sweetener on top of the guaranteed tier payout.
  out.bonusCoins = Math.round(coins * (0.2 + rng() * 0.3));

  // Tools: very likely, more so as tiers climb; high tiers can grant two.
  const toolChance = Math.min(0.95, 0.55 + tierIndex * 0.08);
  if (rng() < toolChance) {
    const id = CHEST_POWERUPS[Math.floor(rng() * CHEST_POWERUPS.length)];
    const n = rng() < 0.25 + tierIndex * 0.05 ? 2 : 1;
    out.powerups.push({ id, n });
  }
  if (tierIndex >= 2 && rng() < 0.3) {
    const id = CHEST_POWERUPS[Math.floor(rng() * CHEST_POWERUPS.length)];
    out.powerups.push({ id, n: 1 });
  }

  // Pet: a rare delight. Slightly better odds at the top tiers.
  const petChance = CHEST_PET_CHANCE + tierIndex * 0.01;
  if (rng() < petChance) out.petRoll = true;

  return out;
}

// Combine several claimed-chest reward summaries (each shaped like the object
// the game's `claimAchievement` returns) into one aggregate for the "Collect
// All" reveal. Sums coins, merges identical power-ups by id, and gathers the
// pets and the categories that were cleared. Pure + order-preserving.
export function aggregateChestRewards(rewards) {
  const out = { count: 0, coins: 0, powerups: [], pets: [], categories: [] };
  const byId = new Map();
  for (const r of rewards || []) {
    if (!r) continue;
    out.count += 1;
    out.coins += r.coins || 0;
    if (r.category) {
      out.categories.push({
        id: r.category.id,
        name: r.category.name,
        icon: r.category.icon,
        tierIndex: r.tierIndex || 0,
      });
    }
    for (const p of r.powerups || []) {
      const cur = byId.get(p.id);
      if (cur) cur.n += p.n;
      else {
        const copy = { ...p };
        byId.set(p.id, copy);
        out.powerups.push(copy);
      }
    }
    if (r.pet) out.pets.push(r.pet);
  }
  return out;
}
