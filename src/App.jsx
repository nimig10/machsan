import { useState, useEffect, useMemo, useRef } from "react";
import { AlertTriangle, AudioLines, Backpack, BookOpen, Briefcase, Calendar, Camera, Check, CheckCircle, Clock, ClipboardList, Download, FileText, Film, GraduationCap, HelpCircle, Info, Link, Lightbulb, LogOut, Mail, Mic, Minus, Package, Pencil, Phone, Plus, Save, Search, Settings, Shield, ShoppingCart, SlidersHorizontal, Trash2, Triangle, User, Video, Wrench, X, XCircle } from "lucide-react";
import { logActivity, cloudinaryThumb, getEffectiveStatus, updateReservationStatus, createLessonReservations, getAuthToken, getSbAuthHeaders, invalidateAuthTokenCache, writeEquipmentToDB, equipmentWriteInFlight, getValidTokenDirect } from "./utils.js";
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
    const token = await getAuthToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res  = await fetch(`/api/store?key=${encodeURIComponent(key)}`, { headers, signal });
    if (!res.ok) {
      console.warn("storageGet HTTP error", key, res.status);
      return { value: lsGet(key), source: "cache" };
    }
    const json = await res.json();
    if (json && json.data != null) {
      lsSet(key, json.data);
      return { value: json.data, source: "supabase" };
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
    await fetch(`/api/store?key=equipment`, { signal: ac.signal });
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
    const token = await getAuthToken();
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(`/api/store?key=${encodeURIComponent(key)}`, { headers });
    const json = await r.json();
    if (json && json.data != null) {
      const old = json.data;
      if (Array.isArray(old) && old.length > 0) {
        await fetch("/api/store", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: `backup_${key}`, data: old }),
        });
        localStorage.setItem(lastKey, String(Date.now()));
        console.log(`Backup saved: backup_${key} (${old.length} items)`);
      }
    }
  } catch(e) { /* silent — don't block the actual write */ }
}

