// productionVisibility.js — board-visibility gate for production date ranges.
//
// Product rule (PR 2026-07): a shoot date range "joins the board" only after
// the director submitted an equipment list (reservation) for it. Ranges
// without a list stay fully visible to the director (and to staff/dept-head
// mounts) with warnings + submit prompts, but are hidden from other students'
// board — cards, calendar bars and the monthly filter.
//
// The gate is UNIFORM — every production runs it, regardless of when it was
// created. It used to be exempted per-production for anything predating the
// cutoff below, but that exemption also covered ranges ADDED LATER to such a
// production: a range created in August on a May production rendered neither
// the submit button nor the warning, because the editor gates both on
// `!dateLocked && !isLegacy` and such a range is neither. A student hit exactly
// that and had no way to submit an equipment list at all.

// Merge/deploy date of PR #75. Its ONLY remaining job is to scope AUTO-DELETION
// (see isRangeAutoPrunable) — it no longer affects what anyone can see or do.
export const LEGACY_PRODUCTION_CUTOFF_ISO = "2026-07-14";

// May this range be deleted automatically when the editor closes without an
// equipment list? Only if it was created under the rule in the first place.
//
// The asymmetry is deliberate: HIDING IS REVERSIBLE, DELETING IS NOT. A range
// hidden from the board returns the moment a list is submitted; a pruned range
// is gone. handleEditorClose prunes through upsertProduction's delete-missing
// diff with no confirmation dialog, so applying it retroactively would have
// destroyed a real future shoot on a pre-cutoff production just by opening and
// closing the editor. A missing timestamp means "don't delete" — the safe
// default, and the same direction the old legacy check erred in.
export function isRangeAutoPrunable(d) {
  const created = String(d?.createdAt || "");
  return !!created && created >= LEGACY_PRODUCTION_CUTOFF_ISO;
}

// Set of production_date ids that already have an active (non-cancelled)
// equipment-list reservation attached. Single source of truth — replaces the
// inline copies that used to live in ProductionsPage/ProductionDetail/Editor.
export function submittedDateIds(p, reservations) {
  const ids = new Set();
  for (const r of (reservations || [])) {
    if (!p || r.production_id !== p.id) continue;
    if (r.status === "בוטל") continue;
    if (r.production_date_id) ids.add(String(r.production_date_id));
  }
  return ids;
}

// The photographer row that gates equipment loans — the minimum crew required
// to take gear out. A row counts as soon as a registered STUDENT is picked:
// since PR #75 there is no human approval step, and 'approved' is only the
// automatic post-save flip (production_approve_crew_v1). A row still sitting at
// 'invited' means that flip failed, NOT that the director skipped the casting —
// gating on 'approved' turned such a row into a permanent "⚠ חסר צלם" the
// director had no way to clear (prod: "נגמרה הסוללה", 2026-08). Callers that
// open the loan form must first heal the row via ensurePhotographerApproved:
// create_reservation_v2 derives the crew snapshot from approved rows only.
export function getAssignedPhotographer(p) {
  const crew = Array.isArray(p?.crew) ? p.crew : [];
  return crew.find(c => c.role === "photographer" && c.studentId && c.status !== "rejected") || null;
}

// Date ranges that appear on the public board: only those with a submitted
// equipment list. Applies to every production — see the header note.
export function boardVisibleDates(p, reservations) {
  const dates = Array.isArray(p?.dates) ? p.dates : [];
  const ids = submittedDateIds(p, reservations);
  return dates.filter(d => ids.has(String(d.id)));
}

// Complement of boardVisibleDates: ranges still waiting for an equipment list.
// Drives the director-facing warnings, card badge and post-save prompt.
export function pendingDates(p, reservations) {
  const dates = Array.isArray(p?.dates) ? p.dates : [];
  const ids = submittedDateIds(p, reservations);
  return dates.filter(d => !ids.has(String(d.id)));
}
