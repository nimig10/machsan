// collegeManagerApi.js — Stage 13 normalized read/write path for public.college_manager.
// Singleton row (id=1) that mirrors the legacy store.collegeManager blob:
//   { name, email }

import { supabase } from "../supabaseClient.js";

export async function loadCollegeManagerFromTable() {
  const { data, error } = await supabase
    .from("college_manager")
    .select("name, email")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return {
    name: data?.name ?? "",
    email: data?.email ?? "",
  };
}

export async function saveCollegeManager({ name, email }) {
  try {
    const { error } = await supabase
      .from("college_manager")
      .upsert(
        { id: 1, name: String(name ?? ""), email: String(email ?? "") },
        { onConflict: "id" },
      );
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.warn("[collegeManagerApi.saveCollegeManager]", err);
    return { ok: false, error: err?.message || String(err) };
  }
}
