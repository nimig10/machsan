// restore-reservation.js — undo path for "↩ בטל פעולה" on reservations.
//
// Routes a single reservation re-creation through restore_reservation_v1
// (migration 20260504170000). Used exclusively by the admin undo button
// when restoring a previously-deleted reservation. Skips the overlap
// check inside the RPC; idempotent if the row already exists.
//
// PROTOCOL:
//   POST /api/restore-reservation
//   body: { reservation: {...full row...}, items: [{equipment_id,name,quantity,unit_id}, ...] }
//   200:  { ok: true, id }
//   400:  invalid body
//   5xx:  rpc/network error

import { requireStaff } from "./_auth-helper.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const staff = await requireStaff(req, res);
  if (!staff) return;

  const { reservation, items } = req.body || {};
  if (!reservation || typeof reservation !== "object") {
    return res.status(400).json({ ok: false, error: "reservation is required" });
  }
  if (!Array.isArray(items)) {
    return res.status(400).json({ ok: false, error: "items must be an array" });
  }

  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/restore_reservation_v1`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_reservation: reservation, p_items: items }),
    });
    if (!r.ok) {
      const text = await r.text();
      console.error("restore-reservation RPC error:", r.status, text);
      return res.status(r.status).json({ ok: false, error: "rpc_error", detail: text });
    }
    const id = await r.json();
    return res.status(200).json({ ok: true, id });
  } catch (err) {
    console.error("restore-reservation network error:", err);
    return res.status(500).json({ ok: false, error: "network_error", detail: err.message });
  }
}
