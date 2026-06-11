// Milestone events every 5 levels.
//
// The campaign alternates two "beats" on a fixed cadence so progression has a
// rhythm of reward and challenge:
//   • Treasure 🎁  — levels 5, 15, 25, 35: a generous reward beat (bonus coins
//                     plus one free power-up) the first time it is cleared.
//   • Boss 👹      — levels 10, 20, 30, 40: a challenge beat with a frozen core
//                     objective; the first clear pays a coin jackpot and unlocks
//                     a cosmetic theme.
//
// Everything here is a pure, deterministic function of the level id so the
// design is fully unit-testable and stays in sync with the level generator.

export const MILESTONE_EVERY = 5;

// Free power-ups handed out by treasure levels, rotating in this order.
const FREE_POWERUPS = ["bomb", "colorClear", "shuffle"];

// Cosmetic themes awarded by each boss, in order of boss number.
const BOSS_THEMES = ["sunset", "forest", "candy", "mono"];

export function isMilestone(id) {
  return id > 0 && id % MILESTONE_EVERY === 0;
}

// "treasure" on every 5th level, "boss" on every 10th, null otherwise.
export function milestoneType(id) {
  if (!isMilestone(id)) return null;
  return id % 10 === 0 ? "boss" : "treasure";
}

// 1-based ordinal of a treasure level: 5→1, 15→2, 25→3, 35→4.
function treasureIndex(id) {
  return (id + 5) / 10;
}

// 1-based ordinal of a boss level: 10→1, 20→2, 30→3, 40→4.
function bossIndex(id) {
  return id / 10;
}

// Reward for clearing a treasure level for the first time.
export function treasureReward(id) {
  if (milestoneType(id) !== "treasure") return null;
  const idx = treasureIndex(id);
  return {
    idx,
    bonus: 100 + idx * 25, // 125, 150, 175, 200
    powerup: FREE_POWERUPS[(idx - 1) % FREE_POWERUPS.length],
  };
}

// Reward for defeating a boss for the first time.
export function bossReward(id) {
  if (milestoneType(id) !== "boss") return null;
  const idx = bossIndex(id);
  return {
    idx,
    jackpot: 250 + idx * 75, // 325, 400, 475, 550
    theme: BOSS_THEMES[idx - 1] || null,
  };
}

// Frozen-core objective sizing for a boss level. The core is a centred block of
// ice bubbles that must all be shattered before the moves run out. It grows with
// the boss number, and boss levels are granted extra moves to stay fair.
export function bossConfig(id) {
  if (milestoneType(id) !== "boss") return null;
  const idx = bossIndex(id);
  const coreW = 1 + idx; // 2, 3, 4, 5
  const coreH = 2 + Math.floor((idx - 1) / 2); // 2, 2, 3, 3
  return {
    idx,
    coreW,
    coreH,
    coreCount: coreW * coreH, // 4, 6, 12, 15
    extraMoves: 6 + idx * 2, // 8, 10, 12, 14
  };
}
