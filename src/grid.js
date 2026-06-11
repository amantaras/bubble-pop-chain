// Board model: logic grid + animated bubble sprites.
// Grid is indexed [col][row]; row 0 is the top, bubbles fall toward higher rows.
import { makeRng } from "./rng.js";

let SPRITE_ID = 1;

export class Board {
  constructor(cols, rows, colorCount, seed) {
    this.cols = cols;
    this.rows = rows;
    this.colorCount = colorCount;
    this.rng = makeRng(seed >>> 0);

    this.grid = []; // [c][r] => color index or -1
    this.spriteGrid = []; // [c][r] => sprite ref or null
    this.sprites = [];

    // Pixel layout (set by layout()).
    this.cell = 40;
    this.originX = 0;
    this.originY = 0;
    this.boardW = 0;
    this.boardH = 0;

    this._generate();
  }

  // ---- Generation -------------------------------------------------------
  _generate() {
    let attempts = 0;
    do {
      this.grid = [];
      for (let c = 0; c < this.cols; c++) {
        this.grid[c] = [];
        for (let r = 0; r < this.rows; r++) {
          this.grid[c][r] = Math.floor(this.rng() * this.colorCount);
        }
      }
      attempts++;
    } while (!this.hasMoves() && attempts < 50);
    this._buildSprites();
  }

  _buildSprites() {
    this.sprites = [];
    this.spriteGrid = [];
    for (let c = 0; c < this.cols; c++) {
      this.spriteGrid[c] = [];
      for (let r = 0; r < this.rows; r++) {
        if (this.grid[c][r] === -1) {
          this.spriteGrid[c][r] = null;
          continue;
        }
        const s = {
          id: SPRITE_ID++,
          color: this.grid[c][r],
          c,
          r,
          x: 0,
          y: 0,
          scale: 1,
          alpha: 1,
          state: "idle", // 'idle' | 'pop'
          t: 0,
          delay: c * 0.012 + (this.rows - r) * 0.02, // drop-in stagger
        };
        this.spriteGrid[c][r] = s;
        this.sprites.push(s);
      }
    }
    this._initSpritePositions();
  }

  // ---- Save / restore ---------------------------------------------------
  // Return a plain 2D array of colour indices (-1 for empty) for persistence.
  serialize() {
    return this.grid.map((col) => col.slice());
  }

  // Replace the colour grid from a saved snapshot and rebuild sprites so the
  // board appears exactly as it was, already settled (no drop-in animation).
  restore(grid2d) {
    this.grid = grid2d.map((col) => col.slice());
    this._buildSprites();
    this.snapToTargets();
    return this;
  }

  // Place every sprite at its resting target position (used when resuming).
  snapToTargets() {
    for (const s of this.sprites) {
      const t = this.targetPixel(s.c, s.r);
      s.x = t.x;
      s.y = t.y;
      s.scale = 1;
      s.alpha = 1;
      s.state = "idle";
      s.t = 0;
      s.delay = 0;
    }
  }

  _initSpritePositions() {
    for (const s of this.sprites) {
      const t = this.targetPixel(s.c, s.r);
      s.x = t.x;
      s.y = t.y - this.boardH - 80; // start above the board for a drop-in
    }
  }

  // ---- Layout -----------------------------------------------------------
  layout(canvasW, canvasH, topInset, bottomInset) {
    const padX = 14;
    const availW = canvasW - padX * 2;
    const availH = canvasH - topInset - bottomInset;
    this.cell = Math.floor(
      Math.min(availW / this.cols, availH / this.rows)
    );
    this.boardW = this.cell * this.cols;
    this.boardH = this.cell * this.rows;
    this.originX = Math.round((canvasW - this.boardW) / 2);
    this.originY = Math.round(topInset + (availH - this.boardH) / 2);

    // Snap idle sprites that have not been positioned yet.
    for (const s of this.sprites) {
      if (s.x === 0 && s.y === 0) {
        const t = this.targetPixel(s.c, s.r);
        s.x = t.x;
        s.y = t.y - this.boardH - 80;
      }
    }
  }

