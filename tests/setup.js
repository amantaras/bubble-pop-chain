// Test setup: provide a clean, spec-compliant in-memory localStorage that is
// reset before every test. This keeps storage behaviour deterministic across
// Node/jsdom versions (Node 25 ships a partial Web Storage global).
import { beforeEach } from "vitest";

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(String(k), String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
}

function installStorage() {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

installStorage();

beforeEach(() => {
  globalThis.localStorage.clear();
});
