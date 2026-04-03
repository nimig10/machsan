// equipment-report.js — submit + manage equipment reports
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { headers, ...options });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action } = req.body || {};

  // CREATE — student submits a report
  if (action === "create") {
    const { equipment_id, student_name, reservation_id, content } = req.body;
    if (!equipment_id || !student_name || !reservation_id || !content) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (content.length > 400) {
      return res.status(400).json({ error: "Content too long (max 400 chars)" });
    }
    const result = await sbFetch("equipment_reports", {
      method: "POST",
      body: JSON.stringify({ equipment_id, student_name, reservation_id, content }),
    });
    if (!result.ok) {
      // unique constraint conflict
      if (result.status === 409) return res.status(409).json({ error: "duplicate" });
      return res.status(500).json({ error: "Failed to create report" });
    }
    return res.status(201).json({ ok: true, id: result.data?.[0]?.id || null });
  }

  // CHECK-DUPLICATE — student checks if report already exists
  if (action === "check-duplicate") {
    const { equipment_id, reservation_id } = req.body;
    if (!equipment_id || !reservation_id) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const result = await sbFetch(
      `equipment_reports?select=id&equipment_id=eq.${encodeURIComponent(equipment_id)}&reservation_id=eq.${encodeURIComponent(reservation_id)}`
    );
    const exists = Array.isArray(result.data) && result.data.length > 0;
    return res.status(200).json({ exists });
  }

  // LIST — staff fetches reports
  if (action === "list") {
    const { equipment_id } = req.body;
    let query = "equipment_reports?order=created_at.desc";
    if (equipment_id) query += `&equipment_id=eq.${encodeURIComponent(equipment_id)}`;
    const result = await sbFetch(query);
    return res.status(result.ok ? 200 : 500).json(result.data || []);
  }

  // LIST-OPEN-COUNTS — staff fetches open report counts per equipment
  if (action === "list-open-counts") {
    const result = await sbFetch(
      "equipment_reports?select=equipment_id&status=eq.open"
    );
    if (!result.ok) return res.status(500).json({ error: "Failed to fetch counts" });
    const counts = {};
    (result.data || []).forEach(r => {
      counts[r.equipment_id] = (counts[r.equipment_id] || 0) + 1;
    });
    const arr = Object.entries(counts).map(([equipment_id, count]) => ({ equipment_id, count }));
    return res.status(200).json(arr);
  }

  // LIST-BY-RESERVATIONS — staff fetches reports by reservation IDs
  if (action === "list-by-reservations") {
    const { reservation_ids } = req.body;
    if (!Array.isArray(reservation_ids) || reservation_ids.length === 0) {
      return res.status(400).json({ error: "Missing reservation_ids array" });
    }
    const ids = reservation_ids.map(id => encodeURIComponent(id)).join(",");
    const result = await sbFetch(
      `equipment_reports?reservation_id=in.(${ids})&order=created_at.desc`
    );
    return res.status(result.ok ? 200 : 500).json(result.data || []);
  }

  // MARK-HANDLED — staff marks a report as handled
  if (action === "mark-handled") {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "Missing id" });
    const result = await sbFetch(
      `equipment_reports?id=eq.${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ status: "handled" }) }
    );
    return res.status(result.ok ? 200 : 500).json({ ok: result.ok });
  }

  return res.status(400).json({ error: "Unknown action" });
}
