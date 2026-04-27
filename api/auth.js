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
import nodemailer from "nodemailer";

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

// Stage 6 step 8: students live in the normalized students table now (the
// store.certifications blob has been deleted). Query the table directly via
// REST instead of reading from the dead blob.
async function fetchStudentByEmail(normalizedEmail) {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/students?email=eq.${encodeURIComponent(normalizedEmail)}&select=id,name,email,phone&limit=1`,
      { headers: SERVICE_HEADERS },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch {
    return null;
  }
}

// Returns true iff the email is taken by some student other than `excludeId`.
async function studentEmailTaken(normalizedEmail, excludeId) {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/students?email=eq.${encodeURIComponent(normalizedEmail)}&select=id&limit=2`,
      { headers: SERVICE_HEADERS },
    );
    if (!res.ok) return false;
    const rows = await res.json();
    if (!Array.isArray(rows)) return false;
    return rows.some(r => String(r.id) !== String(excludeId));
  } catch {
    return false;
  }
}

async function updateStudentRow(id, updates) {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/students?id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { ...SERVICE_HEADERS, Prefer: "return=minimal" },
        body: JSON.stringify(updates),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// Stage 7 step 6: lecturers now live in a normalized table (public.lecturers)
// instead of the store.lecturers JSONB blob. Eligibility / sync / revoke
// checks query the table directly via the case-insensitive email index.
// `email=ilike.<x>` against the lecturers_email_lower_idx UNIQUE index.
async function fetchActiveLecturerByEmail(normalizedEmail) {
  if (!normalizedEmail) return null;
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/lecturers?email=ilike.${encodeURIComponent(normalizedEmail)}&is_active=eq.true&select=id,full_name,email&limit=1`,
      { headers: SERVICE_HEADERS },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
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
  const { email, password, provision } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Missing email or password" });
  }

  const normEmail = normalizeEmail(email);
  const rows = await sbQuery(
    `staff_members?email=eq.${encodeURIComponent(normEmail)}&select=id,full_name,email,role,password_hash,permissions&limit=1`,
  );

  if (!rows || rows.length === 0) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const user  = rows[0];
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // provision=true: migrate staff member to Supabase auth so unified login works
  if (provision) {
    const isAdmin = user.role === "admin";
    let authUserId = null;
    const existing = await findAuthUserByEmail(normEmail);
    if (existing) {
      await fetch(`${SB_URL}/auth/v1/admin/users/${existing.id}`, {
        method: "PUT",
        headers: SERVICE_HEADERS,
        body: JSON.stringify({ password, user_metadata: { full_name: user.full_name } }),
      }).catch(() => {});
      authUserId = existing.id;
    } else {
      const createRes = await fetch(`${SB_URL}/auth/v1/admin/users`, {
        method: "POST",
        headers: SERVICE_HEADERS,
        body: JSON.stringify({ email: normEmail, password, email_confirm: true, user_metadata: { full_name: user.full_name } }),
      });
      if (createRes.ok) authUserId = (await createRes.json()).id;
    }

    if (authUserId) {
      // Upsert public.users so routeByRoles can route them
      const pubExisting = await fetch(`${SB_URL}/rest/v1/users?id=eq.${authUserId}&select=id`, { headers: SERVICE_HEADERS });
      const pubRows = pubExisting.ok ? await pubExisting.json() : [];
      if (!Array.isArray(pubRows) || pubRows.length === 0) {
        await fetch(`${SB_URL}/rest/v1/users`, {
          method: "POST",
          headers: { ...SERVICE_HEADERS, Prefer: "return=minimal" },
          body: JSON.stringify({
            id: authUserId, full_name: user.full_name, email: normEmail,
            is_admin: isAdmin, is_warehouse: !isAdmin,
            is_student: false, is_lecturer: false,
            permissions: user.permissions || {},
          }),
        }).catch(() => {});
      } else {
        await fetch(`${SB_URL}/rest/v1/users?id=eq.${authUserId}`, {
          method: "PATCH",
          headers: { ...SERVICE_HEADERS, Prefer: "return=minimal" },
          body: JSON.stringify({ is_admin: isAdmin, is_warehouse: !isAdmin, updated_at: new Date().toISOString() }),
        }).catch(() => {});
      }
    }
  }

  return res.status(200).json({
    success: true,
    provisioned: !!provision,
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

  // Stage 7 step 6: lecturer eligibility check now hits the normalized table.
  const lecturer = await fetchActiveLecturerByEmail(normalizedEmail);
  if (lecturer) {
    return { role: "lecturer", id: String(lecturer.id), name: String(lecturer.full_name || "") };
  }

  const studentRow = await fetchStudentByEmail(normalizedEmail);
  if (studentRow) {
    return { role: "student", id: String(studentRow.id), name: String(studentRow.name || "") };
  }

  // Also check staff_members so forgot-password works for staff/admin
  const staffRows = await sbQuery(
    `staff_members?email=eq.${encodeURIComponent(normalizedEmail)}&select=id,full_name,role&limit=1`,
  );
  if (Array.isArray(staffRows) && staffRows.length > 0) {
    const s = staffRows[0];
    return { role: s.role === "admin" ? "admin" : "staff", id: String(s.id), name: String(s.full_name || "") };
  }

  return null;
}

// Looks up an existing auth user by email.
// NOTE: Supabase GoTrue's Admin API does NOT support `?email=` as a real
// filter — it silently ignores unknown query params and returns the full
// (paginated) list. We therefore paginate and filter client-side.
async function findAuthUserByEmail(normalizedEmail) {
  // Fast path: look up the auth id via public.users.email (indexed) and
  // fetch the auth row by id directly. Avoids scanning up to 50k users.
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/users?email=eq.${encodeURIComponent(normalizedEmail)}&select=id&limit=1`,
      { headers: SERVICE_HEADERS },
    );
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows[0]?.id) {
        const byId = await fetch(`${SB_URL}/auth/v1/admin/users/${rows[0].id}`, { headers: SERVICE_HEADERS });
        if (byId.ok) {
          const u = await byId.json();
          if (u && normalizeEmail(u.email) === normalizedEmail) return u;
        }
      }
    }
  } catch {}
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
        if (record.role === "student")  updates.is_student   = true;
        if (record.role === "lecturer") updates.is_lecturer  = true;
        if (record.role === "admin")    updates.is_admin     = true;
        if (record.role === "staff")    updates.is_warehouse = true;
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

  // Stage 6 step 8: students live in the normalized students table now.
  const me = await fetchStudentByEmail(currentEmail);
  if (!me) {
    return res.status(403).json({ error: "student_not_found" });
  }

  // If email is changing, verify it's not already taken by another student.
  if (nextEmail !== currentEmail) {
    if (await studentEmailTaken(nextEmail, me.id)) {
      return res.status(409).json({ error: "email_taken" });
    }
  }

  // Update the students table directly. Only overwrite `phone` when the client
  // actually sent the field — keeps legacy clients from wiping existing values.
  const studentUpdates = { name: nextName, email: nextEmail };
  if (phoneProvided) studentUpdates.phone = nextPhone || null;
  const storeOk = await updateStudentRow(me.id, studentUpdates);
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

  // Verify newEmail is present in the students table (admin must have already
  // updated the row). Stage 6 step 8: blob is gone — query the table.
  const match = await fetchStudentByEmail(normNew);
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

