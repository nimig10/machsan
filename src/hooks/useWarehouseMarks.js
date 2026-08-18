// useWarehouseMarks.js — where the checkout/return panels' marks actually live.
//
// A module-level store rather than state in each host page, for one concrete
// reason: the same request opens from BOTH the dashboard quick-view and the
// requests page. With per-page state, marking two of three cards on the
// dashboard and then opening that request from the requests page shows
// "סומנו 0 מתוך 3" — the exact complaint this change exists to fix, arriving by
// a different route. Warehouse staff move between those two screens constantly.
//
// src/pendingDeletes.js is the in-repo precedent for a module-level store shared
// across pages. The "how does React find out" part is useSyncExternalStore
// (React 19.2), which is built for exactly this.
//
// Deliberately NOT persisted to sessionStorage/localStorage. Surviving a page
// refresh was considered and rejected: it buys little for a counter operation
// and costs a TTL, revalidation on restore, and a whole class of stale-draft
// bugs. Marks live as long as the tab does.

import { useSyncExternalStore } from "react";
import { EMPTY_DRAFT, draftKey, withGreen, withVerdict } from "../utils/markDraft.js";

const drafts = new Map(); // draftKey → frozen draft
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeWarehouseMarks(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ⚠️ Returns the shared frozen EMPTY_DRAFT when there is nothing — never a fresh
// object. getSnapshot is compared by identity on every render; a new `{}` each
// time makes React throw "The result of getSnapshot should be cached".
export function getWarehouseMarks(flow, reservationId) {
  return drafts.get(draftKey(flow, reservationId)) || EMPTY_DRAFT;
}

// Every mutator REPLACES the stored draft (markDraft's writers return new frozen
// objects). Mutating one in place would leave getSnapshot returning the same
// identity after a change, and the panel would silently stop re-rendering.
function write(flow, reservationId, next) {
  const key = draftKey(flow, reservationId);
  if (next === EMPTY_DRAFT) drafts.delete(key);
  else drafts.set(key, next);
  emit();
}

export function toggleWarehouseGreen(flow, reservationId, markKey, on, qty) {
  write(flow, reservationId, withGreen(getWarehouseMarks(flow, reservationId), markKey, on, qty));
}

export function setWarehouseVerdict(flow, reservationId, markKey, unitId, patch) {
  write(flow, reservationId, withVerdict(getWarehouseMarks(flow, reservationId), markKey, unitId, patch));
}

// Called by the four host success handlers, and by the panel's "נקה סימונים".
//
// ⚠️ ON SUCCESS ONLY. A checkout that FAILED must keep its marks — that is what
// lets the operator finish through the recovery banner, and re-marking the same
// units is safe by construction (the unit writes are no-ops, the item target is
// absolute, the stamp PATCH is filtered on issued_at=is.null).
export function clearWarehouseMarks(flow, reservationId) {
  const key = draftKey(flow, reservationId);
  if (!drafts.has(key)) return;
  drafts.delete(key);
  emit();
}

export function useWarehouseMarks(flow, reservationId) {
  return useSyncExternalStore(
    subscribeWarehouseMarks,
    () => getWarehouseMarks(flow, reservationId),
  );
}
