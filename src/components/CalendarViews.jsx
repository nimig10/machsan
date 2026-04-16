// CalendarViews.jsx — DeptHeadCalendarPage and ManagerCalendarPage
import { useState } from "react";
import { CalendarGrid } from "./CalendarGrid.jsx";
import { formatDate, today, storageGet, storageSet, cloudinaryThumb } from "../utils.js";

export function DeptHeadCalendarPage({ reservations: initialReservations, kits=[], equipment=[], siteSettings={} }) {
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
  const LOAN_ICONS     = { "פרטית":"👤","הפקה":"🎬","סאונד":"🎙️","קולנוע יומית":"🎥","צוות":"💼","הכל":"📦" };

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
        {["הכל","פרטית","הפקה","סאונד","קולנוע יומית","צוות"].map(lt=>{
          const active=loanTypeF===lt;
          const label = lt==="צוות" ? "איש צוות" : lt;
          return <button key={lt} type="button" onClick={()=>setLoanTypeF(lt)}
            style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
            {LOAN_ICONS[lt]||"📦"} {label}
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
                                  ? <img src={cloudinaryThumb(eq.image)} alt={item.name} style={{width:"100%",height:"100%",objectFit:"contain"}}/>
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

export function ManagerCalendarPage({ reservations: initialReservations, setReservations, collegeManager, equipment=[], kits=[], siteSettings={} }) {
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
  const LOAN_ICONS    = { "פרטית":"👤","הפקה":"🎬","סאונד":"🎙️","קולנוע יומית":"🎥","צוות":"💼","הכל":"📦" };
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
      // Atomic RPC (migration 009). Serializes concurrent status changes
      // and recomputes available_units when transitioning into/out of the
      // "currently out of warehouse" window.
      const returnedAt = newStatus === "הוחזר" ? new Date().toISOString() : null;
      const rpcResult = await updateReservationStatus(r.id, newStatus, { returned_at: returnedAt });
      if (!rpcResult.ok) {
        console.error("CalendarViews changeStatus RPC failed:", rpcResult);
        return;
      }
      // Refresh local + blob cache. DB is already the source of truth.
      const allRes = await storageGet("reservations");
      const updated = (allRes||[]).map(x => x.id===r.id ? {...x, status:newStatus} : x);
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
        {["הכל","פרטית","הפקה","סאונד","קולנוע יומית","צוות"].map(lt=>{
          const active=loanTypeF===lt;
          const label = lt==="צוות" ? "איש צוות" : lt;
          return <button key={lt} type="button" onClick={()=>setLoanTypeF(lt)}
            style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
            {LOAN_ICONS[lt]||"📦"} {label}
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
