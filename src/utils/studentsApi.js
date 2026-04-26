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
