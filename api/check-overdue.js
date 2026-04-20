// check-overdue.js — called by cron-job.org every 5 min.
//
// Runs two passes on reservations_new (Supabase table):
//
//  1. OVERDUE STATUS + EMAILS: reservations ≥30 min past return time,
//     status not already closed. Marks "באיחור" in DB and sends email.
//  2. PUSH REMINDERS: reservations 15–25 min before return, status "מאושר".
//
// ?force_push=email — skip time-window filter and send a test push to that email.

import { isVapidReady, fetchUserByEmail, sendPushToUser } from "./_push.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB_HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

// ── Timezone-aware date parser ───────────────────────────────────────────────
// return_date ("YYYY-MM-DD") and return_time ("HH:MM") are stored as Israel
// local time. Vercel servers run UTC, so we must convert explicitly.
// Israel DST: UTC+3 from ~last Fri of March through ~last Sun of October,
// UTC+2 otherwise. We approximate by month (close enough for reminder logic).
function toDateTime(dateStr, timeStr) {
  if (!dateStr) return 0;
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const [h, min] = String(timeStr || "00:00").split(":").map(Number);
  const isrOffsetHours = (m >= 4 && m <= 10) ? 3 : 2;
  return Date.UTC(
    y,
    (m || 1) - 1,
    d || 1,
    (Number.isFinite(h) ? h : 0) - isrOffsetHours,
    Number.isFinite(min) ? min : 0,
    0, 0
  );
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return `${(d || 1).toString().padStart(2, "0")}/${(m || 1).toString().padStart(2, "0")}/${y}`;
}

const CLOSED_STATUSES = new Set(["הוחזר", "נדחה", "בוטל", "מבוטל"]);

