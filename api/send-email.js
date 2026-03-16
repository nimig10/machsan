import nodemailer from "nodemailer";

const GMAIL_USER = "camera.obscura.media@gmail.com";
const GMAIL_PASS = "ajwj isti gmel oabo";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: GMAIL_USER, pass: GMAIL_PASS },
});

function buildSubject(type, payload) {
  const loanType = payload.loan_type || "";
  const studentName = payload.student_name || "";
  const subjectMap = {
    new: "📩 קיבלנו את הבקשה שלך - מחסן השאלת ציוד קמרה אובסקורה וסאונד",
    approved: "✅ הבקשה שלך אושרה - מחסן השאלת ציוד קמרה אובסקורה וסאונד",
    rejected: "עדכון לגבי בקשת ההשאלה - מחסן השאלת ציוד קמרה אובסקורה וסאונד",
    team_notify: `📬 בקשת השאלה חדשה (${loanType}) - ${studentName}`,
    dept_head_notify: `🎓 בקשת השאלת הפקה לאישורך - ${studentName}`,
    manager_report: `📋 דיווח מצוות המחסן - ${studentName}`,
    overdue_student: "דחוף: איחור בהחזרת ציוד המחסן",
    overdue_team: `⏰ התראת איחור בהחזרת ציוד - ${studentName}`,
  };
  return subjectMap[type] || "עדכון מהמחסן";
}

