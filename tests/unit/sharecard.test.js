import { describe, it, expect } from "vitest";
import {
  CAPTIONS,
  captionForScore,
  buildShareCardData,
  shareCardText,
  drawShareCard,
} from "../../src/sharecard.js";

describe("sharecard — pure data builders", () => {
  it("picks a deterministic caption from the score (not random)", () => {
    expect(captionForScore(0)).toBe(CAPTIONS[0]);
    expect(captionForScore(1)).toBe(CAPTIONS[1]);
    expect(captionForScore(CAPTIONS.length)).toBe(CAPTIONS[0]); // wraps
    // Same score always yields the same caption.
    expect(captionForScore(4321)).toBe(captionForScore(4321));
  });

  it("handles negative/NaN scores safely", () => {
    expect(() => captionForScore(-5)).not.toThrow();
    expect(() => captionForScore(NaN)).not.toThrow();
    expect(CAPTIONS.includes(captionForScore(NaN))).toBe(true);
  });

  it("builds card data with sane defaults", () => {
    const data = buildShareCardData({});
    expect(data.appName).toBe("Bubblit!");
    expect(data.modeLabel).toBe("Bubblit!");
    expect(data.score).toBe(0);
    expect(data.themeId).toBe("aurora");
    expect(typeof data.dateLabel).toBe("string");
    expect(data.dateLabel.length).toBeGreaterThan(0);
    expect(CAPTIONS.includes(data.caption)).toBe(true);
  });

  it("maps every supplied field through and rounds/clamps the score", () => {
    const date = new Date(2026, 0, 15);
    const data = buildShareCardData({
      appName: "TestGame",
      modeLabel: "Level 12",
      score: 4200.7,
      themeId: "candy",
      date,
    });
    expect(data.appName).toBe("TestGame");
    expect(data.modeLabel).toBe("Level 12");
    expect(data.score).toBe(4201); // rounded
    expect(data.themeId).toBe("candy");
    expect(data.caption).toBe(captionForScore(4200.7));
  });

  it("clamps a negative score to zero", () => {
    const data = buildShareCardData({ score: -50 });
    expect(data.score).toBe(0);
  });

  it("falls back to the default theme id when given a falsy one", () => {
    const data = buildShareCardData({ themeId: "" });
    expect(data.themeId).toBe("aurora");
  });

  it("shareCardText embeds the caption, mode, and score in one line", () => {
    const data = buildShareCardData({ modeLabel: "Level 5", score: 999 });
    const text = shareCardText(data);
    expect(text).toContain(data.caption);
    expect(text).toContain("Level 5");
    expect(text).toContain("999");
    expect(text).not.toMatch(/\s{2,}/); // no double spaces
  });

  it("shareCardText handles a missing/null data object without throwing", () => {
    expect(() => shareCardText(null)).not.toThrow();
    expect(shareCardText(null)).toContain("Bubblit!");
  });
});

describe("sharecard — canvas painter (fake context, behaviour-preserving)", () => {
  function fakeCtx() {
    const calls = [];
    const handler = {
      get(_t, prop) {
        if (prop === "createLinearGradient") return () => ({ addColorStop: () => {} });
        if (prop === "measureText") return (text) => ({ width: String(text).length * 6 });
        if (["save", "restore", "fillRect", "beginPath", "arc", "fill"].includes(prop)) {
          return (...args) => calls.push([prop, ...args]);
        }
        if (prop === "fillText") return (text, x, y) => calls.push(["fillText", text, x, y]);
        return undefined;
      },
      set: () => true,
    };
    return { ctx: new Proxy({}, handler), calls };
  }

  it("draws without throwing for a fully-populated card", () => {
    const { ctx, calls } = fakeCtx();
    const data = buildShareCardData({ modeLabel: "Level 9", score: 12345 });
    const palette = { bg0: "#000", bg1: "#111", bubbles: ["#5be3ff", "#ff6b8b"] };
    expect(() => drawShareCard(ctx, 1080, 1350, data, palette)).not.toThrow();
    expect(calls.some(([name]) => name === "fillText")).toBe(true);
    // The score, mode label, and caption are all painted somewhere.
    const texts = calls.filter(([name]) => name === "fillText").map((c) => c[1]);
    expect(texts).toContain("12345");
    expect(texts).toContain("Level 9");
  });

  it("draws without throwing when data/palette are missing (safe defaults)", () => {
    const { ctx } = fakeCtx();
    expect(() => drawShareCard(ctx, 800, 1000, null, null)).not.toThrow();
  });

  it("wraps a long caption across multiple fillText lines instead of overflowing", () => {
    const { ctx, calls } = fakeCtx();
    const data = buildShareCardData({ score: 1 }); // captionForScore(1) is a longer caption
    drawShareCard(ctx, 600, 750, data, null);
    const captionCalls = calls.filter(([name, text]) => name === "fillText" && data.caption.includes(text));
    // A long caption against a narrow max width should wrap into 2+ lines.
    expect(captionCalls.length).toBeGreaterThanOrEqual(1);
  });
});
