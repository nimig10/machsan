// delete-reservation.js — atomic single-reservation delete.
//
// PURPOSE:
//   Routes every "click the trash on a reservation" through the RPC
//   delete_reservation_v1 (migration 012). The RPC deletes the row from
//   reservations_new + reservation_items, strips it from the store.reservations
//   JSON mirror, and recomputes available_units for the equipment it touched —
//   all in one transaction.
//
//   Before this endpoint existed, ReservationsPage.deleteReservation did an
//   optimistic setState + fire-and-forget storageSet('reservations', list).
//   That created a 2–14s window where the cache/mirror/JSON all disagreed,
//   and a concurrent poll or realtime event could bring the deleted row
//   back onto the screen briefly ("the trash-button flicker").
//
// PROTOCOL:
//   POST /api/delete-reservation
//   body: { id: "1776334556940" }
//   200:  { ok: true, id, source, ... }  (source = normalized|json_only|not_found)
//   400:  invalid body
//   5xx:  rpc/network error
//
// NOTES:
//   * Uses service_role key.
//   * Deletes exactly one row by primary key. Cannot accidentally match many.

import { requireStaff } from "./_auth-helper.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const staff = await requireStaff(req, res);
  if (!staff) return;

  const { id } = req.body || {};
  if (!id || typeof id !== "string") {
    return res.status(400).json({ ok: false, error: "id is required" });
  }

  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/delete_reservation_v1`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_reservation_id: id }),
    });

    if (!r.ok) {
      const text = await r.text();
      console.error("delete-reservation RPC error:", r.status, text);
      return res.status(r.status).json({
        ok: false,
        error:  "rpc_error",
        detail: text,
      });
    }

    const out = await r.json();
    return res.status(200).json({
      ok:                   true,
      id:                   out?.id ?? id,
      source:               out?.source ?? "unknown",
      normalized_deleted:   out?.normalized_deleted ?? 0,
      items_deleted:        out?.items_deleted ?? 0,
      json_shrunk_by:       out?.json_shrunk_by ?? 0,
      recomputed_equipment: out?.recomputed_equipment ?? 0,
    });
  } catch (e) {
    console.error("delete-reservation network error:", e);
    return res.status(500).json({ ok: false, error: "network_error", detail: e.message });
  }
}
