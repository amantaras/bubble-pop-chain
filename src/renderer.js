// Canvas renderer: animated background + glossy neon bubbles.

import { RAINBOW, ICE, ICE_CRACKED, NORMAL, LIGHTNING, STONE, BOMB, MULTIPLIER, COIN, VINE } from "./grid.js";

// Distinct glyphs used by colourblind mode — one per colour index. There are
// always at least as many symbols as a level has colours.
export const CB_SYMBOLS = ["●", "▲", "■", "◆", "★", "✚", "▼", "⬢"];

export const SPECIAL_ICON_ASSETS = {
  [LIGHTNING]: "./assets/icons/game-icons/lightning-bolt.svg",
  [STONE]: "./assets/icons/game-icons/padlock.svg",
  [BOMB]: "./assets/icons/game-icons/bomb.svg",
  [MULTIPLIER]: "./assets/icons/game-icons/multiplication.svg",
  [COIN]: "./assets/icons/game-icons/coin.svg",
  [VINE]: "./assets/icons/game-icons/vine-leaf.svg",
  [ICE]: "./assets/icons/game-icons/snowflake.svg",
  [ICE_CRACKED]: "./assets/icons/game-icons/snowflake.svg",
};

const THEME_MOTIFS = {
  aurora: { kind: "ribbons", count: 5, alpha: 0.15 },
  sunset: { kind: "arcs", count: 7, alpha: 0.13 },
  forest: { kind: "leaves", count: 26, alpha: 0.12 },
  candy: { kind: "sprinkles", count: 42, alpha: 0.13 },
  mono: { kind: "prism", count: 8, alpha: 0.15 },
  ember: { kind: "embers", count: 34, alpha: 0.14 },
  tidal: { kind: "waves", count: 6, alpha: 0.14 },
  glacier: { kind: "shards", count: 18, alpha: 0.13 },
  voltage: { kind: "bolts", count: 12, alpha: 0.16 },
  orchard: { kind: "petals", count: 30, alpha: 0.13 },
  horizon: { kind: "scanlines", count: 12, alpha: 0.11 },
  prism: { kind: "facets", count: 16, alpha: 0.14 },
  sandstorm: { kind: "dunes", count: 7, alpha: 0.12 },
  petal: { kind: "petals", count: 38, alpha: 0.15 },
  nova: { kind: "stars", count: 62, alpha: 0.18 },
};

export function themeMotif(themeId) {
  return THEME_MOTIFS[themeId] || THEME_MOTIFS.aurora;
}

const _iconImageCache = new Map();

function specialIconImage(path) {
  if (_iconImageCache.has(path)) return _iconImageCache.get(path);
  if (typeof Image === "undefined") {
    _iconImageCache.set(path, null);
    return null;
  }
  const img = new Image();
  img.decoding = "async";
  img.src = path;
  _iconImageCache.set(path, img);
  return img;
}

// The colour helpers below are pure functions of (hex, factor) and are called
// several times per bubble, every frame, from `drawBubbles`. The set of inputs
// is tiny and finite — a theme's palette (≈6–8 colours) crossed with the
// handful of literal factor constants used in the draw code — so memoizing
// them removes thousands of redundant hex-parses + string allocations per
// second on a busy board without changing a single output. The caches are
// therefore naturally bounded by that finite key space.
const _rgbCache = new Map();
const _shadeCache = new Map();
const _lightenCache = new Map();

