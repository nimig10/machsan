// PublicForm.jsx — public loan request form
import { useEffect, useState, useRef, useMemo } from "react";
import { storageGet, storageSet, formatDate, formatLocalDateInput, parseLocalDate, today, getAvailable, toDateTime, getNextSoundDayLoanDate, getFutureTimeSlotsForDate, getPrivateLoanLimitedQty, normalizeName, isValidEmailAddress, NIMROD_PHONE, DEFAULT_CATEGORIES, FAR_FUTURE, getEffectiveStatus } from "../utils.js";
import { CalendarGrid } from "./CalendarGrid.jsx";
import AIChatBot from "./AIChatBot.jsx";

const SMART_LOAN_TYPES = ["פרטית", "הפקה", "סאונד", "קולנוע יומית"];

function normalizeSmartDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const localMatch = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (localMatch) {
    const year = localMatch[3].length === 2 ? `20${localMatch[3]}` : localMatch[3];
    return `${year}-${String(localMatch[2]).padStart(2, "0")}-${String(localMatch[1]).padStart(2, "0")}`;
  }
  return "";
}

function normalizeSmartTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeSmartLoanType(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (SMART_LOAN_TYPES.includes(raw)) return raw;
  if (raw.includes("הפק")) return "הפקה";
  if (raw.includes("סאונד")) return "סאונד";
  if (raw.includes("יומית") || raw.includes("קולנוע")) return "קולנוע יומית";
  if (raw.includes("פרט")) return "פרטית";
  return "";
}

function parseSmartBookingJson(text) {
  const raw = String(text || "").trim();
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const jsonText = fencedMatch ? fencedMatch[1].trim() : raw;
  return JSON.parse(jsonText);
}

const LOAN_TYPE_EQUIPMENT_CLASSIFICATIONS = ["סאונד", "צילום", "כללי"];
const DEFAULT_STUDIO_FUTURE_HOURS = 16;
const DEFAULT_LOAN_TYPE_EQUIPMENT_CLASSIFICATION = {
  פרטית: ["כללי"],
  הפקה: ["צילום"],
  סאונד: ["סאונד"],
  "קולנוע יומית": ["צילום"],
};

function getLoanTypeEquipmentClassifications(loanType, categoryLoanTypes = {}) {
  const rawValue = categoryLoanTypes?.[loanType];
  const normalized = Array.isArray(rawValue)
    ? rawValue.filter((value) => LOAN_TYPE_EQUIPMENT_CLASSIFICATIONS.includes(String(value).trim()))
    : LOAN_TYPE_EQUIPMENT_CLASSIFICATIONS.includes(String(rawValue || "").trim())
      ? [String(rawValue).trim()]
      : [];
  return normalized.length ? [...new Set(normalized)] : [...(DEFAULT_LOAN_TYPE_EQUIPMENT_CLASSIFICATION[loanType] || ["כללי"])];
}

function matchesEquipmentLoanType(eq, loanType, categoryLoanTypes = {}) {
  const requiredClassifications = getLoanTypeEquipmentClassifications(loanType, categoryLoanTypes);
  const isSound = !!eq?.soundOnly;
  const isPhoto = !!eq?.photoOnly;
  const isGeneral = (!isSound && !isPhoto) || (isSound && isPhoto);
  return requiredClassifications.some((classification) => {
    if (classification === "סאונד") return isSound;
    if (classification === "צילום") return isPhoto;
    return isGeneral;
  });
}

function buildTrackSettings(students = [], existingTrackSettings = [], explicitTracks = []) {
  const existing = Array.isArray(existingTrackSettings) ? existingTrackSettings : [];
  const explicit = Array.isArray(explicitTracks) ? explicitTracks : [];
  const explicitNames = explicit.map(t => String(t?.name || "").trim()).filter(Boolean);
  const studentNames = (students || []).map((s) => String(s?.track || "").trim()).filter(Boolean);
  const trackNames = [...new Set([...explicitNames, ...studentNames])];
  return trackNames.map((name) => {
    const match = existing.find((setting) => String(setting?.name || "").trim() === name);
    const explicitMatch = explicit.find(t => String(t?.name || "").trim() === name);
    const allowedLoanTypes = SMART_LOAN_TYPES.filter((loanType) => Array.isArray(match?.loanTypes) && match.loanTypes.includes(loanType));
    // infer trackType: explicit tracks → trackSettings cache → keyword fallback
    const inferredType = explicitMatch?.trackType
      || match?.trackType
      || (/סאונד|sound/i.test(name) ? "sound" : /קולנוע|cinema|film/i.test(name) ? "cinema" : "");
    return {
      name,
      loanTypes: allowedLoanTypes.length ? allowedLoanTypes : [...SMART_LOAN_TYPES],
      trackType: inferredType,
    };
  });
}

