// checkoutFlow.js — the pure logic behind the equipment-CHECKOUT screen.
//
// The mirror image of returnFlow.js, and split out for the same reason: this is
// the second routine, high-frequency action that WRITES TO THE INVENTORY. It is
// also strictly more dangerous than the return, because it is the only screen
// that writes inventory AND edits the request in the same gesture — a bug in
// computeCheckoutItems silently shrinks what a student borrowed.
//
// DELIBERATELY DEPENDENCY-FREE, same contract as returnFlow.js / loanPolicy.js.
// scripts/run-checkout-flow-tests.mjs imports it under plain Node, and
// api/update-reservation-status.js imports validateCheckoutOutcomes on the
// server. It imports from returnFlow.js and NOTHING else — that module is
// dependency-free too, and the unit-status rules must not be forked. Pulling in
// src/utils.js would drag the Supabase client (import.meta.env, Vite-only).
//
// ── WHY "פעילה" IS SUDDENLY A REAL STATUS ──────────────────────────────────
// It never used to be written anywhere. getEffectiveStatus() derived it in the
// browser the moment borrow_date+borrow_time passed, so "the gear is out" was
// an opinion held by a clock. Now it is a fact recorded by a person, and
// issued_at is what records it. Everything in this module exists to make that
// one transition safe to retry.

import {
  UNIT_OK,
  UNIT_DAMAGED,
  UNIT_MISSING,
  unitLabel,
  applyUnitOutcomes,
} from "./returnFlow.js";

export { UNIT_OK, UNIT_DAMAGED, UNIT_MISSING, unitLabel };

// The two checkout-only verdicts.
//
// יוצא is the default and the overwhelming majority — it is the reason the
// panel exists, and like תקין on the return screen it is never stored.
//
// החזר is the one that makes this screen more than documentation: the student
// did not take this unit, so the quantity on reservation_items drops and the
// unit is instantly available to somebody else. It exists as its own state,
// rather than being inferred from "not יוצא", precisely because פגום/נעלם must
// NOT change quantities — see computeCheckoutItems.
export const UNIT_ISSUED   = "יוצא";
export const UNIT_RETURNED = "החזר";

// The four states the checkout panel offers.
export const CHECKOUT_OUTCOMES = [UNIT_ISSUED, UNIT_DAMAGED, UNIT_MISSING, UNIT_RETURNED];

// The three worth remembering. יוצא is absent for the same reason תקין is
// absent from RETURN_EXCEPTIONS: storing the default would destroy the property
// the archive depends on — "column is NULL ⇒ nothing unusual happened".
export const CHECKOUT_EXCEPTIONS = [UNIT_DAMAGED, UNIT_MISSING, UNIT_RETURNED];

export const CHECKOUT_OUTCOMES_VERSION = 1;

// Palette shared by the panel and the archive. CSS custom-property NAMES, not a
// stylesheet import — this module must stay runnable under plain Node.
// יוצא is green (this is the good outcome here, the way תקין is on the return
// screen) and החזר is blue: it is neither damage nor loss, just gear staying home.
export const CHECKOUT_COLOR = {
  [UNIT_ISSUED]: "var(--green)", [UNIT_DAMAGED]: "var(--red)",
  [UNIT_MISSING]: "#9b59b6", [UNIT_RETURNED]: "var(--blue)",
};
export const CHECKOUT_BG = {
  [UNIT_ISSUED]: "rgba(46,204,113,0.15)", [UNIT_DAMAGED]: "rgba(231,76,60,0.15)",
  [UNIT_MISSING]: "rgba(155,89,182,0.18)", [UNIT_RETURNED]: "rgba(52,152,219,0.15)",
};

// Caps for the server-side gate, identical to returnFlow's. The column ships to
// every staff client on every load via select("*").
const MAX_ITEMS = 200;
const MAX_UNITS_PER_ITEM = 200;
const MAX_UNITS_TOTAL = 500;
const MAX_FAULT = 400;

