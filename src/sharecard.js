// Shareable score card: after a run, the player can share a small canvas-
// rendered "trophy card" image via the native Share sheet (or download it as
// a fallback) to invite friends — a fully client-side, no-backend viral loop.
//
// This module is split into a PURE data/caption builder (easily unit tested)
// and a canvas painter (drawShareCard) that turns that data into pixels.
// Nothing here ever transmits anything on its own — sharing/downloading only
// happens when the player explicitly taps the Share button (wired in ui.js).

// A short rotating set of punchy captions so repeated shares don't all read
// identically. Deterministic per score (not Math.random) so the same result
// always produces the same caption — keeps this testable and reproducible.
export const CAPTIONS = [
  "Chain-popped my way to a new high score!",
  "Bubbles didn't stand a chance today.",
  "Can you beat this chain?",
  "Popping, combos, and chaos — come try it.",
  "Fresh high score, fresh bragging rights.",
];

export function captionForScore(score) {
  const n = Math.abs(Math.round(Number(score) || 0));
  return CAPTIONS[n % CAPTIONS.length];
}

// Build the plain-data content for the card (and the accompanying share
// text). Pure — no DOM, no canvas, no Storage access.
export function buildShareCardData({
  appName = "Bubblit!",
  modeLabel = "Bubblit!",
  score = 0,
  themeId = "aurora",
  date = new Date(),
} = {}) {
  return {
    appName,
    modeLabel,
    score: Math.max(0, Math.round(Number(score) || 0)),
    themeId: themeId || "aurora",
    dateLabel: date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
    caption: captionForScore(score),
  };
}

// The text that accompanies the shared image (and stands alone on platforms
// that can only share text, not files).
export function shareCardText(data) {
  const d = data || {};
  return `${d.caption || `Just played ${d.appName || "Bubblit!"}!`} ${d.modeLabel || ""} score: ${
    d.score || 0
  } 🫧`
    .replace(/\s+/g, " ")
    .trim();
}

function wrapText(ctx, text, cx, y, maxWidth, lineHeight) {
  const words = String(text || "").split(" ").filter(Boolean);
  let line = "";
  let curY = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    const w = ctx.measureText(test).width || 0;
    if (w > maxWidth && line) {
      ctx.fillText(line, cx, curY);
      line = word;
      curY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, cx, curY);
  return curY;
}

// Paint the card onto a 2D canvas context. `palette` is THEMES-shaped
// ({ bg0, bg1, bubbles: [...] }); callers pass the player's current theme so
// the card matches what they were actually playing. Purely presentational —
// safe to call repeatedly and never mutates `data`/`palette`.
export function drawShareCard(ctx, width, height, data, palette) {
  const d = data || {};
  const p = palette || {
    bg0: "#0b1020",
    bg1: "#1b2147",
    bubbles: ["#5be3ff", "#b06bff", "#5bff9b", "#ffd35b", "#ff6b8b", "#6b8bff"],
  };
  const bubbleColors = Array.isArray(p.bubbles) && p.bubbles.length ? p.bubbles : ["#5be3ff"];

  ctx.save();
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, p.bg1 || "#1b2147");
  bg.addColorStop(1, p.bg0 || "#0b1020");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Decorative bubbles from the current theme's palette.
  for (let i = 0; i < 10; i++) {
    const color = bubbleColors[i % bubbleColors.length];
    const r = width * (0.05 + 0.03 * (i % 4));
    const x = (width / 10) * i + (i % 2 === 0 ? width * 0.02 : -width * 0.02);
    const y = height * (0.1 + 0.05 * ((i * 3) % 5));
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${Math.round(height * 0.07)}px -apple-system, system-ui, sans-serif`;
  ctx.fillText(d.appName || "Bubblit!", width / 2, height * 0.22);

  ctx.font = `700 ${Math.round(height * 0.035)}px -apple-system, system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillText(d.modeLabel || "", width / 2, height * 0.3);

  ctx.font = `600 ${Math.round(height * 0.03)}px -apple-system, system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText("SCORE", width / 2, height * 0.44);

  ctx.font = `900 ${Math.round(height * 0.14)}px -apple-system, system-ui, sans-serif`;
  ctx.fillStyle = "#ffd35b";
  ctx.fillText(String(d.score || 0), width / 2, height * 0.53);

  ctx.font = `600 ${Math.round(height * 0.032)}px -apple-system, system-ui, sans-serif`;
  ctx.fillStyle = "#ffffff";
  wrapText(ctx, d.caption || "", width / 2, height * 0.68, width * 0.8, height * 0.045);

  ctx.font = `500 ${Math.round(height * 0.024)}px -apple-system, system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillText(d.dateLabel || "", width / 2, height * 0.94);
  ctx.restore();
}
