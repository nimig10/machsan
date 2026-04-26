// studentsApi.js — read path for the normalized students tables (Stage 6).
//
// Returns student records in the SAME shape as the legacy
// store.certifications.students blob:
//   { id, name, email, phone, track, certs: { [cert_id]: "עבר" | "לא עבר" } }
//
// This shape compatibility means callers can be migrated one-by-one without
// touching consumer code. Once all consumers are migrated (Stage 6 step 5),
// we can switch to a richer shape that exposes track_id/track_type etc.

import { supabase } from "../supabaseClient.js";

// Reshape a flat row set (one row per student × cert) into blob-shaped students.
function shapeStudents(rows) {
  const byId = new Map();
  for (const r of rows) {
    let stu = byId.get(r.id);
    if (!stu) {
      stu = {
        id:    r.id,
        name:  r.name,
        email: r.email ?? "",
        phone: r.phone ?? "",
        track: r.track_name ?? "",
        certs: {},
      };
      byId.set(r.id, stu);
    }
    if (r.cert_type_id && r.cert_status) {
      stu.certs[r.cert_type_id] = r.cert_status;
    }
  }
  return Array.from(byId.values());
}

// Single Supabase select with embedded relation. Returns nested cert rows
// inline; we flatten + reshape in JS.
async function fetchStudentsRaw(filter) {
  let q = supabase
    .from("students")
    .select(`
      id, name, email, phone, track_name,
      student_certifications ( cert_type_id, status )
    `);
  if (filter?.id)         q = q.eq("id", filter.id);
  if (filter?.trackName)  q = q.eq("track_name", filter.trackName);

  const { data, error } = await q;
  if (error) throw error;

  // Flatten nested cert rows so shapeStudents can consume a uniform row set.
  const flat = [];
  for (const s of data ?? []) {
    const certs = s.student_certifications ?? [];
    if (certs.length === 0) {
      flat.push({ id: s.id, name: s.name, email: s.email, phone: s.phone, track_name: s.track_name, cert_type_id: null, cert_status: null });
    } else {
      for (const c of certs) {
        flat.push({ id: s.id, name: s.name, email: s.email, phone: s.phone, track_name: s.track_name, cert_type_id: c.cert_type_id, cert_status: c.status });
      }
    }
  }
  return shapeStudents(flat);
}

export async function listStudents() {
  return fetchStudentsRaw();
}

export async function getStudent(id) {
  const arr = await fetchStudentsRaw({ id });
  return arr[0] ?? null;
}

export async function getStudentsByTrack(trackName) {
  return fetchStudentsRaw({ trackName });
}

// ─── Write path (Stage 6 step 4 — dual-write) ─────────────────────────────
//
// These helpers keep the normalized tables in sync with whatever the legacy
// blob path already wrote. Failure here is non-fatal during dual-write — the
// blob is still authoritative until step 5 migrates reads.

async function resolveTrackId(trackName) {
  if (!trackName) return null;
  const { data } = await supabase
    .from("tracks")
    .select("id")
    .eq("name", trackName)
    .maybeSingle();
  return data?.id ?? null;
}