// ── sync-lecturer-auth ────────────────────────────────────────────────────────
// Admin-triggered — called from LecturersPage after an inline edit successfully
// writes the store. Updates the auth.users row + public.users row to match the
// new email/name in store.lecturers so the lecturer's login continues to work
// after the admin renames them. Mirrors handleSyncStudentAuth.
async function handleSyncLecturerAuth(req, res) {
  const { oldEmail, newEmail, newName } = req.body || {};
  if (!oldEmail || !newEmail) return res.status(400).json({ error: "missing_email" });

  const normOld  = normalizeEmail(oldEmail);
  const normNew  = normalizeEmail(newEmail);
  const nextName = String(newName || "").trim();
  if (!isValidEmail(normNew)) return res.status(400).json({ error: "invalid_new_email" });

  // Stage 7 step 6: verify the new email is present in the normalized
  // lecturers table (admin must have already saved the rename via dual-write).
  const match = await fetchActiveLecturerByEmail(normNew);
  if (!match) return res.status(403).json({ error: "new_email_not_in_lecturers" });

  const authUser = await findAuthUserByEmail(normOld);
  if (!authUser) return res.status(200).json({ ok: true, synced: false, reason: "no_auth_user" });

  const currentMeta = (authUser.user_metadata && typeof authUser.user_metadata === "object") ? authUser.user_metadata : {};
  const nextMeta = { ...currentMeta };
  if (nextName) nextMeta.full_name = nextName;

  const updateBody = { user_metadata: nextMeta };
  if (normOld !== normNew) {
    updateBody.email = normNew;
    updateBody.email_confirm = true;
  }

  const r = await fetch(`${SB_URL}/auth/v1/admin/users/${authUser.id}`, {
    method: "PUT", headers: SERVICE_HEADERS, body: JSON.stringify(updateBody),
  });
  if (!r.ok) {
    const txt = await r.text();
    console.warn("sync-lecturer-auth update failed:", r.status, txt);
    return res.status(500).json({ error: "auth_update_failed", details: txt });
  }

  // Mirror onto public.users if row exists
  const puUpdates = { updated_at: new Date().toISOString() };
  if (normOld !== normNew) puUpdates.email = normNew;
  if (nextName) puUpdates.full_name = nextName;
  if (Object.keys(puUpdates).length > 1) {
    await fetch(`${SB_URL}/rest/v1/users?id=eq.${authUser.id}`, {
      method: "PATCH", headers: { ...SERVICE_HEADERS, Prefer: "return=minimal" },
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

  // Verify the email is NOT in the students table (admin already removed it)
  // and NOT in lecturers — we only delete when the email is orphaned.
  // Stage 6 step 8: blob is gone — query the table.
  const stillInStudents = await fetchStudentByEmail(normEmail);
  if (stillInStudents) {
    return res.status(409).json({ error: "email_still_active_in_students" });
  }
  // Stage 7 step 6: orphan-check now hits the normalized lecturers table.
  const stillInLecturers = await fetchActiveLecturerByEmail(normEmail);
  if (stillInLecturers) {
    return res.status(409).json({ error: "email_still_active_in_lecturers" });
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

// ── send-reset-email ──────────────────────────────────────────────────────────
// Replaces client-side supabase.auth.resetPasswordForEmail() so the email is
// delivered via Gmail (which reaches org/Exchange servers reliably) instead of
// Supabase's shared SMTP (which often lands in spam or gets rejected by strict
// DMARC policies on organizational domains like atid.org.il).
//
// Flow:
//  1. Verify the email is registered (lecturers / students / staff / public.users)
//  2. Provision auth.users row if this is the user's first login
//  3. Generate a recovery link via POST /auth/v1/admin/generate_link (no email sent)
//  4. Send the link via Gmail/nodemailer

function buildResetEmail(name, resetUrl) {
  return `<!DOCTYPE html>
<html lang="he">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:20px;background:#f0f0f0;font-family:Arial,sans-serif;direction:rtl;text-align:right">
  <div style="max-width:480px;margin:0 auto;background:#0a0c10;color:#e8eaf0;border-radius:12px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#111318,#1e232e);padding:28px;text-align:center;border-bottom:1px solid #252b38">
      <h1 style="color:#f5a623;font-size:20px;margin:0">מכללת קמרה אובסקורה וסאונד</h1>
    </div>
    <div style="padding:32px;direction:rtl;text-align:right">
      <div style="background:#f5a6231a;border:1px solid #f5a623;border-radius:10px;padding:18px;text-align:center;margin-bottom:24px">
        <div style="font-size:32px;margin-bottom:6px">&#128273;</div>
        <h2 style="color:#f5a623;margin:0;font-size:17px">איפוס סיסמה</h2>
      </div>
      <p style="font-size:14px;line-height:1.8;color:#e8eaf0;margin:0 0 12px">שלום <strong>${name}</strong>,</p>
      <p style="font-size:13px;line-height:1.9;color:#8891a8;margin:0 0 24px">
        קיבלנו בקשה לאיפוס הסיסמה שלך במערכת המחסן הדיגיטלי.<br/>
        לחץ/י על הכפתור למטה כדי לקבוע סיסמה חדשה:
      </p>
      <div style="text-align:center;margin:0 0 24px">
        <a href="${resetUrl}" style="display:inline-block;padding:16px 36px;background:#f5a623;color:#0a0c10;font-weight:900;font-size:15px;border-radius:10px;text-decoration:none;box-shadow:0 4px 18px rgba(245,166,35,0.35);font-family:Arial,'Helvetica Neue',Helvetica,sans-serif">
          קביעת סיסמה חדשה
        </a>
      </div>
      <p style="font-size:11px;color:#555f72;text-align:center;margin:0">
        הקישור בתוקף ל-24 שעות.<br/>
        אם לא ביקשת איפוס סיסמה &#8212; אפשר להתעלם ממייל זה.
      </p>
    </div>
    <div style="padding:16px 32px;border-top:1px solid #252b38;text-align:center;font-size:11px;color:#555f72">
      מכללת קמרה אובסקורה וסאונד &middot; מכללה
    </div>
  </div>
</body>
</html>`;
}

async function handleSendResetEmail(req, res) {
  const { email } = req.body || {};
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Missing email" });
  }

  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  // 1. Check eligibility (lecturers + students + staff_members)
  let record = await findEligibleRecord(normalizedEmail);

  // Final fallback: public.users (covers staff provisioned via admin API)
  if (!record) {
    const userRows = await sbQuery(
      `users?email=eq.${encodeURIComponent(normalizedEmail)}&select=id,full_name,is_admin,is_warehouse,is_lecturer,is_student&limit=1`,
    );
    if (Array.isArray(userRows) && userRows.length > 0) {
      const u = userRows[0];
      const role = u.is_admin ? "admin" : u.is_warehouse ? "staff" : u.is_lecturer ? "lecturer" : "student";
      record = { role, id: String(u.id), name: String(u.full_name || "") };
    }
  }

  if (!record) {
    return res.status(403).json({ error: "not_registered" });
  }

  // 2. Provision auth.users row if this is the first login
  await ensureAuthUserExists(normalizedEmail, record.name);

  // 2b. Also provision public.users row with the right role flags so the
  // first login after reset routes correctly without an extra ensure-user
  // round-trip. Non-destructive — existing flags are merged, not cleared.
  try {
    const authUser = await findAuthUserByEmail(normalizedEmail);
    if (authUser) {
      const existing = await sbQuery(`users?id=eq.${authUser.id}&select=id`);
      if (!existing || existing.length === 0) {
        await fetch(`${SB_URL}/rest/v1/users`, {
          method: "POST",
          headers: { ...SERVICE_HEADERS, Prefer: "return=minimal" },
          body: JSON.stringify({
            id: authUser.id,
            email: normalizedEmail,
            full_name: record.name || "",
            is_student:   record.role === "student",
            is_lecturer:  record.role === "lecturer",
            is_admin:     record.role === "admin",
            is_warehouse: record.role === "staff",
          }),
        }).catch(() => {});
      } else {
        const updates = { updated_at: new Date().toISOString() };
        if (record.role === "student")  updates.is_student   = true;
        if (record.role === "lecturer") updates.is_lecturer  = true;
        if (record.role === "admin")    updates.is_admin     = true;
        if (record.role === "staff")    updates.is_warehouse = true;
        if (Object.keys(updates).length > 1) {
          await fetch(`${SB_URL}/rest/v1/users?id=eq.${authUser.id}`, {
            method: "PATCH",
            headers: { ...SERVICE_HEADERS, Prefer: "return=minimal" },
            body: JSON.stringify(updates),
          }).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.warn("send-reset-email: public.users provisioning warning:", err);
  }

  // 3. Generate recovery link (Admin API — does NOT send any email)
  const appUrl = process.env.APP_URL || "https://app.camera.org.il";
  const linkRes = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: SERVICE_HEADERS,
    body: JSON.stringify({
      type: "recovery",
      email: normalizedEmail,
      options: { redirect_to: `${appUrl}/?reset=1` },
    }),
  });

  if (!linkRes.ok) {
    const txt = await linkRes.text();
    console.warn("generate_link failed:", linkRes.status, txt);
    return res.status(500).json({ error: "link_generation_failed", details: txt });
  }

  const linkData = await linkRes.json();
  const resetUrl = linkData.action_link || linkData.properties?.action_link;

  if (!resetUrl) {
    console.warn("No action_link in generate_link response:", JSON.stringify(linkData));
    return res.status(500).json({ error: "no_reset_link" });
  }

  // 4. Send via Gmail (reliable delivery to org/Exchange servers)
  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_PASS = process.env.GMAIL_PASS;

  if (!GMAIL_USER || !GMAIL_PASS) {
    console.warn("Gmail credentials not configured — cannot send reset email");
    return res.status(500).json({ error: "smtp_not_configured" });
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });

  const displayName = record.name || normalizedEmail.split("@")[0];

  try {
    await transporter.sendMail({
      from: `"מכללת קמרה אובסקורה וסאונד" <${GMAIL_USER}>`,
      to: normalizedEmail,
      subject: "איפוס סיסמה — מכללת קמרה אובסקורה וסאונד",
      html: buildResetEmail(displayName, resetUrl),
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("send-reset-email smtp error:", err);
    return res.status(500).json({ error: "email_send_failed", details: err.message });
  }
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
    if (resolvedAction === "send-reset-email")       return await handleSendResetEmail(req, res);
    if (resolvedAction === "update-student-credentials") return await handleUpdateStudentCredentials(req, res);
    if (resolvedAction === "sync-student-auth")      return await handleSyncStudentAuth(req, res);
    if (resolvedAction === "sync-lecturer-auth")     return await handleSyncLecturerAuth(req, res);
    if (resolvedAction === "delete-student-auth")    return await handleDeleteStudentAuth(req, res);
    return res.status(400).json({ error: "Missing or unknown action" });
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
