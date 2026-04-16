import { useState, useEffect, useMemo, useRef } from "react";
import { logActivity, cloudinaryThumb, getEffectiveStatus, updateReservationStatus, createLessonReservations } from "./utils.js";
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
import { LecturersPage, makeLecturer } from "./components/LecturersPage.jsx";
import SmartEquipmentImportButton from "./components/SmartEquipmentImportButton.jsx";
import { SecretaryDashboardPage } from "./components/SecretaryDashboardPage.jsx";
import { PublicDisplayPage } from "./components/PublicDisplayPage.jsx";
import { PublicDailyTablePage } from "./components/PublicDailyTablePage.jsx";
import { StaffHub } from "./components/StaffHub.jsx";
import { StaffManagementPage } from "./components/StaffManagementPage.jsx";
import { SystemSettingsPage } from "./components/SystemSettingsPage.jsx";
import { ActivityLogsPage } from "./components/ActivityLogsPage.jsx";
import { StaffSchedulePage } from "./components/StaffSchedulePage.jsx";
import { LecturerPortal } from "./components/LecturerPortal.jsx";
import { useInstallPrompt } from "./components/InstallPrompt.jsx";
import { supabase } from "./supabaseClient.js";

// ─── SUPABASE AUTH: strip PKCE / magic-link params early ─────────────────────
// supabase-js auto-detects ?code= (PKCE) and #access_token= (implicit) on
// createClient, but the URL params can linger on slow loads. We call getSession
// at module level to guarantee the exchange runs before React renders, then
// clean the URL so a browser refresh doesn't replay a spent code.
supabase.auth.getSession().then(() => {
  const url = new URL(window.location.href);
  let dirty = false;
  for (const p of ["code", "error", "error_code", "error_description", "reset"]) {
    if (url.searchParams.has(p)) { url.searchParams.delete(p); dirty = true; }
  }
  if (window.location.hash.includes("access_token")) {
    url.hash = "";
    dirty = true;
  }
  if (dirty) window.history.replaceState(null, "", url.pathname + url.search + url.hash);
});

// ─── SUPABASE STORAGE ─────────────────────────────────────────────────────────
const SB_URL = import.meta.env.VITE_SUPABASE_URL;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
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
async function storageGet(key, signal) {
  try {
    const res  = await fetch(`${SB_URL}/rest/v1/store?key=eq.${key}&select=data`, { headers: SB_HEADERS, signal });
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
    if (e.name === "AbortError") return { value: null, source: "aborted" };
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
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), 4000);
    await fetch(`${SB_URL}/rest/v1/store?key=eq.equipment&select=key`, { headers: SB_HEADERS, signal: ac.signal });
    clearTimeout(tid);
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
        await fetch("/api/store", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: `backup_${key}`, data: old }),
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
    const res = await fetch("/api/store", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ key, data: value }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("storageSet error", key, err);
      restoreCacheValue(key, previousCachedValue);
      return { ok: false, error: err };
    }
    mirrorReservationsIfNeeded(key, value);
    mirrorEquipmentIfNeeded(key, value);
    return { ok: true };
  } catch(e) {
    console.error("storageSet network error", key, e);
    restoreCacheValue(key, previousCachedValue);
    return { ok: false, error: e.message };
  }
}

// Dual-write mirrors — fire-and-forget, failures are logged, never block the
// primary write. See migrations 004 (reservations) and 005 (equipment).
function mirrorReservationsIfNeeded(key, value) {
  if (key !== "reservations" || !Array.isArray(value)) return;
  fetch("/api/sync-reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reservations: value }),
  }).catch(e => console.warn("mirror(reservations) failed:", e?.message || e));
}

function mirrorEquipmentIfNeeded(key, value) {
  if (key !== "equipment" || !Array.isArray(value)) return;
  fetch("/api/sync-equipment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ equipment: value }),
  }).catch(e => console.warn("mirror(equipment) failed:", e?.message || e));
}

// ─── DB DIAGNOSTICS (accessible from browser console) ────────────────────────
window.dbDiag = async () => {
  const keys = ["equipment","reservations","categories","categoryTypes","categoryLoanTypes","teamMembers","kits","policies","certifications","deptHeads","collegeManager","managerToken","siteSettings"];
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
const SECRETARY_NAV_PAGES = ["dashboard","studios","studio-certifications","lessons","lecturers","students","policies","settings"];
const WAREHOUSE_NAV_PAGES = ["reservations","equipment","certifications","kits","policies","settings"];
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
      // Lessons auto-archive, regular loans go to "באיחור".
      // Staff loans (loan_type="צוות") stay "מאושר" (effective "פעילה") until
      // a staff member manually clicks "הוחזר" — they never auto-escalate.
      if (normalizedReservation.loan_type === "שיעור") {
        return markReservationReturned(normalizedReservation, now);
      }
      if (normalizedReservation.loan_type === "צוות") {
        return normalizedReservation;
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
    // Global-level assignment
    if (hasLinkedValue(lesson.kitId) && String(lesson.kitId) === String(kit.id)) return true;
    // Old-style kit.lessonId assignment
    if (hasLinkedValue(kit.lessonId) && String(kit.lessonId) === String(lesson.id)) return true;
    // Per-session assignment: any session in this lesson has session.kitId === kit.id
    if (Array.isArray(lesson.schedule)) {
      return lesson.schedule.some(
        (session) => hasLinkedValue(session?.kitId) && String(session.kitId) === String(kit.id)
      );
    }
    return false;
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
      studioId: session.studioId || null,
      kitId: session.kitId || null,
    }))
    .sort(compareDateTimeParts);
}

function buildLessonReservations(lessons = [], kits = []) {
  const reservations = [];
  const linkedKitIds = new Set();

  lessons.forEach((lesson) => {
    const schedule = getLessonScheduleEntries(lesson);
    if (!schedule.length) return;

    // ערכה ברמת הקורס (fallback)
    const lessonKit = getLinkedLessonKit(lesson, kits);
    if (lessonKit) linkedKitIds.add(String(lessonKit.id));

    schedule.forEach((session, index) => {
      // ערכה ברמת המפגש עוקפת את ערכת הקורס
      let kit = lessonKit;
      if (hasLinkedValue(session.kitId)) {
        const sessionKit = kits.find(k => String(k.id) === String(session.kitId));
        if (sessionKit) { kit = sessionKit; linkedKitIds.add(String(sessionKit.id)); }
      }
      if (!kit) return;

      const items = (Array.isArray(kit?.items) ? kit.items : [])
        .filter((item) => Number(item?.quantity) > 0)
        .map((item) => ({ ...item }));
      if (!items.length) return;

      const returnTs = toDateTime(session.date, session.endTime || "23:59");
      const isPast = returnTs && Date.now() >= returnTs;
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
        status: isPast ? "הוחזר" : "מאושר",
        returned_at: isPast ? new Date(returnTs).toISOString() : undefined,
      });
    });
  });

  return { reservations, linkedKitIds };
}

