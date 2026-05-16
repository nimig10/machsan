// ProductionsPage — לוח הפקות. Three tabs: public board, my productions, new.
// Visible to all roles; behaviour differs for the logged-in director.

import { useMemo, useState } from "react";
import { Plus, Film, Users, Calendar as CalendarIcon, Inbox, Check, X as XIcon, ExternalLink, ChevronRight, ChevronLeft } from "lucide-react";
import { Modal } from "./ui.jsx";
import { ProductionEditor } from "./ProductionEditor.jsx";
import { CalendarGrid } from "./CalendarGrid.jsx";
import { today } from "../utils.js";
import {
  approveCrewMember,
  rejectCrewMember,
  requestJoinProduction,
  withdrawJoinRequest,
} from "../utils/productionsApi.js";

const REQUEST_NOTES_MAX = 250;

const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
const HE_WEEKDAYS = ["א'","ב'","ג'","ד'","ה'","ו'","ש'"];

const DEFAULT_PRODUCTION_COLOR = "#e67e22";

// Helpers to derive calendar bar colors from a hex picked by the director.
function hexToRgba(hex, alpha) {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex || "");
  if (!m) return `rgba(230,126,34,${alpha})`;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
// Light backgrounds (e.g., yellow) need black text; darker ones need white.
function pickTextColor(hex) {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex || "");
  if (!m) return "#fff";
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.65 ? "#000" : "#fff";
}

// Production status label — intentionally NOT "מאושר" since production publish ≠ loan approval.
// A production is just publicly visible after publish; equipment loan still goes through
// dept-head + warehouse approval with the regular 9-day-ahead rule.
function ProductionStatusBadge({ status }) {
  const label = status === "published" ? "מפורסם" : status === "cancelled" ? "מבוטל" : "טיוטה";
  const colorVar = status === "published"
    ? "var(--accent)"
    : status === "cancelled" ? "#e74c3c" : "var(--text3)";
  return (
    <span style={{
      fontSize:11, padding:"2px 8px", borderRadius:10,
      border:`1px solid ${colorVar}`, color:colorVar,
      background:"transparent", whiteSpace:"nowrap", flexShrink:0,
    }}>{label}</span>
  );
}

// Only photographer + sound are predefined — the equipment-loan certification
// check validates exactly these two; everything else is a free-text "custom" role.
const ROLE_LABELS = {
  photographer: "צלם ראשי",
  sound:        "איש סאונד",
};
const ROLE_ORDER = ["photographer","sound"];
function getRoleLabel(c) {
  if (c?.role === "custom") return c.roleLabel || "תפקיד מותאם";
  return ROLE_LABELS[c?.role] || c?.role || "";
}

function fmtDate(d) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("he-IL", { day:"2-digit", month:"2-digit", year:"numeric" });
  } catch { return d; }
}
function nextDateOf(p) {
  const dates = (p?.dates || []).map(d => `${d.startDate}T${d.startTime || "00:00"}`).filter(Boolean);
  if (dates.length === 0) return null;
  dates.sort();
  return dates[0];
}

// Returns { daysToShoot, daysToDeadline, tier } for the EARLIEST upcoming shoot date.
// Deadline = shoot date − 8 calendar days (inclusive "9 days notice" policy).
//   tier: "safe" (>0d) | "today" (=0) | "overdue" (<0) | "past" (shoot already happened)
function equipmentDeadline(p) {
  const next = nextDateOf(p);
  if (!next) return null;
  const shoot = new Date(next.slice(0,10) + "T00:00:00");
  const today = new Date();
  today.setHours(0,0,0,0);
  const daysToShoot = Math.floor((shoot - today) / (24*3600*1000));
  if (daysToShoot < 0) return { daysToShoot, daysToDeadline: daysToShoot + 8, tier: "past", shootDate: next.slice(0,10) };
  const daysToDeadline = daysToShoot - 8;
  let tier;
  if (daysToDeadline > 0) tier = "safe";
  else if (daysToDeadline === 0) tier = "today";
  else if (daysToShoot >= 0) tier = "overdue";
  return { daysToShoot, daysToDeadline, tier, shootDate: next.slice(0,10) };
}

