// PublicDailyTablePage.jsx — public display of today's combined schedule as a table
import { useState, useEffect, useMemo } from "react";
import { storageGet } from "../utils.js";

const HE_DAYS   = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function dateLabel() {
  const d = new Date();
  return `יום ${HE_DAYS[d.getDay()]}, ${d.getDate()} ב${HE_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function getBookingKind(b) {
  if (b.bookingKind === "lesson" || b.lesson_auto || (b.lesson_id != null && b.lesson_id !== "")) return "lesson";
  if (b.bookingKind === "team"   || b.teamMemberId || b.teamMemberName) return "team";
  return "student";
}

// Inject Heebo font (once)
function injectHeeboFont() {
  if (typeof document === "undefined") return;
  if (document.getElementById("heebo-font")) return;
  const link = document.createElement("link");
  link.id = "heebo-font";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800;900&display=swap";
  document.head.appendChild(link);
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
    injectHeeboFont();
    loadData();
    const refresh = setInterval(loadData, 10*60*1000); // was 5 min
    const reload  = setInterval(() => window.location.reload(), 30*60*1000);
    return () => { clearInterval(refresh); clearInterval(reload); };
  }, []);

  const stName = id => studios.find(s=>String(s.id)===String(id))?.name || id || "—";

  // ── Lessons today ──
  const lessonRows = useMemo(() => {
    const out = [];
    // From lesson schedules
    lessons.forEach(lesson => {
      (lesson.schedule||[]).forEach(s => {
        if (s.date !== today) return;
        out.push({
          track:      lesson.track || "",
          course:     lesson.courseName || lesson.name || "",
          instructor: lesson.instructorName || lesson.lecturer || "",
          startTime:  s.startTime || "",
          endTime:    s.endTime   || "",
          studioId:   s.studioId  || lesson.studioId || "",
          topic:      s.topic     || "",
        });
      });
    });
    // From bookings marked as lesson (in case lesson session not represented in schedule)
    bookings.forEach(b => {
      if (b.date !== today || b.status === "נדחה") return;
      if (getBookingKind(b) !== "lesson") return;
      // Skip duplicates (same time/studio already in out)
      if (out.some(r => r.startTime===b.startTime && String(r.studioId)===String(b.studioId))) return;
      out.push({
        track:      b.track || "",
        course:     b.courseName || "",
        instructor: b.instructorName || "",
        startTime:  b.startTime || "",
        endTime:    b.endTime   || "",
        studioId:   b.studioId  || "",
        topic:      b.topic     || b.sessionName || "",
      });
    });
    return out.sort((a,b)=>(a.startTime||"").localeCompare(b.startTime||""));
  }, [lessons, bookings, today]);

  // ── Student/team bookings today ──
  const studentRows = useMemo(() => {
    return bookings
      .filter(b => b.date === today && b.status !== "נדחה" && getBookingKind(b) !== "lesson")
      .map(b => ({
        name:      b.studentName || b.teamMemberName || "—",
        track:     b.track || b.course || "",
        studioId:  b.studioId || "",
        startTime: b.startTime || "",
        endTime:   b.endTime   || "",
        note:      b.note || b.purpose || "",
      }))
      .sort((a,b)=>(a.startTime||"").localeCompare(b.startTime||""));
  }, [bookings, today]);

  const accent = settings.accentColor || "#f5a623";

  // vh/vw units calibrated for 1920×1080 HD TV (1vh=10.8px, 1vw=19.2px)
  const cellBase = { padding:"1vh 1.2vw", borderBottom:"1px solid #222", color:"#e8e8e8", fontSize:"1.6vh" };
  const thBase   = { padding:"0.9vh 1.2vw", textAlign:"right", fontWeight:700, color:"#bdbdbd", borderBottom:`2px solid ${accent}`, fontSize:"1.4vh", letterSpacing:0.3 };

  return (
    <div style={{minHeight:"100vh",background:"#0a0a0a",color:"#f5f5f5",direction:"rtl",fontFamily:"'Heebo', system-ui, -apple-system, sans-serif",padding:"1.1vh 1.7vw"}}>
      <div style={{maxWidth:"90vw",margin:"0 auto"}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"0.7vh",marginBottom:"1.3vh",paddingBottom:"0.9vh",borderBottom:`2px solid ${accent}`}}>
          <div style={{display:"flex",alignItems:"center",gap:"1vw"}}>
            {settings.logo && <img src={settings.logo} alt="logo" style={{height:"3.3vh"}}/>}
            <div>
              <div style={{fontSize:"1.3vh",fontWeight:700,color:accent,letterSpacing:0.3}}>📋 לוח לו״ז יומי</div>
              <div style={{fontSize:"2.2vh",color:"#fff",fontWeight:800,letterSpacing:0.3}}>{dateLabel()}</div>
            </div>
          </div>
          <div style={{fontSize:"1.1vh",color:"#666",fontWeight:500}}>מתעדכן אוטומטית כל 5 דקות</div>
        </div>

        {/* ─── Lessons section ─── */}
        <div style={{marginBottom:"1.8vh"}}>
          <div style={{fontSize:"1.7vh",fontWeight:800,color:"#fff",marginBottom:"0.7vh",display:"flex",alignItems:"center",gap:"0.5vw"}}>
            <span style={{fontSize:"1.9vh"}}>🎓</span> שיעורים היום
          </div>
          {lessonRows.length === 0 ? (
            <div style={{padding:"2.8vh 1.5vw",textAlign:"center",color:"#666",fontSize:"1.5vh",background:"#111",borderRadius:"0.8vh"}}>אין שיעורים היום</div>
          ) : (
            <div style={{overflowX:"auto",background:"#111",borderRadius:"0.8vh",border:"1px solid #1e1e1e"}}>
              <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0}}>
                <thead>
                  <tr style={{background:"#151515"}}>
                    <th style={{...thBase,width:"13vw"}}>מסלול לימודים</th>
                    <th style={{...thBase}}>קורס</th>
                    <th style={{...thBase,width:"14vw"}}>מרצה</th>
                    <th style={{...thBase,width:"11vw"}}>שעות</th>
                    <th style={{...thBase,width:"14vw"}}>כיתת לימוד</th>
                    <th style={{...thBase}}>שם שיעור</th>
                  </tr>
                </thead>
                <tbody>
                  {lessonRows.map((r,i) => (
                    <tr key={i} style={{background:i%2===0?"transparent":"rgba(255,255,255,0.025)"}}>
                      <td style={{...cellBase,color:"#bbb",fontWeight:500}}>{r.track||"—"}</td>
                      <td style={{...cellBase,fontWeight:700,color:"#fff"}}>{r.course||"—"}</td>
                      <td style={{...cellBase,color:"#ddd"}}>{r.instructor||"—"}</td>
                      <td style={{...cellBase,color:accent,fontWeight:700,whiteSpace:"nowrap"}}>{r.startTime&&r.endTime?`${r.startTime}–${r.endTime}`:r.startTime||"—"}</td>
                      <td style={{...cellBase,color:"#ddd"}}>{stName(r.studioId)}</td>
                      <td style={{...cellBase,color:"#ddd"}}>{r.topic||"—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ─── Student bookings section ─── */}
        <div>
          <div style={{fontSize:"1.7vh",fontWeight:800,color:"#fff",marginBottom:"0.7vh",display:"flex",alignItems:"center",gap:"0.5vw"}}>
            <span style={{fontSize:"1.9vh"}}>🎙️</span> קביעות סטודנטים היום
          </div>
          {studentRows.length === 0 ? (
            <div style={{padding:"1.8vh",textAlign:"center",color:"#666",fontSize:"1.4vh",background:"#111",borderRadius:"0.8vh"}}>אין קביעות סטודנטים היום</div>
          ) : (
            <div style={{overflowX:"auto",background:"#111",borderRadius:"0.8vh",border:"1px solid #1e1e1e"}}>
              <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0}}>
                <thead>
                  <tr style={{background:"#151515"}}>
                    <th style={{...thBase,width:"16vw"}}>שם</th>
                    <th style={{...thBase,width:"14vw"}}>מסלול לימודים</th>
                    <th style={{...thBase,width:"15vw"}}>חדר / אולפן</th>
                    <th style={{...thBase,width:"11vw"}}>שעות</th>
                    <th style={{...thBase}}>הערה</th>
                  </tr>
                </thead>
                <tbody>
                  {studentRows.map((r,i) => (
                    <tr key={i} style={{background:i%2===0?"transparent":"rgba(255,255,255,0.025)"}}>
                      <td style={{...cellBase,fontWeight:700,color:"#fff"}}>{r.name}</td>
                      <td style={{...cellBase,color:"#bbb",fontWeight:500}}>{r.track||"—"}</td>
                      <td style={{...cellBase,color:"#ddd"}}>{stName(r.studioId)}</td>
                      <td style={{...cellBase,color:"#2ecc71",fontWeight:700,whiteSpace:"nowrap"}}>{r.startTime&&r.endTime?`${r.startTime}–${r.endTime}`:r.startTime||"—"}</td>
                      <td style={{...cellBase,color:"#aaa"}}>{r.note||"—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
