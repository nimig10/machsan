// StaffSchedulePage.jsx — Staff weekly schedule: slot-based view
import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { Modal } from "./ui.jsx";

/* ── Shift types ── */
const SHIFT_TYPES = {
  morning: { label: "בוקר",    icon: "☀️",  color: "#f59e0b", bg: "rgba(245,158,11,0.13)", start: "09:00", end: "17:00" },
  custom:  { label: "חופשי",   icon: "🕐",  color: "#22c55e", bg: "rgba(34,197,94,0.13)"  },
  evening: { label: "ערב",     icon: "🌙",  color: "#3b82f6", bg: "rgba(59,130,246,0.13)", start: "14:00", end: "22:00" },
  absent:  { label: "לא נוכח", icon: "🚫",  color: "#ef4444", bg: "rgba(239,68,68,0.13)"  },
};

const SLOT_ORDER = ["morning", "custom", "evening"];

const HE_DAYS = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];

/* ── Helpers ── */
function formatDateHe(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getWeekDates(offset = 0) {
  const now = new Date();
  const day = now.getDay();
  const sun = new Date(now);
  sun.setDate(now.getDate() - day + offset * 7);
  sun.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sun);
    d.setDate(sun.getDate() + i);
    return localDateStr(d);
  });
}

function todayStr() { return localDateStr(new Date()); }

function canStaffEditDate(dateStr) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  const today = now.getDay();
  if (target <= now) return false;
  const currentSun = new Date(now);
  currentSun.setDate(now.getDate() - today);
  const nextSun = new Date(currentSun);
  nextSun.setDate(currentSun.getDate() + 7);
  const weekAfterSun = new Date(currentSun);
  weekAfterSun.setDate(currentSun.getDate() + 14);
  if (target < nextSun) return false;
  if (target < weekAfterSun) return today >= 0 && today <= 3;
  return true;
}

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
    const wo = today >= 0 && today <= 3;
    return { open: wo, text: wo ? "חלון ההעדפות פתוח (עד יום רביעי)" : "חלון ההעדפות נסגר לשבוע זה" };
  }
  return { open: true, text: "ניתן להגיש העדפות" };
}

