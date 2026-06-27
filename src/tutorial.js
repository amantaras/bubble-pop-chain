// Interactive, gated onboarding tutorial.
//
// Walks the player through every core feature ONE STEP AT A TIME. A "do this"
// step will NOT advance until the matching action is actually observed in the
// real running game (the game emits actions to `Tutorial.onAction`). Purely
// informational steps advance when the player taps the step's button.
//
// ⚠️ KEEP IN SYNC WITH THE GAME'S FEATURES. Whenever a feature is added,
// changed, or removed, update `TUTORIAL_STEPS` below and the matching action
// emitted from `main.js` (see `_tut(...)` call sites). This is mandated by
// AGENTS.md §"Tutorial" — the tutorial is part of the definition of done.

import { NORMAL, ICE, RAINBOW } from "./grid.js";

// Each step:
//   id      — stable identifier (used by tests; never reuse/repurpose)
//   title   — coach-card heading
//   body    — explanation text
//   advance — how the step is cleared:
//               "button"  → player taps the CTA (informational step)
//               otherwise → an ACTION TYPE that must be observed in-game:
//                           "pop" | "combo" | "undo" | "preview" | "swipe"
//                           | "blast" | "powerup" | "magnet" | "event"
//                           | "lightning" | "stone" | "bombbubble"
//                           | "multiplier" | "coinbubble" | "vine"
//   cta     — button label for "button" steps
//   hint    — short call-to-action shown for action steps
//   grant   — optional setup applied when the step is entered
//             ("power" | "fever" | "bomb" | "specials" | "magnet" | "event"
//              | "lightning" | "stone" | "bombbubble" | "multiplier"
//              | "coinbubble" | "vine" | "undo" | "paint")
export const TUTORIAL_STEPS = [
  {
    id: "welcome",
    title: "Welcome to Bubblit!",
    body: "Let's learn the ropes. This tutorial waits for you to try each move before moving on.",
    advance: "button",
    cta: "Let's go",
  },
  {
    id: "tap",
    title: "Tap to Pop",
    body: "Tap a cluster of two or more touching bubbles of the same colour to pop them and score.",
    advance: "pop",
    hint: "👆 Tap a matching cluster",
  },
  {
    id: "combo",
    title: "Chain a Combo",
    body: "Pop again right away — back-to-back pops build a combo multiplier for far bigger scores.",
    advance: "combo",
    hint: "⚡ Pop two clusters quickly",
  },
  {
    id: "undo",
    title: "Undo a Move",
    body: "Made a mistake? Tap the ↶ Undo tool in your loadout to take back your last move. It spends one charge, just like your other tools. Try it now!",
    advance: "undo",
    hint: "↶ Tap the Undo tool",
    grant: "undo",
  },
  {
    id: "fever",
    title: "Fever Mode",
    body: "Keep chaining and the FEVER bar fills up. When it tops out you enter Fever — every point scores DOUBLE for a few seconds. Here's a taste!",
    advance: "button",
    cta: "🔥 Nice!",
    grant: "fever",
  },
  {
    id: "preview",
    title: "Preview & Plan",
    body: "Press and hold a cluster to preview how many points it scores, then release to pop it.",
    advance: "preview",
    hint: "✋ Press and hold a cluster",
  },
  {
    id: "swipe",
    title: "Shift a Row",
    body: "Swipe left or right across a row to slide the whole row and line up new matches.",
    advance: "swipe",
    hint: "↔️ Swipe a row left or right",
  },
  {
    id: "blast",
    title: "Charged Blast",
    body: "Great pops fill your CHARGE meter. It's full now — double-tap the shaking target on the board to blast the best area.",
    advance: "blast",
    hint: "💥 Double-tap the shaking target",
    grant: "power",
  },
  {
    id: "powerup",
    title: "Power-ups",
    body: "Tap the 💥 Bomb button up top, then tap the board to blast a 3×3 area. Buy more in the Shop.",
    advance: "powerup",
    hint: "🧨 Arm the Bomb, then tap the board",
    grant: "bomb",
  },
  {
    id: "paint",
    title: "Smart Paint",
    body: "The 🎨 Paint tool changes one bubble's colour. Tap Paint, choose a bubble, then pick one of the three suggested colours — the best swatch makes the biggest next group.",
    advance: "powerup",
    hint: "🎨 Arm Paint, tap a bubble, then pick a colour",
    grant: "paint",
  },
  {
    id: "magnet",
    title: "Magnet",
    body: "Arm the 🧲 Magnet and tap a plain bubble. A strength gauge swings back and forth — tap again on the green centre to pull that whole colour together into one giant cluster, ready to pop.",
    advance: "magnet",
    hint: "🧲 Arm it, tap a bubble, then lock on green",
    grant: "magnet",
  },
  {
    id: "events",
    title: "Gifts & Problems",
    body: "While you are actively playing the board, a 🎁 gift or a ⚠️ problem can drift down the screen. Tap a gift to grab coins or a free power-up — and tap a problem to defuse it before it lands, or it can scramble the board, drain moves, freeze bubbles, sprout vines, or scatter your clusters.",
    advance: "event",
    hint: "🎁 Tap the falling token",
    grant: "event",
  },
  {
    id: "specials",
    title: "Special Bubbles",
    body: "🌈 Rainbow matches any colour and bridges clusters. 🧊 Ice takes two hits — it cracks first, then clears.",
    advance: "button",
    cta: "Got it",
    grant: "specials",
  },
  {
    id: "lightning",
    title: "Lightning Bubbles",
    body: "⚡ Lightning bubbles are charged! Pop a cluster that includes one and it discharges along its whole row AND column — a board-clearing jolt. Pop the lightning cluster now!",
    advance: "lightning",
    hint: "⚡ Pop the cluster with the lightning bubble",
    grant: "lightning",
  },
  {
    id: "stone",
    title: "Stone Bubbles",
    body: "🪨 Stone bubbles are locked — you can't tap them directly. Pop a cluster right next to one and the shockwave shatters it. Pop the cluster beside the stone now!",
    advance: "stone",
    hint: "🪨 Pop the cluster next to the stone",
    grant: "stone",
  },
  {
    id: "bombbubble",
    title: "Bomb Bubbles",
    body: "💣 Bomb bubbles are explosive! Pop a cluster that includes one and it detonates a 3×3 blast, clearing everything around it. Pop the bomb cluster now!",
    advance: "bombbubble",
    hint: "💣 Pop the cluster with the bomb bubble",
    grant: "bombbubble",
  },
  {
    id: "multiplier",
    title: "Multiplier Bubbles",
    body: "✨ Gold multiplier bubbles are pure treasure! Pop a cluster that includes one and that pop's score is multiplied — stack a few for a huge payout. Pop the gold cluster now!",
    advance: "multiplier",
    hint: "✨ Pop the cluster with the gold bubble",
    grant: "multiplier",
  },
  {
    id: "coinbubble",
    title: "Coin Bubbles",
    body: "🪙 Coin bubbles are treasure! Pop a cluster that includes one and it drops bonus coins straight into your wallet. Pop the coin cluster now!",
    advance: "coinbubble",
    hint: "🪙 Pop the cluster with the coin bubble",
    grant: "coinbubble",
  },
  {
    id: "vine",
    title: "Vine Bubbles",
    body: "🌿 Watch out — vine bubbles creep! On a real level each one spreads to a neighbouring bubble every move until you stop it. Pop the vine cluster now to clear the threat!",
    advance: "vine",
    hint: "🌿 Pop the cluster with the vine bubble",
    grant: "vine",
  },
  {
    id: "pets",
    title: "Pet Companions",
    body: "Pets unlock later in the campaign so the early levels stay focused. When the Pets menu appears, Sparky joins first; then crates, active abilities, party supports, gems and technology unlock step by step. Pets can boost your score, coins, charge or Fever, and some physically help on the board. WIN more pets free from crates, milestones and falling gifts; the rarest companions live in the Pet Store.",
    advance: "button",
    cta: "Cool!",
  },
  {
    id: "done",
    title: "You're ready!",
    body: "That's everything — pop chains, plan combos, and clear the board. Finish a level to see your recap: score, moves, best chain, tools used, stars, objectives, and the coins you earned. Have fun!",
    advance: "button",
    cta: "Start playing",
  },
];

