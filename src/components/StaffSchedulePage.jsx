// StaffSchedulePage.jsx — Staff weekly schedule + daily activity summary
import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { Modal } from "./ui.jsx";
import { storageSet, getAuthToken } from "../utils.js";

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

const DAILY_TASKS = [
  { key: "open",  label: "פתיחת מכללה", icon: "☀️" },
  { key: "close", label: "סגירת מכללה", icon: "🌙" },
  { key: "prep",  label: "הכנת כיתות",  icon: "🏫" },
];

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
  const token = await getAuthToken();
  const res = await fetch("/api/staff-schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...body }),
  });
  return res.json();
}

/* ══════════════════════ Main Component ══════════════════════ */
export function StaffSchedulePage({ staffUser, showToast, studios = [], studioBookings = [], reservations = [], lessons = [], setLessons }) {
  const isAdmin = staffUser?.role === "admin";
  const canEditLessons = isAdmin || !!staffUser?.permissions?.canEditDailyLessons;
  const currentStaffId = staffUser?.id;
  // staff_members.id for the current user (may differ from users.id due to separate tables)
  const [myStaffMemberId, setMyStaffMemberId] = useState(null);
  // Resolved ID to use for schedule operations: staff_members.id preferred, fallback to users.id
  const effectiveStaffId = myStaffMemberId || currentStaffId;

  const [staffList, setStaffList] = useState([]);
  const [weekOffset, setWeekOffset] = useState(() => { try { return Number(sessionStorage.getItem("sch_weekOffset") || 0); } catch { return 0; } });
  const [preferences, setPreferences] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const hasLoadedOnce = useRef(false);
  const weekCache = useRef({});       // { startDate: { preferences, assignments } }
  const activeStartRef = useRef(null);
  const [holidays, setHolidays] = useState([]);
  const [dailyTasks, setDailyTasks] = useState([]);
  const [editModal, setEditModal] = useState(null);
  const [notePopup, setNotePopup] = useState(null); // { memberName, note }
  const [myShiftsOnly, setMyShiftsOnly] = useState(false);
  const [showLessons, setShowLessons] = useState(() => { try { return localStorage.getItem("sch_showLessons") === "1"; } catch { return false; } });
  const [showStudentBookings, setShowStudentBookings] = useState(() => { try { return localStorage.getItem("sch_showBookings") === "1"; } catch { return false; } });
  const [showLoans, setShowLoans] = useState(() => { try { return localStorage.getItem("sch_showLoans") === "1"; } catch { return false; } });
  const [viewMode, setViewMode] = useState(() => { try { return sessionStorage.getItem("sch_viewMode") || "week"; } catch { return "week"; } });
  const [dayViewIdx, setDayViewIdx] = useState(() => { try { return Number(sessionStorage.getItem("sch_dayViewIdx") || 0); } catch { return 0; } });
  const [dayMenuOpen, setDayMenuOpen] = useState(false);
  const dayMenuRef = useRef(null);

  /* Persist navigation state across page refreshes */
  useEffect(() => { try { sessionStorage.setItem("sch_weekOffset", weekOffset); } catch {} }, [weekOffset]);
  useEffect(() => { try { sessionStorage.setItem("sch_viewMode", viewMode); } catch {} }, [viewMode]);
  useEffect(() => { try { sessionStorage.setItem("sch_dayViewIdx", dayViewIdx); } catch {} }, [dayViewIdx]);
  useEffect(() => { try { localStorage.setItem("sch_showLessons", showLessons ? "1" : "0"); } catch {} }, [showLessons]);
  useEffect(() => { try { localStorage.setItem("sch_showBookings", showStudentBookings ? "1" : "0"); } catch {} }, [showStudentBookings]);
  useEffect(() => { try { localStorage.setItem("sch_showLoans", showLoans ? "1" : "0"); } catch {} }, [showLoans]);

  /* Load staff members from Supabase */
  useEffect(() => {
    (async () => {
      try {
        const token = await getAuthToken();
        const res = await fetch("/api/staff", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "list" }),
        });
        if (res.ok) {
          const list = await res.json();
          setStaffList(list.map(s => ({ id: s.id, name: s.full_name || s.email })));
          // Resolve current user's staff_members.id by matching email or full_name
          const myEntry = list.find(s =>
            (staffUser?.email && s.email === staffUser.email) ||
            (staffUser?.full_name && s.full_name === staffUser.full_name)
          );
          if (myEntry) setMyStaffMemberId(myEntry.id);
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
    if (myShiftsOnly && effectiveStaffId) {
      const me = allMembers.find(m => String(m.id) === String(effectiveStaffId));
      return me ? [me] : [];
    }
    return allMembers;
  }, [allMembers, myShiftsOnly, effectiveStaffId]);

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);
  const workDays = useMemo(() => weekDates.slice(0, 6), [weekDates]); // Sun–Fri, no Saturday
  const startDate = weekDates[0];
  const endDate = weekDates[6];
  // In day-view mode show only the selected day column
  const displayDays = viewMode === "day" ? [workDays[dayViewIdx]] : workDays;

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
    setDailyTasks(data.dailyTasks || []);
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
      const result = { preferences: data.preferences || [], assignments: data.assignments || [], dailyTasks: data.dailyTasks || [] };
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
    const r = await scheduleApi("upsert-preference", { ...data });
    if (r.error) { showToast("error", r.error); return false; }
    showToast("success", "ההעדפה נשמרה"); await fetchWeekData(); return true;
  };
  const saveAssignment = async (data) => {
    const r = await scheduleApi("upsert-assignment", { ...data, source: data.source || "manager" });
    if (r.error) { showToast("error", r.error); return false; }
    showToast("success", "השיבוץ נשמר"); await fetchWeekData(); return true;
  };
  const deletePref = async (id) => {
    const r = await scheduleApi("delete-preference", { id });
    if (r.error) { showToast("error", r.error); return; }
    showToast("success", "ההעדפה נמחקה"); await fetchWeekData();
  };
  const deleteAssignment = async (id) => {
    const r = await scheduleApi("delete-assignment", { id });
    if (r.error) { showToast("error", r.error); return; }
    showToast("success", "השיבוץ נמחק"); await fetchWeekData();
  };
  const toggleLock = async (aId, locked) => {
    const r = await scheduleApi(locked ? "unlock" : "lock", { id: aId });
    if (r.error) { showToast("error", r.error); return; }
    await fetchWeekData();
  };
  const claimTask = async (staffId, date, taskKey) => {
    // Optimistic update — instant UI response
    const optimistic = { id: `opt-${taskKey}-${date}`, date, task_key: taskKey, staff_id: staffId, assigned_by: effectiveStaffId, locked: false };
    setDailyTasks(prev => [...prev.filter(t => !(t.date === date && t.task_key === taskKey)), optimistic]);
    if (weekCache.current[startDate]) weekCache.current[startDate].dailyTasks = [...(weekCache.current[startDate].dailyTasks || []).filter(t => !(t.date === date && t.task_key === taskKey)), optimistic];

    const r = await scheduleApi("claim-daily-task", { staffId, date, taskKey });
    if (r.error) {
      showToast("error", r.error);
      // Revert optimistic
      setDailyTasks(prev => prev.filter(t => t.id !== optimistic.id));
      delete weekCache.current[startDate];
      return false;
    }
    showToast("success", "✅ המשימה נשמרה");
    // Swap optimistic placeholder with real DB row
    if (r.data) {
      setDailyTasks(prev => prev.map(t => t.id === optimistic.id ? r.data : t));
      if (weekCache.current[startDate]) weekCache.current[startDate].dailyTasks = (weekCache.current[startDate].dailyTasks || []).map(t => t.id === optimistic.id ? r.data : t);
    }
    return true;
  };
  const unclaimTask = async (staffId, date, taskKey) => {
    // Optimistic update — instant UI response
    const removed = dailyTasks.find(t => t.date === date && t.task_key === taskKey);
    setDailyTasks(prev => prev.filter(t => !(t.date === date && t.task_key === taskKey)));
    if (weekCache.current[startDate]) weekCache.current[startDate].dailyTasks = (weekCache.current[startDate].dailyTasks || []).filter(t => !(t.date === date && t.task_key === taskKey));

    const r = await scheduleApi("unclaim-daily-task", { staffId, date, taskKey });
    if (r.error) {
      showToast("error", r.error);
      // Revert optimistic
      if (removed) setDailyTasks(prev => [...prev, removed]);
      delete weekCache.current[startDate];
      return false;
    }
    return true;
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
  const hasAbsent = displayDays.some(d => allDaySlots[d]?.absent?.length > 0);

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

  useEffect(() => {
    if (!dayMenuOpen) return;
    const close = (e) => {
      if (dayMenuRef.current && !dayMenuRef.current.contains(e.target)) setDayMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [dayMenuOpen]);

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
    // Use staff_members.id (effectiveStaffId) to keep consistent with all DB operations
    const sid = String(effectiveStaffId);
    const pref = getPref(sid, date);
    const asgn = getAssign(sid, date);
    setEditModal({ staffId: sid, date, mode: isAdmin ? "assignment" : "preference", existing: null, defaultShift, prefEntry: pref, asgnEntry: asgn });
  };

  /* ── Edit/delete daily lesson schedule entries ── */
  const handleEditLessonSession = async (lessonId, sessionDate, updates) => {
    // Check for studio conflicts before saving
    if (updates.studioId) {
      const allBookings = Array.isArray(studioBookings) ? studioBookings : [];
      const conflict = allBookings.find(b =>
        b.date === sessionDate &&
        String(b.studioId) === String(updates.studioId) &&
        !(b.lesson_id && String(b.lesson_id) === String(lessonId) && b.date === sessionDate) &&
        b.status !== "נדחה" &&
        (updates.startTime || "00:00") < (b.endTime || "23:59") &&
        (updates.endTime || "23:59") > (b.startTime || "00:00")
      );
      if (conflict) {
        showToast("error", "לא ניתן להשלים את העריכה — חפיפה עם קביעה קיימת בכיתה זו");
        return false;
      }
    }
    const updated = lessons.map(l => {
      if (String(l.id) !== String(lessonId)) return l;
      return { ...l, schedule: (l.schedule || []).map(s => s.date === sessionDate ? { ...s, ...updates } : s) };
    });
    setLessons(updated);
    await storageSet("lessons", updated);
    showToast("success", "השיעור עודכן");
    return true;
  };

  const handleDeleteLessonSession = async (lessonId, sessionDate) => {
    const updated = lessons.map(l => {
      if (String(l.id) !== String(lessonId)) return l;
      return { ...l, schedule: (l.schedule || []).filter(s => s.date !== sessionDate) };
    });
    setLessons(updated);
    await storageSet("lessons", updated);
    showToast("success", "השיעור נמחק מיום זה");
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

      {/* ── Current week button (always visible, above nav) ── */}
      <div style={{ marginBottom: 6, direction: "rtl" }}>
        <button
          onClick={() => {
            setWeekOffset(0);
            if (viewMode === "day") {
              const todayIdx = workDays.findIndex(d => d === today);
              setDayViewIdx(todayIdx >= 0 ? todayIdx : 0);
            }
          }}
          style={{
            fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 8, cursor: weekOffset === 0 ? "default" : "pointer",
            border: `1.5px solid ${weekOffset === 0 ? "var(--accent)" : "var(--border)"}`,
            background: weekOffset === 0 ? "rgba(245,166,35,0.18)" : "transparent",
            color: weekOffset === 0 ? "var(--accent)" : "var(--text3)",
            transition: "all 0.15s",
          }}
        >השבוע הנוכחי</button>
      </div>

      {/* ── Week/Day Navigation + Filters ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8, direction: "rtl" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {/* ← → navigate weeks (week mode) or days (day mode) */}
          <button className="btn btn-secondary btn-sm"
            disabled={viewMode === "week" ? weekOffset <= MIN_WEEK_OFFSET : false}
            onClick={() => {
              if (viewMode === "day") {
                if (dayViewIdx > 0) { setDayViewIdx(i => i - 1); }
                else { setWeekOffset(w => w - 1); setDayViewIdx(5); }
              } else { setWeekOffset(w => w - 1); }
            }}>→</button>

          {/* View mode dropdown (שבוע / day picker) */}
          <div style={{ position: "relative" }} ref={dayMenuRef}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setDayMenuOpen(v => !v)}
              style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, minWidth: 72 }}
            >
              {viewMode === "day"
                ? `${HE_DAYS[new Date(displayDays[0] + "T00:00:00").getDay()]} ${new Date(displayDays[0] + "T00:00:00").getDate()}`
                : "שבוע"}
              <span style={{ fontSize: 9, opacity: 0.6 }}>▼</span>
            </button>
            {dayMenuOpen && (
              <div style={{
                position: "absolute", top: "100%", right: 0, zIndex: 210, marginTop: 4,
                background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10,
                boxShadow: "0 8px 24px rgba(0,0,0,0.35)", minWidth: 150, direction: "rtl",
              }}>
                {/* Week view option */}
                <button
                  onClick={() => { setViewMode("week"); setDayMenuOpen(false); }}
                  style={{ display: "block", width: "100%", textAlign: "right", padding: "8px 14px",
                    background: viewMode === "week" ? "rgba(59,130,246,0.18)" : "transparent",
                    border: "none", borderBottom: "1px solid var(--border)",
                    color: viewMode === "week" ? "#3b82f6" : "var(--text)",
                    fontWeight: viewMode === "week" ? 800 : 600, fontSize: 13, cursor: "pointer" }}>
                  📅 שבוע מלא
                </button>
                {/* Individual days */}
                {workDays.map((date, i) => {
                  const d = new Date(date + "T00:00:00");
                  const isSel = viewMode === "day" && dayViewIdx === i;
                  const isToday = date === today;
                  return (
                    <button key={date}
                      onClick={() => { setViewMode("day"); setDayViewIdx(i); setDayMenuOpen(false); }}
                      style={{ display: "block", width: "100%", textAlign: "right", padding: "7px 14px",
                        background: isSel ? "rgba(59,130,246,0.18)" : "transparent",
                        border: "none", borderBottom: i < 5 ? "1px solid var(--border)" : "none",
                        color: isSel ? "#3b82f6" : isToday ? "var(--accent)" : "var(--text)",
                        fontWeight: isSel || isToday ? 800 : 500, fontSize: 13, cursor: "pointer" }}>
                      {HE_DAYS[d.getDay()]} {d.getDate()}/{d.getMonth() + 1}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button className="btn btn-secondary btn-sm"
            disabled={viewMode === "week" ? weekOffset >= MAX_WEEK_OFFSET : false}
            onClick={() => {
              if (viewMode === "day") {
                if (dayViewIdx < 5) { setDayViewIdx(i => i + 1); }
                else { setWeekOffset(w => w + 1); setDayViewIdx(0); }
              } else { setWeekOffset(w => w + 1); }
            }}>←</button>


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
          {viewMode === "day"
            ? `${HE_DAYS[new Date(displayDays[0] + "T00:00:00").getDay()]} ${formatDateHe(displayDays[0])}`
            : `${formatDateHe(startDate)} – ${formatDateHe(workDays[5])}`}
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
        <div className="no-swipe-nav staff-schedule-scroll" style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", msOverflowStyle: "none", scrollbarWidth: "none" }}>
        {/* ══════════════════════════════════════════════════
            ONE unified grid: shifts + lessons + bookings + loans
            all share the same 80px + 6-col layout
        ══════════════════════════════════════════════════ */}
        <style>{`.staff-schedule-scroll::-webkit-scrollbar{display:none}`}</style>
        <div style={{ borderRadius: 10, border: "1px solid var(--border)", position: "relative", background: "var(--surface)", opacity: fetching ? 0.55 : 1, transition: "opacity 0.18s", minWidth: viewMode === "day" ? (showLessons ? 980 : 280) : 500, touchAction: "pan-x pan-y" }}>
          {fetching && <div style={{ position: "absolute", inset: 0, zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}><div style={{ background: "var(--surface2)", padding: "6px 16px", borderRadius: 20, fontSize: 12, color: "var(--text3)", border: "1px solid var(--border)" }}>טוען...</div></div>}
          <div style={{
            display: "grid",
            gridTemplateColumns: viewMode === "day" ? `80px repeat(${displayDays.length}, 1fr)` : `50px repeat(${displayDays.length}, 1fr)`,
            direction: "rtl",
            minWidth: viewMode === "day" ? (showLessons ? 980 : 280) : 500,
          }}>

            {/* ═══ Header Row ═══ */}
            <div style={{ background: "var(--surface2)", borderBottom: "1px solid var(--border)", borderLeft: "1px solid var(--border)" }} />
            {displayDays.map((date, i) => {
              const dayIdx = new Date(date + "T00:00:00").getDay();
              const hol = holidays.find(h => h.date === date);
              const isToday = date === today;
              return (
                <div key={date} style={{
                  padding: "6px 2px", textAlign: "center",
                  background: isToday ? "rgba(59,130,246,0.08)" : hol ? "rgba(245,158,11,0.06)" : "var(--surface2)",
                  borderBottom: "1px solid var(--border)",
                  borderLeft: i < displayDays.length - 1 ? "1px solid var(--border)" : "none",
                }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: isToday ? "#3b82f6" : "var(--text3)" }}>{HE_DAYS[dayIdx]}</div>
                  <div style={{
                    fontSize: 22, fontWeight: 800, lineHeight: 1.2,
                    color: isToday ? "#fff" : "var(--text)",
                    ...(isToday ? { background: "#3b82f6", borderRadius: "50%", width: 34, height: 34, display: "inline-flex", alignItems: "center", justifyContent: "center" } : {}),
                  }}>{new Date(date + "T00:00:00").getDate()}</div>
                  {hol && <div style={{ fontSize: 9, color: "#f59e0b", fontWeight: 600, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hol.isErev ? `ערב ${hol.name}` : hol.name}</div>}
                  {/* Daily task status dots */}
                  <div style={{ display: "flex", gap: 3, justifyContent: "center", marginTop: 3 }}>
                    {DAILY_TASKS.map(t => {
                      const task = dailyTasks.find(dt => dt.date === date && dt.task_key === t.key);
                      const assigneeName = task ? (allMembers.find(m => String(m.id) === String(task.staff_id))?.name || "משובץ") : null;
                      return (
                        <span key={t.key}
                          title={`${t.icon} ${t.label}: ${assigneeName || "לא משובץ"}`}
                          style={{ width: 7, height: 7, borderRadius: "50%", display: "inline-block", background: task ? "#22c55e" : "#ef4444", opacity: 0.85 }}
                        />
                      );
                    })}
                  </div>
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
                    padding: "4px 2px", gap: 1,
                  }}>
                    <span style={{ fontSize: 14 }}>{st.icon}</span>
                    <span style={{ fontSize: 7, color: st.color, fontWeight: 700, textAlign: "center", lineHeight: 1.2 }}>{st.label}</span>
                  </div>

                  {/* Day cells */}
                  {displayDays.map((date, i) => {
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
                          borderLeft: i < displayDays.length - 1 ? "1px solid var(--border)" : "none",
                          padding: "5px 4px",
                          minHeight: 72,
                          position: "relative",
                          cursor: dateEditable ? "pointer" : "default",
                        }}>
                        {/* Member list */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          {members.map(block => {
                            const isMe = block.memberId === String(effectiveStaffId);
                            // Staff can edit own preferences OR own unlocked assignments
                            const canEdit = isAdmin || (isMe && canStaffEditDate(date) && (block.type === "preference" || !block.locked));
                            // Lock icon: always show on locked shifts (so staff knows they can't edit)
                            const showLock = block.locked;
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
                                <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {block.memberName}
                                </span>
                                {dailyTasks.filter(dt => dt.date === date && String(dt.staff_id) === String(block.memberId)).map(dt => {
                                  const td = DAILY_TASKS.find(t => t.key === dt.task_key);
                                  return td ? <span key={dt.task_key} style={{ fontSize: 12, flexShrink: 0, lineHeight: 1 }} title={td.label}>{td.icon}</span> : null;
                                })}
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
                {displayDays.map((date, i) => {
                  const absent = allDaySlots[date]?.absent || [];
                  return (
                    <div key={date} style={{
                      background: SHIFT_TYPES.absent.bg,
                      borderTop: "1px solid var(--border)",
                      borderLeft: i < displayDays.length - 1 ? "1px solid var(--border)" : "none",
                      padding: "5px 4px",
                      minHeight: 36,
                    }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {absent.map(block => {
                          const isMe = block.memberId === String(effectiveStaffId);
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
            <SectionDivider
              title={viewMode === "day"
                ? `📚 לו"ז יומי — שיעורים`
                : `📚 לו"ז יומי — שיעורים`}
              subtitle={viewMode === "day" ? `${HE_DAYS[new Date(displayDays[0] + "T00:00:00").getDay()]} ${formatDateHe(displayDays[0])}` : null}
              open={showLessons}
              onToggle={() => setShowLessons(v => !v)}
            />

            {/* ══ Lessons body row ══ */}
            {showLessons && viewMode === "day" ? (
              <DayLessonsTable
                date={displayDays[0]}
                studioBookings={studioBookings}
                studios={studios}
                lessons={lessons}
                canEdit={canEditLessons}
                onEditSession={handleEditLessonSession}
                onDeleteSession={handleDeleteLessonSession}
                showToast={showToast}
              />
            ) : showLessons && (
              <LessonsRow workDays={displayDays} studioBookings={studioBookings} studios={studios} today={today} holidays={holidays} />
            )}

            {/* ══ Section divider: Student Bookings ══ */}
            <SectionDivider title="🎵 לו&quot;ז יומי — קביעות" open={showStudentBookings} onToggle={() => setShowStudentBookings(v => !v)} />

            {/* ══ Student Bookings body row ══ */}
            {showStudentBookings && <StudentBookingsRow workDays={displayDays} studioBookings={studioBookings} studios={studios} today={today} holidays={holidays} />}

            {/* ══ Section divider: Loans ══ */}
            <SectionDivider title="📦 בקשות השאלה" open={showLoans} onToggle={() => setShowLoans(v => !v)} />

            {/* ══ Loans body row ══ */}
            {showLoans && <LoansRow workDays={displayDays} reservations={reservations} today={today} />}

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
          dailyTasks={dailyTasks}
          allMembers={allMembers}
          onClaimTask={claimTask}
          onUnclaimTask={unclaimTask}
        />
      )}
    </div>
  );
}

/* ══════════ Section Divider — spans all 7 grid columns ══════════ */
function SectionDivider({ title, subtitle, open, onToggle }) {
  return (
    <div style={{ gridColumn: "1 / -1", borderTop: "2px solid var(--border)" }}>
      <button onClick={onToggle} style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 14px", background: open ? "rgba(255,255,255,0.04)" : "var(--surface2)",
        border: "none", cursor: "pointer", color: "var(--text)", fontWeight: 800, fontSize: 13,
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {title}
          {subtitle && <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)" }}>{subtitle}</span>}
        </span>
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

/* ── Time-of-day grouping for lessons ── */
const LESSON_PERIODS = [
  { key: "morning",  label: "🌅 בוקר",   from: "09:00", to: "13:00", color: "#f59e0b" },
  { key: "noon",     label: "☀️ צהריים", from: "13:00", to: "17:00", color: "#22c55e" },
  { key: "evening",  label: "🌙 ערב",    from: "17:00", to: "22:00", color: "#3b82f6" },
];
function lessonPeriod(startTime) {
  if (!startTime) return "evening";
  if (startTime < "13:00") return "morning";
  if (startTime < "17:00") return "noon";
  return "evening";
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
        const allLessons = bookings
          .filter(b => b.date === date && b.status !== "נדחה" && getBookingKind(b) === "lesson")
          .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));

        return (
          <div key={date} style={{ padding: "4px 3px", borderLeft: i < workDays.length - 1 ? "1px solid var(--border)" : "none", borderTop: "1px solid var(--border)", minHeight: 54 }}>
            {allLessons.map((b, j) => {
              const studio = studioMap[String(b.studioId)];
              const period = LESSON_PERIODS.find(p => p.key === lessonPeriod(b.startTime));
              return (
                <div key={b.id || j} style={{ background: "rgba(245,166,35,0.12)", border: "1px solid rgba(245,166,35,0.3)", borderRadius: 5, padding: "3px 5px", marginBottom: 3, borderRight: `2px solid ${period?.color || "#f5a623"}` }}>
                  <div style={{ fontWeight: 800, color: "#f5a623", fontSize: 10 }}>{b.startTime || ""}–{b.endTime || ""}</div>
                  <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 11, lineHeight: 1.3 }}>{b.courseName || b.studentName || "שיעור"}</div>
                  {b.instructorName && <div style={{ color: "#f5a623", fontSize: 11, fontWeight: 700 }}>👨‍🏫 {b.instructorName}</div>}
                  {b.track && <div style={{ color: "var(--text3)", fontSize: 9, fontWeight: 600 }}>📍 {b.track}</div>}
                  <div style={{ color: studio ? "var(--text2)" : "var(--text3)", fontSize: 11, fontWeight: 600, fontStyle: studio ? "normal" : "italic" }}>🏛️ {studio ? studio.name : "לא משויך"}</div>
                </div>
              );
            })}
            {allLessons.length === 0 && <div style={{ color: "var(--text3)", textAlign: "center", paddingTop: 14, fontSize: 10 }}>—</div>}
          </div>
        );
      })}
    </Fragment>
  );
}

/* ══════════ Day Lessons Table (daily view) ══════════ */
const DAY_LESSON_COLS = [
  { key: "sessionNum", label: "מספר מפגש",   initW: 80 },
  { key: "track",      label: "מסלול",       initW: 120 },
  { key: "startTime",  label: "משעה",        initW: 70 },
  { key: "endTime",    label: "עד שעה",      initW: 70 },
  { key: "course",     label: "קורס",        initW: 160 },
  { key: "topic",      label: "שם השיעור",   initW: 130 },
  { key: "instructor", label: "מרצה",        initW: 120 },
  { key: "studio",     label: "כיתת לימוד",  initW: 130 },
  { key: "endDate",    label: "תאריך סיום",  initW: 100 },
];

function DayLessonsTable({ date, studioBookings, studios, lessons, canEdit, onEditSession, onDeleteSession }) {
  const bookings = (Array.isArray(studioBookings) ? studioBookings : [])
    .filter(b => b.date === date && b.status !== "נדחה" && getBookingKind(b) === "lesson")
    .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
  const studioMap = Object.fromEntries((studios || []).map(s => [String(s.id), s]));
  const classroomStudios = (studios || []).filter(s => s.isClassroom || s.classroomOnly);

  const baseCols = canEdit ? [...DAY_LESSON_COLS, { key: "actions", label: "", initW: 50 }] : DAY_LESSON_COLS;
  const [colWidths, setColWidths] = useState(baseCols.map(c => c.initW));
  const resizingRef = useRef(null);

  useEffect(() => {
    const onMove = (e) => {
      if (!resizingRef.current) return;
      const { colIdx, startX, startWidth } = resizingRef.current;
      const delta = startX - (e.touches ? e.touches[0].clientX : e.clientX); // RTL: drag left = wider
      setColWidths(prev => prev.map((w, i) => i === colIdx ? Math.max(40, startWidth + delta) : w));
    };
    const onUp = () => { resizingRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onUp); };
  }, []);

  const startResize = (colIdx, e) => {
    e.preventDefault();
    e.stopPropagation();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    resizingRef.current = { colIdx, startX: clientX, startWidth: colWidths[colIdx] };
  };

  const [editingId, setEditingId] = useState(null);
  const [editVals, setEditVals] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);

  const startEdit = (b) => {
    if (!canEdit) return;
    setEditingId(b.id);
    const normTime = t => t ? t.slice(0, 5) : "";
    setEditVals({ startTime: normTime(b.startTime), endTime: normTime(b.endTime), studioId: b.studioId || "" });
  };
  const cancelEdit = () => { setEditingId(null); setEditVals({}); };
  const saveEdit = async (b) => {
    const ok = await onEditSession(b.lesson_id, b.date, editVals);
    if (ok !== false) { setEditingId(null); setEditVals({}); }
  };

  const getLessonEndDate = (lessonId) => {
    const lesson = (lessons || []).find(l => String(l.id) === String(lessonId));
    if (!lesson?.schedule?.length) return "";
    const dates = lesson.schedule.map(s => s.date).filter(Boolean).sort();
    return dates[dates.length - 1] || "";
  };
  const getSessionNum = (lessonId, sessionDate) => {
    const lesson = (lessons || []).find(l => String(l.id) === String(lessonId));
    if (!lesson?.schedule?.length) return null;
    const sorted = [...lesson.schedule].filter(s => s.date).sort((a, b) => a.date.localeCompare(b.date));
    const idx = sorted.findIndex(s => s.date === sessionDate);
    return idx >= 0 ? idx + 1 : null;
  };
  const getSessionTopic = (lessonId, sessionDate) => {
    const lesson = (lessons || []).find(l => String(l.id) === String(lessonId));
    if (!lesson?.schedule?.length) return "";
    const session = lesson.schedule.find(s => s.date === sessionDate);
    return session?.topic || "";
  };
  const fmtDate = (d) => { if (!d) return "—"; const [y, m, day] = d.split("-"); return `${day}/${m}/${y}`; };

  // Group bookings by time period
  const groups = LESSON_PERIODS.map(p => ({
    ...p,
    items: bookings.filter(b => lessonPeriod(b.startTime) === p.key),
  })).filter(g => g.items.length > 0);

  const borderCol = "1px solid var(--border)";
  const thBase = { padding: "8px 10px", textAlign: "right", fontWeight: 800, fontSize: 12, color: "#f5a623", borderBottom: "2px solid rgba(245,166,35,0.4)", borderLeft: borderCol, whiteSpace: "nowrap", position: "relative", overflow: "hidden" };
  const tdBase = { padding: "6px 10px", borderBottom: "1px solid var(--border)", borderLeft: borderCol, fontSize: 12, verticalAlign: "middle", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  const gridTemplate = colWidths.map(w => `${w}px`).join(" ");

  return (
    <div style={{ gridColumn: "1 / -1", padding: "8px 6px" }}>
      {bookings.length === 0 ? (
        <div style={{ textAlign: "center", color: "var(--text3)", padding: 20, fontSize: 13 }}>אין שיעורים ביום זה</div>
      ) : (
        <div style={{ direction: "rtl", background: "var(--surface2)", borderRadius: 8, overflow: "hidden", border: borderCol }}>
          {/* Header */}
          <div style={{ display: "grid", gridTemplateColumns: gridTemplate, background: "rgba(245,166,35,0.10)" }}>
            {baseCols.map((col, ci) => (
              <div key={col.key} style={{ ...thBase, borderLeft: ci === baseCols.length - 1 ? "none" : borderCol }}>
                {col.label}
                {ci < baseCols.length - (canEdit ? 1 : 0) && (
                  <div
                    onMouseDown={e => startResize(ci, e)}
                    onTouchStart={e => startResize(ci, e)}
                    style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 5, cursor: "col-resize", background: "transparent" }}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Body — grouped by time period */}
          {groups.map(group => (
            <Fragment key={group.key}>
              {/* Period header row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr", background: `${group.color}18`, borderBottom: borderCol }}>
                <div style={{ padding: "5px 14px", fontWeight: 800, fontSize: 11, color: group.color }}>
                  {group.label} ({group.items.length})
                </div>
              </div>
              {/* Lesson rows */}
              {group.items.map(b => {
                const isEditing = editingId === b.id;
                const studio = studioMap[String(b.studioId)];
                const endDate = getLessonEndDate(b.lesson_id);
                const sessionNum = getSessionNum(b.lesson_id, b.date);
                const sessionTopic = getSessionTopic(b.lesson_id, b.date);
                return (
                  <div key={b.id}
                    onClick={() => { if (!canEdit) return; if (isEditing) cancelEdit(); else startEdit(b); }}
                    style={{
                      display: "grid", gridTemplateColumns: gridTemplate,
                      background: isEditing ? "rgba(245,166,35,0.06)" : "transparent",
                      cursor: canEdit && !isEditing ? "pointer" : "default",
                    }}
                  >
                    <div style={{ ...tdBase, textAlign: "center" }}><span style={{ fontWeight: 800, color: "var(--text3)", fontSize: 11 }}>{sessionNum != null ? `#${sessionNum}` : "—"}</span></div>
                    <div style={{ ...tdBase }}><span style={{ color: "var(--text)", fontWeight: 600 }}>{b.track || "—"}</span></div>
                    <div style={{ ...tdBase }}>
                      {isEditing ? (
                        <select className="form-select" value={editVals.startTime} onClick={e => e.stopPropagation()} onChange={e => setEditVals(v => ({ ...v, startTime: e.target.value }))} style={{ fontSize: 12, padding: "2px 4px", height: 26, width: "100%" }}>
                          {editVals.startTime && !TIME_SLOTS.includes(editVals.startTime) && <option value={editVals.startTime}>{editVals.startTime}</option>}
                          {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      ) : <span style={{ fontWeight: 700 }}>{b.startTime || "—"}</span>}
                    </div>
                    <div style={{ ...tdBase }}>
                      {isEditing ? (
                        <select className="form-select" value={editVals.endTime} onClick={e => e.stopPropagation()} onChange={e => setEditVals(v => ({ ...v, endTime: e.target.value }))} style={{ fontSize: 12, padding: "2px 4px", height: 26, width: "100%" }}>
                          {editVals.endTime && !TIME_SLOTS.includes(editVals.endTime) && <option value={editVals.endTime}>{editVals.endTime}</option>}
                          {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      ) : <span style={{ fontWeight: 700 }}>{b.endTime || "—"}</span>}
                    </div>
                    <div style={{ ...tdBase }}><span style={{ fontWeight: 700, color: "var(--text)" }}>{b.courseName || "—"}</span></div>
                    <div style={{ ...tdBase }}><span style={{ color: "var(--text2)", fontStyle: sessionTopic ? "normal" : "italic" }}>{sessionTopic || "—"}</span></div>
                    <div style={{ ...tdBase }}><span style={{ color: "var(--text2)" }}>{b.instructorName || "—"}</span></div>
                    <div style={{ ...tdBase }}>
                      {isEditing ? (
                        <select className="form-select" value={editVals.studioId || ""} onClick={e => e.stopPropagation()} onChange={e => setEditVals(v => ({ ...v, studioId: e.target.value || null }))} style={{ fontSize: 12, padding: "2px 4px", height: 26, width: "100%" }}>
                          <option value="">ללא שיוך</option>
                          {classroomStudios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      ) : <span style={{ fontWeight: 600, color: studio ? "inherit" : "var(--text3)", fontStyle: studio ? "normal" : "italic" }}>{studio?.name || "לא משויך"}</span>}
                    </div>
                    <div style={{ ...tdBase }}><span style={{ color: "var(--text3)", fontSize: 11 }}>{fmtDate(endDate)}</span></div>
                    {canEdit && (
                      <div style={{ ...tdBase, borderLeft: "none", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {isEditing ? (
                          <div style={{ display: "flex", gap: 4 }} onClick={e => e.stopPropagation()}>
                            <button onClick={() => saveEdit(b)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, color: "#22c55e", padding: 2 }} title="שמור">✓</button>
                            <button onClick={cancelEdit} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, color: "#ef4444", padding: 2 }} title="בטל">✕</button>
                          </div>
                        ) : confirmDelete === b.id ? (
                          <div style={{ display: "flex", gap: 3, alignItems: "center" }} onClick={e => e.stopPropagation()}>
                            <button onClick={async () => { await onDeleteSession(b.lesson_id, b.date); setConfirmDelete(null); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#ef4444", padding: 2 }}>✓</button>
                            <button onClick={() => setConfirmDelete(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--text3)", padding: 2 }}>✕</button>
                          </div>
                        ) : (
                          <button onClick={e => { e.stopPropagation(); setConfirmDelete(b.id); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: 2 }} title="מחק">🗑️</button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      )}
    </div>
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
          <div key={date} style={{ padding: "4px 3px", borderLeft: i < workDays.length - 1 ? "1px solid var(--border)" : "none", borderTop: "1px solid var(--border)", minHeight: 54 }}>
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
      {r.status && <div style={{ fontSize: 8, fontWeight: 700, color: r.status === "מאושר" ? "#22c55e" : r.status === "ממתין" ? "#f59e0b" : "var(--text3)", marginTop: 1 }}>● {r.status}</div>}
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
          <div key={date} style={{ padding: "4px 3px", borderLeft: i < workDays.length - 1 ? "1px solid var(--border)" : "none", borderTop: "1px solid var(--border)", minHeight: 50, fontSize: 10 }}>
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
function ScheduleEditorModal({ modal, isAdmin, currentStaffId, teamMembers, onSave, onDelete, onLock, onClose, dailyTasks = [], allMembers = [], onClaimTask, onUnclaimTask }) {
  const { staffId: initStaffId, date, mode, existing, defaultShift, prefEntry, asgnEntry } = modal;
  const [staffId, setStaffId] = useState(String(initStaffId));
  const [selectedStaffIds, setSelectedStaffIds] = useState([String(initStaffId)]);
  const memberName = teamMembers.find(m => String(m.id) === staffId)?.name || "";
  const isEditingSelf = staffId === String(currentStaffId);
  const isMultiSelect = isAdmin && mode === "assignment" && !existing && selectedStaffIds.length > 0;

  const [shiftType, setShiftType] = useState(existing?.shift_type || defaultShift || "morning");
  const [startTime, setStartTime] = useState(existing?.start_time || "12:00");
  const [endTime, setEndTime] = useState(existing?.end_time || "20:00");
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
              <button key={key} onClick={() => {
                // When switching TO custom, reset to default 12:00–20:00 (unless editing existing custom)
                if (key === "custom" && shiftType !== "custom") {
                  setStartTime(existing?.start_time || "12:00");
                  setEndTime(existing?.end_time || "20:00");
                }
                setShiftType(key);
              }}
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

        {/* Lock toggle — admin assignment (always shown so new assignments can be locked immediately) */}
        {isAdmin && mode === "assignment" && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={locked} onChange={e => setLocked(e.target.checked)} />
              🔒 נעילת שיבוץ (מונע עריכה על ידי העובד)
            </label>
          </div>
        )}

        {/* ── Daily Tasks checkboxes ── */}
        {shiftType !== "absent" && selectedStaffIds.length <= 1 && (
          <div style={{ marginBottom: 14, padding: "10px 12px", background: "var(--surface2)", borderRadius: 8 }}>
            <label style={{ ...labelStyle, marginBottom: 8, fontSize: 13, color: "var(--text)" }}>📋 משימות יומיות</label>
            {DAILY_TASKS.map(t => {
              const task = dailyTasks.find(dt => dt.date === date && dt.task_key === t.key);
              const isClaimedByMe = task && String(task.staff_id) === String(staffId);
              const isClaimedByOther = task && String(task.staff_id) !== String(staffId);
              const otherName = isClaimedByOther ? (allMembers.find(m => String(m.id) === String(task.staff_id))?.name || "עובד אחר") : null;
              const canToggle = isClaimedByMe || (!isClaimedByOther) || isAdmin;

              return (
                <label key={t.key} style={{
                  display: "flex", alignItems: "center", gap: 8, fontSize: 13,
                  cursor: canToggle ? "pointer" : "not-allowed",
                  opacity: canToggle ? 1 : 0.55, marginBottom: 6,
                  padding: "4px 0",
                }}>
                  <input type="checkbox" checked={!!isClaimedByMe} disabled={!canToggle}
                    onChange={async () => {
                      if (isClaimedByMe) {
                        await onUnclaimTask(staffId, date, t.key);
                      } else {
                        await onClaimTask(staffId, date, t.key);
                      }
                    }}
                  />
                  <span>{t.icon} {t.label}</span>
                  {isClaimedByOther && (
                    <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600 }}>
                      (תפוס — {otherName})
                    </span>
                  )}
                  {isClaimedByMe && <span style={{ fontSize: 11, color: "#22c55e", fontWeight: 600 }}>✓</span>}
                </label>
              );
            })}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 20, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {existing && onDelete && (
              <button className="btn btn-secondary" style={{ color: "#ef4444", fontSize: 12 }}
                onClick={async () => { await onDelete(existing.id); onClose(); }}>🗑️ מחק</button>
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
