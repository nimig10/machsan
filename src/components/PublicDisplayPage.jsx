// PublicDisplayPage.jsx — public display screen for daily schedule & room bookings
import { useState, useEffect, useMemo, useRef } from "react";
import { storageGet } from "../utils.js";

const HE_DAYS   = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

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
  const [viewIndex,    setViewIndex]    = useState(0);   // 0=lessons, 1=rooms
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
    const dataRefresh = setInterval(loadData, 5 * 60 * 1000);
    return () => clearInterval(dataRefresh);
  }, []);

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
        setViewIndex(v => (v + 1) % 2);
        setVisible(true);
        startRef.current = Date.now();
        setProgress(0);
      }, 600);
    }, intervalMs);
    return () => { clearInterval(progressRef.current); clearTimeout(switchTimer); };
  }, [viewIndex, intervalMs]);

  // ── Today's lessons (from lessons table only) ─────────────────────────────
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

  const studioName = id => (studios || []).find(s => s.id === id)?.name || id || "";

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

      {/* ── Header ── */}
      <div style={{
        background: "var(--surface)",
        borderBottom: "2px solid var(--border)",
        padding: "14px 32px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexShrink: 0,
      }}>
        {/* View tabs */}
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {["📚 שיעורים","🎙️ חדרים"].map((label, i) => (
            <div key={i} style={{
              padding: "7px 18px",
              borderRadius: 20,
              fontSize: 14,
              fontWeight: 800,
              background: viewIndex === i ? accent : "var(--surface2)",
              color: viewIndex === i ? "#000" : "var(--text3)",
              border: `1px solid ${viewIndex === i ? accent : "var(--border)"}`,
              transition: "all 0.3s",
            }}>{label}</div>
          ))}
        </div>

        {/* Date + logo */}
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{textAlign:"left"}}>
            <div style={{fontSize:11,color:"var(--text3)",fontWeight:600}}>לוז יומי — מכללת קמרה אובסקורה וסאונד</div>
            <div style={{fontSize:18,fontWeight:900,color:"var(--text)"}}>{dateLabel}</div>
          </div>
          {siteSettings.logo && (
            <img src={siteSettings.logo} alt="לוגו" style={{height:46,objectFit:"contain",borderRadius:6}}/>
          )}
        </div>
      </div>

      {/* ── Progress bar ── */}
      <div style={{height:3,background:"var(--surface2)",flexShrink:0}}>
        <div style={{height:"100%",width:`${progress}%`,background:accent,transition:"width 0.2s linear"}}/>
      </div>

      {/* ── Content ── */}
      <div style={{
        flex: 1,
        overflow: "hidden",
        padding: "28px 32px",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.6s ease",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}>
        <div style={{width:"100%",maxWidth:1100}}>

          {/* View 0: Lessons */}
          {viewIndex === 0 && (
            <div style={{width:"100%"}}>
              <div style={{fontSize:14,fontWeight:700,color:"var(--text3)",marginBottom:16,textAlign:"center"}}>
                📚 שיעורים מתוכננים להיום
                {todayLessons.length > 0 && (
                  <span style={{marginRight:8,color:accent,fontWeight:900}}>{todayLessons.length} שיעורים</span>
                )}
              </div>
              {todayLessons.length === 0 ? (
                <div style={{textAlign:"center",color:"var(--text3)",fontSize:20,padding:"60px 0"}}>אין שיעורים מתוכננים להיום</div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:12,width:"100%"}}>
                  {todayLessons.map((s,i) => (
                    <div key={i} style={{
                      width:"100%",
                      background:"var(--surface)",
                      border:"1px solid var(--border)",
                      borderRadius:14,
                      display:"flex",
                      alignItems:"stretch",
                      overflow:"hidden",
                    }}>
                      {/* Time block */}
                      <div style={{
                        background:`${accent}18`,
                        borderRight:`5px solid ${accent}`,
                        padding:"18px 24px",
                        display:"flex",
                        alignItems:"center",
                        justifyContent:"center",
                        flexShrink:0,
                        minWidth:160,
                      }}>
                        <div style={{fontWeight:900,fontSize:26,color:accent,textAlign:"center",whiteSpace:"nowrap"}}>
                          {s.startTime}<br/><span style={{fontSize:16,opacity:0.7}}>—</span><br/>{s.endTime}
                        </div>
                      </div>
                      {/* Info block */}
                      <div style={{flex:1,padding:"16px 24px",display:"flex",flexDirection:"column",justifyContent:"center",gap:6}}>
                        <div style={{fontWeight:900,fontSize:22,color:"var(--text)",lineHeight:1.2}}>
                          {s.courseName}
                        </div>
                        {s.instructorName && (
                          <div style={{fontSize:17,fontWeight:700,color:"var(--text2)"}}>
                            👤 {s.instructorName}
                          </div>
                        )}
                        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:2}}>
                          {s.track && (
                            <span style={{fontSize:13,fontWeight:700,color:accent,background:`${accent}1a`,borderRadius:20,padding:"3px 14px",border:`1px solid ${accent}55`}}>
                              🎓 {s.track}
                            </span>
                          )}
                          {s.studioId && (
                            <span style={{fontSize:13,fontWeight:700,color:"var(--text3)",background:"var(--surface2)",borderRadius:20,padding:"3px 14px",border:"1px solid var(--border)"}}>
                              📍 {studioName(s.studioId)}
                            </span>
                          )}
                          {s.topic && (
                            <span style={{fontSize:13,color:"var(--text3)"}}>📖 {s.topic}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* View 1: Room bookings (students & team only) */}
          {viewIndex === 1 && (
            <div style={{width:"100%"}}>
              <div style={{fontSize:14,fontWeight:700,color:"var(--text3)",marginBottom:16,textAlign:"center"}}>
                🎙️ קביעות חדרים להיום
                {todayRoomBookings.length > 0 && (
                  <span style={{marginRight:8,color:accent,fontWeight:900}}>{todayRoomBookings.length} קביעות</span>
                )}
              </div>
              {todayRoomBookings.length === 0 ? (
                <div style={{textAlign:"center",color:"var(--text3)",fontSize:20,padding:"60px 0"}}>אין קביעות חדרים להיום</div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:12,width:"100%"}}>
                  {todayRoomBookings.map((b,i) => {
                    const kind  = getBookingKind(b);
                    const name  = kind === "team" ? (b.teamMemberName||"איש צוות") : (b.studentName||"סטודנט");
                    const color = b.isNight ? "#2196f3" : "#2ecc71";
                    const time  = b.isNight ? "לילה" : `${b.startTime||""}–${b.endTime||""}`;
                    const icon  = kind === "team" ? "👥" : "👤";
                    return (
                      <div key={i} style={{
                        width:"100%",
                        background:"var(--surface)",
                        border:"1px solid var(--border)",
                        borderRadius:14,
                        display:"flex",
                        alignItems:"stretch",
                        overflow:"hidden",
                      }}>
                        {/* Time block */}
                        <div style={{
                          background:`${color}18`,
                          borderRight:`5px solid ${color}`,
                          padding:"16px 24px",
                          display:"flex",
                          alignItems:"center",
                          justifyContent:"center",
                          flexShrink:0,
                          minWidth:160,
                        }}>
                          <div style={{fontWeight:900,fontSize:24,color,textAlign:"center",whiteSpace:"nowrap"}}>
                            {b.isNight ? "לילה" : <>{b.startTime}<br/><span style={{fontSize:15,opacity:0.7}}>—</span><br/>{b.endTime}</>}
                          </div>
                        </div>
                        {/* Info block */}
                        <div style={{flex:1,padding:"16px 24px",display:"flex",flexDirection:"column",justifyContent:"center",gap:6}}>
                          <div style={{fontWeight:900,fontSize:20,color:"var(--text)"}}>
                            {icon} {name}
                          </div>
                          <div style={{fontSize:16,fontWeight:700,color:"var(--text3)"}}>
                            📍 {studioName(b.studioId)}
                          </div>
                          {b.notes && (
                            <div style={{fontSize:12,color:"var(--text3)"}}>💬 {b.notes}</div>
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
        padding:"8px 0",
        fontSize:11,
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
