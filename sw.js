var CACHE_NAME = 'app-gestao-reitoria-v5';

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

  if (event.request.mode === 'navigate' ||
      event.request.destination === 'document' ||
      url.pathname.endsWith('/index.html') ||
      url.pathname.endsWith('/config.js')) {
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