function DeadlineChip({ p }) {
  const info = equipmentDeadline(p);
  if (!info) return null;
  const { daysToShoot, daysToDeadline, tier } = info;
  let label, color, bg;
  if (tier === "past") {
    label = "ההפקה הסתיימה";
    color = "var(--text3)";
    bg = "transparent";
  } else if (tier === "safe") {
    label = `${daysToDeadline} ימים עד דדליין רשימת ציוד`;
    color = "#2ecc71";
    bg = "rgba(46,204,113,0.12)";
  } else if (tier === "today") {
    label = "היום הוא היום האחרון להגיש רשימת ציוד";
    color = "#f5a623";
    bg = "rgba(245,166,35,0.15)";
  } else { // overdue
    label = `עבר הדדליין • נותרו ${daysToShoot} ימים לצילום`;
    color = "#e74c3c";
    bg = "rgba(231,76,60,0.15)";
  }
  return (
    <div style={{
      fontSize:11, fontWeight:700,
      padding:"4px 8px", borderRadius:6,
      color, background:bg,
      border:`1px solid ${color}`,
      display:"inline-flex", alignItems:"center", gap:4,
    }}>
      ⏱ {label}
    </div>
  );
}

function ProductionCard({ p, onClick }) {
  const next = nextDateOf(p);
  const approved = (p.crew || []).filter(c => c.status === "approved");
  const crewByRole = approved.reduce((acc, c) => { acc[c.role] = (acc[c.role] || 0) + 1; return acc; }, {});
  const customApproved = approved.filter(c => c.role === "custom");
  const accentColor = p.color || DEFAULT_PRODUCTION_COLOR;
  return (
    <div onClick={onClick} style={{
      border:"1px solid var(--border)",
      borderInlineStartWidth: 5,
      borderInlineStartColor: accentColor,
      borderRadius:8, padding:14, cursor:"pointer",
      background:"var(--surface2)", color:"var(--text)",
      transition:"box-shadow 0.15s, border-color 0.15s",
    }}
    onMouseEnter={(e) => { e.currentTarget.style.boxShadow = `0 0 0 1px ${accentColor}`; }}
    onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; }}
    >
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:8,gap:8}}>
        <h4 style={{margin:0,fontSize:16,color:accentColor}}>{p.title}</h4>
        <ProductionStatusBadge status={p.status}/>
      </div>
      <div style={{fontSize:13,color:"var(--text2)",marginBottom:4}}>במאי: {p.directorName}</div>
      {next && <div style={{fontSize:13,color:"var(--text2)",marginBottom:8}}>תאריך קרוב: {fmtDate(next.slice(0,10))}</div>}
      <div style={{marginBottom:6}}><DeadlineChip p={p}/></div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8,fontSize:11}}>
        {ROLE_ORDER.map(role => crewByRole[role] ? (
          <span key={role} style={{background:"var(--accent-glow)",color:"var(--accent)",padding:"2px 8px",borderRadius:10,border:"1px solid var(--border)"}}>{ROLE_LABELS[role]}</span>
        ) : null)}
        {customApproved.map(c => (
          <span key={c.id} style={{background:"var(--accent-glow)",color:"var(--accent)",padding:"2px 8px",borderRadius:10,border:"1px solid var(--border)"}}>{getRoleLabel(c)}</span>
        ))}
      </div>
    </div>
  );
}

