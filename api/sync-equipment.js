// sync-equipment.js — primary equipment write path.
// Accepts the full equipment array from writeEquipmentToDB() and forwards it
// to the sync_equipment_from_json RPC, which upserts equipment +
// equipment_units atomically. Single source of truth — public.store was
// retired 2026-04-30, so this is no longer a mirror.

import { requireStaff } from "./_auth-helper.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const staff = await requireStaff(req, res);
  if (!staff) return;

  const { equipment } = req.body || {};
  if (!Array.isArray(equipment)) {
    return res.status(400).json({ error: "Missing or invalid equipment array" });
  }

  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/sync_equipment_from_json`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_equipment: equipment }),
    });

    if (!r.ok) {
      const text = await r.text();
      console.error("sync-equipment RPC error:", r.status, text);
      return res.status(r.status).json({ error: text });
    }

    const result = await r.json();
    return res.status(200).json({ ok: true, result });
  } catch (e) {
    console.error("sync-equipment network error:", e);
    return res.status(500).json({ error: e.message });
  }
}
