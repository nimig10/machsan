// policiesApi.js — Stage 13 normalized read/write path for public.policies + public.policy_assets.
// Returns blob in the SAME shape as the legacy store.policies object:
//   { פרטית, הפקה, סאונד, "קולנוע יומית", לילה,
//     commitmentPdf, commitmentPdfName, commitmentPdfCompressed }

import { supabase } from "../supabaseClient.js";

const LOAN_TYPE_ORDER = ["פרטית", "הפקה", "סאונד", "קולנוע יומית", "לילה"];

export async function loadPoliciesFromTable() {
  const [polRes, assetRes] = await Promise.all([
    supabase
      .from("policies")
      .select("loan_type, body, sort_order")
      .order("sort_order", { ascending: true }),
    supabase
      .from("policy_assets")
      .select("slot, filename, data_base64, is_compressed")
      .eq("slot", "commitment_pdf")
      .maybeSingle(),
  ]);

  if (polRes.error) throw polRes.error;

  const blob = {};
  for (const lt of LOAN_TYPE_ORDER) blob[lt] = "";
  for (const r of polRes.data ?? []) blob[r.loan_type] = r.body ?? "";

  if (!assetRes.error && assetRes.data) {
    blob.commitmentPdf = assetRes.data.data_base64;
    blob.commitmentPdfName = assetRes.data.filename;
    blob.commitmentPdfCompressed = !!assetRes.data.is_compressed;
  }

  return blob;
}

// Persist the whole blob: upsert per-loan-type rows + manage the PDF asset.
export async function syncAllPolicies(blob) {
  if (!blob || typeof blob !== "object") return { ok: false, error: "missing blob" };

  try {
    const rows = LOAN_TYPE_ORDER.map((lt, idx) => ({
      loan_type: lt,
      body: typeof blob[lt] === "string" ? blob[lt] : "",
      sort_order: idx,
    }));
    const { error: upErr } = await supabase
      .from("policies")
      .upsert(rows, { onConflict: "loan_type" });
    if (upErr) throw upErr;

    if (blob.commitmentPdf && typeof blob.commitmentPdf === "string") {
      const { error: assetErr } = await supabase
        .from("policy_assets")
        .upsert(
          {
            slot: "commitment_pdf",
            filename: blob.commitmentPdfName ?? null,
            data_base64: blob.commitmentPdf,
            is_compressed: !!blob.commitmentPdfCompressed,
          },
          { onConflict: "slot" },
        );
      if (assetErr) throw assetErr;
    } else {
      const { error: delErr } = await supabase
        .from("policy_assets")
        .delete()
        .eq("slot", "commitment_pdf");
      if (delErr) throw delErr;
    }

    return { ok: true };
  } catch (err) {
    console.warn("[policiesApi.syncAllPolicies]", err);
    return { ok: false, error: err?.message || String(err) };
  }
}
