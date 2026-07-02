// Daily & Weekly Quests: a rotating set of small goals that refresh each day
// (3 daily quests) and each week (1 weekly quest). Pure + deterministic given
// the saved state and the day/week keys, so it is trivially unit-testable.
// Quests watch gameplay metrics emitted during play; completing one makes its
// reward claimable on the Quests screen.
//
// State shape (persisted in storage as `quests`):
//   { dayKey, weekKey, daily: [ {id, progress, claimed} ], weekly: [ {…} ] }
//
// A quest template carries:
//   metric — the gameplay counter it watches (bubbles|levelsWon|fevers|combo|
//            group|specials)
//   mode   — "count" accumulates the metric; "max" tracks the best single value
//   goal   — the target value
//   reward — { coins?, powerup?, crate?, seasonXp? }

import { makeRng, hashSeed } from "./rng.js";

export const DAILY_QUESTS = [
  { id: "d_pop150", metric: "bubbles", mode: "count", goal: 150, label: "Pop 150 bubbles", reward: { coins: 60 } },
  { id: "d_pop300", metric: "bubbles", mode: "count", goal: 300, label: "Pop 300 bubbles", reward: { coins: 110 } },
  { id: "d_win3", metric: "levelsWon", mode: "count", goal: 3, label: "Win 3 levels", reward: { powerup: "shuffle" } },
  { id: "d_fever2", metric: "fevers", mode: "count", goal: 2, label: "Trigger Fever twice", reward: { coins: 80 } },
  { id: "d_combo5", metric: "combo", mode: "max", goal: 5, label: "Reach a ×5 combo", reward: { coins: 70 } },
  { id: "d_group8", metric: "group", mode: "max", goal: 8, label: "Pop a group of 8+", reward: { coins: 70 } },
  { id: "d_special3", metric: "specials", mode: "count", goal: 3, label: "Pop 3 special bubbles", reward: { coins: 90 } },
];

export const WEEKLY_QUESTS = [
  { id: "w_pop2000", metric: "bubbles", mode: "count", goal: 2000, label: "Pop 2,000 bubbles", reward: { crate: 1 } },
  { id: "w_win15", metric: "levelsWon", mode: "count", goal: 15, label: "Win 15 levels", reward: { coins: 400 } },
  { id: "w_fever12", metric: "fevers", mode: "count", goal: 12, label: "Trigger Fever 12 times", reward: { coins: 350 } },
  { id: "w_combo8", metric: "combo", mode: "max", goal: 8, label: "Reach a ×8 combo", reward: { coins: 300, seasonXp: 60 } },
];

export const DAILY_COUNT = 3;
export const WEEKLY_COUNT = 1;

const BY_ID = {};
for (const q of [...DAILY_QUESTS, ...WEEKLY_QUESTS]) BY_ID[q.id] = q;

// Look up a quest template by id (null if unknown — e.g. a retired quest left
// in an old save).
export function questDef(id) {
  return BY_ID[id] || null;
}

// Deterministically pick `count` distinct quests from `pool`, seeded by `key`,
// returning fresh tracking entries. A seeded Fisher–Yates shuffle keeps the
// daily/weekly selection stable for the whole day/week and reproducible.
function pickQuests(pool, key, count) {
  const rng = makeRng(hashSeed(`quests-${key}`));
  const idx = pool.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = idx[i];
    idx[i] = idx[j];
    idx[j] = t;
  }
  return idx
    .slice(0, Math.min(count, pool.length))
    .map((i) => ({ id: pool[i].id, progress: 0, claimed: false }));
}

