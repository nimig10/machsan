import bcrypt from "bcryptjs";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const DEFAULT_PERMISSIONS = {
  views: [],               // [] = all views; or ["warehouse","administration"]
  warehouseSections: [],   // [] = all; or specific section ids
  administrationSections: [],
  notifyLoanTypes: [],     // [] = none; or ["פרטית","הפקה","סאונד","קולנוע יומית","שיעור"]
};

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { headers, ...options });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

export default async function handler(req, res) {
  const { method } = req;
  const { action, callerRole } = req.body || {};

  // LIST — allow all staff (return limited fields for non-admin)
  if (method === "GET" || action === "list") {
    if (callerRole !== "admin") {
      const result = await sbFetch("staff_members?select=id,full_name&order=created_at.asc");
      return res.status(result.ok ? 200 : 500).json(result.data || []);
    }
    const result = await sbFetch("staff_members?select=id,full_name,email,role,permissions,created_at&order=created_at.asc");
    return res.status(result.ok ? 200 : 500).json(result.data || []);
  }

  if (callerRole !== "admin") {
    return res.status(403).json({ error: "Forbidden — admin only" });
  }

  if (method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // CREATE
  if (action === "create") {
    const { full_name, email, role, password, permissions } = req.body;
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
        permissions: { ...DEFAULT_PERMISSIONS, ...(permissions || {}) },
      }),
    });
    if (!result.ok) {
      const msg = result.data?.message || result.data?.error || "Failed to create";
      return res.status(result.status).json({ error: msg });
    }
    const user = Array.isArray(result.data) ? result.data[0] : result.data;
    return res.status(201).json({ success: true, user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role, permissions: user.permissions } });
  }

  // ── Helper: count how many admins exist ──
  async function adminCount() {
    const r = await sbFetch("staff_members?role=eq.admin&select=id");
    return Array.isArray(r.data) ? r.data.length : 0;
  }

  // UPDATE
  if (action === "update") {
    const { id, full_name, email, role, password, permissions } = req.body;
    if (!id) return res.status(400).json({ error: "Missing id" });

    // Guard: prevent demoting the last admin
    if (role === "staff") {
      const current = await sbFetch(`staff_members?id=eq.${id}&select=role`);
      const wasAdmin = Array.isArray(current.data) && current.data[0]?.role === "admin";
      if (wasAdmin && (await adminCount()) <= 1) {
        return res.status(400).json({ error: "last_admin" });
      }
    }

    const updates = { updated_at: new Date().toISOString() };
    if (full_name) updates.full_name = full_name.trim();
    if (email) updates.email = email.trim().toLowerCase();
    if (role) updates.role = role === "admin" ? "admin" : "staff";
    if (password) updates.password_hash = await bcrypt.hash(password, 10);
    if (permissions !== undefined) updates.permissions = { ...DEFAULT_PERMISSIONS, ...permissions };
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

    // Guard: prevent deleting the last admin
    const target = await sbFetch(`staff_members?id=eq.${id}&select=role`);
    const isAdmin = Array.isArray(target.data) && target.data[0]?.role === "admin";
    if (isAdmin && (await adminCount()) <= 1) {
      return res.status(400).json({ error: "last_admin" });
    }

    const result = await sbFetch(`staff_members?id=eq.${id}`, { method: "DELETE" });
    if (!result.ok) return res.status(result.status).json({ error: "Failed to delete" });
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: "Unknown action" });
}
