// calendar-sync.js — keep each lecturer's Google Calendar in step with the
// courses they teach.
//
// TWO KINDS OF MESSAGE, and the distinction is the whole design:
//   * FIRST time we ever mail a lecturer about a course -> an INVITE carrying an
//     iCalendar file (METHOD:PUBLISH). One click on "Add to Calendar" drops all
//     their sessions in at once.
//   * EVERY time after that -> a plain-language CHANGE NOTICE spelling out what
//     was added / moved (before → after) / cancelled, which the lecturer applies
//     to their calendar by hand. Only NEWLY ADDED sessions ship a calendar file,
//     because those cannot collide with anything already in the calendar.
//
// Gmail will not update an event that was added via "Add to Calendar", so there
// is deliberately no attempt to push edits into the calendar automatically. That
// was tried (iMIP REQUEST + SEQUENCE) and does not work — see api/_ics.js.
//
// Reconcile-based and decoupled from the client save path: given a lessonId it
// derives the DESIRED sessions from the live `lessons` row and diffs them against
// the snapshot stored in `lesson_calendar_events` (which holds the date/time/room
// we last told this lecturer about — that is what makes "before → after"
// possible). Deleting a course therefore "just works": the row is gone, nothing
// is desired, every active mapping row reports as cancelled.
//
// State is written ONLY after a send succeeds, so a mail failure stays retryable
// instead of leaving a lecturer silently out of sync.
//
// AUTH: staff JWT (requireStaff) for the client ping, OR the internal cron
// secret (X-Cron-Secret header, or `Authorization: Bearer {CRON_SECRET}`).
//
// PROTOCOL:
//   POST { lessonId }                  -> reconcile one course (client, on save/delete)
//   GET  ?force_test=<lessonId>        -> reconcile one course (manual test; cron secret)
//   GET  ?reconcile=all                -> reconcile every course + orphaned mappings
//   GET  ?reconcile=all&dryrun=1       -> report drift, send nothing, persist nothing
//
// NOTE: `reconcile=all` WITHOUT dryrun will invite every lecturer in the college
// on first run. Only the dryrun variant is registered as a cron in vercel.json.

import crypto from "crypto";
import { requireStaff } from "./_auth-helper.js";
import { buildIcs } from "./_ics.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

// Official college address, and every character here is deliberate.
//
// The street name is an abbreviation and needs its gershayim — plain "ריבל"
// geocodes to the wrong place. But it MUST be the Hebrew gershayim U+05F4 (״),
// not an ASCII double quote: Google Calendar HTML-escapes a `"` when it stores
// the location, so the Directions button ends up searching the literal string
// `רחוב ריב&quot;ל 5` and finds nothing. Verified 2026-07-20 — our own ICS was
// byte-correct, the entity was introduced on Google's side.
const COLLEGE_ADDRESS = "רחוב ריב״ל 5, תל אביב";
const COLLEGE_FLOOR_NOTE = "בכניסה לבניין יורדים במדרגות לקומה מינוס 2";

const SERVICE_HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

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

const h = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// "20/07/2026 · 10:00–13:00 · DIGITAL MIX ROOM"
function slotText(e) {
  const room = e?.location ? ` · ${e.location}` : "";
  return `${dateHe(e?.date)} · ${e?.startTime}–${e?.endTime}${room}`;
}

const LINE = 'style="margin-bottom:6px;color:#e8eaf0;font-size:14px;line-height:1.8"';

function renderSessions(list) {
  return list.map((e) => `<div ${LINE}>${h(slotText(e))}</div>`).join("");
}

