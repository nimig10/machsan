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
//   200:  { ok: true, id, old_status, new_status, changed: boolean,
//           returned_by_staff_id, returned_by_name }   // the last two are
//           non-null only when a staff caller set status="הוחזר"
//   400:  validation error
//   404:  reservation not found
//   409:  approve_overbook — not enough units to approve (since PR #55)
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
    // Diagnostic: a warehouse staff member whose "הוחזר" click is rejected 403
    // should show up here with WHY (anon token vs recognized-but-not-staff), so
    // the exact cause is visible in Vercel logs on the next failed attempt.
    console.warn(
      "update-reservation-status: 403 Forbidden —",
      `role=${role.role} email=${role.email || "(none)"}`,
      role.role === "anon" ? "(token missing/invalid — likely stale session)" : "(authenticated but not staff/dept_head)"
    );
    return res.status(403).json({ error: "Forbidden", reason: role.role === "anon" ? "no_valid_session" : "not_staff" });
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

    // ── Record WHO actually processed the return ──────────────────────────
    // Deliberately a separate PATCH rather than a parameter on the RPC:
    // update_reservation_status_v1 is guard-heavy (approve-overbook,
    // peak-concurrent) and adding a parameter would force DROP + full
    // re-declaration — the exact mechanism that broke production in PR #45.
    //
    // Identity comes from the JWT, never from the client, so it cannot be
    // spoofed; and because it lives here it covers every caller of this
    // endpoint, including the dashboard button which has no staff identity
    // client-side at all.
    //
    // Display-only metadata: on failure we log and still return 200. The
    // status change already committed, and surfacing an error would show a
    // red toast for a cosmetic write.
    let stampedId = null;
    let stampedName = null;
    if (status === "הוחזר" && caller.kind === "staff") {
      stampedId = role.id || null;
      stampedName = String(role.full_name || role.email || "").trim() || null;
      // Cap the stamp round-trip at 2.5s with its own AbortController. The RPC
      // status change has already committed; this cosmetic write must never
      // stretch the total response time toward the client's abort ceiling (a
      // slow stamp used to make a SUCCESSFUL return look like a failure).
      const stampCtrl = new AbortController();
      const stampTimer = setTimeout(() => stampCtrl.abort(), 2500);
      try {
        // The status filter is the guard: if a concurrent action flipped the
        // row out of "הוחזר" between the RPC commit and here, zero rows match
        // and no stale actor is written. Not gated on body.changed — a failed
        // stamp would then be unrecoverable, since the return button is gone
        // once the row is archived. Overwrites unconditionally: a re-return by
        // a different person must update, otherwise the archive shows a lie.
        const stampRes = await fetch(
          `${SB_URL}/rest/v1/reservations_new?id=eq.${encodeURIComponent(String(id))}&status=eq.${encodeURIComponent("הוחזר")}`,
          {
            method: "PATCH",
            headers: {
              apikey: SB_KEY,
              Authorization: `Bearer ${SB_KEY}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              returned_by_staff_id: stampedId,
              returned_by_name: stampedName,
            }),
            signal: stampCtrl.signal,
          }
        );
        if (!stampRes.ok) {
          console.error("update-reservation-status: returned_by stamp failed:", stampRes.status, await stampRes.text());
        }
      } catch (e) {
        console.error("update-reservation-status: returned_by stamp error:", e.message);
      } finally {
        clearTimeout(stampTimer);
      }
    }

    return res.status(200).json({
      ok: true,
      ...body,
      returned_by_staff_id: stampedId,
      returned_by_name: stampedName,
    });
  } catch (e) {
    console.error("update-reservation-status network error:", e);
    return res.status(500).json({ ok: false, error: "network_error", detail: e.message });
  }
}
