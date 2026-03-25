import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { Toast, Modal, Loading, statusBadge } from "./components/ui.jsx";
import { CalendarGrid } from "./components/CalendarGrid.jsx";
import { EditReservationModal } from "./components/EditReservationModal.jsx";
import { ReservationsPage } from "./components/ReservationsPage.jsx";
import { DashboardPage } from "./components/DashboardPage.jsx";
import StudioBookingPage from "./components/StudioBookingPage.jsx";
import { StudentsPage } from "./components/StudentsPage.jsx";
import { CertificationsPage } from "./components/CertificationsPage.jsx";
import { PublicForm } from "./components/PublicForm.jsx";
import { LessonsPage } from "./components/LessonsPage.jsx";
import SmartEquipmentImportButton from "./components/SmartEquipmentImportButton.jsx";

// ─── SUPABASE STORAGE ─────────────────────────────────────────────────────────
// v3.1
const SB_URL = "https://wxkyqgwwraojnbmyyfco.supabase.co";
const SB_KEY = "sb_publishable_n-mkSq7xABjj58ZBBwk6BA_RbpVS2SU";
const SB_HEADERS = {
  "apikey":        SB_KEY,
  "Authorization": `Bearer ${SB_KEY}`,
  "Content-Type":  "application/json",
};

function lsGet(key) {
  try { const v = localStorage.getItem(`cache_${key}`); return v ? JSON.parse(v) : null; } catch { return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(`cache_${key}`, JSON.stringify(value)); } catch {}
}
function lsRemove(key) {
  try { localStorage.removeItem(`cache_${key}`); } catch {}
}
function restoreCacheValue(key, value) {
  if (value === null || value === undefined) {
    lsRemove(key);
    return;
  }
  lsSet(key, value);
}

// storageGet returns { value, source }
//   source: "supabase" — row found in DB
//   source: "supabase_empty" — DB responded OK but key doesn't exist (first-time)
//   source: "cache" — network/fetch failed, fell back to localStorage
async function storageGet(key) {
  try {
    const res  = await fetch(`${SB_URL}/rest/v1/store?key=eq.${key}&select=data`, { headers: SB_HEADERS });
    if (!res.ok) {
      console.warn("storageGet HTTP error", key, res.status);
      return { value: lsGet(key), source: "cache" };
    }
    const json = await res.json();
    if (Array.isArray(json) && json.length > 0) {
      lsSet(key, json[0].data);
      return { value: json[0].data, source: "supabase" };
    }
    // DB responded OK but no row — this is a genuine first-time setup
    return { value: null, source: "supabase_empty" };
  } catch(e) {
    console.warn("storageGet error", key, e);
    return { value: lsGet(key), source: "cache" };
  }
}

// ─── SUPABASE KEEP-ALIVE PING ─────────────────────────────────────────────────
// מונע כניסה ל-pause אחרי 7 ימי חוסר שימוש
async function keepAlive() {
  try {
    const lastPing = localStorage.getItem("sb_last_ping");
    const now = Date.now();
    const FOUR_DAYS = 4 * 24 * 60 * 60 * 1000;
    if (lastPing && now - Number(lastPing) < FOUR_DAYS) return;
    await fetch(`${SB_URL}/rest/v1/store?key=eq.equipment&select=key`, { headers: SB_HEADERS });
    localStorage.setItem("sb_last_ping", String(now));
    console.log("Supabase keep-alive ping sent");
  } catch(e) { /* silent */ }
}
setTimeout(keepAlive, 3000); // רץ 3 שניות אחרי טעינת הדף

const BACKUP_KEYS = new Set(["equipment","reservations","teamMembers","kits","certifications"]);
const BACKUP_COOLDOWN = 60 * 60 * 1000; // max once per hour per key

async function autoBackup(key) {
  if (!BACKUP_KEYS.has(key)) return;
  const lastKey = `backup_last_${key}`;
  const last = Number(localStorage.getItem(lastKey) || 0);
  if (Date.now() - last < BACKUP_COOLDOWN) return;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/store?key=eq.${key}&select=data`, { headers: SB_HEADERS });
    const json = await r.json();
    if (Array.isArray(json) && json.length > 0 && json[0].data) {
      const old = json[0].data;
      if (Array.isArray(old) && old.length > 0) {
        await fetch(`${SB_URL}/rest/v1/store`, {
          method: "POST",
          headers: { ...SB_HEADERS, "Prefer": "resolution=merge-duplicates" },
          body: JSON.stringify({ key: `backup_${key}`, data: old, updated_at: new Date().toISOString() }),
        });
        localStorage.setItem(lastKey, String(Date.now()));
        console.log(`🔒 Backup saved: backup_${key} (${old.length} items)`);
      }
    }
  } catch(e) { /* silent — don't block the actual write */ }
}

async function storageSet(key, value) {
  const previousCachedValue = lsGet(key);
  lsSet(key, value); // cache immediately
  try {
    await autoBackup(key);
    const res = await fetch(`${SB_URL}/rest/v1/store`, {
      method:  "POST",
      headers: { ...SB_HEADERS, "Prefer": "resolution=merge-duplicates" },
      body:    JSON.stringify({ key, data: value, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("storageSet error", key, err);
      restoreCacheValue(key, previousCachedValue);
      return { ok: false, error: err };
    }
    return { ok: true };
  } catch(e) {
    console.error("storageSet network error", key, e);
    restoreCacheValue(key, previousCachedValue);
    return { ok: false, error: e.message };
  }
}

// ─── DB DIAGNOSTICS (accessible from browser console) ────────────────────────
window.dbDiag = async () => {
  const keys = ["equipment","reservations","categories","categoryTypes","categoryLoanTypes","teamMembers","kits","policies","certifications","deptHeads","calendarToken","collegeManager","managerToken","siteSettings"];
  console.log("🔍 Supabase DB Diagnostic Report");
  console.log("=".repeat(50));
  for (const key of keys) {
    try {
      const res = await fetch(`${SB_URL}/rest/v1/store?key=eq.${key}&select=data,updated_at`, { headers: SB_HEADERS });
      const json = await res.json();
      if (json.length > 0) {
        const d = json[0].data;
        const count = Array.isArray(d) ? d.length : (typeof d === "object" ? Object.keys(d).length : 1);
        const units = key === "equipment" && Array.isArray(d) ? d.reduce((s,e) => s + (Array.isArray(e.units) ? e.units.length : (e.quantity||0)), 0) : "";
        console.log(`✅ ${key}: ${count} items${units ? ` (${units} units)` : ""} — updated: ${json[0].updated_at}`);
      } else {
        console.log(`⚠️ ${key}: EMPTY (not in DB)`);
      }
    } catch(e) { console.log(`❌ ${key}: ERROR — ${e.message}`); }
  }
};
window.dbExport = async () => {
  const keys = ["equipment","reservations","teamMembers","kits","certifications"];
  const data = {};
  for (const key of keys) {
    try {
      const res = await fetch(`${SB_URL}/rest/v1/store?key=eq.${key}&select=data`, { headers: SB_HEADERS });
      const json = await res.json();
      data[key] = json.length > 0 ? json[0].data : null;
    } catch(e) { data[key] = `ERROR: ${e.message}`; }
  }
  console.log("📦 Full DB Export (copy this JSON):");
  console.log(JSON.stringify(data, null, 2));
  return data;
};
window.dbImport = async (data) => {
  if (!data || typeof data !== "object") { console.error("Usage: dbImport({equipment:[...], reservations:[...]})"); return; }
  for (const [key, value] of Object.entries(data)) {
    if (value == null) continue;
    const r = await storageSet(key, value);
    console.log(r.ok ? `✅ ${key} restored` : `❌ ${key} failed: ${r.error}`);
  }
  console.log("🔄 Reload the page to see changes");
};
window.dbBackups = async () => {
  const keys = ["equipment","reservations","teamMembers","kits","certifications"];
  console.log("🔒 Backup Status:");
  for (const key of keys) {
    try {
      const res = await fetch(`${SB_URL}/rest/v1/store?key=eq.backup_${key}&select=data,updated_at`, { headers: SB_HEADERS });
      const json = await res.json();
      if (json.length > 0) {
        const d = json[0].data;
        const count = Array.isArray(d) ? d.length : 0;
        console.log(`✅ backup_${key}: ${count} items — saved: ${json[0].updated_at}`);
      } else {
        console.log(`⚠️ backup_${key}: no backup yet`);
      }
    } catch(e) { console.log(`❌ backup_${key}: ERROR`); }
  }
};
window.dbRestoreFromBackup = async (key) => {
  if (!key) { console.error("Usage: dbRestoreFromBackup('equipment')"); return; }
  const res = await fetch(`${SB_URL}/rest/v1/store?key=eq.backup_${key}&select=data`, { headers: SB_HEADERS });
  const json = await res.json();
  if (!json.length || !json[0].data) { console.error(`No backup found for ${key}`); return; }
  const r = await storageSet(key, json[0].data);
  console.log(r.ok ? `✅ ${key} restored from backup (${json[0].data.length} items)` : `❌ Failed: ${r.error}`);
  console.log("🔄 Reload the page to see changes");
};

// ─── INITIAL DATA ─────────────────────────────────────────────────────────────
const INITIAL_EQUIPMENT = [
  { id:1, name:"מצלמת Sony A7 III",      category:"מצלמות",      description:"מצלמת מירורלס מקצועית 24MP", total_quantity:5, image:"📷", notes:"לכלול כרטיסי זיכרון", status:"תקין" },
  { id:2, name:"מצלמת Canon EOS R5",     category:"מצלמות",      description:"מצלמת מירורלס 45MP",         total_quantity:3, image:"📷", notes:"",                    status:"תקין" },
  { id:3, name:"עדשת 50mm f/1.8",        category:"עדשות",       description:"עדשת פורטרט קלאסית",         total_quantity:6, image:"🔭", notes:"",                    status:"תקין" },
  { id:4, name:"עדשת 24-70mm f/2.8",     category:"עדשות",       description:"עדשת זום מקצועית",           total_quantity:4, image:"🔭", notes:"לשמור נקי",           status:"תקין" },
  { id:5, name:"מיקרופון Rode NTG3",     category:"מיקרופונים",  description:"מיקרופון שוטגאן",            total_quantity:8, image:"🎙️",notes:"",                    status:"תקין" },
  { id:6, name:"מיקרופון DJI Mic 2",     category:"מיקרופונים",  description:"מיקרופון לבלבי אלחוטי",      total_quantity:10,image:"🎙️",notes:"",                    status:"תקין" },
  { id:7, name:"מקליט Zoom H6",          category:"מקליטי אודיו",description:"מקליט שדה 6 ערוצים",         total_quantity:4, image:"🎚️",notes:"לכלול סוללות",        status:"תקין" },
  { id:8, name:"תאורת LED Aputure 120D", category:"תאורה",       description:"תאורת LED חזקה 120W",         total_quantity:6, image:"💡", notes:"",                    status:"תקין" },
  { id:9, name:"חצובה Manfrotto 504",    category:"חצובות",      description:"חצובה וידאו מקצועית",        total_quantity:7, image:"📐", notes:"",                    status:"תקין" },
  { id:10,name:"כרטיס זיכרון 128GB",     category:"אביזרים",     description:"כרטיס SD V60 UHS-II",         total_quantity:15,image:"💾", notes:"",                    status:"תקין" },
];

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const DEFAULT_CATEGORIES = ["מצלמות","עדשות","מיקרופונים","מקליטי אודיו","תאורה","חצובות","אביזרים"];
const SOUND_CATEGORIES = ["מיקרופונים","מקליטי אודיו","כבלים"];
const STATUSES    = ["תקין","פגום","בתיקון","נעלם"];
const PHOTO_CATEGORIES = ["מצלמות","עדשות","תאורה","חצובות","אביזרים","אביזרי צילום","מייצבי מצלמה","גימבלים","רחפנים","מוניטורים"];
const RESEND_API_KEY = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_RESEND_KEY : "";
const ADMIN_NAV_PAGES = ["dashboard","reservations","equipment","certifications","studios","lessons","kits","team","students","policies","settings"];
const NIMROD_PHONE     = "972521234567"; // ← החלף במספר של נמרוד
const EMAIL_TYPO_DOMAINS = ["gmai.com","gmial.com","gmail.co","gamil.com","gmaill.com","yahooo.com","yahho.com","outlok.com","hotmai.com","outllook.com"];
const TERMS = `הסטודנט מתחייב להחזיר את הציוד במועד שנקבע ובמצב תקין.
אחריות על נזק לציוד תחול על הסטודנט.
במקרה של אובדן, יחויב הסטודנט בעלות החלפת הציוד.
יש להשתמש בציוד לצרכי לימוד בלבד.`;

// ─── UTILS ────────────────────────────────────────────────────────────────────
function formatDate(d) {
  if (!d) return "";
  return parseLocalDate(d).toLocaleDateString("he-IL", { day:"2-digit", month:"2-digit", year:"numeric" });
}

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function getLoanDurationDays(borrowDate, returnDate) {
  const start = parseLocalDate(borrowDate);
  const end = parseLocalDate(returnDate);
  if (!start || !end) return 0;
  return Math.max(0, Math.ceil((end - start) / 86400000) + 1);
}

function getPrivateLoanLimitedQty(items = [], equipment = []) {
  return (items || []).reduce((sum, item) => {
    const eq = (equipment || []).find((entry) => entry.id == item.equipment_id);
    if (eq?.privateLoanUnlimited) return sum;
    return sum + (Number(item.quantity) || 0);
  }, 0);
}

function normalizeReservationStatus(status) {
  return status === "ממתין לאישור ראש המחלקה" ? "אישור ראש מחלקה" : status;
}

function getNextSoundDayLoanDate(slots = []) {
  const now = new Date();
  const hasFutureSlotToday = slots.some((slot) => {
    const [h, m] = String(slot || "00:00").split(":").map(Number);
    const slotDate = new Date(now);
    slotDate.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
    return slotDate.getTime() > now.getTime();
  });
  const target = new Date(now);
  if (!hasFutureSlotToday) target.setDate(target.getDate() + 1);
  while (target.getDay() === 5 || target.getDay() === 6) {
    target.setDate(target.getDate() + 1);
  }
  return formatLocalDateInput(target);
}

function getFutureTimeSlotsForDate(dateStr, slots = []) {
  if (!dateStr) return slots;
  const targetDate = parseLocalDate(dateStr);
  if (!targetDate) return slots;
  const now = new Date();
  const sameDayAsNow = formatLocalDateInput(now) === dateStr;
  return slots.filter((slot) => {
    if (!sameDayAsNow) return true;
    const [h, m] = String(slot || "00:00").split(":").map(Number);
    const slotDate = new Date(targetDate);
    slotDate.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
    return slotDate.getTime() > now.getTime();
  });
}

function normalizeEquipmentTagFlags(list = []) {
  return (list || []).map((item) => {
    if (!item || typeof item !== "object") return item;
    const normalized = { ...item };
    if (typeof normalized.soundOnly !== "boolean") {
      normalized.soundOnly = SOUND_CATEGORIES.includes(normalized.category);
    }
    if (typeof normalized.photoOnly !== "boolean") {
      normalized.photoOnly = PHOTO_CATEGORIES.includes(normalized.category);
    }
    if (typeof normalized.privateLoanUnlimited !== "boolean") {
      normalized.privateLoanUnlimited = false;
    }
    return normalized;
  });
}
function formatLocalDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}
function today() {
  return formatLocalDateInput(new Date());
}
function dateToLocal(d) {
  if(!d) return null;
  return formatLocalDateInput(d);
}

function toDateTime(dateStr, timeStr) {
  if (!dateStr) return 0;
  const d = parseLocalDate(dateStr);
  const [h, m] = String(timeStr || "00:00").split(":").map(Number);
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return d.getTime();
}

function safeClone(value) {
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch (cloneError) {
    void cloneError;
  }
  return JSON.parse(JSON.stringify(value));
}

function dataEquals(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isValidEmailAddress(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return false;
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(normalizedEmail)) {
    return false;
  }
  const domain = normalizedEmail.split("@")[1];
  return !EMAIL_TYPO_DOMAINS.includes(domain);
}

function getReservationReturnTimestamp(reservation) {
  if (!reservation?.return_date) return null;
  return toDateTime(reservation.return_date, reservation.return_time || "23:59");
}

function markReservationReturned(reservation, returnedAt = new Date()) {
  const returnedAtIso = returnedAt instanceof Date ? returnedAt.toISOString() : new Date(returnedAt).toISOString();
  return {
    ...reservation,
    status: "הוחזר",
    returned_at: reservation.returned_at || returnedAtIso,
  };
}

function normalizeReservationsForArchive(reservations, now = new Date()) {
  const nowMs = now.getTime();
  return (reservations || []).map((reservation) => {
    if (!reservation) return reservation;
    const normalizedReservation = {
      ...reservation,
      status: normalizeReservationStatus(reservation.status),
    };
    if (normalizedReservation.status === "הוחזר") {
      return normalizedReservation.returned_at ? normalizedReservation : markReservationReturned(normalizedReservation, now);
    }
    const returnAt = getReservationReturnTimestamp(normalizedReservation);
    if (normalizedReservation.status === "מאושר" && returnAt !== null && nowMs >= returnAt) {
      // Lessons auto-archive, regular loans go to "באיחור"
      if (normalizedReservation.loan_type === "שיעור") {
        return markReservationReturned(normalizedReservation, now);
      }
      return { ...normalizedReservation, status: "באיחור" };
    }
    return normalizedReservation;
  });
}

// Far-future timestamp used for overdue reservations — item is physically missing, blocks all future requests
const FAR_FUTURE = new Date("2099-12-31T23:59:00").getTime();

function getAvailable(eqId, borrowDate, returnDate, reservations, equipment, excludeId=null, borrowTime="", returnTime="") {
  const eq = equipment.find(e => e.id == eqId);
  if (!eq) return 0;
  // Use end-of-day if no time provided so date-only reservations still block correctly
  const bStart = toDateTime(borrowDate, borrowTime || "00:00");
  const rEnd   = toDateTime(returnDate, returnTime || "23:59");
  let used = 0;
  for (const res of reservations) {
    if (res.id === excludeId) continue;
    if (res.status !== "מאושר" && res.status !== "באיחור") continue;
    const resStart = toDateTime(res.borrow_date, res.borrow_time || "00:00");
    // Overdue items are physically out of the warehouse — block every future request regardless of return_date
    const resEnd = res.status === "באיחור" ? FAR_FUTURE : toDateTime(res.return_date, res.return_time || "23:59");
    // Overlap: new period starts before existing ends AND new period ends after existing starts
    if (bStart < resEnd && rEnd > resStart) {
      const item = res.items?.find(i => i.equipment_id == eqId);
      if (item) used += item.quantity;
    }
  }
  const working = workingUnits(eq);
  return Math.max(0, working - used);
}

function hasLinkedValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function compareDateTimeParts(a = {}, b = {}) {
  const dateCompare = String(a.date || "").localeCompare(String(b.date || ""));
  if (dateCompare !== 0) return dateCompare;
  return String(a.startTime || "").localeCompare(String(b.startTime || ""));
}

function getLinkedLessonKit(lesson, kits = []) {
  if (!lesson) return null;
  if (hasLinkedValue(lesson.kitId)) {
    return kits.find((kit) => String(kit.id) === String(lesson.kitId)) || null;
  }
  return kits.find((kit) => kit.kitType === "lesson" && hasLinkedValue(kit.lessonId) && String(kit.lessonId) === String(lesson.id)) || null;
}

function getLessonsLinkedToKit(kit, lessons = []) {
  if (!kit) return [];
  return lessons.filter((lesson) => {
    if (!lesson) return false;
    if (hasLinkedValue(lesson.kitId)) {
      return String(lesson.kitId) === String(kit.id);
    }
    return hasLinkedValue(kit.lessonId) && String(kit.lessonId) === String(lesson.id);
  });
}

function getLessonScheduleEntries(lesson) {
  return (Array.isArray(lesson?.schedule) ? lesson.schedule : [])
    .filter((session) => session?.date)
    .map((session) => ({
      date: session.date,
      startTime: session.startTime || "09:00",
      endTime: session.endTime || "12:00",
      topic: String(session.topic || "").trim(),
    }))
    .sort(compareDateTimeParts);
}

function buildLessonReservations(lessons = [], kits = []) {
  const reservations = [];
  const linkedKitIds = new Set();

  lessons.forEach((lesson) => {
    const schedule = getLessonScheduleEntries(lesson);
    const kit = getLinkedLessonKit(lesson, kits);
    const items = (Array.isArray(kit?.items) ? kit.items : [])
      .filter((item) => Number(item?.quantity) > 0)
      .map((item) => ({ ...item }));

    if (!kit || !items.length || !schedule.length) return;

    linkedKitIds.add(String(kit.id));

    schedule.forEach((session, index) => {
      reservations.push({
        id: `lesson_res_${lesson.id}_${index}`,
        lesson_id: lesson.id,
        lesson_kit_id: kit.id,
        lesson_auto: true,
        bookingKind: "lesson",
        loan_type: "שיעור",
        student_name: String(lesson.instructorName || lesson.name || "").trim(),
        email: String(lesson.instructorEmail || "").trim(),
        phone: String(lesson.instructorPhone || "").trim(),
        course: String(lesson.name || kit.name || "").trim(),
        borrow_date: session.date,
        borrow_time: session.startTime,
        return_date: session.date,
        return_time: session.endTime,
        items,
        created_at: lesson.created_at || new Date().toISOString(),
        overdue_notified: true,
      });
    });
  });

  return { reservations, linkedKitIds };
}

function buildLessonStudioBookings(lessons = []) {
  const bookings = [];

  lessons.forEach((lesson) => {
    if (!hasLinkedValue(lesson?.studioId)) return;
    const schedule = getLessonScheduleEntries(lesson);
    if (!schedule.length) return;

    schedule.forEach((session, index) => {
      const lessonName = String(lesson.name || "").trim();
      const instructorName = String(lesson.instructorName || "").trim();
      const track = String(lesson.track || "").trim();
      bookings.push({
        id: `lesson_booking_${lesson.id}_${index}`,
        lesson_id: lesson.id,
        lesson_auto: true,
        bookingKind: "lesson",
        studioId: lesson.studioId,
        date: session.date,
        startTime: session.startTime,
        endTime: session.endTime,
        courseName: lessonName,
        instructorName,
        track,
        subject: String(session.topic || "").trim(),
        studentName: lessonName && instructorName ? `${lessonName} · ${instructorName}` : (lessonName || instructorName),
        notes: String(lesson.description || "").trim(),
        isNight: false,
        createdAt: lesson.created_at || new Date().toISOString(),
      });
    });
  });

  return bookings.sort(compareDateTimeParts);
}
 
function getReservationApprovalConflicts(targetReservation, reservations, equipment) {
  if (!targetReservation) return [];
  const reqStart = toDateTime(targetReservation.borrow_date, targetReservation.borrow_time || "00:00");
  const reqEnd   = toDateTime(targetReservation.return_date, targetReservation.return_time || "23:59");
  const conflicts = [];

  for (const item of targetReservation.items || []) {
    const eq = equipment.find(e => e.id == item.equipment_id);
    if (!eq) continue;

    let used = 0;
    const blockers = [];

    for (const res of reservations) {
      if (res.id === targetReservation.id) continue;
      if (res.status !== "מאושר" && res.status !== "באיחור") continue;

      const resStart = toDateTime(res.borrow_date, res.borrow_time || "00:00");
      // Overdue items are physically missing — treat as blocking every future date
      const resEnd = res.status === "באיחור" ? FAR_FUTURE : toDateTime(res.return_date, res.return_time || "23:59");
      const overlaps = reqStart < resEnd && reqEnd > resStart;
      if (!overlaps) continue;

      const blockingItem = (res.items || []).find(i => i.equipment_id == item.equipment_id);
      if (!blockingItem || !blockingItem.quantity) continue;

      const blockingQty = Number(blockingItem.quantity) || 0;
      used += blockingQty;
      blockers.push({
        reservation_id: res.id,
        student_name: res.student_name || "ללא שם",
        quantity: blockingQty,
        borrow_date: res.borrow_date,
        borrow_time: res.borrow_time || "00:00",
        return_date: res.return_date,
        return_time: res.return_time || "23:59",
        status: res.status, // carry status so UI can highlight overdue blockers
      });
    }

    const requested = Number(item.quantity) || 0;
    const total = workingUnits(eq);
    const available = Math.max(0, total - used);

    if (requested > available) {
      conflicts.push({
        equipment_id: item.equipment_id,
        equipment_name: eq.name,
        requested,
        available,
        total,
        missing: requested - available,
        blockers,
      });
    }
  }

  return conflicts;
}

// Detect consecutive bookings — same equipment, reservation ends shortly before target starts (within 2h gap)
function getConsecutiveBookingWarnings(targetReservation, reservations, equipment) {
  if (!targetReservation) return [];
  const reqStart = toDateTime(targetReservation.borrow_date, targetReservation.borrow_time || "00:00");
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const warnings = [];
  const seen = new Set();

  for (const item of targetReservation.items || []) {
    const eq = equipment.find(e => e.id == item.equipment_id);
    if (!eq) continue;

    for (const res of reservations) {
      if (res.id === targetReservation.id) continue;
      if (res.status !== "מאושר") continue;
      const blockingItem = (res.items || []).find(i => i.equipment_id == item.equipment_id);
      if (!blockingItem || !blockingItem.quantity) continue;

      const resEnd = toDateTime(res.return_date, res.return_time || "23:59");
      const gap = reqStart - resEnd; // ms between previous return and new borrow
      if (gap > 0 && gap <= TWO_HOURS) {
        const key = `${res.id}_${item.equipment_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        warnings.push({
          equipment_name: eq.name,
          student_name: res.student_name || "ללא שם",
          return_date: res.return_date,
          return_time: res.return_time || "23:59",
          quantity: blockingItem.quantity,
          reservation_id: res.id,
        });
      }
    }
  }
  return warnings;
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800;900&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg:#0a0c10; --surface:#111318; --surface2:#181c24; --surface3:#1e232e;
    --border:#252b38; --accent:#f5a623; --accent2:#e8863a; --accent-glow:rgba(245,166,35,0.18);
    --text:#e8eaf0; --text2:#8891a8; --text3:#555f72;
    --green:#2ecc71; --red:#e74c3c; --blue:#3498db; --purple:#9b59b6; --yellow:#f1c40f;
    --r:12px; --r-sm:8px;
  }
  [data-theme="light"] {
    --bg:#f0f2f5; --surface:#ffffff; --surface2:#f5f6f8; --surface3:#ebedf0;
    --border:#d4d8de; --accent:#d48806; --accent2:#c07a05; --accent-glow:rgba(212,136,6,0.12);
    --text:#1a1d23; --text2:#555d6e; --text3:#8891a0;
    --green:#27ae60; --red:#c0392b; --blue:#2980b9; --purple:#8e44ad; --yellow:#d4a017;
  }
  [data-theme="light"] body { background:#f0f2f5; color:#1a1d23; }
  [data-theme="light"] .sidebar { background:#ffffff; border-left-color:#d4d8de; }
  [data-theme="light"] .form-input, [data-theme="light"] .form-select, [data-theme="light"] .form-textarea { background:#f5f6f8; color:#1a1d23; border-color:#d4d8de; }
  [data-theme="light"] .btn-secondary { background:#ebedf0; color:#1a1d23; border-color:#d4d8de; }
  [data-theme="light"] .card { background:#ffffff; border-color:#d4d8de; }
  [data-theme="light"] .topbar { background:#ffffff; border-bottom-color:#d4d8de; }
  [data-theme="light"] .nav-item { color:#333; }
  [data-theme="light"] .nav-item:hover { color:#111; }
  [data-theme="light"] .nav-item.active { color:#111; }
  [data-theme="light"] .search-bar { background:#f5f6f8; border-color:#d4d8de; }
  [data-theme="light"] .search-bar input { color:#1a1d23; }
  [data-theme="light"] .highlight-box { background:rgba(212,136,6,0.08); border-color:rgba(212,136,6,0.25); }
  [data-theme="light"] .chip { background:#ebedf0; border-color:#d4d8de; color:#333; }
  [data-theme="light"] .item-row { background:#f9fafb; border-color:#d4d8de; }
  [data-theme="light"] .item-row:hover { background:#f0f2f5; }
  html, body, #root { width:100%; min-height:100%; }
  #root {
    max-width:none !important;
    margin:0 !important;
    padding:0 !important;
    text-align:initial !important;
  }
  body { font-family:'Heebo',sans-serif; background:var(--bg); color:var(--text); direction:rtl; min-height:100vh; overflow-x:hidden; overflow-y:scroll; scrollbar-gutter:stable; }
  .app { display:flex; min-height:100vh; }
  .sidebar { width:240px; min-width:240px; background:var(--surface); border-left:1px solid var(--border); display:flex; flex-direction:column; position:fixed; right:0; top:0; bottom:0; z-index:100; }
  .sidebar-logo { padding:24px 20px 20px; border-bottom:1px solid var(--border); }
  .sidebar-logo .app-name { font-size:20px; font-weight:900; color:var(--accent); line-height:1.1; }
  .sidebar-logo .app-sub { font-size:11px; color:var(--text3); margin-top:3px; }
  .logo-icon { font-size:46px; margin-bottom:8px; display:block; }
  .nav { flex:1; padding:12px 0; overflow-y:auto; }
  .nav-section { padding:10px 18px 6px; font-size:12px; font-weight:900; color:var(--text2); text-transform:uppercase; letter-spacing:1px; }
  .nav-item { display:flex; align-items:center; gap:12px; padding:12px 20px; cursor:pointer; font-size:16px; font-weight:800; color:#f3f6fb; transition:all 0.15s; border-right:3px solid transparent; margin:1px 0; position:relative; }
  .nav-item:hover { background:var(--surface2); color:#ffffff; }
  .nav-item.active { background:var(--accent-glow); color:#ffffff; border-right-color:var(--accent); }
  .nav-item .icon { font-size:21px; width:24px; text-align:center; }
  .nav-label { font-size:15px; font-weight:800; color:inherit; line-height:1.1; }
  .main { margin-right:240px; flex:1; min-height:100vh; }
  .topbar { position:sticky; top:0; z-index:50; background:rgba(10,12,16,0.92); backdrop-filter:blur(12px); border-bottom:1px solid var(--border); padding:0 28px; min-height:60px; height:auto; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; }
  .topbar-title { font-size:20px; font-weight:800; color:#ffffff; }
  .page { padding:28px; }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:var(--r); padding:20px; }
  .card-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; }
  .card-title { font-size:16px; font-weight:700; }
  .stats-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:16px; margin-bottom:24px; }
  .stat-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--r); padding:20px; position:relative; overflow:hidden; }
  .stat-card::before { content:''; position:absolute; top:0; right:0; width:4px; height:100%; background:var(--ac,var(--accent)); }
  .stat-label { font-size:12px; color:var(--text2); margin-bottom:8px; font-weight:500; }
  .stat-value { font-size:32px; font-weight:900; line-height:1; }
  .stat-icon { position:absolute; left:16px; top:16px; font-size:24px; opacity:0.25; }
  .btn { display:inline-flex; align-items:center; gap:6px; padding:8px 16px; border-radius:var(--r-sm); font-family:'Heebo',sans-serif; font-size:13px; font-weight:600; cursor:pointer; border:none; transition:all 0.15s; white-space:nowrap; }
  .btn-primary { background:var(--accent); color:#0a0c10; }
  .btn-primary:hover { background:var(--accent2); transform:translateY(-1px); }
  .btn-primary:disabled { opacity:0.4; cursor:not-allowed; transform:none; }
  .btn-secondary { background:var(--surface2); color:var(--text); border:1px solid var(--border); }
  .btn-secondary:hover { background:var(--surface3); }
  .btn-danger { background:rgba(231,76,60,0.15); color:var(--red); border:1px solid rgba(231,76,60,0.3); }
  .btn-success { background:rgba(46,204,113,0.15); color:var(--green); border:1px solid rgba(46,204,113,0.3); }
  .btn-sm { padding:5px 10px; font-size:12px; }
  .btn-icon { padding:7px; }
  .form-group { margin-bottom:16px; }
  .form-label { display:block; font-size:13px; font-weight:600; color:var(--text2); margin-bottom:6px; }
  .form-input,.form-select,.form-textarea { width:100%; padding:9px 12px; background:var(--surface2); border:1px solid var(--border); border-radius:var(--r-sm); color:var(--text); font-family:'Heebo',sans-serif; font-size:14px; outline:none; transition:border-color 0.15s; }
  .form-input:focus,.form-select:focus,.form-textarea:focus { border-color:var(--accent); }
  .form-textarea { resize:vertical; min-height:80px; }
  .table-wrap { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; }
  th { background:var(--surface2); padding:11px 14px; text-align:right; font-size:12px; font-weight:700; color:var(--text2); border-bottom:1px solid var(--border); white-space:nowrap; }
  td { padding:12px 14px; font-size:13px; border-bottom:1px solid var(--border); vertical-align:middle; }
  tr:last-child td { border-bottom:none; }
  tr:hover td { background:var(--surface2); }
  .badge { display:inline-flex; align-items:center; padding:3px 10px; border-radius:100px; font-size:11px; font-weight:700; white-space:nowrap; }
  .badge-green { background:rgba(46,204,113,0.15); color:var(--green); border:1px solid rgba(46,204,113,0.25); }
  .badge-yellow { background:rgba(241,196,15,0.15); color:var(--yellow); border:1px solid rgba(241,196,15,0.25); }
  .badge-red { background:rgba(231,76,60,0.15); color:var(--red); border:1px solid rgba(231,76,60,0.3); }
  .badge-blue   { background:rgba(52,152,219,0.15); color:var(--blue); border:1px solid rgba(52,152,219,0.25); }
  .cert-desktop { display:block; }
  .cert-mobile  { display:none; }
  .badge-purple { background:rgba(155,89,182,0.15); color:#9b59b6; border:1px solid rgba(155,89,182,0.3); }
  .badge-orange { background:rgba(230,126,34,0.18); color:#e67e22; border:1px solid rgba(230,126,34,0.4); }
  .badge-gray { background:var(--surface2); color:var(--text2); border:1px solid var(--border); }
  .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.75); display:flex; align-items:center; justify-content:center; z-index:1000; padding:20px; backdrop-filter:blur(4px); animation:fadeIn 0.15s; }
  .modal { background:var(--surface); border:1px solid var(--border); border-radius:var(--r); width:100%; max-width:580px; max-height:90vh; overflow-y:auto; animation:slideUp 0.2s; }
  .modal-lg { max-width:800px; }
  .modal-header { padding:20px 24px 16px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; background:var(--surface); z-index:1; }
  .modal-title { font-size:18px; font-weight:800; }
  .modal-body { padding:24px; }
  .modal-footer { padding:16px 24px; border-top:1px solid var(--border); display:flex; gap:8px; background:var(--surface); flex-wrap:wrap; }
  @keyframes fadeIn { from{opacity:0} to{opacity:1} }
  @keyframes slideUp { from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1} }
  @keyframes spin { to{transform:rotate(360deg)} }
  .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .responsive-split { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .flex { display:flex; }
  .flex-between { display:flex; justify-content:space-between; align-items:center; }
  .gap-2 { gap:8px; }
  .gap-3 { gap:12px; }
  .mb-4 { margin-bottom:16px; }
  .mb-6 { margin-bottom:24px; }
  .text-muted { color:var(--text2); font-size:13px; }
  .divider { height:1px; background:var(--border); margin:20px 0; }
  .chip { display:inline-block; padding:3px 8px; background:var(--surface2); border:1px solid var(--border); border-radius:4px; font-size:11px; color:var(--text2); margin:2px; }
  .highlight-box { background:var(--accent-glow); border:1px solid rgba(245,166,35,0.3); border-radius:var(--r-sm); padding:12px 16px; font-size:13px; margin-bottom:16px; }
  .empty-state { text-align:center; padding:60px 20px; color:var(--text3); }
  .empty-state .emoji { font-size:48px; margin-bottom:12px; }
  .search-bar { display:flex; align-items:center; gap:10px; background:var(--surface2); border:1px solid var(--border); border-radius:var(--r-sm); padding:8px 14px; min-width:240px; }
  .search-bar input { background:none; border:none; outline:none; color:var(--text); font-family:'Heebo',sans-serif; font-size:13px; width:100%; }
  .eq-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:16px; }
  .eq-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--r); padding:18px; transition:all 0.2s; }
  .eq-card:hover { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent); }
  .toast-container { position:fixed; bottom:24px; left:24px; z-index:9999; display:flex; flex-direction:column; gap:8px; }
  .toast { background:var(--surface); border:1px solid var(--border); border-radius:var(--r-sm); padding:12px 18px; font-size:13px; font-weight:500; display:flex; align-items:center; gap:10px; min-width:260px; box-shadow:0 8px 24px rgba(0,0,0,0.4); animation:slideUp 0.2s; }
  .toast-success { border-right:3px solid var(--green); }
  .toast-error   { border-right:3px solid var(--red); }
  .toast-info    { border-right:3px solid var(--blue); }
  .cal-headers { display:grid; grid-template-columns:repeat(7,1fr); gap:1px; margin-bottom:2px; }
  .dashboard-bottom-grid { display:grid; grid-template-columns:minmax(320px,1fr) minmax(520px,640px); gap:16px; align-items:start; }
  .calendar-card { width:100%; min-width:520px; }
  .cal-grid { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:6px; width:100%; }
  .cal-day-header { text-align:center; font-size:11px; font-weight:700; color:var(--text3); padding:8px 4px; min-height:28px; }
  .cal-day { min-height:88px; background:var(--surface2); border-radius:var(--r-sm); padding:6px; border:1px solid var(--border); width:100%; overflow:hidden; }
  .cal-day.empty { opacity:0.28; }
  .cal-day.is-today { border-color:var(--accent); }
  .cal-day-num { font-size:12px; font-weight:700; margin-bottom:4px; color:var(--text2); }
  .cal-event { font-size:10px; padding:2px 5px; height:17px; line-height:17px; margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block; }
  .cal-event-start { border-radius:3px 0 0 3px; padding-right:2px; }
  .cal-event-mid   { border-radius:0; padding-left:2px; padding-right:2px; margin-left:-6px; margin-right:-6px; }
  .cal-event-end   { border-radius:0 3px 3px 0; padding-left:2px; margin-left:-6px; }
  .cal-event-single { border-radius:3px; }
  .calendar-nav { display:flex; align-items:center; justify-content:center; gap:10px; min-width:240px; flex-shrink:0; }
  .calendar-month-label { width:150px; text-align:center; font-weight:800; font-size:15px; flex-shrink:0; }
  .cal-fs-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.92); z-index:2000; display:flex; flex-direction:column; }
  .cal-fs-header { display:flex; align-items:center; gap:12px; padding:14px 20px; border-bottom:1px solid var(--border); background:var(--surface); flex-shrink:0; }
  .cal-fs-body { flex:1; overflow:auto; padding:16px; }
  .cal-fs-headers { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:6px; margin-bottom:4px; }
  .cal-fs-day-header { text-align:center; font-size:13px; font-weight:700; color:var(--text3); padding:8px 4px; }
  .cal-fs-grid { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:6px; }
  .cal-fs-day { background:var(--surface2); border-radius:var(--r-sm); padding:6px 5px; border:1px solid var(--border); overflow:hidden; min-height:120px; }
  .cal-fs-day.empty { opacity:0.2; }
  .cal-fs-day.is-today { border-color:var(--accent); }
  .cal-fs-day-num { font-size:14px; font-weight:700; margin-bottom:5px; }
  .cal-fs-event { font-size:11px; padding:2px 6px; height:19px; line-height:19px; margin-bottom:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block; }
  .cal-fs-event-start  { border-radius:4px 0 0 4px; margin-right:-5px; }
  .cal-fs-event-mid    { border-radius:0; margin-left:-5px; margin-right:-5px; }
  .cal-fs-event-end    { border-radius:0 4px 4px 0; margin-left:-5px; }
  .cal-fs-event-single { border-radius:4px; }
  .public-page-shell { width:100%; min-height:100vh; background:var(--bg); display:flex; justify-content:center; align-items:flex-start; }
  .public-page-shell > * { width:100%; }
  .form-page { width:100%; min-height:100vh; display:flex; justify-content:center; align-items:flex-start; padding:40px 20px; }
  .form-card { width:min(100%, 680px); max-width:680px; margin-inline:auto; background:var(--surface); border:1px solid var(--border); border-radius:16px; overflow:hidden; direction:rtl; }
  .form-card-header { padding:32px 36px 24px; background:linear-gradient(135deg,var(--surface2),var(--surface)); border-bottom:1px solid var(--border); }
  .form-card-body { padding:32px 36px; }
  .form-section-title { font-size:13px; font-weight:800; color:var(--accent); text-transform:uppercase; letter-spacing:1px; margin-bottom:16px; padding-bottom:8px; border-bottom:1px solid var(--border); }
  .item-row { display:flex; align-items:center; gap:12px; padding:12px; background:var(--surface2); border-radius:var(--r-sm); border:1px solid var(--border); margin-bottom:8px; }
  .qty-ctrl { display:flex; align-items:center; gap:8px; }
  .qty-btn { width:28px; height:28px; border-radius:50%; background:var(--surface); border:1px solid var(--border); color:var(--text); font-size:16px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.1s; }
  .qty-btn:hover { background:var(--accent); color:var(--bg); border-color:var(--accent); }
  .qty-num { font-size:16px; font-weight:700; min-width:24px; text-align:center; }
  .terms-box { background:var(--surface2); border:1px solid var(--border); border-radius:var(--r-sm); padding:16px; font-size:13px; color:var(--text2); white-space:pre-wrap; line-height:1.7; margin-bottom:16px; max-height:150px; overflow-y:auto; }
  .checkbox-row { display:flex; align-items:flex-start; gap:10px; cursor:pointer; }
  .checkbox-row input[type=checkbox] { width:16px; height:16px; accent-color:var(--accent); margin-top:2px; flex-shrink:0; }
  .req-detail-row { display:flex; gap:6px; margin-bottom:6px; font-size:13px; }
  .req-detail-label { color:var(--text2); min-width:110px; }
  .spinner { width:36px; height:36px; border:3px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:spin 0.8s linear infinite; }
  .loading-wrap { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:80px 20px; gap:16px; color:var(--text2); }
  .res-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--r); padding:16px; transition:border-color 0.15s; }
  .res-card:hover { border-color:var(--accent); }
  .recent-request-row { display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid transparent; border-radius:12px; cursor:pointer; transition:border-color 0.15s, background 0.15s, transform 0.15s; }
  .recent-request-row:hover { border-color:var(--accent); background:var(--surface2); transform:translateY(-1px); }
  .btn-purple { background:rgba(155,89,182,0.16); color:#d7b9ff; border:1px solid rgba(155,89,182,0.45); }
  .btn-purple:hover { background:rgba(155,89,182,0.26); color:#f3e9ff; }
  .res-card-top { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; flex-wrap:wrap; gap:8px; }
  .res-card-mid { padding:12px 0; border-top:1px solid var(--border); border-bottom:1px solid var(--border); margin-bottom:12px; }
  .res-card-actions { display:flex; gap:6px; flex-wrap:wrap; }
  /* ── DESKTOP WIDE ── */
  @media (min-width:1400px) {
    .sidebar { width:280px; min-width:280px; }
    .main { margin-right:280px; }
    .page { padding:36px 40px; }
    .stats-grid { grid-template-columns:repeat(4,1fr); }
    .eq-grid { grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); }
  }
  /* ── MOBILE ── */
  @media (max-width:768px) {
    .sidebar { position:fixed; bottom:0; top:auto; right:0; left:0; width:100%; flex-direction:row; height:60px; border-left:none; border-top:1px solid var(--border); z-index:200; }
    .sidebar-logo { display:none; }
    .nav { display:flex; flex-direction:row; padding:0; flex:1; overflow-x:auto; }
    .nav-section { display:none; }
    .nav-item { flex:1; min-width:48px; flex-direction:column; gap:1px; padding:5px 2px; font-size:9px; border-right:none; border-top:3px solid transparent; justify-content:center; text-align:center; margin:0; }
    .nav-label { display:none; }
    .nav-item.active { border-right-color:transparent; border-top-color:var(--accent); background:var(--accent-glow); }
    .nav-item .icon { font-size:18px; width:auto; }
    .sidebar > div:last-child { display:none; }
    .main { margin-right:0; padding-bottom:68px; }
    .cert-desktop { display:none !important; }
    .cert-mobile  { display:flex !important; }
    .topbar { padding:6px 10px; min-height:48px; height:auto !important; flex-wrap:wrap; gap:4px; align-items:flex-start; }
    .page { padding:16px; }
    .stats-grid { grid-template-columns:1fr 1fr; gap:12px; }
    .stat-value { font-size:24px; }
    .grid-2 { grid-template-columns:1fr; }
    .responsive-split { grid-template-columns:1fr; }
    .eq-grid { grid-template-columns:1fr 1fr; gap:12px; }
    .eq-card { padding:12px; }
    .modal { max-width:100%; max-height:95vh; border-radius:var(--r) var(--r) 0 0; }
    .modal-overlay { align-items:flex-end; padding:0; }
    .modal-lg { max-width:100%; }
    .search-bar { min-width:0; flex:1; }
    .flex-between { flex-wrap:wrap; gap:10px; }
    html, body, #root { min-height:100%; }
    .public-page-shell { justify-content:stretch; }
    .form-page { min-height:100vh; padding:16px 12px 80px; }
    .form-card { width:100%; max-width:100%; }
    .form-card-header { padding:20px; }
    .form-card-body { padding:20px; }
    .toast-container { left:12px; right:12px; bottom:76px; }
    .toast { min-width:0; width:100%; }
    .dashboard-bottom-grid { grid-template-columns:1fr; order:1; }
    .dash-stats-section { order:2; }
    .page { display:flex; flex-direction:column; }
    .calendar-card { min-width:0; }
    .cal-grid { gap:4px; }
    .cal-day { min-height:64px; padding:4px; }
    .cal-event { font-size:9px; padding:2px 4px; }
    .calendar-nav { min-width:0; width:100%; justify-content:space-between; }
    .calendar-month-label { width:auto; flex:1; }
  }
  @media (max-width:400px) {
    .eq-grid { grid-template-columns:1fr; }
  }
  @media (min-width:769px) {
    .app { font-size: var(--admin-fs, 14px); }
  }
`;

// ─── HELPERS ──────────────────────────────────────────────────────────────────
// Ensure each equipment item has a units array
function ensureUnits(eq) {
  if (Array.isArray(eq.units) && eq.units.length === eq.total_quantity) return eq;
  const existing = Array.isArray(eq.units) ? eq.units : [];
  const units = [];
  for (let i = 0; i < (eq.total_quantity || 0); i++) {
    units.push(existing[i] || { id: `${eq.id}_${i+1}`, status: "תקין", fault: "", repair: "" });
  }
  return { ...eq, units };
}

// Count working (תקין) units
function workingUnits(eq) {
  if (!Array.isArray(eq.units)) return Number(eq.total_quantity) || 0;
  return eq.units.filter(u => u.status === "תקין").length;
}


// ─── EQUIPMENT PAGE ───────────────────────────────────────────────────────────
const CATEGORY_LOAN_TYPE_OPTIONS = ["פרטית", "הפקה", "סאונד", "קולנוע יומית"];
const EQUIPMENT_CLASSIFICATION_OPTIONS = ["סאונד", "צילום", "כללי"];
const DEFAULT_LOAN_TYPE_CLASSIFICATIONS = {
  פרטית: ["כללי"],
  הפקה: ["צילום"],
  סאונד: ["סאונד"],
  "קולנוע יומית": ["צילום"],
};

function getLoanTypeEquipmentClassifications(loanType, categoryLoanTypes = {}) {
  const rawValue = categoryLoanTypes?.[loanType];
  const normalized = Array.isArray(rawValue)
    ? rawValue.filter((value) => EQUIPMENT_CLASSIFICATION_OPTIONS.includes(String(value).trim()))
    : EQUIPMENT_CLASSIFICATION_OPTIONS.includes(String(rawValue || "").trim())
      ? [String(rawValue).trim()]
      : [];
  return normalized.length ? [...new Set(normalized)] : [...(DEFAULT_LOAN_TYPE_CLASSIFICATIONS[loanType] || ["כללי"])];
}

function buildCategoryLoanTypesMap(draft = {}) {
  const next = {};
  CATEGORY_LOAN_TYPE_OPTIONS.forEach((loanType) => {
    next[loanType] = getLoanTypeEquipmentClassifications(loanType, draft);
  });
  return next;
}

function CategoryLoanTypesModal({ categoryLoanTypes = {}, onSave, onClose }) {
  const [draft, setDraft] = useState(() => {
    const initialDraft = {};
    CATEGORY_LOAN_TYPE_OPTIONS.forEach((loanType) => {
      initialDraft[loanType] = getLoanTypeEquipmentClassifications(loanType, categoryLoanTypes);
    });
    return initialDraft;
  });

  return (
    <Modal
      title="🗂️ סיווג לסוגי ההשאלות"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => onSave(buildCategoryLoanTypesMap(draft))}>שמור</button>
          <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
        </>
      }
    >
      <div style={{display:"grid",gap:12}}>
        <div style={{fontSize:13,color:"var(--text3)",lineHeight:1.7}}>
          בחרו לכל סוג השאלה איזה סיווג ציוד מתוך המחסן יהיה זמין לסטודנט בטופס ההשאלה.
        </div>
        {CATEGORY_LOAN_TYPE_OPTIONS.map((loanType) => {
          const selectedClassifications = getLoanTypeEquipmentClassifications(loanType, draft);
          return (
            <div key={loanType} style={{border:"1px solid var(--border)",borderRadius:12,padding:12,background:"var(--surface2)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                <div style={{fontWeight:800,fontSize:14}}>{loanType === "הפקה" ? "השאלת הפקה" : loanType === "סאונד" ? "השאלת סאונד" : loanType === "קולנוע יומית" ? "השאלת קולנוע יומית" : "השאלה פרטית"}</div>
                <div style={{fontSize:12,color:"var(--text3)"}}>זמין כרגע: {selectedClassifications.map((classification) => classification === "סאונד" ? "ציוד סאונד" : classification === "צילום" ? "ציוד צילום" : "כללי").join(" + ")}</div>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {EQUIPMENT_CLASSIFICATION_OPTIONS.map((classification) => (
                  <button
                    key={classification}
                    type="button"
                    className={`btn btn-sm ${selectedClassifications.includes(classification) ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setDraft((prev) => {
                      const current = getLoanTypeEquipmentClassifications(loanType, prev);
                      const nextSelection = current.includes(classification)
                        ? current.filter((value) => value !== classification)
                        : [...current, classification];
                      if (!nextSelection.length) return prev;
                      return { ...prev, [loanType]: nextSelection };
                    })}
                  >
                    {classification === "סאונד" ? "ציוד סאונד" : classification === "צילום" ? "ציוד צילום" : "כללי"}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function EquipmentPage({ equipment, reservations, setEquipment, showToast, categories=DEFAULT_CATEGORIES, setCategories, categoryTypes={}, setCategoryTypes, categoryLoanTypes={}, setCategoryLoanTypes=()=>{}, certifications={types:[],students:[]}, studios=[], collegeManager={}, managerToken="" }) {
  const [eqSubView, setEqSubView] = useState("active"); // "active" | "damaged"
  const [search, setSearch] = useState("");
  const [trackFilter, setTrackFilter] = useState("הכל");
  const [selectedCats, setSelectedCats] = useState([]);
  const [typeFilter, setTypeFilter] = useState("הכל"); // "הכל" | "סאונד" | "צילום"
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [importModal, setImportModal] = useState(null);
  const csvInputRef = useRef(null);
  const existingCategories = [...new Set((equipment || []).map((item) => item.category))].filter(Boolean);

  const persistEquipmentChange = async (nextEquipment, { successMessage, errorMessage = "שגיאה בשמירת הציוד. השינוי לא נשמר בשרת." } = {}) => {
    const previousEquipment = equipment;
    setEquipment(nextEquipment);
    const result = await storageSet("equipment", nextEquipment);
    if (!result?.ok) {
      setEquipment(previousEquipment);
      showToast("error", errorMessage);
      return false;
    }
    if (successMessage) showToast("success", successMessage);
    return true;
  };

  const parseCSVLine = (line) => {
    const result = []; let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    result.push(cur.trim());
    return result;
  };

  const handleCSVImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let rows = [];
    const isExcel = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");
    if (isExcel) {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    } else {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) { showToast("error", "הקובץ ריק או לא תקין"); return; }
      const header = parseCSVLine(lines[0]).map(h => h.replace(/^\uFEFF/, "").trim());
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        const row = {};
        header.forEach((h, idx) => { row[h] = cols[idx]?.trim() || ""; });
        rows.push(row);
      }
    }
    if (!rows.length) { showToast("error", "הקובץ ריק"); return; }
    const findKey = (row, keys) => keys.find(k => row[k] !== undefined);
    const sample = rows[0];
    const nameKey = findKey(sample, ["שם פריט","name","שם"]);
    const catKey  = findKey(sample, ["רובריקה","קטגוריה","category"]);
    const qtyKey  = findKey(sample, ["כמות","qty","quantity"]);
    const descKey = findKey(sample, ["תיאור","description"]);
    const notesKey= findKey(sample, ["הערות","notes"]);
    if (!nameKey || !catKey) {
      showToast("error", 'חסרות עמודות חובה: "שם פריט" ו-"רובריקה"'); return;
    }
    let newEquipment = [...equipment];
    let newCategories = [...categories];
    let added = 0, skipped = 0, newCats = [];
    rows.forEach((row, i) => {
      const name  = String(row[nameKey] || "").trim();
      const cat   = String(row[catKey]  || "").trim();
      const qty   = Math.max(1, parseInt(row[qtyKey]) || 1);
      const desc  = descKey  ? String(row[descKey]  || "").trim() : "";
      const notes = notesKey ? String(row[notesKey] || "").trim() : "";
      if (!name || !cat) return;
      if (!newCategories.includes(cat)) { newCategories.push(cat); newCats.push(cat); }
      if (newEquipment.some(eq => eq.name === name && eq.category === cat)) { skipped++; return; }
      newEquipment.push(ensureUnits(normalizeEquipmentTagFlags([{
        id: Date.now() + i + Math.random(),
        name, category: cat, description: desc, notes,
        total_quantity: qty, image: "📦", status: "תקין",
      }])[0]));
      added++;
    });
    const previousEquipment = equipment;
    const previousCategories = categories;
    setEquipment(newEquipment);
    if (setCategories && newCats.length) {
      setCategories(newCategories);
    }
    const writeResults = await Promise.all([
      storageSet("equipment", newEquipment),
      ...(setCategories && newCats.length ? [storageSet("categories", newCategories)] : []),
    ]);
    if (writeResults.some((result) => !result?.ok)) {
      setEquipment(previousEquipment);
      if (setCategories && newCats.length) {
        setCategories(previousCategories);
      }
      showToast("error", "שגיאה בשמירת הייבוא. הנתונים לא נשמרו בשרת.");
      e.target.value = "";
      return;
    }
    setImportModal({ added, skipped, newCats });
    e.target.value = "";
  };

  const downloadTemplate = () => {
    const csv = "\uFEFFשם פריט,כמות,רובריקה,תיאור,הערות\nגמביל DJI RS3,3,מייצבי מצלמה,גמביל 3 צירים,\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "תבנית_ייבוא_ציוד.csv";
    a.click();
  };

  const handleAiEquipmentImport = async (newItems, approvedCategories = []) => {
    const normalizedItems = ensureUnits(normalizeEquipmentTagFlags(newItems || []));
    const updatedEquipment = [...(equipment || []), ...normalizedItems];
    const previousEquipment = equipment;
    const previousCategories = categories;
    setEquipment(updatedEquipment);
    const uniqueApprovedCategories = [...new Set((approvedCategories || []).map((item) => String(item || "").trim()).filter(Boolean))];
    const updatedCategories = [...new Set([...(categories || []), ...uniqueApprovedCategories])];
    const writes = [storageSet("equipment", updatedEquipment)];
    if (typeof setCategories === "function" && updatedCategories.length !== (categories || []).length) {
      setCategories(updatedCategories);
      writes.push(storageSet("categories", updatedCategories));
    }
    const results = await Promise.all(writes);
    if (results.some((result) => !result?.ok)) {
      setEquipment(previousEquipment);
      if (typeof setCategories === "function" && updatedCategories.length !== (categories || []).length) {
        setCategories(previousCategories);
      }
      showToast("error", "שגיאה בשמירת הייבוא החכם. הנתונים לא נשמרו בשרת.");
      return;
    }
    showToast("success", "הייבוא החכם נשמר במחסן");
  };

  // Derive category effective type: explicit tag wins, else from items
  const getCatType = (catName) => {
    if (Object.prototype.hasOwnProperty.call(categoryTypes, catName)) {
      return categoryTypes[catName] === "סאונד" || categoryTypes[catName] === "צילום" ? categoryTypes[catName] : "כללי";
    }
    const catItems = equipment.filter(e => e.category === catName);
    if (!catItems.length) return "כללי";
    if (catItems.every(e => e.soundOnly)) return "סאונד";
    if (catItems.every(e => e.photoOnly)) return "צילום";
    return "כללי";
  };

  const filtered = equipment.filter(e =>
    (selectedCats.length===0||selectedCats.includes(e.category)) &&
    e.name.includes(search) &&
    (typeFilter==="הכל" || getCatType(e.category)===typeFilter)
  );

  const updateQty = async (eq, delta) => {
    const newTotal = Math.max(1, (Number(eq.total_quantity) || 1) + delta);
    let updatedUnits = Array.isArray(eq.units) ? [...eq.units] : [];
    if (delta > 0) {
      for (let i = 0; i < delta; i++) {
        updatedUnits.push({ id: `unit-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, status: "תקין", notes: "" });
      }
    } else if (delta < 0) {
      let removed = 0;
      updatedUnits = updatedUnits.filter(u => {
        if (removed < Math.abs(delta) && u.status === "תקין") { removed++; return false; }
        return true;
      });
    }
    const updated = equipment.map(e => e.id === eq.id ? { ...e, total_quantity: newTotal, units: updatedUnits } : e);
    await persistEquipmentChange(updated, { successMessage: `כמות עודכנה: ${newTotal} יחידות` });
  };

  const save = async (form) => {
    setSaving(true);
    const normalizedForm = normalizeEquipmentTagFlags([form])[0];
    let updated;
    if (modal.type==="add") {
      const item = ensureUnits({ ...normalizedForm, id: Date.now() });
      updated = [...equipment, item];
    } else {
      const merged = ensureUnits({...equipment.find(e=>e.id===modal.item.id)||{}, ...normalizedForm});
      updated = equipment.map(e => e.id===modal.item.id ? merged : e);
    }
    const saved = await persistEquipmentChange(updated, {
      successMessage: modal.type==="add" ? `"${form.name}" נוסף בהצלחה` : "הציוד עודכן בהצלחה",
      errorMessage: "שגיאה בשמירת הציוד. השינוי לא נשמר בשרת.",
    });
    setSaving(false);
    if (saved) setModal(null);
  };

  const del = async (eq) => {
    const updated = equipment.filter(e => e.id!==eq.id);
    const deleted = await persistEquipmentChange(updated, {
      successMessage: `"${eq.name}" נמחק`,
      errorMessage: `המחיקה של "${eq.name}" לא נשמרה בשרת.`,
    });
    if (deleted) setModal(null);
  };

  const setCategoryClassification = async (categoryName, nextType) => {
    const updated = equipment.map((item) => (
      item.category === categoryName
        ? { ...item, soundOnly: nextType === "סאונד", photoOnly: nextType === "צילום" }
        : item
    ));
    const updatedTypes = { ...categoryTypes };
    if (nextType === "סאונד" || nextType === "צילום") updatedTypes[categoryName] = nextType;
    else delete updatedTypes[categoryName];
    const previousEquipment = equipment;
    const previousTypes = categoryTypes;
    setEquipment(updated);
    setCategoryTypes(updatedTypes);
    const results = await Promise.all([storageSet("equipment", updated), storageSet("categoryTypes", updatedTypes)]);
    if (results.some((result) => !result?.ok)) {
      setEquipment(previousEquipment);
      setCategoryTypes(previousTypes);
      showToast("error", "שגיאה בשמירת סיווג הקטגוריה. השינוי לא נשמר בשרת.");
      return;
    }
    showToast("success", nextType === "סאונד"
      ? `כל הפריטים בקטגוריית "${categoryName}" סווגו כציוד סאונד`
      : nextType === "צילום"
        ? `כל הפריטים בקטגוריית "${categoryName}" סווגו כציוד צילום`
        : `כל הפריטים בקטגוריית "${categoryName}" סווגו ככלליים`);
  };

  const toggleCategoryPrivateLoanUnlimited = async (categoryName) => {
    const categoryItems = equipment.filter((item) => item.category === categoryName);
    if (!categoryItems.length) return;
    const shouldEnable = !categoryItems.every((item) => !!item.privateLoanUnlimited);
    const updated = equipment.map((item) =>
      item.category === categoryName ? { ...item, privateLoanUnlimited: shouldEnable } : item
    );
    await persistEquipmentChange(updated, {
      successMessage: shouldEnable ? `הקטגוריה "${categoryName}" הוחרגה ממגבלת השאלה פרטית` : `הוחזרה מגבלת השאלה פרטית לקטגוריה "${categoryName}"`,
      errorMessage: "שגיאה בשמירת הגדרת הקטגוריה. השינוי לא נשמר בשרת.",
    });
  };

  const saveCategoryLoanTypes = async (nextCategoryLoanTypes) => {
    const previousCategoryLoanTypes = categoryLoanTypes;
    setCategoryLoanTypes(nextCategoryLoanTypes);
    const result = await storageSet("categoryLoanTypes", nextCategoryLoanTypes);
    if (!result?.ok) {
      setCategoryLoanTypes(previousCategoryLoanTypes);
      showToast("error", "שגיאה בשמירת סוגי ההשאלות. השינוי לא נשמר בשרת.");
      return;
    }
    showToast("success", "סיווג סוגי ההשאלות עודכן");
    setModal(null);
  };

  const deleteEmptyCategoryFromFilters = async (categoryName) => {
    const hasItems = equipment.some((item) => item.category === categoryName);
    if (hasItems) {
      showToast("error", "לא ניתן למחוק — יש ציוד ברובריקה זו");
      return;
    }
    const updatedCats = categories.filter((category) => category !== categoryName);
    const updatedTypes = { ...categoryTypes };
    delete updatedTypes[categoryName];
    setSelectedCats((prev) => prev.filter((category) => category !== categoryName));
    setCategories(updatedCats);
    setCategoryTypes(updatedTypes);
    await Promise.all([storageSet("categories", updatedCats), storageSet("categoryTypes", updatedTypes)]);
    showToast("success", `הרובריקה "${categoryName}" נמחקה`);
  };

  const todayStr2 = today();
  const studioCertIdsForEquipment = new Set([
    "cert_night_studio",
    ...(certifications?.types || []).filter(t => t.category === "studio").map(t => t.id),
    ...(studios || []).flatMap(s => Array.isArray(s?.studioCertIds) ? s.studioCertIds.filter(Boolean) : (s?.studioCertId ? [s.studioCertId] : [])),
  ]);
  const equipmentCertTypes = (certifications?.types || []).filter(t => !studioCertIdsForEquipment.has(t.id));
  const used = (id) => reservations
    .filter(r=>{
      if(r.status==="באיחור") return true; // overdue = item still out, regardless of dates
      if(r.status!=="מאושר"&&r.status!=="ממתין") return false;
      return r.borrow_date<=todayStr2 && r.return_date>=todayStr2;
    })
    .reduce((s,r)=>s+(r.items?.find(i=>i.equipment_id==id)?.quantity||0),0);

  const EqForm = ({ initial }) => {
    const [f, setF] = useState({
      name:"",
      category:"מצלמות",
      description:"",
      technical_details:"",
      total_quantity:1,
      image:"📷",
      notes:"",
      status:"תקין",
      certification_id:"",
      ...(initial || {}),
    });
    const s = (k,v) => setF(p=>({...p,[k]:v}));
    const [imgUploading, setImgUploading] = useState(false);
    const [imgError, setImgError]         = useState("");
    const [isGeneratingDesc, setIsGeneratingDesc] = useState(false);
    const [isGeneratingTechDetails, setIsGeneratingTechDetails] = useState(false);

    const generateGeminiField = async ({ itemName, systemInstruction, onSuccess, setLoading, errorPrefix }) => {
      if (!itemName) {
        alert("נא להזין שם פריט קודם");
        return;
      }

      setLoading(true);
      try {
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
        if (!apiKey) throw new Error("חסר מפתח Gemini במשתני הסביבה");
        const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent";

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: itemName }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || "API request failed");
        }

        const data = await response.json();
        const generatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!generatedText) throw new Error("לא התקבל טקסט מה־API");

        onSuccess(generatedText);
      } catch (error) {
        console.error("Error generating description:", error);
        alert(`${errorPrefix}. ${error?.message || "נסה שוב."}`);
      } finally {
        setLoading(false);
      }
    };

    const generateAutoDescription = async (itemName) => {
      await generateGeminiField({
        itemName,
        systemInstruction: "You are a professional AV and film equipment expert. The user will provide an equipment name. Write a concise, professional description of this item in Hebrew (around 2-3 sentences), highlighting its main uses and features. Output ONLY the Hebrew text, without formatting or markdown.",
        onSuccess: (generatedText) => setF(prev => ({ ...prev, description: generatedText })),
        setLoading: setIsGeneratingDesc,
        errorPrefix: "שגיאה ביצירת התיאור",
      });
    };

    const generateAutoTechnicalDetails = async (itemName) => {
      await generateGeminiField({
        itemName,
        systemInstruction: "You are a professional AV and film equipment technical specialist. The user will provide an equipment name. Write concise technical details in Hebrew for this item (around 3-5 short lines), focusing on relevant specs, connections, power or battery, compatibility, operating range, mounting, or practical setup details when appropriate. Output ONLY the Hebrew text, without formatting or markdown.",
        onSuccess: (generatedText) => setF(prev => ({ ...prev, technical_details: generatedText })),
        setLoading: setIsGeneratingTechDetails,
        errorPrefix: "שגיאה ביצירת הפרטים הטכניים",
      });
    };

    const handleImageUpload = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      setImgError("");
      setImgUploading(true);
      try {
        // Read file as base64 data-URI
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload  = ev => resolve(ev.target.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        // POST to Cloudinary proxy — returns { ok, url }
        const res  = await fetch("/api/upload-image", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ data: dataUrl }),
        });
        const json = await res.json();
        if (!res.ok || !json.url) throw new Error(json.error || "שגיאת שרת");
        s("image", json.url);          // store only the URL — no Base64 in DB
      } catch (err) {
        console.error("Image upload failed:", err);
        setImgError("שגיאה בהעלאת התמונה — נסה שנית");
      } finally {
        setImgUploading(false);
      }
    };

    // Legacy Base64 items (data:) still preview correctly; new items use https: URLs
    const isImage = f.image?.startsWith("data:") || f.image?.startsWith("http");

    return (
      <div>
        <div className="grid-2">
          <div className="form-group"><label className="form-label">שם הציוד *</label><input className="form-input" value={f.name} onChange={e=>s("name",e.target.value)}/></div>
          <div className="form-group"><label className="form-label">קטגוריה</label><select className="form-select" value={f.category} onChange={e=>s("category",e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select></div>
        </div>
        <div className="form-group">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap",direction:"ltr"}}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={()=>generateAutoDescription(f.name)}
              disabled={isGeneratingDesc}
              style={{display:"inline-flex",alignItems:"center",gap:6,fontWeight:800}}
            >
              <span aria-hidden="true">✨</span>
              {isGeneratingDesc ? "מייצר תיאור..." : "תיאור אוטומטי"}
            </button>
            <label className="form-label" style={{margin:0,textAlign:"right"}}>תיאור</label>
          </div>
          <textarea className="form-textarea" rows={2} value={f.description} onChange={e=>s("description",e.target.value)}/>
        </div>
        <div className="form-group">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap",direction:"ltr"}}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={()=>generateAutoTechnicalDetails(f.name)}
              disabled={isGeneratingTechDetails}
              style={{display:"inline-flex",alignItems:"center",gap:6,fontWeight:800}}
            >
              <span aria-hidden="true">✨</span>
              {isGeneratingTechDetails ? "מייצר פרטים..." : "פרטים טכניים אוטומטיים"}
            </button>
            <label className="form-label" style={{margin:0,textAlign:"right"}}>פרטים טכניים</label>
          </div>
          <textarea
            className="form-textarea"
            rows={3}
            placeholder="לדוגמה: טווחי עבודה, חיבורים, משקל, סוללה, פורמטים נתמכים..."
            value={f.technical_details || ""}
            onChange={e=>s("technical_details",e.target.value)}
          />
        </div>
        <div className="grid-2">
          <div className="form-group"><label className="form-label">כמות *</label><input type="number" min="0" className="form-input" value={f.total_quantity} onChange={e=>s("total_quantity",Number(e.target.value))}/></div>
          <div className="form-group">
            <label className="form-label">תמונה / אימוג׳י</label>
            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
              {imgUploading
                ? <div style={{width:48,height:48,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:8,border:"1px solid var(--border)",background:"var(--surface2)",fontSize:20}}>⏳</div>
                : isImage
                  ? <img src={f.image} alt="" style={{width:48,height:48,objectFit:"cover",borderRadius:8,border:"1px solid var(--border)"}}/>
                  : <span style={{fontSize:36}}>{f.image}</span>
              }
              <div style={{flex:1}}>
                <input className="form-input" value={isImage?"":f.image} placeholder="אימוג׳י (למשל 📷)" onChange={e=>s("image",e.target.value)} style={{marginBottom:6}} disabled={imgUploading}/>
                <label style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",background:"var(--surface3)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",cursor:imgUploading?"not-allowed":"pointer",fontSize:12,color:"var(--text2)",opacity:imgUploading?0.6:1}}>
                  {imgUploading ? "⏳ מעלה תמונה..." : "🖼️ העלה תמונה מהמחשב"}
                  <input type="file" accept="image/*" style={{display:"none"}} onChange={handleImageUpload} disabled={imgUploading}/>
                </label>
                {f.name && <button type="button" onClick={()=>window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(f.name)}`, "_blank")} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",background:"var(--surface3)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",cursor:"pointer",fontSize:12,color:"var(--text2)",marginTop:4,width:"100%"}}>
                  🔍 חפש תמונה ב-Google Images
                </button>}
                {imgError && <div style={{color:"#e74c3c",fontSize:11,marginTop:4}}>{imgError}</div>}
              </div>
            </div>
          </div>
        </div>
        <div className="grid-2">
          <div className="form-group"><label className="form-label">מצב</label><select className="form-select" value={f.status} onChange={e=>s("status",e.target.value)}>{STATUSES.map(st=><option key={st}>{st}</option>)}</select></div>
          <div className="form-group"><label className="form-label">הערות</label><input className="form-input" value={f.notes} onChange={e=>s("notes",e.target.value)}/></div>
        </div>
        <div className="form-group">
          <label className="form-label">🎓 הסמכה נדרשת</label>
          <select className="form-select" value={f.certification_id||""} onChange={e=>s("certification_id",e.target.value)}>
            <option value="">ללא הסמכה (כולם רשאים)</option>
            {equipmentCertTypes.map(ct=>(
              <option key={ct.id} value={ct.id}>{ct.name}</option>
            ))}
          </select>
          <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>רק סטודנטים שעברו הסמכה זו יוכלו להשאיל פריט זה</div>
        </div>
        <div className="flex gap-2" style={{paddingTop:8}}>
          <button className="btn btn-primary" disabled={!f.name||saving||imgUploading} onClick={()=>save(f)}>{saving?"⏳ שומר...":initial?"💾 שמור":"➕ הוסף"}</button>
          <button className="btn btn-secondary" onClick={()=>setModal(null)}>ביטול</button>
        </div>
      </div>
    );
  };

  const damagedCount = equipment.reduce((n,eq) => n + (eq.units||[]).filter(u=>u.status!=="תקין").length, 0);
  const visibleCategories = [...new Set([...(categories || []), ...existingCategories])];
  const filteredCategoryOptions = (typeFilter === "הכל"
    ? visibleCategories
    : visibleCategories.filter(c => getCatType(c) === typeFilter)
  );
  const groupedCategories = (selectedCats.length > 0 ? selectedCats : visibleCategories)
    .filter(c => filtered.some(e => e.category === c));

  return (
    <div className="page">
      {/* Sub-view tabs */}
      <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
        {[
          {id:"active",label:"📦 ציוד פעיל",badge:null},
          {id:"damaged",label:"🔧 ציוד בדיקה",badge:damagedCount||null},
        ].map(t=>(
          <button key={t.id} onClick={()=>setEqSubView(t.id)}
            style={{padding:"8px 18px",borderRadius:8,border:`2px solid ${eqSubView===t.id?"var(--accent)":"var(--border)"}`,
              background:eqSubView===t.id?"var(--accent)22":"transparent",color:eqSubView===t.id?"var(--accent)":"var(--text2)",
              fontWeight:800,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
            {t.label}
            {t.badge!=null && <span style={{background:eqSubView===t.id?"var(--accent)":"var(--text3)",color:"#000",borderRadius:20,padding:"0 7px",fontSize:11,fontWeight:900}}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {/* Damaged sub-view */}
      {eqSubView==="damaged" && <DamagedEquipmentPage equipment={equipment} setEquipment={setEquipment} showToast={showToast} categories={categories} collegeManager={collegeManager} managerToken={managerToken}/>}

      {/* Active equipment sub-view */}
      {eqSubView==="active" && <>
      <div className="flex-between mb-4">
        <div className="search-bar"><span>🔍</span><input placeholder="חיפוש ציוד..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div className="flex gap-2" style={{flexWrap:"wrap",justifyContent:"flex-end"}}>
          <button className="btn btn-secondary" onClick={downloadTemplate} title="הורד תבנית CSV">📥 תבנית</button>
          <button className="btn btn-secondary" onClick={()=>csvInputRef.current?.click()}>📤 ייבוא CSV</button>
          <input ref={csvInputRef} type="file" accept=".csv,.xlsx,.xls,text/csv" style={{display:"none"}} onChange={handleCSVImport}/>
          <SmartEquipmentImportButton
            showToast={showToast}
            existingCategories={existingCategories}
            onImportSuccess={handleAiEquipmentImport}
          />
          <button className="btn btn-primary" onClick={()=>setModal({type:"addcat"})}>📂 ניהול קטגוריות</button>
          <button className="btn btn-primary" onClick={()=>setModal({type:"loan-types"})}>🗂️ סיווג לסוגי ההשאלות</button>
          <button className="btn btn-primary" onClick={()=>setModal({type:"add"})}>➕ הוסף ציוד</button>
        </div>
      </div>

      {/* ── Type filter (sound / photo) ── */}
      <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
        {[{k:"הכל",label:"📦 הכל"},{k:"סאונד",label:"🎙️ סאונד"},{k:"צילום",label:"🎥 צילום"},{k:"כללי",label:"🧩 כללי"}].map(({k,label})=>{
          const active=typeFilter===k;
          return <button key={k} type="button" onClick={()=>setTypeFilter(k)}
            style={{padding:"5px 14px",borderRadius:8,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
            {label}
          </button>;
        })}
        {typeFilter!=="הכל"&&<span style={{fontSize:11,color:"var(--text3)"}}>מציג {filtered.length} פריטים</span>}
      </div>

      {/* ── Category pills ── */}
      <div className="flex gap-2 mb-6" style={{flexWrap:"wrap",alignItems:"center"}}>
        {filteredCategoryOptions.map(c=>{
          const active = selectedCats.includes(c);
          const isEmptyCategory = !equipment.some((item) => item.category === c);
          return (
            <div key={c} style={{display:"flex",alignItems:"center",borderRadius:8,overflow:"hidden",border:`1px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"var(--surface2)"}}>
              <button
                className="btn btn-sm"
                style={{borderRadius:0,border:"none",background:"transparent",color:active?"var(--accent)":"var(--text2)",fontWeight:700,padding:"5px 10px"}}
                onClick={()=>setSelectedCats(prev=>active?prev.filter(x=>x!==c):[...prev,c])}>
                {c}
              </button>
              {isEmptyCategory && (
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{borderRadius:0,border:"none",borderRight:"1px solid var(--border)",background:"transparent",color:"var(--red)",fontWeight:900,padding:"5px 8px"}}
                  title="מחק רובריקה ריקה"
                  onClick={(e)=>{
                    e.stopPropagation();
                    deleteEmptyCategoryFromFilters(c);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length===0 ? <div className="empty-state"><div className="emoji">📦</div><p>לא נמצא ציוד</p></div> : (
        <>
          {groupedCategories.map(c=>(
            <div key={c} style={{marginBottom:32}}>
              <div style={{fontSize:13,fontWeight:800,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,marginBottom:12,paddingBottom:8,borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:8,justifyContent:"space-between",flexWrap:"wrap"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <span>{c}</span>
                <span style={{fontSize:11,color:"var(--text3)",fontWeight:400}}>({filtered.filter(e=>e.category===c).length} פריטים)</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  {[
                    { key:"סאונד", label:"ציוד סאונד" },
                    { key:"צילום", label:"ציוד צילום" },
                    { key:"כללי", label:"כללי" },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      className={`btn btn-sm ${getCatType(c) === key ? "btn-primary" : "btn-secondary"}`}
                      onClick={()=>setCategoryClassification(c, key)}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`btn btn-sm ${equipment.filter(e=>e.category===c).every(e=>e.privateLoanUnlimited) ? "btn-purple" : "btn-secondary"}`}
                    onClick={()=>toggleCategoryPrivateLoanUnlimited(c)}
                  >
                    לא מוגבל בהשאלה פרטית
                  </button>
                </div>
              </div>
              <div className="eq-grid">
                {filtered.filter(e=>e.category===c).map(eq=>{const avail=workingUnits(eq)-used(eq.id);const isEmpty=avail<=0;return(
                  <div key={eq.id} className="eq-card" style={{position:"relative",cursor:"pointer",border:isEmpty?"2px solid var(--red)":undefined,boxShadow:isEmpty?"0 0 0 1px rgba(231,76,60,0.35)":undefined}} onClick={()=>setModal({type:"edit",item:eq})}>
                    {/* ── Cert badge ── */}
                    {eq.certification_id&&(
                      <div title={`דורש הסמכה: ${certifications?.types?.find(t=>t.id===eq.certification_id)?.name||"הסמכה"}`}
                        style={{position:"absolute",top:8,left:8,background:"rgba(245,166,35,0.18)",border:"2px solid var(--accent)",borderRadius:8,padding:"3px 7px",display:"flex",alignItems:"center",gap:3,zIndex:2}}>
                        <span style={{fontSize:14}}>🎓</span>
                        <span style={{fontSize:10,fontWeight:900,color:"var(--accent)"}}>הסמכה</span>
                      </div>
                    )}
                    <div style={{marginBottom:10,display:"flex",justifyContent:"center"}}>
                      {eq.image?.startsWith("data:")||eq.image?.startsWith("http")
                        ? <img src={eq.image} alt={eq.name} style={{width:72,height:72,objectFit:"cover",borderRadius:10,border:"1px solid var(--border)"}}/>
                        : <span style={{fontSize:36}}>{eq.image||"📦"}</span>
                      }
                    </div>
                    <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>{eq.name}</div>
                    <div style={{fontSize:11,color:"var(--text3)",marginBottom:8}}>{eq.category}</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
                      {eq.soundOnly && <div className="chip" style={{color:"var(--accent)",borderColor:"var(--accent)"}}>🎙️ ציוד סאונד</div>}
                      {eq.photoOnly && <div className="chip" style={{color:"var(--green)",borderColor:"rgba(39,174,96,0.45)"}}>🎥 ציוד צילום</div>}
                    </div>
                    <div style={{fontSize:13,display:"flex",alignItems:"center",justifyContent:"space-between",gap:6}}>
                      <div>
                        <strong style={{color:isEmpty?"var(--red)":"var(--accent)",fontSize:20}}>{avail}</strong>
                        <span style={{color:"var(--text3)"}}> / {workingUnits(eq)} זמין</span>
                        {workingUnits(eq)<eq.total_quantity&&<span style={{color:"var(--red)",fontSize:11,fontWeight:700,marginRight:6}}> · {eq.total_quantity-workingUnits(eq)} בדיקה 🔧</span>}
                      </div>
                      {isEmpty&&<span style={{fontSize:10,fontWeight:900,color:"var(--red)",background:"rgba(231,76,60,0.12)",border:"1px solid rgba(231,76,60,0.4)",borderRadius:6,padding:"2px 7px",whiteSpace:"nowrap"}}>אזל במלאי</span>}
                    </div>
                    {eq.notes && <div className="chip" style={{marginTop:6}}>💬 {eq.notes}</div>}
                    <div style={{marginTop:8}}>{statusBadge(eq.status)}</div>
                    <div className="flex gap-2" style={{marginTop:12,flexWrap:"wrap"}} onClick={e=>e.stopPropagation()}>
                      <button className="btn btn-secondary btn-sm" onClick={()=>setModal({type:"edit",item:eq})}>✏️ עריכה</button>
                      <button className="btn btn-secondary btn-sm" onClick={()=>setModal({type:"units",item:eq})}>🔧 יחידות</button>
                      <button className="btn btn-danger btn-sm" onClick={()=>setModal({type:"delete",item:eq})}>🗑️</button>
                    </div>
                  </div>
                );})}
              </div>
            </div>
          ))}
        </>
      )}
      {(modal?.type==="add"||modal?.type==="edit") && <Modal title={modal.type==="add"?"➕ הוספת ציוד":"✏️ עריכת ציוד"} onClose={()=>setModal(null)}><EqForm initial={modal.type==="edit"?modal.item:null}/></Modal>}
      {modal?.type==="units" && <UnitsModal eq={modal.item} equipment={equipment} setEquipment={setEquipment} showToast={showToast} onClose={()=>setModal(null)}/>}
      {modal?.type==="delete" && <Modal title="🗑️ מחיקת ציוד" onClose={()=>setModal(null)} footer={<><button className="btn btn-danger" onClick={()=>del(modal.item)}>כן, מחק</button><button className="btn btn-secondary" onClick={()=>setModal(null)}>ביטול</button></>}><p>האם למחוק את <strong>{modal.item.name}</strong>?</p></Modal>}
      {modal?.type==="loan-types" && <CategoryLoanTypesModal categoryLoanTypes={categoryLoanTypes} onSave={saveCategoryLoanTypes} onClose={()=>setModal(null)}/>}
      {modal?.type==="addcat" && <ManageCategoriesModal
        categories={categories}
        categoryTypes={categoryTypes}
        equipment={equipment}
        onClose={()=>setModal(null)}
        onSave={async(action)=>{
          if(action.action==="add") {
            const updatedCats = [...categories, action.name];
            const updatedTypes = {...categoryTypes, ...(action.type ? {[action.name]: action.type} : {})};
            setCategories(updatedCats);
            setCategoryTypes(updatedTypes);
            await Promise.all([storageSet("categories", updatedCats), storageSet("categoryTypes", updatedTypes)]);
            showToast("success", `קטגוריה "${action.name}" נוספה`);
          } else if(action.action==="rename") {
            const updatedCats = categories.map(c => c===action.oldName ? action.newName : c);
            const updatedEq = equipment.map(e => {
              if(e.category !== action.oldName) return e;
              const base = {...e, category: action.newName};
              if(action.type !== undefined) {
                base.soundOnly = action.type === "סאונד";
                base.photoOnly = action.type === "צילום";
              }
              return base;
            });
            const updatedTypes = {...categoryTypes};
            if(action.oldName !== action.newName) { delete updatedTypes[action.oldName]; }
            if(action.type) updatedTypes[action.newName] = action.type;
            else delete updatedTypes[action.newName];
            setCategories(updatedCats);
            setEquipment(updatedEq);
            setCategoryTypes(updatedTypes);
            await Promise.all([storageSet("categories", updatedCats), storageSet("equipment", updatedEq), storageSet("categoryTypes", updatedTypes)]);
            showToast("success", `קטגוריה עודכנה`);
          } else if(action.action==="delete") {
            const hasItems = equipment.some(e => e.category===action.name);
            if(hasItems) { showToast("error", "לא ניתן למחוק — יש ציוד בקטגוריה זו"); return; }
            const updatedCats = categories.filter(c => c!==action.name);
            const updatedTypes = {...categoryTypes};
            delete updatedTypes[action.name];
            setCategories(updatedCats);
            setCategoryTypes(updatedTypes);
            await Promise.all([storageSet("categories", updatedCats), storageSet("categoryTypes", updatedTypes)]);
            showToast("success", `קטגוריה "${action.name}" נמחקה`);
          }
        }}
      />}
      {importModal && (
        <Modal title="📤 תוצאות ייבוא" onClose={()=>setImportModal(null)}
          footer={<button className="btn btn-primary" onClick={()=>setImportModal(null)}>סגור</button>}>
          <div style={{display:"flex",flexDirection:"column",gap:12,direction:"rtl"}}>
            <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
              <div style={{flex:1,background:"rgba(46,204,113,0.1)",border:"1px solid var(--green)",borderRadius:8,padding:"12px 16px",textAlign:"center"}}>
                <div style={{fontSize:28,fontWeight:900,color:"var(--green)"}}>{importModal.added}</div>
                <div style={{fontSize:12,color:"var(--text3)"}}>פריטים נוספו</div>
              </div>
              <div style={{flex:1,background:"rgba(245,166,35,0.1)",border:"1px solid var(--accent)",borderRadius:8,padding:"12px 16px",textAlign:"center"}}>
                <div style={{fontSize:28,fontWeight:900,color:"var(--accent)"}}>{importModal.skipped}</div>
                <div style={{fontSize:12,color:"var(--text3)"}}>פריטים דולגו (כבר קיימים)</div>
              </div>
            </div>
            {importModal.newCats.length > 0 && (
              <div style={{background:"rgba(52,152,219,0.1)",border:"1px solid var(--blue)",borderRadius:8,padding:"12px 16px"}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:6}}>רובריקות חדשות שנוצרו:</div>
                {importModal.newCats.map(c=><div key={c} style={{fontSize:13,color:"var(--blue)"}}>📂 {c}</div>)}
              </div>
            )}
          </div>
        </Modal>
      )}
      </>}
    </div>
  );
}

// ─── MANAGE CATEGORIES MODAL ──────────────────────────────────────────────────
function ManageCategoriesModal({ categories, categoryTypes, onSave, onClose, equipment=[] }) {
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState(""); // "" | "סאונד" | "צילום"
  const [editingCat, setEditingCat] = useState(null);
  const [editVal, setEditVal] = useState("");
  const [editType, setEditType] = useState("");
  const [typeFilters, setTypeFilters] = useState([]); // [] = all, else array of selected types

  const exists = categories.includes(newName.trim());
  const toggleTypeFilter = (t) => setTypeFilters(prev => prev.includes(t) ? prev.filter(x=>x!==t) : [...prev, t]);

  // Derive effective type — explicit categoryTypes takes priority, then derive from items
  const getEffectiveType = (cat) => {
    if (categoryTypes[cat] !== undefined && categoryTypes[cat] !== null) return categoryTypes[cat];
    const items = equipment.filter(e => e.category === cat);
    if (items.length) {
      const allSound = items.every(e => e.soundOnly) && !items.every(e => e.photoOnly);
      const allPhoto = items.every(e => e.photoOnly) && !items.every(e => e.soundOnly);
      if (allSound) return "סאונד";
      if (allPhoto) return "צילום";
    }
    return "";
  };

  // Sort categories: סאונד → צילום → כללי, then alphabetically within each group
  const sorted = [...categories].sort((a, b) => {
    const order = { "סאונד": 0, "צילום": 1 };
    const oa = order[getEffectiveType(a)] ?? 2;
    const ob = order[getEffectiveType(b)] ?? 2;
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b, "he");
  });

  const typeLabel = (t) => t === "סאונד" ? "🎙️ סאונד" : t === "צילום" ? "🎥 צילום" : "כללי";
  const typeBadgeStyle = (t) => ({
    display: "inline-flex", alignItems: "center", gap: 3,
    padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700,
    background: t === "סאונד" ? "rgba(155,89,182,0.15)" : t === "צילום" ? "rgba(39,174,96,0.12)" : "rgba(255,255,255,0.06)",
    color: t === "סאונד" ? "#9b59b6" : t === "צילום" ? "var(--green)" : "var(--text3)",
    border: `1px solid ${t === "סאונד" ? "rgba(155,89,182,0.35)" : t === "צילום" ? "rgba(39,174,96,0.3)" : "var(--border)"}`,
  });

  const filteredSorted = typeFilters.length===0 ? sorted : sorted.filter(c => {
    const t = getEffectiveType(c);
    return typeFilters.some(f => f==="" ? t==="" : t===f);
  });

  return (
    <Modal title="📂 ניהול קטגוריות" onClose={onClose}>
      {/* Type filter chips */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
        {[{k:"סאונד",l:"🎙️ סאונד"},{k:"צילום",l:"🎥 צילום"},{k:"",l:"כללי"}].map(({k,l})=>{
          const active=typeFilters.includes(k);
          return <button key={k} type="button" onClick={()=>toggleTypeFilter(k)}
            style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
            {l}
          </button>;
        })}
        {typeFilters.length>0&&<button type="button" onClick={()=>setTypeFilters([])} style={{padding:"4px 10px",borderRadius:20,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:11,cursor:"pointer"}}>✕ הכל</button>}
      </div>
      {/* Existing categories */}
      <div style={{marginBottom: 20}}>
        <div style={{fontSize: 12, fontWeight: 800, color: "var(--text3)", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5}}>
          קטגוריות קיימות ({filteredSorted.length}{typeFilters.length>0?` מתוך ${categories.length}`:""})</div>
        <div style={{display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto"}}>
          {filteredSorted.map(c => (
            <div key={c} style={{display: "flex", alignItems: "center", gap: 8, background: "var(--surface2)", borderRadius: 8, padding: "8px 12px", border: "1px solid var(--border)"}}>
              {editingCat === c ? (
                <>
                  <input
                    autoFocus
                    value={editVal}
                    onChange={e => setEditVal(e.target.value)}
                    onKeyDown={e => { if(e.key === "Escape") setEditingCat(null); }}
                    style={{flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 13}}
                  />
                  <select
                    value={editType}
                    onChange={e => setEditType(e.target.value)}
                    style={{background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 12}}
                  >
                    <option value="">כללי</option>
                    <option value="סאונד">🎙️ סאונד</option>
                    <option value="צילום">🎥 צילום</option>
                  </select>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => { onSave({action:"rename", oldName: c, newName: editVal.trim(), type: editType}); setEditingCat(null); }}
                    disabled={!editVal.trim() || (editVal.trim() !== c && categories.includes(editVal.trim()))}
                  >שמור</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditingCat(null)}>ביטול</button>
                </>
              ) : (
                <>
                  <span style={{flex: 1, fontSize: 13, fontWeight: 700}}>{c}</span>
                  <div style={{display:"flex",gap:4,flexShrink:0}}>
                    {[{v:"סאונד",l:"🎙️"},{v:"צילום",l:"🎥"},{v:"",l:"כללי"}].map(({v,l})=>{
                      const active = getEffectiveType(c)===v;
                      return <button key={v} type="button"
                        onClick={()=>onSave({action:"rename",oldName:c,newName:c,type:v})}
                        style={{padding:"2px 8px",borderRadius:6,border:`1.5px solid ${active?(v==="סאונד"?"rgba(155,89,182,0.8)":v==="צילום"?"rgba(39,174,96,0.7)":"var(--accent)"):"var(--border)"}`,background:active?(v==="סאונד"?"rgba(155,89,182,0.18)":v==="צילום"?"rgba(39,174,96,0.12)":"var(--accent-glow)"):"transparent",color:active?(v==="סאונד"?"#b97edc":v==="צילום"?"var(--green)":"var(--accent)"):"var(--text3)",fontWeight:active?800:500,fontSize:11,cursor:"pointer"}}>
                        {l}
                      </button>;
                    })}
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setEditingCat(c); setEditVal(c); setEditType(getEffectiveType(c) || ""); }}
                    title="ערוך שם">✏️</button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => onSave({action:"delete", name: c})}
                    title="מחק">🗑️</button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Add new category */}
      <div style={{borderTop: "1px solid var(--border)", paddingTop: 16}}>
        <div style={{fontSize: 12, fontWeight: 800, color: "var(--text3)", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5}}>הוסף קטגוריה חדשה</div>
        <div style={{display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap"}}>
          <div style={{flex: 1, minWidth: 140}}>
            <input
              className="form-input"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="שם הקטגוריה..."
              onKeyDown={e => { if(e.key === "Enter" && newName.trim() && !exists) { onSave({action:"add", name: newName.trim(), type: newType}); setNewName(""); setNewType(""); }}}
            />
            {exists && <div style={{color: "var(--red)", fontSize: 11, marginTop: 3}}>קטגוריה זו כבר קיימת</div>}
          </div>
          <select
            value={newType}
            onChange={e => setNewType(e.target.value)}
            className="form-select"
            style={{flex: "0 0 auto", minWidth: 120}}
          >
            <option value="">כללי</option>
            <option value="סאונד">🎙️ סאונד</option>
            <option value="צילום">🎥 צילום</option>
          </select>
          <button
            className="btn btn-primary"
            disabled={!newName.trim() || exists}
            onClick={() => { onSave({action:"add", name: newName.trim(), type: newType}); setNewName(""); setNewType(""); }}
          >+ הוסף</button>
        </div>
      </div>
    </Modal>
  );
}
// ─── PUBLIC MINI CALENDAR ────────────────────────────────────────────────────
function PublicMiniCalendar({ reservations, initialLoanType="הכל", previewStart="", previewEnd="", previewName="" }) {
  const [calDate, setCalDate] = useState(new Date());
  const [loanTypeF, setLoanTypeF] = useState(["פרטית","הפקה","סאונד","קולנוע יומית"].includes(initialLoanType) ? initialLoanType : "הכל");
  const yr = calDate.getFullYear();
  const mo = calDate.getMonth();
  const HE_M = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  const HE_D = ["א׳","ב׳","ג׳","ד׳","ה׳","ו׳","ש׳"];
  const todayStr = today();

  const days = [];
  const startOffset = new Date(yr,mo,1).getDay();
  for(let i=0;i<startOffset;i++) days.push(null);
  for(let d=1;d<=new Date(yr,mo+1,0).getDate();d++) days.push(new Date(yr,mo,d));
  while(days.length<42) days.push(null);

  const SPAN_COLORS = [
    ["rgba(52,152,219,0.75)","#fff"],["rgba(46,204,113,0.75)","#fff"],
    ["rgba(155,89,182,0.75)","#fff"],["rgba(230,126,34,0.75)","#fff"],
    ["rgba(26,188,156,0.75)","#fff"],["rgba(236,72,153,0.75)","#fff"],
    ["rgba(200,160,0,0.75)","#fff"], ["rgba(231,76,60,0.75)","#fff"],
  ];
  const LOAN_FILTERS = [{key:"הכל",label:"הכל",icon:"📦"},{key:"פרטית",label:"פרטית",icon:"👤"},{key:"הפקה",label:"הפקה",icon:"🎬"},{key:"סאונד",label:"סאונד",icon:"🎙️"},{key:"קולנוע יומית",label:"קולנוע יומית",icon:"🎥"}];
  const activeRes = reservations.filter(r=>
    (r.status==="מאושר"||r.status==="באיחור") && r.borrow_date && r.return_date &&
    r.loan_type !== "שיעור" &&
    (loanTypeF==="הכל" || r.loan_type===loanTypeF)
  );
  // For "באיחור" reservations whose return_date is in the past, extend to today so they appear on the calendar
  const activeResForCalendar = activeRes.map(r => {
    if (r.status === "באיחור" && r.return_date < todayStr) {
      return {...r, return_date: todayStr};
    }
    return r;
  });
  // Add preview entry for user's selected dates
  const previewRes = previewStart && previewEnd ? [{
    id:"__preview__", student_name:previewName, borrow_date:previewStart,
    return_date:previewEnd, status:"preview", loan_type:""
  }] : [];
  const allRes = [...activeResForCalendar, ...previewRes];
  const colorMap = {};
  activeRes.forEach((r,i)=>{ colorMap[r.id]=SPAN_COLORS[i%SPAN_COLORS.length]; });
  colorMap["__preview__"] = ["rgba(245,166,35,0.45)","#f5a623"]; // dashed yellow

  return (
    <div style={{marginBottom:16,marginTop:8}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,flexWrap:"wrap",gap:6}}>
        <div style={{fontWeight:800,fontSize:13,color:"var(--text2)"}}>📅 השאלות הפעילות</div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setCalDate(new Date(yr,mo-1,1))}>‹</button>
          <span style={{fontWeight:700,fontSize:12,minWidth:90,textAlign:"center"}}>{HE_M[mo]} {yr}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setCalDate(new Date(yr,mo+1,1))}>›</button>
        </div>
      </div>
      {/* Loan type filter chips */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
        {LOAN_FILTERS.map(f=>{
          const isActive = loanTypeF===f.key;
          return (
            <button key={f.key} type="button" onClick={()=>setLoanTypeF(f.key)}
              style={{padding:"3px 10px",borderRadius:20,border:`2px solid ${isActive?"var(--accent)":"var(--border)"}`,background:isActive?"var(--accent-glow)":"transparent",color:isActive?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:11,cursor:"pointer"}}>
              {f.icon} {f.label}
            </button>
          );
        })}
      </div>
      <div style={{background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",padding:"10px",direction:"rtl"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:4}}>
          {HE_D.map(d=><div key={d} style={{textAlign:"center",fontSize:11,fontWeight:700,color:"var(--text3)",padding:"4px 0"}}>{d}</div>)}
        </div>
        <CalendarGrid days={days} activeRes={allRes} colorMap={colorMap} todayStr={todayStr} cellHeight={80} fontSize={10} previewId="__preview__"/>
        {activeRes.length===0&&<div style={{textAlign:"center",fontSize:12,color:"var(--text3)",padding:"8px 0"}}>אין השאלות פעילות</div>}
      </div>
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
          <span>❌</span>
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
          <div style={{width:"100%",maxWidth:"min(900px,100vw)",height:"100%",display:"flex",flexDirection:"column",background:"var(--bg)"}}>

            {/* Header */}
            <div style={{padding:"14px 18px",background:"var(--surface)",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:10,flexShrink:0,flexWrap:"wrap"}}>
              <div style={{fontWeight:900,fontSize:16,flex:1}}>
                {showAll ? `📦 כל הציוד במחסן (${equipment.length} פריטים)` : `📋 פרטי הציוד שנבחר (${items.length} פריטים)`}
              </div>
              <div style={{display:"flex",gap:8}}>
                <button className="btn btn-secondary btn-sm"
                  style={{background:showAll?"var(--accent-glow)":"transparent",border:`1px solid ${showAll?"var(--accent)":"var(--border)"}`,color:showAll?"var(--accent)":"var(--text2)",fontWeight:700}}
                  onClick={()=>setShowAll(p=>!p)}>
                  📦 {showAll?"רק הנבחרים":"כל הציוד"}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={()=>setShowInfo(false)}>✕ סגור</button>
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
                        {isSelected&&<span style={{background:"var(--accent-glow)",border:"1px solid var(--accent)",borderRadius:20,padding:"1px 8px",fontSize:11,color:"var(--accent)",fontWeight:700}}>✓ ×{items.find(i=>i.equipment_id==itm.equipment_id)?.quantity}</span>}
                        {eq.notes&&<span style={{fontSize:11,color:"var(--text3)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:220}}>{"\uD83D\uDCDD"} {eq.notes}</span>}
                      </div>
                      {(eq.soundOnly || eq.photoOnly)&&<div style={{marginTop:8,display:"flex",gap:6,flexWrap:"wrap"}}>
                        {eq.soundOnly&&<span style={{background:"rgba(245,166,35,0.12)",border:"1px solid rgba(245,166,35,0.4)",borderRadius:20,padding:"1px 8px",fontSize:11,color:"var(--accent)",fontWeight:700}}>🎙️ ציוד סאונד</span>}
                        {eq.photoOnly&&<span style={{background:"rgba(39,174,96,0.12)",border:"1px solid rgba(39,174,96,0.35)",borderRadius:20,padding:"1px 8px",fontSize:11,color:"var(--green)",fontWeight:700}}>🎥 ציוד צילום</span>}
                      </div>}
                      <div style={{marginTop:"auto",paddingTop:8,fontSize:11,color:"var(--text3)",fontWeight:700}}>{"\u05DC\u05D7\u05E5 \u05DC\u05E4\u05EA\u05D9\u05D7\u05EA \u05D4\u05E4\u05E8\u05D9\u05D8 \u05D1\u05DE\u05E1\u05DA \u05DE\u05DC\u05D0"}</div>
                    </div>
                    {/* Image — fixed left */}
                    <div style={{width:"clamp(100px,28vw,240px)",flexShrink:0,background:"var(--surface2)",overflow:"hidden",borderLeft:"1px solid var(--border)"}}>
                      {isImg
                        ? <img src={eq.image} alt={eq.name} style={{width:"100%",height:"100%",objectFit:"contain",display:"block",background:"var(--surface2)"}}/>
                        : <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:64}}>{eq.image||"📦"}</div>
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

// ─── STEP 3 EQUIPMENT SELECTOR ───────────────────────────────────────────────
function Step3Equipment({ isSoundLoan, kits, loanType, categories, availEq, equipment, setItems, getItem, setQty, canBorrowEq=()=>true, studentRecord, certificationTypes=[] }) {
  const [activeKit, setActiveKit] = useState(null);
  const [privateFilter, setPrivateFilter] = useState("all");
  const [selectedCats, setSelectedCats] = useState([]); // multi-select, empty = all
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);

  const relevantKits = (kits||[]).filter(k => k.kitType!=="lesson" && (!k.loanType || k.loanType === loanType));

  const selectKit = (kit) => {
    if (activeKit?.id === kit.id) {
      setActiveKit(null);
      setItems([]);
      return;
    }
    setActiveKit(kit);
    const newItems = [];
    for (const ki of kit.items||[]) {
      const avail = availEq.find(e=>e.id==ki.equipment_id)?.avail||0;
      if(avail<=0) continue;
      const qty = Math.min(ki.quantity, avail);
      const name = equipment.find(e=>e.id==ki.equipment_id)?.name||"";
      newItems.push({equipment_id:ki.equipment_id,quantity:qty,name});
    }
    setItems(newItems);
  };

  const toggleCat = (cat) => setSelectedCats(prev =>
    prev.includes(cat) ? prev.filter(c=>c!==cat) : [...prev, cat]
  );

  // Equipment to display: if a kit is active, only show that kit's items
  const kitEqIds = activeKit ? new Set((activeKit.items||[]).map(i=>String(i.equipment_id))) : null;
  const equipmentFilter = isSoundLoan ? "sound" : loanType==="הפקה" ? "photo" : privateFilter;
  const visibleAvailEq = availEq.filter((eq) => {
    const isGeneral = (!eq.soundOnly && !eq.photoOnly) || (eq.soundOnly && eq.photoOnly);
    if (equipmentFilter === "sound") return !!eq.soundOnly || isGeneral;
    if (equipmentFilter === "photo") return !!eq.photoOnly || isGeneral;
    return true;
  });
  const baseCategories = categories.filter((category) => visibleAvailEq.some((eq) => eq.category === category));
  const filteredCategories = selectedCats.length===0 ? baseCategories : baseCategories.filter(c=>selectedCats.includes(c));

  return (
    <>
      <div className="form-section-title">
        בחירת ציוד
        {loanType==="סאונד"&&<span style={{fontSize:11,color:"var(--text3)",fontWeight:400,marginRight:8}}>· מוצגים רק פריטים שסומנו כציוד סאונד</span>}
        {loanType==="הפקה"&&<span style={{fontSize:11,color:"var(--text3)",fontWeight:400,marginRight:8}}>· מוצגים רק פריטים שסומנו כציוד צילום</span>}
        {loanType==="פרטית"&&<span style={{fontSize:11,color:"var(--text3)",fontWeight:400,marginRight:8}}>· בהשאלה פרטית אפשר לראות את כל ציוד המחסן או לסנן לפי תיוג</span>}
      </div>

      {loanType==="פרטית" && (
        <div style={{marginBottom:18,padding:"14px 16px",background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)"}}>
          <div style={{fontSize:12,fontWeight:800,color:"var(--accent)",marginBottom:10,letterSpacing:0.5}}>סינון ציוד לפי מסלול לימודים</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
            {[
              { key:"all", label:"כל הציוד", icon:"📦" },
              { key:"sound", label:"ציוד סאונד", icon:"🎙️" },
              { key:"photo", label:"ציוד צילום", icon:"🎥" },
            ].map((filterOption) => {
              const isActive = privateFilter === filterOption.key;
              return (
                <button
                  key={filterOption.key}
                  type="button"
                  onClick={()=>setPrivateFilter(filterOption.key)}
                  style={{padding:"7px 16px",borderRadius:20,border:`2px solid ${isActive?"var(--accent)":"var(--border)"}`,background:isActive?"var(--accent)":"var(--surface3)",color:isActive?"#000":"var(--text2)",fontWeight:700,fontSize:13,cursor:"pointer",transition:"all 0.15s",display:"flex",alignItems:"center",gap:6}}
                >
                  <span>{filterOption.icon}</span>
                  <span>{filterOption.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Category filter + selected toggle ── */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12,alignItems:"center"}}>
        <button type="button" onClick={()=>setShowSelectedOnly(p=>!p)}
          style={{padding:"5px 12px",borderRadius:20,border:`2px solid ${showSelectedOnly?"var(--green)":"var(--border)"}`,background:showSelectedOnly?"rgba(46,204,113,0.12)":"transparent",color:showSelectedOnly?"var(--green)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
          {showSelectedOnly?"✅ נבחרו":"⬜"} {showSelectedOnly?"הצג הכל":"הצג נבחרים בלבד"}
        </button>
        <div style={{width:1,height:20,background:"var(--border)",flexShrink:0}}/>
        {baseCategories.map(cat=>{
          const active = selectedCats.includes(cat);
          return (
            <button key={cat} type="button" onClick={()=>toggleCat(cat)}
              style={{padding:"4px 10px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}>
              {cat}
            </button>
          );
        })}
        {selectedCats.length>0&&(
          <button type="button" onClick={()=>setSelectedCats([])}
            style={{padding:"4px 8px",borderRadius:20,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:11,cursor:"pointer"}}>
            ✕ נקה
          </button>
        )}
      </div>

      {/* ── Kit selector ── */}
      {relevantKits.length>0 && (
        <div style={{marginBottom:20,padding:"14px 16px",background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)"}}>
          <div style={{fontSize:12,fontWeight:800,color:"var(--accent)",marginBottom:10,letterSpacing:0.5}}>🎒 ערכות מוכנות לסוג השאלה זה</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:activeKit?10:0}}>
            {/* "All equipment" pill */}
            <button type="button"
              onClick={()=>setActiveKit(null)}
              style={{padding:"7px 14px",borderRadius:20,border:`2px solid ${!activeKit?"var(--text2)":"var(--border)"}`,background:!activeKit?"var(--surface3)":"transparent",color:!activeKit?"var(--text)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer",transition:"all 0.15s"}}>
              📦 כל הציוד
            </button>
            {relevantKits.map(kit=>{
              const isActive = activeKit?.id===kit.id;
              return (
                <button key={kit.id} type="button"
                  onClick={()=>selectKit(kit)}
                  style={{padding:"7px 16px",borderRadius:20,border:`2px solid ${isActive?"var(--accent)":"var(--border)"}`,background:isActive?"var(--accent)":"var(--surface3)",color:isActive?"#000":"var(--text2)",fontWeight:700,fontSize:13,cursor:"pointer",transition:"all 0.15s",display:"flex",alignItems:"center",gap:6}}>
                  🎒 {kit.name}
                  {isActive&&<span style={{fontSize:10,opacity:0.7}}>✓ פעיל</span>}
                </button>
              );
            })}
          </div>
          {activeKit&&(
            <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>
              מציג ציוד מערכת <strong style={{color:"var(--accent)"}}>{activeKit.name}</strong> בלבד · לחץ שוב לביטול הסינון
            </div>
          )}
        </div>
      )}

      {/* ── Equipment list ── */}
      {filteredCategories.map(c=>{
        let catEq = visibleAvailEq.filter(e=>e.category===c);
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
                    ? <img src={eq.image} alt="" style={{width:36,height:36,objectFit:"cover",borderRadius:6}}/>
                    : <span style={{fontSize:26}}>{eq.image||"📦"}</span>}
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:14}}>{eq.name}</div>
                    <div style={{fontSize:12,color:"var(--text3)"}}>
                      זמין: <span style={{color:eq.avail===0?"var(--red)":eq.avail<=2?"var(--yellow)":"var(--green)",fontWeight:700}}>{eq.avail}</span>
                      {activeKit&&kitEntry&&<span style={{color:"var(--accent)",marginRight:6,fontWeight:700}}>· מקס׳ בערכה: {kitMax}</span>}
                    </div>
                  </div>
                  {!canBorrowEq(eq)
                    ? <div style={{fontSize:11,color:"var(--yellow)",fontWeight:700,textAlign:"center",maxWidth:120,lineHeight:1.3,padding:"4px 6px",background:"rgba(241,196,15,0.12)",borderRadius:6,border:"1px solid rgba(241,196,15,0.3)"}}>
                        🔒 טרם עבר/ה הסמכה
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
                        ⚠️ חסום ע״י השאלה באיחור
                      </div>
                    : <span className="badge badge-red">לא זמין</span>
                  }
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

// ─── STEP 4 CONFIRM ───────────────────────────────────────────────────────────
function Step4Confirm({ form, items, equipment, agreed, setAgreed, submitting, submit, onBack, policies, loanType, canSubmit }) {
  const [showPolicies, setShowPolicies] = useState(false);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);

  const policyText = (policies && policies[loanType]) || "";
  const hasPolicies = policyText.trim().length > 0;

  const handleScroll = (e) => {
    const el = e.target;
    if (el.scrollHeight - el.scrollTop <= el.clientHeight + 20) {
      setScrolledToBottom(true);
    }
  };

  return (
    <>
      <div className="form-section-title">סיכום ואישור</div>
      <div className="grid-2" style={{marginBottom:20}}>
        <div>{[["שם",form.student_name],["אימייל",form.email],["קורס",form.course],["סוג השאלה",form.loan_type],["מ",`${formatDate(form.borrow_date)}${form.borrow_time?" · "+form.borrow_time:""}`],["עד",`${formatDate(form.return_date)}${form.return_time?" · "+form.return_time:""}`]].map(([l,v])=><div key={l} className="req-detail-row"><span className="req-detail-label">{l}:</span><strong>{v}</strong></div>)}</div>
        <div>{items.map(i=>{
          const eq = equipment.find(e=>e.id==i.equipment_id);
          const img = eq?.image||"📦";
          const isFile = img.startsWith("data:")||img.startsWith("http");
          return <div key={i.equipment_id} className="req-detail-row">
            {isFile ? <img src={img} alt="" style={{width:20,height:20,objectFit:"cover",borderRadius:4,verticalAlign:"middle"}}/> : <span>{img}</span>}
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
          📋 נהלי ההשאלה — חובה לקרוא לפני שליחה
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
        <button className="btn btn-primary" disabled={!canSubmit||submitting} onClick={submit}>{submitting?"⏳ שולח...":"🚀 שלח בקשה"}</button>
      </div>

      {/* ── Fullscreen policies modal ── */}
      {showPolicies && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:4000,display:"flex",flexDirection:"column",direction:"rtl"}}>
          {/* Header */}
          <div style={{padding:"16px 20px",background:"var(--surface)",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
            <div style={{fontWeight:900,fontSize:17}}>📋 נהלי השאלה — {loanType}</div>
            <button className="btn btn-secondary btn-sm" onClick={()=>setShowPolicies(false)}>✕ סגור</button>
          </div>
          {/* Scrollable body */}
          <div
            onScroll={handleScroll}
            style={{flex:1,overflowY:"auto",padding:"24px 20px",background:"var(--surface2)",whiteSpace:"pre-wrap",fontSize:15,lineHeight:1.9,color:"var(--text)"}}>
            {policyText}
            {/* bottom anchor */}
            <div style={{height:60,display:"flex",alignItems:"center",justifyContent:"center",marginTop:24}}>
              {scrolledToBottom
                ? <span style={{color:"var(--green)",fontWeight:700,fontSize:14}}>✅ קראת את כל הנהלים</span>
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
              {scrolledToBottom ? "✅ אני מאשר/ת שקראתי את הנהלים — סגור" : "↓ גלול עד הסוף כדי לאשר"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── INFO PANEL ───────────────────────────────────────────────────────────────
function InfoPanel({ policies, kits, equipment, teamMembers, onClose, accentColor }) {
  const [tab, setTab] = useState("policies");
  const [selectedEq, setSelectedEq] = useState(null);  // equipment detail view
  const [infoCatFilter, setInfoCatFilter] = useState([]); // multi-select
  const tabs = [
    { id:"equipment", label:"📦 ציוד" },
    { id:"policies",  label:"📋 נהלים" },
    { id:"kits",      label:"🎒 ערכות" },
    { id:"contact",   label:"📞 צוות" },
  ];
  const LOAN_ICONS = { "פרטית":"👤","הפקה":"🎬","סאונד":"🎙️","קולנוע יומית":"🎥" };
  const allCats = [...new Set((equipment||[]).map(e=>e.category).filter(Boolean))];
  const visibleEq = infoCatFilter.length===0
    ? (equipment||[])
    : (equipment||[]).filter(e=>infoCatFilter.includes(e.category));

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:5000,display:"flex",alignItems:"stretch",justifyContent:"center",padding:"0",direction:"rtl","--accent":accentColor||"#f5a623","--accent2":accentColor||"#f5a623","--accent-glow":`${accentColor||"#f5a623"}2e`}}>
      <div style={{width:"100%",maxWidth:1100,background:"var(--surface)",display:"flex",flexDirection:"column",overflow:"hidden",margin:"0 auto",borderLeft:"1px solid var(--border)",borderRight:"1px solid var(--border)"}}>

        {/* Header */}
        <div style={{padding:"18px 28px",background:"var(--surface2)",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
          <div style={{flex:1}}>
            <div style={{fontWeight:900,fontSize:20,color:"var(--accent)"}}>ℹ️ מידע כללי — מחסן ציוד קמרה אובסקורה וסאונד</div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose} style={{fontSize:14,padding:"8px 18px"}}>✕ סגור</button>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",gap:0,borderBottom:"2px solid var(--border)",flexShrink:0}}>
          {tabs.map(t=>(
            <button key={t.id} type="button" onClick={()=>{setTab(t.id);setSelectedEq(null);}}
              style={{flex:1,padding:"14px 8px",border:"none",borderBottom:`3px solid ${tab===t.id?"var(--accent)":"transparent"}`,background:tab===t.id?"rgba(245,166,35,0.05)":"transparent",color:tab===t.id?"var(--accent)":"var(--text2)",fontWeight:tab===t.id?800:500,fontSize:15,cursor:"pointer",transition:"all 0.15s"}}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{flex:1,overflowY:"auto",padding:"24px 28px"}}>

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
                  {infoCatFilter.length>0&&<button type="button" onClick={()=>setInfoCatFilter([])} style={{padding:"5px 10px",borderRadius:20,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:11,cursor:"pointer"}}>✕ הכל</button>}
                </div>
              )}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:14}}>
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
                              ? <img src={eq.image} alt={eq.name} style={{width:80,height:80,objectFit:"contain",borderRadius:8}}/>
                              : <span style={{fontSize:48}}>{eq.image||"📦"}</span>}
                          </div>
                          <div style={{fontWeight:800,fontSize:14,textAlign:"center",marginBottom:4}}>{eq.name}</div>
                          <div style={{fontSize:11,color:"var(--accent)",fontWeight:700,textAlign:"center"}}>{eq.category}</div>
                          {eq.description&&<div style={{fontSize:12,color:"var(--text3)",marginTop:6,textAlign:"center",lineHeight:1.5,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{eq.description}</div>}
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
                    : <div style={{width:200,height:200,display:"flex",alignItems:"center",justifyContent:"center",fontSize:100}}>{selectedEq.image||"📦"}</div>
                  }
                </div>
                {/* Text */}
                <div style={{flex:1,minWidth:200,textAlign:"right"}}>
                  <div style={{fontWeight:900,fontSize:24,marginBottom:6}}>{selectedEq.name}</div>
                  <div style={{fontSize:14,color:"var(--accent)",fontWeight:700,marginBottom:14}}>{selectedEq.category}</div>
                  {selectedEq.description&&(
                    <div style={{fontSize:15,color:"var(--text2)",lineHeight:1.8,marginBottom:16,whiteSpace:"pre-wrap"}}>{selectedEq.description}</div>
                  )}
                  {selectedEq.notes&&(
                    <div style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"10px 14px",fontSize:13,color:"var(--text3)",lineHeight:1.6}}>
                      📝 <strong>הערות:</strong> {selectedEq.notes}
                    </div>
                  )}
                  <div style={{marginTop:16,display:"flex",gap:8,flexWrap:"wrap"}}>
                    {selectedEq.soundOnly&&<span style={{background:"rgba(245,166,35,0.12)",border:"1px solid rgba(245,166,35,0.4)",borderRadius:20,padding:"4px 12px",fontSize:12,color:"var(--accent)",fontWeight:700}}>🎙️ ציוד סאונד</span>}
                    {selectedEq.photoOnly&&<span style={{background:"rgba(39,174,96,0.12)",border:"1px solid rgba(39,174,96,0.35)",borderRadius:20,padding:"4px 12px",fontSize:12,color:"var(--green)",fontWeight:700}}>🎥 ציוד צילום</span>}
                  </div>
                </div>
              </div>
              <style>{`@media(max-width:600px){.info-detail-row{flex-direction:column!important;}}`}</style>
            </div>
          )}

          {/* ── POLICIES TAB ── */}
          {tab==="policies" && (
            <div style={{maxWidth:720,margin:"0 auto"}}>
              {["פרטית","הפקה","סאונד","קולנוע יומית"].map(lt=>{
                const text = policies[lt];
                if(!text) return null;
                return (
                  <div key={lt} style={{marginBottom:28}}>
                    <div style={{fontWeight:800,fontSize:16,color:"var(--accent)",marginBottom:10}}>{LOAN_ICONS[lt]} נהלי השאלה {lt}</div>
                    <div style={{fontSize:14,lineHeight:1.9,color:"var(--text2)",whiteSpace:"pre-wrap",background:"var(--surface2)",borderRadius:"var(--r)",padding:"18px 20px",border:"1px solid var(--border)"}}>{text}</div>
                  </div>
                );
              })}
              {!policies?.פרטית && !policies?.הפקה && !policies?.סאונד &&
                <div style={{textAlign:"center",color:"var(--text3)",fontSize:14,padding:"40px 0"}}>לא הוגדרו נהלים עדיין</div>}
            </div>
          )}

          {/* ── KITS TAB ── */}
          {tab==="kits" && (
            <div style={{display:"flex",flexDirection:"column",gap:20,maxWidth:800,margin:"0 auto"}}>
              {(kits||[]).length===0
                ? <div style={{textAlign:"center",color:"var(--text3)",fontSize:14,padding:"40px 0"}}>אין ערכות מוגדרות עדיין</div>
                : (kits||[]).filter(k=>k.kitType!=="lesson").map(kit=>(
                  <div key={kit.id} style={{background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",padding:"20px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:kit.description?8:14}}>
                      <span style={{fontWeight:900,fontSize:17}}>🎒 {kit.name}</span>
                      {kit.loanType&&<span style={{fontSize:12,background:"var(--accent-glow)",border:"1px solid var(--accent)",borderRadius:20,padding:"2px 10px",color:"var(--accent)",fontWeight:700}}>{LOAN_ICONS[kit.loanType]||"📦"} {kit.loanType}</span>}
                    </div>
                    {kit.description&&(
                      <div style={{fontSize:14,color:"var(--text2)",marginBottom:14,lineHeight:1.7,background:"var(--surface)",borderRadius:"var(--r-sm)",padding:"10px 14px",border:"1px solid var(--border)"}}>{kit.description}</div>
                    )}
                    <div style={{fontSize:12,fontWeight:700,color:"var(--text3)",marginBottom:8,letterSpacing:0.5,textTransform:"uppercase"}}>פריטים בערכה:</div>
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      {(kit.items||[]).map((item,j)=>{
                        const eq = equipment.find(e=>e.id==item.equipment_id);
                        const isImg = eq?.image?.startsWith("data:")||eq?.image?.startsWith("http");
                        return (
                          <div key={j} style={{display:"flex",alignItems:"center",gap:12,background:"var(--surface)",borderRadius:"var(--r-sm)",padding:"10px 14px",border:"1px solid var(--border)"}}>
                            <div style={{width:40,height:40,flexShrink:0,borderRadius:6,overflow:"hidden",background:"var(--surface2)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                              {isImg ? <img src={eq.image} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}}/> : <span style={{fontSize:22}}>{eq?.image||"📦"}</span>}
                            </div>
                            <div style={{flex:1}}>
                              <div style={{fontWeight:700,fontSize:14}}>{item.name}</div>
                              {eq?.description&&<div style={{fontSize:12,color:"var(--text3)",marginTop:2,lineHeight:1.5}}>{eq.description}</div>}
                            </div>
                            <span style={{background:"var(--surface2)",border:"1px solid var(--accent)",borderRadius:8,padding:"3px 12px",fontWeight:900,color:"var(--accent)",fontSize:14,flexShrink:0}}>×{item.quantity}</span>
                          </div>
                        );
                      })}
                      {(kit.items||[]).length===0&&<div style={{color:"var(--text3)",fontSize:13}}>אין פריטים בערכה זו</div>}
                    </div>
                  </div>
                ))
              }
            </div>
          )}

          {/* ── CONTACT TAB ── */}
          {tab==="contact" && (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14,maxWidth:900,margin:"0 auto"}}>
              {(teamMembers||[]).length===0
                ? <div style={{textAlign:"center",color:"var(--text3)",fontSize:14,padding:"40px 0",gridColumn:"1/-1"}}>אין אנשי צוות מוגדרים</div>
                : (teamMembers||[]).map(m=>(
                  <div key={m.id} style={{background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",padding:"18px 20px",display:"flex",gap:14,alignItems:"flex-start"}}>
                    <div style={{width:48,height:48,borderRadius:"50%",background:"linear-gradient(135deg,var(--accent),rgba(245,166,35,0.5))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:900,flexShrink:0,color:"#000"}}>{m.name?.[0]||"?"}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:800,fontSize:15,marginBottom:4}}>{m.name}</div>
                      {m.phone&&<div style={{fontSize:13,color:"var(--text2)",marginBottom:2}}>📞 {m.phone}</div>}
                      <div style={{fontSize:12,color:"var(--text3)",wordBreak:"break-all"}}>✉️ {m.email}</div>
                    </div>
                  </div>
                ))
              }
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ─── PUBLIC FORM (removed — now imported from components/PublicForm.jsx) ──────
function PublicForm_REMOVED({ equipment, reservations, setReservations, showToast, categories=DEFAULT_CATEGORIES, kits=[], teamMembers=[], policies={}, certifications={types:[],students:[]}, deptHeads=[], calendarToken="", siteSettings={} }) {
  const initialParams = new URLSearchParams(window.location.search);
  const initialLoanTypeParam = initialParams.get("loan_type");
  const initialStepParam = Number(initialParams.get("step"));
  const initialLoanType = ["פרטית","הפקה","סאונד","קולנוע יומית"].includes(initialLoanTypeParam || "") ? initialLoanTypeParam : "";
  const initialStep = initialParams.get("calendar")==="1"
    ? 2
    : (Number.isInteger(initialStepParam) && initialStepParam >= 1 && initialStepParam <= 4 ? initialStepParam : 1);
  const [step, setStep]       = useState(initialStep);
  const swipeTouchRef = useRef(null);
  const [form, setForm]       = useState({student_name:"",email:"",phone:"",course:"",project_name:"",borrow_date:"",borrow_time:"",return_date:"",return_time:"",loan_type:initialLoanType,sound_day_loan:false,crew_photographer_name:"",crew_photographer_phone:"",crew_sound_name:"",crew_sound_phone:""});
  const [items, setItems]     = useState([]);
  const [agreed, setAgreed]   = useState(false);
  const [done, setDone]       = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [submitting, setSub]  = useState(false);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const set = (k,v) => setForm(p=>({...p,[k]:v}));
  const setSoundDayLoan = (enabled) => {
    if (!enabled) {
      setForm((prev) => ({ ...prev, sound_day_loan:false }));
      return;
    }
    const targetDate = getNextSoundDayLoanDate(
      ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30"]
    );
    setForm((prev) => ({
      ...prev,
      sound_day_loan:true,
      borrow_date: targetDate,
      return_date: targetDate,
      borrow_time: "",
      return_time: "",
    }));
  };

  const minDays = form.loan_type==="פרטית" ? 2 : form.loan_type==="סאונד" ? 0 : form.loan_type==="קולנוע יומית" ? 0 : 7;
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
  const moveToNextWeekday = (dateStr) => {
    const d = parseLocalDate(dateStr);
    while (d.getDay() === 5 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return formatLocalDateInput(d);
  };
  const borrowWeekend = isWeekend(form.borrow_date);
  const returnWeekend = isWeekend(form.return_date);
  const minDate = (() => {
    if (isCinemaLoan) {
      // Cinema: 24h ahead minimum
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return moveToNextWeekday(formatLocalDateInput(d));
    }
    const d = new Date();
    d.setDate(d.getDate() + minDays);
    return moveToNextWeekday(formatLocalDateInput(d));
  })();
  const maxDays = form.loan_type==="פרטית" ? 4 : isCinemaLoan ? 1 : 7;
  const tooSoon = form.loan_type!=="סאונד" && !isCinemaLoan && !!form.borrow_date && form.borrow_date < minDate;
  const cinemaTooSoon = isCinemaLoan && !!form.borrow_date && form.borrow_date < minDate;
  const loanDays = (form.borrow_date && form.return_date)
    ? Math.ceil((parseLocalDate(form.return_date) - parseLocalDate(form.borrow_date)) / 86400000) + 1
    : 0;
  const tooLong = loanDays > maxDays;
  const CINEMA_TIME_SLOTS = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30","20:00","20:30","21:00"];
  const TIME_SLOTS = (form.loan_type==="סאונד" || isCinemaLoan)
    ? CINEMA_TIME_SLOTS
    : ["09:00","09:30","14:30","15:00","15:30","16:00","16:30","17:00","17:30"];
  const isSoundLoan = form.loan_type==="סאונד";
  const isProductionLoan = form.loan_type==="הפקה";
  const isSoundDayLoan = isSoundLoan && !!form.sound_day_loan;
  const soundDayLoanDate = isSoundDayLoan ? getNextSoundDayLoanDate(TIME_SLOTS) : "";
  const disableSoundDayHourLimit = true;
  const availableBorrowSlots = isSoundDayLoan && !disableSoundDayHourLimit ? getFutureTimeSlotsForDate(soundDayLoanDate, TIME_SLOTS) : TIME_SLOTS;
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
    ? cinemaMaxReturnSlots
    : isSoundDayLoan
      ? disableSoundDayHourLimit
        ? TIME_SLOTS
        : availableBorrowSlots.filter((slot) => !form.borrow_time || toDateTime(soundDayLoanDate, slot) > toDateTime(soundDayLoanDate, form.borrow_time))
      : TIME_SLOTS;
  const ok1 = form.student_name && form.email && form.phone && form.course && form.loan_type &&
    (!isProductionLoan || form.crew_photographer_name);

  // ── Certification lookup ──
  const normalizePhone = (p) => (p||"").replace(/[^0-9]/g,"");
  const matchCertificationStudentByNamePhone = (name, phone) => {
    const normalizedName = normalizeName(name);
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedName || !normalizedPhone) return null;
    return (certifications.students||[]).find(s =>
      normalizeName(s.name) === normalizedName &&
      normalizePhone(s.phone) === normalizedPhone
    ) || null;
  };
  const studentRecord = (certifications.students||[]).find(s =>
    s.email?.toLowerCase().trim() === form.email?.toLowerCase().trim() &&
    normalizePhone(s.phone) === normalizePhone(form.phone)
  );
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
    const certId = eq.certification_id;
    // For production: pass if photographer OR sound person has cert
    if (isProductionLoan) {
      return crewPhotographerCerts[certId]==="עבר" || crewSoundCerts[certId]==="עבר";
    }
    return studentCerts[certId] === "עבר";
  };
  const privateLoanLimitedQty = form.loan_type==="פרטית" ? getPrivateLoanLimitedQty(items, equipment) : 0;
  const privateLoanLimitExceeded = form.loan_type==="פרטית" && privateLoanLimitedQty > 4;
  const sameDay = form.borrow_date && form.return_date && form.borrow_date === form.return_date;
  const timeOrderError = sameDay && form.borrow_time && form.return_time && toDateTime(form.return_date, form.return_time) <= toDateTime(form.borrow_date, form.borrow_time);
  const returnBeforeBorrow = form.borrow_date && form.return_date && parseLocalDate(form.return_date) < parseLocalDate(form.borrow_date);
  const hasTimes = !!form.borrow_time && !!form.return_time;
  const ok2 = !!form.borrow_date && !!form.return_date && hasTimes && !returnBeforeBorrow && !tooSoon && !cinemaTooSoon && !tooLong && !borrowWeekend && !returnWeekend && !timeOrderError;
  const ok3 = items.some(item => Number(item.quantity) > 0);
  const canSubmit = !!ok1 && !!ok2 && !!ok3 && !privateLoanLimitExceeded && !!agreed;

  const availEq = useMemo(()=>{
    if(!form.borrow_date||!form.return_date) return [];
    return equipment.map(eq=>{
      const avail = getAvailable(eq.id,form.borrow_date,form.return_date,reservations,equipment,null,form.borrow_time,form.return_time);
      // Check if the 0-availability is caused by an overdue reservation holding this item
      const overdueBlocked = avail === 0 && reservations.some(r =>
        r.status === "באיחור" && (r.items||[]).some(i => i.equipment_id == eq.id && Number(i.quantity) > 0)
      );
      return {...eq, avail, overdueBlocked};
    });
  },[form.borrow_date,form.return_date,form.borrow_time,form.return_time,equipment,reservations]);

  const getItem = id => items.find(i=>i.equipment_id==id)||{quantity:0};
  const setQty  = (id,qty) => {
    const avail = availEq.find(e=>e.id==id)?.avail||0;
    const q = Math.max(0,Math.min(qty,avail));
    const name = equipment.find(e=>e.id==id)?.name||"";
    setItems(prev => q===0 ? prev.filter(i=>i.equipment_id!=id) : prev.find(i=>i.equipment_id==id) ? prev.map(i=>i.equipment_id==id?{...i,quantity:q}:i) : [...prev,{equipment_id:id,quantity:q,name}]);
  };

  const canAccessStep = (targetStep) => {
    if (targetStep <= 3) return true;
    if (targetStep === 4) return !!ok1 && !!ok2 && !!ok3 && !privateLoanLimitExceeded;
    return false;
  };

  const goToStep = (targetStep) => {
    if (targetStep === step) return;
    if (targetStep <= 3) {
      setStep(targetStep);
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
    showToast("error", "יש להשלים את שלבי פרטים, תאריכים וציוד לפני המעבר לשלב האישור.");
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
      // Notify dept heads for this loan type
      const relevantDeptHeads = (deptHeads||[]).filter(dh =>
        dh?.email && isValidEmailAddress(dh.email) &&
        Array.isArray(dh.loanTypes) && dh.loanTypes.includes(res.loan_type)
      );
      if (relevantDeptHeads.length > 0) {
        const approveUrl = `${window.location.origin}/api/approve-production?id=${res.id}`;
        const calendarUrl = calendarToken ? `${window.location.origin}/calendar?token=${calendarToken}` : "";
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
                project_name:   res.project_name||"",
                crew_photographer: res.crew_photographer_name||"",
                crew_sound:     res.crew_sound_name||"",
                approve_url:    approveUrl,
                calendar_url:   calendarUrl,
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
    if (!ok1 || !ok2 || !ok3 || privateLoanLimitExceeded) {
      if (privateLoanLimitExceeded) {
        showToast("error", "שים לב אין לחרוג מ-4 פריטים בהשאלה פרטית");
        setStep(3);
        return;
      }
      showToast("error", "לא ניתן לשלוח בקשה לפני השלמת כל שלבי הטופס, כולל תאריכים, שעות ובחירת ציוד.");
      if (!ok1) setStep(1);
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
    // This prevents two students submitting simultaneously from both "seeing" free stock
    let freshReservations = reservations;
    try {
      const fresh = (await storageGet("reservations")).value;
      if (Array.isArray(fresh)) {
        freshReservations = fresh;
        setReservations(fresh); // update local state too
      }
    } catch(e) {
      console.warn("Could not refresh reservations before submit:", e);
    }

    // ── Re-validate availability against fresh data ──
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
    const newRes = { ...form, id:Date.now(), status:initStatus, created_at:today(), submitted_at:new Date().toLocaleString("he-IL",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Jerusalem"}), items };
    const updated = [...freshReservations, newRes];
    setReservations(updated);
    await storageSet("reservations", updated);
    await sendEmail(newRes);
    setSub(false);
    setDone(true);
    showToast("success","הבקשה נשלחה בהצלחה!");
  };

  const reset = () => { setDone(false); setEmailError(false); setStep(1); setForm({student_name:"",email:"",phone:"",course:"",project_name:"",borrow_date:"",borrow_time:"",return_date:"",return_time:"",loan_type:"",sound_day_loan:false,crew_photographer_name:"",crew_photographer_phone:"",crew_sound_name:"",crew_sound_phone:""}); setItems([]); setAgreed(false); };

  const handleFormSwipeStart = (e) => {
    swipeTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const handleFormSwipeEnd = (e) => {
    if (!swipeTouchRef.current) return;
    const dx = e.changedTouches[0].clientX - swipeTouchRef.current.x;
    const dy = e.changedTouches[0].clientY - swipeTouchRef.current.y;
    swipeTouchRef.current = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0) goToStep(Math.min(step + 1, 4));
    else goToStep(Math.max(step - 1, 1));
  };

  if(emailError) return (
    <div className="form-page">
      <div style={{width:"100%",maxWidth:500,background:"var(--surface)",border:"1px solid rgba(231,76,60,0.4)",borderRadius:16,padding:40,textAlign:"center",direction:"rtl"}}>
        <div style={{fontSize:64,marginBottom:16}}>❌</div>
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

  if(done) return (
    <div className="form-page">
      <div style={{width:"100%",maxWidth:500,background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,padding:40,textAlign:"center",direction:"rtl"}}>
        <div style={{fontSize:64,marginBottom:16}}>✅</div>
        <h2 style={{fontSize:24,fontWeight:900,color:"var(--accent)",marginBottom:8}}>הבקשה נשלחה!</h2>
        <p style={{fontSize:14,color:"var(--text2)",marginBottom:28}}>בקשתך התקבלה בהצלחה.<br/>צוות המכללה יעבור עליה לאישורה הסופי.</p>
        <button className="btn btn-secondary" onClick={reset}>🔄 שלח בקשה נוספת</button>
      </div>
    </div>
  );

  return (
    <>
    <div className="form-page" style={{"--accent": siteSettings.accentColor||"#f5a623","--accent2": siteSettings.accentColor||"#f5a623","--accent-glow":`${siteSettings.accentColor||"#f5a623"}2e`}} onTouchStart={handleFormSwipeStart} onTouchEnd={handleFormSwipeEnd}>
      <div className="form-card">
        <div className="form-card-header" style={{position:"relative"}}>
          <button type="button" onClick={()=>setShowInfoPanel(true)}
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
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center",paddingInline:"24px"}}>
            {siteSettings.logo
              ? <img src={siteSettings.logo} alt="לוגו" style={{width:82,height:82,objectFit:"contain",borderRadius:12,marginBottom:siteSettings.soundLogo?6:12}}/>
              : <div style={{fontSize:48,marginBottom:siteSettings.soundLogo?6:12}}>🎬</div>}
            {siteSettings.soundLogo && (
              <img src={siteSettings.soundLogo} alt="לוגו סאונד" style={{width:82,height:82,objectFit:"contain",borderRadius:12,marginBottom:12}}/>
            )}
            <div style={{fontSize:24,fontWeight:900,color:"var(--accent)"}}>מחסן השאלת ציוד קמרה אובסקורה וסאונד</div>
            <div style={{fontSize:14,color:"var(--text2)",marginTop:4}}>טופס השאלת ציוד</div>
          </div>
          {/* Clickable tab navigation — always free to navigate, validation only on submit */}
            <div style={{display:"flex",gap:4,marginTop:20,background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:4}}>
              {[{n:1,l:"פרטים",icon:"👤"},{n:2,l:"תאריכים",icon:"📅"},{n:3,l:"ציוד",icon:"📦"},{n:4,l:"אישור",icon:"✅"}].map(s=>{
              const done = (s.n===1 && ok1) || (s.n===2 && ok2) || (s.n===3 && ok3) || (s.n===4 && canSubmit);
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
        </div>
        <div className="form-card-body">

          {step===1 && <>
            <div className="form-section-title">סוג ההשאלה</div>
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:24}}>
              {[
                {val:"פרטית",icon:"👤",desc:"שימוש אישי / לימודי"},
                {val:"הפקה",icon:"🎬",desc:"פרויקט הפקה מאורגן"},
                {val:"סאונד",icon:"🎙️",desc:"לתרגול הקלטות באולפני המכללה (עבור הנדסאי סאונד בלבד)"},
                {val:"קולנוע יומית",icon:"🎥",desc:"תרגול חופשי עם ציוד קולנוע למספר שעות — יש להזמין 24 שעות מראש"},
              ].map(opt=>(
                <div key={opt.val} onClick={()=>{
                  setForm((prev) => ({
                    ...prev,
                    loan_type: opt.val,
                    sound_day_loan: opt.val==="סאונד" ? prev.sound_day_loan : false,
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
                  {form.loan_type===opt.val&&<div style={{fontSize:16,color:"var(--accent)",fontWeight:900,flexShrink:0}}>✓</div>}
                </div>
              ))}
            </div>
            <div className="form-section-title">{isProductionLoan ? "פרטי ההפקה" : "פרטי הסטודנט"}</div>
            {isProductionLoan && (
              <div style={{background:"rgba(245,166,35,0.08)",border:"1px solid rgba(245,166,35,0.25)",borderRadius:"var(--r-sm)",padding:"10px 14px",fontSize:12,color:"var(--text2)",marginBottom:14}}>
                💡 <strong>במאי ההפקה</strong> הוא האחראי הראשי על קבלתו והחזרתו התקינה של הציוד
              </div>
            )}
            <div className="grid-2">
              <div className="form-group"><label className="form-label">{isProductionLoan?"שם במאי ההפקה *":"שם מלא *"}</label><input className="form-input" name="student_name" autoComplete="name" value={form.student_name} onChange={e=>set("student_name",e.target.value)}/></div>
              <div className="form-group"><label className="form-label">טלפון *</label><input className="form-input" name="phone" autoComplete="tel" value={form.phone} onChange={e=>set("phone",e.target.value)}/></div>
            </div>
            <div className="form-group"><label className="form-label">אימייל *</label><input type="email" className="form-input" name="email" autoComplete="email" value={form.email} onChange={e=>set("email",e.target.value)}/></div>
            <div className="grid-2">
              <div className="form-group"><label className="form-label">קורס / כיתה *</label><input className="form-input" value={form.course} onChange={e=>set("course",e.target.value)}/></div>
              <div className="form-group"><label className="form-label">שם הפרויקט</label><input className="form-input" value={form.project_name} onChange={e=>set("project_name",e.target.value)}/></div>
            </div>

            {isProductionLoan && (<>
              <div className="form-section-title" style={{marginTop:20}}>פרטי צוות ההפקה</div>
              <div style={{background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",padding:"16px",marginBottom:16}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>🎥 צלם ההפקה <span style={{color:"var(--red)",fontSize:11}}>* חובה</span></div>
                <div className="grid-2">
                  <div className="form-group"><label className="form-label">שם מלא *</label><input className="form-input" placeholder="שם הצלם" name="crew_photographer_name" autoComplete="name" value={form.crew_photographer_name} onChange={e=>set("crew_photographer_name",e.target.value)}/></div>
                  <div className="form-group"><label className="form-label">טלפון</label><input className="form-input" placeholder="05x-xxxxxxx" name="crew_photographer_phone" autoComplete="tel" value={form.crew_photographer_phone} onChange={e=>set("crew_photographer_phone",e.target.value)}/></div>
                </div>
              </div>
              <div style={{background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",padding:"16px",marginBottom:16}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>🎙️ איש הסאונד <span style={{color:"var(--text3)",fontSize:11}}>רשות</span></div>
                <div className="grid-2">
                  <div className="form-group"><label className="form-label">שם מלא</label><input className="form-input" placeholder="שם איש הסאונד" name="crew_sound_name" autoComplete="name" value={form.crew_sound_name} onChange={e=>set("crew_sound_name",e.target.value)}/></div>
                  <div className="form-group"><label className="form-label">טלפון</label><input className="form-input" placeholder="05x-xxxxxxx" name="crew_sound_phone" autoComplete="tel" value={form.crew_sound_phone} onChange={e=>set("crew_sound_phone",e.target.value)}/></div>
                </div>
              </div>
            </>)}

            <button className="btn btn-primary" disabled={!ok1} onClick={()=>setStep(2)}>המשך ← תאריכים</button>
          </>}

          {step===2 && <>
            <div className="form-section-title" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
              <span>תאריכים ושעות</span>
              {isSoundLoan && (
                <button
                  type="button"
                  className={`btn btn-sm ${isSoundDayLoan ? "btn-primary" : "btn-secondary"}`}
                  onClick={()=>setSoundDayLoan(!isSoundDayLoan)}
                >
                  השאלת יום
                </button>
              )}
            </div>
            {isSoundDayLoan && (
              <div className="highlight-box" style={{marginBottom:16}}>
                השאלת יום פעילה. התאריך חושב אוטומטית ל־{formatDate(soundDayLoanDate)} ושעות האיסוף/ההחזרה פתוחות עכשיו להזנה ידנית לצורך בדיקות.
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
                  <div className="form-group"><label className="form-label">📅 תאריך *</label>
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
            ) : (
              <>
                <div className="grid-2">
                  <div className="form-group"><label className="form-label">📅 תאריך השאלה *</label>{isSoundDayLoan ? <div className="form-input" style={{display:"flex",alignItems:"center",fontWeight:700}}>{formatDate(soundDayLoanDate)}</div> : <input type="date" className="form-input" min={minDate} value={form.borrow_date} onChange={e=>set("borrow_date",e.target.value)}/>}</div>
                  <div className="form-group"><label className="form-label">שעת איסוף *</label>
                    {isSoundDayLoan ? (
                      <input
                        type="time"
                        className="form-input"
                        value={form.borrow_time}
                        onChange={e=>set("borrow_time",e.target.value)}
                        placeholder="הקלד שעה"
                      />
                    ) : (
                      <select className="form-select" value={form.borrow_time} onChange={e=>setForm(prev=>({...prev,borrow_time:e.target.value,return_time:isSoundDayLoan && !disableSoundDayHourLimit && prev.return_time && toDateTime(soundDayLoanDate, prev.return_time) <= toDateTime(soundDayLoanDate, e.target.value) ? "" : prev.return_time}))}>
                        <option value="">-- בחר שעה --</option>
                        {availableBorrowSlots.map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                    )}
                  </div>
                </div>
                <div className="grid-2">
                  <div className="form-group"><label className="form-label">📅 תאריך החזרה *</label>{isSoundDayLoan ? <div className="form-input" style={{display:"flex",alignItems:"center",fontWeight:700}}>{formatDate(soundDayLoanDate)}</div> : <input type="date" className="form-input" min={form.borrow_date||today()} value={form.return_date} onChange={e=>set("return_date",e.target.value)}/>}</div>
                  <div className="form-group"><label className="form-label">שעת החזרה *</label>
                    {isSoundDayLoan ? (
                      <input
                        type="time"
                        className="form-input"
                        value={form.return_time}
                        onChange={e=>set("return_time",e.target.value)}
                        placeholder="הקלד שעה"
                      />
                    ) : (
                      <select className="form-select" value={form.return_time} onChange={e=>set("return_time",e.target.value)}>
                        <option value="">-- בחר שעה --</option>
                        {availableReturnSlots.map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              </>
            )}
            {(borrowWeekend||(returnWeekend&&!isCinemaLoan)) && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 המחסן אינו פעיל בימים שישי ושבת. נא לבחור ימים א׳–ה׳ בלבד.</div>}
            {tooSoon && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 {form.loan_type==="פרטית"?"השאלה פרטית דורשת התראה של 48 שעות לפחות.":"נדרשת התראה של שבוע לפחות."} תאריך מוקדם ביותר: <strong>{formatDate(minDate)}</strong></div>}
            {cinemaTooSoon && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 השאלת קולנוע יומית דורשת הזמנה של 24 שעות מראש. תאריך מוקדם ביותר: <strong>{formatDate(minDate)}</strong></div>}
            {tooLong && !isCinemaLoan && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 לא ניתן להשלים את התהליך כי זמן ההשאלה חורג מנהלי המכללה. משך מקסימלי: <strong>{maxDays} ימים</strong></div>}
            {returnBeforeBorrow && !isCinemaLoan && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 זמנים לא נכונים — תאריך החזרה חייב להיות אחרי תאריך ההשאלה.</div>}
            {timeOrderError && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 זמנים לא נכונים — שעת החזרה חייבת להיות אחרי שעת האיסוף באותו יום.</div>}
            {ok2 && <div className="highlight-box">{isCinemaLoan ? `🎥 השאלת קולנוע יומית · ${formatDate(form.borrow_date)} · ${form.borrow_time}–${form.return_time}` : `📅 השאלה ל-${loanDays} ימים · איסוף ${form.borrow_time} · החזרה ${form.return_time}`}</div>}

            {/* Mini calendar — approved reservations */}
            <PublicMiniCalendar key={form.loan_type || "הכל"} reservations={reservations} initialLoanType={form.loan_type || "הכל"} previewStart={form.borrow_date} previewEnd={form.return_date} previewName={form.student_name||"הבקשה שלך"}/>

            <div className="flex gap-2"><button className="btn btn-secondary" onClick={()=>setStep(1)}>← חזור</button><button className="btn btn-primary" disabled={!ok2} onClick={()=>setStep(3)}>המשך ← ציוד</button></div>
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
            studentRecord={studentRecord}
            certificationTypes={certifications.types||[]}
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
        </div>
      </div>
    </div>
    {showInfoPanel&&<InfoPanel policies={policies} kits={kits} equipment={equipment} teamMembers={teamMembers} onClose={()=>setShowInfoPanel(false)} accentColor={siteSettings.accentColor}/>}
    </>
  );
}

// ─── POLICIES PAGE ────────────────────────────────────────────────────────────
function PoliciesPage({ policies, setPolicies, showToast }) {
  const LOAN_TYPES = [
    { key:"פרטית", icon:"👤", label:"השאלה פרטית" },
    { key:"הפקה",  icon:"🎬", label:"השאלה להפקה" },
    { key:"סאונד", icon:"🎙️", label:"השאלת סאונד" },
    { key:"קולנוע יומית", icon:"🎥", label:"השאלת קולנוע יומית" },
  ];
  const [draft, setDraft] = useState({ ...policies });
  const [saving, setSaving] = useState(false);
  const [fsEdit, setFsEdit] = useState(null); // key being fullscreen-edited

  const save = async () => {
    setSaving(true);
    setPolicies(draft);
    const r = await storageSet("policies", draft);
    setSaving(false);
    if(r.ok) showToast("success", "הנהלים נשמרו בהצלחה ✅");
    else showToast("error", "❌ שגיאה בשמירת הנהלים");
  };

  const lt_active = LOAN_TYPES.find(l=>l.key===fsEdit);

  return (
    <div className="page">
      <div style={{marginBottom:20,fontSize:13,color:"var(--text3)"}}>
        הנהלים שתכתוב כאן יוצגו לסטודנטים בשלב האישור בטופס ההשאלה. הסטודנט יחויב לגלול ולקרוא לפני שיוכל לשלוח.
      </div>
      {LOAN_TYPES.map(lt=>(
        <div key={lt.key} className="card" style={{marginBottom:20}}>
          <div className="card-header">
            <div className="card-title">{lt.icon} נהלי {lt.label}</div>
            <button className="btn btn-secondary btn-sm" onClick={()=>setFsEdit(lt.key)}>✏️ עריכה מורחבת</button>
          </div>
          <textarea
            className="form-input"
            rows={6}
            placeholder={`כתוב כאן את נהלי ${lt.label}...`}
            value={draft[lt.key]||""}
            onChange={e=>setDraft(p=>({...p,[lt.key]:e.target.value}))}
            style={{resize:"vertical",fontFamily:"inherit",lineHeight:1.7,fontSize:13}}
          />
        </div>
      ))}
      <button className="btn btn-primary" disabled={saving} onClick={save}>
        {saving ? "⏳ שומר..." : "💾 שמור נהלים"}
      </button>

      {/* Fullscreen editor */}
      {fsEdit&&lt_active&&(
        <div style={{position:"fixed",inset:0,background:"var(--bg)",zIndex:4000,display:"flex",flexDirection:"column",direction:"rtl"}}>
          <div style={{padding:"16px 20px",background:"var(--surface)",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
            <div style={{fontWeight:900,fontSize:17}}>{lt_active.icon} עריכת נהלי {lt_active.label}</div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-primary btn-sm" onClick={async()=>{ await save(); setFsEdit(null); }}>💾 שמור וסגור</button>
              <button className="btn btn-secondary btn-sm" onClick={()=>setFsEdit(null)}>✕ סגור</button>
            </div>
          </div>
          <textarea
            value={draft[fsEdit]||""}
            onChange={e=>setDraft(p=>({...p,[fsEdit]:e.target.value}))}
            style={{flex:1,padding:"20px",background:"var(--surface2)",border:"none",outline:"none",resize:"none",fontFamily:"inherit",fontSize:15,lineHeight:1.9,color:"var(--text)",direction:"rtl"}}
            placeholder={`כתוב כאן את נהלי ${lt_active.label}...`}
          />
        </div>
      )}
    </div>
  );
}

// ─── ARCHIVE PAGE ─────────────────────────────────────────────────────────────
function ArchivePage({ reservations, setReservations, equipment, showToast }) {
  const archived = reservations.filter(r => r.status === "הוחזר");
  const [search, setSearch] = useState("");
  const [sectionF, setSectionF] = useState("הכל"); // "הכל" | "השאלות" | "שיעורים"
  const [loanTypeF, setLoanTypeF] = useState("הכל");
  const [viewRes, setViewRes] = useState(null);

  const deleteRes = async (id) => {
    if(!window.confirm("למחוק בקשה זו מהארכיון לצמיתות?")) return;
    const updated = reservations.filter(r=>r.id!==id);
    setReservations(updated);
    await storageSet("reservations", updated);
    showToast("success", "הבקשה נמחקה מהארכיון");
    if(viewRes?.id===id) setViewRes(null);
  };

  const eqName = id => equipment.find(e=>e.id==id)?.name||"?";
  const EqImg = ({id,size=20}) => {
    const img = equipment.find(e=>e.id==id)?.image||"📦";
    return img.startsWith("data:")||img.startsWith("http")
      ? <img src={img} alt="" style={{width:size,height:size,objectFit:"cover",borderRadius:4,verticalAlign:"middle"}}/>
      : <span style={{fontSize:size*0.8}}>{img}</span>;
  };

  const LOAN_ICONS = {"פרטית":"👤","הפקה":"🎬","סאונד":"🎙️","קולנוע יומית":"🎥","שיעור":"📽️"};
  const sortByReturned = arr => [...arr].sort((a,b)=>(new Date(b.returned_at||b.return_date).getTime())-(new Date(a.returned_at||a.return_date).getTime()));

  const matchesSearch = r => !search || r.student_name?.includes(search) || r.email?.includes(search) || r.course?.includes(search);

  const lessonArchive = sortByReturned(archived.filter(r=>r.loan_type==="שיעור"&&matchesSearch(r)));
  const studentArchive = sortByReturned(archived.filter(r=>r.loan_type!=="שיעור"&&matchesSearch(r)&&(loanTypeF==="הכל"||r.loan_type===loanTypeF)));

  const showLessons  = sectionF==="הכל"||sectionF==="שיעורים";
  const showStudents = sectionF==="הכל"||sectionF==="השאלות";
  const totalShown   = (showLessons?lessonArchive.length:0)+(showStudents?studentArchive.length:0);

  const ResCard = ({r}) => {
    const isLesson = r.loan_type==="שיעור";
    return (
      <div key={r.id}
        onClick={()=>setViewRes(r)}
        style={{background:isLesson?"rgba(155,89,182,0.06)":"var(--surface)",border:isLesson?"1px solid rgba(155,89,182,0.3)":"1px solid var(--border)",borderRadius:"var(--r)",padding:"14px 18px",cursor:"pointer",transition:"border-color .15s"}}
        onMouseEnter={e=>{e.currentTarget.style.borderColor=isLesson?"rgba(155,89,182,0.55)":"var(--accent)";}}
        onMouseLeave={e=>{e.currentTarget.style.borderColor=isLesson?"rgba(155,89,182,0.3)":"var(--border)";}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:34,height:34,borderRadius:"50%",background:isLesson?"rgba(155,89,182,0.2)":"rgba(52,152,219,0.15)",border:`2px solid ${isLesson?"#9b59b6":"var(--blue)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:900,flexShrink:0,color:isLesson?"#9b59b6":"var(--blue)"}}>{isLesson?"📽️":r.student_name?.[0]||"?"}</div>
            <div>
              <div style={{fontWeight:700,fontSize:14}}>{r.student_name}{isLesson&&r.course&&<span style={{fontSize:11,color:"#9b59b6",fontWeight:700,marginRight:6}}>· {r.course}</span>}</div>
              <div style={{fontSize:11,color:"var(--text3)"}}>{r.email}</div>
            </div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
            {isLesson
              ? <span style={{background:"rgba(155,89,182,0.12)",color:"#9b59b6",border:"1px solid rgba(155,89,182,0.4)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>📽️ שיעור הסתיים</span>
              : <span style={{background:"rgba(52,152,219,0.12)",color:"var(--blue)",border:"1px solid rgba(52,152,219,0.4)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>🔵 הוחזר</span>}
            {r.loan_type&&!isLesson&&<span style={{background:"var(--surface3)",border:"1px solid var(--border)",borderRadius:20,padding:"2px 8px",fontSize:11,color:"var(--accent)",fontWeight:700}}>{LOAN_ICONS[r.loan_type]||"📦"} {r.loan_type}</span>}
            <button className="btn btn-danger btn-sm" onClick={e=>{e.stopPropagation();deleteRes(r.id);}}>🗑️</button>
          </div>
        </div>
        <div style={{marginTop:10,display:"flex",gap:16,fontSize:12,color:"var(--text2)",flexWrap:"wrap"}}>
          <span>📅 {formatDate(r.borrow_date)}{r.borrow_time&&<strong style={{color:"var(--accent)",marginRight:4}}> {r.borrow_time}</strong>}</span>
          <span>↩ {formatDate(r.return_date)}{r.return_time&&<strong style={{color:"var(--accent)",marginRight:4}}> {r.return_time}</strong>}</span>
          <span>📦 {r.items?.length||0} פריטים</span>
          {r.returned_at&&<span style={{color:"var(--text3)"}}>🕐 הוחזר: {new Date(r.returned_at).toLocaleDateString("he-IL")}</span>}
        </div>
        <div style={{marginTop:8,display:"flex",flexWrap:"wrap",gap:4}}>
          {r.items?.map((i,j)=><span key={j} className="chip"><EqImg id={i.equipment_id}/> {eqName(i.equipment_id)} ×{i.quantity}</span>)}
        </div>
      </div>
    );
  };

  const SectionHeader = ({label,color,count}) => (
    <div style={{display:"flex",alignItems:"center",gap:10,margin:"18px 0 10px",borderBottom:`2px solid ${color}22`,paddingBottom:8}}>
      <span style={{fontWeight:900,fontSize:15,color}}>{label}</span>
      <span style={{background:`${color}20`,color,border:`1px solid ${color}55`,borderRadius:20,padding:"1px 10px",fontSize:12,fontWeight:700}}>{count}</span>
    </div>
  );

  return (
    <div className="page">
      {/* ── Filters bar ── */}
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <div className="search-bar" style={{flex:1,minWidth:160}}><span>🔍</span><input placeholder="חיפוש לפי שם, מייל או קורס..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <span style={{fontSize:13,color:"var(--text3)"}}>סה״כ: <strong style={{color:"var(--text)"}}>{totalShown}</strong> בקשות</span>
      </div>

      {/* Section chips */}
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {[["הכל","📦 הכל","var(--text2)"],["השאלות","🎒 השאלות סטודנטים","var(--blue)"],["שיעורים","📽️ שיעורים","#9b59b6"]].map(([val,label,col])=>(
          <button key={val} onClick={()=>{setSectionF(val);if(val!=="השאלות")setLoanTypeF("הכל");}}
            style={{padding:"6px 16px",borderRadius:20,border:`1.5px solid ${sectionF===val?col:"var(--border)"}`,background:sectionF===val?`${col}22`:"transparent",color:sectionF===val?col:"var(--text2)",fontWeight:sectionF===val?700:400,fontSize:13,cursor:"pointer",transition:"all .15s"}}>
            {label}
          </button>
        ))}
        {/* loan type sub-filter — only when in השאלות mode */}
        {(sectionF==="השאלות"||sectionF==="הכל")&&(
          <select className="form-select" style={{width:130,fontSize:12,marginRight:"auto"}} value={loanTypeF} onChange={e=>setLoanTypeF(e.target.value)}>
            <option value="הכל">כל הסוגים</option>
            {["פרטית","הפקה","סאונד","קולנוע יומית"].map(t=><option key={t}>{t}</option>)}
          </select>
        )}
      </div>

      {totalShown===0
        ? <div className="empty-state"><div className="emoji">🗄️</div><p>אין בקשות בארכיון</p></div>
        : <>
          {/* ── Student loans section ── */}
          {showStudents&&studentArchive.length>0&&(
            <>
              <SectionHeader label="🎒 השאלות סטודנטים שהוחזרו" color="var(--blue)" count={studentArchive.length}/>
              <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:8}}>
                {studentArchive.map(r=><ResCard key={r.id} r={r}/>)}
              </div>
            </>
          )}
          {/* ── Lesson section ── */}
          {showLessons&&lessonArchive.length>0&&(
            <>
              <SectionHeader label="📽️ שיעורים שהסתיימו" color="#9b59b6" count={lessonArchive.length}/>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {lessonArchive.map(r=><ResCard key={r.id} r={r}/>)}
              </div>
            </>
          )}
        </>
      }

      {/* ── View-only details modal ── */}
      {viewRes&&(()=>{
        const isLesson = viewRes.loan_type==="שיעור";
        return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}} onClick={e=>e.target===e.currentTarget&&setViewRes(null)}>
          <div style={{width:"100%",maxWidth:560,background:"var(--surface)",borderRadius:16,border:`1px solid ${isLesson?"rgba(155,89,182,0.4)":"rgba(52,152,219,0.4)"}`,direction:"rtl",maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"18px 22px",borderBottom:"1px solid var(--border)",background:"var(--surface2)",borderRadius:"16px 16px 0 0",position:"sticky",top:0,zIndex:1}}>
              <div>
                <div style={{fontWeight:900,fontSize:17}}>{isLesson?"📽️ פרטי שיעור — ארכיון":"🗄️ פרטי השאלה — ארכיון"}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:3}}>{viewRes.student_name}</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={()=>setViewRes(null)}>✕ סגור</button>
            </div>
            <div style={{padding:"20px 22px",display:"flex",flexDirection:"column",gap:16}}>
              <div style={{display:"flex",justifyContent:"center"}}>
                {isLesson
                  ? <span style={{background:"rgba(155,89,182,0.12)",color:"#9b59b6",border:"1px solid rgba(155,89,182,0.4)",borderRadius:20,padding:"4px 18px",fontSize:13,fontWeight:700}}>📽️ שיעור הסתיים</span>
                  : <span style={{background:"rgba(52,152,219,0.12)",color:"var(--blue)",border:"1px solid rgba(52,152,219,0.4)",borderRadius:20,padding:"4px 18px",fontSize:13,fontWeight:700}}>🔵 הוחזר</span>}
              </div>
              <div style={{background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:"14px 16px"}}>
                <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",marginBottom:10,textTransform:"uppercase",letterSpacing:1}}>{isLesson?"פרטי שיעור":"פרטי סטודנט"}</div>
                {[["שם",viewRes.student_name],["מייל",viewRes.email],["טלפון",viewRes.phone||"—"],["קורס",viewRes.course],viewRes.project_name&&["שם פרויקט",viewRes.project_name]].filter(Boolean).map(([l,v])=>(
                  <div key={l} style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:6,gap:12}}>
                    <span style={{color:"var(--text3)",flexShrink:0}}>{l}:</span>
                    <span style={{fontWeight:600,textAlign:"left",direction:"ltr"}}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:"14px 16px"}}>
                <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",marginBottom:10,textTransform:"uppercase",letterSpacing:1}}>תאריכים</div>
                <div className="responsive-split">
                  {[["📅 השאלה",`${formatDate(viewRes.borrow_date)}${viewRes.borrow_time?" · "+viewRes.borrow_time:""}`],["↩ החזרה",`${formatDate(viewRes.return_date)}${viewRes.return_time?" · "+viewRes.return_time:""}`]].map(([l,v])=>(
                    <div key={l} style={{background:"var(--surface3)",borderRadius:"var(--r-sm)",padding:"10px 12px"}}>
                      <div style={{fontSize:11,color:"var(--text3)",marginBottom:4}}>{l}</div>
                      <div style={{fontWeight:700,fontSize:13,color:"var(--accent)"}}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:8,fontSize:12,color:"var(--text3)"}}>
                  סוג השאלה: <strong style={{color:"var(--text)"}}>{LOAN_ICONS[viewRes.loan_type]||"📦"} {viewRes.loan_type}</strong>
                </div>
              </div>
              <div style={{background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:"14px 16px"}}>
                <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",marginBottom:10,textTransform:"uppercase",letterSpacing:1}}>ציוד שהושאל</div>
                {viewRes.items?.map((i,j)=>(
                  <div key={j} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:"1px solid var(--border)"}}>
                    <EqImg id={i.equipment_id} size={28}/>
                    <span style={{flex:1,fontSize:13,fontWeight:600}}>{eqName(i.equipment_id)}</span>
                    <span style={{background:"var(--surface3)",border:"1px solid var(--border)",borderRadius:6,padding:"2px 10px",fontWeight:700,fontSize:13,color:"var(--accent)"}}>×{i.quantity}</span>
                  </div>
                ))}
                <div style={{marginTop:8,fontSize:12,color:"var(--text3)"}}>
                  סה״כ: <strong style={{color:"var(--text)"}}>{viewRes.items?.reduce((s,i)=>s+i.quantity,0)||0}</strong> יחידות
                </div>
                {viewRes.returned_at&&(
                  <div style={{marginTop:8,fontSize:12,color:"var(--text3)"}}>
                    הועבר לארכיון: <strong style={{color:"var(--text)"}}>{new Date(viewRes.returned_at).toLocaleString("he-IL")}</strong>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}

// ─── TEAM PAGE ────────────────────────────────────────────────────────────────
function TeamPage({ teamMembers, setTeamMembers, deptHeads=[], setDeptHeads, calendarToken="", collegeManager={}, setCollegeManager, showToast, managerToken="" }) {
  const LOAN_TYPES = ["פרטית","הפקה","סאונד","קולנוע יומית"];
  const LOAN_ICONS = { "פרטית":"👤", "הפקה":"🎬", "סאונד":"🎙️", "קולנוע יומית":"🎥" };
  const emptyForm = { name:"", email:"", phone:"", loanTypes:[...LOAN_TYPES] };
  const DH_LOAN_TYPES = ["הפקה","סאונד","קולנוע יומית"];
  const DH_LOAN_ICONS = { "הפקה":"🎬", "סאונד":"🎙️", "קולנוע יומית":"🎥" };
  const emptyDhForm = { name:"", email:"", role:"", loanTypes:[] };
  const [dhForm, setDhForm]     = useState(emptyDhForm);
  const [addingDh, setAddingDh] = useState(false);
  const [editDh, setEditDh]     = useState(null);
  const [editDhForm, setEditDhForm] = useState(emptyDhForm);
  const [dhSaving, setDhSaving] = useState(false);
  const [mgrForm, setMgrForm] = useState({ name: collegeManager.name||"", email: collegeManager.email||"" });
  const [mgrSaving, setMgrSaving] = useState(false);

  const saveMgr = async () => {
    setMgrSaving(true);
    const updated = { name: mgrForm.name.trim(), email: mgrForm.email.toLowerCase().trim() };
    setCollegeManager(updated);
    const r = await storageSet("collegeManager", updated);
    setMgrSaving(false);
    if(r.ok) showToast("success","פרטי מנהל המכללה נשמרו");
    else showToast("error","❌ שגיאה בשמירה");
  };

  const toggleDhLT = (form, setForm, lt) =>
    setForm(p=>({...p, loanTypes: p.loanTypes.includes(lt)?p.loanTypes.filter(x=>x!==lt):[...p.loanTypes,lt]}));

  const saveDeptHead = async () => {
    const name = dhForm.name.trim();
    const email = dhForm.email.toLowerCase().trim();
    if(!name||!email||!isValidEmailAddress(email)) { showToast("error","שם ומייל תקני חובה"); return; }
    if(dhForm.loanTypes.length===0) { showToast("error","יש לסמן לפחות סוג השאלה אחד"); return; }
    setDhSaving(true);
    const updated = [...deptHeads, { id:`dh_${Date.now()}`, name, email, role:dhForm.role.trim(), loanTypes:dhForm.loanTypes }];
    setDeptHeads(updated);
    const r = await storageSet("deptHeads", updated);
    setDhSaving(false);
    if(r.ok) { showToast("success", `${name} נוסף/ה כראש מחלקה`); setDhForm(emptyDhForm); setAddingDh(false); }
    else showToast("error","❌ שגיאה בשמירה");
  };

  const saveEditDh = async () => {
    const name = editDhForm.name.trim();
    const email = editDhForm.email.toLowerCase().trim();
    if(!name||!email||!isValidEmailAddress(email)) { showToast("error","שם ומייל תקני חובה"); return; }
    setDhSaving(true);
    const updated = deptHeads.map(dh=>dh.id===editDh.id ? {...dh,name,email,role:editDhForm.role.trim(),loanTypes:editDhForm.loanTypes} : dh);
    setDeptHeads(updated);
    const r = await storageSet("deptHeads", updated);
    setDhSaving(false);
    if(r.ok) { showToast("success","פרטי ראש המחלקה עודכנו"); setEditDh(null); }
    else showToast("error","❌ שגיאה בשמירה");
  };

  const delDh = async (id) => {
    if(!window.confirm("למחוק ראש מחלקה זה?")) return;
    const updated = deptHeads.filter(dh=>dh.id!==id);
    setDeptHeads(updated);
    await storageSet("deptHeads", updated);
    showToast("success","ראש המחלקה הוסר");
  };

  // Add-new form state
  const [addForm, setAddForm] = useState(emptyForm);
  // Edit modal state
  const [editMember, setEditMember] = useState(null); // the member being edited
  const [editForm, setEditForm] = useState(emptyForm);

  const toggleLT = (form, setForm, lt) =>
    setForm(p=>({...p, loanTypes: p.loanTypes.includes(lt)?p.loanTypes.filter(x=>x!==lt):[...p.loanTypes,lt]}));

  const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
  const hasDuplicateEmail = (email, excludeId = null) => teamMembers.some((member) =>
    member.id !== excludeId && normalizeEmail(member.email) === normalizeEmail(email)
  );
  const addEmail = normalizeEmail(addForm.email);
  const addInvalidEmail = !!addEmail && !isValidEmailAddress(addEmail);
  const addDuplicateEmail = !!addEmail && hasDuplicateEmail(addEmail);
  const editEmail = normalizeEmail(editForm.email);
  const editInvalidEmail = !!editEmail && !isValidEmailAddress(editEmail);
  const editDuplicateEmail = !!editEmail && hasDuplicateEmail(editEmail, editMember?.id || null);

  const saveNew = async () => {
    const name = addForm.name.trim();
    const email = normalizeEmail(addForm.email);
    if (!name || !email) return;
    if (!isValidEmailAddress(email)) {
      showToast("error", "כתובת המייל של איש הצוות אינה תקינה");
      return;
    }
    if (hasDuplicateEmail(email)) {
      showToast("error", "כתובת המייל הזו כבר קיימת בצוות");
      return;
    }
    const updated = [...teamMembers, { ...addForm, id: Date.now(), name, email, phone: addForm.phone?.trim()||"" }];
    setTeamMembers(updated);
    const _tmNew = await storageSet("teamMembers", updated);
    if(!_tmNew.ok) showToast("error", "❌ שגיאה בשמירה — נסה שוב");
    else showToast("success", `${name} נוסף לצוות`);
    setAddForm(emptyForm);
  };

  const saveEdit = async () => {
    const name = editForm.name.trim();
    const email = normalizeEmail(editForm.email);
    if (!name || !email) return;
    if (!isValidEmailAddress(email)) {
      showToast("error", "כתובת המייל של איש הצוות אינה תקינה");
      return;
    }
    if (hasDuplicateEmail(email, editMember.id)) {
      showToast("error", "כתובת המייל הזו כבר קיימת בצוות");
      return;
    }
    const updated = teamMembers.map(m => m.id===editMember.id ? {...m,...editForm,name,email,phone:editForm.phone?.trim()||""} : m);
    setTeamMembers(updated);
    const _tmEditRes = await storageSet("teamMembers", updated);
    if(!_tmEditRes.ok) showToast("error", "❌ שגיאה בשמירה — נסה שוב");
    else showToast("success", "איש צוות עודכן");
    setEditMember(null);
  };

  const del = async (id) => {
    const updated = teamMembers.filter(m => m.id!==id);
    setTeamMembers(updated);
    const _tmDelRes = await storageSet("teamMembers", updated);
    if(!_tmDelRes.ok) showToast("error", "❌ שגיאה בשמירה");
    else showToast("success", "איש צוות הוסר");
  };

  const renderLoanTypeButtons = (form, setForm) => (
    <div style={{display:"flex",gap:8,marginTop:6,flexWrap:"wrap"}}>
      {LOAN_TYPES.map(lt=>(
        <button key={lt} type="button" onClick={()=>toggleLT(form,setForm,lt)}
          style={{padding:"6px 14px",borderRadius:20,border:`2px solid ${form.loanTypes.includes(lt)?"var(--accent)":"var(--border)"}`,background:form.loanTypes.includes(lt)?"var(--accent-glow)":"var(--surface2)",color:form.loanTypes.includes(lt)?"var(--accent)":"var(--text2)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
          {LOAN_ICONS[lt]} {lt}
        </button>
      ))}
    </div>
  );

  return (
    <div className="page">
      {/* ── College manager section ── */}
      <div className="card" style={{marginBottom:24,border:"2px solid rgba(52,152,219,0.3)",background:"rgba(52,152,219,0.04)"}}>
        <div className="card-header">
          <div className="card-title">🏫 מנהל המכללה</div>
        </div>
        <div style={{fontSize:12,color:"var(--text3)",marginBottom:14}}>
          מנהל המכללה יכול לקבל דיווחים על בקשות בעייתיות ועל ציוד פגום מצוות המחסן.
        </div>
        <div className="grid-2" style={{marginBottom:14}}>
          <div className="form-group"><label className="form-label">שם מלא</label>
            <input className="form-input" placeholder="שם מנהל המכללה" value={mgrForm.name} onChange={e=>setMgrForm(p=>({...p,name:e.target.value}))}/></div>
          <div className="form-group"><label className="form-label">כתובת מייל</label>
            <input className="form-input" type="email" placeholder="manager@college.ac.il" value={mgrForm.email} onChange={e=>setMgrForm(p=>({...p,email:e.target.value}))}/></div>
        </div>
        {collegeManager.email&&(
          <div style={{fontSize:12,color:"var(--green)",marginBottom:10}}>✅ מוגדר: <strong>{collegeManager.name}</strong> ({collegeManager.email})</div>
        )}
        <button className="btn btn-primary" disabled={!mgrForm.name.trim()||!mgrForm.email.trim()||mgrSaving} onClick={saveMgr}>
          {mgrSaving?"⏳ שומר...":"💾 שמור פרטי מנהל"}
        </button>
        {managerToken&&(
          <div style={{marginTop:14,background:"rgba(52,152,219,0.08)",border:"1px solid rgba(52,152,219,0.25)",borderRadius:"var(--r-sm)",padding:"10px 14px",fontSize:12}}>
            <div style={{fontWeight:700,marginBottom:6,color:"#3498db"}}>🔗 קישור לוח שנה למנהל המכללה</div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <code style={{fontSize:11,background:"var(--surface3)",padding:"3px 8px",borderRadius:4,flex:1,wordBreak:"break-all",color:"var(--text2)"}}>
                {window.location.origin}/manager-calendar?token={managerToken}
              </code>
              <button className="btn btn-secondary btn-sm" onClick={()=>{navigator.clipboard.writeText(`${window.location.origin}/manager-calendar?token=${managerToken}`);showToast("success","הקישור הועתק!");}}>
                📋 העתק
              </button>
            </div>
            <div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>שלח קישור זה למנהל — הוא יוכל לצפות ולשנות סטטוסים של כל הבקשות</div>
          </div>
        )}
      </div>

      {/* ── Dept heads section ── */}
      <div className="card" style={{marginBottom:24,border:"2px solid rgba(155,89,182,0.3)",background:"rgba(155,89,182,0.04)"}}>
        <div className="card-header">
          <div className="card-title">🎓 ראשי מחלקות</div>
          <button className="btn btn-primary btn-sm" onClick={()=>setAddingDh(p=>!p)}>
            {addingDh?"✕ ביטול":"➕ הוסף ראש מחלקה"}
          </button>
        </div>
        <div style={{fontSize:12,color:"var(--text3)",marginBottom:10}}>
          ראש מחלקה מקבל מייל על השאלות מהסוגים שסומנו ויכול לאשר אותן לפני שהצוות רואה אותן.
          אם לא מוגדר ראש מחלקה לסוג ההשאלה — הבקשה תעבור ישירות לסטטוס <strong style={{color:"var(--text)"}}>ממתין</strong>.
        </div>
        {calendarToken && (
          <div style={{background:"rgba(155,89,182,0.08)",border:"1px solid rgba(155,89,182,0.25)",borderRadius:"var(--r-sm)",padding:"10px 14px",marginBottom:14,fontSize:12}}>
            <div style={{fontWeight:700,marginBottom:6,color:"#9b59b6"}}>🔗 קישור לוח שנה לראשי מחלקות</div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <code style={{fontSize:11,background:"var(--surface3)",padding:"3px 8px",borderRadius:4,flex:1,wordBreak:"break-all",color:"var(--text2)"}}>
                {window.location.origin}/calendar?token={calendarToken}
              </code>
              <button className="btn btn-secondary btn-sm" onClick={()=>{navigator.clipboard.writeText(`${window.location.origin}/calendar?token=${calendarToken}`);showToast("success","הקישור הועתק!");}}>
                📋 העתק
              </button>
            </div>
            <div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>שלח קישור זה לראשי המחלקות — הם יוכלו לצפות בכל הבקשות ללא גישה לניהול</div>
          </div>
        )}

        {/* Add form */}
        {addingDh && (
          <div style={{background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:"16px",marginBottom:16,border:"1px solid var(--border)"}}>
            <div style={{fontWeight:800,fontSize:14,marginBottom:12}}>➕ הוספת ראש מחלקה</div>
            <div className="grid-2" style={{marginBottom:10}}>
              <div className="form-group"><label className="form-label">שם מלא *</label>
                <input className="form-input" placeholder="רפי כהן" value={dhForm.name} onChange={e=>setDhForm(p=>({...p,name:e.target.value}))}/></div>
              <div className="form-group"><label className="form-label">כתובת מייל *</label>
                <input className="form-input" type="email" placeholder="rafi@college.ac.il" value={dhForm.email} onChange={e=>setDhForm(p=>({...p,email:e.target.value}))}/></div>
            </div>
            <div className="form-group" style={{marginBottom:10}}>
              <label className="form-label">שם התפקיד</label>
              <input className="form-input" placeholder="למשל: ראש מחלקת קולנוע, ראש מחלקת דוקו" value={dhForm.role} onChange={e=>setDhForm(p=>({...p,role:e.target.value}))}/>
            </div>
            <div className="form-group" style={{marginBottom:12}}>
              <label className="form-label">📩 סוגי השאלה לאישור *</label>
              <div style={{display:"flex",gap:8,marginTop:6}}>
                {DH_LOAN_TYPES.map(lt=>{
                  const active=dhForm.loanTypes.includes(lt);
                  return <button key={lt} type="button" onClick={()=>toggleDhLT(dhForm,setDhForm,lt)}
                    style={{padding:"7px 16px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"var(--surface2)",color:active?"var(--accent)":"var(--text2)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                    {DH_LOAN_ICONS[lt]} {lt}
                  </button>;
                })}
              </div>
            </div>
            <button className="btn btn-primary" disabled={!dhForm.name.trim()||!dhForm.email.trim()||dhForm.loanTypes.length===0||dhSaving} onClick={saveDeptHead}>
              {dhSaving?"⏳ שומר...":"✅ הוסף ראש מחלקה"}
            </button>
          </div>
        )}

        {/* Dept heads list */}
        {deptHeads.length===0
          ? <div style={{textAlign:"center",color:"var(--text3)",fontSize:13,padding:"12px 0"}}>לא נוספו ראשי מחלקות עדיין</div>
          : <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {deptHeads.map(dh=>(
              <div key={dh.id} style={{background:"var(--surface)",border:"1px solid rgba(155,89,182,0.2)",borderRadius:"var(--r-sm)",padding:"12px 16px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                <div style={{width:36,height:36,borderRadius:"50%",background:"rgba(155,89,182,0.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>🎓</div>
                <div style={{flex:1,minWidth:150}}>
                  <div style={{fontWeight:800,fontSize:14}}>{dh.name}</div>
                  {dh.role&&<div style={{fontSize:11,color:"#9b59b6",fontWeight:700,marginTop:1}}>{dh.role}</div>}
                  <div style={{fontSize:11,color:"var(--text3)"}}>{dh.email}</div>
                  <div style={{display:"flex",gap:4,marginTop:5,flexWrap:"wrap"}}>
                    {(dh.loanTypes||[]).map(lt=>(
                      <span key={lt} style={{background:"rgba(155,89,182,0.12)",border:"1px solid rgba(155,89,182,0.3)",borderRadius:20,padding:"1px 8px",fontSize:11,color:"#9b59b6",fontWeight:700}}>
                        {DH_LOAN_ICONS[lt]||"📦"} {lt}
                      </span>
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

      {/* Edit dept head modal */}
      {editDh&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}} onClick={e=>e.target===e.currentTarget&&setEditDh(null)}>
          <div style={{width:"100%",maxWidth:480,background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",direction:"rtl"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:"1px solid var(--border)",background:"var(--surface2)",borderRadius:"16px 16px 0 0"}}>
              <div style={{fontWeight:900,fontSize:16}}>✏️ עריכת ראש מחלקה</div>
              <button className="btn btn-secondary btn-sm" onClick={()=>setEditDh(null)}>✕</button>
            </div>
            <div style={{padding:"20px"}}>
              <div className="grid-2" style={{marginBottom:10}}>
                <div className="form-group"><label className="form-label">שם מלא *</label>
                  <input className="form-input" value={editDhForm.name} onChange={e=>setEditDhForm(p=>({...p,name:e.target.value}))}/></div>
                <div className="form-group"><label className="form-label">כתובת מייל *</label>
                  <input className="form-input" type="email" value={editDhForm.email} onChange={e=>setEditDhForm(p=>({...p,email:e.target.value}))}/></div>
              </div>
              <div className="form-group" style={{marginBottom:10}}>
                <label className="form-label">שם התפקיד</label>
                <input className="form-input" value={editDhForm.role} onChange={e=>setEditDhForm(p=>({...p,role:e.target.value}))}/>
              </div>
              <div className="form-group" style={{marginBottom:16}}>
                <label className="form-label">📩 סוגי השאלה לאישור</label>
                <div style={{display:"flex",gap:8,marginTop:6}}>
                  {DH_LOAN_TYPES.map(lt=>{
                    const active=editDhForm.loanTypes.includes(lt);
                    return <button key={lt} type="button" onClick={()=>toggleDhLT(editDhForm,setEditDhForm,lt)}
                      style={{padding:"7px 16px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"var(--surface2)",color:active?"var(--accent)":"var(--text2)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                      {DH_LOAN_ICONS[lt]} {lt}
                    </button>;
                  })}
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

      {/* ── Add new member form (always visible) ── */}
      <div className="card" style={{marginBottom:24}}>
        <div className="card-header"><div className="card-title">➕ הוספת איש צוות</div></div>
        <div className="responsive-split" style={{marginBottom:14}}>
          <div className="form-group"><label className="form-label">שם מלא *</label><input className="form-input" placeholder="שם" value={addForm.name} onChange={e=>setAddForm(p=>({...p,name:e.target.value}))}/></div>
          <div className="form-group"><label className="form-label">כתובת מייל *</label><input className="form-input" type="email" placeholder="email@example.com" value={addForm.email} onChange={e=>setAddForm(p=>({...p,email:e.target.value}))}/></div>
        </div>
        <div className="form-group" style={{marginBottom:14}}>
          <label className="form-label">טלפון</label>
          <input className="form-input" placeholder="05x-xxxxxxx" value={addForm.phone||""} onChange={e=>setAddForm(p=>({...p,phone:e.target.value}))}/>
        </div>
        <div className="form-group">
          <label className="form-label">📩 קבלת התראות עבור סוגי השאלה</label>
          {renderLoanTypeButtons(addForm, setAddForm)}
          <div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>
            {addForm.loanTypes.length === 0 ? "איש הצוות לא יקבל התראות עד שייבחר לפחות סוג אחד." : "איש צוות יקבל מייל רק עבור בקשות מהסוגים המסומנים."}
          </div>
          {addInvalidEmail && <div style={{fontSize:12,color:"var(--red)",marginTop:6}}>כתובת המייל אינה תקינה.</div>}
          {addDuplicateEmail && <div style={{fontSize:12,color:"var(--red)",marginTop:6}}>כתובת המייל כבר קיימת בצוות.</div>}
        </div>
        <div style={{marginTop:10}}>
          <button className="btn btn-primary" disabled={!addForm.name.trim()||!addEmail||addInvalidEmail||addDuplicateEmail} onClick={saveNew}>➕ הוסף לצוות</button>
        </div>
      </div>

      {/* ── Team list ── */}
      {teamMembers.length===0
        ? <div className="empty-state"><div className="emoji">👥</div><p>עדיין לא נוספו אנשי צוות</p></div>
        : <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {teamMembers.map(m=>(
            <div key={m.id} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"14px 18px",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
              <div style={{width:38,height:38,borderRadius:"50%",background:"var(--surface3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:900,flexShrink:0}}>{m.name?.[0]||"?"}</div>
              <div style={{flex:1,minWidth:180}}>
                <div style={{fontWeight:700,fontSize:14}}>{m.name}</div>
                {m.phone&&<div style={{fontSize:12,color:"var(--text2)",marginBottom:2}}>📞 {m.phone}</div>}
                <div style={{fontSize:12,color:"var(--text3)"}}>{m.email}</div>
                <div style={{display:"flex",gap:4,marginTop:6,flexWrap:"wrap"}}>
                  {(Array.isArray(m.loanTypes) && m.loanTypes.length ? m.loanTypes : (!Array.isArray(m.loanTypes) ? LOAN_TYPES : [])).map(lt=>(
                    <span key={lt} style={{background:"var(--surface3)",border:"1px solid var(--border)",borderRadius:20,padding:"2px 8px",fontSize:11,color:"var(--accent)",fontWeight:700}}>{LOAN_ICONS[lt]} {lt}</span>
                  ))}
                  {Array.isArray(m.loanTypes) && m.loanTypes.length === 0 && (
                    <span style={{background:"rgba(231,76,60,0.12)",border:"1px solid rgba(231,76,60,0.35)",borderRadius:20,padding:"2px 8px",fontSize:11,color:"var(--red)",fontWeight:700}}>ללא התראות</span>
                  )}
                </div>
              </div>
              <div style={{display:"flex",gap:6}}>
                <button className="btn btn-secondary btn-sm" onClick={()=>{setEditMember(m);setEditForm({name:m.name,email:m.email,phone:m.phone||"",loanTypes:m.loanTypes||[...LOAN_TYPES]});}}>✏️ ערוך</button>
                <button className="btn btn-danger btn-sm" onClick={()=>{ if(window.confirm(`למחוק את ${m.name}?`)) del(m.id); }}>🗑️</button>
              </div>
            </div>
          ))}
        </div>
      }

      {/* ── Edit modal ── */}
      {editMember&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}} onClick={e=>e.target===e.currentTarget&&setEditMember(null)}>
          <div style={{width:"100%",maxWidth:480,background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",direction:"rtl"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"18px 22px",borderBottom:"1px solid var(--border)",background:"var(--surface2)",borderRadius:"16px 16px 0 0"}}>
              <div>
                <div style={{fontWeight:900,fontSize:17}}>✏️ עריכת איש צוות</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{editMember.name}</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={()=>setEditMember(null)}>✕ סגור</button>
            </div>
            <div style={{padding:"22px"}}>
              <div className="responsive-split" style={{marginBottom:14}}>
                <div className="form-group"><label className="form-label">שם מלא *</label><input className="form-input" value={editForm.name} onChange={e=>setEditForm(p=>({...p,name:e.target.value}))}/></div>
                <div className="form-group"><label className="form-label">כתובת מייל *</label><input className="form-input" type="email" value={editForm.email} onChange={e=>setEditForm(p=>({...p,email:e.target.value}))}/></div>
              </div>
              <div className="form-group" style={{marginBottom:14}}>
                <label className="form-label">טלפון</label>
                <input className="form-input" placeholder="05x-xxxxxxx" value={editForm.phone||""} onChange={e=>setEditForm(p=>({...p,phone:e.target.value}))}/>
              </div>
              <div className="form-group">
                <label className="form-label">📩 קבלת התראות עבור סוגי השאלה</label>
                {renderLoanTypeButtons(editForm, setEditForm)}
                <div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>
                  {editForm.loanTypes.length === 0 ? "איש הצוות לא יקבל התראות עד שייבחר לפחות סוג אחד." : "איש צוות יקבל מייל רק עבור בקשות מהסוגים המסומנים."}
                </div>
                {editInvalidEmail && <div style={{fontSize:12,color:"var(--red)",marginTop:6}}>כתובת המייל אינה תקינה.</div>}
                {editDuplicateEmail && <div style={{fontSize:12,color:"var(--red)",marginTop:6}}>כתובת המייל כבר קיימת בצוות.</div>}
              </div>
              <div style={{display:"flex",gap:8,marginTop:16}}>
                <button className="btn btn-primary" disabled={!editForm.name.trim()||!editEmail||editInvalidEmail||editDuplicateEmail} onClick={saveEdit}>💾 שמור שינויים</button>
                <button className="btn btn-secondary" onClick={()=>setEditMember(null)}>ביטול</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── KITS PAGE ────────────────────────────────────────────────────────────────
function KitsPage({ kits, setKits, equipment, categories, showToast, reservations=[], setReservations, lessons=[] }) {
  const [mode, setMode] = useState(null); // null | "create" | "editStudent" | "editLesson"
  const [editTarget, setEditTarget] = useState(null);
  const LOAN_TYPES = ["פרטית","הפקה","סאונד","קולנוע יומית","הכל"];
  const LOAN_ICONS = { "פרטית":"👤", "הפקה":"🎬", "סאונד":"🎙️", "קולנוע יומית":"🎥", "הכל":"📦" };

  const studentKits = kits.filter(k=>k.kitType!=="lesson");
  const lessonKits  = kits.filter(k=>k.kitType==="lesson");

  const normalizeKitName = (name) => String(name||"").trim().toLowerCase();
  const hasDuplicateKitName = (name, excludeId=null) =>
    kits.some(k=>k.id!==excludeId && normalizeKitName(k.name)===normalizeKitName(name));

  const del = async (id, name) => {
    if(!window.confirm(`למחוק את הערכה "${name}"?`)) return;
    const updated = kits.filter(k=>k.id!==id);
    setKits(updated);
    // also remove associated lesson reservations
    if(reservations && setReservations) {
      const updatedRes = reservations.filter(r=>r.lesson_kit_id!==id);
      if(updatedRes.length!==reservations.length) {
        setReservations(updatedRes);
        await storageSet("reservations", updatedRes);
      }
    }
    await storageSet("kits", updated);
    showToast("success", `ערכה "${name}" נמחקה`);
  };

  // ── Student Kit Form ──────────────────────────────────────────────────────
  const StudentKitForm = ({ initial, onDone }) => {
    const [kitTypeLocal, setKitTypeLocal] = useState(initial?.kitType||"student"); // "student"|"lesson"
    const [linkedLessonId, setLinkedLessonId] = useState(initial?.lessonId||"");
    const [name, setName] = useState(initial?.name||"");
    const [description, setDescription] = useState(initial?.description||"");
    const [loanType, setLoanType] = useState(initial?.loanType||"הכל");
    const [kitItems, setKitItems] = useState(initial?.items||[]);
    const [saving, setSaving] = useState(false);
    const [eqTypeF, setEqTypeF] = useState("all");
    const [eqCatF, setEqCatF] = useState([]);
    const [eqSearch, setEqSearch] = useState("");
    const [showSelected, setShowSelected] = useState(false);
    const trimmedName = name.trim();
    const duplicateName = !!trimmedName && hasDuplicateKitName(trimmedName, initial?.id||null);

    const maxQty = eqId => {
      const eq = equipment.find(e=>e.id==eqId);
      if(!eq) return 0;
      return Number(eq.total_quantity)||0;
    };
    const setItemQty = (eqId, qty) => {
      const max = maxQty(eqId);
      const bounded = Math.max(0, Math.min(qty, max));
      const eqName = equipment.find(e=>e.id==eqId)?.name||"";
      setKitItems(prev => bounded<=0 ? prev.filter(i=>i.equipment_id!=eqId)
        : prev.find(i=>i.equipment_id==eqId) ? prev.map(i=>i.equipment_id==eqId?{...i,quantity:bounded}:i)
        : [...prev,{equipment_id:eqId,quantity:bounded,name:eqName}]);
    };
    const getQty = eqId => kitItems.find(i=>i.equipment_id==eqId)?.quantity||0;

    const save = async () => {
      if(!trimmedName||duplicateName) return;
      setSaving(true);
      const kit = {
        id: initial?.id||Date.now(),
        kitType: kitTypeLocal,
        name: trimmedName,
        description: description.trim(),
        loanType: kitTypeLocal==="student" ? (loanType==="הכל"?"":loanType) : "",
        lessonId: kitTypeLocal==="lesson" ? (linkedLessonId||null) : null,
        items: kitItems
      };
      const updated = initial ? kits.map(k=>k.id===initial.id?kit:k) : [...kits, kit];
      setKits(updated);
      const r = await storageSet("kits", updated);
      showToast(r.ok?"success":"error", r.ok ? (initial?"הערכה עודכנה":`ערכה "${trimmedName}" נוצרה`) : "❌ שגיאה בשמירה");
      if(r.ok) onDone();
      setSaving(false);
    };

    return (
      <div className="card" style={{marginBottom:20}}>
        <div className="card-header">
          <div className="card-title">{kitTypeLocal==="lesson"?"🎬":"🎒"} {initial?"עריכת ערכה":"ערכה חדשה"}</div>
          <button className="btn btn-secondary btn-sm" onClick={onDone}>✕ ביטול</button>
        </div>

        {/* Kit type selector */}
        {!initial && (
          <div className="form-group" style={{marginBottom:14}}>
            <label className="form-label">סוג ערכה</label>
            <div style={{display:"flex",gap:8,marginTop:6}}>
              {[{k:"student",l:"🎒 ערכה לסטודנט"},{k:"lesson",l:"🎬 ערכת שיעור"}].map(({k,l})=>(
                <button key={k} type="button" onClick={()=>setKitTypeLocal(k)}
                  style={{padding:"7px 16px",borderRadius:20,border:`2px solid ${kitTypeLocal===k?"var(--accent)":"var(--border)"}`,background:kitTypeLocal===k?"var(--accent-glow)":"var(--surface2)",color:kitTypeLocal===k?"var(--accent)":"var(--text2)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Lesson link panel */}
        {kitTypeLocal==="lesson" && (
          <div style={{background:"rgba(155,89,182,0.07)",border:"1px solid rgba(155,89,182,0.25)",borderRadius:"var(--r)",padding:14,marginBottom:14}}>
            <div style={{fontWeight:800,fontSize:13,color:"#9b59b6",marginBottom:8}}>📽️ שיוך לשיעור</div>
            {lessons.length===0
              ? <div style={{fontSize:12,color:"var(--text3)"}}>אין שיעורים ברובריקת "שיעורים" — ניתן לשייך לאחר מכן.</div>
              : <div className="form-group" style={{marginBottom:0}}>
                  <label className="form-label">שיעור משויך (אופציונלי)</label>
                  <select className="form-select" value={linkedLessonId} onChange={e=>setLinkedLessonId(e.target.value)}>
                    <option value="">— ללא שיוך —</option>
                    {lessons.map(ls=>(
                      <option key={ls.id} value={ls.id}>{ls.name}{ls.instructorName?` · ${ls.instructorName}`:""}</option>
                    ))}
                  </select>
                </div>
            }
          </div>
        )}

        <div className="responsive-split" style={{marginBottom:12}}>
          <div className="form-group"><label className="form-label">שם הערכה *</label>
            <input className="form-input" placeholder='לדוגמה: "ערכת דוקומנטרי"' value={name} onChange={e=>setName(e.target.value)}/>
            {duplicateName&&<div style={{fontSize:12,color:"var(--red)",marginTop:4}}>כבר קיימת ערכה עם השם הזה.</div>}
          </div>
          {kitTypeLocal==="student" && (
          <div className="form-group">
            <label className="form-label">שיוך לסוג השאלה</label>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:6}}>
              {LOAN_TYPES.map(lt=>(
                <button key={lt} type="button" onClick={()=>setLoanType(lt)}
                  style={{padding:"5px 12px",borderRadius:20,border:`2px solid ${loanType===lt?"var(--accent)":"var(--border)"}`,background:loanType===lt?"var(--accent-glow)":"var(--surface2)",color:loanType===lt?"var(--accent)":"var(--text2)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                  {LOAN_ICONS[lt]} {lt}
                </button>
              ))}
            </div>
          </div>
          )}
        </div>
        <div className="form-group" style={{marginBottom:16}}>
          <label className="form-label">תיאור הערכה</label>
          <textarea className="form-textarea" rows={2} placeholder="תיאור קצר..." value={description} onChange={e=>setDescription(e.target.value)}/>
        </div>
        <div className="form-section-title">ציוד בערכה</div>
        <div style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"12px 14px",marginBottom:12}}>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8,alignItems:"center"}}>
            <span style={{fontSize:11,fontWeight:800,color:"var(--text3)"}}>סינון:</span>
            {[{k:"all",l:"📦 הכל"},{k:"sound",l:"🎙️ ציוד סאונד"},{k:"photo",l:"🎥 ציוד צילום"}].map(({k,l})=>{
              const active=eqTypeF===k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={()=>setEqTypeF(k)}
                  style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}
                >
                  {l}
                </button>
              );
            })}
            <span style={{width:1,height:16,background:"var(--border)",flexShrink:0}}/>
            {(categories||[]).map(cat=>{
              const active=eqCatF.includes(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={()=>setEqCatF(prev=>active?prev.filter(c=>c!==cat):[...prev,cat])}
                  style={{padding:"4px 10px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}
                >
                  {cat}
                </button>
              );
            })}
            {eqCatF.length>0&&(
              <button type="button" onClick={()=>setEqCatF([])} style={{padding:"4px 8px",borderRadius:20,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:11,cursor:"pointer"}}>
                ✕ נקה
              </button>
            )}
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <div className="search-bar" style={{flex:1,minWidth:150}}>
              <span>🔍</span>
              <input placeholder="חיפוש ציוד..." value={eqSearch} onChange={e=>setEqSearch(e.target.value)}/>
            </div>
            <button
              type="button"
              onClick={()=>setShowSelected(prev=>!prev)}
              style={{padding:"5px 12px",borderRadius:20,border:`2px solid ${showSelected?"var(--green)":"var(--border)"}`,background:showSelected?"rgba(46,204,113,0.12)":"transparent",color:showSelected?"var(--green)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}
            >
              {showSelected ? "✅ נבחרים" : "⬜ נבחרים בלבד"}
            </button>
          </div>
        </div>
        {(()=>{
          const matchesType = (eq) => {
            if (eqTypeF === "sound") return !!eq.soundOnly;
            if (eqTypeF === "photo") return !!eq.photoOnly;
            return true;
          };
          const matchesSearch = (eq) => !eqSearch || String(eq.name||"").toLowerCase().includes(eqSearch.toLowerCase());
          const visibleCats = (eqCatF.length>0 ? eqCatF : (categories||[])).filter(cat =>
            equipment.some(eq =>
              eq.category===cat &&
              matchesType(eq) &&
              matchesSearch(eq) &&
              (!showSelected || getQty(eq.id)>0)
            )
          );
          if(visibleCats.length===0) return <div style={{textAlign:"center",color:"var(--text3)",padding:"16px",fontSize:13}}>לא נמצא ציוד תואם</div>;
          return visibleCats.map(cat=>{
            const catEq = equipment.filter(eq =>
              eq.category===cat &&
              matchesType(eq) &&
              matchesSearch(eq) &&
              (!showSelected || getQty(eq.id)>0)
            );
            if(!catEq.length) return null;
            return (
              <div key={cat} style={{marginBottom:12}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
                  <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1}}>{cat}</div>
                  {catEq.some(eq=>eq.soundOnly)&&<span style={{fontSize:10,color:"var(--accent)",fontWeight:700}}>🎙️ סאונד</span>}
                  {catEq.some(eq=>eq.photoOnly)&&<span style={{fontSize:10,color:"var(--green)",fontWeight:700}}>🎥 צילום</span>}
                </div>
                {catEq.map(eq=>{
                  const max = maxQty(eq.id);
                  const qty = getQty(eq.id);
                  return (
                    <div key={eq.id} className="item-row" style={{marginBottom:4,opacity:max===0?0.4:1,background:qty>0?"rgba(245,166,35,0.05)":"",border:qty>0?"1px solid rgba(245,166,35,0.2)":""}}>
                      <span style={{fontSize:20}}>{eq.image?.startsWith("data:")||eq.image?.startsWith("http")?<img src={eq.image} alt="" style={{width:24,height:24,objectFit:"cover",borderRadius:4}}/>:eq.image||"📦"}</span>
                      <div style={{flex:1,fontSize:13,fontWeight:600}}>
                        {eq.name}
                        <span style={{fontSize:11,color:"var(--text3)",marginRight:6,fontWeight:400}}>מלאי: {max}</span>
                        {eq.soundOnly&&<span style={{fontSize:10,color:"var(--accent)",fontWeight:700,marginRight:4}}>🎙️</span>}
                        {eq.photoOnly&&<span style={{fontSize:10,color:"var(--green)",fontWeight:700,marginRight:4}}>🎥</span>}
                      </div>
                      {max>0
                        ? <div className="qty-ctrl">
                            <button className="qty-btn" onClick={()=>setItemQty(eq.id,qty-1)}>−</button>
                            <span className="qty-num" style={{color:qty>0?"var(--accent)":"inherit"}}>{qty}</span>
                            <button className="qty-btn" disabled={qty>=max} onClick={()=>setItemQty(eq.id,qty+1)} style={{opacity:qty>=max?0.3:1}}>+</button>
                          </div>
                        : <span style={{fontSize:11,color:"var(--red)",fontWeight:700}}>אין מלאי</span>}
                    </div>
                  );
                })}
              </div>
            );
          });
        })()}
        {kitItems.length>0&&<div className="highlight-box" style={{marginTop:8}}>🎒 {kitItems.length} סוגי ציוד · {kitItems.reduce((s,i)=>s+i.quantity,0)} יחידות</div>}
        <div style={{marginTop:12,display:"flex",gap:8}}>
          <button className="btn btn-primary" disabled={!trimmedName||duplicateName||saving} onClick={save}>{saving?"⏳ שומר...":initial?"💾 שמור":"➕ צור ערכה"}</button>
        </div>
      </div>
    );
  };

  // ── Lesson Kit Form ───────────────────────────────────────────────────────
  const LessonKitForm = ({ initial, onDone }) => {
    const [name, setName]                   = useState(initial?.name||initial?.courseName||getLessonsLinkedToKit(initial, lessons)[0]?.name||"");
    const [instructorName, setInstructorName] = useState(initial?.instructorName||getLessonsLinkedToKit(initial, lessons)[0]?.instructorName||"");
    const [instructorPhone, setInstructorPhone] = useState(initial?.instructorPhone||getLessonsLinkedToKit(initial, lessons)[0]?.instructorPhone||"");
    const [instructorEmail, setInstructorEmail] = useState(initial?.instructorEmail||getLessonsLinkedToKit(initial, lessons)[0]?.instructorEmail||"");
    const [description, setDescription]     = useState(initial?.description||"");
    const [kitItems, setKitItems]           = useState(initial?.items||[]);
    const [schedule, setSchedule]           = useState(initial?.schedule||[]);
    const [scheduleMode, setScheduleMode]   = useState("manual"); // "manual" | "xl"
    const [saving, setSaving]               = useState(false);
    const [xlImporting, setXlImporting]     = useState(false);
    const [teacherMessage, setTeacherMessage] = useState("");
    const [teacherEmailSending, setTeacherEmailSending] = useState(false);
    const [kitConflicts, setKitConflicts] = useState(null); // {session, conflicts}[]
    const isEditMode = !!initial;
    const [localMsg, setLocalMsg] = useState(null); // {type:"success"|"error", text:""}

    // Equipment filter state
    const [lessonEqTypeF, setLessonEqTypeF]       = useState("all"); // "all"|"sound"|"photo"
    const [lessonCatF, setLessonCatF]             = useState([]);    // multi-select categories
    const [lessonEqSearch, setLessonEqSearch]     = useState("");
    const [lessonShowSelected, setLessonShowSelected] = useState(false);

    const linkedLessons = getLessonsLinkedToKit(initial, lessons);
    const lessonManagedKit = isEditMode && linkedLessons.length > 0;
    const linkedLesson = linkedLessons[0] || null;
    const linkedSchedule = linkedLessons.flatMap(getLessonScheduleEntries).sort(compareDateTimeParts);
    const effectiveSchedule = lessonManagedKit && linkedSchedule.length > 0 ? linkedSchedule : schedule;
    const effectiveName = String(name || linkedLesson?.name || "").trim();
    const effectiveInstructorName = String(instructorName || linkedLesson?.instructorName || linkedLesson?.name || "").trim();
    const effectiveInstructorPhone = String(instructorPhone || linkedLesson?.instructorPhone || "").trim();
    const effectiveInstructorEmail = String(instructorEmail || linkedLesson?.instructorEmail || "").trim();

    // Manual schedule builder
    const [manStartDate, setManStartDate] = useState("");
    const [manStartTime, setManStartTime] = useState("10:00");
    const [manEndTime, setManEndTime]   = useState("13:00");
    const [manCount, setManCount]       = useState(1);

    const LESSON_TIMES = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30",
      "13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30",
      "17:00","17:30","18:00","18:30","19:00","19:30","20:00","20:30",
      "21:00","21:30","22:00"];

    const buildAndAppendSchedule = () => {
      if(!manStartDate) { setLocalMsg({type:"error",text:"יש לבחור תאריך"}); return; }
      const count = Math.max(1, Math.min(52, Number(manCount)||1));
      const sessions = [];
      let d = parseLocalDate(manStartDate);
      for(let i=0;i<count;i++) {
        sessions.push({ date: formatLocalDateInput(d), startTime: manStartTime, endTime: manEndTime });
        d.setDate(d.getDate()+7);
      }
      setSchedule(prev => [...prev, ...sessions]);
      setLocalMsg({type:"success",text:`נוספו ${sessions.length} שיעורים`});
    };

    const appendLessonFromExisting = () => {
      if (!schedule.length) return;
      // Always use the FIRST lesson's time range
      const firstLesson = schedule[0];
      // Always add 1 week after the LAST lesson's date
      const lastLesson = schedule[schedule.length - 1];
      const nextDateObj = parseLocalDate(lastLesson.date || today());
      nextDateObj.setDate(nextDateObj.getDate() + 7);
      const nextLesson = {
        date: formatLocalDateInput(nextDateObj),
        startTime: firstLesson.startTime || "09:00",
        endTime: firstLesson.endTime || "12:00",
      };
      setSchedule(prev => [...prev, nextLesson]);
    };

    // XL import for schedule
    const importScheduleXL = async (e) => {
      const file = e.target.files[0];
      if(!file) return;
      e.target.value = "";
      setXlImporting(true);
      try {
        const processRows = (rows) => {
          if(!rows.length) { setLocalMsg({type:"error",text:"קובץ ריק"}); return; }
          const headers = rows[0].map(h=>String(h||"").trim().replace(/[\uFEFF]/g,"").toLowerCase());
          const dateIdx    = headers.findIndex(h=>h.includes("תאריך")||h.includes("date"));
          const startIdx   = headers.findIndex(h=>h.includes("התחלה")||h.includes("start")||h.includes("שעת התחלה"));
          const endIdx     = headers.findIndex(h=>h.includes("סיום")||h.includes("end")||h.includes("שעת סיום"));
          const courseIdx  = headers.findIndex(h=>h.includes("קורס")||h.includes("course")||h.includes("שם"));
          if(dateIdx===-1) { setLocalMsg({type:"error",text:'לא נמצאה עמודת "תאריך"'}); setXlImporting(false); return; }
          // Auto-fill kit name from course column if name is empty
          if(courseIdx>=0 && !name.trim()) {
            const firstCourseName = String(rows[1]?.[courseIdx]||"").trim();
            if(firstCourseName) setName(firstCourseName);
          }
          const sessions = [];
          for(let i=1;i<rows.length;i++) {
            const row = rows[i];
            let dateVal = String(row[dateIdx]||"").trim();
            if(!dateVal) continue;
            // handle Excel serial dates
            if(/^\d{5}$/.test(dateVal)) {
              const d = new Date(Math.round((Number(dateVal)-25569)*86400000));
              dateVal = formatLocalDateInput(d);
            } else {
              // try DD/MM/YYYY or YYYY-MM-DD
              const parts = dateVal.includes("/")?dateVal.split("/"):dateVal.split("-");
              if(parts.length===3) {
                if(parts[0].length===4) dateVal=`${parts[0]}-${parts[1].padStart(2,"0")}-${parts[2].padStart(2,"0")}`;
                else dateVal=`${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}`;
              }
            }
            sessions.push({
              date: dateVal,
              startTime: startIdx>=0?String(row[startIdx]||"09:00").trim():"09:00",
              endTime:   endIdx>=0?String(row[endIdx]||"12:00").trim():"12:00",
            });
          }
          setSchedule(prev => [...prev, ...sessions]);
           setLocalMsg({type:"success",text:`יובאו ${sessions.length} שיעורים`});
          setXlImporting(false);
        };

        if(/\.xlsx?$/i.test(file.name)) {
          if(!window.XLSX) {
            await new Promise((res,rej)=>{
              const s=document.createElement("script");
              s.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
              s.onload=res; s.onerror=rej;
              document.head.appendChild(s);
            });
          }
          const buf = await file.arrayBuffer();
          const wb  = window.XLSX.read(buf,{type:"array"});
          const ws  = wb.Sheets[wb.SheetNames[0]];
          processRows(window.XLSX.utils.sheet_to_json(ws,{header:1,defval:""}));
        } else {
          const reader = new FileReader();
          reader.onload = ev => {
            const lines = ev.target.result.split(/\r?\n/).filter(l=>l.trim());
            const sep = lines[0]?.includes("\t")?"\t":",";
            processRows(lines.map(l=>l.split(sep).map(c=>c.trim().replace(/^"|"$/g,""))));
          };
          reader.readAsText(file,"UTF-8");
        }
      } catch(err) {
        console.error("XL import error",err);
        setLocalMsg({type:"error",text:"שגיאה בייבוא הקובץ"});
        setXlImporting(false);
      }
    };

    const sendTeacherKitEmail = async () => {
      const recipient = effectiveInstructorEmail || String(instructorEmail || "").trim();
      if (!recipient) {
        setLocalMsg({type:"error",text:"יש להזין מייל למורה לפני השליחה"});
        return;
      }
      const message = String(teacherMessage || "").trim();
      if (!message) {
        setLocalMsg({type:"error",text:"יש למלא נוסח לשליחת הערכה למורה"});
        return;
      }
      if (!kitItems.length) {
        setLocalMsg({type:"error",text:"לא ניתן לשלוח ערכה למורה ללא ציוד בערכה"});
        return;
      }
      setTeacherEmailSending(true);
      try {
        const itemsList = (kitItems || []).map((item) => {
          const eq = equipment.find((entry) => entry.id == item.equipment_id);
          const itemName = eq?.name || item.name || "פריט";
          return `<tr><td style="padding:7px 12px;color:#e8eaf0;border-bottom:1px solid #1e2130">${itemName}</td><td style="padding:7px 12px;text-align:center;color:#f5a623;font-weight:700;border-bottom:1px solid #1e2130">${item.quantity}</td></tr>`;
        }).join("");
        const scheduleList = effectiveSchedule.map((session, index) => {
          const start = session?.startTime || "";
          const end = session?.endTime || "";
          return `<div style="margin-bottom:6px;color:#c7cedf">שיעור ${index + 1}: ${formatDate(session.date)} ${start}${end ? `–${end}` : ""}</div>`;
        }).join("");
        await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: recipient,
            type: "lesson_kit_ready",
            student_name: effectiveInstructorName || instructorName.trim() || effectiveName || name.trim() || "מורה",
            recipient_name: effectiveInstructorName || instructorName.trim() || effectiveName || name.trim() || "",
            lesson_kit_name: effectiveName || name.trim(),
            custom_message: message,
            items_list: itemsList,
            lesson_schedule: scheduleList,
          }),
        });
        setLocalMsg({type:"success",text:`המייל נשלח אל ${recipient}`});
      } catch (err) {
        console.error("lesson kit teacher email error", err);
        setLocalMsg({type:"error",text:"שגיאה בשליחת הערכה למורה"});
      } finally {
        setTeacherEmailSending(false);
      }
    };

    const maxQty = eqId => Number(equipment.find(e=>e.id==eqId)?.total_quantity)||0;
    const setItemQty = (eqId, qty) => {
      const max = maxQty(eqId);
      const bounded = Math.max(0,Math.min(qty,max));
      const eqName = equipment.find(e=>e.id==eqId)?.name||"";
      setKitItems(prev => bounded<=0 ? prev.filter(i=>i.equipment_id!=eqId)
        : prev.find(i=>i.equipment_id==eqId) ? prev.map(i=>i.equipment_id==eqId?{...i,quantity:bounded}:i)
        : [...prev,{equipment_id:eqId,quantity:bounded,name:eqName}]);
    };
    const getQty = eqId => kitItems.find(i=>i.equipment_id==eqId)?.quantity||0;

    const save = async () => {
      if(!name.trim()) { setLocalMsg({type:"error",text:"חובה למלא שם ערכה"}); return; }

      // Always rebuild from current schedule state + manual inputs if needed
      let finalSchedule = [...schedule]; // copy current state
      if (lessonManagedKit && linkedSchedule.length > 0) {
        finalSchedule = linkedSchedule.map((session) => ({ ...session }));
      }

      if(scheduleMode==="manual" && manStartDate) {
        // If schedule is empty OR user wants to add more — build from inputs
        if(finalSchedule.length===0) {
          const count = Math.max(1, Math.min(52, Number(manCount)||1));
          let d = parseLocalDate(manStartDate);
          for(let i=0;i<count;i++) {
            finalSchedule.push({ date: formatLocalDateInput(d), startTime: manStartTime, endTime: manEndTime });
            d.setDate(d.getDate()+7);
          }
        }
      }

      if(finalSchedule.length===0) {
        setLocalMsg({type:"error",text:"יש להוסיף לפחות שיעור אחד — בחר תאריך ושעות"});
        return;
      }
      if(!kitItems.length) {
        setLocalMsg({type:"error",text:"יש לבחור לפחות פריט ציוד אחד לערכה"});
        return;
      }

      // ── Availability check: ensure no item goes to negative inventory ──
      const kitId = initial?.id||`lk_${Date.now()}`;
      const baseRes = (reservations||[]).filter(r=>r.lesson_kit_id!==kitId);
      const sessionConflicts = [];
      for (let si = 0; si < finalSchedule.length; si++) {
        const s = finalSchedule[si];
        const sessionLabel = `שיעור ${si+1} — ${formatDate(s.date)} ${s.startTime||""}–${s.endTime||""}`;
        const itemConflicts = [];
        for (const item of kitItems) {
          const eq = equipment.find(e=>e.id==item.equipment_id);
          if (!eq) continue;
          // Build list of reservations to check against: baseRes + earlier sessions from THIS kit
          const checkRes = [...baseRes];
          for (let pi = 0; pi < si; pi++) {
            const ps = finalSchedule[pi];
            checkRes.push({
              id: `__kit_check_${pi}`, status: "מאושר",
              borrow_date: ps.date, borrow_time: ps.startTime||"00:00",
              return_date: ps.date, return_time: ps.endTime||"23:59",
              items: kitItems,
            });
          }
          const avail = getAvailable(item.equipment_id, s.date, s.date, checkRes, equipment, null, s.startTime||"", s.endTime||"");
          if (item.quantity > avail) {
            // Find who's blocking
            const blockers = [];
            const reqStart = toDateTime(s.date, s.startTime||"00:00");
            const reqEnd   = toDateTime(s.date, s.endTime||"23:59");
            for (const res of baseRes) {
              if (res.status !== "מאושר" && res.status !== "באיחור") continue;
              const resStart = toDateTime(res.borrow_date, res.borrow_time||"00:00");
              const resEnd   = res.status === "באיחור" ? FAR_FUTURE : toDateTime(res.return_date, res.return_time||"23:59");
              if (!(reqStart < resEnd && reqEnd > resStart)) continue;
              const bi = (res.items||[]).find(i=>i.equipment_id==item.equipment_id);
              if (bi && bi.quantity > 0) {
                blockers.push({ student_name: res.student_name||"ללא שם", quantity: bi.quantity, status: res.status, borrow_date: res.borrow_date, return_date: res.return_date });
              }
            }
            itemConflicts.push({ equipment_name: eq.name, requested: item.quantity, available: avail, missing: item.quantity - avail, blockers });
          }
        }
        if (itemConflicts.length) sessionConflicts.push({ label: sessionLabel, date: s.date, conflicts: itemConflicts });
      }
      if (sessionConflicts.length) {
        setKitConflicts(sessionConflicts);
        setSaving(false);
        return;
      }
      setKitConflicts(null);
      // ── End availability check ──

      setSaving(true);

      const kit = {
        id: kitId, kitType:"lesson",
        name: effectiveName || name.trim(),
        instructorName: effectiveInstructorName || instructorName.trim(),
        instructorPhone: effectiveInstructorPhone || instructorPhone.trim(),
        instructorEmail: effectiveInstructorEmail || instructorEmail.trim(),
        description: description.trim(),
        items: kitItems, schedule: finalSchedule,
      };
      const updatedKits = initial ? kits.map(k=>k.id===initial.id?kit:k) : [...kits, kit];
      setKits(updatedKits);

      // Create/replace associated reservations (one per session)
      const newRes = finalSchedule.map((s,i)=>({
        id: `${kitId}_s${i}`,
        lesson_kit_id: kitId,
        status: "מאושר",
        loan_type: "שיעור",
        student_name: effectiveInstructorName || instructorName.trim() || effectiveName || name.trim(),
        email: effectiveInstructorEmail || instructorEmail.trim(),
        phone: effectiveInstructorPhone || instructorPhone.trim(),
        course: effectiveName || name.trim(),
        borrow_date: s.date,
        borrow_time: s.startTime,
        return_date: s.date,
        return_time: s.endTime,
        items: kitItems,
        created_at: new Date().toISOString(),
        overdue_notified: true,
      }));
      const updatedRes = [...baseRes, ...newRes];
      if(setReservations) setReservations(updatedRes);

      const [r1, r2] = await Promise.all([
        storageSet("kits", updatedKits),
        storageSet("reservations", updatedRes),
      ]);
      setSaving(false);
      if(r1.ok&&r2.ok) {
        onDone();
        showToast("success", `ערכת שיעור "${effectiveName || name.trim()}" נשמרה · ${finalSchedule.length} שיעורים שוריינו`);
      } else setLocalMsg({type:"error",text:"❌ שגיאה בשמירה"});
    };

    return (
      <div className="card" style={{marginBottom:20}}>
        <div className="card-header">
          <div className="card-title">🎬 {initial?"עריכת ערכת שיעור":"ערכת שיעור חדשה"}</div>
          <button className="btn btn-secondary btn-sm" onClick={onDone}>✕ ביטול</button>
        </div>

        {localMsg && (
          <div style={{padding:"10px 16px",marginBottom:12,borderRadius:"var(--r-sm)",fontSize:13,fontWeight:700,
            background:localMsg.type==="error"?"rgba(231,76,60,0.12)":"rgba(46,204,113,0.12)",
            border:`1px solid ${localMsg.type==="error"?"rgba(231,76,60,0.3)":"rgba(46,204,113,0.3)"}`,
            color:localMsg.type==="error"?"#e74c3c":"#2ecc71",
            display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>{localMsg.type==="error"?"❌":"✅"} {localMsg.text}</span>
            <button onClick={()=>setLocalMsg(null)} style={{background:"none",border:"none",color:"inherit",cursor:"pointer",fontSize:16,padding:"0 4px"}}>×</button>
          </div>
        )}

        {/* ── Kit availability conflict warning ── */}
        {kitConflicts && (
          <div style={{padding:16,marginBottom:16,borderRadius:"var(--r-sm)",background:"rgba(231,76,60,0.08)",border:"1px solid rgba(231,76,60,0.35)"}}>
            <div style={{fontWeight:700,fontSize:15,color:"#e74c3c",marginBottom:10,display:"flex",alignItems:"center",gap:8}}>
              <span>⚠️</span><span>לא ניתן לשמור — חוסר ציוד זמין</span>
              <button onClick={()=>setKitConflicts(null)} style={{marginRight:"auto",background:"none",border:"none",color:"#e74c3c",cursor:"pointer",fontSize:18,padding:"0 4px"}}>×</button>
            </div>
            <div style={{fontSize:12,color:"var(--text2)",marginBottom:10}}>הציוד הנדרש לערכת השיעור אינו זמין בתאריכים הבאים בגלל השאלות קיימות או ציוד באיחור:</div>
            {kitConflicts.map((sc,si)=>(
              <div key={si} style={{marginBottom:12,padding:10,borderRadius:8,background:"rgba(231,76,60,0.04)",border:"1px solid rgba(231,76,60,0.15)"}}>
                <div style={{fontWeight:600,fontSize:13,color:"var(--text1)",marginBottom:6}}>📅 {sc.label}</div>
                {sc.conflicts.map((c,ci)=>(
                  <div key={ci} style={{marginBottom:8,paddingRight:12}}>
                    <div style={{fontSize:13,fontWeight:600,color:"#e74c3c"}}>
                      {c.equipment_name}: נדרש {c.requested}, זמין {c.available} — חסר {c.missing}
                    </div>
                    {c.blockers.map((b,bi)=>(
                      <div key={bi} style={{fontSize:11,color:"var(--text3)",paddingRight:8,marginTop:2,display:"flex",alignItems:"center",gap:6}}>
                        {b.status==="באיחור" && <span style={{background:"rgba(230,126,34,0.15)",color:"#e67e22",padding:"1px 6px",borderRadius:4,fontWeight:700,fontSize:10}}>באיחור</span>}
                        <span>{b.student_name} · {b.quantity} יח׳ · {formatDate(b.borrow_date)}–{formatDate(b.return_date)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
            <div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>💡 יש להחזיר את הציוד באיחור או להקטין כמויות בערכה לפני השמירה</div>
          </div>
        )}

        {/* Instructor details */}
        {!lessonManagedKit && (
        <div style={{background:"rgba(52,152,219,0.06)",border:"1px solid rgba(52,152,219,0.2)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16}}>
          <div style={{fontWeight:800,fontSize:13,color:"#3498db",marginBottom:12}}>👨‍🏫 פרטי הקורס והמרצה</div>
          <div className="form-group" style={{marginBottom:10}}>
            <label className="form-label">שם הערכה / קורס *</label>
            <input className="form-input" placeholder='לדוגמה: "אולפן טלוויזיה א"' value={name} onChange={e=>setName(e.target.value)}/>
          </div>
          <div className="grid-2" style={{marginBottom:10}}>
            <div className="form-group"><label className="form-label">שם המרצה</label>
              <input className="form-input" placeholder='ד"ר ישראל ישראלי' value={instructorName} onChange={e=>setInstructorName(e.target.value)}/></div>
            <div className="form-group"><label className="form-label">טלפון מרצה</label>
              <input className="form-input" placeholder="05x-xxxxxxx" value={instructorPhone} onChange={e=>setInstructorPhone(e.target.value)}/></div>
          </div>
          <div className="form-group" style={{marginBottom:10}}>
            <label className="form-label">מייל מרצה</label>
            <input className="form-input" type="email" placeholder="lecturer@college.ac.il" value={instructorEmail} onChange={e=>setInstructorEmail(e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="form-label">הערות</label>
            <textarea className="form-textarea" rows={2} placeholder="הערות על הקורס או הערכה..." value={description} onChange={e=>setDescription(e.target.value)}/>
          </div>
        </div>
        )}

        {/* Equipment picker */}
        <div style={{marginBottom:16}}>
          <div className="form-section-title">🎒 ציוד נדרש לשיעור <span style={{fontWeight:400,fontSize:11,color:"var(--text3)"}}>· כמות מלאי המחסן המלא</span></div>

          {/* Filters */}
          <div style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"12px 14px",marginBottom:12}}>
            {/* Type filter */}
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8,alignItems:"center"}}>
              <span style={{fontSize:11,fontWeight:800,color:"var(--text3)"}}>סינון:</span>
              {[{k:"all",l:"📦 הכל"},{k:"sound",l:"🎙️ סאונד"},{k:"photo",l:"🎥 צילום"}].map(({k,l})=>{
                const active=lessonEqTypeF===k;
                return <button key={k} type="button" onClick={()=>setLessonEqTypeF(k)}
                  style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                  {l}
                </button>;
              })}
              <span style={{width:1,height:16,background:"var(--border)",flexShrink:0}}/>
              {/* Category multi-select */}
              {categories.map(cat=>{
                const active=lessonCatF.includes(cat);
                return <button key={cat} type="button" onClick={()=>setLessonCatF(p=>active?p.filter(c=>c!==cat):[...p,cat])}
                  style={{padding:"4px 10px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}>
                  {cat}
                </button>;
              })}
              {lessonCatF.length>0&&<button type="button" onClick={()=>setLessonCatF([])} style={{padding:"4px 8px",borderRadius:20,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:11,cursor:"pointer"}}>✕ נקה</button>}
            </div>
            {/* Search + selected toggle */}
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <div className="search-bar" style={{flex:1,minWidth:150}}><span>🔍</span>
                <input placeholder="חיפוש ציוד..." value={lessonEqSearch} onChange={e=>setLessonEqSearch(e.target.value)}/></div>
              <button type="button" onClick={()=>setLessonShowSelected(p=>!p)}
                style={{padding:"5px 12px",borderRadius:20,border:`2px solid ${lessonShowSelected?"var(--green)":"var(--border)"}`,background:lessonShowSelected?"rgba(46,204,113,0.12)":"transparent",color:lessonShowSelected?"var(--green)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
                {lessonShowSelected?"✅ נבחרים":"⬜ נבחרים בלבד"}
              </button>
            </div>
          </div>

          {/* Equipment list with filters applied */}
          {(()=>{
            const visibleCats = (lessonCatF.length>0 ? lessonCatF : categories).filter(cat=>
              equipment.some(e=>e.category===cat &&
                (lessonEqTypeF==="all"||(lessonEqTypeF==="sound"&&e.soundOnly)||(lessonEqTypeF==="photo"&&e.photoOnly)) &&
                (!lessonEqSearch||e.name.includes(lessonEqSearch)) &&
                (!lessonShowSelected||getQty(e.id)>0)
              )
            );
            if(visibleCats.length===0) return <div style={{textAlign:"center",color:"var(--text3)",padding:"16px",fontSize:13}}>לא נמצא ציוד תואם</div>;
            return visibleCats.map(cat=>{
              const catEq = equipment.filter(e=>e.category===cat &&
                (lessonEqTypeF==="all"||(lessonEqTypeF==="sound"&&e.soundOnly)||(lessonEqTypeF==="photo"&&e.photoOnly)) &&
                (!lessonEqSearch||e.name.includes(lessonEqSearch)) &&
                (!lessonShowSelected||getQty(e.id)>0)
              );
              if(!catEq.length) return null;
              return (
                <div key={cat} style={{marginBottom:10}}>
                  <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",marginBottom:5,textTransform:"uppercase",letterSpacing:1}}>{cat}</div>
                  {catEq.map(eq=>{
                    const max=maxQty(eq.id); const qty=getQty(eq.id);
                    return (
                      <div key={eq.id} className="item-row" style={{marginBottom:4,opacity:max===0?0.4:1,background:qty>0?"rgba(245,166,35,0.05)":"",border:qty>0?"1px solid rgba(245,166,35,0.2)":""}}>
                        <span style={{fontSize:20}}>{eq.image?.startsWith("data:")||eq.image?.startsWith("http")?<img src={eq.image} alt="" style={{width:24,height:24,objectFit:"cover",borderRadius:4}}/>:eq.image||"📦"}</span>
                        <div style={{flex:1,fontSize:13,fontWeight:600}}>
                          {eq.name}
                          <span style={{fontSize:11,color:"var(--text3)",marginRight:6,fontWeight:400}}>מלאי: {max}</span>
                          {eq.soundOnly&&<span style={{fontSize:10,color:"var(--accent)",fontWeight:700,marginRight:4}}>🎙️</span>}
                          {eq.photoOnly&&<span style={{fontSize:10,color:"var(--green)",fontWeight:700,marginRight:4}}>🎥</span>}
                        </div>
                        {max>0
                          ? <div className="qty-ctrl">
                              <button className="qty-btn" onClick={()=>setItemQty(eq.id,qty-1)}>−</button>
                              <span className="qty-num" style={{color:qty>0?"var(--accent)":"inherit"}}>{qty}</span>
                              <button className="qty-btn" disabled={qty>=max} onClick={()=>setItemQty(eq.id,qty+1)} style={{opacity:qty>=max?0.3:1}}>+</button>
                            </div>
                          : <span style={{fontSize:11,color:"var(--red)",fontWeight:700}}>אין מלאי</span>}
                      </div>
                    );
                  })}
                </div>
              );
            });
          })()}
          {kitItems.length>0&&<div className="highlight-box" style={{marginTop:8}}>🎒 {kitItems.length} סוגי ציוד · {kitItems.reduce((s,i)=>s+i.quantity,0)} יחידות</div>}
        </div>

        {/* Schedule builder */}
        {!lessonManagedKit && (
        <div style={{background:"rgba(155,89,182,0.06)",border:"1px solid rgba(155,89,182,0.25)",borderRadius:"var(--r)",padding:16,marginBottom:18}}>
          <div style={{fontWeight:800,fontSize:13,color:"#9b59b6",marginBottom:12}}>📅 לוח שיעורים</div>

          {!isEditMode && (
            <>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
                {[{k:"manual",l:"📅 פריסה ידנית"},{k:"xl",l:"📊 ייבוא מ-XL"}].map(({k,l})=>(
                  <button key={k} type="button" onClick={()=>setScheduleMode(k)}
                    style={{padding:"7px 16px",borderRadius:20,border:`2px solid ${scheduleMode===k?"#9b59b6":"var(--border)"}`,background:scheduleMode===k?"rgba(155,89,182,0.15)":"transparent",color:scheduleMode===k?"#9b59b6":"var(--text2)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                    {l}
                  </button>
                ))}
              </div>

              {scheduleMode==="manual"&&(
                <div className="responsive-split" style={{marginBottom:12,alignItems:"end"}}>
                  <div style={{gridColumn:"1 / -1",fontSize:12,color:"var(--text3)",marginBottom:2}}>
                    📅 הגדר פריסת שיעורים — ייווצרו אוטומטית בשמירה
                  </div>
                  <div className="form-group"><label className="form-label">תאריך שיעור ראשון *</label>
                    <input type="date" className="form-input" value={manStartDate} onChange={e=>setManStartDate(e.target.value)}/></div>
                  <div className="form-group"><label className="form-label">שעת התחלה</label>
                    <select className="form-select" value={manStartTime} onChange={e=>setManStartTime(e.target.value)}>
                      {LESSON_TIMES.map(t=><option key={t} value={t}>{t}</option>)}
                    </select></div>
                  <div className="form-group"><label className="form-label">שעת סיום</label>
                    <select className="form-select" value={manEndTime} onChange={e=>setManEndTime(e.target.value)}>
                      <option value="">ללא</option>
                      {LESSON_TIMES.filter(t=>t>manStartTime).map(t=><option key={t} value={t}>{t}</option>)}
                    </select></div>
                  <div className="form-group"><label className="form-label">מספר שיעורים</label>
                    <input type="number" min="1" max="52" className="form-input" value={manCount} onChange={e=>setManCount(Math.max(1,Math.min(52,Number(e.target.value)||1)))}/></div>
                  {manStartDate&&<div className="highlight-box" style={{gridColumn:"1 / -1",marginTop:-4,marginBottom:0}}>
                    שיעור 1: {formatDate(manStartDate)} {manStartTime}–{manEndTime}
                    {Number(manCount)>1&&` · עד שיעור ${manCount}: ${(()=>{const d=parseLocalDate(manStartDate);d.setDate(d.getDate()+7*(Number(manCount)-1));return formatDate(formatLocalDateInput(d));})()}`}
                  </div>}
                  {manStartDate&&schedule.length===0&&(()=>{
                    const cnt = Math.max(1, Math.min(52, Number(manCount)||1));
                    const preview = [];
                    const d = parseLocalDate(manStartDate);
                    for(let i=0;i<Math.min(cnt,3);i++) {
                      const x = new Date(d); x.setDate(d.getDate()+7*i); preview.push(formatDate(formatLocalDateInput(x)));
                    }
                    return <div style={{gridColumn:"1 / -1",fontSize:12,color:"var(--text2)",lineHeight:1.7,marginTop:-6}}>
                        <div style={{fontWeight:700,color:"#9b59b6",marginBottom:4}}>תצוגה מקדימה — {cnt} שיעורים שייווצרו:</div>
                        <div>{preview.join(" · ")}</div>
                        {cnt>3&&<div style={{color:"var(--text3)"}}>...ועוד {cnt-3} שיעורים נוספים</div>}
                      </div>;
                  })()}
                </div>
              )}

              {scheduleMode==="xl"&&(
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:12,color:"var(--text3)",marginBottom:8}}>
                    העלה קובץ CSV / TSV / XLS / XLSX עם עמודות תאריך ושעות.
                    {schedule.length>0&&<span style={{color:"#9b59b6"}}> · השיעורים יתווספו לקיימים</span>}
                  </div>
                  <label className="btn btn-secondary" style={{cursor:xlImporting?"not-allowed":"pointer",opacity:xlImporting?0.6:1}}>
                    {xlImporting?"⏳ מייבא...":"📊 ייבוא לוח שיעורים מקובץ"}
                    <input type="file" accept=".csv,.tsv,.xls,.xlsx" style={{display:"none"}} onChange={importScheduleXL} disabled={xlImporting}/>
                  </label>
                </div>
              )}
            </>
          )}

          {isEditMode && (
            <div className="highlight-box" style={{marginBottom:12}}>
              במצב עריכה ניתן לעדכן תאריכים ושעות של שיעורים קיימים, להסיר שיעורים, ולשכפל שיעור נוסף שבוע אחרי האחרון.
            </div>
          )}

          {/* Schedule list with inline editing */}
          {schedule.length>0&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontWeight:700,fontSize:12,color:"#9b59b6"}}>📅 {schedule.length} שיעורים בלוח:</div>
                {!isEditMode && <button type="button" onClick={()=>setSchedule([])} style={{fontSize:11,color:"var(--red)",background:"none",border:"none",cursor:"pointer"}}>🗑️ נקה הכל</button>}
              </div>
              <div style={{maxHeight:280,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
                {schedule.map((s,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:6,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"6px 10px",fontSize:12,flexWrap:"wrap"}}>
                    <span style={{fontWeight:700,color:"#9b59b6",minWidth:24,flexShrink:0}}>#{i+1}</span>
                    {/* Inline date edit */}
                    <input type="date" value={s.date}
                      onChange={e=>setSchedule(prev=>prev.map((x,j)=>j===i?{...x,date:e.target.value}:x))}
                      style={{padding:"2px 6px",borderRadius:6,border:"1px solid var(--border)",background:"var(--surface3)",color:"var(--text)",fontSize:11,width:130}}/>
                    {/* Inline time edit */}
                    <select value={s.startTime}
                      onChange={e=>setSchedule(prev=>prev.map((x,j)=>j===i?{...x,startTime:e.target.value}:x))}
                      style={{padding:"2px 6px",borderRadius:6,border:"1px solid var(--border)",background:"var(--surface3)",color:"var(--text)",fontSize:11}}>
                      {LESSON_TIMES.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                    <span style={{color:"var(--text3)"}}>–</span>
                    <select value={s.endTime}
                      onChange={e=>setSchedule(prev=>prev.map((x,j)=>j===i?{...x,endTime:e.target.value}:x))}
                      style={{padding:"2px 6px",borderRadius:6,border:"1px solid var(--border)",background:"var(--surface3)",color:"var(--text)",fontSize:11}}>
                      {LESSON_TIMES.filter(t=>t>s.startTime).map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                    <div style={{marginRight:"auto",display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                      <button type="button" onClick={()=>setSchedule(prev=>prev.filter((_,j)=>j!==i))}
                        style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:15,padding:"0 2px",flexShrink:0}}>×</button>
                    </div>
                  </div>
                ))}
              </div>
              {isEditMode && schedule.length>0 && (
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
                  <button type="button" className="btn btn-secondary" onClick={()=>appendLessonFromExisting()}>
                    ➕ שכפל שיעור
                  </button>
                  <span style={{fontSize:12,color:"var(--text3)",alignSelf:"center"}}>
                    שיעור חדש יתווסף שבוע אחרי השיעור האחרון עם אותן שעות.
                  </span>
                </div>
              )}
            </div>
          )}
          {!schedule.length&&scheduleMode==="manual"&&!manStartDate&&(
            <div style={{textAlign:"center",color:"var(--text3)",fontSize:12,padding:"8px 0"}}>בחר תאריך וזמנים למעלה — השיעורים ייווצרו אוטומטית בלחיצה על \"צור ערכת שיעור\"</div>
          )}
        </div>
        )}

        <div style={{background:"rgba(46,204,113,0.08)",border:"1px solid rgba(46,204,113,0.25)",borderRadius:"var(--r)",padding:16,marginBottom:18}}>
          <div style={{fontWeight:800,fontSize:13,color:"var(--green)",marginBottom:12}}>📧 שליחת ערכה למורה</div>
          <div style={{fontSize:12,color:"var(--text2)",marginBottom:10}}>
            לאחר שצוות המחסן סיים להרכיב את הערכה, ניתן לשלוח למורה את נוסח ההודעה שלך יחד עם רשימת הציוד והמפגשים, כדי שיוכל לעבור ולבדוק את הערכה.
          </div>
          <div className="form-group" style={{marginBottom:12}}>
            <label className="form-label">נוסח ההודעה למורה</label>
            <textarea
              className="form-textarea"
              rows={4}
              placeholder="לדוגמה: שלום, הערכה מוכנה לבדיקה ומצורפת אליך רשימת הציוד והמפגשים."
              value={teacherMessage}
              onChange={e=>setTeacherMessage(e.target.value)}
            />
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
            <button
              type="button"
              className="btn btn-success"
              onClick={sendTeacherKitEmail}
              disabled={teacherEmailSending || !(effectiveInstructorEmail || String(instructorEmail||"").trim())}
            >
              {teacherEmailSending ? "⏳ שולח למורה..." : "📤 שליחת ערכה למורה"}
            </button>
            <span style={{fontSize:12,color:"var(--text3)"}}>
              {(effectiveInstructorEmail || String(instructorEmail||"").trim()) ? `המייל יישלח אל ${effectiveInstructorEmail || instructorEmail.trim()}` : "יש להזין קודם כתובת מייל למורה"}
            </span>
          </div>
        </div>

        {/* Single CTA */}
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",paddingTop:4}}>
          <button className="btn btn-primary"
            disabled={saving || !(effectiveName || name.trim()) || (!lessonManagedKit && scheduleMode==="xl" && schedule.length===0)}
            onClick={save}
            style={{fontSize:15,padding:"12px 28px"}}>
            {saving ? "⏳ שומר ומשריין..." : initial ? "💾 שמור שינויים" : "🎬 צור ערכת שיעור"}
          </button>
          {!lessonManagedKit && scheduleMode==="manual" && manStartDate && schedule.length===0 && (
            <span style={{fontSize:12,color:"var(--text3)"}}>
              יפרוס {manCount} שיעורים ב-{formatDate(manStartDate)}
            </span>
          )}
          {effectiveSchedule.length>0 && (
            <span style={{fontSize:12,color:"#9b59b6",fontWeight:700}}>📅 {effectiveSchedule.length} שיעורים בלוח</span>
          )}
        </div>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="page">
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:20,flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:8}}>
          {mode===null&&<button className="btn btn-primary" onClick={()=>{setMode("create");setEditTarget(null);}}>➕ ערכה חדשה</button>}
        </div>
      </div>

      {/* Forms */}
      {(mode==="create"||mode==="editStudent")&&(
        <StudentKitForm initial={mode==="editStudent"?editTarget:null} onDone={()=>{setMode(null);setEditTarget(null);}}/>
      )}
      {mode==="editLesson"&&(
        <LessonKitForm initial={editTarget} onDone={()=>{setMode(null);setEditTarget(null);}}/>
      )}

      {/* Student kits list */}
      {mode===null&&(
        studentKits.length===0
          ? <div className="empty-state"><div className="emoji">🎒</div><p>אין ערכות לסטודנטים</p><p style={{fontSize:13,color:"var(--text3)"}}>ערכות מוצגות בטופס ההשאלה</p></div>
          : <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {studentKits.map(kit=>(
              <div key={kit.id} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"14px 18px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:28}}>🎒</span>
                    <div>
                      <div style={{fontWeight:800,fontSize:15}}>{kit.name}</div>
                      <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
                        {kit.loanType
                          ? <span style={{background:"var(--accent-glow)",border:"1px solid var(--accent)",borderRadius:20,padding:"2px 8px",color:"var(--accent)",fontWeight:700}}>{LOAN_ICONS[kit.loanType]||"📦"} {kit.loanType}</span>
                          : <span>📦 כל סוגי ההשאלה</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <button className="btn btn-secondary btn-sm" onClick={()=>{setEditTarget(kit);setMode("editStudent");}}>✏️ ערוך</button>
                    <button className="btn btn-danger btn-sm" onClick={()=>del(kit.id,kit.name)}>🗑️</button>
                  </div>
                </div>
                <div style={{marginTop:10,display:"flex",flexWrap:"wrap",gap:4}}>
                  {(kit.items||[]).map((i,j)=>{
                    const eq=equipment.find(e=>e.id==i.equipment_id);
                    return <span key={j} className="chip">
                      {eq?.image&&(eq.image.startsWith("data:")||eq.image.startsWith("http"))?<img src={eq.image} alt="" style={{width:14,height:14,objectFit:"cover",borderRadius:2,verticalAlign:"middle"}}/>:<span>{eq?.image||"📦"}</span>}
                      {' '}{eq?.name||i.name} ×{i.quantity}
                    </span>;
                  })}
                </div>
              </div>
            ))}
          </div>
      )}

      {/* Lesson kits list */}
      {mode===null&&lessonKits.length>0&&(
          <><div style={{fontWeight:900,fontSize:14,margin:"24px 0 10px",color:"#9b59b6",display:"flex",alignItems:"center",gap:8,borderTop:"1px solid var(--border)",paddingTop:20}}>
            🎬 ערכות שיעור
            <span style={{background:"rgba(155,89,182,0.12)",border:"1px solid rgba(155,89,182,0.3)",borderRadius:20,padding:"1px 10px",fontSize:12,fontWeight:700,color:"#9b59b6"}}>{lessonKits.length}</span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {lessonKits.map(kit=>{
              const linkedKitLessons = getLessonsLinkedToKit(kit, lessons);
              const linkedKitSchedule = linkedKitLessons.flatMap(getLessonScheduleEntries).sort(compareDateTimeParts);
              const displaySchedule = linkedKitSchedule.length > 0 ? linkedKitSchedule : (kit.schedule||[]);
              const nextSession = displaySchedule.find(s=>s.date>=today());
              const displayInstructorName = kit.instructorName || linkedKitLessons[0]?.instructorName || "";
              const displayInstructorPhone = kit.instructorPhone || linkedKitLessons[0]?.instructorPhone || "";
              const displayInstructorEmail = kit.instructorEmail || linkedKitLessons[0]?.instructorEmail || "";
              return (
                <div key={kit.id} style={{background:"var(--surface)",border:"1px solid rgba(155,89,182,0.3)",borderRadius:"var(--r)",padding:"16px 18px"}}>
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                    <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
                      <span style={{fontSize:28}}>🎬</span>
                      <div>
                        <div style={{fontWeight:800,fontSize:15}}>{kit.name}</div>
                      {displayInstructorName&&<div style={{fontSize:12,color:"var(--text2)",marginTop:2}}>👨‍🏫 {displayInstructorName}{displayInstructorPhone?` · 📞 ${displayInstructorPhone}`:""}</div>}
                        {displayInstructorEmail&&<div style={{fontSize:11,color:"var(--text3)"}}>✉️ {displayInstructorEmail}</div>}
                        <div style={{marginTop:6,display:"flex",gap:6,flexWrap:"wrap"}}>
                          <span style={{background:"rgba(155,89,182,0.15)",border:"1px solid rgba(155,89,182,0.35)",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#9b59b6",fontWeight:700}}>
                            📅 {displaySchedule.length} שיעורים
                          </span>
                          {nextSession&&<span style={{background:"rgba(46,204,113,0.1)",border:"1px solid rgba(46,204,113,0.3)",borderRadius:20,padding:"2px 8px",fontSize:11,color:"var(--green)",fontWeight:700}}>
                            הבא: {formatDate(nextSession.date)} {nextSession.startTime}
                          </span>}
                        </div>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:6}}>
                      <button className="btn btn-secondary btn-sm" onClick={()=>{setEditTarget(kit);setMode("editLesson");}}>✏️ ערוך</button>
                      <button className="btn btn-danger btn-sm" onClick={()=>del(kit.id,kit.name)}>🗑️</button>
                    </div>
                  </div>
                  <div style={{marginTop:10,display:"flex",flexWrap:"wrap",gap:4}}>
                    {(kit.items||[]).map((i,j)=>{
                      const eq=equipment.find(e=>e.id==i.equipment_id);
                      return <span key={j} className="chip">
                        {eq?.image&&(eq.image.startsWith("data:")||eq.image.startsWith("http"))?<img src={eq.image} alt="" style={{width:14,height:14,objectFit:"cover",borderRadius:2,verticalAlign:"middle"}}/>:<span>{eq?.image||"📦"}</span>}
                        {' '}{eq?.name||i.name} ×{i.quantity}
                      </span>;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          </>
      )}
    </div>
  );
}

  const KitForm = ({ initial, onDone }) => {
    const [name, setName] = useState(initial?.name||"");
    const [description, setDescription] = useState(initial?.description||"");
    const [loanType, setLoanType] = useState(initial?.loanType||"הכל");
    const [kitItems, setKitItems] = useState(initial?.items||[]);
    const [saving, setSaving] = useState(false);
    const trimmedName = name.trim();
    const duplicateName = !!trimmedName && hasDuplicateKitName(trimmedName, initial?.id || null);

    // Only "תקין" items count — max = total_quantity of that item
    const maxQty = eqId => {
      const eq = equipment.find(e=>e.id==eqId);
      if (!eq) return 0;
      if (eq.status && eq.status !== "תקין") return 0;
      return Number(eq.total_quantity) || 0;
    };
    const setItemQty = (eqId, qty) => {
      const max = maxQty(eqId);
      const bounded = Math.max(0, Math.min(qty, max));
      const eqName = equipment.find(e=>e.id==eqId)?.name||"";
      setKitItems(prev => bounded<=0 ? prev.filter(i=>i.equipment_id!=eqId)
        : prev.find(i=>i.equipment_id==eqId) ? prev.map(i=>i.equipment_id==eqId?{...i,quantity:bounded}:i)
        : [...prev,{equipment_id:eqId,quantity:bounded,name:eqName}]);
    };
    const getQty = eqId => kitItems.find(i=>i.equipment_id==eqId)?.quantity||0;

    const save = async () => {
      if (!trimmedName) return;
      if (duplicateName) {
        showToast("error", "כבר קיימת ערכה עם השם הזה");
        return;
      }
      setSaving(true);
      const kit = { id: initial?.id||Date.now(), name: trimmedName, description: description.trim(), loanType: loanType==="הכל"?"":loanType, items: kitItems };
      const updated = initial ? kits.map(k=>k.id===initial.id?kit:k) : [...kits, kit];
      setKits(updated);
      const _kitRes = await storageSet("kits", updated);
      if(!_kitRes.ok) showToast("error", "❌ שגיאה בשמירה — נסה שוב");
      else showToast("success", initial ? "הערכה עודכנה" : `ערכה "${trimmedName}" נוצרה`);
      onDone();
    };

    return (
      <div className="card" style={{marginBottom:20}}>
        <div className="card-header">
          <div className="card-title">{initial?"✏️ עריכת ערכה":"➕ ערכה חדשה"}</div>
          <button className="btn btn-secondary btn-sm" onClick={onDone}>✕ ביטול</button>
        </div>
        <div className="responsive-split" style={{marginBottom:12}}>
          <div className="form-group"><label className="form-label">שם הערכה *</label><input className="form-input" placeholder='לדוגמה: "ערכת דוקומנטרי"' value={name} onChange={e=>setName(e.target.value)}/></div>
          <div className="form-group">
            <label className="form-label">שיוך לסוג השאלה</label>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:6}}>
              {LOAN_TYPES.map(lt=>(
                <button key={lt} type="button" onClick={()=>setLoanType(lt)}
                  style={{padding:"5px 12px",borderRadius:20,border:`2px solid ${loanType===lt?"var(--accent)":"var(--border)"}`,background:loanType===lt?"var(--accent-glow)":"var(--surface2)",color:loanType===lt?"var(--accent)":"var(--text2)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                  {LOAN_ICONS[lt]} {lt}
                </button>
              ))}
            </div>
            {duplicateName && <div style={{fontSize:12,color:"var(--red)",marginTop:6}}>כבר קיימת ערכה עם השם הזה.</div>}
          </div>
        </div>
        <div className="form-group" style={{marginBottom:16}}>
          <label className="form-label">תיאור הערכה</label>
          <textarea className="form-textarea" rows={2} placeholder="תיאור קצר של הערכה ומה היא מיועדת ל..." value={description} onChange={e=>setDescription(e.target.value)}/>
        </div>
        <div className="form-section-title">ציוד בערכה <span style={{fontWeight:400,fontSize:11,color:"var(--text3)"}}>· רק ציוד במצב תקין, עד מקסימום הכמות הקיימת</span></div>
        {categories.map(cat=>{
          const catEq = equipment.filter(e=>e.category===cat && (!e.status || e.status==="תקין"));
          if(!catEq.length) return null;
          return <div key={cat} style={{marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",marginBottom:6,textTransform:"uppercase",letterSpacing:1}}>{cat}</div>
            {catEq.map(eq=>{
              const max = maxQty(eq.id);
              const qty = getQty(eq.id);
              return (
              <div key={eq.id} className="item-row" style={{marginBottom:4,opacity:max===0?0.4:1}}>
                <span style={{fontSize:20}}>{eq.image?.startsWith("data:")||eq.image?.startsWith("http") ? <img src={eq.image} alt="" style={{width:24,height:24,objectFit:"cover",borderRadius:4}}/> : eq.image||"📦"}</span>
                <div style={{flex:1,fontSize:13,fontWeight:600}}>
                  {eq.name}
                  <span style={{fontSize:11,color:"var(--text3)",marginRight:6,fontWeight:400}}>מלאי: {max}</span>
                </div>
                {max>0
                  ? <div className="qty-ctrl">
                      <button className="qty-btn" onClick={()=>setItemQty(eq.id,qty-1)}>−</button>
                      <span className="qty-num" style={{color:qty>0?"var(--accent)":"inherit"}}>{qty}</span>
                      <button className="qty-btn" disabled={qty>=max} onClick={()=>setItemQty(eq.id,qty+1)} style={{opacity:qty>=max?0.3:1}}>+</button>
                    </div>
                  : <span style={{fontSize:11,color:"var(--red)",fontWeight:700}}>אין מלאי</span>
                }
              </div>
              );
            })}
          </div>;
        })}
        {kitItems.length>0&&<div className="highlight-box" style={{marginTop:8}}>🎒 {kitItems.length} סוגי ציוד בערכה · {kitItems.reduce((s,i)=>s+i.quantity,0)} יחידות סה״כ</div>}
        <div style={{marginTop:12,display:"flex",gap:8}}>
          <button className="btn btn-primary" disabled={!trimmedName||duplicateName||saving} onClick={save}>{saving?"⏳ שומר...":initial?"💾 שמור":"➕ צור ערכה"}</button>
        </div>
      </div>
    );
  };

// ─── CERTIFICATIONS PAGE (removed — now imported from components/CertificationsPage.jsx) ──
function CertificationsPage_REMOVED({ certifications, setCertifications, showToast }) {
  const { types=[], students=[] } = certifications;
  const [newTypeName, setNewTypeName] = useState("");
  const [addingStudent, setAddingStudent] = useState(false);
  const [studentForm, setStudentForm] = useState({ name:"", email:"", phone:"", track:"" });
  const [editStudent, setEditStudent] = useState(null); // student being edited
  const [editForm, setEditForm] = useState({ name:"", email:"", phone:"", track:"" });
  const [search, setSearch] = useState("");
  const [trackFilter, setTrackFilter] = useState("הכל");
  const [saving, setSaving] = useState(false);
  const [xlImporting, setXlImporting] = useState(false);

  const save = async (updated) => {
    setSaving(true);
    setCertifications(updated);
    const r = await storageSet("certifications", updated);
    setSaving(false);
    if(!r.ok) showToast("error","❌ שגיאה בשמירה");
    return r.ok;
  };

  // ── Certification types ──
  const addType = async () => {
    const name = newTypeName.trim();
    if(!name) return;
    if(types.find(t=>t.name===name)) { showToast("error","הסמכה בשם זה כבר קיימת"); return; }
    const id = `cert_${Date.now()}`;
    const updated = { types:[...types,{id,name}], students };
    if(await save(updated)) { showToast("success",`הסמכה "${name}" נוספה`); setNewTypeName(""); }
  };

  const deleteType = async (typeId) => {
    if(!window.confirm("למחוק הסמכה זו? היא תוסר מכל הסטודנטים.")) return;
    const updated = {
      types: types.filter(t=>t.id!==typeId),
      students: students.map(s=>{ const c={...s.certs}; delete c[typeId]; return {...s,certs:c}; })
    };
    if(await save(updated)) showToast("success","ההסמכה נמחקה");
  };

  // ── Students ──
  const addStudent = async () => {
    const { name, email, phone } = studentForm;
    if(!name.trim()||!email.trim()) return;
    if(students.find(s=>s.email?.toLowerCase()===email.toLowerCase().trim())) {
      showToast("error","סטודנט עם מייל זה כבר קיים"); return;
    }
    const id = `stu_${Date.now()}`;
    const updated = { types, students:[...students,{id,name:name.trim(),email:email.toLowerCase().trim(),phone:phone.trim(),track:studentForm.track.trim(),certs:{}}] };
    if(await save(updated)) {
      showToast("success",`${name} נוסף/ה`);
      setStudentForm({name:"",email:"",phone:"",track:""});
      setAddingStudent(false);
    }
  };

  const deleteStudent = async (stuId) => {
    if(!window.confirm("למחוק סטודנט זה?")) return;
    const updated = { types, students: students.filter(s=>s.id!==stuId) };
    if(await save(updated)) showToast("success","הסטודנט הוסר");
  };

  const saveEdit = async () => {
    const name = editForm.name.trim();
    const email = editForm.email.toLowerCase().trim();
    if(!name||!email) return;
    const dup = students.find(s=>s.email===email && s.id!==editStudent.id);
    if(dup) { showToast("error","מייל זה כבר קיים לסטודנט אחר"); return; }
    const updated = { types, students: students.map(s=>s.id===editStudent.id ? {...s,name,email,phone:editForm.phone.trim(),track:editForm.track?.trim()||""} : s) };
    if(await save(updated)) { showToast("success","פרטי הסטודנט עודכנו"); setEditStudent(null); }
  };

  const importXL = async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    setXlImporting(true);
    e.target.value = "";
    try {
      const isXlsx = /\.xlsx?$/i.test(file.name);

      const processRowsWithIdx = async (rows, nameIdx, emailIdx, phoneIdx) => {
        await processRowsWithIdx(rows, nameIdx, emailIdx, phoneIdx);
      };

      const processRows = async (rows) => {
        if(!rows.length) { showToast("error","הקובץ ריק"); setXlImporting(false); return; }
        // Clean headers - remove BOM, invisible chars, normalize Hebrew
        const headers = rows[0].map(h=>{
          let s = String(h||"").trim();
          s = s.replace(/[\uFEFF\u200B-\u200D\u00A0]/g,"");
          return s.toLowerCase();
        });
        console.log("XL headers detected:", headers);
        const nameIdx  = headers.findIndex(h=>h.includes("שם")||h.includes("name"));
        // Very broad email detection
        const emailIdx = headers.findIndex(h=>
          h.includes("מייל")||h.includes("mail")||h.includes("email")||
          h.includes("אימייל")||h.includes("e-mail")||h.includes("@")
        );
        const phoneIdx = headers.findIndex(h=>h.includes("טלפון")||h.includes("phone")||h.includes("tel")||h.includes("נייד")||h.includes("מספר"));
        const trackIdx = headers.findIndex(h=>h.includes("מסלול")||h.includes("קבוצה")||h.includes("כיתה")||h.includes("track")||h.includes("group")||h.includes("class"));
        if(emailIdx===-1) {
          // Last resort: try to auto-detect by scanning first data row for @ sign
          const autoEmailIdx = rows[1] ? rows[1].findIndex(c=>String(c||"").includes("@")) : -1;
          if(autoEmailIdx>=0) {
            // Use auto-detected column
            return await processRowsWithIdx(rows, nameIdx, autoEmailIdx, phoneIdx);
          }
          showToast("error",`לא נמצאה עמודת מייל. כותרות: "${headers.join('", "')}"`);
          setXlImporting(false);
          return;
        }
        let added=0, skipped=0;
        const newStudents = [...students];
        for(let i=1;i<rows.length;i++) {
          const row = rows[i];
          const email = String(row[emailIdx]||"").toLowerCase().trim();
          const name  = nameIdx>=0 ? String(row[nameIdx]||"").trim() : "";
          const phone = phoneIdx>=0 ? String(row[phoneIdx]||"").trim() : "";
          if(!email||!email.includes("@")) { skipped++; continue; }
          if(newStudents.find(s=>s.email===email)) { skipped++; continue; }
          const track = trackIdx>=0 ? String(rows[i][trackIdx]||"").trim() : "";
          newStudents.push({ id:`stu_${Date.now()}_${i}`, name:name||email, email, phone, track, certs:{} });
          added++;
        }
        const updated = { types, students: newStudents };
        if(await save(updated)) showToast("success", `✅ יובאו ${added} סטודנטים${skipped>0?` · ${skipped} דולגו`:""}`);
        setXlImporting(false);
      };

      if(isXlsx) {
        if(!window.XLSX) {
          await new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
            s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
          });
        }
        const buf = await file.arrayBuffer();
        const wb  = window.XLSX.read(buf, { type:"array" });
        const ws  = wb.Sheets[wb.SheetNames[0]];
        const rows = window.XLSX.utils.sheet_to_json(ws, { header:1, defval:"" });
        await processRows(rows);
      } else {
        const reader = new FileReader();
        reader.onload = async (ev) => {
          try {
            const text = ev.target.result;
            const lines = text.split(/\r?\n/).filter(l=>l.trim());
            const sep = lines[0]?.includes("\t") ? "\t" : ",";
            const rows = lines.map(l=>l.split(sep).map(c=>c.trim().replace(/^"|"$/g,"")));
            await processRows(rows);
          } catch { showToast("error","שגיאה בקריאת הקובץ"); setXlImporting(false); }
        };
        reader.readAsText(file, "UTF-8");
      }
    } catch(err) {
      console.error("importXL error:", err);
      showToast("error","שגיאה בייבוא הקובץ");
      setXlImporting(false);
    }
  };

  const toggleCert = async (stuId, typeId) => {
    const updated = {
      types,
      students: students.map(s => {
        if(s.id!==stuId) return s;
        const current = (s.certs||{})[typeId];
        const next = current==="עבר" ? "לא עבר" : "עבר";
        return {...s, certs:{...s.certs,[typeId]:next}};
      })
    };
    await save(updated);
  };

  // Get all unique tracks
  const allTracks = ["הכל", ...new Set(students.map(s=>s.track||"").filter(Boolean))];
  const filteredStudents = students
    .filter(s=>
      (trackFilter==="הכל" || (s.track||"")=== trackFilter) &&
      (!search || s.name?.includes(search) || s.email?.includes(search) || s.phone?.includes(search))
    )
    .sort((a, b) => {
      const ta = a.track || "";
      const tb = b.track || "";
      if (ta === tb) return 0;
      if (!ta) return 1;   // ללא מסלול — תמיד אחרון
      if (!tb) return -1;
      return ta.localeCompare(tb, "he");
    });

  return (
    <div className="page" style={{direction:"rtl"}}>
      {/* ── Certification types management ── */}
      <div className="card" style={{marginBottom:20}}>
        <div className="card-header">
          <div className="card-title">🎓 ניהול הסמכות</div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
          {types.map(t=>(
            <span key={t.id} style={{display:"flex",alignItems:"center",gap:6,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:20,padding:"4px 14px",fontSize:13,fontWeight:700}}>
              🎓 {t.name}
              <button onClick={()=>deleteType(t.id)} style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:14,padding:"0 2px",lineHeight:1}}>×</button>
            </span>
          ))}
          {types.length===0&&<span style={{fontSize:13,color:"var(--text3)"}}>אין הסמכות עדיין</span>}
        </div>
        <div style={{display:"flex",gap:8}}>
          <input className="form-input" style={{flex:1}} placeholder="שם הסמכה חדשה (למשל: מצלמות DSLR)"
            value={newTypeName} onChange={e=>setNewTypeName(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&addType()}/>
          <button className="btn btn-primary" onClick={addType} disabled={!newTypeName.trim()||saving}>➕ הוסף הסמכה</button>
        </div>
      </div>

      {/* ── Add student form ── */}
      {addingStudent ? (
        <div className="card" style={{marginBottom:20}}>
          <div className="card-header">
            <div className="card-title">➕ הוספת סטודנט</div>
            <button className="btn btn-secondary btn-sm" onClick={()=>setAddingStudent(false)}>✕ ביטול</button>
          </div>
          <div className="grid-2" style={{marginBottom:12}}>
            <div className="form-group"><label className="form-label">שם מלא *</label>
              <input className="form-input" value={studentForm.name} onChange={e=>setStudentForm(p=>({...p,name:e.target.value}))} placeholder="שם מלא"/></div>
            <div className="form-group"><label className="form-label">אימייל *</label>
              <input className="form-input" type="email" value={studentForm.email} onChange={e=>setStudentForm(p=>({...p,email:e.target.value}))} placeholder="email@example.com"/></div>
          </div>
          <div className="form-group"><label className="form-label">טלפון</label>
            <input className="form-input" value={studentForm.phone} onChange={e=>setStudentForm(p=>({...p,phone:e.target.value}))} placeholder="05x-xxxxxxx"/></div>
          <div className="form-group"><label className="form-label">מסלול לימודים</label>
            <datalist id="track-list-add">
              {[...new Set(students.map(s=>s.track||"").filter(Boolean))].map(t=><option key={t} value={t}/>)}
            </datalist>
            <input className="form-input" list="track-list-add" value={studentForm.track||""} onChange={e=>setStudentForm(p=>({...p,track:e.target.value}))} placeholder='למשל: "הנדסאי קולנוע ב"'/></div>
          <div style={{marginTop:12,display:"flex",gap:8}}>
            <button className="btn btn-primary" disabled={!studentForm.name.trim()||!studentForm.email.trim()||saving} onClick={addStudent}>
              {saving?"⏳ שומר...":"✅ הוסף סטודנט"}
            </button>
          </div>
        </div>
      ) : (
        <>
        <div style={{display:"flex",gap:10,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
          <button className="btn btn-primary" onClick={()=>setAddingStudent(true)}>➕ הוספת סטודנט</button>
          <label style={{cursor:"pointer"}}>
            <input type="file" accept=".csv,.tsv,.txt,.xls,.xlsx" style={{display:"none"}} onChange={importXL} disabled={xlImporting}/>
            <span className="btn btn-secondary" style={{pointerEvents:"none"}}>
              {xlImporting ? "⏳ מייבא..." : "📊 טבלת XL"}
            </span>
          </label>
          <div className="search-bar" style={{flex:1,minWidth:180}}><span>🔍</span>
            <input placeholder="חיפוש לפי שם, מייל או טלפון..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
          <span style={{fontSize:13,color:"var(--text3)"}}>סה״כ: <strong style={{color:"var(--text)"}}>{filteredStudents.length}</strong> / {students.length}</span>
        </div>
        {allTracks.length>1&&(
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
            {allTracks.map(t=>(
              <button key={t} type="button" onClick={()=>setTrackFilter(t)}
                style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${trackFilter===t?"var(--accent)":"var(--border)"}`,background:trackFilter===t?"var(--accent-glow)":"transparent",color:trackFilter===t?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                {t==="הכל"?"📦 כל המסלולים":"🎓 "+t}
              </button>
            ))}
          </div>
        )}
      </>
      )}

      {/* ── Students table ── */}
      {types.length===0 && (
        <div className="info" style={{padding:"12px 16px",background:"rgba(52,152,219,0.08)",border:"1px solid rgba(52,152,219,0.2)",borderRadius:"var(--r-sm)",fontSize:13,color:"var(--text2)",marginBottom:16}}>
          💡 הוסף תחילה סוגי הסמכות (למעלה), לאחר מכן הוסף סטודנטים וסמן מי עבר כל הסמכה.
        </div>
      )}

      {filteredStudents.length===0 && !addingStudent ? (
        <div className="empty-state"><div className="emoji">🎓</div><p>{search?"לא נמצאו סטודנטים":"לא נוספו סטודנטים עדיין"}</p></div>
      ) : (
        <>
          {/* Desktop — table */}
          <div className="cert-desktop" style={{overflowX:"auto",borderRadius:"var(--r)",border:"1px solid var(--border)"}}>
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:480,direction:"rtl"}}>
              <thead>
                <tr style={{background:"var(--surface2)",borderBottom:"2px solid var(--border)"}}>
                  <th style={{padding:"10px 14px",textAlign:"right",fontWeight:800,fontSize:13,color:"var(--text2)",whiteSpace:"nowrap"}}>שם סטודנט</th>
                  <th style={{padding:"10px 14px",textAlign:"right",fontWeight:800,fontSize:13,color:"var(--text2)"}}>מייל</th>
                  <th style={{padding:"10px 14px",textAlign:"right",fontWeight:800,fontSize:13,color:"var(--text2)",whiteSpace:"nowrap"}}>מסלול לימודים</th>
                  {types.map(t=>(
                    <th key={t.id} style={{padding:"10px 12px",textAlign:"center",fontWeight:800,fontSize:12,color:"var(--accent)",whiteSpace:"nowrap",minWidth:110}}>🎓 {t.name}</th>
                  ))}
                  <th style={{padding:"10px 12px",textAlign:"center",width:70}}></th>
                </tr>
              </thead>
              <tbody>
                {(()=>{
                  const rows=[]; let lastTrack=undefined;
                  filteredStudents.forEach((s,i)=>{
                    const t=s.track||"";
                    if(t!==lastTrack){
                      rows.push(<tr key={`grp_${i}`}><td colSpan={types.length+4} style={{background:"rgba(245,166,35,0.06)",padding:"5px 14px",fontWeight:800,fontSize:11,color:"var(--accent)",borderBottom:"1px solid var(--border)",letterSpacing:0.5}}>{t?"🎓 "+t:"📋 ללא מסלול"}</td></tr>);
                      lastTrack=t;
                    }
                    rows.push(<tr key={s.id} style={{borderBottom:"1px solid var(--border)",background:i%2===0?"var(--surface)":"var(--surface2)"}}>
                    <td style={{padding:"10px 14px",whiteSpace:"nowrap"}}>
                      <div style={{fontWeight:700,fontSize:14}}>{s.name}</div>
                      {s.phone&&<div style={{fontSize:11,color:"var(--text3)"}}>{s.phone}</div>}
                    </td>
                    <td style={{padding:"10px 14px",fontSize:12,color:"var(--text3)",whiteSpace:"nowrap"}}>{s.email}</td>
                    <td style={{padding:"10px 14px",whiteSpace:"nowrap"}}>
                      {s.track
                        ? <span style={{background:"rgba(245,166,35,0.1)",border:"1px solid rgba(245,166,35,0.3)",borderRadius:20,padding:"3px 10px",fontSize:11,color:"var(--accent)",fontWeight:700}}>🎓 {s.track}</span>
                        : <span style={{fontSize:11,color:"var(--text3)"}}>—</span>}
                    </td>
                    {types.map(t=>{
                      const status = (s.certs||{})[t.id];
                      const passed = status==="עבר";
                      return (
                        <td key={t.id} style={{padding:"8px 12px",textAlign:"center"}}>
                          <button onClick={()=>toggleCert(s.id,t.id)} disabled={saving}
                            style={{padding:"5px 12px",borderRadius:20,border:`2px solid ${passed?"var(--green)":"var(--border)"}`,background:passed?"rgba(46,204,113,0.15)":"transparent",color:passed?"var(--green)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer",transition:"all 0.15s",whiteSpace:"nowrap",minWidth:100}}>
                            {passed?"✅ עבר/ה":"⬜ לא עבר/ה"}
                          </button>
                        </td>
                      );
                    })}
                    <td style={{padding:"8px 12px",textAlign:"center"}}>
                      <div style={{display:"flex",gap:4,justifyContent:"center"}}>
                        <button className="btn btn-secondary btn-sm" onClick={()=>{setEditStudent(s);setEditForm({name:s.name,email:s.email,phone:s.phone||"",track:s.track||""});}}>✏️</button>
                        <button className="btn btn-danger btn-sm" onClick={()=>deleteStudent(s.id)}>🗑️</button>
                      </div>
                    </td>
                  </tr>);
                  });
                  return rows;
                })()}
              </tbody>
            </table>
          </div>

          {/* Mobile — cards with vertical scroll */}
          <div className="cert-mobile" style={{flexDirection:"column",gap:10}}>
            {filteredStudents.map(s=>(
              <div key={s.id} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"14px 16px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:15}}>{s.name}</div>
                    {s.track&&<div style={{fontSize:11,color:"var(--accent)",fontWeight:700}}>🎓 {s.track}</div>}
                    <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{s.email}</div>
                    {s.phone&&<div style={{fontSize:11,color:"var(--text3)"}}>{s.phone}</div>}
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <button className="btn btn-secondary btn-sm" onClick={()=>{setEditStudent(s);setEditForm({name:s.name,email:s.email,phone:s.phone||"",track:s.track||""});}}>✏️</button>
                    <button className="btn btn-danger btn-sm" onClick={()=>deleteStudent(s.id)}>🗑️</button>
                  </div>
                </div>
                {types.length>0&&(
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {types.map(t=>{
                      const passed=(s.certs||{})[t.id]==="עבר";
                      return (
                        <div key={t.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <span style={{fontSize:13,fontWeight:600}}>🎓 {t.name}</span>
                          <button onClick={()=>toggleCert(s.id,t.id)} disabled={saving}
                            style={{padding:"5px 14px",borderRadius:20,border:`2px solid ${passed?"var(--green)":"var(--border)"}`,background:passed?"rgba(46,204,113,0.15)":"transparent",color:passed?"var(--green)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer",minWidth:110,textAlign:"center"}}>
                            {passed?"✅ עבר/ה":"⬜ לא עבר/ה"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {/* ── Edit student modal ── */}
      {editStudent&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}}
          onClick={e=>e.target===e.currentTarget&&setEditStudent(null)}>
          <div style={{width:"100%",maxWidth:460,background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",direction:"rtl"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:"1px solid var(--border)",background:"var(--surface2)",borderRadius:"16px 16px 0 0"}}>
              <div style={{fontWeight:900,fontSize:16}}>✏️ עריכת סטודנט</div>
              <button className="btn btn-secondary btn-sm" onClick={()=>setEditStudent(null)}>✕</button>
            </div>
            <div style={{padding:"20px"}}>
              <div className="grid-2" style={{marginBottom:12}}>
                <div className="form-group"><label className="form-label">שם מלא *</label>
                  <input className="form-input" value={editForm.name} onChange={e=>setEditForm(p=>({...p,name:e.target.value}))}/></div>
                <div className="form-group"><label className="form-label">אימייל *</label>
                  <input className="form-input" type="email" value={editForm.email} onChange={e=>setEditForm(p=>({...p,email:e.target.value}))}/></div>
              </div>
              <div className="form-group"><label className="form-label">טלפון</label>
                <input className="form-input" value={editForm.phone} onChange={e=>setEditForm(p=>({...p,phone:e.target.value}))}/></div>
              <div className="form-group"><label className="form-label">מסלול לימודים</label>
                <datalist id="track-list-edit">
                  {[...new Set(students.map(s=>s.track||"").filter(Boolean))].map(t=><option key={t} value={t}/>)}
                </datalist>
                <input className="form-input" list="track-list-edit" value={editForm.track||""} onChange={e=>setEditForm(p=>({...p,track:e.target.value}))} placeholder='למשל: "הנדסאי קולנוע ב"'/></div>
              <div style={{display:"flex",gap:8,marginTop:16}}>
                <button className="btn btn-primary" disabled={!editForm.name.trim()||!editForm.email.trim()||saving} onClick={saveEdit}>
                  {saving?"⏳ שומר...":"💾 שמור שינויים"}
                </button>
                <button className="btn btn-secondary" onClick={()=>setEditStudent(null)}>ביטול</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DEPT HEAD CALENDAR PAGE ─────────────────────────────────────────────────
function DeptHeadCalendarPage({ reservations: initialReservations, kits=[], equipment=[], siteSettings={} }) {
  const [localRes, setLocalRes]   = useState(initialReservations);
  const [calDate, setCalDate]     = useState(new Date());
  const [statusF, setStatusF]     = useState([]);   // empty = all
  const [loanTypeF, setLoanTypeF] = useState("הכל");
  const [selected, setSelected]   = useState(null);
  const [approving, setApproving] = useState(null); // reservation id being approved

  const approveReservation = async (r) => {
    setApproving(r.id);
    try {
      const approveUrl = `/api/approve-production?id=${r.id}`;
      const res = await fetch(approveUrl);
      if (res.ok) {
        // Update local state immediately
        setLocalRes(prev => prev.map(x => x.id===r.id ? {...x, status:"ממתין"} : x));
        setSelected(null);
      }
    } catch(e) {
      console.error("approve error", e);
    }
    setApproving(null);
  };

  const reservations = localRes;
  const yr = calDate.getFullYear();
  const mo = calDate.getMonth();
  const HE_M = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  const HE_D = ["א׳","ב׳","ג׳","ד׳","ה׳","ו׳","ש׳"];
  const todayStr = today();

  const days = [];
  const startOffset = new Date(yr,mo,1).getDay();
  for(let i=0;i<startOffset;i++) days.push(null);
  for(let d=1;d<=new Date(yr,mo+1,0).getDate();d++) days.push(new Date(yr,mo,d));
  while(days.length<42) days.push(null);

  const SPAN_COLORS = [
    ["rgba(52,152,219,0.75)","#fff"],["rgba(46,204,113,0.75)","#fff"],
    ["rgba(155,89,182,0.75)","#fff"],["rgba(230,126,34,0.75)","#fff"],
    ["rgba(26,188,156,0.75)","#fff"],["rgba(236,72,153,0.75)","#fff"],
    ["rgba(200,160,0,0.75)","#fff"], ["rgba(231,76,60,0.75)","#fff"],
  ];

  const STATUS_OPTIONS = ["ממתין","אישור ראש מחלקה","מאושר","נדחה"];
  const STATUS_COLORS  = { "מאושר":"var(--green)","ממתין":"var(--yellow)","נדחה":"var(--red)","אישור ראש מחלקה":"#9b59b6" };
  const LOAN_ICONS     = { "פרטית":"👤","הפקה":"🎬","סאונד":"🎙️","קולנוע יומית":"🎥" };

  const activeRes = reservations.filter(r =>
    r.status !== "הוחזר" && r.borrow_date && r.return_date &&
    (statusF.length===0 || statusF.includes(r.status)) &&
    (loanTypeF==="הכל" || r.loan_type===loanTypeF)
  );
  const colorMap = {};
  activeRes.forEach((r,i) => { colorMap[r.id] = SPAN_COLORS[i % SPAN_COLORS.length]; });

  // Month reservations for list
  const monthStart = `${yr}-${String(mo+1).padStart(2,"0")}-01`;
  const monthEnd   = `${yr}-${String(mo+1).padStart(2,"0")}-${String(new Date(yr,mo+1,0).getDate()).padStart(2,"0")}`;
  const monthRes = activeRes.filter(r => r.borrow_date <= monthEnd && r.return_date >= monthStart)
    .sort((a,b)=>a.borrow_date<b.borrow_date?-1:1);

  return (
    <div style={{maxWidth:1100,margin:"0 auto",padding:"24px 16px",direction:"rtl","--accent":siteSettings.accentColor||"#f5a623","--accent-glow":`${siteSettings.accentColor||"#f5a623"}2e`}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:24,flexWrap:"wrap"}}>
        {siteSettings.logo
          ? <img src={siteSettings.logo} alt="לוגו" style={{width:56,height:56,objectFit:"contain",borderRadius:8}}/>
          : <div style={{fontSize:32}}>🎬</div>}
        {siteSettings.soundLogo && (
          <img src={siteSettings.soundLogo} alt="לוגו סאונד" style={{width:44,height:44,objectFit:"contain",borderRadius:6}}/>
        )}
        <div>
          <div style={{fontWeight:900,fontSize:20,color:"var(--accent)"}}>לוח השאלות — מבט ראש מחלקה</div>
          <div style={{fontSize:12,color:"var(--text3)"}}>קריאה בלבד · כל הסטטוסים</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",padding:"14px 16px",marginBottom:16,display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:12,fontWeight:700,color:"var(--text3)"}}>סינון:</span>
        {/* Status filters */}
        {STATUS_OPTIONS.map(s=>{
          const active = statusF.includes(s);
          return (
            <button key={s} type="button" onClick={()=>setStatusF(p=>p.includes(s)?p.filter(x=>x!==s):[...p,s])}
              style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${active?(STATUS_COLORS[s]||"var(--accent)"):"var(--border)"}`,background:active?"rgba(255,255,255,0.06)":"transparent",color:active?(STATUS_COLORS[s]||"var(--accent)"):"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
              {s}
            </button>
          );
        })}
        <span style={{fontSize:12,color:"var(--border)"}}>|</span>
        {/* Loan type */}
        {["הכל","פרטית","הפקה","סאונד","קולנוע יומית"].map(lt=>{
          const active=loanTypeF===lt;
          return <button key={lt} type="button" onClick={()=>setLoanTypeF(lt)}
            style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
            {LOAN_ICONS[lt]||"📦"} {lt}
          </button>;
        })}
        {(statusF.length>0||loanTypeF!=="הכל")&&(
          <button type="button" onClick={()=>{setStatusF([]);setLoanTypeF("הכל");}}
            style={{marginRight:"auto",padding:"4px 10px",borderRadius:20,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:11,cursor:"pointer"}}>
            ✕ נקה סינון
          </button>
        )}
      </div>

      {/* Calendar */}
      <div style={{background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",padding:"12px",marginBottom:20}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setCalDate(new Date(yr,mo-1,1))}>‹</button>
            <span style={{fontWeight:800,fontSize:15,minWidth:130,textAlign:"center"}}>{HE_M[mo]} {yr}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setCalDate(new Date(yr,mo+1,1))}>›</button>
          </div>
          <span style={{fontSize:12,color:"var(--text3)"}}>{monthRes.length} בקשות בחודש</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:4}}>
          {HE_D.map(d=><div key={d} style={{textAlign:"center",fontSize:11,fontWeight:700,color:"var(--text3)",padding:"4px 0"}}>{d}</div>)}
        </div>
        <CalendarGrid days={days} activeRes={activeRes} colorMap={colorMap} todayStr={todayStr} cellHeight={90} fontSize={10}/>
      </div>

      {/* Reservations list */}
      <div style={{fontWeight:800,fontSize:15,marginBottom:10}}>📋 בקשות {HE_M[mo]} {yr}</div>
      {monthRes.length===0
        ? <div style={{textAlign:"center",color:"var(--text3)",padding:"24px",fontSize:14}}>אין בקשות בחודש זה</div>
        : <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {monthRes.map(r=>(
            <div key={r.id} onClick={()=>setSelected(r===selected?null:r)}
              style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"12px 16px",cursor:"pointer",transition:"border-color 0.15s"}}
              onMouseEnter={e=>e.currentTarget.style.borderColor="var(--accent)"}
              onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}
            >
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <span style={{fontWeight:800,fontSize:14}}>{r.student_name}</span>
                <span style={{fontSize:12,color:"var(--text3)"}}>{LOAN_ICONS[r.loan_type]||"📦"} {r.loan_type}</span>
                <span style={{fontSize:11,color:"var(--text3)"}}>📅 {formatDate(r.borrow_date)} → {formatDate(r.return_date)}</span>
                <span className={`badge badge-${r.status==="מאושר"?"green":r.status==="ממתין"?"yellow":r.status==="נדחה"?"red":r.status==="באיחור"?"orange":"purple"}`} style={{marginRight:"auto"}}>
                  {r.status}
                </span>
              </div>
              {selected===r&&(
                <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid var(--border)"}}>
                  {/* פרטי סטודנט */}
                  <div style={{display:"flex",flexWrap:"wrap",gap:14,marginBottom:14}}>
                    {r.email&&<div style={{fontSize:13,color:"var(--text2)"}}>📧 {r.email}</div>}
                    {r.phone&&<div style={{fontSize:13,color:"var(--text2)"}}>📞 {r.phone}</div>}
                    {r.course&&<div style={{fontSize:13,color:"var(--text2)"}}>📚 {r.course}</div>}
                    {r.project_name&&<div style={{fontSize:13,color:"var(--text2)"}}>📽️ {r.project_name}</div>}
                    {r.crew_photographer_name&&<div style={{fontSize:13,color:"var(--text2)"}}>🎥 צלם: {r.crew_photographer_name}</div>}
                    {r.crew_sound_name&&<div style={{fontSize:13,color:"var(--text2)"}}>🎙️ סאונד: {r.crew_sound_name}</div>}
                  </div>
                  {/* ציוד מבוקש */}
                  {r.items?.length>0&&(
                    <div>
                      <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>ציוד מבוקש</div>
                      <div style={{display:"flex",flexDirection:"column",gap:8}}>
                        {r.items.map((item,idx)=>{
                          const eq = equipment.find(e=>e.name===item.name);
                          return (
                            <div key={idx} style={{display:"flex",alignItems:"center",gap:12,background:"var(--surface2)",borderRadius:8,padding:"10px 12px",border:"1px solid var(--border)"}}>
                              <div style={{width:56,height:56,borderRadius:8,overflow:"hidden",background:"var(--surface)",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid var(--border)"}}>
                                {eq?.image
                                  ? <img src={eq.image} alt={item.name} style={{width:"100%",height:"100%",objectFit:"contain"}}/>
                                  : <span style={{fontSize:24}}>📦</span>}
                              </div>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontWeight:800,fontSize:14}}>{item.name}</div>
                                {eq?.description&&<div style={{fontSize:11,color:"var(--text3)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{eq.description}</div>}
                              </div>
                              <div style={{background:"var(--accent-glow)",border:"1px solid var(--accent)",borderRadius:8,padding:"5px 14px",fontSize:15,fontWeight:900,color:"var(--accent)",flexShrink:0}}>×{item.quantity}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {(r.status==="אישור ראש מחלקה"||r.status==="ממתין לאישור ראש המחלקה")&&(
                    <div style={{marginTop:14}}>
                      <button
                        onClick={e=>{e.stopPropagation();approveReservation(r);}}
                        disabled={approving===r.id}
                        style={{padding:"10px 24px",borderRadius:"var(--r-sm)",border:"none",background:"#9b59b6",color:"#fff",fontWeight:900,fontSize:14,cursor:"pointer",opacity:approving===r.id?0.6:1,display:"flex",alignItems:"center",gap:8}}>
                        {approving===r.id ? "⏳ מאשר..." : "✅ אשר הפקה — העבר לממתין"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      }
    </div>
  );
}

// ─── MANAGER CALENDAR PAGE ───────────────────────────────────────────────────
function ManagerCalendarPage({ reservations: initialReservations, setReservations, collegeManager, equipment=[], kits=[], siteSettings={} }) {
  const [localRes, setLocalRes]   = useState(initialReservations);
  const [calDate, setCalDate]     = useState(new Date());
  const [statusF, setStatusF]     = useState([]);
  const [loanTypeF, setLoanTypeF] = useState("הכל");
  const [selected, setSelected]   = useState(null);
  const [changingStatus, setChangingStatus] = useState(null);
  const [selectedKit, setSelectedKit] = useState(null); // kit lesson detail modal

  const ALL_STATUSES  = ["ממתין","אישור ראש מחלקה","מאושר","נדחה"];
  const STATUS_COLORS = { "מאושר":"var(--green)","ממתין":"var(--yellow)","נדחה":"var(--red)","אישור ראש מחלקה":"#9b59b6" };
  const STATUS_BADGE  = { "מאושר":"green","ממתין":"yellow","נדחה":"red","באיחור":"orange","אישור ראש מחלקה":"purple" };
  const LOAN_ICONS    = { "פרטית":"👤","הפקה":"🎬","סאונד":"🎙️","קולנוע יומית":"🎥" };
  const HE_M = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  const HE_D = ["א׳","ב׳","ג׳","ד׳","ה׳","ו׳","ש׳"];
  const SPAN_COLORS = [
    ["rgba(52,152,219,0.75)","#fff"],["rgba(46,204,113,0.75)","#fff"],
    ["rgba(155,89,182,0.75)","#fff"],["rgba(230,126,34,0.75)","#fff"],
    ["rgba(26,188,156,0.75)","#fff"],["rgba(236,72,153,0.75)","#fff"],
    ["rgba(200,160,0,0.75)","#fff"], ["rgba(231,76,60,0.75)","#fff"],
  ];

  const changeStatus = async (r, newStatus) => {
    setChangingStatus(r.id);
    try {
      const allRes = (await storageGet("reservations")).value;
      const updated = (allRes||[]).map(x => x.id===r.id ? {...x, status:newStatus} : x);
      const ok = await storageSet("reservations", updated);
      if(ok.ok) {
        setLocalRes(prev => prev.map(x => x.id===r.id ? {...x, status:newStatus} : x));
        if(setReservations) setReservations(updated);
        setSelected(null);
      }
    } catch(e) { console.error("changeStatus error", e); }
    setChangingStatus(null);
  };

  const yr = calDate.getFullYear();
  const mo = calDate.getMonth();
  const todayStr = today();

  const days = [];
  const startOffset = new Date(yr,mo,1).getDay();
  for(let i=0;i<startOffset;i++) days.push(null);
  for(let d=1;d<=new Date(yr,mo+1,0).getDate();d++) days.push(new Date(yr,mo,d));
  while(days.length<42) days.push(null);

  const activeRes = localRes.filter(r =>
    r.status !== "הוחזר" && r.borrow_date && r.return_date &&
    !(r.loan_type === "שיעור" && r.status !== "מאושר") &&
    (statusF.length===0 || statusF.includes(r.status)) &&
    (loanTypeF==="הכל" || r.loan_type===loanTypeF)
  );
  const colorMap = {};
  activeRes.forEach((r,i) => { colorMap[r.id] = SPAN_COLORS[i % SPAN_COLORS.length]; });

  const monthStart = `${yr}-${String(mo+1).padStart(2,"0")}-01`;
  const monthEnd   = `${yr}-${String(mo+1).padStart(2,"0")}-${String(new Date(yr,mo+1,0).getDate()).padStart(2,"0")}`;
  const monthRes = activeRes.filter(r => r.borrow_date<=monthEnd && r.return_date>=monthStart)
    .sort((a,b)=>a.borrow_date<b.borrow_date?-1:1);
  const totalUnitsForReservation = (reservation) => (reservation?.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const getEquipmentRecord = (item) => equipment.find(eq => String(eq.id)===String(item.equipment_id)) || equipment.find(eq => eq.name===item.name) || null;
  const renderEquipmentThumb = (item) => {
    const eq = getEquipmentRecord(item);
    const img = eq?.image || "📦";
    const isImg = typeof img === "string" && (img.startsWith("data:") || img.startsWith("http"));
    return isImg
      ? <img src={img} alt={item.name || ""} style={{width:56,height:56,objectFit:"contain",borderRadius:10,border:"1px solid var(--border)",background:"var(--surface2)",padding:4}}/>
      : <div style={{width:56,height:56,display:"flex",alignItems:"center",justifyContent:"center",fontSize:30,borderRadius:10,border:"1px solid var(--border)",background:"var(--surface2)"}}>{img}</div>;
  };

  return (
    <div style={{maxWidth:1100,margin:"0 auto",padding:"24px 16px",direction:"rtl","--accent":siteSettings.accentColor||"#f5a623","--accent-glow":`${siteSettings.accentColor||"#f5a623"}2e`}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:24,flexWrap:"wrap"}}>
        {siteSettings.logo
          ? <img src={siteSettings.logo} alt="לוגו" style={{width:56,height:56,objectFit:"contain",borderRadius:8}}/>
          : <div style={{fontSize:32}}>🏫</div>}
        {siteSettings.soundLogo && (
          <img src={siteSettings.soundLogo} alt="לוגו סאונד" style={{width:44,height:44,objectFit:"contain",borderRadius:6}}/>
        )}
        <div>
          <div style={{fontWeight:900,fontSize:20,color:"var(--accent)"}}>לוח השאלות — מנהל המכללה</div>
          <div style={{fontSize:12,color:"var(--text3)"}}>שינוי סטטוסים · כל הבקשות{collegeManager?.name?` · שלום ${collegeManager.name}`:""}</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",padding:"14px 16px",marginBottom:16,display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:12,fontWeight:700,color:"var(--text3)"}}>סינון:</span>
        {ALL_STATUSES.map(s=>{
          const active=statusF.includes(s);
          return (
            <button key={s} type="button" onClick={()=>setStatusF(p=>p.includes(s)?p.filter(x=>x!==s):[...p,s])}
              style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${active?(STATUS_COLORS[s]||"var(--accent)"):"var(--border)"}`,background:active?"rgba(255,255,255,0.06)":"transparent",color:active?(STATUS_COLORS[s]||"var(--accent)"):"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
              {s}
            </button>
          );
        })}
        <span style={{fontSize:12,color:"var(--border)"}}>|</span>
        {["הכל","פרטית","הפקה","סאונד","קולנוע יומית"].map(lt=>{
          const active=loanTypeF===lt;
          return <button key={lt} type="button" onClick={()=>setLoanTypeF(lt)}
            style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
            {LOAN_ICONS[lt]||"📦"} {lt}
          </button>;
        })}
        {(statusF.length>0||loanTypeF!=="הכל")&&(
          <button type="button" onClick={()=>{setStatusF([]);setLoanTypeF("הכל");}}
            style={{marginRight:"auto",padding:"4px 10px",borderRadius:20,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:11,cursor:"pointer"}}>
            ✕ נקה סינון
          </button>
        )}
      </div>

      {/* Calendar */}
      <div style={{background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",padding:"12px",marginBottom:20}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setCalDate(new Date(yr,mo-1,1))}>‹</button>
            <span style={{fontWeight:800,fontSize:15,minWidth:130,textAlign:"center"}}>{HE_M[mo]} {yr}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setCalDate(new Date(yr,mo+1,1))}>›</button>
          </div>
          <span style={{fontSize:12,color:"var(--text3)"}}>{monthRes.length} בקשות בחודש</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:4}}>
          {HE_D.map(d=><div key={d} style={{textAlign:"center",fontSize:11,fontWeight:700,color:"var(--text3)",padding:"4px 0"}}>{d}</div>)}
        </div>
        <CalendarGrid days={days} activeRes={activeRes} colorMap={colorMap} todayStr={todayStr} cellHeight={90} fontSize={10}/>
      </div>

      {/* Reservations list */}
      <div style={{fontWeight:800,fontSize:15,marginBottom:10}}>📋 בקשות {HE_M[mo]} {yr}</div>
      {monthRes.length===0
        ? <div style={{textAlign:"center",color:"var(--text3)",padding:"24px",fontSize:14}}>אין בקשות בחודש זה</div>
        : <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {monthRes.map(r=>(
            <div key={r.id} onClick={()=>setSelected(r===selected?null:r)}
              style={{background:"var(--surface)",border:`1px solid ${selected===r?"var(--accent)":"var(--border)"}`,borderRadius:"var(--r)",padding:"12px 16px",cursor:"pointer",transition:"border-color 0.15s"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <span style={{fontWeight:800,fontSize:14}}>{r.student_name}</span>
                <span style={{fontSize:12,color:"var(--text3)"}}>{LOAN_ICONS[r.loan_type]||"📦"} {r.loan_type}</span>
                <span style={{fontSize:11,color:"var(--text3)"}}>📅 {formatDate(r.borrow_date)} → {formatDate(r.return_date)}</span>
                <span className={`badge badge-${STATUS_BADGE[r.status]||"yellow"}`} style={{marginRight:"auto"}}>{r.status}</span>
              </div>
              {selected===r&&(
                <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid var(--border)",display:"flex",flexDirection:"column",gap:12}} onClick={e=>e.stopPropagation()}>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10}}>
                    {r.email&&(
                      <div style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"10px 12px"}}>
                        <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",marginBottom:4}}>{"אימייל"}</div>
                        <div style={{fontSize:13,fontWeight:700,color:"var(--text1)",wordBreak:"break-word"}}>{r.email}</div>
                      </div>
                    )}
                    {r.phone&&(
                      <div style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"10px 12px"}}>
                        <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",marginBottom:4}}>{"טלפון"}</div>
                        <div style={{fontSize:13,fontWeight:700,color:"var(--text1)"}}>{r.phone}</div>
                      </div>
                    )}
                    {r.course&&(
                      <div style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"10px 12px"}}>
                        <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",marginBottom:4}}>{"קורס / כיתה"}</div>
                        <div style={{fontSize:13,fontWeight:700,color:"var(--text1)"}}>{r.course}</div>
                      </div>
                    )}
                    {r.project_name&&(
                      <div style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"10px 12px"}}>
                        <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",marginBottom:4}}>{"שם הפרויקט"}</div>
                        <div style={{fontSize:13,fontWeight:700,color:"var(--text1)"}}>{r.project_name}</div>
                      </div>
                    )}
                    <div style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"10px 12px"}}>
                      <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",marginBottom:4}}>{"סוגי פריטים"}</div>
                      <div style={{fontSize:13,fontWeight:900,color:"var(--accent)"}}>{r.items?.length || 0}</div>
                    </div>
                    <div style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"10px 12px"}}>
                      <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",marginBottom:4}}>{"סך יחידות"}</div>
                      <div style={{fontSize:13,fontWeight:900,color:"var(--accent)"}}>{totalUnitsForReservation(r)}</div>
                    </div>
                  </div>

                  {(r.crew_photographer_name || r.crew_sound_name) && (
                    <div style={{background:"linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"12px 14px"}}>
                      <div style={{fontSize:12,fontWeight:900,color:"var(--text1)",marginBottom:8}}>{"צוות ההפקה"}</div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:8}}>
                        {r.crew_photographer_name&&(
                          <div style={{fontSize:13,color:"var(--text2)"}}>
                            <span style={{fontWeight:800,color:"var(--accent)"}}>{"צלם:"}</span> {r.crew_photographer_name}
                          </div>
                        )}
                        {r.crew_sound_name&&(
                          <div style={{fontSize:13,color:"var(--text2)"}}>
                            <span style={{fontWeight:800,color:"var(--accent)"}}>{"איש סאונד:"}</span> {r.crew_sound_name}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {r.items?.length>0&&(
                    <div style={{background:"linear-gradient(180deg, rgba(255,170,0,0.08), rgba(255,170,0,0.03))",border:"1px solid rgba(255,170,0,0.24)",borderRadius:"var(--r)",padding:"14px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:12}}>
                        <div>
                          <div style={{fontSize:14,fontWeight:900,color:"var(--text1)"}}>{"פריטי ההשאלה"}</div>
                          <div style={{fontSize:12,color:"var(--text3)"}}>{"פירוט ברור של כל הציוד שנכלל בבקשה"}</div>
                        </div>
                        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                          <span className="badge badge-yellow">{r.items.length} {"סוגים"}</span>
                          <span className="badge badge-green">{totalUnitsForReservation(r)} {"יחידות"}</span>
                        </div>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10}}>
                        {r.items.map((item, idx)=>(
                          <div key={r.id + "-" + (item.equipment_id || item.name || idx)} style={{background:"rgba(10,12,18,0.55)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"var(--r-sm)",padding:"12px",display:"flex",flexDirection:"column",gap:10,minHeight:120}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
                              <div style={{display:"flex",alignItems:"flex-start",gap:12,flex:1,minWidth:0}}>
                                {renderEquipmentThumb(item)}
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontSize:15,fontWeight:900,color:"var(--text1)",lineHeight:1.35,wordBreak:"break-word"}}>{item.name || ("פריט " + (idx+1))}</div>
                                  {item.equipment_id&&<div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>{"מזהה ציוד: "}{item.equipment_id}</div>}
                                </div>
                              </div>
                              <div style={{minWidth:64,alignSelf:"stretch",display:"flex",alignItems:"center",justifyContent:"center",padding:"8px 10px",borderRadius:"12px",background:"var(--accent-glow)",border:"1px solid rgba(255,170,0,0.3)"}}>
                                <div style={{textAlign:"center"}}>
                                  <div style={{fontSize:10,fontWeight:800,color:"var(--text3)",marginBottom:2}}>{"כמות"}</div>
                                  <div style={{fontSize:22,fontWeight:900,color:"var(--accent)",lineHeight:1}}>{item.quantity || 0}</div>
                                </div>
                              </div>
                            </div>
                            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:"auto"}}>
                              <span style={{padding:"4px 8px",borderRadius:999,border:"1px solid var(--border)",background:"var(--surface2)",fontSize:11,color:"var(--text3)"}}>{"פריט #"}{idx+1}</span>
                              <span style={{padding:"4px 8px",borderRadius:999,border:"1px solid rgba(255,170,0,0.24)",background:"rgba(255,170,0,0.08)",fontSize:11,color:"var(--accent)"}}>{"להשאלה"}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* ── Status change ── */}
                  <div style={{marginTop:4,background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:"10px 12px",border:"1px solid var(--border)"}}>
                    <div style={{fontSize:12,fontWeight:700,color:"var(--text2)",marginBottom:8}}>🔄 שינוי סטטוס</div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      {ALL_STATUSES.map(s=>{
                        const isCurrent = r.status===s;
                        const col = STATUS_COLORS[s]||"var(--accent)";
                        return (
                          <button key={s} type="button"
                            disabled={isCurrent||changingStatus===r.id}
                            onClick={()=>changeStatus(r,s)}
                            style={{padding:"8px 16px",borderRadius:"var(--r-sm)",border:`2px solid ${isCurrent?col:"var(--border)"}`,background:isCurrent?`${col}22`:"var(--surface)",color:isCurrent?col:"var(--text2)",fontWeight:isCurrent?900:700,fontSize:13,cursor:isCurrent?"default":"pointer",opacity:changingStatus===r.id&&!isCurrent?0.5:1,transition:"all 0.15s"}}>
                            {changingStatus===r.id&&!isCurrent?"⏳ ":isCurrent?"✓ ":""}{s}
                          </button>
                        );
                      })}
                    </div>
                    {changingStatus===r.id&&<div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>⏳ מעדכן סטטוס...</div>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      }

      {/* ── ערכות שיעור ── */}
      {(()=>{
        const lessonKits = kits.filter(k=>k.kitType==="lesson");
        if(!lessonKits.length) return null;
        const todayStr2 = today();
        const nowHHMM2 = (()=>{const n=new Date();return String(n.getHours()).padStart(2,"0")+":"+String(n.getMinutes()).padStart(2,"0");})();
        const upcoming = lessonKits.flatMap(kit=>
          (kit.schedule||[])
            .filter(s=>{
              if(s.date > todayStr2) return true;
              if(s.date === todayStr2) return (s.endTime||"23:59") > nowHHMM2;
              return false;
            })
            .map(s=>({...s, kitName:kit.name, instructorName:kit.instructorName||"", instructorPhone:kit.instructorPhone||"", items:kit.items||[]}))
        ).sort((a,b)=>a.date<b.date?-1:a.startTime<b.startTime?-1:1).slice(0,10);
        if(!upcoming.length) return null;
        return (
          <div style={{marginTop:28}}>
            <div style={{fontWeight:800,fontSize:15,marginBottom:10}}>🎬 ערכות שיעור — שיעורים קרובים</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {upcoming.map((s,i)=>(
                <div key={i} onClick={()=>setSelectedKit(s)} style={{background:"var(--surface)",border:"1px solid rgba(155,89,182,0.3)",borderRadius:"var(--r)",padding:"14px 18px",cursor:"pointer",transition:"border-color .15s"}}
                  onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(155,89,182,0.7)"}
                  onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(155,89,182,0.3)"}>
                  <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                    <span style={{fontSize:22}}>🎬</span>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:800,fontSize:15}}>{s.kitName}</div>
                      {s.instructorName&&<div style={{fontSize:12,color:"var(--text2)"}}>👨‍🏫 {s.instructorName}{s.instructorPhone?` · 📞 ${s.instructorPhone}`:""}</div>}
                    </div>
                    <div style={{textAlign:"left",fontSize:13,color:"var(--text3)",fontWeight:700}}>
                      📅 {formatDate(s.date)}&nbsp;&nbsp;🕐 {s.startTime} – {s.endTime}
                    </div>
                    <span style={{fontSize:11,color:"#9b59b6",border:"1px solid rgba(155,89,182,0.4)",borderRadius:20,padding:"2px 8px"}}>📦 {s.items.length} פריטים</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Kit lesson detail modal ── */}
      {selectedKit&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}} onClick={e=>e.target===e.currentTarget&&setSelectedKit(null)}>
          <div style={{width:"100%",maxWidth:540,background:"var(--surface)",borderRadius:16,border:"1px solid rgba(155,89,182,0.4)",direction:"rtl",maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:"1px solid var(--border)",background:"var(--surface2)",borderRadius:"16px 16px 0 0",position:"sticky",top:0,zIndex:1}}>
              <div>
                <div style={{fontWeight:900,fontSize:16,color:"#9b59b6"}}>🎬 {selectedKit.kitName}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>📅 {formatDate(selectedKit.date)} · 🕐 {selectedKit.startTime} – {selectedKit.endTime}</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={()=>setSelectedKit(null)}>✕ סגור</button>
            </div>
            <div style={{padding:"20px"}}>
              {selectedKit.instructorName&&(
                <div style={{background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:"12px 14px",marginBottom:14,fontSize:13}}>
                  👨‍🏫 <strong>{selectedKit.instructorName}</strong>
                  {selectedKit.instructorPhone&&<span style={{color:"var(--text3)",marginRight:8}}> · 📞 {selectedKit.instructorPhone}</span>}
                </div>
              )}
              <div style={{fontSize:12,fontWeight:800,color:"var(--text3)",marginBottom:10,textTransform:"uppercase",letterSpacing:1}}>ציוד השיעור — {selectedKit.items.length} פריטים</div>
              {selectedKit.items.length===0
                ? <div style={{color:"var(--text3)",fontSize:13,textAlign:"center",padding:20}}>אין ציוד מוגדר לערכה זו</div>
                : <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {selectedKit.items.map((item,j)=>{
                    const eq = equipment.find(e=>e.id==item.equipment_id||e.name===item.name);
                    const img = eq?.image||"";
                    return (
                      <div key={j} style={{display:"flex",alignItems:"center",gap:12,background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:"10px 14px",border:"1px solid var(--border)"}}>
                        {img.startsWith("data:")||img.startsWith("http")
                          ? <img src={img} alt="" style={{width:36,height:36,objectFit:"cover",borderRadius:6,flexShrink:0}}/>
                          : <div style={{width:36,height:36,borderRadius:6,background:"rgba(155,89,182,0.12)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>📦</div>}
                        <span style={{flex:1,fontWeight:700,fontSize:14}}>{item.name||("פריט "+(j+1))}</span>
                        <span style={{background:"rgba(155,89,182,0.12)",color:"#9b59b6",border:"1px solid rgba(155,89,182,0.35)",borderRadius:8,padding:"3px 12px",fontWeight:900,fontSize:14}}>×{item.quantity}</span>
                      </div>
                    );
                  })}
                </div>
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── UNITS MODAL ─────────────────────────────────────────────────────────────
function UnitsModal({ eq, equipment, setEquipment, showToast, onClose }) {
  const [units, setUnits] = useState(eq.units || []);
  const [saving, setSaving] = useState(false);
  const [addCount, setAddCount] = useState(1);

  const STATUS_COLORS = {"תקין":"var(--green)","פגום":"var(--red)","בתיקון":"var(--yellow)","נעלם":"#9b59b6"};

  const setUnitStatus = (unitId, status) => {
    setUnits(prev => prev.map(u => u.id===unitId ? {...u, status} : u));
  };

  const removeUnit = (unitId) => {
    setUnits(prev => prev.filter(u => u.id !== unitId));
  };

  const addUnits = () => {
    const count = Math.max(1, Math.min(20, Number(addCount)||1));
    const existing = units.map(u => {
      const n = parseInt(u.id?.split("_")[1] || "0", 10);
      return isNaN(n) ? 0 : n;
    });
    let nextNum = (existing.length ? Math.max(...existing) : 0) + 1;
    const newUnits = Array.from({length: count}, () => ({
      id: `${eq.id}_${nextNum++}`,
      status: "תקין",
      fault: "",
      repair: "",
    }));
    setUnits(prev => [...prev, ...newUnits]);
  };

  const saveAll = async () => {
    setSaving(true);
    const updatedEq = {...eq, units, total_quantity: units.length};
    const updatedEquipment = equipment.map(e => e.id===eq.id ? updatedEq : e);
    const previousEquipment = equipment;
    setEquipment(updatedEquipment);
    const r = await storageSet("equipment", updatedEquipment);
    setSaving(false);
    if(r.ok) { showToast("success", "היחידות עודכנו"); onClose(); }
    else {
      setEquipment(previousEquipment);
      showToast("error","❌ שגיאה בשמירה");
    }
  };

  const working = units.filter(u=>u.status==="תקין").length;
  const damaged = units.length - working;

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{width:"100%",maxWidth:520,maxHeight:"90vh",background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",direction:"rtl",display:"flex",flexDirection:"column"}}>
        <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",background:"var(--surface2)",borderRadius:"16px 16px 0 0",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div>
            <div style={{fontWeight:900,fontSize:16}}>🔧 ניהול יחידות — {eq.name}</div>
            <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
              <span style={{color:"var(--green)",fontWeight:700}}>{working} תקין</span>
              {damaged>0&&<span style={{color:"var(--red)",fontWeight:700,marginRight:8}}> · {damaged} בדיקה</span>}
              <span style={{color:"var(--text3)",marginRight:8}}> · סה"כ {units.length} יחידות</span>
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* ── Add units row ── */}
        <div style={{padding:"10px 20px",borderBottom:"1px solid var(--border)",background:"rgba(245,166,35,0.04)",display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          <span style={{fontSize:12,fontWeight:700,color:"var(--text2)"}}>➕ הוספת יחידות:</span>
          <input type="number" min={1} max={20} value={addCount} onChange={e=>setAddCount(e.target.value)}
            style={{width:56,padding:"4px 8px",borderRadius:"var(--r-sm)",border:"1px solid var(--border)",background:"var(--surface2)",color:"var(--text)",fontSize:13,textAlign:"center"}}/>
          <button className="btn btn-primary btn-sm" onClick={addUnits}>הוסף</button>
          <span style={{fontSize:11,color:"var(--text3)"}}>יחידות חדשות יתווספו כ"תקין"</span>
        </div>

        <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:8}}>
          {units.length===0 && (
            <div style={{textAlign:"center",color:"var(--text3)",padding:24,fontSize:13}}>אין יחידות — הוסף יחידות למעלה</div>
          )}
          {units.map((u,i)=>{
            const unitNum = u.id?.split("_")[1]||String(i+1);
            return (
              <div key={u.id} style={{background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:"10px 14px",border:`1px solid ${STATUS_COLORS[u.status]||"var(--border)"}44`}}>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <span style={{fontWeight:700,fontSize:13,minWidth:72}}>יחידה #{unitNum}</span>
                  <div style={{display:"flex",gap:6,flex:1,flexWrap:"wrap"}}>
                    {["תקין","פגום","בתיקון","נעלם"].map(s=>{
                      const active = u.status===s;
                      return (
                        <button key={s} type="button" onClick={()=>setUnitStatus(u.id,s)}
                          style={{padding:"4px 10px",borderRadius:20,border:`2px solid ${active?STATUS_COLORS[s]:"var(--border)"}`,background:active?`${STATUS_COLORS[s]}22`:"transparent",color:active?STATUS_COLORS[s]:"var(--text3)",fontWeight:700,fontSize:11,cursor:"pointer"}}>
                          {s}
                        </button>
                      );
                    })}
                  </div>
                  <button type="button" onClick={()=>removeUnit(u.id)}
                    title="הסר יחידה"
                    style={{padding:"3px 7px",borderRadius:"var(--r-sm)",border:"1px solid rgba(231,76,60,0.3)",background:"rgba(231,76,60,0.08)",color:"var(--red)",fontSize:12,cursor:"pointer",flexShrink:0}}>
                    🗑️
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{padding:"14px 20px",borderTop:"1px solid var(--border)",flexShrink:0,display:"flex",gap:8}}>
          <button className="btn btn-primary" disabled={saving} onClick={saveAll}>{saving?"⏳ שומר...":"💾 שמור שינויים"}</button>
          <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
        </div>
      </div>
    </div>
  );
}

// ─── SETTINGS PAGE ───────────────────────────────────────────────────────────
function SettingsPage({ siteSettings, setSiteSettings, showToast }) {
  const [draft, setDraft] = useState({ aiMaxRequests: 5, ...siteSettings });
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [soundLogoUploading, setSoundLogoUploading] = useState(false);

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    if (file.size > 500000) { showToast("error", "הקובץ גדול מדי — עד 500KB"); return; }
    setLogoUploading(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setDraft(p => ({ ...p, logo: ev.target.result }));
      setLogoUploading(false);
    };
    reader.onerror = () => { showToast("error", "שגיאה בקריאת הקובץ"); setLogoUploading(false); };
    reader.readAsDataURL(file);
  };

  const handleSoundLogoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    if (file.size > 500000) { showToast("error", "הקובץ גדול מדי — עד 500KB"); return; }
    setSoundLogoUploading(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setDraft(p => ({ ...p, soundLogo: ev.target.result }));
      setSoundLogoUploading(false);
    };
    reader.onerror = () => { showToast("error", "שגיאה בקריאת הקובץ"); setSoundLogoUploading(false); };
    reader.readAsDataURL(file);
  };

  const toggleTheme = (theme) => {
    setDraft(p => ({ ...p, theme }));
    document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "");
  };

  const save = async () => {
    setSaving(true);
    setSiteSettings(draft);
    await storageSet("siteSettings", draft);
    setSaving(false);
    showToast("success", "ההגדרות נשמרו ✅");
  };

  return (
    <div className="page">
      {/* Theme */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><div className="card-title">🎨 מצב תצוגה</div></div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {[{ k: "dark", icon: "🌙", label: "מצב כהה" }, { k: "light", icon: "☀️", label: "מצב בהיר" }].map(({ k, icon, label }) => (
              <button key={k} type="button" onClick={() => toggleTheme(k)}
                style={{ flex: 1, minWidth: 140, padding: "20px 16px", borderRadius: "var(--r)", border: `2px solid ${draft.theme === k ? "var(--accent)" : "var(--border)"}`, background: draft.theme === k ? "var(--accent-glow)" : "var(--surface2)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 32 }}>{icon}</span>
                <span style={{ fontWeight: 800, fontSize: 14, color: draft.theme === k ? "var(--accent)" : "var(--text)" }}>{label}</span>
                {draft.theme === k && <span style={{ fontSize: 14, color: "var(--green)", fontWeight: 900 }}>✓ פעיל</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Logo */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><div className="card-title">🏫 לוגו המכללה</div></div>
        <div style={{ padding: "16px 20px" }}>
          {/* לוגו ראשי */}
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 8 }}>לוגו ראשי</div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>
            יוצג בסרגל הצדדי של לוח הבקרה ובראש טופס ההשאלה. מומלץ תמונה מרובעת עד 500KB.
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 20 }}>
            <div style={{ width: 80, height: 80, borderRadius: 12, border: "2px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface2)", overflow: "hidden", flexShrink: 0 }}>
              {draft.logo
                ? <img src={draft.logo} alt="לוגו" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                : <span style={{ fontSize: 32, color: "var(--text3)" }}>🎬</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label className="btn btn-secondary" style={{ cursor: logoUploading ? "not-allowed" : "pointer", opacity: logoUploading ? 0.6 : 1 }}>
                {logoUploading ? "⏳ מעלה..." : "📷 העלה לוגו"}
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleLogoUpload} disabled={logoUploading} />
              </label>
              {draft.logo && (
                <button type="button" className="btn btn-secondary" onClick={() => setDraft(p => ({ ...p, logo: "" }))} style={{ fontSize: 12 }}>
                  🗑️ הסר לוגו
                </button>
              )}
            </div>
          </div>
          {/* מפריד */}
          <div style={{ borderTop: "1px solid var(--border)", marginBottom: 16 }} />
          {/* לוגו סאונד */}
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 8 }}>🎙️ לוגו סאונד (לוגו נוסף)</div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>
            לוגו נוסף שיוצג מתחת ללוגו הראשי בסרגל לוח הבקרה ובטופס ההשאלה. מומלץ עד 500KB.
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ width: 80, height: 80, borderRadius: 12, border: "2px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface2)", overflow: "hidden", flexShrink: 0 }}>
              {draft.soundLogo
                ? <img src={draft.soundLogo} alt="לוגו סאונד" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                : <span style={{ fontSize: 32, color: "var(--text3)" }}>🎙️</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label className="btn btn-secondary" style={{ cursor: soundLogoUploading ? "not-allowed" : "pointer", opacity: soundLogoUploading ? 0.6 : 1 }}>
                {soundLogoUploading ? "⏳ מעלה..." : "📷 העלה לוגו סאונד"}
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleSoundLogoUpload} disabled={soundLogoUploading} />
              </label>
              {draft.soundLogo && (
                <button type="button" className="btn btn-secondary" onClick={() => setDraft(p => ({ ...p, soundLogo: "" }))} style={{ fontSize: 12 }}>
                  🗑️ הסר לוגו סאונד
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Accent Color */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><div className="card-title">🎨 בחירת צבע לחצנים / טקסט</div></div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 14 }}>
            הצבע יוחל על הלחצנים, הכותרות והטקסטים הצבעוניים בטופס השאלת הציוד ועל אייקון המידע.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <input type="color" value={draft.accentColor||"#f5a623"}
              onChange={e => setDraft(p => ({ ...p, accentColor: e.target.value }))}
              style={{ width: 52, height: 40, borderRadius: 8, border: "2px solid var(--border)", background: "none", cursor: "pointer", padding: 2 }} />
            <span style={{ fontSize: 13, color: "var(--text2)", fontFamily: "monospace" }}>{draft.accentColor||"#f5a623"}</span>
            <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }}
              onClick={() => setDraft(p => ({ ...p, accentColor: "#f5a623" }))}>
              ↩ איפוס לברירת מחדל
            </button>
          </div>
          <div style={{ marginTop: 14, padding: "12px 16px", borderRadius: 8, background: "var(--surface2)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>תצוגה מקדימה:</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" style={{ background: draft.accentColor||"#f5a623", color: "#0a0c10", border: "none", borderRadius: 8, padding: "8px 18px", fontWeight: 800, cursor: "default", fontSize: 13 }}>כפתור לדוגמה</button>
              <span style={{ color: draft.accentColor||"#f5a623", fontWeight: 800, fontSize: 14 }}>טקסט צבעוני</span>
              <svg width="32" height="32" viewBox="0 0 42 42" fill="none" style={{ color: draft.accentColor||"#f5a623" }}>
                <circle cx="21" cy="21" r="19" stroke="currentColor" strokeWidth="2.2"/>
                <circle cx="21" cy="14.5" r="2.2" fill="currentColor"/>
                <rect x="19.4" y="19.5" width="3.2" height="10.5" rx="1.6" fill="currentColor"/>
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Admin Accent Color + Font Size */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><div className="card-title">🖥️ בחירת צבע לחצים / טקסט לוח בקרה</div></div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 14 }}>
            הצבע יוחל על הלחצנים, הכותרות והטקסטים הצבעוניים בלוח הבקרה (בנפרד מטופס ההשאלה).
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
            <input type="color" value={draft.adminAccentColor||"#f5a623"}
              onChange={e => setDraft(p => ({ ...p, adminAccentColor: e.target.value }))}
              style={{ width: 52, height: 40, borderRadius: 8, border: "2px solid var(--border)", background: "none", cursor: "pointer", padding: 2 }} />
            <span style={{ fontSize: 13, color: "var(--text2)", fontFamily: "monospace" }}>{draft.adminAccentColor||"#f5a623"}</span>
            <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }}
              onClick={() => setDraft(p => ({ ...p, adminAccentColor: "#f5a623" }))}>
              ↩ איפוס לברירת מחדל
            </button>
          </div>
          <div style={{ borderTop: "1px solid var(--border)", marginBottom: 16 }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 10 }}>גודל פונט (דסקטופ בלבד)</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <input type="range" min={11} max={20} step={1}
              value={draft.adminFontSize||14}
              onChange={e => setDraft(p => ({ ...p, adminFontSize: Number(e.target.value) }))}
              style={{ width: 180, accentColor: draft.adminAccentColor||"#f5a623" }} />
            <span style={{ fontSize: 14, fontWeight: 700, minWidth: 32, color: "var(--text2)" }}>{draft.adminFontSize||14}px</span>
            <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }}
              onClick={() => setDraft(p => ({ ...p, adminFontSize: 14 }))}>
              ↩ איפוס
            </button>
          </div>
          <div style={{ marginTop: 14, padding: "12px 16px", borderRadius: 8, background: "var(--surface2)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>תצוגה מקדימה:</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: draft.adminFontSize||14 }}>
              <button type="button" style={{ background: draft.adminAccentColor||"#f5a623", color: "#0a0c10", border: "none", borderRadius: 8, padding: "8px 18px", fontWeight: 800, cursor: "default", fontSize: "inherit" }}>כפתור לדוגמה</button>
              <span style={{ color: draft.adminAccentColor||"#f5a623", fontWeight: 800, fontSize: "inherit" }}>טקסט צבעוני</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><div className="card-title">🤖 עוזר AI לסטודנטים</div></div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 14 }}>
            הגבלת מספר השאלות שכל סטודנט יכול לשאול את עוזר ה-AI ביום אחד.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)" }}>הגבלת בקשות AI לסטודנט (ליום)</label>
            <input
              type="number"
              min={1}
              max={50}
              value={draft.aiMaxRequests ?? 5}
              onChange={e => setDraft(p => ({ ...p, aiMaxRequests: Number(e.target.value) }))}
              style={{ width: 80, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 14, textAlign: "center" }}
            />
          </div>
        </div>
      </div>

      <button className="btn btn-primary" disabled={saving} onClick={save} style={{ fontSize: 15, padding: "12px 32px" }}>
        {saving ? "⏳ שומר..." : "💾 שמור הגדרות"}
      </button>
    </div>
  );
}

// ─── DAMAGED EQUIPMENT PAGE ──────────────────────────────────────────────────
function DamagedEquipmentPage({ equipment, setEquipment, showToast, categories=[], collegeManager={}, managerToken="" }) {
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("הכל");
  const [editUnit, setEditUnit] = useState(null); // {eq, unit}
  const [editForm, setEditForm] = useState({ status:"פגום", fault:"", repair:"" });
  const [saving, setSaving] = useState(false);
  const [reportSending, setReportSending] = useState(false);

  const sendDamageReport = async () => {
    if(!editUnit||!collegeManager.email) return;
    setReportSending(true);
    try {
      await fetch("/api/send-email", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          to: collegeManager.email,
          type: "manager_report",
          student_name: "צוות המחסן",
          reservation_id: "ציוד",
          loan_type: "ציוד בדיקה",
          borrow_date: new Date().toLocaleDateString("he-IL"),
          return_date: "",
          items_list: `${editUnit.eq.name} — יחידה #${editUnit.unit.id?.split("_")[1]||"?"}`,
          report_note: `סטטוס: ${editForm.status}\nתקלה: ${editForm.fault||"—"}\nתיקון שבוצע: ${editForm.repair||"—"}`,
          calendar_url: managerToken ? `${window.location.origin}/manager-calendar?token=${managerToken}` : "",
        }),
      });
      alert("✅ הדיווח נשלח למנהל המכללה");
    } catch(e) { console.error(e); }
    setReportSending(false);
  };

  // Collect all non-תקין units
  const damagedItems = [];
  equipment.forEach(eq => {
    (eq.units||[]).forEach(u => {
      if (u.status !== "תקין") {
        damagedItems.push({ eq, unit: u });
      }
    });
  });

  const filtered = damagedItems.filter(({eq, unit}) => {
    const matchCat = catFilter==="הכל" || eq.category===catFilter;
    const matchSearch = !search || eq.name.includes(search) || unit.status.includes(search) || (unit.fault||"").includes(search);
    return matchCat && matchSearch;
  });

  const saveUnit = async () => {
    if(!editUnit) return;
    setSaving(true);
    const { eq, unit } = editUnit;
    const updatedUnits = eq.units.map(u => u.id===unit.id ? {...u, ...editForm} : u);
    const updatedEq = ensureUnits({...eq, units: updatedUnits});
    const updatedEquipment = equipment.map(e => e.id===eq.id ? updatedEq : e);
    const previousEquipment = equipment;
    setEquipment(updatedEquipment);
    const r = await storageSet("equipment", updatedEquipment);
    setSaving(false);
    if(r.ok) {
      if(editForm.status==="תקין") showToast("success", `✅ ${eq.name} #${unit.id.split("_")[1]} חזר לציוד פעיל`);
      else showToast("success","הסטטוס עודכן");
      setEditUnit(null);
    } else {
      setEquipment(previousEquipment);
      showToast("error","❌ שגיאה בשמירה");
    }
  };

  const STATUS_COLORS = { "פגום":"var(--red)","בתיקון":"var(--yellow)","נעלם":"#9b59b6" };
  const STATUS_ICONS  = { "פגום":"⚠️","בתיקון":"🔧","נעלם":"❓" };

  return (
    <div className="page">
      {/* Filters */}
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <div className="search-bar" style={{flex:1,minWidth:180}}><span>🔍</span>
          <input placeholder="חיפוש ציוד..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <span style={{fontSize:13,color:"var(--text3)"}}>סה״כ: <strong style={{color:"var(--red)"}}>{damagedItems.length}</strong> יחידות</span>
      </div>
      {/* Category filter */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
        {["הכל",...categories].map(c=>(
          <button key={c} type="button" onClick={()=>setCatFilter(c)}
            style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${catFilter===c?"var(--accent)":"var(--border)"}`,background:catFilter===c?"var(--accent-glow)":"transparent",color:catFilter===c?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
            {c==="הכל"?"📦 הכל":c}
          </button>
        ))}
      </div>

      {filtered.length===0
        ? <div className="empty-state"><div className="emoji">✅</div><p>{search||catFilter!=="הכל"?"לא נמצאו פריטים":"אין ציוד בדיקה — כל הציוד תקין!"}</p></div>
        : <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {filtered.map(({eq, unit},i)=>{
            const isImg = eq.image?.startsWith("data:")||eq.image?.startsWith("http");
            const unitNum = unit.id?.split("_")[1]||"?";
            return (
              <div key={unit.id} style={{background:"var(--surface)",border:`2px solid ${STATUS_COLORS[unit.status]||"var(--border)"}22`,borderRight:`4px solid ${STATUS_COLORS[unit.status]||"var(--border)"}`,borderRadius:"var(--r)",padding:"14px 16px",display:"flex",gap:12,alignItems:"flex-start"}}>
                <div style={{width:48,height:48,flexShrink:0,borderRadius:8,overflow:"hidden",background:"var(--surface2)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {isImg ? <img src={eq.image} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}}/> : <span style={{fontSize:28}}>{eq.image||"📦"}</span>}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
                    <span style={{fontWeight:800,fontSize:14}}>{eq.name}</span>
                    <span style={{fontSize:11,color:"var(--text3)"}}>יחידה #{unitNum}</span>
                    <span style={{fontSize:11,background:`${STATUS_COLORS[unit.status]||"var(--border)"}22`,border:`1px solid ${STATUS_COLORS[unit.status]||"var(--border)"}`,borderRadius:20,padding:"1px 8px",color:STATUS_COLORS[unit.status]||"var(--text3)",fontWeight:700}}>
                      {STATUS_ICONS[unit.status]||""} {unit.status}
                    </span>
                    <span style={{fontSize:11,color:"var(--text3)",marginRight:"auto"}}>{eq.category}</span>
                  </div>
                  {unit.fault&&<div style={{fontSize:12,color:"var(--text2)",marginBottom:2}}>⚠️ <strong>תקלה:</strong> {unit.fault}</div>}
                  {unit.repair&&<div style={{fontSize:12,color:"var(--green)"}}>🔧 <strong>תיקון:</strong> {unit.repair}</div>}
                </div>
                <button className="btn btn-secondary btn-sm" onClick={()=>{setEditUnit({eq,unit});setEditForm({status:unit.status,fault:unit.fault||"",repair:unit.repair||""});}}>✏️ עריכה</button>
              </div>
            );
          })}
        </div>
      }

      {/* Edit modal */}
      {editUnit&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}} onClick={e=>e.target===e.currentTarget&&setEditUnit(null)}>
          <div style={{width:"100%",maxWidth:500,background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",direction:"rtl"}}>
            <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",background:"var(--surface2)",borderRadius:"16px 16px 0 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontWeight:900,fontSize:16}}>✏️ עריכת יחידה — {editUnit.eq.name}</div>
                <div style={{fontSize:12,color:"var(--text3)"}}>יחידה #{editUnit.unit.id?.split("_")[1]}</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={()=>setEditUnit(null)}>✕</button>
            </div>
            <div style={{padding:"20px",display:"flex",flexDirection:"column",gap:14}}>
              <div className="form-group">
                <label className="form-label">סטטוס יחידה</label>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:6}}>
                  {["תקין","פגום","בתיקון","נעלם"].map(s=>{
                    const colors = {"תקין":"var(--green)","פגום":"var(--red)","בתיקון":"var(--yellow)","נעלם":"#9b59b6"};
                    const active = editForm.status===s;
                    return <button key={s} type="button" onClick={()=>setEditForm(p=>({...p,status:s}))}
                      style={{padding:"6px 14px",borderRadius:20,border:`2px solid ${active?colors[s]:"var(--border)"}`,background:active?`${colors[s]}22`:"transparent",color:active?colors[s]:"var(--text2)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                      {s}
                    </button>;
                  })}
                </div>
                {editForm.status==="תקין"&&<div style={{fontSize:12,color:"var(--green)",marginTop:6,fontWeight:700}}>✅ היחידה תחזור אוטומטית לציוד פעיל!</div>}
              </div>
              <div className="form-group">
                <label className="form-label">תיאור התקלה</label>
                <textarea className="form-textarea" rows={2} placeholder="תאר את התקלה שנמצאה..." value={editForm.fault} onChange={e=>setEditForm(p=>({...p,fault:e.target.value}))}/>
              </div>
              <div className="form-group">
                <label className="form-label">תיקונים שבוצעו</label>
                <textarea className="form-textarea" rows={2} placeholder="רשום אילו תיקונים בוצעו..." value={editForm.repair} onChange={e=>setEditForm(p=>({...p,repair:e.target.value}))}/>
              </div>
              {collegeManager.email&&(
                <div style={{background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:"10px",marginBottom:8}}>
                  <div style={{fontSize:12,fontWeight:700,color:"var(--text2)",marginBottom:6}}>📧 דיווח למנהל המכללה</div>
                  <div style={{fontSize:11,color:"var(--text3)",marginBottom:6}}>פרטי התקלה והתיקון ישלחו אוטומטית</div>
                  <button className="btn btn-secondary btn-sm" disabled={reportSending} onClick={sendDamageReport}>
                    {reportSending?"⏳ שולח...":"📧 שלח דיווח למנהל"}
                  </button>
                </div>
              )}
              <div style={{display:"flex",gap:8}}>
                <button className="btn btn-primary" disabled={saving} onClick={saveUnit}>{saving?"⏳ שומר...":"💾 שמור"}</button>
                <button className="btn btn-secondary" onClick={()=>setEditUnit(null)}>ביטול</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ADMIN PASSWORD SCREEN ────────────────────────────────────────────────────
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || "changeme";

function AdminLogin({ onSuccess }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  const attempt = () => {
    if (pw === ADMIN_PASSWORD) { onSuccess(); }
    else { setErr(true); setTimeout(()=>setErr(false), 2000); }
  };
  return (
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"40px 48px",width:360,textAlign:"center"}}>
        <div style={{fontSize:48,marginBottom:16}}>🔐</div>
        <div style={{fontSize:22,fontWeight:800,marginBottom:4}}>כניסת מנהל</div>
        <div style={{fontSize:13,color:"var(--text3)",marginBottom:28}}>מחסן השאלת ציוד קמרה אובסקורה וסאונד</div>
        <input
          className="form-input"
          type="password"
          placeholder="סיסמה"
          value={pw}
          onChange={e=>setPw(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&attempt()}
          style={{marginBottom:12,textAlign:"center",fontSize:18,letterSpacing:4}}
        />
        {err && <div style={{color:"var(--red)",fontSize:13,marginBottom:8}}>❌ סיסמה שגויה</div>}
        <button className="btn btn-primary" style={{width:"100%"}} onClick={attempt}>כניסה</button>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const isAdmin = window.location.pathname.startsWith("/admin");
  const isCalendarView = window.location.pathname.startsWith("/calendar");
  const isManagerCalendarView = window.location.pathname.startsWith("/manager-calendar");
  const isPublicFormView = !isAdmin && !isCalendarView && !isManagerCalendarView;
  const urlToken = new URLSearchParams(window.location.search).get("token")||"";
  const [page, setPage]               = useState("dashboard");
  const [equipment, _setEquipment]     = useState([]);
  const [reservations, _setReservations] = useState([]);
  const [categories, _setCategories]   = useState(DEFAULT_CATEGORIES);
  const [categoryTypes, _setCategoryTypes] = useState({});
  const [categoryLoanTypes, _setCategoryLoanTypes] = useState({});
  const [teamMembers, _setTeamMembers] = useState([]);
  const [deptHeads, _setDeptHeads]       = useState([]);
  const [collegeManager, _setCollegeManager] = useState({ name:"", email:"" });
  const [calendarToken, setCalendarToken] = useState("");
  const [managerToken, setManagerToken]   = useState("");
  const [kits, _setKits]               = useState([]);
  const [policies, _setPolicies]       = useState({ פרטית:"", הפקה:"", סאונד:"" });
  const [certifications, _setCertifications] = useState({ types:[], students:[] });
  const [siteSettings, _setSiteSettings] = useState({ logo:"", soundLogo:"", theme:"dark", accentColor:"#f5a623", adminAccentColor:"#f5a623", adminFontSize:14, aiMaxRequests:5, studioFutureHoursLimit:16 });
  const [studios, _setStudios] = useState([]);
  const [studioBookings, _setStudioBookings] = useState([]);
  const [lessons, _setLessons] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [toasts, setToasts]           = useState([]);
  const [authed, setAuthed]           = useState(false);
  const [undoStack, setUndoStack]     = useState([]);
  // Reservations filter state (in AdminApp so topbar can render them)
  const [resSearch, setResSearch]       = useState("");
  const [resStatusF, setResStatusF]     = useState("הכל");
  const [resLoanTypeF, setResLoanTypeF] = useState("הכל");
  const [resSortBy, setResSortBy]       = useState("received");
  const [reservationsInitialSubView, setReservationsInitialSubView] = useState("active");

  const equipmentRef = useRef(equipment);
  const reservationsRef = useRef(reservations);
  const categoriesRef = useRef(categories);
  const categoryTypesRef = useRef(categoryTypes);
  const categoryLoanTypesRef = useRef(categoryLoanTypes);
  const teamMembersRef = useRef(teamMembers);
  const deptHeadsRef = useRef(deptHeads);
  const collegeManagerRef = useRef(collegeManager);
  const kitsRef = useRef(kits);
  const policiesRef = useRef(policies);
  const certificationsRef = useRef(certifications);
  const siteSettingsRef = useRef(siteSettings);
  const historySuspendedRef = useRef(true);
  const historyQueuedRef = useRef(false);
  const undoInFlightRef = useRef(false);
  const swipeTouchRef = useRef(null);

  equipmentRef.current = equipment;
  reservationsRef.current = reservations;
  categoriesRef.current = categories;
  categoryTypesRef.current = categoryTypes;
  categoryLoanTypesRef.current = categoryLoanTypes;
  teamMembersRef.current = teamMembers;
  deptHeadsRef.current = deptHeads;
  collegeManagerRef.current = collegeManager;
  kitsRef.current = kits;
  policiesRef.current = policies;
  certificationsRef.current = certifications;
  siteSettingsRef.current = siteSettings;

  const applyPublicLiveSync = (key, value) => {
    if (key === "equipment" && Array.isArray(value)) {
      const normalizedEquipment = normalizeEquipmentTagFlags(value).map(ensureUnits);
      if (!dataEquals(equipmentRef.current, normalizedEquipment)) {
        _setEquipment(normalizedEquipment);
      }
      return;
    }

    if (key === "reservations" && Array.isArray(value)) {
      const normalizedReservations = normalizeReservationsForArchive(value);
      if (!dataEquals(reservationsRef.current, normalizedReservations)) {
        _setReservations(normalizedReservations);
      }
      return;
    }

    if (key === "categories" && Array.isArray(value) && !dataEquals(categoriesRef.current, value)) {
      _setCategories(value);
      return;
    }

    if (key === "categoryLoanTypes" && value && typeof value === "object" && !Array.isArray(value) && !dataEquals(categoryLoanTypesRef.current, value)) {
      _setCategoryLoanTypes(value);
    }
  };

  const refreshPublicInventory = async () => {
    try {
      const [eqR, resR, catsR, catLoanTypesR] = await Promise.all([
        storageGet("equipment"),
        storageGet("reservations"),
        storageGet("categories"),
        storageGet("categoryLoanTypes"),
      ]);

      applyPublicLiveSync("equipment", eqR?.value);
      applyPublicLiveSync("reservations", resR?.value);
      applyPublicLiveSync("categories", catsR?.value);
      applyPublicLiveSync("categoryLoanTypes", catLoanTypesR?.value);

      return {
        equipment: Array.isArray(eqR?.value)
          ? normalizeEquipmentTagFlags(eqR.value).map(ensureUnits)
          : equipmentRef.current,
        reservations: Array.isArray(resR?.value)
          ? normalizeReservationsForArchive(resR.value)
          : reservationsRef.current,
        categories: Array.isArray(catsR?.value) ? catsR.value : categoriesRef.current,
        categoryLoanTypes: catLoanTypesR?.value && typeof catLoanTypesR.value === "object" && !Array.isArray(catLoanTypesR.value)
          ? catLoanTypesR.value
          : categoryLoanTypesRef.current,
      };
    } catch (error) {
      console.warn("public inventory sync failed", error);
      return {
        equipment: equipmentRef.current,
        reservations: reservationsRef.current,
        categories: categoriesRef.current,
        categoryLoanTypes: categoryLoanTypesRef.current,
      };
    }
  };

  const getUndoSnapshot = () => ({
    equipment: safeClone(equipmentRef.current),
    reservations: safeClone(reservationsRef.current),
    categories: safeClone(categoriesRef.current),
    categoryTypes: safeClone(categoryTypesRef.current),
    categoryLoanTypes: safeClone(categoryLoanTypesRef.current),
    teamMembers: safeClone(teamMembersRef.current),
    deptHeads: safeClone(deptHeadsRef.current),
    collegeManager: safeClone(collegeManagerRef.current),
    kits: safeClone(kitsRef.current),
    policies: safeClone(policiesRef.current),
    certifications: safeClone(certificationsRef.current),
    siteSettings: safeClone(siteSettingsRef.current),
  });

  const persistUndoSnapshot = async (snapshot) => {
    const results = await Promise.all([
      storageSet("equipment", snapshot.equipment),
      storageSet("reservations", snapshot.reservations),
      storageSet("categories", snapshot.categories),
      storageSet("categoryTypes", snapshot.categoryTypes),
      storageSet("categoryLoanTypes", snapshot.categoryLoanTypes),
      storageSet("teamMembers", snapshot.teamMembers),
      storageSet("deptHeads", snapshot.deptHeads),
      storageSet("collegeManager", snapshot.collegeManager),
      storageSet("kits", snapshot.kits),
      storageSet("policies", snapshot.policies),
      storageSet("certifications", snapshot.certifications),
      storageSet("siteSettings", snapshot.siteSettings),
    ]);
    return results.every((result) => result?.ok);
  };

  const queueUndoSnapshot = () => {
    if (historySuspendedRef.current || undoInFlightRef.current || historyQueuedRef.current) return;
    historyQueuedRef.current = true;
    const snapshot = getUndoSnapshot();
    setUndoStack((prev) => {
      const last = prev[prev.length - 1];
      if (last && dataEquals(last.snapshot, snapshot)) return prev;
      return [...prev, { id: Date.now(), snapshot }].slice(-10);
    });
    window.setTimeout(() => {
      historyQueuedRef.current = false;
    }, 0);
  };

  const createTrackedSetter = (rawSetter) => (nextValue) => {
    rawSetter((prev) => {
      const resolved = typeof nextValue === "function" ? nextValue(prev) : nextValue;
      if (!dataEquals(prev, resolved)) queueUndoSnapshot();
      return resolved;
    });
  };

  const setEquipment = createTrackedSetter(_setEquipment);
  const setReservations = createTrackedSetter(_setReservations);
  const setCategories = createTrackedSetter(_setCategories);
  const setCategoryTypes = createTrackedSetter(_setCategoryTypes);
  const setCategoryLoanTypes = createTrackedSetter(_setCategoryLoanTypes);
  const setTeamMembers = createTrackedSetter(_setTeamMembers);
  const setDeptHeads = createTrackedSetter(_setDeptHeads);
  const setCollegeManager = createTrackedSetter(_setCollegeManager);
  const setKits = createTrackedSetter(_setKits);
  const setPolicies = createTrackedSetter(_setPolicies);
  const setCertifications = createTrackedSetter(_setCertifications);
  const setSiteSettings = createTrackedSetter(_setSiteSettings);

  const showToast = (type, msg) => {
    const id = Date.now();
    setToasts(p=>[...p,{id,type,msg}]);
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)), 3500);
  };

  const handleUndo = async () => {
    const lastEntry = undoStack[undoStack.length - 1];
    if (!lastEntry || undoInFlightRef.current) return;
    undoInFlightRef.current = true;
    historySuspendedRef.current = true;
    try {
      const snapshot = lastEntry.snapshot;
      _setEquipment(snapshot.equipment);
      _setReservations(snapshot.reservations);
      _setCategories(snapshot.categories);
      _setCategoryTypes(snapshot.categoryTypes || {});
      _setCategoryLoanTypes(snapshot.categoryLoanTypes || {});
      _setTeamMembers(snapshot.teamMembers);
      _setDeptHeads(snapshot.deptHeads);
      _setCollegeManager(snapshot.collegeManager);
      _setKits(snapshot.kits);
      _setPolicies(snapshot.policies);
      _setCertifications(snapshot.certifications);
      _setSiteSettings(snapshot.siteSettings);
      const ok = await persistUndoSnapshot(snapshot);
      setUndoStack((prev) => prev.slice(0, -1));
      showToast(ok ? "success" : "error", ok ? "הפעולה האחרונה בוטלה" : "הפעולה בוטלה מקומית, אך חלק מהשמירות נכשלו");
    } catch (error) {
      console.error("undo error", error);
      showToast("error", "שגיאה בביטול הפעולה האחרונה");
    } finally {
      window.setTimeout(() => {
        historySuspendedRef.current = false;
        undoInFlightRef.current = false;
      }, 0);
    }
  };

  useEffect(()=>{
    (async()=>{
        try {
          historySuspendedRef.current = true;
          const [eqR, resR, catsR, catTypesR, catLoanTypesR, tmR, ktsR, polR, certsR, dhsR, calTokR, mgrR, mgrTokR, siteSetR, studiosR, studioBkR, lessonsR] = await Promise.all([
            storageGet("equipment"),
          storageGet("reservations"),
          storageGet("categories"),
          storageGet("categoryTypes"),
          storageGet("categoryLoanTypes"),
          storageGet("teamMembers"),
          storageGet("kits"),
          storageGet("policies"),
          storageGet("certifications"),
          storageGet("deptHeads"),
          storageGet("calendarToken"),
          storageGet("collegeManager"),
          storageGet("managerToken"),
          storageGet("siteSettings"),
          storageGet("studios"),
          storageGet("studio_bookings"),
          storageGet("lessons"),
          ]);
          // Extract values and sources
          const eq = eqR.value, eqSrc = eqR.source;
          const res = resR.value, resSrc = resR.source;
          const cats = catsR.value, catsSrc = catsR.source;
          const catTypes = catTypesR.value;
          const catLoanTypes = catLoanTypesR.value;
          const tm = tmR.value, tmSrc = tmR.source;
          const kts = ktsR.value, ktsSrc = ktsR.source;
          const pol = polR.value, polSrc = polR.source;
          const certs = certsR.value, certsSrc = certsR.source;
          const dhs = dhsR.value, dhsSrc = dhsR.source;
          const calTok = calTokR.value, calTokSrc = calTokR.source;
          const mgr = mgrR.value, mgrSrc = mgrR.source;
          const mgrTok = mgrTokR.value, mgrTokSrc = mgrTokR.source;
          const siteSet = siteSetR.value;
          const stds = studiosR.value;
          const stdBk = studioBkR.value;

          const rawEquipment = normalizeEquipmentTagFlags(eq || INITIAL_EQUIPMENT);
          const normalizedEquipment = rawEquipment.map(ensureUnits);
          const equipmentChanged = eq && JSON.stringify(normalizedEquipment) !== JSON.stringify(eq);
          const normalizedReservations = normalizeReservationsForArchive(res || []);
          const reservationsChanged = res && JSON.stringify(normalizedReservations) !== JSON.stringify(res);
          _setEquipment(normalizedEquipment);
          _setReservations(normalizedReservations);
          _setCategories(cats || DEFAULT_CATEGORIES);
          _setCategoryTypes(catTypes || {});
          _setCategoryLoanTypes(catLoanTypes || {});
        _setTeamMembers(tm || []);
        _setKits(kts || []);
        _setPolicies(pol || { פרטית:"", הפקה:"", סאונד:"" });
        _setCertifications(certs || { types:[], students:[] });
        _setDeptHeads(Array.isArray(dhs) ? dhs : []);
          setCalendarToken(calTok || "");
        _setCollegeManager(mgr || { name:"", email:"" });
          setManagerToken(mgrTok || "");
        _setStudios(Array.isArray(stds) ? stds : []);
        _setStudioBookings(Array.isArray(stdBk) ? stdBk : []);
        const lsns = lessonsR.value;
        _setLessons(Array.isArray(lsns) ? lsns : []);
          const loadedSettings = siteSet || { logo:"", theme:"dark" };
        _setSiteSettings(loadedSettings);
        if(loadedSettings.theme==="light") document.documentElement.setAttribute("data-theme","light");

        // ─── SAFE INIT: only write defaults when DB confirmed the key doesn't exist ───
        // "supabase_empty" = DB responded OK but row missing → safe to initialize
        // "cache" = network failed, fell back to localStorage → NEVER overwrite DB
        if(!eq && eqSrc === "supabase_empty") await storageSet("equipment", normalizedEquipment);
        if(!res && resSrc === "supabase_empty")  await storageSet("reservations", []);
        if(!cats && catsSrc === "supabase_empty") await storageSet("categories",   DEFAULT_CATEGORIES);
        if(!tm && tmSrc === "supabase_empty")   await storageSet("teamMembers",  []);
        if(!kts && ktsSrc === "supabase_empty")  await storageSet("kits",         []);
        if(!pol && polSrc === "supabase_empty")   await storageSet("policies",        { פרטית:"", הפקה:"", סאונד:"" });
        if(!certs && certsSrc === "supabase_empty") await storageSet("certifications", { types:[], students:[] });
        if(!dhs && dhsSrc === "supabase_empty")     await storageSet("deptHeads",       []);
        if(!calTok && calTokSrc === "supabase_empty") {
          const tok = Math.random().toString(36).slice(2,10)+Math.random().toString(36).slice(2,10);
          await storageSet("calendarToken", tok);
          setCalendarToken(tok);
        }
        if(!mgrTok && mgrTokSrc === "supabase_empty") {
          const tok = "mgr_"+Math.random().toString(36).slice(2,10)+Math.random().toString(36).slice(2,10);
          await storageSet("managerToken", tok);
          setManagerToken(tok);
        }
        if(!mgr && mgrSrc === "supabase_empty") await storageSet("collegeManager", { name:"", email:"" });
        // Safe: only write back normalized data if we actually got data from DB
        if(equipmentChanged) await storageSet("equipment", normalizedEquipment);
        if(reservationsChanged) await storageSet("reservations", normalizedReservations);
        // Warn if network failed and no cache
        if(eqSrc === "cache" && !eq) showToast("error", "⚠️ לא ניתן לטעון ציוד — בדוק חיבור");
      } catch(e) {
        showToast("error", "❌ שגיאת רשת — לא ניתן לטעון נתונים");
        console.error("load error", e);
      } finally {
        historySuspendedRef.current = false;
      }
      setLoading(false);
    })();
  },[]);

  useEffect(() => {
    if (loading || !isPublicFormView) return undefined;

    const handleFocus = () => {
      void refreshPublicInventory();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshPublicInventory();
      }
    };

    const handleStorage = (event) => {
      if (event.storageArea !== window.localStorage || !event.key?.startsWith("cache_")) return;
      const key = event.key.replace(/^cache_/, "");
      if (!["equipment", "reservations", "categories", "categoryLoanTypes"].includes(key)) return;
      try {
        const parsedValue = event.newValue ? JSON.parse(event.newValue) : null;
        applyPublicLiveSync(key, parsedValue);
      } catch (error) {
        console.warn("public inventory cache sync failed", error);
        void refreshPublicInventory();
      }
    };

    void refreshPublicInventory();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refreshPublicInventory();
    }, 10000);

    window.addEventListener("focus", handleFocus);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loading, isPublicFormView]);

  useEffect(() => {
    if (loading) return;

    const { reservations: generatedLessonReservations, linkedKitIds } = buildLessonReservations(lessons, kits);
    const nextReservations = normalizeReservationsForArchive([
      ...reservations.filter((reservation) => {
        if (reservation.lesson_auto || hasLinkedValue(reservation.lesson_id)) return false;
        if (hasLinkedValue(reservation.lesson_kit_id) && linkedKitIds.has(String(reservation.lesson_kit_id))) return false;
        return true;
      }),
      ...generatedLessonReservations,
    ]);

    if (!dataEquals(nextReservations, reservations)) {
      _setReservations(nextReservations);
      void storageSet("reservations", nextReservations);
    }

    const generatedLessonBookings = buildLessonStudioBookings(lessons);
    const nextStudioBookings = [
      ...studioBookings.filter((booking) => !(booking.lesson_auto || hasLinkedValue(booking.lesson_id))),
      ...generatedLessonBookings,
    ];

    if (!dataEquals(nextStudioBookings, studioBookings)) {
      _setStudioBookings(nextStudioBookings);
      void storageSet("studio_bookings", nextStudioBookings);
    }
  }, [loading, lessons, kits, reservations, studioBookings]);

  useEffect(() => {
    if (loading) return undefined;
    const syncArchivedReservations = () => {
      _setReservations((currentReservations) => {
        const normalizedReservations = normalizeReservationsForArchive(currentReservations);
        if (JSON.stringify(normalizedReservations) === JSON.stringify(currentReservations)) {
          return currentReservations;
        }
        void storageSet("reservations", normalizedReservations);
        return normalizedReservations;
      });
    };
    const timerId = window.setInterval(syncArchivedReservations, 60000);
    return () => window.clearInterval(timerId);
  }, [loading]);

  // ── Auto-send overdue email 30 minutes after return time ──
  useEffect(() => {
    if (loading) return;
    const checkOverdueEmails = async () => {
      const now = Date.now();
      const THIRTY_MIN = 30 * 60 * 1000;
      const toSend = reservations.filter(r =>
        r.status === "באיחור" &&
        !r.overdue_email_sent &&
        r.email &&
        r.loan_type !== "שיעור"
      ).filter(r => {
        const returnAt = getReservationReturnTimestamp(r);
        return returnAt && (now - returnAt) >= THIRTY_MIN;
      });
      if (!toSend.length) return;
      for (const r of toSend) {
        try {
          await fetch("/api/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: r.email,
              type: "overdue",
              student_name: r.student_name,
              borrow_date: formatDate(r.borrow_date),
              return_date: formatDate(r.return_date),
              return_time: r.return_time || "",
            }),
          });
        } catch (e) { console.error("overdue email error", e); }
      }
      // Mark as sent
      const sentIds = new Set(toSend.map(r => r.id));
      const updated = reservations.map(r => sentIds.has(r.id) ? { ...r, overdue_email_sent: true } : r);
      _setReservations(updated);
      await storageSet("reservations", updated);
    };
    const t = setTimeout(checkOverdueEmails, 90000); // first check after 90s
    const i = setInterval(checkOverdueEmails, 5 * 60 * 1000); // then every 5 min
    return () => { clearTimeout(t); clearInterval(i); };
  }, [loading, reservations]);

  const pending = reservations.filter(r=>r.status==="ממתין").length;
  const damagedCount = equipment.reduce((sum, eq) =>
    sum + (Array.isArray(eq.units) ? eq.units.filter(u=>u.status!=="תקין").length : 0), 0);
  const deptHeadPending = reservations.filter(r=>r.status==="אישור ראש מחלקה").length;
  const overdueCount = reservations.filter(r=>r.status==="באיחור").length;
  const rejectedCount = reservations.filter(r=>r.status==="נדחה").length;
  const rejected = rejectedCount + overdueCount;
  const pageTitle = { dashboard:"לוח בקרה", equipment:"ציוד מחסן", reservations:"ניהול בקשות", team:"פרטי צוות", kits:"ערכות", lessons:"שיעורים", policies:"נהלים", certifications:"הסמכות", students:"ניהול סטודנטים", settings:"הגדרות", studios:"לוח אולפנים" };

  const handleSwipeTouchStart = (e) => {
    swipeTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const handleSwipeTouchEnd = (e) => {
    if (!swipeTouchRef.current) return;
    const dx = e.changedTouches[0].clientX - swipeTouchRef.current.x;
    const dy = e.changedTouches[0].clientY - swipeTouchRef.current.y;
    swipeTouchRef.current = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    const idx = ADMIN_NAV_PAGES.indexOf(page);
    if (idx === -1) return;
    if (dx < 0 && idx < ADMIN_NAV_PAGES.length - 1) setPage(ADMIN_NAV_PAGES[idx + 1]);
    else if (dx > 0 && idx > 0) setPage(ADMIN_NAV_PAGES[idx - 1]);
  };

  return (
    <>
      <style>{css}</style>

      {/* ── טופס ציבורי ── */}
      {isManagerCalendarView ? (
        <div style={{minHeight:"100vh",background:"var(--bg)",direction:"rtl"}}>
          {loading ? <Loading/> : (
            managerToken && urlToken === managerToken
              ? <ManagerCalendarPage reservations={reservations} setReservations={setReservations} collegeManager={collegeManager} equipment={equipment} kits={kits} siteSettings={siteSettings}/>
              : <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",flexDirection:"column",gap:16,color:"var(--text2)"}}>
                  <div style={{fontSize:48}}>🔒</div>
                  <div style={{fontSize:18,fontWeight:700}}>קישור לא תקין</div>
                  <div style={{fontSize:13}}>הקישור שבידך אינו תקין או פג תוקפו</div>
                </div>
          )}
        </div>
      ) : isCalendarView ? (
        <div style={{minHeight:"100vh",background:"var(--bg)",direction:"rtl"}}>
          {loading ? <Loading/> : (
            calendarToken && urlToken === calendarToken
              ? <DeptHeadCalendarPage reservations={reservations} calendarToken={calendarToken} kits={kits} equipment={equipment} siteSettings={siteSettings}/>
              : <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",flexDirection:"column",gap:16,color:"var(--text2)"}}>
                  <div style={{fontSize:48}}>🔒</div>
                  <div style={{fontSize:18,fontWeight:700}}>קישור לא תקין</div>
                  <div style={{fontSize:13}}>הקישור שבידך אינו תקין או פג תוקפו</div>
                </div>
          )}
        </div>
      ) : !isAdmin && (
        <div className="public-page-shell">
          {loading ? <Loading/> : <PublicForm equipment={equipment} reservations={reservations} setReservations={setReservations} showToast={showToast} categories={categories} kits={kits} teamMembers={teamMembers} policies={policies} certifications={certifications} deptHeads={deptHeads} calendarToken={calendarToken} siteSettings={siteSettings} categoryLoanTypes={categoryLoanTypes} refreshInventory={refreshPublicInventory}/>}
        </div>
      )}

      {/* ── לוח ניהול עם סיסמה ── */}
      {isAdmin && !authed && <AdminLogin onSuccess={()=>setAuthed(true)}/>}

      {isAdmin && authed && (
        <div className="app" style={{"--accent":siteSettings.adminAccentColor||"#f5a623","--accent-glow":`${siteSettings.adminAccentColor||"#f5a623"}2e`,"--admin-fs":`${siteSettings.adminFontSize||14}px`}}>
          <nav className="sidebar">
            <div className="sidebar-logo">
              {siteSettings.logo
                ? <img src={siteSettings.logo} alt="לוגו" style={{width:90,height:90,objectFit:"contain",borderRadius:8}}/>
                : <span className="logo-icon">🎬</span>}
              {siteSettings.soundLogo && (
                <img src={siteSettings.soundLogo} alt="לוגו סאונד" style={{width:90,height:90,objectFit:"contain",borderRadius:8,marginTop:2,display:"block"}}/>
              )}
              <div className="app-name">מחסן השאלת ציוד<br/>קמרה אובסקורה וסאונד</div>
              <div className="app-sub">💾 נתונים נשמרים תמיד</div>
            </div>
            <div className="nav">
              <div className="nav-section">ניהול</div>
              {[
                {id:"studios",icon:"🎙️",label:"אולפנים"},
                {id:"reservations",icon:"📋",label:"בקשות",badge:(pending||0)+(rejected||0)||null},
                {id:"equipment",icon:"📦",label:"ציוד מחסן",badge:damagedCount||null},
                {id:"students",icon:"👨‍🎓",label:"סטודנטים"},
                {id:"certifications",icon:"🎓",label:"הסמכות"},
                {id:"lessons",icon:"📽️",label:"שיעורים",badge:lessons.length||null},
                {id:"kits",icon:"🎒",label:"ערכות"},
                {id:"team",icon:"👥",label:"צוות"},
                {id:"policies",icon:"📋",label:"נהלים"},
                {id:"settings",icon:"⚙️",label:"הגדרות"},
              ].map(n=>(
                <div key={n.id} className={`nav-item ${page===n.id?"active":""}`}
                  onClick={() => {
                    if (n.id === "reservations") setReservationsInitialSubView("active");
                    setPage(p=>p===n.id?"dashboard":n.id);
                  }} title={n.label}>
                  <span className="icon">{n.icon}</span>
                  <span className="nav-label">{n.label}</span>
                  {n.badge&&<span style={{background:"var(--accent)",color:"#000",borderRadius:"50%",width:16,height:16,fontSize:10,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",position:"absolute",top:4,left:"50%",transform:"translateX(-50%) translateX(10px)"}}>{n.badge}</span>}
                </div>
              ))}
            </div>
            <div style={{padding:"10px 20px",borderTop:"1px solid var(--border)",display:"flex",justifyContent:"flex-end"}}>
              <button className="btn btn-secondary btn-sm" onClick={()=>setAuthed(false)}>🚪 יציאה</button>
            </div>
          </nav>
          <div className="main" onTouchStart={handleSwipeTouchStart} onTouchEnd={handleSwipeTouchEnd}>
            <div className="topbar" style={{flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8,width:"100%"}}>
                <span className="topbar-title" style={{flex:1}}>{pageTitle[page]}</span>
                {pending>0&&<div style={{background:"rgba(241,196,15,0.12)",border:"1px solid rgba(241,196,15,0.3)",borderRadius:8,padding:"5px 10px",fontSize:12,color:"var(--yellow)",flexShrink:0}}>⏳ {pending}</div>}
                {deptHeadPending>0&&<div style={{background:"rgba(155,89,182,0.12)",border:"1px solid rgba(155,89,182,0.3)",borderRadius:8,padding:"5px 10px",fontSize:12,color:"var(--purple)",flexShrink:0}}>🟣 {deptHeadPending}</div>}
                {overdueCount>0&&<div style={{background:"rgba(230,126,34,0.15)",border:"1px solid rgba(230,126,34,0.4)",borderRadius:8,padding:"5px 10px",fontSize:12,color:"#e67e22",flexShrink:0,cursor:"pointer"}} onClick={()=>{setReservationsInitialSubView("rejected");setPage("reservations");}}>⚠️ {overdueCount} באיחור</div>}
                {rejectedCount>0&&<div style={{background:"rgba(231,76,60,0.12)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:8,padding:"5px 10px",fontSize:12,color:"var(--red)",flexShrink:0}}>❌ {rejectedCount}</div>}
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleUndo}
                  disabled={!undoStack.length || undoInFlightRef.current}
                  style={{
                    flexShrink:0,
                    borderColor: undoStack.length ? "rgba(46,204,113,0.45)" : "var(--border)",
                    color: undoStack.length ? "#d9ffe6" : "var(--text3)",
                    background: undoStack.length ? "rgba(46,204,113,0.12)" : "transparent",
                    opacity: undoInFlightRef.current ? 0.7 : 1
                  }}
                  title={undoStack.length ? `אפשר לבטל ${undoStack.length} פעולות אחרונות` : "אין פעולות לביטול"}
                >
                  ↩ בטל פעולה{undoStack.length ? ` (${undoStack.length})` : ""}
                </button>
              </div>
              {page==="reservations" && (
                <div style={{display:"flex",gap:6,width:"100%",flexWrap:"wrap",alignItems:"center"}}>
                  <div className="search-bar" style={{flex:"1 1 130px",minWidth:120}}><span>🔍</span><input placeholder="חיפוש..." value={resSearch} onChange={e=>setResSearch(e.target.value)}/></div>
                  <select
                    className="form-select"
                    style={{flex:"1 1 100px",minWidth:95,fontSize:12,padding:"6px 8px"}}
                    value={["הכל","ממתין","אישור ראש מחלקה","מאושר"].includes(resStatusF) ? resStatusF : "הכל"}
                    onChange={e=>setResStatusF(e.target.value)}
                  >
                    <option value="הכל">כל הסטטוסים</option>
                    {["ממתין","אישור ראש מחלקה","מאושר"].map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                  <select className="form-select" style={{flex:"1 1 90px",minWidth:85,fontSize:12,padding:"6px 8px"}} value={resLoanTypeF} onChange={e=>setResLoanTypeF(e.target.value)}>
                    <option value="הכל">כל הסוגים</option>
                    {["פרטית","הפקה","סאונד","קולנוע יומית","שיעור"].map(t=><option key={t} value={t}>{t==="שיעור"?"השאלת שיעור":t==="קולנוע יומית"?"קולנוע יומית":t}</option>)}
                  </select>
                  <select className="form-select" style={{flex:"1 1 110px",minWidth:100,fontSize:12,padding:"6px 8px"}} value={resSortBy} onChange={e=>setResSortBy(e.target.value)}>
                    <option value="received">🕐 קבלה</option>
                    <option value="urgency">🔥 דחיפות</option>
                  </select>
                </div>
              )}
            </div>
            {loading ? <Loading/> : <>
              {page==="dashboard"   && <DashboardPage    equipment={equipment} reservations={reservations} setReservations={setReservations} showToast={showToast}/>}
              {page==="equipment"   && <EquipmentPage    equipment={equipment} reservations={reservations} setEquipment={setEquipment} showToast={showToast} categories={categories} setCategories={setCategories} categoryTypes={categoryTypes} setCategoryTypes={setCategoryTypes} categoryLoanTypes={categoryLoanTypes} setCategoryLoanTypes={setCategoryLoanTypes} certifications={certifications} studios={studios} collegeManager={collegeManager} managerToken={managerToken}/>}
              {page==="reservations"&& <ReservationsPage reservations={reservations} setReservations={setReservations} equipment={equipment} showToast={showToast}
                search={resSearch} setSearch={setResSearch} statusF={resStatusF} setStatusF={setResStatusF}
                loanTypeF={resLoanTypeF} setLoanTypeF={setResLoanTypeF} sortBy={resSortBy} setSortBy={setResSortBy} collegeManager={collegeManager} managerToken={managerToken}
                initialSubView={reservationsInitialSubView} categories={categories} certifications={certifications} kits={kits} teamMembers={teamMembers} deptHeads={deptHeads} calendarToken={calendarToken} siteSettings={siteSettings}/>}
              {page==="team"        && <TeamPage         teamMembers={teamMembers} setTeamMembers={setTeamMembers} deptHeads={deptHeads} setDeptHeads={setDeptHeads} calendarToken={calendarToken} collegeManager={collegeManager} setCollegeManager={setCollegeManager} showToast={showToast} managerToken={managerToken}/>}
              {page==="kits"        && <KitsPage         kits={kits} setKits={setKits} equipment={equipment} categories={categories} showToast={showToast} reservations={reservations} setReservations={setReservations} lessons={lessons}/>}
              {page==="lessons"     && <LessonsPage      lessons={lessons} setLessons={_setLessons} studios={studios} kits={kits} showToast={showToast} reservations={reservations} setReservations={setReservations} equipment={equipment} trackOptions={Array.isArray(certifications?.trackSettings) && certifications.trackSettings.length
                ? certifications.trackSettings.map(setting => String(setting?.name || "").trim()).filter(Boolean)
                : [...new Set((certifications?.students || []).map(student => String(student?.track || "").trim()).filter(Boolean))]}/>}
              {page==="policies"    && <PoliciesPage     policies={policies} setPolicies={setPolicies} showToast={showToast}/>}
              {page==="certifications" && <CertificationsPage certifications={certifications} setCertifications={setCertifications} showToast={showToast} studios={studios} setStudios={_setStudios} equipment={equipment} setEquipment={setEquipment}/>}
              {page==="students"       && <StudentsPage certifications={certifications} setCertifications={setCertifications} showToast={showToast}/>}

              {page==="settings"     && <SettingsPage siteSettings={siteSettings} setSiteSettings={setSiteSettings} showToast={showToast}/>}
              {page==="studios"      && <StudioBookingPage showToast={showToast} teamMembers={teamMembers} certifications={certifications} role="admin" studios={studios} setStudios={_setStudios} bookings={studioBookings} setBookings={_setStudioBookings} siteSettings={siteSettings} setSiteSettings={setSiteSettings}/>}
            </>}
          </div>
        </div>
      )}

      <Toast toasts={toasts}/>
    </>
  );
}
