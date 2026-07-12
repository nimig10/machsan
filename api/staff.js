// staff.js - unified staff management API backed by public.users.
//
// Supported actions:
//   list / GET         - list staff/admin users
//   create / invite   - create an auth user + public.users row
//   update / update_user
//   delete / delete_user
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { requireAdmin, requireStaff } from "./_auth-helper.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const DEFAULT_PERMISSIONS = {
  views: [],
  warehouseSections: [],
  administrationSections: [],
  notifyLoanTypes: [],
  canEditDailyLessons: false,
};

function normalizeEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { headers, ...options });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

function toStaffUser(row) {
  const role = row?.is_admin ? "admin" : "staff";
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    role,
    is_admin: !!row.is_admin,
    is_warehouse: !!row.is_warehouse,
    permissions: { ...DEFAULT_PERMISSIONS, ...(row.permissions || {}) },
    created_at: row.created_at,
  };
}

function roleFlagsFromBody(body) {
  const role = body.role === "admin" ? "admin" : body.role === "staff" ? "staff" : null;
  const isAdmin = role ? role === "admin" : !!body.is_admin;
  const isWarehouse = role ? role !== "admin" : !!body.is_warehouse;
  return { is_admin: isAdmin, is_warehouse: isWarehouse };
}

async function findAuthUserByEmail(email) {
  try {
    const r = await sbFetch(`users?email=eq.${encodeURIComponent(email)}&select=id&limit=1`);
    if (r.ok && Array.isArray(r.data) && r.data[0]?.id) {
      const byId = await fetch(`${SB_URL}/auth/v1/admin/users/${r.data[0].id}`, { headers });
      if (byId.ok) {
        const u = await byId.json();
        if (u && normalizeEmail(u.email) === email) return u;
      }
    }
  } catch {}

  const perPage = 1000;
  for (let page = 1; page <= 50; page += 1) {
    const res = await fetch(`${SB_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
      headers,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const list = Array.isArray(data?.users) ? data.users : (Array.isArray(data) ? data : []);
    if (list.length === 0) return null;
    const found = list.find((u) => normalizeEmail(u.email) === email);
    if (found) return found;
    if (list.length < perPage) return null;
  }
  return null;
}

async function adminCount() {
  const r = await sbFetch("users?is_admin=eq.true&select=id");
  return Array.isArray(r.data) ? r.data.length : 0;
}

async function handleList(req, res, callerRole) {
  const select = callerRole === "admin"
    ? "id,full_name,email,is_admin,is_warehouse,permissions,created_at"
    : "id,full_name,email";
  const result = await sbFetch(
    `users?or=(is_admin.eq.true,is_warehouse.eq.true)&select=${select}&order=full_name.asc`,
  );
  if (!result.ok) return res.status(result.status).json({ error: "list_failed" });
  return res.status(200).json((result.data || []).map(toStaffUser));
}

async function handleCreate(req, res) {
  const { full_name, email, permissions } = req.body || {};
  const normEmail = normalizeEmail(email);
  if (!full_name?.trim()) return res.status(400).json({ error: "missing_name" });
  if (!isValidEmail(normEmail)) return res.status(400).json({ error: "invalid_email" });

  const flags = roleFlagsFromBody(req.body || {});

  // Email already has a public.users row → PROMOTE to multi-role instead of
  // erroring. The email might already be a student/lecturer who created their
  // own password; adding a staff role must (a) never touch their password,
  // (b) never drop an existing role. Merge staff flags with OR, keep
  // is_student/is_lecturer untouched.
  const existing = await sbFetch(`users?email=eq.${encodeURIComponent(normEmail)}&select=id,is_admin,is_warehouse,permissions`);
  if (existing.ok && Array.isArray(existing.data) && existing.data.length > 0) {
    const row = existing.data[0];
    const patch = {
      full_name: full_name.trim(),
      is_admin: !!row.is_admin || flags.is_admin,
      is_warehouse: !!row.is_warehouse || flags.is_warehouse,
      permissions: { ...DEFAULT_PERMISSIONS, ...(row.permissions || {}), ...(permissions || {}) },
      updated_at: new Date().toISOString(),
    };
    const upd = await sbFetch(`users?id=eq.${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (!upd.ok) {
      return res.status(upd.status).json({ error: upd.data?.message || "promote_failed" });
    }
    // Keep the auth user's metadata full_name in sync (password untouched).
    const authUser = await findAuthUserByEmail(normEmail);
    if (authUser) {
      await fetch(`${SB_URL}/auth/v1/admin/users/${authUser.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ user_metadata: { ...(authUser.user_metadata || {}), full_name: full_name.trim() } }),
      }).catch(() => {});
    }
    const promoted = Array.isArray(upd.data) ? upd.data[0] : upd.data;
    return res.status(200).json({ success: true, promoted: true, user: toStaffUser(promoted) });
  }

  let authUserId = null;
  const existingAuth = await findAuthUserByEmail(normEmail);
  if (existingAuth) {
    // Auth user exists but no public.users row (e.g. student who logged in
    // before). Update metadata only — never touch their self-created password.
    const authUpdate = {
      user_metadata: { ...(existingAuth.user_metadata || {}), full_name: full_name.trim() },
    };
    const updateRes = await fetch(`${SB_URL}/auth/v1/admin/users/${existingAuth.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(authUpdate),
    });
    if (!updateRes.ok) {
      return res.status(500).json({ error: "auth_update_failed", details: await updateRes.text() });
    }
    authUserId = existingAuth.id;
  } else {
    // Brand-new user — provision the auth row WITHOUT a password (like the
    // ensure-user onboarding flow). The user sets their own password via
    // "forgot password?" on first login.
    const authBody = {
      email: normEmail,
      email_confirm: true,
      user_metadata: { full_name: full_name.trim() },
    };
    const createRes = await fetch(`${SB_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers,
      body: JSON.stringify(authBody),
    });
    if (!createRes.ok) {
      return res.status(500).json({ error: "auth_create_failed", details: await createRes.text() });
    }
    authUserId = (await createRes.json()).id;
  }

  const insertRes = await sbFetch("users", {
    method: "POST",
    body: JSON.stringify({
      id: authUserId,
      full_name: full_name.trim(),
      email: normEmail,
      is_student: false,
      is_lecturer: false,
      ...flags,
      permissions: { ...DEFAULT_PERMISSIONS, ...(permissions || {}) },
    }),
  });
  if (!insertRes.ok) {
    return res.status(insertRes.status).json({ error: insertRes.data?.message || "insert_failed" });
  }
  const created = Array.isArray(insertRes.data) ? insertRes.data[0] : insertRes.data;
  return res.status(201).json({ success: true, user: toStaffUser(created), had_existing_auth: !!existingAuth });
}

async function handleUpdate(req, res) {
  const { id, full_name, email, password, permissions } = req.body || {};
  if (!id) return res.status(400).json({ error: "missing_id" });

  const current = await sbFetch(`users?id=eq.${encodeURIComponent(id)}&select=id,email,is_admin`);
  if (!current.ok || !Array.isArray(current.data) || current.data.length === 0) {
    return res.status(404).json({ error: "not_found" });
  }
  const currentUser = current.data[0];
  const flags = roleFlagsFromBody(req.body || {});
  if (currentUser.is_admin && flags.is_admin === false && (await adminCount()) <= 1) {
    return res.status(400).json({ error: "last_admin" });
  }

  const updates = { updated_at: new Date().toISOString() };
  if (full_name !== undefined) updates.full_name = full_name.trim();
  if (email !== undefined) {
    const normEmail = normalizeEmail(email);
    if (!isValidEmail(normEmail)) return res.status(400).json({ error: "invalid_email" });
    updates.email = normEmail;
  }
  if (req.body.role !== undefined || req.body.is_admin !== undefined) updates.is_admin = flags.is_admin;
  if (req.body.role !== undefined || req.body.is_warehouse !== undefined) updates.is_warehouse = flags.is_warehouse;
  if (permissions !== undefined) updates.permissions = { ...DEFAULT_PERMISSIONS, ...permissions };

  const result = await sbFetch(`users?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
  if (!result.ok) return res.status(result.status).json({ error: "update_failed" });

  const authUpdate = {};
  if (password) authUpdate.password = password;
  if (full_name !== undefined) authUpdate.user_metadata = { full_name: full_name.trim() };
  if (email !== undefined) {
    authUpdate.email = normalizeEmail(email);
    authUpdate.email_confirm = true;
  }
  if (Object.keys(authUpdate).length > 0) {
    await fetch(`${SB_URL}/auth/v1/admin/users/${id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(authUpdate),
    }).catch(() => {});
  }
  return res.status(200).json({ success: true });
}

async function handleDelete(req, res) {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "missing_id" });
  const target = await sbFetch(`users?id=eq.${encodeURIComponent(id)}&select=is_admin,email`);
  if (!target.ok || !Array.isArray(target.data) || target.data.length === 0) {
    return res.status(404).json({ error: "not_found" });
  }
  if (target.data[0]?.is_admin && (await adminCount()) <= 1) {
    return res.status(400).json({ error: "last_admin" });
  }

  // "Delete staff" = remove the STAFF ROLE, not destroy the person. If the
  // email is still registered as a student or active lecturer, only clear the
  // staff flags — NEVER delete the public.users row or the auth user, so their
  // login (password) and student/lecturer access survive. Mirrors the guard in
  // api/auth.js handleDeleteStudentAuth. Only a truly orphaned email (no other
  // role anywhere) gets a full delete.
  const email = normalizeEmail(target.data[0]?.email || "");
  const [stu, lec] = await Promise.all([
    email ? sbFetch(`students?email=eq.${encodeURIComponent(email)}&select=id&limit=1`) : Promise.resolve({ ok: true, data: [] }),
    email ? sbFetch(`lecturers?email=ilike.${encodeURIComponent(email)}&is_active=eq.true&select=id&limit=1`) : Promise.resolve({ ok: true, data: [] }),
  ]);
  const stillStudent = Array.isArray(stu.data) && stu.data.length > 0;
  const stillLecturer = Array.isArray(lec.data) && lec.data.length > 0;

  if (stillStudent || stillLecturer) {
    const upd = await sbFetch(`users?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ is_admin: false, is_warehouse: false, updated_at: new Date().toISOString() }),
    });
    if (!upd.ok) return res.status(upd.status).json({ error: "downgrade_failed" });
    return res.status(200).json({ success: true, downgraded: true });
  }

  // No other role anywhere → full offboard (users row + auth user).
  const delResult = await sbFetch(`users?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!delResult.ok) return res.status(delResult.status).json({ error: "delete_failed" });
  const remaining = await sbFetch(`users?id=eq.${encodeURIComponent(id)}&select=id`);
  if (!remaining.ok || !remaining.data?.length) {
    await fetch(`${SB_URL}/auth/v1/admin/users/${id}`, { method: "DELETE", headers }).catch(() => {});
  }
  return res.status(200).json({ success: true });
}

export default async function handler(req, res) {
  const { action } = req.body || {};

  if (action === "migrate") {
    return res.status(410).json({ error: "staff_migration_removed" });
  }

  if (req.method === "GET" || action === "list") {
    const caller = await requireStaff(req, res);
    if (!caller) return;
    return await handleList(req, res, caller.role);
  }

  if (["create", "invite"].includes(action)) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    return await handleCreate(req, res);
  }

  if (["update", "update_user"].includes(action)) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    return await handleUpdate(req, res);
  }

  if (["delete", "delete_user"].includes(action)) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    return await handleDelete(req, res);
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  return res.status(400).json({ error: "Unknown action" });
}
