import { describe, it, expect } from "vitest";
import { Board, NORMAL, ICE, RAINBOW, ICE_CRACKED } from "../../src/grid.js";

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
