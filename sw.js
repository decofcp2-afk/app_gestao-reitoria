var CACHE_NAME = 'app-gestao-reitoria-v6';

var CORE_ASSETS = [
  './',
  './index.html',
  './config.js',
  './manifest.json',
  './appsel-firestore.js',
  './relatorio-prazos.js',
  './icon.svg',
  './painel-icon.svg',
  './cpii-logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) { return cache.addAll(CORE_ASSETS); })
      .then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys()
      .then(function(keys) {
        return Promise.all(keys
          .filter(function(key) { return key.indexOf('app-gestao-reitoria-') === 0 && key !== CACHE_NAME; })
          .map(function(key) { return caches.delete(key); }));
      })
      .then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;

  var url = new URL(event.request.url);

  if (url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Documentos e TODOS os .js próprios vão network-first: com cache-first, um
  // deploy de appsel-firestore.js/relatorio-prazos.js exigia lembrar de subir o
  // CACHE_NAME, senão o app rodava o JS antigo com o index.html novo (foi a
  // causa do "Leitura multiunidade indisponível" no celular). Offline continua
  // coberto pelo fallback ao cache dentro de networkFirst.
  if (event.request.mode === 'navigate' ||
      event.request.destination === 'document' ||
      url.pathname.endsWith('/index.html') ||
      (url.origin === self.location.origin && url.pathname.endsWith('.js'))) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request));
  }
});

function networkFirst(request) {
  return fetch(request)
    .then(function(response) {
      if (response && response.status === 200) {
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(request, response.clone());
        });
      }
      return response;
    })
    .catch(function() {
      return caches.match(request).then(function(cached) {
        return cached || caches.match('./index.html');
      });
    });
}

function cacheFirst(request) {
  return caches.open(CACHE_NAME).then(function(cache) {
    return cache.match(request).then(function(cached) {
      var fresh = fetch(request)
        .then(function(response) {
          if (response && response.status === 200) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(function() { return cached; });

      return cached || fresh;
    });
  });
}
