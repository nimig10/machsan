import { useState, useEffect } from "react";
import { Modal } from "./ui.jsx";
import { storageSet, isValidEmailAddress, logActivity } from "../utils.js";

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

const LOAN_TYPES     = ["פרטית", "הפקה", "סאונד", "קולנוע יומית", "שיעור"];
const DH_LOAN_TYPES  = ["הפקה", "סאונד", "קולנוע יומית"];
const LOAN_ICONS     = { "פרטית":"👤", "הפקה":"🎬", "סאונד":"🎙️", "קולנוע יומית":"🎥", "שיעור":"📚" };
const DH_LOAN_ICONS  = { "הפקה":"🎬", "סאונד":"🎙️", "קולנוע יומית":"🎥" };

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

// ─── Tab: אנשי צוות (staff_members in Supabase) ─────────────────────────────
function StaffTab({ showToast, teamMembers, setTeamMembers }) {
  const [staff, setStaff]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [editUser, setEditUser] = useState(null);
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [showPw, setShowPw]     = useState(false);

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

  const openNew = () => { setShowPw(false); setEditUser({ full_name: "", email: "", role: "staff", password: "", permissions: { ...DEFAULT_PERMISSIONS } }); };
  const openEdit = (s) => { setShowPw(false); setEditUser({ ...s, password: "", permissions: mergePerms(s.permissions) }); };
  const setPerms = (patch) => setEditUser(p => ({ ...p, permissions: { ...p.permissions, ...patch } }));

  const handleSave = async () => {
    if (!editUser) return;
    const { id, full_name, email, role, password, permissions } = editUser;
    if (!full_name?.trim() || !email?.trim()) { showToast?.("error", "שם ואימייל הם שדות חובה"); return; }
    if (!id && !password?.trim()) { showToast?.("error", "יש להזין סיסמה למשתמש חדש"); return; }
    setSaving(true);
    try {
      const body = { action: id ? "update" : "create", callerRole: "admin", full_name: full_name.trim(), email: email.trim(), role: role || "staff", permissions };
      if (id) body.id = id;
      if (password?.trim()) body.password = password.trim();
      const res = await fetch("/api/staff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok) {
        const caller = JSON.parse(sessionStorage.getItem("staff_user")||"{}");
        logActivity({ user_id: caller.id, user_name: caller.full_name, action: id ? "staff_update" : "staff_create", entity: "staff_member", entity_id: id || data.user?.id, details: { full_name, email, role } });
        // Sync to teamMembers (store table)
        const emailLower = email.trim().toLowerCase();
        const notifyTypes = permissions?.notifyLoanTypes || [];
        const current = Array.isArray(teamMembers) ? teamMembers : [];
        if (!id) {
          // CREATE — add to teamMembers if not already there
          if (!current.some(m => m.email?.toLowerCase() === emailLower)) {
            const updated = [...current, { id: data.user?.id || Date.now(), name: full_name.trim(), email: emailLower, phone: "", loanTypes: notifyTypes }];
            setTeamMembers(updated);
            storageSet("teamMembers", updated);
          }
        } else {
          // UPDATE — update matching entry in teamMembers
          const idx = current.findIndex(m => m.id === id || m.email?.toLowerCase() === emailLower);
          if (idx >= 0) {
            const updated = [...current];
            updated[idx] = { ...updated[idx], name: full_name.trim(), email: emailLower, loanTypes: notifyTypes };
            setTeamMembers(updated);
            storageSet("teamMembers", updated);
          }
        }
        showToast?.("success", id ? "המשתמש עודכן" : "המשתמש נוצר"); setEditUser(null); fetchStaff();
      }
      else {
          const msg = data.error === "last_admin" ? "לא ניתן להוריד את המנהל האחרון — חייב להישאר לפחות מנהל אחד במערכת" : (data.error || "שגיאה בשמירה");
          showToast?.("error", msg);
        }
    } catch { showToast?.("error", "שגיאת רשת"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      const res = await fetch("/api/staff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", callerRole: "admin", id }) });
      if (res.ok) {
          // Remove from teamMembers too
          const current = Array.isArray(teamMembers) ? teamMembers : [];
          const deleted = staff.find(s => s.id === id);
          if (deleted) {
            const updated = current.filter(m => m.id !== id && m.email?.toLowerCase() !== deleted.email?.toLowerCase());
            if (updated.length !== current.length) { setTeamMembers(updated); storageSet("teamMembers", updated); }
          }
          showToast?.("success", "המשתמש נמחק"); fetchStaff();
        }
      else {
          const data = await res.json().catch(() => ({}));
          const msg = data.error === "last_admin" ? "לא ניתן למחוק את המנהל האחרון — חייב להישאר לפחות מנהל אחד במערכת" : "שגיאה במחיקה";
          showToast?.("error", msg);
        }
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

  const adminCountLocal = staff.filter(s => s.role === "admin").length;
  const isLastAdmin = (s) => s.role === "admin" && adminCountLocal <= 1;

  const perms = editUser?.permissions || DEFAULT_PERMISSIONS;
  const allWarehouseAllowed = !perms.views.length || perms.views.includes("warehouse");
  const allAdminAllowed     = !perms.views.length || perms.views.includes("administration");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <span style={{ fontSize: 13, color: "var(--text3)" }}>{staff.length} אנשי צוות</span>
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
                <button className="btn btn-secondary btn-sm" style={{ color: isLastAdmin(s) ? "var(--text3)" : "#ef4444" }}
                  disabled={deleting === s.id || isLastAdmin(s)}
                  title={isLastAdmin(s) ? "לא ניתן למחוק את המנהל האחרון" : ""}
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
                {editUser.id && editUser.role === "admin" && adminCountLocal <= 1 ? (
                  <div className="form-input" style={{ background: "var(--surface2)", color: "var(--text3)", cursor: "not-allowed" }}>
                    מנהל (Admin) — מנהל אחרון, לא ניתן לשנות
                  </div>
                ) : (
                  <select className="form-select" value={editUser.role || "staff"} onChange={e => setEditUser(p => ({ ...p, role: e.target.value }))}>
                    <option value="staff">צוות</option>
                    <option value="admin">מנהל (Admin)</option>
                  </select>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">{editUser.id ? "סיסמה חדשה (השאר ריק)" : "סיסמה *"}</label>
                <div style={{ position: "relative" }}>
                  <input className="form-input" type={showPw ? "text" : "password"} dir="ltr" value={editUser.password || ""} onChange={e => setEditUser(p => ({ ...p, password: e.target.value }))} placeholder={editUser.id ? "••••••" : ""} style={{ paddingLeft: 36 }} />
                  <button type="button" onClick={() => setShowPw(p => !p)}
                    style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--text3)", padding: 0 }}>
                    {showPw ? "🙈" : "👁️"}
                  </button>
                </div>
              </div>
            </div>

            {editUser.role !== "admin" && (
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
                <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 12 }}>🔒 הגבלת גישה</div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}>גישה לאזורים (ריק = גישה לכל)</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {[{ id: "warehouse", label: "📦 תפעול מחסן" }, { id: "administration", label: "📋 אדמיניסטרציה" }].map(v => (
                      <label key={v.id} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "7px 14px", borderRadius: 8, border: `1px solid ${perms.views.includes(v.id) ? "var(--accent)" : "var(--border)"}`, background: perms.views.includes(v.id) ? "rgba(245,166,35,0.1)" : "transparent", fontSize: 13, fontWeight: 600 }}>
                        <input type="checkbox" style={{ accentColor: "var(--accent)" }} checked={perms.views.includes(v.id)} onChange={() => setPerms({ views: toggleArr(perms.views, v.id) })} />
                        {v.label}
                      </label>
                    ))}
                  </div>
                </div>
                {(allWarehouseAllowed || perms.views.includes("warehouse")) && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}>רובריקות מחסן פעילות (ריק = הכל)</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                      {WAREHOUSE_SECTIONS.map(sec => (
                        <CheckRow key={sec.id} label={sec.label}
                          checked={!perms.warehouseSections.length || perms.warehouseSections.includes(sec.id)}
                          onChange={checked => {
                            const current = perms.warehouseSections.length ? perms.warehouseSections : WAREHOUSE_SECTIONS.map(s => s.id);
                            setPerms({ warehouseSections: checked ? [...current, sec.id].filter((v,i,a)=>a.indexOf(v)===i) : current.filter(x => x !== sec.id) });
                          }}
                        />
                      ))}
                    </div>
                    {perms.warehouseSections.length > 0 && perms.warehouseSections.length < WAREHOUSE_SECTIONS.length && (
                      <button style={{ fontSize: 11, color: "var(--text3)", background: "none", border: "none", cursor: "pointer", marginTop: 4, padding: 0 }} onClick={() => setPerms({ warehouseSections: [] })}>אפס לגישה מלאה</button>
                    )}
                  </div>
                )}
                {(allAdminAllowed || perms.views.includes("administration")) && (
                  <div>
                    <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}>רובריקות אדמיניסטרציה פעילות (ריק = הכל)</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                      {ADMINISTRATION_SECTIONS.map(sec => (
                        <CheckRow key={sec.id} label={sec.label}
                          checked={!perms.administrationSections.length || perms.administrationSections.includes(sec.id)}
                          onChange={checked => {
                            const current = perms.administrationSections.length ? perms.administrationSections : ADMINISTRATION_SECTIONS.map(s => s.id);
                            setPerms({ administrationSections: checked ? [...current, sec.id].filter((v,i,a)=>a.indexOf(v)===i) : current.filter(x => x !== sec.id) });
                          }}
                        />
                      ))}
                    </div>
                    {perms.administrationSections.length > 0 && perms.administrationSections.length < ADMINISTRATION_SECTIONS.length && (
                      <button style={{ fontSize: 11, color: "var(--text3)", background: "none", border: "none", cursor: "pointer", marginTop: 4, padding: 0 }} onClick={() => setPerms({ administrationSections: [] })}>אפס לגישה מלאה</button>
                    )}
                  </div>
                )}
              </div>
            )}

            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 10 }}>🔔 קבלת התראות עבור סוגי השאלה</div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>המשתמש יקבל התראה על בקשות חדשות בסוגים הבאים (ריק = ללא התראות)</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                {LOAN_TYPES.map(t => (
                  <CheckRow key={t} label={t} checked={perms.notifyLoanTypes.includes(t)} onChange={() => setPerms({ notifyLoanTypes: toggleArr(perms.notifyLoanTypes, t) })} />
                ))}
              </div>
              {perms.notifyLoanTypes.length > 0 && (
                <button style={{ fontSize: 11, color: "var(--text3)", background: "none", border: "none", cursor: "pointer", marginTop: 6, padding: 0 }} onClick={() => setPerms({ notifyLoanTypes: [] })}>נקה הכל</button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Tab: מנהל ומחלקות (legacy teamMembers / deptHeads) ──────────────────────
function LegacyTeamTab({ teamMembers, setTeamMembers, deptHeads, setDeptHeads, calendarToken, collegeManager, setCollegeManager, managerToken, showToast }) {
  const emptyForm    = { name:"", email:"", phone:"", loanTypes:[...LOAN_TYPES] };
  const emptyDhForm  = { name:"", email:"", role:"", loanTypes:[] };

  const [mgrForm, setMgrForm]   = useState({ name: collegeManager?.name||"", email: collegeManager?.email||"" });
  const [mgrSaving, setMgrSaving] = useState(false);

  const [addingDh, setAddingDh] = useState(false);
  const [dhForm, setDhForm]     = useState(emptyDhForm);
  const [editDh, setEditDh]     = useState(null);
  const [editDhForm, setEditDhForm] = useState(emptyDhForm);
  const [dhSaving, setDhSaving] = useState(false);

  const [editMember, setEditMember] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);

  const saveMgr = async () => {
    setMgrSaving(true);
    const updated = { name: mgrForm.name.trim(), email: mgrForm.email.toLowerCase().trim() };
    setCollegeManager(updated);
    const r = await storageSet("collegeManager", updated);
    setMgrSaving(false);
    if (r.ok) showToast("success", "פרטי מנהל המכללה נשמרו");
    else showToast("error", "❌ שגיאה בשמירה");
  };

  const toggleDhLT = (form, setForm, lt) =>
    setForm(p => ({ ...p, loanTypes: p.loanTypes.includes(lt) ? p.loanTypes.filter(x=>x!==lt) : [...p.loanTypes, lt] }));

  const saveDeptHead = async () => {
    const name = dhForm.name.trim(); const email = dhForm.email.toLowerCase().trim();
    if (!name || !email || !isValidEmailAddress(email)) { showToast("error","שם ומייל תקני חובה"); return; }
    if (dhForm.loanTypes.length === 0) { showToast("error","יש לסמן לפחות סוג השאלה אחד"); return; }
    setDhSaving(true);
    const updated = [...(deptHeads||[]), { id:`dh_${Date.now()}`, name, email, role:dhForm.role.trim(), loanTypes:dhForm.loanTypes }];
    setDeptHeads(updated);
    const r = await storageSet("deptHeads", updated);
    setDhSaving(false);
    if (r.ok) { showToast("success", `${name} נוסף/ה כראש מחלקה`); setDhForm(emptyDhForm); setAddingDh(false); }
    else showToast("error","❌ שגיאה בשמירה");
  };

  const saveEditDh = async () => {
    const name = editDhForm.name.trim(); const email = editDhForm.email.toLowerCase().trim();
    if (!name || !email || !isValidEmailAddress(email)) { showToast("error","שם ומייל תקני חובה"); return; }
    setDhSaving(true);
    const updated = (deptHeads||[]).map(dh => dh.id===editDh.id ? {...dh,name,email,role:editDhForm.role.trim(),loanTypes:editDhForm.loanTypes} : dh);
    setDeptHeads(updated);
    const r = await storageSet("deptHeads", updated);
    setDhSaving(false);
    if (r.ok) { showToast("success","פרטי ראש המחלקה עודכנו"); setEditDh(null); }
    else showToast("error","❌ שגיאה בשמירה");
  };

  const delDh = async (id) => {
    const updated = (deptHeads||[]).filter(dh => dh.id!==id);
    setDeptHeads(updated); await storageSet("deptHeads", updated);
    showToast("success","ראש המחלקה הוסר");
  };

  const normalizeEmail = (e) => String(e||"").trim().toLowerCase();
  const hasDuplicateEmail = (email, excludeId=null) =>
    (teamMembers||[]).some(m => m.id!==excludeId && normalizeEmail(m.email)===normalizeEmail(email));

  const editEmail = normalizeEmail(editForm?.email);

  const saveEdit = async () => {
    if (!editMember) return;
    const name = editForm.name.trim(); const email = editEmail;
    if (!name || !email) return;
    if (!isValidEmailAddress(email)) { showToast("error","כתובת המייל אינה תקינה"); return; }
    if (hasDuplicateEmail(email, editMember.id)) { showToast("error","כתובת המייל כבר קיימת"); return; }
    const updated = (teamMembers||[]).map(m => m.id===editMember.id ? {...m,...editForm,name,email,phone:editForm.phone?.trim()||""} : m);
    setTeamMembers(updated);
    const r = await storageSet("teamMembers", updated);
    if (!r.ok) showToast("error","❌ שגיאה בשמירה");
    else showToast("success","איש צוות עודכן");
    setEditMember(null);
  };

  const del = async (id) => {
    const updated = (teamMembers||[]).filter(m => m.id!==id);
    setTeamMembers(updated);
    const r = await storageSet("teamMembers", updated);
    if (!r.ok) showToast("error","❌ שגיאה בשמירה");
    else showToast("success","איש צוות הוסר");
  };

  const LoanButtons = ({ form, setForm, types, icons }) => (
    <div style={{display:"flex",gap:8,marginTop:6,flexWrap:"wrap"}}>
      {types.map(lt => (
        <button key={lt} type="button" onClick={() => setForm(p=>({...p,loanTypes:p.loanTypes.includes(lt)?p.loanTypes.filter(x=>x!==lt):[...p.loanTypes,lt]}))}
          style={{padding:"6px 14px",borderRadius:20,border:`2px solid ${form.loanTypes.includes(lt)?"var(--accent)":"var(--border)"}`,background:form.loanTypes.includes(lt)?"var(--accent-glow)":"var(--surface2)",color:form.loanTypes.includes(lt)?"var(--accent)":"var(--text2)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
          {icons[lt]} {lt}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      {/* ── College manager ── */}
      <div className="card" style={{marginBottom:24,border:"2px solid rgba(52,152,219,0.3)",background:"rgba(52,152,219,0.04)"}}>
        <div className="card-header"><div className="card-title">🏫 מנהל המכללה</div></div>
        <div style={{fontSize:12,color:"var(--text3)",marginBottom:14,padding:"0 20px"}}>
          מנהל המכללה יכול לקבל דיווחים על בקשות בעייתיות ועל ציוד פגום מצוות המחסן.
        </div>
        <div style={{padding:"0 20px 20px"}}>
          <div className="grid-2" style={{marginBottom:14}}>
            <div className="form-group"><label className="form-label">שם מלא</label>
              <input className="form-input" placeholder="שם מנהל המכללה" value={mgrForm.name} onChange={e=>setMgrForm(p=>({...p,name:e.target.value}))}/></div>
            <div className="form-group"><label className="form-label">כתובת מייל</label>
              <input className="form-input" type="email" placeholder="manager@college.ac.il" value={mgrForm.email} onChange={e=>setMgrForm(p=>({...p,email:e.target.value}))}/></div>
          </div>
          {collegeManager?.email && (
            <div style={{fontSize:12,color:"var(--green)",marginBottom:10}}>✅ מוגדר: <strong>{collegeManager.name}</strong> ({collegeManager.email})</div>
          )}
          <button className="btn btn-primary" disabled={!mgrForm.name.trim()||!mgrForm.email.trim()||mgrSaving} onClick={saveMgr}>
            {mgrSaving?"⏳ שומר...":"💾 שמור פרטי מנהל"}
          </button>
          {/* Daily display link */}
          <div style={{marginTop:14,background:"rgba(245,166,35,0.08)",border:"1px solid rgba(245,166,35,0.3)",borderRadius:"var(--r-sm)",padding:"10px 14px",fontSize:12}}>
            <div style={{fontWeight:700,marginBottom:6,color:"#f5a623"}}>📺 לינק לוח לוז יומי ציבורי</div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <code style={{fontSize:11,background:"var(--surface3)",padding:"3px 8px",borderRadius:4,flex:1,wordBreak:"break-all",color:"var(--text2)"}}>{typeof window!=="undefined"?window.location.origin:""}/daily</code>
              <button className="btn btn-secondary btn-sm" onClick={()=>{navigator.clipboard.writeText(`${window.location.origin}/daily`);showToast("success","הקישור הועתק!");}}>📋 העתק</button>
              <a href="/daily" target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{textDecoration:"none"}}>🔗 פתח</a>
            </div>
          </div>
          {managerToken && (
            <div style={{marginTop:14,background:"rgba(52,152,219,0.08)",border:"1px solid rgba(52,152,219,0.25)",borderRadius:"var(--r-sm)",padding:"10px 14px",fontSize:12}}>
              <div style={{fontWeight:700,marginBottom:6,color:"#3498db"}}>🔗 קישור לוח שנה למנהל המכללה</div>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <code style={{fontSize:11,background:"var(--surface3)",padding:"3px 8px",borderRadius:4,flex:1,wordBreak:"break-all",color:"var(--text2)"}}>{window.location.origin}/manager-calendar?token={managerToken}</code>
                <button className="btn btn-secondary btn-sm" onClick={()=>{navigator.clipboard.writeText(`${window.location.origin}/manager-calendar?token=${managerToken}`);showToast("success","הקישור הועתק!");}}>📋 העתק</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Dept heads ── */}
      <div className="card" style={{marginBottom:24,border:"2px solid rgba(155,89,182,0.3)",background:"rgba(155,89,182,0.04)"}}>
        <div className="card-header">
          <div className="card-title">🎓 ראשי מחלקות</div>
          <button className="btn btn-primary btn-sm" onClick={()=>setAddingDh(p=>!p)}>{addingDh?"✕ ביטול":"➕ הוסף ראש מחלקה"}</button>
        </div>
        <div style={{fontSize:12,color:"var(--text3)",marginBottom:10,padding:"0 20px"}}>
          ראש מחלקה מקבל מייל על השאלות מהסוגים שסומנו ויכול לאשר אותן לפני שהצוות רואה אותן.
        </div>
        <div style={{padding:"0 20px 20px"}}>
          {calendarToken && (
            <div style={{background:"rgba(155,89,182,0.08)",border:"1px solid rgba(155,89,182,0.25)",borderRadius:"var(--r-sm)",padding:"10px 14px",marginBottom:14,fontSize:12}}>
              <div style={{fontWeight:700,marginBottom:6,color:"#9b59b6"}}>🔗 קישור לוח שנה לראשי מחלקות</div>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <code style={{fontSize:11,background:"var(--surface3)",padding:"3px 8px",borderRadius:4,flex:1,wordBreak:"break-all",color:"var(--text2)"}}>{window.location.origin}/calendar?token={calendarToken}</code>
                <button className="btn btn-secondary btn-sm" onClick={()=>{navigator.clipboard.writeText(`${window.location.origin}/calendar?token=${calendarToken}`);showToast("success","הקישור הועתק!");}}>📋 העתק</button>
              </div>
            </div>
          )}
          {addingDh && (
            <div style={{background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:"16px",marginBottom:16,border:"1px solid var(--border)"}}>
              <div style={{fontWeight:800,fontSize:14,marginBottom:12}}>➕ הוספת ראש מחלקה</div>
              <div className="grid-2" style={{marginBottom:10}}>
                <div className="form-group"><label className="form-label">שם מלא *</label><input className="form-input" placeholder="רפי כהן" value={dhForm.name} onChange={e=>setDhForm(p=>({...p,name:e.target.value}))}/></div>
                <div className="form-group"><label className="form-label">כתובת מייל *</label><input className="form-input" type="email" value={dhForm.email} onChange={e=>setDhForm(p=>({...p,email:e.target.value}))}/></div>
              </div>
              <div className="form-group" style={{marginBottom:10}}>
                <label className="form-label">שם התפקיד</label>
                <input className="form-input" placeholder="ראש מחלקת קולנוע" value={dhForm.role} onChange={e=>setDhForm(p=>({...p,role:e.target.value}))}/>
              </div>
              <div className="form-group" style={{marginBottom:12}}>
                <label className="form-label">📩 סוגי השאלה לאישור *</label>
                <div style={{display:"flex",gap:8,marginTop:6,flexWrap:"wrap"}}>
                  {DH_LOAN_TYPES.map(lt=>{const active=dhForm.loanTypes.includes(lt);return(
                    <button key={lt} type="button" onClick={()=>toggleDhLT(dhForm,setDhForm,lt)}
                      style={{padding:"7px 16px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"var(--surface2)",color:active?"var(--accent)":"var(--text2)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                      {DH_LOAN_ICONS[lt]} {lt}
                    </button>
                  );})}
                </div>
              </div>
              <button className="btn btn-primary" disabled={!dhForm.name.trim()||!dhForm.email.trim()||dhForm.loanTypes.length===0||dhSaving} onClick={saveDeptHead}>
                {dhSaving?"⏳ שומר...":"✅ הוסף ראש מחלקה"}
              </button>
            </div>
          )}
          {(deptHeads||[]).length===0
            ? <div style={{textAlign:"center",color:"var(--text3)",fontSize:13,padding:"12px 0"}}>לא נוספו ראשי מחלקות עדיין</div>
            : <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {(deptHeads||[]).map(dh=>(
                <div key={dh.id} style={{background:"var(--surface)",border:"1px solid rgba(155,89,182,0.2)",borderRadius:"var(--r-sm)",padding:"12px 16px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                  <div style={{width:36,height:36,borderRadius:"50%",background:"rgba(155,89,182,0.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>🎓</div>
                  <div style={{flex:1,minWidth:150}}>
                    <div style={{fontWeight:800,fontSize:14}}>{dh.name}</div>
                    {dh.role&&<div style={{fontSize:11,color:"#9b59b6",fontWeight:700,marginTop:1}}>{dh.role}</div>}
                    <div style={{fontSize:11,color:"var(--text3)"}}>{dh.email}</div>
                    <div style={{display:"flex",gap:4,marginTop:5,flexWrap:"wrap"}}>
                      {(dh.loanTypes||[]).map(lt=>(
                        <span key={lt} style={{background:"rgba(155,89,182,0.12)",border:"1px solid rgba(155,89,182,0.3)",borderRadius:20,padding:"1px 8px",fontSize:11,color:"#9b59b6",fontWeight:700}}>{DH_LOAN_ICONS[lt]||"📦"} {lt}</span>
                      ))}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <button className="btn btn-secondary btn-sm" onClick={()=>{setEditDh(dh);setEditDhForm({name:dh.name,email:dh.email,role:dh.role||"",loanTypes:dh.loanTypes||[]});}}>✏️</button>
                    <button className="btn btn-danger btn-sm" onClick={()=>delDh(dh.id)}>🗑️</button>
                  </div>
                </div>
              ))}
            </div>
          }
        </div>
      </div>

      {/* Edit dept head modal */}
      {editDh && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}} onClick={e=>e.target===e.currentTarget&&setEditDh(null)}>
          <div style={{width:"100%",maxWidth:480,background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",direction:"rtl"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:"1px solid var(--border)",background:"var(--surface2)",borderRadius:"16px 16px 0 0"}}>
              <div style={{fontWeight:900,fontSize:16}}>✏️ עריכת ראש מחלקה</div>
              <button className="btn btn-secondary btn-sm" onClick={()=>setEditDh(null)}>✕</button>
            </div>
            <div style={{padding:"20px"}}>
              <div className="grid-2" style={{marginBottom:10}}>
                <div className="form-group"><label className="form-label">שם מלא *</label><input className="form-input" value={editDhForm.name} onChange={e=>setEditDhForm(p=>({...p,name:e.target.value}))}/></div>
                <div className="form-group"><label className="form-label">כתובת מייל *</label><input className="form-input" type="email" value={editDhForm.email} onChange={e=>setEditDhForm(p=>({...p,email:e.target.value}))}/></div>
              </div>
              <div className="form-group" style={{marginBottom:10}}>
                <label className="form-label">שם התפקיד</label>
                <input className="form-input" value={editDhForm.role} onChange={e=>setEditDhForm(p=>({...p,role:e.target.value}))}/>
              </div>
              <div className="form-group" style={{marginBottom:16}}>
                <label className="form-label">📩 סוגי השאלה לאישור</label>
                <div style={{display:"flex",gap:8,marginTop:6,flexWrap:"wrap"}}>
                  {DH_LOAN_TYPES.map(lt=>{const active=editDhForm.loanTypes.includes(lt);return(
                    <button key={lt} type="button" onClick={()=>toggleDhLT(editDhForm,setEditDhForm,lt)}
                      style={{padding:"7px 16px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"var(--surface2)",color:active?"var(--accent)":"var(--text2)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                      {DH_LOAN_ICONS[lt]} {lt}
                    </button>
                  );})}
                </div>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button className="btn btn-primary" disabled={!editDhForm.name.trim()||!editDhForm.email.trim()||editDhForm.loanTypes.length===0||dhSaving} onClick={saveEditDh}>
                  {dhSaving?"⏳ שומר...":"💾 שמור"}
                </button>
                <button className="btn btn-secondary" onClick={()=>setEditDh(null)}>ביטול</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Team list ── */}
      {(teamMembers||[]).length === 0
        ? <div className="empty-state"><div className="emoji">👥</div><p>עדיין לא נוספו אנשי צוות</p></div>
        : <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {(teamMembers||[]).map(m=>(
            <div key={m.id} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"14px 18px",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
              <div style={{width:38,height:38,borderRadius:"50%",background:"var(--surface3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:900,flexShrink:0}}>{m.name?.[0]||"?"}</div>
              <div style={{flex:1,minWidth:180}}>
                <div style={{fontWeight:700,fontSize:14}}>{m.name}</div>
                {m.phone&&<div style={{fontSize:12,color:"var(--text2)",marginBottom:2}}>📞 {m.phone}</div>}
                <div style={{fontSize:12,color:"var(--text3)"}}>{m.email}</div>
                <div style={{display:"flex",gap:4,marginTop:6,flexWrap:"wrap"}}>
                  {(Array.isArray(m.loanTypes)&&m.loanTypes.length?m.loanTypes:(!Array.isArray(m.loanTypes)?LOAN_TYPES:[])).map(lt=>(
                    <span key={lt} style={{background:"var(--surface3)",border:"1px solid var(--border)",borderRadius:20,padding:"2px 8px",fontSize:11,color:"var(--accent)",fontWeight:700}}>{LOAN_ICONS[lt]} {lt}</span>
                  ))}
                  {Array.isArray(m.loanTypes)&&m.loanTypes.length===0&&(
                    <span style={{background:"rgba(231,76,60,0.12)",border:"1px solid rgba(231,76,60,0.35)",borderRadius:20,padding:"2px 8px",fontSize:11,color:"var(--red)",fontWeight:700}}>ללא התראות</span>
                  )}
                </div>
              </div>
              <div style={{display:"flex",gap:6}}>
                <button className="btn btn-secondary btn-sm" onClick={()=>{setEditMember(m);setEditForm({name:m.name,email:m.email,phone:m.phone||"",loanTypes:Array.isArray(m.loanTypes)?m.loanTypes:[...LOAN_TYPES]});}}>✏️</button>
                <button className="btn btn-danger btn-sm" onClick={()=>del(m.id)}>🗑️</button>
              </div>
            </div>
          ))}
        </div>
      }

      {/* Edit team member modal */}
      {editMember && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}} onClick={e=>e.target===e.currentTarget&&setEditMember(null)}>
          <div style={{width:"100%",maxWidth:500,background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",direction:"rtl"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:"1px solid var(--border)",background:"var(--surface2)",borderRadius:"16px 16px 0 0"}}>
              <div style={{fontWeight:900,fontSize:16}}>✏️ עריכת איש צוות</div>
              <button className="btn btn-secondary btn-sm" onClick={()=>setEditMember(null)}>✕</button>
            </div>
            <div style={{padding:"20px",display:"flex",flexDirection:"column",gap:14}}>
              <div className="grid-2">
                <div className="form-group"><label className="form-label">שם מלא *</label><input className="form-input" value={editForm.name} onChange={e=>setEditForm(p=>({...p,name:e.target.value}))}/></div>
                <div className="form-group"><label className="form-label">כתובת מייל *</label><input className="form-input" type="email" value={editForm.email} onChange={e=>setEditForm(p=>({...p,email:e.target.value}))}/></div>
              </div>
              <div className="form-group"><label className="form-label">טלפון</label><input className="form-input" value={editForm.phone||""} onChange={e=>setEditForm(p=>({...p,phone:e.target.value}))}/></div>
              <div className="form-group">
                <label className="form-label">📩 סוגי השאלה</label>
                <LoanButtons form={editForm} setForm={setEditForm} types={LOAN_TYPES} icons={LOAN_ICONS}/>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button className="btn btn-primary" disabled={!editForm.name.trim()||!editEmail||!isValidEmailAddress(editEmail)} onClick={saveEdit}>💾 שמור</button>
                <button className="btn btn-secondary" onClick={()=>setEditMember(null)}>ביטול</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────
export function StaffManagementPage({ showToast, teamMembers, setTeamMembers, deptHeads, setDeptHeads, calendarToken, collegeManager, setCollegeManager, managerToken }) {
  const [tab, setTab] = useState("staff");

  const TABS = [
    { id: "staff",  label: "👥 אנשי צוות" },
    { id: "legacy", label: "🏫 מנהל ומחלקות" },
  ];

  return (
    <div className="page">
      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 0, marginBottom: 24, borderBottom: "2px solid var(--border)" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "10px 24px", background: "none", border: "none", cursor: "pointer",
            fontWeight: tab === t.id ? 800 : 600, fontSize: 14,
            color: tab === t.id ? "var(--accent)" : "var(--text2)",
            borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
            marginBottom: -2, transition: "all 0.15s",
          }}>{t.label}</button>
        ))}
      </div>

      {tab === "staff"  && <StaffTab showToast={showToast} teamMembers={teamMembers} setTeamMembers={setTeamMembers} />}
      {tab === "legacy" && <LegacyTeamTab teamMembers={teamMembers} setTeamMembers={setTeamMembers} deptHeads={deptHeads} setDeptHeads={setDeptHeads} calendarToken={calendarToken} collegeManager={collegeManager} setCollegeManager={setCollegeManager} managerToken={managerToken} showToast={showToast}/>}
    </div>
  );
}
