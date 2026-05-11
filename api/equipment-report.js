// equipment-report.js — submit + manage equipment reports
import { requireStaff, requireUser } from "./_auth-helper.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const STAFF_ACTIONS = new Set(["list", "list-open-counts", "list-by-reservations", "mark-handled"]);

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

  if (STAFF_ACTIONS.has(action)) {
    const staff = await requireStaff(req, res);
    if (!staff) return;
  }

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

  // LIST-MINE — student fetches their own reports for active reservations.
  // Auth required: the caller must own (by email) every reservation_id passed in.
  if (action === "list-mine") {
    const user = await requireUser(req, res);
    if (!user) return;
    const { reservation_ids } = req.body || {};
    if (!Array.isArray(reservation_ids) || reservation_ids.length === 0) {
      return res.status(200).json([]);
    }
    const ids = reservation_ids.map(id => encodeURIComponent(id)).join(",");
    const owned = await sbFetch(
      `reservations_new?id=in.(${ids})&email=ilike.${encodeURIComponent(user.email)}&select=id`
    );
    const ownedIds = (owned.data || []).map(r => r.id);
    if (ownedIds.length === 0) return res.status(200).json([]);
    const ownedEnc = ownedIds.map(id => encodeURIComponent(id)).join(",");
    const result = await sbFetch(
      `equipment_reports?reservation_id=in.(${ownedEnc})&order=created_at.desc`
    );
    return res.status(200).json(result.data || []);
  }

  // UPDATE — student edits the content of their own report.
  // Auth required. Reservation must belong to caller AND be status='פעילה'.
  // We deliberately don't touch the report's status — that stays the warehouse's call.
  if (action === "update") {
    const user = await requireUser(req, res);
    if (!user) return;
    const { id, content } = req.body || {};
    if (!id || !content || !String(content).trim()) {
      return res.status(400).json({ error: "Missing fields" });
    }
    if (String(content).length > 400) {
      return res.status(400).json({ error: "Content too long (max 400 chars)" });
    }
    const r = await sbFetch(
      `equipment_reports?id=eq.${encodeURIComponent(id)}&select=reservation_id`
    );
    if (!r.ok || !Array.isArray(r.data) || !r.data[0]) {
      return res.status(404).json({ error: "not_found" });
    }
    const reservationId = r.data[0].reservation_id;
    const own = await sbFetch(
      `reservations_new?id=eq.${encodeURIComponent(reservationId)}&select=email,status`
    );
    if (!own.ok || !Array.isArray(own.data) || !own.data[0]) {
      return res.status(404).json({ error: "reservation_not_found" });
    }
    const owner = own.data[0];
    if (String(owner.email || "").toLowerCase() !== user.email.toLowerCase()) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (owner.status !== "פעילה") {
      return res.status(409).json({ error: "reservation_not_active" });
    }
    const upd = await sbFetch(
      `equipment_reports?id=eq.${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ content: String(content).trim() }) }
    );
    return res.status(upd.ok ? 200 : 500).json({ ok: upd.ok });
  }

  return res.status(400).json({ error: "Unknown action" });
}
