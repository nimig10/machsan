// deptHeadsApi.js — Stage 13 normalized read/write path for public.dept_heads.
// Returns rows in the SAME shape as the legacy blob:
//   { id, name, email, role, loanTypes: [string], lecturerId? }

import { supabase } from "../supabaseClient.js";

function rowToBlob(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name ?? "",
    email: r.email ?? "",
    role: r.role ?? "",
    loanTypes: Array.isArray(r.loan_types) ? r.loan_types : [],
    ...(r.lecturer_id ? { lecturerId: r.lecturer_id } : {}),
  };
}

function blobToRow(d, idx) {
  if (!d?.id) return null;
  return {
    id: String(d.id),
    name: String(d.name || ""),
    email: String(d.email || ""),
    role: String(d.role || ""),
    loan_types: Array.isArray(d.loanTypes) ? d.loanTypes : [],
    lecturer_id: d.lecturerId || null,
    sort_order: typeof idx === "number" ? idx : 0,
  };
}

// ─── Read path ────────────────────────────────────────────────────────────

export async function listDeptHeads() {
  const { data, error } = await supabase
    .from("dept_heads")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[deptHeadsApi.listDeptHeads]", error);
    return [];
  }
  return (data ?? []).map(rowToBlob);
}

export async function loadDeptHeadsFromTable() {
  return listDeptHeads();
}

// ─── Write path ───────────────────────────────────────────────────────────

export async function upsertDeptHead(blob, sortIndex = 0) {
  const row = blobToRow(blob, sortIndex);
  if (!row) return { ok: false, error: "missing id" };
  try {
    const { error } = await supabase
      .from("dept_heads")
      .upsert(row, { onConflict: "id" });
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.warn("[deptHeadsApi.upsertDeptHead]", blob?.id, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function deleteDeptHead(id) {
  if (!id) return { ok: false, error: "missing id" };
  try {
    const { error } = await supabase.from("dept_heads").delete().eq("id", String(id));
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.warn("[deptHeadsApi.deleteDeptHead]", id, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function syncAllDeptHeads(nextDeptHeads) {
  if (!Array.isArray(nextDeptHeads)) return { ok: false, error: "not an array" };
  try {
    const rows = nextDeptHeads.map((d, i) => blobToRow(d, i)).filter(Boolean);
    const wantIds = new Set(rows.map((r) => r.id));

    const { data: existing, error: listErr } = await supabase
      .from("dept_heads")
      .select("id");
    if (listErr) throw listErr;

    const toDelete = (existing ?? []).map((r) => r.id).filter((id) => !wantIds.has(id));

    const [upRes, ...delResults] = await Promise.all([
      rows.length > 0
        ? supabase.from("dept_heads").upsert(rows, { onConflict: "id" })
        : Promise.resolve({ error: null }),
      ...toDelete.map((id) => supabase.from("dept_heads").delete().eq("id", id)),
    ]);
    if (upRes?.error) throw upRes.error;
    const delErr = delResults.find((r) => r?.error)?.error;
    if (delErr) throw delErr;

    return { ok: true, upserted: rows.length, deleted: toDelete.length };
  } catch (err) {
    console.warn("[deptHeadsApi.syncAllDeptHeads]", err);
    return { ok: false, error: err?.message || String(err) };
  }
}
