// notify-staff.js — send team_notify emails to staff_members with matching notifyLoanTypes
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { loan_type, student_name, items_list, borrow_date, return_date, logo_url, sound_logo_url } = req.body || {};
  if (!loan_type) return res.status(400).json({ error: "Missing loan_type" });

  // Fetch all staff members with their permissions
  const sbRes = await fetch(
    `${SB_URL}/rest/v1/staff_members?select=email,full_name,permissions`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
  if (!sbRes.ok) return res.status(500).json({ error: "Failed to fetch staff members" });

  const members = await sbRes.json();

  // Filter: only those with a non-empty notifyLoanTypes that includes this loan_type
  const toNotify = (members || []).filter(m => {
    const types = m?.permissions?.notifyLoanTypes;
    return Array.isArray(types) && types.length > 0 && types.includes(loan_type);
  });

  if (toNotify.length === 0) return res.status(200).json({ sent: 0 });

  const origin = req.headers.origin || req.headers.host || "";
  const baseUrl = origin.startsWith("http") ? origin : `https://${origin}`;

  const results = await Promise.allSettled(
    toNotify.map(m =>
      fetch(`${baseUrl}/api/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: m.email,
          type: "team_notify",
          recipient_name: m.full_name,
          student_name,
          items_list,
          borrow_date,
          return_date,
          loan_type,
          logo_url: logo_url || "",
          sound_logo_url: sound_logo_url || "",
        }),
      })
    )
  );

  const sent = results.filter(r => r.status === "fulfilled").length;
  return res.status(200).json({ sent, total: toNotify.length });
}
