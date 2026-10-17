// Network-first service worker: keeps the app shell usable offline after the first visit.
// Only same-origin GET requests are cached; market data and Claude calls always go to the network.
const CACHE = "chartai-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        throw err;
      }
    }),
  );
});
