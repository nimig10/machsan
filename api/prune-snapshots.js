// prune-snapshots.js — monthly garbage-collection for store_snapshots.
//
// PURPOSE:
//   store_snapshots accumulates one row per protected-key write (migration 011).
//   Left alone it will grow indefinitely. prune_store_snapshots(keep_days)
//   deletes non-blocked rows older than keep_days (blocked rows are kept forever
//   for forensics). This endpoint is called by the Vercel monthly cron.
//
// SECURITY:
//   Vercel sets `Authorization: Bearer {CRON_SECRET}` on cron requests when
//   CRON_SECRET is configured as an env var in the Vercel project. Requests
//   without the matching header are rejected with 401.
//   See: https://vercel.com/docs/cron-jobs/manage-cron-jobs
//
// PROTOCOL:
//   GET /api/prune-snapshots
//   200:  { ok: true, deleted: N, keep_days: 30 }
//   401:  missing / wrong bearer token
//   5xx:  rpc error

const SB_URL  = process.env.SUPABASE_URL;
const SB_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const KEEP_DAYS = 30;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // Reject requests that don't carry the cron secret.
  // Vercel crons send: Authorization: Bearer <CRON_SECRET>
  if (CRON_SECRET) {
    const auth = req.headers["authorization"] || "";
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }

  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/prune_store_snapshots`, {
      method: "POST",
      headers: {
        apikey:        SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_keep_days: KEEP_DAYS }),
    });

    if (!r.ok) {
      const text = await r.text();
      console.error("prune-snapshots RPC error:", r.status, text);
      return res.status(r.status).json({ ok: false, error: "rpc_error", detail: text });
    }

    const deleted = await r.json();          // prune_store_snapshots returns INT
    console.log(`prune-snapshots: deleted ${deleted} rows (keep_days=${KEEP_DAYS})`);
    return res.status(200).json({ ok: true, deleted, keep_days: KEEP_DAYS });

  } catch (e) {
    console.error("prune-snapshots network error:", e);
    return res.status(500).json({ ok: false, error: "network_error", detail: e.message });
  }
}