// Ensure the quest state matches the current day/week keys: roll a fresh daily
// set when the day rolls over and a fresh weekly when the week rolls over.
// Returns a NEW state object (never mutates the input).
export function ensureQuests(state, dayKey, weekKey) {
  const s = state && typeof state === "object" ? state : {};
  let daily = Array.isArray(s.daily) && s.daily.length ? s.daily : null;
  let weekly = Array.isArray(s.weekly) && s.weekly.length ? s.weekly : null;
  let dKey = s.dayKey;
  let wKey = s.weekKey;
  if (dKey !== dayKey || !daily) {
    daily = pickQuests(DAILY_QUESTS, dayKey, DAILY_COUNT);
    dKey = dayKey;
  }
  if (wKey !== weekKey || !weekly) {
    weekly = pickQuests(WEEKLY_QUESTS, weekKey, WEEKLY_COUNT);
    wKey = weekKey;
  }
  return { dayKey: dKey, weekKey: wKey, daily, weekly };
}

// Fold a metric delta object into the active quests. Each delta key is a metric
// name; "count" quests add the value, "max" quests track the maximum. Already
// claimed quests stop accumulating; progress is capped at the goal. Returns a
// NEW state plus the number of quests that became newly complete (for toasts).
export function applyQuestProgress(state, deltas) {
  const fold = (entry) => {
    const def = questDef(entry.id);
    if (!def || entry.claimed) return entry;
    const v = deltas[def.metric];
    if (v === undefined || v === null) return entry;
    const wasComplete = entry.progress >= def.goal;
    let progress = entry.progress;
    if (def.mode === "max") progress = Math.max(progress, v);
    else progress = progress + v;
    progress = Math.min(progress, def.goal);
    if (!wasComplete && progress >= def.goal) result.newlyComplete++;
    return { ...entry, progress };
  };
  const result = { newlyComplete: 0 };
  const next = {
    ...state,
    daily: (state.daily || []).map(fold),
    weekly: (state.weekly || []).map(fold),
  };
  return { state: next, newlyComplete: result.newlyComplete };
}

export function isQuestComplete(entry) {
  const def = questDef(entry.id);
  return !!def && entry.progress >= def.goal;
}

export function isQuestClaimable(entry) {
  return isQuestComplete(entry) && !entry.claimed;
}

// Claim a completed-but-unclaimed quest at the given scope/index. Returns
// { state, reward, def } or null if it is not claimable. The returned state is
// new; the claimed entry is flagged so its reward can't be taken twice.
export function claimQuest(state, scope, index) {
  const listKey = scope === "weekly" ? "weekly" : "daily";
  const list = state[listKey] || [];
  const entry = list[index];
  if (!entry || !isQuestClaimable(entry)) return null;
  const def = questDef(entry.id);
  const nextList = list.map((e, i) => (i === index ? { ...e, claimed: true } : e));
  return { state: { ...state, [listKey]: nextList }, reward: def.reward, def };
}

// Number of quests whose reward is ready to claim (drives the menu badge).
export function questsClaimable(state) {
  if (!state) return 0;
  const all = [...(state.daily || []), ...(state.weekly || [])];
  return all.filter(isQuestClaimable).length;
}

// Combine several claimed-quest results (each shaped like the object
// `Game.claimQuestReward` returns: `{ reward: {coins, powerup, crate,
// seasonXp} }`) into one aggregate for the Quests screen's "Collect All"
// reveal — mirrors achievements.js's `aggregateChestRewards` for the quest
// reward shape, so both collection screens present a batch-claim the same
// way. Pure; `powerups` merges duplicate ids by count so two single-tool
// claims in one pass show as one row with n=2. `id`-only entries (icon/name
// are resolved by the UI from POWERUP_INFO, like the pre-claim reward label
// already does) keep this module free of any economy.js/UI dependency.
export function aggregateQuestRewards(claims) {
  const out = { count: 0, coins: 0, powerups: [], crates: 0, seasonXp: 0 };
  const byId = new Map();
  for (const c of claims || []) {
    const r = c && c.reward;
    if (!r) continue;
    out.count += 1;
    out.coins += r.coins || 0;
    out.crates += r.crate || 0;
    out.seasonXp += r.seasonXp || 0;
    if (r.powerup) {
      const cur = byId.get(r.powerup);
      if (cur) cur.n += 1;
      else {
        const entry = { id: r.powerup, n: 1 };
        byId.set(r.powerup, entry);
        out.powerups.push(entry);
      }
    }
  }
  return out;
}
