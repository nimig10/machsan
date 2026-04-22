// lecturer-kit.js — dedicated endpoint for lecturers to save lesson loans.
//
// Session type: creates a kit in the kits store + links it to the session.
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

  // Verify the caller is a known lecturer (email match in store)
  const lecturers = await readStoreKey("lecturers");
  if (!Array.isArray(lecturers)) return res.status(503).json({ error: "Could not load lecturers" });

  const normalize = (s) => String(s || "").trim().toLowerCase();
  const isKnownLecturer = lecturers.some((l) => normalize(l.email) === normalize(user.email));
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
        notes: description || "",
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

  // ── Session type: create/update kit + link to lesson ──
  const { kit, sessionUid } = req.body;
  if (!kit) return res.status(400).json({ error: "Missing kit" });

  const [kits, lessons] = await Promise.all([readStoreKey("kits"), readStoreKey("lessons")]);
  if (!Array.isArray(kits)) return res.status(503).json({ error: "Could not load kits" });
  if (!Array.isArray(lessons)) return res.status(503).json({ error: "Could not load lessons" });

  const kitId = String(kit.id);
  const existingKit = kits.find((k) => String(k.id) === kitId);
  const nextKits = existingKit
    ? kits.map((k) => (String(k.id) === kitId ? kit : k))
    : [...kits, kit];

  const nextLessons = lessons.map((lesson) => {
    if (String(lesson.id) !== String(lessonId)) return lesson;
    return {
      ...lesson,
      schedule: (lesson.schedule || []).map((session, index) =>
        getSessionUid(session, index) === sessionUid ? { ...session, kitId } : session
      ),
    };
  });

  const kitsRes = await writeStoreKey("kits", nextKits);
  if (!kitsRes.ok) {
    const text = await kitsRes.text();
    return res.status(kitsRes.status).json({ error: "Failed to save kit", detail: text });
  }

  const lessonsRes = await writeStoreKey("lessons", nextLessons);
  if (!lessonsRes.ok) {
    await writeStoreKey("kits", kits);
    const text = await lessonsRes.text();
    return res.status(lessonsRes.status).json({ error: "Failed to link lesson, kit rolled back", detail: text });
  }

  return res.status(200).json({ ok: true });
}
