declare const VERSION: string;
declare const PRECACHE: readonly { url: string; integrity: string }[];

const worker = self as unknown as ServiceWorkerGlobalScope;
const scope = new URL(worker.registration.scope);
const prefix = `flying-dragon-game:${scope.href}:`;
const cacheName = prefix + VERSION;
const index = new URL('index.html', scope).href;
const assets = new Set(PRECACHE.map(entry => new URL(entry.url, scope).href));

worker.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const responses = await Promise.all(PRECACHE.map(async entry => {
        const url = new URL(entry.url, scope).href;
        const response = await fetch(new Request(url, {
          integrity: entry.integrity, cache: 'reload', credentials: 'same-origin', mode: 'same-origin',
        }));
        if (!response.ok) throw new Error(`Could not cache ${entry.url}: ${response.status}`);
        return { url, response };
      }));
      const cache = await caches.open(cacheName);
      for (const { url, response } of responses) await cache.put(url, response);
    } catch (error) {
      await caches.delete(cacheName);
      throw error;
    }
  })());
});

worker.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(prefix) && name !== cacheName) await caches.delete(name);
    }
    await worker.clients.claim();
  })());
});

worker.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== scope.origin) return;
  const home = event.request.mode === 'navigate' &&
    (url.pathname === scope.pathname || url.pathname === new URL(index).pathname);
  const key = home ? index : url.href;
  if (!assets.has(key)) return;
  event.respondWith((async () => {
    const cached = await (await caches.open(cacheName)).match(key);
    return cached || fetch(event.request);
  })());
});
