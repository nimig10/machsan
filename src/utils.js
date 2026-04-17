// utils.js — shared constants, storage helpers, and utility functions
import { supabase } from "./supabaseClient.js";

// ─── AUTH TOKEN ───────────────────────────────────────────────────────────────
export async function getAuthToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

// ─── ACTIVITY LOGGING ────────────────────────────────────────────────────────
export async function logActivity({ user_id, user_name, action, entity, entity_id, details }) {
  try {
    const res = await fetch("/api/activity-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "write", user_id, user_name, activity: action, entity, entity_id, details }),
    });
    const data = await res.json();
    return data.id || null;
  } catch (e) {
    console.warn("logActivity failed:", e);
    return null;
  }
}

// ─── CLOUDINARY IMAGE OPTIMIZATION ───────────────────────────────────────────
// Adds auto-format + auto-quality + width transforms to Cloudinary URLs for CDN delivery
// e.g. cloudinaryThumb("https://res.cloudinary.com/.../upload/v123/img.jpg", 200)
//   → "https://res.cloudinary.com/.../upload/w_200,q_auto,f_auto/v123/img.jpg"
export function cloudinaryThumb(url, width = 400) {
  if (!url || !url.includes("res.cloudinary.com")) return url;
  return url.replace("/upload/", `/upload/w_${width},q_auto,f_auto/`);
}

// ─── SUPABASE STORAGE ─────────────────────────────────────────────────────────
export const SB_URL = import.meta.env.VITE_SUPABASE_URL;
export const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const SB_HEADERS = {
  "apikey":        SB_KEY,
  "Authorization": `Bearer ${SB_KEY}`,
  "Content-Type":  "application/json",
};

export function lsGet(key) {
  try { const v = localStorage.getItem(`cache_${key}`); return v ? JSON.parse(v) : null; } catch { return null; }
}
export function lsSet(key, value) {
  try { localStorage.setItem(`cache_${key}`, JSON.stringify(value)); } catch {}
}
export function lsRemove(key) {
  try { localStorage.removeItem(`cache_${key}`); } catch {}
}
function restoreCacheValue(key, value) {
  if (value === null || value === undefined) {
    lsRemove(key);
    return;
  }
  lsSet(key, value);
}

export async function storageGet(key) {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 6000); // 6s timeout
    const res  = await fetch(`${SB_URL}/rest/v1/store?key=eq.${key}&select=data`, { headers: SB_HEADERS, signal: ctrl.signal });
    clearTimeout(timeout);
    const json = await res.json();
    if (Array.isArray(json) && json.length > 0) {
      lsSet(key, json[0].data);
      return json[0].data;
    }
    return lsGet(key);
  } catch(e) {
    console.warn("storageGet error", key, e);
    return lsGet(key);
  }
}

