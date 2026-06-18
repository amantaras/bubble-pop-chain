import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "web");
const entries = [
  "index.html",
  "styles.css",
  "manifest.json",
  "sw.js",
  "icons",
  "assets",
  "src"
];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const entry of entries) {
  await cp(path.join(root, entry), path.join(out, entry), { recursive: true });
}

console.log(`Copied ${entries.length} web entries to ${path.relative(root, out)}`);