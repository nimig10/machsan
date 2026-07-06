// staff-schedule.js — manage staff schedule preferences & assignments
import { requireStaff } from "./_auth-helper.js";

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
  if (!res.ok) {
    console.error(`[staff-schedule] sbFetch FAILED: ${options.method||"GET"} ${path} → ${res.status}`, text?.slice(0, 500));
  }
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

// Today's date (YYYY-MM-DD) in Israel timezone — authoritative "today" for the
// Staff Hub "משימות להיום" panel. Mirrors todayInIsrael() in production-deadline-reminder.js.
function todayInIsrael() {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" }).slice(0, 10);
}

const MAX_PERSONAL_TASK_LEN = 150;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const staff = await requireStaff(req, res);
  if (!staff) return;
  const { staffId: callerStaffId, role: callerRole } = staff;

  const { action } = req.body || {};

  // LIST-WEEK — fetch preferences and assignments for a date range
  if (action === "list-week") {
    const { startDate, endDate } = req.body;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: "Missing startDate or endDate" });
    }
    const dateFilter = `date=gte.${encodeURIComponent(startDate)}&date=lte.${encodeURIComponent(endDate)}`;
    const [prefResult, assignResult, taskResult] = await Promise.all([
      sbFetch(`staff_schedule_preferences?${dateFilter}&order=date.asc`),
      sbFetch(`staff_schedule_assignments?${dateFilter}&order=date.asc`),
      sbFetch(`staff_daily_tasks?${dateFilter}&order=date.asc`),
    ]);
    if (!prefResult.ok || !assignResult.ok) {
      return res.status(500).json({ error: "Failed to fetch schedule data" });
    }
    return res.status(200).json({
      preferences: prefResult.data || [],
      assignments: assignResult.data || [],
      dailyTasks: taskResult.ok ? (taskResult.data || []) : [],
    });
  }

  // MY-TODAY — everything the Staff Hub "משימות להיום" panel needs for the CALLER,
  // scoped server-side to (caller, today-in-Israel). One round trip, 4 parallel reads.
  if (action === "my-today") {
    const today = todayInIsrael();
    const sid = encodeURIComponent(callerStaffId);
    const d = encodeURIComponent(today);
    const [tasksR, prefR, assignR, personalR, loanR, checkR] = await Promise.all([
      sbFetch(`staff_daily_tasks?staff_id=eq.${sid}&date=eq.${d}&select=task_key`),
      sbFetch(`staff_schedule_preferences?staff_id=eq.${sid}&date=eq.${d}&select=note`),
      sbFetch(`staff_schedule_assignments?staff_id=eq.${sid}&date=eq.${d}&select=note`),
      sbFetch(`staff_personal_tasks?staff_id=eq.${sid}&date=eq.${d}&select=id,text,done&order=created_at.asc`),
      // Equipment-loan requests this staff member handles (out=pickup / return),
      // embedding the reservation. Filtered to today by kind below.
      sbFetch(`reservation_staff_assignments?staff_id=eq.${sid}&select=id,kind,reservation_id,done,reservations_new(student_name,borrow_date,borrow_time,return_date,return_time,loan_type)`),
      // Check-off state for items on other tables (daily tasks + manager/own notes).
      sbFetch(`staff_hub_checkoffs?staff_id=eq.${sid}&date=eq.${d}&select=item_type,item_ref`),
    ]);
    const pref = prefR.ok && Array.isArray(prefR.data) ? prefR.data[0] : null;
    const assign = assignR.ok && Array.isArray(assignR.data) ? assignR.data[0] : null;
    const checkSet = new Set((checkR.ok ? (checkR.data || []) : []).map(c => `${c.item_type}:${c.item_ref}`));
    // out → the pickup happens today (borrow_date); return → today (return_date).
    const loanHandling = (loanR.ok ? (loanR.data || []) : [])
      .map(a => {
        const r = a.reservations_new;
        if (!r) return null;
        const isOut = a.kind === "out";
        const date = isOut ? r.borrow_date : r.return_date;
        if (date !== today) return null;
        return {
          assignmentId: a.id,
          reservationId: a.reservation_id,
          kind: a.kind, // "out" | "return"
          done: !!a.done,
          studentName: r.student_name || "",
          loanType: r.loan_type || "",
          time: isOut ? (r.borrow_time || "") : (r.return_time || ""),
        };
      })
      .filter(Boolean)
      .sort((x, y) => String(x.time).localeCompare(String(y.time)));
    return res.status(200).json({
      date: today,
      dailyTasks: tasksR.ok ? (tasksR.data || []).map(r => ({ key: r.task_key, done: checkSet.has(`daily:${r.task_key}`) })) : [], // [{key,done}]
      managerNote: assign?.note ? { text: assign.note, done: checkSet.has("manager_note:note") } : null,   // manager -> this staff
      myNote: pref?.note ? { text: pref.note, done: checkSet.has("my_note:note") } : null,   // caller's own note
      personalTasks: personalR.ok ? (personalR.data || []) : [], // [{id,text,done}]
      loanHandling,                        // [{reservationId,kind,studentName,loanType,time}]
    });
  }

  // UPSERT-PREFERENCE — create or update a preference
  if (action === "upsert-preference") {
    const { staffId, date, shiftType, startTime, endTime, note, notePublic } = req.body;
    if (!staffId || !date || !shiftType) {
      return res.status(400).json({ error: "Missing required fields (staffId, date, shiftType)" });
    }
    // Ownership check — non-admins can only edit their own preferences. Mirrors
    // the check in delete-preference below; the absence of this check here let
    // any authenticated staff member overwrite another staff member's row by
    // submitting a different staffId in the body.
    if (callerRole !== "admin" && staffId !== callerStaffId) {
      return res.status(403).json({ error: "Not authorized to edit another staff member's preference" });
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
    if (callerRole !== "admin" && existing.data[0].staff_id !== callerStaffId) {
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
    const { staffId, date, shiftType, startTime, endTime, note, notePublic, locked, source } = req.body;
    const assignedBy = callerStaffId;
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

  // CLAIM-DAILY-TASK — assign a daily task to a staff member
  if (action === "claim-daily-task") {
    const { staffId, date, taskKey } = req.body;
    if (!staffId || !date || !taskKey) {
      return res.status(400).json({ error: "Missing required fields (staffId, date, taskKey)" });
    }
    if (!["open", "close", "prep"].includes(taskKey)) {
      return res.status(400).json({ error: "Invalid taskKey" });
    }
    // Check if already claimed by someone else
    const existing = await sbFetch(
      `staff_daily_tasks?date=eq.${encodeURIComponent(date)}&task_key=eq.${encodeURIComponent(taskKey)}&select=id,staff_id,locked`
    );
    if (existing.ok && Array.isArray(existing.data) && existing.data.length > 0) {
      const task = existing.data[0];
      if (task.staff_id === staffId) {
        // Already claimed by this staff — no-op success
        return res.status(200).json({ ok: true, data: task });
      }
      if (callerRole !== "admin") {
        return res.status(409).json({ error: "המשימה כבר תפוסה על ידי עובד אחר" });
      }
      // Admin override — falls through to upsert below
    }
    const result = await sbFetch("staff_daily_tasks?on_conflict=date,task_key", {
      method: "POST",
      headers: {
        ...headers,
        Prefer: "return=representation,resolution=merge-duplicates",
      },
      body: JSON.stringify({
        date,
        task_key: taskKey,
        staff_id: staffId,
        assigned_by: callerStaffId || null,
        locked: false,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!result.ok) {
      return res.status(500).json({ error: "Failed to claim task", detail: result.data });
    }
    return res.status(200).json({ ok: true, data: result.data?.[0] || null });
  }

  // UNCLAIM-DAILY-TASK — remove a daily task assignment
  if (action === "unclaim-daily-task") {
    const { staffId, date, taskKey } = req.body;
    if (!staffId || !date || !taskKey) {
      return res.status(400).json({ error: "Missing required fields (staffId, date, taskKey)" });
    }
    const existing = await sbFetch(
      `staff_daily_tasks?date=eq.${encodeURIComponent(date)}&task_key=eq.${encodeURIComponent(taskKey)}&select=id,staff_id,locked`
    );
    if (!existing.ok || !Array.isArray(existing.data) || existing.data.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }
    const task = existing.data[0];
    if (callerRole !== "admin" && task.staff_id !== callerStaffId) {
      return res.status(403).json({ error: "לא ניתן לבטל משימה של עובד אחר" });
    }
    if (task.locked && callerRole !== "admin") {
      return res.status(409).json({ error: "המשימה נעולה — פנה למנהל" });
    }
    const result = await sbFetch(
      `staff_daily_tasks?date=eq.${encodeURIComponent(date)}&task_key=eq.${encodeURIComponent(taskKey)}`,
      { method: "DELETE" }
    );
    return res.status(result.ok ? 200 : 500).json({ ok: result.ok });
  }

  // ── Personal to-do tasks (Staff Hub "משימות להיום" panel) ──

  // ADD-PERSONAL-TASK — caller adds a free-text to-do for today (Israel tz).
  if (action === "add-personal-task") {
    const raw = typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (!raw) return res.status(400).json({ error: "Missing text" });
    if (raw.length > MAX_PERSONAL_TASK_LEN) {
      return res.status(400).json({ error: `Task too long (max ${MAX_PERSONAL_TASK_LEN} chars)` });
    }
    const result = await sbFetch("staff_personal_tasks", {
      method: "POST",
      body: JSON.stringify({
        staff_id: callerStaffId,
        date: todayInIsrael(),
        text: raw,
        done: false,
        created_by: callerStaffId,
      }),
    });
    if (!result.ok) {
      return res.status(500).json({ error: "Failed to add task", detail: result.data });
    }
    return res.status(200).json({ ok: true, data: result.data?.[0] || null });
  }

  // TOGGLE-PERSONAL-TASK — set done true/false (owner or admin).
  if (action === "toggle-personal-task") {
    const { id, done } = req.body;
    if (!id || typeof done !== "boolean") {
      return res.status(400).json({ error: "Missing id or done" });
    }
    const existing = await sbFetch(`staff_personal_tasks?id=eq.${encodeURIComponent(id)}&select=id,staff_id`);
    if (!existing.ok || !Array.isArray(existing.data) || existing.data.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }
    if (callerRole !== "admin" && existing.data[0].staff_id !== callerStaffId) {
      return res.status(403).json({ error: "Not authorized to edit this task" });
    }
    const result = await sbFetch(`staff_personal_tasks?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ done }), // updated_at auto-touched by trigger
    });
    return res.status(result.ok ? 200 : 500).json({ ok: result.ok, data: result.data?.[0] || null });
  }

  // DELETE-PERSONAL-TASK — remove a personal task (owner or admin).
  if (action === "delete-personal-task") {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "Missing id" });
    const existing = await sbFetch(`staff_personal_tasks?id=eq.${encodeURIComponent(id)}&select=id,staff_id`);
    if (!existing.ok || !Array.isArray(existing.data) || existing.data.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }
    if (callerRole !== "admin" && existing.data[0].staff_id !== callerStaffId) {
      return res.status(403).json({ error: "Not authorized to delete this task" });
    }
    const result = await sbFetch(`staff_personal_tasks?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
    return res.status(result.ok ? 200 : 500).json({ ok: result.ok });
  }

  // TOGGLE-LOAN-HANDLED — personal tracking checkbox on a loan-handling assignment
  // (owner = the assigned handler, or admin). Display-only: the `done` flag never
  // participates in any loan/reservation logic.
  if (action === "toggle-loan-handled") {
    const { id, done } = req.body;
    if (!id || typeof done !== "boolean") {
      return res.status(400).json({ error: "Missing id or done" });
    }
    const existing = await sbFetch(`reservation_staff_assignments?id=eq.${encodeURIComponent(id)}&select=id,staff_id`);
    if (!existing.ok || !Array.isArray(existing.data) || existing.data.length === 0) {
      return res.status(404).json({ error: "Assignment not found" });
    }
    if (callerRole !== "admin" && existing.data[0].staff_id !== callerStaffId) {
      return res.status(403).json({ error: "Not authorized to edit this assignment" });
    }
    const result = await sbFetch(`reservation_staff_assignments?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ done }),
    });
    return res.status(result.ok ? 200 : 500).json({ ok: result.ok });
  }

  // SET-CHECKOFF — mark/unmark a daily task or a manager/own note as done for the
  // caller today (presence-based). done=true → upsert a row; done=false → delete it.
  if (action === "set-checkoff") {
    const { itemType, itemRef, done } = req.body;
    if (!["daily", "manager_note", "my_note"].includes(itemType) || !itemRef || typeof done !== "boolean") {
      return res.status(400).json({ error: "Missing/invalid itemType, itemRef or done" });
    }
    const today = todayInIsrael();
    if (done) {
      const result = await sbFetch("staff_hub_checkoffs?on_conflict=staff_id,date,item_type,item_ref", {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation,resolution=merge-duplicates" },
        body: JSON.stringify({ staff_id: callerStaffId, date: today, item_type: itemType, item_ref: String(itemRef) }),
      });
      return res.status(result.ok ? 200 : 500).json({ ok: result.ok });
    }
    const result = await sbFetch(
      `staff_hub_checkoffs?staff_id=eq.${encodeURIComponent(callerStaffId)}&date=eq.${encodeURIComponent(today)}&item_type=eq.${encodeURIComponent(itemType)}&item_ref=eq.${encodeURIComponent(String(itemRef))}`,
      { method: "DELETE" }
    );
    return res.status(result.ok ? 200 : 500).json({ ok: result.ok });
  }

  // ── Loan-request staff coordination (decoupled side-table) ──
  // Associate a team member with a loan request's OUT/RETURN handling.
  // Display/coordination only — never affects loan logic.

  // ASSIGN-LOAN-HANDLER — set the worker for a (reservation, kind) slot
  if (action === "assign-loan-handler") {
    const { reservationId, kind, staffId, staffName } = req.body;
    if (!reservationId || !kind || !staffId) {
      return res.status(400).json({ error: "Missing required fields (reservationId, kind, staffId)" });
    }
    if (!["out", "return"].includes(kind)) {
      return res.status(400).json({ error: "Invalid kind" });
    }
    // Non-admin (staff) may only commit themselves to a slot.
    if (callerRole !== "admin" && String(staffId) !== String(callerStaffId)) {
      return res.status(403).json({ error: "ניתן להתחייב רק לעצמך" });
    }
    const result = await sbFetch("reservation_staff_assignments?on_conflict=reservation_id,kind", {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation,resolution=merge-duplicates" },
      body: JSON.stringify({
        reservation_id: reservationId,
        kind,
        staff_id: staffId,
        staff_name: staffName || null,
        assigned_by: callerStaffId || null,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!result.ok) {
      return res.status(500).json({ error: "Failed to assign handler", detail: result.data });
    }
    return res.status(200).json({ ok: true, data: result.data?.[0] || null });
  }

  // UNASSIGN-LOAN-HANDLER — clear the worker for a (reservation, kind) slot
  if (action === "unassign-loan-handler") {
    const { reservationId, kind } = req.body;
    if (!reservationId || !kind) {
      return res.status(400).json({ error: "Missing required fields (reservationId, kind)" });
    }
    const existing = await sbFetch(
      `reservation_staff_assignments?reservation_id=eq.${encodeURIComponent(reservationId)}&kind=eq.${encodeURIComponent(kind)}&select=id,staff_id`
    );
    if (!existing.ok || !Array.isArray(existing.data) || existing.data.length === 0) {
      return res.status(200).json({ ok: true }); // already clear — idempotent
    }
    // Non-admin (staff) may only release their own commitment.
    if (callerRole !== "admin" && String(existing.data[0].staff_id) !== String(callerStaffId)) {
      return res.status(403).json({ error: "לא ניתן לבטל שיוך של עובד אחר" });
    }
    const result = await sbFetch(
      `reservation_staff_assignments?reservation_id=eq.${encodeURIComponent(reservationId)}&kind=eq.${encodeURIComponent(kind)}`,
      { method: "DELETE" }
    );
    return res.status(result.ok ? 200 : 500).json({ ok: result.ok });
  }

  // PURGE-OLD — delete preferences & assignments older than a given date (admin only)
  if (action === "purge-old") {
    if (callerRole !== "admin") return res.status(403).json({ error: "Admin only" });
    const { beforeDate } = req.body;
    if (!beforeDate) return res.status(400).json({ error: "Missing beforeDate" });
    const filter = `date=lt.${encodeURIComponent(beforeDate)}`;
    const [pr, ar, tr] = await Promise.all([
      sbFetch(`staff_schedule_preferences?${filter}`, { method: "DELETE" }),
      sbFetch(`staff_schedule_assignments?${filter}`, { method: "DELETE" }),
      sbFetch(`staff_daily_tasks?${filter}`, { method: "DELETE" }),
    ]);
    return res.status(pr.ok && ar.ok ? 200 : 500).json({ ok: pr.ok && ar.ok });
  }

  return res.status(400).json({ error: "Unknown action" });
}
