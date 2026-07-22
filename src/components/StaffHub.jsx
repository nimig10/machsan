import { useState, useEffect } from "react";
import { BookOpen, Calendar, ChevronDown, ChevronUp, ClipboardList, Download, GraduationCap, Home, LayoutDashboard, ListTodo, LogOut, Package, Plus, Settings, Trash2, Users } from "lucide-react";
import { getAuthToken } from "../utils.js";

// Fixed daily-task labels (mirror of DAILY_TASKS in StaffSchedulePage — cheaper
// than exporting from that large module).
const DAILY_TASK_LABELS = {
  open:  { label: "פתיחת מכללה", icon: "☀️" },
  prep:  { label: "הכנת כיתות",  icon: "🏫" },
  close: { label: "סגירת מכללה", icon: "🌙" },
};

// POST to /api/staff-schedule with the staff bearer token (mirror of scheduleApi).
async function hubApi(action, body = {}) {
  const token = await getAuthToken();
  const res = await fetch("/api/staff-schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, ...body }),
  });
  return res.json();
}

// "משימות להיום" — collapsible bottom-right panel showing the logged-in staff
// member's daily tasks, manager/own notes, and free-text personal tasks for TODAY.
function TodayTasksPanel({ myToday, refreshMyToday }) {
  // Data is loaded app-level (App.jsx) and passed in as `myToday` → instant on
  // navigation, no per-mount client fetch. Local mirror allows optimistic edits.
  const [today, setToday] = useState(myToday); // { dailyTasks, managerNote, myNote, personalTasks, loanHandling }
  useEffect(() => { setToday(myToday); }, [myToday]);
  const [panelOpen, setPanelOpen] = useState(() => {
    try {
      const saved = sessionStorage.getItem("hub_today_open");
      if (saved !== null) return saved !== "0";
      return !window.matchMedia("(max-width: 640px)").matches; // open on desktop, collapsed on phones
    } catch { return true; }
  });
  const [newTask, setNewTask] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { try { sessionStorage.setItem("hub_today_open", panelOpen ? "1" : "0"); } catch { /* ignore */ } }, [panelOpen]);

  const addTask = async () => {
    const text = newTask.trim();
    if (!text || busy) return;
    setBusy(true);
    const r = await hubApi("add-personal-task", { text });
    setBusy(false);
    if (r?.ok && r.data) {
      setNewTask("");
      setToday(t => ({ ...t, personalTasks: [...(t?.personalTasks || []), { id: r.data.id, text: r.data.text, done: r.data.done }] }));
    }
  };
  // Purely optimistic — no re-fetch on success (that was the checkbox lag). We only
  // reconcile with the server on failure.
  const toggleTask = async (id, done) => {
    setToday(t => ({ ...t, personalTasks: (t?.personalTasks || []).map(p => p.id === id ? { ...p, done } : p) }));
    const r = await hubApi("toggle-personal-task", { id, done });
    if (!r?.ok) void refreshMyToday?.();
  };
  const deleteTask = async (id) => {
    setToday(t => ({ ...t, personalTasks: (t?.personalTasks || []).filter(p => p.id !== id) }));
    const r = await hubApi("delete-personal-task", { id });
    if (!r?.ok) void refreshMyToday?.();
  };
  // Personal tracking checkbox on each loan-handling request (persisted).
  const toggleLoan = async (assignmentId, done) => {
    setToday(t => ({ ...t, loanHandling: (t?.loanHandling || []).map(l => l.assignmentId === assignmentId ? { ...l, done } : l) }));
    const r = await hubApi("toggle-loan-handled", { id: assignmentId, done });
    if (!r?.ok) void refreshMyToday?.();
  };
  // Check-off for daily tasks + manager/own notes (persisted via staff_hub_checkoffs).
  const toggleCheckoff = async (itemType, itemRef, done) => {
    setToday(t => {
      if (!t) return t;
      if (itemType === "daily") return { ...t, dailyTasks: (t.dailyTasks || []).map(x => x.key === itemRef ? { ...x, done } : x) };
      if (itemType === "manager_note") return { ...t, managerNote: t.managerNote ? { ...t.managerNote, done } : t.managerNote };
      if (itemType === "my_note") return { ...t, myNote: t.myNote ? { ...t.myNote, done } : t.myNote };
      return t;
    });
    const r = await hubApi("set-checkoff", { itemType, itemRef, done });
    if (!r?.ok) void refreshMyToday?.();
  };

  const isEmpty = today && !today.dailyTasks?.length && !today.managerNote && !today.myNote && !today.personalTasks?.length && !today.loanHandling?.length;
  // Count of open (undone) items — shown as a badge so a collapsed panel (the
  // mobile default) still signals there's work left.
  const openCount =
    (today?.dailyTasks?.filter(x => !x.done).length || 0) +
    (today?.loanHandling?.filter(l => !l.done).length || 0) +
    (today?.personalTasks?.filter(p => !p.done).length || 0) +
    (today?.managerNote && !today.managerNote.done ? 1 : 0) +
    (today?.myNote && !today.myNote.done ? 1 : 0);

  return (
    <div style={{
      // fixed → stays in the viewport corner while scrolling; safe-area insets keep
      // it clear of the PWA home-indicator / notch in standalone mode.
      position: "fixed",
      bottom: "calc(16px + env(safe-area-inset-bottom))",
      right: "calc(16px + env(safe-area-inset-right))",
      width: "min(340px, calc(100vw - 32px))", maxHeight: "min(75dvh, 620px)",
      display: "flex", flexDirection: "column",
      border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)",
      boxShadow: "0 12px 40px rgba(0,0,0,0.28)", overflow: "hidden", zIndex: 60,
    }}>
      <button type="button" onClick={() => setPanelOpen(o => !o)}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", border: "none", background: "transparent", cursor: "pointer", width: "100%" }}>
        <ListTodo size={18} strokeWidth={1.75} color="var(--accent)" />
        <span style={{ fontWeight: 800, fontSize: 15, color: "var(--text)" }}>משימות להיום</span>
        {openCount > 0 && (
          <span style={{ background: "var(--accent)", color: "#0a0c10", fontSize: 11, fontWeight: 800, borderRadius: 10, padding: "1px 7px", minWidth: 18, textAlign: "center" }}>{openCount}</span>
        )}
        <span style={{ marginInlineStart: "auto", color: "var(--text3)", display: "flex" }}>
          {panelOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </span>
      </button>

      {panelOpen && (
        <div style={{ padding: "0 14px 14px", overflowY: "auto", WebkitOverflowScrolling: "touch", display: "flex", flexDirection: "column", gap: 12 }}>
          {!today && <div style={{ fontSize: 13, color: "var(--text3)" }}>טוען…</div>}
          {isEmpty && <div style={{ fontSize: 14, color: "var(--text3)", padding: "8px 0" }}>אין משימות היום</div>}

          {today?.dailyTasks?.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 6 }}>משמרת היום</div>
              {today.dailyTasks.map(d => (
                <div key={d.key} style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <input type="checkbox" checked={!!d.done} onChange={e => toggleCheckoff("daily", d.key, e.target.checked)} style={{ cursor: "pointer", flexShrink: 0, width: 18, height: 18 }} />
                  <span style={{ flex: 1, minWidth: 0, color: d.done ? "var(--text3)" : "var(--text)", textDecoration: d.done ? "line-through" : "none" }}>{DAILY_TASK_LABELS[d.key]?.icon || "•"} {DAILY_TASK_LABELS[d.key]?.label || d.key}</span>
                </div>
              ))}
            </div>
          )}

          {/* Equipment-loan requests this staff member handles today (out/return + time) */}
          {today?.loanHandling?.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 2 }}>בקשות השאלה שלי</div>
              <div style={{ fontSize: 10.5, color: "var(--text3)", marginBottom: 6, lineHeight: 1.3 }}>
                סימון אישי בלבד — <b>אינו מבצע החזרה במערכת</b>. להחזרת ציוד יש ללחוץ "הוחזר" בבקשה עצמה (תפעול מחסן ← בקשות).
              </div>
              {today.loanHandling.map(l => (
                <div key={l.assignmentId || (l.reservationId + l.kind)} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 4 }}>
                  <input type="checkbox" checked={!!l.done} onChange={e => toggleLoan(l.assignmentId, e.target.checked)} style={{ cursor: "pointer", flexShrink: 0, width: 18, height: 18 }} />
                  <span style={{ fontSize: 11, fontWeight: 800, borderRadius: 6, padding: "1px 6px", flexShrink: 0, whiteSpace: "nowrap", opacity: l.done ? 0.5 : 1,
                    background: l.kind === "out" ? "rgba(46,204,113,0.15)" : "rgba(52,152,219,0.15)",
                    color: l.kind === "out" ? "#2ecc71" : "#3b98e0" }}>
                    {l.kind === "out" ? "הוצאה" : "החזרה"}{l.time ? ` ${l.time}` : ""}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, wordBreak: "break-word", color: l.done ? "var(--text3)" : "var(--text)", textDecoration: l.done ? "line-through" : "none" }}>{l.studentName}{l.loanType ? ` · ${l.loanType}` : ""}</span>
                </div>
              ))}
            </div>
          )}

          {today?.managerNote && (
            <div style={{ background: "rgba(245,166,35,0.10)", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <input type="checkbox" checked={!!today.managerNote.done} onChange={e => toggleCheckoff("manager_note", "note", e.target.checked)} style={{ cursor: "pointer", flexShrink: 0, width: 16, height: 16 }} />
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)" }}>הערת מנהל</div>
              </div>
              <div style={{ fontSize: 13, whiteSpace: "pre-wrap", color: today.managerNote.done ? "var(--text3)" : "var(--text)", textDecoration: today.managerNote.done ? "line-through" : "none" }}>{today.managerNote.text}</div>
            </div>
          )}

          {today?.myNote && (
            <div style={{ background: "rgba(14,165,233,0.10)", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <input type="checkbox" checked={!!today.myNote.done} onChange={e => toggleCheckoff("my_note", "note", e.target.checked)} style={{ cursor: "pointer", flexShrink: 0, width: 16, height: 16 }} />
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)" }}>ההערה שלי</div>
              </div>
              <div style={{ fontSize: 13, whiteSpace: "pre-wrap", color: today.myNote.done ? "var(--text3)" : "var(--text)", textDecoration: today.myNote.done ? "line-through" : "none" }}>{today.myNote.text}</div>
            </div>
          )}

          {today?.personalTasks?.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {today.personalTasks.map(p => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={p.done} onChange={e => toggleTask(p.id, e.target.checked)} style={{ cursor: "pointer", flexShrink: 0, width: 18, height: 18 }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: p.done ? "var(--text3)" : "var(--text)", textDecoration: p.done ? "line-through" : "none", wordBreak: "break-word" }}>{p.text}</span>
                  <button type="button" onClick={() => deleteTask(p.id)} title="מחק" style={{ border: "none", background: "transparent", cursor: "pointer", color: "#ef4444", flexShrink: 0, display: "flex", padding: 6, borderRadius: 6 }}>
                    <Trash2 size={16} strokeWidth={1.75} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 6 }}>
            <input value={newTask} onChange={e => setNewTask(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") addTask(); }} maxLength={150} placeholder="הוסף משימה…"
              style={{ flex: 1, minWidth: 0, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)", fontSize: 16 }} />
            <button type="button" onClick={addTask} disabled={busy || !newTask.trim()} title="הוסף"
              style={{ border: "none", borderRadius: 8, background: "var(--accent)", color: "#0a0c10", padding: "0 12px", cursor: busy || !newTask.trim() ? "default" : "pointer", opacity: busy || !newTask.trim() ? 0.5 : 1, display: "flex", alignItems: "center" }}>
              <Plus size={18} strokeWidth={2} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function StaffHub({ user, logo, myToday, refreshMyToday, onNavigate, onLogout, canInstall = false, onInstall = () => {} }) {
  const [hovered, setHovered] = useState(null);

  const allowedViews = user?.role === "admin" ? [] : (user?.permissions?.views || []);

  const allOptions = [
    { key: "warehouse",       icon: <Package size={40} strokeWidth={1.5} />, title: "תפעול מחסן",     desc: "ניהול ציוד, הזמנות, קיטים והסמכות",              color: "#3b82f6" },
    { key: "administration",  icon: <ClipboardList size={40} strokeWidth={1.5} />, title: "אדמיניסטרציה",   desc: "ניהול סטודנטים, אולפנים, שיעורים ודוחות",        color: "#8b5cf6" },
    { key: "staff-schedule",  icon: <Calendar size={40} strokeWidth={1.5} />, title: 'לו"ז עובדים',   desc: "הגשת העדפות, צפייה בשיבוצים ומשמרות",            color: "#0ea5e9" },
  ];

  const options = allOptions.filter(o => o.key === "staff-schedule" || !allowedViews.length || allowedViews.includes(o.key));

  const handleInstallClick = () => {
    if (!canInstall) return;
    void onInstall();
  };

  return (
    <div style={{ minHeight: "100dvh", padding: 24, background: "var(--bg)", position: "relative" }}>
      {canInstall && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) && (
        <button
          type="button"
          onClick={handleInstallClick}
          style={{
            position: "absolute",
            top: 24,
            right: 24,
            padding: "10px 18px",
            border: "1px solid rgba(245,166,35,0.35)",
            borderRadius: 10,
            background: "var(--accent)",
            color: "#0a0c10",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            gap: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          }}
        >
          <Download size={16} strokeWidth={1.75} />
          <span>Install App</span>
        </button>
      )}

      <div style={{ width: "100%", maxWidth: 960, minHeight: "calc(100dvh - 48px)", margin: "0 auto", display: "flex", flexDirection: "column" }}>
        <div style={{ minHeight: 52, width: "100%", marginBottom: 16 }}>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <div style={{ marginBottom: 12 }}>
              {logo
                ? <img src={logo} alt="לוגו" style={{ height: 80, maxWidth: 200, objectFit: "contain" }} />
                : <Home size={48} strokeWidth={1.5} color="var(--text3)" />
              }
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 900, color: "var(--text)", margin: 0 }}>Staff Hub</h1>
            <div style={{ fontSize: 15, color: "var(--text2)", marginTop: 8 }}>
              שלום, <strong>{user?.full_name || "צוות"}</strong>
              {user?.role === "admin" && <span style={{ marginRight: 8, background: "rgba(239,68,68,0.12)", color: "#ef4444", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>Admin</span>}
            </div>
          </div>

          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", justifyContent: "center", maxWidth: 600, width: "100%" }}>
            {options.map(opt => (
              <button
                key={opt.key}
                onClick={() => onNavigate(opt.key)}
                onMouseEnter={() => setHovered(opt.key)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  flex: "1 1 240px",
                  maxWidth: 280,
                  minHeight: 180,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                  padding: 24,
                  border: `2px solid ${hovered === opt.key ? opt.color : "var(--border)"}`,
                  borderRadius: 16,
                  background: hovered === opt.key ? `${opt.color}10` : "var(--surface)",
                  cursor: "pointer",
                  transition: "all 0.2s",
                  transform: hovered === opt.key ? "translateY(-2px)" : "none",
                  boxShadow: hovered === opt.key ? `0 8px 24px ${opt.color}20` : "0 2px 8px rgba(0,0,0,0.06)",
                }}
              >
                <span style={{ fontSize: 48, color: "var(--text)" }}>{opt.icon}</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: "var(--text)" }}>{opt.title}</span>
                <span style={{ fontSize: 13, color: "var(--text3)", textAlign: "center" }}>{opt.desc}</span>
              </button>
            ))}
          </div>

          {user?.role === "admin" && (
            <div style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
              {[
                { key: "staff-management", icon: <Users size={20} strokeWidth={1.75} />, label: "ניהול צוות",     color: "#22c55e" },
                { key: "system-settings",  icon: <Settings size={20} strokeWidth={1.75} />, label: "הגדרות מערכת",  color: "#f5a623" },
                { key: "activity-logs",    icon: <LayoutDashboard size={20} strokeWidth={1.75} />, label: "יומן פעילות",    color: "#3b82f6" },
              ].map(btn => (
                <button
                  key={btn.key}
                  onClick={() => onNavigate(btn.key)}
                  onMouseEnter={() => setHovered(btn.key)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    padding: "10px 24px",
                    border: `1.5px solid ${hovered === btn.key ? btn.color : "var(--border)"}`,
                    borderRadius: 10,
                    background: hovered === btn.key ? `${btn.color}12` : "var(--surface)",
                    cursor: "pointer",
                    fontSize: 14,
                    color: hovered === btn.key ? btn.color : "var(--text2)",
                    fontWeight: hovered === btn.key ? 700 : 400,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    transition: "all 0.2s",
                    transform: hovered === btn.key ? "translateY(-2px)" : "none",
                    boxShadow: hovered === btn.key ? `0 6px 18px ${btn.color}25` : "none",
                  }}
                >
                  <span style={{ color: hovered === btn.key ? btn.color : "var(--text)" }}>{btn.icon}</span> {btn.label}
                </button>
              ))}
            </div>
          )}

          {(user?.is_student || user?.is_lecturer) && (
            <div style={{ marginTop: 32, display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
              {user.is_student && (
                <button
                  onClick={() => { sessionStorage.setItem("active_role", "student"); sessionStorage.removeItem("staff_user"); sessionStorage.removeItem("staff_view"); window.location.assign("/"); }}
                  onMouseEnter={() => setHovered("switch-student")}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    padding: "8px 20px",
                    border: "1.5px solid #f5a623",
                    borderRadius: 8,
                    background: "#f5a623",
                    color: "#0a0c10",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 800,
                    transition: "all 0.2s",
                    display: "inline-flex", alignItems: "center", gap: 6,
                    opacity: hovered === "switch-student" ? 0.9 : 1,
                    transform: hovered === "switch-student" ? "translateY(-1px)" : "none",
                    boxShadow: hovered === "switch-student" ? "0 6px 18px rgba(245,166,35,0.35)" : "none",
                  }}
                >
                  <GraduationCap size={16} strokeWidth={1.75} /> מעבר לתצוגת סטודנט
                </button>
              )}
              {user.is_lecturer && (
                <button
                  onClick={() => { sessionStorage.setItem("active_role", "lecturer"); sessionStorage.removeItem("staff_user"); sessionStorage.removeItem("staff_view"); window.location.assign("/"); }}
                  onMouseEnter={() => setHovered("switch-lecturer")}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    padding: "8px 20px",
                    border: "1.5px solid #f5a623",
                    borderRadius: 8,
                    background: "#f5a623",
                    color: "#0a0c10",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 800,
                    transition: "all 0.2s",
                    display: "inline-flex", alignItems: "center", gap: 6,
                    opacity: hovered === "switch-lecturer" ? 0.9 : 1,
                    transform: hovered === "switch-lecturer" ? "translateY(-1px)" : "none",
                    boxShadow: hovered === "switch-lecturer" ? "0 6px 18px rgba(245,166,35,0.35)" : "none",
                  }}
                >
                  <BookOpen size={16} strokeWidth={1.75} /> מעבר לתצוגת מרצה
                </button>
              )}
            </div>
          )}

          <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => onNavigate("user-guide")}
              onMouseEnter={() => setHovered("user-guide")}
              onMouseLeave={() => setHovered(null)}
              style={{
                padding: "10px 24px",
                border: `1.5px solid ${hovered === "user-guide" ? "var(--accent)" : "var(--border)"}`,
                borderRadius: 10,
                background: hovered === "user-guide" ? "rgba(245,166,35,0.12)" : "var(--surface)",
                color: hovered === "user-guide" ? "var(--accent)" : "var(--text2)",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: hovered === "user-guide" ? 700 : 400,
                display: "flex",
                alignItems: "center",
                gap: 8,
                transition: "all 0.2s",
                transform: hovered === "user-guide" ? "translateY(-2px)" : "none",
                boxShadow: hovered === "user-guide" ? "0 6px 18px rgba(245,166,35,0.25)" : "none",
              }}
            >
              <BookOpen size={20} strokeWidth={1.75} /> המדריך למשתמש
            </button>
          </div>

          <button
            onClick={onLogout}
            style={{
              marginTop: 16,
              padding: "8px 20px",
              border: "none",
              borderRadius: 8,
              background: "rgba(239,68,68,0.1)",
              color: "#ef4444",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <LogOut size={16} strokeWidth={1.75} /> התנתק
          </button>
        </div>
      </div>

      {/* ── משימות להיום — collapsible bottom-right panel ── */}
      <TodayTasksPanel myToday={myToday} refreshMyToday={refreshMyToday} />
    </div>
  );
}
