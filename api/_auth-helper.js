// _auth-helper.js — server-side JWT verification for API routes
// Usage:
//   const staff = await requireStaff(req, res);
//   if (!staff) return;   // response already sent
//
//   const staff = await requireAdmin(req, res);
//   if (!staff) return;

const SB_URL = process.env.SUPABASE_URL;
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SERVICE_HEADERS = {
  apikey: SB_SERVICE_KEY,
  Authorization: `Bearer ${SB_SERVICE_KEY}`,
  "Content-Type": "application/json",
};

// Verify a Supabase JWT and return the auth user object, or null.
async function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const json = await r.json();
    return json?.id ? json : null;
  } catch {
    return null;
  }
}

// Verify the request JWT and look up the caller's staff record.
// Returns { staffId, role, email } on success.
// On failure sends 401/403 and returns null — caller must `if (!staff) return`.
//
// Resolution order:
//   1) public.users (new unified auth) — is_admin / is_warehouse decide role
//   2) staff_members (legacy) — fallback for rows not yet migrated
export async function requireStaff(req, res) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  const authUser = await verifyToken(token);
  if (!authUser) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  const email = String(authUser.email || "").toLowerCase();

  // 1) Try public.users by auth id (unified system)
  try {
    const r1 = await fetch(
      `${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(authUser.id)}&select=id,email,is_admin,is_warehouse&limit=1`,
      { headers: SERVICE_HEADERS }
    );
    if (r1.ok) {
      const rows = await r1.json();
      const u = rows?.[0];
      if (u && (u.is_admin || u.is_warehouse)) {
        let staffId = u.id;
        try {
          const sr = await fetch(
            `${SB_URL}/rest/v1/staff_members?email=eq.${encodeURIComponent(email)}&select=id&limit=1`,
            { headers: SERVICE_HEADERS }
          );
          const srows = sr.ok ? await sr.json() : [];
          if (srows?.[0]?.id) staffId = srows[0].id;
        } catch {}
        return { staffId, role: u.is_admin ? "admin" : "staff", email: u.email || email };
      }
    }
  } catch {}

  // 2) Fallback: legacy staff_members by email
  try {
    const r2 = await fetch(
      `${SB_URL}/rest/v1/staff_members?email=eq.${encodeURIComponent(email)}&select=id,role,email&limit=1`,
      { headers: SERVICE_HEADERS }
    );
    if (r2.ok) {
      const rows = await r2.json();
      const member = rows?.[0];
      if (member) return { staffId: member.id, role: member.role, email: member.email };
    }
  } catch {}

  res.status(403).json({ error: "Forbidden" });
  return null;
}

// Verify the request JWT and return the auth user object (any role).
// Use this for endpoints that should be reachable by any authenticated
// user — staff, lecturer, or student — but not by anonymous callers.
// On failure sends 401 and returns null.
export async function requireUser(req, res) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const authUser = await verifyToken(token);
  if (!authUser) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return { id: authUser.id, email: String(authUser.email || "").toLowerCase() };
}

// Like requireStaff but also enforces role === "admin".
export async function requireAdmin(req, res) {
  const staff = await requireStaff(req, res);
  if (!staff) return null;

  if (staff.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }

  return staff;
}
