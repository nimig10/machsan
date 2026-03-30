import bcrypt from "bcryptjs";

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
  const { method } = req;
  const { action, callerRole } = req.body || {};

  // Only admins can manage staff
  if (callerRole !== "admin") {
    return res.status(403).json({ error: "Forbidden — admin only" });
  }

  // LIST
  if (method === "GET" || action === "list") {
    const result = await sbFetch("staff_members?select=id,full_name,email,role,created_at&order=created_at.asc");
    return res.status(result.ok ? 200 : 500).json(result.data || []);
  }

  if (method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // CREATE
  if (action === "create") {
    const { full_name, email, role, password } = req.body;
    if (!full_name || !email || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const result = await sbFetch("staff_members", {
      method: "POST",
      body: JSON.stringify({
        full_name: full_name.trim(),
        email: email.trim().toLowerCase(),
        role: role === "admin" ? "admin" : "staff",
        password_hash,
      }),
    });
    if (!result.ok) {
      const msg = result.data?.message || result.data?.error || "Failed to create";
      return res.status(result.status).json({ error: msg });
    }
    const user = Array.isArray(result.data) ? result.data[0] : result.data;
    return res.status(201).json({ success: true, user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role } });
  }

  // UPDATE
  if (action === "update") {
    const { id, full_name, email, role, password } = req.body;
    if (!id) return res.status(400).json({ error: "Missing id" });
    const updates = { updated_at: new Date().toISOString() };
    if (full_name) updates.full_name = full_name.trim();
    if (email) updates.email = email.trim().toLowerCase();
    if (role) updates.role = role === "admin" ? "admin" : "staff";
    if (password) updates.password_hash = await bcrypt.hash(password, 10);
    const result = await sbFetch(`staff_members?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
    if (!result.ok) return res.status(result.status).json({ error: "Failed to update" });
    return res.status(200).json({ success: true });
  }

  // DELETE
  if (action === "delete") {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "Missing id" });
    const result = await sbFetch(`staff_members?id=eq.${id}`, { method: "DELETE" });
    if (!result.ok) return res.status(result.status).json({ error: "Failed to delete" });
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: "Unknown action" });
}
