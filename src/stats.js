// Stats / Profile dashboard: a pure, read-only aggregation of the player's
// lifetime counters and current profile state into display-ready stat rows.
// Every value comes from the persisted save object; this module never mutates
// anything, which keeps it trivially unit-testable.

// Format a non-negative integer with thousands separators. The grouping is
// done manually (not via toLocaleString) so the output is stable regardless of
// the host machine's locale — important for deterministic tests.
export function formatStat(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Lifetime totals, sourced from the achievement progress counters that gameplay
// already accumulates (pops, best combo, biggest group, fevers, levels cleared,
// stars, defuses, coins earned). Returns display-ready rows.
export function lifetimeStats(save) {
  const p = (save && save.achievements && save.achievements.progress) || {};
  return [
    { key: "pops", icon: "👆", label: "Bubbles popped", value: p.pops || 0 },
    { key: "bestCombo", icon: "⚡", label: "Best combo", value: p.bestCombo || 0 },
    { key: "biggestGroup", icon: "💥", label: "Biggest group", value: p.biggestGroup || 0 },
    { key: "fevers", icon: "🔥", label: "Fevers triggered", value: p.fevers || 0 },
    { key: "levelsCleared", icon: "🏁", label: "Levels cleared", value: p.levelsCleared || 0 },
    { key: "totalStars", icon: "⭐", label: "Stars earned", value: p.totalStars || 0 },
    { key: "defuses", icon: "🛡️", label: "Bombs defused", value: p.defuses || 0 },
    { key: "coinsEarned", icon: "💰", label: "Coins earned", value: p.coinsEarned || 0 },
  ];
}

// Current-profile snapshot: where the player is right now (level reached, coins,
// high scores, collections, login streak). Read-only.
export function profileStats(save) {
  const s = save || {};
  const petsOwned = s.pets && s.pets.owned ? Object.keys(s.pets.owned).length : 0;
  const themes = Array.isArray(s.ownedThemes) ? s.ownedThemes.length : 0;
  const levelReached = Math.max(1, s.maxUnlockedLevel || 1);
  const daily = s.daily || {};
  return [
    { key: "levelReached", icon: "🎯", label: "Level reached", value: levelReached },
    { key: "coins", icon: "🪙", label: "Coins", value: s.coins || 0 },
    { key: "endlessBest", icon: "♾️", label: "Endless best", value: s.highScoreEndless || 0 },
    { key: "timeAttackBest", icon: "⏱️", label: "Time Attack best", value: s.highScoreTimeAttack || 0 },
    { key: "pets", icon: "🐾", label: "Pets collected", value: petsOwned },
    { key: "themes", icon: "🎨", label: "Themes unlocked", value: themes },
    { key: "streak", icon: "📅", label: "Daily streak", value: daily.streak || 0 },
    { key: "bestStreak", icon: "🏆", label: "Best streak", value: daily.bestStreak || 0 },
  ];
}

// Both sections at once, in the order the dashboard renders them.
export function buildStats(save) {
  return { profile: profileStats(save), lifetime: lifetimeStats(save) };
}
