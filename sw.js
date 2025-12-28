const CACHE_NAME = 'coffee-game-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './index.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// 1. تثبيت الخدمة وتحميل الملفات
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// 2. تفعيل الخدمة وتنظيف القديم
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
});

// 3. استدعاء الملفات (Offline Strategy)
self.addEventListener('fetch', (event) => {
  // نستثني طلبات الفايربيس من الكاش عشان الداتابيز تفضل لايف
  if (event.request.url.includes('firebase') || event.request.url.includes('googleapis')) {
    return; 
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});