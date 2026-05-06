/**
 * Vintage Hi-Fi — Service Worker
 * Strategy: stale-while-revalidate for all GET requests.
 * The app shell and all Vite-bundled assets are cached on first visit,
 * enabling full offline playback (audio files live in OPFS, not the cache).
 */

const CACHE = 'hifi-pwa-v1';

// ── Install: take control immediately ────────────────────────────────────────
self.addEventListener('install', (event) => {
  // Skip waiting so the new SW activates right away
  event.waitUntil(self.skipWaiting());
});

// ── Activate: purge stale caches ────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch: stale-while-revalidate ────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests from our origin
  if (req.method !== 'GET') return;
  if (!req.url.startsWith(self.location.origin)) return;
  // Don't cache Zite platform API calls
  if (req.url.includes('/api/') || req.url.includes('/__zite')) return;

  event.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(req).then(cached => {
        // Always fetch in the background to keep the cache fresh
        const fresh = fetch(req).then(res => {
          // Only cache valid same-origin responses
          if (res && res.ok && res.type === 'basic') {
            cache.put(req, res.clone());
          }
          return res;
        }).catch(() => {
          // Offline — return nothing (cached version already returned below)
          return null;
        });

        // Return stale immediately if available, otherwise wait for fresh
        return cached || fresh;
      })
    )
  );
});