// Numeric where possible so #10 sorts after #9. Duplicated from returnFlow
// rather than exported from it because it is private there; four lines is a
// cheaper dependency than widening that module's surface.
function unitSortKey(unitId) {
  const s = String(unitId || "");
  const i = s.lastIndexOf("_");
  const n = Number(i === -1 ? s : s.slice(i + 1));
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

// ── which reservation items the panel asks about ────────────────────────────
//
// ⚠️ THE SEED IS original_items ?? items, NEVER items ALONE.
//
// This is archiveItems(r) verbatim, and it is what makes a retry safe. Once a
// checkout has decremented the list, `items` is the SHRUNK list. Re-seeding
// from it after a mid-flight failure would compute a new, smaller target and
// shrink it again — and again on the next attempt. original_items is stamped
// once, before the first decrement, and never overwritten (lesson #35+#44), so
// seeding from it makes every attempt produce byte-identical output.
export function checkoutSeedItems(reservation) {
  const frozen = reservation?.original_items;
  if (Array.isArray(frozen) && frozen.length) return frozen;
  return Array.isArray(reservation?.items) ? reservation.items : [];
}

// The units the panel will ask about for one borrowed line.
//
// Same rule as pickUnitsForReturn — only תקין units are candidates, sorted
// deterministically, and it NEVER invents a unit id (writeEquipmentToDB would
// then create rows for hardware that does not exist).
//
// `include` is the checkout-only addition, and it is not an optimisation. If
// attempt #1 marked unit #3 פגום and then failed at the status step, #3 is no
// longer תקין — so a fresh mount would offer #4 instead, and the operator would
// mark a SECOND healthy unit as broken. `include` forces already-recorded units
// back into the list so the retry asks about the same hardware.
export function pickUnitsForCheckout(eq, quantity, { include } = {}) {
  const units = Array.isArray(eq?.units) ? eq.units : [];
  const wanted = Math.max(0, Math.floor(Number(quantity) || 0));
  if (wanted === 0) return [];
  const forced = include instanceof Set ? include
    : new Set((Array.isArray(include) ? include : []).map(String));

  const pinned = units.filter(u => u && forced.has(String(u.id)));
  const healthy = units.filter(u => u && u.status === UNIT_OK && !forced.has(String(u.id)));
  return [...pinned, ...healthy]
    .sort((a, b) => unitSortKey(a.id) - unitSortKey(b.id))
    .slice(0, wanted);
}

// Apply the panel's decisions to the equipment array.
//
// `outcomes`: [{ equipmentId, unitId, status, fault? }]
//
// יוצא and החזר both leave the unit תקין — one is in a student's bag and the
// other never left the shelf, and equipment_units.status describes CONDITION,
// not location. What a loan ties up is derived from reservation_items, not from
// unit status, so marking issued units as anything else would double-count them.
//
// ⚠️ Returns the FULL equipment array, always — writeEquipmentToDB feeds
// sync_equipment_from_json, which delete+reinserts equipment_units, so a subset
// silently deletes every unit of every item left out (lesson #21).
export function applyCheckoutOutcomes(equipment, outcomes) {
  const mapped = (Array.isArray(outcomes) ? outcomes : []).map((o) => {
    if (!o || !CHECKOUT_OUTCOMES.includes(o.status)) return o;
    if (o.status === UNIT_DAMAGED || o.status === UNIT_MISSING) return o;
    return { ...o, status: UNIT_OK, fault: "" };
  });
  return applyUnitOutcomes(equipment, mapped);
}

// ── the item decrement ──────────────────────────────────────────────────────
//
// ⚠️ ABSOLUTE TARGET LIST, NEVER A DELTA.
//
// newQty is "how many units were marked יוצא", not "old quantity minus the
// ones marked החזר". save_edited_reservation_v1's p_items replaces the whole
// item set in one transaction, so an absolute list re-applied after a failure
// lands on exactly the same rows. A delta re-applied would subtract twice.
//
// Only החזר reduces. פגום and נעלם are recorded in the snapshot and pulled out
// of the available pool by their unit status, but the borrowed quantity stands:
// this screen documents condition, and changing what the student asked for is a
// separate, explicit act. That is the whole distinction החזר carries.
//
// An item whose target reaches 0 is DROPPED, never written as quantity 0 — the
// CHECK constraint forbids it and ~25 render sites break on it (lesson #35+#44).
//
// Lines with no outcomes at all (nothing was unfolded for them because the
// operator marked the card green) pass through untouched.
export function computeCheckoutItems(seedItems, outcomes) {
  const list = Array.isArray(seedItems) ? seedItems : [];
  const touched = new Map();          // equipmentId -> { issued, returned }
  for (const o of (Array.isArray(outcomes) ? outcomes : [])) {
    if (!o || !o.equipmentId || !o.unitId) continue;
    if (!CHECKOUT_OUTCOMES.includes(o.status)) continue;
    const key = String(o.equipmentId);
    if (!touched.has(key)) touched.set(key, { issued: 0, returned: 0 });
    const bucket = touched.get(key);
    if (o.status === UNIT_RETURNED) bucket.returned += 1;
    else bucket.issued += 1;          // יוצא, פגום and נעלם all stay on the request
  }
  if (touched.size === 0) return list;

  const out = [];
  for (const item of list) {
    const bucket = touched.get(String(item?.equipment_id));
    if (!bucket || bucket.returned === 0) { out.push(item); continue; }
    // Subtracted from the SEED, not from the live quantity — that is what makes
    // the result an absolute target and a retry idempotent. Floored at 0 so a
    // stock edit mid-loan (more החזר marks than the line ever had) drops the
    // line instead of writing a negative quantity.
    const seedQty = Math.max(0, Math.floor(Number(item?.quantity) || 0));
    const next = Math.max(0, seedQty - bucket.returned);
    if (next > 0) out.push({ ...item, quantity: next });
  }
  return out;
}

// Counts for the confirmation footer and the closing toast.
export function summarizeCheckout(outcomes) {
  const out = { issued: 0, damaged: 0, missing: 0, returned: 0, total: 0 };
  for (const o of (Array.isArray(outcomes) ? outcomes : [])) {
    if (!o || !CHECKOUT_OUTCOMES.includes(o.status)) continue;
    out.total += 1;
    if (o.status === UNIT_ISSUED) out.issued += 1;
    else if (o.status === UNIT_DAMAGED) out.damaged += 1;
    else if (o.status === UNIT_MISSING) out.missing += 1;
    else out.returned += 1;
  }
  return out;
}

// "יחידה אחת פגומה · 2 יחידות הוחזרו למלאי" — empty when the checkout was
// clean, so the caller can fall back to a plain success message.
export function describeCheckoutExceptions(summary) {
  const parts = [];
  if (summary?.damaged > 0) parts.push(summary.damaged === 1 ? "יחידה אחת פגומה" : `${summary.damaged} יחידות פגומות`);
  if (summary?.missing > 0) parts.push(summary.missing === 1 ? "יחידה אחת נעלמה" : `${summary.missing} יחידות נעלמו`);
  if (summary?.returned > 0) parts.push(summary.returned === 1 ? "יחידה אחת הוחזרה למלאי" : `${summary.returned} יחידות הוחזרו למלאי`);
  return parts.join(" · ");
}

// ── the frozen archive snapshot (reservations_new.checkout_outcomes) ────────
//
// Same contract as buildReturnOutcomesSnapshot: derived from `outcomes` ONLY,
// `equipment` consulted for the name and nothing else, `at` injected so the
// function is deterministic, and NULL rather than an empty envelope when
// nothing unusual happened.
export function buildCheckoutOutcomesSnapshot({ outcomes, equipment = [], at }) {
  const byEquipment = new Map();
  for (const o of (Array.isArray(outcomes) ? outcomes : [])) {
    if (!o || !o.equipmentId || !o.unitId) continue;
    if (!CHECKOUT_EXCEPTIONS.includes(o.status)) continue;
    const key = String(o.equipmentId);
    if (!byEquipment.has(key)) byEquipment.set(key, new Map());
    const entry = { unit_id: String(o.unitId), status: o.status };
    const fault = o.status === UNIT_DAMAGED ? String(o.fault || "").trim() : "";
    if (fault) entry.fault = fault;
    byEquipment.get(key).set(entry.unit_id, entry);
  }
  if (byEquipment.size === 0) return null;

  const nameById = new Map(
    (Array.isArray(equipment) ? equipment : []).map(e => [String(e?.id), String(e?.name || "")]),
  );
  const items = [];
  for (const [equipment_id, units] of byEquipment) {
    items.push({ equipment_id, name: nameById.get(equipment_id) || "", units: [...units.values()] });
  }
  return { v: CHECKOUT_OUTCOMES_VERSION, at: String(at || ""), items };
}

// reservation -> { at, byEquipment, totals } | null.
//
// The null branch is the hot one: every row that predates this feature, and
// every clean checkout forever. Anything unexpected reads as null rather than
// throwing — the archive must render regardless.
export function readCheckoutOutcomes(reservation) {
  const raw = reservation?.checkout_outcomes;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const items = Array.isArray(raw.items) ? raw.items : null;
  if (!items || items.length === 0) return null;

  const byEquipment = {};
  let damaged = 0, missing = 0, returned = 0;
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    // String-normalised: equipment_id arrives as a number on some rows.
    const key = String(it.equipment_id ?? "");
    if (!key) continue;
    for (const u of (Array.isArray(it.units) ? it.units : [])) {
      if (!u || typeof u !== "object") continue;
      const unitId = String(u.unit_id ?? "");
      if (!unitId) continue;
      if (!CHECKOUT_EXCEPTIONS.includes(u.status)) continue;
      if (!byEquipment[key]) byEquipment[key] = { damaged: [], missing: [], returned: [] };
      if (u.status === UNIT_DAMAGED) { byEquipment[key].damaged.push({ unitId, fault: String(u.fault || "") }); damaged += 1; }
      else if (u.status === UNIT_MISSING) { byEquipment[key].missing.push({ unitId }); missing += 1; }
      else { byEquipment[key].returned.push({ unitId }); returned += 1; }
    }
  }
  if (damaged + missing + returned === 0) return null;
  return { at: String(raw.at || ""), byEquipment, totals: { damaged, missing, returned } };
}

