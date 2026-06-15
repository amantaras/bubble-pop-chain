import { describe, it, expect } from "vitest";
import { ParticleSystem, popStyleForGroup } from "../../src/particles.js";

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

  it("ring() adds an expanding shockwave that update expires after its life", () => {
    const ps = new ParticleSystem();
    ps.ring(50, 50, "#0ff", { maxRadius: 80, life: 0.4 });
    expect(ps.rings.length).toBe(1);
    ps.update(0.2); // half-life: still alive
    expect(ps.rings.length).toBe(1);
    ps.update(0.3); // total 0.5s > 0.4s: expired
    expect(ps.rings.length).toBe(0);
  });

  it("caps the live ring pool the same way as particles", () => {
    const ps = new ParticleSystem();
    for (let i = 0; i < 200; i++) ps.ring(0, 0, "#fff", { life: 5 });
    expect(ps.rings.length).toBe(48);
  });

  describe("motionScale (reduced-motion accessibility)", () => {
    it("defaults to 1 (full motion)", () => {
      expect(new ParticleSystem().motionScale).toBe(1);
    });

    it("scales burst and sparkle particle counts down", () => {
      const ps = new ParticleSystem();
      ps.motionScale = 0.45;
      ps.burst(0, 0, "#f00", 12, 1);
      // 12 * 0.45 = 5.4 -> rounded to 5
      expect(ps.count).toBe(5);
      const ps2 = new ParticleSystem();
      ps2.motionScale = 0.45;
      ps2.sparkle(0, 0, "#fff", 6);
      // 6 * 0.45 = 2.7 -> rounded to 3
      expect(ps2.count).toBe(3);
    });

    it("emits at least one particle when scaled but not zero", () => {
      const ps = new ParticleSystem();
      ps.motionScale = 0.01;
      ps.burst(0, 0, "#f00", 4, 1);
      expect(ps.count).toBe(1);
    });

    it("emits no particles when motionScale is zero", () => {
      const ps = new ParticleSystem();
      ps.motionScale = 0;
      ps.burst(0, 0, "#f00", 20, 1);
      ps.sparkle(0, 0, "#fff", 10);
      expect(ps.count).toBe(0);
    });

    it("skips expanding shockwave rings below the motion threshold", () => {
      const ps = new ParticleSystem();
      ps.motionScale = 0.45;
      ps.ring(0, 0, "#0ff", { life: 1 });
      expect(ps.rings.length).toBe(0);
      // Full motion still draws rings.
      const ps2 = new ParticleSystem();
      ps2.ring(0, 0, "#0ff", { life: 1 });
      expect(ps2.rings.length).toBe(1);
    });
  });

  it("draw() handles particles, hollow rings and fill flashes without throwing", () => {
    const ps = new ParticleSystem();
    ps.burst(10, 10, "#f00", 5, 1);
    ps.ring(10, 10, "#0f0", { life: 1 });
    ps.ring(10, 10, "#fff", { life: 1, fill: true });
    const calls = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "save" || prop === "restore" || prop === "beginPath" || prop === "arc" || prop === "fill" || prop === "stroke") {
            return () => calls.push(prop);
          }
          return undefined; // settable props (fillStyle, globalAlpha, …) read as undefined
        },
        set: () => true,
      }
    );
    expect(() => ps.draw(ctx)).not.toThrow();
    expect(calls).toContain("fill"); // particle + flash fill
    expect(calls).toContain("stroke"); // hollow ring
  });
});

describe("popStyleForGroup (5 escalating explosion styles)", () => {
  it("maps group size to one of five distinct, escalating styles", () => {
    expect(popStyleForGroup(2).style).toBe(0);
    expect(popStyleForGroup(3).style).toBe(0);
    expect(popStyleForGroup(4).style).toBe(1);
    expect(popStyleForGroup(5).style).toBe(1);
    expect(popStyleForGroup(6).style).toBe(2);
    expect(popStyleForGroup(7).style).toBe(2);
    expect(popStyleForGroup(8).style).toBe(3);
    expect(popStyleForGroup(11).style).toBe(3);
    expect(popStyleForGroup(12).style).toBe(4);
    expect(popStyleForGroup(99).style).toBe(4);
  });

  it("never produces fewer than 5 reachable style indices", () => {
    const seen = new Set();
    for (let n = 1; n <= 40; n++) seen.add(popStyleForGroup(n).style);
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("makes bigger groups strictly more impactful (non-decreasing fields)", () => {
    const sizes = [2, 4, 6, 8, 12];
    const styles = sizes.map((n) => popStyleForGroup(n));
    for (let i = 1; i < styles.length; i++) {
      expect(styles[i].perCell).toBeGreaterThanOrEqual(styles[i - 1].perCell);
      expect(styles[i].power).toBeGreaterThanOrEqual(styles[i - 1].power);
      expect(styles[i].rings).toBeGreaterThanOrEqual(styles[i - 1].rings);
    }
    // Only the top tiers add a flash; only mid-tiers and up add sparkle.
    expect(popStyleForGroup(2).flash).toBe(false);
    expect(popStyleForGroup(2).rings).toBe(0);
    expect(popStyleForGroup(12).flash).toBe(true);
    expect(popStyleForGroup(12).rings).toBe(3);
    expect(popStyleForGroup(12).sparkle).toBeGreaterThan(0);
  });

  it("each style carries a distinct human-readable name", () => {
    const names = [2, 4, 6, 8, 12].map((n) => popStyleForGroup(n).name);
    expect(new Set(names).size).toBe(5);
  });
});
