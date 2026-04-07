import { useCallback, useEffect, useState } from "react";

function isStandaloneMode() {
  if (typeof window === "undefined") return false;

  return Boolean(
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone
  );
}

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(() => isStandaloneMode());

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const mediaQuery = typeof window.matchMedia === "function"
      ? window.matchMedia("(display-mode: standalone)")
      : null;

    const syncInstallState = () => {
      const standalone = isStandaloneMode();
      setIsInstalled(standalone);

      if (standalone) {
        setDeferredPrompt(null);
      }
    };

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
      setIsInstalled(false);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsInstalled(true);
    };

    syncInstallState();

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    if (mediaQuery?.addEventListener) {
      mediaQuery.addEventListener("change", syncInstallState);
    } else if (mediaQuery?.addListener) {
      mediaQuery.addListener(syncInstallState);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);

      if (mediaQuery?.removeEventListener) {
        mediaQuery.removeEventListener("change", syncInstallState);
      } else if (mediaQuery?.removeListener) {
        mediaQuery.removeListener(syncInstallState);
      }
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return false;

    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      setDeferredPrompt(null);

      if (outcome === "accepted") {
        setIsInstalled(true);
        return true;
      }
    } catch (error) {
      console.warn("install prompt failed", error);
    }

    return false;
  }, [deferredPrompt]);

  return {
    canInstall: !isInstalled && !!deferredPrompt,
    isInstalled,
    install,
  };
}
