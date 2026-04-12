// check-overdue.js — Vercel Cron job (every 5 min).
//
// Runs two passes on the reservations array from the store table:
//
//  1. OVERDUE EMAILS: reservations that are ≥30 min past their return time,
//     status "באיחור", and haven't had overdue_email_sent set yet.
//
//  2. PUSH REMINDERS: reservations whose return time is 25–35 min away,
//     reminderSent is not true, and status is not terminal.
//     Sends a Web Push notification to the student (if subscribed).

import { isVapidReady, fetchUserByEmail, sendPushToUser } from "./_push.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB_HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

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

function formatDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return `${(d || 1).toString().padStart(2, "0")}/${(m || 1).toString().padStart(2, "0")}/${y}`;
}

export default async function handler(req, res) {
  // Vercel Cron passes Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers["authorization"];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // ── Fetch reservations ──────────────────────────────────────────────────
    const supaRes = await fetch(
      `${SB_URL}/rest/v1/store?key=eq.reservations&select=data`,
      { headers: SB_HEADERS }
    );
    if (!supaRes.ok) throw new Error(`Supabase fetch failed: ${supaRes.status}`);
    const supaJson = await supaRes.json();
    const reservations =
      Array.isArray(supaJson) && supaJson.length > 0 ? supaJson[0].data : [];

    if (!Array.isArray(reservations) || !reservations.length) {
      return res.status(200).json({ emails: 0, pushes: 0, message: "no reservations" });
    }

    const now = Date.now();
    let dirty = false; // true if any reservation object was mutated

    // ── Pass 1: Overdue emails ──────────────────────────────────────────────
    const THIRTY_MIN = 30 * 60 * 1000;
    const overdueToSend = reservations.filter(
      (r) =>
        r.status === "באיחור" &&
        !r.overdue_email_sent &&
        r.email &&
        r.loan_type !== "שיעור" &&
        r.return_date &&
        now - toDateTime(r.return_date, r.return_time || "23:59") >= THIRTY_MIN
    );

    const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    let emailsSent = 0;
    for (const r of overdueToSend) {
      try {
        await fetch(`${baseUrl}/api/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: r.email,
            type: "overdue",
            student_name: r.student_name,
            borrow_date: formatDate(r.borrow_date),
            return_date: formatDate(r.return_date),
            return_time: r.return_time || "",
          }),
        });
        r.overdue_email_sent = true;
        dirty = true;
        emailsSent++;
      } catch (e) {
        console.error("overdue email error for", r.id, e.message);
      }
    }

    // ── Pass 2: Push reminders (25–35 min before return) ───────────────────
    const MIN_MS = 25 * 60 * 1000;
    const MAX_MS = 35 * 60 * 1000;
    const pushCandidates = reservations.filter((r) => {
      if (!r || r.reminderSent === true) return false;
      if (TERMINAL_STATUSES.has(r.status)) return false;
      if (!r.return_date) return false;
      const delta = toDateTime(r.return_date, r.return_time || "23:59") - now;
      return delta >= MIN_MS && delta <= MAX_MS;
    });

    let pushesSent = 0;
    if (isVapidReady() && pushCandidates.length > 0) {
      for (const r of pushCandidates) {
        const email = String(r.email || "").trim().toLowerCase();

        // Always mark as processed so we don't retry on every tick.
        r.reminderSent = true;
        dirty = true;

        if (!email) continue;
        try {
          const user = await fetchUserByEmail(email);
          if (!user?.is_push_enabled || !user?.push_subscription) continue;

          const endTimeStr = String(r.return_time || "").trim();
          await sendPushToUser(user, {
            title: "תזכורת החזרת ציוד",
            body: `היי ${r.student_name || ""} הציוד שהשאלת צריך לחזור למחסן עד השעה ${endTimeStr} ללא איחורים. המשך יום נעים`,
            url: "/",
          });
          pushesSent++;
        } catch (err) {
          // expired subscription: already cleared inside sendPushToUser
          if (!err?.expired) console.error("push error for", r.id, err?.message);
        }
      }
    }

    // ── Write back if anything changed ─────────────────────────────────────
    if (dirty) {
      await fetch(`${SB_URL}/rest/v1/store`, {
        method: "POST",
        headers: { ...SB_HEADERS, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ key: "reservations", data: reservations }),
      });
    }

    console.log(`check-overdue: emails=${emailsSent} pushes=${pushesSent}`);
    return res.status(200).json({ emails: emailsSent, pushes: pushesSent });
  } catch (e) {
    console.error("check-overdue error:", e.message);
    return res.status(500).json({ error: e.message });
  }
}
