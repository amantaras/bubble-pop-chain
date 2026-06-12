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
  //   opts.kind    — "gather" | "cleanse"
  //   opts.icon    — pet emoji to fly across the screen
  //   opts.anchor  — { x, y } focal point of the ability (pixels)
  //   opts.targets — [{ x, y }, ...] affected bubble centres (pixels)
  //   opts.color   — accent colour for trails/sparkles
  play(opts = {}) {
    const targets = Array.isArray(opts.targets) ? opts.targets : [];
    let cx = opts.anchor ? opts.anchor.x : 0;
    let cy = opts.anchor ? opts.anchor.y : 0;
    if (!opts.anchor && targets.length) {
      cx = targets.reduce((a, t) => a + t.x, 0) / targets.length;
      cy = targets.reduce((a, t) => a + t.y, 0) / targets.length;
    }
    this.items.push({
      kind: opts.kind === "cleanse" ? "cleanse" : "gather",
      icon: opts.icon || "🐾",
      color: opts.color || "#9be7ff",
      cx,
      cy,
      targets,
      life: 0,
      enter: 0.42,
      act: 0.6,
      exit: 0.4,
    });
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
    const L = it.life;
    const hoverX = it.cx;
    const hoverY = it.cy - 60;
    // Entry origin depends on ability: Rover dashes in from the left, Whiskers
    // drops down from above.
    const origin =
      it.kind === "cleanse"
        ? { x: it.cx, y: it.cy - 320 }
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
}
