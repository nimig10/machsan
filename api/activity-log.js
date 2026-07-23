// activity-log.js — write + read activity logs
//
// AUTH: every action requires a staff JWT. `write` and `delete` used to run
// unauthenticated straight through the service_role key, which left the audit
// trail open to anyone on the internet — forged entries, and deletion of any
// row whose id was known. Nothing in the app reads activity_logs as a data
// source (lesson #37 rejects it explicitly), so the exposure was audit
// integrity plus an uncapped public INSERT rather than an inventory risk.
//
// Gating them on requireStaff costs nothing operationally: every one of the
// ~25 logActivity() call sites is staff-side (equipment, categories, dept
// heads, team members, students, reservations, staff session recovery), and
// PublicForm never logs activity at all — there is no anonymous caller.
//
// user_id/user_name still come from the request body rather than the JWT.
// Deriving them server-side would change the names already displayed in the
// log; the token now only proves the caller is staff.
import { requireAdmin, requireStaff } from "./_auth-helper.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

  // WRITE — returns created log id (staff only)
  if (action === "write") {
    const staff = await requireStaff(req, res);
    if (!staff) return;
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
    const id = result.data?.[0]?.id || null;
    return res.status(result.ok ? 201 : 500).json({ ok: result.ok, id });
  }

  // DELETE — remove a log entry by id (used when undo reverts the action; staff only)
  if (action === "delete") {
    const staff = await requireStaff(req, res);
    if (!staff) return;
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "Missing id" });
    const result = await sbFetch(`activity_logs?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
    return res.status(result.ok ? 200 : 500).json({ ok: result.ok });
  }

  // LIST — admin only
  if (action === "list") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const { limit = 100, offset = 0, filterAction, filterUser } = req.body;

    let query = `activity_logs?order=created_at.desc&limit=${limit}&offset=${offset}`;
    if (filterAction) query += `&action=eq.${encodeURIComponent(filterAction)}`;
    if (filterUser) query += `&user_id=eq.${encodeURIComponent(filterUser)}`;

    const result = await sbFetch(query);
    return res.status(result.ok ? 200 : 500).json(result.data || []);
  }

  // ACTIONS — distinct action types actually present in the data. Only used to
  // append data-only extras beyond the curated client list, so ordering here is
  // irrelevant. Ordered by created_at.desc with a high cap (NOT action.asc): the
  // old alphabetical order + PostgREST's 1000-row cap let thousands of "login"
  // rows fill the window and truncate every action after "login" alphabetically
  // (reservation_*, staff_*, student_*…), hiding them from the filter entirely.
  if (action === "actions") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const result = await sbFetch("activity_logs?select=action&order=created_at.desc&limit=5000");
    const unique = [...new Set((result.data || []).map(r => r.action))];
    return res.status(200).json(unique);
  }

  // USERS — get distinct users for filter dropdown
  if (action === "users") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const result = await sbFetch("activity_logs?select=user_id,user_name&order=user_name.asc");
    const map = {};
    (result.data || []).forEach(r => { if (r.user_id && !map[r.user_id]) map[r.user_id] = r.user_name; });
    return res.status(200).json(Object.entries(map).map(([id, name]) => ({ id, name })));
  }

  return res.status(400).json({ error: "Unknown action" });
}
