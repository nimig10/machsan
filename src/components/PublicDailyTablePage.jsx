// PublicDailyTablePage.jsx — public display of today's combined schedule as a table
import { useState, useEffect, useMemo } from "react";
import { storageGet } from "../utils.js";

const HE_DAYS   = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

const LESSON_C  = "#f5a623";
const STUDENT_C = "#2ecc71";
const NIGHT_C   = "#2196f3";
const TEAM_C    = "#9b59b6";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function dateLabel() {
  const d = new Date();
  return `יום ${HE_DAYS[d.getDay()]}, ${d.getDate()} ב${HE_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function getKind(b) {
  if (b.bookingKind === "lesson" || b.lesson_auto || (b.lesson_id != null && b.lesson_id !== "")) return "lesson";
  if (b.bookingKind === "team" || b.teamMemberId || b.teamMemberName) return "team";
  return "student";
}

export function PublicDailyTablePage() {
  const [lessons,  setLessons]  = useState([]);
  const [bookings, setBookings] = useState([]);
  const [studios,  setStudios]  = useState([]);
  const [settings, setSettings] = useState({});
  const today = todayStr();

  const loadData = async () => {
    const [lsns, bkgs, stds, st] = await Promise.all([
      storageGet("lessons"),
      storageGet("studio_bookings"),
      storageGet("studios"),
      storageGet("siteSettings"),
    ]);
    setLessons(Array.isArray(lsns)?lsns:[]);
    setBookings(Array.isArray(bkgs)?bkgs:[]);
    setStudios(Array.isArray(stds)?stds:[]);
    if (st && typeof st === "object") setSettings(st);
  };

  useEffect(() => {
    loadData();
    const refresh = setInterval(loadData, 5*60*1000);
    const reload  = setInterval(() => window.location.reload(), 30*60*1000);
    return () => { clearInterval(refresh); clearInterval(reload); };
  }, []);

  const stName = id => studios.find(s=>String(s.id)===String(id))?.name || id || "—";

  const rows = useMemo(() => {
    const out = [];
    const used = new Set();
    bookings.forEach(b => {
      if (b.date !== today || b.status === "נדחה") return;
      const kind = getKind(b);
      out.push({
        startTime: b.startTime || "",
        endTime:   b.endTime   || "",
        studioId:  b.studioId  || "",
        label: kind === "lesson" ? (b.courseName||"שיעור")
             : kind === "team"   ? (b.teamMemberName||"צוות")
             : (b.studentName || "סטודנט"),
        instructor: b.instructorName || b.teamMemberName || "",
        kind,
        isNight: !!b.isNight,
        color: kind === "lesson" ? LESSON_C
             : kind === "team"   ? TEAM_C
             : b.isNight ? NIGHT_C : STUDENT_C,
      });
      used.add(`${b.studioId}_${b.startTime}`);
    });
    lessons.forEach(lesson => {
      (lesson.schedule||[]).forEach(s => {
        if (s.date !== today) return;
        const k = `${s.studioId||lesson.studioId||""}_${s.startTime||""}`;
        if (used.has(k)) return;
        used.add(k);
        out.push({
          startTime: s.startTime || "",
          endTime:   s.endTime   || "",
          studioId:  s.studioId  || lesson.studioId || "",
          label:     lesson.courseName || lesson.name || "שיעור",
          instructor: lesson.instructorName || lesson.lecturer || "",
          kind: "lesson",
          isNight: false,
          color: LESSON_C,
        });
      });
    });
    return out.sort((a,b)=>(a.startTime||"").localeCompare(b.startTime||""));
  }, [bookings, lessons, studios, today]);

  const accent = settings.accentColor || "#f5a623";

  return (
    <div style={{minHeight:"100vh",background:"#0a0a0a",color:"#f5f5f5",direction:"rtl",fontFamily:"system-ui, -apple-system, sans-serif",padding:"24px 16px"}}>
      <div style={{maxWidth:1200,margin:"0 auto"}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12,marginBottom:24,paddingBottom:16,borderBottom:`2px solid ${accent}`}}>
          <div>
            {settings.logo && <img src={settings.logo} alt="logo" style={{height:48,marginBottom:8}}/>}
            <div style={{fontSize:28,fontWeight:900,color:accent}}>📋 לוח לו״ז יומי</div>
            <div style={{fontSize:14,color:"#aaa",marginTop:4}}>{dateLabel()}</div>
          </div>
          <div style={{fontSize:12,color:"#666"}}>מתעדכן אוטומטית כל 5 דקות</div>
        </div>

        {/* Table */}
        {rows.length === 0 ? (
          <div style={{textAlign:"center",padding:"60px 20px",color:"#666",fontSize:16}}>אין קביעות היום</div>
        ) : (
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0,fontSize:14,minWidth:600}}>
              <thead>
                <tr style={{background:"#1a1a1a"}}>
                  <th style={{width:120,padding:"14px 16px",textAlign:"right",fontWeight:800,color:"#ccc",borderBottom:`2px solid ${accent}`}}>שעה</th>
                  <th style={{width:180,padding:"14px 16px",textAlign:"right",fontWeight:800,color:"#ccc",borderBottom:`2px solid ${accent}`}}>חדר / אולפן</th>
                  <th style={{padding:"14px 16px",textAlign:"right",fontWeight:800,color:"#ccc",borderBottom:`2px solid ${accent}`}}>שם / קורס</th>
                  <th style={{width:180,padding:"14px 16px",textAlign:"right",fontWeight:800,color:"#ccc",borderBottom:`2px solid ${accent}`}}>מרצה</th>
                  <th style={{width:100,padding:"14px 16px",textAlign:"center",fontWeight:800,color:"#ccc",borderBottom:`2px solid ${accent}`}}>סוג</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r,i) => {
                  const typeLabel = r.kind==="lesson"?"שיעור":r.kind==="team"?"צוות":r.isNight?"לילה":"יום";
                  return (
                    <tr key={i} style={{background:i%2===0?"transparent":"rgba(255,255,255,0.03)"}}>
                      <td style={{padding:"14px 16px",borderBottom:"1px solid #222",fontWeight:800,color:r.color,whiteSpace:"nowrap"}}>{r.startTime&&r.endTime?`${r.startTime}–${r.endTime}`:r.startTime||"—"}</td>
                      <td style={{padding:"14px 16px",borderBottom:"1px solid #222",color:"#ddd"}}>{stName(r.studioId)}</td>
                      <td style={{padding:"14px 16px",borderBottom:"1px solid #222",fontWeight:700,color:"#fff"}}>{r.label||"—"}</td>
                      <td style={{padding:"14px 16px",borderBottom:"1px solid #222",color:"#bbb"}}>{r.instructor||"—"}</td>
                      <td style={{padding:"14px 16px",borderBottom:"1px solid #222",textAlign:"center"}}>
                        <span style={{display:"inline-block",padding:"4px 12px",borderRadius:16,fontSize:12,fontWeight:800,background:`${r.color}22`,color:r.color,border:`1px solid ${r.color}66`,whiteSpace:"nowrap"}}>{typeLabel}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend */}
        <div style={{display:"flex",gap:20,marginTop:20,fontSize:13,color:"#888",flexWrap:"wrap",justifyContent:"center"}}>
          <span><span style={{display:"inline-block",width:12,height:12,background:`${LESSON_C}33`,border:`1px solid ${LESSON_C}`,borderRadius:3,marginLeft:6,verticalAlign:"middle"}}/>שיעור</span>
          <span><span style={{display:"inline-block",width:12,height:12,background:`${STUDENT_C}33`,border:`1px solid ${STUDENT_C}`,borderRadius:3,marginLeft:6,verticalAlign:"middle"}}/>סטודנט יום</span>
          <span><span style={{display:"inline-block",width:12,height:12,background:`${NIGHT_C}33`,border:`1px solid ${NIGHT_C}`,borderRadius:3,marginLeft:6,verticalAlign:"middle"}}/>סטודנט לילה</span>
          <span><span style={{display:"inline-block",width:12,height:12,background:`${TEAM_C}33`,border:`1px solid ${TEAM_C}`,borderRadius:3,marginLeft:6,verticalAlign:"middle"}}/>צוות</span>
        </div>
      </div>
    </div>
  );
}
