// Piggy Bank: a coin vault that passively fills while you play. Every level you
// finish drips a few coins into the piggy (capped), but those coins stay locked
// until you "crack" the piggy open with a one-time purchase — a classic
// engagement + monetization loop. This module is pure (no DOM/storage); callers
// own persistence and the actual coin grant.

export const PIGGY_CAP = 5000; // max coins the piggy can hold
export const PIGGY_MIN_CRACK = 100; // must hold at least this much to crack open
export const PIGGY_RATE = 40; // 1 coin banked per PIGGY_RATE points of score
export const PIGGY_CRACK_PRODUCT = "piggy_crack";
export const PIGGY_CRACK_PRICE = "$1.99";

// How many coins a finished level deposits, given its score. Never negative.
export function piggyEarn(score) {
  return Math.max(0, Math.floor((Number(score) || 0) / PIGGY_RATE));
}

// Deposit a level's earnings into the piggy, capped at PIGGY_CAP. Returns the
// new balance and how much was actually added (0 once the piggy is full).
export function piggyDeposit(balance, score) {
  const cur = Math.max(0, Math.min(PIGGY_CAP, Number(balance) || 0));
  const room = PIGGY_CAP - cur;
  const added = Math.min(room, piggyEarn(score));
  return { balance: cur + added, added };
}

// Whether the piggy holds enough to be worth cracking open.
export function canCrackPiggy(balance) {
  return (Number(balance) || 0) >= PIGGY_MIN_CRACK;
}

// Fill fraction 0..1, for the piggy's progress bar.
export function piggyFillPct(balance) {
  return Math.max(0, Math.min(1, (Number(balance) || 0) / PIGGY_CAP));
}
