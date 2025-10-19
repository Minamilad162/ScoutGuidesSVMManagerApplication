const VERSION = 'v1.0.1';
const OFFLINE_URL = '/offline.html';
const STATIC_CACHE = `static-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll([
      OFFLINE_URL,
      '/manifest.webmanifest',
    ]))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // enable navigation preload (optional)
    if ('navigationPreload' in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => ![STATIC_CACHE].includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // صفحات التصفح (route navigations)
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) return preload;
        return await fetch(request);
      } catch {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(OFFLINE_URL);
        return cached || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch {}
  const title = data.title || 'إشعار جديد'
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    data: { url: data.url || '/notifications' }
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification?.data?.url || '/notifications'
  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of allClients) {
        if ('focus' in client) { client.focus(); client.navigate(url); return }
      }
      if (clients.openWindow) await clients.openWindow(url)
    })()
  )
})
/* global self */

self.addEventListener('install', (event) => {
  // ممكن تضيف caching لو حابب
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: 'Scout Manager', body: event.data && event.data.text ? event.data.text() : '' };
  }

  const title = data.title || 'Scout Manager';
  const options = {
    body: data.body || '',
    data: data.data || {},
    icon: '/icons/icon-192.png', // حط أيقوناتك
    badge: '/icons/badge.png',
    vibrate: [100, 50, 100],
    actions: data.actions || [] // {action, title, icon}
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = (event.notification.data && event.notification.data.url) || '/app/notifications';

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    let client = allClients.find(c => c.url.includes(self.origin) || c.url.includes(location.origin));

    if (client) {
      client.focus();
      client.navigate(urlToOpen);
    } else {
      self.clients.openWindow(urlToOpen);
    }
  })());
});

  // Static GETs: cache-first
  if (request.method === 'GET' && new URL(request.url).origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      try {
        const res = await fetch(request);
        if (res && res.status === 200 && res.type === 'basic') cache.put(request, res.clone());
        return res;
      } catch {
        return new Response('', { status: 504 });
      }
    })());
  }
});
