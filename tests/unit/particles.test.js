import { describe, it, expect } from "vitest";
import { ParticleSystem } from "../../src/particles.js";

describe("ParticleSystem", () => {
  it("burst and sparkle add the requested number of particles", () => {
    const ps = new ParticleSystem();
    ps.burst(10, 20, "#ff0000", 12, 1);
    expect(ps.count).toBe(12);
    ps.sparkle(10, 20, "#ffffff", 6);
    expect(ps.count).toBe(18);
  });

  it("update advances life and removes particles once they expire", () => {
    const ps = new ParticleSystem();
    ps.sparkle(0, 0, "#fff", 4);
    expect(ps.count).toBe(4);
    // Each sparkle lives at most ~1.1s; a long step expires them all.
    ps.update(2);
    expect(ps.count).toBe(0);
  });

  it("caps the live pool so a burst storm can't grow without bound", () => {
    const ps = new ParticleSystem();
    // Request far more than the cap across many rapid bursts.
    for (let i = 0; i < 100; i++) ps.burst(0, 0, "#fff", 24, 1);
    expect(ps.count).toBe(600);
    // A single big clear is unaffected (well under the cap).
    const fresh = new ParticleSystem();
    fresh.burst(0, 0, "#fff", 480, 1);
    expect(fresh.count).toBe(480);
  });

  it("keeps the most recent particles when trimming over the cap", () => {
    const ps = new ParticleSystem();
    // Fill exactly to the cap with a marker colour, then push newer ones that
    // must survive while the oldest are dropped.
    ps.burst(0, 0, "#old", 600, 1);
    ps.burst(0, 0, "#new", 50, 1);
    expect(ps.count).toBe(600);
    const newest = ps.particles.slice(-50);
    expect(newest.every((p) => p.color === "#new")).toBe(true);
    // The oldest 50 markers were the ones evicted.
    expect(ps.particles.filter((p) => p.color === "#old").length).toBe(550);
  });
});
