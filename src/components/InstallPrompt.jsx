import { useState, useEffect } from 'react';

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    // 1. Check if already installed
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isStandalone) return;

    // 2. Check if mobile
    const isMobile = window.innerWidth <= 768 || /Mobi|Android|iPhone/i.test(navigator.userAgent);
    if (!isMobile) return;

    // 3. Check if user dismissed it within the last 30 minutes
    const lastDismissed = localStorage.getItem('installPromptDismissedAt');
    if (lastDismissed) {
      const timeSinceDismiss = Date.now() - parseInt(lastDismissed, 10);
      if (timeSinceDismiss < 30 * 60 * 1000) {
        return; // Don't show if it hasn't been 30 minutes
      }
    }

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowPrompt(false);
    }
    setDeferredPrompt(null);
  };

  const handleClose = () => {
    setShowPrompt(false);
    // Save the timestamp of dismissal
    localStorage.setItem('installPromptDismissedAt', Date.now().toString());
  };

  if (!showPrompt) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.banner}>
        <div style={styles.content}>
          <span style={styles.icon}>📲</span>
          <div style={styles.textContainer}>
            <strong style={styles.title}>התקן את 'קמרה סאונד APP'</strong>
            <p style={styles.subtitle}>גישה מהירה מהמסך הראשי</p>
          </div>
        </div>
        <div style={styles.actions}>
          <button style={styles.installBtn} onClick={handleInstallClick}>התקן</button>
          <button style={styles.closeBtn} onClick={handleClose}>✕</button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    bottom: '20px',
    left: '20px',
    right: '20px',
    zIndex: 99999,
    display: 'flex',
    justifyContent: 'center',
    animation: 'slideUp 0.3s ease-out',
  },
  banner: {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    padding: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: '400px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    gap: '12px'
  },
  content: { display: 'flex', alignItems: 'center', gap: '12px' },
  icon: { fontSize: '28px' },
  textContainer: { display: 'flex', flexDirection: 'column', color: 'var(--text)' },
  title: { fontSize: '15px', fontWeight: '700', color: 'var(--accent)' },
  subtitle: { fontSize: '12px', color: 'var(--text2)', margin: 0 },
  actions: { display: 'flex', alignItems: 'center', gap: '8px' },
  installBtn: {
    backgroundColor: 'var(--accent)', color: '#0a0c10', border: 'none',
    padding: '8px 16px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px'
  },
  closeBtn: {
    backgroundColor: 'transparent', color: 'var(--text2)', border: 'none',
    padding: '4px', cursor: 'pointer', fontSize: '16px'
  }
};
