// Canvas renderer: animated background + glossy neon bubbles.

import { RAINBOW, ICE, ICE_CRACKED, NORMAL, LIGHTNING, STONE, BOMB, MULTIPLIER } from "./grid.js";

// Distinct glyphs used by colourblind mode — one per colour index. There are
// always at least as many symbols as a level has colours.
export const CB_SYMBOLS = ["●", "▲", "■", "◆", "★", "✚", "▼", "⬢"];

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function shade(hex, factor) {
  const { r, g, b } = hexToRgb(hex);
  const f = factor < 0 ? 0 : factor;
  return `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`;
}

function lighten(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  const l = (v) => Math.round(v + (255 - v) * amt);
  return `rgb(${l(r)}, ${l(g)}, ${l(b)})`;
}

export class Renderer {
  constructor(ctx) {
    this.ctx = ctx;
    // When true, each colour gets a distinct symbol drawn on its bubbles so
    // players who can't easily tell hues apart can still read the board.
    this.colorblind = false;
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

      // Body gradient — rainbow bubbles use a multi-hue sweep. The edge stays
      // saturated (only lightly shaded) so bubbles read as vivid, defined orbs
      // instead of fading into the dark board.
      const grad = ctx.createRadialGradient(
        s.x - rad * 0.35,
        s.y - rad * 0.4,
        rad * 0.1,
        s.x,
        s.y,
        rad
      );
      if (s.type === RAINBOW) {
        grad.addColorStop(0.0, "#ffffff");
        grad.addColorStop(0.25, "#ff5b8d");
        grad.addColorStop(0.5, "#ffd35b");
        grad.addColorStop(0.72, "#5bff9b");
        grad.addColorStop(1.0, "#6ea8ff");
        ctx.shadowColor = "#ffffff";
      } else {
        grad.addColorStop(0, lighten(hex, 0.65));
        grad.addColorStop(0.5, hex);
        grad.addColorStop(1, shade(hex, 0.7));
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(s.x, s.y, rad, 0, Math.PI * 2);
      ctx.fill();

      // Crisp double rim: a thin dark outer edge sharply separates each bubble
      // from its neighbours, with a bright inner highlight ring for a glossy,
      // high-definition finish.
      ctx.shadowBlur = 0;
      ctx.globalAlpha = s.alpha;
      ctx.lineWidth = Math.max(1.25, rad * 0.07);
      ctx.strokeStyle =
        s.type === RAINBOW ? "rgba(255,255,255,0.8)" : shade(hex, 0.42);
      ctx.beginPath();
      ctx.arc(s.x, s.y, rad - ctx.lineWidth * 0.5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = s.alpha * 0.5;
      ctx.lineWidth = Math.max(1, rad * 0.06);
      ctx.strokeStyle =
        s.type === RAINBOW ? "rgba(255,255,255,0.6)" : lighten(hex, 0.5);
      ctx.beginPath();
      ctx.arc(s.x, s.y, rad * 0.82, -2.4, -0.2);
      ctx.stroke();

      // Glossy highlight (no shadow)
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
}

export { hexToRgb };
