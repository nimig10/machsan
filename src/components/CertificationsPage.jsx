// CertificationsPage.jsx — certifications management only (students managed in StudentsPage)
import { useState } from "react";
import { storageSet } from "../utils.js";

const NIGHT_CERT_ID = "cert_night_studio";
const NIGHT_CERT_NAME = "הסמכת לילה לאולפנים";
const NIGHT_COLOR = "#9b59b6";

export function CertificationsPage({ certifications, setCertifications, showToast }) {
  const { types=[], students=[] } = certifications;
  const [newTypeName, setNewTypeName] = useState("");
  const [search, setSearch] = useState("");
  const [trackFilter, setTrackFilter] = useState("הכל");
  const [saving, setSaving] = useState(false);

  const save = async (updated) => {
    setSaving(true);
    setCertifications(updated);
    const r = await storageSet("certifications", updated);
    setSaving(false);
    if(!r.ok) showToast("error","❌ שגיאה בשמירה");
    return r.ok;
  };

  // Auto-create night certification if it doesn't exist
  const hasNightCert = types.some(t => t.id === NIGHT_CERT_ID);

  // All types including night cert (night cert always at the end)
  const regularTypes = types.filter(t => t.id !== NIGHT_CERT_ID);
  const nightType = types.find(t => t.id === NIGHT_CERT_ID);
  const allTypes = nightType ? [...regularTypes, nightType] : regularTypes;

  // ── Certification types ──
  const addType = async () => {
    const name = newTypeName.trim();
    if(!name) return;
    if(types.find(t=>t.name===name)) { showToast("error","הסמכה בשם זה כבר קיימת"); return; }
    const id = `cert_${Date.now()}`;
    const updated = { types:[...types,{id,name}], students };
    if(await save(updated)) { showToast("success",`הסמכה "${name}" נוספה`); setNewTypeName(""); }
  };

  const deleteType = async (typeId) => {
    if(!window.confirm("למחוק הסמכה זו? היא תוסר מכל הסטודנטים.")) return;
    const updated = {
      types: types.filter(t=>t.id!==typeId),
      students: students.map(s=>{ const c={...s.certs}; delete c[typeId]; return {...s,certs:c}; })
    };
    if(await save(updated)) showToast("success","ההסמכה נמחקה");
  };

  const toggleCert = async (stuId, typeId) => {
    const updated = {
      types,
      students: students.map(s => {
        if(s.id!==stuId) return s;
        const current = (s.certs||{})[typeId];
        const next = current==="עבר" ? "לא עבר" : "עבר";
        return {...s, certs:{...s.certs,[typeId]:next}};
      })
    };
    await save(updated);
  };

  const allTracks = ["הכל", ...new Set(students.map(s=>s.track||"").filter(Boolean))];
  const filteredStudents = students
    .filter(s=>
      (trackFilter==="הכל" || (s.track||"")===trackFilter) &&
      (!search || s.name?.includes(search) || s.email?.includes(search))
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
      {/* ── Certification types management ── */}
      <div className="card" style={{marginBottom:20}}>
        <div className="card-header">
          <div className="card-title">🎓 סוגי הסמכות</div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
          {types.map(t=>{
            const isNight = t.id === NIGHT_CERT_ID;
            return (
              <span key={t.id} style={{display:"flex",alignItems:"center",gap:6,background:isNight?NIGHT_COLOR+"15":"var(--surface2)",border:`1px solid ${isNight?NIGHT_COLOR:"var(--border)"}`,borderRadius:20,padding:"4px 14px",fontSize:13,fontWeight:700,color:isNight?NIGHT_COLOR:undefined}}>
                {isNight?"🌙":"🎓"} {t.name}
                <button onClick={()=>deleteType(t.id)} style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:14,padding:"0 2px",lineHeight:1}}>×</button>
              </span>
            );
          })}
          {types.length===0&&<span style={{fontSize:13,color:"var(--text3)"}}>אין הסמכות עדיין</span>}
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <input className="form-input" style={{flex:1,minWidth:180}} placeholder="שם הסמכה חדשה (למשל: מצלמות DSLR)"
            value={newTypeName} onChange={e=>setNewTypeName(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&addType()}/>
          <button className="btn btn-primary" onClick={addType} disabled={!newTypeName.trim()||saving}>➕ הוסף הסמכה</button>
          {!hasNightCert && (
            <button className="btn" style={{background:NIGHT_COLOR,color:"#fff",border:"none",fontWeight:700}} onClick={async()=>{
              const updated = { types:[...types,{id:NIGHT_CERT_ID,name:NIGHT_CERT_NAME}], students };
              if(await save(updated)) showToast("success",`הסמכת "${NIGHT_CERT_NAME}" נוספה`);
            }} disabled={saving}>🌙 הוסף הסמכת לילה</button>
          )}
        </div>
      </div>

      {types.length===0 ? (
        <div className="info" style={{padding:"12px 16px",background:"rgba(52,152,219,0.08)",border:"1px solid rgba(52,152,219,0.2)",borderRadius:"var(--r-sm)",fontSize:13,color:"var(--text2)"}}>
          💡 הוסף סוגי הסמכות למעלה, ואז סמן מי עבר כל הסמכה בטבלה למטה.
        </div>
      ) : (
        <>
          {/* ── Filter bar ── */}
          <div style={{display:"flex",gap:10,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
            <div className="search-bar" style={{flex:1,minWidth:180}}><span>🔍</span>
              <input placeholder="חיפוש סטודנט..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
            <span style={{fontSize:13,color:"var(--text3)"}}>סה״כ: <strong style={{color:"var(--text)"}}>{filteredStudents.length}</strong></span>
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

          {students.length===0 ? (
            <div className="empty-state"><div className="emoji">👨‍🎓</div><p>אין סטודנטים במערכת — הוסף אותם דרך "ניהול סטודנטים"</p></div>
          ) : filteredStudents.length===0 ? (
            <div className="empty-state"><div className="emoji">🔍</div><p>לא נמצאו סטודנטים</p></div>
          ) : (
            <>
              {/* Desktop — table */}
              <div className="cert-desktop" style={{overflowX:"auto",borderRadius:"var(--r)",border:"1px solid var(--border)"}}>
                <table style={{width:"100%",borderCollapse:"collapse",minWidth:480,direction:"rtl"}}>
                  <thead>
                    <tr style={{background:"var(--surface2)",borderBottom:"2px solid var(--border)"}}>
                      <th style={{padding:"10px 14px",textAlign:"right",fontWeight:800,fontSize:13,color:"var(--text2)",whiteSpace:"nowrap"}}>שם סטודנט</th>
                      <th style={{padding:"10px 14px",textAlign:"right",fontWeight:800,fontSize:13,color:"var(--text2)",whiteSpace:"nowrap"}}>מסלול</th>
                      {allTypes.map(t=>{
                        const isNight = t.id === NIGHT_CERT_ID;
                        return (
                          <th key={t.id} style={{padding:"10px 12px",textAlign:"center",fontWeight:800,fontSize:12,color:isNight?NIGHT_COLOR:"var(--accent)",whiteSpace:"nowrap",minWidth:110,background:isNight?NIGHT_COLOR+"08":undefined}}>
                            {isNight?"🌙":"🎓"} {t.name}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {(()=>{
                      const rows=[]; let lastTrack=undefined;
                      filteredStudents.forEach((s,i)=>{
                        const t=s.track||"";
                        if(t!==lastTrack){
                          rows.push(<tr key={`grp_${i}`}><td colSpan={allTypes.length+2} style={{background:"rgba(245,166,35,0.06)",padding:"5px 14px",fontWeight:800,fontSize:11,color:"var(--accent)",borderBottom:"1px solid var(--border)"}}>{t?"🎓 "+t:"📋 ללא מסלול"}</td></tr>);
                          lastTrack=t;
                        }
                        rows.push(<tr key={s.id} style={{borderBottom:"1px solid var(--border)",background:i%2===0?"var(--surface)":"var(--surface2)"}}>
                          <td style={{padding:"10px 14px",whiteSpace:"nowrap"}}>
                            <div style={{fontWeight:700,fontSize:14}}>{s.name}</div>
                            <div style={{fontSize:11,color:"var(--text3)"}}>{s.email}</div>
                          </td>
                          <td style={{padding:"10px 14px",whiteSpace:"nowrap"}}>
                            {s.track
                              ? <span style={{background:"rgba(245,166,35,0.1)",border:"1px solid rgba(245,166,35,0.3)",borderRadius:20,padding:"3px 10px",fontSize:11,color:"var(--accent)",fontWeight:700}}>{s.track}</span>
                              : <span style={{fontSize:11,color:"var(--text3)"}}>—</span>}
                          </td>
                          {allTypes.map(t=>{
                            const isNight = t.id === NIGHT_CERT_ID;
                            const passed = (s.certs||{})[t.id]==="עבר";
                            const passedColor = isNight ? NIGHT_COLOR : "var(--green)";
                            const passedBg = isNight ? NIGHT_COLOR+"20" : "rgba(46,204,113,0.15)";
                            return (
                              <td key={t.id} style={{padding:"8px 12px",textAlign:"center",background:isNight?NIGHT_COLOR+"05":undefined}}>
                                <button onClick={()=>toggleCert(s.id,t.id)} disabled={saving}
                                  style={{padding:"5px 12px",borderRadius:20,border:`2px solid ${passed?passedColor:"var(--border)"}`,background:passed?passedBg:"transparent",color:passed?passedColor:"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap",minWidth:100}}>
                                  {passed?(isNight?"🌙 עבר/ה":"✅ עבר/ה"):"⬜ לא עבר/ה"}
                                </button>
                              </td>
                            );
                          })}
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
                    <div style={{marginBottom:10}}>
                      <div style={{fontWeight:800,fontSize:15}}>{s.name}</div>
                      {s.track&&<div style={{fontSize:11,color:"var(--accent)",fontWeight:700}}>🎓 {s.track}</div>}
                    </div>
                    {allTypes.length>0&&(
                      <div style={{display:"flex",flexDirection:"column",gap:8}}>
                        {allTypes.map(t=>{
                          const isNight = t.id === NIGHT_CERT_ID;
                          const passed=(s.certs||{})[t.id]==="עבר";
                          const passedColor = isNight ? NIGHT_COLOR : "var(--green)";
                          const passedBg = isNight ? NIGHT_COLOR+"20" : "rgba(46,204,113,0.15)";
                          return (
                            <div key={t.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:isNight?NIGHT_COLOR+"08":undefined,borderRadius:8,padding:isNight?"6px 8px":undefined}}>
                              <span style={{fontSize:13,fontWeight:600,color:isNight?NIGHT_COLOR:undefined}}>{isNight?"🌙":"🎓"} {t.name}</span>
                              <button onClick={()=>toggleCert(s.id,t.id)} disabled={saving}
                                style={{padding:"5px 14px",borderRadius:20,border:`2px solid ${passed?passedColor:"var(--border)"}`,background:passed?passedBg:"transparent",color:passed?passedColor:"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer",minWidth:110,textAlign:"center"}}>
                                {passed?(isNight?"🌙 עבר/ה":"✅ עבר/ה"):"⬜ לא עבר/ה"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
