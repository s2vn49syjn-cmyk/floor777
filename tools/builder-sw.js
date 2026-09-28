// Keep the public cleanup behavior; legacy offline editing exists only on localhost.
const local = ['127.0.0.1', 'localhost', '[::1]'].includes(self.location.hostname);
if (!local) {
  self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
  self.addEventListener('activate', event => event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('f777-island-builder-v2-')) await caches.delete(key);
    await self.registration.unregister();
  })()));
} else {
  const CACHE = 'f777-island-builder-v2-local-review-1';
  const FILES = ['hall-editor.html', 'builder.css', 'builder.mjs', 'builder-quick.mjs',
    'builder-quick-model.mjs', 'builder-draw.mjs', 'builder-import.mjs', 'builder-store.mjs',
    'builder-legacy-model.mjs', 'builder-zip.mjs', 'builder-detect.mjs', 'builder-worker.mjs',
    'builder.webmanifest', 'builder-icon.svg', 'layout-validator.mjs', 'layout-schema-v3.json'];
  self.addEventListener('install', event => event.waitUntil(caches.open(CACHE)
    .then(cache => cache.addAll(FILES.map(file => new URL(file, self.registration.scope).href)))
    .then(() => self.skipWaiting())));
  self.addEventListener('activate', event => event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('f777-island-builder-v2-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })()));
  self.addEventListener('fetch', event => {
    const url = new URL(event.request.url), scope = new URL(self.registration.scope);
    if (event.request.method !== 'GET' || url.origin !== scope.origin ||
      !FILES.some(file => url.pathname === scope.pathname + file)) return;
    event.respondWith(caches.open(CACHE).then(async cache =>
      await cache.match(url.origin + url.pathname) || fetch(event.request)));
  });
}
