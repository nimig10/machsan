import nodemailer from "nodemailer";

const GMAIL_USER = "camera.obscura.media@gmail.com";
const GMAIL_PASS = "ajwj isti gmel oabo";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: GMAIL_USER, pass: GMAIL_PASS },
});

function buildEmail({ type, student_name, borrow_date, return_date, items_list, wa_link, loan_type }) {
  const isApproved   = type === "approved";
  const isNew        = type === "new";
  const isTeamNotify = type === "team_notify";
  const greetingName = isTeamNotify ? "צוות המחסן" : student_name;
  const color  = isApproved ? "#2ecc71" : (isNew||isTeamNotify) ? "#f5a623" : "#e74c3c";
  const icon   = isApproved ? "✅" : (isNew||isTeamNotify) ? "⏳" : "❌";
  const title  = isApproved ? "הבקשה אושרה!" : isTeamNotify ? `בקשת השאלה חדשה — ${loan_type||""}` : isNew ? "הבקשה שלך התקבלה!" : "לצערנו הבקשה נדחתה";
  const body   = isApproved
    ? `בקשת ההשאלה של <strong>${student_name}</strong> <strong style="color:#2ecc71">אושרה</strong>.`
    : isTeamNotify
    ? `<strong>${student_name}</strong> הגיש/ה בקשת השאלה חדשה (${loan_type||""}) הממתינה לאישורך.`
    : isNew
    ? `בקשת ההשאלה שלך <strong style="color:#f5a623">התקבלה</strong> וממתינה לאישור צוות המחסן.`
    : `לצערנו בקשת ההשאלה שלך <strong style="color:#e74c3c">נדחתה</strong>. לפרטים נוספים ניתן לפנות לצוות המחסן.`;

  return `
<!DOCTYPE html>
<html lang="he">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:20px;background:#f0f0f0;font-family:Arial,sans-serif;direction:rtl;text-align:right">
  <div style="max-width:560px;margin:0 auto;background:#0a0c10;color:#e8eaf0;border-radius:12px;overflow:hidden;direction:rtl;text-align:right">
    <div style="background:linear-gradient(135deg,#111318,#1e232e);padding:32px;text-align:center;border-bottom:1px solid #252b38">
      <div style="font-size:48px;margin-bottom:10px">🎬</div>
      <h1 style="color:#f5a623;font-size:22px;margin:0;text-align:center">מחסן השאלת ציוד קמרה אובסקורה וסאונד</h1>
    </div>
    <div style="padding:32px;direction:rtl;text-align:right">
      <div style="background:${color}1a;border:1px solid ${color};border-radius:10px;padding:20px;text-align:center;margin-bottom:24px">
        <div style="font-size:36px;margin-bottom:8px">${icon}</div>
        <h2 style="color:${color};margin:0;font-size:18px;text-align:center">${title}</h2>
      </div>
      <p style="font-size:15px;line-height:1.7;direction:rtl;text-align:right">שלום <strong>${greetingName}</strong>,</p>
      <p style="font-size:14px;line-height:1.7;color:#8891a8;direction:rtl;text-align:right">${body}</p>
      <div style="background:#111318;border:1px solid #252b38;border-radius:10px;padding:20px;margin:20px 0;direction:rtl">
        <h3 style="color:#f5a623;font-size:14px;margin:0 0 12px;text-align:right">פרטי הבקשה</h3>
        <table style="width:100%;font-size:13px;color:#8891a8;border-collapse:collapse;direction:rtl">
          <tr><td style="padding:4px 0;width:130px;text-align:right">📅 תאריך השאלה:</td><td style="color:#e8eaf0;font-weight:bold;text-align:right">${borrow_date}</td></tr>
          <tr><td style="padding:4px 0;text-align:right">📅 תאריך החזרה:</td><td style="color:#e8eaf0;font-weight:bold;text-align:right">${return_date}</td></tr>
        </table>
        <div style="margin-top:14px">
          <div style="font-size:13px;color:#8891a8;margin-bottom:10px;text-align:right">🎒 ציוד מבוקש:</div>
          <table style="width:100%;border-collapse:collapse;font-size:13px;direction:rtl">
            <thead>
              <tr style="background:#1a1d26">
                <th style="text-align:right;padding:8px 12px;color:#f5a623;font-weight:700;border-bottom:1px solid #2d3244">פריט</th>
                <th style="text-align:center;padding:8px 12px;color:#f5a623;font-weight:700;border-bottom:1px solid #2d3244;width:60px">כמות</th>
              </tr>
            </thead>
            <tbody>${items_list}</tbody>
          </table>
        </div>
      </div>
      ${(isNew && wa_link) ? `
      <div style="background:rgba(37,211,102,0.08);border:1px solid rgba(37,211,102,0.2);border-radius:8px;padding:16px;font-size:13px;text-align:center;margin-bottom:20px">
        <p style="color:#8891a8;margin:0 0 12px">לזרז את התהליך — שלח ווצאפ לנמרוד:</p>
        <a href="${wa_link}" style="display:inline-block;padding:10px 24px;background:#25d366;color:#fff;border-radius:25px;font-weight:700;font-size:14px;text-decoration:none">💬 שלח ווצאפ עכשיו</a>
      </div>` : ""}
      ${isApproved ? `
      <div style="background:rgba(46,204,113,0.08);border:1px solid rgba(46,204,113,0.2);border-radius:8px;padding:16px;font-size:13px;color:#8891a8;margin-bottom:20px;direction:rtl;text-align:right">
        📌 <strong style="color:#e8eaf0">תזכורת:</strong> יש להחזיר את הציוד עד <strong style="color:#f5a623">${return_date}</strong> במצב תקין.
      </div>` : ""}
    </div>
    <div style="padding:16px 32px;border-top:1px solid #252b38;text-align:center;font-size:11px;color:#555f72">
      מחסן השאלת ציוד קמרה אובסקורה וסאונד · מכללה
    </div>
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { to, type, student_name, borrow_date, return_date, items_list, wa_link, loan_type } = req.body;
  if (!to || !type) return res.status(400).json({ error: "חסרים שדות חובה" });

  const subjects = {
    new:          "⏳ קיבלנו את הבקשה שלך – מחסן השאלת ציוד קמרה אובסקורה וסאונד",
    approved:     "✅ הבקשה שלך אושרה – מחסן השאלת ציוד קמרה אובסקורה וסאונד",
    rejected:     "עדכון לגבי בקשת ההשאלה – מחסן השאלת ציוד קמרה אובסקורה וסאונד",
    team_notify:  `📬 בקשת השאלה חדשה (${loan_type||""}) – ${student_name||""}`,
  };

  try {
    await transporter.sendMail({
      from:    `"מחסן קמרה אובסקורה וסאונד" <${GMAIL_USER}>`,
      to,
      subject: subjects[type] || "עדכון מהמחסן",
      html:    buildEmail({ type, student_name, borrow_date, return_date, items_list, wa_link, loan_type }),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Email error:", err);
    res.status(500).json({ error: err.message });
  }
}
