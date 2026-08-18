// markDraft.js — the operator's in-progress marks on the checkout and return
// screens, and the rules for restoring them safely.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
// Both panels used to keep every mark in two local useState hooks, and both are
// rendered conditionally inside their host modal. Closing the request view —
// including by clicking the backdrop, which is one stray click — unmounted the
// panel and React destroyed the work. An operator who had marked eight of ten
// cards and glanced at something else came back to "סומנו 0 מתוך 10".
//
// The marks now live in a module-level store (src/hooks/useWarehouseMarks.js);
// this file holds every DECISION that store needs, with no React and no imports
// at all, so scripts/run-checkout-flow-tests.mjs and run-return-flow-tests.mjs
// can pin it under plain Node. Same contract as returnFlow.js / loanPolicy.js
// (lesson #40): pulling in src/utils.js would drag the Supabase client.
//
// ── WHAT IS STORED, AND WHAT IS NOT ─────────────────────────────────────────
// ONLY the operator's marks. Never a derived outcomes array, never a delta.
// The outcomes the DB sees are still computed at confirm time from live props
// against an absolute target list seeded from `original_items ?? items`, which
// is what makes a retry land on identical rows (checkoutApi.js:38-47, and
// "ABSOLUTE TARGET LIST, NEVER A DELTA" in checkoutFlow.js). Persisting a
// derived value would quietly reintroduce the double-decrement that whole
// design exists to prevent.

export const FLOW_CHECKOUT = "checkout";
export const FLOW_RETURN = "return";

// ⚠️ FROZEN SINGLETON — DO NOT REPLACE WITH A FRESH `{}`.
//
// useSyncExternalStore calls getSnapshot on every render and compares by
// identity. Handing it a new object for "this reservation has no marks" makes
// React declare the store changed every time and throw "The result of
// getSnapshot should be cached". One shared frozen value is the whole fix.
export const EMPTY_DRAFT = Object.freeze({
  green: Object.freeze({}),
  verdicts: Object.freeze({}),
});

// The draft shape, for reference:
//   { green:    { [markKey]: { qty } }
//     verdicts: { [`${markKey}|${unitId}`]: { status, fault } } }
//
// Presence in `green` means "this whole line goes out / came back fine". `qty`
// is stored alongside because the mark is only meaningful for the quantity it
// was made against — see visibleGreenKeys.

// Drafts are always REPLACED, never mutated in place — the other half of the
// useSyncExternalStore contract. Collapsing back to EMPTY_DRAFT when nothing is
// left keeps that identity stable for the common case.
function freezeDraft(green, verdicts) {
  if (!Object.keys(green).length && !Object.keys(verdicts).length) return EMPTY_DRAFT;
  return Object.freeze({ green: Object.freeze(green), verdicts: Object.freeze(verdicts) });
}

// One bucket per (flow, reservation).
//
// ⚠️ String() ON BOTH SIDES IS LOAD BEARING. Reservation ids are String(Date.now())
// when created in the browser but bigint in the schema, so the same request
// arrives as "1776079954421" from one caller and 1776079954421 from another —
// and the success handlers that CLEAR a draft are exactly the callers holding
// the numeric one. Without the coercion a completed checkout would leave its
// marks behind for the next operator to inherit.
//
// The flow prefix is not cosmetic either: one reservation legitimately moves
// from the checkout panel to the return panel over its life (checkoutFlow.js's
// checkoutState), and its checkout marks must never surface on the return screen.
export function draftKey(flow, reservationId) {
  return `${flow}:${String(reservationId ?? "")}`;
}

// ── the stable identity a mark hangs on ─────────────────────────────────────
//
// ⚠️ NEVER KEY A MARK BY ARRAY POSITION.
//
// That is what the old greenKeys did (`String(entry.index)`), and it was safe
// only because the marks died with the component. Now that they outlive it, the
// position is a trap: not one of the ~20 `reservation_items(*)` selects in this
// repo carries an ORDER BY, so PostgREST is free to return the nested rows in a
// different order on the next fetch — and a mark keyed by position would then
// attach to a DIFFERENT PIECE OF EQUIPMENT. The operator would see a card they
// never marked reported as "going out in full".
//
// equipment_id is the only stable identity on the row. `id` is not: it is a
// bigserial that save_edited_reservation_v1 deletes and reinserts on every edit.
//
// The `#occurrence` suffix handles the duplicate case. There is no UNIQUE on
// (reservation_id, equipment_id), and create_reservation_v2 groups only for its
// availability guard before inserting one row per input element, so two lines of
// the same equipment are structurally producible. Without the suffix they would
// share a key and a mark on one would light up the other.
//
// `@index` is the last resort for a row whose equipment_id is NULL — reachable,
// because the FK is ON DELETE SET NULL. Such a line is inert everywhere
// downstream (no eq to resolve, no units to pick, skipped by computeCheckoutItems),
// so best-effort position keying costs nothing there.
export function markKeysFor(items) {
  const seen = new Map();
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const eqId = String(item?.equipment_id ?? "");
    if (!eqId) return `@${index}`;
    const n = seen.get(eqId) || 0;
    seen.set(eqId, n + 1);
    return `${eqId}#${n}`;
  });
}