// ─── SUPABASE KEEP-ALIVE PING ─────────────────────────────────────────────────
// מונע כניסה ל-pause אחרי 7 ימי חוסר שימוש
export async function keepAlive() {
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

// ─── SANITY THRESHOLDS: refuse to overwrite with suspiciously small data ─────
const CRITICAL_KEYS_MIN = {
  equipment:    5,   // refuse if writing fewer than 5 items
  reservations: null // no minimum — can legitimately be empty
};

// ─── HEBREW CORRUPTION GUARD: block writes with destroyed Unicode ────────────
const HEBREW_RE = /[\u0590-\u05FF]/;
const CORRUPTION_RE = /\?\?\?\?/;
function hasHebrewCorruption(newValue, existingValue) {
  if (!existingValue) return false;
  const existingStr = JSON.stringify(existingValue);
  const newStr = JSON.stringify(newValue);
  // If existing data has real Hebrew but new data lost it → corruption
  const existingHasHebrew = HEBREW_RE.test(existingStr);
  const newHasHebrew = HEBREW_RE.test(newStr);
  const newHasQuestionMarks = CORRUPTION_RE.test(newStr);
  if (existingHasHebrew && !newHasHebrew && newHasQuestionMarks) {
    return true;
  }
  // Even if both have some Hebrew, check if new data has suspiciously many ????
  if (existingHasHebrew && newHasQuestionMarks) {
    const existingQCount = (existingStr.match(/\?\?\?\?/g) || []).length;
    const newQCount = (newStr.match(/\?\?\?\?/g) || []).length;
    if (newQCount > existingQCount + 5) return true;
  }
  return false;
}

export async function storageSet(key, value) {
  // ── Sanity check: block writes that would destroy data ──
  const minItems = CRITICAL_KEYS_MIN[key];
  if (minItems != null && Array.isArray(value)) {
    const cached = lsGet(key);
    const cachedLen = Array.isArray(cached) ? cached.length : 0;
    if (value.length < minItems && cachedLen >= minItems) {
      console.error(`🛑 storageSet BLOCKED: refusing to write ${key} with ${value.length} items (minimum: ${minItems}, current: ${cachedLen})`);
      return { ok: false, error: "blocked_sanity_check" };
    }
  }

  // ── Hebrew corruption guard: block writes with destroyed Unicode ──
  {
    const cached = lsGet(key);
    if (hasHebrewCorruption(value, cached)) {
      console.error(`🛑 storageSet BLOCKED: Hebrew corruption detected in ${key}. New data has ???? where Hebrew text should be. Write refused.`);
      return { ok: false, error: "blocked_hebrew_corruption" };
    }
  }

  // ── Auto-backup critical keys before overwrite ──
  if (key in CRITICAL_KEYS_MIN) {
    try {
      const existing = lsGet(key);
      if (existing && Array.isArray(existing) && existing.length > 0) {
        const bc = new AbortController();
        const bt = setTimeout(() => bc.abort(), 6000);
        await fetch("/api/store", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: `backup_${key}`, data: existing }),
          signal: bc.signal,
        });
        clearTimeout(bt);
      }
    } catch(e) { /* backup failure should not block the write */ }
  }

  // ── Log write details for critical keys ──
  if (key in CRITICAL_KEYS_MIN) {
    const count = Array.isArray(value) ? value.length : "N/A";
    const units = Array.isArray(value) ? value.reduce((s, e) => s + (e?.units?.length || e?.quantity || 0), 0) : "N/A";
    console.log(`📝 storageSet: ${key} — ${count} items, ${units} units`);
  }

  const previousCachedValue = lsGet(key);
  lsSet(key, value); // cache immediately
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000); // 8s timeout
    const res = await fetch("/api/store", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ key, data: value }),
      signal:  ctrl.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const err = await res.text();
      console.error("storageSet error", key, err);
      restoreCacheValue(key, previousCachedValue);
      // Shrink-guard hit: the server refused because this write would have
      // shrunk a protected list by >20%. This is almost always a cache-
      // staleness bug (another user added rows we don't know about). Tell
      // the user to refresh instead of losing data.
      if (res.status === 409 && /shrink_guard/i.test(err)) {
        try {
          const alertMsg = `🛑 פעולת השמירה נחסמה על ידי מנגנון הבטיחות בשרת.\n\nכנראה שמשתמש אחר הוסיף נתונים מאז שטענת את הדף. נתוני הדפדפן שלך מיושנים ואם היו נשמרים, הם היו מוחקים את השינויים האחרים.\n\nהעמוד ירוענן כעת כדי לקבל את המצב העדכני.`;
          if (typeof window !== "undefined" && window.alert) window.alert(alertMsg);
          if (typeof window !== "undefined" && window.location) {
            setTimeout(() => window.location.reload(), 300);
          }
        } catch {}
        return { ok: false, error: "shrink_guard_blocked", detail: err };
      }
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

