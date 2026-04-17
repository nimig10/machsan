// api/approve-production.js
// Called when dept head clicks "אשר הפקה" button in email.
// Updates reservation status from "ממתין לאישור ראש המחלקה" → "ממתין".
//
// AUTHORIZATION: IDOR-safe. The link must carry a HMAC-signed `token` that
// was issued by send-email.js (via _approve-token.js) for that specific id.
// Without a matching signature + non-expired exp, the request is rejected
// with 403. Guessing another reservation id no longer lets anyone approve it.

import { verifyApproveToken } from "./_approve-token.js";
import { resolveUserRole } from "./_auth-helper.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Is the caller a dept head, staff, or admin?
// Staff/admin is resolved from public.users (resolveUserRole).
// Dept heads live in the store.deptHeads JSON blob — match by email.
async function isAuthorizedApprover(req) {
  const role = await resolveUserRole(req);
  if (!role || role.role === "anon") return false;
  if (role.role === "staff") return true;
  if (!role.email) return false;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/store?key=eq.deptHeads&select=data`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    if (!r.ok) return false;
    const rows = await r.json();
    const list = Array.isArray(rows) && rows[0]?.data;
    if (!Array.isArray(list)) return false;
    return list.some(dh =>
      dh?.email && String(dh.email).toLowerCase().trim() === role.email
    );
  } catch { return false; }
}

const SB_HEADERS = {
  "apikey":        SB_KEY,
  "Authorization": `Bearer ${SB_KEY}`,
  "Content-Type":  "application/json",
};

export default async function handler(req, res) {
  const { id, token } = req.query;

  if (!id) {
    return res.status(400).send(buildPage("❌ שגיאה", "מזהה בקשה חסר", "#e74c3c"));
  }

  // Two accepted auth paths:
  //  1) A valid HMAC-signed token that binds this specific id (email flow).
  //  2) A Supabase session JWT belonging to a dept head, staff, or admin
  //     (in-app "approve" button in LecturerPortal → DeptHeadCalendarPage).
  const hasValidToken = token && verifyApproveToken(id, token);
  const hasValidJwt   = !hasValidToken && await isAuthorizedApprover(req);
  if (!hasValidToken && !hasValidJwt) {
    return res.status(403).send(buildPage(
      "❌ קישור לא תקין",
      "הקישור פג תוקף או שאינו שייך לבקשה זו. אנא פנה/י למחסן.",
      "#e74c3c"
    ));
  }

  try {
    // Fetch current reservations from Supabase
    const getRes = await fetch(`${SB_URL}/rest/v1/store?key=eq.reservations&select=data`, { headers: SB_HEADERS });
    const getJson = await getRes.json();

    if (!Array.isArray(getJson) || !getJson.length || !getJson[0].data) {
      return res.status(500).send(buildPage("❌ שגיאה", "לא ניתן לטעון בקשות", "#e74c3c"));
    }

    const reservations = getJson[0].data;
    const reservation = reservations.find(r => String(r.id) === String(id));

    if (!reservation) {
      return res.status(404).send(buildPage("❌ לא נמצא", "הבקשה לא נמצאה במערכת", "#e74c3c"));
    }

    if (!["ממתין לאישור ראש המחלקה","אישור ראש מחלקה"].includes(reservation.status)) {
      const msg = reservation.status === "מאושר"
        ? "הבקשה כבר אושרה קודם"
        : reservation.status === "נדחה"
        ? "הבקשה נדחתה"
        : `סטטוס נוכחי: ${reservation.status}`;
      return res.status(200).send(buildPage("ℹ️ עדכון", msg, "#3498db"));
    }

    // Update status to "ממתין"
    const updated = reservations.map(r =>
      String(r.id) === String(id) ? { ...r, status: "ממתין" } : r
    );

    const saveRes = await fetch(`${SB_URL}/rest/v1/store`, {
      method: "POST",
      headers: { ...SB_HEADERS, "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify({ key: "reservations", data: updated, updated_at: new Date().toISOString() }),
    });

    if (!saveRes.ok) {
      return res.status(500).send(buildPage("❌ שגיאה", "לא ניתן לעדכן את הסטטוס", "#e74c3c"));
    }

    return res.status(200).send(buildPage(
      "✅ ההפקה אושרה!",
      `בקשת ההפקה של <strong>${reservation.student_name}</strong> עברה לסטטוס "ממתין" וצוות המחסן יטפל בה.`,
      "#2ecc71"
    ));

  } catch (err) {
    console.error("approve-production error:", err);
    return res.status(500).send(buildPage("❌ שגיאת שרת", err.message, "#e74c3c"));
  }
}

function buildPage(title, message, color) {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
  body { font-family: Arial, sans-serif; background: #0a0c10; color: #e8eaf0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; direction: rtl; }
  .box { background: #111318; border: 1px solid #252b38; border-radius: 16px; padding: 48px; text-align: center; max-width: 480px; width: 90%; }
  .icon { font-size: 64px; margin-bottom: 20px; }
  h1 { color: ${color}; font-size: 24px; margin-bottom: 16px; }
  p { color: #8891a8; font-size: 15px; line-height: 1.7; }
  .btn { display: inline-block; margin-top: 28px; padding: 12px 28px; background: ${color}; color: #000; font-weight: 700; border-radius: 8px; text-decoration: none; font-size: 14px; }
</style>
</head>
<body>
  <div class="box">
    <div class="icon">🎬</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="javascript:window.close()" class="btn">סגור חלון</a>
  </div>
</body>
</html>`;
}
