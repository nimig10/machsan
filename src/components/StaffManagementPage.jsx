import { useState, useEffect } from "react";
import { Modal } from "./ui.jsx";

const WAREHOUSE_SECTIONS = [
  { id: "reservations", label: "📋 בקשות" },
  { id: "equipment",    label: "📦 ציוד" },
  { id: "certifications", label: "🎓 הסמכת ציוד" },
  { id: "kits",         label: "🎒 ערכות" },
  { id: "policies",     label: "📋 נהלים" },
  { id: "settings",     label: "⚙️ הגדרות" },
];

const ADMINISTRATION_SECTIONS = [
  { id: "studios",                label: "🎙️ ניהול חדרים" },
  { id: "studio-certifications",  label: "🎓 הסמכת אולפן" },
  { id: "lessons",                label: "📽️ שיעורים" },
  { id: "students",               label: "👨‍🎓 סטודנטים" },
  { id: "policies",               label: "📋 נהלים" },
  { id: "settings",               label: "⚙️ הגדרות" },
];

const LOAN_TYPES = ["פרטית", "הפקה", "סאונד", "קולנוע יומית", "שיעור"];

const DEFAULT_PERMISSIONS = {
  views: [],
  warehouseSections: [],
  administrationSections: [],
  notifyLoanTypes: [],
};

function mergePerms(p) {
  return { ...DEFAULT_PERMISSIONS, ...(p || {}) };
}

function CheckRow({ label, checked, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "4px 0", fontSize: 13 }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ width: 15, height: 15, accentColor: "var(--accent)", cursor: "pointer" }} />
      {label}
    </label>
  );
}

function toggleArr(arr, val) {
  return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];
}

