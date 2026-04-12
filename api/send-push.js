// send-push.js — send a Web Push notification to a single user.
//
// POST /api/send-push   body: { userId, title, body, url }
//
// Looks up public.users.{is_push_enabled, push_subscription} via the Supabase
// REST API. On 404/410 from the push service, auto-clears the subscription
// and disables pushes for that user (subscription was revoked/expired).

import webpush from "web-push";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VAPID_PUBLIC  = process.env.VITE_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

if (VAPID_PUBLIC && VAPID_PRIVATE && VAPID_SUBJECT) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

async function sbFetchUser(userId) {
  const res = await fetch(
    `${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=id,is_push_enabled,push_subscription`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
  if (!res.ok) throw new Error(`supabase_fetch_failed_${res.status}`);
  const rows = await res.json();
  return rows?.[0] || null;
}

async function sbClearSubscription(userId) {
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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!VAPID_PUBLIC || !VAPID_PRIVATE || !VAPID_SUBJECT) {
    return res.status(500).json({ error: "vapid_not_configured" });
  }
  if (!SB_URL || !SB_KEY) {
    return res.status(500).json({ error: "supabase_not_configured" });
  }

  const { userId, title, body, url } = req.body || {};
  if (!userId || !title) {
    return res.status(400).json({ error: "missing_fields", required: ["userId", "title"] });
  }

  let user;
  try {
    user = await sbFetchUser(userId);
  } catch (err) {
    return res.status(500).json({ error: "fetch_user_failed", details: String(err?.message || err) });
  }
  if (!user) return res.status(404).json({ error: "user_not_found" });

  if (!user.is_push_enabled || !user.push_subscription) {
    return res.status(400).json({
      error: "push_disabled_or_missing",
      is_push_enabled: !!user.is_push_enabled,
      has_subscription: !!user.push_subscription,
    });
  }

  const payload = JSON.stringify({
    title: String(title),
    body: body ? String(body) : "",
    url: url ? String(url) : "/",
    data: { url: url ? String(url) : "/" },
  });

  try {
    await webpush.sendNotification(user.push_subscription, payload);
    return res.status(200).json({ ok: true });
  } catch (err) {
    const statusCode = err?.statusCode || err?.status;
    // 404 = no record of the subscription; 410 = subscription revoked/expired
    if (statusCode === 404 || statusCode === 410) {
      await sbClearSubscription(userId);
      return res.status(410).json({
        error: "subscription_expired",
        statusCode,
        cleared: true,
      });
    }
    return res.status(500).json({
      error: "send_failed",
      statusCode: statusCode || null,
      details: String(err?.body || err?.message || err),
    });
  }
}
