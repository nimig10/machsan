import { useState, useEffect, useMemo } from "react";

// ─── GOOGLE SHEETS STORAGE (דרך Vercel) ──────────────────────────────────────
async function storageGet(key) {
  try {
    const actionMap = { reservations:"getReservations", equipment:"getEquipment", categories:"getCategories" };
    const res = await fetch(`/api/sheets?action=${actionMap[key]||"getEquipment"}`);
    const json = await res.json();
    return json.ok ? json.data : null;
  } catch { return null; }
}

async function storageSet(key, value) {
  try {
    const actionMap = { reservations:"saveReservations", equipment:"saveEquipment", categories:"saveCategories" };
    await fetch("/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: actionMap[key]||"saveEquipment", payload: value }),
    });
  } catch {}
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
const SOUND_CATEGORIES = ["מיקרופונים","מקליטי אודיו"];
const STATUSES    = ["תקין","פגום","בתיקון","נעלם"];
const RESEND_API_KEY = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_RESEND_KEY : "";
const NIMROD_PHONE     = "972521234567"; // ← החלף במספר של נמרוד
const TERMS = `הסטודנט מתחייב להחזיר את הציוד במועד שנקבע ובמצב תקין.
אחריות על נזק לציוד תחול על הסטודנט.
במקרה של אובדן, יחויב הסטודנט בעלות החלפת הציוד.
יש להשתמש בציוד לצרכי לימוד בלבד.`;

