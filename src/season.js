// Season Pass (Battle Pass) — a time-limited progression track.
//
// Pure, deterministic logic with no DOM or storage access so it is trivially
// unit-testable. Players earn season XP by clearing levels; every full tier of
// XP unlocks a reward on the FREE track, and (once the premium pass is bought)
// a richer reward on the PREMIUM track. Claims are explicit and idempotent:
// the UI grants whatever `tierReward` returns and records the claim via
// `claimTier`. Nothing here ever changes win/star outcomes — it is a meta
// progression layer on top of normal play.

// XP needed to complete one tier.
export const SEASON_XP_PER_TIER = 100;

// The reward ladder. Each entry has a `free` reward (everyone) and a `premium`
// reward (only claimable once the premium pass is owned). Reward shape mirrors
// the login calendar: any of { coins, powerup, crate }.
export const SEASON_TIERS = [
  { free: { coins: 30 }, premium: { coins: 80 } },
  { free: { coins: 40 }, premium: { powerup: "bomb" } },
  { free: { powerup: "shuffle" }, premium: { coins: 120 } },
  { free: { coins: 60 }, premium: { crate: 1 } },
  { free: { coins: 80 }, premium: { powerup: "colorClear" } },
  { free: { powerup: "bomb" }, premium: { coins: 180 } },
  { free: { coins: 100 }, premium: { crate: 1 } },
  { free: { coins: 120 }, premium: { powerup: "magnet" } },
  { free: { powerup: "chainBolt" }, premium: { coins: 250 } },
  { free: { coins: 150 }, premium: { coins: 300, crate: 1 } },
];

export const SEASON_TIER_COUNT = SEASON_TIERS.length;

// The product id used to buy the premium pass (see Monetization.purchase).
export const SEASON_PREMIUM_PRODUCT = "season_premium";

// Normalise a (possibly partial / legacy) saved state into a complete object.
function norm(state) {
  const s = state || {};
  return {
    xp: Math.max(0, s.xp || 0),
    claimedFree: Array.isArray(s.claimedFree) ? s.claimedFree.slice() : [],
    claimedPrem: Array.isArray(s.claimedPrem) ? s.claimedPrem.slice() : [],
    premium: !!s.premium,
  };
}

// Number of tiers fully unlocked at a given XP total (capped at the ladder
// length). A tier with 0-based index `i` is unlocked once xp ≥ (i+1)*perTier.
export function tiersUnlocked(xp) {
  return Math.min(SEASON_TIER_COUNT, Math.floor(Math.max(0, xp) / SEASON_XP_PER_TIER));
}

// The reward object for a tier index on a given track ("free" | "premium").
export function tierReward(index, track) {
  const tier = SEASON_TIERS[index];
  if (!tier) return null;
  return track === "premium" ? tier.premium : tier.free;
}

// True when tier `index` on `track` is unlocked, unclaimed, and (for premium)
// the premium pass is owned.
export function canClaim(state, index, track) {
  const s = norm(state);
  if (index < 0 || index >= SEASON_TIER_COUNT) return false;
  if (index >= tiersUnlocked(s.xp)) return false; // not yet unlocked
  if (track === "premium") {
    if (!s.premium) return false;
    return !s.claimedPrem.includes(index);
  }
  return !s.claimedFree.includes(index);
}

// A snapshot of the whole track for rendering. `progress` is 0..1 toward the
// next tier; `claimable` counts how many rewards are ready to collect.
export function seasonStatus(state) {
  const s = norm(state);
  const unlocked = tiersUnlocked(s.xp);
  const maxed = unlocked >= SEASON_TIER_COUNT;
  const into = s.xp - unlocked * SEASON_XP_PER_TIER;
  let claimableFree = 0;
  let claimablePremium = 0;
  for (let i = 0; i < unlocked; i++) {
    if (!s.claimedFree.includes(i)) claimableFree++;
    if (s.premium && !s.claimedPrem.includes(i)) claimablePremium++;
  }
  return {
    xp: s.xp,
    premium: s.premium,
    unlocked,
    maxed,
    tier: Math.min(unlocked, SEASON_TIER_COUNT - 1),
    progress: maxed ? 1 : into / SEASON_XP_PER_TIER,
    intoTier: maxed ? SEASON_XP_PER_TIER : into,
    perTier: SEASON_XP_PER_TIER,
    claimableFree,
    claimablePremium,
    claimable: claimableFree + claimablePremium,
  };
}

// Add season XP, returning a new state (does not mutate the input).
export function addSeasonXp(state, amount) {
  const s = norm(state);
  s.xp += Math.max(0, Math.round(amount || 0));
  return s;
}

// Record a claim for tier `index` on `track`. Returns the updated state, or
// null when the tier is not currently claimable (caller should grant nothing).
export function claimTier(state, index, track) {
  if (!canClaim(state, index, track)) return null;
  const s = norm(state);
  if (track === "premium") s.claimedPrem.push(index);
  else s.claimedFree.push(index);
  return s;
}

// Mark the premium pass as owned (after a successful purchase).
export function unlockPremium(state) {
  const s = norm(state);
  s.premium = true;
  return s;
}
