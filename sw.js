const CACHE = 'ndburgs-r46-v1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './favicon.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Só controla arquivos do próprio site
  if (url.origin !== self.location.origin) return;

  // PÁGINAS:
  // sempre tenta buscar a versão mais nova.
  // Se estiver sem internet, usa o index salvo.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(res => {

          // Faz duas cópias antes de devolver a resposta
          const indexCopy = res.clone();
          const rootCopy = res.clone();

          caches.open(CACHE).then(cache => {
            cache.put('./index.html', indexCopy);
            cache.put('./', rootCopy);
          });

          return res;
        })
        .catch(() =>
          caches.match('./index.html')
            .then(cached =>
              cached || caches.match('./')
            )
        )
    );

    return;
  }

  // ARQUIVOS ESTÁTICOS:
  // usa o cache imediatamente e atualiza em segundo plano.
  event.respondWith(
    caches.match(req).then(cached => {

      const network = fetch(req, { cache: 'no-store' })
        .then(res => {

          if (res.ok) {
            caches.open(CACHE).then(cache => {
              cache.put(req, res.clone());
            });
          }

          return res;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
