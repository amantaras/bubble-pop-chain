// Canvas renderer: animated background + glossy neon bubbles.

import { RAINBOW, ICE, ICE_CRACKED } from "./grid.js";

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

  drawBubbles(board, theme) {
    const ctx = this.ctx;
    const radius = board.cell * 0.42;
    for (const s of board.sprites) {
      if (s.alpha <= 0) continue;
      const hex = theme.bubbles[s.color % theme.bubbles.length];
      const rad = radius * s.scale;
      if (rad <= 0.5) continue;

      ctx.save();
      ctx.globalAlpha = s.alpha;

      // Glow
      ctx.shadowColor = hex;
      ctx.shadowBlur = board.cell * 0.28;

      // Body gradient — rainbow bubbles use a multi-hue sweep.
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
        grad.addColorStop(0, lighten(hex, 0.55));
        grad.addColorStop(0.45, hex);
        grad.addColorStop(1, shade(hex, 0.55));
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(s.x, s.y, rad, 0, Math.PI * 2);
      ctx.fill();

      // Glossy highlight (no shadow)
      ctx.shadowBlur = 0;
      ctx.globalAlpha = s.alpha * 0.7;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.ellipse(
        s.x - rad * 0.32,
        s.y - rad * 0.4,
        rad * 0.28,
        rad * 0.18,
        -0.5,
        0,
        Math.PI * 2
      );
      ctx.fill();

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
