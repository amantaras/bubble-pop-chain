// Seeded pseudo-random number generator utilities.

// mulberry32: fast, deterministic PRNG seeded by a 32-bit integer.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash an arbitrary string into a 32-bit seed.
export function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

// Stable YYYY-MM-DD key for the local day (used by the daily challenge).
export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Stable ISO-8601 week key (e.g. "2024-W07") for the local week. Used by the
// weekly tournament so the whole week shares one seeded board. ISO weeks start
// on Monday and belong to the year that owns their Thursday.
export function weekKey(date = new Date()) {
  // Work on a date-only copy so the time of day never shifts the week.
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (d.getDay() + 6) % 7; // 0=Mon … 6=Sun
  d.setDate(d.getDate() - day + 3); // hop to this week's Thursday
  const isoYear = d.getFullYear();
  // Thursday of ISO week 1 is the Thursday in the week of Jan 4th.
  const wk1 = new Date(isoYear, 0, 4);
  const wk1Day = (wk1.getDay() + 6) % 7;
  wk1.setDate(wk1.getDate() - wk1Day + 3);
  const week = 1 + Math.round((d - wk1) / (7 * 86400000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}
