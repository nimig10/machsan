// ProductionEditor — modal for creating/editing a production (לוח הפקות).
// Director-only. Sections: title + description, dates, crew, status CTA + delete.

import { useMemo, useState } from "react";
import { Plus, Trash2, Save, Send, AlertTriangle } from "lucide-react";
import { Modal } from "./ui.jsx";
import { upsertProduction, publishProduction, deleteProduction } from "../utils/productionsApi.js";

const ROLE_LABELS = {
  photographer:           "צלם",
  sound:                  "סאונדמן",
  assistant_photographer: "עוזר צלם",
  assistant_director:     "עוזר במאי",
  producer:               "מפיק",
};
const ROLE_ORDER = ["photographer","sound","assistant_photographer","assistant_director","producer"];
const REQUIRES_STUDENT = new Set(["photographer","sound"]);

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
}
function todayISO() {
  return new Date().toISOString().slice(0,10);
}
function fmtDeadline(startDate) {
  if (!startDate) return null;
  const d = new Date(startDate);
  d.setDate(d.getDate() - 9);
  const today = new Date();
  today.setHours(0,0,0,0);
  const diff = Math.floor((d - today) / (24*3600*1000));
  return { date: d.toLocaleDateString("he-IL", { day:"2-digit", month:"2-digit" }), diff };
}

