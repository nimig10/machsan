// DashboardPage.jsx — admin dashboard page
import { useState } from "react";
import { formatDate, getLoanDurationDays, formatLocalDateInput, today, toDateTime, workingUnits, getReservationApprovalConflicts, getConsecutiveBookingWarnings, markReservationReturned, normalizeReservationsForArchive, getEffectiveStatus, updateReservationStatus, getAuthToken, storageSet } from "../utils.js";
import { Modal, statusBadge } from "./ui.jsx";
import { CalendarGrid } from "./CalendarGrid.jsx";

const HE_DAYS = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
function getDayName(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return HE_DAYS[d.getDay()] || "";
}

export function DashboardPage({ equipment, reservations, setReservations, showToast, siteSettings = {}, equipmentReports = [] }) {
  const todayStr = today();
  const nowMs = Date.now();

  // ── מלאי ──
  const totalItems   = equipment.length;
  const totalUnits   = equipment.reduce((s, e) => s + workingUnits(e), 0);
  const totalDamaged = equipment.reduce((s, e) => s + (Array.isArray(e.units)?e.units.filter(u=>u.status!=="תקין").length:0), 0);

  // ── בקשות פעילות עכשיו ──
  const activeNow = reservations.filter(r => {
    if (!["מאושר","באיחור"].includes(r.status) || !r.borrow_date || !r.return_date) return false;
    const borrowAt = toDateTime(r.borrow_date, r.borrow_time || "00:00");
    const returnAt = toDateTime(r.return_date, r.return_time || "23:59");
    return r.status === "באיחור" ? borrowAt <= nowMs : (borrowAt <= nowMs && returnAt >= nowMs);
  });
  // ── כל בקשות מאושרות (כולל עתידיות) ──
  const allApproved = reservations.filter(r => r.status === "מאושר" || r.status === "באיחור");

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
  const [dashApprovalConflict, setDashApprovalConflict] = useState(null);
  const [dashConsecutiveWarning, setDashConsecutiveWarning] = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const [calStatusF, setCalStatusF] = useState([]);
  const [calLoanTypeF, setCalLoanTypeF] = useState("הכל");
  const [onLoanModal, setOnLoanModal] = useState(null); // "units" | "items" | null
  const [dashStatusF, setDashStatusF] = useState([]);
  const [dashSortBy, setDashSortBy] = useState("urgency"); // "urgency" | "received"

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
  const DASHBOARD_CAL_STATUSES = ["ממתין","מאושר","פעילה","נדחה","באיחור","אישור ראש מחלקה"];
  const CAL_LOAN_TYPES = [
    { key:"הכל", label:"הכל", icon:"📦" },
    { key:"פרטית", label:"פרטית", icon:"👤" },
    { key:"הפקה", label:"הפקה", icon:"🎬" },
    { key:"סאונד", label:"סאונד", icon:"🎙️" },
    { key:"קולנוע יומית", label:"קולנוע יומית", icon:"🎥" },
    { key:"שיעור", label:"שיעור", icon:"📽️" },
    { key:"צוות", label:"איש צוות", icon:"💼" },
  ];
  const LOAN_TYPE_ICON = { "פרטית":"👤","הפקה":"🎬","סאונד":"🎙️","שיעור":"📽️","קולנוע יומית":"🎥","צוות":"💼" };

  const activeRes = reservations.filter(r =>
    r.status !== "הוחזר" && r.borrow_date && r.return_date &&
    (calStatusF.length===0 || calStatusF.includes(getEffectiveStatus(r))) &&
    (calLoanTypeF==="הכל" || r.loan_type===calLoanTypeF)
  );
  const colorMap = {};
  const lessonResIds = new Set(activeRes.filter(r=>r.loan_type==="שיעור").map(r=>r.id));
  let nonLessonIdx = 0;
  activeRes.forEach(r => {
    if(r.loan_type==="שיעור") colorMap[r.id] = ["rgba(155,89,182,0.7)","#fff"];
    else if(r.loan_type==="צוות") colorMap[r.id] = ["rgba(100,120,150,0.75)","#fff"];
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

      <div className="dash-stats-section">
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
          { l:"באיחור",        v:reservations.filter(r=>r.status==="באיחור").length, i:"⚠️", c:"#e67e22" },
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
                          <div style={{fontWeight:800,fontSize:14}}>{r.student_name}{equipmentReports.some(rp=>rp.reservation_id===String(r.id)&&rp.status==="open")&&<span title="דיווח תקלה פתוח" style={{color:"#e74c3c",fontSize:14,marginRight:4}}>⚠️</span>}</div>
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
          {/* Dashboard filters */}
          <div style={{padding:"8px 16px",display:"flex",flexDirection:"column",gap:8,borderBottom:"1px solid var(--border)"}}>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:11,fontWeight:800,color:"var(--text3)"}}>סטטוס:</span>
              {["ממתין","אישור ראש מחלקה","נדחה","מאושר","פעילה","באיחור"].map(s=>{
                const active=dashStatusF.includes(s);
                return <button key={s} type="button" onClick={()=>setDashStatusF(p=>active?p.filter(x=>x!==s):[...p,s])}
                  style={{padding:"3px 10px",borderRadius:20,border:`1.5px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:11,cursor:"pointer"}}>{s}</button>;
              })}
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontSize:11,fontWeight:800,color:"var(--text3)"}}>סידור:</span>
              {[{k:"urgency",l:"🔥 דחיפות"},{k:"received",l:"🕐 קבלה"}].map(({k,l})=>(
                <button key={k} type="button" onClick={()=>setDashSortBy(k)}
                  style={{padding:"3px 10px",borderRadius:20,border:`1.5px solid ${dashSortBy===k?"var(--accent)":"var(--border)"}`,background:dashSortBy===k?"var(--accent-glow)":"transparent",color:dashSortBy===k?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:11,cursor:"pointer"}}>{l}</button>
              ))}
            </div>
          </div>
          {(()=>{
            const dashFiltered = [...reservations]
              .filter(r=>r.status!=="הוחזר"&&r.loan_type!=="שיעור"&&(dashStatusF.length===0||dashStatusF.includes(getEffectiveStatus(r))))
              .sort((a,b)=>dashSortBy==="urgency"?new Date(a.borrow_date)-new Date(b.borrow_date):Number(b.id)-Number(a.id))
              .slice(0,8);
            if(!dashFiltered.length) return <div className="empty-state" style={{padding:20}}><div className="emoji">📋</div><p>אין בקשות תואמות</p></div>;
            return dashFiltered.map(r=>(
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
                {equipmentReports.some(rp=>rp.reservation_id===String(r.id)&&rp.status==="open")&&<span title="דיווח תקלה פתוח" style={{color:"#e74c3c",fontSize:14}}>⚠️</span>}
                {statusBadge(getEffectiveStatus(r))}
              </div>
            </div>
          ));})()}
        </div>

        {/* ── שיעורים להכנה ── */}
        {(()=>{
          const nowHHMM = (()=>{const n=new Date();return String(n.getHours()).padStart(2,"0")+":"+String(n.getMinutes()).padStart(2,"0");})();
          const upcomingLessons = reservations
            .filter(r=>{
              if(r.loan_type!=="שיעור") return false;
              if(r.status==="הוחזר"||r.status==="שיעור שהסתיים"||r.status==="נדחה") return false;
              if(r.borrow_date < todayStr) return false;
              if(r.borrow_date===todayStr) return (r.return_time||"23:59") > nowHHMM;
              return true;
            })
            .sort((a,b)=>{
              if (a.borrow_date !== b.borrow_date) return a.borrow_date < b.borrow_date ? -1 : 1;
              return (a.borrow_time||"") < (b.borrow_time||"") ? -1 : 1;
            })
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
                  <div
                    key={r.id}
                    onClick={()=>setDashViewRes(r)}
                    style={{borderBottom:"1px solid var(--border)",padding:"10px 0",display:"flex",gap:10,alignItems:"flex-start",cursor:"pointer",borderRadius:"var(--r-sm)",transition:"background .15s, border-color .15s",paddingInline:8}}
                    onMouseEnter={e=>{e.currentTarget.style.background="rgba(155,89,182,0.08)";e.currentTarget.style.borderColor="rgba(155,89,182,0.45)";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.borderColor="var(--border)";}}
                  >
                    <div style={{width:34,height:34,borderRadius:8,background:"rgba(155,89,182,0.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>🎬</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:13,display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
                        {tag}{r.course||r.student_name}
                      </div>
                      {r.student_name&&r.student_name!==r.course&&(
                        <div style={{fontSize:12,fontWeight:700,color:"#9b59b6",marginTop:3,display:"flex",alignItems:"center",gap:4}}>
                          👨‍🏫 {r.student_name}
                        </div>
                      )}
                      <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>
                        📅 {formatDate(r.borrow_date)} · 🕐 {r.borrow_time||"?"} – {r.return_time||"?"}
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
            <span className="card-title">📅 לוח השאלות ציוד</span>
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
                const clr = s==="מאושר" ? "var(--green)" : s==="ממתין" ? "var(--yellow)" : s==="פעילה" ? "#64b5f6" : s==="באיחור" ? "#e67e22" : s==="אישור ראש מחלקה" ? "var(--purple)" : "var(--red)";
                return (
                  <button key={s} type="button" onClick={()=>setCalStatusF(p=>active?p.filter(x=>x!==s):[...p,s])}
                    style={{padding:"3px 10px",borderRadius:20,border:`2px solid ${active?clr:"var(--border)"}`,background:active?`color-mix(in srgb,${clr} 15%,transparent)`:"transparent",color:active?clr:"var(--text3)",fontWeight:700,fontSize:11,cursor:"pointer"}}>
                    {s==="מאושר" ? "✅" : s==="ממתין" ? "⏳" : s==="פעילה" ? "👍" : s==="באיחור" ? "⚠️" : s==="אישור ראש מחלקה" ? "🟣" : "❌"} {s}
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
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}} onClick={e=>e.target===e.currentTarget&&setDashViewRes(null)}>
          <div style={{width:"100%",maxWidth:640,background:"var(--surface)",borderRadius:18,border:"1px solid var(--border)",direction:"rtl",maxHeight:"92vh",overflowY:"auto"}}>
            {/* Header */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"18px 22px",borderBottom:"1px solid var(--border)",background:"var(--surface2)",borderRadius:"18px 18px 0 0",position:"sticky",top:0,zIndex:1}}>
              <div>
                <div style={{fontWeight:900,fontSize:17,display:"flex",alignItems:"center",gap:8}}>
                  {dashViewRes.loan_type==="שיעור"?"🎬":"📋"} {dashViewRes.student_name}
                  {statusBadge(getEffectiveStatus(dashViewRes))}
                </div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:3,display:"flex",gap:12,flexWrap:"wrap"}}>
                  {dashViewRes.email&&<span>📧 {dashViewRes.email}</span>}
                  {dashViewRes.phone&&<span>📞 {dashViewRes.phone}</span>}
                </div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={()=>setDashViewRes(null)}>✕</button>
            </div>
            <div style={{padding:"20px 22px",display:"flex",flexDirection:"column",gap:16}}>
              {/* Dates & info */}
              <div style={{background:"var(--accent-glow)",border:"1px solid rgba(245,166,35,0.3)",borderRadius:12,padding:"14px 16px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 16px"}}>
                {[
                  ["📅 השאלה",`${getDayName(dashViewRes.borrow_date)} · ${formatDate(dashViewRes.borrow_date)}${dashViewRes.borrow_time?" · "+dashViewRes.borrow_time:""}`],
                  ["↩ החזרה",`${getDayName(dashViewRes.return_date)} · ${formatDate(dashViewRes.return_date)}${dashViewRes.return_time?" · "+dashViewRes.return_time:""}`],
                  ["📚 קורס",dashViewRes.course||"—"],
                  ["🎬 סוג",dashViewRes.loan_type||"—"],
                  ...(dashViewRes.project_name?[["🎥 פרויקט",dashViewRes.project_name]]:[]),
                  ["⏱️ משך",`${getLoanDurationDays(dashViewRes.borrow_date, dashViewRes.return_date)} ימים`],
                ].map(([l,v])=>(
                  <div key={l} style={{display:"flex",flexDirection:"column",gap:1}}>
                    <span style={{fontSize:10,color:"var(--text3)",fontWeight:700}}>{l}</span>
                    <strong style={{fontSize:13}}>{v}</strong>
                  </div>
                ))}
              </div>
              {/* Production crew */}
              {(dashViewRes.crew_photographer_name||dashViewRes.crew_sound_name)&&(
                <div style={{background:"var(--surface2)",borderRadius:10,padding:"10px 14px",fontSize:12,display:"flex",gap:16,flexWrap:"wrap"}}>
                  {dashViewRes.crew_photographer_name&&<span>📸 צלם: <strong>{dashViewRes.crew_photographer_name}</strong>{dashViewRes.crew_photographer_phone&&` · ${dashViewRes.crew_photographer_phone}`}</span>}
                  {dashViewRes.crew_sound_name&&<span>🎙️ סאונד: <strong>{dashViewRes.crew_sound_name}</strong>{dashViewRes.crew_sound_phone&&` · ${dashViewRes.crew_sound_phone}`}</span>}
                </div>
              )}
              {/* Production reason */}
              {dashViewRes.production_reason&&(
                <div style={{background:"rgba(245,166,35,0.07)",border:"1px solid rgba(245,166,35,0.25)",borderRadius:10,padding:"12px 14px"}}>
                  <div style={{fontSize:11,fontWeight:800,color:"var(--accent)",marginBottom:6}}>📝 סיבת ההפקה</div>
                  <div style={{fontSize:13,color:"var(--text)",lineHeight:1.6,whiteSpace:"pre-wrap"}}>{dashViewRes.production_reason}</div>
                </div>
              )}
              {/* Items with images */}
              <div>
                <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>ציוד ({dashViewRes.items?.length||0} פריטים)</div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {dashViewRes.items?.map((i,j)=>{
                    const eq = equipment.find(e=>e.id==i.equipment_id);
                    const hasReport = equipmentReports.some(rp=>rp.equipment_id===String(i.equipment_id)&&rp.reservation_id===String(dashViewRes.id)&&rp.status==="open");
                    const img = eq?.image || eq?.img || "";
                    const showImg = img && (img.startsWith("data:") || img.startsWith("http"));
                    return (
                      <div key={j} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:hasReport?"rgba(231,76,60,0.08)":"var(--surface2)",borderRadius:12,border:hasReport?"1px solid rgba(231,76,60,0.3)":"1px solid var(--border)"}}>
                        {/* Equipment image */}
                        <div style={{width:52,height:52,borderRadius:10,background:"var(--surface3)",flexShrink:0,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>
                          {showImg
                            ? <img src={img} alt={eq?.name||""} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                            : "📦"}
                        </div>
                        {/* Name + category */}
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:800,fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            {hasReport&&<span style={{color:"#e74c3c",marginLeft:6}}>⚠️</span>}
                            {eq?.name||i.name||"?"}
                          </div>
                          {eq?.category&&<div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{eq.category}</div>}
                        </div>
                        {/* Quantity */}
                        <div style={{background:"var(--accent-glow)",border:"1px solid var(--accent)",borderRadius:8,padding:"5px 14px",fontSize:16,fontWeight:900,color:"var(--accent)",flexShrink:0}}>×{i.quantity}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Return button for approved/overdue requests */}
              {(getEffectiveStatus(dashViewRes)==="פעילה"||getEffectiveStatus(dashViewRes)==="באיחור") && setReservations && (
                <div style={{borderTop:"1px solid var(--border)",paddingTop:14,display:"flex",justifyContent:"center"}}>
                  <button className="btn btn-secondary" style={{fontSize:14,padding:"10px 32px",background:"var(--blue)",borderColor:"var(--blue)",color:"#fff"}}
                    onClick={async()=>{
                      const res = dashViewRes;
                      // Route through the atomic RPC (migration 009) so
                      // available_units recomputes and concurrent admins
                      // can't double-process the return.
                      const returnedAt = new Date().toISOString();
                      const rpcResult = await updateReservationStatus(res.id, "הוחזר", { returned_at: returnedAt });
                      if (!rpcResult.ok) {
                        console.error("return RPC failed:", rpcResult);
                        if(showToast) showToast("error", "שגיאה ברישום ההחזרה בשרת");
                        return;
                      }
                      const updated = normalizeReservationsForArchive(reservations.map(r =>
                        r.id === res.id ? markReservationReturned(r) : r
                      ));
                      setReservations(updated);
                      if(showToast) showToast("success", `הציוד של ${res.student_name} הוחזר ✅`);
                      setDashViewRes(null);
                    }}>
                    🔄 הוחזר
                  </button>
                </div>
              )}
              {/* Approve button for pending requests — with conflict checking */}
              {dashViewRes.status==="ממתין" && setReservations && (
                <div style={{borderTop:"1px solid var(--border)",paddingTop:14,display:"flex",justifyContent:"center"}}>
                  <button className="btn btn-primary" style={{background:"var(--green)",borderColor:"var(--green)",fontSize:14,padding:"10px 32px"}}
                    disabled={approvingId===dashViewRes.id}
                    onClick={async()=>{
                      const res = dashViewRes;
                      if (approvingId===res.id) return;
                      // 1) Hard block
                      const conflicts = getReservationApprovalConflicts(res, reservations, equipment);
                      if (conflicts.length) {
                        setDashApprovalConflict({ reservation: res, conflicts });
                        setDashViewRes(null);
                        return;
                      }
                      // 2) Consecutive warning
                      const warnings = getConsecutiveBookingWarnings(res, reservations, equipment);
                      if (warnings.length) {
                        setDashConsecutiveWarning({ reservation: res, warnings });
                        setDashViewRes(null);
                        return;
                      }
                      // 3) Approve — via atomic RPC (migration 009).
                      // FOR UPDATE lock serializes concurrent approvers.
                      setApprovingId(res.id);
                      try {
                        const rpcResult = await updateReservationStatus(res.id, "מאושר");
                        if (!rpcResult.ok) {
                          console.error("dashboard approve RPC failed:", rpcResult);
                          if(showToast) showToast("error", "שגיאה באישור הבקשה בשרת");
                          return;
                        }
                        const updated = reservations.map(r=>r.id===res.id?{...r,status:"מאושר"}:r);
                        setReservations(updated);
                        // Persist to the JSONB blob so the status survives refresh.
                        // The RPC updates the normalized table but NOT the blob, and
                        // the UI still reads from the blob — so without this, a
                        // refresh resurrects the old "ממתין" status.
                        // Await + log any failure so the admin retries instead of
                        // silently thinking it was saved.
                        const blobWrite = await storageSet("reservations", updated);
                        if (!blobWrite || blobWrite.ok === false) {
                          console.error("dashboard approve: blob write failed", blobWrite);
                          if(showToast) showToast("error", "האישור נשמר ב-DB אך כתיבה ל-blob נכשלה — רענן את הדף");
                        } else {
                          if(showToast) showToast("success",`הבקשה של ${res.student_name} אושרה ✅`);
                        }
                        // Only email when this click was the one that actually flipped the status.
                        if (rpcResult.changed && res.email) {
                          const itemsList = res.items?.map(i=>`<tr><td style="padding:7px 12px;color:#e8eaf0;border-bottom:1px solid #1e2130">${equipment.find(e=>e.id==i.equipment_id)?.name||i.name||"?"}</td><td style="padding:7px 12px;text-align:center;color:#f5a623;font-weight:700;border-bottom:1px solid #1e2130">${i.quantity}</td></tr>`).join("")||"";
                          try {
                            const emailAc = new AbortController();
                            const emailTid = setTimeout(() => emailAc.abort(), 8000);
                            const tokAp = await getAuthToken();
                            await fetch("/api/send-email",{method:"POST",headers:{"Content-Type":"application/json",...(tokAp?{Authorization:`Bearer ${tokAp}`}:{})},signal:emailAc.signal,body:JSON.stringify({to:res.email,type:"approved",student_name:res.student_name,items_list:itemsList,borrow_date:formatDate(res.borrow_date),return_date:formatDate(res.return_date),borrow_time:res.borrow_time||"",return_time:res.return_time||"",sound_logo_url:siteSettings.soundLogo||""})});
                            clearTimeout(emailTid);
                            if(showToast) showToast("success",`📧 מייל אישור נשלח ל-${res.email}`);
                          } catch { if(showToast) showToast("error","שגיאה בשליחת המייל"); }
                        }
                        setDashViewRes(null);
                      } finally {
                        setApprovingId(null);
                      }
                    }}>
                    {approvingId===dashViewRes.id ? "⏳ מאשר..." : "✅ אשר בקשה"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Dashboard — Hard block conflict dialog */}
      {dashApprovalConflict && (()=>{
        const hasOverdue = dashApprovalConflict.conflicts.some(c => c.blockers.some(b => b.status === "באיחור"));
        return (
        <Modal title={`⛔ אי אפשר לאשר את הבקשה של ${dashApprovalConflict.reservation.student_name}`}
          onClose={()=>setDashApprovalConflict(null)} size="modal-lg"
          footer={<button className="btn btn-secondary" onClick={()=>setDashApprovalConflict(null)}>סגור</button>}>
          {hasOverdue && (
            <div style={{background:"rgba(231,76,60,0.1)",border:"2px solid rgba(231,76,60,0.45)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16,display:"flex",gap:12,alignItems:"flex-start"}}>
              <span style={{fontSize:22,lineHeight:1}}>⚠️</span>
              <div>
                <div style={{fontWeight:900,fontSize:14,color:"var(--red)",marginBottom:4}}>ציוד יצא מהמחסן ולא הוחזר (באיחור)</div>
                <div style={{fontSize:13,color:"var(--text2)"}}>אחד או יותר מהפריטים המבוקשים נמצאים כרגע אצל סטודנט אחר שלא החזיר את הציוד בזמן.</div>
              </div>
            </div>
          )}
          <div className="highlight-box" style={{marginBottom:20}}>הבקשה לא יכולה להיות מאושרת כרגע. אלו הפריטים שחוסמים את האישור:</div>
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            {dashApprovalConflict.conflicts.map((c, i)=>(
              <div key={i} style={{background:"var(--surface2)",border:"1px solid rgba(231,76,60,0.28)",borderRadius:"var(--r-sm)",padding:16}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
                  <div style={{fontWeight:900,fontSize:21,color:"var(--red)"}}>{c.equipment_name}</div>
                  <div style={{background:"rgba(231,76,60,0.12)",border:"1px solid rgba(231,76,60,0.35)",borderRadius:999,padding:"6px 14px",fontWeight:900,fontSize:16,color:"var(--red)"}}>חסומות {c.missing} יחידות</div>
                </div>
                {c.blockers.map((b, j)=>{
                  const isOD = b.status === "באיחור";
                  return (
                  <div key={j} style={{background:isOD?"rgba(231,76,60,0.07)":"var(--surface3)",border:isOD?"1.5px solid rgba(231,76,60,0.45)":"1px solid var(--border)",borderRadius:10,padding:12,marginBottom:8}}>
                    <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",alignItems:"center",marginBottom:6}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <strong style={{fontSize:14}}>{b.student_name}</strong>
                        {isOD && <span className="badge badge-orange" style={{fontSize:11}}>⚠️ באיחור</span>}
                      </div>
                      <span style={{fontWeight:900,fontSize:15,color:"var(--red)"}}>כמות חסומה: {b.quantity}</span>
                    </div>
                    <div style={{fontSize:12,color:"var(--text2)",display:"flex",flexWrap:"wrap",gap:10}}>
                      <span>📅 {formatDate(b.borrow_date)} {b.borrow_time||""}</span>
                      {isOD
                        ? <span style={{color:"var(--red)",fontWeight:700}}>↩ היה אמור לחזור {formatDate(b.return_date)} — עדיין לא הוחזר</span>
                        : <span>↩ {formatDate(b.return_date)} {b.return_time||""}</span>}
                    </div>
                  </div>);
                })}
              </div>
            ))}
          </div>
        </Modal>);
      })()}

      {/* Dashboard — Consecutive booking warning dialog */}
      {dashConsecutiveWarning && (
        <Modal title="⚠️ שים לב — בקשות עוקבות קרובות בזמן"
          onClose={()=>setDashConsecutiveWarning(null)} size="modal-lg"
          footer={<div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <button className="btn btn-secondary" onClick={()=>setDashConsecutiveWarning(null)}>ביטול</button>
            <button className="btn btn-success"
              disabled={approvingId===dashConsecutiveWarning.reservation.id}
              onClick={async()=>{
              const res = dashConsecutiveWarning.reservation;
              if (approvingId===res.id) return;
              setApprovingId(res.id);
              try {
                const rpcResult = await updateReservationStatus(res.id, "מאושר");
                if (!rpcResult.ok) {
                  console.error("dashboard approve-anyway RPC failed:", rpcResult);
                  if(showToast) showToast("error", "שגיאה באישור הבקשה בשרת");
                  return;
                }
                const updated = reservations.map(r=>r.id===res.id?{...r,status:"מאושר"}:r);
                setReservations(updated);
                storageSet("reservations", updated).catch(err =>
                  console.warn("blob cache refresh failed (DB is already updated):", err)
                );
                if(showToast) showToast("success",`הבקשה של ${res.student_name} אושרה ✅`);
                setDashConsecutiveWarning(null);
              } finally {
                setApprovingId(null);
              }
            }}>{approvingId===dashConsecutiveWarning.reservation.id?"⏳ מאשר...":"✅ אשר בכל זאת"}</button>
          </div>}>
          <div style={{background:"rgba(241,196,15,0.1)",border:"2px solid rgba(241,196,15,0.45)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16,display:"flex",gap:12,alignItems:"flex-start"}}>
            <span style={{fontSize:22,lineHeight:1}}>⚠️</span>
            <div>
              <div style={{fontWeight:900,fontSize:14,color:"var(--yellow)",marginBottom:4}}>סטודנט קודם עלול לאחר בהחזרת ציוד</div>
              <div style={{fontSize:13,color:"var(--text2)"}}>הפריטים הבאים מושאלים לסטודנט אחר שזמן ההחזרה שלו מסתיים זמן קצר לפני תחילת ההשאלה הנוכחית. במידה והסטודנט יאחר — לא יהיה ציוד זמין.</div>
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {dashConsecutiveWarning.warnings.map((w, i) => (
              <div key={i} style={{background:"var(--surface2)",border:"1px solid rgba(241,196,15,0.28)",borderRadius:"var(--r-sm)",padding:14,display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:10,alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15}}>{w.equipment_name} <span style={{color:"var(--yellow)"}}>×{w.quantity}</span></div>
                  <div style={{fontSize:12,color:"var(--text2)",marginTop:4}}>מושאל ל-<strong>{w.student_name}</strong></div>
                </div>
                <div style={{fontSize:13,color:"var(--text2)"}}>↩ החזרה: {formatDate(w.return_date)} {w.return_time}</div>
              </div>
            ))}
          </div>
          <div className="highlight-box" style={{marginTop:16}}>
            כדאי להמתין להחזרת הציוד של <strong>{dashConsecutiveWarning.warnings[0]?.student_name}</strong> לפני אישור הבקשה של <strong>{dashConsecutiveWarning.reservation.student_name}</strong>.
          </div>
        </Modal>
      )}
    </div>
  );
}
