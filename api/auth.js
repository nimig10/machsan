export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { role, password } = req.body || {};

  if (!role || !password) {
    return res.status(400).json({ error: "Missing role or password" });
  }

  const passwords = {
    admin: process.env.ADMIN_PASSWORD,
    secretary: process.env.SECRETARY_PASSWORD,
    warehouse: process.env.WAREHOUSE_PASSWORD,
  };

  const expected = passwords[role];
  if (!expected) {
    return res.status(400).json({ error: "Unknown role" });
  }

  if (password === expected) {
    return res.status(200).json({ success: true });
  }

  return res.status(401).json({ error: "Unauthorized" });
}
