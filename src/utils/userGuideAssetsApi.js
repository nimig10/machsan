// userGuideAssetsApi.js — load/upsert/delete PDF assets for user-guide
// per audience. Reuses the existing public.policy_assets table with new
// slot values (no schema change needed).

import { supabase } from "../supabaseClient.js";

export const USER_GUIDE_SLOTS = {
  students:  "user_guide_pdf_students",
  staff:     "user_guide_pdf_staff",
  lecturers: "user_guide_pdf_lecturers",
};

export async function loadUserGuideAsset(slot) {
  const { data, error } = await supabase
    .from("policy_assets")
    .select("slot, filename, data_base64")
    .eq("slot", slot)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { filename: data.filename, data_base64: data.data_base64 };
}

export async function upsertUserGuideAsset(slot, { filename, data_base64 }) {
  const { error } = await supabase
    .from("policy_assets")
    .upsert({ slot, filename: filename ?? null, data_base64, is_compressed: false }, { onConflict: "slot" });
  if (error) throw error;
}

export async function deleteUserGuideAsset(slot) {
  const { error } = await supabase.from("policy_assets").delete().eq("slot", slot);
  if (error) throw error;
}
