// ActivityLogsPage.jsx — admin activity log viewer
import { useState, useEffect } from "react";

const ACTION_LABELS = {
  login:                "🔑 כניסה למערכת",
  equipment_add:        "📦 הוספת ציוד",
  equipment_edit:       "✏️ עריכת ציוד",
  equipment_delete:     "🗑️ מחיקת ציוד",
  equipment_qty_update: "🔢 עדכון כמות ציוד",
  staff_create:         "👤 יצירת איש צוות",
  staff_update:         "✏️ עדכון איש צוות",
  staff_delete:         "🗑️ מחיקת איש צוות",
  student_add:          "🎓 הוספת סטודנט",
  student_edit:         "✏️ עריכת סטודנט",
  student_delete:       "🗑️ מחיקת סטודנט",
  reservation_approve:  "✅ אישור השאלה",
  reservation_reject:   "❌ דחיית השאלה",
  reservation_return:   "🔄 החזרת ציוד",
  reservation_delete:   "🗑️ מחיקת בקשה",
  settings_save:        "⚙️ שמירת הגדרות",
};

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ActivityLogsPage({ showToast, teamMembers = [] }) {
  const [logs, setLogs]             = useState([]);
  const [loading, setLoading]       = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionTypes, setActionTypes] = useState([]);
  const [users, setUsers]           = useState([]);
  const [filterAction, setFilterAction] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [hasMore, setHasMore]       = useState(true);

  const PAGE_SIZE = 50;

  const fetchLogs = async (offset = 0, append = false) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);
    try {
      const body = { action: "list", callerRole: "admin", limit: PAGE_SIZE, offset };
      if (filterAction) body.filterAction = filterAction;
      if (filterUser) body.filterUser = filterUser;
      const res = await fetch("/api/activity-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (append) setLogs(p => [...p, ...data]);
      else setLogs(data);
      setHasMore(data.length >= PAGE_SIZE);
    } catch { showToast?.("error", "שגיאה בטעינת יומן"); }
    finally { setLoading(false); setLoadingMore(false); }
  };

  const fetchFilters = async () => {
    try {
      const [actRes, usrRes] = await Promise.all([
        fetch("/api/activity-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "actions", callerRole: "admin" }) }),
        fetch("/api/activity-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "users", callerRole: "admin" }) }),
      ]);
      setActionTypes(await actRes.json());
      setUsers(await usrRes.json());
    } catch {}
  };

  useEffect(() => { fetchFilters(); }, []);
  useEffect(() => { fetchLogs(0); }, [filterAction, filterUser]);

  return (
    <div className="page">
      {/* Filters */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20, alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)" }}>סוג פעולה</label>
          <select className="form-select" value={filterAction} onChange={e => setFilterAction(e.target.value)}
            style={{ minWidth: 180, padding: "6px 10px", fontSize: 13 }}>
            <option value="">הכל</option>
            {actionTypes.map(a => (
              <option key={a} value={a}>{ACTION_LABELS[a] || a}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)" }}>עובד</label>
          <select className="form-select" value={filterUser} onChange={e => setFilterUser(e.target.value)}
            style={{ minWidth: 180, padding: "6px 10px", fontSize: 13 }}>
            <option value="">כל העובדים</option>
            {users.filter(u => teamMembers.length === 0 || teamMembers.some(m => String(m.id) === String(u.id))).map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, color: "var(--text3)", alignSelf: "flex-end", paddingBottom: 4 }}>
          {logs.length} רשומות
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text3)" }}>טוען...</div>
      ) : logs.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text3)", background: "var(--surface2)", borderRadius: "var(--r)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
          אין רשומות ביומן הפעילות
        </div>
      ) : (
        <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--surface2)", borderBottom: "1px solid var(--border)" }}>
                  <th style={thStyle}>תאריך ושעה</th>
                  <th style={thStyle}>עובד</th>
                  <th style={thStyle}>פעולה</th>
                  <th style={thStyle}>ישות</th>
                  <th style={thStyle}>פרטים</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, i) => (
                  <tr key={log.id || i} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "var(--surface)" : "var(--surface2)" }}>
                    <td style={tdStyle}>
                      <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text2)" }}>{formatDate(log.created_at)}</span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 700 }}>{log.user_name || "—"}</span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        display: "inline-block", padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                        background: actionColor(log.action).bg, color: actionColor(log.action).fg,
                        border: `1px solid ${actionColor(log.action).border}`,
                      }}>
                        {ACTION_LABELS[log.action] || log.action}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 12, color: "var(--text2)" }}>{log.entity || ""}{log.entity_id ? ` #${log.entity_id}` : ""}</span>
                    </td>
                    <td style={tdStyle}>
                      <DetailsCell details={log.details} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Load more */}
      {hasMore && logs.length > 0 && !loading && (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button className="btn btn-secondary" disabled={loadingMore} onClick={() => fetchLogs(logs.length, true)}>
            {loadingMore ? "⏳ טוען..." : "טען עוד"}
          </button>
        </div>
      )}
    </div>
  );
}

function DetailsCell({ details }) {
  if (!details || typeof details !== "object" || Object.keys(details).length === 0) return <span style={{ color: "var(--text3)" }}>—</span>;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {Object.entries(details).map(([k, v]) => (
        <span key={k} style={{ fontSize: 11, background: "var(--surface3)", border: "1px solid var(--border)", borderRadius: 6, padding: "1px 6px", color: "var(--text2)" }}>
          {k}: {typeof v === "object" ? JSON.stringify(v) : String(v)}
        </span>
      ))}
    </div>
  );
}

function actionColor(action) {
  if (action === "login") return { bg: "rgba(52,152,219,0.12)", fg: "#3498db", border: "rgba(52,152,219,0.3)" };
  if (action?.includes("delete") || action?.includes("reject")) return { bg: "rgba(231,76,60,0.12)", fg: "#e74c3c", border: "rgba(231,76,60,0.3)" };
  if (action?.includes("add") || action?.includes("create") || action?.includes("approve")) return { bg: "rgba(46,204,113,0.12)", fg: "#2ecc71", border: "rgba(46,204,113,0.3)" };
  if (action?.includes("edit") || action?.includes("update") || action?.includes("save")) return { bg: "rgba(241,196,15,0.12)", fg: "#f1c40f", border: "rgba(241,196,15,0.3)" };
  return { bg: "var(--surface3)", fg: "var(--text2)", border: "var(--border)" };
}

const thStyle = { padding: "10px 14px", textAlign: "right", fontWeight: 800, fontSize: 12, color: "var(--text2)", whiteSpace: "nowrap" };
const tdStyle = { padding: "10px 14px", verticalAlign: "middle" };
