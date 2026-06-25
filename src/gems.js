// Gems & sockets — a deterministic, player-driven customization layer on top of
// each pet's fixed ability + random trait. Pure & dependency-free (this module
// must NOT import pets.js; pets.js imports THIS) so every rule is unit-testable.
//
// Model:
//   • A pet unlocks SOCKETS as it levels up (socketsForLevel: 0 → 1 → 2).
//   • GEMS are collectible items earned from crates, falling events, or crafted
//     with Pet Dust. Each gem is a TYPE (which buff axis it boosts) at a TIER
//     (chipped/polished/brilliant — a scaling multiplier on the base value).
//   • Slotting a gem into a socket folds its buff onto the pet: passive gems
//     (ruby/citrine/sapphire/amber/diamond) raise score/coin/charge/fever; the
//     emerald is an ABILITY gem that speeds up an active pet's cooldown.
//
// A gem instance is identified by a compact key "type:tier" (e.g. "ruby:brilliant").
// The player's loose gems live in a storage inventory map keyed by that string;
// a pet's sockets are an array of gem keys (or null for an empty slot).

// Max sockets any pet can have (unlocked by level — see socketsForLevel).
export const MAX_SOCKETS = 2;

// Gem tiers: a quality ladder. `mult` scales the gem type's base value, so a
// brilliant ruby is 3× a chipped one. Ordered weakest → strongest.
export const GEM_TIERS = [
  { id: "chipped", label: "Chipped", mult: 1, icon: "▫️" },
  { id: "polished", label: "Polished", mult: 2, icon: "🔸" },
  { id: "brilliant", label: "Brilliant", mult: 3, icon: "🔶" },
];

// Gem catalog. Each gem boosts one axis:
//   passive buffs — scoreMult / coinMult / powerMult / feverMult (multiplier
//     deltas, e.g. ruby chipped = +0.04 score) and `allMult` (diamond: a small
//     bonus to ALL FOUR passive axes at once).
//   active ability — cooldownDelta (emerald: − moves between an active pet's
//     board actions; only matters for active pets).
// `per` is the base per-tier amount; the gem's effect = per × tier.mult.
export const GEM_CATALOG = [
  {
    type: "ruby", name: "Ruby", icon: "🔴", color: "#ff4d6d",
    buff: { key: "scoreMult", per: 0.04 },
    desc: "Boosts points scored while this pet leads.",
  },
  {
    type: "citrine", name: "Citrine", icon: "🟡", color: "#ffd23f",
    buff: { key: "coinMult", per: 0.05 },
    desc: "Boosts coins earned while this pet leads.",
  },
  {
    type: "sapphire", name: "Sapphire", icon: "🔵", color: "#4d8bff",
    buff: { key: "powerMult", per: 0.06 },
    desc: "Fills the charge meter faster.",
  },
  {
    type: "amber", name: "Amber", icon: "🟠", color: "#ff9f1c",
    buff: { key: "feverMult", per: 0.06 },
    desc: "Fills the Fever meter faster.",
  },
  {
    type: "emerald", name: "Emerald", icon: "🟢", color: "#2ec27e",
    buff: { key: "cooldownDelta", per: -1 },
    desc: "Active ability charges sooner (active pets only).",
  },
  {
    type: "diamond", name: "Diamond", icon: "💎", color: "#bde0fe",
    buff: { key: "allMult", per: 0.02 },
    desc: "A little of everything: score, coins, charge & Fever.",
  },
];

// How many sockets a pet has unlocked at the given level (0 at L1, 1 at L2–3,
// 2 at L4+). Pure and clamped so unknown levels resolve sanely.
export function socketsForLevel(level) {
  const lvl = Math.floor(level || 0);
  if (lvl >= 4) return 2;
  if (lvl >= 2) return 1;
  return 0;
}

// Power ladder: a stronger gem TIER requires a higher pet level to socket, so a
// fresh low-level pet can only wear weak (chipped) gems and must grow before it
// can hold the strongest (brilliant) ones. This mirrors socketsForLevel — the
// first socket (Lv.2) accepts chipped, the second (Lv.4) accepts polished, and
// Lv.5 unlocks brilliant within the broader Lv.12 pet progression. Keyed by tier id.
export const GEM_TIER_MIN_LEVEL = { chipped: 2, polished: 4, brilliant: 5 };

// The index of a tier in the weakest→strongest ladder (0 = chipped).
export function gemTierIndex(tier) {
  const id = getGemTier(tier).id;
  return GEM_TIERS.findIndex((t) => t.id === id);
}

// The minimum pet level required to socket a gem of the given tier.
export function levelForGemTier(tier) {
  const id = getGemTier(tier).id;
  return GEM_TIER_MIN_LEVEL[id] || 1;
}

