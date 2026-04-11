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

  // Unregister any existing SW so stale cache is cleared
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(r => r.unregister());
    });
    caches.keys().then(keys => {
      keys.forEach(k => caches.delete(k));
    });
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
