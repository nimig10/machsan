// StudentsPage.jsx — student management page (CRUD + import)
import { useState } from "react";
import { storageSet } from "../utils.js";
import { Modal } from "./ui.jsx";

const TRACK_LOAN_TYPES = ["פרטית", "הפקה", "סאונד", "קולנוע יומית"];
const normalizeTrackName = (value = "") => String(value || "").trim();
const buildTrackSettings = (students = [], existingTrackSettings = []) => {
  const existing = Array.isArray(existingTrackSettings) ? existingTrackSettings : [];
  const trackNames = [...new Set((students || []).map(student => normalizeTrackName(student?.track)).filter(Boolean))];
  return trackNames.map((name) => {
    const match = existing.find((setting) => normalizeTrackName(setting?.name) === name);
    const allowedLoanTypes = TRACK_LOAN_TYPES.filter((loanType) => Array.isArray(match?.loanTypes) && match.loanTypes.includes(loanType));
    return {
      name,
      loanTypes: allowedLoanTypes.length ? allowedLoanTypes : [...TRACK_LOAN_TYPES],
    };
  });
};

export function StudentsPage({ certifications, setCertifications, showToast }) {
  const { types = [], students = [] } = certifications;
  const trackSettings = buildTrackSettings(students, certifications?.trackSettings);
  const [addingStudent, setAddingStudent] = useState(false);
  const [studentForm, setStudentForm] = useState({ name:"", email:"", phone:"", track:"" });
  const [editStudent, setEditStudent] = useState(null);
  const [editForm, setEditForm] = useState({ name:"", email:"", phone:"", track:"" });
  const [editTrack, setEditTrack] = useState(null);
  const [editTrackName, setEditTrackName] = useState("");
  const [search, setSearch] = useState("");
  const [trackFilter, setTrackFilter] = useState("הכל");
  const [saving, setSaving] = useState(false);
  const [xlImporting, setXlImporting] = useState(false);

  const save = async (updatedPatch) => {
    const nextStudents = updatedPatch?.students ?? students;
    const nextTypes = updatedPatch?.types ?? types;
    const nextTrackSettings = buildTrackSettings(nextStudents, updatedPatch?.trackSettings ?? certifications?.trackSettings);
    const updated = {
      ...certifications,
      ...updatedPatch,
      types: nextTypes,
      students: nextStudents,
      trackSettings: nextTrackSettings,
    };
    setSaving(true);
    setCertifications(updated);
    const r = await storageSet("certifications", updated);
    setSaving(false);
    if(!r.ok) showToast("error","❌ שגיאה בשמירה");
    return r.ok;
  };

  // ── Add student ──
  const addStudent = async () => {
    const { name, email, phone } = studentForm;
    if(!name.trim()||!email.trim()) return;
    if(students.find(s=>s.email?.toLowerCase()===email.toLowerCase().trim())) {
      showToast("error","סטודנט עם מייל זה כבר קיים"); return;
    }
    const id = `stu_${Date.now()}`;
    const updated = { types, students:[...students,{id,name:name.trim(),email:email.toLowerCase().trim(),phone:phone.trim(),track:studentForm.track.trim(),certs:{}}] };
    if(await save(updated)) {
      showToast("success",`${name} נוסף/ה`);
      setStudentForm({name:"",email:"",phone:"",track:""});
      setAddingStudent(false);
    }
  };

  // ── Delete student ──
  const deleteStudent = async (stuId) => {
    if(!window.confirm("למחוק סטודנט זה?")) return;
    const updated = { types, students: students.filter(s=>s.id!==stuId) };
    if(await save(updated)) showToast("success","הסטודנט הוסר");
  };

  // ── Edit student ──
  const saveEdit = async () => {
    const name = editForm.name.trim();
    const email = editForm.email.toLowerCase().trim();
    if(!name||!email) return;
    const dup = students.find(s=>s.email===email && s.id!==editStudent.id);
    if(dup) { showToast("error","מייל זה כבר קיים לסטודנט אחר"); return; }
    const updated = { types, students: students.map(s=>s.id===editStudent.id ? {...s,name,email,phone:editForm.phone.trim(),track:editForm.track?.trim()||""} : s) };
    if(await save(updated)) { showToast("success","פרטי הסטודנט עודכנו"); setEditStudent(null); }
  };

  const openTrackEditor = (trackName) => {
    setEditTrack(trackName);
    setEditTrackName(trackName);
  };

  const saveTrackEdit = async () => {
    const previousTrackName = normalizeTrackName(editTrack);
    const nextTrackName = normalizeTrackName(editTrackName);
    if (!previousTrackName || !nextTrackName) {
      showToast("error", "יש למלא שם מסלול לימודים");
      return;
    }
    if (previousTrackName === nextTrackName) {
      setEditTrack(null);
      return;
    }
    if (trackSettings.some((setting) => normalizeTrackName(setting.name) === nextTrackName)) {
      showToast("error", "מסלול לימודים בשם זה כבר קיים");
      return;
    }
    const updatedStudents = students.map((student) => (
      normalizeTrackName(student.track) === previousTrackName
        ? { ...student, track: nextTrackName }
        : student
    ));
    const updatedTrackSettings = trackSettings.map((setting) => (
      normalizeTrackName(setting.name) === previousTrackName
        ? { ...setting, name: nextTrackName }
        : setting
    ));
    if (await save({ types, students: updatedStudents, trackSettings: updatedTrackSettings })) {
      showToast("success", `שם המסלול עודכן ל־${nextTrackName}`);
      if (trackFilter === previousTrackName) setTrackFilter(nextTrackName);
      setEditTrack(null);
      setEditTrackName("");
    }
  };

  // ── Import XL ──
  const importXL = async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    setXlImporting(true);
    e.target.value = "";
    try {
      const isXlsx = /\.xlsx?$/i.test(file.name);
      const processRows = async (rows) => {
        if(!rows.length) { showToast("error","הקובץ ריק"); setXlImporting(false); return; }
        const headers = rows[0].map(h=>{
          let s = String(h||"").trim();
          s = s.replace(/[\uFEFF\u200B-\u200D\u00A0]/g,"");
          return s.toLowerCase();
        });
        const nameIdx  = headers.findIndex(h=>h.includes("שם")||h.includes("name"));
        const emailIdx = headers.findIndex(h=>h.includes("מייל")||h.includes("mail")||h.includes("email")||h.includes("אימייל")||h.includes("e-mail")||h.includes("@"));
        const phoneIdx = headers.findIndex(h=>h.includes("טלפון")||h.includes("phone")||h.includes("tel")||h.includes("נייד")||h.includes("מספר"));
        const trackIdx = headers.findIndex(h=>h.includes("מסלול")||h.includes("קבוצה")||h.includes("כיתה")||h.includes("track")||h.includes("group")||h.includes("class"));
        if(emailIdx===-1) {
          const autoEmailIdx = rows[1] ? rows[1].findIndex(c=>String(c||"").includes("@")) : -1;
          if(autoEmailIdx<0) { showToast("error",`לא נמצאה עמודת מייל. כותרות: "${headers.join('", "')}"`); setXlImporting(false); return; }
        }
        const eIdx = emailIdx >= 0 ? emailIdx : rows[1].findIndex(c=>String(c||"").includes("@"));
        let added=0, skipped=0;
        const newStudents = [...students];
        for(let i=1;i<rows.length;i++) {
          const row = rows[i];
          const email = String(row[eIdx]||"").toLowerCase().trim();
          const name  = nameIdx>=0 ? String(row[nameIdx]||"").trim() : "";
          const phone = phoneIdx>=0 ? String(row[phoneIdx]||"").trim() : "";
          if(!email||!email.includes("@")) { skipped++; continue; }
          if(newStudents.find(s=>s.email===email)) { skipped++; continue; }
          const track = trackIdx>=0 ? String(rows[i][trackIdx]||"").trim() : "";
          newStudents.push({ id:`stu_${Date.now()}_${i}`, name:name||email, email, phone, track, certs:{} });
          added++;
        }
        const updated = { types, students: newStudents };
        if(await save(updated)) showToast("success", `✅ יובאו ${added} סטודנטים${skipped>0?` · ${skipped} דולגו`:""}`);
        setXlImporting(false);
      };

      if(isXlsx) {
        if(!window.XLSX) {
          await new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
            s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
          });
        }
        const buf = await file.arrayBuffer();
        const wb  = window.XLSX.read(buf, { type:"array" });
        const ws  = wb.Sheets[wb.SheetNames[0]];
        const rows = window.XLSX.utils.sheet_to_json(ws, { header:1, defval:"" });
        await processRows(rows);
      } else {
        const reader = new FileReader();
        reader.onload = async (ev) => {
          try {
            const text = ev.target.result;
            const lines = text.split(/\r?\n/).filter(l=>l.trim());
            const sep = lines[0]?.includes("\t") ? "\t" : ",";
            const rows = lines.map(l=>l.split(sep).map(c=>c.trim().replace(/^"|"$/g,"")));
            await processRows(rows);
          } catch { showToast("error","שגיאה בקריאת הקובץ"); setXlImporting(false); }
        };
        reader.readAsText(file, "UTF-8");
      }
    } catch(err) {
      console.error("importXL error:", err);
      showToast("error","שגיאה בייבוא הקובץ");
      setXlImporting(false);
    }
  };

  // ── Filtering ──
  const allTracks = ["הכל", ...trackSettings.map((setting) => setting.name)];
  const filteredStudents = students
    .filter(s=>
      (trackFilter==="הכל" || (s.track||"")=== trackFilter) &&
      (!search || s.name?.includes(search) || s.email?.includes(search) || s.phone?.includes(search))
    )
    .sort((a, b) => {
      const ta = a.track || "";
      const tb = b.track || "";
      if (ta === tb) return 0;
      if (!ta) return 1;
      if (!tb) return -1;
      return ta.localeCompare(tb, "he");
    });

  return (
    <div className="page" style={{direction:"rtl"}}>
      {/* ── Add student form ── */}
      {addingStudent ? (
        <div className="card" style={{marginBottom:20}}>
          <div className="card-header">
            <div className="card-title">➕ הוספת סטודנט</div>
            <button className="btn btn-secondary btn-sm" onClick={()=>setAddingStudent(false)}>✕ ביטול</button>
          </div>
          <div className="grid-2" style={{marginBottom:12}}>
            <div className="form-group"><label className="form-label">שם מלא *</label>
              <input className="form-input" value={studentForm.name} onChange={e=>setStudentForm(p=>({...p,name:e.target.value}))} placeholder="שם מלא"/></div>
            <div className="form-group"><label className="form-label">אימייל *</label>
              <input className="form-input" type="email" value={studentForm.email} onChange={e=>setStudentForm(p=>({...p,email:e.target.value}))} placeholder="email@example.com"/></div>
          </div>
          <div className="form-group"><label className="form-label">טלפון</label>
            <input className="form-input" value={studentForm.phone} onChange={e=>setStudentForm(p=>({...p,phone:e.target.value}))} placeholder="05x-xxxxxxx"/></div>
          <div className="form-group"><label className="form-label">מסלול לימודים</label>
            <datalist id="track-list-add">
              {[...new Set(students.map(s=>s.track||"").filter(Boolean))].map(t=><option key={t} value={t}/>)}
            </datalist>
            <input className="form-input" list="track-list-add" value={studentForm.track||""} onChange={e=>setStudentForm(p=>({...p,track:e.target.value}))} placeholder='למשל: "הנדסאי קולנוע ב"'/></div>
          <div style={{marginTop:12,display:"flex",gap:8}}>
            <button className="btn btn-primary" disabled={!studentForm.name.trim()||!studentForm.email.trim()||saving} onClick={addStudent}>
              {saving?"⏳ שומר...":"✅ הוסף סטודנט"}
            </button>
          </div>
        </div>
      ) : (
        <>
        <div style={{display:"flex",gap:10,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
          <button className="btn btn-primary" onClick={()=>setAddingStudent(true)}>➕ הוספת סטודנט</button>
          <label style={{cursor:"pointer"}}>
            <input type="file" accept=".csv,.tsv,.txt,.xls,.xlsx" style={{display:"none"}} onChange={importXL} disabled={xlImporting}/>
            <span className="btn btn-secondary" style={{pointerEvents:"none"}}>
              {xlImporting ? "⏳ מייבא..." : "📊 ייבוא מטבלה"}
            </span>
          </label>
          <div className="search-bar" style={{flex:1,minWidth:180}}><span>🔍</span>
            <input placeholder="חיפוש לפי שם, מייל או טלפון..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
          <span style={{fontSize:13,color:"var(--text3)"}}>סה״כ: <strong style={{color:"var(--text)"}}>{filteredStudents.length}</strong> / {students.length}</span>
        </div>
        {allTracks.length>1&&(
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
            {allTracks.map(t=>(
              <button key={t} type="button" onClick={()=>setTrackFilter(t)}
                style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${trackFilter===t?"var(--accent)":"var(--border)"}`,background:trackFilter===t?"var(--accent-glow)":"transparent",color:trackFilter===t?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                {t==="הכל"?"📦 כל המסלולים":"🎓 "+t}
              </button>
            ))}
          </div>
        )}
        {trackSettings.length>0 && (
          <div style={{marginBottom:16,padding:"12px 14px",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)"}}>
            <div style={{fontSize:12,fontWeight:800,color:"var(--accent)",marginBottom:8}}>ניהול מסלולי לימודים</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {trackSettings.map((setting) => (
                <div key={setting.name} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 10px",borderRadius:20,border:"1px solid var(--border)",background:"var(--surface3)"}}>
                  <span style={{fontSize:12,fontWeight:700,color:"var(--text2)"}}>🎓 {setting.name}</span>
                  <button className="btn btn-secondary btn-sm" onClick={()=>openTrackEditor(setting.name)}>✏️</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
      )}

      {/* ── Students list ── */}
      {filteredStudents.length===0 && !addingStudent ? (
        <div className="empty-state"><div className="emoji">👨‍🎓</div><p>{search?"לא נמצאו סטודנטים":"לא נוספו סטודנטים עדיין"}</p></div>
      ) : (
        <>
          {/* Desktop — table */}
          <div className="cert-desktop" style={{overflowX:"auto",borderRadius:"var(--r)",border:"1px solid var(--border)"}}>
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:480,direction:"rtl"}}>
              <thead>
                <tr style={{background:"var(--surface2)",borderBottom:"2px solid var(--border)"}}>
                  <th style={thS}>שם סטודנט</th>
                  <th style={thS}>אימייל</th>
                  <th style={thS}>טלפון</th>
                  <th style={thS}>מסלול לימודים</th>
                  <th style={{...thS,textAlign:"center",width:90}}>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {(()=>{
                  const rows=[]; let lastTrack=undefined;
                  filteredStudents.forEach((s,i)=>{
                    const t=s.track||"";
                    if(t!==lastTrack){
                      rows.push(<tr key={`grp_${i}`}><td colSpan={5} style={{background:"rgba(245,166,35,0.06)",padding:"5px 14px",fontWeight:800,fontSize:11,color:"var(--accent)",borderBottom:"1px solid var(--border)",letterSpacing:0.5}}>{t?"🎓 "+t:"📋 ללא מסלול"}</td></tr>);
                      lastTrack=t;
                    }
                    rows.push(<tr key={s.id} style={{borderBottom:"1px solid var(--border)",background:i%2===0?"var(--surface)":"var(--surface2)"}}>
                      <td style={tdS}><div style={{fontWeight:700,fontSize:14}}>{s.name}</div></td>
                      <td style={{...tdS,fontSize:12,color:"var(--text3)"}}>{s.email}</td>
                      <td style={{...tdS,fontSize:12,color:"var(--text3)"}}>{s.phone||"—"}</td>
                      <td style={tdS}>
                        {s.track
                          ? <span style={{background:"rgba(245,166,35,0.1)",border:"1px solid rgba(245,166,35,0.3)",borderRadius:20,padding:"3px 10px",fontSize:11,color:"var(--accent)",fontWeight:700}}>🎓 {s.track}</span>
                          : <span style={{fontSize:11,color:"var(--text3)"}}>—</span>}
                      </td>
                      <td style={{...tdS,textAlign:"center"}}>
                        <div style={{display:"flex",gap:4,justifyContent:"center"}}>
                          <button className="btn btn-secondary btn-sm" onClick={()=>{setEditStudent(s);setEditForm({name:s.name,email:s.email,phone:s.phone||"",track:s.track||""});}}>✏️</button>
                          <button className="btn btn-secondary btn-sm" style={{color:"var(--red)",borderColor:"var(--red)"}} onClick={()=>deleteStudent(s.id)}>🗑️</button>
                        </div>
                      </td>
                    </tr>);
                  });
                  return rows;
                })()}
              </tbody>
            </table>
          </div>

          {/* Mobile — cards */}
          <div className="cert-mobile" style={{flexDirection:"column",gap:10}}>
            {filteredStudents.map(s=>(
              <div key={s.id} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"14px 16px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:15}}>{s.name}</div>
                    {s.track&&<div style={{fontSize:11,color:"var(--accent)",fontWeight:700}}>🎓 {s.track}</div>}
                    <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{s.email}</div>
                    {s.phone&&<div style={{fontSize:11,color:"var(--text3)"}}>{s.phone}</div>}
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <button className="btn btn-secondary btn-sm" onClick={()=>{setEditStudent(s);setEditForm({name:s.name,email:s.email,phone:s.phone||"",track:s.track||""});}}>✏️</button>
                    <button className="btn btn-secondary btn-sm" style={{color:"var(--red)",borderColor:"var(--red)"}} onClick={()=>deleteStudent(s.id)}>🗑️</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Edit student modal ── */}
      {editStudent&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}}
          onClick={e=>e.target===e.currentTarget&&setEditStudent(null)}>
          <div style={{width:"100%",maxWidth:460,background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",direction:"rtl"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:"1px solid var(--border)",background:"var(--surface2)",borderRadius:"16px 16px 0 0"}}>
              <div style={{fontWeight:900,fontSize:16}}>✏️ עריכת סטודנט</div>
              <button className="btn btn-secondary btn-sm" onClick={()=>setEditStudent(null)}>✕</button>
            </div>
            <div style={{padding:"20px"}}>
              <div className="grid-2" style={{marginBottom:12}}>
                <div className="form-group"><label className="form-label">שם מלא *</label>
                  <input className="form-input" value={editForm.name} onChange={e=>setEditForm(p=>({...p,name:e.target.value}))}/></div>
                <div className="form-group"><label className="form-label">אימייל *</label>
                  <input className="form-input" type="email" value={editForm.email} onChange={e=>setEditForm(p=>({...p,email:e.target.value}))}/></div>
              </div>
              <div className="form-group"><label className="form-label">טלפון</label>
                <input className="form-input" value={editForm.phone} onChange={e=>setEditForm(p=>({...p,phone:e.target.value}))}/></div>
              <div className="form-group"><label className="form-label">מסלול לימודים</label>
                <datalist id="track-list-edit-stu">
                  {[...new Set(students.map(s=>s.track||"").filter(Boolean))].map(t=><option key={t} value={t}/>)}
                </datalist>
                <input className="form-input" list="track-list-edit-stu" value={editForm.track||""} onChange={e=>setEditForm(p=>({...p,track:e.target.value}))} placeholder='למשל: "הנדסאי קולנוע ב"'/></div>
              <div style={{display:"flex",gap:8,marginTop:16}}>
                <button className="btn btn-primary" disabled={!editForm.name.trim()||!editForm.email.trim()||saving} onClick={saveEdit}>
                  {saving?"⏳ שומר...":"💾 שמור שינויים"}
                </button>
                <button className="btn btn-secondary" onClick={()=>setEditStudent(null)}>ביטול</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {editTrack && (
        <Modal
          title="✏️ עריכת מסלול לימודים"
          onClose={()=>{ setEditTrack(null); setEditTrackName(""); }}
          footer={(
            <>
              <button className="btn btn-primary" onClick={saveTrackEdit} disabled={!editTrackName.trim() || saving}>
                {saving ? "⏳ שומר..." : "💾 שמור"}
              </button>
              <button className="btn btn-secondary" onClick={()=>{ setEditTrack(null); setEditTrackName(""); }}>
                ביטול
              </button>
            </>
          )}
        >
          <div className="form-group" style={{marginBottom:0}}>
            <label className="form-label">שם מסלול לימודים</label>
            <input className="form-input" value={editTrackName} onChange={e=>setEditTrackName(e.target.value)} placeholder="שם המסלול"/>
          </div>
        </Modal>
      )}
    </div>
  );
}

const thS = { padding:"10px 14px", textAlign:"right", fontWeight:800, fontSize:13, color:"var(--text2)", whiteSpace:"nowrap" };
const tdS = { padding:"10px 14px", whiteSpace:"nowrap" };
