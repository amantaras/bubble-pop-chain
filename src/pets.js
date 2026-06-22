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

import { socketBuffs, socketActiveMods } from "./gems.js";
import { techBuffs, techActiveMods } from "./tech.js";

export const MAX_PET_LEVEL = 12;
// XP granted to the equipped pet each time a level is cleared.
export const PET_XP_PER_LEVEL = 12;
// Bonus XP when a crate rolls a pet you already own (so dupes aren't wasted).
export const DUP_XP = 30;
// Coin cost to buy one crate from the Pets screen.
export const CRATE_COST = 250;

export const PET_FEATURE_INFO = {
  pets: {
    icon: "⚡",
    name: "Pets",
    desc: "A companion now joins your run and adds a small passive boost.",
    lesson: "Sparky is equipped for you. Open Pets from the menu after this level to see your companion and its level progress.",
  },
  crates: {
    icon: "🧰",
    name: "Pet Crates",
    desc: "Crates let you collect more companions, including pets with active board abilities.",
    lesson: "You get two starter crates now. Open them in Pets to discover companions; duplicates become XP and Pet Dust.",
  },
  abilities: {
    icon: "🐾",
    name: "Pet Abilities",
    desc: "Some pets do more than boost stats: they can help the board every few moves.",
    lesson: "Active pets charge automatically while you play. You also get starter Pet Dust to craft or embue your first upgrades.",
  },
  party: {
    icon: "＋",
    name: "Pet Party",
    desc: "Extra pets can support your lead companion with a smaller share of their passive buffs.",
    lesson: "Add owned pets to support slots from Pets. A Dust bonus helps you build toward a chosen companion or gem setup.",
  },
  gems: {
    icon: "💎",
    name: "Gem Sockets",
    desc: "Pets can now hold gems for focused stat boosts.",
    lesson: "Craft gems with Pet Dust, then tap an unlocked socket on a pet to embue a gem into it.",
  },
  tech: {
    icon: "🧬",
    name: "Pet Technology",
    desc: "Leveled pets now earn permanent upgrade choices.",
    lesson: "When a pet levels up, open Pets and pick one tech node for each available tier. Choices are permanent.",
  },
};

export const PET_FEATURE_UNLOCKS = [
  { feature: "pets", level: 12 },
  { feature: "crates", level: 14 },
  { feature: "abilities", level: 16 },
  { feature: "party", level: 18 },
  { feature: "gems", level: 22 },
  { feature: "tech", level: 26 },
].map((u) => ({ ...u, ...PET_FEATURE_INFO[u.feature] }));

export const PET_FEATURE_GRANTS = {
  crates: { crates: 2 },
  abilities: { dust: 60 },
  party: { dust: 60 },
};

const PET_UNLOCK_BY_FEATURE = Object.fromEntries(PET_FEATURE_UNLOCKS.map((u) => [u.feature, u]));

export function petFeatureUnlockLevel(feature) {
  return PET_UNLOCK_BY_FEATURE[feature] ? PET_UNLOCK_BY_FEATURE[feature].level : Infinity;
}

export function isPetFeatureUnlocked(feature, maxUnlockedLevel = 1) {
  return (maxUnlockedLevel || 1) >= petFeatureUnlockLevel(feature);
}

export function petFeaturesUnlockedBetween(from, to) {
  return PET_FEATURE_UNLOCKS.filter((u) => u.level > from && u.level <= to);
}

export function nextPetFeatureUnlock(maxUnlockedLevel = 1) {
  return PET_FEATURE_UNLOCKS.find((u) => u.level > (maxUnlockedLevel || 1)) || null;
}

// ---- Pity timer (anti-bad-luck guarantee) ----------------------------------
// Gacha fairness: a standard crate guarantees an EPIC by this many opens
// without one, and a LEGENDARY by this many. The running counters live in
// storage; `pityRarityFloor` (what the next roll must at least yield) and
// `nextPity` (the counters after a roll) are pure so the whole rule is testable.
export const PITY_EPIC = 10;
export const PITY_LEGENDARY = 30;

