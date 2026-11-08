// Keeps the app's own pages and files on this device, so a phone that has opened VUEMesh before
// can open it again with no internet, and join a show by QR code (qrjoin.js). Online, everything
// comes from the network as it always did (and the copy here is refreshed); only when the network
// can't be reached does it come from here. Never the API, films, uploads or anything big.
const CACHE = 'vm-app-v1';
const KEEP = /\.(?:html|js|mjs|css|json|svg|png|webp|woff2|webmanifest|txt)$/i;
// (what joining by QR needs that a camera page may not have loaded yet)
const FIRST = ['/cam', '/config.js', '/js/qrworker.js', '/vendor/jsQR.js', '/vendor/qrcode.js'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(FIRST.map((u) => c.add(u).catch(() => {})))));
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// A page's own address and what it loaded, the first time (before this was there to keep them)
self.addEventListener('message', (e) => {
  if (e.data?.t !== 'keep' || !Array.isArray(e.data.urls)) return;
  const mine = e.data.urls.map((u) => { try { return new URL(u); } catch { return null; } })
    .filter((u) => u && u.origin === self.location.origin && !/^\/(api|films|_dev|_put|ws)(\/|$)/.test(u.pathname) && (KEEP.test(u.pathname) || !/\.[a-z0-9]+$/i.test(u.pathname)));
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(mine.slice(0, 200).map(async (u) => {
    if (!(await c.match(u.href))) await c.add(u.href).catch(() => {});
  }))));
});

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || r.headers.has('range')) return;
  const url = new URL(r.url);
  if (url.origin !== self.location.origin || /^\/(api|films|_dev|_put|ws)(\/|$)/.test(url.pathname)) return;
  const page = r.mode === 'navigate';
  if (!page && !KEEP.test(url.pathname)) return;
  e.respondWith(
    fetch(r).then(
      (res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then((c) => c.put(r, copy)).catch(() => {}));
        }
        return res;
      },
      // (no network: the copy here; a page whatever its ?e=, since it's the same page)
      async () => (await caches.match(r, { ignoreSearch: page })) || Response.error(),
    ),
  );
});
