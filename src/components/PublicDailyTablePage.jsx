// PublicDailyTablePage.jsx — public display of today's combined schedule as a table
import { useState, useEffect, useMemo, useRef } from "react";
import { listLessons } from "../utils/lessonsApi.js";
import { listStudios } from "../utils/studiosApi.js";
import { listStudioBookings } from "../utils/studioBookingsApi.js";
import { loadSiteSettingsFromTable } from "../utils/siteSettingsApi.js";
import { buildLessonStudioBookings } from "../utils/lessonBookings.js";
import { ClipboardList, GraduationCap, Mic } from "lucide-react";

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
  const [lessons,       setLessons]      = useState([]);
  const [bookings,      setBookings]     = useState([]);
  const [studios,       setStudios]      = useState([]);
  const [settings,      setSettings]     = useState({});
  const lottieRef = useRef(null);

  useEffect(() => {
    let anim;
    Promise.all([
      import("lottie-web"),
      fetch("/D1.json").then(r => r.json()),
    ]).then(([mod, data]) => {
      const lottie = mod.default ?? mod;
      if (!lottieRef.current) return;
      lottieRef.current.innerHTML = "";
      anim = lottie.loadAnimation({
        container: lottieRef.current,
        renderer: "svg",
        loop: true,
        autoplay: true,
        animationData: data,
      });
    }).catch(() => {});
    return () => { anim?.destroy(); if (lottieRef.current) lottieRef.current.innerHTML = ""; };
  }, []);
  const today = todayStr();

  const loadData = async () => {
    const [lsns, realBookings, stds, st] = await Promise.all([
      listLessons(),
      listStudioBookings(),
      listStudios(),
      loadSiteSettingsFromTable().catch(() => ({})),
    ]);
    const lessons = Array.isArray(lsns)?lsns:[];
    setLessons(lessons);
    // Merge persisted bookings with in-memory lesson_auto (from lessons.schedule)
    const lessonAuto = buildLessonStudioBookings(lessons);
    setBookings([...(Array.isArray(realBookings)?realBookings:[]), ...lessonAuto]);
    setStudios(Array.isArray(stds)?stds:[]);
    if (st && typeof st === "object") setSettings(st);
  };

  useEffect(() => {
    injectHeeboFont();
    loadData();
    const refresh = setInterval(loadData, 5*60*1000); // every 5 min
    const reload  = setInterval(() => window.location.reload(), 30*60*1000);
    return () => { clearInterval(refresh); clearInterval(reload); };
  }, []);

  const stName = id => studios.find(s=>String(s.id)===String(id))?.name || id || "—";
  const stNames = ids => {
    const list = (Array.isArray(ids) ? ids : [ids])
      .filter(Boolean)
      .map(stName)
      .filter(Boolean);
    return list.length ? [...new Set(list)].join(" + ") : "—";
  };

  // ── Lessons today ──
  const lessonRows = useMemo(() => {
    const out = [];
    // From lesson schedules
    lessons.forEach(lesson => {
      // Build id → name map from the course chips so per-session lecturer
      // assignments resolve to display names, joined with " + ".
      const lessonLecturerById = new Map();
      if (Array.isArray(lesson?.lecturers)) {
        for (const item of lesson.lecturers) {
          if (item?.lecturerId) lessonLecturerById.set(String(item.lecturerId), String(item.instructorName || "").trim());
        }
      }
      (lesson.schedule||[]).forEach(s => {
        if (s.date !== today) return;
        const raw = Array.isArray(s.studioIds) && s.studioIds.length
          ? s.studioIds
          : [s.studioId, s.secondaryStudioId, lesson.studioId].filter(Boolean);
        const studioIds = [...new Set(raw.map(String))];
        // Multi-lecturer: prefer session.lecturerIds[] joined by " + ".
        // Falls back to session.instructorName (scalar) then course primary.
        const sessionLecturerIds = Array.isArray(s.lecturerIds) ? s.lecturerIds.filter(Boolean) : [];
        const joinedLecturers = sessionLecturerIds.length
          ? sessionLecturerIds.map(id => lessonLecturerById.get(String(id)) || "").filter(Boolean).join(" + ")
          : "";
        const instructor = joinedLecturers || s.instructorName || lesson.instructorName || lesson.lecturer || "";
        out.push({
          lessonId:   lesson.id || "",
          track:      lesson.track || "",
          course:     lesson.courseName || lesson.name || "",
          instructor,
          startTime:  s.startTime || "",
          endTime:    s.endTime   || "",
          studioId:   studioIds[0] || "",
          studioIds,
          topic:      s.topic     || "",
        });
      });
    });
    // From bookings marked as lesson (in case lesson session not represented in schedule)
    const bookingRows = new Map();
    bookings.forEach(b => {
      if (b.date !== today || b.status === "נדחה") return;
      if (getBookingKind(b) !== "lesson") return;
      if (out.some(r => (
        String(r.lessonId || "") === String(b.lesson_id || "") &&
        r.startTime === b.startTime &&
        r.endTime === b.endTime
      ))) return;
      const key = `${b.lesson_id || ""}|${b.courseName || ""}|${b.instructorName || ""}|${b.date}|${b.startTime}|${b.endTime}|${b.subject || b.topic || b.sessionName || ""}`;
      const existing = bookingRows.get(key);
      if (existing) {
        if (b.studioId && !existing.studioIds.some(id => String(id) === String(b.studioId))) existing.studioIds.push(b.studioId);
        return;
      }
      bookingRows.set(key, {
        lessonId:   b.lesson_id || "",
        track:      b.track || "",
        course:     b.courseName || "",
        instructor: b.instructorName || "",
        startTime:  b.startTime || "",
        endTime:    b.endTime   || "",
        studioId:   b.studioId  || "",
        studioIds:  b.studioId ? [b.studioId] : [],
        topic:      b.topic     || b.sessionName || "",
      });
    });
    out.push(...bookingRows.values());
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
        isNight:   !!b.isNight,
      }))
      .sort((a,b)=>(a.startTime||"").localeCompare(b.startTime||""));
  }, [bookings, today]);

  const morningRows = useMemo(() => lessonRows.filter(r => (r.startTime||"") < "17:00"), [lessonRows]);
  const eveningRows = useMemo(() => lessonRows.filter(r => (r.startTime||"") >= "17:00"), [lessonRows]);

  const accent = settings.accentColor || "#f5a623";

  // vh/vw units calibrated for 1920×1080 HD TV (1vh=10.8px, 1vw=19.2px)
  const cellBase = { padding:"1vh 1.2vw", borderBottom:"1px solid #222", color:"#e8e8e8", fontSize:"1.6vh" };
  const thBase   = { padding:"0.9vh 1.2vw", textAlign:"right", fontWeight:700, color:"#bdbdbd", borderBottom:`2px solid ${accent}`, fontSize:"1.4vh", letterSpacing:0.3 };

  return (
    <div style={{minHeight:"100vh",background:"#0a0a0a",color:"#f5f5f5",direction:"rtl",fontFamily:"'Heebo', system-ui, -apple-system, sans-serif",padding:"1.1vh 1.7vw"}}>
      <div ref={lottieRef} style={{position:"fixed",bottom:0,left:0,width:"18vw",pointerEvents:"none",zIndex:10}} />
      <div style={{maxWidth:"90vw",margin:"0 auto"}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"0.7vh",marginBottom:"1.3vh",paddingBottom:"0.9vh",borderBottom:`2px solid ${accent}`}}>
          <div style={{display:"flex",alignItems:"center",gap:"1vw"}}>
            {settings.logo && <img src={settings.logo} alt="logo" style={{height:"3.3vh"}}/>}
            <div>
              <div style={{fontSize:"1.3vh",fontWeight:700,color:accent,letterSpacing:0.3,display:"flex",alignItems:"center",gap:4}}><ClipboardList size={13} strokeWidth={1.75} color={accent} /> לוח לו״ז יומי</div>
              <div style={{fontSize:"2.2vh",color:"#fff",fontWeight:800,letterSpacing:0.3}}>{dateLabel()}</div>
            </div>
          </div>
          <div style={{fontSize:"1.1vh",color:"#666",fontWeight:500}}>מתעדכן אוטומטית כל 5 דקות</div>
        </div>

        {/* ─── Lessons section ─── */}
        <div style={{marginBottom:"1.8vh"}}>
          <div style={{fontSize:"1.7vh",fontWeight:800,color:"#fff",marginBottom:"0.7vh",display:"flex",alignItems:"center",gap:"0.5vw"}}>
            <GraduationCap size={16} strokeWidth={1.75} color={accent} /> שיעורים היום
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
                  {/* ── שיעורי בוקר ── */}
                  {morningRows.length > 0 && (
                    <tr>
                      <td colSpan={6} style={{padding:"0.6vh 1.2vw",background:"rgba(245,166,35,0.07)",borderBottom:"1px solid #2a2a2a",borderTop:"1px solid #2a2a2a",color:accent,fontWeight:700,fontSize:"1.3vh",letterSpacing:0.5}}>
                        ☀️ שיעורי בוקר &nbsp;<span style={{fontWeight:400,color:"#888",fontSize:"1.2vh"}}>09:00–17:00</span>
                      </td>
                    </tr>
                  )}
                  {morningRows.map((r,i) => (
                    <tr key={`m${i}`} style={{background:i%2===0?"transparent":"rgba(255,255,255,0.025)"}}>
                      <td style={{...cellBase,color:"#bbb",fontWeight:500}}>{r.track||"—"}</td>
                      <td style={{...cellBase,fontWeight:700,color:"#fff"}}>{r.course||"—"}</td>
                      <td style={{...cellBase,color:"#ddd"}}>{r.instructor||"—"}</td>
                      <td style={{...cellBase,color:accent,fontWeight:700,whiteSpace:"nowrap"}}>{r.startTime&&r.endTime?`${formatTime(r.startTime)}–${formatTime(r.endTime)}`:formatTime(r.startTime)||"—"}</td>
                      <td style={{...cellBase,color:"#ddd"}}>{stNames(r.studioIds || r.studioId)}</td>
                      <td style={{...cellBase,color:"#ddd"}}>{r.topic||"—"}</td>
                    </tr>
                  ))}
                  {/* ── שיעורי ערב ── */}
                  {eveningRows.length > 0 && (
                    <tr>
                      <td colSpan={6} style={{padding:"0.6vh 1.2vw",background:"rgba(100,149,237,0.07)",borderBottom:"1px solid #2a2a2a",borderTop:`2px solid #333`,color:"#7eb3ff",fontWeight:700,fontSize:"1.3vh",letterSpacing:0.5}}>
                        🌙 שיעורי ערב &nbsp;<span style={{fontWeight:400,color:"#888",fontSize:"1.2vh"}}>17:00–22:00</span>
                      </td>
                    </tr>
                  )}
                  {eveningRows.map((r,i) => (
                    <tr key={`e${i}`} style={{background:i%2===0?"transparent":"rgba(255,255,255,0.025)"}}>
                      <td style={{...cellBase,color:"#bbb",fontWeight:500}}>{r.track||"—"}</td>
                      <td style={{...cellBase,fontWeight:700,color:"#fff"}}>{r.course||"—"}</td>
                      <td style={{...cellBase,color:"#ddd"}}>{r.instructor||"—"}</td>
                      <td style={{...cellBase,color:"#7eb3ff",fontWeight:700,whiteSpace:"nowrap"}}>{r.startTime&&r.endTime?`${formatTime(r.startTime)}–${formatTime(r.endTime)}`:formatTime(r.startTime)||"—"}</td>
                      <td style={{...cellBase,color:"#ddd"}}>{stNames(r.studioIds || r.studioId)}</td>
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
            <Mic size={16} strokeWidth={1.75} color={accent} /> קביעות סטודנטים היום
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
                    <th style={{...thBase,width:"8vw"}}>סוג</th>
                    <th style={{...thBase}}>הערה</th>
                  </tr>
                </thead>
                <tbody>
                  {studentRows.map((r,i) => (
                    <tr key={i} style={{background:i%2===0?"transparent":"rgba(255,255,255,0.025)"}}>
                      <td style={{...cellBase,fontWeight:700,color:"#fff"}}>{r.name}</td>
                      <td style={{...cellBase,color:"#bbb",fontWeight:500}}>{r.track||"—"}</td>
                      <td style={{...cellBase,color:"#ddd"}}>{stName(r.studioId)}</td>
                      <td style={{...cellBase,color:r.isNight?"#7b8cde":"#f5c842",fontWeight:700,whiteSpace:"nowrap"}}>{r.startTime&&r.endTime?`${formatTime(r.startTime)}–${formatTime(r.endTime)}`:formatTime(r.startTime)||"—"}</td>
                      <td style={{...cellBase,whiteSpace:"nowrap"}}>
                        {r.isNight
                          ? <span style={{color:"#7b8cde",fontWeight:700,fontSize:"1.3vh"}}>🌙 לילה</span>
                          : <span style={{color:"#f5c842",fontWeight:600,fontSize:"1.3vh"}}>☀️ יום</span>}
                      </td>
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
