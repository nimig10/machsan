import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// ── PWA: mobile only, never on the kiosk page ────────────────────────────────
// Register the service worker only on mobile/tablet devices.
// Desktop users get a plain web app (no install prompt, no SW cache issues).
//
// /daily-table is the always-online corridor TV kiosk — it must NEVER have a
// service worker, regardless of UA. Fully Kiosk on Android matches /Android/
// in the mobile regex, which previously gave the kiosk a PWA cache that
// could trap it on a dead build between deploys. Treat /daily-table as
// "always desktop mode": unregister any existing SW + purge caches on every
// visit so the kiosk self-heals and stays self-healed.
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
  navigator.userAgent
);
const isKioskPage = window.location.pathname.startsWith('/daily-table');

let hasReloadedForSwUpdate = false;
const swStartTime = Date.now();

const triggerReloadForSwUpdate = () => {
  if (hasReloadedForSwUpdate) return;
  // Don't reload if the page just loaded (< 12s) — avoids mid-load reload loops
  if (Date.now() - swStartTime < 12_000) return;
  hasReloadedForSwUpdate = true;
  window.location.reload();
};

if (isMobile && !isKioskPage && 'serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      const checkForUpdates = () => {
        registration.update().catch(() => {});
      };

      // Delay first update check by 10s so the app finishes loading before
      // a new SW can activate and trigger a mid-load reload.
      setTimeout(checkForUpdates, 10_000);
      window.setInterval(checkForUpdates, 60_000);
      window.addEventListener('focus', checkForUpdates);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdates();
      });
    },
  });

  navigator.serviceWorker.addEventListener('controllerchange', triggerReloadForSwUpdate);
} else if (!isMobile || isKioskPage) {
  // Desktop OR kiosk page: suppress browser install prompt entirely
  window.addEventListener('beforeinstallprompt', e => e.preventDefault());

  // Unregister any existing SW so stale cache is cleared.
  // If we find a registered SW (meaning this load was served from stale cache),
  // unregister + purge + hard-reload once so the user gets fresh code. A
  // sessionStorage flag prevents reload loops.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(async (regs) => {
      const hadSW = regs.length > 0;
      await Promise.all(regs.map(r => r.unregister().catch(() => {})));
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k).catch(() => {})));
      } catch {}
      if (hadSW && !sessionStorage.getItem('sw_purged_v1')) {
        sessionStorage.setItem('sw_purged_v1', '1');
        window.location.reload();
      }
    }).catch(() => {});
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