async function storageSet(key, value) {
  const previousCachedValue = lsGet(key);
  lsSet(key, value); // cache immediately
  try {
    await autoBackup(key);
    const token = await getValidTokenDirect();
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch("/api/store", {
      method:  "POST",
      headers,
      body:    JSON.stringify({ key, data: value }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.warn("storageSet error", key, err);
      // Shrink guard → local state is stale. Refresh cache from DB and
      // tell the app to re-render from truth instead of from our stale view.
      if (/shrink_guard_blocked/i.test(err)) {
        try {
          const { value: fresh } = await storageGet(key);
          if (fresh != null) {
            lsSet(key, fresh);
            window.dispatchEvent(new CustomEvent("storage-stale-refresh", { detail: { key, fresh } }));
          }
        } catch {}
        return { ok: false, error: "shrink_guard_blocked", stale: true };
      }
      restoreCacheValue(key, previousCachedValue);
      return { ok: false, error: err };
    }
    // mirror functions removed (Stage 5) — equipment + reservations write directly to Supabase
    return { ok: true };
  } catch(e) {
    console.error("storageSet network error", key, e);
    restoreCacheValue(key, previousCachedValue);
    return { ok: false, error: e.message };
  }
}

// writeEquipmentToDB is exported from utils.js (Stage 5)

// ─── DB DIAGNOSTICS (accessible from browser console) ────────────────────────
window.dbDiag = async () => {
  const keys = ["equipment","reservations","categories","categoryTypes","categoryLoanTypes","teamMembers","kits","policies","certifications","deptHeads","collegeManager","managerToken","siteSettings"];
  console.log("Supabase DB Diagnostic Report");
  console.log("=".repeat(50));
  for (const key of keys) {
    try {
      const res = await fetch(`${SB_URL}/rest/v1/store?key=eq.${key}&select=data,updated_at`, { headers: await getSbAuthHeaders() });
      const json = await res.json();
      if (json.length > 0) {
        const d = json[0].data;
        const count = Array.isArray(d) ? d.length : (typeof d === "object" ? Object.keys(d).length : 1);
        const units = key === "equipment" && Array.isArray(d) ? d.reduce((s,e) => s + (Array.isArray(e.units) ? e.units.length : (e.quantity||0)), 0) : "";
        console.log(`[OK] ${key}: ${count} items${units ? ` (${units} units)` : ""} — updated: ${json[0].updated_at}`);
      } else {
        console.log(`[WARN] ${key}: EMPTY (not in DB)`);
      }
    } catch(e) { console.log(`[ERR] ${key}: ERROR — ${e.message}`); }
  }
};
window.dbExport = async () => {
  const keys = ["equipment","reservations","teamMembers","kits","certifications"];
  const data = {};
  for (const key of keys) {
    try {
      const res = await fetch(`${SB_URL}/rest/v1/store?key=eq.${key}&select=data`, { headers: await getSbAuthHeaders() });
      const json = await res.json();
      data[key] = json.length > 0 ? json[0].data : null;
    } catch(e) { data[key] = `ERROR: ${e.message}`; }
  }
  console.log("Full DB Export (copy this JSON):");
  console.log(JSON.stringify(data, null, 2));
  return data;
};
window.dbImport = async (data) => {
  if (!data || typeof data !== "object") { console.error("Usage: dbImport({equipment:[...], reservations:[...]})"); return; }
  for (const [key, value] of Object.entries(data)) {
    if (value == null) continue;
    const r = await storageSet(key, value);
    console.log(r.ok ? `[OK] ${key} restored` : `[ERR] ${key} failed: ${r.error}`);
  }
  console.log("Reload the page to see changes");
};
window.dbBackups = async () => {
  const keys = ["equipment","reservations","teamMembers","kits","certifications"];
  console.log("Backup Status:");
  for (const key of keys) {
    try {
      const res = await fetch(`${SB_URL}/rest/v1/store?key=eq.backup_${key}&select=data,updated_at`, { headers: await getSbAuthHeaders() });
      const json = await res.json();
      if (json.length > 0) {
        const d = json[0].data;
        const count = Array.isArray(d) ? d.length : 0;
        console.log(`[OK] backup_${key}: ${count} items — saved: ${json[0].updated_at}`);
      } else {
        console.log(`[WARN] backup_${key}: no backup yet`);
      }
    } catch(e) { console.log(`[ERR] backup_${key}: ERROR`); }
  }
};
window.dbRestoreFromBackup = async (key) => {
  if (!key) { console.error("Usage: dbRestoreFromBackup('equipment')"); return; }
  const res = await fetch(`${SB_URL}/rest/v1/store?key=eq.backup_${key}&select=data`, { headers: await getSbAuthHeaders() });
  const json = await res.json();
  if (!json.length || !json[0].data) { console.error(`No backup found for ${key}`); return; }
  const r = await storageSet(key, json[0].data);
  console.log(r.ok ? `[OK] ${key} restored from backup (${json[0].data.length} items)` : `[ERR] Failed: ${r.error}`);
  console.log("Reload the page to see changes");
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
// Note: "כבלים" intentionally NOT in SOUND_CATEGORIES — cables are general gear used
// by both sound and photo crews, so they default to "כללי" unless admin overrides.
const SOUND_CATEGORIES = ["מיקרופונים","מקליטי אודיו"];
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

function normalizeEquipmentTagFlags(list = [], categoryTypes = {}) {
  return (list || []).map((item) => {
    if (!item || typeof item !== "object") return item;
    const normalized = { ...item };
    const hasAdminType = categoryTypes && Object.prototype.hasOwnProperty.call(categoryTypes, normalized.category);
    const adminType = hasAdminType ? categoryTypes[normalized.category] : undefined;
    if (adminType === "סאונד") {
      // Admin-pinned as sound → honor
      normalized.soundOnly = true;
      normalized.photoOnly = false;
    } else if (adminType === "צילום") {
      // Admin-pinned as photo → honor
      normalized.soundOnly = false;
      normalized.photoOnly = true;
    } else if (hasAdminType) {
      // Admin explicitly classified as "כללי" (stored as "") → neither
      normalized.soundOnly = false;
      normalized.photoOnly = false;
    } else {
      // No admin override → auto-derive from hardcoded category defaults.
      // ALWAYS re-apply (even if already boolean) so changes to defaults propagate
      // to existing items (e.g. removing "כבלים" from SOUND_CATEGORIES).
      normalized.soundOnly = SOUND_CATEGORIES.includes(normalized.category);
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
    let nextStatus = normalizeReservationStatus(reservation.status);
    // Lesson loans (השאלת שיעור) never sit in "ממתין" — they are pre-scheduled
    // by the school calendar and auto-flow through מאושר → הוחזר based on time.
    if (reservation.loan_type === "שיעור" && nextStatus === "ממתין") {
      nextStatus = "מאושר";
    }
    const normalizedReservation = {
      ...reservation,
      status: nextStatus,
    };
    if (normalizedReservation.status === "הוחזר") {
      return normalizedReservation.returned_at ? normalizedReservation : markReservationReturned(normalizedReservation, now);
    }
    const returnAt = getReservationReturnTimestamp(normalizedReservation);
    if (normalizedReservation.status === "מאושר" && returnAt !== null && nowMs >= returnAt) {
      // Lessons auto-archive; all other types (including staff "צוות") go to "באיחור".
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
  return null;
}

function getLessonsLinkedToKit(kit, lessons = []) {
  if (!kit) return [];
  return lessons.filter((lesson) => {
    if (!lesson) return false;
    if (hasLinkedValue(lesson.kitId) && String(lesson.kitId) === String(kit.id)) return true;
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
      // Staff cancelled this session's loan request — skip without touching the lesson itself.
      // Lecturer can re-create it from the portal (which clears the flag).
      if (session?.cancelledRequest) return;
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
  .qty-btn svg { stroke:var(--text); }
  .qty-btn:hover { background:var(--accent); color:var(--bg); border-color:var(--accent); }
  .qty-btn:hover svg { stroke:var(--bg); }
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
    .form-page { min-height:100vh; padding:16px 0 80px; overflow-x:hidden; }
    .form-card { width:calc(100% - 24px); max-width:calc(100% - 24px); margin-inline:auto; }
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
  הפקה: ["צילום", "כללי"],
  סאונד: ["סאונד", "כללי"],
  "קולנוע יומית": ["צילום", "כללי"],
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
  const [f, setF] = useState(() => {
    const base = { name:"", category:"מצלמות", description:"", technical_details:"", total_quantity:1, image:"📷", notes:"", status:"תקין", certification_id:"" };
    const merged = { ...base, ...(initial || {}) };
    // Normalize nullable fields to strings so controlled inputs never receive null
    merged.notes           = merged.notes           ?? "";
    merged.description     = merged.description     ?? "";
    merged.technical_details = merged.technical_details ?? "";
    merged.name            = merged.name            ?? "";
    merged.certification_id = merged.certification_id ?? "";
    return merged;
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
      const token = await getAuthToken();
      const response = await fetch('/api/gemini', {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
      systemInstruction: "You are a professional AV and film equipment technical specialist. The user will provide an equipment name. Write concise technical details in Hebrew for this item as a bullet list of 4-6 items, focusing on relevant specs, connections, power or battery, compatibility, operating range, mounting, or practical setup details. Each bullet must start with '• ' followed by the detail. Output ONLY the bullet list in Hebrew, one bullet per line, no headings, no extra text.",
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
      const token = await getAuthToken();
      const res  = await fetch("/api/upload-image", {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
        <div className="form-group"><label className="form-label">קטגוריה</label><select className="form-select" value={f.category} onChange={e=>s("category",e.target.value)}>{[...(categories||[])].sort((a,b)=>a.localeCompare(b,"he")).map(c=><option key={c}>{c}</option>)}</select></div>
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
              ? <div style={{width:48,height:48,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:8,border:"1px solid var(--border)",background:"var(--surface2)"}}><Clock size={20} strokeWidth={1.75} color="var(--text3)"/></div>
              : isImage
                ? <img src={f.image} alt="" style={{width:48,height:48,objectFit:"cover",borderRadius:8,border:"1px solid var(--border)"}}/>
                : <span style={{fontSize:36}}>{f.image}</span>
            }
            <div style={{flex:1}}>
              <input className="form-input" value={isImage?"":f.image} placeholder="אימוג׳י (למשל 📷)" onChange={e=>s("image",e.target.value)} style={{marginBottom:6}} disabled={imgUploading}/>
              <input ref={imgInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleImageUpload}/>
              <button type="button" onClick={()=>imgInputRef.current?.click()} disabled={imgUploading}
                style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",background:"var(--surface3)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",cursor:imgUploading?"not-allowed":"pointer",fontSize:12,color:"var(--text2)",opacity:imgUploading?0.6:1,width:"100%"}}>
                {imgUploading ? <><Clock size={13} strokeWidth={1.75}/> מעלה תמונה...</> : "🖼️ העלה תמונה מהמחשב"}
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
        <div className="form-group">
          <label className="form-label" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>הערה לסטודנט</span>
            <span style={{fontWeight:400,fontSize:11,color:(f.notes||"").length>130?"var(--red)":"var(--text3)"}}>{(f.notes||"").length}/150</span>
          </label>
          <textarea className="form-input" value={f.notes} maxLength={150} rows={3} onChange={e=>s("notes",e.target.value)} placeholder="הערה שתוצג לסטודנט בעת בחירת פריט זה" style={{resize:"vertical",minHeight:72,fontFamily:"inherit",lineHeight:1.5}}/>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label" style={{display:"flex",alignItems:"center",gap:4}}><GraduationCap size={14} strokeWidth={1.75}/> הסמכה נדרשת</label>
        <select className="form-select" value={f.certification_id||""} onChange={e=>s("certification_id",e.target.value)}>
          <option value="">ללא הסמכה (כולם רשאים)</option>
          {equipmentCertTypes.map(ct=>(
            <option key={ct.id} value={ct.id}>{ct.name}</option>
          ))}
        </select>
        <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>רק סטודנטים שעברו הסמכה זו יוכלו להשאיל פריט זה</div>
      </div>
      <div className="flex gap-2" style={{paddingTop:8}}>
        <button className="btn btn-primary" disabled={!f.name||saving||imgUploading} onClick={()=>onSave(f)}>{saving?<><Clock size={14} strokeWidth={1.75}/> שומר...</>:initial?"שמור":"הוסף"}</button>
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
    const result = await writeEquipmentToDB(nextEquipment);
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
      }], categoryTypes)[0]));
      added++;
    });
    const previousEquipment = equipment;
    const previousCategories = categories;
    setEquipment(newEquipment);
    if (setCategories && newCats.length) {
      setCategories(newCategories);
    }
    const writeResults = await Promise.all([
      writeEquipmentToDB(newEquipment),
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
    const normalizedItems = ensureUnits(normalizeEquipmentTagFlags(newItems || [], categoryTypes));
    const updatedEquipment = [...(equipment || []), ...normalizedItems];
    const previousEquipment = equipment;
    const previousCategories = categories;
    setEquipment(updatedEquipment);
    const uniqueApprovedCategories = [...new Set((approvedCategories || []).map((item) => String(item || "").trim()).filter(Boolean))];
    const updatedCategories = [...new Set([...(categories || []), ...uniqueApprovedCategories])];
    const writes = [writeEquipmentToDB(updatedEquipment)];
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
    const sanitized = { ...form, notes: form.notes ?? "", description: form.description ?? "", technical_details: form.technical_details ?? "" };
    const normalizedForm = normalizeEquipmentTagFlags([sanitized], categoryTypes)[0];
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
    await Promise.all([storageSet("categories", updatedCats), writeEquipmentToDB(updatedEq), storageSet("categoryTypes", updatedTypes)]);
    showToast("success", `קטגוריה "${oldName}" עודכנה`);
  };

  const setCategoryClassification = async (categoryName, nextType) => {
    const updated = equipment.map((item) => (
      item.category === categoryName
        ? { ...item, soundOnly: nextType === "סאונד", photoOnly: nextType === "צילום" }
        : item
    ));
    const updatedTypes = { ...categoryTypes };
    // Store "" for explicit "כללי" (general) so it's distinguishable from "never touched".
    // This lets load-time normalization honor the admin's explicit general classification.
    updatedTypes[categoryName] = (nextType === "סאונד" || nextType === "צילום") ? nextType : "";
    const previousEquipment = equipment;
    const previousTypes = categoryTypes;
    setEquipment(updated);
    setCategoryTypes(updatedTypes);
    const results = await Promise.all([writeEquipmentToDB(updated), storageSet("categoryTypes", updatedTypes)]);
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
    const { data: dbItems } = await supabase.from("equipment").select("id").eq("category", categoryName);
    const hasItems = (dbItems && dbItems.length > 0) || equipment.some((item) => item.category === categoryName);
    if (hasItems) {
      showToast("error", "לא ניתן למחוק — יש ציוד ברובריקה זו. העבר את הפריטים קודם.");
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
  const visibleCategories = [...(categories || [])];
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
          {id:"active",label:<><Package size={14} strokeWidth={1.75}/> ציוד פעיל</>,badge:null},
          {id:"damaged",label:<><Wrench size={14} strokeWidth={1.75}/> ציוד בדיקה</>,badge:damagedCount||null},
          {id:"reports",label:<><ClipboardList size={14} strokeWidth={1.75}/> דיווחי סטודנטים</>,badge:eqReports.filter(r=>r.status==="open").length||null},
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
          <div style={{fontWeight:900,fontSize:16,display:"flex",alignItems:"center",gap:6}}><ClipboardList size={16} strokeWidth={1.75}/> דיווחי סטודנטים על ציוד</div>
          <button className="btn btn-secondary btn-sm" onClick={fetchEqReports} disabled={eqReportsLoading}>{eqReportsLoading?"טוען...":"🔄 רענן"}</button>
        </div>
        {eqReports.filter(r=>r.status==="open").length===0
          ?<div className="empty-state" style={{padding:40}}><div className="emoji"><CheckCircle size={48} strokeWidth={1.75} color="var(--green)"/></div><p>אין דיווחים פתוחים</p></div>
          :eqReports.filter(r=>r.status==="open").map(rp=>{
            const eq=equipment.find(e=>String(e.id)===String(rp.equipment_id));
            return <div key={rp.id} className="card" style={{padding:16,marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:800,fontSize:14}}>{eq?.name||rp.equipment_id}</div>
                  <div style={{fontSize:12,color:"var(--text3)",marginTop:2,display:"flex",alignItems:"center",gap:4}}>{rp.student_name} · <Calendar size={12} strokeWidth={1.75}/> {new Date(rp.created_at).toLocaleDateString("he-IL")}</div>
                  <div style={{marginTop:8,fontSize:13,color:"var(--text)",background:"var(--surface2)",borderRadius:8,padding:"10px 12px",border:"1px solid var(--border)"}}>{rp.content}</div>
                </div>
                <button className="btn btn-secondary btn-sm" style={{flexShrink:0}} onClick={async()=>{
                  try{const token=await getAuthToken();await fetch("/api/equipment-report",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({action:"mark-handled",id:rp.id})});
                  fetchEqReports();showToast("success","סומן כטופל");}catch{showToast("error","שגיאה");}
                }}><CheckCircle size={14} strokeWidth={1.75}/> טופל</button>
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
        <div className="search-bar"><span><Search size={14} strokeWidth={1.75} color="var(--text3)"/></span><input placeholder="חיפוש ציוד..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
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
        {[{k:"הכל",label:<><Package size={12} strokeWidth={1.75}/> הכל</>},{k:"סאונד",label:<><Mic size={12} strokeWidth={1.75}/> סאונד</>},{k:"צילום",label:<><Camera size={12} strokeWidth={1.75}/> צילום</>},{k:"כללי",label:"כללי"}].map(({k,label})=>{
          const active=typeFilter===k;
          return <button key={k} type="button" onClick={()=>setTypeFilter(k)}
            style={{padding:"5px 14px",borderRadius:8,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
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
                    onClick={async()=>{if(editCatPillVal.trim()){await handleCatPillRename(c,editCatPillVal.trim());setEditingCatPill(null);}}}><Check size={12} strokeWidth={2} color="var(--accent)"/></button>
                  <button type="button" className="btn btn-sm" style={{borderRadius:0,border:"none",background:"transparent",color:"var(--text3)",fontWeight:800,padding:"4px 7px",fontSize:12}} title="ביטול"
                    onClick={()=>setEditingCatPill(null)}><X size={12} strokeWidth={1.75} color="var(--text3)"/></button>
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
                    <Pencil size={12} strokeWidth={1.75} color="var(--text3)"/>
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

      {filtered.length===0 ? <div className="empty-state"><div className="emoji"><Package size={48} strokeWidth={1.75} color="var(--text3)"/></div><p>לא נמצא ציוד</p></div> : (
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
                        <GraduationCap size={14} strokeWidth={1.75} color="var(--accent)"/>
                        <span style={{fontSize:10,fontWeight:900,color:"var(--accent)"}}>הסמכה</span>
                      </div>
                    )}
                    <div style={{marginBottom:10,display:"flex",justifyContent:"center"}}>
                      {eq.image?.startsWith("data:")||eq.image?.startsWith("http")
                        ? <img src={cloudinaryThumb(eq.image)} alt={eq.name} style={{width:72,height:72,objectFit:"cover",borderRadius:10,border:"1px solid var(--border)"}}/>
                        : <span style={{fontSize:36}}>{eq.image||<Package size={36} strokeWidth={1.75} color="var(--text3)"/>}</span>
                      }
                    </div>
                    <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>{eq.name}</div>
                    <div style={{fontSize:11,color:"var(--text3)",marginBottom:8}}>{eq.category}</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
                      {eq.soundOnly && <div className="chip" style={{color:"var(--accent)",borderColor:"var(--accent)",display:"flex",alignItems:"center",gap:4}}><Mic size={12} strokeWidth={1.75}/> ציוד סאונד</div>}
                      {eq.photoOnly && <div className="chip" style={{color:"var(--green)",borderColor:"rgba(39,174,96,0.45)",display:"inline-flex",alignItems:"center",gap:4}}><Camera size={11} strokeWidth={1.75}/> ציוד צילום</div>}
                    </div>
                    <div style={{fontSize:13,display:"flex",alignItems:"center",justifyContent:"space-between",gap:6}}>
                      <div>
                        <strong style={{color:isEmpty?"var(--red)":"var(--accent)",fontSize:20}}>{avail}</strong>
                        <span style={{color:"var(--text3)"}}> / {workingUnits(eq)} זמין</span>
                        {workingUnits(eq)<eq.total_quantity&&<span style={{color:"var(--red)",fontSize:11,fontWeight:700,marginRight:6,display:"inline-flex",alignItems:"center",gap:3}}> · {eq.total_quantity-workingUnits(eq)} בדיקה <Wrench size={11} strokeWidth={1.75} /></span>}
                      </div>
                      {isEmpty&&<span style={{fontSize:10,fontWeight:900,color:"var(--red)",background:"rgba(231,76,60,0.12)",border:"1px solid rgba(231,76,60,0.4)",borderRadius:6,padding:"2px 7px",whiteSpace:"nowrap"}}>אזל במלאי</span>}
                    </div>
                    {eq.notes && <div className="chip" style={{marginTop:6,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"100%",display:"block",fontSize:11}} title={eq.notes}>💬 {eq.notes}</div>}
                    <div style={{marginTop:8}}>{statusBadge(eq.status)}</div>
                    <div className="flex gap-2" style={{marginTop:12,flexWrap:"wrap"}} onClick={e=>e.stopPropagation()}>
                      <button className="btn btn-secondary btn-sm" onClick={()=>setModal({type:"edit",item:eq})} style={{display:"inline-flex",alignItems:"center",gap:4}}><Pencil size={12} strokeWidth={1.75} color="var(--text3)"/> עריכה</button>
                      <button className="btn btn-secondary btn-sm" onClick={()=>setModal({type:"units",item:eq})} style={{display:"inline-flex",alignItems:"center",gap:4}}><Wrench size={12} strokeWidth={1.75} /> יחידות</button>
                      <button className="btn btn-danger btn-sm" onClick={(e)=>{e.stopPropagation();del(eq)}}><Trash2 size={14} strokeWidth={1.75} /></button>
                    </div>
                  </div>
                );})}
              </div>
            </div>
          ))}
        </>
      )}
      {(modal?.type==="add"||modal?.type==="edit") && <Modal title={modal.type==="add"?"הוספת ציוד":"עריכת ציוד"} onClose={()=>setModal(null)}><EqForm
              initial={modal.type==="edit"?modal.item:modal.defaultCategory?{category:modal.defaultCategory}:null}
              categories={categories}
              equipmentCertTypes={equipmentCertTypes}
              saving={saving}
              onSave={save}
              onCancel={()=>setModal(null)}
              onImageUploaded={(url) => {
                if (modal.type==="edit" && modal.item?.id) {
                  const updated = equipment.map(e => e.id===modal.item.id ? {...e, image: url} : e);
                  persistEquipmentChange(updated, { successMessage: "תמונה עודכנה" });
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
          const updatedCats=[...categories, name].sort((a, b) => a.localeCompare(b, "he"));
          const updatedTypes={...categoryTypes,...(type!==undefined?{[name]:type}:{})};
          setCategories(updatedCats);
          setCategoryTypes(updatedTypes);
          await Promise.all([storageSet("categories",updatedCats),storageSet("categoryTypes",updatedTypes)]);
          showToast("success",`קטגוריה "${name}" נוספה`);
          { const _c = JSON.parse(sessionStorage.getItem("staff_user")||"{}"); logActivity({ user_id: _c.id, user_name: _c.full_name, action: "category_add", entity: "categories", entity_id: name, details: { name, type } }); }
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
            const updatedCats = [...categories, action.name].sort((a, b) => a.localeCompare(b, "he"));
            // Store "" for explicit "כללי" (general). Only skip when action.type is undefined.
            const updatedTypes = {...categoryTypes, ...(action.type !== undefined ? {[action.name]: action.type} : {})};
            setCategories(updatedCats);
            setCategoryTypes(updatedTypes);
            await Promise.all([storageSet("categories", updatedCats), storageSet("categoryTypes", updatedTypes)]);
            showToast("success", `קטגוריה "${action.name}" נוספה`);
            { const _c = JSON.parse(sessionStorage.getItem("staff_user")||"{}"); logActivity({ user_id: _c.id, user_name: _c.full_name, action: "category_add", entity: "categories", entity_id: action.name, details: { name: action.name, type: action.type } }); }
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
            // Store "" for explicit "כללי" so load-time normalization can honor it.
            // action.type may be "סאונד" | "צילום" | "" (explicit general) | undefined (no change).
            if(action.type !== undefined) updatedTypes[action.newName] = action.type;
            setCategories(updatedCats);
            setEquipment(updatedEq);
            setCategoryTypes(updatedTypes);
            await Promise.all([storageSet("categories", updatedCats), writeEquipmentToDB(updatedEq), storageSet("categoryTypes", updatedTypes)]);
            showToast("success", `קטגוריה עודכנה`);
            { const _c = JSON.parse(sessionStorage.getItem("staff_user")||"{}"); logActivity({ user_id: _c.id, user_name: _c.full_name, action: "category_rename", entity: "categories", entity_id: action.newName, details: { old_name: action.oldName, new_name: action.newName, type: action.type } }); }
          } else if(action.action==="delete") {
            // Verify against DB (not just local state) that no items use this category
            const { data: dbItems } = await supabase.from("equipment").select("id").eq("category", action.name);
            const hasItems = (dbItems && dbItems.length > 0) || equipment.some(e => e.category===action.name);
            if(hasItems) { showToast("error", "לא ניתן למחוק — יש ציוד בקטגוריה זו. העבר את הפריטים קודם."); return; }
            const updatedCats = categories.filter(c => c!==action.name);
            const updatedTypes = {...categoryTypes};
            delete updatedTypes[action.name];
            setCategories(updatedCats);
            setCategoryTypes(updatedTypes);
            await Promise.all([storageSet("categories", updatedCats), storageSet("categoryTypes", updatedTypes)]);
            showToast("success", `קטגוריה "${action.name}" נמחקה`);
            { const _c = JSON.parse(sessionStorage.getItem("staff_user")||"{}"); logActivity({ user_id: _c.id, user_name: _c.full_name, action: "category_delete", entity: "categories", entity_id: action.name, details: { name: action.name } }); }
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
          {[{v:"",l:"כללי"},{v:"סאונד",l:<><Mic size={13} strokeWidth={1.75}/> סאונד</>},{v:"צילום",l:<><Camera size={13} strokeWidth={1.75}/> צילום</>}].map(({v,l})=>(
            <button key={v} type="button" onClick={()=>setType(v)}
              style={{padding:"6px 16px",borderRadius:8,border:`2px solid ${type===v?"var(--accent)":"var(--border)"}`,background:type===v?"var(--accent-glow)":"transparent",color:type===v?"var(--accent)":"var(--text2)",fontWeight:700,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
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

  const typeLabel = (t) => t === "סאונד" ? <><Mic size={14} strokeWidth={1.75} /> סאונד</> : t === "צילום" ? <><Camera size={14} strokeWidth={1.75} /> צילום</> : "כללי";
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
        {[{k:"סאונד",l:<><Mic size={12} strokeWidth={1.75}/> סאונד</>},{k:"צילום",l:<><Camera size={12} strokeWidth={1.75}/> צילום</>},{k:"",l:"כללי"}].map(({k,l})=>{
          const active=typeFilters.includes(k);
          return <button key={k} type="button" onClick={()=>toggleTypeFilter(k)}
            style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
            {l}
          </button>;
        })}
        {typeFilters.length>0&&<button type="button" onClick={()=>setTypeFilters([])} style={{padding:"4px 10px",borderRadius:20,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",gap:3}}><X size={10} strokeWidth={1.75} color="var(--text3)"/> הכל</button>}
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
                    {[{v:"סאונד",l:<Mic size={13} strokeWidth={1.75}/>},{v:"צילום",l:<Camera size={13} strokeWidth={1.75}/>},{v:"",l:"כללי"}].map(({v,l})=>{
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
                    title="ערוך שם"><Pencil size={12} strokeWidth={1.75} color="var(--text3)"/></button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => onSave({action:"delete", name: c})}
                    title="מחק"><Trash2 size={14} strokeWidth={1.75} /></button>
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
  const LOAN_FILTERS = [{key:"הכל",label:"הכל",icon:<Package size={11} strokeWidth={1.75}/>},{key:"פרטית",label:"פרטית",icon:<User size={11} strokeWidth={1.75}/>},{key:"הפקה",label:"הפקה",icon:<Film size={11} strokeWidth={1.75}/>},{key:"סאונד",label:"סאונד",icon:<Mic size={11} strokeWidth={1.75}/>},{key:"קולנוע יומית",label:"קולנוע יומית",icon:<Camera size={11} strokeWidth={1.75}/>},{key:"שיעור",label:"שיעור",icon:<Video size={11} strokeWidth={1.75}/>},{key:"צוות",label:"איש צוות",icon:<Briefcase size={11} strokeWidth={1.75}/>}];
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
        <div style={{fontWeight:800,fontSize:13,color:"var(--text2)",display:"flex",alignItems:"center",gap:4}}><Calendar size={13} strokeWidth={1.75}/> השאלות הפעילות</div>
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
      {items.length>0&&<div className="highlight-box" style={{display:"flex",alignItems:"center",gap:6}}><ShoppingCart size={14} strokeWidth={1.75}/> נבחרו {items.length} סוגים ({totalQty} יחידות)</div>}
      {privateLoanLimitExceeded && (
        <div className="toast toast-error" style={{marginBottom:12,position:"static",minWidth:0,width:"100%"}}>
          <span><XCircle size={14} strokeWidth={1.75}/></span>
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
                {showAll ? <><Package size={16} strokeWidth={1.75}/> {`כל הציוד במחסן (${equipment.length} פריטים)`}</> : <><ClipboardList size={16} strokeWidth={1.75}/> {`פרטי הציוד שנבחר (${items.length} פריטים)`}</>}
              </div>
              <div style={{display:"flex",gap:8}}>
                <button className="btn btn-secondary btn-sm"
                  style={{background:showAll?"var(--accent-glow)":"transparent",border:`1px solid ${showAll?"var(--accent)":"var(--border)"}`,color:showAll?"var(--accent)":"var(--text2)",fontWeight:700}}
                  onClick={()=>setShowAll(p=>!p)}>
                  <Package size={14} strokeWidth={1.75}/> {showAll?"רק הנבחרים":"כל הציוד"}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={()=>setShowInfo(false)} style={{display:"flex",alignItems:"center",gap:4}}><X size={14} strokeWidth={1.75} color="var(--text3)"/> סגור</button>
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
                        {isSelected&&<span style={{background:"var(--accent-glow)",border:"1px solid var(--accent)",borderRadius:20,padding:"1px 8px",fontSize:11,color:"var(--accent)",fontWeight:700,display:"inline-flex",alignItems:"center",gap:2}}><Check size={10} strokeWidth={2}/> ×{items.find(i=>i.equipment_id==itm.equipment_id)?.quantity}</span>}
                        {eq.notes&&<span style={{fontSize:11,color:"var(--text3)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:220}}>{"\uD83D\uDCDD"} {eq.notes}</span>}
                      </div>
                      {(eq.soundOnly || eq.photoOnly)&&<div style={{marginTop:8,display:"flex",gap:6,flexWrap:"wrap"}}>
                        {eq.soundOnly&&<span style={{background:"rgba(245,166,35,0.12)",border:"1px solid rgba(245,166,35,0.4)",borderRadius:20,padding:"1px 8px",fontSize:11,color:"var(--accent)",fontWeight:700,display:"inline-flex",alignItems:"center",gap:3}}><Mic size={10} strokeWidth={1.75}/> ציוד סאונד</span>}
                        {eq.photoOnly&&<span style={{background:"rgba(39,174,96,0.12)",border:"1px solid rgba(39,174,96,0.35)",borderRadius:20,padding:"1px 8px",fontSize:11,color:"var(--green)",fontWeight:700,display:"inline-flex",alignItems:"center",gap:3}}><Camera size={10} strokeWidth={1.75}/> ציוד צילום</span>}
                      </div>}
                      <div style={{marginTop:"auto",paddingTop:8,fontSize:11,color:"var(--text3)",fontWeight:700}}>{"\u05DC\u05D7\u05E5 \u05DC\u05E4\u05EA\u05D9\u05D7\u05EA \u05D4\u05E4\u05E8\u05D9\u05D8 \u05D1\u05DE\u05E1\u05DA \u05DE\u05DC\u05D0"}</div>
                    </div>
                    {/* Image — fixed left */}
                    <div style={{width:"clamp(100px,28vw,240px)",flexShrink:0,background:"var(--surface2)",overflow:"hidden",borderLeft:"1px solid var(--border)"}}>
                      {isImg
                        ? <img src={cloudinaryThumb(eq.image)} alt={eq.name} style={{width:"100%",height:"100%",objectFit:"contain",display:"block",background:"var(--surface2)"}}/>
                        : <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:64}}>{eq.image||<Package size={64} strokeWidth={1.75} color="var(--text3)"/>}</div>
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

  const relevantKits = (kits||[]).filter(k => !(k.loanTypes||[]).includes("שיעור") && (!(k.loanTypes||[]).length || (k.loanTypes||[]).includes(loanType)));

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
  const selectedItemCount = visibleAvailEq.filter(e=>getItem(e.id).quantity>0).length;

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
              { key:"all", label:"כל הציוד", icon:<Package size={14} strokeWidth={1.75}/> },
              { key:"sound", label:"ציוד סאונד", icon:<Mic size={14} strokeWidth={1.75}/> },
              { key:"photo", label:"ציוד צילום", icon:<Camera size={11} strokeWidth={1.75}/> },
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
        <button type="button" onClick={()=>{ if(!showSelectedOnly) setSelectedCats([]); setShowSelectedOnly(p=>!p); }}
          style={{padding:"5px 12px",borderRadius:20,border:`2px solid ${showSelectedOnly?"var(--green)":selectedItemCount>0?"var(--accent)":"var(--border)"}`,background:showSelectedOnly?"rgba(46,204,113,0.12)":selectedItemCount>0?"var(--accent-glow)":"transparent",color:showSelectedOnly?"var(--green)":selectedItemCount>0?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap",boxShadow:selectedItemCount>0&&!showSelectedOnly?"0 0 0 3px rgba(255,193,7,0.15)":"none",transition:"all 0.2s"}}>
          {showSelectedOnly?<><CheckCircle size={12} strokeWidth={1.75}/> הצג הכל</>:<><CheckCircle size={12} strokeWidth={1.75}/> הצג נבחרים{selectedItemCount>0?` (${selectedItemCount})`:""}</>}
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
            style={{padding:"4px 8px",borderRadius:20,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",gap:3}}>
            <X size={10} strokeWidth={1.75} color="var(--text3)"/> נקה
          </button>
        )}
      </div>

      {/* ── Kit selector ── */}
      {relevantKits.length>0 && (
        <div style={{marginBottom:20,padding:"14px 16px",background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)"}}>
          <div style={{fontSize:12,fontWeight:800,color:"var(--accent)",marginBottom:10,letterSpacing:0.5,display:"flex",alignItems:"center",gap:4}}><Package size={12} strokeWidth={1.75}/> ערכות מוכנות לסוג השאלה זה</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:activeKit?10:0}}>
            {/* "All equipment" pill */}
            <button type="button"
              onClick={()=>setActiveKit(null)}
              style={{padding:"7px 14px",borderRadius:20,border:`2px solid ${!activeKit?"var(--text2)":"var(--border)"}`,background:!activeKit?"var(--surface3)":"transparent",color:!activeKit?"var(--text)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer",transition:"all 0.15s"}}>
              <Package size={13} strokeWidth={1.75}/> כל הציוד
            </button>
            {relevantKits.map(kit=>{
              const isActive = activeKit?.id===kit.id;
              return (
                <button key={kit.id} type="button"
                  onClick={()=>selectKit(kit)}
                  style={{padding:"7px 16px",borderRadius:20,border:`2px solid ${isActive?"var(--accent)":"var(--border)"}`,background:isActive?"var(--accent)":"var(--surface3)",color:isActive?"#000":"var(--text2)",fontWeight:700,fontSize:13,cursor:"pointer",transition:"all 0.15s",display:"flex",alignItems:"center",gap:6}}>
                  <Package size={13} strokeWidth={1.75}/> {kit.name}
                  {isActive&&<span style={{fontSize:10,opacity:0.7,display:"inline-flex",alignItems:"center",gap:2}}><Check size={9} strokeWidth={2}/> פעיל</span>}
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
                    : <span style={{fontSize:26}}>{eq.image||<Package size={26} strokeWidth={1.75} color="var(--text3)"/>}</span>}
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:14}}>{eq.name}</div>
                    <div style={{fontSize:12,color:"var(--text3)"}}>
                      זמין: <span style={{color:eq.avail===0?"var(--red)":eq.avail<=2?"var(--yellow)":"var(--green)",fontWeight:700}}>{eq.avail}</span>
                      {activeKit&&kitEntry&&<span style={{color:"var(--accent)",marginRight:6,fontWeight:700}}>· מקס׳ בערכה: {kitMax}</span>}
                    </div>
                  </div>
                  {!canBorrowEq(eq)
                    ? <div style={{fontSize:11,color:"var(--yellow)",fontWeight:700,textAlign:"center",maxWidth:120,lineHeight:1.3,padding:"4px 6px",background:"rgba(241,196,15,0.12)",borderRadius:6,border:"1px solid rgba(241,196,15,0.3)",display:"flex",alignItems:"center",gap:3,justifyContent:"center"}}>
                        <Shield size={11} strokeWidth={1.75}/> טרם עבר/ה הסמכה
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
                        <span style={{display:"inline-flex",alignItems:"center",gap:4}}><AlertTriangle size={12} strokeWidth={1.75} /> חסום ע״י השאלה באיחור</span>
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
          const img = eq?.image||"";
          const isFile = img.startsWith("data:")||img.startsWith("http");
          return <div key={i.equipment_id} className="req-detail-row">
            {isFile ? <img src={img} alt="" style={{width:20,height:20,objectFit:"cover",borderRadius:4,verticalAlign:"middle"}}/> : <span>{img||<Package size={16} strokeWidth={1.75} color="var(--text3)"/>}</span>}
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
          <ClipboardList size={16} strokeWidth={1.75}/> נהלי ההשאלה — חובה לקרוא לפני שליחה
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
        <button className="btn btn-primary" disabled={!canSubmit||submitting} onClick={submit}>{submitting?<><Clock size={13} strokeWidth={1.75}/> שולח...</>:"🚀 שלח בקשה"}</button>
      </div>

      {/* ── Fullscreen policies modal ── */}
      {showPolicies && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:4000,display:"flex",flexDirection:"column",direction:"rtl"}}>
          {/* Header */}
          <div style={{padding:"16px 20px",background:"var(--surface)",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
            <div style={{fontWeight:900,fontSize:17,display:"flex",alignItems:"center",gap:6}}><ClipboardList size={17} strokeWidth={1.75}/> נהלי השאלה — {loanType}</div>
            <button className="btn btn-secondary btn-sm" onClick={()=>setShowPolicies(false)} style={{display:"flex",alignItems:"center",gap:4}}><X size={14} strokeWidth={1.75} color="var(--text3)"/> סגור</button>
          </div>
          {/* Scrollable body */}
          <div
            onScroll={handleScroll}
            style={{flex:1,overflowY:"auto",padding:"24px 20px",background:"var(--surface2)",fontSize:15,lineHeight:1.9,color:"var(--text)"}}>
            <div className="policy-content" dangerouslySetInnerHTML={{__html:policyHtml(policyText)}} />
            {/* bottom anchor */}
            <div style={{height:60,display:"flex",alignItems:"center",justifyContent:"center",marginTop:24}}>
              {scrolledToBottom
                ? <span style={{color:"var(--green)",fontWeight:700,fontSize:14,display:"inline-flex",alignItems:"center",gap:4}}><CheckCircle size={14} strokeWidth={1.75}/> קראת את כל הנהלים</span>
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
              {scrolledToBottom ? <><CheckCircle size={14} strokeWidth={1.75}/> אני מאשר/ת שקראתי את הנהלים — סגור</> : "↓ גלול עד הסוף כדי לאשר"}
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
    { id:"equipment", label:<><Package size={14} strokeWidth={1.75}/> ציוד</> },
    { id:"policies",  label:<><ClipboardList size={14} strokeWidth={1.75}/> נהלים</> },
    { id:"kits",      label:<><Package size={14} strokeWidth={1.75}/> ערכות</> },
    { id:"contact",   label:<><Phone size={14} strokeWidth={1.75}/> צוות</> },
  ];
  const LOAN_ICONS = { "פרטית":<User size={11} strokeWidth={1.75}/>,"הפקה":<Film size={11} strokeWidth={1.75}/>,"סאונד":<Mic size={11} strokeWidth={1.75}/>,"קולנוע יומית":<Camera size={11} strokeWidth={1.75}/> };
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
            <div style={{fontWeight:900,fontSize:20,color:"var(--accent)",display:"flex",alignItems:"center",gap:6}}><Info size={20} strokeWidth={1.75}/> מידע כללי — מחסן ציוד קמרה אובסקורה וסאונד</div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose} style={{fontSize:14,padding:"8px 18px",display:"flex",alignItems:"center",gap:4}}><X size={14} strokeWidth={1.75} color="var(--text3)"/> סגור</button>
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
                  {infoCatFilter.length>0&&<button type="button" onClick={()=>setInfoCatFilter([])} style={{padding:"5px 10px",borderRadius:20,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}><X size={10} strokeWidth={1.75} color="var(--text3)"/> הכל</button>}
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
                              : <span style={{display:"flex",alignItems:"center",justifyContent:"center"}}>{eq.image?<span style={{fontSize:48}}>{eq.image}</span>:<Package size={48} strokeWidth={1.5}/>}</span>}
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
                    : <div style={{width:200,height:200,display:"flex",alignItems:"center",justifyContent:"center"}}>{selectedEq.image?<span style={{fontSize:100}}>{selectedEq.image}</span>:<Package size={80} strokeWidth={1.5}/>}</div>
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
                      <FileText size={13} strokeWidth={1.75} style={{flexShrink:0}}/> <strong>הערות:</strong> {selectedEq.notes}
                    </div>
                  )}
                  <div style={{marginTop:16,display:"flex",gap:8,flexWrap:"wrap"}}>
                    {selectedEq.soundOnly&&<span style={{background:"rgba(245,166,35,0.12)",border:"1px solid rgba(245,166,35,0.4)",borderRadius:20,padding:"4px 12px",fontSize:12,color:"var(--accent)",fontWeight:700,display:"inline-flex",alignItems:"center",gap:4}}><Mic size={12} strokeWidth={1.75}/> ציוד סאונד</span>}
                    {selectedEq.photoOnly&&<span style={{background:"rgba(39,174,96,0.12)",border:"1px solid rgba(39,174,96,0.35)",borderRadius:20,padding:"4px 12px",fontSize:12,color:"var(--green)",fontWeight:700,display:"inline-flex",alignItems:"center",gap:4}}><Camera size={12} strokeWidth={1.75}/> ציוד צילום</span>}
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
                    <div className="policy-content" style={{fontSize:14,lineHeight:1.9,color:"var(--text2)",background:"var(--surface2)",borderRadius:"var(--r)",padding:"18px 20px",border:"1px solid var(--border)"}} dangerouslySetInnerHTML={{__html:policyHtml(text)}} />
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
                : (kits||[]).filter(k=>!(k.loanTypes||[]).includes("שיעור")).map(kit=>(
                  <div key={kit.id} style={{background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",padding:"20px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:kit.description?8:14,flexWrap:"wrap"}}>
                      <span style={{fontWeight:900,fontSize:17,display:"flex",alignItems:"center",gap:6}}><Package size={16} strokeWidth={1.75}/> {kit.name}</span>
                      {(kit.loanTypes||[]).map(lt=><span key={lt} style={{fontSize:12,background:"var(--accent-glow)",border:"1px solid var(--accent)",borderRadius:20,padding:"2px 10px",color:"var(--accent)",fontWeight:700,display:"inline-flex",alignItems:"center",gap:4}}>{LOAN_ICONS[lt]||<Package size={11} strokeWidth={1.75}/>} {lt}</span>)}
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
                              {isImg ? <img src={cloudinaryThumb(eq.image)} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}}/> : (eq?.image?<span style={{fontSize:22}}>{eq.image}</span>:<Package size={22} strokeWidth={1.5}/>)}
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
                      {m.phone&&<div style={{fontSize:13,color:"var(--text2)",marginBottom:2,display:"flex",alignItems:"center",gap:4}}><Phone size={12} strokeWidth={1.75}/> {m.phone}</div>}
                      <div style={{fontSize:12,color:"var(--text3)",wordBreak:"break-all"}}>{m.email}</div>
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
    { key:"פרטית", icon:<User size={15} strokeWidth={1.75}/>, label:"השאלה פרטית" },
    { key:"הפקה",  icon:<Film size={15} strokeWidth={1.75}/>, label:"השאלה להפקה" },
    { key:"סאונד", icon:<Mic size={15} strokeWidth={1.75}/>, label:"השאלת סאונד" },
    { key:"קולנוע יומית", icon:<Camera size={15} strokeWidth={1.75}/>, label:"השאלת קולנוע יומית" },
    { key:"לילה", icon:"🌙", label:"נהלי קביעת חדר לילה" }, // 🌙 intentional: moon icon, no Lucide equivalent
  ];
  const [draft, setDraft] = useState({ ...policies });
  const [saving, setSaving] = useState(false);
  const [fsEdit, setFsEdit] = useState(null); // key being fullscreen-edited
  const [pdfUploading, setPdfUploading] = useState(false);
  const fsRef = useRef(null);

  // Convert old markdown format to HTML (one-time migration when opening editor)
  function mdToHtml(text) {
    if (!text) return "";
    if (/<[a-z]/i.test(text)) return text; // already HTML
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

  useEffect(() => {
    if (!fsEdit || !fsRef.current) return;
    // Set innerHTML for display only — do NOT call setDraft here (causes null.innerHTML crash)
    fsRef.current.innerHTML = mdToHtml(draft[fsEdit] || "");
    setTimeout(() => fsRef.current?.focus(), 0);
  }, [fsEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyFormat(type) {
    // Do NOT call focus() here — toolbar buttons use onMouseDown+preventDefault
    // to keep focus+selection; keyboard shortcuts are already focused.
    if (type === "bold")     document.execCommand("bold",                false, null);
    if (type === "bullet")   document.execCommand("insertUnorderedList", false, null);
    if (type === "numbered") document.execCommand("insertOrderedList",   false, null);
    // Read innerHTML after a tick so execCommand has finished mutating the DOM
    setTimeout(() => {
      setDraft(p => ({ ...p, [fsEdit]: fsRef.current?.innerHTML || p[fsEdit] }));
    }, 0);
  }

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
      showToast("success", "המסמך הועלה בהצלחה");
    } catch {
      showToast("error", "שגיאה בעיבוד הקובץ");
    }
    setPdfUploading(false);
  };

  const save = async (overrideDraft) => {
    const toSave = overrideDraft || draft;
    setSaving(true);
    setPolicies(toSave);
    setDraft(toSave);
    const r = await storageSet("policies", toSave);
    setSaving(false);
    if(r.ok) showToast("success", "הנהלים נשמרו בהצלחה");
    else showToast("error", "שגיאה בשמירת הנהלים");
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
            <button className="btn btn-secondary btn-sm" onClick={()=>setFsEdit(lt.key)} style={{display:"inline-flex",alignItems:"center",gap:4}}><Pencil size={12} strokeWidth={1.75} color="var(--text3)"/> עריכה מורחבת</button>
          </div>
          {draft[lt.key]
            ? <div
                className="form-input policy-content"
                dangerouslySetInnerHTML={{__html: draft[lt.key]}}
                style={{minHeight:120,maxHeight:200,overflowY:"auto",lineHeight:1.7,fontSize:13,cursor:"default"}}
              />
            : <div className="form-input" style={{minHeight:120,color:"var(--text3)",fontSize:13,lineHeight:1.7}}>
                {`כתוב כאן את נהלי ${lt.label}...`}
              </div>
          }
        </div>
      ))}
      {/* Commitment PDF */}
      <div className="card" style={{marginBottom:20}}>
        <div className="card-header"><div className="card-title" style={{display:"flex",alignItems:"center",gap:6}}><FileText size={15} strokeWidth={1.75}/> מסמך התחייבות — נהלי השאלת ציוד</div></div>
        <div style={{padding:"16px 20px"}}>
          <div style={{fontSize:12,color:"var(--text3)",marginBottom:14,lineHeight:1.7}}>
            המסמך יוצג לסטודנטים בפאנל "נהלים" עם אפשרות הורדה. הסטודנט נדרש להדפיסו ולחתום עליו לפני השאלה ראשונה.
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <label className="btn btn-secondary" style={{cursor:pdfUploading?"not-allowed":"pointer",opacity:pdfUploading?0.6:1}}>
              {pdfUploading ? <><Clock size={13} strokeWidth={1.75}/> מעלה...</> : "📤 העלה מסמך PDF"}
              <input type="file" accept="application/pdf" style={{display:"none"}} onChange={handleCommitmentPdfUpload} disabled={pdfUploading}/>
            </label>
            {draft.commitmentPdf && (
              <button type="button" className="btn btn-secondary" onClick={()=>setDraft(p=>({...p,commitmentPdf:"",commitmentPdfCompressed:false,commitmentPdfName:""}))} style={{fontSize:12}}>
                <Trash2 size={14} strokeWidth={1.75} /> הסר מסמך
              </button>
            )}
          </div>
          {draft.commitmentPdf && (
            <div style={{marginTop:12,padding:"10px 14px",background:"rgba(39,174,96,0.08)",border:"1px solid rgba(39,174,96,0.3)",borderRadius:8,display:"flex",alignItems:"center",gap:10}}>
              <CheckCircle size={18} strokeWidth={1.75} color="var(--green)"/>
              <div>
                <div style={{fontSize:13,fontWeight:800,color:"var(--green)"}}>מסמך טעון</div>
                {draft.commitmentPdfName&&<div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{draft.commitmentPdfName}</div>}
              </div>
            </div>
          )}
        </div>
      </div>

      <button className="btn btn-primary" disabled={saving} onClick={()=>save()}>
        {saving ? <><Clock size={13} strokeWidth={1.75}/> שומר...</> : <><Save size={14} strokeWidth={1.75}/> שמור נהלים</>}
      </button>

      {/* Fullscreen editor */}
      {fsEdit&&lt_active&&(
        <div style={{position:"fixed",inset:0,background:"var(--bg)",zIndex:4000,display:"flex",flexDirection:"column",direction:"rtl"}}>
          <div style={{padding:"16px 20px",background:"var(--surface)",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
            <div style={{fontWeight:900,fontSize:17}}>{lt_active.icon} עריכת נהלי {lt_active.label}</div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-primary btn-sm" onClick={async()=>{ const toSave=fsRef.current?{...draft,[fsEdit]:fsRef.current.innerHTML}:draft; await save(toSave); setFsEdit(null); }} style={{display:"inline-flex",alignItems:"center",gap:4}}><Save size={14} strokeWidth={1.75}/> שמור וסגור</button>
              <button className="btn btn-secondary btn-sm" onClick={()=>setFsEdit(null)} style={{display:"flex",alignItems:"center",gap:4}}><X size={14} strokeWidth={1.75} color="var(--text3)"/> סגור</button>
            </div>
          </div>
          {/* Formatting toolbar */}
          <div style={{padding:"8px 16px",background:"var(--surface)",borderBottom:"1px solid var(--border)",display:"flex",gap:6,flexShrink:0}}>
            {[
              { type:"bold",     label:<><strong>B</strong></>, title:"מודגש (Ctrl+B)" },
              { type:"bullet",   label:"• רשימה",               title:"נקודות" },
              { type:"numbered", label:"1. ממוספר",             title:"רשימה ממוספרת" },
            ].map(btn=>(
              <button key={btn.type} onMouseDown={e=>{e.preventDefault();applyFormat(btn.type);}}
                title={btn.title}
                style={{padding:"4px 12px",border:"1px solid var(--border)",borderRadius:6,background:"var(--surface2)",color:"var(--text)",cursor:"pointer",fontSize:13,fontFamily:"inherit"}}>
                {btn.label}
              </button>
            ))}
          </div>
          <div
            ref={fsRef}
            contentEditable
            suppressContentEditableWarning
            onInput={e=>{const html=e.currentTarget.innerHTML;setDraft(p=>({...p,[fsEdit]:html}))}}
            onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==="b"){e.preventDefault();applyFormat("bold");}}}
            data-placeholder={`כתוב כאן את נהלי ${lt_active.label}...`}
            className="policy-content"
            style={{flex:1,padding:"20px",background:"var(--surface2)",border:"none",outline:"none",overflowY:"auto",fontFamily:"inherit",fontSize:15,lineHeight:1.9,color:"var(--text)",direction:"rtl",minHeight:0}}
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
    await deleteReservation(id); // Stage 5 — delete from Supabase (previously only blob)
    const updated = reservations.filter(r=>r.id!==id);
    setReservations(updated);
    showToast("success", "הבקשה נמחקה מהארכיון");
    if(viewRes?.id===id) setViewRes(null);
  };

  const eqName = id => equipment.find(e=>e.id==id)?.name||"?";
  const EqImg = ({id,size=20}) => {
    const img = equipment.find(e=>e.id==id)?.image||"";
    return img.startsWith("data:")||img.startsWith("http")
      ? <img src={img} alt="" style={{width:size,height:size,objectFit:"cover",borderRadius:4,verticalAlign:"middle"}}/>
      : <span style={{fontSize:size*0.8}}>{img||<Package size={size*0.8} strokeWidth={1.75} color="var(--text3)"/>}</span>;
  };

  const LOAN_ICONS = {"פרטית":<User size={11} strokeWidth={1.75}/>,"הפקה":<Film size={11} strokeWidth={1.75}/>,"סאונד":<Mic size={11} strokeWidth={1.75}/>,"קולנוע יומית":<Camera size={11} strokeWidth={1.75}/>,"שיעור":<Video size={11} strokeWidth={1.75}/>};
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
            <div style={{width:34,height:34,borderRadius:"50%",background:isLesson?"rgba(155,89,182,0.2)":"rgba(52,152,219,0.15)",border:`2px solid ${isLesson?"#9b59b6":"var(--blue)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,flexShrink:0,color:isLesson?"#9b59b6":"var(--blue)"}}>{isLesson?<Video size={16} strokeWidth={1.75}/>:r.student_name?.[0]||"?"}</div>
            <div>
              <div style={{fontWeight:700,fontSize:14}}>{r.student_name}{isLesson&&r.course&&<span style={{fontSize:11,color:"#9b59b6",fontWeight:700,marginRight:6}}>· {r.course}</span>}</div>
              <div style={{fontSize:11,color:"var(--text3)"}}>{r.email}</div>
            </div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
            {isLesson
              ? <span style={{background:"rgba(155,89,182,0.12)",color:"#9b59b6",border:"1px solid rgba(155,89,182,0.4)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700,display:"inline-flex",alignItems:"center",gap:4}}><Video size={11} strokeWidth={1.75}/> שיעור הסתיים</span>
              : <span style={{background:"rgba(52,152,219,0.12)",color:"var(--blue)",border:"1px solid rgba(52,152,219,0.4)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>הוחזר</span>}
            {r.loan_type&&!isLesson&&<span style={{background:"var(--surface3)",border:"1px solid var(--border)",borderRadius:20,padding:"2px 8px",fontSize:11,color:"var(--accent)",fontWeight:700,display:"inline-flex",alignItems:"center",gap:3}}>{LOAN_ICONS[r.loan_type]||<Package size={11} strokeWidth={1.75}/>} {r.loan_type}</span>}
            <button className="btn btn-danger btn-sm" onClick={e=>{e.stopPropagation();deleteRes(r.id);}}><Trash2 size={14} strokeWidth={1.75} /></button>
          </div>
        </div>
        <div style={{marginTop:10,display:"flex",gap:16,fontSize:12,color:"var(--text2)",flexWrap:"wrap"}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:3}}><Calendar size={12} strokeWidth={1.75}/> {formatDate(r.borrow_date)}{r.borrow_time&&<strong style={{color:"var(--accent)",marginRight:4}}> {r.borrow_time}</strong>}</span>
          <span>↩ {formatDate(r.return_date)}{r.return_time&&<strong style={{color:"var(--accent)",marginRight:4}}> {r.return_time}</strong>}</span>
          <span style={{display:"inline-flex",alignItems:"center",gap:3}}><Package size={12} strokeWidth={1.75}/> {r.items?.length||0} פריטים</span>
          {r.returned_at&&<span style={{color:"var(--text3)",display:"inline-flex",alignItems:"center",gap:4}}><Clock size={11} strokeWidth={1.75}/> הוחזר: {new Date(r.returned_at).toLocaleDateString("he-IL")}</span>}
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
        <div className="search-bar" style={{flex:1,minWidth:160}}><span><Search size={14} strokeWidth={1.75} color="var(--text3)"/></span><input placeholder="חיפוש לפי שם, מייל או קורס..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <span style={{fontSize:13,color:"var(--text3)"}}>סה״כ: <strong style={{color:"var(--text)"}}>{totalShown}</strong> בקשות</span>
      </div>

      {/* Section chips */}
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {[["הכל",<><Package size={13} strokeWidth={1.75}/> הכל</>,"var(--text2)"],["השאלות",<><Package size={13} strokeWidth={1.75}/> השאלות סטודנטים</>,"var(--blue)"],["שיעורים",<><Film size={13} strokeWidth={1.75}/> שיעורים</>,"#9b59b6"]].map(([val,label,col])=>(
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
              <SectionHeader label={<><Package size={13} strokeWidth={1.75}/> השאלות סטודנטים שהוחזרו</>} color="var(--blue)" count={studentArchive.length}/>
              <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:8}}>
                {studentArchive.map(r=><ResCard key={r.id} r={r}/>)}
              </div>
            </>
          )}
          {/* ── Lesson section ── */}
          {showLessons&&lessonArchive.length>0&&(
            <>
              <SectionHeader label={<><Video size={13} strokeWidth={1.75}/> שיעורים שהסתיימו</>} color="#9b59b6" count={lessonArchive.length}/>
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
                <div style={{fontWeight:900,fontSize:17,display:"flex",alignItems:"center",gap:6}}>{isLesson?<><Video size={16} strokeWidth={1.75}/> פרטי שיעור — ארכיון</>:"פרטי השאלה — ארכיון"}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:3}}>{viewRes.student_name}</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={()=>setViewRes(null)} style={{display:"flex",alignItems:"center",gap:4}}><X size={14} strokeWidth={1.75} color="var(--text3)"/> סגור</button>
            </div>
            <div style={{padding:"20px 22px",display:"flex",flexDirection:"column",gap:16}}>
              <div style={{display:"flex",justifyContent:"center"}}>
                {isLesson
                  ? <span style={{background:"rgba(155,89,182,0.12)",color:"#9b59b6",border:"1px solid rgba(155,89,182,0.4)",borderRadius:20,padding:"4px 18px",fontSize:13,fontWeight:700,display:"inline-flex",alignItems:"center",gap:6}}><Video size={13} strokeWidth={1.75}/> שיעור הסתיים</span>
                  : <span style={{background:"rgba(52,152,219,0.12)",color:"var(--blue)",border:"1px solid rgba(52,152,219,0.4)",borderRadius:20,padding:"4px 18px",fontSize:13,fontWeight:700}}>הוחזר</span>}
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
                  {[[<><Calendar size={11} strokeWidth={1.75}/> השאלה</>,`${formatDate(viewRes.borrow_date)}${viewRes.borrow_time?" · "+viewRes.borrow_time:""}`],["↩ החזרה",`${formatDate(viewRes.return_date)}${viewRes.return_time?" · "+viewRes.return_time:""}`]].map(([l,v])=>(
                    <div key={l} style={{background:"var(--surface3)",borderRadius:"var(--r-sm)",padding:"10px 12px"}}>
                      <div style={{fontSize:11,color:"var(--text3)",marginBottom:4}}>{l}</div>
                      <div style={{fontWeight:700,fontSize:13,color:"var(--accent)"}}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:8,fontSize:12,color:"var(--text3)"}}>
                  סוג השאלה: <strong style={{color:"var(--text)",display:"inline-flex",alignItems:"center",gap:3}}>{LOAN_ICONS[viewRes.loan_type]||<Package size={11} strokeWidth={1.75}/>} {viewRes.loan_type}</strong>
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
  const LOAN_ICONS = { "פרטית":<User size={11} strokeWidth={1.75}/>, "הפקה":<Film size={11} strokeWidth={1.75}/>, "סאונד":<Mic size={11} strokeWidth={1.75}/>, "קולנוע יומית":<Camera size={11} strokeWidth={1.75}/> };
  const emptyForm = { name:"", email:"", phone:"", loanTypes:[...LOAN_TYPES] };
  const DH_LOAN_TYPES = ["הפקה","סאונד","קולנוע יומית"];
  const DH_LOAN_ICONS = { "הפקה":<Film size={11} strokeWidth={1.75}/>, "סאונד":<Mic size={11} strokeWidth={1.75}/>, "קולנוע יומית":<Camera size={11} strokeWidth={1.75}/> };
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
    else showToast("error","שגיאה בשמירה");
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
    if(r.ok) {
      showToast("success", `${name} נוסף/ה כראש מחלקה`);
      const caller = JSON.parse(sessionStorage.getItem("staff_user")||"{}");
      logActivity({ user_id: caller.id, user_name: caller.full_name, action: "dept_head_add", entity: "deptHeads", entity_id: String(updated[updated.length-1].id), details: { name, email, role: dhForm.role } });
      setDhForm(emptyDhForm); setAddingDh(false);
    }
    else showToast("error","שגיאה בשמירה");
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
    if(r.ok) {
      showToast("success","פרטי ראש המחלקה עודכנו");
      const caller = JSON.parse(sessionStorage.getItem("staff_user")||"{}");
      logActivity({ user_id: caller.id, user_name: caller.full_name, action: "dept_head_edit", entity: "deptHeads", entity_id: String(editDh.id), details: { name, email } });
      setEditDh(null);
    }
    else showToast("error","שגיאה בשמירה");
  };

  const delDh = async (id) => {
    const target = deptHeads.find(dh=>dh.id===id);
    const updated = deptHeads.filter(dh=>dh.id!==id);
    setDeptHeads(updated);
    await storageSet("deptHeads", updated);
    showToast("success","ראש המחלקה הוסר");
    const caller = JSON.parse(sessionStorage.getItem("staff_user")||"{}");
    logActivity({ user_id: caller.id, user_name: caller.full_name, action: "dept_head_delete", entity: "deptHeads", entity_id: String(id), details: { name: target?.name, email: target?.email } });
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
    if(!_tmNew.ok) showToast("error", "שגיאה בשמירה — נסה שוב");
    else {
      showToast("success", `${name} נוסף לצוות`);
      const caller = JSON.parse(sessionStorage.getItem("staff_user")||"{}");
      logActivity({ user_id: caller.id, user_name: caller.full_name, action: "team_member_add", entity: "teamMembers", entity_id: String(updated[updated.length-1].id), details: { name, email, role: addForm.role } });
    }
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
    if(!_tmEditRes.ok) showToast("error", "שגיאה בשמירה — נסה שוב");
    else {
      showToast("success", "איש צוות עודכן");
      const caller = JSON.parse(sessionStorage.getItem("staff_user")||"{}");
      logActivity({ user_id: caller.id, user_name: caller.full_name, action: "team_member_edit", entity: "teamMembers", entity_id: String(editMember.id), details: { name, email } });
    }
    setEditMember(null);
  };

  const del = async (id) => {
    const target = teamMembers.find(m => m.id===id);
    const updated = teamMembers.filter(m => m.id!==id);
    setTeamMembers(updated);
    const _tmDelRes = await storageSet("teamMembers", updated);
    if(!_tmDelRes.ok) showToast("error", "שגיאה בשמירה");
    else {
      showToast("success", "איש צוות הוסר");
      const caller = JSON.parse(sessionStorage.getItem("staff_user")||"{}");
      logActivity({ user_id: caller.id, user_name: caller.full_name, action: "team_member_delete", entity: "teamMembers", entity_id: String(id), details: { name: target?.name, email: target?.email } });
    }
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
          <div style={{fontSize:12,color:"var(--green)",marginBottom:10,display:"flex",alignItems:"center",gap:4}}><CheckCircle size={12} strokeWidth={1.75}/> מוגדר: <strong>{collegeManager.name}</strong> ({collegeManager.email})</div>
        )}
        <button className="btn btn-primary" disabled={!mgrForm.name.trim()||!mgrForm.email.trim()||mgrSaving} onClick={saveMgr}>
          {mgrSaving?<><Clock size={13} strokeWidth={1.75}/> שומר...</>:<><Save size={14} strokeWidth={1.75}/> שמור פרטי מנהל</>}
        </button>
        {/* Public daily display link */}
        <div style={{marginTop:14,background:"rgba(245,166,35,0.08)",border:"1px solid rgba(245,166,35,0.3)",borderRadius:"var(--r-sm)",padding:"10px 14px",fontSize:12}}>
          <div style={{fontWeight:700,marginBottom:6,color:"#f5a623"}}>📺 לינק לוח לוז יומי ציבורי</div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <code style={{fontSize:11,background:"var(--surface3)",padding:"3px 8px",borderRadius:4,flex:1,wordBreak:"break-all",color:"var(--text2)"}}>
              {window.location.origin}/daily
            </code>
            <button className="btn btn-secondary btn-sm" onClick={()=>{navigator.clipboard.writeText(`${window.location.origin}/daily`);showToast("success","הקישור הועתק!");}}>
              <ClipboardList size={13} strokeWidth={1.75}/> העתק
            </button>
            <a href="/daily" target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{textDecoration:"none"}}>
              <Link size={13} strokeWidth={1.75}/> פתח
            </a>
          </div>
          <div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>הצג על מסך/טלוויזיה בלובי — מתחלף אוטומטית בין לוז שיעורים לקביעות חדרים</div>
        </div>

        {/* Daily table link */}
        <div style={{marginTop:10,background:"rgba(46,204,113,0.08)",border:"1px solid rgba(46,204,113,0.3)",borderRadius:"var(--r-sm)",padding:"10px 14px",fontSize:12}}>
          <div style={{fontWeight:700,marginBottom:6,color:"#2ecc71",display:"flex",alignItems:"center",gap:4}}><ClipboardList size={13} strokeWidth={1.75}/> לינק לוח לוז יומי בפורמט טבלה</div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <code style={{fontSize:11,background:"var(--surface3)",padding:"3px 8px",borderRadius:4,flex:1,wordBreak:"break-all",color:"var(--text2)"}}>
              {window.location.origin}/daily-table
            </code>
            <button className="btn btn-secondary btn-sm" onClick={()=>{navigator.clipboard.writeText(`${window.location.origin}/daily-table`);showToast("success","הקישור הועתק!");}}>
              <ClipboardList size={13} strokeWidth={1.75}/> העתק
            </button>
            <a href="/daily-table" target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{textDecoration:"none"}}>
              <Link size={13} strokeWidth={1.75}/> פתח
            </a>
          </div>
          <div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>תצוגת טבלה פשוטה של כל קביעות היום</div>
        </div>

        {managerToken&&(
          <div style={{marginTop:14,background:"rgba(52,152,219,0.08)",border:"1px solid rgba(52,152,219,0.25)",borderRadius:"var(--r-sm)",padding:"10px 14px",fontSize:12}}>
            <div style={{fontWeight:700,marginBottom:6,color:"#3498db",display:"flex",alignItems:"center",gap:6}}><Link size={13} strokeWidth={1.75}/> קישור לוח שנה למנהל המכללה</div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <code style={{fontSize:11,background:"var(--surface3)",padding:"3px 8px",borderRadius:4,flex:1,wordBreak:"break-all",color:"var(--text2)"}}>
                {window.location.origin}/manager-calendar?token={managerToken}
              </code>
              <button className="btn btn-secondary btn-sm" onClick={()=>{navigator.clipboard.writeText(`${window.location.origin}/manager-calendar?token=${managerToken}`);showToast("success","הקישור הועתק!");}}>
                <ClipboardList size={13} strokeWidth={1.75}/> העתק
              </button>
            </div>
            <div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>שלח קישור זה למנהל — הוא יוכל לצפות ולשנות סטטוסים של כל הבקשות</div>
          </div>
        )}
      </div>

      {/* ── Dept heads section ── */}
      <div className="card" style={{marginBottom:24,border:"2px solid rgba(155,89,182,0.3)",background:"rgba(155,89,182,0.04)"}}>
        <div className="card-header">
          <div className="card-title" style={{display:"flex",alignItems:"center",gap:6}}><GraduationCap size={16} strokeWidth={1.75}/> ראשי מחלקות</div>
          <button className="btn btn-primary btn-sm" onClick={()=>setAddingDh(p=>!p)}>
            {addingDh?<><X size={13} strokeWidth={1.75} color="var(--text3)"/> ביטול</>:"➕ הוסף ראש מחלקה"}
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
              {dhSaving?<><Clock size={13} strokeWidth={1.75}/> שומר...</>:<><CheckCircle size={13} strokeWidth={1.75}/> הוסף ראש מחלקה</>}
            </button>
          </div>
        )}

        {/* Dept heads list */}
        {deptHeads.length===0
          ? <div style={{textAlign:"center",color:"var(--text3)",fontSize:13,padding:"12px 0"}}>לא נוספו ראשי מחלקות עדיין</div>
          : <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {deptHeads.map(dh=>(
              <div key={dh.id} style={{background:"var(--surface)",border:"1px solid rgba(155,89,182,0.2)",borderRadius:"var(--r-sm)",padding:"12px 16px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                <div style={{width:36,height:36,borderRadius:"50%",background:"rgba(155,89,182,0.15)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><GraduationCap size={18} strokeWidth={1.75} color="#9b59b6"/></div>
                <div style={{flex:1,minWidth:150}}>
                  <div style={{fontWeight:800,fontSize:14}}>{dh.name}</div>
                  {dh.role&&<div style={{fontSize:11,color:"#9b59b6",fontWeight:700,marginTop:1}}>{dh.role}</div>}
                  <div style={{fontSize:11,color:"var(--text3)"}}>{dh.email}</div>
                  <div style={{display:"flex",gap:4,marginTop:5,flexWrap:"wrap"}}>
                    {(dh.loanTypes||[]).map(lt=>(
                      <span key={lt} style={{background:"rgba(155,89,182,0.12)",border:"1px solid rgba(155,89,182,0.3)",borderRadius:20,padding:"1px 8px",fontSize:11,color:"#9b59b6",fontWeight:700}}>
                        {DH_LOAN_ICONS[lt]||<Package size={11} strokeWidth={1.75}/>} {lt}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button className="btn btn-secondary btn-sm" onClick={()=>{setEditDh(dh);setEditDhForm({name:dh.name,email:dh.email,role:dh.role||"",loanTypes:dh.loanTypes||[]});}}><Pencil size={12} strokeWidth={1.75} color="var(--text3)"/></button>
                  <button className="btn btn-danger btn-sm" onClick={()=>delDh(dh.id)}><Trash2 size={14} strokeWidth={1.75} /></button>
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
              <div style={{fontWeight:900,fontSize:16,display:"flex",alignItems:"center",gap:6}}><Pencil size={14} strokeWidth={1.75}/> עריכת ראש מחלקה</div>
              <button className="btn btn-secondary btn-sm" onClick={()=>setEditDh(null)}><X size={14} strokeWidth={1.75} color="var(--text3)"/></button>
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
                  {dhSaving?<><Clock size={13} strokeWidth={1.75}/> שומר...</>:<><Save size={14} strokeWidth={1.75}/> שמור</>}
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
                {m.phone&&<div style={{fontSize:12,color:"var(--text2)",marginBottom:2,display:"flex",alignItems:"center",gap:4}}><Phone size={11} strokeWidth={1.75}/> {m.phone}</div>}
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
                <button className="btn btn-secondary btn-sm" onClick={()=>{setEditMember(m);setEditForm({name:m.name,email:m.email,phone:m.phone||"",loanTypes:m.loanTypes||[...LOAN_TYPES]});}} style={{display:"inline-flex",alignItems:"center",gap:4}}><Pencil size={12} strokeWidth={1.75} color="var(--text3)"/> ערוך</button>
                <button className="btn btn-danger btn-sm" onClick={()=>del(m.id)}><Trash2 size={14} strokeWidth={1.75} /></button>
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
                <div style={{fontWeight:900,fontSize:17,display:"flex",alignItems:"center",gap:6}}><Pencil size={14} strokeWidth={1.75}/> עריכת איש צוות</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{editMember.name}</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={()=>setEditMember(null)} style={{display:"flex",alignItems:"center",gap:4}}><X size={14} strokeWidth={1.75} color="var(--text3)"/> סגור</button>
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
                <button className="btn btn-primary" disabled={!editForm.name.trim()||!editEmail||editInvalidEmail||editDuplicateEmail} onClick={saveEdit} style={{display:"inline-flex",alignItems:"center",gap:4}}><Save size={14} strokeWidth={1.75}/> שמור שינויים</button>
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
function KitsPage({ kits, setKits, equipment, categories, showToast, reservations=[], setReservations, lessons=[], lecturers=[] }) {
  const [mode, setMode] = useState(null); // null | "create" | "edit"
  const [editTarget, setEditTarget] = useState(null);
  const [loanTypeFilter, setLoanTypeFilter] = useState([]); // empty = show all
  const LOAN_TYPES = ["פרטית","הפקה","סאונד","קולנוע יומית","שיעור","הכל"];
  const LOAN_TYPES_FILTER = ["פרטית","הפקה","סאונד","קולנוע יומית","שיעור"];
  const LOAN_ICONS = { "פרטית":<User size={12} strokeWidth={1.75}/>, "הפקה":<Film size={12} strokeWidth={1.75}/>, "סאונד":<Mic size={12} strokeWidth={1.75}/>, "קולנוע יומית":<Camera size={12} strokeWidth={1.75}/>, "שיעור":<GraduationCap size={12} strokeWidth={1.75}/>, "הכל":<Package size={12} strokeWidth={1.75}/> };
  const toggleLoanTypeFilter = (lt) => setLoanTypeFilter(prev => prev.includes(lt) ? prev.filter(x=>x!==lt) : [...prev, lt]);
  const filteredKits = loanTypeFilter.length === 0 ? kits : kits.filter(k =>
    loanTypeFilter.some(lt =>
      lt === "כל סוגי ההשאלה"
        ? !(k.loanTypes||[]).length
        : (k.loanTypes||[]).includes(lt)
    )
  );

  const normalizeKitName = (name) => String(name||"").trim().toLowerCase();
  const hasDuplicateKitName = (name, excludeId=null) =>
    kits.some(k=>k.id!==excludeId && normalizeKitName(k.name)===normalizeKitName(name));

  const del = async (id, name) => {
    const prevKit = kits.find(k=>k.id===id);
    const updated = kits.filter(k=>k.id!==id);
    setKits(updated);
    // Note: existing reservations (student loans + lesson meetings) retain their
    // snapshotted equipment items regardless of whether the source kit still exists.
    // Kits are a UX shortcut for equipment selection — deleting the preset must not
    // retroactively alter already-submitted reservations.
    await storageSet("kits", updated);
    showToast("success", `ערכה "${name}" נמחקה`);
    // Audit log — without this, the 2026-04-16 silent-delete incident left no
    // trace. A logged "kit_delete" tells us who clicked the button and when.
    try {
      const caller = JSON.parse(sessionStorage.getItem("staff_user")||"{}");
      logActivity({
        user_id: caller.id,
        user_name: caller.full_name,
        action: "kit_delete",
        entity: "kit",
        entity_id: String(id),
        details: {
          name,
          loanTypes: prevKit?.loanTypes || [],
          item_count: (prevKit?.items||[]).length,
        },
      }).catch(err => console.error("kit_delete log failed:", err));
    } catch (e) { console.error("kit_delete log setup failed:", e); }
  };

  // ── Kit Form ──────────────────────────────────────────────────────────────
  const StudentKitForm = ({ initial, onDone }) => {
    const [name, setName] = useState(initial?.name||"");
    const [description, setDescription] = useState(initial?.description||"");
    const [loanTypes, setLoanTypes] = useState(initial?.loanTypes || []);
    const toggleLoanType = (lt) => setLoanTypes(prev => prev.includes(lt) ? prev.filter(x=>x!==lt) : [...prev, lt]);
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
        name: trimmedName,
        description: description.trim(),
        loanTypes,
        items: kitItems
      };
      const updated = initial ? kits.map(k=>k.id===initial.id?kit:k) : [...kits, kit];
      setKits(updated);
      const r = await storageSet("kits", updated);
      showToast(r.ok?"success":"error", r.ok ? (initial?"הערכה עודכנה":`ערכה "${trimmedName}" נוצרה`) : "שגיאה בשמירה");
      if(r.ok) {
        // Audit log for kit create/edit — critical context for silent-delete
        // investigations (e.g. 2026-04-16 incident where a stale cache wiped
        // 3 kits + 14 reservations with no trace in activity_logs).
        try {
          const caller = JSON.parse(sessionStorage.getItem("staff_user")||"{}");
          logActivity({
            user_id: caller.id,
            user_name: caller.full_name,
            action: initial ? "kit_edit" : "kit_create",
            entity: "kit",
            entity_id: String(kit.id),
            details: {
              name: kit.name,
              loanTypes: kit.loanTypes,
              item_count: kit.items.length,
            },
          }).catch(err => console.error("kit save log failed:", err));
        } catch (e) { console.error("kit save log setup failed:", e); }
        onDone();
      }
      setSaving(false);
    };

    return (
      <div className="card" style={{marginBottom:20}}>
        <div className="card-header">
          <div className="card-title" style={{display:"flex",alignItems:"center",gap:6}}><Backpack size={16} strokeWidth={1.75}/> {initial?"עריכת ערכה":"ערכה חדשה"}</div>
          <button className="btn btn-secondary btn-sm" onClick={onDone} style={{display:"flex",alignItems:"center",gap:4}}><X size={14} strokeWidth={1.75} color="var(--text3)"/> ביטול</button>
        </div>

        <div className="responsive-split" style={{marginBottom:12}}>
          <div className="form-group"><label className="form-label">שם הערכה *</label>
            <input className="form-input" placeholder='לדוגמה: "ערכת דוקומנטרי"' value={name} onChange={e=>setName(e.target.value)}/>
            {duplicateName&&<div style={{fontSize:12,color:"var(--red)",marginTop:4}}>כבר קיימת ערכה עם השם הזה.</div>}
          </div>
          <div className="form-group">
            <label className="form-label">סוגי השאלה <span style={{fontWeight:400,fontSize:11,color:"var(--text3)"}}>· בחר אחד או יותר</span></label>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:6}}>
              {LOAN_TYPES.filter(lt=>lt!=="הכל").map(lt=>{
                const active = loanTypes.includes(lt);
                return (
                  <button key={lt} type="button" onClick={()=>toggleLoanType(lt)}
                    style={{padding:"5px 12px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"var(--surface2)",color:active?"var(--accent)":"var(--text2)",fontWeight:700,fontSize:12,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:4}}>
                    {LOAN_ICONS[lt]} {lt}
                  </button>
                );
              })}
            </div>
            <div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>{loanTypes.length===0?"ללא סיווג — הערכה תופיע בכל סוגי ההשאלה":""}ערכה עם <strong>"שיעור"</strong> תופיע בפורטל מרצה. שיוך לשיעור ספציפי — דרך "שיעורים" באדמין.</div>
          </div>
        </div>
        <div className="form-group" style={{marginBottom:16}}>
          <label className="form-label">תיאור הערכה</label>
          <textarea className="form-textarea" rows={2} placeholder="תיאור קצר..." value={description} onChange={e=>setDescription(e.target.value)}/>
        </div>
        <div className="form-section-title">ציוד בערכה</div>
        <div style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"12px 14px",marginBottom:12}}>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8,alignItems:"center"}}>
            <span style={{fontSize:11,fontWeight:800,color:"var(--text3)"}}>סינון:</span>
            {[{k:"all",l:<><Package size={12} strokeWidth={1.75}/> הכל</>},{k:"sound",l:<><Mic size={12} strokeWidth={1.75}/> ציוד סאונד</>},{k:"photo",l:<><Camera size={12} strokeWidth={1.75}/> ציוד צילום</>}].map(({k,l})=>{
              const active=eqTypeF===k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={()=>setEqTypeF(k)}
                  style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}
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
              <button type="button" onClick={()=>setEqCatF([])} style={{padding:"4px 8px",borderRadius:20,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",gap:3}}>
                <X size={10} strokeWidth={1.75} color="var(--text3)"/> נקה
              </button>
            )}
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <div className="search-bar" style={{flex:1,minWidth:150}}>
              <span><Search size={14} strokeWidth={1.75} color="var(--text3)"/></span>
              <input placeholder="חיפוש ציוד..." value={eqSearch} onChange={e=>setEqSearch(e.target.value)}/>
            </div>
            <button
              type="button"
              onClick={()=>setShowSelected(prev=>!prev)}
              style={{padding:"5px 12px",borderRadius:20,border:`2px solid ${showSelected?"var(--green)":"var(--border)"}`,background:showSelected?"rgba(46,204,113,0.12)":"transparent",color:showSelected?"var(--green)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}
            >
              {showSelected ? <><CheckCircle size={12} strokeWidth={1.75}/> נבחרים</> : "⬜ נבחרים בלבד"}
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
                  {catEq.some(eq=>eq.soundOnly)&&<span style={{fontSize:10,color:"var(--accent)",fontWeight:700,display:"inline-flex",alignItems:"center",gap:2}}><Mic size={10} strokeWidth={1.75}/> סאונד</span>}
                  {catEq.some(eq=>eq.photoOnly)&&<span style={{fontSize:10,color:"var(--green)",fontWeight:700,display:"inline-flex",alignItems:"center",gap:2}}><Camera size={9} strokeWidth={1.75}/> צילום</span>}
                </div>
                {catEq.map(eq=>{
                  const max = maxQty(eq.id);
                  const qty = getQty(eq.id);
                  return (
                    <div key={eq.id} className="item-row" style={{marginBottom:4,opacity:max===0?0.4:1,background:qty>0?"rgba(245,166,35,0.05)":"",border:qty>0?"1px solid rgba(245,166,35,0.2)":""}}>
                      <span style={{fontSize:20}}>{eq.image?.startsWith("data:")||eq.image?.startsWith("http")?<img src={cloudinaryThumb(eq.image)} alt="" style={{width:24,height:24,objectFit:"cover",borderRadius:4}}/>:eq.image||<Package size={20} strokeWidth={1.75} color="var(--text3)"/>}</span>
                      <div style={{flex:1,fontSize:13,fontWeight:600}}>
                        {eq.name}
                        <span style={{fontSize:11,color:"var(--text3)",marginRight:6,fontWeight:400}}>מלאי: {max}</span>
                        {eq.soundOnly&&<span style={{fontSize:10,color:"var(--accent)",fontWeight:700,marginRight:4}}><Mic size={10} strokeWidth={1.75}/></span>}
                        {eq.photoOnly&&<span style={{color:"var(--green)",fontWeight:700,marginRight:4,display:"inline-flex",alignItems:"center"}}><Camera size={9} strokeWidth={1.75}/></span>}
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
        {kitItems.length>0&&<div className="highlight-box" style={{marginTop:8,display:"flex",alignItems:"center",gap:6}}><Package size={13} strokeWidth={1.75}/> {kitItems.length} סוגי ציוד · {kitItems.reduce((s,i)=>s+i.quantity,0)} יחידות</div>}
        <div style={{marginTop:12,display:"flex",gap:8}}>
          <button className="btn btn-primary" disabled={!trimmedName||duplicateName||saving} onClick={save}>{saving?<><Clock size={13} strokeWidth={1.75}/> שומר...</>:initial?<><Save size={14} strokeWidth={1.75}/> שמור</>:"➕ צור ערכה"}</button>
        </div>
      </div>
    );
  };


  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="page">
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:12,flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:8}}>
          {mode===null&&<button className="btn btn-primary" onClick={()=>{setMode("create");setEditTarget(null);}}><span style={{fontSize:16,lineHeight:1}}>+</span> ערכה חדשה</button>}
        </div>
      </div>
      {/* Loan type filter pills */}
      {mode===null&&(
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:14}}>
          <span style={{fontSize:11,fontWeight:800,color:"var(--text3)"}}>סינון:</span>
          {LOAN_TYPES_FILTER.map(lt=>{
            const active=loanTypeFilter.includes(lt);
            return (
              <button key={lt} type="button" onClick={()=>toggleLoanTypeFilter(lt)}
                style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:4}}>
                {LOAN_ICONS[lt]} {lt}
              </button>
            );
          })}
          {loanTypeFilter.length>0&&(
            <button type="button" onClick={()=>setLoanTypeFilter([])}
              style={{padding:"4px 10px",borderRadius:20,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:11,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:3}}>
              <X size={10} strokeWidth={1.75} color="var(--text3)"/> הצג הכל
            </button>
          )}
          {loanTypeFilter.length>0&&<span style={{fontSize:12,color:"var(--text3)",marginRight:4}}>· {filteredKits.length} ערכות</span>}
        </div>
      )}

      {/* Forms */}
      {(mode==="create"||mode==="edit")&&(
        <StudentKitForm initial={mode==="edit"?editTarget:null} onDone={()=>{setMode(null);setEditTarget(null);}}/>
      )}

      {/* Floating view kit panel (overlay) */}
      {mode==="view"&&editTarget&&(()=>{
        const vKit = editTarget;
        const isLessonKit = (vKit.loanTypes||[]).includes("שיעור");
        const vLinkedLessons = isLessonKit ? getLessonsLinkedToKit(vKit, lessons) : [];
        const vLinkedSchedule = vLinkedLessons.flatMap(getLessonScheduleEntries).sort(compareDateTimeParts);
        const vDisplaySchedule = vLinkedSchedule;
        // Instructor details are ALWAYS sourced from the canonical lecturers
        // table when possible. Lesson rows may carry stale instructorEmail /
        // instructorPhone (copied at the time the lesson was created), and
        // kits carry an even older snapshot. The lecturers[] list is the
        // source of truth for personal details — look up by lecturerId if
        // available, otherwise by name.
        const vLinkedLesson = vLinkedLessons[0] || null;
        const vLessonLecturerId = vLinkedLesson?.lecturerId || "";
        const vLinkedLecturer = (() => {
          if (vLessonLecturerId) {
            const byId = lecturers.find(l => String(l.id) === String(vLessonLecturerId));
            if (byId) return byId;
          }
          const nameKey = String(vLinkedLesson?.instructorName || "").trim().toLowerCase();
          if (nameKey) {
            const byName = lecturers.find(l => String(l.fullName || "").trim().toLowerCase() === nameKey);
            if (byName) return byName;
          }
          return null;
        })();
        const vInstructorName  = vLinkedLecturer?.fullName  || vLinkedLesson?.instructorName  || "";
        const vInstructorEmail = vLinkedLecturer?.email     || vLinkedLesson?.instructorEmail || "";
        const vInstructorPhone = vLinkedLecturer?.phone     || vLinkedLesson?.instructorPhone || "";
        return (
          <div onClick={()=>{setMode(null);setEditTarget(null);}} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
            <div onClick={e=>e.stopPropagation()} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"20px 24px",maxWidth:520,width:"100%",maxHeight:"85vh",overflowY:"auto",boxShadow:"0 12px 40px rgba(0,0,0,0.5)"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                <div style={{fontWeight:900,fontSize:17,display:"flex",alignItems:"center",gap:6}}><Package size={17} strokeWidth={1.75}/> {vKit.name}</div>
                <div style={{display:"flex",gap:6}}>
                  <button className="btn btn-primary btn-sm" onClick={()=>{setMode("edit");}} style={{display:"inline-flex",alignItems:"center",gap:4}}><Pencil size={12} strokeWidth={1.75}/> עריכה</button>
                  <button className="btn btn-secondary btn-sm" onClick={()=>{setMode(null);setEditTarget(null);}}><X size={14} strokeWidth={1.75} color="var(--text3)"/></button>
                </div>
              </div>

              {/* Loan types */}
              {(vKit.loanTypes||[]).length > 0 && (
                <div style={{marginBottom:12,display:"flex",gap:6,flexWrap:"wrap"}}>
                  {(vKit.loanTypes||[]).map(lt=>(
                    <span key={lt} style={{background:"var(--accent-glow)",border:"1px solid var(--accent)",borderRadius:20,padding:"3px 10px",color:"var(--accent)",fontWeight:700,fontSize:12,display:"inline-flex",alignItems:"center",gap:3}}>{LOAN_ICONS[lt]||<Package size={12} strokeWidth={1.75}/>} {lt}</span>
                  ))}
                </div>
              )}

              {/* Linked lessons */}
              {vLinkedLessons.length > 0 && (
                <div style={{background:"rgba(155,89,182,0.06)",border:"1px solid rgba(155,89,182,0.25)",borderRadius:"var(--r)",padding:12,marginBottom:12}}>
                  <div style={{fontWeight:800,fontSize:13,color:"#9b59b6",marginBottom:6,display:"flex",alignItems:"center",gap:4}}><BookOpen size={13} strokeWidth={1.75}/> קורסים משויכים</div>
                  {vLinkedLessons.map(lesson => {
                    // Prefer the canonical lecturer record; fall back to whatever
                    // name is stored on the lesson row.
                    const lessonLec = lesson.lecturerId
                      ? lecturers.find(l => String(l.id) === String(lesson.lecturerId))
                      : lecturers.find(l => String(l.fullName||"").trim().toLowerCase() === String(lesson.instructorName||"").trim().toLowerCase());
                    const lessonInstructorName = lessonLec?.fullName || lesson.instructorName || "";
                    return (
                      <div key={lesson.id||lesson.name} style={{marginBottom:4}}>
                        <span style={{fontWeight:700,fontSize:13,display:"inline-flex",alignItems:"center",gap:4}}><BookOpen size={12} strokeWidth={1.75}/> {lesson.name}</span>
                        {lessonInstructorName && <span style={{fontSize:12,color:"var(--text2)",marginRight:8}}>· {lessonInstructorName}</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Instructor info */}
              {vInstructorName && (
                <div style={{background:"rgba(52,152,219,0.06)",border:"1px solid rgba(52,152,219,0.2)",borderRadius:"var(--r-sm)",padding:"8px 12px",marginBottom:12}}>
                  <div style={{fontSize:13,display:"flex",alignItems:"center",gap:4}}>{vInstructorName}{vInstructorPhone?<><span> · </span><Phone size={11} strokeWidth={1.75}/> {vInstructorPhone}</>:""}{vInstructorEmail?` · ${vInstructorEmail}`:""}</div>
                </div>
              )}

              {/* Description */}
              {vKit.description && (
                <div style={{fontSize:13,color:"var(--text2)",marginBottom:12,padding:"6px 0",borderBottom:"1px solid var(--border)"}}>{vKit.description}</div>
              )}

              {/* Equipment list */}
              <div style={{marginBottom:12}}>
                <div style={{fontWeight:800,fontSize:13,color:"var(--accent)",marginBottom:8,display:"flex",alignItems:"center",gap:6}}><Package size={13} strokeWidth={1.75}/> ציוד · {(vKit.items||[]).length} סוגים · {(vKit.items||[]).reduce((s,i)=>s+i.quantity,0)} יחידות</div>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  {(vKit.items||[]).map((item,j)=>{
                    const eq=equipment.find(e=>e.id==item.equipment_id);
                    return (
                      <div key={j} style={{display:"flex",alignItems:"center",gap:8,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"5px 10px"}}>
                        <span style={{fontSize:16,display:"inline-flex",alignItems:"center"}}>{eq?.image&&(eq.image.startsWith("data:")||eq.image.startsWith("http"))?<img src={cloudinaryThumb(eq.image)} alt="" style={{width:20,height:20,objectFit:"cover",borderRadius:4}}/>:(eq?.image?eq.image:<Package size={16} strokeWidth={1.5}/>)}</span>
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
                  <div style={{fontWeight:800,fontSize:13,color:"#9b59b6",marginBottom:8,display:"flex",alignItems:"center",gap:4}}><Calendar size={13} strokeWidth={1.75}/> {vDisplaySchedule.length} מפגשים</div>
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

      {/* Unified kit list */}
      {mode===null&&(
        <>
        <div style={{fontWeight:900,fontSize:14,margin:"0 0 10px",color:"var(--accent)",display:"flex",alignItems:"center",gap:8}}>
          <Backpack size={14} strokeWidth={1.75}/> ערכות
          {kits.length>0&&<span style={{background:"var(--accent-glow)",border:"1px solid var(--accent)",borderRadius:20,padding:"1px 10px",fontSize:12,fontWeight:700,color:"var(--accent)"}}>{kits.length}</span>}
        </div>
        {filteredKits.length===0
          ? <div className="empty-state"><div className="emoji"><Backpack size={48} strokeWidth={1.5}/></div><p>{kits.length===0?"אין ערכות":"אין ערכות מתאימות לסינון"}</p><p style={{fontSize:13,color:"var(--text3)"}}>ערכות מוצגות בטופס ההשאלה ובפורטל המרצה</p></div>
          : <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {filteredKits.map(kit=>{
              const linkedLessons = getLessonsLinkedToKit(kit, lessons);
              const linkedSchedule = linkedLessons.flatMap(getLessonScheduleEntries).sort(compareDateTimeParts);
              const nextSession = linkedSchedule.find(s=>s.date>=today());
              return (
                <div key={kit.id} onClick={()=>{setEditTarget(kit);setMode("view");}} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"14px 18px",cursor:"pointer",transition:"border-color 0.15s"}}
                  onMouseEnter={e=>e.currentTarget.style.borderColor="var(--accent)"}
                  onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <span style={{display:"flex",alignItems:"center"}}><Backpack size={26} strokeWidth={1.5}/></span>
                      <div>
                        <div style={{fontWeight:800,fontSize:15}}>{kit.name}</div>
                        <div style={{fontSize:12,color:"var(--text3)",marginTop:4,display:"flex",flexWrap:"wrap",gap:4}}>
                          {(kit.loanTypes||[]).length>0
                            ? (kit.loanTypes||[]).map(lt=>(
                                <span key={lt} style={{background:"var(--accent-glow)",border:"1px solid var(--accent)",borderRadius:20,padding:"2px 8px",color:"var(--accent)",fontWeight:700,display:"inline-flex",alignItems:"center",gap:3}}>{LOAN_ICONS[lt]||<Package size={12} strokeWidth={1.75}/>} {lt}</span>
                              ))
                            : <span style={{display:"inline-flex",alignItems:"center",gap:3}}><Package size={12} strokeWidth={1.75}/> כל סוגי ההשאלה</span>}
                        </div>
                        {linkedLessons.length>0&&<div style={{fontSize:11,color:"var(--text3)",marginTop:4,display:"flex",alignItems:"center",gap:3}}><BookOpen size={11} strokeWidth={1.75}/> {linkedLessons.map(l=>l.name).join(", ")}</div>}
                        {nextSession&&<div style={{fontSize:11,color:"var(--green)",marginTop:2}}>הבא: {formatDate(nextSession.date)} {nextSession.startTime}</div>}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:6}} onClick={e=>e.stopPropagation()}>
                      <button className="btn btn-secondary btn-sm" onClick={()=>{setEditTarget(kit);setMode("edit");}} style={{display:"inline-flex",alignItems:"center",gap:4}}><Pencil size={12} strokeWidth={1.75} color="var(--text3)"/> ערוך</button>
                      <button className="btn btn-danger btn-sm" onClick={()=>del(kit.id,kit.name)}><Trash2 size={14} strokeWidth={1.75} /></button>
                    </div>
                  </div>
                  <div style={{marginTop:10,display:"flex",flexWrap:"wrap",gap:4}}>
                    {(kit.items||[]).map((i,j)=>{
                      const eq=equipment.find(e=>e.id==i.equipment_id);
                      return <span key={j} className="chip">
                        {eq?.image&&(eq.image.startsWith("data:")||eq.image.startsWith("http"))?<img src={cloudinaryThumb(eq.image)} alt="" style={{width:14,height:14,objectFit:"cover",borderRadius:2,verticalAlign:"middle"}}/>:<span>{eq?.image||<Package size={14} strokeWidth={1.75} color="var(--text3)"/>}</span>}
                        {' '}{eq?.name||i.name} ×{i.quantity}
                      </span>;
                    })}
                  </div>
                </div>
              );
            })}
          </div>}
        </>
      )}
    </div>
  );
}

// ─── MANAGER CALENDAR PAGE ───────────────────────────────────────────────────
function ManagerCalendarPage({ reservations: initialReservations, setReservations, collegeManager, equipment=[], kits=[], siteSettings={}, lessons=[], lecturers=[] }) {
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
  const LOAN_ICONS    = { "פרטית":<User size={11} strokeWidth={1.75}/>,"הפקה":<Film size={11} strokeWidth={1.75}/>,"סאונד":<Mic size={11} strokeWidth={1.75}/>,"קולנוע יומית":<Camera size={11} strokeWidth={1.75}/> };
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
      const allRes = await (supabase.from("reservations_new").select("*, reservation_items(*)").then(res => ({ value: (res.data || []).map(r => ({ ...r, items: r.reservation_items || [] })), source: "supabase" })));
      const fresh = Array.isArray(allRes) ? allRes : ((allRes && allRes.value) || []);
      const updated = fresh.map(x => x.id===r.id ? {...x, status:newStatus} : x);
      setLocalRes(prev => prev.map(x => x.id===r.id ? {...x, status:newStatus} : x));
      if(setReservations) setReservations(updated);
      setSelected(null);
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
    const img = eq?.image || "";
    const isImg = typeof img === "string" && (img.startsWith("data:") || img.startsWith("http"));
    return isImg
      ? <img src={img} alt={item.name || ""} style={{width:56,height:56,objectFit:"contain",borderRadius:10,border:"1px solid var(--border)",background:"var(--surface2)",padding:4}}/>
      : <div style={{width:56,height:56,display:"flex",alignItems:"center",justifyContent:"center",fontSize:30,borderRadius:10,border:"1px solid var(--border)",background:"var(--surface2)"}}>{img||<Package size={30} strokeWidth={1.75} color="var(--text3)"/>}</div>;
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
            <span style={{display:"inline-flex",alignItems:"center",gap:3}}>{LOAN_ICONS[lt]||<Package size={11} strokeWidth={1.75}/>} {lt}</span>
          </button>;
        })}
        {(statusF.length>0||loanTypeF!=="הכל")&&(
          <button type="button" onClick={()=>{setStatusF([]);setLoanTypeF("הכל");}}
            style={{marginRight:"auto",padding:"4px 10px",borderRadius:20,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",gap:3}}>
            <X size={10} strokeWidth={1.75} color="var(--text3)"/> נקה סינון
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
      <div style={{fontWeight:800,fontSize:15,marginBottom:10,display:"flex",alignItems:"center",gap:6}}><ClipboardList size={15} strokeWidth={1.75}/> בקשות {HE_M[mo]} {yr}</div>
      {monthRes.length===0
        ? <div style={{textAlign:"center",color:"var(--text3)",padding:"24px",fontSize:14}}>אין בקשות בחודש זה</div>
        : <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {monthRes.map(r=>(
            <div key={r.id} onClick={()=>setSelected(r===selected?null:r)}
              style={{background:"var(--surface)",border:`1px solid ${selected===r?"var(--accent)":"var(--border)"}`,borderRadius:"var(--r)",padding:"12px 16px",cursor:"pointer",transition:"border-color 0.15s"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <span style={{fontWeight:800,fontSize:14}}>{r.student_name}</span>
                <span style={{fontSize:12,color:"var(--text3)",display:"inline-flex",alignItems:"center",gap:3}}>{LOAN_ICONS[r.loan_type]||<Package size={11} strokeWidth={1.75}/>} {r.loan_type}</span>
                <span style={{fontSize:11,color:"var(--text3)",display:"inline-flex",alignItems:"center",gap:3}}><Calendar size={11} strokeWidth={1.75}/> {formatDate(r.borrow_date)} → {formatDate(r.return_date)}</span>
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
                            {changingStatus===r.id&&!isCurrent?<><Clock size={11} strokeWidth={1.75}/> </>:isCurrent?<><Check size={11} strokeWidth={2}/> </>:""}{s}
                          </button>
                        );
                      })}
                    </div>
                    {changingStatus===r.id&&<div style={{fontSize:11,color:"var(--text3)",marginTop:6,display:"flex",alignItems:"center",gap:3}}><Clock size={11} strokeWidth={1.75}/> מעדכן סטטוס...</div>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      }

      {/* ── ערכות שיעור — שיעורים קרובים ── */}
      {(()=>{
        const lessonKits = kits.filter(k=>(k.loanTypes||[]).includes("שיעור"));
        if(!lessonKits.length) return null;
        const todayStr2 = today();
        const nowHHMM2 = (()=>{const n=new Date();return String(n.getHours()).padStart(2,"0")+":"+String(n.getMinutes()).padStart(2,"0");})();
        const upcoming = lessonKits.flatMap(kit=>{
          const linkedLessons = getLessonsLinkedToKit(kit, lessons||[]);
          return linkedLessons.flatMap(lesson=>{
            const lec = lesson.lecturerId
              ? (lecturers||[]).find(l=>String(l.id)===String(lesson.lecturerId))
              : (lecturers||[]).find(l=>String(l.fullName||"").trim().toLowerCase()===String(lesson.instructorName||"").trim().toLowerCase());
            return (lesson.schedule||[])
              .filter(s=>{
                if(!s.date) return false;
                if(s.date > todayStr2) return true;
                if(s.date === todayStr2) return (s.endTime||"23:59") > nowHHMM2;
                return false;
              })
              .map(s=>({...s, kitName:kit.name, instructorName:lec?.fullName||lesson.instructorName||"", instructorPhone:lec?.phone||lesson.instructorPhone||"", items:kit.items||[]}));
          });
        }).sort((a,b)=>a.date<b.date?-1:a.startTime<b.startTime?-1:1).slice(0,10);
        if(!upcoming.length) return null;
        return (
          <div style={{marginTop:28}}>
            <div style={{fontWeight:800,fontSize:15,marginBottom:10,display:"flex",alignItems:"center",gap:6}}><Film size={15} strokeWidth={1.75}/> ערכות שיעור — שיעורים קרובים</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {upcoming.map((s,i)=>(
                <div key={i} onClick={()=>setSelectedKit(s)} style={{background:"var(--surface)",border:"1px solid rgba(155,89,182,0.3)",borderRadius:"var(--r)",padding:"14px 18px",cursor:"pointer",transition:"border-color .15s"}}
                  onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(155,89,182,0.7)"}
                  onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(155,89,182,0.3)"}>
                  <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                    <Film size={22} strokeWidth={1.75} color="#9b59b6"/>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:800,fontSize:15}}>{s.kitName}</div>
                      {s.instructorName&&<div style={{fontSize:12,color:"var(--text2)",display:"flex",alignItems:"center",gap:4}}>{s.instructorName}{s.instructorPhone?<><span> · </span><Phone size={11} strokeWidth={1.75}/> {s.instructorPhone}</>:""}</div>}
                    </div>
                    <div style={{textAlign:"left",fontSize:13,color:"var(--text3)",fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
                      <Calendar size={13} strokeWidth={1.75}/> {formatDate(s.date)}&nbsp;&nbsp;<Clock size={13} strokeWidth={1.75}/> {s.startTime} – {s.endTime}
                    </div>
                    <span style={{fontSize:11,color:"#9b59b6",border:"1px solid rgba(155,89,182,0.4)",borderRadius:20,padding:"2px 8px",display:"inline-flex",alignItems:"center",gap:3}}><Package size={11} strokeWidth={1.75}/> {s.items.length} פריטים</span>
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
                <div style={{fontWeight:900,fontSize:16,color:"#9b59b6",display:"flex",alignItems:"center",gap:6}}><Film size={16} strokeWidth={1.75}/> {selectedKit.kitName}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:2,display:"flex",alignItems:"center",gap:4}}><Calendar size={12} strokeWidth={1.75}/> {formatDate(selectedKit.date)} · <Clock size={12} strokeWidth={1.75}/> {selectedKit.startTime} – {selectedKit.endTime}</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={()=>setSelectedKit(null)} style={{display:"flex",alignItems:"center",gap:4}}><X size={14} strokeWidth={1.75} color="var(--text3)"/> סגור</button>
            </div>
            <div style={{padding:"20px"}}>
              {selectedKit.instructorName&&(
                <div style={{background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:"12px 14px",marginBottom:14,fontSize:13}}>
                  <strong>{selectedKit.instructorName}</strong>
                  {selectedKit.instructorPhone&&<span style={{color:"var(--text3)",marginRight:8,display:"inline-flex",alignItems:"center",gap:4}}> · <Phone size={11} strokeWidth={1.75}/> {selectedKit.instructorPhone}</span>}
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
                          : <div style={{width:36,height:36,borderRadius:6,background:"rgba(155,89,182,0.12)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Package size={20} strokeWidth={1.75} color="var(--text3)"/></div>}
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
    const r = await writeEquipmentToDB(updatedEquipment);
    setSaving(false);
    if(r.ok) { showToast("success", "היחידות עודכנו"); onClose(); }
    else {
      setEquipment(previousEquipment);
      showToast("error","שגיאה בשמירה");
    }
  };

  const working = units.filter(u=>u.status==="תקין").length;
  const damaged = units.length - working;

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{width:"100%",maxWidth:520,maxHeight:"90vh",background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",direction:"rtl",display:"flex",flexDirection:"column"}}>
        <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",background:"var(--surface2)",borderRadius:"16px 16px 0 0",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div>
            <div style={{fontWeight:900,fontSize:16,display:"flex",alignItems:"center",gap:6}}><Wrench size={16} strokeWidth={1.75} /> ניהול יחידות — {eq.name}</div>
            <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
              <span style={{color:"var(--green)",fontWeight:700}}>{working} תקין</span>
              {damaged>0&&<span style={{color:"var(--red)",fontWeight:700,marginRight:8}}> · {damaged} בדיקה</span>}
              <span style={{color:"var(--text3)",marginRight:8}}> · סה"כ {units.length} יחידות</span>
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}><X size={14} strokeWidth={1.75} color="var(--text3)"/></button>
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
                    <Trash2 size={14} strokeWidth={1.75} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{padding:"14px 20px",borderTop:"1px solid var(--border)",flexShrink:0,display:"flex",gap:8}}>
          <button className="btn btn-primary" disabled={saving} onClick={saveAll}>{saving?<><Clock size={13} strokeWidth={1.75}/> שומר...</>:<><Save size={14} strokeWidth={1.75}/> שמור שינויים</>}</button>
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
    showToast("success", "ההגדרות נשמרו");
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
                {draft.theme === k && <span style={{ fontSize: 14, color: "var(--green)", fontWeight: 900, display:"inline-flex",alignItems:"center",gap:3 }}><Check size={13} strokeWidth={2}/> פעיל</span>}
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
        {saving ? <><Clock size={13} strokeWidth={1.75}/> שומר...</> : <><Save size={14} strokeWidth={1.75}/> שמור הגדרות</>}
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
      const tok6927 = await getAuthToken();
      await fetch("/api/send-email", {
        method:"POST", headers:{"Content-Type":"application/json", ...(tok6927 ? { Authorization: `Bearer ${tok6927}` } : {})},
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
      alert("הדיווח נשלח למנהל המכללה");
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
    const r = await writeEquipmentToDB(updatedEquipment);
    setSaving(false);
    if(r.ok) {
      if(editForm.status==="תקין") showToast("success", `${eq.name} #${unit.id.split("_")[1]} חזר לציוד פעיל`);
      else showToast("success","הסטטוס עודכן");
      setEditUnit(null);
    } else {
      setEquipment(previousEquipment);
      showToast("error","שגיאה בשמירה");
    }
  };

  const STATUS_COLORS = { "פגום":"var(--red)","בתיקון":"var(--yellow)","נעלם":"#9b59b6" };
  const STATUS_ICONS  = { "פגום":<AlertTriangle size={12} strokeWidth={1.75} />,"בתיקון":<Wrench size={12} strokeWidth={1.75} />,"נעלם":<HelpCircle size={12} strokeWidth={1.75} /> };

  return (
    <div className="page">
      {/* Filters */}
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <div className="search-bar" style={{flex:1,minWidth:180}}><span><Search size={14} strokeWidth={1.75} color="var(--text3)"/></span>
          <input placeholder="חיפוש ציוד..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <span style={{fontSize:13,color:"var(--text3)"}}>סה״כ: <strong style={{color:"var(--red)"}}>{damagedItems.length}</strong> יחידות</span>
      </div>
      {/* Category filter */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
        {["הכל",...categories].map(c=>(
          <button key={c} type="button" onClick={()=>setCatFilter(c)}
            style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${catFilter===c?"var(--accent)":"var(--border)"}`,background:catFilter===c?"var(--accent-glow)":"transparent",color:catFilter===c?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
            {c==="הכל"?<><Package size={12} strokeWidth={1.75}/> הכל</>:c}
          </button>
        ))}
      </div>

      {filtered.length===0
        ? <div className="empty-state"><div className="emoji"><CheckCircle size={48} strokeWidth={1.75} color="var(--green)"/></div><p>{search||catFilter!=="הכל"?"לא נמצאו פריטים":"אין ציוד בדיקה — כל הציוד תקין!"}</p></div>
        : <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {filtered.map(({eq, unit},i)=>{
            const isImg = eq.image?.startsWith("data:")||eq.image?.startsWith("http");
            const unitNum = unit.id?.split("_")[1]||"?";
            return (
              <div key={unit.id} style={{background:"var(--surface)",border:`2px solid ${STATUS_COLORS[unit.status]||"var(--border)"}22`,borderRight:`4px solid ${STATUS_COLORS[unit.status]||"var(--border)"}`,borderRadius:"var(--r)",padding:"14px 16px",display:"flex",gap:12,alignItems:"flex-start"}}>
                <div style={{width:48,height:48,flexShrink:0,borderRadius:8,overflow:"hidden",background:"var(--surface2)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {isImg ? <img src={cloudinaryThumb(eq.image)} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}}/> : <span style={{fontSize:28}}>{eq.image||<Package size={28} strokeWidth={1.75} color="var(--text3)"/>}</span>}
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
                  {unit.fault&&<div style={{fontSize:12,color:"var(--text2)",marginBottom:2,display:"flex",alignItems:"center",gap:4}}><AlertTriangle size={12} strokeWidth={1.75} /> <strong>תקלה:</strong> {unit.fault}</div>}
                  {unit.repair&&<div style={{fontSize:12,color:"var(--green)",display:"flex",alignItems:"center",gap:4}}><Wrench size={12} strokeWidth={1.75} /> <strong>תיקון:</strong> {unit.repair}</div>}
                </div>
                <button className="btn btn-secondary btn-sm" onClick={()=>{setEditUnit({eq,unit});setEditForm({status:unit.status,fault:unit.fault||"",repair:unit.repair||""}); }} style={{display:"inline-flex",alignItems:"center",gap:4}}><Pencil size={12} strokeWidth={1.75} color="var(--text3)"/> עריכה</button>
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
                <div style={{fontWeight:900,fontSize:16,display:"flex",alignItems:"center",gap:6}}><Pencil size={14} strokeWidth={1.75}/> עריכת יחידה — {editUnit.eq.name}</div>
                <div style={{fontSize:12,color:"var(--text3)"}}>יחידה #{editUnit.unit.id?.split("_")[1]}</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={()=>setEditUnit(null)}><X size={14} strokeWidth={1.75} color="var(--text3)"/></button>
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
                {editForm.status==="תקין"&&<div style={{fontSize:12,color:"var(--green)",marginTop:6,fontWeight:700,display:"flex",alignItems:"center",gap:3}}><CheckCircle size={12} strokeWidth={1.75}/> היחידה תחזור אוטומטית לציוד פעיל!</div>}
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
                    {reportSending?<><Clock size={13} strokeWidth={1.75}/> שולח...</>:"📧 שלח דיווח למנהל"}
                  </button>
                </div>
              )}
              <div style={{display:"flex",gap:8}}>
                <button className="btn btn-primary" disabled={saving} onClick={saveUnit}>{saving?<><Clock size={13} strokeWidth={1.75}/> שומר...</>:<><Save size={14} strokeWidth={1.75}/> שמור</>}</button>
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
  // Validate staffUser against the live Supabase session on every /admin mount,
  // and re-validate whenever the auth state changes (login as student in PublicForm,
  // logout in another tab, etc). Without this, a stale sessionStorage.staff_user
  // would let a non-admin session render the admin shell — the API still 403s
  // but the UI should never have rendered.
  useEffect(() => {
    if (!isAdmin) { setStaffAuthChecked(true); return; }

    let cancelled = false;
    const validate = async (session) => {
      if (cancelled) return;
      if (!session?.user?.id) {
        sessionStorage.removeItem("staff_user");
        setStaffUser(null);
        setStaffAuthChecked(true);
        return;
      }
      // Drop a stale cached staffUser before its DB row is checked.
      const cached = staffUser;
      if (cached?.id && cached.id !== session.user.id) {
        sessionStorage.removeItem("staff_user");
        setStaffUser(null);
      }
      const { data: userRow } = await supabase
        .from("users")
        .select("id,full_name,email,is_student,is_lecturer,is_warehouse,is_admin,permissions")
        .eq("id", session.user.id)
        .single();
      if (cancelled) return;
      if (!userRow || (!userRow.is_admin && !userRow.is_warehouse)) {
        sessionStorage.removeItem("staff_user");
        setStaffUser(null);
        setStaffAuthChecked(true);
        return;
      }
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
      const wasFresh = cached?.id === recovered.id;
      setStaffUser(recovered);
      setStaffAuthChecked(true);
      if (!wasFresh) {
        logActivity({ user_id: recovered.id, user_name: recovered.full_name, action: "login", entity: "session", details: { email: recovered.email, method: "session_recovery" } });
      }
    };

    supabase.auth.getSession().then(({ data }) => validate(data.session)).catch(() => {
      if (!cancelled) setStaffAuthChecked(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      invalidateAuthTokenCache();
      validate(session);
    });
    // Refresh the session every 4 minutes to prevent JWT expiry from kicking staff out.
    const refreshInterval = setInterval(async () => {
      try { await supabase.auth.refreshSession(); } catch { /* silent */ }
    }, 4 * 60 * 1000);
    return () => { cancelled = true; subscription?.unsubscribe?.(); clearInterval(refreshInterval); };
  }, [isAdmin]);
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
      const normalizedEquipment = normalizeEquipmentTagFlags(value, categoryTypesRef.current).map(ensureUnits);
      if (!dataEquals(equipmentRef.current, normalizedEquipment)) {
        _setEquipment(normalizedEquipment);
      }
      return;
    }

    if (key === "reservations" && Array.isArray(value)) {
      const normalizedDbRes = normalizeReservationsForArchive(value);
      // Re-merge lesson virtuals so /public polling doesn't wipe them from state.
      const { reservations: generatedLessonReservations, linkedKitIds } =
        buildLessonReservations(lessonsRef.current, kitsRef.current);
      const merged = [
        ...normalizedDbRes.filter((r) => {
          if (r.lesson_auto === true) return false;
          if (hasLinkedValue(r.lesson_kit_id) && linkedKitIds.has(String(r.lesson_kit_id))) return false;
          return true;
        }),
        ...generatedLessonReservations,
      ];
      if (!dataEquals(reservationsRef.current, merged)) {
        _setReservations(merged);
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
        (supabase.from("equipment").select("*").then(res => ({ value: res.data || [], source: "supabase" }))),
        (supabase.from("reservations_new").select("*, reservation_items(*)").then(res => ({ value: (res.data || []).map(r => ({ ...r, items: r.reservation_items || [] })), source: "supabase" }))),
        storageGet("categories"),
        storageGet("categoryLoanTypes"),
      ]);

      // eqR/resR are { value, source } objects (Supabase path); catsR/catLoanTypesR
      // come from storageGet which also returns { value, source }. Extract .value
      // before passing to applyPublicLiveSync (which expects a plain array/object).
      const eqVal  = eqR?.value  ?? eqR;
      const resVal = resR?.value ?? resR;
      const catsVal = catsR?.value ?? catsR;
      const catLoanTypesVal = catLoanTypesR?.value ?? catLoanTypesR;

      applyPublicLiveSync("equipment", eqVal);
      applyPublicLiveSync("reservations", resVal);
      applyPublicLiveSync("categories", catsVal);
      applyPublicLiveSync("categoryLoanTypes", catLoanTypesVal);

      return {
        equipment: Array.isArray(eqVal)
          ? normalizeEquipmentTagFlags(eqVal, categoryTypesRef.current).map(ensureUnits)
          : equipmentRef.current,
        reservations: Array.isArray(resVal)
          ? normalizeReservationsForArchive(resVal)
          : reservationsRef.current,
        categories: Array.isArray(catsVal) ? catsVal : categoriesRef.current,
        categoryLoanTypes: catLoanTypesVal && typeof catLoanTypesVal === "object" && !Array.isArray(catLoanTypesVal)
          ? catLoanTypesVal
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
      const normalizedEquipment = normalizeEquipmentTagFlags(value, categoryTypesRef.current).map(ensureUnits);
      if (!dataEquals(equipmentRef.current, normalizedEquipment)) _setEquipment(normalizedEquipment);
      return;
    }

    if (key === "reservations" && Array.isArray(value)) {
      const normalizedDbRes = normalizeReservationsForArchive(value);
      const { reservations: generatedLessonReservations, linkedKitIds } =
        buildLessonReservations(lessonsRef.current, kitsRef.current);
      const merged = [
        ...normalizedDbRes.filter((r) => {
          if (r.lesson_auto === true) return false;
          if (hasLinkedValue(r.lesson_kit_id) && linkedKitIds.has(String(r.lesson_kit_id))) return false;
          return true;
        }),
        ...generatedLessonReservations,
      ];
      if (!dataEquals(reservationsRef.current, merged)) _setReservations(merged);
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
        (supabase.from("equipment").select("*").then(res => ({ value: res.data || [], source: "supabase" }))),
        (supabase.from("reservations_new").select("*, reservation_items(*)").then(res => ({ value: (res.data || []).map(r => ({ ...r, items: r.reservation_items || [] })), source: "supabase" }))),
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
    try { const token=await getAuthToken(); const r = await fetch("/api/equipment-report",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({action:"list"})}); const d = await r.json(); if(Array.isArray(d)) setEquipmentReports(d); } catch {}
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
            (supabase.from("equipment").select("*").then(res => ({ value: res.data || [], source: "supabase" }))),
          (supabase.from("reservations_new").select("*, reservation_items(*)").then(res => ({ value: (res.data || []).map(r => ({ ...r, items: r.reservation_items || [] })), source: "supabase" }))),
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

          const rawEquipment = normalizeEquipmentTagFlags(eq || INITIAL_EQUIPMENT, catTypes || {});
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
        // equipment blob write removed (Stage 5) — equipment lives in Supabase tables only
        // reservations blob init removed (Stage 5) — Supabase is source of truth
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
        // reservations blob write removed (Stage 5) — normalization is in-memory only
        // Warn if network failed and no cache
        if(eqSrc === "cache" && !eq) showToast("error", "⚠️ לא ניתן לטעון ציוד — בדוק חיבור");
      } catch(e) {
        showToast("error", "שגיאת רשת — לא ניתן לטעון נתונים");
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
      const [resR, bookingsR, lecturersR, certsR, catsR, catTypesR] = await Promise.all([
        (supabase.from("reservations_new").select("*, reservation_items(*)").abortSignal(ctrl.signal).then(res => ({ value: (res.data || []).map(r => ({ ...r, items: r.reservation_items || [] })), source: "supabase" }))),
        storageGet("studio_bookings", ctrl.signal),
        storageGet("lecturers", ctrl.signal),
        storageGet("certifications", ctrl.signal),
        storageGet("categories", ctrl.signal),
        storageGet("categoryTypes", ctrl.signal),
      ]);
      if (ctrl.signal.aborted) return false;
      // Equipment is refreshed via realtime debounce (600ms), not by polling.
      // Polling only handles the keys listed above.
      if (Array.isArray(resR?.value)) {
        const normalized = normalizeReservationsForArchive(resR.value);
        // Lesson reservations are generated client-side from kit items.
        // The DB rows exist but have empty reservation_items (items:[]).
        // Re-inject the kit-based generated versions so every periodic /
        // focus-triggered refresh doesn't silently wipe their items.
        const { reservations: generatedLessonReservations, linkedKitIds } = buildLessonReservations(lessons, kits);
        // Lesson_auto rows are authoritative from buildLessonReservations, never from DB.
        // Always strip them from fetched data — even when no virtuals are generated this cycle
        // (otherwise stale DB rows for deleted kits/lessons leak through).
        const merged = [
          ...normalized.filter(r => {
            if (r.lesson_auto === true) return false;
            if (hasLinkedValue(r.lesson_kit_id) && linkedKitIds.has(String(r.lesson_kit_id))) return false;
            return true;
          }),
          ...generatedLessonReservations,
        ];
        if (!dataEquals(reservationsRef.current, merged)) _setReservations(merged);
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
      if (Array.isArray(catsR?.value) && catsR.value.length > 0 && !dataEquals(categoriesRef.current, catsR.value)) {
        _setCategories(catsR.value);
      }
      if (catTypesR?.value && typeof catTypesR.value === "object" && !Array.isArray(catTypesR.value) && !dataEquals(categoryTypesRef.current, catTypesR.value)) {
        _setCategoryTypes(catTypesR.value);
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
    // Poll with exponential backoff: 15s base, doubles on failure, max 5 min.
    // Shortened from 3 min so newly-submitted student reservations appear in the
    // admin list within seconds, not minutes. The DB query is cheap (single
    // select with a FK join) and the network cost is small.
    const BASE_POLL = 15000;
    const MAX_POLL  = 300000;
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
                const { reservations: genLesson, linkedKitIds } =
                  buildLessonReservations(lessonsRef.current, kitsRef.current);
                const merged = [
                  ...normalized.filter(r => {
                    if (r.lesson_auto === true) return false;
                    if (hasLinkedValue(r.lesson_kit_id) && linkedKitIds.has(String(r.lesson_kit_id))) return false;
                    return true;
                  }),
                  ...genLesson,
                ];
                if (!dataEquals(reservationsRef.current, merged)) {
                  _setReservations(merged);
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "equipment" },
        (() => {
          // Debounce: the RPC upserts every equipment row, generating N realtime
          // events in quick succession. Without debouncing, N concurrent fetches
          // flood Chrome's connection pool (ERR_INSUFFICIENT_RESOURCES).
          // A single 600ms trailing fetch handles the whole burst.
          let debounceTimer = null;
          return () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
              if (equipmentWriteInFlight()) return;
              try {
                const { data: rows } = await supabase.from("equipment").select("*");
                if (!Array.isArray(rows)) return;
                const normalized = normalizeEquipmentTagFlags(rows, categoryTypesRef.current || {}).map(ensureUnits);
                if (!dataEquals(equipmentRef.current, normalized)) _setEquipment(normalized);
              } catch (err) {
                console.warn("equipment realtime refetch failed", err);
              }
            }, 600);
          };
        })(),
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
      (r) => r.lesson_auto === true
    ).length;
    if (lessons.length > 0 && kits.length > 0 && generatedLessonReservations.length === 0 && currentLessonAutoCount > 0) {
      return; // transient empty generation — preserve existing lesson reservations
    }

    const nextReservations = normalizeReservationsForArchive([
      ...currentReservations.filter((reservation) => {
        if (reservation.lesson_auto === true) return false;
        if (hasLinkedValue(reservation.lesson_kit_id) && linkedKitIds.has(String(reservation.lesson_kit_id))) return false;
        return true;
      }),
      ...generatedLessonReservations,
    ]);

    if (!dataEquals(nextReservations, currentReservations)) {
      _setReservations(nextReservations);
      // Local-only: lesson reservations are regenerated on every load from
      // lessons+kits, so persisting the full blob here is unnecessary and
      // triggered shrink_guard whenever concurrent submits made the client
      // list stale.
    }

    const generatedLessonBookings = buildLessonStudioBookings(lessons);
    const nextStudioBookings = [
      ...currentStudioBookings.filter((booking) => booking.lesson_auto !== true),
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
        // Local-only: the archive/status normalization is recomputed from
        // clock time on every load, so we don't persist the full blob here.
        // Persisting it triggered shrink_guard when the client's cached list
        // lagged behind concurrent submits by other users.
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
        const tokOverdue = await getAuthToken();
        for (const r of toSend) {
          if (ac.signal.aborted) break;
          try {
            await fetch("/api/send-email", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(tokOverdue ? { Authorization: `Bearer ${tokOverdue}` } : {}) },
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
        // Mark as sent — flip the flag one reservation at a time via the
        // server-side RPC (migration 023). This avoids rewriting the full
        // blob, which triggered shrink_guard whenever the client's cached
        // list lagged behind concurrent submits.
        const sentIds = new Set(toSend.map(r => r.id));
        const updated = reservations.map(r => sentIds.has(r.id) ? { ...r, overdue_email_sent: true } : r);
        _setReservations(updated);
        try {
          const token = await getAuthToken();
          await Promise.allSettled([...sentIds].map(id =>
            fetch("/api/mark-overdue-sent", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ id }),
            })
          ));
        } catch (e) {
          console.warn("mark-overdue-sent failed (non-fatal):", e?.message || e);
        }
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
              ? <ManagerCalendarPage reservations={reservations} setReservations={setReservations} collegeManager={collegeManager} equipment={equipment} kits={kits} siteSettings={siteSettings} lessons={lessons} lecturers={lecturers}/>
              : <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",flexDirection:"column",gap:16,color:"var(--text2)"}}>
                  <div style={{fontSize:48}}><Shield size={48} strokeWidth={1.75} color="var(--text3)"/></div>
                  <div style={{fontSize:18,fontWeight:700}}>קישור לא תקין</div>
                  <div style={{fontSize:13}}>הקישור שבידך אינו תקין או פג תוקפו</div>
                </div>
          )}
        </div>
      ) : isCalendarView ? (
        <div style={{minHeight:"100vh",background:"var(--bg)",direction:"rtl",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,color:"var(--text2)"}}>
          <GraduationCap size={48} strokeWidth={1.75} color="var(--text3)"/>
          <div style={{fontSize:18,fontWeight:700}}>הקישור הזה בוטל</div>
          <div style={{fontSize:13}}>הגישה לצפייה בבקשות עברה לפורטל המרצה — ראש מחלקה, אנא התחבר דרך הפורטל</div>
          <a href="/" style={{marginTop:8,padding:"10px 22px",background:"var(--accent)",color:"#000",fontWeight:800,borderRadius:10,textDecoration:"none",display:"inline-flex",alignItems:"center",gap:6}}><GraduationCap size={16} strokeWidth={1.75}/> כניסה לפורטל</a>
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
          {!loadingDone ? <Loading ready={!loading} accentColor={siteSettings.accentColor} onDone={handleLoadingDone}/> : <PublicForm equipment={equipment} reservations={reservations} setReservations={setReservations} showToast={showToast} categories={categories} kits={kits} teamMembers={teamMembers} policies={policies} certifications={certifications} deptHeads={deptHeads} siteSettings={siteSettings} categoryLoanTypes={categoryLoanTypes} refreshInventory={refreshPublicInventory} lecturers={lecturers} lessons={lessons} canInstall={canInstallPwa} onInstall={installPwa}/>}
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
                : <span className="logo-icon"><Film size={40} strokeWidth={1.75} color="var(--accent)"/></span>}
              {siteSettings.soundLogo && (
                <img src={siteSettings.soundLogo} alt="לוגו סאונד" style={{width:90,height:90,objectFit:"contain",borderRadius:8,marginTop:2,display:"block"}}/>
              )}
              <div className="app-name">תפעול מחסן</div>
              <div className="app-sub">שלום, {staffUser?.full_name || "צוות"}</div>
            </div>
            <div className="nav">
              <div className="nav-section">ניהול</div>
              {[
                {id:"reservations",icon:<ClipboardList size={20} strokeWidth={1.75} color="var(--accent)"/>,label:"בקשות",badge:(pending||0)+(rejected||0)||null},
                {id:"equipment",icon:<Package size={20} strokeWidth={1.75} color="var(--accent)"/>,label:"ציוד",badge:damagedCount||null},
                {id:"certifications",icon:<GraduationCap size={20} strokeWidth={1.75} color="var(--accent)"/>,label:"הסמכת ציוד"},
                {id:"kits",icon:<Backpack size={20} strokeWidth={1.75} color="var(--accent)"/>,label:"ערכות"},
                {id:"policies",icon:<ClipboardList size={20} strokeWidth={1.75} color="var(--accent)"/>,label:"נהלים"},
                {id:"settings",icon:<Settings size={20} strokeWidth={1.75} color="var(--accent)"/>,label:"הגדרות"},
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
                {pending>0&&<div style={{background:"rgba(241,196,15,0.12)",border:"1px solid rgba(241,196,15,0.3)",borderRadius:8,padding:"5px 10px",fontSize:12,color:"var(--yellow)",flexShrink:0,display:"flex",alignItems:"center",gap:4}}><Clock size={12} strokeWidth={1.75}/> {pending}</div>}
                {deptHeadPending>0&&<div style={{background:"rgba(155,89,182,0.12)",border:"1px solid rgba(155,89,182,0.3)",borderRadius:8,padding:"5px 10px",fontSize:12,color:"var(--purple)",flexShrink:0}}>{deptHeadPending}</div>}
                {overdueCount>0&&<div style={{background:"rgba(230,126,34,0.15)",border:"1px solid rgba(230,126,34,0.4)",borderRadius:8,padding:"5px 10px",fontSize:12,color:"#e67e22",flexShrink:0,cursor:"pointer",display:"flex",alignItems:"center",gap:4}} onClick={()=>{setReservationsInitialSubView("rejected");setPage("reservations");}}><AlertTriangle size={12} strokeWidth={1.75}/> {overdueCount} באיחור</div>}
                {rejectedCount>0&&<div style={{background:"rgba(231,76,60,0.12)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:8,padding:"5px 10px",fontSize:12,color:"var(--red)",flexShrink:0,display:"flex",alignItems:"center",gap:4}}><XCircle size={12} strokeWidth={1.75}/> {rejectedCount}</div>}
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
                  <div className="search-bar" style={{flex:"1 1 130px",minWidth:120}}><span><Search size={14} strokeWidth={1.75} color="var(--text3)"/></span><input placeholder="חיפוש..." value={resSearch} onChange={e=>setResSearch(e.target.value)}/></div>
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
                initialSubView={reservationsInitialSubView} categories={categories} certifications={certifications} kits={kits} teamMembers={teamMembers} deptHeads={deptHeads} siteSettings={siteSettings} onLogCreated={attachLogIdToUndo} equipmentReports={equipmentReports} lessons={lessons} setLessons={setLessons}/></div>
              <div style={{display:page==="team"?"block":"none"}}><TeamPage teamMembers={teamMembers} setTeamMembers={setTeamMembers} deptHeads={deptHeads} setDeptHeads={setDeptHeads} collegeManager={collegeManager} setCollegeManager={setCollegeManager} showToast={showToast} managerToken={managerToken}/></div>
              <div style={{display:page==="kits"?"block":"none"}}><KitsPage kits={kits} setKits={setKits} equipment={equipment} categories={categories} showToast={showToast} reservations={reservations} setReservations={setReservations} lessons={lessons} lecturers={lecturers}/></div>
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
                : <span className="logo-icon"><Film size={40} strokeWidth={1.75} color="var(--accent)"/></span>}
              {siteSettings.soundLogo && (
                <img src={siteSettings.soundLogo} alt="לוגו סאונד" style={{width:90,height:90,objectFit:"contain",borderRadius:8,marginTop:2,display:"block"}}/>
              )}
              <div className="app-name">אדמיניסטרציה</div>
              <div className="app-sub">שלום, {staffUser?.full_name || "צוות"}</div>
            </div>
            <div className="nav">
              <div className="nav-section">ניהול</div>
              {[
                {id:"studios",icon:<Mic size={20} strokeWidth={1.75} color="var(--accent)"/>,label:"ניהול חדרים"},
                {id:"studio-certifications",icon:<GraduationCap size={20} strokeWidth={1.75} color="var(--accent)"/>,label:"הסמכת אולפן"},
                {id:"lessons",icon:<Film size={20} strokeWidth={1.75} color="var(--accent)"/>,label:"שיעורים",badge:lessons.length||null},
                {id:"lecturers",icon:<GraduationCap size={20} strokeWidth={1.75} color="var(--accent)"/>,label:"מרצים",badge:lecturers.filter(l=>l.isActive!==false).length||null},
                {id:"students",icon:<GraduationCap size={20} strokeWidth={1.75} color="var(--accent)"/>,label:"סטודנטים"},
                {id:"policies",icon:<ClipboardList size={20} strokeWidth={1.75} color="var(--accent)"/>,label:"נהלים"},
                {id:"settings",icon:<Settings size={20} strokeWidth={1.75} color="var(--accent)"/>,label:"הגדרות"},
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
