// Custom service worker (injectManifest strategy).
// Handles precaching via workbox + push notifications.
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

self.skipWaiting();
self.clients.claim();

// Precache everything the build plugin injected.
precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches();

// SPA navigation fallback → index.html from the precache.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// ── Push notifications ───────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'קמרה סאונד APP', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'קמרה סאונד APP';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/LOGON1.png',
    badge: payload.badge || '/LOGON1.png',
    tag: payload.tag,
    data: payload.data || { url: payload.url || '/' },
    dir: 'rtl',
    lang: 'he',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.pathname === targetUrl && 'focus' in client) return client.focus();
        } catch { /* ignore */ }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    })
  );
});
