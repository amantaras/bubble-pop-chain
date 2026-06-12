// Pet companions — collectible support buddies the player equips for passive
// buffs. Pure & deterministic so every rule is unit-testable.
//
// Design notes (intentionally FAIR / not pay-to-win):
//   • Every gameplay buff is reachable for free. The strongest score pet
//     (draco, legendary) drops from crates; premium pets (aurora/gizmo) are
//     side-grades focused on coins / convenience, not raw score dominance.
//   • Pets level up from XP earned by clearing levels (and bonus XP from
//     duplicate crate pulls), so duplicates are never wasted.
//   • Crate rolls are seeded (see `rollCrate`) for deterministic testing.
//
// ⚠️ Player-facing feature — keep the tutorial in sync (AGENTS.md §11).

export const MAX_PET_LEVEL = 5;
// XP granted to the equipped pet each time a level is cleared.
export const PET_XP_PER_LEVEL = 12;
// Bonus XP when a crate rolls a pet you already own (so dupes aren't wasted).
export const DUP_XP = 30;
// Coin cost to buy one crate from the Pets screen.
export const CRATE_COST = 250;

// A standard coin crate can VERY rarely surprise you with a premium pet — the
// only free way to win one (otherwise they're bought in the Pet Store). Kept
// well under 1% so premiums stay aspirational / mostly paid.
export const PREMIUM_DROP_CHANCE = 0.008; // ~0.8%

// The premium "Legendary Crate": bought with real money, it has boosted odds —
// it always yields a legendary and often a premium pet.
export const LEGENDARY_CRATE = {
  product: "crate_legendary",
  price: "$3.99",
  premiumChance: 0.4, // chance the pull is a premium pet (else a free legendary)
};

export const RARITIES = ["common", "rare", "epic", "legendary"];

// Drop weights for a standard (coin-bought / earned) crate. Premium pets are
// gated behind PREMIUM_DROP_CHANCE (rolled separately in `rollCrate`).
export const RARITY_WEIGHTS = {
  common: 60,
  rare: 28,
  epic: 10,
  legendary: 2,
};

// Each pet helps in one of two ways:
//
//  • PASSIVE buff — a multiplier folded into a game system every move:
//      powerMult   — multiplies Charge-meter gain (popAt / powerGain)
//      feverMult   — multiplies Fever-gauge gain (feverGain)
//      scoreMult   — multiplies points scored
//      coinMult    — multiplies coins earned per level
//      startCharge — starts each level with this fraction of the Charge meter
//    declared as `ability: { key, per, label }` (value = `per` × pet level).
//
//  • ACTIVE board action — the pet physically helps on the board every few
//    moves (a cooldown that shortens as the pet levels up):
//      gather  — pulls a whole colour's scattered bubbles together into one
//                connected blob, ready to pop ("bring colours closer")
//      cleanse — destroys the lone, isolated bubbles that are hardest to match
//    declared as `active: { type, baseCooldown, minCooldown, baseCount,
//    countPer, label }`.
//
// Active board helpers are intentionally FREE/earnable (Rover, Whiskers) and
// premium pets stay passive side-grades, so the game is never pay-to-win.
export const PET_CATALOG = [
  {
    id: "sparky", name: "Sparky", icon: "⚡", rarity: "common", premium: false,
    desc: "An energetic spark that charges your blast meter faster.",
    ability: { key: "powerMult", per: 0.08, label: "Charge fills faster" },
  },
  {
    id: "clover", name: "Clover", icon: "🍀", rarity: "common", premium: false,
    desc: "A lucky sprite that sniffs out extra coins.",
    ability: { key: "coinMult", per: 0.05, label: "More coins per level" },
  },
  {
    id: "rover", name: "Rover", icon: "🐶", rarity: "rare", premium: false,
    desc: "A loyal pup that fetches a whole colour together for you.",
    active: {
      type: "gather", baseCooldown: 6, minCooldown: 3,
      label: "Pulls a colour together every few moves",
    },
  },
  {
    id: "whiskers", name: "Whiskers", icon: "🐱", rarity: "rare", premium: false,
    desc: "A sharp-eyed cat that pounces on lone, hard-to-match bubbles.",
    active: {
      type: "cleanse", baseCooldown: 5, minCooldown: 3, baseCount: 1, countPer: 1,
      label: "Clears isolated bubbles every few moves",
    },
  },
  {
    id: "blaze", name: "Blaze", icon: "🔥", rarity: "epic", premium: false,
    desc: "A fiery friend that whips your Fever gauge into shape.",
    ability: { key: "feverMult", per: 0.08, label: "Fever fills faster" },
  },
  {
    id: "draco", name: "Draco", icon: "🐉", rarity: "legendary", premium: false,
    desc: "A rare dragon hatchling — the mightiest score booster you can win.",
    ability: { key: "scoreMult", per: 0.05, label: "Big score boost" },
  },
  {
    id: "aurora", name: "Aurora", icon: "🌈", rarity: "legendary", premium: true,
    price: "$2.99", product: "pet_aurora",
    desc: "A shimmering premium spirit that showers you with coins.",
    ability: { key: "coinMult", per: 0.1, label: "Huge coin boost" },
  },
  {
    id: "gizmo", name: "Gizmo", icon: "🤖", rarity: "legendary", premium: true,
    price: "$2.99", product: "pet_gizmo",
    desc: "A premium bot that boots up every level fully charged.",
    ability: { key: "startCharge", per: 0.1, label: "Start charged up" },
  },
];

