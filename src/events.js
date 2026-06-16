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
// Power-ups are the gift that players actually feel, so they land a healthy
// share of the time (not the occasional rarity coins used to crowd out) —
// roughly 2-in-5 gifts hand over a free tool.
export const GIFT_COIN_MIN = 25;
export const GIFT_COIN_MAX = 75;
export const GIFT_POWERUP_CHANCE = 0.4;
// A gift can also (rarely) contain a pet crate, tying pet collection into
// everyday play. Kept small so crates still feel like a treat.
export const GIFT_CRATE_CHANCE = 0.08;
// A gift can also contain a loose GEM (slotted into a pet's sockets for buffs),
// tying the gem economy into everyday play alongside crates.
export const GIFT_GEM_CHANCE = 0.12;

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

// Decide a gift's payload: { type:"crate" }, { type:"gem" },
// { type:"powerup", powerup } or { type:"coins", coins }.
export function rollGiftReward(rand = Math.random) {
  const r = rand();
  if (r < GIFT_CRATE_CHANCE) return { type: "crate" };
  if (r < GIFT_CRATE_CHANCE + GIFT_GEM_CHANCE) return { type: "gem" };
  if (r < GIFT_CRATE_CHANCE + GIFT_GEM_CHANCE + GIFT_POWERUP_CHANCE) {
    const i = Math.floor(rand() * GIFT_POWERUP_POOL.length);
    return { type: "powerup", powerup: GIFT_POWERUP_POOL[i] };
  }
  const span = GIFT_COIN_MAX - GIFT_COIN_MIN;
  return { type: "coins", coins: Math.round(GIFT_COIN_MIN + rand() * span) };
}
