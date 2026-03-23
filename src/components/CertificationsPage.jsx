// CertificationsPage.jsx — certifications management with equipment/studio modes
import { useState } from "react";
import { storageSet } from "../utils.js";
import { Modal } from "./ui.jsx";

const NIGHT_CERT_ID = "cert_night_studio";
const NIGHT_CERT_NAME = "הסמכת לילה לאולפנים";
const NIGHT_COLOR = "#2196f3";

export function CertificationsPage({ certifications, setCertifications, showToast, studios=[], setStudios, equipment=[], setEquipment }) {
  const { types=[], students=[] } = certifications;
  const [certMode, setCertMode] = useState("equipment");
  const [newTypeName, setNewTypeName] = useState("");
  const [newStudioIds, setNewStudioIds] = useState([]);
  const [search, setSearch] = useState("");
  const [trackFilter, setTrackFilter] = useState("הכל");
  const [saving, setSaving] = useState(false);
  const [editCert, setEditCert] = useState(null); // {id, name, studioIds}
  const [editEquipmentCert, setEditEquipmentCert] = useState(null); // {id, name, equipmentIds}
  const [eqTypeF, setEqTypeF] = useState("all");
  const [eqCatF, setEqCatF] = useState([]);
  const [eqSearch, setEqSearch] = useState("");
  const [eqShowSelected, setEqShowSelected] = useState(false);

  const save = async (updated) => {
    setSaving(true);
    setCertifications(updated);
    const r = await storageSet("certifications", updated);
    setSaving(false);
    if(!r.ok) showToast("error","❌ שגיאה בשמירה");
    return r.ok;
  };

  const getStudioCertIds = (studio) => {
    if (Array.isArray(studio?.studioCertIds)) return studio.studioCertIds.filter(Boolean);
    return studio?.studioCertId ? [studio.studioCertId] : [];
  };
  const withStudioCertIds = (studio, nextIds) => {
    const ids = [...new Set((nextIds || []).filter(Boolean))];
    return { ...studio, studioCertIds: ids, studioCertId: ids[0] || undefined };
  };

  const isStudioType = (t) => t.category === "studio" || t.id === NIGHT_CERT_ID;
  const equipmentTypes = types.filter(t => !isStudioType(t));
  const studioTypes = types.filter(t => isStudioType(t));
  const activeTypes = certMode === "equipment" ? equipmentTypes : studioTypes;
  const equipmentCategories = [...new Set((equipment || []).map(eq => eq.category).filter(Boolean))];

  const hasNightCert = types.some(t => t.id === NIGHT_CERT_ID);

  const openEditEquipmentCert = (t) => {
    const linkedIds = (equipment || []).filter(eq => eq.certification_id === t.id).map(eq => eq.id);
    setEqTypeF("all");
    setEqCatF([]);
    setEqSearch("");
    setEqShowSelected(false);
    setEditEquipmentCert({ id: t.id, name: t.name, equipmentIds: linkedIds });
  };

  const addType = async () => {
    const name = newTypeName.trim();
    if(!name) return;
    if(types.find(t=>t.name===name)) { showToast("error","הסמכה בשם זה כבר קיימת"); return; }
    const id = `cert_${Date.now()}`;
    const newType = certMode === "studio" ? { id, name, category: "studio" } : { id, name };
    const updated = { types:[...types, newType], students };
    if(await save(updated)) {
      if (certMode === "studio" && newStudioIds.length > 0 && setStudios) {
        const updatedStudios = studios.map(s => {
          if (!newStudioIds.includes(s.id)) return s;
          return withStudioCertIds(s, [...getStudioCertIds(s), id]);
        });
        setStudios(updatedStudios);
        await storageSet("studios", updatedStudios);
      }
      showToast("success", `הסמכה "${name}" נוספה`);
      setNewTypeName("");
      setNewStudioIds([]);
    }
  };

  const deleteType = async (typeId) => {
    if(!window.confirm("למחוק הסמכה זו? היא תוסר מכל הסטודנטים.")) return;
    const updated = {
      types: types.filter(t=>t.id!==typeId),
      students: students.map(s=>{ const c={...s.certs}; delete c[typeId]; return {...s,certs:c}; })
    };
    if(await save(updated)) {
      if (setStudios && isStudioType(types.find(t=>t.id===typeId)||{})) {
        const updatedStudios = studios.map(s => withStudioCertIds(s, getStudioCertIds(s).filter(id => id !== typeId)));
        setStudios(updatedStudios);
        await storageSet("studios", updatedStudios);
      }
      if (setEquipment && !isStudioType(types.find(t=>t.id===typeId)||{})) {
        const updatedEquipment = equipment.map(eq => eq.certification_id === typeId ? { ...eq, certification_id: "" } : eq);
        setEquipment(updatedEquipment);
        await storageSet("equipment", updatedEquipment);
      }
      showToast("success","ההסמכה נמחקה");
    }
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

  const toggleNewStudioId = (id) => {
    setNewStudioIds(ids => ids.includes(id) ? ids.filter(i=>i!==id) : [...ids, id]);
  };

  const openEditCert = (t) => {
    const linkedIds = studios.filter(s => getStudioCertIds(s).includes(t.id)).map(s => s.id);
    setEditCert({ id: t.id, name: t.name, studioIds: linkedIds });
  };

  const saveEditCert = async () => {
    if (!editCert) return;
    const name = editCert.name.trim();
    if (!name) return;
    if (types.find(t => t.name === name && t.id !== editCert.id)) { showToast("error","הסמכה בשם זה כבר קיימת"); return; }
    const updated = {
      types: types.map(t => t.id === editCert.id ? { ...t, name } : t),
      students
    };
    if (await save(updated)) {
      if (setStudios && isStudioType(types.find(t => t.id === editCert.id) || {})) {
        const updatedStudios = studios.map(s => {
          const ids = new Set(getStudioCertIds(s));
          if (editCert.studioIds.includes(s.id)) ids.add(editCert.id);
          else ids.delete(editCert.id);
          return withStudioCertIds(s, [...ids]);
        });
        setStudios(updatedStudios);
        await storageSet("studios", updatedStudios);
      }
      showToast("success", `הסמכה "${name}" עודכנה`);
      setEditCert(null);
    }
  };

  const saveEditEquipmentCert = async () => {
    if (!editEquipmentCert) return;
    const name = editEquipmentCert.name.trim();
    if (!name) return;
    if (types.find(t => t.name === name && t.id !== editEquipmentCert.id)) {
      showToast("error","הסמכה בשם זה כבר קיימת");
      return;
    }
    const updatedCertifications = {
      types: types.map(t => t.id === editEquipmentCert.id ? { ...t, name } : t),
      students
    };
    if (!(await save(updatedCertifications))) return;
    if (setEquipment) {
      const updatedEquipment = equipment.map(eq => {
        if (editEquipmentCert.equipmentIds.includes(eq.id)) return { ...eq, certification_id: editEquipmentCert.id };
        if (eq.certification_id === editEquipmentCert.id) return { ...eq, certification_id: "" };
        return eq;
      });
      setEquipment(updatedEquipment);
      await storageSet("equipment", updatedEquipment);
    }
    showToast("success", `הסמכת ציוד "${name}" עודכנה`);
    setEditEquipmentCert(null);
  };

  const toggleEditStudioId = (id) => {
    setEditCert(ec => ({ ...ec, studioIds: ec.studioIds.includes(id) ? ec.studioIds.filter(i => i !== id) : [...ec.studioIds, id] }));
  };
  const toggleEditEquipmentId = (id) => {
    setEditEquipmentCert(ec => ({ ...ec, equipmentIds: ec.equipmentIds.includes(id) ? ec.equipmentIds.filter(i => i !== id) : [...ec.equipmentIds, id] }));
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
      {/* Mode Toggle */}
      <div style={{display:"flex",gap:0,marginBottom:16,borderRadius:10,overflow:"hidden",border:"1px solid var(--border)",width:"fit-content"}}>
        <button onClick={()=>setCertMode("equipment")}
          style={{padding:"10px 24px",border:"none",background:certMode==="equipment"?"var(--accent)":"var(--surface2)",color:certMode==="equipment"?"#000":"var(--text3)",fontWeight:800,fontSize:14,cursor:"pointer",transition:"all 0.15s"}}>
          📦 הסמכת ציוד
        </button>
        <button onClick={()=>setCertMode("studio")}
          style={{padding:"10px 24px",border:"none",borderRight:"1px solid var(--border)",background:certMode==="studio"?"var(--accent)":"var(--surface2)",color:certMode==="studio"?"#000":"var(--text3)",fontWeight:800,fontSize:14,cursor:"pointer",transition:"all 0.15s"}}>
          🎙️ הסמכת אולפן
        </button>
      </div>

      {/* Certification types panel */}
      <div className="card" style={{marginBottom:20}}>
        <div className="card-header">
          <div className="card-title">{certMode==="equipment" ? "🎓 סוגי הסמכות ציוד" : "🎙️ סוגי הסמכות אולפן"}</div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
          {activeTypes.map(t=>{
            const isNight = t.id === NIGHT_CERT_ID;
            return (
              <span key={t.id} style={{display:"flex",alignItems:"center",gap:6,background:isNight?NIGHT_COLOR+"15":"var(--surface2)",border:`1px solid ${isNight?NIGHT_COLOR:"var(--border)"}`,borderRadius:20,padding:"4px 14px",fontSize:13,fontWeight:700,color:isNight?NIGHT_COLOR:undefined,cursor:"pointer"}}
                onClick={()=>{
                  if (certMode==="studio" && !isNight) openEditCert(t);
                  if (certMode==="equipment") openEditEquipmentCert(t);
                }}>
                {isNight?"🌙":certMode==="studio"?"🎙️":"🎓"} {t.name}
                <button onClick={e=>{e.stopPropagation();deleteType(t.id);}} style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:14,padding:"0 2px",lineHeight:1}}>×</button>
              </span>
            );
          })}
          {activeTypes.length===0&&<span style={{fontSize:13,color:"var(--text3)"}}>
            {certMode==="equipment"?"אין הסמכות ציוד עדיין":"אין הסמכות אולפן עדיין"}
          </span>}
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <input className="form-input" style={{flex:1,minWidth:180}}
            placeholder={certMode==="equipment"?"שם הסמכה חדשה (למשל: מצלמות DSLR)":"שם הסמכת אולפן חדשה (למשל: אולפן טלוויזיה)"}
            value={newTypeName} onChange={e=>setNewTypeName(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&addType()}/>
          <button className="btn btn-primary" onClick={addType} disabled={!newTypeName.trim()||saving}>
            {certMode==="equipment"?"➕ הוסף הסמכת ציוד":"➕ הוסף הסמכת אולפן"}
          </button>
          {certMode==="studio" && !hasNightCert && (
            <button className="btn" style={{background:NIGHT_COLOR,color:"#fff",border:"none",fontWeight:700}} onClick={async()=>{
              const updated = { types:[...types,{id:NIGHT_CERT_ID,name:NIGHT_CERT_NAME,category:"studio"}], students };
              if(await save(updated)) showToast("success",`הסמכת "${NIGHT_CERT_NAME}" נוספה`);
            }} disabled={saving}>🌙 הוסף הסמכת לילה</button>
          )}
        </div>
        {certMode==="studio" && newTypeName.trim() && studios.length>0 && (
          <div style={{marginTop:12,padding:12,background:"var(--surface2)",borderRadius:8,border:"1px solid var(--border)"}}>
            <div style={{fontSize:12,fontWeight:700,color:"var(--text2)",marginBottom:8}}>🎙️ סווג אולפנים להסמכה זו:</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {studios.map(s=>{
                const existingCerts = studioTypes.filter(t=>getStudioCertIds(s).includes(t.id));
                return (
                  <label key={s.id} style={{display:"flex",alignItems:"center",gap:6,fontSize:13,cursor:"pointer",padding:"4px 10px",borderRadius:8,border:`1px solid ${newStudioIds.includes(s.id)?"var(--accent)":"var(--border)"}`,background:newStudioIds.includes(s.id)?"var(--accent-glow)":"transparent"}}>
                    <input type="checkbox" checked={newStudioIds.includes(s.id)} onChange={()=>toggleNewStudioId(s.id)} style={{accentColor:"var(--accent)"}}/>
                    {s.name}
                    {existingCerts.length>0 && !newStudioIds.includes(s.id) && <span style={{fontSize:10,color:"var(--text3)"}}>(כרגע: {existingCerts.map(t=>t.name).join(", ")})</span>}
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {activeTypes.length===0 ? (
        <div className="info" style={{padding:"12px 16px",background:"rgba(52,152,219,0.08)",border:"1px solid rgba(52,152,219,0.2)",borderRadius:"var(--r-sm)",fontSize:13,color:"var(--text2)"}}>
          💡 {certMode==="equipment"
            ?"הוסף סוגי הסמכות ציוד למעלה, ואז סמן מי עבר כל הסמכה בטבלה למטה."
            :"הוסף סוגי הסמכות אולפן למעלה, ואז סמן מי עבר כל הסמכה בטבלה למטה."}
        </div>
      ) : (
        <>
          {/* Filter bar */}
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
              {/* Desktop table */}
              <div className="cert-desktop" style={{overflowX:"auto",borderRadius:"var(--r)",border:"1px solid var(--border)"}}>
                <table style={{width:"100%",borderCollapse:"collapse",minWidth:480,direction:"rtl"}}>
                  <thead>
                    <tr style={{background:"var(--surface2)",borderBottom:"2px solid var(--border)"}}>
                      <th style={{padding:"10px 14px",textAlign:"right",fontWeight:800,fontSize:13,color:"var(--text2)",whiteSpace:"nowrap"}}>שם סטודנט</th>
                      <th style={{padding:"10px 14px",textAlign:"right",fontWeight:800,fontSize:13,color:"var(--text2)",whiteSpace:"nowrap"}}>מסלול</th>
                      {activeTypes.map(t=>{
                        const isNight = t.id === NIGHT_CERT_ID;
                        return (
                          <th key={t.id} style={{padding:"10px 12px",textAlign:"center",fontWeight:800,fontSize:12,color:isNight?NIGHT_COLOR:"var(--accent)",whiteSpace:"nowrap",minWidth:110,background:isNight?NIGHT_COLOR+"08":undefined}}>
                            {isNight?"🌙":certMode==="studio"?"🎙️":"🎓"} {t.name}
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
                          rows.push(<tr key={`grp_${i}`}><td colSpan={activeTypes.length+2} style={{background:"rgba(245,166,35,0.06)",padding:"5px 14px",fontWeight:800,fontSize:11,color:"var(--accent)",borderBottom:"1px solid var(--border)"}}>{t?"🎓 "+t:"📋 ללא מסלול"}</td></tr>);
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
                          {activeTypes.map(t=>{
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

              {/* Mobile cards */}
              <div className="cert-mobile" style={{flexDirection:"column",gap:10}}>
                {filteredStudents.map(s=>(
                  <div key={s.id} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"14px 16px"}}>
                    <div style={{marginBottom:10}}>
                      <div style={{fontWeight:800,fontSize:15}}>{s.name}</div>
                      {s.track&&<div style={{fontSize:11,color:"var(--accent)",fontWeight:700}}>🎓 {s.track}</div>}
                    </div>
                    {activeTypes.length>0&&(
                      <div style={{display:"flex",flexDirection:"column",gap:8}}>
                        {activeTypes.map(t=>{
                          const isNight = t.id === NIGHT_CERT_ID;
                          const passed=(s.certs||{})[t.id]==="עבר";
                          const passedColor = isNight ? NIGHT_COLOR : "var(--green)";
                          const passedBg = isNight ? NIGHT_COLOR+"20" : "rgba(46,204,113,0.15)";
                          return (
                            <div key={t.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:isNight?NIGHT_COLOR+"08":undefined,borderRadius:8,padding:isNight?"6px 8px":undefined}}>
                              <span style={{fontSize:13,fontWeight:600,color:isNight?NIGHT_COLOR:undefined}}>{isNight?"🌙":certMode==="studio"?"🎙️":"🎓"} {t.name}</span>
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
      {/* Edit equipment cert modal */}
      {editEquipmentCert && (
        <Modal title="✏️ עריכת הסמכת ציוד" onClose={()=>setEditEquipmentCert(null)}
          footer={<><button className="btn btn-secondary" onClick={()=>setEditEquipmentCert(null)}>ביטול</button><button className="btn btn-primary" onClick={saveEditEquipmentCert} disabled={!editEquipmentCert.name.trim()||saving}>{saving?"שומר...":"💾 שמור"}</button></>}>
          <div style={{display:"flex",flexDirection:"column",gap:14,direction:"rtl"}}>
            <label style={{display:"flex",flexDirection:"column",gap:4,fontSize:13,fontWeight:600,color:"var(--text2)"}}>שם ההסמכה
              <input className="form-input" value={editEquipmentCert.name} onChange={e=>setEditEquipmentCert(ec=>({...ec,name:e.target.value}))}/>
            </label>

            <div style={{fontSize:13,fontWeight:700,color:"var(--text2)"}}>📦 פריטי ציוד משויכים</div>
            <div style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"12px 14px"}}>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8,alignItems:"center"}}>
                <span style={{fontSize:11,fontWeight:800,color:"var(--text3)"}}>סינון:</span>
                {[{k:"all",l:"📦 הכל"},{k:"sound",l:"🎙️ ציוד סאונד"},{k:"photo",l:"🎥 ציוד צילום"}].map(({k,l})=>{
                  const active = eqTypeF===k;
                  return (
                    <button key={k} type="button" onClick={()=>setEqTypeF(k)}
                      style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                      {l}
                    </button>
                  );
                })}
                <span style={{width:1,height:16,background:"var(--border)",flexShrink:0}}/>
                {equipmentCategories.map(cat=>{
                  const active = eqCatF.includes(cat);
                  return (
                    <button key={cat} type="button" onClick={()=>setEqCatF(prev=>active?prev.filter(c=>c!==cat):[...prev,cat])}
                      style={{padding:"4px 10px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}>
                      {cat}
                    </button>
                  );
                })}
                {eqCatF.length>0&&<button type="button" onClick={()=>setEqCatF([])} style={{padding:"4px 8px",borderRadius:20,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:11,cursor:"pointer"}}>✕ נקה</button>}
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <div className="search-bar" style={{flex:1,minWidth:170}}>
                  <span>🔍</span>
                  <input placeholder="חיפוש ציוד..." value={eqSearch} onChange={e=>setEqSearch(e.target.value)}/>
                </div>
                <button type="button" onClick={()=>setEqShowSelected(prev=>!prev)}
                  style={{padding:"5px 12px",borderRadius:20,border:`2px solid ${eqShowSelected?"var(--green)":"var(--border)"}`,background:eqShowSelected?"rgba(46,204,113,0.12)":"transparent",color:eqShowSelected?"var(--green)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
                  {eqShowSelected ? "✅ נבחרים" : "⬜ פריטים נבחרים בלבד"}
                </button>
              </div>
            </div>

            <div style={{maxHeight:"52vh",overflowY:"auto",paddingLeft:4}}>
              {(()=>{
                const matchesType = (eq) => {
                  if (eqTypeF === "sound") return !!eq.soundOnly;
                  if (eqTypeF === "photo") return !!eq.photoOnly;
                  return true;
                };
                const matchesSearch = (eq) => !eqSearch || String(eq.name||"").toLowerCase().includes(eqSearch.toLowerCase());
                const visibleCats = (eqCatF.length>0 ? eqCatF : equipmentCategories).filter(cat =>
                  (equipment || []).some(eq =>
                    eq.category===cat &&
                    matchesType(eq) &&
                    matchesSearch(eq) &&
                    (!eqShowSelected || editEquipmentCert.equipmentIds.includes(eq.id))
                  )
                );
                if (!visibleCats.length) return <div style={{textAlign:"center",color:"var(--text3)",padding:"20px 8px",fontSize:13}}>לא נמצא ציוד תואם</div>;
                return visibleCats.map(cat=>{
                  const catEq = (equipment || []).filter(eq =>
                    eq.category===cat &&
                    matchesType(eq) &&
                    matchesSearch(eq) &&
                    (!eqShowSelected || editEquipmentCert.equipmentIds.includes(eq.id))
                  );
                  if (!catEq.length) return null;
                  return (
                    <div key={cat} style={{marginBottom:12}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
                        <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1}}>{cat}</div>
                        {catEq.some(eq=>eq.soundOnly)&&<span style={{fontSize:10,color:"var(--accent)",fontWeight:700}}>🎙️ סאונד</span>}
                        {catEq.some(eq=>eq.photoOnly)&&<span style={{fontSize:10,color:"var(--green)",fontWeight:700}}>🎥 צילום</span>}
                      </div>
                      {catEq.map(eq=>{
                        const checked = editEquipmentCert.equipmentIds.includes(eq.id);
                        return (
                          <label key={eq.id} style={{display:"flex",alignItems:"center",gap:10,fontSize:13,cursor:"pointer",padding:"8px 12px",borderRadius:10,border:`1px solid ${checked?"var(--accent)":"var(--border)"}`,background:checked?"var(--accent-glow)":"var(--surface2)",marginBottom:6}}>
                            <input type="checkbox" checked={checked} onChange={()=>toggleEditEquipmentId(eq.id)} style={{accentColor:"var(--accent)"}}/>
                            <span style={{fontSize:20}}>{eq.image?.startsWith("data:")||eq.image?.startsWith("http")?<img src={eq.image} alt="" style={{width:24,height:24,objectFit:"cover",borderRadius:4}}/>:eq.image||"📦"}</span>
                            <div style={{flex:1}}>
                              <div style={{fontWeight:700,color:"var(--text)"}}>{eq.name}</div>
                              <div style={{fontSize:11,color:"var(--text3)"}}>
                                {eq.soundOnly&&<span style={{marginLeft:6}}>🎙️ סאונד</span>}
                                {eq.photoOnly&&<span style={{marginLeft:6}}>🎥 צילום</span>}
                                {eq.certification_id && eq.certification_id !== editEquipmentCert.id && <span style={{color:"var(--red)"}}>כבר משויך להסמכה אחרת</span>}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  );
                });
              })()}
            </div>

            {editEquipmentCert.equipmentIds.length>0 && (
              <div className="highlight-box">🎓 {editEquipmentCert.equipmentIds.length} פריטי ציוד ישויכו להסמכה זו</div>
            )}
          </div>
        </Modal>
      )}
      {/* Edit studio cert modal */}
      {editCert && (
        <Modal title="✏️ עריכת הסמכת אולפן" onClose={()=>setEditCert(null)}
          footer={<><button className="btn btn-secondary" onClick={()=>setEditCert(null)}>ביטול</button><button className="btn btn-primary" onClick={saveEditCert} disabled={!editCert.name.trim()||saving}>{saving?"שומר...":"💾 שמור"}</button></>}>
          <div style={{display:"flex",flexDirection:"column",gap:14,direction:"rtl"}}>
            <label style={{display:"flex",flexDirection:"column",gap:4,fontSize:13,fontWeight:600,color:"var(--text2)"}}>שם ההסמכה
              <input className="form-input" value={editCert.name} onChange={e=>setEditCert(ec=>({...ec,name:e.target.value}))}/>
            </label>
            {studios.length>0 && (
              <div>
                <div style={{fontSize:13,fontWeight:700,color:"var(--text2)",marginBottom:8}}>🎙️ אולפנים משויכים:</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {studios.map(s=>{
                    const checked = editCert.studioIds.includes(s.id);
                    const otherCerts = studioTypes.filter(t => t.id !== editCert.id && getStudioCertIds(s).includes(t.id));
                    return (
                      <label key={s.id} style={{display:"flex",alignItems:"center",gap:6,fontSize:13,cursor:"pointer",padding:"6px 12px",borderRadius:8,border:`1px solid ${checked?"var(--accent)":"var(--border)"}`,background:checked?"var(--accent-glow)":"transparent"}}>
                        <input type="checkbox" checked={checked} onChange={()=>toggleEditStudioId(s.id)} style={{accentColor:"var(--accent)"}}/>
                        {s.name}
                        {otherCerts.length>0 && <span style={{fontSize:10,color:"var(--text3)"}}>(כרגע גם: {otherCerts.map(t=>t.name).join(", ")})</span>}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
