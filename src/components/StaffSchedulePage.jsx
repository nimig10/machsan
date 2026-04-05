// StaffSchedulePage.jsx — Staff weekly schedule + daily activity summary
import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { Modal } from "./ui.jsx";

/* ── Half-hour time slots 09:00–22:00 ── */
const TIME_SLOTS = (() => {
  const s = [];
  for (let h = 9; h <= 22; h++) for (const m of ["00", "30"]) { if (h === 22 && m === "30") break; s.push(`${String(h).padStart(2, "0")}:${m}`); }
  return s;
})();

/* ── Shift types ── */
const SHIFT_TYPES = {
  morning: { label: "בוקר",    icon: "☀️",  color: "#f59e0b", bg: "rgba(245,158,11,0.13)", start: "09:00", end: "17:00" },
  custom:  { label: "חופשי",   icon: "🕐",  color: "#22c55e", bg: "rgba(34,197,94,0.13)"  },
  evening: { label: "ערב",     icon: "🌙",  color: "#3b82f6", bg: "rgba(59,130,246,0.13)", start: "14:00", end: "22:00" },
  absent:  { label: "לא נוכח", icon: "🚫",  color: "#ef4444", bg: "rgba(239,68,68,0.13)"  },
};

const SLOT_ORDER = ["morning", "custom", "evening"];

const HE_DAYS   = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
const MIN_WEEK_OFFSET = -26; // 6 months back
const MAX_WEEK_OFFSET = 54;  // 12 months forward

// Return weekOffset needed to land on the week that contains the 1st of the given month
function monthToWeekOffset(year, month) {
  const firstOfMonth = new Date(year, month, 1);
  const firstDay = firstOfMonth.getDay();
  const weekSun = new Date(year, month, 1 - firstDay); // Sunday of the week containing the 1st
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const thisSun = new Date(now); thisSun.setDate(now.getDate() - now.getDay());
  return Math.round((weekSun.getTime() - thisSun.getTime()) / (7 * 86400000));
}

// Build list of months: 6 back + current + 12 forward
function getMonthOptions() {
  const now = new Date();
  const options = [];
  for (let delta = -6; delta <= 12; delta++) {
    const d = new Date(now.getFullYear(), now.getMonth() + delta, 1);
    options.push({ year: d.getFullYear(), month: d.getMonth(), label: `${HE_MONTHS[d.getMonth()]} ${d.getFullYear()}` });
  }
  return options;
}

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
  const today = now.getDay(); // 0=Sun … 6=Sat
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  if (target <= midnight) return false;
  const currentSun = new Date(midnight);
  currentSun.setDate(midnight.getDate() - today);
  const nextSun = new Date(currentSun); nextSun.setDate(currentSun.getDate() + 7);
  const weekAfterSun = new Date(currentSun); weekAfterSun.setDate(currentSun.getDate() + 14);
  if (target < nextSun) return false;
  // For next week: window open until Saturday 20:00
  if (target < weekAfterSun) {
    if (today < 6) return true;          // Sun–Fri: always open
    return now.getHours() < 20;          // Sat: open until 20:00
  }
  return true;
}

