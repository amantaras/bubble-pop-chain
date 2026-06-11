// Ambient falling events: a gift (reward) or a problem (hazard) occasionally
// drifts down over the board. Tap a gift to collect it; tap a problem to
// defuse it. A problem left to fall off-screen scatters nearby bubbles.
//
// Everything here is pure and deterministic when a seeded `rand` is supplied,
// so the timing/type/reward logic is unit-testable.

export const EVENT_GIFT = "gift";
export const EVENT_PROBLEM = "problem";

// Seconds between events (a fresh delay is rolled after each one resolves).
export const EVENT_MIN_DELAY = 12;
export const EVENT_MAX_DELAY = 20;

// Seconds a token takes to fall across the screen (matches the CSS animation).
export const EVENT_FALL_TIME = 3.8;

// Share of events that are gifts (the rest are problems).
export const GIFT_CHANCE = 0.55;

// Gift coin payout range and the chance of a power-up gift instead of coins.
export const GIFT_COIN_MIN = 25;
export const GIFT_COIN_MAX = 75;
export const GIFT_POWERUP_CHANCE = 0.25;

// Power-ups a gift may grant (the premium "magnet" is intentionally excluded).
export const GIFT_POWERUP_POOL = [
  "bomb",
  "colorClear",
  "shuffle",
  "pick",
  "chainBolt",
];

// Coins awarded for defusing a problem in time, and how many bubbles a missed
// problem scatters.
export const DEFUSE_REWARD = 12;
export const SCATTER_COUNT = 4;

// Seconds before the first event of a session (a bit shorter than the regular
// cadence so players meet the mechanic early without being overwhelmed).
export const EVENT_FIRST_DELAY = 8;

export function nextEventDelay(rand = Math.random) {
  return EVENT_MIN_DELAY + rand() * (EVENT_MAX_DELAY - EVENT_MIN_DELAY);
}

export function pickEventType(rand = Math.random) {
  return rand() < GIFT_CHANCE ? EVENT_GIFT : EVENT_PROBLEM;
}

// Decide a gift's payload: either { type:"coins", coins } or
// { type:"powerup", powerup }.
export function rollGiftReward(rand = Math.random) {
  if (rand() < GIFT_POWERUP_CHANCE) {
    const i = Math.floor(rand() * GIFT_POWERUP_POOL.length);
    return { type: "powerup", powerup: GIFT_POWERUP_POOL[i] };
  }
  const span = GIFT_COIN_MAX - GIFT_COIN_MIN;
  return { type: "coins", coins: Math.round(GIFT_COIN_MIN + rand() * span) };
}
