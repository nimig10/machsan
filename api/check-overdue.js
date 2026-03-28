// Vercel Cron Job — runs server-side every hour
// Checks for overdue reservations and sends reminder emails
// No browser required

const SB_URL = "https://wxkyqgwwraojnbmyyfco.supabase.co";
const SB_KEY = "sb_publishable_n-mkSq7xABjj58ZBBwk6BA_RbpVS2SU";
const SB_HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}

function toDateTime(dateStr, timeStr) {
  const d = parseLocalDate(dateStr);
  if (!d) return 0;
  const [h, m] = String(timeStr || "00:00").split(":").map(Number);
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return d.getTime();
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return `${(d || 1).toString().padStart(2, "0")}/${(m || 1).toString().padStart(2, "0")}/${y}`;
}

export default async function handler(req, res) {
  // Vercel automatically passes Authorization: Bearer <CRON_SECRET> for cron jobs
  const authHeader = req.headers["authorization"];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // 1. Fetch reservations from Supabase
    const supaRes = await fetch(
      `${SB_URL}/rest/v1/store?key=eq.reservations&select=data`,
      { headers: SB_HEADERS }
    );
    if (!supaRes.ok) throw new Error(`Supabase fetch failed: ${supaRes.status}`);
    const supaJson = await supaRes.json();
    const reservations =
      Array.isArray(supaJson) && supaJson.length > 0 ? supaJson[0].data : [];

    if (!Array.isArray(reservations) || !reservations.length) {
      return res.status(200).json({ sent: 0, message: "no reservations" });
    }

    // 2. Find overdue ones that need emails (30+ minutes past return time)
    const now = Date.now();
    const THIRTY_MIN = 30 * 60 * 1000;
    const toSend = reservations.filter(
      (r) =>
        r.status === "באיחור" &&
        !r.overdue_email_sent &&
        r.email &&
        r.loan_type !== "שיעור" &&
        r.return_date &&
        now - toDateTime(r.return_date, r.return_time || "23:59") >= THIRTY_MIN
    );

    if (!toSend.length) {
      return res.status(200).json({ sent: 0, message: "nothing to send" });
    }

    // 3. Send emails via the existing /api/send-email endpoint
    const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    let sentCount = 0;
    for (const r of toSend) {
      try {
        await fetch(`${baseUrl}/api/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: r.email,
            type: "overdue",
            student_name: r.student_name,
            borrow_date: formatDate(r.borrow_date),
            return_date: formatDate(r.return_date),
            return_time: r.return_time || "",
          }),
        });
        sentCount++;
      } catch (e) {
        console.error("overdue email error for", r.id, e.message);
      }
    }

    // 4. Mark as sent in Supabase
    const sentIds = new Set(toSend.map((r) => r.id));
    const updated = reservations.map((r) =>
      sentIds.has(r.id) ? { ...r, overdue_email_sent: true } : r
    );
    await fetch(`${SB_URL}/rest/v1/store`, {
      method: "POST",
      headers: { ...SB_HEADERS, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key: "reservations", data: updated }),
    });

    console.log(`check-overdue: sent ${sentCount} emails`);
    return res.status(200).json({ sent: sentCount });
  } catch (e) {
    console.error("check-overdue error:", e.message);
    return res.status(500).json({ error: e.message });
  }
}
