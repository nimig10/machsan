// student-modify-reservation-items.js — student-side removal of items from
// their own equipment loan request.
//
// Routes through public.student_modify_reservation_item_v1 (migration
// 20260511160000), which enforces ownership + status checks atomically
// under a row-level lock on reservations_new. The DB function — not this
// HTTP layer — is the source of truth for what's allowed.
//
// PROTOCOL:
//   POST /api/student-modify-reservation-items
//   body: {
//     reservation_id: string,
//     item_id:        number,   // reservation_items.id (ignored for cancel_reservation)
//     action:         "decrement" | "remove" | "cancel_reservation"
//   }
//   200:  { ok: true, reservation_id, action, items_count, new_status, equipment_ids }
//   400:  validation error
//   401:  not authenticated
//   403:  not owner
//   404:  reservation/item not found
//   409:  reservation status not editable (not ממתין/מאושר)
//   5xx:  rpc/network error

import { requireUser } from "./_auth-helper.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_ACTIONS = new Set(["decrement", "remove", "cancel_reservation"]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  const { reservation_id, item_id, action } = req.body || {};

  if (!reservation_id || typeof reservation_id !== "string") {
    return res.status(400).json({ ok: false, error: "reservation_id is required" });
  }
  if (!action || !ALLOWED_ACTIONS.has(action)) {
    return res.status(400).json({ ok: false, error: "invalid action" });
  }
  if (action !== "cancel_reservation") {
    if (item_id == null || !Number.isFinite(Number(item_id))) {
      return res.status(400).json({ ok: false, error: "item_id is required" });
    }
  }

  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/student_modify_reservation_item_v1`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_reservation_id: String(reservation_id),
        p_item_id:        action === "cancel_reservation" ? 0 : Number(item_id),
        p_action:         action,
        p_actor_email:    user.email,
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      const notFound   = /not found/i.test(text);
      const forbidden  = /forbidden/i.test(text);
      const notEdit    = /not editable/i.test(text);
      const staleState = /cannot decrement.*below 1/i.test(text);
      const httpStatus = forbidden ? 403 : notFound ? 404 : notEdit ? 409 : staleState ? 409 : r.status;
      console.error("student-modify-reservation-items RPC error:", r.status, text);
      return res.status(httpStatus).json({
        ok:    false,
        error: forbidden ? "forbidden"
             : notFound  ? "not_found"
             : notEdit   ? "status_not_editable"
             : staleState ? "stale_state"
             : "rpc_error",
        detail: text,
      });
    }

    const body = await r.json();
    return res.status(200).json(body);
  } catch (e) {
    console.error("student-modify-reservation-items network error:", e);
    return res.status(500).json({ ok: false, error: "network_error", detail: e.message });
  }
}
