import { useState, useEffect, useCallback } from "react";
import { storageGet, storageSet } from "../utils.js";
import { Modal } from "./ui.jsx";

const HOURS = ["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00"];
const STATUS_COLORS = { ממתין:"var(--yellow)", מאושר:"var(--green)", נדחה:"var(--red)" };

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

export default function StudioBookingPage({ showToast, teamMembers=[], certifications={types:[],students:[]}, role="admin", currentUser=null }) {
  const [studios,   setStudios]   = useState([]);
  const [bookings,  setBookings]  = useState([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState("הכל");
  const [activeView, setActiveView] = useState("calendar");
  const [modal, setModal]   = useState(null);
  const [saving, setSaving] = useState(false);

  const weekDays = getWeekDays(weekOffset);

  // ── Load from Supabase ────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [s, b] = await Promise.all([
        storageGet("studios"),
        storageGet("studio_bookings"),
      ]);
      if (Array.isArray(s)) setStudios(s);
      if (Array.isArray(b)) setBookings(b);
    })();
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────
  const saveStudios  = useCallback(async (data) => { setStudios(data);  await storageSet("studios", data); }, []);
  const saveBookings = useCallback(async (data) => { setBookings(data); await storageSet("studio_bookings", data); }, []);

  const allStudents = [
    ...(certifications.students || []).map(s => typeof s==="string" ? s : s.name),
    ...(teamMembers || []).map(m => m.name || m),
  ].filter(Boolean).filter((v,i,a) => a.indexOf(v)===i);

  // ── Bookings for a cell ───────────────────────────────────────────────
  const cellBookings = (studioId, fullDate) =>
    bookings.filter(b => b.studioId===studioId && b.date===fullDate &&
      (statusFilter==="הכל" || b.status===statusFilter));

  // ── Add Studio ────────────────────────────────────────────────────────
  const handleAddStudio = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = fd.get("name")?.trim();
    const type = fd.get("type");
    if (!name) return;
    if (studios.some(s => s.name===name)) { showToast("error","אולפן בשם זה כבר קיים"); return; }
    const updated = [...studios, { id: Date.now(), name, type, image: fd.get("image")||"🎙️" }];
    await saveStudios(updated);
    showToast("success", `אולפן "${name}" נוסף`);
    setModal(null);
  };

  // ── Delete Studio ─────────────────────────────────────────────────────
  const deleteStudio = async (id) => {
    if (!confirm("למחוק אולפן זה וכל הזמנותיו?")) return;
    await saveStudios(studios.filter(s => s.id!==id));
    await saveBookings(bookings.filter(b => b.studioId!==id));
    showToast("success", "אולפן נמחק");
  };

  // ── Submit Booking ────────────────────────────────────────────────────
  const submitBooking = async (e) => {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.target);
    const studioId   = modal?.studioId;
    const date       = modal?.date;
    const startTime  = fd.get("startTime");
    const endTime    = fd.get("endTime");
    const studentName= fd.get("studentName")?.trim();
    const notes      = fd.get("notes")?.trim();
    if (!studioId || !date || !startTime || !endTime || !studentName) {
      showToast("error","נא למלא את כל השדות"); setSaving(false); return;
    }
    if (startTime >= endTime) { showToast("error","שעת סיום חייבת להיות אחרי שעת התחלה"); setSaving(false); return; }
    const overlap = bookings.some(b =>
      b.studioId===studioId && b.date===date && b.status!=="נדחה" &&
      !(endTime <= b.startTime || startTime >= b.endTime)
    );
    if (overlap) { showToast("error","⚠️ קיימת הזמנה חופפת בשעות אלו"); setSaving(false); return; }
    const newBooking = {
      id: Date.now(), studioId, date, startTime, endTime,
      studentName, notes,
      status: role==="admin" ? "מאושר" : "ממתין",
      createdAt: new Date().toISOString()
    };
    await saveBookings([...bookings, newBooking]);
    showToast("success", role==="admin" ? "✅ הזמנה נוספה ואושרה" : "✅ הבקשה נשלחה לאישור");
    setModal(null); setSaving(false);
  };

  // ── Change Status ─────────────────────────────────────────────────────
  const changeStatus = async (id, status) => {
    const updated = bookings.map(b => b.id===id ? {...b, status} : b);
    await saveBookings(updated);
    showToast("success", `סטטוס שונה ל-${status}`);
    setModal(m => m?.booking ? {...m, booking:{...m.booking, status}} : m);
  };

  // ── Delete Booking ────────────────────────────────────────────────────
  const deleteBooking = async (id) => {
    if (!confirm("למחוק הזמנה זו?")) return;
    await saveBookings(bookings.filter(b => b.id!==id));
    showToast("success","הזמנה נמחקה");
    setModal(null);
  };

  // ── Filtered bookings for list view ──────────────────────────────────
  const filteredBookings = bookings
    .filter(b => statusFilter==="הכל" || b.status===statusFilter)
    .sort((a,b) => b.createdAt?.localeCompare(a.createdAt||"")||0);

  const pendingCount = bookings.filter(b=>b.status==="ממתין").length;

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
            {["הכל","ממתין","מאושר","נדחה"].map(s=><option key={s}>{s}</option>)}
          </select>
          {role==="admin" && activeView==="manage" &&
            <button className="btn btn-primary" onClick={()=>setModal({type:"addStudio"})}>➕ אולפן חדש</button>
          }
        </div>
      </div>

      {/* ── CALENDAR VIEW ── */}
      {activeView==="calendar" && (
        <div>
          {/* Week navigation */}
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12,justifyContent:"center"}}>
            <button className="btn btn-secondary btn-sm" onClick={()=>setWeekOffset(w=>w-1)}>→ שבוע קודם</button>
            <button className="btn btn-secondary btn-sm" onClick={()=>setWeekOffset(0)}>היום</button>
            <button className="btn btn-secondary btn-sm" onClick={()=>setWeekOffset(w=>w+1)}>← שבוע הבא</button>
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
                      <th key={d.fullDate} style={{...thStyle,background:d.isToday?"rgba(var(--accent-rgb,241,196,15),0.15)":undefined}}>
                        <div style={{fontWeight:700}}>{d.name}</div>
                        <div style={{fontSize:11,color:"var(--text3)"}}>{d.date}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {studios.map(studio=>(
                    <tr key={studio.id}>
                      <td style={{...tdStyle,fontWeight:700,fontSize:13,background:"var(--surface2)"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:20}}>{studio.image}</span>
                          <span>{studio.name}</span>
                        </div>
                        <div style={{fontSize:10,color:"var(--text3)",marginTop:2}}>{studio.type==="sound"?"סאונד":studio.type==="photo"?"צילום":"כללי"}</div>
                      </td>
                      {weekDays.map(day=>{
                        const cells = cellBookings(studio.id, day.fullDate);
                        return (
                          <td key={day.fullDate} style={{...tdStyle,verticalAlign:"top",cursor:"pointer",minHeight:60,background:day.isToday?"rgba(var(--accent-rgb,241,196,15),0.05)":undefined}}
                            onClick={()=>setModal({type:"addBooking", studioId:studio.id, studioName:studio.name, date:day.fullDate, dayName:day.name})}>
                            {cells.map(b=>(
                              <div key={b.id}
                                style={{background:STATUS_COLORS[b.status]+"22",border:`1px solid ${STATUS_COLORS[b.status]}`,borderRadius:6,padding:"3px 6px",marginBottom:3,fontSize:11,cursor:"pointer"}}
                                onClick={e=>{e.stopPropagation();setModal({type:"viewBooking",booking:b,studioName:studio.name});}}>
                                <div style={{fontWeight:700,color:STATUS_COLORS[b.status]}}>{b.startTime}–{b.endTime}</div>
                                <div style={{color:"var(--text2)"}}>{b.studentName}</div>
                              </div>
                            ))}
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
          {filteredBookings.length===0
            ? <div style={{textAlign:"center",padding:48,color:"var(--text3)"}}>אין הזמנות להצגה</div>
            : filteredBookings.map(b=>{
              const studio = studios.find(s=>s.id===b.studioId);
              return (
                <div key={b.id} style={{background:"var(--surface2)",borderRadius:10,padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",cursor:"pointer",border:`1px solid ${STATUS_COLORS[b.status]}44`}}
                  onClick={()=>setModal({type:"viewBooking",booking:b,studioName:studio?.name||"?"})}>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:14}}>{b.studentName}</div>
                    <div style={{fontSize:12,color:"var(--text3)"}}>{studio?.image} {studio?.name||"?"} · {b.date} · {b.startTime}–{b.endTime}</div>
                    {b.notes && <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>📝 {b.notes}</div>}
                  </div>
                  <span style={{background:STATUS_COLORS[b.status]+"22",color:STATUS_COLORS[b.status],borderRadius:20,padding:"3px 12px",fontSize:12,fontWeight:700,border:`1px solid ${STATUS_COLORS[b.status]}55`}}>{b.status}</span>
                </div>
              );
            })
          }
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
                    <span style={{fontSize:28}}>{s.image}</span>
                    <div>
                      <div style={{fontWeight:700}}>{s.name}</div>
                      <div style={{fontSize:12,color:"var(--text3)"}}>{s.type==="sound"?"🎙️ סאונד":s.type==="photo"?"📷 צילום":"🌐 כללי"} · {count} הזמנות</div>
                    </div>
                  </div>
                  <button className="btn btn-secondary btn-sm" style={{color:"var(--red)",borderColor:"var(--red)"}} onClick={()=>deleteStudio(s.id)}>🗑️ מחק</button>
                </div>
              );
            })
          }
        </div>
      )}

      {/* ── MODAL: Add Studio ── */}
      {modal?.type==="addStudio" && (
        <Modal title="➕ הוסף אולפן" onClose={()=>setModal(null)}
          footer={<><button className="btn btn-secondary" onClick={()=>setModal(null)}>ביטול</button><button form="addStudioForm" type="submit" className="btn btn-primary">שמור</button></>}>
          <form id="addStudioForm" onSubmit={handleAddStudio} style={{display:"flex",flexDirection:"column",gap:12}}>
            <label style={labelStyle}>שם האולפן *
              <input name="name" className="form-input" placeholder='לדוגמה: אולפן A' required/>
            </label>
            <label style={labelStyle}>סוג
              <select name="type" className="form-input">
                <option value="sound">🎙️ סאונד</option>
                <option value="photo">📷 צילום</option>
                <option value="general">🌐 כללי</option>
              </select>
            </label>
            <label style={labelStyle}>אייקון / אימוג'י
              <input name="image" className="form-input" placeholder="🎙️" maxLength={4}/>
            </label>
          </form>
        </Modal>
      )}

      {/* ── MODAL: Add Booking ── */}
      {modal?.type==="addBooking" && (
        <Modal title={`📅 הזמנת ${modal.studioName} — ${modal.dayName} ${modal.date}`} onClose={()=>setModal(null)}
          footer={<><button className="btn btn-secondary" onClick={()=>setModal(null)}>ביטול</button><button form="addBookingForm" type="submit" className="btn btn-primary" disabled={saving}>{saving?"שומר...":"✅ שמור הזמנה"}</button></>}>
          <form id="addBookingForm" onSubmit={submitBooking} style={{display:"flex",flexDirection:"column",gap:12}}>
            <label style={labelStyle}>שם הסטודנט *
              {allStudents.length > 0
                ? <select name="studentName" className="form-input" required defaultValue="">
                    <option value="" disabled>בחר סטודנט...</option>
                    {allStudents.map(s=><option key={s} value={s}>{s}</option>)}
                    <option value="__manual__">אחר (הקלד ידנית)</option>
                  </select>
                : <input name="studentName" className="form-input" placeholder="שם מלא" required/>
              }
            </label>
            <div style={{display:"flex",gap:8}}>
              <label style={{...labelStyle,flex:1}}>שעת התחלה *
                <select name="startTime" className="form-input" required defaultValue="09:00">
                  {HOURS.map(h=><option key={h}>{h}</option>)}
                </select>
              </label>
              <label style={{...labelStyle,flex:1}}>שעת סיום *
                <select name="endTime" className="form-input" required defaultValue="12:00">
                  {HOURS.map(h=><option key={h}>{h}</option>)}
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
                  <button className="btn btn-secondary btn-sm" style={{color:"var(--red)"}} onClick={()=>changeStatus(modal.booking.id,"נדחה")}>❌ דחה</button>
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
                <Row label="סטטוס"  value={<span style={{color:STATUS_COLORS[b.status],fontWeight:700}}>{b.status}</span>}/>
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
