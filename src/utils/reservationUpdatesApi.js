// reservationUpdatesApi.js — client API for student equipment-list updates on
// an existing loan reservation ("ההזמנות שלי" → add / increase) and
// the warehouse review of those updates.
//
// WRITES go through the two authenticated endpoints (identity from the JWT,
// all guards atomic in the DB — see api/student-submit-reservation-update.js
// and api/staff-review-reservation-update.js). READS go straight through the
// supabase client. RLS exposes all rows to staff and only the student's own
// rows to that student; writes stay service-only through the endpoints.
//
// Data shape returned by listReservationUpdates():
//   [{ id, reservation_id, update_number, base_status, review_status,
//      student_email, submitted_at, reviewed_at, reviewed_by_name,
//      staff_message, items: [reservation_pending_items rows] }]

import { supabase } from "../supabaseClient.js";
import { getAuthToken } from "../utils.js";

export const MAX_RESERVATION_UPDATES = 2;

// All update-ledger rows + their per-item rows, newest first. Small table
// (hard-capped at 2 rows per reservation), so loading it whole is fine.
export async function listReservationUpdates() {
  const { data, error } = await supabase
    .from("reservation_item_updates")
    .select("*, items:reservation_pending_items(*)")
    .order("submitted_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// Submit one update (a batch of staged ops) for the student's own reservation.
// ops: [{action:'add', equipment_id, quantity, name?} |
//       {action:'increase', item_id, quantity}]
// Resolves { ok:true, mode, update_number, updates_used, updates_left } or
// { ok:false, error, reason? } — never throws.
export async function submitReservationUpdate(reservationId, ops) {
  try {
    const token = await getAuthToken();
    if (!token) return { ok: false, error: "no_session" };
    const res = await fetch("/api/student-submit-reservation-update", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ reservation_id: reservationId, ops }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: body?.error || `http-${res.status}`, reason: body?.reason || "", detail: body?.detail || "" };
    }
    return body || { ok: false, error: "empty_response" };
  } catch (e) {
    console.warn("[reservationUpdatesApi.submitReservationUpdate]", e?.message || e);
    return { ok: false, error: "network" };
  }
}

// Staff review of a pending update.
// decisions: [{pending_item_id, decision:'approve'|'reject', approved_quantity?}]
export async function reviewReservationUpdate(updateId, decisions, staffMessage) {
  try {
    const token = await getAuthToken();
    if (!token) return { ok: false, error: "no_session" };
    const res = await fetch("/api/staff-review-reservation-update", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        update_id: updateId,
        decisions,
        staff_message: staffMessage || "",
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: body?.error || `http-${res.status}`, detail: body?.detail || "" };
    }
    return body || { ok: false, error: "empty_response" };
  } catch (e) {
    console.warn("[reservationUpdatesApi.reviewReservationUpdate]", e?.message || e);
    return { ok: false, error: "network" };
  }
}