const fetchWithRetry = async (url, options, maxRetries = 5) => {
  const delays = [2000, 5000, 10000, 20000, 32000];
  for (let i = 0; i < maxRetries; i += 1) {
    const response = await fetch(url, options);
    if (response.status === 429) {
      console.warn(`API Rate Limit hit. Retrying in ${(delays[i] ?? delays[delays.length - 1]) / 1000} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, delays[i] ?? delays[delays.length - 1]));
      continue;
    }
    return response;
  }
  return fetch(url, options);
};

function getStudioFutureHoursLimit(settings = {}) {
  const parsed = Number(settings?.studioFutureHoursLimit);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_STUDIO_FUTURE_HOURS;
}

function formatStudioHoursValue(value = 0) {
  const normalized = Math.max(0, Math.round((Number(value) || 0) * 10) / 10);
  return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(1);
}

function buildStudioBookingInterval({ date, startTime, endTime, isNight = false, nightStartTime = "21:30", nightEndTime = "08:00" }) {
  if (!date) return null;
  const normalizedStartTime = isNight ? nightStartTime : String(startTime || "").trim();
  const normalizedEndTime = isNight ? nightEndTime : String(endTime || "").trim();
  if (!normalizedStartTime || !normalizedEndTime) return null;
  const start = new Date(`${date}T${normalizedStartTime}:00`);
  const end = new Date(`${date}T${normalizedEndTime}:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (end <= start) end.setDate(end.getDate() + 1);
  return { start, end };
}

function getFutureStudioBookingHours(booking, now = new Date(), nightStartTime = "21:30", nightEndTime = "08:00") {
  // Night bookings cost exactly 4 hours regardless of actual duration
  if (booking?.isNight) {
    const interval = buildStudioBookingInterval({ ...booking, nightStartTime, nightEndTime });
    if (!interval || interval.end <= now) return 0;
    const futureStart = interval.start > now ? interval.start : now;
    const actualHours = Math.max(0, (interval.end.getTime() - futureStart.getTime()) / 3600000);
    return Math.min(actualHours, 4);
  }
  const interval = buildStudioBookingInterval({ ...booking, nightStartTime, nightEndTime });
  if (!interval || interval.end <= now) return 0;
  const futureStart = interval.start > now ? interval.start : now;
  return Math.max(0, (interval.end.getTime() - futureStart.getTime()) / 3600000);
}

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
                    {String(focusedEq.technical_details || "").trim() && (
                      <div style={{marginTop:20,padding:"14px 16px",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)"}}>
                        <div style={{fontSize:12,fontWeight:800,color:"var(--text3)",marginBottom:6}}>פרטים טכניים</div>
                        <div style={{fontSize:14,lineHeight:1.8,whiteSpace:"pre-wrap"}}>{focusedEq.technical_details}</div>
                      </div>
                    )}
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
function Step3Equipment({ isSoundLoan, kits, loanType, categories, availEq, equipment, setItems, getItem, setQty, canBorrowEq=()=>true, studentRecord, certificationTypes=[], categoryLoanTypes={} }) {
  const [activeKit, setActiveKit] = useState(null);
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
      const match = availEq.find(e=>e.id==ki.equipment_id);
      if (!match || !matchesEquipmentLoanType(match, loanType, categoryLoanTypes)) continue;
      const avail = match.avail || 0;
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
  const allowedEquipmentClassifications = getLoanTypeEquipmentClassifications(loanType, categoryLoanTypes);
  const visibleAvailEq = availEq.filter((eq) => matchesEquipmentLoanType(eq, loanType, categoryLoanTypes));
  const baseCategories = categories.filter((category) => visibleAvailEq.some((eq) => eq.category === category));
  const filteredCategories = selectedCats.length===0 ? baseCategories : baseCategories.filter(c=>selectedCats.includes(c));

  return (
    <>
      <div className="form-section-title">
        בחירת ציוד
        <span style={{fontSize:11,color:"var(--text3)",fontWeight:400,marginRight:8}}>
          · מוצגים רק פריטים שסומנו כ{allowedEquipmentClassifications.map((classification) => classification === "סאונד" ? "ציוד סאונד" : classification === "צילום" ? "ציוד צילום" : "כללי").join(" + ")}
        </span>
      </div>

      {false && (
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
  const LOAN_ICONS = { "פרטית":"👤","הפקה":"🎬","סאונד":"🎙️","קולנוע יומית":"🎥","לילה":"🌙" };
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
                  {String(selectedEq.technical_details || "").trim() && (
                    <div style={{marginBottom:16,padding:"12px 14px",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)"}}>
                      <div style={{fontSize:12,fontWeight:800,color:"var(--text3)",marginBottom:8}}>פרטים טכניים</div>
                      <div style={{fontSize:14,color:"var(--text2)",lineHeight:1.8,whiteSpace:"pre-wrap"}}>{selectedEq.technical_details}</div>
                    </div>
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
              {["פרטית","הפקה","סאונד","קולנוע יומית","לילה"].map(lt=>{
                const text = policies[lt];
                if(!text) return null;
                return (
                  <div key={lt} style={{marginBottom:28}}>
                    <div style={{fontWeight:800,fontSize:16,color:"var(--accent)",marginBottom:10}}>{LOAN_ICONS[lt]} נהלי השאלה {lt}</div>
                    <div style={{fontSize:14,lineHeight:1.9,color:"var(--text2)",whiteSpace:"pre-wrap",background:"var(--surface2)",borderRadius:"var(--r)",padding:"18px 20px",border:"1px solid var(--border)"}}>{text}</div>
                  </div>
                );
              })}
              {!policies?.פרטית && !policies?.הפקה && !policies?.סאונד && !policies?.לילה &&
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
export function PublicForm({ equipment, reservations, setReservations, showToast, categories=DEFAULT_CATEGORIES, kits=[], teamMembers=[], policies={}, certifications={types:[],students:[]}, deptHeads=[], calendarToken="", siteSettings={}, categoryLoanTypes={}, refreshInventory=async()=>({}) }) {
  const initialParams = new URLSearchParams(window.location.search);
  const initialLoanTypeParam = initialParams.get("loan_type");
  const initialStepParam = Number(initialParams.get("step"));
  const initialLoanType = ["פרטית","הפקה","סאונד","קולנוע יומית"].includes(initialLoanTypeParam || "") ? initialLoanTypeParam : "";
  const initialStep = initialParams.get("calendar")==="1"
    ? 2
    : (Number.isInteger(initialStepParam) && initialStepParam >= 1 && initialStepParam <= 4 ? initialStepParam : 1);
  const [step, setStep]       = useState(initialStep);
  const swipeTouchRef = useRef(null);
  const [form, setForm]       = useState({student_name:"",email:"",phone:"",course:"",project_name:"",borrow_date:"",borrow_time:"",return_date:"",return_time:"",loan_type:initialLoanType,sound_day_loan:false,sound_night_loan:false,studio_booking_id:"",crew_photographer_name:"",crew_photographer_phone:"",crew_sound_name:"",crew_sound_phone:""});
  const [items, setItems]     = useState([]);
  const [agreed, setAgreed]   = useState(false);
  const [done, setDone]       = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [submitting, setSub]  = useState(false);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [loggedInStudent, setLoggedInStudent] = useState(() => {
    try { const s = sessionStorage.getItem("public_student"); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const [loginForm, setLoginForm] = useState({ name:"", email:"" });
  const [loginError, setLoginError] = useState("");
  const [publicView, setPublicView] = useState(() => sessionStorage.getItem("public_view") || "equipment"); // "equipment" | "studios" | "daily"
  const [dailyLessons, setDailyLessons] = useState([]);
  const [dailyDayOffset, setDailyDayOffset] = useState(0);
  const [dailyMyLessons, setDailyMyLessons] = useState(false);
  const [studioBookings, setStudioBookings] = useState([]);
  const [studios, setStudios] = useState([]);
  const [studioWeekOffset, setStudioWeekOffset] = useState(0);
  const [studioModal, setStudioModal] = useState(null);
  const [expandedResId, setExpandedResId] = useState(null);
  const [editingBooking, setEditingBooking] = useState(null); // {id, studioId, date, startTime, endTime, isNight}
  const [editBookingSaving, setEditBookingSaving] = useState(false);
  const fmtDate = (d) => { if (!d) return ""; const [y,m,dd] = d.split("-"); return `${dd}.${m}.${y}`; };
  const [showEquipmentAiModal, setShowEquipmentAiModal] = useState(false);
  const [equipmentAiPrompt, setEquipmentAiPrompt] = useState("");
  const [equipmentAiLoading, setEquipmentAiLoading] = useState(false);
  const [showEquipmentAiLoanTypePrompt, setShowEquipmentAiLoanTypePrompt] = useState(false);
  const [equipmentAiForcedLoanType, setEquipmentAiForcedLoanType] = useState("");
  const todayStr = today();
  const normalizedTrackSettings = buildTrackSettings(certifications?.students, certifications?.trackSettings, certifications?.tracks);
  const activeStudentTrack = String(loggedInStudent?.track || form.course || "").trim();
  // ── Studio track-type filtering ──
  const studentTrackType = normalizedTrackSettings.find(s => s.name === activeStudentTrack)?.trackType || "";
  const visibleStudios = studios.filter(studio => {
    if (studio.classroomOnly) return false;
    // studioTrackType is the new field; fall back to legacy studio.type field
    const sType = studio.studioTrackType || (studio.type === "sound" ? "sound" : studio.type === "cinema" ? "cinema" : "");
    return !sType || sType === "all" || !studentTrackType || sType === studentTrackType;
  });
  const allowedLoanTypes = activeStudentTrack
    ? (normalizedTrackSettings.find((setting) => setting.name === activeStudentTrack)?.loanTypes || [...SMART_LOAN_TYPES])
    : [...SMART_LOAN_TYPES];
  const visibleLoanTypeOptions = [
    {val:"פרטית",icon:"👤",desc:"שימוש אישי / לימודי"},
    {val:"הפקה",icon:"🎬",desc:"פרויקט הפקה מאורגן"},
    {val:"סאונד",icon:"🎙️",desc:"לתרגול הקלטות באולפני המכללה (עבור הנדסאי סאונד בלבד)"},
    {val:"קולנוע יומית",icon:"🎥",desc:"תרגול חופשי עם ציוד קולנוע למספר שעות — יש להזמין 24 שעות מראש"},
  ].filter((option) => allowedLoanTypes.includes(option.val));

  const syncInventory = async () => {
    try {
      const refreshed = await refreshInventory();
      return {
        equipment: Array.isArray(refreshed?.equipment) ? refreshed.equipment : equipment,
        reservations: Array.isArray(refreshed?.reservations) ? refreshed.reservations : reservations,
        categories: Array.isArray(refreshed?.categories) ? refreshed.categories : categories,
        categoryLoanTypes: refreshed?.categoryLoanTypes && typeof refreshed.categoryLoanTypes === "object" && !Array.isArray(refreshed.categoryLoanTypes)
          ? refreshed.categoryLoanTypes
          : categoryLoanTypes,
      };
    } catch (error) {
      console.warn("public form inventory refresh failed", error);
      return { equipment, reservations, categories, categoryLoanTypes };
    }
  };

  // ─── שמירת מצב כניסת סטודנט ב-sessionStorage ───────────────────────────────
  useEffect(() => {
    if (loggedInStudent) {
      sessionStorage.setItem("public_student", JSON.stringify(loggedInStudent));
      setForm(p => ({
        ...p,
        student_name: loggedInStudent.name || p.student_name,
        email: loggedInStudent.email || p.email,
        ...(loggedInStudent.phone ? { phone: loggedInStudent.phone } : {}),
        ...(loggedInStudent.track ? { course: loggedInStudent.track } : {}),
      }));
    } else {
      sessionStorage.removeItem("public_student");
      sessionStorage.removeItem("public_view");
    }
  }, [loggedInStudent]);

  useEffect(() => {
    if (loggedInStudent) sessionStorage.setItem("public_view", publicView);
    if (loggedInStudent && publicView === "daily") loadDailySchedule();
  }, [publicView, loggedInStudent]);

  // ─── טיימר חוסר פעילות — 60 שניות ─────────────────────────────────────────
  useEffect(() => {
    if (!loggedInStudent) return;
    const TIMEOUT_MS = 7 * 60 * 1000;
    let timer = setTimeout(() => setLoggedInStudent(null), TIMEOUT_MS);
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => setLoggedInStudent(null), TIMEOUT_MS); };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    return () => { clearTimeout(timer); events.forEach(e => window.removeEventListener(e, reset)); };
  }, [loggedInStudent]);

  useEffect(() => {
    if (!activeStudentTrack) return;
    if (allowedLoanTypes.length === 1 && form.loan_type !== allowedLoanTypes[0]) {
      setForm((prev) => ({
        ...prev,
        loan_type: allowedLoanTypes[0],
        sound_day_loan: false,
        sound_night_loan: false,
        studio_booking_id: "",
        borrow_date: "",
        return_date: "",
        borrow_time: "",
        return_time: "",
      }));
      setItems([]);
      setAgreed(false);
      return;
    }
    if (form.loan_type && !allowedLoanTypes.includes(form.loan_type)) {
      setForm((prev) => ({
        ...prev,
        loan_type: "",
        sound_day_loan: false,
        sound_night_loan: false,
        studio_booking_id: "",
        borrow_date: "",
        return_date: "",
        borrow_time: "",
        return_time: "",
      }));
      setItems([]);
      setAgreed(false);
    }
  }, [activeStudentTrack, allowedLoanTypes, form.loan_type]);

  // Load studios data when switching to studios view
  const loadStudiosData = async () => {
    const [s, b] = await Promise.all([storageGet("studios"), storageGet("studio_bookings")]);
    if (Array.isArray(s)) setStudios(s);
    if (Array.isArray(b)) setStudioBookings(b);
  };

  const loadReservationsData = async () => {
    const res = await storageGet("reservations");
    if (Array.isArray(res)) setReservations(res);
  };

  const loadDailySchedule = async () => {
    const lessons = await storageGet("lessons");
    setDailyLessons(Array.isArray(lessons) ? lessons : []);
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
      setForm((prev) => ({ ...prev, sound_day_loan:false, sound_night_loan:false, studio_booking_id:"" }));
      return;
    }
    const targetDate = getNextSoundDayLoanDate(
      ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30"]
    );
    setForm((prev) => ({
      ...prev,
      sound_day_loan:true,
      sound_night_loan:false,
      studio_booking_id:"",
      borrow_date: targetDate,
      return_date: targetDate,
      borrow_time: "",
      return_time: "",
    }));
  };

  const setSoundNightLoan = (enabled) => {
    if (!enabled) {
      setForm((prev) => ({ ...prev, sound_night_loan:false, studio_booking_id:"" }));
      return;
    }
    const now = new Date();
    if (now.getHours() >= 17) {
      showToast("error", "לא ניתן להשאיל ציוד ללילה אחרי השעה 17:00.");
      return;
    }
    const todayDate = today();
    const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate()+1); while(d.getDay()===5||d.getDay()===6) d.setDate(d.getDate()+1); return formatLocalDateInput(d); })();
    setForm((prev) => ({
      ...prev,
      sound_night_loan:true,
      sound_day_loan:false,
      borrow_date: todayDate,
      return_date: tomorrow,
      borrow_time: "",
      return_time: "09:30",
      studio_booking_id: "",
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
  const getPastLoanTimeError = (candidateForm) => {
    const borrowDate = String(candidateForm?.borrow_date || "").trim();
    const borrowTime = String(candidateForm?.borrow_time || "").trim();
    if (!borrowDate || !borrowTime) return "";
    if (toDateTime(borrowDate, borrowTime) <= Date.now()) {
      return "לא ניתן להגיש בקשת השאלה לזמן שכבר עבר. יש לבחור זמן עתידי בלבד.";
    }
    return "";
  };
  const getSmartEquipmentPolicyError = (candidateForm, candidateItems) => {
    const loanType = normalizeSmartLoanType(candidateForm?.loan_type);
    const borrowDate = String(candidateForm?.borrow_date || "").trim();
    const returnDate = String(candidateForm?.return_date || "").trim();
    const borrowTime = String(candidateForm?.borrow_time || "").trim();
    const returnTime = String(candidateForm?.return_time || "").trim();

    if (!loanType || !borrowDate || !returnDate || !borrowTime || !returnTime) return "";

    const candidateIsCinema = loanType === "קולנוע יומית";
    const candidateIsSound = loanType === "סאונד";
    const candidateMinDays = loanType === "פרטית" ? 2 : candidateIsSound ? 0 : candidateIsCinema ? 0 : 7;
    const candidateMinDate = (() => {
      const date = new Date();
      date.setDate(date.getDate() + (candidateIsCinema ? 1 : candidateMinDays));
      return moveToNextWeekday(formatLocalDateInput(date));
    })();
    const candidateMaxDays = loanType === "פרטית" ? 4 : candidateIsCinema ? 1 : 7;
    const candidateBorrowWeekend = isWeekend(borrowDate);
    const candidateReturnWeekend = isWeekend(returnDate);
    const candidateReturnBeforeBorrow = parseLocalDate(returnDate) < parseLocalDate(borrowDate);
    const candidateSameDay = borrowDate === returnDate;
    const candidateTimeOrderError = candidateSameDay && toDateTime(returnDate, returnTime) <= toDateTime(borrowDate, borrowTime);
    const candidateLoanDays = Math.ceil((parseLocalDate(returnDate) - parseLocalDate(borrowDate)) / 86400000) + 1;
    const candidatePastTimeError = getPastLoanTimeError(candidateForm);

    if (candidateBorrowWeekend || (!candidateIsCinema && candidateReturnWeekend)) {
      return "הבקשה שפוענחה מנוגדת לנהלי המכללה: המחסן אינו פעיל בימי שישי ושבת, ולכן יש לבחור ימי השאלה והחזרה בין ראשון לחמישי בלבד.";
    }
    if (!candidateIsSound && !candidateIsCinema && borrowDate < candidateMinDate) {
      if (loanType === "פרטית") {
        return `הבקשה שפוענחה מנוגדת לנהלי המכללה: השאלה פרטית דורשת התראה של 48 שעות לפחות. התאריך המוקדם ביותר האפשרי הוא ${formatDate(candidateMinDate)}.`;
      }
      return `הבקשה שפוענחה מנוגדת לנהלי המכללה: סוג ההשאלה ${loanType} דורש התראה של שבוע לפחות. התאריך המוקדם ביותר האפשרי הוא ${formatDate(candidateMinDate)}.`;
    }
    if (candidateIsCinema && borrowDate < candidateMinDate) {
      return `הבקשה שפוענחה מנוגדת לנהלי המכללה: השאלת קולנוע יומית דורשת הזמנה של 24 שעות מראש. התאריך המוקדם ביותר האפשרי הוא ${formatDate(candidateMinDate)}.`;
    }
    if (candidateReturnBeforeBorrow) {
      return "הבקשה שפוענחה מנוגדת לנהלי המכללה: תאריך ההחזרה חייב להיות אחרי תאריך ההשאלה.";
    }
    if (candidateTimeOrderError) {
      return "הבקשה שפוענחה מנוגדת לנהלי המכללה: שעת ההחזרה חייבת להיות אחרי שעת האיסוף באותו יום.";
    }
    if (candidatePastTimeError) {
      return `הבקשה שפוענחה מנוגדת לנהלי המכללה: ${candidatePastTimeError}`;
    }
    if (candidateLoanDays > candidateMaxDays) {
      return `הבקשה שפוענחה מנוגדת לנהלי המכללה: משך ההשאלה שביקשת חורג מהזמן המותר לסוג השאלה ${loanType}.`;
    }
    if (loanType === "פרטית") {
      const privateQty = getPrivateLoanLimitedQty(candidateItems, equipment);
      if (privateQty > 4) {
        return "הבקשה שפוענחה מנוגדת לנהלי המכללה: בהשאלה פרטית לא ניתן לחרוג מ-4 פריטים.";
      }
    }
    return "";
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
  const isSoundLoan = form.loan_type==="סאונד";
  const CINEMA_TIME_SLOTS = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30","20:00","20:30","21:00"];
  const SOUND_DAY_TIME_SLOTS = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30","20:00","20:30","21:00","21:30"];
  const TIME_SLOTS = isSoundLoan
    ? SOUND_DAY_TIME_SLOTS
    : isCinemaLoan ? CINEMA_TIME_SLOTS
    : ["09:00","09:30","14:30","15:00","15:30","16:00","16:30","17:00","17:30"];
  const isProductionLoan = form.loan_type==="הפקה";
  const isSoundDayLoan = isSoundLoan && !!form.sound_day_loan;
  const isSoundNightLoan = isSoundLoan && !!form.sound_night_loan;

  // ── קיבוץ קביעות עוקבות לאותו אולפן לרצף אחד ──────────────────────────────
  const groupedStudentBookings = (() => {
    if (!isSoundLoan || !loggedInStudent?.name) return [];
    const NIGHT_END = "09:30";
    const getEnd = (b) => {
      if (b.isNight) {
        const d = new Date(b.date); d.setDate(d.getDate() + 1);
        while (d.getDay() === 5 || d.getDay() === 6) d.setDate(d.getDate() + 1);
        return { date: formatLocalDateInput(d), time: NIGHT_END };
      }
      return { date: b.date, time: b.endTime || "00:00" };
    };
    const relevant = studioBookings
      .filter(b => b.studentName === loggedInStudent.name)
      .filter(b => { const e = getEnd(b); return new Date(`${e.date}T${e.time}:00`).getTime() > Date.now(); })
      .sort((a, b) => (`${a.date}T${a.startTime||"00:00"}` < `${b.date}T${b.startTime||"00:00"}` ? -1 : 1));
    const groups = [];
    for (const bk of relevant) {
      let merged = false;
      for (const g of groups) {
        const last = g.bookings[g.bookings.length - 1];
        const lastEnd = getEnd(last);
        if (String(last.studioId) === String(bk.studioId)) {
          const lastEndTs = new Date(`${lastEnd.date}T${lastEnd.time}:00`).getTime();
          const bkStartTs = new Date(`${bk.date}T${bk.startTime || "00:00"}:00`).getTime();
          if (bkStartTs <= lastEndTs) {
            g.bookings.push(bk);
            const newEnd = getEnd(bk);
            // keep the later end time
            const newEndTs = new Date(`${newEnd.date}T${newEnd.time}:00`).getTime();
            if (newEndTs > lastEndTs) {
              g.endDate = newEnd.date; g.endTime = newEnd.time;
            }
            g.isMultiDay = g.startDate !== g.endDate;
            merged = true; break;
          }
        }
      }
      if (!merged) {
        const e = getEnd(bk);
        groups.push({ bookings:[bk], primaryId:String(bk.id), studioId:bk.studioId,
          startDate:bk.date, startTime:bk.startTime||"", endDate:e.date, endTime:e.time,
          isMultiDay: bk.date !== e.date });
      }
    }
    return groups;
  })();
  const soundDayLoanDate = isSoundDayLoan ? getNextSoundDayLoanDate(TIME_SLOTS) : "";
  const activeBorrowDate = isSoundDayLoan ? soundDayLoanDate : form.borrow_date;
  const activeReturnDate = isSoundDayLoan ? soundDayLoanDate : form.return_date;
  const nightLoanBorrowSlots = isSoundNightLoan ? TIME_SLOTS.filter(t => t <= "17:00") : TIME_SLOTS;
  const availableBorrowSlots = getFutureTimeSlotsForDate(activeBorrowDate, nightLoanBorrowSlots);
  const availableReturnSlotsBase = getFutureTimeSlotsForDate(activeReturnDate, TIME_SLOTS);
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
    ? cinemaMaxReturnSlots.filter((slot) => availableReturnSlotsBase.includes(slot))
    : availableReturnSlotsBase;
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
  const studentRecord = (() => {
    if (!loggedInStudent) return null;
    const students = certifications.students || [];
    if (loggedInStudent.id !== undefined && loggedInStudent.id !== null) {
      const byId = students.find(s => String(s.id) === String(loggedInStudent.id));
      if (byId) return byId;
    }
    const loggedEmail = String(loggedInStudent.email || "").toLowerCase().trim();
    if (loggedEmail) {
      const byEmail = students.find(s => s.email?.toLowerCase().trim() === loggedEmail);
      if (byEmail) return byEmail;
    }
    return matchCertificationStudentByNamePhone(loggedInStudent.name, loggedInStudent.phone);
  })();
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
  const canBorrowEqForForm = (candidateForm, eq) => {
    if (!eq?.certification_id) return true;
    const certId = eq.certification_id;
    const candidateLoanType = normalizeSmartLoanType(candidateForm?.loan_type);
    if (candidateLoanType === "הפקה") {
      const candidatePhotographerRecord = matchCertificationStudentByNamePhone(candidateForm?.crew_photographer_name, candidateForm?.crew_photographer_phone);
      const candidateSoundRecord = candidateForm?.crew_sound_name
        ? matchCertificationStudentByNamePhone(candidateForm?.crew_sound_name, candidateForm?.crew_sound_phone)
        : null;
      const candidatePhotographerCerts = candidatePhotographerRecord?.certs || {};
      const candidateSoundCerts = candidateSoundRecord?.certs || {};
      return candidatePhotographerCerts[certId] === "עבר" || candidateSoundCerts[certId] === "עבר";
    }
    return studentCerts[certId] === "עבר";
  };
  const privateLoanLimitedQty = form.loan_type==="פרטית" ? getPrivateLoanLimitedQty(items, equipment) : 0;
  const privateLoanLimitExceeded = form.loan_type==="פרטית" && privateLoanLimitedQty > 4;
  const sameDay = form.borrow_date && form.return_date && form.borrow_date === form.return_date;
  const timeOrderError = !isSoundNightLoan && sameDay && form.borrow_time && form.return_time && toDateTime(form.return_date, form.return_time) <= toDateTime(form.borrow_date, form.borrow_time);
  const returnBeforeBorrow = form.borrow_date && form.return_date && parseLocalDate(form.return_date) < parseLocalDate(form.borrow_date);
  const hasTimes = !!form.borrow_time && !!form.return_time;
  const pastLoanTimeError = getPastLoanTimeError(form);
  const ok2 = !!form.borrow_date && !!form.return_date && hasTimes && !returnBeforeBorrow && !tooSoon && !cinemaTooSoon && !tooLong && !borrowWeekend && !returnWeekend && !timeOrderError && !pastLoanTimeError && (!isSoundLoan || !!form.studio_booking_id);
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

  useEffect(() => {
    setItems((currentItems) => {
      const hasActiveAvailabilityWindow = !!form.borrow_date && !!form.return_date;
      const nextItems = currentItems
        .map((item) => {
          const equipmentItem = equipment.find((entry) => entry.id == item.equipment_id);
          if (!equipmentItem) return null;
          const maxQuantity = hasActiveAvailabilityWindow
            ? (availEq.find((entry) => entry.id == item.equipment_id)?.avail || 0)
            : Number(item.quantity) || 0;
          const nextQuantity = Math.max(0, Math.min(Number(item.quantity) || 0, maxQuantity));
          if (!nextQuantity) return null;
          return {
            ...item,
            name: equipmentItem.name || item.name,
            quantity: nextQuantity,
          };
        })
        .filter(Boolean);

      return JSON.stringify(currentItems) === JSON.stringify(nextItems) ? currentItems : nextItems;
    });
  }, [availEq, equipment, form.borrow_date, form.return_date]);

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
    if (pastLoanTimeError) {
      showToast("error", pastLoanTimeError);
      return;
    }
    showToast("error", "יש להשלים את שלבי פרטים, תאריכים וציוד לפני המעבר לשלב האישור.");
  };

  const closeEquipmentAiModal = () => {
    setShowEquipmentAiModal(false);
    setEquipmentAiPrompt("");
    setEquipmentAiLoading(false);
    setShowEquipmentAiLoanTypePrompt(false);
    setEquipmentAiForcedLoanType("");
  };

  const handleSmartEquipmentBooking = async (promptText, equipmentList) => {
    if (!promptText) return;
    const refreshedInventory = await syncInventory();
    const liveEquipmentList = Array.isArray(refreshedInventory?.equipment) ? refreshedInventory.equipment : equipmentList;
    const preselectedLoanType = normalizeSmartLoanType(form.loan_type);
    const promptLoanType = normalizeSmartLoanType(promptText);
    const forcedLoanType = normalizeSmartLoanType(equipmentAiForcedLoanType);
    const requestedLoanType = preselectedLoanType || forcedLoanType || promptLoanType;
    let shouldCloseEquipmentAiModal = false;

    if (!allowedLoanTypes.length) {
      showToast("error", "לא הוגדרו סוגי השאלה זמינים למסלול הלימודים שלך.");
      return;
    }

    if (!requestedLoanType) {
      setShowEquipmentAiLoanTypePrompt(true);
      showToast("error", "יש לבחור סוג השאלה או לציין אותו בתיאור.");
      return;
    }

    if (!allowedLoanTypes.includes(requestedLoanType)) {
      setShowEquipmentAiLoanTypePrompt(true);
      showToast("error", "סוג ההשאלה שביקשת אינו זמין למסלול הלימודים שלך.");
      return;
    }

    setShowEquipmentAiLoanTypePrompt(false);
    setEquipmentAiLoading(true);

    try {
      const todayStr = today();
      const liveCategoryLoanTypes = refreshedInventory?.categoryLoanTypes || categoryLoanTypes;
      const allowedEquipmentList = (liveEquipmentList || []).filter((item) => matchesEquipmentLoanType(item, requestedLoanType, liveCategoryLoanTypes));
      if (!allowedEquipmentList.length) {
        throw new Error("לא נמצאו פריטי ציוד שמותרים לסוג ההשאלה הזה.");
      }
      const inventory = allowedEquipmentList
        .map((item) => `ID: ${item.id}, Name: ${item.name}, Category: ${item.category || ""}`)
        .join("\n");

      const systemInstruction = `
אתה עוזר חכם למחסן ציוד במכללה. התאריך היום הוא ${todayStr}.
עליך לחלץ מהטקסט של הסטודנט את סוג ההשאלה, תאריכי ההשאלה, שעות, ורשימת ציוד עם כמויות.
התאם את הציוד המבוקש למזהים (IDs) מרשימת המלאי הבאה בלבד:
${inventory}

החזר אך ורק JSON תקני.
סוג ההשאלה שנבחר או זוהה מראש הוא: ${requestedLoanType}.
אם הטקסט לא סותר זאת במפורש, השתמש בדיוק בסוג ההשאלה הזה.
      `.trim();

      const requestBody = {
        contents: [{ parts: [{ text: promptText }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              loanType: { type: "STRING" },
              startDate: { type: "STRING" },
              startTime: { type: "STRING" },
              endDate: { type: "STRING" },
              endTime: { type: "STRING" },
              items: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    equipmentId: { type: "STRING" },
                    quantity: { type: "NUMBER" },
                  },
                  required: ["equipmentId", "quantity"],
                },
              },
            },
            required: ["loanType", "startDate", "startTime", "endDate", "endTime", "items"],
          },
        },
      };

      const response = await fetchWithRetry('/api/gemini', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
      }

      const jsonResponse = await response.json();
      if (!jsonResponse?.candidates?.length) {
        throw new Error("לא התקבלה תשובה תקינה מ-Gemini.");
      }

      const generatedText = jsonResponse.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const result = parseSmartBookingJson(generatedText);
      const nextLoanType = preselectedLoanType || forcedLoanType || promptLoanType || normalizeSmartLoanType(result?.loanType);
      const startDate = normalizeSmartDate(result?.startDate);
      const endDate = normalizeSmartDate(result?.endDate) || startDate;
      const startTime = normalizeSmartTime(result?.startTime);
      const endTime = normalizeSmartTime(result?.endTime);

      if (!nextLoanType) {
        throw new Error("יש לבחור סוג השאלה לפני המשך.");
      }

      const visibleEquipmentIds = new Set(
        allowedEquipmentList
          .filter((equipmentItem) => matchesEquipmentLoanType(equipmentItem, nextLoanType, liveCategoryLoanTypes))
          .map((equipmentItem) => String(equipmentItem.id))
      );
      const resolvedItems = (result?.items || [])
        .map((item) => {
          const match = allowedEquipmentList.find((equipmentItem) => String(equipmentItem.id) === String(item?.equipmentId));
          if (!match || !visibleEquipmentIds.has(String(match.id))) return null;
          return {
            equipment_id: match.id,
            quantity: Math.max(1, Number(item?.quantity) || 1),
            name: match.name,
          };
        })
        .filter(Boolean);

      if (!resolvedItems.length) {
        throw new Error("לא הצלחנו להתאים פריטי ציוד שמותרים לסוג ההשאלה הזה.");
      }

      if (!startDate || !endDate || !startTime || !endTime) {
        throw new Error("לא הצלחנו לפענח תאריכים ושעות תקינים מהבקשה.");
      }

      const nextForm = {
        ...form,
        student_name: form.student_name || loggedInStudent?.name || "",
        email: form.email || loggedInStudent?.email || "",
        phone: form.phone || loggedInStudent?.phone || "",
        course: form.course || loggedInStudent?.track || "",
        loan_type: nextLoanType,
        borrow_date: startDate,
        borrow_time: startTime,
        return_date: endDate,
        return_time: endTime,
        sound_day_loan: false,
        sound_night_loan: false,
        studio_booking_id: "",
      };

      if (nextLoanType === "הפקה" && !nextForm.crew_photographer_name) {
        nextForm.crew_photographer_name = form.student_name || loggedInStudent?.name || "";
      }

      const policyError = getSmartEquipmentPolicyError(nextForm, resolvedItems);
      if (policyError) {
        showToast("error", policyError);
        return;
      }

      let liveReservations = reservations;
      try {
        const freshReservations = await storageGet("reservations");
        if (Array.isArray(freshReservations)) liveReservations = freshReservations;
      } catch (error) {
        console.warn("Could not refresh reservations before AI equipment validation", error);
      }

      const certificationIssues = resolvedItems
        .map((item) => {
          const equipmentItem = equipment.find((eq) => String(eq.id) === String(item.equipment_id));
          if (!equipmentItem || canBorrowEqForForm(nextForm, equipmentItem)) return null;
          return equipmentItem.name;
        })
        .filter(Boolean);
      if (certificationIssues.length) {
        showToast("error", `הבקשה שפוענחה לא תואמת להסמכות הפעילות במערכת: ${certificationIssues.join(", ")}.`);
        return;
      }

      const availabilityIssues = resolvedItems
        .map((item) => {
          const availableQty = getAvailable(
            item.equipment_id,
            nextForm.borrow_date,
            nextForm.return_date,
            liveReservations,
            equipment,
            null,
            nextForm.borrow_time,
            nextForm.return_time
          );
          if (Number(item.quantity) <= availableQty) return null;
          return `${item.name} — ביקשת ${item.quantity}, זמינים כרגע ${availableQty}`;
        })
        .filter(Boolean);
      if (availabilityIssues.length) {
        showToast("error", `הבקשה שפוענחה לא תואמת למלאי המחסן בזמן אמת: ${availabilityIssues.join(" ; ")}.`);
        return;
      }

      setForm(nextForm);
      setItems(resolvedItems);
      setAgreed(false);
      setStep(4);
      setEquipmentAiForcedLoanType("");
      shouldCloseEquipmentAiModal = true;
      showToast("success", "ה-AI מילא את הטופס עבורך. עברו לשלב האישור וקראו את הנהלים.");
    } catch (error) {
      console.error("AI Equipment Booking Error:", error);
      showToast("error", error?.message || "לא הצלחנו להבין את הבקשה. נסה לפרט יותר או למלא ידנית.");
    } finally {
      setEquipmentAiLoading(false);
      if (shouldCloseEquipmentAiModal) {
        setShowEquipmentAiModal(false);
        setShowEquipmentAiLoanTypePrompt(false);
        setEquipmentAiPrompt("");
      }
    }
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
      // Notify staff_members with matching notifyLoanTypes
      fetch("/api/notify-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loan_type:      res.loan_type,
          student_name:   res.student_name,
          items_list:     itemsList,
          borrow_date:    formatDate(res.borrow_date),
          return_date:    formatDate(res.return_date),
          logo_url:       siteSettings.logo || "",
          sound_logo_url: siteSettings.soundLogo || "",
        }),
      }).catch(() => {});
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
    if (pastLoanTimeError) {
      showToast("error", pastLoanTimeError);
      setStep(2);
      return;
    }
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

  const reset = () => { setDone(false); setEmailError(false); setStep(1); setForm({student_name:"",email:"",phone:"",course:"",project_name:"",borrow_date:"",borrow_time:"",return_date:"",return_time:"",loan_type:"",sound_day_loan:false,sound_night_loan:false,studio_booking_id:"",crew_photographer_name:"",crew_photographer_phone:"",crew_sound_name:"",crew_sound_phone:""}); setItems([]); setAgreed(false); };

  const VIEWS = ["equipment", "studios", "daily", "my-bookings"];
  const handleFormSwipeStart = (e) => {
    const touch = e.touches[0];
    const blocked = !!e.target.closest('[data-no-swipe]');
    swipeTouchRef.current = { startX: touch.clientX, startY: touch.clientY, blocked };
  };
  const handleFormSwipeEnd = (e) => {
    if (!swipeTouchRef.current) return;
    const { startX, startY, blocked } = swipeTouchRef.current;
    swipeTouchRef.current = null;
    if (blocked) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const idx = VIEWS.indexOf(publicView);
    if (dx < 0 && idx < VIEWS.length - 1) {
      const next = VIEWS[idx + 1];
      setPublicView(next);
      sessionStorage.setItem("public_view", next);
      if (next === "studios") loadStudiosData();
      if (next === "daily") { setDailyDayOffset(0); loadDailySchedule(); }
      if (next === "my-bookings") { loadStudiosData(); loadReservationsData(); }
    } else if (dx > 0 && idx > 0) {
      const prev = VIEWS[idx - 1];
      setPublicView(prev);
      sessionStorage.setItem("public_view", prev);
    }
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
        <h2 style={{fontSize:20,fontWeight:900,color:"var(--accent)",marginBottom:4}}>מערכת פניות לסטודנט</h2>
        <div style={{fontSize:13,color:"var(--text3)",marginBottom:24}}>מכללת קמרה אובסקורה וסאונד</div>
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
        <div style={{marginTop:20,paddingTop:16,borderTop:"1px solid var(--border)",textAlign:"center"}}>
          <a
            href="/admin/login"
            style={{fontSize:12,color:"var(--text3)",textDecoration:"none",display:"inline-flex",alignItems:"center",gap:6,padding:"7px 14px",borderRadius:"var(--r-sm)",border:"1px solid var(--border)",background:"transparent",cursor:"pointer",transition:"color 0.15s"}}
            onMouseEnter={e=>{e.currentTarget.style.color="var(--text)";e.currentTarget.style.borderColor="var(--text2)";}}
            onMouseLeave={e=>{e.currentTarget.style.color="var(--text3)";e.currentTarget.style.borderColor="var(--border)";}}>
            🔐 כניסת סגל וצוות
          </a>
        </div>
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
          <button type="button" onClick={async()=>{ await syncInventory(); setShowInfoPanel(true); }}
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
            <div style={{fontSize:22,fontWeight:900,color:"var(--accent)"}}>מערכת פניות לסטודנט</div>
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
              🎙️ קביעת חדרים
            </button>
            <button type="button" onClick={()=>{setPublicView("daily");setDailyDayOffset(0);loadDailySchedule();}}
              style={{flex:1,padding:"10px 8px",borderRadius:6,border:"none",background:publicView==="daily"?"var(--accent)":"transparent",color:publicView==="daily"?"#000":"var(--text2)",fontWeight:800,fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              📅 לוז יומי
            </button>
            <button type="button" onClick={()=>{setPublicView("my-bookings");loadStudiosData();loadReservationsData();}}
              style={{flex:1,padding:"10px 8px",borderRadius:6,border:"none",background:publicView==="my-bookings"?"var(--accent)":"transparent",color:publicView==="my-bookings"?"#000":"var(--text2)",fontWeight:800,fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              📋 ההזמנות
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
          </>}
        </div>
        {publicView==="equipment" && <div className="form-card-body">
          {step===1 && <>
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:16}}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async()=>{ await syncInventory(); setShowEquipmentAiModal(true); }}
                disabled={equipmentAiLoading || !visibleLoanTypeOptions.length}
                style={{display:"inline-flex",alignItems:"center",gap:8,fontWeight:800}}
              >
                ✨ השאלת ציוד חכמה
              </button>
            </div>
            <div className="form-section-title">סוג ההשאלה</div>
            {!visibleLoanTypeOptions.length && (
              <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>
                🚫 לא הוגדרו סוגי השאלה זמינים למסלול הלימודים שלך. יש לפנות לצוות המחסן.
              </div>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:24}}>
              {visibleLoanTypeOptions.map(opt=>(
                <div key={opt.val} onClick={()=>{
                  setForm((prev) => ({
                    ...prev,
                    loan_type: opt.val,
                    sound_day_loan: opt.val==="סאונד" ? prev.sound_day_loan : false,
                    sound_night_loan: opt.val==="סאונד" ? prev.sound_night_loan : false,
                    studio_booking_id: opt.val==="סאונד" ? prev.studio_booking_id : "",
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

            <button className="btn btn-primary" disabled={!ok1} onClick={()=>setStep(2)}>{isSoundLoan ? "המשך ← שיוך קביעת חדר" : "המשך ← תאריכים"}</button>
          </>}

          {step===2 && <>
            <div className="form-section-title">
              <span>{isSoundLoan ? "שיוך קביעת חדר" : "תאריכים ושעות"}</span>
            </div>
            {isSoundLoan && (
              <div style={{marginBottom:16,background:"rgba(245,166,35,0.08)",border:"2px solid rgba(245,166,35,0.5)",borderRadius:"var(--r-sm)",padding:"14px 16px"}}>
                <label style={{display:"block",fontWeight:800,fontSize:13,color:"#f5a623",marginBottom:8}}>🎙️ שיוך לקביעת חדר *
                  {!form.studio_booking_id && <span style={{fontWeight:400,fontSize:11,color:"var(--red)",marginRight:8}}>— חובה לשייך קביעת חדר</span>}
                </label>
                <select className="form-select" value={form.studio_booking_id} onChange={e=>{
                  const gId = e.target.value;
                  if (gId) {
                    const grp = groupedStudentBookings.find(g=>g.primaryId===gId);
                    if (grp) {
                      const hasNight = grp.bookings.some(b=>b.isNight);
                      setForm(prev=>({...prev, studio_booking_id:gId,
                        borrow_date:grp.startDate, borrow_time:grp.startTime||"",
                        return_date:grp.endDate, return_time:grp.endTime||"",
                        sound_night_loan:hasNight, sound_day_loan:!hasNight}));
                    }
                  } else {
                    setForm(prev=>({...prev, studio_booking_id:"", borrow_date:"", borrow_time:"", return_date:"", return_time:"", sound_day_loan:false, sound_night_loan:false}));
                  }
                }} style={{borderColor: form.studio_booking_id ? "var(--accent)" : "rgba(245,166,35,0.6)"}}>
                  <option value="">-- בחר קביעת חדר --</option>
                  {groupedStudentBookings.map(grp=>{
                    const studio = visibleStudios?.find(s=>String(s.id)===String(grp.studioId)) || studios?.find(s=>String(s.id)===String(grp.studioId));
                    const hasNight = grp.bookings.some(b=>b.isNight);
                    const timeLabel = grp.isMultiDay
                      ? `${grp.startDate} ${grp.startTime||""} – ${grp.endDate} ${grp.endTime||""}`
                      : `${grp.startDate} · ${grp.startTime||""}–${grp.endTime||""}`;
                    const icon = hasNight ? "🌙" : "☀️";
                    return <option key={grp.primaryId} value={grp.primaryId}>{icon} {studio?.name||"חדר"} · {timeLabel}</option>;
                  })}
                </select>
                {!form.studio_booking_id && <div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>אין לך קביעת חדר? עבור לדף "קביעת חדרים" וקבע חדר תחילה.</div>}
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
            ) : isSoundLoan ? (
              form.studio_booking_id && form.borrow_date ? (
                <div style={{background:"rgba(76,217,100,0.08)",border:"1px solid rgba(76,217,100,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>
                  ✅ <strong>מועד ההשאלה נקבע לפי קביעת החדר:</strong>{" "}
                  {form.borrow_date === form.return_date
                    ? `${formatDate(form.borrow_date)} · ${form.borrow_time}–${form.return_time}`
                    : `${formatDate(form.borrow_date)} ${form.borrow_time} עד ${formatDate(form.return_date)} ${form.return_time}`}
                </div>
              ) : null
            ) : (
              <>
                <div className="grid-2">
                  <div className="form-group"><label className="form-label">📅 תאריך השאלה *</label><input type="date" className="form-input" min={minDate} value={form.borrow_date} onChange={e=>set("borrow_date",e.target.value)}/></div>
                  <div className="form-group"><label className="form-label">שעת איסוף *</label>
                    <select className="form-select" value={form.borrow_time} onChange={e=>setForm(prev=>({...prev,borrow_time:e.target.value}))}>
                      <option value="">-- בחר שעה --</option>
                      {availableBorrowSlots.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid-2">
                  <div className="form-group"><label className="form-label">📅 תאריך החזרה *</label><input type="date" className="form-input" min={form.borrow_date||today()} value={form.return_date} onChange={e=>set("return_date",e.target.value)}/></div>
                  <div className="form-group"><label className="form-label">שעת החזרה *</label>
                    <select className="form-select" value={form.return_time} onChange={e=>set("return_time",e.target.value)}>
                      <option value="">-- בחר שעה --</option>
                      {availableReturnSlots.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              </>
            )}
            {!isSoundLoan && (borrowWeekend||(returnWeekend&&!isCinemaLoan)) && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 המחסן אינו פעיל בימים שישי ושבת. נא לבחור ימים א׳–ה׳ בלבד.</div>}
            {!isSoundLoan && tooSoon && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 {form.loan_type==="פרטית"?"השאלה פרטית דורשת התראה של 48 שעות לפחות.":"נדרשת התראה של שבוע לפחות."} תאריך מוקדם ביותר: <strong>{formatDate(minDate)}</strong></div>}
            {cinemaTooSoon && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 השאלת קולנוע יומית דורשת הזמנה של 24 שעות מראש. תאריך מוקדם ביותר: <strong>{formatDate(minDate)}</strong></div>}
            {!isSoundLoan && tooLong && !isCinemaLoan && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 לא ניתן להשלים את התהליך כי זמן ההשאלה חורג מנהלי המכללה. משך מקסימלי: <strong>{maxDays} ימים</strong></div>}
            {!isSoundLoan && returnBeforeBorrow && !isCinemaLoan && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 זמנים לא נכונים — תאריך החזרה חייב להיות אחרי תאריך ההשאלה.</div>}
            {!isSoundLoan && timeOrderError && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 זמנים לא נכונים — שעת החזרה חייבת להיות אחרי שעת האיסוף באותו יום.</div>}
            {!isSoundLoan && pastLoanTimeError && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:"var(--r-sm)",padding:"12px 16px",marginBottom:16,fontSize:13}}>🚫 {pastLoanTimeError}</div>}
            {ok2 && !isSoundLoan && <div className="highlight-box">{isCinemaLoan ? `🎥 השאלת קולנוע יומית · ${formatDate(form.borrow_date)} · ${form.borrow_time}–${form.return_time}` : `📅 השאלה ל-${loanDays} ימים · איסוף ${form.borrow_time} · החזרה ${form.return_time}`}</div>}

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
            categoryLoanTypes={categoryLoanTypes}
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
        </div>}
        {publicView==="studios" && <div className="form-card-body" style={{padding:0}}>
          <PublicStudioBooking
            studios={visibleStudios} bookings={studioBookings} setBookings={setStudioBookings}
            student={loggedInStudent} showToast={showToast}
            weekOffset={studioWeekOffset} setWeekOffset={setStudioWeekOffset}
            modal={studioModal} setModal={setStudioModal}
            certifications={certifications}
            siteSettings={siteSettings}
            policies={policies}
          />
        </div>}
        {publicView==="daily" && <div className="form-card-body">
          {(() => {
            const offsetDate = new Date();
            offsetDate.setDate(offsetDate.getDate() + dailyDayOffset);
            const yyyy = offsetDate.getFullYear();
            const mm = String(offsetDate.getMonth()+1).padStart(2,"0");
            const dd = String(offsetDate.getDate()).padStart(2,"0");
            const targetDate = `${yyyy}-${mm}-${dd}`;
            const HE_DAYS = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
            const dayName = HE_DAYS[offsetDate.getDay()];
            const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
            const dateLabel = `יום ${dayName}, ${dd} ב${HE_MONTHS[offsetDate.getMonth()]} ${yyyy}`;
            const allSessions = [];
            dailyLessons.forEach(lesson => {
              (lesson.schedule||[]).forEach(s => {
                if (s.date === targetDate) {
                  allSessions.push({ lessonName: lesson.name||"", instructorName: lesson.instructorName||"", topic: s.topic||"", startTime: s.startTime||"", endTime: s.endTime||"", track: lesson.track||"" });
                }
              });
            });
            allSessions.sort((a,b) => {
              const s = (a.startTime||"").localeCompare(b.startTime||"");
              return s !== 0 ? s : (a.endTime||"").localeCompare(b.endTime||"");
            });
            const studentTrack = (loggedInStudent?.track||"").trim();
            const sessions = dailyMyLessons && studentTrack
              ? allSessions.filter(s => (s.track||"").trim() === studentTrack)
              : allSessions;
            return <>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,gap:8}}>
                {/* כפתור ימיני — אחורה בזמן (יום קודם) */}
                <button type="button" onClick={()=>setDailyDayOffset(o=>Math.max(0,o-1))} disabled={dailyDayOffset===0}
                  style={{padding:"6px 14px",borderRadius:6,border:"1px solid var(--border)",background:"var(--surface2)",cursor:dailyDayOffset===0?"not-allowed":"pointer",opacity:dailyDayOffset===0?0.4:1,fontSize:18,fontWeight:900}}>›</button>
                <div style={{textAlign:"center",fontWeight:800,fontSize:14,color:"var(--text)"}}>
                  {dateLabel}
                </div>
                {/* כפתור שמאלי — קדימה בזמן (יום הבא) */}
                <button type="button" onClick={()=>setDailyDayOffset(o=>Math.min(6,o+1))} disabled={dailyDayOffset===6}
                  style={{padding:"6px 14px",borderRadius:6,border:"1px solid var(--border)",background:"var(--surface2)",cursor:dailyDayOffset===6?"not-allowed":"pointer",opacity:dailyDayOffset===6?0.4:1,fontSize:18,fontWeight:900}}>‹</button>
              </div>
              <div style={{display:"flex",gap:8,marginBottom:14,justifyContent:"center",flexWrap:"wrap"}}>
                {dailyDayOffset!==0 && (
                  <button type="button" onClick={()=>setDailyDayOffset(0)}
                    style={{padding:"5px 14px",borderRadius:20,border:"1px solid var(--accent)",background:"transparent",color:"var(--accent)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                    היום
                  </button>
                )}
                {studentTrack && (
                  <button type="button" onClick={()=>setDailyMyLessons(v=>!v)}
                    style={{padding:"5px 14px",borderRadius:20,border:`1px solid ${dailyMyLessons?"var(--accent)":"var(--border)"}`,background:dailyMyLessons?"var(--accent)":"transparent",color:dailyMyLessons?"#000":"var(--text2)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                    השיעורים שלי
                  </button>
                )}
              </div>
              {sessions.length===0
                ? <div style={{textAlign:"center",color:"var(--text3)",fontSize:14,padding:"32px 0"}}>אין שיעורים מתוכננים ליום זה</div>
                : <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {sessions.map((s,i)=>(
                      <div key={i} style={{background:"var(--surface2)",borderRadius:10,padding:"14px 16px",borderRight:"4px solid var(--accent)"}}>
                        {/* שם השיעור */}
                        <div style={{fontWeight:900,fontSize:17,color:"var(--text)",marginBottom:6}}>{s.lessonName}</div>
                        {/* שעות — בולטות */}
                        {(s.startTime||s.endTime) && (
                          <div style={{fontWeight:800,fontSize:16,color:"var(--accent)",marginBottom:6}}>
                            🕐 {s.startTime}{s.endTime ? `–${s.endTime}` : ""}
                          </div>
                        )}
                        {/* שם מרצה — גדול וברור */}
                        {s.instructorName && (
                          <div style={{fontWeight:700,fontSize:15,color:"var(--text2)",marginBottom:s.track||s.topic?4:0}}>
                            👤 {s.instructorName}
                          </div>
                        )}
                        {/* מסלול */}
                        {s.track && (
                          <div style={{display:"inline-block",fontSize:12,fontWeight:700,color:"var(--accent)",background:"var(--accent-glow)",borderRadius:20,padding:"2px 10px",marginBottom:s.topic?4:0}}>
                            🎓 {s.track}
                          </div>
                        )}
                        {/* נושא */}
                        {s.topic && <div style={{fontSize:12,color:"var(--text3)"}}>📖 {s.topic}</div>}
                      </div>
                    ))}
                  </div>
              }
            </>;
          })()}
        </div>}
        {publicView==="my-bookings" && <div className="form-card-body" style={{direction:"rtl"}}>
          {/* ─── קביעות אולפן ─── */}
          <div style={{fontWeight:900,fontSize:15,marginBottom:12,paddingBottom:10,borderBottom:"1px solid var(--border)"}}>🎙️ קביעות אולפן</div>
          {(()=>{
            const myBookings = studioBookings.filter(b=>{
              if (!b||!loggedInStudent) return false;
              if (b.bookingKind&&b.bookingKind!=="student") return false;
              const stEmail=String(loggedInStudent.email||"").toLowerCase().trim();
              const bEmail=String(b.studentEmail||"").toLowerCase().trim();
              if (stEmail&&bEmail) return stEmail===bEmail;
              return normalizeName(b.studentName||"")===normalizeName(loggedInStudent.name||"");
            }).sort((a,b)=>a.date>b.date?1:a.date<b.date?-1:(a.startTime||"")>(b.startTime||"")?1:-1);
            const NBST="21:30",NBET="08:00";
            const isFuture=b=>{const e=b.isNight?(()=>{const d=new Date(b.date);d.setDate(d.getDate()+1);return d.toISOString().slice(0,10);})():b.date;return new Date(`${e}T${b.endTime||"23:59"}:00`).getTime()>Date.now();};
            const futureOnes=myBookings.filter(isFuture);
            const handleCancel=async id=>{const updated=studioBookings.filter(b=>b.id!==id);setStudioBookings(updated);await storageSet("studio_bookings",updated);showToast("success","❌ ההזמנה בוטלה");};
            const handleSaveEdit=async()=>{
              if(!editingBooking) return;
              const{id,studioId,date,startTime,endTime}=editingBooking;
              if(!startTime||!endTime||startTime>=endTime){showToast("error","שעת סיום חייבת להיות אחרי שעת התחלה");return;}
              const overlap=studioBookings.some(b=>String(b.studioId)===String(studioId)&&b.date===date&&b.id!==id&&b.status!=="נדחה"&&!(endTime<=b.startTime||startTime>=b.endTime));
              if(overlap){showToast("error","⚠️ קיימת הזמנה חופפת לשעות אלו");return;}
              const hoursLimit=getStudioFutureHoursLimit(siteSettings);
              const now=new Date();
              const otherFutureHours=studioBookings.reduce((sum,b)=>{
                if(b.id===id||b.status==="נדחה") return sum;
                const stEmail=String(loggedInStudent?.email||"").toLowerCase().trim();
                const bEmail=String(b.studentEmail||"").toLowerCase().trim();
                const isOwn=stEmail&&bEmail?stEmail===bEmail:normalizeName(b.studentName||"")===normalizeName(loggedInStudent?.name||"");
                if(!isOwn) return sum;
                return sum+getFutureStudioBookingHours(b,now,NBST,NBET);
              },0);
              const reqHours=getFutureStudioBookingHours({date,startTime,endTime,isNight:false},now,NBST,NBET);
              if(otherFutureHours+reqHours>hoursLimit+0.0001){showToast("error",`חרגת ממכסת השעות (${formatStudioHoursValue(hoursLimit)} שעות)`);return;}
              setEditBookingSaving(true);
              const updated=studioBookings.map(b=>b.id===id?{...b,startTime,endTime}:b);
              setStudioBookings(updated);
              await storageSet("studio_bookings",updated);
              setEditingBooking(null);
              setEditBookingSaving(false);
              showToast("success","✅ ההזמנה עודכנה");
            };
            const renderRow=(b)=>{
              const studioObj=studios.find(s=>String(s.id)===String(b.studioId));
              const color=b.isNight?"#2196f3":"var(--green)";
              const timeLabel=b.isNight?`מ-21:30 והלאה`:`${b.startTime||""}–${b.endTime||""}`;
              const isEditing=editingBooking?.id===b.id;
              return (<div key={b.id} style={{background:"var(--surface2)",borderRadius:8,marginBottom:8,border:`1px solid ${color}33`,borderRight:`3px solid ${color}`,overflow:"hidden"}}>
                <div style={{padding:"12px 14px",display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,flexWrap:"wrap"}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:13}}>{studioObj?.name||"אולפן"}{b.isNight&&<span style={{color:"#2196f3",marginRight:4}}> 🌙</span>}</div>
                    <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>📅 {fmtDate(b.date)} · ⏰ {timeLabel}</div>
                    {b.notes&&<div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>💬 {b.notes}</div>}
                  </div>
                  <div style={{display:"flex",gap:6,flexShrink:0}}>
                    {!b.isNight&&<button onClick={()=>setEditingBooking(isEditing?null:{id:b.id,studioId:b.studioId,date:b.date,startTime:b.startTime||"",endTime:b.endTime||""})} style={{background:isEditing?"var(--surface3)":"var(--accent)",color:isEditing?"var(--text)":"#000",border:"none",borderRadius:4,padding:"4px 10px",fontSize:11,fontWeight:700,cursor:"pointer"}}>{isEditing?"✕ סגור":"✏️ ערוך"}</button>}
                    <button onClick={()=>handleCancel(b.id)} style={{background:"var(--red)",color:"#fff",border:"none",borderRadius:4,padding:"4px 10px",fontSize:11,fontWeight:700,cursor:"pointer"}}>❌ בטל</button>
                  </div>
                </div>
                {isEditing&&<div style={{padding:"12px 14px",borderTop:`1px solid ${color}33`,background:"var(--surface3)"}}>
                  <div style={{fontSize:12,fontWeight:700,marginBottom:10,color:"var(--text2)"}}>✏️ עריכת שעות — {fmtDate(b.date)}</div>
                  <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",marginBottom:12}}>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <label style={{fontSize:11,color:"var(--text3)",fontWeight:700}}>שעת התחלה</label>
                      <input type="time" value={editingBooking.startTime} onChange={e=>setEditingBooking(p=>({...p,startTime:e.target.value}))} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:6,padding:"6px 8px",color:"var(--text)",fontSize:13,fontWeight:700}}/>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <label style={{fontSize:11,color:"var(--text3)",fontWeight:700}}>שעת סיום</label>
                      <input type="time" value={editingBooking.endTime} onChange={e=>setEditingBooking(p=>({...p,endTime:e.target.value}))} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:6,padding:"6px 8px",color:"var(--text)",fontSize:13,fontWeight:700}}/>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={handleSaveEdit} disabled={editBookingSaving} style={{background:"var(--green)",color:"#fff",border:"none",borderRadius:6,padding:"7px 18px",fontSize:12,fontWeight:700,cursor:"pointer"}}>{editBookingSaving?"שומר...":"💾 שמור שינויים"}</button>
                    <button onClick={()=>setEditingBooking(null)} style={{background:"var(--surface)",color:"var(--text2)",border:"1px solid var(--border)",borderRadius:6,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>ביטול</button>
                  </div>
                </div>}
              </div>);
            };
            if (futureOnes.length===0) return <div style={{textAlign:"center",color:"var(--text3)",padding:"20px 0",fontSize:13}}>אין קביעות אולפן עתידיות</div>;
            return <>{futureOnes.map(b=>renderRow(b))}</>;
          })()}

          {/* ─── רשימת ציוד ─── */}
          <div style={{fontWeight:900,fontSize:15,marginTop:28,marginBottom:12,paddingBottom:10,borderBottom:"1px solid var(--border)"}}>📦 רשימת ציוד</div>
          {(()=>{
            const sColor=s=>s==="מאושר"||s==="פעילה"?"#1a7a4a":s==="ממתין"||s==="אישור ראש מחלקה"?"#b8860b":s==="נדחה"?"#c0392b":s==="באיחור"?"#e67e22":s==="הוחזר"?"#2471a3":"var(--text3)";
            const sBg=s=>s==="מאושר"||s==="פעילה"?"rgba(46,204,113,0.15)":s==="ממתין"||s==="אישור ראש מחלקה"?"rgba(241,196,15,0.15)":s==="נדחה"?"rgba(231,76,60,0.15)":s==="באיחור"?"rgba(230,126,34,0.18)":s==="הוחזר"?"rgba(52,152,219,0.15)":"var(--surface2)";
            const sBorder=s=>s==="מאושר"||s==="פעילה"?"rgba(46,204,113,0.25)":s==="ממתין"||s==="אישור ראש מחלקה"?"rgba(241,196,15,0.25)":s==="נדחה"?"rgba(231,76,60,0.3)":s==="באיחור"?"rgba(230,126,34,0.4)":s==="הוחזר"?"rgba(52,152,219,0.25)":"var(--border)";
            const myRes=[...reservations].filter(r=>{
              const stEmail=String(loggedInStudent?.email||"").toLowerCase().trim();
              const rEmail=String(r.email||"").toLowerCase().trim();
              if (stEmail&&rEmail) return stEmail===rEmail;
              return normalizeName(r.student_name||"")===normalizeName(loggedInStudent?.name||"");
            }).filter(r=>getEffectiveStatus(r)!=="הוחזר").sort((a,b)=>(b.borrow_date||"")>(a.borrow_date||"")?1:-1);
            if (myRes.length===0) return <div style={{textAlign:"center",color:"var(--text3)",padding:"20px 0",fontSize:13}}>אין בקשות השאלה</div>;
            return myRes.map(r=>{
              const isExp=expandedResId===r.id;
              const st=getEffectiveStatus(r);
              const cardBg=st==="פעילה"?"rgba(46,204,113,0.08)":st==="באיחור"?"rgba(230,126,34,0.08)":r.loan_type==="סאונד"?"rgba(245,166,35,0.06)":r.loan_type==="הפקה"?"rgba(52,152,219,0.06)":r.loan_type==="קולנוע יומית"?"rgba(52,152,219,0.08)":r.loan_type==="שיעור"?"rgba(155,89,182,0.1)":"var(--surface2)";
              const cardBorder=st==="פעילה"?"rgba(46,204,113,0.35)":st==="באיחור"?"rgba(230,126,34,0.45)":r.loan_type==="סאונד"?"rgba(245,166,35,0.25)":r.loan_type==="הפקה"?"rgba(52,152,219,0.25)":r.loan_type==="קולנוע יומית"?"rgba(52,152,219,0.3)":r.loan_type==="שיעור"?"rgba(155,89,182,0.3)":"var(--border)";
              return (<div key={r.id} style={{borderRadius:10,border:`1px solid ${cardBorder}`,marginBottom:10,overflow:"hidden"}}>
                <div style={{background:cardBg,padding:"12px 14px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}} onClick={()=>setExpandedResId(isExp?null:r.id)}>
                  <div>
                    <div style={{fontWeight:700,fontSize:13}}>
                      📅 {fmtDate(r.borrow_date)}{r.borrow_time&&<span style={{color:"var(--accent)",marginRight:4}}> {r.borrow_time}</span>} ← {fmtDate(r.return_date)}{r.return_time&&<span style={{color:"var(--accent)",marginRight:4}}> {r.return_time}</span>}
                    </div>
                    <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{r.loan_type&&<span style={{marginLeft:8}}>{r.loan_type}</span>}{r.items?.length||0} פריטים</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                    <span style={{background:sBg(st),color:sColor(st),border:`1px solid ${sBorder(st)}`,borderRadius:100,padding:"2px 10px",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{st}</span>
                    <span style={{fontSize:13,color:"var(--text3)",display:"inline-block",transform:isExp?"rotate(180deg)":"rotate(0deg)",transition:"transform 0.2s"}}>▾</span>
                  </div>
                </div>
                {isExp&&<div style={{padding:"12px 14px",borderTop:`1px solid ${sBorder(st)}`,display:"flex",flexDirection:"column",gap:10}}>
                  {(r.items||[]).map((item,i)=>{
                    const eq=equipment.find(e=>String(e.id)===String(item.equipment_id));
                    const img=eq?.image;
                    return (<div key={i} style={{display:"flex",alignItems:"center",gap:10}}>
                      {img?.startsWith("data:")||img?.startsWith("http")
                        ?<img src={img} alt="" style={{width:38,height:38,objectFit:"cover",borderRadius:6,flexShrink:0}}/>
                        :<span style={{fontSize:30,flexShrink:0}}>{img||"📦"}</span>}
                      <div><div style={{fontWeight:700,fontSize:13}}>{eq?.name||item.name||"פריט"}</div><div style={{fontSize:11,color:"var(--text3)"}}>כמות: {item.quantity}</div></div>
                    </div>);
                  })}
                </div>}
              </div>);
            });
          })()}
        </div>}
        <div style={{padding:"16px 24px",borderTop:"1px solid var(--border)",textAlign:"center"}}>
          <button
            type="button"
            onClick={() => { setLoggedInStudent(null); sessionStorage.removeItem("public_view"); }}
            style={{background:"var(--surface2)",border:"1px solid var(--border)",color:"var(--text2)",fontSize:13,cursor:"pointer",padding:"8px 20px",borderRadius:8,transition:"all 0.15s",fontWeight:600}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--accent)";e.currentTarget.style.color="var(--accent)";}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--border)";e.currentTarget.style.color="var(--text2)";}}
          >
            ← חזרה לדף הכניסה
          </button>
        </div>
      </div>
    </div>
    {showInfoPanel&&<InfoPanel policies={policies} kits={kits} equipment={equipment} teamMembers={teamMembers} onClose={()=>setShowInfoPanel(false)} accentColor={siteSettings.accentColor}/>}
    {showEquipmentAiModal && (
      <div
        style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:2600,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
        onClick={(e)=>e.target===e.currentTarget&&closeEquipmentAiModal()}
      >
        <div style={{width:"100%",maxWidth:560,background:"var(--surface)",borderRadius:18,border:"1px solid var(--border)",direction:"rtl",boxShadow:"0 30px 80px rgba(0,0,0,0.35)"}}>
          <div style={{padding:"18px 22px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
            <div>
              <div style={{fontWeight:900,fontSize:18,color:"var(--accent)"}}>✨ השאלת ציוד חכמה</div>
              <div style={{fontSize:12,color:"var(--text3)",marginTop:4}}>כתבו במשפט אחד מה אתם צריכים, והמערכת תמלא תאריכים וציוד אוטומטית.</div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={closeEquipmentAiModal}>סגור</button>
          </div>
          <form
            onSubmit={(e)=>{
              e.preventDefault();
              handleSmartEquipmentBooking(equipmentAiPrompt.trim(), equipment);
            }}
            style={{padding:22,display:"flex",flexDirection:"column",gap:14}}
          >
            <label style={{display:"flex",flexDirection:"column",gap:8,fontWeight:700,color:"var(--text2)"}}>
              מה תרצו להשאיל?
              <textarea
                className="form-input"
                rows={5}
                value={equipmentAiPrompt}
                onChange={(e)=>setEquipmentAiPrompt(e.target.value)}
                placeholder='למשל: אני צריך 2 פנסי לד, מצלמת Sony FX3 ומיקרופון אלחוטי ליום חמישי מ-09:00 עד 16:00'
                style={{resize:"vertical",minHeight:140}}
              />
            </label>
            <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.6}}>
              ה-AI ימלא את סוג ההשאלה, התאריכים, השעות והציוד, ואז יעביר אתכם ישר לשלב האישור הסופי.
            </div>
            {!normalizeSmartLoanType(form.loan_type) && (showEquipmentAiLoanTypePrompt || equipmentAiForcedLoanType) && (
              <div style={{background:"rgba(245,166,35,0.08)",border:"1px solid rgba(245,166,35,0.25)",borderRadius:14,padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
                <div style={{fontSize:13,fontWeight:800,color:"var(--text)"}}>
                  {equipmentAiForcedLoanType ? `סוג ההשאלה שנבחר: ${equipmentAiForcedLoanType}` : "לא זיהינו סוג השאלה. בחרו סוג השאלה כדי להמשיך."}
                </div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {visibleLoanTypeOptions.map(({ val: loanTypeOption }) => {
                    const isActive = normalizeSmartLoanType(equipmentAiForcedLoanType) === loanTypeOption;
                    return (
                      <button
                        key={loanTypeOption}
                        type="button"
                        className={isActive ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}
                        onClick={()=>{
                          setEquipmentAiForcedLoanType(loanTypeOption);
                          setShowEquipmentAiLoanTypePrompt(false);
                        }}
                      >
                        {loanTypeOption}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              {equipmentAiLoading && <span style={{fontSize:12,color:"var(--accent)",fontWeight:700}}>מפענח את הבקשה...</span>}
              <div style={{display:"flex",gap:8,marginInlineStart:"auto"}}>
                <button type="button" className="btn btn-secondary" onClick={closeEquipmentAiModal} disabled={equipmentAiLoading}>ביטול</button>
                <button type="submit" className="btn btn-primary" disabled={equipmentAiLoading || !equipmentAiPrompt.trim()}>
                  {equipmentAiLoading ? "ממלא..." : "מלא לי"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    )}
    <AIChatBot equipment={equipment} reservations={reservations} policies={policies} settings={siteSettings} currentUser={loggedInStudent} refreshInventory={syncInventory} />
    </>
  );
}

// ─── PUBLIC STUDIO BOOKING (student side) ────────────────────────────────────
function PublicStudioBooking({ studios, bookings, setBookings, student, showToast, weekOffset, setWeekOffset, modal, setModal, certifications, siteSettings = {}, policies = {} }) {
  const [saving, setSaving] = useState(false);
  const [studioInfoPanel, setStudioInfoPanel] = useState(null); // studio object for info modal
  const [dayView, setDayView] = useState(null); // { studioId, date, dayName }
  const [nightPolicyPending, setNightPolicyPending] = useState(null); // booking args waiting for policy agreement
  const [nightPolicyScrolled, setNightPolicyScrolled] = useState(false);
  const [nightPolicyAgreed, setNightPolicyAgreed] = useState(false);
  const [calendarFullscreen, setCalendarFullscreen] = useState(false);
  const [showAiAssistant, setShowAiAssistant] = useState(false);
  const [smartBookingPrompt, setSmartBookingPrompt] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);

  const DAY_HOURS = (() => { const h = []; for (let hr = 9; hr <= 21; hr++) for (let m = 0; m < 60; m += 15) { if (hr === 21 && m > 30) break; h.push(`${String(hr).padStart(2,"0")}:${String(m).padStart(2,"0")}`); } return h; })();
  const DAY_BOOKING_HOURS = DAY_HOURS.filter(t => t < "21:30");
  const NIGHT_START_TIME = "21:30";
  const NIGHT_END_TIME = "08:00";
  const NIGHT_BOOKING_LABEL = `מ־${NIGHT_START_TIME} והלאה`;
  const STUDENT_COLOR = "var(--green)";
  const TEAM_COLOR = "#9b59b6";
  const LESSON_COLOR = "#f5a623";
  const NIGHT_COLOR = "#2196f3";

  const studioFutureHoursLimit = getStudioFutureHoursLimit(siteSettings);
  const normalizeStudioPhone = (value) => String(value || "").replace(/[^0-9]/g, "");
  // Check if student has night certification
  const studentRecord = (() => {
    const students = certifications?.students || [];
    if (!student) return null;
    if (student.id !== undefined && student.id !== null) {
      const byId = students.find((candidate) => String(candidate.id) === String(student.id));
      if (byId) return byId;
    }
    const studentEmail = String(student.email || "").toLowerCase().trim();
    if (studentEmail) {
      const byEmail = students.find((candidate) => candidate.email?.toLowerCase().trim() === studentEmail);
      if (byEmail) return byEmail;
    }
    const normalizedName = normalizeName(student.name);
    const normalizedPhone = normalizeStudioPhone(student.phone);
    return students.find((candidate) => {
      const sameName = normalizeName(candidate.name) === normalizedName;
      if (!sameName) return false;
      if (!normalizedPhone) return true;
      return normalizeStudioPhone(candidate.phone) === normalizedPhone;
    }) || null;
  })();
  const nightCertType = (certifications?.types||[]).find(t => t.id === "cert_night_studio");
  const hasNightCert = studentRecord && nightCertType && (studentRecord.certs||{})[nightCertType.id] === "עבר";

  // Studio certification check
  const studioCertTypes = (certifications?.types || []).filter(t => t.category === "studio" && t.id !== "cert_night_studio");
  const sameStudioId = (a, b) => String(a) === String(b);
  const SMART_BOOKING_BLOCKED_MESSAGE = "לא ניתן להשלים את הבקשה";
  const STUDIO_MAINTENANCE_MESSAGE = "החדר בתחזוקה, מקווים שישוב לעבוד בקרוב";
  const getStudioCertIds = (studio) => {
    if (Array.isArray(studio?.studioCertIds)) return studio.studioCertIds.filter(Boolean);
    return studio?.studioCertId ? [studio.studioCertId] : [];
  };
  const isStudioDisabled = (studioId) => {
    const studio = studios.find(s => sameStudioId(s.id, studioId));
    return Boolean(studio?.isDisabled);
  };
  const hasStudioCert = (studioId) => {
    const studio = studios.find(s => sameStudioId(s.id, studioId));
    const certIds = getStudioCertIds(studio);
    if (!certIds.length) return true; // no cert required
    return studentRecord && certIds.some(id => (studentRecord.certs || {})[id] === "עבר");
  };
  const getStudioCertName = (studioId) => {
    const studio = studios.find(s => sameStudioId(s.id, studioId));
    const names = getStudioCertIds(studio)
      .map(id => studioCertTypes.find(t => t.id === id)?.name)
      .filter(Boolean);
    return names.length ? names.join(" / ") : null;
  };
  const isBookingOwnedByStudent = (booking) => {
    if (!booking || !student) return false;
    if (booking.bookingKind && booking.bookingKind !== "student") return false;
    if (student.id !== undefined && student.id !== null && booking.studentId !== undefined && booking.studentId !== null) {
      return String(booking.studentId) === String(student.id);
    }
    const studentEmail = String(student.email || "").toLowerCase().trim();
    const bookingEmail = String(booking.studentEmail || "").toLowerCase().trim();
    if (studentEmail && bookingEmail) return studentEmail === bookingEmail;
    const studentPhone = normalizeStudioPhone(student.phone);
    const bookingPhone = normalizeStudioPhone(booking.studentPhone);
    if (studentPhone && bookingPhone) return studentPhone === bookingPhone;
    return normalizeName(booking.studentName) === normalizeName(student.name);
  };
  const getBookingKind = (booking) => {
    if (!booking) return "student";
    if (booking.bookingKind === "lesson" || booking.lesson_auto || (booking.lesson_id !== null && booking.lesson_id !== undefined && String(booking.lesson_id).trim() !== "")) return "lesson";
    if (booking.bookingKind === "team" || booking.ownerType === "team" || booking.teamMemberId || booking.teamMemberName) return "team";
    return "student";
  };
  const getBookingColor = (booking) => {
    const kind = getBookingKind(booking);
    if (kind === "lesson") return LESSON_COLOR;
    if (kind === "team") return TEAM_COLOR;
    if (booking?.isNight) return NIGHT_COLOR;
    return STUDENT_COLOR;
  };
  const getBookingTitle = (booking) => {
    const kind = getBookingKind(booking);
    if (kind === "lesson") return booking?.courseName || booking?.studentName || "שיעור";
    if (kind === "team") return booking?.teamMemberName || booking?.studentName || "איש צוות";
    return booking?.studentName || "סטודנט";
  };
  const getBookingSubtitle = (booking) => {
    const kind = getBookingKind(booking);
    if (kind === "lesson") return booking?.instructorName || "";
    if (kind === "team") return "צוות המחסן";
    return "";
  };
  const getStudioBookingTimeLabel = (booking) => (
    booking?.isNight ? NIGHT_BOOKING_LABEL : `${booking?.startTime || ""}–${booking?.endTime || ""}`
  );
  const isActiveStudioBooking = (booking) => booking?.status !== "נדחה";

  const futureStudentBookedHours = useMemo(() => (
    (bookings || []).reduce((sum, booking) => {
      if (!isActiveStudioBooking(booking) || !isBookingOwnedByStudent(booking)) return sum;
      return sum + getFutureStudioBookingHours(booking, new Date(), NIGHT_START_TIME, NIGHT_END_TIME);
    }, 0)
  ), [bookings, student]);
  const remainingFutureHours = Math.max(0, studioFutureHoursLimit - futureStudentBookedHours);

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
  const openAddBookingModal = ({ studioId, date, dayName, isNight=false, defaultStart, defaultEnd }) => {
    setShowAiAssistant(false);
    setSmartBookingPrompt("");
    setIsAiLoading(false);
    setModal({
      type: "addBooking",
      studioId,
      date,
      dayName,
      isNight,
      defaultStart,
      defaultEnd,
      selectedStudioId: String(studioId ?? ""),
      selectedDate: date || "",
      selectedStartTime: defaultStart || (isNight ? NIGHT_START_TIME : "09:00"),
      selectedEndTime: defaultEnd || (isNight ? NIGHT_END_TIME : "12:00"),
      notes: "",
    });
  };
  const closeBookingModal = () => {
    setShowAiAssistant(false);
    setSmartBookingPrompt("");
    setIsAiLoading(false);
    setModal(null);
  };
  const closeSmartBookingModal = () => {
    setShowAiAssistant(false);
    setSmartBookingPrompt("");
    setIsAiLoading(false);
  };
  const updateAddBookingModal = (patch) => {
    setModal((prev) => (
      prev?.type === "addBooking"
        ? { ...prev, ...patch }
        : prev
    ));
  };
  const getHebrewDayName = (dateStr) => {
    if (!dateStr) return "";
    const date = new Date(`${dateStr}T12:00:00`);
    if (Number.isNaN(date.getTime())) return "";
    return ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][date.getDay()] || "";
  };
  const getClosestTimeOption = (value, options = [], fallback = "") => {
    const target = String(value || "").trim();
    if (!target) return fallback || options[0] || "";
    if (options.includes(target)) return target;
    const targetParts = target.split(":").map(Number);
    if (targetParts.length !== 2 || targetParts.some((part) => Number.isNaN(part))) return fallback || options[0] || "";
    const targetMinutes = targetParts[0] * 60 + targetParts[1];
    let best = fallback || options[0] || "";
    let bestDiff = Number.POSITIVE_INFINITY;
    options.forEach((option) => {
      const [hours, minutes] = String(option || "").split(":").map(Number);
      if (Number.isNaN(hours) || Number.isNaN(minutes)) return;
      const diff = Math.abs((hours * 60 + minutes) - targetMinutes);
      if (diff < bestDiff) {
        best = option;
        bestDiff = diff;
      }
    });
    return best;
  };
  const getStudioBookingValidationError = ({ studioId, date, startTime, endTime, isNight=false, blockedMessage="", excludeBookingId=null }) => {
    const normalizedStartTime = isNight ? NIGHT_START_TIME : startTime;
    const normalizedEndTime = isNight ? NIGHT_END_TIME : endTime;
    if (!studioId || !date || !normalizedStartTime || !normalizedEndTime) return "יש להשלים חדר, תאריך ושעות לפני השליחה";
    if (date < todayStr) return "לא ניתן להזמין תאריך שעבר";
    if (isStudioDisabled(studioId)) return blockedMessage || STUDIO_MAINTENANCE_MESSAGE;
    if (!hasStudioCert(studioId) || (isNight && !hasNightCert)) return blockedMessage || "🔒 טרם עבר הסמכה — לא ניתן לקבוע חדר זה";
    if (!isNight && normalizedStartTime >= normalizedEndTime) return "שעת סיום חייבת להיות אחרי שעת ההתחלה";
    const currentFutureHours = (bookings || []).reduce((sum, booking) => {
      if (!isActiveStudioBooking(booking) || !isBookingOwnedByStudent(booking)) return sum;
      if (excludeBookingId !== null && String(booking.id) === String(excludeBookingId)) return sum;
      return sum + getFutureStudioBookingHours(booking, new Date(), NIGHT_START_TIME, NIGHT_END_TIME);
    }, 0);
    const requestedFutureHours = getFutureStudioBookingHours({ date, startTime: normalizedStartTime, endTime: normalizedEndTime, isNight }, new Date(), NIGHT_START_TIME, NIGHT_END_TIME);
    if ((currentFutureHours + requestedFutureHours) - studioFutureHoursLimit > 0.0001) {
      const remainingHours = Math.max(0, studioFutureHoursLimit - currentFutureHours);
      return `לא ניתן להשלים את הבקשה. נותרו לך ${formatStudioHoursValue(remainingHours)} שעות בבנק השעות העתידיות.`;
    }
    const overlap = bookings.some((booking) => (
      sameStudioId(booking.studioId, studioId)
      && booking.date === date
      && isActiveStudioBooking(booking)
      && (excludeBookingId === null || String(booking.id) !== String(excludeBookingId))
      && !(normalizedEndTime <= booking.startTime || normalizedStartTime >= booking.endTime)
    ));
    if (!isNight && overlap) return "⚠️ קיימת הזמנה חופפת";
    return "";
  };
  const persistStudentBooking = async ({ studioId, date, startTime, endTime, notes="", isNight=false, blockedMessage="", successMessage="✅ החדר הוזמן בהצלחה!" }) => {
    // Night booking always requires consent — close booking modal + day view, then show policy modal
    if (isNight) {
      setModal(null);    // close booking form
      setDayView(null);  // exit day drill-down so policy modal can render
      setNightPolicyPending({ studioId, date, startTime, endTime, notes, isNight, blockedMessage, successMessage });
      setNightPolicyScrolled(false);
      setNightPolicyAgreed(false);
      return false;
    }
    try {
      const normalizedStartTime = startTime;
      const normalizedEndTime = endTime;
      const validationError = getStudioBookingValidationError({ studioId, date, startTime: normalizedStartTime, endTime: normalizedEndTime, isNight, blockedMessage });
      if (validationError) { showToast("error", validationError); return false; }
      const newBooking = {
        id: Date.now(),
        bookingKind: "student",
        studioId, date,
        startTime: normalizedStartTime,
        endTime: normalizedEndTime,
        studentId: student?.id ?? null,
        studentEmail: student?.email || "",
        studentPhone: student?.phone || "",
        studentName: student.name,
        notes, isNight,
        createdAt: new Date().toISOString(),
      };
      const updated = [...bookings, newBooking];
      setBookings(updated);
      await storageSet("studio_bookings", updated);
      showToast("success", successMessage);
      return true;
    } catch(err) {
      console.error("persistStudentBooking error", err);
      showToast("error", "אירעה שגיאה בשמירת ההזמנה. נסה שוב.");
      return false;
    }
  };

  const handleSmartBooking = async (promptText, studiosList) => {
    if (!promptText) return;
    setIsAiLoading(true);

    try {
      const today = todayStr;
      const activeStudios = (studiosList || []).filter((studio) => !isStudioDisabled(studio?.id));
      const certifiedStudios = activeStudios.filter((studio) => hasStudioCert(studio?.id));
      const availableStudios = certifiedStudios;
      if (!availableStudios.length) {
        throw new Error(SMART_BOOKING_BLOCKED_MESSAGE);
      }
      const availableStudiosStr = availableStudios
        .map((studio) => `ID: ${studio.id}, Name: ${studio.name}, Type: ${studio.type || ""}`)
        .join("\n");

      const systemInstruction = `
      אתה עוזר AI חכם להזמנת אולפנים במכללה.
      התאריך של היום הוא: ${today}.
      המשימה שלך היא לחלץ מהבקשה של הסטודנט את תאריך ההזמנה, שעת ההתחלה, שעת הסיום, ואת מזהה האולפן (studioId) המתאים ביותר מתוך הרשימה הבאה:
      ${availableStudiosStr}

      אם הסטודנט מבקש למשל "מחר", חשב את התאריך ביחס ל-${today}.
      החזר אך ורק JSON תקני.
    `;

      const requestBody = {
        contents: [{ parts: [{ text: promptText }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              studioId: { type: "STRING", description: "The exact ID of the requested studio from the provided list" },
              date: { type: "STRING", description: "Format: YYYY-MM-DD" },
              startTime: { type: "STRING", description: "Format: HH:MM" },
              endTime: { type: "STRING", description: "Format: HH:MM" },
            },
            required: ["studioId", "date", "startTime", "endTime"],
          },
        },
      };

      let jsonResponse = null;
      {
        const response = await fetchWithRetry('/api/gemini', {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`API Error: ${response.status} - ${errText}`);
        }

        jsonResponse = await response.json();
      }

      if (!jsonResponse?.candidates?.length) {
        throw new Error("No response from Gemini API.");
      }

      const result = parseSmartBookingJson(jsonResponse.candidates[0].content.parts[0].text);
      const directResolvedStudio = availableStudios.find((studio) => sameStudioId(studio.id, result?.studioId));
      if (!directResolvedStudio) throw new Error(SMART_BOOKING_BLOCKED_MESSAGE);

      const parsedStartTime = String(result?.startTime || "").trim();
      const parsedEndTime = String(result?.endTime || "").trim();
      const inferredNightBooking = (
        (parsedStartTime && parsedStartTime >= NIGHT_START_TIME)
        || (parsedEndTime && parsedEndTime <= NIGHT_END_TIME)
        || (parsedStartTime && parsedEndTime && parsedEndTime <= parsedStartTime)
      );
      const directSelectedDate = result?.date || today;
      const directSelectedStartTime = inferredNightBooking
        ? NIGHT_START_TIME
        : getClosestTimeOption(result?.startTime, DAY_BOOKING_HOURS, "09:00");
      const directSelectedEndTime = inferredNightBooking
        ? NIGHT_END_TIME
        : getClosestTimeOption(result?.endTime, DAY_HOURS, "12:00");
      const didSave = await persistStudentBooking({
        studioId: directResolvedStudio.id,
        date: directSelectedDate,
        startTime: directSelectedStartTime,
        endTime: directSelectedEndTime,
        notes: promptText,
        isNight: inferredNightBooking,
        blockedMessage: SMART_BOOKING_BLOCKED_MESSAGE,
      });
      if (!didSave) return;
      closeSmartBookingModal();
    } catch (err) {
      console.error("Smart Booking Error:", err);
      showToast("error", err?.message || "לא הצלחנו לפענח את הבקשה. אנא נסה לנסח שוב.");
    } finally {
      setIsAiLoading(false);
    }
  };
  const openSmartBookingFromCalendar = () => {
    const defaultStudio = studios.find((studio) => !isStudioDisabled(studio.id) && hasStudioCert(studio.id));
    if (!defaultStudio) {
      showToast("error", SMART_BOOKING_BLOCKED_MESSAGE);
      return;
    }
    setModal(null);
    setShowAiAssistant(true);
    setSmartBookingPrompt("");
  };
  const renderAddBookingModal = () => (
    modal?.type==="addBooking" ? (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&closeBookingModal()}>
        <div style={{width:"100%",maxWidth:400,background:"var(--surface)",borderRadius:16,border:`1px solid ${modal.isNight ? NIGHT_COLOR : "var(--border)"}`,direction:"rtl"}}>
          <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",fontWeight:900,fontSize:16,color:modal.isNight?NIGHT_COLOR:undefined}}>
            {modal.isNight ? "🌙 הזמנת לילה" : "📅 הזמנת חדר"}
          </div>
          <form onSubmit={submitBooking} style={{padding:20,display:"flex",flexDirection:"column",gap:12}}>
            <div style={{fontSize:13,color:"var(--text3)"}}>👤 {student.name} · {(modal.selectedDate || modal.date) ? `${getHebrewDayName(modal.selectedDate || modal.date)} ` : ""}{modal.selectedDate || modal.date}</div>
            <div style={{fontSize:12,color:"var(--text3)"}}>
              🎙️ {(studios.find((studio) => sameStudioId(studio.id, modal.selectedStudioId || modal.studioId))?.name) || "בחר חדר"}
            </div>
            <div style={{display:"flex",gap:8}}>
              <label style={{flex:1,fontSize:13,fontWeight:600}}>חדר
                <select
                  name="studioId"
                  className="form-input"
                  value={modal.selectedStudioId || modal.studioId || ""}
                  onChange={(e) => updateAddBookingModal({ selectedStudioId: e.target.value, studioId: e.target.value })}
                >
                  <option value="">-- בחר חדר --</option>
                  {studios.map((studio) => (
                    <option key={studio.id} value={studio.id} disabled={isStudioDisabled(studio.id)}>
                      {studio.name}{isStudioDisabled(studio.id) ? " (בתחזוקה)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{flex:1,fontSize:13,fontWeight:600}}>תאריך
                <input
                  type="date"
                  name="date"
                  className="form-input"
                  min={todayStr}
                  value={modal.selectedDate || modal.date || ""}
                  onChange={(e) => updateAddBookingModal({ selectedDate: e.target.value, date: e.target.value })}
                />
              </label>
            </div>
            <div style={{display:"flex",gap:8}}>
              <label style={{flex:1,fontSize:13,fontWeight:600}}>התחלה
                {modal.isNight ? (
                  <div className="form-input" style={{display:"flex",alignItems:"center",minHeight:42,color:NIGHT_COLOR,fontWeight:700}}>
                    {NIGHT_BOOKING_LABEL}
                  </div>
                ) : (
                  <select
                    name="startTime"
                    className="form-input"
                    value={modal.selectedStartTime || modal.defaultStart || "09:00"}
                    onChange={(e) => updateAddBookingModal({ selectedStartTime: e.target.value, defaultStart: e.target.value })}
                  >
                    {DAY_BOOKING_HOURS.map(h=><option key={h}>{h}</option>)}
                  </select>
                )}
              </label>
              <label style={{flex:1,fontSize:13,fontWeight:600}}>סיום
                {modal.isNight ? (
                  <div className="form-input" style={{display:"flex",alignItems:"center",minHeight:42,color:NIGHT_COLOR,fontWeight:700}}>
                    קביעת לילה כללית
                  </div>
                ) : (
                  <select
                    name="endTime"
                    className="form-input"
                    value={modal.selectedEndTime || modal.defaultEnd || "12:00"}
                    onChange={(e) => updateAddBookingModal({ selectedEndTime: e.target.value, defaultEnd: e.target.value })}
                  >
                    {DAY_HOURS.map(h=><option key={h}>{h}</option>)}
                  </select>
                )}
              </label>
            </div>
            <label style={{fontSize:13,fontWeight:600}}>הערות
              <textarea
                name="notes"
                className="form-input"
                rows={2}
                placeholder="תיאור הפרויקט..."
                value={modal.notes || ""}
                onChange={(e) => updateAddBookingModal({ notes: e.target.value })}
              />
            </label>
            <div style={{display:"flex",gap:8}}>
              <button type="button" className="btn btn-secondary" onClick={closeBookingModal}>ביטול</button>
              <button type="submit" className="btn btn-primary" disabled={saving || isAiLoading} style={modal.isNight?{background:NIGHT_COLOR,borderColor:NIGHT_COLOR}:{}}>{saving?"שומר...":"✅ שלח בקשה"}</button>
            </div>
            <div style={{fontSize:11,color:"var(--green)"}}>✅ {modal.isNight ? "הזמנת הלילה נשמרת אוטומטית בלוח" : "החדר נשמר אוטומטית בלוח"}</div>
          </form>
        </div>
      </div>
    ) : null
  );

  const submitBooking = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const fd = new FormData(e.target);
      const studioId = String(fd.get("studioId") || modal?.selectedStudioId || modal?.studioId || "").trim();
      const date = String(fd.get("date") || modal?.selectedDate || modal?.date || "").trim();
      const notes = fd.get("notes")?.trim();
      const isNight = modal.isNight || false;
      const startTime = isNight ? NIGHT_START_TIME : String(fd.get("startTime") || modal?.selectedStartTime || "").trim();
      const endTime = isNight ? NIGHT_END_TIME : String(fd.get("endTime") || modal?.selectedEndTime || "").trim();
      const didSave = await persistStudentBooking({ studioId, date, startTime, endTime, notes, isNight });
      if (didSave) closeBookingModal();
    } catch(err) {
      console.error("submitBooking error", err);
      showToast("error", "אירעה שגיאה. נסה שוב.");
    } finally {
      setSaving(false);
    }
  };

  const submitEditBooking = async (e) => {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.target);
    const notes = fd.get("notes")?.trim();
    const { bookingId, studioId, date, isNight } = modal;
    const startTime = isNight ? NIGHT_START_TIME : String(fd.get("startTime") || modal?.defaultStart || "").trim();
    const endTime = isNight ? NIGHT_END_TIME : String(fd.get("endTime") || modal?.defaultEnd || "").trim();
    const validationError = getStudioBookingValidationError({ studioId, date, startTime, endTime, isNight, excludeBookingId: bookingId });
    if (validationError) { showToast("error", validationError); setSaving(false); return; }
    if (isStudioDisabled(studioId)) { showToast("error", STUDIO_MAINTENANCE_MESSAGE); setSaving(false); return; }
    if(!isNight && startTime >= endTime) { showToast("error","שעת סיום חייבת להיות אחרי שעת התחלה"); setSaving(false); return; }
    const overlap = bookings.some(b => sameStudioId(b.studioId, studioId) && b.date===date && b.id!==bookingId && isActiveStudioBooking(b) && !(endTime<=b.startTime || startTime>=b.endTime));
    if(!isNight && overlap) { showToast("error","⚠️ קיימת הזמנה חופפת"); setSaving(false); return; }
    const updated = bookings.map(b => b.id===bookingId ? {...b, startTime, endTime, notes: notes || b.notes} : b);
    setBookings(updated);
    await storageSet("studio_bookings", updated);
    showToast("success","✅ ההזמנה עודכנה בהצלחה");
    setModal(null); setSaving(false);
  };

  const cancelBooking = async (bookingId) => {
    if(!confirm("לבטל את ההזמנה שלך?")) return;
    const updated = bookings.filter(b=>b.id!==bookingId);
    setBookings(updated);
    await storageSet("studio_bookings", updated);
    showToast("success","❌ ההזמנה בוטלה");
  };

  // ── Mini calendar helper (must be before early return to respect Rules of Hooks) ──
  const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  const HE_DAYS_SHORT = ["א׳","ב׳","ג׳","ד׳","ה׳","ו׳","ש׳"];
  const [miniMonth, setMiniMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });

  // Determine which month/year the current week belongs to (use middle of week — Wednesday)
  const weekMiddle = new Date();
  weekMiddle.setDate(weekMiddle.getDate() + weekOffset * 7);
  const weekMonthLabel = HE_MONTHS[weekMiddle.getMonth()] + " " + weekMiddle.getFullYear();

  // Mini calendar days grid
  const miniDays = (() => {
    const { year, month } = miniMonth;
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  })();

  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })();

  // Jump to a specific date's week
  const jumpToDate = (day) => {
    const target = new Date(miniMonth.year, miniMonth.month, day);
    const now = new Date(); now.setHours(0,0,0,0);
    const diff = Math.round((target - now) / (1000*60*60*24));
    const targetSunOffset = target.getDay();
    const nowSunOffset = now.getDay();
    const targetWeekStart = diff - targetSunOffset + nowSunOffset;
    setWeekOffset(Math.round(targetWeekStart / 7));
  };

  // Check if a mini-calendar day is in the current displayed week
  const isInCurrentWeek = (day) => {
    if (!day) return false;
    const dateStr = `${miniMonth.year}-${String(miniMonth.month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    return weekDays.some(wd => wd.fullDate === dateStr);
  };

  const isTodayMini = (day) => {
    if (!day) return false;
    const dateStr = `${miniMonth.year}-${String(miniMonth.month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    return dateStr === todayStr;
  };

  const isPastMiniDay = (day) => {
    if (!day) return false;
    const dateStr = `${miniMonth.year}-${String(miniMonth.month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    return dateStr < todayStr;
  };

  // ── Day drill-down view ──
  if (dayView) {
    const studio = studios.find(s=>sameStudioId(s.id, dayView.studioId));
    const dayBookings = bookings.filter(b=>sameStudioId(b.studioId, dayView.studioId) && b.date===dayView.date && isActiveStudioBooking(b))
      .sort((a,b)=>(a.startTime||"").localeCompare(b.startTime||""));
    const isDayPast = dayView.date < todayStr;
    const nowHour = new Date().getHours();
    // Night bookings from this day
    const nightBookings = dayBookings.filter(b=>b.isNight);
    const maintenanceBlocked = isStudioDisabled(dayView.studioId);
    const dayBlocked = maintenanceBlocked || !hasStudioCert(dayView.studioId);
    const dayCertName = getStudioCertName(dayView.studioId);
    return (
      <div style={{padding:"20px 16px",direction:"rtl",maxWidth:500,margin:"0 auto"}}>
        <button className="btn btn-secondary btn-sm" onClick={()=>{ setModal(null); setDayView(null); }} style={{marginBottom:12}}>← חזור ללוח</button>
        <div style={{fontWeight:900,fontSize:18,marginBottom:4,display:"flex",alignItems:"center",gap:8}}>
          {studio?.image?.startsWith("http")
            ? <img src={studio.image} alt={studio.name} style={{width:32,height:32,borderRadius:6,objectFit:"cover"}}/>
            : <span>{studio?.image||"🎙️"}</span>
          }
          {studio?.name}
        </div>
        <div style={{fontSize:14,color:"var(--text3)",marginBottom:16}}>{dayView.dayName} · {dayView.date}</div>
        {maintenanceBlocked && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid var(--red)",borderRadius:8,padding:"12px 16px",fontSize:14,color:"var(--red)",marginBottom:12,textAlign:"center",fontWeight:700}}>🔧 {STUDIO_MAINTENANCE_MESSAGE}</div>}
        {!maintenanceBlocked && dayBlocked && <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid var(--red)",borderRadius:8,padding:"12px 16px",fontSize:14,color:"var(--red)",marginBottom:12,textAlign:"center",fontWeight:700}}>⛔ טרם עבר הסמכה{dayCertName ? ` — ${dayCertName}` : ""}<br/><span style={{fontSize:12,fontWeight:500}}>לא ניתן לקבוע חדר זה. יש לפנות לאיש צוות.</span></div>}
        {isDayPast && !dayBlocked && <div style={{background:"rgba(255,80,80,0.1)",border:"1px solid var(--red)",borderRadius:8,padding:"8px 12px",fontSize:13,color:"var(--red)",marginBottom:12,textAlign:"center"}}>⛔ לא ניתן להזמין תאריכים שעברו</div>}

        {/* Day hours (09:00-21:30) */}
        <div style={{fontWeight:800,fontSize:13,marginBottom:6,color:"var(--accent)"}}>☀️ שעות יום (09:00–21:30)</div>
        <div style={{display:"flex",flexDirection:"column",gap:2,marginBottom:16}}>
          {DAY_BOOKING_HOURS.filter(h => h.endsWith(":00") || h === "21:00").map((hour,i,arr)=>{
            const nextH = arr[i+1] || NIGHT_START_TIME;
            const booking = dayBookings.find(b=>!b.isNight && b.startTime<=hour && b.endTime>hour);
            const isHourPast = isDayPast || (dayView.date===todayStr && parseInt(hour)<nowHour);
            return (
              <div key={hour} style={{display:"flex",alignItems:"stretch",minHeight:44,border:"1px solid var(--border)",borderRadius:6,overflow:"hidden",opacity:isHourPast?0.5:1}}>
                <div style={{width:55,padding:"6px",background:"var(--surface2)",fontWeight:700,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>{hour}</div>
                {booking
                  ? <div style={{flex:1,background:getBookingColor(booking)+"22",padding:"6px 10px",display:"flex",alignItems:"center",gap:8,borderRight:`3px solid ${getBookingColor(booking)}`,justifyContent:"space-between"}}>
                      <div style={{display:"flex",flexDirection:"column",gap:2}}>
                        <span style={{fontWeight:700,fontSize:13}}>{getBookingTitle(booking)}</span>
                        {getBookingSubtitle(booking) && <span style={{fontSize:11,color:"var(--text3)"}}>{getBookingSubtitle(booking)}</span>}
                        <span style={{fontSize:11,color:"var(--text3)"}}>{booking.startTime}–{booking.endTime}</span>
                        {getBookingKind(booking)==="student" && (booking.studentEmail||booking.studentPhone) && (
                          <span style={{fontSize:12,color:"var(--accent)",fontWeight:600}}>
                            {booking.studentEmail && <>{booking.studentEmail}</>}
                            {booking.studentEmail && booking.studentPhone && " · "}
                            {booking.studentPhone && <>{booking.studentPhone}</>}
                          </span>
                        )}
                      </div>
                      {getBookingKind(booking)==="student" && isBookingOwnedByStudent(booking) && !isHourPast && (
                        <div style={{display:"flex",gap:4,flexShrink:0}}>
                          <button onClick={()=>setModal({type:"editBooking",bookingId:booking.id,studioId:dayView.studioId,date:dayView.date,dayName:dayView.dayName,isNight:false,defaultStart:booking.startTime,defaultEnd:booking.endTime,notes:booking.notes})} style={{background:"var(--accent)",color:"#000",border:"none",borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                            ✏️ ערוך
                          </button>
                          <button onClick={()=>cancelBooking(booking.id)} style={{background:"var(--red)",color:"#fff",border:"none",borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                            ❌ בטל
                          </button>
                        </div>
                      )}
                    </div>
                  : <div style={{flex:1,padding:"6px 10px",cursor:(isHourPast||dayBlocked)?"default":"pointer",display:"flex",alignItems:"center",color:dayBlocked?"var(--red)":"var(--text3)",fontSize:12}}
                        onClick={()=>{ if(!isHourPast && !dayBlocked) openAddBookingModal({studioId:dayView.studioId,date:dayView.date,dayName:dayView.dayName,defaultStart:hour,defaultEnd:nextH}); }}>
                      {dayBlocked ? "🔒" : isHourPast ? "" : "+ לחץ להזמנה"}
                    </div>
                }
              </div>
            );
          })}
        </div>

        {/* Night booking */}
        <div style={{fontWeight:800,fontSize:13,marginBottom:6,color:NIGHT_COLOR,display:"flex",alignItems:"center",gap:6}}>
          🌙 קביעת לילה ({NIGHT_BOOKING_LABEL})
          {!hasNightCert && <span style={{fontSize:11,fontWeight:500,color:"var(--text3)"}}>— טרם עבר/ה הסמכת לילה</span>}
        </div>
        {hasNightCert && !dayBlocked ? (
          <div style={{display:"flex",flexDirection:"column",gap:2}}>
            {nightBookings.length > 0 ? (
              nightBookings.map(b=>(
                <div key={b.id} style={{display:"flex",alignItems:"center",minHeight:44,border:`1px solid ${NIGHT_COLOR}`,borderRadius:6,overflow:"hidden",background:NIGHT_COLOR+"15"}}>
                  <div style={{width:55,padding:"6px",background:NIGHT_COLOR+"22",fontWeight:700,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",color:NIGHT_COLOR}}>🌙</div>
                  <div style={{flex:1,padding:"6px 10px",display:"flex",alignItems:"center",gap:8,justifyContent:"space-between"}}>
                    <div style={{display:"flex",flexDirection:"column",gap:2}}>
                      <span style={{fontWeight:700,fontSize:13}}>{getBookingTitle(b)}</span>
                      {getBookingSubtitle(b) && <span style={{fontSize:11,color:"var(--text3)"}}>{getBookingSubtitle(b)}</span>}
                      <span style={{fontSize:11,color:"var(--text3)"}}>{getStudioBookingTimeLabel(b)}</span>
                      {getBookingKind(b)==="student" && (b.studentEmail||b.studentPhone) && (
                        <span style={{fontSize:12,color:"var(--accent)",fontWeight:600}}>
                          {b.studentEmail}{b.studentEmail && b.studentPhone && " · "}{b.studentPhone}
                        </span>
                      )}
                    </div>
                    {getBookingKind(b)==="student" && isBookingOwnedByStudent(b) && !isDayPast && (
                      <div style={{display:"flex",gap:4,flexShrink:0}}>
                        <button onClick={()=>setModal({type:"editBooking",bookingId:b.id,studioId:dayView.studioId,date:dayView.date,dayName:dayView.dayName,isNight:true,defaultStart:b.startTime,defaultEnd:b.endTime,notes:b.notes})} style={{background:NIGHT_COLOR,color:"#fff",border:"none",borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                          ✏️ ערוך
                        </button>
                        <button onClick={()=>cancelBooking(b.id)} style={{background:"var(--red)",color:"#fff",border:"none",borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                          ❌ בטל
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              !isDayPast && (
                <div style={{border:`1px dashed ${NIGHT_COLOR}`,borderRadius:6,padding:"12px 16px",textAlign:"center",cursor:"pointer",color:NIGHT_COLOR,fontSize:13}}
                  onClick={()=>openAddBookingModal({studioId:dayView.studioId,date:dayView.date,dayName:dayView.dayName,isNight:true,defaultStart:NIGHT_START_TIME,defaultEnd:NIGHT_END_TIME})}>
                  + לחץ להזמנת לילה
                </div>
              )
            )}
          </div>
        ) : (
          <div style={{border:`1px solid ${NIGHT_COLOR}33`,borderRadius:6,padding:"12px 16px",textAlign:"center",color:"var(--text3)",fontSize:12,background:NIGHT_COLOR+"08"}}>
            🔒 טרם עבר/ה הסמכת לילה לאולפנים — יש לפנות לאיש צוות
          </div>
        )}

        {renderAddBookingModal()}

        {/* Edit booking modal */}
        {modal?.type==="editBooking" && (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&setModal(null)}>
            <div style={{width:"100%",maxWidth:400,background:"var(--surface)",borderRadius:16,border:`1px solid ${modal.isNight ? NIGHT_COLOR : "var(--accent)"}`,direction:"rtl"}}>
              <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",fontWeight:900,fontSize:16,color:modal.isNight?NIGHT_COLOR:"var(--accent)"}}>
                ✏️ עריכת הזמנה
              </div>
              <form onSubmit={submitEditBooking} style={{padding:20,display:"flex",flexDirection:"column",gap:12}}>
                <div style={{fontSize:13,color:"var(--text3)"}}>👤 {student.name} · {modal.date}</div>
                <div style={{display:"flex",gap:8}}>
                  <label style={{flex:1,fontSize:13,fontWeight:600}}>התחלה
                    {modal.isNight ? (
                      <div className="form-input" style={{display:"flex",alignItems:"center",minHeight:42,color:NIGHT_COLOR,fontWeight:700}}>
                        {NIGHT_BOOKING_LABEL}
                      </div>
                    ) : (
                      <select name="startTime" className="form-input" defaultValue={modal.defaultStart}>
                        {DAY_BOOKING_HOURS.map(h=><option key={h}>{h}</option>)}
                      </select>
                    )}
                  </label>
                  <label style={{flex:1,fontSize:13,fontWeight:600}}>סיום
                    {modal.isNight ? (
                      <div className="form-input" style={{display:"flex",alignItems:"center",minHeight:42,color:NIGHT_COLOR,fontWeight:700}}>
                        קביעת לילה כללית
                      </div>
                    ) : (
                      <select name="endTime" className="form-input" defaultValue={modal.defaultEnd}>
                        {DAY_HOURS.map(h=><option key={h}>{h}</option>)}
                      </select>
                    )}
                  </label>
                </div>
                <label style={{fontSize:13,fontWeight:600}}>הערות
                  <textarea name="notes" className="form-input" rows={2} defaultValue={modal.notes||""} placeholder="תיאור הפרויקט..."/>
                </label>
                <div style={{display:"flex",gap:8}}>
                  <button type="button" className="btn btn-secondary" onClick={()=>setModal(null)}>ביטול</button>
                  <button type="submit" className="btn btn-primary" disabled={saving} style={modal.isNight?{background:NIGHT_COLOR,borderColor:NIGHT_COLOR}:{}}>{saving?"שומר...":"💾 שמור שינויים"}</button>
                </div>
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
      {/* ── Month/year header ── */}
      <div style={{textAlign:"center",marginBottom:16}}>
        <div style={{fontSize:22,fontWeight:900,color:"var(--accent)"}}>{weekMonthLabel}</div>
      </div>

      {/* ── Layout: mini calendar + week nav ── */}
      <div style={{display:"flex",gap:20,marginBottom:20,flexWrap:"wrap",justifyContent:"center"}}>
        {/* Mini calendar */}
        <div style={{minWidth:220,maxWidth:260,background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",padding:12}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <button onClick={()=>setMiniMonth(m=>{ const prev = m.month===0 ? {year:m.year-1,month:11} : {year:m.year,month:m.month-1}; return prev; })}
              style={{background:"none",border:"none",color:"var(--text2)",cursor:"pointer",fontSize:16,padding:"2px 6px"}}>→</button>
            <span style={{fontWeight:800,fontSize:14,color:"var(--text)"}}>{HE_MONTHS[miniMonth.month]} {miniMonth.year}</span>
            <button onClick={()=>setMiniMonth(m=>{ const next = m.month===11 ? {year:m.year+1,month:0} : {year:m.year,month:m.month+1}; return next; })}
              style={{background:"none",border:"none",color:"var(--text2)",cursor:"pointer",fontSize:16,padding:"2px 6px"}}>←</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:1,textAlign:"center"}}>
            {HE_DAYS_SHORT.map(d=><div key={d} style={{fontSize:10,fontWeight:700,color:"var(--text3)",padding:"4px 0"}}>{d}</div>)}
            {miniDays.map((day,i)=>{
              const past = isPastMiniDay(day);
              return (
                <div key={i}
                  onClick={()=>{ if(day && !past) jumpToDate(day); }}
                  style={{
                    fontSize:12,fontWeight:isInCurrentWeek(day)?800:500,padding:"5px 0",
                    cursor: past ? "default" : day ? "pointer" : "default",
                    borderRadius:"50%",
                    opacity: past ? 0.35 : 1,
                    background: isTodayMini(day) ? "var(--accent)" : isInCurrentWeek(day) ? "rgba(245,166,35,0.15)" : "transparent",
                    color: isTodayMini(day) ? "#000" : isInCurrentWeek(day) ? "var(--accent)" : day ? "var(--text)" : "transparent",
                    transition:"background 0.15s"
                  }}>
                  {day || ""}
                </div>
              );
            })}
          </div>
          <button onClick={()=>{ setWeekOffset(0); const d=new Date(); setMiniMonth({year:d.getFullYear(),month:d.getMonth()}); }}
            style={{width:"100%",marginTop:8,padding:"6px 0",borderRadius:6,border:"1px solid var(--accent)",background:"transparent",color:"var(--accent)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
            📅 היום
          </button>
        </div>

        {/* Week navigation */}
        <div style={{flex:1,minWidth:280,display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",justifyContent:"center",marginTop:2}}>
            <div style={{background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",padding:"12px 14px",display:"flex",flexDirection:"column",gap:4,minWidth:220,textAlign:"center"}}>
              <div style={{fontWeight:800,fontSize:14,color:"var(--text)"}}>בנק שעות עתידיות</div>
              <div style={{fontSize:22,fontWeight:900,color:"var(--accent)"}}>{formatStudioHoursValue(remainingFutureHours)}</div>
              <div style={{fontSize:12,color:"var(--text3)"}}>מתוך {formatStudioHoursValue(studioFutureHoursLimit)} שעות זמינות</div>
              <div style={{fontSize:11,color:"var(--text3)"}}>רק שעות עתידיות שעדיין לא הסתיימו נספרות בבנק.</div>
            </div>
          </div>
          <div style={{display:"flex",justifyContent:"center",marginTop:6}}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={openSmartBookingFromCalendar}
              style={{display:"inline-flex",alignItems:"center",gap:6}}
            >
              ✨ קביעת חדר חכמה
            </button>
          </div>
        </div>
      </div>

      {showAiAssistant && (
        <div
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3200,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
          onClick={(e)=>e.target===e.currentTarget&&closeSmartBookingModal()}
        >
          <div style={{width:"100%",maxWidth:560,background:"var(--surface)",borderRadius:18,border:"1px solid var(--border)",direction:"rtl",boxShadow:"0 30px 80px rgba(0,0,0,0.35)"}}>
            <div style={{padding:"18px 22px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
              <div>
                <div style={{fontWeight:900,fontSize:18,color:"var(--accent)"}}>✨ קביעת חדר חכמה</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:4}}>כתבו את הבקשה בשפה חופשית והמערכת תנסה לקבוע את החדר ישירות בלוח הכללי.</div>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={closeSmartBookingModal} disabled={isAiLoading}>סגור</button>
            </div>
            <form
              onSubmit={(e)=>{
                e.preventDefault();
                handleSmartBooking(smartBookingPrompt.trim(), studios);
              }}
              style={{padding:22,display:"flex",flexDirection:"column",gap:14}}
            >
              <label style={{display:"flex",flexDirection:"column",gap:8,fontWeight:700,color:"var(--text2)"}}>
                מה תרצו לקבוע?
                <textarea
                  className="form-input"
                  rows={5}
                  value={smartBookingPrompt}
                  onChange={(e)=>setSmartBookingPrompt(e.target.value)}
                  placeholder='למשל: אני צריך חדר עריכה מחר מ-12:00 עד 16:00'
                  style={{resize:"vertical",minHeight:140}}
                />
              </label>
              <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.6}}>
                החדר ייקבע אוטומטית רק אם הבקשה תואמת להסמכות הפעילות שלך ולחסימות הקיימות בלוח החדרים.
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                {isAiLoading && <span style={{fontSize:12,color:"var(--accent)",fontWeight:700}}>מעבד בקשה...</span>}
                <div style={{display:"flex",gap:8,marginInlineStart:"auto"}}>
                  <button type="button" className="btn btn-secondary" onClick={closeSmartBookingModal} disabled={isAiLoading}>ביטול</button>
                  <button type="submit" className="btn btn-primary" disabled={isAiLoading || !smartBookingPrompt.trim()}>
                    {isAiLoading ? "קובע..." : "קבע לי"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {studios.length===0 ? (
        <div style={{textAlign:"center",padding:48,color:"var(--text3)"}}>
          <div style={{fontSize:48,marginBottom:12}}>🎙️</div>
          <div style={{fontWeight:700}}>אין אולפנים זמינים כרגע</div>
        </div>
      ) : (
        <>
          {calendarFullscreen && <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:8999}} onClick={()=>setCalendarFullscreen(false)}/>}
          <div style={calendarFullscreen ? {position:"fixed",inset:8,zIndex:9000,background:"var(--bg)",borderRadius:16,border:"1px solid var(--border)",display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 20px 60px rgba(0,0,0,0.6)"} : {}}>
          <div style={{padding:"6px 12px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:calendarFullscreen?"16px 16px 0 0":"8px 8px 0 0",display:"flex",justifyContent:"center",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <button className="btn btn-secondary btn-sm" onClick={()=>setWeekOffset(w=>w-1)} disabled={weekOffset<=0} style={{opacity:weekOffset<=0?0.4:1,cursor:weekOffset<=0?"default":"pointer"}}>→ שבוע קודם</button>
              <button className="btn btn-secondary btn-sm" onClick={()=>setWeekOffset(0)}>היום</button>
              <button className="btn btn-secondary btn-sm" onClick={()=>setWeekOffset(w=>w+1)}>← שבוע הבא</button>
              <span style={{fontSize:12,color:"var(--text3)"}}>
                {weekDays[0].date}/{String(new Date(weekDays[0].fullDate).getMonth()+1).padStart(2,"0")} — {weekDays[6].date}/{String(new Date(weekDays[6].fullDate).getMonth()+1).padStart(2,"0")}
              </span>
              <button className="btn btn-secondary btn-sm" onClick={()=>setCalendarFullscreen(f=>!f)} title={calendarFullscreen?"סגור מסך מלא":"פתח מסך מלא"} style={{marginInlineStart:"auto"}}>
                {calendarFullscreen ? "✕ סגור" : "⛶ מסך מלא"}
              </button>
          </div>
          <div data-no-swipe="true" style={{overflowX:"auto",overflowY:calendarFullscreen?"auto":undefined,WebkitOverflowScrolling:"touch",flex:calendarFullscreen?1:undefined,maxHeight:calendarFullscreen?"calc(100vh - 120px)":undefined}}>
          <table style={{width:"100%",minWidth:700,borderCollapse:"separate",borderSpacing:0,tableLayout:"fixed"}}>
            <thead>
              <tr>
                <th style={{padding:"8px 6px",background:"var(--surface2)",fontSize:12,fontWeight:700,textAlign:"center",border:"1px solid var(--border)",width:80,position:"sticky",top:calendarFullscreen?0:undefined,right:0,zIndex:calendarFullscreen?5:3,boxShadow:"-2px 0 6px rgba(0,0,0,0.18)"}}>חדר</th>
                {weekDays.map(d=>(
                  <th key={d.fullDate} style={{padding:"8px 6px",background:d.isToday?"var(--accent)":"var(--surface2)",color:d.isToday?"#000":undefined,fontSize:12,fontWeight:700,textAlign:"center",border:"1px solid var(--border)",position:calendarFullscreen?"sticky":undefined,top:0,zIndex:3}}>
                    <div>{d.name}</div><div style={{fontSize:11,color:d.isToday?"#000":"var(--text3)"}}>{d.date}/{String(new Date(d.fullDate).getMonth()+1).padStart(2,"0")}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {studios.map(studio=>{
                const maintenanceBlocked = isStudioDisabled(studio.id);
                const blocked = maintenanceBlocked || !hasStudioCert(studio.id);
                const certName = getStudioCertName(studio.id);
                return (
                <tr key={studio.id} style={{opacity:blocked?0.5:1}}>
                  <td style={{padding:"6px 4px",border:"1px solid var(--border)",background:blocked?"rgba(231,76,60,0.08)":"var(--surface2)",verticalAlign:"middle",position:"sticky",right:0,zIndex:2,boxShadow:"-2px 0 6px rgba(0,0,0,0.18)",cursor:"pointer"}}
                    onClick={()=>setStudioInfoPanel(studio)}>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                      {studio.image?.startsWith("data:") || studio.image?.startsWith("http")
                        ? <img src={studio.image} alt={studio.name} style={{width:32,height:32,borderRadius:6,objectFit:"cover"}}/>
                        : <span style={{fontSize:18,lineHeight:1}}>{studio.image||"🎙️"}</span>
                      }
                      <span style={{fontSize:10,fontWeight:800,lineHeight:1.2,wordBreak:"break-word",textAlign:"center"}}>{studio.name}</span>
                      {studio.isClassroom && <div style={{fontSize:9,color:"#3498db",fontWeight:800}}>🏫 כיתה</div>}
                      {maintenanceBlocked && <div style={{fontSize:9,color:"var(--red)",fontWeight:800}}>🔧 בתחזוקה</div>}
                      {!maintenanceBlocked && blocked && <div style={{fontSize:9,color:"var(--red)",fontWeight:800}}>⛔ חסר הסמכה</div>}
                      <div style={{fontSize:9,color:"var(--accent)",fontWeight:700,marginTop:1}}>ℹ️</div>
                    </div>
                  </td>
                  {weekDays.map(day=>{
                    const cells = bookings.filter(b=>sameStudioId(b.studioId, studio.id) && b.date===day.fullDate && isActiveStudioBooking(b)).sort((a,b)=>(a.startTime||"").localeCompare(b.startTime||""));
                    const isPast = day.fullDate < todayStr;
                    return (
                      <td key={day.fullDate}
                        style={{
                          padding:"4px 6px",border:"1px solid var(--border)",verticalAlign:"top",
                          cursor: blocked ? "not-allowed" : isPast ? "not-allowed" : "pointer",
                          background: blocked ? "rgba(231,76,60,0.04)" : isPast ? "rgba(0,0,0,0.12)" : day.isToday ? "rgba(245,166,35,0.05)" : "transparent",
                          opacity: isPast ? 0.55 : 1
                        }}
                        onClick={()=>{ if(!blocked && !isPast){ setModal(null); setDayView({studioId:studio.id,date:day.fullDate,dayName:day.name}); } }}>
                        {maintenanceBlocked && !isPast && <div style={{color:"var(--red)",fontSize:9,textAlign:"center",paddingTop:8,fontWeight:700,lineHeight:1.5}}>{STUDIO_MAINTENANCE_MESSAGE}</div>}
                        {!maintenanceBlocked && blocked && !isPast && <div style={{color:"var(--red)",fontSize:9,textAlign:"center",paddingTop:8,fontWeight:700}}>🔒</div>}
                        {!blocked && cells.map(b=>{
                          const color = getBookingColor(b);
                          return (
                            <div key={b.id} style={{background:color+"22",border:`1.5px solid ${color}`,borderRadius:4,padding:"4px 6px",marginBottom:3,fontSize:11,wordBreak:"break-word",whiteSpace:"normal",textAlign:"right"}}>
                              <div style={{fontWeight:900,color,fontSize:11}}>{b.isNight?"🌙 ":""}{getStudioBookingTimeLabel(b)}</div>
                              <div style={{color:"var(--text)",fontWeight:800,fontSize:11,lineHeight:1.35}}>{getBookingTitle(b)}</div>
                              {getBookingSubtitle(b) && <div style={{color:"var(--text2)",fontSize:10,fontWeight:600,lineHeight:1.3,marginTop:1}}>{getBookingSubtitle(b)}</div>}
                            </div>
                          );
                        })}
                        {!blocked && cells.length===0 && !isPast && <div style={{color:"var(--text3)",fontSize:10,textAlign:"center",paddingTop:8}}>פנוי</div>}
                        {isPast && !blocked && cells.length===0 && <div style={{color:"var(--text3)",fontSize:10,textAlign:"center",paddingTop:8}}>—</div>}
                      </td>
                    );
                  })}
                </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          </div>
        </>
      )}
      {studioInfoPanel && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:10000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}}
          onClick={e=>e.target===e.currentTarget&&setStudioInfoPanel(null)}>
          <div style={{width:"100%",maxWidth:400,background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",direction:"rtl",overflow:"hidden"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 18px",borderBottom:"1px solid var(--border)",background:"var(--surface2)"}}>
              <div style={{fontWeight:900,fontSize:16}}>{studioInfoPanel.name}</div>
              <button className="btn btn-secondary btn-sm" onClick={()=>setStudioInfoPanel(null)}>✕</button>
            </div>
            <div style={{padding:"20px",display:"flex",flexDirection:"column",alignItems:"center",gap:16}}>
              {studioInfoPanel.image?.startsWith("http") || studioInfoPanel.image?.startsWith("data:")
                ? <img src={studioInfoPanel.image} alt={studioInfoPanel.name} style={{width:"100%",maxHeight:220,objectFit:"cover",borderRadius:10}}/>
                : <div style={{fontSize:72,lineHeight:1}}>{studioInfoPanel.image||"🎙️"}</div>
              }
              {studioInfoPanel.description
                ? <p style={{fontSize:14,color:"var(--text)",lineHeight:1.7,textAlign:"right",margin:0,whiteSpace:"pre-wrap"}}>{studioInfoPanel.description}</p>
                : <p style={{fontSize:13,color:"var(--text3)",margin:0}}>אין תיאור לחדר זה.</p>
              }
            </div>
          </div>
        </div>
      )}
      {renderAddBookingModal()}
      {/* Night policies modal — always shown for night bookings */}
      {nightPolicyPending && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:"var(--surface, #1a1a2e)",borderRadius:12,maxWidth:500,width:"100%",maxHeight:"80vh",display:"flex",flexDirection:"column",border:"1px solid var(--border)",boxShadow:"0 8px 32px rgba(0,0,0,0.5)"}}>
            <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",fontWeight:800,fontSize:15,textAlign:"center",color:"#f5a623"}}>🌙 נהלי קביעת חדר לילה</div>
            {policies?.לילה ? (
              <div
                ref={el=>{ if(el && el.scrollHeight <= el.clientHeight + 30) setNightPolicyScrolled(true); }}
                style={{padding:"16px 20px",overflowY:"auto",flex:1,fontSize:13,lineHeight:1.7,whiteSpace:"pre-wrap",direction:"rtl"}}
                onScroll={e=>{
                  const el = e.target;
                  if (el.scrollHeight - el.scrollTop - el.clientHeight < 30) setNightPolicyScrolled(true);
                }}
              >
                {policies.לילה}
              </div>
            ) : (
              <div style={{padding:"16px 20px",flex:1,fontSize:13,lineHeight:1.7,direction:"rtl",color:"var(--text2)"}}>
                קביעת חדר לילה מחייבת עמידה בנהלי הלילה של המכללה.
              </div>
            )}
            <div style={{padding:"16px 20px",borderTop:"1px solid var(--border)",display:"flex",flexDirection:"column",gap:10}}>
              {policies?.לילה && !nightPolicyScrolled && <div style={{fontSize:11,color:"var(--text3)",textAlign:"center"}}>יש לגלול לתחתית הנהלים כדי להמשיך</div>}
              <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,fontWeight:600,cursor:(nightPolicyScrolled||!policies?.לילה)?"pointer":"not-allowed",opacity:(nightPolicyScrolled||!policies?.לילה)?1:0.4}}>
                <input type="checkbox" checked={nightPolicyAgreed} disabled={!!(policies?.לילה && !nightPolicyScrolled)} onChange={e=>setNightPolicyAgreed(e.target.checked)}/>
                אני מתחייב/ת לעמוד בכל נהלי קביעת חדר לילה
              </label>
              <div style={{display:"flex",gap:8,justifyContent:"center"}}>
                <button className="btn btn-secondary" onClick={()=>setNightPolicyPending(null)}>ביטול</button>
                <button
                  className="btn btn-primary"
                  disabled={!nightPolicyAgreed}
                  onClick={async()=>{
                    const args = nightPolicyPending;
                    setNightPolicyPending(null);
                    try {
                      const normalizedStartTime = args.isNight ? NIGHT_START_TIME : args.startTime;
                      const normalizedEndTime = args.isNight ? NIGHT_END_TIME : args.endTime;
                      const validationError = getStudioBookingValidationError({ studioId:args.studioId, date:args.date, startTime:normalizedStartTime, endTime:normalizedEndTime, isNight:args.isNight, blockedMessage:args.blockedMessage });
                      if (validationError) { showToast("error",validationError); return; }
                      const newBooking = { id:Date.now(), bookingKind:"student", studioId:args.studioId, date:args.date, startTime:normalizedStartTime, endTime:normalizedEndTime, studentName:student.name, studentEmail:student.email||"", studentPhone:student.phone||"", studentId:student?.id??null, notes:args.notes, isNight:args.isNight, createdAt:new Date().toISOString() };
                      const next = [...bookings, newBooking];
                      setBookings(next);
                      await storageSet("studio_bookings", next);
                      showToast("success", args.successMessage || "✅ החדר הוזמן בהצלחה!");
                      closeBookingModal();
                    } catch(err) {
                      console.error("night booking confirm error", err);
                      showToast("error","אירעה שגיאה בשמירת ההזמנה. נסה שוב.");
                    }
                  }}
                >
                  אני מאשר/ת ✅
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
