import { describe, it, expect } from "vitest";
import {
  THEMES,
  getTheme,
  isThemeUnlocked,
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
  });
});
