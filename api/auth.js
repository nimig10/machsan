// auth.js — unified authentication handler
//
// Dispatches based on `action` in request body:
//   action: "staff-login"            → password-based login for staff_members
//   action: "ensure-user"            → eligibility check for lecturers/students
//   action: "update-student-credentials" → student self-service: update own name/email/password
//   action: "sync-student-auth"      → admin-triggered: sync auth.users with certifications.students
//   action: "delete-student-auth"    → admin-triggered: remove auth.users row after student deletion
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

// ── store writer ──────────────────────────────────────────────────────────────
// Writes a single key back to the `store` table via the REST API using the
// service-role key. Mirrors the behavior of /api/store but lives here so the
// auth handler can update certifications.students in-place during profile
// updates.
async function writeStoreKey(key, data) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/store`, {
      method: "POST",
      headers: {
        ...SERVICE_HEADERS,
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        key,
        data,
        updated_at: new Date().toISOString(),
      }),
    });
    return r.ok;
  } catch (err) {
    console.warn("writeStoreKey error:", err);
    return false;
  }
}

// ── access token verifier ─────────────────────────────────────────────────────
// Validates a Supabase user access token by calling /auth/v1/user with it.
// Returns the user object ({ id, email, user_metadata, ... }) or null.
async function verifyAccessToken(token) {
  if (!token || typeof token !== "string") return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: {
        apikey: SB_SERVICE_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!r.ok) return null;
    const json = await r.json();
    return json && json.id ? json : null;
  } catch {
    return null;
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
    const result = await ensureAuthUserExists(normalizedEmail, record.name);

    // Also ensure public.users row exists with proper role flags
    const authUser = await findAuthUserByEmail(normalizedEmail);
    if (authUser) {
      const roleFlags = {
        is_student: record.role === "student",
        is_lecturer: record.role === "lecturer",
      };
      // Upsert: create if missing, merge role flags if exists
      const existing = await sbQuery(`users?id=eq.${authUser.id}&select=id,is_student,is_lecturer,is_admin,is_warehouse`);
      if (!existing || existing.length === 0) {
        await fetch(`${SB_URL}/rest/v1/users`, {
          method: "POST",
          headers: { ...SERVICE_HEADERS, Prefer: "return=minimal" },
          body: JSON.stringify({
            id: authUser.id,
            email: normalizedEmail,
            full_name: record.name || "",
            ...roleFlags,
            is_admin: false,
            is_warehouse: false,
          }),
        }).catch(() => {});
      } else {
        // Merge: set the role flag true without clearing other roles
        const updates = { updated_at: new Date().toISOString() };
        if (record.role === "student") updates.is_student = true;
        if (record.role === "lecturer") updates.is_lecturer = true;
        await fetch(`${SB_URL}/rest/v1/users?id=eq.${authUser.id}`, {
          method: "PATCH",
          headers: { ...SERVICE_HEADERS, Prefer: "return=minimal" },
          body: JSON.stringify(updates),
        }).catch(() => {});
      }
    }
  }

  return res.status(200).json({ ok: true, role: record.role, name: record.name });
}

// ── update-student-credentials ────────────────────────────────────────────────
// Self-service endpoint invoked by a logged-in student from PublicForm's
// "Account Settings" modal. Atomically updates BOTH:
//   1) certifications.students[] (name, email) — DB source of truth
//   2) Supabase auth.users — email + password + user_metadata.full_name
//      via the Admin API with email_confirm:true so the new email is
//      active immediately (no confirmation-email round-trip required).
//
// Only returns 200 if the store write succeeded. If the subsequent auth
// update fails we return 500 with `profileSaved:true` so the client can
// surface a precise error.
//
// Security: requires a valid Supabase access token (JWT). The token is
// verified via /auth/v1/user; the returned user.email is used as the
// "current email" — ignoring whatever the client sends — so a hostile
// client cannot target another student's record.
async function handleUpdateStudentCredentials(req, res) {
  const { accessToken, name, email, phone, password } = req.body || {};
  if (!accessToken) {
    return res.status(401).json({ error: "missing_access_token" });
  }

  const authUser = await verifyAccessToken(accessToken);
  if (!authUser?.email) {
    return res.status(401).json({ error: "invalid_session" });
  }

  const currentEmail = normalizeEmail(authUser.email);
  const nextName     = String(name || "").trim();
  const nextEmail    = normalizeEmail(email);
  // Phone is optional. Strip anything that isn't a digit or leading '+' so
  // spaces / dashes / parentheses don't trip validation, then enforce a
  // 7–15 digit range (covers Israeli locals, US, and international formats).
  const phoneProvided = phone != null;
  const nextPhoneRaw  = phoneProvided ? String(phone || "").trim() : "";
  const nextPhone     = nextPhoneRaw.replace(/[^\d+]/g, "");

  if (!nextName || nextName.length < 2) {
    return res.status(400).json({ error: "invalid_name" });
  }
  if (!isValidEmail(nextEmail)) {
    return res.status(400).json({ error: "invalid_email" });
  }
  if (nextPhone && !/^\+?\d{7,15}$/.test(nextPhone)) {
    return res.status(400).json({ error: "invalid_phone" });
  }
  if (password != null && password !== "" && String(password).length < 6) {
    return res.status(400).json({ error: "password_too_short" });
  }

  // Load certifications and locate the student by current (session) email.
  const certifications = await fetchStoreKey("certifications");
  const students = Array.isArray(certifications?.students) ? certifications.students : [];
  const meIdx = students.findIndex(
    (s) => normalizeEmail(s.email) === currentEmail,
  );
  if (meIdx === -1) {
    return res.status(403).json({ error: "student_not_found" });
  }

  // If email is changing, verify it's not already taken by another student.
  if (nextEmail !== currentEmail) {
    const taken = students.some(
      (s, i) => i !== meIdx && normalizeEmail(s.email) === nextEmail,
    );
    if (taken) {
      return res.status(409).json({ error: "email_taken" });
    }
  }

  // Update the store (certifications.students[meIdx]). Only overwrite `phone`
  // when the client actually sent the field — this keeps legacy clients that
  // don't know about phone from wiping existing values.
  const updatedStudent = {
    ...students[meIdx],
    name:  nextName,
    email: nextEmail,
    ...(phoneProvided ? { phone: nextPhone } : {}),
  };
  const updatedStudents = students.map((s, i) => (i === meIdx ? updatedStudent : s));
  const updatedCertifications = { ...certifications, students: updatedStudents };

  const storeOk = await writeStoreKey("certifications", updatedCertifications);
  if (!storeOk) {
    return res.status(500).json({ error: "store_update_failed" });
  }

  // Update Supabase Auth user via Admin API.
  const currentMeta =
    authUser.user_metadata && typeof authUser.user_metadata === "object"
      ? authUser.user_metadata
      : {};
  const nextMeta = { ...currentMeta, full_name: nextName };
  if (phoneProvided) nextMeta.phone = nextPhone;
  const authUpdate = {
    user_metadata: nextMeta,
  };
  if (nextEmail !== currentEmail) {
    authUpdate.email = nextEmail;
    authUpdate.email_confirm = true; // bypass confirmation mail for this internal app
  }
  if (password && String(password).length >= 6) {
    authUpdate.password = String(password);
  }

  const updateRes = await fetch(
    `${SB_URL}/auth/v1/admin/users/${authUser.id}`,
    {
      method: "PUT",
      headers: SERVICE_HEADERS,
      body: JSON.stringify(authUpdate),
    },
  );

  if (!updateRes.ok) {
    const txt = await updateRes.text();
    console.warn("update-student-credentials auth update failed:", updateRes.status, txt);
    // The store was already updated — return partial success so the UI can
    // inform the user that their profile was saved but auth sync failed.
    return res.status(500).json({
      error: "auth_update_failed",
      details: txt,
      profileSaved: true,
    });
  }

  return res.status(200).json({
    ok: true,
    student: updatedStudent,
    emailChanged:    nextEmail !== currentEmail,
    passwordChanged: !!(password && String(password).length >= 6),
    phoneChanged:    phoneProvided && (students[meIdx]?.phone || "") !== nextPhone,
  });
}

// ── sync-student-auth ─────────────────────────────────────────────────────────
// Admin-triggered endpoint called from StudentsPage after an inline edit
// successfully saves to the store. Updates the auth.users row to match the
// new name/email in certifications.students so the student's login continues
// to work after the admin renames them.
//
// Security: the `newEmail` must already exist in certifications.students
// (admin must have written the store first). This piggybacks on whatever
// protection /api/store has and prevents arbitrary auth hijacking via this
// endpoint alone.
async function handleSyncStudentAuth(req, res) {
  const { oldEmail, newEmail, newName } = req.body || {};
  if (!oldEmail || !newEmail) {
    return res.status(400).json({ error: "missing_email" });
  }

  const normOld  = normalizeEmail(oldEmail);
  const normNew  = normalizeEmail(newEmail);
  const nextName = String(newName || "").trim();

  if (!isValidEmail(normNew)) {
    return res.status(400).json({ error: "invalid_new_email" });
  }

  // Verify newEmail is present in certifications.students (admin must have
  // already updated the store).
  const certifications = await fetchStoreKey("certifications");
  const students = Array.isArray(certifications?.students) ? certifications.students : [];
  const match = students.find((s) => normalizeEmail(s.email) === normNew);
  if (!match) {
    return res.status(403).json({ error: "new_email_not_in_certifications" });
  }

  // Find the auth user by the OLD email. If they never logged in, nothing
  // to sync — return ok:true, synced:false.
  const authUser = await findAuthUserByEmail(normOld);
  if (!authUser) {
    return res.status(200).json({ ok: true, synced: false, reason: "no_auth_user" });
  }

  const currentMeta =
    authUser.user_metadata && typeof authUser.user_metadata === "object"
      ? authUser.user_metadata
      : {};
  const nextMeta = { ...currentMeta };
  if (nextName) nextMeta.full_name = nextName;

  const updateBody = { user_metadata: nextMeta };
  if (normOld !== normNew) {
    updateBody.email = normNew;
    updateBody.email_confirm = true;
  }

  const r = await fetch(`${SB_URL}/auth/v1/admin/users/${authUser.id}`, {
    method: "PUT",
    headers: SERVICE_HEADERS,
    body: JSON.stringify(updateBody),
  });

  if (!r.ok) {
    const txt = await r.text();
    console.warn("sync-student-auth update failed:", r.status, txt);
    return res.status(500).json({ error: "auth_update_failed", details: txt });
  }

  // Also sync public.users if a row exists for this auth user
  const puUpdates = { updated_at: new Date().toISOString() };
  if (normOld !== normNew) puUpdates.email = normNew;
  if (nextName) puUpdates.full_name = nextName;
  if (Object.keys(puUpdates).length > 1) {
    await fetch(`${SB_URL}/rest/v1/users?id=eq.${authUser.id}`, {
      method: "PATCH",
      headers: { ...SERVICE_HEADERS, Prefer: "return=minimal" },
      body: JSON.stringify(puUpdates),
    }).catch(() => {});
  }

  return res.status(200).json({ ok: true, synced: true });
}

// ── delete-student-auth ───────────────────────────────────────────────────────
// Admin-triggered endpoint called from StudentsPage after deleting a student.
// Removes the corresponding auth.users row so the deleted student can no
// longer sign in or request a password reset.
//
// Security: verifies that the provided email is NOT present in
// certifications.students (admin must have already removed the row from the
// store). This ensures the endpoint cannot be abused to nuke arbitrary
// active users.
async function handleDeleteStudentAuth(req, res) {
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: "missing_email" });
  }

  const normEmail = normalizeEmail(email);
  if (!isValidEmail(normEmail)) {
    return res.status(400).json({ error: "invalid_email" });
  }

  // Verify the email is NOT in certifications.students (admin already removed it)
  // and NOT in lecturers — we only delete when the email is orphaned.
  const certifications = await fetchStoreKey("certifications");
  const students = Array.isArray(certifications?.students) ? certifications.students : [];
  const stillInStudents = students.some((s) => normalizeEmail(s.email) === normEmail);
  if (stillInStudents) {
    return res.status(409).json({ error: "email_still_active_in_students" });
  }
  const lecturers = await fetchStoreKey("lecturers");
  if (Array.isArray(lecturers)) {
    const stillInLecturers = lecturers.some(
      (l) => l.isActive !== false && normalizeEmail(l.email) === normEmail,
    );
    if (stillInLecturers) {
      return res.status(409).json({ error: "email_still_active_in_lecturers" });
    }
  }

  // Check public.users — never delete an auth user that also has staff/admin/lecturer roles
  const usersRes = await fetch(
    `${SB_URL}/rest/v1/users?email=eq.${encodeURIComponent(normEmail)}&select=id,is_admin,is_warehouse,is_lecturer`,
    { headers: SERVICE_HEADERS },
  );
  if (usersRes.ok) {
    const usersRows = await usersRes.json();
    if (Array.isArray(usersRows) && usersRows.length > 0) {
      const u = usersRows[0];
      if (u.is_admin || u.is_warehouse || u.is_lecturer) {
        // User has other roles — only clear is_student flag, don't delete auth user
        await fetch(`${SB_URL}/rest/v1/users?id=eq.${u.id}`, {
          method: "PATCH",
          headers: { ...SERVICE_HEADERS, Prefer: "return=minimal" },
          body: JSON.stringify({ is_student: false, updated_at: new Date().toISOString() }),
        }).catch(() => {});
        return res.status(200).json({ ok: true, deleted: false, cleared_student_flag: true });
      }
    }
  }

  // Find the auth user by email. If none exists, treat as success (idempotent).
  const authUser = await findAuthUserByEmail(normEmail);
  if (!authUser) {
    return res.status(200).json({ ok: true, deleted: false, reason: "no_auth_user" });
  }

  const r = await fetch(`${SB_URL}/auth/v1/admin/users/${authUser.id}`, {
    method: "DELETE",
    headers: SERVICE_HEADERS,
  });

  if (!r.ok) {
    const txt = await r.text();
    console.warn("delete-student-auth failed:", r.status, txt);
    return res.status(500).json({ error: "auth_delete_failed", details: txt });
  }

  return res.status(200).json({ ok: true, deleted: true });
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
    if (resolvedAction === "staff-login")            return await handleStaffLogin(req, res);
    if (resolvedAction === "ensure-user")            return await handleEnsureUser(req, res);
    if (resolvedAction === "update-student-credentials") return await handleUpdateStudentCredentials(req, res);
    if (resolvedAction === "sync-student-auth")      return await handleSyncStudentAuth(req, res);
    if (resolvedAction === "delete-student-auth")    return await handleDeleteStudentAuth(req, res);
    return res.status(400).json({ error: "Missing or unknown action" });
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