function getPreferenceWindowStatus(weekDates) {
  const now = new Date();
  const today = now.getDay();
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const currentSun = new Date(midnight); currentSun.setDate(midnight.getDate() - today);
  const nextSun = new Date(currentSun); nextSun.setDate(currentSun.getDate() + 7);
  const weekAfterSun = new Date(currentSun); weekAfterSun.setDate(currentSun.getDate() + 14);
  const weekStart = new Date(weekDates[0] + "T00:00:00");
  if (weekStart < nextSun) return { open: false, text: "שבוע נוכחי" };
  if (weekStart < weekAfterSun) {
    const wo = today < 6 || now.getHours() < 20;
    return { open: wo, text: wo ? "חלון ההעדפות פתוח (עד שבת 20:00)" : "חלון ההעדפות נסגר לשבוע זה" };
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
export function StaffSchedulePage({ staffUser, showToast, studios = [], studioBookings = [], reservations = [] }) {
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
  const [myShiftsOnly, setMyShiftsOnly] = useState(false);
  const [showLessons, setShowLessons] = useState(false);
  const [showStudentBookings, setShowStudentBookings] = useState(false);
  const [showLoans, setShowLoans] = useState(false);

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

  const allMembers = useMemo(() => {
    if (staffList.length > 0) return staffList;
    if (staffUser) return [{ id: staffUser.id, name: staffUser.full_name || "אני" }];
    return [];
  }, [staffList, staffUser]);

  const displayMembers = useMemo(() => {
    if (myShiftsOnly && currentStaffId) {
      const me = allMembers.find(m => String(m.id) === String(currentStaffId));
      return me ? [me] : [];
    }
    return allMembers;
  }, [allMembers, myShiftsOnly, currentStaffId]);

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

  // Purge data older than 6 months from DB (run once on mount, admin only)
  useEffect(() => {
    if (!isAdmin) return;
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 6);
    const cutoffStr = localDateStr(cutoff);
    scheduleApi("purge-old", { beforeDate: cutoffStr }).catch(() => {});
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
  const hasAbsent = workDays.some(d => allDaySlots[d]?.absent?.length > 0);

  // Month picker: figure out which month option is currently "selected"
  const monthOptions = getMonthOptions();
  const currentWeekMid = new Date(startDate + "T00:00:00");
  currentWeekMid.setDate(currentWeekMid.getDate() + 3);
  const currentMonthKey = `${currentWeekMid.getFullYear()}-${currentWeekMid.getMonth()}`;
  const selectedMonthIdx = monthOptions.findIndex(o => `${o.year}-${o.month}` === currentMonthKey);
  const [monthMenuOpen, setMonthMenuOpen] = useState(false);
  const monthMenuRef = useRef(null);
  useEffect(() => {
    if (!monthMenuOpen) return;
    const close = (e) => {
      if (monthMenuRef.current && !monthMenuRef.current.contains(e.target)) {
        setMonthMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [monthMenuOpen]);

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

      {/* ── Week Navigation + Filters ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8, direction: "rtl" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-secondary btn-sm" disabled={weekOffset <= MIN_WEEK_OFFSET} onClick={() => setWeekOffset(w => w - 1)}>→</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset(0)}>השבוע</button>
          <button className="btn btn-secondary btn-sm" disabled={weekOffset >= MAX_WEEK_OFFSET} onClick={() => setWeekOffset(w => w + 1)}>←</button>

          {/* Month picker dropdown */}
          <div style={{ position: "relative" }} ref={monthMenuRef}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setMonthMenuOpen(v => !v)}
              style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}
            >
              {selectedMonthIdx >= 0 ? monthOptions[selectedMonthIdx].label : "בחר חודש"}
              <span style={{ fontSize: 9, opacity: 0.6 }}>▼</span>
            </button>
            {monthMenuOpen && (
              <div style={{
                position: "absolute", top: "100%", right: 0, zIndex: 200, marginTop: 4,
                background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10,
                boxShadow: "0 8px 24px rgba(0,0,0,0.35)", minWidth: 160, direction: "rtl",
                maxHeight: 300, overflowY: "auto",
              }}>
                {monthOptions.map((opt, idx) => {
                  const wo = monthToWeekOffset(opt.year, opt.month);
                  const clamped = Math.max(MIN_WEEK_OFFSET, Math.min(MAX_WEEK_OFFSET, wo));
                  const isSelected = idx === selectedMonthIdx;
                  return (
                    <button key={`${opt.year}-${opt.month}`}
                      onClick={() => { setWeekOffset(clamped); setMonthMenuOpen(false); }}
                      style={{
                        display: "block", width: "100%", textAlign: "right",
                        padding: "8px 14px", background: isSelected ? "rgba(59,130,246,0.18)" : "transparent",
                        border: "none", color: isSelected ? "#3b82f6" : "var(--text)",
                        fontWeight: isSelected ? 800 : 600, fontSize: 13, cursor: "pointer",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >{opt.label}</button>
                  );
                })}
              </div>
            )}
          </div>

          {/* "My shifts" filter */}
          <button
            className={`btn btn-sm ${myShiftsOnly ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setMyShiftsOnly(v => !v)}
            style={{ fontSize: 12 }}
          >👤 משמרות שלי</button>
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
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        {/* ══════════════════════════════════════════════════
            ONE unified grid: shifts + lessons + bookings + loans
            all share the same 80px + 6-col layout
        ══════════════════════════════════════════════════ */}
        <div style={{ borderRadius: 10, border: "1px solid var(--border)", position: "relative", opacity: fetching ? 0.55 : 1, transition: "opacity 0.18s" }}>
          {fetching && <div style={{ position: "absolute", inset: 0, zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}><div style={{ background: "var(--surface2)", padding: "6px 16px", borderRadius: 20, fontSize: 12, color: "var(--text3)", border: "1px solid var(--border)" }}>טוען...</div></div>}
          <div style={{
            display: "grid",
            gridTemplateColumns: "80px repeat(6, 1fr)",
            direction: "rtl",
            minWidth: 716,
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

            {/* ══ Section divider: Lessons ══ */}
            <SectionDivider title="📚 לו&quot;ז יומי — שיעורים" open={showLessons} onToggle={() => setShowLessons(v => !v)} />

            {/* ══ Lessons body row ══ */}
            {showLessons && <LessonsRow workDays={workDays} studioBookings={studioBookings} studios={studios} today={today} holidays={holidays} />}

            {/* ══ Section divider: Student Bookings ══ */}
            <SectionDivider title="🎵 לו&quot;ז יומי — קביעות" open={showStudentBookings} onToggle={() => setShowStudentBookings(v => !v)} />

            {/* ══ Student Bookings body row ══ */}
            {showStudentBookings && <StudentBookingsRow workDays={workDays} studioBookings={studioBookings} studios={studios} today={today} holidays={holidays} />}

            {/* ══ Section divider: Loans ══ */}
            <SectionDivider title="📦 בקשות השאלה" open={showLoans} onToggle={() => setShowLoans(v => !v)} />

            {/* ══ Loans body row ══ */}
            {showLoans && <LoansRow workDays={workDays} reservations={reservations} today={today} />}

          </div>
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

/* ══════════ Section Divider — spans all 7 grid columns ══════════ */
function SectionDivider({ title, open, onToggle }) {
  return (
    <div style={{ gridColumn: "1 / -1", borderTop: "2px solid var(--border)" }}>
      <button onClick={onToggle} style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 14px", background: open ? "rgba(255,255,255,0.04)" : "var(--surface2)",
        border: "none", cursor: "pointer", color: "var(--text)", fontWeight: 800, fontSize: 13,
      }}>
        <span>{title}</span>
        <span style={{ fontSize: 10, color: "var(--text3)", transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "none" }}>▼</span>
      </button>
    </div>
  );
}

/* helpers shared by row components */
function getBookingKind(b) {
  if (b.bookingKind === "lesson" || b.lesson_auto || b.lesson_id) return "lesson";
  if (b.bookingKind === "team" || b.teamMemberId || b.teamMemberName || b.ownerType === "team") return "team";
  return "student";
}

/* ══════════ Lessons row — direct grid children (Fragment) ══════════ */
function LessonsRow({ workDays, studioBookings, studios, today, holidays }) {
  const bookings = Array.isArray(studioBookings) ? studioBookings : [];
  const studioMap = Object.fromEntries((studios || []).map(s => [String(s.id), s]));

  return (
    <Fragment>
      {/* Label cell */}
      <div style={{
        borderLeft: "1px solid var(--border)", borderTop: "1px solid var(--border)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: "6px 2px", gap: 2, background: "rgba(245,166,35,0.08)",
      }}>
        <span style={{ fontSize: 14 }}>📚</span>
        <span style={{ fontSize: 8, color: "#f5a623", fontWeight: 700, textAlign: "center" }}>שיעורים</span>
      </div>
      {/* Day cells */}
      {workDays.map((date, i) => {
        const lessons = bookings
          .filter(b => b.date === date && b.status !== "נדחה" && getBookingKind(b) === "lesson")
          .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
        return (
          <div key={date} style={{ padding: "4px 3px", borderLeft: i < 5 ? "1px solid var(--border)" : "none", borderTop: "1px solid var(--border)", minHeight: 54 }}>
            {lessons.map((b, j) => {
              const studio = studioMap[String(b.studioId)];
              return (
                <div key={b.id || j} style={{ background: "rgba(245,166,35,0.12)", border: "1px solid rgba(245,166,35,0.3)", borderRadius: 5, padding: "3px 5px", marginBottom: 3 }}>
                  <div style={{ fontWeight: 800, color: "#f5a623", fontSize: 10 }}>{b.startTime || ""}–{b.endTime || ""}</div>
                  <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 11, lineHeight: 1.3 }}>{b.courseName || b.studentName || "שיעור"}</div>
                  {b.instructorName && <div style={{ color: "#f5a623", fontSize: 11, fontWeight: 700 }}>👨‍🏫 {b.instructorName}</div>}
                  {studio && <div style={{ color: "var(--text2)", fontSize: 11, fontWeight: 600 }}>🏛️ {studio.name}</div>}
                </div>
              );
            })}
            {lessons.length === 0 && <div style={{ color: "var(--text3)", textAlign: "center", paddingTop: 14, fontSize: 10 }}>—</div>}
          </div>
        );
      })}
    </Fragment>
  );
}

/* ══════════ Student Bookings row ══════════ */
function StudentBookingsRow({ workDays, studioBookings, studios, today, holidays }) {
  const bookings = Array.isArray(studioBookings) ? studioBookings : [];
  const studioMap = Object.fromEntries((studios || []).map(s => [String(s.id), s]));

  return (
    <Fragment>
      {/* Label cell */}
      <div style={{
        borderLeft: "1px solid var(--border)", borderTop: "1px solid var(--border)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: "6px 2px", gap: 2, background: "rgba(34,197,94,0.08)",
      }}>
        <span style={{ fontSize: 14 }}>🎵</span>
        <span style={{ fontSize: 8, color: "#22c55e", fontWeight: 700, textAlign: "center" }}>קביעות</span>
      </div>
      {/* Day cells */}
      {workDays.map((date, i) => {
        const students = bookings
          .filter(b => b.date === date && b.status !== "נדחה" && getBookingKind(b) === "student")
          .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
        return (
          <div key={date} style={{ padding: "4px 3px", borderLeft: i < 5 ? "1px solid var(--border)" : "none", borderTop: "1px solid var(--border)", minHeight: 54 }}>
            {students.map((b, j) => {
              const studio = studioMap[String(b.studioId)];
              return (
                <div key={b.id || j} style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)", borderRadius: 5, padding: "3px 5px", marginBottom: 3 }}>
                  <div style={{ fontWeight: 800, color: "#22c55e", fontSize: 10 }}>{b.startTime || ""}–{b.endTime || ""}</div>
                  <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 11 }}>{b.studentName || "סטודנט"}</div>
                  {studio && <div style={{ color: "var(--text2)", fontSize: 11, fontWeight: 600 }}>🏛️ {studio.name}</div>}
                </div>
              );
            })}
            {students.length === 0 && <div style={{ color: "var(--text3)", textAlign: "center", paddingTop: 14, fontSize: 10 }}>—</div>}
          </div>
        );
      })}
    </Fragment>
  );
}

/* ══════════ Loans row ══════════ */
function LoanChip({ r, isReturn }) {
  return (
    <div style={{
      background: isReturn ? "rgba(59,130,246,0.1)" : "rgba(245,158,11,0.1)",
      border: `1px solid ${isReturn ? "rgba(59,130,246,0.25)" : "rgba(245,158,11,0.25)"}`,
      borderRadius: 5, padding: "2px 4px", marginBottom: 2,
    }}>
      <div style={{ fontWeight: 700, color: isReturn ? "#3b82f6" : "#f59e0b", fontSize: 9 }}>
        {isReturn ? "↩ החזרה" : "↗ יציאה"} {r.borrow_time && !isReturn ? r.borrow_time : ""}
      </div>
      <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 10, lineHeight: 1.3 }}>{r.student_name || "—"}</div>
      <div style={{ color: "var(--text3)", fontSize: 9 }}>{(r.items || []).length} פריטים · {r.loan_type || ""}</div>
    </div>
  );
}

function LoansRow({ workDays, reservations, today }) {
  const activeRes = (reservations || []).filter(r => r.status !== "נדחה" && r.status !== "הוחזר");

  return (
    <Fragment>
      {/* Label cell */}
      <div style={{
        borderLeft: "1px solid var(--border)", borderTop: "1px solid var(--border)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: "6px 2px", gap: 2, background: "rgba(245,158,11,0.08)",
      }}>
        <span style={{ fontSize: 14 }}>📦</span>
        <span style={{ fontSize: 8, color: "#f59e0b", fontWeight: 700, textAlign: "center" }}>השאלות</span>
      </div>
      {/* Day cells */}
      {workDays.map((date, i) => {
        const borrows = activeRes.filter(r => r.borrow_date === date);
        const returns = activeRes.filter(r => r.return_date === date && r.borrow_date !== date);
        const studentBorrows = borrows.filter(r => r.loan_type !== "שיעור");
        const lessonBorrows = borrows.filter(r => r.loan_type === "שיעור");
        const studentReturns = returns.filter(r => r.loan_type !== "שיעור");
        const lessonReturns = returns.filter(r => r.loan_type === "שיעור");
        const hasData = studentBorrows.length + lessonBorrows.length + studentReturns.length + lessonReturns.length > 0;
        return (
          <div key={date} style={{ padding: "4px 3px", borderLeft: i < 5 ? "1px solid var(--border)" : "none", borderTop: "1px solid var(--border)", minHeight: 50, fontSize: 10 }}>
            {studentBorrows.map(r => <LoanChip key={`sb-${r.id}`} r={r} isReturn={false} />)}
            {studentReturns.map(r => <LoanChip key={`sr-${r.id}`} r={r} isReturn={true} />)}
            {lessonBorrows.map(r => <LoanChip key={`lb-${r.id}`} r={r} isReturn={false} />)}
            {lessonReturns.map(r => <LoanChip key={`lr-${r.id}`} r={r} isReturn={true} />)}
            {!hasData && <div style={{ color: "var(--text3)", textAlign: "center", paddingTop: 14, fontSize: 10 }}>—</div>}
          </div>
        );
      })}
    </Fragment>
  );
}

/* ══════════ Editor Modal ══════════ */
function ScheduleEditorModal({ modal, isAdmin, currentStaffId, teamMembers, onSave, onDelete, onLock, onClose }) {
  const { staffId: initStaffId, date, mode, existing, defaultShift, prefEntry, asgnEntry } = modal;
  const [staffId, setStaffId] = useState(String(initStaffId));
  const [selectedStaffIds, setSelectedStaffIds] = useState([String(initStaffId)]);
  const memberName = teamMembers.find(m => String(m.id) === staffId)?.name || "";
  const isEditingSelf = staffId === String(currentStaffId);
  const isMultiSelect = isAdmin && mode === "assignment" && !existing && selectedStaffIds.length > 0;

  const [shiftType, setShiftType] = useState(existing?.shift_type || defaultShift || "morning");
  const [startTime, setStartTime] = useState(existing?.start_time || "09:00");
  const [endTime, setEndTime] = useState(existing?.end_time || "17:00");
  // In preference mode → note = staff note (editable); in assignment mode → note = manager note (editable)
  const [note, setNote] = useState(existing?.note || "");
  const [notePublic, setNotePublic] = useState(existing?.note_public ?? true);
  const [locked, setLocked] = useState(existing?.locked ?? false);

  // Read-only note from the other side
  const readOnlyStaffNote = mode === "assignment" ? (prefEntry?.note || null) : null;
  const readOnlyManagerNote = mode === "preference" ? (asgnEntry?.note || null) : null;

  const handleSave = async () => {
    if (shiftType === "custom" && (!startTime || !endTime || startTime >= endTime)) return;
    if (note.length > 250) return;
    // Close modal immediately (optimistic) for faster UX
    onClose();
    const ids = isMultiSelect ? selectedStaffIds : [staffId];
    const payload = {
      date, shiftType,
      startTime: shiftType === "custom" ? startTime : null,
      endTime: shiftType === "custom" ? endTime : null,
      note: note.trim(), notePublic, locked,
      source: mode === "assignment" ? "manager" : undefined,
    };
    // Save all selected staff members (parallel for multi-select)
    await Promise.all(ids.map(sid => onSave({ ...payload, staffId: sid })));
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

        {/* Member selector (admin creating new assignment — button chips, multi-select) */}
        {isAdmin && mode === "assignment" && !existing && teamMembers.length > 1 && (
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>עובדים לשיבוץ (ניתן לבחור מספר)</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {teamMembers.map(m => {
                const sel = selectedStaffIds.includes(String(m.id));
                return (
                  <button key={m.id} type="button"
                    onClick={e => {
                      const id = String(m.id);
                      if (e.ctrlKey || e.metaKey) {
                        // Ctrl/Cmd: toggle in multi-select
                        setSelectedStaffIds(prev => sel ? prev.filter(x => x !== id) : [...prev, id]);
                      } else {
                        // Regular click: replace selection with this one
                        setSelectedStaffIds([id]);
                      }
                    }}
                    style={{
                      padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: sel ? 700 : 500, cursor: "pointer",
                      border: `1.5px solid ${sel ? "var(--accent, #f5a623)" : "var(--border)"}`,
                      background: sel ? "rgba(245,166,35,0.15)" : "var(--surface2)",
                      color: sel ? "var(--accent, #f5a623)" : "var(--text2)",
                    }}
                  >{m.name}</button>
                );
              })}
            </div>
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

        {/* Custom time pickers (30-min slots 09:00–22:00) */}
        {shiftType === "custom" && (
          <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>שעת התחלה</label>
              <select value={startTime} onChange={e => setStartTime(e.target.value)}
                style={{ width: "100%", padding: 8, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: 13 }}>
                {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>שעת סיום</label>
              <select value={endTime} onChange={e => setEndTime(e.target.value)}
                style={{ width: "100%", padding: 8, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: 13 }}>
                {TIME_SLOTS.filter(t => t > startTime).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
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
            <button className="btn btn-primary" disabled={(shiftType === "custom" && (!startTime || !endTime || startTime >= endTime)) || (isMultiSelect && selectedStaffIds.length === 0)} onClick={handleSave}>
              💾 {isMultiSelect && selectedStaffIds.length > 1 ? `שמור (${selectedStaffIds.length} עובדים)` : "שמור"}
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
