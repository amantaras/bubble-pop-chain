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
  {
    id: "ember",
    name: "Ember Forge",
    desc: "Molten reds and brass",
    bg0: "#1a0d07",
    bg1: "#3a170d",
    bubbles: ["#ff6f3c", "#ffb347", "#ffd166", "#ff3b30", "#ff8fab", "#ffa600"],
    unlockStars: 36,
    price: 0,
  },
  {
    id: "tidal",
    name: "Tidal Current",
    desc: "Ocean blues in motion",
    bg0: "#061523",
    bg1: "#0a2a44",
    bubbles: ["#3ec1ff", "#5be3ff", "#4d9dff", "#64f0ff", "#6b8bff", "#7afcff"],
    unlockStars: 48,
    price: 0,
  },
  {
    id: "glacier",
    name: "Glacier Mint",
    desc: "Cold glass and mint light",
    bg0: "#08131a",
    bg1: "#13303d",
    bubbles: ["#9ffcff", "#77f2e4", "#d6fff6", "#8edcff", "#8af5b4", "#b0e0ff"],
    unlockStars: 0,
    price: 700,
  },
  {
    id: "voltage",
    name: "Neon Voltage",
    desc: "Arcade electric contrast",
    bg0: "#09090f",
    bg1: "#19192a",
    bubbles: ["#00f5ff", "#39ff14", "#ffea00", "#ff2bd6", "#ff6b00", "#8a5cff"],
    unlockStars: 0,
    price: 1400,
  },
  {
    id: "orchard",
    name: "Moon Orchard",
    desc: "Night fruit glow",
    bg0: "#111018",
    bg1: "#241c33",
    bubbles: ["#ff5c8a", "#ff9f5c", "#f9f871", "#7bd389", "#6bc7ff", "#b38cff"],
    unlockStars: 60,
    price: 0,
  },
  {
    id: "horizon",
    name: "Steel Horizon",
    desc: "Gunmetal with bright accents",
    bg0: "#0e121a",
    bg1: "#1d2a3a",
    bubbles: ["#7aa2ff", "#83e8ff", "#ffd166", "#ff6b8a", "#9be564", "#c38dff"],
    unlockStars: 0,
    price: 900,
  },
  {
    id: "prism",
    name: "Prism Pulse",
    desc: "Spectral neon spectrum",
    bg0: "#130d1f",
    bg1: "#2b1b47",
    bubbles: ["#ff4d6d", "#ff7f50", "#ffd166", "#70e000", "#4cc9f0", "#9d4edd"],
    unlockStars: 75,
    price: 0,
  },
  {
    id: "sandstorm",
    name: "Sandstorm",
    desc: "Desert dusk heat",
    bg0: "#1b120a",
    bg1: "#3a2514",
    bubbles: ["#ffbe0b", "#fb8500", "#ffd6a5", "#ff7b7b", "#a8dadc", "#bdb2ff"],
    unlockStars: 90,
    price: 0,
  },
  {
    id: "petal",
    name: "Petal Rain",
    desc: "Floral candy night",
    bg0: "#160d19",
    bg1: "#31163a",
    bubbles: ["#ff8cc6", "#ffc6ff", "#f1f7b5", "#b8f2e6", "#a0c4ff", "#cdb4db"],
    unlockStars: 0,
    price: 1000,
  },
  {
    id: "nova",
    name: "Solar Nova",
    desc: "Deep space flare",
    bg0: "#070a14",
    bg1: "#151f3d",
    bubbles: ["#ffb703", "#fb8500", "#ff5d8f", "#7b2cbf", "#4cc9f0", "#90f1ef"],
    unlockStars: 110,
    price: 0,
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