// Every unit id already recorded on this reservation, for pickUnitsForCheckout's
// `include`. This is what stops a retry from burning a second healthy unit.
export function recordedCheckoutUnitIds(reservation) {
  const read = readCheckoutOutcomes(reservation);
  const ids = new Set();
  if (!read) return ids;
  for (const key of Object.keys(read.byEquipment)) {
    const g = read.byEquipment[key];
    for (const u of [...g.damaged, ...g.missing, ...g.returned]) ids.add(u.unitId);
  }
  return ids;
}

// ── the state machine that picks which panel the warehouse sees ─────────────
//
// This is the whole reason issued_at exists as a column. "באיחור" now covers
// two situations that need opposite screens — gear that is out and late, and
// gear nobody ever came to collect — and status alone cannot tell them apart.
//
// The status==='פעילה' fallback in "issued" is deliberate belt-and-braces: the
// stamp and the status flip are two writes, and a row that somehow has the
// second without the first must never be offered a second checkout.
//
//   "issued"      → the return panel (the existing screen)
//   "half_issued" → the checkout panel in recovery mode: the stamp landed but
//                   the status RPC did not. Given a visible UI instead of
//                   vanishing, because the operator has to be able to finish —
//                   and re-running the whole panel is safe by construction (the
//                   unit writes are no-ops, the item target is absolute, and
//                   the stamp PATCH is filtered on issued_at=is.null).
//   "pending"     → the checkout panel
//   "none"        → neither; ordinary read-only display
//
// באיחור + a stamp resolves to "issued", NOT "half_issued". It is ambiguous in
// principle — it could be a half-written checkout that the overdue cron then
// moved on — but in practice it is overwhelmingly the ordinary case: gear was
// handed over and came back late. Showing the return panel is what the operator
// needs; the rare half-written row still closes correctly through it.
export function checkoutState(reservation) {
  // Lessons are generated from the timetable and never handed over at a
  // counter. The backfill in 20260813120000 excludes them in SQL for exactly
  // this reason ("stamping one would offer a checkout screen for a loan no
  // human is ever meant to process"); excluding them here is what stops the UI
  // contradicting the migration. Nothing is lost — a lesson is never פעילה, so
  // it never had a return panel either.
  if (reservation?.loan_type === "שיעור" || reservation?.lesson_auto) return "none";

  const issued = !!reservation?.issued_at;

  // ⚠️ WHAT ARRIVES HERE IS USUALLY THE DISPLAY LABEL, NOT THE RAW COLUMN.
  //
  // normalizeReservationsForArchive rewrites status with lateStatusFor() before
  // the row reaches any component (src/utils.js + the copy in App.jsx), so
  // "לא יצא?" is what this function actually sees for a request nobody
  // collected — the ONE request whose checkout window is still open. Reading it
  // as an unknown status returned "none", which took away the checkout panel
  // and even "עריכת בקשה", leaving 🗑 as the only action on the row the whole
  // feature exists to surface. (It also took away a "הוצא עכשיו" override that
  // has since been removed outright — it bypassed checkoutWindowOpen, and gear
  // released before borrow_date reads as available to every stock computation.)
  //
  // Folding the label back onto באיחור is safe by construction rather than by
  // convention: lateStatusFor only ever emits it when issued_at IS NULL, so it
  // lands on "pending". Should a stamp somehow exist, it lands on "issued" and
  // corrects itself. The recursion lateStatusFor → wasCheckedOut → checkoutState
  // stays stable for the same reason: "לא יצא?" + no stamp ⇒ "pending" ⇒ not
  // checked out ⇒ "לא יצא?" again.
  const raw = reservation?.status;
  const status = raw === STATUS_NOT_PICKED_UP ? STATUS_OVERDUE : raw;

  if (status === "פעילה") return "issued";
  if (issued && status === "באיחור") return "issued";
  if (issued && status === "מאושר") return "half_issued";
  if (!issued && (status === "מאושר" || status === "באיחור")) return "pending";
  return "none";
}

