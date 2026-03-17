import { useState, useEffect, useMemo } from "react";

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

async function storageGet(key) {
  try {
    const res  = await fetch(`${SB_URL}/rest/v1/store?key=eq.${key}&select=data`, { headers: SB_HEADERS });
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

async function storageSet(key, value) {
  lsSet(key, value); // cache immediately
  try {
    const res = await fetch(`${SB_URL}/rest/v1/store`, {
      method:  "POST",
      headers: { ...SB_HEADERS, "Prefer": "resolution=merge-duplicates" },
      body:    JSON.stringify({ key, data: value, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("storageSet error", key, err);
      return { ok: false, error: err };
    }
    return { ok: true };
  } catch(e) {
    console.error("storageSet network error", key, e);
    return { ok: false, error: e.message };
  }
}

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
    if (normalizedReservation.status === "מאושר" && normalizedReservation.loan_type !== "שיעור" && returnAt !== null && nowMs >= returnAt) {
      return markReservationReturned(normalizedReservation, now);
    }
    return normalizedReservation;
  });
}

function getAvailable(eqId, borrowDate, returnDate, reservations, equipment, excludeId=null, borrowTime="", returnTime="") {
  const eq = equipment.find(e => e.id == eqId);
  if (!eq) return 0;
  // Use end-of-day if no time provided so date-only reservations still block correctly
  const bStart = toDateTime(borrowDate, borrowTime || "00:00");
  const rEnd   = toDateTime(returnDate, returnTime || "23:59");
  let used = 0;
  for (const res of reservations) {
    if (res.id === excludeId) continue;
    if (res.status !== "מאושר") continue;
    const resStart = toDateTime(res.borrow_date, res.borrow_time || "00:00");
    const resEnd   = toDateTime(res.return_date,  res.return_time  || "23:59");
    // Overlap: new period starts before existing ends AND new period ends after existing starts
    if (bStart < resEnd && rEnd > resStart) {
      const item = res.items?.find(i => i.equipment_id == eqId);
      if (item) used += item.quantity;
    }
  }
  const working = workingUnits(eq);
  return Math.max(0, working - used);
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
      if (res.status !== "מאושר") continue;

      const resStart = toDateTime(res.borrow_date, res.borrow_time || "00:00");
      const resEnd   = toDateTime(res.return_date, res.return_time || "23:59");
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
      });
    }

    const requested = Number(item.quantity) || 0;
    const total = Number(eq.total_quantity) || 0;
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
  .sidebar-logo .app-sub { font-size:11px; color:var(--text3); margin-top:3px; }
  .logo-icon { font-size:32px; margin-bottom:8px; display:block; }
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
    .dashboard-bottom-grid { grid-template-columns:1fr; }
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


