// LessonsPage.jsx — course & lesson schedule management
import { useState } from "react";
import { storageSet, formatDate, formatLocalDateInput, parseLocalDate, today } from "../utils.js";

export function LessonsPage({ lessons=[], setLessons, studios=[], kits=[], showToast, reservations=[], setReservations, equipment=[] }) {
  const [mode, setMode] = useState(null); // null | "add" | "edit"
  const [editTarget, setEditTarget] = useState(null);
  const [search, setSearch] = useState("");

  const lessonKits = kits.filter(k=>k.kitType==="lesson");

  const save = async (lesson) => {
    const updated = editTarget
      ? lessons.map(l=>l.id===editTarget.id?lesson:l)
      : [...lessons, lesson];
    setLessons(updated);
    await storageSet("lessons", updated);
    showToast("success", `קורס "${lesson.name}" ${editTarget?"עודכן":"נוצר"}`);
    setMode(null);
    setEditTarget(null);
  };

  const del = async (id, name) => {
    if(!window.confirm(`למחוק את הקורס "${name}"?`)) return;
    const updated = lessons.filter(l=>l.id!==id);
    setLessons(updated);
    await storageSet("lessons", updated);
    showToast("success", `קורס "${name}" נמחק`);
  };

  const filtered = lessons.filter(l=>!search || l.name?.includes(search) || l.instructorName?.includes(search));

  return (
    <div className="page">
      {mode ? (
        <LessonForm
          initial={editTarget}
          onSave={save}
          onCancel={()=>{setMode(null);setEditTarget(null);}}
          studios={studios}
          lessonKits={lessonKits}
          equipment={equipment}
          reservations={reservations}
          setReservations={setReservations}
          kits={kits}
          showToast={showToast}
        />
      ) : (
        <>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:16,flexWrap:"wrap"}}>
            <div className="search-bar" style={{flex:1,minWidth:180}}><span>🔍</span>
              <input placeholder="חיפוש קורס או מרצה..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
            <button className="btn btn-primary" onClick={()=>{setMode("add");setEditTarget(null);}}>➕ קורס חדש</button>
          </div>

          {filtered.length===0
            ? <div className="empty-state"><div className="emoji">📽️</div><div>אין קורסים עדיין</div><div style={{fontSize:13,color:"var(--text3)"}}>לחץ "➕ קורס חדש" כדי להתחיל</div></div>
            : <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {filtered.map(l=>{
                  const studio = studios.find(s=>s.id===l.studioId);
                  const kit = kits.find(k=>k.id===l.kitId);
                  const upcoming = (l.schedule||[]).filter(s=>s.date>=today()).length;
                  return (
                    <div key={l.id} style={{background:"var(--surface2)",borderRadius:10,padding:"14px 16px",border:"1px solid var(--border)",borderRight:"4px solid #9b59b6"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,flexWrap:"wrap"}}>
                        <div style={{flex:1,minWidth:200}}>
                          <div style={{fontWeight:800,fontSize:16,marginBottom:4}}>{l.name}</div>
                          {l.instructorName && <div style={{fontSize:13,color:"var(--text2)"}}>👨‍🏫 {l.instructorName}{l.instructorPhone?` · ${l.instructorPhone}`:""}</div>}
                          {l.instructorEmail && <div style={{fontSize:12,color:"var(--text3)"}}>✉️ {l.instructorEmail}</div>}
                          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
                            <span style={{background:"rgba(155,89,182,0.12)",color:"#9b59b6",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>📅 {(l.schedule||[]).length} שיעורים</span>
                            {upcoming>0 && <span style={{background:"rgba(46,204,113,0.12)",color:"var(--green)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>🟢 {upcoming} קרובים</span>}
                            {studio && <span style={{background:"rgba(52,152,219,0.12)",color:"var(--blue)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>🎙️ {studio.name}</span>}
                            {kit && <span style={{background:"rgba(245,166,35,0.12)",color:"var(--accent)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>🎒 {kit.name}</span>}
                          </div>
                          {l.description && <div style={{fontSize:12,color:"var(--text3)",marginTop:6}}>📝 {l.description}</div>}
                        </div>
                        <div style={{display:"flex",gap:6}}>
                          <button className="btn btn-secondary btn-sm" onClick={()=>{setEditTarget(l);setMode("edit");}}>✏️ עריכה</button>
                          <button className="btn btn-secondary btn-sm" style={{color:"var(--red)",borderColor:"var(--red)"}} onClick={()=>del(l.id,l.name)}>🗑️ מחק</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
          }
        </>
      )}
    </div>
  );
}

// ── Lesson/Course Form ────────────────────────────────────────────────────────
function LessonForm({ initial, onSave, onCancel, studios, lessonKits, equipment, reservations, setReservations, kits, showToast }) {
  const [name, setName]                       = useState(initial?.name||"");
  const [instructorName, setInstructorName]   = useState(initial?.instructorName||"");
  const [instructorPhone, setInstructorPhone] = useState(initial?.instructorPhone||"");
  const [instructorEmail, setInstructorEmail] = useState(initial?.instructorEmail||"");
  const [description, setDescription]         = useState(initial?.description||"");
  const [studioId, setStudioId]               = useState(initial?.studioId||"");
  const [kitId, setKitId]                     = useState(initial?.kitId||"");
  const [schedule, setSchedule]               = useState(initial?.schedule||[]);
  const [scheduleMode, setScheduleMode]       = useState("manual");
  const [saving, setSaving]                   = useState(false);
  const [xlImporting, setXlImporting]         = useState(false);
  const [localMsg, setLocalMsg]               = useState(null);
  const [teacherMessage, setTeacherMessage]   = useState("");
  const [teacherEmailSending, setTeacherEmailSending] = useState(false);

  // Manual schedule builder
  const [manStartDate, setManStartDate] = useState("");
  const [manStartTime, setManStartTime] = useState("10:00");
  const [manEndTime, setManEndTime]     = useState("13:00");
  const [manCount, setManCount]         = useState(1);

  const LESSON_TIMES = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30",
    "13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30",
    "17:00","17:30","18:00","18:30","19:00","19:30","20:00","20:30","21:00","21:30","22:00"];

  const buildAndAppendSchedule = () => {
    if(!manStartDate) { setLocalMsg({type:"error",text:"יש לבחור תאריך"}); return; }
    const count = Math.max(1, Math.min(52, Number(manCount)||1));
    const sessions = [];
    let d = parseLocalDate(manStartDate);
    for(let i=0;i<count;i++) {
      sessions.push({ date: formatLocalDateInput(d), startTime: manStartTime, endTime: manEndTime });
      d.setDate(d.getDate()+7);
    }
    setSchedule(prev => [...prev, ...sessions]);
    setLocalMsg({type:"success",text:`נוספו ${sessions.length} שיעורים`});
  };

  const appendLessonFromExisting = () => {
    if(!schedule.length) return;
    const firstLesson = schedule[0];
    const lastLesson = schedule[schedule.length-1];
    const nextDateObj = parseLocalDate(lastLesson.date || today());
    nextDateObj.setDate(nextDateObj.getDate()+7);
    setSchedule(prev=>[...prev, {
      date: formatLocalDateInput(nextDateObj),
      startTime: firstLesson.startTime||"09:00",
      endTime: firstLesson.endTime||"12:00",
    }]);
  };

  // XL import for schedule
  const importScheduleXL = async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    e.target.value = "";
    setXlImporting(true);
    try {
      const processRows = (rows) => {
        if(!rows.length) { setLocalMsg({type:"error",text:"קובץ ריק"}); return; }
        const headers = rows[0].map(h=>String(h||"").trim().replace(/[\uFEFF]/g,"").toLowerCase());
        const dateIdx  = headers.findIndex(h=>h.includes("תאריך")||h.includes("date"));
        const startIdx = headers.findIndex(h=>h.includes("התחלה")||h.includes("start")||h.includes("שעת התחלה"));
        const endIdx   = headers.findIndex(h=>h.includes("סיום")||h.includes("end")||h.includes("שעת סיום"));
        const courseIdx= headers.findIndex(h=>h.includes("קורס")||h.includes("course")||h.includes("שם"));
        if(dateIdx===-1) { setLocalMsg({type:"error",text:'לא נמצאה עמודת "תאריך"'}); setXlImporting(false); return; }
        if(courseIdx>=0 && !name.trim()) {
          const firstCourseName = String(rows[1]?.[courseIdx]||"").trim();
          if(firstCourseName) setName(firstCourseName);
        }
        const sessions = [];
        for(let i=1;i<rows.length;i++) {
          const row = rows[i];
          let dateVal = String(row[dateIdx]||"").trim();
          if(!dateVal) continue;
          if(/^\d{5}$/.test(dateVal)) {
            const d = new Date(Math.round((Number(dateVal)-25569)*86400000));
            dateVal = formatLocalDateInput(d);
          } else {
            const parts = dateVal.includes("/")?dateVal.split("/"):dateVal.split("-");
            if(parts.length===3) {
              if(parts[0].length===4) dateVal=`${parts[0]}-${parts[1].padStart(2,"0")}-${parts[2].padStart(2,"0")}`;
              else dateVal=`${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}`;
            }
          }
          sessions.push({
            date: dateVal,
            startTime: startIdx>=0?String(row[startIdx]||"09:00").trim():"09:00",
            endTime: endIdx>=0?String(row[endIdx]||"12:00").trim():"12:00",
          });
        }
        setSchedule(prev=>[...prev,...sessions]);
        setLocalMsg({type:"success",text:`יובאו ${sessions.length} שיעורים`});
        setXlImporting(false);
      };

      if(/\.xlsx?$/i.test(file.name)) {
        if(!window.XLSX) {
          await new Promise((res,rej)=>{
            const s=document.createElement("script");
            s.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
            s.onload=res; s.onerror=rej;
            document.head.appendChild(s);
          });
        }
        const buf = await file.arrayBuffer();
        const wb = window.XLSX.read(buf,{type:"array"});
        const ws = wb.Sheets[wb.SheetNames[0]];
        processRows(window.XLSX.utils.sheet_to_json(ws,{header:1,defval:""}));
      } else {
        const reader = new FileReader();
        reader.onload = ev => {
          const lines = ev.target.result.split(/\r?\n/).filter(l=>l.trim());
          const sep = lines[0]?.includes("\t")?"\t":",";
          processRows(lines.map(l=>l.split(sep).map(c=>c.trim().replace(/^"|"$/g,""))));
        };
        reader.readAsText(file,"UTF-8");
      }
    } catch(err) {
      console.error("XL import error",err);
      setLocalMsg({type:"error",text:"שגיאה בייבוא הקובץ"});
      setXlImporting(false);
    }
  };

  const sendTeacherEmail = async () => {
    const recipient = String(instructorEmail||"").trim();
    if(!recipient) { setLocalMsg({type:"error",text:"יש להזין מייל למרצה"}); return; }
    const message = String(teacherMessage||"").trim();
    if(!message) { setLocalMsg({type:"error",text:"יש למלא נוסח הודעה"}); return; }
    setTeacherEmailSending(true);
    try {
      const scheduleList = (schedule||[]).map((s,i)=>
        `<div style="margin-bottom:6px;color:#c7cedf">שיעור ${i+1}: ${formatDate(s.date)} ${s.startTime||""}${s.endTime?`–${s.endTime}`:""}</div>`
      ).join("");
      await fetch("/api/send-email", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          to: recipient,
          type: "lesson_kit_ready",
          student_name: instructorName.trim()||name.trim()||"מורה",
          recipient_name: instructorName.trim()||name.trim()||"",
          lesson_kit_name: name.trim(),
          custom_message: message,
          items_list: "",
          lesson_schedule: scheduleList,
        }),
      });
      setLocalMsg({type:"success",text:`המייל נשלח אל ${recipient}`});
    } catch(err) {
      console.error("email error",err);
      setLocalMsg({type:"error",text:"שגיאה בשליחת המייל"});
    } finally {
      setTeacherEmailSending(false);
    }
  };

  const handleSave = async () => {
    if(!name.trim()) { setLocalMsg({type:"error",text:"חובה למלא שם קורס"}); return; }
    let finalSchedule = [...schedule];
    if(scheduleMode==="manual" && manStartDate && finalSchedule.length===0) {
      const count = Math.max(1,Math.min(52,Number(manCount)||1));
      let d = parseLocalDate(manStartDate);
      for(let i=0;i<count;i++) {
        finalSchedule.push({date:formatLocalDateInput(d),startTime:manStartTime,endTime:manEndTime});
        d.setDate(d.getDate()+7);
      }
    }
    setSaving(true);
    const lesson = {
      id: initial?.id||`lesson_${Date.now()}`,
      name: name.trim(),
      instructorName: instructorName.trim(),
      instructorPhone: instructorPhone.trim(),
      instructorEmail: instructorEmail.trim(),
      description: description.trim(),
      studioId: studioId||null,
      kitId: kitId||null,
      schedule: finalSchedule,
      created_at: initial?.created_at||new Date().toISOString(),
    };
    await onSave(lesson);
    setSaving(false);
  };

  return (
    <div className="card" style={{marginBottom:20}}>
      <div className="card-header">
        <div className="card-title">📽️ {initial?"עריכת קורס":"קורס חדש"}</div>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>✕ ביטול</button>
      </div>

      {localMsg && (
        <div style={{padding:"10px 16px",marginBottom:12,borderRadius:"var(--r-sm)",fontSize:13,fontWeight:700,
          background:localMsg.type==="error"?"rgba(231,76,60,0.12)":"rgba(46,204,113,0.12)",
          border:`1px solid ${localMsg.type==="error"?"rgba(231,76,60,0.3)":"rgba(46,204,113,0.3)"}`,
          color:localMsg.type==="error"?"#e74c3c":"#2ecc71",
          display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>{localMsg.type==="error"?"❌":"✅"} {localMsg.text}</span>
          <button onClick={()=>setLocalMsg(null)} style={{background:"none",border:"none",color:"inherit",cursor:"pointer",fontSize:16,padding:"0 4px"}}>×</button>
        </div>
      )}

      {/* Course & Instructor details */}
      <div style={{background:"rgba(155,89,182,0.06)",border:"1px solid rgba(155,89,182,0.2)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16}}>
        <div style={{fontWeight:800,fontSize:13,color:"#9b59b6",marginBottom:12}}>👨‍🏫 פרטי הקורס והמרצה</div>
        <div className="form-group" style={{marginBottom:10}}>
          <label className="form-label">שם הקורס *</label>
          <input className="form-input" placeholder='לדוגמה: "אולפן טלוויזיה א"' value={name} onChange={e=>setName(e.target.value)}/>
        </div>
        <div className="grid-2" style={{marginBottom:10}}>
          <div className="form-group"><label className="form-label">שם המרצה</label>
            <input className="form-input" placeholder='ד"ר ישראל ישראלי' value={instructorName} onChange={e=>setInstructorName(e.target.value)}/></div>
          <div className="form-group"><label className="form-label">טלפון מרצה</label>
            <input className="form-input" placeholder="05x-xxxxxxx" value={instructorPhone} onChange={e=>setInstructorPhone(e.target.value)}/></div>
        </div>
        <div className="form-group" style={{marginBottom:10}}>
          <label className="form-label">מייל מרצה</label>
          <input className="form-input" type="email" placeholder="lecturer@college.ac.il" value={instructorEmail} onChange={e=>setInstructorEmail(e.target.value)}/>
        </div>
        <div className="form-group">
          <label className="form-label">הערות</label>
          <textarea className="form-textarea" rows={2} placeholder="הערות על הקורס..." value={description} onChange={e=>setDescription(e.target.value)}/>
        </div>
      </div>

      {/* Link to studio (optional) */}
      <div style={{background:"rgba(52,152,219,0.06)",border:"1px solid rgba(52,152,219,0.2)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16}}>
        <div style={{fontWeight:800,fontSize:13,color:"#3498db",marginBottom:10}}>🔗 שיוך (אופציונלי)</div>
        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">🎙️ שיוך לאולפן</label>
            <select className="form-select" value={studioId} onChange={e=>setStudioId(e.target.value)}>
              <option value="">ללא שיוך</option>
              {studios.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">🎒 שיוך לערכת שיעור</label>
            <select className="form-select" value={kitId} onChange={e=>setKitId(e.target.value)}>
              <option value="">ללא שיוך</option>
              {lessonKits.map(k=><option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Schedule builder */}
      <div style={{background:"rgba(155,89,182,0.06)",border:"1px solid rgba(155,89,182,0.2)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16}}>
        <div style={{fontWeight:800,fontSize:13,color:"#9b59b6",marginBottom:12}}>📅 לוח שיעורים</div>

        <div style={{display:"flex",gap:6,marginBottom:12}}>
          {[{k:"manual",l:"📝 ידני"},{k:"xl",l:"📤 ייבוא XL"}].map(({k,l})=>(
            <button key={k} onClick={()=>setScheduleMode(k)}
              style={{padding:"7px 16px",borderRadius:20,border:`2px solid ${scheduleMode===k?"#9b59b6":"var(--border)"}`,background:scheduleMode===k?"rgba(155,89,182,0.15)":"transparent",color:scheduleMode===k?"#9b59b6":"var(--text2)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
              {l}
            </button>
          ))}
        </div>

        {scheduleMode==="manual" && (
          <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end",marginBottom:12}}>
            <div className="form-group" style={{flex:"1 1 130px",minWidth:120}}>
              <label className="form-label">תאריך התחלה</label>
              <input className="form-input" type="date" value={manStartDate} onChange={e=>setManStartDate(e.target.value)}/>
            </div>
            <div className="form-group" style={{flex:"0 0 90px"}}>
              <label className="form-label">שעת התחלה</label>
              <select className="form-select" value={manStartTime} onChange={e=>setManStartTime(e.target.value)}>
                {LESSON_TIMES.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group" style={{flex:"0 0 90px"}}>
              <label className="form-label">שעת סיום</label>
              <select className="form-select" value={manEndTime} onChange={e=>setManEndTime(e.target.value)}>
                {LESSON_TIMES.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group" style={{flex:"0 0 80px"}}>
              <label className="form-label">מס׳ שבועות</label>
              <input className="form-input" type="number" min={1} max={52} value={manCount} onChange={e=>setManCount(e.target.value)}/>
            </div>
            <button className="btn btn-primary" style={{background:"#9b59b6",borderColor:"#9b59b6",whiteSpace:"nowrap"}} onClick={buildAndAppendSchedule}>➕ הוסף</button>
          </div>
        )}

        {scheduleMode==="xl" && (
          <div style={{marginBottom:12}}>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:8}}>יש להעלות קובץ CSV/XLSX עם עמודות: תאריך, שעת התחלה, שעת סיום (אופציונלי: קורס)</div>
            <label className="btn btn-secondary" style={{cursor:"pointer",display:"inline-flex",alignItems:"center",gap:6}}>
              {xlImporting?"⏳ מייבא...":"📂 בחר קובץ"}
              <input type="file" accept=".csv,.tsv,.xlsx,.xls" style={{display:"none"}} onChange={importScheduleXL} disabled={xlImporting}/>
            </label>
          </div>
        )}

        {/* Current schedule */}
        {schedule.length>0 && (
          <div>
            <div style={{fontWeight:700,fontSize:12,color:"#9b59b6",marginBottom:6}}>📅 {schedule.length} שיעורים בלוח:</div>
            <div style={{maxHeight:200,overflow:"auto",display:"flex",flexDirection:"column",gap:4}}>
              {schedule.map((s,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,padding:"4px 8px",background:"var(--surface2)",borderRadius:6}}>
                  <span style={{fontWeight:700,color:"#9b59b6",minWidth:24,flexShrink:0}}>#{i+1}</span>
                  <span>{formatDate(s.date)}</span>
                  <span style={{color:"var(--text3)"}}>{s.startTime}–{s.endTime}</span>
                  <button onClick={()=>setSchedule(p=>p.filter((_,j)=>j!==i))}
                    style={{marginRight:"auto",background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:13,padding:"0 4px"}}>×</button>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:6,marginTop:8}}>
              <button className="btn btn-secondary btn-sm" onClick={appendLessonFromExisting}>➕ שיעור נוסף</button>
              <button className="btn btn-secondary btn-sm" style={{color:"var(--red)",borderColor:"var(--red)"}} onClick={()=>{if(window.confirm("לנקות את כל לוח השיעורים?"))setSchedule([]);}}>🗑️ נקה הכל</button>
            </div>
          </div>
        )}
      </div>

      {/* Email to teacher */}
      {instructorEmail && (
        <div style={{background:"rgba(52,152,219,0.06)",border:"1px solid rgba(52,152,219,0.2)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16}}>
          <div style={{fontWeight:800,fontSize:13,color:"#3498db",marginBottom:10}}>✉️ שליחת מייל למרצה</div>
          <textarea className="form-textarea" rows={3} placeholder="נוסח ההודעה למרצה..." value={teacherMessage} onChange={e=>setTeacherMessage(e.target.value)}/>
          <button className="btn btn-secondary" style={{marginTop:8}} onClick={sendTeacherEmail} disabled={teacherEmailSending}>
            {teacherEmailSending?"⏳ שולח...":"📧 שלח מייל למרצה"}
          </button>
        </div>
      )}

      {/* Save */}
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <button className="btn btn-secondary" onClick={onCancel}>ביטול</button>
        <button className="btn btn-primary" style={{background:"#9b59b6",borderColor:"#9b59b6"}} onClick={handleSave} disabled={saving}>
          {saving?"⏳ שומר...":`💾 ${initial?"עדכן":"צור"} קורס`}
        </button>
      </div>
    </div>
  );
}