export function wasCheckedOut(reservation) {
  const s = checkoutState(reservation);
  return s === "issued" || s === "half_issued";
}

// ── the two faces of "past its return time" ─────────────────────────────────
//
// "באיחור" meant one thing while every approved request was ASSUMED to have been
// collected. Now that issued_at records the handover, a request whose return time
// has passed is one of two unrelated problems, and calling both of them "late"
// sent the warehouse looking for gear that was on the shelf all along:
//
//   gear went out and is late   → "באיחור"   — chase the student
//   nobody ever collected it    → "לא יצא?"  — the gear never left; ask why
//
// The discriminator is wasCheckedOut, deliberately the same one checkoutState
// uses. Forking that judgement would let the badge and the checkout panel
// disagree about the very same row.
//
// ⚠️ DISPLAY ONLY — NEITHER LABEL IS EVER WRITTEN TO reservations_new.
//
// The row stays מאושר/באיחור, and that raw value is what create_reservation_v2
// and update_reservation_status_v1 read. So every inventory calculation must
// treat "לא יצא?" EXACTLY as it treats "באיחור" (INVENTORY_BLOCKING_STATUSES and
// isOverdueLikeStatus in src/utils.js). Miss one and the browser offers stock
// that the DB then refuses with a bare 409 — the student sees "זמין", submits,
// and gets told there is no inventory.
export const STATUS_OVERDUE = "באיחור";
export const STATUS_NOT_PICKED_UP = "לא יצא?";

