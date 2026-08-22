// check-overdue.js — called by cron-job.org every 5 min.
//
// Runs three passes on reservations_new (Supabase table):
//
//  1. OVERDUE STATUS: reservations ≥30 min past return time, status not already
//     closed. Marks "באיחור" in DB. FIXED at 30 min, deliberately not settable.
//  2. OVERDUE EMAILS: reservations past return time by the admin-set delay
//     (overdueEmailDelayMinutes, default 90) that actually went out.
//  3. PUSH REMINDERS: reservations 15–25 min before return, status "מאושר".
//
// ⚠️ 1 AND 2 ARE SEPARATE PASSES, AND THAT IS LOAD-BEARING.
//
// The email used to live inside pass 1's loop, which was fine only while the
// two shared one threshold. Pass 1's candidate filter excludes rows that are
// ALREADY "באיחור" — so once it stamps a row at minute 30, that row never
// appears in the list again. Leaving the email there and giving it a later
// deadline would mean it is simply never sent: no error, no log, nothing.
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

// How long after the return time the student is emailed. Admin-set, because 30
// minutes turned out to be shorter than a complex return takes to process at the
// counter — the student was being told "נדרשת פעולה מיידית" about gear already
// standing on the shelf.
//
// ⚠️ This governs the EMAIL ONLY. The status flip in pass 1 stays at a fixed 30
// minutes and must not be wired to this value; it is the warehouse's own early
// signal, and the product owner asked for it explicitly to stay put.
const DEFAULT_OVERDUE_EMAIL_DELAY_MIN = 90;
const MAX_OVERDUE_EMAIL_DELAY_MIN = 1440;

// First thing under api/ to read site_settings at all.
//
// NOT modelled on readStoreKey() in notify-course-end-7days.js — that one reads
// a `store` row that migration 20260430140000 deleted, so it has been quietly
// returning null ever since. This reads the live table with the service key the
// file already holds.
//
// Any failure — network, missing key, junk value — falls back to the default.
// A settings lookup must never be able to stop the cron from running.
async function readOverdueEmailDelayMs() {
  const fallback = DEFAULT_OVERDUE_EMAIL_DELAY_MIN * 60000;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/site_settings?key=eq.overdueEmailDelayMinutes&select=value&limit=1`,
      { headers: SB_HEADERS },
    );
    if (!r.ok) return fallback;
    const rows = await r.json();
    const n = Number(rows?.[0]?.value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(MAX_OVERDUE_EMAIL_DELAY_MIN, n)) * 60000;
  } catch (e) {
    console.warn("overdueEmailDelayMinutes lookup failed, using default:", e.message);
    return fallback;
  }
}

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
      `${SB_URL}/rest/v1/reservations_new?status=not.in.(הוחזר,נדחה,בוטל,מבוטל)&select=id,email,student_name,loan_type,borrow_date,return_date,return_time,status,issued_at,overdue_notified,overdue_email_sent,reminder_sent`,
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

    // ── Pass 1: Detect overdue, mark status ────────────────────────────────
    //
    // FIXED 30 minutes. Not settable, and deliberately so: this is the
    // warehouse's own early signal that something has not come back, and the
    // product owner asked for it to stay exactly where it is. Only the email
    // below moved.
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
    }

    // ── Pass 2: Overdue emails (admin-set delay, default 90 min) ───────────
    //
    // A SEPARATE pass, not a branch inside pass 1 — see the header. Pass 1's
    // filter drops rows that are already "באיחור", so a row it stamped at
    // minute 30 can never come back round for an email at minute 90.
    //
    // Deliberately does NOT filter on status === "באיחור". Requiring it would
    // silently break every delay below 30 minutes, and it would also miss the
    // rows pass 1 has just stamped in this very run (the in-memory array still
    // carries their old status). Being past the return time by the configured
    // delay is the whole condition.
    const emailDelayMs = await readOverdueEmailDelayMs();
    console.log(`  overdue email delay: ${Math.round(emailDelayMs / 60000)} min`);

    const emailCandidates = reservations.filter((r) => {
      if (CLOSED_STATUSES.has(r.status)) return false;
      if (r.loan_type === "שיעור") return false;
      // ⚠️ NEVER-COLLECTED REQUESTS GET NO OVERDUE EMAIL.
      //
      // The status is still written by pass 1 — the row genuinely is past its
      // return time, and the UI re-labels it to "לא יצא?" from issued_at. But
      // this email is subject-lined "אזהרת איחור בהחזרת ציוד — נדרשת פעולה
      // מיידית", and sending that to somebody who never picked anything up
      // accuses them of losing gear that has been on the shelf the whole time.
      // The anomaly is surfaced to STAFF instead, as a "לא יצא?" badge and its
      // own dashboard tile — a human decides what to do.
      //
      // Trade-off, stated on purpose: if an operator hands gear over and forgets
      // to run the checkout screen, that loan looks uncollected and its student
      // gets no overdue email. The badge is what makes the missed step visible.
      if (!r.issued_at) return false;
      if (!r.email || r.overdue_email_sent || r.overdue_notified) return false;
      if (!r.return_date) return false;
      const returnMs = toDateTime(r.return_date, r.return_time || "23:59");
      return returnMs > 0 && nowMs - returnMs >= emailDelayMs;
    });

    for (const r of emailCandidates) {
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

    // ── Pass 3: Push reminders (15–25 min before return) ──────────────────
    const MIN_MS = 15 * 60 * 1000;
    const MAX_MS = 25 * 60 * 1000;
    const windowStartMs = nowMs + MIN_MS;
    const windowEndMs   = nowMs + MAX_MS;

    const pushCandidates = reservations.filter((r) => {
      if (!r || r.reminder_sent === true) return false;
      // "פעילה" as well as "מאושר": checkout writes it for real now, so a loan
      // the warehouse actually handed over sits at "פעילה" and would otherwise
      // stop receiving the very reminder it most needs.
      if (r.status !== "מאושר" && r.status !== "פעילה") return false;
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
