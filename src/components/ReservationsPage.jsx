import { supabase } from '../supabaseClient.js';
// ReservationsPage.jsx — admin reservations management page (includes rejected + archive tabs)
import { useEffect, useState } from "react";
import { storageGet, formatDate, getLoanDurationDays, formatLocalDateInput, today, toDateTime, getReservationApprovalConflicts, getConsecutiveBookingWarnings, RESEND_API_KEY, normalizeReservationsForArchive, markReservationReturned, getAvailable, getPrivateLoanLimitedQty, normalizeName, parseLocalDate, logActivity, getEffectiveStatus, cloudinaryThumb, updateReservationStatus, createReservation, deleteReservation as deleteReservationRpc, getAuthToken, syncReservationStatusToBlob } from "../utils.js";
import { Modal, statusBadge } from "./ui.jsx";
import { EditReservationModal } from "./EditReservationModal.jsx";
import { ArchivePage } from "./ArchivePage.jsx";
import { AlertTriangle, BookOpen, Briefcase, Camera, Calendar, CheckCircle, ClipboardList, Clock, FileText, Film, Mic, Package, Pencil, RotateCcw, Save, Trash2, User, X, XCircle } from "lucide-react";

// ── Staff Loan Form (module-scope component) ──
// איש צוות יוצר לעצמו בקשת השאלה. הטופס מזהה אוטומטית את המשתמש המחובר
// מתוך sessionStorage.staff_user. אם התאריכים לא חופפים עם השאלות קיימות,
// הבקשה עוברת מיידית ל-status="מאושר" עם loan_type="צוות". החזרה ידנית
// בלבד (לחיצה על כפתור "הוחזר"), ו-check-overdue.js לא יהפוך אותה ל"באיחור".
// IMPORTANT: declared at module scope (not inside ReservationsPage) so React
// keeps the same component type across parent re-renders. Previously it was
// an inner component, causing the entire form state to reset whenever the
// parent re-rendered (e.g. on a `showToast`/`setReservations` call inside
// mSave), which is exactly what happened when an overlap error came back.
function StaffLoanForm({ onClose, showToast, reservations, setReservations, teamMembers, equipment, categories }) {
  const ALL_TIME_SLOTS = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30","20:00","20:30","21:00"];
  // Identify the logged-in staff member from sessionStorage. Fall back to
  // teamMembers entry for phone (sessionStorage doesn't store phone).
  const staffUser = (() => {
    try { const s = sessionStorage.getItem("staff_user"); return s ? JSON.parse(s) : {}; } catch { return {}; }
  })();
  const staffTeamRow = (teamMembers||[]).find(m => (m.email||"").toLowerCase() === (staffUser.email||"").toLowerCase()) || {};
  const [mf, setMf] = useState({
    borrow_date: "",
    borrow_time: "",
    return_date: "",
    return_time: "",
  });
  const [mItems, setMItems] = useState([]);
  const [mSaving, setMSaving] = useState(false);
  const [mStep, setMStep] = useState(1);
  const mSet = (k,v) => setMf(p=>({...p,[k]:v}));
  const mSameDay = mf.borrow_date && mf.return_date && mf.borrow_date === mf.return_date;
  const mTimeOrderError = mSameDay && mf.borrow_time && mf.return_time && toDateTime(mf.return_date, mf.return_time) <= toDateTime(mf.borrow_date, mf.borrow_time);
  const mReturnBeforeBorrow = mf.borrow_date && mf.return_date && parseLocalDate(mf.return_date) < parseLocalDate(mf.borrow_date);
  const mOk1 = !!mf.borrow_date && !!mf.return_date && !!mf.borrow_time && !!mf.return_time && !mReturnBeforeBorrow && !mTimeOrderError;
  const mOk2 = mItems.some(i=>Number(i.quantity)>0);
  // No certification checks — staff can borrow any equipment.
  const mAvailEq = (mf.borrow_date&&mf.return_date) ? equipment.map(eq=>({...eq, avail: getAvailable(eq.id,mf.borrow_date,mf.return_date,reservations,equipment,null,mf.borrow_time,mf.return_time)})) : [];
  const mGetItem = id => mItems.find(i=>i.equipment_id==id)||{quantity:0};
  const mSetQty = (id,qty) => { const av=mAvailEq.find(e=>e.id==id)?.avail||0; const q=Math.max(0,Math.min(qty,av)); const nm=equipment.find(e=>e.id==id)?.name||""; setMItems(prev=>q===0?prev.filter(i=>i.equipment_id!=id):prev.find(i=>i.equipment_id==id)?prev.map(i=>i.equipment_id==id?{...i,quantity:q}:i):[...prev,{equipment_id:id,quantity:q,name:nm}]); };
  const [meqTypeF, setMeqTypeF] = useState("all");
  const [meqCatF, setMeqCatF] = useState([]);
  const [meqSearch, setMeqSearch] = useState("");
  const [mShowSelectedOnly, setMShowSelectedOnly] = useState(false);
  const mSelectedCount = mItems.reduce((s,i)=>s+(Number(i.quantity)||0),0);
  // Restrict date/time pickers to future only — staff can't book in the past.
  const todayStr = formatLocalDateInput(new Date());
  const nowMin = (() => { const d = new Date(); return d.getHours()*60 + d.getMinutes(); })();
  const timeToMin = t => { const [h,m]=(t||"0:0").split(":").map(Number); return (h||0)*60+(m||0); };
  const borrowMin = timeToMin(mf.borrow_time);
  const borrowTimeOptions = ALL_TIME_SLOTS.filter(t => mf.borrow_date !== todayStr || timeToMin(t) > nowMin);
  const returnTimeOptions = ALL_TIME_SLOTS.filter(t => {
    const tm = timeToMin(t);
    if (mf.return_date === todayStr && tm <= nowMin) return false;
    if (mSameDay && mf.borrow_time && tm <= borrowMin) return false;
    return true;
  });
  const mSave = async () => {
    if(!mOk1||!mOk2){showToast("error","יש להשלים את כל השדות");return;}
    if(!staffUser?.email){showToast("error","לא הצלחנו לזהות את המשתמש המחובר");return;}
    setMSaving(true);
    let freshRes=reservations;
    try{const fr=await (supabase.from("reservations_new").select("*, reservation_items(*)").then(res => (res.data || []).map(r => ({ ...r, items: r.reservation_items || [] }))));if(Array.isArray(fr)){freshRes=fr;setReservations(fr);}}catch(e){}
    // Route through the atomic RPC (create_reservation_v2, migration 008).
    // The RPC locks equipment rows with FOR UPDATE and does a date-range
    // overlap check. If any requested item overlaps an existing active
    // reservation, the RPC rejects with 409 "not_enough_stock" — which is
    // exactly the overbooking guarantee the user asked for.
    const clientId = String(Date.now());
    const submittedAtIso = new Date().toISOString();
    const staffName = staffUser.full_name || staffTeamRow.name || staffUser.email;
    const staffPhone = staffTeamRow.phone || "";
    const rpcResult = await createReservation(
      {
        id:                      clientId,
        student_name:            staffName,
        email:                   staffUser.email,
        phone:                   staffPhone,
        course:                  "צוות",
        project_name:            null,
        loan_type:               "צוות",
        status:                  "מאושר",
        borrow_date:             mf.borrow_date,
        borrow_time:             mf.borrow_time,
        return_date:             mf.return_date,
        return_time:             mf.return_time,
        created_at:              today(),
        submitted_at:            submittedAtIso,
      },
      mItems.map(it => ({
        equipment_id: it.equipment_id,
        name:         it.name,
        quantity:     Number(it.quantity) || 1,
        unit_id:      it.unit_id || null,
      }))
    );
    if (!rpcResult.ok) {
      setMSaving(false);
      if (rpcResult.error === "not_enough_stock") {
        showToast("error", "התאריכים חופפים עם השאלה קיימת — נא לבחור תאריכים אחרים");
      } else {
        console.error("StaffLoanForm create failed:", rpcResult);
        showToast("error", "שגיאה בשמירת הבקשה. נסה שוב.");
      }
      return;
    }
    // Mirror the new row into local state + blob cache so the list
    // refreshes immediately. The DB is already the source of truth.
    const serverId = rpcResult.id || clientId;
    const newRes = {
      id:              serverId,
      student_name:    staffName,
      email:           staffUser.email,
      phone:           staffPhone,
      course:          "צוות",
      project_name:    null,
      loan_type:       "צוות",
      status:          "מאושר",
      borrow_date:     mf.borrow_date,
      borrow_time:     mf.borrow_time,
      return_date:     mf.return_date,
      return_time:     mf.return_time,
      created_at:      today(),
      submitted_at:    new Date().toLocaleString("he-IL",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Jerusalem"}),
      items:           mItems,
      staff_loan:      true,
    };
    const updated = [...freshRes, newRes];
    setReservations(updated);
    // blob write removed (Stage 5) — DB already written via createReservation RPC
    logActivity({ user_id: staffUser.id, user_name: staffName, action: "staff_loan_create", entity: "reservation", entity_id: String(serverId), details: { borrow_date: mf.borrow_date, return_date: mf.return_date, items_count: mItems.length } });
    setMSaving(false);
    showToast("success", `השאלת איש צוות נוצרה ואושרה · ${staffName}`);
    onClose();
  };
  return (
    <Modal title="💼 השאלת איש צוות" onClose={onClose} size="modal-lg">
      {/* Identification badge */}
      <div style={{background:"rgba(100,120,150,0.12)",border:"1px solid rgba(100,120,150,0.3)",borderRadius:"var(--r-sm)",padding:"10px 14px",marginBottom:16,display:"flex",alignItems:"center",gap:10,fontSize:13}}>
        <Briefcase size={22} strokeWidth={1.5} color="var(--text2)" />
        <div>
          <div style={{fontWeight:800}}>{staffUser.full_name || staffTeamRow.name || "—"}</div>
          <div style={{fontSize:11,color:"var(--text3)"}}>{staffUser.email || ""}</div>
        </div>
        <div style={{marginRight:"auto",fontSize:11,color:"var(--text3)"}}>
          הבקשה תאושר אוטומטית אם התאריכים פנויים. החזרה ידנית בלבד.
        </div>
      </div>
      <div style={{display:"flex",gap:4,background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:4,marginBottom:16}}>
        {[{n:1,l:"תאריכים",i:<Calendar size={14} strokeWidth={1.75} color="var(--accent)" />},{n:2,l:"ציוד",i:<Package size={14} strokeWidth={1.75} color="var(--accent)" />},{n:3,l:"סיכום",i:<CheckCircle size={14} strokeWidth={1.75} color="var(--accent)" />}].map(s=>(
          <button key={s.n} type="button" onClick={()=>setMStep(s.n)} style={{flex:1,padding:"8px 4px",borderRadius:6,border:"none",background:mStep===s.n?"var(--accent)":"transparent",color:mStep===s.n?"#000":"var(--text2)",fontWeight:mStep===s.n?800:500,fontSize:12,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span style={{fontSize:14}}>{s.i}</span><span>{s.l}</span></button>))}
      </div>
      {mStep===1&&<>
        <div className="form-section-title">תאריכים ושעות <span style={{fontSize:11,color:"var(--text3)",fontWeight:400}}>· ללא מגבלות</span></div>
        <div className="grid-2">
          <div className="form-group"><label className="form-label"><Calendar size={14} strokeWidth={1.75} color="var(--accent)" /> תאריך השאלה *</label><input type="date" className="form-input" min={todayStr} value={mf.borrow_date} onChange={e=>mSet("borrow_date",e.target.value)}/></div>
          <div className="form-group"><label className="form-label">שעת איסוף *</label><select className="form-select" value={mf.borrow_time} onChange={e=>mSet("borrow_time",e.target.value)}><option value="">-- בחר --</option>{borrowTimeOptions.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
        </div>
        <div className="grid-2">
          <div className="form-group"><label className="form-label"><Calendar size={14} strokeWidth={1.75} color="var(--accent)" /> תאריך החזרה *</label><input type="date" className="form-input" min={mf.borrow_date || todayStr} value={mf.return_date} onChange={e=>mSet("return_date",e.target.value)}/></div>
          <div className="form-group"><label className="form-label">שעת החזרה *</label><select className="form-select" value={mf.return_time} onChange={e=>mSet("return_time",e.target.value)}><option value="">-- בחר --</option>{returnTimeOptions.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
        </div>
        {mTimeOrderError&&<div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"10px 14px",marginBottom:12,fontSize:12}}><XCircle size={14} strokeWidth={1.75} color="var(--red)" /> שעת החזרה חייבת להיות אחרי שעת האיסוף.</div>}
        {mReturnBeforeBorrow&&<div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"10px 14px",marginBottom:12,fontSize:12}}><XCircle size={14} strokeWidth={1.75} color="var(--red)" /> תאריך החזרה חייב להיות אחרי תאריך ההשאלה.</div>}
        <button className="btn btn-primary" disabled={!mOk1} onClick={()=>setMStep(2)}>המשך ← ציוד</button>
      </>}
      {mStep===2&&<>
        <div className="form-section-title">בחירת ציוד</div>
        <div style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"10px 12px",marginBottom:12}}>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8,alignItems:"center"}}>
            <span style={{fontSize:11,fontWeight:800,color:"var(--text3)"}}>סינון:</span>
            <button type="button" onClick={()=>setMShowSelectedOnly(p=>!p)}
              style={{padding:"5px 12px",borderRadius:20,border:`2px solid ${mShowSelectedOnly?"var(--green)":"var(--border)"}`,background:mShowSelectedOnly?"rgba(46,204,113,0.12)":"transparent",color:mShowSelectedOnly?"var(--green)":"var(--text3)",fontWeight:700,fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}>
              {mShowSelectedOnly?<><CheckCircle size={14} strokeWidth={1.75} /> נבחרו</>:"⬜"} {mShowSelectedOnly?"הצג הכל":`הצג נבחרים בלבד${mSelectedCount>0?` (${mSelectedCount})`:""}`}
            </button>
            <span style={{width:1,height:16,background:"var(--border)",flexShrink:0}}/>
            {[{k:"all",l:<><Package size={12} strokeWidth={1.75} color="var(--accent)" /> הכל</>},{k:"sound",l:<><Mic size={12} strokeWidth={1.75} color="var(--accent)" /> סאונד</>},{k:"photo",l:<><Camera size={12} strokeWidth={1.75} color="var(--accent)" /> צילום</>}].map(({k,l})=>(<button key={k} type="button" onClick={()=>setMeqTypeF(k)} style={{padding:"4px 10px",borderRadius:20,border:`2px solid ${meqTypeF===k?"var(--accent)":"var(--border)"}`,background:meqTypeF===k?"var(--accent-glow)":"transparent",color:meqTypeF===k?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:11,cursor:"pointer"}}>{l}</button>))}
            <span style={{width:1,height:16,background:"var(--border)",flexShrink:0}}/>
            {(categories||[]).map(cat=>(<button key={cat} type="button" onClick={()=>setMeqCatF(p=>p.includes(cat)?p.filter(c=>c!==cat):[...p,cat])} style={{padding:"4px 8px",borderRadius:20,border:`2px solid ${meqCatF.includes(cat)?"var(--accent)":"var(--border)"}`,background:meqCatF.includes(cat)?"var(--accent-glow)":"transparent",color:meqCatF.includes(cat)?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}>{cat}</button>))}
            {meqCatF.length>0&&<button type="button" onClick={()=>setMeqCatF([])} style={{padding:"4px 8px",borderRadius:20,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:11,cursor:"pointer"}}><X size={12} strokeWidth={1.75} color="var(--text3)" /> נקה</button>}
          </div>
          <div className="search-bar" style={{minWidth:150}}><span>🔍</span><input placeholder="חיפוש ציוד..." value={meqSearch} onChange={e=>setMeqSearch(e.target.value)}/></div>
        </div>
        {(()=>{
          const meqMatch=(e)=>{const g=(!e.soundOnly&&!e.photoOnly)||(e.soundOnly&&e.photoOnly);return meqTypeF==="all"||(meqTypeF==="sound"&&(e.soundOnly||g))||(meqTypeF==="photo"&&(e.photoOnly||g));};
          const mSelectedFilter=(e)=>!mShowSelectedOnly || (mGetItem(e.id)?.quantity||0) > 0;
          const visCats=(meqCatF.length>0?meqCatF:(categories||[])).filter(cat=>mAvailEq.some(e=>e.category===cat&&meqMatch(e)&&mSelectedFilter(e)&&(!meqSearch||e.name.includes(meqSearch))));
          if(!visCats.length)return <div style={{textAlign:"center",color:"var(--text3)",padding:16,fontSize:13}}>{mShowSelectedOnly?"עדיין לא בחרת ציוד":"לא נמצא ציוד תואם"}</div>;
          return visCats.map(cat=>{
            const catEq=mAvailEq.filter(e=>e.category===cat&&meqMatch(e)&&mSelectedFilter(e)&&(!meqSearch||e.name.includes(meqSearch)));
            if(!catEq.length)return null;
            return (<div key={cat} style={{marginBottom:10}}>
              <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",marginBottom:5,textTransform:"uppercase",letterSpacing:1}}>{cat}</div>
              {catEq.map(eq=>{const av=eq.avail,qty=mGetItem(eq.id)?.quantity||0;
                return (<div key={eq.id} className="item-row" style={{marginBottom:4,opacity:av===0?0.4:1,background:qty>0?"rgba(245,166,35,0.05)":"",border:qty>0?"1px solid rgba(245,166,35,0.2)":""}}>
                  <span style={{fontSize:20}}>{eq.image?.startsWith("data:")||eq.image?.startsWith("http")?<img src={cloudinaryThumb(eq.image)} alt="" style={{width:24,height:24,objectFit:"cover",borderRadius:4}}/>:eq.image||<Package size={16} strokeWidth={1.75} />}</span>
                  <div style={{flex:1,fontSize:13,fontWeight:600}}>{eq.name}<span style={{fontSize:11,color:"var(--text3)",marginRight:6,fontWeight:400}}>זמין: {av}</span></div>
                  {av>0?<div className="qty-ctrl"><button className="qty-btn" onClick={()=>mSetQty(eq.id,qty-1)}>−</button><span className="qty-num" style={{color:qty>0?"var(--accent)":"inherit"}}>{qty}</span><button className="qty-btn" disabled={qty>=av} onClick={()=>mSetQty(eq.id,qty+1)} style={{opacity:qty>=av?0.3:1}}>+</button></div>
                  :<span style={{fontSize:11,color:"var(--red)",fontWeight:700}}>אין מלאי</span>}
                </div>);})}
            </div>);});
        })()}
        {mItems.length>0&&<div className="highlight-box" style={{marginTop:8}}><Package size={14} strokeWidth={1.75} color="var(--accent)" /> {mItems.length} סוגי ציוד · {mItems.reduce((s,i)=>s+i.quantity,0)} יחידות</div>}
        <div className="flex gap-2" style={{marginTop:16}}><button className="btn btn-secondary" onClick={()=>setMStep(1)}>← חזור</button><button className="btn btn-primary" disabled={!mOk2} onClick={()=>setMStep(3)}>המשך ← סיכום</button></div>
      </>}
      {mStep===3&&<>
        <div className="form-section-title">סיכום ההשאלה</div>
        <div style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16}}>
          {[["שם",staffUser.full_name || staffTeamRow.name || ""],["אימייל",staffUser.email || ""],["סוג","💼 השאלת איש צוות"],["תאריך השאלה",mf.borrow_date?formatDate(mf.borrow_date)+" · "+mf.borrow_time:""],["תאריך החזרה",mf.return_date?formatDate(mf.return_date)+" · "+mf.return_time:""],["סטטוס",<><CheckCircle size={14} strokeWidth={1.75} color="var(--green)" /> מאושר (אוטומטי)</>]].filter(([,v])=>v).map(([l,v])=>(
            <div key={l} style={{display:"flex",gap:8,marginBottom:6,fontSize:13}}><span style={{color:"var(--text3)",minWidth:100}}>{l}:</span><strong>{v}</strong></div>))}
          <div style={{marginTop:10,fontWeight:700,fontSize:13}}>ציוד ({mItems.reduce((s,i)=>s+i.quantity,0)} יחידות):</div>
          {mItems.map(i=><div key={i.equipment_id} style={{fontSize:12,color:"var(--text2)",marginTop:4}}>• {i.name} ×{i.quantity}</div>)}
        </div>
        <div className="flex gap-2"><button className="btn btn-secondary" onClick={()=>setMStep(2)}>← חזור</button>
          <button className="btn btn-primary" disabled={mSaving||!mOk1||!mOk2} onClick={mSave} style={{fontSize:15,padding:"12px 28px"}}>{mSaving?<><Clock size={16} strokeWidth={1.75} /> שומר...</>:<><Save size={16} strokeWidth={1.75} /> צור השאלה</>}</button></div>
      </>}
    </Modal>
  );
}

