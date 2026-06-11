// Visual themes: neon-on-dark palettes. Bubble colors are picked from `bubbles`.
// `unlockStars` of 0 means free/default. `price` > 0 means buyable with coins.

export const THEMES = [
  {
    id: "aurora",
    name: "Aurora",
    desc: "Default neon glow",
    bg0: "#0b1020",
    bg1: "#1b2147",
    bubbles: ["#5be3ff", "#b06bff", "#5bff9b", "#ffd35b", "#ff6b8b", "#6b8bff"],
    unlockStars: 0,
    price: 0,
  },
  {
    id: "sunset",
    name: "Sunset",
    desc: "Warm dusk tones",
    bg0: "#1a0b16",
    bg1: "#3a142c",
    bubbles: ["#ff8a5b", "#ff5b8a", "#ffd35b", "#c45bff", "#5bd6ff", "#ff5b5b"],
    unlockStars: 9,
    price: 0,
  },
  {
    id: "forest",
    name: "Bioluminescent",
    desc: "Deep forest light",
    bg0: "#06140f",
    bg1: "#0d2a1f",
    bubbles: ["#5bff9b", "#9bff5b", "#5be3ff", "#d9ff5b", "#5b9bff", "#ff5bd6"],
    unlockStars: 24,
    price: 0,
  },
  {
    id: "candy",
    name: "Candy Pop",
    desc: "Sweet pastel neon",
    bg0: "#160b1a",
    bg1: "#2a1240",
    bubbles: ["#ff7eb6", "#7afcff", "#feff9c", "#b28dff", "#7affa0", "#ff9c7a"],
    unlockStars: 0,
    price: 600,
  },
  {
    id: "mono",
    name: "Ultraviolet",
    desc: "Premium violet set",
    bg0: "#0a0820",
    bg1: "#1a1040",
    bubbles: ["#8b5bff", "#c45bff", "#5b8bff", "#5be3ff", "#e05bff", "#5bffe3"],
    unlockStars: 0,
    price: 1200,
  },
];

export function getTheme(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

export function isThemeUnlocked(theme, totalStars, ownedThemes) {
  if (ownedThemes.includes(theme.id)) return true;
  if (theme.price > 0) return false; // must be bought
  return totalStars >= theme.unlockStars;
}

// Apply a theme's background to the CSS custom properties.
export function applyThemeCss(theme) {
  const r = document.documentElement.style;
  r.setProperty("--bg-0", theme.bg0);
  r.setProperty("--bg-1", theme.bg1);
  r.setProperty("--bg-2", theme.bg1);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme.bg0);
}
