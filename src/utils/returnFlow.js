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

// The two outcomes that are worth remembering. תקין is deliberately absent:
// it is the default, it is 95% of every return, and storing it would destroy
// the property the archive depends on — "column is NULL ⇒ nothing went wrong".
export const RETURN_EXCEPTIONS = [UNIT_DAMAGED, UNIT_MISSING];

// Version tag on the stored snapshot. original_items has none and that is a
// small regret; do not repeat it.
export const RETURN_OUTCOMES_VERSION = 1;

// Palette shared by the return panel and the archive so a "פגום" chip is the
// same colour wherever it appears. Values are CSS custom-property NAMES, not a
// stylesheet import — this module must stay runnable under plain Node.
//
// ⚠️ תקין IS BLUE, NOT GREEN, and that is the one rule the two warehouse screens
// hang on: BLUE MEANS THE GEAR IS AT THE WAREHOUSE, GREEN MEANS IT IS OUT.
// The checkout panel is green (יוצא) with a blue החזר for the unit that never
// leaves; the return panel is blue throughout, matching its own button and the
// archive's "🔵 הוחזר". The two flows are nearly identical in shape — same
// cards, same tap-to-mark, same per-unit overlay — so colour is the only thing
// telling an operator at a glance which one they are standing in. It was green
// on both, and they were mistaken for each other.
//
// UNIT_OK never reaches the archive (תקין is never stored — lesson #48), so this
// entry is read by the panel alone; פגום/נעלם are the shared ones.
export const OUTCOME_COLOR = {
  [UNIT_OK]: "var(--blue)", [UNIT_DAMAGED]: "var(--red)", [UNIT_MISSING]: "#9b59b6",
};
export const OUTCOME_BG = {
  [UNIT_OK]: "rgba(52,152,219,0.15)", [UNIT_DAMAGED]: "rgba(231,76,60,0.15)", [UNIT_MISSING]: "rgba(155,89,182,0.18)",
};

// Caps for the server-side gate. The column ships to every staff client on
// every load via select("*"), so a buggy client must not be able to park
// megabytes on a hot read path. 400 chars for a fault mirrors equipment_report.
const MAX_ITEMS = 200;
const MAX_UNITS_PER_ITEM = 200;
const MAX_UNITS_TOTAL = 500;
const MAX_FAULT = 400;

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

// ── the frozen archive snapshot (reservations_new.return_outcomes) ──────────
//
// equipment_units.status answers "what condition is this cable in RIGHT NOW".
// The archive needs a different question answered: "what did the warehouse
// record when this loan came back" — and the two diverge the moment the cable
// is repaired (פגום → בתיקון → תקין on the ציוד בדיקה screen). So the verdicts
// are frozen here at handover and never touched again.
//
// ⚠️ Derived from `outcomes` ONLY. `equipment` is consulted for the item's name
// and nothing else. Deriving the statuses by diffing the equipment array would
// be wrong twice: it goes stale, and it would silently rewrite history.

// outcomes -> snapshot | null.  `at` is injected rather than read from the
// clock so the function is deterministic and testable.
export function buildReturnOutcomesSnapshot({ outcomes, equipment = [], at }) {
  const byEquipment = new Map();
  for (const o of (Array.isArray(outcomes) ? outcomes : [])) {
    if (!o || !o.equipmentId || !o.unitId) continue;
    if (!RETURN_EXCEPTIONS.includes(o.status)) continue;
    const key = String(o.equipmentId);
    if (!byEquipment.has(key)) byEquipment.set(key, new Map());
    const entry = { unit_id: String(o.unitId), status: o.status };
    // fault belongs to פגום alone, and an empty one omits the KEY rather than
    // storing "" — mirrors applyUnitOutcomes.
    const fault = o.status === UNIT_DAMAGED ? String(o.fault || "").trim() : "";
    if (fault) entry.fault = fault;
    byEquipment.get(key).set(entry.unit_id, entry);
  }
  // Nothing went wrong ⇒ NULL, not an empty envelope. The entire archive
  // display is gated on this, so a clean return stays byte-identical to every
  // row written before the feature existed.
  if (byEquipment.size === 0) return null;

  const nameById = new Map(
    (Array.isArray(equipment) ? equipment : []).map(e => [String(e?.id), String(e?.name || "")]),
  );
  const items = [];
  for (const [equipment_id, units] of byEquipment) {
    items.push({
      equipment_id,
      // Snapshotted: equipment can be renamed or deleted after the fact.
      name: nameById.get(equipment_id) || "",
      units: [...units.values()],
    });
  }
  return { v: RETURN_OUTCOMES_VERSION, at: String(at || ""), items };
}

