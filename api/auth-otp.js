// auth-otp.js — server-side Magic Link / OTP gate
//
// Before triggering Supabase OTP, this route verifies that the submitted
// email belongs to either:
//   1. an active lecturer   (store key "lecturers")
//   2. a certified student  (store key "certifications" → .students[])
//
// teamMembers is intentionally excluded from this auth flow.
// Records without a real email are never eligible.
// If no match is found the route returns 403 — Supabase is never contacted.

const SB_URL         = process.env.SUPABASE_URL;
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SERVICE_HEADERS = {
  apikey:        SB_SERVICE_KEY,
  Authorization: `Bearer ${SB_SERVICE_KEY}`,
  "Content-Type": "application/json",
};

// ── helpers ───────────────────────────────────────────────────────────────────

function normalizeEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

// ── eligibility check ─────────────────────────────────────────────────────────
// Returns { role, id, name } or null.

async function findEligibleRecord(normalizedEmail) {
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) return null;

  // 1. Lecturers — must be active and have a matching email
  const lecturers = await fetchStoreKey("lecturers");
  if (Array.isArray(lecturers)) {
    const match = lecturers.find(
      (l) => l.isActive !== false && normalizeEmail(l.email) === normalizedEmail,
    );
    if (match) return { role: "lecturer", id: String(match.id), name: String(match.fullName || "") };
  }

  // 2. Certifications students
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

// ── handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email } = req.body || {};
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Missing email" });
  }

  const normalizedEmail = normalizeEmail(email);

  if (!isValidEmail(normalizedEmail)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  // Verify eligibility before contacting Supabase
  const record = await findEligibleRecord(normalizedEmail);
  if (!record) {
    return res.status(403).json({ error: "not_registered" });
  }

  // Send OTP via Supabase Auth — service role key so we can set create_user
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

  // Return role and name so the client can prepare the post-login state
  return res.status(200).json({ ok: true, role: record.role, name: record.name });
}