// Cosmetic tints applicable to any owned pet. Stored per-pet; applied in the UI
// as a CSS hue-rotate on the pet icon. "default" is free and always owned.
export const COSMETICS = [
  { id: "default", name: "Classic", hue: 0, price: 0 },
  { id: "sunset", name: "Sunset", hue: 30, price: 150 },
  { id: "ocean", name: "Ocean", hue: 200, price: 150 },
  { id: "candy", name: "Candy", hue: 310, price: 200 },
];

export function getPet(id) {
  return PET_CATALOG.find((p) => p.id === id) || null;
}

export function getCosmetic(id) {
  return COSMETICS.find((c) => c.id === id) || COSMETICS[0];
}

// Cumulative XP needed to REACH a given level. Level 1 starts at 0.
//   1:0  2:50  3:150  4:300  5:500
export function xpForLevel(level) {
  const l = Math.max(1, Math.min(MAX_PET_LEVEL, Math.floor(level)));
  return ((l - 1) * (l - 1) + (l - 1)) * 25;
}

// The level a pet is at given its total XP (capped at MAX_PET_LEVEL).
export function levelForXp(xp) {
  let lvl = 1;
  for (let l = 1; l <= MAX_PET_LEVEL; l++) {
    if ((xp || 0) >= xpForLevel(l)) lvl = l;
  }
  return lvl;
}

// XP remaining until the next level, and progress 0..1 toward it. At max level
// returns { toNext: 0, progress: 1, max: true }.
export function levelProgress(xp) {
  const x = xp || 0;
  const lvl = levelForXp(x);
  if (lvl >= MAX_PET_LEVEL) return { level: lvl, toNext: 0, progress: 1, max: true };
  const cur = xpForLevel(lvl);
  const next = xpForLevel(lvl + 1);
  return {
    level: lvl,
    toNext: next - x,
    progress: (x - cur) / (next - cur),
    max: false,
  };
}

// The raw ability value a passive pet contributes at a given level. Active
// pets have no passive multiplier and return 0.
export function abilityValue(pet, level) {
  if (!pet || !pet.ability) return 0;
  const lvl = Math.max(1, Math.min(MAX_PET_LEVEL, Math.floor(level)));
  return pet.ability.per * lvl;
}

// Neutral buff set (no pet equipped, or an active-only pet).
export function neutralBuffs() {
  return { powerMult: 1, feverMult: 1, scoreMult: 1, coinMult: 1, startCharge: 0 };
}

// The passive buffs an equipped pet provides at the given level, as a flat
// object the game can multiply against (or add, for startCharge). Active-only
// pets return the neutral set.
export function petBuffs(petId, level) {
  const base = neutralBuffs();
  const pet = getPet(petId);
  if (!pet || !pet.ability) return base;
  const v = abilityValue(pet, level);
  const key = pet.ability.key;
  if (key === "startCharge") base.startCharge = Math.min(1, v);
  else base[key] = 1 + v;
  return base;
}

