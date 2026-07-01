// Diagnostics: privacy-conscious, explicit-action-only support info.
//
// This module is intentionally pure/testable — it never touches the DOM,
// localStorage, or the network on its own. The game wires two things around
// it (see main.js / ui.js):
//   1. `recordRuntimeError` is called from window "error"/"unhandledrejection"
//      listeners (installed once in main.js) into a small in-memory ring
//      buffer that is SESSION-ONLY — never persisted, cleared on reload.
//   2. `buildDiagnosticsReport` maps the persisted save (+ that in-memory
//      error buffer + a few environment facts supplied by the caller) into a
//      single plain-object report. Nothing is collected, stored, or exported
//      automatically — the player must explicitly open the Diagnostics
//      screen and tap Copy/Share before anything is turned into text.
//
// Only aggregate, non-identifying fields are ever included — this game has
// no accounts, so there is no personal data to protect beyond generic device
// facts (user agent, screen size) a player already sees when sharing a
// screenshot.

export const APP_VERSION = "1.0.0";

export const MAX_DIAGNOSTIC_ERRORS = 20;

// A bounded in-memory ring buffer of runtime errors for THIS SESSION only.
let _errors = [];

// Record one runtime error/rejection. Caller supplies whatever fields it has;
// everything is coerced to a safe, length-capped shape so a huge stack trace
// or message can never bloat the report unboundedly.
export function recordRuntimeError(entry) {
  const clean = {
    message: String((entry && entry.message) || "Unknown error").slice(0, 300),
    source: entry && entry.source ? String(entry.source).slice(0, 200) : "",
    line: Number.isFinite(entry && entry.line) ? entry.line : null,
    col: Number.isFinite(entry && entry.col) ? entry.col : null,
    stack: entry && entry.stack ? String(entry.stack).slice(0, 1000) : "",
    time: Number.isFinite(entry && entry.time) ? entry.time : Date.now(),
  };
  _errors.push(clean);
  if (_errors.length > MAX_DIAGNOSTIC_ERRORS) _errors.shift();
  return clean;
}

export function getRuntimeErrors() {
  return _errors.slice();
}

export function clearRuntimeErrors() {
  _errors = [];
}

// Map the persisted save (a plain object of just the fields the caller wants
// to expose — see ui.js) + a small set of environment facts into a single,
// display/export-ready diagnostics report.
export function buildDiagnosticsReport(save, env = {}) {
  const s = save || {};
  const achv = (s.achievements && s.achievements.claims) || {};
  const chestsClaimed = Object.values(achv).reduce((a, b) => a + (b || 0), 0);
  const pets = s.pets || {};
  const petsOwned = pets.owned ? Object.keys(pets.owned).length : 0;
  const totalStars = Object.values(s.stars || {}).reduce((a, b) => a + (b || 0), 0);
  const puzzlesSolved = Object.keys((s.puzzle && s.puzzle.stars) || {}).length;

  return {
    generatedAt: Number.isFinite(env.now) ? env.now : Date.now(),
    app: {
      version: env.version || APP_VERSION,
      nativeShell: !!env.nativeShell,
    },
    device: {
      userAgent: env.userAgent || "unknown",
      language: env.language || "unknown",
      screen: env.screen || null,
      dpr: Number.isFinite(env.dpr) ? env.dpr : null,
      online: env.online !== false,
    },
    profile: {
      maxUnlockedLevel: s.maxUnlockedLevel || 1,
      totalStars,
      coins: s.coins || 0,
      currentTheme: s.currentTheme || "aurora",
      muted: !!s.muted,
      settings: s.settings || {},
      adsRemoved: !!s.adsRemoved,
      starterPack: !!s.starterPack,
      dailyStreak: (s.daily && s.daily.streak) || 0,
      seasonXp: (s.season && s.season.xp) || 0,
      chestsClaimed,
      petsOwned,
      equippedPet: pets.equipped || null,
      puzzlesSolved,
      highScoreEndless: s.highScoreEndless || 0,
      highScoreTimeAttack: s.highScoreTimeAttack || 0,
      hasActiveSession: !!s.activeSession,
    },
    errors: getRuntimeErrors(),
  };
}

// Flatten a report into display-ready {key, icon, label, value} rows, for the
// same compact grid presentation the Stats screen already uses.
export function diagnosticsRows(report) {
  const r = report || {};
  const a = r.app || {};
  const d = r.device || {};
  const p = r.profile || {};
  return [
    { key: "version", icon: "🧩", label: "App version", value: a.version || "unknown" },
    { key: "level", icon: "🎯", label: "Level reached", value: p.maxUnlockedLevel || 1 },
    { key: "stars", icon: "⭐", label: "Stars", value: p.totalStars || 0 },
    { key: "coins", icon: "🪙", label: "Coins", value: p.coins || 0 },
    { key: "theme", icon: "🎨", label: "Theme", value: p.currentTheme || "aurora" },
    { key: "pets", icon: "🐾", label: "Pets owned", value: p.petsOwned || 0 },
    { key: "puzzles", icon: "🧩", label: "Puzzles solved", value: p.puzzlesSolved || 0 },
    { key: "streak", icon: "📅", label: "Daily streak", value: p.dailyStreak || 0 },
    {
      key: "screen",
      icon: "📱",
      label: "Screen",
      value: d.screen ? `${d.screen.width}×${d.screen.height}` : "unknown",
    },
    { key: "errors", icon: "⚠️", label: "Errors this session", value: (r.errors || []).length },
  ];
}

// A compact, human-readable text block suitable for pasting into a support
// message or bug report (also embeds the raw JSON for anyone who wants it).
export function formatDiagnosticsReport(report) {
  const r = report || {};
  const a = r.app || {};
  const d = r.device || {};
  const p = r.profile || {};
  const errs = r.errors || [];
  const lines = [];
  lines.push("Bubblit! Diagnostics Report");
  lines.push(`Generated: ${new Date(r.generatedAt || Date.now()).toISOString()}`);
  lines.push(`App version: ${a.version} (native: ${a.nativeShell})`);
  lines.push(`Device: ${d.userAgent}`);
  lines.push(
    `Screen: ${d.screen ? `${d.screen.width}x${d.screen.height}@${d.dpr}x` : "unknown"} · online=${d.online}`
  );
  lines.push("");
  lines.push(
    `Level ${p.maxUnlockedLevel} · ${p.totalStars} stars · ${p.coins} coins · theme ${p.currentTheme}`
  );
  lines.push(`Pets: ${p.petsOwned} owned, equipped ${p.equippedPet || "none"}`);
  lines.push(
    `Puzzles solved: ${p.puzzlesSolved} · Daily streak: ${p.dailyStreak} · Chests claimed: ${p.chestsClaimed}`
  );
  lines.push(`Endless best: ${p.highScoreEndless} · Time Attack best: ${p.highScoreTimeAttack}`);
  lines.push(`Settings: ${JSON.stringify(p.settings || {})}`);
  lines.push("");
  lines.push(`Recent errors (${errs.length}):`);
  if (!errs.length) lines.push("  none recorded this session");
  else {
    for (const e of errs) {
      const loc = e.source ? ` (${e.source}:${e.line}:${e.col})` : "";
      lines.push(`  [${new Date(e.time).toISOString()}] ${e.message}${loc}`);
    }
  }
  lines.push("");
  lines.push("--- raw JSON ---");
  lines.push(JSON.stringify(r));
  return lines.join("\n");
}