// ---- Pet Dust (duplicate currency) -----------------------------------------
// Opening a crate that rolls a pet you ALREADY own converts the duplicate into
// Dust (on top of the existing bonus XP). Dust is then spent on the GEM system
// (crafting and embuing gems into pet sockets) — see gems.js. The table is
// keyed by pet rarity.
export const DUST_PER_DUP = { common: 5, rare: 12, epic: 30, legendary: 80 };

// Dust granted for a duplicate of the given rarity.
export function dustValue(rarity) {
  return DUST_PER_DUP[rarity] != null ? DUST_PER_DUP[rarity] : DUST_PER_DUP.common;
}

export function dustCost(rarity) {
  return dustValue(rarity) * 10;
}

// The minimum rarity the NEXT standard crate must yield, given the pity
// counters BEFORE that roll. Returns "legendary", "epic", or null (no floor).
// The legendary guarantee takes precedence over the epic one.
export function pityRarityFloor(pity) {
  const p = pity || {};
  if ((p.sinceLegendary || 0) + 1 >= PITY_LEGENDARY) return "legendary";
  if ((p.sinceEpic || 0) + 1 >= PITY_EPIC) return "epic";
  return null;
}

// The pity counters AFTER a crate yields `rarity`. Hitting epic resets the epic
// counter; hitting legendary resets both (a legendary also satisfies the epic
// guarantee); otherwise both increment by one.
export function nextPity(pity, rarity) {
  const p = pity || {};
  let sinceEpic = (p.sinceEpic || 0) + 1;
  let sinceLegendary = (p.sinceLegendary || 0) + 1;
  if (rarity === "legendary") {
    sinceEpic = 0;
    sinceLegendary = 0;
  } else if (rarity === "epic") {
    sinceEpic = 0;
  }
  return { sinceEpic, sinceLegendary };
}


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
//    declared as `ability: { key, per, label }` and scaled by `abilityValue`
//    across the longer 12-level curve.
//
//  • ACTIVE board action — the pet physically helps on the board every few
//    moves (a cooldown that shortens as the pet levels up):
//      gather   — pulls a whole colour's scattered bubbles together into one
//                 connected blob, ready to pop ("bring colours closer")
//      cleanse  — destroys the lone, isolated bubbles that are hardest to match
//                 (all of them at once)
//      pick     — hunts the MOST isolated bubbles (walled in by edges, gaps or
//                 other colours) and picks them off one by one
//      diagonal — blasts the longest diagonal streak of one colour off the
//                 board (a line the orthogonal flood-fill can never clear)
//      quake    — (🌍 Quake) a board-wide tremor that resettles every bubble so
//                 identical colours land together in big matchable groups
//      cyclone  — (🌪️ Cyclone) sorts each column by colour into tall, ready-to-
//                 pop vertical runs
//      magma    — (🌋 Magma) erupts under the fullest lane(s) and clears whole
//                 vertical columns of bubbles
//      tidal    — (🌊 Tidal) a flood that wipes every bubble of the board's
//                 current dominant colour
//      paint    — recolours nearby bubbles to match a difficult anchor,
//                 creating a fresh cluster without clearing anything directly
//      archer   — arms a player-aimed arrow skill-shot; the player drags to
//                 set direction/strength, then the shot clears a grid ray
//      shooter  — (PREMIUM "Nova") an alien gunship that patrols the bottom of
//                 the board in real time and auto-blasts the lowest bubbles.
//                 Its firepower grows with the pet's level: faster cannons →
//                 parallel cannons → board-clearing nukes (see `shooterStats`).
//    declared as `active: { type, baseCooldown, minCooldown, baseCount,
//    countPer, label }`.
//
// Active board helpers are intentionally FREE/earnable (Rover, Whiskers, Comet,
// Talon) so the game is never pay-to-win on the *free* track. The one deliberate
// exception is the premium **Nova** gunship: a paid, spectacle-grade active pet
// (an autonomous shooter) reserved for players who buy it — powerful, but it
// only speeds up clears the player could achieve anyway.
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
    id: "mochi", name: "Mochi", icon: "🍡", rarity: "common", premium: false,
    desc: "A sweet little charm that keeps your score streaks tasting better.",
    ability: { key: "scoreMult", per: 0.035, label: "More score per pop" },
  },
  {
    id: "sprout", name: "Sprout", icon: "🌱", rarity: "common", premium: false,
    desc: "A tiny green helper that warms up your Fever gauge over long runs.",
    ability: { key: "feverMult", per: 0.045, label: "Fever fills faster" },
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
    id: "luma", name: "Luma", icon: "🖌️", rarity: "rare", premium: false,
    desc: "A bright brush spirit that paints nearby bubbles to match a tricky anchor, setting up a new cluster for your next pop.",
    active: {
      type: "paint", baseCooldown: 6, minCooldown: 3, baseCount: 3, countPer: 0.5,
      label: "Paints nearby bubbles into a match every few moves",
    },
  },
  {
    id: "quake", name: "Quake", icon: "🌍", rarity: "rare", premium: false,
    desc: "A rumbling earth spirit whose tremor resettles the whole board, dropping matching colours together into fresh, ready-to-pop groups.",
    active: {
      type: "quake", baseCooldown: 6, minCooldown: 3,
      label: "Reshuffles the board into fresh matches every few moves",
    },
  },
  {
    id: "comet", name: "Comet", icon: "☄️", rarity: "epic", premium: false,
    desc: "A streaking comet that blasts a diagonal line of bubbles off the board — a row the flood-fill can never clear.",
    active: {
      type: "diagonal", baseCooldown: 6, minCooldown: 3,
      label: "Pops a diagonal streak every few moves",
    },
  },
  {
    id: "talon", name: "Talon", icon: "🦅", rarity: "epic", premium: false,
    desc: "A keen-eyed hawk that swoops on the most isolated bubbles and picks them off one by one.",
    active: {
      type: "pick", baseCooldown: 6, minCooldown: 3, baseCount: 2, countPer: 1,
      label: "Picks off the most isolated bubbles every few moves",
    },
  },
  {
    id: "cyclone", name: "Cyclone", icon: "🌪️", rarity: "epic", premium: false,
    desc: "A whirling tornado that sorts each column by colour, stacking matching bubbles into tall, ready-to-pop vertical runs.",
    active: {
      type: "cyclone", baseCooldown: 6, minCooldown: 3,
      label: "Sorts colours into vertical runs every few moves",
    },
  },
  {
    id: "magma", name: "Magma", icon: "🌋", rarity: "epic", premium: false,
    desc: "A molten volcano that erupts beneath the busiest lane and clears whole vertical columns of bubbles.",
    active: {
      type: "magma", baseCooldown: 7, minCooldown: 4, baseCount: 1, countPer: 0.25,
      label: "Erupts and clears a vertical lane every few moves",
    },
  },
  {
    id: "archer", name: "Archer", icon: "🏹", rarity: "epic", premium: false,
    desc: "A focused companion that readies a skill-shot arrow. Pull back, release in the green power band, and shoot the opposite way through a line of bubbles.",
    active: {
      type: "archer", baseCooldown: 7, minCooldown: 4, baseCount: 2, countPer: 0.35,
      label: "Readies a player-aimed arrow every few moves",
    },
  },
  {
    id: "amp", name: "Amp", icon: "🔋", rarity: "epic", premium: false,
    desc: "A humming battery buddy that turns every good pop into more Charge.",
    ability: { key: "powerMult", per: 0.1, label: "Charge surges faster" },
  },
  {
    id: "blaze", name: "Blaze", icon: "🔥", rarity: "epic", premium: false,
    desc: "A fiery friend that whips your Fever gauge into shape.",
    ability: { key: "feverMult", per: 0.08, label: "Fever fills faster" },
  },
  {
    id: "prism", name: "Prism", icon: "🔮", rarity: "epic", premium: false,
    desc: "A glassy focus stone that starts each level with a useful Charge spark.",
    ability: { key: "startCharge", per: 0.055, label: "Start partly charged" },
  },
  {
    id: "draco", name: "Draco", icon: "🐉", rarity: "legendary", premium: false,
    desc: "A rare dragon hatchling — the mightiest score booster you can win.",
    ability: { key: "scoreMult", per: 0.05, label: "Big score boost" },
  },
  {
    id: "midas", name: "Midas", icon: "👑", rarity: "legendary", premium: false,
    desc: "A golden patron that turns patient progression into bigger coin hauls.",
    ability: { key: "coinMult", per: 0.085, label: "Massive coin boost" },
  },
  {
    id: "tidal", name: "Tidal", icon: "🌊", rarity: "legendary", premium: false,
    desc: "A legendary tide spirit whose flood sweeps every bubble of the board's most common colour clean away in one mighty wave.",
    active: {
      type: "tidal", baseCooldown: 8, minCooldown: 5,
      label: "Floods away the most common colour every few moves",
    },
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
  {
    id: "nova", name: "Nova", icon: "🛸", rarity: "legendary", premium: true,
    storeOnly: true, price: "$4.99", product: "pet_nova",
    desc:
      "A premium alien gunship that patrols the base of the board and auto-blasts the lowest bubbles. Level it up for faster cannons, parallel fire, then board-clearing nukes.",
    active: {
      type: "shooter",
      // The shooter doesn't use the move-based cooldown system (it fires in
      // real time); these keep `petActive` well-formed for shared UI/tests.
      baseCooldown: 0, minCooldown: 0,
      label: "Patrols the bottom and blasts bubbles",
    },
  },
];

