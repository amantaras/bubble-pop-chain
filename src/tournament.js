// Weekly tournament: one seeded board for the whole week, plus a local-only
// best-score chase with rank tiers (no online leaderboard). Unlike the daily
// challenge (once per day), the tournament can be replayed all week long to
// climb the ranks and beat your own weekly best.
import { hashSeed, weekKey } from "./rng.js";
import { Storage } from "./storage.js";

// A rotating weekly modifier keeps the tournament fresh. Each entry tweaks the
// base board and is chosen deterministically from the week key, so everyone
// shares the same arena for the whole week.
export const TOURNAMENT_MODIFIERS = [
  {
    id: "classic-cup",
    label: "Classic Cup",
    desc: "A balanced arena — pure popping.",
    apply: (l) => l,
  },
  {
    id: "rainbow-rally",
    label: "Rainbow Rally",
    desc: "Rainbows everywhere — chain them!",
    apply: (l) => ({ ...l, specials: { rainbow: 0.13, ice: 0.03 } }),
  },
  {
    id: "deep-freeze",
    label: "Deep Freeze",
    desc: "Frozen bubbles need two hits.",
    apply: (l) => ({ ...l, specials: { rainbow: 0.03, ice: 0.17 } }),
  },
  {
    id: "six-shooter",
    label: "Six Shooter",
    desc: "Six colours — tougher matches.",
    apply: (l) => ({ ...l, colors: 6 }),
  },
  {
    id: "grand-arena",
    label: "Grand Arena",
    desc: "A taller board — more to clear.",
    apply: (l) => ({ ...l, rows: 12 }),
  },
];

// Rank ladder earned by the week's best score. Purely local — a personal
// trophy chase. Each tier is keyed to the tournament's score goals so the bar
// scales with the week's board size and colour count.
export const TOURNAMENT_RANKS = [
  { id: "bronze", label: "Bronze", icon: "🥉", tier: 0 },
  { id: "silver", label: "Silver", icon: "🥈", tier: 1 },
  { id: "gold", label: "Gold", icon: "🥇", tier: 2 },
  { id: "platinum", label: "Platinum", icon: "🏆", tier: 3 },
  { id: "diamond", label: "Diamond", icon: "💎", tier: 4 },
];

export function getTournamentModifier(date = new Date()) {
  const key = weekKey(date);
  const idx = hashSeed("tourmod-" + key) % TOURNAMENT_MODIFIERS.length;
  return TOURNAMENT_MODIFIERS[idx];
}

// A fixed-shape, challenging board identical for everyone this week.
export function getTournamentLevel(date = new Date()) {
  const key = weekKey(date);
  const seed = hashSeed("tournament-" + key);
  const base = {
    id: "tournament",
    key,
    cols: 8,
    rows: 11,
    colors: 5,
    moves: 999, // high-score mode — play until the board deadlocks
    target: 0,
    specials: { rainbow: 0.05, ice: 0.07 },
    seed,
  };
  const mod = getTournamentModifier(date);
  return {
    ...mod.apply(base),
    modifier: { id: mod.id, label: mod.label, desc: mod.desc },
  };
}

// Four ascending score goals → silver/gold/platinum/diamond (bronze is the
// floor for finishing at all).
export function getTournamentGoals(level) {
  const cells = level.cols * level.rows;
  const unit = Math.round(cells * (9 + level.colors));
  return { silver: unit * 5, gold: unit * 8, platinum: unit * 12, diamond: unit * 17 };
}

// Map a score to its rank-tier index (0..4) against the week's goals.
export function tournamentRankIndex(goals, score) {
  if (score >= goals.diamond) return 4;
  if (score >= goals.platinum) return 3;
  if (score >= goals.gold) return 2;
  if (score >= goals.silver) return 1;
  return 0;
}

// Map a score to its full rank descriptor.
export function tournamentRank(goals, score) {
  return TOURNAMENT_RANKS[tournamentRankIndex(goals, score)];
}

export function currentWeekKey(date = new Date()) {
  return weekKey(date);
}

// This week's best score (0 if the stored best belongs to an older week).
export function getTournamentBest(date = new Date()) {
  const t = Storage.get("tournament");
  return t && t.weekKey === weekKey(date) ? t.best || 0 : 0;
}

// Whole days remaining in the current ISO week (Mon–Sun), 1..7.
export function tournamentDaysLeft(date = new Date()) {
  const dow = (date.getDay() + 6) % 7; // 0=Mon … 6=Sun
  return 7 - dow;
}

// Record a finished tournament run: roll the best score over when a new week
// has started, keep the highest score, and count plays. Returns a summary the
// caller uses to award coins and show feedback.
export function recordTournament(score, date = new Date()) {
  const wk = weekKey(date);
  const t = { ...Storage.get("tournament") };
  if (t.weekKey !== wk) {
    // A new week resets the chase.
    t.weekKey = wk;
    t.best = 0;
    t.plays = 0;
  }
  const prevBest = t.best || 0;
  const isNewBest = score > prevBest;
  if (isNewBest) t.best = score;
  t.plays = (t.plays || 0) + 1;
  Storage.set("tournament", t);
  return {
    weekKey: wk,
    best: t.best,
    prevBest,
    isNewBest,
    plays: t.plays,
  };
}
