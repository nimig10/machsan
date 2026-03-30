import { useState, useEffect } from "react";
import { Modal } from "./ui.jsx";

export function StaffManagementPage({ showToast }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editUser, setEditUser] = useState(null); // null = closed, {} = new, {id,...} = editing
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const callerRole = "admin";

  const fetchStaff = async () => {
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", callerRole }),
      });
      if (res.ok) setStaff(await res.json());
    } catch (e) {
      console.error("Failed to load staff:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStaff(); }, []);

  const handleSave = async () => {
    if (!editUser) return;
    const { id, full_name, email, role, password } = editUser;
    if (!full_name?.trim() || !email?.trim()) {
      showToast?.("error", "שם ואימייל הם שדות חובה");
      return;
    }
    if (!id && !password?.trim()) {
      showToast?.("error", "יש להזין סיסמה למשתמש חדש");
      return;
    }
    setSaving(true);
    try {
      const action = id ? "update" : "create";
      const body = { action, callerRole, full_name: full_name.trim(), email: email.trim(), role: role || "staff" };
      if (id) body.id = id;
      if (password?.trim()) body.password = password.trim();
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        showToast?.("success", id ? "המשתמש עודכן" : "המשתמש נוצר בהצלחה");
        setEditUser(null);
        fetchStaff();
      } else {
        showToast?.("error", data.error || "שגיאה בשמירה");
      }
    } catch (e) {
      showToast?.("error", "שגיאת רשת");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", callerRole, id }),
      });
      if (res.ok) {
        showToast?.("success", "המשתמש נמחק");
        fetchStaff();
      } else {
        showToast?.("error", "שגיאה במחיקה");
      }
    } catch {
      showToast?.("error", "שגיאת רשת");
    } finally {
      setDeleting(null);
    }
  };

  const roleName = (r) => r === "admin" ? "מנהל" : "צוות";

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "var(--text3)" }}>טוען רשימת צוות...</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>👥 ניהול צוות</h2>
        <button className="btn btn-primary" onClick={() => setEditUser({ full_name: "", email: "", role: "staff", password: "" })}>
          + הוסף איש צוות
        </button>
      </div>

      {staff.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text3)", background: "var(--surface2)", borderRadius: "var(--r)", border: "1px solid var(--border)" }}>
          אין אנשי צוות רשומים עדיין
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {staff.map(s => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: s.role === "admin" ? "rgba(239,68,68,0.12)" : "rgba(59,130,246,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
                {s.role === "admin" ? "👑" : "👤"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{s.full_name}</div>
                <div style={{ fontSize: 12, color: "var(--text3)" }}>{s.email} · {roleName(s.role)}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setEditUser({ ...s, password: "" })}>✏️</button>
                <button className="btn btn-secondary btn-sm" style={{ color: "#ef4444" }}
                  disabled={deleting === s.id}
                  onClick={() => { if (confirm(`למחוק את ${s.full_name}?`)) handleDelete(s.id); }}>
                  {deleting === s.id ? "..." : "🗑️"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editUser && (
        <Modal title={editUser.id ? "עריכת איש צוות" : "הוספת איש צוות"} onClose={() => setEditUser(null)} footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn-secondary" onClick={() => setEditUser(null)}>ביטול</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? "שומר..." : editUser.id ? "עדכן" : "צור משתמש"}
            </button>
          </div>
        }>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="form-group">
              <label className="form-label">שם מלא *</label>
              <input className="form-input" value={editUser.full_name || ""} onChange={e => setEditUser(p => ({ ...p, full_name: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">אימייל *</label>
              <input className="form-input" type="email" dir="ltr" value={editUser.email || ""} onChange={e => setEditUser(p => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">תפקיד</label>
              <select className="form-select" value={editUser.role || "staff"} onChange={e => setEditUser(p => ({ ...p, role: e.target.value }))}>
                <option value="staff">צוות</option>
                <option value="admin">מנהל (Admin)</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{editUser.id ? "סיסמה חדשה (השאר ריק לשמור קיימת)" : "סיסמה *"}</label>
              <input className="form-input" type="password" dir="ltr" value={editUser.password || ""} onChange={e => setEditUser(p => ({ ...p, password: e.target.value }))} placeholder={editUser.id ? "••••••" : ""} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