export function ProductionEditor({ initial, currentStudent, students = [], showToast, onClose, onSaved, onDeleted, reservations = [] }) {
  const [title, setTitle]             = useState(initial?.title || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [dates, setDates]             = useState(() => Array.isArray(initial?.dates) ? initial.dates : []);
  const [crew, setCrew]               = useState(() => Array.isArray(initial?.crew) ? initial.crew : []);
  const [saving, setSaving]           = useState(false);
  const [publishing, setPublishing]   = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const isNew = !initial?.id;
  const productionId = initial?.id || genId("prod");
  const isPublished = initial?.status === "published";

  const linkedReservations = useMemo(() =>
    (reservations || []).filter(r => r.production_id === productionId && r.status !== "בוטל"),
    [reservations, productionId]);

  const sortedStudents = useMemo(() =>
    [...(students || [])].sort((a,b) => String(a.name||"").localeCompare(String(b.name||""), "he")),
    [students]);

  function addDate() {
    setDates(prev => [...prev, {
      id: genId("pd"),
      startDate: todayISO(),
      startTime: "09:00",
      endDate: todayISO(),
      endTime: "17:00",
      note: "",
      sortOrder: prev.length,
    }]);
  }
  function updateDate(idx, patch) {
    setDates(prev => prev.map((d,i) => i === idx ? { ...d, ...patch } : d));
  }
  function removeDate(idx) {
    setDates(prev => prev.filter((_,i) => i !== idx));
  }

  function addCrew(role) {
    setCrew(prev => [...prev, {
      id: genId("pc"),
      role,
      studentId: null,
      freeTextName: REQUIRES_STUDENT.has(role) ? null : "",
      status: "approved",
      invitedBy: "director",
      crewEmail: null,
      notes: "",
    }]);
  }
  function updateCrew(id, patch) {
    setCrew(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  }
  function removeCrew(id) {
    setCrew(prev => prev.filter(c => c.id !== id));
  }
  function pickStudent(crewId, studentId) {
    const stu = sortedStudents.find(s => String(s.id) === String(studentId));
    if (!stu) return;
    updateCrew(crewId, {
      studentId: stu.id,
      freeTextName: null,
      crewEmail: stu.email || null,
    });
  }

  function validate() {
    if (!title.trim()) return "חסר כותרת";
    if (description.length > 800) return "תיאור ארוך מ-800 תווים";
    if (dates.length === 0) return "הוסיפו לפחות תאריך צילום אחד";
    for (const d of dates) {
      if (!d.startDate || !d.endDate || !d.startTime || !d.endTime) return "תאריך/שעה חסרים בלוח הצילום";
      const s = new Date(`${d.startDate}T${d.startTime}`);
      const e = new Date(`${d.endDate}T${d.endTime}`);
      if (e <= s) return "תאריך סיום חייב להיות אחרי תאריך התחלה";
    }
    for (const c of crew) {
      if (REQUIRES_STUDENT.has(c.role) && !c.studentId) {
        return `${ROLE_LABELS[c.role]}: חובה לבחור סטודנט רשום (לא טקסט חופשי)`;
      }
      if (!c.studentId && !(c.freeTextName || "").trim()) {
        return `${ROLE_LABELS[c.role]}: חובה לבחור סטודנט או למלא טקסט`;
      }
    }
    return null;
  }

  async function persist(targetStatus) {
    const err = validate();
    if (err) {
      showToast?.(err, "error");
      return null;
    }
    setSaving(true);
    const blob = {
      id:                 productionId,
      title:              title.trim(),
      description,
      directorStudentId:  currentStudent?.id,
      directorEmail:      currentStudent?.email,
      directorName:       currentStudent?.name,
      directorPhone:      currentStudent?.phone,
      status:             targetStatus,
      publishedAt:        targetStatus === "published" ? (initial?.publishedAt || new Date().toISOString()) : initial?.publishedAt,
      dates,
      crew,
    };
    const res = await upsertProduction(blob);
    setSaving(false);
    if (!res.ok) {
      showToast?.(`שגיאה בשמירה: ${res.error || ""}`, "error");
      return null;
    }
    return blob;
  }

  async function onSaveDraft() {
    const blob = await persist("draft");
    if (blob) {
      showToast?.("נשמר כטיוטה", "success");
      onSaved?.(blob);
      onClose();
    }
  }

  async function onPublish() {
    if (initial?.status === "published") {
      const blob = await persist("published");
      if (blob) {
        showToast?.("עודכן", "success");
        onSaved?.(blob);
        onClose();
      }
      return;
    }
    setPublishing(true);
    const blob = await persist("draft");
    if (!blob) { setPublishing(false); return; }
    const pubRes = await publishProduction(productionId);
    setPublishing(false);
    if (!pubRes.ok) {
      showToast?.(`שגיאה בפרסום: ${pubRes.error || ""}`, "error");
      return;
    }
    showToast?.("ההפקה פורסמה", "success");
    onSaved?.({ ...blob, status: "published", publishedAt: new Date().toISOString() });
    onClose();
  }

  async function onDelete() {
    setDeleteConfirm(null);
    const res = await deleteProduction(productionId);
    if (!res.ok) {
      showToast?.(`שגיאה במחיקה: ${res.error || ""}`, "error");
      return;
    }
    showToast?.("ההפקה נמחקה", "success");
    onDeleted?.(productionId);
    onClose();
  }

  return (
    <Modal
      title={isNew ? "הפקה חדשה" : `עריכת הפקה: ${initial?.title || ""}`}
      onClose={onClose}
      size="modal-lg"
      footer={
        <div style={{display:"flex",gap:8,justifyContent:"space-between",flexWrap:"wrap"}}>
          <div>
            {!isNew && (
              <button className="btn btn-danger btn-sm"
                onClick={() => setDeleteConfirm(linkedReservations)}
                style={{background:"#fee", color:"#c00", border:"1px solid #c00"}}>
                <Trash2 size={14} /> מחיקה
              </button>
            )}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn btn-secondary btn-sm" onClick={onClose}>סגירה</button>
            <button className="btn btn-secondary btn-sm" onClick={onSaveDraft} disabled={saving}>
              <Save size={14} /> שמור טיוטה
            </button>
            <button className="btn btn-primary btn-sm" onClick={onPublish} disabled={publishing}>
              <Send size={14} /> {isPublished ? "עדכן" : "פרסם"}
            </button>
          </div>
        </div>
      }>
      {/* ── כותרת + תיאור ── */}
      <div style={{marginBottom:18}}>
        <label className="form-label">שם ההפקה</label>
        <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="לדוגמא: סרט גמר אביב 2026"/>
      </div>
      <div style={{marginBottom:18}}>
        <label className="form-label" style={{display:"flex",justifyContent:"space-between"}}>
          <span>תיאור (עד 800 תווים)</span>
          <span style={{color: description.length > 800 ? "#c00" : "#888", fontSize:12}}>{description.length}/800</span>
        </label>
        <textarea className="form-input" rows={4} value={description} onChange={e => setDescription(e.target.value.slice(0,800))} placeholder="פירוט הפרויקט, לוקיישנים, הערות לצוות..."/>
      </div>

      {/* ── תאריכי צילום ── */}
      <div style={{marginBottom:18}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <h4 style={{margin:0}}>תאריכי צילום</h4>
          <button className="btn btn-secondary btn-sm" onClick={addDate}><Plus size={14}/> תאריך</button>
        </div>
        {dates.length === 0 && <p style={{color:"#888",fontSize:13}}>הוסיפו לפחות תאריך אחד</p>}
        {dates.map((d, idx) => {
          const dl = fmtDeadline(d.startDate);
          return (
            <div key={d.id} style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr auto",gap:8,marginBottom:8,padding:8,border:"1px solid #eee",borderRadius:6}}>
              <div>
                <label className="form-label" style={{fontSize:11}}>התחלה (תאריך)</label>
                <input type="date" className="form-input" value={d.startDate} onChange={e => updateDate(idx, { startDate: e.target.value, endDate: d.endDate || e.target.value })}/>
              </div>
              <div>
                <label className="form-label" style={{fontSize:11}}>התחלה (שעה)</label>
                <input type="time" className="form-input" value={d.startTime} onChange={e => updateDate(idx, { startTime: e.target.value })}/>
              </div>
              <div>
                <label className="form-label" style={{fontSize:11}}>סיום (תאריך)</label>
                <input type="date" className="form-input" value={d.endDate} onChange={e => updateDate(idx, { endDate: e.target.value })}/>
              </div>
              <div>
                <label className="form-label" style={{fontSize:11}}>סיום (שעה)</label>
                <input type="time" className="form-input" value={d.endTime} onChange={e => updateDate(idx, { endTime: e.target.value })}/>
              </div>
              <div style={{display:"flex",alignItems:"end"}}>
                <button className="btn btn-secondary btn-sm btn-icon" onClick={() => removeDate(idx)}><Trash2 size={14}/></button>
              </div>
              {dl && (
                <div style={{gridColumn:"1/-1",fontSize:11,color: dl.diff < 9 ? "#c00" : "#888"}}>
                  דדליין רשימת ציוד: {dl.date} ({dl.diff} ימים מהיום) {dl.diff < 9 && "— אי-אפשר עוד להזמין ציוד להפקה לתאריך זה"}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── צוות ── */}
      <div style={{marginBottom:18}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <h4 style={{margin:0}}>צוות</h4>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {ROLE_ORDER.map(role => (
              <button key={role} className="btn btn-secondary btn-sm" onClick={() => addCrew(role)}>
                <Plus size={12}/> {ROLE_LABELS[role]}
              </button>
            ))}
          </div>
        </div>
        {crew.length === 0 && <p style={{color:"#888",fontSize:13}}>הוסיפו לפחות צלם וסאונדמן (חובה לקשר לסטודנט רשום)</p>}
        {crew.map(c => (
          <div key={c.id} style={{display:"grid",gridTemplateColumns:"110px 1fr auto",gap:8,marginBottom:8,padding:8,border:"1px solid #eee",borderRadius:6,alignItems:"center"}}>
            <div style={{fontWeight:700}}>{ROLE_LABELS[c.role]}</div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <select className="form-input" value={c.studentId || ""} onChange={e => {
                if (!e.target.value) {
                  updateCrew(c.id, { studentId: null, crewEmail: null });
                } else {
                  pickStudent(c.id, e.target.value);
                }
              }} style={{maxWidth:280}}>
                <option value="">— בחר סטודנט —</option>
                {sortedStudents.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {!REQUIRES_STUDENT.has(c.role) && (
                <input className="form-input" placeholder="או טקסט חופשי" value={c.freeTextName || ""} onChange={e => updateCrew(c.id, { freeTextName: e.target.value, studentId: null, crewEmail: null })} style={{maxWidth:200}}/>
              )}
              <span style={{fontSize:11,color: c.status === "approved" ? "#0a0" : c.status === "invited" ? "#c80" : "#c00"}}>
                ({c.status === "approved" ? "מאושר" : c.status === "invited" ? "ממתין" : "נדחה"})
              </span>
            </div>
            <button className="btn btn-secondary btn-sm btn-icon" onClick={() => removeCrew(c.id)}><Trash2 size={14}/></button>
          </div>
        ))}
      </div>

      {deleteConfirm && (
        <Modal title="אישור מחיקת הפקה" onClose={() => setDeleteConfirm(null)} footer={
          <div style={{display:"flex",gap:8,justifyContent:"end"}}>
            <button className="btn btn-secondary btn-sm" onClick={() => setDeleteConfirm(null)}>ביטול</button>
            <button className="btn btn-danger btn-sm" onClick={onDelete} style={{background:"#c00",color:"#fff"}}>
              <Trash2 size={14}/> מחיקה סופית
            </button>
          </div>
        }>
          <div style={{display:"flex",gap:8,alignItems:"start",marginBottom:12}}>
            <AlertTriangle size={20} color="#c00" />
            <div>
              <p style={{margin:0,fontWeight:700}}>פעולה זו תמחק את ההפקה לחלוטין.</p>
              {deleteConfirm.length > 0 ? (
                <>
                  <p style={{margin:"8px 0 4px"}}>{deleteConfirm.length} השאלות ציוד מקושרות יבוטלו אוטומטית:</p>
                  <ul style={{margin:"4px 0",paddingInlineStart:20,fontSize:13}}>
                    {deleteConfirm.map(r => <li key={r.id}>#{r.id} — {r.status} — {r.borrow_date}</li>)}
                  </ul>
                </>
              ) : (
                <p style={{margin:"8px 0",fontSize:13,color:"#888"}}>אין השאלות ציוד מקושרות.</p>
              )}
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
