// staff.js — unified staff management API
//
// Legacy actions (staff_members table — old auth system):
//   list, create, update, delete
//
// New actions (public.users table — unified auth system):
//   invite, update_user, delete_user, migrate
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MIGRATION_SECRET (for migrate)

import bcrypt from "bcryptjs";
import { requireAdmin, requireStaff } from "./_auth-helper.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MIGRATION_SECRET = process.env.MIGRATION_SECRET;

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
  canEditDailyLessons: false,
};

// ── shared helpers ───────────────────────────────────────────────────────────

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

async function findAuthUserByEmail(email) {
  // Fast path: public.users has an indexed email column; resolve the auth id
  // there first and fetch the auth row by id directly (O(1) instead of O(n)).
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
  // Fallback: paginated admin scan (handles cases where public.users row is
  // missing or out of sync with the auth record).
  const perPage = 1000;
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(
      `${SB_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
      { headers },
    );
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

async function newAdminCount() {
  const r = await sbFetch("users?is_admin=eq.true&select=id");
  return Array.isArray(r.data) ? r.data.length : 0;
}

async function fetchStoreKey(key) {
  const res = await fetch(
    `${SB_URL}/rest/v1/store?key=eq.${encodeURIComponent(key)}&select=data`,
    { headers },
  );
  if (!res.ok) return null;
  const json = await res.json();
  return Array.isArray(json) && json.length > 0 ? json[0].data : null;
}

// ══════════════════════════════════════════════════════════════════════════════
// LEGACY actions (staff_members table) — will be removed after full migration
// ══════════════════════════════════════════════════════════════════════════════

async function legacyAdminCount() {
  const r = await sbFetch("staff_members?role=eq.admin&select=id");
  return Array.isArray(r.data) ? r.data.length : 0;
}

function handleLegacy(req, res, callerRole) {
  const { method } = req;
  const { action } = req.body || {};

  // LIST
  if (method === "GET" || action === "list") {
    return (async () => {
      if (callerRole !== "admin") {
        const result = await sbFetch("staff_members?select=id,full_name&order=created_at.asc");
        return res.status(result.ok ? 200 : 500).json(result.data || []);
      }
      const result = await sbFetch("staff_members?select=id,full_name,email,role,permissions,created_at&order=created_at.asc");
      return res.status(result.ok ? 200 : 500).json(result.data || []);
    })();
  }

  if (callerRole !== "admin") {
    return res.status(403).json({ error: "Forbidden — admin only" });
  }

  // CREATE
  if (action === "create") {
    return (async () => {
      const { full_name, email, role, password, permissions } = req.body;
      if (!full_name || !email || !password) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const normEmail = normalizeEmail(email);
      const isAdmin = role === "admin";
      const password_hash = await bcrypt.hash(password, 10);

      // 1. Insert into legacy staff_members table
      const result = await sbFetch("staff_members", {
        method: "POST",
        body: JSON.stringify({
          full_name: full_name.trim(),
          email: normEmail,
          role: isAdmin ? "admin" : "staff",
          password_hash,
          permissions: { ...DEFAULT_PERMISSIONS, ...(permissions || {}) },
        }),
      });
      if (!result.ok) {
        const msg = result.data?.message || result.data?.error || "Failed to create";
        return res.status(result.status).json({ error: msg });
      }
      const user = Array.isArray(result.data) ? result.data[0] : result.data;

      // 2. Provision Supabase auth user with the given password
      let authUserId = null;
      const existingAuth = await findAuthUserByEmail(normEmail);
      if (existingAuth) {
        // Update password + metadata on existing auth user
        await fetch(`${SB_URL}/auth/v1/admin/users/${existingAuth.id}`, {
          method: "PUT", headers,
          body: JSON.stringify({ password, user_metadata: { full_name: full_name.trim() } }),
        }).catch(() => {});
        authUserId = existingAuth.id;
      } else {
        const authRes = await fetch(`${SB_URL}/auth/v1/admin/users`, {
          method: "POST", headers,
          body: JSON.stringify({
            email: normEmail,
            password,
            email_confirm: true,
            user_metadata: { full_name: full_name.trim() },
          }),
        });
        if (authRes.ok) {
          authUserId = (await authRes.json()).id;
        }
      }

      // 3. Upsert public.users row so routeByRoles can route the staff member
      if (authUserId) {
        const existingPublic = await sbFetch(`users?id=eq.${authUserId}&select=id`);
        if (!existingPublic.ok || !Array.isArray(existingPublic.data) || existingPublic.data.length === 0) {
          await sbFetch("users", {
            method: "POST",
            body: JSON.stringify({
              id: authUserId,
              full_name: full_name.trim(),
              email: normEmail,
              is_admin: isAdmin,
              is_warehouse: !isAdmin,
              is_student: false,
              is_lecturer: false,
              permissions: { ...DEFAULT_PERMISSIONS, ...(permissions || {}) },
            }),
          }).catch(() => {});
        } else {
          // Exists — just ensure role flags are set correctly
          await sbFetch(`users?id=eq.${authUserId}`, {
            method: "PATCH",
            body: JSON.stringify({
              is_admin: isAdmin,
              is_warehouse: !isAdmin,
              updated_at: new Date().toISOString(),
            }),
          }).catch(() => {});
        }
      }

      return res.status(201).json({ success: true, user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role, permissions: user.permissions } });
    })();
  }

  // UPDATE
  if (action === "update") {
    return (async () => {
      const { id, full_name, email, role, password, permissions } = req.body;
      if (!id) return res.status(400).json({ error: "Missing id" });
      if (role === "staff") {
        const current = await sbFetch(`staff_members?id=eq.${id}&select=role`);
        const wasAdmin = Array.isArray(current.data) && current.data[0]?.role === "admin";
        if (wasAdmin && (await legacyAdminCount()) <= 1) {
          return res.status(400).json({ error: "last_admin" });
        }
      }
      // Capture previous email BEFORE patching, so we can locate the existing
      // auth user even if the admin is changing their email address.
      let prevEmail = null;
      if (email) {
        const prev = await sbFetch(`staff_members?id=eq.${id}&select=email`);
        prevEmail = Array.isArray(prev.data) && prev.data[0]?.email
          ? normalizeEmail(prev.data[0].email) : null;
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

      // Sync changes (email / password / name) to Supabase auth + public.users.
      // Email sync is critical: without it, an admin's email change leaves the
      // auth account pinned to the old address → user cannot log in.
      if (email) {
        const normEmail = normalizeEmail(email);
        let authUser = await findAuthUserByEmail(normEmail);
        if (!authUser && prevEmail && prevEmail !== normEmail) {
          authUser = await findAuthUserByEmail(prevEmail);
        }
        if (authUser) {
          const authUpdate = {};
          if (password) authUpdate.password = password;
          if (normEmail && normalizeEmail(authUser.email || "") !== normEmail) {
            authUpdate.email = normEmail;
            authUpdate.email_confirm = true;
          }
          if (full_name) authUpdate.user_metadata = { ...(authUser.user_metadata || {}), full_name: full_name.trim() };
          if (Object.keys(authUpdate).length) {
            await fetch(`${SB_URL}/auth/v1/admin/users/${authUser.id}`, {
              method: "PUT", headers,
              body: JSON.stringify(authUpdate),
            }).catch(() => {});
          }
          // Mirror onto public.users (keyed by auth user id)
          const publicUpdate = { updated_at: new Date().toISOString() };
          if (normEmail) publicUpdate.email = normEmail;
          if (full_name) publicUpdate.full_name = full_name.trim();
          await sbFetch(`users?id=eq.${authUser.id}`, {
            method: "PATCH",
            body: JSON.stringify(publicUpdate),
          }).catch(() => {});
        }
      }

      return res.status(200).json({ success: true });
    })();
  }

  // DELETE
  if (action === "delete") {
    return (async () => {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Missing id" });
      const target = await sbFetch(`staff_members?id=eq.${id}&select=role`);
      const isAdmin = Array.isArray(target.data) && target.data[0]?.role === "admin";
      if (isAdmin && (await legacyAdminCount()) <= 1) {
        return res.status(400).json({ error: "last_admin" });
      }
      const result = await sbFetch(`staff_members?id=eq.${id}`, { method: "DELETE" });
      if (!result.ok) return res.status(result.status).json({ error: "Failed to delete" });
      return res.status(200).json({ success: true });
    })();
  }

  return null; // not a legacy action
}

// ══════════════════════════════════════════════════════════════════════════════
// NEW actions (public.users table) — unified auth system
// ══════════════════════════════════════════════════════════════════════════════

async function handleInvite(req, res) {
  const { full_name, email, is_warehouse, is_admin, permissions } = req.body;
  const normEmail = normalizeEmail(email);
  if (!full_name?.trim()) return res.status(400).json({ error: "missing_name" });
  if (!isValidEmail(normEmail)) return res.status(400).json({ error: "invalid_email" });

  const existing = await sbFetch(`users?email=eq.${encodeURIComponent(normEmail)}&select=id`);
  if (existing.ok && Array.isArray(existing.data) && existing.data.length > 0) {
    return res.status(409).json({ error: "email_exists" });
  }

  let authUserId;
  const existingAuth = await findAuthUserByEmail(normEmail);
  if (existingAuth) {
    const currentMeta = existingAuth.user_metadata || {};
    const updateRes = await fetch(`${SB_URL}/auth/v1/admin/users/${existingAuth.id}`, {
      method: "PUT", headers,
      body: JSON.stringify({ user_metadata: { ...currentMeta, full_name: full_name.trim() } }),
    });
    if (!updateRes.ok) return res.status(500).json({ error: "auth_update_failed", details: await updateRes.text() });
    authUserId = existingAuth.id;
  } else {
    const inviteRes = await fetch(`${SB_URL}/auth/v1/admin/users`, {
      method: "POST", headers,
      body: JSON.stringify({ email: normEmail, email_confirm: true, user_metadata: { full_name: full_name.trim() } }),
    });
    if (!inviteRes.ok) return res.status(500).json({ error: "auth_invite_failed", details: await inviteRes.text() });
    authUserId = (await inviteRes.json()).id;
    await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
      method: "POST", headers,
      body: JSON.stringify({ type: "magiclink", email: normEmail, options: { redirectTo: `${req.headers.origin || "https://machsan.vercel.app"}/admin` } }),
    }).catch(() => {});
  }

  const insertRes = await sbFetch("users", {
    method: "POST",
    body: JSON.stringify({
      id: authUserId, full_name: full_name.trim(), email: normEmail,
      is_student: false, is_lecturer: false, is_warehouse: !!is_warehouse, is_admin: !!is_admin,
      permissions: { ...DEFAULT_PERMISSIONS, ...(permissions || {}) },
    }),
  });
  if (!insertRes.ok) return res.status(insertRes.status).json({ error: insertRes.data?.message || "insert_failed" });
  const created = Array.isArray(insertRes.data) ? insertRes.data[0] : insertRes.data;
  return res.status(201).json({ success: true, user: { id: created.id, full_name: created.full_name, email: created.email, is_warehouse: created.is_warehouse, is_admin: created.is_admin, permissions: created.permissions }, had_existing_auth: !!existingAuth });
}

async function handleUpdateUser(req, res) {
  const { id, full_name, email, is_warehouse, is_admin, permissions } = req.body;
  if (!id) return res.status(400).json({ error: "missing_id" });
  if (is_admin === false) {
    const current = await sbFetch(`users?id=eq.${id}&select=is_admin`);
    if (Array.isArray(current.data) && current.data[0]?.is_admin && (await newAdminCount()) <= 1) {
      return res.status(400).json({ error: "last_admin" });
    }
  }
  const updates = { updated_at: new Date().toISOString() };
  if (full_name !== undefined) updates.full_name = full_name.trim();
  if (email !== undefined) updates.email = normalizeEmail(email);
  if (is_warehouse !== undefined) updates.is_warehouse = !!is_warehouse;
  if (is_admin !== undefined) updates.is_admin = !!is_admin;
  if (permissions !== undefined) updates.permissions = { ...DEFAULT_PERMISSIONS, ...permissions };
  const result = await sbFetch(`users?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(updates) });
  if (!result.ok) return res.status(result.status).json({ error: "update_failed" });
  if (full_name !== undefined || email !== undefined) {
    const authUpdate = {};
    if (full_name !== undefined) authUpdate.user_metadata = { full_name: full_name.trim() };
    if (email !== undefined) {
      authUpdate.email = normalizeEmail(email);
      authUpdate.email_confirm = true;
    }
    await fetch(`${SB_URL}/auth/v1/admin/users/${id}`, {
      method: "PUT", headers,
      body: JSON.stringify(authUpdate),
    }).catch(() => {});
  }
  return res.status(200).json({ success: true });
}

