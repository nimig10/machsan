import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// rows (sorted by sort_order) → { categories: string[], categoryTypes: {} }
function rowsToBlobs(rows) {
  const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order);
  return {
    categories: sorted.map((r) => r.name),
    categoryTypes: Object.fromEntries(sorted.map((r) => [r.name, r.equipment_type])),
  };
}

export async function loadCategoriesFromTable() {
  const { data, error } = await supabase
    .from("categories")
    .select("name, equipment_type, sort_order")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return rowsToBlobs(data ?? []);
}

// Upsert all rows, then delete any names no longer present.
export async function syncAllCategories(categories, categoryTypes) {
  const rows = categories.map((name, idx) => ({
    name,
    equipment_type: categoryTypes?.[name] ?? "",
    sort_order: idx,
  }));

  if (rows.length > 0) {
    const { error: upsertErr } = await supabase
      .from("categories")
      .upsert(rows, { onConflict: "name" });
    if (upsertErr) throw upsertErr;
  }

  const { error: delErr } = await supabase
    .from("categories")
    .delete()
    .not("name", "in", `(${rows.map((r) => `"${r.name}"`).join(",")})`);
  if (delErr) throw delErr;
}

export async function loadLoanTypeFiltersFromTable() {
  const { data, error } = await supabase
    .from("loan_type_filters")
    .select("loan_type, allowed_types");
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.loan_type, r.allowed_types]));
}

// Upsert all rows, then delete any loan_types no longer present.
export async function syncLoanTypeFilters(categoryLoanTypes) {
  const rows = Object.entries(categoryLoanTypes).map(([loan_type, allowed_types]) => ({
    loan_type,
    allowed_types,
  }));

  if (rows.length > 0) {
    const { error: upsertErr } = await supabase
      .from("loan_type_filters")
      .upsert(rows, { onConflict: "loan_type" });
    if (upsertErr) throw upsertErr;
  }

  const keys = Object.keys(categoryLoanTypes);
  if (keys.length > 0) {
    const { error: delErr } = await supabase
      .from("loan_type_filters")
      .delete()
      .not("loan_type", "in", `(${keys.map((k) => `"${k}"`).join(",")})`);
    if (delErr) throw delErr;
  } else {
    const { error: delErr } = await supabase
      .from("loan_type_filters")
      .delete()
      .neq("loan_type", "");
    if (delErr) throw delErr;
  }
}
