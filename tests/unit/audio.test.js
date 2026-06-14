import { describe, it, expect } from "vitest";
import { MUSIC_PROFILES, musicProfile } from "../../src/audio.js";
import { THEMES } from "../../src/themes.js";

describe("background music profiles", () => {
  it("musicProfile resolves each defined theme to its own profile", () => {
    for (const id of Object.keys(MUSIC_PROFILES)) {
      expect(musicProfile(id).id).toBe(id);
    }
  });

  it("musicProfile falls back to the aurora track for unknown themes", () => {
    expect(musicProfile("does-not-exist").id).toBe("aurora");
    expect(musicProfile(undefined).id).toBe("aurora");
  });

  it("every visual theme has a matching music profile", () => {
    for (const t of THEMES) {
      // Resolves (either an exact profile or the documented default fallback).
      expect(musicProfile(t.id)).toBeTruthy();
    }
  });

  it("each profile is well-formed (scale, bass, tempo, gentle gains)", () => {
    for (const [key, p] of Object.entries(MUSIC_PROFILES)) {
      expect(p.id).toBe(key);
      expect(p.tempo).toBeGreaterThan(0);
      expect(Array.isArray(p.scale)).toBe(true);
      expect(p.scale.length).toBeGreaterThanOrEqual(4);
      expect(Array.isArray(p.bass)).toBe(true);
      expect(p.bass.length).toBeGreaterThanOrEqual(2);
      // All tones are audible positive frequencies.
      for (const f of [...p.scale, ...p.bass]) {
        expect(f).toBeGreaterThan(0);
      }
      // Music voices stay quiet so they sit under the SFX.
      expect(p.melodyGain).toBeGreaterThan(0);
      expect(p.melodyGain).toBeLessThan(0.3);
      expect(p.bassGain).toBeGreaterThan(0);
      expect(p.bassGain).toBeLessThan(0.3);
      expect(p.noteDur).toBeGreaterThan(0);
      expect(typeof p.wave).toBe("string");
      expect(typeof p.bassWave).toBe("string");
    }
  });

  it("distinct themes use distinct tracks (no two share a scale)", () => {
    const sigs = Object.values(MUSIC_PROFILES).map((p) => p.scale.join(","));
    expect(new Set(sigs).size).toBe(sigs.length);
  });
});
