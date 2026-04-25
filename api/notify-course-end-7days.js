// notify-course-end-7days.js — daily cron: 7-day course-ending reminder.
//
// PURPOSE:
//   Seven days before a course's last meeting, email the assigned lecturer
//   and remind them to mark each track-student's status (סיים / לא סיים)
//   in the lecturer portal. Without this status the admin cannot generate
//   end-of-course certificates (LessonsPage.jsx — "צור תעודות" button is
//   disabled until lesson.studentStatuses is fully populated).
//
// SCHEDULE:
//   Configured in vercel.json. Runs once per day at 09:00 UTC (≈ 11:00–12:00
//   Israel local depending on DST). The handler is idempotent per-lesson via
//   `lesson.lecturerNotifiedAt7d` — only the first run of the matching day
//   actually sends.
//
// SECURITY:
//   Vercel sets `Authorization: Bearer {CRON_SECRET}` on cron invocations.
//   Other callers are rejected with 401.
//
// PROTOCOL:
//   GET /api/notify-course-end-7days
//   200: { ok, sent, considered, today_il }
//   401: missing / wrong bearer token
//   5xx: store / SMTP error

const SB_URL  = process.env.SUPABASE_URL;
const SB_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const SERVICE_HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

async function readStoreKey(key) {
  const r = await fetch(
    `${SB_URL}/rest/v1/store?key=eq.${encodeURIComponent(key)}&select=data&limit=1`,
    { headers: SERVICE_HEADERS }
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return rows?.[0]?.data ?? null;
}

async function writeStoreKey(key, data) {
  return fetch(`${SB_URL}/rest/v1/store`, {
    method: "POST",
    headers: { ...SERVICE_HEADERS, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ key, data, updated_at: new Date().toISOString() }),
  });
}

// Today's date in Israel timezone, formatted YYYY-MM-DD.
function todayInIsrael() {
  // sv-SE locale formats as "YYYY-MM-DD HH:mm:ss" — slice the date portion.
  const fmt = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" });
  return fmt.slice(0, 10);
}

// Returns YYYY-MM-DD that is `daysBefore` calendar days before `isoDate`.
function shiftDate(isoDate, daysBefore) {
  const [y, m, d] = String(isoDate).split("-").map(Number);
  if (!y || !m || !d) return "";
  // Use UTC math to avoid local-DST off-by-one. We're only computing a
  // calendar-day offset, no need to be timezone-aware here.
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
  const [y, m, d] = String(isoDate).split("-").map(Number);
  if (!y || !m || !d) return "";
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function lastMeetingDate(lesson) {
  const sched = Array.isArray(lesson?.schedule) ? lesson.schedule : [];
  const dates = sched
    .map((s) => (typeof s?.date === "string" ? s.date : ""))
    .filter(Boolean)
    .sort();
  return dates[dates.length - 1] || "";
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

  try {
    const [lessons, lecturers, siteSettings] = await Promise.all([
      readStoreKey("lessons"),
      readStoreKey("lecturers"),
      readStoreKey("siteSettings"),
    ]);

    if (!Array.isArray(lessons) || !Array.isArray(lecturers)) {
      return res.status(503).json({ ok: false, error: "Could not load store" });
    }

    const today = todayInIsrael();
    const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    const portalUrl = (siteSettings && siteSettings.publicUrl)
      ? `${String(siteSettings.publicUrl).replace(/\/+$/, "")}/lecturer`
      : "https://app.camera.org.il/lecturer";

    let sent = 0;
    let considered = 0;
    const updatedLessons = [...lessons];
    let mutated = false;

    for (let i = 0; i < updatedLessons.length; i++) {
      const lesson = updatedLessons[i];
      if (!lesson || lesson.lecturerNotifiedAt7d) continue;

      const lastDate = lastMeetingDate(lesson);
      if (!lastDate) continue;

      const triggerDate = shiftDate(lastDate, 7);
      considered++;

      // Match exact day. If the cron is missed (Vercel issue), this lesson
      // simply won't be re-attempted — acceptable for a "soft" reminder.
      if (today !== triggerDate) continue;

      const lecturer = lecturers.find((l) => String(l?.id || "") === String(lesson.lecturerId || ""));
      const email = String(lecturer?.email || lesson?.instructorEmail || "").trim();
      if (!email) {
        console.log(`notify-course-end-7days: lesson ${lesson.id} has no lecturer email — skipped`);
        continue;
      }

      try {
        const emailRes = await fetch(`${baseUrl}/api/send-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // send-email recognises X-Cron-Secret as an internal-trust signal
            // so this staff-initiated `course_end_notice` type is allowed
            // without a Supabase JWT.
            "X-Cron-Secret": process.env.CRON_SECRET || "",
          },
          body: JSON.stringify({
            to: email,
            type: "course_end_notice",
            recipient_name: lecturer?.fullName || lesson?.instructorName || "המרצה",
            student_name: lecturer?.fullName || lesson?.instructorName || "המרצה",
            project_name: lesson?.name || "",
            lesson_kit_name: lesson?.name || "",
            return_date: formatDateHe(lastDate),
            portal_url: portalUrl,
            logo_url: siteSettings?.logo || "",
            sound_logo_url: siteSettings?.soundLogo || "",
          }),
        });

        if (!emailRes.ok) {
          const text = await emailRes.text();
          console.error(`notify-course-end-7days: send-email failed for lesson ${lesson.id}:`, emailRes.status, text);
          continue;
        }

        // Mark sent so we don't email twice. We update the local copy and
        // flush to the store at the very end (single write).
        updatedLessons[i] = { ...lesson, lecturerNotifiedAt7d: new Date().toISOString() };
        mutated = true;
        sent++;
        console.log(`notify-course-end-7days: emailed ${email} for lesson "${lesson.name}" (ends ${lastDate})`);
      } catch (err) {
        console.error(`notify-course-end-7days: error for lesson ${lesson.id}:`, err.message);
      }
    }

    if (mutated) {
      const writeRes = await writeStoreKey("lessons", updatedLessons);
      if (!writeRes.ok) {
        const text = await writeRes.text();
        console.error("notify-course-end-7days: lessons write-back failed:", writeRes.status, text);
        return res.status(500).json({ ok: false, error: "store_write_failed", sent, considered });
      }
    }

    return res.status(200).json({ ok: true, sent, considered, today_il: today });
  } catch (e) {
    console.error("notify-course-end-7days error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
