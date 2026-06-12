// Lightweight particle system for pop bursts and sparkles.

// Hard cap on live particles. Without it, rapid high-level combo/Fever chains
// stack thousands of additively-blended ("lighter") particles before the old
// ones expire, and per-frame draw cost climbs into a superlinear cliff that
// tanks the framerate on mobile — the "slowdown after progressing". 600 still
// comfortably holds a single big clear's burst while bounding worst-case cost;
// when exceeded we drop the OLDEST particles (already fading) first.
const MAX_PARTICLES = 600;

export class ParticleSystem {
  constructor() {
    this.particles = [];
  }

  burst(x, y, color, count = 12, power = 1) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (60 + Math.random() * 180) * power;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40 * power,
        size: 3 + Math.random() * 5,
        color,
        life: 0,
        max: 0.5 + Math.random() * 0.4,
        gravity: 520,
      });
    }
    this._cap();
  }

  sparkle(x, y, color, count = 6) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 20 + Math.random() * 60;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2 + Math.random() * 3,
        color,
        life: 0,
        max: 0.6 + Math.random() * 0.5,
        gravity: 0,
      });
    }
    this._cap();
  }

  // Trim the oldest particles when the pool exceeds the cap so a burst storm
  // can never grow the per-frame draw cost without bound.
  _cap() {
    const over = this.particles.length - MAX_PARTICLES;
    if (over > 0) this.particles.splice(0, over);
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.particles) {
      const t = p.life / p.max;
      const alpha = 1 - t;
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - t * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  get count() {
    return this.particles.length;
  }
}
