// Lightweight Cache Storage Service Worker for Pyodide & DuckDB Wasm/Wheel artifacts.
// Caches immutable CDN runtime artifacts so subsequent sessions initialize in <1s.
const CACHE_NAME = 'canvas-notebook-wasm-v1';

const CACHEABLE_HOSTS = [
  'cdn.jsdelivr.net',
  'files.pythonhosted.org',
  'pypi.org',
];

const CACHEABLE_EXTENSIONS = ['.wasm', '.whl', '.data', '.zip', '.json', '.mjs', '.js'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('canvas-notebook-wasm-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  const isCacheableHost = CACHEABLE_HOSTS.includes(url.hostname);
  const isRuntimeArtifact =
    (url.pathname.includes('pyodide') || url.pathname.includes('duckdb') || url.pathname.includes('packages')) &&
    CACHEABLE_EXTENSIONS.some((ext) => url.pathname.endsWith(ext));

  if (!isCacheableHost || !isRuntimeArtifact) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
  );
});
