import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'

let hasReloadedForSwUpdate = false;

const triggerReloadForSwUpdate = () => {
  if (hasReloadedForSwUpdate) return;
  hasReloadedForSwUpdate = true;
  window.location.reload();
};

if ('serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      const checkForUpdates = () => {
        registration.update().catch(() => {});
      };

      checkForUpdates();
      window.setInterval(checkForUpdates, 60_000);
      window.addEventListener('focus', checkForUpdates);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdates();
      });
    },
  });

  navigator.serviceWorker.addEventListener('controllerchange', triggerReloadForSwUpdate);
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
