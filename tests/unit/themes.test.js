import { describe, it, expect } from "vitest";
import {
  THEMES,
  getTheme,
  isThemeUnlocked,
  themeTokens,
  applyThemeCss,
} from "../../src/themes.js";

describe("themes", () => {
  it("includes the default aurora theme", () => {
    expect(getTheme("aurora").id).toBe("aurora");
  });

  it("falls back to the first theme for unknown ids", () => {
    expect(getTheme("does-not-exist")).toBe(THEMES[0]);
  });

  it("every theme defines colours and a background", () => {
    for (const t of THEMES) {
      expect(t.bubbles.length).toBeGreaterThanOrEqual(4);
      expect(t.bg0).toMatch(/^#/);
      expect(t.bg1).toMatch(/^#/);
    }
  });

  it("ships a broad theme catalog", () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(15);
  });

  it("includes the new Eclipse Bloom theme, gated behind the next star tier", () => {
    const eclipse = getTheme("eclipse");
    expect(eclipse.id).toBe("eclipse");
    expect(eclipse.price).toBe(0);
    expect(eclipse.unlockStars).toBeGreaterThan(0);
    // Sits beyond every other free/star-gated theme's threshold.
    const starGated = THEMES.filter((t) => t.price === 0 && t.id !== "eclipse");
    for (const t of starGated) expect(eclipse.unlockStars).toBeGreaterThanOrEqual(t.unlockStars);
  });

  it("uses unique theme ids", () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("owned themes are always unlocked", () => {
    const t = THEMES.find((x) => x.price > 0);
    expect(isThemeUnlocked(t, 0, [t.id])).toBe(true);
  });

  it("priced themes stay locked until purchased", () => {
    const priced = THEMES.find((x) => x.price > 0);
    expect(isThemeUnlocked(priced, 9999, [])).toBe(false);
  });

  it("star-gated themes unlock at the threshold", () => {
    const gated = THEMES.find((x) => x.price === 0 && x.unlockStars > 0);
    expect(isThemeUnlocked(gated, gated.unlockStars - 1, [])).toBe(false);
    expect(isThemeUnlocked(gated, gated.unlockStars, [])).toBe(true);
  });

  it("applyThemeCss writes CSS custom properties", () => {
    applyThemeCss(getTheme("aurora"));
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--bg-0")).toBe(getTheme("aurora").bg0);
    expect(root.getPropertyValue("--ui-accent")).toBe(getTheme("aurora").bubbles[0]);
    expect(root.getPropertyValue("--ui-gradient")).toContain(getTheme("aurora").bubbles[1]);
  });

  it("themeTokens derives stable chrome tokens from each theme palette", () => {
    for (const t of THEMES) {
      const tokens = themeTokens(t);
      expect(tokens.primary).toBe(t.bubbles[0]);
      expect(tokens.secondary).toBe(t.bubbles[1]);
      expect(tokens.surface).toMatch(/^rgba\(/);
      expect(tokens.border).toMatch(/^rgba\(/);
      expect(tokens.gradient).toContain(t.bubbles[0]);
      expect(tokens.gradient).toContain(t.bubbles[1]);
      expect(["#08122a", "#ffffff"]).toContain(tokens.onPrimary);
    }
  });

  it("themeTokens falls back to aurora for unknown themes", () => {
    expect(themeTokens("nope").primary).toBe(getTheme("aurora").bubbles[0]);
  });
});