// Real-time firepower for the premium "Nova" gunship at milestone pet levels.
// `shooterStats` interpolates between these anchors across the longer 12-level
// progression, so Nova keeps gaining power without needing a bespoke stat row
// for every single level. The shooter is autonomous (driven by the game loop,
// not by moves), so its progression lives here as a pure table rather than in
// `petActive`:
//   • fireInterval — seconds between volleys (lower = faster)
//   • shots        — parallel cannons per volley (covers adjacent columns)
//   • nuke         — whether periodic area-clearing nukes are unlocked
//   • nukeInterval — seconds between nukes (0 when locked)
//   • moveSpeed    — patrol speed across the bottom (px/sec)
export const SHOOTER_LEVELS = {
  1: { fireInterval: 1.5, shots: 1, nuke: false, nukeInterval: 0, moveSpeed: 95 },
  4: { fireInterval: 1.15, shots: 1, nuke: false, nukeInterval: 0, moveSpeed: 115 },
  7: { fireInterval: 0.92, shots: 2, nuke: false, nukeInterval: 0, moveSpeed: 135 },
  10: { fireInterval: 0.76, shots: 3, nuke: false, nukeInterval: 0, moveSpeed: 150 },
  12: { fireInterval: 0.66, shots: 3, nuke: true, nukeInterval: 7, moveSpeed: 160 },
};