/* ── API helper ── */
async function scheduleApi(action, body = {}) {
  const res = await fetch("/api/staff-schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  return res.json();
}

/* ══════════════════════ Main Component ══════════════════════ */
export function StaffSchedulePage({ staffUser, showToast }) {
  const isAdmin = staffUser?.role === "admin";
  const currentStaffId = staffUser?.id;

  const [staffList, setStaffList] = useState([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [preferences, setPreferences] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const hasLoadedOnce = useRef(false);
  const weekCache = useRef({});       // { startDate: { preferences, assignments } }
  const activeStartRef = useRef(null);
  const [holidays, setHolidays] = useState([]);
  const [editModal, setEditModal] = useState(null);
  const [notePopup, setNotePopup] = useState(null); // { memberName, note }

  /* Load staff members from Supabase */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/staff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list", callerRole: isAdmin ? "admin" : "staff" }),
        });
        if (res.ok) {
          const list = await res.json();
          setStaffList(list.map(s => ({ id: s.id, name: s.full_name || s.email })));
        }
      } catch {}
    })();
  }, []);

  const displayMembers = useMemo(() => {
    if (staffList.length > 0) return staffList;
    if (staffUser) return [{ id: staffUser.id, name: staffUser.full_name || "אני" }];
    return [];
  }, [staffList, staffUser]);

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);
  const workDays = useMemo(() => weekDates.slice(0, 6), [weekDates]); // Sun–Fri, no Saturday
  const startDate = weekDates[0];
  const endDate = weekDates[6];

  /* Load holidays from Hebcal API */
  useEffect(() => {
    const year = new Date().getFullYear();
    (async () => {
      const all = [];
      for (const y of [year, year + 1]) {
        try {
          const r = await fetch(`https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&mod=on&year=${y}&month=x&geo=il&i=on`);
          const d = await r.json();
          for (const item of d.items || []) {
            all.push({ date: item.date, name: item.hebrew || item.title, isErev: /^Erev /.test(item.title || "") });
          }
        } catch {
          try {
            const mod = await import("../utils/jewishHolidays.js");
            if (mod.getHolidaysForDateRange) all.push(...mod.getHolidaysForDateRange(`${y}-01-01`, `${y}-12-31`));
          } catch {}
        }
      }
      setHolidays(all);
    })();
  }, []);

  // Apply cached data to state (only if still the active week)
  const applyWeek = useCallback((start, data) => {
    if (start !== activeStartRef.current) return;
    setPreferences(data.preferences);
    setAssignments(data.assignments);
  }, []);

  // Core loader: fetches one week (with caching). background=true skips loading UI.
  const loadWeek = useCallback(async (start, end, { background = false, bust = false } = {}) => {
    if (!bust && weekCache.current[start]) {
      applyWeek(start, weekCache.current[start]);
      return;
    }
    if (!background) {
      if (!hasLoadedOnce.current) setLoading(true); else setFetching(true);
    }
    try {
      const data = await scheduleApi("list-week", { startDate: start, endDate: end });
      const result = { preferences: data.preferences || [], assignments: data.assignments || [] };
      weekCache.current[start] = result;
      applyWeek(start, result);
    } catch { if (!background) showToast("error", "שגיאה בטעינת לוז"); }
    finally {
      if (!background) { setLoading(false); setFetching(false); hasLoadedOnce.current = true; }
    }
  }, [applyWeek]);

  // Switch active week (instant if cached, fetch otherwise)
  useEffect(() => {
    activeStartRef.current = startDate;
    loadWeek(startDate, endDate);
  }, [startDate]);

  // Prefetch ±1 and ±2 adjacent weeks in background after navigation
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const delta of [-1, 1, -2, 2]) {
        if (cancelled) break;
        const dates = getWeekDates(weekOffset + delta);
        const s = dates[0], e = dates[6];
        if (!weekCache.current[s]) {
          await new Promise(r => setTimeout(r, 250));
          if (!cancelled) loadWeek(s, e, { background: true });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [weekOffset]);

  // Called after save/delete — bust cache for current week and reload
  const fetchWeekData = useCallback(async () => {
    delete weekCache.current[startDate];
    await loadWeek(startDate, endDate, { bust: true });
  }, [startDate, endDate, loadWeek]);

  const prefWindowStatus = getPreferenceWindowStatus(weekDates);
  const getPref = (sid, date) => preferences.find(p => p.staff_id === sid && p.date === date);
  const getAssign = (sid, date) => assignments.find(a => a.staff_id === sid && a.date === date);

  /* ── Handlers ── */
  const savePref = async (data) => {
    const r = await scheduleApi("upsert-preference", { ...data, callerRole: isAdmin ? "admin" : "staff", callerId: currentStaffId });
    if (r.error) { showToast("error", r.error); return false; }
    showToast("success", "ההעדפה נשמרה"); await fetchWeekData(); return true;
  };
  const saveAssignment = async (data) => {
    const r = await scheduleApi("upsert-assignment", { ...data, assignedBy: currentStaffId, source: data.source || "manager", callerRole: "admin", callerId: currentStaffId });
    if (r.error) { showToast("error", r.error); return false; }
    showToast("success", "השיבוץ נשמר"); await fetchWeekData(); return true;
  };
  const deletePref = async (id) => {
    const r = await scheduleApi("delete-preference", { id, callerRole: isAdmin ? "admin" : "staff", callerId: currentStaffId });
    if (r.error) { showToast("error", r.error); return; }
    showToast("success", "ההעדפה נמחקה"); await fetchWeekData();
  };
  const deleteAssignment = async (id) => {
    const r = await scheduleApi("delete-assignment", { id, callerRole: "admin" });
    if (r.error) { showToast("error", r.error); return; }
    showToast("success", "השיבוץ נמחק"); await fetchWeekData();
  };
  const toggleLock = async (aId, locked) => {
    const r = await scheduleApi(locked ? "unlock" : "lock", { id: aId, callerRole: "admin" });
    if (r.error) { showToast("error", r.error); return; }
    await fetchWeekData();
  };

  /* ── Day slots builder ── */
  const getDaySlots = useCallback((date) => {
    const slots = { morning: [], custom: [], evening: [], absent: [] };
    displayMembers.forEach(member => {
      const mid = String(member.id);
      const asgn = getAssign(mid, date);
      const pref = getPref(mid, date);
      const entry = asgn || pref;
      if (!entry) return;
      const block = {
        id: entry.id, memberId: mid, memberName: member.name,
        type: asgn ? "assignment" : "preference",
        shiftType: entry.shift_type,
        startTime: entry.start_time,
        endTime: entry.end_time,
        locked: asgn?.locked || false, entry,
        hasPref: !!asgn && !!pref,
        staffNote: pref?.note || null,
        staffNotePublic: pref?.note_public ?? true,
        managerNote: asgn?.note || null,
        prefEntry: pref || null,
        asgnEntry: asgn || null,
      };
      if (slots[entry.shift_type]) slots[entry.shift_type].push(block);
      else slots.absent.push(block);
    });
    return slots;
  }, [displayMembers, preferences, assignments]);

  const allDaySlots = useMemo(
    () => Object.fromEntries(workDays.map(d => [d, getDaySlots(d)])),
    [workDays, getDaySlots]
  );

  const today = todayStr();
  const maxWeekOffset = 4;
  const hasAbsent = workDays.some(d => allDaySlots[d]?.absent?.length > 0);

  const openBlockEditor = (block, date) => {
    if (!isAdmin && block.type === "assignment") {
      // Staff editing unlocked assignment → open as preference editor
      setEditModal({ staffId: block.memberId, date, mode: "preference", existing: block.prefEntry, prefEntry: block.prefEntry, asgnEntry: block.asgnEntry });
    } else {
      setEditModal({ staffId: block.memberId, date, mode: block.type, existing: block.entry, prefEntry: block.prefEntry, asgnEntry: block.asgnEntry });
    }
  };
  const openNewEditor = (date, defaultShift = "morning") => {
    if (!isAdmin && !canStaffEditDate(date)) return;
    const sid = String(currentStaffId);
    const pref = getPref(sid, date);
    const asgn = getAssign(sid, date);
    setEditModal({ staffId: sid, date, mode: isAdmin ? "assignment" : "preference", existing: null, defaultShift, prefEntry: pref, asgnEntry: asgn });
  };

  /* ══════════ Render ══════════ */
  return (
    <div className="page" style={{ padding: "16px 12px" }}>

      {/* ── Title + User ── */}
      <div style={{ marginBottom: 14, direction: "rtl" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontWeight: 900, fontSize: 20, color: "var(--text)" }}>לו&quot;ז עובדים</span>
          <span style={{ fontSize: 13, color: "var(--text3)" }}>שלום, {staffUser?.full_name || ""}</span>
        </div>
      </div>

      {/* ── Week Navigation ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button className="btn btn-secondary btn-sm" disabled={weekOffset <= -4} onClick={() => setWeekOffset(w => w - 1)}>→</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset(0)}>השבוע</button>
          <button className="btn btn-secondary btn-sm" disabled={weekOffset >= maxWeekOffset} onClick={() => setWeekOffset(w => w + 1)}>←</button>
        </div>
        <span style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>
          {formatDateHe(startDate)} – {formatDateHe(workDays[5])}
        </span>
        {!isAdmin && (
          <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 16, fontWeight: 700,
            background: prefWindowStatus.open ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
            color: prefWindowStatus.open ? "#22c55e" : "#ef4444",
          }}>{prefWindowStatus.text}</span>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text3)" }}>טוען...</div>
      ) : (
        /* ── Calendar Grid ── */
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", borderRadius: 10, border: "1px solid var(--border)", position: "relative", opacity: fetching ? 0.55 : 1, transition: "opacity 0.18s" }}>
          {fetching && <div style={{ position: "absolute", inset: 0, zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}><div style={{ background: "var(--surface2)", padding: "6px 16px", borderRadius: 20, fontSize: 12, color: "var(--text3)", border: "1px solid var(--border)" }}>טוען...</div></div>}
          <div style={{
            display: "grid",
            gridTemplateColumns: "44px repeat(6, 1fr)",
            direction: "rtl",
            minWidth: 680,
          }}>

            {/* ═══ Header Row ═══ */}
            <div style={{ background: "var(--surface2)", borderBottom: "1px solid var(--border)", borderLeft: "1px solid var(--border)" }} />
            {workDays.map((date, i) => {
              const dayIdx = new Date(date + "T00:00:00").getDay();
              const hol = holidays.find(h => h.date === date);
              const isToday = date === today;
              return (
                <div key={date} style={{
                  padding: "8px 4px", textAlign: "center",
                  background: isToday ? "rgba(59,130,246,0.08)" : hol ? "rgba(245,158,11,0.06)" : "var(--surface2)",
                  borderBottom: "1px solid var(--border)",
                  borderLeft: i < 5 ? "1px solid var(--border)" : "none",
                }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: isToday ? "#3b82f6" : "var(--text3)" }}>{HE_DAYS[dayIdx]}</div>
                  <div style={{
                    fontSize: 22, fontWeight: 800, lineHeight: 1.2,
                    color: isToday ? "#fff" : "var(--text)",
                    ...(isToday ? { background: "#3b82f6", borderRadius: "50%", width: 34, height: 34, display: "inline-flex", alignItems: "center", justifyContent: "center" } : {}),
                  }}>{new Date(date + "T00:00:00").getDate()}</div>
                  {hol && <div style={{ fontSize: 9, color: "#f59e0b", fontWeight: 600, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hol.isErev ? `ערב ${hol.name}` : hol.name}</div>}
                </div>
              );
            })}

            {/* ═══ Shift Rows (morning / custom / evening) ═══ */}
            {SLOT_ORDER.map((slotKey, rowIdx) => {
              const st = SHIFT_TYPES[slotKey];
              const isLastSlot = rowIdx === SLOT_ORDER.length - 1;
              return (
                <Fragment key={slotKey}>
                  {/* Row label */}
                  <div style={{
                    background: st.bg,
                    borderTop: "1px solid var(--border)",
                    borderLeft: "1px solid var(--border)",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    padding: "6px 2px", gap: 2,
                  }}>
                    <span style={{ fontSize: 16 }}>{st.icon}</span>
                    <span style={{ fontSize: 8, color: st.color, fontWeight: 700, textAlign: "center" }}>{st.label}</span>
                  </div>

                  {/* Day cells */}
                  {workDays.map((date, i) => {
                    const members = allDaySlots[date]?.[slotKey] || [];
                    const isToday = date === today;
                    const dateEditable = isAdmin || canStaffEditDate(date);
                    const cellBg = isToday ? `${st.bg.replace("0.13", "0.22")}` : st.bg;

                    return (
                      <div key={date}
                        onClick={() => dateEditable && openNewEditor(date, slotKey)}
                        style={{
                          background: cellBg,
                          borderTop: "1px solid var(--border)",
                          borderLeft: i < 5 ? "1px solid var(--border)" : "none",
                          padding: "5px 4px",
                          minHeight: 72,
                          position: "relative",
                          cursor: dateEditable ? "pointer" : "default",
                        }}>
                        {/* Member list */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          {members.map(block => {
                            const isMe = block.memberId === String(currentStaffId);
                            // Staff can edit own preferences OR own unlocked assignments
                            const canEdit = isAdmin || (isMe && canStaffEditDate(date) && (block.type === "preference" || !block.locked));
                            // Lock icon: only visible to admin or to the locked staff member
                            const showLock = block.locked && (isAdmin || isMe);
                            // Notes: staff note (from preference) + manager note (from assignment)
                            const canSeeStaffNote = !!block.staffNote && (block.staffNotePublic || isAdmin);
                            const canSeeManagerNote = !!block.managerNote && (isAdmin || isMe);
                            const hasVisibleNote = canSeeStaffNote || canSeeManagerNote;
                            // Star shows to everyone if there's a staff note (even if private), but only clickable if can see
                            const showStar = !!block.staffNote || (!!block.managerNote && (isAdmin || isMe));

                            const openNotePopup = () => setNotePopup({
                              memberName: block.memberName,
                              staffNote: canSeeStaffNote ? block.staffNote : null,
                              managerNote: canSeeManagerNote ? block.managerNote : null,
                            });
                            // Chip is clickable for editing (own/admin) OR for viewing note (anyone with visible note)
                            const chipClickable = canEdit || hasVisibleNote;

                            return (
                              <div key={block.id}
                                onClick={e => {
                                  e.stopPropagation();
                                  if (canEdit) openBlockEditor(block, date);
                                  else if (hasVisibleNote) openNotePopup();
                                }}
                                style={{
                                  display: "flex", alignItems: "center", gap: 3,
                                  background: "rgba(255,255,255,0.07)",
                                  borderRadius: 5, padding: "3px 6px",
                                  borderRight: `2.5px solid ${showLock ? "#f59e0b" : st.color}`,
                                  cursor: chipClickable ? "pointer" : "default",
                                  transition: "background 0.12s",
                                }}
                                onMouseEnter={e => { if (chipClickable) e.currentTarget.style.background = "rgba(255,255,255,0.14)"; }}
                                onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
                              >
                                {showLock && <span style={{ fontSize: 9 }}>🔒</span>}
                                <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {block.memberName}
                                </span>
                                {slotKey === "custom" && block.startTime && block.endTime && (
                                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.6)", whiteSpace: "nowrap", flexShrink: 0 }}>
                                    {block.startTime}–{block.endTime}
                                  </span>
                                )}
                                {showStar && (
                                  <span
                                    onClick={e => { e.stopPropagation(); if (hasVisibleNote) openNotePopup(); }}
                                    title={hasVisibleNote ? "לחץ לצפייה בהערה" : "הערה פרטית"}
                                    style={{ fontSize: 11, flexShrink: 0, cursor: hasVisibleNote ? "pointer" : "default", opacity: hasVisibleNote ? 1 : 0.4 }}
                                  >⭐</span>
                                )}
                              </div>
                            );
                          })}
                        </div>

                      </div>
                    );
                  })}
                </Fragment>
              );
            })}

            {/* ═══ Absent Row (only if any absent entries exist) ═══ */}
            {hasAbsent && (
              <Fragment key="absent">
                <div style={{
                  background: SHIFT_TYPES.absent.bg,
                  borderTop: "1px solid var(--border)",
                  borderLeft: "1px solid var(--border)",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  padding: "6px 2px", gap: 2,
                }}>
                  <span style={{ fontSize: 16 }}>{SHIFT_TYPES.absent.icon}</span>
                  <span style={{ fontSize: 8, color: SHIFT_TYPES.absent.color, fontWeight: 700, textAlign: "center" }}>{SHIFT_TYPES.absent.label}</span>
                </div>
                {workDays.map((date, i) => {
                  const absent = allDaySlots[date]?.absent || [];
                  return (
                    <div key={date} style={{
                      background: SHIFT_TYPES.absent.bg,
                      borderTop: "1px solid var(--border)",
                      borderLeft: i < 5 ? "1px solid var(--border)" : "none",
                      padding: "5px 4px",
                      minHeight: 36,
                    }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {absent.map(block => {
                          const isMe = block.memberId === String(currentStaffId);
                          const canEdit = isAdmin || (isMe && canStaffEditDate(date) && (block.type === "preference" || !block.locked));
                          return (
                            <div key={block.id}
                              onClick={() => canEdit && openBlockEditor(block, date)}
                              style={{
                                display: "flex", alignItems: "center", gap: 3,
                                background: "rgba(239,68,68,0.12)",
                                borderRadius: 5, padding: "2px 5px",
                                borderRight: `2px solid ${SHIFT_TYPES.absent.color}`,
                                cursor: canEdit ? "pointer" : "default",
                                fontSize: 10, color: "#fca5a5",
                              }}
                            >
                              <span style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {block.memberName}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </Fragment>
            )}

          </div>
        </div>
      )}

      {/* ── Note Popup ── */}
      {notePopup && (
        <Modal onClose={() => setNotePopup(null)}>
          <div style={{ padding: 24, maxWidth: 360, direction: "rtl" }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 14 }}>⭐ הערות — {notePopup.memberName}</div>
            {notePopup.staffNote && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: "#22c55e", marginBottom: 4 }}>📝 הערת איש צוות</div>
                <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.7, whiteSpace: "pre-wrap", padding: "8px 10px", background: "var(--surface2)", borderRadius: 8 }}>{notePopup.staffNote}</div>
              </div>
            )}
            {notePopup.managerNote && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: "#3b82f6", marginBottom: 4 }}>👤 הערת מנהל</div>
                <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.7, whiteSpace: "pre-wrap", padding: "8px 10px", background: "var(--surface2)", borderRadius: 8 }}>{notePopup.managerNote}</div>
              </div>
            )}
            <button className="btn btn-secondary" style={{ marginTop: 4 }} onClick={() => setNotePopup(null)}>סגור</button>
          </div>
        </Modal>
      )}

      {/* ── Edit Modal ── */}
      {editModal && (
        <ScheduleEditorModal
          modal={editModal}
          isAdmin={isAdmin}
          currentStaffId={currentStaffId}
          teamMembers={displayMembers}
          onSave={editModal.mode === "preference" ? savePref : saveAssignment}
          onDelete={editModal.mode === "preference" ? deletePref : deleteAssignment}
          onLock={editModal.mode === "assignment" ? toggleLock : null}
          onClose={() => setEditModal(null)}
        />
      )}
    </div>
  );
}

