// ProductionsPage — לוח הפקות. Three tabs: public board, my productions, new.
// Visible to all roles; behaviour differs for the logged-in director.

import { useMemo, useState, useEffect } from "react";
import { Plus, Film, Users, Calendar as CalendarIcon, X as XIcon, ExternalLink, ChevronRight, ChevronLeft, Archive } from "lucide-react";
import { Modal } from "./ui.jsx";
import { ProductionEditor } from "./ProductionEditor.jsx";
import { CalendarGrid } from "./CalendarGrid.jsx";
import { today, formatTime } from "../utils.js";
import { isLegacyProduction, submittedDateIds, boardVisibleDates, pendingDates } from "../utils/productionVisibility.js";

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
function nextDateOf(dateRanges) {
  const dates = (dateRanges || []).map(d => `${d.startDate}T${d.startTime || "00:00"}`).filter(Boolean);
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
// `dateRanges` lets callers pass the viewer-visible subset (board gate) — defaults
// to all of the production's ranges.
function productionInMonth(p, yr, mo, dateRanges = p?.dates) {
  const mm = String(mo + 1).padStart(2, "0");
  const monthStart = `${yr}-${mm}-01`;
  const monthEnd = `${yr}-${mm}-${String(new Date(yr, mo + 1, 0).getDate()).padStart(2, "0")}`;
  return (dateRanges || []).some(d =>
    d.startDate && d.endDate && d.startDate <= monthEnd && d.endDate >= monthStart
  );
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

function ProductionCard({ p, reservations, onClick, showPending = false }) {
  // Board gate: a range shows on the card's "next date" ONLY once an equipment
  // list is submitted for it — for everyone, the director included. Legacy
  // productions (pre-cutoff) show everything. The director still gets the red
  // pending-count notice below (showPending) so they know to submit a list.
  const visibleDates = boardVisibleDates(p, reservations);
  const next = nextDateOf(visibleDates);
  const pendingList = showPending ? pendingDates(p, reservations) : [];
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
      {/* Deadline chip is a submission nudge — director/staff only on gated
          productions; legacy productions keep today's show-to-everyone behavior. */}
      {!isArchived && (showPending || isLegacyProduction(p)) && (
        <div style={{marginBottom:6}}><DeadlineChip p={p} reservations={reservations}/></div>
      )}
      {!isArchived && p.status === "published" && pendingList.length > 0 && (
        <div style={{
          fontSize:11, fontWeight:700, marginBottom:6,
          padding:"4px 8px", borderRadius:6,
          color:"#e74c3c", background:"rgba(231,76,60,0.12)",
          border:"1px solid #e74c3c",
          display:"inline-flex", alignItems:"center", gap:4,
        }}>
          🚫 {pendingList.length === 1
            ? "טווח ללא רשימת ציוד — מוסתר מהלוח"
            : `${pendingList.length} טווחים ללא רשימת ציוד — מוסתרים מהלוח`}
        </div>
      )}
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

function ProductionDetail({ p, currentStudent, students, kits = [], reservations = [], showPending = false, onClose, onEdit, onOpenLoanForm, onOpenMyReservations }) {
  if (!p) return null;
  const isDirector = currentStudent && p.directorEmail &&
    String(currentStudent.email || "").toLowerCase() === String(p.directorEmail).toLowerCase();
  const hasApprovedPhotographer = (p.crew || []).some(c => c.role === "photographer" && c.status === "approved" && c.studentId);
  const isLegacy = isLegacyProduction(p);

  // Date ranges that already have an active (non-cancelled) equipment reservation
  // attached. The director must remove the reservation via "ההזמנות שלי" before
  // submitting a new list for the same range.
  const lockedDateIds = useMemo(() => submittedDateIds(p, reservations), [reservations, p]);
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
      {(() => {
        // Board gate: viewers without pending-visibility only see ranges that
        // already have a submitted equipment list (legacy productions: all).
        const visibleList = (showPending || isLegacy)
          ? [...(p.dates || [])]
          : (p.dates || []).filter(d => lockedDateIds.has(String(d.id)));
        if ((p.dates || []).length === 0) return <p style={{color:"var(--text3)",fontSize:13}}>אין תאריכים</p>;
        if (visibleList.length === 0) return <p style={{color:"var(--text3)",fontSize:13}}>אין תאריכים להצגה — טרם הוגשה רשימת ציוד לטווחי הצילום</p>;
        return (
        <ul style={{margin:0,paddingInlineStart:20,fontSize:13,color:"var(--text)"}}>
          {visibleList.sort((a, b) => String(a.startDate || "").localeCompare(String(b.startDate || ""))).map(d => {
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
                  {/* Board gate — director-facing warning: this range is not on
                      the public board until an equipment list is submitted. */}
                  {isDirector && !isLegacy && !locked && (
                    <div style={{
                      marginTop:4, fontSize:12, fontWeight:700,
                      padding:"6px 10px", borderRadius:6,
                      color:"#e74c3c", background:"rgba(231,76,60,0.12)",
                      border:"1px solid #e74c3c",
                      display:"flex", alignItems:"center", gap:8, flexWrap:"wrap",
                    }}>
                      <span>⚠ הטווח לא יופיע בלוח עד להגשת רשימת ציוד</span>
                      {p.status === "published" && hasApprovedPhotographer && onOpenLoanForm && (
                        <button className="btn btn-primary btn-sm" style={{padding:"2px 10px",fontSize:12}}
                          onClick={() => onOpenLoanForm(p, d.id)}>
                          <ExternalLink size={12}/> הגש רשימת ציוד
                        </button>
                      )}
                      {p.status === "published" && !hasApprovedPhotographer && (
                        <span style={{fontWeight:400}}>— יש לשבץ צלם ראשי תחילה</span>
                      )}
                    </div>
                  )}
                </li>
              );
          })}
        </ul>
        );
      })()}

      <h5 style={{margin:"12px 0 6px",color:"var(--accent)"}}><Users size={14} style={{verticalAlign:"middle"}}/> צוות</h5>
      {(() => {
        const renderCrewRow = (c, label) => {
          const emailLc = String(c.crewEmail || "").toLowerCase();
          const stu = students.find(s => String(s.id) === String(c.studentId))
            || (emailLc ? students.find(s => String(s.email || "").toLowerCase() === emailLc) : null);
          const isOpenSlot = !c.studentId && !c.freeTextName && !c.crewEmail;
          const name = stu?.name || c.freeTextName || c.crewEmail || "?";
          // No approval flow: a filled row is simply "assigned"; empty = open slot.
          const badge = isOpenSlot
            ? { text: "תפקיד פנוי", color: "#3498db", bg: "rgba(52,152,219,0.15)", border: "rgba(52,152,219,0.45)" }
            : { text: "משובץ",     color: "#2ecc71", bg: "rgba(46,204,113,0.15)", border: "rgba(46,204,113,0.4)" };
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
        // Hide rejected rows and legacy self-join leftovers — the join/approval
        // flow is gone; only director-composed (or previously approved) crew shows.
        const visibleCrew = (p.crew || []).filter(c =>
          c.status !== "rejected" &&
          !((c.invitedBy || "director") === "self" && c.status !== "approved"));
        return (
          <>
            {ROLE_ORDER.map(role => {
              const inRole = visibleCrew.filter(c => c.role === role);
              if (inRole.length === 0) return (
                <div key={role} style={{fontSize:13,marginBottom:4,color:"var(--text)"}}>
                  <strong>{ROLE_LABELS[role]}:</strong> <span style={{color:"var(--text3)"}}>— פנוי —</span>
                </div>
              );
              return inRole.map(c => renderCrewRow(c, ROLE_LABELS[role]));
            })}
            {visibleCrew.filter(c => c.role === "custom").map(c => renderCrewRow(c, getRoleLabel(c)))}
          </>
        );
      })()}
    </Modal>
  );
}

export function ProductionsPage({ productions = [], currentStudent, students = [], kits = [], reservations = [], showToast, onOpenLoanForm, onOpenMyReservations, refresh }) {
  const [tab, setTab]                     = useState("board"); // board | archive
  const [calDate, setCalDate]             = useState(() => new Date());
  const [editorOpen, setEditorOpen]       = useState(null);    // { initial: ... } | null
  const [detail, setDetail]               = useState(null);
  const [studentFilter, setStudentFilter] = useState("");      // student.id to filter board by
  const [scopeAll, setScopeAll]           = useState(false);   // board cards: false = current month only, true = all active

  const myEmail = String(currentStudent?.email || "").toLowerCase();
  // Board-visibility gate: staff/dept-head mounts (currentStudent=null) see
  // everything including pending ranges; a student sees pending ranges only on
  // productions they direct. Legacy (pre-cutoff) productions bypass the gate
  // entirely inside the visibility helpers.
  const seesAllPending = !currentStudent?.id;
  const showPendingFor = (p) => seesAllPending || String(p?.directorEmail || "").toLowerCase() === myEmail;
  // The date ranges this viewer is allowed to see for a production.
  const datesForViewer = (p) => showPendingFor(p) ? (p?.dates || []) : boardVisibleDates(p, reservations);
  // A production earns a spot on another student's board only with ≥1 visible
  // range; directors/staff always see it (exactly today's behavior for them).
  const visibleOnBoard = (p) => showPendingFor(p) || boardVisibleDates(p, reservations).length > 0;
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
  // Counts mirror the card predicates (incl. the board-visibility gate) so the
  // tab numbers never disagree with what actually renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const activeBoardCount = useMemo(() => published.filter(p => !p.archivedAt && visibleOnBoard(p)).length, [published, reservations, seesAllPending, myEmail]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const archiveCount     = useMemo(() => published.filter(p => archiveVisibleTo(p, isStudent) && visibleOnBoard(p)).length, [published, isStudent, reservations, seesAllPending, myEmail]);

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
        </div>
        {currentStudent?.id && canCreateProductions && (
          <button className="btn btn-primary btn-sm" onClick={() => openEditor(null)}>
            <Plus size={14}/> הפקה חדשה
          </button>
        )}
      </div>

      {(tab === "board" || tab === "archive") && (
        // Layout order: filters → calendar (שיבוצי הפקות) → production cards.
        // The card sections carry order:1 so they drop below the calendar.
        <div style={{display:"flex",flexDirection:"column"}}>
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
              <div style={{marginBottom:24,order:1}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                  <Users size={16} color="var(--accent)"/>
                  <h3 style={{margin:0,fontSize:15,color:"var(--accent)"}}>ההפקות שלי {visibleMine.length ? `(${visibleMine.length})` : ""}</h3>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
                  {visibleMine.map(p => <ProductionCard key={p.id} p={p} reservations={reservations} showPending={showPendingFor(p)} onClick={() => setDetail(p)}/>)}
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
              !mineIds.has(p.id) && belongsToTab(p) && visibleOnBoard(p) &&
              (!monthActive || productionInMonth(p, calYr, calMo, datesForViewer(p)))
            );
            return (
              <div style={{marginBottom:24,order:1}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                  <Film size={16} color="var(--accent)"/>
                  <h3 style={{margin:0,fontSize:15,color:"var(--accent)"}}>{tab === "archive" ? "ארכיון" : "הפקות אחרות"} {others.length ? `(${others.length})` : ""}</h3>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
                  {others.length === 0
                    ? <p style={{color:"var(--text3)",gridColumn:"1/-1"}}>{tab === "archive" ? "אין הפקות בארכיון" : monthActive ? "אין הפקות מפורסמות בחודש זה — לחצו „כל ההפקות” לתצוגה מלאה" : "אין כרגע הפקות מפורסמות של סטודנטים אחרים"}</p>
                    : others.map(p => <ProductionCard key={p.id} p={p} reservations={reservations} showPending={showPendingFor(p)} onClick={() => setDetail(p)}/>)}
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
            const productionBlocks = published.filter(belongsToTab).flatMap(prod => {
              // A date range shows on the board ONLY once an equipment list has
              // been submitted for it — for EVERYONE, the director included. A
              // list-less range never renders here (the director still sees it as
              // a draft in the editor + the production-detail view). Legacy
              // productions: subIds=null → everything renders as before.
              const subIds = isLegacyProduction(prod) ? null : submittedDateIds(prod, reservations);
              return (prod.dates || [])
                .filter(d => !subIds || subIds.has(String(d.id)))
                .map(d => ({
                  id: `${prod.id}__${d.id}`,
                  student_name: prod.directorName ? `${prod.directorName} · ${prod.title}` : prod.title,
                  borrow_date: d.startDate,
                  return_date: d.endDate,
                  borrow_time: d.startTime,
                  return_time: d.endTime,
                  loan_type: "הפקה",
                  _productionId: prod.id,
                  _color: prod.archivedAt ? ARCHIVED_COLOR : (prod.color || DEFAULT_PRODUCTION_COLOR),
                }));
            });
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
          onOpenLoanForm={(blob, dateId) => { setEditorOpen(null); onOpenLoanForm?.(blob, dateId); }}
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
          showPending={showPendingFor(detail)}
          onClose={() => setDetail(null)}
          onEdit={(p) => { setDetail(null); openEditor(p); }}
          onOpenLoanForm={(p, dateId) => { setDetail(null); onOpenLoanForm?.(p, dateId); }}
          onOpenMyReservations={() => { setDetail(null); onOpenMyReservations?.(); }}
        />
      )}
    </div>
  );
}
