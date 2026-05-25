// lessonsApi.js — normalized read/write path for the public.lessons table.
// All reads and writes go through this module; the store.lessons blob was
// removed in Stage 8 Session C.
//
// Returns rows in the SAME shape as the legacy blob:
//   {
//     id, name, track, lecturerId,
//     instructorName, instructorPhone, instructorEmail,
//     description, studioId, certificateTemplateType,
//     lecturerNotifiedAt7d,
//     schedule: [...],
//     studentStatuses: { [studentId]: "עבר" | "לא עבר" | "" },
//     created_at, updated_at
//   }
// so that future consumers can be migrated one-by-one without changing call
// sites. Mirror of src/utils/lecturersApi.js — keep them structurally aligned.

import { supabase } from "../supabaseClient.js";

// ─── Shape mapping (DB row ↔ blob entry) ──────────────────────────────────

function normalizeSessionStudioIds(session = {}) {
  // Position-preserving: keep empty slots as "" so column N stays at index N
  // when the lesson reloads. Legacy entries fall back to a packed list.
  if (Array.isArray(session.studioIds)) {
    return session.studioIds.map(v => (v === null || v === undefined) ? "" : String(v).trim());
  }
  const out = [];
  if (session.studioId) out.push(String(session.studioId).trim());
  if (session.secondaryStudioId && String(session.secondaryStudioId) !== String(session.studioId || "")) {
    out.push(String(session.secondaryStudioId).trim());
  }
  return out;
}

function buildCourseStudiosFromLesson(rawLesson) {
  const out = [];
  const seen = new Set();
  const push = (value) => {
    if (value === null || value === undefined) return;
    const key = String(value).trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ studioId: key });
  };
  if (Array.isArray(rawLesson?.studios)) {
    for (const entry of rawLesson.studios) push(entry?.studioId ?? entry);
  }
  push(rawLesson?.studio_id);
  if (Array.isArray(rawLesson?.schedule)) {
    for (const s of rawLesson.schedule) {
      normalizeSessionStudioIds(s).forEach(push);
    }
  }
  return out;
}

function rowToBlob(r) {
  if (!r) return null;
  const rawSchedule = Array.isArray(r.schedule) ? r.schedule : [];
  // Normalize legacy schedule entries (studioId+secondaryStudioId) into studioIds[]
  // so every consumer sees the new shape regardless of when the row was written.
  const schedule = rawSchedule.map(s => ({
    ...s,
    studioIds: normalizeSessionStudioIds(s),
  }));
  return {
    id:                       r.id,
    name:                     r.name ?? "",
    track:                    r.track ?? "",
    lecturerId:               r.lecturer_id ?? null,
    instructorName:           r.instructor_name ?? "",
    instructorPhone:          r.instructor_phone ?? "",
    instructorEmail:          r.instructor_email ?? "",
    description:              r.description ?? "",
    studioId:                 r.studio_id ?? null,
    studios:                  buildCourseStudiosFromLesson({ ...r, schedule }),
    certificateTemplateType:  r.certificate_template_type ?? "",
    lecturerNotifiedAt7d:     r.lecturer_notified_at_7d ?? null,
    schedule,
    studentStatuses:          (r.student_statuses && typeof r.student_statuses === "object" && !Array.isArray(r.student_statuses))
                                ? r.student_statuses : {},
    created_at:               r.created_at,
    updated_at:               r.updated_at,
  };
}

function blobToRow(l) {
  if (!l?.id) return null;
  const name = String(l.name || "").trim();
  // Normalize each schedule entry to write `studioIds` (array) and drop the
  // legacy `studioId` / `secondaryStudioId` fields so the JSONB stays clean.
  const schedule = (Array.isArray(l.schedule) ? l.schedule : []).map((s) => {
    const studioIds = normalizeSessionStudioIds(s);
    const { studioId: _legacyPrimary, secondaryStudioId: _legacySecondary, ...rest } = s || {};
    return { ...rest, studioIds };
  });
  // Course-level `studio_id` column persists the primary studio (first in the
  // course studios list, with fallback to the blob's studioId). Used by the
  // legacy column on `lessons` table — full array lives inside schedule JSONB.
  const coursePrimary = Array.isArray(l.studios) && l.studios[0]?.studioId
    ? l.studios[0].studioId
    : (l.studioId || null);
  return {
    id:                         l.id,
    name:                       name || "(ללא שם)",   // NOT NULL — never empty
    track:                      l.track || null,
    lecturer_id:                l.lecturerId || null,
    instructor_name:            l.instructorName || null,
    instructor_phone:           l.instructorPhone || null,
    instructor_email:           l.instructorEmail || null,
    description:                l.description || null,
    studio_id:                  coursePrimary,
    certificate_template_type:  l.certificateTemplateType || null,
    lecturer_notified_at_7d:    l.lecturerNotifiedAt7d || null,
    schedule,
    student_statuses:           (l.studentStatuses && typeof l.studentStatuses === "object" && !Array.isArray(l.studentStatuses))
                                  ? l.studentStatuses : {},
  };
}

