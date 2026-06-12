import { describe, it, expect } from "vitest";
import { PetAnim, FloatingText, ScreenShake } from "../../src/animations.js";

// A minimal 2D-context stub that records calls and supports the canvas API
// the animators touch (gradients included).
function mockCtx() {
  const calls = [];
  const rec = (name) => (...args) => calls.push([name, args]);
  return {
    calls,
    save: rec("save"),
    restore: rec("restore"),
    translate: rec("translate"),
    rotate: rec("rotate"),
    scale: rec("scale"),
    beginPath: rec("beginPath"),
    moveTo: rec("moveTo"),
    lineTo: rec("lineTo"),
    arc: rec("arc"),
    stroke: rec("stroke"),
    fill: rec("fill"),
    fillText: rec("fillText"),
    strokeText: rec("strokeText"),
    createRadialGradient: () => ({ addColorStop() {} }),
    set fillStyle(v) {},
    set strokeStyle(v) {},
    set lineWidth(v) {},
    set lineCap(v) {},
    set font(v) {},
    set textAlign(v) {},
    set textBaseline(v) {},
    set globalAlpha(v) {},
  };
}

describe("PetAnim — pet ability animations", () => {
  it("starts idle (not busy)", () => {
    const pa = new PetAnim();
    expect(pa.busy).toBe(false);
  });

  it("play() queues a gather animation and marks busy", () => {
    const pa = new PetAnim();
    pa.play({
      kind: "gather",
      icon: "🐶",
      anchor: { x: 100, y: 100 },
      targets: [{ x: 50, y: 50 }, { x: 150, y: 80 }],
    });
    expect(pa.busy).toBe(true);
    expect(pa.items[0].kind).toBe("gather");
    expect(pa.items[0].icon).toBe("🐶");
  });

  it("defaults an unknown kind to gather and uses a fallback icon", () => {
    const pa = new PetAnim();
    pa.play({ targets: [{ x: 10, y: 10 }] });
    expect(pa.items[0].kind).toBe("gather");
    expect(pa.items[0].icon).toBe("🐾");
  });

  it("derives the focal point from targets when no anchor is given", () => {
    const pa = new PetAnim();
    pa.play({ kind: "cleanse", targets: [{ x: 0, y: 0 }, { x: 100, y: 200 }] });
    expect(pa.items[0].cx).toBe(50);
    expect(pa.items[0].cy).toBe(100);
  });

  it("update() advances life and removes the item once finished", () => {
    const pa = new PetAnim();
    pa.play({ kind: "cleanse", anchor: { x: 0, y: 0 }, targets: [{ x: 0, y: 0 }] });
    const it = pa.items[0];
    const total = it.enter + it.act + it.exit;
    // Tick just short of completion: still busy.
    pa.update(total - 0.05);
    expect(pa.busy).toBe(true);
    // Finish it off.
    pa.update(0.1);
    expect(pa.busy).toBe(false);
  });

  it("draw() does not throw across every phase for both abilities", () => {
    for (const kind of ["gather", "cleanse"]) {
      const pa = new PetAnim();
      pa.play({ kind, anchor: { x: 120, y: 120 }, targets: [{ x: 60, y: 60 }] });
      const ctx = mockCtx();
      // Enter, act and exit phases.
      for (const step of [0.1, 0.5, 0.9, 1.3]) {
        pa.update(step - (pa.items[0] ? pa.items[0].life : 0));
        expect(() => pa.draw(ctx)).not.toThrow();
      }
    }
  });

  it("can run multiple animations at once", () => {
    const pa = new PetAnim();
    pa.play({ kind: "gather", targets: [{ x: 1, y: 1 }] });
    pa.play({ kind: "cleanse", targets: [{ x: 2, y: 2 }] });
    expect(pa.items.length).toBe(2);
  });

  // A tiny board stub for live tracking: grid[c][r] holds a colour or -1, and
  // targetPixel maps a cell to a deterministic pixel.
  function mockBoard(grid) {
    return {
      grid,
      targetPixel: (c, r) => ({ x: c * 100, y: r * 100 }),
    };
  }

  it("a live gather drops leashes for bubbles the player has popped", () => {
    const grid = [[0], [0], [0]];
    const board = mockBoard(grid);
    const pa = new PetAnim();
    pa.play({
      kind: "gather",
      anchor: { x: 0, y: 0 },
      targets: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }],
      board,
      anchorCell: { c: 0, r: 0 },
      cells: [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }],
    });
    const it = pa.items[0];
    expect(it.board).toBe(board);
    // Player pops the middle bubble mid-animation.
    grid[1][0] = -1;
    pa.draw(mockCtx());
    expect(it.targets).toHaveLength(2);
    expect(it.targets).toContainEqual({ x: 0, y: 0 });
    expect(it.targets).toContainEqual({ x: 200, y: 0 });
  });

  it("a live gather re-homes its focal point when the anchor is cleared", () => {
    const grid = [[0], [0], [0]];
    const board = mockBoard(grid);
    const pa = new PetAnim();
    pa.play({
      kind: "gather",
      anchor: { x: 0, y: 0 },
      targets: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }],
      board,
      anchorCell: { c: 0, r: 0 },
      cells: [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }],
    });
    const it = pa.items[0];
    // The anchor bubble itself is popped — focal point must move to the
    // centroid of the survivors, never stay on the empty cell.
    grid[0][0] = -1;
    pa.draw(mockCtx());
    expect(it.targets).toHaveLength(2);
    expect(it.cx).toBe(150); // centroid of x=100 and x=200
    expect(it.cy).toBe(0);
  });

  it("does NOT live-track destructive abilities (cleanse keeps its snapshot)", () => {
    const board = mockBoard([[0]]);
    const pa = new PetAnim();
    pa.play({
      kind: "cleanse",
      anchor: { x: 0, y: 0 },
      targets: [{ x: 5, y: 5 }],
      board,
      cells: [{ c: 0, r: 0 }],
    });
    // Cleanse pops its cells immediately, so the frozen pixels are correct.
    expect(pa.items[0].board).toBe(null);
  });
});

describe("existing animators still parse/behave", () => {
  it("FloatingText spawns and expires", () => {
    const ft = new FloatingText();
    ft.spawn(0, 0, "+10");
    expect(ft.items.length).toBe(1);
    ft.update(1.0);
    expect(ft.items.length).toBe(0);
  });

  it("ScreenShake trauma decays", () => {
    const s = new ScreenShake();
    s.add(1);
    s.update(1);
    expect(s.trauma).toBeLessThan(1);
  });
});