export default async function handler(req, res) {
  const authHeader = req.headers["authorization"];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ── ?force_push=email — test mode ────────────────────────────────────────
  const forcePushEmail = String(req.query?.force_push || "").trim().toLowerCase();
  if (forcePushEmail) {
    if (!isVapidReady()) return res.status(500).json({ error: "VAPID not configured" });
    try {
      const user = await fetchUserByEmail(forcePushEmail);
      if (!user) return res.status(404).json({ error: "user not found" });
      if (!user.is_push_enabled || !user.push_subscription)
        return res.status(400).json({ error: "user has no active push subscription" });
      await sendPushToUser(user, {
        title: "בדיקת התראה",
        body: "זוהי הודעת בדיקה — מערכת ההתראות עובדת תקין!",
        url: "/",
      });
      return res.status(200).json({ ok: true, message: `test push sent to ${forcePushEmail}` });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  try {
    // ── Fetch active reservations from DB (not store blob — that's empty) ──
    const supaRes = await fetch(
      `${SB_URL}/rest/v1/reservations_new?status=not.in.(הוחזר,נדחה,בוטל,מבוטל)&select=id,email,student_name,loan_type,borrow_date,return_date,return_time,status,overdue_notified,overdue_email_sent,reminder_sent`,
      { headers: SB_HEADERS }
    );
    if (!supaRes.ok) throw new Error(`Supabase fetch failed: ${supaRes.status}`);
    const reservations = await supaRes.json();

    if (!Array.isArray(reservations) || !reservations.length) {
      console.log("check-overdue: no active reservations");
      return res.status(200).json({ emails: 0, pushes: 0, marked: 0, message: "no active reservations" });
    }

    const nowMs = Date.now();
    const nowIL = new Date(nowMs).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
    const fmtUtc = (ms) => new Date(ms).toISOString();
    const fmtIL  = (ms) => new Date(ms).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });

    console.log([
      `check-overdue | server UTC: ${fmtUtc(nowMs)}`,
      `IL time: ${nowIL}`,
      `total active reservations: ${reservations.length}`,
    ].join(" | "));

    const THIRTY_MIN = 30 * 60 * 1000;
    const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    let emailsSent = 0;
    let markedOverdue = 0;

    // ── Pass 1: Detect overdue, mark status + send email ───────────────────
    const overdueCandiates = reservations.filter((r) => {
      if (CLOSED_STATUSES.has(r.status) || r.status === "באיחור") return false;
      if (!r.return_date) return false;
      // lesson reservations auto-archive; don't mark them overdue
      if (r.loan_type === "שיעור") return false;
      const returnMs = toDateTime(r.return_date, r.return_time || "23:59");
      return returnMs > 0 && nowMs - returnMs >= THIRTY_MIN;
    });

    for (const r of overdueCandiates) {
      // Mark "באיחור" in DB
      try {
        await fetch(`${SB_URL}/rest/v1/reservations_new?id=eq.${encodeURIComponent(r.id)}`, {
          method: "PATCH",
          headers: { ...SB_HEADERS, Prefer: "return=minimal" },
          body: JSON.stringify({ status: "באיחור" }),
        });
        markedOverdue++;
        console.log(`  marked overdue: ${r.id} (${r.student_name}, ${r.loan_type})`);
      } catch (e) {
        console.error(`  failed to mark overdue for ${r.id}:`, e.message);
        continue;
      }

      // Send overdue email (all loan types, including "צוות")
      if (r.email && !r.overdue_email_sent && !r.overdue_notified) {
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
          // Flag so we don't resend
          await fetch(`${SB_URL}/rest/v1/reservations_new?id=eq.${encodeURIComponent(r.id)}`, {
            method: "PATCH",
            headers: { ...SB_HEADERS, Prefer: "return=minimal" },
            body: JSON.stringify({ overdue_notified: true, overdue_email_sent: true }),
          });
          emailsSent++;
          console.log(`  overdue email sent → ${r.email} (${r.loan_type})`);
        } catch (e) {
          console.error(`  overdue email error for ${r.id}:`, e.message);
        }
      }
    }

    // ── Pass 2: Push reminders (15–25 min before return) ──────────────────
    const MIN_MS = 15 * 60 * 1000;
    const MAX_MS = 25 * 60 * 1000;
    const windowStartMs = nowMs + MIN_MS;
    const windowEndMs   = nowMs + MAX_MS;

    const pushCandidates = reservations.filter((r) => {
      if (!r || r.reminder_sent === true) return false;
      if (r.status !== "מאושר") return false;
      if (!r.return_date) return false;
      const delta = toDateTime(r.return_date, r.return_time || "23:59") - nowMs;
      return delta >= MIN_MS && delta <= MAX_MS;
    });

    console.log(`push candidates in window [${fmtIL(windowStartMs)} – ${fmtIL(windowEndMs)}]: ${pushCandidates.length} | vapidReady: ${isVapidReady()}`);

    let pushesSent = 0;
    if (isVapidReady() && pushCandidates.length > 0) {
      for (const r of pushCandidates) {
        const email = String(r.email || "").trim().toLowerCase();

        // Flag reminderSent in DB
        try {
          await fetch(`${SB_URL}/rest/v1/reservations_new?id=eq.${encodeURIComponent(r.id)}`, {
            method: "PATCH",
            headers: { ...SB_HEADERS, Prefer: "return=minimal" },
            body: JSON.stringify({ reminder_sent: true }),
          });
        } catch (e) {
          console.error(`  failed to flag reminderSent for ${r.id}:`, e.message);
        }

        if (!email) { console.log(`  skip ${r.id}: no email`); continue; }
        try {
          const user = await fetchUserByEmail(email);
          if (!user?.is_push_enabled || !user?.push_subscription) {
            console.log(`  skip ${email}: push disabled or no subscription`);
            continue;
          }
          await sendPushToUser(user, {
            title: "תזכורת החזרת ציוד",
            body: `${r.student_name || ""} אנא גש למחסן המכללה להחזיר את הציוד. צוות המכללה מאחל לך המשך יום נעים:)`,
            url: "/",
          });
          pushesSent++;
          console.log(`  push sent → ${email}`);
        } catch (err) {
          if (!err?.expired) console.error(`  push error for ${r.id}:`, err?.message);
          else console.log(`  skip ${email}: subscription expired`);
        }
      }
    }

    console.log(`check-overdue done: marked=${markedOverdue} emails=${emailsSent} pushes=${pushesSent}`);
    return res.status(200).json({ marked: markedOverdue, emails: emailsSent, pushes: pushesSent });
  } catch (e) {
    console.error("check-overdue error:", e.message);
    return res.status(500).json({ error: e.message });
  }
}
