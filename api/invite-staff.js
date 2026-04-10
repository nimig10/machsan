// invite-staff.js — Vercel serverless function
//
// Called by Super Admin to invite a new staff member.
// Creates an auth.users row via inviteUserByEmail (sends password-setup email),
// then inserts a public.users row with the correct role flags and permissions.
//
// Also supports action: "update" to modify roles/permissions of existing users,
// and action: "delete" to remove a staff member.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SB_URL = process.env.SUPABASE_URL;
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SERVICE_HEADERS = {
  apikey: SB_SERVICE_KEY,
  Authorization: `Bearer ${SB_SERVICE_KEY}`,
  "Content-Type": "application/json",
};

const DEFAULT_PERMISSIONS = {
  views: [],
  warehouseSections: [],
  administrationSections: [],
  notifyLoanTypes: [],
  canEditDailyLessons: false,
};

// ── helpers ──────────────────────────────────────────────────────────────────

function normalizeEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sbRest(path, options = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { ...SERVICE_HEADERS, Prefer: "return=representation" },
    ...options,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

/** Count how many admins exist in public.users */
async function adminCount() {
  const r = await sbRest("users?is_admin=eq.true&select=id");
  return Array.isArray(r.data) ? r.data.length : 0;
}

/** Look up an existing auth user by email (paginated scan) */
async function findAuthUserByEmail(email) {
  const perPage = 1000;
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(
      `${SB_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
      { headers: SERVICE_HEADERS },
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

// ── INVITE (create new staff) ────────────────────────────────────────────────

async function handleInvite(req, res) {
  const { full_name, email, is_warehouse, is_admin, permissions } = req.body;
  const normEmail = normalizeEmail(email);

  if (!full_name?.trim()) {
    return res.status(400).json({ error: "missing_name" });
  }
  if (!isValidEmail(normEmail)) {
    return res.status(400).json({ error: "invalid_email" });
  }

  // 1. Check if email already exists in public.users
  const existing = await sbRest(`users?email=eq.${encodeURIComponent(normEmail)}&select=id`);
  if (existing.ok && Array.isArray(existing.data) && existing.data.length > 0) {
    return res.status(409).json({ error: "email_exists" });
  }

  // 2. Invite via Supabase Admin API — sends a "set your password" email
  //    If auth user already exists (e.g. was a student), update instead.
  let authUserId;
  const existingAuth = await findAuthUserByEmail(normEmail);

  if (existingAuth) {
    // Auth user exists (maybe a student) — update metadata, no new invite needed
    const currentMeta = existingAuth.user_metadata || {};
    const updateRes = await fetch(
      `${SB_URL}/auth/v1/admin/users/${existingAuth.id}`,
      {
        method: "PUT",
        headers: SERVICE_HEADERS,
        body: JSON.stringify({
          user_metadata: { ...currentMeta, full_name: full_name.trim() },
        }),
      },
    );
    if (!updateRes.ok) {
      const txt = await updateRes.text();
      return res.status(500).json({ error: "auth_update_failed", details: txt });
    }
    authUserId = existingAuth.id;
  } else {
    // No auth user — invite via admin API (sends password-setup email)
    const inviteRes = await fetch(`${SB_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: SERVICE_HEADERS,
      body: JSON.stringify({
        email: normEmail,
        email_confirm: true,
        user_metadata: { full_name: full_name.trim() },
        // No password — user will set via invite/reset flow
      }),
    });
    if (!inviteRes.ok) {
      const txt = await inviteRes.text();
      return res.status(500).json({ error: "auth_invite_failed", details: txt });
    }
    const inviteData = await inviteRes.json();
    authUserId = inviteData.id;

    // Send password reset email so the user can set their password
    const resetRes = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: SERVICE_HEADERS,
      body: JSON.stringify({
        type: "magiclink",
        email: normEmail,
        options: { redirectTo: `${req.headers.origin || "https://machsan.vercel.app"}/admin` },
      }),
    });
    if (!resetRes.ok) {
      console.warn("invite-staff: generate_link failed:", await resetRes.text());
      // Non-fatal — the user was created, admin can trigger reset later
    }
  }

  // 3. Insert into public.users
  const userRow = {
    id: authUserId,
    full_name: full_name.trim(),
    email: normEmail,
    is_student: false,
    is_lecturer: false,
    is_warehouse: !!is_warehouse,
    is_admin: !!is_admin,
    permissions: { ...DEFAULT_PERMISSIONS, ...(permissions || {}) },
  };

  const insertRes = await sbRest("users", {
    method: "POST",
    body: JSON.stringify(userRow),
  });

  if (!insertRes.ok) {
    const msg = insertRes.data?.message || insertRes.data?.error || "insert_failed";
    return res.status(insertRes.status).json({ error: msg });
  }

  const created = Array.isArray(insertRes.data) ? insertRes.data[0] : insertRes.data;
  return res.status(201).json({
    success: true,
    user: {
      id: created.id,
      full_name: created.full_name,
      email: created.email,
      is_warehouse: created.is_warehouse,
      is_admin: created.is_admin,
      permissions: created.permissions,
    },
    had_existing_auth: !!existingAuth,
  });
}