export function StaffManagementPage({ showToast }) {
  const [staff, setStaff]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [editUser, setEditUser] = useState(null);
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(null);

  const fetchStaff = async () => {
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", callerRole: "admin" }),
      });
      if (res.ok) setStaff(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchStaff(); }, []);

  const openNew = () => setEditUser({
    full_name: "", email: "", role: "staff", password: "",
    permissions: { ...DEFAULT_PERMISSIONS },
  });

  const openEdit = (s) => setEditUser({
    ...s,
    password: "",
    permissions: mergePerms(s.permissions),
  });

  const setPerms = (patch) => setEditUser(p => ({ ...p, permissions: { ...p.permissions, ...patch } }));

  const handleSave = async () => {
    if (!editUser) return;
    const { id, full_name, email, role, password, permissions } = editUser;
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
      const body = {
        action: id ? "update" : "create",
        callerRole: "admin",
        full_name: full_name.trim(),
        email: email.trim(),
        role: role || "staff",
        permissions,
      };
      if (id) body.id = id;
      if (password?.trim()) body.password = password.trim();
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        showToast?.("success", id ? "המשתמש עודכן" : "המשתמש נוצר");
        setEditUser(null);
        fetchStaff();
      } else {
        showToast?.("error", data.error || "שגיאה בשמירה");
      }
    } catch { showToast?.("error", "שגיאת רשת"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", callerRole: "admin", id }),
      });
      if (res.ok) { showToast?.("success", "המשתמש נמחק"); fetchStaff(); }
      else showToast?.("error", "שגיאה במחיקה");
    } catch { showToast?.("error", "שגיאת רשת"); }
    finally { setDeleting(null); }
  };

  const accessSummary = (s) => {
    const p = mergePerms(s.permissions);
    if (s.role === "admin") return "גישה מלאה (Admin)";
    const v = p.views;
    if (!v.length) return "גישה מלאה";
    const names = { warehouse: "מחסן", administration: "אדמיניסטרציה" };
    return v.map(x => names[x] || x).join(" + ");
  };

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "var(--text3)" }}>טוען...</div>;

  const perms = editUser?.permissions || DEFAULT_PERMISSIONS;
  const allWarehouseAllowed = !perms.views.length || perms.views.includes("warehouse");
  const allAdminAllowed     = !perms.views.length || perms.views.includes("administration");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>👥 ניהול צוות</h2>
        <button className="btn btn-primary" onClick={openNew}>+ הוסף איש צוות</button>
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
                <div style={{ fontSize: 12, color: "var(--text3)" }}>{s.email}</div>
                <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 2 }}>{accessSummary(s)}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => openEdit(s)}>✏️ ערוך</button>
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
        <Modal
          size="modal-lg"
          title={editUser.id ? `✏️ עריכת ${editUser.full_name || "איש צוות"}` : "➕ הוספת איש צוות"}
          onClose={() => setEditUser(null)}
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" onClick={() => setEditUser(null)}>ביטול</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? "שומר..." : editUser.id ? "שמור שינויים" : "צור משתמש"}
              </button>
            </div>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

            {/* ── פרטים בסיסיים ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
                <label className="form-label">{editUser.id ? "סיסמה חדשה (השאר ריק)" : "סיסמה *"}</label>
                <input className="form-input" type="password" dir="ltr" value={editUser.password || ""} onChange={e => setEditUser(p => ({ ...p, password: e.target.value }))} placeholder={editUser.id ? "••••••" : ""} />
              </div>
            </div>

            {/* ── הגבלת גישה (רק ל-staff) ── */}
            {editUser.role !== "admin" && (
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
                <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 12 }}>🔒 הגבלת גישה</div>

                {/* top-level views */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}>גישה לאזורים (ריק = גישה לכל)</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {[{ id: "warehouse", label: "📦 תפעול מחסן" }, { id: "administration", label: "📋 אדמיניסטרציה" }].map(v => (
                      <label key={v.id} style={{
                        display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "7px 14px",
                        borderRadius: 8, border: `1px solid ${perms.views.includes(v.id) ? "var(--accent)" : "var(--border)"}`,
                        background: perms.views.includes(v.id) ? "rgba(245,166,35,0.1)" : "transparent",
                        fontSize: 13, fontWeight: 600,
                      }}>
                        <input type="checkbox" style={{ accentColor: "var(--accent)" }}
                          checked={perms.views.includes(v.id)}
                          onChange={() => setPerms({ views: toggleArr(perms.views, v.id) })} />
                        {v.label}
                      </label>
                    ))}
                  </div>
                </div>

                {/* warehouse sections */}
                {(allWarehouseAllowed || perms.views.includes("warehouse")) && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}>
                      רובריקות מחסן פעילות (ריק = הכל)
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                      {WAREHOUSE_SECTIONS.map(sec => (
                        <CheckRow key={sec.id} label={sec.label}
                          checked={!perms.warehouseSections.length || perms.warehouseSections.includes(sec.id)}
                          onChange={checked => {
                            const current = perms.warehouseSections.length
                              ? perms.warehouseSections
                              : WAREHOUSE_SECTIONS.map(s => s.id);
                            setPerms({ warehouseSections: checked ? [...current, sec.id].filter((v,i,a)=>a.indexOf(v)===i) : current.filter(x => x !== sec.id) });
                          }}
                        />
                      ))}
                    </div>
                    {perms.warehouseSections.length > 0 && perms.warehouseSections.length < WAREHOUSE_SECTIONS.length && (
                      <button style={{ fontSize: 11, color: "var(--text3)", background: "none", border: "none", cursor: "pointer", marginTop: 4, padding: 0 }}
                        onClick={() => setPerms({ warehouseSections: [] })}>
                        אפס לגישה מלאה
                      </button>
                    )}
                  </div>
                )}

                {/* administration sections */}
                {(allAdminAllowed || perms.views.includes("administration")) && (
                  <div>
                    <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}>
                      רובריקות אדמיניסטרציה פעילות (ריק = הכל)
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                      {ADMINISTRATION_SECTIONS.map(sec => (
                        <CheckRow key={sec.id} label={sec.label}
                          checked={!perms.administrationSections.length || perms.administrationSections.includes(sec.id)}
                          onChange={checked => {
                            const current = perms.administrationSections.length
                              ? perms.administrationSections
                              : ADMINISTRATION_SECTIONS.map(s => s.id);
                            setPerms({ administrationSections: checked ? [...current, sec.id].filter((v,i,a)=>a.indexOf(v)===i) : current.filter(x => x !== sec.id) });
                          }}
                        />
                      ))}
                    </div>
                    {perms.administrationSections.length > 0 && perms.administrationSections.length < ADMINISTRATION_SECTIONS.length && (
                      <button style={{ fontSize: 11, color: "var(--text3)", background: "none", border: "none", cursor: "pointer", marginTop: 4, padding: 0 }}
                        onClick={() => setPerms({ administrationSections: [] })}>
                        אפס לגישה מלאה
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── קבלת התראות עבור סוגי השאלה ── */}
            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 10 }}>🔔 קבלת התראות עבור סוגי השאלה</div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>
                המשתמש יקבל התראה על בקשות חדשות בסוגים הבאים (ריק = ללא התראות)
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                {LOAN_TYPES.map(t => (
                  <CheckRow key={t} label={t}
                    checked={perms.notifyLoanTypes.includes(t)}
                    onChange={() => setPerms({ notifyLoanTypes: toggleArr(perms.notifyLoanTypes, t) })}
                  />
                ))}
              </div>
              {perms.notifyLoanTypes.length > 0 && (
                <button style={{ fontSize: 11, color: "var(--text3)", background: "none", border: "none", cursor: "pointer", marginTop: 6, padding: 0 }}
                  onClick={() => setPerms({ notifyLoanTypes: [] })}>
                  נקה הכל
                </button>
              )}
            </div>

          </div>
        </Modal>
      )}
    </div>
  );
}
