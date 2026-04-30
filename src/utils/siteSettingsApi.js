// siteSettingsApi.js — Stage 13 normalized read/write path for public.site_settings.
// Returns the site_settings rows as a flat object (same shape as the legacy
// store.siteSettings blob), plus exposes managerToken which now lives here too.

import { supabase } from "../supabaseClient.js";

export async function loadSiteSettingsFromTable() {
  const { data, error } = await supabase
    .from("site_settings")
    .select("key, value");
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
}

// Upsert every key in the blob. We do NOT delete keys absent from the blob,
// because site_settings is shared (e.g. managerToken is managed separately).
export async function syncAllSiteSettings(blob) {
  if (!blob || typeof blob !== "object") return { ok: false, error: "missing blob" };
  try {
    const rows = Object.entries(blob)
      .filter(([key]) => typeof key === "string" && key.length > 0)
      .map(([key, value]) => ({ key, value: value ?? null }));
    if (rows.length === 0) return { ok: true, upserted: 0 };
    const { error } = await supabase
      .from("site_settings")
      .upsert(rows, { onConflict: "key" });
    if (error) throw error;
    return { ok: true, upserted: rows.length };
  } catch (err) {
    console.warn("[siteSettingsApi.syncAllSiteSettings]", err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function setSetting(key, value) {
  if (!key) return { ok: false, error: "missing key" };
  try {
    const { error } = await supabase
      .from("site_settings")
      .upsert({ key, value: value ?? null }, { onConflict: "key" });
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.warn("[siteSettingsApi.setSetting]", key, err);
    return { ok: false, error: err?.message || String(err) };
  }
}
