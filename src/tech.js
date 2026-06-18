// Pet Technology Tree — a per-pet upgrade tree the player advances by spending
// the level-up picks a pet earns as it grows. Milestone levels unlock one tier;
// the player picks ONE of that tier's two nodes, permanently
// customizing the pet. Pure & deterministic so every rule is unit-testable.
//
// Design notes (intentionally FAIR / additive, never pay-to-win):
//   • Picks are earned purely from XP (clearing levels) — no currency, no IAP.
//   • Every node is a small buff; the two options per tier are a genuine
//     trade-off (e.g. more score vs more coins), not a strict upgrade.
//   • Nodes fold into petBuffs / petActive exactly like traits and gems, so the
//     tree is a third customization layer stacked on top of those.
//
// A pet's chosen nodes are stored per-pet as `owned[id].tech` (an array of node
// ids). This module owns the TREE shape and the pure rules; storage owns the
// per-pet array and main.js wires the picking + live refresh.
//
// tech.js has NO dependency on pets.js (pets.js imports tech.js — one-way), so
// it stays a leaf module.

// The number of tiers in the tree. Pets have a long 12-level arc; tech tiers
// unlock from Lv.2 through Lv.12, with the last two tiers reserved for late-game
// specialization.
export const MAX_TECH_TIERS = 10;

// The tree: four tiers, each unlocked at a pet level and offering a choice of
// two nodes. A node's `mods` fold into the pet's buffs/active:
//   passive (multiplicative, 1 + sum): scoreMult / coinMult / powerMult /
//     feverMult ; additive: startCharge
//   active: cooldownDelta (− = faster) / countDelta / strengthMult (×)
export const TECH_TREE = [
  {
    tier: 1,
    minLevel: 2,
    options: [
      {
        id: "t1_power",
        icon: "⚔️",
        name: "Power Core",
        desc: "+6% points scored while equipped.",
        mods: { scoreMult: 0.06 },
      },
      {
        id: "t1_fortune",
        icon: "💰",
        name: "Fortune",
        desc: "+8% coins earned while equipped.",
        mods: { coinMult: 0.08 },
      },
    ],
  },
  {
    tier: 2,
    minLevel: 3,
    options: [
      {
        id: "t2_charge",
        icon: "⚡",
        name: "Charged",
        desc: "+8% faster Charge meter.",
        mods: { powerMult: 0.08 },
      },
      {
        id: "t2_frenzy",
        icon: "🔥",
        name: "Frenzy",
        desc: "+8% faster Fever meter.",
        mods: { feverMult: 0.08 },
      },
    ],
  },
  {
    tier: 3,
    minLevel: 4,
    options: [
      {
        id: "t3_focus",
        icon: "🎯",
        name: "Sharp Focus",
        desc: "+10% points scored while equipped.",
        mods: { scoreMult: 0.1 },
      },
      {
        id: "t3_haste",
        icon: "🌀",
        name: "Haste",
        desc: "Active ability charges 1 move sooner, +5% Charge.",
        mods: { cooldownDelta: -1, powerMult: 0.05 },
      },
    ],
  },
  {
    tier: 4,
    minLevel: 5,
    options: [
      {
        id: "t4_overdrive",
        icon: "🌟",
        name: "Overdrive",
        desc: "+10% to all passive buffs (score, coins, charge, fever).",
        mods: { scoreMult: 0.1, coinMult: 0.1, powerMult: 0.1, feverMult: 0.1 },
      },
      {
        id: "t4_mastery",
        icon: "⚙️",
        name: "Mastery",
        desc: "Active ability hits +1 bubble & 15% harder, +6% points.",
        mods: { countDelta: 1, strengthMult: 1.15, scoreMult: 0.06 },
      },
    ],
  },
  {
    tier: 5,
    minLevel: 6,
    options: [
      {
        id: "t5_combo",
        icon: "🔗",
        name: "Combo Instinct",
        desc: "+12% points and +5% faster Fever meter.",
        mods: { scoreMult: 0.12, feverMult: 0.05 },
      },
      {
        id: "t5_treasure",
        icon: "💎",
        name: "Treasure Sense",
        desc: "+14% coins and +4% faster Charge meter.",
        mods: { coinMult: 0.14, powerMult: 0.04 },
      },
    ],
  },
  {
    tier: 6,
    minLevel: 7,
    options: [
      {
        id: "t6_quickdraw",
        icon: "⏱️",
        name: "Quickdraw",
        desc: "Active ability charges 1 move sooner, +6% Fever.",
        mods: { cooldownDelta: -1, feverMult: 0.06 },
      },
      {
        id: "t6_wide_arc",
        icon: "📡",
        name: "Wide Arc",
        desc: "Active ability reaches +1 bubble and hits 10% harder.",
        mods: { countDelta: 1, strengthMult: 1.1 },
      },
    ],
  },
  {
    tier: 7,
    minLevel: 8,
    options: [
      {
        id: "t7_overcharge",
        icon: "⚡",
        name: "Overcharge",
        desc: "+12% faster Charge and start with +8% Charge.",
        mods: { powerMult: 0.12, startCharge: 0.08 },
      },
      {
        id: "t7_heatwave",
        icon: "🔥",
        name: "Heatwave",
        desc: "+12% faster Fever and +6% points.",
        mods: { feverMult: 0.12, scoreMult: 0.06 },
      },
    ],
  },
  {
    tier: 8,
    minLevel: 9,
    options: [
      {
        id: "t8_specialist",
        icon: "🎯",
        name: "Specialist",
        desc: "+16% points scored while equipped.",
        mods: { scoreMult: 0.16 },
      },
      {
        id: "t8_patron",
        icon: "🏦",
        name: "Patron",
        desc: "+18% coins earned while equipped.",
        mods: { coinMult: 0.18 },
      },
    ],
  },
  {
    tier: 9,
    minLevel: 10,
    options: [
      {
        id: "t9_reflex",
        icon: "🌀",
        name: "Reflex Loop",
        desc: "Active ability charges 1 move sooner, +8% Charge and Fever.",
        mods: { cooldownDelta: -1, powerMult: 0.08, feverMult: 0.08 },
      },
      {
        id: "t9_force",
        icon: "💥",
        name: "Force Bloom",
        desc: "Active ability reaches +2 bubbles and hits 12% harder.",
        mods: { countDelta: 2, strengthMult: 1.12 },
      },
    ],
  },
  {
    tier: 10,
    minLevel: 12,
    options: [
      {
        id: "t10_ascendant",
        icon: "🌌",
        name: "Ascendant",
        desc: "+14% to score, coins, Charge, and Fever.",
        mods: { scoreMult: 0.14, coinMult: 0.14, powerMult: 0.14, feverMult: 0.14 },
      },
      {
        id: "t10_legend",
        icon: "👑",
        name: "Legend Bond",
        desc: "Active ability charges 1 move sooner, reaches +1 bubble, and starts +10% charged.",
        mods: { cooldownDelta: -1, countDelta: 1, strengthMult: 1.1, startCharge: 0.1 },
      },
    ],
  },
];