export function buildEmail(payload) {
  const {
    type,
    recipient_name,
    student_name,
    borrow_date,
    borrow_time,
    return_date,
    return_time,
    items_list,
    loan_type,
    project_name,
    crew_photographer,
    crew_sound,
    approve_url,
    calendar_url,
    report_note,
  } = payload;

  const isApproved = type === "approved";
  const isNew = type === "new";
  const isTeamNotify = type === "team_notify";
  const isDeptHead = type === "dept_head_notify";
  const isManagerReport = type === "manager_report";
  const isOverdueStudent = type === "overdue_student";
  const isOverdueTeam = type === "overdue_team";

  const color = isApproved
    ? "#2ecc71"
    : isDeptHead
      ? "#9b59b6"
      : isManagerReport
        ? "#e67e22"
        : (isOverdueStudent || isOverdueTeam)
          ? "#e74c3c"
          : (isNew || isTeamNotify)
            ? "#f5a623"
            : "#e74c3c";

  const icon = isApproved
    ? "✅"
    : isDeptHead
      ? "🎓"
      : isManagerReport
        ? "📋"
        : (isOverdueStudent || isOverdueTeam)
          ? "⏰"
          : (isNew || isTeamNotify)
            ? "📩"
            : "❌";

  const title = isApproved
    ? "הבקשה אושרה"
    : isDeptHead
      ? "בקשת השאלת הפקה ממתינה לאישורך"
      : isManagerReport
        ? "דיווח מצוות המחסן"
        : isOverdueStudent
          ? "איחור בהחזרת ציוד המחסן"
          : isOverdueTeam
            ? "התראת איחור בהחזרת ציוד"
            : isTeamNotify
              ? `בקשת השאלה חדשה - ${loan_type || ""}`
              : isNew
                ? "הבקשה שלך התקבלה"
                : "הבקשה נדחתה";

  const greetingName = (isDeptHead || isManagerReport || isOverdueTeam)
    ? (recipient_name || student_name)
    : student_name;

  const body = isApproved
    ? `בקשת ההשאלה של <strong>${student_name}</strong> <strong style="color:#2ecc71">אושרה</strong>.`
    : isDeptHead
      ? `הסטודנט/ית <strong style="color:#e8eaf0">${student_name}</strong> הגיש/ה בקשת השאלת הפקה הממתינה לאישורך.<br/><br/>רק לאחר אישורך תועבר הבקשה לצוות המחסן לטיפול סופי.`
      : isManagerReport
        ? `צוות המחסן שלח דיווח בנוגע ל<strong style="color:#e8eaf0">${student_name === "צוות המחסן" ? loan_type : `בקשת ${student_name}`}</strong>.`
        : isOverdueStudent
          ? `שלום <strong style="color:#e8eaf0">${student_name}</strong>, חלפה יותר משעה ממועד ההחזרה שנקבע לציוד שהושאל לך, והבקשה עדיין לא סומנה כ<strong style="color:#e74c3c">"הוחזר"</strong>.<br/><br/>הנהלת המכללה רואה איחורים בהחזרת ציוד בחומרה. יש להחזיר את הציוד למחסן באופן מיידי או ליצור קשר עם צוות המחסן ללא דיחוי.`
          : isOverdueTeam
            ? `המערכת זיהתה שבקשת ההשאלה של <strong style="color:#e8eaf0">${student_name}</strong> חרגה ביותר משעה ממועד ההחזרה, ועדיין לא סומנה כ<strong style="color:#e74c3c">"הוחזר"</strong>.`
            : isTeamNotify
              ? `<strong>${student_name}</strong> הגיש/ה בקשת השאלה חדשה (${loan_type || ""}) הממתינה לאישורך.`
              : isNew
                ? `בקשת ההשאלה שלך <strong style="color:#f5a623">התקבלה</strong> וממתינה לאישור.`
                : `לצערנו בקשת ההשאלה שלך <strong style="color:#e74c3c">נדחתה</strong>.`;

  const reportSection = isManagerReport && report_note ? `
    <div style="background:#1a1d26;border:1px solid #2d3244;border-radius:8px;padding:16px;margin:16px 0;direction:rtl">
      <div style="font-size:13px;color:#e67e22;font-weight:700;margin-bottom:10px">הערת צוות המחסן</div>
      <div style="font-size:13px;color:#e8eaf0;white-space:pre-wrap;line-height:1.7">${report_note}</div>
    </div>` : "";

  const crewSection = isDeptHead ? `
    <div style="background:#1a1d26;border:1px solid #2d3244;border-radius:8px;padding:16px;margin:16px 0;direction:rtl">
      <div style="font-size:13px;color:#f5a623;font-weight:700;margin-bottom:10px">פרטי צוות ההפקה</div>
      ${project_name ? `<div style="font-size:13px;color:#8891a8;margin-bottom:6px">🎞️ פרויקט: <strong style="color:#e8eaf0">${project_name}</strong></div>` : ""}
      <div style="font-size:13px;color:#8891a8;margin-bottom:6px">🎥 צלם: <strong style="color:#e8eaf0">${crew_photographer || "—"}</strong></div>
      <div style="font-size:13px;color:#8891a8">🎙️ איש סאונד: <strong style="color:#e8eaf0">${crew_sound || "—"}</strong></div>
    </div>` : "";

  const overdueAlert = (isOverdueStudent || isOverdueTeam) ? `
    <div style="background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.38);border-radius:10px;padding:16px 18px;margin:18px 0;direction:rtl">
      <div style="font-size:14px;font-weight:900;color:#e74c3c;margin-bottom:8px">התראת איחור פעילה</div>
      <div style="font-size:13px;color:#e8eaf0;line-height:1.8">
        ${isOverdueStudent
          ? "אם הציוד כבר הוחזר בפועל, יש לעדכן את צוות המחסן מיד כדי למנוע המשך טיפול משמעתי."
          : "יש לעבור על הבקשה ולפעול מול הסטודנט עד לעדכון ההחזרה במערכת."}
      </div>
    </div>` : "";

  const approveButton = isDeptHead && approve_url ? `
    <div style="text-align:center;margin:28px 0 16px">
      <a href="${approve_url}" style="display:inline-block;padding:18px 40px;background:#9b59b6;color:#fff;font-weight:900;font-size:16px;border-radius:10px;text-decoration:none;letter-spacing:0.5px;box-shadow:0 4px 18px rgba(155,89,182,0.4)">
        ✅ אשר הפקה - העבר לצוות המחסן
      </a>
      <div style="font-size:12px;color:#555f72;margin-top:10px;line-height:1.6">
        לחיצה תעביר את הבקשה לסטטוס <strong style="color:#e8eaf0">"ממתין"</strong> לטיפול צוות המחסן.
      </div>
    </div>` : "";

  const calendarButton = (isDeptHead || isManagerReport) && calendar_url ? `
    <div style="text-align:center;margin:0 0 24px">
      <a href="${calendar_url}" style="display:inline-block;padding:12px 26px;background:#111318;color:#e8eaf0;font-weight:800;font-size:14px;border-radius:10px;text-decoration:none;border:1px solid #2d3244">
        📅 לצפייה בלוח השנה
      </a>
    </div>` : "";

  const showDetails = !isManagerReport || student_name !== "צוות המחסן";
  const itemsTableBody = typeof items_list === "string" && items_list.includes("<tr>")
    ? items_list
    : (items_list ? `<tr><td style="padding:7px 12px;color:#e8eaf0;border-bottom:1px solid #1e2130" colspan="2">${items_list}</td></tr>` : "");

  return `
<!DOCTYPE html>
<html lang="he">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:20px;background:#f0f0f0;font-family:Arial,sans-serif;direction:rtl;text-align:right">
  <div style="max-width:580px;margin:0 auto;background:#0a0c10;color:#e8eaf0;border-radius:12px;overflow:hidden;direction:rtl;text-align:right">
    <div style="background:linear-gradient(135deg,#111318,#1e232e);padding:32px;text-align:center;border-bottom:1px solid #252b38">
      <div style="font-size:48px;margin-bottom:10px">${icon}</div>
      <h1 style="color:#f5a623;font-size:22px;margin:0;text-align:center">מחסן השאלת ציוד קמרה אובסקורה וסאונד</h1>
    </div>
    <div style="padding:32px;direction:rtl;text-align:right">
      <div style="background:${color}1a;border:1px solid ${color};border-radius:10px;padding:20px;text-align:center;margin-bottom:24px">
        <div style="font-size:36px;margin-bottom:8px">${icon}</div>
        <h2 style="color:${color};margin:0;font-size:18px;text-align:center">${title}</h2>
      </div>
      <p style="font-size:15px;line-height:1.7;direction:rtl;text-align:right">שלום <strong>${greetingName || "שם מלא"}</strong>,</p>
      <p style="font-size:14px;line-height:1.9;color:#8891a8;direction:rtl;text-align:right">${body}</p>
      ${overdueAlert}
      ${crewSection}
      ${reportSection}
      <div style="background:#111318;border:1px solid #252b38;border-radius:10px;padding:20px;margin:20px 0;direction:rtl">
        <h3 style="color:#f5a623;font-size:14px;margin:0 0 12px;text-align:right">פרטי הבקשה</h3>
        <table style="width:100%;font-size:13px;color:#8891a8;border-collapse:collapse;direction:rtl">
          ${showDetails ? `<tr><td style="padding:4px 0;width:130px;text-align:right">👤 שם:</td><td style="color:#e8eaf0;font-weight:bold;text-align:right">${student_name || "—"}</td></tr>` : ""}
          ${borrow_date ? `<tr><td style="padding:4px 0;text-align:right">📅 תאריך השאלה:</td><td style="color:#e8eaf0;font-weight:bold;text-align:right">${borrow_date}${borrow_time ? " · " + borrow_time : ""}</td></tr>` : ""}
          ${return_date ? `<tr><td style="padding:4px 0;text-align:right">↩ תאריך החזרה:</td><td style="color:#e8eaf0;font-weight:bold;text-align:right">${return_date}${return_time ? " · " + return_time : ""}</td></tr>` : ""}
        </table>
        ${itemsTableBody ? `
        <div style="margin-top:14px">
          <div style="font-size:13px;color:#8891a8;margin-bottom:10px;text-align:right">🎒 ציוד:</div>
          <table style="width:100%;border-collapse:collapse;font-size:13px;direction:rtl">
            <thead><tr style="background:#1a1d26">
              <th style="text-align:right;padding:8px 12px;color:#f5a623;font-weight:700;border-bottom:1px solid #2d3244">פריט</th>
              <th style="text-align:center;padding:8px 12px;color:#f5a623;font-weight:700;border-bottom:1px solid #2d3244;width:60px">כמות</th>
            </tr></thead>
            <tbody>${itemsTableBody}</tbody>
          </table>
        </div>` : ""}
      </div>
      ${approveButton}
      ${calendarButton}
      ${isApproved ? `
      <div style="background:rgba(46,204,113,0.08);border:1px solid rgba(46,204,113,0.2);border-radius:8px;padding:16px;font-size:13px;color:#8891a8;margin-bottom:20px;direction:rtl;text-align:right">
        📌 <strong style="color:#e8eaf0">תזכורת:</strong> יש להחזיר את הציוד עד <strong style="color:#f5a623">${return_date}${return_time ? " בשעה " + return_time : ""}</strong> במצב תקין.
      </div>` : ""}
    </div>
    <div style="padding:16px 32px;border-top:1px solid #252b38;text-align:center;font-size:11px;color:#555f72">
      מחסן השאלת ציוד קמרה אובסקורה וסאונד · מכללה
    </div>
  </div>
</body>
</html>`;
}

export async function sendTypedEmail(payload) {
  const { to, type } = payload || {};
  if (!to || !type) {
    throw new Error("חסרים שדות חובה");
  }

  return transporter.sendMail({
    from: `"מחסן קמרה אובסקורה וסאונד" <${GMAIL_USER}>`,
    to,
    subject: buildSubject(type, payload),
    html: buildEmail(payload),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const payload = req.body || {};
  if (!payload.to || !payload.type) {
    return res.status(400).json({ error: "חסרים שדות חובה" });
  }

  try {
    await sendTypedEmail(payload);
    res.json({ ok: true });
  } catch (err) {
    console.error("Email error:", err);
    res.status(500).json({ error: err.message });
  }
}
