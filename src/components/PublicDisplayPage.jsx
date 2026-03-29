// PublicDisplayPage.jsx — public display screen for daily schedule & room bookings
import { useState, useEffect, useMemo, useRef } from "react";
import { storageGet } from "../utils.js";

const HE_DAYS   = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

function todayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth()+1).padStart(2,"0");
  const dd   = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}

function dateLabel() {
  const d = new Date();
  return `יום ${HE_DAYS[d.getDay()]}, ${d.getDate()} ב${HE_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function getBookingKind(b) {
  if (b.bookingKind === "lesson" || b.lesson_auto || (b.lesson_id != null && b.lesson_id !== "")) return "lesson";
  if (b.bookingKind === "team" || b.teamMemberId || b.teamMemberName) return "team";
  return "student";
}

export function PublicDisplayPage() {
  const [lessons,       setLessons]       = useState([]);
  const [bookings,      setBookings]      = useState([]);
  const [studios,       setStudios]       = useState([]);
  const [siteSettings,  setSiteSettings]  = useState({});
  const [viewIndex,     setViewIndex]     = useState(0);   // 0=lessons, 1=rooms
  const [visible,       setVisible]       = useState(true); // for dissolve
  const [progress,      setProgress]      = useState(0);    // 0–100
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

    // Progress bar tick
    progressRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      setProgress(Math.min(100, (elapsed / intervalMs) * 100));
    }, 200);

    // View switch
    const switchTimer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => {
        setViewIndex(v => (v + 1) % 2);
        setVisible(true);
        startRef.current = Date.now();
        setProgress(0);
      }, 600);
    }, intervalMs);

    return () => {
      clearInterval(progressRef.current);
      clearTimeout(switchTimer);
    };
  }, [viewIndex, intervalMs]);

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
      a.startTime.localeCompare(b.startTime) ||
      a.endTime.localeCompare(b.endTime)
    );
  }, [lessons, today]);

  // ── Today's room bookings ─────────────────────────────────────────────────
  const todayBookings = useMemo(() => {
    return (bookings || [])
      .filter(b => b.date === today)
      .sort((a,b) => (a.startTime||"").localeCompare(b.startTime||"") || (a.endTime||"").localeCompare(b.endTime||""));
  }, [bookings, today]);

  const studioName = id => (studios || []).find(s => s.id === id)?.name || id || "";

  const accent = siteSettings.accentColor || "#f5a623";

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg)",
      color: "var(--text)",
      direction: "rtl",
      display: "flex",
      flexDirection: "column",
      fontFamily: "inherit",
      "--accent": accent,
      "--accent-glow": `${accent}2e`,
    }}>

      {/* ── Header ── */}
      <div style={{
        background: "var(--surface)",
        borderBottom: "2px solid var(--border)",
        padding: "18px 28px",
        display: "flex",
        alignItems: "center",
        gap: 18,
        flexWrap: "wrap",
        justifyContent: "space-between",
      }}>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          {siteSettings.logo && (
            <img src={siteSettings.logo} alt="לוגו" style={{height:52, objectFit:"contain", borderRadius:6}}/>
          )}
          <div>
            <div style={{fontSize:13, color:"var(--text3)", fontWeight:600}}>לוח יומי — מכללת קמרה אובסקורה וסאונד</div>
            <div style={{fontSize:20, fontWeight:900, color:"var(--text)"}}>{dateLabel()}</div>
          </div>
        </div>

        {/* View indicator */}
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {["📚 שיעורים", "🎙️ חדרים"].map((label, i) => (
            <div key={i} style={{
              padding: "6px 16px",
              borderRadius: 20,
              fontSize: 13,
              fontWeight: 800,
              background: viewIndex === i ? accent : "var(--surface2)",
              color: viewIndex === i ? "#000" : "var(--text3)",
              border: `1px solid ${viewIndex === i ? accent : "var(--border)"}`,
              transition: "all 0.3s",
            }}>{label}</div>
          ))}
        </div>
      </div>

      {/* ── Progress bar ── */}
      <div style={{height:3, background:"var(--surface2)"}}>
        <div style={{
          height: "100%",
          width: `${progress}%`,
          background: accent,
          transition: "width 0.2s linear",
        }}/>
      </div>

      {/* ── Content ── */}
      <div style={{
        flex: 1,
        padding: "24px 28px 28px",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.6s ease",
        overflowY: "auto",
      }}>

        {/* View 0: Lessons */}
        {viewIndex === 0 && (
          <div>
            <div style={{fontSize:15,fontWeight:700,color:"var(--text3)",marginBottom:16}}>
              📚 שיעורים מתוכננים להיום
              {todayLessons.length > 0 && <span style={{marginRight:8,color:accent,fontWeight:900}}>{todayLessons.length} שיעורים</span>}
            </div>
            {todayLessons.length === 0 ? (
              <div style={{textAlign:"center",color:"var(--text3)",fontSize:18,padding:"64px 0"}}>אין שיעורים מתוכננים להיום</div>
            ) : (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:14}}>
                {todayLessons.map((s,i) => (
                  <div key={i} style={{
                    background:"var(--surface)",
                    border:"1px solid var(--border)",
                    borderRight:`5px solid ${accent}`,
                    borderRadius:12,
                    padding:"16px 18px",
                  }}>
                    {/* Time */}
                    <div style={{fontWeight:900,fontSize:22,color:accent,marginBottom:6}}>
                      {s.startTime}–{s.endTime}
                    </div>
                    {/* Course */}
                    <div style={{fontWeight:800,fontSize:17,color:"var(--text)",marginBottom:4}}>
                      {s.courseName}
                    </div>
                    {/* Instructor */}
                    {s.instructorName && (
                      <div style={{fontSize:15,fontWeight:700,color:"var(--text2)",marginBottom:4}}>
                        👤 {s.instructorName}
                      </div>
                    )}
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:6}}>
                      {/* Track */}
                      {s.track && (
                        <span style={{fontSize:12,fontWeight:700,color:accent,background:`${accent}1a`,borderRadius:20,padding:"2px 10px",border:`1px solid ${accent}55`}}>
                          🎓 {s.track}
                        </span>
                      )}
                      {/* Studio */}
                      {s.studioId && (
                        <span style={{fontSize:12,fontWeight:700,color:"var(--text3)",background:"var(--surface2)",borderRadius:20,padding:"2px 10px",border:"1px solid var(--border)"}}>
                          📍 {studioName(s.studioId)}
                        </span>
                      )}
                    </div>
                    {/* Topic */}
                    {s.topic && (
                      <div style={{fontSize:12,color:"var(--text3)",marginTop:6}}>📖 {s.topic}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* View 1: Room bookings */}
        {viewIndex === 1 && (
          <div>
            <div style={{fontSize:15,fontWeight:700,color:"var(--text3)",marginBottom:16}}>
              🎙️ קביעות חדרים להיום
              {todayBookings.length > 0 && <span style={{marginRight:8,color:accent,fontWeight:900}}>{todayBookings.length} קביעות</span>}
            </div>
            {todayBookings.length === 0 ? (
              <div style={{textAlign:"center",color:"var(--text3)",fontSize:18,padding:"64px 0"}}>אין קביעות חדרים להיום</div>
            ) : (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:14}}>
                {todayBookings.map((b,i) => {
                  const kind   = getBookingKind(b);
                  const name   = kind === "lesson" ? (b.courseName||"שיעור") : kind === "team" ? (b.teamMemberName||"איש צוות") : (b.studentName||"סטודנט");
                  const color  = kind === "lesson" ? "#f5a623" : b.isNight ? "#2196f3" : "#2ecc71";
                  const time   = b.isNight ? "לילה" : `${b.startTime||""}–${b.endTime||""}`;
                  const icon   = kind === "lesson" ? "📽️" : kind === "team" ? "👥" : "👤";
                  return (
                    <div key={i} style={{
                      background:"var(--surface)",
                      border:"1px solid var(--border)",
                      borderRight:`5px solid ${color}`,
                      borderRadius:12,
                      padding:"14px 16px",
                    }}>
                      <div style={{fontWeight:900,fontSize:20,color:color,marginBottom:4}}>{time}</div>
                      <div style={{fontWeight:800,fontSize:16,color:"var(--text)",marginBottom:4}}>
                        {icon} {name}
                      </div>
                      <div style={{fontSize:13,color:"var(--text3)",fontWeight:600}}>
                        📍 {studioName(b.studioId)}
                      </div>
                      {b.notes && <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>💬 {b.notes}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div style={{
        textAlign:"center",
        padding:"10px 0",
        fontSize:11,
        color:"var(--text3)",
        borderTop:"1px solid var(--border)",
        background:"var(--surface)",
      }}>
        מתחלף אוטומטית כל {siteSettings.publicDisplayInterval || 18} שניות · {dateLabel()}
      </div>
    </div>
  );
}
