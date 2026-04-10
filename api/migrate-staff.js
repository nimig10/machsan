// migrate-staff.js — ONE-OFF migration utility (Vercel serverless)
//
// Reads all existing staff_members, creates auth.users rows for each,
// populates public.users with correct role flags and permissions,
// and sends each staff member a password-setup email.
//
// Also migrates existing students and lecturers from the store table
// into public.users (they already have auth.users rows from the old flow).
//
// Call via POST with: { secret: "..." }
// The secret must match MIGRATION_SECRET env var (set in Vercel).
//
// This endpoint is idempotent — re-running it will skip users that
// already exist in public.users.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MIGRATION_SECRET

const SB_URL = process.env.SUPABASE_URL;
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MIGRATION_SECRET = process.env.MIGRATION_SECRET;

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

function normalizeEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

async function sbRest(path, options = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { ...SERVICE_HEADERS, Prefer: "return=representation" },
    ...options,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

async function fetchStoreKey(key) {
  const res = await fetch(
    `${SB_URL}/rest/v1/store?key=eq.${encodeURIComponent(key)}&select=data`,
    { headers: SERVICE_HEADERS },
  );
  if (!res.ok) return null;
  const json = await res.json();
  return Array.isArray(json) && json.length > 0 ? json[0].data : null;
}

/** Paginated scan of auth.users — returns Map<email, authUser> */
async function loadAllAuthUsers() {
  const map = new Map();
  const perPage = 1000;
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(
      `${SB_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
      { headers: SERVICE_HEADERS },
    );
    if (!res.ok) break;
    const data = await res.json();
    const list = Array.isArray(data?.users) ? data.users : (Array.isArray(data) ? data : []);
    if (list.length === 0) break;
    for (const u of list) {
      if (u.email) map.set(normalizeEmail(u.email), u);
    }
    if (list.length < perPage) break;
  }
  return map;
}

/** Load all existing public.users emails for dedup */
async function loadExistingPublicUsers() {
  const r = await sbRest("users?select=email");
  const set = new Set();
  if (r.ok && Array.isArray(r.data)) {
    for (const row of r.data) {
      if (row.email) set.add(normalizeEmail(row.email));
    }
  }
  return set;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Protect with a secret so this can't be called by anyone
  const { secret } = req.body || {};
  if (!MIGRATION_SECRET || secret !== MIGRATION_SECRET) {
    return res.status(403).json({ error: "Invalid migration secret" });
  }

  const results = { staff: [], students: [], lecturers: [], errors: [] };

  try {
    // Pre-load all auth users and existing public.users for efficient dedup
    const authUsersMap = await loadAllAuthUsers();
    const existingEmails = await loadExistingPublicUsers();

    // ── 1. Migrate staff_members ───────────────────────────────────────────

    const staffRes = await sbRest(
      "staff_members?select=id,full_name,email,role,permissions&order=created_at.asc",
    );
    const staffMembers = staffRes.ok && Array.isArray(staffRes.data) ? staffRes.data : [];

    for (const sm of staffMembers) {
      const email = normalizeEmail(sm.email);
      if (!email) continue;

      // Skip if already in public.users
      if (existingEmails.has(email)) {
        results.staff.push({ email, status: "skipped", reason: "already_in_public_users" });
        continue;
      }

      try {
        let authUserId;
        let authExisted = false;

        // Check if auth user already exists (maybe they were also a student)
        const existingAuth = authUsersMap.get(email);
        if (existingAuth) {
          authUserId = existingAuth.id;
          authExisted = true;
          // Update metadata
          await fetch(`${SB_URL}/auth/v1/admin/users/${existingAuth.id}`, {
            method: "PUT",
            headers: SERVICE_HEADERS,
            body: JSON.stringify({
              user_metadata: {
                ...(existingAuth.user_metadata || {}),
                full_name: sm.full_name,
              },
            }),
          });
        } else {
          // Create new auth user (no password — they'll set it via email)
          const createRes = await fetch(`${SB_URL}/auth/v1/admin/users`, {
            method: "POST",
            headers: SERVICE_HEADERS,
            body: JSON.stringify({
              email,
              email_confirm: true,
              user_metadata: { full_name: sm.full_name },
            }),
          });
          if (!createRes.ok) {
            const txt = await createRes.text();
            results.errors.push({ email, step: "auth_create", error: txt });
            continue;
          }
          const created = await createRes.json();
          authUserId = created.id;
        }

        // Map old role → new boolean flags
        const isAdmin = sm.role === "admin";
        const isWarehouse = !isAdmin; // non-admin staff → warehouse by default

        // Insert into public.users
        const insertRes = await sbRest("users", {
          method: "POST",
          body: JSON.stringify({
            id: authUserId,
            full_name: sm.full_name,
            email,
            is_student: false,
            is_lecturer: false,
            is_warehouse: isWarehouse || isAdmin, // admins can also access warehouse
            is_admin: isAdmin,
            permissions: { ...DEFAULT_PERMISSIONS, ...(sm.permissions || {}) },
          }),
        });

        if (!insertRes.ok) {
          results.errors.push({
            email,
            step: "public_users_insert",
            error: insertRes.data?.message || insertRes.data?.error,
          });
          continue;
        }

        // Send password reset email so they can set their own password
        await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
          method: "POST",
          headers: SERVICE_HEADERS,
          body: JSON.stringify({
            type: "recovery",
            email,
            options: {
              redirectTo: `${req.headers.origin || "https://machsan.vercel.app"}/admin`,
            },
          }),
        }).catch(() => {});

        existingEmails.add(email);
        results.staff.push({
          email,
          status: "migrated",
          auth_existed: authExisted,
          is_admin: isAdmin,
          is_warehouse: isWarehouse || isAdmin,
        });
      } catch (err) {
        results.errors.push({ email, step: "staff_loop", error: String(err) });
      }
    }

    // ── 2. Migrate students from certifications.students ─────────────────

    const certifications = await fetchStoreKey("certifications");
    const students = Array.isArray(certifications?.students) ? certifications.students : [];

    for (const stu of students) {
      const email = normalizeEmail(stu.email);
      if (!email) continue;

      if (existingEmails.has(email)) {
        // Email already in public.users — might be a staff member who is also
        // a student. Update is_student flag.
        try {
          await sbRest(`users?email=eq.${encodeURIComponent(email)}`, {
            method: "PATCH",
            body: JSON.stringify({ is_student: true }),
          });
          results.students.push({ email, status: "upgraded", reason: "set_is_student_on_existing" });
        } catch (err) {
          results.errors.push({ email, step: "student_upgrade", error: String(err) });
        }
        continue;
      }

      try {
        // Find or create auth user
        let authUserId;
        const existingAuth = authUsersMap.get(email);
        if (existingAuth) {
          authUserId = existingAuth.id;
        } else {
          // Student never logged in — create auth row
          const createRes = await fetch(`${SB_URL}/auth/v1/admin/users`, {
            method: "POST",
            headers: SERVICE_HEADERS,
            body: JSON.stringify({
              email,
              email_confirm: true,
              user_metadata: { full_name: stu.name || "" },
            }),
          });
          if (!createRes.ok) {
            results.errors.push({ email, step: "student_auth_create", error: await createRes.text() });
            continue;
          }
          authUserId = (await createRes.json()).id;
        }

        const insertRes = await sbRest("users", {
          method: "POST",
          body: JSON.stringify({
            id: authUserId,
            full_name: stu.name || "",
            email,
            phone: stu.phone || null,
            is_student: true,
            is_lecturer: false,
            is_warehouse: false,
            is_admin: false,
            permissions: null,
          }),
        });

        if (!insertRes.ok) {
          results.errors.push({
            email,
            step: "student_public_insert",
            error: insertRes.data?.message || insertRes.data?.error,
          });
          continue;
        }

        existingEmails.add(email);
        results.students.push({ email, status: "migrated" });
      } catch (err) {
        results.errors.push({ email, step: "student_loop", error: String(err) });
      }
    }

    // ── 3. Migrate lecturers ─────────────────────────────────────────────

    const lecturers = await fetchStoreKey("lecturers");
    const activeLecturers = Array.isArray(lecturers)
      ? lecturers.filter((l) => l.isActive !== false && l.email)
      : [];

    for (const lec of activeLecturers) {
      const email = normalizeEmail(lec.email);
      if (!email) continue;

      if (existingEmails.has(email)) {
        // Already exists — set is_lecturer flag
        try {
          await sbRest(`users?email=eq.${encodeURIComponent(email)}`, {
            method: "PATCH",
            body: JSON.stringify({ is_lecturer: true }),
          });
          results.lecturers.push({ email, status: "upgraded", reason: "set_is_lecturer_on_existing" });
        } catch (err) {
          results.errors.push({ email, step: "lecturer_upgrade", error: String(err) });
        }
        continue;
      }

      try {
        let authUserId;
        const existingAuth = authUsersMap.get(email);
        if (existingAuth) {
          authUserId = existingAuth.id;
        } else {
          const createRes = await fetch(`${SB_URL}/auth/v1/admin/users`, {
            method: "POST",
            headers: SERVICE_HEADERS,
            body: JSON.stringify({
              email,
              email_confirm: true,
              user_metadata: { full_name: lec.fullName || "" },
            }),
          });
          if (!createRes.ok) {
            results.errors.push({ email, step: "lecturer_auth_create", error: await createRes.text() });
            continue;
          }
          authUserId = (await createRes.json()).id;
        }

        const insertRes = await sbRest("users", {
          method: "POST",
          body: JSON.stringify({
            id: authUserId,
            full_name: lec.fullName || "",
            email,
            phone: lec.phone || null,
            is_student: false,
            is_lecturer: true,
            is_warehouse: false,
            is_admin: false,
            permissions: null,
          }),
        });

        if (!insertRes.ok) {
          results.errors.push({
            email,
            step: "lecturer_public_insert",
            error: insertRes.data?.message || insertRes.data?.error,
          });
          continue;
        }

        existingEmails.add(email);
        results.lecturers.push({ email, status: "migrated" });
      } catch (err) {
        results.errors.push({ email, step: "lecturer_loop", error: String(err) });
      }
    }

    // ── Summary ──────────────────────────────────────────────────────────

    return res.status(200).json({
      success: true,
      summary: {
        staff_processed: results.staff.length,
        staff_migrated: results.staff.filter((s) => s.status === "migrated").length,
        students_processed: results.students.length,
        students_migrated: results.students.filter((s) => s.status === "migrated").length,
        lecturers_processed: results.lecturers.length,
        lecturers_migrated: results.lecturers.filter((l) => l.status === "migrated").length,
        errors: results.errors.length,
      },
      details: results,
    });
  } catch (err) {
    console.error("migrate-staff fatal error:", err);
    return res.status(500).json({ error: "Internal server error", details: String(err) });
  }
}