// Spell out what actually moved, so the lecturer can fix their calendar without
// cross-referencing anything. `before` comes from the stored snapshot.
function renderChanges({ added, changed, removed }) {
  const parts = [];
  if (added.length) {
    parts.push(
      `<div style="margin-bottom:10px"><div style="color:#4ade80;font-weight:700;margin-bottom:6px">➕ מפגשים שנוספו</div>` +
        renderSessions(added.map((c) => c.after)) +
        `</div>`,
    );
  }
  if (changed.length) {
    const rows = changed.map((c) => {
      const extra =
        c.before.location && c.after.location && c.before.location !== c.after.location
          ? `<div style="color:#9aa3b8;font-size:13px">החדר שונה: ${h(c.before.location)} ← ${h(c.after.location)}</div>`
          : "";
      return (
        `<div ${LINE}><span style="color:#9aa3b8">${h(slotText(c.before))}</span>` +
        `<br/><span style="color:#f5a623;font-weight:700">↓ ${h(slotText(c.after))}</span>${extra}</div>`
      );
    }).join("");
    parts.push(
      `<div style="margin-bottom:10px"><div style="color:#f5a623;font-weight:700;margin-bottom:6px">🔁 מפגשים שהשתנו</div>${rows}</div>`,
    );
  }
  if (removed.length) {
    parts.push(
      `<div style="margin-bottom:10px"><div style="color:#ef4444;font-weight:700;margin-bottom:6px">✖ מפגשים שבוטלו</div>` +
        removed.map((e) => `<div ${LINE}><s style="color:#9aa3b8">${h(slotText(e))}</s></div>`).join("") +
        `</div>`,
    );
  }
  return parts.join("");
}

