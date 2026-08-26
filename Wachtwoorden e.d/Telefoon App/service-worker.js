const CACHE_NAME = "veynor-driver-pwa-v15";
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/config.js",
  "/app.js",
  "/manifest.webmanifest",
  "/assets/veynor-wordmark.png",
  "/assets/veynor-full-logo.png",
  "/assets/veynor-icon-192.png",
  "/assets/veynor-icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(key => key !== CACHE_NAME ? caches.delete(key) : null)))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if(request.method !== "GET") return;

  event.respondWith(
    caches.match(request).then(cached => {
      if(cached) return cached;
      return fetch(request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone)).catch(() => {});
        return response;
      });
    })
  );
});