  targetPixel(c, r) {
    return {
      x: this.originX + c * this.cell + this.cell / 2,
      y: this.originY + r * this.cell + this.cell / 2,
    };
  }

  // Convert a pixel position to a grid cell (or null if outside).
  cellAtPixel(px, py) {
    const c = Math.floor((px - this.originX) / this.cell);
    const r = Math.floor((py - this.originY) / this.cell);
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return null;
    if (this.grid[c][r] === -1) return null;
    return { c, r };
  }

  // Row index under a pixel Y (ignores column / emptiness), or null if outside.
  rowAtPixel(py) {
    const r = Math.floor((py - this.originY) / this.cell);
    if (r < 0 || r >= this.rows) return null;
    return r;
  }

  // ---- Queries ----------------------------------------------------------
  getGroupAt(c, r) {
    const color = this.grid[c][r];
    if (color === -1) return [];
    const seen = new Set();
    const stack = [[c, r]];
    const group = [];
    while (stack.length) {
      const [cc, rr] = stack.pop();
      const key = cc * this.rows + rr;
      if (seen.has(key)) continue;
      if (cc < 0 || cc >= this.cols || rr < 0 || rr >= this.rows) continue;
      if (this.grid[cc][rr] !== color) continue;
      seen.add(key);
      group.push({ c: cc, r: rr });
      stack.push([cc + 1, rr], [cc - 1, rr], [cc, rr + 1], [cc, rr - 1]);
    }
    return group;
  }