// Which label a reservation deserves once one of its deadlines has passed. The
// CALLER owns the "has it passed" test — that needs toDateTime from
// src/utils.js, which would drag the Supabase client in here (lesson #40).
export function lateStatusFor(reservation) {
  return wasCheckedOut(reservation) ? STATUS_OVERDUE : STATUS_NOT_PICKED_UP;
}

// ── "לא יצא?" fires at the PICKUP time, not the return time ─────────────────
//
// The label exists to tell the warehouse that nobody ran the checkout screen.
// It used to be derived from the RETURN deadline, because it shared its trigger
// with "באיחור" and only issued_at told them apart. So a loan due out at 18:00
// and back at 23:30 stayed plain "מאושר" until 23:30 — the alert arrived five
// and a half hours after it was useful, and on a week-long loan, a week late.
//
// Now the two triggers are separate:
//
//   pickup + grace, never collected → "לא יצא?"  — nobody pressed הוצא
//   return deadline, gear went out  → "באיחור"   — chase the student
//
// The grace window is the operator's, not the student's: it is there so the
// badge does not appear while the warehouse is mid-handover.
export const DEFAULT_NOT_PICKED_UP_GRACE_MIN = 30;
export const MAX_NOT_PICKED_UP_GRACE_MIN = 240;

// ⚠️ MODULE-LEVEL ON PURPOSE — the one value every surface reads.
//
// getEffectiveStatus is called from roughly ten places (the dashboard tile and
// its calendar chip, isReallyOverdue, the PDF export, stretchOverdueForCalendar,
// the follow-up panel, and BOTH copies of normalizeReservationsForArchive), and
// none of them has siteSettings in scope. Threading the grace through as a
// parameter would mean one forgotten call site showing a different label from
// the rest of the same screen — which is lesson #19 exactly. A single value read
// by everyone is what makes them agree.
//
// App.jsx writes it imperatively BEFORE each setSiteSettings, so the render that
// state update triggers already normalises with the admin's number.
let notPickedUpGraceMs = DEFAULT_NOT_PICKED_UP_GRACE_MIN * 60000;