// The highest tier INDEX a pet of the given level may socket (-1 if it has no
// sockets at all yet). Pure and clamped.
export function maxGemTierForLevel(level) {
  const lvl = Math.floor(level || 0);
  if (socketsForLevel(lvl) <= 0) return -1;
  let idx = -1;
  for (let i = 0; i < GEM_TIERS.length; i++) {
    if (lvl >= levelForGemTier(GEM_TIERS[i].id)) idx = i;
  }
  return idx;
}

// Whether a specific gem key may be socketed onto a pet at the given level
// (its tier must be unlocked by that level). Unknown keys are rejected.
export function canSocketGemAtLevel(key, level) {
  const g = parseGemKey(key);
  if (!g) return false;
  return gemTierIndex(g.tier) <= maxGemTierForLevel(level);
}

// Resolve a gem type id → its catalog definition (or null if unknown).
export function getGemDef(type) {
  return GEM_CATALOG.find((g) => g.type === type) || null;
}

// Resolve a tier id → its definition (falling back to the lowest tier).
export function getGemTier(id) {
  return GEM_TIERS.find((t) => t.id === id) || GEM_TIERS[0];
}

// Compose / parse the compact "type:tier" gem key.
export function gemKey(type, tier) {
  return `${type}:${tier}`;
}
export function parseGemKey(key) {
  if (typeof key !== "string" || key.indexOf(":") < 0) return null;
  const [type, tier] = key.split(":");
  const def = getGemDef(type);
  if (!def) return null;
  return { type, tier: getGemTier(tier).id, def };
}

// A short human label / icon for a gem key, e.g. "Brilliant Ruby".
export function gemLabel(key) {
  const g = parseGemKey(key);
  if (!g) return "";
  return `${getGemTier(g.tier).label} ${g.def.name}`;
}
export function gemIcon(key) {
  const g = parseGemKey(key);
  return g ? g.def.icon : "";
}

// The effective magnitude of a gem key's buff (base per × tier multiplier).
export function gemValue(key) {
  const g = parseGemKey(key);
  if (!g) return 0;
  return g.def.buff.per * getGemTier(g.tier).mult;
}

// A short, player-facing description of the exact buff a gem grants once it's
// socketed — e.g. "+12% Score", "+6% all stats", "−3 ability cooldown" — so the
// player can weigh the trade-off before committing dust to embue it.
const GEM_BUFF_NAMES = {
  scoreMult: "Score",
  coinMult: "Coins",
  powerMult: "Charge",
  feverMult: "Fever",
  allMult: "all stats",
  cooldownDelta: "ability cooldown",
};
export function gemBuffLabel(key) {
  const g = parseGemKey(key);
  if (!g) return "";
  const k = g.def.buff.key;
  const name = GEM_BUFF_NAMES[k] || k;
  const val = gemValue(key);
  if (k === "cooldownDelta") {
    // val is negative (e.g. -3) — shortens the active pet's cooldown.
    return `${val} move ${name}`;
  }
  return `+${Math.round(val * 100)}% ${name}`;
}

// Aggregate the PASSIVE buff multipliers contributed by an array of socketed
// gem keys (nulls/empties ignored). Returns a buff object the game multiplies:
// { scoreMult, coinMult, powerMult, feverMult, startCharge }. Diamond's
// `allMult` adds to every passive axis; emerald (cooldown) contributes nothing
// here (it's an active-ability gem handled by socketActiveMods).
export function socketBuffs(sockets) {
  const out = { scoreMult: 1, coinMult: 1, powerMult: 1, feverMult: 1, startCharge: 0 };
  for (const key of sockets || []) {
    const g = parseGemKey(key);
    if (!g) continue;
    const val = g.def.buff.per * getGemTier(g.tier).mult;
    const k = g.def.buff.key;
    if (k === "allMult") {
      out.scoreMult += val;
      out.coinMult += val;
      out.powerMult += val;
      out.feverMult += val;
    } else if (k === "scoreMult" || k === "coinMult" || k === "powerMult" || k === "feverMult") {
      out[k] += val;
    }
  }
  return out;
}

// Aggregate the ACTIVE-ability modifiers from socketed gems. Only the emerald
// (cooldownDelta) currently applies; returned as deltas the game folds into an
// active pet's resolved stats. { cooldownDelta, countDelta, strengthMult }.
export function socketActiveMods(sockets) {
  const out = { cooldownDelta: 0, countDelta: 0, strengthMult: 1 };
  for (const key of sockets || []) {
    const g = parseGemKey(key);
    if (!g) continue;
    const k = g.def.buff.key;
    const val = g.def.buff.per * getGemTier(g.tier).mult;
    if (k === "cooldownDelta") out.cooldownDelta += Math.round(val);
  }
  return out;
}

// Dust cost to craft a gem of the given tier (escalates with quality).
export const GEM_DUST_COST = { chipped: 40, polished: 120, brilliant: 300 };
export function gemDustCost(tier) {
  return GEM_DUST_COST[getGemTier(tier).id] != null
    ? GEM_DUST_COST[getGemTier(tier).id]
    : GEM_DUST_COST.chipped;
}

