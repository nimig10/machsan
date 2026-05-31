// production-deadline-reminder.js — daily cron: equipment-list deadline reminder.
//
// PURPOSE:
//   One day before the deadline to submit an equipment list for a production
//   shoot date, email the production's director (the student who submits the
//   list). The school's policy is "8 days inclusive" notice — the last day to
//   submit is the shoot date minus 7 calendar days (see ProductionsPage.jsx
//   equipmentDeadline(): daysToDeadline = daysToShoot - 7). "One day before the
//   deadline" is therefore the day on which daysToShoot === 8.
//
//   We only remind for shoot dates that do NOT yet have an equipment-list
//   reservation attached (a reservations_new row with production_date_id and a
//   non-cancelled status). If the director already submitted, no email is sent.
//
// SCHEDULE:
//   Configured in vercel.json. Runs once per day at 09:00 UTC. Idempotency is
//   structural: a shoot date matches the daysToShoot===8 window on exactly one
//   calendar day, and the Vercel cron fires once that day — so each director
//   gets at most one reminder per production (no DB flag needed). Mirrors the
//   exact-day-match approach of notify-course-end-7days.js.
//
// SECURITY:
//   Vercel sets `Authorization: Bearer {CRON_SECRET}` on cron invocations.
//   Other callers are rejected with 401. A `?force_test=<email>` query param
//   (also gated by CRON_SECRET) sends a single sample reminder for manual
//   testing on a Preview deployment, bypassing the date match.
//
// PROTOCOL:
//   GET /api/production-deadline-reminder
//   200: { ok, sent, considered, today_il }
//   401: missing / wrong bearer token
//   5xx: fetch / SMTP error

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const SERVICE_HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

// Day on which we remind, relative to the shoot date. daysToShoot === 8 is
// "one day before the deadline" (deadline = shoot − 7, last day = daysToShoot 7).
const REMINDER_DAYS_BEFORE_SHOOT = 8;

const PORTAL_URL = "https://app.camera.org.il";
// The app's entry/login page (same SPA root — students log in here, then reach
// StudentHub → לוח הפקות).
const LOGIN_URL = "https://app.camera.org.il";

// Today's date in Israel timezone, formatted YYYY-MM-DD.
function todayInIsrael() {
  const fmt = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" });
  return fmt.slice(0, 10);
}

// Returns YYYY-MM-DD that is `daysBefore` calendar days before `isoDate`.
function shiftDate(isoDate, daysBefore) {
  const [y, m, d] = String(isoDate).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  const ms = Date.UTC(y, m - 1, d) - daysBefore * 24 * 60 * 60 * 1000;
  const dt = new Date(ms);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// "YYYY-MM-DD" → "DD/MM/YYYY" for display in the email body.
function formatDateHe(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = String(isoDate).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function fmtHHMM(t) {
  return t ? String(t).slice(0, 5) : "";
}

// One shoot date → "DD/MM/YYYY (HH:MM–HH:MM)", or a "DD/MM/YYYY – DD/MM/YYYY"
// range for a multi-day shoot.
function shootDateLine(d) {
  const start = formatDateHe(d.start_date);
  const end = d.end_date && d.end_date !== d.start_date ? formatDateHe(d.end_date) : "";
  const dateStr = end ? `${start} – ${end}` : start;
  const st = fmtHHMM(d.start_time);
  const et = fmtHHMM(d.end_time);
  const timeStr = st && et ? ` (${st}–${et})` : st ? ` (${st})` : "";
  return dateStr + timeStr;
}

async function fetchJson(path) {  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SERVICE_HEADERS });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`fetch ${path} failed: ${r.status} ${text}`);
  }
  return r.json();
}

function baseUrlFromEnv() {
  return process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";
}

async function sendReminder(baseUrl, { to, directorName, title, datesText }) {
  const res = await fetch(`${baseUrl}/api/send-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cron-Secret": CRON_SECRET || "",
    },
    body: JSON.stringify({
      to,
      type: "production_deadline",
      recipient_name: directorName || "סטודנט/ית",
      student_name: directorName || "סטודנט/ית",
      project_name: title || "",
      shoot_dates_text: datesText || "",
      loan_type: "הפקה",
      portal_url: PORTAL_URL,
      login_url: LOGIN_URL,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`send-email failed: ${res.status} ${text}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (CRON_SECRET) {
    const auth = req.headers["authorization"] || "";
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }

  const baseUrl = baseUrlFromEnv();

  // Manual test hook: send one sample reminder to the given address and stop.
  const forceTest = String(req.query?.force_test || "").trim();
  if (forceTest) {
    try {
      await sendReminder(baseUrl, {
        to: forceTest,
        directorName: "בדיקה",
        title: "הפקת דוגמה",
        datesText: "08/06/2026 (09:00–17:00)<br/>09/06/2026 (09:00–14:00)",
      });
      return res.status(200).json({ ok: true, force_test: forceTest, sent: 1 });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  try {
    const [productions, dates, reservations] = await Promise.all([
      fetchJson("productions?select=id,title,director_email,director_name,status"),
      fetchJson("production_dates?select=id,production_id,start_date,end_date,start_time,end_time"),
      fetchJson("reservations_new?select=production_id,production_date_id,status&production_id=not.is.null"),
    ]);

    // Date IDs that already have a non-cancelled equipment-list reservation.
    const submittedDateIds = new Set();
    for (const r of (Array.isArray(reservations) ? reservations : [])) {
      if (r.status === "בוטל") continue;
      if (r.production_date_id) submittedDateIds.add(String(r.production_date_id));
    }

    // Group shoot dates by production.
    const datesByProduction = new Map();
    for (const d of (Array.isArray(dates) ? dates : [])) {
      const pid = String(d.production_id || "");
      if (!pid || !d.start_date) continue;
      if (!datesByProduction.has(pid)) datesByProduction.set(pid, []);
      datesByProduction.get(pid).push(d);
    }

    const today = todayInIsrael();
    let sent = 0;
    let considered = 0;

    for (const p of (Array.isArray(productions) ? productions : [])) {
      if (!p || p.status !== "published") continue;
      const email = String(p.director_email || "").trim();
      if (!email) continue;

      const pDates = datesByProduction.get(String(p.id)) || [];
      // Reminder fires for pending (not-yet-submitted) shoot dates that are
      // exactly one day before their submission deadline today.
      const matchingDates = pDates.filter((d) => {
        if (submittedDateIds.has(String(d.id))) return false;
        return shiftDate(d.start_date, REMINDER_DAYS_BEFORE_SHOOT) === today;
      });
      if (matchingDates.length === 0) continue;

      const datesText = matchingDates
        .slice()
        .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))
        .map(shootDateLine)
        .join("<br/>");

      considered++;
      try {
        await sendReminder(baseUrl, {
          to: email,
          directorName: p.director_name,
          title: p.title,
          datesText,
        });
        sent++;
        console.log(`production-deadline-reminder: emailed ${email} for production "${p.title}"`);
      } catch (err) {
        console.error(`production-deadline-reminder: error for production ${p.id}:`, err.message);
      }
    }

    return res.status(200).json({ ok: true, sent, considered, today_il: today });
  } catch (e) {
    console.error("production-deadline-reminder error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
