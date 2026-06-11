// Board model: logic grid + animated bubble sprites.
// Grid is indexed [col][row]; row 0 is the top, bubbles fall toward higher rows.
import { makeRng } from "./rng.js";

let SPRITE_ID = 1;

// Bubble types (stored in a `types` grid parallel to the colour grid).
export const NORMAL = 0; // ordinary coloured bubble
export const ICE = 1; // frozen — needs two hits (cracks, then clears)
export const RAINBOW = 2; // wildcard — matches any adjacent colour
export const ICE_CRACKED = 3; // ice after one hit — one more clears it

export class Board {
  constructor(cols, rows, colorCount, seed, specials = null) {
    this.cols = cols;
    this.rows = rows;
    this.colorCount = colorCount;
    this.rng = makeRng(seed >>> 0);
    this.specials = specials || { ice: 0, rainbow: 0 };

    this.grid = []; // [c][r] => color index or -1
    this.types = []; // [c][r] => NORMAL | ICE | RAINBOW | ICE_CRACKED
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
    this._assignSpecials();
    this._buildSprites();
  }

  // Sprinkle special bubbles using the board's seeded RNG so it stays
  // deterministic. Rates come from the level config (0 disables a type).
  _assignSpecials() {
    const iceRate = this.specials.ice || 0;
    const rainbowRate = this.specials.rainbow || 0;
    this.types = [];
    for (let c = 0; c < this.cols; c++) {
      this.types[c] = [];
      for (let r = 0; r < this.rows; r++) {
        if (this.grid[c][r] === -1) {
          this.types[c][r] = NORMAL;
          continue;
        }
        const roll = this.rng();
        if (roll < rainbowRate) this.types[c][r] = RAINBOW;
        else if (roll < rainbowRate + iceRate) this.types[c][r] = ICE;
        else this.types[c][r] = NORMAL;
      }
    }
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
          type: (this.types[c] && this.types[c][r]) || NORMAL,
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

  // Return a plain 2D array of bubble types parallel to serialize().
  serializeTypes() {
    return this.types.map((col) => col.slice());
  }

  // Replace the colour grid (and optional type grid) from a saved snapshot and
  // rebuild sprites so the board appears exactly as it was, already settled.
  restore(grid2d, types2d) {
    this.grid = grid2d.map((col) => col.slice());
    this.types = types2d
      ? types2d.map((col) => col.slice())
      : this.grid.map((col) => col.map(() => NORMAL));
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
  isRainbow(c, r) {
    return this.types[c] && this.types[c][r] === RAINBOW;
  }

  // Flood-fill the connected group at (c,r). Rainbow bubbles act as wildcards:
  // they join a group of any colour and bridge same-coloured regions.
  getGroupAt(c, r) {
    if (this.grid[c][r] === -1) return [];

    // Determine the group's colour. Tapping a rainbow adopts a neighbour's
    // colour so it still pops something meaningful.
    let color = this.grid[c][r];
    if (this.isRainbow(c, r)) {
      color = this._firstColoredNeighbor(c, r);
    }

    const matches = (cc, rr) =>
      this.grid[cc][rr] !== -1 &&
      (this.isRainbow(cc, rr) || (color !== null && this.grid[cc][rr] === color));

    const seen = new Set();
    const stack = [[c, r]];
    const group = [];
    while (stack.length) {
      const [cc, rr] = stack.pop();
      const key = cc * this.rows + rr;
      if (seen.has(key)) continue;
      if (cc < 0 || cc >= this.cols || rr < 0 || rr >= this.rows) continue;
      if (!matches(cc, rr)) continue;
      seen.add(key);
      group.push({ c: cc, r: rr });
      stack.push([cc + 1, rr], [cc - 1, rr], [cc, rr + 1], [cc, rr - 1]);
    }
    return group;
  }

  // Colour of the first non-rainbow orthogonal neighbour (or null).
  _firstColoredNeighbor(c, r) {
    const n = [
      [c + 1, r],
      [c - 1, r],
      [c, r + 1],
      [c, r - 1],
    ];
    for (const [cc, rr] of n) {
      if (cc < 0 || cc >= this.cols || rr < 0 || rr >= this.rows) continue;
      if (this.grid[cc][rr] !== -1 && !this.isRainbow(cc, rr))
        return this.grid[cc][rr];
    }
    return null;
  }

  hasMoves() {
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < this.rows; r++) {
        const v = this.grid[c][r];
        if (v === -1) continue;
        // A rainbow next to any bubble is always a valid move.
        if (this.isRainbow(c, r)) {
          if (
            (c + 1 < this.cols && this.grid[c + 1][r] !== -1) ||
            (c - 1 >= 0 && this.grid[c - 1][r] !== -1) ||
            (r + 1 < this.rows && this.grid[c][r + 1] !== -1) ||
            (r - 1 >= 0 && this.grid[c][r - 1] !== -1)
          )
            return true;
        }
        if (c + 1 < this.cols && this.grid[c + 1][r] === v) return true;
        if (r + 1 < this.rows && this.grid[c][r + 1] === v) return true;
        if (c + 1 < this.cols && this.isRainbow(c + 1, r)) return true;
        if (r + 1 < this.rows && this.isRainbow(c, r + 1)) return true;
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
    const typeRow = [];
    let bubbles = 0;
    for (let c = 0; c < this.cols; c++) {
      gridRow.push(this.grid[c][r]);
      spriteRow.push(this.spriteGrid[c][r]);
      typeRow.push(this.types[c][r]);
      if (this.grid[c][r] !== -1) bubbles++;
    }
    if (bubbles === 0) return false;
    if (dir === "right") {
      gridRow.unshift(gridRow.pop());
      spriteRow.unshift(spriteRow.pop());
      typeRow.unshift(typeRow.pop());
    } else {
      gridRow.push(gridRow.shift());
      spriteRow.push(spriteRow.shift());
      typeRow.push(typeRow.shift());
    }
    for (let c = 0; c < this.cols; c++) {
      this.grid[c][r] = gridRow[c];
      this.spriteGrid[c][r] = spriteRow[c];
      this.types[c][r] = typeRow[c];
      if (spriteRow[c]) spriteRow[c].c = c;
    }
    return true;
  }

  // Remove a set of cells, returning the pixel positions + colours of the ones
  // that actually cleared (for FX). Ice bubbles crack on the first hit and only
  // clear on the second, so they are not removed here while still frozen.
  removeCells(cells, theme) {
    const fx = [];
    for (const { c, r } of cells) {
      const s = this.spriteGrid[c][r];
      const t = this.types[c][r];
      if (t === ICE) {
        // First hit: crack the ice but keep the bubble on the board.
        this.types[c][r] = ICE_CRACKED;
        if (s) {
          s.type = ICE_CRACKED;
          s.scale = 1.18; // little shudder
        }
        continue;
      }
      if (s) {
        s.state = "pop";
        s.t = 0;
        fx.push({ x: s.x, y: s.y, colorIndex: s.color });
      }
      this.grid[c][r] = -1;
      this.types[c][r] = NORMAL;
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
            this.types[c][writeR] = this.types[c][r];
            this.types[c][r] = NORMAL;
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
            this.types[writeC][r] = this.types[c][r];
            this.types[c][r] = NORMAL;
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
