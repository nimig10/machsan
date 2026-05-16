// ProductionEditor — modal for creating/editing a production (לוח הפקות).
// Director-only. Sections: title + description, dates, crew, status CTA + delete.

import { useMemo, useState, useRef, useEffect } from "react";
import { Plus, Trash2, Save, Send, AlertTriangle, Check, X as XIcon, ExternalLink } from "lucide-react";
import { Modal } from "./ui.jsx";
import { upsertProduction, publishProduction, deleteProduction, approveCrewMember, rejectCrewMember } from "../utils/productionsApi.js";

// Only photographer + sound are predefined: the equipment-loan certification
// check (crewIsCertifiedForEq) validates exactly these two roles, so they
// must be registered students. Any other crew (producer, assistant, color,
// gaffer…) is added freely via "תפקיד מותאם".
const ROLE_LABELS = {
  photographer: "צלם ראשי",
  sound:        "איש סאונד",
};
const ROLE_ORDER = ["photographer","sound"];
const REQUIRES_STUDENT = new Set(["photographer","sound"]);

// Color palette — taken from existing LOAN_TYPE_COLORS so it matches the
// app's visual language. Director picks one per production; it's used on
// the production card border and on the calendar block.
const COLOR_PALETTE = [
  "#e67e22",  // כתום
  "#3498db",  // כחול
  "#1abc9c",  // טורקיז
  "#9b59b6",  // סגול
  "#f1c40f",  // צהוב
  "#e74c3c",  // אדום
];
const DEFAULT_COLOR = "#e67e22";
function getRoleLabel(c) {
  if (c?.role === "custom") return c.roleLabel || "תפקיד מותאם";
  return ROLE_LABELS[c?.role] || c?.role || "";
}
function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
}
// Time slots — must mirror PublicForm `loan_type="הפקה"` TIME_SLOTS exactly so the
// equipment loan that follows the production can match the borrow/return windows.
// Source of truth: PublicForm.jsx ~line 3024.
const PRODUCTION_TIME_SLOTS = ["09:00","09:30","14:30","15:00","15:30","16:00","16:30","17:00","17:30"];
function snapToProductionSlot(v) {
  if (!v) return v;
  if (PRODUCTION_TIME_SLOTS.includes(v)) return v;
  // Snap to the nearest valid slot (used when editing legacy data).
  const [h, m] = String(v).split(":").map(n => parseInt(n, 10));
  if (Number.isNaN(h)) return PRODUCTION_TIME_SLOTS[0];
  const target = h * 60 + (m || 0);
  let best = PRODUCTION_TIME_SLOTS[0], bestDiff = Infinity;
  for (const s of PRODUCTION_TIME_SLOTS) {
    const [sh, sm] = s.split(":").map(n => parseInt(n, 10));
    const diff = Math.abs((sh * 60 + sm) - target);
    if (diff < bestDiff) { best = s; bestDiff = diff; }
  }
  return best;
}
function isWeekendISO(dateStr) {
  if (!dateStr) return false;
  const d = new Date(`${dateStr}T00:00:00`);
  return d.getDay() === 5 || d.getDay() === 6;
}
// Earliest legal shoot date = today + 8 days, skipping Fri/Sat. Mirrors the
// equipment-loan form rule for loan_type="הפקה". The number 8 comes from the
// school's "9 days notice" policy where the count is inclusive of both the
// submission day and the shoot day (16/05 + "9 days" → 24/05).
function minShootISO() {
  const d = new Date();
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 8);
  while (d.getDay() === 5 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0,10);
}
function fmtDeadline(startDate) {
  if (!startDate) return null;
  const d = new Date(startDate);
  d.setDate(d.getDate() - 8); // 9 days inclusive = 8 calendar days between
  const today = new Date();
  today.setHours(0,0,0,0);
  const diff = Math.floor((d - today) / (24*3600*1000));
  return { date: d.toLocaleDateString("he-IL", { day:"2-digit", month:"2-digit" }), diff };
}

