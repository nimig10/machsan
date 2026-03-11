import { useState, useEffect, useMemo } from "react";

// ─── GOOGLE SHEETS STORAGE (דרך Vercel) ──────────────────────────────────────
async function storageGet(key) {
  try {
    const action = key === "reservations" ? "getReservations" : "getEquipment";
    const res = await fetch(`/api/sheets?action=${action}`);
    const json = await res.json();
    return json.ok ? json.data : null;
  } catch { return null; }
}

async function storageSet(key, value) {
  try {
    const action = key === "reservations" ? "saveReservations" : "saveEquipment";
    await fetch("/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload: value }),
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
const CATEGORIES  = ["מצלמות","עדשות","מיקרופונים","מקליטי אודיו","תאורה","חצובות","אביזרים"];
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
function today() { return new Date().toISOString().split("T")[0]; }

function getAvailable(eqId, borrowDate, returnDate, reservations, equipment, excludeId=null) {
  const eq = equipment.find(e => e.id == eqId);
  if (!eq) return 0;
  const b = new Date(borrowDate), r = new Date(returnDate);
  let used = 0;
  for (const res of reservations) {
    if (res.id === excludeId) continue;
    if (res.status === "נדחה" || res.status === "הוחזר") continue;
    const rb = new Date(res.borrow_date), rr = new Date(res.return_date);
    if (b <= rr && r >= rb) {
      const item = res.items?.find(i => i.equipment_id == eqId);
      if (item) used += item.quantity;
    }
  }
  return eq.total_quantity - used;
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
  body { font-family:'Heebo',sans-serif; background:var(--bg); color:var(--text); direction:rtl; min-height:100vh; }
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
  .cal-headers { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; margin-bottom:2px; }
  .cal-grid { display:grid; grid-template-columns:repeat(7,1fr); grid-template-rows:repeat(6,1fr); gap:2px; height:480px; }
  .cal-day-header { text-align:center; font-size:11px; font-weight:700; color:var(--text3); padding:6px 4px; }
  .cal-day { background:var(--surface2); border-radius:var(--r-sm); padding:6px; border:1px solid var(--border); overflow:hidden; min-height:0; }
  .cal-day.is-today { border-color:var(--accent); }
  .cal-day-num { font-size:12px; font-weight:700; margin-bottom:4px; color:var(--text2); }
  .cal-event { font-size:10px; padding:2px 5px; border-radius:3px; margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .cal-borrow { background:rgba(52,152,219,0.25); color:var(--blue); }
  .cal-return  { background:rgba(46,204,113,0.25); color:var(--green); }
  .form-page { min-height:100vh; background:var(--bg); display:flex; align-items:center; justify-content:center; padding:40px 20px; }
  .form-card { width:100%; max-width:680px; background:var(--surface); border:1px solid var(--border); border-radius:16px; overflow:hidden; }
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
    .form-page { padding:16px 12px 80px; align-items:flex-start; }
    .form-card-header { padding:20px; }
    .form-card-body { padding:20px; }
    .toast-container { left:12px; right:12px; bottom:76px; }
    .toast { min-width:0; width:100%; }
    .cal-grid { height:300px; }
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
function EquipmentPage({ equipment, reservations, setEquipment, showToast }) {
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("הכל");
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);

  const filtered = equipment.filter(e => (cat==="הכל"||e.category===cat) && e.name.includes(search));

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

  const used = (id) => reservations.filter(r=>r.status==="מאושר"||r.status==="ממתין").reduce((s,r)=>s+(r.items?.find(i=>i.equipment_id==id)?.quantity||0),0);

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
          <div className="form-group"><label className="form-label">קטגוריה</label><select className="form-select" value={f.category} onChange={e=>s("category",e.target.value)}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></div>
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
        <button className="btn btn-primary" onClick={()=>setModal({type:"add"})}>➕ הוסף ציוד</button>
      </div>
      <div className="flex gap-2 mb-6" style={{flexWrap:"wrap"}}>
        {["הכל",...CATEGORIES].map(c=><button key={c} className={`btn btn-sm ${cat===c?"btn-primary":"btn-secondary"}`} onClick={()=>setCat(c)}>{c}</button>)}
      </div>
      {filtered.length===0 ? <div className="empty-state"><div className="emoji">📦</div><p>לא נמצא ציוד</p></div> : (
        <div className="eq-grid">
          {filtered.map(eq=>(
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
      )}
      {(modal?.type==="add"||modal?.type==="edit") && <Modal title={modal.type==="add"?"➕ הוספת ציוד":"✏️ עריכת ציוד"} onClose={()=>setModal(null)}><EqForm initial={modal.type==="edit"?modal.item:null}/></Modal>}
      {modal?.type==="delete" && <Modal title="🗑️ מחיקת ציוד" onClose={()=>setModal(null)} footer={<><button className="btn btn-danger" onClick={()=>del(modal.item)}>כן, מחק</button><button className="btn btn-secondary" onClick={()=>setModal(null)}>ביטול</button></>}><p>האם למחוק את <strong>{modal.item.name}</strong>?</p></Modal>}
    </div>
  );
}

// ─── RESERVATIONS PAGE ────────────────────────────────────────────────────────
function ReservationsPage({ reservations, setReservations, equipment, showToast }) {
  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState("הכל");
  const [selected, setSelected] = useState(null);

  const filtered = reservations.filter(r=>(statusF==="הכל"||r.status===statusF)&&(r.student_name?.includes(search)||r.email?.includes(search)));
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
    <div class="sub">המחסן של קישקתא ונמרוד — הופק ב-${new Date().toLocaleDateString("he-IL")}</div>
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
        const itemsList = res.items?.map(i => `<li>${i.name} × ${i.quantity}</li>`).join("") || "";
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
      <div className="flex-between mb-4">
        <div className="flex gap-3">
          <div className="search-bar"><span>🔍</span><input placeholder="חיפוש..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
          <select className="form-select" style={{width:150}} value={statusF} onChange={e=>setStatusF(e.target.value)}>
            <option>הכל</option>{["ממתין","מאושר","נדחה","הוחזר"].map(s=><option key={s}>{s}</option>)}
          </select>
        </div>
      </div>
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
                  <span>📅 {formatDate(r.borrow_date)} ← {formatDate(r.return_date)}</span>
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
                {r.status==="ממתין"&&<><button className="btn btn-success btn-sm" onClick={()=>updateStatus(r.id,"מאושר")}>✅ אשר</button><button className="btn btn-danger btn-sm" onClick={()=>updateStatus(r.id,"נדחה")}>❌ דחה</button></>}
                {r.status==="מאושר"&&<button className="btn btn-secondary btn-sm" onClick={()=>updateStatus(r.id,"הוחזר")}>🔄 הוחזר</button>}
                <button className="btn btn-danger btn-sm" onClick={()=>{ if(window.confirm(`למחוק את הבקשה של ${r.student_name}?`)) deleteReservation(r.id); }}>🗑️</button>
              </div>
            </div>
          ))}
        </div>
      }
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
                  <strong>{formatDate(selected.borrow_date)}</strong>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:13}}>
                  <span style={{color:"var(--text3)"}}>🔄 תאריך החזרה</span>
                  <strong>{formatDate(selected.return_date)}</strong>
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
function DashboardPage({ equipment, reservations }) {
  const todayStr = today();
  const active   = reservations.filter(r=>r.status==="מאושר").length;
  const pending  = reservations.filter(r=>r.status==="ממתין").length;
  const rtToday  = reservations.filter(r=>r.status==="מאושר"&&r.return_date===todayStr).length;
  const total    = equipment.reduce((s,e)=>s+Number(e.total_quantity),0);

  const [calDate, setCalDate] = useState(new Date());
  const yr=calDate.getFullYear(), mo=calDate.getMonth();
  const days=[]; const sd=new Date(yr,mo,1).getDay();
  for(let i=0;i<sd;i++) days.push(null);
  for(let d=1;d<=new Date(yr,mo+1,0).getDate();d++) days.push(new Date(yr,mo,d));
  while(days.length<42) days.push(null);
  const HE_M=["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  const HE_D=["א׳","ב׳","ג׳","ד׳","ה׳","ו׳","ש׳"];

  const eventsFor = d => {
    if(!d) return [];
    const ds=d.toISOString().split("T")[0]; const ev=[];
    reservations.forEach(r=>{ if(r.status==="נדחה") return; if(r.borrow_date===ds) ev.push({t:"borrow",l:`📅 ${r.student_name}`}); if(r.return_date===ds) ev.push({t:"return",l:`🔄 ${r.student_name}`}); });
    return ev;
  };

  return (
    <div className="page">
      <div className="stats-grid">
        {[{l:"פריטי ציוד",v:equipment.length,i:"📦",c:"var(--accent)"},{l:"סך יחידות",v:total,i:"🗃️",c:"var(--blue)"},{l:"השאלות פעילות",v:active,i:"✅",c:"var(--green)"},{l:"ממתין לאישור",v:pending,i:"⏳",c:"var(--yellow)"},{l:"החזרות היום",v:rtToday,i:"🔄",c:"var(--purple)"}].map(s=>(
          <div key={s.l} className="stat-card" style={{"--ac":s.c}}>
            <div className="stat-label">{s.l}</div><div className="stat-value">{s.v}</div><div className="stat-icon">{s.i}</div>
          </div>
        ))}
      </div>
      <div className="grid-2 mb-6">
        <div className="card">
          <div className="card-header">
            <span className="card-title">📅 יומן</span>
            <div className="flex gap-2">
              <button className="btn btn-secondary btn-sm" onClick={()=>setCalDate(new Date(yr,mo-1,1))}>‹</button>
              <span style={{fontWeight:700,minWidth:100,textAlign:"center"}}>{HE_M[mo]} {yr}</span>
              <button className="btn btn-secondary btn-sm" onClick={()=>setCalDate(new Date(yr,mo+1,1))}>›</button>
            </div>
          </div>
          <div className="cal-headers">
            {HE_D.map(d=><div key={d} className="cal-day-header">{d}</div>)}
          </div>
          <div className="cal-grid">
            {days.map((d,i)=>{
              const ev=eventsFor(d); const isT=d&&d.toISOString().split("T")[0]===todayStr;
              return <div key={i} className={`cal-day ${isT?"is-today":""}`} style={{opacity:!d?0.2:1}}>
                {d&&<div className="cal-day-num">{d.getDate()}</div>}
                {ev.slice(0,2).map((e,j)=><div key={j} className={`cal-event ${e.t==="borrow"?"cal-borrow":"cal-return"}`}>{e.l}</div>)}
                {ev.length>2&&<div style={{fontSize:10,color:"var(--text3)"}}>+{ev.length-2}</div>}
              </div>;
            })}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><span className="card-title">🕒 בקשות אחרונות</span></div>
          {[...reservations].sort((a,b)=>b.id-a.id).slice(0,6).map(r=>(
            <div key={r.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid var(--border)"}}>
              <div style={{width:34,height:34,borderRadius:"50%",background:"var(--surface2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>{r.student_name?.[0]||"?"}</div>
              <div style={{flex:1}}><div style={{fontWeight:700,fontSize:13}}>{r.student_name}</div><div style={{fontSize:11,color:"var(--text3)"}}>{formatDate(r.borrow_date)} – {formatDate(r.return_date)}</div></div>
              {statusBadge(r.status)}
            </div>
          ))}
          {reservations.length===0&&<div className="empty-state"><div className="emoji">📋</div><p>אין בקשות עדיין</p></div>}
        </div>
      </div>
    </div>
  );
}

// ─── PUBLIC FORM ──────────────────────────────────────────────────────────────
function PublicForm({ equipment, reservations, setReservations, showToast }) {
  const [step, setStep]       = useState(1);
  const [form, setForm]       = useState({student_name:"",email:"",phone:"",course:"",project_name:"",borrow_date:"",return_date:"",loan_type:""});
  const [items, setItems]     = useState([]);
  const [agreed, setAgreed]   = useState(false);
  const [done, setDone]       = useState(false);
  const [submitting, setSub]  = useState(false);
  const set = (k,v) => setForm(p=>({...p,[k]:v}));

  const minDate = (()=>{ const d=new Date(); d.setDate(d.getDate()+7); return d.toISOString().split("T")[0]; })();
  const tooSoon = form.borrow_date && form.borrow_date < minDate;
  const ok1 = form.student_name && form.email && form.phone && form.course && form.loan_type;
  const ok2 = form.borrow_date && form.return_date && form.return_date>=form.borrow_date && !tooSoon;

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
      const itemsList = res.items.map(i => `<li>${i.name} × ${i.quantity}</li>`).join("");
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

  const submit = async () => {
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

  const reset = () => { setDone(false); setStep(1); setForm({student_name:"",email:"",phone:"",course:"",project_name:"",borrow_date:"",return_date:"",loan_type:""}); setItems([]); setAgreed(false); };

  if(done) return (
    <div className="form-page">
      <div style={{width:"100%",maxWidth:500,background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,padding:40,textAlign:"center"}}>
        <div style={{fontSize:64,marginBottom:16}}>✅</div>
        <h2 style={{fontSize:24,fontWeight:900,color:"var(--accent)",marginBottom:8}}>הבקשה נשלחה!</h2>
        <p style={{fontSize:14,color:"var(--text2)",marginBottom:28}}>בקשתך התקבלה בהצלחה.<br/>צוות המכללה יעבור עליה לאישורה הסופי.</p>
        <div style={{background:"rgba(37,211,102,0.1)",border:"1px solid rgba(37,211,102,0.25)",borderRadius:12,padding:20,marginBottom:24}}>
          <p style={{fontWeight:700,marginBottom:10,fontSize:15}}>📲 שלח ווצאפ לנמרוד גרא:</p>
          <div style={{background:"var(--surface2)",borderRadius:8,padding:12,fontStyle:"italic",fontSize:13,color:"var(--text2)",marginBottom:14}}>
            "שלום נמרוד הגשתי בקשה להשאלה ממתין לאישורך תודה"
          </div>
          <a href={waLink} target="_blank" rel="noopener noreferrer"
            style={{display:"inline-flex",alignItems:"center",gap:8,padding:"10px 24px",background:"#25d366",color:"#fff",borderRadius:25,fontWeight:700,fontSize:14,textDecoration:"none"}}>
            💬 שלח ווצאפ עכשיו
          </a>
        </div>
        <button className="btn btn-secondary" onClick={reset}>🔄 שלח בקשה נוספת</button>
      </div>
    </div>
  );

  return (
    <div className="form-page">
      <div className="form-card">
        <div className="form-card-header">
          <div style={{fontSize:40,marginBottom:10}}>🎬</div>
          <div style={{fontSize:24,fontWeight:900,color:"var(--accent)"}}>המחסן של קישקתא ונמרוד</div>
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
            <div style={{display:"flex",gap:12,marginBottom:24}}>
              {[{val:"פרטית",icon:"👤",desc:"שימוש אישי / לימודי"},{val:"הפקה",icon:"🎬",desc:"פרויקט הפקה מאורגן"}].map(opt=>(
                <div key={opt.val} onClick={()=>set("loan_type",opt.val)} style={{flex:1,padding:"16px",borderRadius:"var(--r)",background:form.loan_type===opt.val?"var(--accent-glow)":"var(--surface2)",border:`2px solid ${form.loan_type===opt.val?"var(--accent)":"var(--border)"}`,cursor:"pointer",textAlign:"center",transition:"all 0.15s"}}>
                  <div style={{fontSize:28,marginBottom:6}}>{opt.icon}</div>
                  <div style={{fontWeight:800,color:form.loan_type===opt.val?"var(--accent)":"var(--text)"}}>{`השאלה ${opt.val}`}</div>
                  <div style={{fontSize:12,color:"var(--text3)",marginTop:3}}>{opt.desc}</div>
                  {form.loan_type===opt.val&&<div style={{marginTop:6,fontSize:11,fontWeight:700,color:"var(--accent)"}}>✓ נבחר</div>}
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
            <div className="form-section-title">תאריכי השאלה</div>
            <div className="grid-2">
              <div className="form-group"><label className="form-label">תאריך השאלה *</label><input type="date" className="form-input" min={minDate} value={form.borrow_date} onChange={e=>set("borrow_date",e.target.value)}/></div>
              <div className="form-group"><label className="form-label">תאריך החזרה *</label><input type="date" className="form-input" min={form.borrow_date||today()} value={form.return_date} onChange={e=>set("return_date",e.target.value)}/></div>
            </div>
            {tooSoon && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 נדרשת התראה של שבוע לפחות. תאריך מוקדם ביותר: <strong>{formatDate(minDate)}</strong></div>}
            {ok2 && <div className="highlight-box">📅 השאלה ל-{Math.ceil((new Date(form.return_date)-new Date(form.borrow_date))/(86400000))+1} ימים</div>}
            <div className="flex gap-2"><button className="btn btn-secondary" onClick={()=>setStep(1)}>← חזור</button><button className="btn btn-primary" disabled={!ok2} onClick={()=>setStep(3)}>המשך ← ציוד</button></div>
          </>}

          {step===3 && <>
            <div className="form-section-title">בחירת ציוד</div>
            {CATEGORIES.map(c=>{
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
              <div>{items.map(i=><div key={i.equipment_id} className="req-detail-row"><span>{equipment.find(e=>e.id==i.equipment_id)?.image}</span><span>{i.name} × {i.quantity}</span></div>)}</div>
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
const ADMIN_PASSWORD = "camamama2";

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
        <div style={{fontSize:13,color:"var(--text3)",marginBottom:28}}>המחסן של קישקתא ונמרוד</div>
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
  const [loading, setLoading]         = useState(true);
  const [toasts, setToasts]           = useState([]);
  const [authed, setAuthed]           = useState(false);

  const showToast = (type, msg) => {
    const id = Date.now();
    setToasts(p=>[...p,{id,type,msg}]);
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)), 3500);
  };

  useEffect(()=>{
    (async()=>{
      const eq  = await storageGet("equipment");
      const res = await storageGet("reservations");
      setEquipment(eq  || INITIAL_EQUIPMENT);
      setReservations(res || []);
      if(!eq)  await storageSet("equipment",    INITIAL_EQUIPMENT);
      if(!res) await storageSet("reservations", []);
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
        <div style={{minHeight:"100vh",background:"var(--bg)"}}>
          {loading ? <Loading/> : <PublicForm equipment={equipment} reservations={reservations} setReservations={setReservations} showToast={showToast}/>}
        </div>
      )}

      {/* ── לוח ניהול עם סיסמה ── */}
      {isAdmin && !authed && <AdminLogin onSuccess={()=>setAuthed(true)}/>}

      {isAdmin && authed && (
        <div className="app">
          <nav className="sidebar">
            <div className="sidebar-logo">
              <span className="logo-icon">🎬</span>
              <div className="app-name">המחסן של<br/>קישקתא ונמרוד</div>
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
              {pending>0&&<div style={{background:"rgba(241,196,15,0.12)",border:"1px solid rgba(241,196,15,0.3)",borderRadius:8,padding:"6px 12px",fontSize:12,color:"var(--yellow)"}}>⏳ {pending} בקשות ממתינות</div>}
            </div>
            {loading ? <Loading/> : <>
              {page==="dashboard"   && <DashboardPage    equipment={equipment} reservations={reservations}/>}
              {page==="equipment"   && <EquipmentPage    equipment={equipment} reservations={reservations} setEquipment={setEquipment} showToast={showToast}/>}
              {page==="reservations"&& <ReservationsPage reservations={reservations} setReservations={setReservations} equipment={equipment} showToast={showToast}/>}
            </>}
          </div>
        </div>
      )}

      <Toast toasts={toasts}/>
    </>
  );
}