// PublicForm.jsx — public loan request form
import { useState, useRef, useMemo } from "react";
import { storageGet, storageSet, formatDate, formatLocalDateInput, parseLocalDate, today, getAvailable, toDateTime, getNextSoundDayLoanDate, getFutureTimeSlotsForDate, getPrivateLoanLimitedQty, normalizeName, isValidEmailAddress, NIMROD_PHONE, DEFAULT_CATEGORIES, FAR_FUTURE } from "../utils.js";
import { CalendarGrid } from "./CalendarGrid.jsx";

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
  const LOAN_FILTERS = [{key:"הכל",label:"הכל",icon:"📦"},{key:"פרטית",label:"פרטית",icon:"👤"},{key:"הפקה",label:"הפקה",icon:"🎬"},{key:"סאונד",label:"סאונד",icon:"🎙️"},{key:"קולנוע יומית",label:"קולנוע יומית",icon:"🎥"}];
  const activeRes = reservations.filter(r=>
    (r.status==="מאושר"||r.status==="באיחור") && r.borrow_date && r.return_date &&
    r.loan_type !== "שיעור" &&
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
        <div style={{fontWeight:800,fontSize:13,color:"var(--text2)"}}>📅 השאלות הפעילות</div>
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
    const isGeneral = (!eq.soundOnly && !eq.photoOnly) || (eq.soundOnly && eq.photoOnly);
    if (equipmentFilter === "sound") return !!eq.soundOnly || isGeneral;
    if (equipmentFilter === "photo") return !!eq.photoOnly || isGeneral;
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
                    : eq.overdueBlocked
                    ? <div style={{fontSize:11,color:"#e67e22",fontWeight:700,textAlign:"center",maxWidth:130,lineHeight:1.3,padding:"5px 8px",background:"rgba(230,126,34,0.1)",borderRadius:6,border:"1px solid rgba(230,126,34,0.35)"}}>
                        ⚠️ חסום ע״י השאלה באיחור
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
function InfoPanel({ policies, kits, equipment, teamMembers, onClose, accentColor }) {
  const [tab, setTab] = useState("policies");
  const [selectedEq, setSelectedEq] = useState(null);  // equipment detail view
  const [infoCatFilter, setInfoCatFilter] = useState([]); // multi-select
  const tabs = [
    { id:"equipment", label:"📦 ציוד" },
    { id:"policies",  label:"📋 נהלים" },
    { id:"kits",      label:"🎒 ערכות" },
    { id:"contact",   label:"📞 צוות" },
  ];
  const LOAN_ICONS = { "פרטית":"👤","הפקה":"🎬","סאונד":"🎙️","קולנוע יומית":"🎥" };
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
              {["פרטית","הפקה","סאונד","קולנוע יומית"].map(lt=>{
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
export function PublicForm({ equipment, reservations, setReservations, showToast, categories=DEFAULT_CATEGORIES, kits=[], teamMembers=[], policies={}, certifications={types:[],students:[]}, deptHeads=[], calendarToken="", siteSettings={} }) {
  const initialParams = new URLSearchParams(window.location.search);
  const initialLoanTypeParam = initialParams.get("loan_type");
  const initialStepParam = Number(initialParams.get("step"));
  const initialLoanType = ["פרטית","הפקה","סאונד","קולנוע יומית"].includes(initialLoanTypeParam || "") ? initialLoanTypeParam : "";
  const initialStep = initialParams.get("calendar")==="1"
    ? 2
    : (Number.isInteger(initialStepParam) && initialStepParam >= 1 && initialStepParam <= 4 ? initialStepParam : 1);
  const [step, setStep]       = useState(initialStep);
  const swipeTouchRef = useRef(null);
  const [form, setForm]       = useState({student_name:"",email:"",phone:"",course:"",project_name:"",borrow_date:"",borrow_time:"",return_date:"",return_time:"",loan_type:initialLoanType,sound_day_loan:false,crew_photographer_name:"",crew_photographer_phone:"",crew_sound_name:"",crew_sound_phone:""});
  const [items, setItems]     = useState([]);
  const [agreed, setAgreed]   = useState(false);
  const [done, setDone]       = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [submitting, setSub]  = useState(false);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [loggedInStudent, setLoggedInStudent] = useState(null); // null = not logged in
  const [loginForm, setLoginForm] = useState({ name:"", email:"" });
  const [loginError, setLoginError] = useState("");
  const [publicView, setPublicView] = useState("equipment"); // "equipment" | "studios"
  const [studioBookings, setStudioBookings] = useState([]);
  const [studios, setStudios] = useState([]);
  const [studioWeekOffset, setStudioWeekOffset] = useState(0);
  const [studioModal, setStudioModal] = useState(null);

  // Load studios data when switching to studios view
  const loadStudiosData = async () => {
    const [s, b] = await Promise.all([storageGet("studios"), storageGet("studio_bookings")]);
    if (Array.isArray(s)) setStudios(s);
    if (Array.isArray(b)) setStudioBookings(b);
  };

  const handleStudentLogin = () => {
    const name = loginForm.name.trim();
    const email = loginForm.email.toLowerCase().trim();
    if (!name || !email) return;
    const stuList = certifications.students || [];
    const found = stuList.find(s => s.email?.toLowerCase() === email && s.name?.trim().toLowerCase() === name.toLowerCase());
    if (!found) { setLoginError("הפרטים לא תואמים למשתמש רשום במערכת"); return; }
    setLoggedInStudent(found);
    setLoginError("");
    set("student_name", found.name);
    set("email", found.email);
    if (found.phone) set("phone", found.phone);
    if (found.track) set("course", found.track);
  };

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

  const minDays = form.loan_type==="פרטית" ? 2 : form.loan_type==="סאונד" ? 0 : form.loan_type==="קולנוע יומית" ? 0 : 7;
  const isCinemaLoan = form.loan_type==="קולנוע יומית";
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
    if (isCinemaLoan) {
      // Cinema: 24h ahead minimum
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return moveToNextWeekday(formatLocalDateInput(d));
    }
    const d = new Date();
    d.setDate(d.getDate() + minDays);
    return moveToNextWeekday(formatLocalDateInput(d));
  })();
  const maxDays = form.loan_type==="פרטית" ? 4 : isCinemaLoan ? 1 : 7;
  const tooSoon = form.loan_type!=="סאונד" && !isCinemaLoan && !!form.borrow_date && form.borrow_date < minDate;
  const cinemaTooSoon = isCinemaLoan && !!form.borrow_date && form.borrow_date < minDate;
  const loanDays = (form.borrow_date && form.return_date)
    ? Math.ceil((parseLocalDate(form.return_date) - parseLocalDate(form.borrow_date)) / 86400000) + 1
    : 0;
  const tooLong = loanDays > maxDays;
  const CINEMA_TIME_SLOTS = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30","20:00","20:30","21:00"];
  const TIME_SLOTS = (form.loan_type==="סאונד" || isCinemaLoan)
    ? CINEMA_TIME_SLOTS
    : ["09:00","09:30","14:30","15:00","15:30","16:00","16:30","17:00","17:30"];
  const isSoundLoan = form.loan_type==="סאונד";
  const isProductionLoan = form.loan_type==="הפקה";
  const isSoundDayLoan = isSoundLoan && !!form.sound_day_loan;
  const soundDayLoanDate = isSoundDayLoan ? getNextSoundDayLoanDate(TIME_SLOTS) : "";
  const disableSoundDayHourLimit = true;
  const availableBorrowSlots = isSoundDayLoan && !disableSoundDayHourLimit ? getFutureTimeSlotsForDate(soundDayLoanDate, TIME_SLOTS) : TIME_SLOTS;
  // Cinema: limit return time to max 6 hours after borrow time
  const cinemaMaxReturnSlots = (() => {
    if (!isCinemaLoan || !form.borrow_time) return TIME_SLOTS;
    const [bh, bm] = form.borrow_time.split(":").map(Number);
    const maxMinutes = (bh * 60 + bm) + 360; // +6 hours
    return TIME_SLOTS.filter(t => {
      const [h, m] = t.split(":").map(Number);
      const mins = h * 60 + m;
      return mins > (bh * 60 + bm) && mins <= maxMinutes;
    });
  })();
  const availableReturnSlots = isCinemaLoan
    ? cinemaMaxReturnSlots
    : isSoundDayLoan
      ? disableSoundDayHourLimit
        ? TIME_SLOTS
        : availableBorrowSlots.filter((slot) => !form.borrow_time || toDateTime(soundDayLoanDate, slot) > toDateTime(soundDayLoanDate, form.borrow_time))
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
  const ok2 = !!form.borrow_date && !!form.return_date && hasTimes && !returnBeforeBorrow && !tooSoon && !cinemaTooSoon && !tooLong && !borrowWeekend && !returnWeekend && !timeOrderError;
  const ok3 = items.some(item => Number(item.quantity) > 0);
  const canSubmit = !!ok1 && !!ok2 && !!ok3 && !privateLoanLimitExceeded && !!agreed;

  const availEq = useMemo(()=>{
    if(!form.borrow_date||!form.return_date) return [];
    return equipment.map(eq=>{
      const avail = getAvailable(eq.id,form.borrow_date,form.return_date,reservations,equipment,null,form.borrow_time,form.return_time);
      // Check if the 0-availability is caused by an overdue reservation holding this item
      const overdueBlocked = avail === 0 && reservations.some(r =>
        r.status === "באיחור" && (r.items||[]).some(i => i.equipment_id == eq.id && Number(i.quantity) > 0)
      );
      return {...eq, avail, overdueBlocked};
    });
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
          logo_url:     siteSettings.logo || "",
          sound_logo_url: siteSettings.soundLogo || "",
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
            logo_url:     siteSettings.logo || "",
            sound_logo_url: siteSettings.soundLogo || "",
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
                logo_url:       siteSettings.logo || "",
                sound_logo_url: siteSettings.soundLogo || "",
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
    const newRes = { ...form, id:Date.now(), status:initStatus, created_at:today(), submitted_at:new Date().toLocaleString("he-IL",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Jerusalem"}), items };
    const updated = [...freshReservations, newRes];
    setReservations(updated);
    await storageSet("reservations", updated);
    await sendEmail(newRes);
    setSub(false);
    setDone(true);
    showToast("success","הבקשה נשלחה בהצלחה!");
  };

  const reset = () => { setDone(false); setEmailError(false); setStep(1); setForm({student_name:"",email:"",phone:"",course:"",project_name:"",borrow_date:"",borrow_time:"",return_date:"",return_time:"",loan_type:"",sound_day_loan:false,crew_photographer_name:"",crew_photographer_phone:"",crew_sound_name:"",crew_sound_phone:""}); setItems([]); setAgreed(false); };

  const handleFormSwipeStart = (e) => {
    swipeTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const handleFormSwipeEnd = (e) => {
    if (!swipeTouchRef.current) return;
    const dx = e.changedTouches[0].clientX - swipeTouchRef.current.x;
    const dy = e.changedTouches[0].clientY - swipeTouchRef.current.y;
    swipeTouchRef.current = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0) goToStep(Math.min(step + 1, 4));
    else goToStep(Math.max(step - 1, 1));
  };

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

  // ── Student login gate ──
  if (!loggedInStudent) return (
    <div className="form-page" style={{"--accent": siteSettings.accentColor||"#f5a623"}}>
      <div style={{width:"100%",maxWidth:420,background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,padding:"40px 32px",textAlign:"center",direction:"rtl"}}>
        {siteSettings.logo
          ? <img src={siteSettings.logo} alt="לוגו" style={{width:82,height:82,objectFit:"contain",borderRadius:12,marginBottom:16,display:"block",marginInline:"auto"}}/>
          : <div style={{fontSize:48,marginBottom:16}}>🎬</div>}
        <h2 style={{fontSize:22,fontWeight:900,color:"var(--accent)",marginBottom:4}}>מחסן השאלת ציוד</h2>
        <div style={{fontSize:13,color:"var(--text3)",marginBottom:24}}>קמרה אובסקורה וסאונד</div>
        <div style={{textAlign:"right",marginBottom:12}}>
          <label style={{fontSize:13,fontWeight:700,color:"var(--text2)",display:"block",marginBottom:4}}>שם מלא</label>
          <input className="form-input" placeholder="הקלד/י שם מלא" value={loginForm.name}
            onChange={e=>{setLoginForm(p=>({...p,name:e.target.value}));setLoginError("");}}
            onKeyDown={e=>e.key==="Enter"&&handleStudentLogin()}/>
        </div>
        <div style={{textAlign:"right",marginBottom:16}}>
          <label style={{fontSize:13,fontWeight:700,color:"var(--text2)",display:"block",marginBottom:4}}>אימייל</label>
          <input className="form-input" type="email" placeholder="email@example.com" value={loginForm.email}
            onChange={e=>{setLoginForm(p=>({...p,email:e.target.value}));setLoginError("");}}
            onKeyDown={e=>e.key==="Enter"&&handleStudentLogin()}/>
        </div>
        {loginError && <div style={{color:"var(--red)",fontSize:13,fontWeight:700,marginBottom:12}}>❌ {loginError}</div>}
        <button className="btn btn-primary" style={{width:"100%",padding:"12px",fontSize:15}} onClick={handleStudentLogin}
          disabled={!loginForm.name.trim()||!loginForm.email.trim()}>🔑 כניסה למערכת</button>
        <div style={{fontSize:11,color:"var(--text3)",marginTop:16}}>רק סטודנטים רשומים יכולים להיכנס למערכת</div>
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
    <div className="form-page" style={{"--accent": siteSettings.accentColor||"#f5a623","--accent2": siteSettings.accentColor||"#f5a623","--accent-glow":`${siteSettings.accentColor||"#f5a623"}2e`}} onTouchStart={handleFormSwipeStart} onTouchEnd={handleFormSwipeEnd}>
      <div className="form-card">
        <div className="form-card-header" style={{position:"relative"}}>
          <button type="button" onClick={()=>setShowInfoPanel(true)}
            title="מידע כללי, נהלים וערכות"
            style={{position:"absolute",top:14,left:14,width:42,height:42,borderRadius:"50%",border:"none",background:"transparent",padding:0,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2,color:"var(--accent)",opacity:0.9,transition:"opacity 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.opacity=1}
            onMouseLeave={e=>e.currentTarget.style.opacity=0.9}>
            <svg width="42" height="42" viewBox="0 0 42 42" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="21" cy="21" r="19" stroke="currentColor" strokeWidth="2.2"/>
              <circle cx="21" cy="14.5" r="2.2" fill="currentColor"/>
              <rect x="19.4" y="19.5" width="3.2" height="10.5" rx="1.6" fill="currentColor"/>
            </svg>
          </button>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center",paddingInline:"24px"}}>
            {siteSettings.logo
              ? <img src={siteSettings.logo} alt="לוגו" style={{width:82,height:82,objectFit:"contain",borderRadius:12,marginBottom:siteSettings.soundLogo?6:12}}/>
              : <div style={{fontSize:48,marginBottom:siteSettings.soundLogo?6:12}}>🎬</div>}
            {siteSettings.soundLogo && (
              <img src={siteSettings.soundLogo} alt="לוגו סאונד" style={{width:82,height:82,objectFit:"contain",borderRadius:12,marginBottom:12}}/>
            )}
            <div style={{fontSize:24,fontWeight:900,color:"var(--accent)"}}>מחסן השאלת ציוד קמרה אובסקורה וסאונד</div>
            <div style={{fontSize:14,color:"var(--text2)",marginTop:4}}>שלום, {loggedInStudent.name}</div>
          </div>
          {/* ── View toggle: equipment vs studios ── */}
          <div style={{display:"flex",gap:4,marginTop:16,background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:4}}>
            <button type="button" onClick={()=>setPublicView("equipment")}
              style={{flex:1,padding:"10px 8px",borderRadius:6,border:"none",background:publicView==="equipment"?"var(--accent)":"transparent",color:publicView==="equipment"?"#000":"var(--text2)",fontWeight:800,fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              📦 השאלת ציוד
            </button>
            <button type="button" onClick={()=>{setPublicView("studios");loadStudiosData();}}
              style={{flex:1,padding:"10px 8px",borderRadius:6,border:"none",background:publicView==="studios"?"var(--accent)":"transparent",color:publicView==="studios"?"#000":"var(--text2)",fontWeight:800,fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              🎙️ קביעת אולפנים
            </button>
          </div>
          {publicView==="equipment" && <>
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
                {val:"קולנוע יומית",icon:"🎥",desc:"תרגול חופשי עם ציוד קולנוע למספר שעות — יש להזמין 24 שעות מראש"},
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
                    <div style={{fontWeight:800,fontSize:15,color:form.loan_type===opt.val?"var(--accent)":"var(--text)"}}>{opt.val==="סאונד"?"השאלת סאונד":opt.val==="הפקה"?"השאלת הפקה":opt.val==="קולנוע יומית"?"השאלת קולנוע יומית":`השאלה ${opt.val}`}</div>
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
                השאלת יום פעילה. התאריך חושב אוטומטית ל־{formatDate(soundDayLoanDate)} ושעות האיסוף/ההחזרה פתוחות עכשיו להזנה ידנית לצורך בדיקות.
              </div>
            )}
            {isCinemaLoan && (
              <div className="highlight-box" style={{marginBottom:16,background:"rgba(52,152,219,0.08)",border:"1px solid rgba(52,152,219,0.25)"}}>
                🎥 השאלת קולנוע יומית — יש לבחור תאריך לפחות 24 שעות קדימה. ההשאלה מוגבלת ל-6 שעות באותו יום.
              </div>
            )}
            {isCinemaLoan ? (
              <>
                <div className="grid-2">
                  <div className="form-group"><label className="form-label">📅 תאריך *</label>
                    <input type="date" className="form-input" min={minDate} value={form.borrow_date} onChange={e=>{
                      setForm(prev=>({...prev, borrow_date:e.target.value, return_date:e.target.value, borrow_time:"", return_time:""}));
                    }}/>
                  </div>
                  <div className="form-group"><label className="form-label">שעת התחלה *</label>
                    <select className="form-select" value={form.borrow_time} onChange={e=>setForm(prev=>({...prev, borrow_time:e.target.value, return_time:""}))}>
                      <option value="">-- בחר שעה --</option>
                      {TIME_SLOTS.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid-2">
                  <div/>
                  <div className="form-group"><label className="form-label">שעת סיום * <span style={{fontSize:11,color:"var(--text3)",fontWeight:400}}>(עד 6 שעות)</span></label>
                    <select className="form-select" value={form.return_time} onChange={e=>set("return_time",e.target.value)} disabled={!form.borrow_time}>
                      <option value="">-- בחר שעה --</option>
                      {availableReturnSlots.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="grid-2">
                  <div className="form-group"><label className="form-label">📅 תאריך השאלה *</label>{isSoundDayLoan ? <div className="form-input" style={{display:"flex",alignItems:"center",fontWeight:700}}>{formatDate(soundDayLoanDate)}</div> : <input type="date" className="form-input" min={minDate} value={form.borrow_date} onChange={e=>set("borrow_date",e.target.value)}/>}</div>
                  <div className="form-group"><label className="form-label">שעת איסוף *</label>
                    {isSoundDayLoan ? (
                      <input
                        type="time"
                        className="form-input"
                        value={form.borrow_time}
                        onChange={e=>set("borrow_time",e.target.value)}
                        placeholder="הקלד שעה"
                      />
                    ) : (
                      <select className="form-select" value={form.borrow_time} onChange={e=>setForm(prev=>({...prev,borrow_time:e.target.value,return_time:isSoundDayLoan && !disableSoundDayHourLimit && prev.return_time && toDateTime(soundDayLoanDate, prev.return_time) <= toDateTime(soundDayLoanDate, e.target.value) ? "" : prev.return_time}))}>
                        <option value="">-- בחר שעה --</option>
                        {availableBorrowSlots.map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                    )}
                  </div>
                </div>
                <div className="grid-2">
                  <div className="form-group"><label className="form-label">📅 תאריך החזרה *</label>{isSoundDayLoan ? <div className="form-input" style={{display:"flex",alignItems:"center",fontWeight:700}}>{formatDate(soundDayLoanDate)}</div> : <input type="date" className="form-input" min={form.borrow_date||today()} value={form.return_date} onChange={e=>set("return_date",e.target.value)}/>}</div>
                  <div className="form-group"><label className="form-label">שעת החזרה *</label>
                    {isSoundDayLoan ? (
                      <input
                        type="time"
                        className="form-input"
                        value={form.return_time}
                        onChange={e=>set("return_time",e.target.value)}
                        placeholder="הקלד שעה"
                      />
                    ) : (
                      <select className="form-select" value={form.return_time} onChange={e=>set("return_time",e.target.value)}>
                        <option value="">-- בחר שעה --</option>
                        {availableReturnSlots.map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              </>
            )}
            {(borrowWeekend||(returnWeekend&&!isCinemaLoan)) && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 המחסן אינו פעיל בימים שישי ושבת. נא לבחור ימים א׳–ה׳ בלבד.</div>}
            {tooSoon && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 {form.loan_type==="פרטית"?"השאלה פרטית דורשת התראה של 48 שעות לפחות.":"נדרשת התראה של שבוע לפחות."} תאריך מוקדם ביותר: <strong>{formatDate(minDate)}</strong></div>}
            {cinemaTooSoon && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 השאלת קולנוע יומית דורשת הזמנה של 24 שעות מראש. תאריך מוקדם ביותר: <strong>{formatDate(minDate)}</strong></div>}
            {tooLong && !isCinemaLoan && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 לא ניתן להשלים את התהליך כי זמן ההשאלה חורג מנהלי המכללה. משך מקסימלי: <strong>{maxDays} ימים</strong></div>}
            {returnBeforeBorrow && !isCinemaLoan && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 זמנים לא נכונים — תאריך החזרה חייב להיות אחרי תאריך ההשאלה.</div>}
            {timeOrderError && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 זמנים לא נכונים — שעת החזרה חייבת להיות אחרי שעת האיסוף באותו יום.</div>}
            {ok2 && <div className="highlight-box">{isCinemaLoan ? `🎥 השאלת קולנוע יומית · ${formatDate(form.borrow_date)} · ${form.borrow_time}–${form.return_time}` : `📅 השאלה ל-${loanDays} ימים · איסוף ${form.borrow_time} · החזרה ${form.return_time}`}</div>}

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
    {showInfoPanel&&<InfoPanel policies={policies} kits={kits} equipment={equipment} teamMembers={teamMembers} onClose={()=>setShowInfoPanel(false)} accentColor={siteSettings.accentColor}/>}
    </>}
    {publicView==="studios" && <PublicStudioBooking
      studios={studios} bookings={studioBookings} setBookings={setStudioBookings}
      student={loggedInStudent} showToast={showToast}
      weekOffset={studioWeekOffset} setWeekOffset={setStudioWeekOffset}
      modal={studioModal} setModal={setStudioModal}
    />}
    </>
  );
}

// ─── PUBLIC STUDIO BOOKING (student side) ────────────────────────────────────
function PublicStudioBooking({ studios, bookings, setBookings, student, showToast, weekOffset, setWeekOffset, modal, setModal }) {
  const [saving, setSaving] = useState(false);
  const [dayView, setDayView] = useState(null); // { studioId, date, dayName }

  const HOURS = ["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00"];
  const STATUS_C = { "ממתין":"var(--yellow)", "מאושר":"var(--green)", "נדחה":"var(--red)" };

  function getWeekDays(off=0) {
    const today = new Date();
    today.setDate(today.getDate() + off * 7);
    const sun = new Date(today); sun.setDate(today.getDate() - today.getDay());
    return Array.from({length:7}, (_,i) => {
      const d = new Date(sun); d.setDate(sun.getDate()+i);
      const yyyy = d.getFullYear(), mm = String(d.getMonth()+1).padStart(2,"0"), dd = String(d.getDate()).padStart(2,"0");
      return { name:["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][i], date:dd, fullDate:`${yyyy}-${mm}-${dd}`,
        isToday: dd===String(new Date().getDate()).padStart(2,"0") && mm===String(new Date().getMonth()+1).padStart(2,"0") && yyyy===new Date().getFullYear() };
    });
  }
  const weekDays = getWeekDays(weekOffset);

  const submitBooking = async (e) => {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.target);
    const startTime = fd.get("startTime"), endTime = fd.get("endTime"), notes = fd.get("notes")?.trim();
    const { studioId, date } = modal;
    if(startTime >= endTime) { showToast("error","שעת סיום חייבת להיות אחרי שעת התחלה"); setSaving(false); return; }
    const overlap = bookings.some(b => b.studioId===studioId && b.date===date && b.status!=="נדחה" && !(endTime<=b.startTime || startTime>=b.endTime));
    if(overlap) { showToast("error","⚠️ קיימת הזמנה חופפת"); setSaving(false); return; }
    const newBooking = { id:Date.now(), studioId, date, startTime, endTime, studentName:student.name, notes, status:"ממתין", createdAt:new Date().toISOString() };
    const updated = [...bookings, newBooking];
    setBookings(updated);
    await storageSet("studio_bookings", updated);
    showToast("success","✅ בקשת ההזמנה נשלחה לאישור");
    setModal(null); setSaving(false);
  };

  // ── Day drill-down view ──
  if (dayView) {
    const studio = studios.find(s=>s.id===dayView.studioId);
    const dayBookings = bookings.filter(b=>b.studioId===dayView.studioId && b.date===dayView.date && b.status!=="נדחה");
    return (
      <div style={{padding:"20px 16px",direction:"rtl",maxWidth:500,margin:"0 auto"}}>
        <button className="btn btn-secondary btn-sm" onClick={()=>setDayView(null)} style={{marginBottom:12}}>← חזור ללוח</button>
        <div style={{fontWeight:900,fontSize:18,marginBottom:4}}>{studio?.image} {studio?.name}</div>
        <div style={{fontSize:14,color:"var(--text3)",marginBottom:16}}>{dayView.dayName} · {dayView.date}</div>
        <div style={{display:"flex",flexDirection:"column",gap:2}}>
          {HOURS.map((hour,i)=>{
            const nextH = HOURS[i+1] || "21:00";
            const booking = dayBookings.find(b=>b.startTime<=hour && b.endTime>hour);
            return (
              <div key={hour} style={{display:"flex",alignItems:"stretch",minHeight:48,border:"1px solid var(--border)",borderRadius:6,overflow:"hidden"}}>
                <div style={{width:60,padding:"8px 6px",background:"var(--surface2)",fontWeight:700,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>{hour}</div>
                {booking
                  ? <div style={{flex:1,background:STATUS_C[booking.status]+"22",padding:"8px 12px",display:"flex",alignItems:"center",gap:8,borderRight:`3px solid ${STATUS_C[booking.status]}`}}>
                      <span style={{fontWeight:700,fontSize:13}}>{booking.studentName}</span>
                      <span style={{fontSize:11,color:"var(--text3)"}}>{booking.startTime}–{booking.endTime}</span>
                    </div>
                  : <div style={{flex:1,padding:"8px 12px",cursor:"pointer",display:"flex",alignItems:"center",color:"var(--text3)",fontSize:12}}
                      onClick={()=>setModal({type:"addBooking",studioId:dayView.studioId,date:dayView.date,dayName:dayView.dayName,defaultStart:hour,defaultEnd:nextH})}>
                      + לחץ להזמנה
                    </div>
                }
              </div>
            );
          })}
        </div>
        {/* Booking modal */}
        {modal?.type==="addBooking" && (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&setModal(null)}>
            <div style={{width:"100%",maxWidth:400,background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",direction:"rtl"}}>
              <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",fontWeight:900,fontSize:16}}>📅 הזמנת אולפן</div>
              <form onSubmit={submitBooking} style={{padding:20,display:"flex",flexDirection:"column",gap:12}}>
                <div style={{fontSize:13,color:"var(--text3)"}}>👤 {student.name} · {dayView.dayName} {modal.date}</div>
                <div style={{display:"flex",gap:8}}>
                  <label style={{flex:1,fontSize:13,fontWeight:600}}>התחלה
                    <select name="startTime" className="form-input" defaultValue={modal.defaultStart||"09:00"}>{HOURS.map(h=><option key={h}>{h}</option>)}</select>
                  </label>
                  <label style={{flex:1,fontSize:13,fontWeight:600}}>סיום
                    <select name="endTime" className="form-input" defaultValue={modal.defaultEnd||"12:00"}>{HOURS.map(h=><option key={h}>{h}</option>)}</select>
                  </label>
                </div>
                <label style={{fontSize:13,fontWeight:600}}>הערות
                  <textarea name="notes" className="form-input" rows={2} placeholder="תיאור הפרויקט..."/>
                </label>
                <div style={{display:"flex",gap:8}}>
                  <button type="button" className="btn btn-secondary" onClick={()=>setModal(null)}>ביטול</button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>{saving?"שומר...":"✅ שלח בקשה"}</button>
                </div>
                <div style={{fontSize:11,color:"var(--text3)"}}>⏳ הבקשה תישלח לאישור המנהל</div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Weekly calendar view ──
  return (
    <div style={{padding:"20px 16px",direction:"rtl"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,justifyContent:"center",flexWrap:"wrap"}}>
        <button className="btn btn-secondary btn-sm" onClick={()=>setWeekOffset(w=>w-1)}>→ שבוע קודם</button>
        <button className="btn btn-secondary btn-sm" onClick={()=>setWeekOffset(0)}>היום</button>
        <button className="btn btn-secondary btn-sm" onClick={()=>setWeekOffset(w=>w+1)}>← שבוע הבא</button>
      </div>
      {studios.length===0 ? (
        <div style={{textAlign:"center",padding:48,color:"var(--text3)"}}>
          <div style={{fontSize:48,marginBottom:12}}>🎙️</div>
          <div style={{fontWeight:700}}>אין אולפנים זמינים כרגע</div>
        </div>
      ) : (
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:500}}>
            <thead>
              <tr>
                <th style={{padding:"8px 10px",background:"var(--surface2)",fontSize:12,fontWeight:700,textAlign:"center",border:"1px solid var(--border)",width:90}}>אולפן</th>
                {weekDays.map(d=>(
                  <th key={d.fullDate} style={{padding:"8px 10px",background:d.isToday?"rgba(245,166,35,0.15)":"var(--surface2)",fontSize:12,fontWeight:700,textAlign:"center",border:"1px solid var(--border)"}}>
                    <div>{d.name}</div><div style={{fontSize:11,color:"var(--text3)"}}>{d.date}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {studios.map(studio=>(
                <tr key={studio.id}>
                  <td style={{padding:"6px 8px",border:"1px solid var(--border)",fontWeight:700,fontSize:12,background:"var(--surface2)",textAlign:"center"}}>
                    <span style={{fontSize:18}}>{studio.image}</span><br/>{studio.name}
                  </td>
                  {weekDays.map(day=>{
                    const cells = bookings.filter(b=>b.studioId===studio.id && b.date===day.fullDate && b.status!=="נדחה");
                    return (
                      <td key={day.fullDate} style={{padding:"4px 6px",border:"1px solid var(--border)",verticalAlign:"top",cursor:"pointer",background:day.isToday?"rgba(245,166,35,0.05)":"transparent"}}
                        onClick={()=>setDayView({studioId:studio.id,date:day.fullDate,dayName:day.name})}>
                        {cells.map(b=>(
                          <div key={b.id} style={{background:STATUS_C[b.status]+"22",border:`1px solid ${STATUS_C[b.status]}`,borderRadius:4,padding:"2px 4px",marginBottom:2,fontSize:10}}>
                            <div style={{fontWeight:700,color:STATUS_C[b.status]}}>{b.startTime}–{b.endTime}</div>
                            <div style={{color:"var(--text3)"}}>{b.studentName}</div>
                          </div>
                        ))}
                        {cells.length===0&&<div style={{color:"var(--text3)",fontSize:10,textAlign:"center",paddingTop:8}}>פנוי</div>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* My bookings */}
      {bookings.filter(b=>b.studentName===student.name).length > 0 && (
        <div style={{marginTop:20}}>
          <div style={{fontWeight:800,fontSize:14,marginBottom:8}}>📋 ההזמנות שלי</div>
          {bookings.filter(b=>b.studentName===student.name).sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||"")).map(b=>{
            const studio = studios.find(s=>s.id===b.studioId);
            return (
              <div key={b.id} style={{background:"var(--surface2)",borderRadius:8,padding:"10px 14px",marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center",border:`1px solid ${STATUS_C[b.status]}44`}}>
                <div>
                  <div style={{fontWeight:700,fontSize:13}}>{studio?.image} {studio?.name} · {b.date}</div>
                  <div style={{fontSize:12,color:"var(--text3)"}}>{b.startTime}–{b.endTime}</div>
                </div>
                <span style={{background:STATUS_C[b.status]+"22",color:STATUS_C[b.status],borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>{b.status}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
