import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'

// ── PWA: mobile only ─────────────────────────────────────────────────────────
// Register the service worker only on mobile/tablet devices.
// Desktop users get a plain web app (no install prompt, no SW cache issues).
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
  navigator.userAgent
);

let hasReloadedForSwUpdate = false;
const swStartTime = Date.now();

const triggerReloadForSwUpdate = () => {
  if (hasReloadedForSwUpdate) return;
  // Don't reload if the page just loaded (< 12s) — avoids mid-load reload loops
  if (Date.now() - swStartTime < 12_000) return;
  hasReloadedForSwUpdate = true;
  window.location.reload();
};

if (isMobile && 'serviceWorker' in navigator) {
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
} else if (!isMobile) {
  // Desktop: suppress browser install prompt entirely
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
    <App />
  </StrictMode>,
)