export function ReservationsPage({ reservations, setReservations, equipment, showToast,
    search, setSearch, statusF, setStatusF, loanTypeF, setLoanTypeF, sortBy, setSortBy, mode="active", initialSubView="active", collegeManager={}, managerToken="",
    categories=[], certifications={types:[],students:[]}, kits=[], teamMembers=[], deptHeads=[], siteSettings={}, onLogCreated = () => {}, equipmentReports=[] }) {
  const [subView, setSubView] = useState("active"); // "active" | "rejected" | "archive"
  const [selected, setSelected] = useState(null);
  // Keep the open modal's data in sync with background polling updates.
  // Without this, `selected` holds a snapshot from the moment the card was
  // clicked — if the `items` array was still empty then (FK rows hadn't
  // landed yet via the nested select), the modal would display "0 פריטים"
  // forever, even after `reservations` refreshed with the real items.
  useEffect(() => {
    if (!selected) return;
    const fresh = reservations.find(r => String(r.id) === String(selected.id));
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [reservations]);
  const [editing, setEditing]   = useState(null);
  const [approvalConflict, setApprovalConflict] = useState(null);
  const [consecutiveWarning, setConsecutiveWarning] = useState(null); // {reservation, warnings}
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [showManualForm, setShowManualForm] = useState(false);
  const [overdueEmailText, setOverdueEmailText] = useState("");
  const [overdueEmailSending, setOverdueEmailSending] = useState(false);
  useEffect(() => {
    setSubView(initialSubView === "archive" ? "archive" : initialSubView === "rejected" ? "rejected" : "active");
  }, [initialSubView]);
  const isRejectedPage = subView === "rejected";
  const rejectedCount = reservations.filter(r=>r.status==="נדחה"||r.status==="באיחור").length;
  const archivedCount = reservations.filter(r=>r.status==="הוחזר").length;
  const effectiveStatusFilter = isRejectedPage
    ? (["הכל","נדחה","באיחור"].includes(statusF) ? statusF : "הכל")
    : (["הכל","ממתין","אישור ראש מחלקה","מאושר","פעילה"].includes(statusF) ? statusF : "הכל");

  const filtered = [...reservations]
    .filter(r => {
      if (isRejectedPage) {
        if (r.status !== "נדחה" && r.status !== "באיחור") return false;
        if (effectiveStatusFilter !== "הכל" && r.status !== effectiveStatusFilter) return false;
      } else {
        if (r.status === "הוחזר" || r.status === "נדחה" || r.status === "באיחור") return false;
        if (effectiveStatusFilter !== "הכל") {
          if (getEffectiveStatus(r) !== effectiveStatusFilter) return false;
        }
      }
      return (loanTypeF==="הכל" || r.loan_type===loanTypeF) &&
        (r.student_name?.includes(search) || r.email?.includes(search));
    })
    .sort((a,b) => {
      if(sortBy==="urgency")  return new Date(a.borrow_date) - new Date(b.borrow_date);
      if(sortBy==="received") {
        const idA = Number(a.id), idB = Number(b.id);
        if(!isNaN(idA) && !isNaN(idB) && idB !== idA) return idB - idA;
        const da = a.created_at||"0000-00-00", db = b.created_at||"0000-00-00";
        return db > da ? 1 : db < da ? -1 : 0;
      }
      return 0;
    });
  const eqName = id => equipment.find(e=>e.id==id)?.name||"?";
  const eqIcon = id => equipment.find(e=>e.id==id)?.image||null;
  const EqImg = ({id, size=22}) => {
    const img = equipment.find(e=>e.id==id)?.image||null;
    if (!img) return <Package size={size} strokeWidth={1.75} />;
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
      .badge{display:inline-block;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700;background:${r.status==="מאושר"?"#d4f5e9;color:#1a7a4a":r.status==="ממתין"?"#fff8e1;color:#b8860b":r.status==="נדחה"?"#fde8e8;color:#c0392b":r.status==="באיחור"?"#fef0e1;color:#e67e22":"#e8f4fd;color:#2471a3"}}
      .footer{margin-top:40px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#999;text-align:center}
      @media print{body{padding:20px}}
    </style></head><body>
    <h1>אישור בקשת השאלה</h1>
    <div class="sub">מכללת קמרה אובסקורה וסאונד — הופק ב-${new Date().toLocaleDateString("he-IL")}</div>
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
    const res = reservations.find(r => r.id === id);
    const updated = reservations.filter(r => r.id !== id);
    // Optimistic UI — close modal + toast immediately, persist atomically via RPC.
    // The old path used fire-and-forget storageSet('reservations', list),
    // which took 2–14s across backup-write + real-write + mirror. During that
    // window, the 3-min poll or realtime listener could see the stale row and
    // briefly re-insert the card ("trash-button flicker"). `deleteReservation`
    // (utils.js → /api/delete-reservation → delete_reservation_v1) runs the
    // normalized delete + JSON strip + available_units recompute in one txn,
    // so any subsequent listener sees the consistent post-delete state.
    setReservations(updated);
    setSelected(null);
    showToast("success", "הבקשה נמחקה");
    const caller = JSON.parse(sessionStorage.getItem("staff_user")||"{}");
    const rpc = await deleteReservationRpc(id);
    if (!rpc.ok) {
      console.error("deleteReservation RPC failed:", rpc);
      showToast("error", "המחיקה נכשלה בשרת — הפריט עלול לחזור לאחר ריענון");
      // Revert optimistic removal so the UI matches server truth on next poll.
      if (res) setReservations(prev => prev.some(r => r.id === id) ? prev : [...prev, res]);
      return;
    }
    logActivity({ user_id: caller.id, user_name: caller.full_name, action: "reservation_delete", entity: "reservation", entity_id: String(id), details: { student: res?.student_name, loan_type: res?.loan_type, rpc_source: rpc.source } })
      .then(logId => onLogCreated(logId))
      .catch(err => console.error("delete reservation log failed:", err));
  };

  const sendStatusEmail = async (reservation, status) => {
    if (!reservation?.email || (status !== "מאושר" && status !== "נדחה")) return;
    const itemsList = reservation.items?.map(i => `<tr><td style="padding:7px 12px;color:#e8eaf0;border-bottom:1px solid #1e2130">${i.name || eqName(i.equipment_id)}</td><td style="padding:7px 12px;text-align:center;color:#f5a623;font-weight:700;border-bottom:1px solid #1e2130">${i.quantity}</td></tr>`).join("") || "";
    try {
      const tokSt = await getAuthToken();
      await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(tokSt ? { Authorization: `Bearer ${tokSt}` } : {}) },
        body: JSON.stringify({
          to:           reservation.email,
          type:         status === "מאושר" ? "approved" : "rejected",
          student_name: reservation.student_name,
          items_list:   itemsList,
          borrow_date:  formatDate(reservation.borrow_date),
          borrow_time:  reservation.borrow_time || "",
          return_date:  formatDate(reservation.return_date),
          return_time:  reservation.return_time || "",
          logo_url: siteSettings.logo || "",
          sound_logo_url: siteSettings.soundLogo || "",
        }),
      });
      showToast("success", `📧 מייל נשלח ל-${reservation.email}`);
    } catch {
      showToast("error", "שגיאה בשליחת המייל");
    }
  };

  const doApprove = async (reservationToApprove) => {
    // Debounce: if a click for this id is already in flight, ignore.
    if (busyIds.has(reservationToApprove.id)) return false;
    setBusyIds(prev => { const n = new Set(prev); n.add(reservationToApprove.id); return n; });
    try {
      // Route through the atomic RPC (migration 009). The FOR UPDATE lock
      // serializes concurrent approvers; rpcResult.changed is true only for
      // the one caller that actually flipped the status.
      const rpcResult = await updateReservationStatus(reservationToApprove.id, "מאושר");
      if (!rpcResult.ok) {
        console.error("doApprove RPC failed:", rpcResult);
        showToast("error", "שגיאה באישור הבקשה בשרת");
        return false;
      }
      // Optimistic update from local (possibly stale) state — UI flips to מאושר
      // right away. Blob sync below refreshes from the server to avoid tripping
      // shrink_guard when students have submitted since page load.
      setReservations(normalizeReservationsForArchive(reservations.map((r) =>
        r.id === reservationToApprove.id ? { ...reservationToApprove, status: "מאושר" } : r
      )));
      const sync = await syncReservationStatusToBlob(reservationToApprove.id, "מאושר");
      if (!sync.ok) {
        console.error("doApprove: blob sync failed", sync);
        showToast("error", "האישור נשמר ב-DB אך כתיבה ל-blob נכשלה — רענן את הדף");
      } else {
        setReservations(normalizeReservationsForArchive(sync.list));
      }
      // Only email + log the activity for the caller that actually changed the status.
      if (rpcResult.changed) {
        await sendStatusEmail({ ...reservationToApprove, status: "מאושר" }, "מאושר");
        const caller = JSON.parse(sessionStorage.getItem("staff_user")||"{}");
        logActivity({ user_id: caller.id, user_name: caller.full_name, action: "reservation_approve", entity: "reservation", entity_id: String(reservationToApprove.id), details: { student: reservationToApprove.student_name, loan_type: reservationToApprove.loan_type } });
      }
      if (sync.ok) showToast("success", "הבקשה אושרה");
      setSelected(null);
      setConsecutiveWarning(null);
      return true;
    } finally {
      setBusyIds(prev => { const n = new Set(prev); n.delete(reservationToApprove.id); return n; });
    }
  };

  const approveReservation = async (reservationToApprove, skipConsecutiveCheck=false) => {
    // 1) Hard block — not enough inventory (overdue / overlapping)
    const conflicts = getReservationApprovalConflicts(reservationToApprove, reservations, equipment);
    if (conflicts.length) {
      const hasOverdueBlock = conflicts.some(c => c.blockers.some(b => b.status === "באיחור"));
      setApprovalConflict({ reservation: reservationToApprove, conflicts });
      showToast("error", hasOverdueBlock ? "לא ניתן לאשר — ציוד נמצא באיחור אצל סטודנט אחר" : "לא ניתן לאשר - אין מספיק מלאי בחפיפת הזמנים");
      return false;
    }

    // 2) Soft warning — consecutive bookings with tight gap (allow override)
    if (!skipConsecutiveCheck) {
      const warnings = getConsecutiveBookingWarnings(reservationToApprove, reservations, equipment);
      if (warnings.length) {
        setConsecutiveWarning({ reservation: reservationToApprove, warnings });
        return false;
      }
    }

    return doApprove(reservationToApprove);
  };

  const updateStatus = async (id, status) => {
    const res = reservations.find(r=>r.id===id);
    if (!res) return;

    if (status === "מאושר") return approveReservation({ ...res, status: "מאושר" });

    // Debounce: ignore repeated clicks on the same row while RPC is in flight.
    if (busyIds.has(id)) return false;
    setBusyIds(prev => { const n = new Set(prev); n.add(id); return n; });
    try {
      // Route through the atomic RPC (migration 009). For "הוחזר" we also
      // pass returned_at so the DB stores the return timestamp, matching what
      // markReservationReturned does in local state.
      const returnedAt = status === "הוחזר" ? new Date().toISOString() : null;
      const rpcResult = await updateReservationStatus(id, status, { returned_at: returnedAt });
      if (!rpcResult.ok) {
        console.error("updateStatus RPC failed:", rpcResult);
        showToast("error", "שגיאה בעדכון הסטטוס בשרת");
        return false;
      }
      const updated = normalizeReservationsForArchive(reservations.map((r) => {
        if (r.id !== id) return r;
        return status === "הוחזר" ? markReservationReturned(r) : { ...r, status };
      }));
      setReservations(updated);
      showToast("success", `סטטוס עודכן ל-${status}`);
      // blob sync removed (Stage 5) — RPC already updated DB, local state is set above
      // Only email / log when this click was the one that actually flipped the status.
      if (rpcResult.changed) {
        if (status === "נדחה") await sendStatusEmail({ ...res, status: "נדחה" }, "נדחה");
        const caller = JSON.parse(sessionStorage.getItem("staff_user")||"{}");
        const actionMap = { "נדחה": "reservation_reject", "הוחזר": "reservation_return" };
        if (actionMap[status]) {
          logActivity({ user_id: caller.id, user_name: caller.full_name, action: actionMap[status], entity: "reservation", entity_id: String(id), details: { student: res.student_name, loan_type: res.loan_type } });
        }
      }
      setSelected(null);
      return true;
    } finally {
      setBusyIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const sendOverdueManualEmail = async (reservation, text) => {
    if (!reservation?.email || !text.trim()) return;
    setOverdueEmailSending(true);
    try {
      const tokOdm = await getAuthToken();
      await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(tokOdm ? { Authorization: `Bearer ${tokOdm}` } : {}) },
        body: JSON.stringify({
          to: reservation.email,
          type: "overdue",
          student_name: reservation.student_name,
          borrow_date: formatDate(reservation.borrow_date),
          return_date: formatDate(reservation.return_date),
          return_time: reservation.return_time || "",
          custom_message: text.trim(),
          logo_url: siteSettings.logo || "",
          sound_logo_url: siteSettings.soundLogo || "",
        }),
      });
      showToast("success", `📧 מייל תזכורת נשלח ל-${reservation.email}`);
      setOverdueEmailText("");
    } catch {
      showToast("error", "שגיאה בשליחת המייל");
    } finally {
      setOverdueEmailSending(false);
    }
  };

  // Stage 5 — persist EditReservationModal changes directly to Supabase
  const saveEditedReservation = async (updated) => {
    const { items: updatedItems, reservation_items: _ri, ...rowFields } = updated;
    const { error: updErr } = await supabase.from("reservations_new").update({
      student_name:  rowFields.student_name,
      email:         rowFields.email,
      phone:         rowFields.phone,
      course:        rowFields.course,
      project_name:  rowFields.project_name || null,
      loan_type:     rowFields.loan_type,
      borrow_date:   rowFields.borrow_date,
      return_date:   rowFields.return_date,
      borrow_time:   rowFields.borrow_time,
      return_time:   rowFields.return_time,
      overdue_student_note: rowFields.overdue_student_note || null,
    }).eq("id", updated.id);
    if (updErr) {
      console.error("saveEditedReservation update error:", updErr);
      showToast("error", "שגיאה בעדכון הבקשה: " + (updErr.message || "לא ידוע"));
      return;
    }
    if (updatedItems) {
      const { error: delErr } = await supabase.from("reservation_items").delete().eq("reservation_id", updated.id);
      if (delErr) {
        console.error("saveEditedReservation delete items error:", delErr);
        showToast("error", "שגיאה במחיקת הפריטים הישנים: " + (delErr.message || "לא ידוע"));
        return;
      }
      if (updatedItems.length) {
        const { error: insErr } = await supabase.from("reservation_items").insert(
          updatedItems.map(i => ({
            reservation_id: updated.id,
            equipment_id:   i.equipment_id,
            name:           i.name || "",
            quantity:       Number(i.quantity) || 1,
            unit_id:        i.unit_id || null,
          }))
        );
        if (insErr) {
          console.error("saveEditedReservation insert items error:", insErr);
          showToast("error", "שגיאה בהוספת הפריטים החדשים: " + (insErr.message || "לא ידוע"));
          return;
        }
      }
    }
    const all = normalizeReservationsForArchive(reservations.map(r => r.id === updated.id ? updated : r));
    setReservations(all);
    showToast("success", "הבקשה עודכנה");
    setEditing(null);
  };

  const studentReqs = filtered.filter(r => r.loan_type !== "שיעור" && r.loan_type !== "צוות");
  const lessonReqs  = filtered.filter(r => r.loan_type === "שיעור");
  const staffReqs   = filtered.filter(r => r.loan_type === "צוות");
  const renderResCard = (r) => {
            const isLesson = r.loan_type==="שיעור";
            const isCinema = r.loan_type==="קולנוע יומית";
            const isStaff  = r.loan_type==="צוות";
            const isOverdue = r.status==="באיחור";
            const loanColor = isOverdue?"rgba(230,126,34,0.08)":isStaff?"rgba(100,120,150,0.10)":isLesson?"rgba(155,89,182,0.12)":isCinema?"rgba(52,152,219,0.08)":r.loan_type==="הפקה"?"rgba(52,152,219,0.06)":r.loan_type==="סאונד"?"rgba(245,166,35,0.06)":"var(--surface)";
            const loanBorder = isOverdue?"1px solid rgba(230,126,34,0.5)":isStaff?"1px solid rgba(100,120,150,0.35)":isLesson?"1px solid rgba(155,89,182,0.35)":isCinema?"1px solid rgba(52,152,219,0.3)":r.loan_type==="הפקה"?"1px solid rgba(52,152,219,0.2)":"1px solid var(--border)";
            const loanIcon = isStaff?<Briefcase size={12} strokeWidth={1.75} color="var(--text3)" />:isLesson?<Film size={12} strokeWidth={1.75} color="var(--accent)" />:isCinema?<Camera size={12} strokeWidth={1.75} color="var(--accent)" />:r.loan_type==="פרטית"?<User size={12} strokeWidth={1.75} color="var(--text2)" />:r.loan_type==="הפקה"?<Film size={12} strokeWidth={1.75} color="var(--accent)" />:<Mic size={12} strokeWidth={1.75} color="var(--accent)" />;
            const loanLabel = isStaff?"השאלת איש צוות":isLesson?"השאלת שיעור":isCinema?"קולנוע יומית":r.loan_type==="סאונד"?"השאלת סאונד":`השאלה ${r.loan_type}`;
            return (
            <div key={r.id} className="res-card"
              style={{background:loanColor,border:loanBorder,cursor:"pointer"}}
              onClick={()=>setSelected(selected?.id===r.id?null:r)}
              onMouseEnter={e=>e.currentTarget.style.borderColor=isOverdue?"#e67e22":isStaff?"rgba(100,120,150,0.7)":isLesson?"rgba(155,89,182,0.7)":"var(--accent)"}
              onMouseLeave={e=>e.currentTarget.style.borderColor=isOverdue?"rgba(230,126,34,0.5)":isStaff?"rgba(100,120,150,0.35)":isLesson?"rgba(155,89,182,0.35)":"var(--border)"}>
              <div className="res-card-top">
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:38,height:38,borderRadius:"50%",background:isOverdue?"rgba(230,126,34,0.2)":isStaff?"rgba(100,120,150,0.22)":isLesson?"rgba(155,89,182,0.2)":"var(--surface3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:900,flexShrink:0,color:isOverdue?"#e67e22":isStaff?"#6a7d95":isLesson?"#9b59b6":"inherit"}}>
                    {isOverdue?<AlertTriangle size={16} strokeWidth={1.75} color="#e67e22" />:isStaff?<Briefcase size={16} strokeWidth={1.75} color="#6a7d95" />:isLesson?<Film size={16} strokeWidth={1.75} color="var(--accent)" />:r.student_name?.[0]||"?"}
                  </div>
                  <div>
                    <div style={{fontWeight:700,fontSize:15}}>{r.student_name}</div>
                    <div style={{fontSize:11,color:"var(--text3)"}}>{r.email}</div>
                  </div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  {equipmentReports.some(rp=>rp.reservation_id===String(r.id)&&rp.status==="open")&&<AlertTriangle size={14} strokeWidth={1.75} color="#e74c3c" title="דיווח תקלה פתוח" />}
                  {statusBadge(getEffectiveStatus(r))}
                  <span style={{fontSize:11,color:"var(--text3)"}}>{formatDate(r.created_at)}</span>
                </div>
              </div>
              <div className="res-card-mid">
                <div style={{display:"flex",gap:16,fontSize:12,color:"var(--text2)",flexWrap:"wrap"}}>
                  <span><Clock size={12} strokeWidth={1.75} color="var(--accent)" /> {getLoanDurationDays(r.borrow_date, r.return_date)} ימים</span>
                  <span><BookOpen size={12} strokeWidth={1.75} color="var(--accent)" /> {r.course}</span>
                  <span><Calendar size={12} strokeWidth={1.75} color="var(--accent)" /> {formatDate(r.borrow_date)}{r.borrow_time&&<span style={{color:"var(--accent)",marginRight:4,fontWeight:700}}> {r.borrow_time}</span>} ← {formatDate(r.return_date)}{r.return_time&&<span style={{color:"var(--accent)",marginRight:4,fontWeight:700}}> {r.return_time}</span>}{(()=>{const diff=Math.ceil((new Date(r.borrow_date)-new Date())/(1000*60*60*24));return diff>0?<span style={{marginRight:6,color:"var(--yellow)",fontWeight:700}}>({diff} ימים)</span>:diff===0?<span style={{marginRight:6,color:"var(--green)",fontWeight:700}}>(היום!)</span>:null;})()}</span>
                  <span><Package size={12} strokeWidth={1.75} color="var(--accent)" /> {r.items?.length||0} פריטים</span>
                  {r.loan_type&&<span style={{background:isStaff?"rgba(100,120,150,0.2)":isLesson?"rgba(155,89,182,0.2)":"var(--surface3)",border:isStaff?"1px solid rgba(100,120,150,0.4)":isLesson?"1px solid rgba(155,89,182,0.4)":"1px solid var(--border)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700,color:isStaff?"#8a9bb3":isLesson?"#9b59b6":"var(--accent)"}}>
                    {loanIcon} {loanLabel}
                  </span>}
                </div>
                <div style={{marginTop:8,display:"flex",flexWrap:"wrap",gap:4}}>
                  {r.items?.slice(0,3).map((i,j)=><span key={j} className="chip"><EqImg id={i.equipment_id} size={13}/> {eqName(i.equipment_id)} ×{i.quantity}</span>)}
                  {(r.items?.length||0)>3&&<span className="chip">+{r.items.length-3} נוספים</span>}
                </div>
              </div>
              <div className="res-card-actions" onClick={e=>e.stopPropagation()}>
                <button className="btn btn-secondary btn-sm" onClick={()=>exportPDF(r)}><><FileText size={14} strokeWidth={1.75} /> PDF</></button>
                {(r.status==="ממתין"||r.status==="מאושר"||r.status==="נדחה"||r.status==="באיחור")&&<button className="btn btn-secondary btn-sm" onClick={()=>setEditing(r)}><><Pencil size={14} strokeWidth={1.75} /> עריכת בקשה</></button>}
                {r.status==="ממתין"&&<><button className="btn btn-success btn-sm" disabled={busyIds.has(r.id)} onClick={()=>updateStatus(r.id,"מאושר")}>{busyIds.has(r.id)?<Clock size={14} strokeWidth={1.75} />:<><CheckCircle size={14} strokeWidth={1.75} /> אשר</>}</button><button className="btn btn-danger btn-sm" disabled={busyIds.has(r.id)} onClick={()=>updateStatus(r.id,"נדחה")}><XCircle size={14} strokeWidth={1.75} /> דחה</button></>}
                {(getEffectiveStatus(r)==="פעילה"||getEffectiveStatus(r)==="באיחור")&&<button className="btn btn-secondary btn-sm" disabled={busyIds.has(r.id)} onClick={()=>updateStatus(r.id,"הוחזר")}><><RotateCcw size={14} strokeWidth={1.75} /> הוחזר</></button>}
                <button className="btn btn-danger btn-sm" onClick={()=>{ if(window.confirm(`למחוק את הבקשה של ${r.student_name}?`)) deleteReservation(r.id); }}><Trash2 size={14} strokeWidth={1.75} /></button>
              </div>
            </div>
            );
  };

  return (
    <div className="page">
      {/* Sub-view tabs */}
      <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
        {[
          {id:"active",label:<><ClipboardList size={14} strokeWidth={1.75} color="var(--accent)" /> בקשות</>,badge:null},
          {id:"rejected",label:<><XCircle size={14} strokeWidth={1.75} color="var(--accent)" /> דחויות/מאחרות</>,badge:rejectedCount||null},
          {id:"archive",label:"🗄️ ארכיון",badge:archivedCount||null},
        ].map(t=>(
          <button key={t.id} onClick={()=>setSubView(t.id)}
            style={{padding:"8px 18px",borderRadius:8,border:`2px solid ${subView===t.id?"var(--accent)":"var(--border)"}`,
              background:subView===t.id?"var(--accent)22":"transparent",color:subView===t.id?"var(--accent)":"var(--text2)",
              fontWeight:800,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
            {t.label}
            {t.badge!=null && <span style={{background:subView===t.id?"var(--accent)":"var(--text3)",color:"#000",borderRadius:20,padding:"0 7px",fontSize:11,fontWeight:900}}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {/* Archive sub-view */}
      {subView==="archive" && <ArchivePage reservations={reservations} setReservations={setReservations} equipment={equipment} showToast={showToast}/>}

      {/* Active / Rejected sub-views */}
      {subView!=="archive" && <>

      {/* Staff loan button — visible only on the active sub-view */}
      {!isRejectedPage && (
        <div style={{marginBottom:16,display:"flex",justifyContent:"flex-end"}}>
          <button className="btn btn-primary" onClick={()=>setShowManualForm(true)} style={{fontSize:13}}>
            💼 השאלת איש צוות
          </button>
        </div>
      )}
      {showManualForm && (
        <StaffLoanForm
          onClose={()=>setShowManualForm(false)}
          showToast={showToast}
          reservations={reservations}
          setReservations={setReservations}
          teamMembers={teamMembers}
          equipment={equipment}
          categories={categories}
        />
      )}

      {filtered.length===0
        ? <div className="empty-state"><div className="emoji">{isRejectedPage ? <XCircle size={16} strokeWidth={1.75} color="var(--accent)" /> : "📭"}</div><div>{isRejectedPage ? "אין בקשות דחויות או מאחרות" : "אין בקשות"}</div></div>
        : <>
          {/* בקשות סטודנטים */}
          {studentReqs.length > 0 && <>
            {(lessonReqs.length > 0 || staffReqs.length > 0) && (
              <div style={{fontWeight:900,fontSize:14,marginBottom:10,color:"var(--text2)",display:"flex",alignItems:"center",gap:8}}>
                <><User size={14} strokeWidth={1.75} /> בקשות סטודנטים</>
                <span style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:20,padding:"1px 10px",fontSize:12,fontWeight:700,color:"var(--text3)"}}>{studentReqs.length}</span>
              </div>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {studentReqs.map(r => renderResCard(r))}
            </div>
          </>}
          {/* השאלות שיעור */}
          {lessonReqs.length > 0 && <>
            <div style={{fontWeight:900,fontSize:14,margin:`${studentReqs.length>0?"24px":"0px"} 0 10px`,color:"#9b59b6",display:"flex",alignItems:"center",gap:8,borderTop:studentReqs.length>0?"1px solid var(--border)":"none",paddingTop:studentReqs.length>0?20:0}}>
              <><Film size={14} strokeWidth={1.75} /> השאלות שיעור</>
              <span style={{background:"rgba(155,89,182,0.12)",border:"1px solid rgba(155,89,182,0.3)",borderRadius:20,padding:"1px 10px",fontSize:12,fontWeight:700,color:"#9b59b6"}}>{lessonReqs.length}</span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {lessonReqs.map(r => renderResCard(r))}
            </div>
          </>}
          {/* השאלות צוות */}
          {staffReqs.length > 0 && <>
            <div style={{fontWeight:900,fontSize:14,margin:`${(studentReqs.length>0||lessonReqs.length>0)?"24px":"0px"} 0 10px`,color:"#8a9bb3",display:"flex",alignItems:"center",gap:8,borderTop:(studentReqs.length>0||lessonReqs.length>0)?"1px solid var(--border)":"none",paddingTop:(studentReqs.length>0||lessonReqs.length>0)?20:0}}>
              <><Briefcase size={14} strokeWidth={1.75} /> השאלות צוות</>
              <span style={{background:"rgba(100,120,150,0.14)",border:"1px solid rgba(100,120,150,0.3)",borderRadius:20,padding:"1px 10px",fontSize:12,fontWeight:700,color:"#8a9bb3"}}>{staffReqs.length}</span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {staffReqs.map(r => renderResCard(r))}
            </div>
          </>}
        </>
      }
      {editing && <EditReservationModal reservation={editing} equipment={equipment} reservations={reservations} collegeManager={collegeManager} managerToken={managerToken}
  onSave={saveEditedReservation}
  onApprove={(editing.status==="נדחה" || editing.status==="ממתין") ? async(updated)=>{
    const approved = await approveReservation(updated);
    if (approved) setEditing(null);
    return approved;
  } : null}
  onClose={()=>setEditing(null)}/>}

      {approvalConflict && (()=>{
        const hasOverdueBlockers = approvalConflict.conflicts.some(c => c.blockers.some(b => b.status === "באיחור"));
        return (
        <Modal
          title={`⛔ אי אפשר לאשר את הבקשה של ${approvalConflict.reservation.student_name}`}
          onClose={()=>setApprovalConflict(null)}
          size="modal-lg"
          footer={<button className="btn btn-secondary" onClick={()=>setApprovalConflict(null)}>סגור</button>}
        >
          {hasOverdueBlockers && (
            <div style={{background:"rgba(231,76,60,0.1)",border:"2px solid rgba(231,76,60,0.45)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16,display:"flex",gap:12,alignItems:"flex-start"}}>
              <span style={{fontSize:22,lineHeight:1}}>⚠️</span>
              <div>
                <div style={{fontWeight:900,fontSize:14,color:"var(--red)",marginBottom:4}}>ציוד יצא מהמחסן ולא הוחזר (באיחור)</div>
                <div style={{fontSize:13,color:"var(--text2)"}}>אחד או יותר מהפריטים המבוקשים נמצאים כרגע אצל סטודנט אחר שלא החזיר את הציוד בזמן. לא ניתן לאשר את הבקשה עד שהציוד יוחזר פיזית למחסן.</div>
              </div>
            </div>
          )}
          <div className="highlight-box" style={{marginBottom:20}}>
            הבקשה לא יכולה להיות מאושרת כרגע. אלו הפריטים שחוסמים את האישור.
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            {approvalConflict.conflicts.map((conflict, idx)=>(
              <div key={idx} style={{background:"var(--surface2)",border:"1px solid rgba(231,76,60,0.28)",borderRadius:"var(--r-sm)",padding:16}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
                  <div style={{fontWeight:900,fontSize:21,color:"var(--red)"}}>{conflict.equipment_name}</div>
                  <div style={{background:"rgba(231,76,60,0.12)",border:"1px solid rgba(231,76,60,0.35)",borderRadius:999,padding:"6px 14px",fontWeight:900,fontSize:16,color:"var(--red)"}}>
                    חסומות {conflict.missing} יחידות
                  </div>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {conflict.blockers.map((blocker, bIdx)=>{
                    const isOverdue = blocker.status === "באיחור";
                    return (
                    <div key={bIdx} style={{background: isOverdue ? "rgba(231,76,60,0.07)" : "var(--surface3)", border: isOverdue ? "1.5px solid rgba(231,76,60,0.45)" : "1px solid var(--border)", borderRadius:10, padding:12}}>
                      <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",alignItems:"center",marginBottom:6}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <strong style={{fontSize:14}}>{blocker.student_name}</strong>
                          {isOverdue && <span className="badge badge-orange" style={{fontSize:11}}><><AlertTriangle size={11} strokeWidth={1.75} /> באיחור</></span>}
                        </div>
                        <span style={{fontWeight:900,fontSize:15,color:"var(--red)"}}>כמות חסומה: {blocker.quantity}</span>
                      </div>
                      <div style={{fontSize:12,color:"var(--text2)",display:"flex",flexWrap:"wrap",gap:10}}>
                        <span><Calendar size={14} strokeWidth={1.75} color="var(--accent)" /> {formatDate(blocker.borrow_date)} {blocker.borrow_time || ""}</span>
                        {isOverdue
                          ? <span style={{color:"var(--red)",fontWeight:700}}>↩ היה אמור לחזור {formatDate(blocker.return_date)} — עדיין לא הוחזר</span>
                          : <span>↩ {formatDate(blocker.return_date)} {blocker.return_time || ""}</span>
                        }
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Modal>
        );
      })()}

      {consecutiveWarning && (
        <Modal
          title={`⚠️ שים לב — בקשות עוקבות קרובות בזמן`}
          onClose={()=>setConsecutiveWarning(null)}
          size="modal-lg"
          footer={<div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <button className="btn btn-secondary" onClick={()=>setConsecutiveWarning(null)}>ביטול</button>
            <button className="btn btn-success" onClick={()=>doApprove(consecutiveWarning.reservation)}><CheckCircle size={16} strokeWidth={1.75} /> אשר בכל זאת</button>
          </div>}
        >
          <div style={{background:"rgba(241,196,15,0.1)",border:"2px solid rgba(241,196,15,0.45)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16,display:"flex",gap:12,alignItems:"flex-start"}}>
            <span style={{fontSize:22,lineHeight:1}}>⚠️</span>
            <div>
              <div style={{fontWeight:900,fontSize:14,color:"var(--yellow)",marginBottom:4}}>סטודנט קודם עלול לאחר בהחזרת ציוד</div>
              <div style={{fontSize:13,color:"var(--text2)"}}>הפריטים הבאים מושאלים לסטודנט אחר שזמן ההחזרה שלו מסתיים זמן קצר לפני תחילת ההשאלה הנוכחית. במידה והסטודנט יאחר — לא יהיה ציוד זמין.</div>
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {consecutiveWarning.warnings.map((w, idx) => (
              <div key={idx} style={{background:"var(--surface2)",border:"1px solid rgba(241,196,15,0.28)",borderRadius:"var(--r-sm)",padding:14,display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:10,alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15}}>{w.equipment_name} <span style={{color:"var(--yellow)"}}>×{w.quantity}</span></div>
                  <div style={{fontSize:12,color:"var(--text2)",marginTop:4}}>מושאל ל-<strong>{w.student_name}</strong></div>
                </div>
                <div style={{fontSize:13,color:"var(--text2)",textAlign:"left"}}>
                  <div>↩ החזרה: {formatDate(w.return_date)} {w.return_time}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="highlight-box" style={{marginTop:16}}>
            כדאי להמתין להחזרת הציוד של <strong>{consecutiveWarning.warnings[0]?.student_name}</strong> לפני אישור הבקשה של <strong>{consecutiveWarning.reservation.student_name}</strong>.
          </div>
        </Modal>
      )}

      {selected && (
        <Modal title={<><ClipboardList size={16} strokeWidth={1.75} color="var(--accent)" /> בקשה — {selected.student_name}</>} onClose={()=>{setSelected(null);setOverdueEmailText("");}} size="modal-lg"
          footer={<>
            {(selected.status==="ממתין"||selected.status==="מאושר"||selected.status==="נדחה"||selected.status==="באיחור")&&<button className="btn btn-secondary" onClick={()=>{setEditing(selected);setSelected(null);setOverdueEmailText("");}}>✏️ עריכת בקשה</button>}
            {selected.status==="ממתין"&&<><button className="btn btn-success" disabled={busyIds.has(selected.id)} onClick={()=>updateStatus(selected.id,"מאושר")}>{busyIds.has(selected.id)?<><Clock size={14} strokeWidth={1.75} /> מאשר...</>:<><CheckCircle size={14} strokeWidth={1.75} /> אשר</>}</button><button className="btn btn-danger" disabled={busyIds.has(selected.id)} onClick={()=>updateStatus(selected.id,"נדחה")}><XCircle size={14} strokeWidth={1.75} /> דחה</button></>}
            {selected.status==="נדחה"&&<button className="btn btn-success" disabled={busyIds.has(selected.id)} onClick={()=>updateStatus(selected.id,"מאושר")}>{busyIds.has(selected.id)?<><Clock size={14} strokeWidth={1.75} /> מאשר...</>:<><CheckCircle size={14} strokeWidth={1.75} /> אשר בקשה</>}</button>}
            {(getEffectiveStatus(selected)==="פעילה"||getEffectiveStatus(selected)==="באיחור")&&<button className="btn btn-secondary" disabled={busyIds.has(selected.id)} onClick={()=>updateStatus(selected.id,"הוחזר")}>🔄 סמן כהוחזר</button>}
            <button className="btn btn-secondary" onClick={()=>exportPDF(selected)}>📄 ייצא PDF</button>
            <button className="btn btn-danger" onClick={()=>{ if(window.confirm(`למחוק את הבקשה של ${selected.student_name}?`)) deleteReservation(selected.id); }}>🗑️ מחק</button>
            <button className="btn btn-secondary" onClick={()=>{setSelected(null);setOverdueEmailText("");}}>סגור</button>
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
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,fontSize:13}}>
                  <span style={{color:"var(--text3)"}}><Calendar size={14} strokeWidth={1.75} color="var(--accent)" /> תאריך השאלה</span>
                  <span style={{display:"flex",alignItems:"center",gap:6}}>
                    <strong>{formatDate(selected.borrow_date)}</strong>
                    {selected.borrow_time&&<span style={{background:"var(--surface)",border:"1px solid rgba(245,166,35,0.4)",borderRadius:6,padding:"1px 8px",fontSize:12,fontWeight:800,color:"var(--accent)"}}>{selected.borrow_time}</span>}
                  </span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:13}}>
                  <span style={{color:"var(--text3)"}}>🔄 תאריך החזרה</span>
                  <span style={{display:"flex",alignItems:"center",gap:6}}>
                    <strong>{formatDate(selected.return_date)}</strong>
                    {selected.return_time&&<span style={{background:"var(--surface)",border:"1px solid rgba(245,166,35,0.4)",borderRadius:6,padding:"1px 8px",fontSize:12,fontWeight:800,color:"var(--accent)"}}>{selected.return_time}</span>}
                  </span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginTop:8,paddingTop:8,borderTop:"1px solid rgba(245,166,35,0.15)"}}>
                  <span style={{color:"var(--text3)"}}>⏱️ משך ההשאלה</span>
                  <strong>{getLoanDurationDays(selected.borrow_date, selected.return_date)} ימים</strong>
                </div>
                {(selected.created_at||selected.id)&&(
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginTop:8,paddingTop:8,borderTop:"1px solid rgba(245,166,35,0.15)",color:"var(--text3)"}}>
                    <span>📨 נשלח למערכת</span>
                    <span style={{fontWeight:700,color:"var(--text2)"}}>{(()=>{
                      if(selected.submitted_at) return selected.submitted_at;
                      const idNum = Number(selected.id);
                      if(!isNaN(idNum) && idNum > 1000000000000) {
                        return new Date(idNum).toLocaleString("he-IL",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Jerusalem"});
                      }
                      return selected.created_at ? `${selected.created_at.split("-").reverse().join("/")}` : "לא ידוע";
                    })()}</span>
                  </div>
                )}
              </div>
              <div style={{marginTop:12,textAlign:"center"}}>{statusBadge(selected.status)}</div>
            </div>
            <div>
              <div className="form-section-title">ציוד מבוקש ({selected.items?.length||0} פריטים)</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {selected.items?.map((item,i)=>{
                  const hasReport=equipmentReports.some(rp=>rp.equipment_id===String(item.equipment_id)&&rp.reservation_id===String(selected.id)&&rp.status==="open");
                  return (<div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:hasReport?"rgba(231,76,60,0.06)":"var(--surface2)",borderRadius:"var(--r-sm)",border:hasReport?"1px solid rgba(231,76,60,0.3)":"1px solid var(--border)"}}>
                    <EqImg id={item.equipment_id} size={32}/>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:14}}>{eqName(item.equipment_id)}{hasReport&&<span style={{color:"#e74c3c",fontSize:12,marginRight:6}}>⚠️ דיווח תקלה</span>}</div>
                      <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>כמות: <strong style={{color:"var(--accent)"}}>{item.quantity}</strong></div>
                    </div>
                  </div>);
                })}
              </div>
            </div>
          </div>
          {/* Overdue manual email area */}
          {selected.status==="באיחור" && (
            <div style={{marginTop:20,background:"rgba(230,126,34,0.08)",border:"1px solid rgba(230,126,34,0.3)",borderRadius:"var(--r)",padding:16}}>
              <div style={{fontWeight:800,fontSize:13,color:"#e67e22",marginBottom:10}}>📧 שליחת מייל ידני לסטודנט המאחר</div>
              <textarea
                className="form-textarea"
                rows={4}
                placeholder={`${selected.student_name} שים/י לב, זמן ההשאלה שלך תם ועליך להשיב את הציוד בהקדם למכללה...`}
                value={overdueEmailText}
                onChange={e=>setOverdueEmailText(e.target.value)}
                style={{marginBottom:10}}
              />
              <button
                className="btn btn-primary"
                style={{background:"#e67e22",borderColor:"#e67e22"}}
                disabled={overdueEmailSending || !overdueEmailText.trim() || !selected.email}
                onClick={()=>sendOverdueManualEmail(selected, overdueEmailText)}
              >
                {overdueEmailSending ? <><Clock size={16} strokeWidth={1.75} /> שולח...</> : "📤 שלח מייל לסטודנט"}
              </button>
              <span style={{fontSize:12,color:"var(--text3)",marginRight:10}}>
                {selected.email ? `יישלח אל ${selected.email}` : "אין כתובת מייל"}
              </span>
            </div>
          )}
        </Modal>
      )}
      </>}
    </div>
  );
}
