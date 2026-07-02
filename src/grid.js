// Board model: logic grid + animated bubble sprites.
// Grid is indexed [col][row]; row 0 is the top, bubbles fall toward higher rows.
import { makeRng } from "./rng.js";

let SPRITE_ID = 1;

// Bubble types (stored in a `types` grid parallel to the colour grid).
export const NORMAL = 0; // ordinary coloured bubble
export const ICE = 1; // frozen — needs two hits (cracks, then clears)
export const RAINBOW = 2; // wildcard — matches any adjacent colour
export const ICE_CRACKED = 3; // ice after one hit — one more clears it
export const LIGHTNING = 4; // charged — popping its group also clears row+col
export const STONE = 5; // locked — can't be tapped; only an adjacent pop (or
//                         AoE/lightning) shatters it. Never joins a colour group.
export const BOMB = 6; // explosive — popping its group also detonates a 3×3
//                        area around each bomb. A normal coloured bubble for
//                        matching purposes (like LIGHTNING), it just adds AoE.
export const MULTIPLIER = 7; // gold — popping its group multiplies that pop's
//                              score (×2 per multiplier, stacking, capped). A
//                              normal coloured bubble for matching; no AoE.
export const COIN = 8; // treasure — popping its group drops bonus coins. A
//                        normal coloured bubble for matching; no AoE.
export const VINE = 9; // creeping threat — every resolved move it spreads into
//                        an adjacent ordinary bubble. Pop its cluster to clear
//                        it. A normal coloured bubble for matching; no AoE.

const COLORED_POP_TYPES = new Set([NORMAL, LIGHTNING, BOMB, MULTIPLIER, COIN, VINE]);

// How long a magnet-pulled bubble takes to glide to its new cell (seconds).
// Deliberately slower than the snappy gravity settle so the player can see the
// bubbles physically travel and re-locate across the board.
export const MAGNET_GLIDE = 0.6;
// Downpour row-in bubbles should be readable and fair: fall slower than the
// normal snappy board follow so players can react before the stack settles.
export const DOWNPOUR_FALL_MULT = 0.45;
export const DOWNPOUR_FALL_SECONDS = 3.8;

