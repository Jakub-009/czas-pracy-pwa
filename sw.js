const CACHE_NAME = "worktime-pwa-gh-v4";
const BASE = "/czas-pracy-pwa/";

const ASSETS = [
  BASE,
  BASE + "index.html",
  BASE + "manifest.webmanifest",
  BASE + "sw.js",
  BASE + "icon-192.png",
  BASE + "icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // nawigacja (odświeżenie/otwarcie) -> offline fallback do index.html
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match(BASE + "index.html"))
    );
    return;
  }

  // reszta plików: cache-first
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
