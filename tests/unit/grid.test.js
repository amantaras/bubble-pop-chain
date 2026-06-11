import { describe, it, expect } from "vitest";
import { Board } from "../../src/grid.js";

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

  it("shuffle preserves the colour multiset and yields a solvable board", () => {
    const b = new Board(6, 8, 4, 999);
    const before = b.countRemaining();
    const histBefore = colourHistogram(b);
    b.shuffle();
    expect(b.countRemaining()).toBe(before);
    expect(colourHistogram(b)).toEqual(histBefore);
    expect(b.hasMoves()).toBe(true);
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