async function handleDeleteUser(req, res) {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "missing_id" });
  const target = await sbFetch(`users?id=eq.${id}&select=is_admin`);
  if (Array.isArray(target.data) && target.data[0]?.is_admin && (await newAdminCount()) <= 1) {
    return res.status(400).json({ error: "last_admin" });
  }
  const delResult = await sbFetch(`users?id=eq.${id}`, { method: "DELETE" });
  if (!delResult.ok) return res.status(delResult.status).json({ error: "delete_failed" });
  const remaining = await sbFetch(`users?id=eq.${id}&select=id`);
  if (!remaining.ok || !remaining.data?.length) {
    await fetch(`${SB_URL}/auth/v1/admin/users/${id}`, { method: "DELETE", headers }).catch(() => {});
  }
  return res.status(200).json({ success: true });
}

// ── MIGRATE (one-off, secret-protected) ──────────────────────────────────────

async function loadAllAuthUsers() {
  const map = new Map();
  const perPage = 1000;
  for (let page = 1; page <= 50; page++) {
    const r = await fetch(`${SB_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, { headers });
    if (!r.ok) break;
    const data = await r.json();
    const list = Array.isArray(data?.users) ? data.users : (Array.isArray(data) ? data : []);
    if (list.length === 0) break;
    for (const u of list) { if (u.email) map.set(normalizeEmail(u.email), u); }
    if (list.length < perPage) break;
  }
  return map;
}

async function loadExistingPublicUsers() {
  const r = await sbFetch("users?select=email");
  const set = new Set();
  if (r.ok && Array.isArray(r.data)) {
    for (const row of r.data) { if (row.email) set.add(normalizeEmail(row.email)); }
  }
  return set;
}

async function handleMigrate(req, res) {
  const { secret } = req.body || {};
  if (!MIGRATION_SECRET || secret !== MIGRATION_SECRET) {
    return res.status(403).json({ error: "Invalid migration secret" });
  }

  const results = { staff: [], students: [], lecturers: [], errors: [] };
  const authUsersMap = await loadAllAuthUsers();
  const existingEmails = await loadExistingPublicUsers();

  // 1. Migrate staff_members
  const staffRes = await sbFetch("staff_members?select=id,full_name,email,role,permissions&order=created_at.asc");
  const staffMembers = staffRes.ok && Array.isArray(staffRes.data) ? staffRes.data : [];
  for (const sm of staffMembers) {
    const email = normalizeEmail(sm.email);
    if (!email) continue;
    if (existingEmails.has(email)) { results.staff.push({ email, status: "skipped", reason: "already_in_public_users" }); continue; }
    try {
      let authUserId, authExisted = false;
      const ea = authUsersMap.get(email);
      if (ea) {
        authUserId = ea.id; authExisted = true;
        await fetch(`${SB_URL}/auth/v1/admin/users/${ea.id}`, { method: "PUT", headers, body: JSON.stringify({ user_metadata: { ...(ea.user_metadata || {}), full_name: sm.full_name } }) });
      } else {
        const cr = await fetch(`${SB_URL}/auth/v1/admin/users`, { method: "POST", headers, body: JSON.stringify({ email, email_confirm: true, user_metadata: { full_name: sm.full_name } }) });
        if (!cr.ok) { results.errors.push({ email, step: "auth_create", error: await cr.text() }); continue; }
        authUserId = (await cr.json()).id;
      }
      const isAdm = sm.role === "admin";
      const ir = await sbFetch("users", { method: "POST", body: JSON.stringify({ id: authUserId, full_name: sm.full_name, email, is_student: false, is_lecturer: false, is_warehouse: true, is_admin: isAdm, permissions: { ...DEFAULT_PERMISSIONS, ...(sm.permissions || {}) } }) });
      if (!ir.ok) { results.errors.push({ email, step: "public_users_insert", error: ir.data?.message || ir.data?.error }); continue; }
      await fetch(`${SB_URL}/auth/v1/admin/generate_link`, { method: "POST", headers, body: JSON.stringify({ type: "recovery", email, options: { redirectTo: `${req.headers.origin || "https://machsan.vercel.app"}/admin` } }) }).catch(() => {});
      existingEmails.add(email);
      results.staff.push({ email, status: "migrated", auth_existed: authExisted, is_admin: isAdm });
    } catch (err) { results.errors.push({ email, step: "staff_loop", error: String(err) }); }
  }

  // 2. Migrate students
  const certs = await fetchStoreKey("certifications");
  const students = Array.isArray(certs?.students) ? certs.students : [];
  for (const stu of students) {
    const email = normalizeEmail(stu.email);
    if (!email) continue;
    if (existingEmails.has(email)) {
      try { await sbFetch(`users?email=eq.${encodeURIComponent(email)}`, { method: "PATCH", body: JSON.stringify({ is_student: true }) }); results.students.push({ email, status: "upgraded" }); }
      catch (err) { results.errors.push({ email, step: "student_upgrade", error: String(err) }); }
      continue;
    }
    try {
      let authUserId;
      const ea = authUsersMap.get(email);
      if (ea) { authUserId = ea.id; }
      else {
        const cr = await fetch(`${SB_URL}/auth/v1/admin/users`, { method: "POST", headers, body: JSON.stringify({ email, email_confirm: true, user_metadata: { full_name: stu.name || "" } }) });
        if (!cr.ok) { results.errors.push({ email, step: "student_auth_create", error: await cr.text() }); continue; }
        authUserId = (await cr.json()).id;
      }
      const ir = await sbFetch("users", { method: "POST", body: JSON.stringify({ id: authUserId, full_name: stu.name || "", email, phone: stu.phone || null, is_student: true, is_lecturer: false, is_warehouse: false, is_admin: false, permissions: null }) });
      if (!ir.ok) { results.errors.push({ email, step: "student_insert", error: ir.data?.message || ir.data?.error }); continue; }
      existingEmails.add(email);
      results.students.push({ email, status: "migrated" });
    } catch (err) { results.errors.push({ email, step: "student_loop", error: String(err) }); }
  }

  // 3. Migrate lecturers
  const lecturers = await fetchStoreKey("lecturers");
  const active = Array.isArray(lecturers) ? lecturers.filter(l => l.isActive !== false && l.email) : [];
  for (const lec of active) {
    const email = normalizeEmail(lec.email);
    if (!email) continue;
    if (existingEmails.has(email)) {
      try { await sbFetch(`users?email=eq.${encodeURIComponent(email)}`, { method: "PATCH", body: JSON.stringify({ is_lecturer: true }) }); results.lecturers.push({ email, status: "upgraded" }); }
      catch (err) { results.errors.push({ email, step: "lecturer_upgrade", error: String(err) }); }
      continue;
    }
    try {
      let authUserId;
      const ea = authUsersMap.get(email);
      if (ea) { authUserId = ea.id; }
      else {
        const cr = await fetch(`${SB_URL}/auth/v1/admin/users`, { method: "POST", headers, body: JSON.stringify({ email, email_confirm: true, user_metadata: { full_name: lec.fullName || "" } }) });
        if (!cr.ok) { results.errors.push({ email, step: "lecturer_auth_create", error: await cr.text() }); continue; }
        authUserId = (await cr.json()).id;
      }
      const ir = await sbFetch("users", { method: "POST", body: JSON.stringify({ id: authUserId, full_name: lec.fullName || "", email, phone: lec.phone || null, is_student: false, is_lecturer: true, is_warehouse: false, is_admin: false, permissions: null }) });
      if (!ir.ok) { results.errors.push({ email, step: "lecturer_insert", error: ir.data?.message || ir.data?.error }); continue; }
      existingEmails.add(email);
      results.lecturers.push({ email, status: "migrated" });
    } catch (err) { results.errors.push({ email, step: "lecturer_loop", error: String(err) }); }
  }

  return res.status(200).json({
    success: true,
    summary: {
      staff_processed: results.staff.length, staff_migrated: results.staff.filter(s => s.status === "migrated").length,
      students_processed: results.students.length, students_migrated: results.students.filter(s => s.status === "migrated").length,
      lecturers_processed: results.lecturers.length, lecturers_migrated: results.lecturers.filter(l => l.status === "migrated").length,
      errors: results.errors.length,
    },
    details: results,
  });
}

// ── main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const { action } = req.body || {};

  // Migration stays secret-protected — no JWT required
  if (action === "migrate") return await handleMigrate(req, res);

  // New unified-auth actions — admin only
  if (["invite", "update_user", "delete_user"].includes(action)) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (action === "invite")      return await handleInvite(req, res);
    if (action === "update_user") return await handleUpdateUser(req, res);
    if (action === "delete_user") return await handleDeleteUser(req, res);
  }

  // Legacy actions (staff_members table)
  if (req.method === "GET" || ["list", "create", "update", "delete"].includes(action)) {
    // list: any verified staff member (non-admins get limited fields)
    // create/update/delete: admin only
    const isListOnly = req.method === "GET" || action === "list";
    const caller = isListOnly
      ? await requireStaff(req, res)
      : await requireAdmin(req, res);
    if (!caller) return;
    const result = handleLegacy(req, res, caller.role);
    if (result) return result;
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  return res.status(400).json({ error: "Unknown action" });
}