// ─── ATOMIC RESERVATION CREATE ───────────────────────────────────────────────
// Routes a new reservation through /api/create-reservation → create_reservation_v2
// RPC (migration 008). The RPC takes FOR UPDATE on every equipment row the
// reservation touches, runs a date-range overlap availability check, and only
// then inserts — so two concurrent callers competing for the last available
// unit cannot both succeed. Used by:
//   * PublicForm (student self-service)
//   * ReservationsPage.AdminManualForm (admin-created manual reservations)
//
// Returns:
//   { ok: true,  id }                            on success (id is the new row id)
//   { ok: false, error: "not_enough_stock", detail }  on 409 stock conflict
//   { ok: false, error, detail }                 on any other failure
//
// The `reservation` object must include at least: student_name, email, phone,
// course, loan_type, borrow_date, return_date, borrow_time, return_time.
// The `items` array must be non-empty; each item needs equipment_id + quantity.
// Optional: `id` on the reservation (server will generate one if missing).
export async function createReservation(reservation, items, options = {}) {
  const { timeoutMs = 12000 } = options;
  if (!reservation || typeof reservation !== "object") {
    return { ok: false, error: "missing_arg", detail: "reservation object required" };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "missing_arg", detail: "items must be a non-empty array" };
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch("/api/create-reservation", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ reservation, items }),
      signal:  ctrl.signal,
    });
    clearTimeout(t);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const stockIssue = res.status === 409 || data.error === "not_enough_stock";
      return {
        ok:     false,
        status: res.status,
        error:  stockIssue ? "not_enough_stock" : (data.error || "rpc_error"),
        detail: data.detail || `HTTP ${res.status}`,
      };
    }
    return { ok: true, id: data.id };
  } catch (e) {
    console.error("createReservation network error:", e);
    return { ok: false, error: "network_error", detail: e.message };
  }
}

// ─── ATOMIC LESSON-KIT BATCH RESERVATION CREATION ───────────────────────────
// Routes a whole lesson kit's schedule through /api/create-lesson-reservations
// → create_lesson_reservations_v1 (migration 010). That RPC:
//   1) Deletes existing reservations where lesson_kit_id = kitId.
//   2) For each session runs the same date-range overlap availability check
//      as create_reservation_v2, under FOR UPDATE locks held for the whole
//      transaction — so concurrent public-form submits serialize behind us.
//   3) Recomputes available_units for every touched equipment row.
//
// Replaces the old pattern in EditLessonKit.save:
//   baseRes = reservations.filter(r => r.lesson_kit_id !== kitId);
//   newRes  = finalSchedule.map(s => ({ ... }));
//   storageSet("reservations", [...baseRes, ...newRes]);
//
// Returns:
//   { ok: true, inserted, deleted, ids }                     on success
//   { ok: false, error: "not_enough_stock", detail, conflictDetail }  on conflict
//   { ok: false, error, detail }                             on any other failure
//
// Callers should still refresh the reservations cache (storageSet) afterwards
// so other clients pick up the new state before the next mirror cycle.
export async function createLessonReservations(kitId, reservations, items, options = {}) {
  const { timeoutMs = 15000 } = options;
  if (!kitId) {
    return { ok: false, error: "missing_arg", detail: "kitId is required" };
  }
  if (!Array.isArray(reservations)) {
    return { ok: false, error: "missing_arg", detail: "reservations must be an array" };
  }
  if (!Array.isArray(items)) {
    return { ok: false, error: "missing_arg", detail: "items must be an array" };
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch("/api/create-lesson-reservations", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ kit_id: String(kitId), reservations, items }),
      signal:  ctrl.signal,
    });
    clearTimeout(t);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const stockIssue = res.status === 409 || data.error === "not_enough_stock";
      return {
        ok:             false,
        status:         res.status,
        error:          stockIssue ? "not_enough_stock" : (data.error || "rpc_error"),
        detail:         data.detail || `HTTP ${res.status}`,
        conflictDetail: data.detail || null,
      };
    }
    return {
      ok:       true,
      inserted: data.inserted ?? 0,
      deleted:  data.deleted  ?? 0,
      ids:      Array.isArray(data.ids) ? data.ids : [],
    };
  } catch (e) {
    console.error("createLessonReservations network error:", e);
    return { ok: false, error: "network_error", detail: e.message };
  }
}

