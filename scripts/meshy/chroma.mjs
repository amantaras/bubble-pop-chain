// Chroma-key background removal shared by generate.mjs and ad-hoc tuning runs.
import sharp from "sharp";

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

// AI-rendered "solid" backgrounds are rarely the exact hex requested (and often
// carry a soft vignette/glow gradient near the subject), so by default we
// sample the actual corner pixels of the image and average them to find the
// real background color instead of trusting the prompt's hex literally.
async function sampleCornerColor(data, width, height, channels, margin = 4) {
  const pts = [
    [margin, margin],
    [width - 1 - margin, margin],
    [margin, height - 1 - margin],
    [width - 1 - margin, height - 1 - margin],
  ];
  let r = 0, g = 0, b = 0;
  for (const [x, y] of pts) {
    const o = (y * width + x) * channels;
    r += data[o];
    g += data[o + 1];
    b += data[o + 2];
  }
  return { r: r / pts.length, g: g / pts.length, b: b / pts.length };
}

export async function chromaKeyOut(buf, { color = "auto", threshold = 70, feather = 60 } = {}) {
  const img = sharp(buf).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const target = color === "auto" ? await sampleCornerColor(data, width, height, channels) : hexToRgb(color);
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const dist = Math.sqrt((r - target.r) ** 2 + (g - target.g) ** 2 + (b - target.b) ** 2);
    if (dist <= threshold) {
      data[o + 3] = 0;
    } else if (dist <= threshold + feather) {
      const t = (dist - threshold) / feather; // 0 at threshold -> 1 at threshold+feather
      data[o + 3] = Math.round(255 * t);
    }
  }
  return { buffer: await sharp(data, { raw: { width, height, channels } }).png().toBuffer(), target };
}
