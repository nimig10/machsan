// studioBookingsApi.js — Stage 10 normalized read/write path for the
// public.studio_bookings table. Mirror of studiosApi/lessonsApi/lecturersApi.
//
// IMPORTANT: lesson_auto bookings (281/308 rows in prod) are NOT stored in
// this table. They are regenerated in-memory from lessons.schedule on every
// load via buildLessonStudioBookings (utils/lessonBookings.js, Session B).
// Both blobToRow() and syncAllStudioBookings() filter them out so they never
// hit the table.
//
// Returns rows in the SAME shape as the legacy blob:
//   { id, studioId, date, startTime, endTime, isNight, bookingKind,
//     ownerType, status, studentId, studentName, studentEmail, studentPhone,
//     teamMemberId, teamMemberName, lesson_id, lesson_auto, courseName,
//     instructorName, track, subject, recurringGroupId, notes,
//     createdAt, updatedAt }

import { supabase } from "../supabaseClient.js";

// Postgres SQLSTATE 23P01 (exclusion_violation) is raised by the
// studio_bookings_no_overlap EXCLUDE constraint (migration 20260621120000) when
// a write would create a time-overlapping booking on the same studio. Map it to
// a stable "studio_overlap" token so callers can show a clear Hebrew message —
// mirrors the create_reservation_v2 "student_overlap" token handling.
function isStudioOverlapError(err) {
  if (!err) return false;
  if (err.code === "23P01") return true;
  return /studio_bookings_no_overlap|exclusion_violation|23P01/i.test(err.message || "");
}

// ─── Shape mapping (DB row ↔ blob entry) ──────────────────────────────────

function rowToBlob(r) {
  if (!r) return null;
  const blob = {
    id:               r.id,
    studioId:         r.studio_id,
    date:             r.date,
    startTime:        r.start_time ?? "",
    endTime:          r.end_time   ?? "",
    isNight:          r.is_night === true,
    bookingKind:      r.booking_kind || undefined,
    ownerType:        r.owner_type   || undefined,
    status:           r.status       || undefined,
    studentId:        r.student_id   || undefined,
    studentName:      r.student_name || undefined,
    studentEmail:     r.student_email|| undefined,
    studentPhone:     r.student_phone|| undefined,
    teamMemberId:     r.team_member_id   || undefined,
    teamMemberName:   r.team_member_name || undefined,
    lesson_id:        r.lesson_id || undefined,
    lesson_auto:      r.lesson_auto === true ? true : undefined,
    courseName:       r.course_name     || undefined,
    instructorName:   r.instructor_name || undefined,
    track:            r.track   || undefined,
    subject:          r.subject || undefined,
    recurringGroupId: r.recurring_group_id || undefined,
    notes:            r.notes || undefined,
    createdAt:        r.created_at,
    updatedAt:        r.updated_at,
  };
  // Strip undefined keys for cleaner shape parity with blob.
  for (const k of Object.keys(blob)) if (blob[k] === undefined) delete blob[k];
  return blob;
}

// blobToRow returns null for lesson_auto entries — they belong in memory only,
// regenerated from lessons.schedule. Never persist them.
function blobToRow(b) {
  if (!b?.id) return null;
  if (b.lesson_auto === true) return null;
  if (b.bookingKind === "lesson") return null;
  const studioId = b.studioId != null ? String(b.studioId) : "";
  const date = String(b.date || "").trim();
  if (!studioId || !date) return null; // NOT NULL guards
  return {
    id:                 String(b.id),
    studio_id:          studioId,
    date,
    start_time:         b.startTime || null,
    end_time:           b.endTime   || null,
    is_night:           b.isNight === true,
    booking_kind:       b.bookingKind || null,
    owner_type:         b.ownerType   || null,
    status:             b.status      || null,
    student_id:         b.studentId   || null,
    student_name:       b.studentName || null,
    student_email:      b.studentEmail|| null,
    student_phone:      b.studentPhone|| null,
    team_member_id:     b.teamMemberId   || null,
    team_member_name:   b.teamMemberName || null,
    lesson_id:          b.lesson_id || null,
    lesson_auto:        false, // never true (filtered above)
    course_name:        b.courseName     || null,
    instructor_name:    b.instructorName || null,
    track:              b.track   || null,
    subject:            b.subject || null,
    recurring_group_id: b.recurringGroupId || null,
    notes:              b.notes || null,
  };
}

// ─── Read path ────────────────────────────────────────────────────────────

export async function listStudioBookings() {
  const { data, error } = await supabase
    .from("studio_bookings")
    .select("*")
    .order("date", { ascending: true });
  if (error) {
    console.warn("[studioBookingsApi.listStudioBookings]", error);
    return [];
  }
  return (data ?? []).map(rowToBlob);
}

export async function getStudioBooking(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from("studio_bookings")
    .select("*")
    .eq("id", String(id))
    .maybeSingle();
  if (error) {
    console.warn("[studioBookingsApi.getStudioBooking]", id, error);
    return null;
  }
  return rowToBlob(data);
}

// ─── Write path ───────────────────────────────────────────────────────────
//
// Writes are best-effort during Session A (dual-write window): log + return
// { ok:false, error } on failure. The blob remains the source of truth, so a
// table-write failure must NOT block the user-facing operation.

export async function upsertStudioBooking(blob) {
  const row = blobToRow(blob);
  if (!row) return { ok: false, error: "missing fields or lesson_auto" };
  try {
    const { error } = await supabase
      .from("studio_bookings")
      .upsert(row, { onConflict: "id" });
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.warn("[studioBookingsApi.upsertStudioBooking]", blob?.id, err);
    if (isStudioOverlapError(err)) return { ok: false, error: "studio_overlap" };
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function deleteStudioBooking(id) {
  if (!id) return { ok: false, error: "missing id" };
  try {
    const { error } = await supabase
      .from("studio_bookings")
      .delete()
      .eq("id", String(id));
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.warn("[studioBookingsApi.deleteStudioBooking]", id, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

// Full reconciliation: upsert every non-lesson_auto entry in nextBookings and
// delete any IDs in the table that aren't in the new list (excluding nothing
// — the table only ever holds non-auto rows). Parallelized.
export async function syncAllStudioBookings(nextBookings) {
  if (!Array.isArray(nextBookings)) {
    return { ok: false, error: "not an array" };
  }
  try {
    const rows = nextBookings.map(blobToRow).filter(Boolean);
    const wantIds = new Set(rows.map(r => r.id));

    const { data: existing, error: listErr } = await supabase
      .from("studio_bookings")
      .select("id");
    if (listErr) throw listErr;

    const toDelete = (existing ?? [])
      .map(r => r.id)
      .filter(id => !wantIds.has(id));

    const [upRes, ...delResults] = await Promise.all([
      rows.length > 0
        ? supabase.from("studio_bookings").upsert(rows, { onConflict: "id" })
        : Promise.resolve({ error: null }),
      ...toDelete.map(id =>
        supabase.from("studio_bookings").delete().eq("id", id),
      ),
    ]);
    if (upRes?.error) throw upRes.error;
    const delErr = delResults.find(r => r?.error)?.error;
    if (delErr) throw delErr;

    return { ok: true, upserted: rows.length, deleted: toDelete.length };
  } catch (err) {
    console.warn("[studioBookingsApi.syncAllStudioBookings]", err);
    if (isStudioOverlapError(err)) return { ok: false, error: "studio_overlap" };
    return { ok: false, error: err?.message || String(err) };
  }
}

// ─── Loader (used in Session B once consumers swap reads) ─────────────────

export async function loadStudioBookingsFromTable() {
  return listStudioBookings();
}