function buildLessonStudioBookings(lessons = []) {
  const bookings = [];

  lessons.forEach((lesson) => {
    const schedule = getLessonScheduleEntries(lesson);
    if (!schedule.length) return;

    schedule.forEach((session, index) => {
      // שיוך כיתה ברמת המפגש עוקף שיוך ברמת הקורס
      const effectiveStudioId = hasLinkedValue(session.studioId) ? session.studioId
        : hasLinkedValue(lesson.studioId) ? lesson.studioId : null;
      // שיעור ללא כיתה עדיין מופיע בלו"ז — studioId יהיה null

      const lessonName = String(lesson.name || "").trim();
      const instructorName = String(lesson.instructorName || "").trim();
      const track = String(lesson.track || "").trim();
      bookings.push({
        id: `lesson_booking_${lesson.id}_${index}`,
        lesson_id: lesson.id,
        lesson_auto: true,
        bookingKind: "lesson",
        studioId: effectiveStudioId,
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
  body { font-family:'Heebo',sans-serif; background:var(--bg); color:var(--text); direction:rtl; min-height:100vh; overflow-x:clip; overflow-y:scroll; scrollbar-gutter:stable; }
  .app { display:flex; min-height:100vh; }
  .sidebar { width:240px; min-width:240px; background:var(--surface); border-left:1px solid var(--border); display:flex; flex-direction:column; position:fixed; right:0; top:0; bottom:0; z-index:100; }
  .sidebar-logo { padding:24px 20px 20px; border-bottom:1px solid var(--border); }
  .sidebar-logo .app-name { font-size:20px; font-weight:900; color:var(--accent); line-height:1.1; }
  .sidebar-logo .app-sub { font-size:13px; font-weight:600; color:var(--text2); margin-top:5px; }
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
  .badge-teal { background:rgba(100,181,246,0.15); color:#64b5f6; border:1px solid rgba(100,181,246,0.35); }
  .badge-gray { background:var(--surface2); color:var(--text2); border:1px solid var(--border); }
  .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.75); display:flex; align-items:center; justify-content:center; z-index:10000; padding:20px; backdrop-filter:blur(4px); animation:fadeIn 0.15s; }
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
    .nav { display:flex; flex-direction:row; padding:0; flex:1; overflow-x:auto; scroll-behavior:smooth; scrollbar-width:none; }
    .nav::-webkit-scrollbar { display:none; }
    .nav-section { display:none; }
    .nav-item { flex:0 0 auto; min-width:54px; max-width:72px; flex-direction:column; gap:1px; padding:4px 2px; font-size:9px; border-right:none; border-top:3px solid transparent; justify-content:center; text-align:center; margin:0; }
    .nav-label { display:block; font-size:8px; line-height:1.1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:0 2px; color:var(--text3); }
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
    .modal { max-width:100%; max-height:calc(100dvh - 60px); border-radius:var(--r) var(--r) 0 0; }
    .modal-overlay { align-items:flex-end; padding:60px 0 0 0; }
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
  פרטית: ["כללי", "צילום", "סאונד"],
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

// ── EqForm: extracted outside EquipmentPage so React keeps a stable component identity ──
// Previously defined inline → every parent re-render destroyed form state (quantity, description, etc.)
function EqForm({ initial, onImageUploaded, categories, equipmentCertTypes, saving, onSave, onCancel }) {
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
  const imgInputRef = useRef(null);
  const [isGeneratingDesc, setIsGeneratingDesc] = useState(false);
  const [isGeneratingTechDetails, setIsGeneratingTechDetails] = useState(false);

  const generateGeminiField = async ({ itemName, systemInstruction, onSuccess, setLoading, errorPrefix }) => {
    if (!itemName) {
      alert("נא להזין שם פריט קודם");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch('/api/gemini', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    const file = e.target.files?.[0];
    console.log("[IMG] handleImageUpload fired, file:", file?.name, file?.size);
    if (!file) return;
    if (!file.type.startsWith("image/")) { setImgError("נא לבחור קובץ תמונה בלבד"); return; }
    if (file.size > 15 * 1024 * 1024) { setImgError("התמונה גדולה מדי (מקסימום 15MB)"); return; }
    setImgError("");
    setImgUploading(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Image load timeout (10s)")), 10000);
        const blobUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          clearTimeout(timeout);
          URL.revokeObjectURL(blobUrl);
          const MAX = 500;
          let w = img.width, h = img.height;
          // Scale down so longest side fits MAX
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
            else       { w = Math.round(w * MAX / h); h = MAX; }
          }
          // Pad to square so non-square images display fully with object-fit:cover
          const side = Math.max(w, h);
          const ox = Math.round((side - w) / 2);
          const oy = Math.round((side - h) / 2);
          const canvas = document.createElement("canvas");
          canvas.width = side; canvas.height = side;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, side, side);
          ctx.drawImage(img, ox, oy, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.70));
        };
        img.onerror = () => { clearTimeout(timeout); URL.revokeObjectURL(blobUrl); reject(new Error("Failed to load image")); };
        img.src = blobUrl;
      });
      console.log("[IMG] Compressed, uploading to server...");
      const res  = await fetch("/api/upload-image", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ data: dataUrl }),
      });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error || "שגיאת שרת");
      console.log("[IMG] Upload success:", json.url);
      s("image", json.url);
      if (onImageUploaded) onImageUploaded(json.url);
    } catch (err) {
      console.error("[IMG] Upload failed:", err);
      setImgError("שגיאה בהעלאת התמונה — נסה שנית");
    } finally {
      setImgUploading(false);
      if (imgInputRef.current) imgInputRef.current.value = "";
    }
  };

  const isImage = f.image?.startsWith("data:") || f.image?.startsWith("http");

  return (
    <div>
      <div className="grid-2">
        <div className="form-group"><label className="form-label">שם הציוד *</label><input className="form-input" value={f.name} onChange={e=>s("name",e.target.value)}/></div>
        <div className="form-group"><label className="form-label">קטגוריה</label><select className="form-select" value={f.category} onChange={e=>s("category",e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select></div>
      </div>
      <div className="form-group">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap",direction:"ltr"}}>
          <button type="button" className="btn btn-primary btn-sm" onClick={()=>generateAutoDescription(f.name)} disabled={isGeneratingDesc} style={{display:"inline-flex",alignItems:"center",gap:6,fontWeight:800}}>
            <span aria-hidden="true">✨</span>
            {isGeneratingDesc ? "מייצר תיאור..." : "תיאור אוטומטי"}
          </button>
          <label className="form-label" style={{margin:0,textAlign:"right"}}>תיאור</label>
        </div>
        <textarea className="form-textarea" rows={2} value={f.description} onChange={e=>s("description",e.target.value)}/>
      </div>
      <div className="form-group">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap",direction:"ltr"}}>
          <button type="button" className="btn btn-primary btn-sm" onClick={()=>generateAutoTechnicalDetails(f.name)} disabled={isGeneratingTechDetails} style={{display:"inline-flex",alignItems:"center",gap:6,fontWeight:800}}>
            <span aria-hidden="true">✨</span>
            {isGeneratingTechDetails ? "מייצר פרטים..." : "פרטים טכניים אוטומטיים"}
          </button>
          <label className="form-label" style={{margin:0,textAlign:"right"}}>פרטים טכניים</label>
        </div>
        <textarea className="form-textarea" rows={3} placeholder="לדוגמה: טווחי עבודה, חיבורים, משקל, סוללה, פורמטים נתמכים..." value={f.technical_details || ""} onChange={e=>s("technical_details",e.target.value)}/>
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
              <input ref={imgInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleImageUpload}/>
              <button type="button" onClick={()=>imgInputRef.current?.click()} disabled={imgUploading}
                style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",background:"var(--surface3)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",cursor:imgUploading?"not-allowed":"pointer",fontSize:12,color:"var(--text2)",opacity:imgUploading?0.6:1,width:"100%"}}>
                {imgUploading ? "⏳ מעלה תמונה..." : "🖼️ העלה תמונה מהמחשב"}
              </button>
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
        <button className="btn btn-primary" disabled={!f.name||saving||imgUploading} onClick={()=>onSave(f)}>{saving?"⏳ שומר...":initial?"💾 שמור":"➕ הוסף"}</button>
        <button className="btn btn-secondary" onClick={onCancel}>ביטול</button>
      </div>
    </div>
  );
}

function EquipmentPage({ equipment, reservations, setEquipment, showToast, categories=DEFAULT_CATEGORIES, setCategories, categoryTypes={}, setCategoryTypes, categoryLoanTypes={}, setCategoryLoanTypes=()=>{}, certifications={types:[],students:[]}, studios=[], collegeManager={}, managerToken="", onLogCreated=()=>{}, equipmentReports:eqReports=[], fetchEquipmentReports:fetchEqReports=()=>{} }) {
  const [eqSubView, setEqSubView] = useState("active"); // "active" | "damaged" | "reports"
  const [eqReportsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [trackFilter, setTrackFilter] = useState("הכל");
  const [selectedCats, setSelectedCats] = useState([]);
  const [typeFilter, setTypeFilter] = useState("הכל"); // "הכל" | "סאונד" | "צילום"
  const [modal, setModal] = useState(null);
  const [editingCatPill, setEditingCatPill] = useState(null);
  const [editCatPillVal, setEditCatPillVal] = useState("");
  const [editCatPillType, setEditCatPillType] = useState("");
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

  const handleExcelImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const isExcel = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");
    if (!isExcel) { showToast("error", "נא לבחור קובץ Excel בלבד (.xlsx / .xls)"); e.target.value = ""; return; }
    let rows = [];
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      // Read raw rows with header row as array, then normalize keys (trim spaces/BOM)
      const rawRows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
      rows = rawRows.map(row => {
        const normalized = {};
        Object.keys(row).forEach(k => { normalized[k.replace(/^\uFEFF/, "").trim()] = row[k]; });
        return normalized;
      });
    } catch (err) {
      showToast("error", "שגיאה בקריאת הקובץ. ודא שהקובץ תקין."); e.target.value = ""; return;
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
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["שם פריט", "כמות", "רובריקה", "תיאור", "הערות"],
      ["גמביל DJI RS3", 3, "מייצבי מצלמה", "גמביל 3 צירים", ""],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "ציוד");
    XLSX.writeFile(wb, "תבנית_ייבוא_ציוד.xlsx");
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
    const saved = await persistEquipmentChange(updated, { successMessage: `כמות עודכנה: ${newTotal} יחידות` });
    if (saved) {
      const caller = JSON.parse(sessionStorage.getItem("staff_user")||"{}");
      const logId = await logActivity({ user_id: caller.id, user_name: caller.full_name, action: "equipment_qty_update", entity: "equipment", entity_id: String(eq.id), details: { name: eq.name, delta, new_qty: newTotal } });
      onLogCreated(logId);
    }
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
    if (saved) {
      const caller = JSON.parse(sessionStorage.getItem("staff_user")||"{}");
      const logId = await logActivity({ user_id: caller.id, user_name: caller.full_name, action: modal.type==="add" ? "equipment_add" : "equipment_edit", entity: "equipment", entity_id: String(form.id||form.name), details: { name: form.name, category: form.category } });
      onLogCreated(logId);
      setModal(null);
    }
  };

  const del = async (eq) => {
    const updated = equipment.filter(e => e.id!==eq.id);
    const deleted = await persistEquipmentChange(updated, {
      successMessage: `"${eq.name}" נמחק`,
      errorMessage: `המחיקה של "${eq.name}" לא נשמרה בשרת.`,
    });
    if (deleted) {
      const caller = JSON.parse(sessionStorage.getItem("staff_user")||"{}");
      const logId = await logActivity({ user_id: caller.id, user_name: caller.full_name, action: "equipment_delete", entity: "equipment", entity_id: String(eq.id), details: { name: eq.name } });
      onLogCreated(logId);
      setModal(null);
    }
  };

  const handleCatPillRename = async (oldName, newName) => {
    const type = editCatPillType;
    const updatedCats = categories.map(c => c === oldName ? newName : c);
    const updatedEq = equipment.map(e => {
      if (e.category !== oldName) return e;
      return { ...e, category: newName, soundOnly: type === "סאונד", photoOnly: type === "צילום" };
    });
    const updatedTypes = { ...categoryTypes };
    if (oldName !== newName) delete updatedTypes[oldName];
    if (type) updatedTypes[newName] = type;
    else delete updatedTypes[newName];
    setCategories(updatedCats);
    setEquipment(updatedEq);
    setCategoryTypes(updatedTypes);
    await Promise.all([storageSet("categories", updatedCats), storageSet("equipment", updatedEq), storageSet("categoryTypes", updatedTypes)]);
    showToast("success", `קטגוריה "${oldName}" עודכנה`);
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
  // Only count items that have PHYSICALLY left the warehouse (פעילה / באיחור)
  // "מאושר" and "ממתין" items are still in the warehouse — don't deduct from stock
  const used = (id) => reservations
    .filter(r=>{
      const eff = getEffectiveStatus(r);
      return eff === "פעילה" || eff === "באיחור";
    })
    .reduce((s,r)=>s+(r.items?.find(i=>i.equipment_id==id)?.quantity||0),0);

  // EqForm is defined OUTSIDE EquipmentPage (above) to maintain stable React identity.
  // See the EqForm function before EquipmentPage for the actual component.

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
          {id:"reports",label:"📋 דיווחי סטודנטים",badge:eqReports.filter(r=>r.status==="open").length||null},
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

      {/* Reports sub-view */}
      {eqSubView==="reports" && <div>
        <div className="flex-between mb-4">
          <div style={{fontWeight:900,fontSize:16}}>📋 דיווחי סטודנטים על ציוד</div>
          <button className="btn btn-secondary btn-sm" onClick={fetchEqReports} disabled={eqReportsLoading}>{eqReportsLoading?"טוען...":"🔄 רענן"}</button>
        </div>
        {eqReports.filter(r=>r.status==="open").length===0
          ?<div className="empty-state" style={{padding:40}}><div className="emoji">✅</div><p>אין דיווחים פתוחים</p></div>
          :eqReports.filter(r=>r.status==="open").map(rp=>{
            const eq=equipment.find(e=>String(e.id)===String(rp.equipment_id));
            return <div key={rp.id} className="card" style={{padding:16,marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:800,fontSize:14}}>{eq?.name||rp.equipment_id}</div>
                  <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>👤 {rp.student_name} · 📅 {new Date(rp.created_at).toLocaleDateString("he-IL")}</div>
                  <div style={{marginTop:8,fontSize:13,color:"var(--text)",background:"var(--surface2)",borderRadius:8,padding:"10px 12px",border:"1px solid var(--border)"}}>{rp.content}</div>
                </div>
                <button className="btn btn-secondary btn-sm" style={{flexShrink:0}} onClick={async()=>{
                  try{await fetch("/api/equipment-report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"mark-handled",id:rp.id})});
                  fetchEqReports();showToast("success","סומן כטופל ✅");}catch{showToast("error","שגיאה");}
                }}>✅ טופל</button>
              </div>
            </div>;
          })
        }
        {eqReports.filter(r=>r.status==="handled").length>0&&<>
          <div style={{fontWeight:800,fontSize:14,color:"var(--text3)",marginTop:24,marginBottom:8}}>היסטוריה ({eqReports.filter(r=>r.status==="handled").length})</div>
          {eqReports.filter(r=>r.status==="handled").slice(0,20).map(rp=>{
            const eq=equipment.find(e=>String(e.id)===String(rp.equipment_id));
            return <div key={rp.id} className="card" style={{padding:12,marginBottom:6,opacity:0.6}}>
              <div style={{fontWeight:700,fontSize:13}}>{eq?.name||rp.equipment_id} — {rp.student_name}</div>
              <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{new Date(rp.created_at).toLocaleDateString("he-IL")} · {rp.content.slice(0,80)}{rp.content.length>80?"...":""}</div>
            </div>;
          })}
        </>}
      </div>}

      {/* Active equipment sub-view */}
      {eqSubView==="active" && <>
      <div className="flex-between mb-4">
        <div className="search-bar"><span>🔍</span><input placeholder="חיפוש ציוד..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div className="flex gap-2" style={{flexWrap:"wrap",justifyContent:"flex-end"}}>
          <button className="btn btn-secondary" onClick={downloadTemplate} title="הורד תבנית Excel">📥 תבנית</button>
          <button className="btn btn-secondary" onClick={()=>csvInputRef.current?.click()}>📤 ייבוא Excel</button>
          <input ref={csvInputRef} type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={handleExcelImport}/>
          <SmartEquipmentImportButton
            showToast={showToast}
            existingCategories={existingCategories}
            onImportSuccess={handleAiEquipmentImport}
          />
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
      <div className="flex gap-2 mb-6" style={{flexWrap:"wrap",alignItems:"center",gap:6,marginBottom:14}}>
        {filteredCategoryOptions.map(c=>{
          const active = selectedCats.includes(c);
          const isEmptyCategory = !equipment.some((item) => item.category === c);
          const isEditing = editingCatPill === c;
          return (
            <div key={c} style={{display:"flex",alignItems:"center",borderRadius:8,overflow:"hidden",border:`1px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"var(--surface2)"}}>
              {isEditing ? (
                <>
                  <input
                    autoFocus
                    value={editCatPillVal}
                    onChange={e=>setEditCatPillVal(e.target.value)}
                    onKeyDown={async e=>{
                      if(e.key==="Enter"&&editCatPillVal.trim()){
                        await handleCatPillRename(c, editCatPillVal.trim());
                        setEditingCatPill(null);
                      } else if(e.key==="Escape") setEditingCatPill(null);
                    }}
                    style={{width:110,padding:"4px 8px",fontSize:12,background:"var(--surface)",border:"none",color:"var(--text)",outline:"none"}}
                  />
                  <select
                    value={editCatPillType}
                    onChange={e=>setEditCatPillType(e.target.value)}
                    style={{fontSize:11,background:"var(--surface)",border:"none",borderRight:"1px solid var(--border)",color:"var(--text2)",padding:"4px 4px",cursor:"pointer"}}
                  >
                    <option value="">כללי</option>
                    <option value="סאונד">🎙️ סאונד</option>
                    <option value="צילום">🎥 צילום</option>
                  </select>
                  <button type="button" className="btn btn-sm" style={{borderRadius:0,border:"none",background:"transparent",color:"var(--accent)",fontWeight:800,padding:"4px 7px",fontSize:12}} title="שמור"
                    onClick={async()=>{if(editCatPillVal.trim()){await handleCatPillRename(c,editCatPillVal.trim());setEditingCatPill(null);}}}>✓</button>
                  <button type="button" className="btn btn-sm" style={{borderRadius:0,border:"none",background:"transparent",color:"var(--text3)",fontWeight:800,padding:"4px 7px",fontSize:12}} title="ביטול"
                    onClick={()=>setEditingCatPill(null)}>✕</button>
                </>
              ) : (
                <>
                  <button className="btn btn-sm" style={{borderRadius:0,border:"none",background:"transparent",color:active?"var(--accent)":"var(--text2)",fontWeight:700,padding:"5px 10px"}}
                    onClick={()=>setSelectedCats(prev=>active?prev.filter(x=>x!==c):[...prev,c])}>
                    {c}
                  </button>
                  <button type="button" className="btn btn-sm" title="ערוך שם"
                    style={{borderRadius:0,border:"none",borderRight:"1px solid var(--border)",background:"transparent",color:"var(--text3)",padding:"5px 7px",fontSize:11}}
                    onClick={e=>{e.stopPropagation();setEditingCatPill(c);setEditCatPillVal(c);setEditCatPillType(getCatType(c)||"");}}>
                    ✏️
                  </button>
                  {isEmptyCategory && (
                    <button type="button" className="btn btn-sm"
                      style={{borderRadius:0,border:"none",borderRight:"1px solid var(--border)",background:"transparent",color:"var(--red)",fontWeight:900,padding:"5px 8px"}}
                      title="מחק רובריקה ריקה" onClick={e=>{e.stopPropagation();deleteEmptyCategoryFromFilters(c);}}>
                      ×
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
        <button type="button" className="btn btn-sm btn-primary" style={{borderRadius:8,fontSize:12,padding:"5px 12px"}}
          onClick={()=>setModal({type:"newcat"})}>
          ➕ קטגוריה חדשה
        </button>
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
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={(e)=>{e.stopPropagation();setModal({type:"add",defaultCategory:c})}}
                  >
                    ➕ הוסף ציוד
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
                        ? <img src={cloudinaryThumb(eq.image)} alt={eq.name} style={{width:72,height:72,objectFit:"cover",borderRadius:10,border:"1px solid var(--border)"}}/>
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
                      <button className="btn btn-danger btn-sm" onClick={(e)=>{e.stopPropagation();del(eq)}}>🗑️</button>
                    </div>
                  </div>
                );})}
              </div>
            </div>
          ))}
        </>
      )}
      {(modal?.type==="add"||modal?.type==="edit") && <Modal title={modal.type==="add"?"➕ הוספת ציוד":"✏️ עריכת ציוד"} onClose={()=>setModal(null)}><EqForm
              initial={modal.type==="edit"?modal.item:modal.defaultCategory?{category:modal.defaultCategory}:null}
              categories={categories}
              equipmentCertTypes={equipmentCertTypes}
              saving={saving}
              onSave={save}
              onCancel={()=>setModal(null)}
              onImageUploaded={(url) => {
                if (modal.type==="edit" && modal.item?.id) {
                  const updated = equipment.map(e => e.id===modal.item.id ? {...e, image: url} : e);
                  persistEquipmentChange(updated, { successMessage: "תמונה עודכנה ✅" });
                }
                setModal(prev => ({...prev, item: {...(prev.item||{}), image: url}}));
              }}/></Modal>}
      {modal?.type==="units" && <UnitsModal eq={modal.item} equipment={equipment} setEquipment={setEquipment} showToast={showToast} onClose={()=>setModal(null)}/>}
      {/* Delete confirmation removed — del() is called directly, undo via top bar */}
      {modal?.type==="loan-types" && <CategoryLoanTypesModal categoryLoanTypes={categoryLoanTypes} onSave={saveCategoryLoanTypes} onClose={()=>setModal(null)}/>}
      {modal?.type==="newcat" && <AddCategoryModal
        categories={categories}
        onClose={()=>setModal(null)}
        onAdd={async(name,type)=>{
          const updatedCats=[...categories, name];
          const updatedTypes={...categoryTypes,...(type?{[name]:type}:{})};
          setCategories(updatedCats);
          setCategoryTypes(updatedTypes);
          await Promise.all([storageSet("categories",updatedCats),storageSet("categoryTypes",updatedTypes)]);
          showToast("success",`קטגוריה "${name}" נוספה`);
          setModal(null);
        }}
      />}
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
function AddCategoryModal({ categories, onClose, onAdd }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const exists = categories.includes(name.trim());
  return (
    <Modal title="➕ הוספת קטגוריה חדשה" onClose={onClose}>
      <div className="form-group">
        <label className="form-label">שם הקטגוריה *</label>
        <input className="form-input" autoFocus value={name} onChange={e=>setName(e.target.value)}
          placeholder="לדוגמה: מצלמות, מיקרופונים..."
          onKeyDown={e=>{if(e.key==="Enter"&&name.trim()&&!exists)onAdd(name.trim(),type);}}/>
        {exists&&<div style={{color:"var(--red)",fontSize:11,marginTop:4}}>קטגוריה זו כבר קיימת</div>}
      </div>
      <div className="form-group">
        <label className="form-label">סוג ציוד</label>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {[{v:"",l:"🧩 כללי"},{v:"סאונד",l:"🎙️ סאונד"},{v:"צילום",l:"🎥 צילום"}].map(({v,l})=>(
            <button key={v} type="button" onClick={()=>setType(v)}
              style={{padding:"6px 16px",borderRadius:8,border:`2px solid ${type===v?"var(--accent)":"var(--border)"}`,background:type===v?"var(--accent-glow)":"transparent",color:type===v?"var(--accent)":"var(--text2)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}>
        <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
        <button className="btn btn-primary" disabled={!name.trim()||exists} onClick={()=>onAdd(name.trim(),type)}>+ הוסף</button>
      </div>
    </Modal>
  );
}

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
  const LOAN_FILTERS = [{key:"הכל",label:"הכל",icon:"📦"},{key:"פרטית",label:"פרטית",icon:"👤"},{key:"הפקה",label:"הפקה",icon:"🎬"},{key:"סאונד",label:"סאונד",icon:"🎙️"},{key:"קולנוע יומית",label:"קולנוע יומית",icon:"🎥"},{key:"שיעור",label:"שיעור",icon:"📽️"},{key:"צוות",label:"איש צוות",icon:"💼"}];
  const activeRes = reservations.filter(r=>
    (r.status==="מאושר"||r.status==="באיחור") && r.borrow_date && r.return_date &&
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
                        ? <img src={cloudinaryThumb(eq.image)} alt={eq.name} style={{width:"100%",height:"100%",objectFit:"contain",display:"block",background:"var(--surface2)"}}/>
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
                    ? <img src={cloudinaryThumb(eq.image)} alt="" style={{width:36,height:36,objectFit:"cover",borderRadius:6}}/>
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
                              ? <img src={cloudinaryThumb(eq.image)} alt={eq.name} style={{width:80,height:80,objectFit:"contain",borderRadius:8}}/>
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
                              {isImg ? <img src={cloudinaryThumb(eq.image)} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}}/> : <span style={{fontSize:22}}>{eq?.image||"📦"}</span>}
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
        const dhAc = new AbortController();
        const dhTid = setTimeout(() => dhAc.abort(), 20000);
        for (let i = 0; i < relevantDeptHeads.length; i++) {
          if (dhAc.signal.aborted) break;
          const dh = relevantDeptHeads[i];
          // delay between emails to avoid Gmail rate limiting
          if (i > 0) await new Promise(r => setTimeout(r, 1500));
          try {
            const response = await fetch("/api/send-email", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: dhAc.signal,
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
        clearTimeout(dhTid);
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
            <div style={{fontSize:22,fontWeight:900,color:"var(--accent)"}}>מערכת הפניות</div>
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
function uint8ToBase64_policies(bytes) {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function PoliciesPage({ policies, setPolicies, showToast }) {
  const LOAN_TYPES = [
    { key:"פרטית", icon:"👤", label:"השאלה פרטית" },
    { key:"הפקה",  icon:"🎬", label:"השאלה להפקה" },
    { key:"סאונד", icon:"🎙️", label:"השאלת סאונד" },
    { key:"קולנוע יומית", icon:"🎥", label:"השאלת קולנוע יומית" },
    { key:"לילה", icon:"🌙", label:"נהלי קביעת חדר לילה" },
  ];
  const [draft, setDraft] = useState({ ...policies });
  const [saving, setSaving] = useState(false);
  const [fsEdit, setFsEdit] = useState(null); // key being fullscreen-edited
  const [pdfUploading, setPdfUploading] = useState(false);

  const handleCommitmentPdfUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    if (file.size > 10 * 1024 * 1024) { showToast("error", "הקובץ גדול מדי — עד 10MB"); return; }
    setPdfUploading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      let finalData, compressed = false;
      try {
        const cs = new CompressionStream("gzip");
        const w = cs.writable.getWriter();
        w.write(new Uint8Array(arrayBuffer)); w.close();
        const chunks = [];
        const reader = cs.readable.getReader();
        for (;;) { const { value, done } = await reader.read(); if (done) break; chunks.push(value); }
        const total = chunks.reduce((a, c) => a + c.length, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        finalData = uint8ToBase64_policies(out);
        compressed = true;
      } catch {
        finalData = uint8ToBase64_policies(new Uint8Array(arrayBuffer));
      }
      setDraft(p => ({ ...p, commitmentPdf: finalData, commitmentPdfCompressed: compressed, commitmentPdfName: file.name }));
      showToast("success", "המסמך הועלה בהצלחה ✅");
    } catch {
      showToast("error", "שגיאה בעיבוד הקובץ");
    }
    setPdfUploading(false);
  };

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
      {/* Commitment PDF */}
      <div className="card" style={{marginBottom:20}}>
        <div className="card-header"><div className="card-title">📄 מסמך התחייבות — נהלי השאלת ציוד</div></div>
        <div style={{padding:"16px 20px"}}>
          <div style={{fontSize:12,color:"var(--text3)",marginBottom:14,lineHeight:1.7}}>
            המסמך יוצג לסטודנטים בפאנל "נהלים" עם אפשרות הורדה. הסטודנט נדרש להדפיסו ולחתום עליו לפני השאלה ראשונה.
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <label className="btn btn-secondary" style={{cursor:pdfUploading?"not-allowed":"pointer",opacity:pdfUploading?0.6:1}}>
              {pdfUploading ? "⏳ מעלה..." : "📤 העלה מסמך PDF"}
              <input type="file" accept="application/pdf" style={{display:"none"}} onChange={handleCommitmentPdfUpload} disabled={pdfUploading}/>
            </label>
            {draft.commitmentPdf && (
              <button type="button" className="btn btn-secondary" onClick={()=>setDraft(p=>({...p,commitmentPdf:"",commitmentPdfCompressed:false,commitmentPdfName:""}))} style={{fontSize:12}}>
                🗑️ הסר מסמך
              </button>
            )}
          </div>
          {draft.commitmentPdf && (
            <div style={{marginTop:12,padding:"10px 14px",background:"rgba(39,174,96,0.08)",border:"1px solid rgba(39,174,96,0.3)",borderRadius:8,display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:18}}>✅</span>
              <div>
                <div style={{fontSize:13,fontWeight:800,color:"var(--green)"}}>מסמך טעון</div>
                {draft.commitmentPdfName&&<div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{draft.commitmentPdfName}</div>}
              </div>
            </div>
          )}
        </div>
      </div>

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
function TeamPage({ teamMembers, setTeamMembers, deptHeads=[], setDeptHeads, collegeManager={}, setCollegeManager, showToast, managerToken="" }) {
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
        {/* Public daily display link */}
        <div style={{marginTop:14,background:"rgba(245,166,35,0.08)",border:"1px solid rgba(245,166,35,0.3)",borderRadius:"var(--r-sm)",padding:"10px 14px",fontSize:12}}>
          <div style={{fontWeight:700,marginBottom:6,color:"#f5a623"}}>📺 לינק לוח לוז יומי ציבורי</div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <code style={{fontSize:11,background:"var(--surface3)",padding:"3px 8px",borderRadius:4,flex:1,wordBreak:"break-all",color:"var(--text2)"}}>
              {window.location.origin}/daily
            </code>
            <button className="btn btn-secondary btn-sm" onClick={()=>{navigator.clipboard.writeText(`${window.location.origin}/daily`);showToast("success","הקישור הועתק!");}}>
              📋 העתק
            </button>
            <a href="/daily" target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{textDecoration:"none"}}>
              🔗 פתח
            </a>
          </div>
          <div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>הצג על מסך/טלוויזיה בלובי — מתחלף אוטומטית בין לוז שיעורים לקביעות חדרים</div>
        </div>

        {/* Daily table link */}
        <div style={{marginTop:10,background:"rgba(46,204,113,0.08)",border:"1px solid rgba(46,204,113,0.3)",borderRadius:"var(--r-sm)",padding:"10px 14px",fontSize:12}}>
          <div style={{fontWeight:700,marginBottom:6,color:"#2ecc71"}}>📋 לינק לוח לוז יומי בפורמט טבלה</div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <code style={{fontSize:11,background:"var(--surface3)",padding:"3px 8px",borderRadius:4,flex:1,wordBreak:"break-all",color:"var(--text2)"}}>
              {window.location.origin}/daily-table
            </code>
            <button className="btn btn-secondary btn-sm" onClick={()=>{navigator.clipboard.writeText(`${window.location.origin}/daily-table`);showToast("success","הקישור הועתק!");}}>
              📋 העתק
            </button>
            <a href="/daily-table" target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{textDecoration:"none"}}>
              🔗 פתח
            </a>
          </div>
          <div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>תצוגת טבלה פשוטה של כל קביעות היום</div>
        </div>

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
                <button className="btn btn-danger btn-sm" onClick={()=>del(m.id)}>🗑️</button>
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
                      <span style={{fontSize:20}}>{eq.image?.startsWith("data:")||eq.image?.startsWith("http")?<img src={cloudinaryThumb(eq.image)} alt="" style={{width:24,height:24,objectFit:"cover",borderRadius:4}}/>:eq.image||"📦"}</span>
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
    const [selectedRecipient, setSelectedRecipient] = useState("");
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
      const recipient = selectedRecipient || effectiveInstructorEmail || String(instructorEmail || "").trim();
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

      if(!kitItems.length) {
        setLocalMsg({type:"error",text:"יש לבחור לפחות פריט ציוד אחד לערכה"});
        return;
      }

      // ── Availability check: ensure no item goes to negative inventory ──
      const kitId = initial?.id||`lk_${Date.now()}`;
      const baseRes = (reservations||[]).filter(r=>r.lesson_kit_id!==kitId);

      // If no schedule — just save kit without reservations.
      // We still route through the batch RPC so that any existing rows for
      // this kit are deleted atomically and available_units is recomputed.
      if (finalSchedule.length === 0) {
        setSaving(true);
        const kit = {
          id: kitId, kitType:"lesson",
          name: effectiveName || name.trim(),
          instructorName: effectiveInstructorName || instructorName.trim(),
          instructorPhone: effectiveInstructorPhone || instructorPhone.trim(),
          instructorEmail: effectiveInstructorEmail || instructorEmail.trim(),
          description: description.trim(),
          items: kitItems, schedule: [],
        };
        const updatedKits = initial ? kits.map(k=>k.id===initial.id?kit:k) : [...kits, kit];
        setKits(updatedKits);

        // Empty reservations array → RPC just deletes old rows + re-syncs
        // available_units. Items array is irrelevant in that path but we
        // pass kitItems for completeness.
        const rpcRes = await createLessonReservations(kitId, [], kitItems);
        if (!rpcRes.ok) {
          setSaving(false);
          setLocalMsg({ type:"error", text:`❌ שגיאה בשמירה — ${rpcRes.detail || rpcRes.error || ""}` });
          return;
        }

        // Remove old reservations for this kit from the local cache/state
        if(setReservations) setReservations(baseRes);
        const [r1, r2] = await Promise.all([
          storageSet("kits", updatedKits),
          storageSet("reservations", baseRes),
        ]);
        setSaving(false);
        if(r1.ok&&r2.ok) {
          onDone();
          showToast("success", `ערכת שיעור "${effectiveName || name.trim()}" נשמרה`);
        } else setLocalMsg({type:"error",text:"❌ שגיאה בשמירה"});
        return;
      }

      // Pre-build Map: eqId → relevant reservations — avoids O(n²) scan inside the loop
      const eqResMap = new Map();
      for (const res of baseRes) {
        if (res.status !== "מאושר" && res.status !== "באיחור") continue;
        for (const ri of res.items || []) {
          if (!eqResMap.has(ri.equipment_id)) eqResMap.set(ri.equipment_id, []);
          eqResMap.get(ri.equipment_id).push(res);
        }
      }
      const sessionConflicts = [];
      for (let si = 0; si < finalSchedule.length; si++) {
        const s = finalSchedule[si];
        const sessionLabel = `שיעור ${si+1} — ${formatDate(s.date)} ${s.startTime||""}–${s.endTime||""}`;
        const itemConflicts = [];
        for (const item of kitItems) {
          const eq = equipment.find(e=>e.id==item.equipment_id);
          if (!eq) continue;
          // Build list of reservations to check against: pre-filtered base + earlier sessions from THIS kit
          const checkRes = [...(eqResMap.get(item.equipment_id) || [])];
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

      // Create/replace associated reservations (one per session) via the
      // atomic batch RPC (migration 010, Stage 2b). The RPC deletes existing
      // rows where lesson_kit_id = kitId, re-checks every session against
      // reservations_new under FOR UPDATE locks held for the whole txn, and
      // recomputes available_units for every touched equipment. A concurrent
      // public-form submit for the same item serializes behind us — no more
      // whole-blob overwrites silently dropping student reservations.
      const newRes = finalSchedule.map((s,i)=>({
        id: `${kitId}_s${i}`,
        lesson_kit_id: kitId,
        status: "מאושר",
        loan_type: "שיעור",
        booking_kind: "lesson",
        lesson_auto: true,
        student_name: effectiveInstructorName || instructorName.trim() || effectiveName || name.trim(),
        email: effectiveInstructorEmail || instructorEmail.trim(),
        phone: effectiveInstructorPhone || instructorPhone.trim(),
        course: effectiveName || name.trim(),
        borrow_date: s.date,
        borrow_time: s.startTime,
        return_date: s.date,
        return_time: s.endTime,
        created_at: new Date().toISOString(),
        overdue_notified: true,
      }));

      const rpcRes = await createLessonReservations(kitId, newRes, kitItems);
      if (!rpcRes.ok) {
        setSaving(false);
        if (rpcRes.error === "not_enough_stock") {
          // The pre-check above should normally catch this, but the RPC is
          // the backstop — if a concurrent write made stock insufficient
          // between our check and the RPC, surface it as a conflict message.
          setLocalMsg({ type:"error", text:"❌ לא ניתן לשמור — חוסר ציוד זמין (ייתכן שהשאלה מתחרה נרשמה בדיוק עכשיו). נא לרענן ולנסות שוב." });
        } else {
          setLocalMsg({ type:"error", text:`❌ שגיאה בשמירת שיעורים — ${rpcRes.detail || rpcRes.error || "שגיאה לא ידועה"}` });
        }
        return;
      }

      // RPC succeeded — the normalized tables are now source-of-truth for this
      // kit's reservations. Refresh local state + the JSON blob cache so the
      // rest of the app (calendars, availability widget, etc.) sees the new
      // rows before the next mirror cycle.
      const newResForCache = newRes.map((r, i) => ({
        ...r,
        items: kitItems,
        id: rpcRes.ids[i] || r.id,
      }));
      const updatedRes = [...baseRes, ...newResForCache];
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

        {/* Kit name field */}
        <div className="form-group" style={{marginBottom:16}}>
          <label className="form-label">שם הערכה *</label>
          <input className="form-input" placeholder='לדוגמה: "ערכת חדר טלוויזיה"' value={name} onChange={e=>setName(e.target.value)}/>
        </div>

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
                        <span style={{fontSize:20}}>{eq.image?.startsWith("data:")||eq.image?.startsWith("http")?<img src={cloudinaryThumb(eq.image)} alt="" style={{width:24,height:24,objectFit:"cover",borderRadius:4}}/>:eq.image||"📦"}</span>
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

        {/* Schedule builder — hidden; scheduling is managed through the Lessons section */}
        {false && !lessonManagedKit && (
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

        {/* Show linked lessons info when kit is managed by lessons */}
        {lessonManagedKit && (
          <div style={{background:"rgba(155,89,182,0.06)",border:"1px solid rgba(155,89,182,0.25)",borderRadius:"var(--r)",padding:16,marginBottom:18}}>
            <div style={{fontWeight:800,fontSize:13,color:"#9b59b6",marginBottom:10}}>📚 קורסים ומפגשים משויכים</div>
            {linkedLessons.map(lesson => (
              <div key={lesson.id||lesson.name} style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"10px 14px",marginBottom:8}}>
                <div style={{fontWeight:700,fontSize:13,color:"var(--text1)",marginBottom:4}}>📖 {lesson.name}</div>
                {(lesson.instructorName) && <div style={{fontSize:12,color:"var(--text2)"}}>👨‍🏫 {lesson.instructorName}{lesson.instructorPhone?` · 📞 ${lesson.instructorPhone}`:""}{lesson.instructorEmail?` · ✉️ ${lesson.instructorEmail}`:""}</div>}
                {linkedSchedule.length > 0 && (
                  <div style={{marginTop:6,display:"flex",flexWrap:"wrap",gap:4}}>
                    {linkedSchedule.slice(0,6).map((s,i) => (
                      <span key={i} style={{background:"rgba(155,89,182,0.1)",border:"1px solid rgba(155,89,182,0.25)",borderRadius:12,padding:"2px 8px",fontSize:11,color:"#9b59b6",fontWeight:600}}>
                        {formatDate(s.date)} {s.startTime||""}–{s.endTime||""}
                      </span>
                    ))}
                    {linkedSchedule.length > 6 && <span style={{fontSize:11,color:"var(--text3)",alignSelf:"center"}}>...ועוד {linkedSchedule.length - 6}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {lessonManagedKit && (()=>{
          // Collect all unique instructor emails from linked lessons
          const recipientOptions = linkedLessons
            .filter(l => l.instructorEmail && String(l.instructorEmail).trim())
            .map(l => ({ name: l.instructorName || l.name || "", email: String(l.instructorEmail).trim() }))
            .filter((v,i,a) => a.findIndex(x=>x.email===v.email)===i); // unique by email
          // Also add kit-level email if different
          if (initial?.instructorEmail && String(initial.instructorEmail).trim()) {
            const kitEmail = String(initial.instructorEmail).trim();
            if (!recipientOptions.find(r=>r.email===kitEmail)) {
              recipientOptions.unshift({ name: initial.instructorName || "", email: kitEmail });
            }
          }
          const activeRecipient = selectedRecipient || effectiveInstructorEmail || String(instructorEmail||"").trim();
          const hasMultiple = recipientOptions.length > 1;
          return (
          <div style={{background:"rgba(46,204,113,0.08)",border:"1px solid rgba(46,204,113,0.25)",borderRadius:"var(--r)",padding:16,marginBottom:18}}>
            <div style={{fontWeight:800,fontSize:13,color:"var(--green)",marginBottom:12}}>📧 שליחת ערכה למורה</div>
            <div style={{fontSize:12,color:"var(--text2)",marginBottom:10}}>
              לאחר שצוות המחסן סיים להרכיב את הערכה, ניתן לשלוח למורה את נוסח ההודעה שלך יחד עם רשימת הציוד והמפגשים, כדי שיוכל לעבור ולבדוק את הערכה.
            </div>
            {/* Recipient selector when multiple instructors */}
            {hasMultiple && (
              <div className="form-group" style={{marginBottom:12}}>
                <label className="form-label">שליחה אל</label>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {recipientOptions.map(r=>(
                    <label key={r.email} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",padding:"6px 10px",borderRadius:"var(--r-sm)",
                      background:activeRecipient===r.email?"rgba(46,204,113,0.15)":"var(--surface2)",
                      border:`1px solid ${activeRecipient===r.email?"rgba(46,204,113,0.4)":"var(--border)"}`,transition:"all 0.15s"}}>
                      <input type="radio" name="teacherRecipient" value={r.email} checked={activeRecipient===r.email}
                        onChange={()=>setSelectedRecipient(r.email)}
                        style={{accentColor:"var(--green)"}}/>
                      <span style={{fontSize:13,fontWeight:600}}>{r.name?`👨‍🏫 ${r.name} · `:""}<span style={{fontWeight:400,color:"var(--text2)"}}>{r.email}</span></span>
                    </label>
                  ))}
                </div>
              </div>
            )}
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
                disabled={teacherEmailSending || !activeRecipient}
              >
                {teacherEmailSending ? "⏳ שולח למורה..." : "📤 שליחת ערכה למורה"}
              </button>
              <span style={{fontSize:12,color:"var(--text3)"}}>
                {activeRecipient ? `המייל יישלח אל ${activeRecipient}` : "יש להזין קודם כתובת מייל למורה"}
              </span>
            </div>
          </div>
          );
        })()}

        {/* Single CTA */}
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",paddingTop:4}}>
          <button className="btn btn-primary"
            disabled={saving || !(effectiveName || name.trim())}
            onClick={save}
            style={{fontSize:15,padding:"12px 28px"}}>
            {saving ? "⏳ שומר..." : initial ? "💾 שמור שינויים" : "🎬 צור ערכת שיעור"}
          </button>
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

      {/* Floating view kit panel (overlay) */}
      {(mode==="viewLesson"||mode==="viewStudent")&&editTarget&&(()=>{
        const vKit = editTarget;
        const isLessonKit = vKit.kitType==="lesson";
        const vLinkedLessons = isLessonKit ? getLessonsLinkedToKit(vKit, lessons) : [];
        const vLinkedSchedule = vLinkedLessons.flatMap(getLessonScheduleEntries).sort(compareDateTimeParts);
        const vDisplaySchedule = vLinkedSchedule.length > 0 ? vLinkedSchedule : (vKit.schedule||[]);
        const vInstructorName = vKit.instructorName || vLinkedLessons[0]?.instructorName || "";
        const vInstructorEmail = vKit.instructorEmail || vLinkedLessons[0]?.instructorEmail || "";
        const vInstructorPhone = vKit.instructorPhone || vLinkedLessons[0]?.instructorPhone || "";
        return (
          <div onClick={()=>{setMode(null);setEditTarget(null);}} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
            <div onClick={e=>e.stopPropagation()} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"20px 24px",maxWidth:520,width:"100%",maxHeight:"85vh",overflowY:"auto",boxShadow:"0 12px 40px rgba(0,0,0,0.5)"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                <div style={{fontWeight:900,fontSize:17}}>{isLessonKit?"🎬":"🎒"} {vKit.name}</div>
                <div style={{display:"flex",gap:6}}>
                  <button className="btn btn-primary btn-sm" onClick={()=>{setMode(isLessonKit?"editLesson":"editStudent");}}>✏️ עריכה</button>
                  <button className="btn btn-secondary btn-sm" onClick={()=>{setMode(null);setEditTarget(null);}}>✕</button>
                </div>
              </div>

              {/* Loan type for student kits */}
              {!isLessonKit && vKit.loanType && (
                <div style={{marginBottom:12}}>
                  <span style={{background:"var(--accent-glow)",border:"1px solid var(--accent)",borderRadius:20,padding:"3px 10px",color:"var(--accent)",fontWeight:700,fontSize:12}}>{LOAN_ICONS[vKit.loanType]||"📦"} {vKit.loanType}</span>
                </div>
              )}

              {/* Linked lessons */}
              {vLinkedLessons.length > 0 && (
                <div style={{background:"rgba(155,89,182,0.06)",border:"1px solid rgba(155,89,182,0.25)",borderRadius:"var(--r)",padding:12,marginBottom:12}}>
                  <div style={{fontWeight:800,fontSize:13,color:"#9b59b6",marginBottom:6}}>📚 קורסים משויכים</div>
                  {vLinkedLessons.map(lesson => (
                    <div key={lesson.id||lesson.name} style={{marginBottom:4}}>
                      <span style={{fontWeight:700,fontSize:13}}>📖 {lesson.name}</span>
                      {lesson.instructorName && <span style={{fontSize:12,color:"var(--text2)",marginRight:8}}>· 👨‍🏫 {lesson.instructorName}</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* Instructor info */}
              {vInstructorName && (
                <div style={{background:"rgba(52,152,219,0.06)",border:"1px solid rgba(52,152,219,0.2)",borderRadius:"var(--r-sm)",padding:"8px 12px",marginBottom:12}}>
                  <div style={{fontSize:13}}><span style={{fontWeight:700,color:"#3498db"}}>👨‍🏫</span> {vInstructorName}{vInstructorPhone?` · 📞 ${vInstructorPhone}`:""}{vInstructorEmail?` · ✉️ ${vInstructorEmail}`:""}</div>
                </div>
              )}

              {/* Description */}
              {vKit.description && (
                <div style={{fontSize:13,color:"var(--text2)",marginBottom:12,padding:"6px 0",borderBottom:"1px solid var(--border)"}}>{vKit.description}</div>
              )}

              {/* Equipment list */}
              <div style={{marginBottom:12}}>
                <div style={{fontWeight:800,fontSize:13,color:"var(--accent)",marginBottom:8}}>🎒 ציוד · {(vKit.items||[]).length} סוגים · {(vKit.items||[]).reduce((s,i)=>s+i.quantity,0)} יחידות</div>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  {(vKit.items||[]).map((item,j)=>{
                    const eq=equipment.find(e=>e.id==item.equipment_id);
                    return (
                      <div key={j} style={{display:"flex",alignItems:"center",gap:8,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"5px 10px"}}>
                        <span style={{fontSize:16}}>{eq?.image&&(eq.image.startsWith("data:")||eq.image.startsWith("http"))?<img src={cloudinaryThumb(eq.image)} alt="" style={{width:20,height:20,objectFit:"cover",borderRadius:4}}/>:(eq?.image||"📦")}</span>
                        <span style={{flex:1,fontSize:13,fontWeight:600}}>{eq?.name||item.name||"פריט"}</span>
                        <span style={{fontSize:13,fontWeight:700,color:"var(--accent)"}}>×{item.quantity}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Schedule */}
              {vDisplaySchedule.length > 0 && (
                <div>
                  <div style={{fontWeight:800,fontSize:13,color:"#9b59b6",marginBottom:8}}>📅 {vDisplaySchedule.length} מפגשים</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                    {vDisplaySchedule.map((s,i)=>(
                      <span key={i} style={{background:"rgba(155,89,182,0.1)",border:"1px solid rgba(155,89,182,0.25)",borderRadius:12,padding:"3px 10px",fontSize:12,color:"#9b59b6",fontWeight:600}}>
                        {formatDate(s.date)} {s.startTime||""}–{s.endTime||""}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Student kits list */}
      {mode===null&&(
        <>
        <div style={{fontWeight:900,fontSize:14,margin:"0 0 10px",color:"var(--accent)",display:"flex",alignItems:"center",gap:8}}>
          🎒 ערכות סטודנטים
          {studentKits.length>0&&<span style={{background:"var(--accent-glow)",border:"1px solid var(--accent)",borderRadius:20,padding:"1px 10px",fontSize:12,fontWeight:700,color:"var(--accent)"}}>{studentKits.length}</span>}
        </div>
        {studentKits.length===0
          ? <div className="empty-state"><div className="emoji">🎒</div><p>אין ערכות לסטודנטים</p><p style={{fontSize:13,color:"var(--text3)"}}>ערכות מוצגות בטופס ההשאלה</p></div>
          : <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {studentKits.map(kit=>(
              <div key={kit.id} onClick={()=>{setEditTarget(kit);setMode("viewStudent");}} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"14px 18px",cursor:"pointer",transition:"border-color 0.15s"}}
                onMouseEnter={e=>e.currentTarget.style.borderColor="var(--accent)"}
                onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}>
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
                  <div style={{display:"flex",gap:6}} onClick={e=>e.stopPropagation()}>
                    <button className="btn btn-secondary btn-sm" onClick={()=>{setEditTarget(kit);setMode("editStudent");}}>✏️ ערוך</button>
                    <button className="btn btn-danger btn-sm" onClick={()=>del(kit.id,kit.name)}>🗑️</button>
                  </div>
                </div>
                <div style={{marginTop:10,display:"flex",flexWrap:"wrap",gap:4}}>
                  {(kit.items||[]).map((i,j)=>{
                    const eq=equipment.find(e=>e.id==i.equipment_id);
                    return <span key={j} className="chip">
                      {eq?.image&&(eq.image.startsWith("data:")||eq.image.startsWith("http"))?<img src={cloudinaryThumb(eq.image)} alt="" style={{width:14,height:14,objectFit:"cover",borderRadius:2,verticalAlign:"middle"}}/>:<span>{eq?.image||"📦"}</span>}
                      {' '}{eq?.name||i.name} ×{i.quantity}
                    </span>;
                  })}
                </div>
              </div>
            ))}
          </div>}
        </>
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
                <div key={kit.id} onClick={()=>{setEditTarget(kit);setMode("viewLesson");}} style={{background:"var(--surface)",border:"1px solid rgba(155,89,182,0.3)",borderRadius:"var(--r)",padding:"16px 18px",cursor:"pointer",transition:"border-color 0.15s"}}
                  onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(155,89,182,0.6)"}
                  onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(155,89,182,0.3)"}>
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                    <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
                      <span style={{fontSize:28}}>🎬</span>
                      <div>
                        <div style={{fontWeight:800,fontSize:15}}>{kit.name}</div>
                        {linkedKitLessons.length>0&&<div style={{fontSize:11,color:"#9b59b6",marginTop:2}}>📚 משויך ל: {linkedKitLessons.map(l=>l.name).join(", ")}</div>}
                      {displayInstructorName&&<div style={{fontSize:12,color:"var(--text2)",marginTop:2}}>👨‍🏫 {displayInstructorName}{displayInstructorPhone?` · 📞 ${displayInstructorPhone}`:""}</div>}
                        {displayInstructorEmail&&<div style={{fontSize:11,color:"var(--text3)"}}>✉️ {displayInstructorEmail}</div>}
                        <div style={{marginTop:6,display:"flex",gap:6,flexWrap:"wrap"}}>
                          {displaySchedule.length>0&&<span style={{background:"rgba(155,89,182,0.15)",border:"1px solid rgba(155,89,182,0.35)",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#9b59b6",fontWeight:700}}>
                            📅 {displaySchedule.length} שיעורים
                          </span>}
                          {nextSession&&<span style={{background:"rgba(46,204,113,0.1)",border:"1px solid rgba(46,204,113,0.3)",borderRadius:20,padding:"2px 8px",fontSize:11,color:"var(--green)",fontWeight:700}}>
                            הבא: {formatDate(nextSession.date)} {nextSession.startTime}
                          </span>}
                        </div>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:6}} onClick={e=>e.stopPropagation()}>
                      <button className="btn btn-secondary btn-sm" onClick={()=>{setEditTarget(kit);setMode("editLesson");}}>✏️ ערוך</button>
                      <button className="btn btn-danger btn-sm" onClick={()=>del(kit.id,kit.name)}>🗑️</button>
                    </div>
                  </div>
                  <div style={{marginTop:10,display:"flex",flexWrap:"wrap",gap:4}}>
                    {(kit.items||[]).map((i,j)=>{
                      const eq=equipment.find(e=>e.id==i.equipment_id);
                      return <span key={j} className="chip">
                        {eq?.image&&(eq.image.startsWith("data:")||eq.image.startsWith("http"))?<img src={cloudinaryThumb(eq.image)} alt="" style={{width:14,height:14,objectFit:"cover",borderRadius:2,verticalAlign:"middle"}}/>:<span>{eq?.image||"📦"}</span>}
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
                <span style={{fontSize:20}}>{eq.image?.startsWith("data:")||eq.image?.startsWith("http") ? <img src={cloudinaryThumb(eq.image)} alt="" style={{width:24,height:24,objectFit:"cover",borderRadius:4}}/> : eq.image||"📦"}</span>
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
    const stu = students.find(s => s.id === stuId);
    if (!stu) return;
    const stuName = stu.name;
    const stuEmail = (stu.email || "").toLowerCase().trim();
    const updated = { types, students: students.filter(s=>s.id!==stuId) };
    if(await save(updated)) {
      // Cascade: delete studio bookings for this student
      const filteredBookings = studioBookings.filter(b => b.studentName !== stuName);
      if (filteredBookings.length !== studioBookings.length) {
        setStudioBookings(filteredBookings);
        await storageSet("studio_bookings", filteredBookings);
      }
      // Cascade: delete non-returned reservations for this student
      const filteredRes = reservations.filter(r => {
        if (r.status === "הוחזר") return true;
        const matchName = r.student_name === stuName;
        const matchEmail = stuEmail && (r.email || "").toLowerCase().trim() === stuEmail;
        return !(matchName || matchEmail);
      });
      if (filteredRes.length !== reservations.length) {
        setReservations(filteredRes);
        await storageSet("reservations", filteredRes);
      }
      showToast("success","הסטודנט הוסר");
    }
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
      // Atomic RPC (migration 009). Fixes concurrent-admin race + counter drift.
      const returnedAt = newStatus === "הוחזר" ? new Date().toISOString() : null;
      const rpcResult = await updateReservationStatus(r.id, newStatus, { returned_at: returnedAt });
      if (!rpcResult.ok) {
        console.error("ManagerCalendar changeStatus RPC failed:", rpcResult);
        setChangingStatus(null);
        return;
      }
      const allRes = await storageGet("reservations");
      const fresh = Array.isArray(allRes) ? allRes : ((allRes && allRes.value) || []);
      const updated = fresh.map(x => x.id===r.id ? {...x, status:newStatus} : x);
      setLocalRes(prev => prev.map(x => x.id===r.id ? {...x, status:newStatus} : x));
      if(setReservations) setReservations(updated);
      setSelected(null);
      storageSet("reservations", updated).catch(err =>
        console.warn("blob cache refresh failed (DB is already updated):", err)
      );
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
function SettingsPage({ siteSettings, setSiteSettings, showToast, settingsRole = "administration" }) {
  const colorKey = settingsRole === "warehouse" ? "warehouseAccentColor" : "adminAccentColor";
  const fontKey  = settingsRole === "warehouse" ? "warehouseFontSize"   : "adminFontSize";
  const [draft, setDraft] = useState({ ...siteSettings });
  const [saving, setSaving] = useState(false);

  const toggleTheme = (theme) => {
    setDraft(p => ({ ...p, theme }));
    document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "");
  };

  const save = async () => {
    setSaving(true);
    setSiteSettings(draft);
    try { localStorage.setItem("cache_siteSettings", JSON.stringify(draft)); } catch {}
    try { const tc=document.getElementById("theme-color-meta"); if(tc&&draft.accentColor) tc.setAttribute("content",draft.accentColor); } catch {}
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

      {/* Accent Color + Font Size */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><div className="card-title">🖥️ בחירת צבע לחצנים / טקסט לוח בקרה</div></div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 14 }}>
            הצבע יוחל על הלחצנים, הכותרות והטקסטים הצבעוניים בלוח בקרה זה בלבד.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
            <input type="color" value={draft[colorKey] || "#f5a623"}
              onChange={e => setDraft(p => ({ ...p, [colorKey]: e.target.value }))}
              style={{ width: 52, height: 40, borderRadius: 8, border: "2px solid var(--border)", background: "none", cursor: "pointer", padding: 2 }} />
            <span style={{ fontSize: 13, color: "var(--text2)", fontFamily: "monospace" }}>{draft[colorKey] || "#f5a623"}</span>
            <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }}
              onClick={() => setDraft(p => ({ ...p, [colorKey]: "#f5a623" }))}>
              ↩ איפוס לברירת מחדל
            </button>
          </div>
          <div style={{ borderTop: "1px solid var(--border)", marginBottom: 16 }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 10 }}>גודל פונט (דסקטופ בלבד)</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <input type="range" min={11} max={20} step={1}
              value={draft[fontKey] || 14}
              onChange={e => setDraft(p => ({ ...p, [fontKey]: Number(e.target.value) }))}
              style={{ width: 180, accentColor: draft[colorKey] || "#f5a623" }} />
            <span style={{ fontSize: 14, fontWeight: 700, minWidth: 32, color: "var(--text2)" }}>{draft[fontKey] || 14}px</span>
            <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }}
              onClick={() => setDraft(p => ({ ...p, [fontKey]: 14 }))}>
              ↩ איפוס
            </button>
          </div>
          <div style={{ marginTop: 14, padding: "12px 16px", borderRadius: 8, background: "var(--surface2)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>תצוגה מקדימה:</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: draft[fontKey] || 14 }}>
              <button type="button" style={{ background: draft[colorKey] || "#f5a623", color: "#0a0c10", border: "none", borderRadius: 8, padding: "8px 18px", fontWeight: 800, cursor: "default", fontSize: "inherit" }}>כפתור לדוגמה</button>
              <span style={{ color: draft[colorKey] || "#f5a623", fontWeight: 800, fontSize: "inherit" }}>טקסט צבעוני</span>
            </div>
          </div>
        </div>
      </div>

      {/* XL Templates — administration only */}
      {settingsRole === "administration" && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><div className="card-title">📥 טמפלטים להורדה — ייבוא מקובץ XL</div></div>
          <div style={{ padding: "16px 20px" }}>
            <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 16, lineHeight: 1.7 }}>
              הורד את הטמפלטים האלו כדי להבין את המבנה הנכון לייבוא נתונים מקובץ Excel.
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-secondary" onClick={downloadLessonsTemplate}
                style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18 }}>📗</span>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 800, fontSize: 13 }}>טמפלט העלאת קורסים</div>
                  <div style={{ fontSize: 11, color: "var(--text3)" }}>מבנה לייבוא שיעורים / קורסים</div>
                </div>
              </button>
              <button type="button" className="btn btn-secondary" onClick={downloadStudentsTemplate}
                style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18 }}>📘</span>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 800, fontSize: 13 }}>טמפלט ייבוא סטודנטים</div>
                  <div style={{ fontSize: 11, color: "var(--text3)" }}>מבנה לייבוא רשימת סטודנטים</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      <button className="btn btn-primary" disabled={saving} onClick={save} style={{ fontSize: 15, padding: "12px 32px" }}>
        {saving ? "⏳ שומר..." : "💾 שמור הגדרות"}
      </button>
    </div>
  );
}

// ── Template download helpers ─────────────────────────────────────────────────
const COURSES_TEMPLATE_B64 = "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";
const STUDENTS_TEMPLATE_B64 = "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";

function downloadXlsxTemplate(b64, filename) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function downloadLessonsTemplate() { downloadXlsxTemplate(COURSES_TEMPLATE_B64, 'טמפלט_העלאת_קורסים.xlsx'); }
function downloadStudentsTemplate() { downloadXlsxTemplate(STUDENTS_TEMPLATE_B64, 'טמפלט_ייבוא_סטודנטים.xlsx'); }

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
                  {isImg ? <img src={cloudinaryThumb(eq.image)} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}}/> : <span style={{fontSize:28}}>{eq.image||"📦"}</span>}
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

// StaffLogin removed — unified login is handled by PublicForm on /

// ─── הפניה חזרה לאדמין בלחיצה על כפתור "חזרה" בדפדפן ─────────────────────
(function redirectAdminOnBack() {
  const currentPath = window.location.pathname;
  if (currentPath.startsWith("/admin")) return;
  const savedAdmin = sessionStorage.getItem("admin_redirect");
  if (!savedAdmin) return;
  const navEntry = (performance?.getEntriesByType?.("navigation") ?? [])[0];
  const isBackForward = navEntry?.type === "back_forward" ||
                        performance?.navigation?.type === 2;
  if (isBackForward) {
    window.location.replace("/admin");
  }
})();


// ─── PROTECTED ROUTE ──────────────────────────────────────────────────────────
// Wraps admin-only content. /admin/login is always accessible (it's the login page itself).
function ProtectedRoute({ children }) {
  return children;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

export default function App() {
  const pathname = window.location.pathname;
  const isAdmin = pathname.startsWith("/admin");
  const isCalendarView = pathname.startsWith("/calendar");
  const isManagerCalendarView = pathname.startsWith("/manager-calendar");
  const isPublicDisplayView = pathname === "/daily";
  const isPublicDailyTableView = pathname === "/daily-table";
  const isLecturerPortalView = pathname.startsWith("/lecturer");
  const isPublicFormView = !isAdmin && !isCalendarView && !isManagerCalendarView && !isPublicDisplayView && !isPublicDailyTableView && !isLecturerPortalView;
  const urlToken = new URLSearchParams(window.location.search).get("token")||"";
  const { canInstall: canInstallPwa, install: installPwa } = useInstallPrompt();
  const [page, setPage]               = useState(() => sessionStorage.getItem("admin_page") || "dashboard");
  const [equipment, _setEquipment]     = useState([]);
  const [reservations, _setReservations] = useState([]);
  const [categories, _setCategories]   = useState(DEFAULT_CATEGORIES);
  const [categoryTypes, _setCategoryTypes] = useState({});
  const [categoryLoanTypes, _setCategoryLoanTypes] = useState({});
  const [teamMembers, _setTeamMembers] = useState([]);
  const [deptHeads, _setDeptHeads]       = useState([]);
  const [collegeManager, _setCollegeManager] = useState({ name:"", email:"" });
  const [managerToken, setManagerToken]   = useState("");
  const [kits, _setKits]               = useState([]);
  const [policies, _setPolicies]       = useState({ פרטית:"", הפקה:"", סאונד:"", לילה:"" });
  const [certifications, _setCertifications] = useState({ types:[], students:[] });
  const [siteSettings, _setSiteSettings] = useState({ logo:"", soundLogo:"", theme:"dark", accentColor:"#f5a623", adminAccentColor:"#f5a623", adminFontSize:14, aiMaxRequests:5, studioFutureHoursLimit:16, publicDisplayInterval:18 });
  const [studios, _setStudios] = useState([]);
  const [studioBookings, _setStudioBookings] = useState([]);
  const [lessons, _setLessons] = useState([]);
  const [lecturers, _setLecturers] = useState([]);
  const [equipmentReports, setEquipmentReports] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [loadingDone, setLoadingDone] = useState(false);
  const handleLoadingDone = () => setLoadingDone(true);
  const [toasts, setToasts]           = useState([]);
  // Staff auth: unified login (Supabase session + public.users)
  const [staffUser, setStaffUser] = useState(() => {
    try { const s = sessionStorage.getItem("staff_user"); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const [staffAuthChecked, setStaffAuthChecked] = useState(() => {
    // If we already have staffUser from sessionStorage, no need to wait
    try { return !!sessionStorage.getItem("staff_user"); } catch { return false; }
  });
  // Recover staffUser from Supabase session if sessionStorage was cleared
  useEffect(() => {
    if (!isAdmin || staffUser) return;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user?.id) { setStaffAuthChecked(true); return; }
      const { data: userRow } = await supabase
        .from("users")
        .select("id,full_name,email,is_student,is_lecturer,is_warehouse,is_admin,permissions")
        .eq("id", session.user.id)
        .single();
      if (!userRow || (!userRow.is_admin && !userRow.is_warehouse)) { setStaffAuthChecked(true); return; }
      const recovered = {
        id: userRow.id,
        full_name: userRow.full_name,
        email: userRow.email,
        role: userRow.is_admin ? "admin" : "staff",
        permissions: userRow.permissions || {},
        is_admin: userRow.is_admin,
        is_warehouse: userRow.is_warehouse,
        is_student: userRow.is_student,
        is_lecturer: userRow.is_lecturer,
      };
      setStaffUser(recovered);
      setStaffAuthChecked(true);
      logActivity({ user_id: recovered.id, user_name: recovered.full_name, action: "login", entity: "session", details: { email: recovered.email, method: "session_recovery" } });
    }).catch(() => setStaffAuthChecked(true));
  }, []);
  const [staffView, setStaffView] = useState(() => sessionStorage.getItem("staff_view") || "hub"); // hub | warehouse | administration | staff-management
  const authed = !!staffUser;
  const isMainAdmin = isAdmin && authed;
  // Compat aliases for warehouse/secretary page navigation
  const [secretaryPage, setSecretaryPage] = useState(() => sessionStorage.getItem("secretary_page") || "dashboard");
  const [editLessonId, setEditLessonId] = useState(null);
  const [warehousePage, setWarehousePage] = useState(() => sessionStorage.getItem("warehouse_page") || "dashboard");
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
  const studiosRef = useRef(studios);
  const studioBookingsRef = useRef(studioBookings);
  const lessonsRef = useRef(lessons);
  const lecturersRef = useRef(lecturers);
  const historySuspendedRef = useRef(true);
  const historyQueuedRef = useRef(false);
  const undoInFlightRef = useRef(false);
  const refreshAbortRef = useRef(null);
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
  studiosRef.current = studios;
  studioBookingsRef.current = studioBookings;
  lessonsRef.current = lessons;
  lecturersRef.current = lecturers;

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

      applyPublicLiveSync("equipment", eqR);
      applyPublicLiveSync("reservations", resR);
      applyPublicLiveSync("categories", catsR);
      applyPublicLiveSync("categoryLoanTypes", catLoanTypesR);

      return {
        equipment: Array.isArray(eqR)
          ? normalizeEquipmentTagFlags(eqR).map(ensureUnits)
          : equipmentRef.current,
        reservations: Array.isArray(resR)
          ? normalizeReservationsForArchive(resR)
          : reservationsRef.current,
        categories: Array.isArray(catsR) ? catsR : categoriesRef.current,
        categoryLoanTypes: catLoanTypesR && typeof catLoanTypesR === "object" && !Array.isArray(catLoanTypesR)
          ? catLoanTypesR
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

  const applyLecturerLiveSync = (key, value) => {
    if (key === "equipment" && Array.isArray(value)) {
      const normalizedEquipment = normalizeEquipmentTagFlags(value).map(ensureUnits);
      if (!dataEquals(equipmentRef.current, normalizedEquipment)) _setEquipment(normalizedEquipment);
      return;
    }

    if (key === "reservations" && Array.isArray(value)) {
      const normalizedReservations = normalizeReservationsForArchive(value);
      if (!dataEquals(reservationsRef.current, normalizedReservations)) _setReservations(normalizedReservations);
      return;
    }

    if (key === "lessons" && Array.isArray(value) && !dataEquals(lessonsRef.current, value)) {
      _setLessons(value);
      return;
    }

    if (key === "lecturers" && Array.isArray(value) && !dataEquals(lecturersRef.current, value)) {
      _setLecturers(value);
      return;
    }

    if (key === "kits" && Array.isArray(value) && !dataEquals(kitsRef.current, value)) {
      _setKits(value);
      return;
    }

    if (key === "studios" && Array.isArray(value) && !dataEquals(studiosRef.current, value)) {
      _setStudios(value);
    }
  };

  const refreshLecturerData = async () => {
    try {
      const [eqR, resR, lessonsR, lecturersR, kitsR, studiosR] = await Promise.all([
        storageGet("equipment"),
        storageGet("reservations"),
        storageGet("lessons"),
        storageGet("lecturers"),
        storageGet("kits"),
        storageGet("studios"),
      ]);

      applyLecturerLiveSync("equipment", eqR?.value);
      applyLecturerLiveSync("reservations", resR?.value);
      applyLecturerLiveSync("lessons", lessonsR?.value);
      applyLecturerLiveSync("lecturers", lecturersR?.value);
      applyLecturerLiveSync("kits", kitsR?.value);
      applyLecturerLiveSync("studios", studiosR?.value);
    } catch (error) {
      console.warn("lecturer portal sync failed", error);
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
    studios: safeClone(studiosRef.current),
    studioBookings: safeClone(studioBookingsRef.current),
    lessons: safeClone(lessonsRef.current),
    lecturers: safeClone(lecturersRef.current),
  });



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
  const setStudios = createTrackedSetter(_setStudios);
  const setStudioBookings = createTrackedSetter(_setStudioBookings);
  const setLessons = createTrackedSetter(_setLessons);
  const setLecturers = createTrackedSetter(_setLecturers);

  const fetchEquipmentReports = async () => {
    try { const r = await fetch("/api/equipment-report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"list"})}); const d = await r.json(); if(Array.isArray(d)) setEquipmentReports(d); } catch {}
  };

  const showToast = (type, msg) => {
    const id = Date.now();
    setToasts(p=>[...p,{id,type,msg}]);
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)), 3500);
  };

  const attachLogIdToUndo = (logId) => {
    if (!logId) return;
    setUndoStack(prev => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      if (last.logId) return prev;
      return [...prev.slice(0, -1), { ...last, logId }];
    });
  };

  const deleteActivityLog = async (logId) => {
    try {
      await fetch("/api/activity-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: logId }),
      });
    } catch {}
  };

  const handleUndo = async () => {
    const lastEntry = undoStack[undoStack.length - 1];
    if (!lastEntry || undoInFlightRef.current) return;
    undoInFlightRef.current = true;
    historySuspendedRef.current = true;
    try {
      const snapshot = lastEntry.snapshot;
      const currentState = getUndoSnapshot();

      const keysToUpdate = [
        "equipment", "reservations", "categories", "categoryTypes", "categoryLoanTypes",
        "teamMembers", "deptHeads", "collegeManager", "kits", "policies",
        "certifications", "siteSettings", "studios", "studioBookings", "lessons", "lecturers"
      ];
      
      const promises = [];
      for (const key of keysToUpdate) {
        if (snapshot[key] !== undefined && !dataEquals(currentState[key], snapshot[key])) {
          promises.push(storageSet(key, snapshot[key]));
        }
      }

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
      if (snapshot.studios) _setStudios(snapshot.studios);
      if (snapshot.studioBookings) _setStudioBookings(snapshot.studioBookings);
      if (snapshot.lessons) _setLessons(snapshot.lessons);
      if (snapshot.lecturers) _setLecturers(snapshot.lecturers);

      let ok = true;
      if (promises.length > 0) {
        const results = await Promise.all(promises);
        ok = results.every((r) => r?.ok);
      }

      if (ok && lastEntry.logId) deleteActivityLog(lastEntry.logId);
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

  // ─── שמירת מצב התחברות ודף ב-sessionStorage ────────────────────────────────
  useEffect(() => {
    if (staffUser) {
      sessionStorage.setItem("staff_user", JSON.stringify(staffUser));
    } else {
      sessionStorage.removeItem("staff_user");
      sessionStorage.removeItem("staff_view");
      sessionStorage.removeItem("admin_page");
      sessionStorage.removeItem("secretary_page");
      sessionStorage.removeItem("warehouse_page");
    }
  }, [staffUser]);

  useEffect(() => {
    if (!authed) return;
    sessionStorage.setItem("staff_view", staffView);
  }, [staffView, authed]);

  useEffect(() => {
    if (!authed) return;
    sessionStorage.setItem("admin_page", page);
  }, [page, authed]);

  useEffect(() => {
    if (!authed) return;
    sessionStorage.setItem("secretary_page", secretaryPage);
  }, [secretaryPage, authed]);

  useEffect(() => {
    if (!authed) return;
    sessionStorage.setItem("warehouse_page", warehousePage);
  }, [warehousePage, authed]);

  // ─── שמור נתיב האדמין לצורך הפניה חזרה בלחיצת "חזרה" ─────────────────────
  useEffect(() => {
    if (isAdmin) sessionStorage.setItem("admin_redirect", pathname);
  }, []);

  // ─── טיימר חוסר פעילות — 20 דקות ───────────────────────────────────────
  useEffect(() => {
    if (!isAdmin || !authed) return;
    const TIMEOUT_MS = 20 * 60 * 1000;
    const doLogout = async () => {
      await supabase.auth.signOut().catch(()=>{});
      sessionStorage.removeItem("staff_user");
      sessionStorage.removeItem("staff_view");
      sessionStorage.removeItem("active_role");
      window.location.replace("/");
    };
    let timer = setTimeout(doLogout, TIMEOUT_MS);
    const reset = () => { clearTimeout(timer); timer = setTimeout(doLogout, TIMEOUT_MS); };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    return () => { clearTimeout(timer); events.forEach(e => window.removeEventListener(e, reset)); };
  }, [authed]);

  useEffect(()=>{
    (async()=>{
        try {
          historySuspendedRef.current = true;
          const [eqR, resR, catsR, catTypesR, catLoanTypesR, tmR, ktsR, polR, certsR, dhsR, mgrR, mgrTokR, siteSetR, studiosR, studioBkR, lessonsR, lecturersR] = await Promise.all([
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
          storageGet("collegeManager"),
          storageGet("managerToken"),
          storageGet("siteSettings"),
          storageGet("studios"),
          storageGet("studio_bookings"),
          storageGet("lessons"),
          storageGet("lecturers"),
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
        _setPolicies(pol || { פרטית:"", הפקה:"", סאונד:"", לילה:"" });
        _setCertifications(certs || { types:[], students:[] });
        _setDeptHeads(Array.isArray(dhs) ? dhs : []);
        _setCollegeManager(mgr || { name:"", email:"" });
          setManagerToken(mgrTok || "");
        _setStudios(Array.isArray(stds) ? stds : []);
        _setStudioBookings(Array.isArray(stdBk) ? stdBk : []);
        const lsns = Array.isArray(lessonsR.value) ? lessonsR.value : [];
        _setLessons(lsns);
        let loadedLecturers = Array.isArray(lecturersR.value) ? lecturersR.value : [];

        // ── Sync: extract lecturers from existing lessons that aren't in the lecturers list yet ──
        const existingNames = new Set(loadedLecturers.map(l => String(l.fullName || "").trim().toLowerCase()));
        const newLecturers = [];
        const updatedLessons = [];
        let lessonsChanged = false;
        for (const lesson of lsns) {
          const name = String(lesson.instructorName || "").trim();
          if (!name) { updatedLessons.push(lesson); continue; }
          const nameLower = name.toLowerCase();
          if (!existingNames.has(nameLower)) {
            const lec = makeLecturer({
              fullName: name,
              phone: String(lesson.instructorPhone || "").trim(),
              email: String(lesson.instructorEmail || "").trim(),
            });
            newLecturers.push(lec);
            existingNames.add(nameLower);
            updatedLessons.push({ ...lesson, lecturerId: lec.id });
            lessonsChanged = true;
          } else if (!lesson.lecturerId) {
            const matched = [...loadedLecturers, ...newLecturers].find(l => String(l.fullName || "").trim().toLowerCase() === nameLower);
            if (matched) { updatedLessons.push({ ...lesson, lecturerId: matched.id }); lessonsChanged = true; }
            else updatedLessons.push(lesson);
          } else {
            updatedLessons.push(lesson);
          }
        }
        if (newLecturers.length > 0) {
          loadedLecturers = [...loadedLecturers, ...newLecturers];
          await storageSet("lecturers", loadedLecturers);
        }
        if (lessonsChanged) {
          _setLessons(updatedLessons);
          await storageSet("lessons", updatedLessons);
        }
        _setLecturers(loadedLecturers);
          const loadedSettings = siteSet || { logo:"", theme:"dark" };
        _setSiteSettings(loadedSettings);
        try { localStorage.setItem("cache_siteSettings", JSON.stringify(loadedSettings)); } catch {}
        if(loadedSettings.theme==="light") document.documentElement.setAttribute("data-theme","light");
        try { const tc=document.getElementById("theme-color-meta"); if(tc&&loadedSettings.accentColor) tc.setAttribute("content",loadedSettings.accentColor); } catch {}

        // ─── SAFE INIT: only write defaults when DB confirmed the key doesn't exist ───
        // "supabase_empty" = DB responded OK but row missing → safe to initialize
        // "cache" = network failed, fell back to localStorage → NEVER overwrite DB
        if(!eq && eqSrc === "supabase_empty") await storageSet("equipment", normalizedEquipment);
        if(!res && resSrc === "supabase_empty")  await storageSet("reservations", []);
        if(!cats && catsSrc === "supabase_empty") await storageSet("categories",   DEFAULT_CATEGORIES);
        if(!tm && tmSrc === "supabase_empty")   await storageSet("teamMembers",  []);
        if(!kts && ktsSrc === "supabase_empty")  await storageSet("kits",         []);
        if(!pol && polSrc === "supabase_empty")   await storageSet("policies",        { פרטית:"", הפקה:"", סאונד:"", לילה:"" });
        if(!certs && certsSrc === "supabase_empty") await storageSet("certifications", { types:[], students:[] });
        if(!dhs && dhsSrc === "supabase_empty")     await storageSet("deptHeads",       []);
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

  useEffect(() => { if (!loading && !isPublicFormView) fetchEquipmentReports(); },[loading]);

  const refreshAdminData = async () => {
    if (historySuspendedRef.current) return false;
    // ביטול קריאה קודמת שעדיין רצה
    refreshAbortRef.current?.abort();
    const ctrl = new AbortController();
    refreshAbortRef.current = ctrl;
    try {
      const [resR, bookingsR, lecturersR, certsR] = await Promise.all([
        storageGet("reservations", ctrl.signal),
        storageGet("studio_bookings", ctrl.signal),
        storageGet("lecturers", ctrl.signal),
        storageGet("certifications", ctrl.signal),
      ]);
      if (ctrl.signal.aborted) return false;
      if (Array.isArray(resR?.value)) {
        const normalized = normalizeReservationsForArchive(resR.value);
        if (!dataEquals(reservationsRef.current, normalized)) _setReservations(normalized);
      }
      if (Array.isArray(bookingsR?.value) && !dataEquals(studioBookingsRef.current, bookingsR.value)) {
        _setStudioBookings(bookingsR.value);
      }
      if (Array.isArray(lecturersR?.value) && !dataEquals(lecturersRef.current, lecturersR.value)) {
        _setLecturers(lecturersR.value);
      }
      // Pick up student-self-service updates made via PublicForm's Account Settings
      // modal (which writes certifications.students[] via /api/auth action
      // "update-student-credentials"). Also catches remote admin edits.
      if (certsR?.value && typeof certsR.value === "object" && !dataEquals(certificationsRef.current, certsR.value)) {
        _setCertifications(certsR.value);
      }
      // Return true if at least one response came from supabase (network is up)
      return [resR, bookingsR, lecturersR, certsR].some(r => r?.source === "supabase");
    } catch { return false; }
  };

  useEffect(() => {
    if (loading || isPublicFormView || isLecturerPortalView) return;
    // Debounce rapid focus/visibility events to prevent back-to-tab flicker
    let focusDebounce = null;
    const triggerRefresh = () => {
      clearTimeout(focusDebounce);
      focusDebounce = setTimeout(() => void refreshAdminData(), 500);
    };
    const handleFocus = () => triggerRefresh();
    const handleVisibility = () => { if (document.visibilityState === "visible") triggerRefresh(); };
    // Poll with exponential backoff: 3 min base, doubles on failure, max 15 min
    const BASE_POLL = 180000;
    const MAX_POLL  = 900000;
    let pollDelay = BASE_POLL;
    let pollTimerId;
    const poll = async () => {
      if (document.visibilityState !== "hidden") {
        const ok = await refreshAdminData();
        pollDelay = ok ? BASE_POLL : Math.min(pollDelay * 2, MAX_POLL);
      }
      pollTimerId = setTimeout(poll, pollDelay);
    };
    pollTimerId = setTimeout(poll, BASE_POLL);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      clearTimeout(focusDebounce);
      clearTimeout(pollTimerId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      refreshAbortRef.current?.abort();
    };
  }, [loading, isPublicFormView, isLecturerPortalView]);

  // ── Supabase realtime listener on the `store` table ────────────────────────
  // Live-sync certifications (and the rest of the store keys we care about)
  // into local state the instant anyone — the admin in another tab, another
  // admin on another machine, or a student self-updating their own profile
  // via PublicForm's Account Settings modal — writes to the store. This is
  // what drives the Students page in the secretary panel updating in real
  // time when a logged-in student changes their name / email / phone.
  //
  // The publication `supabase_realtime` was granted SELECT on public.store
  // via a server-side migration; without that the subscribe() below returns
  // CLOSED / TIMED_OUT and no events fire.
  useEffect(() => {
    if (loading || isPublicFormView || isLecturerPortalView) return undefined;
    const channel = supabase
      .channel("store-live-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "store" },
        (payload) => {
          try {
            const row = payload.new || payload.old;
            const key = row?.key;
            const data = payload.new?.data;
            if (!key || data === undefined) return;
            if (key === "certifications") {
              if (typeof data === "object" && data !== null &&
                  !dataEquals(certificationsRef.current, data)) {
                _setCertifications(data);
              }
            } else if (key === "reservations") {
              if (Array.isArray(data)) {
                const normalized = normalizeReservationsForArchive(data);
                if (!dataEquals(reservationsRef.current, normalized)) {
                  _setReservations(normalized);
                }
              }
            } else if (key === "studio_bookings") {
              if (Array.isArray(data) && !dataEquals(studioBookingsRef.current, data)) {
                _setStudioBookings(data);
              }
            } else if (key === "lecturers") {
              if (Array.isArray(data) && !dataEquals(lecturersRef.current, data)) {
                _setLecturers(data);
              }
            }
          } catch (err) {
            console.warn("store realtime payload handler failed", err);
          }
        },
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("store realtime channel:", status);
        }
      });
    return () => {
      try { supabase.removeChannel(channel); } catch {}
    };
  }, [loading, isPublicFormView, isLecturerPortalView]);

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
    // Poll every 60s (was 10s — major Disk IO savings; realtime handles live updates)
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refreshPublicInventory();
    }, 60000);

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
    if (loading || !isLecturerPortalView) return undefined;

    const handleFocus = () => {
      void refreshLecturerData();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshLecturerData();
      }
    };

    const handleStorage = (event) => {
      if (event.storageArea !== window.localStorage || !event.key?.startsWith("cache_")) return;
      const key = event.key.replace(/^cache_/, "");
      if (!["equipment", "reservations", "lessons", "lecturers", "kits", "studios"].includes(key)) return;
      try {
        const parsedValue = event.newValue ? JSON.parse(event.newValue) : null;
        applyLecturerLiveSync(key, parsedValue);
      } catch (error) {
        console.warn("lecturer cache sync failed", error);
        void refreshLecturerData();
      }
    };

    void refreshLecturerData();
    // Poll every 60s (was 10s — major Disk IO savings)
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refreshLecturerData();
    }, 60000);

    window.addEventListener("focus", handleFocus);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loading, isLecturerPortalView]);

  useEffect(() => {
    if (loading) return;
    // Use refs for current reservations/studioBookings so this effect only
    // fires when lessons or kits change — NOT on every reservation write.
    // This breaks the feedback loop: effect → _setReservations → effect → …
    const currentReservations = reservationsRef.current;
    const currentStudioBookings = studioBookingsRef.current;

    const { reservations: generatedLessonReservations, linkedKitIds } = buildLessonReservations(lessons, kits);

    // Safety guard: if we currently have lesson-auto reservations but the new generation
    // produced nothing (0 results) while lessons still exist — something is transiently wrong
    // (e.g. kits items temporarily 0 during a mid-save state update). Skip this run entirely
    // rather than wiping all lesson reservations from memory and Supabase.
    const currentLessonAutoCount = currentReservations.filter(
      (r) => r.lesson_auto || hasLinkedValue(r.lesson_id)
    ).length;
    if (lessons.length > 0 && kits.length > 0 && generatedLessonReservations.length === 0 && currentLessonAutoCount > 0) {
      return; // transient empty generation — preserve existing lesson reservations
    }

    const nextReservations = normalizeReservationsForArchive([
      ...currentReservations.filter((reservation) => {
        if (reservation.lesson_auto || hasLinkedValue(reservation.lesson_id)) return false;
        if (hasLinkedValue(reservation.lesson_kit_id) && linkedKitIds.has(String(reservation.lesson_kit_id))) return false;
        return true;
      }),
      ...generatedLessonReservations,
    ]);

    if (!dataEquals(nextReservations, currentReservations)) {
      _setReservations(nextReservations);
      void storageSet("reservations", nextReservations);
    }

    const generatedLessonBookings = buildLessonStudioBookings(lessons);
    const nextStudioBookings = [
      ...currentStudioBookings.filter((booking) => !(booking.lesson_auto || hasLinkedValue(booking.lesson_id))),
      ...generatedLessonBookings,
    ];

    if (!dataEquals(nextStudioBookings, currentStudioBookings)) {
      _setStudioBookings(nextStudioBookings);
      void storageSet("studio_bookings", nextStudioBookings);
    }
  }, [loading, lessons, kits]); // intentionally excludes reservations/studioBookings

  useEffect(() => {
    if (loading) return undefined;
    const syncArchivedReservations = () => {
      _setReservations((currentReservations) => {
        const normalizedReservations = normalizeReservationsForArchive(currentReservations);
        if (normalizedReservations.length === currentReservations.length && dataEquals(normalizedReservations, currentReservations)) {
          return currentReservations;
        }
        void storageSet("reservations", normalizedReservations);
        return normalizedReservations;
      });
    };
    // Sync every 5 min (was 60s) — archiving is not time-sensitive
    const timerId = window.setInterval(syncArchivedReservations, 300000);
    return () => window.clearInterval(timerId);
  }, [loading]);

  // ── Auto-send overdue email 30 minutes after return time ──
  const overdueInFlightRef = useRef(false);
  useEffect(() => {
    if (loading) return;
    const checkOverdueEmails = async () => {
      if (overdueInFlightRef.current) return; // prevent concurrent stacking
      overdueInFlightRef.current = true;
      try {
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
        const ac = new AbortController();
        const tid = setTimeout(() => ac.abort(), 15000);
        for (const r of toSend) {
          if (ac.signal.aborted) break;
          try {
            await fetch("/api/send-email", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: ac.signal,
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
        clearTimeout(tid);
        // Mark as sent
        const sentIds = new Set(toSend.map(r => r.id));
        const updated = reservations.map(r => sentIds.has(r.id) ? { ...r, overdue_email_sent: true } : r);
        _setReservations(updated);
        await storageSet("reservations", updated);
      } finally {
        overdueInFlightRef.current = false;
      }
    };
    const t = setTimeout(checkOverdueEmails, 90000); // first check after 90s
    const i = setInterval(checkOverdueEmails, 15 * 60 * 1000); // then every 15 min
    return () => { clearTimeout(t); clearInterval(i); };
  }, [loading, reservations]);

  const pending = reservations.filter(r=>r.status==="ממתין").length;
  const damagedCount = equipment.reduce((sum, eq) =>
    sum + (Array.isArray(eq.units) ? eq.units.filter(u=>u.status!=="תקין").length : 0), 0);
  const deptHeadPending = reservations.filter(r=>r.status==="אישור ראש מחלקה").length;
  const overdueCount = reservations.filter(r=>r.status==="באיחור").length;
  const rejectedCount = reservations.filter(r=>r.status==="נדחה").length;
  const rejected = rejectedCount + overdueCount;
  const pageTitle = { dashboard:"לוח בקרה", equipment:"ציוד מחסן", reservations:"ניהול בקשות", team:"פרטי צוות", kits:"ערכות", lessons:"שיעורים", policies:"נהלים", certifications:"הסמכת ציוד", students:"ניהול סטודנטים", settings:"הגדרות", studios:"לוח חדרים" };

  const handleSwipeTouchStart = (e) => {
    swipeTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, target: e.target };
  };
  const handleSwipeTouchEnd = (e) => {
    if (!swipeTouchRef.current) return;
    const dx = e.changedTouches[0].clientX - swipeTouchRef.current.x;
    const dy = e.changedTouches[0].clientY - swipeTouchRef.current.y;
    const startTarget = swipeTouchRef.current.target;
    swipeTouchRef.current = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    // Block page swipe only if touch started inside a scrollable container that actually has horizontal overflow
    const scrollEl = startTarget?.closest?.('.no-swipe-nav');
    if (scrollEl && scrollEl.scrollWidth > scrollEl.clientWidth) return;
    const idx = ADMIN_NAV_PAGES.indexOf(page);
    if (idx === -1) return;
    if (dx < 0 && idx < ADMIN_NAV_PAGES.length - 1) setPage(ADMIN_NAV_PAGES[idx + 1]);
    else if (dx > 0 && idx > 0) setPage(ADMIN_NAV_PAGES[idx - 1]);
  };
  const handleSecretarySwipeTouchEnd = (e) => {
    if (!swipeTouchRef.current) return;
    const dx = e.changedTouches[0].clientX - swipeTouchRef.current.x;
    const dy = e.changedTouches[0].clientY - swipeTouchRef.current.y;
    const startTarget = swipeTouchRef.current.target;
    swipeTouchRef.current = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    const scrollEl = startTarget?.closest?.('.no-swipe-nav');
    if (scrollEl && scrollEl.scrollWidth > scrollEl.clientWidth) return;
    const idx = SECRETARY_NAV_PAGES.indexOf(secretaryPage);
    if (idx === -1) return;
    if (dx < 0 && idx < SECRETARY_NAV_PAGES.length - 1) setSecretaryPage(SECRETARY_NAV_PAGES[idx + 1]);
    else if (dx > 0 && idx > 0) setSecretaryPage(SECRETARY_NAV_PAGES[idx - 1]);
  };
  const handleWarehouseSwipeTouchEnd = (e) => {
    if (!swipeTouchRef.current) return;
    const dx = e.changedTouches[0].clientX - swipeTouchRef.current.x;
    const dy = e.changedTouches[0].clientY - swipeTouchRef.current.y;
    const startTarget = swipeTouchRef.current.target;
    swipeTouchRef.current = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    const scrollEl = startTarget?.closest?.('.no-swipe-nav');
    if (scrollEl && scrollEl.scrollWidth > scrollEl.clientWidth) return;
    const idx = WAREHOUSE_NAV_PAGES.indexOf(page);
    if (idx === -1) return;
    if (dx < 0 && idx < WAREHOUSE_NAV_PAGES.length - 1) setPage(WAREHOUSE_NAV_PAGES[idx + 1]);
    else if (dx > 0 && idx > 0) setPage(WAREHOUSE_NAV_PAGES[idx - 1]);
  };

  return (
    <>
      <style>{css}</style>

      {/* ── דף לוז יומי ציבורי ── */}
      {isPublicDisplayView && <PublicDisplayPage/>}

      {/* ── דף לוז יומי ציבורי בפורמט טבלה ── */}
      {isPublicDailyTableView && <PublicDailyTablePage/>}

      {/* ── טופס ציבורי ── */}
      {isManagerCalendarView ? (
        <div style={{minHeight:"100vh",background:"var(--bg)",direction:"rtl"}}>
          {!loadingDone ? <Loading ready={!loading} accentColor={siteSettings.accentColor} onDone={handleLoadingDone}/> : (
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
        <div style={{minHeight:"100vh",background:"var(--bg)",direction:"rtl",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,color:"var(--text2)"}}>
          <div style={{fontSize:48}}>🎓</div>
          <div style={{fontSize:18,fontWeight:700}}>הקישור הזה בוטל</div>
          <div style={{fontSize:13}}>הגישה לצפייה בבקשות עברה לפורטל המרצה — ראש מחלקה, אנא התחבר דרך הפורטל</div>
          <a href="/" style={{marginTop:8,padding:"10px 22px",background:"var(--accent)",color:"#000",fontWeight:800,borderRadius:10,textDecoration:"none"}}>🎓 כניסה לפורטל</a>
        </div>
      ) : isLecturerPortalView ? (
        <div className="public-page-shell">
          {!loadingDone ? <Loading ready={!loading} accentColor={siteSettings.accentColor} onDone={handleLoadingDone}/> : (
            <LecturerPortal
              lecturers={lecturers}
              lessons={lessons}
              kits={kits}
              equipment={equipment}
              reservations={reservations}
              studios={studios}
              setLessons={setLessons}
              setKits={setKits}
              setReservations={setReservations}
              showToast={showToast}
              siteSettings={siteSettings}
              deptHeads={deptHeads}
              onLogout={async () => {
                sessionStorage.removeItem("active_role");
                sessionStorage.removeItem("lecturer_portal_user");
                await supabase.auth.signOut().catch(() => {});
                window.location.assign("/");
              }}
            />
          )}
        </div>
      ) : isPublicFormView && (
        <div className="public-page-shell">
          {!loadingDone ? <Loading ready={!loading} accentColor={siteSettings.accentColor} onDone={handleLoadingDone}/> : <PublicForm equipment={equipment} reservations={reservations} setReservations={setReservations} showToast={showToast} categories={categories} kits={kits} teamMembers={teamMembers} policies={policies} certifications={certifications} deptHeads={deptHeads} siteSettings={siteSettings} categoryLoanTypes={categoryLoanTypes} refreshInventory={refreshPublicInventory} lecturers={lecturers} canInstall={canInstallPwa} onInstall={installPwa}/>}
        </div>
      )}



      {/* ── אזור ניהול (מוגן מפני גישה ישירה) ── */}
      <ProtectedRoute authed={authed}>
      {/* ── כניסת צוות — הפניה לדף כניסה אחיד ── */}
      {isAdmin && !authed && staffAuthChecked && (() => { window.location.replace("/"); return null; })()}
      {isAdmin && !authed && !staffAuthChecked && <Loading ready={false} accentColor={siteSettings.accentColor} onDone={() => {}} />}

      {/* ── Staff Hub ── */}
      {isAdmin && authed && staffView === "hub" && (
        <StaffHub
          user={staffUser}
          logo={siteSettings.logo}
          canInstall={canInstallPwa}
          onInstall={() => { void installPwa(); }}
          onNavigate={(view) => setStaffView(view)}
          onLogout={async () => { await supabase.auth.signOut().catch(()=>{}); sessionStorage.removeItem("staff_user"); sessionStorage.removeItem("staff_view"); sessionStorage.removeItem("active_role"); window.location.replace("/"); }}
        />
      )}

      {/* ── ניהול צוות (admin only) ── */}
      {isAdmin && authed && staffView === "staff-management" && staffUser?.role === "admin" && (
        <div className="app" style={{"--accent":siteSettings.adminAccentColor||"#f5a623","--accent-glow":`${siteSettings.adminAccentColor||"#f5a623"}2e`,"--admin-fs":`${siteSettings.adminFontSize||14}px`}}>
          <div className="main" style={{marginRight:0,width:"100%"}}>
            <div className="topbar">
              <div style={{display:"flex",alignItems:"center",gap:8,width:"100%"}}>
                <button className="btn btn-secondary btn-sm" onClick={()=>setStaffView("hub")}>← חזרה</button>
                <span className="topbar-title" style={{flex:1}}>ניהול צוות</span>
              </div>
            </div>
            {!loadingDone ? <Loading ready={!loading} accentColor={siteSettings.accentColor} onDone={handleLoadingDone}/> : <StaffManagementPage showToast={showToast} teamMembers={teamMembers} setTeamMembers={setTeamMembers} deptHeads={deptHeads} setDeptHeads={setDeptHeads} collegeManager={collegeManager} setCollegeManager={setCollegeManager} managerToken={managerToken} lecturers={lecturers} reservations={reservations} setReservations={setReservations}/>}
          </div>
        </div>
      )}

      {/* ── הגדרות מערכת (admin only) ── */}
      {isAdmin && authed && staffView === "system-settings" && staffUser?.role === "admin" && (
        <div className="app" style={{"--accent":siteSettings.adminAccentColor||"#f5a623","--accent-glow":`${siteSettings.adminAccentColor||"#f5a623"}2e`,"--admin-fs":`${siteSettings.adminFontSize||14}px`}}>
          <div className="main" style={{marginRight:0,width:"100%"}}>
            <div className="topbar">
              <div style={{display:"flex",alignItems:"center",gap:8,width:"100%"}}>
                <button className="btn btn-secondary btn-sm" onClick={()=>setStaffView("hub")}>← חזרה</button>
                <span className="topbar-title" style={{flex:1}}>הגדרות מערכת</span>
              </div>
            </div>
            <SystemSettingsPage siteSettings={siteSettings} setSiteSettings={setSiteSettings} showToast={showToast} storageSet={storageSet}/>
          </div>
        </div>
      )}

      {/* ── יומן פעילות (admin only) ── */}
      {isAdmin && authed && staffView === "activity-logs" && staffUser?.role === "admin" && (
        <div className="app" style={{"--accent":siteSettings.adminAccentColor||"#f5a623","--accent-glow":`${siteSettings.adminAccentColor||"#f5a623"}2e`,"--admin-fs":`${siteSettings.adminFontSize||14}px`}}>
          <div className="main" style={{marginRight:0,width:"100%"}}>
            <div className="topbar">
              <div style={{display:"flex",alignItems:"center",gap:8,width:"100%"}}>
                <button className="btn btn-secondary btn-sm" onClick={()=>setStaffView("hub")}>← חזרה</button>
                <span className="topbar-title" style={{flex:1}}>יומן פעילות</span>
              </div>
            </div>
            <ActivityLogsPage showToast={showToast} teamMembers={teamMembers}/>
          </div>
        </div>
      )}

      {/* ── לוז עובדים (all staff) ── */}
      {isAdmin && authed && staffView === "staff-schedule" && (
        <div className="app" style={{"--accent":siteSettings.adminAccentColor||"#f5a623","--accent-glow":`${siteSettings.adminAccentColor||"#f5a623"}2e`,"--admin-fs":`${siteSettings.adminFontSize||14}px`}}>
          <div className="main" style={{marginRight:0,width:"100%"}}>
            <div className="topbar">
              <div style={{display:"flex",alignItems:"center",gap:8,width:"100%"}}>
                <button className="btn btn-secondary btn-sm" onClick={()=>setStaffView("hub")}>← חזרה</button>
                <span className="topbar-title" style={{flex:1}}>חלוקת משמרות</span>
              </div>
            </div>
            {!loadingDone ? <Loading ready={!loading} accentColor={siteSettings.accentColor} onDone={handleLoadingDone}/> : <StaffSchedulePage staffUser={staffUser} showToast={showToast} studios={studios} studioBookings={studioBookings} reservations={reservations} lessons={lessons} setLessons={setLessons}/>}
          </div>
        </div>
      )}

      {/* ── תפעול מחסן (warehouse view) ── */}
      {isAdmin && authed && staffView === "warehouse" && (
        <div className="app" style={{"--accent":siteSettings.warehouseAccentColor||siteSettings.adminAccentColor||"#f5a623","--accent-glow":`${siteSettings.warehouseAccentColor||siteSettings.adminAccentColor||"#f5a623"}2e`,"--admin-fs":`${siteSettings.warehouseFontSize||siteSettings.adminFontSize||14}px`}}>
          <nav className="sidebar">
            <div className="sidebar-logo">
              {siteSettings.logo
                ? <img src={siteSettings.logo} alt="לוגו" style={{width:90,height:90,objectFit:"contain",borderRadius:8}}/>
                : <span className="logo-icon">🎬</span>}
              {siteSettings.soundLogo && (
                <img src={siteSettings.soundLogo} alt="לוגו סאונד" style={{width:90,height:90,objectFit:"contain",borderRadius:8,marginTop:2,display:"block"}}/>
              )}
              <div className="app-name">תפעול מחסן</div>
              <div className="app-sub">שלום, {staffUser?.full_name || "צוות"}</div>
            </div>
            <div className="nav">
              <div className="nav-section">ניהול</div>
              {[
                {id:"reservations",icon:"📋",label:"בקשות",badge:(pending||0)+(rejected||0)||null},
                {id:"equipment",icon:"📦",label:"ציוד",badge:damagedCount||null},
                {id:"certifications",icon:"🎓",label:"הסמכת ציוד"},
                {id:"kits",icon:"🎒",label:"ערכות"},
                {id:"policies",icon:"📋",label:"נהלים"},
                {id:"settings",icon:"⚙️",label:"הגדרות"},
              ].filter(n => {
                const allowed = staffUser?.role === "admin" ? [] : (staffUser?.permissions?.warehouseSections || []);
                return !allowed.length || allowed.includes(n.id);
              }).map(n=>(
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
              <button className="btn btn-secondary btn-sm" onClick={()=>setStaffView("hub")}>← Staff Hub</button>
            </div>
          </nav>
          <div className="main" onTouchStart={handleSwipeTouchStart} onTouchEnd={handleWarehouseSwipeTouchEnd}>
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
                    value={["הכל","ממתין","אישור ראש מחלקה","מאושר","פעילה"].includes(resStatusF) ? resStatusF : "הכל"}
                    onChange={e=>setResStatusF(e.target.value)}
                  >
                    <option value="הכל">כל הסטטוסים</option>
                    {["ממתין","אישור ראש מחלקה","מאושר","פעילה"].map(s=><option key={s} value={s}>{s}</option>)}
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
            {!loadingDone ? <Loading ready={!loading} accentColor={siteSettings.accentColor} onDone={handleLoadingDone}/> : <>
              <div style={{display:page==="dashboard"?"block":"none"}}><DashboardPage equipment={equipment} reservations={reservations} setReservations={setReservations} showToast={showToast} siteSettings={siteSettings} equipmentReports={equipmentReports}/></div>
              <div style={{display:page==="equipment"?"block":"none"}}><EquipmentPage equipment={equipment} reservations={reservations} setEquipment={setEquipment} showToast={showToast} categories={categories} setCategories={setCategories} categoryTypes={categoryTypes} setCategoryTypes={setCategoryTypes} categoryLoanTypes={categoryLoanTypes} setCategoryLoanTypes={setCategoryLoanTypes} certifications={certifications} studios={studios} collegeManager={collegeManager} managerToken={managerToken} onLogCreated={attachLogIdToUndo} equipmentReports={equipmentReports} fetchEquipmentReports={fetchEquipmentReports}/></div>
              <div style={{display:page==="reservations"?"block":"none"}}><ReservationsPage reservations={reservations} setReservations={setReservations} equipment={equipment} showToast={showToast}
                search={resSearch} setSearch={setResSearch} statusF={resStatusF} setStatusF={setResStatusF}
                loanTypeF={resLoanTypeF} setLoanTypeF={setResLoanTypeF} sortBy={resSortBy} setSortBy={setResSortBy} collegeManager={collegeManager} managerToken={managerToken}
                initialSubView={reservationsInitialSubView} categories={categories} certifications={certifications} kits={kits} teamMembers={teamMembers} deptHeads={deptHeads} siteSettings={siteSettings} onLogCreated={attachLogIdToUndo} equipmentReports={equipmentReports}/></div>
              <div style={{display:page==="team"?"block":"none"}}><TeamPage teamMembers={teamMembers} setTeamMembers={setTeamMembers} deptHeads={deptHeads} setDeptHeads={setDeptHeads} collegeManager={collegeManager} setCollegeManager={setCollegeManager} showToast={showToast} managerToken={managerToken}/></div>
              <div style={{display:page==="kits"?"block":"none"}}><KitsPage kits={kits} setKits={setKits} equipment={equipment} categories={categories} showToast={showToast} reservations={reservations} setReservations={setReservations} lessons={lessons}/></div>
              <div style={{display:page==="lessons"?"block":"none"}}><LessonsPage lessons={lessons} setLessons={setLessons} studios={studios} kits={kits} showToast={showToast} reservations={reservations} setReservations={setReservations} equipment={equipment} studioBookings={studioBookings} setStudioBookings={setStudioBookings} certifications={certifications} lecturers={lecturers} setLecturers={setLecturers} trackOptions={Array.isArray(certifications?.trackSettings) && certifications.trackSettings.length
                ? certifications.trackSettings.map(setting => String(setting?.name || "").trim()).filter(Boolean)
                : [...new Set((certifications?.students || []).map(student => String(student?.track || "").trim()).filter(Boolean))]}/></div>
              <div style={{display:page==="policies"?"block":"none"}}><PoliciesPage policies={policies} setPolicies={setPolicies} showToast={showToast}/></div>
              <div style={{display:page==="certifications"?"block":"none"}}><CertificationsPage certifications={certifications} setCertifications={setCertifications} showToast={showToast} studios={studios} setStudios={setStudios} equipment={equipment} setEquipment={setEquipment} onlyMode="equipment"/></div>
              <div style={{display:page==="settings"?"block":"none"}}><SettingsPage siteSettings={siteSettings} setSiteSettings={setSiteSettings} showToast={showToast} settingsRole="warehouse"/></div>
            </>}
          </div>
        </div>
      )}

      {/* ── אדמיניסטרציה ── */}
      {isAdmin && authed && staffView === "administration" && (
        <div className="app" style={{"--accent":siteSettings.secretaryAccentColor||siteSettings.adminAccentColor||"#f5a623","--accent-glow":`${siteSettings.secretaryAccentColor||siteSettings.adminAccentColor||"#f5a623"}2e`,"--admin-fs":`${siteSettings.secretaryFontSize||siteSettings.adminFontSize||14}px`}}>
          <nav className="sidebar">
            <div className="sidebar-logo">
              {siteSettings.logo
                ? <img src={siteSettings.logo} alt="לוגו" style={{width:90,height:90,objectFit:"contain",borderRadius:8}}/>
                : <span className="logo-icon">🎬</span>}
              {siteSettings.soundLogo && (
                <img src={siteSettings.soundLogo} alt="לוגו סאונד" style={{width:90,height:90,objectFit:"contain",borderRadius:8,marginTop:2,display:"block"}}/>
              )}
              <div className="app-name">אדמיניסטרציה</div>
              <div className="app-sub">שלום, {staffUser?.full_name || "צוות"}</div>
            </div>
            <div className="nav">
              <div className="nav-section">ניהול</div>
              {[
                {id:"studios",icon:"🎙️",label:"ניהול חדרים"},
                {id:"studio-certifications",icon:"🎓",label:"הסמכת אולפן"},
                {id:"lessons",icon:"📽️",label:"שיעורים",badge:lessons.length||null},
                {id:"lecturers",icon:"👩‍🏫",label:"מרצים",badge:lecturers.filter(l=>l.isActive!==false).length||null},
                {id:"students",icon:"👨‍🎓",label:"סטודנטים"},
                {id:"policies",icon:"📋",label:"נהלים"},
                {id:"settings",icon:"⚙️",label:"הגדרות"},
              ].filter(n => {
                const allowed = staffUser?.role === "admin" ? [] : (staffUser?.permissions?.administrationSections || []);
                return !allowed.length || allowed.includes(n.id);
              }).map(n=>(
                <div key={n.id} className={`nav-item ${secretaryPage===n.id?"active":""}`}
                  onClick={() => setSecretaryPage(p=>p===n.id?"dashboard":n.id)} title={n.label}>
                  <span className="icon">{n.icon}</span>
                  <span className="nav-label">{n.label}</span>
                  {n.badge&&<span style={{background:"var(--accent)",color:"#000",borderRadius:"50%",width:16,height:16,fontSize:10,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",position:"absolute",top:4,left:"50%",transform:"translateX(-50%) translateX(10px)"}}>{n.badge}</span>}
                </div>
              ))}
            </div>
            <div id="sidebar-mini-cal" />
            <div style={{padding:"10px 20px",borderTop:"1px solid var(--border)",display:"flex",justifyContent:"flex-end"}}>
              <button className="btn btn-secondary btn-sm" onClick={()=>setStaffView("hub")}>← Staff Hub</button>
            </div>
          </nav>
          <div className="main" onTouchStart={handleSwipeTouchStart} onTouchEnd={handleSecretarySwipeTouchEnd}>
            <div className="topbar" style={{flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8,width:"100%"}}>
                <span className="topbar-title" style={{flex:1}}>{{dashboard:"סטטוס אדמיניסטרציה",studios:"ניהול חדרים","studio-certifications":"הסמכת אולפן",lessons:"שיעורים",lecturers:"מרצים",students:"סטודנטים",policies:"נהלים",settings:"הגדרות",team:"ניהול צוות"}[secretaryPage]||"סטטוס אדמיניסטרציה"}</span>
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
            </div>
            {!loadingDone ? <Loading ready={!loading} accentColor={siteSettings.accentColor} onDone={handleLoadingDone}/> : <>
              <div style={{display:secretaryPage==="dashboard"?"block":"none"}}><SecretaryDashboardPage certifications={certifications} studios={studios} studioBookings={studioBookings} lessons={lessons}/></div>
              <div style={{display:secretaryPage==="studios"?"block":"none"}}><StudioBookingPage showToast={showToast} teamMembers={teamMembers} certifications={certifications} role="admin" studios={studios} setStudios={setStudios} bookings={studioBookings} setBookings={setStudioBookings} siteSettings={siteSettings} setSiteSettings={setSiteSettings} isActive={secretaryPage==="studios"} currentUser={staffUser} lessons={lessons} setLessons={setLessons} onNavigateToLesson={(lessonId) => { setEditLessonId(lessonId); setSecretaryPage("lessons"); }}/></div>
              <div style={{display:secretaryPage==="studio-certifications"?"block":"none"}}><CertificationsPage certifications={certifications} setCertifications={setCertifications} showToast={showToast} studios={studios} setStudios={setStudios} equipment={equipment} setEquipment={setEquipment} onlyMode="studio"/></div>
              <div style={{display:secretaryPage==="lessons"?"block":"none"}}><LessonsPage lessons={lessons} setLessons={setLessons} studios={studios} kits={kits} showToast={showToast} reservations={reservations} setReservations={setReservations} equipment={equipment} studioBookings={studioBookings} setStudioBookings={setStudioBookings} certifications={certifications} openLessonId={editLessonId} onOpenLessonConsumed={() => setEditLessonId(null)} lecturers={lecturers} setLecturers={setLecturers} trackOptions={Array.isArray(certifications?.trackSettings) && certifications.trackSettings.length ? certifications.trackSettings.map(setting => String(setting?.name || "").trim()).filter(Boolean) : [...new Set((certifications?.students || []).map(student => String(student?.track || "").trim()).filter(Boolean))]}/></div>
              <div style={{display:secretaryPage==="lecturers"?"block":"none"}}><LecturersPage lecturers={lecturers} setLecturers={setLecturers} showToast={showToast} lessons={lessons} trackOptions={Array.isArray(certifications?.trackSettings)&&certifications.trackSettings.length?certifications.trackSettings.map(s=>String(s?.name||"").trim()).filter(Boolean):[...new Set((certifications?.students||[]).map(s=>String(s?.track||"").trim()).filter(Boolean))]}/></div>
              <div style={{display:secretaryPage==="students"?"block":"none"}}><StudentsPage certifications={certifications} setCertifications={setCertifications} showToast={showToast} onLogCreated={attachLogIdToUndo} studioBookings={studioBookings} setStudioBookings={setStudioBookings} reservations={reservations} setReservations={setReservations}/></div>
              <div style={{display:secretaryPage==="policies"?"block":"none"}}><PoliciesPage policies={policies} setPolicies={setPolicies} showToast={showToast}/></div>
              <div style={{display:secretaryPage==="settings"?"block":"none"}}><SettingsPage siteSettings={siteSettings} setSiteSettings={setSiteSettings} showToast={showToast} settingsRole="administration"/></div>
            </>}
          </div>
        </div>
      )}

      {/* old warehouse standalone section removed — now accessed via staffView === "warehouse" above */}

      </ProtectedRoute>

      <Toast toasts={toasts}/>
    </>
  );
}
