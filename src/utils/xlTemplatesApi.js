// xlTemplatesApi.js — load/upsert/delete admin-uploaded XL templates.
// Reuses public.policy_assets with new slot values (no schema change).

import { supabase } from "../supabaseClient.js";

export const XL_TEMPLATE_SLOTS = {
  courses:  "xl_template_courses",
  students: "xl_template_students",
};

export async function loadXlTemplate(slot) {
  const { data, error } = await supabase
    .from("policy_assets")
    .select("slot, filename, data_base64")
    .eq("slot", slot)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { filename: data.filename, data_base64: data.data_base64 };
}

export async function upsertXlTemplate(slot, { filename, data_base64 }) {
  const { error } = await supabase
    .from("policy_assets")
    .upsert({ slot, filename: filename ?? null, data_base64, is_compressed: false }, { onConflict: "slot" });
  if (error) throw error;
}

export async function deleteXlTemplate(slot) {
  const { error } = await supabase.from("policy_assets").delete().eq("slot", slot);
  if (error) throw error;
}