export function hexToRgb(hex) {
  let v = _rgbCache.get(hex);
  if (v !== undefined) return v;
  const h = hex.replace("#", "");
  v = {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
  _rgbCache.set(hex, v);
  return v;
}

export function shade(hex, factor) {
  const key = hex + "|" + factor;
  let v = _shadeCache.get(key);
  if (v !== undefined) return v;
  const { r, g, b } = hexToRgb(hex);
  const f = factor < 0 ? 0 : factor;
  v = `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`;
  _shadeCache.set(key, v);
  return v;
}

export function lighten(hex, amt) {
  const key = hex + "|" + amt;
  let v = _lightenCache.get(key);
  if (v !== undefined) return v;
  const { r, g, b } = hexToRgb(hex);
  const l = (val) => Math.round(val + (255 - val) * amt);
  v = `rgb(${l(r)}, ${l(g)}, ${l(b)})`;
  _lightenCache.set(key, v);
  return v;
}

export class Renderer {
  constructor(ctx) {
    this.ctx = ctx;
    // When true, each colour gets a distinct symbol drawn on its bubbles so
    // players who can't easily tell hues apart can still read the board.
    this.colorblind = false;
    this.reducedMotion = false;
    for (const path of Object.values(SPECIAL_ICON_ASSETS)) specialIconImage(path);
  }

  drawBackground(w, h, theme, time) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, theme.bg1);
    g.addColorStop(1, theme.bg0);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Two slowly drifting soft glows for depth.
    const blobs = [
      { c: theme.bubbles[0], ox: 0.25, oy: 0.2, sp: 0.00013, rad: 0.55 },
      { c: theme.bubbles[1], ox: 0.78, oy: 0.75, sp: 0.00009, rad: 0.6 },
    ];
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.1;
    for (const b of blobs) {
      const x = (b.ox + Math.sin(time * b.sp) * 0.08) * w;
      const y = (b.oy + Math.cos(time * b.sp * 1.3) * 0.08) * h;
      const rad = b.rad * Math.max(w, h);
      const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
      rg.addColorStop(0, b.c);
      rg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
    this._drawThemeMotif(w, h, theme, time);
  }

  _drawThemeMotif(w, h, theme, time) {
    const motif = themeMotif(theme.id);
    const ctx = this.ctx;
    const t = this.reducedMotion ? 0 : time * 0.001;
    const max = Math.max(w, h);
    const colors = theme.bubbles;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = motif.alpha;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (motif.kind === "ribbons") {
      for (let i = 0; i < motif.count; i++) {
        const y = h * (0.12 + i * 0.16) + Math.sin(t * 0.55 + i) * 18;
        ctx.strokeStyle = colors[i % colors.length];
        ctx.lineWidth = 2 + i * 0.5;
        ctx.beginPath();
        ctx.moveTo(-w * 0.1, y);
        ctx.bezierCurveTo(w * 0.18, y - 80, w * 0.48, y + 90, w * 1.08, y - 24);
        ctx.stroke();
      }
    } else if (motif.kind === "arcs") {
      ctx.strokeStyle = colors[2] || "#ffd35b";
      for (let i = 0; i < motif.count; i++) {
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(w * 0.76, h * 0.2, 48 + i * 34 + Math.sin(t + i) * 3, 0.08, Math.PI * 1.15);
        ctx.stroke();
      }
    } else if (motif.kind === "waves") {
      for (let i = 0; i < motif.count; i++) {
        const y = h * (0.18 + i * 0.13);
        ctx.strokeStyle = colors[i % colors.length];
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = -20; x <= w + 20; x += 24) {
          const yy = y + Math.sin(x * 0.018 + t * 0.8 + i) * 18;
          if (x === -20) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    } else if (motif.kind === "dunes") {
      ctx.globalAlpha = motif.alpha * 0.9;
      for (let i = 0; i < motif.count; i++) {
        const y = h * (0.55 + i * 0.07);
        ctx.strokeStyle = colors[i % colors.length];
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-20, y);
        ctx.quadraticCurveTo(w * 0.25, y - 42, w * 0.52, y + 6);
        ctx.quadraticCurveTo(w * 0.78, y + 50, w + 20, y - 8);
        ctx.stroke();
      }
    } else if (motif.kind === "scanlines") {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "rgba(190,220,255,0.16)";
      ctx.lineWidth = 1;
      for (let i = 0; i < motif.count; i++) {
        const y = ((i + 1) / (motif.count + 1)) * h;
        ctx.beginPath();
        ctx.moveTo(w * 0.08, y);
        ctx.lineTo(w * 0.92, y + Math.sin(t + i) * 4);
        ctx.stroke();
      }
    } else {
      for (let i = 0; i < motif.count; i++) {
        const seed = i * 97.13;
        const x = ((Math.sin(seed) * 43758.5453) % 1 + 1) % 1 * w;
        const baseY = ((Math.sin(seed * 1.37) * 24634.6345) % 1 + 1) % 1 * h;
        const drift = this.reducedMotion ? 0 : ((t * (8 + (i % 5) * 2) + i * 17) % (h + 80));
        const y = (baseY + drift) % (h + 80) - 40;
        ctx.strokeStyle = colors[i % colors.length];
        ctx.fillStyle = colors[(i + 1) % colors.length];
        const r = 4 + (i % 5) * 2;
        if (motif.kind === "leaves" || motif.kind === "petals") {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(seed + t * 0.12);
          ctx.beginPath();
          ctx.ellipse(0, 0, r * 0.65, r * 1.6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else if (motif.kind === "embers" || motif.kind === "stars") {
          ctx.beginPath();
          ctx.arc(x, y, motif.kind === "stars" ? Math.max(1, r * 0.28) : r * 0.45, 0, Math.PI * 2);
          ctx.fill();
        } else if (motif.kind === "shards" || motif.kind === "facets" || motif.kind === "prism") {
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(x, y - r * 1.5);
          ctx.lineTo(x + r, y);
          ctx.lineTo(x, y + r * 1.5);
          ctx.lineTo(x - r, y);
          ctx.closePath();
          ctx.stroke();
        } else if (motif.kind === "bolts") {
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(x + r * 0.4, y - r * 1.5);
          ctx.lineTo(x - r * 0.4, y);
          ctx.lineTo(x + r * 0.25, y);
          ctx.lineTo(x - r * 0.5, y + r * 1.6);
          ctx.stroke();
        } else if (motif.kind === "sprinkles") {
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(x - r, y - r * 0.3);
          ctx.lineTo(x + r, y + r * 0.3);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  drawBoardFrame(board) {
    const ctx = this.ctx;
    const pad = 8;
    const x = board.originX - pad;
    const y = board.originY - pad;
    const w = board.boardW + pad * 2;
    const h = board.boardH + pad * 2;
    const r = 20;
    ctx.save();
    ctx.beginPath();
    this._roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.stroke();
    ctx.restore();
  }

  // Downpour danger line: a pulsing dashed warning band `dangerRows` cells down
  // from the top of the board, shown once the rising stack climbs into that
  // zone. `proximity` (0..1) is how close the player is to being buried (1 = a
  // bubble sits on the very top edge), brightening and quickening the pulse.
  drawDangerLine(board, time, dangerRows, proximity) {
    const ctx = this.ctx;
    const y = board.originY + dangerRows * board.cell;
    const pulse = 0.5 + 0.5 * Math.sin(time * (0.006 + proximity * 0.01));
    const a = Math.min(0.9, (0.25 + 0.6 * proximity) * pulse);
    ctx.save();
    ctx.strokeStyle = `rgba(255,80,92,${a})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(board.originX, y);
    ctx.lineTo(board.originX + board.boardW, y);
    ctx.stroke();
    ctx.restore();
  }

  // `aim` (optional) describes an in-progress magnet: { color, intensity, time }.
  // Plain bubbles of that colour jitter — harder as the gauge nears green —
  // as if straining to pull together before the gather fires.
  // `markColor` (optional, -1 = none) tags every plain bubble of that colour
  // with a small target pip — used by the "Colour Purge" boss so the player
  // can see exactly which bubbles must be cleared.
  drawBubbles(board, theme, aim, markColor = -1) {
    const ctx = this.ctx;
    // Fill more of the cell so bubbles read as crisp, defined orbs instead of
    // small blobs floating in a haze of glow.
    const radius = board.cell * 0.46;
    for (const s of board.sprites) {
      if (s.alpha <= 0) continue;
      const hex = theme.bubbles[s.color % theme.bubbles.length];
      const rad = radius * s.scale;
      if (rad <= 0.5) continue;

      ctx.save();
      ctx.globalAlpha = s.alpha;

      // Magnet aim shake: offset the whole bubble by a small jitter whose
      // amplitude scales with how close the gauge is to the green sweet spot.
      if (
        aim &&
        aim.intensity > 0.02 &&
        s.color === aim.color &&
        s.type === NORMAL
      ) {
        const amp = aim.intensity * board.cell * 0.12;
        const ph = s.id * 0.7;
        const t = aim.time * 0.05;
        ctx.translate(
          Math.sin(t + ph) * amp,
          Math.cos(t * 1.27 + ph * 1.6) * amp
        );
      }

      // No glow on the body: a soft shadow halo around every orb is exactly
      // what made the bubbles read as blurry/out-of-focus. The neon vibe comes
      // from the vivid fill + crisp rim instead, so the silhouette stays sharp.
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;

      // A tight contact shadow below each orb gives the board more depth
      // without blurring the bubble itself.
      ctx.globalAlpha = s.alpha * 0.28;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.beginPath();
      ctx.ellipse(
        s.x,
        s.y + rad * 0.56,
        rad * 0.7,
        rad * 0.18,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.globalAlpha = s.alpha;

      // Body gradient — rainbow bubbles use a multi-hue sweep. Normal bubbles
      // get a candy-like depth ramp with a bright crown, saturated middle and
      // darker lower edge so they read less flat while staying crisp.
      const grad = ctx.createRadialGradient(
        s.x - rad * 0.38,
        s.y - rad * 0.44,
        rad * 0.05,
        s.x,
        s.y + rad * 0.08,
        rad * 1.05
      );
      if (s.type === RAINBOW) {
        grad.addColorStop(0.0, "#ffffff");
        grad.addColorStop(0.2, "#ff7aaa");
        grad.addColorStop(0.42, "#ffd75f");
        grad.addColorStop(0.64, "#54f2a0");
        grad.addColorStop(0.82, "#5f9dff");
        grad.addColorStop(1.0, "#5d42d6");
        ctx.shadowColor = "#ffffff";
      } else {
        grad.addColorStop(0, lighten(hex, 0.82));
        grad.addColorStop(0.2, lighten(hex, 0.34));
        grad.addColorStop(0.58, hex);
        grad.addColorStop(0.86, shade(hex, 0.68));
        grad.addColorStop(1, shade(hex, 0.36));
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(s.x, s.y, rad, 0, Math.PI * 2);
      ctx.fill();

      // A clipped upper wash adds glassy refraction without spilling outside
      // the orb edge.
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x, s.y, rad * 0.98, 0, Math.PI * 2);
      ctx.clip();
      const wash = ctx.createLinearGradient(s.x, s.y - rad, s.x, s.y + rad);
      wash.addColorStop(0, "rgba(255,255,255,0.34)");
      wash.addColorStop(0.38, "rgba(255,255,255,0.05)");
      wash.addColorStop(0.72, "rgba(255,255,255,0)");
      ctx.fillStyle = wash;
      ctx.beginPath();
      ctx.ellipse(
        s.x - rad * 0.08,
        s.y - rad * 0.26,
        rad * 0.86,
        rad * 0.5,
        -0.18,
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.restore();

      // Crisp double rim: a thin dark outer edge sharply separates each bubble
      // from its neighbours, with a bright inner highlight ring for a glossy,
      // high-definition finish.
      ctx.shadowBlur = 0;
      ctx.globalAlpha = s.alpha;
      ctx.lineWidth = Math.max(1.25, rad * 0.075);
      ctx.strokeStyle =
        s.type === RAINBOW ? "rgba(255,255,255,0.85)" : shade(hex, 0.32);
      ctx.beginPath();
      ctx.arc(s.x, s.y, rad - ctx.lineWidth * 0.5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = s.alpha * 0.68;
      ctx.lineWidth = Math.max(1, rad * 0.055);
      ctx.strokeStyle =
        s.type === RAINBOW ? "rgba(255,255,255,0.7)" : lighten(hex, 0.62);
      ctx.beginPath();
      ctx.arc(s.x, s.y, rad * 0.82, -2.4, -0.2);
      ctx.stroke();

      ctx.globalAlpha = s.alpha * 0.34;
      ctx.lineWidth = Math.max(1, rad * 0.045);
      ctx.strokeStyle = "rgba(255,255,255,0.72)";
      ctx.beginPath();
      ctx.arc(s.x, s.y + rad * 0.1, rad * 0.58, 0.25, 2.55);
      ctx.stroke();

      // Glossy highlights (no shadow)
      ctx.shadowBlur = 0;
      ctx.globalAlpha = s.alpha * 0.9;
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.beginPath();
      ctx.ellipse(
        s.x - rad * 0.32,
        s.y - rad * 0.4,
        rad * 0.24,
        rad * 0.15,
        -0.5,
        0,
        Math.PI * 2
      );
      ctx.fill();

      ctx.globalAlpha = s.alpha * 0.55;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.ellipse(
        s.x + rad * 0.22,
        s.y - rad * 0.48,
        rad * 0.08,
        rad * 0.055,
        0.2,
        0,
        Math.PI * 2
      );
      ctx.fill();

      // Colourblind aid: stamp a per-colour symbol on plain bubbles so each
      // colour is identifiable by shape, not just hue.
      if (this.colorblind && s.type === NORMAL) {
        const sym = CB_SYMBOLS[s.color % CB_SYMBOLS.length];
        ctx.shadowBlur = 0;
        ctx.globalAlpha = s.alpha;
        ctx.font = `${Math.round(rad * 1.05)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = Math.max(1.5, rad * 0.14);
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.strokeText(sym, s.x, s.y);
        ctx.fillText(sym, s.x, s.y);
      }

      // Ice overlay: frosty tint, rim, and cracks once chipped.
      if (s.type === ICE || s.type === ICE_CRACKED) {
        ctx.globalAlpha = s.alpha * 0.55;
        ctx.fillStyle = "rgba(220,245,255,0.7)";
        ctx.beginPath();
        ctx.arc(s.x, s.y, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = s.alpha;
        ctx.lineWidth = Math.max(1.5, rad * 0.12);
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.arc(s.x, s.y, rad * 0.92, 0, Math.PI * 2);
        ctx.stroke();
        if (s.type === ICE_CRACKED) {
          ctx.lineWidth = Math.max(1, rad * 0.08);
          ctx.strokeStyle = "rgba(120,160,200,0.95)";
          ctx.beginPath();
          ctx.moveTo(s.x - rad * 0.6, s.y - rad * 0.3);
          ctx.lineTo(s.x, s.y);
          ctx.lineTo(s.x - rad * 0.1, s.y + rad * 0.6);
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x + rad * 0.55, s.y - rad * 0.45);
          ctx.stroke();
        }
        this._drawSpecialIcon(s.type, s.x, s.y, rad, s.alpha, {
          size: 0.78,
          shadow: "rgba(150,230,255,0.95)",
          glow: 0.28,
        });
      }

      // Lightning overlay: a glowing yellow bolt glyph that pulses, marking a
      // charged bubble whose group also clears its row + column.
      if (s.type === LIGHTNING) {
        const pulse = 0.6 + 0.4 * Math.abs(Math.sin(performance.now() / 220));
        ctx.globalAlpha = s.alpha;
        ctx.shadowColor = "rgba(255,232,90,0.95)";
        ctx.shadowBlur = rad * 0.9 * pulse;
        ctx.fillStyle = "rgba(255,236,120,0.98)";
        ctx.strokeStyle = "rgba(120,80,0,0.85)";
        ctx.lineWidth = Math.max(1, rad * 0.08);
        const k = rad;
        ctx.beginPath();
        ctx.moveTo(s.x + k * 0.18, s.y - k * 0.6);
        ctx.lineTo(s.x - k * 0.3, s.y + k * 0.08);
        ctx.lineTo(s.x + k * 0.02, s.y + k * 0.08);
        ctx.lineTo(s.x - k * 0.18, s.y + k * 0.6);
        ctx.lineTo(s.x + k * 0.34, s.y - k * 0.12);
        ctx.lineTo(s.x + k * 0.02, s.y - k * 0.12);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        this._drawSpecialIcon(s.type, s.x, s.y, rad, s.alpha, {
          size: 0.9,
          shadow: "rgba(255,232,90,0.98)",
          glow: 0.5,
        });
      }

      // Stone overlay: a locked grey shell with a padlock mark, signalling a
      // bubble that can't be tapped — only an adjacent pop (or AoE) frees it.
      if (s.type === STONE) {
        ctx.globalAlpha = s.alpha * 0.92;
        ctx.shadowBlur = 0;
        const sg = ctx.createRadialGradient(
          s.x - rad * 0.3,
          s.y - rad * 0.3,
          rad * 0.1,
          s.x,
          s.y,
          rad
        );
        sg.addColorStop(0, "rgba(150,156,168,0.97)");
        sg.addColorStop(1, "rgba(78,84,96,0.97)");
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(s.x, s.y, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, rad * 0.12);
        ctx.strokeStyle = "rgba(40,44,52,0.85)";
        ctx.beginPath();
        ctx.arc(s.x, s.y, rad * 0.9, 0, Math.PI * 2);
        ctx.stroke();
        // Padlock glyph.
        ctx.globalAlpha = s.alpha;
        ctx.fillStyle = "rgba(235,238,244,0.95)";
        ctx.strokeStyle = "rgba(40,44,52,0.9)";
        ctx.lineWidth = Math.max(1, rad * 0.1);
        const bw = rad * 0.62;
        const bh = rad * 0.5;
        ctx.beginPath();
        ctx.rect(s.x - bw / 2, s.y - bh * 0.1, bw, bh);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(s.x, s.y - bh * 0.1, bw * 0.34, Math.PI, 0);
        ctx.stroke();
        this._drawSpecialIcon(s.type, s.x, s.y + rad * 0.05, rad, s.alpha, {
          size: 0.72,
          shadow: "rgba(40,44,52,0.85)",
          glow: 0.15,
        });
      }

      // Bomb overlay: a dark explosive shell with a lit fuse spark, marking a
      // bubble whose group also detonates a 3×3 blast when popped.
      if (s.type === BOMB) {
        ctx.globalAlpha = s.alpha;
        ctx.shadowColor = "rgba(255,150,60,0.9)";
        ctx.shadowBlur = rad * 0.6;
        // Round dark body.
        const bg = ctx.createRadialGradient(
          s.x - rad * 0.3,
          s.y - rad * 0.2,
          rad * 0.1,
          s.x,
          s.y,
          rad * 0.92
        );
        bg.addColorStop(0, "rgba(80,84,92,0.98)");
        bg.addColorStop(1, "rgba(24,26,32,0.98)");
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(s.x, s.y + rad * 0.08, rad * 0.66, 0, Math.PI * 2);
        ctx.fill();
        // Highlight glint.
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(235,238,244,0.5)";
        ctx.beginPath();
        ctx.arc(s.x - rad * 0.22, s.y - rad * 0.12, rad * 0.14, 0, Math.PI * 2);
        ctx.fill();
        // Fuse cap + lit spark.
        ctx.strokeStyle = "rgba(210,170,90,0.95)";
        ctx.lineWidth = Math.max(1.5, rad * 0.12);
        ctx.beginPath();
        ctx.moveTo(s.x + rad * 0.28, s.y - rad * 0.42);
        ctx.quadraticCurveTo(
          s.x + rad * 0.6,
          s.y - rad * 0.6,
          s.x + rad * 0.42,
          s.y - rad * 0.74
        );
        ctx.stroke();
        const spark = 0.6 + 0.4 * Math.abs(Math.sin(performance.now() / 140));
        ctx.shadowColor = "rgba(255,210,90,0.95)";
        ctx.shadowBlur = rad * 0.7 * spark;
        ctx.fillStyle = "rgba(255,224,120,0.98)";
        ctx.beginPath();
        ctx.arc(s.x + rad * 0.42, s.y - rad * 0.78, rad * 0.13 * spark, 0, Math.PI * 2);
        ctx.fill();
        this._drawSpecialIcon(s.type, s.x, s.y + rad * 0.06, rad, s.alpha, {
          size: 0.96,
          shadow: "rgba(255,150,60,0.95)",
          glow: 0.42,
        });
      }

      if (s.type === MULTIPLIER) {
        ctx.globalAlpha = s.alpha;
        const pulse = 0.6 + 0.4 * Math.abs(Math.sin(performance.now() / 240));
        // Golden glowing ring around the bubble.
        ctx.shadowColor = "rgba(255,210,70,0.95)";
        ctx.shadowBlur = rad * 0.7 * pulse;
        ctx.strokeStyle = "rgba(255,214,90,0.95)";
        ctx.lineWidth = Math.max(1.6, rad * 0.14);
        ctx.beginPath();
        ctx.arc(s.x, s.y, rad * 0.7, 0, Math.PI * 2);
        ctx.stroke();
        // Bold “×2” glyph in the centre.
        ctx.shadowBlur = rad * 0.4 * pulse;
        ctx.fillStyle = "rgba(255,236,160,0.98)";
        ctx.font = `700 ${Math.round(rad * 0.92)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("×2", s.x, s.y + rad * 0.04);
        ctx.shadowBlur = 0;
        this._drawSpecialIcon(s.type, s.x, s.y, rad, s.alpha, {
          size: 0.72,
          shadow: "rgba(255,210,70,0.95)",
          glow: 0.3,
        });
      }

      if (s.type === COIN) {
        ctx.globalAlpha = s.alpha;
        const pulse = 0.6 + 0.4 * Math.abs(Math.sin(performance.now() / 220));
        // Shiny gold coin disc with a glow.
        ctx.shadowColor = "rgba(255,200,50,0.95)";
        ctx.shadowBlur = rad * 0.6 * pulse;
        const cg = ctx.createRadialGradient(
          s.x - rad * 0.25,
          s.y - rad * 0.25,
          rad * 0.08,
          s.x,
          s.y,
          rad * 0.62
        );
        cg.addColorStop(0, "rgba(255,236,150,0.98)");
        cg.addColorStop(1, "rgba(212,158,40,0.98)");
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(s.x, s.y, rad * 0.6, 0, Math.PI * 2);
        ctx.fill();
        // Inner rim + currency glyph.
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(255,248,200,0.85)";
        ctx.lineWidth = Math.max(1, rad * 0.07);
        ctx.beginPath();
        ctx.arc(s.x, s.y, rad * 0.44, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "rgba(150,100,20,0.9)";
        ctx.font = `700 ${Math.round(rad * 0.7)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("$", s.x, s.y + rad * 0.04);
        this._drawSpecialIcon(s.type, s.x, s.y, rad, s.alpha, {
          size: 0.74,
          shadow: "rgba(255,200,50,0.95)",
          glow: 0.28,
        });
      }

      if (s.type === VINE) {
        ctx.globalAlpha = s.alpha;
        const pulse = 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 300));
        // Creeping green tendrils wrapping the bubble.
        ctx.shadowColor = "rgba(60,200,90,0.9)";
        ctx.shadowBlur = rad * 0.5 * pulse;
        ctx.strokeStyle = "rgba(70,210,100,0.95)";
        ctx.lineWidth = Math.max(1.6, rad * 0.16);
        ctx.lineCap = "round";
        // A pair of curling vine strokes across the bubble.
        for (let i = 0; i < 2; i++) {
          const dir = i === 0 ? 1 : -1;
          ctx.beginPath();
          ctx.moveTo(s.x - rad * 0.55 * dir, s.y - rad * 0.5);
          ctx.quadraticCurveTo(
            s.x + rad * 0.2 * dir,
            s.y,
            s.x - rad * 0.5 * dir,
            s.y + rad * 0.55
          );
          ctx.stroke();
        }
        // A couple of leaf dots so it reads as a vine, not a scribble.
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(120,235,140,0.95)";
        const leaf = (lx, ly) => {
          ctx.beginPath();
          ctx.arc(lx, ly, rad * 0.14, 0, Math.PI * 2);
          ctx.fill();
        };
        leaf(s.x + rad * 0.32, s.y - rad * 0.34);
        leaf(s.x - rad * 0.34, s.y + rad * 0.3);
        this._drawSpecialIcon(s.type, s.x, s.y, rad, s.alpha, {
          size: 0.88,
          shadow: "rgba(70,210,100,0.95)",
          glow: 0.34,
        });
      }

      // Boss "Colour Purge" marker: a crisp target pip on every plain bubble of
      // the hunted colour so the objective is unambiguous.
      if (markColor >= 0 && s.type === NORMAL && s.color === markColor) {
        ctx.globalAlpha = s.alpha;
        ctx.shadowBlur = 0;
        const pr = rad * 0.3;
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.strokeStyle = "rgba(20,20,30,0.85)";
        ctx.lineWidth = Math.max(1, rad * 0.08);
        ctx.beginPath();
        ctx.arc(s.x, s.y, pr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(s.x, s.y, pr * 0.45, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(20,20,30,0.85)";
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  // Highlight the group that a long-press is previewing, and show the
  // projected score above it so players can plan their pops.
  drawPreview(board, preview, theme) {
    const ctx = this.ctx;
    const cells = preview.cells;
    if (!cells || !cells.length) return;
    const radius = board.cell * 0.46;
    const pulse = 0.6 + 0.25 * Math.sin(performance.now() / 140);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = `rgba(255,255,255,${pulse})`;
    ctx.lineWidth = Math.max(2, board.cell * 0.06);
    let cx = 0,
      minY = Infinity;
    for (const cell of cells) {
      const p = board.targetPixel(cell.c, cell.r);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      cx += p.x;
      if (p.y < minY) minY = p.y;
    }
    ctx.restore();

    // Projected score label centred above the group.
    cx /= cells.length;
    ctx.save();
    ctx.font = `700 ${Math.round(board.cell * 0.5)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 6;
    ctx.fillStyle = preview.size >= 6 ? "#ffd35b" : "#ffffff";
    ctx.fillText(`+${preview.points}`, cx, minY - radius - 4);
    ctx.restore();
  }

  // Idle-assist hint: a marching-ants cyan ring around the suggested group so
  // a stuck player can spot a valid move. Purely cosmetic.
  drawHint(board, cells, time) {
    if (!cells || !cells.length) return;
    const ctx = this.ctx;
    const t = (time || performance.now()) / 1000;
    const radius = board.cell * 0.5;
    const pulse = 0.4 + 0.35 * (0.5 + 0.5 * Math.sin(t * 5));
    const dash = board.cell * 0.22;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(25,245,255,0.08)";
    for (const cell of cells) {
      const p = board.targetPixel(cell.c, cell.r);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius * 0.92, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = `rgba(120,240,255,${pulse})`;
    ctx.lineWidth = Math.max(2, board.cell * 0.08);
    ctx.setLineDash([dash, dash * 0.7]);
    ctx.lineDashOffset = -t * board.cell * 2;
    for (const cell of cells) {
      const p = board.targetPixel(cell.c, cell.r);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "rgba(255,255,255,0.78)";
    ctx.lineWidth = Math.max(1, board.cell * 0.025);
    for (const cell of cells) {
      const p = board.targetPixel(cell.c, cell.r);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius * 0.64, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Archer companion aim: stretch line, sweet-power gauge, and predicted cells.
  drawArcherAim(board, aim, time) {
    if (!aim || !aim.start || !aim.end) return;
    const ctx = this.ctx;
    const t = (time || performance.now()) / 1000;
    const sx = aim.start.x;
    const sy = aim.start.y;
    const ex = aim.end.x;
    const ey = aim.end.y;
    const dx = ex - sx;
    const dy = ey - sy;
    const len = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / len;
    const uy = dy / len;
    const power = Math.max(0, Math.min(1, aim.power || 0));
    const sweet = aim.sweet == null ? 0.68 : aim.sweet;
    const tooShort = !!aim.tooShort;
    const good = !!aim.good || Math.abs(power - sweet) <= 0.12;
    const color = tooShort ? "#ffd35b" : good ? "#b7ff5b" : "#ffffff";
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = tooShort ? "rgba(255,211,91,0.82)" : good ? "rgba(183,255,91,0.95)" : "rgba(255,255,255,0.78)";
    ctx.lineWidth = Math.max(4, board.cell * (good ? 0.1 : 0.08));
    ctx.shadowColor = color;
    ctx.shadowBlur = good ? 24 : 12;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    if (tooShort) {
      ctx.beginPath();
      ctx.arc(sx, sy, board.cell * (0.48 + 0.06 * Math.sin(t * 8)), 0, Math.PI * 2);
      ctx.stroke();
    }
    // Arrow head.
    const head = board.cell * 0.34;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - ux * head - uy * head * 0.45, ey - uy * head + ux * head * 0.45);
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - ux * head + uy * head * 0.45, ey - uy * head - ux * head * 0.45);
    ctx.stroke();
    // Predicted pierced cells.
    const radius = board.cell * (0.42 + 0.04 * Math.sin(t * 9));
    ctx.strokeStyle = good ? "rgba(183,255,91,0.98)" : "rgba(255,255,255,0.66)";
    ctx.lineWidth = Math.max(2, board.cell * 0.055);
    for (const cell of aim.cells || []) {
      const p = board.targetPixel(cell.c, cell.r);
      ctx.fillStyle = good ? "rgba(183,255,91,0.18)" : "rgba(255,255,255,0.1)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius * 0.82, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Compact power gauge beside the drag origin.
    const gx = sx - board.cell * 1.15;
    const gy = sy - board.cell * 1.25;
    const gw = board.cell * 2.3;
    const gh = Math.max(8, board.cell * 0.16);
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(0,0,0,0.46)";
    ctx.fillRect(gx, gy, gw, gh);
    ctx.fillStyle = "rgba(183,255,91,0.9)";
    ctx.fillRect(gx + gw * (sweet - 0.12), gy, gw * 0.24, gh);
    ctx.fillStyle = tooShort ? "#ffd35b" : good ? "#b7ff5b" : "#ffffff";
    ctx.fillRect(gx, gy, gw * power, gh);
    ctx.strokeStyle = "rgba(255,255,255,0.72)";
    ctx.lineWidth = 1;
    ctx.strokeRect(gx, gy, gw, gh);
    ctx.font = `${Math.max(10, board.cell * 0.18)}px sans-serif`;
    ctx.fillStyle = tooShort ? "#ffd35b" : good ? "#b7ff5b" : "rgba(255,255,255,0.86)";
    ctx.textAlign = "center";
    ctx.fillText(tooShort ? "DRAG" : good ? "BULLSEYE" : "AIM", gx + gw / 2, gy - 5);
    ctx.restore();
  }

  // Charged Blast cue: briefly highlight the best blast center (highest
  // immediate clear) when double-tap becomes available.
  drawBlastCue(board, cue, time) {
    if (!cue) return;
    const ctx = this.ctx;
    const p = board.targetPixel(cue.c, cue.r);
    const life = Number.isFinite(cue.duration) && cue.duration > 0
      ? Math.max(0, cue.timer / cue.duration)
      : 1;
    const t = (time || performance.now()) / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * 12);
    const snap = 0.5 + 0.5 * Math.sin(t * 28);
    const alpha = (0.5 + 0.45 * pulse) * Math.max(0.65, life);
    const r = board.cell * (0.72 + 0.12 * pulse);
    const j = board.cell * (0.08 + 0.04 * snap);
    const jx = Math.sin(t * 42) * j + Math.sin(t * 81) * board.cell * 0.025;
    const jy = Math.cos(t * 39) * j + Math.cos(t * 73) * board.cell * 0.025;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(jx, jy);

    ctx.fillStyle = "rgba(10,6,20,0.5)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, board.cell * 0.86, 0, Math.PI * 2);
    ctx.fill();

    const glow = ctx.createRadialGradient(p.x, p.y, board.cell * 0.1, p.x, p.y, board.cell * 1.25);
    glow.addColorStop(0, `rgba(255,235,120,${0.28 * alpha})`);
    glow.addColorStop(0.45, `rgba(255,75,170,${0.22 * alpha})`);
    glow.addColorStop(1, "rgba(255,75,170,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, board.cell * (1.12 + 0.1 * pulse), 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(255,95,170,${alpha})`;
    ctx.lineWidth = Math.max(3, board.cell * 0.1);
    ctx.setLineDash([board.cell * 0.18, board.cell * 0.12]);
    ctx.lineDashOffset = -t * board.cell * 3.2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = `rgba(255,255,255,${0.65 * alpha})`;
    ctx.lineWidth = Math.max(2, board.cell * 0.045);
    ctx.beginPath();
    ctx.arc(p.x, p.y, board.cell * 0.56, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.lineWidth = Math.max(2, board.cell * 0.08);
    ctx.strokeStyle = `rgba(255,238,130,${Math.min(1, alpha + 0.18)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, board.cell * (0.34 + 0.05 * snap), 0, Math.PI * 2);
    ctx.stroke();

    const tick = board.cell * (0.34 + 0.06 * pulse);
    const gap = board.cell * 0.58;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(3, board.cell * 0.09);
    ctx.strokeStyle = `rgba(255,245,170,${Math.min(1, alpha + 0.1)})`;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.beginPath();
      ctx.moveTo(p.x + dx * gap, p.y + dy * gap);
      ctx.lineTo(p.x + dx * (gap + tick), p.y + dy * (gap + tick));
      ctx.stroke();
    }

    ctx.fillStyle = `rgba(255,255,210,${0.75 * alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, board.cell * (0.1 + 0.03 * snap), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  _drawSpecialIcon(type, x, y, rad, alpha = 1, opts = {}) {
    const path = SPECIAL_ICON_ASSETS[type];
    if (!path) return false;
    const img = specialIconImage(path);
    if (!img || !img.complete || !img.naturalWidth) return false;
    const ctx = this.ctx;
    const size = rad * 2 * (opts.size || 0.82);
    ctx.save();
    ctx.globalAlpha = alpha * (opts.alpha || 0.9);
    ctx.shadowColor = opts.shadow || "rgba(255,255,255,0.8)";
    ctx.shadowBlur = rad * (opts.glow || 0.24);
    ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    ctx.restore();
    return true;
  }
}