// Dust cost to EMBUE (socket) a gem into a pet — a separate cost from crafting,
// representing the magical ritual of binding the gem. Stronger tiers cost more.
export const SOCKET_DUST_COST = { chipped: 20, polished: 60, brilliant: 150 };
export function socketDustCost(tier) {
  return SOCKET_DUST_COST[getGemTier(tier).id] != null
    ? SOCKET_DUST_COST[getGemTier(tier).id]
    : SOCKET_DUST_COST.chipped;
}

// Removing a socketed gem SHATTERS it: the gem is destroyed (never returned to
// the inventory) and the player recovers only a fraction of the embue cost as
// dust — always LESS than what was paid, so socketing is a meaningful choice.
export const UNSOCKET_REFUND_RATIO = 0.4;
export function unsocketDustRefund(tier) {
  return Math.floor(socketDustCost(tier) * UNSOCKET_REFUND_RATIO);
}

// Gem FUSION: combine N identical gems of one tier into a single gem of the
// next tier up (e.g. 3 chipped rubies → 1 polished ruby). A pure, dust-free way
// to turn a pile of weak duplicates into something useful. The top tier
// (brilliant) cannot be fused further.
export const FUSE_COUNT = 3;

// The next tier id up the ladder from `tier`, or null if it's already the top.
export function nextGemTier(tier) {
  const idx = gemTierIndex(tier);
  if (idx < 0 || idx >= GEM_TIERS.length - 1) return null;
  return GEM_TIERS[idx + 1].id;
}

// The tier id directly BELOW `tier` on the ladder, or null if it's already the
// bottom (chipped). Used by the smart forge: making a higher tier prefers to
// FUSE FUSE_COUNT of the tier below before falling back to spending dust.
export function prevGemTier(tier) {
  const idx = gemTierIndex(tier);
  if (idx <= 0) return null;
  return GEM_TIERS[idx - 1].id;
}

// Whether a gem tier can be fused (has a higher tier to fuse into).
export function canFuseTier(tier) {
  return nextGemTier(tier) != null;
}

// The gem key produced by fusing `key` (one tier up, same type), or null if the
// key is unknown or already top-tier.
export function fusedGemKey(key) {
  const g = parseGemKey(key);
  if (!g) return null;
  const up = nextGemTier(g.tier);
  return up ? gemKey(g.type, up) : null;
}

// Plan the maximum dust-free fusion pass for a loose gem inventory. It walks
// each gem type from weakest to strongest, so newly-created polished gems can
// immediately roll into brilliant gems when there are enough of them. Unknown
// keys are preserved untouched in the returned inventory.
export function autoFuseInventory(gems = {}) {
  const next = {};
  for (const [key, count] of Object.entries(gems || {})) {
    const n = Math.floor(count || 0);
    if (n > 0) next[key] = n;
  }
  const upgrades = [];
  for (const def of GEM_CATALOG) {
    for (let i = 0; i < GEM_TIERS.length - 1; i++) {
      const from = gemKey(def.type, GEM_TIERS[i].id);
      const to = gemKey(def.type, GEM_TIERS[i + 1].id);
      const count = Math.floor((next[from] || 0) / FUSE_COUNT);
      if (count <= 0) continue;
      const spent = count * FUSE_COUNT;
      next[from] -= spent;
      if (next[from] <= 0) delete next[from];
      next[to] = (next[to] || 0) + count;
      upgrades.push({ from, to, count });
    }
  }
  return {
    gems: next,
    upgrades,
    made: upgrades.reduce((sum, u) => sum + u.count, 0),
    spent: upgrades.reduce((sum, u) => sum + u.count * FUSE_COUNT, 0),
  };
}

// Roll a random gem (as a "type:tier" key). `rng` returns [0,1). Lower tiers are
// far more common; `opts.tierBias` (0..1, default 0) nudges toward better tiers
// (used by richer sources like the Legendary crate / boss events).
export const GEM_TIER_WEIGHTS = { chipped: 70, polished: 25, brilliant: 5 };
export function rollGem(rng, opts = {}) {
  const r = typeof rng === "function" ? rng : Math.random;
  const type = GEM_CATALOG[Math.floor(r() * GEM_CATALOG.length) % GEM_CATALOG.length].type;
  const bias = Math.max(0, Math.min(1, opts.tierBias || 0));
  // Build a (possibly biased) weight table over tiers.
  const weights = GEM_TIERS.map((t, i) => {
    const base = GEM_TIER_WEIGHTS[t.id] || 1;
    // Bias shifts weight from the lowest tier toward higher tiers.
    return base * (1 + bias * i * 1.5);
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = r() * total;
  let tier = GEM_TIERS[0].id;
  for (let i = 0; i < GEM_TIERS.length; i++) {
    if (roll < weights[i]) {
      tier = GEM_TIERS[i].id;
      break;
    }
    roll -= weights[i];
  }
  return gemKey(type, tier);
}
