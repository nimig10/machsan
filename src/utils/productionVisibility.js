// productionVisibility.js — board-visibility gate for production date ranges.
//
// Product rule (PR 2026-07): a shoot date range "joins the board" only after
// the director submitted an equipment list (reservation) for it. Ranges
// without a list stay fully visible to the director (and to staff/dept-head
// mounts) with warnings + submit prompts, but are hidden from other students'
// board — cards, calendar bars and the monthly filter.
//
// Grandfathering: productions created BEFORE the cutoff keep the old behavior
// end-to-end (all ranges visible to everyone, no warnings, no prompts). Only
// productions created after the feature ships run the new gate. A missing
// createdAt is treated as legacy — the safe default.

// Merge/deploy date of PR #75 — every production created before this day keeps
// the old behavior forever; verified against prod: newest production predates
// this by 9 days (2026-07-05), so ALL pre-existing productions are legacy.
export const LEGACY_PRODUCTION_CUTOFF_ISO = "2026-07-14";

export function isLegacyProduction(p) {
  const created = String(p?.createdAt || "");
  return !created || created < LEGACY_PRODUCTION_CUTOFF_ISO;
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

// Date ranges that appear on the public board: legacy productions show all;
// new productions show only ranges with a submitted equipment list.
export function boardVisibleDates(p, reservations) {
  const dates = Array.isArray(p?.dates) ? p.dates : [];
  if (isLegacyProduction(p)) return dates;
  const ids = submittedDateIds(p, reservations);
  return dates.filter(d => ids.has(String(d.id)));
}

// Complement of boardVisibleDates: ranges still waiting for an equipment list.
// Drives the director-facing warnings, card badge and post-save prompt.
// Always [] for legacy productions — they never warn.
export function pendingDates(p, reservations) {
  const dates = Array.isArray(p?.dates) ? p.dates : [];
  if (isLegacyProduction(p)) return [];
  const ids = submittedDateIds(p, reservations);
  return dates.filter(d => !ids.has(String(d.id)));
}
