// Login calendar: a rolling 7-day reward cycle that advances once per calendar
// day the player opens the game and claims. Pure + deterministic given the
// saved state and the day key, so it is trivially unit-testable.
//
// State shape (persisted in storage as `loginCalendar`):
//   { lastClaim: "YYYY-MM-DD" | null, day: <total claims> }
// `day % CALENDAR_CYCLE` is the 0-based index of the reward to claim next, so
// the cycle repeats forever with the grand prize landing on day 7.

export const CALENDAR_REWARDS = [
  { coins: 50 },
  { coins: 80 },
  { powerup: "bomb" },
  { coins: 120 },
  { powerup: "shuffle" },
  { coins: 180 },
  { coins: 250, crate: 1 }, // day 7 grand prize: big coins + a pet crate
];

export const CALENDAR_CYCLE = CALENDAR_REWARDS.length;

// Inspect the calendar for a given day key. Returns whether a reward can be
// claimed right now, which reward it is, and the cumulative claim count.
export function calendarStatus(state, key) {
  const day = state && state.day ? state.day : 0;
  const claimedToday = !!(state && state.lastClaim === key);
  const index = day % CALENDAR_CYCLE;
  return {
    claimable: !claimedToday,
    index,
    reward: CALENDAR_REWARDS[index],
    day,
    claimedToday,
  };
}

// The state after a successful claim on the given day key.
export function advanceCalendar(state, key) {
  const day = state && state.day ? state.day : 0;
  return { lastClaim: key, day: day + 1 };
}
