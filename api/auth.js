// auth.js — unified authentication handler
//
// Dispatches based on `action` in request body:
//   action: "staff-login"  → password-based login for staff_members (existing flow)
//   action: "ensure-user"  → eligibility check for lecturers/students before
//                            signInWithPassword or resetPasswordForEmail
//
// Backwards-compatible: requests without an `action` field that include
// `email` + `password` are treated as "staff-login".

import bcrypt from "bcryptjs";

const SB_URL         = process.env.SUPABASE_URL;
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SERVICE_HEADERS = {
  apikey:         SB_SERVICE_KEY,
  Authorization:  `Bearer ${SB_SERVICE_KEY}`,
  "Content-Type": "application/json",
};

// ── shared helpers ────────────────────────────────────────────────────────────

async function sbQuery(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SERVICE_HEADERS });
  if (!res.ok) return null;
  return res.json();
}

async function fetchStoreKey(key) {
  try {
    const res  = await fetch(
      `${SB_URL}/rest/v1/store?key=eq.${encodeURIComponent(key)}&select=data`,
      { headers: SERVICE_HEADERS },
    );
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json) && json.length > 0 ? json[0].data : null;
  } catch {
    return null;
  }
}

function normalizeEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── staff-login ───────────────────────────────────────────────────────────────

async function handleStaffLogin(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Missing email or password" });
  }

  const rows = await sbQuery(
    `staff_members?email=eq.${encodeURIComponent(email.trim().toLowerCase())}&select=id,full_name,email,role,password_hash,permissions&limit=1`,
  );

  if (!rows || rows.length === 0) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const user  = rows[0];
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return res.status(200).json({
    success: true,
    user: {
      id:          user.id,
      full_name:   user.full_name,
      email:       user.email,
      role:        user.role,
      permissions: user.permissions || {},
    },
  });
}

// ── ensure-user ───────────────────────────────────────────────────────────────
// Only lecturers (store key "lecturers") and certified students
// (store key "certifications" → .students[]) are eligible.
// teamMembers is intentionally excluded.
//
// This handler is called before client-side signInWithPassword() or
// resetPasswordForEmail() to verify that the email is registered in the
// official datasets (prevents strangers from enumerating / requesting
// password resets for arbitrary addresses).
//
// On first login, it also provisions the auth.users row via the Admin API
// so that resetPasswordForEmail can send a "set your password" link even if
// the user has never logged in before.

async function findEligibleRecord(normalizedEmail) {
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) return null;

  const lecturers = await fetchStoreKey("lecturers");
  if (Array.isArray(lecturers)) {
    const match = lecturers.find(
      (l) => l.isActive !== false && normalizeEmail(l.email) === normalizedEmail,
    );
    if (match) return { role: "lecturer", id: String(match.id), name: String(match.fullName || "") };
  }

  const certifications = await fetchStoreKey("certifications");
  const students = certifications?.students;
  if (Array.isArray(students)) {
    const match = students.find(
      (s) => normalizeEmail(s.email) === normalizedEmail,
    );
    if (match) return { role: "student", id: String(match.id), name: String(match.name || "") };
  }

  return null;
}

// Looks up an existing auth user by email.
// NOTE: Supabase GoTrue's Admin API does NOT support `?email=` as a real
// filter — it silently ignores unknown query params and returns the full
// (paginated) list. We therefore paginate and filter client-side.
async function findAuthUserByEmail(normalizedEmail) {
  const perPage = 1000;
  // Safety cap — 50k users is plenty for this app.
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(
      `${SB_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
      { headers: SERVICE_HEADERS },
    );
    if (!res.ok) {
      const txt = await res.text();
      console.warn("findAuthUserByEmail list failed:", res.status, txt);
      return null;
    }
    const data = await res.json();
    const list = Array.isArray(data?.users)
      ? data.users
      : (Array.isArray(data) ? data : []);
    if (list.length === 0) return null;

    const found = list.find(
      (u) => normalizeEmail(u.email) === normalizedEmail,
    );
    if (found) return found;

    if (list.length < perPage) return null; // last page
  }
  return null;
}

// Provisions an auth.users row (without password) via the Admin API if one
// doesn't already exist, and always syncs user_metadata.full_name so email
// templates can greet the user by name via {{ index .UserMetaData "full_name" }}.
async function ensureAuthUserExists(normalizedEmail, fullName) {
  try {
    const existing = await findAuthUserByEmail(normalizedEmail);

    if (existing) {
      // Merge new full_name into existing metadata so we don't clobber
      // anything else stored there.
      const currentMeta =
        (existing.user_metadata && typeof existing.user_metadata === "object")
          ? existing.user_metadata
          : {};
      const nextMeta = { ...currentMeta };
      if (fullName) nextMeta.full_name = fullName;

      const updateRes = await fetch(
        `${SB_URL}/auth/v1/admin/users/${existing.id}`,
        {
          method: "PUT",
          headers: SERVICE_HEADERS,
          body: JSON.stringify({ user_metadata: nextMeta }),
        },
      );
      if (!updateRes.ok) {
        const txt = await updateRes.text();
        console.warn("ensureAuthUserExists update failed:", updateRes.status, txt);
        return { created: false, updated: false, error: txt };
      }
      return { created: false, updated: true };
    }

    // Not found — create via Admin API (no password, email confirmed)
    const createRes = await fetch(`${SB_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: SERVICE_HEADERS,
      body: JSON.stringify({
        email: normalizedEmail,
        email_confirm: true,
        user_metadata: fullName ? { full_name: fullName } : {},
      }),
    });
    if (!createRes.ok) {
      const txt = await createRes.text();
      console.warn("ensureAuthUserExists create failed:", createRes.status, txt);
      return { created: false, error: txt };
    }
    return { created: true };
  } catch (err) {
    console.warn("ensureAuthUserExists exception:", err);
    return { created: false };
  }
}

async function handleEnsureUser(req, res) {
  const { email, provision } = req.body || {};
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Missing email" });
  }

  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  const record = await findEligibleRecord(normalizedEmail);
  if (!record) {
    return res.status(403).json({ error: "not_registered" });
  }

  // When provision=true (called from forgot-password flow), make sure the
  // auth.users row exists so resetPasswordForEmail can deliver the link.
  if (provision) {
    await ensureAuthUserExists(normalizedEmail, record.name);
  }

  return res.status(200).json({ ok: true, role: record.role, name: record.name });
}

// ── main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action, password } = req.body || {};

  // Dispatch: explicit action or legacy staff-login (has password)
  const resolvedAction = action || (password ? "staff-login" : null);

  try {
    if (resolvedAction === "staff-login") return await handleStaffLogin(req, res);
    if (resolvedAction === "ensure-user") return await handleEnsureUser(req, res);
    return res.status(400).json({ error: "Missing or unknown action" });
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
