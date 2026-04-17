// create-reservation.js — atomic reservation creation.
//
// PURPOSE:
//   Fix the race condition from the Gemini audit (#1 critical) by routing
//   every new reservation through the atomic RPC create_reservation_v2
//   (migration 003, section 6). The RPC takes a FOR UPDATE lock on each
//   equipment row it touches, re-checks availability under the lock, and
//   only then inserts — so two concurrent submits can never both succeed
//   for the last available unit.
//
// PROTOCOL:
//   POST /api/create-reservation
//   body: { reservation: {...}, items: [{equipment_id, name, quantity, unit_id?}, ...] }
//   200:  { ok: true, id: "<new id>" }
//   409:  { ok: false, error: "not_enough_stock", detail: "<rpc raise msg>" }
//   4xx:  validation errors
//   5xx:  server/network errors
//
// NOTES:
//   * Uses service_role key — never expose this endpoint details to the
//     client beyond the fields documented above.
//   * Does NOT touch store.reservations. The caller is expected to
//     follow up with storageSet("reservations", [...fresh, newRes]) to
//     keep the JSON blob in sync for stage-3 reads. The mirror then
//     runs with the 60-second grace period (migration 007) so a stale
//     blob cannot prune parallel atomic inserts.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { reservation, items } = req.body || {};

  if (!reservation || typeof reservation !== "object") {
    return res.status(400).json({ ok: false, error: "Missing reservation object" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: "items must be a non-empty array" });
  }
  for (const it of items) {
    if (!it || typeof it !== "object") {
      return res.status(400).json({ ok: false, error: "Invalid item entry" });
    }
    if (!it.equipment_id) {
      return res.status(400).json({ ok: false, error: "Every item needs an equipment_id" });
    }
    const qty = Number(it.quantity ?? 1);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ ok: false, error: "quantity must be a positive number" });
    }
  }

  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/create_reservation_v2`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_reservation: reservation,
        p_items:       items,
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      // The RPC RAISEs with messages like
      //   "create_reservation_v2: not enough units for ... — requested X, available Y"
      // Map that to a 409 so the client can show a clean Hebrew error.
      const looksLikeStockIssue = /not enough units/i.test(text);
      const status = looksLikeStockIssue ? 409 : r.status;
      console.error("create-reservation RPC error:", r.status, text);
      return res.status(status).json({
        ok: false,
        error: looksLikeStockIssue ? "not_enough_stock" : "rpc_error",
        detail: text,
      });
    }

    // The RPC returns the new reservation id as a TEXT scalar.
    // PostgREST wraps it as a JSON scalar (string).
    const id = await r.json();

    // Keep the store.reservations JSON blob in sync atomically on the server.
    // Uses append_to_store_reservations (migration 021) — a pure growth
    // update, so shrink_guard (migration 011) is never triggered.
    try {
      const finalReservation = { ...reservation, id, items };
      await fetch(`${SB_URL}/rest/v1/rpc/append_to_store_reservations`, {
        method: "POST",
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_reservation: finalReservation }),
      });
    } catch (appendErr) {
      console.warn("append_to_store_reservations failed (non-fatal):", appendErr?.message || appendErr);
    }

    return res.status(200).json({ ok: true, id });
  } catch (e) {
    console.error("create-reservation network error:", e);
    return res.status(500).json({ ok: false, error: "network_error", detail: e.message });
  }
}
