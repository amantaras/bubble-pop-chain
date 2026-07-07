// Lucky Wheel: a once-per-day spin for a genuinely random reward. Distinct
// from the login calendar (calendar.js), whose 7-day reward cycle is FIXED
// and known ahead of time — every wheel spin rolls a weighted reward fresh,
// so the suspense is real. Pure + deterministic given the rng function and
// state/day key, so it is trivially unit-testable.
//
// State shape (persisted in storage as `wheel`):
//   { lastSpin: "YYYY-MM-DD" | null }

// Each segment's `weight` is relative (they don't need to sum to any fixed
// total). Segments are drawn on the dial in this order, sized proportionally
// to their weight — a bigger weight means a bigger (and more likely) slice.
export const WHEEL_REWARDS = [
  { id: "coins60", weight: 24, coins: 60, icon: "🪙", label: "60 Coins" },
  { id: "coins100", weight: 20, coins: 100, icon: "🪙", label: "100 Coins" },
  { id: "dust20", weight: 16, dust: 20, icon: "✨", label: "20 Dust" },
  { id: "coins150", weight: 14, coins: 150, icon: "🪙", label: "150 Coins" },
  { id: "dust40", weight: 10, dust: 40, icon: "✨", label: "40 Dust" },
  { id: "powerup", weight: 8, powerup: "bomb", icon: "💥", label: "Bomb ×1" },
  { id: "crate", weight: 6, crate: 1, icon: "📦", label: "Pet Crate" },
  { id: "jackpot", weight: 2, coins: 500, crate: 1, icon: "🎉", label: "JACKPOT!" },
];

export const WHEEL_WEIGHT_TOTAL = WHEEL_REWARDS.reduce((s, r) => s + r.weight, 0);

// Inspect the wheel for a given day key: can the player spin right now? Same
// once-per-day gate shape as the daily challenge / login calendar.
export function wheelStatus(state, key) {
  const lastSpin = state && state.lastSpin ? state.lastSpin : null;
  return { claimable: lastSpin !== key, lastSpin };
}

// Resolve one weighted spin. `rng` is a function returning a value in
// [0, 1) — genuinely random (Math.random) during real play, seeded for
// deterministic tests. Returns `{ reward, index }` (the dial segment index,
// for animating the stop position); does NOT mutate any state.
export function spinWheel(rng) {
  let roll = rng() * WHEEL_WEIGHT_TOTAL;
  for (let i = 0; i < WHEEL_REWARDS.length; i++) {
    const r = WHEEL_REWARDS[i];
    if (roll < r.weight) return { reward: r, index: i };
    roll -= r.weight;
  }
  // Floating point safety net: land on the last segment rather than falling
  // through (should only happen from rounding at roll ≈ total).
  const last = WHEEL_REWARDS.length - 1;
  return { reward: WHEEL_REWARDS[last], index: last };
}

// The state after a successful spin on the given day key.
export function advanceWheel(key) {
  return { lastSpin: key };
}