function ProductionDetail({ p, currentStudent, students, onClose, onEdit, onJoinRequest, onOpenLoanForm }) {
  if (!p) return null;
  const isDirector = currentStudent && p.directorEmail &&
    String(currentStudent.email || "").toLowerCase() === String(p.directorEmail).toLowerCase();
  const myStudentId = currentStudent?.id;
  const alreadyMember = (p.crew || []).some(c => c.studentId === myStudentId || c.crewEmail?.toLowerCase() === String(currentStudent?.email || "").toLowerCase());
  const hasApprovedPhotographer = (p.crew || []).some(c => c.role === "photographer" && c.status === "approved" && c.studentId);

  return (
    <Modal title={p.title} onClose={onClose} size="modal-lg" footer={
      <div style={{display:"flex",gap:8,justifyContent:"space-between",flexWrap:"wrap"}}>
        <div>
          {isDirector && (
            <button className="btn btn-secondary btn-sm" onClick={() => onEdit(p)}>עריכה</button>
          )}
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {isDirector && p.status === "published" && !hasApprovedPhotographer && (
            <span style={{fontSize:12,color:"#e74c3c"}} title="חובה לרשום צלם לפני שאפשר להתקדם להשאלת ציוד">
              ⚠ חסר צלם
            </span>
          )}
          {isDirector && p.status === "published" && hasApprovedPhotographer && (
            <button className="btn btn-primary btn-sm" onClick={() => onOpenLoanForm(p)}>
              <ExternalLink size={14}/> השאלת ציוד להפקה
            </button>
          )}
          {!isDirector && !alreadyMember && currentStudent?.id && p.status === "published" && (
            <button className="btn btn-primary btn-sm" onClick={() => onJoinRequest(p)}>
              <Users size={14}/> אני רוצה להצטרף
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={onClose}>סגירה</button>
        </div>
      </div>
    }>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:16,fontWeight:700,color:"var(--text)",marginBottom:10}}>
          <span style={{color:"var(--text3)",fontWeight:500,marginInlineEnd:6}}>במאי:</span>{p.directorName}
        </div>
        <DeadlineChip p={p}/>
        {p.description && (
          <p style={{whiteSpace:"pre-wrap",marginTop:10,fontSize:14,lineHeight:1.5,color:"var(--text)"}}>{p.description}</p>
        )}
        {p.driveUrl && (
          <a href={p.driveUrl} target="_blank" rel="noopener noreferrer"
            style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:10,padding:"6px 12px",borderRadius:6,border:"1px solid var(--accent)",color:"var(--accent)",textDecoration:"none",fontSize:13,fontWeight:700,background:"var(--accent-glow)"}}>
            📄 צפה בתסריט/סינופסיס <ExternalLink size={12}/>
          </a>
        )}
      </div>

      <h5 style={{margin:"12px 0 6px",color:"var(--accent)"}}><CalendarIcon size={14} style={{verticalAlign:"middle"}}/> תאריכי צילום</h5>
      {(p.dates || []).length === 0 ? <p style={{color:"var(--text3)",fontSize:13}}>אין תאריכים</p> : (
        <ul style={{margin:0,paddingInlineStart:20,fontSize:13,color:"var(--text)"}}>
          {p.dates.map(d => (
            <li key={d.id}>
              {fmtDate(d.startDate)} {d.startTime} – {d.startDate === d.endDate ? "" : fmtDate(d.endDate) + " "}{d.endTime}
              {d.note ? <span style={{color:"var(--text3)"}}> — {d.note}</span> : null}
            </li>
          ))}
        </ul>
      )}

      <h5 style={{margin:"12px 0 6px",color:"var(--accent)"}}><Users size={14} style={{verticalAlign:"middle"}}/> צוות</h5>
      {ROLE_ORDER.map(role => {
        const inRole = (p.crew || []).filter(c => c.role === role);
        if (inRole.length === 0) return (
          <div key={role} style={{fontSize:13,marginBottom:4,color:"var(--text)"}}>
            <strong>{ROLE_LABELS[role]}:</strong> <span style={{color:"var(--text3)"}}>— פנוי —</span>
          </div>
        );
        return inRole.map(c => {
          const stu = students.find(s => String(s.id) === String(c.studentId));
          const name = stu?.name || c.freeTextName || "?";
          return (
            <div key={c.id} style={{fontSize:13,marginBottom:4,display:"flex",alignItems:"center",gap:6,color:"var(--text)"}}>
              <strong>{ROLE_LABELS[role]}:</strong>
              <span>{name}</span>
              <span style={{
                fontSize:11,
                padding:"1px 6px",
                borderRadius:8,
                border: `1px solid ${c.status === "approved" ? "rgba(46,204,113,0.4)" : c.status === "invited" ? "rgba(245,166,35,0.4)" : "rgba(231,76,60,0.4)"}`,
                background: c.status === "approved" ? "rgba(46,204,113,0.15)" : c.status === "invited" ? "rgba(245,166,35,0.15)" : "rgba(231,76,60,0.15)",
                color: c.status === "approved" ? "#2ecc71" : c.status === "invited" ? "#f5a623" : "#e74c3c",
              }}>
                {c.status === "approved" ? "מאושר" : c.status === "invited" ? "ממתין" : "נדחה"}
              </span>
            </div>
          );
        });
      })}
      {/* Custom (free-text) crew roles — display after the 5 standard ones */}
      {(p.crew || []).filter(c => c.role === "custom").map(c => {
        const stu = students.find(s => String(s.id) === String(c.studentId));
        const name = stu?.name || c.freeTextName || "?";
        return (
          <div key={c.id} style={{fontSize:13,marginBottom:4,display:"flex",alignItems:"center",gap:6,color:"var(--text)"}}>
            <strong>{getRoleLabel(c)}:</strong>
            <span>{name}</span>
            <span style={{
              fontSize:11, padding:"1px 6px", borderRadius:8,
              border: `1px solid ${c.status === "approved" ? "rgba(46,204,113,0.4)" : c.status === "invited" ? "rgba(245,166,35,0.4)" : "rgba(231,76,60,0.4)"}`,
              background: c.status === "approved" ? "rgba(46,204,113,0.15)" : c.status === "invited" ? "rgba(245,166,35,0.15)" : "rgba(231,76,60,0.15)",
              color: c.status === "approved" ? "#2ecc71" : c.status === "invited" ? "#f5a623" : "#e74c3c",
            }}>
              {c.status === "approved" ? "מאושר" : c.status === "invited" ? "ממתין" : "נדחה"}
            </span>
          </div>
        );
      })}
    </Modal>
  );
}