  hasMoves() {
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < this.rows; r++) {
        const v = this.grid[c][r];
        if (v === -1) continue;
        if (c + 1 < this.cols && this.grid[c + 1][r] === v) return true;
        if (r + 1 < this.rows && this.grid[c][r + 1] === v) return true;
      }
    }
    return false;
  }

  countRemaining() {
    let n = 0;
    for (let c = 0; c < this.cols; c++)
      for (let r = 0; r < this.rows; r++) if (this.grid[c][r] !== -1) n++;
    return n;
  }

  isCleared() {
    return this.countRemaining() === 0;
  }

  // ---- Mutations --------------------------------------------------------
  // Shift an entire row horizontally with wrap-around (2048-style).
  // `dir` is "left" or "right". Returns true if the row had any bubbles.
  shiftRow(r, dir) {
    if (r < 0 || r >= this.rows) return false;
    const gridRow = [];
    const spriteRow = [];
    let bubbles = 0;
    for (let c = 0; c < this.cols; c++) {
      gridRow.push(this.grid[c][r]);
      spriteRow.push(this.spriteGrid[c][r]);
      if (this.grid[c][r] !== -1) bubbles++;
    }
    if (bubbles === 0) return false;
    if (dir === "right") {
      gridRow.unshift(gridRow.pop());
      spriteRow.unshift(spriteRow.pop());
    } else {
      gridRow.push(gridRow.shift());
      spriteRow.push(spriteRow.shift());
    }
    for (let c = 0; c < this.cols; c++) {
      this.grid[c][r] = gridRow[c];
      this.spriteGrid[c][r] = spriteRow[c];
      if (spriteRow[c]) spriteRow[c].c = c;
    }
    return true;
  }

  // Remove a set of cells, returning their pixel positions + colors (for FX).
  removeCells(cells, theme) {
    const fx = [];
    for (const { c, r } of cells) {
      const s = this.spriteGrid[c][r];
      if (s) {
        s.state = "pop";
        s.t = 0;
        fx.push({ x: s.x, y: s.y, colorIndex: s.color });
      }
      this.grid[c][r] = -1;
      this.spriteGrid[c][r] = null;
    }
    return fx;
  }

  settle() {
    this._applyGravity();
    this._collapseColumns();
    this._refreshDelays();
  }

  _applyGravity() {
    for (let c = 0; c < this.cols; c++) {
      let writeR = this.rows - 1;
      for (let r = this.rows - 1; r >= 0; r--) {
        if (this.grid[c][r] !== -1) {
          if (r !== writeR) {
            this.grid[c][writeR] = this.grid[c][r];
            this.grid[c][r] = -1;
            const s = this.spriteGrid[c][r];
            this.spriteGrid[c][writeR] = s;
            this.spriteGrid[c][r] = null;
            if (s) s.r = writeR;
          }
          writeR--;
        }
      }
    }
  }

  _collapseColumns() {
    let writeC = 0;
    for (let c = 0; c < this.cols; c++) {
      const colEmpty = this.grid[c].every((v) => v === -1);
      if (!colEmpty) {
        if (c !== writeC) {
          for (let r = 0; r < this.rows; r++) {
            this.grid[writeC][r] = this.grid[c][r];
            this.grid[c][r] = -1;
            const s = this.spriteGrid[c][r];
            this.spriteGrid[writeC][r] = s;
            this.spriteGrid[c][r] = null;
            if (s) s.c = writeC;
          }
        }
        writeC++;
      }
    }
  }

  _refreshDelays() {
    for (const s of this.sprites) s.delay = 0;
  }

  // Bomb removes a 3x3 area centered on (c,r).
  bombArea(c, r) {
    const cells = [];
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || cc >= this.cols || rr < 0 || rr >= this.rows) continue;
        if (this.grid[cc][rr] !== -1) cells.push({ c: cc, r: rr });
      }
    }
    return cells;
  }

  // Charged Blast removes a filled diamond (Manhattan radius `rad`, default 2)
  // centered on (c,r) — a larger area than the 3x3 bomb.
  blastArea(c, r, rad = 2) {
    const cells = [];
    for (let dc = -rad; dc <= rad; dc++) {
      for (let dr = -rad; dr <= rad; dr++) {
        if (Math.abs(dc) + Math.abs(dr) > rad) continue;
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || cc >= this.cols || rr < 0 || rr >= this.rows) continue;
        if (this.grid[cc][rr] !== -1) cells.push({ c: cc, r: rr });
      }
    }
    return cells;
  }

  // Color clear removes every cell of a given color.
  colorCells(color) {
    const cells = [];
    for (let c = 0; c < this.cols; c++)
      for (let r = 0; r < this.rows; r++)
        if (this.grid[c][r] === color) cells.push({ c, r });
    return cells;
  }

  // Reshuffle colors of remaining bubbles until at least one move exists.
  shuffle() {
    const colors = [];
    const positions = [];
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < this.rows; r++) {
        if (this.grid[c][r] !== -1) {
          colors.push(this.grid[c][r]);
          positions.push({ c, r });
        }
      }
    }
    let attempts = 0;
    do {
      // Fisher–Yates shuffle.
      for (let i = colors.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [colors[i], colors[j]] = [colors[j], colors[i]];
      }
      positions.forEach((p, i) => (this.grid[p.c][p.r] = colors[i]));
      attempts++;
    } while (!this.hasMoves() && attempts < 50);

    // Apply colors to sprites and pulse them.
    positions.forEach((p) => {
      const s = this.spriteGrid[p.c][p.r];
      if (s) {
        s.color = this.grid[p.c][p.r];
        s.scale = 0.6;
        s.state = "idle";
      }
    });
  }

  // ---- Animation update -------------------------------------------------
  update(dt) {
    const smooth = 1 - Math.exp(-dt * 13);
    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const s = this.sprites[i];

      if (s.state === "pop") {
        s.t += dt;
        const dur = 0.2;
        const k = Math.min(1, s.t / dur);
        s.scale = 1 + 0.4 * k - 1.4 * Math.max(0, k - 0.3);
        s.alpha = 1 - k;
        if (k >= 1) {
          this.sprites.splice(i, 1);
        }
        continue;
      }

      if (s.delay > 0) {
        s.delay -= dt;
        continue;
      }

      const t = this.targetPixel(s.c, s.r);
      s.x += (t.x - s.x) * smooth;
      s.y += (t.y - s.y) * smooth;
      if (s.scale < 1) s.scale += (1 - s.scale) * smooth;
      else s.scale = 1;
    }
  }

  // True when no pop animations are still playing.
  isIdle() {
    return !this.sprites.some((s) => s.state === "pop");
  }
}
