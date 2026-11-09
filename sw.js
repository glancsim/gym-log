// Service worker: aplikace a už zobrazené obrázky cviků fungují i bez signálu.
// Při změně souborů aplikace zvyš číslo verze, staré mezipaměti se smažou.
const VERZE = 'fitko-v1';
const OBRAZKY = 'fitko-obrazky';
const SHELL = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERZE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(klice => Promise.all(klice.filter(k => k !== VERZE && k !== OBRAZKY).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return; // zápisy do tabulky jdou vždy přímo na síť
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // Aplikace: hned z mezipaměti, na pozadí se stáhne novější verze pro příští otevření.
    e.respondWith(caches.open(VERZE).then(async c => {
      const ulozene = await c.match(req, { ignoreSearch: true });
      const sit = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => ulozene);
      return ulozene || sit;
    }));
  } else if (url.hostname === 'raw.githubusercontent.com') {
    // Obrázky cviků: jednou stažené se už berou z mezipaměti.
    e.respondWith(caches.open(OBRAZKY).then(async c => {
      const ulozene = await c.match(req);
      if (ulozene) return ulozene;
      const r = await fetch(req);
      if (r.ok) c.put(req, r.clone());
      return r;
    }));
  }
});