/* ══════════ Editor Modal ══════════ */
function ScheduleEditorModal({ modal, isAdmin, currentStaffId, teamMembers, onSave, onDelete, onLock, onClose }) {
  const { staffId: initStaffId, date, mode, existing, defaultShift, prefEntry, asgnEntry } = modal;
  const [staffId, setStaffId] = useState(String(initStaffId));
  const memberName = teamMembers.find(m => String(m.id) === staffId)?.name || "";
  const isEditingSelf = staffId === String(currentStaffId);

  const [shiftType, setShiftType] = useState(existing?.shift_type || defaultShift || "morning");
  const [startTime, setStartTime] = useState(existing?.start_time || "09:00");
  const [endTime, setEndTime] = useState(existing?.end_time || "17:00");
  // In preference mode → note = staff note (editable); in assignment mode → note = manager note (editable)
  const [note, setNote] = useState(existing?.note || "");
  const [notePublic, setNotePublic] = useState(existing?.note_public ?? true);
  const [locked, setLocked] = useState(existing?.locked ?? false);
  const [saving, setSaving] = useState(false);

  // Read-only note from the other side
  const readOnlyStaffNote = mode === "assignment" ? (prefEntry?.note || null) : null;
  const readOnlyManagerNote = mode === "preference" ? (asgnEntry?.note || null) : null;

  const handleSave = async () => {
    if (shiftType === "custom" && (!startTime || !endTime || startTime >= endTime)) return;
    if (note.length > 250) return;
    setSaving(true);
    const ok = await onSave({
      staffId, date, shiftType,
      startTime: shiftType === "custom" ? startTime : null,
      endTime: shiftType === "custom" ? endTime : null,
      note: note.trim(), notePublic, locked,
      source: mode === "assignment" ? "manager" : undefined,
    });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal onClose={onClose}>
      <div style={{ padding: 24, minWidth: 300, maxWidth: 420, direction: "rtl" }}>
        <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>
          {mode === "preference" ? "✏️ העדפה" : "📋 שיבוץ"}
        </div>
        <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 16 }}>
          {memberName} · {HE_DAYS[new Date(date + "T00:00:00").getDay()]} {formatDateHe(date)}
        </div>

        {/* Member selector (admin creating new assignment) */}
        {isAdmin && mode === "assignment" && !existing && teamMembers.length > 1 && (
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>עובד</label>
            <select value={staffId} onChange={e => setStaffId(e.target.value)}
              style={{ width: "100%", padding: 8, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: 13 }}>
              {teamMembers.map(m => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
            </select>
          </div>
        )}

        {/* Shift Type */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ ...labelStyle, marginBottom: 6 }}>סוג משמרת</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Object.entries(SHIFT_TYPES).map(([key, s]) => (
              <button key={key} onClick={() => setShiftType(key)}
                style={{
                  padding: "8px 14px", borderRadius: 8,
                  border: `1.5px solid ${shiftType === key ? s.color : "var(--border)"}`,
                  background: shiftType === key ? s.bg : "var(--surface2)",
                  color: shiftType === key ? s.color : "var(--text2)",
                  fontWeight: shiftType === key ? 700 : 400, fontSize: 13, cursor: "pointer",
                }}>
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
            🕐 {SHIFT_TYPES[shiftType].start || ""} – {SHIFT_TYPES[shiftType].end || ""}
          </div>
        )}

        {/* ── Read-only staff note (shown when admin edits assignment) ── */}
        {readOnlyStaffNote && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ ...labelStyle, color: "#22c55e" }}>📝 הערת איש צוות</label>
            <div style={{ fontSize: 13, color: "var(--text)", padding: "8px 12px", background: "var(--surface2)", borderRadius: 8, borderRight: "3px solid #22c55e", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {readOnlyStaffNote}
            </div>
          </div>
        )}

        {/* ── Read-only manager note (shown when staff edits preference) ── */}
        {readOnlyManagerNote && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ ...labelStyle, color: "#3b82f6" }}>👤 הערת מנהל</label>
            <div style={{ fontSize: 13, color: "var(--text)", padding: "8px 12px", background: "var(--surface2)", borderRadius: 8, borderRight: "3px solid #3b82f6", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {readOnlyManagerNote}
            </div>
          </div>
        )}

        {/* ── Editable note ── */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>{mode === "assignment" ? "👤 הערת מנהל (אופציונלי)" : "📝 הערת איש צוות (אופציונלי)"}</label>
          <textarea value={note} onChange={e => { if (e.target.value.length <= 250) setNote(e.target.value); }}
            placeholder={mode === "assignment" ? "סיבת השיבוץ, הוראות..." : "הערה, אילוץ, סיבה..."}
            rows={2}
            style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, color: "var(--text)", fontSize: 13, resize: "vertical", fontFamily: "inherit" }} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            {/* Public/private toggle — only for staff notes (preference mode) */}
            {mode === "preference" ? (
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                  <input type="radio" name="noteVis" checked={notePublic} onChange={() => setNotePublic(true)} /> ציבורית
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                  <input type="radio" name="noteVis" checked={!notePublic} onChange={() => setNotePublic(false)} /> פרטית למנהל 🔒
                </label>
              </div>
            ) : <div />}
            <span style={{ fontSize: 11, color: note.length > 230 ? "var(--red)" : "var(--text3)" }}>{note.length}/250</span>
          </div>
        </div>

        {/* Lock toggle — only for admin assigning ANOTHER member */}
        {isAdmin && mode === "assignment" && !isEditingSelf && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={locked} onChange={e => setLocked(e.target.checked)} />
              🔒 נעילת שיבוץ (מונע עריכה על ידי העובד)
            </label>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 20, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {existing && onDelete && (
              <button className="btn btn-secondary" style={{ color: "#ef4444", fontSize: 12 }}
                onClick={async () => { await onDelete(existing.id); onClose(); }}>🗑️ מחק</button>
            )}
            {existing && onLock && isAdmin && mode === "assignment" && !isEditingSelf && (
              <button className="btn btn-secondary" style={{ fontSize: 12 }}
                onClick={async () => { await onLock(existing.id, existing.locked); onClose(); }}>
                {existing.locked ? "🔓 פתח נעילה" : "🔒 נעל"}
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
            <button className="btn btn-primary" disabled={saving || (shiftType === "custom" && (!startTime || !endTime || startTime >= endTime))} onClick={handleSave}>
              {saving ? "שומר..." : "💾 שמור"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ── Styles ── */
const labelStyle = {
  fontSize: 12, fontWeight: 700, color: "var(--text3)", marginBottom: 4, display: "block",
};
