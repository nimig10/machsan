// calendar-sync.js — sync course sessions to lecturers' Google Calendars via
// emailed iCalendar (ICS) invites. Reconcile-based, decoupled from the client
// save path: given a lessonId (or all lessons), it derives the DESIRED events
// from the live `lessons` row and reconciles them against the
// `lesson_calendar_events` mapping table:
//   * new / changed (session × lecturer) -> METHOD:REQUEST (same UID, SEQ++),
//   * removed session / lecturer / whole course -> METHOD:CANCEL,
//   * unchanged -> nothing (idempotent).
//
// Because it reads desired state from the DB, deleting a course "just works":
// the row is gone -> zero desired events -> every active mapping row is cancelled.
//
// AUTH: staff JWT (requireStaff) for the client ping, OR the internal cron
// secret (X-Cron-Secret header, or `Authorization: Bearer {CRON_SECRET}`).
//
// PROTOCOL:
//   POST { lessonId }                  -> reconcile one course (client, on save/delete)
//   GET  ?force_test=<lessonId>        -> reconcile one course (manual test; cron secret)
//   GET  ?reconcile=all                -> reconcile every course + orphaned mappings
//
// NOTE: reconcile=all will email every lecturer their future sessions on first
// run (onboarding/backfill). It is intentionally NOT registered as an automatic
// cron in vercel.json — enable it deliberately when you want that blast.

import nodemailer from "nodemailer";
import crypto from "crypto";
import { requireStaff } from "./_auth-helper.js";
import { buildIcs } from "./_ics.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_PASS;
const CRON_SECRET = process.env.CRON_SECRET;

const ORG_NAME = "מכללת קמרה אובסקורה וסאונד";
// College physical location — appended to every event so Google Calendar can
// geocode it (the "מסלול"/directions button works) and the lecturer sees where
// to go. The floor goes in the description as a note.
const COLLEGE_ADDRESS = "רחוב ריבל 5, תל אביב";
const COLLEGE_FLOOR_NOTE = "בכניסה לבניין יורדים במדרגות לקומה מינוס 2";

const SERVICE_HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

let _transporter = null;
function transporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    });
  }
  return _transporter;
}

// ─── Supabase REST helpers (service role, PostgREST) ──────────────────────
async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SERVICE_HEADERS });
  if (!r.ok) {
    console.error("calendar-sync sbGet failed", path, r.status, await r.text());
    return null;
  }
  return r.json();
}

async function sbUpsert(path, rows) {
  if (!rows.length) return true;
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: { ...SERVICE_HEADERS, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!r.ok) console.error("calendar-sync sbUpsert failed", await r.text());
  return r.ok;
}

const enc = (v) => encodeURIComponent(String(v));

function todayInIsrael() {
  const fmt = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" });
  return fmt.slice(0, 10);
}

function sha1(str) {
  return crypto.createHash("sha1").update(String(str)).digest("hex");
}

// Deterministic UID — survives date/time edits so Google updates in place.
function uidFor(lessonId, sessionKey, lecturerId) {
  const clean = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, "_");
  return `machsan-${clean(lessonId)}-${clean(sessionKey)}-${clean(lecturerId)}@camera.org.il`;
}

