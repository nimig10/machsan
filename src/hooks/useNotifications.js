// useNotifications — manages Web Push subscription state for the logged-in user.
//
// - Reads initial `is_push_enabled` + `push_subscription` from public.users
// - enable(): requests permission, subscribes via VITE_VAPID_PUBLIC_KEY,
//             saves the subscription to the DB, flips is_push_enabled → true
// - disable(): flips is_push_enabled → false (keeps the subscription stored
//              so the backend can stop sending, but unsubscribes locally too)

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

const isSupported =
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export function useNotifications() {
  const [permission, setPermission] = useState(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [isEnabled, setIsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const userIdRef = useRef(null);
  const hasSubscriptionRef = useRef(false);

  // Load initial state from the DB for the current session user.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) { if (!cancelled) setLoading(false); return; }
        userIdRef.current = userId;
        const { data, error: dbErr } = await supabase
          .from('users')
          .select('is_push_enabled,push_subscription')
          .eq('id', userId)
          .maybeSingle();
        if (cancelled) return;
        if (dbErr) { setError(dbErr.message || 'שגיאה בטעינת הגדרות התראות'); }
        else {
          // Default-on: reflect the DB's is_push_enabled (defaults to TRUE for new users)
          hasSubscriptionRef.current = !!data?.push_subscription;
          setIsEnabled(!!data?.is_push_enabled);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const enable = useCallback(async () => {
    if (!isSupported) { const m = 'הדפדפן אינו תומך בהתראות Push'; setError(m); return { ok: false, error: m }; }
    setError('');
    setBusy(true);
    try {
      const userId = userIdRef.current;
      if (!userId) throw new Error('לא מחובר');

      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        const m = 'ההרשאה להתראות נדחתה — אפשר להפעיל מחדש בהגדרות הדפדפן';
        setError(m);
        return { ok: false, error: m };
      }

      const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
      if (!vapidKey) throw new Error('VITE_VAPID_PUBLIC_KEY חסר ב-.env');

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
      }

      const { error: dbErr } = await supabase
        .from('users')
        .update({
          push_subscription: subscription.toJSON(),
          is_push_enabled: true,
        })
        .eq('id', userId);
      if (dbErr) throw new Error(dbErr.message);

      hasSubscriptionRef.current = true;
      setIsEnabled(true);
      return { ok: true };
    } catch (err) {
      const m = err?.message || 'הפעלת ההתראות נכשלה';
      setError(m);
      return { ok: false, error: m };
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setError('');
    setBusy(true);
    try {
      const userId = userIdRef.current;
      if (!userId) throw new Error('לא מחובר');

      // Unsubscribe locally so the browser stops receiving pushes.
      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (existing) await existing.unsubscribe();
      } catch { /* ignore local unsubscribe failures */ }

      const { error: dbErr } = await supabase
        .from('users')
        .update({ is_push_enabled: false, push_subscription: null })
        .eq('id', userId);
      if (dbErr) throw new Error(dbErr.message);

      hasSubscriptionRef.current = false;
      setIsEnabled(false);
      return { ok: true };
    } catch (err) {
      const m = err?.message || 'כיבוי ההתראות נכשל';
      setError(m);
      return { ok: false, error: m };
    } finally {
      setBusy(false);
    }
  }, []);

  return { isSupported, permission, isEnabled, loading, busy, error, enable, disable };
}