// Build a fully-controlled onboarding board: dependable 2×2 colour blocks so
// poppable clusters always exist no matter what the player does.
export function buildTutorialBoard(cols, rows, colorCount = 4) {
  const colors = [];
  const types = [];
  for (let c = 0; c < cols; c++) {
    colors[c] = [];
    types[c] = [];
    for (let r = 0; r < rows; r++) {
      colors[c][r] = (Math.floor(c / 2) + Math.floor(r / 2)) % colorCount;
      types[c][r] = NORMAL;
    }
  }
  return { colors, types };
}

// Place one Rainbow and one Ice bubble in the middle of the board so they are
// always visible while the Special Bubbles step is explained.
export function decorateSpecials(types) {
  const cols = types.length;
  if (!cols) return types;
  const rows = types[0].length;
  const midR = Math.floor(rows / 2);
  const midC = Math.floor(cols / 2);
  types[midC][midR] = RAINBOW;
  types[Math.min(cols - 1, midC + 1)][midR] = ICE;
  return types;
}

export class Tutorial {
  // deps: { game, ui, onFinish }
  constructor(deps) {
    this.game = deps.game;
    this.ui = deps.ui;
    this.onFinish = deps.onFinish || (() => {});
    this.index = 0;
    this.active = false;
  }

  get step() {
    return TUTORIAL_STEPS[this.index] || null;
  }

  get stepId() {
    return this.step ? this.step.id : null;
  }

  start() {
    this.index = 0;
    this.active = true;
    this._enter();
  }

  _enter() {
    const step = this.step;
    if (!step) return this.finish();
    if (step.grant && this.game && this.game.tutorialGrant) {
      this.game.tutorialGrant(step.grant);
    }
    this.ui.showTutorialStep({
      index: this.index,
      total: TUTORIAL_STEPS.length,
      step,
    });
    // The coach card's height varies per step; re-layout the board so it always
    // stays above the card and no bubbles hide behind it.
    if (this.game && this.game.relayoutBoard) this.game.relayoutBoard();
  }

  // Player tapped the CTA on an informational ("button") step.
  next() {
    if (!this.active || !this.step) return;
    if (this.step.advance === "button") this._advance();
  }

  // An action was observed in the real game ("pop", "combo", "swipe", ...).
  onAction(type) {
    if (!this.active || !this.step) return;
    if (this.step.advance === type) this._advance();
  }

  _advance() {
    this.index += 1;
    if (this.index >= TUTORIAL_STEPS.length) return this.finish();
    this._enter();
  }

  skip() {
    this.finish();
  }

  finish() {
    if (!this.active) return;
    this.active = false;
    this.ui.hideTutorial();
    this.onFinish();
  }
}