// ─── Read path ────────────────────────────────────────────────────────────

export async function listLessons() {
  const { data, error } = await supabase
    .from("lessons")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[lessonsApi.listLessons]", error);
    return [];
  }
  return (data ?? []).map(rowToBlob);
}

export async function getLesson(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from("lessons")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn("[lessonsApi.getLesson]", id, error);
    return null;
  }
  return rowToBlob(data);
}

// ─── Write path ───────────────────────────────────────────────────────────

export async function upsertLesson(blob) {
  const row = blobToRow(blob);
  if (!row) return { ok: false, error: "missing id" };
  try {
    const { error } = await supabase
      .from("lessons")
      .upsert(row, { onConflict: "id" });
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.warn("[lessonsApi.upsertLesson]", blob?.id, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

// Alias used at write call sites for readability — semantically identical to
// upsertLesson but communicates intent ("we're mirroring the blob write").
export const dualWriteLesson = upsertLesson;

export async function deleteLesson(id) {
  if (!id) return { ok: false, error: "missing id" };
  try {
    const { error } = await supabase.from("lessons").delete().eq("id", id);
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.warn("[lessonsApi.deleteLesson]", id, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

// Full reconciliation: upsert every entry in nextLessons and delete any
// IDs in the table that aren't in the new list. Used for one-shot backfill
// AND for bulk paths (XL import, sync). Parallelized.
export async function syncAllLessons(nextLessons) {
  if (!Array.isArray(nextLessons)) {
    return { ok: false, error: "not an array" };
  }
  try {
    let rows = nextLessons.map(blobToRow).filter(Boolean);

    // Guard against dangling lecturer_id (blob may reference lecturers
    // that no longer exist in public.lecturers). FK is ON DELETE SET NULL
    // by design, so we just null-out the unknown ones rather than fail
    // the whole batch. Same policy as syncCertificationTypes drift handling.
    const candidateLecIds = [...new Set(rows.map(r => r.lecturer_id).filter(Boolean))];
    if (candidateLecIds.length > 0) {
      const { data: validLecs, error: lecErr } = await supabase
        .from("lecturers")
        .select("id")
        .in("id", candidateLecIds);
      if (lecErr) throw lecErr;
      const validLecSet = new Set((validLecs || []).map(r => r.id));
      rows = rows.map(r => ({
        ...r,
        lecturer_id: r.lecturer_id && validLecSet.has(r.lecturer_id) ? r.lecturer_id : null,
      }));
    }

    const wantIds = new Set(rows.map(r => r.id));

    const { data: existing, error: listErr } = await supabase
      .from("lessons")
      .select("id");
    if (listErr) throw listErr;

    const toDelete = (existing ?? [])
      .map(r => r.id)
      .filter(id => !wantIds.has(id));

    // Run upsert + deletes in parallel — independent operations.
    const [upRes, ...delResults] = await Promise.all([
      rows.length > 0
        ? supabase.from("lessons").upsert(rows, { onConflict: "id" })
        : Promise.resolve({ error: null }),
      ...toDelete.map(id =>
        supabase.from("lessons").delete().eq("id", id),
      ),
    ]);
    if (upRes?.error) throw upRes.error;
    const delErr = delResults.find(r => r?.error)?.error;
    if (delErr) throw delErr;

    return { ok: true, upserted: rows.length, deleted: toDelete.length };
  } catch (err) {
    console.warn("[lessonsApi.syncAllLessons]", err);
    return { ok: false, error: err?.message || String(err) };
  }
}

// ─── Loader (used in Session B once consumers swap reads) ────────────────
// Defined now so Session A end-to-end tests can already query the table via
// a single entry point and verify shape parity with the blob.

export async function loadLessonsFromTable() {
  return listLessons();
}
