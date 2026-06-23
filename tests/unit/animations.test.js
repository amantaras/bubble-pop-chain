import { describe, it, expect } from "vitest";
import {
  PetAnim,
  FloatingText,
  ScreenShake,
  AlienShip,
  BubbleFinale,
  BUBBLE_FINALE_VARIANTS,
} from "../../src/animations.js";
import { Board } from "../../src/grid.js";

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
    closePath: rec("closePath"),
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
    set lineJoin(v) {},
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

  it("draw() does not throw across every phase for pet abilities", () => {
    for (const kind of ["gather", "cleanse", "pick", "bomber"]) {
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

  it("pick fires onHit once per target, in sequence, across the act phase", () => {
    const pa = new PetAnim();
    const hits = [];
    pa.play({
      kind: "pick",
      icon: "🦅",
      targets: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }],
      onHit: (i) => hits.push(i),
    });
    const it = pa.items[0];
    expect(it.kind).toBe("pick");
    // The act phase scales with the number of targets so each peck is visible.
    expect(it.act).toBeGreaterThan(0.6);
    // Tick the whole animation through in small steps.
    for (let t = 0; t < 80; t++) pa.update(0.05);
    expect(hits).toEqual([0, 1, 2]); // each target pecked exactly once, in order
    expect(pa.busy).toBe(false);
  });

  it("bomber fires onHit once per visible bomb drop, then onDone", () => {
    const pa = new PetAnim();
    const hits = [];
    let done = false;
    pa.play({
      kind: "bomber",
      targets: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }],
      onHit: (i) => hits.push(i),
      onDone: () => {
        done = true;
      },
    });
    const it = pa.items[0];
    expect(it.kind).toBe("bomber");
    expect(it.act).toBeGreaterThan(0.6);
    for (let t = 0; t < 80; t++) pa.update(0.05);
    expect(hits).toEqual([0, 1, 2, 3]);
    expect(done).toBe(true);
    expect(pa.busy).toBe(false);
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

  it("clear() drops every in-flight animation", () => {
    const pa = new PetAnim();
    pa.play({ kind: "gather", anchor: { x: 0, y: 0 }, targets: [{ x: 1, y: 1 }] });
    expect(pa.busy).toBe(true);
    pa.clear();
    expect(pa.busy).toBe(false);
    expect(pa.items).toHaveLength(0);
  });

  it("clear() does NOT fire a pick's onDone (stale-callback guard)", () => {
    // Regression: clearing on quit/end must not run the stale onDone, which
    // would re-enter Game.afterMove on a null/new session and crash.
    const pa = new PetAnim();
    let doneFired = false;
    pa.play({
      kind: "pick",
      anchor: { x: 0, y: 0 },
      targets: [{ x: 1, y: 1 }],
      onHit: () => {},
      onDone: () => {
        doneFired = true;
      },
    });
    expect(pa.busy).toBe(true);
    pa.clear();
    // Tick well past the animation's lifetime — the callback must never fire.
    pa.update(10);
    expect(doneFired).toBe(false);
    expect(pa.busy).toBe(false);
  });

  it("clear() is a no-op when nothing is playing", () => {
    const pa = new PetAnim();
    expect(() => pa.clear()).not.toThrow();
    expect(pa.busy).toBe(false);
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

  it("ScreenShake defaults to full motionScale", () => {
    expect(new ScreenShake().motionScale).toBe(1);
  });

  it("ScreenShake with motionScale 0 ignores all added trauma (reduced motion)", () => {
    const s = new ScreenShake();
    s.motionScale = 0;
    s.add(1);
    expect(s.trauma).toBe(0);
    s.add(0.5);
    expect(s.trauma).toBe(0);
  });

  it("ScreenShake scales added trauma by motionScale", () => {
    const s = new ScreenShake();
    s.motionScale = 0.5;
    s.add(0.4);
    expect(s.trauma).toBeCloseTo(0.2, 5);
  });
});

// A laid-out board with a known bubble in column 2 (and an empty column 1).
function shipBoard() {
  const b = new Board(4, 5, 3, 1);
  b.layout(400, 700, 0, 0);
  // Deterministic logic grid: only column 2 holds a single bottom bubble.
  b.cols = 4;
  b.rows = 5;
  b.grid = [
    [-1, -1, -1, -1, -1],
    [-1, -1, -1, -1, -1],
    [-1, -1, -1, -1, 0], // column 2, bottom row
    [-1, -1, -1, -1, -1],
  ];
  return b;
}

describe("AlienShip — premium Nova gunship", () => {
  const L1 = { fireInterval: 1.5, shots: 1, nuke: false, nukeInterval: 0, moveSpeed: 95 };
  const L5 = { fireInterval: 0.66, shots: 3, nuke: true, nukeInterval: 7, moveSpeed: 155 };

  it("starts inactive and is only armed by start()", () => {
    const ship = new AlienShip();
    expect(ship.active).toBe(false);
    ship.update(0.1, shipBoard(), {}); // no-op while inactive
    expect(ship.bullets.length).toBe(0);
    ship.start(L1, shipBoard());
    expect(ship.active).toBe(true);
  });

  it("parks at the bottom-centre of the board", () => {
    const b = shipBoard();
    const ship = new AlienShip();
    ship.start(L1, b);
    expect(ship.x).toBeCloseTo(b.originX + b.boardW / 2, 3);
    expect(ship.y).toBeGreaterThan(b.originY + b.boardH);
  });

  it("patrols and bounces off the side walls", () => {
    const b = shipBoard();
    const ship = new AlienShip();
    ship.start(L1, b);
    // Park near the right wall and drive right: it must clamp and flip to left.
    ship.x = b.originX + b.boardW;
    ship.dir = 1;
    ship.update(0.05, b, {});
    expect(ship.dir).toBe(-1);
    // Over many steps it always stays within the board bounds.
    for (let i = 0; i < 200; i++) ship.update(0.05, b, {});
    expect(ship.x).toBeLessThanOrEqual(b.originX + b.boardW);
    expect(ship.x).toBeGreaterThanOrEqual(b.originX);
  });

  it("fires on its cadence and a bullet destroys the column's bottom bubble", () => {
    const b = shipBoard();
    const ship = new AlienShip();
    ship.start(L1, b);
    // Park the ship over column 2 so its volley targets the lone bubble.
    ship.x = b.originX + 2 * b.cell + b.cell / 2;
    ship.dir = 0; // freeze horizontal drift for a deterministic shot
    const hits = [];
    const hooks = { hitColumn: (c) => hits.push(c), nuke: () => {} };
    // Advance past the fire interval, then let the bolt travel to the target.
    let fired = false;
    for (let i = 0; i < 200 && !hits.length; i++) {
      ship.update(0.05, b, hooks);
      if (ship.bullets.length) fired = true;
    }
    expect(fired).toBe(true);
    expect(hits).toContain(2);
  });

  it("never fires bullets outside the board's columns", () => {
    const b = shipBoard();
    const ship = new AlienShip();
    ship.start(L5, b); // 3 parallel cannons
    ship.x = b.originX + b.cell / 2; // far-left column 0
    ship.dir = 0;
    for (let i = 0; i < 60; i++) ship.update(0.05, b, { hitColumn() {}, nuke() {} });
    for (const bl of ship.bullets) {
      expect(bl.tc).toBeGreaterThanOrEqual(0);
      expect(bl.tc).toBeLessThan(b.cols);
    }
  });

  it("only fires nukes at a level that has them unlocked", () => {
    const b = shipBoard();
    const lowNukes = [];
    const low = new AlienShip();
    low.start(L1, b);
    low.dir = 0;
    for (let i = 0; i < 400; i++) low.update(0.05, b, { hitColumn() {}, nuke: () => lowNukes.push(1) });
    expect(lowNukes.length).toBe(0);

    const hiNukes = [];
    const hi = new AlienShip();
    hi.start(L5, b);
    hi.dir = 0;
    for (let i = 0; i < 400; i++) hi.update(0.05, b, { hitColumn() {}, nuke: () => hiNukes.push(1) });
    expect(hiNukes.length).toBeGreaterThan(0);
  });

  it("stop() clears bullets and deactivates", () => {
    const b = shipBoard();
    const ship = new AlienShip();
    ship.start(L5, b);
    ship.dir = 0;
    for (let i = 0; i < 20; i++) ship.update(0.05, b, { hitColumn() {}, nuke() {} });
    ship.stop();
    expect(ship.active).toBe(false);
    expect(ship.bullets.length).toBe(0);
  });

  it("draw() is a no-op when inactive and draws when active", () => {
    const ctx = shipMockCtx();
    const ship = new AlienShip();
    ship.draw(ctx);
    expect(ctx.calls.length).toBe(0);
    ship.start({ ...L5 }, shipBoard());
    ship.draw(ctx);
    expect(ctx.calls.length).toBeGreaterThan(0);
  });
});

// Extended context stub that also supports ellipse + shadow props used by the
// gunship's draw routine.
function shipMockCtx() {
  const calls = [];
  const rec = (name) => (...args) => calls.push([name, args]);
  return {
    calls,
    save: rec("save"),
    restore: rec("restore"),
    beginPath: rec("beginPath"),
    moveTo: rec("moveTo"),
    lineTo: rec("lineTo"),
    arc: rec("arc"),
    ellipse: rec("ellipse"),
    stroke: rec("stroke"),
    fill: rec("fill"),
    set fillStyle(v) {},
    set strokeStyle(v) {},
    set lineWidth(v) {},
    set globalAlpha(v) {},
    set shadowColor(v) {},
    set shadowBlur(v) {},
  };
}

// Full context stub for the last-bubble finale (gradients, composite op, etc.).
function finaleMockCtx() {
  const calls = [];
  const rec = (name) => (...args) => calls.push([name, args]);
  return {
    calls,
    save: rec("save"),
    restore: rec("restore"),
    translate: rec("translate"),
    beginPath: rec("beginPath"),
    moveTo: rec("moveTo"),
    lineTo: rec("lineTo"),
    arc: rec("arc"),
    closePath: rec("closePath"),
    stroke: rec("stroke"),
    fill: rec("fill"),
    createRadialGradient: () => ({ addColorStop() {} }),
    set fillStyle(v) {},
    set strokeStyle(v) {},
    set lineWidth(v) {},
    set lineCap(v) {},
    set globalAlpha(v) {},
    set globalCompositeOperation(v) {},
  };
}

describe("BubbleFinale — last-bubble glow + explode", () => {
  const opts = (over = {}) => ({
    x: 50,
    y: 50,
    radius: 18,
    color: "#ff5577",
    variant: 0,
    ...over,
  });

  it("starts inactive and becomes active once played", () => {
    const f = new BubbleFinale();
    expect(f.active).toBe(false);
    f.play(opts());
    expect(f.active).toBe(true);
  });

  it("clamps the variant into 0..VARIANTS-1", () => {
    const f = new BubbleFinale();
    f.play(opts({ variant: 7 }));
    expect(f.item.variant).toBe(7 % BUBBLE_FINALE_VARIANTS);
    f.play(opts({ variant: -1 }));
    expect(f.item.variant).toBeGreaterThanOrEqual(0);
    expect(f.item.variant).toBeLessThan(BUBBLE_FINALE_VARIANTS);
  });

  it("fires onExplode exactly once, at the glow→blast boundary", () => {
    const f = new BubbleFinale();
    let explodes = 0;
    let seenVariant = null;
    f.play(opts({ variant: 2, onExplode: (v) => { explodes++; seenVariant = v; } }));
    f.update(0.3); // still charging
    expect(explodes).toBe(0);
    f.update(0.5); // crosses the 0.7s glow boundary
    expect(explodes).toBe(1);
    expect(seenVariant).toBe(2);
    f.update(0.1); // already exploded — must not fire again
    expect(explodes).toBe(1);
  });

  it("fires onDone once the full finale completes, then goes inactive", () => {
    const f = new BubbleFinale();
    let done = 0;
    f.play(opts({ onDone: () => done++ }));
    f.update(0.7); // explode boundary
    f.update(0.65); // not quite finished
    expect(done).toBe(0);
    expect(f.active).toBe(true);
    f.update(0.1); // crosses glow+blast total
    expect(done).toBe(1);
    expect(f.active).toBe(false);
  });

  it("cancel() clears an in-flight finale", () => {
    const f = new BubbleFinale();
    f.play(opts());
    f.cancel();
    expect(f.active).toBe(false);
  });

  it("draw() is a no-op when inactive and draws in both phases", () => {
    const f = new BubbleFinale();
    const ctx = finaleMockCtx();
    f.draw(ctx, 0);
    expect(ctx.calls.length).toBe(0);
    // Glow phase draws.
    f.play(opts());
    f.update(0.2);
    f.draw(ctx, 100);
    expect(ctx.calls.length).toBeGreaterThan(0);
    // Blast phase draws for every variant.
    for (let v = 0; v < BUBBLE_FINALE_VARIANTS; v++) {
      const c = finaleMockCtx();
      const g = new BubbleFinale();
      g.play(opts({ variant: v }));
      g.update(0.75); // into the blast
      g.draw(c, 0);
      expect(c.calls.length).toBeGreaterThan(0);
    }
  });
});
