// LessonsPage.jsx — course & lesson schedule management
import { Fragment, useRef, useState, useEffect, useLayoutEffect } from "react";
import * as XLSX from "xlsx";
import { Award, BookOpen, Calendar, Camera, Check, CheckCircle, Clock, Download, FileText, Film, GraduationCap, Lightbulb, Link, Mail, Mic, Package, Pencil, Phone, Plus, Search, Trash2, Upload, User, Video, X, XCircle } from "lucide-react";
import { formatDate, formatLocalDateInput, parseLocalDate, today, getAuthToken } from "../utils.js";
import { listStudents } from "../utils/studentsApi.js";
import { syncAllStudioBookings } from "../utils/studioBookingsApi.js";
import { syncAllLessons } from "../utils/lessonsApi.js";
import { getEffectiveLessonStudioIds } from "../utils/lessonBookings.js";
import { rangesOverlap } from "../utils/studioOverlap.js";

// Stage 8 fix: previously a module-scoped counter (`sk-${++_skeyCounter}`)
// reset on every page load, so newly-added sessions could collide with
// `sk-1`/`sk-2`/... keys that legacy sessions already had stored in the
// blob/table. Now we generate collision-resistant keys with a timestamp +
// random suffix on first creation, then preserve them through edits.
function newScheduleKey() {
  return `sk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatLessonDateShort(value) {
  const date = parseLocalDate(value);
  if (!date || Number.isNaN(date.getTime())) return String(value || "");
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
}

function parseLessonDateShort(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{1,2})[./:-](\d{1,2})[./:-](\d{2}|\d{4})$/);
  if (!match) return "";
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) return "";
  return formatLocalDateInput(date);
}

function LessonDateInput({ value, onChange, className = "form-input", style = {}, title = "תאריך" }) {
  const [displayValue, setDisplayValue] = useState(formatLessonDateShort(value));
  const nativeDateRef = useRef(null);

  useEffect(() => {
    setDisplayValue(formatLessonDateShort(value));
  }, [value]);

  const commit = () => {
    const nextValue = parseLessonDateShort(displayValue);
    if (nextValue) {
      onChange(nextValue);
      setDisplayValue(formatLessonDateShort(nextValue));
    } else {
      setDisplayValue(formatLessonDateShort(value));
    }
  };

  const openDatePicker = () => {
    const input = nativeDateRef.current;
    if (!input) return;
    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }
    input.click();
  };

  return (
    <div style={{position:"relative",width:style?.width || "100%"}}>
      <input
        className={className}
        type="text"
        inputMode="numeric"
        dir="ltr"
        title={title}
        placeholder="DD/MM/YY"
        value={displayValue}
        style={{...style,paddingRight:style?.paddingRight || 38,paddingLeft:style?.paddingLeft || 12,textAlign:"right",direction:"rtl"}}
        onChange={event => setDisplayValue(event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDisplayValue(formatLessonDateShort(value));
            event.currentTarget.blur();
          }
        }}
      />
      <button
        type="button"
        aria-label="פתח לוח שנה"
        title="פתח לוח שנה"
        onClick={openDatePicker}
        style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",width:24,height:24,border:"none",background:"transparent",color:"var(--text2)",display:"inline-flex",alignItems:"center",justifyContent:"center",cursor:"pointer",padding:0}}
      >
        <Calendar size={16} strokeWidth={1.9}/>
      </button>
      <input
        ref={nativeDateRef}
        type="date"
        value={value || ""}
        tabIndex={-1}
        aria-hidden="true"
        onChange={event => onChange(event.target.value)}
        style={{position:"absolute",right:8,top:"50%",width:24,height:24,opacity:0,pointerEvents:"none"}}
      />
    </div>
  );
}

function sortScheduleEntries(entries = []) {
  return [...entries].sort((a, b) => {
    const aDateTime = `${a?.date || ""} ${a?.startTime || "00:00"}`;
    const bDateTime = `${b?.date || ""} ${b?.startTime || "00:00"}`;
    return aDateTime.localeCompare(bDateTime, "he");
  });
}

// Inline editor card inside the lesson-vs-lesson conflict resolver modal.
// Lets the admin tweak the OTHER lesson's specific conflicting session
// (date/time/lecturer/classrooms) without leaving the current edit. On save,
// the parent persists the fix and re-checks conflicts on the lesson the
// admin was originally trying to save.
function ConflictResolverCard({ conflict, otherLesson, studios = [], classroomStudios = [], lecturers = [], onSaveFix }) {
  const session = (otherLesson.schedule || [])[conflict.otherSessionIdx] || conflict.otherSession || {};
  const initialStudioIds = Array.isArray(session.studioIds) && session.studioIds.length
    ? session.studioIds.map(v => String(v || ""))
    : [session.studioId, session.secondaryStudioId].filter(Boolean).map(String);
  const courseStudioIds = (() => {
    const ids = [];
    const seen = new Set();
    const push = (id) => {
      const k = String(id || "").trim();
      if (!k || seen.has(k)) return;
      seen.add(k);
      ids.push(k);
    };
    (otherLesson.studios || []).forEach(cs => push(cs?.studioId));
    push(otherLesson.studioId);
    (otherLesson.schedule || []).forEach(s => {
      (s.studioIds || []).forEach(push);
      push(s.studioId);
      push(s.secondaryStudioId);
    });
    return ids;
  })();

  const [date, setDate] = useState(session.date || "");
  const [startTime, setStartTime] = useState(session.startTime || "09:00");
  const [endTime, setEndTime] = useState(session.endTime || "12:00");
  const [lecturerId, setLecturerId] = useState(String(session.lecturerId || ""));
  const [studioSlots, setStudioSlots] = useState(() => {
    const padded = [];
    for (let i = 0; i < Math.max(courseStudioIds.length, initialStudioIds.length); i += 1) {
      padded.push(initialStudioIds[i] || "");
    }
    return padded;
  });
  const [saving, setSaving] = useState(false);

  const lecturerById = (id) => lecturers.find(l => String(l.id) === String(id));
  const displayLecturerName = (l) => {
    const full = String(l?.fullName || "").trim();
    const parts = [l?.firstName, l?.lastName].map(p => String(p || "").trim()).filter(Boolean).join(" ");
    return full || parts;
  };
  // Minimal version of the closure-bound normalizeLessonLecturerList so this
  // module-level component doesn't depend on LessonsPage internals. Collects
  // the primary + extra lecturers + per-session lecturers, dedupes by id-or-name.
  const courseLecturers = (() => {
    const out = [];
    const seen = new Set();
    const add = (rawId, rawName) => {
      const matched = rawId ? lecturers.find(l => String(l.id) === String(rawId)) : null;
      const id = matched?.id || rawId || "";
      const name = displayLecturerName(matched) || String(rawName || "").trim();
      if (!id && !name) return;
      const key = id ? `id:${id}` : `name:${name.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ lecturerId: id || null, instructorName: name });
    };
    add(otherLesson.lecturerId, otherLesson.instructorName);
    (otherLesson.lecturers || []).forEach(item => add(item?.lecturerId, item?.instructorName));
    (otherLesson.schedule || []).forEach(s => add(s?.lecturerId || s?.alternateLecturerId, s?.instructorName || s?.alternateInstructorName));
    return out;
  })();
  const studioName = (id) => studios.find(st => String(st.id) === String(id))?.name || id;

  const setSlot = (idx, value) => {
    setStudioSlots(prev => {
      const next = [...prev];
      while (next.length <= idx) next.push("");
      next[idx] = String(value || "");
      return next;
    });
  };

  const handleSave = async () => {
    if (!date || !startTime || !endTime || startTime >= endTime) {
      alert("יש למלא תאריך + שעות תקינים (התחלה < סיום).");
      return;
    }
    setSaving(true);
    try {
      const selectedLecturer = courseLecturers.find(cl => String(cl.lecturerId || "") === String(lecturerId));
      const instructorName = selectedLecturer?.instructorName
        || displayLecturerName(lecturerById(lecturerId))
        || "";
      const cleanedSlots = studioSlots.map(v => String(v || ""));
      await onSaveFix({
        date,
        startTime,
        endTime,
        lecturerId: lecturerId || null,
        instructorName,
        studioIds: cleanedSlots,
      });
    } finally {
      setSaving(false);
    }
  };

  const conflictBadge = conflict.kind === "room"
    ? { color: "#3498db", text: `חפיפת חדר: ${conflict.studioName || studioName(conflict.studioId)}` }
    : { color: "#9b59b6", text: `חפיפת מרצה: ${conflict.lecturerName || ""}` };

  const currentBlock = conflict.currentSession || {};
  const currentStudioNames = (Array.isArray(currentBlock.studioIds) && currentBlock.studioIds.length
    ? currentBlock.studioIds
    : [currentBlock.studioId, currentBlock.secondaryStudioId].filter(Boolean))
    .map(studioName)
    .filter(Boolean)
    .join(" + ");

  return (
    <div style={{background:"var(--surface2)",borderRadius:10,padding:"12px 14px",border:"1px solid rgba(231,76,60,0.25)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,flexWrap:"wrap",marginBottom:8}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:800,fontSize:14,display:"flex",alignItems:"center",gap:6}}>
            <BookOpen size={14} strokeWidth={1.75}/> {otherLesson.name || "(ללא שם)"}
            {otherLesson.track ? <span style={{fontSize:11,color:"var(--text3)",fontWeight:600}}>· {otherLesson.track}</span> : null}
          </div>
        </div>
        <span style={{background:`${conflictBadge.color}22`,color:conflictBadge.color,fontWeight:800,fontSize:11,padding:"3px 8px",borderRadius:999,whiteSpace:"nowrap"}}>
          🚨 {conflictBadge.text}
        </span>
      </div>
      <div style={{fontSize:11,color:"var(--text3)",marginBottom:10,padding:"6px 8px",background:"rgba(0,0,0,0.18)",borderRadius:6}}>
        המפגש שלך: {formatLessonDateShort(currentBlock.date)} · {currentBlock.startTime}–{currentBlock.endTime}{currentStudioNames ? ` · ${currentStudioNames}` : ""}
      </div>
      <div style={{fontSize:11,color:"var(--text3)",marginBottom:6,fontWeight:700}}>✏️ ערוך את המפגש בקורס המתנגש:</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:8,marginBottom:8}}>
        <div>
          <div style={{fontSize:11,color:"var(--text3)",marginBottom:2}}>תאריך</div>
          <LessonDateInput value={date} onChange={setDate} style={{fontSize:12,padding:"4px 6px",height:32}}/>
        </div>
        <div>
          <div style={{fontSize:11,color:"var(--text3)",marginBottom:2}}>שעת התחלה</div>
          <select className="form-select" value={startTime} onChange={e=>setStartTime(e.target.value)} style={{fontSize:12,padding:"4px 6px",height:32,width:"100%",boxSizing:"border-box"}}>
            {LESSON_TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:11,color:"var(--text3)",marginBottom:2}}>שעת סיום</div>
          <select className="form-select" value={endTime} onChange={e=>setEndTime(e.target.value)} style={{fontSize:12,padding:"4px 6px",height:32,width:"100%",boxSizing:"border-box"}}>
            {LESSON_TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:11,color:"var(--text3)",marginBottom:2}}>מרצה</div>
          <select className="form-select" value={lecturerId} onChange={e=>setLecturerId(e.target.value)} style={{fontSize:12,padding:"4px 6px",height:32,width:"100%",boxSizing:"border-box"}}>
            <option value="">ללא שיוך</option>
            {[...courseLecturers].sort((a,b)=>String(a.instructorName||"").localeCompare(String(b.instructorName||""),"he")).map(cl => (
              <option key={cl.lecturerId || cl.instructorName} value={cl.lecturerId || ""}>{cl.instructorName}</option>
            ))}
          </select>
        </div>
      </div>
      {courseStudioIds.length > 0 && (
        <div style={{marginBottom:10}}>
          <div style={{fontSize:11,color:"var(--text3)",marginBottom:4}}>כיתות</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(130px, 1fr))",gap:8}}>
            {courseStudioIds.map((_, colIdx) => {
              const currentValue = studioSlots[colIdx] || "";
              const usedByOthers = new Set(studioSlots.filter((v, j) => j !== colIdx && v));
              // Show ALL classrooms in the system so the admin can move the
              // conflicting session to any available room — not just the ones
              // already configured on the other course.
              const optionStudios = [...classroomStudios].sort((a, b) =>
                String(a.name || "").localeCompare(String(b.name || ""), "he")
              );
              const orphan = currentValue && !optionStudios.some(st => String(st.id) === currentValue)
                ? studios.find(st => String(st.id) === currentValue)
                : null;
              return (
                <select key={colIdx} className="form-select" value={currentValue} onChange={e=>setSlot(colIdx, e.target.value)} style={{fontSize:12,padding:"4px 6px",height:32,width:"100%",boxSizing:"border-box"}}>
                  <option value="">ללא שיוך</option>
                  {optionStudios.map(st => (
                    <option key={st.id} value={st.id} disabled={usedByOthers.has(String(st.id))}>{st.name}</option>
                  ))}
                  {orphan && <option key={orphan.id} value={orphan.id}>{orphan.name}</option>}
                </select>
              );
            })}
          </div>
        </div>
      )}
      <div style={{display:"flex",justifyContent:"flex-end"}}>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving} style={{background:"#2ecc71",borderColor:"#2ecc71"}}>
          {saving ? <><Clock size={14} strokeWidth={1.75}/> שומר…</> : <><Check size={14} strokeWidth={1.75}/> שמור תיקון</>}
        </button>
      </div>
    </div>
  );
}

function normalizeScheduleEntry(entry = {}) {
  const isLegacyKey = !entry?._key || /^sk-\d+$/.test(entry._key);
  const lecturerIds = normalizeScheduleLecturerIds(entry);
  const lecturerId = lecturerIds[0] || entry?.lecturerId || entry?.alternateLecturerId || null;
  const instructorName = String(entry?.instructorName || entry?.alternateInstructorName || "").trim();
  return {
    _key: isLegacyKey ? newScheduleKey() : entry._key,
    date: entry?.date || "",
    startTime: entry?.startTime || "09:00",
    endTime: entry?.endTime || "12:00",
    topic: String(entry?.topic || "").trim(),
    studioIds: normalizeScheduleStudioIds(entry),
    kitId: entry?.kitId || null,
    lecturerId,
    lecturerIds,
    instructorName,
  };
}

function normalizeScheduleLecturerIds(entry = {}) {
  // Position-preserving: each index is an independent lecturer column slot.
  // Legacy scalar `lecturerId` is promoted to [lecturerId] so column 1 holds
  // the original assignment.
  if (Array.isArray(entry?.lecturerIds)) {
    return entry.lecturerIds.map(v => (v === null || v === undefined) ? "" : String(v).trim());
  }
  const legacyId = entry?.lecturerId || entry?.alternateLecturerId || "";
  return legacyId ? [String(legacyId).trim()] : [];
}

function normalizeScheduleStudioIds(entry = {}) {
  // Position-preserving normalization: each index is independent.
  // Explicit studioIds keeps gaps ("" entries) so that column N stays at
  // index N for every session. Legacy entries fall back to a packed list.
  if (Array.isArray(entry.studioIds)) {
    return entry.studioIds.map(v => (v === null || v === undefined) ? "" : String(v).trim());
  }
  const out = [];
  if (entry.studioId) out.push(String(entry.studioId).trim());
  if (entry.secondaryStudioId && String(entry.secondaryStudioId) !== String(entry.studioId || "")) {
    out.push(String(entry.secondaryStudioId).trim());
  }
  return out;
}

function dedupeScheduleEntries(entries = []) {
  const byTime = new Map();
  for (const entry of sortScheduleEntries(entries)) {
    const normalized = normalizeScheduleEntry(entry);
    if (Array.isArray(entry?.sourceRows)) normalized.sourceRows = entry.sourceRows;
    const key = `${normalized.date}__${normalized.startTime}__${normalized.endTime}`;
    const existing = byTime.get(key);
    if (!existing) {
      byTime.set(key, normalized);
      continue;
    }
    if (!existing.topic && normalized.topic) existing.topic = normalized.topic;
    if (!existing.kitId && normalized.kitId) existing.kitId = normalized.kitId;
    if (!existing.lecturerId && normalized.lecturerId) existing.lecturerId = normalized.lecturerId;
    if (!existing.instructorName && normalized.instructorName) existing.instructorName = normalized.instructorName;
    if (Array.isArray(normalized.sourceRows)) {
      existing.sourceRows = [...(existing.sourceRows || []), ...normalized.sourceRows];
    }
    // Merge studioIds position-preserving: prefer the existing value per slot,
    // fill empty slots from the incoming entry, then append any extra studios.
    const existingIds = [...(existing.studioIds || [])];
    const incomingIds = [...(normalized.studioIds || [])];
    const maxLen = Math.max(existingIds.length, incomingIds.length);
    const seenNonEmpty = new Set(existingIds.filter(Boolean).map(String));
    const merged = [];
    for (let i = 0; i < maxLen; i += 1) {
      const e = existingIds[i] || "";
      const inc = incomingIds[i] || "";
      let chosen = e || inc;
      if (chosen) {
        const k = String(chosen);
        if (seenNonEmpty.has(k) && e !== chosen) chosen = "";
        else seenNonEmpty.add(k);
      }
      merged.push(chosen);
    }
    // If the incoming brings extra non-empty studios beyond max length, append.
    for (const inc of incomingIds) {
      if (!inc) continue;
      const k = String(inc);
      if (seenNonEmpty.has(k)) continue;
      seenNonEmpty.add(k);
      merged.push(k);
    }
    existing.studioIds = merged;
  }
  return [...byTime.values()];
}

function getLessonDisplaySchedule(lesson = {}) {
  return dedupeScheduleEntries(lesson?.schedule || []);
}

function getLessonSessionStudioIds(session = {}, lesson = {}) {
  return getEffectiveLessonStudioIds(session, lesson).map(String);
}

// Normalize Israeli phone numbers to international format for wa.me deep links.
// Accepts inputs like "054-123-4567", "054 123 4567", "+972541234567", "972541234567"
// and returns "972541234567". Returns "" if no usable digits found.
function normalizeIsraeliPhone(raw = "") {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("972")) return digits;
  if (digits.startsWith("0")) return `972${digits.slice(1)}`;
  return digits;
}

function formatLessonDateDdMmYy(iso = "") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function isValidImportedDate(dateStr = "") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return (
    date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
  );
}

