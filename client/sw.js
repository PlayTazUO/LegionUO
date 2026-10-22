const CACHE_PREFIX = 'legionuo-assets-';
const CACHE_VERSION = 'v1';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ASSET_PATHS = new Set([
  'anim',
  'art',
  'cliloc',
  'equipconv',
  'font',
  'gump',
  'hues',
  'map',
  'mapimage',
  'multi',
  'music',
  'radarcol',
  'skills',
  'sound',
  'texmap',
  'tiledata',
  'tileart',
]);

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

function isAssetRequest(url) {
  const match = url.pathname.match(/^\/api\/([^/]+)/);
  return !!match && ASSET_PATHS.has(match[1]);
}

function isStale(response) {
  const date = Date.parse(response.headers.get('date') || '');
  return Number.isFinite(date) && Date.now() - date > MAX_AGE_MS;
}

async function fetchAndCache(event, cache, request) {
  const response = await fetch(request);
  if (response.status === 200 && response.type === 'basic') {
    event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
  }
  return response;
}

async function respond(event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(event.request);
  if (cached) {
    if (isStale(cached)) {
      event.waitUntil(fetchAndCache(event, cache, event.request).catch(() => {}));
    }
    return cached;
  }
  return fetchAndCache(event, cache, event.request);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !isAssetRequest(url)) return;
  event.respondWith(respond(event));
});
