// Dev-only asset generation tool — calls the Meshy AI Text to Image API and
// downloads results into scripts/meshy/output/ for review before any asset is
// wired into the actual game (src/, assets/, sw.js).
//
// This script is NEVER run by CI or the shipped game; it's a local authoring
// aid only, same spirit as scripts/capture-store-screenshots.mjs.
//
// Setup:
//   cp .env.meshy.example .env.meshy   # then edit .env.meshy with your real key
//   (or just `export MESHY_API_KEY=msy_...` in your shell)
//
// Usage:
//   node scripts/meshy/generate.mjs --prompt "..." --model nano-banana --aspect 1:1 --out scripts/meshy/output/sparky.png
//   node scripts/meshy/generate.mjs --manifest scripts/meshy/manifest.json
//
// Manifest file is a JSON array of { id, prompt, model, aspect, out }.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromaKeyOut } from "./chroma.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const API_BASE = "https://api.meshy.ai/openapi/v1/text-to-image";
const VALID_MODELS = ["nano-banana", "nano-banana-2", "nano-banana-pro", "gpt-image-2"];
const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

async function loadApiKey() {
  if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY.trim();
  try {
    const raw = await readFile(path.join(ROOT, ".env.meshy"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key === "MESHY_API_KEY" && value && value !== "msy_your_key_here") return value;
    }
  } catch {
    // no .env.meshy file — fall through
  }
  return null;
}

function parseArgs(argv) {
  const opts = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) opts[m[1]] = m[2];
  }
  return opts;
}

async function createTask(apiKey, { prompt, model = "nano-banana", aspect = "1:1" }) {
  if (!VALID_MODELS.includes(model)) {
    throw new Error(`Invalid model "${model}". Valid: ${VALID_MODELS.join(", ")}`);
  }
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ai_model: model, prompt, aspect_ratio: aspect }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Create task failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body.result;
}

async function pollTask(apiKey, taskId) {
  const started = Date.now();
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const res = await fetch(`${API_BASE}/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const task = await res.json();
    if (!res.ok) throw new Error(`Poll failed (${res.status}): ${JSON.stringify(task)}`);
    if (task.status === "SUCCEEDED") return task;
    if (task.status === "FAILED" || task.status === "CANCELED") {
      throw new Error(`Task ${task.status}: ${task.task_error?.message || "unknown error"}`);
    }
    process.stdout.write(`  ${task.status} ${task.progress || 0}%\r`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Task ${taskId} timed out after ${POLL_TIMEOUT_MS}ms`);
}

async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function generateOne(apiKey, job) {
  const { id, prompt, model, aspect, out, chromaKey = "auto", chromaThreshold = 70, chromaFeather = 60 } = job;
  if (!prompt) throw new Error(`Job ${id || "?"} missing "prompt"`);
  if (!out) throw new Error(`Job ${id || "?"} missing "out"`);
  console.log(`\n[${id || out}] creating task…`);
  const taskId = await createTask(apiKey, { prompt, model, aspect });
  console.log(`[${id || out}] task ${taskId} — polling…`);
  const task = await pollTask(apiKey, taskId);
  const imageUrl = task.image_urls?.[0];
  if (!imageUrl) throw new Error(`Task ${taskId} succeeded but returned no image_urls`);
  let buf = await downloadImage(imageUrl);
  if (chromaKey !== false && chromaKey !== "none") {
    console.log(`[${id || out}] removing background (chromaKey=${chromaKey})…`);
    const keyed = await chromaKeyOut(buf, { color: chromaKey, threshold: chromaThreshold, feather: chromaFeather });
    buf = keyed.buffer;
  }
  const outPath = path.isAbsolute(out) ? out : path.join(ROOT, out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, buf);
  console.log(`[${id || out}] saved -> ${path.relative(ROOT, outPath)} (${task.consumed_credits ?? "?"} credits)`);
  return { id, outPath, consumed_credits: task.consumed_credits };
}

async function main() {
  const apiKey = await loadApiKey();
  if (!apiKey) {
    console.error(
      "No Meshy API key found. Copy .env.meshy.example to .env.meshy and fill in your key,\n" +
        "or export MESHY_API_KEY in your shell before running this script."
    );
    process.exit(1);
  }

  const opts = parseArgs(process.argv.slice(2));
  let jobs;
  if (opts.manifest) {
    const manifestPath = path.isAbsolute(opts.manifest) ? opts.manifest : path.join(ROOT, opts.manifest);
    jobs = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!Array.isArray(jobs)) throw new Error("Manifest must be a JSON array of job objects");
  } else if (opts.prompt && opts.out) {
    jobs = [{ id: opts.id || "single", prompt: opts.prompt, model: opts.model, aspect: opts.aspect, out: opts.out }];
  } else {
    console.error(
      "Usage:\n" +
        '  node scripts/meshy/generate.mjs --prompt "..." --out scripts/meshy/output/foo.png [--model nano-banana] [--aspect 1:1]\n' +
        "  node scripts/meshy/generate.mjs --manifest scripts/meshy/manifest.json"
    );
    process.exit(1);
  }

  const results = [];
  for (const job of jobs) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await generateOne(apiKey, job));
  }

  const totalCredits = results.reduce((sum, r) => sum + (r.consumed_credits || 0), 0);
  console.log(`\nDone. ${results.length} image(s) generated, ~${totalCredits} credits consumed.`);
}

main().catch((err) => {
  console.error("\nERROR:", err.message);
  process.exit(1);
});
