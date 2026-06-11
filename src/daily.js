// Daily challenge: one seeded board per day, with a streak counter.
import { hashSeed, todayKey } from "./rng.js";
import { Storage } from "./storage.js";

// A rotating daily modifier keeps the challenge fresh. Each entry tweaks the
// base board config and is chosen deterministically from the day's key, so
// every player gets the same modifier on the same day.
export const DAILY_MODIFIERS = [
  {
    id: "classic",
    label: "Classic",
    desc: "A balanced board — pure popping.",
    apply: (l) => l,
  },
  {
    id: "rainbow-rush",
    label: "Rainbow Rush",
    desc: "Rainbow bubbles everywhere.",
    apply: (l) => ({ ...l, specials: { rainbow: 0.12, ice: 0.03 } }),
  },
  {
    id: "ice-age",
    label: "Ice Age",
    desc: "Frozen bubbles need two hits.",
    apply: (l) => ({ ...l, specials: { rainbow: 0.02, ice: 0.16 } }),
  },
  {
    id: "color-storm",
    label: "Colour Storm",
    desc: "Six colours — tougher matches.",
    apply: (l) => ({ ...l, colors: 6 }),
  },
  {
    id: "big-board",
    label: "Big Board",
    desc: "A taller board, more to clear.",
    apply: (l) => ({ ...l, rows: 12 }),
  },
  {
    id: "tri-color",
    label: "Tri-Colour",
    desc: "Only three colours — chain big!",
    apply: (l) => ({ ...l, colors: 3 }),
  },
  {
    id: "frosted-rainbow",
    label: "Frosted Rainbow",
    desc: "Rainbows and ice together.",
    apply: (l) => ({ ...l, specials: { rainbow: 0.09, ice: 0.1 } }),
  },
];

// Coins granted for each consecutive day of a 7-day streak cycle. Day 7 is the
// big payout (and also awards a streak-freeze token).
export const WEEK_REWARDS = [40, 55, 70, 90, 120, 160, 250];
const FREEZE_TOKEN_CAP = 3;

export function getDailyModifier(date = new Date()) {
  const key = todayKey(date);
  const idx = hashSeed("dailymod-" + key) % DAILY_MODIFIERS.length;
  return DAILY_MODIFIERS[idx];
}

// A fixed-shape, medium-difficulty board that is identical for everyone today.
export function getDailyLevel(date = new Date()) {
  const key = todayKey(date);
  const seed = hashSeed("daily-" + key);
  const base = {
    id: "daily",
    key,
    cols: 8,
    rows: 10,
    colors: 5,
    moves: 999, // daily is a clear-as-much / high-score mode (no move limit)
    target: 0,
    specials: { rainbow: 0.04, ice: 0.06 },
    seed,
  };
  const mod = getDailyModifier(date);
  return { ...mod.apply(base), modifier: { id: mod.id, label: mod.label, desc: mod.desc } };
}

// Three tiered score goals for the daily board → 1/2/3 daily stars.
export function getDailyGoals(level) {
  const cells = level.cols * level.rows;
  const unit = Math.round(cells * (8 + level.colors));
  return { one: unit * 4, two: unit * 7, three: unit * 11 };
}

export function dailyStarsForScore(goals, score) {
  if (score >= goals.three) return 3;
  if (score >= goals.two) return 2;
  if (score >= goals.one) return 1;
  return 0;
}

export function alreadyPlayedToday(date = new Date()) {
  const d = Storage.get("daily");
  return d.lastDate === todayKey(date);
}

export function getStreak() {
  return Storage.get("daily").streak;
}

export function getFreezeTokens() {
  return Storage.get("daily").freezeTokens || 0;
}

// The reward for a given streak day (1-based) within the 7-day cycle.
export function rewardForStreak(streak) {
  const idx = ((Math.max(1, streak) - 1) % 7 + 7) % 7;
  return { coins: WEEK_REWARDS[idx], dayInCycle: idx + 1, freeze: idx + 1 === 7 };
}

// Record a completed daily run: update streak (with optional freeze-token
// rescue of a single missed day), grant the day's reward, and track best stars.
// Returns a summary the caller uses to award coins and show feedback.
export function recordDaily(score, stars = 0, date = new Date()) {
  const today = todayKey(date);
  const d = { ...Storage.get("daily") };
  d.freezeTokens = d.freezeTokens || 0;

  if (d.lastDate === today) {
    // Already played today: keep the best score/stars, no extra reward.
    d.lastScore = Math.max(d.lastScore, score);
    d.bestStars = Math.max(d.bestStars || 0, stars);
    Storage.set("daily", d);
    return {
      streak: d.streak,
      bestStreak: d.bestStreak,
      isNew: false,
      coins: 0,
      freezeAwarded: false,
      usedFreeze: false,
      stars: d.bestStars,
    };
  }

  const yesterday = todayKey(new Date(date.getTime() - 86400000));
  const dayBefore = todayKey(new Date(date.getTime() - 2 * 86400000));

  let usedFreeze = false;
  if (d.lastDate === yesterday) {
    d.streak = (d.streak || 0) + 1; // streak continues
  } else if (d.lastDate === dayBefore && d.freezeTokens > 0) {
    // Exactly one missed day, rescued by a freeze token.
    d.freezeTokens -= 1;
    d.streak = (d.streak || 0) + 1;
    usedFreeze = true;
  } else {
    d.streak = 1; // streak broken (or first ever play)
  }

  d.bestStreak = Math.max(d.bestStreak || 0, d.streak);
  d.lastDate = today;
  d.lastScore = score;
  d.bestStars = Math.max(d.bestStars || 0, stars);

  const reward = rewardForStreak(d.streak);
  let freezeAwarded = false;
  if (reward.freeze && d.freezeTokens < FREEZE_TOKEN_CAP) {
    d.freezeTokens += 1;
    freezeAwarded = true;
  }

  Storage.set("daily", d);
  return {
    streak: d.streak,
    bestStreak: d.bestStreak,
    isNew: true,
    coins: reward.coins,
    dayInCycle: reward.dayInCycle,
    freezeAwarded,
    usedFreeze,
    stars,
  };
}
