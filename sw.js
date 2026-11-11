// Service worker: aplikace a už zobrazené obrázky cviků fungují i bez signálu.
//
// Soubory aplikace se berou vždy z jedné verze mezipaměti, aby se nikdy
// nesmíchal starý kód s novým vzhledem. Při každé změně souborů aplikace
// ZVYŠ číslo verze: nová verze se stáhne celá najednou a appka se sama obnoví.
const VERZE = 'fitko-v5';
const OBRAZKY = 'fitko-obrazky';
const SHELL = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  // cache: 'reload' obchází mezipaměť prohlížeče, ať se stáhnou opravdu aktuální soubory.
  const pozadavky = SHELL.map(u => new Request(u, { cache: 'reload' }));
  e.waitUntil(caches.open(VERZE).then(c => c.addAll(pozadavky)).then(() => self.skipWaiting()));
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
    e.respondWith(caches.open(VERZE).then(async c => (await c.match(req, { ignoreSearch: true })) || fetch(req)));
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