// ─── UTILS ────────────────────────────────────────────────────────────────────
function formatDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("he-IL", { day:"2-digit", month:"2-digit", year:"numeric" });
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function dateToLocal(d) {
  if(!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function getAvailable(eqId, borrowDate, returnDate, reservations, equipment, excludeId=null) {
  const eq = equipment.find(e => e.id == eqId);
  if (!eq) return 0;
  const b = new Date(borrowDate), r = new Date(returnDate);
  let used = 0;
  for (const res of reservations) {
    if (res.id === excludeId) continue;
    if (res.status !== "מאושר") continue;  // רק מאושרות תופסות מלאי
    const rb = new Date(res.borrow_date), rr = new Date(res.return_date);
    if (b <= rr && r >= rb) {
      const item = res.items?.find(i => i.equipment_id == eqId);
      if (item) used += item.quantity;
    }
  }
  return Math.max(0, eq.total_quantity - used);
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
  .nav-section { padding:8px 16px 4px; font-size:10px; font-weight:700; color:var(--text3); text-transform:uppercase; letter-spacing:1px; }
  .nav-item { display:flex; align-items:center; gap:10px; padding:10px 20px; cursor:pointer; font-size:14px; font-weight:500; color:var(--text2); transition:all 0.15s; border-right:3px solid transparent; margin:1px 0; }
  .nav-item:hover { background:var(--surface2); color:var(--text); }
  .nav-item.active { background:var(--accent-glow); color:var(--accent); border-right-color:var(--accent); }
  .nav-item .icon { font-size:16px; width:20px; text-align:center; }
  .main { margin-right:240px; flex:1; min-height:100vh; }
  .topbar { position:sticky; top:0; z-index:50; background:rgba(10,12,16,0.92); backdrop-filter:blur(12px); border-bottom:1px solid var(--border); padding:0 28px; height:60px; display:flex; align-items:center; justify-content:space-between; }
  .topbar-title { font-size:18px; font-weight:700; }
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
  .badge-blue { background:rgba(52,152,219,0.15); color:var(--blue); border:1px solid rgba(52,152,219,0.25); }
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
    .sidebar { position:fixed; bottom:0; top:auto; right:0; left:0; width:100%; flex-direction:row; height:64px; border-left:none; border-top:1px solid var(--border); z-index:200; }
    .sidebar-logo { display:none; }
    .nav { display:flex; flex-direction:row; padding:0; flex:1; overflow:visible; }
    .nav-section { display:none; }
    .nav-item { flex:1; flex-direction:column; gap:3px; padding:8px 4px; font-size:10px; border-right:none; border-top:3px solid transparent; justify-content:center; text-align:center; margin:0; }
    .nav-item.active { border-right-color:transparent; border-top-color:var(--accent); background:var(--accent-glow); }
    .nav-item .icon { font-size:20px; width:auto; }
    .sidebar > div:last-child { display:none; }
    .main { margin-right:0; padding-bottom:72px; }
    .topbar { padding:0 16px; }
    .page { padding:16px; }
    .stats-grid { grid-template-columns:1fr 1fr; gap:12px; }
    .stat-value { font-size:24px; }
    .grid-2 { grid-template-columns:1fr; }
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
function statusBadge(s) {
  const m = { "מאושר":"badge-green","ממתין":"badge-yellow","נדחה":"badge-red","הוחזר":"badge-blue","תקין":"badge-green","פגום":"badge-red","בתיקון":"badge-yellow","נעלם":"badge-red" };
  return <span className={`badge ${m[s]||"badge-gray"}`}>{s}</span>;
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
function EquipmentPage({ equipment, reservations, setEquipment, showToast, categories=DEFAULT_CATEGORIES, setCategories }) {
  const [search, setSearch] = useState("");
  const [selectedCats, setSelectedCats] = useState([]);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);

  const filtered = equipment.filter(e => (selectedCats.length===0||selectedCats.includes(e.category)) && e.name.includes(search));

  const save = async (form) => {
    setSaving(true);
    let updated;
    if (modal.type==="add") {
      const item = { ...form, id: Date.now() };
      updated = [...equipment, item];
      showToast("success", `"${form.name}" נוסף בהצלחה`);
    } else {
      updated = equipment.map(e => e.id===modal.item.id ? {...e,...form} : e);
      showToast("success", "הציוד עודכן בהצלחה");
    }
    setEquipment(updated);
    await storageSet("equipment", updated);
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

  const todayStr2 = today();
  const used = (id) => reservations
    .filter(r=>(r.status==="מאושר"||r.status==="ממתין") && r.borrow_date<=todayStr2 && r.return_date>=todayStr2)
    .reduce((s,r)=>s+(r.items?.find(i=>i.equipment_id==id)?.quantity||0),0);

  const EqForm = ({ initial }) => {
    const [f, setF] = useState(initial||{name:"",category:"מצלמות",description:"",total_quantity:1,image:"📷",notes:"",status:"תקין"});
    const s = (k,v) => setF(p=>({...p,[k]:v}));

    const handleImageUpload = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => s("image", reader.result);
      reader.readAsDataURL(file);
    };

    const isUrl = f.image?.startsWith("data:") || f.image?.startsWith("http");

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
              {isUrl
                ? <img src={f.image} alt="" style={{width:48,height:48,objectFit:"cover",borderRadius:8,border:"1px solid var(--border)"}}/>
                : <span style={{fontSize:36}}>{f.image}</span>
              }
              <div style={{flex:1}}>
                <input className="form-input" value={isUrl?"":f.image} placeholder="אימוג׳י (למשל 📷)" onChange={e=>s("image",e.target.value)} style={{marginBottom:6}}/>
                <label style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",background:"var(--surface3)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",cursor:"pointer",fontSize:12,color:"var(--text2)"}}>
                  🖼️ העלה תמונה מהמחשב
                  <input type="file" accept="image/*" style={{display:"none"}} onChange={handleImageUpload}/>
                </label>
              </div>
            </div>
          </div>
        </div>
        <div className="grid-2">
          <div className="form-group"><label className="form-label">מצב</label><select className="form-select" value={f.status} onChange={e=>s("status",e.target.value)}>{STATUSES.map(st=><option key={st}>{st}</option>)}</select></div>
          <div className="form-group"><label className="form-label">הערות</label><input className="form-input" value={f.notes} onChange={e=>s("notes",e.target.value)}/></div>
        </div>
        <div className="flex gap-2" style={{paddingTop:8}}>
          <button className="btn btn-primary" disabled={!f.name||saving} onClick={()=>save(f)}>{saving?"⏳ שומר...":initial?"💾 שמור":"➕ הוסף"}</button>
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
      <div className="flex gap-2 mb-6" style={{flexWrap:"wrap",alignItems:"center"}}>
        {categories.map(c=>{
          const active = selectedCats.includes(c);
          return <button key={c} className={`btn btn-sm ${active?"btn-primary":"btn-secondary"}`}
            onClick={()=>setSelectedCats(prev=>active?prev.filter(x=>x!==c):[...prev,c])}>{c}</button>;
        })}
      </div>
      {filtered.length===0 ? <div className="empty-state"><div className="emoji">📦</div><p>לא נמצא ציוד</p></div> : (
        <>
          {(selectedCats.length>0?selectedCats:categories).filter(c=>filtered.some(e=>e.category===c)).map(c=>(
            <div key={c} style={{marginBottom:32}}>
              <div style={{fontSize:13,fontWeight:800,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,marginBottom:12,paddingBottom:8,borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:8}}>
                <span>{c}</span>
                <span style={{fontSize:11,color:"var(--text3)",fontWeight:400}}>({filtered.filter(e=>e.category===c).length} פריטים)</span>
              </div>
              <div className="eq-grid">
                {filtered.filter(e=>e.category===c).map(eq=>(
                  <div key={eq.id} className="eq-card">
                    <div style={{marginBottom:10,display:"flex",justifyContent:"center"}}>
                      {eq.image?.startsWith("data:")||eq.image?.startsWith("http")
                        ? <img src={eq.image} alt={eq.name} style={{width:72,height:72,objectFit:"cover",borderRadius:10,border:"1px solid var(--border)"}}/>
                        : <span style={{fontSize:36}}>{eq.image||"📦"}</span>
                      }
                    </div>
                    <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>{eq.name}</div>
                    <div style={{fontSize:11,color:"var(--text3)",marginBottom:8}}>{eq.category}</div>
                    <div style={{fontSize:13}}><strong style={{color:"var(--accent)",fontSize:20}}>{eq.total_quantity-used(eq.id)}</strong><span style={{color:"var(--text3)"}}> / {eq.total_quantity} זמין</span></div>
                    {eq.notes && <div className="chip" style={{marginTop:6}}>💬 {eq.notes}</div>}
                    <div style={{marginTop:8}}>{statusBadge(eq.status)}</div>
                    <div className="flex gap-2" style={{marginTop:12}}>
                      <button className="btn btn-secondary btn-sm" onClick={()=>setModal({type:"edit",item:eq})}>✏️ עריכה</button>
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
function EditReservationModal({ reservation, equipment, reservations, onSave, onClose }) {
  const TIME_SLOTS = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30"];
  const [form, setForm]   = useState({...reservation});
  const [items, setItems] = useState(reservation.items ? [...reservation.items] : []);
  const [saving, setSaving] = useState(false);
  const set = (k,v) => setForm(p=>({...p,[k]:v}));

  // Available quantity for equipment (excluding current reservation)
  // getAvail returns how many are free (excluding OTHER reservations, not this one)
  const getAvail = (eqId) => {
    const eq = equipment.find(e=>e.id==eqId);
    if(!eq) return 0;
    const usedByOthers = reservations
      .filter(r => r.id!==reservation.id && r.status==="מאושר")  // רק מאושרות תופסות מלאי
      .filter(r => r.borrow_date<=form.return_date && r.return_date>=form.borrow_date)
      .flatMap(r=>r.items||[])
      .filter(i=>i.equipment_id==eqId)
      .reduce((s,i)=>s+i.quantity,0);
    return Math.max(0, eq.total_quantity - usedByOthers);
  };

  const setQty = (eqId, qty) => {
    const totalAvail = getAvail(eqId);  // total available for this reservation
    const q = Math.max(0, Math.min(qty, totalAvail));
    const name = equipment.find(e=>e.id==eqId)?.name||"";
    setItems(prev => q===0 ? prev.filter(i=>i.equipment_id!=eqId)
      : prev.find(i=>i.equipment_id==eqId) ? prev.map(i=>i.equipment_id==eqId?{...i,quantity:q}:i)
      : [...prev,{equipment_id:eqId,quantity:q,name}]);
  };
  const getQty = (eqId) => items.find(i=>i.equipment_id==eqId)?.quantity||0;

  const categories = [...new Set(equipment.map(e=>e.category))];

  const save = async () => {
    setSaving(true);
    await onSave({...form, items});
    setSaving(false);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:3000,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"24px 16px",overflowY:"auto"}}>
      <div style={{width:"100%",maxWidth:760,background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",direction:"rtl"}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"20px 24px",borderBottom:"1px solid var(--border)",background:"var(--surface2)",borderRadius:"16px 16px 0 0"}}>
          <div>
            <div style={{fontWeight:900,fontSize:18}}>✏️ עריכת בקשה</div>
            <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{reservation.student_name} · {formatDate(reservation.borrow_date)}</div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>✕ סגור</button>
        </div>

        <div style={{padding:24,display:"flex",flexDirection:"column",gap:24}}>

          {/* Dates & Times */}
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

          {/* Equipment */}
          <div>
            <div className="form-section-title">ציוד ({items.reduce((s,i)=>s+i.quantity,0)} פריטים)</div>
            {categories.map(cat=>{
              const catEq = equipment.filter(e=>e.category===cat);
              return (
                <div key={cat} style={{marginBottom:16}}>
                  <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>{cat}</div>
                  {catEq.map(eq=>{
                    const qty = getQty(eq.id);
                    const totalAvail = getAvail(eq.id);
                    const remaining = totalAvail - qty;  // how many more can be added
                    return (
                      <div key={eq.id} className="item-row" style={{opacity:totalAvail===0?0.4:1}}>
                        {eq.image?.startsWith("data:")||eq.image?.startsWith("http")
                          ? <img src={eq.image} alt="" style={{width:32,height:32,objectFit:"cover",borderRadius:6}}/>
                          : <span style={{fontSize:22}}>{eq.image||"📦"}</span>}
                        <div style={{flex:1}}>
                          <div style={{fontWeight:600,fontSize:13}}>{eq.name}</div>
                          <div style={{fontSize:11,color:"var(--text3)"}}>זמין: <span style={{color:remaining===0?"var(--red)":remaining<=2?"var(--yellow)":"var(--green)",fontWeight:700}}>{remaining}</span></div>
                        </div>
                        <div className="qty-ctrl">
                          <button className="qty-btn" onClick={()=>setQty(eq.id,qty-1)}>−</button>
                          <span className="qty-num">{qty}</span>
                          <button className="qty-btn" disabled={remaining<=0} onClick={()=>setQty(eq.id,qty+1)}>+</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div style={{display:"flex",gap:10,justifyContent:"flex-end",paddingTop:8,borderTop:"1px solid var(--border)"}}>
            <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
            <button className="btn btn-primary" disabled={saving} onClick={save}>{saving?"⏳ שומר...":"💾 שמור שינויים"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── RESERVATIONS PAGE ────────────────────────────────────────────────────────
function ReservationsPage({ reservations, setReservations, equipment, showToast,
    search, setSearch, statusF, setStatusF, loanTypeF, setLoanTypeF, sortBy, setSortBy }) {
  const [selected, setSelected] = useState(null);
  const [editing, setEditing]   = useState(null);

  const filtered = [...reservations]
    .filter(r =>
      (statusF==="הכל" || r.status===statusF) &&
      (loanTypeF==="הכל" || r.loan_type===loanTypeF) &&
      (r.student_name?.includes(search) || r.email?.includes(search))
    )
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

  const updateStatus = async (id, status) => {
    const updated = reservations.map(r=>r.id===id?{...r,status}:r);
    setReservations(updated);
    await storageSet("reservations", updated);
    showToast("success", `סטטוס עודכן ל-${status}`);

    // שלח מייל לסטודנט על אישור או דחייה
    if (status === "מאושר" || status === "נדחה") {
      const res = reservations.find(r=>r.id===id);
      if (res?.email) {
        const itemsList = res.items?.map(i => `<tr><td style="padding:7px 12px;color:#e8eaf0;border-bottom:1px solid #1e2130">${i.name}</td><td style="padding:7px 12px;text-align:center;color:#f5a623;font-weight:700;border-bottom:1px solid #1e2130">${i.quantity}</td></tr>`).join("") || "";
        fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to:           res.email,
            type:         status === "מאושר" ? "approved" : "rejected",
            student_name: res.student_name,
            items_list:   itemsList,
            borrow_date:  formatDate(res.borrow_date),
            return_date:  formatDate(res.return_date),
          }),
        })
        .then(() => showToast("success", `📧 מייל נשלח ל-${res.email}`))
        .catch(() => showToast("error", "שגיאה בשליחת המייל"));
      }
    }
    setSelected(null);
  };

  return (
    <div className="page">

      {filtered.length===0
        ? <div className="empty-state"><div className="emoji">📭</div><div>אין בקשות</div></div>
        : <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {filtered.map(r=>(
            <div key={r.id} className="res-card">
              <div className="res-card-top">
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:38,height:38,borderRadius:"50%",background:"var(--surface3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:900,flexShrink:0}}>
                    {r.student_name?.[0]||"?"}
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
                  <span>📚 {r.course}</span>
                  <span>📅 {formatDate(r.borrow_date)} ← {formatDate(r.return_date)}{(()=>{const diff=Math.ceil((new Date(r.borrow_date)-new Date())/(1000*60*60*24));return diff>0?<span style={{marginRight:6,color:"var(--yellow)",fontWeight:700}}>({diff} ימים)</span>:diff===0?<span style={{marginRight:6,color:"var(--green)",fontWeight:700}}>(היום!)</span>:null;})()}</span>
                  <span>📦 {r.items?.length||0} פריטים</span>
                </div>
                <div style={{marginTop:8,display:"flex",flexWrap:"wrap",gap:4}}>
                  {r.items?.slice(0,3).map((i,j)=><span key={j} className="chip"><EqImg id={i.equipment_id} size={13}/> {eqName(i.equipment_id)} ×{i.quantity}</span>)}
                  {(r.items?.length||0)>3&&<span className="chip">+{r.items.length-3} נוספים</span>}
                </div>
              </div>
              <div className="res-card-actions">
                <button className="btn btn-secondary btn-sm" onClick={()=>setSelected(r)}>👁️ פרטים</button>
                <button className="btn btn-secondary btn-sm" onClick={()=>exportPDF(r)}>📄 PDF</button>
                {r.status==="מאושר"&&<button className="btn btn-secondary btn-sm" onClick={()=>setEditing(r)}>✏️ עריכת בקשה</button>}
                {r.status==="ממתין"&&<><button className="btn btn-success btn-sm" onClick={()=>updateStatus(r.id,"מאושר")}>✅ אשר</button><button className="btn btn-danger btn-sm" onClick={()=>updateStatus(r.id,"נדחה")}>❌ דחה</button></>}
                {r.status==="מאושר"&&<button className="btn btn-secondary btn-sm" onClick={()=>updateStatus(r.id,"הוחזר")}>🔄 הוחזר</button>}
                <button className="btn btn-danger btn-sm" onClick={()=>{ if(window.confirm(`למחוק את הבקשה של ${r.student_name}?`)) deleteReservation(r.id); }}>🗑️</button>
              </div>
            </div>
          ))}
        </div>
      }
      {editing && <EditReservationModal reservation={editing} equipment={equipment} reservations={reservations} onSave={async(updated)=>{ const all=reservations.map(r=>r.id===updated.id?updated:r); setReservations(all); await storageSet("reservations",all); showToast("success","הבקשה עודכנה"); setEditing(null); }} onClose={()=>setEditing(null)}/>}
      {selected && (
        <Modal title={`📋 בקשה — ${selected.student_name}`} onClose={()=>setSelected(null)} size="modal-lg"
          footer={<>
            {selected.status==="ממתין"&&<><button className="btn btn-success" onClick={()=>updateStatus(selected.id,"מאושר")}>✅ אשר</button><button className="btn btn-danger" onClick={()=>updateStatus(selected.id,"נדחה")}>❌ דחה</button></>}
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
function CalendarGrid({ days, activeRes, colorMap, todayStr, cellHeight=110, fontSize=11 }) {
  // Split days into weeks of 7
  const weeks = [];
  for(let i=0;i<days.length;i+=7) weeks.push(days.slice(i,i+7));

  // For each week, compute event bars with slot assignment
  const getWeekBars = (week) => {
    const weekStart = week.find(d=>d);
    const weekEnd   = [...week].reverse().find(d=>d);
    if(!weekStart||!weekEnd) return [];
    const wsStr = dateToLocal(weekStart);
    const weStr = dateToLocal(weekEnd);

    // find all events overlapping this week
    const evts = activeRes.filter(r => r.borrow_date<=weStr && r.return_date>=wsStr);

    // assign slots (rows) - greedy
    const slots = [];
    const bars  = [];
    evts.forEach(r=>{
      const [bg,color] = colorMap[r.id]||["rgba(52,152,219,0.38)","#5dade2"];
      // col index within this week
      const startCol = week.findIndex(d=>d && dateToLocal(d)>=r.borrow_date);
      const endColRaw= week.findLastIndex(d=>d && dateToLocal(d)<=r.return_date);
      const sc = startCol<0?0:startCol;
      const ec = endColRaw<0?6:endColRaw;
      const showName = !week.slice(0,sc).some(d=>d && dateToLocal(d)>=r.borrow_date===false) || week[sc] && dateToLocal(week[sc])===r.borrow_date;
      // find free slot
      let slot=0;
      while(slots[slot]!==undefined && slots[slot]>sc) slot++;
      slots[slot]=ec;
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
                  zIndex:1, backdropFilter:"blur(0px)",
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
  const active = reservations.filter(r => r.status === "מאושר").length;
  const pending = reservations.filter(r => r.status === "ממתין").length;
  const rtToday = reservations.filter(r => r.status === "מאושר" && r.return_date === todayStr).length;
  const todayLoans = reservations.filter(r => r.status !== "נדחה" && r.status !== "הוחזר" && r.borrow_date <= todayStr && r.return_date >= todayStr).length;
  const total = equipment.reduce((s, e) => s + Number(e.total_quantity), 0);

  const [calDate, setCalDate] = useState(new Date());
  const [calFS, setCalFS] = useState(false);
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
  const activeRes = reservations.filter(r => r.status !== "נדחה" && r.borrow_date && r.return_date);
  const colorMap = {};
  activeRes.forEach((r,i) => { colorMap[r.id] = SPAN_COLORS[i % SPAN_COLORS.length]; });

  return (
    <div className="page">
      <div className="stats-grid">
        {[
          { l:"פריטי ציוד",    v:equipment.length, i:"📦", c:"var(--accent)" },
          { l:"סך יחידות",     v:total,            i:"🗃️", c:"var(--blue)"   },
          { l:"השאלות פעילות", v:active,           i:"✅", c:"var(--green)"  },
          { l:"ממתין לאישור",  v:pending,          i:"⏳", c:"var(--yellow)" },
          { l:"השאלות היום",   v:todayLoans,       i:"📋", c:"var(--purple)" },
          { l:"החזרות היום",   v:rtToday,          i:"🔄", c:"var(--blue)"   },
        ].map(s=>(
          <div key={s.l} className="stat-card" style={{"--ac":s.c}}>
            <div className="stat-label">{s.l}</div>
            <div className="stat-value">{s.v}</div>
            <div className="stat-icon">{s.i}</div>
          </div>
        ))}
      </div>

      <div className="dashboard-bottom-grid mb-6">
        <div className="card">
          <div className="card-header"><span className="card-title">🕒 בקשות אחרונות</span></div>
          {[...reservations].sort((a,b)=>Number(b.id)-Number(a.id)).slice(0,6).map(r=>(
            <div key={r.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid var(--border)"}}>
              <div style={{width:34,height:34,borderRadius:"50%",background:"var(--surface2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>{r.student_name?.[0]||"?"}</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:13}}>{r.student_name}</div>
                <div style={{fontSize:11,color:"var(--text3)"}}>{formatDate(r.borrow_date)} – {formatDate(r.return_date)}{(()=>{const diff=Math.ceil((new Date(r.borrow_date)-new Date())/(1000*60*60*24));return diff>0?<span style={{marginRight:6,color:"var(--yellow)",fontWeight:700}}>({diff} ימים)</span>:diff===0?<span style={{marginRight:6,color:"var(--green)",fontWeight:700}}>(היום!)</span>:null;})()}</div>
              </div>
              {statusBadge(r.status)}
            </div>
          ))}
          {reservations.length===0&&<div className="empty-state"><div className="emoji">📋</div><p>אין בקשות עדיין</p></div>}
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
          {/* Day headers */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:4,direction:"rtl"}}>
            {HE_D.map(d=><div key={d} style={{textAlign:"center",fontSize:11,fontWeight:700,color:"var(--text3)",padding:"4px 0"}}>{d}</div>)}
          </div>
          <CalendarGrid days={days} activeRes={activeRes} colorMap={colorMap} todayStr={todayStr} cellHeight={90} fontSize={10}/>
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
            <CalendarGrid days={days} activeRes={activeRes} colorMap={colorMap} todayStr={todayStr} cellHeight={130} fontSize={13}/>
          </div>
        </div>
      )}
    </div>
  );
}
// ─── PUBLIC FORM ──────────────────────────────────────────────────────────────
function PublicForm({ equipment, reservations, setReservations, showToast, categories=DEFAULT_CATEGORIES }) {
  const [step, setStep]       = useState(1);
  const [form, setForm]       = useState({student_name:"",email:"",phone:"",course:"",project_name:"",borrow_date:"",borrow_time:"",return_date:"",return_time:"",loan_type:""});
  const [items, setItems]     = useState([]);
  const [agreed, setAgreed]   = useState(false);
  const [done, setDone]       = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [submitting, setSub]  = useState(false);
  const set = (k,v) => setForm(p=>({...p,[k]:v}));

  const minDays = form.loan_type==="פרטית" ? 2 : form.loan_type==="סאונד" ? 0 : 7;
  const minDate = (()=>{ const d=new Date(); d.setDate(d.getDate()+minDays); return d.toISOString().split("T")[0]; })();
  const tooSoon = form.loan_type!=="סאונד" && form.borrow_date && form.borrow_date < minDate;
  const TIME_SLOTS = form.loan_type==="סאונד"
    ? ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30"]
    : ["09:00","09:30","14:30","15:00","15:30","16:00","16:30","17:00","17:30"];
  const isSoundLoan = form.loan_type==="סאונד";
  const ok1 = form.student_name && form.email && form.phone && form.course && form.loan_type;
  const ok2 = form.borrow_date && form.return_date && form.return_date>=form.borrow_date && !tooSoon && form.borrow_time && form.return_time;

  const availEq = useMemo(()=>{
    if(!form.borrow_date||!form.return_date) return [];
    return equipment.map(eq=>({...eq, avail: getAvailable(eq.id,form.borrow_date,form.return_date,reservations,equipment)}));
  },[form.borrow_date,form.return_date,equipment,reservations]);

  const getItem = id => items.find(i=>i.equipment_id==id)||{quantity:0};
  const setQty  = (id,qty) => {
    const avail = availEq.find(e=>e.id==id)?.avail||0;
    const q = Math.max(0,Math.min(qty,avail));
    const name = equipment.find(e=>e.id==id)?.name||"";
    setItems(prev => q===0 ? prev.filter(i=>i.equipment_id!=id) : prev.find(i=>i.equipment_id==id) ? prev.map(i=>i.equipment_id==id?{...i,quantity:q}:i) : [...prev,{equipment_id:id,quantity:q,name}]);
  };

  const waText = encodeURIComponent("שלום נמרוד הגשתי בקשה להשאלה ממתין לאישורך תודה");
  const waLink = `https://wa.me/${NIMROD_PHONE}?text=${waText}`;

  const sendEmail = async (res) => {
    try {
      const waText = encodeURIComponent("שלום נמרוד הגשתי בקשה להשאלה ממתין לאישורך תודה");
      const waLink = `https://wa.me/${NIMROD_PHONE}?text=${waText}`;
      const itemsList = res.items.map(i => `<tr><td style="padding:7px 12px;color:#e8eaf0;border-bottom:1px solid #1e2130">${i.name}</td><td style="padding:7px 12px;text-align:center;color:#f5a623;font-weight:700;border-bottom:1px solid #1e2130">${i.quantity}</td></tr>`).join("");
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
    } catch(e) {
      console.error("send email error:", e);
    }
  };

  // RFC 5322 compliant email regex — works for Gmail, Outlook, Apple, academic, etc.
  const isValidEmail = (email) => /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(email.trim());

  const submit = async () => {
    // Validate email format before doing anything
    if(!isValidEmail(form.email)) {
      setEmailError(true);
      return;
    }
    setSub(true);
    const newRes = { ...form, id:Date.now(), status:"ממתין", created_at:today(), items };
    const updated = [...reservations, newRes];
    setReservations(updated);
    await storageSet("reservations", updated);
    await sendEmail(newRes);
    setSub(false);
    setDone(true);
    showToast("success","הבקשה נשלחה בהצלחה!");
  };

  const reset = () => { setDone(false); setEmailError(false); setStep(1); setForm({student_name:"",email:"",phone:"",course:"",project_name:"",borrow_date:"",borrow_time:"",return_date:"",return_time:"",loan_type:""}); setItems([]); setAgreed(false); };

  if(emailError) return (
    <div className="form-page">
      <div style={{width:"100%",maxWidth:500,background:"var(--surface)",border:"1px solid rgba(231,76,60,0.4)",borderRadius:16,padding:40,textAlign:"center",direction:"rtl"}}>
        <div style={{fontSize:64,marginBottom:16}}>❌</div>
        <h2 style={{fontSize:22,fontWeight:900,color:"#e74c3c",marginBottom:12}}>כתובת המייל שגויה</h2>
        <p style={{fontSize:14,color:"var(--text2)",marginBottom:28,lineHeight:1.7}}>
          לא הצלחנו לשלוח מייל לכתובת <strong style={{color:"var(--text)"}}>{form.email}</strong>.<br/>
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
    <div className="form-page">
      <div className="form-card">
        <div className="form-card-header">
          <div style={{fontSize:40,marginBottom:10}}>🎬</div>
          <div style={{fontSize:24,fontWeight:900,color:"var(--accent)"}}>מחסן השאלת ציוד קמרה אובסקורה וסאונד</div>
          <div style={{fontSize:14,color:"var(--text2)",marginTop:4}}>טופס השאלת ציוד</div>
          <div style={{display:"flex",gap:8,marginTop:20,alignItems:"center"}}>
            {[{n:1,l:"פרטים"},{n:2,l:"תאריכים"},{n:3,l:"ציוד"},{n:4,l:"אישור"}].map((s,i)=>(
              <div key={s.n} style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{width:26,height:26,borderRadius:"50%",background:step>=s.n?"var(--accent)":"var(--surface3)",color:step>=s.n?"#000":"var(--text3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700}}>{s.n}</div>
                <span style={{fontSize:12,color:step===s.n?"var(--accent)":"var(--text3)",fontWeight:step===s.n?700:400}}>{s.l}</span>
                {i<3&&<span style={{color:"var(--text3)"}}>›</span>}
              </div>
            ))}
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
                <div key={opt.val} onClick={()=>{set("loan_type",opt.val);setItems([]);}} style={{width:"100%",padding:"14px 18px",borderRadius:"var(--r)",background:form.loan_type===opt.val?"var(--accent-glow)":"var(--surface2)",border:`2px solid ${form.loan_type===opt.val?"var(--accent)":"var(--border)"}`,cursor:"pointer",transition:"all 0.15s",display:"flex",alignItems:"center",gap:14}}>
                  <div style={{fontSize:30,flexShrink:0}}>{opt.icon}</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:800,fontSize:15,color:form.loan_type===opt.val?"var(--accent)":"var(--text)"}}>{opt.val==="סאונד"?"השאלת סאונד":`השאלה ${opt.val}`}</div>
                    <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{opt.desc}</div>
                  </div>
                  {form.loan_type===opt.val&&<div style={{fontSize:16,color:"var(--accent)",fontWeight:900,flexShrink:0}}>✓</div>}
                </div>
              ))}
            </div>
            <div className="form-section-title">פרטי הסטודנט</div>
            <div className="grid-2">
              <div className="form-group"><label className="form-label">שם מלא *</label><input className="form-input" value={form.student_name} onChange={e=>set("student_name",e.target.value)}/></div>
              <div className="form-group"><label className="form-label">טלפון *</label><input className="form-input" value={form.phone} onChange={e=>set("phone",e.target.value)}/></div>
            </div>
            <div className="form-group"><label className="form-label">אימייל *</label><input type="email" className="form-input" value={form.email} onChange={e=>set("email",e.target.value)}/></div>
            <div className="grid-2">
              <div className="form-group"><label className="form-label">קורס / כיתה *</label><input className="form-input" value={form.course} onChange={e=>set("course",e.target.value)}/></div>
              <div className="form-group"><label className="form-label">שם הפרויקט</label><input className="form-input" value={form.project_name} onChange={e=>set("project_name",e.target.value)}/></div>
            </div>
            <button className="btn btn-primary" disabled={!ok1} onClick={()=>setStep(2)}>המשך ← תאריכים</button>
          </>}

          {step===2 && <>
            <div className="form-section-title">תאריכים ושעות</div>
            <div className="grid-2">
              <div className="form-group"><label className="form-label">📅 תאריך השאלה *</label><input type="date" className="form-input" min={minDate} value={form.borrow_date} onChange={e=>set("borrow_date",e.target.value)}/></div>
              <div className="form-group"><label className="form-label">שעת איסוף *</label>
                <select className="form-select" value={form.borrow_time} onChange={e=>set("borrow_time",e.target.value)}>
                  <option value="">-- בחר שעה --</option>
                  {TIME_SLOTS.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="grid-2">
              <div className="form-group"><label className="form-label">📅 תאריך החזרה *</label><input type="date" className="form-input" min={form.borrow_date||today()} value={form.return_date} onChange={e=>set("return_date",e.target.value)}/></div>
              <div className="form-group"><label className="form-label">שעת החזרה *</label>
                <select className="form-select" value={form.return_time} onChange={e=>set("return_time",e.target.value)}>
                  <option value="">-- בחר שעה --</option>
                  {TIME_SLOTS.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            {tooSoon && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 {form.loan_type==="פרטית"?"השאלה פרטית דורשת התראה של 48 שעות לפחות.":"נדרשת התראה של שבוע לפחות."} תאריך מוקדם ביותר: <strong>{formatDate(minDate)}</strong></div>}
            {ok2 && <div className="highlight-box">📅 השאלה ל-{Math.ceil((new Date(form.return_date)-new Date(form.borrow_date))/(86400000))+1} ימים · איסוף {form.borrow_time} · החזרה {form.return_time}</div>}
            <div className="flex gap-2"><button className="btn btn-secondary" onClick={()=>setStep(1)}>← חזור</button><button className="btn btn-primary" disabled={!ok2} onClick={()=>setStep(3)}>המשך ← ציוד</button></div>
          </>}

          {step===3 && <>
            <div className="form-section-title">בחירת ציוד{isSoundLoan&&<span style={{fontSize:11,color:"var(--text3)",fontWeight:400,marginRight:8}}>· מיקרופונים ומקליטי אודיו בלבד</span>}</div>
            {(isSoundLoan?SOUND_CATEGORIES:categories).map(c=>{
              const cat=availEq.filter(e=>e.category===c); if(!cat.length) return null;
              return <div key={c} style={{marginBottom:20}}>
                <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>{c}</div>
                {cat.map(eq=>{
                  const itm=getItem(eq.id);
                  return <div key={eq.id} className="item-row" style={{opacity:eq.avail===0?0.4:1}}>
                    {eq.image?.startsWith("data:")||eq.image?.startsWith("http")
                      ? <img src={eq.image} alt="" style={{width:36,height:36,objectFit:"cover",borderRadius:6}}/>
                      : <span style={{fontSize:26}}>{eq.image||"📦"}</span>}
                    <div style={{flex:1}}><div style={{fontWeight:600,fontSize:14}}>{eq.name}</div><div style={{fontSize:12,color:"var(--text3)"}}>זמין: <span style={{color:eq.avail===0?"var(--red)":eq.avail<=2?"var(--yellow)":"var(--green)",fontWeight:700}}>{eq.avail}</span></div></div>
                    {eq.avail>0 ? <div className="qty-ctrl"><button className="qty-btn" onClick={()=>setQty(eq.id,itm.quantity-1)}>−</button><span className="qty-num">{itm.quantity}</span><button className="qty-btn" onClick={()=>setQty(eq.id,itm.quantity+1)}>+</button></div> : <span className="badge badge-red">לא זמין</span>}
                  </div>;
                })}
              </div>;
            })}
            {items.length>0&&<div className="highlight-box">🛒 נבחרו {items.length} סוגים ({items.reduce((s,i)=>s+i.quantity,0)} יחידות)</div>}
            <div className="flex gap-2"><button className="btn btn-secondary" onClick={()=>setStep(2)}>← חזור</button><button className="btn btn-primary" disabled={!items.length} onClick={()=>setStep(4)}>המשך ← אישור</button></div>
          </>}

          {step===4 && <>
            <div className="form-section-title">סיכום ואישור</div>
            <div className="grid-2" style={{marginBottom:20}}>
              <div>{[["שם",form.student_name],["אימייל",form.email],["קורס",form.course],["סוג השאלה",form.loan_type],["מ",formatDate(form.borrow_date)],["עד",formatDate(form.return_date)]].map(([l,v])=><div key={l} className="req-detail-row"><span className="req-detail-label">{l}:</span><strong>{v}</strong></div>)}</div>
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
            <div className="terms-box">{TERMS}</div>
            <label className="checkbox-row" style={{marginBottom:20}}>
              <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/>
              <label>אני מאשר/ת שקראתי את התקנון ומתחייב/ת להחזיר את הציוד בזמן ובמצב תקין</label>
            </label>
            <div className="flex gap-2">
              <button className="btn btn-secondary" onClick={()=>setStep(3)}>← חזור</button>
              <button className="btn btn-primary" disabled={!agreed||submitting} onClick={submit}>{submitting?"⏳ שולח...":"🚀 שלח בקשה"}</button>
            </div>
          </>}
        </div>
      </div>
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
  const [page, setPage]               = useState("dashboard");
  const [equipment, setEquipment]     = useState([]);
  const [reservations, setReservations] = useState([]);
  const [categories, setCategories]   = useState(DEFAULT_CATEGORIES);
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
      const eq  = await storageGet("equipment");
      const res = await storageGet("reservations");
      const cats = await storageGet("categories");
      setEquipment(eq  || INITIAL_EQUIPMENT);
      setReservations(res || []);
      setCategories(cats || DEFAULT_CATEGORIES);
      if(!eq)   await storageSet("equipment",    INITIAL_EQUIPMENT);
      if(!res)  await storageSet("reservations", []);
      if(!cats) await storageSet("categories",   DEFAULT_CATEGORIES);
      setLoading(false);
    })();
  },[]);

  const pending = reservations.filter(r=>r.status==="ממתין").length;
  const pageTitle = { dashboard:"לוח בקרה", equipment:"ניהול ציוד", reservations:"ניהול בקשות" };

  return (
    <>
      <style>{css}</style>

      {/* ── טופס ציבורי ── */}
      {!isAdmin && (
        <div className="public-page-shell">
          {loading ? <Loading/> : <PublicForm equipment={equipment} reservations={reservations} setReservations={setReservations} showToast={showToast} categories={categories}/>}
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
              {[{id:"dashboard",icon:"📊",label:"לוח בקרה"},{id:"equipment",icon:"📦",label:"ציוד"},{id:"reservations",icon:"📋",label:"בקשות",badge:pending||null}].map(n=>(
                <div key={n.id} className={`nav-item ${page===n.id?"active":""}`} onClick={()=>setPage(n.id)}>
                  <span className="icon">{n.icon}</span>
                  <span style={{flex:1}}>{n.label}</span>
                  {n.badge&&<span style={{background:"var(--accent)",color:"#000",borderRadius:"50%",width:18,height:18,fontSize:11,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center"}}>{n.badge}</span>}
                </div>
              ))}
            </div>
            <div style={{padding:"14px 20px",borderTop:"1px solid var(--border)",fontSize:11,color:"var(--text3)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span>💾 אחסון פעיל</span>
              <button className="btn btn-secondary btn-sm" onClick={()=>setAuthed(false)}>🚪 יציאה</button>
            </div>
          </nav>
          <div className="main">
            <div className="topbar">
              <span className="topbar-title">{pageTitle[page]}</span>
              <div style={{display:"flex",alignItems:"center",gap:8,flex:1,justifyContent:"flex-end",flexWrap:"wrap"}}>
                {page==="reservations" && <>
                  <div className="search-bar" style={{minWidth:140}}><span>🔍</span><input placeholder="חיפוש..." value={resSearch} onChange={e=>setResSearch(e.target.value)}/></div>
                  <select className="form-select" style={{width:120,fontSize:12,padding:"6px 8px"}} value={resStatusF} onChange={e=>setResStatusF(e.target.value)}>
                    <option value="הכל">כל הסטטוסים</option>
                    {["ממתין","מאושר","נדחה","הוחזר"].map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                  <select className="form-select" style={{width:110,fontSize:12,padding:"6px 8px"}} value={resLoanTypeF} onChange={e=>setResLoanTypeF(e.target.value)}>
                    <option value="הכל">כל הסוגים</option>
                    {["פרטית","הפקה","סאונד"].map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                  <select className="form-select" style={{width:140,fontSize:12,padding:"6px 8px"}} value={resSortBy} onChange={e=>setResSortBy(e.target.value)}>
                    <option value="received">🕐 קבלה</option>
                    <option value="urgency">🔥 דחיפות</option>
                  </select>
                </>}
                {pending>0&&<div style={{background:"rgba(241,196,15,0.12)",border:"1px solid rgba(241,196,15,0.3)",borderRadius:8,padding:"6px 12px",fontSize:12,color:"var(--yellow)"}}>⏳ {pending}</div>}
              </div>
            </div>
            {loading ? <Loading/> : <>
              {page==="dashboard"   && <DashboardPage    equipment={equipment} reservations={reservations}/>}
              {page==="equipment"   && <EquipmentPage    equipment={equipment} reservations={reservations} setEquipment={setEquipment} showToast={showToast} categories={categories} setCategories={setCategories}/>}
              {page==="reservations"&& <ReservationsPage reservations={reservations} setReservations={setReservations} equipment={equipment} showToast={showToast}
                search={resSearch} setSearch={setResSearch} statusF={resStatusF} setStatusF={setResStatusF}
                loanTypeF={resLoanTypeF} setLoanTypeF={setResLoanTypeF} sortBy={resSortBy} setSortBy={setResSortBy}/>}
            </>}
          </div>
        </div>
      )}

      <Toast toasts={toasts}/>
    </>
  );
}