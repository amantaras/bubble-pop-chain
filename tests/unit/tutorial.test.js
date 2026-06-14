import { describe, it, expect, vi } from "vitest";
import {
  TUTORIAL_STEPS,
  buildTutorialBoard,
  decorateSpecials,
  Tutorial,
} from "../../src/tutorial.js";
import { NORMAL, ICE, RAINBOW } from "../../src/grid.js";

describe("tutorial step definitions", () => {
  it("has a stable, ordered set of steps with unique ids", () => {
    expect(TUTORIAL_STEPS.length).toBeGreaterThanOrEqual(7);
    const ids = TUTORIAL_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
    expect(TUTORIAL_STEPS[0].id).toBe("welcome");
    expect(TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1].advance).toBe("button");
  });

  it("covers every core feature exactly once", () => {
    const actions = TUTORIAL_STEPS.map((s) => s.advance);
    for (const a of ["pop", "combo", "undo", "preview", "swipe", "blast", "powerup", "magnet", "event", "lightning"]) {
      expect(actions).toContain(a);
    }
  });

  it("action steps have a hint and button steps have a CTA", () => {
    for (const step of TUTORIAL_STEPS) {
      if (step.advance === "button") expect(step.cta).toBeTruthy();
      else expect(step.hint).toBeTruthy();
    }
  });

  it("includes a Fever step that grants the fever demo", () => {
    const fever = TUTORIAL_STEPS.find((s) => s.id === "fever");
    expect(fever).toBeTruthy();
    expect(fever.advance).toBe("button");
    expect(fever.grant).toBe("fever");
  });

  it("includes a gated undo step that grants an undoable move", () => {
    const undo = TUTORIAL_STEPS.find((s) => s.id === "undo");
    expect(undo).toBeTruthy();
    expect(undo.advance).toBe("undo");
    expect(undo.grant).toBe("undo");
    expect(undo.hint).toBeTruthy();
    // It sits right after the combo step so a real move exists to take back.
    const idx = TUTORIAL_STEPS.indexOf(undo);
    expect(TUTORIAL_STEPS[idx - 1].id).toBe("combo");
  });

  it("includes a gated lightning step that grants a lightning board", () => {
    const bolt = TUTORIAL_STEPS.find((s) => s.id === "lightning");
    expect(bolt).toBeTruthy();
    expect(bolt.advance).toBe("lightning");
    expect(bolt.grant).toBe("lightning");
  });

  it("includes an informational pets step before the finish", () => {
    const pets = TUTORIAL_STEPS.find((s) => s.id === "pets");
    expect(pets).toBeTruthy();
    expect(pets.advance).toBe("button");
    const idx = TUTORIAL_STEPS.indexOf(pets);
    expect(idx).toBe(TUTORIAL_STEPS.length - 2); // sits right before "done"
  });
});

describe("tutorial board generation", () => {
  it("fills a board with valid colours and guaranteed clusters", () => {
    const { colors, types } = buildTutorialBoard(7, 9, 4);
    expect(colors.length).toBe(7);
    expect(colors[0].length).toBe(9);
    let hasPair = false;
    for (let c = 0; c < 7; c++)
      for (let r = 0; r < 9; r++) {
        expect(colors[c][r]).toBeGreaterThanOrEqual(0);
        expect(colors[c][r]).toBeLessThan(4);
        expect(types[c][r]).toBe(NORMAL);
        if (r + 1 < 9 && colors[c][r] === colors[c][r + 1]) hasPair = true;
      }
    expect(hasPair).toBe(true);
  });

  it("decorates the board with a visible Rainbow and Ice bubble", () => {
    const { types } = buildTutorialBoard(7, 9, 4);
    decorateSpecials(types);
    let rainbow = 0;
    let ice = 0;
    for (let c = 0; c < 7; c++)
      for (let r = 0; r < 9; r++) {
        if (types[c][r] === RAINBOW) rainbow++;
        if (types[c][r] === ICE) ice++;
      }
    expect(rainbow).toBeGreaterThanOrEqual(1);
    expect(ice).toBeGreaterThanOrEqual(1);
  });
});

describe("Tutorial controller gating", () => {
  function makeTutorial() {
    const ui = { showTutorialStep: vi.fn(), hideTutorial: vi.fn() };
    const game = { tutorialGrant: vi.fn() };
    const onFinish = vi.fn();
    const tut = new Tutorial({ game, ui, onFinish });
    return { tut, ui, game, onFinish };
  }

  it("starts at the first step and renders it", () => {
    const { tut, ui } = makeTutorial();
    tut.start();
    expect(tut.active).toBe(true);
    expect(tut.stepId).toBe("welcome");
    expect(ui.showTutorialStep).toHaveBeenCalledTimes(1);
  });

  it("advances informational steps only on next()", () => {
    const { tut } = makeTutorial();
    tut.start();
    // A game action must NOT advance the welcome (button) step.
    tut.onAction("pop");
    expect(tut.stepId).toBe("welcome");
    tut.next();
    expect(tut.stepId).toBe("tap");
  });

  it("advances action steps only when the matching action is observed", () => {
    const { tut } = makeTutorial();
    tut.start();
    tut.next(); // -> tap (advance: "pop")
    expect(tut.stepId).toBe("tap");
    // Wrong action and a button press are both ignored.
    tut.onAction("swipe");
    tut.next();
    expect(tut.stepId).toBe("tap");
    // The correct action advances.
    tut.onAction("pop");
    expect(tut.stepId).toBe("combo");
  });

  it("applies a step's grant when it is entered", () => {
    const { tut, game } = makeTutorial();
    tut.start();
    // Walk to the blast step, which grants a full power meter. The undo step
    // (gated on "undo") and the Fever step (button-advance) sit between combo
    // and preview, granting "undo" and "fever" respectively.
    tut.next(); // welcome -> tap
    tut.onAction("pop"); // tap -> combo
    tut.onAction("combo"); // combo -> undo
    expect(tut.stepId).toBe("undo");
    expect(game.tutorialGrant).toHaveBeenCalledWith("undo");
    tut.onAction("undo"); // undo -> fever
    expect(tut.stepId).toBe("fever");
    expect(game.tutorialGrant).toHaveBeenCalledWith("fever");
    tut.next(); // fever -> preview
    tut.onAction("preview"); // preview -> swipe
    tut.onAction("swipe"); // swipe -> blast
    expect(tut.stepId).toBe("blast");
    expect(game.tutorialGrant).toHaveBeenCalledWith("power");
  });

  it("finishes after the last step and notifies the host", () => {
    const { tut, ui, onFinish } = makeTutorial();
    tut.start();
    // Drive through every step to the end.
    for (const step of TUTORIAL_STEPS) {
      if (step.advance === "button") tut.next();
      else tut.onAction(step.advance);
    }
    expect(tut.active).toBe(false);
    expect(ui.hideTutorial).toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("skip() ends the tutorial immediately", () => {
    const { tut, ui, onFinish } = makeTutorial();
    tut.start();
    tut.skip();
    expect(tut.active).toBe(false);
    expect(ui.hideTutorial).toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