// Upsert one student + replace their cert statuses. Best-effort; logs but
// does not throw, since the blob write is the source of truth right now.
export async function upsertStudent(stu) {
  if (!stu?.id) return { ok: false, error: "missing id" };
  try {
    const track_id = await resolveTrackId(stu.track);

    // Run student upsert + cert delete in parallel — independent operations.
    const [{ error: stuErr }, { error: delErr }] = await Promise.all([
      supabase.from("students").upsert({
        id:         stu.id,
        name:       stu.name ?? "",
        email:      stu.email || null,
        phone:      stu.phone || null,
        track_name: stu.track || null,
        track_id,
      }),
      supabase.from("student_certifications").delete().eq("student_id", stu.id),
    ]);
    if (stuErr) throw stuErr;
    if (delErr) throw delErr;

    const certEntries = Object.entries(stu.certs || {}).filter(
      ([, status]) => status === "עבר" || status === "לא עבר"
    );
    if (certEntries.length > 0) {
      const rows = certEntries.map(([cert_type_id, status]) => ({
        student_id: stu.id, cert_type_id, status,
      }));
      const { error: insErr } = await supabase
        .from("student_certifications")
        .insert(rows);
      if (insErr) throw insErr;
    }

    return { ok: true };
  } catch (err) {
    console.warn("[studentsApi.upsertStudent]", stu.id, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function deleteStudent(id) {
  if (!id) return { ok: false, error: "missing id" };
  try {
    // CASCADE on student_certifications means the FK rows go too.
    const { error } = await supabase.from("students").delete().eq("id", id);
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.warn("[studentsApi.deleteStudent]", id, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

// Sync certification_types — keeps the FK target for student_certifications
// valid when new types are added in the blob.
export async function syncCertificationTypes(types) {
  if (!Array.isArray(types)) return { ok: false };
  try {
    const wantIds = new Set(types.map(t => t.id).filter(Boolean));
    const rows = types
      .filter(t => t.id && t.name)
      .map(t => ({ id: t.id, name: t.name }));
    if (rows.length > 0) {
      const { error } = await supabase.from("certification_types").upsert(rows);
      if (error) throw error;
    }
    const { data: existing } = await supabase.from("certification_types").select("id");
    const toDelete = (existing ?? []).map(r => r.id).filter(id => !wantIds.has(id));
    if (toDelete.length > 0) {
      // ON DELETE CASCADE on student_certifications removes orphan cert rows.
      await supabase.from("certification_types").delete().in("id", toDelete);
    }
    return { ok: true };
  } catch (err) {
    console.warn("[studentsApi.syncCertificationTypes]", err);
    return { ok: false, error: err?.message || String(err) };
  }
}

// Sync tracks — merges blob's tracks[] (track_type) and trackSettings[] (loan_types)
// into one row per name. Keeps the FK target for students.track_id valid.
export async function syncTracks(tracks, trackSettings) {
  try {
    const byName = new Map();
    for (const t of tracks ?? []) {
      if (!t?.name) continue;
      byName.set(t.name, {
        name: t.name,
        track_type: t.trackType === "sound" ? "sound" : "cinema",
        loan_types: byName.get(t.name)?.loan_types ?? [],
      });
    }
    for (const t of trackSettings ?? []) {
      if (!t?.name) continue;
      const existing = byName.get(t.name) ?? { name: t.name, track_type: "cinema", loan_types: [] };
      existing.loan_types = Array.isArray(t.loanTypes) ? t.loanTypes : [];
      byName.set(t.name, existing);
    }
    const rows = Array.from(byName.values());
    if (rows.length > 0) {
      const { error } = await supabase.from("tracks").upsert(rows, { onConflict: "name" });
      if (error) throw error;
    }
    const wantNames = new Set(rows.map(r => r.name));
    const { data: existing } = await supabase.from("tracks").select("name");
    const toDelete = (existing ?? []).map(r => r.name).filter(n => !wantNames.has(n));
    if (toDelete.length > 0) {
      // ON DELETE SET NULL on students.track_id keeps student rows safe.
      await supabase.from("tracks").delete().in("name", toDelete);
    }
    return { ok: true };
  } catch (err) {
    console.warn("[studentsApi.syncTracks]", err);
    return { ok: false, error: err?.message || String(err) };
  }
}

// Full reconciliation: upsert every student in `nextStudents` and delete any
// IDs in the table that aren't in the new list. Upserts run in parallel.
export async function syncAllStudents(nextStudents) {
  if (!Array.isArray(nextStudents)) return { ok: false, error: "not an array" };
  try {
    const wantIds = new Set(nextStudents.map(s => s.id).filter(Boolean));

    const [{ data: existing, error: listErr }] = await Promise.all([
      supabase.from("students").select("id"),
    ]);
    if (listErr) throw listErr;

    const toDelete = (existing ?? []).map(r => r.id).filter(id => !wantIds.has(id));

    // Parallel upserts + deletes — avoids N sequential round trips.
    await Promise.all([
      ...nextStudents.map(stu => upsertStudent(stu)),
      ...toDelete.map(id => deleteStudent(id)),
    ]);
    return { ok: true, upserted: nextStudents.length, deleted: toDelete.length };
  } catch (err) {
    console.warn("[studentsApi.syncAllStudents]", err);
    return { ok: false, error: err?.message || String(err) };
  }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────
//
// Stage 6 step 6: tables are now the source of truth. Callers no longer write
// to store.certifications — they call this instead. Returns { ok } so the UI
// can surface a save error like the old storageSet did.
//
// Order matters: types/tracks first (FK targets), then students (FKs into them).
export async function dualWriteCertifications(certifications) {
  if (!certifications) return { ok: false, error: "no payload" };
  const r1 = await syncCertificationTypes(certifications.types);
  const r2 = await syncTracks(certifications.tracks, certifications.trackSettings);
  const r3 = await syncAllStudents(certifications.students);
  const ok = r1?.ok !== false && r2?.ok !== false && r3?.ok !== false;
  return { ok, types: r1, tracks: r2, students: r3 };
}
