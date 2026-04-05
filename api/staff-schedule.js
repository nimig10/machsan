// staff-schedule.js — manage staff schedule preferences & assignments
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

const VALID_SHIFT_TYPES = ["morning", "evening", "custom", "absent"];

function validateShiftType(shiftType, startTime, endTime) {
  if (!VALID_SHIFT_TYPES.includes(shiftType)) {
    return "Invalid shiftType. Must be morning, evening, custom, or absent";
  }
  if (shiftType === "custom") {
    if (!startTime || !endTime) return "startTime and endTime required for custom shift";
    if (startTime >= endTime) return "startTime must be before endTime";
  }
  return null;
}

function normalizeShiftTimes(shiftType, startTime, endTime) {
  if (shiftType === "custom") return { start_time: startTime, end_time: endTime };
  return { start_time: null, end_time: null };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, callerRole, callerId } = req.body || {};

  // LIST-WEEK — fetch preferences and assignments for a date range
  if (action === "list-week") {
    const { startDate, endDate } = req.body;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: "Missing startDate or endDate" });
    }
    const dateFilter = `date=gte.${encodeURIComponent(startDate)}&date=lte.${encodeURIComponent(endDate)}`;
    const [prefResult, assignResult] = await Promise.all([
      sbFetch(`staff_schedule_preferences?${dateFilter}&order=date.asc`),
      sbFetch(`staff_schedule_assignments?${dateFilter}&order=date.asc`),
    ]);
    if (!prefResult.ok || !assignResult.ok) {
      return res.status(500).json({ error: "Failed to fetch schedule data" });
    }
    return res.status(200).json({
      preferences: prefResult.data || [],
      assignments: assignResult.data || [],
    });
  }

  // UPSERT-PREFERENCE — create or update a preference
  if (action === "upsert-preference") {
    const { staffId, date, shiftType, startTime, endTime, note, notePublic } = req.body;
    if (!staffId || !date || !shiftType) {
      return res.status(400).json({ error: "Missing required fields (staffId, date, shiftType)" });
    }
    const shiftErr = validateShiftType(shiftType, startTime, endTime);
    if (shiftErr) return res.status(400).json({ error: shiftErr });
    if (note && note.length > 250) {
      return res.status(400).json({ error: "Note too long (max 250 chars)" });
    }
    // Date-in-past check (admins exempt)
    if (callerRole !== "admin") {
      const now = new Date(); const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
      if (date < today) {
        return res.status(400).json({ error: "Cannot set preference for a past date" });
      }
    }
    // Check for locked assignment
    const lockCheck = await sbFetch(
      `staff_schedule_assignments?select=id,locked&staff_id=eq.${encodeURIComponent(staffId)}&date=eq.${encodeURIComponent(date)}&locked=eq.true`
    );
    if (lockCheck.ok && Array.isArray(lockCheck.data) && lockCheck.data.length > 0) {
      return res.status(409).json({ error: "Assignment is locked for this date" });
    }
    const times = normalizeShiftTimes(shiftType, startTime, endTime);
    const result = await sbFetch("staff_schedule_preferences?on_conflict=staff_id,date", {
      method: "POST",
      headers: {
        ...headers,
        Prefer: "return=representation,resolution=merge-duplicates",
      },
      body: JSON.stringify({
        staff_id: staffId,
        date,
        shift_type: shiftType,
        start_time: times.start_time,
        end_time: times.end_time,
        note: note || null,
        note_public: notePublic ?? true,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!result.ok) {
      return res.status(500).json({ error: "Failed to upsert preference", detail: result.data });
    }
    return res.status(200).json({ ok: true, data: result.data?.[0] || null });
  }

  // DELETE-PREFERENCE — delete a preference (owner or admin)
  if (action === "delete-preference") {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "Missing id" });
    // Fetch preference to verify ownership
    const existing = await sbFetch(`staff_schedule_preferences?id=eq.${encodeURIComponent(id)}&select=id,staff_id`);
    if (!existing.ok || !Array.isArray(existing.data) || existing.data.length === 0) {
      return res.status(404).json({ error: "Preference not found" });
    }
    if (callerRole !== "admin" && existing.data[0].staff_id !== callerId) {
      return res.status(403).json({ error: "Not authorized to delete this preference" });
    }
    const result = await sbFetch(`staff_schedule_preferences?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return res.status(result.ok ? 200 : 500).json({ ok: result.ok });
  }

  // UPSERT-ASSIGNMENT — create or update an assignment (admin only)
  if (action === "upsert-assignment") {
    if (callerRole !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }
    const { staffId, date, shiftType, startTime, endTime, note, notePublic, locked, assignedBy, source } = req.body;
    if (!staffId || !date || !shiftType) {
      return res.status(400).json({ error: "Missing required fields (staffId, date, shiftType)" });
    }
    const shiftErr = validateShiftType(shiftType, startTime, endTime);
    if (shiftErr) return res.status(400).json({ error: shiftErr });
    const times = normalizeShiftTimes(shiftType, startTime, endTime);
    const result = await sbFetch("staff_schedule_assignments?on_conflict=staff_id,date", {
      method: "POST",
      headers: {
        ...headers,
        Prefer: "return=representation,resolution=merge-duplicates",
      },
      body: JSON.stringify({
        staff_id: staffId,
        date,
        shift_type: shiftType,
        start_time: times.start_time,
        end_time: times.end_time,
        note: note || null,
        note_public: notePublic || null,
        locked: locked || false,
        assigned_by: assignedBy || null,
        source: source || "manager",
        updated_at: new Date().toISOString(),
      }),
    });
    if (!result.ok) {
      return res.status(500).json({ error: "Failed to upsert assignment" });
    }
    return res.status(200).json({ ok: true, data: result.data?.[0] || null });
  }

  // DELETE-ASSIGNMENT — delete an assignment (admin only)
  if (action === "delete-assignment") {
    if (callerRole !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "Missing id" });
    const result = await sbFetch(`staff_schedule_assignments?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return res.status(result.ok ? 200 : 500).json({ ok: result.ok });
  }

  // LOCK — lock an assignment
  if (action === "lock") {
    if (callerRole !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }
    const { id, staffId, date } = req.body;
    let filter;
    if (id) {
      filter = `id=eq.${encodeURIComponent(id)}`;
    } else if (staffId && date) {
      filter = `staff_id=eq.${encodeURIComponent(staffId)}&date=eq.${encodeURIComponent(date)}`;
    } else {
      return res.status(400).json({ error: "Missing id or staffId+date" });
    }
    const result = await sbFetch(`staff_schedule_assignments?${filter}`, {
      method: "PATCH",
      body: JSON.stringify({ locked: true, updated_at: new Date().toISOString() }),
    });
    return res.status(result.ok ? 200 : 500).json({ ok: result.ok });
  }

  // UNLOCK — unlock an assignment
  if (action === "unlock") {
    if (callerRole !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }
    const { id, staffId, date } = req.body;
    let filter;
    if (id) {
      filter = `id=eq.${encodeURIComponent(id)}`;
    } else if (staffId && date) {
      filter = `staff_id=eq.${encodeURIComponent(staffId)}&date=eq.${encodeURIComponent(date)}`;
    } else {
      return res.status(400).json({ error: "Missing id or staffId+date" });
    }
    const result = await sbFetch(`staff_schedule_assignments?${filter}`, {
      method: "PATCH",
      body: JSON.stringify({ locked: false, updated_at: new Date().toISOString() }),
    });
    return res.status(result.ok ? 200 : 500).json({ ok: result.ok });
  }

  // PURGE-OLD — delete preferences & assignments older than a given date (admin only)
  if (action === "purge-old") {
    if (callerRole !== "admin") return res.status(403).json({ error: "Admin only" });
    const { beforeDate } = req.body;
    if (!beforeDate) return res.status(400).json({ error: "Missing beforeDate" });
    const filter = `date=lt.${encodeURIComponent(beforeDate)}`;
    const [pr, ar] = await Promise.all([
      sbFetch(`staff_schedule_preferences?${filter}`, { method: "DELETE" }),
      sbFetch(`staff_schedule_assignments?${filter}`, { method: "DELETE" }),
    ]);
    return res.status(pr.ok && ar.ok ? 200 : 500).json({ ok: pr.ok && ar.ok });
  }

  return res.status(400).json({ error: "Unknown action" });
}
