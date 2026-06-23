// Easing functions, screen shake, and floating score text.

export const Easing = {
  linear: (t) => t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inQuad: (t) => t * t,
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
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
    // Scales every added trauma. The reduced-motion accessibility setting sets
    // this to 0 so the screen never shakes; default 1 leaves shake unchanged.
    this.motionScale = 1;
  }
  add(amount) {
    this.trauma = Math.min(1, this.trauma + amount * this.motionScale);
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

  // Drop every in-flight animation WITHOUT firing its callbacks. Called when a
  // level is quit or ends so a still-playing pick flourish (whose `onDone`
  // would otherwise re-run afterMove on a later frame) can't contaminate the
  // menu or the next level's fresh session.
  clear() {
    this.items = [];
  }

  // Trigger a pet ability animation.
  //   opts.kind       — "gather" | "cleanse" | "pick" | "diagonal" | "arrow" | "bomber"
  //   opts.icon       — pet emoji to fly across the screen
  //   opts.anchor     — { x, y } focal point of the ability (pixels)
  //   opts.targets    — [{ x, y }, ...] affected bubble centres (pixels)
  //   opts.color      — accent colour for trails/sparkles
  //   opts.onHit      — (pick/bomber) callback(i) fired as each target is hit, in
  //                     sequence, so the game can destroy each bubble exactly
  //                     when the hawk's beak or Skybolt's bomb reaches it
  //   opts.onDone     — (pick/bomber) callback fired once when the flourish ends, so
  //                     the game can settle gravity + re-evaluate the board
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
        : opts.kind === "arrow"
          ? "arrow"
        : opts.kind === "bomber"
          ? "bomber"
        : opts.kind === "diagonal"
          ? "diagonal"
          : opts.kind === "pick"
            ? "pick"
            : "gather";
    // The pick (Talon) sequence hops target-to-target, so give it a longer act
    // phase that scales with how many bubbles it picks off.
    const act = kind === "bomber"
      ? Math.max(1.1, targets.length * 0.34)
      : kind === "pick"
        ? Math.max(0.7, targets.length * 0.34)
        : 0.6;
    this.items.push({
      kind,
      icon: opts.icon || "🐾",
      color: opts.color || "#9be7ff",
      cx,
      cy,
      targets,
      // Live tracking is only meaningful for non-destructive moves (gather),
      // where the affected bubbles stay on the board. Cleanse/pick/diagonal pop
      // their cells immediately, so they keep their frozen snapshot.
      board: kind === "gather" ? opts.board || null : null,
      anchorCell: opts.anchorCell || null,
      cells: Array.isArray(opts.cells) ? opts.cells : null,
      shotDx: Number.isFinite(opts.shotDx) ? opts.shotDx : 0,
      shotDy: Number.isFinite(opts.shotDy) ? opts.shotDy : 0,
      // Pick fires a per-target callback in sequence as the hawk pecks each one,
      // then a single onDone once the whole flourish has finished.
      onHit: (kind === "pick" || kind === "bomber") && typeof opts.onHit === "function" ? opts.onHit : null,
      onDone: (kind === "pick" || kind === "bomber") && typeof opts.onDone === "function" ? opts.onDone : null,
      done: false,
      hit: [],
      hitAt: [],
      life: 0,
      enter: 0.42,
      act,
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
      // Pick/bomber: fire each target's hit callback in sequence as the pet
      // reaches it during the act phase, so board damage matches the visible hit.
      if ((it.kind === "pick" || it.kind === "bomber") && it.onHit && it.targets.length) {
        const n = it.targets.length;
        const inAct = it.life > it.enter && it.life <= it.enter + it.act;
        const actP = inAct ? (it.life - it.enter) / it.act : it.life > it.enter ? 1 : 0;
        if (it.life > it.enter) {
          for (let k = 0; k < n; k++) {
            if (!it.hit[k] && actP >= (k + 0.5) / n) {
              it.hit[k] = true;
              it.hitAt[k] = it.life;
              it.onHit(k);
            }
          }
        }
      }
      if (it.life >= it.enter + it.act + it.exit) {
        // Make sure every queued hit has fired (so no target is skipped if the
        // act phase elapsed in a single big frame), then resolve the board.
        if ((it.kind === "pick" || it.kind === "bomber") && it.onHit && it.targets.length) {
          for (let k = 0; k < it.targets.length; k++) {
            if (!it.hit[k]) {
              it.hit[k] = true;
              it.hitAt[k] = it.life;
              it.onHit(k);
            }
          }
        }
        if ((it.kind === "pick" || it.kind === "bomber") && it.onDone && !it.done) {
          it.done = true;
          it.onDone();
        }
        this.items.splice(i, 1);
      }
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
    // Talon should fly straight to the first bubble it'll peck (not the empty
    // centroid between targets), so it always visibly heads to a real bubble.
    const firstTarget =
      (it.kind === "pick" || it.kind === "bomber") && it.targets.length ? it.targets[0] : null;
    const hoverX = firstTarget ? firstTarget.x : it.cx;
    const hoverY = (firstTarget ? firstTarget.y : it.cy) - 60;
    // Entry origin depends on ability: Rover dashes in from the left, Whiskers
    // and Talon drop down from above, Comet streaks in from the top-left
    // diagonal, Archer flies in from behind the aimed shot, and Skybolt crosses
    // the board along the bombing route.
    const shotMag = Math.hypot(it.shotDx || 0, it.shotDy || 0) || 1;
    const shotUx = (it.shotDx || 0) / shotMag;
    const shotUy = (it.shotDy || 0) / shotMag;
    const origin =
      it.kind === "cleanse" || it.kind === "pick"
        ? { x: hoverX, y: hoverY - 260 }
        : it.kind === "arrow"
          ? { x: it.cx - shotUx * 260, y: it.cy - shotUy * 260 }
        : it.kind === "bomber"
          ? { x: hoverX - 340, y: hoverY - 180 }
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
      } else if (it.kind === "arrow") {
        const pts = it.targets;
        const first = pts[0] || { x: it.cx, y: it.cy };
        const last = pts[pts.length - 1] || first;
        const p = Easing.outCubic(actP);
        px = first.x + (last.x - first.x) * p;
        py = first.y + (last.y - first.y) * p;
        scale = 1.12;
        rot = Math.atan2(shotUy, shotUx);
      } else if (it.kind === "bomber") {
        const pts = it.targets;
        const first = pts[0] || { x: hoverX, y: hoverY };
        const last = pts[pts.length - 1] || first;
        const p = Easing.inOutQuad(actP);
        px = first.x + (last.x - first.x) * p;
        py = first.y + (last.y - first.y) * p - 70 - Math.sin(actP * Math.PI) * 24;
        scale = 1.18;
        rot = Math.atan2(last.y - first.y, last.x - first.x);
      } else if (it.kind === "pick") {
        // Hop: the hawk swoops above each target in turn and dips to peck it,
        // springing back up before darting to the next one.
        const n = it.targets.length || 1;
        const segF = actP * n;
        const seg = Math.min(n - 1, Math.floor(segF));
        const within = segF - seg; // 0..1 progress over the current target
        const cur = it.targets[seg] || { x: hoverX, y: hoverY + 60 };
        px = cur.x;
        const dip = Math.sin(Math.max(0, Math.min(1, within)) * Math.PI);
        py = cur.y - 60 + dip * 56;
        scale = 1.05 + dip * 0.1;
        rot = -0.15 + Math.sin(within * Math.PI * 2) * 0.18;
      } else {
        // Tug: lean back and forth as it reels colours in, with a happy bob.
        py = hoverY - Math.abs(Math.sin(actP * Math.PI * 2)) * 10;
        scale = 1.1;
        rot = Math.sin(actP * Math.PI * 4) * 0.22;
      }
    } else {
      const p = Easing.inQuad((L - it.enter - it.act) / it.exit);
      // Talon lifts off from the LAST bubble it pecked (not back at the first),
      // so the exit reads as a smooth climb away rather than a jump.
      const lastTarget =
        (it.kind === "pick" || it.kind === "arrow" || it.kind === "bomber") && it.targets.length
          ? it.targets[it.targets.length - 1]
          : null;
      if (it.kind === "bomber" && it.targets.length) {
        const pts = it.targets;
        const first = pts[0];
        const last = pts[pts.length - 1] || first;
        const dx = last.x - first.x;
        const dy = last.y - first.y;
        const mag = Math.hypot(dx, dy) || 1;
        px = last.x + (dx / mag) * 170 * p;
        py = last.y + (dy / mag) * 170 * p - 70 - 90 * p;
        rot = Math.atan2(dy, dx);
      } else {
        px = lastTarget ? lastTarget.x : hoverX;
        py = it.kind === "arrow" && lastTarget ? lastTarget.y - p * 120 : (lastTarget ? lastTarget.y - 60 : hoverY) - p * 120;
      }
      scale = 1.1 - p * 0.6;
      alpha = 1 - p;
      actP = 1;
    }

    // Effects tied to the affected bubbles (drawn under the sprite).
    ctx.save();
    if (it.kind === "gather") this._drawGatherFx(ctx, it, actP);
    else if (it.kind === "arrow") this._drawArrowFx(ctx, it, actP);
    else if (it.kind === "bomber") this._drawBomberFx(ctx, it, actP);
    else if (it.kind === "diagonal") this._drawDiagonalFx(ctx, it, actP);
    else if (it.kind === "pick") this._drawPickFx(ctx, it, actP);
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
    if (it.kind === "bomber") this._drawAircraft(ctx, it.color);
    else {
      ctx.font = "44px -apple-system, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(it.icon, 0, 0);
    }
    ctx.restore();
  }

  _drawAircraft(ctx, color) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = "#1f2a3d";
    ctx.fillStyle = "#f7fbff";
    ctx.beginPath();
    ctx.moveTo(31, 0);
    ctx.lineTo(7, -8);
    ctx.lineTo(-23, -7);
    ctx.lineTo(-37, 0);
    ctx.lineTo(-23, 7);
    ctx.lineTo(7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(6, -7);
    ctx.lineTo(-12, -31);
    ctx.lineTo(-3, -5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(6, 7);
    ctx.lineTo(-12, 31);
    ctx.lineTo(-3, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#9be7ff";
    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.lineTo(5, -4);
    ctx.lineTo(3, 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ff8f5a";
    ctx.beginPath();
    ctx.moveTo(-27, -5);
    ctx.lineTo(-43, -15);
    ctx.lineTo(-33, -2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-27, 5);
    ctx.lineTo(-43, 15);
    ctx.lineTo(-33, 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
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

  // 🦅 Talon: a sharp beak peck at the current target plus an expanding flash
  // ring on each bubble already picked off, so the destruction reads one-by-one.
  _drawPickFx(ctx, it, actP) {
    const n = it.targets.length || 1;
    // Expanding rings on bubbles already pecked (timed from each hit).
    for (let k = 0; k < it.targets.length; k++) {
      if (it.hitAt[k] == null) continue;
      const t = it.targets[k];
      const age = Math.max(0, it.life - it.hitAt[k]);
      const p = Math.min(1, age / 0.4);
      const fade = 1 - p;
      const rr = 6 + p * 24;
      ctx.strokeStyle = withAlpha("#ffffff", 0.9 * fade);
      ctx.lineWidth = 3 * fade + 1;
      ctx.beginPath();
      ctx.arc(t.x, t.y, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = withAlpha(it.color, 0.7 * fade);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(t.x, t.y, rr * 0.6, 0, Math.PI * 2);
      ctx.stroke();
    }
    // A bright beak-peck flash at the target currently under the hawk.
    const seg = Math.min(n - 1, Math.floor(actP * n));
    const cur = it.targets[seg];
    if (cur) {
      const within = actP * n - seg;
      const flash = Math.max(0, Math.sin(within * Math.PI));
      ctx.strokeStyle = withAlpha("#ffd35b", 0.9 * flash);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cur.x, cur.y - 16 * flash);
      ctx.lineTo(cur.x, cur.y);
      ctx.stroke();
    }
  }

  // Skybolt: draw a real flight line, falling bombs, and impact rings so the
  // player sees each bubble get hit at the same moment the board changes.
  _drawBomberFx(ctx, it, actP) {
    const pts = it.targets;
    if (!pts.length) return;
    const first = pts[0];
    const last = pts[pts.length - 1] || first;
    ctx.lineCap = "round";
    ctx.strokeStyle = withAlpha(it.color, 0.38);
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
    ctx.strokeStyle = withAlpha("#ffffff", 0.75);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    ctx.lineTo(last.x, last.y);
    ctx.stroke();

    const n = pts.length || 1;
    for (let k = 0; k < pts.length; k++) {
      const t = pts[k];
      const dropP = (k + 0.5) / n;
      if (actP < dropP) {
        const gap = Math.min(1, Math.max(0, (dropP - actP) * n * 1.4));
        ctx.fillStyle = withAlpha("#1f2a3d", 0.9 - gap * 0.4);
        ctx.beginPath();
        ctx.arc(t.x, t.y - 8 - gap * 58, 4.2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const age = it.hitAt[k] == null ? Math.max(0, actP - dropP) * it.act : Math.max(0, it.life - it.hitAt[k]);
      const p = Math.min(1, age / 0.45);
      const fade = 1 - p;
      ctx.fillStyle = withAlpha(it.color, 0.22 * fade);
      ctx.beginPath();
      ctx.arc(t.x, t.y, 12 + p * 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = withAlpha("#ffffff", 0.95 * fade);
      ctx.lineWidth = 4 * fade + 1;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 7 + p * 28, 0, Math.PI * 2);
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

  // 🏹 Archer: a visible arrow streak pierces each predicted bubble in order.
  _drawArrowFx(ctx, it, actP) {
    const pts = it.targets;
    if (!pts.length) return;
    const sweep = Easing.outCubic(Math.min(1, actP * 1.25));
    const fade = 1 - Math.max(0, (actP - 0.72) / 0.28);
    const a = pts[0];
    const b = pts[pts.length - 1];
    const ex = a.x + (b.x - a.x) * sweep;
    const ey = a.y + (b.y - a.y) * sweep;
    ctx.lineCap = "round";
    ctx.strokeStyle = withAlpha(it.color, 0.78 * fade);
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.strokeStyle = withAlpha("#ffffff", 0.95 * fade);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    for (const t of pts) {
      const reached = Math.hypot(t.x - a.x, t.y - a.y) <= Math.hypot(ex - a.x, ey - a.y) + 1;
      if (!reached) continue;
      const pulse = 0.7 + 0.3 * Math.sin((actP * 20) + t.x * 0.03);
      ctx.strokeStyle = withAlpha("#ffd35b", 0.85 * fade);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 10 + pulse * 10, 0, Math.PI * 2);
      ctx.stroke();
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

// ---- Last-bubble finale --------------------------------------------------
// When a board is whittled down to a single un-poppable bubble, the player is
// never stranded: that final bubble gets a celebratory "glow then explode"
// finale that clears the board. Five distinct explosion styles are picked at
// random so the moment stays fresh. The animator is purely cosmetic — the
// board/score change is driven from main.js via the onExplode / onDone hooks:
//   • onExplode(variant) fires once, at the blast moment (board removal +
//     particle burst happen there).
//   • onDone() fires when the whole finale finishes (level resolves there).
export const BUBBLE_FINALE_VARIANTS = 5;

export class BubbleFinale {
  constructor() {
    this.item = null;
  }
  get active() {
    return !!this.item;
  }
  play({ x, y, radius = 18, color = "#ffffff", variant = 0, onExplode, onDone }) {
    const v =
      ((Math.floor(variant) % BUBBLE_FINALE_VARIANTS) + BUBBLE_FINALE_VARIANTS) %
      BUBBLE_FINALE_VARIANTS;
    this.item = {
      x,
      y,
      radius,
      color,
      variant: v,
      t: 0,
      glow: 0.7, // charge-up duration (s)
      blast: 0.66, // explosion visual duration (s)
      exploded: false,
      onExplode,
      onDone,
    };
  }
  cancel() {
    this.item = null;
  }
  update(dt) {
    const it = this.item;
    if (!it) return;
    it.t += dt;
    if (!it.exploded && it.t >= it.glow) {
      it.exploded = true;
      if (it.onExplode) it.onExplode(it.variant);
    }
    if (it.t >= it.glow + it.blast) {
      const done = it.onDone;
      this.item = null;
      if (done) done();
    }
  }
  draw(ctx, time = 0) {
    const it = this.item;
    if (!it) return;
    if (!it.exploded) this._drawGlow(ctx, it, time);
    else this._drawBlast(ctx, it);
  }

  // Charge-up: a swelling aura, a tightening ring, and orbiting sparks build
  // anticipation before the bubble bursts.
  _drawGlow(ctx, it, time) {
    const p = Math.min(1, it.t / it.glow);
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.018 + p * 12);
    const R = it.radius;
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.globalCompositeOperation = "lighter";
    const auraR = R * (1.4 + p * 1.8 + pulse * 0.4);
    const grad = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, auraR);
    grad.addColorStop(0, withAlpha(it.color, 0.55 * (0.4 + p)));
    grad.addColorStop(0.5, withAlpha(it.color, 0.28 * (0.4 + p)));
    grad.addColorStop(1, withAlpha(it.color, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, auraR, 0, Math.PI * 2);
    ctx.fill();
    const ringR = R * (2.6 - p * 1.4);
    ctx.globalAlpha = 0.5 + 0.5 * p;
    ctx.strokeStyle = withAlpha("#ffffff", 0.7);
    ctx.lineWidth = 2 + p * 2;
    ctx.beginPath();
    ctx.arc(0, 0, ringR, 0, Math.PI * 2);
    ctx.stroke();
    const sparks = 6;
    for (let i = 0; i < sparks; i++) {
      const a = time * 0.006 + (i / sparks) * Math.PI * 2;
      ctx.globalAlpha = 0.6 + 0.4 * pulse;
      ctx.fillStyle = withAlpha(it.color, 0.9);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * ringR, Math.sin(a) * ringR, 2 + p * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Explosion: one of five distinct styles, selected by `variant`.
  _drawBlast(ctx, it) {
    const p = Math.min(1, (it.t - it.glow) / it.blast);
    const e = 1 - Math.pow(1 - p, 3); // ease-out
    const R = it.radius;
    const fade = 1 - p;
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    switch (it.variant) {
      case 0: {
        // Supernova: a bright bloom ring with radial light rays.
        const ringR = R * (1 + e * 7);
        ctx.globalAlpha = fade;
        ctx.lineWidth = R * (0.9 * fade + 0.1);
        ctx.strokeStyle = withAlpha("#ffffff", 0.9 * fade);
        ctx.beginPath();
        ctx.arc(0, 0, ringR, 0, Math.PI * 2);
        ctx.stroke();
        const rays = 12;
        ctx.strokeStyle = withAlpha(it.color, 0.85 * fade);
        ctx.lineWidth = 3 * fade + 1;
        for (let i = 0; i < rays; i++) {
          const a = (i / rays) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R);
          ctx.lineTo(Math.cos(a) * ringR * 1.05, Math.sin(a) * ringR * 1.05);
          ctx.stroke();
        }
        break;
      }
      case 1: {
        // Shockwave: three staggered concentric rings.
        for (let k = 0; k < 3; k++) {
          const pk = p - k * 0.18;
          if (pk <= 0) continue;
          const ek = 1 - Math.pow(1 - Math.min(1, pk), 3);
          const ringR = R * (1 + ek * (6 - k));
          ctx.globalAlpha = (1 - Math.min(1, pk)) * 0.9;
          ctx.lineWidth = 4 * (1 - Math.min(1, pk)) + 1;
          ctx.strokeStyle = withAlpha(k === 0 ? "#ffffff" : it.color, 0.9);
          ctx.beginPath();
          ctx.arc(0, 0, ringR, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
      case 2: {
        // Starburst: a rotating multi-point star flare with a bright core.
        const points = 8;
        const rot = e * 0.8;
        const outer = R * (1 + e * 6);
        const inner = outer * 0.4;
        ctx.globalAlpha = fade;
        ctx.fillStyle = withAlpha(it.color, 0.85 * fade);
        ctx.beginPath();
        for (let i = 0; i < points * 2; i++) {
          const a = rot + (i / (points * 2)) * Math.PI * 2;
          const rr = i % 2 === 0 ? outer : inner;
          const x = Math.cos(a) * rr;
          const y = Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = withAlpha("#ffffff", fade);
        ctx.beginPath();
        ctx.arc(0, 0, inner * 0.5, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 3: {
        // Flash bloom: a quick blinding flash that blooms then fades.
        const bloom = R * (1 + e * 5);
        const a = p < 0.25 ? p / 0.25 : 1 - (p - 0.25) / 0.75;
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, bloom);
        grad.addColorStop(0, withAlpha("#ffffff", 0.95 * a));
        grad.addColorStop(0.4, withAlpha(it.color, 0.7 * a));
        grad.addColorStop(1, withAlpha(it.color, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, bloom, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      default: {
        // Firework: an expanding ring of comet streaks.
        const streaks = 14;
        const reach = R * (1 + e * 7);
        for (let i = 0; i < streaks; i++) {
          const a = (i / streaks) * Math.PI * 2 + e * 0.3;
          ctx.globalAlpha = fade;
          ctx.strokeStyle = withAlpha(i % 2 ? "#ffffff" : it.color, 0.9 * fade);
          ctx.lineWidth = 3 * fade + 1;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * reach * 0.55, Math.sin(a) * reach * 0.55);
          ctx.lineTo(Math.cos(a) * reach, Math.sin(a) * reach);
          ctx.stroke();
        }
        break;
      }
    }
    ctx.restore();
  }
}
