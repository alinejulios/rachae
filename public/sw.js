// Service worker: deixa a "casca" do app (HTML, CSS, JS, ícones) disponível
// offline e abrindo instantâneo. Os dados da planilha NÃO passam por aqui —
// as chamadas à API vão direto para o Google (outra origem, método POST).
//
// Ao publicar uma versão nova do front, aumente CACHE_VERSION.
const CACHE_VERSION = 'rachae-v2';
const APP_SHELL = [
  './',
  'index.html',
  'config.js',
  'css/app.css',
  'js/api.js',
  'js/app.js',
  'vendor/chart.umd.min.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Fontes do Google: cache-first (mudam raramente)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(CACHE_VERSION).then(cache => cache.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      })))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Arquivos do app: rede primeiro (pega versão nova), cache se estiver offline
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
