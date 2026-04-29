// teamMembersApi.js — Stage 11 normalized read/write path for the public.team_members table.
// Returns rows in the SAME shape as the legacy blob:
//   { id, name, email, phone, loanTypes: [string], createdAt, updatedAt }

import { supabase } from "../supabaseClient.js";

function rowToBlob(r) {
  if (!r) return null;
  return {
    id:        r.id,
    name:      r.name  ?? "",
    email:     r.email ?? "",
    phone:     r.phone ?? "",
    loanTypes: Array.isArray(r.loan_types) ? r.loan_types : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function blobToRow(m) {
  if (!m?.id) return null;
  const name = String(m.name || "").trim();
  if (!name) return null;
  return {
    id:         String(m.id),
    name,
    email:      String(m.email || ""),
    phone:      String(m.phone || ""),
    loan_types: Array.isArray(m.loanTypes) ? m.loanTypes : [],
  };
}

// ─── Read path ────────────────────────────────────────────────────────────

export async function listTeamMembers() {
  const { data, error } = await supabase
    .from("team_members")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[teamMembersApi.listTeamMembers]", error);
    return [];
  }
  return (data ?? []).map(rowToBlob);
}

export async function getTeamMember(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from("team_members")
    .select("*")
    .eq("id", String(id))
    .maybeSingle();
  if (error) {
    console.warn("[teamMembersApi.getTeamMember]", id, error);
    return null;
  }
  return rowToBlob(data);
}

// ─── Write path ───────────────────────────────────────────────────────────

export async function upsertTeamMember(blob) {
  const row = blobToRow(blob);
  if (!row) return { ok: false, error: "missing id or name" };
  try {
    const { error } = await supabase
      .from("team_members")
      .upsert(row, { onConflict: "id" });
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.warn("[teamMembersApi.upsertTeamMember]", blob?.id, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function deleteTeamMember(id) {
  if (!id) return { ok: false, error: "missing id" };
  try {
    const { error } = await supabase.from("team_members").delete().eq("id", String(id));
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.warn("[teamMembersApi.deleteTeamMember]", id, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function syncAllTeamMembers(nextMembers) {
  if (!Array.isArray(nextMembers)) return { ok: false, error: "not an array" };
  try {
    const rows = nextMembers.map(blobToRow).filter(Boolean);
    const wantIds = new Set(rows.map(r => r.id));

    const { data: existing, error: listErr } = await supabase
      .from("team_members")
      .select("id");
    if (listErr) throw listErr;

    const toDelete = (existing ?? []).map(r => r.id).filter(id => !wantIds.has(id));

    const [upRes, ...delResults] = await Promise.all([
      rows.length > 0
        ? supabase.from("team_members").upsert(rows, { onConflict: "id" })
        : Promise.resolve({ error: null }),
      ...toDelete.map(id => supabase.from("team_members").delete().eq("id", id)),
    ]);
    if (upRes?.error) throw upRes.error;
    const delErr = delResults.find(r => r?.error)?.error;
    if (delErr) throw delErr;

    return { ok: true, upserted: rows.length, deleted: toDelete.length };
  } catch (err) {
    console.warn("[teamMembersApi.syncAllTeamMembers]", err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function loadTeamMembersFromTable() {
  return listTeamMembers();
}
