// PublicForm.jsx — public loan request form
import { AlertTriangle, Backpack, BookOpen, Briefcase, Calendar, Camera, Check, CheckCircle, ClipboardList, Clock, Download, Film, GraduationCap, Info, Lightbulb, Mail, Mic, Minus, Moon, Package, Pencil, Phone, Save, School, Search, Settings, Shield, ShieldCheck, Trash2, User, X, XCircle } from "lucide-react";
import { useEffect, useState, useRef, useMemo } from "react";
import { formatDate, formatTime, formatLocalDateInput, parseLocalDate, today, getAvailable, computeEquipmentAvailability, toDateTime, getNextSoundDayLoanDate, getFutureTimeSlotsForDate, getPrivateLoanLimitedQty, normalizeName, isValidEmailAddress, NIMROD_PHONE, DEFAULT_CATEGORIES, FAR_FUTURE, EXTERNAL_LOAN_TYPES, getEffectiveStatus, cloudinaryThumb, createReservation, getAuthToken, getLoanTypeColor, PREVIEW_COLOR, groupReservationItemsByCategory, deriveVisibleCategories, stretchOverdueForCalendar } from "../utils.js";
import { supabase } from "../supabaseClient.js";
import { listStudents } from "../utils/studentsApi.js";
import { listLessons } from "../utils/lessonsApi.js";
import { listStudios } from "../utils/studiosApi.js";
import { listStudioBookings, upsertStudioBooking, deleteStudioBooking } from "../utils/studioBookingsApi.js";
import { buildLessonStudioBookings } from "../utils/lessonBookings.js";
import { rangesOverlap } from "../utils/studioOverlap.js";
import { loanMaxDays, computeMinBorrowDate, SOUND_MIN_LEAD_TIME_MS, getUpdateLeadTimeState, computeUpdateDeadline } from "../utils/loanPolicy.js";
import { listReservationUpdates, submitReservationUpdate, MAX_RESERVATION_UPDATES } from "../utils/reservationUpdatesApi.js";
import { useNotifications } from "../hooks/useNotifications.js";
import { CalendarGrid } from "./CalendarGrid.jsx";
import AIChatBot from "./AIChatBot.jsx";
import { ProductionsPage } from "./ProductionsPage.jsx";
import { StudentHub } from "./StudentHub.jsx";

const SMART_LOAN_TYPES = ["פרטית", "הפקה", "סאונד", "קולנוע יומית"];

// Hard rule: track classification — and ONLY classification — dictates which
// loan types a student sees. "פרטית" is global (every track), "סאונד" is for
// sound classification only, "הפקה" + "קולנוע יומית" for cinema only. Any
// per-track loan_types stored elsewhere (DB, blob, admin UI) is ignored —
// the school's policy is uniform per classification. Unclassified tracks
// ("ללא סיווג") get only "פרטית" — the safe default — so an admin must
// explicitly set a classification before broader loan types become visible.
const TRACK_TYPE_LOAN_TYPES = {
  sound:  ["פרטית", "סאונד"],
  cinema: ["פרטית", "הפקה", "קולנוע יומית"],
};
function loanTypesForTrackType(trackType) {
  return TRACK_TYPE_LOAN_TYPES[trackType] || ["פרטית"];
}

function policyHtml(text) {
  if (!text) return "";
  if (/<[a-z]/i.test(text)) return text;
  const bold = s => s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const lines = text.split('\n');
  let out = '', inUl = false, inOl = false;
  lines.forEach(line => {
    if (/^• /.test(line)) {
      if (inOl) { out += '</ol>'; inOl = false; }
      if (!inUl) { out += '<ul>'; inUl = true; }
      out += `<li>${bold(line.slice(2))}</li>`;
    } else if (/^\d+\. /.test(line)) {
      if (inUl) { out += '</ul>'; inUl = false; }
      if (!inOl) { out += '<ol>'; inOl = true; }
      out += `<li>${bold(line.replace(/^\d+\. /, ''))}</li>`;
    } else {
      if (inUl) { out += '</ul>'; inUl = false; }
      if (inOl) { out += '</ol>'; inOl = false; }
      out += `${bold(line)}<br>`;
    }
  });
  if (inUl) out += '</ul>';
  if (inOl) out += '</ol>';
  return out;
}

function normalizeSmartDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const localMatch = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (localMatch) {
    const year = localMatch[3].length === 2 ? `20${localMatch[3]}` : localMatch[3];
    return `${year}-${String(localMatch[2]).padStart(2, "0")}-${String(localMatch[1]).padStart(2, "0")}`;
  }
  return "";
}

function normalizeSmartTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeSmartLoanType(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (SMART_LOAN_TYPES.includes(raw)) return raw;
  if (raw.includes("הפק")) return "הפקה";
  if (raw.includes("סאונד")) return "סאונד";
  if (raw.includes("יומית") || raw.includes("קולנוע")) return "קולנוע יומית";
  if (raw.includes("פרט")) return "פרטית";
  return "";
}

function parseSmartBookingJson(text) {
  const raw = String(text || "").trim();
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const jsonText = fencedMatch ? fencedMatch[1].trim() : raw;
  return JSON.parse(jsonText);
}

const LOAN_TYPE_EQUIPMENT_CLASSIFICATIONS = ["סאונד", "צילום", "כללי"];
const DEFAULT_STUDIO_FUTURE_HOURS = 16;
const DEFAULT_LOAN_TYPE_EQUIPMENT_CLASSIFICATION = {
  פרטית: ["כללי", "צילום", "סאונד"],
  הפקה: ["צילום", "כללי"],
  סאונד: ["סאונד", "כללי"],
  "קולנוע יומית": ["צילום", "כללי"],
};

function getLoanTypeEquipmentClassifications(loanType, categoryLoanTypes = {}) {
  const rawValue = categoryLoanTypes?.[loanType];
  const normalized = Array.isArray(rawValue)
    ? rawValue.filter((value) => LOAN_TYPE_EQUIPMENT_CLASSIFICATIONS.includes(String(value).trim()))
    : LOAN_TYPE_EQUIPMENT_CLASSIFICATIONS.includes(String(rawValue || "").trim())
      ? [String(rawValue).trim()]
      : [];
  return normalized.length ? [...new Set(normalized)] : [...(DEFAULT_LOAN_TYPE_EQUIPMENT_CLASSIFICATION[loanType] || ["כללי"])];
}

function matchesEquipmentLoanType(eq, loanType, categoryLoanTypes = {}) {
  const requiredClassifications = getLoanTypeEquipmentClassifications(loanType, categoryLoanTypes);
  const isSound = !!eq?.soundOnly;
  const isPhoto = !!eq?.photoOnly;
  const isGeneral = (!isSound && !isPhoto) || (isSound && isPhoto);
  return requiredClassifications.some((classification) => {
    if (classification === "סאונד") return isSound;
    if (classification === "צילום") return isPhoto;
    return isGeneral;
  });
}

function buildTrackSettings(students = [], existingTrackSettings = [], explicitTracks = []) {
  const existing = Array.isArray(existingTrackSettings) ? existingTrackSettings : [];
  const explicit = Array.isArray(explicitTracks) ? explicitTracks : [];
  const explicitNames = explicit.map(t => String(t?.name || "").trim()).filter(Boolean);
  const studentNames = (students || []).map((s) => String(s?.track || "").trim()).filter(Boolean);
  const trackNames = [...new Set([...explicitNames, ...studentNames])];
  return trackNames.map((name) => {
    const match = existing.find((setting) => String(setting?.name || "").trim() === name);
    const explicitMatch = explicit.find(t => String(t?.name || "").trim() === name);
    // Classification (trackType) is the SOLE source of truth for which loan
    // types this track sees. Per-track loan_types overrides are ignored.
    const inferredType = explicitMatch?.trackType
      || match?.trackType
      || (/סאונד|sound/i.test(name) ? "sound" : /קולנוע|cinema|film/i.test(name) ? "cinema" : "");
    return {
      name,
      loanTypes: loanTypesForTrackType(inferredType),
      trackType: inferredType,
    };
  });
}

const fetchWithRetry = async (url, options, maxRetries = 5) => {
  const delays = [2000, 5000, 10000, 20000, 32000];
  for (let i = 0; i < maxRetries; i += 1) {
    const response = await fetch(url, options);
    if (response.status === 429) {
      console.warn(`API Rate Limit hit. Retrying in ${(delays[i] ?? delays[delays.length - 1]) / 1000} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, delays[i] ?? delays[delays.length - 1]));
      continue;
    }
    return response;
  }
  return fetch(url, options);
};

function getStudioFutureHoursLimit(settings = {}) {
  const parsed = Number(settings?.studioFutureHoursLimit);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_STUDIO_FUTURE_HOURS;
}

function formatStudioHoursValue(value = 0) {
  const normalized = Math.max(0, Math.round((Number(value) || 0) * 10) / 10);
  return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(1);
}

function buildStudioBookingInterval({ date, startTime, endTime, isNight = false, nightStartTime = "21:30", nightEndTime = "08:00" }) {
  if (!date) return null;
  const normalizedStartTime = isNight ? nightStartTime : String(startTime || "").trim();
  const normalizedEndTime = isNight ? nightEndTime : String(endTime || "").trim();
  if (!normalizedStartTime || !normalizedEndTime) return null;
  const start = new Date(`${date}T${normalizedStartTime}:00`);
  const end = new Date(`${date}T${normalizedEndTime}:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (end <= start) end.setDate(end.getDate() + 1);
  return { start, end };
}

function getFutureStudioBookingHours(booking, now = new Date(), nightStartTime = "21:30", nightEndTime = "08:00") {
  // Night bookings cost exactly 4 hours regardless of actual duration
  if (booking?.isNight) {
    const interval = buildStudioBookingInterval({ ...booking, nightStartTime, nightEndTime });
    if (!interval || interval.end <= now) return 0;
    const futureStart = interval.start > now ? interval.start : now;
    const actualHours = Math.max(0, (interval.end.getTime() - futureStart.getTime()) / 3600000);
    return Math.min(actualHours, 4);
  }
  const interval = buildStudioBookingInterval({ ...booking, nightStartTime, nightEndTime });
  if (!interval || interval.end <= now) return 0;
  const futureStart = interval.start > now ? interval.start : now;
  return Math.max(0, (interval.end.getTime() - futureStart.getTime()) / 3600000);
}

function PublicMiniCalendar({ reservations, lessons=[], initialLoanType="הכל", previewStart="", previewEnd="", previewName="", borrowDate="", onActiveStateChange }) {
  const lessonIdSet = useMemo(() => new Set((lessons||[]).map(l => String(l.id))), [lessons]);
  const [calDate, setCalDate] = useState(() => {
    const d = borrowDate ? parseLocalDate(borrowDate) : null;
    return d && !isNaN(d) ? new Date(d.getFullYear(), d.getMonth(), 1) : new Date();
  });
  const [loanTypeF, setLoanTypeF] = useState(["פרטית","הפקה","סאונד","קולנוע יומית"].includes(initialLoanType) ? initialLoanType : "הכל");
  // Auto-jump calendar to borrowDate's month when the user picks a date in step 2
  useEffect(() => {
    if (!borrowDate) return;
    const d = parseLocalDate(borrowDate);
    if (!d || isNaN(d)) return;
    setCalDate(prev => (d.getFullYear() !== prev.getFullYear() || d.getMonth() !== prev.getMonth())
      ? new Date(d.getFullYear(), d.getMonth(), 1)
      : prev);
  }, [borrowDate]);
  // Display-only: report current filter+month to parent so it can mirror them in the "Active equipment lists" panel below.
  useEffect(() => {
    if (typeof onActiveStateChange === "function") {
      onActiveStateChange({ loanTypeF, calDate });
    }
  }, [loanTypeF, calDate, onActiveStateChange]);
  const yr = calDate.getFullYear();
  const mo = calDate.getMonth();
  const HE_M = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  const HE_D = ["א׳","ב׳","ג׳","ד׳","ה׳","ו׳","ש׳"];
  const todayStr = today();

  const days = [];
  const outOfMonthDays = [];
  const startOffset = new Date(yr,mo,1).getDay();
  const prevMonthLastDay = new Date(yr,mo,0).getDate();
  for(let i=0;i<startOffset;i++) {
    days.push(null);
    outOfMonthDays.push(new Date(yr,mo-1,prevMonthLastDay-(startOffset-1-i)));
  }
  const lastDay = new Date(yr,mo+1,0).getDate();
  for(let d=1;d<=lastDay;d++) {
    days.push(new Date(yr,mo,d));
    outOfMonthDays.push(null);
  }
  let nextDay = 1;
  while(days.length<42) {
    days.push(null);
    outOfMonthDays.push(new Date(yr,mo+1,nextDay++));
  }

  const LOAN_FILTERS = [{key:"הכל",label:"הכל",icon:<Package size={12} strokeWidth={1.75} color="var(--accent)" />},{key:"פרטית",label:"פרטית",icon:<User size={12} strokeWidth={1.75} color="var(--accent)" />},{key:"הפקה",label:"הפקה",icon:<Film size={12} strokeWidth={1.75} color="var(--accent)" />},{key:"סאונד",label:"סאונד",icon:<Mic size={12} strokeWidth={1.75} color="var(--accent)" />},{key:"קולנוע יומית",label:"קולנוע יומית",icon:<Camera size={12} strokeWidth={1.75} color="var(--accent)" />},{key:"שיעור",label:"שיעור",icon:<Film size={12} strokeWidth={1.75} color="var(--accent)" />},{key:"צוות",label:"איש צוות",icon:<Briefcase size={12} strokeWidth={1.75} color="var(--accent)" />}];
  const isPendingFilter  = loanTypeF === "ממתין";
  const isDeptHeadFilter = loanTypeF === "אישור ראש מחלקה";
  const isOverdueFilter  = loanTypeF === "באיחור";
  const isStatusFilter   = isPendingFilter || isDeptHeadFilter || isOverdueFilter;
  const activeRes = reservations.filter(r=>
    (isPendingFilter
      ? r.status==="ממתין"
      : isDeptHeadFilter
      ? r.status==="אישור ראש מחלקה"
      : isOverdueFilter
      ? r.status==="באיחור"
      : (r.status==="מאושר"||r.status==="פעילה"||r.status==="באיחור"||r.status==="ממתין"||r.status==="אישור ראש מחלקה")) &&
    r.borrow_date && r.return_date &&
    (loanTypeF==="הכל" || isStatusFilter || r.loan_type===loanTypeF) &&
    // Exclude reservations linked to a deleted lesson (orphaned lesson_id)
    (!r.lesson_id || lessonIdSet.has(String(r.lesson_id)))
  );
  // Overdue loans keep occupying the calendar until the gear is physically back.
  // Was an inline copy of this rule; now the shared helper every calendar uses.
  const activeResForCalendar = stretchOverdueForCalendar(activeRes, todayStr);
  // Add preview entry for user's selected dates
  const previewRes = previewStart && previewEnd ? [{
    id:"__preview__", student_name:previewName, borrow_date:previewStart,
    return_date:previewEnd, status:"preview", loan_type:""
  }] : [];
  const allRes = [...activeResForCalendar, ...previewRes];
  const colorMap = {};
  activeRes.forEach(r => { colorMap[r.id] = getLoanTypeColor(r.loan_type); });
  colorMap["__preview__"] = PREVIEW_COLOR;

  return (
    <div style={{marginBottom:16,marginTop:8}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,flexWrap:"wrap",gap:6}}>
        <div style={{fontWeight:800,fontSize:13,color:"var(--text2)",display:"flex",alignItems:"center",gap:4}}><Calendar size={16} strokeWidth={1.75} color="var(--accent)" /> השאלות הפעילות</div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setCalDate(new Date(yr,mo-1,1))}>‹</button>
          <span style={{fontWeight:700,fontSize:12,minWidth:90,textAlign:"center"}}>{HE_M[mo]} {yr}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setCalDate(new Date(yr,mo+1,1))}>›</button>
        </div>
      </div>
      {/* Status filters — pending / dept-head / overdue (display-only). When active, the calendar (and the panel below) shows only that status. */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:6}}>
        {(() => {
          const isActive = isPendingFilter;
          const [bg, fg] = ["var(--accent-glow)", "var(--accent)"];
          return (
            <button type="button" onClick={()=>setLoanTypeF(isPendingFilter ? "הכל" : "ממתין")}
              style={{padding:"3px 10px",borderRadius:20,border:`2px solid ${isActive?bg:"var(--border)"}`,background:isActive?bg:"transparent",color:isActive?fg:"var(--text3)",fontWeight:700,fontSize:11,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:4}}>
              <Clock size={12} strokeWidth={1.75} color="var(--accent)" /> השאלות בהמתנה
            </button>
          );
        })()}
        {(() => {
          const isActive = isDeptHeadFilter;
          const accent = "#7c3aed";
          const bg = isActive ? "rgba(124,58,237,0.18)" : "transparent";
          return (
            <button type="button" onClick={()=>setLoanTypeF(isDeptHeadFilter ? "הכל" : "אישור ראש מחלקה")}
              style={{padding:"3px 10px",borderRadius:20,border:`2px solid ${isActive?accent:"var(--border)"}`,background:bg,color:isActive?accent:"var(--text3)",fontWeight:700,fontSize:11,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:4}}>
              <ShieldCheck size={12} strokeWidth={1.75} color={accent} /> באישור ראש מחלקה
            </button>
          );
        })()}
        {(() => {
          const isActive = isOverdueFilter;
          const accent = "#dc2626";
          const bg = isActive ? "rgba(220,38,38,0.16)" : "transparent";
          return (
            <button type="button" onClick={()=>setLoanTypeF(isOverdueFilter ? "הכל" : "באיחור")}
              style={{padding:"3px 10px",borderRadius:20,border:`2px solid ${isActive?accent:"var(--border)"}`,background:bg,color:isActive?accent:"var(--text3)",fontWeight:700,fontSize:11,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:4}}>
              <AlertTriangle size={12} strokeWidth={1.75} color={accent} /> השאלה באיחור
            </button>
          );
        })()}
      </div>
      {/* Loan type filter chips — colored by loan type */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
        {LOAN_FILTERS.map(f=>{
          const isActive = loanTypeF===f.key;
          const [bg, fg] = f.key === "הכל" ? ["var(--accent-glow)", "var(--accent)"] : getLoanTypeColor(f.key);
          return (
            <button key={f.key} type="button" onClick={()=>setLoanTypeF(f.key)}
              style={{padding:"3px 10px",borderRadius:20,border:`2px solid ${isActive?bg:"var(--border)"}`,background:isActive?bg:"transparent",color:isActive?fg:"var(--text3)",fontWeight:700,fontSize:11,cursor:"pointer"}}>
              {f.icon} {f.label}
            </button>
          );
        })}
      </div>
      <div style={{background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",padding:"10px",direction:"rtl"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:4}}>
          {HE_D.map(d=><div key={d} style={{textAlign:"center",fontSize:11,fontWeight:700,color:"var(--text3)",padding:"4px 0"}}>{d}</div>)}
        </div>
        <CalendarGrid days={days} outOfMonthDays={outOfMonthDays} activeRes={allRes} colorMap={colorMap} todayStr={todayStr} cellHeight={80} fontSize={10} previewId="__preview__"/>
        {activeRes.length===0&&<div style={{textAlign:"center",fontSize:12,color:"var(--text3)",padding:"8px 0"}}>אין השאלות פעילות</div>}
      </div>
    </div>
  );
}

// ─── ACTIVE EQUIPMENT LISTS PANEL ────────────────────────────────────────────
// Display-only collapsible panel rendered below the step-2 nav buttons.
// Mirrors PublicMiniCalendar's current filter+month, then shows the equipment
// lists of those reservations so students can coordinate directly with whoever
// is currently holding equipment they need.
function ActiveListsPanel({ reservations=[], lessons=[], equipment=[], calSnapshot, open, setOpen }) {
  const lessonIdSet = useMemo(() => new Set((lessons||[]).map(l => String(l.id))), [lessons]);
  const equipById   = useMemo(() => {
    const m = new Map();
    (equipment||[]).forEach(e => m.set(String(e.id), e));
    return m;
  }, [equipment]);

  const { loanTypeF = "הכל", calDate = new Date() } = calSnapshot || {};
  const isPendingFilter  = loanTypeF === "ממתין";
  const isDeptHeadFilter = loanTypeF === "אישור ראש מחלקה";
  const isOverdueFilter  = loanTypeF === "באיחור";
  const isStatusFilter   = isPendingFilter || isDeptHeadFilter || isOverdueFilter;

  const monthStart = new Date(calDate.getFullYear(), calDate.getMonth(), 1);
  const monthEnd   = new Date(calDate.getFullYear(), calDate.getMonth() + 1, 0);
  const toISO = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const monthStartStr = toISO(monthStart);
  const monthEndStr   = toISO(monthEnd);

  // Stretched first so the month-overlap test below matches the calendar: an
  // overdue loan whose real return_date fell in a previous month is still shown
  // on the grid, and must not silently drop out of this mirror panel.
  const panelRes = stretchOverdueForCalendar(reservations||[]).filter(r =>
    (isPendingFilter
      ? r.status === "ממתין"
      : isDeptHeadFilter
      ? r.status === "אישור ראש מחלקה"
      : isOverdueFilter
      ? r.status === "באיחור"
      : (r.status === "מאושר" || r.status === "פעילה" || r.status === "באיחור" || r.status === "ממתין" || r.status === "אישור ראש מחלקה")) &&
    r.borrow_date && r.return_date &&
    (loanTypeF === "הכל" || isStatusFilter || r.loan_type === loanTypeF) &&
    (!r.lesson_id || lessonIdSet.has(String(r.lesson_id))) &&
    r.borrow_date <= monthEndStr && r.return_date >= monthStartStr
  ).sort((a, b) => (a.borrow_date < b.borrow_date ? -1 : a.borrow_date > b.borrow_date ? 1 : 0));

  const count = panelRes.length;
  const empty = count === 0;

  return (
    <div style={{marginTop:12}}>
      <button
        type="button"
        onClick={() => !empty && setOpen(v => !v)}
        disabled={empty}
        style={{
          width:"100%",
          padding:"10px 14px",
          borderRadius:"var(--r)",
          border:"1px solid var(--border)",
          background: empty ? "var(--surface2)" : "var(--surface)",
          color: empty ? "var(--text3)" : "var(--text2)",
          cursor: empty ? "not-allowed" : "pointer",
          opacity: empty ? 0.65 : 1,
          fontWeight:700,
          fontSize:13,
          display:"flex",
          alignItems:"center",
          justifyContent:"space-between",
          gap:8,
          direction:"rtl",
        }}
      >
        <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
          <ClipboardList size={16} strokeWidth={1.75} color="var(--accent)" />
          רשימות ציוד
          <span style={{color:"var(--text3)",fontWeight:600}}>{empty ? "(אין לחודש זה)" : `(${count})`}</span>
        </span>
        {!empty && <span style={{fontSize:12,color:"var(--text3)"}}>{open ? "▲" : "▼"}</span>}
      </button>

      {open && !empty && (
        <div style={{
          marginTop:8,
          maxHeight:"60vh",
          overflowY:"auto",
          background:"var(--surface2)",
          borderRadius:"var(--r)",
          border:"1px solid var(--border)",
          padding:8,
          direction:"rtl",
          display:"flex",
          flexDirection:"column",
          gap:8,
        }}>
          {panelRes.map(r => (
            <ActiveLoanCard key={r.id} reservation={r} equipById={equipById} />
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_BADGE_COLORS = {
  "מאושר":            { bg:"rgba(22,163,74,0.16)",  fg:"#16a34a" },
  "פעילה":            { bg:"rgba(37,99,235,0.16)",  fg:"#2563eb" },
  "באיחור":           { bg:"rgba(220,38,38,0.16)",  fg:"#dc2626" },
  "ממתין":            { bg:"rgba(107,114,128,0.18)",fg:"#6b7280" },
  "אישור ראש מחלקה":  { bg:"rgba(124,58,237,0.18)",fg:"#7c3aed" },
};

function ActiveLoanCard({ reservation, equipById }) {
  const r = reservation;
  const [open, setOpen] = useState(false);
  // getEffectiveStatus promotes "מאושר" → "פעילה" once the borrow window starts.
  // Show the effective status on the badge so an active loan reads "פעילה"
  // even though the row in reservations_new still stores "מאושר".
  const effectiveStatus = getEffectiveStatus(r);
  const badge = STATUS_BADGE_COLORS[effectiveStatus] || { bg:"var(--surface)", fg:"var(--text3)" };
  const loanTypeColor = r.loan_type ? getLoanTypeColor(r.loan_type) : ["var(--surface2)","var(--text3)"];
  const items = Array.isArray(r.items) ? r.items : [];
  const requesterName = (r.student_name || r.requester_name || r.email || "ללא שם").trim();
  return (
    <div style={{
      background:"var(--surface)",
      border:"1px solid var(--border)",
      borderRadius:"var(--r)",
      fontSize:14,
      color:"var(--text2)",
      direction:"rtl",
    }}>
      {/* Header — clickable div (not a <button>, which mis-renders nested flex divs in some browsers and clips children) */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(v => !v)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(v => !v); } }}
        style={{padding:"10px 12px",cursor:"pointer",userSelect:"none"}}
      >
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,marginBottom:6}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:8,minWidth:0,flexWrap:"wrap"}}>
            <span style={{fontSize:12,color:"var(--text3)"}}>{open ? "▲" : "▼"}</span>
            <strong style={{fontSize:14,color:"var(--text)"}}>{requesterName}</strong>
            {r.course && (
              <span style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:11,fontWeight:700,color:"var(--text3)",background:"rgba(255,255,255,0.04)",border:"1px solid var(--border)",padding:"1px 7px",borderRadius:10}}>
                <GraduationCap size={11} strokeWidth={1.75} /> {r.course}
              </span>
            )}
            {r.email && (
              <span style={{display:"inline-flex",alignItems:"center",gap:3,color:"#2563eb",fontSize:11,cursor:"default"}}>
                <Mail size={12} strokeWidth={1.75} /> {r.email}
              </span>
            )}
          </div>
          <span style={{padding:"3px 10px",borderRadius:12,background:badge.bg,color:badge.fg,fontWeight:800,fontSize:11}}>{effectiveStatus}</span>
        </div>

        <div style={{display:"flex",alignItems:"center",flexWrap:"wrap",gap:8,padding:"6px 9px",background:"var(--surface2)",borderRadius:"var(--r-sm)"}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:12,fontWeight:700,color:"var(--text)"}}>
            <Calendar size={13} strokeWidth={1.75} color="var(--accent)" />
            {formatDate(r.borrow_date)}{r.borrow_time ? ` · ${formatTime(r.borrow_time)}` : ""}
            <span style={{color:"var(--text3)",fontWeight:400,margin:"0 3px"}}>←</span>
            {formatDate(r.overdue_since || r.return_date)}{r.return_time ? ` · ${formatTime(r.return_time)}` : ""}
          </span>
          {r.loan_type && (
            <span style={{padding:"2px 8px",borderRadius:10,background:loanTypeColor[0],color:loanTypeColor[1],fontSize:10,fontWeight:800,border:`1px solid ${loanTypeColor[1]}`}}>
              {r.loan_type}
            </span>
          )}
          <span style={{marginRight:"auto",fontSize:10,color:"var(--text3)",fontWeight:600}}>
            {items.length > 0 ? `${items.length} פריטים` : "ללא פריטים"}
          </span>
        </div>
      </div>

      {/* Items list — collapsible. Uses border-top to clearly attach to the card, not free-floating rows. */}
      {open && (
        <div style={{padding:"4px 12px 12px 12px",borderTop:"1px dashed var(--border)",marginTop:2}}>
          {items.length > 0 ? (
            <div style={{display:"flex",flexDirection:"column",gap:4,marginTop:8}}>
              {items.map((it, idx) => {
                const eq   = equipById.get(String(it.equipment_id));
                const name = eq?.name || it.name || `פריט ${it.equipment_id}`;
                const qty  = Number(it.quantity) || 1;
                const img  = eq?.image || "";
                const isImg = img && (img.startsWith("data:") || img.startsWith("http"));
                return (
                  <div key={it.id ?? `${it.equipment_id}-${idx}`} style={{display:"flex",alignItems:"center",gap:8,padding:"3px 5px",borderRadius:"var(--r-sm)",border:"1px solid var(--border)",background:"transparent"}}>
                    <div style={{width:26,height:26,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",background:"var(--surface2)",borderRadius:5,overflow:"hidden"}}>
                      {isImg
                        ? <img src={cloudinaryThumb(img)} alt={name} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                        : img
                          ? <span style={{fontSize:15}}>{img}</span>
                          : <Package size={15} strokeWidth={1.75} color="var(--text3)"/>}
                    </div>
                    <span style={{flex:1,fontSize:12,color:"var(--text)",fontWeight:600}}>{name}</span>
                    <span style={{fontSize:12,fontWeight:800,color:"var(--accent)",padding:"1px 7px",borderRadius:7,background:"var(--accent-glow)"}}>× {qty}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{fontSize:11,color:"var(--text3)",fontStyle:"italic",padding:"6px 0"}}>אין פריטים ברשימה</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── STEP 3 BUTTONS + EQUIPMENT INFO MODAL ───────────────────────────────────
function Step3Buttons({ items, equipment, onBack, onNext, privateLoanLimitExceeded=false }) {
  const [showInfo, setShowInfo] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [focusedEq, setFocusedEq] = useState(null);
  const totalQty = items.reduce((s,i)=>s+i.quantity,0);

  // In "all equipment" mode show all equipment, otherwise only selected items
  const displayList = showAll
    ? equipment.map(eq => ({ equipment_id: eq.id, quantity: items.find(i=>i.equipment_id==eq.id)?.quantity||0, _isAll:true }))
    : items;

  return (
    <>
      {items.length>0&&<div className="highlight-box">🛒 נבחרו {items.length} סוגים ({totalQty} יחידות)</div>}
      {privateLoanLimitExceeded && (
        <div className="toast toast-error" style={{marginBottom:12,position:"static",minWidth:0,width:"100%"}}>
          <XCircle size={16} strokeWidth={1.75} />
          <span>שים לב אין לחרוג מ-4 פריטים בהשאלה פרטית</span>
        </div>
      )}
      <div className="flex gap-2">
        <button className="btn btn-secondary" onClick={onBack}>← חזור</button>

        <button className="btn btn-primary" disabled={!items.length} onClick={onNext}>המשך ← אישור</button>
      </div>

      {showInfo&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:4000,display:"flex",flexDirection:"column",alignItems:"center",direction:"rtl"}}>
          {/* Inner panel — max width so text doesn't stretch too far */}
          <div style={{width:"100%",maxWidth:"min(900px,100%)",height:"100%",display:"flex",flexDirection:"column",background:"var(--bg)"}}>

            {/* Header */}
            <div style={{padding:"14px 18px",background:"var(--surface)",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:10,flexShrink:0,flexWrap:"wrap"}}>
              <div style={{fontWeight:900,fontSize:16,flex:1}}>
                {showAll ? <><Package size={16} strokeWidth={1.75} color="var(--accent)" /> כל הציוד במחסן ({equipment.length} פריטים)</> : <><ClipboardList size={16} strokeWidth={1.75} color="var(--accent)" /> פרטי הציוד שנבחר ({items.length} פריטים)</>}
              </div>
              <div style={{display:"flex",gap:8}}>
                <button className="btn btn-secondary btn-sm"
                  style={{background:showAll?"var(--accent-glow)":"transparent",border:`1px solid ${showAll?"var(--accent)":"var(--border)"}`,color:showAll?"var(--accent)":"var(--text2)",fontWeight:700}}
                  onClick={()=>setShowAll(p=>!p)}>
                  <Package size={16} strokeWidth={1.75} color="var(--accent)" /> {showAll?"רק הנבחרים":"כל הציוד"}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={()=>setShowInfo(false)}><X size={16} strokeWidth={1.75} color="var(--text3)" /> סגור</button>
              </div>
            </div>

            {/* Scrollable list */}
            <div style={{flex:1,overflowY:"auto",padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>
              {displayList.map(itm=>{
                const eq = equipment.find(e=>e.id==itm.equipment_id);
                if(!eq) return null;
                const isImg = eq.image?.startsWith("data:")||eq.image?.startsWith("http");
                const isSelected = items.some(i=>i.equipment_id==itm.equipment_id && i.quantity>0);
                return (
                  <button key={itm.equipment_id} type="button" onClick={()=>setFocusedEq(eq)} style={{
                    width:"100%",flexShrink:0,
                    background:"var(--surface)",
                    border:`2px solid ${isSelected?"var(--accent)":"var(--border)"}`,
                    borderRadius:"var(--r)",overflow:"hidden",
                    display:"flex",flexDirection:"row",
                    minHeight:"clamp(100px,28vw,188px)",
                    cursor:"pointer",
                    textAlign:"inherit",
                    padding:0,
                    alignItems:"stretch",
                  }}>
                    {/* Text — right side */}
                    <div style={{flex:1,padding:"clamp(10px,3vw,18px) clamp(12px,4vw,22px)",display:"flex",flexDirection:"column",justifyContent:"flex-start",minWidth:0,textAlign:"right",maxWidth:"calc(100% - clamp(100px,28vw,240px))",gap:"clamp(4px,1.5vw,8px)"}}>
                      <div style={{fontWeight:900,fontSize:"clamp(13px,4vw,21px)",lineHeight:1.25,whiteSpace:"normal",overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",wordBreak:"break-word"}}>{eq.name}</div>
                      <div style={{fontSize:13,color:"var(--text2)",lineHeight:1.8,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:4,WebkitBoxOrient:"vertical",wordBreak:"break-word",textAlign:"right"}}>{eq.description||"\u05D0\u05D9\u05DF \u05EA\u05D9\u05D0\u05D5\u05E8 \u05D6\u05DE\u05D9\u05DF"}</div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:10}}>
                        {isSelected&&<span style={{background:"var(--accent-glow)",border:"1px solid var(--accent)",borderRadius:20,padding:"1px 8px",fontSize:11,color:"var(--accent)",fontWeight:700,display:"inline-flex",alignItems:"center",gap:3}}><Check size={12} strokeWidth={1.75} /> ×{items.find(i=>i.equipment_id==itm.equipment_id)?.quantity}</span>}
                        {eq.notes&&<span style={{fontSize:11,color:"var(--text3)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:220}}>{"\uD83D\uDCDD"} {eq.notes}</span>}
                      </div>
                      {(eq.soundOnly || eq.photoOnly)&&<div style={{marginTop:8,display:"flex",gap:6,flexWrap:"wrap"}}>
                        {eq.soundOnly&&<span style={{background:"rgba(245,166,35,0.12)",border:"1px solid rgba(245,166,35,0.4)",borderRadius:20,padding:"1px 8px",fontSize:11,color:"var(--accent)",fontWeight:700,display:"inline-flex",alignItems:"center",gap:3}}><Mic size={12} strokeWidth={1.75} color="var(--accent)" /> ציוד סאונד</span>}
                        {eq.photoOnly&&<span style={{background:"rgba(39,174,96,0.12)",border:"1px solid rgba(39,174,96,0.35)",borderRadius:20,padding:"1px 8px",fontSize:11,color:"var(--green)",fontWeight:700}}>🎥 ציוד צילום</span>}
                      </div>}
                      <div style={{marginTop:"auto",paddingTop:8,fontSize:11,color:"var(--text3)",fontWeight:700}}>{"\u05DC\u05D7\u05E5 \u05DC\u05E4\u05EA\u05D9\u05D7\u05EA \u05D4\u05E4\u05E8\u05D9\u05D8 \u05D1\u05DE\u05E1\u05DA \u05DE\u05DC\u05D0"}</div>
                    </div>
                    {/* Image — fixed left */}
                    <div style={{width:"clamp(100px,28vw,240px)",flexShrink:0,background:"var(--surface2)",overflow:"hidden",borderLeft:"1px solid var(--border)"}}>
                      {isImg
                        ? <img src={cloudinaryThumb(eq.image)} alt={eq.name} style={{width:"100%",height:"100%",objectFit:"contain",display:"block",background:"var(--surface2)"}}/>
                        : <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:64}}>{eq.image||<Package size={64} strokeWidth={1.75} color="var(--accent)" />}</div>
                      }
                    </div>
                  </button>
                );
              })}
              {displayList.length===0&&<div style={{textAlign:"center",color:"var(--text3)",marginTop:60,fontSize:14}}>לא נבחר ציוד עדיין</div>}
            </div>

            {focusedEq && (
              <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.94)",zIndex:4100,display:"flex",flexDirection:"column",direction:"rtl"}}>
                <div style={{padding:"18px 24px",background:"var(--surface)",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,flexWrap:"wrap"}}>
                  <div>
                    <div style={{fontWeight:900,fontSize:22}}>{focusedEq.name}</div>
                    <div style={{fontSize:13,color:"var(--text3)",marginTop:4}}>
                      {focusedEq.category}
                      {focusedEq.soundOnly && <span style={{marginRight:10,color:"var(--accent)",fontWeight:700}}>• ציוד סאונד</span>}
                      {focusedEq.photoOnly && <span style={{marginRight:10,color:"var(--green)",fontWeight:700}}>• ציוד צילום</span>}
                    </div>
                  </div>
                  <button className="btn btn-secondary" onClick={()=>setFocusedEq(null)}>{"\u2716 \u05E1\u05D2\u05D5\u05E8"}</button>
                </div>
                <div style={{flex:1,overflowY:"auto",padding:"16px",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(300px,100%),1fr))",gap:16,alignItems:"start",direction:"ltr"}}>
                  <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"16px",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <div style={{width:"100%",maxWidth:"min(320px,80vw)",aspectRatio:"1 / 1",borderRadius:12,border:"1px solid var(--border)",background:"var(--surface2)",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 8px 24px rgba(0,0,0,0.28)"}}>
                      {(focusedEq.image?.startsWith("data:")||focusedEq.image?.startsWith("http"))
                        ? <img src={focusedEq.image} alt={focusedEq.name} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
                        : <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:120,background:"var(--surface2)"}}>{focusedEq.image||"\uD83D\uDCE6"}</div>
                      }
                    </div>
                  </div>
                  <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"20px",direction:"rtl",minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:800,color:"var(--text3)",letterSpacing:1,textTransform:"uppercase",marginBottom:12}}>{"\u05EA\u05D9\u05D0\u05D5\u05E8 \u05DE\u05DC\u05D0"}</div>
                    <div style={{fontSize:15,lineHeight:1.9,color:"var(--text)",whiteSpace:"pre-wrap"}}>{focusedEq.description || "\u05D0\u05D9\u05DF \u05EA\u05D9\u05D0\u05D5\u05E8 \u05D6\u05DE\u05D9\u05DF \u05DC\u05E4\u05E8\u05D9\u05D8 \u05D6\u05D4."}</div>
                    {String(focusedEq.technical_details || "").trim() && (
                      <div style={{marginTop:20,padding:"14px 16px",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)"}}>
                        <div style={{fontSize:12,fontWeight:800,color:"var(--text3)",marginBottom:6}}>פרטים טכניים</div>
                        <div style={{fontSize:14,lineHeight:1.8,whiteSpace:"pre-wrap"}}>{focusedEq.technical_details}</div>
                      </div>
                    )}
                    {focusedEq.notes && (
                      <div style={{marginTop:20,padding:"14px 16px",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)"}}>
                        <div style={{fontSize:12,fontWeight:800,color:"var(--text3)",marginBottom:6}}>{"\u05D4\u05E2\u05E8\u05D5\u05EA"}</div>
                        <div style={{fontSize:14,lineHeight:1.8}}>{focusedEq.notes}</div>
                      </div>
                    )}
              </div>
                  </div>
                </div>
            )}

          </div>
        </div>
      )}
    </>
  );
}

// ─── CERTIFICATIONS STATUS PANEL ─────────────────────────────────────────────
// Display-only modal listing certifications + pass/fail status for the logged-in
// student. Same component is used for both equipment certs (filtered by
// category !== "studio") and studio certs (filtered by category === "studio"
// AND only certs attached to studios visible to the student's track).
function CertificationsStatusPanel({ open, onClose, title, certs }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <span className="modal-title" style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
            <Shield size={16} strokeWidth={1.75}/> {title}
          </span>
          <button className="btn btn-secondary btn-sm btn-icon" onClick={onClose}>
            <X size={16} strokeWidth={1.75} color="var(--text3)"/>
          </button>
        </div>
        <div className="modal-body" style={{ direction:"rtl", maxHeight:"60vh", overflowY:"auto" }}>
          {certs.length === 0 ? (
            <div style={{ fontSize:13, color:"var(--text3)", textAlign:"center", padding:"16px 0" }}>
              אין הסמכות רלוונטיות
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {certs.map(c => {
                const passed = c.status === "עבר";
                const isNight = c.id === "cert_night_studio";
                return (
                  <div key={c.id} style={{
                    display:"flex", alignItems:"center", justifyContent:"space-between",
                    padding:"8px 12px", borderRadius:"var(--r-sm)",
                    background:"var(--surface2)", border:"1px solid var(--border)",
                    gap:8,
                  }}>
                    <span style={{ display:"inline-flex", alignItems:"center", gap:6, fontSize:13, fontWeight:600, color:"var(--text)" }}>
                      {isNight && <Moon size={14} strokeWidth={1.75} color="#2196f3"/>}
                      {c.name}
                    </span>
                    <span style={{
                      display:"inline-flex", alignItems:"center", gap:4,
                      padding:"3px 10px", borderRadius:12, fontSize:11, fontWeight:800, flexShrink:0,
                      background: passed ? "rgba(22,163,74,0.16)" : "rgba(107,114,128,0.18)",
                      color: passed ? "#16a34a" : "var(--text3)",
                    }}>
                      {passed ? <CheckCircle size={12} strokeWidth={2}/> : <XCircle size={12} strokeWidth={2}/>}
                      {c.status || "לא עבר"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── STEP 3 EQUIPMENT SELECTOR ───────────────────────────────────────────────
function Step3Equipment({ isSoundLoan, kits, loanType, categories, availEq, equipment, setItems, getItem, setQty, canBorrowEq=()=>true, crewIsCertifiedForEq=()=>true, studentRecord, certificationTypes=[], categoryLoanTypes={}, productions=[], productionId="" }) {
  const [activeKit, setActiveKit] = useState(null);
  const [kitDropOpen, setKitDropOpen] = useState(false);
  const kitDropRef = useRef(null);
  const [selectedCats, setSelectedCats] = useState([]); // multi-select, empty = all
  const [equipmentTypeFilter, setEquipmentTypeFilter] = useState("all");
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [equipCertsOpen, setEquipCertsOpen] = useState(false);

  // Build list of equipment certifications + the student's pass/fail status
  // for the modal. Excludes studio certs (`category === "studio"`) AND the
  // global night-studio cert which sometimes carries a non-"studio" category
  // in the data — both live in the studios page.
  const equipCertsList = useMemo(() => (
    (certificationTypes || [])
      .filter(t => (t.category || "") !== "studio" && t.id !== "cert_night_studio")
      .map(t => ({
        id: t.id,
        name: t.name,
        status: (studentRecord?.certs || {})[t.id] || "לא עבר",
      }))
  ), [certificationTypes, studentRecord]);

  useEffect(() => {
    if (!kitDropOpen) return;
    const close = (e) => { if (kitDropRef.current && !kitDropRef.current.contains(e.target)) setKitDropOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [kitDropOpen]);

  const relevantKits = (kits||[]).filter(k => { const lt = k.loanTypes||[]; return lt.length === 0 || lt.includes(loanType); });

  // ── Production-kit gate ──
  // When loan_type="הפקה" AND the selected production has kit_id, force-activate
  // that kit and lock the user inside it. All non-production loan types short-circuit.
  const forcedKit = useMemo(() => {
    if (loanType !== "הפקה" || !productionId) return null;
    const p = (productions || []).find(x => String(x.id) === String(productionId));
    if (!p?.kitId) return null;
    return (kits || []).find(k => String(k.id) === String(p.kitId)) || null;
  }, [productions, productionId, kits, loanType]);

  const selectKit = (kit) => {
    if (activeKit?.id === kit.id) {
      setActiveKit(null);
      setItems([]);
      return;
    }
    setActiveKit(kit);
    const newItems = [];
    for (const ki of kit.items||[]) {
      const match = availEq.find(e=>e.id==ki.equipment_id);
      if (!match || !matchesEquipmentLoanType(match, loanType, categoryLoanTypes)) continue;
      const avail = match.avail || 0;
      if(avail<=0) continue;
      const qty = Math.min(ki.quantity, avail);
      const name = equipment.find(e=>e.id==ki.equipment_id)?.name||"";
      newItems.push({equipment_id:ki.equipment_id,quantity:qty,name});
    }
    setItems(newItems);
  };

  // Auto-activate the production's kit when a director/crew opens the loan form
  // for a production with kit_id set. Non-production loans never trigger this.
  useEffect(() => {
    if (forcedKit && (!activeKit || String(activeKit.id) !== String(forcedKit.id))) {
      selectKit(forcedKit);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forcedKit?.id]);

  const toggleCat = (cat) => setSelectedCats(prev =>
    prev.includes(cat) ? prev.filter(c=>c!==cat) : [...prev, cat]
  );

  // Equipment to display: if a kit is active, only show that kit's items
  const kitEqIds = activeKit ? new Set((activeKit.items||[]).map(i=>String(i.equipment_id))) : null;
  const allowedEquipmentClassifications = getLoanTypeEquipmentClassifications(loanType, categoryLoanTypes);
  const visibleAvailEq = availEq.filter((eq) =>
    matchesEquipmentLoanType(eq, loanType, categoryLoanTypes)
    // Items restricted from external loans never appear in private/production flows.
    && !(EXTERNAL_LOAN_TYPES.includes(loanType) && eq.externalLoanRestricted));
  const enabledEquipmentTypeFilters = ["סאונד", "צילום"].filter((classification) => allowedEquipmentClassifications.includes(classification));
  const showEquipmentTypeFilters = enabledEquipmentTypeFilters.length > 1;
  const matchesEquipmentTypeFilter = (eq) => {
    const isGeneral = (!eq.soundOnly && !eq.photoOnly) || (eq.soundOnly && eq.photoOnly);
    if (!showEquipmentTypeFilters || equipmentTypeFilter === "all") return true;
    if (equipmentTypeFilter === "sound") return !!eq.soundOnly || isGeneral;
    if (equipmentTypeFilter === "photo") return !!eq.photoOnly || isGeneral;
    return true;
  };
  const typeFilteredAvailEq = visibleAvailEq.filter(matchesEquipmentTypeFilter);

  useEffect(() => {
    if (!showEquipmentTypeFilters && equipmentTypeFilter !== "all") {
      setEquipmentTypeFilter("all");
      setSelectedCats([]);
    }
  }, [showEquipmentTypeFilters, equipmentTypeFilter]);

  // Include every category that has visible items — even if the admin-managed
  // `categories` array is out of sync (missing a category that still has items).
  // This protects the public form from silently hiding entire categories when
  // `categories` drifts away from the equipment list.
  const knownOrderedCategories = categories.filter((category) => typeFilteredAvailEq.some((eq) => eq.category === category));
  const knownCategorySet = new Set(knownOrderedCategories);
  const orphanedCategories = [...new Set(
    typeFilteredAvailEq
      .map((eq) => eq.category)
      .filter((category) => category && !knownCategorySet.has(category))
  )];
  const baseCategories = [...knownOrderedCategories, ...orphanedCategories];
  const filteredCategories = selectedCats.length===0 ? baseCategories : baseCategories.filter(c=>selectedCats.includes(c));
  const selectedItemCount = typeFilteredAvailEq.filter(e=>getItem(e.id).quantity>0).length;

  return (
    <>
      <div className="form-section-title">
        בחירת ציוד
        <span style={{fontSize:11,color:"var(--text3)",fontWeight:400,marginRight:8}}>
          · מוצגים רק פריטים שסומנו כ{allowedEquipmentClassifications.map((classification) => classification === "סאונד" ? "ציוד סאונד" : classification === "צילום" ? "ציוד צילום" : "כללי").join(" + ")}
        </span>
      </div>

      {/* ── Category filter + selected toggle ── */}
      <div style={{display:"flex",flexDirection:"column",gap:9,marginBottom:14}}>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:11,fontWeight:900,color:"var(--text3)",marginLeft:2}}>סוג ציוד:</span>
          {showEquipmentTypeFilters && [
            { key:"all", label:<><Package size={12} strokeWidth={1.75}/> הכל</> },
            { key:"sound", label:<><Mic size={12} strokeWidth={1.75}/> סאונד</>, enabled: enabledEquipmentTypeFilters.includes("סאונד") },
            { key:"photo", label:<><Camera size={12} strokeWidth={1.75}/> צילום</>, enabled: enabledEquipmentTypeFilters.includes("צילום") },
          ].filter((option) => option.key === "all" || option.enabled).map((option) => {
            const active = equipmentTypeFilter === option.key;
            return (
              <button key={option.key} type="button" onClick={()=>{setEquipmentTypeFilter(option.key);setSelectedCats([]);}}
                style={{padding:"6px 12px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"rgba(148,163,184,0.34)"}`,background:active?"var(--accent)":"rgba(18,24,34,0.9)",color:active?"#0b0f14":"#dbe7ff",fontWeight:900,fontSize:11,cursor:"pointer",whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:4,boxShadow:active?"0 0 0 2px rgba(245,166,35,0.16)":"inset 0 1px 0 rgba(255,255,255,0.04)"}}>
                {option.label}
              </button>
            );
          })}
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",paddingTop:8,borderTop:"1px solid rgba(148,163,184,0.18)"}}>
          <span style={{fontSize:11,fontWeight:900,color:"var(--text3)",marginLeft:2}}>קטגוריות:</span>
          {baseCategories.map(cat=>{
            const active = selectedCats.includes(cat);
            return (
              <button key={cat} type="button" onClick={()=>toggleCat(cat)}
                style={{padding:"5px 10px",borderRadius:20,border:`1.5px solid ${active?"var(--accent)":"rgba(148,163,184,0.32)"}`,background:active?"rgba(245,166,35,0.16)":"rgba(18,24,34,0.88)",color:active?"var(--accent)":"#dbe7ff",fontWeight:800,fontSize:11,cursor:"pointer",whiteSpace:"nowrap",boxShadow:active?"0 0 0 2px rgba(245,166,35,0.1)":"none"}}>
                {cat}
              </button>
            );
          })}
          {selectedCats.length>0&&(
            <button type="button" onClick={()=>setSelectedCats([])}
              style={{padding:"4px 8px",borderRadius:20,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:11,cursor:"pointer"}}>
              <X size={16} strokeWidth={1.75} color="var(--text3)" /> נקה
            </button>
          )}
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",paddingTop:8,borderTop:"1px solid rgba(148,163,184,0.18)"}}>
          <span style={{fontSize:11,fontWeight:900,color:"var(--text3)",marginLeft:2}}>בחירה:</span>
          <button type="button" onClick={()=>{ if(!showSelectedOnly) setSelectedCats([]); setShowSelectedOnly(p=>!p); }}
            style={{padding:"6px 13px",borderRadius:20,border:`2px solid ${showSelectedOnly?"var(--green)":selectedItemCount>0?"var(--accent)":"rgba(148,163,184,0.34)"}`,background:showSelectedOnly?"rgba(46,204,113,0.14)":selectedItemCount>0?"rgba(245,166,35,0.16)":"rgba(18,24,34,0.9)",color:showSelectedOnly?"var(--green)":selectedItemCount>0?"var(--accent)":"#dbe7ff",fontWeight:900,fontSize:12,cursor:"pointer",whiteSpace:"nowrap",boxShadow:selectedItemCount>0&&!showSelectedOnly?"0 0 0 2px rgba(245,166,35,0.12)":"inset 0 1px 0 rgba(255,255,255,0.04)",transition:"all 0.2s"}}>
            {showSelectedOnly?<><CheckCircle size={12} strokeWidth={1.75}/> הצג הכל</>:<><CheckCircle size={12} strokeWidth={1.75}/> הצג נבחרים{selectedItemCount>0?` (${selectedItemCount})`:""}</>}
          </button>
        </div>
      </div>

      {/* ── Production-kit info banner (only when loan_type=הפקה + production has kit) ── */}
      {forcedKit && (
        <div style={{marginBottom:12,padding:"12px 16px",background:"rgba(52,152,219,0.12)",border:"1px solid rgba(52,152,219,0.45)",borderRadius:"var(--r)",color:"#3498db",fontSize:13,fontWeight:700,display:"flex",alignItems:"center",gap:8}}>
          <Film size={16} strokeWidth={1.75} color="#3498db"/>
          סוג ההפקה: <span style={{color:"var(--text)"}}>{forcedKit.name}</span> — ניתן לבחור רק ציוד מתוך הערכה הזו.
        </div>
      )}

      {/* ── Kit selector ── */}
      {relevantKits.length>0 && (
        <div style={{marginBottom:20,padding:"14px 16px",background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",opacity:forcedKit?0.7:1}}>
          <div style={{fontSize:12,fontWeight:800,color:"var(--accent)",marginBottom:10,letterSpacing:0.5,display:"flex",alignItems:"center",gap:6}}>
            <Film size={14} strokeWidth={1.75} color="var(--accent)" /> ערכות מוכנות לסוג השאלה זה
          </div>
          {/* Dropdown trigger */}
          <div ref={kitDropRef} style={{position:"relative"}}>
            <button type="button"
              disabled={!!forcedKit}
              onClick={()=>{ if (!forcedKit) setKitDropOpen(o=>!o); }}
              title={forcedKit ? "סוג הערכה נקבע ע\"י לוח ההפקות ולא ניתן לשינוי כאן" : undefined}
              style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:"var(--r-sm)",border:`1.5px solid ${activeKit?"var(--accent)":"var(--border)"}`,background:"var(--surface3)",cursor:forcedKit?"not-allowed":"pointer",color:"var(--text)",fontWeight:600,fontSize:13,gap:8,transition:"border-color 0.15s"}}>
              <span style={{display:"flex",alignItems:"center",gap:8}}>
                <Film size={15} strokeWidth={1.75} color={activeKit?"var(--accent)":"var(--text3)"} />
                {activeKit ? activeKit.name : <span style={{color:"var(--text3)"}}>ללא ערכה — הוסף ציוד ידנית</span>}
                {forcedKit && <span style={{fontSize:11,color:"var(--text3)",marginInlineStart:6}}>🔒</span>}
              </span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{flexShrink:0,transition:"transform 0.15s",transform:kitDropOpen?"rotate(180deg)":"rotate(0deg)"}}>
                <path d="M2 4l4 4 4-4" stroke="var(--text3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {kitDropOpen && !forcedKit && (
              <div style={{position:"absolute",top:"calc(100% + 4px)",right:0,left:0,zIndex:50,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",boxShadow:"0 8px 24px rgba(0,0,0,0.35)",overflow:"hidden"}}>
                {/* No kit option — hidden when production has a forced kit */}
                <div
                  onClick={()=>{ setActiveKit(null); setItems([]); setKitDropOpen(false); }}
                  style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",cursor:"pointer",background:!activeKit?"var(--accent-glow)":"transparent",color:!activeKit?"var(--accent)":"var(--text2)",fontWeight:!activeKit?700:500,fontSize:13,borderBottom:"1px solid var(--border)",transition:"background 0.1s"}}>
                  <X size={14} strokeWidth={1.75} color={!activeKit?"var(--accent)":"var(--text3)"} />
                  ללא ערכה — הוסף ציוד ידנית
                  {!activeKit&&<Check size={12} strokeWidth={2} style={{marginRight:"auto"}} color="var(--accent)" />}
                </div>
                {relevantKits.map(kit=>{
                  const isActive = activeKit?.id===kit.id;
                  return (
                    <div key={kit.id}
                      onClick={()=>{ selectKit(kit); setKitDropOpen(false); }}
                      style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",cursor:"pointer",background:isActive?"var(--accent-glow)":"transparent",color:isActive?"var(--accent)":"var(--text)",fontWeight:isActive?700:500,fontSize:13,borderBottom:"1px solid var(--border)",transition:"background 0.1s"}}>
                      <Film size={14} strokeWidth={1.75} color={isActive?"var(--accent)":"var(--text3)"} />
                      {kit.name}
                      {isActive&&<Check size={12} strokeWidth={2} style={{marginRight:"auto"}} color="var(--accent)" />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {activeKit && !forcedKit && (
            <div style={{fontSize:11,color:"var(--text3)",marginTop:8}}>
              מציג ציוד ערכת <strong style={{color:"var(--accent)"}}>{activeKit.name}</strong> בלבד
            </div>
          )}
        </div>
      )}

      {/* ── My equipment-certifications status (display-only) ── */}
      <div style={{marginBottom:16}}>
        <button type="button" onClick={()=>setEquipCertsOpen(true)} style={{
          width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:6,
          padding:"10px 14px", borderRadius:"var(--r-sm)", border:"1px solid var(--border)",
          background:"var(--surface2)", color:"var(--text)", fontWeight:700, fontSize:13,
          cursor:"pointer",
        }}>
          <Shield size={14} strokeWidth={1.75} color="var(--accent)"/> סטטוס הסמכות בציוד שלי
        </button>
      </div>

      {/* ── Equipment list ── */}
      {filteredCategories.map(c=>{
        let catEq = typeFilteredAvailEq.filter(e=>e.category===c);
        if(kitEqIds) catEq = catEq.filter(e=>kitEqIds.has(String(e.id)));
        if(showSelectedOnly) catEq = catEq.filter(e=>getItem(e.id).quantity>0);
        if(!catEq.length) return null;
        return (
          <div key={c} style={{marginBottom:20}}>
            <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>{c}</div>
            {catEq.map(eq=>{
              const itm = getItem(eq.id);
              // In kit mode: max qty is BOTH avail AND kit quantity — whichever is lower
              const kitEntry = activeKit ? (activeKit.items||[]).find(i=>i.equipment_id==eq.id) : null;
              const kitMax   = kitEntry ? Number(kitEntry.quantity) : Infinity;
              const effectiveMax = activeKit ? Math.min(eq.avail, kitMax) : eq.avail;
              const atMax = itm.quantity >= effectiveMax;
              return (
                <div key={eq.id} className="item-row" style={{opacity:effectiveMax===0?0.4:1}}>
                  {eq.image?.startsWith("data:")||eq.image?.startsWith("http")
                    ? <img src={cloudinaryThumb(eq.image)} alt="" style={{width:36,height:36,objectFit:"cover",borderRadius:6}}/>
                    : <span style={{fontSize:26}}>{eq.image||<Package size={26} strokeWidth={1.75} color="var(--accent)" />}</span>}
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:14}}>{eq.name}</div>
                    <div style={{fontSize:12,color:"var(--text3)"}}>
                      זמין: <span style={{color:eq.avail===0?"var(--red)":eq.avail<=2?"var(--yellow)":"var(--green)",fontWeight:700}}>{eq.avail}</span>
                      {activeKit&&kitEntry&&<span style={{color:"var(--accent)",marginRight:6,fontWeight:700}}>· מקס׳ בערכה: {kitMax}</span>}
                    </div>
                    {eq.notes&&<div style={{marginTop:4,fontSize:11,color:"var(--yellow)",fontWeight:600,display:"flex",alignItems:"flex-start",gap:4,lineHeight:1.4}}><Info size={11} strokeWidth={2} style={{flexShrink:0,marginTop:1}}/>{eq.notes}</div>}
                    {loanType==="הפקה" && !crewIsCertifiedForEq(eq) && (
                      <div style={{marginTop:4,fontSize:11,color:"#f59e0b",fontWeight:700,display:"flex",alignItems:"flex-start",gap:4,lineHeight:1.4}}>
                        <Shield size={11} strokeWidth={2} style={{flexShrink:0,marginTop:1}}/>
                        דרושה הסמכה לפני אישור
                      </div>
                    )}
                  </div>
                  {!canBorrowEq(eq)
                    ? <div style={{fontSize:11,color:"var(--yellow)",fontWeight:700,textAlign:"center",maxWidth:120,lineHeight:1.3,padding:"4px 6px",background:"rgba(241,196,15,0.12)",borderRadius:6,border:"1px solid rgba(241,196,15,0.3)"}}>
                        <Shield size={12} strokeWidth={1.75} /> טרם עבר/ה הסמכה
                      </div>
                    : effectiveMax>0
                    ? <div className="qty-ctrl">
                        <button className="qty-btn" onClick={()=>setQty(eq.id, Math.min(itm.quantity-1, effectiveMax))}>−</button>
                        <span className="qty-num">{itm.quantity}</span>
                        <button className="qty-btn" disabled={atMax} style={{opacity:atMax?0.3:1}}
                          onClick={()=>{ if(!atMax) setQty(eq.id, Math.min(itm.quantity+1, effectiveMax)); }}>+</button>
                      </div>
                    : eq.overdueBlocked
                    ? <div style={{fontSize:11,color:"#e67e22",fontWeight:700,textAlign:"center",maxWidth:130,lineHeight:1.3,padding:"5px 8px",background:"rgba(230,126,34,0.1)",borderRadius:6,border:"1px solid rgba(230,126,34,0.35)"}}>
                        <AlertTriangle size={12} strokeWidth={1.75} /> חסום ע״י השאלה באיחור
                      </div>
                    : <span className="badge badge-red">לא זמין</span>
                  }
                </div>
              );
            })}
          </div>
        );
      })}

      <CertificationsStatusPanel
        open={equipCertsOpen}
        onClose={()=>setEquipCertsOpen(false)}
        title="סטטוס הסמכות בציוד שלי"
        certs={equipCertsList}
      />
    </>
  );
}

// ─── STEP 4 CONFIRM ───────────────────────────────────────────────────────────
function Step4Confirm({ form, items, equipment, agreed, setAgreed, submitting, submit, onBack, policies, loanType, canSubmit }) {
  const [showPolicies, setShowPolicies] = useState(false);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const policyScrollRef = useRef(null);

  const policyText = (policies && policies[loanType]) || "";
  const hasPolicies = policyText.trim().length > 0;

  const handleScroll = (e) => {
    const el = e.target;
    if (el.scrollHeight - el.scrollTop <= el.clientHeight + 20) {
      setScrolledToBottom(true);
    }
  };

  // If the policy text is short enough to fit in the viewport without scrolling
  // (common for short loan types like "קולנוע יומית"), the onScroll event never
  // fires and the user gets stuck — the approve button stays disabled forever.
  // Detect "no scroll needed" right after the modal renders and unblock.
  useEffect(() => {
    if (!showPolicies) return;
    const id = requestAnimationFrame(() => {
      const el = policyScrollRef.current;
      if (!el) return;
      if (el.scrollHeight <= el.clientHeight + 20) {
        setScrolledToBottom(true);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [showPolicies, policyText]);

  return (
    <>
      <div className="form-section-title">סיכום ואישור</div>
      <div className="grid-2" style={{marginBottom:20}}>
        <div>{[["שם",form.student_name],["אימייל",form.email],["קורס",form.course],["סוג השאלה",form.loan_type],["מ",`${formatDate(form.borrow_date)}${form.borrow_time?" · "+formatTime(form.borrow_time):""}`],["עד",`${formatDate(form.return_date)}${form.return_time?" · "+formatTime(form.return_time):""}`]].map(([l,v])=><div key={l} className="req-detail-row"><span className="req-detail-label">{l}:</span><strong>{v}</strong></div>)}</div>
        <div>{items.map(i=>{
          const eq = equipment.find(e=>e.id==i.equipment_id);
          const img = eq?.image||null;
          const isFile = img && (img.startsWith("data:")||img.startsWith("http"));
          return <div key={i.equipment_id} className="req-detail-row">
            {isFile ? <img src={img} alt="" style={{width:20,height:20,objectFit:"cover",borderRadius:4,verticalAlign:"middle"}}/> : img ? <span>{img}</span> : <Package size={20} strokeWidth={1.75} color="var(--accent)" />}
            <span style={{marginRight:6}}>{i.name} × {i.quantity}</span>
          </div>;
        })}</div>
      </div>
      <div className="divider"/>

      {/* ── Policies button ── */}
      {hasPolicies && (
        <button type="button"
          onClick={()=>{ setShowPolicies(true); setScrolledToBottom(false); }}
          style={{width:"100%",padding:"12px",marginBottom:16,borderRadius:"var(--r-sm)",border:"2px solid var(--accent)",background:"var(--accent-glow)",color:"var(--accent)",fontSize:14,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
          <ClipboardList size={16} strokeWidth={1.75} color="var(--accent)" /> נהלי ההשאלה — חובה לקרוא לפני שליחה
        </button>
      )}

      {/* Checkbox */}
      <label className="checkbox-row" style={{marginBottom:20,opacity:hasPolicies&&!scrolledToBottom?0.4:1,pointerEvents:hasPolicies&&!scrolledToBottom?"none":"auto"}}>
        <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} disabled={hasPolicies&&!scrolledToBottom}/>
        <span>אני מאשר/ת שקראתי את התקנון ומתחייב/ת להחזיר את הציוד בזמן ובמצב תקין</span>
      </label>
      {hasPolicies&&!scrolledToBottom&&<div style={{fontSize:12,color:"var(--text3)",marginBottom:12,textAlign:"center"}}>יש לפתוח את נהלי ההשאלה ולגלול עד הסוף כדי לאשר</div>}

      <div className="flex gap-2">
        <button className="btn btn-secondary" onClick={onBack}>← חזור</button>
        <button className="btn btn-primary" disabled={!canSubmit||submitting} onClick={submit}>{submitting?<><Clock size={16} strokeWidth={1.75} /> שולח...</>:"🚀 שלח בקשה"}</button>
      </div>

      {/* ── Fullscreen policies modal ── */}
      {showPolicies && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:4000,display:"flex",flexDirection:"column",direction:"rtl"}}>
          {/* Header */}
          <div style={{padding:"16px 20px",background:"var(--surface)",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
            <div style={{fontWeight:900,fontSize:17,display:"flex",alignItems:"center",gap:6}}><ClipboardList size={16} strokeWidth={1.75} color="var(--accent)" /> נהלי השאלה — {loanType}</div>
            <button className="btn btn-secondary btn-sm" onClick={()=>setShowPolicies(false)}><X size={16} strokeWidth={1.75} color="var(--text3)" /> סגור</button>
          </div>
          {/* Scrollable body */}
          <div ref={policyScrollRef} onScroll={handleScroll} style={{flex:1,overflowY:"auto",padding:"24px 20px",background:"var(--surface2)",fontSize:15,lineHeight:1.9,color:"var(--text)"}}>
            <div className="policy-content" dangerouslySetInnerHTML={{__html: policyHtml(policyText)}} />
            {/* bottom anchor */}
            <div style={{height:60,display:"flex",alignItems:"center",justifyContent:"center",marginTop:24}}>
              {scrolledToBottom
                ? <span style={{color:"var(--green)",fontWeight:700,fontSize:14,display:"inline-flex",alignItems:"center",gap:4}}><CheckCircle size={16} strokeWidth={1.75} /> קראת את כל הנהלים</span>
                : <span style={{color:"var(--text3)",fontSize:13}}>↓ גלול עד הסוף</span>}
            </div>
          </div>
          {/* Footer */}
          <div style={{padding:"16px 20px",background:"var(--surface)",borderTop:"1px solid var(--border)",flexShrink:0}}>
            <button
              className="btn btn-primary"
              style={{width:"100%",fontSize:15,padding:14}}
              disabled={!scrolledToBottom}
              onClick={()=>{ setAgreed(true); setShowPolicies(false); }}>
              {scrolledToBottom ? <><CheckCircle size={16} strokeWidth={1.75} /> אני מאשר/ת שקראתי את הנהלים — סגור</> : "↓ גלול עד הסוף כדי לאשר"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── INFO PANEL ───────────────────────────────────────────────────────────────
async function downloadCommitmentPdf(base64, compressed, name) {
  const binary = atob(base64);
  const raw = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) raw[i] = binary.charCodeAt(i);
  let bytes = raw;
  if (compressed) {
    try {
      const ds = new DecompressionStream("gzip");
      const w = ds.writable.getWriter();
      w.write(raw); w.close();
      const chunks = [];
      const reader = ds.readable.getReader();
      for (;;) { const { value, done } = await reader.read(); if (done) break; chunks.push(value); }
      const total = chunks.reduce((a, c) => a + c.length, 0);
      bytes = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { bytes.set(c, off); off += c.length; }
    } catch { bytes = raw; }
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url; a.download = name || "מסמך-התחייבות.pdf"; a.click();
  URL.revokeObjectURL(url);
}

// ── Form-draft persistence (survives refresh, dies with the tab) ────────────
// Stored in sessionStorage so it doesn't outlive the browser session — that
// keeps shared/library devices safe and prevents stale drafts from sitting
// around for weeks. Key is bumped if the form shape ever changes
// incompatibly. Cleared on submit-success and on logout.
const FORM_DRAFT_KEY = "public_form_draft_v1";
function readFormDraft() {
  try {
    const raw = sessionStorage.getItem(FORM_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    return draft && typeof draft === "object" ? draft : null;
  } catch { return null; }
}
function writeFormDraft(draft) {
  try { sessionStorage.setItem(FORM_DRAFT_KEY, JSON.stringify(draft)); } catch { /* quota — ignore */ }
}
function clearFormDraft() {
  try { sessionStorage.removeItem(FORM_DRAFT_KEY); } catch { /* ignore */ }
}

// ── Equipment-UPDATE draft persistence (localStorage) ──────────────────────
// Unlike the creation draft above (sessionStorage), an in-progress equipment
// update on an EXISTING reservation must survive the browser closing entirely
// — a student can start a draft, quit the app, and come back days later to the
// same staged changes. So it lives in localStorage, keyed by the student's
// email (a shared device never leaks one student's draft to another) and, per
// email, by reservation id (a student may have a draft on more than one
// reservation over time). Entries carry a savedAt so stale drafts are pruned,
// and the restore path re-validates each op against the live reservation
// before re-hydrating it (see restore effect). Shape:
//   { [emailLower]: { [reservationId]: { ops:[...], savedAt: ms } } }
const UPDATE_DRAFT_KEY = "reservation_update_draft_v1";
const UPDATE_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
function readUpdateDraftStore() {
  try {
    const raw = localStorage.getItem(UPDATE_DRAFT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}
function writeUpdateDraftStore(store) {
  try { localStorage.setItem(UPDATE_DRAFT_KEY, JSON.stringify(store)); } catch { /* quota — ignore */ }
}
function saveUpdateDraft(email, resId, ops) {
  const key = String(email || "").toLowerCase().trim();
  if (!key || !resId) return;
  const store = readUpdateDraftStore();
  const mine = store[key] && typeof store[key] === "object" ? store[key] : {};
  if (Array.isArray(ops) && ops.length > 0) mine[String(resId)] = { ops, savedAt: Date.now() };
  else delete mine[String(resId)];
  store[key] = mine;
  writeUpdateDraftStore(store);
}
function clearUpdateDraft(email, resId) {
  const key = String(email || "").toLowerCase().trim();
  if (!key) return;
  const store = readUpdateDraftStore();
  if (!store[key]) return;
  delete store[key][String(resId)];
  writeUpdateDraftStore(store);
}

// ── Production crew snapshot (single source of truth) ───────────────────────
// Crew is defined ONCE at the production level (production_crew, roles
// photographer/sound, status 'approved') — there is NO per-date-range crew.
// Every equipment-loan reservation for a production must carry the approved
// crew's NAMES as a snapshot, because the warehouse cert-gate
// (getProductionCertBlockers) reads those snapshot fields off the reservation.
// Reused by the productions-board bridge, the in-form production picker, and at
// submit time. Always pass the reliable students source (studentsFromTable) so
// the lookup doesn't fail when certifications.students hasn't loaded yet — that
// silent failure is exactly what saved empty crew on a second date-range.
function deriveProductionCrewSnapshot(production, studentsList) {
  const blank = {
    crew_photographer_first_name: "", crew_photographer_last_name: "",
    crew_photographer_name: "", crew_photographer_phone: "",
    crew_sound_first_name: "", crew_sound_last_name: "",
    crew_sound_name: "", crew_sound_phone: "",
  };
  if (!production) return blank;
  const list = Array.isArray(studentsList) ? studentsList : [];
  const split = (n) => {
    const p = String(n || "").trim().split(/\s+/).filter(Boolean);
    return { first: p[0] || "", last: p.slice(1).join(" ") };
  };
  const resolve = (role) => {
    const m = (production.crew || []).find(c => c.role === role && c.status === "approved");
    return m ? (list.find(s => String(s.id) === String(m.studentId)) || null) : null;
  };
  const photog = resolve("photographer");
  const sound  = resolve("sound");
  const pp = split(photog?.name);
  const sp = split(sound?.name);
  return {
    crew_photographer_first_name: pp.first, crew_photographer_last_name: pp.last,
    crew_photographer_name: photog?.name || "", crew_photographer_phone: photog?.phone || "",
    crew_sound_first_name: sp.first, crew_sound_last_name: sp.last,
    crew_sound_name: sound?.name || "", crew_sound_phone: sound?.phone || "",
  };
}

// Convert a YouTube or Google Drive share URL into an embeddable iframe src.
// Returns null for unsupported hosts so the caller can render a fallback.
function videoEmbedSrc(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) return null;
  // YouTube — covers watch?v= / share / embed / shorts / live / v
  // (includes m.youtube.com / music.youtube.com because we don't anchor to start)
  let m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  // Google Drive file share link
  m = url.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/);
  if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
  return null;
}

function InfoPanel({ policies, kits, equipment, teamMembers, onClose, accentColor, commitmentPdf, commitmentPdfCompressed, commitmentPdfName, certifications, userGuideVideos = [], userGuidePdf = null }) {
  const [tab, setTab] = useState("policies");
  const [selectedEq, setSelectedEq] = useState(null);  // equipment detail view
  const [infoCatFilter, setInfoCatFilter] = useState([]); // multi-select
  const [activeVideo, setActiveVideo] = useState(null); // currently playing video (fullscreen overlay)
  const videoOverlayRef = useRef(null);
  const swipeRef = useRef({ x: 0, y: 0 });

  // When the player overlay opens, try to request native browser fullscreen
  // on the wrapper. Falls back gracefully — the overlay itself already covers
  // the viewport so the experience is fullscreen-like even without the API.
  // Also locks body scroll so the underlying InfoPanel doesn't scroll on iOS
  // while the overlay is open (touchmove escape on iOS Safari).
  useEffect(() => {
    if (!activeVideo) return;
    const el = videoOverlayRef.current;
    if (el && el.requestFullscreen) {
      el.requestFullscreen().catch(() => { /* user gesture / iframe denied — overlay still fills viewport */ });
    }
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") setActiveVideo(null); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, [activeVideo]);
  // Each label is a flex row with the icon at flex-shrink:0 and the text
  // at min-width:0 + ellipsis. This keeps the strip from overflowing the
  // viewport on small screens — the longest label ("מדריך") gets clipped
  // instead of pushing siblings off-screen.
  const tabLabel = (Icon, text) => (
    <span style={{display:"flex",alignItems:"center",gap:4,minWidth:0,maxWidth:"100%"}}>
      <Icon size={15} strokeWidth={1.75} color="var(--accent)" style={{flexShrink:0}} />
      <span style={{minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{text}</span>
    </span>
  );
  const tabs = [
    { id:"policies",  label: tabLabel(ClipboardList, "נהלים") },
    { id:"equipment", label: tabLabel(Package, "ציוד") },
    { id:"kits",      label: tabLabel(Backpack, "ערכות") },
    { id:"userGuide", label: tabLabel(BookOpen, "מדריך") },
    { id:"contact",   label: tabLabel(Phone, "צוות") },
  ];
  const LOAN_ICONS = { "פרטית":<User size={12} strokeWidth={1.75} color="var(--accent)" />,"הפקה":<Film size={12} strokeWidth={1.75} color="var(--accent)" />,"סאונד":<Mic size={12} strokeWidth={1.75} color="var(--accent)" />,"קולנוע יומית":<Camera size={12} strokeWidth={1.75} color="var(--accent)" />,"לילה":<Moon size={12} strokeWidth={1.75} color="var(--accent)" /> };
  const allCats = [...new Set((equipment||[]).map(e=>e.category).filter(Boolean))];
  const visibleEq = infoCatFilter.length===0
    ? (equipment||[])
    : (equipment||[]).filter(e=>infoCatFilter.includes(e.category));

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:5000,display:"flex",alignItems:"stretch",justifyContent:"center",padding:"0",direction:"rtl","--accent":accentColor||"#f5a623","--accent2":accentColor||"#f5a623","--accent-glow":`${accentColor||"#f5a623"}2e`}}>
      <div
        className="info-panel-box"
        style={{width:"100%",maxWidth:1100,background:"var(--surface)",display:"flex",flexDirection:"column",height:"100%",margin:"0 auto",borderLeft:"1px solid var(--border)",borderRight:"1px solid var(--border)",overflowX:"hidden"}}
        onTouchStart={e=>{ swipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
        onTouchEnd={e=>{
          const dx = e.changedTouches[0].clientX - swipeRef.current.x;
          const dy = e.changedTouches[0].clientY - swipeRef.current.y;
          // Stricter than before — was 45px / 1.2× ratio; users complained
          // that vertical scrolls with mild horizontal drift triggered an
          // accidental tab change. Now needs ≥70px horizontal AND ≥2× more
          // horizontal than vertical motion.
          if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;
          const ids = tabs.map(t=>t.id);
          const cur = ids.indexOf(tab);
          if (dx > 0 && cur > 0)                   { setTab(ids[cur-1]); setSelectedEq(null); }
          else if (dx < 0 && cur < ids.length-1)   { setTab(ids[cur+1]); setSelectedEq(null); }
        }}
      >

        {/* Header */}
        <div className="info-panel-header" style={{paddingTop:"max(clamp(12px,3vw,18px), env(safe-area-inset-top))",paddingBottom:"clamp(12px,3vw,18px)",paddingInlineStart:"max(clamp(14px,4vw,28px), env(safe-area-inset-right))",paddingInlineEnd:"max(clamp(14px,4vw,28px), env(safe-area-inset-left))",background:"var(--surface2)",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
          <div style={{flex:1,minWidth:0}}>
            <div className="info-panel-title" style={{fontWeight:900,fontSize:"clamp(15px,4.5vw,22px)",color:"var(--accent)",display:"flex",alignItems:"center",gap:8,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}><Info size={20} strokeWidth={1.75} color="var(--accent)" style={{flexShrink:0}} /> <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>מידע כללי</span></div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose} style={{fontSize:13,padding:"6px 12px",display:"inline-flex",alignItems:"center",gap:4,flexShrink:0,whiteSpace:"nowrap"}}><X size={16} strokeWidth={1.75} color="var(--text3)" /> סגור</button>
        </div>

        {/* Tabs */}
        <div className="info-panel-tabs" style={{display:"flex",gap:0,borderBottom:"2px solid var(--border)",flexShrink:0}}>
          {tabs.map(t=>(
            <button key={t.id} type="button" onClick={()=>{setTab(t.id);setSelectedEq(null);}}
              onFocus={e=>e.currentTarget.blur()}
              style={{flex:1,minWidth:0,padding:"12px 4px",border:"none",outline:"none",borderBottom:`3px solid ${tab===t.id?"var(--accent)":"transparent"}`,background:tab===t.id?"rgba(245,166,35,0.05)":"transparent",color:tab===t.id?"var(--accent)":"var(--text2)",fontWeight:tab===t.id?800:500,fontSize:"clamp(11px,2.8vw,15px)",cursor:"pointer",transition:"all 0.15s",overflow:"hidden",textOverflow:"ellipsis",WebkitTapHighlightColor:"transparent"}}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="info-panel-content" style={{flex:1,minHeight:0,overflowY:"auto",overflowX:"hidden",WebkitOverflowScrolling:"touch",padding:"clamp(14px,4vw,24px) clamp(12px,4vw,28px)"}}>

          {/* ── EQUIPMENT TAB ── */}
          {tab==="equipment" && !selectedEq && (
            <>
              {/* Category multi-filter */}
              {allCats.length>1&&(
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:18,alignItems:"center"}}>
                  {allCats.map(c=>{
                    const active=infoCatFilter.includes(c);
                    return <button key={c} type="button" onClick={()=>setInfoCatFilter(prev=>active?prev.filter(x=>x!==c):[...prev,c])}
                      style={{padding:"5px 12px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                      {c}
                    </button>;
                  })}
                  {infoCatFilter.length>0&&<button type="button" onClick={()=>setInfoCatFilter([])} style={{padding:"5px 10px",borderRadius:20,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:11,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:3}}><X size={12} strokeWidth={1.75} color="var(--text3)" /> הכל</button>}
                </div>
              )}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(220px,100%),1fr))",gap:14}}>
                {visibleEq.length===0
                  ? <div style={{color:"var(--text3)",fontSize:13,padding:"24px 0",gridColumn:"1/-1",textAlign:"center"}}>אין ציוד להצגה</div>
                  : visibleEq.map(eq=>{
                      const isImg = eq.image?.startsWith("data:")||eq.image?.startsWith("http");
                      return (
                        <div key={eq.id} onClick={()=>setSelectedEq(eq)}
                          style={{background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",padding:"16px",cursor:"pointer",transition:"border-color 0.15s,transform 0.15s"}}
                          onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--accent)";e.currentTarget.style.transform="translateY(-2px)";}}
                          onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--border)";e.currentTarget.style.transform="none";}}>
                          <div style={{display:"flex",justifyContent:"center",marginBottom:12}}>
                            {isImg
                              ? <img src={cloudinaryThumb(eq.image)} alt={eq.name} style={{width:80,height:80,objectFit:"contain",borderRadius:8}}/>
                              : <span style={{fontSize:48}}>{eq.image||<Package size={48} strokeWidth={1.75} color="var(--accent)" />}</span>}
                          </div>
                          <div style={{fontWeight:800,fontSize:14,textAlign:"center",marginBottom:4}}>{eq.name}</div>
                          <div style={{fontSize:11,color:"var(--accent)",fontWeight:700,textAlign:"center"}}>{eq.category}</div>
                          {eq.description&&<div style={{fontSize:12,color:"var(--text3)",marginTop:6,textAlign:"center",lineHeight:1.5,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{eq.description}</div>}
                          {eq.certification_id&&(certifications?.types||[]).some(t=>t.id===eq.certification_id)&&<div style={{textAlign:"center",marginTop:6,fontSize:11,color:"#9b59b6",fontWeight:700}}>🏅 דרושה הסמכה</div>}
                          <div style={{textAlign:"center",marginTop:8,fontSize:11,color:"var(--text3)"}}>לחץ לפרטים נוספים ←</div>
                        </div>
                      );
                    })
                }
              </div>
            </>
          )}

          {/* ── EQUIPMENT DETAIL ── */}
          {tab==="equipment" && selectedEq && (
            <div>
              <button type="button" onClick={()=>setSelectedEq(null)}
                style={{display:"flex",alignItems:"center",gap:6,padding:"8px 14px",borderRadius:"var(--r-sm)",border:"1px solid var(--border)",background:"var(--surface2)",color:"var(--text2)",fontSize:13,fontWeight:700,cursor:"pointer",marginBottom:24}}>
                ← חזרה לרשימה
              </button>
              {/* Desktop: image right, text left | Mobile: image top */}
              <div style={{display:"flex",gap:32,flexWrap:"wrap"}}>
                {/* Image */}
                <div style={{flexShrink:0,width:"min(100%,320px)",display:"flex",justifyContent:"center"}}>
                  {selectedEq.image?.startsWith("data:")||selectedEq.image?.startsWith("http")
                    ? <img src={selectedEq.image} alt={selectedEq.name}
                        style={{width:"100%",maxWidth:320,borderRadius:12,border:"1px solid var(--border)",objectFit:"contain",background:"var(--surface2)"}}/>
                    : <div style={{width:200,height:200,display:"flex",alignItems:"center",justifyContent:"center",fontSize:100}}>{selectedEq.image||<Package size={100} strokeWidth={1.75} color="var(--accent)" />}</div>
                  }
                </div>
                {/* Text */}
                <div style={{flex:1,minWidth:200,textAlign:"right"}}>
                  <div style={{fontWeight:900,fontSize:24,marginBottom:6}}>{selectedEq.name}</div>
                  <div style={{fontSize:14,color:"var(--accent)",fontWeight:700,marginBottom:14}}>{selectedEq.category}</div>
                  {selectedEq.description&&(
                    <div style={{fontSize:15,color:"var(--text2)",lineHeight:1.8,marginBottom:16,whiteSpace:"pre-wrap"}}>{selectedEq.description}</div>
                  )}
                  {String(selectedEq.technical_details || "").trim() && (
                    <div style={{marginBottom:16,padding:"12px 14px",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)"}}>
                      <div style={{fontSize:12,fontWeight:800,color:"var(--text3)",marginBottom:8}}>פרטים טכניים</div>
                      <div style={{fontSize:14,color:"var(--text2)",lineHeight:1.8,whiteSpace:"pre-wrap"}}>{selectedEq.technical_details}</div>
                    </div>
                  )}
                  {selectedEq.notes&&(
                    <div style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"10px 14px",fontSize:13,color:"var(--text3)",lineHeight:1.6}}>
                      📝 <strong>הערות:</strong> {selectedEq.notes}
                    </div>
                  )}
                  <div style={{marginTop:16,display:"flex",gap:8,flexWrap:"wrap"}}>
                    {selectedEq.soundOnly&&<span style={{background:"rgba(245,166,35,0.12)",border:"1px solid rgba(245,166,35,0.4)",borderRadius:20,padding:"4px 12px",fontSize:12,color:"var(--accent)",fontWeight:700,display:"inline-flex",alignItems:"center",gap:4}}><Mic size={14} strokeWidth={1.75} color="var(--accent)" /> ציוד סאונד</span>}
                    {selectedEq.photoOnly&&<span style={{background:"rgba(39,174,96,0.12)",border:"1px solid rgba(39,174,96,0.35)",borderRadius:20,padding:"4px 12px",fontSize:12,color:"var(--green)",fontWeight:700}}>🎥 ציוד צילום</span>}
                    {(()=>{const ct=(certifications?.types||[]).find(t=>t.id===selectedEq.certification_id);return ct?<span style={{background:"rgba(155,89,182,0.12)",border:"1px solid rgba(155,89,182,0.4)",borderRadius:20,padding:"4px 12px",fontSize:12,color:"#9b59b6",fontWeight:700}}>🏅 הסמכה: {ct.name}</span>:null;})()}
                  </div>
                </div>
              </div>
              <style>{`@media(max-width:600px){.info-detail-row{flex-direction:column!important;}}`}</style>
            </div>
          )}

          {/* ── USER GUIDE TAB ── */}
          {tab==="userGuide" && (
            <div style={{maxWidth:820,margin:"0 auto"}}>
              {(userGuideVideos || []).length === 0 && !userGuidePdf ? (
                <div style={{textAlign:"center",color:"var(--text3)",fontSize:14,padding:"40px 0",lineHeight:1.6}}>
                  <BookOpen size={36} strokeWidth={1.5} color="var(--text3)" style={{marginBottom:10}}/>
                  <div>המדריך למשתמש בהכנה — חזרו בקרוב.</div>
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:14}}>
                  {(userGuideVideos || []).map((v, idx) => {
                    const src = videoEmbedSrc(v.url);
                    return (
                      <div key={v.id} style={{background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",padding:16,display:"flex",flexDirection:"column",gap:12}}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <div style={{width:38,height:38,borderRadius:10,background:"var(--accent)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                            <BookOpen size={18} strokeWidth={2} />
                          </div>
                          <div style={{display:"flex",flexDirection:"column",minWidth:0,flex:1}}>
                            <div style={{fontSize:11,fontWeight:700,color:"var(--text3)",letterSpacing:0.3}}>סרטון {idx+1}</div>
                            <div style={{fontSize:16,fontWeight:900,color:"var(--text)",lineHeight:1.3,wordBreak:"break-word"}}>
                              {v.title || "ללא כותרת"}
                            </div>
                          </div>
                        </div>
                        {v.description && (
                          <div style={{fontSize:14,lineHeight:1.7,color:"var(--text2)",whiteSpace:"pre-wrap",overflowWrap:"anywhere",wordBreak:"break-word"}}>
                            {v.description}
                          </div>
                        )}
                        {src ? (
                          <button
                            type="button"
                            onClick={() => setActiveVideo({ ...v, src })}
                            className="btn btn-primary"
                            style={{alignSelf:"flex-start",fontSize:14,padding:"10px 18px",display:"inline-flex",alignItems:"center",gap:8}}
                          >
                            <span style={{fontSize:16,lineHeight:1}}>▶</span> צפה במדריך
                          </button>
                        ) : (v.url && v.url.trim()) ? (
                          // URL was provided but couldn't be parsed — bad host or typo
                          <div style={{padding:"10px 12px",borderRadius:8,background:"rgba(231,76,60,0.08)",border:"1px solid rgba(231,76,60,0.25)",color:"var(--text3)",fontSize:13,lineHeight:1.6}}>
                            לא ניתן להציג סרטון מהמקור הזה. נתמכים רק קישורי YouTube ו-Google Drive.
                          </div>
                        ) : null /* empty URL — admin hasn't pasted yet, render no button/error */ }
                      </div>
                    );
                  })}
                  {userGuidePdf && userGuidePdf.data_base64 && (
                    <button type="button"
                      onClick={()=>{
                        const bin = atob(userGuidePdf.data_base64);
                        const bytes = new Uint8Array(bin.length);
                        for (let i=0; i<bin.length; i++) bytes[i] = bin.charCodeAt(i);
                        const url = URL.createObjectURL(new Blob([bytes], { type:"application/pdf" }));
                        const a = document.createElement("a");
                        a.href = url; a.download = userGuidePdf.filename || "הוראות-הפעלה.pdf"; a.click();
                        URL.revokeObjectURL(url);
                      }}
                      style={{alignSelf:"flex-start",marginTop:4,background:accentColor||"var(--accent)",color:"#0a0c10",border:"none",borderRadius:10,padding:"12px 22px",fontWeight:900,fontSize:14,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:8}}>
                      📄 ⬇ הוראות הפעלה לסטודנט
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── POLICIES TAB ── */}
          {tab==="policies" && (
            <div style={{maxWidth:720,margin:"0 auto"}}>
              {commitmentPdf && (
                <div style={{marginBottom:24,padding:"16px 20px",background:"rgba(245,166,35,0.07)",border:"2px solid var(--accent)",borderRadius:"var(--r)",display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
                  <div style={{flex:1,minWidth:180}}>
                    <div style={{fontWeight:800,fontSize:14,color:"var(--accent)",marginBottom:4}}>📄 מסמך התחייבות — נהלי השאלת ציוד</div>
                    <div style={{fontSize:13,color:"var(--text)",lineHeight:1.6,fontWeight:700}}>הורד, הדפס וחתום על המסמך לפני השאלה ראשונה. ניתן לחתום גם דיגיטלית.</div>
                  </div>
                  <button type="button"
                    onClick={()=>downloadCommitmentPdf(commitmentPdf, commitmentPdfCompressed, commitmentPdfName)}
                    style={{background:"var(--accent)",color:"#0a0c10",border:"none",borderRadius:8,padding:"10px 20px",fontWeight:900,fontSize:13,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
                    ⬇️ הורד מסמך
                  </button>
                </div>
              )}
              {["פרטית","הפקה","סאונד","קולנוע יומית","לילה"].map(lt=>{
                const text = policies[lt];
                if(!text) return null;
                return (
                  <div key={lt} style={{marginBottom:28}}>
                    <div style={{fontWeight:800,fontSize:16,color:"var(--accent)",marginBottom:10}}>{LOAN_ICONS[lt]} נהלי השאלה {lt}</div>
                    <div className="policy-content" style={{fontSize:14,lineHeight:1.9,color:"var(--text2)",background:"var(--surface2)",borderRadius:"var(--r)",padding:"18px 20px",border:"1px solid var(--border)"}} dangerouslySetInnerHTML={{__html:policyHtml(text)}} />
                  </div>
                );
              })}
              {!policies?.פרטית && !policies?.הפקה && !policies?.סאונד && !policies?.לילה &&
                <div style={{textAlign:"center",color:"var(--text3)",fontSize:14,padding:"40px 0"}}>לא הוגדרו נהלים עדיין</div>}
            </div>
          )}

          {/* ── KITS TAB ── */}
          {tab==="kits" && (
            <div style={{display:"flex",flexDirection:"column",gap:20,maxWidth:800,margin:"0 auto"}}>
              {(kits||[]).length===0
                ? <div style={{textAlign:"center",color:"var(--text3)",fontSize:14,padding:"40px 0"}}>אין ערכות מוגדרות עדיין</div>
                : (kits||[]).filter(k=>{ const lt=k.loanTypes||[]; return lt.length===0 || lt.some(t=>t!=="שיעור"); }).map(kit=>(
                  <div key={kit.id} style={{background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",padding:"20px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:kit.description?8:14,flexWrap:"wrap"}}>
                      <span style={{fontWeight:900,fontSize:17,display:"flex",alignItems:"center",gap:6}}><Backpack size={16} strokeWidth={1.75} color="var(--accent)" /> {kit.name}</span>
                      {(kit.loanTypes||[]).map(lt=><span key={lt} style={{fontSize:12,background:"var(--accent-glow)",border:"1px solid var(--accent)",borderRadius:20,padding:"2px 10px",color:"var(--accent)",fontWeight:700,display:"inline-flex",alignItems:"center",gap:3}}>{LOAN_ICONS[lt]||<Package size={12} strokeWidth={1.75} color="var(--accent)" />} {lt}</span>)}
                    </div>
                    {kit.description&&(
                      <div style={{fontSize:14,color:"var(--text2)",marginBottom:14,lineHeight:1.7,background:"var(--surface)",borderRadius:"var(--r-sm)",padding:"10px 14px",border:"1px solid var(--border)"}}>{kit.description}</div>
                    )}
                    <div style={{fontSize:12,fontWeight:700,color:"var(--text3)",marginBottom:8,letterSpacing:0.5,textTransform:"uppercase"}}>פריטים בערכה:</div>
                    {(() => {
                      // Group items by category. Items whose equipment row is
                      // missing a category land in "ללא קטגוריה". Order of
                      // appearance follows first-seen-in-kit order so the
                      // admin's mental model is preserved.
                      const groups = new Map();
                      (kit.items||[]).forEach(item => {
                        const eq = equipment.find(e => e.id == item.equipment_id);
                        const cat = (eq?.category && String(eq.category).trim()) || "ללא קטגוריה";
                        if (!groups.has(cat)) groups.set(cat, []);
                        groups.get(cat).push({ item, eq });
                      });
                      if (groups.size === 0) return <div style={{color:"var(--text3)",fontSize:13}}>אין פריטים בערכה זו</div>;
                      return (
                        <div style={{display:"flex",flexDirection:"column",gap:14}}>
                          {[...groups.entries()].map(([cat, rows]) => (
                            <div key={cat} style={{display:"flex",flexDirection:"column",gap:6}}>
                              <div style={{fontSize:13,fontWeight:800,color:"var(--accent)",padding:"2px 0",alignSelf:"flex-start"}}>{cat}</div>
                              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                                {rows.map(({item, eq}, j) => {
                                  const isImg = eq?.image?.startsWith("data:") || eq?.image?.startsWith("http");
                                  return (
                                    <div key={j} style={{display:"flex",alignItems:"center",gap:10,background:"var(--surface)",borderRadius:"var(--r-sm)",padding:"8px 12px",border:"1px solid var(--border)"}}>
                                      <div style={{width:36,height:36,flexShrink:0,borderRadius:6,overflow:"hidden",background:"var(--surface2)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                                        {isImg ? <img src={cloudinaryThumb(eq.image)} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}}/> : <span style={{fontSize:20}}>{eq?.image||<Package size={20} strokeWidth={1.75} color="var(--accent)" />}</span>}
                                      </div>
                                      <div style={{flex:1,fontWeight:700,fontSize:14,minWidth:0,overflow:"hidden",textOverflow:"ellipsis"}}>{item.name}</div>
                                      <span style={{background:"var(--surface2)",border:"1px solid var(--accent)",borderRadius:8,padding:"2px 10px",fontWeight:900,color:"var(--accent)",fontSize:13,flexShrink:0}}>×{item.quantity}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                ))
              }
            </div>
          )}

          {/* ── CONTACT TAB ── */}
          {tab==="contact" && (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(260px,100%),1fr))",gap:12,maxWidth:900,margin:"0 auto"}}>
              {(teamMembers||[]).length===0
                ? <div style={{textAlign:"center",color:"var(--text3)",fontSize:14,padding:"40px 0",gridColumn:"1/-1"}}>אין אנשי צוות מוגדרים</div>
                : (teamMembers||[]).map(m=>(
                  <div key={m.id} style={{background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",padding:"14px 16px",display:"flex",gap:12,alignItems:"flex-start",minWidth:0,maxWidth:"100%",overflow:"hidden"}}>
                    <div style={{width:44,height:44,borderRadius:"50%",background:"linear-gradient(135deg,var(--accent),rgba(245,166,35,0.5))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:900,flexShrink:0,color:"#000"}}>{m.name?.[0]||"?"}</div>
                    <div style={{flex:1,minWidth:0,overflow:"hidden"}}>
                      <div style={{fontWeight:800,fontSize:15,marginBottom:4,overflowWrap:"anywhere"}}>{m.name}</div>
                      {m.phone&&<div style={{fontSize:13,color:"var(--text2)",marginBottom:2,overflowWrap:"anywhere"}}>📞 {m.phone}</div>}
                      <div style={{fontSize:12,color:"var(--text3)",overflowWrap:"anywhere",wordBreak:"break-word"}}>✉️ {m.email}</div>
                    </div>
                  </div>
                ))
              }
            </div>
          )}

        </div>
      </div>

      {/* ── FULLSCREEN VIDEO PLAYER OVERLAY ── */}
      {activeVideo && (
        <div
          ref={videoOverlayRef}
          onClick={(e) => { if (e.target === e.currentTarget) setActiveVideo(null); }}
          style={{
            position: "fixed", inset: 0, background: "#000",
            zIndex: 6000, display: "flex", alignItems: "center", justifyContent: "center",
            padding: 0,
          }}
        >
          <button
            type="button"
            onClick={() => setActiveVideo(null)}
            aria-label="סגור"
            style={{
              position: "fixed",
              top: "max(16px, env(safe-area-inset-top))",
              left: "max(16px, env(safe-area-inset-left))",
              zIndex: 6010,
              background: accentColor || "#f5a623",
              color: "#0a0c10",
              border: "2px solid #fff",
              boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
              borderRadius: 999,
              padding: "10px 18px",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              fontSize: 15,
              fontWeight: 900,
              lineHeight: 1,
              fontFamily: "inherit",
            }}
          >
            <X size={20} strokeWidth={2.5} color="#0a0c10" />
            <span>סגור</span>
          </button>
          {(() => {
            const isVertical = activeVideo.orientation === "vertical";
            // Vertical: cap width by viewport height * 9/16 so the 9:16 frame
            // fits in the viewport. Landscape: cap height by viewport width * 9/16.
            const wrapStyle = isVertical
              ? { height: "100vh", aspectRatio: "9 / 16", maxWidth: "100vw" }
              : { width: "100vw", aspectRatio: "16 / 9", maxHeight: "100vh" };
            return (
              <div style={{ ...wrapStyle, background: "#000", position: "relative" }}>
                <iframe
                  src={activeVideo.src}
                  title={activeVideo.description || "user guide video"}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                />
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ─── ACCOUNT SETTINGS MODAL ──────────────────────────────────────────────────
// Self-service modal for logged-in students to update their profile
// (name, login email, password). On save it calls /api/auth action
// "update-student-profile" which atomically updates both the auth.users
// row and the certifications.students record.
function AccountSettingsModal({ student, onClose, onSaved, showToast, accentColor }) {
  const [name,     setName]     = useState(String(student?.name  || ""));
  const [phone,    setPhone]    = useState(String(student?.phone || ""));
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState("");
  const notifications = useNotifications();

  const handleToggleNotifications = async (nextEnabled) => {
    const result = nextEnabled ? await notifications.enable() : await notifications.disable();
    if (result?.ok && showToast) {
      showToast("success", nextEnabled ? "התראות הופעלו" : "התראות כובו");
    } else if (!result?.ok && showToast) {
      showToast("error", result?.error || "הפעולה נכשלה");
    }
  };

  const handleSave = async () => {
    setError("");
    const nName  = String(name  || "").trim();
    const nPhoneRaw = String(phone || "").trim();
    const nPhone    = nPhoneRaw.replace(/[^\d+]/g, "");
    if (!nName || nName.length < 2) {
      setError("יש להזין שם מלא (לפחות 2 תווים).");
      return;
    }
    if (nPhone && !/^\+?\d{7,15}$/.test(nPhone)) {
      setError("מספר טלפון לא תקין (7 עד 15 ספרות).");
      return;
    }

    setBusy(true);
    const abort = new AbortController();
    const abortTimer = setTimeout(() => abort.abort(), 25000);
    let unfroze = false;
    const unfreeze = () => {
      if (unfroze) return;
      unfroze = true;
      clearTimeout(abortTimer);
      setBusy(false);
    };
    try {
      // Refresh session first — a prior password change may have invalidated the old token
      await supabase.auth.refreshSession().catch(() => {});
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        setError("אין חיבור פעיל. התחבר/י מחדש ונסה/י שוב.");
        unfreeze();
        return;
      }

      const nEmail = String(student?.email || "").trim().toLowerCase();
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-student-credentials",
          accessToken,
          name:  nName,
          email: nEmail,
          phone: nPhone,
        }),
        signal: abort.signal,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const code = data && (data.error || data.code);
        if (code === "password_too_short") {
          setError("הסיסמה קצרה מדי (לפחות 6 תווים).");
        } else if (code === "student_not_found") {
          setError("לא נמצא סטודנט פעיל תחת המייל המחובר.");
        } else if (code === "invalid_session" || code === "missing_access_token") {
          setError("פקע החיבור. התחבר/י מחדש ונסה/י שוב.");
        } else if (code === "store_update_failed") {
          setError("שמירה במסד הנתונים נכשלה. נסו שוב.");
        } else if (res.status === 400 && (!code || code === "Missing or unknown action")) {
          setError("הגרסה שבדפדפן ישנה. רענן/י את הדף (Ctrl+Shift+R) ונסה/י שוב.");
        } else {
          setError(`שגיאה בשמירה (${res.status}${code ? " · " + code : ""}). נסו שוב.`);
        }
        unfreeze();
        return;
      }

      const nextStudent =
        data.student ||
        { ...student, name: nName, email: nEmail, phone: nPhone };
      const flags = {
        emailChanged:    false,
        passwordChanged: false,
        phoneChanged:    (student?.phone || "") !== nPhone,
      };
      unfreeze();
      onClose?.();
      if (showToast) showToast("success", "הפרטים עודכנו בהצלחה");
      setTimeout(() => {
        try {
          if (onSaved) onSaved(nextStudent, flags);
        } catch (cbErr) {
          console.warn("AccountSettingsModal onSaved callback error:", cbErr);
        }
      }, 0);
    } catch (err) {
      console.warn("update-student-credentials error:", err);
      if (err && err.name === "AbortError") {
        setError("פג זמן הבקשה. בדוק/י חיבור לאינטרנט ונסה/י שוב.");
      } else {
        setError("שגיאת תקשורת. נסו שוב.");
      }
      unfreeze();
    } finally {
      unfreeze();
    }
  };

  return (
    <div
      style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",zIndex:5200,display:"flex",alignItems:"center",justifyContent:"center",padding:16,direction:"rtl","--accent":accentColor||"#f5a623"}}
      onClick={(e)=>{ if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div style={{width:"100%",maxWidth:460,background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",boxShadow:"0 30px 80px rgba(0,0,0,0.4)",overflow:"hidden"}}>
        <div style={{padding:"18px 22px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,background:"var(--surface2)"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Settings size={22} strokeWidth={1.75} color="var(--accent)" />
            <div style={{fontWeight:900,fontSize:17,color:"var(--accent)"}}>הגדרות חשבון</div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={busy}><X size={16} strokeWidth={1.75} color="var(--text3)" /></button>
        </div>

        <div style={{padding:22,display:"flex",flexDirection:"column",gap:14}}>
          <div>
            <label style={{fontSize:13,fontWeight:700,color:"var(--text2)",display:"block",marginBottom:4}}>שם מלא</label>
            <input
              className="form-input"
              type="text"
              value={name}
              onChange={(e)=>setName(e.target.value)}
              disabled={busy}
              placeholder="ישראל ישראלי"
              autoComplete="name"
            />
          </div>

          <div>
            <label style={{fontSize:13,fontWeight:700,color:"var(--text2)",display:"block",marginBottom:4}}>מספר טלפון</label>
            <input
              className="form-input"
              type="tel"
              value={phone}
              onChange={(e)=>setPhone(e.target.value)}
              disabled={busy}
              placeholder="050-1234567"
              autoComplete="tel"
              inputMode="tel"
              dir="ltr"
              style={{textAlign:"right"}}
            />
            <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>
              ישמש אותנו ליצירת קשר בנוגע להשאלות שלך.
            </div>
          </div>

          {/* ── Push notifications toggle ── */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"10px 0",borderTop:"1px solid var(--border)"}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:700,color:"var(--text2)"}}>🔔 קבלת התראות למכשיר</div>
              <div style={{fontSize:11,color:"var(--text3)",marginTop:4,lineHeight:1.5}}>
                {notifications.isSupported
                  ? "נשלח אליך התראות על עדכונים בהזמנות ובהחזרות."
                  : "הדפדפן אינו תומך בהתראות Push."}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={notifications.isEnabled}
              disabled={!notifications.isSupported || notifications.loading || notifications.busy || busy}
              onClick={()=>void handleToggleNotifications(!notifications.isEnabled)}
              style={{
                flexShrink:0,
                width:44, height:24, borderRadius:999,
                border:"1px solid var(--border)",
                background: notifications.isEnabled ? (accentColor||"var(--accent)") : "var(--surface3)",
                position:"relative", cursor: notifications.isSupported ? "pointer" : "not-allowed",
                opacity: (!notifications.isSupported || notifications.loading || notifications.busy || busy) ? 0.55 : 1,
                transition:"background 0.18s ease",
                padding:0,
              }}
            >
              <span style={{
                position:"absolute", top:1,
                [notifications.isEnabled ? "left" : "right"]: 1,
                width:20, height:20, borderRadius:"50%",
                background:"#fff", boxShadow:"0 1px 3px rgba(0,0,0,0.35)",
                transition:"all 0.18s ease",
              }} />
            </button>
          </div>

          {error && (
            <div style={{background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.4)",borderRadius:10,padding:"10px 12px",color:"#fca5a5",fontSize:13,fontWeight:600}}>
              {error}
            </div>
          )}
        </div>

        <div style={{padding:"14px 22px",borderTop:"1px solid var(--border)",display:"flex",gap:10,justifyContent:"flex-end",background:"var(--surface2)"}}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>ביטול</button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={busy}>
            {busy ? "שומר..." : "💾 שמירה"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PUBLIC FORM ──────────────────────────────────────────────────────────────
export function PublicForm({ equipment, reservations, setReservations, showToast, categories=DEFAULT_CATEGORIES, kits=[], teamMembers=[], policies={}, certifications={types:[],students:[]}, deptHeads=[], siteSettings={}, categoryLoanTypes={}, refreshInventory=async()=>({}), lecturers=[], lessons=[], canInstall=false, onInstall=()=>{}, userGuidePdf=null, productions=[], refreshProductions=async()=>{} }) {
  const initialParams = new URLSearchParams(window.location.search);
  const initialLoanTypeParam = initialParams.get("loan_type");
  const initialStepParam = Number(initialParams.get("step"));
  const initialLoanType = ["פרטית","הפקה","סאונד","קולנוע יומית"].includes(initialLoanTypeParam || "") ? initialLoanTypeParam : "";
  const initialStep = initialParams.get("calendar")==="1"
    ? 2
    : (Number.isInteger(initialStepParam) && initialStepParam >= 1 && initialStepParam <= 4 ? initialStepParam : 1);
  // Read the saved draft once at mount so step / form / items / agreed all
  // start from the user's last edits if they refreshed the page mid-form.
  const _initialDraft = readFormDraft();
  const [step, setStep]       = useState(() => {
    const d = _initialDraft;
    if (d && Number.isInteger(d.step) && d.step >= 1 && d.step <= 4) return d.step;
    return initialStep;
  });
  const [showAccountSettings, setShowAccountSettings] = useState(false);

  // Stage 6 step 5d/7: every read of certifications.students in this file
  // (login check, student lookup by id/email/phone, night-cert check, etc.)
  // now goes through public.students via studentsApi. CRITICAL: anon role
  // can't read public.students through RLS, so the initial fetch from a
  // logged-out page returns empty. We re-fetch on every auth state change
  // and fall back to the blob until something populates.
  const [tableStudents, setTableStudents] = useState(null);
  useEffect(() => {
    let alive = true;
    const refetch = () => {
      listStudents().then(s => { if (alive && Array.isArray(s) && s.length > 0) setTableStudents(s); });
    };
    refetch();
    const { data: sub } = supabase.auth.onAuthStateChange(() => refetch());
    return () => { alive = false; sub?.subscription?.unsubscribe?.(); };
  }, []);
  const studentsFromTable = tableStudents ?? (certifications?.students || []);
  const swipeTouchRef = useRef(null);
  const [form, setForm]       = useState(() => {
    const base = {student_name:"",student_first_name:"",student_last_name:"",email:"",phone:"",course:"",project_name:"",borrow_date:"",borrow_time:"",return_date:"",return_time:"",loan_type:initialLoanType,sound_day_loan:false,sound_night_loan:false,studio_booking_id:"",crew_photographer_name:"",crew_photographer_first_name:"",crew_photographer_last_name:"",crew_photographer_phone:"",crew_sound_name:"",crew_sound_first_name:"",crew_sound_last_name:"",crew_sound_phone:"",production_reason:"",production_id:"",production_date_id:""};
    const d = _initialDraft;
    if (d && d.form && typeof d.form === "object") {
      // URL ?loan=... wins over draft so links always do what they say.
      const merged = { ...base, ...d.form };
      if (initialLoanType) merged.loan_type = initialLoanType;
      return merged;
    }
    return base;
  });
  const [items, setItems]     = useState(() => {
    const d = _initialDraft;
    return d && Array.isArray(d.items) ? d.items : [];
  });
  const [agreed, setAgreed]   = useState(() => {
    const d = _initialDraft;
    return !!(d && d.agreed === true);
  });
  const [done, setDone]       = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [submitting, setSub]  = useState(false);
  // Active equipment lists panel (step 2) — display-only mirror of PublicMiniCalendar's filter+month.
  const [activeListsOpen, setActiveListsOpen] = useState(false);
  const [calSnapshot, setCalSnapshot] = useState({ loanTypeF: "הכל", calDate: new Date() });

  // Persist the draft on every change while the form is in-progress. We skip
  // when the form has been submitted (done=true) or while submitting so the
  // success handler can clear the draft cleanly without a useEffect race.
  useEffect(() => {
    if (done || submitting) return;
    writeFormDraft({ form, items, step, agreed });
  }, [form, items, step, agreed, done, submitting]);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [loggedInStudent, setLoggedInStudent] = useState(() => {
    try { const s = sessionStorage.getItem("public_student"); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  // ── Role-switch transition ────────────────────────────────────────────────
  // A role switch (StudentHub / footer / lecturer / staff buttons) sets
  // active_role, clears the identity keys and reloads "/". On that fresh load
  // loggedInStudent is null while routeByRoles re-dispatches, which would
  // otherwise flash the login screen. When we detect a pending switch
  // (active_role set + identity cleared) show a lightweight "מעביר…" screen
  // instead of the login form. A safety timeout falls back to login if
  // routing never completes.
  const [switching, setSwitching] = useState(() => {
    try { return !!sessionStorage.getItem("active_role") && !sessionStorage.getItem("public_student"); }
    catch { return false; }
  });
  // ── Password auth state ──────────────────────────────────────────────────
  const [authView, setAuthView] = useState("login"); // "login" | "forgot" | "forgot-sent"
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  // PASSWORD_RECOVERY modal (user clicked reset link from email)
  // The inline <script> in index.html sets window.__isPasswordRecovery = true
  // synchronously before any module loads, so we can pre-arm the ref here and
  // suppress any SIGNED_IN events that may fire before PASSWORD_RECOVERY.
  // This is critical in PWA mode where a stale stored session would otherwise
  // route the user into the portal before the recovery event arrives.
  const isRecoveryInitial =
    typeof window !== "undefined" && window.__isPasswordRecovery === true;
  const [recoveryMode, setRecoveryMode] = useState(isRecoveryInitial);
  const recoveryModeRef = useRef(isRecoveryInitial);
  useEffect(() => { recoveryModeRef.current = recoveryMode; }, [recoveryMode]);
  // true only after onAuthStateChange(PASSWORD_RECOVERY) fires — session is ready
  const [recoverySessionReady, setRecoverySessionReady] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryConfirm, setRecoveryConfirm] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [loginError, setLoginError] = useState(() => {
    try {
      const msg = sessionStorage.getItem("public_login_notice") || "";
      if (msg) sessionStorage.removeItem("public_login_notice");
      return msg;
    } catch {
      return "";
    }
  });
  const [publicView, setPublicView] = useState(() => sessionStorage.getItem("public_view") || "equipment"); // "equipment" | "studios" | "daily"
  const [studentApp, setStudentApp]   = useState(() => {
    // Deep-link: `?app=productions` (used by the production-deadline reminder
    // email button) lands the student straight on the productions board after
    // login. Falls back to the last-used view, then the hub.
    const appParam = initialParams.get("app");
    if (["hub","forms","productions"].includes(appParam || "")) return appParam;
    return sessionStorage.getItem("student_app") || "hub";
  }); // "hub" | "forms" | "productions"
  const [dailyLessons, setDailyLessons] = useState([]);
  const [dailyDayOffset, setDailyDayOffset] = useState(0);
  const [dailyMyLessons, setDailyMyLessons] = useState(false);
  const [studioBookings, setStudioBookings] = useState([]);
  const [studios, setStudios] = useState([]);
  const [studioWeekOffset, setStudioWeekOffset] = useState(0);
  const [studioModal, setStudioModal] = useState(null);
  const [expandedResId, setExpandedResId] = useState(null);
  const [editingBooking, setEditingBooking] = useState(null); // {id, studioId, date, startTime, endTime, isNight}
  const [editBookingSaving, setEditBookingSaving] = useState(false);
  // Per-student overlap block: when set, a floating panel explains the student
  // already has an overlapping loan request and must cancel it first.
  // Value is the conflicting reservation row, or `true` (server-side fallback).
  const [overlapBlock, setOverlapBlock] = useState(null);
  // Equipment reports state
  const [reportModal, setReportModal] = useState(null); // {equipmentId, equipmentName, reservationId, reportId?, reportStatus?}
  const [reportContent, setReportContent] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportedItems, setReportedItems] = useState(new Set()); // "eqId:resId" keys
  // myReports: persistent state loaded from DB. Lets the student see + edit their reports across refreshes.
  const [myReports, setMyReports] = useState(() => new Map()); // key "eqId:resId" → {id, content, status}
  // Clear the modal textarea when the modal is dismissed — otherwise the next
  // open (e.g. "דווח תקלה" on a different item) shows the previous report's text.
  useEffect(() => { if (!reportModal) setReportContent(""); }, [reportModal]);
  // Student-side item removal from own pending/approved reservations.
  const [removingItemsForResId, setRemovingItemsForResId] = useState(null); // string|null — which card is in remove-mode
  const [confirmRemoveItem, setConfirmRemoveItem] = useState(null); // {reservationId, itemId, itemName, isLastInReservation}
  const [confirmCancelReservation, setConfirmCancelReservation] = useState(null); // {reservationId} — explicit "cancel whole request" flow
  const [busyItemIds, setBusyItemIds] = useState(() => new Set()); // Set of item IDs currently in-flight (cancel_reservation uses res-id sentinel)
  // Synchronous in-flight guard. busyItemIds is React state — there's a render lag
  // between setState and `disabled` reflecting on the DOM, so a fast double-click
  // can fire onClick twice. The ref updates immediately and blocks the second call.
  const inflightModifyRef = useRef(new Set());
  // ── Student equipment-list UPDATES (add / increase) ──────────────────────
  // The client-side DRAFT is the only "not yet committed" stage: ops are
  // staged locally and sent together as ONE update. Submission is final and
  // counted (max 2 per reservation) — there is no withdrawal after sending.
  const [reservationUpdates, setReservationUpdates] = useState([]); // ledger rows + nested pending items
  const [updDraft, setUpdDraft] = useState(null);           // {resId, ops:[{action,equipment_id?,name?,quantity,item_id?,target_eq_id?}]}
  const [updPicker, setUpdPicker] = useState(null);         // {resId}
  const [updPickerSearch, setUpdPickerSearch] = useState("");
  const [updPickerType, setUpdPickerType] = useState("all"); // sound/photo type filter
  const [updPickerCats, setUpdPickerCats] = useState([]);    // selected category chips (empty = all)
  const restoredUpdateDraftRef = useRef(false);              // one-shot restore guard per session
  const [updSubmitting, setUpdSubmitting] = useState(false);
  const [confirmSubmitUpdate, setConfirmSubmitUpdate] = useState(null); // {resId} — the irreversible-commit gate
  const fmtDate = (d) => { if (!d) return ""; const [y,m,dd] = d.split("-"); return `${dd}.${m}.${y}`; };
  const [showEquipmentAiModal, setShowEquipmentAiModal] = useState(false);
  const [equipmentAiPrompt, setEquipmentAiPrompt] = useState("");
  const [equipmentAiLoading, setEquipmentAiLoading] = useState(false);
  const [showEquipmentAiLoanTypePrompt, setShowEquipmentAiLoanTypePrompt] = useState(false);
  const [equipmentAiForcedLoanType, setEquipmentAiForcedLoanType] = useState("");
  const todayStr = today();
  const normalizedTrackSettings = buildTrackSettings(studentsFromTable, certifications?.trackSettings, certifications?.tracks);
  const activeStudentTrack = String(loggedInStudent?.track || form.course || "").trim();
  // ── Studio classification filtering ──
  // Same hard rule as loan types: classification dictates visibility.
  //   classroomOnly=true       → hidden from public form (classes only)
  //   studioTrackType="all"    → visible to every classification
  //   studioTrackType=sound    → sound students only
  //   studioTrackType=cinema   → cinema students only
  //   unclassified studio      → hidden (admin must classify)
  //   unclassified student     → sees only "all" studios (safe default)
  const studentTrackType = normalizedTrackSettings.find(s => s.name === activeStudentTrack)?.trackType || "";
  const visibleStudios = studios.filter(studio => {
    if (studio.classroomOnly) return false;
    // studioTrackType is the new field; fall back to legacy studio.type field
    const sType = studio.studioTrackType || (studio.type === "sound" ? "sound" : studio.type === "cinema" ? "cinema" : "");
    if (sType === "all") return true;
    if (!sType) return false;
    if (!studentTrackType) return false;
    return sType === studentTrackType;
  });
  const allowedLoanTypes = activeStudentTrack
    ? (normalizedTrackSettings.find((setting) => setting.name === activeStudentTrack)?.loanTypes || [...SMART_LOAN_TYPES])
    : [...SMART_LOAN_TYPES];
  const visibleLoanTypeOptions = [
    {val:"פרטית",icon:<User size={30} strokeWidth={1.75} color="var(--accent)" />,desc:"שימוש אישי / לימודי"},
    {val:"הפקה",icon:<Film size={30} strokeWidth={1.75} color="var(--accent)" />,desc:"פרויקט הפקה מאורגן"},
    {val:"סאונד",icon:<Mic size={30} strokeWidth={1.75} color="var(--accent)" />,desc:"לתרגול הקלטות באולפני המכללה (עבור הנדסאי סאונד בלבד)"},
    {val:"קולנוע יומית",icon:<Camera size={30} strokeWidth={1.75} color="var(--accent)" />,desc:"תרגול חופשי עם ציוד קולנוע למספר שעות — יש להזמין 24 שעות מראש"},
  ].filter((option) => allowedLoanTypes.includes(option.val));

  const syncInventory = async () => {
    try {
      const refreshed = await refreshInventory();
      return {
        equipment: Array.isArray(refreshed?.equipment) ? refreshed.equipment : equipment,
        reservations: Array.isArray(refreshed?.reservations) ? refreshed.reservations : reservations,
        categories: Array.isArray(refreshed?.categories) ? refreshed.categories : categories,
        categoryLoanTypes: refreshed?.categoryLoanTypes && typeof refreshed.categoryLoanTypes === "object" && !Array.isArray(refreshed.categoryLoanTypes)
          ? refreshed.categoryLoanTypes
          : categoryLoanTypes,
      };
    } catch (error) {
      console.warn("public form inventory refresh failed", error);
      return { equipment, reservations, categories, categoryLoanTypes };
    }
  };

  // ─── שמירת מצב כניסת סטודנט ב-sessionStorage ───────────────────────────────
  useEffect(() => {
    if (loggedInStudent) {
      sessionStorage.setItem("public_student", JSON.stringify(loggedInStudent));
      setForm(p => {
        // Prefer explicit firstName/lastName; fall back to splitting `name`.
        const explicitFn = String(loggedInStudent.firstName||"").trim();
        const explicitLn = String(loggedInStudent.lastName ||"").trim();
        let fn = explicitFn;
        let ln = explicitLn;
        if (!fn && !ln) {
          const parts = String(loggedInStudent.name||"").trim().split(/\s+/).filter(Boolean);
          fn = parts[0] || ""; ln = parts.slice(1).join(" ");
        }
        const combined = [fn, ln].filter(Boolean).join(" ");
        return {
          ...p,
          student_first_name: fn || p.student_first_name,
          student_last_name:  ln || p.student_last_name,
          student_name: combined || p.student_name,
          email: loggedInStudent.email || p.email,
          ...(loggedInStudent.phone ? { phone: loggedInStudent.phone } : {}),
          ...(loggedInStudent.track ? { course: loggedInStudent.track } : {}),
        };
      });
    } else {
      sessionStorage.removeItem("public_student");
      sessionStorage.removeItem("public_view");
    }
  }, [loggedInStudent]);

  useEffect(() => {
    if (loggedInStudent) sessionStorage.setItem("student_app", studentApp);
  }, [studentApp, loggedInStudent]);

  useEffect(() => {
    if (loggedInStudent) sessionStorage.setItem("public_view", publicView);
    if (loggedInStudent && publicView === "daily") loadDailySchedule();
    // Auto-load studios+bookings whenever a student is logged in. Previously
    // we only loaded for the "studios" / "my-bookings" tabs, but the loan
    // form (default tab) ALSO needs studioBookings — specifically the sound
    // loan "שיוך לקביעת חדר" dropdown reads from `studioBookings`. Without
    // this, a student who logs in and goes straight to "השאלת סאונד" sees
    // an empty dropdown until they manually switch to קביעת חדרים and back.
    if (loggedInStudent) {
      loadStudiosData();
    }
    if (loggedInStudent && publicView === "my-bookings") loadReservationsData();
  }, [publicView, loggedInStudent]);

  // Stage 10 Session C: realtime listener on public.studio_bookings — keeps
  // the student's view in sync when other users (or other tabs of the same
  // student) create/update/delete bookings. Debounced to absorb bursts.
  useEffect(() => {
    if (!loggedInStudent) return undefined;
    // Listen on every view a logged-in student can be in — including the
    // default loan form, which now consumes studioBookings for the sound
    // loan booking dropdown.
    let debounceTimer = null;
    const channel = supabase
      .channel("public-form-studio-bookings")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "studio_bookings" },
        () => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => loadStudiosData(), 500);
        },
      )
      .subscribe();
    return () => {
      clearTimeout(debounceTimer);
      try { supabase.removeChannel(channel); } catch {}
    };
  }, [loggedInStudent, publicView]);

  // ─── טיימר חוסר פעילות — 60 שניות ─────────────────────────────────────────
  useEffect(() => {
    if (!loggedInStudent) return;
    const TIMEOUT_MS = 30 * 60 * 1000;
    const handleTimeout = () => { supabase.auth.signOut().catch(()=>{}); setLoggedInStudent(null); };
    let timer = setTimeout(handleTimeout, TIMEOUT_MS);
    const reset = () => { clearTimeout(timer); timer = setTimeout(handleTimeout, TIMEOUT_MS); };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    return () => { clearTimeout(timer); events.forEach(e => window.removeEventListener(e, reset)); };
  }, [loggedInStudent]);

  useEffect(() => {
    if (!activeStudentTrack) return;
    if (allowedLoanTypes.length === 1 && form.loan_type !== allowedLoanTypes[0]) {
      setForm((prev) => ({
        ...prev,
        loan_type: allowedLoanTypes[0],
        sound_day_loan: false,
        sound_night_loan: false,
        studio_booking_id: "",
        borrow_date: "",
        return_date: "",
        borrow_time: "",
        return_time: "",
      }));
      setItems([]);
      setAgreed(false);
      return;
    }
    if (form.loan_type && !allowedLoanTypes.includes(form.loan_type)) {
      setForm((prev) => ({
        ...prev,
        loan_type: "",
        sound_day_loan: false,
        sound_night_loan: false,
        studio_booking_id: "",
        borrow_date: "",
        return_date: "",
        borrow_time: "",
        return_time: "",
      }));
      setItems([]);
      setAgreed(false);
    }
  }, [activeStudentTrack, allowedLoanTypes, form.loan_type]);

  // Load studios data when switching to studios view
  const loadStudiosData = async () => {
    const [s, realBookings, lessons] = await Promise.all([
      listStudios(),
      listStudioBookings(),
      listLessons(),
    ]);
    if (Array.isArray(s)) setStudios(s);
    // Merge persisted bookings with in-memory lesson_auto bookings (regenerated
    // from lessons.schedule). Same pattern as App.jsx initial load.
    const lessonAuto = Array.isArray(lessons) ? buildLessonStudioBookings(lessons) : [];
    setStudioBookings([...(Array.isArray(realBookings) ? realBookings : []), ...lessonAuto]);
  };

  const loadReservationsData = async () => {
    const res = await (supabase.from("reservations_new").select("*, reservation_items(*)").then(res => (res.data || []).map(r => ({ ...r, items: r.reservation_items || [] }))));
    if (Array.isArray(res)) {
      setReservations(res);
      loadMyReports(res);
    }
    // Update ledger + pending items for the "ההזמנות שלי" cards (counter,
    // "בדיקת עדכון" badge, pending-items panel). Read-only; tiny table.
    try {
      setReservationUpdates(await listReservationUpdates());
    } catch (e) {
      console.warn("[PublicForm] listReservationUpdates failed", e?.message || e);
    }
  };

  // Pull the student's own equipment reports for their active reservations so the
  // "ערוך דיווח" button survives page refresh (the prior reportedItems Set only
  // tracked clicks within the current session).
  const loadMyReports = async (reservationsList) => {
    if (!loggedInStudent?.email) { setMyReports(new Map()); return; }
    const activeIds = (reservationsList || []).filter(r => r.status === "פעילה").map(r => String(r.id));
    if (activeIds.length === 0) { setMyReports(new Map()); return; }
    try {
      const token = await getAuthToken();
      if (!token) return;
      const res = await fetch("/api/equipment-report", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "list-mine", reservation_ids: activeIds }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const m = new Map();
      (Array.isArray(data) ? data : []).forEach(rep => {
        m.set(`${rep.equipment_id}:${rep.reservation_id}`, { id: rep.id, content: rep.content || "", status: rep.status || "open" });
      });
      setMyReports(m);
    } catch {}
  };

  // Student-side: decrement / remove an item, or cancel the whole reservation.
  // The server (student_modify_reservation_item_v1) enforces ownership + status.
  // UX: optimistic update for instant feedback; on failure, revert only the
  // affected reservation/item — NOT the whole list — to avoid full-page
  // flicker. The reservations_new realtime channel in App.jsx will catch up
  // any other drift naturally.
  const callModifyReservationItem = async ({ reservation_id, item_id, action }) => {
    const busyKey = action === "cancel_reservation" ? `res:${reservation_id}` : Number(item_id);
    if (inflightModifyRef.current.has(busyKey)) return null;
    inflightModifyRef.current.add(busyKey);
    setBusyItemIds(prev => { const next = new Set(prev); next.add(busyKey); return next; });

    // Snapshot the current reservation (deep-enough copy of items) before the
    // optimistic update, so we can revert THIS reservation only if the server
    // rejects the action. Avoids loadReservationsData() global re-fetch.
    const snapshotRes = (reservations || []).find(r => String(r.id) === String(reservation_id));
    const snapshotItems = snapshotRes ? (snapshotRes.items || []).map(it => ({ ...it })) : null;

    if (action === "cancel_reservation") {
      // Hard delete on the server (migration 20260512120000) — drop the
      // reservation from local state entirely, not just flip status.
      setReservations(prev => prev.filter(r => String(r.id) !== String(reservation_id)));
    } else {
      setReservations(prev => prev.map(r => {
        if (String(r.id) !== String(reservation_id)) return r;
        const items = (r.items || []).map(it => {
          if (Number(it.id) !== Number(item_id)) return it;
          if (action === "decrement") return { ...it, quantity: Math.max(1, Number(it.quantity || 1) - 1) };
          return null;
        }).filter(Boolean);
        return { ...r, items };
      }));
    }

    const revertLocal = () => {
      if (action === "cancel_reservation") {
        // Restore the whole reservation if it was wiped optimistically
        if (snapshotRes) {
          setReservations(prev => {
            if (prev.some(r => String(r.id) === String(reservation_id))) return prev;
            return [...prev, { ...snapshotRes, items: snapshotItems || [] }];
          });
        }
      } else if (snapshotItems) {
        setReservations(prev => prev.map(r => (
          String(r.id) === String(reservation_id) ? { ...r, items: snapshotItems } : r
        )));
      }
    };

    try {
      const token = await getAuthToken();
      const res = await fetch("/api/student-modify-reservation-items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ reservation_id, item_id, action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        revertLocal();
        if (body?.error === "stale_state") {
          showToast("info", "ההזמנה התעדכנה — בדוק את הכמות העדכנית");
        } else {
          const msg = res.status === 401 ? "התחבר מחדש"
                    : res.status === 403 ? "אין הרשאה"
                    : res.status === 404 ? "השרת לא מוכן — נסה שוב"
                    : res.status === 409 ? "ההזמנה לא ניתנת לעריכה"
                    : "שגיאה בעדכון";
          showToast("error", msg);
        }
        return null;
      }
      return body;
    } catch {
      revertLocal();
      showToast("error", "שגיאת רשת");
      return null;
    } finally {
      inflightModifyRef.current.delete(busyKey);
      setBusyItemIds(prev => { const next = new Set(prev); next.delete(busyKey); return next; });
    }
  };

  // ── Equipment-list update draft (add / increase only) ─────────────────────
  // How many units of `eq` can still be added to reservation `rRow` given the
  // current draft: other blocking loans (excluding self — its own approved
  // items don't compete with its own additions), minus the external hold,
  // minus what's already on the reservation, minus what the draft already
  // stages. Mirrors the final-fit check both new RPCs run server-side.
  const availForUpdate = (rRow, eq, draftOps = []) => {
    if (!rRow?.borrow_date || !rRow?.return_date || !eq) return 0;
    const reqStart = toDateTime(rRow.borrow_date, rRow.borrow_time || "00:00");
    const reqEnd = toDateTime(rRow.return_date, rRow.return_time || "23:59");
    const base = computeEquipmentAvailability(eq.id, reqStart, reqEnd, reservations, equipment, rRow.id).available;
    const extHold = EXTERNAL_LOAN_TYPES.includes(rRow.loan_type) ? (Number(eq.externalLoanHoldCount) || 0) : 0;
    const curQty = (rRow.items || [])
      .filter(i => String(i.equipment_id) === String(eq.id))
      .reduce((s, i) => s + (Number(i.quantity) || 0), 0);
    const staged = draftOps.reduce((s, o) => {
      if (o.action === "add" && String(o.equipment_id) === String(eq.id)) return s + o.quantity;
      if (o.action === "increase" && String(o.target_eq_id) === String(eq.id)) return s + o.quantity;
      return s;
    }, 0);
    return Math.max(0, base - extHold - curQty - staged);
  };

  // Hypothetical private-loan limited quantity after the draft is applied —
  // exact getPrivateLoanLimitedQty semantics on the merged list.
  const draftPrivateQty = (rRow, draftOps = []) => {
    if (rRow?.loan_type !== "פרטית") return 0;
    const mergedItems = [
      ...(rRow.items || []),
      ...draftOps.map(o => ({
        equipment_id: o.action === "increase" ? o.target_eq_id : o.equipment_id,
        quantity: o.quantity,
      })),
    ];
    return getPrivateLoanLimitedQty(mergedItems, equipment);
  };

  // Stage one op into the draft; merges consecutive increases on the same item.
  const stageDraftOp = (rRow, op) => {
    setUpdDraft(prev => {
      if (!prev || String(prev.resId) !== String(rRow.id)) return prev;
      if (op.action === "increase") {
        const existing = prev.ops.find(o => o.action === "increase" && Number(o.item_id) === Number(op.item_id));
        if (existing) {
          return { ...prev, ops: prev.ops.map(o => o === existing ? { ...o, quantity: o.quantity + op.quantity } : o) };
        }
      }
      return { ...prev, ops: [...prev.ops, op] };
    });
  };

  // Final commit — irreversible and counted. Only reached through the confirm
  // modal (the draft itself is the "not yet committed" safety stage).
  const submitUpdateDraft = async () => {
    if (!updDraft || !updDraft.ops.length || updSubmitting) return;
    setUpdSubmitting(true);
    const ops = updDraft.ops.map(o => ({
      action: o.action,
      quantity: o.quantity,
      ...(o.equipment_id ? { equipment_id: String(o.equipment_id), name: o.name || "" } : {}),
      ...(o.item_id != null ? { item_id: Number(o.item_id) } : {}),
    }));
    const submittedResId = String(updDraft.resId);
    const resu = await submitReservationUpdate(submittedResId, ops);
    setUpdSubmitting(false);
    setConfirmSubmitUpdate(null);
    if (resu?.ok) {
      clearUpdateDraft(loggedInStudent?.email, submittedResId); // committed → forget the draft
      setUpdDraft(null);
      showToast("success", resu.mode === "pending"
        ? "העדכון נשלח לבדיקת צוות המחסן — תתקבל הודעה לאחר הבדיקה"
        : "העדכון בוצע והפריטים נוספו לבקשה");
    } else {
      const msg = resu?.error === "lead_time" ? (resu.reason || "חלון ההתראה של סוג ההשאלה נסגר — לא ניתן להוסיף פריטים.")
        : resu?.error === "update_limit" ? "נוצלו 2 מתוך 2 העדכונים לבקשה זו."
        : resu?.error === "update_pending" ? "עדכון קודם עדיין ממתין לבדיקת המחסן."
        : resu?.error === "private_limit" ? "שים לב אין לחרוג מ-4 פריטים בהשאלה פרטית."
        : resu?.error === "not_available" ? "אחד הפריטים כבר אינו זמין בתאריכים אלה — רענן ונסה שוב."
        : resu?.error === "external_restricted" ? "אחד הפריטים מוגבל להשאלת חוץ ולא ניתן להוסיפו."
        : resu?.error === "already_started" ? "מועד האיסוף כבר הגיע — לא ניתן לעדכן את הבקשה."
        : resu?.error === "status_not_editable" ? "הבקשה כבר אינה במצב שניתן לעדכן."
        : "שליחת העדכון נכשלה. נסה שוב.";
      showToast("error", msg);
    }
    // Either way — refresh so counter/badge/pending panel reflect the DB truth.
    loadReservationsData();
  };

  // Persist the active update draft to localStorage on every change, so it
  // survives a full app close. Keyed by student email + reservation id.
  // Cancel and submit clear their own entry explicitly; here we only write the
  // live draft (or remove it once its ops are emptied).
  useEffect(() => {
    const email = loggedInStudent?.email;
    if (!email || !updDraft) return;
    saveUpdateDraft(email, updDraft.resId, updDraft.ops);
  }, [updDraft, loggedInStudent?.email]);

  // Restore a saved draft when the student returns (once per session). Runs
  // only after reservations + equipment are loaded so op targets can be
  // validated. A draft is dropped if the reservation is gone / no longer
  // editable / past its lead-time / at the 2-update cap / already has a pending
  // update; individual ops are dropped if their target item or equipment no
  // longer exists. Whatever remains is re-hydrated into the draft and its card
  // is opened, so the student lands exactly where they left off.
  useEffect(() => {
    if (restoredUpdateDraftRef.current) return;
    const email = String(loggedInStudent?.email || "").toLowerCase().trim();
    if (!email || reservations.length === 0 || equipment.length === 0) return;
    restoredUpdateDraftRef.current = true;

    const store = readUpdateDraftStore();
    const mine = store[email] && typeof store[email] === "object" ? store[email] : {};
    const now = Date.now();
    let changed = false;
    let best = null; // most-recently-saved still-valid draft → auto-open

    for (const [resId, entry] of Object.entries(mine)) {
      const drop = () => { delete mine[resId]; changed = true; };
      if (!entry || !Array.isArray(entry.ops) || (now - (entry.savedAt || 0)) > UPDATE_DRAFT_TTL_MS) { drop(); continue; }
      const rRow = reservations.find(x => String(x.id) === String(resId));
      if (!rRow) { drop(); continue; }
      const st = getEffectiveStatus(rRow);
      const editable = (st === "ממתין" || st === "אישור ראש מחלקה" || st === "מאושר") &&
        rRow.loan_type !== "שיעור" && rRow.booking_kind !== "lesson";
      const upds = reservationUpdates.filter(u => String(u.reservation_id) === String(resId));
      const hasPending = upds.some(u => u.review_status === "pending");
      const leadOk = getUpdateLeadTimeState(rRow).allowed;
      if (!editable || hasPending || upds.length >= MAX_RESERVATION_UPDATES || !leadOk) { drop(); continue; }
      // keep only ops whose targets still exist
      const validOps = entry.ops.filter(o => {
        if (o.action === "increase") return (rRow.items || []).some(i => Number(i.id) === Number(o.item_id));
        if (o.action === "add") return equipment.some(e => String(e.id) === String(o.equipment_id));
        return false;
      });
      if (validOps.length === 0) { drop(); continue; }
      if (validOps.length !== entry.ops.length) { entry.ops = validOps; changed = true; }
      if (!best || (entry.savedAt || 0) > (best.savedAt || 0)) best = { resId: String(resId), ops: validOps, savedAt: entry.savedAt };
    }

    if (changed) { store[email] = mine; writeUpdateDraftStore(store); }
    if (best) {
      setUpdDraft({ resId: best.resId, ops: best.ops });
      setExpandedResId(best.resId);
      showToast("info", "שוחזרה טיוטת עדכון שלא נשלחה");
    }
  }, [reservations, equipment, reservationUpdates, loggedInStudent?.email]);

  const loadDailySchedule = async () => {
    const lessons = await listLessons();
    setDailyLessons(Array.isArray(lessons) ? lessons : []);
  };

  // ── Password-based login (unified — all roles) ─────────────────────────────
  const handleLogin = async () => {
    const email = loginEmail.toLowerCase().trim();
    const password = loginPassword;
    if (!email || !password) return;
    setLoginBusy(true);
    setLoginError("");

    // Safety net: guarantee the button unfreezes even if something below hangs.
    const safety = setTimeout(() => {
      setLoginBusy(false);
      setLoginError("זמן התגובה חרג מהצפוי. רענן את הדף ונסה שוב.");
    }, 10_000);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data?.user) {
        clearTimeout(safety);
        setLoginError("אימייל או סיסמה שגויים. אם זו הכניסה הראשונה שלך, לחץ/י על \"שכחת סיסמה?\" ליצירת סיסמה.");
        setLoginBusy(false);
        return;
      }
      // Success — directly route rather than depending on the auth listener,
      // which can be missed if the SW or a stale state interferes.
      // Force-unlock the routing mutex: a background session check (300ms
      // mount-time getSession) may have locked it before the user clicked
      // login, causing routeByRoles to return early and leaving the page
      // frozen until a refresh. Explicit login always takes priority.
      clearTimeout(safety);
      routingRef.current = false;
      try { await routeByRoles(data.session); } catch {}
      setLoginBusy(false);
    } catch {
      clearTimeout(safety);
      setLoginError("שגיאה בתקשורת. נסו שוב.");
      setLoginBusy(false);
    }
  };

  // ── Forgot password (unified — all roles) ───────────────────────────────────
  // Uses server-side send-reset-email: generates Supabase recovery link via
  // Admin API and delivers it via Gmail, bypassing Supabase's shared SMTP which
  // is often blocked by organizational email servers (Exchange / Office 365).
  const handleForgotPassword = async () => {
    const email = loginEmail.toLowerCase().trim();
    if (!email) return;
    setLoginBusy(true);
    setLoginError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send-reset-email", email }),
      });
      if (!res.ok) {
        const ej = await res.json().catch(() => ({}));
        if (ej.error === "not_registered") {
          setLoginError("המייל לא קיים במערכת, אנא פנה/י למזכירות המכללה.");
        } else {
          setLoginError("שליחת הקישור נכשלה. נסו שוב.");
        }
        setLoginBusy(false);
        return;
      }
      setAuthView("forgot-sent");
      setLoginBusy(false);
    } catch {
      setLoginError("שגיאה בתקשורת. נסו שוב.");
      setLoginBusy(false);
    }
  };

  // ── Submit new password (after PASSWORD_RECOVERY) ──────────────────────────
  const handleUpdatePassword = async () => {
    setRecoveryError("");
    if (!recoveryPassword || recoveryPassword.length < 6) {
      setRecoveryError("הסיסמה חייבת להכיל לפחות 6 תווים");
      return;
    }
    if (recoveryPassword !== recoveryConfirm) {
      setRecoveryError("הסיסמאות אינן תואמות");
      return;
    }
    setRecoveryBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: recoveryPassword });
      if (error) {
        console.warn("updateUser failed:", error.message, error);
        const msg = (() => {
          const m = error.message || "";
          if (error.name === "AuthWeakPasswordError" || m.toLowerCase().includes("weak") || m.toLowerCase().includes("easy to guess"))
            return "הסיסמה נפוצה מדי — נסה/י סיסמה אחרת (לא 123456 וכד׳)";
          if (m.toLowerCase().includes("at least"))
            return "הסיסמה קצרה מדי — נדרשים לפחות 6 תווים";
          return "עדכון הסיסמה נכשל — נסו שוב";
        })();
        setRecoveryError(msg);
        setRecoveryBusy(false);
        return;
      }
      // Sign out so user must log in fresh with the new password
      await supabase.auth.signOut();
      setRecoveryBusy(false);
      recoveryModeRef.current = false;
      setRecoveryMode(false);
      setRecoveryPassword("");
      setRecoveryConfirm("");
      setAuthView("login");
      showToast("success", "הסיסמה עודכנה בהצלחה! התחבר/י עם הסיסמה החדשה.");
    } catch {
      setRecoveryError("שגיאה בתקשורת. נסו שוב.");
      setRecoveryBusy(false);
    }
  };

  // Helper: upsert auth_entity_map row via authenticated Supabase client.
  // The table has TWO unique constraints — UNIQUE(auth_user_id) and
  // UNIQUE(entity_type, entity_id). A naive upsert with onConflict on one
  // key 409s when the OTHER key already collides (e.g. student deleted +
  // recreated with new auth_user_id but same id, or email re-used by a new
  // auth account). To keep login resilient we wipe both potential
  // collisions, then insert.
  const upsertAuthEntityMap = async (authUserId, entityType, entityId, email) => {
    // authUserId is unused — the RPC pulls it from auth.uid() server-side so a
    // user can't pretend to link someone else's auth account. We keep the param
    // for API compatibility with the call sites.
    void authUserId;
    try {
      // Atomic SECURITY DEFINER RPC: cleans the stale row (entity already mapped
      // to a different auth_user_id, e.g. after password reset) AND inserts the
      // new mapping in one transaction. The plain client-side DELETE+UPSERT
      // version was returning 409 because RLS silently denied the DELETE step
      // (no DELETE policy on auth_entity_map), leaving the stale row in place.
      const { error } = await supabase.rpc("link_auth_to_entity", {
        p_entity_type: entityType,
        p_entity_id: entityId,
        p_email: email,
      });
      if (error) throw error;
    } catch (err) {
      console.warn("upsertAuthEntityMap failed:", err);
    }
  };

  // ── Unified role-based routing helper ────────────────────────────────────────
  const routingRef = useRef(false);
  const routeByRoles = async (session) => {
    // Prevent concurrent calls — handleLogin + onAuthStateChange + mount check
    // can all fire at the same time and cause race conditions / freezes.
    if (routingRef.current) return;
    routingRef.current = true;
    try { return await routeByRolesCore(session); }
    finally { routingRef.current = false; }
  };
  // Keep a ref to always-latest routeByRoles so mount-only effects can call it
  // without stale closures over certifications/lecturers.
  const routeByRolesLatest = useRef(routeByRoles);
  useEffect(() => { routeByRolesLatest.current = routeByRoles; });

  const routeByRolesCore = async (session) => {
    const authEmail = session.user.email.toLowerCase().trim();
    const authUserId = session.user.id;

    // Fetch user roles from public.users
    const { data: userRow, error: userError } = await supabase
      .from("users")
      .select("id,full_name,email,phone,is_student,is_lecturer,is_warehouse,is_admin,permissions")
      .eq("id", authUserId)
      .single();

    if (userError || !userRow) {
      // No public.users row — verify eligibility via multiple paths so a
      // transient store load delay or local drift cannot cause a spurious
      // "not found" for a legitimate user.
      // Stage 6 step 7 fix: anon role can't read public.students (RLS),
      // so the cached studentsFromTable from mount may be empty. We're now
      // authenticated — re-fetch directly to get current state.
      const freshStudents = (await listStudents()) ?? [];
      const isStudent = freshStudents.some(s => s.email?.toLowerCase().trim() === authEmail)
        || studentsFromTable.some(s => s.email?.toLowerCase().trim() === authEmail);
      const isLecturer = (lecturers || []).some(l => l.isActive !== false && l.email?.toLowerCase().trim() === authEmail);
      // Final fallback — ask the server (which uses the service-role key and
      // has direct access to the authoritative store data). This protects
      // against the race where certifications/lecturers haven't yet loaded
      // into props when a fast user signs in.
      let eligibleByServer = false;
      if (!isStudent && !isLecturer) {
        try {
          const r = await fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "ensure-user", email: authEmail, provision: true }),
          });
          eligibleByServer = r.ok;
        } catch {}
      }

      if (!isStudent && !isLecturer && !eligibleByServer) {
        setLoginError("המשתמש לא נמצא במערכת. פנה/י למנהל.");
        await supabase.auth.signOut();
        return;
      }
      // Auto-provision public.users row via ensure-user API (skip if the
      // server-fallback above already called it).
      if (!eligibleByServer) {
        try {
          await fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "ensure-user", email: authEmail, provision: true }),
          });
        } catch {}
      }
      // Re-fetch the newly created row
      const { data: retryRow } = await supabase
        .from("users")
        .select("id,full_name,email,phone,is_student,is_lecturer,is_warehouse,is_admin,permissions")
        .eq("id", authUserId)
        .single();
      if (!retryRow) {
        setLoginError("המשתמש לא נמצא במערכת. פנה/י למנהל.");
        await supabase.auth.signOut();
        return;
      }
      // Continue with the newly created row (ensure-user just wrote live
      // flags for ALL roles — no drift check needed on this fresh row).
      return await routeByRolesInner(retryRow, authUserId, authEmail, freshStudents);
    }

    // ── Role-flag drift detection ────────────────────────────────────────────
    // public.users.is_student/is_lecturer go stale when an admin adds an
    // existing user's email to students/lecturers AFTER the users row was
    // created (ensure-user only runs when the row is missing). Detect drift
    // locally and let the server (service role) reconcile — the client cannot
    // write to public.users (RLS). The /api/auth call runs only on detected
    // drift; the listStudents() result is reused by routeToStudent below so
    // student logins pay no extra round-trip.
    //
    // SKIPPED during a role switch (active_role hint set): the flags were
    // already reconciled at the original login, so a switch must not pay for
    // the extra listStudents() + ensure-user round-trip — that latency is
    // exactly what made switches feel slow.
    let effectiveRow = userRow;
    let freshStudents;
    const midSwitch = (() => { try { return !!sessionStorage.getItem("active_role"); } catch { return false; } })();
    if (!midSwitch) {
      freshStudents = (await listStudents()) ?? [];
      const liveIsStudent = freshStudents.some(
        (s) => s.email?.toLowerCase().trim() === authEmail,
      );
      const liveIsLecturer = (lecturers || []).some(
        (l) => l.isActive !== false && l.email?.toLowerCase().trim() === authEmail,
      );
      if (!!userRow.is_student !== liveIsStudent || !!userRow.is_lecturer !== liveIsLecturer) {
        // Note: a not-yet-hydrated lecturers prop can trigger a spurious drift
        // call — harmless, the server recomputes from DB truth and is the
        // tiebreaker; the client never writes flags.
        try {
          await fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "ensure-user", email: authEmail, provision: true }),
          });
          const { data: synced } = await supabase
            .from("users")
            .select("id,full_name,email,phone,is_student,is_lecturer,is_warehouse,is_admin,permissions")
            .eq("id", authUserId)
            .single();
          if (synced) effectiveRow = synced;
        } catch {}
      }
    }

    return await routeByRolesInner(effectiveRow, authUserId, authEmail, freshStudents);
  };

  const routeByRolesInner = async (userRow, authUserId, authEmail, preloadedStudents) => {
    const isStaff = userRow.is_admin || userRow.is_warehouse;
    const roleFlags = { is_admin: userRow.is_admin, is_warehouse: userRow.is_warehouse, is_student: userRow.is_student, is_lecturer: userRow.is_lecturer };

    // ── active_role hint: let multi-role users override default priority ──
    // If the hinted route fails (entity record missing — e.g. transient fetch
    // failure), clear the stale hint and fall through to default priority
    // instead of stranding the user on the login screen.
    const activeRole = sessionStorage.getItem("active_role");
    if (activeRole === "student" && userRow.is_student) {
      if (await routeToStudent(authUserId, authEmail, userRow, roleFlags, preloadedStudents)) return;
      sessionStorage.removeItem("active_role");
    }
    if (activeRole === "lecturer" && userRow.is_lecturer) {
      if (await routeToLecturer(authUserId, authEmail, userRow, roleFlags)) return;
      sessionStorage.removeItem("active_role");
    }
    if (activeRole === "staff" && isStaff) {
      // sessionStorage-only write — cannot fail, no fallthrough needed
      return routeToStaff(userRow, roleFlags);
    }
    // hint invalid or missing → fall through to default priority

    // 1. Staff/Admin (highest priority)
    if (isStaff) return routeToStaff(userRow, roleFlags);

    // 2. Lecturer
    if (userRow.is_lecturer) {
      const routed = await routeToLecturer(authUserId, authEmail, userRow, roleFlags);
      if (routed) return;
    }

    // 3. Student
    if (userRow.is_student) {
      const routed = await routeToStudent(authUserId, authEmail, userRow, roleFlags, preloadedStudents);
      if (routed) return;
    }

    // 4. No matching role — deny access
    setSwitching(false);
    setLoginError("המשתמש לא נמצא במערכת. פנה/י למנהל.");
    await supabase.auth.signOut();
  };

  // ── Role routing helpers ──────────────────────────────────────────────────
  const routeToStaff = async (userRow, roleFlags) => {
    const staffUserObj = {
      id: userRow.id,
      full_name: userRow.full_name,
      email: userRow.email,
      role: userRow.is_admin ? "admin" : "staff",
      permissions: userRow.permissions || {},
      ...roleFlags,
    };
    sessionStorage.setItem("staff_user", JSON.stringify(staffUserObj));
    sessionStorage.removeItem("public_student");
    sessionStorage.removeItem("public_student_roles");
    sessionStorage.removeItem("public_view");
    window.location.assign("/admin");
    return true;
  };

  const routeToLecturer = async (authUserId, authEmail, userRow, roleFlags) => {
    const matchedLecturer = (lecturers || []).find(
      (l) => l.isActive !== false && l.email?.toLowerCase().trim() === authEmail,
    );
    if (!matchedLecturer) return false;
    await upsertAuthEntityMap(authUserId, "lecturer", String(matchedLecturer.id), authEmail);
    try {
      sessionStorage.removeItem("public_student");
      sessionStorage.removeItem("public_student_roles");
      sessionStorage.removeItem("public_view");
      sessionStorage.setItem("lecturer_portal_user", JSON.stringify({ id: matchedLecturer.id, fullName: matchedLecturer.fullName, ...roleFlags }));
    } catch {}
    window.location.assign("/lecturer");
    return true;
  };

  const routeToStudent = async (authUserId, authEmail, userRow, roleFlags, preloadedStudents) => {
    // Stage 6 step 7 fix: anon role can't read public.students (RLS), so the
    // mount-time studentsFromTable may be empty. We're authenticated now —
    // use the list already fetched by routeByRolesCore's drift check when
    // available, otherwise re-fetch directly to get current state.
    const freshStudents = preloadedStudents ?? ((await listStudents()) ?? []);
    const stuList = freshStudents.length > 0 ? freshStudents : studentsFromTable;
    const matchedStudent = stuList.find(
      (s) => s.email?.toLowerCase().trim() === authEmail,
    );
    if (!matchedStudent) return false;
    await upsertAuthEntityMap(authUserId, "student", String(matchedStudent.id), authEmail);
    try {
      sessionStorage.removeItem("lecturer_portal_user");
      sessionStorage.removeItem("staff_user");
      sessionStorage.removeItem("staff_view");
      sessionStorage.setItem("public_student_roles", JSON.stringify(roleFlags));
    } catch {}
    setLoggedInStudent(matchedStudent);
    setSwitching(false);
    setLoginError("");
    applyStudentIdentity(matchedStudent);
    set("email", matchedStudent.email);
    if (matchedStudent.phone) set("phone", matchedStudent.phone);
    if (matchedStudent.track) set("course", matchedStudent.track);
    return true;
  };

  // Listen for Supabase auth state changes — subscribe ONCE (mount-only).
  // Uses routeByRolesLatest ref to always call the latest version with
  // current certifications/lecturers (avoids stale closure).
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        recoveryModeRef.current = true;
        setRecoveryMode(true);
        setRecoverySessionReady(true);
        return;
      }
      if (event !== "SIGNED_IN" || !session?.user?.email) return;
      if (recoveryModeRef.current) return;
      // Fire-and-forget. supabase-js awaits this listener inside
      // _notifyAllSubscribers, which is awaited inside signInWithPassword.
      // If routeByRoles blocked here (multiple DB fetches + /api/auth on a
      // fresh-after-logout login), signInWithPassword would not resolve
      // within handleLogin's 10s safety, surfacing
      // "זמן התגובה חרג מהצפוי" even though the auth itself succeeded.
      // handleLogin's success path calls routeByRoles itself after
      // signInWithPassword returns, so dropping the await here doesn't lose
      // routing for the password flow. For magic-link / recovery paths the
      // route still runs — just asynchronously, on its own time.
      routeByRolesLatest.current(session).catch(err => {
        console.warn("[auth listener] routeByRoles failed:", err);
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  // Recovery session may already be established before the listener registered —
  // poll getSession() until a session appears (handles the early-fire race).
  useEffect(() => {
    if (!isRecoveryInitial || recoverySessionReady) return;
    let cancelled = false;
    const startedAt = Date.now();
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) { setRecoverySessionReady(true); return; }
      // Give up after 8 seconds — surface an actionable error instead of
      // leaving the user stuck on "מאמת קישור...". Common cause: link opened
      // in an in-app browser (WhatsApp/Telegram) where the token couldn't
      // be exchanged, or the link already expired / was used.
      if (Date.now() - startedAt > 8000) {
        setRecoveryError("הקישור לא זמין בדפדפן הזה. פתח/י את הקישור ישירות ב-Chrome/Safari, או בקש/י קישור חדש.");
        return;
      }
      setTimeout(check, 600);
    };
    check();
    return () => { cancelled = true; };
  }, [isRecoveryInitial]);

  // Check for existing session on mount (e.g. after magic link redirect).
  // Mount-only — uses ref to avoid stale closure, routingRef prevents races.
  useEffect(() => {
    if (loggedInStudent) return;
    if (recoveryModeRef.current || recoveryMode) return;
    // Small delay: give onAuthStateChange a chance to fire first (it's the
    // primary handler). This is a fallback for cases where the listener
    // misses the event (e.g. session already existed before subscription).
    // During a role switch a session already exists (we never sign out), so
    // onAuthStateChange may not re-fire SIGNED_IN — route immediately with no
    // 300ms wait to keep the transition snappy.
    let mid = false;
    try { mid = !!sessionStorage.getItem("active_role"); } catch {}
    const t = setTimeout(() => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session?.user?.email) { setSwitching(false); return; }
        if (recoveryModeRef.current) return;
        routeByRolesLatest.current(session);
      });
    }, mid ? 0 : 300);
    return () => clearTimeout(t);
  }, []);

  // Safety net: never leave the user stuck on the "מעביר…" transition screen.
  // If routing hasn't resolved within 7s, fall back to the login form.
  useEffect(() => {
    if (!switching) return undefined;
    const t = setTimeout(() => setSwitching(false), 7000);
    return () => clearTimeout(t);
  }, [switching]);

  // Validate any student state restored from sessionStorage against the active
  // Supabase session. A manually injected sessionStorage value alone must not
  // grant access — it must be backed by a real session with a matching email.
  useEffect(() => {
    if (!loggedInStudent) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      const authEmail = session?.user?.email?.toLowerCase().trim();
      const storedEmail = String(loggedInStudent.email || "").toLowerCase().trim();
      if (!authEmail || authEmail !== storedEmail) {
        if (authEmail) supabase.auth.signOut().catch(() => {});
        setLoggedInStudent(null);
      }
    });
  }, []); // mount-only — runs once to validate the sessionStorage-restored value

  // Self-update grace window. When a student saves their own profile via the
  // Account Settings modal, we optimistically set loggedInStudent to the new
  // values BEFORE the admin `certifications` state has round-tripped through
  // the /api/store → Supabase → polling/realtime pipeline. Without this guard,
  // the gatekeeper useEffect below would see the NEW email in loggedInStudent,
  // not find it in the STALE certifications.students[], and forcibly sign the
  // user out — which is exactly the "screen freeze" bug users were hitting.
  //
  // `selfUpdateSnapshotRef.current` holds {oldEmail, newEmail, until}. While
  // the current time is < until, the gatekeeper trusts the user even if the
  // new email isn't in the store yet.
  const selfUpdateSnapshotRef = useRef(null);

  // Real-time Gatekeeper: whenever certifications (the admin source of truth)
  // updates, re-validate that the currently logged-in student still exists in
  // certifications.students. If the admin just removed them, sign out and
  // bounce back to the login screen with the standard gatekeeper error.
  useEffect(() => {
    if (!loggedInStudent) return;
    const stuList = studentsFromTable;
    if (!Array.isArray(stuList) || stuList.length === 0) return;
    const storedEmail = String(loggedInStudent.email || "").toLowerCase().trim();
    if (!storedEmail) return;

    // Grace window: the user just updated their own profile and the store
    // hasn't finished propagating yet — trust loggedInStudent for now.
    const snap = selfUpdateSnapshotRef.current;
    if (snap && Date.now() < snap.until) {
      const snapNew = String(snap.newEmail || "").toLowerCase().trim();
      const snapOld = String(snap.oldEmail || "").toLowerCase().trim();
      if (storedEmail === snapNew || storedEmail === snapOld) {
        // Also treat as present if EITHER the new or old email is in the list
        // (covers the window where the store still has the old value as well
        // as the window right after it flips to the new one).
        const presentEither = stuList.some((s) => {
          const e = String(s.email || "").toLowerCase().trim();
          return e === snapNew || e === snapOld;
        });
        if (presentEither) return;
      }
    }

    const stillExists = stuList.some(
      (s) => String(s.email || "").toLowerCase().trim() === storedEmail,
    );
    if (!stillExists) {
      supabase.auth.signOut().catch(() => {});
      setLoggedInStudent(null);
      try { sessionStorage.removeItem("public_student"); } catch {}
      try { sessionStorage.setItem("public_login_notice", "לא סטודנט/מרצה פעיל במכללה לא ניתן להיכנס"); } catch {}
      setLoginError("לא סטודנט/מרצה פעיל במכללה לא ניתן להיכנס");
    }
  }, [certifications, loggedInStudent]);

  const set = (k,v) => setForm(p=>({...p,[k]:v}));

  // ── Name split helpers ──────────────────────────────────────────────────
  // The public form keeps three fields in lockstep: student_first_name,
  // student_last_name, and the combined student_name used by every payload,
  // reservation, certification lookup, etc.
  const splitFullName = (full) => {
    const parts = String(full||"").trim().split(/\s+/).filter(Boolean);
    return { first: parts[0] || "", last: parts.slice(1).join(" ") };
  };
  const setStudentFirstName = (v) => setForm(p => {
    const fn = String(v||"");
    const ln = String(p.student_last_name||"").trim();
    const combined = [fn.trim(), ln].filter(Boolean).join(" ");
    return { ...p, student_first_name: fn, student_name: combined };
  });
  const setStudentLastName = (v) => setForm(p => {
    const fn = String(p.student_first_name||"").trim();
    const ln = String(v||"");
    const combined = [fn, ln.trim()].filter(Boolean).join(" ");
    return { ...p, student_last_name: ln, student_name: combined };
  });
  // Crew name setters — keep crew_*_name (combined) in sync with the two halves
  // so the certification-matching lookup (which joins on `name`) keeps working.
  const setCrewPhotographerFirst = (v) => setForm(p => {
    const fn = String(v||"");
    const ln = String(p.crew_photographer_last_name||"").trim();
    return { ...p, crew_photographer_first_name: fn, crew_photographer_name: [fn.trim(), ln].filter(Boolean).join(" ") };
  });
  const setCrewPhotographerLast = (v) => setForm(p => {
    const fn = String(p.crew_photographer_first_name||"").trim();
    const ln = String(v||"");
    return { ...p, crew_photographer_last_name: ln, crew_photographer_name: [fn, ln.trim()].filter(Boolean).join(" ") };
  });
  const setCrewSoundFirst = (v) => setForm(p => {
    const fn = String(v||"");
    const ln = String(p.crew_sound_last_name||"").trim();
    return { ...p, crew_sound_first_name: fn, crew_sound_name: [fn.trim(), ln].filter(Boolean).join(" ") };
  });
  const setCrewSoundLast = (v) => setForm(p => {
    const fn = String(p.crew_sound_first_name||"").trim();
    const ln = String(v||"");
    return { ...p, crew_sound_last_name: ln, crew_sound_name: [fn, ln.trim()].filter(Boolean).join(" ") };
  });

  // Use when we receive a canonical student record (login, account update).
  // Prefer explicit firstName/lastName; fall back to splitting `name`.
  const applyStudentIdentity = (stu) => setForm(p => {
    const explicitFn = String(stu?.firstName||"").trim();
    const explicitLn = String(stu?.lastName ||"").trim();
    let fn = explicitFn;
    let ln = explicitLn;
    if (!fn && !ln) {
      const sp = splitFullName(stu?.name);
      fn = sp.first; ln = sp.last;
    }
    return {
      ...p,
      student_first_name: fn,
      student_last_name:  ln,
      student_name: [fn, ln].filter(Boolean).join(" "),
    };
  });
  const setSoundDayLoan = (enabled) => {
    if (!enabled) {
      setForm((prev) => ({ ...prev, sound_day_loan:false, sound_night_loan:false, studio_booking_id:"" }));
      return;
    }
    const targetDate = getNextSoundDayLoanDate(
      ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30"]
    );
    setForm((prev) => ({
      ...prev,
      sound_day_loan:true,
      sound_night_loan:false,
      studio_booking_id:"",
      borrow_date: targetDate,
      return_date: targetDate,
      borrow_time: "",
      return_time: "",
    }));
  };

  const setSoundNightLoan = (enabled) => {
    if (!enabled) {
      setForm((prev) => ({ ...prev, sound_night_loan:false, studio_booking_id:"" }));
      return;
    }
    const now = new Date();
    if (now.getHours() >= 17) {
      showToast("error", "לא ניתן להשאיל ציוד ללילה אחרי השעה 17:00.");
      return;
    }
    const todayDate = today();
    const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate()+1); while(d.getDay()===5||d.getDay()===6) d.setDate(d.getDate()+1); return formatLocalDateInput(d); })();
    setForm((prev) => ({
      ...prev,
      sound_night_loan:true,
      sound_day_loan:false,
      borrow_date: todayDate,
      return_date: tomorrow,
      borrow_time: "",
      return_time: "09:30",
      studio_booking_id: "",
    }));
  };

  // Lead-time / duration rules live in loanPolicy.js — the ONE source shared
  // with the reservation-update flow and its server-side re-check. The "8-day
  // notice" for הפקה is INCLUSIVE — counting both the submission day and the
  // borrow day — so the calendar gap is 7 days. Mirrored in ProductionEditor.minShootISO().
  const isCinemaLoan = form.loan_type==="קולנוע יומית";
  const isWeekend = (dateStr) => {
    if(!dateStr) return false;
    const d = parseLocalDate(dateStr);
    return d.getDay()===5 || d.getDay()===6;
  };
  const addDaysLocal = (dateStr, days) => {
    const d = parseLocalDate(dateStr);
    d.setDate(d.getDate() + days);
    return formatLocalDateInput(d);
  };
  const getPastLoanTimeError = (candidateForm) => {
    const borrowDate = String(candidateForm?.borrow_date || "").trim();
    const borrowTime = String(candidateForm?.borrow_time || "").trim();
    if (!borrowDate || !borrowTime) return "";
    if (toDateTime(borrowDate, borrowTime) <= Date.now()) {
      return "לא ניתן להגיש בקשת השאלה לזמן שכבר עבר. יש לבחור זמן עתידי בלבד.";
    }
    return "";
  };
  const getSmartEquipmentPolicyError = (candidateForm, candidateItems) => {
    const loanType = normalizeSmartLoanType(candidateForm?.loan_type);
    const borrowDate = String(candidateForm?.borrow_date || "").trim();
    const returnDate = String(candidateForm?.return_date || "").trim();
    const borrowTime = String(candidateForm?.borrow_time || "").trim();
    const returnTime = String(candidateForm?.return_time || "").trim();

    if (!loanType || !borrowDate || !returnDate || !borrowTime || !returnTime) return "";

    const candidateIsCinema = loanType === "קולנוע יומית";
    const candidateIsSound = loanType === "סאונד";
    const candidateMinDate = computeMinBorrowDate(loanType);
    const candidateMaxDays = loanMaxDays(loanType);
    const candidateBorrowWeekend = isWeekend(borrowDate);
    const candidateReturnWeekend = isWeekend(returnDate);
    const candidateReturnBeforeBorrow = parseLocalDate(returnDate) < parseLocalDate(borrowDate);
    const candidateSameDay = borrowDate === returnDate;
    const candidateTimeOrderError = candidateSameDay && toDateTime(returnDate, returnTime) <= toDateTime(borrowDate, borrowTime);
    const candidateLoanDays = Math.ceil((parseLocalDate(returnDate) - parseLocalDate(borrowDate)) / 86400000) + 1;
    const candidatePastTimeError = getPastLoanTimeError(candidateForm);

    if (candidateBorrowWeekend || (!candidateIsCinema && candidateReturnWeekend)) {
      return "הבקשה שפוענחה מנוגדת לנהלי המכללה: המחסן אינו פעיל בימי שישי ושבת, ולכן יש לבחור ימי השאלה והחזרה בין ראשון לחמישי בלבד.";
    }
    if (!candidateIsSound && !candidateIsCinema && borrowDate < candidateMinDate) {
      if (loanType === "פרטית") {
        return `הבקשה שפוענחה מנוגדת לנהלי המכללה: השאלה פרטית דורשת התראה של 24 שעות לפחות. התאריך המוקדם ביותר האפשרי הוא ${formatDate(candidateMinDate)}.`;
      }
      return `הבקשה שפוענחה מנוגדת לנהלי המכללה: סוג ההשאלה ${loanType} דורש התראה של שבוע לפחות. התאריך המוקדם ביותר האפשרי הוא ${formatDate(candidateMinDate)}.`;
    }
    if (candidateIsCinema && borrowDate < candidateMinDate) {
      return `הבקשה שפוענחה מנוגדת לנהלי המכללה: השאלת קולנוע יומית דורשת הזמנה של 24 שעות מראש. התאריך המוקדם ביותר האפשרי הוא ${formatDate(candidateMinDate)}.`;
    }
    if (candidateReturnBeforeBorrow) {
      return "הבקשה שפוענחה מנוגדת לנהלי המכללה: תאריך ההחזרה חייב להיות אחרי תאריך ההשאלה.";
    }
    if (candidateTimeOrderError) {
      return "הבקשה שפוענחה מנוגדת לנהלי המכללה: שעת ההחזרה חייבת להיות אחרי שעת האיסוף באותו יום.";
    }
    if (candidatePastTimeError) {
      return `הבקשה שפוענחה מנוגדת לנהלי המכללה: ${candidatePastTimeError}`;
    }
    if (candidateLoanDays > candidateMaxDays) {
      return `הבקשה שפוענחה מנוגדת לנהלי המכללה: משך ההשאלה שביקשת חורג מהזמן המותר לסוג השאלה ${loanType}.`;
    }
    if (loanType === "פרטית") {
      const privateQty = getPrivateLoanLimitedQty(candidateItems, equipment);
      if (privateQty > 4) {
        return "הבקשה שפוענחה מנוגדת לנהלי המכללה: בהשאלה פרטית לא ניתן לחרוג מ-4 פריטים.";
      }
    }
    return "";
  };
  const borrowWeekend = isWeekend(form.borrow_date);
  const returnWeekend = isWeekend(form.return_date);
  const minDate = computeMinBorrowDate(form.loan_type);
  const maxDays = loanMaxDays(form.loan_type);
  const tooSoon = form.loan_type!=="סאונד" && !isCinemaLoan && !!form.borrow_date && form.borrow_date < minDate;
  const cinemaTooSoon = isCinemaLoan && !!form.borrow_date && form.borrow_date < minDate;
  const loanDays = (form.borrow_date && form.return_date)
    ? Math.ceil((parseLocalDate(form.return_date) - parseLocalDate(form.borrow_date)) / 86400000) + 1
    : 0;
  const tooLong = loanDays > maxDays;
  const isSoundLoan = form.loan_type==="סאונד";
  const CINEMA_TIME_SLOTS = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30","20:00","20:30","21:00"];
  const SOUND_DAY_TIME_SLOTS = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30","20:00","20:30","21:00","21:30"];
  const TIME_SLOTS = isSoundLoan
    ? SOUND_DAY_TIME_SLOTS
    : isCinemaLoan ? CINEMA_TIME_SLOTS
    : ["09:00","09:30","14:30","15:00","15:30","16:00","16:30","17:00","17:30"];
  const isProductionLoan = form.loan_type==="הפקה";
  const isSoundDayLoan = isSoundLoan && !!form.sound_day_loan;
  const isSoundNightLoan = isSoundLoan && !!form.sound_night_loan;

  // ── קיבוץ קביעות עוקבות לאותו אולפן לרצף אחד ──────────────────────────────
  const groupedStudentBookings = (() => {
    if (!isSoundLoan || !loggedInStudent?.name) return [];
    const NIGHT_END = "09:30";
    const getEnd = (b) => {
      if (b.isNight) {
        const d = new Date(b.date); d.setDate(d.getDate() + 1);
        while (d.getDay() === 5 || d.getDay() === 6) d.setDate(d.getDate() + 1);
        return { date: formatLocalDateInput(d), time: NIGHT_END };
      }
      return { date: b.date, time: b.endTime || "00:00" };
    };
    const relevant = studioBookings
      .filter(b => b.studentName === loggedInStudent.name)
      .filter(b => { const e = getEnd(b); return new Date(`${e.date}T${e.time}:00`).getTime() > Date.now(); })
      .sort((a, b) => (`${a.date}T${a.startTime||"00:00"}` < `${b.date}T${b.startTime||"00:00"}` ? -1 : 1));
    const groups = [];
    for (const bk of relevant) {
      let merged = false;
      for (const g of groups) {
        const last = g.bookings[g.bookings.length - 1];
        const lastEnd = getEnd(last);
        if (String(last.studioId) === String(bk.studioId)) {
          const lastEndTs = new Date(`${lastEnd.date}T${lastEnd.time}:00`).getTime();
          const bkStartTs = new Date(`${bk.date}T${bk.startTime || "00:00"}:00`).getTime();
          if (bkStartTs <= lastEndTs) {
            g.bookings.push(bk);
            const newEnd = getEnd(bk);
            // keep the later end time
            const newEndTs = new Date(`${newEnd.date}T${newEnd.time}:00`).getTime();
            if (newEndTs > lastEndTs) {
              g.endDate = newEnd.date; g.endTime = newEnd.time;
            }
            g.isMultiDay = g.startDate !== g.endDate;
            merged = true; break;
          }
        }
      }
      if (!merged) {
        const e = getEnd(bk);
        groups.push({ bookings:[bk], primaryId:String(bk.id), studioId:bk.studioId,
          startDate:bk.date, startTime:bk.startTime||"", endDate:e.date, endTime:e.time,
          isMultiDay: bk.date !== e.date });
      }
    }
    return groups;
  })();
  const soundDayLoanDate = isSoundDayLoan ? getNextSoundDayLoanDate(TIME_SLOTS) : "";
  const activeBorrowDate = isSoundDayLoan ? soundDayLoanDate : form.borrow_date;
  const activeReturnDate = isSoundDayLoan ? soundDayLoanDate : form.return_date;
  const nightLoanBorrowSlots = isSoundNightLoan ? TIME_SLOTS.filter(t => t <= "17:00") : TIME_SLOTS;
  const availableBorrowSlots = getFutureTimeSlotsForDate(activeBorrowDate, nightLoanBorrowSlots);
  const availableReturnSlotsBase = getFutureTimeSlotsForDate(activeReturnDate, TIME_SLOTS);
  // Cinema: limit return time to max 6 hours after borrow time
  const cinemaMaxReturnSlots = (() => {
    if (!isCinemaLoan || !form.borrow_time) return TIME_SLOTS;
    const [bh, bm] = form.borrow_time.split(":").map(Number);
    const maxMinutes = (bh * 60 + bm) + 360; // +6 hours
    return TIME_SLOTS.filter(t => {
      const [h, m] = t.split(":").map(Number);
      const mins = h * 60 + m;
      return mins > (bh * 60 + bm) && mins <= maxMinutes;
    });
  })();
  const availableReturnSlots = isCinemaLoan
    ? cinemaMaxReturnSlots.filter((slot) => availableReturnSlotsBase.includes(slot))
    : availableReturnSlotsBase;
  // Name requirements:
  //   Production flow → director's שם פרטי ושם משפחה שניהם חובה (single input split).
  //   Private / sound flow → same, שני השדות חובה.
  const nameOk = isProductionLoan
    ? !!(form.student_first_name && form.student_last_name)
    : !!(form.student_first_name && form.student_last_name);
  // Photographer: שם פרטי + שם משפחה חובה. טלפון רשות (לא נדרש לאימות הסמכה).
  const photographerOk = !!(form.crew_photographer_first_name && form.crew_photographer_last_name);
  // Sound tech: optional block — שם פרטי+שם משפחה כשניהם או אף אחד.
  const soundAnyFilled = !!(form.crew_sound_first_name || form.crew_sound_last_name);
  const soundOk = !soundAnyFilled || (form.crew_sound_first_name && form.crew_sound_last_name);
  // For production loans we already know the director from `production_id` and the
  // logged-in student, so phone+course are not required in step 1 (they can be
  // pulled from the student record on submit). Keep them required for all other
  // loan types so the legacy flows are unchanged.
  const ok1 = isProductionLoan
    ? (nameOk && form.email && form.loan_type && !!form.production_id)
    : (nameOk && form.email && form.phone && form.course && form.loan_type);

  // Production loan now requires picking a production the student owns (director).
  // Listed: published productions where directorEmail matches the logged-in student
  // AND the production has an approved photographer (required for any equipment loan).
  const myProductions = useMemo(() => {
    const em = String(loggedInStudent?.email || "").toLowerCase();
    if (!em) return [];
    return (productions || []).filter(p =>
      p?.status === "published"
      && String(p?.directorEmail || "").toLowerCase() === em
      && (p.crew || []).some(c => c.role === "photographer" && c.status === "approved" && c.studentId)
    );
  }, [productions, loggedInStudent]);
  const selectedProduction = useMemo(() =>
    form.production_id ? (productions || []).find(p => p.id === form.production_id) || null : null,
    [productions, form.production_id]);

  // ── Certification lookup ──
  const normalizePhone = (p) => (p||"").replace(/[^0-9]/g,"");
  const matchCertificationStudentByNamePhone = (name, phone) => {
    const normalizedName = normalizeName(name);
    if (!normalizedName) return null;
    const normalizedPhone = normalizePhone(phone);
    // Production crew matching: name is the source of truth. Phone is used only
    // as a tie-breaker when two students share the same normalized name.
    const byName = studentsFromTable.filter(s => normalizeName(s.name) === normalizedName);
    if (byName.length === 0) return null;
    if (byName.length === 1) return byName[0];
    if (normalizedPhone) {
      const exact = byName.find(s => normalizePhone(s.phone) === normalizedPhone);
      if (exact) return exact;
    }
    return byName[0];
  };
  // Cross-reference crew names against the students table (name is source of truth).
  // False only when both name fields are filled but no student record matches — catches typos.
  const photographerExistsInSystem = !photographerOk ||
    !!matchCertificationStudentByNamePhone(form.crew_photographer_name, form.crew_photographer_phone);
  const soundBothFilled = !!(form.crew_sound_first_name && form.crew_sound_last_name);
  const soundExistsInSystem = !soundBothFilled ||
    !!matchCertificationStudentByNamePhone(form.crew_sound_name, form.crew_sound_phone);
  // ok1 extended: also block "המשך" when crew name is typed but doesn't match any student.
  // For production loans: crew is sourced from the production itself (already validated at publish),
  // so we skip the typo-cross-check that the legacy free-text crew flow needed.
  const ok1WithCrew = isProductionLoan
    ? ok1
    : ok1 && (photographerExistsInSystem && soundExistsInSystem);
  const studentRecord = (() => {
    if (!loggedInStudent) return null;
    const students = studentsFromTable;
    if (loggedInStudent.id !== undefined && loggedInStudent.id !== null) {
      const byId = students.find(s => String(s.id) === String(loggedInStudent.id));
      if (byId) return byId;
    }
    const loggedEmail = String(loggedInStudent.email || "").toLowerCase().trim();
    if (loggedEmail) {
      const byEmail = students.find(s => s.email?.toLowerCase().trim() === loggedEmail);
      if (byEmail) return byEmail;
    }
    return matchCertificationStudentByNamePhone(loggedInStudent.name, loggedInStudent.phone);
  })();
  const studentCerts = studentRecord?.certs || {};
  // For production: also check photographer and sound person certs
  const crewPhotographerRecord = isProductionLoan
    ? matchCertificationStudentByNamePhone(form.crew_photographer_name, form.crew_photographer_phone)
    : null;
  const crewSoundRecord = isProductionLoan && form.crew_sound_name
    ? matchCertificationStudentByNamePhone(form.crew_sound_name, form.crew_sound_phone)
    : null;
  const crewPhotographerCerts = crewPhotographerRecord?.certs || {};
  const crewSoundCerts = crewSoundRecord?.certs || {};

  // Returns true if student/crew is allowed to borrow this equipment
  const canBorrowEq = (eq) => {
    if (!eq.certification_id) return true; // ללא הסמכה
    // "קולנוע יומית" — מבטל את מערכת ההסמכות לחלוטין: סטודנט יכול להתנסות
    // בכל הציוד שמוגדר לסוג ההשאלה הזה (לפי פאנל הסיווג), בלי שום בדיקת הסמכה.
    if (form.loan_type === "קולנוע יומית") return true;
    const certId = eq.certification_id;
    // For production: always selectable in the form (warning label shown if crew
    // not certified). Final enforcement is at staff approval time.
    if (isProductionLoan) return true;
    return studentCerts[certId] === "עבר";
  };
  // Helper for the production-loan warning label in the equipment grid.
  // Returns true if the crew (photographer OR sound) is certified for this eq.
  const crewIsCertifiedForEq = (eq) => {
    if (!eq?.certification_id) return true;
    if (!isProductionLoan) return true;
    const certId = eq.certification_id;
    return crewPhotographerCerts[certId] === "עבר" ||
           crewSoundCerts[certId] === "עבר";
  };
  const canBorrowEqForForm = (candidateForm, eq) => {
    if (!eq?.certification_id) return true;
    const candidateLoanType = normalizeSmartLoanType(candidateForm?.loan_type);
    // Cinema-daily bypasses certification entirely.
    if (candidateLoanType === "קולנוע יומית") return true;
    // Production: form-level check is informational only — the real gate is at
    // staff approval. Always allow at form level.
    if (candidateLoanType === "הפקה") return true;
    const certId = eq.certification_id;
    return studentCerts[certId] === "עבר";
  };
  const privateLoanLimitedQty = form.loan_type==="פרטית" ? getPrivateLoanLimitedQty(items, equipment) : 0;
  const privateLoanLimitExceeded = form.loan_type==="פרטית" && privateLoanLimitedQty > 4;
  const sameDay = form.borrow_date && form.return_date && form.borrow_date === form.return_date;
  const timeOrderError = !isSoundNightLoan && sameDay && form.borrow_time && form.return_time && toDateTime(form.return_date, form.return_time) <= toDateTime(form.borrow_date, form.borrow_time);
  const returnBeforeBorrow = form.borrow_date && form.return_date && parseLocalDate(form.return_date) < parseLocalDate(form.borrow_date);
  const hasTimes = !!form.borrow_time && !!form.return_time;
  const pastLoanTimeError = getPastLoanTimeError(form);
  // Sound loan: equipment must be requested at least 3 hours before the
  // start of the studio session it's tied to. (Only relevant for sound —
  // private/production/cinema loans use their own lead-time rules above.)
  // SOUND_MIN_LEAD_TIME_MS is imported from loanPolicy.js — single source.
  const soundLeadMs = (isSoundLoan && form.studio_booking_id && form.borrow_date && form.borrow_time)
    ? (toDateTime(form.borrow_date, form.borrow_time) - Date.now())
    : null;
  const soundLeadTooShort = soundLeadMs !== null && soundLeadMs < SOUND_MIN_LEAD_TIME_MS;
  // For production loans, dates must come from a production_date chip (not free-typed).
  // Without production_date_id we can't tie a reservation to a specific shoot range.
  const ok2 = !!form.borrow_date && !!form.return_date && hasTimes && !returnBeforeBorrow && !tooSoon && !cinemaTooSoon && !tooLong && !borrowWeekend && !returnWeekend && !timeOrderError && !pastLoanTimeError && !soundLeadTooShort && (!isSoundLoan || !!form.studio_booking_id) && (!isProductionLoan || !!form.production_date_id);
  const ok3 = items.some(item => Number(item.quantity) > 0);
  const canSubmit = !!ok1WithCrew && !!ok2 && !!ok3 && !privateLoanLimitExceeded && !!agreed;

  const availEq = useMemo(()=>{
    if(!form.borrow_date||!form.return_date) return [];
    const isExternalLoan = EXTERNAL_LOAN_TYPES.includes(form.loan_type);
    return equipment.map(eq=>{
      let avail = getAvailable(eq.id,form.borrow_date,form.return_date,reservations,equipment,null,form.borrow_time,form.return_time);
      // External loans (private / production) physically remove gear from campus.
      // A fully-restricted item is unavailable; a hold-count keeps N units back.
      if (isExternalLoan) {
        if (eq.externalLoanRestricted) avail = 0;
        else avail = Math.max(0, avail - (Number(eq.externalLoanHoldCount) || 0));
      }
      // Check if the 0-availability is caused by an overdue reservation holding this item
      const overdueBlocked = avail === 0 && reservations.some(r =>
        r.status === "באיחור" && (r.items||[]).some(i => i.equipment_id == eq.id && Number(i.quantity) > 0)
      );
      return {...eq, avail, overdueBlocked};
    });
  },[form.borrow_date,form.return_date,form.borrow_time,form.return_time,equipment,reservations,form.loan_type]);

  useEffect(() => {
    setItems((currentItems) => {
      const hasActiveAvailabilityWindow = !!form.borrow_date && !!form.return_date;
      const nextItems = currentItems
        .map((item) => {
          const equipmentItem = equipment.find((entry) => entry.id == item.equipment_id);
          if (!equipmentItem) return null;
          const maxQuantity = hasActiveAvailabilityWindow
            ? (availEq.find((entry) => entry.id == item.equipment_id)?.avail || 0)
            : Number(item.quantity) || 0;
          const nextQuantity = Math.max(0, Math.min(Number(item.quantity) || 0, maxQuantity));
          if (!nextQuantity) return null;
          return {
            ...item,
            name: equipmentItem.name || item.name,
            quantity: nextQuantity,
          };
        })
        .filter(Boolean);

      return JSON.stringify(currentItems) === JSON.stringify(nextItems) ? currentItems : nextItems;
    });
  }, [availEq, equipment, form.borrow_date, form.return_date]);

  const getItem = id => items.find(i=>i.equipment_id==id)||{quantity:0};
  const setQty  = (id,qty) => {
    const avail = availEq.find(e=>e.id==id)?.avail||0;
    const q = Math.max(0,Math.min(qty,avail));
    const name = equipment.find(e=>e.id==id)?.name||"";
    setItems(prev => q===0 ? prev.filter(i=>i.equipment_id!=id) : prev.find(i=>i.equipment_id==id) ? prev.map(i=>i.equipment_id==id?{...i,quantity:q}:i) : [...prev,{equipment_id:id,quantity:q,name}]);
  };

  const canAccessStep = (targetStep) => {
    if (targetStep === 1) return true;
    // Production loans: stricter gating — every step after 1 needs a production picked,
    // and each step also requires the previous one's ok. No free navigation, the rule
    // is "complete in order" because production-loan fields are tied together (date
    // ranges are bound to the picked production, crew certs gate equipment, etc.).
    if (isProductionLoan) {
      if (!form.production_id) return false;
      if (targetStep === 2) return !!ok1WithCrew;
      if (targetStep === 3) return !!ok1WithCrew && !!ok2;
      if (targetStep === 4) return !!ok1WithCrew && !!ok2 && !!ok3 && !privateLoanLimitExceeded;
      return false;
    }
    // Other loan types: loose flow — steps 1-3 freely navigable, only step 4 gated.
    if (targetStep <= 3) return true;
    if (targetStep === 4) return !!ok1WithCrew && !!ok2 && !!ok3 && !privateLoanLimitExceeded;
    return false;
  };

  const goToStep = (targetStep) => {
    if (targetStep === step) return;
    // Production loans: hard-block navigation past step 1 without a production picked.
    if (isProductionLoan && !form.production_id && targetStep > 1) {
      showToast("error", "יש לבחור הפקה לפני המעבר לשלב הבא");
      return;
    }
    if (canAccessStep(targetStep)) {
      setStep(targetStep);
      return;
    }
    if (privateLoanLimitExceeded) {
      showToast("error", "שים לב אין לחרוג מ-4 פריטים בהשאלה פרטית");
      return;
    }
    if (pastLoanTimeError) {
      showToast("error", pastLoanTimeError);
      return;
    }
    showToast("error", "יש להשלים את שלבי פרטים, תאריכים וציוד לפני המעבר לשלב האישור.");
  };

  const closeEquipmentAiModal = () => {
    setShowEquipmentAiModal(false);
    setEquipmentAiPrompt("");
    setEquipmentAiLoading(false);
    setShowEquipmentAiLoanTypePrompt(false);
    setEquipmentAiForcedLoanType("");
  };

  const handleSmartEquipmentBooking = async (promptText, equipmentList) => {
    if (!promptText) return;
    const refreshedInventory = await syncInventory();
    const liveEquipmentList = Array.isArray(refreshedInventory?.equipment) ? refreshedInventory.equipment : equipmentList;
    const preselectedLoanType = normalizeSmartLoanType(form.loan_type);
    const promptLoanType = normalizeSmartLoanType(promptText);
    const forcedLoanType = normalizeSmartLoanType(equipmentAiForcedLoanType);
    const requestedLoanType = preselectedLoanType || forcedLoanType || promptLoanType;
    let shouldCloseEquipmentAiModal = false;

    if (!allowedLoanTypes.length) {
      showToast("error", "לא הוגדרו סוגי השאלה זמינים למסלול הלימודים שלך.");
      return;
    }

    if (!requestedLoanType) {
      setShowEquipmentAiLoanTypePrompt(true);
      showToast("error", "יש לבחור סוג השאלה או לציין אותו בתיאור.");
      return;
    }

    if (!allowedLoanTypes.includes(requestedLoanType)) {
      setShowEquipmentAiLoanTypePrompt(true);
      showToast("error", "סוג ההשאלה שביקשת אינו זמין למסלול הלימודים שלך.");
      return;
    }

    setShowEquipmentAiLoanTypePrompt(false);
    setEquipmentAiLoading(true);

    try {
      const todayStr = today();
      const liveCategoryLoanTypes = refreshedInventory?.categoryLoanTypes || categoryLoanTypes;
      const allowedEquipmentList = (liveEquipmentList || []).filter((item) => matchesEquipmentLoanType(item, requestedLoanType, liveCategoryLoanTypes));
      if (!allowedEquipmentList.length) {
        throw new Error("לא נמצאו פריטי ציוד שמותרים לסוג ההשאלה הזה.");
      }
      const inventory = allowedEquipmentList
        .map((item) => `ID: ${item.id}, Name: ${item.name}, Category: ${item.category || ""}`)
        .join("\n");

      const systemInstruction = `
אתה עוזר חכם למחסן ציוד במכללה. התאריך היום הוא ${todayStr}.
עליך לחלץ מהטקסט של הסטודנט את סוג ההשאלה, תאריכי ההשאלה, שעות, ורשימת ציוד עם כמויות.
התאם את הציוד המבוקש למזהים (IDs) מרשימת המלאי הבאה בלבד:
${inventory}

החזר אך ורק JSON תקני.
סוג ההשאלה שנבחר או זוהה מראש הוא: ${requestedLoanType}.
אם הטקסט לא סותר זאת במפורש, השתמש בדיוק בסוג ההשאלה הזה.
      `.trim();

      const requestBody = {
        contents: [{ parts: [{ text: promptText }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              loanType: { type: "STRING" },
              startDate: { type: "STRING" },
              startTime: { type: "STRING" },
              endDate: { type: "STRING" },
              endTime: { type: "STRING" },
              items: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    equipmentId: { type: "STRING" },
                    quantity: { type: "NUMBER" },
                  },
                  required: ["equipmentId", "quantity"],
                },
              },
            },
            required: ["loanType", "startDate", "startTime", "endDate", "endTime", "items"],
          },
        },
      };

      const token = await getAuthToken();
      const response = await fetchWithRetry('/api/gemini', {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
      }

      const jsonResponse = await response.json();
      if (!jsonResponse?.candidates?.length) {
        throw new Error("לא התקבלה תשובה תקינה מ-Gemini.");
      }

      const generatedText = jsonResponse.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const result = parseSmartBookingJson(generatedText);
      const nextLoanType = preselectedLoanType || forcedLoanType || promptLoanType || normalizeSmartLoanType(result?.loanType);
      const startDate = normalizeSmartDate(result?.startDate);
      const endDate = normalizeSmartDate(result?.endDate) || startDate;
      const startTime = normalizeSmartTime(result?.startTime);
      const endTime = normalizeSmartTime(result?.endTime);

      if (!nextLoanType) {
        throw new Error("יש לבחור סוג השאלה לפני המשך.");
      }

      const visibleEquipmentIds = new Set(
        allowedEquipmentList
          .filter((equipmentItem) => matchesEquipmentLoanType(equipmentItem, nextLoanType, liveCategoryLoanTypes))
          .map((equipmentItem) => String(equipmentItem.id))
      );
      const resolvedItems = (result?.items || [])
        .map((item) => {
          const match = allowedEquipmentList.find((equipmentItem) => String(equipmentItem.id) === String(item?.equipmentId));
          if (!match || !visibleEquipmentIds.has(String(match.id))) return null;
          return {
            equipment_id: match.id,
            quantity: Math.max(1, Number(item?.quantity) || 1),
            name: match.name,
          };
        })
        .filter(Boolean);

      if (!resolvedItems.length) {
        throw new Error("לא הצלחנו להתאים פריטי ציוד שמותרים לסוג ההשאלה הזה.");
      }

      if (!startDate || !endDate || !startTime || !endTime) {
        throw new Error("לא הצלחנו לפענח תאריכים ושעות תקינים מהבקשה.");
      }

      const nextForm = {
        ...form,
        student_name: form.student_name || loggedInStudent?.name || "",
        email: form.email || loggedInStudent?.email || "",
        phone: form.phone || loggedInStudent?.phone || "",
        course: form.course || loggedInStudent?.track || "",
        loan_type: nextLoanType,
        borrow_date: startDate,
        borrow_time: startTime,
        return_date: endDate,
        return_time: endTime,
        sound_day_loan: false,
        sound_night_loan: false,
        studio_booking_id: "",
      };

      if (nextLoanType === "הפקה" && !nextForm.crew_photographer_name) {
        const fallbackFn = form.student_first_name || String(loggedInStudent?.firstName||"").trim() || "";
        const fallbackLn = form.student_last_name  || String(loggedInStudent?.lastName ||"").trim() || "";
        const fallbackFull = [fallbackFn, fallbackLn].filter(Boolean).join(" ")
          || form.student_name || loggedInStudent?.name || "";
        // If we only have a combined name, split on first space.
        let fn = fallbackFn;
        let ln = fallbackLn;
        if (!fn && !ln && fallbackFull) {
          const parts = fallbackFull.trim().split(/\s+/).filter(Boolean);
          fn = parts[0] || ""; ln = parts.slice(1).join(" ");
        }
        nextForm.crew_photographer_first_name = fn;
        nextForm.crew_photographer_last_name  = ln;
        nextForm.crew_photographer_name = [fn, ln].filter(Boolean).join(" ") || fallbackFull;
      }

      const policyError = getSmartEquipmentPolicyError(nextForm, resolvedItems);
      if (policyError) {
        showToast("error", policyError);
        return;
      }

      let liveReservations = reservations;
      try {
        const freshReservations = await (supabase.from("reservations_new").select("*, reservation_items(*)").then(res => (res.data || []).map(r => ({ ...r, items: r.reservation_items || [] }))));
        if (Array.isArray(freshReservations)) liveReservations = freshReservations;
      } catch (error) {
        console.warn("Could not refresh reservations before AI equipment validation", error);
      }

      const certificationIssues = resolvedItems
        .map((item) => {
          const equipmentItem = equipment.find((eq) => String(eq.id) === String(item.equipment_id));
          if (!equipmentItem || canBorrowEqForForm(nextForm, equipmentItem)) return null;
          return equipmentItem.name;
        })
        .filter(Boolean);
      if (certificationIssues.length) {
        showToast("error", `הבקשה שפוענחה לא תואמת להסמכות הפעילות במערכת: ${certificationIssues.join(", ")}.`);
        return;
      }

      const availabilityIssues = resolvedItems
        .map((item) => {
          const availableQty = getAvailable(
            item.equipment_id,
            nextForm.borrow_date,
            nextForm.return_date,
            liveReservations,
            equipment,
            null,
            nextForm.borrow_time,
            nextForm.return_time
          );
          if (Number(item.quantity) <= availableQty) return null;
          return `${item.name} — ביקשת ${item.quantity}, זמינים כרגע ${availableQty}`;
        })
        .filter(Boolean);
      if (availabilityIssues.length) {
        showToast("error", `הבקשה שפוענחה לא תואמת למלאי המחסן בזמן אמת: ${availabilityIssues.join(" ; ")}.`);
        return;
      }

      setForm(nextForm);
      setItems(resolvedItems);
      setAgreed(false);
      setStep(4);
      setEquipmentAiForcedLoanType("");
      shouldCloseEquipmentAiModal = true;
      showToast("success", "ה-AI מילא את הטופס עבורך. עברו לשלב האישור וקראו את הנהלים.");
    } catch (error) {
      console.error("AI Equipment Booking Error:", error);
      showToast("error", error?.message || "לא הצלחנו להבין את הבקשה. נסה לפרט יותר או למלא ידנית.");
    } finally {
      setEquipmentAiLoading(false);
      if (shouldCloseEquipmentAiModal) {
        setShowEquipmentAiModal(false);
        setShowEquipmentAiLoanTypePrompt(false);
        setEquipmentAiPrompt("");
      }
    }
  };

  const waText = encodeURIComponent("שלום נמרוד הגשתי בקשה להשאלה ממתין לאישורך תודה");
  const waLink = `https://wa.me/${NIMROD_PHONE}?text=${waText}`;

  const sendEmail = async (res) => {
    try {
      const waText = encodeURIComponent("שלום נמרוד הגשתי בקשה להשאלה ממתין לאישורך תודה");
      const waLink = `https://wa.me/${NIMROD_PHONE}?text=${waText}`;
      const itemsList = res.items.map(i => `<tr><td style="padding:7px 12px;color:#e8eaf0;border-bottom:1px solid #1e2130">${i.name}</td><td style="padding:7px 12px;text-align:center;color:#f5a623;font-weight:700;border-bottom:1px solid #1e2130">${i.quantity}</td></tr>`).join("");
      // Send to student
      await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to:           res.email,
          type:         "new",
          student_name: res.student_name,
          items_list:   itemsList,
          borrow_date:  formatDate(res.borrow_date),
          return_date:  formatDate(res.return_date),
          wa_link:      waLink,
          logo_url:     siteSettings.logo || "",
          sound_logo_url: siteSettings.soundLogo || "",
        }),
      });
      // Notify team members who handle this loan type
      const relevantTeam = (teamMembers || []).filter((member) => {
        if (!member?.email) return false;
        if (!Array.isArray(member.loanTypes)) return true;
        return member.loanTypes.includes(res.loan_type);
      });
      await Promise.allSettled(relevantTeam.map((member) => {
        const memberEmail = String(member.email || "").trim().toLowerCase();
        if (!isValidEmailAddress(memberEmail)) return Promise.resolve();
        return fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to:           memberEmail,
            type:         "team_notify",
            student_name: res.student_name,
            items_list:   itemsList,
            borrow_date:  formatDate(res.borrow_date),
            return_date:  formatDate(res.return_date),
            loan_type:    res.loan_type,
            logo_url:     siteSettings.logo || "",
            sound_logo_url: siteSettings.soundLogo || "",
          }),
        });
      }));
      // Notify staff/admin users with matching notifyLoanTypes
      fetch("/api/notify-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loan_type:      res.loan_type,
          student_name:   res.student_name,
          items_list:     itemsList,
          borrow_date:    formatDate(res.borrow_date),
          return_date:    formatDate(res.return_date),
          logo_url:       siteSettings.logo || "",
          sound_logo_url: siteSettings.soundLogo || "",
        }),
      }).catch(() => {});
      // Notify dept heads for this loan type
      const relevantDeptHeads = (deptHeads||[]).filter(dh =>
        dh?.email && isValidEmailAddress(dh.email) &&
        Array.isArray(dh.loanTypes) && dh.loanTypes.includes(res.loan_type)
      );
      if (relevantDeptHeads.length > 0) {
        // approve_url is built server-side in /api/send-email — the client
        // must not construct it, because the signing secret lives only on
        // the server (see api/_approve-token.js).
        const portalUrl = `${window.location.origin}/`;
        for (let i = 0; i < relevantDeptHeads.length; i++) {
          const dh = relevantDeptHeads[i];
          // delay between emails to avoid Gmail rate limiting
          if (i > 0) await new Promise(r => setTimeout(r, 1500));
          try {
            const response = await fetch("/api/send-email", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                to:             dh.email,
                type:           "dept_head_notify",
                recipient_name: dh.name||"",
                student_name:   res.student_name,
                items_list:     itemsList,
                borrow_date:    formatDate(res.borrow_date),
                borrow_time:    res.borrow_time||"",
                return_date:    formatDate(res.return_date),
                return_time:    res.return_time||"",
                loan_type:      res.loan_type,
                project_name:      res.project_name||"",
                production_reason: res.production_reason||"",
                crew_photographer: res.crew_photographer_name||"",
                crew_sound:        res.crew_sound_name||"",
                portal_url:     portalUrl,
                reservation_id: String(res.id),
                logo_url:       siteSettings.logo || "",
                sound_logo_url: siteSettings.soundLogo || "",
              }),
            });
            if (!response.ok) {
              const errorText = await response.text();
              console.error("dept head notify failed", dh.email, errorText);
            }
          } catch(dhErr) {
            console.error("dept head email error", dh.email, dhErr);
          }
        }
      }
    } catch(e) {
      console.error("send email error:", e);
    }
  };

  const submit = async () => {
    if (pastLoanTimeError) {
      showToast("error", pastLoanTimeError);
      setStep(2);
      return;
    }
    if (!ok1WithCrew || !ok2 || !ok3 || privateLoanLimitExceeded) {
      if (privateLoanLimitExceeded) {
        showToast("error", "שים לב אין לחרוג מ-4 פריטים בהשאלה פרטית");
        setStep(3);
        return;
      }
      if (ok1 && !ok1WithCrew) {
        showToast("error", "לא ניתן לשלוח בקשה — הצלם/איש הסאונד אינם רשומים במערכת. בדוק/י את האיות.");
        setStep(1);
        return;
      }
      showToast("error", "לא ניתן לשלוח בקשה לפני השלמת כל שלבי הטופס, כולל תאריכים, שעות ובחירת ציוד.");
      if (!ok1WithCrew) setStep(1);
      else if (!ok2) setStep(2);
      else setStep(3);
      return;
    }
    // Validate email format before doing anything
    if(!isValidEmailAddress(form.email)) {
      setEmailError(true);
      return;
    }
    setSub(true);

    // ── Fetch the freshest reservations from the server right before saving ──
    // Used for a quick client-side availability pre-check. NOT the authoritative
    // guard — that's /api/create-reservation → create_reservation_v2 RPC below,
    // which takes a row-level lock on the equipment it touches.
    let freshReservations = reservations;
    try {
      const fresh = await (supabase.from("reservations_new").select("*, reservation_items(*)").then(res => (res.data || []).map(r => ({ ...r, items: r.reservation_items || [] }))));
      if (Array.isArray(fresh)) {
        freshReservations = fresh;
        setReservations(fresh); // update local state too
      }
    } catch(e) {
      console.warn("Could not refresh reservations before submit:", e);
    }

    // ── Per-student overlap block (approval step) ─────────────────────────
    // A student may hold only ONE loan request per time window. If they already
    // have a non-cancelled request overlapping these dates/times, block here
    // with a clear message. The server's create_reservation_v2 guard is the
    // authoritative backstop; this gives instant feedback at the approval step.
    {
      const myEmail  = String(form.email || "").trim().toLowerCase();
      const newStart = toDateTime(form.borrow_date, form.borrow_time || "00:00");
      const newEnd   = toDateTime(form.return_date, form.return_time || "23:59");
      const conflict = (myEmail && newStart && newEnd) ? freshReservations.find(r => {
        if (String(r.email || "").trim().toLowerCase() !== myEmail) return false;
        if (["בוטל", "הוחזר", "נדחה"].includes(r.status)) return false;
        if (r.lesson_auto || r.loan_type === "שיעור") return false; // lessons don't count
        if (!r.borrow_date || !r.return_date) return false;
        const rStart = toDateTime(r.borrow_date, r.borrow_time || "00:00");
        const rEnd   = toDateTime(r.return_date, r.return_time || "23:59");
        return newStart < rEnd && rStart < newEnd; // half-open overlap
      }) : null;
      if (conflict) {
        setSub(false);
        setOverlapBlock(conflict);
        return;
      }
    }

    // ── Client-side pre-check (fast UX feedback). Server re-checks atomically. ──
    const overLimit = items.filter(item => {
      const avail = getAvailable(item.equipment_id, form.borrow_date, form.return_date, freshReservations, equipment, null, form.borrow_time, form.return_time);
      return item.quantity > avail;
    });

    if (overLimit.length > 0) {
      setSub(false);
      showToast("error", `חלק מהציוד כבר לא זמין: ${overLimit.map(i=>i.name).join(", ")} — נא לעדכן את הבחירה`);
      return;
    }

    const relevantDH = (deptHeads||[]).find(dh =>
      dh?.email && isValidEmailAddress(dh.email) &&
      Array.isArray(dh.loanTypes) && dh.loanTypes.includes(form.loan_type)
    );
    const initStatus = relevantDH ? "אישור ראש מחלקה" : "ממתין";

    // One moment captured two ways: Hebrew for the blob (legacy UI format),
    // ISO for the RPC (it casts to TIMESTAMPTZ and would reject Hebrew format).
    const submittedAtDate   = new Date();
    const submittedAtHebrew = submittedAtDate.toLocaleString("he-IL",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Jerusalem"});
    const submittedAtIso    = submittedAtDate.toISOString();

    const reservationId = String(Date.now());

    // Production loans: ALWAYS re-derive the crew snapshot from the selected
    // production's approved crew at submit time, using the reliable students
    // source. This makes the snapshot independent of when the form was opened
    // or whether certifications.students had loaded back then — the bug that
    // saved empty crew on a second date-range. Override whatever's in `form`.
    const crewSnapshot = (isProductionLoan && selectedProduction)
      ? deriveProductionCrewSnapshot(selectedProduction, studentsFromTable)
      : {};
    if (isProductionLoan && !crewSnapshot.crew_photographer_name) {
      setSub(false);
      showToast("error", "לא נמצא צלם ראשי מאושר להפקה — יש לאשר צלם ראשי בלוח ההפקות לפני הגשת רשימת ציוד.");
      return;
    }
    const newRes = { ...form, ...crewSnapshot, id: reservationId, status: initStatus, created_at: today(), submitted_at: submittedAtHebrew, items };

    // ── ATOMIC SERVER-SIDE CREATE ─────────────────────────────────────────
    // create_reservation_v2 (migration 008) takes FOR UPDATE locks on each
    // equipment row, runs a date-range overlap availability check, inserts
    // into reservations_new + reservation_items, and recomputes
    // available_units — all in one transaction. Fixes the concurrent-submit
    // race that the old "fetch → modify → write" pattern had (documented
    // 2026-03-20 data loss). Routed via the shared createReservation()
    // helper (utils.js) so the public form and the admin manual form share
    // error handling.
    const rpcResult = await createReservation(
      {
        ...newRes,
        // created_at from today() is ISO "YYYY-MM-DD" — castable as-is.
        // submitted_at needs to be ISO for the RPC's TIMESTAMPTZ cast.
        submitted_at: submittedAtIso,
      },
      items.map(it => ({
        equipment_id: it.equipment_id,
        name:         it.name,
        quantity:     Number(it.quantity) || 1,
        unit_id:      it.unit_id || null,
      }))
    );
    if (!rpcResult.ok) {
      setSub(false);
      if (rpcResult.error === "student_overlap") {
        // Server guard caught it (rare race past the client pre-check) — show
        // the same floating panel.
        setOverlapBlock(true);
      } else if (rpcResult.error === "not_enough_stock") {
        // Stock became unavailable between pre-check and atomic insert.
        showToast("error", "חלק מהציוד כבר לא זמין — נא לעדכן את הבחירה ולנסות שוב");
      } else if (rpcResult.error === "external_restricted") {
        // Server guard caught a restricted item (rare — it's normally hidden).
        showToast("error", "פריט שנבחר מוגבל להשאלת חוץ ולא ניתן להשאילו בהשאלה פרטית/הפקה — נא להסירו ולנסות שוב");
      } else if (rpcResult.error === "network_error") {
        showToast("error", "תקלת רשת. בדוק חיבור ונסה שוב.");
      } else {
        console.error("create-reservation failed", rpcResult);
        showToast("error", "שגיאה בשליחת הבקשה. נסה שוב בעוד רגע.");
      }
      return;
    }
    // The RPC may have generated its own id if ours was blank; sync up.
    if (rpcResult.id && String(rpcResult.id) !== reservationId) {
      newRes.id = rpcResult.id;
    }

    // The store.reservations JSON blob is now kept in sync server-side by
    // /api/create-reservation (via append_to_store_reservations, migration
    // 021) — no client-side full-list write is needed. This avoids the
    // shrink_guard false-positive when the client's cache is stale.
    const updated = [...freshReservations, newRes];
    setReservations(updated);
    // Fire-and-forget emails in background — don't block the user on Gmail rate-limit delays
    sendEmail(newRes).catch(err => console.error("sendEmail background error:", err));
    setSub(false);
    setDone(true);
    clearFormDraft();
    showToast("success","הבקשה נשלחה בהצלחה!");
  };

  const reset = () => {
    clearFormDraft(); setDone(false); setEmailError(false); setStep(1);
    const blank = {student_name:"",student_first_name:"",student_last_name:"",email:"",phone:"",course:"",project_name:"",borrow_date:"",borrow_time:"",return_date:"",return_time:"",loan_type:"",sound_day_loan:false,sound_night_loan:false,studio_booking_id:"",crew_photographer_name:"",crew_photographer_first_name:"",crew_photographer_last_name:"",crew_photographer_phone:"",crew_sound_name:"",crew_sound_first_name:"",crew_sound_last_name:"",crew_sound_phone:"",production_reason:""};
    // Re-seed the logged-in student's identity (name/email/phone/course) — the
    // same person is still logged in, so a fresh "שלח בקשה נוספת" should keep
    // these prefilled exactly like the initial-load effect does. Without this,
    // a second production loan is blocked at פרטים→תאריכים because step 1→2 is
    // gated on ok1 (name+email+production_id) and the blanked fields fail it.
    if (loggedInStudent) {
      const explicitFn = String(loggedInStudent.firstName||"").trim();
      const explicitLn = String(loggedInStudent.lastName ||"").trim();
      let fn = explicitFn, ln = explicitLn;
      if (!fn && !ln) {
        const parts = String(loggedInStudent.name||"").trim().split(/\s+/).filter(Boolean);
        fn = parts[0] || ""; ln = parts.slice(1).join(" ");
      }
      blank.student_first_name = fn;
      blank.student_last_name  = ln;
      blank.student_name = [fn, ln].filter(Boolean).join(" ");
      blank.email = loggedInStudent.email || "";
      if (loggedInStudent.phone) blank.phone = loggedInStudent.phone;
      if (loggedInStudent.track) blank.course = loggedInStudent.track;
    }
    setForm(blank); setItems([]); setAgreed(false);
  };

  const VIEWS = ["equipment", "studios", "daily", "my-bookings"];
  const handleFormSwipeStart = (e) => {
    const touch = e.touches[0];
    const blocked = !!e.target.closest('[data-no-swipe]');
    swipeTouchRef.current = { startX: touch.clientX, startY: touch.clientY, blocked };
  };
  const handleFormSwipeEnd = (e) => {
    if (!swipeTouchRef.current) return;
    const { startX, startY, blocked } = swipeTouchRef.current;
    swipeTouchRef.current = null;
    if (blocked) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const idx = VIEWS.indexOf(publicView);
    if (dx < 0 && idx < VIEWS.length - 1) {
      const next = VIEWS[idx + 1];
      setPublicView(next);
      sessionStorage.setItem("public_view", next);
      if (next === "studios") loadStudiosData();
      if (next === "daily") { setDailyDayOffset(0); loadDailySchedule(); }
      if (next === "my-bookings") { loadStudiosData(); loadReservationsData(); }
    } else if (dx > 0 && idx > 0) {
      const prev = VIEWS[idx - 1];
      setPublicView(prev);
      sessionStorage.setItem("public_view", prev);
    }
  };

  if(emailError) return (
    <div className="form-page">
      <div style={{width:"100%",maxWidth:500,background:"var(--surface)",border:"1px solid rgba(231,76,60,0.4)",borderRadius:16,padding:40,textAlign:"center",direction:"rtl"}}>
        <div style={{fontSize:64,marginBottom:16}}><XCircle size={64} strokeWidth={1.75} color="#e74c3c" /></div>
        <h2 style={{fontSize:22,fontWeight:900,color:"#e74c3c",marginBottom:12}}>כתובת המייל שגויה</h2>
        <p style={{fontSize:14,color:"var(--text2)",marginBottom:28,lineHeight:1.7}}>
          הכתובת <strong style={{color:"var(--text)"}}>{form.email}</strong> אינה תקינה.<br/>
          ייתכן שמדובר בשגיאת הקלדה (למשל: <em>gmai.com</em> במקום <em>gmail.com</em>).<br/>
          נא לנסות להגיש את הבקשה מחדש עם כתובת מייל תקינה.
        </p>
        <button className="btn btn-primary" onClick={reset}>🔄 חזור לטופס</button>
      </div>
    </div>
  );

  // ── PASSWORD_RECOVERY modal (priority — overrides login gate) ──
  if (recoveryMode) return (
    <div className="form-page" style={{"--accent": siteSettings.accentColor||"#f5a623"}}>
      <div style={{width:"100%",maxWidth:420,background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,padding:"40px 32px",textAlign:"center",direction:"rtl"}}>
        {siteSettings.logo
          ? <img src={siteSettings.logo} alt="לוגו" style={{width:82,height:82,objectFit:"contain",borderRadius:12,marginBottom:16,display:"block",marginInline:"auto"}}/>
          : <div style={{fontSize:48,marginBottom:16}}>🔑</div>}
        <h2 style={{fontSize:"clamp(14px,4vw,20px)",fontWeight:900,color:"var(--accent)",marginBottom:4}}>הגדרת סיסמה חדשה</h2>
        <div style={{fontSize:13,color:"var(--text3)",marginBottom:24}}>בחר/י סיסמה חדשה לחשבון שלך</div>

        <div style={{textAlign:"right",marginBottom:12}}>
          <label style={{fontSize:13,fontWeight:700,color:"var(--text2)",display:"block",marginBottom:4}}>סיסמה חדשה</label>
          <input className="form-input" type="password" placeholder="לפחות 6 תווים" value={recoveryPassword}
            onChange={e=>{setRecoveryPassword(e.target.value);setRecoveryError("");}}
            disabled={recoveryBusy} autoFocus/>
        </div>
        <div style={{textAlign:"right",marginBottom:16}}>
          <label style={{fontSize:13,fontWeight:700,color:"var(--text2)",display:"block",marginBottom:4}}>אימות סיסמה</label>
          <input className="form-input" type="password" placeholder="הזן/י את הסיסמה שוב" value={recoveryConfirm}
            onChange={e=>{setRecoveryConfirm(e.target.value);setRecoveryError("");}}
            onKeyDown={e=>e.key==="Enter"&&handleUpdatePassword()}
            disabled={recoveryBusy}/>
        </div>
        {!recoverySessionReady && <div style={{fontSize:12,color:"var(--text3)",marginBottom:8}}>מאמת קישור...</div>}
        {recoveryError && <div style={{color:"var(--red)",fontSize:13,fontWeight:700,marginBottom:12}}>{recoveryError}</div>}
        <button className="btn btn-primary" style={{width:"100%",padding:"12px",fontSize:15}} onClick={handleUpdatePassword}
          disabled={!recoveryPassword||!recoveryConfirm||recoveryBusy||!recoverySessionReady}>
          {recoveryBusy ? "מעדכן..." : "עדכן סיסמה"}
        </button>
      </div>
    </div>
  );

  // ── Role-switch transition screen ──
  // Shown instead of the login form while a role switch re-dispatches, so the
  // user never sees the login screen flash mid-transition.
  if (!loggedInStudent && switching) return (
    <div className="form-page" style={{"--accent": siteSettings.accentColor||"#f5a623"}}>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:16,direction:"rtl"}}>
        {siteSettings.logo
          ? <img src={siteSettings.logo} alt="לוגו" style={{height:72,maxWidth:180,objectFit:"contain"}}/>
          : <Film size={48} strokeWidth={1.75} color="var(--accent)" />}
        <div style={{
          width:34,height:34,borderRadius:"50%",
          border:"3px solid var(--border)",borderTopColor:"var(--accent)",
          animation:"spin 0.8s linear infinite",
        }}/>
        <div style={{fontSize:15,fontWeight:700,color:"var(--text2)"}}>מעביר…</div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  // ── Password login gate ──
  if (!loggedInStudent) return (
    <div className="form-page" style={{"--accent": siteSettings.accentColor||"#f5a623"}}>
      <div style={{width:"100%",maxWidth:420,background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,padding:"40px 32px",textAlign:"center",direction:"rtl"}}>
        {siteSettings.logo
          ? <img src={siteSettings.logo} alt="לוגו" style={{width:82,height:82,objectFit:"contain",borderRadius:12,marginBottom:16,display:"block",marginInline:"auto"}}/>
          : <div style={{fontSize:48,marginBottom:16}}><Film size={48} strokeWidth={1.75} color="var(--accent)" /></div>}
        <h2 style={{fontSize:"clamp(14px,4vw,20px)",fontWeight:900,color:"var(--accent)",marginBottom:4}}>מערכת הפניות</h2>
        <div style={{fontSize:14,color:"var(--text2)",marginBottom:24,fontWeight:500}}>מכללת קמרה אובסקורה וסאונד</div>

        {authView === "login" && (
          <>
            <div style={{textAlign:"right",marginBottom:12}}>
              <label style={{fontSize:13,fontWeight:700,color:"var(--text2)",display:"block",marginBottom:4}}>אימייל</label>
              <input className="form-input" type="email" placeholder="email@example.com" value={loginEmail}
                onChange={e=>{setLoginEmail(e.target.value);setLoginError("");}}
                onKeyDown={e=>e.key==="Enter"&&handleLogin()}
                disabled={loginBusy} autoComplete="username"/>
            </div>
            <div style={{textAlign:"right",marginBottom:16}}>
              <label style={{fontSize:13,fontWeight:700,color:"var(--text2)",display:"block",marginBottom:4}}>סיסמה</label>
              <div style={{position:"relative"}}>
                <input className="form-input" type={showLoginPassword?"text":"password"} placeholder="הקלד/י סיסמה" value={loginPassword}
                  onChange={e=>{setLoginPassword(e.target.value);setLoginError("");}}
                  onKeyDown={e=>e.key==="Enter"&&handleLogin()}
                  disabled={loginBusy} autoComplete="current-password"
                  style={{paddingLeft:40}}/>
                <button type="button" onClick={()=>setShowLoginPassword(v=>!v)}
                  title={showLoginPassword?"הסתר סיסמה":"הצג סיסמה"}
                  style={{position:"absolute",top:"50%",left:10,transform:"translateY(-50%)",background:"transparent",border:"none",outline:"none",padding:0,cursor:"pointer",color:"var(--accent)",opacity:0.85,display:"flex",alignItems:"center",justifyContent:"center"}}
                  onMouseEnter={e=>e.currentTarget.style.opacity=1}
                  onMouseLeave={e=>e.currentTarget.style.opacity=0.85}>
                  {showLoginPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
            {loginError && <div style={{color:"var(--red)",fontSize:13,fontWeight:700,marginBottom:12}}>{loginError}</div>}
            <button className="btn btn-primary" style={{width:"100%",padding:"12px",fontSize:15}} onClick={handleLogin}
              disabled={!loginEmail.trim()||!loginPassword||loginBusy}>
              {loginBusy ? "מתחבר..." : "כניסה"}
            </button>
            <button type="button"
              style={{marginTop:40,background:"var(--accent)",border:"none",color:"#000",fontSize:12,fontWeight:700,cursor:"pointer",borderRadius:8,padding:"7px 20px",display:"inline-block"}}
              onClick={()=>{setAuthView("forgot");setLoginError("");setLoginPassword("");}}>
              שכחת סיסמה?
            </button>
            <div style={{fontSize:13,color:"var(--accent)",marginTop:10,fontWeight:700,lineHeight:1.6}}>
              כניסה ראשונה? לחץ/י על <strong>"שכחת סיסמה?"</strong> ליצירת סיסמה.
            </div>
            <div style={{fontSize:13,color:"#aaa",marginTop:18,paddingTop:14,borderTop:"1px solid var(--border)",lineHeight:1.5}}>
              רק משתמשים רשומים יכולים להיכנס.
            </div>
          </>
        )}

        {authView === "forgot" && (
          <>
            <div style={{textAlign:"right",marginBottom:16}}>
              <label style={{fontSize:13,fontWeight:700,color:"var(--text2)",display:"block",marginBottom:4}}>אימייל</label>
              <input className="form-input" type="email" placeholder="email@example.com" value={loginEmail}
                onChange={e=>{setLoginEmail(e.target.value);setLoginError("");}}
                onKeyDown={e=>e.key==="Enter"&&handleForgotPassword()}
                disabled={loginBusy} autoComplete="email"/>
            </div>
            {loginError && <div style={{color:"var(--red)",fontSize:13,fontWeight:700,marginBottom:12}}>{loginError}</div>}
            <button className="btn btn-primary" style={{width:"100%",padding:"12px",fontSize:15}} onClick={handleForgotPassword}
              disabled={!loginEmail.trim()||loginBusy}>
              {loginBusy ? "שולח..." : "שלח קישור לאיפוס"}
            </button>
            <button type="button"
              style={{marginTop:40,background:"var(--accent)",border:"none",color:"#000",fontSize:12,fontWeight:700,cursor:"pointer",borderRadius:8,padding:"7px 20px",display:"inline-block"}}
              onClick={()=>{setAuthView("login");setLoginError("");}}>
              ← חזרה למסך הכניסה
            </button>
            <div style={{fontSize:13,color:"var(--accent)",marginTop:10,fontWeight:700,lineHeight:1.6}}>
              נשלח אליך קישור במייל ליצירת/איפוס סיסמה. הקישור תקף לשעה.
            </div>
          </>
        )}

        {authView === "forgot-sent" && (
          <>
            <div style={{background:"rgba(74,222,128,0.1)",border:"1px solid rgba(74,222,128,0.3)",borderRadius:12,padding:16,marginBottom:16,textAlign:"right"}}>
              <div style={{fontSize:32,marginBottom:8}}>📧</div>
              <div style={{fontSize:14,fontWeight:700,color:"var(--text)",marginBottom:6}}>הקישור נשלח!</div>
              <div style={{fontSize:12,color:"var(--text2)",lineHeight:1.5}}>
                נשלח קישור לאיפוס סיסמה לכתובת:<br/>
                <span style={{direction:"ltr",fontWeight:700,color:"var(--text)"}}>{loginEmail}</span><br/><br/>
                פתח/י את המייל ולחץ/י על הקישור כדי להגדיר סיסמה חדשה.
              </div>
            </div>
            <button type="button"
              style={{marginTop:4,background:"var(--accent)",border:"none",color:"#000",fontSize:12,fontWeight:700,cursor:"pointer",borderRadius:8,padding:"7px 20px",display:"inline-block"}}
              onClick={()=>{setAuthView("login");setLoginError("");}}>
              ← חזרה למסך הכניסה
            </button>
          </>
        )}

        {/* Staff login button removed — unified login for all roles */}

        {/* ── Mobile PWA install hint ── */}
        {(()=>{
          if(typeof navigator==="undefined") return null;
          const ua=navigator.userAgent;
          const isMob=/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
          if(!isMob) return null;
          const isStandalone=window.matchMedia?.("(display-mode: standalone)")?.matches||window.navigator.standalone;
          if(isStandalone) return null;
          const isIOS=/iPhone|iPad|iPod/i.test(ua)&&!window.MSStream;
          if(!isIOS&&!canInstall) return null;
          if(isIOS) {
            // iOS Safari: no programmatic install — must guide the user via Share → Add to Home Screen.
            return (
              <div style={{marginTop:20,padding:"14px 16px",background:"var(--accent-glow)",border:"1px solid rgba(245,166,35,0.4)",borderRadius:12,direction:"rtl",lineHeight:1.55}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,fontSize:14,fontWeight:800,color:"var(--accent)"}}>
                  <Download size={18} strokeWidth={1.75} /> התקנת האפליקציה (אייפון)
                </div>
                <div style={{fontSize:13,color:"var(--text2)"}}>
                  1. לחץ/י על כפתור <strong>השיתוף</strong> בתחתית ספארי <span aria-hidden="true">⬆︎</span><br/>
                  2. גלול/י ובחר/י <strong>"הוסף למסך הבית"</strong> (Add to Home Screen)<br/>
                  3. לחץ/י <strong>"הוסף"</strong> ופתח/י את האפליקציה מאייקון מסך הבית
                </div>
              </div>
            );
          }
          return (
            <div style={{marginTop:20,textAlign:"center"}}>
              <button type="button" onClick={()=>void onInstall()} style={{background:"var(--accent)",border:"none",color:"#0a0c10",fontSize:14,fontWeight:800,cursor:"pointer",padding:"12px 20px",borderRadius:10,width:"100%",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:8,minHeight:44}}><Download size={18} strokeWidth={1.75} /> התקן את האפליקציה</button>
            </div>
          );
        })()}
      </div>
    </div>
  );

  if(done) return (
    <div className="form-page">
      <div style={{width:"100%",maxWidth:500,background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,padding:40,textAlign:"center",direction:"rtl"}}>
        <div style={{fontSize:64,marginBottom:16}}><CheckCircle size={64} strokeWidth={1.75} color="var(--accent)" /></div>
        <h2 style={{fontSize:24,fontWeight:900,color:"var(--accent)",marginBottom:8}}>הבקשה נשלחה!</h2>
        <p style={{fontSize:14,color:"var(--text2)",marginBottom:28}}>בקשתך התקבלה בהצלחה.<br/>צוות המכללה יעבור עליה לאישורה הסופי.</p>
        <button className="btn btn-secondary" onClick={reset}>🔄 שלח בקשה נוספת</button>
      </div>
    </div>
  );

  // ── Student Hub: landing screen after login ──
  // Mirrors the StaffHub pattern. Forms and productions live as separate
  // "apps" so the PublicForm tab strip can stay focused on the loan flow.
  if (loggedInStudent && studentApp === "hub") {
    // Role flags written by routeToStudent — power the multi-role cards
    // ("פורטל מרצה" / "ניהול מערכת") on the hub. Single-role students get {}.
    const studentRoles = (() => {
      try { return JSON.parse(sessionStorage.getItem("public_student_roles") || "{}") || {}; }
      catch { return {}; }
    })();

    return (
      <>
        <StudentHub
          student={loggedInStudent}
          logo={siteSettings.logo}
          canInstall={canInstall}
          onInstall={onInstall}
          onSelectApp={(key) => setStudentApp(key)}
          roles={studentRoles}
          onSwitchRole={(role) => {
            // Same pattern as the forms-footer switch button: set the hint,
            // clear this interface's identity keys, and let routeByRoles
            // re-dispatch on reload. student_app is cleared so the return
            // trip lands back on the hub rather than a stale sub-app.
            sessionStorage.setItem("active_role", role);
            sessionStorage.removeItem("public_student");
            sessionStorage.removeItem("public_student_roles");
            sessionStorage.removeItem("public_view");
            sessionStorage.removeItem("student_app");
            window.location.assign("/");
          }}
          onOpenAccountSettings={() => setShowAccountSettings(true)}
          onOpenUserGuide={userGuidePdf ? () => {
            const link = document.createElement("a");
            link.href = userGuidePdf.url; link.download = userGuidePdf.filename || "user-guide.pdf";
            link.click();
          } : null}
          onLogout={() => {
            supabase.auth.signOut().catch(()=>{});
            setLoggedInStudent(null);
            setAuthView("login"); setLoginEmail(""); setLoginPassword("");
            sessionStorage.removeItem("public_view"); sessionStorage.removeItem("student_app");
            sessionStorage.removeItem("public_student_roles"); sessionStorage.removeItem("active_role");
            clearFormDraft();
          }}
        />
        {showAccountSettings && loggedInStudent && (
          <AccountSettingsModal
            student={loggedInStudent}
            accentColor={siteSettings.accentColor}
            showToast={showToast}
            onClose={() => setShowAccountSettings(false)}
            onSaved={(updatedStudent) => {
              setLoggedInStudent(prev => prev ? { ...prev, ...updatedStudent } : prev);
              setShowAccountSettings(false);
              showToast("success","הפרופיל עודכן");
            }}
          />
        )}
      </>
    );
  }

  // ── Productions app: full-screen view, NOT a tab inside PublicForm ──
  if (loggedInStudent && studentApp === "productions") {
    return (
      <>
        <div style={{minHeight:"100dvh",background:"var(--bg)",direction:"rtl"}}>
          <div style={{
            display:"flex", alignItems:"center", justifyContent:"space-between",
            gap:8,
            padding:"10px 12px", borderBottom:"1px solid var(--border)",
            background:"var(--surface)", position:"sticky", top:0, zIndex:5,
          }}>
            <button
              type="button"
              onClick={() => setStudentApp("hub")}
              style={{
                padding:"5px 10px", border:"1px solid var(--text2)",
                borderRadius:6, background:"transparent", color:"var(--text)",
                cursor:"pointer", fontSize:12, fontWeight:600,
                display:"flex", alignItems:"center", gap:4, flexShrink:0,
                whiteSpace:"nowrap",
              }}>
              ← תפריט ראשי
            </button>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2,minWidth:0,flex:"1 1 auto"}}>
              <div style={{fontSize:"clamp(15px,4vw,18px)", fontWeight:900, color:"var(--accent)"}}>לוח הפקות</div>
              {loggedInStudent?.name && (
                <div style={{fontSize:"clamp(11px,3vw,13px)", color:"var(--text)", fontWeight:700, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:"100%"}}>שלום, <span style={{color:"var(--accent)"}}>{loggedInStudent.name}</span></div>
              )}
            </div>
            <div style={{width:8,flexShrink:0}} />
          </div>
          <div style={{padding:"20px 0"}}>
            <ProductionsPage
              productions={productions}
              currentStudent={loggedInStudent}
              students={studentsFromTable}
              kits={kits}
              reservations={reservations}
              showToast={(msg, type="info") => showToast(type, msg)}
              refresh={refreshProductions}
              onOpenLoanForm={(p, dateId) => {
                // dateId (optional) — a specific shoot range to pre-select
                // (comes from the per-range "הגש רשימת ציוד" buttons). Seeds the
                // borrow/return fields exactly like clicking the range chip in
                // step 2 would. Falls back to the sole range for a single-date
                // production so we can still land directly on the equipment step.
                const target = dateId
                  ? (p?.dates || []).find(x => String(x.id) === String(dateId))
                  : (p?.dates?.length === 1 ? p.dates[0] : null);
                setForm(f => ({
                  ...f,
                  loan_type: "הפקה",
                  project_name: p?.title || f.project_name,
                  production_id: p?.id || "",
                  production_date_id: target ? target.id : "",
                  ...(target ? {
                    borrow_date: target.startDate,
                    return_date: target.endDate,
                    borrow_time: target.startTime || "",
                    return_time: target.endTime || "",
                  } : {}),
                  production_reason: p?.description || "",
                  ...deriveProductionCrewSnapshot(p, studentsFromTable),
                }));
                setStudentApp("forms");
                setPublicView("equipment");
                // With a resolved range the dates are seeded, so jump straight to
                // the equipment step (step 3) — steps 1 (identity, auto-filled for
                // the logged-in director) and 2 (dates) are already satisfied.
                // Without one (multi-date production, no dateId) fall back to the
                // dates step so the director picks a range first — availEq needs
                // borrow/return dates or the equipment grid renders empty.
                setStep(target ? 3 : 2);
                showToast("info", `הופנית להשאלת ציוד עבור: ${p?.title || ""}`);
              }}
              onOpenMyReservations={() => {
                setStudentApp("forms");
                setPublicView("my-bookings");
                loadStudiosData();
                loadReservationsData();
              }}
            />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
    <div className="form-page" style={{"--accent": siteSettings.accentColor||"#f5a623","--accent2": siteSettings.accentColor||"#f5a623","--accent-glow":`${siteSettings.accentColor||"#f5a623"}2e`}} onTouchStart={handleFormSwipeStart} onTouchEnd={handleFormSwipeEnd}>
      <div className="form-card">
        <div className="form-card-header" style={{position:"relative"}}>
          <button type="button" onClick={()=>{ setShowInfoPanel(true); void syncInventory(); }}
            title="מידע כללי, נהלים וערכות"
            style={{position:"absolute",top:14,left:14,width:42,height:42,borderRadius:"50%",border:"none",background:"transparent",padding:0,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2,color:"var(--accent)",opacity:0.9,transition:"opacity 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.opacity=1}
            onMouseLeave={e=>e.currentTarget.style.opacity=0.9}>
            <svg width="42" height="42" viewBox="0 0 42 42" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="21" cy="21" r="19" stroke="currentColor" strokeWidth="2.2"/>
              <circle cx="21" cy="14.5" r="2.2" fill="currentColor"/>
              <rect x="19.4" y="19.5" width="3.2" height="10.5" rx="1.6" fill="currentColor"/>
            </svg>
          </button>
          <button
            type="button"
            onClick={()=>setShowAccountSettings(true)}
            title="הגדרות חשבון"
            style={{position:"absolute",top:14,left:62,width:42,height:42,borderRadius:"50%",border:"none",background:"transparent",padding:0,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2,color:"var(--accent)",opacity:0.9,transition:"opacity 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.opacity=1}
            onMouseLeave={e=>e.currentTarget.style.opacity=0.9}
          >
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center",paddingInline:"24px"}}>
            <button
              type="button"
              onClick={() => setStudentApp("hub")}
              style={{
                marginBottom: 8,
                padding: "6px 16px",
                border: "1px solid var(--text2)", borderRadius: 16,
                background: "transparent", color: "var(--text)",
                cursor: "pointer", fontSize: 13, fontWeight: 600,
                display: "inline-flex", alignItems: "center", gap: 4,
              }}>← תפריט ראשי</button>
            <div style={{fontSize:"clamp(15px,4.5vw,22px)",fontWeight:900,color:"var(--accent)"}}>מערכת הפניות</div>
            <div style={{fontSize:14,color:"var(--text)",marginTop:4,fontWeight:700}}>שלום, <span style={{color:"var(--accent)"}}>{loggedInStudent.name}</span></div>
          </div>
          {/* ── View toggle: equipment vs studios ── */}
          <div style={{display:"flex",gap:3,marginTop:16,background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:4}}>
            {[
              {view:"equipment", icon:<Package size={18} strokeWidth={1.75}/>, label:"השאלת\nציוד", onClick:()=>setPublicView("equipment")},
              {view:"studios", icon:<Mic size={18} strokeWidth={1.75}/>, label:"קביעת\nחדרים", onClick:()=>{setPublicView("studios");loadStudiosData();}},
              {view:"daily", icon:<Calendar size={18} strokeWidth={1.75}/>, label:"לוז\nיומי", onClick:()=>{setPublicView("daily");setDailyDayOffset(0);loadDailySchedule();}},
              {view:"my-bookings", icon:<ClipboardList size={18} strokeWidth={1.75}/>, label:"ההזמנות\nשלי", onClick:()=>{setPublicView("my-bookings");loadStudiosData();loadReservationsData();}},
            ].map(({view,icon,label,onClick})=>(
              <button key={view} type="button" onClick={onClick}
                style={{flex:1,minWidth:0,padding:"8px 2px",borderRadius:6,border:"none",background:publicView===view?"var(--accent)":"transparent",color:publicView===view?"#000":"var(--text2)",fontWeight:800,fontSize:"clamp(10px,2.8vw,13px)",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,lineHeight:1.25,whiteSpace:"pre-line",textAlign:"center"}}>
                {icon}
                <span>{label}</span>
              </button>
            ))}
          </div>
          {publicView==="equipment" && <>
          {/* Clickable tab navigation — always free to navigate, validation only on submit */}
            <div style={{display:"flex",gap:4,marginTop:20,background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:4}}>
              {[{n:1,l:"פרטים",icon:<User size={14} strokeWidth={1.75} />},{n:2,l:"תאריכים",icon:<Calendar size={14} strokeWidth={1.75} />},{n:3,l:"ציוד",icon:<Package size={14} strokeWidth={1.75} />},{n:4,l:"אישור",icon:<CheckCircle size={14} strokeWidth={1.75} />}].map(s=>{
              const done = (s.n===1 && ok1WithCrew) || (s.n===2 && ok2) || (s.n===3 && ok3) || (s.n===4 && canSubmit);
              const locked = s.n===4 && !canAccessStep(s.n);
              return (
                <button key={s.n} type="button"
                  onClick={()=>goToStep(s.n)}
                  style={{flex:1,padding:"8px 4px",borderRadius:6,border:"none",background:step===s.n?"var(--accent)":"transparent",color:step===s.n?"#000":"var(--text2)",fontWeight:step===s.n?800:500,fontSize:12,cursor:"pointer",transition:"all 0.15s",display:"flex",flexDirection:"column",alignItems:"center",gap:2,position:"relative",opacity:locked?0.55:1}}>
                  <span style={{fontSize:14}}>{s.icon}</span>
                  <span>{s.l}</span>
                  {done&&step!==s.n&&<span style={{position:"absolute",top:3,left:3,width:8,height:8,borderRadius:"50%",background:"var(--green)"}}/>}
                </button>
              );
            })}
          </div>
          </>}
        </div>
        {publicView==="equipment" && <div className="form-card-body">
          {step===1 && <>
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:16}}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async()=>{ await syncInventory(); setShowEquipmentAiModal(true); }}
                disabled={equipmentAiLoading || !visibleLoanTypeOptions.length}
                style={{display:"inline-flex",alignItems:"center",gap:8,fontWeight:800}}
              >
                ✨ השאלת ציוד חכמה
              </button>
            </div>
            <div className="form-section-title">סוג ההשאלה</div>
            {!visibleLoanTypeOptions.length && (
              <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>
                🚫 לא הוגדרו סוגי השאלה זמינים למסלול הלימודים שלך. יש לפנות לצוות המחסן.
              </div>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:24}}>
              {visibleLoanTypeOptions.map(opt=>(
                <div key={opt.val} onClick={()=>{
                  setForm((prev) => ({
                    ...prev,
                    loan_type: opt.val,
                    sound_day_loan: opt.val==="סאונד" ? prev.sound_day_loan : false,
                    sound_night_loan: opt.val==="סאונד" ? prev.sound_night_loan : false,
                    studio_booking_id: opt.val==="סאונד" ? prev.studio_booking_id : "",
                    borrow_date: opt.val==="סאונד" ? prev.borrow_date : "",
                    return_date: opt.val==="סאונד" ? prev.return_date : "",
                    borrow_time: opt.val==="סאונד" ? prev.borrow_time : "",
                    return_time: opt.val==="סאונד" ? prev.return_time : "",
                  }));
                  setItems([]);
                }} style={{width:"100%",padding:"14px 18px",borderRadius:"var(--r)",background:form.loan_type===opt.val?"var(--accent-glow)":"var(--surface2)",border:`2px solid ${form.loan_type===opt.val?"var(--accent)":"var(--border)"}`,cursor:"pointer",transition:"all 0.15s",display:"flex",alignItems:"center",gap:14}}>
                  <div style={{fontSize:30,flexShrink:0}}>{opt.icon}</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:800,fontSize:15,color:form.loan_type===opt.val?"var(--accent)":"var(--text)"}}>{opt.val==="סאונד"?"השאלת סאונד":opt.val==="הפקה"?"השאלת הפקה":opt.val==="קולנוע יומית"?"השאלת קולנוע יומית":`השאלה ${opt.val}`}</div>
                    <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{opt.desc}</div>
                  </div>
                  {form.loan_type===opt.val&&<div style={{fontSize:16,color:"var(--accent)",fontWeight:900,flexShrink:0}}><Check size={16} strokeWidth={1.75} /></div>}
                </div>
              ))}
            </div>
            {isProductionLoan ? (
              // For production loans, the director's identity is taken from the
              // logged-in session — no manual inputs. The other identity fields
              // (course, phone) are also auto-filled by applyStudentIdentity on login.
              <div style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"12px 14px",marginBottom:14,fontSize:13,color:"var(--text)",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <span style={{fontSize:18}}>👤</span>
                <div>
                  <div style={{fontWeight:700}}>{(form.student_first_name + " " + form.student_last_name).trim() || loggedInStudent?.name || "—"}</div>
                  <div style={{fontSize:12,color:"var(--text3)"}}>{form.email || loggedInStudent?.email || ""}</div>
                </div>
              </div>
            ) : (
              <>
                <div className="form-section-title">פרטי הסטודנט</div>
                <div className="grid-2">
                  <div className="form-group"><label className="form-label">שם פרטי *</label><input className="form-input" name="student_first_name" autoComplete="given-name" value={form.student_first_name} onChange={e=>setStudentFirstName(e.target.value)}/></div>
                  <div className="form-group"><label className="form-label">שם משפחה *</label><input className="form-input" name="student_last_name" autoComplete="family-name" value={form.student_last_name} onChange={e=>setStudentLastName(e.target.value)}/></div>
                </div>
                <div className="grid-2">
                  <div className="form-group"><label className="form-label">טלפון *</label><input className="form-input" name="phone" autoComplete="tel" value={form.phone} onChange={e=>set("phone",e.target.value)}/></div>
                  <div className="form-group"><label className="form-label">אימייל *{loggedInStudent?.email&&<span style={{fontSize:11,fontWeight:600,color:"var(--text3)",marginRight:6}}>(מהחשבון שלך)</span>}</label><input type="email" className="form-input" name="email" autoComplete="email" value={form.email} onChange={e=>set("email",e.target.value)} readOnly={!!loggedInStudent?.email} style={loggedInStudent?.email?{opacity:0.7,cursor:"not-allowed"}:undefined}/></div>
                </div>
                <div className="grid-2">
                  <div className="form-group"><label className="form-label">קורס / כיתה *</label><input className="form-input" value={form.course} onChange={e=>set("course",e.target.value)}/></div>
                  <div className="form-group"><label className="form-label">שם הפרויקט</label><input className="form-input" value={form.project_name} onChange={e=>set("project_name",e.target.value)}/></div>
                </div>
              </>
            )}

            {isProductionLoan && (<>
              <div className="form-section-title" style={{marginTop:20}}>בחירת הפקה</div>
              {myProductions.length === 0 ? (
                <div style={{background:"rgba(245,166,35,0.1)",border:"1px solid rgba(245,166,35,0.4)",borderRadius:"var(--r)",padding:"20px",marginBottom:16,textAlign:"center"}}>
                  <div style={{fontSize:15,fontWeight:700,color:"var(--accent)",marginBottom:12}}>
                    <Film size={20} strokeWidth={1.75} style={{verticalAlign:"middle",marginInlineEnd:6}}/>
                    אין לך הפקה מוכנה להשאלת ציוד
                  </div>
                  <div style={{fontSize:14,color:"var(--text)",marginBottom:14,lineHeight:1.7,textAlign:"right"}}>
                    כדי להגיש בקשת השאלת ציוד להפקה — יש להקים אותה קודם בלוח ההפקות:
                    <ul style={{margin:"8px 0 0",paddingInlineStart:22,fontSize:13}}>
                      <li>תאריכי צילום</li>
                      <li><strong style={{color:"var(--accent)"}}>צלם ראשי רשום ומאושר</strong> (חובה)</li>
                      <li>איש סאונד (אופציונלי)</li>
                      <li>שאר הצוות (אופציונלי)</li>
                    </ul>
                  </div>
                  <div style={{fontSize:13,color:"#e74c3c",fontWeight:700,marginBottom:14,padding:"8px 12px",background:"rgba(231,76,60,0.1)",border:"1px solid #e74c3c",borderRadius:6,lineHeight:1.5}}>
                    ⏱ נוהל המחסן: הפקה חייבת להיות מוקמת ורשימת ציוד מוגשת לפחות <strong>8 ימים מראש</strong> (כולל היום).
                  </div>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setStudentApp("productions")}>
                    מעבר ללוח הפקות
                  </button>
                </div>
              ) : (
                <div style={{background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",padding:"16px",marginBottom:16}}>
                  <div className="form-group">
                    <label className="form-label">הפקה *</label>
                    <select className="form-select" value={form.production_id || ""}
                      onChange={e => {
                        const picked = myProductions.find(p => p.id === e.target.value);
                        if (!picked) {
                          setForm(f => ({ ...f, production_id: "", production_date_id: "" }));
                          return;
                        }
                        setForm(f => ({
                          ...f,
                          production_id: picked.id,
                          production_date_id: picked.dates?.length === 1 ? picked.dates[0].id : "",
                          project_name: picked.title || "",
                          production_reason: picked.description || "",
                          ...deriveProductionCrewSnapshot(picked, studentsFromTable),
                        }));
                      }}>
                      <option value="">— בחר הפקה —</option>
                      {myProductions.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                    </select>
                  </div>
                  {selectedProduction && (() => {
                    const studentsList = studentsFromTable;
                    const ROLE_LABEL = { photographer: "צלם ראשי", sound: "איש סאונד" };
                    const approvedCrew = (selectedProduction.crew || []).filter(c => c.status === "approved");
                    const roleOrder = (r) => r === "photographer" ? 0 : r === "sound" ? 1 : 2;
                    approvedCrew.sort((a, b) => roleOrder(a.role) - roleOrder(b.role));
                    const fmtDate = (d) => { try { return new Date(d).toLocaleDateString("he-IL", { day:"2-digit", month:"2-digit", year:"numeric" }); } catch { return d; } };
                    return (
                      <div style={{marginTop:12,background:"var(--surface)",borderRadius:6,padding:12,fontSize:13,lineHeight:1.7}}>
                        <div style={{fontWeight:700,fontSize:14,marginBottom:6,color:"var(--accent)"}}>{selectedProduction.title}</div>
                        <div><strong>במאי:</strong> {selectedProduction.directorName || "—"}</div>
                        <div style={{marginTop:6}}><strong>צוות מאושר:</strong></div>
                        {approvedCrew.length === 0 ? (
                          <div style={{color:"var(--text3)",fontSize:12,marginInlineStart:8}}>— אין עדיין צוות מאושר —</div>
                        ) : (
                          <ul style={{margin:"4px 0",paddingInlineStart:20}}>
                            {approvedCrew.map(c => {
                              const stu = studentsList.find(s => String(s.id) === String(c.studentId));
                              const name = stu?.name || c.freeTextName || c.crewEmail || "—";
                              const label = c.role === "custom" ? (c.roleLabel || "תפקיד") : (ROLE_LABEL[c.role] || c.role);
                              return <li key={c.id}><strong>{label}:</strong> {name}</li>;
                            })}
                          </ul>
                        )}
                        <div style={{marginTop:6}}><strong>תאריכי צילום:</strong></div>
                        {(() => {
                          const lockedDateIds = new Set(
                            (reservations || [])
                              .filter(r => r.production_id === selectedProduction.id && r.status !== "בוטל" && r.production_date_id)
                              .map(r => String(r.production_date_id))
                          );
                          return (
                            <ul style={{margin:"4px 0",paddingInlineStart:20}}>
                              {(selectedProduction.dates || []).map(d => {
                                const locked = lockedDateIds.has(String(d.id));
                                return (
                                  <li key={d.id}>
                                    {fmtDate(d.startDate)} {formatTime(d.startTime)} – {d.startDate === d.endDate ? "" : fmtDate(d.endDate) + " "}{formatTime(d.endTime)}
                                    {d.note ? <span style={{color:"var(--text3)"}}> ({d.note})</span> : null}
                                    {locked && (
                                      <span style={{marginInlineStart:8,fontSize:11,color:"#2ecc71",fontWeight:700}}>
                                        ✓ הוגשה רשימת ציוד
                                      </span>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          );
                        })()}
                        {selectedProduction.description && (
                          <div style={{marginTop:8,padding:"8px 10px",background:"var(--surface2)",borderRadius:4,fontSize:12,color:"var(--text2)",whiteSpace:"pre-wrap"}}>
                            {selectedProduction.description}
                          </div>
                        )}
                        {selectedProduction.driveUrl && (
                          <a href={selectedProduction.driveUrl} target="_blank" rel="noopener noreferrer"
                            style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:8,padding:"4px 10px",borderRadius:4,border:"1px solid var(--accent)",color:"var(--accent)",textDecoration:"none",fontSize:12,fontWeight:700}}>
                            📄 קישור לתסריט/סינופסיס
                          </a>
                        )}
                        <div style={{marginTop:8,fontSize:11,color:"var(--text3)"}}>
                          🔒 פרטי הצוות והתיאור מוגדרים בלוח ההפקות ולא ניתנים לעריכה כאן.
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </>)}

            <button className="btn btn-primary" disabled={!ok1WithCrew} onClick={()=>setStep(2)}>{isSoundLoan ? "המשך ← שיוך קביעת חדר" : "המשך ← תאריכים"}</button>
          </>}

          {step===2 && <>
            <div className="form-section-title">
              <span>{isSoundLoan ? "שיוך קביעת חדר" : "תאריכים ושעות"}</span>
            </div>
            {isSoundLoan && (
              <div style={{marginBottom:16,background:"rgba(245,166,35,0.08)",border:"2px solid rgba(245,166,35,0.5)",borderRadius:"var(--r-sm)",padding:"14px 16px"}}>
                <label style={{display:"block",fontWeight:800,fontSize:13,color:"#f5a623",marginBottom:8,display:"flex",alignItems:"center",gap:4}}><Mic size={14} strokeWidth={1.75} color="#f5a623" /> שיוך לקביעת חדר *
                  {!form.studio_booking_id && <span style={{fontWeight:400,fontSize:11,color:"var(--red)",marginRight:8}}>— חובה לשייך קביעת חדר</span>}
                </label>
                <select className="form-select" value={form.studio_booking_id} onChange={e=>{
                  const gId = e.target.value;
                  if (gId) {
                    const grp = groupedStudentBookings.find(g=>g.primaryId===gId);
                    if (grp) {
                      const hasNight = grp.bookings.some(b=>b.isNight);
                      const isSingleNightOnly = grp.bookings.length === 1 && hasNight;
                      if (isSingleNightOnly && new Date().getHours() >= 17) {
                        showToast("error", "לא ניתן לשייך קביעת לילה להשאלת ציוד אחרי השעה 17:00.");
                        return;
                      }
                      setForm(prev=>({...prev, studio_booking_id:gId,
                        borrow_date:grp.startDate, borrow_time:grp.startTime||"",
                        return_date:grp.endDate, return_time:grp.endTime||"",
                        sound_night_loan:hasNight, sound_day_loan:!hasNight}));
                    }
                  } else {
                    setForm(prev=>({...prev, studio_booking_id:"", borrow_date:"", borrow_time:"", return_date:"", return_time:"", sound_day_loan:false, sound_night_loan:false}));
                  }
                }} style={{borderColor: form.studio_booking_id ? "var(--accent)" : "rgba(245,166,35,0.6)"}}>
                  <option value="">-- בחר קביעת חדר --</option>
                  {groupedStudentBookings.map(grp=>{
                    const studio = visibleStudios?.find(s=>String(s.id)===String(grp.studioId)) || studios?.find(s=>String(s.id)===String(grp.studioId));
                    const hasNight = grp.bookings.some(b=>b.isNight);
                    const timeLabel = grp.isMultiDay
                      ? `${fmtDate(grp.startDate)} ${formatTime(grp.startTime)} – ${fmtDate(grp.endDate)} ${formatTime(grp.endTime)}`
                      : `${fmtDate(grp.startDate)} · ${formatTime(grp.startTime)}–${formatTime(grp.endTime)}`;
                    const icon = hasNight ? "🌙" : "☀️";
                    return <option key={grp.primaryId} value={grp.primaryId}>{icon} {studio?.name||"חדר"} · {timeLabel}</option>;
                  })}
                </select>
                {!form.studio_booking_id && <div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>אין לך קביעת חדר? עבור לדף "קביעת חדרים" וקבע חדר תחילה.</div>}
              </div>
            )}
            {isCinemaLoan && (
              <div className="highlight-box" style={{marginBottom:16,background:"rgba(52,152,219,0.08)",border:"1px solid rgba(52,152,219,0.25)"}}>
                🎥 השאלת קולנוע יומית — יש לבחור תאריך לפחות 24 שעות קדימה. ההשאלה מוגבלת ל-6 שעות באותו יום.
              </div>
            )}
            {isCinemaLoan ? (
              <>
                <div className="grid-2">
                  <div className="form-group"><label className="form-label" style={{display:"flex",alignItems:"center",gap:4}}><Calendar size={14} strokeWidth={1.75} color="var(--accent)" /> תאריך *</label>
                    <input type="date" className="form-input" min={minDate} value={form.borrow_date} onChange={e=>{
                      setForm(prev=>({...prev, borrow_date:e.target.value, return_date:e.target.value, borrow_time:"", return_time:""}));
                    }}/>
                  </div>
                  <div className="form-group"><label className="form-label">שעת התחלה *</label>
                    <select className="form-select" value={form.borrow_time} onChange={e=>setForm(prev=>({...prev, borrow_time:e.target.value, return_time:""}))}>
                      <option value="">-- בחר שעה --</option>
                      {TIME_SLOTS.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid-2">
                  <div/>
                  <div className="form-group"><label className="form-label">שעת סיום * <span style={{fontSize:11,color:"var(--text3)",fontWeight:400}}>(עד 6 שעות)</span></label>
                    <select className="form-select" value={form.return_time} onChange={e=>set("return_time",e.target.value)} disabled={!form.borrow_time}>
                      <option value="">-- בחר שעה --</option>
                      {availableReturnSlots.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              </>
            ) : isSoundLoan ? (
              form.studio_booking_id && form.borrow_date ? (
                <>
                  {(borrowWeekend || returnWeekend) ? (
                    // Sound-loan booking falls on Friday/Saturday — warehouse is
                    // closed those days so the equipment can't be picked up or
                    // returned. ok2 is already blocked via borrowWeekend, this
                    // surfaces the reason clearly to the student.
                    <div style={{background:"rgba(231,76,60,0.12)",border:"2px solid rgba(231,76,60,0.55)",borderRadius:"var(--r-sm)",padding:"14px 18px",marginBottom:16,fontSize:13,fontWeight:700,color:"var(--red)",display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:18}}>🚫</span>
                      <span>שים לב המחסן סגור בימי שישי ושבת לכן לא ניתן להשאיל ציוד.</span>
                    </div>
                  ) : soundLeadTooShort ? (
                    <div style={{background:"rgba(231,76,60,0.12)",border:"2px solid rgba(231,76,60,0.55)",borderRadius:"var(--r-sm)",padding:"14px 18px",marginBottom:16,fontSize:13,fontWeight:700,color:"var(--red)",display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:18}}>⚠️</span>
                      <span>שים לב יש לשריין את הציוד כ-3 שעות לפני תחילת הסשן.</span>
                    </div>
                  ) : (
                    <div style={{background:"rgba(76,217,100,0.08)",border:"1px solid rgba(76,217,100,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>
                      <CheckCircle size={16} strokeWidth={1.75} /> <strong>מועד ההשאלה נקבע לפי קביעת החדר:</strong>{" "}
                      {form.borrow_date === form.return_date
                        ? `${formatDate(form.borrow_date)} · ${formatTime(form.borrow_time)}–${formatTime(form.return_time)}`
                        : `${formatDate(form.borrow_date)} ${formatTime(form.borrow_time)} עד ${formatDate(form.return_date)} ${formatTime(form.return_time)}`}
                    </div>
                  )}
                </>
              ) : null
            ) : isProductionLoan && selectedProduction && (selectedProduction.dates || []).length > 0 ? (
              <>
                {(() => {
                  const lockedDateIds = new Set(
                    (reservations || [])
                      .filter(r => r.production_id === selectedProduction.id && r.status !== "בוטל" && r.production_date_id)
                      .map(r => String(r.production_date_id))
                  );
                  const availableDates = (selectedProduction.dates || []).filter(d => !lockedDateIds.has(String(d.id)));
                  if (availableDates.length === 0) {
                    return (
                      <div style={{background:"rgba(46,204,113,0.08)",border:"1px solid rgba(46,204,113,0.4)",borderRadius:"var(--r-sm)",padding:"16px 18px",marginBottom:14,color:"#2ecc71",fontWeight:700,textAlign:"center"}}>
                        ✓ הוגשה רשימת ציוד לכל הטווחים בהפקה זו.<br/>
                        <span style={{fontWeight:400,fontSize:12,color:"var(--text2)"}}>למחיקה/עדכון — עבור ל"ההזמנות שלי".</span>
                      </div>
                    );
                  }
                  return (
                    <div style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:14}}>
                      <div style={{fontSize:13,fontWeight:700,color:"var(--accent)",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
                        <Calendar size={14} strokeWidth={1.75}/> תאריכי הצילום של ההפקה
                      </div>
                      <div style={{fontSize:12,color:"var(--text2)",marginBottom:12,lineHeight:1.5}}>
                        בחר/י את התאריך שעבורו תוגש רשימת ציוד. התאריכים והשעות נקבעו מראש בלוח ההפקות ולא ניתנים לעריכה כאן.
                      </div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {[...availableDates]
                          .sort((a, b) => String(a.startDate || "").localeCompare(String(b.startDate || "")))
                          .map(d => {
                          // Match on production_date_id first — it's the canonical
                          // id the "הגש רשימת ציוד" bridge pre-seeds. Falling back to
                          // date/time comparison is fragile: the bridge seeds times
                          // from the editor blob ("09:00") while these chips come from
                          // the DB-loaded production ("09:00:00"), so the strings differ
                          // and the pre-selected chip wouldn't highlight on step-back.
                          const isActive = form.production_date_id
                            ? String(form.production_date_id) === String(d.id)
                            : (form.borrow_date === d.startDate && form.return_date === d.endDate
                               && form.borrow_time === d.startTime && form.return_time === d.endTime);
                          const fmtCh = (s) => { try { return new Date(s + "T00:00:00").toLocaleDateString("he-IL", { day:"2-digit", month:"2-digit" }); } catch { return s; } };
                          const trimT = (t) => String(t || "").slice(0,5); // "17:30:00" → "17:30"
                          return (
                            <button key={d.id} type="button" onClick={() => {
                              setForm(prev => ({
                                ...prev,
                                borrow_date: d.startDate,
                                return_date: d.endDate,
                                borrow_time: d.startTime || "",
                                return_time: d.endTime || "",
                                production_date_id: d.id,
                              }));
                            }} style={{
                              display:"flex",flexDirection:"column",alignItems:"stretch",gap:4,
                              padding:"10px 14px", borderRadius:8,
                              border:`2px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                              background: isActive ? "var(--accent-glow)" : "transparent",
                              color: isActive ? "var(--accent)" : "var(--text2)",
                              fontWeight:700, cursor:"pointer", minWidth:170,
                              textAlign:"start",
                            }}>
                              <div style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:12}}>
                                <span style={{color:"var(--text)",fontWeight:800,letterSpacing:0.3}}>הוצאה:</span>
                                <span>{fmtCh(d.startDate)} · {trimT(d.startTime)}</span>
                              </div>
                              <div style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:12}}>
                                <span style={{color:"var(--text)",fontWeight:800,letterSpacing:0.3}}>החזרה:</span>
                                <span>{fmtCh(d.endDate)} · {trimT(d.endTime)}</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      {form.borrow_date && form.borrow_time && (
                        <div style={{marginTop:14,padding:"10px 12px",background:"var(--surface)",border:"1px solid var(--accent)",borderRadius:6,fontSize:13,color:"var(--text)"}}>
                          <strong style={{color:"var(--accent)"}}>נבחר טווח להגשה:</strong> השאלה ב-{(() => { try { return new Date(form.borrow_date + "T00:00:00").toLocaleDateString("he-IL"); } catch { return form.borrow_date; } })()} {String(form.borrow_time || "").slice(0,5)} · החזרה ב-{(() => { try { return new Date(form.return_date + "T00:00:00").toLocaleDateString("he-IL"); } catch { return form.return_date; } })()} {String(form.return_time || "").slice(0,5)}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </>
            ) : (
              <>
                <div className="grid-2">
                  <div className="form-group"><label className="form-label" style={{display:"flex",alignItems:"center",gap:4}}><Calendar size={14} strokeWidth={1.75} color="var(--accent)" /> תאריך השאלה *</label><input type="date" className="form-input" min={minDate} value={form.borrow_date} onChange={e=>set("borrow_date",e.target.value)}/></div>
                  <div className="form-group"><label className="form-label">שעת איסוף *</label>
                    <select className="form-select" value={form.borrow_time} onChange={e=>setForm(prev=>({...prev,borrow_time:e.target.value}))}>
                      <option value="">-- בחר שעה --</option>
                      {availableBorrowSlots.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid-2">
                  <div className="form-group"><label className="form-label" style={{display:"flex",alignItems:"center",gap:4}}><Calendar size={14} strokeWidth={1.75} color="var(--accent)" /> תאריך החזרה *</label><input type="date" className="form-input" min={form.borrow_date||today()} value={form.return_date} onChange={e=>set("return_date",e.target.value)}/></div>
                  <div className="form-group"><label className="form-label">שעת החזרה *</label>
                    <select className="form-select" value={form.return_time} onChange={e=>set("return_time",e.target.value)}>
                      <option value="">-- בחר שעה --</option>
                      {availableReturnSlots.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              </>
            )}
            {!isSoundLoan && (borrowWeekend||(returnWeekend&&!isCinemaLoan)) && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 המחסן אינו פעיל בימים שישי ושבת. נא לבחור ימים א׳–ה׳ בלבד.</div>}
            {!isSoundLoan && tooSoon && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 {form.loan_type==="פרטית"?"השאלה פרטית דורשת התראה של 24 שעות לפחות.":form.loan_type==="הפקה"?"השאלת הפקה דורשת הגשה 8 ימים מראש לפחות.":"נדרשת התראה של שבוע לפחות."} תאריך מוקדם ביותר: <strong>{formatDate(minDate)}</strong></div>}
            {cinemaTooSoon && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 השאלת קולנוע יומית דורשת הזמנה של 24 שעות מראש. תאריך מוקדם ביותר: <strong>{formatDate(minDate)}</strong></div>}
            {!isSoundLoan && tooLong && !isCinemaLoan && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 לא ניתן להשלים את התהליך כי זמן ההשאלה חורג מנהלי המכללה. משך מקסימלי: <strong>{maxDays} ימים</strong></div>}
            {!isSoundLoan && returnBeforeBorrow && !isCinemaLoan && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 זמנים לא נכונים — תאריך החזרה חייב להיות אחרי תאריך ההשאלה.</div>}
            {!isSoundLoan && timeOrderError && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 זמנים לא נכונים — שעת החזרה חייבת להיות אחרי שעת האיסוף באותו יום.</div>}
            {!isSoundLoan && pastLoanTimeError && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 {pastLoanTimeError}</div>}
            {ok2 && !isSoundLoan && <div className="highlight-box" style={{display:"flex",alignItems:"center",gap:6}}>{isCinemaLoan ? <>🎥 השאלת קולנוע יומית · {formatDate(form.borrow_date)} · {String(form.borrow_time||"").slice(0,5)}–{String(form.return_time||"").slice(0,5)}</> : <><Calendar size={16} strokeWidth={1.75} color="var(--accent)" /> השאלה ל-{loanDays} ימים · איסוף {String(form.borrow_time||"").slice(0,5)} · החזרה {String(form.return_time||"").slice(0,5)}</>}</div>}

            {/* Mini calendar — approved reservations */}
            <PublicMiniCalendar reservations={reservations} lessons={lessons} initialLoanType="הכל" previewStart={form.borrow_date} previewEnd={form.return_date} previewName={form.student_name||"הבקשה שלך"} borrowDate={form.borrow_date} onActiveStateChange={setCalSnapshot}/>

            <div className="flex gap-2"><button className="btn btn-secondary" onClick={()=>setStep(1)}>← חזור</button><button className="btn btn-primary" disabled={!ok2} onClick={()=>setStep(3)}>המשך ← ציוד</button></div>

            <ActiveListsPanel
              reservations={reservations}
              lessons={lessons}
              equipment={equipment}
              calSnapshot={calSnapshot}
              open={activeListsOpen}
              setOpen={setActiveListsOpen}
            />
          </>}

          {step===3 && <Step3Equipment
            key={form.loan_type || "no-loan-type"}
            isSoundLoan={isSoundLoan}
            kits={kits}
            loanType={form.loan_type}
            categories={categories}
            availEq={availEq}
            equipment={equipment}
            setItems={setItems}
            getItem={getItem}
            setQty={setQty}
            canBorrowEq={canBorrowEq}
            crewIsCertifiedForEq={crewIsCertifiedForEq}
            studentRecord={studentRecord}
            certificationTypes={certifications.types||[]}
            categoryLoanTypes={categoryLoanTypes}
            productions={productions}
            productionId={form.production_id}
          />}
            {step===3 && <Step3Buttons
              items={items} equipment={equipment}
              privateLoanLimitExceeded={privateLoanLimitExceeded}
              onBack={()=>setStep(2)} onNext={()=>goToStep(4)}
            />}

          {step===4 && <Step4Confirm
            form={form} items={items} equipment={equipment}
            agreed={agreed} setAgreed={setAgreed}
            submitting={submitting} submit={submit} canSubmit={canSubmit}
            onBack={()=>setStep(3)}
            policies={policies}
            loanType={form.loan_type}
          />}
        </div>}
        {publicView==="studios" && <div className="form-card-body" style={{padding:0}}>
          <PublicStudioBooking
            studios={visibleStudios} bookings={studioBookings} setBookings={setStudioBookings}
            student={loggedInStudent} showToast={showToast}
            weekOffset={studioWeekOffset} setWeekOffset={setStudioWeekOffset}
            modal={studioModal} setModal={setStudioModal}
            certifications={certifications}
            siteSettings={siteSettings}
            policies={policies}
          />
        </div>}
        {publicView==="daily" && <div className="form-card-body">
          {(() => {
            const offsetDate = new Date();
            offsetDate.setDate(offsetDate.getDate() + dailyDayOffset);
            const yyyy = offsetDate.getFullYear();
            const mm = String(offsetDate.getMonth()+1).padStart(2,"0");
            const dd = String(offsetDate.getDate()).padStart(2,"0");
            const targetDate = `${yyyy}-${mm}-${dd}`;
            const HE_DAYS = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
            const dayName = HE_DAYS[offsetDate.getDay()];
            const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
            const dateLabel = `יום ${dayName}, ${dd} ב${HE_MONTHS[offsetDate.getMonth()]} ${yyyy}`;
            const allSessions = [];
            dailyLessons.forEach(lesson => {
              // id → name map for resolving session.lecturerIds[] to display
              // names joined by " + " (PR #24 multi-lecturer).
              const lessonLecturerById = new Map();
              if (Array.isArray(lesson?.lecturers)) {
                for (const item of lesson.lecturers) {
                  if (item?.lecturerId) lessonLecturerById.set(String(item.lecturerId), String(item.instructorName || "").trim());
                }
              }
              (lesson.schedule||[]).forEach(s => {
                if (s.date === targetDate) {
                  const sessionStudioIds = Array.isArray(s.studioIds) && s.studioIds.length
                    ? s.studioIds
                    : [s.studioId, s.secondaryStudioId, lesson.studioId].filter(Boolean);
                  const studioName = [...new Set(sessionStudioIds)]
                    .map(id => (studios || []).find(st => String(st.id) === String(id))?.name)
                    .filter(Boolean)
                    .join(" + ");
                  const sessionLecturerIds = Array.isArray(s.lecturerIds) ? s.lecturerIds.filter(Boolean) : [];
                  const joinedLecturers = sessionLecturerIds.length
                    ? sessionLecturerIds.map(id => lessonLecturerById.get(String(id)) || "").filter(Boolean).join(" + ")
                    : "";
                  const instructorName = joinedLecturers || s.instructorName || lesson.instructorName || "";
                  allSessions.push({ lessonName: lesson.name||"", instructorName, topic: s.topic||"", startTime: s.startTime||"", endTime: s.endTime||"", track: lesson.track||"", studioName });
                }
              });
            });
            allSessions.sort((a,b) => {
              const s = (a.startTime||"").localeCompare(b.startTime||"");
              return s !== 0 ? s : (a.endTime||"").localeCompare(b.endTime||"");
            });
            const studentTrack = (loggedInStudent?.track||"").trim();
            const sessions = dailyMyLessons && studentTrack
              ? allSessions.filter(s => (s.track||"").trim() === studentTrack)
              : allSessions;
            return <>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,gap:8}}>
                {/* כפתור ימיני — אחורה בזמן (יום קודם) */}
                <button type="button" onClick={()=>setDailyDayOffset(o=>Math.max(0,o-1))} disabled={dailyDayOffset===0}
                  style={{padding:"6px 14px",borderRadius:6,border:"1px solid var(--border)",background:"var(--surface2)",cursor:dailyDayOffset===0?"not-allowed":"pointer",opacity:dailyDayOffset===0?0.4:1,fontSize:18,fontWeight:900}}>›</button>
                <div style={{textAlign:"center",fontWeight:800,fontSize:14,color:"var(--text)"}}>
                  {dateLabel}
                </div>
                {/* כפתור שמאלי — קדימה בזמן (יום הבא) */}
                <button type="button" onClick={()=>setDailyDayOffset(o=>Math.min(6,o+1))} disabled={dailyDayOffset===6}
                  style={{padding:"6px 14px",borderRadius:6,border:"1px solid var(--border)",background:"var(--surface2)",cursor:dailyDayOffset===6?"not-allowed":"pointer",opacity:dailyDayOffset===6?0.4:1,fontSize:18,fontWeight:900}}>‹</button>
              </div>
              <div style={{display:"flex",gap:8,marginBottom:14,justifyContent:"center",flexWrap:"wrap"}}>
                {dailyDayOffset!==0 && (
                  <button type="button" onClick={()=>setDailyDayOffset(0)}
                    style={{padding:"5px 14px",borderRadius:20,border:"1px solid var(--accent)",background:"transparent",color:"var(--accent)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                    היום
                  </button>
                )}
                {studentTrack && (
                  <button type="button" onClick={()=>setDailyMyLessons(v=>!v)}
                    style={{padding:"5px 14px",borderRadius:20,border:`1px solid ${dailyMyLessons?"var(--accent)":"var(--border)"}`,background:dailyMyLessons?"var(--accent)":"transparent",color:dailyMyLessons?"#000":"var(--text2)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                    השיעורים שלי
                  </button>
                )}
              </div>
              {sessions.length===0
                ? <div style={{textAlign:"center",color:"var(--text3)",fontSize:14,padding:"32px 0"}}>אין שיעורים מתוכננים ליום זה</div>
                : <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {sessions.map((s,i)=>(
                      <div key={i} style={{background:"var(--surface2)",borderRadius:10,padding:"14px 16px",borderRight:"4px solid var(--accent)"}}>
                        {/* שם השיעור */}
                        <div style={{fontWeight:900,fontSize:17,color:"var(--text)",marginBottom:6}}>{s.lessonName}</div>
                        {/* שעות — בולטות */}
                        {(s.startTime||s.endTime) && (
                          <div style={{fontWeight:800,fontSize:16,color:"var(--accent)",marginBottom:6}}>
                            🕐 {formatTime(s.startTime)}{s.endTime ? `–${formatTime(s.endTime)}` : ""}
                          </div>
                        )}
                        {/* שם מרצה — גדול וברור */}
                        {s.instructorName && (
                          <div style={{fontWeight:700,fontSize:15,color:"var(--text2)",marginBottom:s.studioName?2:s.track||s.topic?4:0}}>
                            👤 {s.instructorName}
                          </div>
                        )}
                        {/* שיוך כיתה — טקסט פשוט מתחת למרצה, על שורה משלו */}
                        {s.studioName && (
                          <div style={{display:"flex",alignItems:"center",gap:4,fontSize:15,fontWeight:700,color:"var(--text2)",marginBottom:s.track||s.topic?4:0}}>
                            <School size={15} strokeWidth={1.75} color="var(--accent)" /> כיתת לימוד: {s.studioName}
                          </div>
                        )}
                        {/* מסלול */}
                        {s.track && (
                          <div style={{display:"inline-block",fontSize:12,fontWeight:700,color:"var(--accent)",background:"var(--accent-glow)",borderRadius:20,padding:"2px 10px",marginBottom:s.topic?4:0}}>
                            <GraduationCap size={14} strokeWidth={1.75} color="var(--accent)" /> {s.track}
                          </div>
                        )}
                        {/* נושא */}
                        {s.topic && <div style={{fontSize:12,color:"var(--text3)"}}>📖 {s.topic}</div>}
                      </div>
                    ))}
                  </div>
              }
            </>;
          })()}
        </div>}
        {publicView==="my-bookings" && <div className="form-card-body" style={{direction:"rtl"}}>
          {/* ─── קביעות אולפן ─── */}
          <div style={{fontWeight:900,fontSize:15,marginBottom:12,paddingBottom:10,borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:6}}><Mic size={16} strokeWidth={1.75} color="var(--accent)" /> קביעות אולפן</div>
          {(()=>{
            const myBookings = studioBookings.filter(b=>{
              if (!b||!loggedInStudent) return false;
              if (b.bookingKind&&b.bookingKind!=="student") return false;
              const stEmail=String(loggedInStudent.email||"").toLowerCase().trim();
              const bEmail=String(b.studentEmail||"").toLowerCase().trim();
              if (stEmail&&bEmail) return stEmail===bEmail;
              return normalizeName(b.studentName||"")===normalizeName(loggedInStudent.name||"");
            }).sort((a,b)=>a.date>b.date?1:a.date<b.date?-1:(a.startTime||"")>(b.startTime||"")?1:-1);
            const NBST="21:30",NBET="08:00";
            const isFuture=b=>{const e=b.isNight?(()=>{const d=new Date(b.date);d.setDate(d.getDate()+1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;})():b.date;return new Date(`${e}T${b.endTime||"23:59"}:00`).getTime()>Date.now();};
            const futureOnes=myBookings.filter(isFuture);
            const handleCancel=async id=>{const updated=studioBookings.filter(b=>b.id!==id);setStudioBookings(updated);await deleteStudioBooking(id);showToast("success","ההזמנה בוטלה");};
            const handleSaveEdit=async()=>{
              if(!editingBooking) return;
              const{id,studioId,date,startTime,endTime}=editingBooking;
              if(!startTime||!endTime||startTime>=endTime){showToast("error","שעת סיום חייבת להיות אחרי שעת התחלה");return;}
              const editReq={studioId,date,startTime,endTime,isNight:false};
              const overlap=studioBookings.some(b=>String(b.studioId)===String(studioId)&&String(b.id)!==String(id)&&b.status!=="נדחה"&&rangesOverlap(b,editReq));
              if(overlap){showToast("error","קיימת הזמנה חופפת לשעות אלו");return;}
              const hoursLimit=getStudioFutureHoursLimit(siteSettings);
              const now=new Date();
              const otherFutureHours=studioBookings.reduce((sum,b)=>{
                if(b.id===id||b.status==="נדחה") return sum;
                const stEmail=String(loggedInStudent?.email||"").toLowerCase().trim();
                const bEmail=String(b.studentEmail||"").toLowerCase().trim();
                const isOwn=stEmail&&bEmail?stEmail===bEmail:normalizeName(b.studentName||"")===normalizeName(loggedInStudent?.name||"");
                if(!isOwn) return sum;
                return sum+getFutureStudioBookingHours(b,now,NBST,NBET);
              },0);
              const reqHours=getFutureStudioBookingHours({date,startTime,endTime,isNight:false},now,NBST,NBET);
              if(otherFutureHours+reqHours>hoursLimit+0.0001){showToast("error",`חרגת ממכסת השעות (${formatStudioHoursValue(hoursLimit)} שעות)`);return;}
              setEditBookingSaving(true);
              const updated=studioBookings.map(b=>b.id===id?{...b,startTime,endTime}:b);
              const updatedBooking = updated.find(b => b.id === id);
              setStudioBookings(updated);
              if (updatedBooking) {
                const res = await upsertStudioBooking(updatedBooking);
                if (res?.error === "studio_overlap") {
                  setStudioBookings(studioBookings); // revert optimistic edit
                  setEditBookingSaving(false);
                  showToast("error","קיימת כבר קביעה חופפת על החדר בזמנים הללו. רענן/י ונס/י שוב.");
                  return;
                }
              }
              setEditingBooking(null);
              setEditBookingSaving(false);
              showToast("success","ההזמנה עודכנה");
            };
            const renderRow=(b)=>{
              const studioObj=studios.find(s=>String(s.id)===String(b.studioId));
              const color=b.isNight?"#2196f3":"var(--green)";
              const timeLabel=b.isNight?`מ-21:30 והלאה`:`${formatTime(b.startTime)}–${formatTime(b.endTime)}`;
              const isEditing=editingBooking?.id===b.id;
              return (<div key={b.id} style={{background:"var(--surface2)",borderRadius:8,marginBottom:8,border:`1px solid ${color}33`,borderRight:`3px solid ${color}`,overflow:"hidden"}}>
                <div style={{padding:"12px 14px",display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,flexWrap:"wrap"}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:13}}>{studioObj?.name||"אולפן"}{b.isNight&&<span style={{color:"#2196f3",marginRight:4}}> 🌙</span>}</div>
                    <div style={{fontSize:12,color:"var(--text3)",marginTop:2,display:"flex",alignItems:"center",gap:4}}><Calendar size={12} strokeWidth={1.75} color="var(--accent)" /> {fmtDate(b.date)} · <Clock size={12} strokeWidth={1.75} color="var(--accent)" /> {timeLabel}</div>
                    {b.notes&&<div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>💬 {b.notes}</div>}
                  </div>
                  <div style={{display:"flex",gap:6,flexShrink:0}}>
                    {!b.isNight&&<button onClick={()=>setEditingBooking(isEditing?null:{id:b.id,studioId:b.studioId,date:b.date,startTime:b.startTime||"",endTime:b.endTime||""})} style={{background:isEditing?"var(--surface3)":"var(--accent)",color:isEditing?"var(--text)":"#000",border:"none",borderRadius:4,padding:"4px 10px",fontSize:11,fontWeight:700,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:3}}>{isEditing?<><X size={12} strokeWidth={1.75} color="var(--text3)" /> סגור</>:<><Pencil size={12} strokeWidth={1.75} color="var(--text3)" /> ערוך</>}</button>}
                    <button onClick={()=>handleCancel(b.id)} style={{background:"var(--red)",color:"#fff",border:"none",borderRadius:4,padding:"4px 10px",fontSize:11,fontWeight:700,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:3}}><XCircle size={12} strokeWidth={1.75} /> בטל</button>
                  </div>
                </div>
                {isEditing&&<div style={{padding:"12px 14px",borderTop:`1px solid ${color}33`,background:"var(--surface3)"}}>
                  <div style={{fontSize:12,fontWeight:700,marginBottom:10,color:"var(--text2)",display:"flex",alignItems:"center",gap:4}}><Pencil size={12} strokeWidth={1.75} color="var(--text3)" /> עריכת שעות — {fmtDate(b.date)}</div>
                  <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",marginBottom:12}}>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <label style={{fontSize:11,color:"var(--text3)",fontWeight:700}}>שעת התחלה</label>
                      <input type="time" value={editingBooking.startTime} onChange={e=>setEditingBooking(p=>({...p,startTime:e.target.value}))} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:6,padding:"6px 8px",color:"var(--text)",fontSize:13,fontWeight:700}}/>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <label style={{fontSize:11,color:"var(--text3)",fontWeight:700}}>שעת סיום</label>
                      <input type="time" value={editingBooking.endTime} onChange={e=>setEditingBooking(p=>({...p,endTime:e.target.value}))} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:6,padding:"6px 8px",color:"var(--text)",fontSize:13,fontWeight:700}}/>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={handleSaveEdit} disabled={editBookingSaving} style={{background:"var(--green)",color:"#fff",border:"none",borderRadius:6,padding:"7px 18px",fontSize:12,fontWeight:700,cursor:"pointer"}}>{editBookingSaving?"שומר...":"💾 שמור שינויים"}</button>
                    <button onClick={()=>setEditingBooking(null)} style={{background:"var(--surface)",color:"var(--text2)",border:"1px solid var(--border)",borderRadius:6,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>ביטול</button>
                  </div>
                </div>}
              </div>);
            };
            if (futureOnes.length===0) return <div style={{textAlign:"center",color:"var(--text3)",padding:"20px 0",fontSize:13}}>אין קביעות אולפן עתידיות</div>;
            return <>{futureOnes.map(b=>renderRow(b))}</>;
          })()}

          {/* ─── רשימת ציוד ─── */}
          <div style={{fontWeight:900,fontSize:15,marginTop:28,marginBottom:12,paddingBottom:10,borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:6}}><Package size={16} strokeWidth={1.75} color="var(--accent)" /> רשימת ציוד</div>
          {(()=>{
            const sColor=s=>s==="מאושר"?"#1a7a4a":s==="פעילה"?"#64b5f6":s==="ממתין"||s==="אישור ראש מחלקה"?"#b8860b":s==="נדחה"?"#c0392b":s==="באיחור"?"#e67e22":s==="הוחזר"?"#2471a3":"var(--text3)";
            const sBg=s=>s==="מאושר"?"rgba(46,204,113,0.15)":s==="פעילה"?"rgba(100,181,246,0.15)":s==="ממתין"||s==="אישור ראש מחלקה"?"rgba(241,196,15,0.15)":s==="נדחה"?"rgba(231,76,60,0.15)":s==="באיחור"?"rgba(230,126,34,0.18)":s==="הוחזר"?"rgba(52,152,219,0.15)":"var(--surface2)";
            const sBorder=s=>s==="מאושר"?"rgba(46,204,113,0.25)":s==="פעילה"?"rgba(100,181,246,0.3)":s==="ממתין"||s==="אישור ראש מחלקה"?"rgba(241,196,15,0.25)":s==="נדחה"?"rgba(231,76,60,0.3)":s==="באיחור"?"rgba(230,126,34,0.4)":s==="הוחזר"?"rgba(52,152,219,0.25)":"var(--border)";
            // The card header lays the action buttons out in a ROW next to the
            // dates. On a phone that row cannot fit — the card clips it
            // (overflow:hidden) and "− החסר פריטים" was cut off at the screen
            // edge once the update feature added a second button. Below 600px
            // (the breakpoint this file already uses for .info-detail-row) the
            // buttons stack into a COLUMN beside the date block instead, which
            // is space the header already occupies, and get phone-sized touch
            // targets. Desktop keeps the original row.
            const isMobile = typeof window !== "undefined" && window.innerWidth < 600;
            // No explicit width: the column is alignItems:"stretch", so every
            // button widens to the widest one on its own. Forcing width:100%
            // inside a shrink-to-fit column invites circular sizing.
            const hdrBtn = isMobile
              ? { padding:"10px 12px", fontSize:12, minHeight:36, justifyContent:"center" }
              : {};
            const hdrChip = isMobile ? { textAlign:"center", padding:"5px 10px" } : {};
            const myRes=[...reservations].filter(r=>{
              const stEmail=String(loggedInStudent?.email||"").toLowerCase().trim();
              const rEmail=String(r.email||"").toLowerCase().trim();
              if (stEmail&&rEmail) return stEmail===rEmail;
              return normalizeName(r.student_name||"")===normalizeName(loggedInStudent?.name||"");
            }).filter(r=>!["הוחזר","בוטל","מבוטל"].includes(getEffectiveStatus(r))).sort((a,b)=>(b.borrow_date||"")>(a.borrow_date||"")?1:-1);
            if (myRes.length===0) return <div style={{textAlign:"center",color:"var(--text3)",padding:"20px 0",fontSize:13}}>אין בקשות השאלה</div>;
            return myRes.map(r=>{
              const isExp=expandedResId===r.id;
              const st=getEffectiveStatus(r);
              // ── equipment-update gate for this card ──
              const updsForRes=reservationUpdates.filter(u=>String(u.reservation_id)===String(r.id));
              const updatesUsed=updsForRes.length;
              const pendingUpd=updsForRes.find(u=>u.review_status==="pending")||null;
              const updLead=getUpdateLeadTimeState(r);
              const updDeadline=computeUpdateDeadline(r);
              const isEditableStatus=(st==="ממתין"||st==="אישור ראש מחלקה"||st==="מאושר")&&r.loan_type!=="שיעור"&&r.booking_kind!=="lesson";
              const canStartUpdate=isEditableStatus&&!pendingUpd&&updatesUsed<MAX_RESERVATION_UPDATES&&updLead.allowed;
              const updateBlockReason=!isEditableStatus?""
                :pendingUpd?"עדכון קודם ממתין לבדיקת המחסן — לא ניתן לשלוח עדכון נוסף עד לסיום הבדיקה."
                :updatesUsed>=MAX_RESERVATION_UPDATES?"נוצלו 2 מתוך 2 העדכונים לבקשה זו. ניתן עדיין להחסיר פריטים."
                :!updLead.allowed?updLead.reason:"";
              const inUpdateDraft=!!updDraft&&String(updDraft.resId)===String(r.id);
              const cardBg=st==="פעילה"?"rgba(100,181,246,0.08)":st==="באיחור"?"rgba(230,126,34,0.08)":r.loan_type==="סאונד"?"rgba(245,166,35,0.06)":r.loan_type==="הפקה"?"rgba(52,152,219,0.06)":r.loan_type==="קולנוע יומית"?"rgba(52,152,219,0.08)":r.loan_type==="שיעור"?"rgba(155,89,182,0.1)":"var(--surface2)";
              const cardBorder=st==="פעילה"?"rgba(100,181,246,0.35)":st==="באיחור"?"rgba(230,126,34,0.45)":r.loan_type==="סאונד"?"rgba(245,166,35,0.25)":r.loan_type==="הפקה"?"rgba(52,152,219,0.25)":r.loan_type==="קולנוע יומית"?"rgba(52,152,219,0.3)":r.loan_type==="שיעור"?"rgba(155,89,182,0.3)":"var(--border)";
              return (<div key={r.id} style={{borderRadius:10,border:`1px solid ${cardBorder}`,marginBottom:10,overflow:"hidden"}}>
                <div style={{background:cardBg,padding:"12px 14px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:isMobile?"flex-start":"center",gap:8}} onClick={()=>setExpandedResId(isExp?null:r.id)}>
                  {/* minWidth:0 lets the date block wrap instead of pushing the
                      button column past the card edge. */}
                  <div style={{minWidth:0,flex:"1 1 auto"}}>
                    <div style={{fontWeight:700,fontSize:13}}>
                      <Calendar size={14} strokeWidth={1.75} color="var(--accent)" style={{flexShrink:0}} /> {fmtDate(r.borrow_date)}{r.borrow_time&&<span style={{color:"var(--accent)",marginRight:4}}> {formatTime(r.borrow_time)}</span>} ← {fmtDate(r.return_date)}{r.return_time&&<span style={{color:"var(--accent)",marginRight:4}}> {formatTime(r.return_time)}</span>}
                    </div>
                    <div style={{fontSize:13,color:"var(--text)",marginTop:4,fontWeight:700,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      <span>{r.loan_type&&<span style={{marginLeft:8,color:"var(--accent)"}}>{r.loan_type}</span>}{r.items?.length||0} פריטים</span>
                      {/* Update allowance at a glance. The full counter banner only
                          opens with the update draft, so these two dots are the
                          always-visible, low-noise version of the same information. */}
                      {isEditableStatus&&(()=>{
                        const used=updatesUsed, cUsed=used>=MAX_RESERVATION_UPDATES?"#e67e22":used===1?"#f5a623":"#2ecc71";
                        return (<span title={`בוצעו ${used} מתוך ${MAX_RESERVATION_UPDATES} עדכונים`} style={{display:"inline-flex",alignItems:"center",gap:4,flexShrink:0}}>
                          {[0,1].map(i=>(
                            <span key={i} style={{width:9,height:9,borderRadius:"50%",background:used>i?cUsed:"transparent",border:`1.5px solid ${used>i?cUsed:"rgba(245,166,35,0.5)"}`}}/>
                          ))}
                        </span>);
                      })()}
                    </div>
                  </div>
                  <div style={{display:"flex",flexDirection:isMobile?"column":"row",alignItems:isMobile?"stretch":"center",gap:isMobile?6:8,flexShrink:0,flexWrap:isMobile?"nowrap":"wrap",justifyContent:"flex-end"}}>
                    {pendingUpd&&<span style={{background:"rgba(230,126,34,0.16)",color:"#e67e22",border:"1px solid rgba(230,126,34,0.45)",borderRadius:100,padding:"2px 10px",fontSize:11,fontWeight:800,whiteSpace:"nowrap",...hdrChip}}>בדיקת עדכון</span>}
                    <span style={{background:sBg(st),color:sColor(st),border:`1px solid ${sBorder(st)}`,borderRadius:100,padding:"2px 10px",fontSize:11,fontWeight:700,whiteSpace:"nowrap",...hdrChip}}>{st}</span>
                    {isEditableStatus&&(()=>{
                      // Add-item entry point. Blocked states keep the button
                      // visible but disabled — the reason renders inside the
                      // expanded body (tooltips don't exist on mobile).
                      if(inUpdateDraft){
                        return (<button
                          onClick={e=>{e.stopPropagation();clearUpdateDraft(loggedInStudent?.email,r.id);setUpdDraft(null);setUpdPicker(null);}}
                          style={{background:"rgba(231,76,60,0.14)",color:"#e74c3c",border:"1px solid rgba(231,76,60,0.4)",borderRadius:4,padding:"3px 9px",fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",...hdrBtn}}
                        >בטל עדכון</button>);
                      }
                      return (<button
                        disabled={!canStartUpdate}
                        title={canStartUpdate?"":updateBlockReason}
                        onClick={e=>{
                          e.stopPropagation();
                          if(!canStartUpdate){ if(!isExp) setExpandedResId(r.id); return; }
                          // Re-open a saved draft for THIS reservation if one exists
                          // (a student may hold drafts on several reservations; only
                          // one auto-restores on load). Otherwise start fresh.
                          const saved=readUpdateDraftStore()[String(loggedInStudent?.email||"").toLowerCase().trim()]?.[String(r.id)];
                          const savedOps=Array.isArray(saved?.ops)?saved.ops.filter(o=>{
                            if(o.action==="add") return equipment.some(e2=>String(e2.id)===String(o.equipment_id));
                            if(o.action==="increase") return (r.items||[]).some(i=>Number(i.id)===Number(o.item_id));
                            return false;
                          }):[];
                          setUpdDraft({resId:String(r.id),ops:savedOps});
                          setRemovingItemsForResId(null);
                          if(!isExp) setExpandedResId(r.id);
                        }}
                        style={{
                          background:canStartUpdate?"rgba(46,204,113,0.14)":"var(--surface2)",
                          color:canStartUpdate?"#2ecc71":"var(--text3)",
                          border:canStartUpdate?"1px solid rgba(46,204,113,0.45)":"1px solid var(--border)",
                          borderRadius:4,padding:"3px 9px",fontSize:11,fontWeight:700,
                          cursor:canStartUpdate?"pointer":"not-allowed",whiteSpace:"nowrap",
                          opacity:canStartUpdate?1:0.6,
                          display:"inline-flex",alignItems:"center",...hdrBtn,
                        }}
                      >➕ הוסף פריטים</button>);
                    })()}
                    {(st==="ממתין"||st==="אישור ראש מחלקה"||st==="מאושר")&&r.loan_type!=="שיעור"&&r.booking_kind!=="lesson"&&(()=>{
                      const inRemoveMode=removingItemsForResId===r.id;
                      return (<button
                        onClick={e=>{
                          e.stopPropagation();
                          if(inRemoveMode){
                            setRemovingItemsForResId(null);
                          } else {
                            setRemovingItemsForResId(r.id);
                            setUpdDraft(null);
                            setUpdPicker(null);
                            if(!isExp) setExpandedResId(r.id);
                          }
                        }}
                        style={{
                          background:inRemoveMode?"rgba(231,76,60,0.24)":"rgba(231,76,60,0.14)",
                          color:"#e74c3c",
                          border:"1px solid rgba(231,76,60,0.48)",
                          borderRadius:4,
                          padding:inRemoveMode?"3px 9px":"4px 10px",
                          fontSize:11,
                          fontWeight:700,
                          cursor:"pointer",
                          whiteSpace:"nowrap",
                          display:"inline-flex",
                          alignItems:"center",
                          gap:3,
                          ...hdrBtn,
                        }}
                      >{inRemoveMode?"סיים":"− החסר פריטים"}</button>);
                    })()}
                    <span style={{fontSize:13,color:"var(--text3)",display:"inline-block",alignSelf:isMobile?"center":"auto",transform:isExp?"rotate(180deg)":"rotate(0deg)",transition:"transform 0.2s"}}>▾</span>
                  </div>
                </div>
                {isExp&&(() => {
                  // Production-cert reminder: for "הפקה" reservations, mark each
                  // equipment item that requires a cert which neither the
                  // photographer nor the sound person currently holds. The label
                  // disappears automatically once they pass that cert.
                  const isProduction = r.loan_type === "הפקה";
                  const photogRec = isProduction
                    ? matchCertificationStudentByNamePhone(r.crew_photographer_name, r.crew_photographer_phone)
                    : null;
                  const soundRec = isProduction && r.crew_sound_name
                    ? matchCertificationStudentByNamePhone(r.crew_sound_name, r.crew_sound_phone)
                    : null;
                  const photogResCerts = photogRec?.certs || {};
                  const soundResCerts = soundRec?.certs || {};
                  return (<div style={{padding:"12px 14px",borderTop:`1px solid ${sBorder(st)}`,display:"flex",flexDirection:"column",gap:10}}>
                  {/* ── update counter + status strip (prominent) ── */}
                  {isEditableStatus&&(()=>{
                    const usedUp=updatesUsed>=MAX_RESERVATION_UPDATES;
                    // Prominent counter banner: a 2-dot progress + bold text, colored
                    // by how many updates remain (green→amber→red).
                    const dotOn=updatesUsed>=1, dotOn2=updatesUsed>=2;
                    const accent=usedUp?"#e67e22":updatesUsed===1?"#f5a623":"#2ecc71";
                    return (<div style={{display:"flex",flexDirection:"column",gap:8}}>
                      {/* The full banner is heavy, so it is reserved for the moment
                          the student actually enters update mode ("הוסף פריטים").
                          Outside of that, the two dots beside the item count in the
                          card header carry the same allowance information. */}
                      {inUpdateDraft&&(
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",background:`${accent}14`,border:`1.5px solid ${accent}66`,borderRadius:10,padding:"10px 14px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <span style={{fontSize:20}}>🔁</span>
                          <div>
                            <div style={{fontSize:14,fontWeight:900,color:accent,lineHeight:1.2}}>
                              {usedUp?`נוצלו כל ${MAX_RESERVATION_UPDATES} העדכונים`:`בוצעו ${updatesUsed} מתוך ${MAX_RESERVATION_UPDATES} עדכונים`}
                            </div>
                            {/* The "X of 2" headline already carries the count —
                                a second line restating it read as noise. Kept
                                only for the used-up case, where it says what is
                                still possible rather than repeating the number. */}
                            {usedUp&&(
                              <div style={{fontSize:11,color:"var(--text3)",fontWeight:600,marginTop:2}}>
                                ניתן עדיין להחסיר פריטים בלבד
                              </div>
                            )}
                            {!usedUp&&(
                              <div style={{fontSize:11,color:"#f5a623",fontWeight:800,marginTop:5,display:"flex",alignItems:"center",gap:4}}>
                                <AlertTriangle size={12} strokeWidth={2.25} /> שים לב: הוספת פריטים נחשבת לעדכון.
                              </div>
                            )}
                            {/* When does the ability to update close? */}
                            {!usedUp&&!pendingUpd&&updLead.allowed&&updDeadline&&(
                              <div style={{fontSize:11,color:"#f5a623",fontWeight:800,marginTop:4,display:"flex",alignItems:"center",gap:4}}>
                                ⏳ ניתן להוסיף ולעדכן פריטים עד {fmtDate(updDeadline.date)} בשעה {updDeadline.time}
                              </div>
                            )}
                          </div>
                        </div>
                        {/* 2-dot progress indicator. The empty dot used var(--border),
                            which is nearly invisible on the dark panel — its outline is
                            now an accent tint so "how many are left" reads at a glance. */}
                        <div style={{display:"flex",gap:6,flexShrink:0}}>
                          <span style={{width:14,height:14,borderRadius:"50%",background:dotOn?accent:"transparent",border:`2px solid ${dotOn?accent:"rgba(245,166,35,0.55)"}`,boxShadow:dotOn?`0 0 0 2px ${accent}22`:"none"}}/>
                          <span style={{width:14,height:14,borderRadius:"50%",background:dotOn2?accent:"transparent",border:`2px solid ${dotOn2?accent:"rgba(245,166,35,0.55)"}`,boxShadow:dotOn2?`0 0 0 2px ${accent}22`:"none"}}/>
                        </div>
                      </div>
                      )}
                      {/* No "last update outcome" line: the student already gets a
                          full breakdown by email (approved / reduced / rejected +
                          the staff note), so repeating a one-word verdict here was
                          redundant noise on the card. */}
                      {!inUpdateDraft&&updateBlockReason&&(
                        <div style={{fontSize:12,color:"#e67e22",fontWeight:700,lineHeight:1.6,background:"rgba(230,126,34,0.08)",border:"1px solid rgba(230,126,34,0.3)",borderRadius:8,padding:"8px 12px"}}>
                          ⓘ {updateBlockReason}
                        </div>
                      )}
                    </div>);
                  })()}
                  {/* ── pending items panel ("פריטים בבדיקה") ── */}
                  {pendingUpd&&(pendingUpd.items||[]).filter(pi=>pi.review_state==="pending").length>0&&(
                    <div style={{border:"1px solid rgba(230,126,34,0.45)",background:"rgba(230,126,34,0.08)",borderRadius:8,padding:"10px 12px"}}>
                      <div style={{fontSize:12,fontWeight:800,color:"#e67e22",marginBottom:6}}>🕓 פריטים בבדיקה — ממתינים לאישור המחסן</div>
                      {(pendingUpd.items||[]).filter(pi=>pi.review_state==="pending").map(pi=>(
                        <div key={pi.id} style={{fontSize:12,color:"var(--text)",fontWeight:600,lineHeight:1.9}}>
                          {pi.action==="increase"
                            ?<>➕ {pi.name||"פריט"} — תוספת כמות: {pi.quantity}</>
                            :<>➕ {pi.name||"פריט"} — כמות: {pi.quantity}</>}
                        </div>
                      ))}
                      <div style={{fontSize:10,color:"var(--text3)",marginTop:6}}>הפריטים יתווספו לבקשה רק לאחר אישור צוות המחסן. הציוד המאושר שלך נשאר ללא שינוי.</div>
                    </div>
                  )}
                  {pendingUpd&&<div style={{fontSize:12,fontWeight:800,color:"var(--accent)"}}>✅ ציוד מאושר</div>}
                  {groupReservationItemsByCategory(r.items, equipment).map(group=>(
                  <div key={group.category} style={{display:"flex",flexDirection:"column",gap:10}}>
                  <div style={{fontSize:12,fontWeight:800,color:"var(--accent)",paddingTop:6}}>{group.category}</div>
                  {group.entries.map(({item,index:i})=>{
                    const eq=equipment.find(e=>String(e.id)===String(item.equipment_id));
                    const img=eq?.image;
                    const rKey=`${item.equipment_id}:${r.id}`;
                    const alreadyReported=reportedItems.has(rKey);
                    const needsCert = isProduction && eq?.certification_id &&
                      photogResCerts[eq.certification_id] !== "עבר" &&
                      soundResCerts[eq.certification_id] !== "עבר";
                    return (<div key={item.id ?? `${item.equipment_id}:${i}`}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        {img?.startsWith("data:")||img?.startsWith("http")
                          ?<img src={img} alt="" style={{width:38,height:38,objectFit:"cover",borderRadius:6,flexShrink:0}}/>
                          :<span style={{fontSize:30,flexShrink:0}}>{img||<Package size={30} strokeWidth={1.75} color="var(--accent)" />}</span>}
                        <div style={{flex:1}}>
                          <div style={{fontWeight:700,fontSize:13}}>{eq?.name||item.name||"פריט"}</div>
                          <div style={{fontSize:13,color:"var(--text)",fontWeight:700,marginTop:2,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                            <span>כמות: <span style={{color:"var(--accent)"}}>{item.quantity}</span></span>
                            {inUpdateDraft&&(()=>{
                              // Draft-mode control: stage +1 (increase) on an existing item.
                              const stagedInc=updDraft.ops.find(o=>o.action==="increase"&&Number(o.item_id)===Number(item.id));
                              const eqRow=equipment.find(e=>String(e.id)===String(item.equipment_id));
                              const canInc=eqRow?availForUpdate(r,eqRow,updDraft.ops)>0:false;
                              const privBlocked=r.loan_type==="פרטית"&&draftPrivateQty(r,updDraft.ops)>=4&&!(eqRow?.privateLoanUnlimited);
                              return (<>
                                <button
                                  type="button"
                                  disabled={!canInc||privBlocked}
                                  title={privBlocked?"אין לחרוג מ-4 פריטים בהשאלה פרטית":!canInc?"אין יחידות זמינות בתאריכים אלה":"הוסף יחידה (בטיוטה)"}
                                  onClick={e=>{e.stopPropagation();if(!canInc||privBlocked)return;stageDraftOp(r,{action:"increase",item_id:Number(item.id),target_eq_id:String(item.equipment_id),name:eqRow?.name||item.name||"פריט",quantity:1});}}
                                  style={{background:(!canInc||privBlocked)?"var(--surface2)":"rgba(46,204,113,0.14)",color:(!canInc||privBlocked)?"var(--text3)":"#2ecc71",border:(!canInc||privBlocked)?"1px solid var(--border)":"1px solid rgba(46,204,113,0.45)",borderRadius:6,width:22,height:22,padding:0,fontSize:14,fontWeight:700,cursor:(!canInc||privBlocked)?"not-allowed":"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",lineHeight:1,opacity:(!canInc||privBlocked)?0.5:1}}
                                >+</button>
                                {stagedInc&&<span style={{fontSize:11,fontWeight:800,color:"#2ecc71"}}>+{stagedInc.quantity} בטיוטה</span>}
                              </>);
                            })()}
                            {removingItemsForResId===r.id&&(st==="ממתין"||st==="אישור ראש מחלקה"||st==="מאושר")&&r.loan_type!=="שיעור"&&r.booking_kind!=="lesson"&&(()=>{
                              const itemBusy=busyItemIds.has(Number(item.id));
                              return (<button
                                disabled={itemBusy}
                                onClick={async e=>{
                                  e.stopPropagation();
                                  if(itemBusy) return;
                                  const itemName=eq?.name||item.name||"פריט";
                                  const qty=Number(item.quantity)||1;
                                  const isLastInReservation=(r.items||[]).length===1;
                                  if(qty>1){
                                    await callModifyReservationItem({reservation_id:String(r.id),item_id:Number(item.id),action:"decrement"});
                                  } else {
                                    setConfirmRemoveItem({
                                      reservationId:String(r.id),
                                      itemId:Number(item.id),
                                      itemName,
                                      isLastInReservation,
                                    });
                                  }
                                }}
                                style={{
                                  background:"rgba(231,76,60,0.14)",
                                  color:"#e74c3c",
                                  border:"1px solid rgba(231,76,60,0.4)",
                                  borderRadius:6,
                                  width:22,
                                  height:22,
                                  padding:0,
                                  fontSize:14,
                                  fontWeight:700,
                                  cursor:itemBusy?"not-allowed":"pointer",
                                  display:"inline-flex",
                                  alignItems:"center",
                                  justifyContent:"center",
                                  opacity:itemBusy?0.45:1,
                                  lineHeight:1,
                                }}
                                title="הורד יחידה"
                              ><Minus size={14} strokeWidth={2.5}/></button>);
                            })()}
                          </div>
                          {needsCert && (
                            <div style={{marginTop:4,display:"inline-flex",alignItems:"center",gap:4,fontSize:10,fontWeight:700,color:"#f59e0b",background:"rgba(245,158,11,0.12)",border:"1px solid rgba(245,158,11,0.35)",borderRadius:6,padding:"2px 8px"}}>
                              <Shield size={10} strokeWidth={2} /> דרושה הסמכה
                            </div>
                          )}
                        </div>
                        {st==="פעילה"&&<div style={{flexShrink:0}}>
                          {(() => {
                            const existing = myReports.get(rKey);
                            if (existing) {
                              return <button onClick={(e)=>{e.stopPropagation();setReportModal({equipmentId:String(item.equipment_id),equipmentName:eq?.name||item.name||"פריט",reservationId:String(r.id),reportId:existing.id,reportStatus:existing.status});setReportContent(existing.content||"");}} style={{background:"rgba(245,158,11,0.12)",color:"#f59e0b",border:"1px solid rgba(245,158,11,0.35)",borderRadius:6,padding:"3px 8px",fontSize:10,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:3}}><Pencil size={10} strokeWidth={1.75} /> ערוך דיווח</button>;
                            }
                            if (alreadyReported) {
                              return <span style={{fontSize:10,color:"var(--text3)",fontWeight:700,display:"inline-flex",alignItems:"center",gap:2}}><CheckCircle size={10} strokeWidth={1.75} /> דווח</span>;
                            }
                            return <button onClick={async(e)=>{e.stopPropagation();try{const res=await fetch("/api/equipment-report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"check-duplicate",equipment_id:String(item.equipment_id),reservation_id:String(r.id)})});const d=await res.json();if(d.exists){setReportedItems(p=>new Set([...p,rKey]));showToast("info","כבר נשלח דיווח על פריט זה");loadMyReports(reservations);return;}}catch{}setReportModal({equipmentId:String(item.equipment_id),equipmentName:eq?.name||item.name||"פריט",reservationId:String(r.id)});setReportContent("");}} style={{background:"rgba(231,76,60,0.12)",color:"#e74c3c",border:"1px solid rgba(231,76,60,0.3)",borderRadius:6,padding:"3px 8px",fontSize:10,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:3}}><AlertTriangle size={10} strokeWidth={1.75} /> דווח תקלה</button>;
                          })()}
                        </div>}
                      </div>
                    </div>);
                  })}
                  </div>
                  ))}
                  {/* ── update draft panel ── */}
                  {inUpdateDraft&&(
                    <div style={{border:"1.5px solid rgba(46,204,113,0.45)",background:"rgba(46,204,113,0.06)",borderRadius:10,padding:"12px 14px",display:"flex",flexDirection:"column",gap:8}}>
                      <div style={{fontSize:13,fontWeight:800,color:"#2ecc71"}}>📝 טיוטת עדכון — {updDraft.ops.length===0?"עדיין לא נוספו שינויים":`${updDraft.ops.length} שינויים`}</div>
                      {updDraft.ops.map((o,oi)=>{
                        // Resolve the equipment (image + name) for both op kinds:
                        // add carries equipment_id, increase carries target_eq_id.
                        const opEqId=o.action==="increase"?o.target_eq_id:o.equipment_id;
                        const opEq=equipment.find(e=>String(e.id)===String(opEqId));
                        const opImg=opEq?.image;
                        return (<div key={oi} style={{display:"flex",alignItems:"center",gap:10,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:8,padding:"8px 10px"}}>
                          {opImg?.startsWith("data:")||opImg?.startsWith("http")
                            ?<img src={opImg} alt="" style={{width:36,height:36,objectFit:"cover",borderRadius:6,flexShrink:0}}/>
                            :<span style={{width:36,height:36,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{opImg||<Package size={26} strokeWidth={1.75} color="var(--accent)"/>}</span>}
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontWeight:800,fontSize:13,color:"var(--text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{opEq?.name||o.name||"פריט"}</div>
                            <div style={{fontSize:10,fontWeight:700,color:o.action==="increase"?"#f5a623":"#2ecc71"}}>
                              {o.action==="increase"?"הגדלת כמות לפריט קיים":"פריט חדש בבקשה"}
                            </div>
                          </div>
                          <span style={{fontSize:13,fontWeight:900,color:"var(--accent)",background:"var(--accent-glow)",border:"1px solid rgba(245,166,35,0.3)",borderRadius:8,padding:"3px 10px",flexShrink:0,whiteSpace:"nowrap"}}>כמות: {o.quantity}</span>
                          <button type="button" onClick={e=>{e.stopPropagation();setUpdDraft(prev=>prev?{...prev,ops:prev.ops.filter((_,i)=>i!==oi)}:prev);}}
                            style={{background:"rgba(231,76,60,0.12)",color:"#e74c3c",border:"1px solid rgba(231,76,60,0.35)",borderRadius:6,width:24,height:24,padding:0,fontSize:12,cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}
                            title="הסר מהטיוטה"><X size={13} strokeWidth={2}/></button>
                        </div>);
                      })}
                      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:2}}>
                        <button type="button"
                          onClick={e=>{e.stopPropagation();setUpdPickerSearch("");setUpdPickerType("all");setUpdPickerCats([]);setUpdPicker({resId:String(r.id),mode:"add"});}}
                          style={{background:"rgba(46,204,113,0.14)",color:"#2ecc71",border:"1px solid rgba(46,204,113,0.45)",borderRadius:8,padding:"8px 14px",fontSize:12,fontWeight:800,cursor:"pointer"}}
                        >➕ הוסף פריט חדש</button>
                        <button type="button"
                          disabled={updDraft.ops.length===0||updSubmitting}
                          onClick={e=>{e.stopPropagation();if(updDraft.ops.length===0)return;setConfirmSubmitUpdate({resId:String(r.id)});}}
                          style={{background:updDraft.ops.length===0?"var(--surface2)":"var(--accent)",color:updDraft.ops.length===0?"var(--text3)":"#000",border:"none",borderRadius:8,padding:"8px 16px",fontSize:12,fontWeight:900,cursor:updDraft.ops.length===0?"not-allowed":"pointer",opacity:updDraft.ops.length===0?0.6:1}}
                        >📤 עדכן בקשה</button>
                      </div>
                      <div style={{display:"flex",alignItems:"flex-start",gap:8,background:"rgba(245,166,35,0.1)",border:"1.5px solid rgba(245,166,35,0.4)",borderRadius:8,padding:"10px 12px",marginTop:2}}>
                        <span style={{fontSize:16,flexShrink:0,lineHeight:1.3}}>⚠️</span>
                        <div style={{fontSize:12,color:"var(--text)",lineHeight:1.7,fontWeight:600}}>
                          <div>השינויים נשמרים כ<b>טיוטה</b> עד הלחיצה על <b>"עדכן בקשה"</b>.</div>
                          <div style={{color:"#f5a623",fontWeight:800,marginTop:2}}>שליחת עדכון היא סופית ונספרת במונה.</div>
                        </div>
                      </div>
                    </div>
                  )}
                  {removingItemsForResId===r.id && (r.items?.length||0)>0 && (
                    <button
                      type="button"
                      disabled={busyItemIds.has(`res:${r.id}`)}
                      onClick={e=>{e.stopPropagation();setConfirmCancelReservation({reservationId:String(r.id)});}}
                      style={{
                        marginTop:8,
                        alignSelf:"stretch",
                        padding:"12px 18px",
                        border:"1.5px solid #e74c3c",
                        borderRadius:10,
                        background:"rgba(231,76,60,0.12)",
                        color:"#e74c3c",
                        fontWeight:800,
                        fontSize:14,
                        cursor:busyItemIds.has(`res:${r.id}`)?"not-allowed":"pointer",
                        opacity:busyItemIds.has(`res:${r.id}`)?0.6:1,
                        display:"inline-flex",
                        alignItems:"center",
                        justifyContent:"center",
                        gap:8,
                      }}
                    >
                      <Trash2 size={16} strokeWidth={1.75} /> ביטול הבקשה
                    </button>
                  )}
                </div>);
                })()}
              </div>);
            });
          })()}
        </div>}
        <div style={{padding:"16px 24px",borderTop:"1px solid var(--border)",textAlign:"center"}}>
          <button
            type="button"
            onClick={() => { supabase.auth.signOut().catch(()=>{}); setLoggedInStudent(null); setAuthView("login"); setLoginEmail(""); setLoginPassword(""); sessionStorage.removeItem("public_view"); sessionStorage.removeItem("public_student_roles"); sessionStorage.removeItem("active_role"); clearFormDraft(); }}
            style={{background:"rgba(231,76,60,0.12)",border:"1px solid rgba(231,76,60,0.4)",color:"#e74c3c",fontSize:13,cursor:"pointer",padding:"8px 20px",borderRadius:8,transition:"all 0.15s",fontWeight:600}}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(231,76,60,0.22)";e.currentTarget.style.borderColor="#e74c3c";}}
            onMouseLeave={e=>{e.currentTarget.style.background="rgba(231,76,60,0.12)";e.currentTarget.style.borderColor="rgba(231,76,60,0.4)";}}
          >
            ← חזרה לדף הכניסה
          </button>
        </div>
      </div>
    </div>
    {/* ── equipment picker for the update draft (add only) ── */}
    {updPicker&&(()=>{
      const rRow=reservations.find(x=>String(x.id)===String(updPicker.resId));
      if(!rRow||!updDraft||String(updDraft.resId)!==String(updPicker.resId)){ return null; }
      const pickerDraftOps=updDraft.ops;
      // Production-kit gate: a production tied to a kit may only pick kit items.
      const prodKit=(()=>{
        if(rRow.loan_type!=="הפקה"||!rRow.production_id) return null;
        const p=(productions||[]).find(x=>String(x.id)===String(rRow.production_id));
        if(!p?.kitId) return null;
        return (kits||[]).find(k=>String(k.id)===String(p.kitId))||null;
      })();
      const kitEqIds=prodKit?new Set((prodKit.items||[]).map(i=>String(i.equipment_id))):null;
      const searchLc=updPickerSearch.trim().toLowerCase();
      const privAtCap=rRow.loan_type==="פרטית"&&draftPrivateQty(rRow,updDraft.ops)>=4;

      // Same classification model the creation form uses (Step3Equipment):
      // loan-type → allowed classifications → sound/photo type filter + category chips.
      const allowedClass=getLoanTypeEquipmentClassifications(rRow.loan_type,categoryLoanTypes);
      const enabledTypeFilters=["סאונד","צילום"].filter(c=>allowedClass.includes(c));
      const showTypeFilters=enabledTypeFilters.length>1;
      const matchesTypeFilter=(eq)=>{
        const isGeneral=(!eq.soundOnly&&!eq.photoOnly)||(eq.soundOnly&&eq.photoOnly);
        if(!showTypeFilters||updPickerType==="all") return true;
        if(updPickerType==="sound") return !!eq.soundOnly||isGeneral;
        if(updPickerType==="photo") return !!eq.photoOnly||isGeneral;
        return true;
      };
      // Pool eligible for THIS loan (before search / category / type filters) —
      // the source both the category chips and the item list derive from.
      const loanPool=equipment.filter(eq=>{
        if(!matchesEquipmentLoanType(eq,rRow.loan_type,categoryLoanTypes)) return false;
        if(EXTERNAL_LOAN_TYPES.includes(rRow.loan_type)&&eq.externalLoanRestricted) return false;
        if(!canBorrowEqForForm({loan_type:rRow.loan_type},eq)) return false;
        if(kitEqIds&&!kitEqIds.has(String(eq.id))) return false;
        return true;
      });
      // Category chips derive from the type-filtered pool (chips must agree with
      // the list — lesson #34), ordered by the admin `categories` list.
      const typePool=loanPool.filter(matchesTypeFilter);
      const chipCategories=deriveVisibleCategories(categories,typePool);
      const eligible=typePool.filter(eq=>{
        if(updPickerCats.length&&!updPickerCats.includes(eq.category)) return false;
        if(searchLc&&!String(eq.name||"").toLowerCase().includes(searchLc)) return false;
        return true;
      });
      const pick=(eq)=>{
        const avail=availForUpdate(rRow,eq,pickerDraftOps);
        if(avail<=0) return;
        if(privAtCap&&!eq.privateLoanUnlimited){ showToast("error","שים לב אין לחרוג מ-4 פריטים בהשאלה פרטית"); return; }
        // clicking an equipment already staged as `add` bumps its quantity
        const existing=updDraft.ops.find(o=>o.action==="add"&&String(o.equipment_id)===String(eq.id));
        if(existing){
          setUpdDraft(prev=>prev?{...prev,ops:prev.ops.map(o=>o===existing?{...o,quantity:o.quantity+1}:o)}:prev);
        } else {
          stageDraftOp(rRow,{action:"add",equipment_id:String(eq.id),name:eq.name,quantity:1});
        }
      };
      return (<div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setUpdPicker(null)}>
        <div className="modal" style={{maxWidth:760,width:"94vw"}}>
          <div className="modal-header">
            <span className="modal-title" style={{display:"inline-flex",alignItems:"center",gap:6}}>
              ➕ הוספת פריט לבקשה
            </span>
            <button className="btn btn-secondary btn-sm btn-icon" onClick={()=>setUpdPicker(null)}>
              <X size={16} strokeWidth={1.75} color="var(--text3)"/>
            </button>
          </div>
          <div className="modal-body" style={{direction:"rtl",maxHeight:"70vh",overflowY:"auto"}}>
            <input
              type="text"
              value={updPickerSearch}
              onChange={e=>setUpdPickerSearch(e.target.value)}
              placeholder="חיפוש ציוד…"
              style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid var(--border)",background:"var(--surface2)",color:"var(--text)",fontSize:14,marginBottom:10,boxSizing:"border-box"}}
            />
            {/* type filter (sound / photo) — only when the loan type allows both */}
            {showTypeFilters&&(
              <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:8}}>
                <span style={{fontSize:11,fontWeight:900,color:"var(--text3)",marginLeft:2}}>סוג ציוד:</span>
                {[
                  {key:"all",label:<><Package size={12} strokeWidth={1.75}/> הכל</>,en:true},
                  {key:"sound",label:<><Mic size={12} strokeWidth={1.75}/> סאונד</>,en:enabledTypeFilters.includes("סאונד")},
                  {key:"photo",label:<><Camera size={12} strokeWidth={1.75}/> צילום</>,en:enabledTypeFilters.includes("צילום")},
                ].filter(o=>o.key==="all"||o.en).map(o=>{
                  const active=updPickerType===o.key;
                  return (<button key={o.key} type="button" onClick={()=>{setUpdPickerType(o.key);setUpdPickerCats([]);}}
                    style={{padding:"6px 12px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"rgba(148,163,184,0.34)"}`,background:active?"var(--accent)":"rgba(18,24,34,0.9)",color:active?"#0b0f14":"#dbe7ff",fontWeight:900,fontSize:11,cursor:"pointer",whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:4}}>
                    {o.label}
                  </button>);
                })}
              </div>
            )}
            {/* category chips */}
            {chipCategories.length>0&&(
              <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:10,paddingTop:8,borderTop:"1px solid rgba(148,163,184,0.18)"}}>
                <span style={{fontSize:11,fontWeight:900,color:"var(--text3)",marginLeft:2}}>קטגוריות:</span>
                {chipCategories.map(cat=>{
                  const active=updPickerCats.includes(cat);
                  return (<button key={cat} type="button" onClick={()=>setUpdPickerCats(prev=>prev.includes(cat)?prev.filter(c=>c!==cat):[...prev,cat])}
                    style={{padding:"5px 10px",borderRadius:20,border:`1.5px solid ${active?"var(--accent)":"rgba(148,163,184,0.32)"}`,background:active?"rgba(245,166,35,0.16)":"rgba(18,24,34,0.88)",color:active?"var(--accent)":"#dbe7ff",fontWeight:800,fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}>
                    {cat}
                  </button>);
                })}
                {updPickerCats.length>0&&(
                  <button type="button" onClick={()=>setUpdPickerCats([])}
                    style={{padding:"4px 8px",borderRadius:20,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:11,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:3}}>
                    <X size={13} strokeWidth={1.75} color="var(--text3)"/> נקה
                  </button>
                )}
              </div>
            )}
            {prodKit&&<div style={{fontSize:11,color:"#3498db",fontWeight:700,marginBottom:8}}>🎬 הפקה עם ערכה — ניתן לבחור רק ציוד מתוך "{prodKit.name}"</div>}
            <div style={{fontSize:10,color:"var(--text3)",marginBottom:8}}>לחיצה על פריט מוסיפה אותו לטיוטה · לחצני − / + לשינוי הכמות</div>
            {eligible.length===0
              ?<div style={{textAlign:"center",color:"var(--text3)",padding:"18px 0",fontSize:13}}>לא נמצא ציוד מתאים</div>
              :<div style={{display:"flex",flexDirection:"column",gap:6}}>
                {eligible.map(eq=>{
                  const avail=availForUpdate(rRow,eq,pickerDraftOps);
                  const img=eq.image;
                  const privBlockedEq=privAtCap&&!eq.privateLoanUnlimited;
                  const stagedAdd=updDraft.ops.find(o=>o.action==="add"&&String(o.equipment_id)===String(eq.id));
                  // A staged row stays interactive even at avail 0 — the − button
                  // must keep working; only ADDING more is capped.
                  const blocked=(avail<1&&!stagedAdd)||privBlockedEq;
                  const canAddMore=avail>0&&!privBlockedEq;
                  const decStaged=()=>{
                    setUpdDraft(prev=>prev?{...prev,ops:prev.ops.flatMap(o=>
                      o!==stagedAdd?[o]:(o.quantity<=1?[]:[{...o,quantity:o.quantity-1}])
                    )}:prev);
                  };
                  // div (not button): the staged row nests real +/− buttons,
                  // and nested <button> inside <button> is invalid HTML.
                  return (<div key={eq.id} role="button" tabIndex={blocked?-1:0}
                    onClick={()=>{if(blocked||(stagedAdd&&!canAddMore))return;pick(eq);}}
                    onKeyDown={e=>{if((e.key==="Enter"||e.key===" ")&&!blocked&&!(stagedAdd&&!canAddMore)){e.preventDefault();pick(eq);}}}
                    style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:8,border:stagedAdd?"1.5px solid rgba(46,204,113,0.55)":"1px solid var(--border)",background:stagedAdd?"rgba(46,204,113,0.08)":"var(--surface2)",cursor:blocked?"not-allowed":"pointer",opacity:blocked?0.45:1,textAlign:"right",width:"100%",boxSizing:"border-box"}}>
                    {img?.startsWith("data:")||img?.startsWith("http")
                      ?<img src={img} alt="" style={{width:34,height:34,objectFit:"cover",borderRadius:6,flexShrink:0}}/>
                      :<span style={{fontSize:24,flexShrink:0}}>{img||<Package size={24} strokeWidth={1.75} color="var(--accent)"/>}</span>}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:13,color:"var(--text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{eq.name}</div>
                      <div style={{fontSize:11,color:avail>0?"var(--text3)":"#e74c3c",fontWeight:600}}>{eq.category||""} · זמין: {avail}</div>
                    </div>
                    {stagedAdd&&(
                      /* explicit − ×N + stepper — surfaces the moment the item
                         is staged, so adding more units is one obvious tap */
                      <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}} onClick={e=>e.stopPropagation()}>
                        <button type="button" onClick={decStaged} title="הורד יחידה מהטיוטה" className="upd-step-btn"
                          style={{background:"rgba(231,76,60,0.14)",color:"#e74c3c",border:"1px solid rgba(231,76,60,0.4)",borderRadius:8,width:28,height:28,padding:0,fontSize:16,fontWeight:900,cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",lineHeight:1}}
                        >−</button>
                        <span style={{fontSize:13,fontWeight:900,color:"#2ecc71",minWidth:26,textAlign:"center"}}>×{stagedAdd.quantity}</span>
                        <button type="button" disabled={!canAddMore} onClick={()=>pick(eq)} className="upd-step-btn"
                          title={canAddMore?"הוסף יחידה":privBlockedEq?"אין לחרוג מ-4 פריטים בהשאלה פרטית":"אין יחידות זמינות נוספות"}
                          style={{background:canAddMore?"#2ecc71":"var(--surface3)",color:canAddMore?"#0b0f14":"var(--text3)",border:"none",borderRadius:8,width:28,height:28,padding:0,fontSize:16,fontWeight:900,cursor:canAddMore?"pointer":"not-allowed",display:"inline-flex",alignItems:"center",justifyContent:"center",lineHeight:1,opacity:canAddMore?1:0.5}}
                        >+</button>
                      </div>
                    )}
                  </div>);
                })}
              </div>}
          </div>
        </div>
      </div>);
    })()}
    {/* ── final-commit confirmation: submission is counted and irreversible ── */}
    {confirmSubmitUpdate&&updDraft&&(()=>{
      const rRow=reservations.find(x=>String(x.id)===String(confirmSubmitUpdate.resId));
      if(!rRow) return null;
      const usedSoFar=reservationUpdates.filter(u=>String(u.reservation_id)===String(rRow.id)).length;
      const isApprovedRes=getEffectiveStatus(rRow)==="מאושר";
      return (<div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&!updSubmitting&&setConfirmSubmitUpdate(null)}>
        <div className="modal" style={{maxWidth:440}}>
          <div className="modal-header">
            <span className="modal-title" style={{display:"inline-flex",alignItems:"center",gap:6}}>
              <AlertTriangle size={16} strokeWidth={1.75} color="#f59e0b"/> שליחת עדכון בקשה
            </span>
            <button className="btn btn-secondary btn-sm btn-icon" disabled={updSubmitting} onClick={()=>setConfirmSubmitUpdate(null)}>
              <X size={16} strokeWidth={1.75} color="var(--text3)"/>
            </button>
          </div>
          <div className="modal-body" style={{direction:"rtl"}}>
            <div style={{fontSize:13,lineHeight:1.7,marginBottom:10}}>
              {updDraft.ops.map((o,oi)=>(
                <div key={oi} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,fontWeight:700,padding:"3px 0"}}>
                  <span>{o.action==="increase"?"⬆️ הגדלת כמות":"➕ הוספת פריט"} — <b>{o.name||"פריט"}</b></span>
                  <span style={{color:"var(--accent)",fontWeight:900,whiteSpace:"nowrap"}}>כמות: {o.quantity}</span>
                </div>
              ))}
            </div>
            <div style={{fontSize:12,color:"#e67e22",fontWeight:700,lineHeight:1.7,background:"rgba(230,126,34,0.08)",border:"1px solid rgba(230,126,34,0.35)",borderRadius:8,padding:"10px 12px"}}>
              ⚠️ שליחת העדכון היא סופית ונספרת במונה ({usedSoFar+1} מתוך {MAX_RESERVATION_UPDATES}).
              {isApprovedRes&&<><br/>הפריטים יעברו לבדיקת צוות המחסן ויתווספו רק לאחר אישור.</>}
            </div>
          </div>
          <div className="modal-footer" style={{display:"flex",gap:8,justifyContent:"flex-start"}}>
            <button className="btn btn-primary" disabled={updSubmitting} onClick={submitUpdateDraft}>
              {updSubmitting?"שולח…":"📤 עדכן בקשה"}
            </button>
            <button className="btn btn-secondary" disabled={updSubmitting} onClick={()=>setConfirmSubmitUpdate(null)}>חזרה לעריכה</button>
          </div>
        </div>
      </div>);
    })()}
    {confirmRemoveItem&&(()=>{
      const modalBusy=busyItemIds.has(confirmRemoveItem.isLastInReservation?`res:${confirmRemoveItem.reservationId}`:Number(confirmRemoveItem.itemId));
      return (<div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&!modalBusy&&setConfirmRemoveItem(null)}>
      <div className="modal" style={{maxWidth:420}}>
        <div className="modal-header">
          <span className="modal-title" style={{display:"inline-flex",alignItems:"center",gap:6}}>
            <AlertTriangle size={16} strokeWidth={1.75} color={confirmRemoveItem.isLastInReservation?"#e74c3c":"#f59e0b"}/>
            {confirmRemoveItem.isLastInReservation?"ביטול הזמנה":"הסרת פריט"}
          </span>
          <button className="btn btn-secondary btn-sm btn-icon" disabled={modalBusy} onClick={()=>setConfirmRemoveItem(null)}>
            <X size={16} strokeWidth={1.75} color="var(--text3)"/>
          </button>
        </div>
        <div className="modal-body" style={{direction:"rtl"}}>
          {confirmRemoveItem.isLastInReservation
            ? <div style={{fontSize:14,lineHeight:1.6}}>
                <span style={{fontWeight:700}}>{confirmRemoveItem.itemName}</span> הוא הפריט האחרון בהזמנה.
                <br/>הסרתו תבטל את כל ההזמנה. האם להמשיך?
              </div>
            : <div style={{fontSize:14,lineHeight:1.6}}>
                האם אתה רוצה להוריד את הפריט <span style={{fontWeight:700}}>{confirmRemoveItem.itemName}</span> מהרשימה?
              </div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" disabled={modalBusy} onClick={()=>setConfirmRemoveItem(null)}>
            {confirmRemoveItem.isLastInReservation?"השאר את ההזמנה":"ביטול"}
          </button>
          <button
            className="btn btn-primary"
            disabled={modalBusy}
            style={{background:"#e74c3c",borderColor:"#e74c3c"}}
            onClick={async()=>{
              const c=confirmRemoveItem;
              const result=await callModifyReservationItem({
                reservation_id:c.reservationId,
                item_id:c.itemId,
                action:c.isLastInReservation?"cancel_reservation":"remove",
              });
              if(result){
                showToast("success", c.isLastInReservation?"ההזמנה בוטלה":"הפריט הוסר");
                if(c.isLastInReservation) setRemovingItemsForResId(null);
              }
              setConfirmRemoveItem(null);
            }}
          >{modalBusy?"מעדכן...":confirmRemoveItem.isLastInReservation?"בטל את ההזמנה":"הסר פריט"}</button>
        </div>
      </div>
    </div>);
    })()}
    {confirmCancelReservation && (() => {
      const modalBusy = busyItemIds.has(`res:${confirmCancelReservation.reservationId}`);
      return (<div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&!modalBusy&&setConfirmCancelReservation(null)}>
        <div className="modal" style={{maxWidth:420}}>
          <div className="modal-header">
            <span className="modal-title" style={{display:"inline-flex",alignItems:"center",gap:6}}>
              <AlertTriangle size={16} strokeWidth={1.75} color="#e74c3c"/>
              ביטול הבקשה
            </span>
            <button className="btn btn-secondary btn-sm btn-icon" disabled={modalBusy} onClick={()=>setConfirmCancelReservation(null)}>
              <X size={16} strokeWidth={1.75} color="var(--text3)"/>
            </button>
          </div>
          <div className="modal-body" style={{direction:"rtl",fontSize:14,lineHeight:1.6}}>
            האם אתה בטוח שאתה רוצה לבטל את בקשת ההשאלה?
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" disabled={modalBusy} onClick={()=>setConfirmCancelReservation(null)}>
              חזרה
            </button>
            <button
              className="btn btn-primary"
              disabled={modalBusy}
              style={{background:"#e74c3c",borderColor:"#e74c3c"}}
              onClick={async()=>{
                const c=confirmCancelReservation;
                const result=await callModifyReservationItem({
                  reservation_id:c.reservationId,
                  item_id:0,
                  action:"cancel_reservation",
                });
                if(result){
                  showToast("success","הבקשה בוטלה");
                  setRemovingItemsForResId(null);
                }
                setConfirmCancelReservation(null);
              }}
            >{modalBusy?"מבטל...":"ביטול"}</button>
          </div>
        </div>
      </div>);
    })()}
    {reportModal&&<div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setReportModal(null)}>
      <div className="modal" style={{maxWidth:420}}>
        <div className="modal-header"><span className="modal-title" style={{display:"inline-flex",alignItems:"center",gap:4}}><AlertTriangle size={16} strokeWidth={1.75} /> {reportModal.reportId ? "עריכת דיווח על תקלה" : "דיווח על תקלה"}</span><button className="btn btn-secondary btn-sm btn-icon" onClick={()=>setReportModal(null)}><X size={16} strokeWidth={1.75} color="var(--text3)" /></button></div>
        <div className="modal-body" style={{direction:"rtl"}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:8,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span>פריט: {reportModal.equipmentName}</span>
            {reportModal.reportStatus === "handled" && (
              <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:10,background:"rgba(107,114,128,0.18)",color:"#6b7280",display:"inline-flex",alignItems:"center",gap:3}}>
                <CheckCircle size={10} strokeWidth={1.75}/> סומן כטופל ע״י המחסנאי
              </span>
            )}
          </div>
          <div style={{marginBottom:6,fontWeight:700,fontSize:12,color:"var(--text2)"}}>תאר את התקלה:</div>
          <textarea value={reportContent} onChange={e=>{if(e.target.value.length<=400)setReportContent(e.target.value);}} placeholder="תאר את מצב הפריט..." rows={4} style={{width:"100%",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:8,padding:10,color:"var(--text)",fontSize:13,resize:"vertical",fontFamily:"inherit"}}/>
          <div style={{textAlign:"left",fontSize:11,color:reportContent.length>380?"var(--red)":"var(--text3)",marginTop:4}}>{reportContent.length}/400</div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={()=>setReportModal(null)}>ביטול</button>
          <button className="btn btn-primary" disabled={reportSending||!reportContent.trim()} style={{background:reportModal.reportId?"#f59e0b":"#e74c3c",borderColor:reportModal.reportId?"#f59e0b":"#e74c3c"}} onClick={async()=>{
            setReportSending(true);
            try{
              const isEdit = !!reportModal.reportId;
              const token  = isEdit ? await getAuthToken() : null;
              const body   = isEdit
                ? { action:"update", id:reportModal.reportId, content:reportContent.trim() }
                : { action:"create", equipment_id:reportModal.equipmentId, student_name:loggedInStudent?.name||"", reservation_id:reportModal.reservationId, content:reportContent.trim() };
              const res = await fetch("/api/equipment-report",{
                method:"POST",
                headers:{"Content-Type":"application/json", ...(isEdit && token ? { Authorization:`Bearer ${token}` } : {})},
                body:JSON.stringify(body),
              });
              const d = await res.json().catch(()=>({}));
              if (isEdit) {
                if (d.ok) { showToast("success","הדיווח עודכן"); await loadMyReports(reservations); }
                else { showToast("error", res.status===403?"אין הרשאה":res.status===409?"ההזמנה כבר לא פעילה":"שגיאה בעדכון"); }
              } else {
                if (d.error==="duplicate") { showToast("info","כבר נשלח דיווח על פריט זה"); setReportedItems(p=>new Set([...p,`${reportModal.equipmentId}:${reportModal.reservationId}`])); await loadMyReports(reservations); }
                else if (d.ok) { showToast("success","הדיווח נשלח בהצלחה"); setReportedItems(p=>new Set([...p,`${reportModal.equipmentId}:${reportModal.reservationId}`])); await loadMyReports(reservations); }
                else { showToast("error","שגיאה בשליחת הדיווח"); }
              }
            }catch{showToast("error","שגיאה בשליחת הדיווח");}
            setReportSending(false);setReportModal(null);
          }}>{reportSending?"שולח...":(reportModal.reportId?"💾 שמור שינויים":"📨 שלח דיווח")}</button>
        </div>
      </div>
    </div>}
    {overlapBlock && (
      <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setOverlapBlock(null)}>
        <div className="modal" style={{maxWidth:440}}>
          <div className="modal-header">
            <span className="modal-title" style={{display:"inline-flex",alignItems:"center",gap:6,color:"var(--red)"}}>
              <AlertTriangle size={18} strokeWidth={1.75} /> בקשת השאלה חופפת
            </span>
            <button className="btn btn-secondary btn-sm btn-icon" onClick={()=>setOverlapBlock(null)}><X size={16} strokeWidth={1.75} color="var(--text3)" /></button>
          </div>
          <div className="modal-body" style={{direction:"rtl",fontSize:14,lineHeight:1.6}}>
            <p style={{margin:"0 0 12px"}}>
              כבר קיימת בקשת השאלה עם השם שלך בזמנים הללו. עליך קודם לבטל אותה על מנת ליצור בקשת השאלה חדשה עם כלל הציוד המבוקש.
            </p>
            {typeof overlapBlock === "object" && overlapBlock && (
              <div style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"10px 14px",fontSize:13,marginBottom:12}}>
                {overlapBlock.project_name && <div style={{fontWeight:700,marginBottom:2}}>{overlapBlock.project_name}</div>}
                <div style={{color:"var(--text2)"}}>
                  {overlapBlock.loan_type ? `${overlapBlock.loan_type} · ` : ""}
                  {overlapBlock.borrow_date === overlapBlock.return_date
                    ? `${formatDate(overlapBlock.borrow_date)} · ${formatTime(overlapBlock.borrow_time)}–${formatTime(overlapBlock.return_time)}`
                    : `${formatDate(overlapBlock.borrow_date)} ${formatTime(overlapBlock.borrow_time)} עד ${formatDate(overlapBlock.return_date)} ${formatTime(overlapBlock.return_time)}`}
                </div>
              </div>
            )}
            <p style={{margin:0,color:"var(--text2)",fontSize:13}}>
              לביטול הבקשה הקיימת — עבור/י ל<strong>"ההזמנות שלי"</strong> ובטל/י שם את בקשת ההשאלה החופפת בזמנים.
            </p>
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={()=>setOverlapBlock(null)}>סגירה</button>
            <button className="btn btn-primary" onClick={()=>{ setOverlapBlock(null); setPublicView("my-bookings"); loadStudiosData(); loadReservationsData(); }}>
              <ClipboardList size={16} strokeWidth={1.75} /> מעבר ל"ההזמנות שלי"
            </button>
          </div>
        </div>
      </div>
    )}
    {showInfoPanel&&<InfoPanel policies={policies} kits={kits} equipment={equipment} teamMembers={teamMembers} onClose={()=>setShowInfoPanel(false)} accentColor={siteSettings.accentColor} commitmentPdf={policies.commitmentPdf} commitmentPdfCompressed={policies.commitmentPdfCompressed} commitmentPdfName={policies.commitmentPdfName} certifications={certifications} userGuideVideos={Array.isArray(siteSettings.userGuideVideos) ? siteSettings.userGuideVideos : []} userGuidePdf={userGuidePdf}/>}
    {showAccountSettings && loggedInStudent && (
      <AccountSettingsModal
        student={loggedInStudent}
        accentColor={siteSettings.accentColor}
        showToast={showToast}
        onClose={()=>setShowAccountSettings(false)}
        onSaved={(updatedStudent, flags)=>{
          // Arm the 15s self-update grace window BEFORE we touch loggedInStudent.
          // Otherwise the gatekeeper useEffect would see the new email, check
          // the stale certifications.students[] list (which still has the old
          // email), find no match, and sign the user out — causing the "screen
          // freezes on save" bug.
          selfUpdateSnapshotRef.current = {
            oldEmail: loggedInStudent?.email || "",
            newEmail: updatedStudent?.email || "",
            until: Date.now() + 15000,
          };
          // Update local state so the UI reflects the change immediately.
          setLoggedInStudent(updatedStudent);
          applyStudentIdentity(updatedStudent);
          set("email",        updatedStudent.email || "");
          if (updatedStudent.phone != null) set("phone", updatedStudent.phone || "");
          // The backend already wrote the updated certifications.students[]
          // row via the Service Role key, so App-level admin polling
          // (refreshAdminData → certifications) AND the Supabase realtime
          // listener on the `store` table will pick it up within a second.
          if (flags?.passwordChanged) {
            showToast?.("success", "הסיסמה עודכנה. השתמש/י בה בכניסה הבאה.");
          }
        }}
      />
    )}
    {showEquipmentAiModal && (
      <div
        style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:2600,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
        onClick={(e)=>e.target===e.currentTarget&&closeEquipmentAiModal()}
      >
        <div style={{width:"100%",maxWidth:560,background:"var(--surface)",borderRadius:18,border:"1px solid var(--border)",direction:"rtl",boxShadow:"0 30px 80px rgba(0,0,0,0.35)"}}>
          <div style={{padding:"18px 22px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
            <div>
              <div style={{fontWeight:900,fontSize:18,color:"var(--accent)"}}>✨ השאלת ציוד חכמה</div>
              <div style={{fontSize:12,color:"var(--text3)",marginTop:4}}>כתבו במשפט אחד מה אתם צריכים, והמערכת תמלא תאריכים וציוד אוטומטית.</div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={closeEquipmentAiModal}>סגור</button>
          </div>
          <form
            onSubmit={(e)=>{
              e.preventDefault();
              handleSmartEquipmentBooking(equipmentAiPrompt.trim(), equipment);
            }}
            style={{padding:22,display:"flex",flexDirection:"column",gap:14}}
          >
            <label style={{display:"flex",flexDirection:"column",gap:8,fontWeight:700,color:"var(--text2)"}}>
              מה תרצו להשאיל?
              <textarea
                className="form-input"
                rows={5}
                value={equipmentAiPrompt}
                onChange={(e)=>setEquipmentAiPrompt(e.target.value)}
                placeholder='למשל: אני צריך 2 פנסי לד, מצלמת Sony FX3 ומיקרופון אלחוטי ליום חמישי מ-09:00 עד 16:00'
                style={{resize:"vertical",minHeight:140}}
              />
            </label>
            <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.6}}>
              ה-AI ימלא את סוג ההשאלה, התאריכים, השעות והציוד, ואז יעביר אתכם ישר לשלב האישור הסופי.
            </div>
            {!normalizeSmartLoanType(form.loan_type) && (showEquipmentAiLoanTypePrompt || equipmentAiForcedLoanType) && (
              <div style={{background:"rgba(245,166,35,0.08)",border:"1px solid rgba(245,166,35,0.25)",borderRadius:14,padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
                <div style={{fontSize:13,fontWeight:800,color:"var(--text)"}}>
                  {equipmentAiForcedLoanType ? `סוג ההשאלה שנבחר: ${equipmentAiForcedLoanType}` : "לא זיהינו סוג השאלה. בחרו סוג השאלה כדי להמשיך."}
                </div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {visibleLoanTypeOptions.map(({ val: loanTypeOption }) => {
                    const isActive = normalizeSmartLoanType(equipmentAiForcedLoanType) === loanTypeOption;
                    return (
                      <button
                        key={loanTypeOption}
                        type="button"
                        className={isActive ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}
                        onClick={()=>{
                          setEquipmentAiForcedLoanType(loanTypeOption);
                          setShowEquipmentAiLoanTypePrompt(false);
                        }}
                      >
                        {loanTypeOption}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              {equipmentAiLoading && <span style={{fontSize:12,color:"var(--accent)",fontWeight:700}}>מפענח את הבקשה...</span>}
              <div style={{display:"flex",gap:8,marginInlineStart:"auto"}}>
                <button type="button" className="btn btn-secondary" onClick={closeEquipmentAiModal} disabled={equipmentAiLoading}>ביטול</button>
                <button type="submit" className="btn btn-primary" disabled={equipmentAiLoading || !equipmentAiPrompt.trim()}>
                  {equipmentAiLoading ? "ממלא..." : "מלא לי"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    )}
    <AIChatBot equipment={equipment} reservations={reservations} policies={policies} settings={siteSettings} currentUser={loggedInStudent} refreshInventory={syncInventory} />
    </>
  );
}

// ─── PUBLIC STUDIO BOOKING (student side) ────────────────────────────────────
function PublicStudioBooking({ studios, bookings, setBookings, student, showToast, weekOffset, setWeekOffset, modal, setModal, certifications, siteSettings = {}, policies = {} }) {
  const [saving, setSaving] = useState(false);
  const [studioInfoPanel, setStudioInfoPanel] = useState(null); // studio object for info modal
  const [dayView, setDayView] = useState(null); // { studioId, date, dayName }
  const [nightPolicyPending, setNightPolicyPending] = useState(null); // booking args waiting for policy agreement
  const [nightPolicyScrolled, setNightPolicyScrolled] = useState(false);
  const [nightPolicyAgreed, setNightPolicyAgreed] = useState(false);
  const [calendarFullscreen, setCalendarFullscreen] = useState(false);
  const [showAiAssistant, setShowAiAssistant] = useState(false);
  const [smartBookingPrompt, setSmartBookingPrompt] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [studioCertsOpen, setStudioCertsOpen] = useState(false);

  const DAY_HOURS = (() => { const h = []; for (let hr = 9; hr <= 21; hr++) for (let m = 0; m < 60; m += 15) { if (hr === 21 && m > 30) break; h.push(`${String(hr).padStart(2,"0")}:${String(m).padStart(2,"0")}`); } return h; })();
  const DAY_BOOKING_HOURS = DAY_HOURS.filter(t => t < "21:30");
  const NIGHT_START_TIME = "21:30";
  const NIGHT_END_TIME = "08:00";
  const NIGHT_BOOKING_LABEL = `מ־${NIGHT_START_TIME} והלאה`;
  const STUDENT_COLOR = "var(--green)";
  const TEAM_COLOR = "#9b59b6";
  const LESSON_COLOR = "#f5a623";
  const NIGHT_COLOR = "#2196f3";

  const studioFutureHoursLimit = getStudioFutureHoursLimit(siteSettings);
  const normalizeStudioPhone = (value) => String(value || "").replace(/[^0-9]/g, "");

  // Stage 6 step 5d: PublicStudioBooking is its own component, so it needs
  // its own students fetch (parent's studentsFromTable isn't in scope here).
  // Falls back to certifications.students until the table fetch resolves.
  const [tableStudents, setTableStudents] = useState(null);
  useEffect(() => {
    let alive = true;
    listStudents().then(s => { if (alive && Array.isArray(s)) setTableStudents(s); });
    return () => { alive = false; };
  }, []);
  const studentsFromTable = tableStudents ?? (certifications?.students || []);

  // Check if student has night certification
  const studentRecord = (() => {
    const students = studentsFromTable;
    if (!student) return null;
    if (student.id !== undefined && student.id !== null) {
      const byId = students.find((candidate) => String(candidate.id) === String(student.id));
      if (byId) return byId;
    }
    const studentEmail = String(student.email || "").toLowerCase().trim();
    if (studentEmail) {
      const byEmail = students.find((candidate) => candidate.email?.toLowerCase().trim() === studentEmail);
      if (byEmail) return byEmail;
    }
    const normalizedName = normalizeName(student.name);
    const normalizedPhone = normalizeStudioPhone(student.phone);
    return students.find((candidate) => {
      const sameName = normalizeName(candidate.name) === normalizedName;
      if (!sameName) return false;
      if (!normalizedPhone) return true;
      return normalizeStudioPhone(candidate.phone) === normalizedPhone;
    }) || null;
  })();
  const nightCertType = (certifications?.types||[]).find(t => t.id === "cert_night_studio");
  const hasNightCert = studentRecord && nightCertType && (studentRecord.certs||{})[nightCertType.id] === "עבר";

  // Studio certification check
  const studioCertTypes = (certifications?.types || []).filter(t => t.category === "studio" && t.id !== "cert_night_studio");
  const sameStudioId = (a, b) => String(a) === String(b);
  const normalizeStudioName = (value) => String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  const isControlRoomStudio = (studio) => {
    const name = normalizeStudioName(studio?.name);
    return name === "MAIN CONTROL" || name === "DIGITAL MIX ROOM";
  };
  const isRecordingStudio = (studio) => String(studio?.name || "").trim().replace(/\s+/g, " ") === "\u05e1\u05d8\u05d5\u05d3\u05d9\u05d5 \u05d4\u05e7\u05dc\u05d8\u05d5\u05ea";
  const SMART_BOOKING_BLOCKED_MESSAGE = "לא ניתן להשלים את הבקשה";
  const STUDIO_MAINTENANCE_MESSAGE = "החדר בתחזוקה, מקווים שישוב לעבוד בקרוב";
  const getStudioCertIds = (studio) => {
    if (Array.isArray(studio?.studioCertIds)) return studio.studioCertIds.filter(Boolean);
    return studio?.studioCertId ? [studio.studioCertId] : [];
  };

  // Studio certs visible to this student: certs attached to studios they can
  // see (track-filtered upstream into the `studios` prop) PLUS the global
  // night cert (`cert_night_studio`), which gates after-hours bookings across
  // all studios and isn't on any single studio's studioCertId. We filter by
  // id-membership only (not by `category`) because in some data the night
  // cert isn't marked with category="studio". Display-only.
  const studioCertsList = (() => {
    const relevantCertIds = new Set();
    (studios || []).forEach(studio => getStudioCertIds(studio).forEach(id => relevantCertIds.add(id)));
    relevantCertIds.add("cert_night_studio");
    return (certifications?.types || [])
      .filter(t => relevantCertIds.has(t.id))
      .map(t => ({ id: t.id, name: t.name, status: (studentRecord?.certs || {})[t.id] || "לא עבר" }));
  })();
  const isStudioDisabled = (studioId) => {
    const studio = studios.find(s => sameStudioId(s.id, studioId));
    return Boolean(studio?.isDisabled);
  };
  const hasStudioCert = (studioId) => {
    const studio = studios.find(s => sameStudioId(s.id, studioId));
    const certIds = getStudioCertIds(studio);
    if (!certIds.length) return true; // no cert required
    return studentRecord && certIds.some(id => (studentRecord.certs || {})[id] === "עבר");
  };
  const getStudioCertName = (studioId) => {
    const studio = studios.find(s => sameStudioId(s.id, studioId));
    const names = getStudioCertIds(studio)
      .map(id => studioCertTypes.find(t => t.id === id)?.name)
      .filter(Boolean);
    return names.length ? names.join(" / ") : null;
  };
  const isBookingOwnedByStudent = (booking) => {
    if (!booking || !student) return false;
    if (booking.bookingKind && booking.bookingKind !== "student") return false;
    if (student.id !== undefined && student.id !== null && booking.studentId !== undefined && booking.studentId !== null) {
      return String(booking.studentId) === String(student.id);
    }
    const studentEmail = String(student.email || "").toLowerCase().trim();
    const bookingEmail = String(booking.studentEmail || "").toLowerCase().trim();
    if (studentEmail && bookingEmail) return studentEmail === bookingEmail;
    const studentPhone = normalizeStudioPhone(student.phone);
    const bookingPhone = normalizeStudioPhone(booking.studentPhone);
    if (studentPhone && bookingPhone) return studentPhone === bookingPhone;
    return normalizeName(booking.studentName) === normalizeName(student.name);
  };
  const getBookingKind = (booking) => {
    if (!booking) return "student";
    if (booking.bookingKind === "lesson" || booking.lesson_auto || (booking.lesson_id !== null && booking.lesson_id !== undefined && String(booking.lesson_id).trim() !== "")) return "lesson";
    if (booking.bookingKind === "team" || booking.ownerType === "team" || booking.teamMemberId || booking.teamMemberName) return "team";
    return "student";
  };
  const getBookingColor = (booking) => {
    const kind = getBookingKind(booking);
    if (kind === "lesson") return LESSON_COLOR;
    if (kind === "team") return TEAM_COLOR;
    if (booking?.isNight) return NIGHT_COLOR;
    return STUDENT_COLOR;
  };
  const getBookingTitle = (booking) => {
    const kind = getBookingKind(booking);
    if (kind === "lesson") return booking?.courseName || booking?.studentName || "שיעור";
    if (kind === "team") return booking?.teamMemberName || booking?.studentName || "איש צוות";
    return booking?.studentName || "סטודנט";
  };
  const getBookingSubtitle = (booking) => {
    const kind = getBookingKind(booking);
    if (kind === "lesson") return booking?.instructorName || "";
    if (kind === "team") return "צוות המחסן";
    return "";
  };
  const getStudioBookingTimeLabel = (booking) => (
    booking?.isNight ? NIGHT_BOOKING_LABEL : `${booking?.startTime || ""}–${booking?.endTime || ""}`
  );
  const isActiveStudioBooking = (booking) => booking?.status !== "נדחה";

  const futureStudentBookedHours = useMemo(() => (
    (bookings || []).reduce((sum, booking) => {
      if (!isActiveStudioBooking(booking) || !isBookingOwnedByStudent(booking)) return sum;
      return sum + getFutureStudioBookingHours(booking, new Date(), NIGHT_START_TIME, NIGHT_END_TIME);
    }, 0)
  ), [bookings, student]);
  const remainingFutureHours = Math.max(0, studioFutureHoursLimit - futureStudentBookedHours);

  function getWeekDays(off=0) {
    const today = new Date();
    today.setDate(today.getDate() + off * 7);
    const sun = new Date(today); sun.setDate(today.getDate() - today.getDay());
    return Array.from({length:7}, (_,i) => {
      const d = new Date(sun); d.setDate(sun.getDate()+i);
      const yyyy = d.getFullYear(), mm = String(d.getMonth()+1).padStart(2,"0"), dd = String(d.getDate()).padStart(2,"0");
      return { name:["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][i], date:dd, fullDate:`${yyyy}-${mm}-${dd}`,
        isToday: dd===String(new Date().getDate()).padStart(2,"0") && mm===String(new Date().getMonth()+1).padStart(2,"0") && yyyy===new Date().getFullYear() };
    });
  }
  const weekDays = getWeekDays(weekOffset);
  const openAddBookingModal = ({ studioId, date, dayName, isNight=false, defaultStart, defaultEnd }) => {
    setShowAiAssistant(false);
    setSmartBookingPrompt("");
    setIsAiLoading(false);
    setModal({
      type: "addBooking",
      studioId,
      date,
      dayName,
      isNight,
      defaultStart,
      defaultEnd,
      selectedStudioId: String(studioId ?? ""),
      selectedDate: date || "",
      selectedStartTime: defaultStart || (isNight ? NIGHT_START_TIME : "09:00"),
      selectedEndTime: defaultEnd || (isNight ? NIGHT_END_TIME : "12:00"),
      notes: "",
    });
  };
  const closeBookingModal = () => {
    setShowAiAssistant(false);
    setSmartBookingPrompt("");
    setIsAiLoading(false);
    setModal(null);
  };
  const closeSmartBookingModal = () => {
    setShowAiAssistant(false);
    setSmartBookingPrompt("");
    setIsAiLoading(false);
  };
  const updateAddBookingModal = (patch) => {
    setModal((prev) => (
      prev?.type === "addBooking"
        ? { ...prev, ...patch }
        : prev
    ));
  };
  const getHebrewDayName = (dateStr) => {
    if (!dateStr) return "";
    const date = new Date(`${dateStr}T12:00:00`);
    if (Number.isNaN(date.getTime())) return "";
    return ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][date.getDay()] || "";
  };
  const getClosestTimeOption = (value, options = [], fallback = "") => {
    const target = String(value || "").trim();
    if (!target) return fallback || options[0] || "";
    if (options.includes(target)) return target;
    const targetParts = target.split(":").map(Number);
    if (targetParts.length !== 2 || targetParts.some((part) => Number.isNaN(part))) return fallback || options[0] || "";
    const targetMinutes = targetParts[0] * 60 + targetParts[1];
    let best = fallback || options[0] || "";
    let bestDiff = Number.POSITIVE_INFINITY;
    options.forEach((option) => {
      const [hours, minutes] = String(option || "").split(":").map(Number);
      if (Number.isNaN(hours) || Number.isNaN(minutes)) return;
      const diff = Math.abs((hours * 60 + minutes) - targetMinutes);
      if (diff < bestDiff) {
        best = option;
        bestDiff = diff;
      }
    });
    return best;
  };
  const getStudioBookingValidationError = ({ studioId, date, startTime, endTime, isNight=false, blockedMessage="", excludeBookingId=null }) => {
    const normalizedStartTime = isNight ? NIGHT_START_TIME : startTime;
    const normalizedEndTime = isNight ? NIGHT_END_TIME : endTime;
    if (!studioId || !date || !normalizedStartTime || !normalizedEndTime) return "יש להשלים חדר, תאריך ושעות לפני השליחה";
    if (date < todayStr) return "לא ניתן להזמין תאריך שעבר";
    if (isStudioDisabled(studioId)) return blockedMessage || STUDIO_MAINTENANCE_MESSAGE;
    if (!hasStudioCert(studioId) || (isNight && !hasNightCert)) return blockedMessage || "טרם עבר הסמכה — לא ניתן לקבוע חדר זה";
    if (!isNight && normalizedStartTime >= normalizedEndTime) return "שעת סיום חייבת להיות אחרי שעת ההתחלה";
    const currentFutureHours = (bookings || []).reduce((sum, booking) => {
      if (!isActiveStudioBooking(booking) || !isBookingOwnedByStudent(booking)) return sum;
      if (excludeBookingId !== null && String(booking.id) === String(excludeBookingId)) return sum;
      return sum + getFutureStudioBookingHours(booking, new Date(), NIGHT_START_TIME, NIGHT_END_TIME);
    }, 0);
    const requestedFutureHours = getFutureStudioBookingHours({ date, startTime: normalizedStartTime, endTime: normalizedEndTime, isNight }, new Date(), NIGHT_START_TIME, NIGHT_END_TIME);
    if ((currentFutureHours + requestedFutureHours) - studioFutureHoursLimit > 0.0001) {
      const remainingHours = Math.max(0, studioFutureHoursLimit - currentFutureHours);
      return `לא ניתן להשלים את הבקשה. נותרו לך ${formatStudioHoursValue(remainingHours)} שעות בבנק השעות העתידיות.`;
    }
    // Night-aware overlap (same math as the server EXCLUDE guard). Applies to
    // night bookings too — the old `!isNight` gate let night bookings skip the
    // check entirely and double-book.
    const requested = { studioId, date, startTime: normalizedStartTime, endTime: normalizedEndTime, isNight };
    const overlap = bookings.some((booking) => (
      sameStudioId(booking.studioId, studioId)
      && isActiveStudioBooking(booking)
      && (excludeBookingId === null || String(booking.id) !== String(excludeBookingId))
      && rangesOverlap(booking, requested)
    ));
    if (overlap) return "קיימת הזמנה חופפת";
    return "";
  };
  const checkStudentParallelBooking = (date, startTime, endTime, excludeBookingId = null) => {
    const stuId = student?.id ?? null;
    const stuName = student?.name || "";
    return bookings.find(b => {
      if (!isActiveStudioBooking(b)) return false;
      if (b.date !== date) return false;
      if (excludeBookingId !== null && String(b.id) === String(excludeBookingId)) return false;
      const isMine = (stuId !== null && String(b.studentId) === String(stuId)) || b.studentName === stuName;
      if (!isMine) return false;
      return !(endTime <= b.startTime || startTime >= b.endTime);
    }) || null;
  };

  const persistStudentBooking = async ({ studioId, date, startTime, endTime, notes="", isNight=false, blockedMessage="", successMessage="החדר הוזמן בהצלחה!" }) => {
    // Night booking always requires consent — close booking modal + day view, then show policy modal
    if (isNight) {
      setModal(null);    // close booking form
      setDayView(null);  // exit day drill-down so policy modal can render
      setNightPolicyPending({ studioId, date, startTime, endTime, notes, isNight, blockedMessage, successMessage });
      setNightPolicyScrolled(false);
      setNightPolicyAgreed(false);
      return false;
    }
    try {
      const normalizedStartTime = startTime;
      const normalizedEndTime = endTime;
      const validationError = getStudioBookingValidationError({ studioId, date, startTime: normalizedStartTime, endTime: normalizedEndTime, isNight, blockedMessage });
      if (validationError) { showToast("error", validationError); return false; }
      const parallelConflict = checkStudentParallelBooking(date, normalizedStartTime, normalizedEndTime);
      if (parallelConflict) {
        const studioLabel = parallelConflict.studioId || "חדר";
        showToast("error", `פעולה נחסמה: אינך יכול להזמין שני חדרים במקביל באותן השעות (${parallelConflict.startTime}–${parallelConflict.endTime})`);
        return false;
      }
      const newBooking = {
        id: Date.now(),
        bookingKind: "student",
        studioId, date,
        startTime: normalizedStartTime,
        endTime: normalizedEndTime,
        studentId: student?.id ?? null,
        studentEmail: student?.email || "",
        studentPhone: student?.phone || "",
        studentName: student.name,
        notes, isNight,
        createdAt: new Date().toISOString(),
      };
      const updated = [...bookings, newBooking];
      setBookings(updated);
      const saveRes = await upsertStudioBooking(newBooking);
      if (saveRes?.error === "studio_overlap") {
        setBookings(bookings); // revert optimistic add — server EXCLUDE guard rejected an overlap
        showToast("error", "קיימת כבר קביעה חופפת על החדר בזמנים הללו. רענן/י ונס/י שוב.");
        return false;
      }
      showToast("success", successMessage);
      return true;
    } catch(err) {
      console.error("persistStudentBooking error", err);
      showToast("error", "אירעה שגיאה בשמירת ההזמנה. נסה שוב.");
      return false;
    }
  };

  const handleSmartBooking = async (promptText, studiosList) => {
    if (!promptText) return;
    setIsAiLoading(true);

    try {
      const today = todayStr;
      const activeStudios = (studiosList || []).filter((studio) => !isStudioDisabled(studio?.id));
      const certifiedStudios = activeStudios.filter((studio) => hasStudioCert(studio?.id));
      const availableStudios = certifiedStudios;
      if (!availableStudios.length) {
        throw new Error(SMART_BOOKING_BLOCKED_MESSAGE);
      }
      const availableStudiosStr = availableStudios
        .map((studio) => `ID: ${studio.id}, Name: ${studio.name}, Type: ${studio.type || ""}`)
        .join("\n");

      const systemInstruction = `
      אתה עוזר AI חכם להזמנת אולפנים במכללה.
      התאריך של היום הוא: ${today}.
      המשימה שלך היא לחלץ מהבקשה של הסטודנט את תאריך ההזמנה, שעת ההתחלה, שעת הסיום, ואת מזהה האולפן (studioId) המתאים ביותר מתוך הרשימה הבאה:
      ${availableStudiosStr}

      אם הסטודנט מבקש למשל "מחר", חשב את התאריך ביחס ל-${today}.
      החזר אך ורק JSON תקני.
    `;

      const requestBody = {
        contents: [{ parts: [{ text: promptText }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              studioId: { type: "STRING", description: "The exact ID of the requested studio from the provided list" },
              date: { type: "STRING", description: "Format: YYYY-MM-DD" },
              startTime: { type: "STRING", description: "Format: HH:MM" },
              endTime: { type: "STRING", description: "Format: HH:MM" },
            },
            required: ["studioId", "date", "startTime", "endTime"],
          },
        },
      };

      let jsonResponse = null;
      {
        const token = await getAuthToken();
        const response = await fetchWithRetry('/api/gemini', {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`API Error: ${response.status} - ${errText}`);
        }

        jsonResponse = await response.json();
      }

      if (!jsonResponse?.candidates?.length) {
        throw new Error("No response from Gemini API.");
      }

      const result = parseSmartBookingJson(jsonResponse.candidates[0].content.parts[0].text);
      const directResolvedStudio = availableStudios.find((studio) => sameStudioId(studio.id, result?.studioId));
      if (!directResolvedStudio) throw new Error(SMART_BOOKING_BLOCKED_MESSAGE);

      const parsedStartTime = String(result?.startTime || "").trim();
      const parsedEndTime = String(result?.endTime || "").trim();
      const inferredNightBooking = (
        (parsedStartTime && parsedStartTime >= NIGHT_START_TIME)
        || (parsedEndTime && parsedEndTime <= NIGHT_END_TIME)
        || (parsedStartTime && parsedEndTime && parsedEndTime <= parsedStartTime)
      );
      const directSelectedDate = result?.date || today;
      const directSelectedStartTime = inferredNightBooking
        ? NIGHT_START_TIME
        : getClosestTimeOption(result?.startTime, DAY_BOOKING_HOURS, "09:00");
      const directSelectedEndTime = inferredNightBooking
        ? NIGHT_END_TIME
        : getClosestTimeOption(result?.endTime, DAY_HOURS, "12:00");
      const didSave = await persistStudentBooking({
        studioId: directResolvedStudio.id,
        date: directSelectedDate,
        startTime: directSelectedStartTime,
        endTime: directSelectedEndTime,
        notes: promptText,
        isNight: inferredNightBooking,
        blockedMessage: SMART_BOOKING_BLOCKED_MESSAGE,
      });
      if (!didSave) return;
      closeSmartBookingModal();
    } catch (err) {
      console.error("Smart Booking Error:", err);
      showToast("error", err?.message || "לא הצלחנו לפענח את הבקשה. אנא נסה לנסח שוב.");
    } finally {
      setIsAiLoading(false);
    }
  };
  const openSmartBookingFromCalendar = () => {
    const defaultStudio = studios.find((studio) => !isStudioDisabled(studio.id) && hasStudioCert(studio.id));
    if (!defaultStudio) {
      showToast("error", SMART_BOOKING_BLOCKED_MESSAGE);
      return;
    }
    setModal(null);
    setShowAiAssistant(true);
    setSmartBookingPrompt("");
  };
  const renderAddBookingModal = () => (
    modal?.type==="addBooking" ? (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&closeBookingModal()}>
        <div style={{width:"100%",maxWidth:400,background:"var(--surface)",borderRadius:16,border:`1px solid ${modal.isNight ? NIGHT_COLOR : "var(--border)"}`,direction:"rtl"}}>
          <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",fontWeight:900,fontSize:16,color:modal.isNight?NIGHT_COLOR:undefined}}>
            {modal.isNight ? "🌙 הזמנת לילה" : <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Calendar size={16} strokeWidth={1.75} color="var(--accent)" /> הזמנת חדר</span>}
          </div>
          <form onSubmit={submitBooking} style={{padding:20,display:"flex",flexDirection:"column",gap:12}}>
            <div style={{fontSize:13,color:"var(--text3)"}}>
              <User size={14} strokeWidth={1.75} color="var(--purple)" style={{display:"inline",verticalAlign:"middle",marginLeft:4}} />
              <strong style={{color:"var(--text)",fontSize:14}}>{student.name}</strong>
              <span> · {(modal.selectedDate || modal.date) ? `${getHebrewDayName(modal.selectedDate || modal.date)} ` : ""}{modal.selectedDate || modal.date}</span>
            </div>
            <div style={{fontSize:13,color:"var(--text3)",display:"flex",alignItems:"center",gap:6}}>
              <Mic size={14} strokeWidth={1.75} color="var(--accent)" />
              <strong style={{color:"var(--accent)",fontSize:14}}>{(studios.find((studio) => sameStudioId(studio.id, modal.selectedStudioId || modal.studioId))?.name) || "בחר חדר"}</strong>
            </div>
            <div style={{display:"flex",gap:8}}>
              <label style={{flex:1,fontSize:13,fontWeight:600}}>חדר
                <select
                  name="studioId"
                  className="form-input"
                  value={modal.selectedStudioId || modal.studioId || ""}
                  onChange={(e) => updateAddBookingModal({ selectedStudioId: e.target.value, studioId: e.target.value })}
                >
                  <option value="">-- בחר חדר --</option>
                  {studios.map((studio) => (
                    <option key={studio.id} value={studio.id} disabled={isStudioDisabled(studio.id)}>
                      {studio.name}{isStudioDisabled(studio.id) ? " (בתחזוקה)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{flex:1,fontSize:13,fontWeight:600}}>תאריך
                <input
                  type="date"
                  name="date"
                  className="form-input"
                  min={todayStr}
                  value={modal.selectedDate || modal.date || ""}
                  onChange={(e) => updateAddBookingModal({ selectedDate: e.target.value, date: e.target.value })}
                />
              </label>
            </div>
            <div style={{display:"flex",gap:8}}>
              <label style={{flex:1,fontSize:13,fontWeight:600}}>התחלה
                {modal.isNight ? (
                  <div className="form-input" style={{display:"flex",alignItems:"center",minHeight:42,color:NIGHT_COLOR,fontWeight:700}}>
                    {NIGHT_BOOKING_LABEL}
                  </div>
                ) : (
                  <select
                    name="startTime"
                    className="form-input"
                    value={modal.selectedStartTime || modal.defaultStart || "09:00"}
                    onChange={(e) => updateAddBookingModal({ selectedStartTime: e.target.value, defaultStart: e.target.value })}
                  >
                    {DAY_BOOKING_HOURS.map(h=><option key={h}>{h}</option>)}
                  </select>
                )}
              </label>
              <label style={{flex:1,fontSize:13,fontWeight:600}}>סיום
                {modal.isNight ? (
                  <div className="form-input" style={{display:"flex",alignItems:"center",minHeight:42,color:NIGHT_COLOR,fontWeight:700}}>
                    קביעת לילה כללית
                  </div>
                ) : (
                  <select
                    name="endTime"
                    className="form-input"
                    value={modal.selectedEndTime || modal.defaultEnd || "12:00"}
                    onChange={(e) => updateAddBookingModal({ selectedEndTime: e.target.value, defaultEnd: e.target.value })}
                  >
                    {DAY_HOURS.map(h=><option key={h}>{h}</option>)}
                  </select>
                )}
              </label>
            </div>
            <label style={{fontSize:13,fontWeight:600}}>הערות
              <textarea
                name="notes"
                className="form-input"
                rows={2}
                placeholder="תיאור הפרויקט..."
                value={modal.notes || ""}
                onChange={(e) => updateAddBookingModal({ notes: e.target.value })}
              />
              {isControlRoomStudio(studios.find((studio) => sameStudioId(studio.id, modal.selectedStudioId || modal.studioId))) && studios.some(isRecordingStudio) && (
                <span style={{marginTop:10,fontSize:13,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,background:"rgba(245,166,35,0.08)",border:"1px solid rgba(245,166,35,0.35)",borderRadius:8,padding:"10px 12px"}}>
                  <span>הוספת סטודיו הקלטות</span>
                  <input type="checkbox" name="addRecordingStudio" style={{width:18,height:18,accentColor:"var(--accent)"}} />
                </span>
              )}
            </label>
            <div style={{display:"flex",gap:8}}>
              <button type="button" className="btn btn-secondary" onClick={closeBookingModal}>ביטול</button>
              <button type="submit" className="btn btn-primary" disabled={saving || isAiLoading} style={modal.isNight?{background:NIGHT_COLOR,borderColor:NIGHT_COLOR}:{}}>{saving?"שומר...":<><CheckCircle size={16} strokeWidth={1.75} /> שלח בקשה</>}</button>
            </div>
            <div style={{fontSize:11,color:"var(--green)",display:"flex",alignItems:"center",gap:4}}><CheckCircle size={12} strokeWidth={1.75} /> {modal.isNight ? "הזמנת הלילה נשמרת אוטומטית בלוח" : "החדר נשמר אוטומטית בלוח"}</div>
          </form>
        </div>
      </div>
    ) : null
  );

  const submitBooking = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const fd = new FormData(e.target);
      const studioId = String(fd.get("studioId") || modal?.selectedStudioId || modal?.studioId || "").trim();
      const date = String(fd.get("date") || modal?.selectedDate || modal?.date || "").trim();
      const notes = fd.get("notes")?.trim();
      const isNight = modal.isNight || false;
      const startTime = isNight ? NIGHT_START_TIME : String(fd.get("startTime") || modal?.selectedStartTime || "").trim();
      const endTime = isNight ? NIGHT_END_TIME : String(fd.get("endTime") || modal?.selectedEndTime || "").trim();
      const selectedStudio = studios.find(s => sameStudioId(s.id, studioId));
      const recordingStudio = studios.find(isRecordingStudio);
      const addRecordingStudio = fd.get("addRecordingStudio") === "on" && isControlRoomStudio(selectedStudio);
      if (addRecordingStudio && !recordingStudio) {
        showToast("error", "סטודיו הקלטות לא נמצא ברשימת החדרים");
        return;
      }
      if (addRecordingStudio && isStudioDisabled(recordingStudio.id)) {
        showToast("error", "סטודיו הקלטות בתחזוקה ולא ניתן לצרף אותו להזמנה");
        return;
      }
      if (addRecordingStudio) {
        const recordingRequest = { studioId: recordingStudio.id, date, startTime, endTime, isNight };
        const recordingOverlap = bookings.some((booking) => (
          sameStudioId(booking.studioId, recordingStudio.id)
          && isActiveStudioBooking(booking)
          && rangesOverlap(booking, recordingRequest)
        ));
        if (recordingOverlap) {
          showToast("error", "סטודיו הקלטות תפוס בשעות האלו");
          return;
        }
      }
      const didSave = await persistStudentBooking({ studioId, date, startTime, endTime, notes, isNight });
      if (didSave) {
        if (addRecordingStudio) {
          const recordingBooking = {
            id: `${Date.now()}_rec`,
            bookingKind: "student",
            studioId: recordingStudio.id,
            date,
            startTime,
            endTime,
            studentId: student?.id ?? null,
            studentEmail: student?.email || "",
            studentPhone: student?.phone || "",
            studentName: student.name,
            notes,
            isNight,
            createdAt: new Date().toISOString(),
          };
          const recordingSave = await upsertStudioBooking(recordingBooking);
          if (!recordingSave?.ok) {
            showToast("error", recordingSave?.error === "studio_overlap" ? "סטודיו הקלטות תפוס בשעות האלו" : "ההזמנה נשמרה, אך סטודיו הקלטות לא נרשם ב-DB");
            return;
          }
          setBookings(prev => [...prev, recordingBooking]);
        }
        closeBookingModal();
      }
    } catch(err) {
      console.error("submitBooking error", err);
      showToast("error", "אירעה שגיאה. נסה שוב.");
    } finally {
      setSaving(false);
    }
  };

  const submitEditBooking = async (e) => {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.target);
    const notes = fd.get("notes")?.trim();
    const { bookingId, studioId, date, isNight } = modal;
    const startTime = isNight ? NIGHT_START_TIME : String(fd.get("startTime") || modal?.defaultStart || "").trim();
    const endTime = isNight ? NIGHT_END_TIME : String(fd.get("endTime") || modal?.defaultEnd || "").trim();
    const selectedStudio = studios.find(s => sameStudioId(s.id, studioId));
    const recordingStudio = studios.find(isRecordingStudio);
    const addRecordingStudio = fd.get("addRecordingStudio") === "on" && isControlRoomStudio(selectedStudio);
    const validationError = getStudioBookingValidationError({ studioId, date, startTime, endTime, isNight, excludeBookingId: bookingId });
    if (validationError) { showToast("error", validationError); setSaving(false); return; }
    if (isStudioDisabled(studioId)) { showToast("error", STUDIO_MAINTENANCE_MESSAGE); setSaving(false); return; }
    if (addRecordingStudio && !recordingStudio) { showToast("error", "סטודיו הקלטות לא נמצא ברשימת החדרים"); setSaving(false); return; }
    if (addRecordingStudio && isStudioDisabled(recordingStudio.id)) { showToast("error", "סטודיו הקלטות בתחזוקה ולא ניתן לצרף אותו להזמנה"); setSaving(false); return; }
    if(!isNight && startTime >= endTime) { showToast("error","שעת סיום חייבת להיות אחרי שעת התחלה"); setSaving(false); return; }
    const editRequest = { studioId, date, startTime, endTime, isNight };
    const overlap = bookings.some(b => sameStudioId(b.studioId, studioId) && String(b.id)!==String(bookingId) && isActiveStudioBooking(b) && rangesOverlap(b, editRequest));
    if(overlap) { showToast("error","קיימת הזמנה חופפת"); setSaving(false); return; }
    const existingRecordingBooking = recordingStudio ? bookings.find(b => (
      sameStudioId(b.studioId, recordingStudio.id)
      && b.date === date
      && b.id !== bookingId
      && isActiveStudioBooking(b)
      && isBookingOwnedByStudent(b)
      && (
        (b.startTime === modal.defaultStart && b.endTime === modal.defaultEnd)
        || (b.startTime === startTime && b.endTime === endTime)
      )
    )) : null;
    if (!addRecordingStudio && existingRecordingBooking) {
      const updated = bookings.map(b => b.id===bookingId ? {...b, startTime, endTime, notes: notes || b.notes} : b).filter(b => b.id !== existingRecordingBooking.id);
      const updatedBooking = updated.find(b => b.id === bookingId);
      setBookings(updated);
      if (updatedBooking) {
        const updateResult = await upsertStudioBooking(updatedBooking);
        if (!updateResult?.ok) { showToast("error", updateResult?.error === "studio_overlap" ? "קיימת כבר קביעה חופפת על החדר בזמנים הללו. רענן/י ונס/י שוב." : "שמירת ההזמנה ב-DB נכשלה"); setSaving(false); return; }
      }
      const deleteResult = await deleteStudioBooking(existingRecordingBooking.id);
      if (!deleteResult?.ok) { showToast("error", "מחיקת הזמנת סטודיו הקלטות מה-DB נכשלה"); setSaving(false); return; }
      showToast("success","ההזמנה עודכנה בהצלחה");
      setModal(null); setSaving(false);
      return;
    }
    if (addRecordingStudio) {
      const recordingEditRequest = { studioId: recordingStudio.id, date, startTime, endTime, isNight };
      const recordingOverlap = bookings.some(b => (
        sameStudioId(b.studioId, recordingStudio.id)
        && String(b.id) !== String(existingRecordingBooking?.id)
        && isActiveStudioBooking(b)
        && rangesOverlap(b, recordingEditRequest)
      ));
      if (recordingOverlap) { showToast("error", "סטודיו הקלטות תפוס בשעות האלו"); setSaving(false); return; }
    }
    let companionRecordingBooking = null;
    const updated = bookings.map(b => {
      if (b.id === bookingId) return {...b, startTime, endTime, notes: notes || b.notes};
      if (addRecordingStudio && existingRecordingBooking && b.id === existingRecordingBooking.id) {
        companionRecordingBooking = {...b, startTime, endTime, notes: notes || b.notes, isNight};
        return companionRecordingBooking;
      }
      return b;
    });
    if (addRecordingStudio && !existingRecordingBooking) {
      companionRecordingBooking = {
        id: `${Date.now()}_rec_edit`,
        bookingKind: "student",
        studioId: recordingStudio.id,
        date,
        startTime,
        endTime,
        studentId: student?.id ?? null,
        studentEmail: student?.email || "",
        studentPhone: student?.phone || "",
        studentName: student.name,
        notes,
        isNight,
        createdAt: new Date().toISOString(),
      };
      updated.push(companionRecordingBooking);
    }
    const updatedBooking = updated.find(b => b.id === bookingId);
    setBookings(updated);
    if (updatedBooking) {
      const updateResult = await upsertStudioBooking(updatedBooking);
      if (!updateResult?.ok) { showToast("error", updateResult?.error === "studio_overlap" ? "קיימת כבר קביעה חופפת על החדר בזמנים הללו. רענן/י ונס/י שוב." : "שמירת ההזמנה ב-DB נכשלה"); setSaving(false); return; }
    }
    if (companionRecordingBooking) {
      const companionResult = await upsertStudioBooking(companionRecordingBooking);
      if (!companionResult?.ok) { showToast("error", companionResult?.error === "studio_overlap" ? "סטודיו הקלטות תפוס בשעות האלו" : "סטודיו הקלטות לא נרשם ב-DB"); setSaving(false); return; }
    }
    showToast("success","ההזמנה עודכנה בהצלחה");
    setModal(null); setSaving(false);
  };

  const cancelBooking = async (bookingId) => {
    if(!confirm("לבטל את ההזמנה שלך?")) return;
    const updated = bookings.filter(b=>b.id!==bookingId);
    setBookings(updated);
    await deleteStudioBooking(bookingId);
    showToast("success","ההזמנה בוטלה");
  };

  // ── Mini calendar helper (must be before early return to respect Rules of Hooks) ──
  const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  const HE_DAYS_SHORT = ["א׳","ב׳","ג׳","ד׳","ה׳","ו׳","ש׳"];
  const [miniMonth, setMiniMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });

  // Determine which month/year the current week belongs to (use middle of week — Wednesday)
  const weekMiddle = new Date();
  weekMiddle.setDate(weekMiddle.getDate() + weekOffset * 7);
  const weekMonthLabel = HE_MONTHS[weekMiddle.getMonth()] + " " + weekMiddle.getFullYear();

  // Mini calendar days grid
  const miniDays = (() => {
    const { year, month } = miniMonth;
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  })();

  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })();

  // Jump to a specific date's week
  const jumpToDate = (day) => {
    const target = new Date(miniMonth.year, miniMonth.month, day);
    const now = new Date(); now.setHours(0,0,0,0);
    const diff = Math.round((target - now) / (1000*60*60*24));
    const targetSunOffset = target.getDay();
    const nowSunOffset = now.getDay();
    const targetWeekStart = diff - targetSunOffset + nowSunOffset;
    setWeekOffset(Math.round(targetWeekStart / 7));
  };

  // Check if a mini-calendar day is in the current displayed week
  const isInCurrentWeek = (day) => {
    if (!day) return false;
    const dateStr = `${miniMonth.year}-${String(miniMonth.month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    return weekDays.some(wd => wd.fullDate === dateStr);
  };

  const isTodayMini = (day) => {
    if (!day) return false;
    const dateStr = `${miniMonth.year}-${String(miniMonth.month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    return dateStr === todayStr;
  };

  const isPastMiniDay = (day) => {
    if (!day) return false;
    const dateStr = `${miniMonth.year}-${String(miniMonth.month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    return dateStr < todayStr;
  };

  // ── Day drill-down view ──
  if (dayView) {
    const studio = studios.find(s=>sameStudioId(s.id, dayView.studioId));
    const dayBookings = bookings.filter(b=>sameStudioId(b.studioId, dayView.studioId) && b.date===dayView.date && isActiveStudioBooking(b))
      .sort((a,b)=>(a.startTime||"").localeCompare(b.startTime||""));
    const isDayPast = dayView.date < todayStr;
    const nowHour = new Date().getHours();
    // Night bookings from this day
    const nightBookings = dayBookings.filter(b=>b.isNight);
    const maintenanceBlocked = isStudioDisabled(dayView.studioId);
    const dayBlocked = maintenanceBlocked || !hasStudioCert(dayView.studioId);
    const dayCertName = getStudioCertName(dayView.studioId);
    return (
      <div style={{padding:"20px 16px",direction:"rtl",maxWidth:500,margin:"0 auto"}}>
        <button className="btn btn-secondary btn-sm" onClick={()=>{ setModal(null); setDayView(null); }} style={{marginBottom:12}}>← חזור ללוח</button>
        <div style={{fontWeight:900,fontSize:18,marginBottom:4,display:"flex",alignItems:"center",gap:8}}>
          {studio?.image?.startsWith("http")
            ? <img src={studio.image} alt={studio.name} style={{width:32,height:32,borderRadius:6,objectFit:"cover"}}/>
            : <span>{studio?.image||<Mic size={32} strokeWidth={1.75} color="var(--accent)" />}</span>
          }
          {studio?.name}
        </div>
        <div style={{fontSize:14,color:"var(--text3)",marginBottom:16}}>{dayView.dayName} · {dayView.date}</div>
        {maintenanceBlocked && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid var(--red)",borderRadius:8,padding:"12px 16px",fontSize:14,color:"var(--red)",marginBottom:12,textAlign:"center",fontWeight:700}}>🔧 {STUDIO_MAINTENANCE_MESSAGE}</div>}
        {!maintenanceBlocked && dayBlocked && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid var(--red)",borderRadius:8,padding:"12px 16px",fontSize:14,color:"var(--red)",marginBottom:12,textAlign:"center",fontWeight:700}}>⛔ טרם עבר הסמכה{dayCertName ? ` — ${dayCertName}` : ""}<br/><span style={{fontSize:12,fontWeight:500}}>לא ניתן לקבוע חדר זה. יש לפנות לאיש צוות.</span></div>}
        {isDayPast && !dayBlocked && <div style={{background:"rgba(255,80,80,0.1)",border:"1px solid var(--red)",borderRadius:8,padding:"8px 12px",fontSize:13,color:"var(--red)",marginBottom:12,textAlign:"center"}}>⛔ לא ניתן להזמין תאריכים שעברו</div>}

        {/* Day hours (09:00-21:30) */}
        <div style={{fontWeight:800,fontSize:13,marginBottom:6,color:"var(--accent)"}}>☀️ שעות יום (09:00–21:30)</div>
        <div style={{display:"flex",flexDirection:"column",gap:2,marginBottom:16}}>
          {DAY_BOOKING_HOURS.filter(h => h.endsWith(":00") || h === "21:00").map((hour,i,arr)=>{
            const nextH = arr[i+1] || NIGHT_START_TIME;
            const booking = dayBookings.find(b=>!b.isNight && b.startTime<=hour && b.endTime>hour);
            const isHourPast = isDayPast || (dayView.date===todayStr && parseInt(hour)<nowHour);
            return (
              <div key={hour} style={{display:"flex",alignItems:"stretch",minHeight:44,border:"1px solid var(--border)",borderRadius:6,overflow:"hidden",opacity:isHourPast?0.5:1}}>
                <div style={{width:55,padding:"6px",background:"var(--surface2)",fontWeight:700,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>{hour}</div>
                {booking
                  ? <div style={{flex:1,background:getBookingColor(booking)+"22",padding:"6px 10px",display:"flex",alignItems:"center",gap:8,borderRight:`3px solid ${getBookingColor(booking)}`,justifyContent:"space-between"}}>
                      <div style={{display:"flex",flexDirection:"column",gap:2}}>
                        <span style={{fontWeight:700,fontSize:13}}>{getBookingTitle(booking)}</span>
                        {getBookingSubtitle(booking) && <span style={{fontSize:11,color:"var(--text3)"}}>{getBookingSubtitle(booking)}</span>}
                        <span style={{fontSize:11,color:"var(--text3)"}}>{formatTime(booking.startTime)}–{formatTime(booking.endTime)}</span>
                        {getBookingKind(booking)==="student" && (booking.studentEmail||booking.studentPhone) && (
                          <span style={{fontSize:12,color:"var(--accent)",fontWeight:600}}>
                            {booking.studentEmail && <>{booking.studentEmail}</>}
                            {booking.studentEmail && booking.studentPhone && " · "}
                            {booking.studentPhone && <>{booking.studentPhone}</>}
                          </span>
                        )}
                      </div>
                      {getBookingKind(booking)==="student" && isBookingOwnedByStudent(booking) && !isHourPast && (
                        <div style={{display:"flex",gap:4,flexShrink:0}}>
                          <button onClick={()=>setModal({type:"editBooking",bookingId:booking.id,studioId:dayView.studioId,date:dayView.date,dayName:dayView.dayName,isNight:false,defaultStart:booking.startTime,defaultEnd:booking.endTime,notes:booking.notes})} style={{background:"var(--accent)",color:"#000",border:"none",borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:3}}>
                            <Pencil size={12} strokeWidth={1.75} color="var(--text3)" /> ערוך
                          </button>
                          <button onClick={()=>cancelBooking(booking.id)} style={{background:"var(--red)",color:"#fff",border:"none",borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:3}}>
                            <XCircle size={12} strokeWidth={1.75} /> בטל
                          </button>
                        </div>
                      )}
                    </div>
                  : <div style={{flex:1,padding:"6px 10px",cursor:(isHourPast||dayBlocked)?"default":"pointer",display:"flex",alignItems:"center",color:dayBlocked?"var(--red)":"var(--text3)",fontSize:12}}
                        onClick={()=>{ if(!isHourPast && !dayBlocked) openAddBookingModal({studioId:dayView.studioId,date:dayView.date,dayName:dayView.dayName,defaultStart:hour,defaultEnd:nextH}); }}>
                      {dayBlocked ? <Shield size={12} strokeWidth={1.75} /> : isHourPast ? "" : "+ לחץ להזמנה"}
                    </div>
                }
              </div>
            );
          })}
        </div>

        {/* Night booking */}
        <div style={{fontWeight:800,fontSize:13,marginBottom:6,color:NIGHT_COLOR,display:"flex",alignItems:"center",gap:6}}>
          🌙 קביעת לילה ({NIGHT_BOOKING_LABEL})
          {!hasNightCert && <span style={{fontSize:11,fontWeight:500,color:"var(--text3)"}}>— טרם עבר/ה הסמכת לילה</span>}
        </div>
        {hasNightCert && !dayBlocked ? (
          <div style={{display:"flex",flexDirection:"column",gap:2}}>
            {nightBookings.length > 0 ? (
              nightBookings.map(b=>(
                <div key={b.id} style={{display:"flex",alignItems:"center",minHeight:44,border:`1px solid ${NIGHT_COLOR}`,borderRadius:6,overflow:"hidden",background:NIGHT_COLOR+"15"}}>
                  <div style={{width:55,padding:"6px",background:NIGHT_COLOR+"22",fontWeight:700,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",color:NIGHT_COLOR}}>🌙</div>
                  <div style={{flex:1,padding:"6px 10px",display:"flex",alignItems:"center",gap:8,justifyContent:"space-between"}}>
                    <div style={{display:"flex",flexDirection:"column",gap:2}}>
                      <span style={{fontWeight:700,fontSize:13}}>{getBookingTitle(b)}</span>
                      {getBookingSubtitle(b) && <span style={{fontSize:11,color:"var(--text3)"}}>{getBookingSubtitle(b)}</span>}
                      <span style={{fontSize:11,color:"var(--text3)"}}>{getStudioBookingTimeLabel(b)}</span>
                      {getBookingKind(b)==="student" && (b.studentEmail||b.studentPhone) && (
                        <span style={{fontSize:12,color:"var(--accent)",fontWeight:600}}>
                          {b.studentEmail}{b.studentEmail && b.studentPhone && " · "}{b.studentPhone}
                        </span>
                      )}
                    </div>
                    {getBookingKind(b)==="student" && isBookingOwnedByStudent(b) && !isDayPast && (
                      <div style={{display:"flex",gap:4,flexShrink:0}}>
                        <button onClick={()=>setModal({type:"editBooking",bookingId:b.id,studioId:dayView.studioId,date:dayView.date,dayName:dayView.dayName,isNight:true,defaultStart:b.startTime,defaultEnd:b.endTime,notes:b.notes})} style={{background:NIGHT_COLOR,color:"#fff",border:"none",borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:3}}>
                          <Pencil size={12} strokeWidth={1.75} color="var(--text3)" /> ערוך
                        </button>
                        <button onClick={()=>cancelBooking(b.id)} style={{background:"var(--red)",color:"#fff",border:"none",borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:3}}>
                          <XCircle size={12} strokeWidth={1.75} /> בטל
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              !isDayPast && (
                <div style={{border:`1px dashed ${NIGHT_COLOR}`,borderRadius:6,padding:"12px 16px",textAlign:"center",cursor:"pointer",color:NIGHT_COLOR,fontSize:13}}
                  onClick={()=>openAddBookingModal({studioId:dayView.studioId,date:dayView.date,dayName:dayView.dayName,isNight:true,defaultStart:NIGHT_START_TIME,defaultEnd:NIGHT_END_TIME})}>
                  + לחץ להזמנת לילה
                </div>
              )
            )}
          </div>
        ) : (
          <div style={{border:`1px solid ${NIGHT_COLOR}33`,borderRadius:6,padding:"12px 16px",textAlign:"center",color:"var(--text3)",fontSize:12,background:NIGHT_COLOR+"08"}}>
            <Shield size={14} strokeWidth={1.75} /> טרם עבר/ה הסמכת לילה לאולפנים — יש לפנות לאיש צוות
          </div>
        )}

        {renderAddBookingModal()}

        {/* Edit booking modal */}
        {modal?.type==="editBooking" && (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&setModal(null)}>
            <div style={{width:"100%",maxWidth:400,background:"var(--surface)",borderRadius:16,border:`1px solid ${modal.isNight ? NIGHT_COLOR : "var(--accent)"}`,direction:"rtl"}}>
              <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",fontWeight:900,fontSize:16,color:modal.isNight?NIGHT_COLOR:"var(--accent)"}}>
                <span style={{display:"inline-flex",alignItems:"center",gap:4}}><Pencil size={16} strokeWidth={1.75} color="var(--text3)" /> עריכת הזמנה</span>
              </div>
              <form onSubmit={submitEditBooking} style={{padding:20,display:"flex",flexDirection:"column",gap:12}}>
                <div style={{fontSize:13,color:"var(--text3)"}}>
                  <User size={14} strokeWidth={1.75} color="var(--purple)" style={{display:"inline",verticalAlign:"middle",marginLeft:4}} />
                  <strong style={{color:"var(--text)",fontSize:14}}>{student.name}</strong>
                  <span> · </span>
                  <strong style={{color:modal.isNight?NIGHT_COLOR:"var(--accent)",fontSize:14}}>{modal.date}</strong>
                </div>
                <div style={{fontSize:13,color:"var(--text3)",display:"flex",alignItems:"center",gap:6}}>
                  <Mic size={14} strokeWidth={1.75} color="var(--accent)" />
                  <strong style={{color:"var(--accent)",fontSize:14}}>{(studios.find((studio) => sameStudioId(studio.id, modal.studioId))?.name) || "בחר חדר"}</strong>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <label style={{flex:1,fontSize:13,fontWeight:600}}>התחלה
                    {modal.isNight ? (
                      <div className="form-input" style={{display:"flex",alignItems:"center",minHeight:42,color:NIGHT_COLOR,fontWeight:700}}>
                        {NIGHT_BOOKING_LABEL}
                      </div>
                    ) : (
                      <select name="startTime" className="form-input" defaultValue={modal.defaultStart}>
                        {DAY_BOOKING_HOURS.map(h=><option key={h}>{h}</option>)}
                      </select>
                    )}
                  </label>
                  <label style={{flex:1,fontSize:13,fontWeight:600}}>סיום
                    {modal.isNight ? (
                      <div className="form-input" style={{display:"flex",alignItems:"center",minHeight:42,color:NIGHT_COLOR,fontWeight:700}}>
                        קביעת לילה כללית
                      </div>
                    ) : (
                      <select name="endTime" className="form-input" defaultValue={modal.defaultEnd}>
                        {DAY_HOURS.map(h=><option key={h}>{h}</option>)}
                      </select>
                    )}
                  </label>
                </div>
                <label style={{fontSize:13,fontWeight:600}}>הערות
                  <textarea name="notes" className="form-input" rows={2} defaultValue={modal.notes||""} placeholder="תיאור הפרויקט..."/>
                </label>
                {isControlRoomStudio(studios.find((studio) => sameStudioId(studio.id, modal.studioId))) && studios.some(isRecordingStudio) && (
                  <label style={{fontSize:13,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,background:"rgba(245,166,35,0.08)",border:"1px solid rgba(245,166,35,0.35)",borderRadius:8,padding:"10px 12px"}}>
                    <span>הוספת סטודיו הקלטות</span>
                    <input
                      type="checkbox"
                      name="addRecordingStudio"
                      defaultChecked={bookings.some((booking) => (
                        sameStudioId(booking.studioId, studios.find(isRecordingStudio)?.id)
                        && booking.date === modal.date
                        && booking.id !== modal.bookingId
                        && isActiveStudioBooking(booking)
                        && isBookingOwnedByStudent(booking)
                        && booking.startTime === modal.defaultStart
                        && booking.endTime === modal.defaultEnd
                      ))}
                      style={{width:18,height:18,accentColor:"var(--accent)"}}
                    />
                  </label>
                )}
                <div style={{display:"flex",gap:8}}>
                  <button type="button" className="btn btn-secondary" onClick={()=>setModal(null)}>ביטול</button>
                  <button type="submit" className="btn btn-primary" disabled={saving} style={modal.isNight?{background:NIGHT_COLOR,borderColor:NIGHT_COLOR}:{}}>{saving?"שומר...":"💾 שמור שינויים"}</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Weekly calendar view ──
  return (
    <div style={{padding:"20px 16px",direction:"rtl"}}>
      {/* ── Month/year header ── */}
      <div style={{textAlign:"center",marginBottom:16}}>
        <div style={{fontSize:22,fontWeight:900,color:"var(--accent)"}}>{weekMonthLabel}</div>
      </div>

      {/* ── Layout: mini calendar + week nav ── */}
      <div style={{display:"flex",gap:20,marginBottom:20,flexWrap:"wrap",justifyContent:"center"}}>
        {/* Mini calendar */}
        <div style={{minWidth:220,maxWidth:260,background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",padding:12}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <button onClick={()=>setMiniMonth(m=>{ const prev = m.month===0 ? {year:m.year-1,month:11} : {year:m.year,month:m.month-1}; return prev; })}
              style={{background:"none",border:"none",color:"var(--text2)",cursor:"pointer",fontSize:16,padding:"2px 6px"}}>→</button>
            <span style={{fontWeight:800,fontSize:14,color:"var(--text)"}}>{HE_MONTHS[miniMonth.month]} {miniMonth.year}</span>
            <button onClick={()=>setMiniMonth(m=>{ const next = m.month===11 ? {year:m.year+1,month:0} : {year:m.year,month:m.month+1}; return next; })}
              style={{background:"none",border:"none",color:"var(--text2)",cursor:"pointer",fontSize:16,padding:"2px 6px"}}>←</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:1,textAlign:"center"}}>
            {HE_DAYS_SHORT.map(d=><div key={d} style={{fontSize:10,fontWeight:700,color:"var(--text3)",padding:"4px 0"}}>{d}</div>)}
            {miniDays.map((day,i)=>{
              const past = isPastMiniDay(day);
              return (
                <div key={i}
                  onClick={()=>{ if(day && !past) jumpToDate(day); }}
                  style={{
                    fontSize:12,fontWeight:isInCurrentWeek(day)?800:500,padding:"5px 0",
                    cursor: past ? "default" : day ? "pointer" : "default",
                    borderRadius:"50%",
                    opacity: past ? 0.35 : 1,
                    background: isTodayMini(day) ? "var(--accent)" : isInCurrentWeek(day) ? "rgba(245,166,35,0.15)" : "transparent",
                    color: isTodayMini(day) ? "#000" : isInCurrentWeek(day) ? "var(--accent)" : day ? "var(--text)" : "transparent",
                    transition:"background 0.15s"
                  }}>
                  {day || ""}
                </div>
              );
            })}
          </div>
          <button onClick={()=>{ setWeekOffset(0); const d=new Date(); setMiniMonth({year:d.getFullYear(),month:d.getMonth()}); }}
            style={{width:"100%",marginTop:8,padding:"6px 0",borderRadius:6,border:"1px solid var(--accent)",background:"transparent",color:"var(--accent)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
            <Calendar size={14} strokeWidth={1.75} color="var(--accent)" /> היום
          </button>
        </div>

        {/* Week navigation */}
        <div style={{flex:1,minWidth:280,display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",justifyContent:"center",marginTop:2}}>
            <div style={{background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",padding:"12px 14px",display:"flex",flexDirection:"column",gap:4,minWidth:220,textAlign:"center"}}>
              <div style={{fontWeight:800,fontSize:14,color:"var(--text)"}}>בנק שעות עתידיות</div>
              <div style={{fontSize:22,fontWeight:900,color:"var(--accent)"}}>{formatStudioHoursValue(remainingFutureHours)}</div>
              <div style={{fontSize:12,color:"var(--text3)"}}>מתוך {formatStudioHoursValue(studioFutureHoursLimit)} שעות זמינות</div>
              <div style={{fontSize:11,color:"var(--text3)"}}>רק שעות עתידיות שעדיין לא הסתיימו נספרות בבנק.</div>
            </div>
          </div>
          <div style={{display:"flex",justifyContent:"center",marginTop:6,gap:8,flexWrap:"wrap"}}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={openSmartBookingFromCalendar}
              style={{display:"inline-flex",alignItems:"center",gap:6}}
            >
              ✨ קביעת חדר חכמה
            </button>
            <button
              type="button"
              onClick={()=>setStudioCertsOpen(true)}
              style={{display:"inline-flex",alignItems:"center",gap:6,padding:"8px 14px",borderRadius:"var(--r-sm)",border:"1px solid var(--border)",background:"var(--surface2)",color:"var(--text)",fontWeight:700,fontSize:13,cursor:"pointer"}}
            >
              <Shield size={14} strokeWidth={1.75} color="var(--accent)"/> סטטוס הסמכות החדרים שלי
            </button>
          </div>
        </div>
      </div>

      {showAiAssistant && (
        <div
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3200,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
          onClick={(e)=>e.target===e.currentTarget&&closeSmartBookingModal()}
        >
          <div style={{width:"100%",maxWidth:560,background:"var(--surface)",borderRadius:18,border:"1px solid var(--border)",direction:"rtl",boxShadow:"0 30px 80px rgba(0,0,0,0.35)"}}>
            <div style={{padding:"18px 22px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
              <div>
                <div style={{fontWeight:900,fontSize:18,color:"var(--accent)"}}>✨ קביעת חדר חכמה</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:4}}>כתבו את הבקשה בשפה חופשית והמערכת תנסה לקבוע את החדר ישירות בלוח הכללי.</div>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={closeSmartBookingModal} disabled={isAiLoading}>סגור</button>
            </div>
            <form
              onSubmit={(e)=>{
                e.preventDefault();
                handleSmartBooking(smartBookingPrompt.trim(), studios);
              }}
              style={{padding:22,display:"flex",flexDirection:"column",gap:14}}
            >
              <label style={{display:"flex",flexDirection:"column",gap:8,fontWeight:700,color:"var(--text2)"}}>
                מה תרצו לקבוע?
                <textarea
                  className="form-input"
                  rows={5}
                  value={smartBookingPrompt}
                  onChange={(e)=>setSmartBookingPrompt(e.target.value)}
                  placeholder='למשל: אני צריך חדר עריכה מחר מ-12:00 עד 16:00'
                  style={{resize:"vertical",minHeight:140}}
                />
              </label>
              <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.6}}>
                החדר ייקבע אוטומטית רק אם הבקשה תואמת להסמכות הפעילות שלך ולחסימות הקיימות בלוח החדרים.
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                {isAiLoading && <span style={{fontSize:12,color:"var(--accent)",fontWeight:700}}>מעבד בקשה...</span>}
                <div style={{display:"flex",gap:8,marginInlineStart:"auto"}}>
                  <button type="button" className="btn btn-secondary" onClick={closeSmartBookingModal} disabled={isAiLoading}>ביטול</button>
                  <button type="submit" className="btn btn-primary" disabled={isAiLoading || !smartBookingPrompt.trim()}>
                    {isAiLoading ? "קובע..." : "קבע לי"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {studios.length===0 ? (
        <div style={{textAlign:"center",padding:48,color:"var(--text3)"}}>
          <div style={{fontSize:48,marginBottom:12}}><Mic size={48} strokeWidth={1.75} color="var(--accent)" /></div>
          <div style={{fontWeight:700}}>אין אולפנים זמינים כרגע</div>
        </div>
      ) : (
        <>
          {calendarFullscreen && <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:8999}} onClick={()=>setCalendarFullscreen(false)}/>}
          <div style={calendarFullscreen ? {position:"fixed",inset:8,zIndex:9000,background:"var(--bg)",borderRadius:16,border:"1px solid var(--border)",display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 20px 60px rgba(0,0,0,0.6)"} : {}}>
          <div style={{padding:"6px 12px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:calendarFullscreen?"16px 16px 0 0":"8px 8px 0 0",display:"flex",justifyContent:"center",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <button className="btn btn-secondary btn-sm" onClick={()=>setWeekOffset(w=>w-1)} disabled={weekOffset<=0} style={{opacity:weekOffset<=0?0.4:1,cursor:weekOffset<=0?"default":"pointer"}}>→ שבוע קודם</button>
              <button className="btn btn-secondary btn-sm" onClick={()=>setWeekOffset(0)}>היום</button>
              <button className="btn btn-secondary btn-sm" onClick={()=>setWeekOffset(w=>w+1)}>← שבוע הבא</button>
              <span style={{fontSize:12,color:"var(--text3)"}}>
                {weekDays[0].date}/{String(new Date(weekDays[0].fullDate).getMonth()+1).padStart(2,"0")} — {weekDays[6].date}/{String(new Date(weekDays[6].fullDate).getMonth()+1).padStart(2,"0")}
              </span>
              <button className="btn btn-secondary btn-sm" onClick={()=>setCalendarFullscreen(f=>!f)} title={calendarFullscreen?"סגור מסך מלא":"פתח מסך מלא"} style={{marginInlineStart:"auto"}}>
                {calendarFullscreen ? <><X size={16} strokeWidth={1.75} color="var(--text3)" /> סגור</> : "⛶ מסך מלא"}
              </button>
          </div>
          <div data-no-swipe="true" style={{overflowX:"auto",overflowY:calendarFullscreen?"auto":undefined,WebkitOverflowScrolling:"touch",flex:calendarFullscreen?1:undefined,maxHeight:calendarFullscreen?"calc(100vh - 120px)":undefined}}>
          <table style={{width:"100%",minWidth:700,borderCollapse:"separate",borderSpacing:0,tableLayout:"fixed"}}>
            <thead>
              <tr>
                <th style={{padding:"8px 6px",background:"var(--surface2)",fontSize:12,fontWeight:700,textAlign:"center",border:"1px solid var(--border)",width:80,position:"sticky",top:calendarFullscreen?0:undefined,right:0,zIndex:calendarFullscreen?5:3,boxShadow:"-2px 0 6px rgba(0,0,0,0.18)"}}>חדר</th>
                {weekDays.map(d=>(
                  <th key={d.fullDate} style={{padding:"8px 6px",background:d.isToday?"var(--accent)":"var(--surface2)",color:d.isToday?"#000":undefined,fontSize:12,fontWeight:700,textAlign:"center",border:"1px solid var(--border)",position:calendarFullscreen?"sticky":undefined,top:0,zIndex:3}}>
                    <div>{d.name}</div><div style={{fontSize:11,color:d.isToday?"#000":"var(--text3)"}}>{d.date}/{String(new Date(d.fullDate).getMonth()+1).padStart(2,"0")}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {studios.map(studio=>{
                const maintenanceBlocked = isStudioDisabled(studio.id);
                const blocked = maintenanceBlocked || !hasStudioCert(studio.id);
                const certName = getStudioCertName(studio.id);
                return (
                <tr key={studio.id} style={{opacity:blocked?0.5:1}}>
                  <td style={{padding:"6px 4px",border:"1px solid var(--border)",background:blocked?"rgba(231,76,60,0.08)":"var(--surface2)",verticalAlign:"middle",position:"sticky",right:0,zIndex:2,boxShadow:"-2px 0 6px rgba(0,0,0,0.18)",cursor:"pointer"}}
                    onClick={()=>setStudioInfoPanel(studio)}>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                      {studio.image?.startsWith("data:") || studio.image?.startsWith("http")
                        ? <img src={studio.image} alt={studio.name} style={{width:32,height:32,borderRadius:6,objectFit:"cover"}}/>
                        : <span style={{fontSize:18,lineHeight:1}}>{studio.image||<Mic size={18} strokeWidth={1.75} color="var(--accent)" />}</span>
                      }
                      <span style={{fontSize:10,fontWeight:800,lineHeight:1.2,wordBreak:"break-word",textAlign:"center"}}>{studio.name}</span>
                      {studio.isClassroom && <div style={{fontSize:9,color:"#3498db",fontWeight:800}}>🏫 כיתה</div>}
                      {maintenanceBlocked && <div style={{fontSize:9,color:"var(--red)",fontWeight:800}}>🔧 בתחזוקה</div>}
                      {!maintenanceBlocked && blocked && <div style={{fontSize:9,color:"var(--red)",fontWeight:800}}>⛔ חסר הסמכה</div>}
                      <div style={{fontSize:9,color:"var(--accent)",fontWeight:700,marginTop:1}}><Info size={9} strokeWidth={1.75} color="var(--accent)" /></div>
                    </div>
                  </td>
                  {weekDays.map(day=>{
                    const cells = bookings.filter(b=>sameStudioId(b.studioId, studio.id) && b.date===day.fullDate && isActiveStudioBooking(b)).sort((a,b)=>(a.startTime||"").localeCompare(b.startTime||""));
                    const isPast = day.fullDate < todayStr;
                    return (
                      <td key={day.fullDate}
                        style={{
                          padding:"4px 6px",border:"1px solid var(--border)",verticalAlign:"top",
                          cursor: blocked ? "not-allowed" : isPast ? "not-allowed" : "pointer",
                          background: blocked ? "rgba(231,76,60,0.04)" : isPast ? "rgba(0,0,0,0.12)" : day.isToday ? "rgba(245,166,35,0.05)" : "transparent",
                          opacity: isPast ? 0.55 : 1
                        }}
                        onClick={()=>{ if(!blocked && !isPast){ setModal(null); setDayView({studioId:studio.id,date:day.fullDate,dayName:day.name}); } }}>
                        {maintenanceBlocked && !isPast && <div style={{color:"var(--red)",fontSize:9,textAlign:"center",paddingTop:8,fontWeight:700,lineHeight:1.5}}>{STUDIO_MAINTENANCE_MESSAGE}</div>}
                        {!maintenanceBlocked && blocked && !isPast && <div style={{color:"var(--red)",fontSize:9,textAlign:"center",paddingTop:8,fontWeight:700}}><Shield size={9} strokeWidth={1.75} /></div>}
                        {!blocked && cells.map(b=>{
                          const color = getBookingColor(b);
                          return (
                            <div key={b.id} style={{background:color+"22",border:`1.5px solid ${color}`,borderRadius:4,padding:"4px 6px",marginBottom:3,fontSize:11,wordBreak:"break-word",whiteSpace:"normal",textAlign:"right"}}>
                              <div style={{fontWeight:900,color,fontSize:11}}>{b.isNight?"🌙 ":""}{getStudioBookingTimeLabel(b)}</div>
                              <div style={{color:"var(--text)",fontWeight:800,fontSize:11,lineHeight:1.35}}>{getBookingTitle(b)}</div>
                              {getBookingSubtitle(b) && <div style={{color:"var(--text2)",fontSize:10,fontWeight:600,lineHeight:1.3,marginTop:1}}>{getBookingSubtitle(b)}</div>}
                            </div>
                          );
                        })}
                        {!blocked && cells.length===0 && !isPast && <div style={{color:"var(--text3)",fontSize:10,textAlign:"center",paddingTop:8}}>פנוי</div>}
                        {isPast && !blocked && cells.length===0 && <div style={{color:"var(--text3)",fontSize:10,textAlign:"center",paddingTop:8}}>—</div>}
                      </td>
                    );
                  })}
                </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          </div>
        </>
      )}
      {studioInfoPanel && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:10000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}}
          onClick={e=>e.target===e.currentTarget&&setStudioInfoPanel(null)}>
          <div style={{width:"100%",maxWidth:880,maxHeight:"92vh",background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",direction:"rtl",overflow:"hidden",display:"flex",flexDirection:"column"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 18px",borderBottom:"1px solid var(--border)",background:"var(--surface2)",flexShrink:0}}>
              <div style={{fontWeight:900,fontSize:16}}>{studioInfoPanel.name}</div>
              <button className="btn btn-secondary btn-sm" onClick={()=>setStudioInfoPanel(null)}><X size={16} strokeWidth={1.75} color="var(--text3)" /></button>
            </div>
            <div style={{padding:"20px",display:"flex",flexDirection:"column",alignItems:"center",gap:16,overflowY:"auto",flex:1}}>
              {studioInfoPanel.image?.startsWith("http") || studioInfoPanel.image?.startsWith("data:")
                ? <img src={studioInfoPanel.image} alt={studioInfoPanel.name} style={{width:"100%",maxHeight:"70vh",objectFit:"contain",borderRadius:10,background:"#000",imageRendering:"auto"}}/>
                : <div style={{fontSize:96,lineHeight:1}}>{studioInfoPanel.image||<Mic size={96} strokeWidth={1.75} color="var(--accent)" />}</div>
              }
              {studioInfoPanel.description
                ? <p style={{fontSize:14,color:"var(--text)",lineHeight:1.7,textAlign:"right",margin:0,whiteSpace:"pre-wrap",alignSelf:"stretch"}}>{studioInfoPanel.description}</p>
                : <p style={{fontSize:13,color:"var(--text3)",margin:0}}>אין תיאור לחדר זה.</p>
              }
            </div>
          </div>
        </div>
      )}
      {renderAddBookingModal()}
      {/* Night policies modal — always shown for night bookings */}
      {nightPolicyPending && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:"var(--surface, #1a1a2e)",borderRadius:12,maxWidth:500,width:"100%",maxHeight:"80vh",display:"flex",flexDirection:"column",border:"1px solid var(--border)",boxShadow:"0 8px 32px rgba(0,0,0,0.5)"}}>
            <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",fontWeight:800,fontSize:15,textAlign:"center",color:"#f5a623"}}>🌙 נהלי קביעת חדר לילה</div>
            {policies?.לילה ? (
              <div
                ref={el=>{ if(el && el.scrollHeight <= el.clientHeight + 30) setNightPolicyScrolled(true); }}
                style={{padding:"16px 20px",overflowY:"auto",flex:1,fontSize:14,lineHeight:1.9,direction:"rtl",color:"var(--text2)"}}
                onScroll={e=>{
                  const el = e.target;
                  if (el.scrollHeight - el.scrollTop - el.clientHeight < 30) setNightPolicyScrolled(true);
                }}
              >
                <div className="policy-content" dangerouslySetInnerHTML={{__html:policyHtml(policies.לילה)}} />
              </div>
            ) : (
              <div style={{padding:"16px 20px",flex:1,fontSize:13,lineHeight:1.7,direction:"rtl",color:"var(--text2)"}}>
                קביעת חדר לילה מחייבת עמידה בנהלי הלילה של המכללה.
              </div>
            )}
            <div style={{padding:"16px 20px",borderTop:"1px solid var(--border)",display:"flex",flexDirection:"column",gap:10}}>
              {policies?.לילה && !nightPolicyScrolled && <div style={{fontSize:11,color:"var(--text3)",textAlign:"center"}}>יש לגלול לתחתית הנהלים כדי להמשיך</div>}
              <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,fontWeight:600,cursor:(nightPolicyScrolled||!policies?.לילה)?"pointer":"not-allowed",opacity:(nightPolicyScrolled||!policies?.לילה)?1:0.4}}>
                <input type="checkbox" checked={nightPolicyAgreed} disabled={!!(policies?.לילה && !nightPolicyScrolled)} onChange={e=>setNightPolicyAgreed(e.target.checked)}/>
                אני מתחייב/ת לעמוד בכל נהלי קביעת חדר לילה
              </label>
              <div style={{display:"flex",gap:8,justifyContent:"center"}}>
                <button className="btn btn-secondary" onClick={()=>setNightPolicyPending(null)}>ביטול</button>
                <button
                  className="btn btn-primary"
                  disabled={!nightPolicyAgreed}
                  onClick={async()=>{
                    const args = nightPolicyPending;
                    setNightPolicyPending(null);
                    try {
                      const normalizedStartTime = args.isNight ? NIGHT_START_TIME : args.startTime;
                      const normalizedEndTime = args.isNight ? NIGHT_END_TIME : args.endTime;
                      const validationError = getStudioBookingValidationError({ studioId:args.studioId, date:args.date, startTime:normalizedStartTime, endTime:normalizedEndTime, isNight:args.isNight, blockedMessage:args.blockedMessage });
                      if (validationError) { showToast("error",validationError); return; }
                      const parallelConflict = checkStudentParallelBooking(args.date, normalizedStartTime, normalizedEndTime);
                      if (parallelConflict) { showToast("error", `פעולה נחסמה: אינך יכול להזמין שני חדרים במקביל באותן השעות (${parallelConflict.startTime}–${parallelConflict.endTime})`); setNightPolicyPending(null); return; }
                      const newBooking = { id:Date.now(), bookingKind:"student", studioId:args.studioId, date:args.date, startTime:normalizedStartTime, endTime:normalizedEndTime, studentName:student.name, studentEmail:student.email||"", studentPhone:student.phone||"", studentId:student?.id??null, notes:args.notes, isNight:args.isNight, createdAt:new Date().toISOString() };
                      const next = [...bookings, newBooking];
                      setBookings(next);
                      const saveRes = await upsertStudioBooking(newBooking);
                      if (saveRes?.error === "studio_overlap") {
                        setBookings(bookings); // revert optimistic add — server EXCLUDE guard rejected an overlap
                        showToast("error", "קיימת כבר קביעה חופפת על החדר בזמנים הללו. רענן/י ונס/י שוב.");
                        return;
                      }
                      showToast("success", args.successMessage || "החדר הוזמן בהצלחה!");
                      closeBookingModal();
                    } catch(err) {
                      console.error("night booking confirm error", err);
                      showToast("error","אירעה שגיאה בשמירת ההזמנה. נסה שוב.");
                    }
                  }}
                >
                  <span style={{display:"inline-flex",alignItems:"center",gap:4}}>אני מאשר/ת <CheckCircle size={16} strokeWidth={1.75} /></span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <CertificationsStatusPanel
        open={studioCertsOpen}
        onClose={()=>setStudioCertsOpen(false)}
        title="סטטוס הסמכות החדרים שלי"
        certs={studioCertsList}
      />
    </div>
  );
}