// ─── ATOMIC RESERVATION STATUS UPDATE ────────────────────────────────────────
// Routes a status change (approve / reject / return / cancel) through the
// atomic RPC update_reservation_status_v1 (migration 009), via the server
// endpoint /api/update-reservation-status. Replaces the old pattern of
// fetch-list → mutate → storageSet("reservations", fullList) which had three
// real problems:
//   1) Whole-list overwrite could silently undo a concurrent public-form
//      submit or another admin's write.
//   2) No recompute of available_units, so transitioning into the "currently
//      out of warehouse" window drifted the cached counter.
//   3) Two admins clicking "approve" at once both "succeeded" — both emailed,
//      both wrote the DB. The RPC's FOR UPDATE lock serializes them now.
//
// The helper does NOT rewrite the reservations JSON blob — callers still
// do that via their existing storageSet() path to refresh the shared cache.
// This function is the source-of-truth write; storageSet is now the cache
// refresh. If the blob write races, the next mirror cycle reconciles it.
//
// Returns:
//   { ok: true,  id, old_status, new_status, changed }   on success
//   { ok: false, error, detail }                          on failure
//
// Callers should check `ok` before updating local state / sending emails.
export async function updateReservationStatus(id, status, options = {}) {
  const { returned_at = null, timeoutMs = 8000 } = options;
  if (!id || !status) {
    return { ok: false, error: "missing_arg", detail: "id and status are required" };
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const token = await getAuthToken();
    const res = await fetch("/api/update-reservation-status", {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ id: String(id), status, returned_at }),
      signal:  ctrl.signal,
    });
    clearTimeout(t);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      console.error("updateReservationStatus error:", res.status, data);
      return {
        ok:     false,
        error:  data.error  || "rpc_error",
        detail: data.detail || `HTTP ${res.status}`,
      };
    }
    return {
      ok:         true,
      id:         data.id,
      old_status: data.old_status,
      new_status: data.new_status,
      changed:    data.changed,
    };
  } catch (e) {
    console.error("updateReservationStatus network error:", e);
    return { ok: false, error: "network_error", detail: e.message };
  }
}

// ─── DELETE RESERVATION (atomic, no flicker) ──────────────────────────────────
// Wraps POST /api/delete-reservation, which calls the RPC delete_reservation_v1
// (migration 012). That RPC deletes the row from reservations_new +
// reservation_items, strips it from the store.reservations JSON mirror, and
// recomputes available_units for touched equipment — ALL in one transaction.
//
// Why this exists:
//   The legacy path was `setReservations(list without row)` + fire-and-forget
//   `storageSet('reservations', list)`. The storageSet pipeline takes 2–14s
//   (backup write → real write → mirror). During that window, concurrent polls
//   or realtime events could refetch the stale state and briefly re-insert the
//   deleted card ("trash-button flicker"). By routing through this single
//   atomic RPC, a concurrent listener fires AFTER the commit and sees the
//   consistent post-delete state.
//
// Returns:
//   { ok: true,  id, source, normalized_deleted, items_deleted,
//                json_shrunk_by, recomputed_equipment }  on success
//     source ∈ 'normalized' | 'json_only' | 'not_found'
//     'not_found' is still treated as ok=true (idempotent retry).
//   { ok: false, error, detail }                           on failure
export async function deleteReservation(id, options = {}) {
  const { timeoutMs = 12000 } = options;
  if (!id) {
    return { ok: false, error: "missing_arg", detail: "id is required" };
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const token = await getAuthToken();
    const res = await fetch("/api/delete-reservation", {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ id: String(id) }),
      signal:  ctrl.signal,
    });
    clearTimeout(t);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      console.error("deleteReservation error:", res.status, data);
      return {
        ok:     false,
        error:  data.error  || "rpc_error",
        detail: data.detail || `HTTP ${res.status}`,
      };
    }
    return {
      ok:                   true,
      id:                   data.id,
      source:               data.source,
      normalized_deleted:   data.normalized_deleted ?? 0,
      items_deleted:        data.items_deleted      ?? 0,
      json_shrunk_by:       data.json_shrunk_by     ?? 0,
      recomputed_equipment: data.recomputed_equipment ?? 0,
    };
  } catch (e) {
    console.error("deleteReservation network error:", e);
    return { ok: false, error: "network_error", detail: e.message };
  }
}

// ─── DUAL-WRITE MIRRORS: reservations + equipment → new normalized tables ────
// Fire-and-forget. Failures are logged but never block the primary write.
// Removed when migration stage 5 retires the store blobs.
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

