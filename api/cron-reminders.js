// cron-reminders.js — Vercel Cron job (every 5 min).
//
// Finds reservations whose end time is 25–35 minutes from now, hasn't already
// had a reminder sent, and pushes a Web Push reminder to the student.
// After sending (or permanently failing), marks reminderSent: true on the
// reservation so it isn't re-processed.
//
// On a 404/410 from the push service, also clears the user's
// push_subscription + is_push_enabled so future calls don't retry a dead sub.

import webpush from "web-push";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB_HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

const VAPID_PUBLIC  = process.env.VITE_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

if (VAPID_PUBLIC && VAPID_PRIVATE && VAPID_SUBJECT) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

const TERMINAL_STATUSES = new Set(["הוחזר", "נדחה", "בוטל"]);

function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}

function toDateTime(dateStr, timeStr) {
  const d = parseLocalDate(dateStr);
  if (!d) return 0;
  const [h, m] = String(timeStr || "00:00").split(":").map(Number);
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return d.getTime();
}

export default async function handler(req, res) {
  // Vercel Cron passes Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers["authorization"];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!VAPID_PUBLIC || !VAPID_PRIVATE || !VAPID_SUBJECT) {
    return res.status(500).json({ error: "vapid_not_configured" });
  }
  if (!SB_URL || !SB_KEY) {
    return res.status(500).json({ error: "supabase_not_configured" });
  }

  try {
    // 1. Fetch reservations array from store
    const sRes = await fetch(
      `${SB_URL}/rest/v1/store?key=eq.reservations&select=data`,
      { headers: SB_HEADERS }
    );
    if (!sRes.ok) throw new Error(`reservations_fetch_failed_${sRes.status}`);
    const sJson = await sRes.json();
    const reservations = Array.isArray(sJson) && sJson.length > 0 ? sJson[0].data : [];

    if (!Array.isArray(reservations) || reservations.length === 0) {
      return res.status(200).json({ sent: 0, message: "no_reservations" });
    }

    // 2. Filter: endTime 25–35 min from now, reminderSent !== true, not terminal
    const now = Date.now();
    const MIN_MS = 25 * 60 * 1000;
    const MAX_MS = 35 * 60 * 1000;

    const toRemind = reservations.filter((r) => {
      if (!r || r.reminderSent === true) return false;
      if (TERMINAL_STATUSES.has(r.status)) return false;
      if (!r.return_date) return false;
      const endTime = toDateTime(r.return_date, r.return_time || "23:59");
      const delta = endTime - now;
      return delta >= MIN_MS && delta <= MAX_MS;
    });

    if (toRemind.length === 0) {
      return res.status(200).json({ sent: 0, checked: reservations.length });
    }

    // 3. For each: fetch user by email, validate push, send notification
    const processedIds = new Set();       // mark reminderSent:true on these
    const subsToClear = new Set();        // user.id → clear push_subscription
    const results = [];

    for (const r of toRemind) {
      const email = String(r.email || "").trim().toLowerCase();
      if (!email) {
        results.push({ id: r.id, ok: false, reason: "no_email" });
        processedIds.add(r.id); // don't retry — email can't appear later
        continue;
      }

      try {
        const uRes = await fetch(
          `${SB_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id,is_push_enabled,push_subscription`,
          { headers: SB_HEADERS }
        );
        if (!uRes.ok) {
          results.push({ id: r.id, ok: false, reason: `user_fetch_${uRes.status}` });
          continue; // retry on next cron tick
        }
        const rows = await uRes.json();
        const user = rows?.[0];

        if (!user) {
          results.push({ id: r.id, ok: false, reason: "user_not_found" });
          processedIds.add(r.id);
          continue;
        }
        if (!user.is_push_enabled || !user.push_subscription) {
          results.push({ id: r.id, ok: false, reason: "push_disabled_or_missing" });
          processedIds.add(r.id);
          continue;
        }

        const studentName = String(r.student_name || "").trim();
        const endTimeStr  = String(r.return_time || "").trim();
        const payload = JSON.stringify({
          title: "תזכורת החזרת ציוד",
          body:  `היי ${studentName} הציוד שהשאלת צריך לחזור למחסן עד השעה ${endTimeStr} ללא איחורים. המשך יום נעים`,
          url:   "/",
          data:  { url: "/", reservationId: r.id },
        });

        try {
          await webpush.sendNotification(user.push_subscription, payload);
          processedIds.add(r.id);
          results.push({ id: r.id, ok: true });
        } catch (err) {
          const statusCode = err?.statusCode || err?.status;
          if (statusCode === 404 || statusCode === 410) {
            subsToClear.add(user.id);
            processedIds.add(r.id); // dead sub — won't help to retry
            results.push({ id: r.id, ok: false, reason: "subscription_expired", statusCode });
          } else {
            results.push({
              id: r.id, ok: false, reason: "send_failed",
              statusCode: statusCode || null,
              details: String(err?.body || err?.message || err),
            });
          }
        }
      } catch (err) {
        results.push({ id: r.id, ok: false, reason: "exception", details: String(err?.message || err) });
      }
    }

    // 4. Persist reminderSent flags back to store
    if (processedIds.size > 0) {
      const updated = reservations.map((r) =>
        processedIds.has(r.id) ? { ...r, reminderSent: true } : r
      );
      const wRes = await fetch(`${SB_URL}/rest/v1/store`, {
        method: "POST",
        headers: { ...SB_HEADERS, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ key: "reservations", data: updated }),
      });
      if (!wRes.ok) {
        console.error("cron-reminders: store write failed", wRes.status);
      }
    }

    // 5. Clear dead subscriptions
    for (const userId of subsToClear) {
      await fetch(`${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { ...SB_HEADERS, Prefer: "return=minimal" },
        body: JSON.stringify({ push_subscription: null, is_push_enabled: false }),
      }).catch(() => {});
    }

    const sentCount = results.filter((r) => r.ok).length;
    console.log(`cron-reminders: candidates=${toRemind.length} sent=${sentCount}`);
    return res.status(200).json({
      candidates: toRemind.length,
      sent: sentCount,
      processed: processedIds.size,
      cleared_subs: subsToClear.size,
      results,
    });
  } catch (e) {
    console.error("cron-reminders error:", e.message);
    return res.status(500).json({ error: e.message });
  }
}