export class Board {
  constructor(cols, rows, colorCount, seed, specials = null) {
    this.cols = cols;
    this.rows = rows;
    this.colorCount = colorCount;
    this.rng = makeRng(seed >>> 0);
    this.specials = specials || { ice: 0, rainbow: 0, lightning: 0 };

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
    const lightningRate = this.specials.lightning || 0;
    const stoneRate = this.specials.stone || 0;
    const bombRate = this.specials.bomb || 0;
    const multRate = this.specials.multiplier || 0;
    const coinRate = this.specials.coin || 0;
    const vineRate = this.specials.vine || 0;
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
        else if (roll < rainbowRate + iceRate + lightningRate)
          this.types[c][r] = LIGHTNING;
        else if (roll < rainbowRate + iceRate + lightningRate + stoneRate)
          this.types[c][r] = STONE;
        else if (
          roll <
          rainbowRate + iceRate + lightningRate + stoneRate + bombRate
        )
          this.types[c][r] = BOMB;
        else if (
          roll <
          rainbowRate + iceRate + lightningRate + stoneRate + bombRate + multRate
        )
          this.types[c][r] = MULTIPLIER;
        else if (
          roll <
          rainbowRate +
            iceRate +
            lightningRate +
            stoneRate +
            bombRate +
            multRate +
            coinRate
        )
          this.types[c][r] = COIN;
        else if (
          roll <
          rainbowRate +
            iceRate +
            lightningRate +
            stoneRate +
            bombRate +
            multRate +
            coinRate +
            vineRate
        )
          this.types[c][r] = VINE;
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
      s.glideDur = 0;
      s.fallDur = 0;
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

  // Row to shift for a horizontal swipe. When a sparse board has just settled,
  // sprites can still be visibly falling through now-empty rows while the logic
  // grid already points at their final rows; map that visible swipe back to the
  // bubble's logical row so quick follow-up swipes still work.
  rowAtSwipePixel(py) {
    const r = this.rowAtPixel(py);
    if (r === null) return null;
    for (let c = 0; c < this.cols; c++) {
      if (this.grid[c][r] !== -1) return r;
    }
    let best = null;
    let bestDist = Infinity;
    const halfCell = this.cell / 2;
    for (const s of this.sprites) {
      if (!s || s.state === "pop" || s.alpha <= 0) continue;
      if (s.r < 0 || s.r >= this.rows) continue;
      const dist = Math.abs(s.y - py);
      if (dist <= halfCell && dist < bestDist) {
        best = s.r;
        bestDist = dist;
      }
    }
    return best;
  }

  // Column index under a pixel X, clamped to the board (used by the Nova
  // gunship to aim straight up from wherever it is patrolling).
  columnAtPixel(px) {
    const c = Math.floor((px - this.originX) / this.cell);
    return Math.max(0, Math.min(this.cols - 1, c));
  }

  // The lowest filled cell in a column (largest r with a bubble), or null if
  // the column is empty. This is the bubble the gunship's shot would hit first.
  bottomBubble(c) {
    if (c < 0 || c >= this.cols) return null;
    for (let r = this.rows - 1; r >= 0; r--) {
      if (this.grid[c][r] !== -1) return { c, r };
    }
    return null;
  }

  // The bottom `height` bubbles across the columns within `halfW` of `centerCol`
  // — the area a Nova nuke clears. Returns a de-duplicated list of {c,r}.
  bottomBlock(centerCol, halfW = 1, height = 2) {
    const cells = [];
    const lo = Math.max(0, centerCol - halfW);
    const hi = Math.min(this.cols - 1, centerCol + halfW);
    for (let c = lo; c <= hi; c++) {
      let taken = 0;
      for (let r = this.rows - 1; r >= 0 && taken < height; r--) {
        if (this.grid[c][r] !== -1) {
          cells.push({ c, r });
          taken++;
        }
      }
    }
    return cells;
  }

  // ---- Queries ----------------------------------------------------------
  isRainbow(c, r) {
    return this.types[c] && this.types[c][r] === RAINBOW;
  }

  isLightning(c, r) {
    return this.types[c] && this.types[c][r] === LIGHTNING;
  }

  isStone(c, r) {
    return this.types[c] && this.types[c][r] === STONE;
  }

  isBomb(c, r) {
    return this.types[c] && this.types[c][r] === BOMB;
  }

  isMultiplier(c, r) {
    return this.types[c] && this.types[c][r] === MULTIPLIER;
  }

  isCoin(c, r) {
    return this.types[c] && this.types[c][r] === COIN;
  }

  isVine(c, r) {
    return this.types[c] && this.types[c][r] === VINE;
  }

  _isColoredPopTarget(c, r) {
    return this.grid[c]?.[r] !== -1 && COLORED_POP_TYPES.has(this.types[c]?.[r]);
  }

  // How many vine (creeping threat) bubbles are currently on the board.
  vineCount() {
    let n = 0;
    for (let c = 0; c < this.cols; c++)
      for (let r = 0; r < this.rows; r++) if (this.isVine(c, r)) n++;
    return n;
  }

  // Vine threat: sprout ONE new vine from an existing vine into an
  // orthogonally-adjacent ordinary bubble. Deterministic via the board rng so
  // replays stay reproducible. Growth is capped at one cell per call so the
  // board always stays solvable — the player stops the creep by popping the
  // vine cluster. The new vine keeps the colour already in that cell, so it
  // still matches its neighbours like any coloured bubble. Returns the {c, r}
  // of the new vine, or null if nothing could spread (no vines, or no room).
  spreadVines() {
    const candidates = [];
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < this.rows; r++) {
        if (!this.isVine(c, r)) continue;
        const neigh = [
          [c + 1, r],
          [c - 1, r],
          [c, r + 1],
          [c, r - 1],
        ];
        for (const [cc, rr] of neigh) {
          if (cc < 0 || rr < 0 || cc >= this.cols || rr >= this.rows) continue;
          if (this.grid[cc][rr] === -1) continue; // empty cell
          if (this.types[cc][rr] !== NORMAL) continue; // only plain bubbles
          candidates.push([cc, rr]);
        }
      }
    }
    if (candidates.length === 0) return null;
    const pick = candidates[Math.floor(this.rng() * candidates.length)];
    this.types[pick[0]][pick[1]] = VINE;
    return { c: pick[0], r: pick[1] };
  }

  // ---- Downpour (advanced levels) --------------------------------------
  // Pick the most player-helpful colour for a downpour bubble at (c,r): try
  // every available colour and choose the one that creates the largest
  // immediate connected group at that cell. Ties are broken with board RNG so
  // behaviour stays deterministic per seed.
  _bestDownpourColor(c, r) {
    let bestScore = -1;
    const best = [];
    for (let color = 0; color < this.colorCount; color++) {
      this.grid[c][r] = color;
      this.types[c][r] = NORMAL;
      const score = this.getGroupAt(c, r).length;
      if (score > bestScore) {
        bestScore = score;
        best.length = 0;
        best.push(color);
      } else if (score === bestScore) {
        best.push(color);
      }
    }
    // Reset temporary probe cell; caller writes the final choice next.
    this.grid[c][r] = -1;
    this.types[c][r] = NORMAL;
    if (best.length === 0) return 0;
    return best[Math.floor(this.rng() * best.length)];
  }

  // Tetris-style pressure: drop a fresh row of ordinary bubbles in from the top.
  // Each column gets one new bubble resting directly on top of its stack; the
  // new sprites start above the board so they visibly fall into place. A column
  // whose stack already reaches the very top (row 0 occupied) has no room — it
  // "buries" the player. Returns { added:[{c,r}], buried:[c,...] } so the caller
  // can play the drop cue and end the level when any column overflowed.
  dropRow() {
    const added = [];
    const buried = [];
    for (let c = 0; c < this.cols; c++) {
      // The top of this column's stack: the smallest r that holds a bubble.
      let top = this.rows; // rows => column is empty
      for (let r = 0; r < this.rows; r++) {
        if (this.grid[c][r] !== -1) {
          top = r;
          break;
        }
      }
      const dest = top - 1; // the empty cell directly above the stack
      if (dest < 0) {
        buried.push(c); // stack already reaches the top — no room to drop
        continue;
      }
      const color = this._bestDownpourColor(c, dest);
      this.grid[c][dest] = color;
      this.types[c][dest] = NORMAL;
      const t = this.targetPixel(c, dest);
      const rainStartY = t.y - this.boardH * 1.4 - 120;
      const s = {
        id: SPRITE_ID++,
        color,
        type: NORMAL,
        c,
        r: dest,
        x: t.x,
        y: rainStartY, // start well above the board for a longer visible fall
        scale: 1,
        alpha: 1,
        state: "idle",
        t: 0,
        // Give rain a gentler cadence so the new row is readable under pressure.
        delay: 0.2 + c * 0.12,
        fallMult: DOWNPOUR_FALL_MULT,
        fallT: 0,
        fallDur: DOWNPOUR_FALL_SECONDS,
        fy0: rainStartY,
        glideDur: 0,
      };
      this.spriteGrid[c][dest] = s;
      this.sprites.push(s);
      added.push({ c, r: dest });
    }
    return { added, buried };
  }

  // The topmost occupied row across all columns (0 = a bubble sits on the very
  // top edge), or `rows` when the board is empty. Drives the danger-line cue:
  // the closer this gets to 0, the nearer the player is to being buried.
  topFilledRow() {
    let top = this.rows;
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < top; r++) {
        if (this.grid[c][r] !== -1) {
          top = r;
          break;
        }
      }
      if (top === 0) break;
    }
    return top;
  }

  // Expand a popped group: if it contains any LIGHTNING bubble, every lightning
  // cell discharges along its full row and column (via crossCells), and those
  // cells are merged into the cleared set (deduped). Returns the full cell list
  // to remove. When the group has no lightning, the group is returned as-is.
  lightningStrike(group) {
    const hasBolt = group.some((p) => this.isLightning(p.c, p.r));
    if (!hasBolt) return group;
    const seen = new Set();
    const out = [];
    const add = (cell) => {
      const k = cell.c * this.rows + cell.r;
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ c: cell.c, r: cell.r });
    };
    group.forEach(add);
    for (const p of group) {
      if (this.isLightning(p.c, p.r)) this.crossCells(p.c, p.r).forEach(add);
    }
    return out;
  }

  // Expand a popped group: if it contains any BOMB bubble, every bomb cell
  // detonates a 3×3 area (via bombArea), and those cells are merged into the
  // cleared set (deduped). Returns the full cell list to remove. When the group
  // has no bomb, the group is returned as-is.
  bombStrike(group) {
    const hasBomb = group.some((p) => this.isBomb(p.c, p.r));
    if (!hasBomb) return group;
    const seen = new Set();
    const out = [];
    const add = (cell) => {
      const k = cell.c * this.rows + cell.r;
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ c: cell.c, r: cell.r });
    };
    group.forEach(add);
    for (const p of group) {
      if (this.isBomb(p.c, p.r)) this.bombArea(p.c, p.r).forEach(add);
    }
    return out;
  }

  // Flood-fill the connected group at (c,r). Rainbow bubbles act as wildcards:
  // they join a group of any colour and bridge same-coloured regions.
  getGroupAt(c, r) {
    if (this.grid[c][r] === -1) return [];
    // Stone bubbles are locked: they never form or join a poppable group.
    if (this.isStone(c, r)) return [];

    // Determine the group's colour. Tapping a rainbow adopts a neighbour's
    // colour so it still pops something meaningful.
    let color = this.grid[c][r];
    if (this.isRainbow(c, r)) {
      color = this._firstColoredNeighbor(c, r);
    }

    const matches = (cc, rr) =>
      this.grid[cc][rr] !== -1 &&
      !this.isStone(cc, rr) &&
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
      if (this.grid[cc][rr] !== -1 && !this.isRainbow(cc, rr) && !this.isStone(cc, rr))
        return this.grid[cc][rr];
    }
    return null;
  }

  hasMoves() {
    return this._gridHasMoves(this.grid, this.types);
  }

  // Pure-data tap-move test over a {grid, types} snapshot (no sprites). Shared
  // by hasMoves() and the swipe look-ahead in hasShiftMove() so both stay in
  // perfect sync. A move exists when two same-colour bubbles are orthogonally
  // adjacent, or a rainbow sits next to any bubble.
  _gridHasMoves(grid, types) {
    const cols = grid.length;
    const rows = grid[0].length;
    const isR = (c, r) => !!(types && types[c] && types[c][r] === RAINBOW);
    const isS = (c, r) => !!(types && types[c] && types[c][r] === STONE);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const v = grid[c][r];
        if (v === -1) continue;
        // Stone bubbles are locked and can never be the origin of a move.
        if (isS(c, r)) continue;
        // A rainbow next to any (non-stone) bubble is always a valid move.
        if (isR(c, r)) {
          if (
            (c + 1 < cols && grid[c + 1][r] !== -1 && !isS(c + 1, r)) ||
            (c - 1 >= 0 && grid[c - 1][r] !== -1 && !isS(c - 1, r)) ||
            (r + 1 < rows && grid[c][r + 1] !== -1 && !isS(c, r + 1)) ||
            (r - 1 >= 0 && grid[c][r - 1] !== -1 && !isS(c, r - 1))
          )
            return true;
        }
        if (c + 1 < cols && grid[c + 1][r] === v && !isS(c + 1, r)) return true;
        if (r + 1 < rows && grid[c][r + 1] === v && !isS(c, r + 1)) return true;
        if (c + 1 < cols && isR(c + 1, r)) return true;
        if (r + 1 < rows && isR(c, r + 1)) return true;
      }
    }
    return false;
  }

  // True when at least one available row-shift (a left/right swipe) would, after
  // the board settles, create a poppable group. The deadlock check uses this so
  // a level is never declared stuck while a swipe could still realign lone
  // bubbles into a fresh match. Pure data — never touches sprites.
  hasShiftMove() {
    for (let r = 0; r < this.rows; r++) {
      let bubbles = 0;
      for (let c = 0; c < this.cols; c++) if (this.grid[c][r] !== -1) bubbles++;
      if (bubbles === 0) continue; // empty row: shifting does nothing
      for (const dir of ["left", "right"]) {
        const grid = this.grid.map((col) => col.slice());
        const types = this.types.map((col) => col.slice());
        this._simShiftRow(grid, types, r, dir);
        this._simSettle(grid, types);
        if (this._gridHasMoves(grid, types)) return true;
      }
    }
    return false;
  }

  // Wrap-around row shift on a {grid, types} snapshot (mirrors shiftRow).
  _simShiftRow(grid, types, r, dir) {
    const cols = grid.length;
    const gr = [];
    const tr = [];
    for (let c = 0; c < cols; c++) {
      gr.push(grid[c][r]);
      tr.push(types[c][r]);
    }
    if (dir === "right") {
      gr.unshift(gr.pop());
      tr.unshift(tr.pop());
    } else {
      gr.push(gr.shift());
      tr.push(tr.shift());
    }
    for (let c = 0; c < cols; c++) {
      grid[c][r] = gr[c];
      types[c][r] = tr[c];
    }
  }

  // Gravity + empty-column collapse on a {grid, types} snapshot (mirrors
  // _applyGravity + _collapseColumns, without sprite bookkeeping).
  _simSettle(grid, types) {
    const cols = grid.length;
    const rows = grid[0].length;
    for (let c = 0; c < cols; c++) {
      let writeR = rows - 1;
      for (let r = rows - 1; r >= 0; r--) {
        if (grid[c][r] !== -1) {
          if (r !== writeR) {
            grid[c][writeR] = grid[c][r];
            grid[c][r] = -1;
            types[c][writeR] = types[c][r];
            types[c][r] = NORMAL;
          }
          writeR--;
        }
      }
    }
    let writeC = 0;
    for (let c = 0; c < cols; c++) {
      const colEmpty = grid[c].every((v) => v === -1);
      if (!colEmpty) {
        if (c !== writeC) {
          for (let r = 0; r < rows; r++) {
            grid[writeC][r] = grid[c][r];
            grid[c][r] = -1;
            types[writeC][r] = types[c][r];
            types[c][r] = NORMAL;
          }
        }
        writeC++;
      }
    }
  }

  // The single best tap-move available: the cells of the largest connected
  // poppable group (>= 2, counting rainbow wildcards), or null when no tap-move
  // exists. Powers the idle "hint" assist that nudges a stuck player.
  findHint() {
    let best = null;
    const seen = new Set();
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < this.rows; r++) {
        if (this.grid[c][r] === -1) continue;
        const key = c * this.rows + r;
        if (seen.has(key)) continue;
        const group = this.getGroupAt(c, r);
        for (const p of group) seen.add(p.c * this.rows + p.r);
        if (group.length >= 2 && (!best || group.length > best.length))
          best = group;
      }
    }
    return best;
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

  // The first (top-left-most) filled cell, or null when the board is empty.
  // Used by the last-bubble finale to locate the single leftover bubble.
  firstFilledCell() {
    for (let c = 0; c < this.cols; c++)
      for (let r = 0; r < this.rows; r++)
        if (this.grid[c][r] !== -1) return { c, r };
    return null;
  }

  // Force-remove a single bubble regardless of its type (ice included),
  // returning its pop FX `{ x, y, colorIndex }` (or null if the cell was empty).
  // Unlike removeCells, ice is cleared outright rather than merely cracked — the
  // last-bubble finale must truly empty the board.
  forceRemove(c, r) {
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return null;
    if (this.grid[c][r] === -1) return null;
    const s = this.spriteGrid[c][r];
    let fx = null;
    if (s) {
      s.state = "pop";
      s.t = 0;
      fx = { x: s.x, y: s.y, colorIndex: s.color };
    }
    this.grid[c][r] = -1;
    this.types[c][r] = NORMAL;
    this.spriteGrid[c][r] = null;
    return fx;
  }

  // Count the bubbles still frozen (used by the boss "shatter the core"
  // objective). Both intact and cracked ice count as unbroken.
  frozenRemaining() {
    let n = 0;
    for (let c = 0; c < this.cols; c++)
      for (let r = 0; r < this.rows; r++) {
        const t = this.types[c][r];
        if (t === ICE || t === ICE_CRACKED) n++;
      }
    return n;
  }

  // Compute the centred bounding box used by placeFrozenCore/placeStoneVault/
  // placeVineCore, without mutating the board. Pure — lets the renderer draw a
  // unifying "boss focus" highlight around the seeded core regardless of which
  // archetype seeded it (frozen/stone/vine all share one aura treatment).
  coreBounds(w, h) {
    const c0 = Math.floor((this.cols - w) / 2);
    const r0 = Math.floor((this.rows - h) / 2);
    return { c0, r0, w, h };
  }

  // Freeze a centred block of bubbles into ice for a boss objective. Returns the
  // number of cells actually frozen. Empty cells are skipped.
  placeFrozenCore(coreW, coreH) {
    const c0 = Math.floor((this.cols - coreW) / 2);
    const r0 = Math.floor((this.rows - coreH) / 2);
    let n = 0;
    for (let c = c0; c < c0 + coreW; c++) {
      for (let r = r0; r < r0 + coreH; r++) {
        if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) continue;
        if (this.grid[c][r] === -1) continue;
        this.types[c][r] = ICE;
        const sp = this.spriteGrid[c][r];
        if (sp) sp.type = ICE;
        n++;
      }
    }
    return n;
  }

  // Count the locked stone bubbles still on the board (used by the boss "stone
  // vault" objective).
  stoneRemaining() {
    let n = 0;
    for (let c = 0; c < this.cols; c++)
      for (let r = 0; r < this.rows; r++)
        if (this.types[c][r] === STONE) n++;
    return n;
  }

  // Lock a centred block of bubbles into stone for a boss objective. Returns the
  // number of cells actually locked. Empty cells are skipped.
  placeStoneVault(vaultW, vaultH) {
    const c0 = Math.floor((this.cols - vaultW) / 2);
    const r0 = Math.floor((this.rows - vaultH) / 2);
    let n = 0;
    for (let c = c0; c < c0 + vaultW; c++) {
      for (let r = r0; r < r0 + vaultH; r++) {
        if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) continue;
        if (this.grid[c][r] === -1) continue;
        this.types[c][r] = STONE;
        const sp = this.spriteGrid[c][r];
        if (sp) sp.type = STONE;
        n++;
      }
    }
    return n;
  }

  // Tag a centred block of bubbles as vine for the "Vine Overgrowth" boss
  // objective. Unlike frozen/stone, vine cells keep matching/popping as their
  // existing colour (see `isVine`) and the cluster still creeps one cell per
  // resolved move via `spreadVines` — the player races to clear it before it
  // overtakes the board. Returns the number of cells actually tagged. Empty
  // cells are skipped.
  placeVineCore(vineW, vineH) {
    const c0 = Math.floor((this.cols - vineW) / 2);
    const r0 = Math.floor((this.rows - vineH) / 2);
    let n = 0;
    for (let c = c0; c < c0 + vineW; c++) {
      for (let r = r0; r < r0 + vineH; r++) {
        if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) continue;
        if (this.grid[c][r] === -1) continue;
        this.types[c][r] = VINE;
        const sp = this.spriteGrid[c][r];
        if (sp) sp.type = VINE;
        n++;
      }
    }
    return n;
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
    const removed = [];
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
      removed.push({ c, r });
    }
    // Locked STONE bubbles shatter from the shockwave of any adjacent pop. Only
    // stones next to a cell that actually cleared this turn break, and each
    // breaks at most once (no chain reaction through a wall of stone).
    const seen = new Set();
    for (const { c, r } of removed) {
      for (const [cc, rr] of [
        [c + 1, r],
        [c - 1, r],
        [c, r + 1],
        [c, r - 1],
      ]) {
        if (cc < 0 || cc >= this.cols || rr < 0 || rr >= this.rows) continue;
        if (this.types[cc][rr] !== STONE) continue;
        const k = cc * this.rows + rr;
        if (seen.has(k)) continue;
        seen.add(k);
        const ss = this.spriteGrid[cc][rr];
        if (ss) {
          ss.state = "pop";
          ss.t = 0;
          fx.push({ x: ss.x, y: ss.y, colorIndex: ss.color });
        }
        this.grid[cc][rr] = -1;
        this.types[cc][rr] = NORMAL;
        this.spriteGrid[cc][rr] = null;
      }
    }
    fx.stonesBroken = seen.size;
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
            if (s) {
              s.r = writeR;
              s.glideDur = 0; // gravity overrides any in-progress magnet glide
            }
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
            if (s) {
              s.c = writeC;
              s.glideDur = 0; // gravity overrides any in-progress magnet glide
            }
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

  canRecolor(c, r) {
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return false;
    if (this.grid[c][r] === -1) return false;
    const t = this.types[c] && this.types[c][r];
    return t !== STONE && t !== RAINBOW;
  }

  recolorCell(c, r, color) {
    if (!this.canRecolor(c, r)) return false;
    const next = Math.max(0, Math.min(this.colorCount - 1, Number(color) || 0));
    if (this.grid[c][r] === next) return false;
    this.grid[c][r] = next;
    const s = this.spriteGrid[c] && this.spriteGrid[c][r];
    if (s) s.color = next;
    return true;
  }

  suggestRecolors(c, r, count = 3) {
    if (!this.canRecolor(c, r)) return [];
    const current = this.grid[c][r];
    const out = [];
    const dirs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    for (let color = 0; color < this.colorCount; color++) {
      if (color === current) continue;
      this.grid[c][r] = color;
      const groupSize = this.getGroupAt(c, r).length;
      let adjacent = 0;
      for (const [dc, dr] of dirs) {
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || cc >= this.cols || rr < 0 || rr >= this.rows) continue;
        if (this.grid[cc][rr] === color || this.isRainbow(cc, rr)) adjacent++;
      }
      out.push({
        color,
        groupSize,
        adjacent,
        totalColor: this.colorCells(color).length,
        createsMove: groupSize >= 2,
      });
    }
    this.grid[c][r] = current;
    out.sort(
      (a, b) =>
        b.groupSize - a.groupSize ||
        b.adjacent - a.adjacent ||
        b.totalColor - a.totalColor ||
        a.color - b.color
    );
    return out.slice(0, Math.max(0, count));
  }

  // The most common NORMAL (plain) bubble colour on the board, or null when
  // there are none. Used by the "gather" pet companion to pick a target.
  dominantColor() {
    const counts = {};
    let best = null;
    let bestN = 0;
    for (let c = 0; c < this.cols; c++)
      for (let r = 0; r < this.rows; r++) {
        if (this.grid[c][r] === -1 || this.types[c][r] !== NORMAL) continue;
        const v = this.grid[c][r];
        counts[v] = (counts[v] || 0) + 1;
        if (counts[v] > bestN) {
          bestN = counts[v];
          best = v;
        }
      }
    return best;
  }

  // First NORMAL cell of a given colour (a valid magnet/gather anchor), or null.
  firstCellOfColor(color) {
    for (let c = 0; c < this.cols; c++)
      for (let r = 0; r < this.rows; r++)
        if (this.grid[c][r] === color && this.types[c][r] === NORMAL)
          return { c, r };
    return null;
  }

  // All NORMAL cells of a given colour (used by the gather pet animation to
  // reel scattered bubbles toward the anchor).
  cellsOfColor(color) {
    const out = [];
    for (let c = 0; c < this.cols; c++)
      for (let r = 0; r < this.rows; r++)
        if (this.grid[c][r] === color && this.types[c][r] === NORMAL)
          out.push({ c, r });
    return out;
  }

  // All coloured poppable cells of a given colour. Destructive pet clears use
  // this so a same-colour lightning/bomb/coin/vine bubble keeps its effect.
  clearableCellsOfColor(color) {
    const out = [];
    for (let c = 0; c < this.cols; c++)
      for (let r = 0; r < this.rows; r++)
        if (this.grid[c][r] === color && this._isColoredPopTarget(c, r))
          out.push({ c, r });
    return out;
  }

  // Lone, "difficult" bubbles: coloured poppable cells whose connected group is
  // just themselves (no same-colour neighbour and not bridged by a rainbow).
  // These are the hardest to clear, so the "cleanse" pet companion zaps them.
  isolatedCells() {
    const out = [];
    for (let c = 0; c < this.cols; c++)
      for (let r = 0; r < this.rows; r++) {
        if (!this._isColoredPopTarget(c, r)) continue;
        if (this.getGroupAt(c, r).length === 1) out.push({ c, r });
      }
    return out;
  }

  // Rank the MOST ISOLATED bubbles — coloured poppable cells walled in on most
  // sides by an edge, an empty cell, or a DIFFERENT colour (a same-colour or rainbow
  // neighbour does NOT count as isolating). The harder a bubble is to ever
  // match, the higher it scores; true singletons (group of 1, which tapping can
  // never clear) always outrank merely-surrounded bubbles. Returns up to
  // `count` such cells, most-isolated first. Used by the "pick" pet companion,
  // which destroys them one by one.
  mostIsolatedCells(count = 3) {
    const scored = [];
    const dirs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    for (let c = 0; c < this.cols; c++)
      for (let r = 0; r < this.rows; r++) {
        const col = this.grid[c][r];
        if (!this._isColoredPopTarget(c, r)) continue;
        let iso = 0;
        for (const [dc, dr] of dirs) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) {
            iso++; // an edge walls the bubble in
            continue;
          }
          const o = this.grid[nc][nr];
          if (o === -1) {
            iso++; // an empty neighbour isolates
          } else if (
            this.types[nc][nr] !== RAINBOW &&
            !(o === col && this._isColoredPopTarget(nc, nr))
          ) {
            iso++; // a blocker or different non-wildcard colour isolates
          }
        }
        const singleton = this.getGroupAt(c, r).length === 1;
        // Only genuinely isolated bubbles qualify (walled in on 3+ sides, or a
        // true singleton) — never break up a healthy cluster.
        if (iso >= 3 || singleton) {
          scored.push({ c, r, score: iso + (singleton ? 10 : 0) });
        }
      }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(0, count)).map(({ c, r }) => ({ c, r }));
  }

  // Longest straight diagonal run (↘ or ↗) of same-colour poppable bubbles. The
  // orthogonal flood-fill that powers tapping can never clear a pure diagonal,
  // so the "diagonal" pet companion blasts the longest such streak. Returns the
  // cells of the best run (length >= minLen), or [] if none qualifies.
  diagonalRun(minLen = 3) {
    let best = [];
    const dirs = [
      [1, 1], // ↘
      [1, -1], // ↗
    ];
    const sameColor = (c, r, color) =>
      c >= 0 &&
      c < this.cols &&
      r >= 0 &&
      r < this.rows &&
      this.grid[c][r] === color &&
      this._isColoredPopTarget(c, r);
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < this.rows; r++) {
        const color = this.grid[c][r];
        if (!this._isColoredPopTarget(c, r)) continue;
        for (const [dc, dr] of dirs) {
          // Only start counting at a run's top end (nothing same-colour
          // behind us), so each maximal run is measured exactly once.
          if (sameColor(c - dc, r - dr, color)) continue;
          const run = [];
          let cc = c;
          let rr = r;
          while (sameColor(cc, rr, color)) {
            run.push({ c: cc, r: rr });
            cc += dc;
            rr += dr;
          }
          if (run.length >= minLen && run.length > best.length) best = run;
        }
      }
    }
    return best;
  }

  // Archer pet skill-shot: step a deterministic grid ray from a start cell in
  // the drag direction and return the first `count` filled cells it crosses.
  // Uses DDA stepping with a small hit radius so diagonal shots affect nearby
  // bubbles just like horizontal/vertical shots. Empty cells are skipped;
  // duplicate cells are de-duped.
  arrowRay(c, r, dx, dy, count = 3) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return [];
    const mag = Math.hypot(dx, dy);
    if (mag < 0.001) return [];
    const maxHits = Math.max(1, Math.round(count || 1));
    const stepX = dx / mag;
    const stepY = dy / mag;
    const samples = Math.max(this.cols, this.rows) * 6;
    const seen = new Set();
    const cells = [];
    for (let i = 0; i <= samples && cells.length < maxHits; i++) {
      const x = c + 0.5 + stepX * i * 0.22;
      const y = r + 0.5 + stepY * i * 0.22;
      let best = null;
      let bestD = Infinity;
      const baseC = Math.floor(x);
      const baseR = Math.floor(y);
      for (let cc = baseC - 1; cc <= baseC + 1; cc++) {
        for (let rr = baseR - 1; rr <= baseR + 1; rr++) {
          if (cc < 0 || cc >= this.cols || rr < 0 || rr >= this.rows) continue;
          if (this.grid[cc][rr] === -1) continue;
          const d = Math.hypot(cc + 0.5 - x, rr + 0.5 - y);
          if (d <= 0.52 && d < bestD) {
            bestD = d;
            best = { c: cc, r: rr };
          }
        }
      }
      if (!best) {
        const cc = Math.floor(x);
        const rr = Math.floor(y);
        if (cc < 0 || cc >= this.cols || rr < 0 || rr >= this.rows) {
          if (i > 0) break;
        }
        continue;
      }
      const { c: cc, r: rr } = best;
      if (cc < 0 || cc >= this.cols || rr < 0 || rr >= this.rows) {
        if (i > 0) break;
        continue;
      }
      if (this.grid[cc][rr] === -1) continue;
      const key = cc * this.rows + rr;
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push({ c: cc, r: rr });
    }
    return cells;
  }

  bomberRun(count = 5, rand = this.rng || Math.random) {
    const dirs = [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ];
    const n = Math.max(1, Math.round(count || 1));
    let best = [];
    for (const [dc, dr] of dirs) {
      for (const start of this._bomberStarts(dc, dr)) {
        const line = this._bomberLine(start.c, start.r, dc, dr, n);
        if (line.length > best.length) best = line;
      }
    }
    if (best.length) return best;
    const cells = [];
    for (let c = 0; c < this.cols; c++)
      for (let r = 0; r < this.rows; r++)
        if (this.grid[c][r] !== -1) cells.push({ c, r });
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    return cells.slice(0, n);
  }

  _bomberStarts(dc, dr) {
    const starts = [];
    if (dc === 1 && dr === 0) {
      for (let r = 0; r < this.rows; r++) starts.push({ c: 0, r });
    } else if (dc === 0 && dr === 1) {
      for (let c = 0; c < this.cols; c++) starts.push({ c, r: 0 });
    } else if (dc === 1 && dr === 1) {
      for (let c = 0; c < this.cols; c++) starts.push({ c, r: 0 });
      for (let r = 1; r < this.rows; r++) starts.push({ c: 0, r });
    } else if (dc === 1 && dr === -1) {
      for (let c = 0; c < this.cols; c++) starts.push({ c, r: this.rows - 1 });
      for (let r = 0; r < this.rows - 1; r++) starts.push({ c: 0, r });
    }
    return starts;
  }

  _bomberLine(c, r, dc, dr, count) {
    const cells = [];
    let cc = c;
    let rr = r;
    while (cc >= 0 && cc < this.cols && rr >= 0 && rr < this.rows && cells.length < count) {
      if (this.grid[cc][rr] !== -1) cells.push({ c: cc, r: rr });
      cc += dc;
      rr += dr;
    }
    return cells;
  }

  // A random filled NORMAL cell (used by hazard events to anchor a scatter).
  // Returns null when the board has no plain bubbles. `rand` keeps it testable.
  randomFilledCell(rand = Math.random) {
    const cells = [];
    for (let c = 0; c < this.cols; c++)
      for (let r = 0; r < this.rows; r++)
        if (this.grid[c][r] !== -1 && this.types[c][r] === NORMAL)
          cells.push({ c, r });
    if (!cells.length) return null;
    return cells[Math.floor(rand() * cells.length)];
  }

  // Hazard "scatter": recolour the `count` NORMAL bubbles nearest (c,r) to a
  // *different* random colour, breaking apart connected same-colour groups.
  // Mutates grid + sprite colours in place and returns the affected cells.
  // Deterministic when a seeded `rand` is supplied (used by unit tests).
  scatterArea(c, r, count = 4, rand = Math.random) {
    if (this.colorCount < 2) return [];
    const cand = [];
    for (let cc = 0; cc < this.cols; cc++)
      for (let rr = 0; rr < this.rows; rr++) {
        if (this.grid[cc][rr] === -1 || this.types[cc][rr] !== NORMAL) continue;
        const d = Math.max(Math.abs(cc - c), Math.abs(rr - r));
        cand.push({ c: cc, r: rr, d });
      }
    cand.sort((a, b) => a.d - b.d);
    const pick = cand.slice(0, Math.max(0, count));
    const affected = [];
    for (const p of pick) {
      const cur = this.grid[p.c][p.r];
      // Choose any colour other than the current one (guarantees a change).
      let nc = Math.floor(rand() * (this.colorCount - 1));
      if (nc >= cur) nc++;
      this.grid[p.c][p.r] = nc;
      const sp = this.spriteGrid[p.c][p.r];
      if (sp) {
        sp.color = nc;
        sp.scale = 0.6; // pop-in pulse for feedback
      }
      affected.push({ c: p.c, r: p.r });
    }
    return affected;
  }

  // Pet "paint": recolour the nearest different-colour NORMAL bubbles to match
  // the anchor. This creates a fresh connected cluster for the player to pop;
  // it never clears bubbles directly.
  paintArea(c, r, count = 4) {
    const target = this.grid[c]?.[r];
    if (target === -1 || target === undefined || this.types[c]?.[r] !== NORMAL) return [];
    const cand = [];
    for (let cc = 0; cc < this.cols; cc++)
      for (let rr = 0; rr < this.rows; rr++) {
        if (cc === c && rr === r) continue;
        if (this.grid[cc][rr] === -1 || this.types[cc][rr] !== NORMAL) continue;
        if (this.grid[cc][rr] === target) continue;
        const d = Math.max(Math.abs(cc - c), Math.abs(rr - r));
        cand.push({ c: cc, r: rr, d });
      }
    cand.sort((a, b) => a.d - b.d);
    const pick = cand.slice(0, Math.max(0, count));
    const affected = [];
    for (const p of pick) {
      this.grid[p.c][p.r] = target;
      const sp = this.spriteGrid[p.c][p.r];
      if (sp) {
        sp.color = target;
        sp.scale = 0.6;
      }
      affected.push({ c: p.c, r: p.r });
    }
    return affected;
  }

  // Chain Bolt clears the full row and full column that cross at (c,r).
  crossCells(c, r) {
    const cells = [];
    const seen = new Set();
    const add = (cc, rr) => {
      if (cc < 0 || cc >= this.cols || rr < 0 || rr >= this.rows) return;
      if (this.grid[cc][rr] === -1) return;
      const k = cc * this.rows + rr;
      if (seen.has(k)) return;
      seen.add(k);
      cells.push({ c: cc, r: rr });
    };
    for (let rr = 0; rr < this.rows; rr++) add(c, rr); // column
    for (let cc = 0; cc < this.cols; cc++) add(cc, r); // row
    return cells;
  }

  // Magnet: pull bubbles of `color` together into one connected blob anchored at
  // (c,r). `strength` (0..1) decides how many are gathered — a perfect (1) pull
  // collects EVERY bubble of that colour into a single connected group, while a
  // weak pull only nudges a few in. Bubbles are physically RELOCATED: the
  // coloured bubble and the bubble occupying its destination trade cells and
  // glide there (see MAGNET_GLIDE), so the player sees the colour travel across
  // the board rather than cells merely recolouring. Ice/Rainbow cells act as
  // walls and are never moved. Returns { gathered, color }.
  magnetGather(c, r, color, strength) {
    // Self-heal the anchor: if the requested cell no longer holds this colour
    // (the player may have popped or a hazard recoloured it since the magnet
    // was aimed), re-anchor onto any surviving NORMAL bubble of the colour so
    // we never gather toward an empty or wrong-coloured location.
    if (this.grid[c][r] !== color || this.types[c][r] !== NORMAL) {
      const alt = this.firstCellOfColor(color);
      if (!alt) return { gathered: 0, color };
      c = alt.c;
      r = alt.r;
    }
    // Every normal bubble of this colour (the anchor included).
    const sources = [];
    for (let cc = 0; cc < this.cols; cc++)
      for (let rr = 0; rr < this.rows; rr++)
        if (this.grid[cc][rr] === color && this.types[cc][rr] === NORMAL)
          sources.push({ c: cc, r: rr });
    const total = sources.length;
    if (total <= 1) return { gathered: total, color };

    // Target blob size grows with strength: weak → 2, perfect → all of them.
    const clamped = Math.max(0, Math.min(1, strength));
    const k = Math.max(2, Math.round(2 + clamped * (total - 2)));

    // Grow a connected region of NORMAL bubbles outward from the anchor (BFS,
    // nearest first) until it reaches size k or runs out of reachable cells.
    const key = (cc, rr) => cc * this.rows + rr;
    const inRegion = new Set([key(c, r)]);
    const region = [{ c, r }];
    const queue = [{ c, r }];
    while (queue.length && region.length < k) {
      const { c: cc, r: rr } = queue.shift();
      const nbrs = [
        { c: cc + 1, r: rr },
        { c: cc - 1, r: rr },
        { c: cc, r: rr + 1 },
        { c: cc, r: rr - 1 },
      ];
      for (const n of nbrs) {
        if (region.length >= k) break;
        if (n.c < 0 || n.c >= this.cols || n.r < 0 || n.r >= this.rows) continue;
        if (this.grid[n.c][n.r] === -1 || this.types[n.c][n.r] !== NORMAL) continue;
        const kk = key(n.c, n.r);
        if (inRegion.has(kk)) continue;
        inRegion.add(kk);
        region.push(n);
        queue.push(n);
      }
    }

    // Cells in the blob that are not yet the target colour need a donor; cells
    // of the target colour outside the blob are the donors to pull in.
    const need = region.filter((p) => this.grid[p.c][p.r] !== color);
    const donors = sources.filter((p) => !inRegion.has(key(p.c, p.r)));
    const count = Math.min(need.length, donors.length);
    for (let i = 0; i < count; i++) {
      const a = need[i]; // blob slot that should become the target colour
      const b = donors[i]; // a target-colour bubble out in the field
      // Swap the colour + type arrays so the model stays consistent…
      const ac = this.grid[a.c][a.r];
      const at = this.types[a.c][a.r];
      this.grid[a.c][a.r] = this.grid[b.c][b.r];
      this.types[a.c][a.r] = this.types[b.c][b.r];
      this.grid[b.c][b.r] = ac;
      this.types[b.c][b.r] = at;
      // …and swap the actual sprite objects so each bubble physically travels
      // to its new home. Each keeps its current pixel position as the glide
      // start, then eases (slowly) to its new cell — a real relocation, with
      // the colour carried along by the moving bubble.
      const sa = this.spriteGrid[a.c][a.r];
      const sb = this.spriteGrid[b.c][b.r];
      this.spriteGrid[a.c][a.r] = sb;
      this.spriteGrid[b.c][b.r] = sa;
      if (sb) {
        sb.c = a.c;
        sb.r = a.r;
        this._startGlide(sb);
      }
      if (sa) {
        sa.c = b.c;
        sa.r = b.r;
        this._startGlide(sa);
      }
    }
    return { gathered: this.getGroupAt(c, r).length, color };
  }

  // Begin a slow glide for a sprite from its current pixel position to whatever
  // cell it now belongs to. Used by the magnet so pulled bubbles visibly drift
  // across the board instead of snapping.
  _startGlide(s) {
    if (!s) return;
    s.fx = s.x;
    s.fy = s.y;
    s.glideT = 0;
    s.glideDur = MAGNET_GLIDE;
  }

  // Filled cells in a single column (top→bottom). Used by the 🌋 Magma
  // (Volcano) pet to clear whole vertical lanes.
  columnCells(c) {
    const out = [];
    if (c < 0 || c >= this.cols) return out;
    for (let r = 0; r < this.rows; r++)
      if (this.grid[c][r] !== -1) out.push({ c, r });
    return out;
  }

  // The `n` columns holding the most bubbles, fullest first (ties break
  // left→right). Magma erupts under the busiest lanes for the biggest clear.
  fullestColumns(n = 1) {
    const counts = [];
    for (let c = 0; c < this.cols; c++) {
      let k = 0;
      for (let r = 0; r < this.rows; r++) if (this.grid[c][r] !== -1) k++;
      if (k > 0) counts.push({ c, k });
    }
    counts.sort((a, b) => b.k - a.k || a.c - b.c);
    return counts.slice(0, Math.max(0, n)).map((x) => x.c);
  }

  // 🌍 Quake (Earthquake): a board-wide tremor that resettles every bubble so
  // identical colours land together in big connected groups — a guaranteed
  // batch of fresh matches for the player to pop. Colours are conserved (just
  // rearranged over the existing filled NORMAL cells); ICE/RAINBOW/LIGHTNING
  // bubbles are left untouched as fixed anchors. Pure & deterministic: it lays
  // the sorted colours down column-major so each colour forms a contiguous
  // band. Returns the cells whose colour changed.
  quakeRegroup() {
    const slots = [];
    const colors = [];
    for (let c = 0; c < this.cols; c++)
      for (let r = 0; r < this.rows; r++) {
        if (this.grid[c][r] === -1 || this.types[c][r] !== NORMAL) continue;
        slots.push({ c, r });
        colors.push(this.grid[c][r]);
      }
    if (slots.length < 2) return [];
    slots.sort((a, b) => a.c - b.c || a.r - b.r);
    colors.sort((a, b) => a - b);
    const changed = [];
    slots.forEach((p, i) => {
      const nc = colors[i];
      if (this.grid[p.c][p.r] !== nc) changed.push({ c: p.c, r: p.r });
      this.grid[p.c][p.r] = nc;
      const s = this.spriteGrid[p.c][p.r];
      if (s) {
        s.color = nc;
        s.scale = 0.6;
        s.state = "idle";
      }
    });
    return changed;
  }

  // 🌪️ Cyclone (Tornado): a targeted vortex that sorts each column's bubbles by
  // colour so identical colours stack into tall, ready-to-pop vertical runs.
  // Bubbles stay in their own column (only their vertical order changes);
  // ICE/RAINBOW/LIGHTNING cells are left in place as walls. Pure &
  // deterministic. Returns the cells whose colour changed.
  cycloneSort() {
    const changed = [];
    for (let c = 0; c < this.cols; c++) {
      const rows = [];
      const colors = [];
      for (let r = 0; r < this.rows; r++) {
        if (this.grid[c][r] === -1 || this.types[c][r] !== NORMAL) continue;
        rows.push(r);
        colors.push(this.grid[c][r]);
      }
      if (rows.length < 2) continue;
      colors.sort((a, b) => a - b);
      rows.forEach((r, i) => {
        const nc = colors[i];
        if (this.grid[c][r] !== nc) changed.push({ c, r });
        this.grid[c][r] = nc;
        const s = this.spriteGrid[c][r];
        if (s) {
          s.color = nc;
          s.scale = 0.6;
          s.state = "idle";
        }
      });
    }
    return changed;
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

  // Regenerate a full board of fresh bubbles (used by Time Attack to keep play
  // going when the board would otherwise deadlock). Reuses the seeded generator
  // so it still guarantees at least one available move, then drops the new
  // bubbles in from the top via the standard sprite positioning.
  refill() {
    this._generate();
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

      // Downpour row-in: a dedicated slow settle so rain reads as deliberate
      // board pressure instead of snapping in too quickly.
      if (s.fallDur > 0) {
        s.fallT = Math.min(s.fallDur, (s.fallT || 0) + dt);
        const t = this.targetPixel(s.c, s.r);
        const k = s.fallT / s.fallDur;
        const e = 0.5 - Math.cos(Math.PI * k) / 2; // slow, smooth sine ease
        s.y = (s.fy0 == null ? s.y : s.fy0) + (t.y - (s.fy0 == null ? s.y : s.fy0)) * e;
        s.x += (t.x - s.x) * (smooth * (s.fallMult || 1));
        if (s.fallT >= s.fallDur) {
          s.fallDur = 0;
          s.x = t.x;
          s.y = t.y;
        }
        if (s.scale < 1) s.scale += (1 - s.scale) * smooth;
        else s.scale = 1;
        continue;
      }

      const t = this.targetPixel(s.c, s.r);
      // A magnet glide eases the bubble slowly from where it was grabbed to its
      // new cell, so the relocation reads clearly. Once finished it falls back
      // to the normal snappy follow below.
      if (s.glideDur > 0) {
        s.glideT = Math.min(s.glideDur, s.glideT + dt);
        const k = s.glideT / s.glideDur;
        const e = k * k * (3 - 2 * k); // smoothstep ease in/out
        s.x = s.fx + (t.x - s.fx) * e;
        s.y = s.fy + (t.y - s.fy) * e;
        if (s.scale < 1) s.scale += (1 - s.scale) * smooth;
        else s.scale = 1;
        if (s.glideT >= s.glideDur) s.glideDur = 0;
        continue;
      }
      const follow = smooth * (s.fallMult || 1);
      s.x += (t.x - s.x) * follow;
      s.y += (t.y - s.y) * follow;
      if (s.scale < 1) s.scale += (1 - s.scale) * smooth;
      else s.scale = 1;
    }
  }

  // True when no board sprite animation is still visibly playing.
  isIdle() {
    return !this.sprites.some((s) => {
      if (s.state === "pop") return true;
      if ((s.delay || 0) > 0) return true;
      if ((s.fallDur || 0) > 0) return true;
      if ((s.glideDur || 0) > 0) return true;
      const t = this.targetPixel(s.c, s.r);
      return Math.abs(s.x - t.x) > 0.75 || Math.abs(s.y - t.y) > 0.75;
    });
  }
}
