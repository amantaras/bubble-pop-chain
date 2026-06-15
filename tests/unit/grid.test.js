import { describe, it, expect } from "vitest";
import { Board, NORMAL, ICE, RAINBOW, ICE_CRACKED, LIGHTNING, STONE, BOMB, MULTIPLIER, COIN, VINE } from "../../src/grid.js";

// Helper: overwrite a board's logic grid and clear sprite coupling so we can
// assert pure grid behaviour deterministically. (settle() guards null sprites.)
function setGrid(board, grid) {
  board.cols = grid.length;
  board.rows = grid[0].length;
  board.grid = grid.map((col) => col.slice());
  board.spriteGrid = grid.map((col) => col.map(() => null));
  board.sprites = [];
}

describe("grid / Board", () => {
  it("generates a board with at least one available move", () => {
    const b = new Board(6, 8, 3, 123);
    expect(b.hasMoves()).toBe(true);
    expect(b.countRemaining()).toBe(48);
    expect(b.isCleared()).toBe(false);
  });

  it("getGroupAt flood-fills 4-connected same-colour cells", () => {
    const b = new Board(3, 3, 3, 1);
    setGrid(b, [
      [0, 0, 1],
      [0, 1, 1],
      [2, 2, 1],
    ]);
    // (0,0) colour 0 connects to (0,1) and (1,0) => 3
    expect(b.getGroupAt(0, 0).length).toBe(3);
    // the colour-1 region: (1,1),(1,2),(2,2),(0,2)... trace connectivity
    expect(b.getGroupAt(2, 2).length).toBe(4);
    // isolated single
    expect(b.getGroupAt(0, 0)).toEqual(expect.any(Array));
  });

  it("hasMoves is false when no two neighbours match", () => {
    const b = new Board(3, 2, 9, 1);
    setGrid(b, [
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
    expect(b.hasMoves()).toBe(false);
  });

  it("applies gravity so bubbles fall to the bottom", () => {
    const b = new Board(1, 4, 3, 1);
    // top-heavy column with a hole
    setGrid(b, [[0, -1, 1, -1]]);
    b.settle();
    // remaining values should be packed at the bottom, order preserved
    expect(b.grid[0]).toEqual([-1, -1, 0, 1]);
  });

  it("collapses empty columns to the left", () => {
    const b = new Board(3, 2, 3, 1);
    setGrid(b, [
      [-1, -1], // empty column
      [0, 1],
      [-1, -1], // empty column
    ]);
    b.settle();
    expect(b.grid[0]).toEqual([0, 1]);
    expect(b.grid[1].every((v) => v === -1)).toBe(true);
  });

  it("removeCells empties the targeted cells", () => {
    const b = new Board(2, 2, 3, 1);
    setGrid(b, [
      [0, 0],
      [0, 0],
    ]);
    b.removeCells([{ c: 0, r: 0 }, { c: 1, r: 1 }], { bubbles: ["#fff"] });
    expect(b.grid[0][0]).toBe(-1);
    expect(b.grid[1][1]).toBe(-1);
    expect(b.countRemaining()).toBe(2);
  });

  it("isCleared is true once everything is removed", () => {
    const b = new Board(2, 2, 3, 1);
    setGrid(b, [
      [0, 0],
      [0, 0],
    ]);
    b.removeCells(
      [
        { c: 0, r: 0 },
        { c: 0, r: 1 },
        { c: 1, r: 0 },
        { c: 1, r: 1 },
      ],
      { bubbles: ["#fff"] }
    );
    expect(b.isCleared()).toBe(true);
  });

  it("firstFilledCell finds the top-left-most bubble, or null when empty", () => {
    const b = new Board(3, 3, 3, 1);
    setGrid(b, [
      [-1, -1, -1],
      [-1, -1, 2],
      [-1, -1, -1],
    ]);
    expect(b.firstFilledCell()).toEqual({ c: 1, r: 2 });
    setGrid(b, [
      [-1, -1, -1],
      [-1, -1, -1],
      [-1, -1, -1],
    ]);
    expect(b.firstFilledCell()).toBe(null);
  });

  it("forceRemove clears a single cell regardless of type, incl. ice", () => {
    const b = new Board(2, 2, 3, 1);
    setGrid(b, [
      [0, 1],
      [2, 3],
    ]);
    b.types = [
      [NORMAL, ICE],
      [NORMAL, NORMAL],
    ];
    // Removing an ice bubble empties it outright (unlike removeCells, which
    // only cracks ice).
    b.forceRemove(0, 1);
    expect(b.grid[0][1]).toBe(-1);
    expect(b.types[0][1]).toBe(NORMAL);
    expect(b.countRemaining()).toBe(3);
    // Out-of-range / already-empty cells are a safe no-op.
    expect(b.forceRemove(9, 9)).toBe(null);
    expect(b.forceRemove(0, 1)).toBe(null);
  });

  it("bombArea returns up to a 3x3 region clipped to the board", () => {
    const b = new Board(5, 5, 3, 1);
    expect(b.bombArea(2, 2).length).toBe(9); // centre => full 3x3
    expect(b.bombArea(0, 0).length).toBe(4); // corner => clipped
  });

  it("colorCells returns every cell of a colour", () => {
    const b = new Board(2, 2, 3, 1);
    setGrid(b, [
      [0, 1],
      [0, 2],
    ]);
    expect(b.colorCells(0).length).toBe(2);
    expect(b.colorCells(2).length).toBe(1);
  });

  it("crossCells clears the full row and column through a cell (no dupes)", () => {
    const b = new Board(3, 3, 3, 1);
    setGrid(b, [
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
    ]);
    // Centre: 3 in the column + 3 in the row, sharing one cell => 5 unique.
    expect(b.crossCells(1, 1).length).toBe(5);
    // Corner: clipped to the board, still no duplicate of the shared cell.
    expect(b.crossCells(0, 0).length).toBe(5);
  });

  it("lightningStrike returns the group unchanged when it has no bolt", () => {
    const b = new Board(3, 3, 3, 1);
    setGrid(b, [
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
    ]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    const group = [
      { c: 0, r: 0 },
      { c: 0, r: 1 },
    ];
    expect(b.lightningStrike(group)).toHaveLength(2);
  });

  it("lightningStrike adds the bolt's full row + column (deduped)", () => {
    const b = new Board(3, 3, 3, 1);
    setGrid(b, [
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
    ]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[1][1] = LIGHTNING;
    expect(b.isLightning(1, 1)).toBe(true);
    // Group is just the two centre-column cells incl. the bolt at (1,1). The
    // strike expands to that cell's row + column: 5 unique cells, and the
    // group's other cell (1,0) is already counted → 5 total.
    const cells = b.lightningStrike([
      { c: 1, r: 1 },
      { c: 1, r: 0 },
    ]);
    const keys = new Set(cells.map((p) => `${p.c},${p.r}`));
    expect(keys.size).toBe(cells.length); // no dupes
    expect(cells.length).toBe(5);
  });

  it("a lightning spawn rate sprinkles lightning bubbles deterministically", () => {
    const b = new Board(8, 8, 4, 7, { rainbow: 0, ice: 0, lightning: 0.5 });
    let bolts = 0;
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++)
        if (b.types[c][r] === LIGHTNING) bolts++;
    expect(bolts).toBeGreaterThan(0);
  });

  it("bombStrike returns the group unchanged when it has no bomb", () => {
    const b = new Board(3, 3, 3, 1);
    setGrid(b, [
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
    ]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    const group = [
      { c: 0, r: 0 },
      { c: 0, r: 1 },
    ];
    expect(b.bombStrike(group)).toHaveLength(2);
  });

  it("bombStrike adds the bomb's full 3x3 area (deduped)", () => {
    const b = new Board(3, 3, 3, 1);
    setGrid(b, [
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
    ]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[1][1] = BOMB;
    expect(b.isBomb(1, 1)).toBe(true);
    // A bomb at the centre detonates the full 3x3 = all 9 cells.
    const cells = b.bombStrike([
      { c: 1, r: 1 },
      { c: 1, r: 0 },
    ]);
    const keys = new Set(cells.map((p) => `${p.c},${p.r}`));
    expect(keys.size).toBe(cells.length); // no dupes
    expect(cells.length).toBe(9);
  });

  it("a corner bomb clips its blast to the board", () => {
    const b = new Board(3, 3, 3, 1);
    setGrid(b, [
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
    ]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[0][0] = BOMB;
    const cells = b.bombStrike([
      { c: 0, r: 0 },
      { c: 0, r: 1 },
    ]);
    // Corner 3x3 clips to 4 cells.
    expect(cells.length).toBe(4);
  });

  it("a bomb spawn rate sprinkles bomb bubbles deterministically", () => {
    const b = new Board(8, 8, 4, 9, { rainbow: 0, ice: 0, bomb: 0.5 });
    let bombs = 0;
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++)
        if (b.types[c][r] === BOMB) bombs++;
    expect(bombs).toBeGreaterThan(0);
  });

  it("a multiplier spawn rate sprinkles gold bubbles deterministically", () => {
    const b = new Board(8, 8, 4, 11, { rainbow: 0, ice: 0, multiplier: 0.5 });
    let golds = 0;
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++) {
        if (b.types[c][r] === MULTIPLIER) golds++;
      }
    expect(golds).toBeGreaterThan(0);
    // isMultiplier query agrees with the raw type for a known gold cell.
    let found = null;
    for (let c = 0; c < b.cols && !found; c++)
      for (let r = 0; r < b.rows && !found; r++)
        if (b.types[c][r] === MULTIPLIER) found = { c, r };
    expect(b.isMultiplier(found.c, found.r)).toBe(true);
  });

  it("a multiplier bubble joins same-colour groups like a normal bubble", () => {
    const b = new Board(3, 1, 2, 1);
    setGrid(b, [[0], [0], [1]]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[1][0] = MULTIPLIER; // middle cell of the colour-0 pair is gold
    // The gold bubble still matches its colour-0 neighbour.
    expect(b.getGroupAt(0, 0).length).toBe(2);
    expect(b.isMultiplier(1, 0)).toBe(true);
  });

  it("a coin spawn rate sprinkles treasure bubbles deterministically", () => {
    const b = new Board(8, 8, 4, 13, { rainbow: 0, ice: 0, coin: 0.5 });
    let coins = 0;
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++)
        if (b.types[c][r] === COIN) coins++;
    expect(coins).toBeGreaterThan(0);
    let found = null;
    for (let c = 0; c < b.cols && !found; c++)
      for (let r = 0; r < b.rows && !found; r++)
        if (b.types[c][r] === COIN) found = { c, r };
    expect(b.isCoin(found.c, found.r)).toBe(true);
  });

  it("a coin bubble joins same-colour groups like a normal bubble", () => {
    const b = new Board(3, 1, 2, 1);
    setGrid(b, [[0], [0], [1]]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[1][0] = COIN; // middle cell of the colour-0 pair is a coin
    expect(b.getGroupAt(0, 0).length).toBe(2);
    expect(b.isCoin(1, 0)).toBe(true);
  });

  it("a vine spawn rate sprinkles creeping bubbles deterministically", () => {
    const b = new Board(8, 8, 4, 17, { rainbow: 0, ice: 0, vine: 0.5 });
    expect(b.vineCount()).toBeGreaterThan(0);
    let found = null;
    for (let c = 0; c < b.cols && !found; c++)
      for (let r = 0; r < b.rows && !found; r++)
        if (b.types[c][r] === VINE) found = { c, r };
    expect(b.isVine(found.c, found.r)).toBe(true);
  });

  it("a vine bubble joins same-colour groups like a normal bubble", () => {
    const b = new Board(3, 1, 2, 1);
    setGrid(b, [[0], [0], [1]]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[1][0] = VINE; // middle cell of the colour-0 pair is a vine
    expect(b.getGroupAt(0, 0).length).toBe(2);
    expect(b.isVine(1, 0)).toBe(true);
  });

  it("spreadVines creeps exactly one new vine into an adjacent ordinary cell", () => {
    const b = new Board(3, 3, 2, 1);
    b.grid = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[1][1] = VINE; // a single vine in the centre
    const before = b.vineCount();
    const sprouted = b.spreadVines();
    expect(sprouted).not.toBeNull();
    expect(b.vineCount()).toBe(before + 1); // exactly one new vine
    expect(b.isVine(sprouted.c, sprouted.r)).toBe(true);
    // The new vine is orthogonally adjacent to the original.
    const dist = Math.abs(sprouted.c - 1) + Math.abs(sprouted.r - 1);
    expect(dist).toBe(1);
  });

  it("spreadVines returns null when there is no room or no vines", () => {
    // No vines at all.
    const empty = new Board(2, 2, 2, 1);
    empty.types = empty.grid.map((col) => col.map(() => NORMAL));
    expect(empty.spreadVines()).toBeNull();
    // A vine fully surrounded by non-NORMAL bubbles cannot spread.
    const boxed = new Board(3, 3, 2, 1);
    boxed.grid = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    boxed.types = boxed.grid.map((col) => col.map(() => STONE));
    boxed.types[1][1] = VINE; // surrounded by stone (not NORMAL)
    expect(boxed.spreadVines()).toBeNull();
    expect(boxed.vineCount()).toBe(1);
  });

  it("magnetGather pulls a whole colour into one connected blob at full strength", () => {
    const b = new Board(5, 1, 2, 1);
    setGrid(b, [[0], [1], [0], [1], [0]]); // colour 0 scattered at c=0,2,4
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    const res = b.magnetGather(0, 0, 0, 1); // perfect pull
    expect(res.gathered).toBe(3); // all three colour-0 bubbles
    expect(b.getGroupAt(0, 0).length).toBe(3); // and they are now connected
    expect(b.colorCells(0).length).toBe(3); // multiset preserved
  });

  it("magnetGather pulls fewer bubbles on a weak strength", () => {
    const b = new Board(5, 1, 2, 1);
    setGrid(b, [[0], [1], [0], [1], [0]]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    const res = b.magnetGather(0, 0, 0, 0); // weakest pull
    expect(res.gathered).toBe(2);
    expect(b.colorCells(0).length).toBe(3); // still three of the colour
  });

  it("magnetGather is a no-op for a lone bubble of its colour", () => {
    const b = new Board(3, 1, 3, 1);
    setGrid(b, [[0], [1], [2]]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    expect(b.magnetGather(0, 0, 0, 1).gathered).toBe(1);
  });

  it("magnetGather self-heals when the anchor cell holds the wrong colour", () => {
    const b = new Board(5, 1, 2, 1);
    setGrid(b, [[1], [0], [0], [1], [0]]); // colour 0 at c=1,2,4
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    // Aim at c=0, which is colour 1 — a stale anchor. It must re-anchor onto a
    // real colour-0 bubble rather than gathering nothing.
    const res = b.magnetGather(0, 0, 0, 1);
    expect(res.gathered).toBe(3);
    expect(res.color).toBe(0);
    expect(b.colorCells(0).length).toBe(3); // multiset preserved
  });

  it("magnetGather self-heals when the anchor cell was emptied", () => {
    const b = new Board(4, 1, 2, 1);
    setGrid(b, [[-1], [0], [0], [0]]); // c=0 is empty
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    const res = b.magnetGather(0, 0, 0, 1);
    expect(res.gathered).toBe(3);
    expect(res.color).toBe(0);
  });

  it("magnetGather returns 0 when the target colour is gone entirely", () => {
    const b = new Board(3, 1, 3, 1);
    setGrid(b, [[1], [2], [1]]); // no colour 0 anywhere
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    expect(b.magnetGather(0, 0, 0, 1).gathered).toBe(0);
  });

  it("magnetGather physically relocates sprites — a glide, not an in-place recolour", () => {
    // A real board (with sprites) laid out deterministically: colour 0 scattered
    // so the pull must move at least one bubble across a cell.
    const b = new Board(5, 1, 2, 1);
    const layout = [[0], [1], [0], [1], [0]];
    for (let c = 0; c < 5; c++) {
      b.grid[c][0] = layout[c][0];
      b.types[c][0] = NORMAL;
      b.spriteGrid[c][0].color = layout[c][0];
      b.spriteGrid[c][0].type = NORMAL;
    }
    b.layout(300, 300, 0, 0);
    b.snapToTargets();
    expect(b.sprites.every((s) => !s.glideDur)).toBe(true);

    b.magnetGather(0, 0, 0, 1);
    // A real relocation kicks off a slow glide on the swapped bubbles…
    expect(b.sprites.some((s) => s.glideDur > 0)).toBe(true);
    // …and the colour rides along with the moving sprite (it stays coupled to
    // its cell), settling exactly on its new target once the glide completes.
    for (let i = 0; i < 120; i++) b.update(1 / 60); // ~2s, past MAGNET_GLIDE
    for (const s of b.sprites) {
      expect(s.color).toBe(b.grid[s.c][s.r]);
      const t = b.targetPixel(s.c, s.r);
      expect(Math.hypot(s.x - t.x, s.y - t.y)).toBeLessThan(1);
    }
  });

  it("diagonalRun finds the longest same-colour ↘ diagonal streak", () => {
    const b = new Board(3, 3, 2, 1);
    setGrid(b, [
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
    ]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    expect(b.diagonalRun(3)).toEqual([
      { c: 0, r: 0 },
      { c: 1, r: 1 },
      { c: 2, r: 2 },
    ]);
  });

  it("diagonalRun detects an anti-diagonal (↗) streak too", () => {
    const b = new Board(3, 3, 2, 1);
    setGrid(b, [
      [1, 1, 0],
      [1, 0, 1],
      [0, 1, 1],
    ]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    expect(b.diagonalRun(3)).toEqual([
      { c: 0, r: 2 },
      { c: 1, r: 1 },
      { c: 2, r: 0 },
    ]);
  });

  it("diagonalRun ignores streaks shorter than the minimum length", () => {
    const b = new Board(3, 3, 2, 1);
    setGrid(b, [
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
    ]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    expect(b.diagonalRun(4)).toEqual([]); // longest diagonal is only 3
  });

  it("diagonalRun skips non-NORMAL (frozen) cells that break the run", () => {
    const b = new Board(3, 3, 2, 1);
    setGrid(b, [
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
    ]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[1][1] = ICE; // break the diagonal in the middle
    expect(b.diagonalRun(3)).toEqual([]);
  });

  it("shuffle preserves the colour multiset and yields a solvable board", () => {
    const b = new Board(6, 8, 4, 999);
    const before = b.countRemaining();
    const histBefore = colourHistogram(b);
    b.shuffle();
    expect(b.countRemaining()).toBe(before);
    expect(colourHistogram(b)).toEqual(histBefore);
    expect(b.hasMoves()).toBe(true);
  });

  it("refill regenerates a full, solvable board (Time Attack)", () => {
    const b = new Board(8, 11, 5, 444);
    b.layout(400, 800, 100, 80);
    // Empty most of the board to simulate a near-deadlocked Time Attack state.
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++) b.grid[c][r] = -1;
    b._buildSprites();
    expect(b.countRemaining()).toBe(0);
    b.refill();
    // The board is full again and guaranteed to have at least one move.
    expect(b.countRemaining()).toBe(b.cols * b.rows);
    expect(b.hasMoves()).toBe(true);
    expect(b.sprites.length).toBe(b.cols * b.rows);
  });

  it("stone bubbles are locked: never part of a tapped group", () => {
    const b = new Board(3, 3, 3, 1);
    setGrid(b, [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[1][1] = STONE;
    // Tapping the stone itself yields no group → no pop.
    expect(b.getGroupAt(1, 1)).toHaveLength(0);
    expect(b.isStone(1, 1)).toBe(true);
    // A same-colour flood-fill routes around the stone, excluding it.
    const group = b.getGroupAt(0, 0);
    const keys = new Set(group.map((p) => `${p.c},${p.r}`));
    expect(keys.has("1,1")).toBe(false);
    expect(group).toHaveLength(8); // all but the stone
  });

  it("popping next to a stone shatters it (single hit, no chaining)", () => {
    const b = new Board(3, 3, 3, 1);
    setGrid(b, [
      [0, 0, -1],
      [0, 1, 1],
      [-1, 2, 3],
    ]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[1][1] = STONE; // adjacent to (0,1),(1,0),(2,1),(1,2)
    b.types[2][2] = STONE; // NOT adjacent to the popped group → must survive
    // Pop the (0,0) cluster which includes (0,1), a neighbour of the stone.
    const fx = b.removeCells(b.getGroupAt(0, 0), null);
    expect(b.grid[1][1]).toBe(-1); // adjacent stone shattered
    expect(b.types[1][1]).toBe(NORMAL);
    expect(b.grid[2][2]).toBe(3); // far stone untouched
    expect(b.types[2][2]).toBe(STONE);
    expect(fx.stonesBroken).toBe(1);
  });

  it("an AoE that includes a stone clears it directly", () => {
    const b = new Board(2, 2, 3, 1);
    setGrid(b, [
      [0, 1],
      [2, 3],
    ]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[0][0] = STONE;
    // Passing the stone cell directly (as a bomb/cross would) removes it.
    b.removeCells([{ c: 0, r: 0 }], null);
    expect(b.grid[0][0]).toBe(-1);
    expect(b.types[0][0]).toBe(NORMAL);
  });

  it("hasMoves ignores stones as both origin and neighbour match", () => {
    const b = new Board(3, 1, 3, 1);
    // Two same-colour bubbles separated only by stones of that same colour.
    setGrid(b, [[0], [0], [0]]);
    b.types = [[STONE], [NORMAL], [STONE]];
    // The lone NORMAL bubble has only stone neighbours → no legal move.
    expect(b.hasMoves()).toBe(false);
    // Convert one stone back to a normal same-colour bubble → a move appears.
    b.types[0][0] = NORMAL;
    expect(b.hasMoves()).toBe(true);
  });

  it("placeStoneVault locks a centred block and stoneRemaining counts them", () => {
    const b = new Board(6, 6, 4, 1);
    expect(b.stoneRemaining()).toBe(0);
    const n = b.placeStoneVault(2, 2);
    expect(n).toBe(4);
    expect(b.stoneRemaining()).toBe(4);
    // The vault is centred: cols (6-2)/2 = 2, rows (6-2)/2 = 2.
    for (let c = 2; c < 4; c++)
      for (let r = 2; r < 4; r++) expect(b.types[c][r]).toBe(STONE);
    // Sprites are tagged so the renderer draws the locked shell.
    const sp = b.spriteGrid[2][2];
    if (sp) expect(sp.type).toBe(STONE);
  });

  it("layout / targetPixel / cellAtPixel round-trip", () => {
    const b = new Board(6, 8, 3, 5);
    b.layout(400, 800, 100, 80);
    const px = b.targetPixel(2, 3);
    const cell = b.cellAtPixel(px.x, px.y);
    expect(cell).toEqual({ c: 2, r: 3 });
    // outside the board returns null
    expect(b.cellAtPixel(-50, -50)).toBeNull();
  });

  it("update removes popped sprites once their animation finishes", () => {
    const b = new Board(2, 2, 3, 1);
    b.layout(400, 800, 100, 80);
    const sprite = b.sprites[0];
    sprite.delay = 0;
    sprite.state = "pop";
    sprite.t = 0;
    const startCount = b.sprites.length;
    for (let i = 0; i < 30; i++) b.update(0.016); // ~0.48s
    expect(b.sprites.length).toBe(startCount - 1);
    expect(b.isIdle()).toBe(true);
  });

  it("serialize() / restore() round-trips the colour grid exactly", () => {
    const b = new Board(6, 8, 4, 99);
    b.layout(400, 800, 100, 80);
    // Mutate the board so it differs from a freshly generated one.
    b.removeCells(b.getGroupAt(0, 0), null);
    b.settle();
    const snapshot = b.serialize();

    const restored = new Board(6, 8, 4, 99);
    restored.layout(400, 800, 100, 80);
    restored.restore(snapshot);

    expect(restored.serialize()).toEqual(snapshot);
    // A sprite exists for every non-empty cell, placed at its resting target.
    expect(restored.isIdle()).toBe(true);
    for (let c = 0; c < restored.cols; c++) {
      for (let r = 0; r < restored.rows; r++) {
        const hasSprite = !!restored.spriteGrid[c][r];
        expect(hasSprite).toBe(restored.grid[c][r] !== -1);
        if (hasSprite) {
          const t = restored.targetPixel(c, r);
          expect(restored.spriteGrid[c][r].x).toBe(t.x);
          expect(restored.spriteGrid[c][r].y).toBe(t.y);
        }
      }
    }
  });

  it("serialize() returns an independent copy", () => {
    const b = new Board(3, 3, 3, 7);
    const snap = b.serialize();
    snap[0][0] = 999;
    expect(b.grid[0][0]).not.toBe(999);
  });

  it("blastArea returns a filled diamond clipped to the board", () => {
    const b = new Board(7, 7, 3, 3);
    b.layout(400, 800, 100, 80);
    // Center: full Manhattan-radius-2 diamond = 13 cells.
    expect(b.blastArea(3, 3).length).toBe(13);
    // Every returned cell is within Manhattan distance 2 of the center.
    for (const cell of b.blastArea(3, 3)) {
      expect(Math.abs(cell.c - 3) + Math.abs(cell.r - 3)).toBeLessThanOrEqual(2);
    }
    // A corner blast is clipped to in-bounds cells only.
    expect(b.blastArea(0, 0).length).toBeLessThan(13);
    expect(b.blastArea(0, 0).every((c) => c.c >= 0 && c.r >= 0)).toBe(true);
  });

  it("shiftRow rotates a row with wrap-around in both directions", () => {
    const b = new Board(3, 1, 3, 1);
    // grid is [col][row]; single row r=0 with colours [A,B,C] across columns.
    setGrid(b, [[0], [1], [2]]);
    expect(b.shiftRow(0, "right")).toBe(true);
    // right shift: last column wraps to first => [C,A,B]
    expect([b.grid[0][0], b.grid[1][0], b.grid[2][0]]).toEqual([2, 0, 1]);

    setGrid(b, [[0], [1], [2]]);
    expect(b.shiftRow(0, "left")).toBe(true);
    // left shift: first column wraps to last => [B,C,A]
    expect([b.grid[0][0], b.grid[1][0], b.grid[2][0]]).toEqual([1, 2, 0]);

    // An out-of-range or empty row reports no shift.
    expect(b.shiftRow(99, "left")).toBe(false);
    setGrid(b, [[-1], [-1], [-1]]);
    expect(b.shiftRow(0, "left")).toBe(false);
  });

  it("rainbow bubbles act as wildcards and bridge same-colour regions", () => {
    const b = new Board(3, 1, 6, 1);
    setGrid(b, [[0], [5], [0]]);
    b.types = [[NORMAL], [RAINBOW], [NORMAL]];
    // colour-0 at the ends, a rainbow in the middle: the group bridges to 3.
    expect(b.getGroupAt(0, 0).length).toBe(3);
    // hasMoves recognises a rainbow next to any bubble.
    expect(b.hasMoves()).toBe(true);
  });

  it("ice bubbles crack on the first hit and clear on the second", () => {
    const b = new Board(2, 1, 3, 1);
    setGrid(b, [[0], [0]]);
    b.types = [[NORMAL], [ICE]];
    const group = b.getGroupAt(0, 0);
    expect(group.length).toBe(2);

    b.removeCells(group);
    // Normal bubble cleared; ice only cracked and stays on the board.
    expect(b.grid[0][0]).toBe(-1);
    expect(b.grid[1][0]).toBe(0);
    expect(b.types[1][0]).toBe(ICE_CRACKED);

    // A second hit clears the cracked ice.
    b.removeCells([{ c: 1, r: 0 }]);
    expect(b.grid[1][0]).toBe(-1);
    expect(b.types[1][0]).toBe(NORMAL);
  });

  it("serialize/restore round-trips colours and bubble types", () => {
    const a = new Board(4, 4, 4, 99, { rainbow: 0.3, ice: 0.3 });
    const grid = a.serialize();
    const types = a.serializeTypes();
    const b = new Board(4, 4, 4, 1);
    b.layout(400, 800, 100, 80);
    b.restore(grid, types);
    expect(b.serialize()).toEqual(grid);
    expect(b.serializeTypes()).toEqual(types);
  });

  it("placeFrozenCore freezes a centred block and frozenRemaining tracks it", () => {
    const b = new Board(6, 6, 3, 7, { ice: 0 });
    expect(b.frozenRemaining()).toBe(0);
    const frozen = b.placeFrozenCore(2, 2);
    expect(frozen).toBe(4);
    expect(b.frozenRemaining()).toBe(4);
    // Cracked ice still counts as unbroken; only a full clear reduces the core.
    const core = [];
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++) if (b.types[c][r] === ICE) core.push({ c, r });
    b.removeCells(core); // first hit: all crack
    expect(b.frozenRemaining()).toBe(4);
    b.removeCells(core); // second hit: all shatter
    expect(b.frozenRemaining()).toBe(0);
  });

  it("scatterArea recolours the nearest bubbles to a different colour", () => {
    const b = new Board(4, 4, 3, 7);
    // Flatten to a single colour so any scatter is detectable.
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++) b.grid[c][r] = 0;
    const affected = b.scatterArea(1, 1, 4, () => 0.5);
    expect(affected.length).toBe(4);
    for (const cell of affected) {
      // Each scattered cell moved away from the original colour 0...
      expect(b.grid[cell.c][cell.r]).not.toBe(0);
      // ...and its sprite colour was kept in sync with the grid.
      expect(b.spriteGrid[cell.c][cell.r].color).toBe(b.grid[cell.c][cell.r]);
    }
    // The anchor cell is among the nearest, so it should be scattered too.
    expect(affected).toContainEqual({ c: 1, r: 1 });
  });

  it("scatterArea clamps the count to the available bubbles", () => {
    const b = new Board(3, 3, 3, 5);
    const affected = b.scatterArea(0, 0, 99, () => 0.5);
    expect(affected.length).toBe(9);
  });

  it("scatterArea is a no-op when there is only one colour", () => {
    const b = new Board(3, 3, 1, 5);
    expect(b.scatterArea(1, 1, 4, () => 0.5)).toEqual([]);
  });

  it("randomFilledCell returns a normal filled cell", () => {
    const b = new Board(3, 3, 3, 5);
    const cell = b.randomFilledCell(() => 0);
    expect(cell).toEqual({ c: 0, r: 0 });
    expect(b.grid[cell.c][cell.r]).not.toBe(-1);
  });

  // Helper that also sets a matching all-NORMAL types grid so the pet
  // companion board helpers (which inspect types) work on a custom grid.
  function setGridTyped(board, grid) {
    board.cols = grid.length;
    board.rows = grid[0].length;
    board.colorCount = 4;
    board.grid = grid.map((col) => col.slice());
    board.types = grid.map((col) => col.map(() => NORMAL));
    board.spriteGrid = grid.map((col) => col.map(() => null));
    board.sprites = [];
  }

  describe("pet companion board helpers", () => {
    it("dominantColor returns the most common NORMAL colour", () => {
      const b = new Board(3, 3, 4, 1);
      setGridTyped(b, [
        [0, 0, 1],
        [0, 2, 1],
        [3, 2, 0],
      ]);
      // colour 0 appears 4×, more than any other.
      expect(b.dominantColor()).toBe(0);
    });

    it("dominantColor is null on an empty board", () => {
      const b = new Board(2, 2, 4, 1);
      setGridTyped(b, [
        [-1, -1],
        [-1, -1],
      ]);
      expect(b.dominantColor()).toBeNull();
    });

    it("firstCellOfColor finds an anchor or returns null", () => {
      const b = new Board(2, 2, 4, 1);
      setGridTyped(b, [
        [1, 2],
        [0, 1],
      ]);
      expect(b.firstCellOfColor(1)).toEqual({ c: 0, r: 0 });
      expect(b.firstCellOfColor(9)).toBeNull();
    });

    it("cellsOfColor returns every NORMAL cell of a colour", () => {
      const b = new Board(2, 2, 4, 1);
      setGridTyped(b, [
        [1, 2],
        [0, 1],
      ]);
      expect(b.cellsOfColor(1)).toEqual([
        { c: 0, r: 0 },
        { c: 1, r: 1 },
      ]);
      expect(b.cellsOfColor(9)).toEqual([]);
    });

    it("isolatedCells finds lone bubbles with no same-colour neighbour", () => {
      const b = new Board(3, 3, 4, 1);
      setGridTyped(b, [
        [0, 0, 3],
        [1, 2, 0],
        [0, 1, 2],
      ]);
      const iso = b.isolatedCells();
      // (0,2)=3 is alone; verify it's flagged and that paired 0s are not.
      const keys = new Set(iso.map((c) => `${c.c},${c.r}`));
      expect(keys.has("0,2")).toBe(true);
      expect(keys.has("0,0")).toBe(false); // 0 at (0,0) touches 0 at (0,1)
      for (const cell of iso) {
        expect(b.getGroupAt(cell.c, cell.r).length).toBe(1);
      }
    });

    it("detects a lone-bubble jam: only isolated distinct colours remain", () => {
      // This is exactly the state the rescue prompt watches for — a board with
      // bubbles left but no poppable group of 2+.
      const b = new Board(3, 3, 4, 1);
      setGridTyped(b, [
        [0, 1, 2],
        [3, 0, 1],
        [2, 3, 0],
      ]);
      expect(b.hasMoves()).toBe(false); // jammed
      expect(b.isCleared()).toBe(false); // but bubbles remain
      // every remaining bubble is a lone single (the rescue trigger).
      expect(b.isolatedCells().length).toBe(b.countRemaining());
    });

    it("mostIsolatedCells ranks the most walled-in bubbles and skips healthy clusters", () => {
      const b = new Board(5, 5, 4, 1);
      setGridTyped(b, [
        [0, 0, 0, 0, 0],
        [0, 1, 0, 0, 0],
        [0, 0, 2, 2, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
      ]);
      // The lone 1 at (1,1) is walled in by a different colour on all 4 sides
      // AND is a singleton, so it ranks highest.
      expect(b.mostIsolatedCells(1)).toEqual([{ c: 1, r: 1 }]);
      // Only genuinely isolated bubbles qualify — the big 0 blob is skipped, and
      // the 2-pair (less isolated, not singletons) ranks below the lone 1.
      expect(b.mostIsolatedCells(5)).toEqual([
        { c: 1, r: 1 },
        { c: 2, r: 2 },
        { c: 2, r: 3 },
      ]);
      // The requested count is respected.
      expect(b.mostIsolatedCells(2)).toHaveLength(2);
    });

    it("columnCells lists a column's filled cells top→bottom (🌋 Magma)", () => {
      const b = new Board(3, 3, 4, 1);
      setGridTyped(b, [
        [0, -1, 2],
        [1, 1, 1],
        [-1, -1, -1],
      ]);
      expect(b.columnCells(0)).toEqual([
        { c: 0, r: 0 },
        { c: 0, r: 2 },
      ]);
      expect(b.columnCells(1)).toEqual([
        { c: 1, r: 0 },
        { c: 1, r: 1 },
        { c: 1, r: 2 },
      ]);
      expect(b.columnCells(2)).toEqual([]);
      expect(b.columnCells(9)).toEqual([]); // out of range is safe
    });

    it("fullestColumns ranks the busiest lanes fullest-first (🌋 Magma)", () => {
      const b = new Board(3, 3, 4, 1);
      setGridTyped(b, [
        [0, 1, 2], // col0: 3 bubbles
        [0, -1, -1], // col1: 1 bubble
        [0, 1, -1], // col2: 2 bubbles
      ]);
      expect(b.fullestColumns(1)).toEqual([0]);
      expect(b.fullestColumns(2)).toEqual([0, 2]);
      expect(b.fullestColumns(9)).toEqual([0, 2, 1]);
    });

    it("quakeRegroup conserves colours but clusters them into matches (🌍 Quake)", () => {
      const b = new Board(3, 3, 4, 1);
      setGridTyped(b, [
        [0, 1, 2],
        [1, 2, 0],
        [2, 0, 1],
      ]);
      expect(b.hasMoves()).toBe(false); // a fully jammed checkerboard
      const before = colourHistogram(b);
      b.quakeRegroup();
      // The colour multiset is unchanged — bubbles were rearranged, not added.
      expect(colourHistogram(b)).toEqual(before);
      // …but now there is at least one poppable group of 2+.
      expect(b.hasMoves()).toBe(true);
    });

    it("cycloneSort orders each column by colour without moving bubbles between columns (🌪️ Cyclone)", () => {
      const b = new Board(2, 3, 4, 1);
      setGridTyped(b, [
        [2, 0, 1], // col0 -> sorted 0,1,2
        [3, 1, 3], // col1 -> sorted 1,3,3 (the 3s now touch = a match)
      ]);
      b.cycloneSort();
      expect(b.grid[0]).toEqual([0, 1, 2]);
      expect(b.grid[1]).toEqual([1, 3, 3]);
      // Per-column colour multisets are preserved (nothing crosses columns).
      expect(b.cellsOfColor(3).every((cell) => cell.c === 1)).toBe(true);
    });
  });
});

function colourHistogram(board) {
  const h = {};
  for (let c = 0; c < board.cols; c++)
    for (let r = 0; r < board.rows; r++) {
      const v = board.grid[c][r];
      if (v !== -1) h[v] = (h[v] || 0) + 1;
    }
  return h;
}

describe("gunship targeting helpers (bottomBubble / bottomBlock)", () => {
  it("bottomBubble finds the lowest filled cell in a column", () => {
    const b = new Board(3, 4, 3, 1);
    setGrid(b, [
      [-1, -1, 0, 1], // column 0: bottom is r=3
      [-1, -1, -1, -1], // column 1: empty
      [2, -1, -1, -1], // column 2: only r=0 filled
    ]);
    expect(b.bottomBubble(0)).toEqual({ c: 0, r: 3 });
    expect(b.bottomBubble(1)).toBeNull();
    expect(b.bottomBubble(2)).toEqual({ c: 2, r: 0 });
    // Out of range columns are safe.
    expect(b.bottomBubble(-1)).toBeNull();
    expect(b.bottomBubble(9)).toBeNull();
  });

  it("bottomBlock collects the bottom N bubbles across nearby columns", () => {
    const b = new Board(4, 4, 3, 1);
    setGrid(b, [
      [-1, 0, 0, 0], // col0: bottom two = r3,r2
      [-1, -1, 1, 1], // col1: bottom two = r3,r2
      [-1, -1, -1, 2], // col2: only r3
      [3, 3, 3, 3], // col3 (outside the +-1 window around col1)
    ]);
    const cells = b.bottomBlock(1, 1, 2); // columns 0,1,2; up to 2 each
    // col0: (0,3),(0,2); col1: (1,3),(1,2); col2: (2,3) only
    expect(cells).toEqual([
      { c: 0, r: 3 },
      { c: 0, r: 2 },
      { c: 1, r: 3 },
      { c: 1, r: 2 },
      { c: 2, r: 3 },
    ]);
    // Column 3 is outside the window, so it is never included.
    expect(cells.some((x) => x.c === 3)).toBe(false);
  });

  it("columnAtPixel clamps to the board edges", () => {
    const b = new Board(5, 5, 3, 1);
    b.layout(400, 700, 0, 0);
    const mid = b.originX + b.boardW / 2;
    expect(b.columnAtPixel(mid)).toBeGreaterThanOrEqual(0);
    expect(b.columnAtPixel(mid)).toBeLessThan(b.cols);
    expect(b.columnAtPixel(-9999)).toBe(0);
    expect(b.columnAtPixel(99999)).toBe(b.cols - 1);
  });
});

describe("swipe-aware deadlock detection (hasShiftMove)", () => {
  // Force every type to NORMAL so the colour grid alone drives the checks.
  function setNormalGrid(board, grid) {
    setGrid(board, grid);
    board.types = grid.map((col) => col.map(() => NORMAL));
  }

  it("finds a row-shift that creates a match when no tap-move exists", () => {
    const b = new Board(4, 2, 4, 1);
    // No two same-colour bubbles are orthogonally adjacent, so there is no
    // tap-move — but shifting the bottom row wraps the trailing 1 next to the
    // leading 1, producing a poppable pair.
    setNormalGrid(b, [
      [0, 1], // c0: top 0, bottom 1
      [2, 0], // c1: top 2, bottom 0
      [1, 2], // c2: top 1, bottom 2
      [0, 1], // c3: top 0, bottom 1
    ]);
    expect(b.hasMoves()).toBe(false);
    expect(b.hasShiftMove()).toBe(true);
  });

  it("reports no shift-move for a genuine deadlock (colours can never match)", () => {
    const b = new Board(3, 1, 3, 1);
    // Three single bubbles of distinct colours: no tap-move and no shift (which
    // only rotates the row) can ever place two equal colours side by side.
    setNormalGrid(b, [[0], [1], [2]]);
    expect(b.hasMoves()).toBe(false);
    expect(b.hasShiftMove()).toBe(false);
  });

  it("hasShiftMove does not mutate the real board", () => {
    const b = new Board(4, 2, 4, 1);
    setNormalGrid(b, [
      [0, 1],
      [2, 0],
      [1, 2],
      [0, 1],
    ]);
    const before = JSON.stringify(b.grid);
    b.hasShiftMove();
    expect(JSON.stringify(b.grid)).toBe(before);
  });

  it("_gridHasMoves matches hasMoves on the live grid", () => {
    const b = new Board(5, 5, 4, 7);
    expect(b._gridHasMoves(b.grid, b.types)).toBe(b.hasMoves());
  });

  it("findHint returns the cells of the largest poppable group", () => {
    const b = new Board(3, 3, 6, 1);
    setGrid(b, [
      [0, 0, 0],
      [0, 1, 2],
      [3, 4, 5],
    ]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    const hint = b.findHint();
    expect(hint).not.toBeNull();
    // The connected colour-0 region is {(0,0),(0,1),(0,2),(1,0)} = 4 cells.
    expect(hint.length).toBe(4);
    expect(hint.every((p) => b.grid[p.c][p.r] === 0)).toBe(true);
  });

  it("findHint returns null when there is no tap-move", () => {
    const b = new Board(3, 2, 9, 1);
    setGrid(b, [
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    expect(b.hasMoves()).toBe(false);
    expect(b.findHint()).toBeNull();
  });

  it("findHint returns null on an empty board", () => {
    const b = new Board(2, 2, 3, 1);
    setGrid(b, [
      [-1, -1],
      [-1, -1],
    ]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    expect(b.findHint()).toBeNull();
  });
});