// Where to reach /api/send-email from inside this function.
//
// The request's own headers come FIRST and deliberately so: they are present on
// every invocation including Vercel's cron, whereas the VERCEL_* env vars are
// not guaranteed in every execution context. Getting this wrong is invisible —
// the base URL silently falls back to localhost, every send fails in production,
// and because we only persist after a successful send, nothing is ever recorded.
function baseUrlFor(req) {
  const host = req?.headers?.["x-forwarded-host"] || req?.headers?.host;
  if (host) {
    const proto = req.headers["x-forwarded-proto"] || (String(host).startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:5174";
}

// Send through the shared /api/send-email so these messages get the same
// branded RTL chrome as every other email in the app (logo, dark card, footer)
// and there is only one nodemailer transport in the codebase. Same pattern as
// api/production-deadline-reminder.js.
async function sendCourseEmail({ baseUrl, to, recipientName, type, courseName, sessionsHtml, changesHtml, icsEvents, courseDeleted }) {
  const body = {
    to,
    recipient_name: recipientName || "",
    type,
    course_name: courseName || "קורס",
    sessions_html: sessionsHtml || "",
    changes_html: changesHtml || "",
    course_deleted: !!courseDeleted,
  };
  // PUBLISH, never REQUEST — see the contract note in api/_ics.js.
  if (icsEvents && icsEvents.length) {
    body.ics_base64 = Buffer.from(buildIcs(icsEvents, { method: "PUBLISH" }), "utf8").toString("base64");
    body.ics_method = "PUBLISH";
  }
  try {
    const r = await fetch(`${baseUrl}/api/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Cron-Secret": CRON_SECRET || "" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.error("calendar-sync sendCourseEmail failed", to, type, r.status, await r.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("calendar-sync sendCourseEmail threw", to, type, e.message);
    return false;
  }
}

// ─── Reconcile one lesson ──────────────────────────────────────────────────
async function reconcileLesson(lessonId, ctx, { dryRun = false } = {}) {
  const { lecturersById, studiosById, baseUrl } = ctx;
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
    // LOCATION is the college address and nothing else — Google geocodes this
    // field verbatim, so prefixing it with a room name ("DIGITAL MIX ROOM · …")
    // drops the pin somewhere wrong and the Directions button sends the lecturer
    // to the wrong place. The room is carried in DESCRIPTION instead.
    const location = COLLEGE_ADDRESS;
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
      // Future sessions only. A past session that still exists is left exactly
      // as-is: never re-sent, never reported as cancelled.
      if (date < todayISO) continue;
      const lec = lecturersById.get(String(lid));
      const email = String(lec?.email || "").trim();
      if (!email) continue;
      const name = String(lec?.full_name || "").trim() || courseLecNames.get(String(lid)) || "";
      const hash = sha1([summary, location, description, date, startTime, endTime].join("|"));
      futureByKey.set(key, {
        sessionKey, lecturerId: lid, email, name, hash,
        date, startTime, endTime, summary, description, location,
        uid: uidFor(lessonId, sessionKey, lid),
        event: { uid: uidFor(lessonId, sessionKey, lid), date, startTime, endTime, summary, description, location },
      });
    }
  }

  const rows = await sbGet(`lesson_calendar_events?lesson_id=eq.${enc(lessonId)}&select=*`);
  const existing = Array.isArray(rows) ? rows : [];
  const existingByKey = new Map(existing.map((r) => [`${r.session_key}__${r.lecturer_id}`, r]));

  // ── Delta, computed per lecturer ────────────────────────────────────────
  // The stored row IS the "before": it holds the snapshot we last told this
  // lecturer about (date/time/room/summary). Comparing it to the live schedule
  // is what lets the change email say "the 20/07 session moved to 25/07"
  // instead of just re-sending everything.
  const byLecturer = new Map();
  const lecturerOf = (id, email, name) => {
    const k = String(id);
    if (!byLecturer.has(k)) {
      byLecturer.set(k, { lecturerId: k, email, name: "", firstSync: true, added: [], changed: [], removed: [] });
    }
    const e = byLecturer.get(k);
    if (!e.email && email) e.email = email;
    // Name is only for the greeting, so any source will do — but it must be
    // resolved even for a deleted course, where the live lessons row is gone
    // and the only survivor is the lecturers table.
    if (!e.name) {
      e.name = String(name || "").trim()
        || String(lecturersById.get(k)?.full_name || "").trim()
        || courseLecNames.get(k)
        || "";
    }
    return e;
  };

  const snapOf = (r) => ({
    date: r.event_date, startTime: r.start_time, endTime: r.end_time,
    summary: r.summary, location: r.location,
  });

  for (const r of existing) {
    const ent = lecturerOf(r.lecturer_id, r.lecturer_email);
    ent.firstSync = false; // this lecturer has been told about this course before
    const key = `${r.session_key}__${r.lecturer_id}`;
    const want = futureByKey.get(key);
    if (want) {
      if (r.status === "active" && r.last_hash === want.hash) continue; // unchanged
      ent.changed.push({ key, before: snapOf(r), after: want, row: r });
    } else if (allKeys.has(key)) {
      continue; // past session that still exists — untouched
    } else if (r.status === "active") {
      ent.removed.push({ key, snap: snapOf(r), row: r });
    }
  }

  for (const [key, want] of futureByKey) {
    if (existingByKey.has(key)) continue;
    lecturerOf(want.lecturerId, want.email, want.name).added.push({ key, after: want });
  }

  const courseDeleted = !row;
  const toPersist = [];
  let emailed = 0;
  let invites = 0;
  let notices = 0;

  for (const ent of byLecturer.values()) {
    const { added, changed, removed, email, name } = ent;
    if (!email) continue;
    if (!added.length && !changed.length && !removed.length) continue; // idempotent

    // A lecturer we have never emailed about this course gets the invite, even
    // if some of their sessions were also edited in the same save — they have
    // nothing in their calendar yet, so "what changed" would be meaningless.
    const isInvite = ent.firstSync && !changed.length && !removed.length;

    // Drift report: compute the delta, send nothing, persist nothing.
    if (dryRun) {
      if (isInvite) invites++; else notices++;
      continue;
    }

    let ok;
    if (isInvite) {
      const events = added.map((a) => a.after.event);
      ok = await sendCourseEmail({
        baseUrl,
        to: email,
        recipientName: name,
        type: "course_calendar_invite",
        courseName,
        sessionsHtml: renderSessions(added.map((a) => a.after)),
        icsEvents: events,
      });
      if (ok) invites++;
    } else {
      ok = await sendCourseEmail({
        baseUrl,
        to: email,
        recipientName: name,
        type: "course_sessions_changed",
        courseName: courseName || String(existing[0]?.summary || "קורס"),
        changesHtml: renderChanges({
          added: added,
          changed: changed,
          removed: removed.map((r) => r.snap),
        }),
        // Only NEW sessions carry a calendar file. Moved/cancelled ones are
        // described in words and fixed by hand — Gmail will not update an event
        // that was added via "Add to Calendar", and re-sending it would just
        // create a duplicate.
        icsEvents: added.map((a) => a.after.event),
        courseDeleted,
      });
      if (ok) notices++;
    }

    // Persist only after a successful send, so a mail failure stays retryable
    // and never leaves the lecturer silently out of sync.
    if (!ok) continue;
    emailed++;
    for (const a of added) {
      const w = a.after;
      toPersist.push({
        lesson_id: lessonId, session_key: w.sessionKey, lecturer_id: w.lecturerId,
        lecturer_email: w.email, uid: w.uid, sequence: 0, last_hash: w.hash, status: "active",
        event_date: w.date, start_time: w.startTime, end_time: w.endTime,
        summary: w.summary, location: w.location,
      });
    }
    for (const c of changed) {
      const w = c.after;
      toPersist.push({
        lesson_id: lessonId, session_key: w.sessionKey, lecturer_id: w.lecturerId,
        lecturer_email: w.email, uid: c.row.uid || w.uid, sequence: c.row.sequence || 0,
        last_hash: w.hash, status: "active",
        event_date: w.date, start_time: w.startTime, end_time: w.endTime,
        summary: w.summary, location: w.location,
      });
    }
    for (const rm of removed) {
      const r = rm.row;
      toPersist.push({
        lesson_id: lessonId, session_key: r.session_key, lecturer_id: r.lecturer_id,
        lecturer_email: r.lecturer_email, uid: r.uid, sequence: r.sequence || 0,
        last_hash: r.last_hash, status: "cancelled",
        event_date: r.event_date, start_time: r.start_time, end_time: r.end_time,
        summary: r.summary, location: r.location,
      });
    }
  }

  if (toPersist.length) {
    await sbUpsert("lesson_calendar_events?on_conflict=lesson_id,session_key,lecturer_id", toPersist);
  }

  const totals = [...byLecturer.values()].reduce(
    (a, e) => ({
      added: a.added + e.added.length,
      changed: a.changed + e.changed.length,
      removed: a.removed + e.removed.length,
    }),
    { added: 0, changed: 0, removed: 0 },
  );
  return { lessonId, ...totals, invites, notices, emailed };
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
  // Mail goes out through /api/send-email, which is authenticated with the same
  // shared secret — without it every send would 401 and nothing would persist.
  if (!CRON_SECRET) return res.status(500).json({ ok: false, error: "CRON_SECRET missing" });

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

    // ?dryrun=1 reports drift without sending or persisting anything. This is
    // the variant registered as a cron — `reconcile=all` on its own would mail
    // every lecturer in the college on first run.
    const dryRun = String(q.dryrun || "") === "1" || String(q.dryrun || "") === "true";

    const ctx = await loadCtx();
    ctx.baseUrl = baseUrlFor(req);
    const results = [];
    for (const id of lessonIds) results.push(await reconcileLesson(id, ctx, { dryRun }));

    const drifted = results.filter((r) => r.added || r.changed || r.removed);
    return res.status(200).json({
      ok: true,
      dry_run: dryRun,
      lessons: results.length,
      drifted: drifted.length,
      results: dryRun ? drifted : results,
    });
  } catch (e) {
    console.error("calendar-sync error", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
