// ProductionsPage — לוח הפקות. Three tabs: public board, my productions, new.
// Visible to all roles; behaviour differs for the logged-in director.

import { useMemo, useState, useEffect } from "react";
import { Plus, Film, Users, Calendar as CalendarIcon, Inbox, Check, X as XIcon, ExternalLink, ChevronRight, ChevronLeft, Archive } from "lucide-react";
import { Modal } from "./ui.jsx";
import { ProductionEditor } from "./ProductionEditor.jsx";
import { CalendarGrid } from "./CalendarGrid.jsx";
import { today, formatTime } from "../utils.js";
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
// Ended/archived productions render in a clear neutral gray (card accent + calendar
// bar) so users instantly tell them apart from active productions.
const ARCHIVED_COLOR = "#9ca3af";

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
// dept-head + warehouse approval with the regular 8-day-ahead rule.
function ProductionStatusBadge({ status, archivedAt }) {
  // An ended production overrides the publish status with a clear gray "ended" badge.
  if (archivedAt) {
    return (
      <span style={{
        fontSize:11, padding:"2px 8px", borderRadius:10, fontWeight:800,
        border:`1px solid ${ARCHIVED_COLOR}`, color:ARCHIVED_COLOR,
        background:"rgba(156,163,175,0.18)", whiteSpace:"nowrap", flexShrink:0,
      }}>ההפקה הסתיימה</span>
    );
  }
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

// Archive state is DB-backed: a production is archived iff archivedAt is set (the
// migration's RPC/cron owns that; the client never recomputes "ended" itself).
// Students see archived productions only for one month; staff/dept-head (isStudent
// false) keep them forever. The record is never deleted — staff documentation.
const ARCHIVE_STUDENT_WINDOW_MS = 30 * 24 * 3600 * 1000;
function archiveVisibleTo(p, isStudent) {
  if (!p?.archivedAt) return false;
  if (!isStudent) return true;
  const t = new Date(p.archivedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return (Date.now() - t) <= ARCHIVE_STUDENT_WINDOW_MS;
}

// A production is "relevant to month (yr, mo)" if any of its shoot ranges overlaps
// that calendar month. Drives the board's monthly filter (cards match the calendar).
function productionInMonth(p, yr, mo) {
  const mm = String(mo + 1).padStart(2, "0");
  const monthStart = `${yr}-${mm}-01`;
  const monthEnd = `${yr}-${mm}-${String(new Date(yr, mo + 1, 0).getDate()).padStart(2, "0")}`;
  return (p?.dates || []).some(d =>
    d.startDate && d.endDate && d.startDate <= monthEnd && d.endDate >= monthStart
  );
}

// Set of date IDs that already have an active equipment-list reservation.
function submittedDateIds(p, reservations) {
  const ids = new Set();
  for (const r of (reservations || [])) {
    if (!p || r.production_id !== p.id) continue;
    if (r.status === "בוטל") continue;
    if (r.production_date_id) ids.add(String(r.production_date_id));
  }
  return ids;
}

// Returns { daysToShoot, daysToDeadline, tier } for the EARLIEST upcoming shoot date
// that does NOT already have an equipment list submitted.
// Deadline = shoot date − 7 calendar days (inclusive "8 days notice" policy).
//   tier: "safe" (>0d) | "today" (=0) | "overdue" (<0) | "past" (shoot already happened)
//         | "all_submitted" (every date range has a reservation attached)
function equipmentDeadline(p, reservations) {
  const lockedIds = submittedDateIds(p, reservations);
  const allDates = (p?.dates || []);
  if (allDates.length === 0) return null;
  const pending = allDates.filter(d => !lockedIds.has(String(d.id)));
  if (pending.length === 0) {
    return { tier: "all_submitted" };
  }
  const sortable = pending.map(d => `${d.startDate}T${d.startTime || "00:00"}`).sort();
  const next = sortable[0];
  const shoot = new Date(next.slice(0,10) + "T00:00:00");
  const today = new Date();
  today.setHours(0,0,0,0);
  const daysToShoot = Math.floor((shoot - today) / (24*3600*1000));
  if (daysToShoot < 0) return { daysToShoot, daysToDeadline: daysToShoot + 7, tier: "past", shootDate: next.slice(0,10) };
  const daysToDeadline = daysToShoot - 7;
  let tier;
  if (daysToDeadline > 0) tier = "safe";
  else if (daysToDeadline === 0) tier = "today";
  else if (daysToShoot >= 0) tier = "overdue";
  return { daysToShoot, daysToDeadline, tier, shootDate: next.slice(0,10) };
}

function DeadlineChip({ p, reservations }) {
  const info = equipmentDeadline(p, reservations);
  if (!info) return null;
  const { daysToShoot, daysToDeadline, tier } = info;
  let label, color, bg, icon;
  if (tier === "all_submitted") {
    label = "רשימת ציוד הוגשה";
    color = "#2ecc71";
    bg = "rgba(46,204,113,0.12)";
    icon = "✓";
  } else if (tier === "past") {
    label = "ההפקה הסתיימה";
    color = "var(--text3)";
    bg = "transparent";
    icon = "⏱";
  } else if (tier === "safe") {
    label = `${daysToDeadline} ימים עד דדליין רשימת ציוד`;
    color = "#e67e22";
    bg = "rgba(230,126,34,0.12)";
    icon = "⏱";
  } else if (tier === "today") {
    label = "היום הוא היום האחרון להגיש רשימת ציוד";
    color = "#f5a623";
    bg = "rgba(245,166,35,0.15)";
    icon = "⏱";
  } else { // overdue
    label = `עבר הדדליין • נותרו ${daysToShoot} ימים לצילום`;
    color = "#e74c3c";
    bg = "rgba(231,76,60,0.15)";
    icon = "⏱";
  }
  return (
    <div style={{
      fontSize:11, fontWeight:700,
      padding:"4px 8px", borderRadius:6,
      color, background:bg,
      border:`1px solid ${color}`,
      display:"inline-flex", alignItems:"center", gap:4,
    }}>
      {icon} {label}
    </div>
  );
}

function ProductionCard({ p, reservations, onClick }) {
  const next = nextDateOf(p);
  // Only show role chips for approved AND filled slots (a placeholder with
  // no student/email/free-text shouldn't appear on the card even if its
  // status row is 'approved' by accident).
  const approved = (p.crew || []).filter(c =>
    c.status === "approved"
    && (c.studentId || c.freeTextName || c.crewEmail)
  );
  const crewByRole = approved.reduce((acc, c) => { acc[c.role] = (acc[c.role] || 0) + 1; return acc; }, {});
  const customApproved = approved.filter(c => c.role === "custom");
  const isArchived = !!p.archivedAt;
  const accentColor = isArchived ? ARCHIVED_COLOR : (p.color || DEFAULT_PRODUCTION_COLOR);
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
        <ProductionStatusBadge status={p.status} archivedAt={p.archivedAt}/>
      </div>
      <div style={{fontSize:13,color:"var(--text2)",marginBottom:4}}>במאי: {p.directorName}</div>
      {next && <div style={{fontSize:13,color:"var(--text2)",marginBottom:8}}>תאריך קרוב: {fmtDate(next.slice(0,10))}</div>}
      {!isArchived && <div style={{marginBottom:6}}><DeadlineChip p={p} reservations={reservations}/></div>}
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

function ProductionDetail({ p, currentStudent, students, kits = [], reservations = [], onClose, onEdit, onJoinRequest, onOpenLoanForm, onOpenMyReservations }) {
  if (!p) return null;
  const isDirector = currentStudent && p.directorEmail &&
    String(currentStudent.email || "").toLowerCase() === String(p.directorEmail).toLowerCase();
  const myStudentId = currentStudent?.id;
  const alreadyMember = (p.crew || []).some(c => c.studentId === myStudentId || c.crewEmail?.toLowerCase() === String(currentStudent?.email || "").toLowerCase());
  const hasApprovedPhotographer = (p.crew || []).some(c => c.role === "photographer" && c.status === "approved" && c.studentId);

  // Date ranges that already have an active (non-cancelled) equipment reservation
  // attached. The director must remove the reservation via "ההזמנות שלי" before
  // submitting a new list for the same range.
  const lockedDateIds = useMemo(() => {
    const ids = new Set();
    for (const r of (reservations || [])) {
      if (r.production_id !== p.id) continue;
      if (r.status === "בוטל") continue;
      if (r.production_date_id) ids.add(String(r.production_date_id));
    }
    return ids;
  }, [reservations, p.id]);
  const totalDates = (p.dates || []).length;
  const allDatesLocked = totalDates > 0 && (p.dates || []).every(d => lockedDateIds.has(String(d.id)));

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
          {isDirector && p.status === "published" && hasApprovedPhotographer && !allDatesLocked && (
            <button className="btn btn-primary btn-sm" onClick={() => onOpenLoanForm(p)}>
              <ExternalLink size={14}/> השאלת ציוד להפקה
            </button>
          )}
          {isDirector && allDatesLocked && (
            <span style={{fontSize:12,color:"#2ecc71",fontWeight:700}} title="הוגשו רשימות ציוד לכל הטווחים. כדי להחליף — מחק את הרשימה ב'ההזמנות שלי'">
              ✓ הוגשו רשימות לכל הטווחים
            </span>
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
          <span style={{color:"var(--text)",fontWeight:700,marginInlineEnd:6}}>במאי:</span>{p.directorName}
        </div>
        {(() => {
          const kit = p.kitId ? (kits || []).find(k => String(k.id) === String(p.kitId)) : null;
          const label = kit ? kit.name : "כללית";
          return (
            <div style={{fontSize:14,color:"var(--text)",marginBottom:10}}>
              <span style={{color:"var(--text)",fontWeight:700,marginInlineEnd:6}}>סוג ההפקה:</span>
              <span style={{fontWeight:700,color:kit?"#3498db":"var(--text)"}}>{label}</span>
            </div>
          );
        })()}
        {(p.description || p.driveUrl) && (
          <h5 style={{margin:"14px 0 6px",color:"var(--accent)"}}>פרטי ההפקה</h5>
        )}
        {p.description && (
          <p style={{whiteSpace:"pre-wrap",marginTop:6,fontSize:14,lineHeight:1.5,color:"var(--text)"}}>{p.description}</p>
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
          {[...p.dates].sort((a, b) => String(a.startDate || "").localeCompare(String(b.startDate || ""))).map(d => {
            const locked = lockedDateIds.has(String(d.id));
            // Per-date deadline calculation (only when not yet submitted)
            let deadlineChip = null;
              if (!locked) {
                const shoot = new Date(d.startDate + "T00:00:00");
                const todayD = new Date(); todayD.setHours(0,0,0,0);
                const daysToShoot = Math.floor((shoot - todayD) / (24*3600*1000));
                let txt, c, bg;
                if (daysToShoot < 0) {
                  txt = "ההפקה הסתיימה"; c = "var(--text3)"; bg = "transparent";
                } else {
                  const daysToDeadline = daysToShoot - 7;
                  if (daysToDeadline > 3) {
                    txt = `${daysToDeadline} ימים עד דדליין`; c = "#e67e22"; bg = "rgba(230,126,34,0.12)";
                  } else if (daysToDeadline > 0) {
                    txt = `${daysToDeadline} ימים עד דדליין`; c = "#f5a623"; bg = "rgba(245,166,35,0.15)";
                  } else if (daysToDeadline === 0) {
                    txt = "היום אחרון להגיש רשימת ציוד"; c = "#f5a623"; bg = "rgba(245,166,35,0.15)";
                  } else {
                    txt = `עבר הדדליין (${Math.abs(daysToDeadline)} ימים)`; c = "#e74c3c"; bg = "rgba(231,76,60,0.15)";
                  }
                }
                deadlineChip = (
                  <span style={{
                    marginInlineStart:8,
                    fontSize:11, fontWeight:700,
                    padding:"2px 8px", borderRadius:6,
                    color:c, background:bg,
                    border:`1px solid ${c}`,
                    display:"inline-flex", alignItems:"center", gap:4,
                  }}>⏱ {txt}</span>
                );
              }
              return (
                <li key={d.id} style={{marginBottom:6}}>
                  <span>
                    <strong style={{color:"var(--accent)"}}>יציאה:</strong> {fmtDate(d.startDate)} {formatTime(d.startTime)} <span style={{color:"var(--text3)",margin:"0 2px"}}>·</span> <strong style={{color:"var(--accent)"}}>חזרה:</strong> {d.startDate === d.endDate ? "" : fmtDate(d.endDate) + " "}{formatTime(d.endTime)}
                    {d.note ? <span style={{color:"var(--text3)"}}> — {d.note}</span> : null}
                  </span>
                  {locked && (
                    <span style={{marginInlineStart:8,display:"inline-flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                      <span style={{fontSize:11,color:"#2ecc71",fontWeight:700,padding:"2px 8px",borderRadius:6,background:"rgba(46,204,113,0.12)",border:"1px solid #2ecc71"}}>✓ הוגשה רשימת ציוד</span>
                      {isDirector && onOpenMyReservations && (
                        <button className="btn btn-secondary btn-sm" style={{padding:"2px 8px",fontSize:11}}
                          onClick={() => onOpenMyReservations()}>
                          <ExternalLink size={11}/> מעבר לרשימה
                        </button>
                      )}
                    </span>
                  )}
                  {deadlineChip}
                </li>
              );
          })}
        </ul>
      )}

      <h5 style={{margin:"12px 0 6px",color:"var(--accent)"}}><Users size={14} style={{verticalAlign:"middle"}}/> צוות</h5>
      {(() => {
        const renderCrewRow = (c, label) => {
          const emailLc = String(c.crewEmail || "").toLowerCase();
          const stu = students.find(s => String(s.id) === String(c.studentId))
            || (emailLc ? students.find(s => String(s.email || "").toLowerCase() === emailLc) : null);
          const isOpenSlot = !c.studentId && !c.freeTextName && !c.crewEmail;
          const name = stu?.name || c.freeTextName || c.crewEmail || "?";
          let badge;
          if (isOpenSlot) badge = { text: "תפקיד פנוי", color: "#3498db", bg: "rgba(52,152,219,0.15)", border: "rgba(52,152,219,0.45)" };
          else if (c.status === "approved") badge = { text: "מאושר", color: "#2ecc71", bg: "rgba(46,204,113,0.15)", border: "rgba(46,204,113,0.4)" };
          else if (c.status === "invited")  badge = { text: "ממתין", color: "#f5a623", bg: "rgba(245,166,35,0.15)", border: "rgba(245,166,35,0.4)" };
          else                                badge = { text: "נדחה",  color: "#e74c3c", bg: "rgba(231,76,60,0.15)", border: "rgba(231,76,60,0.4)" };
          return (
            <div key={c.id} style={{fontSize:13,marginBottom:4,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",color:"var(--text)"}}>
              <strong>{label}:</strong>
              <span>{name}</span>
              <span style={{
                fontSize:11, padding:"1px 6px", borderRadius:8,
                border:`1px solid ${badge.border}`, background:badge.bg, color:badge.color,
              }}>{badge.text}</span>
            </div>
          );
        };
        return (
          <>
            {ROLE_ORDER.map(role => {
              const inRole = (p.crew || []).filter(c => c.role === role);
              if (inRole.length === 0) return (
                <div key={role} style={{fontSize:13,marginBottom:4,color:"var(--text)"}}>
                  <strong>{ROLE_LABELS[role]}:</strong> <span style={{color:"var(--text3)"}}>— פנוי —</span>
                </div>
              );
              return inRole.map(c => renderCrewRow(c, ROLE_LABELS[role]));
            })}
            {(p.crew || []).filter(c => c.role === "custom").map(c => renderCrewRow(c, getRoleLabel(c)))}
          </>
        );
      })()}
    </Modal>
  );
}

function JoinRequestDialog({ p, currentStudent, existingRequest, onClose, onConfirm, showToast }) {
  const isEdit = !!existingRequest;
  // Open slots = crew rows the director added with NO student assigned and NO free-text name.
  // Rows with a studentId or freeTextName are "taken" — even if the status is still "invited".
  const openSlots = useMemo(() => {
    return (p.crew || []).filter(c => {
      if (c.status === "rejected") return false;
      if (c.id === existingRequest?.id) return false;
      if (c.studentId) return false;
      if (c.freeTextName && String(c.freeTextName).trim()) return false;
      return true;
    });
  }, [p, existingRequest]);

  // Build dropdown options from open slots:
  //   • photographer / sound — collapse to one entry per role (director may have left N empty rows)
  //   • custom — each slot is its own option, identified by id+roleLabel
  const available = useMemo(() => {
    const opts = [];
    const seenStandard = new Set();
    for (const s of openSlots) {
      if (s.role === "photographer" || s.role === "sound") {
        if (!seenStandard.has(s.role)) {
          opts.push({ value: s.role, label: ROLE_LABELS[s.role] });
          seenStandard.add(s.role);
        }
      } else if (s.role === "custom" && s.roleLabel) {
        opts.push({ value: `custom:${s.id}`, label: s.roleLabel, customLabel: s.roleLabel });
      }
    }
    // Editing: always keep the user's current role in the list, even if not "open".
    if (existingRequest) {
      const r = existingRequest.role;
      if ((r === "photographer" || r === "sound") && !seenStandard.has(r)) {
        opts.unshift({ value: r, label: ROLE_LABELS[r] });
      } else if (r === "custom" && existingRequest.roleLabel) {
        const key = `custom:${existingRequest.id}`;
        if (!opts.some(o => o.value === key)) {
          opts.unshift({ value: key, label: existingRequest.roleLabel, customLabel: existingRequest.roleLabel });
        }
      }
    }
    return opts;
  }, [openSlots, existingRequest]);

  const productionFull = available.length === 0;
  const defaultRole = existingRequest
    ? (existingRequest.role === "custom" ? `custom:${existingRequest.id}` : existingRequest.role)
    : (available[0]?.value || "");
  const [role, setRole] = useState(defaultRole);
  const [notes, setNotes] = useState(existingRequest?.notes || "");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (submitting) return;
    if (!role) return;
    let actualRole = role;
    let customLabel = null;
    if (role.startsWith("custom:")) {
      actualRole = "custom";
      const chosen = available.find(o => o.value === role);
      customLabel = chosen?.customLabel || null;
      if (!customLabel) {
        showToast?.("התפקיד שנבחר אינו זמין יותר", "error");
        return;
      }
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
    const res = await requestJoinProduction(p.id, actualRole, {
      studentId: currentStudent.id,
      roleLabel: actualRole === "custom" ? customLabel : null,
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
        <button className="btn btn-secondary btn-sm" onClick={onClose}>{productionFull ? "סגירה" : "ביטול"}</button>
        {!productionFull && (
          <button className="btn btn-primary btn-sm" disabled={submitting || !role} onClick={submit}>
            {isEdit ? "עדכן בקשה" : "שלח בקשה"}
          </button>
        )}
      </div>
    }>
      {productionFull ? (
        <div style={{padding:"24px 12px",textAlign:"center"}}>
          <div style={{fontSize:32,marginBottom:10}}>🎬</div>
          <div style={{fontSize:16,fontWeight:700,color:"var(--text)",marginBottom:6}}>ההפקה מלאה</div>
          <div style={{fontSize:13,color:"var(--text3)",lineHeight:1.6}}>
            כל התפקידים בהפקה שובצו לסטודנטים ע"י הבמאי.<br/>
            אין כרגע משבצות פתוחות לבקשות הצטרפות.
          </div>
        </div>
      ) : (
        <>
          <div style={{marginBottom:12}}>
            <label className="form-label">תפקיד</label>
            <select className="form-input" value={role} onChange={e => setRole(e.target.value)}>
              {available.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
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
        </>
      )}
    </Modal>
  );
}

export function ProductionsPage({ productions = [], currentStudent, students = [], kits = [], reservations = [], showToast, onOpenLoanForm, onOpenMyReservations, refresh }) {
  const [tab, setTab]                     = useState("board"); // board | inbox | archive
  const [calDate, setCalDate]             = useState(() => new Date());
  const [editorOpen, setEditorOpen]       = useState(null);    // { initial: ... } | null
  const [detail, setDetail]               = useState(null);
  const [joinTarget, setJoinTarget]       = useState(null);
  const [studentFilter, setStudentFilter] = useState("");      // student.id to filter board by
  const [scopeAll, setScopeAll]           = useState(false);   // board cards: false = current month only, true = all active

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

  const allPublished = useMemo(() => productions.filter(p => p.status === "published"), [productions]);
  const sortedStudentOptions = useMemo(() => {
    return [...(students || [])]
      .filter(s => s.name)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "he"));
  }, [students]);
  const filteredStudent = useMemo(() => {
    const q = String(studentFilter || "").trim().toLowerCase();
    if (!q) return null;
    return sortedStudentOptions.find(s => String(s.name || "").toLowerCase() === q)
        || sortedStudentOptions.find(s => String(s.name || "").toLowerCase().includes(q))
        || null;
  }, [studentFilter, sortedStudentOptions]);
  function matchesStudentFilter(p) {
    if (!filteredStudent) return true;
    const sid = String(filteredStudent.id);
    const sem = String(filteredStudent.email || "").toLowerCase();
    if (sem && String(p.directorEmail || "").toLowerCase() === sem) return true;
    return (p.crew || []).some(c =>
      String(c.studentId || "") === sid ||
      (sem && String(c.crewEmail || "").toLowerCase() === sem)
    );
  }
  const published = useMemo(() => allPublished.filter(matchesStudentFilter), [allPublished, filteredStudent]);

  const isStudent = !!currentStudent?.id;
  // Single predicate for the board/archive split — applied to BOTH the cards and
  // the calendar so the two never diverge. Board = not archived; archive = archived
  // (student: last month only; staff/dept-head: all).
  function belongsToTab(p) {
    return tab === "archive" ? archiveVisibleTo(p, isStudent) : !p.archivedAt;
  }
  const calYr = calDate.getFullYear();
  const calMo = calDate.getMonth();
  // Board "הפקות אחרות" cards are scoped to the calendar month by default; the
  // toggle shows all active productions. Never applies to the archive tab, and
  // never to "ההפקות שלי" (a director always sees their own productions).
  const monthActive = tab === "board" && !scopeAll;
  const activeBoardCount = useMemo(() => published.filter(p => !p.archivedAt).length, [published]);
  const archiveCount     = useMemo(() => published.filter(p => archiveVisibleTo(p, isStudent)).length, [published, isStudent]);

  // On entering the archive tab, jump the calendar to the most recent archived
  // shoot month (archived shoots are in the past → the current month is empty).
  // The "היום" button still returns to the current month.
  useEffect(() => {
    if (tab !== "archive") return;
    const ends = published
      .filter(p => archiveVisibleTo(p, isStudent))
      .flatMap(p => (p.dates || []).map(d => d.endDate))
      .filter(Boolean)
      .sort();
    if (ends.length) {
      const [y, m] = ends[ends.length - 1].split("-").map(Number);
      setCalDate(new Date(y, (m || 1) - 1, 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function openEditor(initial) {
    setEditorOpen({ initial: initial || null });
  }
  function closeEditor() { setEditorOpen(null); refresh?.(); }

  return (
    <div style={{padding:"0 20px"}}>
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",gap:6}}>
          {/* לוח / ארכיון — visible in all mounts (student / staff / dept-head). */}
          <button onClick={() => setTab("board")} className={tab === "board" ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}>
            <Film size={14}/> לוח {activeBoardCount ? `(${activeBoardCount})` : ""}
          </button>
          <button onClick={() => setTab("archive")} className={tab === "archive" ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}>
            <Archive size={14}/> ארכיון {archiveCount ? `(${archiveCount})` : ""}
          </button>
          {/* בקשות הפקה — logged-in students only. */}
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

      {(tab === "board" || tab === "archive") && (
        <div>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,flexWrap:"wrap"}}>
            <label style={{fontSize:13,color:"var(--text2)",fontWeight:700}}>סינון לפי סטודנט:</label>
            <input
              className="form-input"
              type="text"
              value={studentFilter}
              onChange={e => setStudentFilter(e.target.value)}
              placeholder="הקלד שם סטודנט..."
              style={{maxWidth:240,fontSize:13}}
              autoComplete="off"
            />
            {studentFilter && (
              <button className="btn btn-secondary btn-sm" onClick={() => setStudentFilter("")}>
                <XIcon size={12}/> נקה
              </button>
            )}
            {studentFilter && (
              filteredStudent ? (
                <span style={{fontSize:12,color:"var(--text3)"}}>
                  מציג {published.length} הפקות עם {filteredStudent.name}
                </span>
              ) : (
                <span style={{fontSize:12,color:"#e74c3c"}}>לא נמצא סטודנט בשם זה</span>
              )
            )}
          </div>
          {/* Monthly-scope toggle — board only. Default shows productions relevant to
              the calendar month; "כל ההפקות" removes the monthly filter. A director's
              own productions ("ההפקות שלי") are never affected. */}
          {tab === "board" && (
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,flexWrap:"wrap"}}>
              <label style={{fontSize:13,color:"var(--text2)",fontWeight:700}}>תצוגה:</label>
              <button onClick={() => setScopeAll(false)} className={!scopeAll ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}>
                <CalendarIcon size={14}/> {HE_MONTHS[calMo]} {calYr}
              </button>
              <button onClick={() => setScopeAll(true)} className={scopeAll ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}>
                <Film size={14}/> כל ההפקות
              </button>
              <span style={{fontSize:12,color:"var(--text3)"}}>
                {scopeAll ? "מוצגות כל ההפקות הפעילות" : "מוצגות הפקות החודש הנבחר · ההפקות שלך תמיד גלויות"}
              </span>
            </div>
          )}
          {/* "My productions" section — director + crew memberships (deduped). */}
          {currentStudent?.id && (myDirectorProds.length > 0 || myCrewProds.length > 0) && (() => {
            const mineIds = new Set();
            const mineList = [];
            for (const p of myDirectorProds) { mineIds.add(p.id); mineList.push(p); }
            for (const p of myCrewProds) if (!mineIds.has(p.id)) { mineIds.add(p.id); mineList.push(p); }
            const visibleMine = mineList.filter(p => matchesStudentFilter(p) && belongsToTab(p));
            if (visibleMine.length === 0) return null;
            return (
              <div style={{marginBottom:24}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                  <Users size={16} color="var(--accent)"/>
                  <h3 style={{margin:0,fontSize:15,color:"var(--accent)"}}>ההפקות שלי {visibleMine.length ? `(${visibleMine.length})` : ""}</h3>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
                  {visibleMine.map(p => <ProductionCard key={p.id} p={p} reservations={reservations} onClick={() => setDetail(p)}/>)}
                </div>
              </div>
            );
          })()}

          {/* "Public board" — productions I'm NOT a director of and NOT crew on. */}
          {(() => {
            const mineIds = new Set([
              ...myDirectorProds.map(p => p.id),
              ...myCrewProds.map(p => p.id),
            ]);
            const others = published.filter(p =>
              !mineIds.has(p.id) && belongsToTab(p) &&
              (!monthActive || productionInMonth(p, calYr, calMo))
            );
            return (
              <div style={{marginBottom:24}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                  <Film size={16} color="var(--accent)"/>
                  <h3 style={{margin:0,fontSize:15,color:"var(--accent)"}}>{tab === "archive" ? "ארכיון" : "הפקות אחרות"} {others.length ? `(${others.length})` : ""}</h3>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
                  {others.length === 0
                    ? <p style={{color:"var(--text3)",gridColumn:"1/-1"}}>{tab === "archive" ? "אין הפקות בארכיון" : monthActive ? "אין הפקות מפורסמות בחודש זה — לחצו „כל ההפקות” לתצוגה מלאה" : "אין כרגע הפקות מפורסמות של סטודנטים אחרים"}</p>
                    : others.map(p => <ProductionCard key={p.id} p={p} reservations={reservations} onClick={() => setDetail(p)}/>)}
                </div>
              </div>
            );
          })()}

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
            const productionBlocks = published.filter(belongsToTab).flatMap(prod =>
              (prod.dates || []).map(d => ({
                id: `${prod.id}__${d.id}`,
                student_name: prod.title,
                borrow_date: d.startDate,
                return_date: d.endDate,
                borrow_time: d.startTime,
                return_time: d.endTime,
                loan_type: "הפקה",
                _productionId: prod.id,
                _color: prod.archivedAt ? ARCHIVED_COLOR : (prod.color || DEFAULT_PRODUCTION_COLOR),
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
                  <p style={{color:"var(--text3)",textAlign:"center",marginTop:14}}>{tab === "archive" ? "אין הפקות בארכיון בחודש זה" : "אין הפקות מפורסמות בחודש זה"}</p>
                )}
              </div>
            );
          })()}
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
          kits={kits}
          reservations={reservations}
          showToast={showToast}
          onClose={closeEditor}
          onSaved={() => refresh?.()}
          onDeleted={() => refresh?.()}
          onOpenLoanForm={(blob) => { setEditorOpen(null); onOpenLoanForm?.(blob); }}
          onOpenMyReservations={() => { setEditorOpen(null); onOpenMyReservations?.(); }}
        />
      )}

      {detail && !editorOpen && (
        <ProductionDetail
          p={detail}
          currentStudent={currentStudent}
          students={students}
          kits={kits}
          reservations={reservations}
          onClose={() => setDetail(null)}
          onEdit={(p) => { setDetail(null); openEditor(p); }}
          onJoinRequest={(p) => setJoinTarget(p)}
          onOpenLoanForm={(p) => { setDetail(null); onOpenLoanForm?.(p); }}
          onOpenMyReservations={() => { setDetail(null); onOpenMyReservations?.(); }}
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
