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

// Free power-ups handed out by treasure levels, rotating in a gentle order that
// mirrors the campaign tool ramp. Advanced tools are stockpiled only after they
// have had their own unlock moment.
const FREE_POWERUPS = ["shuffle", "bomb", "colorClear", "chainBolt"];

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

// Frozen-core objective sizing for a boss level. Bosses now come in three
// archetypes that rotate by boss number so the challenge beats stay varied:
//   • frozen 🧊 — shatter a centred block of ice bubbles (two hits each).
//   • stone  🪨 — break a centred vault of locked stone bubbles (only an
//                 adjacent pop frees each one).
//   • color  🎨 — purge every bubble of one marked colour from the board.
// Each archetype is granted extra moves to keep the objective fair. The
// returned shape always carries `kind`, a human `label`, a short `hudLabel`,
// and `extraMoves`; frozen/stone also carry their block sizing.
export const BOSS_ARCHETYPES = ["frozen", "stone", "color"];

// Boss objective sizing grows with the boss number but plateaus at this tier so
// vaults/cores keep fitting the board (and move grants stay sane) no matter how
// far the endless campaign runs. Bosses 1–8 (levels 10–80) cover the full ramp;
// beyond that the size is constant. Kind still rotates by the real boss index.
export const BOSS_TIER_CAP = 8;

export function bossConfig(id) {
  if (milestoneType(id) !== "boss") return null;
  const idx = bossIndex(id);
  const kind = BOSS_ARCHETYPES[(idx - 1) % BOSS_ARCHETYPES.length];
  // Capped tier drives the objective size + bonus moves so high bosses stay
  // board-sized and fair; the original bosses 1–4 are unaffected (tier === idx).
  const tier = Math.min(idx, BOSS_TIER_CAP);

  if (kind === "stone") {
    // A thin (2-row) vault keeps every stone reachable: each one always borders
    // a non-stone cell so an adjacent pop can break it.
    const vaultW = 2 + Math.floor((tier - 1) / BOSS_ARCHETYPES.length);
    const vaultH = 2;
    return {
      idx,
      kind,
      vaultW,
      vaultH,
      objectiveCount: vaultW * vaultH,
      label: "Stone Vault",
      hudLabel: "Stone",
      extraMoves: 10 + tier * 2,
    };
  }

  if (kind === "color") {
    return {
      idx,
      kind,
      label: "Colour Purge",
      hudLabel: "Left",
      extraMoves: 8 + tier * 2,
    };
  }

  // Default: the classic frozen core, growing with the boss number.
  const coreW = 1 + tier; // 2, 3, 4, 5 … capped at 9
  const coreH = 2 + Math.floor((tier - 1) / 2); // 2, 2, 3, 3 … capped
  return {
    idx,
    kind: "frozen",
    coreW,
    coreH,
    coreCount: coreW * coreH, // 4, 6, 12, 15 …
    objectiveCount: coreW * coreH,
    label: "Frozen Core",
    hudLabel: "Core",
    extraMoves: 6 + tier * 2, // 8, 10, 12, 14 …
  };
}
