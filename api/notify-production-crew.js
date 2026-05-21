import nodemailer from "nodemailer";
import { requireUser } from "./_auth-helper.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_PASS;

const SERVICE_HEADERS = {
  apikey: SB_SERVICE_KEY,
  Authorization: `Bearer ${SB_SERVICE_KEY}`,
  "Content-Type": "application/json",
};

function normalizeEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

function escapeHtml(raw) {
  return String(raw ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function baseAppUrl(req) {
  if (process.env.APP_URL) return String(process.env.APP_URL).replace(/\/+$/, "");
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "https://app.camera.org.il";
}

function exposeError(req, err, fallback = "internal_error") {
  const host = String(req.headers.host || "");
  const isLocal = host.includes("localhost") || host.includes("127.0.0.1");
  return isLocal ? (err?.message || String(err || fallback)) : fallback;
}

async function rest(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SERVICE_HEADERS });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase REST ${res.status}: ${text}`);
  }
  return res.json();
}

function postgrestInList(values) {
  return values
    .map(value => encodeURIComponent(String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')))
    .join(",");
}

async function fetchProduction(productionId) {
  const rows = await rest(
    `productions?id=eq.${encodeURIComponent(productionId)}&select=id,title,director_email,director_name&limit=1`,
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function fetchCrewRows(productionId, crewIds) {
  const cleanIds = [...new Set((crewIds || []).map(id => String(id || "").trim()).filter(Boolean))];
  if (cleanIds.length === 0) return [];
  const inList = postgrestInList(cleanIds);
  const rows = await rest(
    `production_crew?production_id=eq.${encodeURIComponent(productionId)}&id=in.(${inList})&select=id,student_id,crew_email,status,invited_by,role,role_label`,
  );
  return Array.isArray(rows) ? rows : [];
}

async function fetchStudentsByIds(studentIds) {
  const cleanIds = [...new Set((studentIds || []).map(id => String(id || "").trim()).filter(Boolean))];
  if (cleanIds.length === 0) return new Map();
  const inList = postgrestInList(cleanIds);
  const rows = await rest(
    `students?id=in.(${inList})&select=id,name,email`,
  );
  return new Map((Array.isArray(rows) ? rows : []).map(row => [String(row.id), row]));
}

function roleName(row) {
  const custom = String(row?.role_label || "").trim();
  if (custom) return custom;
  const role = String(row?.role || "");
  const names = {
    photographer: "צלם ראשי",
    sound: "איש סאונד",
    assistant_photographer: "עוזר צלם",
    assistant_director: "עוזר במאי",
    producer: "מפיק",
    custom: "תפקיד מותאם",
  };
  return names[role] || "איש צוות";
}

function buildEmail({ studentName, directorName, roleLabel, appUrl }) {
  const safeStudent = escapeHtml(studentName || "סטודנט/ית");
  const safeDirector = escapeHtml(directorName || "הבמאי");
  const safeRole = escapeHtml(roleLabel || "איש צוות");
  const safeUrl = escapeHtml(appUrl);

  return `<!DOCTYPE html>
<html lang="he">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:20px;background:#f0f0f0;font-family:Arial,sans-serif;direction:rtl;text-align:right">
  <div style="max-width:540px;margin:0 auto;background:#0a0c10;color:#e8eaf0;border-radius:12px;overflow:hidden;direction:rtl;text-align:right">
    <div style="background:linear-gradient(135deg,#111318,#1e232e);padding:28px;text-align:center;border-bottom:1px solid #252b38">
      <img src="https://app.camera.org.il/LOGON1.png" alt="לוגו" style="width:72px;height:72px;object-fit:contain;border-radius:10px;margin-bottom:12px"/>
      <h1 style="color:#f5a623;font-size:20px;margin:0;text-align:center">לוח הפקות</h1>
    </div>
    <div style="padding:30px;direction:rtl;text-align:right">
      <div style="background:#f5a6231a;border:1px solid #f5a623;border-radius:10px;padding:18px;text-align:center;margin-bottom:24px">
        <div style="font-size:32px;margin-bottom:6px">&#127916;</div>
        <h2 style="color:#f5a623;margin:0;font-size:18px;text-align:center">הזמנה להשתתפות בהפקה</h2>
      </div>
      <p style="font-size:15px;line-height:1.8;color:#e8eaf0;margin:0 0 14px">שלום רב <strong>${safeStudent}</strong>,</p>
      <p style="font-size:14px;line-height:1.9;color:#8891a8;margin:0 0 26px">
        הבמאי <strong style="color:#e8eaf0">${safeDirector}</strong> הזמין אותך להשתתף בהפקה שלו בתפקיד <strong style="color:#e8eaf0">${safeRole}</strong>.<br/>
        אנא כנס/י ללוח ההפקות על מנת לאשר את השתתפותך בהפקה.
      </p>
      <div style="text-align:center;margin:28px 0 10px">
        <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:16px 34px;background:#f5a623;color:#0a0c10;font-weight:900;font-size:15px;border-radius:10px;text-decoration:none;box-shadow:0 4px 18px rgba(245,166,35,0.35);font-family:Arial,'Helvetica Neue',Helvetica,sans-serif">
          כניסה לאפליקציה
        </a>
      </div>
    </div>
    <div style="padding:16px 32px;border-top:1px solid #252b38;text-align:center;font-size:11px;color:#555f72">
      מכללת קמרה אובסקורה וסאונד
    </div>
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await requireUser(req, res);
  if (!user) return;

  const { production_id, crew_ids } = req.body || {};
  const productionId = String(production_id || "").trim();
  if (!productionId || !Array.isArray(crew_ids)) {
    return res.status(400).json({ error: "missing production_id or crew_ids" });
  }
  if (!GMAIL_USER || !GMAIL_PASS) {
    return res.status(500).json({ error: "smtp_not_configured" });
  }

  try {
    const production = await fetchProduction(productionId);
    if (!production) return res.status(404).json({ error: "production_not_found" });

    if (normalizeEmail(production.director_email) !== normalizeEmail(user.email)) {
      return res.status(403).json({ error: "not_production_director" });
    }

    const crewRows = (await fetchCrewRows(productionId, crew_ids))
      .filter(row =>
        row.student_id &&
        normalizeEmail(row.crew_email) &&
        ["invited", "approved"].includes(row.status || "invited") &&
        row.invited_by === "director"
      );

    if (crewRows.length === 0) return res.status(200).json({ ok: true, sent: 0 });

    const students = await fetchStudentsByIds(crewRows.map(row => row.student_id));
    const appUrl = baseAppUrl(req);
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    });

    let sent = 0;
    const failures = [];
    const mailed = new Set();
    for (const row of crewRows) {
      const student = students.get(String(row.student_id));
      const to = normalizeEmail(student?.email || row.crew_email);
      if (!to || mailed.has(to)) continue;
      mailed.add(to);

      try {
        await transporter.sendMail({
          from: `"מכללת קמרה אובסקורה וסאונד" <${GMAIL_USER}>`,
          to,
          subject: "הזמנה להשתתפות בהפקה - לוח הפקות",
          html: buildEmail({
            studentName: student?.name || to.split("@")[0],
            directorName: production.director_name || user.email,
            roleLabel: roleName(row),
            appUrl,
          }),
        });
        sent += 1;
      } catch (err) {
        failures.push({ email: to, error: err?.message || String(err) });
      }
    }

    if (failures.length > 0) {
      return res.status(sent > 0 ? 207 : 500).json({ ok: sent > 0, sent, failures });
    }
    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error("notify-production-crew error:", err);
    return res.status(500).json({ error: exposeError(req, err) });
  }
}
