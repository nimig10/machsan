// Module-level guard for optimistic reservation deletes.
//
// Why this exists: when staff click the trash on a reservation,
// ReservationsPage runs setReservations(without-it) immediately, then
// fires the API delete and waits for the RPC + realtime broadcast.
// In the window between "click" and "realtime DELETE event arrives",
// any unrelated refetch (15s poll, equipment realtime echo, another
// admin's edit, etc.) that lands in the same window would re-fetch
// the reservation list while the row is still in the DB and re-insert
// it into local state. Visually this is the "trash flicker" the user
// reported.
//
// The fix: every refetch handler that rebuilds `reservations` consults
// `pendingReservationDeletes` and skips any id in it. The set is
// populated by ReservationsPage right before the optimistic setState
// and cleared after the RPC settles (with a small trailing delay so
// the realtime DELETE event we triggered ourselves can be ignored too).
//
// This is intentionally NOT React state — it must be readable
// synchronously from non-React code paths (refetch handlers nested in
// useEffect, polling tick callbacks) without triggering re-renders.

export const pendingReservationDeletes = new Set();

export function markReservationDeleting(id) {
  if (id == null) return;
  pendingReservationDeletes.add(String(id));
}

// Delay the unmark so the DB-level realtime DELETE event (fires shortly
// after the API RPC completes) still sees the id in the set and skips
// the redundant refetch path. 1.5s is comfortably above the 400ms
// debounce + a few hundred ms of network latency.
export function unmarkReservationDeleting(id, delayMs = 1500) {
  if (id == null) return;
  const sid = String(id);
  if (delayMs <= 0) {
    pendingReservationDeletes.delete(sid);
    return;
  }
  setTimeout(() => pendingReservationDeletes.delete(sid), delayMs);
}