// The Nova gunship's stats at a given pet level (clamped to 1..MAX_PET_LEVEL).
export function shooterStats(level) {
  const lvl = Math.max(1, Math.min(MAX_PET_LEVEL, Math.floor(level || 1)));
  const anchors = Object.keys(SHOOTER_LEVELS).map(Number).sort((a, b) => a - b);
  let low = anchors[0];
  let high = anchors[anchors.length - 1];
  for (const anchor of anchors) {
    if (anchor <= lvl) low = anchor;
    if (anchor >= lvl) {
      high = anchor;
      break;
    }
  }
  const from = SHOOTER_LEVELS[low];
  const to = SHOOTER_LEVELS[high];
  const span = Math.max(1, high - low);
  const t = high === low ? 0 : (lvl - low) / span;
  const mix = (a, b) => a + (b - a) * t;
  return {
    level: lvl,
    fireInterval: Number(mix(from.fireInterval, to.fireInterval).toFixed(2)),
    shots: Math.max(from.shots, Math.floor(mix(from.shots, to.shots))),
    nuke: lvl >= 12,
    nukeInterval: lvl >= 12 ? to.nukeInterval : 0,
    moveSpeed: Math.round(mix(from.moveSpeed, to.moveSpeed)),
  };
}

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

// Cumulative XP needed to REACH a given level. Level 1 starts at 0. The curve is
// deliberately long-form: early levels arrive quickly, but the final levels ask
// for sustained play across many sessions instead of maxing a pet in a handful
// of clears.
export function xpForLevel(level) {
  const l = Math.max(1, Math.min(MAX_PET_LEVEL, Math.floor(level)));
  const n = l - 1;
  return n === 0 ? 0 : Math.round(35 * n + 18 * n * n + 2.5 * n * n * n);
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
  return pet.ability.per * (1 + (lvl - 1) * 0.42);
}

