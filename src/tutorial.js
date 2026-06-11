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
//                           "pop" | "combo" | "preview" | "swipe" | "blast"
//                           | "powerup"
//   cta     — button label for "button" steps
//   hint    — short call-to-action shown for action steps
//   grant   — optional setup applied when the step is entered
//             ("power" | "bomb" | "specials")
export const TUTORIAL_STEPS = [
  {
    id: "welcome",
    title: "Welcome to Bubble Pop Chain",
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
    body: "Great pops fill your CHARGE meter. It's full now — double-tap anywhere to unleash an area-clearing Blast.",
    advance: "blast",
    hint: "💥 Double-tap to blast",
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
    id: "specials",
    title: "Special Bubbles",
    body: "🌈 Rainbow matches any colour and bridges clusters. 🧊 Ice takes two hits — it cracks first, then clears.",
    advance: "button",
    cta: "Got it",
    grant: "specials",
  },
  {
    id: "done",
    title: "You're ready!",
    body: "That's everything — pop chains, plan combos, and clear the board. Have fun!",
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
