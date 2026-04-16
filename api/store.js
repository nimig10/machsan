// store.js — server-side proxy for writing to the store table.
// Uses SERVICE_ROLE_KEY so writes bypass RLS. This lets us lock down
// the anon role to read-only (+ reservations/studio_bookings only).
//
// SHRINK GUARD (migration 011):
//   The DB has a BEFORE UPDATE trigger on `store` that blocks writes which
//   shrink a protected array by more than 20% + 3 rows. That trigger raises
//   P0001 with a descriptive message. Here we recognise that error, surface
//   it as HTTP 409 with a machine-readable code so the client can show a
//   useful Hebrew message and auto-refresh from the server before retrying.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "resolution=merge-duplicates",
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { key, data } = req.body || {};
  if (!key || data === undefined) {
    return res.status(400).json({ error: "Missing key or data" });
  }

  try {
    const r = await fetch(`${SB_URL}/rest/v1/store`, {
      method: "POST",
      headers,
      body: JSON.stringify({ key, data, updated_at: new Date().toISOString() }),
    });

    if (!r.ok) {
      const text = await r.text();
      // Recognise the shrink-guard error — map to 409 with a specific code
      // so the client can react (refresh, alert user) instead of silently
      // showing a generic "save failed".
      if (/SHRINK GUARD/i.test(text)) {
        console.warn(`[shrink-guard BLOCKED] key=${key} size=${Array.isArray(data) ? data.length : "N/A"} — ${text}`);
        return res.status(409).json({
          error:  "shrink_guard_blocked",
          key,
          detail: text,
        });
      }
      return res.status(r.status).json({ error: text });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