export function setNotPickedUpGraceMinutes(minutes) {
  const n = Number(minutes);
  const safe = Number.isFinite(n)
    ? Math.min(MAX_NOT_PICKED_UP_GRACE_MIN, Math.max(0, n))
    : DEFAULT_NOT_PICKED_UP_GRACE_MIN;
  notPickedUpGraceMs = safe * 60000;
  return safe;
}

export function getNotPickedUpGraceMs() {
  return notPickedUpGraceMs;
}

// Has the pickup moment plus the grace window passed?
//
// Says nothing about whether the gear went out — the caller pairs this with
// wasCheckedOut. borrowTs is injected as a number for the same reason
// checkoutWindowOpen injects it: toDateTime lives in src/utils.js.
export function pickupOverdue({ borrowTs, nowMs, graceMs } = {}) {
  if (!Number.isFinite(borrowTs) || borrowTs <= 0) return false;
  if (!Number.isFinite(nowMs)) return false;
  const grace = Number.isFinite(graceMs) ? Math.max(0, graceMs) : notPickedUpGraceMs;
  return nowMs - borrowTs >= grace;
}

// Is the checkout screen due to appear on its own?
//
// ⚠️ NO LOWER BOUND. Once the window opens it never closes — a student who
// turns up two days late must still be servable, and the request stays 'מאושר'
// until somebody actually hands the gear over. The only thing that closes this
// screen is issued_at, which is why the caller checks checkoutState first.
//
// borrowTs is injected as a number rather than computed here: toDateTime lives
// in src/utils.js, which drags the Supabase client and would break the Node
// test runner and the server import (lesson #40).
export function checkoutWindowOpen({ status, borrowTs } = {}, { nowMs, leadMs } = {}) {
  // STATUS_NOT_PICKED_UP for the same reason checkoutState folds it onto
  // באיחור: callers pass reservation.status, which the archive normalizer has
  // already replaced with the display label. Omitting it here kept the window
  // shut on the exact request that still needs it.
  if (status !== "מאושר" && status !== "באיחור" && status !== STATUS_NOT_PICKED_UP) return false;
  if (!Number.isFinite(borrowTs) || borrowTs <= 0) return false;
  if (!Number.isFinite(nowMs)) return false;
  const lead = Number.isFinite(leadMs) ? Math.max(0, leadMs) : 0;
  return borrowTs - nowMs <= lead;
}

// ── server-side gate for /api/update-reservation-status ─────────────────────
//
// Rebuilds the snapshot key by key rather than trusting the client's object, so
// nothing extra rides along into the row, and clamps every dimension.
export function validateCheckoutOutcomes(raw) {
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
      if (!CHECKOUT_EXCEPTIONS.includes(u.status)) continue;
      total += 1;
      if (total > MAX_UNITS_TOTAL) return null;
      const entry = { unit_id, status: u.status };
      // Truncated, never rejected: a checkout must not fail because somebody
      // typed an essay into the fault box.
      const fault = u.status === UNIT_DAMAGED ? String(u.fault || "").trim().slice(0, MAX_FAULT) : "";
      if (fault) entry.fault = fault;
      clean.push(entry);
    }
    if (clean.length) out.push({ equipment_id, name: String(it.name || ""), units: clean });
  }
  if (out.length === 0) return null;
  return { v: CHECKOUT_OUTCOMES_VERSION, at: typeof raw.at === "string" ? raw.at : "", items: out };
}
