import { useState, useEffect, useCallback } from "react";
import { storageGet, storageSet, lsGet } from "../utils.js";
import { Modal } from "./ui.jsx";

const DAY_HOURS = ["09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00","21:00"];
const NIGHT_HOURS = ["21:00","22:00","23:00","00:00","01:00","02:00","03:00","04:00","05:00","06:00","07:00","08:00"];
const STATUS_COLORS = { "ממתין":"var(--yellow)", "מאושר":"var(--green)" };
const NIGHT_COLOR = "#2196f3";
const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
const HE_DAYS_SHORT = ["א׳","ב׳","ג׳","ד׳","ה׳","ו׳","ש׳"];

function getWeekDays(offset=0) {
  const today = new Date();
  today.setDate(today.getDate() + offset * 7);
  const day = today.getDay();
  const sunday = new Date(today); sunday.setDate(today.getDate() - day);
  return Array.from({length:7}, (_,i) => {
    const d = new Date(sunday); d.setDate(sunday.getDate()+i);
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth()+1).padStart(2,"0");
    const dd   = String(d.getDate()).padStart(2,"0");
    return {
      name: ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][i],
      date: dd,
      fullDate: `${yyyy}-${mm}-${dd}`,
      isToday: dd === String(new Date().getDate()).padStart(2,"0") &&
               mm === String(new Date().getMonth()+1).padStart(2,"0") &&
               yyyy === new Date().getFullYear()
    };
  });
}