// ── restoring stage 1: which saved marks are still true ─────────────────────
//
// Validation happens HERE, at render time, against the live list — never by
// seeding a useState initializer from the store. An initializer runs once and
// freezes, and both hosts feed this panel asynchronously with different
// freshness (DashboardPage's row is a click-time snapshot it never re-syncs;
// ReservationsPage re-syncs its row on every reservations change). Seeding would
// be lesson #42 all over again.
//
// Two ways a saved mark stops being true:
//   • its key is gone from the live list — another operator removed the item, or
//     an approved student update did.
//   • the quantity moved. A green mark asserts "all N of this line go out"; for
//     a different N the operator never said that, and silently applying it to
//     the new number is how gear leaves the building uncounted.
//
// The store is deliberately NOT pruned here — writing to it during render is a
// side effect. The consequence is intentional and harmless: put the quantity
// back and the mark returns, because that quantity WAS affirmed.
export function visibleGreenKeys(draft, lines) {
  const out = new Set();
  const green = draft?.green;
  if (!green) return out;
  for (const line of Array.isArray(lines) ? lines : []) {
    const key = line?.key;
    if (!key) continue;
    const mark = green[key];
    if (!mark) continue;
    if (Number(mark.qty) !== Number(line.qty)) continue;
    out.add(key);
  }
  return out;
}

// How many saved marks visibleGreenKeys just refused. The panel shows this, so
// a drop the operator did not cause is visible rather than looking like the very
// bug this module fixes.
export function countDroppedGreen(draft, lines) {
  const green = draft?.green;
  if (!green) return 0;
  const total = Object.keys(green).length;
  if (!total) return 0;
  return total - visibleGreenKeys(draft, lines).size;
}

// ── restoring stage 2: the per-unit verdicts ────────────────────────────────
//
// The detail overlay used to rebuild its rows from scratch every time it opened,
// which is why pressing "סגור" threw away every verdict and every character of
// typed fault text. It now merges saved verdicts onto a freshly rebuilt list.
//
// ⚠️ MAPPING OVER THE REBUILT LIST *IS* THE PRUNING — there is no pruning code.
// A unit the picker no longer offers (another screen marked it פגום, so it is no
// longer a candidate) simply has no row to merge onto and disappears. That is
// why pickUnitsForReturn keeps its two-argument signature and returnFlow.js is
// not touched: a return must not offer a unit that is out of circulation.
//
// defaultStatus / damagedStatus / allowed are INJECTED rather than imported.
// UNIT_ISSUED lives in checkoutFlow.js and UNIT_OK in returnFlow.js; importing
// either here would fork the vocabulary and break the zero-import contract.
// `allowed` is belt-and-braces on top of the per-flow key namespace: a verdict
// that is not legal for this screen falls back to the default rather than
// rendering a status the panel has no button for.
export function mergeUnitVerdicts(draft, markKey, units, options) {
  const { defaultStatus, damagedStatus, allowed } = options || {};
  const verdicts = draft?.verdicts || {};
  const legal = Array.isArray(allowed) ? allowed : null;
  return (Array.isArray(units) ? units : []).map((u) => {
    const id = String(u?.id ?? "");
    const saved = verdicts[`${markKey}|${id}`];
    const status = saved && (!legal || legal.includes(saved.status)) ? saved.status : defaultStatus;
    // Fault text belongs to "פגום" and nothing else — mirrors the panel's own
    // patchUnit, which clears it whenever the status moves off damaged.
    return { id, status, fault: status === damagedStatus ? String(saved?.fault || "") : "" };
  });
}

// ── writers ─────────────────────────────────────────────────────────────────

export function withGreen(draft, markKey, on, qty) {
  if (!markKey) return draft || EMPTY_DRAFT;
  const base = draft || EMPTY_DRAFT;
  const green = { ...base.green };
  if (on) green[markKey] = { qty: Number(qty) || 0 };
  else delete green[markKey];
  return freezeDraft(green, { ...base.verdicts });
}

export function withVerdict(draft, markKey, unitId, patch) {
  if (!markKey || !unitId) return draft || EMPTY_DRAFT;
  const base = draft || EMPTY_DRAFT;
  const key = `${markKey}|${String(unitId)}`;
  const verdicts = { ...base.verdicts };
  // Merged, not replaced: the panel patches `{status}` and `{fault}` from two
  // different controls and each must leave the other alone.
  verdicts[key] = { ...(verdicts[key] || {}), ...(patch || {}) };
  return freezeDraft({ ...base.green }, verdicts);
}

// Drives the "נקה סימונים" button. That button is not a nicety: closing the
// modal used to BE the way to abandon a half-marked request, and persisting the
// marks takes that escape hatch away.
export function hasAnyMarks(draft) {
  if (!draft) return false;
  return Object.keys(draft.green || {}).length > 0 || Object.keys(draft.verdicts || {}).length > 0;
}
