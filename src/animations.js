// Easing functions, screen shake, and floating score text.

export const Easing = {
  linear: (t) => t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inQuad: (t) => t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  outBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outBounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

// Trauma-based screen shake (decays over time).
export class ScreenShake {
  constructor() {
    this.trauma = 0;
    this.x = 0;
    this.y = 0;
    this.rot = 0;
  }
  add(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }
  update(dt) {
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
    }
    const shake = this.trauma * this.trauma;
    const mag = 16 * shake;
    this.x = (Math.random() * 2 - 1) * mag;
    this.y = (Math.random() * 2 - 1) * mag;
    this.rot = (Math.random() * 2 - 1) * 0.03 * shake;
  }
}

// Floating "+score" text that rises and fades.
export class FloatingText {
  constructor() {
    this.items = [];
  }
  spawn(x, y, text, color = "#ffffff", size = 26) {
    this.items.push({ x, y, text, color, size, life: 0, max: 0.9 });
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life += dt;
      it.y -= dt * 70;
      if (it.life >= it.max) this.items.splice(i, 1);
    }
  }
  draw(ctx) {
    for (const it of this.items) {
      const t = it.life / it.max;
      const alpha = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
      const scale = 0.7 + Math.min(1, t * 3) * 0.4;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(it.x, it.y);
      ctx.scale(scale, scale);
      ctx.font = `900 ${it.size}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.strokeText(it.text, 0, 0);
      ctx.fillStyle = it.color;
      ctx.fillText(it.text, 0, 0);
      ctx.restore();
    }
  }
}

// ---- Pet ability animations ----------------------------------------------
// A lively on-board flourish played whenever an equipped pet performs its
// active ability. Each ability has its own choreography so the companion
// visibly "does" something:
//   • gather  (🐶 Rover)    — dashes in from the side, tugs scattered bubbles
//                             of one colour together with a leash of sparkles.
//   • cleanse (🐱 Whiskers) — pounces down from above and claw-slashes the lone
//                             bubbles it clears.
// The animator is purely cosmetic (drawn over the board); the underlying board
// change happens immediately in main.js when the animation is triggered.

function withAlpha(hex, a) {
  const h = (hex || "#ffffff").replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

export class PetAnim {
  constructor() {
    this.items = [];
  }

  // Whether any pet animation is currently playing.
  get busy() {
    return this.items.length > 0;
  }

  // Trigger a pet ability animation.
  //   opts.kind       — "gather" | "cleanse" | "diagonal"
  //   opts.icon       — pet emoji to fly across the screen
  //   opts.anchor     — { x, y } focal point of the ability (pixels)
  //   opts.targets    — [{ x, y }, ...] affected bubble centres (pixels)
  //   opts.color      — accent colour for trails/sparkles
  //   opts.board      — (optional) live board, so the animation can track
  //                     bubbles that move/vanish while it plays
  //   opts.anchorCell — (optional) { c, r } grid anchor (used with board)
  //   opts.cells      — (optional) [{ c, r }, ...] affected grid cells
  //
  // When `opts.board` + grid cells are supplied (gather/magnet, where bubbles
  // persist and may be popped by the player mid-animation), pixel positions are
  // recomputed every frame from the live board and any cell the player has
  // since removed is dropped — so leashes never reel toward an empty location.
  play(opts = {}) {
    const targets = Array.isArray(opts.targets) ? opts.targets : [];
    let cx = opts.anchor ? opts.anchor.x : 0;
    let cy = opts.anchor ? opts.anchor.y : 0;
    if (!opts.anchor && targets.length) {
      cx = targets.reduce((a, t) => a + t.x, 0) / targets.length;
      cy = targets.reduce((a, t) => a + t.y, 0) / targets.length;
    }
    const kind =
      opts.kind === "cleanse"
        ? "cleanse"
        : opts.kind === "diagonal"
          ? "diagonal"
          : "gather";
    this.items.push({
      kind,
      icon: opts.icon || "🐾",
      color: opts.color || "#9be7ff",
      cx,
      cy,
      targets,
      // Live tracking is only meaningful for non-destructive moves (gather),
      // where the affected bubbles stay on the board. Cleanse/diagonal pop
      // their cells immediately, so they keep their frozen snapshot.
      board: kind === "gather" ? opts.board || null : null,
      anchorCell: opts.anchorCell || null,
      cells: Array.isArray(opts.cells) ? opts.cells : null,
      life: 0,
      enter: 0.42,
      act: 0.6,
      exit: 0.4,
    });
  }

  // For a live (board-tracked) item, refresh its focal point + target pixels
  // from the current board, dropping any bubble the player has popped since the
  // ability fired. Re-homes the focal point to the surviving bubbles if the
  // anchor itself was cleared, so nothing reels toward an empty cell.
  _syncLive(it) {
    const b = it.board;
    if (!b) return;
    const occupied = (cell) =>
      cell &&
      b.grid[cell.c] !== undefined &&
      b.grid[cell.c][cell.r] !== undefined &&
      b.grid[cell.c][cell.r] !== -1;
    if (it.cells) {
      it.targets = it.cells
        .filter(occupied)
        .map((cell) => b.targetPixel(cell.c, cell.r));
    }
    if (occupied(it.anchorCell)) {
      const a = b.targetPixel(it.anchorCell.c, it.anchorCell.r);
      it.cx = a.x;
      it.cy = a.y;
    } else if (it.targets.length) {
      it.cx = it.targets.reduce((s, t) => s + t.x, 0) / it.targets.length;
      it.cy = it.targets.reduce((s, t) => s + t.y, 0) / it.targets.length;
    }
  }


  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life += dt;
      if (it.life >= it.enter + it.act + it.exit) this.items.splice(i, 1);
    }
  }

  draw(ctx) {
    for (const it of this.items) this._drawItem(ctx, it);
  }

  _drawItem(ctx, it) {
    // Keep board-tracked (gather) items pinned to live bubbles, never to cells
    // the player has cleared while the animation was still playing.
    if (it.board) this._syncLive(it);
    const L = it.life;
    const hoverX = it.cx;
    const hoverY = it.cy - 60;
    // Entry origin depends on ability: Rover dashes in from the left, Whiskers
    // drops down from above, Comet streaks in from the top-left diagonal.
    const origin =
      it.kind === "cleanse"
        ? { x: it.cx, y: it.cy - 320 }
        : it.kind === "diagonal"
          ? { x: it.cx - 280, y: it.cy - 280 }
          : { x: it.cx - 300, y: it.cy - 30 };

    let px;
    let py;
    let rot = 0;
    let scale = 1;
    let alpha = 1;
    let actP = 0; // 0..1 progress through the "act" phase (drives effects)

    if (L < it.enter) {
      const p = Easing.outBack(L / it.enter);
      px = origin.x + (hoverX - origin.x) * p;
      py = origin.y + (hoverY - origin.y) * p;
      scale = 0.6 + 0.5 * Easing.outQuad(L / it.enter);
      rot = it.kind === "gather" ? (1 - p) * 0.5 : (1 - p) * -0.3;
    } else if (L < it.enter + it.act) {
      actP = (L - it.enter) / it.act;
      px = hoverX;
      if (it.kind === "cleanse") {
        // Pounce: dip down onto the targets, then spring back up.
        const dip = Math.sin(actP * Math.PI);
        py = hoverY + dip * 56;
        scale = 1.1 - dip * 0.12;
        rot = Math.sin(actP * Math.PI * 3) * 0.18;
      } else if (it.kind === "diagonal") {
        // Streak: a sharp tilted zip with a quick spin as the beam fires.
        py = hoverY - Math.sin(actP * Math.PI) * 8;
        scale = 1.15;
        rot = -0.6 + Math.sin(actP * Math.PI * 2) * 0.25;
      } else {
        // Tug: lean back and forth as it reels colours in, with a happy bob.
        py = hoverY - Math.abs(Math.sin(actP * Math.PI * 2)) * 10;
        scale = 1.1;
        rot = Math.sin(actP * Math.PI * 4) * 0.22;
      }
    } else {
      const p = Easing.inQuad((L - it.enter - it.act) / it.exit);
      px = hoverX;
      py = hoverY - p * 120;
      scale = 1.1 - p * 0.6;
      alpha = 1 - p;
      actP = 1;
    }

    // Effects tied to the affected bubbles (drawn under the sprite).
    ctx.save();
    if (it.kind === "gather") this._drawGatherFx(ctx, it, actP);
    else if (it.kind === "diagonal") this._drawDiagonalFx(ctx, it, actP);
    else this._drawCleanseFx(ctx, it, actP);
    ctx.restore();

    // Soft glow + sprite.
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    const glow = ctx.createRadialGradient(px, py, 0, px, py, 40 * scale);
    glow.addColorStop(0, withAlpha(it.color, 0.45));
    glow.addColorStop(1, withAlpha(it.color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(px, py, 40 * scale, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(px, py);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.font = "44px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(it.icon, 0, 0);
    ctx.restore();
  }

  // 🐶 Rover: a leash of sparkles reels each target toward the focal point.
  _drawGatherFx(ctx, it, actP) {
    const ease = Easing.outCubic(actP);
    ctx.lineWidth = 3;
    for (const t of it.targets) {
      const dx = it.cx - t.x;
      const dy = it.cy - t.y;
      const sx = t.x + dx * ease;
      const sy = t.y + dy * ease;
      const fade = 1 - actP * 0.6;
      ctx.strokeStyle = withAlpha(it.color, 0.5 * fade);
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      // Travelling sparkle.
      ctx.fillStyle = withAlpha("#ffffff", 0.9 * fade);
      ctx.beginPath();
      ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 🐱 Whiskers: a quick claw slash + flash over each lone bubble.
  _drawCleanseFx(ctx, it, actP) {
    const grow = Easing.outQuad(Math.min(1, actP * 1.6));
    const fade = 1 - Math.max(0, (actP - 0.6) / 0.4);
    for (const t of it.targets) {
      const len = 18 * grow;
      ctx.strokeStyle = withAlpha("#ffffff", 0.95 * fade);
      ctx.lineWidth = 3.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(t.x - len, t.y - len);
      ctx.lineTo(t.x + len, t.y + len);
      ctx.moveTo(t.x + len, t.y - len);
      ctx.lineTo(t.x - len, t.y + len);
      ctx.stroke();
      // Flash ring.
      ctx.strokeStyle = withAlpha(it.color, 0.7 * fade);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(t.x, t.y, len * 1.2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ☄️ Comet: a bright beam sweeps along the diagonal streak, with a flash on
  // each bubble as the streak is blasted away.
  _drawDiagonalFx(ctx, it, actP) {
    const pts = it.targets;
    if (!pts.length) return;
    const sweep = Easing.outCubic(Math.min(1, actP * 1.3));
    const fade = 1 - Math.max(0, (actP - 0.55) / 0.45);
    const a = pts[0];
    const b = pts[pts.length - 1];
    // The beam grows from the first target toward the last along the diagonal.
    const ex = a.x + (b.x - a.x) * sweep;
    const ey = a.y + (b.y - a.y) * sweep;
    ctx.lineCap = "round";
    ctx.strokeStyle = withAlpha(it.color, 0.85 * fade);
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.strokeStyle = withAlpha("#ffffff", 0.95 * fade);
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // Spark flash on each bubble the beam has reached.
    for (const t of pts) {
      const along =
        Math.hypot(t.x - a.x, t.y - a.y) <= Math.hypot(ex - a.x, ey - a.y) + 1;
      if (!along) continue;
      ctx.fillStyle = withAlpha("#ffffff", 0.9 * fade);
      ctx.beginPath();
      ctx.arc(t.x, t.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ---- Premium "Nova" alien gunship -----------------------------------------
// An autonomous shooter pet (premium-only). It patrols the base of the board in
// real time, bounces off the side walls, and fires cannon bolts straight up to
// destroy the lowest bubble in its target column(s). Its firepower — fire rate,
// parallel cannons and periodic nukes — comes from `shooterStats(level)`.
//
// The ship is only the *driver*: it owns position, direction, timers and
// in-flight bullets, and calls game hooks (`hitColumn` / `nuke`) to perform the
// actual destruction through the game's normal pop/score path, so scoring,
// particles, fever and win-detection stay consistent with manual play.
export class AlienShip {
  constructor() {
    this.active = false;
    this.stats = null;
    this.x = 0;
    this.y = 0;
    this.dir = 1; // +1 right, -1 left
    this.fireT = 0;
    this.nukeT = 0;
    this.bullets = []; // { x, y, vy, tc, ty }
    this.blasts = []; // nuke shockwaves { x, y, t, dur }
    this.t = 0; // age, drives the engine-glow pulse
  }

  // Begin patrolling with the given firepower, parked at the board's base.
  start(stats, board) {
    this.active = true;
    this.stats = stats || {};
    this.bullets.length = 0;
    this.blasts.length = 0;
    this.dir = 1;
    this.fireT = (stats && stats.fireInterval) || 1.2;
    this.nukeT = (stats && stats.nukeInterval) || 0;
    this.t = 0;
    this._place(board);
  }

  stop() {
    this.active = false;
    this.bullets.length = 0;
    this.blasts.length = 0;
  }

  _place(board) {
    if (!board || !board.boardW) return;
    this.x = board.originX + board.boardW / 2;
    this.y = board.originY + board.boardH + 30;
  }

  // Advance the ship. `board` supplies geometry + `bottomBubble`; `hooks`
  // performs the real destruction: { hitColumn(col), nuke(col) }.
  update(dt, board, hooks) {
    if (!this.active || !board || !board.boardW) return;
    const s = this.stats || {};
    this.t += dt;
    // Hover just below the board (re-read so it tracks layout changes).
    this.y = board.originY + board.boardH + 30;

    // Patrol left/right, bouncing off the side walls.
    const left = board.originX + board.cell * 0.6;
    const right = board.originX + board.boardW - board.cell * 0.6;
    this.x += this.dir * (s.moveSpeed || 100) * dt;
    if (this.x <= left) {
      this.x = left;
      this.dir = 1;
    } else if (this.x >= right) {
      this.x = right;
      this.dir = -1;
    }

    // Advance bullets upward; on reaching their target row, blast that column.
    for (const b of this.bullets) {
      b.y += b.vy * dt;
      if (b.y <= b.ty) {
        b.dead = true;
        if (hooks && hooks.hitColumn) hooks.hitColumn(b.tc);
      }
    }
    this.bullets = this.bullets.filter(
      (b) => !b.dead && b.y > board.originY - 24
    );

    // Fire a volley on the cadence.
    this.fireT -= dt;
    if (this.fireT <= 0) {
      this.fireT = s.fireInterval || 1.2;
      this._fire(board);
    }

    // Periodic area-clearing nuke once unlocked (max progression).
    if (s.nuke && s.nukeInterval > 0) {
      this.nukeT -= dt;
      if (this.nukeT <= 0) {
        this.nukeT = s.nukeInterval;
        const col = board.columnAtPixel(this.x);
        if (hooks && hooks.nuke) hooks.nuke(col);
        this.blasts.push({
          x: this.x,
          y: board.originY + board.boardH - board.cell,
          t: 0,
          dur: 0.6,
        });
      }
    }
    for (const z of this.blasts) z.t += dt;
    this.blasts = this.blasts.filter((z) => z.t < z.dur);
  }

  // Launch this volley at the ship's column plus any parallel cannons.
  _fire(board) {
    const center = board.columnAtPixel(this.x);
    const shots = Math.max(1, (this.stats && this.stats.shots) || 1);
    const cols = [];
    const half = Math.floor(shots / 2);
    for (let i = -half; cols.length < shots && i <= shots; i++) {
      const c = center + i;
      if (c >= 0 && c < board.cols && !cols.includes(c)) cols.push(c);
    }
    if (!cols.length) cols.push(Math.max(0, Math.min(board.cols - 1, center)));
    for (const c of cols) {
      if (c < 0 || c >= board.cols) continue;
      const target = board.bottomBubble(c);
      const ty = target ? board.targetPixel(c, target.r).y : board.originY;
      this.bullets.push({
        x: board.originX + c * board.cell + board.cell / 2,
        y: this.y - 16,
        vy: -700,
        tc: c,
        ty,
      });
    }
  }

  draw(ctx) {
    if (!this.active) return;
    // Tracer bolts.
    for (const b of this.bullets) {
      ctx.save();
      ctx.fillStyle = withAlpha("#7df9ff", 0.95);
      ctx.shadowColor = "#7df9ff";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, 4, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // Nuke shockwaves.
    for (const z of this.blasts) {
      const k = z.t / z.dur;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - k);
      ctx.strokeStyle = "#ff7bf0";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(z.x, z.y, 14 + k * 72, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // The saucer.
    const x = this.x;
    const y = this.y;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 8);
    ctx.save();
    ctx.globalAlpha = 0.45 + 0.35 * pulse;
    ctx.fillStyle = withAlpha("#7df9ff", 0.5);
    ctx.beginPath();
    ctx.ellipse(x, y + 10, 18, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#b9c4d6";
    ctx.beginPath();
    ctx.ellipse(x, y, 22, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = withAlpha("#7df9ff", 0.9);
    ctx.beginPath();
    ctx.ellipse(x, y - 4, 10, 8, 0, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y, 22, 9, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
