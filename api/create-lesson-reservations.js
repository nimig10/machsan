// create-lesson-reservations.js — atomic batch creation of a lesson kit's
// weekly schedule.
//
// PURPOSE:
//   Stage 2b of the atomic-RPC migration. Routes every "save lesson kit" click
//   through the RPC create_lesson_reservations_v1 (migration 010). That RPC:
//     1. Deletes reservations where lesson_kit_id = kit_id
//     2. For each session runs the same date-range overlap check as
//        create_reservation_v2 (migration 008), under FOR UPDATE locks on
//        every equipment row the kit touches.
//     3. Inserts the new rows and recomputes available_units.
//
// PROTOCOL:
//   POST /api/create-lesson-reservations
//   body: {
//     kit_id: "lk_<number>",
//     reservations: [ {id, borrow_date, borrow_time, return_date, return_time,
//                      student_name, email, phone, course, status?, loan_type?,
//                      booking_kind?, lesson_id?, lesson_auto? }, ... ],
//     items: [ {equipment_id, name, quantity, unit_id?}, ... ]
//   }
//   200:  { ok: true, inserted, deleted, ids }
//   409:  { ok: false, error: "not_enough_stock", detail: "<rpc raise msg>" }
//   4xx:  validation errors
//   5xx:  server/network errors
//
// NOTES:
//   * Uses service_role key — never expose beyond the documented fields.
//   * Does NOT touch store.reservations. Callers should refresh that blob
//     via storageSet("reservations", fresh) after a successful call so the
//     JSON cache picks up the new state before the next mirror sync.

import { requireStaff } from "./_auth-helper.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const staff = await requireStaff(req, res);
  if (!staff) return;

  const { kit_id, reservations, items } = req.body || {};

  if (!kit_id || typeof kit_id !== "string") {
    return res.status(400).json({ ok: false, error: "kit_id is required" });
  }
  if (!Array.isArray(reservations)) {
    return res.status(400).json({ ok: false, error: "reservations must be an array" });
  }
  if (!Array.isArray(items)) {
    return res.status(400).json({ ok: false, error: "items must be an array" });
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
      return res.status(400).json({ ok: false, error: "item quantity must be a positive number" });
    }
  }
  for (const r of reservations) {
    if (!r || typeof r !== "object") {
      return res.status(400).json({ ok: false, error: "Invalid reservation entry" });
    }
    if (!r.borrow_date || !r.return_date) {
      return res.status(400).json({ ok: false, error: "Every session needs borrow_date and return_date" });
    }
  }

  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/create_lesson_reservations_v1`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_kit_id:       kit_id,
        p_reservations: reservations,
        p_items:        items,
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      // The RPC RAISEs with "not enough units for ..." when availability fails.
      // Map that to 409 so the client can render a clean conflict message.
      const looksLikeStockIssue = /not enough units/i.test(text);
      const status = looksLikeStockIssue ? 409 : r.status;
      console.error("create-lesson-reservations RPC error:", r.status, text);
      return res.status(status).json({
        ok: false,
        error: looksLikeStockIssue ? "not_enough_stock" : "rpc_error",
        detail: text,
      });
    }

    // RPC returns JSONB { inserted, deleted, ids }.
    const out = await r.json();
    return res.status(200).json({
      ok:       true,
      inserted: out?.inserted ?? 0,
      deleted:  out?.deleted  ?? 0,
      ids:      Array.isArray(out?.ids) ? out.ids : [],
    });
  } catch (e) {
    console.error("create-lesson-reservations network error:", e);
    return res.status(500).json({ ok: false, error: "network_error", detail: e.message });
  }
}
