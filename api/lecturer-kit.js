// lecturer-kit.js — dedicated endpoint for lecturers to save lesson loans.
//
// Session type: creates a single reservation_items row for the session.
//               Lecturers do NOT create or modify kits — kits are managed by
//               warehouse staff in the "ערכות" admin tab. Re-saving overwrites
//               the previous reservation for the same session (delete + create).
// Course type:  creates individual reservation_items per session (no kit created).
//
// Requires authenticated user whose email matches a lecturer in the store.

import { requireUser } from "./_auth-helper.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SERVICE_HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "resolution=merge-duplicates",
};

const RPC_HEADERS = {
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

// Stage 7 step 4: verify caller email against the normalized lecturers table.
// Replaces the previous full-blob read for the lecturer-eligibility check;
// case-insensitive match against the lecturers_email_lower_idx UNIQUE index.
async function isKnownLecturerEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return false;
  const r = await fetch(
    `${SB_URL}/rest/v1/lecturers?select=id&email=ilike.${encodeURIComponent(normalized)}&limit=1`,
    { headers: SERVICE_HEADERS }
  );
  if (!r.ok) return false;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function writeStoreKey(key, data) {
  return fetch(`${SB_URL}/rest/v1/store`, {
    method: "POST",
    headers: SERVICE_HEADERS,
    body: JSON.stringify({ key, data, updated_at: new Date().toISOString() }),
  });
}

async function createReservation(reservation, items) {
  return fetch(`${SB_URL}/rest/v1/rpc/create_reservation_v2`, {
    method: "POST",
    headers: RPC_HEADERS,
    body: JSON.stringify({ p_reservation: reservation, p_items: items }),
  });
}

// Must match LecturerPortal.jsx getSessionUid()
function getSessionUid(session, index) {
  return String(
    session?._key ||
    `${session?.date || ""}__${session?.startTime || ""}__${session?.endTime || ""}__${session?.topic || ""}__${index}`
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const user = await requireUser(req, res);
  if (!user) return;

  const { kitType, lessonId } = req.body || {};
  if (!lessonId) return res.status(400).json({ error: "Missing lessonId" });

  // Stage 7 step 4: verify the caller against the normalized lecturers table
  // (was: full blob read + email scan). Same semantics, single index lookup.
  const isKnownLecturer = await isKnownLecturerEmail(user.email);
  if (!isKnownLecturer) return res.status(403).json({ error: "Forbidden: not a lecturer" });

  // ── Course type: create individual reservations per session ──
  if (kitType === "course") {
    const { allSessions, items, reservationName, description, lecturer } = req.body;
    if (!Array.isArray(allSessions) || allSessions.length === 0)
      return res.status(400).json({ error: "Missing allSessions" });
    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: "Missing items" });

    const ids = [];
    for (const session of allSessions) {
      if (!session.date) continue;
      const reservationId = String(Date.now()) + "_" + Math.random().toString(36).slice(2, 7);
      // Lesson loans are pre-scheduled by the school calendar — they never sit in
      // a manual "ממתין" state. Status auto-flows: מאושר while current, הוחזר once
      // the session's return time has passed (see normalizeReservationsForArchive).
      const returnTs = new Date(`${session.date}T${session.endTime || "23:59"}:00`).getTime();
      const isPast = Number.isFinite(returnTs) && Date.now() >= returnTs;
      const reservation = {
        id: reservationId,
        loan_type: "שיעור",
        booking_kind: "lesson",
        student_name: lecturer?.name || "",
        email: lecturer?.email || "",
        phone: lecturer?.phone || "",
        course: lecturer?.course || "",
        lecturer_notes: description || "",
        borrow_date: session.date,
        borrow_time: session.startTime || "00:00",
        return_date: session.date,
        return_time: session.endTime || "23:59",
        status: isPast ? "הוחזר" : "מאושר",
        returned_at: isPast ? new Date(returnTs).toISOString() : null,
        lesson_id: String(lessonId),
        lesson_auto: false,
        overdue_notified: true,
      };

      const r = await createReservation(reservation, items);
      if (!r.ok) {
        const text = await r.text();
        const isStock = /not enough units/i.test(text);
        return res.status(isStock ? 409 : r.status).json({
          error: isStock ? "not_enough_stock" : "rpc_error",
          detail: text,
          session: session.date,
        });
      }
      const newId = await r.json();
      ids.push(newId);
    }
    return res.status(200).json({ ok: true, created: ids.length, ids });
  }

  // ── Session type: create a single reservation, no kit ──
  // Lecturer flow: each meeting reservation is one reservation_items row keyed
  // by (lesson_id, borrow_date, lesson_auto=false). Re-saving deletes the
  // previous reservation for the same session before creating a new one so
  // there's never a stale duplicate.
  const { session, items, description, lecturer } = req.body;
  if (!session?.date) return res.status(400).json({ error: "Missing session.date" });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Missing items" });
  }

  // Find any existing non-auto reservation for this session date (replace, not append).
  try {
    const existingRes = await fetch(
      `${SB_URL}/rest/v1/reservations_new?lesson_id=eq.${encodeURIComponent(String(lessonId))}&borrow_date=eq.${encodeURIComponent(session.date)}&lesson_auto=eq.false&select=id`,
      { headers: SERVICE_HEADERS },
    );
    if (existingRes.ok) {
      const existingRows = await existingRes.json();
      if (Array.isArray(existingRows)) {
        for (const row of existingRows) {
          await fetch(`${SB_URL}/rest/v1/rpc/delete_reservation_v1`, {
            method: "POST",
            headers: RPC_HEADERS,
            body: JSON.stringify({ p_reservation_id: String(row.id) }),
          }).catch(() => {});
        }
      }
    }
  } catch {
    // Best-effort cleanup; if it fails we still attempt to create the new row.
  }

  const reservationId = String(Date.now()) + "_" + Math.random().toString(36).slice(2, 7);
  const returnTs = new Date(`${session.date}T${session.endTime || "23:59"}:00`).getTime();
  const isPast = Number.isFinite(returnTs) && Date.now() >= returnTs;
  const reservation = {
    id: reservationId,
    loan_type: "שיעור",
    booking_kind: "lesson",
    student_name: lecturer?.name || "",
    email: lecturer?.email || "",
    phone: lecturer?.phone || "",
    course: lecturer?.course || "",
    lecturer_notes: description || "",
    borrow_date: session.date,
    borrow_time: session.startTime || "00:00",
    return_date: session.date,
    return_time: session.endTime || "23:59",
    status: isPast ? "הוחזר" : "מאושר",
    returned_at: isPast ? new Date(returnTs).toISOString() : null,
    lesson_id: String(lessonId),
    lesson_auto: false,
    overdue_notified: true,
  };

  const createRes = await createReservation(reservation, items);
  if (!createRes.ok) {
    const text = await createRes.text();
    const isStock = /not enough units/i.test(text);
    return res.status(isStock ? 409 : createRes.status).json({
      error: isStock ? "not_enough_stock" : "rpc_error",
      detail: text,
    });
  }

  return res.status(200).json({ ok: true, reservationId });
}