export default function StudioBookingPage({ showToast, teamMembers=[], certifications={types:[],students:[]}, role="admin", currentUser=null, studios: studiosProp, setStudios: setStudiosProp, bookings: bookingsProp, setBookings: setBookingsProp }) {
  const [localStudios,   setLocalStudios]   = useState(() => lsGet("studios") || []);
  const [localBookings,  setLocalBookings]  = useState(() => lsGet("studio_bookings") || []);
  const studios = studiosProp ?? localStudios;
  const setStudios = setStudiosProp ?? setLocalStudios;
  const bookings = bookingsProp ?? localBookings;
  const setBookings = setBookingsProp ?? setLocalBookings;

  const [weekOffset, setWeekOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState("הכל");
  const [todayOnly,   setTodayOnly]   = useState(false);
  const [sortMode,    setSortMode]    = useState("urgency");
  const [activeView, setActiveView] = useState("calendar");
  const [modal, setModal]   = useState(null);
  const [saving, setSaving] = useState(false);
  // ── Add-booking form live state (for night cert warning) ────────────
  const [formStudent, setFormStudent] = useState("");
  const [formIsNight, setFormIsNight] = useState(false);

  const weekDays = getWeekDays(weekOffset);

  // ── Mini Calendar State ─────────────────────────────────────────────
  const [miniMonth, setMiniMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })();
  const weekMiddle = new Date();
  weekMiddle.setDate(weekMiddle.getDate() + weekOffset * 7);
  const weekMonthLabel = HE_MONTHS[weekMiddle.getMonth()] + " " + weekMiddle.getFullYear();

  const miniDays = (() => {
    const { year, month } = miniMonth;
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  })();

  const jumpToDate = (day) => {
    const target = new Date(miniMonth.year, miniMonth.month, day);
    const now = new Date(); now.setHours(0,0,0,0);
    const diff = Math.round((target - now) / (1000*60*60*24));
    const targetSunOffset = target.getDay();
    const nowSunOffset = now.getDay();
    const targetWeekStart = diff - targetSunOffset + nowSunOffset;
    setWeekOffset(Math.round(targetWeekStart / 7));
  };

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

  // ── Migration ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!studios.length) return;
    const needsMigration = studios.some(st => st.image?.startsWith("data:"));
    if (!needsMigration) return;
    (async () => {
      const migrated = await Promise.all(studios.map(async (st) => {
        if (!st.image?.startsWith("data:")) return st;
        try {
          const res = await fetch("/api/upload-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: st.image }),
          });
          const json = await res.json();
          if (res.ok && json.url) return { ...st, image: json.url };
        } catch (e) { console.error("Migration failed for", st.name, e); }
        return st;
      }));
      setStudios(migrated);
      await storageSet("studios", migrated);
      console.log("✅ Studio images migrated to Cloudinary");
    })();
  }, [studios.length]); // eslint-disable-line

  // ── Helpers ───────────────────────────────────────────────────────────
  const saveStudios  = useCallback(async (data) => { setStudios(data);  await storageSet("studios", data); }, []);
  const saveBookings = useCallback(async (data) => { setBookings(data); await storageSet("studio_bookings", data); }, []);

  const allStudents = [
    ...(certifications.students || []).map(s => typeof s==="string" ? s : s.name),
    ...(teamMembers || []).map(m => m.name || m),
  ].filter(Boolean).filter((v,i,a) => a.indexOf(v)===i);

  const studioCertTypes = (certifications?.types || []).filter(t => t.category === "studio" && t.id !== "cert_night_studio");

  const getBookingStudents = (studioId) => {
    const studio = studios.find(s => s.id === studioId);
    if (!studio?.studioCertId) return allStudents;
    const cStudents = certifications?.students || [];
    return allStudents.filter(name => {
      const rec = cStudents.find(s => s.name === name);
      return rec && (rec.certs || {})[studio.studioCertId] === "עבר";
    });
  };

  const bookingStudents = getBookingStudents(modal?.studioId);
  const bookingRequiredCert = (() => {
    const st = studios.find(s => s.id === modal?.studioId);
    return st?.studioCertId ? studioCertTypes.find(t => t.id === st.studioCertId) : null;
  })();

  // ── Bookings for a cell (night bookings show only on their original date) ──
  const cellBookings = (studioId, fullDate) => {
    return bookings.filter(b => b.studioId===studioId && b.date===fullDate &&
      (statusFilter==="הכל" || b.status===statusFilter))
      .sort((a,b) => (a.startTime||"").localeCompare(b.startTime||""));
  };

  // ── Studio Image Upload ─────────────────────────────────────────────
  const [studioImage, setStudioImage] = useState("");
  const [imgUploading, setImgUploading] = useState(false);

  const uploadToCloudinary = async (file) => {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = ev => resolve(ev.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const res = await fetch("/api/upload-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: dataUrl }),
    });
    const json = await res.json();
    if (!res.ok || !json.url) throw new Error(json.error || "שגיאת שרת");
    return json.url;
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImgUploading(true);
    try {
      const url = await uploadToCloudinary(file);
      setStudioImage(url);
      showToast("success", "✅ תמונה הועלתה");
    } catch (err) {
      console.error("Image upload failed:", err);
      showToast("error", "שגיאה בהעלאת התמונה — נסה שנית");
    } finally {
      setImgUploading(false);
    }
  };

  const handleAddStudio = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = fd.get("name")?.trim();
    if (!name) return;
    if (studios.some(s => s.name===name)) { showToast("error","אולפן בשם זה כבר קיים"); return; }
    const requiresApproval = fd.get("requiresApproval") === "on";
    const studioCertId = fd.get("studioCertId") || undefined;
    const updated = [...studios, { id: Date.now(), name, studioCertId, image: studioImage || fd.get("emoji")||"🎙️", requiresApproval }];
    await saveStudios(updated);
    showToast("success", `אולפן "${name}" נוסף`);
    setStudioImage("");
    setModal(null);
  };

  // ── Delete Studio ─────────────────────────────────────────────────────
  const deleteStudio = async (id) => {
    if (!confirm("למחוק אולפן זה וכל הזמנותיו?")) return;
    await saveStudios(studios.filter(s => s.id!==id));
    await saveBookings(bookings.filter(b => b.studioId!==id));
    showToast("success", "אולפן נמחק");
  };

  // ── Edit Studio ─────────────────────────────────────────────────────
  const [editImage, setEditImage] = useState("");
  const handleEditImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImgUploading(true);
    try {
      const url = await uploadToCloudinary(file);
      setEditImage(url);
      showToast("success", "✅ תמונה הועלתה");
    } catch (err) {
      console.error("Image upload failed:", err);
      showToast("error", "שגיאה בהעלאת התמונה — נסה שנית");
    } finally {
      setImgUploading(false);
    }
  };
  const handleEditStudio = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = fd.get("name")?.trim();
    if (!name) return;
    const studioCertId = fd.get("studioCertId") || undefined;
    const image = editImage || fd.get("emoji")?.trim() || modal.studio.image;
    const requiresApproval = fd.get("requiresApproval") === "on";
    const updated = studios.map(s => s.id===modal.studio.id ? {...s, name, studioCertId, image, requiresApproval} : s);
    await saveStudios(updated);
    showToast("success", `אולפן "${name}" עודכן`);
    setEditImage("");
    setModal(null);
  };
  const openEditStudio = (studio) => {
    setEditImage("");
    setModal({type:"editStudio", studio});
  };

  // ── Night cert helper ─────────────────────────────────────────────────
  const hasNightCert = (studentName) => {
    if (!studentName) return false;
    const certTypes = certifications?.types || [];
    const certStudents = certifications?.students || [];
    const nightType = certTypes.find(t => t.id === "cert_night_studio");
    if (!nightType) return true; // no night cert type defined — allow all
    const rec = certStudents.find(s => s.name === studentName);
    return rec && (rec.certs || {})[nightType.id] === "עבר";
  };

  // ── Send studio email to student ──────────────────────────────────────
  const sendStudioEmail = async (type, booking) => {
    const studio = studios.find(s => s.id === booking.studioId);
    const studioName = studio?.name || "האולפן";
    const studentRecord = (certifications?.students || []).find(s => s.name === booking.studentName);
    const email = studentRecord?.email;
    if (!email) return; // אין מייל — לא שולחים
    try {
      await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to:           email,
          type,
          student_name: booking.studentName,
          project_name: studioName,
          borrow_date:  booking.date,
          borrow_time:  booking.startTime,
          return_time:  booking.endTime,
        }),
      });
    } catch(e) { console.error("Studio email error:", e); }
  };

  // ── Submit Booking ────────────────────────────────────────────────────
  const submitBooking = async (e) => {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.target);
    const studioId   = modal?.studioId;
    const date       = modal?.date;
    const isNight    = fd.get("isNight") === "on";
    const startTime  = fd.get("startTime");
    const endTime    = fd.get("endTime");
    const studentName= fd.get("studentName")?.trim();
    const notes      = fd.get("notes")?.trim();
    if (!studioId || !date || !startTime || !endTime || !studentName) {
      showToast("error","נא למלא את כל השדות"); setSaving(false); return;
    }
    // Night certification check
    if (isNight && !hasNightCert(studentName)) {
      showToast("error", `⛔ ${studentName} לא עבר/ה הסמכת לילה לאולפנים — לא ניתן להשלים את הקביעה`);
      setSaving(false); return;
    }
    // Studio certification check
    const bookingStudioObj = studios.find(s => s.id === studioId);
    if (bookingStudioObj?.studioCertId) {
      const certStudentsList = certifications?.students || [];
      const studentRec = certStudentsList.find(s => s.name === studentName);
      if (!studentRec || (studentRec.certs||{})[bookingStudioObj.studioCertId] !== "עבר") {
        const certTypeName = (certifications?.types || []).find(t => t.id === bookingStudioObj.studioCertId)?.name || "אולפן";
        showToast("error", `⛔ ${studentName} לא עבר/ה הסמכת "${certTypeName}" — לא ניתן לקבוע`);
        setSaving(false); return;
      }
    }
    // For night bookings, endTime can be less than startTime (crosses midnight)
    if (!isNight && startTime >= endTime) { showToast("error","שעת סיום חייבת להיות אחרי שעת התחלה"); setSaving(false); return; }
    // Overlap check
    const overlap = bookings.some(b =>
      b.studioId===studioId && b.date===date && b.status!=="נדחה" &&
      !(endTime <= b.startTime || startTime >= b.endTime)
    );
    if (!isNight && overlap) { showToast("error","⚠️ קיימת הזמנה חופפת בשעות אלו"); setSaving(false); return; }
    const newBooking = {
      id: Date.now(), studioId, date, startTime, endTime,
      studentName, notes, isNight: isNight || false,
      status: role==="admin" ? "מאושר" : "ממתין",
      createdAt: new Date().toISOString()
    };
    await saveBookings([...bookings, newBooking]);
    showToast("success", role==="admin" ? "✅ הזמנה נוספה ואושרה" : "✅ הבקשה נשלחה לאישור");
    setModal(null); setSaving(false);
  };

  // ── Change Status ─────────────────────────────────────────────────────
  const changeStatus = async (id, newStatus) => {
    const booking = bookings.find(b => b.id === id);
    const updated = bookings.map(b => b.id===id ? {...b, status:newStatus} : b);
    await saveBookings(updated);
    showToast("success", `סטטוס שונה ל-${newStatus}`);
    setModal(m => m?.booking ? {...m, booking:{...m.booking, status:newStatus}} : m);
    if (newStatus === "מאושר" && booking) await sendStudioEmail("studio_approved", booking);
  };

  // ── Delete Booking ────────────────────────────────────────────────────
  const deleteBooking = async (id) => {
    if (!confirm("למחוק הזמנה זו?")) return;
    const booking = bookings.find(b => b.id === id);
    await saveBookings(bookings.filter(b => b.id!==id));
    showToast("success","הבקשה נמחקה");
    setModal(null);
    if (booking?.status === "ממתין") await sendStudioEmail("studio_deleted", booking);
  };

  // ── Delete booking from list row (inline button) ──────────────────────
  const deleteBookingInList = async (e, id) => {
    e.stopPropagation();
    if (!confirm("למחוק בקשה זו?")) return;
    const booking = bookings.find(b => b.id === id);
    await saveBookings(bookings.filter(b => b.id !== id));
    showToast("success","הבקשה נמחקה");
    if (booking?.status === "ממתין") await sendStudioEmail("studio_deleted", booking);
  };

  // ── Filtered bookings for list view ──────────────────────────────────
  const filteredBookings = bookings
    .filter(b => statusFilter==="הכל" || b.status===statusFilter)
    .filter(b => !todayOnly || b.date===todayStr)
    .sort((a,b) => {
      if (sortMode==="urgency") {
        // קירבה לזמן הנוכחי — הקרוב ביותר לעכשיו עולה ראשון
        const now = Date.now();
        const aMs = new Date(`${a.date}T${(a.startTime||"00:00")}:00`).getTime();
        const bMs = new Date(`${b.date}T${(b.startTime||"00:00")}:00`).getTime();
        return Math.abs(aMs - now) - Math.abs(bMs - now);
      } else {
        // זמן קבלת הבקשה — הישנה ביותר עולה ראשון
        return new Date(a.createdAt||0) - new Date(b.createdAt||0);
      }
    });

  const pendingCount = bookings.filter(b=>b.status==="ממתין").length;

  // ── Booking color helper ──────────────────────────────────────────────
  const bookingColor = (b) => b.isNight ? NIGHT_COLOR : (STATUS_COLORS[b.status] || "var(--text3)");

  // ── Studio display helper ─────────────────────────────────────────────
  const StudioImg = ({ studio, size=32 }) => {
    if (!studio) return null;
    if (studio.image?.startsWith("http") || studio.image?.startsWith("data:"))
      return <img src={studio.image} alt={studio.name} style={{width:size,height:size,borderRadius:6,objectFit:"cover"}}/>;
    return <span style={{fontSize:size*0.65}}>{studio.image||"🎙️"}</span>;
  };

  return (
    <div className="page" style={{direction:"rtl"}}>
      {/* Top bar */}
      <div className="flex-between mb-4" style={{flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button className={`btn ${activeView==="calendar"?"btn-primary":"btn-secondary"}`} onClick={()=>setActiveView("calendar")}>📅 לוח שנה</button>
          <button className={`btn ${activeView==="list"?"btn-primary":"btn-secondary"}`} onClick={()=>setActiveView("list")}>
            📋 כל ההזמנות {pendingCount>0&&<span style={{background:"var(--accent)",color:"#000",borderRadius:"50%",padding:"1px 6px",fontSize:11,marginRight:4}}>{pendingCount}</span>}
          </button>
          {role==="admin" && <button className={`btn ${activeView==="manage"?"btn-primary":"btn-secondary"}`} onClick={()=>setActiveView("manage")}>🏠 ניהול אולפנים</button>}
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <select className="form-input" style={{width:"auto",fontSize:13}} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
            {["הכל","ממתין","מאושר"].map(s=><option key={s}>{s}</option>)}
          </select>
          {role==="admin" && activeView==="manage" &&
            <button className="btn btn-primary" onClick={()=>setModal({type:"addStudio"})}>➕ אולפן חדש</button>
          }
        </div>
      </div>

      {/* ── CALENDAR VIEW ── */}
      {activeView==="calendar" && (
        <div>
          {/* Month/Year header */}
          <div style={{textAlign:"center",marginBottom:16}}>
            <div style={{fontSize:22,fontWeight:900,color:"var(--accent)"}}>{weekMonthLabel}</div>
          </div>

          {/* Layout: mini calendar (right) + week nav (left) */}
          <div style={{display:"flex",gap:20,marginBottom:20,flexWrap:"wrap",alignItems:"flex-start"}}>
            {/* Mini calendar — first in DOM = right side in RTL */}
            <div style={{minWidth:220,maxWidth:260,background:"var(--surface2)",borderRadius:"var(--r)",border:"1px solid var(--border)",padding:12}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <button onClick={()=>setMiniMonth(m=>m.month===0?{year:m.year-1,month:11}:{year:m.year,month:m.month-1})}
                  style={{background:"none",border:"none",color:"var(--text2)",cursor:"pointer",fontSize:16,padding:"2px 6px"}}>→</button>
                <span style={{fontWeight:800,fontSize:14,color:"var(--text)"}}>{HE_MONTHS[miniMonth.month]} {miniMonth.year}</span>
                <button onClick={()=>setMiniMonth(m=>m.month===11?{year:m.year+1,month:0}:{year:m.year,month:m.month+1})}
                  style={{background:"none",border:"none",color:"var(--text2)",cursor:"pointer",fontSize:16,padding:"2px 6px"}}>←</button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:1,textAlign:"center"}}>
                {HE_DAYS_SHORT.map(d=><div key={d} style={{fontSize:10,fontWeight:700,color:"var(--text3)",padding:"4px 0"}}>{d}</div>)}
                {miniDays.map((day,i)=>(
                  <div key={i}
                    onClick={()=>day && jumpToDate(day)}
                    style={{
                      fontSize:12,fontWeight:isInCurrentWeek(day)?800:500,padding:"5px 0",cursor:day?"pointer":"default",
                      borderRadius:"50%",
                      background: isTodayMini(day)?"var(--accent)":isInCurrentWeek(day)?"rgba(245,166,35,0.15)":"transparent",
                      color: isTodayMini(day)?"#000":isInCurrentWeek(day)?"var(--accent)":day?"var(--text)":"transparent",
                      transition:"background 0.15s"
                    }}>
                    {day || ""}
                  </div>
                ))}
              </div>
              <button onClick={()=>{ setWeekOffset(0); const d=new Date(); setMiniMonth({year:d.getFullYear(),month:d.getMonth()}); }}
                style={{width:"100%",marginTop:8,padding:"6px 0",borderRadius:6,border:"1px solid var(--accent)",background:"transparent",color:"var(--accent)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                📅 היום
              </button>
            </div>

            {/* Week navigation */}
            <div style={{flex:1,minWidth:280,display:"flex",flexDirection:"column",gap:10,justifyContent:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,justifyContent:"center"}}>
                <button className="btn btn-secondary btn-sm" onClick={()=>setWeekOffset(w=>w-1)}>→ שבוע קודם</button>
                <button className="btn btn-secondary btn-sm" onClick={()=>setWeekOffset(0)}>היום</button>
                <button className="btn btn-secondary btn-sm" onClick={()=>setWeekOffset(w=>w+1)}>← שבוע הבא</button>
              </div>
              <div style={{fontSize:13,color:"var(--text3)",textAlign:"center"}}>
                {weekDays[0].date}/{String(new Date(weekDays[0].fullDate).getMonth()+1).padStart(2,"0")} — {weekDays[6].date}/{String(new Date(weekDays[6].fullDate).getMonth()+1).padStart(2,"0")}
              </div>
            </div>
          </div>

          {studios.length === 0 ? (
            <div style={{textAlign:"center",padding:48,color:"var(--text3)"}}>
              <div style={{fontSize:48,marginBottom:12}}>🎙️</div>
              <div style={{fontWeight:700,fontSize:16,marginBottom:8}}>אין אולפנים עדיין</div>
              {role==="admin" && <button className="btn btn-primary" onClick={()=>{setActiveView("manage");setModal({type:"addStudio"})}}>➕ הוסף אולפן ראשון</button>}
            </div>
          ) : (
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",minWidth:600}}>
                <thead>
                  <tr>
                    <th style={{...thStyle,width:100}}>אולפן</th>
                    {weekDays.map(d=>(
                      <th key={d.fullDate} style={{...thStyle,background:d.isToday?"rgba(245,166,35,0.15)":undefined}}>
                        <div style={{fontWeight:700}}>{d.name}</div>
                        <div style={{fontSize:11,color:d.isToday?"var(--accent)":"var(--text3)"}}>{d.date}/{String(new Date(d.fullDate).getMonth()+1).padStart(2,"0")}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {studios.map(studio=>(
                    <tr key={studio.id}>
                      <td style={{...tdStyle,fontWeight:700,fontSize:13,background:"var(--surface2)"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <StudioImg studio={studio} size={32}/>
                          <span>{studio.name}</span>
                        </div>
                        <div style={{fontSize:10,color:"var(--text3)",marginTop:2}}>
                          {(()=>{ const ct=studioCertTypes.find(t=>t.id===studio.studioCertId); return ct?ct.name:studio.type==="sound"?"סאונד":studio.type==="photo"?"צילום":"כללי"; })()}
                          {studio.requiresApproval && <span style={{color:NIGHT_COLOR,marginRight:4}}>🔒</span>}
                        </div>
                      </td>
                      {weekDays.map(day=>{
                        const cells = cellBookings(studio.id, day.fullDate);
                        return (
                          <td key={day.fullDate} style={{...tdStyle,verticalAlign:"top",cursor:"pointer",minHeight:60,background:day.isToday?"rgba(245,166,35,0.05)":undefined}}
                            onClick={()=>setModal({type:"addBooking", studioId:studio.id, studioName:studio.name, date:day.fullDate, dayName:day.name})}>
                            {cells.map(b=>{
                              const color = bookingColor(b);
                              return (
                                <div key={b.id}
                                  style={{background:color+"22",border:`1px solid ${color}`,borderRadius:6,padding:"3px 6px",marginBottom:3,fontSize:11,cursor:"pointer"}}
                                  onClick={e=>{e.stopPropagation();setModal({type:"viewBooking",booking:b,studioName:studio.name});}}>
                                  <div style={{fontWeight:700,color}}>{b.isNight&&"🌙 "}{b.startTime}–{b.endTime}</div>
                                  <div style={{color:"var(--text2)"}}>{b.studentName}</div>
                                </div>
                              );
                            })}
                            {cells.length===0 && <div style={{color:"var(--text3)",fontSize:11,textAlign:"center",paddingTop:12}}>+ הוסף</div>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── LIST VIEW ── */}
      {activeView==="list" && (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {/* ── כלי פילטור ומיון ── */}
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",padding:"10px 14px",background:"var(--surface2)",borderRadius:10,marginBottom:4}}>
            <label style={{display:"flex",alignItems:"center",gap:6,fontSize:13,cursor:"pointer",fontWeight:600}}>
              <input type="checkbox" checked={todayOnly} onChange={e=>setTodayOnly(e.target.checked)} style={{accentColor:"var(--accent)",width:15,height:15}}/>
              📅 היום בלבד
            </label>
            <div style={{display:"flex",alignItems:"center",gap:6,marginRight:"auto"}}>
              <span style={{fontSize:12,color:"var(--text3)"}}>מיון:</span>
              <button onClick={()=>setSortMode("urgency")}
                style={{padding:"3px 10px",borderRadius:6,border:`1px solid ${sortMode==="urgency"?"var(--accent)":"var(--border)"}`,background:sortMode==="urgency"?"var(--accent)22":"transparent",color:sortMode==="urgency"?"var(--accent)":"var(--text3)",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                ⚡ דחיפות
              </button>
              <button onClick={()=>setSortMode("request_time")}
                style={{padding:"3px 10px",borderRadius:6,border:`1px solid ${sortMode==="request_time"?"var(--accent)":"var(--border)"}`,background:sortMode==="request_time"?"var(--accent)22":"transparent",color:sortMode==="request_time"?"var(--accent)":"var(--text3)",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                🕐 זמן קבלה
              </button>
            </div>
          </div>

          {(() => {
            const pending      = filteredBookings.filter(b => b.status==="ממתין");
            const approvedDay  = filteredBookings.filter(b => b.status==="מאושר" && !b.isNight);
            const approvedNight= filteredBookings.filter(b => b.status==="מאושר" && b.isNight);

            const SectionHeader = ({label, color, count, icon}) => count===0 ? null : (
              <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",background:color+"12",borderRadius:10,border:`1px solid ${color}30`,borderRight:`4px solid ${color}`,marginTop:12}}>
                <span style={{fontSize:16}}>{icon}</span>
                <span style={{fontWeight:800,fontSize:14,color}}>{label}</span>
                <span style={{background:color,color:"#fff",borderRadius:20,padding:"1px 9px",fontSize:12,fontWeight:800,marginRight:"auto"}}>{count}</span>
              </div>
            );

            const BookingRow = (b) => {
              const studio = studios.find(s=>s.id===b.studioId);
              const color  = bookingColor(b);
              return (
                <div key={b.id}
                  style={{background:"var(--surface2)",borderRadius:10,padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",cursor:"pointer",border:`1px solid ${color}33`,borderRight:`4px solid ${color}`}}
                  onClick={()=>setModal({type:"viewBooking",booking:b,studioName:studio?.name||"?"})}>
                  <div style={{flex:1,minWidth:200}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                      {studio && <StudioImg studio={studio} size={24}/>}
                      <span style={{fontWeight:800,fontSize:14}}>{studio?.name||"?"}</span>
                      {b.isNight && <span style={{background:NIGHT_COLOR+"22",color:NIGHT_COLOR,borderRadius:12,padding:"1px 8px",fontSize:10,fontWeight:700}}>🌙 לילה</span>}
                    </div>
                    <div style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{b.studentName}</div>
                    <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>📅 {b.date} · ⏰ {b.startTime}–{b.endTime}</div>
                    {b.notes && <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>📝 {b.notes}</div>}
                  </div>
                  <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                    {b.status==="ממתין" && role==="admin" && <>
                      <button className="btn btn-sm" style={{background:"var(--green)",color:"#fff",border:"none",padding:"4px 10px",borderRadius:6,fontSize:12,fontWeight:700,cursor:"pointer"}}
                        onClick={e=>{e.stopPropagation();changeStatus(b.id,"מאושר")}}>✅ אשר</button>
                      <button className="btn btn-sm" style={{background:"var(--red)",color:"#fff",border:"none",padding:"4px 10px",borderRadius:6,fontSize:12,fontWeight:700,cursor:"pointer"}}
                        onClick={e=>deleteBookingInList(e,b.id)}>🗑️ מחק</button>
                    </>}
                    <span style={{background:color+"22",color,borderRadius:20,padding:"3px 12px",fontSize:12,fontWeight:700,border:`1px solid ${color}55`}}>{b.status}</span>
                  </div>
                </div>
              );
            };

            if (filteredBookings.length===0)
              return <div style={{textAlign:"center",padding:48,color:"var(--text3)"}}>אין הזמנות להצגה</div>;

            return (
              <>
                <SectionHeader label="ממתין לאישור" color="var(--yellow)" count={pending.length} icon="⏳"/>
                {pending.map(BookingRow)}

                <SectionHeader label="מאושר — יום" color="var(--green)" count={approvedDay.length} icon="✅"/>
                {approvedDay.map(BookingRow)}

                <SectionHeader label="לילה מאושר" color={NIGHT_COLOR} count={approvedNight.length} icon="🌙"/>
                {approvedNight.map(BookingRow)}
              </>
            );
          })()}

        </div>
      )}

      {/* ── MANAGE STUDIOS VIEW ── */}
      {activeView==="manage" && role==="admin" && (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {studios.length===0
            ? <div style={{textAlign:"center",padding:48,color:"var(--text3)"}}>אין אולפנים עדיין</div>
            : studios.map(s=>{
              const count = bookings.filter(b=>b.studioId===s.id).length;
              return (
                <div key={s.id} style={{background:"var(--surface2)",borderRadius:10,padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    <StudioImg studio={s} size={44}/>
                    <div>
                      <div style={{fontWeight:700}}>{s.name}</div>
                      <div style={{fontSize:12,color:"var(--text3)"}}>{(()=>{ const ct=studioCertTypes.find(t=>t.id===s.studioCertId); return ct?`🎓 ${ct.name}`:s.type==="sound"?"🎙️ סאונד":s.type==="photo"?"📷 צילום":"🌐 כללי"; })()} · {count} הזמנות{s.requiresApproval ? " · 🔒 באישור מיוחד" : " · ✅ הזמנה חופשית"}</div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <button className="btn btn-secondary btn-sm" onClick={()=>openEditStudio(s)}>✏️ עריכה</button>
                    <button className="btn btn-secondary btn-sm" style={{color:"var(--red)",borderColor:"var(--red)"}} onClick={()=>deleteStudio(s.id)}>🗑️ מחק</button>
                  </div>
                </div>
              );
            })
          }
        </div>
      )}

      {/* ── MODAL: Add Studio ── */}
      {modal?.type==="addStudio" && (
        <Modal title="➕ הוסף אולפן" onClose={()=>setModal(null)}
          footer={<><button className="btn btn-secondary" onClick={()=>setModal(null)}>ביטול</button><button form="addStudioForm" type="submit" className="btn btn-primary" disabled={imgUploading}>{imgUploading?"מעלה תמונה...":"שמור"}</button></>}>
          <form id="addStudioForm" onSubmit={handleAddStudio} style={{display:"flex",flexDirection:"column",gap:12}}>
            <label style={labelStyle}>שם האולפן *
              <input name="name" className="form-input" placeholder='לדוגמה: אולפן A' required/>
            </label>
            <label style={labelStyle}>הסמכת אולפן
              <select name="studioCertId" className="form-input" defaultValue="">
                <option value="">ללא הסמכה</option>
                {studioCertTypes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label style={labelStyle}>תמונה
              <input type="file" accept="image/*" onChange={handleImageUpload} style={{fontSize:13}} disabled={imgUploading}/>
              {imgUploading && <div style={{fontSize:12,color:"var(--accent)",marginTop:4}}>⏳ מעלה תמונה...</div>}
              {studioImage && <img src={studioImage} alt="תצוגה מקדימה" style={{width:80,height:80,objectFit:"cover",borderRadius:8,marginTop:4}}/>}
            </label>
            <label style={labelStyle}>או אימוג'י (אם אין תמונה)
              <input name="emoji" className="form-input" placeholder="🎙️" maxLength={4}/>
            </label>
            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,fontWeight:600,color:"var(--text2)",cursor:"pointer",padding:"8px 0"}}>
              <input type="checkbox" name="requiresApproval" style={{width:18,height:18,accentColor:"var(--accent)"}}/>
              🔒 רק באישור מיוחד (דורש אישור איש צוות)
            </label>
          </form>
        </Modal>
      )}

      {/* ── MODAL: Edit Studio ── */}
      {modal?.type==="editStudio" && (
        <Modal title="✏️ עריכת אולפן" onClose={()=>{setEditImage("");setModal(null);}}
          footer={<><button className="btn btn-secondary" onClick={()=>{setEditImage("");setModal(null);}}>ביטול</button><button form="editStudioForm" type="submit" className="btn btn-primary" disabled={imgUploading}>{imgUploading?"מעלה תמונה...":"💾 שמור"}</button></>}>
          <form id="editStudioForm" onSubmit={handleEditStudio} style={{display:"flex",flexDirection:"column",gap:12}}>
            <label style={labelStyle}>שם האולפן *
              <input name="name" className="form-input" defaultValue={modal.studio.name} required/>
            </label>
            <label style={labelStyle}>הסמכת אולפן
              <select name="studioCertId" className="form-input" defaultValue={modal.studio.studioCertId||""}>
                <option value="">ללא הסמכה</option>
                {studioCertTypes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <div style={{fontSize:13,fontWeight:600,color:"var(--text2)"}}>תמונה נוכחית:
              <div style={{marginTop:4}}>
                {(editImage || modal.studio.image)?.startsWith("http")
                  ? <img src={editImage || modal.studio.image} alt="תמונה" style={{width:80,height:80,objectFit:"cover",borderRadius:8}}/>
                  : <span style={{fontSize:32}}>{modal.studio.image||"🎙️"}</span>
                }
              </div>
            </div>
            <label style={labelStyle}>החלף תמונה
              <input type="file" accept="image/*" onChange={handleEditImageUpload} style={{fontSize:13}} disabled={imgUploading}/>
              {imgUploading && <div style={{fontSize:12,color:"var(--accent)",marginTop:4}}>⏳ מעלה תמונה...</div>}
            </label>
            <label style={labelStyle}>או אימוג'י (מחליף תמונה)
              <input name="emoji" className="form-input" placeholder="🎙️" maxLength={4}/>
            </label>
            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,fontWeight:600,color:"var(--text2)",cursor:"pointer",padding:"8px 0"}}>
              <input type="checkbox" name="requiresApproval" defaultChecked={modal.studio.requiresApproval} style={{width:18,height:18,accentColor:"var(--accent)"}}/>
              🔒 רק באישור מיוחד (דורש אישור איש צוות)
            </label>
          </form>
        </Modal>
      )}

      {/* ── MODAL: Add Booking ── */}
      {modal?.type==="addBooking" && (
        <Modal title={`📅 הזמנת ${modal.studioName} — ${modal.dayName} ${modal.date}`} onClose={()=>{ setFormStudent(""); setFormIsNight(false); setModal(null); }}
          footer={<><button className="btn btn-secondary" onClick={()=>{ setFormStudent(""); setFormIsNight(false); setModal(null); }}>ביטול</button><button form="addBookingForm" type="submit" className="btn btn-primary" disabled={saving}>{saving?"שומר...":"✅ שמור הזמנה"}</button></>}>
          <form id="addBookingForm" onSubmit={submitBooking} style={{display:"flex",flexDirection:"column",gap:12}}>
            {bookingRequiredCert && <div style={{background:"rgba(52,152,219,0.08)",border:"1px solid rgba(52,152,219,0.2)",borderRadius:8,padding:"8px 12px",fontSize:12,color:"var(--blue)",fontWeight:600}}>🎓 נדרשת הסמכה: {bookingRequiredCert.name}</div>}
            <label style={labelStyle}>שם הסטודנט *
              {bookingStudents.length > 0
                ? <select name="studentName" className="form-input" required defaultValue=""
                    onChange={e => setFormStudent(e.target.value)}>
                    <option value="" disabled>בחר סטודנט...</option>
                    {bookingStudents.map(s=><option key={s} value={s}>{s}</option>)}
                    <option value="__manual__">אחר (הקלד ידנית)</option>
                  </select>
                : allStudents.length > 0
                  ? <div style={{fontSize:13,color:"var(--red)",padding:8,background:"rgba(231,76,60,0.06)",borderRadius:8,border:"1px solid rgba(231,76,60,0.2)"}}>⚠️ אין סטודנטים מוסמכים לאולפן זה. הגדר הסמכות ברובריקת "הסמכות".</div>
                  : <input name="studentName" className="form-input" placeholder="שם מלא" required
                      onChange={e => setFormStudent(e.target.value)}/>
              }
            </label>
            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,fontWeight:600,color:NIGHT_COLOR,cursor:"pointer",padding:"4px 0"}}>
              <input type="checkbox" name="isNight" style={{width:18,height:18,accentColor:NIGHT_COLOR}}
                onChange={e => setFormIsNight(e.target.checked)}/>
              🌙 הזמנת לילה (21:00–08:00)
            </label>
            {formIsNight && formStudent && formStudent!=="__manual__" && !hasNightCert(formStudent) && (
              <div style={{background:"rgba(231,76,60,0.12)",border:"1px solid var(--red)",borderRadius:8,padding:"10px 14px",fontSize:13,color:"var(--red)",fontWeight:700,display:"flex",alignItems:"center",gap:8}}>
                ⛔ {formStudent} לא עבר/ה הסמכת לילה לאולפנים — לא ניתן להשלים את הקביעה
              </div>
            )}
            <div style={{display:"flex",gap:8}}>
              <label style={{...labelStyle,flex:1}}>שעת התחלה *
                <select name="startTime" className="form-input" required defaultValue="09:00">
                  {DAY_HOURS.map(h=><option key={h}>{h}</option>)}
                  <optgroup label="🌙 שעות לילה">
                    {NIGHT_HOURS.filter(h=>h!=="21:00").map(h=><option key={h}>{h}</option>)}
                  </optgroup>
                </select>
              </label>
              <label style={{...labelStyle,flex:1}}>שעת סיום *
                <select name="endTime" className="form-input" required defaultValue="12:00">
                  {DAY_HOURS.map(h=><option key={h}>{h}</option>)}
                  <optgroup label="🌙 שעות לילה">
                    {NIGHT_HOURS.filter(h=>h!=="21:00").map(h=><option key={h}>{h}</option>)}
                  </optgroup>
                </select>
              </label>
            </div>
            <label style={labelStyle}>הערות
              <textarea name="notes" className="form-input" rows={2} placeholder="תיאור הפרויקט, ציוד נדרש..."/>
            </label>
            {role!=="admin" && <div style={{fontSize:12,color:"var(--text3)"}}>⏳ הבקשה תישלח לאישור המנהל</div>}
          </form>
        </Modal>
      )}

      {/* ── MODAL: View Booking ── */}
      {modal?.type==="viewBooking" && (
        <Modal title={`📋 הזמנה — ${modal.studioName}`} onClose={()=>setModal(null)}
          footer={
            <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"space-between",width:"100%"}}>
              <button className="btn btn-secondary btn-sm" style={{color:"var(--red)",borderColor:"var(--red)"}} onClick={()=>deleteBooking(modal.booking.id)}>🗑️ מחק</button>
              <div style={{display:"flex",gap:8}}>
                {role==="admin" && modal.booking.status==="ממתין" && <>
                  <button className="btn btn-primary btn-sm" onClick={()=>changeStatus(modal.booking.id,"מאושר")}>✅ אשר</button>
                </>}
                <button className="btn btn-secondary btn-sm" onClick={()=>setModal(null)}>סגור</button>
              </div>
            </div>
          }>
          {(() => {
            const b = modal.booking;
            return (
              <div style={{display:"flex",flexDirection:"column",gap:10,direction:"rtl"}}>
                <Row label="סטודנט" value={b.studentName}/>
                <Row label="תאריך"  value={b.date}/>
                <Row label="שעות"   value={`${b.startTime} – ${b.endTime}`}/>
                <Row label="סוג"    value={b.isNight ? <span style={{color:NIGHT_COLOR,fontWeight:700}}>🌙 הזמנת לילה</span> : "יום"}/>
                <Row label="סטטוס"  value={<span style={{color:bookingColor(b),fontWeight:700}}>{b.status}</span>}/>
                {b.notes && <Row label="הערות" value={b.notes}/>}
              </div>
            );
          })()}
        </Modal>
      )}
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────
const thStyle = { padding:"8px 10px", background:"var(--surface2)", fontSize:12, fontWeight:700, textAlign:"center", border:"1px solid var(--border)" };
const tdStyle  = { padding:"6px 8px", border:"1px solid var(--border)", textAlign:"center" };
const labelStyle = { display:"flex", flexDirection:"column", gap:4, fontSize:13, fontWeight:600, color:"var(--text2)" };
function Row({ label, value }) {
  return (
    <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
      <span style={{color:"var(--text3)",fontSize:13,minWidth:60}}>{label}:</span>
      <span style={{fontWeight:600,fontSize:13}}>{value}</span>
    </div>
  );
}
