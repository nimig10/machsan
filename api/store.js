// store.js — server-side proxy for reading + writing the store table.
// Uses SERVICE_ROLE_KEY so writes bypass RLS. This lets us lock down the
// anon role to read-only (+ reservations/studio_bookings only).
//
// READ (GET) — returns `data` for a given key, with role-based redaction.
//   Non-staff callers get phone fields stripped from sensitive keys
//   (reservations / certifications / lecturers / team_members / studioBookings)
//   except for their own record (matched by email). Staff get the raw data.
//
// WRITE (POST) — proxies an upsert to the store row via service_role.
//   Recognises the SHRINK GUARD trigger error (migration 011) and surfaces
//   it as HTTP 409 with a machine-readable code so the client can react.

import { resolveUserRole } from "./_auth-helper.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SERVICE_HEADERS_READ = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

const SERVICE_HEADERS_WRITE = {
  ...SERVICE_HEADERS_READ,
  Prefer: "resolution=merge-duplicates",
};

// Keys that contain personal phone numbers. For non-staff reads we strip
// `phone` from every record except the caller's own (matched by email).
const PHONE_SENSITIVE_KEYS = new Set([
  "reservations",
  "lecturers",
  "teamMembers",
  "studioBookings",
  "lessons", // lessons embed lecturer phone in some views
]);

function stripPhoneFromArray(arr, callerEmail) {
  if (!Array.isArray(arr)) return arr;
  return arr.map(r => {
    if (!r || typeof r !== "object") return r;
    if (!("phone" in r) && !("phoneNumber" in r)) return r;
    const rowEmail = String(r.email || "").toLowerCase().trim();
    if (callerEmail && rowEmail && rowEmail === callerEmail) return r;
    const { phone: _p, phoneNumber: _pn, ...rest } = r;
    return rest;
  });
}

// certifications has shape { students: [...], lecturers: [...] }
function stripPhoneFromCertifications(obj, callerEmail) {
  if (!obj || typeof obj !== "object") return obj;
  const out = { ...obj };
  if (Array.isArray(obj.students))  out.students  = stripPhoneFromArray(obj.students,  callerEmail);
  if (Array.isArray(obj.lecturers)) out.lecturers = stripPhoneFromArray(obj.lecturers, callerEmail);
  return out;
}

function redactForNonStaff(key, data, callerEmail) {
  if (key === "certifications") return stripPhoneFromCertifications(data, callerEmail);
  if (PHONE_SENSITIVE_KEYS.has(key)) return stripPhoneFromArray(data, callerEmail);
  return data;
}

export default async function handler(req, res) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "POST") return handlePost(req, res);
  return res.status(405).json({ error: "Method not allowed" });
}

async function handleGet(req, res) {
  const key = String(req.query?.key || "").trim();
  if (!key) return res.status(400).json({ error: "Missing key" });

  try {
    const role = await resolveUserRole(req);
    const r = await fetch(
      `${SB_URL}/rest/v1/store?key=eq.${encodeURIComponent(key)}&select=data`,
      { headers: SERVICE_HEADERS_READ }
    );
    if (!r.ok) {
      return res.status(r.status).json({ error: await r.text() });
    }
    const rows = await r.json();
    let data = Array.isArray(rows) && rows.length > 0 ? rows[0].data : null;
    if (role.role !== "staff" && data != null) {
      data = redactForNonStaff(key, data, role.email);
    }
    // Cache-Control: we want fresh data since availability changes often.
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// Keys writable by any authenticated user (student/lecturer forms).
// Everything else is staff-only. Anon is blocked entirely.
const PUBLIC_WRITE_KEYS = new Set(["studio_bookings", "studioBookings"]);

async function handlePost(req, res) {
  const { key, data } = req.body || {};
  if (!key || data === undefined) {
    return res.status(400).json({ error: "Missing key or data" });
  }

  // ── Auth gate: block anon, enforce staff for sensitive keys ──
  const role = await resolveUserRole(req);
  if (role.role === "anon") {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (role.role !== "staff" && !PUBLIC_WRITE_KEYS.has(key)) {
    console.warn(`[store.write BLOCKED] non-staff user ${role.email} tried to write key=${key}`);
    return res.status(403).json({ error: "forbidden", key });
  }

  try {
    const r = await fetch(`${SB_URL}/rest/v1/store`, {
      method: "POST",
      headers: SERVICE_HEADERS_WRITE,
      body: JSON.stringify({ key, data, updated_at: new Date().toISOString() }),
    });

    if (!r.ok) {
      const text = await r.text();
      if (/SHRINK GUARD/i.test(text)) {
        console.warn(`[shrink-guard BLOCKED] key=${key} size=${Array.isArray(data) ? data.length : "N/A"} — ${text}`);
        return res.status(409).json({
          error:  "shrink_guard_blocked",
          key,
          detail: text,
        });
      }
      return res.status(r.status).json({ error: text });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
