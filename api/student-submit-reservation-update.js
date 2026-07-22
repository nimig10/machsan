// student-submit-reservation-update.js — a student submits ONE equipment-list
// update (a batch of add / increase ops staged in the client draft)
// for their own existing loan reservation.
//
// Routes through public.student_submit_reservation_update_v3 (migration
// 20260722153000), which enforces lead-time + ownership + status + counter + private-4 +
// external-loan + availability atomically under a row lock on
// reservations_new. The DB function is the source of truth for those.
//
// This layer performs the same lead-time check early so the student receives
// a clear Hebrew reason. v3 repeats it authoritatively under the reservation
// row lock, closing the cutoff race between this pre-check and the DB write.
//
// Identity comes from the JWT (requireUser) — the client never supplies the
// acting email. Ownership is also enforced here (cheap pre-check) and again
// inside the RPC (authoritative, under the row lock).
//
// PROTOCOL:
//   POST /api/student-submit-reservation-update
//   body: {
//     reservation_id: string,
//     ops: [
//       { action: "add",      equipment_id: string, quantity: number },
//       { action: "increase", item_id: number,      quantity: number },  // quantity = delta
//     ]
//   }
//   200: { ok:true, update_id, update_number, mode:"auto_applied"|"pending", updates_used, updates_left }
//   400: validation / invalid ops
//   401: not authenticated
//   403: not owner
//   404: reservation / item / equipment not found
//   409: status_not_editable | already_started | update_pending | update_limit |
//        lead_time | external_restricted | private_limit | not_available
//   5xx: rpc/network error

import { requireUser } from "./_auth-helper.js";
import { getUpdateLeadTimeState } from "../src/utils/loanPolicy.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SERVICE_HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

const ALLOWED_ACTIONS = new Set(["add", "increase"]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  const { reservation_id, ops } = req.body || {};

  if (!reservation_id || typeof reservation_id !== "string") {
    return res.status(400).json({ ok: false, error: "reservation_id is required" });
  }
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > 30) {
    return res.status(400).json({ ok: false, error: "invalid ops" });
  }
  for (const op of ops) {
    if (!op || !ALLOWED_ACTIONS.has(op.action)) {
      return res.status(400).json({ ok: false, error: "invalid ops" });
    }
    const qty = Number(op.quantity);
    if (!Number.isFinite(qty) || qty < 1) {
      return res.status(400).json({ ok: false, error: "invalid ops" });
    }
    if (op.action === "add" && !op.equipment_id) {
      return res.status(400).json({ ok: false, error: "invalid ops" });
    }
    if (op.action === "increase" &&
        (op.item_id == null || !Number.isFinite(Number(op.item_id)))) {
      return res.status(400).json({ ok: false, error: "invalid ops" });
    }
  }

  try {
    // ── load the reservation for the lead-time gate + ownership pre-check ──
    const rRes = await fetch(
      `${SB_URL}/rest/v1/reservations_new?id=eq.${encodeURIComponent(reservation_id)}&select=id,email,loan_type,borrow_date,borrow_time,studio_booking_id&limit=1`,
      { headers: SERVICE_HEADERS },
    );
    if (!rRes.ok) {
      return res.status(502).json({ ok: false, error: "reservation_fetch_failed" });
    }
    const rows = await rRes.json();
    const reservation = rows?.[0];
    if (!reservation) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    if (String(reservation.email || "").trim().toLowerCase() !== String(user.email || "").trim().toLowerCase()) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }

    // ── lead-time gate — the ONE shared rule source (loanPolicy.js) ─────────
    // Removal is not gated by this; add/increase are.
    const lead = getUpdateLeadTimeState(reservation);
    if (!lead.allowed) {
      return res.status(409).json({ ok: false, error: "lead_time", reason: lead.reason });
    }

    // ── the atomic RPC does everything else ────────────────────────────────
    const normalizedOps = ops.map((op) => {
      const base = { action: op.action, quantity: Number(op.quantity) };
      if (op.action === "add") {
        base.equipment_id = String(op.equipment_id);
        if (op.name) base.name = String(op.name);
      }
      if (op.action === "increase") {
        base.item_id = Number(op.item_id);
      }
      return base;
    });

    const r = await fetch(`${SB_URL}/rest/v1/rpc/student_submit_reservation_update_v3`, {
      method: "POST",
      headers: SERVICE_HEADERS,
      body: JSON.stringify({
        p_reservation_id: String(reservation_id),
        p_actor_email:    user.email,
        p_ops:            normalizedOps,
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      // Token → HTTP mapping (tokens are embedded in the RPC's RAISE messages)
      const token =
        /forbidden/i.test(text)            ? ["forbidden", 403]
        : /not found/i.test(text)          ? ["not_found", 404]
        : /status_not_editable/i.test(text)? ["status_not_editable", 409]
        : /lesson_not_editable/i.test(text)? ["status_not_editable", 409]
        : /already_started/i.test(text)    ? ["already_started", 409]
        : /update_pending/i.test(text)     ? ["update_pending", 409]
        : /update_limit/i.test(text)       ? ["update_limit", 409]
        : /lead_time/i.test(text)          ? ["lead_time", 409]
        : /external_restricted/i.test(text)? ["external_restricted", 409]
        : /private_limit/i.test(text)      ? ["private_limit", 409]
        : /not_available/i.test(text)      ? ["not_available", 409]
        : /invalid_ops/i.test(text)        ? ["invalid_ops", 400]
        : ["rpc_error", r.status];
      console.error("student-submit-reservation-update RPC error:", r.status, text);
      return res.status(token[1]).json({ ok: false, error: token[0], detail: text });
    }

    const body = await r.json();
    return res.status(200).json(body);
  } catch (e) {
    console.error("student-submit-reservation-update network error:", e);
    return res.status(500).json({ ok: false, error: "network_error", detail: e.message });
  }
}
