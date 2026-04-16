// update-reservation-status.js — atomic status change for reservations.
//
// PURPOSE:
//   Stage 1 of the admin-side race-condition fix. Every admin / lecturer
//   page currently does fetch-list → mutate → storageSet("reservations",
//   fullList). That flow has three real risks:
//     1) A concurrent public-form submit can be silently overwritten by
//        the admin's full-list write (last writer wins).
//     2) Transition into the "currently out of warehouse" window
//        (status='מאושר' with borrow_date+time passed, or 'פעילה',
//        or 'באיחור') does not refresh available_units, so the
//        cached counter drifts from what the mirror would compute.
//     3) Two admins clicking "approve" on the same request at the same
//        time both succeed, both email the student, both write the DB.
//
//   This endpoint routes the change through the atomic RPC
//   update_reservation_status_v1 (migration 009), which:
//     * takes FOR UPDATE on the reservations_new row (serializes #3),
//     * updates status + returned_at in a single transaction,
//     * recomputes available_units for every equipment_id referenced
//       by the reservation, using the same formula as the mirror
//       (fixes #2).
//
//   Item #1 is fixed at the JSON-blob level by migration 007's
//   60-second grace period in sync_reservations_from_json.
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { id, status, returned_at } = req.body || {};

  if (!id || typeof id !== "string") {
    return res.status(400).json({ ok: false, error: "Missing or invalid id" });
  }
  if (!status || !ALLOWED_STATUSES.has(status)) {
    return res.status(400).json({ ok: false, error: "Missing or invalid status" });
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
      const httpStatus = notFound ? 404 : badInput ? 400 : r.status;
      console.error("update-reservation-status RPC error:", r.status, text);
      return res.status(httpStatus).json({
        ok: false,
        error: notFound ? "not_found" : badInput ? "invalid_input" : "rpc_error",
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
