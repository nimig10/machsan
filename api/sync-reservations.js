// sync-reservations.js — dual-write mirror for reservations.
// Called from storageSet after a successful write to store. Mirrors the full
// reservations array into the normalized tables (reservations_new + items)
// via the sync_reservations_from_json RPC. Never blocks the main write —
// failures are logged, not surfaced to the user.
//
// AUTHORIZATION: staff-only. Anonymous callers (or non-staff students) must
// not be able to replace the normalized reservations mirror — that would let
// an attacker overwrite other users' approval state and equipment
// assignments. The client sends the Supabase session JWT as
// `Authorization: Bearer <token>`; requireStaff verifies it and checks
// staff_members / public.users for staff/admin role.

import { requireStaff } from "./_auth-helper.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const staff = await requireStaff(req, res);
  if (!staff) return; // 401/403 already sent

  const { reservations } = req.body || {};
  if (!Array.isArray(reservations)) {
    return res.status(400).json({ error: "Missing or invalid reservations array" });
  }

  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/sync_reservations_from_json`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_reservations: reservations }),
    });

    if (!r.ok) {
      const text = await r.text();
      console.error("sync-reservations RPC error:", r.status, text);
      return res.status(r.status).json({ error: text });
    }

    const result = await r.json();
    return res.status(200).json({ ok: true, result });
  } catch (e) {
    console.error("sync-reservations network error:", e);
    return res.status(500).json({ error: e.message });
  }
}