// ---- Traits (RNG personality rolled on acquisition) ------------------------
// Every pet rolls a permanent TRAIT the moment it joins the collection. A trait
// is a small, flavourful stat modifier layered on top of the pet's own
// ability/active — two of the same pet can feel different. Trait `mods`:
//   cooldownDelta  (int)   — adjusts an active pet's move cooldown (− = faster)
//   countDelta     (int)   — adjusts an active pet's bubbles-affected count
//   strengthMult   (float) — scales an active pet's pull/clear strength
//   scoreMult/coinMult/powerMult/feverMult (float) — passive multipliers that
//     apply to EVERY pet (even active-only ones), giving traits universal value.
export const TRAITS = [
  {
    id: "balanced",
    icon: "🔘",
    label: "Balanced",
    desc: "A steady all-rounder with no specialty.",
    mods: {},
  },
  {
    id: "swift",
    icon: "⚡",
    label: "Swift",
    desc: "Active ability charges one move sooner.",
    mods: { cooldownDelta: -1 },
  },
  {
    id: "mighty",
    icon: "💪",
    label: "Mighty",
    desc: "Active ability hits harder and reaches further.",
    mods: { countDelta: 1, strengthMult: 1.15 },
  },
  {
    id: "lucky",
    icon: "🍀",
    label: "Lucky",
    desc: "Earns +20% coins while equipped.",
    mods: { coinMult: 1.2 },
  },
  {
    id: "keen",
    icon: "🎯",
    label: "Keen",
    desc: "Scores +15% points while equipped.",
    mods: { scoreMult: 1.15 },
  },
  {
    id: "fiery",
    icon: "🔥",
    label: "Fiery",
    desc: "Charge & Fever meters fill faster.",
    mods: { powerMult: 1.2, feverMult: 1.15 },
  },
];

// Resolve a trait id to its definition (falling back to the neutral Balanced
// trait for unknown / missing ids — old saves had no trait field).
export function getTrait(id) {
  return TRAITS.find((t) => t.id === id) || TRAITS[0];
}

// Roll a random trait id on acquisition. `rng` is a function returning [0,1).
export function rollTrait(rng) {
  const r = typeof rng === "function" ? rng() : Math.random();
  return TRAITS[Math.floor(r * TRAITS.length) % TRAITS.length].id;
}

// Neutral buff set (no pet equipped, or an active-only pet).
export function neutralBuffs() {
  return { powerMult: 1, feverMult: 1, scoreMult: 1, coinMult: 1, startCharge: 0 };
}

// The passive buffs an equipped pet provides at the given level, as a flat
// object the game can multiply against (or add, for startCharge). A pet's own
// ability is applied first, then its TRAIT's passive mods are stacked on — so
// even active-only pets contribute buffs via a Lucky/Keen/Fiery trait. Then any
// GEMS slotted into the pet's sockets (`sockets`, an array of "type:tier" keys)
// and any chosen TECH-TREE nodes (`tech`, an array of node ids) fold on top.
export function petBuffs(petId, level, traitId, sockets, tech) {
  const base = neutralBuffs();
  const pet = getPet(petId);
  if (pet && pet.ability) {
    const v = abilityValue(pet, level);
    const key = pet.ability.key;
    if (key === "startCharge") base.startCharge = Math.min(1, v);
    else base[key] = 1 + v;
  }
  const m = getTrait(traitId).mods || {};
  if (m.scoreMult) base.scoreMult *= m.scoreMult;
  if (m.coinMult) base.coinMult *= m.coinMult;
  if (m.powerMult) base.powerMult *= m.powerMult;
  if (m.feverMult) base.feverMult *= m.feverMult;
  // Socketed gems (passive axes) stack on multiplicatively.
  const g = socketBuffs(sockets);
  base.scoreMult *= g.scoreMult;
  base.coinMult *= g.coinMult;
  base.powerMult *= g.powerMult;
  base.feverMult *= g.feverMult;
  base.startCharge = Math.min(1, base.startCharge + (g.startCharge || 0));
  // Tech-tree nodes (passive axes) stack on multiplicatively too.
  const t = techBuffs(tech);
  base.scoreMult *= t.scoreMult;
  base.coinMult *= t.coinMult;
  base.powerMult *= t.powerMult;
  base.feverMult *= t.feverMult;
  base.startCharge = Math.min(1, base.startCharge + (t.startCharge || 0));
  return base;
}