function statusBadge(s) {
  const normalizedStatus = normalizeReservationStatus(s);
  const m = { "מאושר":"badge-green","ממתין":"badge-yellow","נדחה":"badge-red","הוחזר":"badge-blue","אישור ראש מחלקה":"badge-purple","תקין":"badge-green","פגום":"badge-red","בתיקון":"badge-yellow","נעלם":"badge-red" };
  return <span className={`badge ${m[normalizedStatus]||"badge-gray"}`}>{normalizedStatus}</span>;
}
function Toast({ toasts }) {
  return <div className="toast-container">{toasts.map(t=><div key={t.id} className={`toast toast-${t.type}`}><span>{t.type==="success"?"✅":t.type==="error"?"❌":"ℹ️"}</span>{t.msg}</div>)}</div>;
}
function Modal({ title, onClose, children, footer, size="" }) {
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className={`modal ${size}`}>
        <div className="modal-header"><span className="modal-title">{title}</span><button className="btn btn-secondary btn-sm btn-icon" onClick={onClose}>✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
function Loading() {
  return <div className="loading-wrap"><div className="spinner"/><span>טוען נתונים...</span></div>;
}

// ─── EQUIPMENT PAGE ───────────────────────────────────────────────────────────
function EquipmentPage({ equipment, reservations, setEquipment, showToast, categories=DEFAULT_CATEGORIES, setCategories, certifications={types:[],students:[]} }) {
  const [search, setSearch] = useState("");
  const [trackFilter, setTrackFilter] = useState("הכל");
  const [selectedCats, setSelectedCats] = useState([]);
  const [typeFilter, setTypeFilter] = useState("הכל"); // "הכל" | "סאונד" | "צילום"
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [renamingCat, setRenamingCat] = useState(null); // category name being renamed
  const [renameVal, setRenameVal]     = useState("");

  const filtered = equipment.filter(e =>
    (selectedCats.length===0||selectedCats.includes(e.category)) &&
    e.name.includes(search) &&
    (typeFilter==="הכל" || (typeFilter==="סאונד" && e.soundOnly) || (typeFilter==="צילום" && e.photoOnly))
  );

  const renameCategory = async (oldName, newName) => {
    newName = newName.trim();
    if(!newName || newName===oldName) { setRenamingCat(null); return; }
    if(categories.includes(newName)) { showToast("error","קטגוריה בשם זה כבר קיימת"); return; }
    const updatedCats = categories.map(c=>c===oldName?newName:c);
    const updatedEq   = equipment.map(e=>e.category===oldName?{...e,category:newName}:e);
    setCategories(updatedCats);
    setEquipment(updatedEq);
    setSelectedCats(prev=>prev.map(c=>c===oldName?newName:c));
    await Promise.all([storageSet("categories",updatedCats), storageSet("equipment",updatedEq)]);
    showToast("success",`קטגוריה "${oldName}" שונתה ל-"${newName}"`);
    setRenamingCat(null);
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
    setEquipment(updated);
    const _saveRes = await storageSet("equipment", updated);
    if(_saveRes.ok) showToast("success", modal.type==="add" ? `"${form.name}" נוסף בהצלחה` : "הציוד עודכן בהצלחה");
    else showToast("error", "❌ שגיאה בשמירה ל-Google Sheets — נסה שוב");
    setSaving(false);
    setModal(null);
  };

  const del = async (eq) => {
    const updated = equipment.filter(e => e.id!==eq.id);
    setEquipment(updated);
    await storageSet("equipment", updated);
    showToast("success", `"${eq.name}" נמחק`);
    setModal(null);
  };

  const toggleCategorySoundOnly = async (categoryName) => {
    const categoryItems = equipment.filter((item) => item.category === categoryName);
    if (!categoryItems.length) return;
    const shouldEnable = !categoryItems.every((item) => !!item.soundOnly);
    const updated = equipment.map((item) =>
      item.category === categoryName ? { ...item, soundOnly: shouldEnable } : item
    );
    setEquipment(updated);
    await storageSet("equipment", updated);
    showToast("success", shouldEnable ? `כל הפריטים בקטגוריית "${categoryName}" סומנו כציוד סאונד` : `הוסר סימון ציוד סאונד מקטגוריית "${categoryName}"`);
  };

  const toggleCategoryPhotoOnly = async (categoryName) => {
    const categoryItems = equipment.filter((item) => item.category === categoryName);
    if (!categoryItems.length) return;
    const shouldEnable = !categoryItems.every((item) => !!item.photoOnly);
    const updated = equipment.map((item) =>
      item.category === categoryName ? { ...item, photoOnly: shouldEnable } : item
    );
    setEquipment(updated);
    await storageSet("equipment", updated);
    showToast("success", shouldEnable ? `כל הפריטים בקטגוריית "${categoryName}" סומנו כציוד צילום` : `הוסר סימון ציוד צילום מקטגוריית "${categoryName}"`);
  };

  const toggleCategoryPrivateLoanUnlimited = async (categoryName) => {
    const categoryItems = equipment.filter((item) => item.category === categoryName);
    if (!categoryItems.length) return;
    const shouldEnable = !categoryItems.every((item) => !!item.privateLoanUnlimited);
    const updated = equipment.map((item) =>
      item.category === categoryName ? { ...item, privateLoanUnlimited: shouldEnable } : item
    );
    setEquipment(updated);
    await storageSet("equipment", updated);
    showToast("success", shouldEnable ? `הקטגוריה "${categoryName}" הוחרגה ממגבלת השאלה פרטית` : `הוחזרה מגבלת השאלה פרטית לקטגוריה "${categoryName}"`);
  };

  const todayStr2 = today();
  const used = (id) => reservations
    .filter(r=>(r.status==="מאושר"||r.status==="ממתין") && r.borrow_date<=todayStr2 && r.return_date>=todayStr2)
    .reduce((s,r)=>s+(r.items?.find(i=>i.equipment_id==id)?.quantity||0),0);

  const EqForm = ({ initial }) => {
    const [f, setF] = useState(initial||{name:"",category:"מצלמות",description:"",total_quantity:1,image:"📷",notes:"",status:"תקין",certification_id:""});
    const s = (k,v) => setF(p=>({...p,[k]:v}));
    const [imgUploading, setImgUploading] = useState(false);
    const [imgError, setImgError]         = useState("");

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
        s("image", json.url);          // store only the URL — no Base64 in Sheets
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
        <div className="form-group"><label className="form-label">תיאור</label><textarea className="form-textarea" rows={2} value={f.description} onChange={e=>s("description",e.target.value)}/></div>
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
            {(certifications?.types||[]).map(ct=>(
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

  return (
    <div className="page">
      <div className="flex-between mb-4">
        <div className="search-bar"><span>🔍</span><input placeholder="חיפוש ציוד..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={()=>setModal({type:"addcat"})}>＋ קטגוריה</button>
          <button className="btn btn-primary" onClick={()=>setModal({type:"add"})}>➕ הוסף ציוד</button>
        </div>
      </div>

      {/* ── Type filter (sound / photo) ── */}
      <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
        {[{k:"הכל",label:"📦 הכל"},{k:"סאונד",label:"🎙️ סאונד"},{k:"צילום",label:"🎥 צילום"}].map(({k,label})=>{
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
        {categories.map(c=>{
          const active = selectedCats.includes(c);
          const hasItems = equipment.some(e=>e.category===c);
          return (
            <div key={c} style={{display:"flex",alignItems:"center",gap:0,borderRadius:8,overflow:"hidden",border:`1px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"var(--surface2)"}}>
              {/* rename input or label */}
              {renamingCat===c ? (
                <input
                  autoFocus
                  value={renameVal}
                  onChange={e=>setRenameVal(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter")renameCategory(c,renameVal);if(e.key==="Escape")setRenamingCat(null);}}
                  onBlur={()=>renameCategory(c,renameVal)}
                  style={{padding:"4px 8px",background:"var(--surface)",border:"none",outline:"none",fontSize:12,fontWeight:700,color:"var(--text)",width:Math.max(80,renameVal.length*9)+"px",minWidth:60}}
                />
              ) : (
                <button
                  className="btn btn-sm"
                  style={{borderRadius:0,border:"none",background:"transparent",color:active?"var(--accent)":"var(--text2)",fontWeight:700,padding:"5px 10px"}}
                  onClick={()=>setSelectedCats(prev=>active?prev.filter(x=>x!==c):[...prev,c])}>
                  {c}
                </button>
              )}
              {/* rename button ✏️ */}
              <button
                title="שנה שם"
                onClick={()=>{setRenamingCat(c);setRenameVal(c);}}
                style={{padding:"5px 6px",border:"none",borderRight:"1px solid var(--border)",background:"transparent",color:"var(--text3)",cursor:"pointer",fontSize:11}}>
                ✏️
              </button>
              {/* delete button ✕ */}
              <button
                title={hasItems?"לא ניתן למחוק — יש ציוד":"מחק קטגוריה"}
                disabled={hasItems}
                onClick={async()=>{
                  if(window.confirm(`למחוק את הקטגוריה "${c}"?`)){
                    const updated=categories.filter(x=>x!==c);
                    setCategories(updated);
                    setSelectedCats(prev=>prev.filter(x=>x!==c));
                    await storageSet("categories",updated);
                    showToast("success",`קטגוריה "${c}" נמחקה`);
                  }
                }}
                style={{padding:"5px 8px",border:"none",background:"transparent",color:hasItems?"var(--border)":"var(--red)",cursor:hasItems?"not-allowed":"pointer",fontSize:12,fontWeight:900}}>
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {filtered.length===0 ? <div className="empty-state"><div className="emoji">📦</div><p>לא נמצא ציוד</p></div> : (
        <>
          {(selectedCats.length>0?selectedCats:categories).filter(c=>filtered.some(e=>e.category===c)).map(c=>(
            <div key={c} style={{marginBottom:32}}>
              <div style={{fontSize:13,fontWeight:800,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,marginBottom:12,paddingBottom:8,borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:8,justifyContent:"space-between",flexWrap:"wrap"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <span>{c}</span>
                <span style={{fontSize:11,color:"var(--text3)",fontWeight:400}}>({filtered.filter(e=>e.category===c).length} פריטים)</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <button
                    type="button"
                    className={`btn btn-sm ${equipment.filter(e=>e.category===c).every(e=>e.soundOnly) ? "btn-primary" : "btn-secondary"}`}
                    onClick={()=>toggleCategorySoundOnly(c)}
                  >
                    ציוד סאונד
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${equipment.filter(e=>e.category===c).every(e=>e.photoOnly) ? "btn-primary" : "btn-secondary"}`}
                    onClick={()=>toggleCategoryPhotoOnly(c)}
                  >
                    ציוד צילום
                  </button>
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
                {filtered.filter(e=>e.category===c).map(eq=>(
                  <div key={eq.id} className="eq-card" style={{position:"relative"}}>
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
                    <div style={{fontSize:13}}>
                      <strong style={{color:"var(--accent)",fontSize:20}}>{workingUnits(eq)-used(eq.id)}</strong>
                      <span style={{color:"var(--text3)"}}> / {workingUnits(eq)} זמין</span>
                      {workingUnits(eq)<eq.total_quantity&&<span style={{color:"var(--red)",fontSize:11,fontWeight:700,marginRight:6}}> · {eq.total_quantity-workingUnits(eq)} בדיקה 🔧</span>}
                    </div>
                    {eq.notes && <div className="chip" style={{marginTop:6}}>💬 {eq.notes}</div>}
                    <div style={{marginTop:8}}>{statusBadge(eq.status)}</div>
                    <div className="flex gap-2" style={{marginTop:12,flexWrap:"wrap"}}>
                      <button className="btn btn-secondary btn-sm" onClick={()=>setModal({type:"edit",item:eq})}>✏️ עריכה</button>
                      <button className="btn btn-secondary btn-sm" onClick={()=>setModal({type:"units",item:eq})}>🔧 יחידות</button>
                      <button className="btn btn-danger btn-sm" onClick={()=>setModal({type:"delete",item:eq})}>🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
      {(modal?.type==="add"||modal?.type==="edit") && <Modal title={modal.type==="add"?"➕ הוספת ציוד":"✏️ עריכת ציוד"} onClose={()=>setModal(null)}><EqForm initial={modal.type==="edit"?modal.item:null}/></Modal>}
      {modal?.type==="units" && <UnitsModal eq={modal.item} equipment={equipment} setEquipment={setEquipment} showToast={showToast} onClose={()=>setModal(null)}/>}
      {modal?.type==="delete" && <Modal title="🗑️ מחיקת ציוד" onClose={()=>setModal(null)} footer={<><button className="btn btn-danger" onClick={()=>del(modal.item)}>כן, מחק</button><button className="btn btn-secondary" onClick={()=>setModal(null)}>ביטול</button></>}><p>האם למחוק את <strong>{modal.item.name}</strong>?</p></Modal>}
      {modal?.type==="addcat" && <AddCategoryModal categories={categories} onSave={async(newCat)=>{ const updated=[...categories,newCat]; setCategories(updated); await storageSet("categories",updated); showToast("success",`קטגוריה "${newCat}" נוספה`); setModal(null); }} onClose={()=>setModal(null)}/>}
    </div>
  );
}

// ─── ADD CATEGORY MODAL ──────────────────────────────────────────────────────
function AddCategoryModal({ categories, onSave, onClose }) {
  const [name, setName] = useState("");
  const exists = categories.includes(name.trim());
  return (
    <Modal title="➕ הוספת קטגוריה" onClose={onClose}
      footer={<><button className="btn btn-primary" disabled={!name.trim()||exists} onClick={()=>onSave(name.trim())}>הוסף</button><button className="btn btn-secondary" onClick={onClose}>ביטול</button></>}>
      <div className="form-group">
        <label className="form-label">שם הקטגוריה *</label>
        <input className="form-input" value={name} onChange={e=>setName(e.target.value)} placeholder="לדוגמה: סטאביליזרים"/>
        {exists && <div style={{color:"var(--red)",fontSize:12,marginTop:4}}>קטגוריה זו כבר קיימת</div>}
      </div>
    </Modal>
  );
}

// ─── EDIT RESERVATION MODAL ──────────────────────────────────────────────────
function EditReservationModal({ reservation, equipment, reservations, onSave, onApprove, onClose, collegeManager={}, managerToken="" }) {
  const TIME_SLOTS = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30"];
  const [form, setForm]   = useState({...reservation});
  const [items, setItems] = useState(reservation.items ? [...reservation.items] : []);
  const [saving, setSaving] = useState(false);
  const [editConflicts, setEditConflicts] = useState([]);
  const [showLoanedOnly, setShowLoanedOnly] = useState(false);
  const [reportNote, setReportNote] = useState("");
  const [reportSending, setReportSending] = useState(false);

  const sendManagerReport = async () => {
    if(!collegeManager.email) return;
    setReportSending(true);
    try {
      const eqList = items.map(i=>`${i.name} ×${i.quantity}`).join(", ");
      await fetch("/api/send-email", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          to: collegeManager.email,
          type: "manager_report",
          student_name: form.student_name||reservation.student_name,
          reservation_id: String(reservation.id),
          loan_type: form.loan_type||reservation.loan_type,
          borrow_date: formatDate(form.borrow_date||reservation.borrow_date),
          return_date: formatDate(form.return_date||reservation.return_date),
          items_list: eqList,
          report_note: reportNote,
          calendar_url: managerToken ? `${window.location.origin}/manager-calendar?token=${managerToken}` : "",
        }),
      });
      setReportNote("");
      alert("✅ הדיווח נשלח למנהל המכללה");
    } catch(e) { console.error(e); }
    setReportSending(false);
  };
  const set = (k,v) => setForm(p=>({...p,[k]:v}));

  const getEquipmentBlockingDetails = (eqId) => {
    const eq = equipment.find(e=>e.id==eqId);
    if(!eq) return { total: 0, usedByOthers: 0, available: 0, blockers: [] };

    const reqStart = toDateTime(form.borrow_date, form.borrow_time || "00:00");
    const reqEnd   = toDateTime(form.return_date, form.return_time || "23:59");
    let usedByOthers = 0;
    const blockers = [];

    for (const res of reservations) {
      if (res.id === reservation.id) continue;
      if (res.status !== "מאושר") continue;

      const resStart = toDateTime(res.borrow_date, res.borrow_time || "00:00");
      const resEnd   = toDateTime(res.return_date, res.return_time || "23:59");
      const overlaps = reqStart < resEnd && reqEnd > resStart;
      if (!overlaps) continue;

      const blockingItem = (res.items || []).find(i => i.equipment_id == eqId);
      if (!blockingItem || !blockingItem.quantity) continue;

      const blockingQty = Number(blockingItem.quantity) || 0;
      usedByOthers += blockingQty;
      blockers.push({
        reservation_id: res.id,
        student_name: res.student_name || "ללא שם",
        quantity: blockingQty,
        borrow_date: res.borrow_date,
        borrow_time: res.borrow_time || "00:00",
        return_date: res.return_date,
        return_time: res.return_time || "23:59",
      });
    }

    return {
      total: Number(eq.total_quantity) || 0,
      usedByOthers,
      available: Math.max(0, (Number(eq.total_quantity) || 0) - usedByOthers),
      blockers,
    };
  };

  const getAvail = (eqId) => getEquipmentBlockingDetails(eqId).available;

  const setQty = (eqId, qty) => {
    const totalAvail = getAvail(eqId);
    const q = Math.max(0, Math.min(qty, totalAvail));
    const name = equipment.find(e=>e.id==eqId)?.name||"";
    setItems(prev => q===0 ? prev.filter(i=>i.equipment_id!=eqId)
      : prev.find(i=>i.equipment_id==eqId) ? prev.map(i=>i.equipment_id==eqId?{...i,quantity:q}:i)
      : [...prev,{equipment_id:eqId,quantity:q,name}]);
  };
  const getQty = (eqId) => items.find(i=>i.equipment_id==eqId)?.quantity||0;

  const categories = [...new Set(equipment.map(e=>e.category))];

  const save = async () => {
    const updatedReservation = { ...form, id: reservation.id, status: reservation.status, items };
    if (reservation.status === "מאושר") {
      const conflicts = getReservationApprovalConflicts(updatedReservation, reservations, equipment);
      if (conflicts.length) {
        setEditConflicts(conflicts);
        return;
      }
    }

    setSaving(true);
    await onSave(updatedReservation);
    setSaving(false);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:3000,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"24px 16px",overflowY:"auto"}}>
      <div style={{width:"100%",maxWidth:760,background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",direction:"rtl"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"20px 24px",borderBottom:"1px solid var(--border)",background:"var(--surface2)",borderRadius:"16px 16px 0 0"}}>
          <div>
            <div style={{fontWeight:900,fontSize:18}}>✏️ עריכת בקשה</div>
            <div style={{fontSize:14,color:"var(--text2)",marginTop:4,fontWeight:700}}>{reservation.student_name}</div>
            <div style={{display:"flex",gap:8,marginTop:4,alignItems:"center",flexWrap:"wrap"}}>
              <span style={{fontSize:12,color:"var(--accent)",fontWeight:700,background:"var(--surface3)",borderRadius:20,padding:"2px 10px"}}>
                {reservation.loan_type==="פרטית"?"👤":reservation.loan_type==="הפקה"?"🎬":"🎙️"} {reservation.loan_type==="סאונד"?"השאלת סאונד":`השאלה ${reservation.loan_type}`}
              </span>
              <span style={{fontSize:11,color:"var(--text3)"}}>· {formatDate(reservation.borrow_date)}</span>
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>✕ סגור</button>
        </div>

        <div style={{padding:24,display:"flex",flexDirection:"column",gap:24}}>

          <div>
            <div className="form-section-title">תאריכים ושעות</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div className="form-group">
                <label className="form-label">תאריך השאלה</label>
                <input type="date" className="form-input" value={form.borrow_date} onChange={e=>set("borrow_date",e.target.value)}/>
              </div>
              <div className="form-group">
                <label className="form-label">שעת איסוף</label>
                <select className="form-select" value={form.borrow_time||""} onChange={e=>set("borrow_time",e.target.value)}>
                  <option value="">-- בחר שעה --</option>
                  {TIME_SLOTS.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">תאריך החזרה</label>
                <input type="date" className="form-input" value={form.return_date} min={form.borrow_date} onChange={e=>set("return_date",e.target.value)}/>
              </div>
              <div className="form-group">
                <label className="form-label">שעת החזרה</label>
                <select className="form-select" value={form.return_time||""} onChange={e=>set("return_time",e.target.value)}>
                  <option value="">-- בחר שעה --</option>
                  {TIME_SLOTS.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap",marginBottom:8}}>
              <div className="form-section-title" style={{marginBottom:0}}>ציוד ({items.reduce((s,i)=>s+i.quantity,0)} פריטים)</div>
              <button
                type="button"
                className={`btn btn-sm ${showLoanedOnly ? "btn-primary" : "btn-secondary"}`}
                onClick={()=>setShowLoanedOnly(prev=>!prev)}
              >
                פריטים בלבד
              </button>
            </div>
            <div className="highlight-box" style={{marginBottom:16}}>
              המערכת סופרת מלאי רק מול בקשות <strong>מאושרות</strong> שחופפות בזמן לבקשה הזאת. אם ציוד חסום, יוצגו כאן שמות הסטודנטים והכמויות שחוסמות אותו כדי שתוכל לעבור לבקשות החופפות ולהפחית משם.
            </div>
            {categories.map(cat=>{
              const catEq = equipment.filter(e=>e.category===cat && (!showLoanedOnly || getQty(e.id) > 0));
              if(!catEq.length) return null;
              return (
                <div key={cat} style={{marginBottom:16}}>
                  <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>{cat}</div>
                  {catEq.map(eq=>{
                    const qty = getQty(eq.id);
                    const details = getEquipmentBlockingDetails(eq.id);
                    const totalAvail = details.available;
                    const remaining = Math.max(0, totalAvail - qty);
                    const missingForApproval = Math.max(0, qty - totalAvail);
                    const hasApprovalConflict = missingForApproval > 0;
                    const blockedCompletely = totalAvail === 0;
                    return (
                      <div key={eq.id} style={{marginBottom:10}}>
                        <div
                          className="item-row"
                          style={{
                            opacity: blockedCompletely && !hasApprovalConflict ? 0.55 : 1,
                            marginBottom: details.blockers.length ? 6 : 0,
                            border: hasApprovalConflict ? "2px solid rgba(241,196,15,0.95)" : "1px solid var(--border)",
                            background: hasApprovalConflict ? "rgba(241,196,15,0.22)" : "var(--surface2)",
                            boxShadow: hasApprovalConflict ? "0 0 0 1px rgba(241,196,15,0.2)" : "none",
                          }}
                        >
                          {eq.image?.startsWith("data:")||eq.image?.startsWith("http")
                            ? <img src={eq.image} alt="" style={{width:32,height:32,objectFit:"cover",borderRadius:6}}/>
                            : <span style={{fontSize:22}}>{eq.image||"📦"}</span>}
                          <div style={{flex:1}}>
                            <div style={{fontWeight:700,fontSize:13,color:hasApprovalConflict?"var(--yellow)":"var(--text)"}}>{eq.name}</div>
                            <div style={{fontSize:11,color:"var(--text3)",display:"flex",gap:10,flexWrap:"wrap"}}>
                              <span>זמין: <span style={{color:remaining===0?"var(--red)":remaining<=2?"var(--yellow)":"var(--green)",fontWeight:700}}>{remaining}</span></span>
                              {details.usedByOthers>0 && <span>חסום ע"י אחרים: <strong style={{color:"var(--red)"}}>{details.usedByOthers}</strong></span>}
                              <span>סה"כ במלאי: <strong>{details.total}</strong></span>
                              {hasApprovalConflict && <span style={{color:"var(--yellow)",fontWeight:800}}>חסר לאישור: <strong>{missingForApproval}</strong></span>}
                            </div>
                            {hasApprovalConflict && (
                              <div style={{marginTop:4,fontSize:11,fontWeight:800,color:"var(--yellow)"}}>
                                פריט זה חוסם את אישור הבקשה בגלל חוסר מלאי בחפיפה.
                              </div>
                            )}
                          </div>
                          <div className="qty-ctrl">
                            <button className="qty-btn" onClick={()=>setQty(eq.id,qty-1)}>−</button>
                            <span className="qty-num">{qty}</span>
                            <button className="qty-btn" disabled={remaining<=0} onClick={()=>setQty(eq.id,qty+1)}>+</button>
                          </div>
                        </div>
                        {details.blockers.length > 0 && (
                          <div style={{background:"rgba(241,196,15,0.1)",border:"1px solid rgba(241,196,15,0.28)",borderRadius:10,padding:10,marginBottom:6}}>
                            <div style={{fontSize:12,fontWeight:800,color:"var(--yellow)",marginBottom:8}}>הציוד הזה חסום כרגע ע"י הבקשות המאושרות הבאות:</div>
                            <div style={{display:"flex",flexDirection:"column",gap:6}}>
                              {details.blockers.map((blocker, idx) => (
                                <div key={idx} style={{background:"var(--surface3)",border:"1px solid var(--border)",borderRadius:8,padding:"8px 10px"}}>
                                  <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",fontSize:12}}>
                                    <strong>{blocker.student_name}</strong>
                                    <span>כמות שהושאלה: <strong style={{color:"var(--accent)"}}>{blocker.quantity}</strong></span>
                                  </div>
                                  <div style={{fontSize:11,color:"var(--text2)",marginTop:4,display:"flex",gap:10,flexWrap:"wrap"}}>
                                    <span>מ־{formatDate(blocker.borrow_date)} {blocker.borrow_time}</span>
                                    <span>עד {formatDate(blocker.return_date)} {blocker.return_time}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div style={{display:"flex",gap:10,justifyContent:"flex-end",paddingTop:8,borderTop:"1px solid var(--border)",flexWrap:"wrap"}}>
            {collegeManager.email&&(
            <div style={{width:"100%",background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:"12px",marginBottom:8,border:"1px solid var(--border)"}}>
              <div style={{fontWeight:700,fontSize:12,marginBottom:6,color:"var(--text2)"}}>📧 דיווח למנהל המכללה</div>
              <textarea className="form-textarea" rows={2} style={{marginBottom:6}} placeholder="פרט את הבעיה בבקשה..." value={reportNote} onChange={e=>setReportNote(e.target.value)}/>
              <button className="btn btn-secondary btn-sm" disabled={!reportNote.trim()||reportSending} onClick={sendManagerReport}>
                {reportSending?"⏳ שולח...":"📧 שלח דיווח למנהל"}
              </button>
            </div>
          )}
          <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
            {reservation.status==="נדחה"&&onApprove&&(
              <button className="btn btn-success" disabled={saving} onClick={async()=>{
                setSaving(true);
                await onApprove({...form, items, status:"מאושר"});
                setSaving(false);
              }}>✅ שמור ואשר</button>
            )}
            <button className="btn btn-primary" disabled={saving} onClick={save}>{saving?"⏳ שומר...":"💾 שמור שינויים"}</button>
          </div>
        </div>
      </div>

      {editConflicts.length > 0 && (
        <Modal
          title={`⛔ אי אפשר לשמור את העריכה של ${reservation.student_name}`}
          onClose={()=>setEditConflicts([])}
          size="modal-lg"
          footer={<button className="btn btn-secondary" onClick={()=>setEditConflicts([])}>סגור</button>}
        >
          <div className="highlight-box" style={{marginBottom:20}}>
            העריכה הזאת תיצור חוסר במלאי ביחס לבקשות מאושרות אחרות שחופפות בזמן. כדי לשחרר ציוד לבקשה הזאת, צריך להפחית אותו קודם מהבקשות החוסמות שמפורטות למטה.
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            {editConflicts.map((conflict, idx)=>(
              <div key={idx} style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:16}}>
                <div style={{fontWeight:800,fontSize:15,marginBottom:10,color:"var(--accent)"}}>{conflict.equipment_name}</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:12,fontSize:13,marginBottom:12}}>
                  <span>נדרש בבקשה הערוכה: <strong>{conflict.requested}</strong></span>
                  <span>זמין בפועל: <strong style={{color:"var(--red)"}}>{conflict.available}</strong></span>
                  <span>חסר לשמירה: <strong style={{color:"var(--red)"}}>{conflict.missing}</strong></span>
                  <span>סה"כ במלאי: <strong>{conflict.total}</strong></span>
                </div>
                <div style={{fontSize:12,color:"var(--text3)",marginBottom:8,fontWeight:700}}>הבקשות המאושרות שחוסמות את השמירה:</div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {conflict.blockers.map((blocker, bIdx)=>(
                    <div key={bIdx} style={{background:"var(--surface3)",border:"1px solid var(--border)",borderRadius:10,padding:12}}>
                      <div style={{fontWeight:700,marginBottom:4}}>{blocker.student_name}</div>
                      <div style={{fontSize:13,color:"var(--text2)",display:"flex",flexWrap:"wrap",gap:12}}>
                        <span>כמות חסומה: <strong style={{color:"var(--accent)"}}>{blocker.quantity}</strong></span>
                        <span>מ־<strong>{formatDate(blocker.borrow_date)}</strong>{blocker.borrow_time && <span style={{marginRight:6,color:"var(--accent)"}}>{blocker.borrow_time}</span>}</span>
                        <span>עד <strong>{formatDate(blocker.return_date)}</strong>{blocker.return_time && <span style={{marginRight:6,color:"var(--accent)"}}>{blocker.return_time}</span>}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── RESERVATIONS PAGE ────────────────────────────────────────────────────────
function ReservationsPage({ reservations, setReservations, equipment, showToast,
    search, setSearch, statusF, setStatusF, loanTypeF, setLoanTypeF, sortBy, setSortBy, mode="active", collegeManager={}, managerToken="" }) {
  const [selected, setSelected] = useState(null);
  const [editing, setEditing]   = useState(null);
  const [approvalConflict, setApprovalConflict] = useState(null);
  const isRejectedPage = mode === "rejected";
  const effectiveStatusFilter = !isRejectedPage && statusF !== "נדחה" ? statusF : "הכל";

  const filtered = [...reservations]
    .filter(r => {
      if (isRejectedPage) {
        if (r.status !== "נדחה") return false;
      } else {
        if (r.status === "הוחזר" || r.status === "נדחה") return false;
        if (effectiveStatusFilter !== "הכל" && r.status !== effectiveStatusFilter) return false;
      }
      return (loanTypeF==="הכל" || r.loan_type===loanTypeF) &&
        (r.student_name?.includes(search) || r.email?.includes(search));
    })
    .sort((a,b) => {
      if(sortBy==="urgency")  return new Date(a.borrow_date) - new Date(b.borrow_date);
      if(sortBy==="received") return Number(b.id) - Number(a.id);
      return 0;
    });
  const eqName = id => equipment.find(e=>e.id==id)?.name||"?";
  const eqIcon = id => equipment.find(e=>e.id==id)?.image||"📦";
  const EqImg = ({id, size=22}) => {
    const img = equipment.find(e=>e.id==id)?.image||"📦";
    return img.startsWith("data:")||img.startsWith("http")
      ? <img src={img} alt="" style={{width:size,height:size,objectFit:"cover",borderRadius:4,verticalAlign:"middle"}}/>
      : <span style={{fontSize:size}}>{img}</span>;
  };

  const exportPDF = (r) => {
    const items = r.items?.map(i => `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:14px">${eqName(i.equipment_id)}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:14px;text-align:center">${i.quantity}</td>
      </tr>`).join("") || "";
    const html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8">
    <style>
      body{font-family:Arial,sans-serif;padding:40px;color:#1a1a1a;direction:rtl}
      h1{font-size:22px;margin-bottom:4px;color:#1a1a1a}
      .sub{font-size:13px;color:#666;margin-bottom:32px}
      .section{margin-bottom:24px}
      .section-title{font-size:12px;font-weight:700;color:#f5a623;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;border-bottom:2px solid #f5a623;padding-bottom:6px}
      .row{display:flex;gap:8px;margin-bottom:8px;font-size:14px}
      .label{color:#666;min-width:130px}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      th{background:#f5f5f5;padding:10px 14px;text-align:right;font-size:12px;font-weight:700;color:#666}
      .badge{display:inline-block;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700;background:${r.status==="מאושר"?"#d4f5e9;color:#1a7a4a":r.status==="ממתין"?"#fff8e1;color:#b8860b":r.status==="נדחה"?"#fde8e8;color:#c0392b":"#e8f4fd;color:#2471a3"}}
      .footer{margin-top:40px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#999;text-align:center}
      @media print{body{padding:20px}}
    </style></head><body>
    <h1>📋 אישור בקשת השאלה</h1>
    <div class="sub">מחסן השאלת ציוד קמרה אובסקורה וסאונד — הופק ב-${new Date().toLocaleDateString("he-IL")}</div>
    <div class="section">
      <div class="section-title">פרטי סטודנט</div>
      <div class="row"><span class="label">שם מלא:</span><strong>${r.student_name}</strong></div>
      <div class="row"><span class="label">אימייל:</span>${r.email}</div>
      ${r.phone?`<div class="row"><span class="label">טלפון:</span>${r.phone}</div>`:""}
      <div class="row"><span class="label">קורס / כיתה:</span>${r.course}</div>
      ${r.project_name?`<div class="row"><span class="label">שם הפרויקט:</span>${r.project_name}</div>`:""}
      <div class="row"><span class="label">סוג השאלה:</span>${r.loan_type}</div>
    </div>
    <div class="section">
      <div class="section-title">תאריכי השאלה</div>
      <div class="row"><span class="label">תאריך השאלה:</span><strong>${formatDate(r.borrow_date)}</strong></div>
      <div class="row"><span class="label">תאריך החזרה:</span><strong>${formatDate(r.return_date)}</strong></div>
      <div class="row"><span class="label">סטטוס:</span><span class="badge">${r.status}</span></div>
    </div>
    <div class="section">
      <div class="section-title">ציוד מבוקש</div>
      <table><thead><tr><th>שם הציוד</th><th style="text-align:center;width:80px">כמות</th></tr></thead>
      <tbody>${items}</tbody></table>
    </div>
    <div class="footer">מסמך זה הופק אוטומטית ממערכת ניהול המחסן • machsan.vercel.app</div>
    </body></html>`;
    const w = window.open("","_blank","width=800,height=900");
    w.document.write(html);
    w.document.close();
    w.document.title = `השאלה - ${r.student_name} - ${formatDate(r.borrow_date)}`;
    setTimeout(()=>w.print(), 400);
  };

  const deleteReservation = async (id) => {
    const updated = reservations.filter(r => r.id !== id);
    setReservations(updated);
    await storageSet("reservations", updated);
    showToast("success", "הבקשה נמחקה");
    setSelected(null);
  };

  const sendStatusEmail = async (reservation, status) => {
    if (!reservation?.email || (status !== "מאושר" && status !== "נדחה")) return;
    const itemsList = reservation.items?.map(i => `<tr><td style="padding:7px 12px;color:#e8eaf0;border-bottom:1px solid #1e2130">${i.name || eqName(i.equipment_id)}</td><td style="padding:7px 12px;text-align:center;color:#f5a623;font-weight:700;border-bottom:1px solid #1e2130">${i.quantity}</td></tr>`).join("") || "";
    try {
      await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to:           reservation.email,
          type:         status === "מאושר" ? "approved" : "rejected",
          student_name: reservation.student_name,
          items_list:   itemsList,
          borrow_date:  formatDate(reservation.borrow_date),
          borrow_time:  reservation.borrow_time || "",
          return_date:  formatDate(reservation.return_date),
          return_time:  reservation.return_time || "",
        }),
      });
      showToast("success", `📧 מייל נשלח ל-${reservation.email}`);
    } catch {
      showToast("error", "שגיאה בשליחת המייל");
    }
  };

  const approveReservation = async (reservationToApprove) => {
    const conflicts = getReservationApprovalConflicts(reservationToApprove, reservations, equipment);
    if (conflicts.length) {
      setApprovalConflict({ reservation: reservationToApprove, conflicts });
      showToast("error", "לא ניתן לאשר - אין מספיק מלאי בחפיפת הזמנים");
      return false;
    }

    const updated = normalizeReservationsForArchive(reservations.map((r) =>
      r.id === reservationToApprove.id ? { ...reservationToApprove, status: "מאושר" } : r
    ));
    setReservations(updated);
    await storageSet("reservations", updated);
    await sendStatusEmail({ ...reservationToApprove, status: "מאושר" }, "מאושר");
    showToast("success", "הבקשה אושרה");
    setSelected(null);
    return true;
  };

  const updateStatus = async (id, status) => {
    const res = reservations.find(r=>r.id===id);
    if (!res) return;

    if (status === "מאושר") return approveReservation({ ...res, status: "מאושר" });

    const updated = normalizeReservationsForArchive(reservations.map((r) => {
      if (r.id !== id) return r;
      return status === "הוחזר" ? markReservationReturned(r) : { ...r, status };
    }));
    setReservations(updated);
    await storageSet("reservations", updated);
    showToast("success", `סטטוס עודכן ל-${status}`);
    if (status === "נדחה") await sendStatusEmail({ ...res, status: "נדחה" }, "נדחה");
    setSelected(null);
    return true;
  };

  return (
    <div className="page">

      {filtered.length===0
        ? <div className="empty-state"><div className="emoji">{isRejectedPage ? "❌" : "📭"}</div><div>{isRejectedPage ? "אין בקשות דחויות" : "אין בקשות"}</div></div>
        : <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {filtered.map(r=>{
            const isLesson = r.loan_type==="שיעור";
            const loanColor = isLesson?"rgba(155,89,182,0.12)":r.loan_type==="הפקה"?"rgba(52,152,219,0.06)":r.loan_type==="סאונד"?"rgba(245,166,35,0.06)":"var(--surface)";
            const loanBorder = isLesson?"1px solid rgba(155,89,182,0.35)":r.loan_type==="הפקה"?"1px solid rgba(52,152,219,0.2)":"1px solid var(--border)";
            const loanIcon = isLesson?"📽️":r.loan_type==="פרטית"?"👤":r.loan_type==="הפקה"?"🎬":"🎙️";
            const loanLabel = isLesson?"השאלת שיעור":r.loan_type==="סאונד"?"השאלת סאונד":`השאלה ${r.loan_type}`;
            return (
            <div key={r.id} className="res-card"
              style={{background:loanColor,border:loanBorder,cursor:"pointer"}}
              onClick={()=>setSelected(selected?.id===r.id?null:r)}
              onMouseEnter={e=>e.currentTarget.style.borderColor=isLesson?"rgba(155,89,182,0.7)":"var(--accent)"}
              onMouseLeave={e=>e.currentTarget.style.borderColor=isLesson?"rgba(155,89,182,0.35)":"var(--border)"}>
              <div className="res-card-top">
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:38,height:38,borderRadius:"50%",background:isLesson?"rgba(155,89,182,0.2)":"var(--surface3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:900,flexShrink:0,color:isLesson?"#9b59b6":"inherit"}}>
                    {isLesson?"🎬":r.student_name?.[0]||"?"}
                  </div>
                  <div>
                    <div style={{fontWeight:700,fontSize:15}}>{r.student_name}</div>
                    <div style={{fontSize:11,color:"var(--text3)"}}>{r.email}</div>
                  </div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  {statusBadge(r.status)}
                  <span style={{fontSize:11,color:"var(--text3)"}}>{formatDate(r.created_at)}</span>
                </div>
              </div>
              <div className="res-card-mid">
                <div style={{display:"flex",gap:16,fontSize:12,color:"var(--text2)",flexWrap:"wrap"}}>
                  <span>⏱️ {getLoanDurationDays(r.borrow_date, r.return_date)} ימים</span>
                  <span>📚 {r.course}</span>
                  <span>📅 {formatDate(r.borrow_date)}{r.borrow_time&&<span style={{color:"var(--accent)",marginRight:4,fontWeight:700}}> {r.borrow_time}</span>} ← {formatDate(r.return_date)}{r.return_time&&<span style={{color:"var(--accent)",marginRight:4,fontWeight:700}}> {r.return_time}</span>}{(()=>{const diff=Math.ceil((new Date(r.borrow_date)-new Date())/(1000*60*60*24));return diff>0?<span style={{marginRight:6,color:"var(--yellow)",fontWeight:700}}>({diff} ימים)</span>:diff===0?<span style={{marginRight:6,color:"var(--green)",fontWeight:700}}>(היום!)</span>:null;})()}</span>
                  <span>📦 {r.items?.length||0} פריטים</span>
                  {r.loan_type&&<span style={{background:isLesson?"rgba(155,89,182,0.2)":"var(--surface3)",border:isLesson?"1px solid rgba(155,89,182,0.4)":"1px solid var(--border)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700,color:isLesson?"#9b59b6":"var(--accent)"}}>
                    {loanIcon} {loanLabel}
                  </span>}
                </div>
                <div style={{marginTop:8,display:"flex",flexWrap:"wrap",gap:4}}>
                  {r.items?.slice(0,3).map((i,j)=><span key={j} className="chip"><EqImg id={i.equipment_id} size={13}/> {eqName(i.equipment_id)} ×{i.quantity}</span>)}
                  {(r.items?.length||0)>3&&<span className="chip">+{r.items.length-3} נוספים</span>}
                </div>
              </div>
              <div className="res-card-actions" onClick={e=>e.stopPropagation()}>
                <button className="btn btn-secondary btn-sm" onClick={()=>exportPDF(r)}>📄 PDF</button>
                {(r.status==="מאושר"||r.status==="נדחה")&&<button className="btn btn-secondary btn-sm" onClick={()=>setEditing(r)}>✏️ עריכת בקשה</button>}
                {r.status==="ממתין"&&<><button className="btn btn-success btn-sm" onClick={()=>updateStatus(r.id,"מאושר")}>✅ אשר</button><button className="btn btn-danger btn-sm" onClick={()=>updateStatus(r.id,"נדחה")}>❌ דחה</button></>}
                {r.status==="מאושר"&&<button className="btn btn-secondary btn-sm" onClick={()=>updateStatus(r.id,"הוחזר")}>🔄 הוחזר</button>}
                <button className="btn btn-danger btn-sm" onClick={()=>{ if(window.confirm(`למחוק את הבקשה של ${r.student_name}?`)) deleteReservation(r.id); }}>🗑️</button>
              </div>
            </div>
            );
          })}
        </div>
      }
      {editing && <EditReservationModal reservation={editing} equipment={equipment} reservations={reservations} collegeManager={collegeManager} managerToken={managerToken}
  onSave={async(updated)=>{ const all=normalizeReservationsForArchive(reservations.map(r=>r.id===updated.id?updated:r)); setReservations(all); await storageSet("reservations",all); showToast("success","הבקשה עודכנה"); setEditing(null); }}
  onApprove={editing.status==="נדחה" ? async(updated)=>{
    const approved = await approveReservation(updated);
    if (approved) setEditing(null);
    return approved;
  } : null}
  onClose={()=>setEditing(null)}/>}

      {approvalConflict && (
        <Modal
          title={`⛔ אי אפשר לאשר את הבקשה של ${approvalConflict.reservation.student_name}`}
          onClose={()=>setApprovalConflict(null)}
          size="modal-lg"
          footer={<button className="btn btn-secondary" onClick={()=>setApprovalConflict(null)}>סגור</button>}
        >
          <div className="highlight-box" style={{marginBottom:20}}>
            הבקשה לא יכולה להיות מאושרת כי בחפיפת הזמנים המבוקשת אין מספיק מלאי זמין. להלן הפריטים החוסמים והבקשות שכבר אושרו לפניהם.
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            {approvalConflict.conflicts.map((conflict, idx)=>(
              <div key={idx} style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:16}}>
                <div style={{fontWeight:800,fontSize:15,marginBottom:10,color:"var(--accent)"}}>{conflict.equipment_name}</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:12,fontSize:13,marginBottom:12}}>
                  <span>נדרש בבקשה הזאת: <strong>{conflict.requested}</strong></span>
                  <span>זמין בפועל: <strong style={{color:"var(--red)"}}>{conflict.available}</strong></span>
                  <span>חסר לאישור: <strong style={{color:"var(--red)"}}>{conflict.missing}</strong></span>
                  <span>סה"כ במלאי: <strong>{conflict.total}</strong></span>
                </div>
                <div style={{fontSize:12,color:"var(--text3)",marginBottom:8,fontWeight:700}}>הבקשות המאושרות שחוסמות את האישור:</div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {conflict.blockers.map((blocker, bIdx)=>(
                    <div key={bIdx} style={{background:"var(--surface3)",border:"1px solid var(--border)",borderRadius:10,padding:12}}>
                      <div style={{fontWeight:700,marginBottom:4}}>{blocker.student_name}</div>
                      <div style={{fontSize:13,color:"var(--text2)",display:"flex",flexWrap:"wrap",gap:12}}>
                        <span>כמות חסומה: <strong style={{color:"var(--accent)"}}>{blocker.quantity}</strong></span>
                        <span>מ־<strong>{formatDate(blocker.borrow_date)}</strong>{blocker.borrow_time && <span style={{marginRight:6,color:"var(--accent)"}}>{blocker.borrow_time}</span>}</span>
                        <span>עד <strong>{formatDate(blocker.return_date)}</strong>{blocker.return_time && <span style={{marginRight:6,color:"var(--accent)"}}>{blocker.return_time}</span>}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {selected && (
        <Modal title={`📋 בקשה — ${selected.student_name}`} onClose={()=>setSelected(null)} size="modal-lg"
          footer={<>
            {selected.status==="ממתין"&&<><button className="btn btn-success" onClick={()=>updateStatus(selected.id,"מאושר")}>✅ אשר</button><button className="btn btn-danger" onClick={()=>updateStatus(selected.id,"נדחה")}>❌ דחה</button></>}
            {selected.status==="נדחה"&&<button className="btn btn-success" onClick={()=>updateStatus(selected.id,"מאושר")}>✅ אשר בקשה</button>}
            {selected.status==="מאושר"&&<button className="btn btn-secondary" onClick={()=>updateStatus(selected.id,"הוחזר")}>🔄 סמן כהוחזר</button>}
            <button className="btn btn-secondary" onClick={()=>exportPDF(selected)}>📄 ייצא PDF</button>
            <button className="btn btn-danger" onClick={()=>{ if(window.confirm(`למחוק את הבקשה של ${selected.student_name}?`)) deleteReservation(selected.id); }}>🗑️ מחק</button>
            <button className="btn btn-secondary" onClick={()=>setSelected(null)}>סגור</button>
          </>}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:20}}>
            <div>
              <div className="form-section-title">פרטי סטודנט</div>
              <div style={{background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:16,border:"1px solid var(--border)"}}>
                {[["שם",selected.student_name],["אימייל",selected.email],["טלפון",selected.phone],["קורס",selected.course],["פרויקט",selected.project_name],["סוג השאלה",selected.loan_type]].map(([l,v])=>v?
                  <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid var(--border)",fontSize:13}}>
                    <span style={{color:"var(--text3)"}}>{l}</span>
                    <strong style={{textAlign:"left",maxWidth:"60%",wordBreak:"break-word"}}>{v}</strong>
                  </div>:null)}
              </div>
              <div style={{marginTop:16,background:"var(--accent-glow)",border:"1px solid rgba(245,166,35,0.3)",borderRadius:"var(--r-sm)",padding:14}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8,fontSize:13}}>
                  <span style={{color:"var(--text3)"}}>📅 תאריך השאלה</span>
                  <strong>{formatDate(selected.borrow_date)}{selected.borrow_time&&<span style={{marginRight:6,color:"var(--accent)"}}>{selected.borrow_time}</span>}</strong>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:13}}>
                  <span style={{color:"var(--text3)"}}>🔄 תאריך החזרה</span>
                  <strong>{formatDate(selected.return_date)}{selected.return_time&&<span style={{marginRight:6,color:"var(--accent)"}}>{selected.return_time}</span>}</strong>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginTop:8,paddingTop:8,borderTop:"1px solid rgba(245,166,35,0.15)"}}>
                  <span style={{color:"var(--text3)"}}>⏱️ משך ההשאלה</span>
                  <strong>{getLoanDurationDays(selected.borrow_date, selected.return_date)} ימים</strong>
                </div>
              </div>
              <div style={{marginTop:12,textAlign:"center"}}>{statusBadge(selected.status)}</div>
            </div>
            <div>
              <div className="form-section-title">ציוד מבוקש ({selected.items?.length||0} פריטים)</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {selected.items?.map((item,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:"var(--surface2)",borderRadius:"var(--r-sm)",border:"1px solid var(--border)"}}>
                    <EqImg id={item.equipment_id} size={32}/>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:14}}>{eqName(item.equipment_id)}</div>
                      <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>כמות: <strong style={{color:"var(--accent)"}}>{item.quantity}</strong></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function CalendarGrid({ days, activeRes, colorMap, todayStr, cellHeight=110, fontSize=11, previewId="", lessonIds=null }) {
  // Split days into weeks of 7
  const weeks = [];
  for(let i=0;i<days.length;i+=7) weeks.push(days.slice(i,i+7));

  // For each week, compute event bars with slot assignment (no overlaps)
  const getWeekBars = (week) => {
    const weekStart = week.find(d=>d);
    const weekEnd   = [...week].reverse().find(d=>d);
    if(!weekStart||!weekEnd) return [];
    const wsStr = dateToLocal(weekStart);
    const weStr = dateToLocal(weekEnd);

    // events overlapping this week, sorted by borrow_date then by id (insertion order)
    const evts = activeRes
      .filter(r => r.borrow_date<=weStr && r.return_date>=wsStr)
      .sort((a,b) => a.borrow_date<b.borrow_date?-1:a.borrow_date>b.borrow_date?1:Number(a.id)-Number(b.id));

    // slot assignment: each slot tracks the last ec used
    // A bar can go into slot S only if slotEnd[S] < sc (columns don't overlap)
    const slotEnd = []; // slotEnd[s] = last ec used in slot s
    const bars = [];
    evts.forEach(r=>{
      const [bg,color] = colorMap[r.id]||["rgba(52,152,219,0.38)","#5dade2"];
      const startCol = week.findIndex(d=>d && dateToLocal(d)>=r.borrow_date);
      const endColRaw= week.findLastIndex(d=>d && dateToLocal(d)<=r.return_date);
      const sc = startCol<0?0:startCol;
      const ec = endColRaw<0?6:endColRaw;
      // find lowest slot where this bar fits (no column overlap)
      let slot=0;
      while(slotEnd[slot]!==undefined && slotEnd[slot]>=sc) slot++;
      slotEnd[slot]=ec;
      bars.push({r,bg,color,sc,ec,slot,showName: week[sc]&&dateToLocal(week[sc])>=r.borrow_date});
    });
    return bars;
  };

  const DAY_NUM_H = 22;
  const EVENT_H   = fontSize+8;
  const EVENT_GAP = 2;

  return (
    <div style={{direction:"rtl"}}>
      {weeks.map((week,wi)=>{
        const bars = getWeekBars(week);
        const maxSlot = bars.length?Math.max(...bars.map(b=>b.slot)):0;
        const rowH = Math.max(cellHeight, DAY_NUM_H + (maxSlot+1)*(EVENT_H+EVENT_GAP)+8);
        return (
          <div key={wi} style={{position:"relative",height:rowH,marginBottom:4}}>
            {/* Background cells */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,height:"100%",position:"absolute",inset:0}}>
              {week.map((d,di)=>{
                const isToday=d&&dateToLocal(d)===todayStr;
                return (
                  <div key={di} style={{
                    background:"var(--surface2)",borderRadius:6,
                    border:`1px solid ${isToday?"var(--accent)":"var(--border)"}`,
                    padding:"5px 6px",overflow:"hidden",
                    opacity:!d?0.2:1,
                  }}>
                    {d&&<div style={{fontSize:13,fontWeight:isToday?900:700,color:isToday?"var(--accent)":"var(--text2)"}}>{d.getDate()}</div>}
                  </div>
                );
              })}
            </div>
            {/* Event overlay bars */}
            {bars.map((b,bi)=>{
              const colW = 100/7;
              const right = `calc(${b.sc*colW}% + 2px)`;
              const width = `calc(${(b.ec-b.sc+1)*colW}% - 4px)`;
              const top   = DAY_NUM_H + b.slot*(EVENT_H+EVENT_GAP);
              const isResStart = week[b.sc]&&dateToLocal(week[b.sc])===b.r.borrow_date;
              const isResEnd   = week[b.ec]&&dateToLocal(week[b.ec])===b.r.return_date;
              return (
                <div key={bi} style={{
                  position:"absolute",
                  right, top, width, height:EVENT_H,
                  background:b.bg,
                  borderRadius: isResStart&&isResEnd?"4px": isResStart?"0 4px 4px 0": isResEnd?"4px 0 0 4px":"0",
                  display:"flex",alignItems:"center",justifyContent:"flex-end",
                  paddingLeft:isResStart?8:2, paddingRight:isResEnd?6:2,
                  overflow:"hidden",whiteSpace:"nowrap",
                  fontSize, color:b.color, fontWeight:700,
                  zIndex:previewId&&b.r.id===previewId?0:1,
                  outline:previewId&&b.r.id===previewId?"2px dashed rgba(245,166,35,0.7)":
                    (lessonIds&&lessonIds.has(b.r.id))||b.r.loan_type==="שיעור"?"2px dashed rgba(155,89,182,0.8)":"none",
                  outlineOffset:"-2px",
                }}>
                  {isResStart && <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{b.r.student_name}{b.r.borrow_time&&<span style={{opacity:0.8,fontSize:fontSize-1}}> {b.r.borrow_time}</span>}</span>}
                  {!isResStart && isResEnd && <span style={{fontWeight:700,overflow:"hidden",textOverflow:"ellipsis"}}>↩ {b.r.student_name}{b.r.return_time&&<span style={{opacity:0.8,fontSize:fontSize-1}}> {b.r.return_time}</span>}</span>}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function DashboardPage({ equipment, reservations }) {
  const todayStr = today();
  const nowMs = Date.now();

  // ── מלאי ──
  const totalItems   = equipment.length;
  const totalUnits   = equipment.reduce((s, e) => s + workingUnits(e), 0);
  const totalDamaged = equipment.reduce((s, e) => s + (Array.isArray(e.units)?e.units.filter(u=>u.status!=="תקין").length:0), 0);

  // ── בקשות פעילות עכשיו ──
  const activeNow = reservations.filter(r =>
    r.status === "מאושר" && r.borrow_date <= todayStr && r.return_date >= todayStr
  );
  // ── כל בקשות מאושרות (כולל עתידיות) ──
  const allApproved = reservations.filter(r => r.status === "מאושר");

  // ── פריטים ויחידות שנמצאים כרגע בהשאלה ──
  const onLoanItems = activeNow.reduce((s,r) => s + (r.items?.length||0), 0);
  const onLoanUnits = activeNow.reduce((s,r) =>
    s + (r.items||[]).reduce((ss,i) => ss + (Number(i.quantity)||0), 0), 0);

  // ── תורים ──
  const pending         = reservations.filter(r => r.status === "ממתין").length;
  const deptHeadPending = reservations.filter(r => r.status === "אישור ראש מחלקה").length;
  const rejected        = reservations.filter(r => r.status === "נדחה").length;

  // ── היום ──
  const rtToday    = allApproved.filter(r => r.return_date === todayStr).length;
  const todayLoans = reservations.filter(r =>
    r.status !== "נדחה" && r.status !== "הוחזר" &&
    r.borrow_date <= todayStr && r.return_date >= todayStr
  ).length;

  const [calDate, setCalDate]       = useState(new Date());
  const [calFS, setCalFS]           = useState(false);
  const [dashViewRes, setDashViewRes] = useState(null);
  const [calStatusF, setCalStatusF] = useState([]);
  const [calLoanTypeF, setCalLoanTypeF] = useState("הכל");
  const [onLoanModal, setOnLoanModal] = useState(null); // "units" | "items" | null

  const yr = calDate.getFullYear();
  const mo = calDate.getMonth();

  const HE_M = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  const HE_D = ["א׳","ב׳","ג׳","ד׳","ה׳","ו׳","ש׳"];

  const days = [];
  const startOffset = new Date(yr,mo,1).getDay();
  for(let i=0;i<startOffset;i++) days.push(null);
  for(let d=1;d<=new Date(yr,mo+1,0).getDate();d++) days.push(new Date(yr,mo,d));
  while(days.length<42) days.push(null);

  const SPAN_COLORS = [
    ["rgba(52,152,219,0.75)","#fff"],  ["rgba(46,204,113,0.75)","#fff"],
    ["rgba(231,76,60,0.75)","#fff"],   ["rgba(155,89,182,0.75)","#fff"],
    ["rgba(200,160,0,0.75)","#fff"],   ["rgba(230,126,34,0.75)","#fff"],
    ["rgba(26,188,156,0.75)","#fff"],  ["rgba(236,72,153,0.75)","#fff"],
  ];
  const DASHBOARD_CAL_STATUSES = ["ממתין","מאושר","נדחה","אישור ראש מחלקה"];
  const CAL_LOAN_TYPES = [
    { key:"הכל", label:"הכל", icon:"📦" },
    { key:"פרטית", label:"פרטית", icon:"👤" },
    { key:"הפקה", label:"הפקה", icon:"🎬" },
    { key:"סאונד", label:"סאונד", icon:"🎙️" },
    { key:"שיעור", label:"שיעור", icon:"📽️" },
  ];
  const LOAN_TYPE_ICON = { "פרטית":"👤","הפקה":"🎬","סאונד":"🎙️","שיעור":"📽️" };

  const activeRes = reservations.filter(r =>
    r.status !== "הוחזר" && r.borrow_date && r.return_date &&
    (calStatusF.length===0 || calStatusF.includes(r.status)) &&
    (calLoanTypeF==="הכל" || r.loan_type===calLoanTypeF)
  );
  const colorMap = {};
  const lessonResIds = new Set(activeRes.filter(r=>r.loan_type==="שיעור").map(r=>r.id));
  let nonLessonIdx = 0;
  activeRes.forEach(r => {
    if(r.loan_type==="שיעור") colorMap[r.id] = ["rgba(155,89,182,0.7)","#fff"];
    else { colorMap[r.id] = SPAN_COLORS[nonLessonIdx % SPAN_COLORS.length]; nonLessonIdx++; }
  });
  // aggregate by equipment
  const onLoanDetails = (() => {
    const map = {};
    activeNow.forEach(r => {
      (r.items||[]).forEach(item => {
        const key = item.equipment_id;
        if(!map[key]) map[key] = { name:item.name||"?", qty:0, reservations:[] };
        map[key].qty += Number(item.quantity)||0;
        map[key].reservations.push({
          student: r.student_name||"",
          loan_type: r.loan_type||"",
          borrow_date: r.borrow_date,
          return_date: r.return_date,
          borrow_time: r.borrow_time||"",
          return_time: r.return_time||"",
          qty: Number(item.quantity)||0,
        });
      });
    });
    return Object.values(map).sort((a,b)=>b.qty-a.qty);
  })();

  const groupLabel = s => ({ c:"var(--text3)", fontWeight:800, fontSize:11,
    textTransform:"uppercase", letterSpacing:1, marginBottom:8, marginTop:16 });

  return (
    <div className="page">

      {/* ── Group 1: מלאי ── */}
      <div style={groupLabel()}>📦 מלאי</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:4}}>
        {[
          { l:"פריטי ציוד",  v:totalItems,   i:"📦", c:"var(--accent)" },
          { l:"סך יחידות",  v:totalUnits,   i:"🗃️", c:"var(--blue)"   },
          { l:"יחידות בדיקה",v:totalDamaged, i:"🔧", c:"var(--red)"    },
        ].map(s=>(
          <div key={s.l} className="stat-card" style={{"--ac":s.c}}>
            <div className="stat-label">{s.l}</div>
            <div className="stat-value">{s.v}</div>
            <div className="stat-icon">{s.i}</div>
          </div>
        ))}
        {/* Clickable on-loan cards */}
        <div className="stat-card" style={{"--ac":"var(--orange,#e67e22)",cursor:"pointer",border:"1px solid rgba(230,126,34,0.35)"}}
          onClick={()=>setOnLoanModal("items")}
          onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(230,126,34,0.7)";}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(230,126,34,0.35)";}}>
          <div className="stat-label">סוגי פריטים בהשאלה <span style={{fontSize:10,color:"var(--text3)"}}>← לחץ לפרטים</span></div>
          <div className="stat-value" style={{color:"#e67e22"}}>{onLoanItems}</div>
          <div className="stat-icon">📤</div>
        </div>
        <div className="stat-card" style={{"--ac":"var(--orange,#e67e22)",cursor:"pointer",border:"1px solid rgba(230,126,34,0.35)"}}
          onClick={()=>setOnLoanModal("units")}
          onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(230,126,34,0.7)";}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(230,126,34,0.35)";}}>
          <div className="stat-label">יחידות בהשאלה <span style={{fontSize:10,color:"var(--text3)"}}>← לחץ לפרטים</span></div>
          <div className="stat-value" style={{color:"#e67e22"}}>{onLoanUnits}</div>
          <div className="stat-icon">📤</div>
        </div>
      </div>

      {/* ── Group 2: בקשות ── */}
      <div style={{...groupLabel(),marginTop:20}}>📋 בקשות</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:4}}>
        {[
          { l:"השאלות פעילות", v:allApproved.length,  i:"✅", c:"var(--green)"  },
          { l:"ממתין לאישור",  v:pending,              i:"⏳", c:"var(--yellow)" },
          { l:"אישור ראש מחלקה",v:deptHeadPending,    i:"🟣", c:"var(--purple)" },
          { l:"בקשות דחויות",  v:rejected,             i:"❌", c:"var(--red)"    },
        ].map(s=>(
          <div key={s.l} className="stat-card" style={{"--ac":s.c}}>
            <div className="stat-label">{s.l}</div>
            <div className="stat-value">{s.v}</div>
            <div className="stat-icon">{s.i}</div>
          </div>
        ))}
      </div>

      {/* ── Group 3: היום ── */}
      <div style={{...groupLabel(),marginTop:20}}>📅 היום</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:24}}>
        {[
          { l:"השאלות פעילות היום", v:todayLoans, i:"📋", c:"var(--purple)" },
          { l:"החזרות היום",        v:rtToday,    i:"🔄", c:"var(--blue)"   },
        ].map(s=>(
          <div key={s.l} className="stat-card" style={{"--ac":s.c}}>
            <div className="stat-label">{s.l}</div>
            <div className="stat-value">{s.v}</div>
            <div className="stat-icon">{s.i}</div>
          </div>
        ))}
      </div>

      {/* ── On-loan modal ── */}
      {onLoanModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px",direction:"rtl"}}
          onClick={e=>e.target===e.currentTarget&&setOnLoanModal(null)}>
          <div style={{width:"100%",maxWidth:680,maxHeight:"85vh",background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"16px 20px",background:"var(--surface2)",borderBottom:"1px solid var(--border)",borderRadius:"16px 16px 0 0",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
              <div>
                <div style={{fontWeight:900,fontSize:17,color:"#e67e22"}}>
                  📤 {onLoanModal==="units" ? "יחידות בהשאלה" : "פריטים בהשאלה"} — עכשיו
                </div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
                  {onLoanModal==="units"
                    ? `${onLoanUnits} יחידות מחוץ למחסן בהשאלות פעילות`
                    : `${onLoanItems} סוגי פריטים בהשאלות פעילות`}
                </div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={()=>setOnLoanModal(null)}>✕</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:10}}>
              {activeNow.length===0
                ? <div style={{textAlign:"center",color:"var(--text3)",padding:"32px",fontSize:14}}>אין השאלות פעילות כרגע</div>
                : onLoanModal==="items"
                ? /* Per equipment type */
                  onLoanDetails.map((d,i)=>(
                    <div key={i} style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"12px 16px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                        <div style={{fontWeight:800,fontSize:14}}>{d.name}</div>
                        <span style={{background:"rgba(230,126,34,0.15)",border:"1px solid rgba(230,126,34,0.4)",borderRadius:20,padding:"2px 10px",fontSize:13,fontWeight:900,color:"#e67e22"}}>
                          ×{d.qty} בהשאלה
                        </span>
                      </div>
                      <div style={{display:"flex",flexDirection:"column",gap:4}}>
                        {d.reservations.map((rv,j)=>(
                          <div key={j} style={{display:"flex",gap:8,alignItems:"center",fontSize:12,color:"var(--text3)",flexWrap:"wrap"}}>
                            <span style={{background:"var(--surface3)",borderRadius:6,padding:"1px 8px",fontWeight:700,color:"var(--text2)"}}>{LOAN_TYPE_ICON[rv.loan_type]||"📦"} {rv.loan_type||"?"}</span>
                            <span style={{fontWeight:600,color:"var(--text)"}}>{rv.student}</span>
                            <span>📅 {formatDate(rv.borrow_date)}{rv.borrow_time&&` ${rv.borrow_time}`} → {formatDate(rv.return_date)}{rv.return_time&&` ${rv.return_time}`}</span>
                            <span style={{color:"#e67e22",fontWeight:700}}>×{rv.qty}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                : /* Per reservation */
                  activeNow.sort((a,b)=>a.return_date<b.return_date?-1:1).map(r=>(
                    <div key={r.id} style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"12px 16px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,flexWrap:"wrap",marginBottom:8}}>
                        <div>
                          <div style={{fontWeight:800,fontSize:14}}>{r.student_name}</div>
                          <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
                            <span style={{background:"var(--surface3)",borderRadius:6,padding:"1px 8px",fontWeight:700,color:"var(--text2)",marginLeft:6}}>{LOAN_TYPE_ICON[r.loan_type]||"📦"} {r.loan_type}</span>
                            📅 {formatDate(r.borrow_date)}{r.borrow_time&&` ${r.borrow_time}`} → {formatDate(r.return_date)}{r.return_time&&` ${r.return_time}`}
                          </div>
                        </div>
                        <span style={{background:"rgba(230,126,34,0.15)",border:"1px solid rgba(230,126,34,0.3)",borderRadius:20,padding:"2px 10px",fontSize:12,fontWeight:900,color:"#e67e22",flexShrink:0}}>
                          {(r.items||[]).reduce((s,i)=>s+(Number(i.quantity)||0),0)} יחידות
                        </span>
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                        {(r.items||[]).map((item,j)=>(
                          <span key={j} style={{background:"var(--surface3)",border:"1px solid var(--border)",borderRadius:6,padding:"3px 9px",fontSize:11,color:"var(--text2)"}}>
                            {item.name} <strong style={{color:"var(--accent)"}}>×{item.quantity}</strong>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))
              }
            </div>
          </div>
        </div>
      )}

      <div className="dashboard-bottom-grid mb-6">
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
        {/* ── בקשות אחרונות ── */}
        <div className="card">
          <div className="card-header"><span className="card-title">🕒 בקשות אחרונות</span></div>
          {[...reservations].filter(r=>r.status!=="הוחזר"&&r.loan_type!=="שיעור").sort((a,b)=>Number(b.id)-Number(a.id)).slice(0,6).map(r=>(
            <div key={r.id} className="recent-request-row" style={{borderBottom:"1px solid var(--border)"}} onClick={()=>setDashViewRes(r)}>
              <div style={{width:34,height:34,borderRadius:"50%",background:"var(--surface2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>{r.student_name?.[0]||"?"}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:13}}>{r.student_name}</div>
                <div style={{fontSize:11,color:"var(--text3)"}}>
                  <span style={{display:"inline-block",marginLeft:8,fontWeight:800,color:"var(--text)"}}>משך: {getLoanDurationDays(r.borrow_date, r.return_date)} ימים</span>
                  📅 {formatDate(r.borrow_date)}{r.borrow_time&&<strong style={{color:"var(--accent)",marginRight:3}}> {r.borrow_time}</strong>}
                  <span style={{margin:"0 3px"}}>–</span>
                  ↩ {formatDate(r.return_date)}{r.return_time&&<strong style={{color:"var(--accent)",marginRight:3}}> {r.return_time}</strong>}
                  {(()=>{const diff=Math.ceil((new Date(r.borrow_date)-new Date())/(1000*60*60*24));return diff>0?<span style={{marginRight:5,color:"var(--yellow)",fontWeight:700}}>({diff}י)</span>:diff===0?<span style={{marginRight:5,color:"var(--green)",fontWeight:700}}>(היום)</span>:null;})()}
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                {statusBadge(r.status)}
              </div>
            </div>
          ))}
          {reservations.filter(r=>r.loan_type!=="שיעור").length===0&&<div className="empty-state"><div className="emoji">📋</div><p>אין בקשות עדיין</p></div>}
        </div>

        {/* ── שיעורים להכנה ── */}
        {(()=>{
          const upcomingLessons = reservations
            .filter(r=>r.loan_type==="שיעור" && r.borrow_date >= todayStr)
            .sort((a,b)=>a.borrow_date<b.borrow_date?-1:a.borrow_time<b.borrow_time?-1:1)
            .slice(0,5);
          if(!upcomingLessons.length) return null;
          return (
            <div className="card" style={{border:"1px solid rgba(155,89,182,0.3)",background:"rgba(155,89,182,0.03)"}}>
              <div className="card-header">
                <span className="card-title">🎬 שיעורים להכנה</span>
                <span style={{fontSize:11,color:"var(--text3)"}}>הבאים בתור</span>
              </div>
              {upcomingLessons.map(r=>{
                const isToday = r.borrow_date===todayStr;
                const isTomorrow = r.borrow_date===formatLocalDateInput(new Date(Date.now()+86400000));
                const tag = isToday ? <span style={{background:"rgba(46,204,113,0.15)",border:"1px solid var(--green)",borderRadius:20,padding:"1px 8px",fontSize:10,fontWeight:900,color:"var(--green)",marginRight:6}}>היום</span>
                  : isTomorrow ? <span style={{background:"rgba(245,166,35,0.12)",border:"1px solid var(--accent)",borderRadius:20,padding:"1px 8px",fontSize:10,fontWeight:900,color:"var(--accent)",marginRight:6}}>מחר</span> : null;
                return (
                  <div key={r.id} style={{borderBottom:"1px solid var(--border)",padding:"10px 0",display:"flex",gap:10,alignItems:"flex-start"}}>
                    <div style={{width:34,height:34,borderRadius:8,background:"rgba(155,89,182,0.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>🎬</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:13,display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
                        {tag}{r.course||r.student_name}
                      </div>
                      <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>
                        📅 {formatDate(r.borrow_date)} · 🕐 {r.borrow_time||"?"} – {r.return_time||"?"}
                        {r.student_name&&r.student_name!==r.course&&<span style={{marginRight:6}}>· 👨‍🏫 {r.student_name}</span>}
                      </div>
                      {r.items?.length>0&&(
                        <div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:4}}>
                          {r.items.map((item,j)=>(
                            <span key={j} style={{background:"var(--surface3)",borderRadius:5,padding:"1px 7px",fontSize:10,color:"var(--text2)"}}>
                              {item.name} <strong style={{color:"#9b59b6"}}>×{item.quantity}</strong>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
        </div>

        <div className="card calendar-card">
          <div className="card-header">
            <span className="card-title">📅 יומן</span>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <button className="btn btn-secondary btn-sm" onClick={()=>setCalDate(new Date(yr,mo-1,1))}>‹</button>
              <span style={{fontWeight:800,minWidth:110,textAlign:"center"}}>{HE_M[mo]} {yr}</span>
              <button className="btn btn-secondary btn-sm" onClick={()=>setCalDate(new Date(yr,mo+1,1))}>›</button>
              <button className="btn btn-secondary btn-sm" title="מסך מלא" onClick={()=>setCalFS(true)} style={{marginRight:8}}>⛶</button>
            </div>
          </div>
          {/* Status filter chips */}
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
              {DASHBOARD_CAL_STATUSES.map(s=>{
                const active = calStatusF.includes(s);
                const clr = s==="מאושר" ? "var(--green)" : s==="ממתין" ? "var(--yellow)" : s==="אישור ראש מחלקה" ? "var(--purple)" : "var(--red)";
                return (
                  <button key={s} type="button" onClick={()=>setCalStatusF(p=>active?p.filter(x=>x!==s):[...p,s])}
                    style={{padding:"3px 10px",borderRadius:20,border:`2px solid ${active?clr:"var(--border)"}`,background:active?`color-mix(in srgb,${clr} 15%,transparent)`:"transparent",color:active?clr:"var(--text3)",fontWeight:700,fontSize:11,cursor:"pointer"}}>
                    {s==="מאושר" ? "✅" : s==="ממתין" ? "⏳" : s==="אישור ראש מחלקה" ? "🟣" : "❌"} {s}
                  </button>
                );
              })}
            {calStatusF.length>0&&<button type="button" onClick={()=>setCalStatusF([])} style={{padding:"3px 10px",borderRadius:20,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:11,cursor:"pointer"}}>✕ הכל</button>}
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
            {CAL_LOAN_TYPES.map((filterOption) => {
              const active = calLoanTypeF === filterOption.key;
              return (
                <button
                  key={filterOption.key}
                  type="button"
                  onClick={()=>setCalLoanTypeF(filterOption.key)}
                  style={{padding:"3px 10px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:11,cursor:"pointer"}}
                >
                  {filterOption.icon} {filterOption.label}
                </button>
              );
            })}
          </div>
          {/* Day headers */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:4,direction:"rtl"}}>
            {HE_D.map(d=><div key={d} style={{textAlign:"center",fontSize:11,fontWeight:700,color:"var(--text3)",padding:"4px 0"}}>{d}</div>)}
          </div>
          <CalendarGrid days={days} activeRes={activeRes} colorMap={colorMap} todayStr={todayStr} cellHeight={90} fontSize={10} lessonIds={lessonResIds}/>
        </div>
      </div>

      {calFS&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:2000,display:"flex",flexDirection:"column"}}>
          <div style={{display:"flex",alignItems:"center",gap:12,padding:"14px 20px",borderBottom:"1px solid var(--border)",background:"var(--surface)",flexShrink:0}}>
            <button className="btn btn-secondary btn-sm" onClick={()=>setCalDate(new Date(yr,mo-1,1))}>‹</button>
            <span style={{fontWeight:800,fontSize:20,minWidth:140,textAlign:"center"}}>{HE_M[mo]} {yr}</span>
            <button className="btn btn-secondary btn-sm" onClick={()=>setCalDate(new Date(yr,mo+1,1))}>›</button>
            <button className="btn btn-secondary" style={{marginRight:"auto"}} onClick={()=>setCalFS(false)}>✕ סגור</button>
          </div>
          <div style={{flex:1,overflow:"auto",padding:"16px 20px"}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:4,direction:"rtl"}}>
              {HE_D.map(d=><div key={d} style={{textAlign:"center",fontSize:13,fontWeight:700,color:"var(--text3)",padding:"6px 0"}}>{d}</div>)}
            </div>
            <CalendarGrid days={days} activeRes={activeRes} colorMap={colorMap} todayStr={todayStr} cellHeight={130} fontSize={13} lessonIds={lessonResIds}/>
          </div>
        </div>
      )}

      {/* Dashboard quick-view modal */}
      {dashViewRes&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}} onClick={e=>e.target===e.currentTarget&&setDashViewRes(null)}>
          <div style={{width:"100%",maxWidth:520,background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",direction:"rtl",maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:"1px solid var(--border)",background:"var(--surface2)",borderRadius:"16px 16px 0 0",position:"sticky",top:0}}>
              <div>
                <div style={{fontWeight:900,fontSize:16}}>📋 {dashViewRes.student_name}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{dashViewRes.email}</div>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                {statusBadge(dashViewRes.status)}
                <button className="btn btn-secondary btn-sm" onClick={()=>setDashViewRes(null)}>✕</button>
              </div>
            </div>
            <div style={{padding:"18px 20px",display:"flex",flexDirection:"column",gap:14}}>
              <div style={{background:"var(--accent-glow)",border:"1px solid rgba(245,166,35,0.3)",borderRadius:"var(--r-sm)",padding:14}}>
                {[["📅 השאלה",`${formatDate(dashViewRes.borrow_date)}${dashViewRes.borrow_time?" · "+dashViewRes.borrow_time:""}`],["↩ החזרה",`${formatDate(dashViewRes.return_date)}${dashViewRes.return_time?" · "+dashViewRes.return_time:""}`],["📚 קורס",dashViewRes.course],["🎬 סוג",dashViewRes.loan_type]].map(([l,v])=>(
                  <div key={l} style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"4px 0",borderBottom:"1px solid rgba(245,166,35,0.15)"}}>
                    <span style={{color:"var(--text3)"}}>{l}</span>
                    <strong>{v}</strong>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:13,paddingTop:8,marginTop:8,borderTop:"1px solid rgba(245,166,35,0.15)"}}>
                <span style={{color:"var(--text3)"}}>⏱️ משך ההשאלה</span>
                <strong>{getLoanDurationDays(dashViewRes.borrow_date, dashViewRes.return_date)} ימים</strong>
              </div>
              <div>
                <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>ציוד ({dashViewRes.items?.length||0} פריטים)</div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {dashViewRes.items?.map((i,j)=>(
                    <div key={j} style={{display:"flex",justifyContent:"space-between",padding:"6px 12px",background:"var(--surface2)",borderRadius:"var(--r-sm)",fontSize:13}}>
                      <span>{equipment.find(e=>e.id==i.equipment_id)?.name||"?"}</span>
                      <strong style={{color:"var(--accent)"}}>×{i.quantity}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// ─── PUBLIC MINI CALENDAR ────────────────────────────────────────────────────
function PublicMiniCalendar({ reservations, initialLoanType="הכל", previewStart="", previewEnd="", previewName="" }) {
  const [calDate, setCalDate] = useState(new Date());
  const [loanTypeF, setLoanTypeF] = useState(["פרטית","הפקה","סאונד"].includes(initialLoanType) ? initialLoanType : "הכל");
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
  const LOAN_FILTERS = [{key:"הכל",label:"הכל",icon:"📦"},{key:"פרטית",label:"פרטית",icon:"👤"},{key:"הפקה",label:"הפקה",icon:"🎬"},{key:"סאונד",label:"סאונד",icon:"🎙️"}];
  const activeRes = reservations.filter(r=>
    r.status==="מאושר" && r.borrow_date && r.return_date &&
    r.loan_type !== "שיעור" &&
    (loanTypeF==="הכל" || r.loan_type===loanTypeF)
  );
  // Add preview entry for user's selected dates
  const previewRes = previewStart && previewEnd ? [{
    id:"__preview__", student_name:previewName, borrow_date:previewStart,
    return_date:previewEnd, status:"preview", loan_type:""
  }] : [];
  const allRes = [...activeRes, ...previewRes];
  const colorMap = {};
  activeRes.forEach((r,i)=>{ colorMap[r.id]=SPAN_COLORS[i%SPAN_COLORS.length]; });
  colorMap["__preview__"] = ["rgba(245,166,35,0.45)","#f5a623"]; // dashed yellow

  return (
    <div style={{marginBottom:16,marginTop:8}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,flexWrap:"wrap",gap:6}}>
        <div style={{fontWeight:800,fontSize:13,color:"var(--text2)"}}>📅 השאלות מאושרות</div>
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
        {activeRes.length===0&&<div style={{textAlign:"center",fontSize:12,color:"var(--text3)",padding:"8px 0"}}>אין השאלות מאושרות</div>}
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
    if (equipmentFilter === "sound") return !!eq.soundOnly;
    if (equipmentFilter === "photo") return !!eq.photoOnly;
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
function InfoPanel({ policies, kits, equipment, teamMembers, onClose }) {
  const [tab, setTab] = useState("policies");
  const [selectedEq, setSelectedEq] = useState(null);  // equipment detail view
  const [infoCatFilter, setInfoCatFilter] = useState([]); // multi-select
  const tabs = [
    { id:"equipment", label:"📦 ציוד" },
    { id:"policies",  label:"📋 נהלים" },
    { id:"kits",      label:"🎒 ערכות" },
    { id:"contact",   label:"📞 צוות" },
  ];
  const LOAN_ICONS = { "פרטית":"👤","הפקה":"🎬","סאונד":"🎙️" };
  const allCats = [...new Set((equipment||[]).map(e=>e.category).filter(Boolean))];
  const visibleEq = infoCatFilter.length===0
    ? (equipment||[])
    : (equipment||[]).filter(e=>infoCatFilter.includes(e.category));

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:5000,display:"flex",alignItems:"stretch",justifyContent:"center",padding:"0",direction:"rtl"}}>
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
              {["פרטית","הפקה","סאונד"].map(lt=>{
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

// ─── PUBLIC FORM ──────────────────────────────────────────────────────────────
function PublicForm({ equipment, reservations, setReservations, showToast, categories=DEFAULT_CATEGORIES, kits=[], teamMembers=[], policies={}, certifications={types:[],students:[]}, deptHeads=[], calendarToken="" }) {
  const initialParams = new URLSearchParams(window.location.search);
  const initialLoanTypeParam = initialParams.get("loan_type");
  const initialStepParam = Number(initialParams.get("step"));
  const initialLoanType = ["פרטית","הפקה","סאונד"].includes(initialLoanTypeParam || "") ? initialLoanTypeParam : "";
  const initialStep = initialParams.get("calendar")==="1"
    ? 2
    : (Number.isInteger(initialStepParam) && initialStepParam >= 1 && initialStepParam <= 4 ? initialStepParam : 1);
  const [step, setStep]       = useState(initialStep);
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

  const minDays = form.loan_type==="פרטית" ? 2 : form.loan_type==="סאונד" ? 0 : 7;
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
    const d = new Date();
    d.setDate(d.getDate() + minDays);
    return moveToNextWeekday(formatLocalDateInput(d));
  })();
  const maxDays = form.loan_type==="פרטית" ? 4 : 7;
  const tooSoon = form.loan_type!=="סאונד" && !!form.borrow_date && form.borrow_date < minDate;
  const loanDays = (form.borrow_date && form.return_date)
    ? Math.ceil((parseLocalDate(form.return_date) - parseLocalDate(form.borrow_date)) / 86400000) + 1
    : 0;
  const tooLong = loanDays > maxDays;
  const TIME_SLOTS = form.loan_type==="סאונד"
    ? ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30"]
    : ["09:00","09:30","14:30","15:00","15:30","16:00","16:30","17:00","17:30"];
  const isSoundLoan = form.loan_type==="סאונד";
  const isProductionLoan = form.loan_type==="הפקה";
  const isSoundDayLoan = isSoundLoan && !!form.sound_day_loan;
  const soundDayLoanDate = isSoundDayLoan ? getNextSoundDayLoanDate(TIME_SLOTS) : "";
  const availableBorrowSlots = isSoundDayLoan ? getFutureTimeSlotsForDate(soundDayLoanDate, TIME_SLOTS) : TIME_SLOTS;
  const availableReturnSlots = isSoundDayLoan
    ? availableBorrowSlots.filter((slot) => !form.borrow_time || toDateTime(soundDayLoanDate, slot) > toDateTime(soundDayLoanDate, form.borrow_time))
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
  const ok2 = !!form.borrow_date && !!form.return_date && hasTimes && !returnBeforeBorrow && !tooSoon && !tooLong && !borrowWeekend && !returnWeekend && !timeOrderError;
  const ok3 = items.some(item => Number(item.quantity) > 0);
  const canSubmit = !!ok1 && !!ok2 && !!ok3 && !privateLoanLimitExceeded && !!agreed;

  const availEq = useMemo(()=>{
    if(!form.borrow_date||!form.return_date) return [];
    return equipment.map(eq=>({...eq, avail: getAvailable(eq.id,form.borrow_date,form.return_date,reservations,equipment,null,form.borrow_time,form.return_time)}));
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
      const fresh = await storageGet("reservations");
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
    const newRes = { ...form, id:Date.now(), status:initStatus, created_at:today(), items };
    const updated = [...freshReservations, newRes];
    setReservations(updated);
    await storageSet("reservations", updated);
    await sendEmail(newRes);
    setSub(false);
    setDone(true);
    showToast("success","הבקשה נשלחה בהצלחה!");
  };

  const reset = () => { setDone(false); setEmailError(false); setStep(1); setForm({student_name:"",email:"",phone:"",course:"",project_name:"",borrow_date:"",borrow_time:"",return_date:"",return_time:"",loan_type:"",sound_day_loan:false,crew_photographer_name:"",crew_photographer_phone:"",crew_sound_name:"",crew_sound_phone:""}); setItems([]); setAgreed(false); };

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
    <div className="form-page">
      <div className="form-card">
        <div className="form-card-header" style={{position:"relative"}}>
          <button type="button" onClick={()=>setShowInfoPanel(true)}
            title="מידע כללי, נהלים וערכות"
            style={{position:"absolute",top:12,left:12,width:32,height:32,borderRadius:"50%",border:"2px solid var(--border)",background:"var(--surface2)",color:"var(--text3)",fontSize:15,fontWeight:900,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1}}>
            ℹ
          </button>
          <div style={{fontSize:40,marginBottom:10}}>🎬</div>
          <div style={{fontSize:24,fontWeight:900,color:"var(--accent)"}}>מחסן השאלת ציוד קמרה אובסקורה וסאונד</div>
          <div style={{fontSize:14,color:"var(--text2)",marginTop:4}}>טופס השאלת ציוד</div>
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
                    <div style={{fontWeight:800,fontSize:15,color:form.loan_type===opt.val?"var(--accent)":"var(--text)"}}>{opt.val==="סאונד"?"השאלת סאונד":opt.val==="הפקה"?"השאלת הפקה":`השאלה ${opt.val}`}</div>
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
                השאלת יום פעילה. התאריך חושב אוטומטית ל־{formatDate(soundDayLoanDate)} וניתן לבחור רק שעות עתידיות זמינות.
              </div>
            )}
            <div className="grid-2">
              <div className="form-group"><label className="form-label">📅 תאריך השאלה *</label>{isSoundDayLoan ? <div className="form-input" style={{display:"flex",alignItems:"center",fontWeight:700}}>{formatDate(soundDayLoanDate)}</div> : <input type="date" className="form-input" min={minDate} value={form.borrow_date} onChange={e=>set("borrow_date",e.target.value)}/>}</div>
              <div className="form-group"><label className="form-label">שעת איסוף *</label>
                <select className="form-select" value={form.borrow_time} onChange={e=>setForm(prev=>({...prev,borrow_time:e.target.value,return_time:isSoundDayLoan && prev.return_time && toDateTime(soundDayLoanDate, prev.return_time) <= toDateTime(soundDayLoanDate, e.target.value) ? "" : prev.return_time}))}>
                  <option value="">-- בחר שעה --</option>
                  {availableBorrowSlots.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="grid-2">
              <div className="form-group"><label className="form-label">📅 תאריך החזרה *</label>{isSoundDayLoan ? <div className="form-input" style={{display:"flex",alignItems:"center",fontWeight:700}}>{formatDate(soundDayLoanDate)}</div> : <input type="date" className="form-input" min={form.borrow_date||today()} value={form.return_date} onChange={e=>set("return_date",e.target.value)}/>}</div>
              <div className="form-group"><label className="form-label">שעת החזרה *</label>
                <select className="form-select" value={form.return_time} onChange={e=>set("return_time",e.target.value)}>
                  <option value="">-- בחר שעה --</option>
                  {availableReturnSlots.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            {(borrowWeekend||returnWeekend) && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 המחסן אינו פעיל בימים שישי ושבת. נא לבחור ימים א׳–ה׳ בלבד.</div>}
            {tooSoon && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 {form.loan_type==="פרטית"?"השאלה פרטית דורשת התראה של 48 שעות לפחות.":"נדרשת התראה של שבוע לפחות."} תאריך מוקדם ביותר: <strong>{formatDate(minDate)}</strong></div>}
            {tooLong && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 לא ניתן להשלים את התהליך כי זמן ההשאלה חורג מנהלי המכללה. משך מקסימלי: <strong>{maxDays} ימים</strong></div>}
            {returnBeforeBorrow && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 זמנים לא נכונים — תאריך החזרה חייב להיות אחרי תאריך ההשאלה.</div>}
            {timeOrderError && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 זמנים לא נכונים — שעת החזרה חייבת להיות אחרי שעת האיסוף באותו יום.</div>}
            {ok2 && <div className="highlight-box">📅 השאלה ל-{loanDays} ימים · איסוף {form.borrow_time} · החזרה {form.return_time}</div>}

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
    {showInfoPanel&&<InfoPanel policies={policies} kits={kits} equipment={equipment} teamMembers={teamMembers} onClose={()=>setShowInfoPanel(false)}/>}
    </>
  );
}

// ─── POLICIES PAGE ────────────────────────────────────────────────────────────
function PoliciesPage({ policies, setPolicies, showToast }) {
  const LOAN_TYPES = [
    { key:"פרטית", icon:"👤", label:"השאלה פרטית" },
    { key:"הפקה",  icon:"🎬", label:"השאלה להפקה" },
    { key:"סאונד", icon:"🎙️", label:"השאלת סאונד" },
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
  const [trackFilter, setTrackFilter] = useState("הכל");
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
  const filtered = archived.filter(r =>
    (loanTypeF==="הכל"||r.loan_type===loanTypeF) &&
    (!search || r.student_name?.includes(search) || r.email?.includes(search))
  );

  const LOAN_ICONS = {"פרטית":"👤","הפקה":"🎬","סאונד":"🎙️"};

  return (
    <div className="page">
      <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap",alignItems:"center"}}>
        <div className="search-bar" style={{flex:1,minWidth:160}}><span>🔍</span><input placeholder="חיפוש לפי שם או מייל..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <select className="form-select" style={{width:130,fontSize:12}} value={loanTypeF} onChange={e=>setLoanTypeF(e.target.value)}>
          <option value="הכל">כל הסוגים</option>
          {["פרטית","הפקה","סאונד"].map(t=><option key={t}>{t}</option>)}
        </select>
        <span style={{fontSize:13,color:"var(--text3)"}}>סה״כ: <strong style={{color:"var(--text)"}}>{filtered.length}</strong> בקשות</span>
      </div>

      {filtered.length===0
        ? <div className="empty-state"><div className="emoji">🗄️</div><p>אין בקשות בארכיון</p></div>
        : <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {[...filtered].sort((a,b)=>(new Date(b.returned_at || b.return_date).getTime()) - (new Date(a.returned_at || a.return_date).getTime())).map(r=>(
            <div key={r.id}
              style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"14px 18px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:34,height:34,borderRadius:"50%",background:"rgba(52,152,219,0.15)",border:"2px solid var(--blue)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:900,flexShrink:0,color:"var(--blue)"}}>{r.student_name?.[0]||"?"}</div>
                  <div>
                    <div style={{fontWeight:700,fontSize:14}}>{r.student_name}</div>
                    <div style={{fontSize:11,color:"var(--text3)"}}>{r.email}</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                  <span style={{background:"rgba(52,152,219,0.12)",color:"var(--blue)",border:"1px solid rgba(52,152,219,0.4)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>🔵 הוחזר</span>
                  {r.loan_type&&<span style={{background:"var(--surface3)",border:"1px solid var(--border)",borderRadius:20,padding:"2px 8px",fontSize:11,color:"var(--accent)",fontWeight:700}}>{LOAN_ICONS[r.loan_type]||"📦"} {r.loan_type}</span>}
                  <button className="btn btn-secondary btn-sm" onClick={e=>{e.stopPropagation();setViewRes(r);}}>👁️ פרטים</button>
                  <button className="btn btn-danger btn-sm" onClick={e=>{e.stopPropagation();deleteRes(r.id);}}>🗑️</button>
                </div>
              </div>
              <div style={{marginTop:10,display:"flex",gap:16,fontSize:12,color:"var(--text2)",flexWrap:"wrap"}}>
                <span>📅 {formatDate(r.borrow_date)}{r.borrow_time&&<strong style={{color:"var(--accent)",marginRight:4}}> {r.borrow_time}</strong>}</span>
                <span>↩ {formatDate(r.return_date)}{r.return_time&&<strong style={{color:"var(--accent)",marginRight:4}}> {r.return_time}</strong>}</span>
                <span>📦 {r.items?.length||0} פריטים</span>
                <span>📚 {r.course}</span>
              </div>
              <div style={{marginTop:8,display:"flex",flexWrap:"wrap",gap:4}}>
                {r.items?.map((i,j)=><span key={j} className="chip"><EqImg id={i.equipment_id}/> {eqName(i.equipment_id)} ×{i.quantity}</span>)}
              </div>
            </div>
          ))}
        </div>
      }

      {/* ── View-only details modal ── */}
      {viewRes&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}} onClick={e=>e.target===e.currentTarget&&setViewRes(null)}>
          <div style={{width:"100%",maxWidth:560,background:"var(--surface)",borderRadius:16,border:"1px solid rgba(52,152,219,0.4)",direction:"rtl",maxHeight:"90vh",overflowY:"auto"}}>
            {/* Header */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"18px 22px",borderBottom:"1px solid var(--border)",background:"var(--surface2)",borderRadius:"16px 16px 0 0",position:"sticky",top:0,zIndex:1}}>
              <div>
                <div style={{fontWeight:900,fontSize:17}}>🗄️ פרטי השאלה — ארכיון</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:3}}>{viewRes.student_name}</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={()=>setViewRes(null)}>✕ סגור</button>
            </div>
            <div style={{padding:"20px 22px",display:"flex",flexDirection:"column",gap:16}}>
              {/* Status */}
              <div style={{display:"flex",justifyContent:"center"}}>
                <span style={{background:"rgba(52,152,219,0.12)",color:"var(--blue)",border:"1px solid rgba(52,152,219,0.4)",borderRadius:20,padding:"4px 18px",fontSize:13,fontWeight:700}}>🔵 הוחזר</span>
              </div>
              {/* Student details */}
              <div style={{background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:"14px 16px"}}>
                <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",marginBottom:10,textTransform:"uppercase",letterSpacing:1}}>פרטי סטודנט</div>
                {[["שם",viewRes.student_name],["מייל",viewRes.email],["טלפון",viewRes.phone||"—"],["קורס",viewRes.course],viewRes.project_name&&["שם פרויקט",viewRes.project_name]].filter(Boolean).map(([l,v])=>(
                  <div key={l} style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:6,gap:12}}>
                    <span style={{color:"var(--text3)",flexShrink:0}}>{l}:</span>
                    <span style={{fontWeight:600,textAlign:"left",direction:"ltr"}}>{v}</span>
                  </div>
                ))}
              </div>
              {/* Dates */}
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
              {/* Equipment */}
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
                {viewRes.returned_at && (
                  <div style={{marginTop:8,fontSize:12,color:"var(--text3)"}}>
                    הועבר לארכיון: <strong style={{color:"var(--text)"}}>{new Date(viewRes.returned_at).toLocaleString("he-IL")}</strong>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TEAM PAGE ────────────────────────────────────────────────────────────────
function TeamPage({ teamMembers, setTeamMembers, deptHeads=[], setDeptHeads, calendarToken="", collegeManager={}, setCollegeManager, showToast, managerToken="" }) {
  const LOAN_TYPES = ["פרטית","הפקה","סאונד"];
  const LOAN_ICONS = { "פרטית":"👤", "הפקה":"🎬", "סאונד":"🎙️" };
  const emptyForm = { name:"", email:"", phone:"", loanTypes:[...LOAN_TYPES] };
  const DH_LOAN_TYPES = ["הפקה","סאונד"];
  const DH_LOAN_ICONS = { "הפקה":"🎬", "סאונד":"🎙️" };
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
    if(!_tmNew.ok) showToast("error", "❌ שגיאה בשמירה ל-Google Sheets — נסה שוב");
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
    if(!_tmEditRes.ok) showToast("error", "❌ שגיאה בשמירה ל-Google Sheets — נסה שוב");
    else showToast("success", "איש צוות עודכן");
    setEditMember(null);
  };

  const del = async (id) => {
    const updated = teamMembers.filter(m => m.id!==id);
    setTeamMembers(updated);
    const _tmDelRes = await storageSet("teamMembers", updated);
    if(!_tmDelRes.ok) showToast("error", "❌ שגיאה בשמירה ל-Google Sheets");
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
function KitsPage({ kits, setKits, equipment, categories, showToast, reservations=[], setReservations }) {
  const [mode, setMode] = useState(null); // null | "student" | "lesson" | "editStudent" | "editLesson"
  const [editTarget, setEditTarget] = useState(null);
  const [tabView, setTabView] = useState("student"); // "student" | "lesson"
  const LOAN_TYPES = ["פרטית","הפקה","סאונד","הכל"];
  const LOAN_ICONS = { "פרטית":"👤", "הפקה":"🎬", "סאונד":"🎙️", "הכל":"📦" };

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
    const [name, setName] = useState(initial?.name||"");
    const [description, setDescription] = useState(initial?.description||"");
    const [loanType, setLoanType] = useState(initial?.loanType||"הכל");
    const [kitItems, setKitItems] = useState(initial?.items||[]);
    const [saving, setSaving] = useState(false);
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
      const kit = { id:initial?.id||Date.now(), kitType:"student", name:trimmedName, description:description.trim(), loanType:loanType==="הכל"?"":loanType, items:kitItems };
      const updated = initial ? kits.map(k=>k.id===initial.id?kit:k) : [...kits, kit];
      setKits(updated);
      const r = await storageSet("kits", updated);
      showToast(r.ok?"success":"error", r.ok ? (initial?"הערכה עודכנה":`ערכה לסטודנט "${trimmedName}" נוצרה`) : "❌ שגיאה בשמירה");
      if(r.ok) onDone();
      setSaving(false);
    };

    return (
      <div className="card" style={{marginBottom:20}}>
        <div className="card-header">
          <div className="card-title">🎒 {initial?"עריכת ערכה לסטודנט":"ערכה חדשה לסטודנט"}</div>
          <button className="btn btn-secondary btn-sm" onClick={onDone}>✕ ביטול</button>
        </div>
        <div className="responsive-split" style={{marginBottom:12}}>
          <div className="form-group"><label className="form-label">שם הערכה *</label>
            <input className="form-input" placeholder='לדוגמה: "ערכת דוקומנטרי"' value={name} onChange={e=>setName(e.target.value)}/>
            {duplicateName&&<div style={{fontSize:12,color:"var(--red)",marginTop:4}}>כבר קיימת ערכה עם השם הזה.</div>}
          </div>
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
        </div>
        <div className="form-group" style={{marginBottom:16}}>
          <label className="form-label">תיאור הערכה</label>
          <textarea className="form-textarea" rows={2} placeholder="תיאור קצר..." value={description} onChange={e=>setDescription(e.target.value)}/>
        </div>
        <div className="form-section-title">ציוד בערכה</div>
        {categories.map(cat=>{
          const catEq = equipment.filter(e=>e.category===cat);
          if(!catEq.length) return null;
          return (
            <div key={cat} style={{marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",marginBottom:6,textTransform:"uppercase",letterSpacing:1}}>{cat}</div>
              {catEq.map(eq=>{
                const max = maxQty(eq.id);
                const qty = getQty(eq.id);
                return (
                  <div key={eq.id} className="item-row" style={{marginBottom:4,opacity:max===0?0.4:1}}>
                    <span style={{fontSize:20}}>{eq.image?.startsWith("data:")||eq.image?.startsWith("http")?<img src={eq.image} alt="" style={{width:24,height:24,objectFit:"cover",borderRadius:4}}/>:eq.image||"📦"}</span>
                    <div style={{flex:1,fontSize:13,fontWeight:600}}>{eq.name}<span style={{fontSize:11,color:"var(--text3)",marginRight:6,fontWeight:400}}>מלאי: {max}</span></div>
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
        })}
        {kitItems.length>0&&<div className="highlight-box" style={{marginTop:8}}>🎒 {kitItems.length} סוגי ציוד · {kitItems.reduce((s,i)=>s+i.quantity,0)} יחידות</div>}
        <div style={{marginTop:12,display:"flex",gap:8}}>
          <button className="btn btn-primary" disabled={!trimmedName||duplicateName||saving} onClick={save}>{saving?"⏳ שומר...":initial?"💾 שמור":"➕ צור ערכה"}</button>
        </div>
      </div>
    );
  };

  // ── Lesson Kit Form ───────────────────────────────────────────────────────
  const LessonKitForm = ({ initial, onDone }) => {
    const [name, setName]                   = useState(initial?.name||initial?.courseName||"");
    const [instructorName, setInstructorName] = useState(initial?.instructorName||"");
    const [instructorPhone, setInstructorPhone] = useState(initial?.instructorPhone||"");
    const [instructorEmail, setInstructorEmail] = useState(initial?.instructorEmail||"");
    const [description, setDescription]     = useState(initial?.description||"");
    const [kitItems, setKitItems]           = useState(initial?.items||[]);
    const [schedule, setSchedule]           = useState(initial?.schedule||[]);
    const [scheduleMode, setScheduleMode]   = useState("manual"); // "manual" | "xl"
    const [saving, setSaving]               = useState(false);
    const [xlImporting, setXlImporting]     = useState(false);
    const [teacherMessage, setTeacherMessage] = useState("");
    const [teacherEmailSending, setTeacherEmailSending] = useState(false);
    const isEditMode = !!initial;

    // Equipment filter state
    const [lessonEqTypeF, setLessonEqTypeF]       = useState("all"); // "all"|"sound"|"photo"
    const [lessonCatF, setLessonCatF]             = useState([]);    // multi-select categories
    const [lessonEqSearch, setLessonEqSearch]     = useState("");
    const [lessonShowSelected, setLessonShowSelected] = useState(false);

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
      if(!manStartDate) { showToast("error","יש לבחור תאריך"); return; }
      const count = Math.max(1, Math.min(52, Number(manCount)||1));
      const sessions = [];
      let d = parseLocalDate(manStartDate);
      for(let i=0;i<count;i++) {
        sessions.push({ date: formatLocalDateInput(d), startTime: manStartTime, endTime: manEndTime });
        d.setDate(d.getDate()+7);
      }
      setSchedule(prev => [...prev, ...sessions]);
      showToast("success", `נוספו ${sessions.length} שיעורים`);
    };

    const appendLessonFromExisting = (sourceIndex = null) => {
      const source = sourceIndex !== null && schedule[sourceIndex]
        ? schedule[sourceIndex]
        : schedule[schedule.length - 1];
      if (!source) {
        showToast("error", "אין עדיין שיעורים קיימים לשכפול");
        return;
      }
      const nextDateObj = parseLocalDate(source.date || today());
      nextDateObj.setDate(nextDateObj.getDate() + 7);
      const nextLesson = {
        date: formatLocalDateInput(nextDateObj),
        startTime: source.startTime || "09:00",
        endTime: source.endTime || "12:00",
      };
      setSchedule(prev => {
        if (sourceIndex === null || sourceIndex < 0 || sourceIndex >= prev.length) {
          return [...prev, nextLesson];
        }
        const updated = [...prev];
        updated.splice(sourceIndex + 1, 0, nextLesson);
        return updated;
      });
      showToast("success", "נוסף שיעור חדש לפי טווח השעות הקיים");
    };

    // XL import for schedule
    const importScheduleXL = async (e) => {
      const file = e.target.files[0];
      if(!file) return;
      e.target.value = "";
      setXlImporting(true);
      try {
        const processRows = (rows) => {
          if(!rows.length) { showToast("error","קובץ ריק"); return; }
          const headers = rows[0].map(h=>String(h||"").trim().replace(/[\uFEFF]/g,"").toLowerCase());
          const dateIdx    = headers.findIndex(h=>h.includes("תאריך")||h.includes("date"));
          const startIdx   = headers.findIndex(h=>h.includes("התחלה")||h.includes("start")||h.includes("שעת התחלה"));
          const endIdx     = headers.findIndex(h=>h.includes("סיום")||h.includes("end")||h.includes("שעת סיום"));
          const courseIdx  = headers.findIndex(h=>h.includes("קורס")||h.includes("course")||h.includes("שם"));
          if(dateIdx===-1) { showToast("error",'לא נמצאה עמודת "תאריך"'); setXlImporting(false); return; }
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
           showToast("success", `יובאו ${sessions.length} שיעורים`);
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
        showToast("error","שגיאה בייבוא הקובץ");
        setXlImporting(false);
      }
    };

    const sendTeacherKitEmail = async () => {
      const recipient = String(instructorEmail || "").trim();
      if (!recipient) {
        showToast("error", "יש להזין מייל למורה לפני השליחה");
        return;
      }
      const message = String(teacherMessage || "").trim();
      if (!message) {
        showToast("error", "יש למלא נוסח לשליחת הערכה למורה");
        return;
      }
      if (!kitItems.length) {
        showToast("error", "לא ניתן לשלוח ערכה למורה ללא ציוד בערכה");
        return;
      }
      setTeacherEmailSending(true);
      try {
        const itemsList = (kitItems || []).map((item) => {
          const eq = equipment.find((entry) => entry.id == item.equipment_id);
          const itemName = eq?.name || item.name || "פריט";
          return `<tr><td style="padding:7px 12px;color:#e8eaf0;border-bottom:1px solid #1e2130">${itemName}</td><td style="padding:7px 12px;text-align:center;color:#f5a623;font-weight:700;border-bottom:1px solid #1e2130">${item.quantity}</td></tr>`;
        }).join("");
        const scheduleList = (schedule || []).map((session, index) => {
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
            student_name: instructorName.trim() || name.trim() || "מורה",
            recipient_name: instructorName.trim() || name.trim() || "",
            lesson_kit_name: name.trim(),
            custom_message: message,
            items_list: itemsList,
            lesson_schedule: scheduleList,
          }),
        });
        showToast("success", `המייל נשלח אל ${recipient}`);
      } catch (err) {
        console.error("lesson kit teacher email error", err);
        showToast("error", "שגיאה בשליחת הערכה למורה");
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
      if(!name.trim()) { showToast("error","חובה למלא שם ערכה"); return; }

      // Always rebuild from current schedule state + manual inputs if needed
      let finalSchedule = [...schedule]; // copy current state

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
        showToast("error","יש להוסיף לפחות שיעור אחד — בחר תאריך ושעות");
        return;
      }
      setSaving(true);

      const kitId = initial?.id||`lk_${Date.now()}`;
      const kit = {
        id: kitId, kitType:"lesson",
        name: name.trim(),
        instructorName: instructorName.trim(),
        instructorPhone: instructorPhone.trim(),
        instructorEmail: instructorEmail.trim(),
        description: description.trim(),
        items: kitItems, schedule: finalSchedule,
      };
      const updatedKits = initial ? kits.map(k=>k.id===initial.id?kit:k) : [...kits, kit];
      setKits(updatedKits);

      // Create/replace associated reservations (one per session)
      const baseRes = (reservations||[]).filter(r=>r.lesson_kit_id!==kitId);
      const newRes = finalSchedule.map((s,i)=>({
        id: `${kitId}_s${i}`,
        lesson_kit_id: kitId,
        status: "מאושר",
        loan_type: "שיעור",
        student_name: instructorName.trim()||name.trim(),
        email: instructorEmail.trim(),
        phone: instructorPhone.trim(),
        course: name.trim(),
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
        showToast("success", `ערכת שיעור "${name.trim()}" נשמרה · ${finalSchedule.length} שיעורים שוריינו`);
        onDone();
      } else showToast("error","❌ שגיאה בשמירה");
    };

    return (
      <div className="card" style={{marginBottom:20}}>
        <div className="card-header">
          <div className="card-title">🎬 {initial?"עריכת ערכת שיעור":"ערכת שיעור חדשה"}</div>
          <button className="btn btn-secondary btn-sm" onClick={onDone}>✕ ביטול</button>
        </div>

        {/* Instructor details */}
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
                    {schedule.length>0 ? "➕ הוסף עוד שיעורים (יתווספו לקיימים)" : "📅 פרוס שיעורים"}
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
                  <div className="form-group" style={{display:"flex",alignItems:"end"}}>
                    <button type="button" className="btn btn-primary" onClick={buildAndAppendSchedule} disabled={!manStartDate}>➕ צור / הוסף שיעורים</button>
                  </div>
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
              במצב עריכה ניתן לעדכן תאריכים ושעות של שיעורים קיימים, וגם להוסיף או להסיר שיעורים בודדים לפי טווחי השעות הקיימים. האפשרות להוסיף פריסת שיעורים חדשה לגמרי עדיין מוסרת כדי למנוע חוסר סנכרון מול מערכת ההשאלות הכללית והיומן.
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
                      {isEditMode && (
                        <button
                          type="button"
                          onClick={()=>appendLessonFromExisting(i)}
                          className="btn btn-secondary btn-sm"
                          style={{padding:"4px 10px"}}
                        >
                          ➕ שכפל שיעור
                        </button>
                      )}
                      <button type="button" onClick={()=>setSchedule(prev=>prev.filter((_,j)=>j!==i))}
                        style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:15,padding:"0 2px",flexShrink:0}}>×</button>
                    </div>
                  </div>
                ))}
              </div>
              {isEditMode && schedule.length>0 && (
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
                  <button type="button" className="btn btn-secondary" onClick={()=>appendLessonFromExisting()}>
                    ➕ הוסף שיעור חדש לפי הטווח הקיים
                  </button>
                  <span style={{fontSize:12,color:"var(--text3)",alignSelf:"center"}}>
                    השיעור החדש יתווסף שבוע אחרי השיעור האחרון ויקבל את אותן שעות.
                  </span>
                </div>
              )}
            </div>
          )}
          {!schedule.length&&scheduleMode==="manual"&&!manStartDate&&(
            <div style={{textAlign:"center",color:"var(--text3)",fontSize:12,padding:"8px 0"}}>בחר תאריך וזמנים למעלה — השיעורים ייווצרו אוטומטית בלחיצה על הכפתור</div>
          )}
        </div>

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
              disabled={teacherEmailSending || !String(instructorEmail||"").trim()}
            >
              {teacherEmailSending ? "⏳ שולח למורה..." : "📤 שליחת ערכה למורה"}
            </button>
            <span style={{fontSize:12,color:"var(--text3)"}}>
              {String(instructorEmail||"").trim() ? `המייל יישלח אל ${instructorEmail.trim()}` : "יש להזין קודם כתובת מייל למורה"}
            </span>
          </div>
        </div>

        {/* Single CTA */}
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",paddingTop:4}}>
          <button className="btn btn-primary"
            disabled={saving || !name.trim() || (scheduleMode==="xl" && schedule.length===0)}
            onClick={save}
            style={{fontSize:15,padding:"12px 28px"}}>
            {saving ? "⏳ שומר ומשריין..." : initial ? "💾 שמור שינויים" : "🎬 צור ערכת שיעור"}
          </button>
          {scheduleMode==="manual" && manStartDate && schedule.length===0 && (
            <span style={{fontSize:12,color:"var(--text3)"}}>
              יפרוס {manCount} שיעורים ב-{formatDate(manStartDate)}
            </span>
          )}
          {schedule.length>0 && (
            <span style={{fontSize:12,color:"#9b59b6",fontWeight:700}}>📅 {schedule.length} שיעורים בלוח</span>
          )}
        </div>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="page">
      {/* Tab header */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20,flexWrap:"wrap"}}>
        {[{k:"student",l:"🎒 ערכות לסטודנטים"},{k:"lesson",l:"🎬 ערכות שיעור"}].map(({k,l})=>(
          <button key={k} type="button" onClick={()=>setTabView(k)}
            style={{padding:"8px 20px",borderRadius:"var(--r-sm)",border:`2px solid ${tabView===k?"var(--accent)":"var(--border)"}`,background:tabView===k?"var(--accent-glow)":"transparent",color:tabView===k?"var(--accent)":"var(--text2)",fontWeight:700,fontSize:14,cursor:"pointer"}}>
            {l}
            <span style={{marginRight:6,background:tabView===k?"var(--accent)":"var(--surface3)",color:tabView===k?"#000":"var(--text3)",borderRadius:20,padding:"1px 7px",fontSize:11,fontWeight:900}}>
              {k==="student"?studentKits.length:lessonKits.length}
            </span>
          </button>
        ))}
        <div style={{marginRight:"auto",display:"flex",gap:8}}>
          {mode===null&&tabView==="student"&&<button className="btn btn-primary" onClick={()=>{setMode("student");setEditTarget(null);}}>➕ ערכה לסטודנט</button>}
          {mode===null&&tabView==="lesson"&&<button className="btn btn-primary" style={{background:"#9b59b6",borderColor:"#9b59b6"}} onClick={()=>{setMode("lesson");setEditTarget(null);}}>🎬 ערכת שיעור חדשה</button>}
        </div>
      </div>

      {/* Forms */}
      {(mode==="student"||mode==="editStudent")&&(
        <StudentKitForm initial={mode==="editStudent"?editTarget:null} onDone={()=>{setMode(null);setEditTarget(null);}}/>
      )}
      {(mode==="lesson"||mode==="editLesson")&&(
        <LessonKitForm initial={mode==="editLesson"?editTarget:null} onDone={()=>{setMode(null);setEditTarget(null);}}/>
      )}

      {/* Student kits list */}
      {tabView==="student"&&mode===null&&(
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
      {tabView==="lesson"&&mode===null&&(
        lessonKits.length===0
          ? <div className="empty-state"><div className="emoji">🎬</div><p>אין ערכות שיעור</p><p style={{fontSize:13,color:"var(--text3)"}}>ערכות שיעור משריינות ציוד לפי לוח שיעורים קבוע</p></div>
          : <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {lessonKits.map(kit=>{
              const nextSession = (kit.schedule||[]).find(s=>s.date>=today());
              return (
                <div key={kit.id} style={{background:"var(--surface)",border:"1px solid rgba(155,89,182,0.3)",borderRadius:"var(--r)",padding:"16px 18px"}}>
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                    <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
                      <span style={{fontSize:28}}>🎬</span>
                      <div>
                        <div style={{fontWeight:800,fontSize:15}}>{kit.name}</div>
                      {kit.instructorName&&<div style={{fontSize:12,color:"var(--text2)",marginTop:2}}>👨‍🏫 {kit.instructorName}{kit.instructorPhone?` · 📞 ${kit.instructorPhone}`:""}</div>}
                        {kit.instructorEmail&&<div style={{fontSize:11,color:"var(--text3)"}}>✉️ {kit.instructorEmail}</div>}
                        <div style={{marginTop:6,display:"flex",gap:6,flexWrap:"wrap"}}>
                          <span style={{background:"rgba(155,89,182,0.15)",border:"1px solid rgba(155,89,182,0.35)",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#9b59b6",fontWeight:700}}>
                            📅 {(kit.schedule||[]).length} שיעורים
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
      if(!_kitRes.ok) showToast("error", "❌ שגיאה בשמירה ל-Google Sheets — נסה שוב");
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

// ─── CERTIFICATIONS PAGE ──────────────────────────────────────────────────────
function CertificationsPage({ certifications, setCertifications, showToast }) {
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
function DeptHeadCalendarPage({ reservations: initialReservations, kits=[] }) {
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
  const LOAN_ICONS     = { "פרטית":"👤","הפקה":"🎬","סאונד":"🎙️" };

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
    <div style={{maxWidth:1100,margin:"0 auto",padding:"24px 16px",direction:"rtl"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24,flexWrap:"wrap"}}>
        <div style={{fontSize:32}}>🎬</div>
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
        {["הכל","פרטית","הפקה","סאונד"].map(lt=>{
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
                <span className={`badge badge-${r.status==="מאושר"?"green":r.status==="ממתין"?"yellow":r.status==="נדחה"?"red":"purple"}`} style={{marginRight:"auto"}}>
                  {r.status}
                </span>
              </div>
              {selected===r&&(
                <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid var(--border)",display:"flex",flexDirection:"column",gap:6}}>
                  {r.email&&<div style={{fontSize:12,color:"var(--text3)"}}>📧 {r.email}</div>}
                  {r.phone&&<div style={{fontSize:12,color:"var(--text3)"}}>📞 {r.phone}</div>}
                  {r.course&&<div style={{fontSize:12,color:"var(--text3)"}}>📚 {r.course}</div>}
                  {r.project_name&&<div style={{fontSize:12,color:"var(--text3)"}}>📽️ {r.project_name}</div>}
                  {r.crew_photographer_name&&<div style={{fontSize:12,color:"var(--text3)"}}>🎥 צלם: {r.crew_photographer_name}</div>}
                  {r.crew_sound_name&&<div style={{fontSize:12,color:"var(--text3)"}}>🎙️ סאונד: {r.crew_sound_name}</div>}
                  {r.items?.length>0&&(
                    <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
                      🎒 {r.items.map(i=>`${i.name} ×${i.quantity}`).join(" · ")}
                    </div>
                  )}
                  {(r.status==="אישור ראש מחלקה"||r.status==="ממתין לאישור ראש המחלקה")&&(
                    <div style={{marginTop:8}}>
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
      {/* ── ערכות שיעור ── */}
      {(()=>{
        const lessonKits = kits.filter(k=>k.kitType==="lesson");
        if(!lessonKits.length) return null;
        const todayStr2 = today();
        const upcoming = lessonKits.flatMap(kit=>
          (kit.schedule||[])
            .filter(s=>s.date>=todayStr2)
            .map(s=>({...s, kitName:kit.name, instructorName:kit.instructorName||"", items:kit.items||[]}))
        ).sort((a,b)=>a.date<b.date?-1:a.startTime<b.startTime?-1:1).slice(0,8);
        if(!upcoming.length) return null;
        return (
          <div style={{marginTop:24}}>
            <div style={{fontWeight:800,fontSize:15,marginBottom:10}}>🎬 ערכות שיעור — שיעורים קרובים</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {upcoming.map((s,i)=>(
                <div key={i} style={{background:"var(--surface)",border:"1px solid rgba(155,89,182,0.3)",borderRadius:"var(--r)",padding:"12px 16px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <span style={{fontSize:20}}>🎬</span>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:800,fontSize:14}}>{s.kitName}</div>
                      {s.instructorName&&<div style={{fontSize:12,color:"var(--text3)"}}>👨‍🏫 {s.instructorName}</div>}
                    </div>
                    <div style={{textAlign:"left",fontSize:12,color:"var(--text3)"}}>
                      📅 {formatDate(s.date)}&nbsp;&nbsp;🕐 {s.startTime} – {s.endTime}
                    </div>
                  </div>
                  {s.items.length>0&&(
                    <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:8}}>
                      {s.items.map((item,j)=>(
                        <span key={j} style={{background:"rgba(155,89,182,0.1)",border:"1px solid rgba(155,89,182,0.3)",borderRadius:6,padding:"2px 8px",fontSize:11,color:"#9b59b6"}}>
                          {item.name} ×{item.quantity}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── MANAGER CALENDAR PAGE ───────────────────────────────────────────────────
function ManagerCalendarPage({ reservations: initialReservations, setReservations, collegeManager, equipment=[], kits=[] }) {
  const [localRes, setLocalRes]   = useState(initialReservations);
  const [calDate, setCalDate]     = useState(new Date());
  const [statusF, setStatusF]     = useState([]);
  const [loanTypeF, setLoanTypeF] = useState("הכל");
  const [selected, setSelected]   = useState(null);
  const [changingStatus, setChangingStatus] = useState(null);

  const ALL_STATUSES  = ["ממתין","אישור ראש מחלקה","מאושר","נדחה"];
  const STATUS_COLORS = { "מאושר":"var(--green)","ממתין":"var(--yellow)","נדחה":"var(--red)","אישור ראש מחלקה":"#9b59b6" };
  const STATUS_BADGE  = { "מאושר":"green","ממתין":"yellow","נדחה":"red","אישור ראש מחלקה":"purple" };
  const LOAN_ICONS    = { "פרטית":"👤","הפקה":"🎬","סאונד":"🎙️" };
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
      const allRes = await storageGet("reservations");
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
    <div style={{maxWidth:1100,margin:"0 auto",padding:"24px 16px",direction:"rtl"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24,flexWrap:"wrap"}}>
        <div style={{fontSize:32}}>🏫</div>
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
        {["הכל","פרטית","הפקה","סאונד"].map(lt=>{
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
        const upcoming = lessonKits.flatMap(kit=>
          (kit.schedule||[])
            .filter(s=>s.date>=todayStr2)
            .map(s=>({...s, kitName:kit.name, instructorName:kit.instructorName||"", instructorPhone:kit.instructorPhone||"", items:kit.items||[]}))
        ).sort((a,b)=>a.date<b.date?-1:a.startTime<b.startTime?-1:1).slice(0,10);
        if(!upcoming.length) return null;
        return (
          <div style={{marginTop:28}}>
            <div style={{fontWeight:800,fontSize:15,marginBottom:10}}>🎬 ערכות שיעור — שיעורים קרובים</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {upcoming.map((s,i)=>(
                <div key={i} style={{background:"var(--surface)",border:"1px solid rgba(155,89,182,0.3)",borderRadius:"var(--r)",padding:"14px 18px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                    <span style={{fontSize:22}}>🎬</span>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:800,fontSize:15}}>{s.kitName}</div>
                      {s.instructorName&&<div style={{fontSize:12,color:"var(--text2)"}}>👨‍🏫 {s.instructorName}{s.instructorPhone?` · 📞 ${s.instructorPhone}`:""}</div>}
                    </div>
                    <div style={{textAlign:"left",fontSize:13,color:"var(--text3)",fontWeight:700}}>
                      📅 {formatDate(s.date)}&nbsp;&nbsp;🕐 {s.startTime} – {s.endTime}
                    </div>
                  </div>
                  {s.items.length>0&&(
                    <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:10}}>
                      {s.items.map((item,j)=>(
                        <span key={j} style={{background:"rgba(155,89,182,0.1)",border:"1px solid rgba(155,89,182,0.3)",borderRadius:6,padding:"3px 10px",fontSize:12,color:"#9b59b6",fontWeight:700}}>
                          {item.name} ×{item.quantity}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}
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
    setEquipment(updatedEquipment);
    const r = await storageSet("equipment", updatedEquipment);
    setSaving(false);
    if(r.ok) { showToast("success", "היחידות עודכנו"); onClose(); }
    else showToast("error","❌ שגיאה בשמירה");
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
    setEquipment(updatedEquipment);
    const r = await storageSet("equipment", updatedEquipment);
    setSaving(false);
    if(r.ok) {
      if(editForm.status==="תקין") showToast("success", `✅ ${eq.name} #${unit.id.split("_")[1]} חזר לציוד פעיל`);
      else showToast("success","הסטטוס עודכן");
      setEditUnit(null);
    } else showToast("error","❌ שגיאה בשמירה");
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
  const urlToken = new URLSearchParams(window.location.search).get("token")||"";
  const [page, setPage]               = useState("dashboard");
  const [equipment, setEquipment]     = useState([]);
  const [reservations, setReservations] = useState([]);
  const [categories, setCategories]   = useState(DEFAULT_CATEGORIES);
  const [teamMembers, setTeamMembers] = useState([]);
  const [deptHeads, setDeptHeads]       = useState([]);
  const [collegeManager, setCollegeManager] = useState({ name:"", email:"" });
  const [calendarToken, setCalendarToken] = useState("");
  const [managerToken, setManagerToken]   = useState("");
  const [kits, setKits]               = useState([]);
  const [policies, setPolicies]       = useState({ פרטית:"", הפקה:"", סאונד:"" });
  const [certifications, setCertifications] = useState({ types:[], students:[] });
  const [loading, setLoading]         = useState(true);
  const [toasts, setToasts]           = useState([]);
  const [authed, setAuthed]           = useState(false);
  // Reservations filter state (in AdminApp so topbar can render them)
  const [resSearch, setResSearch]       = useState("");
  const [resStatusF, setResStatusF]     = useState("הכל");
  const [resLoanTypeF, setResLoanTypeF] = useState("הכל");
  const [resSortBy, setResSortBy]       = useState("received");

  const showToast = (type, msg) => {
    const id = Date.now();
    setToasts(p=>[...p,{id,type,msg}]);
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)), 3500);
  };

  useEffect(()=>{
    (async()=>{
        try {
          const [eq, res, cats, tm, kts, pol, certs, dhs, calTok, mgr, mgrTok] = await Promise.all([
            storageGet("equipment"),
          storageGet("reservations"),
          storageGet("categories"),
          storageGet("teamMembers"),
          storageGet("kits"),
          storageGet("policies"),
          storageGet("certifications"),
          storageGet("deptHeads"),
          storageGet("calendarToken"),
          storageGet("collegeManager"),
          storageGet("managerToken"),
          ]);
          const rawEquipment = normalizeEquipmentTagFlags(eq || INITIAL_EQUIPMENT);
          const normalizedEquipment = rawEquipment.map(ensureUnits);
          const equipmentChanged = JSON.stringify(normalizedEquipment) !== JSON.stringify(eq || INITIAL_EQUIPMENT);
          const normalizedReservations = normalizeReservationsForArchive(res || []);
          const reservationsChanged = JSON.stringify(normalizedReservations) !== JSON.stringify(res || []);
          setEquipment(normalizedEquipment);
          setReservations(normalizedReservations);
          setCategories(cats || DEFAULT_CATEGORIES);
        setTeamMembers(tm || []);
        setKits(kts || []);
        setPolicies(pol || { פרטית:"", הפקה:"", סאונד:"" });
        setCertifications(certs || { types:[], students:[] });
        setDeptHeads(Array.isArray(dhs) ? dhs : []);
        setCalendarToken(calTok || "");
        setCollegeManager(mgr || { name:"", email:"" });
        setManagerToken(mgrTok || "");
        // Init missing
          if(!eq || equipmentChanged) await storageSet("equipment", normalizedEquipment);
        if(!res)  await storageSet("reservations", []);
        if(!cats) await storageSet("categories",   DEFAULT_CATEGORIES);
        if(!tm)   await storageSet("teamMembers",  []);
        if(!kts)  await storageSet("kits",         []);
        if(!pol)   await storageSet("policies",        { פרטית:"", הפקה:"", סאונד:"" });
        if(!certs) await storageSet("certifications", { types:[], students:[] });
        if(!dhs)     await storageSet("deptHeads",       []);
        if(!calTok) {
          const tok = Math.random().toString(36).slice(2,10)+Math.random().toString(36).slice(2,10);
          await storageSet("calendarToken", tok);
          setCalendarToken(tok);
        }
        if(!mgrTok) {
          const tok = "mgr_"+Math.random().toString(36).slice(2,10)+Math.random().toString(36).slice(2,10);
          await storageSet("managerToken", tok);
          setManagerToken(tok);
        }
        if(!mgr) await storageSet("collegeManager", { name:"", email:"" });
        if(res && reservationsChanged) await storageSet("reservations", normalizedReservations);
        // Only warn if BOTH Sheets and cache failed (truly no data)
        if(eq===null && !lsGet("equipment")) showToast("error", "⚠️ לא ניתן לטעון ציוד — בדוק חיבור");
      } catch(e) {
        showToast("error", "❌ שגיאת רשת — לא ניתן לטעון נתונים");
        console.error("load error", e);
      }
      setLoading(false);
    })();
  },[]);

  useEffect(() => {
    if (loading) return undefined;
    const syncArchivedReservations = () => {
      setReservations((currentReservations) => {
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

  const pending = reservations.filter(r=>r.status==="ממתין").length;
  const damagedCount = equipment.reduce((sum, eq) =>
    sum + (Array.isArray(eq.units) ? eq.units.filter(u=>u.status!=="תקין").length : 0), 0);
  const deptHeadPending = reservations.filter(r=>r.status==="אישור ראש מחלקה").length;
  const rejected = reservations.filter(r=>r.status==="נדחה").length;
  const pageTitle = { dashboard:"לוח בקרה", equipment:"ציוד פעיל", damaged:"ציוד בדיקה", reservations:"ניהול בקשות", rejected:"בקשות דחויות", archive:"ארכיון בקשות", team:"פרטי צוות", kits:"ערכות", policies:"נהלים", certifications:"הסמכות" };

  return (
    <>
      <style>{css}</style>

      {/* ── טופס ציבורי ── */}
      {isManagerCalendarView ? (
        <div style={{minHeight:"100vh",background:"var(--bg)",direction:"rtl"}}>
          {loading ? <Loading/> : (
            managerToken && urlToken === managerToken
              ? <ManagerCalendarPage reservations={reservations} setReservations={setReservations} collegeManager={collegeManager} equipment={equipment} kits={kits}/>
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
              ? <DeptHeadCalendarPage reservations={reservations} calendarToken={calendarToken} kits={kits}/>
              : <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",flexDirection:"column",gap:16,color:"var(--text2)"}}>
                  <div style={{fontSize:48}}>🔒</div>
                  <div style={{fontSize:18,fontWeight:700}}>קישור לא תקין</div>
                  <div style={{fontSize:13}}>הקישור שבידך אינו תקין או פג תוקפו</div>
                </div>
          )}
        </div>
      ) : !isAdmin && (
        <div className="public-page-shell">
          {loading ? <Loading/> : <PublicForm equipment={equipment} reservations={reservations} setReservations={setReservations} showToast={showToast} categories={categories} kits={kits} teamMembers={teamMembers} policies={policies} certifications={certifications} deptHeads={deptHeads} calendarToken={calendarToken}/>}
        </div>
      )}

      {/* ── לוח ניהול עם סיסמה ── */}
      {isAdmin && !authed && <AdminLogin onSuccess={()=>setAuthed(true)}/>}

      {isAdmin && authed && (
        <div className="app">
          <nav className="sidebar">
            <div className="sidebar-logo">
              <span className="logo-icon">🎬</span>
              <div className="app-name">מחסן השאלת ציוד<br/>קמרה אובסקורה וסאונד</div>
              <div className="app-sub">💾 נתונים נשמרים תמיד</div>
            </div>
            <div className="nav">
              <div className="nav-section">ניהול</div>
              {[
                {id:"reservations",icon:"📋",label:"בקשות",badge:pending||null},
                {id:"equipment",icon:"📦",label:"ציוד פעיל"},
                {id:"damaged",icon:"🔧",label:"ציוד בדיקה",badge:damagedCount||null},
                {id:"certifications",icon:"🎓",label:"הסמכות"},
                {id:"rejected",icon:"❌",label:"דחויות",badge:rejected||null},
                {id:"kits",icon:"🎒",label:"ערכות"},
                {id:"team",icon:"👥",label:"צוות"},
                {id:"archive",icon:"🗄️",label:"ארכיון"},
                {id:"policies",icon:"📋",label:"נהלים"},
              ].map(n=>(
                <div key={n.id} className={`nav-item ${page===n.id?"active":""}`}
                  onClick={()=>setPage(p=>p===n.id?"dashboard":n.id)} title={n.label}>
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
          <div className="main">
            <div className="topbar" style={{flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8,width:"100%"}}>
                <span className="topbar-title" style={{flex:1}}>{pageTitle[page]}</span>
                {pending>0&&<div style={{background:"rgba(241,196,15,0.12)",border:"1px solid rgba(241,196,15,0.3)",borderRadius:8,padding:"5px 10px",fontSize:12,color:"var(--yellow)",flexShrink:0}}>⏳ {pending}</div>}
                {deptHeadPending>0&&<div style={{background:"rgba(155,89,182,0.12)",border:"1px solid rgba(155,89,182,0.3)",borderRadius:8,padding:"5px 10px",fontSize:12,color:"var(--purple)",flexShrink:0}}>🟣 {deptHeadPending}</div>}
                {rejected>0&&<div style={{background:"rgba(231,76,60,0.12)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:8,padding:"5px 10px",fontSize:12,color:"var(--red)",flexShrink:0}}>❌ {rejected}</div>}
              </div>
              {(page==="reservations" || page==="rejected") && (
                <div style={{display:"flex",gap:6,width:"100%",flexWrap:"wrap",alignItems:"center"}}>
                  <div className="search-bar" style={{flex:"1 1 130px",minWidth:120}}><span>🔍</span><input placeholder="חיפוש..." value={resSearch} onChange={e=>setResSearch(e.target.value)}/></div>
                  {page==="reservations" && (
                    <select className="form-select" style={{flex:"1 1 100px",minWidth:95,fontSize:12,padding:"6px 8px"}} value={resStatusF==="נדחה" ? "הכל" : resStatusF} onChange={e=>setResStatusF(e.target.value)}>
                      <option value="הכל">כל הסטטוסים</option>
                      {["ממתין","אישור ראש מחלקה","מאושר"].map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                  <select className="form-select" style={{flex:"1 1 90px",minWidth:85,fontSize:12,padding:"6px 8px"}} value={resLoanTypeF} onChange={e=>setResLoanTypeF(e.target.value)}>
                    <option value="הכל">כל הסוגים</option>
                    {["פרטית","הפקה","סאונד","שיעור"].map(t=><option key={t} value={t}>{t==="שיעור"?"השאלת שיעור":t}</option>)}
                  </select>
                  <select className="form-select" style={{flex:"1 1 110px",minWidth:100,fontSize:12,padding:"6px 8px"}} value={resSortBy} onChange={e=>setResSortBy(e.target.value)}>
                    <option value="received">🕐 קבלה</option>
                    <option value="urgency">🔥 דחיפות</option>
                  </select>
                </div>
              )}
            </div>
            {loading ? <Loading/> : <>
              {page==="dashboard"   && <DashboardPage    equipment={equipment} reservations={reservations}/>}
              {page==="equipment"   && <EquipmentPage    equipment={equipment} reservations={reservations} setEquipment={setEquipment} showToast={showToast} categories={categories} setCategories={setCategories} certifications={certifications}/>}
              {page==="reservations"&& <ReservationsPage reservations={reservations} setReservations={setReservations} equipment={equipment} showToast={showToast}
                search={resSearch} setSearch={setResSearch} statusF={resStatusF} setStatusF={setResStatusF}
                loanTypeF={resLoanTypeF} setLoanTypeF={setResLoanTypeF} sortBy={resSortBy} setSortBy={setResSortBy} collegeManager={collegeManager} managerToken={managerToken}/>}
              {page==="rejected"    && <ReservationsPage reservations={reservations} setReservations={setReservations} equipment={equipment} showToast={showToast}
                search={resSearch} setSearch={setResSearch} statusF={resStatusF} setStatusF={setResStatusF}
                loanTypeF={resLoanTypeF} setLoanTypeF={setResLoanTypeF} sortBy={resSortBy} setSortBy={setResSortBy} mode="rejected" collegeManager={collegeManager} managerToken={managerToken}/>}
              {page==="archive"     && <ArchivePage      reservations={reservations} setReservations={setReservations} equipment={equipment} showToast={showToast}/>}
              {page==="team"        && <TeamPage         teamMembers={teamMembers} setTeamMembers={setTeamMembers} deptHeads={deptHeads} setDeptHeads={setDeptHeads} calendarToken={calendarToken} collegeManager={collegeManager} setCollegeManager={setCollegeManager} showToast={showToast} managerToken={managerToken}/>}
              {page==="kits"        && <KitsPage         kits={kits} setKits={setKits} equipment={equipment} categories={categories} showToast={showToast} reservations={reservations} setReservations={setReservations}/>}
              {page==="policies"    && <PoliciesPage     policies={policies} setPolicies={setPolicies} showToast={showToast}/>}
              {page==="certifications" && <CertificationsPage certifications={certifications} setCertifications={setCertifications} showToast={showToast}/>}
              {page==="damaged"       && <DamagedEquipmentPage equipment={equipment} setEquipment={setEquipment} showToast={showToast} categories={categories} collegeManager={collegeManager} managerToken={managerToken}/>}
            </>}
          </div>
        </div>
      )}

      <Toast toasts={toasts}/>
    </>
  );
}
