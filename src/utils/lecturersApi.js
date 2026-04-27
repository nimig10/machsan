// lecturersApi.js — Stage 7 normalized read/write path for the public.lecturers
// table. During Session A this module is a dual-write target only — every
// existing storageSet("lecturers", arr) call is followed by one of these
// helpers, but reads still flow through store.lecturers blob. Sessions B/C
// will swap consumers over.
//
// Returns rows in the SAME shape as the legacy blob:
//   {
//     id, firstName, lastName, fullName, phone, email,
//     studyTracks: string[], notes, isActive,
//     createdAt, updatedAt
//   }
// so that future consumers can be migrated one-by-one without changing call
// sites. Mirror of src/utils/studentsApi.js — keep them structurally aligned.

import { supabase } from "../supabaseClient.js";

// ─── Shape mapping (DB row ↔ blob entry) ──────────────────────────────────

function rowToBlob(r) {
  if (!r) return null;
  return {
    id:          r.id,
    firstName:   r.first_name ?? "",
    lastName:    r.last_name  ?? "",
    fullName:    r.full_name  ?? "",
    phone:       r.phone      ?? "",
    email:       r.email      ?? "",
    studyTracks: Array.isArray(r.study_tracks) ? r.study_tracks : [],
    notes:       r.notes      ?? "",
    isActive:    r.is_active !== false,
    createdAt:   r.created_at,
    updatedAt:   r.updated_at,
  };
}

function blobToRow(l) {
  if (!l?.id) return null;
  const firstName = String(l.firstName || "").trim();
  const lastName  = String(l.lastName  || "").trim();
  const explicitFull = String(l.fullName || "").trim();
  // full_name has NOT NULL — synthesize from parts if blob omits it.
  const fullName = explicitFull
    || [firstName, lastName].filter(Boolean).join(" ")
    || firstName
    || lastName
    || "";
  return {
    id:           l.id,
    first_name:   firstName,
    last_name:    lastName,
    full_name:    fullName,
    phone:        String(l.phone || "").trim() || null,
    email:        String(l.email || "").trim() || null,
    study_tracks: Array.isArray(l.studyTracks) ? l.studyTracks : [],
    notes:        l.notes || null,
    is_active:    l.isActive !== false,
  };
}

// ─── Read path ────────────────────────────────────────────────────────────

export async function listLecturers() {
  const { data, error } = await supabase
    .from("lecturers")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[lecturersApi.listLecturers]", error);
    return [];
  }
  return (data ?? []).map(rowToBlob);
}

export async function getLecturer(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from("lecturers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn("[lecturersApi.getLecturer]", id, error);
    return null;
  }
  return rowToBlob(data);
}

export async function getLecturerByEmail(email) {
  const normalized = String(email || "").toLowerCase().trim();
  if (!normalized) return null;
  // Use ilike for case-insensitive match against the lower(email) unique idx.
  const { data, error } = await supabase
    .from("lecturers")
    .select("*")
    .ilike("email", normalized)
    .maybeSingle();
  if (error) {
    console.warn("[lecturersApi.getLecturerByEmail]", normalized, error);
    return null;
  }
  return rowToBlob(data);
}

// ─── Write path (Stage 7 step 3 — dual-write) ─────────────────────────────
//
// All writes are best-effort: log + return { ok:false, error } on failure.
// The blob remains the source of truth during Session A, so a table-write
// failure must NOT block the user-facing operation. Same policy as Stage 6
// (see studentsApi.upsertStudent).

export async function upsertLecturer(blob) {
  const row = blobToRow(blob);
  if (!row) return { ok: false, error: "missing id" };
  try {
    const { error } = await supabase
      .from("lecturers")
      .upsert(row, { onConflict: "id" });
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.warn("[lecturersApi.upsertLecturer]", blob?.id, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

// Alias used at write call sites for readability — semantically identical to
// upsertLecturer but communicates intent ("we're mirroring the blob write").
export const dualWriteLecturer = upsertLecturer;

export async function deleteLecturer(id) {
  if (!id) return { ok: false, error: "missing id" };
  try {
    const { error } = await supabase.from("lecturers").delete().eq("id", id);
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.warn("[lecturersApi.deleteLecturer]", id, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

// Full reconciliation: upsert every entry in nextLecturers and delete any
// IDs in the table that aren't in the new list. Used for one-shot backfill
// AND for bulk paths (XL import, lessons auto-extract). Parallelized.
export async function syncAllLecturers(nextLecturers) {
  if (!Array.isArray(nextLecturers)) {
    return { ok: false, error: "not an array" };
  }
  try {
    const rows = nextLecturers.map(blobToRow).filter(Boolean);
    const wantIds = new Set(rows.map(r => r.id));

    const { data: existing, error: listErr } = await supabase
      .from("lecturers")
      .select("id");
    if (listErr) throw listErr;

    const toDelete = (existing ?? [])
      .map(r => r.id)
      .filter(id => !wantIds.has(id));

    // Run upsert + deletes in parallel — independent operations.
    const [upRes, ...delResults] = await Promise.all([
      rows.length > 0
        ? supabase.from("lecturers").upsert(rows, { onConflict: "id" })
        : Promise.resolve({ error: null }),
      ...toDelete.map(id =>
        supabase.from("lecturers").delete().eq("id", id),
      ),
    ]);
    if (upRes?.error) throw upRes.error;
    const delErr = delResults.find(r => r?.error)?.error;
    if (delErr) throw delErr;

    return { ok: true, upserted: rows.length, deleted: toDelete.length };
  } catch (err) {
    console.warn("[lecturersApi.syncAllLecturers]", err);
    return { ok: false, error: err?.message || String(err) };
  }
}

// ─── Loader (used in Session B once consumers swap reads) ────────────────
// Defined now so Session A end-to-end tests can already query the table via
// a single entry point and verify shape parity with the blob.

export async function loadLecturersFromTable() {
  return listLecturers();
}