// ─── INITIAL DATA ─────────────────────────────────────────────────────────────
export const INITIAL_EQUIPMENT = [
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
export const DEFAULT_CATEGORIES = ["מצלמות","עדשות","מיקרופונים","מקליטי אודיו","תאורה","חצובות","אביזרים"];
// Note: "כבלים" intentionally NOT included — cables are general gear used by both
// sound and photo crews, so they default to "כללי" unless admin overrides.
export const SOUND_CATEGORIES = ["מיקרופונים","מקליטי אודיו"];
export const STATUSES    = ["תקין","פגום","בתיקון","נעלם"];
export const PHOTO_CATEGORIES = ["מצלמות","עדשות","תאורה","חצובות","אביזרים","אביזרי צילום","מייצבי מצלמה","גימבלים","רחפנים","מוניטורים"];
export const RESEND_API_KEY = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_RESEND_KEY : "";
export const ADMIN_NAV_PAGES = ["dashboard","reservations","equipment","damaged","certifications","rejected","kits","team","archive","policies","settings"];
export const NIMROD_PHONE     = "972521234567"; // ← החלף במספר של נמרוד
export const EMAIL_TYPO_DOMAINS = ["gmai.com","gmial.com","gmail.co","gamil.com","gmaill.com","yahooo.com","yahho.com","outlok.com","hotmai.com","outllook.com"];
export const TERMS = `הסטודנט מתחייב להחזיר את הציוד במועד שנקבע ובמצב תקין.
אחריות על נזק לציוד תחול על הסטודנט.
במקרה של אובדן, יחויב הסטודנט בעלות החלפת הציוד.
יש להשתמש בציוד לצרכי לימוד בלבד.`;

// ─── UTILS ────────────────────────────────────────────────────────────────────
export function formatDate(d) {
  if (!d) return "";
  return parseLocalDate(d).toLocaleDateString("he-IL", { day:"2-digit", month:"2-digit", year:"numeric" });
}

export function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function getLoanDurationDays(borrowDate, returnDate) {
  const start = parseLocalDate(borrowDate);
  const end = parseLocalDate(returnDate);
  if (!start || !end) return 0;
  return Math.max(0, Math.ceil((end - start) / 86400000) + 1);
}

export function getPrivateLoanLimitedQty(items = [], equipment = []) {
  return (items || []).reduce((sum, item) => {
    const eq = (equipment || []).find((entry) => entry.id == item.equipment_id);
    if (eq?.privateLoanUnlimited) return sum;
    return sum + (Number(item.quantity) || 0);
  }, 0);
}

export function normalizeReservationStatus(status) {
  return status === "ממתין לאישור ראש המחלקה" ? "אישור ראש מחלקה" : status;
}

export function getNextSoundDayLoanDate(slots = []) {
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

export function getFutureTimeSlotsForDate(dateStr, slots = []) {
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

export function normalizeEquipmentTagFlags(list = [], categoryTypes = {}) {
  return (list || []).map((item) => {
    if (!item || typeof item !== "object") return item;
    const normalized = { ...item };
    const hasAdminType = categoryTypes && Object.prototype.hasOwnProperty.call(categoryTypes, normalized.category);
    const adminType = hasAdminType ? categoryTypes[normalized.category] : undefined;
    if (adminType === "סאונד") {
      normalized.soundOnly = true;
      normalized.photoOnly = false;
    } else if (adminType === "צילום") {
      normalized.soundOnly = false;
      normalized.photoOnly = true;
    } else if (hasAdminType) {
      // Admin explicitly classified as "כללי" (stored as "") → neither
      normalized.soundOnly = false;
      normalized.photoOnly = false;
    } else {
      // No admin override → auto-derive from hardcoded category defaults.
      normalized.soundOnly = SOUND_CATEGORIES.includes(normalized.category);
      normalized.photoOnly = PHOTO_CATEGORIES.includes(normalized.category);
    }
    if (typeof normalized.privateLoanUnlimited !== "boolean") {
      normalized.privateLoanUnlimited = false;
    }
    return normalized;
  });
}
export function formatLocalDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
export function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}
export function today() {
  return formatLocalDateInput(new Date());
}
export function dateToLocal(d) {
  if(!d) return null;
  return formatLocalDateInput(d);
}

export function toDateTime(dateStr, timeStr) {
  if (!dateStr) return 0;
  const d = parseLocalDate(dateStr);
  const [h, m] = String(timeStr || "00:00").split(":").map(Number);
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return d.getTime();
}

// Returns "פעילה" for approved reservations whose borrow time has already started
export function getEffectiveStatus(r) {
  if (r?.status === "מאושר" && r.borrow_date) {
    if (toDateTime(r.borrow_date, r.borrow_time || "00:00") <= Date.now()) return "פעילה";
  }
  return r?.status || "";
}

export function safeClone(value) {
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch (cloneError) {
    void cloneError;
  }
  return JSON.parse(JSON.stringify(value));
}

export function dataEquals(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function isValidEmailAddress(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return false;
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(normalizedEmail)) {
    return false;
  }
  const domain = normalizedEmail.split("@")[1];
  return !EMAIL_TYPO_DOMAINS.includes(domain);
}

export function getReservationReturnTimestamp(reservation) {
  if (!reservation?.return_date) return null;
  return toDateTime(reservation.return_date, reservation.return_time || "23:59");
}

export function markReservationReturned(reservation, returnedAt = new Date()) {
  const returnedAtIso = returnedAt instanceof Date ? returnedAt.toISOString() : new Date(returnedAt).toISOString();
  return {
    ...reservation,
    status: "הוחזר",
    returned_at: reservation.returned_at || returnedAtIso,
  };
}

export function normalizeReservationsForArchive(reservations, now = new Date()) {
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
export const FAR_FUTURE = new Date("2099-12-31T23:59:00").getTime();

// ─── HELPERS ──────────────────────────────────────────────────────────────────
// Ensure each equipment item has a units array
export function ensureUnits(eq) {
  if (Array.isArray(eq.units) && eq.units.length === eq.total_quantity) return eq;
  const existing = Array.isArray(eq.units) ? eq.units : [];
  const units = [];
  for (let i = 0; i < (eq.total_quantity || 0); i++) {
    units.push(existing[i] || { id: `${eq.id}_${i+1}`, status: "תקין", fault: "", repair: "" });
  }
  return { ...eq, units };
}

// Count working (תקין) units
export function workingUnits(eq) {
  if (!Array.isArray(eq.units)) return Number(eq.total_quantity) || 0;
  return eq.units.filter(u => u.status === "תקין").length;
}

export function getAvailable(eqId, borrowDate, returnDate, reservations, equipment, excludeId=null, borrowTime="", returnTime="") {
  const eq = equipment.find(e => e.id == eqId);
  if (!eq) return 0;
  // Use end-of-day if no time provided so date-only reservations still block correctly
  const bStart = toDateTime(borrowDate, borrowTime || "00:00");
  const rEnd   = toDateTime(returnDate, returnTime || "23:59");
  let used = 0;
  for (const res of reservations) {
    if (res.id === excludeId) continue;
    // Only count items physically out of the warehouse (פעילה / באיחור)
    const effStatus = getEffectiveStatus(res);
    if (effStatus !== "פעילה" && effStatus !== "באיחור") continue;
    const resStart = toDateTime(res.borrow_date, res.borrow_time || "00:00");
    // Overdue items are physically out of the warehouse — block every future request regardless of return_date
    const resEnd = effStatus === "באיחור" ? FAR_FUTURE : toDateTime(res.return_date, res.return_time || "23:59");
    // Overlap: new period starts before existing ends AND new period ends after existing starts
    if (bStart < resEnd && rEnd > resStart) {
      const item = res.items?.find(i => i.equipment_id == eqId);
      if (item) used += item.quantity;
    }
  }
  const working = workingUnits(eq);
  return Math.max(0, working - used);
}

export function getReservationApprovalConflicts(targetReservation, reservations, equipment) {
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
export function getConsecutiveBookingWarnings(targetReservation, reservations, equipment) {
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
export const css = `
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
  body { font-family:'Heebo',sans-serif; background:var(--bg); color:var(--text); direction:rtl; min-height:100vh; overflow-x:hidden; }
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
  input[type="date"].form-input::-webkit-calendar-picker-indicator,
  input[type="date"]::-webkit-calendar-picker-indicator { filter:invert(80%) sepia(60%) saturate(400%) hue-rotate(5deg) brightness(110%); opacity:0.85; cursor:pointer; }
  input[type="date"].form-input::-webkit-calendar-picker-indicator:hover,
  input[type="date"]::-webkit-calendar-picker-indicator:hover { opacity:1; }
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
