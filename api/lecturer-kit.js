// lecturer-kit.js — dedicated endpoint for lecturers to save a lesson kit + link it to a lesson.
// Requires authenticated user whose email matches a lecturer in the store.
// Writes to kits and lessons using service_role (bypasses RLS + staff gate).

import { requireUser } from "./_auth-helper.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SERVICE_HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "resolution=merge-duplicates",
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
  const r = await fetch(`${SB_URL}/rest/v1/store`, {
    method: "POST",
    headers: SERVICE_HEADERS,
    body: JSON.stringify({ key, data, updated_at: new Date().toISOString() }),
  });
  return r;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const user = await requireUser(req, res);
  if (!user) return;

  const { kit, lessonId, sessionUid, kitType } = req.body || {};
  if (!kit || !lessonId) return res.status(400).json({ error: "Missing kit or lessonId" });

  // Verify the caller is a known lecturer (email match in store)
  const lecturers = await readStoreKey("lecturers");
  if (!Array.isArray(lecturers)) return res.status(503).json({ error: "Could not load lecturers" });

  const normalize = (s) => String(s || "").trim().toLowerCase();
  const isKnownLecturer = lecturers.some((l) => normalize(l.email) === normalize(user.email));
  if (!isKnownLecturer) return res.status(403).json({ error: "Forbidden: not a lecturer" });

  // Load current kits + lessons
  const [kits, lessons] = await Promise.all([readStoreKey("kits"), readStoreKey("lessons")]);
  if (!Array.isArray(kits)) return res.status(503).json({ error: "Could not load kits" });
  if (!Array.isArray(lessons)) return res.status(503).json({ error: "Could not load lessons" });

  const kitId = String(kit.id);
  const existingKit = kits.find((k) => String(k.id) === kitId);
  const nextKits = existingKit
    ? kits.map((k) => (String(k.id) === kitId ? kit : k))
    : [...kits, kit];

  // Must match LecturerPortal.jsx getSessionUid()
  function getSessionUid(session, index) {
    return String(
      session?._key ||
      `${session?.date || ""}__${session?.startTime || ""}__${session?.endTime || ""}__${session?.topic || ""}__${index}`
    );
  }

  const nextLessons = lessons.map((lesson) => {
    if (String(lesson.id) !== String(lessonId)) return lesson;
    if (kitType === "course") {
      return { ...lesson, kitId };
    }
    return {
      ...lesson,
      schedule: (lesson.schedule || []).map((session, index) =>
        getSessionUid(session, index) === sessionUid ? { ...session, kitId } : session
      ),
    };
  });

  // Write kits first
  const kitsRes = await writeStoreKey("kits", nextKits);
  if (!kitsRes.ok) {
    const text = await kitsRes.text();
    return res.status(kitsRes.status).json({ error: "Failed to save kit", detail: text });
  }

  // Write lessons
  const lessonsRes = await writeStoreKey("lessons", nextLessons);
  if (!lessonsRes.ok) {
    // Roll back kits
    await writeStoreKey("kits", kits);
    const text = await lessonsRes.text();
    return res.status(lessonsRes.status).json({ error: "Failed to link lesson, kit rolled back", detail: text });
  }

  return res.status(200).json({ ok: true });
}
