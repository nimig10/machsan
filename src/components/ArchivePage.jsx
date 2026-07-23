// ArchivePage.jsx — archive of returned reservations
import { useMemo, useState } from "react";
import { formatDate, formatTime, deleteReservation as deleteReservationRpc, groupReservationItemsByCategory } from "../utils.js";
import { Calendar, ChevronLeft, ChevronRight, Film, Mic, Package, X } from "lucide-react";
import { ApprovedByLabel, UpdateHistoryList } from "./reservationActors.jsx";

const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

// Does the loan window [borrow_date, return_date] touch [fromISO, toISO]?
// Same overlap semantics as the productions board (productionInMonth): a loan
// that went out in June and came back in July belongs to BOTH months, which is
// exactly what forensics needs — "who was holding this item during that time".
// Dates are YYYY-MM-DD strings, so plain string comparison is correct. Either
// bound may be empty (open-ended range).
function loanOverlapsRange(r, fromISO, toISO) {
  const start = String(r?.borrow_date || "");
  const end = String(r?.return_date || r?.borrow_date || "");
  if (!start) return false;
  if (fromISO && end < fromISO) return false;
  if (toISO && start > toISO) return false;
  return true;
}

const monthBounds = (yr, mo /* 0-based */) => ({
  from: `${yr}-${String(mo + 1).padStart(2, "0")}-01`,
  to: `${yr}-${String(mo + 1).padStart(2, "0")}-${String(new Date(yr, mo + 1, 0).getDate()).padStart(2, "0")}`,
});

