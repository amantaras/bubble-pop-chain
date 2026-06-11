// Daily challenge: one seeded board per day, with a streak counter.
import { hashSeed, todayKey } from "./rng.js";
import { Storage } from "./storage.js";

// A fixed-shape, medium-difficulty board that is identical for everyone today.
export function getDailyLevel(date = new Date()) {
  const key = todayKey(date);
  const seed = hashSeed("daily-" + key);
  return {
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
}

export function alreadyPlayedToday(date = new Date()) {
  const d = Storage.get("daily");
  return d.lastDate === todayKey(date);
}

export function getStreak() {
  return Storage.get("daily").streak;
}

// Record a completed daily run, updating the streak. Returns streak info.
export function recordDaily(score, date = new Date()) {
  const today = todayKey(date);
  const d = { ...Storage.get("daily") };
  if (d.lastDate === today) {
    // Already played; just keep best score.
    d.lastScore = Math.max(d.lastScore, score);
    Storage.set("daily", d);
    return { streak: d.streak, bestStreak: d.bestStreak, isNew: false };
  }

  // Was yesterday the last play? If so, continue the streak.
  const yesterday = todayKey(new Date(date.getTime() - 86400000));
  d.streak = d.lastDate === yesterday ? d.streak + 1 : 1;
  d.bestStreak = Math.max(d.bestStreak || 0, d.streak);
  d.lastDate = today;
  d.lastScore = score;
  Storage.set("daily", d);
  return { streak: d.streak, bestStreak: d.bestStreak, isNew: true };
}