// ── UPDATE (modify roles/permissions) ────────────────────────────────────────

async function handleUpdate(req, res) {
  const { id, full_name, email, is_warehouse, is_admin, permissions } = req.body;
  if (!id) return res.status(400).json({ error: "missing_id" });

  // Guard: prevent demoting the last admin
  if (is_admin === false) {
    const current = await sbRest(`users?id=eq.${id}&select=is_admin`);
    const wasAdmin = Array.isArray(current.data) && current.data[0]?.is_admin;
    if (wasAdmin && (await adminCount()) <= 1) {
      return res.status(400).json({ error: "last_admin" });
    }
  }

  const updates = { updated_at: new Date().toISOString() };
  if (full_name !== undefined) updates.full_name = full_name.trim();
  if (email !== undefined) updates.email = normalizeEmail(email);
  if (is_warehouse !== undefined) updates.is_warehouse = !!is_warehouse;
  if (is_admin !== undefined) updates.is_admin = !!is_admin;
  if (permissions !== undefined) updates.permissions = { ...DEFAULT_PERMISSIONS, ...permissions };

  const result = await sbRest(`users?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });

  if (!result.ok) {
    return res.status(result.status).json({ error: "update_failed" });
  }

  // Sync full_name to auth.users metadata
  if (full_name !== undefined) {
    await fetch(`${SB_URL}/auth/v1/admin/users/${id}`, {
      method: "PUT",
      headers: SERVICE_HEADERS,
      body: JSON.stringify({ user_metadata: { full_name: full_name.trim() } }),
    }).catch(() => {});
  }

  return res.status(200).json({ success: true });
}

// ── DELETE ────────────────────────────────────────────────────────────────────

async function handleDelete(req, res) {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "missing_id" });

  // Guard: prevent deleting the last admin
  const target = await sbRest(`users?id=eq.${id}&select=is_admin`);
  const isAdmin = Array.isArray(target.data) && target.data[0]?.is_admin;
  if (isAdmin && (await adminCount()) <= 1) {
    return res.status(400).json({ error: "last_admin" });
  }

  // Delete from public.users (CASCADE will not delete auth.users — we do it manually)
  const delResult = await sbRest(`users?id=eq.${id}`, { method: "DELETE" });
  if (!delResult.ok) {
    return res.status(delResult.status).json({ error: "delete_failed" });
  }

  // Also delete auth.users row (only if user has no other reason to exist,
  // e.g. they're also a student). Check public.users for remaining references.
  // Since we just deleted their row, if no row remains, remove from auth too.
  const remaining = await sbRest(`users?id=eq.${id}&select=id`);
  if (!remaining.ok || !remaining.data?.length) {
    await fetch(`${SB_URL}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: SERVICE_HEADERS,
    }).catch(() => {});
  }

  return res.status(200).json({ success: true });
}

// ── main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // TODO: In Step 3/4 this will verify a Supabase JWT and check is_admin.
  // For now, the frontend guards this behind the admin session (same as /api/staff).
  const { action } = req.body || {};

  try {
    if (action === "invite") return await handleInvite(req, res);
    if (action === "update") return await handleUpdate(req, res);
    if (action === "delete") return await handleDelete(req, res);
    return res.status(400).json({ error: "Unknown action. Use: invite, update, delete" });
  } catch (err) {
    console.error("invite-staff error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
