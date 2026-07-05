// productions-archive.js — daily cron: recompute the productions archive state.
//
// PURPOSE:
//   A production is "ended" once its latest shoot date (max production_dates.end_date)
//   has passed (Asia/Jerusalem). Ended published productions leave the active board
//   and move to the "ארכיון" view. This cron calls productions_refresh_archive_v1(NULL),
//   which sets productions.archived_at for newly-ended productions and clears it for
//   restored ones (a future date added). The record is never deleted — the client
//   hides student archives after a month; staff keep them forever.
//
// SCHEDULE:
//   Configured in vercel.json (03:00 UTC = 06:00 Israel). The RPC computes "today"
//   as Asia/Jerusalem in-DB, so the exact UTC hour does not matter. Idempotent: only
//   rows that actually change are written (changed:0 on steady-state days).
//
// SECURITY:
//   Vercel sets `Authorization: Bearer {CRON_SECRET}` on cron invocations; other
//   callers are rejected with 401 (same pattern as production-deadline-reminder.js).
//
// PROTOCOL:
//   GET /api/productions-archive
//   200: { ok, result: { ok, scope, today_il, changed } }
//   401: missing / wrong bearer token
//   5xx: RPC / fetch error

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (CRON_SECRET) {
    const auth = req.headers["authorization"] || "";
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/productions_refresh_archive_v1`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_production_id: null }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("productions-archive RPC error:", r.status, data);
      return res.status(r.status).json({ ok: false, error: data?.message || `rpc failed (${r.status})` });
    }
    console.log("productions-archive:", JSON.stringify(data));
    return res.status(200).json({ ok: true, result: data });
  } catch (e) {
    console.error("productions-archive error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
