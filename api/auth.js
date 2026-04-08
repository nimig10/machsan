// auth.js — unified authentication handler
//
// Dispatches based on `action` in request body:
//   action: "staff-login"  → password-based login for staff_members (existing flow)
//   action: "otp"          → Magic Link / OTP gate for lecturers and students
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

// ── OTP / Magic Link ──────────────────────────────────────────────────────────
// Only lecturers (store key "lecturers") and certified students
// (store key "certifications" → .students[]) are eligible.
// teamMembers is intentionally excluded.

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

async function handleOtp(req, res) {
  const { email } = req.body || {};
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

  const otpRes = await fetch(`${SB_URL}/auth/v1/otp`, {
    method:  "POST",
    headers: SERVICE_HEADERS,
    body:    JSON.stringify({ email: normalizedEmail, create_user: true }),
  });

  if (!otpRes.ok) {
    const errText = await otpRes.text();
    console.error("Supabase OTP error:", errText);
    return res.status(500).json({ error: "otp_send_failed" });
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
    if (resolvedAction === "otp")         return await handleOtp(req, res);
    return res.status(400).json({ error: "Missing or unknown action" });
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
