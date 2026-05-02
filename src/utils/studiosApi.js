// studiosApi.js — read/write path for the public.studios table. Single
// source of truth (public.store was retired 2026-04-30). All reads and writes
// flow exclusively through this module via the supabase client.
//
// Returns rows in the SAME shape used historically by the app:
//   {
//     id, name, type, image, description,
//     isClassroom, isDisabled, classroomOnly, requiresApproval,
//     studioCertId, studioCertIds, studioTrackType,
//     createdAt, updatedAt
//   }
// so future consumers can be migrated one-by-one without changing call sites.
// Mirror of src/utils/lecturersApi.js / lessonsApi.js — keep them aligned.

import { supabase } from "../supabaseClient.js";

// ─── Shape mapping (DB row ↔ blob entry) ──────────────────────────────────

function rowToBlob(r) {
  if (!r) return null;
  return {
    id:                r.id,
    name:              r.name              ?? "",
    type:              r.studio_type       ?? "",
    image:             r.image             ?? "",
    description:       r.description       ?? "",
    isClassroom:       r.is_classroom      === true,
    isDisabled:        r.is_disabled       === true,
    classroomOnly:     r.classroom_only    === true,
    requiresApproval:  r.requires_approval === true,
    studioCertId:      r.studio_cert_id    ?? "",
    studioCertIds:     Array.isArray(r.studio_cert_ids) ? r.studio_cert_ids : [],
    studioTrackType:   r.studio_track_type ?? "",
    createdAt:         r.created_at,
    updatedAt:         r.updated_at,
  };
}

function blobToRow(s) {
  if (!s?.id) return null;
  const name = String(s.name || "").trim();
  if (!name) return null; // name is NOT NULL
  return {
    id:                String(s.id),
    name,
    studio_type:       s.type || null,
    image:             s.image || null,
    description:       s.description || null,
    is_classroom:      s.isClassroom      === true,
    is_disabled:       s.isDisabled       === true,
    classroom_only:    s.classroomOnly    === true,
    requires_approval: s.requiresApproval === true,
    studio_cert_id:    s.studioCertId || null,
    studio_cert_ids:   Array.isArray(s.studioCertIds) ? s.studioCertIds : [],
    studio_track_type: s.studioTrackType || null,
  };
}

// ─── Read path ────────────────────────────────────────────────────────────

export async function listStudios() {
  const { data, error } = await supabase
    .from("studios")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[studiosApi.listStudios]", error);
    return [];
  }
  return (data ?? []).map(rowToBlob);
}

export async function getStudio(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from("studios")
    .select("*")
    .eq("id", String(id))
    .maybeSingle();
  if (error) {
    console.warn("[studiosApi.getStudio]", id, error);
    return null;
  }
  return rowToBlob(data);
}

// ─── Write path (Stage 9 Session A — dual-write) ──────────────────────────
//
// All writes are best-effort: log + return { ok:false, error } on failure.
// The blob remains the source of truth during Session A, so a table-write
// failure must NOT block the user-facing operation.

export async function upsertStudio(blob) {
  const row = blobToRow(blob);
  if (!row) return { ok: false, error: "missing id or name" };
  try {
    const { error } = await supabase
      .from("studios")
      .upsert(row, { onConflict: "id" });
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.warn("[studiosApi.upsertStudio]", blob?.id, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function deleteStudio(id) {
  if (!id) return { ok: false, error: "missing id" };
  try {
    const { error } = await supabase.from("studios").delete().eq("id", String(id));
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.warn("[studiosApi.deleteStudio]", id, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

// Full reconciliation: upsert every entry in nextStudios and delete any IDs
// in the table that aren't in the new list. Used for one-shot backfill AND
// for bulk paths. Parallelized.
export async function syncAllStudios(nextStudios) {
  if (!Array.isArray(nextStudios)) {
    return { ok: false, error: "not an array" };
  }
  try {
    const rows = nextStudios.map(blobToRow).filter(Boolean);
    const wantIds = new Set(rows.map(r => r.id));

    const { data: existing, error: listErr } = await supabase
      .from("studios")
      .select("id");
    if (listErr) throw listErr;

    const toDelete = (existing ?? [])
      .map(r => r.id)
      .filter(id => !wantIds.has(id));

    const [upRes, ...delResults] = await Promise.all([
      rows.length > 0
        ? supabase.from("studios").upsert(rows, { onConflict: "id" })
        : Promise.resolve({ error: null }),
      ...toDelete.map(id =>
        supabase.from("studios").delete().eq("id", id),
      ),
    ]);
    if (upRes?.error) throw upRes.error;
    const delErr = delResults.find(r => r?.error)?.error;
    if (delErr) throw delErr;

    return { ok: true, upserted: rows.length, deleted: toDelete.length };
  } catch (err) {
    console.warn("[studiosApi.syncAllStudios]", err);
    return { ok: false, error: err?.message || String(err) };
  }
}

// ─── Loader (used in Session B once consumers swap reads) ─────────────────

export async function loadStudiosFromTable() {
  return listStudios();
}
