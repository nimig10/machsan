// ArchivePage.jsx — archive of returned reservations
import { useState } from "react";
import { formatDate, deleteReservation as deleteReservationRpc } from "../utils.js";
import { Calendar, Film, Mic, Package, X } from "lucide-react";

export function ArchivePage({ reservations, setReservations, equipment, showToast }) {
  const archived = reservations.filter(r => r.status === "הוחזר");
  const [search, setSearch] = useState("");
  const [sectionF, setSectionF] = useState("הכל"); // "הכל" | "השאלות" | "שיעורים"
  const [loanTypeF, setLoanTypeF] = useState("הכל");
  const [viewRes, setViewRes] = useState(null);

  const deleteRes = async (id) => {
    if(!window.confirm("למחוק בקשה זו מהארכיון לצמיתות?")) return;
    // Atomic delete via delete_reservation_v1 RPC (migration 012). The old
    // path — setReservations + storageSet('reservations', list) — had a
    // 2–14s window during which polls/realtime could re-insert the row.
    const prev = reservations;
    const updated = reservations.filter(r=>r.id!==id);
    setReservations(updated);
    if(viewRes?.id===id) setViewRes(null);
    const rpc = await deleteReservationRpc(id);
    if (!rpc.ok) {
      console.error("ArchivePage deleteRes RPC failed:", rpc);
      showToast("error", "המחיקה נכשלה בשרת — הפריט עלול לחזור לאחר ריענון");
      setReservations(prev);
      return;
    }
    showToast("success", "הבקשה נמחקה מהארכיון");
  };

  const eqName = id => equipment.find(e=>e.id==id)?.name||"?";
  const EqImg = ({id,size=20}) => {
    const img = equipment.find(e=>e.id==id)?.image||null;
    return img.startsWith("data:")||img.startsWith("http")
      ? <img src={img} alt="" style={{width:size,height:size,objectFit:"cover",borderRadius:4,verticalAlign:"middle"}}/>
      : <span style={{fontSize:size*0.8}}>{img}</span>;
  };

  const LOAN_ICONS = {"פרטית":"👤","הפקה":<Film size={11} strokeWidth={1.75} color="var(--accent)" />,"סאונד":<Mic size={11} strokeWidth={1.75} color="var(--accent)" />,"קולנוע יומית":"🎥","שיעור":"📽️"};
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
            {r.loan_type&&!isLesson&&<span style={{background:"var(--surface3)",border:"1px solid var(--border)",borderRadius:20,padding:"2px 8px",fontSize:11,color:"var(--accent)",fontWeight:700,display:"inline-flex",alignItems:"center",gap:4}}>{LOAN_ICONS[r.loan_type]||<Package size={11} strokeWidth={1.75} color="var(--accent)" />} {r.loan_type}</span>}
            <button className="btn btn-danger btn-sm" onClick={e=>{e.stopPropagation();deleteRes(r.id);}}>🗑️</button>
          </div>
        </div>
        <div style={{marginTop:10,display:"flex",gap:16,fontSize:12,color:"var(--text2)",flexWrap:"wrap"}}>
          <span><Calendar size={14} strokeWidth={1.75} color="var(--accent)" /> {formatDate(r.borrow_date)}{r.borrow_time&&<strong style={{color:"var(--accent)",marginRight:4}}> {r.borrow_time}</strong>}</span>
          <span>↩ {formatDate(r.return_date)}{r.return_time&&<strong style={{color:"var(--accent)",marginRight:4}}> {r.return_time}</strong>}</span>
          <span><Package size={14} strokeWidth={1.75} color="var(--accent)" /> {r.items?.length||0} פריטים</span>
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
        {[["הכל",<><Package size={13} strokeWidth={1.75} /> הכל</>,"var(--text2)"],["השאלות","🎒 השאלות סטודנטים","var(--blue)"],["שיעורים","📽️ שיעורים","#9b59b6"]].map(([val,label,col])=>(
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
              <button className="btn btn-secondary btn-sm" onClick={()=>setViewRes(null)}><X size={14} strokeWidth={1.75} color="var(--text3)" /> סגור</button>
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
                  {[[<><Calendar size={13} strokeWidth={1.75} color="var(--accent)" /> השאלה</>,`${formatDate(viewRes.borrow_date)}${viewRes.borrow_time?" · "+viewRes.borrow_time:""}`],["↩ החזרה",`${formatDate(viewRes.return_date)}${viewRes.return_time?" · "+viewRes.return_time:""}`]].map(([l,v])=>(
                    <div key={l} style={{background:"var(--surface3)",borderRadius:"var(--r-sm)",padding:"10px 12px"}}>
                      <div style={{fontSize:11,color:"var(--text3)",marginBottom:4}}>{l}</div>
                      <div style={{fontWeight:700,fontSize:13,color:"var(--accent)"}}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:8,fontSize:12,color:"var(--text3)"}}>
                  סוג השאלה: <strong style={{color:"var(--text)"}}>{LOAN_ICONS[viewRes.loan_type]||<Package size={13} strokeWidth={1.75} color="var(--accent)" />} {viewRes.loan_type}</strong>
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
