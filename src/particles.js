// Lightweight particle system for pop bursts and sparkles.

// Hard cap on live particles. Without it, rapid high-level combo/Fever chains
// stack thousands of additively-blended ("lighter") particles before the old
// ones expire, and per-frame draw cost climbs into a superlinear cliff that
// tanks the framerate on mobile — the "slowdown after progressing". 600 still
// comfortably holds a single big clear's burst while bounding worst-case cost;
// when exceeded we drop the OLDEST particles (already fading) first.
const MAX_PARTICLES = 600;

// Shockwave rings are cheap (a single stroked/filled arc each) but a fever/combo
// storm can still queue a lot, so bound them the same way as particles.
const MAX_RINGS = 48;

// Asset-backed VFX trial: a small, local subset of Kenney's CC0 Particle Pack.
// These sprites layer over the procedural circles/rings so the current effects
// remain a fallback if an image has not finished loading yet.
const MAX_SPRITES = 180;
export const SPRITE_PARTICLE_ASSETS = [
  "./assets/vfx/kenney-particles/star_01.png",
  "./assets/vfx/kenney-particles/star_02.png",
  "./assets/vfx/kenney-particles/star_03.png",
  "./assets/vfx/kenney-particles/star_04.png",
  "./assets/vfx/kenney-particles/circle_01.png",
  "./assets/vfx/kenney-particles/circle_02.png",
  "./assets/vfx/kenney-particles/circle_03.png",
  "./assets/vfx/kenney-particles/flare_01.png",
  "./assets/vfx/kenney-particles/light_01.png",
  "./assets/vfx/kenney-particles/magic_01.png",
  "./assets/vfx/kenney-particles/magic_02.png",
  "./assets/vfx/kenney-particles/twirl_01.png",
];

const SPRITE_BY_STYLE = [
  [0, 4, 5],
  [0, 1, 4, 5, 7],
  [1, 2, 5, 6, 8, 9],
  [2, 3, 6, 7, 8, 9, 10],
  [2, 3, 7, 8, 9, 10, 11],
];

const SPRITE_IMAGES = new Map();

function spriteImage(path) {
  if (SPRITE_IMAGES.has(path)) return SPRITE_IMAGES.get(path);
  if (typeof Image === "undefined") {
    SPRITE_IMAGES.set(path, null);
    return null;
  }
  const img = new Image();
  img.decoding = "async";
  img.src = path;
  SPRITE_IMAGES.set(path, img);
  return img;
}

// Pure: pick one of FIVE escalating explosion styles by the popped group's size.
// The bigger the group, the more impactful the animation — more particles, more
// shockwave rings, then a white flash bloom and a sparkle shower at the top end.
// Exported (and unit-tested) so the tiers stay a single source of truth.
//   style 0 "fizz"      (2-3)  : modest puff, no ring
//   style 1 "pop"       (4-5)  : full burst + one thin ring
//   style 2 "burst"     (6-7)  : bigger burst + ring + sparkle
//   style 3 "blast"     (8-11) : burst + two rings + flash + sparkle
//   style 4 "supernova" (12+)  : burst + three rings + flash + heavy sparkle
export function popStyleForGroup(groupSize) {
  const n = groupSize | 0;
  if (n >= 12) return { style: 4, name: "supernova", perCell: 16, power: 1.7, rings: 3, flash: true, sparkle: 26 };
  if (n >= 8) return { style: 3, name: "blast", perCell: 14, power: 1.4, rings: 2, flash: true, sparkle: 16 };
  if (n >= 6) return { style: 2, name: "burst", perCell: 12, power: 1.2, rings: 1, flash: false, sparkle: 10 };
  if (n >= 4) return { style: 1, name: "pop", perCell: 11, power: 1.0, rings: 1, flash: false, sparkle: 0 };
  return { style: 0, name: "fizz", perCell: 9, power: 0.85, rings: 0, flash: false, sparkle: 0 };
}

