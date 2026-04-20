// PublicDisplayPage.jsx — public display screen for daily schedule & room bookings
import { useState, useEffect, useMemo, useRef } from "react";
import { storageGet } from "../utils.js";
import { BookOpen, GraduationCap, Mic } from "lucide-react";

const HE_DAYS   = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

const ITEMS_PER_PAGE = 5;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function makeDateLabel() {
  const d = new Date();
  return `יום ${HE_DAYS[d.getDay()]}, ${d.getDate()} ב${HE_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function getBookingKind(b) {
  if (b.bookingKind === "lesson" || b.lesson_auto || (b.lesson_id != null && b.lesson_id !== "")) return "lesson";
  if (b.bookingKind === "team" || b.teamMemberId || b.teamMemberName) return "team";
  return "student";
}

export function PublicDisplayPage() {
  const [lessons,      setLessons]      = useState([]);
  const [bookings,     setBookings]     = useState([]);
  const [studios,      setStudios]      = useState([]);
  const [siteSettings, setSiteSettings] = useState({});
  const [viewIndex,    setViewIndex]    = useState(0);
  const [visible,      setVisible]      = useState(true);
  const [progress,     setProgress]     = useState(0);
  const today = todayStr();

  // ── Load data ─────────────────────────────────────────────────────────────
  const loadData = async () => {
    const [lsns, bkgs, stds, settings] = await Promise.all([
      storageGet("lessons"),
      storageGet("studio_bookings"),
      storageGet("studios"),
      storageGet("siteSettings"),
    ]);
    setLessons(Array.isArray(lsns) ? lsns : []);
    setBookings(Array.isArray(bkgs) ? bkgs : []);
    setStudios(Array.isArray(stds) ? stds : []);
    if (settings && typeof settings === "object") setSiteSettings(settings);
  };

  useEffect(() => {
    loadData();
    const dataRefresh = setInterval(loadData, 5 * 60 * 1000); // every 5 min
    const pageReload  = setInterval(() => window.location.reload(), 15 * 60 * 1000); // was 5 min
    return () => { clearInterval(dataRefresh); clearInterval(pageReload); };
  }, []);

  // ── Today's lessons ────────────────────────────────────────────────────────
  const todayLessons = useMemo(() => {
    const rows = [];
    lessons.forEach(lesson => {
      (lesson.schedule || []).forEach(s => {
        if (s.date === today) {
          rows.push({
            startTime:      s.startTime      || "",
            endTime:        s.endTime        || "",
            courseName:     lesson.courseName || lesson.name || "",
            instructorName: lesson.instructorName || "",
            track:          lesson.track     || "",
            topic:          s.topic          || "",
            studioId:       s.studioId       || lesson.studioId || "",
          });
        }
      });
    });
    return rows.sort((a,b) =>
      a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime)
    );
  }, [lessons, today]);

  // ── Today's room bookings — students & team only (no lessons) ─────────────
  const todayRoomBookings = useMemo(() => {
    return (bookings || [])
      .filter(b => b.date === today && getBookingKind(b) !== "lesson")
      .sort((a,b) => (a.startTime||"").localeCompare(b.startTime||"") || (a.endTime||"").localeCompare(b.endTime||""));
  }, [bookings, today]);

  // ── Studio lookup helpers (string-coerced ID to avoid type mismatches) ──────
  const findStudio = id => {
    if (id == null || id === "") return null;
    return (studios || []).find(s => String(s.id) === String(id)) || null;
  };
  const studioName = id => findStudio(id)?.name || "";

  // ── Paginated views array ──────────────────────────────────────────────────
  const views = useMemo(() => {
    const v = [];
    const lPages = Math.max(1, Math.ceil(todayLessons.length / ITEMS_PER_PAGE));
    for (let p = 0; p < lPages; p++) {
      v.push({
        type: "lessons",
        items: todayLessons.slice(p * ITEMS_PER_PAGE, (p + 1) * ITEMS_PER_PAGE),
        page: p + 1,
        total: lPages,
      });
    }
    const rPages = Math.max(1, Math.ceil(todayRoomBookings.length / ITEMS_PER_PAGE));
    for (let p = 0; p < rPages; p++) {
      v.push({
        type: "rooms",
        items: todayRoomBookings.slice(p * ITEMS_PER_PAGE, (p + 1) * ITEMS_PER_PAGE),
        page: p + 1,
        total: rPages,
      });
    }
    return v;
  }, [todayLessons, todayRoomBookings]);

  const currentView = views[viewIndex] || views[0];

  // ── Auto-rotate + progress bar ────────────────────────────────────────────
  const intervalMs = Math.max(5, (siteSettings.publicDisplayInterval || 18)) * 1000;
  const progressRef = useRef(null);
  const startRef    = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    setProgress(0);
    clearInterval(progressRef.current);
    progressRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      setProgress(Math.min(100, (elapsed / intervalMs) * 100));
    }, 200);
    const switchTimer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => {
        setViewIndex(v => (v + 1) % views.length);
        setVisible(true);
        startRef.current = Date.now();
        setProgress(0);
      }, 600);
    }, intervalMs);
    return () => { clearInterval(progressRef.current); clearTimeout(switchTimer); };
  }, [viewIndex, intervalMs, views.length]);

  const accent = siteSettings.accentColor || "#f5a623";
  const dateLabel = makeDateLabel();

  return (
    <div style={{
      minHeight: "100vh",
      maxHeight: "100vh",
      overflow: "hidden",
      background: "var(--bg)",
      color: "var(--text)",
      direction: "rtl",
      display: "flex",
      flexDirection: "column",
      "--accent": accent,
      "--accent-glow": `${accent}2e`,
    }}>

      {/* ── Header — sized for 1920×1080 TV ── */}
      <div style={{
        background: "var(--surface)",
        borderBottom: "2px solid var(--border)",
        padding: "0.9vh 1.7vw",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.3vw",
        flexShrink: 0,
        position: "relative",
      }}>
        {/* View tabs */}
        <div style={{display:"flex",gap:"0.4vw",alignItems:"center",flexWrap:"wrap",position:"absolute",right:"1vw"}}>
          {views.map((view, i) => {
            const label = view.type === "lessons"
              ? (view.total > 1 ? <><BookOpen size={14} strokeWidth={1.75} /> {`שיעורים ${view.page}/${view.total}`}</> : <><BookOpen size={14} strokeWidth={1.75} /> שיעורים</>)
              : (view.total > 1 ? <><Mic size={14} strokeWidth={1.75} /> {`קביעות חדרים ${view.page}/${view.total}`}</> : <><Mic size={14} strokeWidth={1.75} /> קביעות חדרים</>);
            return (
              <div key={i} style={{
                padding: "0.4vh 1vw",
                borderRadius: 20,
                fontSize: "1.2vh",
                fontWeight: 800,
                background: viewIndex === i ? accent : "var(--surface2)",
                color: viewIndex === i ? "#000" : "var(--text3)",
                border: `1px solid ${viewIndex === i ? accent : "var(--border)"}`,
                transition: "all 0.3s",
                whiteSpace: "nowrap",
              }}>{label}</div>
            );
          })}
        </div>

        {/* Date + logo */}
        <div style={{display:"flex",alignItems:"center",gap:"1vw",flexShrink:0}}>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:"1.4vh",color:"var(--text3)",fontWeight:700}}>לוז יומי — מכללת קמרה אובסקורה וסאונד</div>
            <div style={{fontSize:"2.2vh",fontWeight:900,color:"var(--text)"}}>{dateLabel}</div>
          </div>
          {siteSettings.logo && (
            <img src={siteSettings.logo} alt="לוגו" style={{height:"4.1vh",objectFit:"contain",borderRadius:6}}/>
          )}
        </div>
      </div>

      {/* ── Progress bar ── */}
      <div style={{height:"0.3vh",background:"var(--surface2)",flexShrink:0}}>
        <div style={{height:"100%",width:`${progress}%`,background:accent,transition:"width 0.2s linear"}}/>
      </div>

      {/* ── Content ── */}
      <div style={{
        flex: 1,
        overflow: "hidden",
        padding: "1.5vh 1.7vw",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.6s ease",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <div style={{width:"100%",maxWidth:"80vw"}}>

          {/* Lessons view */}
          {currentView?.type === "lessons" && (
            <div style={{width:"100%"}}>
              <div style={{fontSize:"1.9vh",fontWeight:900,color:"var(--text)",marginBottom:"1.1vh",textAlign:"center"}}>
                <BookOpen size={16} strokeWidth={1.75} color="var(--accent)" /> שיעורים מתוכננים להיום
                {todayLessons.length > 0 && (
                  <span style={{marginRight:"0.5vw",color:accent,fontWeight:900}}>{todayLessons.length} שיעורים</span>
                )}
              </div>
              {todayLessons.length === 0 ? (
                <div style={{textAlign:"center",color:"var(--text3)",fontSize:"2vh",padding:"6vh 0"}}>אין שיעורים מתוכננים להיום</div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:"0.7vh",width:"100%"}}>
                  {currentView.items.map((s,i) => {
                    const studio   = findStudio(s.studioId);
                    const roomName = studio?.name || "";
                    const roomImg  = studio?.image || "";
                    const hasImg   = roomImg.startsWith("http") || roomImg.startsWith("data:");
                    return (
                      <div key={i} style={{
                        width:"100%",
                        background:"var(--surface)",
                        border:"1px solid var(--border)",
                        borderRadius:"0.8vh",
                        display:"flex",
                        alignItems:"stretch",
                        overflow:"hidden",
                      }}>
                        {/* Time block */}
                        <div style={{
                          background:`${accent}18`,
                          borderRight:`0.4vh solid ${accent}`,
                          padding:"0.9vh 1.5vw",
                          display:"flex",
                          alignItems:"center",
                          justifyContent:"center",
                          flexShrink:0,
                          width:"7.3vw",
                        }}>
                          <div style={{fontWeight:900,fontSize:"2vh",color:accent,textAlign:"center",whiteSpace:"nowrap"}}>
                            {s.startTime}<br/><span style={{fontSize:"1.3vh",opacity:0.7}}>—</span><br/>{s.endTime}
                          </div>
                        </div>
                        {/* Info block */}
                        <div style={{flex:1,padding:"0.9vh 0.9vw",display:"flex",flexDirection:"column",justifyContent:"center",gap:"0.4vh"}}>
                          <div style={{fontWeight:900,fontSize:"2.1vh",color:"var(--text)",lineHeight:1.2}}>
                            {s.courseName}
                          </div>
                          {s.instructorName && (
                            <div style={{fontSize:"1.5vh",fontWeight:700,color:"var(--text2)"}}>
                              👤 שם המורה: {s.instructorName}
                            </div>
                          )}
                          {roomName && (
                            <div style={{fontSize:"1.4vh",fontWeight:800,color:"var(--text2)"}}>
                              🏫 כיתת לימוד: {roomName}
                            </div>
                          )}
                          {s.topic && (
                            <div style={{fontSize:"1.4vh",fontWeight:700,color:"var(--text3)"}}>
                              📖 נושא השיעור: {s.topic}
                            </div>
                          )}
                          <div style={{display:"flex",gap:"0.3vw",flexWrap:"wrap",marginTop:"0.1vh"}}>
                            {s.track && (
                              <span style={{fontSize:"1.1vh",fontWeight:700,color:accent,background:`${accent}1a`,borderRadius:20,padding:"0.2vh 0.8vw",border:`1px solid ${accent}55`}}>
                                <GraduationCap size={11} strokeWidth={1.75} /> {s.track}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Studio image block (left side) */}
                        {(hasImg || (!hasImg && roomImg)) && (
                          <div style={{
                            flexShrink:0,
                            width:"5.7vw",
                            display:"flex",
                            alignItems:"center",
                            justifyContent:"center",
                            background:"var(--surface2)",
                            borderRight:"1px solid var(--border)",
                            overflow:"hidden",
                          }}>
                            {hasImg
                              ? <img src={roomImg} alt={roomName} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                              : <span style={{fontSize:"3.9vh"}}>{roomImg}</span>
                            }
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Rooms view */}
          {currentView?.type === "rooms" && (
            <div style={{width:"100%"}}>
              <div style={{fontSize:"1.9vh",fontWeight:900,color:"var(--text)",marginBottom:"1.1vh",textAlign:"center"}}>
                <Mic size={16} strokeWidth={1.75} color="var(--accent)" /> קביעות חדרים להיום
                {todayRoomBookings.length > 0 && (
                  <span style={{marginRight:"0.5vw",color:accent,fontWeight:900}}>{todayRoomBookings.length} קביעות</span>
                )}
              </div>
              {todayRoomBookings.length === 0 ? (
                <div style={{textAlign:"center",color:"var(--text3)",fontSize:"2vh",padding:"6vh 0"}}>אין קביעות חדרים להיום</div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:"0.7vh",width:"100%"}}>
                  {currentView.items.map((b,i) => {
                    const kind  = getBookingKind(b);
                    const name  = kind === "team" ? (b.teamMemberName||"איש צוות") : (b.studentName||"סטודנט");
                    const color = b.isNight ? "#2196f3" : "#2ecc71";
                    const icon  = kind === "team" ? "👥" : "👤";
                    const roomName = studioName(b.studioId);
                    return (
                      <div key={i} style={{
                        width:"100%",
                        background:"var(--surface)",
                        border:"1px solid var(--border)",
                        borderRadius:"0.8vh",
                        display:"flex",
                        alignItems:"stretch",
                        overflow:"hidden",
                      }}>
                        {/* Time block */}
                        <div style={{
                          background:`${color}18`,
                          borderRight:`0.4vh solid ${color}`,
                          padding:"0.9vh 1.5vw",
                          display:"flex",
                          alignItems:"center",
                          justifyContent:"center",
                          flexShrink:0,
                          width:"7.3vw",
                        }}>
                          <div style={{fontWeight:900,fontSize:"1.9vh",color,textAlign:"center",whiteSpace:"nowrap"}}>
                            {b.isNight ? "לילה" : <>{b.startTime}<br/><span style={{fontSize:"1.2vh",opacity:0.7}}>—</span><br/>{b.endTime}</>}
                          </div>
                        </div>
                        {/* Info block */}
                        <div style={{flex:1,padding:"0.9vh 0.9vw",display:"flex",flexDirection:"column",justifyContent:"center",gap:"0.4vh"}}>
                          <div style={{fontWeight:900,fontSize:"1.8vh",color:"var(--text)"}}>
                            {icon} {name}
                          </div>
                          {roomName && (
                            <div style={{fontSize:"1.4vh",fontWeight:700,color:"var(--text3)"}}>
                              🏫 {roomName}
                            </div>
                          )}
                          {b.notes && (
                            <div style={{fontSize:"1.2vh",color:"var(--text3)"}}>💬 {b.notes}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{
        textAlign:"center",
        padding:"0.5vh 0",
        fontSize:"1vh",
        color:"var(--text3)",
        borderTop:"1px solid var(--border)",
        background:"var(--surface)",
        flexShrink:0,
      }}>
        מתחלף אוטומטית כל {siteSettings.publicDisplayInterval || 18} שניות · {dateLabel}
      </div>
    </div>
  );
}
