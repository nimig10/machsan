// activity-log.js — write + read activity logs
const SB_URL = process.env.SUPABASE_URL || "https://wxkyqgwwraojnbmyyfco.supabase.co";
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "sb_publishable_n-mkSq7xABjj58ZBBwk6BA_RbpVS2SU";

const headers = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { headers, ...options });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action } = req.body || {};

  // WRITE — fire-and-forget from frontend
  if (action === "write") {
    const { user_id, user_name, activity, entity, entity_id, details } = req.body;
    if (!activity) return res.status(400).json({ error: "Missing activity" });
    const result = await sbFetch("activity_logs", {
      method: "POST",
      body: JSON.stringify({
        user_id: user_id || null,
        user_name: user_name || null,
        action: activity,
        entity: entity || null,
        entity_id: entity_id || null,
        details: details || {},
      }),
    });
    return res.status(result.ok ? 201 : 500).json({ ok: result.ok });
  }

  // LIST — admin only
  if (action === "list") {
    const { callerRole, limit = 100, offset = 0, filterAction, filterUser } = req.body;
    if (callerRole !== "admin") return res.status(403).json({ error: "Forbidden" });

    let query = `activity_logs?order=created_at.desc&limit=${limit}&offset=${offset}`;
    if (filterAction) query += `&action=eq.${encodeURIComponent(filterAction)}`;
    if (filterUser) query += `&user_id=eq.${encodeURIComponent(filterUser)}`;

    const result = await sbFetch(query);
    return res.status(result.ok ? 200 : 500).json(result.data || []);
  }

  // ACTIONS — get distinct action types for filter dropdown
  if (action === "actions") {
    const { callerRole } = req.body;
    if (callerRole !== "admin") return res.status(403).json({ error: "Forbidden" });
    const result = await sbFetch("activity_logs?select=action&order=action.asc");
    const unique = [...new Set((result.data || []).map(r => r.action))];
    return res.status(200).json(unique);
  }

  // USERS — get distinct users for filter dropdown
  if (action === "users") {
    const { callerRole } = req.body;
    if (callerRole !== "admin") return res.status(403).json({ error: "Forbidden" });
    const result = await sbFetch("activity_logs?select=user_id,user_name&order=user_name.asc");
    const map = {};
    (result.data || []).forEach(r => { if (r.user_id && !map[r.user_id]) map[r.user_id] = r.user_name; });
    return res.status(200).json(Object.entries(map).map(([id, name]) => ({ id, name })));
  }

  return res.status(400).json({ error: "Unknown action" });
}