// reservation -> { at, byEquipment, totals } | null.
//
// The null branch is the hot one: every archived loan predating this feature,
// and every clean return forever, lands here. Anything unexpected reads as
// null rather than throwing — the archive must render regardless.
export function readReturnOutcomes(reservation) {
  const raw = reservation?.return_outcomes;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const items = Array.isArray(raw.items) ? raw.items : null;
  if (!items || items.length === 0) return null;

  const byEquipment = {};
  let damaged = 0;
  let missing = 0;
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    // String-normalised: item.equipment_id arrives as a number on some rows.
    const key = String(it.equipment_id ?? "");
    if (!key) continue;
    for (const u of (Array.isArray(it.units) ? it.units : [])) {
      if (!u || typeof u !== "object") continue;
      const unitId = String(u.unit_id ?? "");
      // No id ⇒ drop it, rather than rendering a meaningless "#—" chip.
      if (!unitId) continue;
      if (!RETURN_EXCEPTIONS.includes(u.status)) continue;
      if (!byEquipment[key]) byEquipment[key] = { damaged: [], missing: [] };
      if (u.status === UNIT_DAMAGED) {
        byEquipment[key].damaged.push({ unitId, fault: String(u.fault || "") });
        damaged += 1;
      } else {
        byEquipment[key].missing.push({ unitId });
        missing += 1;
      }
    }
  }
  if (damaged + missing === 0) return null;
  return { at: String(raw.at || ""), byEquipment, totals: { damaged, missing } };
}

// { damaged, missing } | null — feed straight to describeExceptions so the
// collapsed archive card and the closing toast can never word it differently.
export function returnExceptionSummary(reservation) {
  const read = readReturnOutcomes(reservation);
  return read ? { damaged: read.totals.damaged, missing: read.totals.missing } : null;
}

// The reverse lookup, for the "ציוד בדיקה" screen: given a unit, which loan was
// it marked in? Latest wins — a unit can be repaired and broken again.
//
// ⚠️ Answers "where was this unit NUMBER recorded", not "which physical cable
// broke": reservation_items.unit_id is never populated, so the return screen
// offers lowest-numbered healthy units. Never aggregate this for statistics.
export function findUnitReturnRecord(unitId, reservations) {
  const target = String(unitId || "");
  if (!target) return null;
  let best = null;
  for (const r of (Array.isArray(reservations) ? reservations : [])) {
    const read = readReturnOutcomes(r);
    if (!read) continue;
    for (const key of Object.keys(read.byEquipment)) {
      const group = read.byEquipment[key];
      const hitDamaged = group.damaged.find(u => u.unitId === target);
      const hitMissing = hitDamaged ? null : group.missing.find(u => u.unitId === target);
      if (!hitDamaged && !hitMissing) continue;
      const record = {
        reservationId: String(r?.id ?? ""),
        studentName: String(r?.student_name || ""),
        at: read.at,
        status: hitDamaged ? UNIT_DAMAGED : UNIT_MISSING,
        fault: hitDamaged ? hitDamaged.fault : "",
      };
      // ISO-8601 sorts lexicographically the same way it sorts chronologically.
      if (!best || String(record.at) > String(best.at)) best = record;
    }
  }
  return best;
}

// Server-side gate for /api/update-reservation-status. Rebuilds the snapshot
// key by key rather than trusting the client's object, so nothing extra can
// ride along into the row, and clamps every dimension.
export function validateReturnOutcomes(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const items = Array.isArray(raw.items) ? raw.items : null;
  if (!items || items.length === 0 || items.length > MAX_ITEMS) return null;

  const out = [];
  let total = 0;
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const equipment_id = String(it.equipment_id ?? "");
    if (!equipment_id) continue;
    const units = Array.isArray(it.units) ? it.units : [];
    if (units.length > MAX_UNITS_PER_ITEM) return null;
    const clean = [];
    for (const u of units) {
      if (!u || typeof u !== "object") continue;
      const unit_id = String(u.unit_id ?? "");
      if (!unit_id) continue;
      if (!RETURN_EXCEPTIONS.includes(u.status)) continue;
      total += 1;
      if (total > MAX_UNITS_TOTAL) return null;
      const entry = { unit_id, status: u.status };
      // Truncated, never rejected: a return must not fail because somebody
      // typed an essay into the fault box.
      const fault = u.status === UNIT_DAMAGED ? String(u.fault || "").trim().slice(0, MAX_FAULT) : "";
      if (fault) entry.fault = fault;
      clean.push(entry);
    }
    if (clean.length) out.push({ equipment_id, name: String(it.name || ""), units: clean });
  }
  // Everything was dropped (e.g. a client sending only תקין) ⇒ nothing to store.
  if (out.length === 0) return null;
  return { v: RETURN_OUTCOMES_VERSION, at: typeof raw.at === "string" ? raw.at : "", items: out };
}
