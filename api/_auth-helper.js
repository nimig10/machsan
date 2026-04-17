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
export async function requireStaff(req, res) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  const authUser = await verifyToken(token);
  if (!authUser) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  const r = await fetch(
    `${SB_URL}/rest/v1/staff_members?email=eq.${encodeURIComponent(authUser.email)}&select=id,role,email&limit=1`,
    { headers: SERVICE_HEADERS }
  );
  const rows = r.ok ? await r.json() : [];
  const member = rows?.[0];

  if (!member) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }

  return { staffId: member.id, role: member.role, email: member.email };
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
