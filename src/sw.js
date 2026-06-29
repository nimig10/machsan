// Custom service worker (injectManifest strategy).
// Handles precaching via workbox + push notifications.
import { precacheAndRoute, cleanupOutdatedCaches, PrecacheFallbackPlugin } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst, NetworkOnly } from 'workbox-strategies';

self.skipWaiting();
self.clients.claim();

// Precache everything the build plugin injected.
precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches();

// /daily-table is the corridor TV kiosk page — always-online, single-purpose.
// Force NetworkOnly so it can NEVER serve a stale cached response (defense in
// depth on top of main.jsx never registering the SW for this path).
registerRoute(
  ({ url }) => url.pathname.startsWith('/daily-table'),
  new NetworkOnly()
);

// SPA navigations: NETWORK-FIRST (not cache-first).
//
// An always-online display (e.g. the /daily-table TV board running in Fully
// Kiosk) must always pull a *fresh* index.html so it references the current
// hashed asset URLs. Serving index.html from the precache (the old behavior)
// caused a death-spiral after a deploy: the cached index pointed at an old
// /assets/index-<hash>.js that no longer exists → the entry module 404s →
// the SW-update code in main.jsx never runs → the SW never updates itself →
// permanent white screen until the device cache is cleared by hand.
//
// Network-first fetches index.html from the network when online (so new
// deploys are picked up immediately) and only falls back to the precached
// index.html when the network is unreachable (offline). Asset chunks not in
// the current precache simply fetch from the network as usual.
registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: 'app-shell',
      networkTimeoutSeconds: 5,
      plugins: [new PrecacheFallbackPlugin({ fallbackURL: 'index.html' })],
    })
  )
);

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
