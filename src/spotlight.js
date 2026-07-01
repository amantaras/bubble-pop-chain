// Spotlight Challenge: a rotating, short-cycle seeded board that changes every
// SPOTLIGHT_PERIOD_DAYS days. Unlike the daily challenge (once per day, no
// replay) or the weekly tournament (replayable all week, local rank only, no
// coin reward), the Spotlight is replayable all rotation long AND pays a real
// one-time coin reward the first time your best score for the rotation
// crosses each tier threshold — so there is always a fresh, no-redeploy-needed
// reason to come back every few days.
import { hashSeed, periodKey, periodDaysLeft } from "./rng.js";
import { Storage } from "./storage.js";

export const SPOTLIGHT_PERIOD_DAYS = 3;

// A rotating modifier keeps each Spotlight window feeling distinct. Themed
// around chaos/specials rather than duplicating the daily/tournament sets.
export const SPOTLIGHT_MODIFIERS = [
  {
    id: "combo-carnival",
    label: "Combo Carnival",
    desc: "A balanced board — chain big for the tiers.",
    apply: (l) => l,
  },
  {
    id: "multiplier-madness",
    label: "Multiplier Madness",
    desc: "Gold multiplier bubbles everywhere.",
    apply: (l) => ({ ...l, specials: { ...l.specials, multiplier: 0.1 } }),
  },
  {
    id: "bomb-bonanza",
    label: "Bomb Bonanza",
    desc: "Bombs fill the board — blast big groups.",
    apply: (l) => ({ ...l, specials: { ...l.specials, bomb: 0.1 } }),
  },
  {
    id: "lightning-storm",
    label: "Lightning Storm",
    desc: "Lightning bubbles crackle everywhere.",
    apply: (l) => ({ ...l, specials: { ...l.specials, lightning: 0.1 } }),
  },
  {
    id: "coin-rush",
    label: "Coin Rush",
    desc: "Treasure bubbles pay out big.",
    apply: (l) => ({ ...l, specials: { ...l.specials, coin: 0.12 } }),
  },
];

// Three ascending tier rewards, paid once per rotation the first time your
// best score crosses that threshold (see recordSpotlight).
export const SPOTLIGHT_TIER_REWARDS = [80, 200, 450]; // bronze, silver, gold

export const SPOTLIGHT_TIERS = [
  { id: "none", label: "Spotlight Run", icon: "🔦" },
  { id: "bronze", label: "Bronze Tier", icon: "🥉" },
  { id: "silver", label: "Silver Tier", icon: "🥈" },
  { id: "gold", label: "Gold Tier", icon: "🥇" },
];

export function getSpotlightModifier(date = new Date()) {
  const key = periodKey(date, SPOTLIGHT_PERIOD_DAYS);
  const idx = hashSeed("spotlightmod-" + key) % SPOTLIGHT_MODIFIERS.length;
  return SPOTLIGHT_MODIFIERS[idx];
}

// A fixed-shape board identical for everyone during this rotation.
export function getSpotlightLevel(date = new Date()) {
  const key = periodKey(date, SPOTLIGHT_PERIOD_DAYS);
  const seed = hashSeed("spotlight-" + key);
  const base = {
    id: "spotlight",
    key,
    cols: 8,
    rows: 10,
    colors: 5,
    moves: 999, // high-score mode — play until the board deadlocks
    target: 0,
    specials: { rainbow: 0.05, ice: 0.05 },
    seed,
  };
  const mod = getSpotlightModifier(date);
  return {
    ...mod.apply(base),
    modifier: { id: mod.id, label: mod.label, desc: mod.desc },
  };
}

// Three ascending score goals → bronze/silver/gold one-time tier rewards.
export function getSpotlightGoals(level) {
  const cells = level.cols * level.rows;
  const unit = Math.round(cells * (8 + level.colors));
  return { bronze: unit * 4, silver: unit * 7, gold: unit * 11 };
}

// How many tiers (0..3) a score reaches against the goals.
export function spotlightTiersReached(goals, score) {
  let n = 0;
  if (score >= goals.bronze) n = 1;
  if (score >= goals.silver) n = 2;
  if (score >= goals.gold) n = 3;
  return n;
}

export function spotlightTierInfo(tiersReached) {
  return SPOTLIGHT_TIERS[Math.max(0, Math.min(3, tiersReached))];
}

export function currentSpotlightKey(date = new Date()) {
  return periodKey(date, SPOTLIGHT_PERIOD_DAYS);
}

// This rotation's best score (0 if the stored best belongs to an older one).
export function getSpotlightBest(date = new Date()) {
  const s = Storage.get("spotlight");
  return s && s.periodKey === currentSpotlightKey(date) ? s.best || 0 : 0;
}

// Tier indices (1..3) already paid out this rotation.
export function getSpotlightClaimedTiers(date = new Date()) {
  const s = Storage.get("spotlight");
  return s && s.periodKey === currentSpotlightKey(date) ? s.claimedTiers || [] : [];
}

// Whole days remaining in the current rotation (inclusive of today).
export function spotlightDaysLeft(date = new Date()) {
  return periodDaysLeft(date, SPOTLIGHT_PERIOD_DAYS);
}

// Record a finished Spotlight run: roll the best score/claimed tiers over
// when a new rotation has started, keep the highest score, count plays, and
// auto-pay the coin reward for any NEWLY reached tier this call (idempotent —
// a tier is only ever paid once per rotation). Returns a summary the caller
// uses to award coins and show feedback.
export function recordSpotlight(score, date = new Date()) {
  const key = currentSpotlightKey(date);
  const s = { ...Storage.get("spotlight") };
  if (s.periodKey !== key) {
    // A new rotation resets the chase.
    s.periodKey = key;
    s.best = 0;
    s.plays = 0;
    s.claimedTiers = [];
  }
  s.claimedTiers = Array.isArray(s.claimedTiers) ? s.claimedTiers.slice() : [];
  const prevBest = s.best || 0;
  const isNewBest = score > prevBest;
  if (isNewBest) s.best = score;
  s.plays = (s.plays || 0) + 1;

  const goals = getSpotlightGoals(getSpotlightLevel(date));
  const reached = spotlightTiersReached(goals, s.best);
  let coinsAwarded = 0;
  const newlyClaimedTiers = [];
  for (let tier = 1; tier <= reached; tier++) {
    if (!s.claimedTiers.includes(tier)) {
      s.claimedTiers.push(tier);
      coinsAwarded += SPOTLIGHT_TIER_REWARDS[tier - 1];
      newlyClaimedTiers.push(tier);
    }
  }

  Storage.set("spotlight", s);
  return {
    periodKey: key,
    best: s.best,
    prevBest,
    isNewBest,
    plays: s.plays,
    tiersReached: reached,
    newlyClaimedTiers,
    coinsAwarded,
  };
}
