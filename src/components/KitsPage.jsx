// KitsPage.jsx — kits management page
import { useState } from "react";
import { storageSet, formatDate, formatLocalDateInput, parseLocalDate, today, getAvailable, toDateTime, FAR_FUTURE } from "../utils.js";

export function KitsPage({ kits, setKits, equipment, categories, showToast, reservations=[], setReservations }) {
  const [mode, setMode] = useState(null); // null | "student" | "lesson" | "editStudent" | "editLesson"
  const [editTarget, setEditTarget] = useState(null);
  const [tabView, setTabView] = useState("student"); // "student" | "lesson"
  const LOAN_TYPES = ["פרטית","הפקה","סאונד","קולנוע יומית","הכל"];
  const LOAN_ICONS = { "פרטית":"👤", "הפקה":"🎬", "סאונד":"🎙️", "קולנוע יומית":"🎥", "הכל":"📦" };

  const studentKits = kits.filter(k=>k.kitType!=="lesson");
  const lessonKits  = kits.filter(k=>k.kitType==="lesson");

  const normalizeKitName = (name) => String(name||"").trim().toLowerCase();
  const hasDuplicateKitName = (name, excludeId=null) =>
    kits.some(k=>k.id!==excludeId && normalizeKitName(k.name)===normalizeKitName(name));

  const del = async (id, name) => {
    if(!window.confirm(`למחוק את הערכה "${name}"?`)) return;
    const updated = kits.filter(k=>k.id!==id);
    setKits(updated);
    // also remove associated lesson reservations
    if(reservations && setReservations) {
      const updatedRes = reservations.filter(r=>r.lesson_kit_id!==id);
      if(updatedRes.length!==reservations.length) {
        setReservations(updatedRes);
        await storageSet("reservations", updatedRes);
      }
    }
    await storageSet("kits", updated);
    showToast("success", `ערכה "${name}" נמחקה`);
  };

  // ── Student Kit Form ──────────────────────────────────────────────────────
  const StudentKitForm = ({ initial, onDone }) => {
    const [name, setName] = useState(initial?.name||"");
    const [description, setDescription] = useState(initial?.description||"");
    const [loanType, setLoanType] = useState(initial?.loanType||"הכל");
    const [kitItems, setKitItems] = useState(initial?.items||[]);
    const [saving, setSaving] = useState(false);
    const trimmedName = name.trim();
    const duplicateName = !!trimmedName && hasDuplicateKitName(trimmedName, initial?.id||null);

    const maxQty = eqId => {
      const eq = equipment.find(e=>e.id==eqId);
      if(!eq) return 0;
      return Number(eq.total_quantity)||0;
    };
    const setItemQty = (eqId, qty) => {
      const max = maxQty(eqId);
      const bounded = Math.max(0, Math.min(qty, max));
      const eqName = equipment.find(e=>e.id==eqId)?.name||"";
      setKitItems(prev => bounded<=0 ? prev.filter(i=>i.equipment_id!=eqId)
        : prev.find(i=>i.equipment_id==eqId) ? prev.map(i=>i.equipment_id==eqId?{...i,quantity:bounded}:i)
        : [...prev,{equipment_id:eqId,quantity:bounded,name:eqName}]);
    };
    const getQty = eqId => kitItems.find(i=>i.equipment_id==eqId)?.quantity||0;

    const save = async () => {
      if(!trimmedName||duplicateName) return;
      setSaving(true);
      const kit = { id:initial?.id||Date.now(), kitType:"student", name:trimmedName, description:description.trim(), loanType:loanType==="הכל"?"":loanType, items:kitItems };
      const updated = initial ? kits.map(k=>k.id===initial.id?kit:k) : [...kits, kit];
      setKits(updated);
      const r = await storageSet("kits", updated);
      showToast(r.ok?"success":"error", r.ok ? (initial?"הערכה עודכנה":`ערכה לסטודנט "${trimmedName}" נוצרה`) : "❌ שגיאה בשמירה");
      if(r.ok) onDone();
      setSaving(false);
    };

    return (
      <div className="card" style={{marginBottom:20}}>
        <div className="card-header">
          <div className="card-title">🎒 {initial?"עריכת ערכה לסטודנט":"ערכה חדשה לסטודנט"}</div>
          <button className="btn btn-secondary btn-sm" onClick={onDone}>✕ ביטול</button>
        </div>
        <div className="responsive-split" style={{marginBottom:12}}>
          <div className="form-group"><label className="form-label">שם הערכה *</label>
            <input className="form-input" placeholder='לדוגמה: "ערכת דוקומנטרי"' value={name} onChange={e=>setName(e.target.value)}/>
            {duplicateName&&<div style={{fontSize:12,color:"var(--red)",marginTop:4}}>כבר קיימת ערכה עם השם הזה.</div>}
          </div>
          <div className="form-group">
            <label className="form-label">שיוך לסוג השאלה</label>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:6}}>
              {LOAN_TYPES.map(lt=>(
                <button key={lt} type="button" onClick={()=>setLoanType(lt)}
                  style={{padding:"5px 12px",borderRadius:20,border:`2px solid ${loanType===lt?"var(--accent)":"var(--border)"}`,background:loanType===lt?"var(--accent-glow)":"var(--surface2)",color:loanType===lt?"var(--accent)":"var(--text2)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                  {LOAN_ICONS[lt]} {lt}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="form-group" style={{marginBottom:16}}>
          <label className="form-label">תיאור הערכה</label>
          <textarea className="form-textarea" rows={2} placeholder="תיאור קצר..." value={description} onChange={e=>setDescription(e.target.value)}/>
        </div>
        <div className="form-section-title">ציוד בערכה</div>
        {categories.map(cat=>{
          const catEq = equipment.filter(e=>e.category===cat);
          if(!catEq.length) return null;
          return (
            <div key={cat} style={{marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",marginBottom:6,textTransform:"uppercase",letterSpacing:1}}>{cat}</div>
              {catEq.map(eq=>{
                const max = maxQty(eq.id);
                const qty = getQty(eq.id);
                return (
                  <div key={eq.id} className="item-row" style={{marginBottom:4,opacity:max===0?0.4:1}}>
                    <span style={{fontSize:20}}>{eq.image?.startsWith("data:")||eq.image?.startsWith("http")?<img src={eq.image} alt="" style={{width:24,height:24,objectFit:"cover",borderRadius:4}}/>:eq.image||"📦"}</span>
                    <div style={{flex:1,fontSize:13,fontWeight:600}}>{eq.name}<span style={{fontSize:11,color:"var(--text3)",marginRight:6,fontWeight:400}}>מלאי: {max}</span></div>
                    {max>0
                      ? <div className="qty-ctrl">
                          <button className="qty-btn" onClick={()=>setItemQty(eq.id,qty-1)}>−</button>
                          <span className="qty-num" style={{color:qty>0?"var(--accent)":"inherit"}}>{qty}</span>
                          <button className="qty-btn" disabled={qty>=max} onClick={()=>setItemQty(eq.id,qty+1)} style={{opacity:qty>=max?0.3:1}}>+</button>
                        </div>
                      : <span style={{fontSize:11,color:"var(--red)",fontWeight:700}}>אין מלאי</span>}
                  </div>
                );
              })}
            </div>
          );
        })}
        {kitItems.length>0&&<div className="highlight-box" style={{marginTop:8}}>🎒 {kitItems.length} סוגי ציוד · {kitItems.reduce((s,i)=>s+i.quantity,0)} יחידות</div>}
        <div style={{marginTop:12,display:"flex",gap:8}}>
          <button className="btn btn-primary" disabled={!trimmedName||duplicateName||saving} onClick={save}>{saving?"⏳ שומר...":initial?"💾 שמור":"➕ צור ערכה"}</button>
        </div>
      </div>
    );
  };

  // ── Lesson Kit Form ───────────────────────────────────────────────────────
  const LessonKitForm = ({ initial, onDone }) => {
    const [name, setName]                   = useState(initial?.name||initial?.courseName||"");
    const [instructorName, setInstructorName] = useState(initial?.instructorName||"");
    const [instructorPhone, setInstructorPhone] = useState(initial?.instructorPhone||"");
    const [instructorEmail, setInstructorEmail] = useState(initial?.instructorEmail||"");
    const [description, setDescription]     = useState(initial?.description||"");
    const [kitItems, setKitItems]           = useState(initial?.items||[]);
    const [schedule, setSchedule]           = useState(initial?.schedule||[]);
    const [scheduleMode, setScheduleMode]   = useState("manual"); // "manual" | "xl"
    const [saving, setSaving]               = useState(false);
    const [xlImporting, setXlImporting]     = useState(false);
    const [teacherMessage, setTeacherMessage] = useState("");
    const [teacherEmailSending, setTeacherEmailSending] = useState(false);
    const [kitConflicts, setKitConflicts] = useState(null); // {session, conflicts}[]
    const isEditMode = !!initial;
    const [localMsg, setLocalMsg] = useState(null); // {type:"success"|"error", text:""}

    // Equipment filter state
    const [lessonEqTypeF, setLessonEqTypeF]       = useState("all"); // "all"|"sound"|"photo"
    const [lessonCatF, setLessonCatF]             = useState([]);    // multi-select categories
    const [lessonEqSearch, setLessonEqSearch]     = useState("");
    const [lessonShowSelected, setLessonShowSelected] = useState(false);

    // Manual schedule builder
    const [manStartDate, setManStartDate] = useState("");
    const [manStartTime, setManStartTime] = useState("10:00");
    const [manEndTime, setManEndTime]   = useState("13:00");
    const [manCount, setManCount]       = useState(1);

    const LESSON_TIMES = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30",
      "13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30",
      "17:00","17:30","18:00","18:30","19:00","19:30","20:00","20:30",
      "21:00","21:30","22:00"];

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
      if (!schedule.length) return;
      // Always use the FIRST lesson's time range
      const firstLesson = schedule[0];
      // Always add 1 week after the LAST lesson's date
      const lastLesson = schedule[schedule.length - 1];
      const nextDateObj = parseLocalDate(lastLesson.date || today());
      nextDateObj.setDate(nextDateObj.getDate() + 7);
      const nextLesson = {
        date: formatLocalDateInput(nextDateObj),
        startTime: firstLesson.startTime || "09:00",
        endTime: firstLesson.endTime || "12:00",
      };
      setSchedule(prev => [...prev, nextLesson]);
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
          const dateIdx    = headers.findIndex(h=>h.includes("תאריך")||h.includes("date"));
          const startIdx   = headers.findIndex(h=>h.includes("התחלה")||h.includes("start")||h.includes("שעת התחלה"));
          const endIdx     = headers.findIndex(h=>h.includes("סיום")||h.includes("end")||h.includes("שעת סיום"));
          const courseIdx  = headers.findIndex(h=>h.includes("קורס")||h.includes("course")||h.includes("שם"));
          if(dateIdx===-1) { setLocalMsg({type:"error",text:'לא נמצאה עמודת "תאריך"'}); setXlImporting(false); return; }
          // Auto-fill kit name from course column if name is empty
          if(courseIdx>=0 && !name.trim()) {
            const firstCourseName = String(rows[1]?.[courseIdx]||"").trim();
            if(firstCourseName) setName(firstCourseName);
          }
          const sessions = [];
          for(let i=1;i<rows.length;i++) {
            const row = rows[i];
            let dateVal = String(row[dateIdx]||"").trim();
            if(!dateVal) continue;
            // handle Excel serial dates
            if(/^\d{5}$/.test(dateVal)) {
              const d = new Date(Math.round((Number(dateVal)-25569)*86400000));
              dateVal = formatLocalDateInput(d);
            } else {
              // try DD/MM/YYYY or YYYY-MM-DD
              const parts = dateVal.includes("/")?dateVal.split("/"):dateVal.split("-");
              if(parts.length===3) {
                if(parts[0].length===4) dateVal=`${parts[0]}-${parts[1].padStart(2,"0")}-${parts[2].padStart(2,"0")}`;
                else dateVal=`${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}`;
              }
            }
            sessions.push({
              date: dateVal,
              startTime: startIdx>=0?String(row[startIdx]||"09:00").trim():"09:00",
              endTime:   endIdx>=0?String(row[endIdx]||"12:00").trim():"12:00",
            });
          }
          setSchedule(prev => [...prev, ...sessions]);
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
          const wb  = window.XLSX.read(buf,{type:"array"});
          const ws  = wb.Sheets[wb.SheetNames[0]];
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

    const sendTeacherKitEmail = async () => {
      const recipient = String(instructorEmail || "").trim();
      if (!recipient) {
        setLocalMsg({type:"error",text:"יש להזין מייל למורה לפני השליחה"});
        return;
      }
      const message = String(teacherMessage || "").trim();
      if (!message) {
        setLocalMsg({type:"error",text:"יש למלא נוסח לשליחת הערכה למורה"});
        return;
      }
      if (!kitItems.length) {
        setLocalMsg({type:"error",text:"לא ניתן לשלוח ערכה למורה ללא ציוד בערכה"});
        return;
      }
      setTeacherEmailSending(true);
      try {
        const itemsList = (kitItems || []).map((item) => {
          const eq = equipment.find((entry) => entry.id == item.equipment_id);
          const itemName = eq?.name || item.name || "פריט";
          return `<tr><td style="padding:7px 12px;color:#e8eaf0;border-bottom:1px solid #1e2130">${itemName}</td><td style="padding:7px 12px;text-align:center;color:#f5a623;font-weight:700;border-bottom:1px solid #1e2130">${item.quantity}</td></tr>`;
        }).join("");
        const scheduleList = (schedule || []).map((session, index) => {
          const start = session?.startTime || "";
          const end = session?.endTime || "";
          return `<div style="margin-bottom:6px;color:#c7cedf">שיעור ${index + 1}: ${formatDate(session.date)} ${start}${end ? `–${end}` : ""}</div>`;
        }).join("");
        await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: recipient,
            type: "lesson_kit_ready",
            student_name: instructorName.trim() || name.trim() || "מורה",
            recipient_name: instructorName.trim() || name.trim() || "",
            lesson_kit_name: name.trim(),
            custom_message: message,
            items_list: itemsList,
            lesson_schedule: scheduleList,
          }),
        });
        setLocalMsg({type:"success",text:`המייל נשלח אל ${recipient}`});
      } catch (err) {
        console.error("lesson kit teacher email error", err);
        setLocalMsg({type:"error",text:"שגיאה בשליחת הערכה למורה"});
      } finally {
        setTeacherEmailSending(false);
      }
    };

    const maxQty = eqId => Number(equipment.find(e=>e.id==eqId)?.total_quantity)||0;
    const setItemQty = (eqId, qty) => {
      const max = maxQty(eqId);
      const bounded = Math.max(0,Math.min(qty,max));
      const eqName = equipment.find(e=>e.id==eqId)?.name||"";
      setKitItems(prev => bounded<=0 ? prev.filter(i=>i.equipment_id!=eqId)
        : prev.find(i=>i.equipment_id==eqId) ? prev.map(i=>i.equipment_id==eqId?{...i,quantity:bounded}:i)
        : [...prev,{equipment_id:eqId,quantity:bounded,name:eqName}]);
    };
    const getQty = eqId => kitItems.find(i=>i.equipment_id==eqId)?.quantity||0;

    const save = async () => {
      if(!name.trim()) { setLocalMsg({type:"error",text:"חובה למלא שם ערכה"}); return; }

      // Always rebuild from current schedule state + manual inputs if needed
      let finalSchedule = [...schedule]; // copy current state

      if(scheduleMode==="manual" && manStartDate) {
        // If schedule is empty OR user wants to add more — build from inputs
        if(finalSchedule.length===0) {
          const count = Math.max(1, Math.min(52, Number(manCount)||1));
          let d = parseLocalDate(manStartDate);
          for(let i=0;i<count;i++) {
            finalSchedule.push({ date: formatLocalDateInput(d), startTime: manStartTime, endTime: manEndTime });
            d.setDate(d.getDate()+7);
          }
        }
      }

      if(finalSchedule.length===0) {
        setLocalMsg({type:"error",text:"יש להוסיף לפחות שיעור אחד — בחר תאריך ושעות"});
        return;
      }
      if(!kitItems.length) {
        setLocalMsg({type:"error",text:"יש לבחור לפחות פריט ציוד אחד לערכה"});
        return;
      }

      // ── Availability check: ensure no item goes to negative inventory ──
      const kitId = initial?.id||`lk_${Date.now()}`;
      const baseRes = (reservations||[]).filter(r=>r.lesson_kit_id!==kitId);
      const sessionConflicts = [];
      for (let si = 0; si < finalSchedule.length; si++) {
        const s = finalSchedule[si];
        const sessionLabel = `שיעור ${si+1} — ${formatDate(s.date)} ${s.startTime||""}–${s.endTime||""}`;
        const itemConflicts = [];
        for (const item of kitItems) {
          const eq = equipment.find(e=>e.id==item.equipment_id);
          if (!eq) continue;
          // Build list of reservations to check against: baseRes + earlier sessions from THIS kit
          const checkRes = [...baseRes];
          for (let pi = 0; pi < si; pi++) {
            const ps = finalSchedule[pi];
            checkRes.push({
              id: `__kit_check_${pi}`, status: "מאושר",
              borrow_date: ps.date, borrow_time: ps.startTime||"00:00",
              return_date: ps.date, return_time: ps.endTime||"23:59",
              items: kitItems,
            });
          }
          const avail = getAvailable(item.equipment_id, s.date, s.date, checkRes, equipment, null, s.startTime||"", s.endTime||"");
          if (item.quantity > avail) {
            // Find who's blocking
            const blockers = [];
            const reqStart = toDateTime(s.date, s.startTime||"00:00");
            const reqEnd   = toDateTime(s.date, s.endTime||"23:59");
            for (const res of baseRes) {
              if (res.status !== "מאושר" && res.status !== "באיחור") continue;
              const resStart = toDateTime(res.borrow_date, res.borrow_time||"00:00");
              const resEnd   = res.status === "באיחור" ? FAR_FUTURE : toDateTime(res.return_date, res.return_time||"23:59");
              if (!(reqStart < resEnd && reqEnd > resStart)) continue;
              const bi = (res.items||[]).find(i=>i.equipment_id==item.equipment_id);
              if (bi && bi.quantity > 0) {
                blockers.push({ student_name: res.student_name||"ללא שם", quantity: bi.quantity, status: res.status, borrow_date: res.borrow_date, return_date: res.return_date });
              }
            }
            itemConflicts.push({ equipment_name: eq.name, requested: item.quantity, available: avail, missing: item.quantity - avail, blockers });
          }
        }
        if (itemConflicts.length) sessionConflicts.push({ label: sessionLabel, date: s.date, conflicts: itemConflicts });
      }
      if (sessionConflicts.length) {
        setKitConflicts(sessionConflicts);
        setSaving(false);
        return;
      }
      setKitConflicts(null);
      // ── End availability check ──

      setSaving(true);

      const kit = {
        id: kitId, kitType:"lesson",
        name: name.trim(),
        instructorName: instructorName.trim(),
        instructorPhone: instructorPhone.trim(),
        instructorEmail: instructorEmail.trim(),
        description: description.trim(),
        items: kitItems, schedule: finalSchedule,
      };
      const updatedKits = initial ? kits.map(k=>k.id===initial.id?kit:k) : [...kits, kit];
      setKits(updatedKits);

      // Create/replace associated reservations (one per session)
      const newRes = finalSchedule.map((s,i)=>({
        id: `${kitId}_s${i}`,
        lesson_kit_id: kitId,
        status: "מאושר",
        loan_type: "שיעור",
        student_name: instructorName.trim()||name.trim(),
        email: instructorEmail.trim(),
        phone: instructorPhone.trim(),
        course: name.trim(),
        borrow_date: s.date,
        borrow_time: s.startTime,
        return_date: s.date,
        return_time: s.endTime,
        items: kitItems,
        created_at: new Date().toISOString(),
        overdue_notified: true,
      }));
      const updatedRes = [...baseRes, ...newRes];
      if(setReservations) setReservations(updatedRes);

      const [r1, r2] = await Promise.all([
        storageSet("kits", updatedKits),
        storageSet("reservations", updatedRes),
      ]);
      setSaving(false);
      if(r1.ok&&r2.ok) {
        onDone();
        showToast("success", `ערכת שיעור "${name.trim()}" נשמרה · ${finalSchedule.length} שיעורים שוריינו`);
      } else setLocalMsg({type:"error",text:"❌ שגיאה בשמירה"});
    };

    return (
      <div className="card" style={{marginBottom:20}}>
        <div className="card-header">
          <div className="card-title">🎬 {initial?"עריכת ערכת שיעור":"ערכת שיעור חדשה"}</div>
          <button className="btn btn-secondary btn-sm" onClick={onDone}>✕ ביטול</button>
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

        {/* ── Kit availability conflict warning ── */}
        {kitConflicts && (
          <div style={{padding:16,marginBottom:16,borderRadius:"var(--r-sm)",background:"rgba(231,76,60,0.08)",border:"1px solid rgba(231,76,60,0.35)"}}>
            <div style={{fontWeight:700,fontSize:15,color:"#e74c3c",marginBottom:10,display:"flex",alignItems:"center",gap:8}}>
              <span>⚠️</span><span>לא ניתן לשמור — חוסר ציוד זמין</span>
              <button onClick={()=>setKitConflicts(null)} style={{marginRight:"auto",background:"none",border:"none",color:"#e74c3c",cursor:"pointer",fontSize:18,padding:"0 4px"}}>×</button>
            </div>
            <div style={{fontSize:12,color:"var(--text2)",marginBottom:10}}>הציוד הנדרש לערכת השיעור אינו זמין בתאריכים הבאים בגלל השאלות קיימות או ציוד באיחור:</div>
            {kitConflicts.map((sc,si)=>(
              <div key={si} style={{marginBottom:12,padding:10,borderRadius:8,background:"rgba(231,76,60,0.04)",border:"1px solid rgba(231,76,60,0.15)"}}>
                <div style={{fontWeight:600,fontSize:13,color:"var(--text1)",marginBottom:6}}>📅 {sc.label}</div>
                {sc.conflicts.map((c,ci)=>(
                  <div key={ci} style={{marginBottom:8,paddingRight:12}}>
                    <div style={{fontSize:13,fontWeight:600,color:"#e74c3c"}}>
                      {c.equipment_name}: נדרש {c.requested}, זמין {c.available} — חסר {c.missing}
                    </div>
                    {c.blockers.map((b,bi)=>(
                      <div key={bi} style={{fontSize:11,color:"var(--text3)",paddingRight:8,marginTop:2,display:"flex",alignItems:"center",gap:6}}>
                        {b.status==="באיחור" && <span style={{background:"rgba(230,126,34,0.15)",color:"#e67e22",padding:"1px 6px",borderRadius:4,fontWeight:700,fontSize:10}}>באיחור</span>}
                        <span>{b.student_name} · {b.quantity} יח׳ · {formatDate(b.borrow_date)}–{formatDate(b.return_date)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
            <div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>💡 יש להחזיר את הציוד באיחור או להקטין כמויות בערכה לפני השמירה</div>
          </div>
        )}

        {/* Instructor details */}
        <div style={{background:"rgba(52,152,219,0.06)",border:"1px solid rgba(52,152,219,0.2)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16}}>
          <div style={{fontWeight:800,fontSize:13,color:"#3498db",marginBottom:12}}>👨‍🏫 פרטי הקורס והמרצה</div>
          <div className="form-group" style={{marginBottom:10}}>
            <label className="form-label">שם הערכה / קורס *</label>
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
            <textarea className="form-textarea" rows={2} placeholder="הערות על הקורס או הערכה..." value={description} onChange={e=>setDescription(e.target.value)}/>
          </div>
        </div>

        {/* Equipment picker */}
        <div style={{marginBottom:16}}>
          <div className="form-section-title">🎒 ציוד נדרש לשיעור <span style={{fontWeight:400,fontSize:11,color:"var(--text3)"}}>· כמות מלאי המחסן המלא</span></div>

          {/* Filters */}
          <div style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"12px 14px",marginBottom:12}}>
            {/* Type filter */}
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8,alignItems:"center"}}>
              <span style={{fontSize:11,fontWeight:800,color:"var(--text3)"}}>סינון:</span>
              {[{k:"all",l:"📦 הכל"},{k:"sound",l:"🎙️ סאונד"},{k:"photo",l:"🎥 צילום"}].map(({k,l})=>{
                const active=lessonEqTypeF===k;
                return <button key={k} type="button" onClick={()=>setLessonEqTypeF(k)}
                  style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                  {l}
                </button>;
              })}
              <span style={{width:1,height:16,background:"var(--border)",flexShrink:0}}/>
              {/* Category multi-select */}
              {categories.map(cat=>{
                const active=lessonCatF.includes(cat);
                return <button key={cat} type="button" onClick={()=>setLessonCatF(p=>active?p.filter(c=>c!==cat):[...p,cat])}
                  style={{padding:"4px 10px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}>
                  {cat}
                </button>;
              })}
              {lessonCatF.length>0&&<button type="button" onClick={()=>setLessonCatF([])} style={{padding:"4px 8px",borderRadius:20,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:11,cursor:"pointer"}}>✕ נקה</button>}
            </div>
            {/* Search + selected toggle */}
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <div className="search-bar" style={{flex:1,minWidth:150}}><span>🔍</span>
                <input placeholder="חיפוש ציוד..." value={lessonEqSearch} onChange={e=>setLessonEqSearch(e.target.value)}/></div>
              <button type="button" onClick={()=>setLessonShowSelected(p=>!p)}
                style={{padding:"5px 12px",borderRadius:20,border:`2px solid ${lessonShowSelected?"var(--green)":"var(--border)"}`,background:lessonShowSelected?"rgba(46,204,113,0.12)":"transparent",color:lessonShowSelected?"var(--green)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
                {lessonShowSelected?"✅ נבחרים":"⬜ נבחרים בלבד"}
              </button>
            </div>
          </div>

          {/* Equipment list with filters applied */}
          {(()=>{
            const visibleCats = (lessonCatF.length>0 ? lessonCatF : categories).filter(cat=>
              equipment.some(e=>e.category===cat &&
                (lessonEqTypeF==="all"||(lessonEqTypeF==="sound"&&e.soundOnly)||(lessonEqTypeF==="photo"&&e.photoOnly)) &&
                (!lessonEqSearch||e.name.includes(lessonEqSearch)) &&
                (!lessonShowSelected||getQty(e.id)>0)
              )
            );
            if(visibleCats.length===0) return <div style={{textAlign:"center",color:"var(--text3)",padding:"16px",fontSize:13}}>לא נמצא ציוד תואם</div>;
            return visibleCats.map(cat=>{
              const catEq = equipment.filter(e=>e.category===cat &&
                (lessonEqTypeF==="all"||(lessonEqTypeF==="sound"&&e.soundOnly)||(lessonEqTypeF==="photo"&&e.photoOnly)) &&
                (!lessonEqSearch||e.name.includes(lessonEqSearch)) &&
                (!lessonShowSelected||getQty(e.id)>0)
              );
              if(!catEq.length) return null;
              return (
                <div key={cat} style={{marginBottom:10}}>
                  <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",marginBottom:5,textTransform:"uppercase",letterSpacing:1}}>{cat}</div>
                  {catEq.map(eq=>{
                    const max=maxQty(eq.id); const qty=getQty(eq.id);
                    return (
                      <div key={eq.id} className="item-row" style={{marginBottom:4,opacity:max===0?0.4:1,background:qty>0?"rgba(245,166,35,0.05)":"",border:qty>0?"1px solid rgba(245,166,35,0.2)":""}}>
                        <span style={{fontSize:20}}>{eq.image?.startsWith("data:")||eq.image?.startsWith("http")?<img src={eq.image} alt="" style={{width:24,height:24,objectFit:"cover",borderRadius:4}}/>:eq.image||"📦"}</span>
                        <div style={{flex:1,fontSize:13,fontWeight:600}}>
                          {eq.name}
                          <span style={{fontSize:11,color:"var(--text3)",marginRight:6,fontWeight:400}}>מלאי: {max}</span>
                          {eq.soundOnly&&<span style={{fontSize:10,color:"var(--accent)",fontWeight:700,marginRight:4}}>🎙️</span>}
                          {eq.photoOnly&&<span style={{fontSize:10,color:"var(--green)",fontWeight:700,marginRight:4}}>🎥</span>}
                        </div>
                        {max>0
                          ? <div className="qty-ctrl">
                              <button className="qty-btn" onClick={()=>setItemQty(eq.id,qty-1)}>−</button>
                              <span className="qty-num" style={{color:qty>0?"var(--accent)":"inherit"}}>{qty}</span>
                              <button className="qty-btn" disabled={qty>=max} onClick={()=>setItemQty(eq.id,qty+1)} style={{opacity:qty>=max?0.3:1}}>+</button>
                            </div>
                          : <span style={{fontSize:11,color:"var(--red)",fontWeight:700}}>אין מלאי</span>}
                      </div>
                    );
                  })}
                </div>
              );
            });
          })()}
          {kitItems.length>0&&<div className="highlight-box" style={{marginTop:8}}>🎒 {kitItems.length} סוגי ציוד · {kitItems.reduce((s,i)=>s+i.quantity,0)} יחידות</div>}
        </div>

        {/* Schedule builder */}
        <div style={{background:"rgba(155,89,182,0.06)",border:"1px solid rgba(155,89,182,0.25)",borderRadius:"var(--r)",padding:16,marginBottom:18}}>
          <div style={{fontWeight:800,fontSize:13,color:"#9b59b6",marginBottom:12}}>📅 לוח שיעורים</div>

          {!isEditMode && (
            <>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
                {[{k:"manual",l:"📅 פריסה ידנית"},{k:"xl",l:"📊 ייבוא מ-XL"}].map(({k,l})=>(
                  <button key={k} type="button" onClick={()=>setScheduleMode(k)}
                    style={{padding:"7px 16px",borderRadius:20,border:`2px solid ${scheduleMode===k?"#9b59b6":"var(--border)"}`,background:scheduleMode===k?"rgba(155,89,182,0.15)":"transparent",color:scheduleMode===k?"#9b59b6":"var(--text2)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                    {l}
                  </button>
                ))}
              </div>

              {scheduleMode==="manual"&&(
                <div className="responsive-split" style={{marginBottom:12,alignItems:"end"}}>
                  <div style={{gridColumn:"1 / -1",fontSize:12,color:"var(--text3)",marginBottom:2}}>
                    📅 הגדר פריסת שיעורים — ייווצרו אוטומטית בשמירה
                  </div>
                  <div className="form-group"><label className="form-label">תאריך שיעור ראשון *</label>
                    <input type="date" className="form-input" value={manStartDate} onChange={e=>setManStartDate(e.target.value)}/></div>
                  <div className="form-group"><label className="form-label">שעת התחלה</label>
                    <select className="form-select" value={manStartTime} onChange={e=>setManStartTime(e.target.value)}>
                      {LESSON_TIMES.map(t=><option key={t} value={t}>{t}</option>)}
                    </select></div>
                  <div className="form-group"><label className="form-label">שעת סיום</label>
                    <select className="form-select" value={manEndTime} onChange={e=>setManEndTime(e.target.value)}>
                      <option value="">ללא</option>
                      {LESSON_TIMES.filter(t=>t>manStartTime).map(t=><option key={t} value={t}>{t}</option>)}
                    </select></div>
                  <div className="form-group"><label className="form-label">מספר שיעורים</label>
                    <input type="number" min="1" max="52" className="form-input" value={manCount} onChange={e=>setManCount(Math.max(1,Math.min(52,Number(e.target.value)||1)))}/></div>
                  {manStartDate&&<div className="highlight-box" style={{gridColumn:"1 / -1",marginTop:-4,marginBottom:0}}>
                    שיעור 1: {formatDate(manStartDate)} {manStartTime}–{manEndTime}
                    {Number(manCount)>1&&` · עד שיעור ${manCount}: ${(()=>{const d=parseLocalDate(manStartDate);d.setDate(d.getDate()+7*(Number(manCount)-1));return formatDate(formatLocalDateInput(d));})()}`}
                  </div>}
                  {manStartDate&&schedule.length===0&&(()=>{
                    const cnt = Math.max(1, Math.min(52, Number(manCount)||1));
                    const preview = [];
                    const d = parseLocalDate(manStartDate);
                    for(let i=0;i<Math.min(cnt,3);i++) {
                      const x = new Date(d); x.setDate(d.getDate()+7*i); preview.push(formatDate(formatLocalDateInput(x)));
                    }
                    return <div style={{gridColumn:"1 / -1",fontSize:12,color:"var(--text2)",lineHeight:1.7,marginTop:-6}}>
                        <div style={{fontWeight:700,color:"#9b59b6",marginBottom:4}}>תצוגה מקדימה — {cnt} שיעורים שייווצרו:</div>
                        <div>{preview.join(" · ")}</div>
                        {cnt>3&&<div style={{color:"var(--text3)"}}>...ועוד {cnt-3} שיעורים נוספים</div>}
                      </div>;
                  })()}
                </div>
              )}

              {scheduleMode==="xl"&&(
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:12,color:"var(--text3)",marginBottom:8}}>
                    העלה קובץ CSV / TSV / XLS / XLSX עם עמודות תאריך ושעות.
                    {schedule.length>0&&<span style={{color:"#9b59b6"}}> · השיעורים יתווספו לקיימים</span>}
                  </div>
                  <label className="btn btn-secondary" style={{cursor:xlImporting?"not-allowed":"pointer",opacity:xlImporting?0.6:1}}>
                    {xlImporting?"⏳ מייבא...":"📊 ייבוא לוח שיעורים מקובץ"}
                    <input type="file" accept=".csv,.tsv,.xls,.xlsx" style={{display:"none"}} onChange={importScheduleXL} disabled={xlImporting}/>
                  </label>
                </div>
              )}
            </>
          )}

          {isEditMode && (
            <div className="highlight-box" style={{marginBottom:12}}>
              במצב עריכה ניתן לעדכן תאריכים ושעות של שיעורים קיימים, להסיר שיעורים, ולשכפל שיעור נוסף שבוע אחרי האחרון.
            </div>
          )}

          {/* Schedule list with inline editing */}
          {schedule.length>0&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontWeight:700,fontSize:12,color:"#9b59b6"}}>📅 {schedule.length} שיעורים בלוח:</div>
                {!isEditMode && <button type="button" onClick={()=>setSchedule([])} style={{fontSize:11,color:"var(--red)",background:"none",border:"none",cursor:"pointer"}}>🗑️ נקה הכל</button>}
              </div>
              <div style={{maxHeight:280,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
                {schedule.map((s,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:6,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"6px 10px",fontSize:12,flexWrap:"wrap"}}>
                    <span style={{fontWeight:700,color:"#9b59b6",minWidth:24,flexShrink:0}}>#{i+1}</span>
                    {/* Inline date edit */}
                    <input type="date" value={s.date}
                      onChange={e=>setSchedule(prev=>prev.map((x,j)=>j===i?{...x,date:e.target.value}:x))}
                      style={{padding:"2px 6px",borderRadius:6,border:"1px solid var(--border)",background:"var(--surface3)",color:"var(--text)",fontSize:11,width:130}}/>
                    {/* Inline time edit */}
                    <select value={s.startTime}
                      onChange={e=>setSchedule(prev=>prev.map((x,j)=>j===i?{...x,startTime:e.target.value}:x))}
                      style={{padding:"2px 6px",borderRadius:6,border:"1px solid var(--border)",background:"var(--surface3)",color:"var(--text)",fontSize:11}}>
                      {LESSON_TIMES.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                    <span style={{color:"var(--text3)"}}>–</span>
                    <select value={s.endTime}
                      onChange={e=>setSchedule(prev=>prev.map((x,j)=>j===i?{...x,endTime:e.target.value}:x))}
                      style={{padding:"2px 6px",borderRadius:6,border:"1px solid var(--border)",background:"var(--surface3)",color:"var(--text)",fontSize:11}}>
                      {LESSON_TIMES.filter(t=>t>s.startTime).map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                    <div style={{marginRight:"auto",display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                      <button type="button" onClick={()=>setSchedule(prev=>prev.filter((_,j)=>j!==i))}
                        style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:15,padding:"0 2px",flexShrink:0}}>×</button>
                    </div>
                  </div>
                ))}
              </div>
              {isEditMode && schedule.length>0 && (
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
                  <button type="button" className="btn btn-secondary" onClick={()=>appendLessonFromExisting()}>
                    ➕ שכפל שיעור
                  </button>
                  <span style={{fontSize:12,color:"var(--text3)",alignSelf:"center"}}>
                    שיעור חדש יתווסף שבוע אחרי השיעור האחרון עם אותן שעות.
                  </span>
                </div>
              )}
            </div>
          )}
          {!schedule.length&&scheduleMode==="manual"&&!manStartDate&&(
            <div style={{textAlign:"center",color:"var(--text3)",fontSize:12,padding:"8px 0"}}>בחר תאריך וזמנים למעלה — השיעורים ייווצרו אוטומטית בלחיצה על "צור ערכת שיעור"</div>
          )}
        </div>

        <div style={{background:"rgba(46,204,113,0.08)",border:"1px solid rgba(46,204,113,0.25)",borderRadius:"var(--r)",padding:16,marginBottom:18}}>
          <div style={{fontWeight:800,fontSize:13,color:"var(--green)",marginBottom:12}}>📧 שליחת ערכה למורה</div>
          <div style={{fontSize:12,color:"var(--text2)",marginBottom:10}}>
            לאחר שצוות המחסן סיים להרכיב את הערכה, ניתן לשלוח למורה את נוסח ההודעה שלך יחד עם רשימת הציוד והמפגשים, כדי שיוכל לעבור ולבדוק את הערכה.
          </div>
          <div className="form-group" style={{marginBottom:12}}>
            <label className="form-label">נוסח ההודעה למורה</label>
            <textarea
              className="form-textarea"
              rows={4}
              placeholder="לדוגמה: שלום, הערכה מוכנה לבדיקה ומצורפת אליך רשימת הציוד והמפגשים."
              value={teacherMessage}
              onChange={e=>setTeacherMessage(e.target.value)}
            />
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
            <button
              type="button"
              className="btn btn-success"
              onClick={sendTeacherKitEmail}
              disabled={teacherEmailSending || !String(instructorEmail||"").trim()}
            >
              {teacherEmailSending ? "⏳ שולח למורה..." : "📤 שליחת ערכה למורה"}
            </button>
            <span style={{fontSize:12,color:"var(--text3)"}}>
              {String(instructorEmail||"").trim() ? `המייל יישלח אל ${instructorEmail.trim()}` : "יש להזין קודם כתובת מייל למורה"}
            </span>
          </div>
        </div>

        {/* Single CTA */}
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",paddingTop:4}}>
          <button className="btn btn-primary"
            disabled={saving || !name.trim() || (scheduleMode==="xl" && schedule.length===0)}
            onClick={save}
            style={{fontSize:15,padding:"12px 28px"}}>
            {saving ? "⏳ שומר ומשריין..." : initial ? "💾 שמור שינויים" : "🎬 צור ערכת שיעור"}
          </button>
          {scheduleMode==="manual" && manStartDate && schedule.length===0 && (
            <span style={{fontSize:12,color:"var(--text3)"}}>
              יפרוס {manCount} שיעורים ב-{formatDate(manStartDate)}
            </span>
          )}
          {schedule.length>0 && (
            <span style={{fontSize:12,color:"#9b59b6",fontWeight:700}}>📅 {schedule.length} שיעורים בלוח</span>
          )}
        </div>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="page">
      {/* Tab header */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20,flexWrap:"wrap"}}>
        {[{k:"student",l:"🎒 ערכות לסטודנטים"},{k:"lesson",l:"🎬 ערכות שיעור"}].map(({k,l})=>(
          <button key={k} type="button" onClick={()=>setTabView(k)}
            style={{padding:"8px 20px",borderRadius:"var(--r-sm)",border:`2px solid ${tabView===k?"var(--accent)":"var(--border)"}`,background:tabView===k?"var(--accent-glow)":"transparent",color:tabView===k?"var(--accent)":"var(--text2)",fontWeight:700,fontSize:14,cursor:"pointer"}}>
            {l}
            <span style={{marginRight:6,background:tabView===k?"var(--accent)":"var(--surface3)",color:tabView===k?"#000":"var(--text3)",borderRadius:20,padding:"1px 7px",fontSize:11,fontWeight:900}}>
              {k==="student"?studentKits.length:lessonKits.length}
            </span>
          </button>
        ))}
        <div style={{marginRight:"auto",display:"flex",gap:8}}>
          {mode===null&&tabView==="student"&&<button className="btn btn-primary" onClick={()=>{setMode("student");setEditTarget(null);}}>➕ ערכה לסטודנט</button>}
          {mode===null&&tabView==="lesson"&&<button className="btn btn-primary" style={{background:"#9b59b6",borderColor:"#9b59b6"}} onClick={()=>{setMode("lesson");setEditTarget(null);}}>🎬 ערכת שיעור חדשה</button>}
        </div>
      </div>

      {/* Forms */}
      {(mode==="student"||mode==="editStudent")&&(
        <StudentKitForm initial={mode==="editStudent"?editTarget:null} onDone={()=>{setMode(null);setEditTarget(null);}}/>
      )}
      {(mode==="lesson"||mode==="editLesson")&&(
        <LessonKitForm initial={mode==="editLesson"?editTarget:null} onDone={()=>{setMode(null);setEditTarget(null);}}/>
      )}

      {/* Student kits list */}
      {tabView==="student"&&mode===null&&(
        studentKits.length===0
          ? <div className="empty-state"><div className="emoji">🎒</div><p>אין ערכות לסטודנטים</p><p style={{fontSize:13,color:"var(--text3)"}}>ערכות מוצגות בטופס ההשאלה</p></div>
          : <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {studentKits.map(kit=>(
              <div key={kit.id} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"14px 18px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:28}}>🎒</span>
                    <div>
                      <div style={{fontWeight:800,fontSize:15}}>{kit.name}</div>
                      <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
                        {kit.loanType
                          ? <span style={{background:"var(--accent-glow)",border:"1px solid var(--accent)",borderRadius:20,padding:"2px 8px",color:"var(--accent)",fontWeight:700}}>{LOAN_ICONS[kit.loanType]||"📦"} {kit.loanType}</span>
                          : <span>📦 כל סוגי ההשאלה</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <button className="btn btn-secondary btn-sm" onClick={()=>{setEditTarget(kit);setMode("editStudent");}}>✏️ ערוך</button>
                    <button className="btn btn-danger btn-sm" onClick={()=>del(kit.id,kit.name)}>🗑️</button>
                  </div>
                </div>
                <div style={{marginTop:10,display:"flex",flexWrap:"wrap",gap:4}}>
                  {(kit.items||[]).map((i,j)=>{
                    const eq=equipment.find(e=>e.id==i.equipment_id);
                    return <span key={j} className="chip">
                      {eq?.image&&(eq.image.startsWith("data:")||eq.image.startsWith("http"))?<img src={eq.image} alt="" style={{width:14,height:14,objectFit:"cover",borderRadius:2,verticalAlign:"middle"}}/>:<span>{eq?.image||"📦"}</span>}
                      {' '}{eq?.name||i.name} ×{i.quantity}
                    </span>;
                  })}
                </div>
              </div>
            ))}
          </div>
      )}

      {/* Lesson kits list */}
      {tabView==="lesson"&&mode===null&&(
        lessonKits.length===0
          ? <div className="empty-state"><div className="emoji">🎬</div><p>אין ערכות שיעור</p><p style={{fontSize:13,color:"var(--text3)"}}>ערכות שיעור משריינות ציוד לפי לוח שיעורים קבוע</p></div>
          : <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {lessonKits.map(kit=>{
              const nextSession = (kit.schedule||[]).find(s=>s.date>=today());
              return (
                <div key={kit.id} style={{background:"var(--surface)",border:"1px solid rgba(155,89,182,0.3)",borderRadius:"var(--r)",padding:"16px 18px"}}>
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                    <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
                      <span style={{fontSize:28}}>🎬</span>
                      <div>
                        <div style={{fontWeight:800,fontSize:15}}>{kit.name}</div>
                      {kit.instructorName&&<div style={{fontSize:12,color:"var(--text2)",marginTop:2}}>👨‍🏫 {kit.instructorName}{kit.instructorPhone?` · 📞 ${kit.instructorPhone}`:""}</div>}
                        {kit.instructorEmail&&<div style={{fontSize:11,color:"var(--text3)"}}>✉️ {kit.instructorEmail}</div>}
                        <div style={{marginTop:6,display:"flex",gap:6,flexWrap:"wrap"}}>
                          <span style={{background:"rgba(155,89,182,0.15)",border:"1px solid rgba(155,89,182,0.35)",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#9b59b6",fontWeight:700}}>
                            📅 {(kit.schedule||[]).length} שיעורים
                          </span>
                          {nextSession&&<span style={{background:"rgba(46,204,113,0.1)",border:"1px solid rgba(46,204,113,0.3)",borderRadius:20,padding:"2px 8px",fontSize:11,color:"var(--green)",fontWeight:700}}>
                            הבא: {formatDate(nextSession.date)} {nextSession.startTime}
                          </span>}
                        </div>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:6}}>
                      <button className="btn btn-secondary btn-sm" onClick={()=>{setEditTarget(kit);setMode("editLesson");}}>✏️ ערוך</button>
                      <button className="btn btn-danger btn-sm" onClick={()=>del(kit.id,kit.name)}>🗑️</button>
                    </div>
                  </div>
                  <div style={{marginTop:10,display:"flex",flexWrap:"wrap",gap:4}}>
                    {(kit.items||[]).map((i,j)=>{
                      const eq=equipment.find(e=>e.id==i.equipment_id);
                      return <span key={j} className="chip">
                        {eq?.image&&(eq.image.startsWith("data:")||eq.image.startsWith("http"))?<img src={eq.image} alt="" style={{width:14,height:14,objectFit:"cover",borderRadius:2,verticalAlign:"middle"}}/>:<span>{eq?.image||"📦"}</span>}
                        {' '}{eq?.name||i.name} ×{i.quantity}
                      </span>;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
      )}
    </div>
  );
}
