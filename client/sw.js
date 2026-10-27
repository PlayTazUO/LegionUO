const CACHE_PREFIX = 'legionuo-assets-';
const CACHE_VERSION = 'v2';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 10000;
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

let cachedEntryCount = null;

async function trimCache(cache) {
  const keys = await cache.keys();
  const remove = keys.length - MAX_CACHE_ENTRIES + Math.ceil(MAX_CACHE_ENTRIES * 0.05);
  for (let i = 0; i < remove; i++) await cache.delete(keys[i]);
  cachedEntryCount = keys.length - remove;
}

async function storeResponse(event, cache, request, response) {
  event.waitUntil(
    (async () => {
      try {
        await cache.put(request, response.clone());
        if (cachedEntryCount == null) cachedEntryCount = (await cache.keys()).length;
        else cachedEntryCount++;
        if (cachedEntryCount > MAX_CACHE_ENTRIES) await trimCache(cache);
      } catch {
        /* quota or cache storage errors must not break the response */
      }
    })()
  );
}

async function fetchAndCache(event, cache, request) {
  const response = await fetch(request);
  if (response.status === 200 && response.type === 'basic') {
    storeResponse(event, cache, request, response);
  }
  return response;
}

async function respond(event) {
  let cache = null;
  try {
    cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) {
      if (isStale(cached)) {
        event.waitUntil(fetchAndCache(event, cache, event.request).catch(() => {}));
      }
      return cached;
    }
  } catch {
    cache = null;
  }
  if (!cache) return fetch(event.request);
  return fetchAndCache(event, cache, event.request);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !isAssetRequest(url)) return;
  event.respondWith(respond(event));
});
