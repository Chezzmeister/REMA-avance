// Service worker: deja la app completa guardada en el teléfono para abrirla sin señal.
const VERSION = 'rema-v0.1.6';
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/app.js', './js/db.js', './js/calc.js', './js/sync.js', './js/seed.js', './js/pptx.js',
  './icons/icon-192.png', './icons/icon-512.png',
];
const LIBS = [
  'https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.38.3/lib/msal-browser.min.js',
  'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
    await Promise.all(LIBS.map(u => c.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Nunca cachear llamadas a Microsoft (datos y sesión).
  if (/graph\.microsoft\.com|login\.microsoftonline\.com|login\.live\.com|1drv|sharepoint/.test(url.host)) return;

  if (req.mode === 'navigate') {
    e.respondWith(redPrimero(req, './index.html'));
    return;
  }
  if (LIBS.includes(req.url)) {
    // Librerías con versión fija: siempre de la caché.
    e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
  } else if (url.origin === location.origin) {
    e.respondWith(redPrimero(req, req));
  }
});

// Con señal buena se baja la versión más nueva; si la red falla o tarda más de 3 s
// (señal débil en obra), se usa la copia guardada.
function redPrimero(req, clave) {
  // no-cache: revalida con GitHub en vez de usar la copia de 10 min del navegador.
  const red = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(r => {
    if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(clave, cp)); }
    return r;
  });
  const guardado = () => caches.match(clave, { ignoreSearch: true });
  return new Promise(resolve => {
    let listo = false;
    const usar = r => { if (!listo && r) { listo = true; resolve(r); } };
    const t = setTimeout(() => guardado().then(usar), 3000);
    red.then(r => { clearTimeout(t); usar(r); })
      .catch(() => { clearTimeout(t); guardado().then(r => (r ? usar(r) : usar(Response.error()))); });
  });
}
