import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression guard for a real bug found in a bug-fix pass: sw.js's ASSETS
// cache list had silently fallen behind src/ (achievements.js, daily.js,
// events.js, and pets.js were all imported by main.js but never added to the
// offline cache, so the PWA would break offline once a player reached code
// paths that needed them). This test statically parses sw.js's ASSETS array
// and cross-checks it against the real src/ directory listing so this class
// of bug can't silently regress again.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readAssets() {
  const text = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const matches = text.match(/"\.\/[^"]+"/g) || [];
  return new Set(matches.map((m) => m.slice(1, -1).replace(/^\.\//, "")));
}

describe("sw.js offline cache list", () => {
  it("includes every src/*.js module that actually exists on disk", () => {
    const assets = readAssets();
    const srcFiles = fs
      .readdirSync(path.join(ROOT, "src"))
      .filter((f) => f.endsWith(".js"));
    expect(srcFiles.length).toBeGreaterThan(0);
    const missing = srcFiles.filter((f) => !assets.has(`src/${f}`));
    expect(missing).toEqual([]);
  });

  it("includes every file under assets/ that actually exists on disk", () => {
    const assets = readAssets();
    const walk = (dir) => {
      const out = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else out.push(path.relative(ROOT, full));
      }
      return out;
    };
    const assetFiles = walk(path.join(ROOT, "assets"));
    expect(assetFiles.length).toBeGreaterThan(0);
    const missing = assetFiles.filter((f) => !assets.has(f));
    expect(missing).toEqual([]);
  });
});