export class ParticleSystem {
  constructor() {
    this.particles = [];
    this.rings = [];
    this.sprites = [];
    // Scales emitted particle volume. The reduced-motion accessibility setting
    // lowers this so bursts throw far fewer particles (and shockwave rings are
    // skipped); default 1 leaves emission exactly as before.
    this.motionScale = 1;
    for (const path of SPRITE_PARTICLE_ASSETS) spriteImage(path);
  }

  burst(x, y, color, count = 12, power = 1) {
    const n = this.motionScale <= 0 ? 0 : Math.max(1, Math.round(count * this.motionScale));
    for (let i = 0; i < n; i++) {
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
    const n = this.motionScale <= 0 ? 0 : Math.max(1, Math.round(count * this.motionScale));
    for (let i = 0; i < n; i++) {
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

  spriteBurst(x, y, styleIndex = 0, power = 1) {
    if (this.motionScale <= 0) return;
    const choices = SPRITE_BY_STYLE[Math.max(0, Math.min(SPRITE_BY_STYLE.length - 1, styleIndex | 0))];
    const n = Math.max(1, Math.round((1 + styleIndex) * this.motionScale));
    for (let i = 0; i < n; i++) {
      const assetIndex = choices[(Math.random() * choices.length) | 0];
      const path = SPRITE_PARTICLE_ASSETS[assetIndex];
      const angle = Math.random() * Math.PI * 2;
      const speed = (34 + Math.random() * 130) * power;
      const size = (18 + Math.random() * 34 + styleIndex * 5) * Math.min(1.45, 0.7 + power * 0.45);
      this.sprites.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 26 * power,
        size,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 5,
        life: 0,
        max: 0.36 + Math.random() * 0.26 + styleIndex * 0.035,
        gravity: 150,
        path,
      });
    }
    const over = this.sprites.length - MAX_SPRITES;
    if (over > 0) this.sprites.splice(0, over);
  }

  // Expanding shockwave ring used by the bigger pop-explosion styles. `fill`
  // makes it a soft white flash bloom instead of a hollow ring.
  ring(x, y, color, { maxRadius = 60, width = 4, life = 0.5, fill = false } = {}) {
    // Expanding shockwaves are exactly the kind of large motion reduced-motion
    // users want to avoid, so skip them when motion is dialled down.
    if (this.motionScale < 0.6) return;
    this.rings.push({ x, y, color, r0: 6, maxRadius, width, life: 0, max: life, fill });
    const over = this.rings.length - MAX_RINGS;
    if (over > 0) this.rings.splice(0, over);
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
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.life += dt;
      if (ring.life >= ring.max) this.rings.splice(i, 1);
    }
    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const s = this.sprites[i];
      s.life += dt;
      if (s.life >= s.max) {
        this.sprites.splice(i, 1);
        continue;
      }
      s.vy += s.gravity * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.rot += s.vr * dt;
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
    for (const ring of this.rings) {
      const t = ring.life / ring.max;
      const rad = ring.r0 + (ring.maxRadius - ring.r0) * t;
      ctx.globalAlpha = Math.max(0, (1 - t) * (ring.fill ? 0.45 : 0.85));
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, Math.max(0, rad), 0, Math.PI * 2);
      if (ring.fill) {
        ctx.fillStyle = ring.color;
        ctx.fill();
      } else {
        ctx.strokeStyle = ring.color;
        ctx.lineWidth = Math.max(0.5, ring.width * (1 - t * 0.5));
        ctx.stroke();
      }
    }
    for (const s of this.sprites) {
      const img = spriteImage(s.path);
      if (!img || !img.complete || !img.naturalWidth) continue;
      const t = s.life / s.max;
      const size = s.size * (1 - t * 0.22);
      ctx.globalAlpha = Math.max(0, (1 - t) * 0.92);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    ctx.restore();
  }

  get count() {
    return this.particles.length;
  }

  get spriteCount() {
    return this.sprites.length;
  }
}
