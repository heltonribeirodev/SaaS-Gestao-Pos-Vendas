const CACHE_NAME = 'fortecare-v1';
const ASSETS_TO_CACHE = [
  '/index.html',
  '/login.html',
  '/assets/css/login.css',
  '/assets/css/style.css',
  '/assets/JS/login.js',
  '/assets/JS/script.js',
  '/assets/images/ForteCare-F-colors.png'
];

// Instalação do Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Tenta colocar no cache arquivo por arquivo sem travar se 1 der erro
      return Promise.allSettled(
        ASSETS_TO_CACHE.map(url => cache.add(url).catch(err => console.warn(`Falha ao cachear ${url}:`, err)))
      );
    })
  );
  self.skipWaiting();
});

// Ativação e limpeza de caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

// Interceptação de requisições
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/api/')) {
    return;
  }
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});