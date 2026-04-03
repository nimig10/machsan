// StaffSchedulePage.jsx — Staff weekly schedule: preferences & assignments
import { useState, useEffect, useMemo, useCallback } from "react";
import { Modal } from "./ui.jsx";

// ── Shift constants ──
const SHIFT_TYPES = {
  morning: { label: "בוקר", icon: "☀️", start: "09:00", end: "17:00", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  evening: { label: "ערב", icon: "🌙", start: "14:00", end: "22:00", color: "#8b5cf6", bg: "rgba(139,92,246,0.12)" },
  custom:  { label: "חופשי", icon: "🕐", start: null, end: null, color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  absent:  { label: "לא נוכח", icon: "🚫", start: null, end: null, color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
};

const HE_DAYS = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];

function formatDateHe(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function getWeekDates(offset = 0) {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const sun = new Date(now);
  sun.setDate(now.getDate() - day + offset * 7);
  sun.setHours(0, 0, 0, 0);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sun);
    d.setDate(sun.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Can a regular staff member edit preferences for a given date?
function canStaffEditDate(dateStr) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  const today = now.getDay(); // 0=Sun

  // Past or today — no
  if (target <= now) return false;

  // Find current week's Sunday and next week's Sunday
  const currentSun = new Date(now);
  currentSun.setDate(now.getDate() - today);
  const nextSun = new Date(currentSun);
  nextSun.setDate(currentSun.getDate() + 7);
  const weekAfterSun = new Date(currentSun);
  weekAfterSun.setDate(currentSun.getDate() + 14);

  // Current week — no (already in progress)
  if (target < nextSun) return false;

  // Next week — only if preference window is open (Sun–Wed)
  if (target < weekAfterSun) return today >= 0 && today <= 3;

  // 2+ weeks ahead — always open
  return true;
}

// Get preference window status text for display
function getPreferenceWindowStatus(weekDates) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const today = now.getDay();
  const currentSun = new Date(now);
  currentSun.setDate(now.getDate() - today);
  const nextSun = new Date(currentSun);
  nextSun.setDate(currentSun.getDate() + 7);
  const weekAfterSun = new Date(currentSun);
  weekAfterSun.setDate(currentSun.getDate() + 14);

  const weekStart = new Date(weekDates[0] + "T00:00:00");

  if (weekStart < nextSun) return { open: false, text: "שבוע נוכחי" };
  if (weekStart < weekAfterSun) {
    const windowOpen = today >= 0 && today <= 3;
    return { open: windowOpen, text: windowOpen ? "חלון ההעדפות פתוח (עד יום רביעי)" : "חלון ההעדפות נסגר לשבוע זה" };
  }
  return { open: true, text: "ניתן להגיש העדפות" };
}

// ── API helper ──
async function scheduleApi(action, body = {}) {
  const res = await fetch("/api/staff-schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  return res.json();
}

// ── Main component ──
export function StaffSchedulePage({ staffUser, showToast, teamMembers = [] }) {
  const isAdmin = staffUser?.role === "admin";
  const currentStaffId = staffUser?.id;

  const [weekOffset, setWeekOffset] = useState(0);
  const [preferences, setPreferences] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [holidays, setHolidays] = useState([]);
  const [editModal, setEditModal] = useState(null); // { staffId, date, mode: "preference"|"assignment", existing? }

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);
  const startDate = weekDates[0];
  const endDate = weekDates[6];

  // Load holidays dynamically
  useEffect(() => {
    import("../utils/jewishHolidays.js").then(mod => {
      if (mod.getHolidaysForDateRange) {
        setHolidays(mod.getHolidaysForDateRange(startDate, endDate));
      }
    }).catch(() => {});
  }, [startDate, endDate]);

  const fetchWeekData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await scheduleApi("list-week", { startDate, endDate });
      setPreferences(data.preferences || []);
      setAssignments(data.assignments || []);
    } catch { showToast("error", "שגיאה בטעינת לוז"); }
    setLoading(false);
  }, [startDate, endDate]);

  useEffect(() => { fetchWeekData(); }, [fetchWeekData]);

  // Check if preference window applies to displayed week
  const prefWindowStatus = getPreferenceWindowStatus(weekDates);

  // Get pref/assignment for a specific staff+date
  const getPref = (staffId, date) => preferences.find(p => p.staff_id === staffId && p.date === date);
  const getAssignment = (staffId, date) => assignments.find(a => a.staff_id === staffId && a.date === date);

  // Open edit modal
  const openEditor = (staffId, date, mode) => {
    const existing = mode === "preference" ? getPref(staffId, date) : getAssignment(staffId, date);
    setEditModal({ staffId, date, mode, existing: existing || null });
  };

  // Save preference
  const savePref = async (data) => {
    const result = await scheduleApi("upsert-preference", {
      staffId: data.staffId,
      date: data.date,
      shiftType: data.shiftType,
      startTime: data.startTime || null,
      endTime: data.endTime || null,
      note: data.note || "",
      notePublic: data.notePublic ?? true,
      callerRole: isAdmin ? "admin" : "staff",
      callerId: currentStaffId,
    });
    if (result.error) { showToast("error", result.error); return false; }
    showToast("success", "ההעדפה נשמרה");
    await fetchWeekData();
    return true;
  };

  // Save assignment
  const saveAssignment = async (data) => {
    const result = await scheduleApi("upsert-assignment", {
      staffId: data.staffId,
      date: data.date,
      shiftType: data.shiftType,
      startTime: data.startTime || null,
      endTime: data.endTime || null,
      note: data.note || "",
      notePublic: data.notePublic ?? true,
      locked: data.locked ?? false,
      assignedBy: currentStaffId,
      source: data.source || "manager",
      callerRole: "admin",
      callerId: currentStaffId,
    });
    if (result.error) { showToast("error", result.error); return false; }
    showToast("success", "השיבוץ נשמר");
    await fetchWeekData();
    return true;
  };

  // Delete preference
  const deletePref = async (id) => {
    const result = await scheduleApi("delete-preference", { id, callerRole: isAdmin ? "admin" : "staff", callerId: currentStaffId });
    if (result.error) { showToast("error", result.error); return; }
    showToast("success", "ההעדפה נמחקה");
    await fetchWeekData();
  };

  // Delete assignment
  const deleteAssignment = async (id) => {
    const result = await scheduleApi("delete-assignment", { id, callerRole: "admin" });
    if (result.error) { showToast("error", result.error); return; }
    showToast("success", "השיבוץ נמחק");
    await fetchWeekData();
  };

  // Toggle lock
  const toggleLock = async (assignmentId, currentLocked) => {
    const action = currentLocked ? "unlock" : "lock";
    const result = await scheduleApi(action, { id: assignmentId, callerRole: "admin" });
    if (result.error) { showToast("error", result.error); return; }
    await fetchWeekData();
  };

  // Determine max offset (1 month ahead)
  const maxWeekOffset = 4;
  const today = todayStr();

  return (
    <div className="page" style={{ padding: "20px 16px" }}>
      {/* ── Week Navigation ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn btn-secondary btn-sm" disabled={weekOffset <= -4} onClick={() => setWeekOffset(w => w - 1)}>→ שבוע קודם</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset(0)}>השבוע</button>
          <button className="btn btn-secondary btn-sm" disabled={weekOffset >= maxWeekOffset} onClick={() => setWeekOffset(w => w + 1)}>שבוע הבא ←</button>
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>
          📅 {formatDateHe(startDate)} – {formatDateHe(endDate)}
        </div>
        {/* Preference window indicator */}
        {!isAdmin && (
          <div style={{ fontSize: 12, padding: "4px 12px", borderRadius: 20, fontWeight: 700,
            background: prefWindowStatus.open ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
            color: prefWindowStatus.open ? "#22c55e" : "#ef4444",
            border: `1px solid ${prefWindowStatus.open ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
          }}>
            {prefWindowStatus.text}
          </div>
        )}
      </div>

      {/* ── Legend ── */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16, fontSize: 12, color: "var(--text3)" }}>
        {Object.entries(SHIFT_TYPES).map(([key, s]) => (
          <span key={key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 12, height: 12, borderRadius: 4, background: s.bg, border: `1px solid ${s.color}`, display: "inline-block" }} />
            {s.icon} {s.label}
          </span>
        ))}
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 12, height: 12, borderRadius: 4, background: "rgba(34,197,94,0.12)", border: "1px solid #22c55e", display: "inline-block" }} />
          העדפה
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 12, height: 12, borderRadius: 4, background: "rgba(59,130,246,0.15)", border: "1px solid #3b82f6", display: "inline-block" }} />
          שיבוץ
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>🔒 נעול</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>⭐ הערה</span>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text3)" }}>טוען...</div>
      ) : (
        /* ── Calendar Grid ── */
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800, tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 120, textAlign: "right" }}>עובד</th>
                {weekDates.map((date, i) => {
                  const holiday = holidays.find(h => h.date === date);
                  const isToday = date === today;
                  return (
                    <th key={date} style={{ ...thStyle, background: isToday ? "rgba(59,130,246,0.08)" : holiday ? "rgba(245,158,11,0.06)" : undefined }}>
                      <div style={{ fontWeight: 800, fontSize: 13 }}>{HE_DAYS[i]}</div>
                      <div style={{ fontSize: 11, color: "var(--text3)" }}>{formatDateHe(date)}</div>
                      {holiday && <div style={{ fontSize: 10, color: "#f59e0b", fontWeight: 700, marginTop: 2 }}>{holiday.isErev ? `ערב ${holiday.name}` : holiday.name}</div>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {teamMembers.map(member => (
                <tr key={member.id || member.name}>
                  <td style={{ ...tdStyle, fontWeight: 700, fontSize: 13, position: "sticky", right: 0, background: "var(--surface)", zIndex: 1 }}>
                    {member.name}
                  </td>
                  {weekDates.map(date => {
                    const pref = getPref(String(member.id), date);
                    const assignment = getAssignment(String(member.id), date);
                    const isPast = date < today;
                    const isMe = String(member.id) === String(currentStaffId);
                    const isLocked = assignment?.locked;
                    const canEdit = isAdmin || (isMe && !isLocked && canStaffEditDate(date));

                    return (
                      <td key={date} style={{ ...tdStyle, background: date === today ? "rgba(59,130,246,0.04)" : undefined, verticalAlign: "top", padding: "6px 4px" }}>
                        {/* Assignment */}
                        {assignment && (
                          <CellBadge
                            entry={assignment}
                            type="assignment"
                            isAdmin={isAdmin}
                            onClick={() => isAdmin && openEditor(String(member.id), date, "assignment")}
                            onLock={isAdmin ? () => toggleLock(assignment.id, assignment.locked) : null}
                            onDelete={isAdmin ? () => deleteAssignment(assignment.id) : null}
                            showPrivateNote={isAdmin}
                          />
                        )}
                        {/* Preference */}
                        {pref && (
                          <CellBadge
                            entry={pref}
                            type="preference"
                            isAdmin={isAdmin}
                            onClick={() => canEdit && openEditor(String(member.id), date, "preference")}
                            onDelete={canEdit ? () => deletePref(pref.id) : null}
                            showPrivateNote={isAdmin}
                          />
                        )}
                        {/* Add button */}
                        {!assignment && !pref && canEdit && (
                          <button
                            onClick={() => openEditor(String(member.id), date, isAdmin ? "assignment" : "preference")}
                            style={{ width: "100%", padding: "8px 4px", border: "1px dashed var(--border)", borderRadius: 8, background: "transparent", color: "var(--text3)", fontSize: 18, cursor: "pointer", transition: "all 0.15s" }}
                            title={isAdmin ? "שבץ עובד" : "הוסף העדפה"}
                          >+</button>
                        )}
                        {/* Staff can add preference even if assignment exists (but not locked) */}
                        {assignment && !pref && canEdit && !isAdmin && !isLocked && (
                          <button
                            onClick={() => openEditor(String(member.id), date, "preference")}
                            style={{ width: "100%", marginTop: 4, padding: "4px", border: "1px dashed var(--border)", borderRadius: 6, background: "transparent", color: "var(--text3)", fontSize: 10, cursor: "pointer" }}
                          >+ העדפה</button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Edit Modal ── */}
      {editModal && (
        <ScheduleEditorModal
          modal={editModal}
          isAdmin={isAdmin}
          teamMembers={teamMembers}
          onSave={editModal.mode === "preference" ? savePref : saveAssignment}
          onClose={() => setEditModal(null)}
        />
      )}
    </div>
  );
}

// ── Cell Badge Component ──
function CellBadge({ entry, type, isAdmin, onClick, onLock, onDelete, showPrivateNote }) {
  const shift = SHIFT_TYPES[entry.shift_type] || SHIFT_TYPES.custom;
  const isAssignment = type === "assignment";
  const borderColor = isAssignment ? "#3b82f6" : "#22c55e";
  const bgColor = isAssignment ? "rgba(59,130,246,0.1)" : "rgba(34,197,94,0.08)";
  const hasNote = entry.note && entry.note.trim().length > 0;
  const noteVisible = hasNote && (entry.note_public || showPrivateNote);

  const startTime = entry.shift_type === "morning" ? "09:00" : entry.shift_type === "evening" ? "14:00" : entry.start_time;
  const endTime = entry.shift_type === "morning" ? "17:00" : entry.shift_type === "evening" ? "22:00" : entry.end_time;

  return (
    <div
      onClick={onClick}
      style={{
        padding: "5px 7px",
        borderRadius: 8,
        border: `1px solid ${borderColor}40`,
        background: bgColor,
        marginBottom: 3,
        cursor: onClick ? "pointer" : "default",
        fontSize: 11,
        position: "relative",
        transition: "all 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 3, justifyContent: "space-between" }}>
        <span style={{ fontWeight: 700 }}>
          {shift.icon} {shift.label}
        </span>
        <span style={{ display: "flex", gap: 2, alignItems: "center" }}>
          {hasNote && <span title={noteVisible ? entry.note : "הערה פרטית"} style={{ cursor: "help" }}>⭐</span>}
          {entry.locked && <span title="נעול">🔒</span>}
          {isAssignment && <span style={{ fontSize: 9, color: "#3b82f6", fontWeight: 700 }}>שיבוץ</span>}
        </span>
      </div>
      {entry.shift_type !== "absent" && startTime && endTime && (
        <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>{startTime} – {endTime}</div>
      )}
      {noteVisible && (
        <div style={{ fontSize: 10, color: entry.note_public ? "var(--text3)" : "#ef4444", marginTop: 3, fontStyle: entry.note_public ? "normal" : "italic", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 100 }}>
          {!entry.note_public && "🔒 "}{entry.note}
        </div>
      )}
      {/* Inline action buttons */}
      {(onLock || onDelete) && (
        <div style={{ display: "flex", gap: 4, marginTop: 4, justifyContent: "flex-end" }}>
          {onLock && <button onClick={e => { e.stopPropagation(); onLock(); }} style={miniBtn} title={entry.locked ? "פתח נעילה" : "נעל"}>{entry.locked ? "🔓" : "🔒"}</button>}
          {onDelete && <button onClick={e => { e.stopPropagation(); onDelete(); }} style={{ ...miniBtn, color: "#ef4444" }} title="מחק">🗑️</button>}
        </div>
      )}
    </div>
  );
}

// ── Editor Modal ──
function ScheduleEditorModal({ modal, isAdmin, teamMembers, onSave, onClose }) {
  const { staffId, date, mode, existing } = modal;
  const memberName = teamMembers.find(m => String(m.id) === String(staffId))?.name || "";

  const [shiftType, setShiftType] = useState(existing?.shift_type || "morning");
  const [startTime, setStartTime] = useState(existing?.start_time || "09:00");
  const [endTime, setEndTime] = useState(existing?.end_time || "17:00");
  const [note, setNote] = useState(existing?.note || "");
  const [notePublic, setNotePublic] = useState(existing?.note_public ?? true);
  const [locked, setLocked] = useState(existing?.locked ?? false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (shiftType === "custom" && (!startTime || !endTime)) {
      return;
    }
    if (shiftType === "custom" && startTime >= endTime) {
      return;
    }
    if (note.length > 250) return;
    setSaving(true);
    const data = {
      staffId,
      date,
      shiftType,
      startTime: shiftType === "custom" ? startTime : null,
      endTime: shiftType === "custom" ? endTime : null,
      note: note.trim(),
      notePublic,
      locked,
      source: mode === "assignment" ? "manager" : undefined,
    };
    const ok = await onSave(data);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal onClose={onClose}>
      <div style={{ padding: 24, minWidth: 320, maxWidth: 420, direction: "rtl" }}>
        <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>
          {mode === "preference" ? "✏️ העדפה" : "📋 שיבוץ"}
        </div>
        <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 16 }}>
          {memberName} · {HE_DAYS[new Date(date + "T00:00:00").getDay()]} {formatDateHe(date)}
        </div>

        {/* Shift Type */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)", marginBottom: 6, display: "block" }}>סוג משמרת</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Object.entries(SHIFT_TYPES).map(([key, s]) => (
              <button
                key={key}
                onClick={() => setShiftType(key)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: `1.5px solid ${shiftType === key ? s.color : "var(--border)"}`,
                  background: shiftType === key ? s.bg : "var(--surface2)",
                  color: shiftType === key ? s.color : "var(--text2)",
                  fontWeight: shiftType === key ? 700 : 400,
                  fontSize: 13,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {s.icon} {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom time pickers */}
        {shiftType === "custom" && (
          <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>שעת התחלה</label>
              <input type="time" className="form-input" value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>שעת סיום</label>
              <input type="time" className="form-input" value={endTime} onChange={e => setEndTime(e.target.value)} />
            </div>
          </div>
        )}

        {/* Fixed time display */}
        {(shiftType === "morning" || shiftType === "evening") && (
          <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 14, padding: "8px 12px", background: "var(--surface2)", borderRadius: 8 }}>
            🕐 {SHIFT_TYPES[shiftType].start} – {SHIFT_TYPES[shiftType].end}
          </div>
        )}

        {/* Note */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>הערה (אופציונלי)</label>
          <textarea
            value={note}
            onChange={e => { if (e.target.value.length <= 250) setNote(e.target.value); }}
            placeholder="הערה, אילוץ, סיבה..."
            rows={3}
            style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, color: "var(--text)", fontSize: 13, resize: "vertical", fontFamily: "inherit" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                <input type="radio" name="noteVis" checked={notePublic} onChange={() => setNotePublic(true)} /> ציבורית
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                <input type="radio" name="noteVis" checked={!notePublic} onChange={() => setNotePublic(false)} /> פרטית למנהל 🔒
              </label>
            </div>
            <span style={{ fontSize: 11, color: note.length > 230 ? "var(--red)" : "var(--text3)" }}>{note.length}/250</span>
          </div>
        </div>

        {/* Lock toggle (admin + assignment only) */}
        {isAdmin && mode === "assignment" && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={locked} onChange={e => setLocked(e.target.checked)} />
              🔒 נעילת שיבוץ (מונע עריכה על ידי העובד)
            </label>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
          <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary" disabled={saving || (shiftType === "custom" && (!startTime || !endTime || startTime >= endTime))} onClick={handleSave}>
            {saving ? "שומר..." : "💾 שמור"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Styles ──
const thStyle = {
  padding: "10px 6px",
  textAlign: "center",
  borderBottom: "2px solid var(--border)",
  fontSize: 13,
  color: "var(--text)",
  position: "sticky",
  top: 0,
  background: "var(--surface)",
  zIndex: 2,
};

const tdStyle = {
  padding: "8px 4px",
  borderBottom: "1px solid var(--border)",
  borderLeft: "1px solid var(--border)",
  minWidth: 95,
};

const miniBtn = {
  padding: "2px 4px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontSize: 11,
  borderRadius: 4,
};

const labelStyle = {
  fontSize: 12,
  fontWeight: 700,
  color: "var(--text3)",
  marginBottom: 4,
  display: "block",
};
