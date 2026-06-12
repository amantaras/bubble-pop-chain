const CACHE = "bubble-pop-chain-v30";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./icons/icon.svg",
  "./icons/maskable.svg",
  "./src/main.js",
  "./src/rng.js",
  "./src/storage.js",
  "./src/themes.js",
  "./src/levels.js",
  "./src/milestones.js",
  "./src/scoring.js",
  "./src/grid.js",
  "./src/renderer.js",
  "./src/particles.js",
  "./src/animations.js",
  "./src/input.js",
  "./src/audio.js",
  "./src/monetization.js",
  "./src/economy.js",
  "./src/calendar.js",
  "./src/season.js",
  "./src/ui.js",
  "./src/tutorial.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // Network-first: always try the network so updates are picked up
  // immediately; fall back to cache when offline.
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        if (resp && resp.status === 200 && resp.type === "basic") {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
