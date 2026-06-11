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
