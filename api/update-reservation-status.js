// update-reservation-status.js — atomic status change for reservations.
//
// PURPOSE:
//   Routes status changes through the atomic RPC update_reservation_status_v1
//   (migration 009), which:
//     * takes FOR UPDATE on the reservations_new row (serializes concurrent
//       admin clicks on the same request),
//     * updates status + returned_at in a single transaction,
//     * recomputes available_units for every equipment_id referenced
//       by the reservation in the same transaction (no cache drift on
//       transitions into the "currently out of warehouse" window).
//
// PROTOCOL:
//   POST /api/update-reservation-status
//   body: { id: string, status: string, returned_at?: ISO string }
//   200:  { ok: true, id, old_status, new_status, changed: boolean }
//   400:  validation error
//   404:  reservation not found
//   409:  conflict (currently unused — reserved for future use)
//   5xx:  server/network error
//
// NOTES:
//   * Uses service_role key — never expose this endpoint's details to
//     the client beyond the fields documented above.
//   * Callers are still expected to refresh their local state via the
//     existing storageGet("reservations") path. This endpoint is the
//     source of truth; the JSON blob is a cache.

import { resolveUserRole } from "./_auth-helper.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_STATUSES = new Set([
  "ממתין",
  "אישור ראש מחלקה",
  "מאושר",
  "נדחה",
  "בוטל",
  "מבוטל",
  "הוחזר",
  "באיחור",
  "פעילה",
]);

// Dept-heads (lecturers with a row in public.dept_heads) approve their step
// of the chain — they forward "אישור ראש מחלקה" → "ממתין" or reject it.
// They must NOT be able to flip a reservation to "מאושר" or "פעילה" —
// that's the warehouse's job.
const DEPT_HEAD_ALLOWED_STATUSES = new Set(["ממתין", "נדחה"]);

async function isDeptHead(email) {
  if (!email) return false;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/dept_heads?email=eq.${encodeURIComponent(email)}&select=id&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    if (!r.ok) return false;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // Two accepted callers:
  //   1) staff (admin / warehouse) — full status transitions
  //   2) dept-head (row in public.dept_heads) — limited to "ממתין"/"נדחה"
  const role = await resolveUserRole(req);
  let caller = null;
  if (role.role === "staff") {
    caller = { kind: "staff", email: role.email };
  } else if (role.role === "user" && role.email && (await isDeptHead(role.email))) {
    caller = { kind: "dept_head", email: role.email };
  } else {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { id, status, returned_at } = req.body || {};

  if (!id || typeof id !== "string") {
    return res.status(400).json({ ok: false, error: "Missing or invalid id" });
  }
  if (!status || !ALLOWED_STATUSES.has(status)) {
    return res.status(400).json({ ok: false, error: "Missing or invalid status" });
  }
  if (caller.kind === "dept_head" && !DEPT_HEAD_ALLOWED_STATUSES.has(status)) {
    return res.status(403).json({ ok: false, error: "Forbidden", detail: "dept_head can only set 'ממתין' or 'נדחה'" });
  }
  if (returned_at != null && typeof returned_at !== "string") {
    return res.status(400).json({ ok: false, error: "returned_at must be an ISO string" });
  }

  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/update_reservation_status_v1`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_reservation_id: String(id),
        p_new_status:     status,
        p_returned_at:    returned_at || null,
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      // The RPC RAISEs with messages like:
      //   "update_reservation_status_v1: reservation <id> not found"
      //   "update_reservation_status_v1: invalid status ..."
      const notFound = /not found/i.test(text);
      const badInput = /invalid status|required/i.test(text);
      // Atomic approval availability guard raise (see update_reservation_status_v1).
      const overbook = /approve_overbook|not enough units/i.test(text);
      const httpStatus = notFound ? 404 : badInput ? 400 : overbook ? 409 : r.status;
      console.error("update-reservation-status RPC error:", r.status, text);
      return res.status(httpStatus).json({
        ok: false,
        error: notFound ? "not_found" : badInput ? "invalid_input" : overbook ? "approve_overbook" : "rpc_error",
        detail: text,
      });
    }

    // The RPC returns a JSONB object { id, old_status, new_status, changed }.
    const body = await r.json();
    return res.status(200).json({ ok: true, ...body });
  } catch (e) {
    console.error("update-reservation-status network error:", e);
    return res.status(500).json({ ok: false, error: "network_error", detail: e.message });
  }
}