function normalizeImportedLessonTime(timeValue = "") {
  const raw = String(timeValue || "").trim();
  // Excel stores times as decimal fraction of a day (e.g. 0.375 = 09:00)
  const num = Number(raw);
  if (!isNaN(num) && num > 0 && num < 1 && !raw.includes(":")) {
    const totalMinutes = Math.round(num * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }
  const match = raw.match(/(\d{1,2}):(\d{1,2})/);
  if (!match) return "00:00";
  const hours = Math.max(0, Math.min(23, Number(match[1]) || 0));
  const minutes = Math.max(0, Math.min(59, Number(match[2]) || 0));
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function buildLessonTimeOptions(startHour = 7, endHour = 23) {
  const options = [];
  for (let hour = startHour; hour <= endHour; hour += 1) {
    ["00", "15", "30", "45"].forEach((minutes) => {
      options.push(`${String(hour).padStart(2, "0")}:${minutes}`);
    });
  }
  return options;
}

const LESSON_TIME_OPTIONS = buildLessonTimeOptions();

export function LessonsPage({ lessons=[], setLessons, studios=[], kits=[], showToast, reservations=[], setReservations, equipment=[], trackOptions=[], studioBookings=[], setStudioBookings, certifications={}, openLessonId=null, onOpenLessonConsumed=null, lecturers=[], setLecturers, teamMembers=[], siteSettings={} }) {
  const [mode, setMode] = useState(null); // null | "add" | "edit"
  const [editTarget, setEditTarget] = useState(null);
  const [pendingLesson, setPendingLesson] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [conflictSending, setConflictSending] = useState(false);
  // Optional free-text message admin writes when accepting a conflict — appended
  // to the auto-cancellation email as a "הודעה מהמכללה" block.
  const [conflictMessage, setConflictMessage] = useState("");
  // Lesson-vs-lesson conflicts (both room + lecturer kinds). Items shape:
  //   { kind: "room"|"lecturer", otherLessonId, otherLessonName, otherTrack,
  //     otherSessionIdx, otherSession, currentSessionIdx, currentSession,
  //     studioId? + studioName? (room) | lecturerKey? + lecturerName? (lecturer) }
  // The resolver panel renders one editable card per conflict.
  const [lessonConflicts, setLessonConflicts] = useState([]);
  const [importReport, setImportReport] = useState(null);
  const [editingImportErrorKey, setEditingImportErrorKey] = useState(null);
  const [importErrorDraft, setImportErrorDraft] = useState(null);
  const [retryingImportError, setRetryingImportError] = useState(false);
  const [detailTarget, setDetailTarget] = useState(null); // course detail modal
  const [search, setSearch] = useState("");
  const [trackFilter, setTrackFilter] = useState([]);
  // "grouped" (default) groups course cards under track headers; "flat" shows
  // a single uninterrupted list. The "כל המסלולים" chip toggles between the two.
  const [lessonsViewMode, setLessonsViewMode] = useState("grouped");
  const [sortMode, setSortMode] = useState("recent"); // "recent" | "urgency"
  const [archiveView, setArchiveView] = useState(false);
  const [timeFilter, setTimeFilter] = useState("all"); // "all" | "today" | "week" | "month"
  const [showUnassignedLecturerOnly, setShowUnassignedLecturerOnly] = useState(false);

  // Stage 6 step 5c: students used by studentsInTrack and the conflict-email
  // lookup come from public.students via studentsApi. Falls back to
  // certifications.students until the fetch resolves so nothing is empty.
  const [tableStudents, setTableStudents] = useState(null);
  useEffect(() => {
    let alive = true;
    listStudents().then(s => { if (alive && Array.isArray(s)) setTableStudents(s); });
    return () => { alive = false; };
  }, []);
  const studentsFromTable = tableStudents ?? (certifications?.students || []);
  const [xlImporting, setXlImporting] = useState(false);
  const [stage8Backfilling, setStage8Backfilling] = useState(false);

  // Stage 8 Session A — manually trigger a full lessons-blob → public.lessons sync.
  // Dev-only button so we can verify table parity without triggering it via a
  // user-driven save. Mirror of the lecturers backfill pattern from Stage 7.
  const runStage8Backfill = async () => {
    if (!Array.isArray(lessons) || lessons.length === 0) {
      showToast("error", "אין שיעורים ב-blob ל-backfill");
      return;
    }
    setStage8Backfilling(true);
    try {
      const r = await syncAllLessons(lessons);
      if (r?.ok) {
        showToast("success", `Stage 8 backfill: upserted ${r.upserted}, deleted ${r.deleted}`);
      } else {
        showToast("error", `Stage 8 backfill failed: ${r?.error || "unknown"}`);
      }
    } catch (err) {
      console.error("Stage 8 backfill error", err);
      showToast("error", "Stage 8 backfill: שגיאה. בדוק קונסול.");
    } finally {
      setStage8Backfilling(false);
    }
  };
  const importInputRef = useRef(null);
  const [pendingImportFile, setPendingImportFile] = useState(null);
  const [pendingImportMode, setPendingImportMode] = useState("upsert");
  const [showImportModeDialog, setShowImportModeDialog] = useState(false);

  const handleLessonsXLFileSelect = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPendingImportFile(file);
    setPendingImportMode("upsert");
    setShowImportModeDialog(true);
  };

  const closeImportModeDialog = () => {
    if (xlImporting) return;
    setShowImportModeDialog(false);
    setPendingImportFile(null);
    setPendingImportMode("upsert");
  };

  // Navigate directly to lesson edit form when openLessonId is set (e.g. from room booking).
  // useLayoutEffect runs after commit but before paint, so the mode flip happens in the
  // same paint cycle as the navigation — no flash of the course list.
  useLayoutEffect(() => {
    if (!openLessonId) return;
    const lesson = lessons.find(l => String(l.id) === String(openLessonId));
    if (lesson) {
      setEditTarget(lesson);
      setMode("edit");
      window.scrollTo(0, 0);
    }
    if (onOpenLessonConsumed) onOpenLessonConsumed();
  }, [openLessonId]);
  const normalizedTrackOptions = [...new Set((trackOptions || []).map((option) => String(option || "").trim()).filter(Boolean))];
  const isKnownTrack = (value = "") => normalizedTrackOptions.includes(String(value || "").trim());
  const normalizeStudioNameKey = (value = "") => String(value || "")
    .trim()
    .replace(/[\uFEFF\u200B-\u200D\u00A0]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, "")
    .toLowerCase();
  const findImportedStudio = (name = "") => {
    const raw = String(name || "").trim();
    if (!raw) return null;
    const exact = studios.find(studio => String(studio.name || "").trim() === raw);
    if (exact) return exact;
    const rawKey = normalizeStudioNameKey(raw);
    return studios.find(studio => normalizeStudioNameKey(studio.name) === rawKey) || null;
  };
  const splitImportCellValues = (value = "") => String(value || "")
    .split(/[\r\n,;،，]+/)
    .map(part => part.trim().replace(/^[\s{}[\]()"'\u05F3\u05F4]+|[\s{}[\]()"'\u05F3\u05F4]+$/g, "").trim())
    .filter(Boolean);
  const normalizeLecturerNameKey = (value = "") => String(value || "")
    .trim()
    .replace(/[\uFEFF\u200B-\u200D\u00A0]/g, " ")
    .replace(/(?:^|\s)(?:ד["״']?ר\.?|דר\.?|פרופ["׳']?\.?|prof\.?|dr\.?)(?=\s|$)/giu, " ")
    .replace(/[^\p{L}\p{N}"'\s.-]/gu, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  const lecturerDisplayName = (lecturer) => {
    const fullName = String(lecturer?.fullName || "").trim();
    const fromParts = [lecturer?.firstName, lecturer?.lastName].map(part => String(part || "").trim()).filter(Boolean).join(" ");
    return fullName || fromParts;
  };

  const getLecturerNameMap = () => {
    const nameToLecturer = {};
    for (const lec of lecturers) {
      const keys = [
        lecturerDisplayName(lec),
        [lec?.firstName, lec?.lastName].map(part => String(part || "").trim()).filter(Boolean).join(" "),
      ].map(normalizeLecturerNameKey).filter(Boolean);
      keys.forEach((nameKey) => {
        if (!nameToLecturer[nameKey]) nameToLecturer[nameKey] = lec;
      });
    }
    return nameToLecturer;
  };

  const normalizeLessonLecturerList = (lesson = {}) => {
    const byKey = new Map();
    const add = (lecturerId, instructorName) => {
      const id = String(lecturerId || "").trim();
      const matched = id ? lecturers.find(l => String(l.id) === id) : null;
      const name = lecturerDisplayName(matched) || String(instructorName || "").trim();
      if (!id && !name) return;
      const key = id ? `id:${id}` : `name:${normalizeLecturerNameKey(name)}`;
      if (!byKey.has(key)) byKey.set(key, { lecturerId: id || null, instructorName: name });
    };
    add(lesson.lecturerId, lesson.instructorName);
    (Array.isArray(lesson.lecturers) ? lesson.lecturers : []).forEach((lecturer) => {
      add(lecturer?.lecturerId || lecturer?.id, lecturer?.instructorName || lecturer?.fullName || lecturer?.name);
    });
    (lesson.schedule || []).forEach((session) => {
      add(session?.lecturerId || session?.alternateLecturerId, session?.instructorName || session?.alternateInstructorName);
    });
    return [...byKey.values()];
  };

  const effectiveLecturerName = (lesson = {}, session = {}) => {
    const sessionName = String(session?.instructorName || session?.alternateInstructorName || "").trim();
    if (sessionName) return sessionName;
    const sessionId = String(session?.lecturerId || session?.alternateLecturerId || "").trim();
    if (sessionId) return lecturerDisplayName(lecturers.find(l => String(l.id) === sessionId)) || sessionId;
    return String(lesson?.instructorName || "").trim();
  };

  // Link imported lessons only to existing lecturers by exact normalized name.
  const syncImportedLecturers = async (importedLessons, lessonIdsToValidate = null) => {
    const nameToLecturer = getLecturerNameMap();

    const lessonsForValidation = lessonIdsToValidate
      ? importedLessons.filter(lesson => lessonIdsToValidate.has(String(lesson?.id || "")))
      : importedLessons;

    const namesToValidate = [];
    lessonsForValidation.forEach((lesson) => {
      const mainName = String(lesson.instructorName || "").trim();
      if (mainName) namesToValidate.push(mainName);
      (Array.isArray(lesson.lecturers) ? lesson.lecturers : []).forEach((lecturer) => {
        const lecturerName = String(lecturer?.instructorName || lecturer?.name || "").trim();
        if (lecturerName) namesToValidate.push(lecturerName);
      });
      (lesson.schedule || []).forEach((session) => {
        const sessionName = String(session?.instructorName || session?.alternateInstructorName || "").trim();
        if (sessionName) namesToValidate.push(sessionName);
      });
    });

    const missingNames = [...new Set(namesToValidate
      .filter(Boolean)
      .filter(name => !nameToLecturer[normalizeLecturerNameKey(name)]))];

    if (missingNames.length > 0) {
      throw new Error(`הייבוא נכשל: המרצים הבאים לא קיימים ברובריקת המרצים: ${missingNames.join(", ")}`);
    }

    return importedLessons.map(lesson => {
      const instrName = String(lesson.instructorName || "").trim();
      const key = normalizeLecturerNameKey(instrName);
      const courseLecturers = normalizeLessonLecturerList(lesson).map((lecturer) => {
        const name = String(lecturer.instructorName || "").trim();
        const matched = lecturer.lecturerId
          ? lecturers.find(l => String(l.id) === String(lecturer.lecturerId))
          : nameToLecturer[normalizeLecturerNameKey(name)];
        return {
          lecturerId: matched?.id || lecturer.lecturerId || null,
          instructorName: lecturerDisplayName(matched) || name,
        };
      }).filter((lecturer) => lecturer.lecturerId || lecturer.instructorName);
      return {
        ...lesson,
        lecturerId: instrName ? (nameToLecturer[key]?.id || lesson.lecturerId || null) : (lesson.lecturerId || null),
        instructorName: instrName ? (lecturerDisplayName(nameToLecturer[key]) || lesson.instructorName || "") : "",
        lecturers: courseLecturers,
        schedule: (lesson.schedule || []).map((session) => {
          const sessionName = String(session?.instructorName || session?.alternateInstructorName || lesson.instructorName || "").trim();
          const sessionLecturer = session?.lecturerId
            ? lecturers.find(l => String(l.id) === String(session.lecturerId))
            : nameToLecturer[normalizeLecturerNameKey(sessionName)];
          return {
            ...session,
            lecturerId: sessionLecturer?.id || session.lecturerId || null,
            instructorName: lecturerDisplayName(sessionLecturer) || sessionName,
          };
        }),
      };
    });
  };

  const lessonKits = kits.filter(k=>(k.loanTypes||[]).includes("שיעור"));
  const getLinkedKit = (lesson) => {
    if(!lesson) return null;
    if(lesson.kitId !== null && lesson.kitId !== undefined && String(lesson.kitId).trim() !== "") {
      return lessonKits.find(k=>String(k.id)===String(lesson.kitId)) || null;
    }
    return null;
  };

  const doSaveLesson = async (lesson) => {
    const updated = editTarget
      ? lessons.map(l=>l.id===editTarget.id?lesson:l)
      : [...lessons, lesson];
    setLessons(updated);
    const result = await syncAllLessons(updated);
    if (result?.ok === false) {
      showToast("error", "השינויים נשמרו מקומית אך לא נשמרו בשרת. נסה שוב מאוחר יותר.");
    } else {
      showToast("success", `קורס "${lesson.name}" ${editTarget?"עודכן":"נוצר"}`);
    }
    setMode(null);
    setEditTarget(null);
  };

  const findBookingConflicts = (lesson) => {
    const found = [];
    const seenIds = new Set();
    const todayStr = today();
    for (const session of (lesson.schedule || [])) {
      // Only future sessions are actionable — a past session conflicting with a
      // past booking is not something the admin can (or should) resolve.
      if (session.date && session.date < todayStr) continue;
      for (const stId of getLessonSessionStudioIds(session, lesson)) {
        if (!stId) continue;
        const sessionWindow = { date: session.date, startTime: session.startTime || "00:00", endTime: session.endTime || "23:59", isNight: false };
        for (const b of studioBookings) {
          if (seenIds.has(String(b.id))) continue;
          const kind = b.bookingKind || (b.lesson_id ? "lesson" : b.teamMemberId ? "team" : "student");
          if (kind !== "student" && kind !== "team") continue;
          if (String(b.studioId) !== stId) continue;
          // Night-aware overlap (same math as the server EXCLUDE guard) — catches
          // a night booking that crosses midnight into the lesson's window too.
          if (rangesOverlap(b, sessionWindow)) {
            const studio = studios.find(s => String(s.id) === stId);
            found.push({ booking: b, session, studioName: studio?.name || "החדר" });
            seenIds.add(String(b.id));
          }
        }
      }
    }
    return found;
  };

  // Lecturer-level identity: prefer lecturerId; else fall back to normalized
  // instructor name. A "lecturer" the system knows about cannot be in two
  // courses at the same time — humans don't fork.
  const lecturerKey = (lesson) => {
    const id = String(lesson?.lecturerId || "").trim();
    if (id) return `id:${id}`;
    const name = normalizeLecturerNameKey(lesson?.instructorName || "");
    return name ? `name:${name}` : null;
  };

  const lecturerKeyForSession = (lesson, session = {}) => {
    const sessionId = String(session?.lecturerId || session?.alternateLecturerId || "").trim();
    if (sessionId) return `id:${sessionId}`;
    const sessionNameKey = normalizeLecturerNameKey(session?.instructorName || session?.alternateInstructorName || "");
    if (sessionNameKey) return `name:${sessionNameKey}`;
    return lecturerKey(lesson);
  };

  // Single-lesson check (manual save). Returns first overlap found, or null.
  const findLecturerConflict = (lesson, lessonsList = lessons) => {
    const todayStr = today();
    for (const session of (lesson.schedule || [])) {
      if (!session?.date) continue;
      if (session.date < todayStr) continue; // past sessions are not actionable
      const key = lecturerKeyForSession(lesson, session);
      if (!key) continue;
      const sS = session.startTime || "00:00", sE = session.endTime || "23:59";
      for (const other of lessonsList) {
        if (other.id === lesson.id) continue;
        for (const os of (other.schedule || [])) {
          if (lecturerKeyForSession(other, os) !== key) continue;
          if (os.date !== session.date) continue;
          const oS = os.startTime || "00:00", oE = os.endTime || "23:59";
          if (oS < sE && sS < oE) {
            return {
              lessonName: other.name || "(ללא שם)",
              lecturerName: effectiveLecturerName(lesson, session) || effectiveLecturerName(other, os) || "המרצה",
              date: os.date,
              startTime: oS,
              endTime: oE,
            };
          }
        }
      }
    }
    return null;
  };

  // Cross-lesson sweep used after bulk imports — every pair of lessons that
  // share a lecturer key on the same date with overlapping windows is a
  // conflict. Deduped by (lessonA, lessonB, date).
  const findLecturerConflictsAcross = (lessonsList) => {
    const todayStr = today();
    const buckets = new Map(); // `${key}|${date}` -> [{lesson, session}]
    for (const l of (lessonsList || [])) {
      for (const s of (l.schedule || [])) {
        if (!s?.date) continue;
        if (s.date < todayStr) continue; // past sessions are not actionable
        const key = lecturerKeyForSession(l, s);
        if (!key) continue;
        const bk = `${key}|${s.date}`;
        if (!buckets.has(bk)) buckets.set(bk, []);
        buckets.get(bk).push({ lesson: l, session: s });
      }
    }
    const conflicts = [];
    const seen = new Set();
    for (const arr of buckets.values()) {
      if (arr.length < 2) continue;
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i], b = arr[j];
          if (a.lesson.id === b.lesson.id) continue;
          const aS = a.session.startTime || "00:00", aE = a.session.endTime || "23:59";
          const bS = b.session.startTime || "00:00", bE = b.session.endTime || "23:59";
          if (aS < bE && bS < aE) {
            const ids = [String(a.lesson.id), String(b.lesson.id)].sort();
            const dedupeKey = `${ids[0]}__${ids[1]}|${a.session.date}|${aS}-${aE}|${bS}-${bE}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            conflicts.push({
              lessonA: a.lesson.name || "(ללא שם)",
              lessonB: b.lesson.name || "(ללא שם)",
              lecturerName: effectiveLecturerName(a.lesson, a.session) || effectiveLecturerName(b.lesson, b.session) || "מרצה",
              date: a.session.date,
              timeA: `${aS}–${aE}`,
              timeB: `${bS}–${bE}`,
            });
          }
        }
      }
    }
    return conflicts;
  };

  const findLessonConflict = (lesson) => {
    const todayStr = today();
    for (const session of (lesson.schedule || [])) {
      if (session.date && session.date < todayStr) continue; // past sessions are not actionable
      const sS = session.startTime || "00:00", sE = session.endTime || "23:59";
      for (const stId of getLessonSessionStudioIds(session, lesson)) {
        if (!stId) continue;
        for (const other of lessons) {
          if (other.id === lesson.id) continue; // skip self when editing
          for (const os of (other.schedule || [])) {
            if (!getLessonSessionStudioIds(os, other).includes(stId)) continue;
            if (os.date !== session.date) continue;
            const oS = os.startTime || "00:00", oE = os.endTime || "23:59";
            if (oS < sE && oE > sS) {
              const studio = studios.find(s => String(s.id) === stId);
              return { lessonName: other.name, studioName: studio?.name || "החדר", startTime: oS, endTime: oE, date: os.date };
            }
          }
        }
      }
    }
    return null;
  };

  // Returns ALL room conflicts (lesson-vs-lesson) so the resolver panel can
  // show them as a list and the admin can fix them in any order. Each entry
  // identifies the OTHER lesson + the specific session index inside it, so
  // applyOtherLessonFix can mutate that exact slot.
  const findAllLessonRoomConflicts = (lesson, lessonsList = lessons) => {
    const out = [];
    const seen = new Set();
    const todayStr = today();
    (lesson.schedule || []).forEach((session, currentSessionIdx) => {
      if (!session?.date) return;
      if (session.date < todayStr) return; // past sessions are not actionable
      const sS = session.startTime || "00:00", sE = session.endTime || "23:59";
      for (const stId of getLessonSessionStudioIds(session, lesson)) {
        if (!stId) continue;
        for (const other of lessonsList) {
          if (other.id === lesson.id) continue;
          (other.schedule || []).forEach((os, otherSessionIdx) => {
            if (!getLessonSessionStudioIds(os, other).includes(stId)) return;
            if (os.date !== session.date) return;
            const oS = os.startTime || "00:00", oE = os.endTime || "23:59";
            if (!(oS < sE && oE > sS)) return;
            const dedupeKey = `${other.id}__${otherSessionIdx}__${currentSessionIdx}__${stId}`;
            if (seen.has(dedupeKey)) return;
            seen.add(dedupeKey);
            const studio = studios.find(s => String(s.id) === stId);
            out.push({
              kind: "room",
              otherLessonId: other.id,
              otherLessonName: other.name || "(ללא שם)",
              otherTrack: other.track || "",
              otherSessionIdx,
              otherSession: os,
              currentSessionIdx,
              currentSession: session,
              studioId: stId,
              studioName: studio?.name || "החדר",
            });
          });
        }
      }
    });
    return out;
  };

  const findAllLessonLecturerConflicts = (lesson, lessonsList = lessons) => {
    const out = [];
    const seen = new Set();
    const todayStr = today();
    (lesson.schedule || []).forEach((session, currentSessionIdx) => {
      if (!session?.date) return;
      if (session.date < todayStr) return; // past sessions are not actionable
      const key = lecturerKeyForSession(lesson, session);
      if (!key) return;
      const sS = session.startTime || "00:00", sE = session.endTime || "23:59";
      for (const other of lessonsList) {
        if (other.id === lesson.id) continue;
        (other.schedule || []).forEach((os, otherSessionIdx) => {
          if (lecturerKeyForSession(other, os) !== key) return;
          if (os.date !== session.date) return;
          const oS = os.startTime || "00:00", oE = os.endTime || "23:59";
          if (!(oS < sE && sS < oE)) return;
          const dedupeKey = `${other.id}__${otherSessionIdx}__${currentSessionIdx}__${key}`;
          if (seen.has(dedupeKey)) return;
          seen.add(dedupeKey);
          out.push({
            kind: "lecturer",
            otherLessonId: other.id,
            otherLessonName: other.name || "(ללא שם)",
            otherTrack: other.track || "",
            otherSessionIdx,
            otherSession: os,
            currentSessionIdx,
            currentSession: session,
            lecturerKey: key,
            lecturerName: effectiveLecturerName(lesson, session) || effectiveLecturerName(other, os) || "המרצה",
          });
        });
      }
    });
    return out;
  };

  const save = async (lesson) => {
    // Detect ALL lesson-vs-lesson conflicts up-front (room + lecturer) so the
    // resolver modal can show them as a list. The admin can fix any one of
    // them and the rest re-checks automatically.
    const lecConflicts = findAllLessonLecturerConflicts(lesson);
    const roomConflicts = findAllLessonRoomConflicts(lesson);
    const allLessonConflicts = [...lecConflicts, ...roomConflicts];
    if (allLessonConflicts.length > 0) {
      setLessonConflicts(allLessonConflicts);
      setPendingLesson(lesson);
      return;
    }
    const found = findBookingConflicts(lesson);
    if (found.length > 0) {
      setPendingLesson(lesson);
      setConflicts(found);
      return;
    }
    await doSaveLesson(lesson);
  };

  // Apply an inline fix to another lesson's session (from the resolver modal),
  // persist it, then re-check conflicts on the lesson the admin was originally
  // trying to save. If no conflicts remain, the original save proceeds
  // automatically; otherwise the modal stays open with the remaining list.
  const applyOtherLessonFix = async (otherLessonId, sessionIdx, patch) => {
    const otherIdStr = String(otherLessonId);
    const updatedLessons = lessons.map(l => {
      if (String(l.id) !== otherIdStr) return l;
      const newSchedule = (l.schedule || []).map((s, i) => i === sessionIdx ? { ...s, ...patch } : s);
      return { ...l, schedule: newSchedule };
    });
    setLessons(updatedLessons);
    const r = await syncAllLessons(updatedLessons);
    if (r?.ok === false) {
      showToast("error", "התיקון לא נשמר בשרת. רענן את הדף ונסה שוב.");
      return;
    }
    if (!pendingLesson) {
      setLessonConflicts([]);
      return;
    }
    // Re-check both conflict kinds with the freshly-updated lessons list.
    const lec = findAllLessonLecturerConflicts(pendingLesson, updatedLessons);
    const room = findAllLessonRoomConflicts(pendingLesson, updatedLessons);
    const remaining = [...lec, ...room];
    if (remaining.length === 0) {
      // All clean — close panel and route through save() again so booking
      // conflicts still get their dedicated modal if any are detected.
      const lessonToSave = pendingLesson;
      setLessonConflicts([]);
      setPendingLesson(null);
      showToast("success", "הקונפליקטים נפתרו. שומר את הקורס הנוכחי…");
      await save(lessonToSave);
    } else {
      setLessonConflicts(remaining);
      showToast("success", "התיקון נשמר. נשארו עוד התנגשויות לפתור.");
    }
  };

  const confirmConflictAndSend = async () => {
    if (!pendingLesson) return;
    setConflictSending(true);
    try {
      const conflictIds = new Set(conflicts.map(c => String(c.booking.id)));
      const newBookings = studioBookings.filter(b => !conflictIds.has(String(b.id)));
      if (setStudioBookings) setStudioBookings(newBookings);
      await syncAllStudioBookings(newBookings);

      const customMessage = String(conflictMessage || "").trim();

      await Promise.all(conflicts.map(async ({ booking, studioName }) => {
        // Resolve recipient — both team and student bookings can be cancelled here.
        const kind = booking.bookingKind || (booking.lesson_id ? "lesson" : booking.teamMemberId ? "team" : "student");
        const isTeamBooking = kind === "team" || (!booking.studentName && booking.teamMemberId);
        let email = "";
        let recipientName = "";
        if (isTeamBooking) {
          const teamRec = teamMembers.find(t => String(t.id) === String(booking.teamMemberId));
          email = teamRec?.email || booking.teamMemberEmail || booking.email || "";
          recipientName = teamRec?.name || booking.teamMemberName || "";
        } else {
          const studentRecord = studentsFromTable.find(s => s.name === booking.studentName);
          email = studentRecord?.email || booking.email || booking.studentEmail || "";
          recipientName = booking.studentName || "";
        }
        if (!email) return;
        try {
          const tokConf = await getAuthToken();
          await fetch("/api/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(tokConf ? { Authorization: `Bearer ${tokConf}` } : {}) },
            body: JSON.stringify({
              to: email,
              type: "studio_lesson_conflict",
              student_name: recipientName,
              project_name: studioName,
              borrow_date: booking.date,
              borrow_time: booking.startTime,
              return_time: booking.endTime,
              custom_message: customMessage,
            }),
          });
        } catch(e) { console.error("conflict email failed", e); }
      }));
      await doSaveLesson(pendingLesson);
    } finally {
      setConflictSending(false);
      setPendingLesson(null);
      setConflicts([]);
      setConflictMessage("");
    }
  };

  // Resolve the affected user's phone for a conflict booking. Mirrors the
  // email resolution in `confirmConflictAndSend`: team bookings hit the
  // team_members lookup, students hit the students table.
  const getConflictRecipientPhone = (booking) => {
    const kind = booking?.bookingKind || (booking?.lesson_id ? "lesson" : booking?.teamMemberId ? "team" : "student");
    const isTeamBooking = kind === "team" || (!booking?.studentName && booking?.teamMemberId);
    if (isTeamBooking) {
      const teamRec = teamMembers.find(t => String(t.id) === String(booking?.teamMemberId));
      return teamRec?.phone || booking?.teamMemberPhone || booking?.phone || "";
    }
    const studentRecord = studentsFromTable.find(s => s.name === booking?.studentName);
    return studentRecord?.phone || booking?.phone || booking?.studentPhone || "";
  };

  // Build a wa.me deep link (or "" if no phone) prefilled with a short
  // cancellation summary + the admin's optional custom message. Opens in a new
  // tab — WhatsApp routes to web/desktop/mobile based on the platform.
  const buildConflictWhatsAppLink = (booking, studioName) => {
    const phone = normalizeIsraeliPhone(getConflictRecipientPhone(booking));
    if (!phone) return "";
    const recipientName = booking?.studentName || booking?.teamMemberName || "";
    const dateLabel = formatLessonDateDdMmYy(booking?.date) || booking?.date || "";
    const timeLabel = (booking?.startTime || booking?.endTime)
      ? `${booking?.startTime || ""}${booking?.endTime ? `–${booking.endTime}` : ""}`
      : "";
    const extra = String(conflictMessage || "").trim();
    const lines = [
      recipientName ? `שלום ${recipientName},` : "שלום,",
      "",
      `לצערנו נאלצנו לבטל את קביעת החדר${studioName ? ` ${studioName}` : ""}${dateLabel ? ` בתאריך ${dateLabel}` : ""}${timeLabel ? ` (${timeLabel})` : ""} לטובת שיעור.`,
    ];
    if (extra) {
      lines.push("");
      lines.push(extra);
    }
    lines.push("");
    lines.push("ניתן לנסות לקבוע חדר חלופי בלוח קביעת החדרים.");
    const text = encodeURIComponent(lines.join("\n"));
    return `https://wa.me/${phone}?text=${text}`;
  };

  const del = async (id) => {
    const updated = lessons.filter(l => l.id !== id);
    setLessons(updated);
    await syncAllLessons(updated);
    showToast("success", "הקורס נמחק. ניתן לשחזר עם לחצן ↩ בטל פעולה למעלה.", {
      aggregateKey: "lesson-delete",
      pluralize: n => `${n} קורסים נמחקו. ניתן לשחזר עם לחצן ↩ בטל פעולה למעלה.`,
    });
  };

  const UNASSIGNED_TRACK = "לא משויך";
  const getLessonTrackLabel = (lesson) => {
    const raw = String(lesson?.track || "").trim();
    return (raw && raw !== "כללי" && isKnownTrack(raw)) ? raw : UNASSIGNED_TRACK;
  };
  const allTrackFilters = [
    "הכל",
    ...new Set([
      ...normalizedTrackOptions,
      ...(lessons.some((lesson) => getLessonTrackLabel(lesson) === UNASSIGNED_TRACK) ? [UNASSIGNED_TRACK] : []),
    ]),
  ];
  const allTracksSelected = !trackFilter.length;
  const isTrackSelected = (trackName) => trackName === "הכל" ? allTracksSelected : trackFilter.includes(trackName);
  const toggleTrackFilter = (trackName) => {
    if (trackName === "הכל") {
      setTrackFilter([]);
      return;
    }
    setTrackFilter((current) => (
      current.includes(trackName)
        ? current.filter((item) => item !== trackName)
        : [...current, trackName]
    ));
  };
  const isArchived = (lesson) => {
    const schedule = lesson.schedule || [];
    if (!schedule.length) return false;
    const lastDate = [...schedule].sort((a, b) => String(b?.date || "").localeCompare(String(a?.date || "")))[0]?.date || "";
    return lastDate < today();
  };
  const hasAssignedLecturer = (lesson = {}) => {
    if (String(lesson?.lecturerId || "").trim()) return true;
    if (String(lesson?.instructorName || "").trim()) return true;
    if (normalizeLessonLecturerList(lesson).length > 0) return true;
    return (lesson.schedule || []).some((session) => (
      String(session?.lecturerId || session?.alternateLecturerId || "").trim()
      || String(session?.instructorName || session?.alternateInstructorName || "").trim()
    ));
  };
  const isWithoutLecturer = (lesson = {}) => !hasAssignedLecturer(lesson);

  // חישוב טווחי זמן: היום / השבוע (ראשון–שבת) / החודש הנוכחי
  const getTodayRange = () => {
    const today = formatLocalDateInput(new Date());
    return { start: today, end: today };
  };
  const getWeekRange = () => {
    const now = new Date();
    const day = now.getDay(); // 0=ראשון
    const sunday = new Date(now); sunday.setDate(now.getDate() - day);
    const saturday = new Date(now); saturday.setDate(now.getDate() + (6 - day));
    return { start: formatLocalDateInput(sunday), end: formatLocalDateInput(saturday) };
  };
  const getMonthRange = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: formatLocalDateInput(start), end: formatLocalDateInput(end) };
  };
  const lessonHasSessionInRange = (lesson, range) => {
    return (lesson.schedule || []).some(s => s.date >= range.start && s.date <= range.end);
  };
  // For the "קבלה" (intake) sort, the day/week/month filter is relative to when
  // the course was ADDED to the system (created_at), not its session dates.
  const lessonCreatedInRange = (lesson, range) => {
    if (!lesson?.created_at) return false;
    const created = new Date(lesson.created_at);
    if (Number.isNaN(created.getTime())) return false;
    const createdDate = formatLocalDateInput(created);
    return createdDate >= range.start && createdDate <= range.end;
  };

  const searchTerm = String(search || "").trim();
  const normalizedSearchTerm = searchTerm.toLowerCase();
  const normalizedLecturerSearchTerm = normalizeLecturerNameKey(searchTerm);
  const lessonMatchesSearch = (lesson) => {
    if (!searchTerm) return true;
    if (String(lesson?.name || "").toLowerCase().includes(normalizedSearchTerm)) return true;
    return normalizeLessonLecturerList(lesson).some((lecturer) => {
      const name = String(lecturer?.instructorName || "");
      return (
        name.toLowerCase().includes(normalizedSearchTerm)
        || normalizeLecturerNameKey(name).includes(normalizedLecturerSearchTerm)
      );
    });
  };

  const filtered = lessons.filter((lesson) => {
    const matchesSearch = lessonMatchesSearch(lesson);
    const trackLabel = getLessonTrackLabel(lesson);
    const matchesTrack = allTracksSelected || trackFilter.includes(trackLabel);
    const matchesArchive = archiveView ? isArchived(lesson) : !isArchived(lesson);
    const matchesLecturer = !showUnassignedLecturerOnly || isWithoutLecturer(lesson);
    // "דחיפות" filters by session dates; "קבלה" filters by course creation time.
    const inRange = sortMode === "urgency" ? lessonHasSessionInRange : lessonCreatedInRange;
    const matchesTime = timeFilter === "all" ||
      (timeFilter === "today" && inRange(lesson, getTodayRange())) ||
      (timeFilter === "week" && inRange(lesson, getWeekRange())) ||
      (timeFilter === "month" && inRange(lesson, getMonthRange()));
    return matchesSearch && matchesTrack && matchesArchive && matchesLecturer && matchesTime;
  });

  const archivedCount = lessons.filter(isArchived).length;
  const withoutLecturerCount = lessons.filter((lesson) => !isArchived(lesson) && isWithoutLecturer(lesson)).length;

  const sortedFiltered = [...filtered].sort((a, b) => {
    if (sortMode === "urgency") {
      const todayStr = today();
      const aNext = (a.schedule||[]).filter(s=>s.date>=todayStr).sort((x,y)=>x.date.localeCompare(y.date))[0]?.date || "9999-99-99";
      const bNext = (b.schedule||[]).filter(s=>s.date>=todayStr).sort((x,y)=>x.date.localeCompare(y.date))[0]?.date || "9999-99-99";
      return aNext.localeCompare(bNext);
    }
    // "recent" — newest id first
    return String(b.id).localeCompare(String(a.id), undefined, {numeric:true});
  });

  const groupedLessons = sortedFiltered.reduce((groups, lesson) => {
    const trackLabel = getLessonTrackLabel(lesson);
    if (!groups[trackLabel]) groups[trackLabel] = [];
    groups[trackLabel].push(lesson);
    return groups;
  }, {});

  const toImportIsoDate = (rawValue) => {
    if (rawValue instanceof Date && !Number.isNaN(rawValue.getTime())) return formatLocalDateInput(rawValue);
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      const date = new Date(Math.round((rawValue - 25569) * 86400000));
      return formatLocalDateInput(date);
    }
    let value = String(rawValue || "").trim();
    if (!value) return "";
    if (/^\d{5}$/.test(value)) {
      const date = new Date(Math.round((Number(value) - 25569) * 86400000));
      return formatLocalDateInput(date);
    }
    const parsedShort = parseLessonDateShort(value);
    if (parsedShort) return parsedShort;
    const parts = value.includes("/") ? value.split("/") : value.split("-");
    if (parts.length !== 3) return value;
    if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
    const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
    return `${year}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  };

  const importGroupKey = ({ name = "", track = "" }) => [
    String(name || "").trim(),
    String(track || "").trim(),
  ].join("__");

  const reportErrorIdentity = (error = {}) => [
    error.sheet || "",
    error.rowNumber || "",
  ].join("__");

  const reportErrorKey = (error = {}) => [
    reportErrorIdentity(error),
    error.reason || "",
  ].join("__");

  const makeImportError = (rowInfo = {}, reason = "") => ({
    sheet: rowInfo.sheet || "",
    rowNumber: rowInfo.rowNumber || "",
    courseName: rowInfo.courseName || "",
    track: rowInfo.track || "",
    instructorName: rowInfo.instructorName || "",
    date: rowInfo.date || "",
    startTime: rowInfo.startTime || "",
    endTime: rowInfo.endTime || "",
    studioName: rowInfo.studioName || "",
    topic: rowInfo.topic || "",
    notes: rowInfo.notes || "",
    kitName: rowInfo.kitName || "",
    phone: rowInfo.phone || "",
    email: rowInfo.email || "",
    reason,
  });

  const addImportError = (errors, rowInfo, reason) => {
    errors.push(makeImportError(rowInfo, reason));
  };

  // Merge sessions ONLY by date+time+topic. Lecturer is intentionally NOT
  // part of the key: two XL rows that share the same shoot slot but list
  // different lecturers should collapse into one session with both
  // lecturerIds[] populated — mirroring how studioIds[] merges.
  const importSessionMergeKey = (session = {}) => [
    session.date || "",
    session.startTime || "",
    session.endTime || "",
    String(session.topic || "").trim(),
  ].join("__");

  const stripImportMeta = (session) => {
    const { sourceRows, ...rest } = session;
    return rest;
  };

  const stableSessionForCompare = (session = {}) => {
    const normalized = normalizeScheduleEntry(session);
    return {
      date: normalized.date || "",
      startTime: normalized.startTime || "09:00",
      endTime: normalized.endTime || "12:00",
      topic: String(normalized.topic || "").trim(),
      studioIds: [...(normalized.studioIds || [])].map(String).sort(),
      kitId: normalized.kitId || null,
      lecturerId: normalized.lecturerId || null,
      lecturerIds: [...(normalized.lecturerIds || [])].map(String).sort(),
      instructorName: String(normalized.instructorName || "").trim(),
    };
  };

  const scheduleFingerprint = (schedule = []) => JSON.stringify(
    dedupeScheduleEntries(schedule)
      .map(stableSessionForCompare)
      .sort((a, b) => `${a.date} ${a.startTime} ${a.endTime}`.localeCompare(`${b.date} ${b.startTime} ${b.endTime}`))
  );

  const findRoomConflictInList = (candidate, lessonsList) => {
    const todayStr = today();
    for (const session of (candidate.schedule || [])) {
      if (session.date && session.date < todayStr) continue; // past sessions are not actionable
      const sS = session.startTime || "00:00", sE = session.endTime || "23:59";
      for (const stId of getLessonSessionStudioIds(session, candidate)) {
        if (!stId) continue;
        for (const other of lessonsList) {
          if (other.id === candidate.id) continue;
          for (const os of (other.schedule || [])) {
            if (!getLessonSessionStudioIds(os, other).includes(stId)) continue;
            if (os.date !== session.date) continue;
            const oS = os.startTime || "00:00", oE = os.endTime || "23:59";
            if (oS < sE && oE > sS) {
              const studio = studios.find(s => String(s.id) === stId);
              return { studioName: studio?.name || "החדר", lessonName: other.name || "שיעור קיים", startTime: oS, endTime: oE };
            }
          }
        }
        for (const b of studioBookings) {
          const kind = b.bookingKind || (b.lesson_id ? "lesson" : b.teamMemberId ? "team" : "student");
          if (kind !== "student" && kind !== "team") continue;
          if (String(b.studioId) !== String(stId)) continue;
          if (b.date !== session.date) continue;
          const bS = b.startTime || "00:00", bE = b.endTime || "23:59";
          if (bS < sE && bE > sS) {
            const studio = studios.find(s => String(s.id) === stId);
            return { studioName: studio?.name || "החדר", lessonName: b.studentName || b.teamMemberName || "קביעת חדר קיימת", startTime: bS, endTime: bE };
          }
        }
      }
    }
    return null;
  };

  const mergeCourseLists = (...lists) => {
    const byKey = new Map();
    lists.flat().filter(Boolean).forEach((course) => {
      const key = importGroupKey(course);
      const current = byKey.get(key);
      byKey.set(key, {
        ...current,
        ...course,
        sessions: Math.max(Number(current?.sessions) || 0, Number(course.sessions) || 0),
      });
    });
    return [...byKey.values()];
  };

  const mergeImportReport = (baseReport, nextReport, replaceIdentities = []) => {
    if (!baseReport) return nextReport;
    const replaceSet = new Set(replaceIdentities);
    const keptErrors = (baseReport.errors || []).filter(error => !replaceSet.has(reportErrorIdentity(error)));
    return {
      ...baseReport,
      fileName: nextReport.fileName || baseReport.fileName,
      mode: nextReport.mode || baseReport.mode,
      addedCount: (Number(baseReport.addedCount) || 0) + (Number(nextReport.addedCount) || 0),
      updatedCount: (Number(baseReport.updatedCount) || 0) + (Number(nextReport.updatedCount) || 0),
      skippedCount: Number(baseReport.skippedCount) || 0,
      savedSessions: (Number(baseReport.savedSessions) || 0) + (Number(nextReport.savedSessions) || 0),
      addedSessions: (Number(baseReport.addedSessions) || 0) + (Number(nextReport.addedSessions) || 0),
      updatedSessions: (Number(baseReport.updatedSessions) || 0) + (Number(nextReport.updatedSessions) || 0),
      addedCourses: mergeCourseLists(baseReport.addedCourses || [], nextReport.addedCourses || []),
      updatedCourses: mergeCourseLists(baseReport.updatedCourses || [], nextReport.updatedCourses || []),
      skippedCourses: baseReport.skippedCourses || [],
      errors: [...keptErrors, ...(nextReport.errors || [])],
    };
  };

  const readImportRowsFromFile = async (file) => {
    const readAllSheets = async () => {
      if (/\.xlsx?$/i.test(file.name)) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type:"array" });
        return wb.SheetNames
          .map(name => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header:1, defval:"" }) }))
          .filter(s => s.rows.length > 1);
      }
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(line => line.trim());
      const sep = lines[0]?.includes("\t") ? "\t" : ",";
      return [{ name: "sheet1", rows: lines.map(line => line.split(sep).map(cell => cell.trim().replace(/^"|"$/g, ""))) }];
    };

    const sheets = await readAllSheets();
    const importRows = [];
    const importErrors = [];
    for (const sheet of sheets) {
      const rows = sheet.rows;
      if (rows.length < 2) continue;
      const headers = rows[0].map(h => String(h || "").trim().replace(/[\uFEFF\u200B-\u200D\u00A0]/g, "").toLowerCase());
      const findH = (...patterns) => headers.findIndex(h => patterns.some(p => h.includes(p)));
      const courseIdx = findH("קורס", "course", "שם קורס");
      const dateIdx = findH("תאריך", "date");
      const startIdx = findH("התחלה", "start", "שעת התחלה");
      const endIdx = findH("סיום", "end", "שעת סיום");
      const findAllH = (...patterns) => headers
        .map((h, idx) => (patterns.some(p => h.includes(p)) ? idx : -1))
        .filter(idx => idx >= 0);
      const instructorIdxs = findAllH("מרצה", "מורה", "lecturer", "teacher", "instructor");
      const phoneIdx = findH("טלפון", "phone", "נייד");
      const emailIdx = findH("מייל", "email", "mail");
      const trackIdx = findH("מסלול", "track", "קבוצה", "class");
      const studioIdxs = findAllH("כיתת לימוד", "אולפן", "studio", "כיתה", "חדר");
      const kitIdx = findH("ערכה", "kit");
      const topicIdx = findH("נושא", "topic", "subject");
      const notesIdx = findH("הערות", "description", "notes", "תיאור");

      if (courseIdx === -1 || dateIdx === -1) {
        addImportError(importErrors, { sheet: sheet.name, rowNumber: 1 }, "הגיליון חסר עמודת שם קורס או תאריך");
        continue;
      }

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row.some(cell => String(cell || "").trim())) continue;
        importRows.push({
          sheet: sheet.name,
          rowNumber: i + 1,
          courseName: String(row[courseIdx] || "").trim() || sheet.name.trim(),
          track: trackIdx >= 0 ? String(row[trackIdx] || "").trim() : "",
          instructorNames: instructorIdxs.length
            ? instructorIdxs.map(idx => String(row[idx] || "").trim()).filter(Boolean)
            : [],
          // Scalar shim for legacy code paths that still read instructorName.
          // Always reflects the first non-empty lecturer column.
          instructorName: instructorIdxs.length
            ? (instructorIdxs.map(idx => String(row[idx] || "").trim()).find(Boolean) || "")
            : "",
          phone: phoneIdx >= 0 ? String(row[phoneIdx] || "").trim() : "",
          email: emailIdx >= 0 ? String(row[emailIdx] || "").trim() : "",
          date: toImportIsoDate(row[dateIdx]),
          startTime: startIdx >= 0 ? normalizeImportedLessonTime(row[startIdx]) : "",
          endTime: endIdx >= 0 ? normalizeImportedLessonTime(row[endIdx]) : "",
          studioName: studioIdxs.length
            ? studioIdxs.map(idx => String(row[idx] || "").trim()).filter(Boolean).join("\n")
            : "",
          kitName: kitIdx >= 0 ? String(row[kitIdx] || "").trim() : "",
          topic: topicIdx >= 0 ? String(row[topicIdx] || "").trim() : "",
          notes: notesIdx >= 0 ? String(row[notesIdx] || "").trim() : "",
        });
      }
    }
    return { sheets, importRows, importErrors };
  };

  const buildImportGroups = (importRows = [], reportErrors = []) => {
    const nameToLecturer = getLecturerNameMap();
    const groups = new Map();

    importRows.forEach((rowInfo) => {
      const rowReasons = [];
      if (!rowInfo.courseName) rowReasons.push("חסר שם קורס");
      if (!rowInfo.track || !isKnownTrack(rowInfo.track)) rowReasons.push(`מסלול לימודים לא קיים: ${rowInfo.track || "חסר מסלול"}`);
      const instructorNames = Array.isArray(rowInfo.instructorNames) && rowInfo.instructorNames.length
        ? rowInfo.instructorNames
        : (rowInfo.instructorName ? [rowInfo.instructorName] : []);
      const sessionLecturers = instructorNames.map(name => ({
        name,
        lecturer: nameToLecturer[normalizeLecturerNameKey(name)] || null,
      }));
      const missingLecturers = sessionLecturers.filter(item => !item.lecturer).map(item => item.name);
      if (missingLecturers.length) rowReasons.push(`מרצה לא קיים ברובריקת המרצים: ${missingLecturers.join(", ")}`);
      if (!rowInfo.date || !isValidImportedDate(rowInfo.date)) rowReasons.push("תאריך לא תקין");
      if (!rowInfo.startTime || !rowInfo.endTime || rowInfo.startTime >= rowInfo.endTime) rowReasons.push("שעת התחלה/סיום לא תקינה");
      const studioNames = splitImportCellValues(rowInfo.studioName);
      const sessionStudios = studioNames.map(name => ({ name, studio: findImportedStudio(name) }));
      const missingStudios = sessionStudios.filter(item => !item.studio).map(item => item.name);
      if (missingStudios.length) rowReasons.push(`כיתה/חדר לא קיימים: ${missingStudios.join(", ")}`);

      if (rowReasons.length) {
        rowReasons.forEach(reason => addImportError(reportErrors, rowInfo, reason));
        return;
      }

      const groupKey = importGroupKey({ name: rowInfo.courseName, track: rowInfo.track });
      // Primary lecturer for this row = first non-empty column.
      const primaryLecturer = sessionLecturers.find(item => item.lecturer)?.lecturer || null;
      const primaryDisplayName = lecturerDisplayName(primaryLecturer) || (sessionLecturers[0]?.name || "");
      const studioIds = [...new Set(sessionStudios.map(item => item.studio?.id).filter(Boolean).map(String))];
      const sessionLecturerIds = [...new Set(sessionLecturers.map(item => item.lecturer?.id).filter(Boolean).map(String))];
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          name: rowInfo.courseName,
          track: rowInfo.track,
          instructorName: primaryDisplayName,
          instructorPhone: primaryLecturer?.phone || rowInfo.phone || "",
          instructorEmail: primaryLecturer?.email || rowInfo.email || "",
          lecturerId: primaryLecturer?.id || null,
          lecturers: [],
          studioName: rowInfo.studioName,
          kitName: rowInfo.kitName,
          description: rowInfo.notes || "",
          rawSchedule: [],
          schedule: [],
        });
      }

      const group = groups.get(groupKey);
      // Accumulate every lecturer mentioned in any row of this group into
      // group.lecturers (deduped by id or normalized name). These become the
      // "מרצי הקורס" chips on save.
      sessionLecturers.forEach(({ lecturer, name }) => {
        const displayName = lecturerDisplayName(lecturer) || name;
        if (!displayName) return;
        const exists = group.lecturers.some((item) =>
          (lecturer?.id && String(item.lecturerId || "") === String(lecturer.id)) ||
          normalizeLecturerNameKey(item.instructorName) === normalizeLecturerNameKey(displayName)
        );
        if (!exists) group.lecturers.push({ lecturerId: lecturer?.id || null, instructorName: displayName });
      });
      const session = normalizeScheduleEntry({
        date: rowInfo.date,
        startTime: rowInfo.startTime,
        endTime: rowInfo.endTime,
        topic: rowInfo.topic,
        studioIds,
        kitId: rowInfo.kitName ? (lessonKits.find(k=>k.name===rowInfo.kitName)?.id || null) : null,
        lecturerIds: sessionLecturerIds,
        lecturerId: primaryLecturer?.id || null,
        instructorName: primaryDisplayName,
      });
      session.sourceRows = [rowInfo];
      group.rawSchedule.push(session);
      if (!group.description && rowInfo.notes) group.description = rowInfo.notes;
      if (!group.studioName && rowInfo.studioName) group.studioName = rowInfo.studioName;
      if (!group.kitName && rowInfo.kitName) group.kitName = rowInfo.kitName;
    });

    groups.forEach((group) => {
      const mergedBySession = new Map();
      group.rawSchedule.forEach((session) => {
        const key = importSessionMergeKey(session);
        if (!mergedBySession.has(key)) mergedBySession.set(key, []);
        mergedBySession.get(key).push(session);
      });
      const schedule = [];
      mergedBySession.forEach((sessions) => {
        // Merge ALL classrooms + lecturers from rows that share the same time
        // slot. No max-2 limit — XL with N rooms/lecturers per slot is allowed.
        const mergedStudioIds = [];
        const seenStudio = new Set();
        sessions.forEach((session) => {
          (session.studioIds || []).forEach((id) => {
            const key = String(id);
            if (!key || seenStudio.has(key)) return;
            seenStudio.add(key);
            mergedStudioIds.push(key);
          });
        });
        const mergedLecturerIds = [];
        const seenLec = new Set();
        sessions.forEach((session) => {
          (session.lecturerIds || []).forEach((id) => {
            const key = String(id);
            if (!key || seenLec.has(key)) return;
            seenLec.add(key);
            mergedLecturerIds.push(key);
          });
        });
        const base = sessions[0];
        schedule.push({
          ...base,
          studioIds: mergedStudioIds,
          lecturerIds: mergedLecturerIds,
          lecturerId: mergedLecturerIds[0] || base.lecturerId || null,
          sourceRows: sessions.flatMap(session => session.sourceRows || []),
        });
      });
      group.schedule = schedule;
      const courseStudioIds = [];
      const courseSeen = new Set();
      schedule.forEach((s) => (s.studioIds || []).forEach((id) => {
        const key = String(id);
        if (!key || courseSeen.has(key)) return;
        courseSeen.add(key);
        courseStudioIds.push(key);
      }));
      group.studios = courseStudioIds.map((id) => ({ studioId: id }));
      delete group.rawSchedule;
    });

    return groups;
  };

  const runLessonImportRows = async (importRows, { fileName, mode = "upsert", initialErrors = [], baseReport = null, replaceErrorIdentities = [], retry = false } = {}) => {
    const reportErrors = [...initialErrors];
    const groups = buildImportGroups(importRows, reportErrors);

    const finishReport = (partialReport, toastType, toastText) => {
      const nextReport = mergeImportReport(baseReport, partialReport, replaceErrorIdentities);
      setImportReport(nextReport);
      if (toastText) showToast(toastType, toastText);
      return nextReport;
    };

    if (groups.size === 0) {
      finishReport(
        { fileName, mode, addedCount: 0, updatedCount: 0, skippedCount: 0, savedSessions: 0, addedSessions: 0, updatedSessions: 0, addedCourses: [], updatedCourses: [], skippedCourses: [], errors: reportErrors },
        reportErrors.length ? "error" : "success",
        retry
          ? (reportErrors.length ? "התיקון עדיין לא נשמר. דוח השגיאות עודכן." : "לא נמצא שינוי חדש לשמירה.")
          : (reportErrors.length ? "לא נמצאו שורות תקינות לייבוא. דוח השגיאות נפתח לבדיקה." : "לא נמצאו קורסים תקינים לייבוא")
      );
      return;
    }

    let addedCount = 0;
    let updatedCount = 0;
    let savedSessions = 0;
    let addedSessions = 0;
    let updatedSessions = 0;
    const addedCourses = [];
    const updatedCourses = [];
    const skippedCourses = [];
    const updatedLessons = [...lessons];
    const importedLessonIds = new Set();

    groups.forEach((group) => {
      const studioId = findImportedStudio(group.studioName)?.id ?? null;
      const kitId = lessonKits.find((kit) => kit.name === group.kitName)?.id ?? null;
      const matchingIndexes = updatedLessons
        .map((lesson, index) => ({ lesson, index }))
        .filter(({ lesson }) => importGroupKey({
          name: lesson.name,
          track: lesson.track,
        }) === importGroupKey(group))
        .map(({ index }) => index);
      // "צור קורסים חדשים בלבד" (create_only): import a brand-new semester.
      // We intentionally IGNORE the (name, track) match and treat every group
      // as a NEW course, so a course with an identical name/lecturer/track but
      // DIFFERENT dates is added as a separate course. Genuine duplicates
      // (same date+time) are still blocked per-session by the room/lecturer
      // conflict checks below (both require os.date === session.date).
      const existingIndex = mode === "create_only" ? -1 : (matchingIndexes[0] ?? -1);
      const duplicateExistingSchedules = matchingIndexes
        .slice(1)
        .flatMap((index) => updatedLessons[index]?.schedule || []);
      const existing = existingIndex >= 0 ? updatedLessons[existingIndex] : null;
      const lessonId = existing?.id || `lesson_${Date.now()}_${addedCount + updatedCount}`;
      const mergedStudios = (() => {
        const out = [];
        const seen = new Set();
        const push = (id) => {
          const key = String(id || "").trim();
          if (!key || seen.has(key)) return;
          seen.add(key);
          out.push({ studioId: key });
        };
        (existing?.studios || []).forEach(cs => push(cs?.studioId));
        if (existing?.studioId) push(existing.studioId);
        (group.studios || []).forEach(cs => push(cs?.studioId));
        if (studioId) push(studioId);
        return out;
      })();
      const baseLesson = existing ? {
        ...existing,
        track: group.track || existing.track || "",
        instructorName: group.instructorName || existing.instructorName || "",
        instructorPhone: group.instructorPhone || existing.instructorPhone || "",
        instructorEmail: group.instructorEmail || existing.instructorEmail || "",
        lecturerId: group.lecturerId || existing.lecturerId || null,
        lecturers: normalizeLessonLecturerList({
          ...existing,
          schedule: [...(existing.schedule || []), ...(group.schedule || [])],
          lecturers: [...(Array.isArray(existing.lecturers) ? existing.lecturers : []), ...(group.lecturers || [])],
        }),
        description: group.description || existing.description || "",
        studioId: mergedStudios[0]?.studioId || null,
        studios: mergedStudios,
        kitId: kitId ?? existing.kitId ?? null,
        schedule: dedupeScheduleEntries([...(existing.schedule || []), ...duplicateExistingSchedules]),
      } : {
        id: lessonId,
        name: group.name,
        track: group.track,
        instructorName: group.instructorName,
        instructorPhone: group.instructorPhone,
        instructorEmail: group.instructorEmail,
        lecturerId: group.lecturerId || null,
        lecturers: group.lecturers || [],
        description: group.description,
        studioId: mergedStudios[0]?.studioId || null,
        studios: mergedStudios,
        kitId,
        schedule: [],
        created_at: new Date().toISOString(),
      };

      let changed = false;
      let groupSavedSessions = 0;
      const sessions = dedupeScheduleEntries(group.schedule);
      sessions.forEach((session) => {
        const beforeFingerprint = scheduleFingerprint(baseLesson.schedule);
        const nextSchedule = dedupeScheduleEntries([...(baseLesson.schedule || []), stripImportMeta(session)]);
        const afterFingerprint = scheduleFingerprint(nextSchedule);
        if (afterFingerprint === beforeFingerprint) return;

        const candidate = {
          ...baseLesson,
          schedule: [stripImportMeta(session)],
        };
        const lecturerConflict = findLecturerConflict(candidate, updatedLessons);
        if (lecturerConflict) {
          (session.sourceRows || []).forEach(rowInfo => addImportError(reportErrors, rowInfo, `חפיפת מרצה: ${effectiveLecturerName(candidate, session)} כבר משויך/ת ל-${lecturerConflict.lessonName} בשעות ${lecturerConflict.startTime}-${lecturerConflict.endTime}`));
          return;
        }
        const roomConflict = findRoomConflictInList(candidate, updatedLessons);
        if (roomConflict) {
          (session.sourceRows || []).forEach(rowInfo => addImportError(reportErrors, rowInfo, `חפיפת חדר: ${roomConflict.studioName} תפוס על ידי ${roomConflict.lessonName} בשעות ${roomConflict.startTime}-${roomConflict.endTime}`));
          return;
        }
        baseLesson.schedule = nextSchedule;
        savedSessions += 1;
        groupSavedSessions += 1;
        changed = true;
      });

      if (!changed) return;
      if (existingIndex >= 0) {
        updatedLessons[existingIndex] = baseLesson;
        matchingIndexes.slice(1).sort((a, b) => b - a).forEach((index) => updatedLessons.splice(index, 1));
        updatedCount += 1;
        updatedSessions += groupSavedSessions;
        updatedCourses.push({ name: baseLesson.name, track: baseLesson.track, sessions: baseLesson.schedule.length });
      } else {
        updatedLessons.push(baseLesson);
        addedCount += 1;
        addedSessions += groupSavedSessions;
        addedCourses.push({ name: baseLesson.name, track: baseLesson.track, sessions: baseLesson.schedule.length });
      }
      importedLessonIds.add(String(lessonId));
    });

    const partialReport = { fileName, mode, addedCount, updatedCount, skippedCount: skippedCourses.length, savedSessions, addedSessions, updatedSessions, addedCourses, updatedCourses, skippedCourses, errors: reportErrors };

    if (savedSessions === 0) {
      finishReport(
        partialReport,
        reportErrors.length ? "error" : "success",
        retry
          ? (reportErrors.length ? "התיקון עדיין לא נשמר. דוח השגיאות עודכן." : "השורה כבר קיימת במערכת ולא דרשה שמירה נוספת.")
          : (reportErrors.length ? "לא נשמרו שורות חדשות. דוח השגיאות נפתח לבדיקה." : "הקובץ כבר קיים במערכת. לא נוצרו או עודכנו קורסים.")
      );
      return;
    }

    const synced = await syncImportedLecturers(updatedLessons, importedLessonIds);
    setLessons(synced);
    await syncAllLessons(synced);

    finishReport(
      partialReport,
      "success",
      retry
        ? (reportErrors.length ? "התיקון נשמר חלקית, ונשארו שורות שדורשות תיקון." : "השורה תוקנה ונשמרה בהצלחה.")
        : (reportErrors.length
          ? `הייבוא הושלם חלקית: נוספו ${addedSessions} שיעורים ועודכנו ${updatedSessions} שיעורים. ${reportErrors.length} שורות דורשות תיקון.`
          : `יובאו ${addedCount} קורסים ועודכנו ${updatedCount} קורסים. נוספו ${addedSessions} שיעורים ועודכנו ${updatedSessions} שיעורים.`)
    );
  };

  const importLessonsXL = async (file, mode = "upsert") => {
    if (!file) return;
    setXlImporting(true);
    setImportReport(null);
    setShowImportModeDialog(false);
    setEditingImportErrorKey(null);
    setImportErrorDraft(null);
    try {
      const { sheets, importRows, importErrors } = await readImportRowsFromFile(file);
      if (!sheets.length) {
        showToast("error", "קובץ ה־XL ריק");
        return;
      }
      await runLessonImportRows(importRows, { fileName: file.name, mode, initialErrors: importErrors });
    } catch (error) {
      console.error("Lessons XL import failed", error);
      const detail = error?.message || "שגיאה לא ידועה";
      showToast("error", `שגיאה בייבוא קורסים מ־XL: ${detail}`);
    } finally {
      setXlImporting(false);
      setPendingImportFile(null);
      setPendingImportMode("upsert");
    }
  };

  const importRetryGroupKey = (row = {}) => [
    String(row.courseName || "").trim(),
    String(row.track || "").trim(),
    normalizeLecturerNameKey(row.instructorName || ""),
    toImportIsoDate(row.date || ""),
    normalizeImportedLessonTime(row.startTime || ""),
    normalizeImportedLessonTime(row.endTime || ""),
    String(row.topic || "").trim(),
  ].join("__");

  const startEditImportError = (error) => {
    setEditingImportErrorKey(reportErrorIdentity(error));
    setImportErrorDraft({
      sheet: error.sheet || "",
      rowNumber: error.rowNumber || "",
      courseName: error.courseName || "",
      track: error.track || "",
      instructorName: error.instructorName || "",
      date: formatLessonDateShort(error.date) || error.date || "",
      startTime: error.startTime || "",
      endTime: error.endTime || "",
      studioName: error.studioName || "",
      topic: error.topic || "",
      notes: error.notes || "",
      kitName: error.kitName || "",
      phone: error.phone || "",
      email: error.email || "",
    });
  };

  const cancelEditImportError = () => {
    setEditingImportErrorKey(null);
    setImportErrorDraft(null);
  };

  const updateImportErrorDraft = (field, value) => {
    setImportErrorDraft(prev => ({ ...(prev || {}), [field]: value }));
  };

  const retryImportErrorDraft = async () => {
    if (!importReport || !importErrorDraft) return;
    const editedIdentity = reportErrorIdentity(importErrorDraft);
    const editedRow = {
      ...importErrorDraft,
      date: toImportIsoDate(importErrorDraft.date),
      startTime: normalizeImportedLessonTime(importErrorDraft.startTime),
      endTime: normalizeImportedLessonTime(importErrorDraft.endTime),
      courseName: String(importErrorDraft.courseName || "").trim(),
      track: String(importErrorDraft.track || "").trim(),
      instructorName: String(importErrorDraft.instructorName || "").trim(),
      studioName: String(importErrorDraft.studioName || "").trim(),
      topic: String(importErrorDraft.topic || "").trim(),
      notes: String(importErrorDraft.notes || "").trim(),
    };
    const retryRows = [editedRow];
    const replaceErrorIdentities = [editedIdentity];
    setRetryingImportError(true);
    try {
      await runLessonImportRows(retryRows, {
        fileName: importReport.fileName || "ייבוא XL",
        mode: importReport.mode || "upsert",
        baseReport: importReport,
        replaceErrorIdentities,
        retry: true,
      });
      cancelEditImportError();
    } catch (error) {
      console.error("Retry import row failed", error);
      showToast("error", `שגיאה בשמירת תיקון השורה: ${error?.message || "שגיאה לא ידועה"}`);
    } finally {
      setRetryingImportError(false);
    }
  };

  const getImportReportSummary = (report = {}) => {
    const explicitAddedSessions = Number(report.addedSessions);
    const explicitUpdatedSessions = Number(report.updatedSessions);
    const hasExplicitAddedSessions = Number.isFinite(explicitAddedSessions);
    const hasExplicitUpdatedSessions = Number.isFinite(explicitUpdatedSessions);
    const addedCourses = (report.addedCourses || []).length;
    const updatedCourses = (report.updatedCourses || []).length;
    const skippedCourses = (report.skippedCourses || []).length;
    const savedSessions = Number(report.savedSessions) || 0;
    const addedSessions = hasExplicitAddedSessions ? explicitAddedSessions : (addedCourses > 0 && updatedCourses === 0 ? savedSessions : 0);
    const updatedSessions = hasExplicitUpdatedSessions ? explicitUpdatedSessions : (updatedCourses > 0 && addedCourses === 0 ? savedSessions : 0);

    return {
      addedSessions,
      updatedSessions,
      addedCourses: addedSessions > 0 ? addedCourses : 0,
      updatedCourses: updatedSessions > 0 ? updatedCourses : 0,
      skippedCourses,
    };
  };

  const importSummary = importReport ? getImportReportSummary(importReport) : null;

  const printImportReport = () => {
    if (!importReport) return;
    const summary = getImportReportSummary(importReport);
    const escapeHtml = (value = "") => String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    const courseListHtml = (title, courses = []) => courses.length ? `
      <h2>${escapeHtml(title)}</h2>
      <table>
        <thead><tr><th>קורס</th><th>מסלול</th><th>סה"כ מפגשים בקורס</th></tr></thead>
        <tbody>${courses.map((course) => `
          <tr>
            <td>${escapeHtml(course.name)}</td>
            <td>${escapeHtml(course.track)}</td>
            <td>${escapeHtml(course.sessions)}</td>
          </tr>
        `).join("")}</tbody>
      </table>
    ` : "";
    const rowsHtml = (importReport.errors || []).map((error) => `
      <tr>
        <td>${escapeHtml(error.rowNumber)}</td>
        <td>${escapeHtml(error.courseName)}</td>
        <td>${escapeHtml(error.track)}</td>
        <td>${escapeHtml(error.instructorName)}</td>
        <td>${escapeHtml(formatLessonDateShort(error.date))}</td>
        <td>${escapeHtml(error.startTime)}-${escapeHtml(error.endTime)}</td>
        <td>${escapeHtml(error.studioName)}</td>
        <td>${escapeHtml(error.reason)}</td>
      </tr>
    `).join("");
    const win = window.open("", "_blank", "width=1100,height=800");
    if (!win) return;
    win.document.write(`<!doctype html>
      <html lang="he" dir="rtl">
        <head>
          <meta charset="utf-8" />
          <title>דוח שגיאות ייבוא XL</title>
          <style>
            body { font-family: Arial, sans-serif; direction: rtl; color: #111827; padding: 24px; }
            h1 { margin: 0 0 8px; font-size: 24px; }
            .meta { color: #4b5563; margin-bottom: 18px; line-height: 1.6; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #d1d5db; padding: 8px; vertical-align: top; text-align: right; }
            th { background: #f3f4f6; font-weight: 800; }
            h2 { margin: 22px 0 8px; font-size: 18px; }
          </style>
        </head>
        <body>
          <h1>דוח שגיאות ייבוא XL</h1>
          <div class="meta">
            קובץ: ${escapeHtml(importReport.fileName || "")}<br />
            נוספו ${escapeHtml(summary.addedSessions)} שיעורים · עודכנו ${escapeHtml(summary.updatedSessions)} שיעורים<br />
            נוצרו ${escapeHtml(summary.addedCourses)} קורסים · עודכנו ${escapeHtml(summary.updatedCourses)} קורסים · דולגו ${escapeHtml(summary.skippedCourses)} קורסים<br />
            שורות שנכשלו: ${escapeHtml((importReport.errors || []).length)}
          </div>
          ${courseListHtml("קורסים שנוצרו", importReport.addedCourses || [])}
          ${courseListHtml("קורסים שעודכנו", importReport.updatedCourses || [])}
          <table>
            <thead>
              <tr>
                <th>שורה</th><th>קורס</th><th>מסלול</th><th>מרצה</th><th>תאריך</th><th>שעות</th><th>כיתה</th><th>סיבה</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </body>
      </html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
  };

  return (
    <div className="page">
      {showImportModeDialog && pendingImportFile && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",zIndex:4300,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}}>
          <div style={{width:"100%",maxWidth:560,background:"var(--surface)",borderRadius:16,border:"1px solid rgba(245,166,35,0.45)",direction:"rtl",boxShadow:"0 16px 44px rgba(0,0,0,0.45)"}}>
            <div style={{padding:"18px 20px",borderBottom:"1px solid var(--border)",background:"rgba(245,166,35,0.08)",borderRadius:"16px 16px 0 0"}}>
              <div style={{fontWeight:900,fontSize:18,color:"var(--accent)",display:"flex",alignItems:"center",gap:8}}>
                <FileText size={18} strokeWidth={1.75}/> בחירת מצב ייבוא XL
              </div>
              <div style={{fontSize:13,color:"var(--text2)",marginTop:7,lineHeight:1.6}}>
                הקובץ שנבחר: <strong style={{color:"var(--text)"}}>{pendingImportFile.name}</strong>
              </div>
            </div>
            <div style={{padding:"18px 20px",display:"flex",flexDirection:"column",gap:12}}>
              <label style={{display:"flex",gap:12,alignItems:"flex-start",padding:"14px",borderRadius:12,border:`2px solid ${pendingImportMode==="upsert" ? "var(--accent)" : "var(--border)"}`,background:pendingImportMode==="upsert" ? "rgba(245,166,35,0.09)" : "var(--surface2)",cursor:"pointer"}}>
                <input type="radio" name="lesson-xl-import-mode" checked={pendingImportMode==="upsert"} onChange={()=>setPendingImportMode("upsert")} style={{marginTop:3}}/>
                <span>
                  <span style={{display:"block",fontWeight:900,color:"var(--text)",marginBottom:4}}>צור קורסים חדשים ועדכן קורסים קיימים</span>
                  <span style={{display:"block",fontSize:12,color:"var(--text2)",lineHeight:1.5}}>מתאים לעדכון לוח קיים: קורסים קיימים יעודכנו רק אם נמצא שינוי אמיתי במפגשים.</span>
                </span>
              </label>
              <label style={{display:"flex",gap:12,alignItems:"flex-start",padding:"14px",borderRadius:12,border:`2px solid ${pendingImportMode==="create_only" ? "var(--accent)" : "var(--border)"}`,background:pendingImportMode==="create_only" ? "rgba(245,166,35,0.09)" : "var(--surface2)",cursor:"pointer"}}>
                <input type="radio" name="lesson-xl-import-mode" checked={pendingImportMode==="create_only"} onChange={()=>setPendingImportMode("create_only")} style={{marginTop:3}}/>
                <span>
                  <span style={{display:"block",fontWeight:900,color:"var(--text)",marginBottom:4}}>צור קורסים חדשים בלבד</span>
                  <span style={{display:"block",fontSize:12,color:"var(--text2)",lineHeight:1.5}}>קורסים שכבר קיימים לפי שם קורס ומסלול לימודים ידולגו ולא ישתנו.</span>
                </span>
              </label>
            </div>
            <div style={{padding:"14px 20px",borderTop:"1px solid var(--border)",display:"flex",gap:10,justifyContent:"flex-end",flexWrap:"wrap"}}>
              <button className="btn btn-secondary" type="button" onClick={closeImportModeDialog} disabled={xlImporting}>
                <X size={16} strokeWidth={1.75}/> ביטול
              </button>
              <button className="btn btn-primary" type="button" onClick={()=>importLessonsXL(pendingImportFile, pendingImportMode)} disabled={xlImporting}>
                {xlImporting ? "מייבא..." : "התחל ייבוא"}
              </button>
            </div>
          </div>
        </div>
      )}
      {importReport && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",zIndex:4200,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}}>
          <div style={{width:"min(96vw, 1380px)",maxWidth:"96vw",background:"var(--surface)",borderRadius:16,border:"1px solid rgba(245,166,35,0.45)",direction:"rtl",maxHeight:"86vh",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",background:"rgba(245,166,35,0.08)",borderRadius:"16px 16px 0 0"}}>
              <div style={{fontWeight:900,fontSize:17,color:"var(--accent)",display:"flex",alignItems:"center",gap:8}}>
                <FileText size={18} strokeWidth={1.75}/> דוח ייבוא XL
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
                <span style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 10px",borderRadius:999,background:"rgba(46,204,113,0.08)",border:"1px solid rgba(46,204,113,0.22)",color:"var(--green)",fontSize:12,fontWeight:800}}>
                  קורסים שנוצרו: {importSummary?.addedCourses || 0}
                </span>
                <span style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 10px",borderRadius:999,background:"rgba(46,204,113,0.12)",border:"1px solid rgba(46,204,113,0.28)",color:"var(--green)",fontSize:12,fontWeight:900}}>
                  נוספו {importSummary?.addedSessions || 0} שיעורים
                </span>
                <span style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 10px",borderRadius:999,background:"rgba(245,166,35,0.08)",border:"1px solid rgba(245,166,35,0.22)",color:"var(--accent)",fontSize:12,fontWeight:800}}>
                  קורסים שעודכנו: {importSummary?.updatedCourses || 0}
                </span>
                <span style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 10px",borderRadius:999,background:"rgba(245,166,35,0.12)",border:"1px solid rgba(245,166,35,0.28)",color:"var(--accent)",fontSize:12,fontWeight:900}}>
                  עודכנו {importSummary?.updatedSessions || 0} שיעורים
                </span>
                <span style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 10px",borderRadius:999,background:"rgba(255,255,255,0.05)",border:"1px solid var(--border)",color:"var(--text2)",fontSize:12,fontWeight:800}}>
                  קורסים שדולגו: {importSummary?.skippedCourses || 0}
                </span>
                {(importReport.errors || []).length > 0 && (
                  <span style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 10px",borderRadius:999,background:"rgba(231,76,60,0.12)",border:"1px solid rgba(231,76,60,0.3)",color:"var(--red)",fontSize:12,fontWeight:900}}>
                    {(importReport.errors || []).length} שורות דורשות תיקון
                  </span>
                )}
              </div>
            </div>
            <div style={{overflowY:"auto",flex:1,padding:"16px 20px"}}>
              {((importReport.addedCourses || []).length > 0 || (importReport.updatedCourses || []).length > 0 || (importReport.skippedCourses || []).length > 0) && (
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:12,marginBottom:16}}>
                  {[
                    { title:"קורסים שנוצרו", courses: importSummary?.addedCourses ? (importReport.addedCourses || []) : [], color:"var(--green)" },
                    { title:"קורסים שעודכנו", courses: importSummary?.updatedCourses ? (importReport.updatedCourses || []) : [], color:"var(--accent)" },
                    { title:"קורסים קיימים שדולגו", courses: importReport.skippedCourses || [], color:"var(--text2)" },
                  ].filter(section => section.courses.length > 0).map((section) => (
                    <div key={section.title} style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 14px"}}>
                      <div style={{fontSize:13,fontWeight:900,color:section.color,marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
                        <BookOpen size={14} strokeWidth={1.75}/> {section.title} ({section.courses.length})
                      </div>
                      <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:150,overflowY:"auto"}}>
                        {section.courses.map((course, index) => (
                          <div key={`${course.name}-${course.track}-${index}`} style={{display:"flex",justifyContent:"space-between",gap:10,padding:"7px 9px",borderRadius:8,background:"rgba(255,255,255,0.03)",fontSize:12}}>
                            <span style={{fontWeight:800,color:"var(--text)"}}>{course.name}</span>
                            <span style={{color:"var(--text2)",textAlign:"left"}}>{course.track}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {(importReport.errors || []).length === 0 ? (
                <div style={{padding:"18px",border:"1px solid rgba(46,204,113,0.25)",background:"rgba(46,204,113,0.08)",borderRadius:12,color:"var(--green)",fontWeight:800}}>
                  הייבוא הסתיים ללא שגיאות.
                </div>
              ) : (
                <div style={{overflowX:"auto",paddingBottom:10}}>
                  <datalist id="lesson-import-error-studios">
                    {studios.map(studio => <option key={studio.id} value={studio.name}/>)}
                  </datalist>
                  <datalist id="lesson-import-error-lecturers">
                    {lecturers.map(lecturer => <option key={lecturer.id} value={lecturerDisplayName(lecturer)}/>)}
                  </datalist>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:1180,tableLayout:"fixed"}}>
                    <thead>
                      <tr style={{background:"var(--surface2)",color:"var(--text2)"}}>
                        {[
                          {label:"", width:44},
                          {label:"שורה", width:58},
                          {label:"קורס", width:250},
                          {label:"מסלול", width:150},
                          {label:"מרצה", width:105},
                          {label:"תאריך", width:90},
                          {label:"שעות", width:96},
                          {label:"כיתה", width:150},
                          {label:"סיבת הכשל", width:300},
                        ].map((header) => (
                          <th key={header.label || "action"} style={{padding:"8px 10px",border:"1px solid var(--border)",textAlign:"right",whiteSpace:"nowrap",width:header.width}}>{header.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(importReport.errors || []).map((error, index) => {
                        const isEditing = editingImportErrorKey === reportErrorIdentity(error);
                        const iconButtonStyle = {width:30,height:30,minWidth:30,minHeight:30,padding:0,borderRadius:8,display:"inline-flex",alignItems:"center",justifyContent:"center"};
                        const actionButtonStyle = {height:30,minHeight:30,padding:"4px 9px",fontSize:12,borderRadius:8,whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:5};
                        return (
                          <Fragment key={`${reportErrorKey(error)}-${index}`}>
                            <tr style={isEditing ? {background:"rgba(245,166,35,0.05)"} : undefined}>
                              <td style={{padding:"6px",border:"1px solid var(--border)",whiteSpace:"nowrap",verticalAlign:"top",width:44,textAlign:"center"}}>
                                <button type="button" className="btn btn-secondary btn-sm" aria-label={isEditing ? "סגור עריכה" : "עריכת שורה"} title={isEditing ? "סגור עריכה" : "עריכת שורה"} onClick={() => isEditing ? cancelEditImportError() : startEditImportError(error)} style={iconButtonStyle}>
                                  {isEditing ? <X size={14} strokeWidth={1.9}/> : <Pencil size={14} strokeWidth={1.9}/>}
                                </button>
                              </td>
                              <td style={{padding:"8px 10px",border:"1px solid var(--border)",fontWeight:800,color:"var(--accent)",verticalAlign:"top",width:58}}>{error.rowNumber}</td>
                              <td style={{padding:"8px 10px",border:"1px solid var(--border)",verticalAlign:"top",width:250,lineHeight:1.45}}>{error.courseName || "—"}</td>
                              <td style={{padding:"8px 10px",border:"1px solid var(--border)",verticalAlign:"top",width:150,lineHeight:1.45}}>{error.track || "—"}</td>
                              <td style={{padding:"8px 10px",border:"1px solid var(--border)",verticalAlign:"top",width:105,lineHeight:1.45}}>{error.instructorName || "—"}</td>
                              <td style={{padding:"8px 10px",border:"1px solid var(--border)",direction:"ltr",textAlign:"right",verticalAlign:"top",width:88}}>{formatLessonDateShort(error.date) || "—"}</td>
                              <td style={{padding:"8px 10px",border:"1px solid var(--border)",direction:"ltr",textAlign:"right",verticalAlign:"top",width:96}}>{error.startTime || "—"}-{error.endTime || "—"}</td>
                              <td style={{padding:"8px 10px",border:"1px solid var(--border)",verticalAlign:"top",width:150,lineHeight:1.45}}>{error.studioName || "—"}</td>
                              <td style={{padding:"8px 10px",border:"1px solid var(--border)",color:"var(--red)",fontWeight:800,verticalAlign:"top",width:300,lineHeight:1.45,whiteSpace:"normal"}}>{error.reason}</td>
                            </tr>
                            {isEditing && (
                              <tr>
                                <td colSpan={9} style={{padding:"12px 14px",border:"1px solid rgba(245,166,35,0.32)",background:"rgba(245,166,35,0.07)",overflowX:"auto"}}>
                                  <div style={{display:"grid",gridTemplateColumns:"minmax(260px,1fr) minmax(420px,1.4fr) minmax(150px,0.7fr) 120px 96px 96px minmax(170px,0.8fr)",gap:8,alignItems:"end",minWidth:1160}}>
                                    <label style={{display:"flex",flexDirection:"column",gap:4,fontSize:11,color:"var(--text2)",fontWeight:800}}>
                                      קורס
                                      <input className="form-input" value={importErrorDraft?.courseName || ""} onChange={e=>updateImportErrorDraft("courseName", e.target.value)} style={{height:32,fontSize:12,width:"100%"}}/>
                                    </label>
                                    <label style={{display:"flex",flexDirection:"column",gap:4,fontSize:11,color:"var(--text2)",fontWeight:800}}>
                                      מסלול
                                      <select className="form-select" value={importErrorDraft?.track || ""} onChange={e=>updateImportErrorDraft("track", e.target.value)} title={importErrorDraft?.track || "בחר מסלול"} style={{height:40,minHeight:40,fontSize:12,lineHeight:"20px",width:"100%",direction:"rtl",textAlign:"right",paddingTop:0,paddingBottom:0}}>
                                        <option value="">בחר מסלול</option>
                                        {normalizedTrackOptions.map(track => <option key={track} value={track}>{track}</option>)}
                                      </select>
                                    </label>
                                    <label style={{display:"flex",flexDirection:"column",gap:4,fontSize:11,color:"var(--text2)",fontWeight:800}}>
                                      מרצה
                                      <input className="form-input" list="lesson-import-error-lecturers" value={importErrorDraft?.instructorName || ""} onChange={e=>updateImportErrorDraft("instructorName", e.target.value)} style={{height:32,fontSize:12,width:"100%"}}/>
                                    </label>
                                    <label style={{display:"flex",flexDirection:"column",gap:4,fontSize:11,color:"var(--text2)",fontWeight:800}}>
                                      תאריך
                                      <input className="form-input" value={importErrorDraft?.date || ""} onChange={e=>updateImportErrorDraft("date", e.target.value)} placeholder="DD/MM/YY" style={{height:32,fontSize:12,textAlign:"right"}}/>
                                    </label>
                                    <label style={{display:"flex",flexDirection:"column",gap:4,fontSize:11,color:"var(--text2)",fontWeight:800}}>
                                      התחלה
                                      <input className="form-input" value={importErrorDraft?.startTime || ""} onChange={e=>updateImportErrorDraft("startTime", e.target.value)} style={{height:32,fontSize:12,textAlign:"right"}}/>
                                    </label>
                                    <label style={{display:"flex",flexDirection:"column",gap:4,fontSize:11,color:"var(--text2)",fontWeight:800}}>
                                      סיום
                                      <input className="form-input" value={importErrorDraft?.endTime || ""} onChange={e=>updateImportErrorDraft("endTime", e.target.value)} style={{height:32,fontSize:12,textAlign:"right"}}/>
                                    </label>
                                    <label style={{display:"flex",flexDirection:"column",gap:4,fontSize:11,color:"var(--text2)",fontWeight:800}}>
                                      כיתה
                                      <input className="form-input" list="lesson-import-error-studios" value={importErrorDraft?.studioName || ""} onChange={e=>updateImportErrorDraft("studioName", e.target.value)} style={{height:32,fontSize:12,width:"100%"}}/>
                                    </label>
                                    <div style={{gridColumn:"1 / -1",display:"flex",gap:8,whiteSpace:"nowrap",justifyContent:"flex-start",paddingTop:8,borderTop:"1px solid rgba(245,166,35,0.18)"}}>
                                      <button type="button" className="btn btn-primary btn-sm" onClick={retryImportErrorDraft} disabled={retryingImportError} style={actionButtonStyle}>
                                        <Check size={12} strokeWidth={1.75}/> {retryingImportError ? "שומר..." : "שמור"}
                                      </button>
                                      <button type="button" className="btn btn-secondary btn-sm" onClick={cancelEditImportError} disabled={retryingImportError} style={actionButtonStyle}>
                                        ביטול
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div style={{padding:"14px 20px",borderTop:"1px solid var(--border)",display:"flex",gap:10,justifyContent:"flex-end",flexWrap:"wrap"}}>
              <button className="btn btn-secondary" onClick={()=>setImportReport(null)}>
                <X size={16} strokeWidth={1.75}/> סגור
              </button>
              {(importReport.errors || []).length > 0 && (
                <button className="btn btn-primary" onClick={printImportReport}>
                  <Download size={16} strokeWidth={1.75}/> הדפס/שמור PDF
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {lessonConflicts.length > 0 && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",zIndex:4100,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}}>
          <div style={{width:"100%",maxWidth:640,background:"var(--surface)",borderRadius:16,border:"1px solid rgba(231,76,60,0.5)",direction:"rtl",maxHeight:"88vh",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",background:"rgba(231,76,60,0.08)",borderRadius:"16px 16px 0 0"}}>
              <div style={{fontWeight:900,fontSize:17,color:"var(--red)"}}>⚠️ קונפליקטים עם קורסים אחרים ({lessonConflicts.length})</div>
              <div style={{fontSize:13,color:"var(--text2)",marginTop:6,lineHeight:1.5}}>
                לפני שמירת הקורס הנוכחי — תקן את המפגשים המתנגשים בקורסים האחרים. כל תיקון נשמר מיד והבדיקה רצה מחדש אוטומטית.
              </div>
            </div>
            <div style={{overflowY:"auto",flex:1,padding:"16px 20px",display:"flex",flexDirection:"column",gap:12}}>
              {lessonConflicts.map((c, i) => {
                const otherLesson = lessons.find(l => String(l.id) === String(c.otherLessonId));
                if (!otherLesson) return null;
                return (
                  <ConflictResolverCard
                    key={`${c.otherLessonId}-${c.otherSessionIdx}-${c.kind}-${i}`}
                    conflict={c}
                    otherLesson={otherLesson}
                    studios={studios}
                    classroomStudios={studios.filter(st => st?.isClassroom || st?.classroomOnly)}
                    lecturers={lecturers}
                    onSaveFix={(patch) => applyOtherLessonFix(c.otherLessonId, c.otherSessionIdx, patch)}
                  />
                );
              })}
            </div>
            <div style={{padding:"14px 20px",borderTop:"1px solid var(--border)",display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button className="btn btn-secondary" onClick={()=>{ setLessonConflicts([]); setPendingLesson(null); }}>
                <X size={16} strokeWidth={1.75}/> בטל ועריכת הקורס הנוכחי
              </button>
            </div>
          </div>
        </div>
      )}
      {conflicts.length > 0 && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",zIndex:4000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}}>
          <div style={{width:"100%",maxWidth:520,background:"var(--surface)",borderRadius:16,border:"1px solid rgba(231,76,60,0.5)",direction:"rtl",maxHeight:"80vh",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",background:"rgba(231,76,60,0.08)",borderRadius:"16px 16px 0 0"}}>
              <div style={{fontWeight:900,fontSize:17,color:"var(--red)"}}>⚠️ התנגשות עם קביעות חדרים</div>
              <div style={{fontSize:13,color:"var(--text2)",marginTop:4}}>{conflicts.length} קביעות חדרים חופפות עם שיעורי הקורס</div>
            </div>
            <div style={{overflowY:"auto",flex:1,padding:"16px 20px",display:"flex",flexDirection:"column",gap:10}}>
              {conflicts.map(({ booking, studioName }, i) => {
                const waLink = buildConflictWhatsAppLink(booking, studioName);
                return (
                  <div key={i} style={{background:"var(--surface2)",borderRadius:10,padding:"12px 14px",border:"1px solid rgba(231,76,60,0.2)"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,flexWrap:"wrap"}}>
                      <div style={{flex:1, minWidth:0}}>
                        <div style={{fontWeight:800,fontSize:14,marginBottom:6}}>{booking.studentName || booking.teamMemberName || "קביעת חדר"}</div>
                        <div style={{fontSize:11,color:"var(--text3)",marginBottom:4}}>{(booking.bookingKind || (booking.teamMemberId ? "team" : "student")) === "team" ? "קביעת צוות" : "קביעת סטודנט"}</div>
                        <div style={{fontSize:12,color:"var(--text2)"}}><Mic size={16} strokeWidth={1.75} /> {studioName}</div>
                        <div style={{fontSize:12,color:"var(--text2)"}}><Calendar size={16} strokeWidth={1.75} /> {formatLessonDateShort(booking.date)}</div>
                        <div style={{fontSize:12,color:"var(--text2)",display:"flex",alignItems:"center",gap:4}}><Clock size={12} strokeWidth={1.75}/> {booking.startTime} – {booking.endTime}</div>
                      </div>
                      {waLink ? (
                        <a
                          href={waLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="פתח שיחת WhatsApp עם המשתמש (הטקסט יתעדכן אוטומטית לפי ההודעה שכתבת)"
                          style={{
                            display:"inline-flex",
                            alignItems:"center",
                            gap:5,
                            background:"#25D366",
                            color:"#0a3d20",
                            fontWeight:800,
                            fontSize:12,
                            padding:"6px 10px",
                            borderRadius:8,
                            textDecoration:"none",
                            whiteSpace:"nowrap",
                            boxShadow:"0 1px 4px rgba(37,211,102,0.35)",
                          }}
                        >
                          <Phone size={14} strokeWidth={2}/> WhatsApp
                        </a>
                      ) : (
                        <span title="לא נמצא מספר טלפון למשתמש זה" style={{fontSize:10,color:"var(--text3)",fontStyle:"italic"}}>אין טלפון</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{padding:"12px 20px", borderTop:"1px solid var(--border)"}}>
              <label style={{fontSize:12, fontWeight:700, color:"var(--text2)", display:"block", marginBottom:6}}>
                💬 הודעה מותאמת אישית למשתמש שנפגע (אופציונלי)
              </label>
              <textarea
                value={conflictMessage}
                onChange={e => setConflictMessage(e.target.value)}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
                }}
                placeholder='לדוגמה: "אני מצטער על העברת השיעור, ניתן להזמין את החדר ביום אחר."'
                rows={2}
                disabled={conflictSending}
                style={{
                  width: "100%",
                  minHeight: 56,
                  maxHeight: 240,
                  resize: "none",
                  overflow: "auto",
                  fontSize: 13,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface2)",
                  color: "var(--text)",
                  fontFamily: "inherit",
                  direction: "rtl",
                  boxSizing: "border-box",
                }}
              />
              <div style={{fontSize:11, color:"var(--text3)", marginTop:4}}>
                הטקסט יתווסף בסוף המייל האוטומטי כבלוק נפרד "הודעה מהמכללה".
              </div>
            </div>
            <div style={{padding:"14px 20px",borderTop:"1px solid var(--border)",display:"flex",gap:10,justifyContent:"flex-end",flexWrap:"wrap"}}>
              <button className="btn btn-secondary" disabled={conflictSending}
                onClick={()=>{ setConflicts([]); setPendingLesson(null); setConflictMessage(""); }}>
                <X size={16} strokeWidth={1.75} color="var(--text3)" /> בטל שיוך
              </button>
              <button className="btn btn-danger" disabled={conflictSending} onClick={confirmConflictAndSend}>
                {conflictSending ? <><Clock size={16} strokeWidth={1.75} /> שומר...</> : <><CheckCircle size={16} strokeWidth={1.75} /> אשר והמשך</>}
              </button>
            </div>
          </div>
        </div>
      )}
      {mode ? (
        <LessonForm
          initial={editTarget}
          onSave={save}
          onCancel={()=>{setMode(null);setEditTarget(null);}}
          studios={studios}
          equipment={equipment}
          reservations={reservations}
          setReservations={setReservations}
          kits={kits}
          showToast={showToast}
          trackOptions={trackOptions}
          lecturers={lecturers}
          setLecturers={setLecturers}
          certifications={certifications}
          siteSettings={siteSettings}
        />
      ) : (
        <>
          {/* Controls — search, sorting, time/status filters, and actions */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}}>
            <div className="search-bar" style={{flex:"1 1 260px",minWidth:220}}><span><Search size={16} strokeWidth={1.75} color="var(--text3)" /></span>
              <input placeholder="חיפוש קורס או מרצה..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
            <div style={{display:"flex",gap:6,alignItems:"center",flex:"0 0 auto"}}>
              <span style={{fontSize:12,color:"var(--text3)",fontWeight:700}}>מיון:</span>
              <select
                className="form-select"
                style={{minWidth:118,fontSize:12,padding:"6px 8px",fontWeight:700,borderColor:sortMode!=="recent"?"#f5a623":"var(--border)",color:sortMode!=="recent"?"#f5a623":"var(--text2)"}}
                value={sortMode}
                onChange={e=>setSortMode(e.target.value)}
              >
                <option value="recent">🕐 קבלה</option>
                <option value="urgency">⚡ דחיפות</option>
              </select>
            </div>
            <select
              className="form-select"
              style={{minWidth:112,fontSize:12,padding:"6px 8px",fontWeight:700,borderColor:timeFilter!=="all"?"#4ade80":"var(--border)",color:timeFilter!=="all"?"#4ade80":"var(--text2)",flex:"0 0 auto"}}
              value={timeFilter}
              onChange={e=>setTimeFilter(e.target.value)}
            >
              <option value="all">הכל</option>
              <option value="today">📍 היום</option>
              <option value="week">🗓️ השבוע</option>
              <option value="month">📅 החודש</option>
            </select>
            <button
              type="button"
              onClick={() => setShowUnassignedLecturerOnly(v => !v)}
              style={{
                padding: "6px 14px", borderRadius: 20, fontWeight: 800, fontSize: 12, cursor: "pointer",
                border: `2px solid ${showUnassignedLecturerOnly ? "#ef4444" : "var(--border)"}`,
                background: showUnassignedLecturerOnly ? "rgba(239,68,68,0.14)" : "transparent",
                color: showUnassignedLecturerOnly ? "#ef4444" : "var(--text3)",
                display: "inline-flex", alignItems: "center", gap: 6, flex:"0 0 auto",
              }}
            >
              <User size={14} strokeWidth={1.75}/> ללא מרצה
              {withoutLecturerCount > 0 && (
                <span style={{ background: showUnassignedLecturerOnly ? "#ef4444" : "rgba(239,68,68,0.18)", color: showUnassignedLecturerOnly ? "#fff" : "#ef4444", borderRadius: 20, padding: "1px 7px", fontSize: 11, fontWeight: 900 }}>
                  {withoutLecturerCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => { setArchiveView(v => !v); setSearch(""); setTrackFilter([]); setShowUnassignedLecturerOnly(false); }}
              style={{
                padding: "6px 14px", borderRadius: 20, fontWeight: 700, fontSize: 13, cursor: "pointer",
                border: `2px solid ${archiveView ? "#e67e22" : "var(--border)"}`,
                background: archiveView ? "rgba(230,126,34,0.14)" : "transparent",
                color: archiveView ? "#e67e22" : "var(--text3)",
                display: "inline-flex", alignItems: "center", gap: 6, flex:"0 0 auto",
              }}
            >
              <Package size={16} strokeWidth={1.75} /> ארכיון
              {archivedCount > 0 && (
                <span style={{ background: archiveView ? "#e67e22" : "rgba(230,126,34,0.25)", color: archiveView ? "#fff" : "#e67e22", borderRadius: 20, padding: "1px 7px", fontSize: 11, fontWeight: 800 }}>
                  {archivedCount}
                </span>
              )}
            </button>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginInlineStart:"auto"}}>
            <input ref={importInputRef} type="file" accept=".csv,.tsv,.xlsx,.xls" style={{display:"none"}} onChange={handleLessonsXLFileSelect} disabled={xlImporting}/>
            <button className="btn btn-primary" onClick={()=>importInputRef.current?.click()} disabled={xlImporting}>{xlImporting ? "מייבא..." : "ייבוא XL"}</button>
            {import.meta.env.DEV && (
              <button className="btn btn-secondary" onClick={runStage8Backfill} disabled={stage8Backfilling} title="Sync store.lessons blob → public.lessons table (dev only)">
                {stage8Backfilling ? "מסנכרן..." : "🔁 Stage 8 Backfill"}
              </button>
            )}
            <button className="btn btn-primary" onClick={()=>{setMode("add");setEditTarget(null);}}>➕ קורס חדש</button>
            </div>
          </div>

          {allTrackFilters.length > 1 && (
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16,alignItems:"center"}}>
              {/* View-mode toggle switch — flips the lessons list between
                  grouped-by-track and flat (global) views. */}
              {(() => {
                const isFlat = lessonsViewMode === "flat";
                return (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isFlat}
                    onClick={() => setLessonsViewMode(prev => prev === "grouped" ? "flat" : "grouped")}
                    title={isFlat
                      ? "תצוגה גלובלית פעילה — לחץ כדי לחזור לחלוקה למסלולים"
                      : "לחץ כדי להציג את כל הקורסים ברשימה אחת בלי חלוקה למסלולים"}
                    style={{
                      display:"inline-flex",
                      alignItems:"center",
                      gap:8,
                      padding:"4px 12px 4px 6px",
                      borderRadius:999,
                      border:`2px solid ${isFlat ? "#3498db" : "var(--border)"}`,
                      background:isFlat ? "rgba(52,152,219,0.12)" : "transparent",
                      color:isFlat ? "#3498db" : "var(--text3)",
                      fontWeight:700,
                      fontSize:12,
                      cursor:"pointer",
                      transition:"all 0.15s ease",
                    }}
                  >
                    <span style={{
                      position:"relative",
                      width:36,
                      height:20,
                      borderRadius:999,
                      background:isFlat ? "#3498db" : "#888",
                      transition:"background 0.18s ease",
                      flexShrink:0,
                    }}>
                      <span style={{
                        position:"absolute",
                        top:2,
                        left:isFlat ? 18 : 2,
                        width:16,
                        height:16,
                        borderRadius:"50%",
                        background:"#fff",
                        transition:"left 0.18s ease",
                        boxShadow:"0 1px 2px rgba(0,0,0,0.35)",
                      }}/>
                    </span>
                    <span>{isFlat ? "תצוגה גלובלית" : "כל המסלולים"}</span>
                  </button>
                );
              })()}
              {/* Specific track chips — track filter (unchanged behavior). */}
              {allTrackFilters.filter(t => t !== "הכל").map((trackName) => {
                const isUnassigned = trackName === UNASSIGNED_TRACK;
                const active = isTrackSelected(trackName);
                const activeColor = isUnassigned ? "#ef4444" : "#f5a623";
                return (
                  <button
                    key={trackName}
                    type="button"
                    onClick={() => toggleTrackFilter(trackName)}
                    style={{
                      padding:"5px 12px",
                      borderRadius:20,
                      border:`2px solid ${active ? activeColor : isUnassigned ? "rgba(239,68,68,0.4)" : "var(--border)"}`,
                      background:active ? (isUnassigned ? "rgba(239,68,68,0.14)" : "rgba(245,166,35,0.14)") : "transparent",
                      color:active ? activeColor : isUnassigned ? "rgba(239,68,68,0.6)" : "var(--text3)",
                      fontWeight:700,
                      fontSize:12,
                      cursor:"pointer",
                    }}
                  >
                    {trackName}
                  </button>
                );
              })}
            </div>
          )}
          {allTrackFilters.length > 1 && (
            <div style={{fontSize:11,color:"var(--text3)",marginTop:-8,marginBottom:16}}>
              <Lightbulb size={16} strokeWidth={1.75} /> {lessonsViewMode === "flat"
                ? 'תצוגה גלובלית פעילה — כל הקורסים מוצגים יחד. לחיצה על "תצוגה גלובלית" תחזיר לחלוקה למסלולים. סימון מסלול ספציפי יסנן את הרשימה.'
                : "אפשר לבחור כמה מסלולי לימוד יחד כדי להציג אותם במקביל."}
            </div>
          )}

          {/* Course detail modal */}
          {detailTarget && (
            <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:9000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setDetailTarget(null)}>
              <div style={{background:"var(--surface)",borderRadius:14,maxWidth:560,width:"100%",maxHeight:"88vh",display:"flex",flexDirection:"column",border:"1px solid var(--border)",boxShadow:"0 8px 32px rgba(0,0,0,0.5)"}} onClick={e=>e.stopPropagation()}>
                <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontWeight:900,fontSize:16,color:"#9b59b6"}}><BookOpen size={16} strokeWidth={1.75} /> {detailTarget.name}</span>
                  <div style={{display:"flex",gap:6}}>
                    <button className="btn btn-secondary btn-sm" onClick={()=>{setDetailTarget(null);setEditTarget(detailTarget);setMode("edit");}} style={{display:"inline-flex",alignItems:"center",gap:4}}><Pencil size={12} strokeWidth={1.75} color="var(--text3)"/> עריכה</button>
                    <button className="btn btn-secondary btn-sm" onClick={()=>setDetailTarget(null)}><X size={16} strokeWidth={1.75} color="var(--text3)" /></button>
                  </div>
                </div>
                <div style={{overflowY:"auto",flex:1,padding:"16px 20px",display:"flex",flexDirection:"column",gap:14}}>
                  <div style={{background:"rgba(155,89,182,0.07)",border:"1px solid rgba(155,89,182,0.22)",borderRadius:10,padding:"10px 14px"}}>
                    <div style={{fontWeight:800,fontSize:12,color:"#9b59b6",marginBottom:6,display:"flex",alignItems:"center",gap:5}}><BookOpen size={13} strokeWidth={1.75}/> שם הקורס</div>
                    <div style={{fontSize:15,fontWeight:900,color:"var(--text)"}}>{detailTarget.name}</div>
                  </div>
                  {/* Instructor */}
                  {detailTarget.track && (
                    <div style={{background:"rgba(245,166,35,0.07)",border:"1px solid rgba(245,166,35,0.22)",borderRadius:10,padding:"10px 14px"}}>
                      <div style={{fontWeight:800,fontSize:12,color:"#f5a623",marginBottom:6,display:"flex",alignItems:"center",gap:5}}><GraduationCap size={13} strokeWidth={1.75}/> מסלול לימודים</div>
                      <div style={{fontSize:13,fontWeight:800,color:"var(--text)"}}>{detailTarget.track}</div>
                    </div>
                  )}
                  {(detailTarget.instructorName||detailTarget.instructorEmail||detailTarget.instructorPhone||normalizeLessonLecturerList(detailTarget).length > 0) && (
                    <div style={{background:"rgba(155,89,182,0.07)",border:"1px solid rgba(155,89,182,0.2)",borderRadius:10,padding:"12px 14px"}}>
                      <div style={{fontWeight:800,fontSize:12,color:"#9b59b6",marginBottom:8}}>מרצי הקורס</div>
                      {normalizeLessonLecturerList(detailTarget).map((lecturer) => (
                        <div key={lecturer.lecturerId || lecturer.instructorName} style={{fontSize:13,fontWeight:700,marginBottom:4}}>{lecturer.instructorName}</div>
                      ))}
                      {detailTarget.instructorPhone && <div style={{fontSize:14,fontWeight:700,color:"var(--text)",marginTop:6,display:"flex",alignItems:"center",gap:6}}><Phone size={14} strokeWidth={2}/> {detailTarget.instructorPhone}</div>}
                      {detailTarget.instructorEmail && <div style={{fontSize:14,fontWeight:700,color:"var(--text)",marginTop:4,display:"flex",alignItems:"center",gap:6,wordBreak:"break-all"}}><Mail size={14} strokeWidth={2}/> {detailTarget.instructorEmail}</div>}
                    </div>
                  )}
                  {/* Studio/Kit */}
                  {(() => {
                    const courseStudioIds = (() => {
                      const ids = [];
                      const seen = new Set();
                      const push = (id) => {
                        const k = String(id || "").trim();
                        if (!k || seen.has(k)) return;
                        seen.add(k);
                        ids.push(k);
                      };
                      (detailTarget.studios || []).forEach(cs => push(cs?.studioId));
                      push(detailTarget.studioId);
                      (detailTarget.schedule || []).forEach(s => {
                        (s.studioIds || []).forEach(push);
                        push(s.studioId);
                        push(s.secondaryStudioId);
                      });
                      return ids;
                    })();
                    const courseStudioObjs = courseStudioIds
                      .map(id => studios.find(s => String(s.id) === id))
                      .filter(Boolean);
                    const linkedKit = getLinkedKit(detailTarget);
                    if (courseStudioObjs.length === 0 && !linkedKit) return null;
                    return (
                      <div style={{background:"rgba(52,152,219,0.07)",border:"1px solid rgba(52,152,219,0.2)",borderRadius:10,padding:"12px 14px"}}>
                        <div style={{fontWeight:800,fontSize:12,color:"#3498db",marginBottom:8,display:"flex",alignItems:"center",gap:4}}><Link size={12} strokeWidth={1.75}/> שיוכים</div>
                        {courseStudioObjs.map(st => (
                          <div key={st.id} style={{fontSize:13,marginBottom:2}}><Mic size={16} strokeWidth={1.75} /> {st.name}</div>
                        ))}
                        {linkedKit && <div style={{fontSize:13,marginTop:4,display:"flex",alignItems:"center",gap:4}}><Package size={13} strokeWidth={1.75}/> {linkedKit.name}</div>}
                      </div>
                    );
                  })()}
                  {/* Sessions */}
                  <div style={{background:"rgba(46,204,113,0.06)",border:"1px solid rgba(46,204,113,0.2)",borderRadius:10,padding:"12px 14px"}}>
                    <div style={{fontWeight:800,fontSize:12,color:"var(--green)",marginBottom:8}}><Calendar size={16} strokeWidth={1.75} /> מפגשים ({getLessonDisplaySchedule(detailTarget).length})</div>
                    {getLessonDisplaySchedule(detailTarget).length === 0
                      ? <div style={{fontSize:12,color:"var(--text3)"}}>אין מפגשים רשומים</div>
                      : (() => {
                          // Build id → name map once for the whole sessions block so
                          // session.lecturerIds[] can resolve to display names joined
                          // by " + " (multi-lecturer per session, PR #24).
                          const lessonLecturerById = new Map();
                          if (Array.isArray(detailTarget?.lecturers)) {
                            for (const item of detailTarget.lecturers) {
                              if (item?.lecturerId) lessonLecturerById.set(String(item.lecturerId), String(item.instructorName || "").trim());
                            }
                          }
                          return (
                            <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:300,overflowY:"auto"}}>
                              {getLessonDisplaySchedule(detailTarget).sort((a,b)=>a.date.localeCompare(b.date)).map((s,i)=>{
                                const isPast = s.date < today();
                                const sessionLecturerIds = Array.isArray(s.lecturerIds) ? s.lecturerIds.filter(Boolean) : [];
                                const joinedLecturers = sessionLecturerIds.length
                                  ? sessionLecturerIds.map(id => lessonLecturerById.get(String(id)) || "").filter(Boolean).join(" + ")
                                  : "";
                                const lecturerLabel = joinedLecturers || s.instructorName || s.alternateInstructorName || "";
                                return (
                                  <div key={i} style={{display:"flex",gap:10,alignItems:"center",padding:"8px 12px",borderRadius:8,background:isPast?"rgba(0,0,0,0.1)":"rgba(46,204,113,0.07)",opacity:isPast?0.55:1}}>
                                    <span style={{fontSize:13,fontWeight:800,minWidth:92}}>{formatLessonDateShort(s.date)}</span>
                                    {s.startTime && <span style={{fontSize:14,fontWeight:800,color:"var(--green)",letterSpacing:0.3,fontVariantNumeric:"tabular-nums"}}>{s.startTime}{s.endTime?`–${s.endTime}`:""}</span>}
                                    {lecturerLabel && <span style={{fontSize:11,color:"#f5a623",fontWeight:800}}>מרצה: {lecturerLabel}</span>}
                                    {s.topic && <span style={{fontSize:12,color:"var(--text2)",flex:1}}>· {s.topic}</span>}
                                    {isPast && <span style={{fontSize:10,color:"var(--text3)"}}>עבר</span>}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()
                    }
                  </div>
                  {detailTarget.description && <div style={{fontSize:13,color:"var(--text3)",display:"flex",alignItems:"center",gap:4}}><FileText size={12} strokeWidth={1.75}/> {detailTarget.description}</div>}
                </div>
              </div>
            </div>
          )}


          {archiveView && (
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,padding:"10px 16px",background:"rgba(230,126,34,0.08)",border:"1px solid rgba(230,126,34,0.25)",borderRadius:10}}>
              <span style={{fontSize:18}}><Package size={18} strokeWidth={1.75} /></span>
              <span style={{fontSize:13,color:"#e67e22",fontWeight:700}}>תצוגת ארכיון — קורסים שכל מפגשיהם הסתיימו</span>
              <button type="button" onClick={()=>setArchiveView(false)} style={{marginRight:"auto",padding:"2px 10px",borderRadius:20,border:"1px solid rgba(230,126,34,0.5)",background:"transparent",color:"#e67e22",fontSize:12,cursor:"pointer",fontWeight:700}}>חזור לפעילים</button>
            </div>
          )}
          {showUnassignedLecturerOnly && (
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,padding:"10px 16px",background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:10}}>
              <User size={16} strokeWidth={1.75} color="#ef4444"/>
              <span style={{fontSize:13,color:"#ef4444",fontWeight:800}}>מציג קורסים ללא מרצה משויך</span>
              <button type="button" onClick={()=>setShowUnassignedLecturerOnly(false)} style={{marginRight:"auto",padding:"2px 10px",borderRadius:20,border:"1px solid rgba(239,68,68,0.5)",background:"transparent",color:"#ef4444",fontSize:12,cursor:"pointer",fontWeight:800}}>בטל סינון</button>
            </div>
          )}

          {sortedFiltered.length===0
            ? <div className="empty-state"><div className="emoji"><Package size={32} strokeWidth={1.75} /></div><div>{archiveView ? "אין קורסים בארכיון" : showUnassignedLecturerOnly ? "לא נמצאו קורסים ללא מרצה" : lessons.length===0 ? "אין קורסים עדיין" : "לא נמצאו קורסים למסלולים שנבחרו"}</div><div style={{fontSize:13,color:"var(--text3)"}}>{archiveView ? "קורסים עוברים לארכיון אוטומטית כשמפגשם האחרון מסתיים" : showUnassignedLecturerOnly ? "כל הקורסים הפעילים משויכים לפחות למרצה אחד" : lessons.length===0 ? 'לחץ "➕ קורס חדש" כדי להתחיל' : "נסה לשנות חיפוש או מסלולי לימוד"}</div></div>
            : (() => {
                // Inline card renderer shared by both view modes. `groupContextTrack`
                // is the track of the surrounding group container (grouped mode)
                // or null (flat mode — always show the course's own track inside
                // the card to keep the info visible).
                const renderCourseCard = (l, groupContextTrack) => {
                  const cardStudioIds = (() => {
                    const ids = [];
                    const seen = new Set();
                    const push = (id) => {
                      const k = String(id || "").trim();
                      if (!k || seen.has(k)) return;
                      seen.add(k);
                      ids.push(k);
                    };
                    (l.studios || []).forEach(cs => push(cs?.studioId));
                    push(l.studioId);
                    (l.schedule || []).forEach(s => {
                      (s.studioIds || []).forEach(push);
                      push(s.studioId);
                      push(s.secondaryStudioId);
                    });
                    return ids;
                  })();
                  const cardStudios = cardStudioIds
                    .map(id => studios.find(s => String(s.id) === id))
                    .filter(Boolean);
                  const kit = getLinkedKit(l);
                  const displaySchedule = getLessonDisplaySchedule(l);
                  const upcoming = displaySchedule.filter(s=>s.date>=today()).length;
                  const nextSession = displaySchedule.filter(s=>s.date>=today()).sort((a,b)=>a.date.localeCompare(b.date))[0];
                  const cardTrack = getLessonTrackLabel(l);
                  const cardLecturers = normalizeLessonLecturerList(l);
                  // In grouped mode the surrounding container shows the track header,
                  // so skip the track sub-label inside the card unless it's the
                  // "unassigned" group. In flat mode always show the track.
                  const showTrackInCard = !groupContextTrack || (groupContextTrack === UNASSIGNED_TRACK && cardTrack !== UNASSIGNED_TRACK)
                    ? cardTrack !== UNASSIGNED_TRACK
                    : (groupContextTrack !== UNASSIGNED_TRACK && false); // grouped + non-unassigned → hide
                  return (
                    <div key={l.id}
                      onClick={()=>setDetailTarget(l)}
                      style={{position:"relative",background:"var(--surface2)",borderRadius:10,padding:"14px 16px",paddingBottom:24,border:"1px solid var(--border)",borderRight:"4px solid #9b59b6",cursor:"pointer",transition:"border-color 0.15s"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,flexWrap:"wrap"}}>
                        <div style={{flex:1,minWidth:200}}>
                          <div style={{fontWeight:800,fontSize:16,marginBottom:4}}>{l.name}</div>
                          {showTrackInCard && (
                            <div style={{fontSize:12,color:"#f5a623",fontWeight:800,marginBottom:4,display:"flex",alignItems:"center",gap:4}}>
                              <GraduationCap size={13} strokeWidth={1.75}/> {cardTrack}
                            </div>
                          )}
                          {cardLecturers.length > 0 ? (
                            <div style={{fontSize:13,color:"var(--text2)"}}>{cardLecturers.map(lecturer => lecturer.instructorName).filter(Boolean).join(" · ")}</div>
                          ) : (
                            <div style={{fontSize:12,color:"#ef4444",fontWeight:800,display:"inline-flex",alignItems:"center",gap:4}}><User size={12} strokeWidth={1.75}/> ללא מרצה</div>
                          )}
                          {nextSession && <div style={{fontSize:12,color:"var(--green)",marginTop:2}}><Calendar size={16} strokeWidth={1.75} /> מפגש קרוב: {formatLessonDateShort(nextSession.date)}{nextSession.startTime?` · ${nextSession.startTime}`:""}</div>}
                          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
                            <span style={{background:"rgba(155,89,182,0.12)",color:"#9b59b6",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}><Calendar size={16} strokeWidth={1.75} /> {displaySchedule.length} שיעורים</span>
                            {upcoming>0 && <span style={{background:"rgba(46,204,113,0.12)",color:"var(--green)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700,display:"inline-flex",alignItems:"center",gap:3}}><CheckCircle size={10} strokeWidth={1.75}/> {upcoming} קרובים</span>}
                            {cardStudios.map(st => (
                              <span key={st.id} style={{background:"rgba(52,152,219,0.12)",color:"var(--blue)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}><Mic size={16} strokeWidth={1.75} /> {st.name}</span>
                            ))}
                            {kit && <span style={{background:"rgba(245,166,35,0.12)",color:"var(--accent)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700,display:"inline-flex",alignItems:"center",gap:3}}><Package size={11} strokeWidth={1.75}/> {kit.name}</span>}
                          </div>
                        </div>
                        <div style={{display:"flex",gap:6}} onClick={e=>e.stopPropagation()}>
                          <button className="btn btn-secondary btn-sm" onClick={()=>{setEditTarget(l);setMode("edit");}} style={{display:"inline-flex",alignItems:"center",gap:4}}><Pencil size={12} strokeWidth={1.75} color="var(--text3)"/> עריכה</button>
                          <button className="btn btn-secondary btn-sm" style={{color:"var(--red)",borderColor:"var(--red)"}} onClick={()=>del(l.id)}>🗑️ מחק</button>
                        </div>
                      </div>
                      {l.created_at && (() => {
                        const d = new Date(l.created_at);
                        if (Number.isNaN(d.getTime())) return null;
                        const dd = String(d.getDate()).padStart(2,"0");
                        const mm = String(d.getMonth()+1).padStart(2,"0");
                        const yy = String(d.getFullYear()).slice(2);
                        const hh = String(d.getHours()).padStart(2,"0");
                        const min = String(d.getMinutes()).padStart(2,"0");
                        return (
                          <div style={{position:"absolute",bottom:6,left:12,fontSize:13,color:"var(--text2)",fontWeight:600,pointerEvents:"none"}}>
                            זמן יצירה: {dd}/{mm}/{yy} {hh}:{min}
                          </div>
                        );
                      })()}
                    </div>
                  );
                };
                if (lessonsViewMode === "flat") {
                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:10}}>
                      {sortedFiltered.map(l => renderCourseCard(l, null))}
                    </div>
                  );
                }
                return (
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {Object.entries(groupedLessons)
                      .sort(([left], [right]) => left.localeCompare(right, "he"))
                      .map(([trackName, trackLessons]) => (
                        <div key={trackName} style={{display:"flex",flexDirection:"column",gap:10,background:trackName===UNASSIGNED_TRACK?"rgba(239,68,68,0.04)":"rgba(245,166,35,0.04)",border:`1px solid ${trackName===UNASSIGNED_TRACK?"rgba(239,68,68,0.18)":"rgba(245,166,35,0.18)"}`,borderRadius:14,padding:"14px 16px"}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                            <span style={{fontWeight:900,fontSize:15,color:trackName===UNASSIGNED_TRACK?"#ef4444":"#f5a623"}}>{trackName===UNASSIGNED_TRACK?"⚠️":<GraduationCap size={16} strokeWidth={1.75} />} {trackName}</span>
                            <span style={{background:trackName===UNASSIGNED_TRACK?"rgba(239,68,68,0.16)":"rgba(245,166,35,0.16)",color:trackName===UNASSIGNED_TRACK?"#ef4444":"#f5a623",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:800}}>{trackLessons.length} קורסים</span>
                          </div>
                          {trackLessons.map(l => renderCourseCard(l, trackName))}
                        </div>
                      ))}
                  </div>
                );
              })()
          }
        </>
      )}
    </div>
  );
}

// ── Lesson/Course Form ────────────────────────────────────────────────────────
function LessonForm({ initial, onSave, onCancel, studios, equipment, reservations, setReservations, kits, showToast, trackOptions=[], lecturers=[], setLecturers, certifications={}, siteSettings={} }) {
  const lecturerOptions = lecturers.filter((lecturer) => lecturer?.isActive !== false);
  const displayLecturerName = (lecturer) => {
    const fullName = String(lecturer?.fullName || "").trim();
    const fromParts = [lecturer?.firstName, lecturer?.lastName].map(part => String(part || "").trim()).filter(Boolean).join(" ");
    return fullName || fromParts;
  };
  const [name, setName]                       = useState(initial?.name||"");
  const [track, setTrack]                     = useState(initial?.track||"");
  const initLecturerId = initial?.lecturerId || (initial?.instructorName ? (lecturers.find(l => displayLecturerName(l).trim().toLowerCase() === String(initial.instructorName||"").trim().toLowerCase())?.id || "") : "");
  const [lecturerId, setLecturerId]           = useState(initLecturerId);
  const normalizeCourseLecturerList = (items = []) => {
    const byKey = new Map();
    items.forEach((item) => {
      const rawId = item?.lecturerId || item?.id || "";
      const rawName = item?.instructorName || item?.fullName || item?.name || "";
      const matched = rawId
        ? lecturerOptions.find(l => String(l.id) === String(rawId))
        : lecturerOptions.find(l => displayLecturerName(l).trim().toLowerCase() === String(rawName || "").trim().toLowerCase());
      const id = matched?.id || rawId || null;
      const instructorName = displayLecturerName(matched) || String(rawName || "").trim();
      if (!id && !instructorName) return;
      const key = id ? `id:${id}` : `name:${instructorName.trim().toLowerCase()}`;
      if (!byKey.has(key)) byKey.set(key, { lecturerId: id, instructorName });
    });
    return [...byKey.values()];
  };
  const initLecturerName = initLecturerId
    ? (displayLecturerName(lecturers.find(l => l.id === initLecturerId)) || initial?.instructorName || "")
    : (initial?.instructorName || "");
  // Prefer the explicit course_lecturers list (persisted as a JSONB column on
  // public.lessons since 20260526200000). When it's populated we trust it as
  // the source of truth for the "מרצי הקורס" chips — that avoids session
  // overrides leaking back into the course list on every reload. Legacy rows
  // that pre-date the column fall through to the schedule-scavenging path.
  const persistedLecturers = Array.isArray(initial?.lecturers) ? initial.lecturers : [];
  const initialCourseLecturers = persistedLecturers.length
    ? normalizeCourseLecturerList([
        { lecturerId: initLecturerId, instructorName: initLecturerName },
        ...persistedLecturers,
      ])
    : normalizeCourseLecturerList([
        { lecturerId: initLecturerId, instructorName: initLecturerName },
        // Flatten each session's lecturerIds[] so all per-column assignments
        // surface as "מרצי הקורס" chips, in addition to the scalar lecturerId.
        ...((initial?.schedule || []).flatMap(session => {
          const ids = Array.isArray(session?.lecturerIds) && session.lecturerIds.length
            ? session.lecturerIds
            : [session?.lecturerId || session?.alternateLecturerId];
          return ids.filter(Boolean).map(id => ({
            lecturerId: id,
            instructorName: "",
          }));
        })),
      ]);
  const [courseLecturers, setCourseLecturers] = useState(initialCourseLecturers);
  const [additionalLecturerId, setAdditionalLecturerId] = useState("");
  const [description, setDescription]         = useState(initial?.description||"");
  const classroomStudios = studios.filter(st => st?.isClassroom || st?.classroomOnly);
  const studioById = (id) => studios.find(st => String(st?.id) === String(id || ""));
  const studioDisplayName = (id) => studioById(id)?.name || "";
  const normalizeCourseStudioList = (items = []) => {
    const out = [];
    const seen = new Set();
    items.forEach((item) => {
      const raw = item && typeof item === "object" ? (item.studioId ?? item.id ?? item) : item;
      if (raw === null || raw === undefined) return;
      const key = String(raw).trim();
      if (!key) return;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ studioId: key });
    });
    return out;
  };
  const initialCourseStudios = normalizeCourseStudioList([
    initial?.studioId,
    initial?.secondaryStudioId,
    ...(Array.isArray(initial?.studios) ? initial.studios : []),
    ...((initial?.schedule || []).flatMap(session => {
      if (Array.isArray(session?.studioIds) && session.studioIds.length) return session.studioIds;
      return [session?.studioId, session?.secondaryStudioId];
    })),
  ]);
  const [courseStudios, setCourseStudios] = useState(initialCourseStudios);
  const [additionalStudioId, setAdditionalStudioId] = useState("");
  const [schedule, setSchedule]               = useState(() => dedupeScheduleEntries((initial?.schedule||[]).map((entry) => {
    const normalized = normalizeScheduleEntry(entry);
    const matched = normalized.lecturerId
      ? lecturerOptions.find(l => String(l.id) === String(normalized.lecturerId))
      : lecturerOptions.find(l => displayLecturerName(l).trim().toLowerCase() === String(normalized.instructorName || "").trim().toLowerCase());
    return {
      ...normalized,
      lecturerId: matched?.id || normalized.lecturerId || null,
      instructorName: displayLecturerName(matched) || normalized.instructorName || "",
    };
  })));
  // Number of lecturer columns rendered in the schedule grid. Initialised
  // from the widest session.lecturerIds array on first load — sessions that
  // already have N lecturers force the grid to start with N columns so the
  // saved values are visible without clicking "הוסף עמודת מרצה" each time.
  const [lecturerColumnCount, setLecturerColumnCount] = useState(() => {
    const widest = (initial?.schedule || []).reduce((m, s) => Math.max(m, Array.isArray(s?.lecturerIds) ? s.lecturerIds.length : 0), 0);
    return Math.max(1, widest);
  });
  const [saving, setSaving]                   = useState(false);
  const [localMsg, setLocalMsg]               = useState(null);
  const [teacherMessage, setTeacherMessage]   = useState("");
  const [teacherEmailSending, setTeacherEmailSending] = useState(false);
  const [certificateTemplateType, setCertificateTemplateType] = useState(initial?.certificateTemplateType || "");
  const [certGenerating, setCertGenerating]   = useState(false);
  // Floating panel that shows the list of students with their lecturer-set
  // status (סיים / לא סיים / אין סטטוס). Read-only — admin verifies, doesn't
  // override. Toggled by the "צפה ברשימת תלמידים" button under "תעודת גמר".
  const [showStudentStatuses, setShowStudentStatuses] = useState(false);

  // Infer the certificate template type from the track's classification:
  //   הנדסאי סאונד  → "sound"
  //   הנדסאי קולנוע → "cinema"
  // Source of truth is `certifications.trackSettings[].trackType` (set in
  // StudentsPage). Falls back to keyword matching on the track name so a
  // track that hasn't been explicitly classified still gets a sensible
  // default.
  const inferredTemplateType = (() => {
    const trk = String(track || "").trim();
    if (!trk) return "";
    const settings = Array.isArray(certifications?.trackSettings) ? certifications.trackSettings : [];
    const match = settings.find((s) => String(s?.name || "").trim() === trk);
    if (match?.trackType === "sound" || match?.trackType === "cinema") return match.trackType;
    if (/סאונד|sound/i.test(trk)) return "sound";
    if (/קולנוע|cinema|film/i.test(trk)) return "cinema";
    return "";
  })();

  // Default the certificate template type to match the track's classification.
  // Behavior:
  //   - On first mount: keep the saved templateType if any; remember the
  //     current inferred value as the baseline.
  //   - When the admin switches the track (e.g. הנדסאי סאונד א → הנדסאי
  //     קולנוע ב), the inferred value changes — update the template to
  //     match the new classification, since the user expects the default
  //     to follow the track.
  //   - The admin can still pick a different template AFTER the track
  //     change; it sticks until the track changes again (because we only
  //     re-sync when `inferredTemplateType` itself changes).
  const lastInferredRef = useRef(null);
  useEffect(() => {
    // For a NEW course the certificate type must default to "ללא תעודה"
    // (empty) and change only when the admin explicitly picks one — never
    // auto-inferred from the track. Only existing courses follow the track.
    if (!initial) return;
    // First call: just record the baseline; never overwrite a saved value.
    if (lastInferredRef.current === null) {
      lastInferredRef.current = inferredTemplateType;
      // If nothing saved and we have a clear inference, fill it.
      if (!certificateTemplateType && inferredTemplateType) {
        setCertificateTemplateType(inferredTemplateType);
      }
      return;
    }
    // Subsequent calls: track classification changed → re-sync.
    if (inferredTemplateType && inferredTemplateType !== lastInferredRef.current) {
      lastInferredRef.current = inferredTemplateType;
      setCertificateTemplateType(inferredTemplateType);
    }
  }, [inferredTemplateType]); // eslint-disable-line react-hooks/exhaustive-deps
  const normalizedTrackOptions = [...new Set((trackOptions || []).map(option => String(option || "").trim()).filter(Boolean))];
  const isMobile = typeof window !== "undefined" && window.innerWidth < 769;
  const selectedLecturerObj = lecturerId ? lecturers.find(l => l.id === lecturerId) : null;
  // With the unified chip-list UI you can only add lecturers via the dropdown
  // (no free-text input), so a "typed but not matched" state can't happen.
  const lecturerSelectionInvalid = false;

  useEffect(() => {
    if (!selectedLecturerObj) return;
    const primaryName = displayLecturerName(selectedLecturerObj);
    setCourseLecturers(prev => normalizeCourseLecturerList([
      { lecturerId: selectedLecturerObj.id, instructorName: primaryName },
      ...prev,
    ]));
    setSchedule(prev => prev.map(session => (
      session.lecturerId || session.instructorName
        ? session
        : { ...session, lecturerId: selectedLecturerObj.id, instructorName: primaryName }
    )));
  }, [lecturerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Manual schedule builder
  const [manStartDate, setManStartDate] = useState("");
  const [manStartTime, setManStartTime] = useState("10:00");
  const [manEndTime, setManEndTime]     = useState("13:00");
  const [manCount, setManCount]         = useState(1);

  // All resizable widths in one array. Layout:
  //   [5 structural cols (#, date, start, end, topic),
  //    lecturerColumnCount lecturer cols,
  //    courseStudios.length classroom cols]
  // The delete column at the end has a fixed width.
  const FIXED_STRUCT_COUNT = 5;
  const LECTURER_COL_WIDTH = 130;
  const CLASSROOM_COL_WIDTH = 110;
  const DELETE_COL_WIDTH = 28;
  const [colWidths, setColWidths] = useState([30, 130, 72, 72, 150, 130]);
  // Keep colWidths length in sync with (lecturerColumnCount + courseStudios) —
  // preserve existing widths on add/remove so the user's resizing isn't lost.
  // Lecturer columns sit between the structural columns and the classroom
  // columns: when lecturerColumnCount grows, append at index (FIXED + current
  // lecturer cols); when courseStudios grows, append at the end.
  const prevLecturerColCountRef = useRef(lecturerColumnCount);
  const prevCourseStudiosCountRef = useRef(courseStudios.length);
  useEffect(() => {
    setColWidths(prev => {
      const wantTotal = FIXED_STRUCT_COUNT + lecturerColumnCount + courseStudios.length;
      if (prev.length === wantTotal) return prev;
      const prevLec = prevLecturerColCountRef.current;
      const prevStudios = prevCourseStudiosCountRef.current;
      let next = [...prev];
      // Lecturer cols changed: splice inside [FIXED_STRUCT_COUNT, FIXED_STRUCT_COUNT + prevLec]
      if (lecturerColumnCount > prevLec) {
        const insertAt = FIXED_STRUCT_COUNT + prevLec;
        next.splice(insertAt, 0, ...Array(lecturerColumnCount - prevLec).fill(LECTURER_COL_WIDTH));
      } else if (lecturerColumnCount < prevLec) {
        next.splice(FIXED_STRUCT_COUNT + lecturerColumnCount, prevLec - lecturerColumnCount);
      }
      // Studio cols changed: append/trim at the end
      if (courseStudios.length > prevStudios) {
        next = [...next, ...Array(courseStudios.length - prevStudios).fill(CLASSROOM_COL_WIDTH)];
      } else if (courseStudios.length < prevStudios) {
        next = next.slice(0, FIXED_STRUCT_COUNT + lecturerColumnCount + courseStudios.length);
      }
      // Fallback safety — if mismatch persists, pad/truncate to target.
      if (next.length < wantTotal) next = [...next, ...Array(wantTotal - next.length).fill(CLASSROOM_COL_WIDTH)];
      if (next.length > wantTotal) next = next.slice(0, wantTotal);
      prevLecturerColCountRef.current = lecturerColumnCount;
      prevCourseStudiosCountRef.current = courseStudios.length;
      return next;
    });
  }, [lecturerColumnCount, courseStudios.length]);
  const resizingRef = useRef(null);
  const startColResize = (e, colIdx) => {
    e.preventDefault();
    resizingRef.current = { colIdx, startX: e.clientX, startWidth: colWidths[colIdx] };
    const onMove = (ev) => {
      if (!resizingRef.current) return;
      // Destructure BEFORE setColWidths — the ref may be nulled by onUp
      // before React processes the queued state-update callback
      const { colIdx: ci, startX, startWidth } = resizingRef.current;
      const delta = startX - ev.clientX; // RTL: left = widen
      const newW = Math.max(40, startWidth + delta);
      setColWidths(prev => prev.map((w,i) => i === ci ? newW : w));
    };
    const onUp = () => {
      resizingRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const gridTemplate = [
    ...colWidths.map(w => `${w}px`),
    `${DELETE_COL_WIDTH}px`,
  ].join(" ");
  // Last column index = (resizable count) — used to draw the right border between cells.
  const lastDataColIdx = colWidths.length - 1;

  const LESSON_TIMES = LESSON_TIME_OPTIONS;

  const courseStudioIds = () => courseStudios.map(cs => cs.studioId).filter(Boolean);

  const buildAndAppendSchedule = () => {
    if(!manStartDate) { setLocalMsg({type:"error",text:"יש לבחור תאריך"}); return; }
    const count = Math.max(1, Math.min(52, Number(manCount)||1));
    const sessions = [];
    let d = parseLocalDate(manStartDate);
    const defaultLecturerName = displayLecturerName(selectedLecturerObj) || "";
    const defaultStudioIds = courseStudioIds();
    const defaultLecturerIds = lecturerId
      ? [String(lecturerId), ...Array(Math.max(0, lecturerColumnCount - 1)).fill("")]
      : Array(Math.max(1, lecturerColumnCount)).fill("");
    for(let i=0;i<count;i++) {
      sessions.push({ date: formatLocalDateInput(d), startTime: manStartTime, endTime: manEndTime, topic: "", studioIds: [...defaultStudioIds], lecturerId: lecturerId || null, lecturerIds: [...defaultLecturerIds], instructorName: defaultLecturerName });
      d.setDate(d.getDate()+7);
    }
    setSchedule(prev => dedupeScheduleEntries([...prev, ...sessions]));
    setLocalMsg({type:"success",text:`נוספו ${sessions.length} שיעורים`});
  };

  const appendLessonFromExisting = () => {
    if(!schedule.length) return;
    const firstLesson = schedule[0];
    const lastLesson = schedule[schedule.length-1];
    const nextDateObj = parseLocalDate(lastLesson.date || today());
    nextDateObj.setDate(nextDateObj.getDate()+7);
    // Inherit lecturerIds layout from the first session so the new row keeps
    // the same column count, but reset to "" (the admin picks per-row).
    const baseLecturerIds = Array.isArray(firstLesson.lecturerIds) && firstLesson.lecturerIds.length
      ? firstLesson.lecturerIds.map(() => "")
      : Array(Math.max(1, lecturerColumnCount)).fill("");
    const primary = firstLesson.lecturerId || lecturerId || null;
    if (primary) baseLecturerIds[0] = String(primary);
    setSchedule(prev=>dedupeScheduleEntries([...prev, {
      date: formatLocalDateInput(nextDateObj),
      startTime: firstLesson.startTime||"09:00",
      endTime: firstLesson.endTime||"12:00",
      topic: "",
      studioIds: [...courseStudioIds()],
      lecturerId: primary,
      lecturerIds: baseLecturerIds,
      instructorName: firstLesson.instructorName || displayLecturerName(selectedLecturerObj) || "",
    }]));
  };

  const updateSessionField = (index, field, value) => {
    setSchedule(prev => {
      const updated = prev.map((session, sessionIndex) => (
        sessionIndex === index
          ? { ...session, [field]: (field === "topic" || field === "lecturerId" || field === "instructorName") ? value : value || (field === "date" ? "" : session[field]) }
          : session
      ));
      return field === "date" ? sortScheduleEntries(updated) : updated;
    });
  };

  // Position-based slot update: column `colIdx` of session `sessionIndex` is
  // set to `value` (or cleared if value === ""). Each column holds an
  // independent classroom — the user can freely pick a different one per row,
  // and the change shows up in the column they edited (not somewhere else).
  const updateSessionStudioSlot = (sessionIndex, colIdx, value) => {
    setSchedule(prev => prev.map((session, idx) => {
      if (idx !== sessionIndex) return session;
      const current = Array.isArray(session.studioIds) ? [...session.studioIds].map(v => String(v || "")) : [];
      while (current.length <= colIdx) current.push("");
      current[colIdx] = String(value || "");
      return { ...session, studioIds: current };
    }));
  };

  const addCourseStudio = () => {
    const selected = classroomStudios.find(st => String(st.id) === String(additionalStudioId));
    if (!selected) return;
    setCourseStudios(prev => normalizeCourseStudioList([...prev, { studioId: selected.id }]));
    const idStr = String(selected.id);
    // Append the new classroom as a new column (default value) on every session
    // that doesn't already include it. Padding with "" keeps column positions
    // aligned for sessions that had blanks.
    setSchedule(prev => prev.map(session => {
      const current = Array.isArray(session.studioIds) ? session.studioIds.map(v => String(v || "")) : [];
      if (current.includes(idStr)) return { ...session, studioIds: current };
      return { ...session, studioIds: [...current, idStr] };
    }));
    setAdditionalStudioId("");
  };

  const removeCourseStudio = (studioIdToRemove) => {
    const idStr = String(studioIdToRemove);
    setCourseStudios(prev => prev.filter(cs => String(cs.studioId) !== idStr));
    // Remove the studio by ID from each session (preserving any override the
    // user may have placed in another column). Then trim trailing empties so
    // the array doesn't grow unbounded across edits.
    setSchedule(prev => prev.map(session => {
      if (!Array.isArray(session.studioIds)) return session;
      const filtered = session.studioIds
        .map(v => String(v || ""))
        .filter(id => id !== idStr);
      // Strip trailing empty slots
      while (filtered.length > 0 && filtered[filtered.length - 1] === "") filtered.pop();
      return { ...session, studioIds: filtered };
    }));
  };

  // Position-based lecturer slot update: column `colIdx` of session
  // `sessionIndex` is set to `value` (or cleared if value === ""). Mirrors
  // updateSessionStudioSlot. session.lecturerId tracks lecturerIds[0] for
  // backward compatibility with all the downstream code that still reads the
  // scalar field (LecturerPortal, public displays, conflict checks).
  const updateSessionLecturerSlot = (sessionIndex, colIdx, value) => {
    const selected = courseLecturers.find((lecturer) => String(lecturer.lecturerId || "") === String(value));
    setSchedule(prev => prev.map((session, idx) => {
      if (idx !== sessionIndex) return session;
      const current = Array.isArray(session.lecturerIds) ? [...session.lecturerIds].map(v => String(v || "")) : [];
      while (current.length <= colIdx) current.push("");
      current[colIdx] = selected?.lecturerId ? String(selected.lecturerId) : "";
      const primary = current.find(id => id) || null;
      const primaryLecturer = primary
        ? courseLecturers.find((lecturer) => String(lecturer.lecturerId || "") === String(primary))
        : null;
      return {
        ...session,
        lecturerIds: current,
        lecturerId: primary,
        instructorName: primaryLecturer?.instructorName || "",
      };
    }));
  };
  // Append a new empty lecturer column to every session. Capped at
  // courseLecturers.length so the user can never create more columns than
  // there are lecturers to fill them with.
  const addLecturerColumn = () => {
    setLecturerColumnCount(c => Math.min(c + 1, Math.max(1, courseLecturers.length)));
    setSchedule(prev => prev.map(session => {
      const current = Array.isArray(session.lecturerIds) ? [...session.lecturerIds].map(v => String(v || "")) : [];
      return { ...session, lecturerIds: [...current, ""] };
    }));
  };
  // Drop the LAST lecturer column from every session. Floor at 1 — the
  // primary lecturer column always stays visible. If the column being
  // removed had assignments in any session, those selections are dropped
  // (the user added the column intentionally, so removal is also their
  // explicit choice; they can re-add and re-pick if it was a mistake).
  // Cancel button at the top of the form is the broader undo path.
  const removeLecturerColumn = () => {
    setLecturerColumnCount(c => Math.max(1, c - 1));
    setSchedule(prev => prev.map(session => {
      if (!Array.isArray(session.lecturerIds)) return session;
      // Drop the trailing slot. If only 1 slot is left, keep it so the
      // primary column has somewhere to live.
      const next = session.lecturerIds.length > 1
        ? session.lecturerIds.slice(0, -1)
        : [...session.lecturerIds];
      const primary = next.find(id => id) || null;
      const primaryLecturer = primary
        ? courseLecturers.find((lecturer) => String(lecturer.lecturerId || "") === String(primary))
        : null;
      return {
        ...session,
        lecturerIds: next,
        lecturerId: primary,
        instructorName: primaryLecturer?.instructorName || (primary ? session.instructorName : ""),
      };
    }));
  };

  const addCourseLecturer = () => {
    const selected = lecturerOptions.find(l => String(l.id) === String(additionalLecturerId));
    if (!selected) return;
    setCourseLecturers(prev => normalizeCourseLecturerList([
      ...prev,
      { lecturerId: selected.id, instructorName: displayLecturerName(selected) },
    ]));
    // If no primary set yet (first lecturer added in this session), promote
    // the new one to the course default automatically.
    if (!lecturerId) setLecturerId(selected.id);
    setAdditionalLecturerId("");
  };

  const sendTeacherEmail = async () => {
    const recipient = String(selectedLecturerObj?.email||"").trim();
    if(!recipient) { setLocalMsg({type:"error",text:"למרצה שנבחר אין כתובת מייל"}); return; }
    const message = String(teacherMessage||"").trim();
    if(!message) { setLocalMsg({type:"error",text:"יש למלא נוסח הודעה"}); return; }
    setTeacherEmailSending(true);
    try {
      const lecName = selectedLecturerObj?.fullName || name.trim() || "מורה";
      const scheduleList = (schedule||[]).map((s,i)=>
        `<div style="margin-bottom:6px;color:#c7cedf">שיעור ${i+1}: ${formatDate(s.date)} ${s.startTime||""}${s.endTime?`–${s.endTime}`:""}${s.topic?` · ${s.topic}`:""}</div>`
      ).join("");
      const tokLk = await getAuthToken();
      await fetch("/api/send-email", {
        method:"POST",
        headers:{"Content-Type":"application/json", ...(tokLk ? { Authorization: `Bearer ${tokLk}` } : {})},
        body:JSON.stringify({
          to: recipient,
          type: "lesson_kit_ready",
          student_name: lecName,
          recipient_name: lecName,
          lesson_kit_name: name.trim(),
          custom_message: message,
          items_list: "",
          lesson_schedule: scheduleList,
        }),
      });
      setLocalMsg({type:"success",text:`המייל נשלח אל ${recipient}`});
    } catch(err) {
      console.error("email error",err);
      setLocalMsg({type:"error",text:"שגיאה בשליחת המייל"});
    } finally {
      setTeacherEmailSending(false);
    }
  };

  const studentsInTrack = (() => {
    const trk = track.trim();
    if (!trk) return [];
    // LessonForm is a top-level component — read students from the certifications
    // prop (passed in from parent) rather than the parent's `studentsFromTable`
    // closure variable, which is out of scope here.
    const all = Array.isArray(certifications?.students) ? certifications.students : [];
    return all.filter(s => String(s?.track || "").trim() === trk);
  })();

  // ── Lecturer status gate ────────────────────────────────────────────────
  // The lecturer must mark every track-student as either "passed" or "failed"
  // before the admin is allowed to generate certificates. studentStatuses is
  // a map { [studentId]: "passed" | "failed" } stored on the lesson itself
  // (set by the lecturer in /lecturer → "רשימת תלמידים").
  const studentStatusMap = (initial?.studentStatuses && typeof initial.studentStatuses === "object")
    ? initial.studentStatuses
    : {};
  const decidedStudents = studentsInTrack.filter(s => {
    const v = studentStatusMap[s.id];
    return v === "passed" || v === "failed";
  });
  const passedStudents = studentsInTrack.filter(s => studentStatusMap[s.id] === "passed");
  const allStudentsDecided = studentsInTrack.length > 0 && decidedStudents.length === studentsInTrack.length;

  const generateCertificates = async () => {
    const templateInfo = siteSettings?.certificateTemplates?.[certificateTemplateType];
    if (!certificateTemplateType || !templateInfo?.url) {
      setLocalMsg({type:"error",text:"יש לבחור סוג תבנית תעודה (קולנוע / סאונד) בהגדרות"});
      return;
    }
    if (studentsInTrack.length === 0) {
      setLocalMsg({type:"error",text:`אין סטודנטים במסלול "${track}". ודא שהמסלול נבחר ושרשומים בו סטודנטים.`});
      return;
    }
    if (!allStudentsDecided) {
      setLocalMsg({type:"error",text:"המרצה צריך לסמן סטטוס (סיים / לא סיים) לכל תלמיד לפני שניתן ליצור תעודות."});
      return;
    }
    if (passedStudents.length === 0) {
      setLocalMsg({type:"error",text:"אין תלמידים שסומנו כ\"סיים\". לא נוצרו תעודות."});
      return;
    }
    setCertGenerating(true);
    try {
      const [{ default: PizZip }, { default: Docxtemplater }, { default: JSZip }, { saveAs }] = await Promise.all([
        import("pizzip"),
        import("docxtemplater"),
        import("jszip"),
        import("file-saver"),
      ]);

      const templateRes = await fetch(templateInfo.url);
      if (!templateRes.ok) throw new Error("לא ניתן לטעון את קובץ התבנית");
      const templateBuffer = await templateRes.arrayBuffer();

      const outputZip = new JSZip();
      const courseName = name.trim();
      const trackName  = track.trim();
      const todayStr   = formatDate(new Date().toISOString());

      // Course end date = the latest schedule entry's date (schedule is already
      // sorted by dedupeScheduleEntries → utils.js). Falls back to today's date
      // for courses with no scheduled meetings.
      const validDates = (schedule || [])
        .map(s => s?.date)
        .filter(d => typeof d === "string" && d.length > 0);
      const lastMeetingISO = validDates[validDates.length - 1] || null;
      const endDateStr = lastMeetingISO ? formatDate(lastMeetingISO) : todayStr;

      // Lecturer name — empty string if none assigned (Hebrew renders nothing).
      const lecturerName = selectedLecturerObj?.fullName || "";

      // Total course hours.
      // Academic hour = 45 minutes (Israeli academic standard).
      // Sum every meeting's (endTime - startTime), then divide by 45 for
      // academic hours. Skip malformed/empty entries silently.
      const parseHM = (s) => {
        if (typeof s !== "string") return null;
        const m = s.match(/^(\d{1,2}):(\d{2})$/);
        if (!m) return null;
        return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      };
      const totalMinutes = (schedule || []).reduce((sum, s) => {
        const a = parseHM(s?.startTime);
        const b = parseHM(s?.endTime);
        if (a == null || b == null || b <= a) return sum;
        return sum + (b - a);
      }, 0);
      const totalHoursStr    = String(Math.round(totalMinutes / 60));
      const academicHoursStr = String(Math.round(totalMinutes / 45));

      const sanitize = s => String(s || "").replace(/[\\/:*?"<>|]/g, "_").trim() || "student";
      const used = new Set();

      // Only generate certificates for students explicitly marked "passed"
      // by the lecturer (not "אין סטטוס" and not "failed").
      for (const student of passedStudents) {
        const fullName = String(student?.name || `${student?.firstName || ""} ${student?.lastName || ""}`).trim() || "—";
        const zip = new PizZip(templateBuffer);
        const doc = new Docxtemplater(zip, {
          paragraphLoop: true,
          linebreaks: true,
          delimiters: { start: "{", end: "}" },
        });
        doc.render({
          name: fullName,
          firstName: student?.firstName || fullName.split(/\s+/)[0] || "",
          lastName:  student?.lastName  || fullName.split(/\s+/).slice(1).join(" ") || "",
          courseName,
          course: courseName,
          track: trackName,
          lecturer: lecturerName,
          date: endDateStr,
          endDate: endDateStr,
          issuedDate: todayStr,
          academicHours: academicHoursStr,
          hours: academicHoursStr,
          totalHours: totalHoursStr,
        });
        const out = doc.getZip().generate({ type: "uint8array" });
        let fname = `${sanitize(fullName)}.docx`;
        let idx = 2;
        while (used.has(fname)) fname = `${sanitize(fullName)} (${idx++}).docx`;
        used.add(fname);
        outputZip.file(fname, out);
      }

      const blob = await outputZip.generateAsync({ type: "blob" });
      const safeCourse = sanitize(courseName) || "course";
      saveAs(blob, `תעודות-${safeCourse}-${todayStr.replace(/\//g,"-")}.zip`);
      setLocalMsg({type:"success",text:`נוצרו ${passedStudents.length} תעודות (מתוך ${studentsInTrack.length} תלמידים במסלול). קובץ ה-ZIP ירד אוטומטית.`});
    } catch (err) {
      console.error("generate certs error", err);
      const msg = err?.properties?.errors?.[0]?.message || err.message || "שגיאה לא ידועה";
      setLocalMsg({type:"error",text:`שגיאה בייצור התעודות: ${msg}`});
    } finally {
      setCertGenerating(false);
    }
  };

  const handleSave = async () => {
    if(!name.trim()) { setLocalMsg({type:"error",text:"חובה למלא שם קורס"}); return; }
    if (!track.trim() || !normalizedTrackOptions.includes(track.trim())) {
      setLocalMsg({type:"error",text:"מסלול לימודים לא קיים"});
      return;
    }
    if (lecturerSelectionInvalid) {
      setLocalMsg({type:"error",text:'לא ניתן לשמור שם מרצה שאינו קיים. בחרו מרצה קיים מרובריקת "מרצים", או הוסיפו אותו קודם שם.'});
      return;
    }
    let finalSchedule = [...schedule];
    const fallbackStudioIds = courseStudioIds();
    if(manStartDate && finalSchedule.length===0) {
      const count = Math.max(1,Math.min(52,Number(manCount)||1));
      let d = parseLocalDate(manStartDate);
      const defaultLecturerName = displayLecturerName(selectedLecturerObj) || "";
      for(let i=0;i<count;i++) {
        finalSchedule.push({date:formatLocalDateInput(d),startTime:manStartTime,endTime:manEndTime,topic:"",studioIds: [...fallbackStudioIds], lecturerId: lecturerId || null, instructorName: defaultLecturerName});
        d.setDate(d.getDate()+7);
      }
    }
    const selectedLecturer = lecturerId ? lecturers.find(l => l.id === lecturerId) : null;
    const defaultLecturerName = displayLecturerName(selectedLecturer) || "";
    finalSchedule = dedupeScheduleEntries(finalSchedule.map(normalizeScheduleEntry).map(s => ({
      ...s,
      // Sessions without explicit studios inherit the course-level assignment.
      // Without this fallback, sessions added before the user picked course
      // studios (or via paths that didn't propagate them) saved with empty
      // studioIds, making the lesson "unassigned" on re-open.
      // Only fall back to course defaults if the session has no studios at all
      // (not even empty slots). A session that was explicitly cleared via the
      // dropdowns keeps its "" entries — position-aware.
      studioIds: (Array.isArray(s.studioIds) && s.studioIds.some(v => String(v || "").trim()))
        ? s.studioIds
        : (Array.isArray(s.studioIds) && s.studioIds.length ? s.studioIds : [...fallbackStudioIds]),
      lecturerId: s.lecturerId || lecturerId || null,
      instructorName: String(s.instructorName || defaultLecturerName || "").trim(),
    })));
    const dupClassroom = finalSchedule.find(session => {
      const ids = (Array.isArray(session.studioIds) ? session.studioIds : [])
        .map(v => String(v || ""))
        .filter(Boolean);
      return ids.length !== new Set(ids).size;
    });
    if (dupClassroom) { setLocalMsg({type:"error",text:"לא ניתן לשייך את אותה הכיתה פעמיים לאותו שיעור"}); return; }
    const invalidSession = finalSchedule.find(session => !session.date || session.startTime >= session.endTime);
    if(invalidSession) { setLocalMsg({type:"error",text:"יש לתקן תאריך או שעות לא תקינים בלוח השיעורים"}); return; }
    setSaving(true);
    const savedCourseLecturers = normalizeCourseLecturerList([
      { lecturerId: lecturerId || null, instructorName: defaultLecturerName },
      ...courseLecturers,
      ...finalSchedule.map(s => ({ lecturerId: s.lecturerId, instructorName: s.instructorName })),
    ]);
    const savedCourseStudios = normalizeCourseStudioList([
      ...courseStudios,
      ...finalSchedule.flatMap(s => (s.studioIds || []).map(id => ({ studioId: id }))),
    ]);
    const lesson = {
      id: initial?.id||`lesson_${Date.now()}`,
      name: name.trim(),
      track: track.trim(),
      lecturerId: lecturerId || null,
      instructorName: displayLecturerName(selectedLecturer) || "",
      instructorPhone: selectedLecturer?.phone || "",
      instructorEmail: selectedLecturer?.email || "",
      lecturers: savedCourseLecturers,
      description: description.trim(),
      // studioId persists as the primary fallback for the DB `studio_id` column.
      studioId: savedCourseStudios[0]?.studioId || null,
      studios: savedCourseStudios,
      schedule: finalSchedule,
      certificateTemplateType: certificateTemplateType || "",
      // Preserve lecturer-managed fields so an admin save doesn't wipe them.
      studentStatuses: (initial?.studentStatuses && typeof initial.studentStatuses === "object") ? initial.studentStatuses : {},
      lecturerNotifiedAt7d: initial?.lecturerNotifiedAt7d || null,
      created_at: initial?.created_at||new Date().toISOString(),
    };
    await onSave(lesson);
    setSaving(false);
  };

  // Today (local YYYY-MM-DD) — used to visually distinguish past vs future
  // sessions in the schedule table.
  const todayStr = today();
  return (
    <div className="card" style={{marginBottom:20}}>
      <div className="card-header">
        <div className="card-title" style={{display:"flex",alignItems:"center",gap:6}}><Video size={15} strokeWidth={1.75}/> {initial ? (name.trim() ? `עריכת קורס · ${name.trim()}` : "עריכת קורס") : (name.trim() ? `קורס חדש · ${name.trim()}` : "קורס חדש")}</div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <button className="btn btn-primary btn-sm" style={{background:"#9b59b6",borderColor:"#9b59b6"}} onClick={handleSave} disabled={saving}>
            {saving?<><Clock size={16} strokeWidth={1.75} /> שומר...</>:`💾 ${initial?"עדכן":"צור"} קורס`}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onCancel}><X size={16} strokeWidth={1.75} color="var(--text3)" /> ביטול</button>
        </div>
      </div>

      {localMsg && (
        <div style={{padding:"10px 16px",marginBottom:12,borderRadius:"var(--r-sm)",fontSize:13,fontWeight:700,
          background:localMsg.type==="error"?"rgba(231,76,60,0.12)":"rgba(46,204,113,0.12)",
          border:`1px solid ${localMsg.type==="error"?"rgba(231,76,60,0.3)":"rgba(46,204,113,0.3)"}`,
          color:localMsg.type==="error"?"#e74c3c":"#2ecc71",
          display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>{localMsg.type==="error"?<XCircle size={16} strokeWidth={1.75} />:<CheckCircle size={16} strokeWidth={1.75} />} {localMsg.text}</span>
          <button onClick={()=>setLocalMsg(null)} style={{background:"none",border:"none",color:"inherit",cursor:"pointer",fontSize:16,padding:"0 4px"}}>×</button>
        </div>
      )}

      {/* Two-column layout: right column (RTL start) = course details + classrooms
          + email; left column (RTL end) = schedule + certificate. Collapses to a
          single column on mobile. */}
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"minmax(0, 0.9fr) minmax(0, 1.5fr)",gap:16,alignItems:"start"}}>
      {/* ── Right column (RTL start) ── */}
      <div style={{minWidth:0}}>

      {/* Course & Instructor details */}
      <div style={{background:"rgba(155,89,182,0.06)",border:"1px solid rgba(155,89,182,0.2)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16}}>
        <div style={{fontWeight:800,fontSize:13,color:"#9b59b6",marginBottom:12}}>פרטי הקורס והמרצה</div>
        <div className="form-group" style={{marginBottom:10}}>
          <label className="form-label">שם הקורס *</label>
          <input className="form-input" placeholder='לדוגמה: "חדר טלוויזיה א"' value={name} onChange={e=>setName(e.target.value)}/>
        </div>
        <div className="form-group" style={{marginBottom:10}}>
          <label className="form-label">מרצי הקורס</label>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <select className="form-select" value={additionalLecturerId} onChange={e=>setAdditionalLecturerId(e.target.value)} style={{flex:"1 1 220px"}}>
              <option value="">בחר מרצה להוספה</option>
              {lecturerOptions
                .filter(l => !courseLecturers.some(cl => String(cl.lecturerId || "") === String(l.id)))
                .sort((a,b)=>displayLecturerName(a).localeCompare(displayLecturerName(b),"he"))
                .map(l => <option key={l.id} value={l.id}>{displayLecturerName(l)}</option>)}
            </select>
            <button type="button" className="btn btn-primary btn-sm" onClick={addCourseLecturer} disabled={!additionalLecturerId} style={{whiteSpace:"nowrap",background:"#9b59b6",borderColor:"#9b59b6"}}>
              <Plus size={14} strokeWidth={1.75}/> הוסף מרצה
            </button>
          </div>
          {courseLecturers.length > 0 && (
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
              {courseLecturers.map((lecturer) => {
                const isPrimary = String(lecturer.lecturerId || "") === String(lecturerId || "");
                const promote = () => {
                  if (isPrimary) return;
                  setLecturerId(lecturer.lecturerId || "");
                };
                const remove = (e) => {
                  e.stopPropagation();
                  const removedKey = String(lecturer.lecturerId || lecturer.instructorName);
                  setCourseLecturers(prev => {
                    const next = prev.filter(item => String(item.lecturerId || item.instructorName) !== removedKey);
                    // If we removed the primary, promote the next remaining lecturer.
                    if (isPrimary) {
                      const nextPrimary = next[0]?.lecturerId || "";
                      setLecturerId(nextPrimary);
                    }
                    return next;
                  });
                  setSchedule(prev => prev.map(session => String(session.lecturerId || session.instructorName) === removedKey ? {
                    ...session,
                    lecturerId: null,
                    instructorName: "",
                  } : session));
                };
                return (
                  <span
                    key={lecturer.lecturerId || lecturer.instructorName}
                    onClick={promote}
                    title={isPrimary ? "מרצה ברירת המחדל" : "לחץ כדי לסמן כברירת מחדל"}
                    style={{
                      display:"inline-flex",alignItems:"center",gap:5,
                      border:"1px solid rgba(155,89,182,0.35)",
                      background:isPrimary?"rgba(155,89,182,0.18)":"var(--surface2)",
                      borderRadius:999,padding:"4px 10px",fontSize:12,fontWeight:800,
                      color:isPrimary?"#c084fc":"var(--text2)",
                      cursor:isPrimary?"default":"pointer",
                      userSelect:"none",
                    }}
                  >
                    <User size={12} strokeWidth={1.75}/> {lecturer.instructorName}{isPrimary ? " · ברירת מחדל" : ""}
                    <button type="button" aria-label="הסר מרצה מהקורס" onClick={remove}
                      style={{background:"transparent",border:"none",color:"var(--text3)",cursor:"pointer",padding:0,display:"inline-flex"}}>
                      <X size={12} strokeWidth={2}/>
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>
            לחיצה על מרצה הופכת אותו לברירת מחדל לקורס. ה-X מסיר מרצה. ניתן להוסיף רק מרצים שכבר קיימים ברובריקת "מרצים".
          </div>
          {!lecturers.length && <div style={{fontSize:11,color:"var(--text3)",marginTop:3}}>ניתן להוסיף מרצים דרך רובריקת "מרצים"</div>}
        </div>
        <div className="form-group" style={{marginBottom:10}}>
          <label className="form-label">מסלול לימודים</label>
          <select className="form-select" value={normalizedTrackOptions.includes(track) ? track : ""} onChange={e=>setTrack(e.target.value)}>
            <option value="">בחר מסלול לימודים קיים</option>
            {normalizedTrackOptions.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">הערות</label>
          <textarea className="form-textarea" rows={2} placeholder="הערות על הקורס..." value={description} onChange={e=>setDescription(e.target.value)}/>
        </div>
      </div>

      {/* Link to classrooms (optional) */}
      <div style={{background:"rgba(52,152,219,0.06)",border:"1px solid rgba(52,152,219,0.2)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16}}>
        <div style={{fontWeight:800,fontSize:13,color:"#3498db",marginBottom:10,display:"flex",alignItems:"center",gap:6}}><Link size={13} strokeWidth={1.75}/> שיוך כיתות לימוד</div>
        <div className="form-group" style={{marginBottom:0}}>
          <label className="form-label">כיתות הקורס</label>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <select className="form-select" value={additionalStudioId} onChange={e=>setAdditionalStudioId(e.target.value)} style={{flex:"1 1 220px"}}>
              <option value="">בחר כיתה להוספה</option>
              {classroomStudios
                .filter(st => !courseStudios.some(cs => String(cs.studioId) === String(st.id)))
                .sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"he"))
                .map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
            <button type="button" className="btn btn-primary btn-sm" onClick={addCourseStudio} disabled={!additionalStudioId} style={{whiteSpace:"nowrap",background:"#9b59b6",borderColor:"#9b59b6"}}>
              <Plus size={14} strokeWidth={1.75}/> הוסף כיתה
            </button>
          </div>
          {courseStudios.length > 0 && (
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
              {courseStudios.map((cs) => {
                const name = studioDisplayName(cs.studioId) || cs.studioId;
                return (
                  <span key={cs.studioId} style={{display:"inline-flex",alignItems:"center",gap:5,border:"1px solid rgba(52,152,219,0.35)",background:"var(--surface2)",borderRadius:999,padding:"4px 10px",fontSize:12,fontWeight:800,color:"var(--text2)"}}>
                    <Link size={12} strokeWidth={1.75}/> {name}
                    <button type="button" aria-label="הסר כיתה מהקורס" onClick={()=>removeCourseStudio(cs.studioId)}
                      style={{background:"transparent",border:"none",color:"var(--text3)",cursor:"pointer",padding:0,display:"inline-flex"}}>
                      <X size={12} strokeWidth={2}/>
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>
            ניתן להוסיף כמה כיתות שצריך. כל כיתה תופיע כעמודה נפרדת ב"לוח שיעורים" וכל מפגש יכול לבחור איזו כיתה בפועל הוא משריין.
          </div>
        </div>
        {classroomStudios.length === 0 && (
          <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}><Lightbulb size={16} strokeWidth={1.75} /> סמן חדר כ"כיתת לימוד" ברובריקת חדרים כדי שיופיע כאן.</div>
        )}
      </div>

      {/* Email to teacher */}
      {selectedLecturerObj?.email && (
        <div style={{background:"rgba(52,152,219,0.06)",border:"1px solid rgba(52,152,219,0.2)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16}}>
          <div style={{fontWeight:800,fontSize:13,color:"#3498db",marginBottom:10,display:"flex",alignItems:"center",gap:6}}><Mail size={13} strokeWidth={1.75}/> שליחת מייל למרצה</div>
          <textarea className="form-textarea" rows={3} placeholder="נוסח ההודעה למרצה..." value={teacherMessage} onChange={e=>setTeacherMessage(e.target.value)}/>
          <button className="btn btn-secondary" style={{marginTop:8,display:"inline-flex",alignItems:"center",gap:6}} onClick={sendTeacherEmail} disabled={teacherEmailSending}>
            {teacherEmailSending?<><Clock size={16} strokeWidth={1.75} /> שולח...</>:<><Mail size={14} strokeWidth={1.75}/> שלח מייל למרצה</>}
          </button>
        </div>
      )}

      {/* Certificate template — global type selection */}
      <div style={{background:"rgba(245,166,35,0.07)",border:"1px solid rgba(245,166,35,0.25)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16}}>
        <div style={{fontWeight:800,fontSize:13,color:"#f5a623",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
          <Award size={14} strokeWidth={1.75}/> תעודת גמר
        </div>
        <div style={{fontSize:12,color:"var(--text3)",marginBottom:10,lineHeight:1.5}}>
          בחר את סוג תבנית התעודה לקורס זה. הטמפלטים מוגדרים ברובריקת <b>הגדרות → תבניות תעודות</b>.
        </div>

        {/* Type selector — pill buttons with lucide outline icons (matches
            the rest of the admin UI). Default value is inferred from the
            track classification (see useEffect above), but the admin can
            still flip between options. */}
        <div className="form-group" style={{marginBottom:10}}>
          <label className="form-label">סוג תבנית תעודה</label>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {[
              { value: "", icon: <X size={14} strokeWidth={1.75} color="var(--accent)"/>, label: "ללא תעודה", disabled: false, missing: false },
              { value: "cinema", icon: <Film size={14} strokeWidth={1.75} color="var(--accent)"/>, label: "קולנוע", disabled: !siteSettings?.certificateTemplates?.cinema?.url, missing: !siteSettings?.certificateTemplates?.cinema?.url },
              { value: "sound", icon: <Mic size={14} strokeWidth={1.75} color="var(--accent)"/>, label: "סאונד", disabled: !siteSettings?.certificateTemplates?.sound?.url, missing: !siteSettings?.certificateTemplates?.sound?.url },
            ].map((opt) => {
              const active = certificateTemplateType === opt.value;
              return (
                <button
                  key={opt.value || "none"}
                  type="button"
                  onClick={() => !opt.disabled && setCertificateTemplateType(opt.value)}
                  disabled={opt.disabled}
                  title={opt.missing ? "לא הועלתה תבנית — ניתן להעלות בהגדרות → תבניות תעודות" : ""}
                  style={{
                    display:"inline-flex",
                    alignItems:"center",
                    gap:6,
                    padding:"8px 14px",
                    borderRadius:10,
                    border:`2px solid ${active ? "var(--accent)" : "var(--border)"}`,
                    background: active ? "rgba(245,166,35,0.12)" : "var(--surface2)",
                    color: active ? "var(--accent)" : (opt.disabled ? "var(--text3)" : "var(--text2)"),
                    fontWeight: active ? 800 : 700,
                    fontSize: 13,
                    cursor: opt.disabled ? "not-allowed" : "pointer",
                    opacity: opt.disabled ? 0.55 : 1,
                    transition:"all 0.15s",
                  }}
                >
                  {opt.icon} {opt.label}{opt.missing ? " (חסרה תבנית)" : ""}
                </button>
              );
            })}
          </div>
        </div>

        {/* Generate button — shown when a valid type is selected.
            Disabled until the lecturer marks every track-student as
            "סיים" or "לא סיים" via the lecturer portal. */}
        {certificateTemplateType && siteSettings?.certificateTemplates?.[certificateTemplateType]?.url && (
          <div style={{marginTop:4}}>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:8}}>
              {track.trim()
                ? <>סטודנטים במסלול <b>{track}</b>: <b style={{color:"var(--text)"}}>{studentsInTrack.length}</b>
                    {studentsInTrack.length > 0 && <> · סומנו על-ידי המרצה: <b style={{color:"var(--text)"}}>{decidedStudents.length}</b>/{studentsInTrack.length} (מתוכם <b style={{color:"#2ecc71"}}>{passedStudents.length}</b> סיימו)</>}
                  </>
                : <>יש לבחור מסלול לימודים לפני ייצור תעודות.</>
              }
            </div>
            {track.trim() && studentsInTrack.length > 0 && !allStudentsDecided && (
              <div style={{fontSize:12,color:"#f5a623",marginBottom:8,padding:"8px 10px",background:"rgba(245,166,35,0.08)",border:"1px solid rgba(245,166,35,0.3)",borderRadius:8,lineHeight:1.5}}>
                המרצה צריך לסמן סטטוס (סיים / לא סיים) לכל תלמיד לפני שניתן ליצור תעודות.
                תזכורת אוטומטית תישלח למרצה 7 ימים לפני סיום הקורס.
              </div>
            )}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
              <button
                type="button"
                className="btn btn-primary"
                style={{background:"#f5a623",borderColor:"#f5a623",color:"#0a0c10",display:"inline-flex",alignItems:"center",gap:6}}
                onClick={generateCertificates}
                disabled={certGenerating || !track.trim() || studentsInTrack.length === 0 || !allStudentsDecided || passedStudents.length === 0}
                title={!allStudentsDecided ? "המרצה עדיין לא סימן את כל התלמידים" : passedStudents.length === 0 ? "אין תלמידים שסומנו כ\"סיים\"" : ""}
              >
                {certGenerating ? <><Clock size={16} strokeWidth={1.75}/> מייצר...</> : <><Download size={14} strokeWidth={1.75}/> ייצר תעודות ({passedStudents.length})</>}
              </button>
              {/* Read-only roster — opens the floating panel rendered below.
                  Always available once a track is selected so the secretariat
                  can verify exactly who the lecturer marked, regardless of
                  whether the gate is open. */}
              {track.trim() && studentsInTrack.length > 0 && (
                <button
                  type="button"
                  className="btn"
                  onClick={()=>setShowStudentStatuses(true)}
                  style={{background:"rgba(155,89,182,0.1)",border:"2px solid rgba(155,89,182,0.4)",color:"#9b59b6",fontWeight:800,fontSize:13,padding:"8px 14px",borderRadius:10,display:"inline-flex",alignItems:"center",gap:6,cursor:"pointer"}}
                  title="הצג פאנל צף עם רשימת התלמידים והסטטוס שסומן על-ידי המרצה"
                >
                  <GraduationCap size={14} strokeWidth={1.75}/> צפה ברשימת תלמידים
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      </div>{/* ── close right column ── */}
      {/* ── Left column (RTL end): schedule only ── */}
      <div style={{minWidth:0}}>

      {/* Schedule builder — FIRST */}
      <div style={{background:"rgba(155,89,182,0.06)",border:"1px solid rgba(155,89,182,0.2)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16}}>
        <div style={{fontWeight:800,fontSize:13,color:"#9b59b6",marginBottom:12}}><Calendar size={16} strokeWidth={1.75} /> לוח שיעורים</div>
        <div style={{fontSize:12,color:"var(--text3)",marginBottom:10}}>הוספת מפגשים ידנית נשארת כאן. ייבוא XL עבר לראש דף "שיעורים" כדי לאפשר העלאה מהירה של כמה קורסים במקביל.</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end",marginBottom:12}}>
          <div className="form-group" style={{flex:"1 1 130px",minWidth:120}}>
            <label className="form-label">תאריך התחלה</label>
            <LessonDateInput value={manStartDate} onChange={setManStartDate}/>
          </div>
          <div className="form-group" style={{flex:"0 0 90px"}}>
            <label className="form-label">שעת התחלה</label>
            <select className="form-select" value={manStartTime} onChange={e=>setManStartTime(e.target.value)}>
              {LESSON_TIMES.map(t=><option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group" style={{flex:"0 0 90px"}}>
            <label className="form-label">שעת סיום</label>
            <select className="form-select" value={manEndTime} onChange={e=>setManEndTime(e.target.value)}>
              {LESSON_TIMES.map(t=><option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group" style={{flex:"0 0 80px"}}>
            <label className="form-label">מס׳ שבועות</label>
            <input className="form-input" type="number" min={1} max={52} value={manCount} onChange={e=>setManCount(e.target.value)}/>
          </div>
          <div className="form-group" style={{flex:"0 0 auto",marginBottom:0}}>
            <label className="form-label" aria-hidden="true">&nbsp;</label>
            <button className="btn btn-primary" style={{background:"#9b59b6",borderColor:"#9b59b6",whiteSpace:"nowrap",height:44,minWidth:88,display:"inline-flex",alignItems:"center",justifyContent:"center"}} onClick={buildAndAppendSchedule}>➕ הוסף</button>
          </div>
        </div>

        {schedule.length>0 && (
          <div style={{marginBottom:16}}>
            <div style={{fontWeight:700,fontSize:12,color:"#9b59b6",marginBottom:4}}><Calendar size={16} strokeWidth={1.75} /> {schedule.length} שיעורים בלוח:</div>

            {isMobile ? (
              /* ── מובייל: כרטיס לכל מפגש (גובה אדפטיבי — ללא גלילה פנימית) ── */
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {schedule.map((s,i)=>{
                  const isPast = !!(s.date && s.date < todayStr);
                  return (
                  <div key={s._key || `${s.date}-${s.startTime}-${i}`} style={{background:isPast?"rgba(128,128,128,0.10)":"var(--surface2)",border:"1px solid "+(isPast?"rgba(128,128,128,0.22)":"rgba(155,89,182,0.2)"),borderRadius:10,padding:"10px 12px",opacity:isPast?0.6:1}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <span style={{fontWeight:800,color:"#9b59b6",fontSize:12}}>#{i+1}</span>
                      <button onClick={()=>setSchedule(prev=>prev.filter((_,j)=>j!==i))}
                        style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:20,padding:0,lineHeight:1}}>×</button>
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:6}}>
                      <div style={{flex:"1 1 130px"}}>
                        <div style={{fontSize:11,color:"var(--text3)",marginBottom:2}}>תאריך</div>
                        <LessonDateInput value={s.date} style={{fontSize:13,padding:"4px 6px",height:32,width:"100%",boxSizing:"border-box"}} onChange={value=>updateSessionField(i,"date",value)}/>
                      </div>
                      <div style={{flex:"0 0 84px"}}>
                        <div style={{fontSize:11,color:"var(--text3)",marginBottom:2}}>התחלה</div>
                        <select className="form-select" value={s.startTime} style={{fontSize:13,padding:"4px 6px",height:32,width:"100%",boxSizing:"border-box"}} onChange={e=>updateSessionField(i,"startTime",e.target.value)}>
                          {LESSON_TIMES.map(t=><option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div style={{flex:"0 0 84px"}}>
                        <div style={{fontSize:11,color:"var(--text3)",marginBottom:2}}>סיום</div>
                        <select className="form-select" value={s.endTime} style={{fontSize:13,padding:"4px 6px",height:32,width:"100%",boxSizing:"border-box"}} onChange={e=>updateSessionField(i,"endTime",e.target.value)}>
                          {LESSON_TIMES.map(t=><option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={{marginBottom:6}}>
                      <div style={{fontSize:11,color:"var(--text3)",marginBottom:2}}>נושא</div>
                      <input className="form-input" placeholder="אופציונלי" value={s.topic||""} style={{fontSize:13,padding:"4px 6px",height:32,width:"100%",boxSizing:"border-box"}} onChange={e=>updateSessionField(i,"topic",e.target.value)}/>
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:6}}>
                      {Array.from({ length: lecturerColumnCount }, (_, colIdx) => {
                        const sessionLecturerIds = Array.isArray(s.lecturerIds) ? s.lecturerIds.map(v => String(v || "")) : [];
                        const currentValue = sessionLecturerIds[colIdx] || "";
                        const optionLecturers = [...courseLecturers].sort((a,b)=>a.instructorName.localeCompare(b.instructorName,"he"));
                        const orphan = currentValue && !optionLecturers.some(l => String(l.lecturerId || "") === currentValue)
                          ? lecturers.find(l => String(l.id) === currentValue)
                          : null;
                        const usedByOtherColumns = new Set(sessionLecturerIds.filter((id, j) => j !== colIdx && id));
                        return (
                          <div key={`lec-${colIdx}`} style={{flex:1, minWidth:130}}>
                            <div style={{fontSize:11,color:"var(--text3)",marginBottom:2}}>{lecturerColumnCount === 1 ? "שם מרצה" : `מרצה ${colIdx+1}`}</div>
                            <select className="form-select" value={currentValue} style={{fontSize:12,padding:"4px 6px",height:32,width:"100%",boxSizing:"border-box"}} onChange={e=>updateSessionLecturerSlot(i, colIdx, e.target.value)}>
                              <option value="">ללא שיוך</option>
                              {optionLecturers.map(l => (
                                <option key={l.lecturerId || l.instructorName} value={l.lecturerId || ""} disabled={!!l.lecturerId && usedByOtherColumns.has(String(l.lecturerId))}>
                                  {l.instructorName}
                                </option>
                              ))}
                              {orphan && (
                                <option key={orphan.id} value={orphan.id}>{displayLecturerName(orphan)}</option>
                              )}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                    {courseStudios.length === 0 ? (
                      <div style={{fontSize:11,color:"var(--text3)",fontStyle:"italic"}}>הוסף כיתה מהפאנל "שיוך כיתות לימוד" כדי לבחור כיתה למפגש</div>
                    ) : (
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {courseStudios.map((cs, colIdx) => {
                          const sessionIds = Array.isArray(s.studioIds) ? s.studioIds.map(v => String(v || "")) : [];
                          const currentValue = sessionIds[colIdx] || "";
                          // Per-session classrooms: show ALL classrooms in the system.
                          // Picking one is a session-level override and does NOT add a
                          // column to the schedule. To add a column the admin uses the
                          // global "שיוך כיתות לימוד" panel.
                          const optionStudios = [...classroomStudios].sort((a, b) =>
                            String(a.name || "").localeCompare(String(b.name || ""), "he")
                          );
                          const orphan = currentValue && !optionStudios.some(st => String(st.id) === currentValue)
                            ? studios.find(st => String(st.id) === currentValue)
                            : null;
                          const usedByOtherColumns = new Set(sessionIds.filter((id, j) => j !== colIdx && id));
                          return (
                            <div key={`col-${colIdx}-${cs.studioId}`} style={{flex:1, minWidth:130}}>
                              <div style={{fontSize:11,color:"var(--text3)",marginBottom:2}}>🏫 כיתה {colIdx+1}</div>
                              <select className="form-select" value={currentValue} style={{fontSize:12,padding:"4px 6px",height:32,width:"100%",boxSizing:"border-box"}} onChange={e=>updateSessionStudioSlot(i, colIdx, e.target.value)}>
                                <option value="">ללא</option>
                                {optionStudios.map(st => (
                                  <option key={st.id} value={st.id} disabled={usedByOtherColumns.has(String(st.id))}>
                                    {st.name}
                                  </option>
                                ))}
                                {orphan && (
                                  <option key={orphan.id} value={orphan.id}>{orphan.name}</option>
                                )}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            ) : (
              /* ── דסקטופ: grid עם עמודות גמישות (גלילה אופקית כשהטור צר — בלי
                 גובה קבוע כדי לא להחזיר סרגל אנכי, ראה לקח #30) ── */
              <div style={{overflowX:"auto"}}>
                <div style={{display:"grid",gridTemplateColumns:gridTemplate,gap:0,fontSize:11,color:"var(--text-muted)",marginBottom:2,userSelect:"none",background:"var(--surface2)",borderRadius:"6px 6px 0 0",border:"1px solid rgba(155,89,182,0.2)"}}>
                  {[
                    { label: "", resizable: false, centered: true },
                    { label: "תאריך", resizable: true },
                    { label: "התחלה", resizable: true },
                    { label: "סיום", resizable: true },
                    { label: "נושא", resizable: true },
                    ...Array.from({ length: lecturerColumnCount }, (_, idx) => ({
                      label: lecturerColumnCount === 1 ? "שם מרצה" : `מרצה ${idx+1}`,
                      resizable: true,
                    })),
                    ...courseStudios.map((cs, idx) => ({ label: `כיתה ${idx+1}`, resizable: true })),
                    { label: "", resizable: false, centered: true },
                  ].map((col, ci, arr) => (
                    <div key={ci} style={{position:"relative",padding:"4px 8px",overflow:"hidden",whiteSpace:"nowrap",
                      borderRight: ci < arr.length - 1 ? "1px solid rgba(155,89,182,0.25)" : "none",
                      fontWeight:700, textAlign: col.centered ? "center" : "right"}}>
                      {col.label}
                      {col.resizable && (
                        <div onMouseDown={e=>{ e.preventDefault(); startColResize(e,ci); }}
                          style={{position:"absolute",left:0,top:0,width:8,height:"100%",cursor:"col-resize",zIndex:2}}/>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:2}}>
                  {schedule.map((s,i)=>{
                    const sessionIds = Array.isArray(s.studioIds) ? s.studioIds.map(String) : [];
                    const sessionLecturerIds = Array.isArray(s.lecturerIds) ? s.lecturerIds.map(String) : [];
                    const isPast = !!(s.date && s.date < todayStr);
                    return (
                    <div key={s._key || `${s.date}-${s.startTime}-${i}`} style={{display:"grid",gridTemplateColumns:gridTemplate,alignItems:"center",gap:0,fontSize:12,background:isPast?"rgba(128,128,128,0.10)":"var(--surface2)",border:"1px solid "+(isPast?"rgba(128,128,128,0.18)":"rgba(155,89,182,0.12)"),borderTop:"none",opacity:isPast?0.6:1}}>
                      <div style={{fontWeight:800,color:isPast?"var(--text3)":"#9b59b6",fontSize:11,textAlign:"center",padding:"4px 2px",borderRight:"1px solid rgba(155,89,182,0.15)"}} title={isPast?"מפגש שחלף":"מפגש עתידי"}>#{i+1}</div>
                      <LessonDateInput value={s.date} style={{padding:"3px 6px",fontSize:12,height:28,width:"100%",boxSizing:"border-box"}} onChange={value=>updateSessionField(i,"date",value)}/>
                      <select className="form-select" value={s.startTime} style={{padding:"3px 4px",fontSize:12,height:28,width:"100%",boxSizing:"border-box"}} onChange={e=>updateSessionField(i,"startTime",e.target.value)}>
                        {LESSON_TIMES.map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                      <select className="form-select" value={s.endTime} style={{padding:"3px 4px",fontSize:12,height:28,width:"100%",boxSizing:"border-box"}} onChange={e=>updateSessionField(i,"endTime",e.target.value)}>
                        {LESSON_TIMES.map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                      <input className="form-input" placeholder="אופציונלי" value={s.topic||""} style={{padding:"3px 6px",fontSize:12,height:28,width:"100%",boxSizing:"border-box"}} onChange={e=>updateSessionField(i,"topic",e.target.value)}/>
                      {Array.from({ length: lecturerColumnCount }, (_, colIdx) => {
                        const currentValue = sessionLecturerIds[colIdx] || "";
                        const optionLecturers = [...courseLecturers].sort((a,b)=>a.instructorName.localeCompare(b.instructorName,"he"));
                        const orphan = currentValue && !optionLecturers.some(l => String(l.lecturerId || "") === currentValue)
                          ? lecturers.find(l => String(l.id) === currentValue)
                          : null;
                        const usedByOtherColumns = new Set(sessionLecturerIds.filter((id, j) => j !== colIdx && id));
                        return (
                          <select key={`lec-${colIdx}`} className="form-select" value={currentValue} style={{padding:"3px 4px",fontSize:11,height:28,width:"100%",boxSizing:"border-box"}} title={lecturerColumnCount === 1 ? "שם המרצה למפגש זה" : `מרצה ${colIdx+1} למפגש זה`} onChange={e=>updateSessionLecturerSlot(i, colIdx, e.target.value)}>
                            <option value="">ללא שיוך</option>
                            {optionLecturers.map(l => (
                              <option key={l.lecturerId || l.instructorName} value={l.lecturerId || ""} disabled={!!l.lecturerId && usedByOtherColumns.has(String(l.lecturerId))}>
                                {l.instructorName}
                              </option>
                            ))}
                            {orphan && (
                              <option key={orphan.id} value={orphan.id}>{displayLecturerName(orphan)}</option>
                            )}
                          </select>
                        );
                      })}
                      {courseStudios.map((cs, colIdx) => {
                        const currentValue = sessionIds[colIdx] || "";
                        // Per-session classrooms: show ALL classrooms. Selecting one
                        // is a session-level override; it does NOT add a column.
                        const optionStudios = [...classroomStudios].sort((a, b) =>
                          String(a.name || "").localeCompare(String(b.name || ""), "he")
                        );
                        const orphan = currentValue && !optionStudios.some(st => String(st.id) === currentValue)
                          ? studios.find(st => String(st.id) === currentValue)
                          : null;
                        const usedByOtherColumns = new Set(sessionIds.filter((id, j) => j !== colIdx && id));
                        return (
                          <select key={`col-${colIdx}-${cs.studioId}`} className="form-select" value={currentValue} style={{padding:"3px 4px",fontSize:11,height:28,width:"100%",boxSizing:"border-box"}} title={`כיתה ${colIdx+1} למפגש זה`} onChange={e=>updateSessionStudioSlot(i, colIdx, e.target.value)}>
                            <option value="">ללא שיוך</option>
                            {optionStudios.map(st => (
                              <option key={st.id} value={st.id} disabled={usedByOtherColumns.has(String(st.id))}>
                                {st.name}
                              </option>
                            ))}
                            {orphan && <option key={orphan.id} value={orphan.id}>{orphan.name}</option>}
                          </select>
                        );
                      })}
                      <div style={{display:"flex",justifyContent:"center",borderRight:"none",background:"rgba(255,80,80,0.04)"}}>
                        <button onClick={()=>setSchedule(prev=>prev.filter((_,j)=>j!==i))}
                          style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:16,padding:0,lineHeight:1,width:"100%",height:28}} title="מחק מפגש">×</button>
                      </div>
                    </div>
                  );})}
                </div>
              </div>
            )}

            <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
              <button className="btn btn-primary btn-sm" style={{background:"#9b59b6",borderColor:"#9b59b6"}} onClick={appendLessonFromExisting}>➕ שיעור נוסף</button>
              <button
                className="btn btn-primary btn-sm"
                style={{background:"#9b59b6",borderColor:"#9b59b6"}}
                onClick={addLecturerColumn}
                disabled={lecturerColumnCount >= courseLecturers.length}
                title={lecturerColumnCount >= courseLecturers.length ? "הוסף עוד מרצה ב\"מרצי הקורס\" כדי להוסיף עמודה" : "הוסף עמודת מרצה ללוח השיעורים"}
              >👤 הוסף עמודת מרצה</button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={removeLecturerColumn}
                disabled={lecturerColumnCount <= 1}
                title={lecturerColumnCount <= 1 ? "נשארה עמודת מרצה אחת בלבד" : "הסר את עמודת המרצה האחרונה (כולל הבחירות בה)"}
              >👤 הסר עמודת מרצה</button>
              <button className="btn btn-secondary btn-sm" style={{color:"var(--red)",borderColor:"var(--red)"}} onClick={()=>setSchedule([])}>🗑️ נקה הכל</button>
            </div>
          </div>
        )}
      </div>

      </div>{/* ── close left column ── */}
      </div>{/* ── close two-column grid ── */}

      {/* Student-status floating panel — admin/secretariat read-only view.
          Mirrors what the lecturer sees in the portal but cannot be edited
          here (lecturer is source of truth). Closes on backdrop click, ESC,
          or the X button. */}
      {showStudentStatuses && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={()=>setShowStudentStatuses(false)}
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}
        >
          <div
            onClick={(e)=>e.stopPropagation()}
            style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:18,padding:"22px 24px",width:"min(640px, 100%)",maxHeight:"85vh",overflow:"auto",direction:"rtl",boxShadow:"0 20px 60px rgba(0,0,0,0.45)"}}
          >
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginBottom:14}}>
              <div>
                <div style={{fontSize:18,fontWeight:900,color:"#9b59b6",display:"flex",alignItems:"center",gap:8}}>
                  <GraduationCap size={18} strokeWidth={1.75}/> רשימת תלמידים — {name || "ללא שם"}
                </div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:4}}>
                  מסלול: <b style={{color:"var(--text2)"}}>{track || "—"}</b> · סטטוס נקבע על-ידי המרצה
                </div>
              </div>
              <button
                type="button"
                onClick={()=>setShowStudentStatuses(false)}
                style={{background:"transparent",border:"none",color:"var(--text3)",cursor:"pointer",padding:6,display:"flex"}}
                aria-label="סגור"
              >
                <X size={20} strokeWidth={2}/>
              </button>
            </div>

            <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14,fontSize:12}}>
              <span style={{background:"rgba(46,204,113,0.12)",border:"1px solid rgba(46,204,113,0.4)",color:"#2ecc71",borderRadius:999,padding:"3px 12px",fontWeight:800}}>
                סיים: {passedStudents.length}
              </span>
              <span style={{background:"rgba(231,76,60,0.12)",border:"1px solid rgba(231,76,60,0.4)",color:"#e74c3c",borderRadius:999,padding:"3px 12px",fontWeight:800}}>
                לא סיים: {decidedStudents.length - passedStudents.length}
              </span>
              <span style={{background:"rgba(136,145,168,0.12)",border:"1px solid rgba(136,145,168,0.35)",color:"var(--text2)",borderRadius:999,padding:"3px 12px",fontWeight:800}}>
                אין סטטוס: {studentsInTrack.length - decidedStudents.length}
              </span>
            </div>

            {studentsInTrack.length === 0 ? (
              <div style={{padding:"24px 0",textAlign:"center",color:"var(--text3)",fontSize:14}}>
                אין תלמידים במסלול הזה.
              </div>
            ) : (
              <div style={{border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 140px",background:"var(--surface2)",padding:"10px 14px",fontSize:12,fontWeight:800,color:"var(--text2)",borderBottom:"1px solid var(--border)"}}>
                  <div>שם מלא</div>
                  <div style={{textAlign:"center"}}>סטטוס</div>
                </div>
                {studentsInTrack.map((s, idx) => {
                  const fullName = String(s?.name || `${s?.firstName || ""} ${s?.lastName || ""}`).trim() || "—";
                  const status = studentStatusMap[s.id];
                  const isPassed = status === "passed";
                  const isFailed = status === "failed";
                  return (
                    <div key={s.id || idx} style={{display:"grid",gridTemplateColumns:"1fr 140px",padding:"10px 14px",borderTop: idx === 0 ? "none" : "1px solid var(--border)",alignItems:"center",fontSize:13}}>
                      <div style={{fontWeight:700,color:"var(--text)"}}>{fullName}</div>
                      <div style={{textAlign:"center"}}>
                        {isPassed && (
                          <span style={{background:"rgba(46,204,113,0.12)",border:"1px solid rgba(46,204,113,0.4)",color:"#2ecc71",borderRadius:999,padding:"3px 12px",fontWeight:800,fontSize:12,display:"inline-flex",alignItems:"center",gap:4}}>
                            <CheckCircle size={13} strokeWidth={2}/> סיים
                          </span>
                        )}
                        {isFailed && (
                          <span style={{background:"rgba(231,76,60,0.12)",border:"1px solid rgba(231,76,60,0.4)",color:"#e74c3c",borderRadius:999,padding:"3px 12px",fontWeight:800,fontSize:12,display:"inline-flex",alignItems:"center",gap:4}}>
                            <XCircle size={13} strokeWidth={2}/> לא סיים
                          </span>
                        )}
                        {!isPassed && !isFailed && (
                          <span style={{background:"rgba(136,145,168,0.12)",border:"1px solid rgba(136,145,168,0.35)",color:"var(--text3)",borderRadius:999,padding:"3px 12px",fontWeight:700,fontSize:12}}>
                            אין סטטוס
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{marginTop:14,fontSize:11,color:"var(--text3)",lineHeight:1.6}}>
              ℹ️ הסטטוסים נקבעים על-ידי המרצה דרך פורטל המרצים (<b>רשימת תלמידים</b>). תצוגה זו לקריאה בלבד.
            </div>

            <div style={{display:"flex",justifyContent:"flex-end",marginTop:14}}>
              <button type="button" className="btn btn-secondary" onClick={()=>setShowStudentStatuses(false)}>
                סגור
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save */}
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <button className="btn btn-secondary" onClick={onCancel}>ביטול</button>
        <button className="btn btn-primary" style={{background:"#9b59b6",borderColor:"#9b59b6"}} onClick={handleSave} disabled={saving}>
          {saving?<><Clock size={16} strokeWidth={1.75} /> שומר...</>:`💾 ${initial?"עדכן":"צור"} קורס`}
        </button>
      </div>
    </div>
  );
}