// The active board action an equipped pet performs, or null for passive pets.
// `cooldown` is the number of moves between actions (shortens as the pet levels
// up); `count` is how many bubbles a cleanse clears; `strength` (0..1) is how
// strongly a gather pulls a colour together. Both scale with level.
export function petActive(petId, level) {
  const pet = getPet(petId);
  if (!pet || !pet.active) return null;
  const lvl = Math.max(1, Math.min(MAX_PET_LEVEL, Math.floor(level)));
  const a = pet.active;
  return {
    type: a.type,
    cooldown: Math.max(a.minCooldown, a.baseCooldown - (lvl - 1)),
    count: (a.baseCount || 0) + (lvl - 1) * (a.countPer || 0),
    strength: Math.min(1, 0.45 + lvl * 0.12),
    label: a.label,
  };
}

// Non-premium pets of a rarity (the only ones a standard crate normally drops).
export function petsOfRarity(rarity) {
  return PET_CATALOG.filter((p) => p.rarity === rarity && !p.premium);
}

// All premium (purchase-focused) pets.
export function premiumPets() {
  return PET_CATALOG.filter((p) => p.premium);
}

// Roll a rarity using RARITY_WEIGHTS. `rng` is a function returning [0,1).
export function crateRarity(rng) {
  const total = RARITIES.reduce((s, r) => s + RARITY_WEIGHTS[r], 0);
  let roll = rng() * total;
  for (const r of RARITIES) {
    if (roll < RARITY_WEIGHTS[r]) return r;
    roll -= RARITY_WEIGHTS[r];
  }
  return "common";
}

// Open a standard crate: returns { petId, rarity, premium }. Seeded via `rng`.
// A small `premiumChance` (default PREMIUM_DROP_CHANCE, <1%) can surprise the
// player with a premium pet; otherwise a non-premium pet drops by rarity
// weight, stepping down the ladder if a rolled rarity has no obtainable pet.
export function rollCrate(rng, opts = {}) {
  const premiumChance =
    opts.premiumChance == null ? PREMIUM_DROP_CHANCE : opts.premiumChance;
  if (premiumChance > 0 && rng() < premiumChance) {
    const prem = premiumPets();
    if (prem.length) {
      const pick = prem[Math.floor(rng() * prem.length)] || prem[0];
      return { petId: pick.id, rarity: pick.rarity, premium: true };
    }
  }
  let rarity = crateRarity(rng);
  let idx = RARITIES.indexOf(rarity);
  let pool = petsOfRarity(rarity);
  while (pool.length === 0 && idx > 0) {
    idx -= 1;
    rarity = RARITIES[idx];
    pool = petsOfRarity(rarity);
  }
  if (pool.length === 0) pool = PET_CATALOG.filter((p) => !p.premium);
  const pick = pool[Math.floor(rng() * pool.length)] || pool[0];
  return { petId: pick.id, rarity: pick.rarity, premium: false };
}

// Open the premium Legendary Crate (bought with real money). Boosted odds: a
// high chance of a premium pet, otherwise a guaranteed free legendary (falling
// back to epic, then any non-premium pet, if the catalog lacks one).
export function rollLegendaryCrate(rng, opts = {}) {
  const premiumChance =
    opts.premiumChance == null ? LEGENDARY_CRATE.premiumChance : opts.premiumChance;
  if (premiumChance > 0 && rng() < premiumChance) {
    const prem = premiumPets();
    if (prem.length) {
      const pick = prem[Math.floor(rng() * prem.length)] || prem[0];
      return { petId: pick.id, rarity: pick.rarity, premium: true };
    }
  }
  let pool = petsOfRarity("legendary");
  if (pool.length === 0) pool = petsOfRarity("epic");
  if (pool.length === 0) pool = PET_CATALOG.filter((p) => !p.premium);
  const pick = pool[Math.floor(rng() * pool.length)] || pool[0];
  return { petId: pick.id, rarity: pick.rarity, premium: false };
}
