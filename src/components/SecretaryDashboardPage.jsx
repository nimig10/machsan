import { useState, useMemo, useEffect } from "react";

const NIGHT_COLOR   = "#2196f3";
const STUDENT_COLOR = "#2ecc71";
const LESSON_COLOR  = "#f5a623";

function fmtDate(d) {
  return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,"0")}-${d.getDate().toString().padStart(2,"0")}`;
}
function todayStr() { return fmtDate(new Date()); }

function displayDate(dateStr) {
  if (!dateStr) return "";
  const [,m,d] = dateStr.split("-").map(Number);
  return `${(d||1).toString().padStart(2,"0")}/${(m||1).toString().padStart(2,"0")}`;
}

const HE_DAYS = ["א׳","ב׳","ג׳","ד׳","ה׳","ו׳","ש׳"];

function getBookingKind(b) {
  if (b.bookingKind === "lesson" || b.lesson_auto || (b.lesson_id != null && b.lesson_id !== "")) return "lesson";
  if (b.bookingKind === "team" || b.teamMemberId || b.teamMemberName) return "team";
  return "student";
}

function bookingColor(b) {
  const kind = getBookingKind(b);
  if (kind === "lesson") return LESSON_COLOR;
  if (b.isNight) return NIGHT_COLOR;
  return STUDENT_COLOR;
}

function bookingLabel(b) {
  const kind = getBookingKind(b);
  if (kind === "lesson") return b.courseName || "שיעור";
  return b.studentName || "סטודנט";
}

export function SecretaryDashboardPage({ certifications, studios, studioBookings, lessons }) {
  const today = todayStr();
  const [weekOffset, setWeekOffset] = useState(0);
  const [mobileDayStart, setMobileDayStart] = useState(0);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 769);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 769);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const MOBILE_DAYS = 3;

  // ── Students & tracks ──────────────────────────────────────────────
  const students = certifications?.students || [];
  const trackMap = useMemo(() => {
    const map = {};
    students.forEach(s => {
      const t = (s.track || "ללא מסלול").trim();
      map[t] = (map[t] || 0) + 1;
    });
    return map;
  }, [students]);
  const tracks = Object.entries(trackMap).sort((a, b) => b[1] - a[1]);

  // ── Today's lessons ────────────────────────────────────────────────
  const todayLessons = useMemo(() => {
    const rows = [];
    (lessons || []).forEach(lesson => {
      (lesson.schedule || []).forEach(session => {
        if (session.date === today) {
          rows.push({
            startTime: session.startTime || "",
            endTime:   session.endTime   || "",
            topic:     session.topic     || "",
            courseName: lesson.courseName || lesson.name || "",
            studioId:  session.studioId || lesson.studioId || "",
          });
        }
      });
    });
    return rows.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [lessons, today]);

  // ── Week days ──────────────────────────────────────────────────────
  const weekDays = useMemo(() => {
    const days = [];
    const now = new Date();
    const sun = new Date(now);
    sun.setDate(now.getDate() - now.getDay() + weekOffset * 7);
    for (let i = 0; i < 7; i++) {
      const d = new Date(sun);
      d.setDate(sun.getDate() + i);
      const dateStr = fmtDate(d);
      days.push({
        date: dateStr,
        label: `${HE_DAYS[d.getDay()]} ${displayDate(dateStr)}`,
        isToday: dateStr === today,
      });
    }
    return days;
  }, [weekOffset, today]);

  // ── Reset mobileDayStart when week changes ─────────────────────────
  useEffect(() => {
    const todayIdx = weekDays.findIndex(d => d.isToday);
    if (todayIdx >= 0) {
      setMobileDayStart(Math.min(todayIdx, weekDays.length - MOBILE_DAYS));
    } else {
      setMobileDayStart(0);
    }
  }, [weekOffset]);

  const visibleDays = isMobile ? weekDays.slice(mobileDayStart, mobileDayStart + MOBILE_DAYS) : weekDays;

  const weekLabel = useMemo(() => {
    if (!weekDays.length) return "";
    return `${displayDate(weekDays[0].date)} – ${displayDate(weekDays[6].date)}`;
  }, [weekDays]);

  const mobileDayLabel = useMemo(() => {
    if (!visibleDays.length) return "";
    return `${visibleDays[0].label} — ${visibleDays[visibleDays.length - 1].label}`;
  }, [visibleDays]);

  // ── Bookings map (by studioId_date) ───────────────────────────────
  const bMap = useMemo(() => {
    const m = {};
    (studioBookings || []).forEach(b => {
      const k = `${b.studioId}_${b.date}`;
      if (!m[k]) m[k] = [];
      m[k].push(b);
    });
    return m;
  }, [studioBookings]);

  const studioName = id => (studios || []).find(s => s.id === id)?.name || id;

  // ── Upcoming lessons (next 7 days) ────────────────────────────────
  const upcoming = useMemo(() => {
    const now = new Date(); now.setHours(0,0,0,0);
    const limit = new Date(now); limit.setDate(now.getDate() + 7);
    const rows = [];
    (lessons || []).forEach(lesson => {
      (lesson.schedule || []).forEach(session => {
        if (!session.date) return;
        const [y,m,d] = session.date.split("-").map(Number);
        const sd = new Date(y, m-1, d);
        if (sd > now && sd <= limit) {
          rows.push({
            date: session.date,
            startTime: session.startTime || "",
            endTime:   session.endTime   || "",
            courseName: lesson.courseName || lesson.name || "",
            studioId: session.studioId || lesson.studioId || "",
          });
        }
      });
    });
    return rows.sort((a,b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)).slice(0, 8);
  }, [lessons]);

  // ── Mobile day navigation ─────────────────────────────────────────
  const goMobilePrev = () => {
    if (mobileDayStart > 0) {
      setMobileDayStart(s => s - MOBILE_DAYS);
    } else {
      setWeekOffset(w => w - 1);
      setMobileDayStart(7 - MOBILE_DAYS);
    }
  };
  const goMobileNext = () => {
    if (mobileDayStart + MOBILE_DAYS < 7) {
      setMobileDayStart(s => s + MOBILE_DAYS);
    } else {
      setWeekOffset(w => w + 1);
      setMobileDayStart(0);
    }
  };

  return (
    <div className="page">

      {/* ── Stats ── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:20}}>
        {[
          { icon:"👨‍🎓", value: students.length,    label:"סטודנטים" },
          { icon:"🎓",   value: tracks.length,       label:"מסלולים" },
          { icon:"🎙️",  value:(studios||[]).length, label:"חדרים" },
          { icon:"📽️",  value: todayLessons.length, label:"שיעורים היום" },
        ].map(s => (
          <div key={s.label} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"14px 16px",textAlign:"center"}}>
            <div style={{fontSize:26,marginBottom:4}}>{s.icon}</div>
            <div style={{fontSize:28,fontWeight:900,color:"var(--accent)"}}>{s.value}</div>
            <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Tracks + Today ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:16,marginBottom:20}}>

        {/* Tracks */}
        <div className="card">
          <div className="card-header"><div className="card-title">🎓 מסלולי לימוד</div></div>
          <div style={{padding:"0 16px 12px"}}>
            {tracks.length === 0
              ? <div style={{color:"var(--text3)",fontSize:13,padding:"12px 0"}}>אין נתונים</div>
              : tracks.map(([track, count]) => (
                <div key={track} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:"1px solid var(--border)"}}>
                  <span style={{fontSize:13,fontWeight:600}}>{track}</span>
                  <span style={{background:"var(--accent)",color:"#000",borderRadius:20,padding:"2px 11px",fontSize:12,fontWeight:900}}>{count}</span>
                </div>
              ))}
          </div>
        </div>

        {/* Today's lessons */}
        <div className="card">
          <div className="card-header"><div className="card-title">📽️ לוז היום</div></div>
          <div style={{padding:"0 16px 12px"}}>
            {todayLessons.length === 0
              ? <div style={{color:"var(--text3)",fontSize:13,padding:"12px 0"}}>אין שיעורים היום</div>
              : todayLessons.map((s, i) => (
                <div key={i} style={{padding:"9px 0",borderBottom:"1px solid var(--border)"}}>
                  <div style={{display:"flex",gap:10,alignItems:"center"}}>
                    <span style={{fontSize:12,fontWeight:800,color:LESSON_COLOR,whiteSpace:"nowrap"}}>{s.startTime}–{s.endTime}</span>
                    <span style={{fontSize:13,fontWeight:700,flex:1}}>{s.courseName}</span>
                  </div>
                  {(s.topic || s.studioId) && (
                    <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>
                      {s.topic && <span>{s.topic}</span>}
                      {s.topic && s.studioId && <span> · </span>}
                      {s.studioId && <span>{studioName(s.studioId)}</span>}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* ── Weekly studio grid ── */}
      <div className="card" style={{marginBottom:20}}>
        <div className="card-header" style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <div className="card-title">🎙️ לוח חדרים שבועי — {weekLabel}</div>
          {!isMobile && (
            <div style={{display:"flex",gap:6}}>
              <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset(w => w - 1)}>›</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset(0)}>השבוע</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset(w => w + 1)}>‹</button>
            </div>
          )}
        </div>

        {/* Mobile day nav */}
        {isMobile && (
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 16px",borderBottom:"1px solid var(--border)",gap:8}}>
            <button className="btn btn-secondary btn-sm" onClick={goMobilePrev}>›</button>
            <span style={{fontSize:12,fontWeight:700,color:"var(--text)",textAlign:"center",flex:1}}>{mobileDayLabel}</span>
            <button className="btn btn-secondary btn-sm" onClick={goMobileNext}>‹</button>
            <button className="btn btn-secondary btn-sm" style={{fontSize:11}} onClick={() => { setWeekOffset(0); setMobileDayStart(0); }}>היום</button>
          </div>
        )}

        <div style={{padding:"0 16px 16px",overflowX:"auto",maxWidth:"100%"}} className="no-swipe-nav">
          <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0,fontSize:12,tableLayout:"fixed",minWidth: isMobile ? undefined : 520}}>
            <thead>
              <tr>
                <th style={{padding: isMobile ? "8px 6px" : "8px 10px",textAlign:"right",fontWeight:700,color:"var(--text2)",borderBottom:"2px solid var(--border)",whiteSpace:"nowrap",width: isMobile ? 60 : 90}}>חדר</th>
                {visibleDays.map(d => (
                  <th key={d.date} style={{
                    padding: isMobile ? "7px 4px" : "7px 6px",
                    textAlign:"center",fontWeight:700,
                    color: d.isToday ? "#000" : "var(--text2)",
                    background: d.isToday ? "var(--accent)" : "var(--surface2)",
                    borderBottom:"2px solid var(--border)",whiteSpace:"nowrap",
                    fontSize: isMobile ? 10 : 11,
                  }}>
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(studios || []).length === 0 && (
                <tr><td colSpan={visibleDays.length + 1} style={{textAlign:"center",color:"var(--text3)",padding:20,fontSize:13}}>אין חדרים מוגדרים</td></tr>
              )}
              {(studios || []).map(studio => (
                <tr key={studio.id}>
                  <td style={{padding: isMobile ? "6px 4px" : "6px 10px",fontWeight:700,borderBottom:"1px solid var(--border)",whiteSpace:"nowrap",fontSize: isMobile ? 10 : 12}}>{studio.name}</td>
                  {visibleDays.map(d => {
                    const bookings = bMap[`${studio.id}_${d.date}`] || [];
                    return (
                      <td key={d.date} style={{
                        padding:"3px 3px",borderBottom:"1px solid var(--border)",
                        verticalAlign:"top",
                        background: d.isToday ? "rgba(245,166,35,0.04)" : "transparent",
                      }}>
                        {bookings.length === 0 && <div style={{height:22}}/>}
                        {bookings.map((b, i) => {
                          const col = bookingColor(b);
                          const label = bookingLabel(b);
                          const time = b.isNight ? "לילה" : `${b.startTime||""}–${b.endTime||""}`;
                          return (
                            <div key={i} title={`${label} · ${time}`} style={{
                              background:`${col}1a`,
                              border:`1px solid ${col}88`,
                              borderRadius:4,
                              padding:"3px 5px",
                              fontSize: isMobile ? 9 : 10,
                              marginBottom:2,
                              color: col,
                              fontWeight:700,
                              overflow:"hidden",
                            }}>
                              <div style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{label}</div>
                              <div style={{fontSize: isMobile ? 8 : 9,opacity:0.85,whiteSpace:"nowrap"}}>{time}</div>
                            </div>
                          );
                        })}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {/* Legend */}
          <div style={{display:"flex",gap:12,marginTop:10,fontSize:11,color:"var(--text3)",flexWrap:"wrap"}}>
            <span><span style={{display:"inline-block",width:10,height:10,background:`${STUDENT_COLOR}33`,border:`1px solid ${STUDENT_COLOR}`,borderRadius:2,marginLeft:4}}/>סטודנט יום</span>
            <span><span style={{display:"inline-block",width:10,height:10,background:`${NIGHT_COLOR}33`,border:`1px solid ${NIGHT_COLOR}`,borderRadius:2,marginLeft:4}}/>סטודנט לילה</span>
            <span><span style={{display:"inline-block",width:10,height:10,background:`${LESSON_COLOR}33`,border:`1px solid ${LESSON_COLOR}`,borderRadius:2,marginLeft:4}}/>שיעור</span>
          </div>
        </div>
      </div>

      {/* ── Upcoming lessons ── */}
      {upcoming.length > 0 && (
        <div className="card">
          <div className="card-header"><div className="card-title">📅 שיעורים קרובים (7 ימים)</div></div>
          <div style={{padding:"0 16px 12px"}}>
            {upcoming.map((s, i) => (
              <div key={i} style={{display:"flex",gap:isMobile ? 8 : 12,alignItems:"center",padding:"9px 0",borderBottom:"1px solid var(--border)",flexWrap: isMobile ? "wrap" : "nowrap"}}>
                <span style={{fontSize:12,fontWeight:800,color:"var(--text3)",whiteSpace:"nowrap",minWidth:44}}>{displayDate(s.date)}</span>
                <span style={{fontSize:12,color:LESSON_COLOR,fontWeight:700,whiteSpace:"nowrap"}}>{s.startTime}–{s.endTime}</span>
                <span style={{fontSize:13,fontWeight:700,flex:1}}>{s.courseName}</span>
                {s.studioId && <span style={{fontSize:11,color:"var(--text3)",whiteSpace:"nowrap"}}>{studioName(s.studioId)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
