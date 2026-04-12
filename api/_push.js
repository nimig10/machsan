// _push.js — shared Web Push utility (underscore prefix = not a Vercel function).
// Imported by check-overdue.js (cron) and any other server-side code that
// needs to send push notifications.

import webpush from "web-push";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VAPID_PUBLIC  = process.env.VITE_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

let vapidReady = false;
if (VAPID_PUBLIC && VAPID_PRIVATE && VAPID_SUBJECT) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  vapidReady = true;
}

export function isVapidReady() { return vapidReady; }

/** Fetch a user row by id (includes push fields). */
export async function fetchUserById(userId) {
  const res = await fetch(
    `${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=id,is_push_enabled,push_subscription`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
  if (!res.ok) throw new Error(`user_fetch_failed_${res.status}`);
  const rows = await res.json();
  return rows?.[0] || null;
}

/** Fetch a user row by email (includes push fields). */
export async function fetchUserByEmail(email) {
  const res = await fetch(
    `${SB_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id,is_push_enabled,push_subscription`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
  if (!res.ok) throw new Error(`user_fetch_failed_${res.status}`);
  const rows = await res.json();
  return rows?.[0] || null;
}

/** Null-out a dead subscription in the DB (404/410 from push service). */
export async function clearSubscription(userId) {
  await fetch(
    `${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ push_subscription: null, is_push_enabled: false }),
    }
  ).catch(() => {});
}

/**
 * Send a Web Push notification to a user object (must have push_subscription).
 * Returns { ok: true } or throws.
 * On 404/410, auto-clears the DB subscription and throws with { expired: true }.
 */
export async function sendPushToUser(user, { title, body = "", url = "/" }) {
  const payload = JSON.stringify({ title, body, url, data: { url } });
  try {
    await webpush.sendNotification(user.push_subscription, payload);
    return { ok: true };
  } catch (err) {
    const statusCode = err?.statusCode || err?.status;
    if (statusCode === 404 || statusCode === 410) {
      await clearSubscription(user.id);
      const expired = new Error("subscription_expired");
      expired.expired = true;
      expired.statusCode = statusCode;
      throw expired;
    }
    throw err;
  }
}
