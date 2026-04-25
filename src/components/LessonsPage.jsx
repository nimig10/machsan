// LessonsPage.jsx — course & lesson schedule management
import { useRef, useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { Award, BookOpen, Calendar, Camera, Check, CheckCircle, Clock, Download, FileText, Film, GraduationCap, Lightbulb, Link, Mail, Mic, Package, Pencil, Phone, Plus, Search, Trash2, Upload, User, Video, X, XCircle } from "lucide-react";
import { storageSet, formatDate, formatLocalDateInput, parseLocalDate, today, getAuthToken } from "../utils.js";
import { makeLecturer } from "./LecturersPage.jsx";

let _skeyCounter = 0;

function sortScheduleEntries(entries = []) {
  return [...entries].sort((a, b) => {
    const aDateTime = `${a?.date || ""} ${a?.startTime || "00:00"}`;
    const bDateTime = `${b?.date || ""} ${b?.startTime || "00:00"}`;
    return aDateTime.localeCompare(bDateTime, "he");
  });
}

function normalizeScheduleEntry(entry = {}) {
  return {
    _key: entry?._key || `sk-${++_skeyCounter}`,
    date: entry?.date || "",
    startTime: entry?.startTime || "09:00",
    endTime: entry?.endTime || "12:00",
    topic: String(entry?.topic || "").trim(),
    studioId: entry?.studioId || null,
    kitId: entry?.kitId || null,
  };
}

function dedupeScheduleEntries(entries = []) {
  const seen = new Set();
  return sortScheduleEntries(entries)
    .filter((entry) => {
      const normalized = normalizeScheduleEntry(entry);
      const key = `${normalized.date}__${normalized.startTime}__${normalized.endTime}__${normalized.topic}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(e => e._key ? e : normalizeScheduleEntry(e));
}

function normalizeHebrewDay(dayOfWeek = "") {
  const cleaned = String(dayOfWeek || "").trim().replace(/^יום\s+/, "");
  const aliasMap = {
    ראשון: 0,
    א: 0,
    "א׳": 0,
    שני: 1,
    ב: 1,
    "ב׳": 1,
    שלישי: 2,
    ג: 2,
    "ג׳": 2,
    רביעי: 3,
    ד: 3,
    "ד׳": 3,
    חמישי: 4,
    ה: 4,
    "ה׳": 4,
    שישי: 5,
    ו: 5,
    "ו׳": 5,
    שבת: 6,
    ש: 6,
    "ש׳": 6,
  };
  return aliasMap[cleaned];
}

function getNextDateForHebrewDay(dayOfWeek = "") {
  const targetDay = normalizeHebrewDay(dayOfWeek);
  if (targetDay === undefined) return today();
  const now = new Date();
  const diff = (targetDay - now.getDay() + 7) % 7;
  const nextDate = new Date(now);
  nextDate.setDate(now.getDate() + diff);
  return formatLocalDateInput(nextDate);
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

function normalizeImportedLessonDate(dateValue = "", dayOfWeek = "") {
  const raw = String(dateValue || "").trim();
  if (!raw) return getNextDateForHebrewDay(dayOfWeek);

  if (isValidImportedDate(raw)) return raw;

  if (/^\d{4,6}$/.test(raw)) {
    const serial = Number(raw);
    if (Number.isFinite(serial) && serial > 0) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const parsedDate = new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
      const normalized = `${parsedDate.getUTCFullYear()}-${String(parsedDate.getUTCMonth() + 1).padStart(2, "0")}-${String(parsedDate.getUTCDate()).padStart(2, "0")}`;
      if (isValidImportedDate(normalized)) return normalized;
    }
  }

  const localMatch = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (localMatch) {
    const [, day, month, yearRaw] = localMatch;
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    const normalized = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (isValidImportedDate(normalized)) return normalized;
  }

  return getNextDateForHebrewDay(dayOfWeek);
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

function splitImportedLessonTimeRange(timeRangeValue = "") {
  const raw = String(timeRangeValue || "").trim();
  if (!raw) return { startTime: "", endTime: "" };
  const matches = [...raw.matchAll(/(\d{1,2}):(\d{1,2})/g)];
  if (matches.length < 2) return { startTime: "", endTime: "" };
  return {
    startTime: normalizeImportedLessonTime(`${matches[0][1]}:${matches[0][2]}`),
    endTime: normalizeImportedLessonTime(`${matches[1][1]}:${matches[1][2]}`),
  };
}

function resolveImportedLessonTimes(item = {}) {
  const rawStartTime = String(item?.startTime || "").trim();
  const rawEndTime = String(item?.endTime || "").trim();
  const rangeCandidate = [
    item?.timeRange,
    item?.timeWindow,
    item?.time_window,
    item?.hoursRange,
    item?.hourRange,
    rawStartTime.includes("-") ? rawStartTime : "",
    rawEndTime.includes("-") ? rawEndTime : "",
  ].find((value) => String(value || "").trim());
  const { startTime: rangeStartTime, endTime: rangeEndTime } = splitImportedLessonTimeRange(rangeCandidate);
  const hasExplicitStartTime = /(\d{1,2}):(\d{1,2})/.test(rawStartTime) && !rawStartTime.includes("-");
  const hasExplicitEndTime = /(\d{1,2}):(\d{1,2})/.test(rawEndTime) && !rawEndTime.includes("-");

  return {
    startTime: hasExplicitStartTime ? normalizeImportedLessonTime(rawStartTime) : (rangeStartTime || normalizeImportedLessonTime(rawStartTime)),
    endTime: hasExplicitEndTime ? normalizeImportedLessonTime(rawEndTime) : (rangeEndTime || normalizeImportedLessonTime(rawEndTime)),
  };
}

function parseGeneratedLessonsJson(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned);
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

export function LessonsPage({ lessons=[], setLessons, studios=[], kits=[], showToast, reservations=[], setReservations, equipment=[], trackOptions=[], studioBookings=[], setStudioBookings, certifications={}, openLessonId=null, onOpenLessonConsumed=null, lecturers=[], setLecturers, siteSettings={} }) {
  const [mode, setMode] = useState(null); // null | "add" | "edit"
  const [editTarget, setEditTarget] = useState(null);
  const [pendingLesson, setPendingLesson] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [conflictSending, setConflictSending] = useState(false);
  const [detailTarget, setDetailTarget] = useState(null); // course detail modal
  const [search, setSearch] = useState("");
  const [trackFilter, setTrackFilter] = useState([]);
  const [sortMode, setSortMode] = useState("recent"); // "recent" | "urgency"
  const [archiveView, setArchiveView] = useState(false);
  const [timeFilter, setTimeFilter] = useState("all"); // "all" | "week" | "month"
  const [xlImporting, setXlImporting] = useState(false);
  const [aiImporting, setAiImporting] = useState(false);
  const importInputRef = useRef(null);
  const aiImportInputRef = useRef(null);

  // Navigate directly to lesson edit form when openLessonId is set (e.g. from room booking)
  useEffect(() => {
    if (!openLessonId) return;
    const lesson = lessons.find(l => String(l.id) === String(openLessonId));
    if (lesson) {
      setEditTarget(lesson);
      setMode("edit");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    if (onOpenLessonConsumed) onOpenLessonConsumed();
  }, [openLessonId]);
  const normalizedTrackOptions = [...new Set((trackOptions || []).map((option) => String(option || "").trim()).filter(Boolean))];
  const isKnownTrack = (value = "") => normalizedTrackOptions.includes(String(value || "").trim());

  // Auto-create lecturers from imported lessons and link them
  const syncImportedLecturers = async (importedLessons) => {
    if (!setLecturers) return importedLessons;
    const existingNames = new Set(lecturers.map(l => String(l.fullName || "").trim().toLowerCase()));
    const newLecs = [];
    const nameToId = {};
    for (const lec of lecturers) nameToId[String(lec.fullName || "").trim().toLowerCase()] = lec.id;

    const updated = importedLessons.map(lesson => {
      const instrName = String(lesson.instructorName || "").trim();
      if (!instrName) return lesson;
      const key = instrName.toLowerCase();
      if (!existingNames.has(key) && !nameToId[key]) {
        const newLec = makeLecturer({ fullName: instrName, phone: lesson.instructorPhone || "", email: lesson.instructorEmail || "" });
        newLecs.push(newLec);
        existingNames.add(key);
        nameToId[key] = newLec.id;
      }
      return { ...lesson, lecturerId: nameToId[key] || lesson.lecturerId || null };
    });

    if (newLecs.length > 0) {
      const allLecs = [...lecturers, ...newLecs];
      const result = await storageSet("lecturers", allLecs);
      if (!result?.ok) {
        throw new Error("שגיאה בשמירת המרצים החדשים שנוצרו מהייבוא");
      }
      setLecturers(allLecs);
    }
    return updated;
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
    const result = await storageSet("lessons", updated);
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
    for (const session of (lesson.schedule || [])) {
      const stId = String(session.studioId || lesson.studioId || "");
      if (!stId) continue;
      for (const b of studioBookings) {
        if (seenIds.has(String(b.id))) continue;
        const kind = b.bookingKind || (b.lesson_id ? "lesson" : b.teamMemberId ? "team" : "student");
        if (kind !== "student") continue;
        if (String(b.studioId) !== stId) continue;
        if (b.date !== session.date) continue;
        const bS = b.startTime || "00:00", bE = b.endTime || "23:59";
        const sS = session.startTime || "00:00", sE = session.endTime || "23:59";
        if (bS < sE && bE > sS) {
          const studio = studios.find(s => String(s.id) === stId);
          found.push({ booking: b, session, studioName: studio?.name || "החדר" });
          seenIds.add(String(b.id));
        }
      }
    }
    return found;
  };

  const findLessonConflict = (lesson) => {
    for (const session of (lesson.schedule || [])) {
      const stId = String(session.studioId || lesson.studioId || "");
      if (!stId) continue;
      const sS = session.startTime || "00:00", sE = session.endTime || "23:59";
      for (const other of lessons) {
        if (other.id === lesson.id) continue; // skip self when editing
        const otherStId = String(other.studioId || "");
        for (const os of (other.schedule || [])) {
          const osStId = String(os.studioId || otherStId || "");
          if (osStId !== stId) continue;
          if (os.date !== session.date) continue;
          const oS = os.startTime || "00:00", oE = os.endTime || "23:59";
          if (oS < sE && oE > sS) {
            const studio = studios.find(s => String(s.id) === stId);
            return { lessonName: other.name, studioName: studio?.name || "החדר", startTime: oS, endTime: oE, date: os.date };
          }
        }
      }
    }
    return null;
  };

  const save = async (lesson) => {
    const lessonConflict = findLessonConflict(lesson);
    if (lessonConflict) {
      showToast("error", `פעולה נחסמה: החדר "${lessonConflict.studioName}" כבר תפוס בשעות אלו. הקביעה הקיימת שמפריעה: "${lessonConflict.lessonName}" בין השעות ${lessonConflict.startTime} ל-${lessonConflict.endTime}`);
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

  const confirmConflictAndSend = async () => {
    if (!pendingLesson) return;
    setConflictSending(true);
    try {
      const conflictIds = new Set(conflicts.map(c => String(c.booking.id)));
      const newBookings = studioBookings.filter(b => !conflictIds.has(String(b.id)));
      if (setStudioBookings) setStudioBookings(newBookings);
      await storageSet("studio_bookings", newBookings);
      await Promise.all(conflicts.map(async ({ booking, studioName }) => {
        const studentRecord = (certifications?.students || []).find(s => s.name === booking.studentName);
        const email = studentRecord?.email || booking.email;
        if (!email) return;
        try {
          const tokConf = await getAuthToken();
          await fetch("/api/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(tokConf ? { Authorization: `Bearer ${tokConf}` } : {}) },
            body: JSON.stringify({
              to: email,
              type: "studio_lesson_conflict",
              student_name: booking.studentName,
              project_name: studioName,
              borrow_date: booking.date,
              borrow_time: booking.startTime,
              return_time: booking.endTime,
            }),
          });
        } catch(e) { console.error("conflict email failed", e); }
      }));
      await doSaveLesson(pendingLesson);
    } finally {
      setConflictSending(false);
      setPendingLesson(null);
      setConflicts([]);
    }
  };

  const del = async (id) => {
    const updated = lessons.filter(l => l.id !== id);
    setLessons(updated);
    await storageSet("lessons", updated);
    showToast("success", "הקורס נמחק. ניתן לשחזר עם לחצן ↩ בטל פעולה למעלה.");
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
    const lastDate = [...schedule].sort((a, b) => b.date.localeCompare(a.date))[0]?.date || "";
    return lastDate < today();
  };

  // חישוב טווח השבוע הנוכחי (ראשון–שבת) והחודש הנוכחי
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

  const filtered = lessons.filter((lesson) => {
    const matchesSearch = !search || lesson.name?.includes(search) || lesson.instructorName?.includes(search);
    const trackLabel = getLessonTrackLabel(lesson);
    const matchesTrack = allTracksSelected || trackFilter.includes(trackLabel);
    const matchesArchive = archiveView ? isArchived(lesson) : !isArchived(lesson);
    const matchesTime = timeFilter === "all" ||
      (timeFilter === "week" && lessonHasSessionInRange(lesson, getWeekRange())) ||
      (timeFilter === "month" && lessonHasSessionInRange(lesson, getMonthRange()));
    return matchesSearch && matchesTrack && matchesArchive && matchesTime;
  });

  const archivedCount = lessons.filter(isArchived).length;

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

  const importLessonsXL = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    setXlImporting(true);
    try {
      // קריאת כל הגיליונות ללא AI
      const readAllSheets = async () => {
        if (/\.xlsx?$/i.test(file.name)) {
          const buf = await file.arrayBuffer();
          const wb = XLSX.read(buf, { type:"array" });
          return wb.SheetNames
            .map(name => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header:1, defval:"" }) }))
            .filter(s => s.rows.length > 1);
        }
        // CSV / TSV
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter(line => line.trim());
        const sep = lines[0]?.includes("\t") ? "\t" : ",";
        return [{ name: "sheet1", rows: lines.map(line => line.split(sep).map(cell => cell.trim().replace(/^"|"$/g, ""))) }];
      };

      const sheets = await readAllSheets();
      if (!sheets.length) {
        showToast("error", "קובץ ה־XL ריק");
        setXlImporting(false);
        return;
      }

      const toIsoDate = (rawValue) => {
        let value = String(rawValue || "").trim();
        if (!value) return "";
        if (/^\d{5}$/.test(value)) {
          const date = new Date(Math.round((Number(value) - 25569) * 86400000));
          return formatLocalDateInput(date);
        }
        const parts = value.includes("/") ? value.split("/") : value.split("-");
        if (parts.length !== 3) return value;
        if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
        return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
      };

      // עיבוד כל גיליון בנפרד — כל גיליון עם headers משלו
      const groups = new Map();
      for (const sheet of sheets) {
        const rows = sheet.rows;
        if (rows.length < 2) continue;
        const headers = rows[0].map(h => String(h || "").trim().replace(/[\uFEFF\u200B-\u200D\u00A0]/g, "").toLowerCase());
        const findH = (...patterns) => headers.findIndex(h => patterns.some(p => h.includes(p)));
        const courseIdx = findH("קורס", "course", "שם קורס");
        const dateIdx = findH("תאריך", "date");
        const startIdx = findH("התחלה", "start", "שעת התחלה");
        const endIdx = findH("סיום", "end", "שעת סיום");
        const instructorIdx = findH("מרצה", "מורה", "lecturer", "teacher", "instructor");
        const phoneIdx = findH("טלפון", "phone", "נייד");
        const emailIdx = findH("מייל", "email", "mail");
        const trackIdx = findH("מסלול", "track", "קבוצה", "class");
        const studioIdx = findH("כיתת לימוד", "אולפן", "studio", "כיתה");
        const kitIdx = findH("ערכה", "kit");
        const topicIdx = findH("נושא", "topic", "subject");
        const notesIdx = findH("הערות", "description", "notes", "תיאור");

        if (courseIdx === -1 || dateIdx === -1) continue; // גיליון ללא עמודות חובה — דלג

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          // אם שם הקורס לא קיים בשורה, נסה לקחת אותו משם הגיליון
          const courseName = String(row[courseIdx] || "").trim() || sheet.name.trim();
          const date = toIsoDate(row[dateIdx]);
          if (!courseName || !date) continue;
          if (!groups.has(courseName)) {
            groups.set(courseName, {
              name: courseName,
              instructorName: instructorIdx >= 0 ? String(row[instructorIdx] || "").trim() : "",
              instructorPhone: phoneIdx >= 0 ? String(row[phoneIdx] || "").trim() : "",
              instructorEmail: emailIdx >= 0 ? String(row[emailIdx] || "").trim() : "",
              track: trackIdx >= 0 ? String(row[trackIdx] || "").trim() : "",
              studioName: studioIdx >= 0 ? String(row[studioIdx] || "").trim() : "",
              kitName: kitIdx >= 0 ? String(row[kitIdx] || "").trim() : "",
              description: notesIdx >= 0 ? String(row[notesIdx] || "").trim() : "",
              schedule: [],
            });
          }
          const group = groups.get(courseName);
          if (!group.instructorName && instructorIdx >= 0) group.instructorName = String(row[instructorIdx] || "").trim();
          if (!group.instructorPhone && phoneIdx >= 0) group.instructorPhone = String(row[phoneIdx] || "").trim();
          if (!group.instructorEmail && emailIdx >= 0) group.instructorEmail = String(row[emailIdx] || "").trim();
          if (!group.track && trackIdx >= 0) group.track = String(row[trackIdx] || "").trim();
          if (!group.studioName && studioIdx >= 0) group.studioName = String(row[studioIdx] || "").trim();
          if (!group.kitName && kitIdx >= 0) group.kitName = String(row[kitIdx] || "").trim();
          if (!group.description && notesIdx >= 0) group.description = String(row[notesIdx] || "").trim();
          const sessionStudioName = studioIdx >= 0 ? String(row[studioIdx] || "").trim() : "";
          const sessionKitName = kitIdx >= 0 ? String(row[kitIdx] || "").trim() : "";
          group.schedule.push(normalizeScheduleEntry({
            date,
            startTime: startIdx >= 0 ? normalizeImportedLessonTime(row[startIdx]) || "09:00" : "09:00",
            endTime: endIdx >= 0 ? normalizeImportedLessonTime(row[endIdx]) || "12:00" : "12:00",
            topic: topicIdx >= 0 ? String(row[topicIdx] || "").trim() : "",
            studioId: sessionStudioName ? (studios.find(s=>s.name===sessionStudioName)?.id || null) : null,
            kitId: sessionKitName ? (lessonKits.find(k=>k.name===sessionKitName)?.id || null) : null,
          }));
        }
      }

      if (groups.size === 0) {
        showToast("error", "לא נמצאו קורסים תקינים לייבוא");
        setXlImporting(false);
        return;
      }
      const invalidTracks = [...new Set(
        [...groups.values()]
          .map((group) => String(group.track || "").trim())
          .filter((track) => !isKnownTrack(track))
          .map((track) => track || "ללא מסלול")
      )];
      if (invalidTracks.length) {
        showToast("error", `מסלול לימודים לא קיים: ${invalidTracks.join(", ")}`);
        setXlImporting(false);
        return;
      }

      let addedCount = 0;
      let updatedCount = 0;
      const updatedLessons = [...lessons];
      groups.forEach((group) => {
        const studioId = studios.find((studio) => studio.name === group.studioName)?.id ?? null;
        const kitId = lessonKits.find((kit) => kit.name === group.kitName)?.id ?? null;
        const existingIndex = updatedLessons.findIndex((lesson) => lesson.name === group.name);
        const nextSchedule = dedupeScheduleEntries(group.schedule);
        if (existingIndex >= 0) {
          const existing = updatedLessons[existingIndex];
          updatedLessons[existingIndex] = {
            ...existing,
            track: group.track || existing.track || "",
            instructorName: group.instructorName || existing.instructorName || "",
            instructorPhone: group.instructorPhone || existing.instructorPhone || "",
            instructorEmail: group.instructorEmail || existing.instructorEmail || "",
            description: group.description || existing.description || "",
            studioId: studioId ?? existing.studioId ?? null,
            kitId: kitId ?? existing.kitId ?? null,
            schedule: dedupeScheduleEntries([...(existing.schedule || []), ...nextSchedule]),
          };
          updatedCount += 1;
          return;
        }
        updatedLessons.push({
          id: `lesson_${Date.now()}_${addedCount + updatedCount}`,
          name: group.name,
          track: group.track,
          instructorName: group.instructorName,
          instructorPhone: group.instructorPhone,
          instructorEmail: group.instructorEmail,
          description: group.description,
          studioId,
          kitId,
          schedule: nextSchedule,
          created_at: new Date().toISOString(),
        });
        addedCount += 1;
      });

      const synced = await syncImportedLecturers(updatedLessons);
      setLessons(synced);
      await storageSet("lessons", synced);
      showToast("success", `יובאו ${addedCount} קורסים ועודכנו ${updatedCount} קורסים`);
    } catch (error) {
      console.error("Lessons XL import failed", error);
      showToast("error", "שגיאה בייבוא קורסים מ־XL");
    } finally {
      setXlImporting(false);
    }
  };

  const importLessonsSmartAI = async (event) => {
    const input = event.target;
    const file = input?.files?.[0];
    if (!file) return;

    setAiImporting(true);

    try {
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const result = e?.target?.result;
          const data = new Uint8Array(result instanceof ArrayBuffer ? result : new ArrayBuffer(0));
          const workbook = XLSX.read(data, { type: "array" });
          const sheetNames = workbook.SheetNames || [];
          if (!sheetNames.length) throw new Error("לא נמצא גיליון תקין בקובץ.");

          const csvParts = [];
          for (const sName of sheetNames) {
            const ws = workbook.Sheets[sName];
            if (!ws) continue;
            const csv = XLSX.utils.sheet_to_csv(ws);
            const cleanLines = String(csv || "").split("\n").filter(line => line.replace(/,/g, "").trim());
            if (cleanLines.length) {
              csvParts.push(`--- גיליון: ${sName} ---\n${cleanLines.join("\n")}`);
            }
          }
          const csvData = csvParts.join("\n\n");
          if (!csvData.trim()) throw new Error("לא נמצא תוכן קריא בקובץ.");


          const studioListStr = (studios || []).map(s => s.name).filter(Boolean).join(", ");
          const systemInstruction = `
אתה מנהל מערכת חכם במכללת קולנוע וסאונד. מטרתך לחלץ נתוני קורסים מקובץ CSV ולהחזירם כ-JSON.

מבנה הטמפלייט הצפוי (ייתכנו שגיאות כתיב, מילים חלקיות, ניסוחים שונים — התמודד איתם):
• כותרת קורס: "מסלול לימודים" / "מסלול", "שם" (=שם הקורס), "שיוך אולפן" / "אולפן" (=שם האולפן), "מפגשים" (=מספר מפגשים)
• פרטי מרצה: "פרטי מרצה", "שם", "מייל" / "אימייל" / "email", "טלפון" / "נייד"
• טבלת מפגשים: "מפגשים" / "מפגש" / "#", "תאריך", "שעת התחלה" / "שעה", "שעת סיום", "נושא המפגש" / "נושא" / "תיאור"
• עמודת כיתה/אולפן: עשויה להופיע בשמות שונים: "כיתה", "כיתת לימוד", "אולפן", "חדר", "שיוך אולפן", "studio" — כולם מתייחסים לאותו שדה (studioName).

אולפנים קיימים במערכת: ${studioListStr || "לא צוין"}
אם בעמודה "כיתה" / "כיתת לימוד" מופיע שם דומה לאחד מהאולפנים לעיל — כתוב studioName בדיוק כפי שהוא מופיע ברשימה. אחרת כתוב את הטקסט כפי שמופיע בקובץ.

חוקים:
1. לכל שורת מפגש — חלץ: date, startTime, endTime, sessionTopic (נושא המפגש), dayOfWeek
2. חלץ studioName מהעמודה "כיתה" / "אולפן" / "כיתת לימוד" (גם אם הכתיב שגוי) — נסה להתאים לרשימת האולפנים הנ"ל
3. חלץ instructorEmail ו-instructorPhone מסקשן "פרטי מרצה" — שייך אותם לאותו קורס
4. חלץ שעות לפורמט HH:MM. אם חסרה שעה — כתוב '00:00'
5. תאריך בפורמט YYYY-MM-DD. אם הוא מספר אקסל (כגון 46120) — המר ל-YYYY-MM-DD (בסיס: 1900-01-01)
6. זהה מסלול לימודים מהכותרות. אם לא ברור — השאר ריק
7. התעלם לחלוטין משורות של: חגים, שבתות, פגרות, הודעות מנהלה ("פורים", "שבת", "פגרה", "סגור" וכו')
        `;

          const csvText = csvData;
          const prompt = `
  אני מעביר לך תוכן גולמי (CSV) שחולץ מקובץ מערכת שעות של שיעורים וקורסים.

  חובה עליך ליישם את החוקים הבאים:
  1. תאריכים: המר כל תאריך שמופיע (לרוב בפורמט DD/MM/YYYY) לפורמט סטנדרטי בלבד: YYYY-MM-DD (לדוגמה: 2026-03-26).
  2. פיצול טווח שעות (קריטי!): תחת "טווח שעות" תמצא זמנים כמו "09:00-11:45" או "12:15-15:00".
     חובה עליך לפצל אותם לשני שדות נפרדים לחלוטין:
     - startTime: שעת ההתחלה בדיוק כפי שהיא מופיעה (למשל "09:00" או "12:15").
     - endTime: שעת הסיום בדיוק כפי שהיא מופיעה (למשל "11:45" או "15:00").
     אל תשנה או תעגל את הדקות, פשוט פצל את המחרוזת לפי המקף.
  3. שם המרצה/מורה (קריטי!): עליך לחלץ את שם איש הצוות המעביר את השיעור. הכותרת בקובץ עשויה להשתנות: "מורה", "מרצה", "מדריך", "מורה/מרצה". גם אם השם מופיע בכותרת מעל הטבלה ולא בכל שורה — שייך אותו לכל השורות שמתחתיו. הכנס את השם המלא לשדה instructor. אסור להחזיר instructor ריק אם ניתן לזהות שם מרצה!
  4. חלץ גם את נושא השיעור (title), מסלול (track) ושנה (year).
  5. כיתה/אולפן: חלץ מעמודה "כיתה" / "כיתת לימוד" / "אולפן" לשדה studioName.

  הנתונים הגולמיים (CSV):
  ${csvText}
          `;

          const requestBody = {
            contents: [{ parts: [{ text: prompt }] }],
            systemInstruction: { parts: [{ text: "אתה עוזר חכם לניהול מערכת שעות. החזר אך ורק JSON חוקי של מערך אובייקטים, בלי טקסט נוסף ובלי Markdown." }] },
            generationConfig: {
              thinkingConfig: { thinkingBudget: 0 },
              responseMimeType: "application/json",
              responseSchema: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    title: { type: "STRING", description: "נושא השיעור / שם הקורס" },
                    date: { type: "STRING", description: "תאריך השיעור בפורמט YYYY-MM-DD" },
                    startTime: { type: "STRING", description: "שעת התחלה בפורמט HH:MM (למשל 09:00 או 12:15)" },
                    endTime: { type: "STRING", description: "שעת סיום בפורמט HH:MM (למשל 11:45 או 15:00)" },
                    track: { type: "STRING", description: "מסלול לימודים" },
                    instructor: { type: "STRING", description: "שם המורה / מרצה / מדריך המעביר את השיעור" },
                    year: { type: "STRING", description: "שנה (א/ב/ג)" },
                    dayOfWeek: { type: "STRING" },
                    timeRange: { type: "STRING", description: "טווח שעות מקורי אם קיים, למשל 09:00-11:45" },
                    studioName: { type: "STRING" },
                    sessionTopic: { type: "STRING" },
                    instructorEmail: { type: "STRING" },
                    instructorPhone: { type: "STRING" },
                  },
                  required: ["title", "date", "startTime", "endTime", "instructor"],
                },
              },
            },
          };

          let jsonResponse = null;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 120000);
          try {
            const token = await getAuthToken();
            const resp = await fetchWithRetry('/api/gemini', {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify(requestBody),
              signal: controller.signal,
            }, 2);
            clearTimeout(timeoutId);
            if (!resp.ok) {
              const errorText = await resp.text();
              throw new Error(`API Error ${resp.status}: ${errorText}`);
            }
            jsonResponse = await resp.json();
          } catch (fetchErr) {
            clearTimeout(timeoutId);
            if (fetchErr.name === "AbortError") throw new Error("timeout — השרת לא הגיב תוך 2 דקות");
            throw fetchErr;
          }
          if (!jsonResponse?.candidates?.length) {
            throw new Error("Gemini לא החזיר תוצאות. נסה שוב.");
          }

          const generatedText = jsonResponse.candidates[0]?.content?.parts?.[0]?.text;
          if (!generatedText) throw new Error("Gemini לא החזיר JSON.");

          const parsedLessons = parseGeneratedLessonsJson(generatedText);
          if (!Array.isArray(parsedLessons) || parsedLessons.length === 0) {
            throw new Error("לא נמצאו שיעורים בקובץ לפי הפענוח של Gemini.");
          }

          const blockedKeywords = ["פורים", "שבת", "9 באב", "יום השואה", "חופשה", "חג", "הערה", "מזכירות", "הודעה", "ביטול"];
          blockedKeywords.push("פגרה", "סגור", "בית הספר יהיה סגור");
          const cleanedLessons = parsedLessons.filter((item) => {
            const mergedText = [item?.title, item?.courseName, item?.instructor, item?.teacher, item?.track, item?.dayOfWeek, item?.date]
              .map((value) => String(value || ""))
              .join(" ");
            return !blockedKeywords.some((keyword) => mergedText.includes(keyword));
          });

          if (cleanedLessons.length === 0) {
            throw new Error("Gemini לא החזיר שיעורים תקינים אחרי סינון חגים והערות.");
          }
          // fuzzy-match tracks: if AI returns a slightly different name, try to find the closest known track
          const fuzzyMatchTrack = (aiTrack) => {
            if (!aiTrack) return "";
            if (isKnownTrack(aiTrack)) return aiTrack;
            const lower = aiTrack.toLowerCase();
            return normalizedTrackOptions.find(t => t.toLowerCase().includes(lower) || lower.includes(t.toLowerCase())) || aiTrack;
          };
          cleanedLessons.forEach(item => {
            if (item?.track) item.track = fuzzyMatchTrack(String(item.track).trim());
          });
          const invalidAiTracks = [...new Set(
            cleanedLessons
              .map((item) => String(item?.track || "").trim())
              .filter((track) => track && !isKnownTrack(track))
          )];
          if (invalidAiTracks.length) {
            // warn but don't block — set unrecognized tracks to empty
            invalidAiTracks.forEach(bad => {
              cleanedLessons.forEach(item => { if (String(item?.track||"").trim() === bad) item.track = ""; });
            });
          }

          const groupedLessons = new Map();
          cleanedLessons.forEach((item, index) => {
            const courseName = String(item?.title || item?.courseName || "").trim();
            const teacher = String(item?.instructor || item?.teacher || "").trim() || "לא צוין";
            const track = String(item?.track || "").trim();
            const dayOfWeek = String(item?.dayOfWeek || "").trim();
            const lessonDate = normalizeImportedLessonDate(item?.date, dayOfWeek);
            const { startTime, endTime } = resolveImportedLessonTimes(item);
            const sessionTopic = String(item?.sessionTopic || item?.title || "").trim();
            const studioNameRaw = String(item?.studioName || "").trim();
            const itemEmail = String(item?.instructorEmail || "").trim();
            const itemPhone = String(item?.instructorPhone || "").trim();
            const lessonYear = String(item?.year || "").trim();
            if (!courseName) return;

            // fuzzy match studio to existing studios list
            const fuzzyMatchStudio = (raw) => {
              if (!raw || !studios?.length) return null;
              const norm = s => String(s || "").toLowerCase().replace(/[\s\-_]/g, "");
              const rawNorm = norm(raw);
              // 1. exact match (case-insensitive)
              let hit = studios.find(s => norm(s.name) === rawNorm);
              if (hit) return hit;
              // 2. one contains the other
              hit = studios.find(s => norm(s.name).includes(rawNorm) || rawNorm.includes(norm(s.name)));
              if (hit) return hit;
              // 3. first significant word match
              const firstWord = raw.split(/\s+/).find(w => w.length > 1)?.toLowerCase();
              if (firstWord) hit = studios.find(s => norm(s.name).includes(firstWord) || firstWord.includes(norm(s.name)));
              return hit || null;
            };
            const matchedStudio = fuzzyMatchStudio(studioNameRaw);

            const groupKey = `${courseName}__${teacher}__${track}`;
            if (!groupedLessons.has(groupKey)) {
              groupedLessons.set(groupKey, {
                id: `lesson_ai_${Date.now()}_${index}`,
                name: courseName,
                instructorName: teacher,
                instructorPhone: itemPhone,
                instructorEmail: itemEmail,
                track,
                description: lessonYear ? `יובא באמצעות ייבוא אקסל חכם (AI) • שנה ${lessonYear}` : "יובא באמצעות ייבוא אקסל חכם (AI)",
                studioId: matchedStudio?.id || null,
                kitId: null,
                created_at: new Date().toISOString(),
                schedule: [],
              });
            } else {
              // enrich email/phone if not yet set
              const g = groupedLessons.get(groupKey);
              if (!g.instructorEmail && itemEmail) g.instructorEmail = itemEmail;
              if (!g.instructorPhone && itemPhone) g.instructorPhone = itemPhone;
              if (!g.studioId && matchedStudio?.id) g.studioId = matchedStudio.id;
            }

            groupedLessons.get(groupKey).schedule.push(normalizeScheduleEntry({
              date: lessonDate,
              startTime,
              endTime,
              topic: sessionTopic || (dayOfWeek ? `יום ${dayOfWeek}` : ""),
            }));
          });

          if (groupedLessons.size === 0) {
            throw new Error("לא נוצרו קורסים תקינים מהפענוח.");
          }

          let addedCount = 0;
          let updatedCount = 0;
          const updatedLessons = [...lessons];
          groupedLessons.forEach((group) => {
            const existingIndex = updatedLessons.findIndex((lesson) => (
              String(lesson?.name || "").trim() === group.name
              && String(lesson?.instructorName || "").trim() === group.instructorName
              && String(lesson?.track || "").trim() === group.track
            ));

            if (existingIndex >= 0) {
              const existing = updatedLessons[existingIndex];
              updatedLessons[existingIndex] = {
                ...existing,
                track: group.track || existing.track || "",
                schedule: dedupeScheduleEntries([...(existing.schedule || []), ...group.schedule]),
              };
              updatedCount += 1;
              return;
            }

            updatedLessons.push({
              ...group,
              schedule: dedupeScheduleEntries(group.schedule),
            });
            addedCount += 1;
          });

          const synced = await syncImportedLecturers(updatedLessons);
          setLessons(synced);
          await storageSet("lessons", synced);
          showToast("success", `פוענחו ${cleanedLessons.length} שיעורים. נוספו ${addedCount} קורסים ועודכנו ${updatedCount} קורסים.`);
        } catch (err) {
          console.error("Error processing Excel:", err);
          showToast("error", `שגיאה בייבוא: ${err?.message || "שגיאה לא ידועה"}`);
        } finally {
          setAiImporting(false);
          if (input) input.value = null;
        }
      };

      reader.onerror = () => {
        console.error("File upload error: failed to read file");
        showToast("error", "שגיאה בקריאת הקובץ.");
        setAiImporting(false);
        if (input) input.value = null;
      };

      reader.readAsArrayBuffer(file);
    } catch (error) {
      console.error("File upload error:", error);
      showToast("error", "שגיאה בהעלאת הקובץ.");
      setAiImporting(false);
      if (input) input.value = null;
    }
  };

  return (
    <div className="page">
      {conflicts.length > 0 && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",zIndex:4000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}}>
          <div style={{width:"100%",maxWidth:520,background:"var(--surface)",borderRadius:16,border:"1px solid rgba(231,76,60,0.5)",direction:"rtl",maxHeight:"80vh",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",background:"rgba(231,76,60,0.08)",borderRadius:"16px 16px 0 0"}}>
              <div style={{fontWeight:900,fontSize:17,color:"var(--red)"}}>⚠️ התנגשות עם קביעות סטודנטים</div>
              <div style={{fontSize:13,color:"var(--text2)",marginTop:4}}>{conflicts.length} קביעות סטודנטים חופפות עם שיעורי הקורס החדש</div>
            </div>
            <div style={{overflowY:"auto",flex:1,padding:"16px 20px",display:"flex",flexDirection:"column",gap:10}}>
              {conflicts.map(({ booking, studioName }, i) => (
                <div key={i} style={{background:"var(--surface2)",borderRadius:10,padding:"12px 14px",border:"1px solid rgba(231,76,60,0.2)"}}>
                  <div style={{fontWeight:800,fontSize:14,marginBottom:6}}>{booking.studentName}</div>
                  <div style={{fontSize:12,color:"var(--text2)"}}><Mic size={16} strokeWidth={1.75} /> {studioName}</div>
                  <div style={{fontSize:12,color:"var(--text2)"}}><Calendar size={16} strokeWidth={1.75} /> {booking.date}</div>
                  <div style={{fontSize:12,color:"var(--text2)",display:"flex",alignItems:"center",gap:4}}><Clock size={12} strokeWidth={1.75}/> {booking.startTime} – {booking.endTime}</div>
                </div>
              ))}
            </div>
            <div style={{padding:"14px 20px",borderTop:"1px solid var(--border)",display:"flex",gap:10,justifyContent:"flex-end",flexWrap:"wrap"}}>
              <button className="btn btn-secondary" disabled={conflictSending}
                onClick={()=>{ setConflicts([]); setPendingLesson(null); }}>
                <X size={16} strokeWidth={1.75} color="var(--text3)" /> בטל שיוך
              </button>
              <button className="btn btn-danger" disabled={conflictSending} onClick={confirmConflictAndSend}>
                {conflictSending ? <><Clock size={16} strokeWidth={1.75} /> שולח...</> : <><CheckCircle size={16} strokeWidth={1.75} /> אשר ושלח מייל</>}
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
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}}>
            <div className="search-bar" style={{flex:1,minWidth:180}}><span><Search size={16} strokeWidth={1.75} color="var(--text3)" /></span>
              <input placeholder="חיפוש קורס או מרצה..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontSize:12,color:"var(--text3)",fontWeight:700}}>מיון:</span>
              {[{val:"recent",label:<><Clock size={11} strokeWidth={1.75}/> קבלה</>},{val:"urgency",label:"⚡ דחיפות"}].map(opt=>(
                <button key={opt.val} type="button" onClick={()=>setSortMode(opt.val)}
                  style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${sortMode===opt.val?"#f5a623":"var(--border)"}`,background:sortMode===opt.val?"rgba(245,166,35,0.14)":"transparent",color:sortMode===opt.val?"#f5a623":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                  {opt.label}
                </button>
              ))}
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
              {/* פילטר זמן — השבוע / החודש */}
              {[
                { val: "all",   label: "הכל" },
                { val: "week",  label: <><Calendar size={16} strokeWidth={1.75} /> השבוע</> },
                { val: "month", label: "🗓️ החודש" },
              ].map(opt => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => setTimeFilter(opt.val)}
                  style={{
                    padding: "5px 13px", borderRadius: 20, fontWeight: 700, fontSize: 12, cursor: "pointer",
                    border: `2px solid ${timeFilter === opt.val ? "#4ade80" : "var(--border)"}`,
                    background: timeFilter === opt.val ? "rgba(74,222,128,0.14)" : "transparent",
                    color: timeFilter === opt.val ? "#4ade80" : "var(--text3)",
                  }}
                >
                  {opt.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => { setArchiveView(v => !v); setSearch(""); setTrackFilter([]); }}
                style={{
                  padding: "6px 14px", borderRadius: 20, fontWeight: 700, fontSize: 13, cursor: "pointer",
                  border: `2px solid ${archiveView ? "#e67e22" : "var(--border)"}`,
                  background: archiveView ? "rgba(230,126,34,0.14)" : "transparent",
                  color: archiveView ? "#e67e22" : "var(--text3)",
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}
              >
                <Package size={16} strokeWidth={1.75} /> ארכיון
                {archivedCount > 0 && (
                  <span style={{ background: archiveView ? "#e67e22" : "rgba(230,126,34,0.25)", color: archiveView ? "#fff" : "#e67e22", borderRadius: 20, padding: "1px 7px", fontSize: 11, fontWeight: 800 }}>
                    {archivedCount}
                  </span>
                )}
              </button>
              <input ref={aiImportInputRef} type="file" accept=".csv,.xlsx,.xls" style={{display:"none"}} onChange={importLessonsSmartAI} disabled={aiImporting}/>
              <button className="btn btn-primary" style={{display:"inline-flex",alignItems:"center",gap:6}} onClick={()=>aiImportInputRef.current?.click()} disabled={aiImporting}>
                {aiImporting ? "מפענח את קובץ האקסל..." : "✨ ייבוא אקסל חכם (AI)"}
              </button>
              <input ref={importInputRef} type="file" accept=".csv,.tsv,.xlsx,.xls" style={{display:"none"}} onChange={importLessonsXL} disabled={xlImporting}/>
              <button className="btn btn-secondary" onClick={()=>importInputRef.current?.click()} disabled={xlImporting}>{xlImporting ? "מייבא..." : "ייבוא XL"}</button>
              <button className="btn btn-primary" onClick={()=>{setMode("add");setEditTarget(null);}}>➕ קורס חדש</button>
            </div>
          </div>

          {allTrackFilters.length > 1 && (
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
              {allTrackFilters.map((trackName) => {
                const active = isTrackSelected(trackName);
                const isUnassigned = trackName === UNASSIGNED_TRACK;
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
                    {trackName === "הכל" ? "כל המסלולים" : trackName}
                  </button>
                );
              })}
            </div>
          )}
          {allTrackFilters.length > 1 && (
            <div style={{fontSize:11,color:"var(--text3)",marginTop:-8,marginBottom:16}}>
              <Lightbulb size={16} strokeWidth={1.75} /> אפשר לבחור כמה מסלולי לימוד יחד כדי להציג אותם במקביל.
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
                  {/* Instructor */}
                  {(detailTarget.instructorName||detailTarget.instructorEmail||detailTarget.instructorPhone) && (
                    <div style={{background:"rgba(155,89,182,0.07)",border:"1px solid rgba(155,89,182,0.2)",borderRadius:10,padding:"12px 14px"}}>
                      <div style={{fontWeight:800,fontSize:12,color:"#9b59b6",marginBottom:8}}>פרטי מרצה</div>
                      {detailTarget.instructorName && <div style={{fontSize:13,fontWeight:700}}>{detailTarget.instructorName}</div>}
                      {detailTarget.instructorPhone && <div style={{fontSize:12,color:"var(--text3)",marginTop:2,display:"flex",alignItems:"center",gap:4}}><Phone size={11} strokeWidth={1.75}/> {detailTarget.instructorPhone}</div>}
                      {detailTarget.instructorEmail && <div style={{fontSize:12,color:"var(--text3)",marginTop:2,display:"flex",alignItems:"center",gap:4}}><Mail size={11} strokeWidth={1.75}/> {detailTarget.instructorEmail}</div>}
                    </div>
                  )}
                  {/* Studio/Kit */}
                  {(studios.find(s=>String(s.id)===String(detailTarget.studioId)) || getLinkedKit(detailTarget)) && (
                    <div style={{background:"rgba(52,152,219,0.07)",border:"1px solid rgba(52,152,219,0.2)",borderRadius:10,padding:"12px 14px"}}>
                      <div style={{fontWeight:800,fontSize:12,color:"#3498db",marginBottom:8,display:"flex",alignItems:"center",gap:4}}><Link size={12} strokeWidth={1.75}/> שיוכים</div>
                      {studios.find(s=>String(s.id)===String(detailTarget.studioId)) && <div style={{fontSize:13}}><Mic size={16} strokeWidth={1.75} /> {studios.find(s=>String(s.id)===String(detailTarget.studioId)).name}</div>}
                      {getLinkedKit(detailTarget) && <div style={{fontSize:13,marginTop:4,display:"flex",alignItems:"center",gap:4}}><Package size={13} strokeWidth={1.75}/> {getLinkedKit(detailTarget).name}</div>}
                    </div>
                  )}
                  {/* Sessions */}
                  <div style={{background:"rgba(46,204,113,0.06)",border:"1px solid rgba(46,204,113,0.2)",borderRadius:10,padding:"12px 14px"}}>
                    <div style={{fontWeight:800,fontSize:12,color:"var(--green)",marginBottom:8}}><Calendar size={16} strokeWidth={1.75} /> מפגשים ({(detailTarget.schedule||[]).length})</div>
                    {(detailTarget.schedule||[]).length === 0
                      ? <div style={{fontSize:12,color:"var(--text3)"}}>אין מפגשים רשומים</div>
                      : <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:300,overflowY:"auto"}}>
                          {[...(detailTarget.schedule||[])].sort((a,b)=>a.date.localeCompare(b.date)).map((s,i)=>{
                            const isPast = s.date < today();
                            return (
                              <div key={i} style={{display:"flex",gap:8,alignItems:"center",padding:"6px 10px",borderRadius:8,background:isPast?"rgba(0,0,0,0.1)":"rgba(46,204,113,0.07)",opacity:isPast?0.55:1}}>
                                <span style={{fontSize:12,fontWeight:700,minWidth:90}}>{s.date}</span>
                                {s.startTime && <span style={{fontSize:12,color:"var(--text3)"}}>{s.startTime}{s.endTime?`–${s.endTime}`:""}</span>}
                                {s.topic && <span style={{fontSize:12,color:"var(--text2)",flex:1}}>· {s.topic}</span>}
                                {isPast && <span style={{fontSize:10,color:"var(--text3)"}}>עבר</span>}
                              </div>
                            );
                          })}
                        </div>
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

          {sortedFiltered.length===0
            ? <div className="empty-state"><div className="emoji"><Package size={32} strokeWidth={1.75} /></div><div>{archiveView ? "אין קורסים בארכיון" : lessons.length===0 ? "אין קורסים עדיין" : "לא נמצאו קורסים למסלולים שנבחרו"}</div><div style={{fontSize:13,color:"var(--text3)"}}>{archiveView ? "קורסים עוברים לארכיון אוטומטית כשמפגשם האחרון מסתיים" : lessons.length===0 ? 'לחץ "➕ קורס חדש" כדי להתחיל' : "נסה לשנות חיפוש או מסלולי לימוד"}</div></div>
            : <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {Object.entries(groupedLessons)
                  .sort(([left], [right]) => left.localeCompare(right, "he"))
                  .map(([trackName, trackLessons]) => (
                    <div key={trackName} style={{display:"flex",flexDirection:"column",gap:10,background:trackName===UNASSIGNED_TRACK?"rgba(239,68,68,0.04)":"rgba(245,166,35,0.04)",border:`1px solid ${trackName===UNASSIGNED_TRACK?"rgba(239,68,68,0.18)":"rgba(245,166,35,0.18)"}`,borderRadius:14,padding:"14px 16px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                        <span style={{fontWeight:900,fontSize:15,color:trackName===UNASSIGNED_TRACK?"#ef4444":"#f5a623"}}>{trackName===UNASSIGNED_TRACK?"⚠️":<GraduationCap size={16} strokeWidth={1.75} />} {trackName}</span>
                        <span style={{background:trackName===UNASSIGNED_TRACK?"rgba(239,68,68,0.16)":"rgba(245,166,35,0.16)",color:trackName===UNASSIGNED_TRACK?"#ef4444":"#f5a623",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:800}}>{trackLessons.length} קורסים</span>
                      </div>
                      {trackLessons.map(l=>{
                        const studio = studios.find(s=>String(s.id)===String(l.studioId));
                        const kit = getLinkedKit(l);
                        const upcoming = (l.schedule||[]).filter(s=>s.date>=today()).length;
                        const nextSession = (l.schedule||[]).filter(s=>s.date>=today()).sort((a,b)=>a.date.localeCompare(b.date))[0];
                        return (
                          <div key={l.id}
                            onClick={()=>setDetailTarget(l)}
                            style={{background:"var(--surface2)",borderRadius:10,padding:"14px 16px",border:"1px solid var(--border)",borderRight:"4px solid #9b59b6",cursor:"pointer",transition:"border-color 0.15s"}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,flexWrap:"wrap"}}>
                              <div style={{flex:1,minWidth:200}}>
                                <div style={{fontWeight:800,fontSize:16,marginBottom:4}}>{l.name}</div>
                                {l.instructorName && <div style={{fontSize:13,color:"var(--text2)"}}>{l.instructorName}</div>}
                                {nextSession && <div style={{fontSize:12,color:"var(--green)",marginTop:2}}><Calendar size={16} strokeWidth={1.75} /> מפגש קרוב: {nextSession.date}{nextSession.startTime?` · ${nextSession.startTime}`:""}</div>}
                                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
                                  <span style={{background:"rgba(155,89,182,0.12)",color:"#9b59b6",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}><Calendar size={16} strokeWidth={1.75} /> {(l.schedule||[]).length} שיעורים</span>
                                  {upcoming>0 && <span style={{background:"rgba(46,204,113,0.12)",color:"var(--green)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700,display:"inline-flex",alignItems:"center",gap:3}}><CheckCircle size={10} strokeWidth={1.75}/> {upcoming} קרובים</span>}
                                  {studio && <span style={{background:"rgba(52,152,219,0.12)",color:"var(--blue)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}><Mic size={16} strokeWidth={1.75} /> {studio.name}</span>}
                                  {kit && <span style={{background:"rgba(245,166,35,0.12)",color:"var(--accent)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700,display:"inline-flex",alignItems:"center",gap:3}}><Package size={11} strokeWidth={1.75}/> {kit.name}</span>}
                                </div>
                              </div>
                              <div style={{display:"flex",gap:6}} onClick={e=>e.stopPropagation()}>
                                <button className="btn btn-secondary btn-sm" onClick={()=>{setEditTarget(l);setMode("edit");}} style={{display:"inline-flex",alignItems:"center",gap:4}}><Pencil size={12} strokeWidth={1.75} color="var(--text3)"/> עריכה</button>
                                <button className="btn btn-secondary btn-sm" style={{color:"var(--red)",borderColor:"var(--red)"}} onClick={()=>del(l.id)}>🗑️ מחק</button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
              </div>
          }
        </>
      )}
    </div>
  );
}

// ── Lesson/Course Form ────────────────────────────────────────────────────────
function LessonForm({ initial, onSave, onCancel, studios, equipment, reservations, setReservations, kits, showToast, trackOptions=[], lecturers=[], setLecturers, certifications={}, siteSettings={} }) {
  const lecturerOptions = lecturers.filter((lecturer) => lecturer?.isActive !== false);
  const [name, setName]                       = useState(initial?.name||"");
  const [track, setTrack]                     = useState(initial?.track||"");
  const initLecturerId = initial?.lecturerId || (initial?.instructorName ? (lecturers.find(l => l.fullName.trim().toLowerCase() === String(initial.instructorName||"").trim().toLowerCase())?.id || "") : "");
  const [lecturerId, setLecturerId]           = useState(initLecturerId);
  const initLecturerName = initLecturerId ? (lecturers.find(l => l.id === initLecturerId)?.fullName || initial?.instructorName || "") : (initial?.instructorName || "");
  const [lecturerInput, setLecturerInput]     = useState(initLecturerName);
  const [description, setDescription]         = useState(initial?.description||"");
  const [studioId, setStudioId]               = useState(initial?.studioId||"");
  const [schedule, setSchedule]               = useState((initial?.schedule||[]).map(normalizeScheduleEntry));
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
  const lecturerSelectionInvalid = Boolean(String(lecturerInput || "").trim()) && !selectedLecturerObj;

  // Manual schedule builder
  const [manStartDate, setManStartDate] = useState("");
  const [manStartTime, setManStartTime] = useState("10:00");
  const [manEndTime, setManEndTime]     = useState("13:00");
  const [manCount, setManCount]         = useState(1);

  // Resizable columns: [#, date, start, end, topic, studio, ×]
  const [colWidths, setColWidths] = useState([30, 130, 72, 72, 180, 90, 28]);
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
  const gridTemplate = colWidths.map(w => `${w}px`).join(" ");

  const LESSON_TIMES = LESSON_TIME_OPTIONS;

  const buildAndAppendSchedule = () => {
    if(!manStartDate) { setLocalMsg({type:"error",text:"יש לבחור תאריך"}); return; }
    const count = Math.max(1, Math.min(52, Number(manCount)||1));
    const sessions = [];
    let d = parseLocalDate(manStartDate);
    for(let i=0;i<count;i++) {
      sessions.push({ date: formatLocalDateInput(d), startTime: manStartTime, endTime: manEndTime, topic: "", studioId: studioId||null });
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
    setSchedule(prev=>dedupeScheduleEntries([...prev, {
      date: formatLocalDateInput(nextDateObj),
      startTime: firstLesson.startTime||"09:00",
      endTime: firstLesson.endTime||"12:00",
      topic: "",
      studioId: studioId||null,
    }]));
  };

  const updateSessionField = (index, field, value) => {
    setSchedule(prev => {
      const updated = prev.map((session, sessionIndex) => (
        sessionIndex === index
          ? { ...session, [field]: (field === "topic" || field === "studioId") ? value : value || (field === "date" ? "" : session[field]) }
          : session
      ));
      return field === "date" ? sortScheduleEntries(updated) : updated;
    });
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
      setLocalMsg({type:"error",text:'לא ניתן לשמור שם מרצה שאינו קיים. בחרו מרצה קיים מרובריקת "מרצים", או הוסיפו אותו קודם שם. בייבוא XL מרצים חדשים נוצרים אוטומטית.'});
      return;
    }
    let finalSchedule = [...schedule];
    if(manStartDate && finalSchedule.length===0) {
      const count = Math.max(1,Math.min(52,Number(manCount)||1));
      let d = parseLocalDate(manStartDate);
      for(let i=0;i<count;i++) {
        finalSchedule.push({date:formatLocalDateInput(d),startTime:manStartTime,endTime:manEndTime,topic:""});
        d.setDate(d.getDate()+7);
      }
    }
    finalSchedule = dedupeScheduleEntries(finalSchedule.map(normalizeScheduleEntry));
    const invalidSession = finalSchedule.find(session => !session.date || session.startTime >= session.endTime);
    if(invalidSession) { setLocalMsg({type:"error",text:"יש לתקן תאריך או שעות לא תקינים בלוח השיעורים"}); return; }
    setSaving(true);
    const selectedLecturer = lecturerId ? lecturers.find(l => l.id === lecturerId) : null;
    const lesson = {
      id: initial?.id||`lesson_${Date.now()}`,
      name: name.trim(),
      track: track.trim(),
      lecturerId: lecturerId || null,
      instructorName: selectedLecturer?.fullName || "",
      instructorPhone: selectedLecturer?.phone || "",
      instructorEmail: selectedLecturer?.email || "",
      description: description.trim(),
      studioId: studioId||null,
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

  return (
    <div className="card" style={{marginBottom:20}}>
      <div className="card-header">
        <div className="card-title" style={{display:"flex",alignItems:"center",gap:6}}><Video size={15} strokeWidth={1.75}/> {initial?"עריכת קורס":"קורס חדש"}</div>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}><X size={16} strokeWidth={1.75} color="var(--text3)" /> ביטול</button>
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

      {/* Schedule builder — FIRST */}
      <div style={{background:"rgba(155,89,182,0.06)",border:"1px solid rgba(155,89,182,0.2)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16}}>
        <div style={{fontWeight:800,fontSize:13,color:"#9b59b6",marginBottom:12}}><Calendar size={16} strokeWidth={1.75} /> לוח שיעורים</div>
        <div style={{fontSize:12,color:"var(--text3)",marginBottom:10}}>הוספת מפגשים ידנית נשארת כאן. ייבוא XL עבר לראש דף "שיעורים" כדי לאפשר העלאה מהירה של כמה קורסים במקביל.</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end",marginBottom:12}}>
          <div className="form-group" style={{flex:"1 1 130px",minWidth:120}}>
            <label className="form-label">תאריך התחלה</label>
            <input className="form-input" type="date" value={manStartDate} onChange={e=>setManStartDate(e.target.value)}/>
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
          <button className="btn btn-primary" style={{background:"#9b59b6",borderColor:"#9b59b6",whiteSpace:"nowrap"}} onClick={buildAndAppendSchedule}>➕ הוסף</button>
        </div>

        {schedule.length>0 && (
          <div style={{marginBottom:16}}>
            <div style={{fontWeight:700,fontSize:12,color:"#9b59b6",marginBottom:4}}><Calendar size={16} strokeWidth={1.75} /> {schedule.length} שיעורים בלוח:</div>

            {isMobile ? (
              /* ── מובייל: כרטיס לכל מפגש ── */
              <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:420,overflowY:"auto"}}>
                {schedule.map((s,i)=>(
                  <div key={s._key || `${s.date}-${s.startTime}-${i}`} style={{background:"var(--surface2)",border:"1px solid rgba(155,89,182,0.2)",borderRadius:10,padding:"10px 12px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <span style={{fontWeight:800,color:"#9b59b6",fontSize:12}}>#{i+1}</span>
                      <button onClick={()=>setSchedule(prev=>prev.filter((_,j)=>j!==i))}
                        style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:20,padding:0,lineHeight:1}}>×</button>
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:6}}>
                      <div style={{flex:"1 1 130px"}}>
                        <div style={{fontSize:11,color:"var(--text3)",marginBottom:2}}>תאריך</div>
                        <input className="form-input" type="date" value={s.date} style={{fontSize:13,padding:"4px 6px",height:32,width:"100%",boxSizing:"border-box"}} onChange={e=>updateSessionField(i,"date",e.target.value)}/>
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
                    <div style={{display:"flex",gap:8}}>
                      <div style={{flex:1}}>
                        <div style={{fontSize:11,color:"var(--text3)",marginBottom:2}}>🏫 כיתה</div>
                        <select className="form-select" value={s.studioId||""} style={{fontSize:12,padding:"4px 6px",height:32,width:"100%",boxSizing:"border-box"}} onChange={e=>updateSessionField(i,"studioId",e.target.value||null)}>
                          <option value="">ללא</option>
                          {studios.filter(st=>st.isClassroom||st.classroomOnly).map(st=><option key={st.id} value={st.id}>{st.name}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* ── דסקטופ: grid עם עמודות גמישות ── */
              <>
                <div style={{display:"grid",gridTemplateColumns:gridTemplate,gap:0,fontSize:11,color:"var(--text-muted)",marginBottom:2,userSelect:"none",background:"var(--surface2)",borderRadius:"6px 6px 0 0",border:"1px solid rgba(155,89,182,0.2)"}}>
                  {["","תאריך","התחלה","סיום","נושא","כיתה",""].map((label,ci)=>(
                    <div key={ci} style={{position:"relative",padding:"4px 8px",overflow:"hidden",whiteSpace:"nowrap",
                      borderRight: ci < 6 ? "1px solid rgba(155,89,182,0.25)" : "none",
                      fontWeight:700, textAlign: ci===0||ci===6 ? "center" : "right"}}>
                      {label}
                      {ci > 0 && ci < 6 && (
                        <div onMouseDown={e=>{ e.preventDefault(); startColResize(e,ci); }}
                          style={{position:"absolute",left:0,top:0,width:8,height:"100%",cursor:"col-resize",zIndex:2}}/>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{maxHeight:300,overflow:"auto",display:"flex",flexDirection:"column",gap:2}}>
                  {schedule.map((s,i)=>(
                    <div key={s._key || `${s.date}-${s.startTime}-${i}`} style={{display:"grid",gridTemplateColumns:gridTemplate,alignItems:"center",gap:0,fontSize:12,background:"var(--surface2)",border:"1px solid rgba(155,89,182,0.12)",borderTop:"none"}}>
                      <div style={{fontWeight:800,color:"#9b59b6",fontSize:11,textAlign:"center",padding:"4px 2px",borderRight:"1px solid rgba(155,89,182,0.15)"}}>#{i+1}</div>
                      <input className="form-input" type="date" value={s.date} style={{padding:"3px 6px",fontSize:12,height:28,width:"100%",boxSizing:"border-box"}} onChange={e=>updateSessionField(i,"date",e.target.value)}/>
                      <select className="form-select" value={s.startTime} style={{padding:"3px 4px",fontSize:12,height:28,width:"100%",boxSizing:"border-box"}} onChange={e=>updateSessionField(i,"startTime",e.target.value)}>
                        {LESSON_TIMES.map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                      <select className="form-select" value={s.endTime} style={{padding:"3px 4px",fontSize:12,height:28,width:"100%",boxSizing:"border-box"}} onChange={e=>updateSessionField(i,"endTime",e.target.value)}>
                        {LESSON_TIMES.map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                      <input className="form-input" placeholder="אופציונלי" value={s.topic||""} style={{padding:"3px 6px",fontSize:12,height:28,width:"100%",boxSizing:"border-box"}} onChange={e=>updateSessionField(i,"topic",e.target.value)}/>
                      <select className="form-select" value={s.studioId||""} style={{padding:"3px 4px",fontSize:11,height:28,width:"100%",boxSizing:"border-box"}} title="כיתת לימוד למפגש זה" onChange={e=>updateSessionField(i,"studioId",e.target.value||null)}>
                        <option value="">ללא שיוך</option>
                        {studios.filter(st=>st.isClassroom||st.classroomOnly).map(st=><option key={st.id} value={st.id}>{st.name}</option>)}
                      </select>
                      <div style={{display:"flex",justifyContent:"center",borderRight:"none",background:"rgba(255,80,80,0.04)"}}>
                        <button onClick={()=>setSchedule(prev=>prev.filter((_,j)=>j!==i))}
                          style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:16,padding:0,lineHeight:1,width:"100%",height:28}} title="מחק מפגש">×</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div style={{display:"flex",gap:6,marginTop:8}}>
              <button className="btn btn-secondary btn-sm" onClick={appendLessonFromExisting}>➕ שיעור נוסף</button>
              <button className="btn btn-secondary btn-sm" style={{color:"var(--red)",borderColor:"var(--red)"}} onClick={()=>setSchedule([])}>🗑️ נקה הכל</button>
            </div>
          </div>
        )}
      </div>

      {/* Course & Instructor details */}
      <div style={{background:"rgba(155,89,182,0.06)",border:"1px solid rgba(155,89,182,0.2)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16}}>
        <div style={{fontWeight:800,fontSize:13,color:"#9b59b6",marginBottom:12}}>פרטי הקורס והמרצה</div>
        <div className="form-group" style={{marginBottom:10}}>
          <label className="form-label">שם הקורס *</label>
          <input className="form-input" placeholder='לדוגמה: "חדר טלוויזיה א"' value={name} onChange={e=>setName(e.target.value)}/>
        </div>
        <div className="form-group" style={{marginBottom:10}}>
          <label className="form-label">מרצה</label>
          <datalist id="lf-lecturers-list">
            {lecturerOptions.sort((a,b)=>a.fullName.localeCompare(b.fullName,"he")).map(l=>(
              <option key={l.id} value={l.fullName}/>
            ))}
          </datalist>
          <div style={{position:"relative"}}>
            <input className="form-input" list="lf-lecturers-list"
              style={lecturerSelectionInvalid ? { borderColor:"#ef4444", boxShadow:"0 0 0 1px rgba(239,68,68,0.18)" } : undefined}
              placeholder="הקלד שם מרצה..."
              value={lecturerInput}
              onChange={e=>{
                const val = e.target.value;
                setLecturerInput(val);
                const matched = lecturerOptions.find(l=>l.fullName.trim().toLowerCase()===val.trim().toLowerCase());
                setLecturerId(matched ? matched.id : "");
              }}
            />
            {lecturerInput && (
              <button type="button" onClick={()=>{setLecturerInput("");setLecturerId("");}}
                style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:16,lineHeight:1,padding:0}}><X size={16} strokeWidth={1.75} color="var(--text3)" /></button>
            )}
          </div>
          <div style={{fontSize:11,color:"var(--text3)",marginTop:3}}>
            ניתן לבחור כאן רק מרצה שכבר קיים ברובריקת "מרצים". אם זה מרצה חדש, צריך להוסיף אותו קודם שם. בייבוא XL מרצים חדשים נוצרים אוטומטית.
          </div>
          {lecturerSelectionInvalid && (
            <div style={{fontSize:11,color:"#ef4444",marginTop:3}}>
              השם שהוקלד לא קיים ברובריקת "מרצים", ולכן אי אפשר לשמור כך את הקורס.
            </div>
          )}
          {lecturerId && <div style={{fontSize:11,color:"#22c55e",marginTop:3}}><Check size={16} strokeWidth={1.75} /> מקושר למרצה קיים</div>}
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

      {/* Link to studio (optional) */}
      <div style={{background:"rgba(52,152,219,0.06)",border:"1px solid rgba(52,152,219,0.2)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16}}>
        <div style={{fontWeight:800,fontSize:13,color:"#3498db",marginBottom:10,display:"flex",alignItems:"center",gap:6}}><Link size={13} strokeWidth={1.75}/> שיוך (אופציונלי)</div>
        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">שיוך לכיתת לימוד</label>
            <select className="form-select" value={studioId} onChange={e=>{
              setStudioId(e.target.value);
              setSchedule(prev=>prev.map(s=>({...s, studioId: e.target.value||null})));
            }}>
              <option value="">ללא שיוך</option>
              {studios.filter(s => s.isClassroom || s.classroomOnly || String(s.id) === String(studioId)).map(s=>(
                <option key={s.id} value={s.id}>{s.name}{(!s.isClassroom && !s.classroomOnly) ? " (לא מסומן ככיתה)" : ""}</option>
              ))}
            </select>
            {studios.filter(s=>s.isClassroom||s.classroomOnly).length === 0 && (
              <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}><Lightbulb size={16} strokeWidth={1.75} /> סמן חדר כ"כיתת לימוד" ברובריקת חדרים כדי שיופיע כאן.</div>
            )}
          </div>
        </div>
      </div>

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
