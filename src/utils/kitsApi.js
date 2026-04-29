// kitsApi.js — Stage 11 normalized read/write path for the public.kits table.
// Returns rows in the SAME shape as the legacy blob:
//   { id, name, items: [{name, quantity, equipment_id}], loanTypes: [string], description, createdAt, updatedAt }

import { supabase } from "../supabaseClient.js";

function rowToBlob(r) {
  if (!r) return null;
  return {
    id:          r.id,
    name:        r.name        ?? "",
    items:       Array.isArray(r.items) ? r.items : [],
    loanTypes:   Array.isArray(r.loan_types) ? r.loan_types : [],
    description: r.description ?? "",
    createdAt:   r.created_at,
    updatedAt:   r.updated_at,
  };
}

function blobToRow(k) {
  if (!k?.id) return null;
  const name = String(k.name || "").trim();
  if (!name) return null;
  return {
    id:          String(k.id),
    name,
    items:       Array.isArray(k.items) ? k.items : [],
    loan_types:  Array.isArray(k.loanTypes) ? k.loanTypes : [],
    description: String(k.description || ""),
  };
}

// ─── Read path ────────────────────────────────────────────────────────────

export async function listKits() {
  const { data, error } = await supabase
    .from("kits")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[kitsApi.listKits]", error);
    return [];
  }
  return (data ?? []).map(rowToBlob);
}

export async function getKit(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from("kits")
    .select("*")
    .eq("id", String(id))
    .maybeSingle();
  if (error) {
    console.warn("[kitsApi.getKit]", id, error);
    return null;
  }
  return rowToBlob(data);
}

// ─── Write path ───────────────────────────────────────────────────────────

export async function upsertKit(blob) {
  const row = blobToRow(blob);
  if (!row) return { ok: false, error: "missing id or name" };
  try {
    const { error } = await supabase
      .from("kits")
      .upsert(row, { onConflict: "id" });
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.warn("[kitsApi.upsertKit]", blob?.id, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function deleteKit(id) {
  if (!id) return { ok: false, error: "missing id" };
  try {
    const { error } = await supabase.from("kits").delete().eq("id", String(id));
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.warn("[kitsApi.deleteKit]", id, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function syncAllKits(nextKits) {
  if (!Array.isArray(nextKits)) return { ok: false, error: "not an array" };
  try {
    const rows = nextKits.map(blobToRow).filter(Boolean);
    const wantIds = new Set(rows.map(r => r.id));

    const { data: existing, error: listErr } = await supabase
      .from("kits")
      .select("id");
    if (listErr) throw listErr;

    const toDelete = (existing ?? []).map(r => r.id).filter(id => !wantIds.has(id));

    const [upRes, ...delResults] = await Promise.all([
      rows.length > 0
        ? supabase.from("kits").upsert(rows, { onConflict: "id" })
        : Promise.resolve({ error: null }),
      ...toDelete.map(id => supabase.from("kits").delete().eq("id", id)),
    ]);
    if (upRes?.error) throw upRes.error;
    const delErr = delResults.find(r => r?.error)?.error;
    if (delErr) throw delErr;

    return { ok: true, upserted: rows.length, deleted: toDelete.length };
  } catch (err) {
    console.warn("[kitsApi.syncAllKits]", err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function loadKitsFromTable() {
  return listKits();
}
