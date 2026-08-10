// returnFlow.js — the pure logic behind the equipment-return screen.
//
// Split out of the UI for one reason: this is the only place in the app where a
// routine, high-frequency action WRITES TO THE INVENTORY. A warehouse worker
// closing a loan can now mark a unit damaged or missing, and a bug here silently
// corrupts stock levels for every future request. So the rules live here, with
// no imports, and scripts/run-return-flow-tests.mjs pins them.
//
// DELIBERATELY DEPENDENCY-FREE — same contract as loanPolicy.js /
// announcementPolicy.js. The test runner imports it under plain Node; pulling in
// src/utils.js would drag the Supabase client (import.meta.env, Vite-only) with it.
//
// ── Why units are PICKED rather than looked up ──────────────────────────────
// reservation_items records a quantity, never which physical units went out
// (`unit_id` exists on the table but is NULL for all ~1,600 rows in prod). So a
// "כבל XLR ×6" coming back out of 25 in stock cannot be resolved to six specific
// cables. pickUnitsForReturn therefore selects `quantity` units that are
// currently תקין, deterministically. The unit numbers shown are an indication;
// what has to come out right is the STOCK COUNT, and it does — availability is
// workingUnits() = units with status תקין.

export const UNIT_OK      = "תקין";
export const UNIT_DAMAGED = "פגום";
export const UNIT_MISSING = "נעלם";

// The three states the return panel offers. "בתיקון" is deliberately absent —
// it describes what happens to a unit AFTER it is taken in, and belongs to the
// "ציוד בדיקה" screen, not to the moment of handover.
export const RETURN_OUTCOMES = [UNIT_OK, UNIT_DAMAGED, UNIT_MISSING];

// Unit ids are `<equipment_id>_<n>`, and equipment ids may themselves contain a
// dot ("1774106383093.9417_2") — so split on the LAST underscore, not the first.
export function unitNumber(unitId) {
  const s = String(unitId || "");
  const i = s.lastIndexOf("_");
  return i === -1 ? s : s.slice(i + 1);
}

export function unitLabel(unitId) {
  const n = unitNumber(unitId);
  return n ? `#${n}` : "#—";
}

// Numeric where possible so #10 sorts after #9, not between #1 and #2.
function unitSortKey(unitId) {
  const n = Number(unitNumber(unitId));
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

// The units the panel will ask about for one borrowed line.
//
// Only תקין units are candidates: a unit already marked damaged/missing is not
// in circulation, so it cannot be the one coming back. If fewer healthy units
// exist than were borrowed (stock edited mid-loan), return what there is —
// never invent unit ids, because writeEquipmentToDB would then create rows for
// hardware that does not exist.
export function pickUnitsForReturn(eq, quantity) {
  const units = Array.isArray(eq?.units) ? eq.units : [];
  const wanted = Math.max(0, Math.floor(Number(quantity) || 0));
  if (wanted === 0) return [];
  return units
    .filter(u => u && u.status === UNIT_OK)
    .sort((a, b) => unitSortKey(a.id) - unitSortKey(b.id))
    .slice(0, wanted);
}

// Apply the panel's decisions to the equipment array.
//
// `outcomes`: [{ equipmentId, unitId, status, fault? }]
//
// ⚠️ Returns the FULL equipment array, always. writeEquipmentToDB feeds
// sync_equipment_from_json, which does a delete+reinsert of equipment_units —
// handing it a subset silently deletes every unit of every item left out
// (lesson #21). Untouched items come back by reference so React can skip them.
//
// Never adds or removes a unit: the array length of every item is preserved.
export function applyUnitOutcomes(equipment, outcomes) {
  const list = Array.isArray(equipment) ? equipment : [];
  const byEquipment = new Map();
  for (const o of (Array.isArray(outcomes) ? outcomes : [])) {
    if (!o || !o.equipmentId || !o.unitId) continue;
    if (!RETURN_OUTCOMES.includes(o.status)) continue;
    const key = String(o.equipmentId);
    if (!byEquipment.has(key)) byEquipment.set(key, new Map());
    byEquipment.get(key).set(String(o.unitId), o);
  }
  if (byEquipment.size === 0) return list;

  return list.map((eq) => {
    const patch = byEquipment.get(String(eq?.id));
    if (!patch || !Array.isArray(eq.units)) return eq;
    let changed = false;
    const units = eq.units.map((u) => {
      const o = patch.get(String(u?.id));
      if (!o) return u;
      // A unit that came back fine and was already fine is a no-op — keep the
      // same object so the write carries no spurious diff.
      const fault = o.status === UNIT_DAMAGED ? String(o.fault || "").trim() : "";
      if (u.status === o.status && String(u.fault || "") === fault) return u;
      changed = true;
      // fault is meaningful only for פגום; a unit going back to תקין or marked
      // נעלם carries no fault text.
      return { ...u, status: o.status, fault };
    });
    return changed ? { ...eq, units } : eq;
  });
}

// Counts for the confirmation header and the closing toast.
export function summarizeOutcomes(outcomes) {
  const out = { ok: 0, damaged: 0, missing: 0, total: 0 };
  for (const o of (Array.isArray(outcomes) ? outcomes : [])) {
    if (!o || !RETURN_OUTCOMES.includes(o.status)) continue;
    out.total += 1;
    if (o.status === UNIT_OK) out.ok += 1;
    else if (o.status === UNIT_DAMAGED) out.damaged += 1;
    else if (o.status === UNIT_MISSING) out.missing += 1;
  }
  return out;
}

// "3 פגומות · 1 נעלמת" — empty string when everything came back fine, so the
// caller can fall back to a plain success message.
export function describeExceptions(summary) {
  const parts = [];
  if (summary?.damaged > 0) parts.push(summary.damaged === 1 ? "יחידה אחת פגומה" : `${summary.damaged} יחידות פגומות`);
  if (summary?.missing > 0) parts.push(summary.missing === 1 ? "יחידה אחת נעלמה" : `${summary.missing} יחידות נעלמו`);
  return parts.join(" · ");
}
