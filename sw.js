const CACHE = "bubble-pop-chain-v90";
const ASSETS = [
  "./",
  "./index.html",
  "./privacy.html",
  "./support.html",
  "./styles.css",
  "./manifest.json",
  "./icons/icon.svg",
  "./icons/maskable.svg",
  "./assets/vfx/kenney-particles/README.txt",
  "./assets/vfx/kenney-particles/star_01.png",
  "./assets/vfx/kenney-particles/star_02.png",
  "./assets/vfx/kenney-particles/star_03.png",
  "./assets/vfx/kenney-particles/star_04.png",
  "./assets/vfx/kenney-particles/circle_01.png",
  "./assets/vfx/kenney-particles/circle_02.png",
  "./assets/vfx/kenney-particles/circle_03.png",
  "./assets/vfx/kenney-particles/flare_01.png",
  "./assets/vfx/kenney-particles/light_01.png",
  "./assets/vfx/kenney-particles/magic_01.png",
  "./assets/vfx/kenney-particles/magic_02.png",
  "./assets/vfx/kenney-particles/twirl_01.png",
  "./assets/icons/game-icons/README.txt",
  "./assets/icons/game-icons/lightning-bolt.svg",
  "./assets/icons/special/lightning-mark.svg",
  "./assets/icons/game-icons/bomb.svg",
  "./assets/icons/game-icons/padlock.svg",
  "./assets/icons/game-icons/snowflake.svg",
  "./assets/icons/game-icons/vine-leaf.svg",
  "./assets/icons/game-icons/coin.svg",
  "./assets/icons/currency/coin.svg",
  "./assets/icons/currency/coins-stack.svg",
  "./assets/icons/game-icons/multiplication.svg",
  "./assets/icons/tools/undo.svg",
  "./assets/icons/tools/shuffle.svg",
  "./assets/icons/tools/bomb.svg",
  "./assets/icons/tools/color-clear.svg",
  "./assets/icons/tools/pick.svg",
  "./assets/icons/tools/paint.svg",
  "./assets/icons/tools/chain-bolt.svg",
  "./assets/icons/tools/extra-moves.svg",
  "./assets/icons/tools/magnet.svg",
  "./assets/pets/avatars/README.txt",
  "./assets/pets/avatars/sparky.svg",
  "./assets/pets/avatars/clover.svg",
  "./assets/pets/avatars/mochi.svg",
  "./assets/pets/avatars/sprout.svg",
  "./assets/pets/avatars/rover.svg",
  "./assets/pets/avatars/whiskers.svg",
  "./assets/pets/avatars/luma.svg",
  "./assets/pets/avatars/quake.svg",
  "./assets/pets/avatars/comet.svg",
  "./assets/pets/avatars/talon.svg",
  "./assets/pets/avatars/cyclone.svg",
  "./assets/pets/avatars/magma.svg",
  "./assets/pets/avatars/archer.svg",
  "./assets/pets/avatars/amp.svg",
  "./assets/pets/avatars/blaze.svg",
  "./assets/pets/avatars/prism.svg",
  "./assets/pets/avatars/draco.svg",
  "./assets/pets/avatars/midas.svg",
  "./assets/pets/avatars/tidal.svg",
  "./assets/pets/avatars/aurora.svg",
  "./assets/pets/avatars/gizmo.svg",
  "./assets/pets/avatars/nova.svg",
  "./assets/pets/kenney-space-shooter/README.txt",
  "./assets/pets/kenney-space-shooter/playerShip3_red.png",
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
  "./src/gems.js",
  "./src/tech.js",
  "./src/calendar.js",
  "./src/season.js",
  "./src/quests.js",
  "./src/stats.js",
  "./src/piggy.js",
  "./src/puzzle.js",
  "./src/ui.js",
  "./src/tournament.js",
  "./src/spotlight.js",
  "./src/diagnostics.js",
  "./src/sharecard.js",
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
