import nodemailer from "nodemailer";
import { signApproveToken } from "./_approve-token.js";

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_PASS;

// Build the dept-head approval URL server-side so the HMAC secret never
// leaves the server. The client only tells us `reservation_id`; we sign it
// here and embed the signature in the link.
function buildApproveUrl(req, reservationId) {
  const id = reservationId == null ? "" : String(reservationId);
  if (!id) return "";
  const token = signApproveToken(id);
  if (!token) return "";
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host  = (req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (!host) return "";
  return `${proto}://${host}/api/approve-production?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: GMAIL_USER, pass: GMAIL_PASS },
});

function buildEmail({
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
  production_reason,
  crew_photographer,
  crew_sound,
  approve_url,
  calendar_url,
  portal_url,
  report_note,
  reservation_id,
  custom_message,
  teacher_message,
  lesson_message,
  lesson_kit_name,
  logo_url,
  sound_logo_url,
}) {
  const isApproved        = type === "approved";
  const isNew             = type === "new";
  const isTeamNotify      = type === "team_notify";
  const isDeptHead        = type === "dept_head_notify";
  const isManagerReport   = type === "manager_report";
  const isOverdue         = type === "overdue";
  const isOverdueTeam     = type === "overdue_team";
  const isLessonKitReady  = type === "lesson_kit_ready";
  const isStudioApproved  = type === "studio_approved";
  const isStudioDeleted   = type === "studio_deleted";
  const isLessonConflict  = type === "studio_lesson_conflict";

  const finalTeacherMessage =
    teacher_message || custom_message || lesson_message || report_note || "";

  const color = isLessonConflict ? "#e74c3c"
    : isStudioApproved ? "#2ecc71"
    : isStudioDeleted ? "#e74c3c"
    : isApproved ? "#2ecc71"
    : isDeptHead ? "#9b59b6"
    : isManagerReport ? "#e67e22"
    : isLessonKitReady ? "#3498db"
    : (isOverdue || isOverdueTeam) ? "#e74c3c"
    : (isNew || isTeamNotify) ? "#f5a623"
    : "#e74c3c";

  const icon = isLessonConflict ? "❌"
    : isStudioApproved ? "🎙️"
    : isStudioDeleted ? "❌"
    : isApproved ? "✅"
    : isDeptHead ? "🎓"
    : isManagerReport ? "📋"
    : isLessonKitReady ? "📚"
    : (isOverdue || isOverdueTeam) ? "🚨"
    : (isNew || isTeamNotify) ? "⏳"
    : "❌";

  const title = isLessonConflict ? "קביעת החדר בוטלה לטובת שיעור"
    : isStudioApproved ? "קביעת החדר אושרה! 🎙️"
    : isStudioDeleted ? "קביעת החדר בוטלה"
    : isApproved ? "הבקשה אושרה!"
    : isDeptHead ? "בקשת השאלת הפקה ממתינה לאישורך"
    : isManagerReport ? "דיווח מצוות המחסן"
    : isLessonKitReady ? "ערכת השיעור מוכנה לבדיקה"
    : isOverdue ? "⚠️ הציוד לא הוחזר — נדרשת פעולה מיידית"
    : isOverdueTeam ? `🚨 ציוד לא הוחזר — ${student_name || ""}`
    : isTeamNotify ? `בקשת השאלה חדשה — ${loan_type || ""}`
    : isNew ? "הבקשה שלך התקבלה!"
    : "לצערנו הבקשה נדחתה";

  const greetingName = (isDeptHead || isManagerReport || isTeamNotify) ? (recipient_name || student_name)
    : isOverdueTeam ? (recipient_name || "צוות המחסן")
    : isLessonKitReady ? (recipient_name || student_name || "המורה")
    : student_name;

  const body = isLessonConflict
    ? `אנו מתנצלים, אך המכללה נאלצה לבטל את קביעת החדר שלך לטובת שיעור.<br/><br/>
       קביעת החדר <strong style="color:#e8eaf0">${project_name || "החדר"}</strong>${borrow_date ? ` בתאריך <strong style="color:#e8eaf0">${borrow_date}</strong>` : ""}${borrow_time ? ` בין השעות <strong style="color:#e8eaf0">${borrow_time}–${return_time || ""}</strong>` : ""} <strong style="color:#e74c3c">בוטלה</strong>.<br/><br/>
       אתה מוזמן לנסות ולקבוע חדר חלופי בלוח קביעת החדרים, או לנסות ולקבוע את החדר <strong style="color:#e8eaf0">${project_name || "החדר"}</strong> ביום אחר.`
    : isStudioApproved
    ? `קביעת החדר שלך עברה את אישורו של איש הצוות בהצלחה 🎉<br/><br/>
       ניתן להגיע בשמחה ולעבוד בחדר <strong style="color:#2ecc71">${project_name || "החדר"}</strong>.`
    : isStudioDeleted
    ? `לצערנו לא ניתן לקבוע את החדר <strong style="color:#e8eaf0">${project_name || "החדר"}</strong>${borrow_date ? ` בתאריך <strong style="color:#e8eaf0">${borrow_date}</strong>${borrow_time ? ` בשעה <strong style="color:#e8eaf0">${borrow_time}</strong>` : ""}` : ""}.<br/><br/>
       מתנצלים על אי הנוחות, ומזמנים אותך לנסות ולקבוע אותו במועד אחר.`
    : isApproved
    ? `בקשת ההשאלה של <strong>${student_name}</strong> <strong style="color:#2ecc71">אושרה</strong>.`
    : isDeptHead
    ? `הסטודנט/ית <strong style="color:#e8eaf0">${student_name}</strong> הגיש/ה בקשת השאלת הפקה הממתינה לאישורך.<br/><br/>
       רק לאחר אישורך תועבר הבקשה לצוות המחסן לטיפול סופי.`
    : isManagerReport
    ? `צוות המחסן שלח דיווח בנוגע ל<strong style="color:#e8eaf0">${student_name === "צוות המחסן" ? loan_type : `בקשת ${student_name}`}</strong>.`
    : isLessonKitReady
    ? `ערכת השיעור <strong style="color:#e8eaf0">${lesson_kit_name || project_name || loan_type || "המבוקשת"}</strong> הורכבה על ידי צוות המחסן ומוכנה כעת לבדיקה שלך.<br/><br/>
       אפשר לעבור על פרטי הערכה שמופיעים מטה ולוודא שהכול תקין.`
    : isOverdue
    ? `<strong style="color:#e74c3c">${student_name || "הסטודנט/ית"} — שים/י לב: זמן ההשאלה שלך תם והציוד עדיין לא הוחזר למחסן.</strong><br/><br/>
       מועד ההחזרה שנקבע היה <strong style="color:#e8eaf0">${return_date}${return_time ? " בשעה " + return_time : ""}</strong>, והציוד <strong style="color:#e74c3c">טרם הוחזר</strong>.<br/><br/>
       <strong style="color:#f5a623">מנהלת המכללה תאלץ לשקול צעדים נוספים על מנת לטפל בנושא אי ההחזרה</strong> אם הציוד לא יושב למכללה בהקדם.<br/><br/>
       יש להשיב את הציוד למכללה <strong style="color:#e74c3c">כמה שיותר מוקדם</strong> וליצור קשר עם צוות המחסן במידת הצורך.`
    : isOverdueTeam
    ? `הסטודנט/ית <strong style="color:#e8eaf0">${student_name}</strong> לא החזיר/ה את הציוד במועד הנקבע.<br/><br/>
       מועד ההחזרה היה <strong style="color:#e8eaf0">${return_date}${return_time ? " בשעה " + return_time : ""}</strong> — <strong style="color:#e74c3c">הציוד טרם הוחזר.</strong><br/><br/>
       מומלץ ליצור קשר עם הסטודנט בהקדם האפשרי.`
    : isTeamNotify
    ? `<strong>${student_name}</strong> הגיש/ה בקשת השאלה חדשה (${loan_type || ""}) הממתינה לאישורך.`
    : isNew
    ? `בקשת ההשאלה שלך <strong style="color:#f5a623">התקבלה</strong> וממתינה לאישור.`
    : `לצערנו בקשת ההשאלה שלך <strong style="color:#e74c3c">נדחתה</strong>.`;

  const reportSection = isManagerReport && report_note ? `
    <div style="background:#1a1d26;border:1px solid #2d3244;border-radius:8px;padding:16px;margin:16px 0;direction:rtl">
      <div style="font-size:13px;color:#e67e22;font-weight:700;margin-bottom:10px">📝 הערת צוות המחסן</div>
      <div style="font-size:13px;color:#e8eaf0;white-space:pre-wrap;line-height:1.7">${report_note}</div>
    </div>` : "";

  const lessonKitSection = isLessonKitReady && finalTeacherMessage ? `
    <div style="background:#1a1d26;border:1px solid #2d3244;border-radius:8px;padding:16px;margin:16px 0;direction:rtl">
      <div style="font-size:13px;color:#3498db;font-weight:700;margin-bottom:10px">📩 הודעה מצוות המחסן</div>
      <div style="font-size:13px;color:#e8eaf0;white-space:pre-wrap;line-height:1.7">${finalTeacherMessage}</div>
    </div>` : "";

  const studentMessageSection = custom_message && (isApproved || isOverdue || (!isNew && !isTeamNotify && !isDeptHead && !isManagerReport && !isLessonKitReady && !isOverdueTeam)) ? `
    <div style="background:#1a1d26;border:1px solid #2d3244;border-radius:8px;padding:16px;margin:16px 0;direction:rtl">
      <div style="font-size:13px;color:${isApproved ? "#2ecc71" : isOverdue ? "#f5a623" : "#e74c3c"};font-weight:700;margin-bottom:10px">${isApproved ? "דיווח מצוות המחסן על אישור הבקשה" : isOverdue ? "הודעה נוספת מצוות המחסן על האיחור" : "הסבר מצוות המחסן על סיבת הדחייה"}</div>
      <div style="font-size:13px;color:#e8eaf0;white-space:pre-wrap;line-height:1.7">${custom_message}</div>
    </div>` : "";

  const crewSection = isDeptHead ? `
    <div style="background:#1a1d26;border:1px solid #2d3244;border-radius:8px;padding:16px;margin:16px 0;direction:rtl">
      <div style="font-size:13px;color:#f5a623;font-weight:700;margin-bottom:10px">פרטי צוות ההפקה</div>
      ${project_name ? `<div style="font-size:13px;color:#8891a8;margin-bottom:6px">📽️ פרויקט: <strong style="color:#e8eaf0">${project_name}</strong></div>` : ""}
      <div style="font-size:13px;color:#8891a8;margin-bottom:6px">🎥 צלם: <strong style="color:#e8eaf0">${crew_photographer || "—"}</strong></div>
      <div style="font-size:13px;color:#8891a8">🎙️ איש סאונד: <strong style="color:#e8eaf0">${crew_sound || "—"}</strong></div>
    </div>` : "";

  const productionReasonSection = isDeptHead && production_reason ? `
    <div style="background:#1a1d26;border:1px solid #2d3244;border-radius:8px;padding:16px;margin:16px 0;direction:rtl">
      <div style="font-size:13px;color:#f5a623;font-weight:700;margin-bottom:10px">הסבר לראש המחלקה את סיבת ההשאלה</div>
      <div style="font-size:13px;color:#e8eaf0;white-space:pre-wrap;line-height:1.8">${production_reason}</div>
    </div>` : "";

  const approveButton = isDeptHead && approve_url ? `
    <div style="text-align:center;margin:28px 0 16px">
      <a href="${approve_url}" style="display:inline-block;padding:18px 40px;background:#9b59b6;color:#fff;font-weight:900;font-size:16px;border-radius:10px;text-decoration:none;letter-spacing:0.5px;box-shadow:0 4px 18px rgba(155,89,182,0.4)">
        ✅ אשר הפקה — העבר לצוות המחסן
      </a>
      <div style="font-size:12px;color:#555f72;margin-top:10px;line-height:1.6">
        לחיצה תעביר את הבקשה לסטטוס <strong style="color:#e8eaf0">"ממתין"</strong> לטיפול צוות המחסן.<br/>
        הבקשה לא תאושר ולא תועבר ללא לחיצה על כפתור זה.
      </div>
    </div>` : "";

  const portalButton = isDeptHead && portal_url ? `
    <div style="text-align:center;margin:0 0 24px">
      <a href="${portal_url}" style="display:inline-block;padding:12px 26px;background:#111318;color:#e8eaf0;font-weight:800;font-size:14px;border-radius:10px;text-decoration:none;border:1px solid #2d3244">
        🎓 כניסה לפורטל
      </a>
    </div>` : "";

  const calendarButton = isManagerReport && calendar_url ? `
    <div style="text-align:center;margin:0 0 24px">
      <a href="${calendar_url}" style="display:inline-block;padding:12px 26px;background:#111318;color:#e8eaf0;font-weight:800;font-size:14px;border-radius:10px;text-decoration:none;border:1px solid #2d3244">
        📅 לצפייה בלוח השנה
      </a>
    </div>` : "";

  const showDetails = !isManagerReport || student_name !== "צוות המחסן";

  return `
<!DOCTYPE html>
<html lang="he">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:20px;background:#f0f0f0;font-family:Arial,sans-serif;direction:rtl;text-align:right">
  <div style="max-width:580px;margin:0 auto;background:#0a0c10;color:#e8eaf0;border-radius:12px;overflow:hidden;direction:rtl;text-align:right">
    <div style="background:linear-gradient(135deg,#111318,#1e232e);padding:32px;text-align:center;border-bottom:1px solid #252b38">
      ${logo_url
        ? `<img src="${logo_url}" alt="לוגו" style="width:80px;height:80px;object-fit:contain;border-radius:10px;margin-bottom:${sound_logo_url ? "6px" : "12px"}"/>`
        : `<div style="font-size:48px;margin-bottom:10px">${isLessonKitReady ? "📚" : "🎬"}</div>`}
      ${sound_logo_url ? `<img src="${sound_logo_url}" alt="לוגו סאונד" style="width:60px;height:60px;object-fit:contain;border-radius:8px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto"/>` : ""}
      <h1 style="color:#f5a623;font-size:22px;margin:0;text-align:center">מכללת קמרה אובסקורה וסאונד</h1>
    </div>
    <div style="padding:32px;direction:rtl;text-align:right">
      <div style="background:${color}1a;border:1px solid ${color};border-radius:10px;padding:20px;text-align:center;margin-bottom:24px">
        <div style="font-size:36px;margin-bottom:8px">${icon}</div>
        <h2 style="color:${color};margin:0;font-size:18px;text-align:center">${title}</h2>
      </div>
      <p style="font-size:15px;line-height:1.7;direction:rtl;text-align:right">שלום <strong>${greetingName}</strong>,</p>
      <p style="font-size:14px;line-height:1.9;color:#8891a8;direction:rtl;text-align:right">${body}</p>
      ${crewSection}
      ${productionReasonSection}
      ${reportSection}
      ${lessonKitSection}
      ${studentMessageSection}
      <div style="background:#111318;border:1px solid #252b38;border-radius:10px;padding:20px;margin:20px 0;direction:rtl">
        <h3 style="color:#f5a623;font-size:14px;margin:0 0 12px;text-align:right">פרטי הבקשה</h3>
        <table style="width:100%;font-size:13px;color:#8891a8;border-collapse:collapse;direction:rtl">
          ${showDetails ? `<tr><td style="padding:4px 0;width:130px;text-align:right">👤 שם:</td><td style="color:#e8eaf0;font-weight:bold;text-align:right">${student_name}</td></tr>` : ""}
          ${(lesson_kit_name || (isLessonKitReady && project_name)) ? `<tr><td style="padding:4px 0;text-align:right">📚 ערכה:</td><td style="color:#e8eaf0;font-weight:bold;text-align:right">${lesson_kit_name || project_name}</td></tr>` : ""}
          ${loan_type ? `<tr><td style="padding:4px 0;text-align:right">🏷️ סוג:</td><td style="color:#e8eaf0;font-weight:bold;text-align:right">${loan_type}</td></tr>` : ""}
          ${borrow_date ? `<tr><td style="padding:4px 0;text-align:right;white-space:nowrap">📅 תאריך השאלה:</td><td style="color:#e8eaf0;font-weight:bold;text-align:right"><span style="white-space:nowrap">${borrow_date}</span>${borrow_time ? ` <span style="white-space:nowrap">🕐 ${borrow_time}</span>` : ""}</td></tr>` : ""}
          ${return_date ? `<tr><td style="padding:4px 0;text-align:right;white-space:nowrap">↩ תאריך החזרה:</td><td style="color:#e8eaf0;font-weight:bold;text-align:right"><span style="white-space:nowrap">${return_date}</span>${return_time ? ` <span style="white-space:nowrap">🕐 ${return_time}</span>` : ""}</td></tr>` : ""}
        </table>
        ${items_list ? `
        <div style="margin-top:14px">
          <div style="font-size:13px;color:#8891a8;margin-bottom:10px;text-align:right">🎒 ציוד:</div>
          <table style="width:100%;border-collapse:collapse;font-size:13px;direction:rtl">
            <thead><tr style="background:#1a1d26">
              <th style="text-align:right;padding:8px 12px;color:#f5a623;font-weight:700;border-bottom:1px solid #2d3244">פריט</th>
              <th style="text-align:center;padding:8px 12px;color:#f5a623;font-weight:700;border-bottom:1px solid #2d3244;width:60px">כמות</th>
            </tr></thead>
            <tbody>${typeof items_list === "string" && items_list.includes("<tr>") ? items_list : `<tr><td style="padding:7px 12px;color:#e8eaf0;border-bottom:1px solid #1e2130" colspan="2">${items_list}</td></tr>`}</tbody>
          </table>
        </div>` : ""}
      </div>
      ${approveButton}
      ${portalButton}
      ${calendarButton}
      ${isApproved ? `
      <div style="background:rgba(46,204,113,0.08);border:1px solid rgba(46,204,113,0.2);border-radius:8px;padding:16px;font-size:13px;color:#8891a8;margin-bottom:20px;direction:rtl;text-align:right">
        📌 <strong style="color:#e8eaf0">תזכורת:</strong> יש להחזיר את הציוד עד <strong style="color:#f5a623">${return_date}${return_time ? " בשעה " + return_time : ""}</strong> במצב תקין.
      </div>` : ""}
    </div>
    <div style="padding:16px 32px;border-top:1px solid #252b38;text-align:center;font-size:11px;color:#555f72">
      מכללת קמרה אובסקורה וסאונד · מכללה
    </div>
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    to,
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
    production_reason,
    crew_photographer,
    crew_sound,
    calendar_url,
    portal_url,
    report_note,
    reservation_id,
    custom_message,
    teacher_message,
    lesson_message,
    lesson_kit_name,
    logo_url,
    sound_logo_url,
  } = req.body;

  if (!to || !type) return res.status(400).json({ error: "חסרים שדות חובה" });

  // approve_url is NEVER accepted from the client — it must be signed here.
  const approve_url = type === "dept_head_notify"
    ? buildApproveUrl(req, reservation_id)
    : "";

  const subjects = {
    studio_approved:   "🎙️ קביעת החדר שלך אושרה – מכללת קמרה אובסקורה וסאונד",
    studio_deleted:    "❌ קביעת החדר בוטלה – מכללת קמרה אובסקורה וסאונד",
    new:               "⏳ קיבלנו את הבקשה שלך – מכללת קמרה אובסקורה וסאונד",
    approved:          "✅ הבקשה שלך אושרה – מכללת קמרה אובסקורה וסאונד",
    rejected:          "עדכון לגבי בקשת ההשאלה – מכללת קמרה אובסקורה וסאונד",
    team_notify:       `📬 בקשת השאלה חדשה (${loan_type || ""}) – ${student_name || ""}`,
    dept_head_notify:  `🎓 בקשת השאלת הפקה לאישורך — ${student_name || ""}`,
    manager_report:    `📋 דיווח מצוות המחסן — ${student_name || ""}`,
    overdue:           "אזהרת איחור בהחזרת ציוד — נדרשת פעולה מיידית",
    overdue_team:      `🚨 ציוד לא הוחזר במועד — ${student_name || ""}`,
    lesson_kit_ready:  `📚 ערכת שיעור מוכנה לבדיקה — ${lesson_kit_name || project_name || student_name || ""}`,
  };

  // Convert base64 data URIs to inline CID attachments (email clients block data: URIs)
  const attachments = [];
  let finalLogoUrl = logo_url || "";
  let finalSoundLogoUrl = sound_logo_url || "";

  if (finalLogoUrl.startsWith("data:")) {
    const m = finalLogoUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (m) {
      attachments.push({ filename: "logo.png", content: Buffer.from(m[2], "base64"), contentType: m[1], cid: "logo@machsan" });
      finalLogoUrl = "cid:logo@machsan";
    }
  }
  if (finalSoundLogoUrl.startsWith("data:")) {
    const m = finalSoundLogoUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (m) {
      attachments.push({ filename: "sound_logo.png", content: Buffer.from(m[2], "base64"), contentType: m[1], cid: "sound_logo@machsan" });
      finalSoundLogoUrl = "cid:sound_logo@machsan";
    }
  }

  try {
    await transporter.sendMail({
      from:    `"מכללת קמרה אובסקורה וסאונד" <${GMAIL_USER}>`,
      to,
      subject: subjects[type] || "עדכון מהמחסן",
      attachments,
      html:    buildEmail({
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
        production_reason,
        crew_photographer,
        crew_sound,
        approve_url,
        calendar_url,
        portal_url,
        report_note,
        reservation_id,
        custom_message,
        teacher_message,
        lesson_message,
        lesson_kit_name,
        logo_url:       finalLogoUrl,
        sound_logo_url: finalSoundLogoUrl,
      }),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Email error:", err);
    res.status(500).json({ error: err.message });
  }
}