// ─── Derivation (mirror of src/utils/lessonBookings.js, server-side) ──────
function idList(arr) {
  const out = [];
  const seen = new Set();
  for (const v of Array.isArray(arr) ? arr : []) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// session.lecturerIds[] (non-empty) -> session scalar -> course lecturer_id.
function effLecturerIds(s, row) {
  const sess = idList(s?.lecturerIds);
  if (sess.length) return sess;
  const legacy = s?.lecturerId || s?.alternateLecturerId;
  if (legacy != null && String(legacy).trim()) return [String(legacy).trim()];
  const course = row?.lecturer_id;
  return course != null && String(course).trim() ? [String(course).trim()] : [];
}

// explicit session.studioIds[] (even all-empty = "no room") -> scalar -> course.
function effStudioIds(s, row) {
  if (Array.isArray(s?.studioIds)) return idList(s.studioIds);
  const scalar = [];
  if (s?.studioId != null && String(s.studioId).trim()) scalar.push(s.studioId);
  if (s?.secondaryStudioId != null && String(s.secondaryStudioId).trim()) scalar.push(s.secondaryStudioId);
  const sc = idList(scalar);
  if (sc.length) return sc;
  const course = [];
  if (Array.isArray(row?.course_studios)) {
    for (const e of row.course_studios) {
      const v = e && typeof e === "object" ? e.studioId : e;
      if (v != null && String(v).trim()) course.push(v);
    }
  }
  if (row?.studio_id != null && String(row.studio_id).trim()) course.push(row.studio_id);
  return idList(course);
}

// ─── Context (loaded once, shared across lessons) ─────────────────────────
async function loadCtx() {
  const [lecRows, stuRows] = await Promise.all([
    sbGet("lecturers?select=id,full_name,email"),
    sbGet("studios?select=id,name"),
  ]);
  const lecturersById = new Map(
    (Array.isArray(lecRows) ? lecRows : []).map((r) => [
      String(r.id),
      { email: String(r.email || "").trim(), full_name: String(r.full_name || "").trim() },
    ]),
  );
  const studiosById = new Map(
    (Array.isArray(stuRows) ? stuRows : []).map((r) => [String(r.id), String(r.name || "").trim()]),
  );
  return { lecturersById, studiosById };
}

async function allLessonIds() {
  const [a, b] = await Promise.all([
    sbGet("lessons?select=id"),
    sbGet("lesson_calendar_events?select=lesson_id&status=eq.active"),
  ]);
  const ids = new Set();
  for (const r of Array.isArray(a) ? a : []) ids.add(String(r.id));
  for (const r of Array.isArray(b) ? b : []) ids.add(String(r.lesson_id));
  return [...ids];
}

// ─── Email ────────────────────────────────────────────────────────────────
function dateHe(d) {
  const [y, m, dd] = String(d || "").split("-");
  return y && m && dd ? `${dd}/${m}/${y}` : "";
}

// One email per lecturer carrying ALL their events for this course (a single
// VCALENDAR with multiple VEVENTs) — the lecturer gets a single message.
async function sendIcs(to, courseName, method, events) {
  const isCancel = method === "CANCEL";
  const safe = String(courseName || "").replace(/</g, "&lt;");
  const subject = isCancel ? `ביטול מפגשים – ${courseName}` : `מפגשי הקורס ליומן – ${courseName}`;
  const intro = isCancel
    ? "המפגשים הבאים בוטלו ולכן יוסרו מיומן גוגל שלך:"
    : "מצורפים מפגשי הקורס להוספה/עדכון ביומן גוגל שלך:";
  const rows = events.map((e) => {
    const loc = e.location ? ` · ${String(e.location).replace(/</g, "&lt;")}` : "";
    return `<li style="margin-bottom:4px">${dateHe(e.date)} · ${e.startTime}–${e.endTime}${loc}</li>`;
  }).join("");
  const html =
    `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;line-height:1.7;color:#1a1a1a">` +
    `<p>שלום,</p><p>${intro}</p>` +
    `<p><strong>קורס:</strong> ${safe}</p>` +
    `<ul style="padding-inline-start:18px">${rows}</ul>` +
    (isCancel ? "" : `<p>אשרו את ההזמנה כדי שהמפגשים יתווספו ליומן.</p>`) +
    `<p style="color:#666;font-size:13px">מכללת קמרה אובסקורה וסאונד</p></div>`;
  const ics = buildIcs(events, { method });
  try {
    await transporter().sendMail({
      from: `"${ORG_NAME}" <${GMAIL_USER}>`,
      to,
      subject,
      text: intro,
      html,
      icalEvent: { method, filename: "invite.ics", content: ics },
    });
    return true;
  } catch (e) {
    console.error("calendar-sync sendIcs failed", to, method, e.message);
    return false;
  }
}

// ─── Reconcile one lesson ──────────────────────────────────────────────────
async function reconcileLesson(lessonId, ctx) {
  const { lecturersById, studiosById } = ctx;
  const lessonRows = await sbGet(`lessons?id=eq.${enc(lessonId)}&select=*&limit=1`);
  const row = Array.isArray(lessonRows) && lessonRows[0] ? lessonRows[0] : null;
  const todayISO = todayInIsrael();

  const courseName = String(row?.name || "").trim();
  const track = String(row?.track || "").trim();
  const courseDesc = String(row?.description || "").trim();
  const courseLecNames = new Map();
  if (Array.isArray(row?.course_lecturers)) {
    for (const it of row.course_lecturers) {
      if (it?.lecturerId) courseLecNames.set(String(it.lecturerId), String(it.instructorName || "").trim());
    }
  }

  const allKeys = new Set();       // every (session × lecturer) that still exists (past+future)
  const futureByKey = new Map();   // future ones we actively manage (send REQUEST for)

  const schedule = Array.isArray(row?.schedule) ? row.schedule : [];
  for (const s of schedule) {
    const date = String(s?.date || "").trim();
    const sessionKey = String(s?._key || "").trim();
    if (!date || !sessionKey) continue;

    const lecIds = effLecturerIds(s, row);
    const studioIds = effStudioIds(s, row);
    // Location: room name(s) + college address so directions/geocoding work.
    const rooms = studioIds.map((id) => studiosById.get(String(id))).filter(Boolean).join(" · ");
    const location = rooms ? `${rooms} · ${COLLEGE_ADDRESS}` : COLLEGE_ADDRESS;
    const startTime = String(s?.startTime || "09:00");
    const endTime = String(s?.endTime || "12:00");
    const topic = String(s?.topic || "").trim();
    const summary = courseName ? (topic ? `${courseName} — ${topic}` : courseName) : (topic || "מפגש");
    const descParts = [];
    if (track) descParts.push(`מסלול: ${track}`);
    if (courseDesc) descParts.push(courseDesc);
    if (rooms) descParts.push(`חדר: ${rooms}`);
    descParts.push(COLLEGE_FLOOR_NOTE);
    const description = descParts.join("\n");

    for (const lid of lecIds) {
      const key = `${sessionKey}__${lid}`;
      allKeys.add(key);
      if (date < todayISO) continue; // manage future sessions only for REQUEST
      const lec = lecturersById.get(String(lid));
      const email = String(lec?.email || "").trim();
      if (!email) continue;
      const name = String(lec?.full_name || "").trim() || courseLecNames.get(String(lid)) || "";
      const hash = sha1([summary, location, description, date, startTime, endTime].join("|"));
      futureByKey.set(key, {
        sessionKey, lecturerId: lid, email, name, hash, date, startTime, endTime,
        uid: uidFor(lessonId, sessionKey, lid),
        event: { date, startTime, endTime, summary, description, location, attendeeEmail: email, attendeeName: name },
        summary,
      });
    }
  }

  const rows = await sbGet(`lesson_calendar_events?lesson_id=eq.${enc(lessonId)}&select=*`);
  const existing = Array.isArray(rows) ? rows : [];
  const existingByKey = new Map(existing.map((r) => [`${r.session_key}__${r.lecturer_id}`, r]));

  const requests = []; // { email, event, upsertRow }
  const cancels = [];  // { email, event, upsertRow }

  // Existing mapping rows: update / leave / cancel.
  for (const r of existing) {
    const key = `${r.session_key}__${r.lecturer_id}`;
    const want = futureByKey.get(key);
    if (want) {
      const changed = r.status !== "active" || r.last_hash !== want.hash;
      if (!changed) continue;
      const seq = (r.sequence || 0) + 1;
      const uid = r.uid || want.uid;
      requests.push({
        email: want.email,
        event: { ...want.event, uid, sequence: seq, organizerName: ORG_NAME, organizerEmail: GMAIL_USER },
        upsertRow: {
          lesson_id: lessonId, session_key: want.sessionKey, lecturer_id: want.lecturerId,
          lecturer_email: want.email, uid, sequence: seq, last_hash: want.hash, status: "active",
          event_date: want.date, start_time: want.startTime, end_time: want.endTime, summary: want.summary,
        },
      });
    } else if (allKeys.has(key)) {
      // Past session that still exists — leave untouched (do not cancel).
      continue;
    } else if (r.status === "active") {
      // Removed session / lecturer / course — cancel.
      const seq = (r.sequence || 0) + 1;
      cancels.push({
        email: r.lecturer_email,
        event: {
          uid: r.uid, sequence: seq, cancelled: true,
          date: r.event_date || "1970-01-01", startTime: r.start_time || "00:00", endTime: r.end_time || "00:00",
          summary: r.summary || "(בוטל)",
          organizerName: ORG_NAME, organizerEmail: GMAIL_USER, attendeeEmail: r.lecturer_email,
        },
        upsertRow: {
          lesson_id: lessonId, session_key: r.session_key, lecturer_id: r.lecturer_id,
          lecturer_email: r.lecturer_email, uid: r.uid, sequence: seq, last_hash: r.last_hash, status: "cancelled",
          event_date: r.event_date, start_time: r.start_time, end_time: r.end_time, summary: r.summary,
        },
      });
    }
  }

  // New future items with no mapping row yet.
  for (const [key, want] of futureByKey) {
    if (existingByKey.has(key)) continue;
    requests.push({
      email: want.email,
      event: { ...want.event, uid: want.uid, sequence: 0, organizerName: ORG_NAME, organizerEmail: GMAIL_USER },
      upsertRow: {
        lesson_id: lessonId, session_key: want.sessionKey, lecturer_id: want.lecturerId,
        lecturer_email: want.email, uid: want.uid, sequence: 0, last_hash: want.hash, status: "active",
        event_date: want.date, start_time: want.startTime, end_time: want.endTime, summary: want.summary,
      },
    });
  }

  // One email per lecturer: all their changed/new sessions in a single REQUEST
  // message, plus a single CANCEL message only if something was removed.
  const byEmail = new Map();
  for (const r of requests) {
    if (!byEmail.has(r.email)) byEmail.set(r.email, { req: [], can: [] });
    byEmail.get(r.email).req.push(r);
  }
  for (const c of cancels) {
    if (!byEmail.has(c.email)) byEmail.set(c.email, { req: [], can: [] });
    byEmail.get(c.email).can.push(c);
  }

  const toPersist = [];
  let emailed = 0;
  for (const [email, { req, can }] of byEmail) {
    let ok = true;
    if (req.length) {
      ok = (await sendIcs(email, courseName || "קורס", "REQUEST", req.map((r) => r.event))) && ok;
    }
    if (ok && can.length) {
      ok = (await sendIcs(email, courseName || "קורס", "CANCEL", can.map((c) => c.event))) && ok;
    }
    if (ok) {
      emailed++;
      for (const r of req) toPersist.push(r.upsertRow);
      for (const c of can) toPersist.push(c.upsertRow);
    }
  }

  if (toPersist.length) {
    await sbUpsert("lesson_calendar_events?on_conflict=lesson_id,session_key,lecturer_id", toPersist);
  }

  return { lessonId, requests: requests.length, cancels: cancels.length, emailed };
}

// ─── Handler ───────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const cronHeader = req.headers["x-cron-secret"];
  const authHeader = req.headers["authorization"] || "";
  const cronOk = !!CRON_SECRET && (cronHeader === CRON_SECRET || authHeader === `Bearer ${CRON_SECRET}`);
  if (!cronOk) {
    const staff = await requireStaff(req, res);
    if (!staff) return; // response already sent
  }

  if (!SB_URL || !SB_KEY) return res.status(500).json({ ok: false, error: "supabase env missing" });
  if (!GMAIL_USER || !GMAIL_PASS) return res.status(500).json({ ok: false, error: "gmail env missing" });

  try {
    const q = req.query || {};
    let lessonIds = [];

    if (req.method === "GET") {
      if (String(q.reconcile || "") === "all") {
        lessonIds = await allLessonIds();
      } else if (q.force_test) {
        lessonIds = [String(q.force_test)];
      } else {
        return res.status(400).json({ ok: false, error: "missing reconcile=all or force_test" });
      }
    } else if (req.method === "POST") {
      const body = req.body && typeof req.body === "object"
        ? req.body
        : (() => { try { return JSON.parse(req.body || "{}"); } catch { return {}; } })();
      if (!body.lessonId) return res.status(400).json({ ok: false, error: "missing lessonId" });
      lessonIds = [String(body.lessonId)];
    } else {
      return res.status(405).json({ ok: false, error: "method not allowed" });
    }

    const ctx = await loadCtx();
    const results = [];
    for (const id of lessonIds) results.push(await reconcileLesson(id, ctx));

    return res.status(200).json({ ok: true, lessons: results.length, results });
  } catch (e) {
    console.error("calendar-sync error", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