// All node ids, flattened (handy for tests / validation).
export const TECH_NODE_IDS = TECH_TREE.flatMap((t) => t.options.map((o) => o.id));

// The tier descriptor (tier/minLevel/options) at a 0-based index, or null.
export function techTierAt(index) {
  return TECH_TREE[index] || null;
}

// The two options for the tier at a 0-based index.
export function techTierOptions(index) {
  const t = TECH_TREE[index];
  return t ? t.options : [];
}

// Resolve a node id to its definition (searching every tier), or null.
export function techNode(id) {
  for (const t of TECH_TREE) {
    const found = t.options.find((o) => o.id === id);
    if (found) return found;
  }
  return null;
}

// The 0-based tier index a node belongs to, or -1 if the id is unknown.
export function techTierOf(id) {
  for (let i = 0; i < TECH_TREE.length; i++) {
    if (TECH_TREE[i].options.some((o) => o.id === id)) return i;
  }
  return -1;
}

// How many tiers a pet at `level` has unlocked (tiers whose minLevel ≤ level).
export function techTiersUnlocked(level) {
  const lvl = Math.floor(level || 0);
  let n = 0;
  for (const t of TECH_TREE) if (lvl >= t.minLevel) n++;
  return n;
}

// The 0-based index of the next tier the pet can pick — the first UNLOCKED tier
// (minLevel ≤ level) that has no chosen node yet — or -1 if there is nothing
// pending (all unlocked tiers picked, or none unlocked yet). `chosen` is the
// pet's array of chosen node ids.
export function pendingTechTier(chosen, level) {
  const ids = chosen || [];
  const unlocked = techTiersUnlocked(level);
  for (let i = 0; i < unlocked; i++) {
    const picked = TECH_TREE[i].options.some((o) => ids.includes(o.id));
    if (!picked) return i;
  }
  return -1;
}

// Whether the pet has at least one tier ready to pick right now.
export function hasPendingTech(chosen, level) {
  return pendingTechTier(chosen, level) >= 0;
}

// Whether `nodeId` is a legal pick for a pet with `chosen` nodes at `level`:
// the node exists, its tier is the currently-pending tier, and that tier has no
// node chosen yet. (Prevents double-picking a tier or skipping ahead.)
export function canPickTech(chosen, nodeId, level) {
  const tierIdx = techTierOf(nodeId);
  if (tierIdx < 0) return false;
  return pendingTechTier(chosen, level) === tierIdx;
}

// Aggregate the PASSIVE buff multipliers from a pet's chosen nodes, as a flat
// object the game multiplies against (1 + sum of each axis' deltas; startCharge
// additive). Mirrors socketBuffs/trait conventions so it stacks cleanly.
export function techBuffs(chosen) {
  const out = { scoreMult: 1, coinMult: 1, powerMult: 1, feverMult: 1, startCharge: 0 };
  for (const id of chosen || []) {
    const node = techNode(id);
    if (!node) continue;
    const m = node.mods || {};
    if (m.scoreMult) out.scoreMult += m.scoreMult;
    if (m.coinMult) out.coinMult += m.coinMult;
    if (m.powerMult) out.powerMult += m.powerMult;
    if (m.feverMult) out.feverMult += m.feverMult;
    if (m.startCharge) out.startCharge += m.startCharge;
  }
  return out;
}

// Aggregate the ACTIVE-ability mods from a pet's chosen nodes (cooldown/count
// are summed; strength multiplies). Neutral when nothing is chosen.
export function techActiveMods(chosen) {
  const out = { cooldownDelta: 0, countDelta: 0, strengthMult: 1 };
  for (const id of chosen || []) {
    const node = techNode(id);
    if (!node) continue;
    const m = node.mods || {};
    if (m.cooldownDelta) out.cooldownDelta += m.cooldownDelta;
    if (m.countDelta) out.countDelta += m.countDelta;
    if (m.strengthMult) out.strengthMult *= m.strengthMult;
  }
  return out;
}
