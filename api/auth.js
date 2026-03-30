import bcrypt from "bcryptjs";

const SB_URL = process.env.SUPABASE_URL || "https://wxkyqgwwraojnbmyyfco.supabase.co";
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "sb_publishable_n-mkSq7xABjj58ZBBwk6BA_RbpVS2SU";

async function sbQuery(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) return null;
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Missing email or password" });
  }

  try {
    const rows = await sbQuery(
      `staff_members?email=eq.${encodeURIComponent(email.trim().toLowerCase())}&select=id,full_name,email,role,password_hash&limit=1`
    );

    if (!rows || rows.length === 0) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