// The active board action an equipped pet performs, or null for passive pets.
// `cooldown` is the number of moves between actions (shortens as the pet levels
// up); `count` is how many bubbles a cleanse clears; `strength` (0..1) is how
// strongly a gather pulls a colour together. All scale with level, then the
// pet's TRAIT nudges them (Swift = faster cooldown, Mighty = +count/strength),
// then any socketed GEMS (e.g. an Emerald shortens the cooldown further), then
// any chosen TECH-TREE nodes (e.g. Haste/Mastery) fold on top.
export function petActive(petId, level, traitId, sockets, tech) {
  const pet = getPet(petId);
  if (!pet || !pet.active) return null;
  const lvl = Math.max(1, Math.min(MAX_PET_LEVEL, Math.floor(level)));
  const a = pet.active;
  const m = getTrait(traitId).mods || {};
  const gm = socketActiveMods(sockets);
  const tm = techActiveMods(tech);
  const progress = (lvl - 1) / Math.max(1, MAX_PET_LEVEL - 1);
  const cooldownSteps = Math.floor(progress * 4);
  const countLevel = 1 + (lvl - 1) * 0.42;
  const cooldown = Math.max(
    1,
    Math.max(a.minCooldown, a.baseCooldown - cooldownSteps) +
      (m.cooldownDelta || 0) +
      (gm.cooldownDelta || 0) +
      (tm.cooldownDelta || 0)
  );
  const count = Math.max(
    0,
    Math.round(
      (a.baseCount || 0) +
      (countLevel - 1) * (a.countPer || 0) +
      (m.countDelta || 0) +
      (gm.countDelta || 0) +
      (tm.countDelta || 0)
    )
  );
  const strength = Math.min(
    1,
    (0.45 + countLevel * 0.12) * (m.strengthMult || 1) * (gm.strengthMult || 1) * (tm.strengthMult || 1)
  );
  return {
    type: a.type,
    cooldown,
    count,
    strength,
    label: a.label,
  };
}

// ---- Party & set synergies -------------------------------------------------
// The player fields a PARTY: a LEAD pet (full ability + active board move) plus
// up to SUPPORT_SLOTS support pets that lend a FRACTION of their PASSIVE buffs.
// Supports never contribute an active board move (only the lead acts), so the
// party is a pure passive-stacking + set-bonus layer — additive and never
// changing the win/star outcome.
export const SUPPORT_SLOTS = 2;
export const SUPPORT_FRACTION = 0.35;

function rarityOf(id) {
  const p = getPet(id);
  return p ? p.rarity : null;
}
function isCoinPet(id) {
  const p = getPet(id);
  return !!(p && p.ability && p.ability.key === "coinMult");
}
function isActivePet(id) {
  const p = getPet(id);
  return !!(p && p.active);
}

// Combine a party's passive buffs. `members` is an array of
// { id, level, trait, role:"lead"|"support" }. The lead applies its full
// petBuffs; each support applies SUPPORT_FRACTION of the amount its buff
// exceeds neutral (so a 1.20 coin support adds 0.35 × 0.20 = +7%).
export function partyBuffs(members) {
  const out = neutralBuffs();
  for (const m of members || []) {
    if (!m || !m.id) continue;
    const b = petBuffs(m.id, m.level, m.trait, m.sockets, m.tech);
    const frac = m.role === "support" ? SUPPORT_FRACTION : 1;
    out.powerMult *= 1 + (b.powerMult - 1) * frac;
    out.feverMult *= 1 + (b.feverMult - 1) * frac;
    out.scoreMult *= 1 + (b.scoreMult - 1) * frac;
    out.coinMult *= 1 + (b.coinMult - 1) * frac;
    out.startCharge += (b.startCharge || 0) * frac;
  }
  out.startCharge = Math.min(1, out.startCharge);
  return out;
}

