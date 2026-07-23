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

// A dept-head acts on exactly one step of the chain, and their portal already
// shows them only the rows they may touch: LecturerPortal's pendingDhRequests
// filters on status === "אישור ראש מחלקה" AND loan_type ∈ their loan_types.
// The server used to enforce neither — it only checked that the email existed
// in dept_heads, then ran the service-role RPC. That let a dept-head who knew
// any reservation id push it to "ממתין"/"נדחה" from ANY status, including
// "מאושר"/"פעילה" — which releases held inventory and breaks a live loan.
//
// Both checks below mirror the portal exactly, so a legitimate dept-head never
// sees a difference; only calls the UI would never have produced are refused.
//
// Returns null when the email is not a dept-head, otherwise the union of the
// loan types across their rows (union, not first-match, so an extra row can
// only widen — never wrongly block someone the portal would let through).
async function getDeptHeadScope(email) {
  if (!email) return null;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/dept_heads?email=eq.${encodeURIComponent(email)}&select=id,loan_types`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const loanTypes = new Set();
    for (const row of rows) {
      for (const t of row.loan_types || []) loanTypes.add(String(t));
    }
    return { loanTypes };
  } catch { return null; }
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
  let deptHeadScope = null;
  if (role.role === "staff") {
    caller = { kind: "staff", email: role.email };
  } else if (role.role === "user" && role.email && (deptHeadScope = await getDeptHeadScope(role.email))) {
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

  // Dept-head only: the row must actually be sitting on their step of the chain
  // and belong to a loan type they handle (see getDeptHeadScope). One extra read
  // on a rare path; the staff path is untouched, and update_reservation_status_v1
  // is not touched at all (lessons #22 / #25 / #55).
  if (caller.kind === "dept_head") {
    let row = null;
    try {
      const rr = await fetch(
        `${SB_URL}/rest/v1/reservations_new?id=eq.${encodeURIComponent(String(id))}&select=status,loan_type&limit=1`,
        { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
      );
      if (rr.ok) row = (await rr.json())?.[0] || null;
    } catch (e) {
      console.error("update-reservation-status: dept_head scope read failed:", e.message);
      return res.status(500).json({ ok: false, error: "network_error", detail: e.message });
    }
    if (!row) return res.status(404).json({ ok: false, error: "not_found" });

    if (row.status !== "אישור ראש מחלקה") {
      console.warn(
        "update-reservation-status: dept_head blocked —",
        `email=${caller.email} id=${id} current_status=${row.status} target=${status}`
      );
      return res.status(403).json({
        ok: false, error: "Forbidden",
        detail: "dept_head can only act on a reservation awaiting dept-head approval",
      });
    }
    if (!deptHeadScope?.loanTypes?.has(String(row.loan_type))) {
      console.warn(
        "update-reservation-status: dept_head blocked —",
        `email=${caller.email} id=${id} loan_type=${row.loan_type} out of scope`
      );
      return res.status(403).json({
        ok: false, error: "Forbidden",
        detail: "dept_head is not responsible for this loan type",
      });
    }
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

    // ── Record WHO actually performed a status change ─────────────────────
    // Deliberately a separate PATCH rather than a parameter on the RPC:
    // update_reservation_status_v1 is guard-heavy (approve-overbook,
    // peak-concurrent) and adding a parameter would force DROP + full
    // re-declaration — the exact mechanism that broke production in PR #45.
    //
    // Identity comes from the JWT, never from the client, so it cannot be
    // spoofed; and because it lives here it covers every caller of this
    // endpoint, including the dashboard buttons which have no staff identity
    // client-side at all.
    //
    // Two actors are recorded, each on its own transition:
    //   הוחזר → returned_by_*   (who returned the equipment — PR #80)
    //   מאושר → approved_by_*   (who moved the request to approved)
    //
    // Display-only metadata: on failure we log and still return 200. The status
    // change already committed, and surfacing an error would show a red toast
    // for a cosmetic write.
    //
    // The status filter (status=eq.<matchStatus>) is the guard: if a concurrent
    // action flipped the row out of that status between the RPC commit and here,
    // zero rows match and no stale actor is written. Own 2.5s AbortController so
    // this cosmetic write can never stretch the response toward the client's
    // abort ceiling (a slow stamp used to make a SUCCESSFUL action look failed).
    const stampActor = async (matchStatus, fields) => {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 2500);
      try {
        const sres = await fetch(
          `${SB_URL}/rest/v1/reservations_new?id=eq.${encodeURIComponent(String(id))}&status=eq.${encodeURIComponent(matchStatus)}`,
          {
            method: "PATCH",
            headers: {
              apikey: SB_KEY,
              Authorization: `Bearer ${SB_KEY}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify(fields),
            signal: c.signal,
          }
        );
        if (!sres.ok) {
          console.error("update-reservation-status: actor stamp failed:", matchStatus, sres.status, await sres.text());
        }
      } catch (e) {
        console.error("update-reservation-status: actor stamp error:", matchStatus, e.message);
      } finally {
        clearTimeout(t);
      }
    };

    let returnedById = null, returnedByName = null;
    let approvedById = null, approvedByName = null;
    if (caller.kind === "staff") {
      const actorId   = role.id || null;
      const actorName = String(role.full_name || role.email || "").trim() || null;
      if (status === "הוחזר") {
        returnedById = actorId; returnedByName = actorName;
        await stampActor("הוחזר", { returned_by_staff_id: actorId, returned_by_name: actorName });
      } else if (status === "מאושר") {
        approvedById = actorId; approvedByName = actorName;
        await stampActor("מאושר", { approved_by_staff_id: actorId, approved_by_name: actorName });
      }
    }

    return res.status(200).json({
      ok: true,
      ...body,
      returned_by_staff_id: returnedById,
      returned_by_name: returnedByName,
      approved_by_staff_id: approvedById,
      approved_by_name: approvedByName,
    });
  } catch (e) {
    console.error("update-reservation-status network error:", e);
    return res.status(500).json({ ok: false, error: "network_error", detail: e.message });
  }
}