function JoinRequestDialog({ p, currentStudent, existingRequest, onClose, onConfirm, showToast }) {
  const isEdit = !!existingRequest;
  // Cap photographer/sound at N (number of shoot date ranges) — a production
  // with multiple ranges can have one of each role per range.
  const dateCount = Math.max(1, (p.dates || []).length);
  const approvedCount = useMemo(() => {
    const counts = { photographer: 0, sound: 0 };
    for (const c of (p.crew || [])) {
      if (c.status !== "approved") continue;
      if (c.id === existingRequest?.id) continue; // edit: exclude self
      if (c.role in counts) counts[c.role]++;
    }
    return counts;
  }, [p, existingRequest]);
  const available = useMemo(() => {
    const list = [];
    if (approvedCount.photographer < dateCount) list.push("photographer");
    if (approvedCount.sound < dateCount) list.push("sound");
    list.push("custom");
    return list;
  }, [approvedCount, dateCount]);
  const [role, setRole] = useState(existingRequest?.role || available[0] || "custom");
  const [customLabel, setCustomLabel] = useState(existingRequest?.roleLabel || "");
  const [notes, setNotes] = useState(existingRequest?.notes || "");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (submitting) return;
    if (role === "custom" && !customLabel.trim()) {
      showToast?.("חובה לרשום שם תפקיד עבור 'תפקיד מותאם'", "error");
      return;
    }
    setSubmitting(true);
    if (isEdit) {
      const del = await withdrawJoinRequest(existingRequest.id);
      if (!del.ok) {
        setSubmitting(false);
        showToast?.(`שגיאה בעדכון הבקשה: ${del.error}`, "error");
        return;
      }
    }
    const res = await requestJoinProduction(p.id, role, {
      studentId: currentStudent.id,
      roleLabel: role === "custom" ? customLabel.trim().slice(0, 40) : null,
      freeTextName: null,
      crewEmail: currentStudent.email,
      notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (!res.ok) {
      showToast?.(`שגיאה: ${res.error}`, "error");
      return;
    }
    showToast?.(isEdit ? "הבקשה עודכנה" : "הבקשה נשלחה לבמאי", "success");
    onConfirm();
  }

  return (
    <Modal title={`${isEdit ? "עריכת" : ""} בקשת הצטרפות להפקה: ${p.title}`} onClose={onClose} footer={
      <div style={{display:"flex",gap:8,justifyContent:"end"}}>
        <button className="btn btn-secondary btn-sm" onClick={onClose}>ביטול</button>
        <button className="btn btn-primary btn-sm" disabled={submitting} onClick={submit}>
          {isEdit ? "עדכן בקשה" : "שלח בקשה"}
        </button>
      </div>
    }>
      <div style={{marginBottom:12}}>
        <label className="form-label">תפקיד</label>
        <select className="form-input" value={role} onChange={e => setRole(e.target.value)}>
          {available.map(r => (
            <option key={r} value={r}>
              {r === "custom" ? "תפקיד מותאם (תיאור חופשי)" : ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      {role === "custom" && (
        <div style={{marginBottom:12}}>
          <label className="form-label" style={{display:"flex",justifyContent:"space-between"}}>
            <span>שם התפקיד *</span>
            <span style={{color: customLabel.length >= 40 ? "#e74c3c" : "var(--text3)", fontSize:11}}>{customLabel.length}/40</span>
          </label>
          <input
            className="form-input"
            maxLength={40}
            placeholder="לדוגמה: תאורן, צבע, מנהל הפקה"
            value={customLabel}
            onChange={e => setCustomLabel(e.target.value.slice(0,40))}
          />
        </div>
      )}
      <div style={{marginBottom:12}}>
        <label className="form-label" style={{display:"flex",justifyContent:"space-between"}}>
          <span>הערה לבמאי (אופציונלי)</span>
          <span style={{color: notes.length >= REQUEST_NOTES_MAX ? "#e74c3c" : "var(--text3)", fontSize:11}}>
            {notes.length}/{REQUEST_NOTES_MAX}
          </span>
        </label>
        <textarea className="form-input" rows={3} maxLength={REQUEST_NOTES_MAX}
          value={notes}
          onChange={e => setNotes(e.target.value.slice(0, REQUEST_NOTES_MAX))}
          placeholder="מה את/ה רוצה לעשות בפרויקט?"/>
      </div>
    </Modal>
  );
}

export function ProductionsPage({ productions = [], currentStudent, students = [], reservations = [], showToast, onOpenLoanForm, refresh }) {
  const [tab, setTab]                     = useState("board"); // board | mine | inbox
  const [calDate, setCalDate]             = useState(() => new Date());
  const [editorOpen, setEditorOpen]       = useState(null);    // { initial: ... } | null
  const [detail, setDetail]               = useState(null);
  const [joinTarget, setJoinTarget]       = useState(null);

  const myEmail = String(currentStudent?.email || "").toLowerCase();
  // Only cinema-track students can create productions. Sound students (and any
  // other track) can still join existing productions, but the "+ הפקה חדשה"
  // button is hidden for them.
  const canCreateProductions = !!currentStudent?.track &&
    String(currentStudent.track).includes("קולנוע");

  const myDirectorProds = useMemo(() =>
    productions.filter(p => p.directorEmail?.toLowerCase() === myEmail),
    [productions, myEmail]);
  const myCrewProds = useMemo(() =>
    productions.filter(p => p.directorEmail?.toLowerCase() !== myEmail &&
      (p.crew || []).some(c => c.crewEmail?.toLowerCase() === myEmail && c.status === "approved")),
    [productions, myEmail]);
  const inboxRequests = useMemo(() => {
    const out = [];
    for (const p of myDirectorProds) {
      for (const c of (p.crew || [])) {
        if (c.status === "invited" && c.invitedBy === "self") out.push({ production: p, crew: c });
      }
    }
    return out;
  }, [myDirectorProds]);

  // Outgoing: requests I sent to productions where I'm NOT the director.
  // Includes both still-pending ("invited") and rejected — so the user sees the
  // full history of their requests.
  const outgoingRequests = useMemo(() => {
    if (!myEmail) return { pending: [], rejected: [] };
    const pending = [], rejected = [];
    for (const p of productions) {
      if (p.directorEmail?.toLowerCase() === myEmail) continue; // mine = inbox
      for (const c of (p.crew || [])) {
        if (c.crewEmail?.toLowerCase() !== myEmail) continue;
        if (c.invitedBy !== "self") continue;
        if (c.status === "invited") pending.push({ production: p, crew: c });
        else if (c.status === "rejected") rejected.push({ production: p, crew: c });
      }
    }
    return { pending, rejected };
  }, [productions, myEmail]);

  // Incoming invitations: directors offered ME a role. status='invited', invitedBy='director'.
  const incomingInvitations = useMemo(() => {
    if (!myEmail) return [];
    const out = [];
    for (const p of productions) {
      if (p.directorEmail?.toLowerCase() === myEmail) continue;
      for (const c of (p.crew || [])) {
        if (c.crewEmail?.toLowerCase() !== myEmail) continue;
        if (c.status === "invited" && c.invitedBy === "director") {
          out.push({ production: p, crew: c });
        }
      }
    }
    return out;
  }, [productions, myEmail]);

  const totalRequestsCount = inboxRequests.length + outgoingRequests.pending.length + incomingInvitations.length;

  const [editRequestTarget, setEditRequestTarget] = useState(null); // { production, crew } | null

  const published = useMemo(() => productions.filter(p => p.status === "published"), [productions]);

  function openEditor(initial) {
    setEditorOpen({ initial: initial || null });
  }
  function closeEditor() { setEditorOpen(null); refresh?.(); }

  return (
    <div style={{padding:"0 20px"}}>
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",gap:6}}>
          <button onClick={() => setTab("board")} className={tab === "board" ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}>
            <Film size={14}/> לוח הפקות {published.length ? `(${published.length})` : ""}
          </button>
          {currentStudent?.id && (
            <button onClick={() => setTab("mine")} className={tab === "mine" ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}>
              <Users size={14}/> שלי {(myDirectorProds.length + myCrewProds.length) ? `(${myDirectorProds.length + myCrewProds.length})` : ""}
            </button>
          )}
          {currentStudent?.id && (
            <button onClick={() => setTab("inbox")} className={tab === "inbox" ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}>
              <Inbox size={14}/> בקשות הפקה {totalRequestsCount ? `(${totalRequestsCount})` : ""}
            </button>
          )}
        </div>
        {currentStudent?.id && canCreateProductions && (
          <button className="btn btn-primary btn-sm" onClick={() => openEditor(null)}>
            <Plus size={14}/> הפקה חדשה
          </button>
        )}
      </div>

      {tab === "board" && (
        <div>
          {/* Productions list (cards) */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12,marginBottom:24}}>
            {published.length === 0 ? <p style={{color:"var(--text3)"}}>אין כרגע הפקות מפורסמות</p> :
              published.map(p => <ProductionCard key={p.id} p={p} onClick={() => setDetail(p)}/>)}
          </div>

          {/* Production schedule (monthly calendar) */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,paddingTop:10,borderTop:"1px solid var(--border)"}}>
            <CalendarIcon size={16} color="var(--accent)"/>
            <h3 style={{margin:0,fontSize:16,color:"var(--accent)"}}>שיבוצי הפקות</h3>
          </div>

          {(() => {
            const yr = calDate.getFullYear();
            const mo = calDate.getMonth();
            const days = [];
            const outOfMonthDays = [];
            const startOffset = new Date(yr, mo, 1).getDay();
            const prevMonthLastDay = new Date(yr, mo, 0).getDate();
            for (let i = 0; i < startOffset; i++) {
              days.push(null);
              outOfMonthDays.push(new Date(yr, mo-1, prevMonthLastDay - (startOffset-1-i)));
            }
            const lastDay = new Date(yr, mo+1, 0).getDate();
            for (let d = 1; d <= lastDay; d++) {
              days.push(new Date(yr, mo, d));
              outOfMonthDays.push(null);
            }
            let nextDay = 1;
            while (days.length < 42) {
              days.push(null);
              outOfMonthDays.push(new Date(yr, mo+1, nextDay++));
            }
            const productionBlocks = published.flatMap(prod =>
              (prod.dates || []).map(d => ({
                id: `${prod.id}__${d.id}`,
                student_name: prod.title,
                borrow_date: d.startDate,
                return_date: d.endDate,
                borrow_time: d.startTime,
                return_time: d.endTime,
                loan_type: "הפקה",
                _productionId: prod.id,
                _color: prod.color || DEFAULT_PRODUCTION_COLOR,
              }))
            );
            const colorMap = {};
            productionBlocks.forEach(b => {
              colorMap[b.id] = [hexToRgba(b._color, 0.75), pickTextColor(b._color)];
            });
            return (
              <div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:12,marginBottom:10}}>
                  <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setCalDate(new Date(yr, mo-1, 1))}><ChevronRight size={16}/></button>
                  <div style={{fontWeight:900,fontSize:16,minWidth:160,textAlign:"center"}}>{HE_MONTHS[mo]} {yr}</div>
                  <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setCalDate(new Date(yr, mo+1, 1))}><ChevronLeft size={16}/></button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setCalDate(new Date())} style={{marginInlineStart:8}}>היום</button>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:4,direction:"rtl"}}>
                  {HE_WEEKDAYS.map(w => (
                    <div key={w} style={{textAlign:"center",fontWeight:700,fontSize:12,color:"var(--text3)",padding:"4px 0"}}>{w}</div>
                  ))}
                </div>
                <CalendarGrid
                  days={days}
                  outOfMonthDays={outOfMonthDays}
                  activeRes={productionBlocks}
                  colorMap={colorMap}
                  todayStr={today()}
                  cellHeight={90}
                  fontSize={11}
                  onBarClick={(b) => {
                    const prod = productions.find(p => p.id === b._productionId);
                    if (prod) setDetail(prod);
                  }}
                />
                {productionBlocks.length === 0 && (
                  <p style={{color:"var(--text3)",textAlign:"center",marginTop:14}}>אין הפקות מפורסמות בחודש זה</p>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {tab === "mine" && (
        <div>
          {myDirectorProds.length > 0 && (
            <>
              <h4 style={{marginTop:0}}>אני במאי/ת</h4>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12,marginBottom:18}}>
                {myDirectorProds.map(p => <ProductionCard key={p.id} p={p} onClick={() => setDetail(p)}/>)}
              </div>
            </>
          )}
          {myCrewProds.length > 0 && (
            <>
              <h4>אני בצוות</h4>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
                {myCrewProds.map(p => <ProductionCard key={p.id} p={p} onClick={() => setDetail(p)}/>)}
              </div>
            </>
          )}
          {myDirectorProds.length === 0 && myCrewProds.length === 0 && (
            <p style={{color:"var(--text3)"}}>עוד לא הצטרפת לאף הפקה. אפשר ליצור חדשה או להירשם דרך לוח ההפקות.</p>
          )}
        </div>
      )}

      {tab === "inbox" && (
        <div>
          {/* ── INCOMING: unified — director invitations to me + self-enrollment to my productions ── */}
          {(() => {
            const incomingTotal = inboxRequests.length + incomingInvitations.length;
            return (
              <>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                  <Inbox size={16} color="var(--accent)"/>
                  <h3 style={{margin:0,fontSize:15,color:"var(--accent)"}}>בקשות נכנסות {incomingTotal ? `(${incomingTotal})` : ""}</h3>
                </div>
                {incomingTotal === 0 ? (
                  <p style={{color:"var(--text3)",marginBottom:24}}>אין בקשות או הזמנות ממתינות.</p>
                ) : (
                  <div style={{marginBottom:24}}>
                    {/* Director invitations to me (I'm the invitee) */}
                    {incomingInvitations.map(({ production, crew }) => {
                      const roleLabel = getRoleLabel(crew);
                      const accentColor = production.color || DEFAULT_PRODUCTION_COLOR;
                      return (
                        <div key={crew.id} style={{
                          border:"1px solid var(--border)", borderInlineStartWidth:5,
                          borderInlineStartColor: accentColor,
                          background:"var(--surface2)", borderRadius:6, padding:12, marginBottom:8,
                          display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, flexWrap:"wrap"
                        }}>
                          <div style={{color:"var(--text)"}}>
                            <div style={{fontSize:11,color:"var(--text3)",marginBottom:2}}>הזמנה מבמאי</div>
                            <div>הבמאי <strong>{production.directorName}</strong> מזמין אותך להפקה <strong>{production.title}</strong> בתפקיד <strong>{roleLabel}</strong></div>
                            {crew.notes && <div style={{fontSize:13,color:"var(--text2)",marginTop:4}}>הערה: "{crew.notes}"</div>}
                          </div>
                          <div style={{display:"flex",gap:6}}>
                            <button className="btn btn-primary btn-sm" onClick={async () => {
                              const r = await approveCrewMember(crew.id);
                              if (!r.ok) showToast?.(`שגיאה: ${r.error}`, "error");
                              else { showToast?.("אישרת השתתפות בהפקה", "success"); refresh?.(); }
                            }}><Check size={14}/> אשר השתתפות</button>
                            <button className="btn btn-secondary btn-sm" onClick={async () => {
                              const r = await rejectCrewMember(crew.id);
                              if (!r.ok) showToast?.(`שגיאה: ${r.error}`, "error");
                              else { showToast?.("דחית את ההזמנה", "success"); refresh?.(); }
                            }} style={{color:"#e74c3c",borderColor:"#e74c3c"}}><XIcon size={14}/> דחה</button>
                          </div>
                        </div>
                      );
                    })}
                    {/* Self-enrollment requests to my productions (I'm the director) */}
                    {inboxRequests.map(({ production, crew }) => {
                      const stu = students.find(s => String(s.id) === String(crew.studentId));
                      return (
                        <div key={crew.id} style={{border:"1px solid var(--border)",background:"var(--surface2)",borderRadius:6,padding:12,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                          <div style={{color:"var(--text)"}}>
                            <div style={{fontSize:11,color:"var(--text3)",marginBottom:2}}>בקשת הצטרפות להפקה שלך</div>
                            <div><strong>{stu?.name || crew.freeTextName || crew.crewEmail}</strong> מבקש/ת להצטרף ל-<strong>{production.title}</strong> כ-{getRoleLabel(crew)}</div>
                            {crew.notes && <div style={{fontSize:13,color:"var(--text2)",marginTop:4}}>"{crew.notes}"</div>}
                          </div>
                          <div style={{display:"flex",gap:6}}>
                            <button className="btn btn-primary btn-sm" onClick={async () => {
                              const r = await approveCrewMember(crew.id);
                              if (!r.ok) showToast?.(`שגיאה: ${r.error}`, "error");
                              else { showToast?.("אושר", "success"); refresh?.(); }
                            }}><Check size={14}/> אשר</button>
                            <button className="btn btn-secondary btn-sm" onClick={async () => {
                              const r = await rejectCrewMember(crew.id);
                              if (!r.ok) showToast?.(`שגיאה: ${r.error}`, "error");
                              else { showToast?.("נדחה", "success"); refresh?.(); }
                            }}><XIcon size={14}/> דחה</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            );
          })()}

          {/* ── OUTGOING: requests I sent to other directors ── */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,paddingTop:8,borderTop:"1px solid var(--border)"}}>
            <ExternalLink size={16} color="var(--accent)"/>
            <h3 style={{margin:0,fontSize:15,color:"var(--accent)"}}>
              בקשות יוצאות {outgoingRequests.pending.length ? `(${outgoingRequests.pending.length})` : ""}
            </h3>
          </div>
          {outgoingRequests.pending.length === 0 && outgoingRequests.rejected.length === 0 ? (
            <p style={{color:"var(--text3)"}}>לא שלחת בקשות הצטרפות להפקות אחרות.</p>
          ) : (
            <>
              {outgoingRequests.pending.map(({ production, crew }) => (
                <div key={crew.id} style={{border:"1px solid var(--border)",background:"var(--surface2)",borderRadius:6,padding:12,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <div style={{color:"var(--text)"}}>
                    <div>שלחת בקשה ל-<strong>{production.title}</strong> (במאי: {production.directorName}) כ-{getRoleLabel(crew)}</div>
                    {crew.notes && <div style={{fontSize:13,color:"var(--text2)",marginTop:4}}>"{crew.notes}"</div>}
                    <div style={{fontSize:11,color:"#f5a623",marginTop:4}}>⏳ ממתין לאישור הבמאי</div>
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditRequestTarget({ production, crew })}>
                      ערוך
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={async () => {
                      const r = await withdrawJoinRequest(crew.id);
                      if (!r.ok) showToast?.(`שגיאה: ${r.error}`, "error");
                      else { showToast?.("הבקשה בוטלה", "success"); refresh?.(); }
                    }} style={{color:"#e74c3c",borderColor:"#e74c3c"}}>
                      <XIcon size={14}/> בטל בקשה
                    </button>
                  </div>
                </div>
              ))}
              {outgoingRequests.rejected.map(({ production, crew }) => (
                <div key={crew.id} style={{border:"1px solid rgba(231,76,60,0.4)",background:"rgba(231,76,60,0.06)",borderRadius:6,padding:12,marginBottom:8,color:"var(--text)"}}>
                  <div>הבקשה שלך ל-<strong>{production.title}</strong> כ-{getRoleLabel(crew)} <span style={{color:"#e74c3c"}}>נדחתה</span></div>
                  {crew.notes && <div style={{fontSize:13,color:"var(--text2)",marginTop:4}}>"{crew.notes}"</div>}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {editorOpen && (
        <ProductionEditor
          initial={editorOpen.initial}
          currentStudent={currentStudent}
          students={students}
          reservations={reservations}
          showToast={showToast}
          onClose={closeEditor}
          onSaved={() => refresh?.()}
          onDeleted={() => refresh?.()}
          onOpenLoanForm={(blob) => { setEditorOpen(null); onOpenLoanForm?.(blob); }}
        />
      )}

      {detail && !editorOpen && (
        <ProductionDetail
          p={detail}
          currentStudent={currentStudent}
          students={students}
          onClose={() => setDetail(null)}
          onEdit={(p) => { setDetail(null); openEditor(p); }}
          onJoinRequest={(p) => setJoinTarget(p)}
          onOpenLoanForm={(p) => { setDetail(null); onOpenLoanForm?.(p); }}
        />
      )}

      {joinTarget && (
        <JoinRequestDialog
          p={joinTarget}
          currentStudent={currentStudent}
          showToast={showToast}
          onClose={() => setJoinTarget(null)}
          onConfirm={() => { setJoinTarget(null); setDetail(null); refresh?.(); }}
        />
      )}

      {editRequestTarget && (
        <JoinRequestDialog
          p={editRequestTarget.production}
          existingRequest={editRequestTarget.crew}
          currentStudent={currentStudent}
          showToast={showToast}
          onClose={() => setEditRequestTarget(null)}
          onConfirm={() => { setEditRequestTarget(null); refresh?.(); }}
        />
      )}
    </div>
  );
}
