// check-overdue.js — called by cron-job.org every 5 min.
//
// Runs two passes on the reservations array from the store table:
//
//  1. OVERDUE EMAILS: reservations ≥30 min past return time, status "באיחור".
//  2. PUSH REMINDERS: reservations 15–25 min before return, status "פעילה".
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
  const isrOffsetHours = (m >= 4 && m <= 10) ? 3 : 2; // UTC+3 Apr–Oct, UTC+2 otherwise
  // Build UTC timestamp directly: subtract Israel offset so we get true UTC ms
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

export default async function handler(req, res) {
  const authHeader = req.headers["authorization"];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ── ?force_push=email — test mode: send push to a specific user now ────────
  const forcePushEmail = String(req.query?.force_push || "").trim().toLowerCase();
  if (forcePushEmail) {
    if (!isVapidReady()) return res.status(500).json({ error: "VAPID not configured" });
    try {
      const user = await fetchUserByEmail(forcePushEmail);
      if (!user) return res.status(404).json({ error: "user not found" });
      if (!user.is_push_enabled || !user.push_subscription)
        return res.status(400).json({ error: "user has no active push subscription" });
      await sendPushToUser(user, {
        title: "🔔 בדיקת התראה",
        body: "זוהי הודעת בדיקה — מערכת ההתראות עובדת תקין!",
        url: "/",
      });
      return res.status(200).json({ ok: true, message: `test push sent to ${forcePushEmail}` });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
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
      console.log("check-overdue: no reservations in store");
      return res.status(200).json({ emails: 0, pushes: 0, message: "no reservations" });
    }

    const nowMs = Date.now();
    const nowIL = new Date(nowMs).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });

    // ── Pass 2 window (for logging) ─────────────────────────────────────────
    const MIN_MS = 15 * 60 * 1000;
    const MAX_MS = 25 * 60 * 1000;
    const windowStartMs = nowMs + MIN_MS;
    const windowEndMs   = nowMs + MAX_MS;
    const fmtUtc = (ms) => new Date(ms).toISOString();
    const fmtIL  = (ms) => new Date(ms).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });

    console.log([
      `check-overdue | server UTC: ${fmtUtc(nowMs)}`,
      `IL time: ${nowIL}`,
      `reminder window: ${fmtIL(windowStartMs)} – ${fmtIL(windowEndMs)} (IL)`,
      `total reservations: ${reservations.length}`,
    ].join(" | "));

    // Log all "פעילה" reservations with their parsed times for debugging
    const active = reservations.filter(r => r.status === "פעילה" && r.return_date);
    console.log(`active reservations (פעילה): ${active.length}`);
    for (const r of active) {
      const returnMs = toDateTime(r.return_date, r.return_time || "23:59");
      const deltaMin = Math.round((returnMs - nowMs) / 60000);
      console.log(
        `  [${r.id || "?"}] ${r.student_name || "?"} | ` +
        `return ${r.return_date} ${r.return_time || ""} IL → ` +
        `UTC ${fmtUtc(returnMs)} | delta: ${deltaMin} min | reminderSent: ${r.reminderSent}`
      );
    }

    let dirty = false;

    // ── Pass 1: Overdue emails ──────────────────────────────────────────────
    const THIRTY_MIN = 30 * 60 * 1000;
    const overdueToSend = reservations.filter(
      (r) =>
        r.status === "באיחור" &&
        !r.overdue_email_sent &&
        r.email &&
        r.loan_type !== "שיעור" &&
        r.loan_type !== "צוות" &&
        r.return_date &&
        nowMs - toDateTime(r.return_date, r.return_time || "23:59") >= THIRTY_MIN
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

    // ── Pass 2: Push reminders (15–25 min before return; target ≈20 min) ──
    const pushCandidates = reservations.filter((r) => {
      if (!r || r.reminderSent === true) return false;
      if (r.status !== "פעילה") return false;
      if (!r.return_date) return false;
      const delta = toDateTime(r.return_date, r.return_time || "23:59") - nowMs;
      return delta >= MIN_MS && delta <= MAX_MS;
    });

    console.log(`push candidates in window: ${pushCandidates.length} | vapidReady: ${isVapidReady()}`);

    let pushesSent = 0;
    if (isVapidReady() && pushCandidates.length > 0) {
      for (const r of pushCandidates) {
        const email = String(r.email || "").trim().toLowerCase();
        r.reminderSent = true;
        dirty = true;

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
          else console.log(`  skip ${email}: subscription expired, cleared from DB`);
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

    console.log(`check-overdue done: emails=${emailsSent} pushes=${pushesSent}`);
    return res.status(200).json({ emails: emailsSent, pushes: pushesSent });
  } catch (e) {
    console.error("check-overdue error:", e.message);
    return res.status(500).json({ error: e.message });
  }
}
