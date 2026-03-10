export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { to, student_name, items_list, borrow_date, return_date, wa_link } = req.body;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.VITE_RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "onboarding@resend.dev",
        to: to,
        subject: "✅ בקשת ההשאלה שלך התקבלה — המחסן של קישקתא ונמרוד",
        html: `
          <div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:auto;direction:rtl;text-align:right">
            <div style="background:#1a1a2e;padding:28px;text-align:center;border-radius:12px 12px 0 0">
              <h1 style="color:#f5a623;margin:0">🎬 המחסן של קישקתא ונמרוד</h1>
            </div>
            <div style="background:#fff;padding:28px;border:1px solid #eee">
              <h2>שלום ${student_name} 👋</h2>
              <div style="background:#eaffea;border-right:4px solid #2ecc71;padding:14px;border-radius:8px;margin-bottom:20px">
                <strong style="color:#27ae60">✅ בקשתך התקבלה בהצלחה!</strong><br/>
                <span style="color:#555">צוות המכללה יעבור עליה לאישורה הסופי.</span>
              </div>
              <p><strong>ציוד שהוזמן:</strong></p>
              <ul>${items_list}</ul>
              <p>📅 תאריך השאלה: <strong>${borrow_date}</strong></p>
              <p>📅 תאריך החזרה: <strong>${return_date}</strong></p>
              <div style="background:#f0fff4;border:1px solid #b7ebc8;border-radius:10px;padding:18px;margin-top:24px;text-align:center">
                <p style="font-weight:bold">📲 שלח ווצאפ לנמרוד גרא:</p>
                <p style="font-style:italic;color:#555">"שלום נמרוד הגשתי בקשה להשאלה ממתין לאישורך תודה"</p>
                <a href="${wa_link}" style="background:#25d366;color:#fff;text-decoration:none;padding:12px 28px;border-radius:25px;font-weight:bold;display:inline-block">
                  💬 שלח ווצאפ עכשיו
                </a>
              </div>
            </div>
          </div>`,
      }),
    });

    const data = await response.json();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}