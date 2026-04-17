// mark-overdue-sent.js — flip the overdue_email_sent flag on one reservation.
//
// Replaces the old pattern of POSTing the entire reservations list back via
// /api/store, which was triggering shrink_guard whenever the client's cache
// lagged behind concurrent submits.
//
// Calls the mark_overdue_email_sent RPC (migration 023) which does an atomic
// single-element JSONB update — same-length array, so shrink_guard never fires.

import { requireStaff } from "./_auth-helper.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const staff = await requireStaff(req, res);
  if (!staff) return;

  const { id } = req.body || {};
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "id is required" });
  }

  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/mark_overdue_email_sent`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_id: id }),
    });
    if (!r.ok) {
      const text = await r.text();
      console.error("mark-overdue-sent RPC error:", r.status, text);
      return res.status(r.status).json({ error: text });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("mark-overdue-sent network error:", e);
    return res.status(500).json({ error: e.message });
  }
}