export function ProductionEditor({ initial, currentStudent, students = [], showToast, onClose, onSaved, onDeleted, onOpenLoanForm, reservations = [] }) {
  const [title, setTitle]             = useState(initial?.title || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [driveUrl, setDriveUrl]       = useState(initial?.driveUrl || "");
  const [color, setColor]             = useState(initial?.color || DEFAULT_COLOR);
  const [dates, setDates]             = useState(() => Array.isArray(initial?.dates) ? initial.dates : []);
  const [crew, setCrew]               = useState(() => Array.isArray(initial?.crew) ? initial.crew : []);
  const [saving, setSaving]           = useState(false);
  const [publishing, setPublishing]   = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [errorField, setErrorField]   = useState(null);
  const [customRolePrompt, setCustomRolePrompt] = useState({ open: false, value: "" });
  const descriptionRef = useRef(null);
  useEffect(() => {
    const ta = descriptionRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [description]);

  const isNew = !initial?.id;
  const productionId = initial?.id || genId("prod");
  const isPublished = initial?.status === "published";
  // Live (not persisted) check — uses local crew state so the button reflects
  // edits made in this session even before save.
  const hasApprovedPhotographer = crew.some(c => c.role === "photographer" && c.status === "approved" && c.studentId);

  const linkedReservations = useMemo(() =>
    (reservations || []).filter(r => r.production_id === productionId && r.status !== "בוטל"),
    [reservations, productionId]);
  // Per-date-range lock: only the specific date range that already has an
  // active equipment-list reservation is locked. Other ranges (and adding new
  // ones) stay editable. Set of production_date_ids that are committed.
  const lockedDateIds = useMemo(() => {
    const ids = new Set();
    for (const r of linkedReservations) {
      if (r.production_date_id) ids.add(String(r.production_date_id));
    }
    return ids;
  }, [linkedReservations]);
  const anyDateLocked = lockedDateIds.size > 0;

  // Director can't be a crew member of their own production.
  const directorEmailLc = String(initial?.directorEmail || currentStudent?.email || "").toLowerCase();
  const sortedStudents = useMemo(() =>
    [...(students || [])]
      .filter(s => String(s.email || "").toLowerCase() !== directorEmailLc)
      .sort((a,b) => String(a.name||"").localeCompare(String(b.name||""), "he")),
    [students, directorEmailLc]);

  const minShoot = minShootISO();
  function addDate() {
    setDates(prev => [...prev, {
      id: genId("pd"),
      startDate: minShoot,
      startTime: PRODUCTION_TIME_SLOTS[0],   // 09:00
      endDate: minShoot,
      endTime: PRODUCTION_TIME_SLOTS[PRODUCTION_TIME_SLOTS.length - 1], // 17:30
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

  function addCrew(role, customLabel = null) {
    setCrew(prev => [...prev, {
      id: genId("pc"),
      role,
      roleLabel: role === "custom" ? (customLabel || "") : null,
      studentId: null,
      freeTextName: REQUIRES_STUDENT.has(role) ? null : "",
      status: "invited",
      invitedBy: "director",
      crewEmail: null,
      notes: "",
    }]);
  }
  function openCustomRolePrompt() {
    setCustomRolePrompt({ open: true, value: "" });
  }
  function confirmCustomRole() {
    const trimmed = customRolePrompt.value.trim().slice(0, 40);
    if (!trimmed) return;
    addCrew("custom", trimmed);
    setCustomRolePrompt({ open: false, value: "" });
  }
  function updateCrew(id, patch) {
    setCrew(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  }
  function removeCrew(id) {
    setCrew(prev => prev.filter(c => c.id !== id));
  }

  function validate() {
    if (!title.trim()) return { field: "title", message: "חסר כותרת" };
    if (description.length > 800) return { field: "description", message: "תיאור ארוך מ-800 תווים" };
    const url = driveUrl.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      return { field: "drive_url", message: "קישור חייב להתחיל ב-http:// או https://" };
    }
    if (dates.length === 0) return { field: "dates", message: "הוסיפו לפחות תאריך צילום אחד" };
    for (const d of dates) {
      if (!d.startDate || !d.endDate || !d.startTime || !d.endTime) {
        return { field: "dates", message: "תאריך/שעה חסרים בלוח הצילום" };
      }
      if (d.startDate < minShoot) {
        return { field: "dates", message: `תאריך צילום חייב להיות לפחות 9 ימי עבודה מהיום (החל מ-${minShoot})` };
      }
      if (isWeekendISO(d.startDate) || isWeekendISO(d.endDate)) {
        return { field: "dates", message: "שישי/שבת אינם זמינים — המחסן סגור בסופי שבוע" };
      }
      // 7-day max per shoot range — same rule as the equipment loan form for "הפקה".
      const daysDiff = Math.floor((new Date(`${d.endDate}T00:00:00`) - new Date(`${d.startDate}T00:00:00`)) / 86400000);
      if (daysDiff > 6) {
        return { field: "dates", message: "טווח צילום מקסימלי 7 ימים (כללי השאלת ציוד להפקה)" };
      }
      const s = new Date(`${d.startDate}T${d.startTime}`);
      const e = new Date(`${d.endDate}T${d.endTime}`);
      if (e <= s) return { field: "dates", message: "תאריך סיום חייב להיות אחרי תאריך התחלה" };
    }
    // No two ranges within the same production may overlap (calendar-date level).
    for (let i = 0; i < dates.length; i++) {
      for (let j = i + 1; j < dates.length; j++) {
        const a = dates[i], b = dates[j];
        if (!a.startDate || !a.endDate || !b.startDate || !b.endDate) continue;
        if (a.startDate <= b.endDate && b.startDate <= a.endDate) {
          return { field: "dates", message: "לא ניתן לבחור זוג טווחי תאריכים חופפים עבור אותה הפקה" };
        }
      }
    }
    for (const c of crew) {
      // Custom roles still need a label — it identifies the open slot.
      if (c.role === "custom" && !(c.roleLabel || "").trim()) {
        return { field: `crew:${c.id}`, message: "תפקיד מותאם: חסר שם תפקיד" };
      }
      // photographer/sound rows: free-text not allowed (cert lookup needs a real student).
      // But empty is fine — it stays as an open slot for self-enrollment.
      if (REQUIRES_STUDENT.has(c.role) && !c.studentId && (c.freeTextName || "").trim()) {
        return { field: `crew:${c.id}`, message: `${getRoleLabel(c)}: חובה לבחור סטודנט רשום (לא טקסט חופשי)` };
      }
    }
    return null;
  }

  async function persist(targetStatus) {
    const err = validate();
    if (err) {
      setErrorField(err.field);
      showToast?.(err.message, "error");
      return null;
    }
    setErrorField(null);
    setSaving(true);
    const blob = {
      id:                 productionId,
      title:              title.trim(),
      description,
      driveUrl:           driveUrl.trim(),
      color,
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
      console.error("[ProductionEditor.persist]", { blob, error: res.error, raw: res });
      const detail = String(res.error || "").slice(0, 200);
      showToast?.(`שגיאה בשמירה: ${detail || "ראה Console"}`, "error");
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
      console.error("[ProductionEditor.publish]", { productionId, error: pubRes.error, raw: pubRes });
      const detail = String(pubRes.error || "").slice(0, 200);
      showToast?.(`שגיאה בפרסום: ${detail || "ראה Console"}`, "error");
      return;
    }
    showToast?.("ההפקה פורסמה", "success");
    onSaved?.({ ...blob, status: "published", publishedAt: new Date().toISOString() });
    onClose();
  }

  // Director-side approve/reject for self-enrolled crew (invited_by='self', status='invited').
  // Calls the RPC (server-side conflict guard against overlapping productions) then
  // mirrors the new status into local state so a subsequent save doesn't overwrite it.
  async function handleApproveCrew(crewId) {
    const r = await approveCrewMember(crewId);
    if (!r.ok) {
      showToast?.(`שגיאה באישור: ${r.error}`, "error");
      return;
    }
    setCrew(prev => prev.map(c => c.id === crewId ? { ...c, status: "approved" } : c));
    showToast?.("אושר", "success");
  }
  async function handleRejectCrew(crewId) {
    const r = await rejectCrewMember(crewId);
    if (!r.ok) {
      showToast?.(`שגיאה בדחייה: ${r.error}`, "error");
      return;
    }
    setCrew(prev => prev.map(c => c.id === crewId ? { ...c, status: "rejected" } : c));
    showToast?.("נדחה", "success");
  }

  // Saves current state and opens the equipment-loan form pre-filled with this production.
  // Requires: existing production, published status, approved photographer.
  async function onClickLoanForm() {
    const targetStatus = initial?.status === "published" ? "published" : "draft";
    const blob = await persist(targetStatus);
    if (!blob) return;
    onSaved?.(blob);
    onOpenLoanForm?.(blob);
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
                style={{background:"rgba(231,76,60,0.1)", color:"#e74c3c", border:"1px solid #e74c3c"}}>
                <Trash2 size={14} /> מחיקה
              </button>
            )}
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button className="btn btn-secondary btn-sm" onClick={onClose}>סגירה</button>
            <button className="btn btn-secondary btn-sm" onClick={onSaveDraft} disabled={saving}>
              <Save size={14} /> שמור טיוטה
            </button>
            <button className="btn btn-primary btn-sm" onClick={onPublish} disabled={publishing}>
              <Send size={14} /> {isPublished ? "עדכן" : "פרסם"}
            </button>
            {!isNew && isPublished && hasApprovedPhotographer && onOpenLoanForm && (
              <button className="btn btn-primary btn-sm" onClick={onClickLoanForm} disabled={saving}
                title="שמירה ומעבר לטופס השאלת הציוד">
                <ExternalLink size={14}/> השאלת ציוד להפקה
              </button>
            )}
          </div>
        </div>
      }>
      {/* ── כותרת + תיאור ── */}
      <div style={{marginBottom:18}}>
        <label className="form-label">שם ההפקה</label>
        <input className="form-input" value={title}
          onChange={e => { setTitle(e.target.value); if (errorField === "title") setErrorField(null); }}
          placeholder="לדוגמא: סרט גמר אביב 2026"
          style={errorField === "title" ? { outline: "2px solid #e74c3c", outlineOffset: 2 } : undefined}/>
      </div>
      <div style={{marginBottom:18}}>
        <label className="form-label" style={{display:"flex",justifyContent:"space-between"}}>
          <span>תיאור (עד 800 תווים)</span>
          <span style={{color: description.length > 800 ? "#e74c3c" : "var(--text3)", fontSize:12}}>{description.length}/800</span>
        </label>
        <textarea ref={descriptionRef} className="form-input" rows={3} value={description}
          onChange={e => { setDescription(e.target.value.slice(0,800)); if (errorField === "description") setErrorField(null); }}
          placeholder="פירוט הפרויקט, לוקיישנים, הערות לצוות..."
          style={{
            resize:"none",
            overflow:"hidden",
            minHeight: 80,
            ...(errorField === "description" ? { outline: "2px solid #e74c3c", outlineOffset: 2 } : {}),
          }}/>
      </div>

      {/* ── קישור לתסריט/סינופסיס (Drive) ── */}
      <div style={{marginBottom:18}}>
        <label className="form-label">קישור לתסריט / סינופסיס / תיקיית הפקה</label>
        <input
          type="url"
          className="form-input"
          dir="ltr"
          inputMode="url"
          placeholder="https://drive.google.com/... או כל קישור שיתופי"
          value={driveUrl}
          onChange={e => { setDriveUrl(e.target.value); if (errorField === "drive_url") setErrorField(null); }}
          style={errorField === "drive_url" ? { outline: "2px solid #e74c3c", outlineOffset: 2 } : undefined}
        />
        <div style={{fontSize:13,color:"var(--text)",marginTop:6,lineHeight:1.6,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:6,padding:"10px 12px"}}>
          <div style={{marginBottom:4}}>ⓘ <strong>אופציונלי</strong> — הדבק קישור שיתופי ל-Google Drive / Dropbox / OneDrive: תסריט, סינופסיס, treatment, או תיקייה שלמה.</div>
          <div>🔓 <strong>ודא שההרשאות פתוחות</strong> — "כל מי שיש לו את הקישור יכול לצפות".</div>
        </div>
      </div>

      {/* ── צבע ההפקה ── */}
      <div style={{marginBottom:18}}>
        <label className="form-label">צבע ההפקה</label>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          {COLOR_PALETTE.map(c => {
            const isActive = color === c;
            return (
              <button key={c} type="button" onClick={() => setColor(c)}
                title={c}
                style={{
                  width:34, height:34, borderRadius:"50%",
                  background:c,
                  border: isActive ? "3px solid var(--text)" : "2px solid var(--border)",
                  boxShadow: isActive ? `0 0 0 2px ${c}66` : "none",
                  cursor:"pointer",
                  padding:0,
                  transition:"all 0.15s",
                }}/>
            );
          })}
          <span style={{fontSize:12,color:"var(--text3)",marginInlineStart:8}}>הצבע יוצג על כרטיס ההפקה ועל ה-block בלוח השנה</span>
        </div>
      </div>

      {/* ── תאריכי צילום ── */}
      <div style={{marginBottom:18}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <h4 style={{margin:0, color: errorField === "dates" ? "#e74c3c" : undefined}}>
            תאריכי צילום {errorField === "dates" && <span style={{fontSize:12}}>⚠</span>}
          </h4>
          <button className="btn btn-secondary btn-sm" onClick={() => { addDate(); if (errorField === "dates") setErrorField(null); }}>
            <Plus size={14}/> תאריך
          </button>
        </div>
        {anyDateLocked && (
          <div style={{background:"rgba(231,76,60,0.08)",border:"1px solid #e74c3c",borderRadius:6,padding:"10px 12px",marginBottom:10,fontSize:13,color:"var(--text)",lineHeight:1.5}}>
            🔒 <strong style={{color:"#e74c3c"}}>חלק מהתאריכים נעולים</strong> — טווחי תאריכים שכבר הוגשה עליהם רשימת ציוד לא ניתנים לעריכה. אפשר עדיין להוסיף/לערוך טווחים אחרים.
          </div>
        )}
        {dates.length === 0 && <p style={{color:"var(--text3)",fontSize:13}}>הוסיפו לפחות תאריך אחד</p>}
        {dates.map((d, idx) => {
          const dl = fmtDeadline(d.startDate);
          const dateLocked = lockedDateIds.has(String(d.id));
          // Max end date = startDate + 6 days (7-day window incl).
          const maxEndDate = d.startDate
            ? new Date(new Date(`${d.startDate}T00:00:00`).getTime() + 6 * 86400000).toISOString().slice(0,10)
            : undefined;
          return (
            <div key={d.id} style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr auto",gap:8,marginBottom:8,padding:8,border:"1px solid var(--border)",borderRadius:6,background:"var(--surface2)"}}>
              <div>
                <label className="form-label" style={{fontSize:11}}>התחלה (תאריך)</label>
                <input type="date" className="form-input" min={minShoot} value={d.startDate} disabled={dateLocked} onChange={e => {
                  const v = e.target.value;
                  if (!v) return;
                  if (v < minShoot) { showToast?.(`לא ניתן לבחור תאריך לפני ${minShoot} (מינימום 9 ימי עבודה מהיום)`, "error"); return; }
                  if (isWeekendISO(v)) { showToast?.("שישי/שבת אינם זמינים — המחסן סגור בסופי שבוע", "error"); return; }
                  const newMaxEnd = new Date(new Date(`${v}T00:00:00`).getTime() + 6 * 86400000).toISOString().slice(0,10);
                  let nextEnd = d.endDate || v;
                  if (nextEnd < v) nextEnd = v;
                  else if (nextEnd > newMaxEnd) nextEnd = newMaxEnd;
                  updateDate(idx, { startDate: v, endDate: nextEnd });
                }}/>
              </div>
              <div>
                <label className="form-label" style={{fontSize:11}}>התחלה (שעה)</label>
                <select className="form-input" value={snapToProductionSlot(d.startTime)} disabled={dateLocked} onChange={e => updateDate(idx, { startTime: e.target.value })}>
                  {PRODUCTION_TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label" style={{fontSize:11}}>סיום (תאריך)</label>
                <input type="date" className="form-input" min={d.startDate || minShoot} max={maxEndDate} value={d.endDate} disabled={dateLocked} onChange={e => {
                  const v = e.target.value;
                  if (!v) return;
                  if (v < minShoot) { showToast?.(`לא ניתן לבחור תאריך לפני ${minShoot} (מינימום 9 ימי עבודה מהיום)`, "error"); return; }
                  if (d.startDate && v < d.startDate) { showToast?.("תאריך סיום לא יכול להיות לפני תאריך התחלה", "error"); return; }
                  if (isWeekendISO(v)) { showToast?.("שישי/שבת אינם זמינים — המחסן סגור בסופי שבוע", "error"); return; }
                  if (maxEndDate && v > maxEndDate) {
                    showToast?.("טווח צילום מקסימלי 7 ימים", "error");
                    return;
                  }
                  updateDate(idx, { endDate: v });
                }}/>
              </div>
              <div>
                <label className="form-label" style={{fontSize:11}}>סיום (שעה)</label>
                <select className="form-input" value={snapToProductionSlot(d.endTime)} disabled={dateLocked} onChange={e => updateDate(idx, { endTime: e.target.value })}>
                  {PRODUCTION_TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={{display:"flex",alignItems:"end"}}>
                <button className="btn btn-secondary btn-sm btn-icon" onClick={() => removeDate(idx)}
                  disabled={dateLocked}
                  style={dateLocked ? {opacity:0.4,cursor:"not-allowed"} : undefined}>
                  <Trash2 size={14}/>
                </button>
              </div>
              {dateLocked && (
                <div style={{gridColumn:"1/-1",fontSize:13,fontWeight:700,color:"#2ecc71",background:"rgba(46,204,113,0.12)",border:"1px solid #2ecc71",borderRadius:6,padding:"6px 10px",marginTop:4,display:"flex",alignItems:"center",gap:6}}>
                  ✓ 🔒 הבטחת את מקומך — הוגשה רשימת ציוד לטווח הזה
                </div>
              )}
              {!dateLocked && dl && (() => {
                let text, color, bg, border;
                if (dl.diff > 0) {
                  text = `${dl.diff} ימים להגשת רשימת הציוד`;
                  if (dl.diff <= 3) { color = "#f5a623"; bg = "rgba(245,166,35,0.12)"; border = "rgba(245,166,35,0.4)"; }
                  else { color = "var(--text)"; bg = "var(--surface)"; border = "var(--border)"; }
                } else if (dl.diff === 0) {
                  text = "חובה עליך להגיש היום רשימת ציוד";
                  color = "#e74c3c"; bg = "rgba(231,76,60,0.15)"; border = "#e74c3c";
                } else {
                  text = `עבר הדדליין (${Math.abs(dl.diff)} ימים)`;
                  color = "#e74c3c"; bg = "rgba(231,76,60,0.15)"; border = "#e74c3c";
                }
                return (
                  <div style={{
                    gridColumn:"1/-1",
                    fontSize:13, color, fontWeight:700,
                    padding:"6px 10px", borderRadius:6,
                    background:bg, border:`1px solid ${border}`,
                    marginTop:4,
                    display:"flex", alignItems:"center", gap:6,
                  }}>
                    ⏱ {text}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* ── צוות ── */}
      <div style={{marginBottom:18}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <h4 style={{margin:0, color: errorField === "crew" ? "#e74c3c" : undefined}}>
            צוות {errorField === "crew" && <span style={{fontSize:12}}>⚠</span>}
          </h4>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {ROLE_ORDER.map(role => (
              <button key={role} className="btn btn-secondary btn-sm"
                onClick={() => { addCrew(role); if (errorField === "crew") setErrorField(null); }}
                title={role === "photographer" ? "חובה — צלם ראשי נדרש להגשת רשימת ציוד" : undefined}>
                <Plus size={12}/> {ROLE_LABELS[role]}
              </button>
            ))}
            <button className="btn btn-secondary btn-sm"
              onClick={() => { openCustomRolePrompt(); if (errorField === "crew") setErrorField(null); }}
              title="הוסף תפקיד עם שם מותאם (למשל: תאורן, צבע, מנהל הפקה)">
              <Plus size={12}/> תפקיד מותאם
            </button>
          </div>
        </div>
        <div style={{fontSize:13,color:"var(--text)",marginBottom:8,lineHeight:1.5,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:6,padding:"10px 12px"}}>
          🎥 <strong style={{color:"var(--accent)"}}>צלם ראשי מוסמך ורשום — חובה</strong>. בשלב השאלת הציוד המערכת בודקת הסמכות ציוד של הצלם הראשי ואיש הסאונד (אם קיים) — לא של הבמאי.
        </div>
        {crew.length === 0 && <p style={{color:"var(--text2)",fontSize:13}}>אין עדיין צוות. הוסיפו תפקיד מהכפתורים למעלה.</p>}
        {crew.map(c => {
          const isError = errorField === `crew:${c.id}`;
          const selectedStudent = c.studentId
            ? (sortedStudents.find(s => String(s.id) === String(c.studentId))
               || (students || []).find(s => String(s.id) === String(c.studentId))
               || null)
            : null;
          const displayName = c._typing !== undefined
            ? c._typing
            : (selectedStudent?.name || c.freeTextName || c.crewEmail || "");
          const datalistId = `students-list-${c.id}`;
          const trackRequirement = c.role === "photographer" ? "קולנוע"
                                  : c.role === "sound"        ? "סאונד"
                                  : null;
          const eligibleStudents = trackRequirement
            ? sortedStudents.filter(s => String(s.track || "").includes(trackRequirement))
            : sortedStudents;
          return (
            <div key={c.id} style={{display:"grid",gridTemplateColumns:"130px 1fr auto",gap:8,marginBottom:8,padding:8,border: isError ? "2px solid #e74c3c" : "1px solid var(--border)",borderRadius:6,alignItems:"center",background:"var(--surface2)"}}>
              <div style={{fontWeight:700}}>{getRoleLabel(c)}</div>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <input
                  className="form-input"
                  type="text"
                  list={datalistId}
                  autoComplete="off"
                  placeholder={
                    c.role === "photographer" ? "שם סטודנט (הנדסאי קולנוע בלבד)..."
                    : c.role === "sound"        ? "שם סטודנט (הנדסאי סאונד בלבד)..."
                    : "שם סטודנט או טקסט חופשי..."
                  }
                  value={displayName}
                  onChange={e => {
                    const v = e.target.value;
                    const match = eligibleStudents.find(s => s.name === v);
                    // Block adding the same student twice in the same production.
                    if (match && crew.some(other => other.id !== c.id && other.status !== "rejected" && String(other.studentId || "") === String(match.id))) {
                      showToast?.(`${match.name} כבר משויך לתפקיד אחר בהפקה הזו`, "error");
                      updateCrew(c.id, { _typing: "" });
                      return;
                    }
                    if (match) {
                      updateCrew(c.id, { studentId: match.id, freeTextName: null, crewEmail: match.email || null, status: "invited", _typing: undefined });
                    } else if (REQUIRES_STUDENT.has(c.role)) {
                      updateCrew(c.id, { studentId: null, freeTextName: null, crewEmail: null, _typing: v });
                    } else {
                      updateCrew(c.id, { studentId: null, freeTextName: v, crewEmail: null, status: "approved", _typing: v });
                    }
                    if (isError) setErrorField(null);
                  }}
                  style={{minWidth:240,flex:1}}
                />
                <datalist id={datalistId}>
                  {eligibleStudents.map(s => (
                    <option key={s.id} value={s.name}>{s.track ? s.track : ""}</option>
                  ))}
                </datalist>
                {c.invitedBy === "self" && c.crewEmail && (
                  <span style={{fontSize:11,color:"var(--text3)",whiteSpace:"nowrap"}}>· {c.crewEmail}</span>
                )}
                {selectedStudent?.track && (
                  <span style={{
                    fontSize:12, fontWeight:600, whiteSpace:"nowrap",
                    color:"var(--accent)",
                    background:"var(--accent-glow)",
                    border:"1px solid var(--accent)",
                    borderRadius:10, padding:"2px 8px",
                  }}>{selectedStudent.track}</span>
                )}
                {(() => {
                  const statusColor = c.status === "approved" ? "#2ecc71" : c.status === "invited" ? "#f5a623" : "#e74c3c";
                  const statusLabel = c.status === "approved" ? "מאושר" : c.status === "invited" ? "ממתין" : "נדחה";
                  return (
                    <span style={{
                      fontSize:12, fontWeight:700, whiteSpace:"nowrap",
                      color: statusColor,
                      background: c.status === "approved" ? "rgba(46,204,113,0.15)" : c.status === "invited" ? "rgba(245,166,35,0.15)" : "rgba(231,76,60,0.15)",
                      border: `1px solid ${statusColor}`,
                      borderRadius:10, padding:"2px 8px",
                    }}>{statusLabel}</span>
                  );
                })()}
                {c.status === "invited" && c.invitedBy === "self" && (
                  <>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => handleApproveCrew(c.id)} title="אשר בקשת הצטרפות">
                      <Check size={12}/> אשר
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleRejectCrew(c.id)} title="דחה בקשת הצטרפות" style={{color:"#e74c3c",borderColor:"#e74c3c"}}>
                      <XIcon size={12}/> דחה
                    </button>
                  </>
                )}
              </div>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => removeCrew(c.id)}><Trash2 size={14}/></button>
            </div>
          );
        })}
      </div>

      {customRolePrompt.open && (
        <Modal title="תפקיד מותאם חדש" onClose={() => setCustomRolePrompt({ open: false, value: "" })} footer={
          <div style={{display:"flex",gap:8,justifyContent:"end"}}>
            <button className="btn btn-secondary btn-sm" onClick={() => setCustomRolePrompt({ open: false, value: "" })}>ביטול</button>
            <button className="btn btn-primary btn-sm" disabled={!customRolePrompt.value.trim()} onClick={confirmCustomRole}>
              הוסף תפקיד
            </button>
          </div>
        }>
          <div style={{marginBottom:8}}>
            <label className="form-label">שם התפקיד</label>
            <input
              className="form-input"
              autoFocus
              maxLength={40}
              placeholder="לדוגמה: תאורן, צבע, מנהל הפקה"
              value={customRolePrompt.value}
              onChange={e => setCustomRolePrompt(p => ({ ...p, value: e.target.value.slice(0, 40) }))}
              onKeyDown={e => { if (e.key === "Enter" && customRolePrompt.value.trim()) confirmCustomRole(); }}
            />
            <div style={{fontSize:11,color:"var(--text3)",marginTop:6,textAlign:"left"}}>
              {customRolePrompt.value.length}/40
            </div>
          </div>
        </Modal>
      )}

      {deleteConfirm && (
        <Modal title="אישור מחיקת הפקה" onClose={() => setDeleteConfirm(null)} footer={
          <div style={{display:"flex",gap:8,justifyContent:"end"}}>
            <button className="btn btn-secondary btn-sm" onClick={() => setDeleteConfirm(null)}>ביטול</button>
            <button className="btn btn-danger btn-sm" onClick={onDelete} style={{background:"#e74c3c",color:"#fff"}}>
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
                <p style={{margin:"8px 0",fontSize:13,color:"var(--text3)"}}>אין השאלות ציוד מקושרות.</p>
              )}
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