export function ArchivePage({ reservations, setReservations, equipment, showToast, loanHandlers = [], reservationUpdates = [], categories = [] }) {
  const archived = reservations.filter(r => r.status === "הוחזר");
  const [search, setSearch] = useState("");
  const [sectionF, setSectionF] = useState("הכל"); // "הכל" | "השאלות" | "שיעורים"
  const [loanTypeF, setLoanTypeF] = useState("הכל");
  const [viewRes, setViewRes] = useState(null);
  // ── time filter ──  mode: "all" | "month" | "range"
  const [timeMode, setTimeMode] = useState("all");
  const now = new Date();
  const [calYr, setCalYr] = useState(now.getFullYear());
  const [calMo, setCalMo] = useState(now.getMonth());
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  // ── equipment filter ──  set of equipment ids (as strings), OR semantics
  const [eqFilter, setEqFilter] = useState([]);
  const [eqPickerOpen, setEqPickerOpen] = useState(false);
  const [eqPickerSearch, setEqPickerSearch] = useState("");

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
    showToast("success", "הבקשה נמחקה מהארכיון", {
      aggregateKey: "archive-delete",
      pluralize: n => `${n} בקשות נמחקו מהארכיון`,
    });
  };

  const eqName = id => equipment.find(e=>e.id==id)?.name||"?";
  const EqImg = ({id,size=20}) => {
    const img = equipment.find(e=>e.id==id)?.image || null;
    if (!img) return <Package size={size*0.8} strokeWidth={1.75} />;
    return img.startsWith("data:")||img.startsWith("http")
      ? <img src={img} alt="" style={{width:size,height:size,objectFit:"cover",borderRadius:4,verticalAlign:"middle"}}/>
      : <span style={{fontSize:size*0.8}}>{img}</span>;
  };

  // The archive documents what physically LEFT the warehouse, which is not always
  // what reservation_items holds at the end: a partial return of an overdue loan
  // decrements (and eventually deletes) those rows to release stock back into the
  // pool. `original_items` is the frozen snapshot taken before the first such
  // decrement — when it exists it is the truthful record. NULL (the overwhelming
  // majority: no partial return ever happened) falls back to the live items.
  const archiveItems = (r) => {
    const snapshot = Array.isArray(r?.original_items) ? r.original_items : null;
    return snapshot && snapshot.length ? snapshot : (r?.items || []);
  };

  // Who handled the return. Two different facts, never conflated:
  //   returned_by_name  — who ACTUALLY clicked הוחזר (JWT-derived, trustworthy)
  //   reservation_staff_assignments(kind='return') — who was PLANNED to, in the
  //   staff roster. Shown only as a muted fallback, with different wording, so
  //   a name under "איש צוות מטפל" always means the person really did it.
  // Lessons auto-archive on a clock with no human involved, and the roster
  // never covers them, so they render nothing at all.
  const returnActorFor = (r) => {
    if (r?.loan_type === "שיעור") return null;
    const actual = String(r?.returned_by_name || "").trim();
    if (actual) return { kind: "actual", name: actual };
    const planned = (loanHandlers || []).find(
      (h) => String(h.reservation_id) === String(r?.id) && h.kind === "return"
    );
    const plannedName = String(planned?.staff_name || "").trim();
    if (plannedName) return { kind: "planned", name: plannedName };
    return { kind: "none" };
  };

  const ReturnActor = ({ r, style }) => {
    const actor = returnActorFor(r);
    if (!actor) return null;
    if (actor.kind === "planned") {
      return <span style={{color:"var(--text2)",fontStyle:"italic",...style}}>🗓 אחראי החזרה (מתוכנן): <strong style={{color:"var(--text)"}}>{actor.name}</strong></span>;
    }
    if (actor.kind === "none") {
      return <span style={{color:"var(--text2)",...style}}>👤 איש צוות מטפל: לא נרשם</span>;
    }
    return <span style={{color:"var(--text2)",...style}}>👤 איש צוות מטפל: <strong style={{color:"var(--accent)",fontWeight:800}}>{actor.name}</strong></span>;
  };

  const LOAN_ICONS = {"פרטית":"👤","הפקה":<Film size={11} strokeWidth={1.75} color="var(--accent)" />,"סאונד":<Mic size={11} strokeWidth={1.75} color="var(--accent)" />,"קולנוע יומית":"🎥","שיעור":"📽️"};
  const sortByReturned = arr => [...arr].sort((a,b)=>(new Date(b.returned_at||b.return_date).getTime())-(new Date(a.returned_at||a.return_date).getTime()));

  const matchesSearch = r => !search || r.student_name?.includes(search) || r.email?.includes(search) || r.course?.includes(search);

  // ── time + equipment filters ─────────────────────────────────────────────
  const activeRange = timeMode === "month" ? monthBounds(calYr, calMo)
    : timeMode === "range" ? { from: fromDate, to: toDate }
    : null;
  const eqSet = new Set(eqFilter.map(String));
  const matchesTime = r => !activeRange || loanOverlapsRange(r, activeRange.from, activeRange.to);
  // Matched against archiveItems — the frozen original_items snapshot, NOT the
  // live rows (lesson #35): after a partial return reservation_items shrinks,
  // and forensics must find the loan by what actually LEFT the warehouse.
  const matchesEq = r => eqSet.size === 0 || archiveItems(r).some(i => eqSet.has(String(i.equipment_id)));

  // How many archived reservations used each equipment id — the picker shows
  // this next to every item, which directly answers "how often was this
  // borrowed". Counted once per reservation, not per row.
  const eqUsage = useMemo(() => {
    const map = new Map();
    for (const r of reservations) {
      if (r.status !== "הוחזר") continue;
      const snapshot = Array.isArray(r?.original_items) && r.original_items.length ? r.original_items : (r?.items || []);
      const seen = new Set();
      for (const i of snapshot) {
        const id = String(i.equipment_id);
        if (seen.has(id)) continue;
        seen.add(id);
        map.set(id, (map.get(id) || 0) + 1);
      }
    }
    return map;
  }, [reservations]);

  const lessonArchive = sortByReturned(archived.filter(r=>r.loan_type==="שיעור"&&matchesSearch(r)&&matchesTime(r)&&matchesEq(r)));
  const studentArchive = sortByReturned(archived.filter(r=>r.loan_type!=="שיעור"&&matchesSearch(r)&&matchesTime(r)&&matchesEq(r)&&(loanTypeF==="הכל"||r.loan_type===loanTypeF)));

  const showLessons  = sectionF==="הכל"||sectionF==="שיעורים";
  const showStudents = sectionF==="הכל"||sectionF==="השאלות";
  const totalShown   = (showLessons?lessonArchive.length:0)+(showStudents?studentArchive.length:0);

  // Count for the month pager label: everything the current NON-time filters
  // pass, inside the paged month — so the number always matches what the list
  // will show when this month is selected.
  const monthCount = (() => {
    if (timeMode !== "month") return null;
    const { from, to } = monthBounds(calYr, calMo);
    return archived.filter(r =>
      matchesSearch(r) && matchesEq(r) && loanOverlapsRange(r, from, to)
      && (showLessons || r.loan_type !== "שיעור") && (showStudents || r.loan_type === "שיעור")
      && (r.loan_type === "שיעור" || loanTypeF === "הכל" || r.loan_type === loanTypeF)
    ).length;
  })();

  const anyFilterActive = !!search || timeMode !== "all" || eqFilter.length > 0 || loanTypeF !== "הכל" || sectionF !== "הכל";
  const clearAllFilters = () => {
    setSearch(""); setSectionF("הכל"); setLoanTypeF("הכל");
    setTimeMode("all"); setFromDate(""); setToDate("");
    setEqFilter([]); setEqPickerOpen(false); setEqPickerSearch("");
  };

  const stepMonth = (delta) => {
    const d = new Date(calYr, calMo + delta, 1);
    setCalYr(d.getFullYear()); setCalMo(d.getMonth());
  };

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
          <span><Calendar size={14} strokeWidth={1.75} color="var(--accent)" /> {formatDate(r.borrow_date)}{r.borrow_time&&<strong style={{color:"var(--accent)",marginRight:4}}> {formatTime(r.borrow_time)}</strong>}</span>
          <span>↩ {formatDate(r.return_date)}{r.return_time&&<strong style={{color:"var(--accent)",marginRight:4}}> {formatTime(r.return_time)}</strong>}</span>
          <span><Package size={14} strokeWidth={1.75} color="var(--accent)" /> {archiveItems(r).length} פריטים</span>
          {r.returned_at&&<span style={{color:"var(--text3)"}}>🕐 הוחזר: {new Date(r.returned_at).toLocaleDateString("he-IL")}</span>}
          <ReturnActor r={r}/>
          <ApprovedByLabel reservation={r}/>
        </div>
        <div style={{marginTop:8,display:"flex",flexWrap:"wrap",gap:4}}>
          {archiveItems(r).map((i,j)=><span key={j} className="chip"><EqImg id={i.equipment_id}/> {eqName(i.equipment_id)} ×{i.quantity}</span>)}
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
      <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
        <div className="search-bar" style={{flex:1,minWidth:160}}><span>🔍</span><input placeholder="חיפוש לפי שם, מייל או קורס..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <span style={{fontSize:13,color:"var(--text3)"}}>
          מציג <strong style={{color:"var(--text)"}}>{totalShown}</strong> מתוך <strong style={{color:"var(--text)"}}>{archived.length}</strong>
        </span>
        {anyFilterActive&&(
          <button type="button" onClick={clearAllFilters}
            style={{background:"transparent",color:"#e74c3c",border:"1px solid rgba(231,76,60,0.4)",borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer",minHeight:32}}>
            ✕ נקה סינון
          </button>
        )}
      </div>

      {/* ── Time filter row ── */}
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:12,fontWeight:800,color:"var(--text3)"}}>🕐 זמן:</span>
        {[["all","הכל"],["month","לפי חודש"],["range","טווח מותאם"]].map(([val,label])=>(
          <button key={val} type="button" onClick={()=>setTimeMode(val)}
            style={{padding:"6px 14px",borderRadius:20,border:`1.5px solid ${timeMode===val?"var(--accent)":"var(--border)"}`,background:timeMode===val?"var(--accent-glow)":"transparent",color:timeMode===val?"var(--accent)":"var(--text2)",fontWeight:timeMode===val?800:400,fontSize:13,cursor:"pointer",minHeight:34}}>
            {label}
          </button>
        ))}
        {timeMode==="month"&&(
          <div style={{display:"flex",alignItems:"center",gap:6,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:10,padding:"4px 8px"}}>
            {/* RTL: older months sit to the RIGHT of the timeline */}
            <button type="button" title="חודש קודם" onClick={()=>stepMonth(-1)}
              style={{background:"transparent",border:"none",color:"var(--text2)",cursor:"pointer",padding:6,minWidth:38,minHeight:38,display:"inline-flex",alignItems:"center",justifyContent:"center"}}>
              <ChevronRight size={18} strokeWidth={2}/>
            </button>
            <span style={{fontWeight:800,fontSize:14,color:"var(--text)",minWidth:110,textAlign:"center"}}>
              {HE_MONTHS[calMo]} {calYr}
              {monthCount!=null&&<span style={{marginRight:6,background:"var(--accent-glow)",color:"var(--accent)",border:"1px solid rgba(245,166,35,0.35)",borderRadius:20,padding:"0 8px",fontSize:11,fontWeight:800}}>{monthCount}</span>}
            </span>
            <button type="button" title="חודש הבא" onClick={()=>stepMonth(1)}
              style={{background:"transparent",border:"none",color:"var(--text2)",cursor:"pointer",padding:6,minWidth:38,minHeight:38,display:"inline-flex",alignItems:"center",justifyContent:"center"}}>
              <ChevronLeft size={18} strokeWidth={2}/>
            </button>
          </div>
        )}
        {timeMode==="range"&&(
          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
            <label style={{fontSize:12,color:"var(--text3)"}}>מ-</label>
            <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}
              style={{padding:"7px 10px",borderRadius:8,border:"1px solid var(--border)",background:"var(--surface2)",color:"var(--text)",fontSize:16}}/>
            <label style={{fontSize:12,color:"var(--text3)"}}>עד</label>
            <input type="date" value={toDate} onChange={e=>setToDate(e.target.value)}
              style={{padding:"7px 10px",borderRadius:8,border:"1px solid var(--border)",background:"var(--surface2)",color:"var(--text)",fontSize:16}}/>
          </div>
        )}
      </div>

      {/* ── Equipment filter row ── */}
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
        <button type="button" onClick={()=>setEqPickerOpen(o=>!o)}
          style={{padding:"6px 14px",borderRadius:20,border:`1.5px solid ${eqFilter.length?"var(--accent)":eqPickerOpen?"var(--accent)":"var(--border)"}`,background:eqFilter.length?"var(--accent-glow)":"transparent",color:eqFilter.length||eqPickerOpen?"var(--accent)":"var(--text2)",fontWeight:eqFilter.length?800:600,fontSize:13,cursor:"pointer",minHeight:34,display:"inline-flex",alignItems:"center",gap:6}}>
          <Package size={14} strokeWidth={1.75}/> סינון לפי ציוד{eqFilter.length>0&&` (${eqFilter.length})`} {eqPickerOpen?"▴":"▾"}
        </button>
        {eqFilter.map(id=>(
          <span key={id} style={{display:"inline-flex",alignItems:"center",gap:5,background:"var(--surface2)",border:"1px solid var(--accent)",borderRadius:20,padding:"4px 10px",fontSize:12,fontWeight:700,color:"var(--text)"}}>
            <EqImg id={id} size={16}/> {eqName(id)}
            <button type="button" title="הסר" onClick={()=>setEqFilter(f=>f.filter(x=>String(x)!==String(id)))}
              style={{background:"transparent",border:"none",color:"#e74c3c",cursor:"pointer",padding:0,display:"inline-flex",alignItems:"center"}}>
              <X size={13} strokeWidth={2.4}/>
            </button>
          </span>
        ))}
      </div>

      {/* ── Equipment picker panel ── */}
      {eqPickerOpen&&(()=>{
        const searchLc = eqPickerSearch.trim().toLowerCase();
        // Only equipment that actually appears in the archive — picking anything
        // else can only produce an empty list (lesson #34: the chips and the
        // list must agree). Sorted by how often it was borrowed.
        const pool = equipment
          .filter(e=>eqUsage.has(String(e.id)))
          .filter(e=>!searchLc||String(e.name||"").toLowerCase().includes(searchLc));
        const byCat = new Map();
        for (const e of pool) {
          const cat = e.category||"ללא קטגוריה";
          if(!byCat.has(cat)) byCat.set(cat, []);
          byCat.get(cat).push(e);
        }
        // Admin category order first (same order the equipment pages use),
        // then anything left over.
        const orderedCats = [
          ...categories.filter(c=>byCat.has(c)),
          ...[...byCat.keys()].filter(c=>!categories.includes(c)),
        ];
        return (
          // Single-column list with full names, capped narrow (420px) and
          // dropped under the button like a menu — the original problem was a
          // panel that spanned the whole page, not the list format itself.
          <div style={{maxWidth:420,background:"var(--surface)",border:"1px solid var(--accent)",borderRadius:12,padding:"12px 14px",marginBottom:14,boxShadow:"0 8px 24px rgba(0,0,0,0.25)"}}>
            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10,flexWrap:"wrap"}}>
              <div className="search-bar" style={{flex:1,minWidth:150}}>
                <span>🔍</span>
                <input placeholder="חיפוש פריט ציוד..." value={eqPickerSearch} onChange={e=>setEqPickerSearch(e.target.value)} style={{fontSize:16}}/>
              </div>
              {eqFilter.length>0&&(
                <button type="button" onClick={()=>setEqFilter([])}
                  style={{background:"transparent",color:"#e74c3c",border:"1px solid rgba(231,76,60,0.4)",borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
                  נקה בחירה
                </button>
              )}
            </div>
            <div style={{fontSize:11,color:"var(--text3)",marginBottom:8}}>המספר ליד כל פריט = בכמה בקשות מוחזרות הוא הופיע</div>
            <div style={{maxHeight:320,overflowY:"auto",display:"flex",flexDirection:"column",gap:2,paddingLeft:4}}>
              {pool.length===0&&<div style={{textAlign:"center",color:"var(--text3)",fontSize:13,padding:"16px 0"}}>לא נמצא ציוד תואם בארכיון</div>}
              {orderedCats.map(cat=>(
                <div key={cat}>
                  <div style={{fontSize:11,fontWeight:800,color:"var(--accent)",margin:"8px 2px 4px"}}>{cat}</div>
                  {byCat.get(cat).map(e=>{
                    const id=String(e.id);
                    const on=eqSet.has(id);
                    return (
                      <button key={id} type="button"
                        onClick={()=>setEqFilter(f=>on?f.filter(x=>String(x)!==id):[...f,id])}
                        style={{width:"100%",display:"flex",alignItems:"center",gap:9,padding:"7px 9px",borderRadius:8,border:`1px solid ${on?"var(--accent)":"transparent"}`,background:on?"var(--accent-glow)":"transparent",color:"var(--text)",fontSize:13,cursor:"pointer",textAlign:"right"}}>
                        <span style={{width:16,height:16,borderRadius:4,border:`1.5px solid ${on?"var(--accent)":"var(--border)"}`,background:on?"var(--accent)":"transparent",display:"inline-flex",alignItems:"center",justifyContent:"center",color:"#000",fontSize:11,fontWeight:900,flexShrink:0}}>{on?"✓":""}</span>
                        <EqImg id={e.id} size={22}/>
                        {/* full name, wraps if long — never truncated */}
                        <span style={{flex:1,fontWeight:on?800:600,overflowWrap:"anywhere"}}>{e.name}</span>
                        <span style={{background:"var(--surface3)",border:"1px solid var(--border)",borderRadius:20,padding:"0 8px",fontSize:11,fontWeight:700,color:"var(--text2)",flexShrink:0}}>{eqUsage.get(id)}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

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
                {/* Who handled the return — sits with the people facts, not with
                    the equipment list at the bottom of the modal. */}
                {(returnActorFor(viewRes) || viewRes.approved_by_name || (reservationUpdates||[]).some(u=>String(u.reservation_id)===String(viewRes.id)&&u.review_status!=="pending")) && (
                  <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid var(--border)",fontSize:13,display:"flex",flexDirection:"column",gap:6}}>
                    <ReturnActor r={viewRes}/>
                    <ApprovedByLabel reservation={viewRes}/>
                    <UpdateHistoryList updates={reservationUpdates} reservationId={viewRes.id}/>
                  </div>
                )}
              </div>
              <div style={{background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:"14px 16px"}}>
                <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",marginBottom:10,textTransform:"uppercase",letterSpacing:1}}>תאריכים</div>
                <div className="responsive-split">
                  {[[<><Calendar size={13} strokeWidth={1.75} color="var(--accent)" /> השאלה</>,`${formatDate(viewRes.borrow_date)}${viewRes.borrow_time?" · "+formatTime(viewRes.borrow_time):""}`],["↩ החזרה",`${formatDate(viewRes.return_date)}${viewRes.return_time?" · "+formatTime(viewRes.return_time):""}`]].map(([l,v])=>(
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
                {/* Grouped by category — long archived loans are hard to scan flat.
                    Source is archiveItems (not viewRes.items) so the original-loan
                    snapshot from a partial return keeps being what is documented. */}
                {groupReservationItemsByCategory(archiveItems(viewRes), equipment).map(group=>(
                  <div key={group.category}>
                    <div style={{fontSize:11,fontWeight:800,color:"var(--accent)",marginTop:8,marginBottom:2}}>{group.category}</div>
                    {group.entries.map(({item,index})=>(
                      <div key={index} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:"1px solid var(--border)"}}>
                        <EqImg id={item.equipment_id} size={28}/>
                        <span style={{flex:1,fontSize:13,fontWeight:600}}>{eqName(item.equipment_id)}</span>
                        <span style={{background:"var(--surface3)",border:"1px solid var(--border)",borderRadius:6,padding:"2px 10px",fontWeight:700,fontSize:13,color:"var(--accent)"}}>×{item.quantity}</span>
                      </div>
                    ))}
                  </div>
                ))}
                <div style={{marginTop:8,fontSize:12,color:"var(--text3)"}}>
                  סה״כ: <strong style={{color:"var(--text)"}}>{archiveItems(viewRes).reduce((s,i)=>s+(Number(i.quantity)||0),0)}</strong> יחידות
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
