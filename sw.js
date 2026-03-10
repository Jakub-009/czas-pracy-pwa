const CACHE_NAME = "worktime-pwa-gh-v5";
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
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // nawigacja (otwarcie / odświeżenie strony)
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(BASE + "index.html", copy));
          return response;
        })
        .catch(() => caches.match(BASE + "index.html"))
    );
    return;
  }

  // tylko GET
  if (req.method !== "GET") return;

  // pliki aplikacji z tej samej domeny -> network first + fallback do cache
  if (url.origin === location.origin && url.pathname.startsWith(BASE)) {
    event.respondWith(
      fetch(req)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return response;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // reszta: cache first
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