// Set-bonus synergies: composition rules that pay an extra party-wide bonus.
// Each is pure (`test(members)` over the party's pets) and additive.
export const SYNERGIES = [
  {
    id: "full_party",
    icon: "🎉",
    label: "Full Party",
    desc: "All 3 party slots filled: +8% to every buff.",
    test: (m) => m.length >= 3,
    mods: { scoreMult: 1.08, coinMult: 1.08, powerMult: 1.08, feverMult: 1.08 },
  },
  {
    id: "legendary_might",
    icon: "👑",
    label: "Legendary Might",
    desc: "Two or more legendary pets: +12% score.",
    test: (m) => m.filter((p) => rarityOf(p.id) === "legendary").length >= 2,
    mods: { scoreMult: 1.12 },
  },
  {
    id: "fortune",
    icon: "💰",
    label: "Fortune Hunters",
    desc: "Two or more coin pets: +25% coins.",
    test: (m) => m.filter((p) => isCoinPet(p.id)).length >= 2,
    mods: { coinMult: 1.25 },
  },
  {
    id: "strike_team",
    icon: "🌐",
    label: "Strike Team",
    desc: "Two or more active pets: +15% charge & Fever.",
    test: (m) => m.filter((p) => isActivePet(p.id)).length >= 2,
    mods: { powerMult: 1.15, feverMult: 1.15 },
  },
];

// The synergies whose composition test passes for this party.
export function activeSynergies(members) {
  const m = (members || []).filter((x) => x && x.id);
  return SYNERGIES.filter((s) => s.test(m));
}

// Apply a list of synergy bonuses onto a buff object (multiplicatively).
export function applySynergies(buffs, synergies) {
  const out = { ...buffs };
  for (const s of synergies || []) {
    const mods = s.mods || {};
    if (mods.scoreMult) out.scoreMult *= mods.scoreMult;
    if (mods.coinMult) out.coinMult *= mods.coinMult;
    if (mods.powerMult) out.powerMult *= mods.powerMult;
    if (mods.feverMult) out.feverMult *= mods.feverMult;
  }
  return out;
}

// Convenience: a party's full passive buffs INCLUDING matched set synergies.
export function partyTotalBuffs(members) {
  return applySynergies(partyBuffs(members), activeSynergies(members));
}


// Non-premium pets of a rarity (the only ones a standard crate normally drops).
export function petsOfRarity(rarity) {
  return PET_CATALOG.filter((p) => p.rarity === rarity && !p.premium);
}

// All premium (purchase-focused) pets — shown for sale in the Pet Store.
export function premiumPets() {
  return PET_CATALOG.filter((p) => p.premium);
}

// Premium pets that may appear as a random crate "surprise". Store-only pets
// (e.g. the Nova gunship) are excluded so they remain purchasable ONLY with
// real money in the Pet Store, never as a lucky crate drop.
export function cratePremiumPets() {
  return PET_CATALOG.filter((p) => p.premium && !p.storeOnly);
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
// `opts.floor` (a rarity from the pity system) raises a low roll up to that
// guaranteed minimum rarity.
export function rollCrate(rng, opts = {}) {
  const premiumChance =
    opts.premiumChance == null ? PREMIUM_DROP_CHANCE : opts.premiumChance;
  if (premiumChance > 0 && rng() < premiumChance) {
    const prem = cratePremiumPets();
    if (prem.length) {
      const pick = prem[Math.floor(rng() * prem.length)] || prem[0];
      return { petId: pick.id, rarity: pick.rarity, premium: true };
    }
  }
  let rarity = crateRarity(rng);
  // Pity floor: never roll below the guaranteed minimum rarity.
  if (opts.floor) {
    const fi = RARITIES.indexOf(opts.floor);
    if (fi > RARITIES.indexOf(rarity)) rarity = opts.floor;
  }
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
    const prem = cratePremiumPets();
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
