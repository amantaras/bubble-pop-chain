import { describe, it, expect } from "vitest";
import {
  Board,
  NORMAL,
  ICE,
  RAINBOW,
  ICE_CRACKED,
  LIGHTNING,
  STONE,
  BOMB,
  MULTIPLIER,
  COIN,
  VINE,
  SEQUENCE_1,
  SEQUENCE_2,
  SEQUENCE_3,
  TETHER,
  POLARITY_PLUS,
  POLARITY_MINUS,
  BLOOM_SEED,
  BLOOM_BUD,
  MAGNET_GLIDE,
  DOWNPOUR_FALL_MULT,
  DOWNPOUR_FALL_SECONDS,
} from "../../src/grid.js";

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

  it("arrowRay returns filled cells along a deterministic skill-shot path", () => {
    const b = new Board(5, 5, 3, 1);
    setGrid(b, [
      [0, -1, -1, -1, -1],
      [-1, 1, -1, -1, -1],
      [-1, -1, 2, -1, -1],
      [-1, -1, -1, 0, -1],
      [-1, -1, -1, -1, 1],
    ]);
    expect(b.arrowRay(0, 0, 1, 1, 3)).toEqual([
      { c: 0, r: 0 },
      { c: 1, r: 1 },
      { c: 2, r: 2 },
    ]);
    expect(b.arrowRay(0, 0, 1, 0, 3)).toEqual([{ c: 0, r: 0 }]);
  });

  it("arrowRay catches diagonal shots that pass near bubble centres", () => {
    const b = new Board(5, 5, 3, 1);
    setGrid(b, [
      [0, -1, -1, -1, -1],
      [-1, -1, -1, -1, -1],
      [-1, 1, -1, -1, -1],
      [-1, -1, 2, -1, -1],
      [-1, -1, -1, 0, -1],
    ]);
    expect(b.arrowRay(0, 0, 4, 3, 4)).toEqual([
      { c: 0, r: 0 },
      { c: 2, r: 1 },
      { c: 3, r: 2 },
      { c: 4, r: 3 },
    ]);
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

  it("suggestRecolors ranks colours by the target bubble's new group impact", () => {
    const b = new Board(4, 3, 4, 1);
    setGrid(b, [
      [0, 1, 2],
      [3, 2, 2],
      [1, 2, 3],
      [1, 3, 3],
    ]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));

    const suggestions = b.suggestRecolors(1, 0);

    expect(suggestions.map((s) => s.color)).toEqual([2, 1, 0]);
    expect(suggestions[0]).toMatchObject({ color: 2, groupSize: 5, createsMove: true });
    expect(b.grid[1][0]).toBe(3);
  });

  it("recolorCell changes a legal bubble colour and keeps stone locked", () => {
    const b = new Board(2, 2, 4, 1);
    setGrid(b, [
      [0, 1],
      [2, 3],
    ]);
    b.types = [
      [NORMAL, STONE],
      [NORMAL, NORMAL],
    ];

    expect(b.recolorCell(0, 0, 3)).toBe(true);
    expect(b.grid[0][0]).toBe(3);
    expect(b.recolorCell(0, 1, 2)).toBe(false);
    expect(b.grid[0][1]).toBe(1);
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

  // ---- Chain Reactor (SEQUENCE_1/2/3) ------------------------------------
  it("a sequence spawn rate sprinkles all three numbered bubbles deterministically", () => {
    const b = new Board(10, 10, 4, 21, { rainbow: 0, ice: 0, sequence: 0.5 });
    let n1 = 0, n2 = 0, n3 = 0;
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++) {
        if (b.types[c][r] === SEQUENCE_1) n1++;
        else if (b.types[c][r] === SEQUENCE_2) n2++;
        else if (b.types[c][r] === SEQUENCE_3) n3++;
      }
    expect(n1).toBeGreaterThan(0);
    expect(n2).toBeGreaterThan(0);
    expect(n3).toBeGreaterThan(0);
  });

  it("a sequence bubble joins same-colour groups like a normal bubble", () => {
    const b = new Board(3, 1, 2, 1);
    setGrid(b, [[0], [0], [1]]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[1][0] = SEQUENCE_2; // middle cell of the colour-0 pair
    expect(b.getGroupAt(0, 0).length).toBe(2);
    expect(b.isSequenceNum(1, 0, 2)).toBe(true);
    expect(b.isSequenceNum(1, 0, 1)).toBe(false);
    expect(b.isSequence(1, 0)).toBe(true);
    expect(b.isSequence(0, 0)).toBe(false);
  });

  it("sequenceStrike leaves the group unchanged when it has no primed '3'", () => {
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
    expect(b.sequenceStrike(group)).toHaveLength(2);
  });

  it("sequenceStrike adds a big diamond blast (radius 3) around each '3' bubble", () => {
    const b = new Board(9, 9, 3, 1);
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++) b.grid[c][r] = 0;
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[4][4] = SEQUENCE_3;
    const cells = b.sequenceStrike([{ c: 4, r: 4 }]);
    const keys = new Set(cells.map((p) => `${p.c},${p.r}`));
    expect(keys.size).toBe(cells.length); // no dupes
    // blastArea(4,4,3) on a fully-filled board matches the pure helper exactly.
    expect(cells.length).toBe(b.blastArea(4, 4, 3).length);
  });

  it("a corner '3' clips its blast to the board", () => {
    const b = new Board(5, 5, 3, 1);
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++) b.grid[c][r] = 0;
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[0][0] = SEQUENCE_3;
    const cells = b.sequenceStrike([{ c: 0, r: 0 }]);
    expect(cells.length).toBe(b.blastArea(0, 0, 3).length);
    expect(cells.length).toBeLessThan(25); // clipped, not the full 7x7 diamond
  });

  // ---- Tether pairs (TETHER) ----------------------------------------------
  it("a tether spawn rate sprinkles paired bubbles deterministically", () => {
    const b = new Board(10, 10, 4, 11, { rainbow: 0, ice: 0, tether: 0.5 });
    let n = 0;
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++) if (b.types[c][r] === TETHER) n++;
    expect(n).toBeGreaterThan(0);
    expect(n % 2).toBe(0); // always paired up (or zero) — never an orphan
  });

  it("a tether bubble joins same-colour groups like a normal bubble", () => {
    const b = new Board(3, 1, 2, 1);
    setGrid(b, [[0], [0], [1]]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[1][0] = TETHER;
    expect(b.getGroupAt(0, 0).length).toBe(2);
    expect(b.isTether(1, 0)).toBe(true);
    expect(b.isTether(0, 0)).toBe(false);
  });

  it("_linkTethers pairs cells in scan order and reverts an odd leftover to normal", () => {
    const b = new Board(3, 3, 3, 1);
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++) b.grid[c][r] = 0;
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[0][0] = TETHER;
    b.types[1][0] = TETHER;
    b.types[2][0] = TETHER; // odd one out in column-major scan order
    b._linkTethers();
    expect(b.tetherPartner(0, 0)).toEqual({ c: 1, r: 0 });
    expect(b.tetherPartner(1, 0)).toEqual({ c: 0, r: 0 });
    expect(b.types[2][0]).toBe(NORMAL); // reverted — no orphaned tether
    expect(b.tetherPartner(2, 0)).toBeNull();
  });

  it("tetherStrike merges a linked partner cell into the cleared set", () => {
    const b = new Board(6, 6, 3, 1);
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++) b.grid[c][r] = 0;
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[0][0] = TETHER;
    b.types[5][5] = TETHER;
    b._linkTethers();
    const cells = b.tetherStrike([{ c: 0, r: 0 }]);
    const keys = new Set(cells.map((p) => `${p.c},${p.r}`));
    expect(cells).toHaveLength(2);
    expect(keys.has("0,0")).toBe(true);
    expect(keys.has("5,5")).toBe(true);
  });

  it("tetherStrike is a no-op when the group has no tether bubble", () => {
    const b = new Board(4, 4, 3, 1);
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++) b.grid[c][r] = 0;
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    const group = [
      { c: 0, r: 0 },
      { c: 0, r: 1 },
    ];
    expect(b.tetherStrike(group)).toBe(group);
  });

  it("tetherStrike skips a partner that's already gone (its half already popped)", () => {
    const b = new Board(4, 4, 3, 1);
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++) b.grid[c][r] = 0;
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[0][0] = TETHER;
    b.types[3][3] = TETHER;
    b._linkTethers();
    b.grid[3][3] = -1; // partner already cleared
    const cells = b.tetherStrike([{ c: 0, r: 0 }]);
    expect(cells).toEqual([{ c: 0, r: 0 }]);
  });

  it("serializeTether/restoreTetherPairs round-trips the pairing", () => {
    const b = new Board(6, 6, 3, 1);
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++) b.grid[c][r] = 0;
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[1][1] = TETHER;
    b.types[4][4] = TETHER;
    b._linkTethers();
    const pairs = b.serializeTether();
    expect(pairs).toHaveLength(1);
    const b2 = new Board(6, 6, 3, 2);
    b2.restore(b.serialize(), b.serializeTypes(), pairs);
    expect(b2.tetherPartner(1, 1)).toEqual({ c: 4, r: 4 });
    expect(b2.tetherPartner(4, 4)).toEqual({ c: 1, r: 1 });
  });

  it("restore() without an explicit tether snapshot re-derives pairs by scanning", () => {
    const b = new Board(4, 4, 3, 1);
    const grid = b.serialize();
    for (const col of grid) col.fill(0);
    const types = grid.map((col) => col.map(() => NORMAL));
    types[0][0] = TETHER;
    types[3][3] = TETHER;
    b.restore(grid, types); // no third arg -> fallback scan-order pairing
    expect(b.tetherPartner(0, 0)).toEqual({ c: 3, r: 3 });
    expect(b.tetherPartner(3, 3)).toEqual({ c: 0, r: 0 });
  });

  // ---- Polarity bubbles (POLARITY_PLUS/POLARITY_MINUS) -------------------
  it("a polarity spawn rate sprinkles both charges deterministically", () => {
    const b = new Board(10, 10, 4, 13, { rainbow: 0, ice: 0, polarity: 0.5 });
    let plus = 0, minus = 0;
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++) {
        if (b.types[c][r] === POLARITY_PLUS) plus++;
        else if (b.types[c][r] === POLARITY_MINUS) minus++;
      }
    expect(plus).toBeGreaterThan(0);
    expect(minus).toBeGreaterThan(0);
  });

  it("a polarity bubble joins same-colour groups like a normal bubble", () => {
    const b = new Board(3, 1, 2, 1);
    setGrid(b, [[0], [0], [1]]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[1][0] = POLARITY_PLUS;
    expect(b.getGroupAt(0, 0).length).toBe(2);
    expect(b.isPolarity(1, 0)).toBe(true);
    expect(b.isPolarity(0, 0)).toBe(false);
  });

  it("polarityCharge reports +1/-1/0 and isPolarity follows it", () => {
    const b = new Board(3, 1, 2, 1);
    setGrid(b, [[0], [0], [0]]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[0][0] = POLARITY_PLUS;
    b.types[1][0] = POLARITY_MINUS;
    expect(b.polarityCharge(0, 0)).toBe(1);
    expect(b.polarityCharge(1, 0)).toBe(-1);
    expect(b.polarityCharge(2, 0)).toBe(0);
    expect(b.isPolarity(0, 0)).toBe(true);
    expect(b.isPolarity(1, 0)).toBe(true);
    expect(b.isPolarity(2, 0)).toBe(false);
  });

  it("spreadPolarity repels an adjacent same-charge pair one cell further apart", () => {
    const b = new Board(6, 1, 3, 1);
    for (let c = 0; c < b.cols; c++) b.grid[c][0] = 0;
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[2][0] = POLARITY_PLUS;
    b.types[3][0] = POLARITY_PLUS; // adjacent, same charge
    const moved = b.spreadPolarity();
    expect(moved).toBeTruthy();
    // Exactly one of the two plus bubbles stepped one cell further outward
    // (to col 1 or col 4), while the other stayed put — a genuine repel.
    const outward = [b.polarityCharge(1, 0), b.polarityCharge(4, 0)].filter((c) => c === 1).length;
    expect(outward).toBe(1);
  });

  it("spreadPolarity leaves an adjacent opposite-charge pair stable (already attracted)", () => {
    const b = new Board(6, 1, 3, 1);
    for (let c = 0; c < b.cols; c++) b.grid[c][0] = 0;
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[2][0] = POLARITY_PLUS;
    b.types[3][0] = POLARITY_MINUS; // adjacent, opposite charge
    expect(b.spreadPolarity()).toBeNull();
    expect(b.polarityCharge(2, 0)).toBe(1);
    expect(b.polarityCharge(3, 0)).toBe(-1);
  });

  it("spreadPolarity returns null when there are no charges, or a same-charge pair is boxed in", () => {
    const empty = new Board(3, 3, 3, 1);
    empty.types = empty.grid.map((col) => col.map(() => NORMAL));
    expect(empty.spreadPolarity()).toBeNull();

    // Same-charge pair at the very edge, with nowhere to repel outward to.
    const boxed = new Board(2, 1, 2, 1);
    boxed.grid[0][0] = 0;
    boxed.grid[1][0] = 0;
    boxed.types = boxed.grid.map((col) => col.map(() => NORMAL));
    boxed.types[0][0] = POLARITY_PLUS;
    boxed.types[1][0] = POLARITY_PLUS;
    expect(boxed.spreadPolarity()).toBeNull();
  });

  it("spreadPolarity only swaps into a plain bubble, never another special", () => {
    const b = new Board(5, 1, 3, 1);
    for (let c = 0; c < b.cols; c++) b.grid[c][0] = 0;
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[1][0] = STONE; // blocks the leftward repel target
    b.types[2][0] = POLARITY_PLUS;
    b.types[3][0] = POLARITY_PLUS;
    // rightward repel (col 3 -> col 4) is still open even though leftward is blocked
    const moved = b.spreadPolarity();
    expect(moved).toEqual({ from: { c: 3, r: 0 }, to: { c: 4, r: 0 } });
    expect(b.types[1][0]).toBe(STONE); // untouched
  });

  // ---- Bloom seeds (BLOOM_SEED/BLOOM_BUD) ---------------------------------
  it("a bloom spawn rate sprinkles seeds deterministically", () => {
    const b = new Board(10, 10, 4, 17, { rainbow: 0, ice: 0, bloom: 0.5 });
    let n = 0;
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++) if (b.types[c][r] === BLOOM_SEED) n++;
    expect(n).toBeGreaterThan(0);
  });

  it("a bloom seed joins same-colour groups like a normal bubble", () => {
    const b = new Board(3, 1, 2, 1);
    setGrid(b, [[0], [0], [1]]);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[1][0] = BLOOM_SEED;
    expect(b.getGroupAt(0, 0).length).toBe(2);
    expect(b.isBloomSeed(1, 0)).toBe(true);
    expect(b.isBloom(1, 0)).toBe(true);
    expect(b.isBloomBud(1, 0)).toBe(false);
    expect(b.isBloom(0, 0)).toBe(false);
  });

  it("growBloom matures a seed to a bud, then a bud into a matching bubble", () => {
    const b = new Board(3, 1, 3, 5);
    b.grid[0][0] = 0;
    b.grid[1][0] = 2;
    b.grid[2][0] = 2;
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[0][0] = BLOOM_SEED;
    const r1 = b.growBloom();
    expect(r1).toEqual({ c: 0, r: 0, stage: "bud" });
    expect(b.isBloomBud(0, 0)).toBe(true);

    const r2 = b.growBloom();
    expect(r2).toEqual({ c: 0, r: 0, stage: "bloomed", color: 2 });
    expect(b.types[0][0]).toBe(NORMAL);
    expect(b.grid[0][0]).toBe(2);
    // It fully joined the neighbouring colour-2 group (3 cells total).
    expect(b.getGroupAt(0, 0).length).toBe(3);
  });

  it("growBloom picks the neighbour colour that forms the largest group", () => {
    // Seed at (1,0) has a lone colour-0 neighbour on the left and a pair of
    // colour-1 neighbours on the right — the pair should win.
    const b = new Board(4, 1, 3, 1);
    b.grid[0][0] = 0;
    b.grid[1][0] = 5; // seed's own placeholder colour, irrelevant while growing
    b.grid[2][0] = 1;
    b.grid[3][0] = 1;
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[1][0] = BLOOM_BUD;
    const result = b.growBloom();
    expect(result.stage).toBe("bloomed");
    expect(result.color).toBe(1);
    expect(b.getGroupAt(1, 0).length).toBe(3);
  });

  it("growBloom pauses (returns null) when a growing cell has no plain neighbour", () => {
    const b = new Board(1, 1, 3, 1);
    b.grid[0][0] = 0;
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    b.types[0][0] = BLOOM_SEED;
    expect(b.growBloom()).toBeNull();
  });

  it("growBloom returns null when there are no bloom cells at all", () => {
    const b = new Board(3, 3, 3, 1);
    b.types = b.grid.map((col) => col.map(() => NORMAL));
    expect(b.growBloom()).toBeNull();
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

  it("coreBounds computes the same centred box used by placeFrozenCore/placeStoneVault/placeVineCore without mutating the board", () => {
    const b = new Board(6, 6, 4, 1);
    expect(b.coreBounds(2, 2)).toEqual({ c0: 2, r0: 2, w: 2, h: 2 });
    // Pure — calling it doesn't seed anything.
    expect(b.stoneRemaining()).toBe(0);
    expect(b.frozenRemaining()).toBe(0);
    expect(b.vineCount()).toBe(0);
    // Odd sizing rounds down like the placement helpers do internally.
    const b2 = new Board(7, 5, 4, 1);
    expect(b2.coreBounds(3, 2)).toEqual({ c0: 2, r0: 1, w: 3, h: 2 });
  });

  it("placeVineCore tags a centred block and vineCount counts them (boss objective)", () => {
    const b = new Board(6, 6, 4, 1);
    expect(b.vineCount()).toBe(0);
    const n = b.placeVineCore(2, 2);
    expect(n).toBe(4);
    expect(b.vineCount()).toBe(4);
    // The cluster is centred: cols (6-2)/2 = 2, rows (6-2)/2 = 2.
    for (let c = 2; c < 4; c++)
      for (let r = 2; r < 4; r++) expect(b.isVine(c, r)).toBe(true);
    // Sprites are tagged so the renderer draws the vine overlay.
    const sp = b.spriteGrid[2][2];
    if (sp) expect(sp.type).toBe(VINE);
    // Unlike frozen/stone, the underlying colour is untouched — a vine cell
    // still matches/pops as its existing colour.
    expect(b.grid[2][2]).not.toBe(-1);
  });

  it("placeVineCore skips empty cells and can still spread from the seeded cluster", () => {
    const b = new Board(6, 6, 4, 1);
    b.placeVineCore(2, 2);
    const before = b.vineCount();
    expect(before).toBeGreaterThan(0);
    const sprouted = b.spreadVines();
    // A seeded vine cluster has real NORMAL neighbours to creep into.
    expect(sprouted).toBeTruthy();
    expect(b.vineCount()).toBe(before + 1);
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
    b.snapToTargets();
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

  it("rowAtSwipePixel follows visible falling sprites on sparse boards", () => {
    const b = new Board(3, 3, 3, 1);
    b.layout(300, 300, 0, 0);
    b.restore([
      [0, -1, -1],
      [-1, -1, -1],
      [-1, -1, -1],
    ]);
    const visibleY = b.targetPixel(0, 0).y;

    b.settle();

    expect(b.rowAtPixel(visibleY)).toBe(0);
    expect(b.shiftRow(0, "right")).toBe(false);
    expect(b.rowAtSwipePixel(visibleY)).toBe(2);
    expect(b.shiftRow(b.rowAtSwipePixel(visibleY), "right")).toBe(true);
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

  it("paintArea recolours nearby bubbles to match the anchor without clearing", () => {
    const b = new Board(3, 3, 3, 5);
    const filled = () => {
      let n = 0;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) if (b.grid[c][r] !== -1) n += 1;
      return n;
    };
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++) b.grid[c][r] = (c + r) % 3;
    b.grid[1][1] = 2;
    const beforeFilled = filled();
    const affected = b.paintArea(1, 1, 3);
    expect(affected).toHaveLength(3);
    expect(affected).not.toContainEqual({ c: 1, r: 1 });
    for (const cell of affected) {
      expect(b.grid[cell.c][cell.r]).toBe(2);
      expect(b.spriteGrid[cell.c][cell.r].color).toBe(2);
    }
    expect(filled()).toBe(beforeFilled);
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

    it("clearableCellsOfColor includes coloured specials for destructive pet clears", () => {
      const b = new Board(3, 2, 4, 1);
      setGridTyped(b, [
        [1, 2],
        [1, 1],
        [1, 1],
      ]);
      b.types[1][0] = LIGHTNING;
      b.types[2][0] = COIN;
      b.types[2][1] = STONE;

      expect(b.cellsOfColor(1)).toEqual([
        { c: 0, r: 0 },
        { c: 1, r: 1 },
      ]);
      expect(b.clearableCellsOfColor(1)).toEqual([
        { c: 0, r: 0 },
        { c: 1, r: 0 },
        { c: 1, r: 1 },
        { c: 2, r: 0 },
      ]);
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

    it("isolatedCells includes lone coloured specials for pet clears", () => {
      const b = new Board(3, 3, 4, 1);
      setGridTyped(b, [
        [-1, -1, -1],
        [-1, 2, -1],
        [-1, 1, -1],
      ]);
      b.types[1][1] = LIGHTNING;
      b.types[2][1] = STONE;

      expect(b.isolatedCells()).toEqual([{ c: 1, r: 1 }]);
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

    it("mostIsolatedCells can choose coloured specials for pet pick", () => {
      const b = new Board(3, 3, 4, 1);
      setGridTyped(b, [
        [0, 0, 0],
        [0, 2, 0],
        [0, 0, 0],
      ]);
      b.types[1][1] = BOMB;

      expect(b.mostIsolatedCells(1)).toEqual([{ c: 1, r: 1 }]);
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

    it("bomberRun chooses the densest horizontal, vertical, or diagonal route", () => {
      const b = new Board(5, 5, 4, 1);
      setGridTyped(b, [
        [0, -1, -1, -1, -1],
        [-1, 0, -1, -1, 1],
        [-1, -1, 0, -1, 1],
        [-1, -1, -1, 0, -1],
        [-1, -1, -1, -1, 0],
      ]);
      expect(b.bomberRun(4)).toEqual([
        { c: 0, r: 0 },
        { c: 1, r: 1 },
        { c: 2, r: 2 },
        { c: 3, r: 3 },
      ]);
    });

    it("diagonalRun includes coloured specials in pet beams", () => {
      const b = new Board(4, 4, 4, 1);
      setGridTyped(b, [
        [1, -1, -1, -1],
        [-1, 1, -1, -1],
        [-1, -1, 1, -1],
        [-1, -1, -1, 2],
      ]);
      b.types[1][1] = LIGHTNING;
      b.types[2][2] = BOMB;

      expect(b.diagonalRun(3)).toEqual([
        { c: 0, r: 0 },
        { c: 1, r: 1 },
        { c: 2, r: 2 },
      ]);
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

describe("grid / Board downpour", () => {
  // Build a board whose logic grid, types and sprite coupling are all sized to
  // the supplied layout so dropRow()/topFilledRow() act deterministically.
  function makeBoard(grid) {
    const cols = grid.length;
    const rows = grid[0].length;
    const b = new Board(cols, rows, 5, 1);
    b.cols = cols;
    b.rows = rows;
    b.grid = grid.map((col) => col.slice());
    b.types = grid.map((col) => col.map(() => NORMAL));
    b.spriteGrid = grid.map((col) => col.map(() => null));
    b.sprites = [];
    b.layout(320, 480, 40, 40); // give sprites a real target pixel
    return b;
  }

  it("dropRow drops one bubble onto the top of every column's stack", () => {
    const b = makeBoard([
      [-1, -1, 0, 0], // col0: stack starts at row 2
      [-1, -1, -1, -1], // col1: empty — bubble lands on the floor
      [3, 3, 3, 3], // col2: full — no room, buries the player
    ]);
    const res = b.dropRow();
    // col0: a fresh bubble now rests directly above the old stack (row 1).
    expect(b.grid[0][1]).toBeGreaterThanOrEqual(0);
    expect(b.grid[0][0]).toBe(-1);
    // col1 was empty, so the new bubble lands at the very bottom (rows-1).
    expect(b.grid[1][3]).toBeGreaterThanOrEqual(0);
    // col2 was full — it can't take a bubble and reports as buried.
    expect(res.buried).toEqual([2]);
    expect(res.added.map((a) => a.c).sort()).toEqual([0, 1]);
    // One sprite spawned per added cell, each starting above the board.
    expect(b.sprites.length).toBe(2);
    for (const s of b.sprites) expect(s.y).toBeLessThan(0);
  });

  it("dropRow returns no buried columns while there is headroom", () => {
    const b = makeBoard([
      [-1, -1, -1, 1],
      [-1, -1, -1, 2],
    ]);
    const res = b.dropRow();
    expect(res.buried).toEqual([]);
    expect(res.added.length).toBe(2);
    // The stack climbed one row toward the ceiling.
    expect(b.topFilledRow()).toBe(2);
  });

  it("downpour bubbles are marked to fall slower than normal", () => {
    const b = makeBoard([
      [-1, -1, 0, 0],
      [-1, -1, -1, -1],
    ]);
    const res = b.dropRow();
    expect(res.added.length).toBeGreaterThan(0);
    for (const p of res.added) {
      const s = b.spriteGrid[p.c][p.r];
      expect(s).toBeTruthy();
      expect(s.fallMult).toBe(DOWNPOUR_FALL_MULT);
      expect(s.fallDur).toBe(DOWNPOUR_FALL_SECONDS);
      expect(s.delay).toBeGreaterThanOrEqual(0.12);
    }
  });

  it("downpour bubbles are still visibly falling before the slow duration ends", () => {
    const b = makeBoard([
      [-1, -1, 0, 0],
      [-1, -1, -1, -1],
    ]);
    const res = b.dropRow();
    const p = res.added[0];
    const s = b.spriteGrid[p.c][p.r];
    const target = b.targetPixel(p.c, p.r);
    s.delay = 0;
    b.update(DOWNPOUR_FALL_SECONDS * 0.45);
    expect(s.fallDur).toBeGreaterThan(0);
    expect(s.y).toBeLessThan(target.y - b.cell * 0.1);
    expect(b.isIdle()).toBe(false);

    b.update(DOWNPOUR_FALL_SECONDS);
    expect(b.isIdle()).toBe(true);
  });

  it("dropRow prefers colours that create bigger immediate groups", () => {
    const b = makeBoard([
      [-1, 2, 0, 0],
      [-1, -1, 1, 0],
      [-1, 2, 1, 1],
    ]);
    b.dropRow();
    // The middle column drops into (1,1). Matching colour 2 connects to both
    // side neighbours on that row (group 3), which beats any other colour.
    expect(b.grid[1][1]).toBe(2);
  });

  it("topFilledRow reports the highest occupied row, or rows when empty", () => {
    const empty = makeBoard([
      [-1, -1, -1],
      [-1, -1, -1],
    ]);
    expect(empty.topFilledRow()).toBe(3); // rows => board is clear
    const stacked = makeBoard([
      [-1, -1, 5], // top at row 2
      [-1, 4, 4], // top at row 1 (the highest across columns)
    ]);
    expect(stacked.topFilledRow()).toBe(1);
    const ceiling = makeBoard([
      [-1, -1, -1],
      [6, 6, 6], // a bubble sits on the very top edge
    ]);
    expect(ceiling.topFilledRow()).toBe(0);
  });
});

