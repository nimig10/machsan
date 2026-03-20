// DamagedEquipmentPage.jsx — page for managing damaged/faulty equipment
import { useState } from "react";
import { storageSet, ensureUnits } from "../utils.js";

export function DamagedEquipmentPage({ equipment, setEquipment, showToast, categories=[], collegeManager={}, managerToken="" }) {
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("הכל");
  const [editUnit, setEditUnit] = useState(null); // {eq, unit}
  const [editForm, setEditForm] = useState({ status:"פגום", fault:"", repair:"" });
  const [saving, setSaving] = useState(false);
  const [reportSending, setReportSending] = useState(false);

  const sendDamageReport = async () => {
    if(!editUnit||!collegeManager.email) return;
    setReportSending(true);
    try {
      await fetch("/api/send-email", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          to: collegeManager.email,
          type: "manager_report",
          student_name: "צוות המחסן",
          reservation_id: "ציוד",
          loan_type: "ציוד בדיקה",
          borrow_date: new Date().toLocaleDateString("he-IL"),
          return_date: "",
          items_list: `${editUnit.eq.name} — יחידה #${editUnit.unit.id?.split("_")[1]||"?"}`,
          report_note: `סטטוס: ${editForm.status}\nתקלה: ${editForm.fault||"—"}\nתיקון שבוצע: ${editForm.repair||"—"}`,
          calendar_url: managerToken ? `${window.location.origin}/manager-calendar?token=${managerToken}` : "",
        }),
      });
      alert("✅ הדיווח נשלח למנהל המכללה");
    } catch(e) { console.error(e); }
    setReportSending(false);
  };

  // Collect all non-תקין units
  const damagedItems = [];
  equipment.forEach(eq => {
    (eq.units||[]).forEach(u => {
      if (u.status !== "תקין") {
        damagedItems.push({ eq, unit: u });
      }
    });
  });

  const filtered = damagedItems.filter(({eq, unit}) => {
    const matchCat = catFilter==="הכל" || eq.category===catFilter;
    const matchSearch = !search || eq.name.includes(search) || unit.status.includes(search) || (unit.fault||"").includes(search);
    return matchCat && matchSearch;
  });

  const saveUnit = async () => {
    if(!editUnit) return;
    setSaving(true);
    const { eq, unit } = editUnit;
    const updatedUnits = eq.units.map(u => u.id===unit.id ? {...u, ...editForm} : u);
    const updatedEq = ensureUnits({...eq, units: updatedUnits});
    const updatedEquipment = equipment.map(e => e.id===eq.id ? updatedEq : e);
    setEquipment(updatedEquipment);
    const r = await storageSet("equipment", updatedEquipment);
    setSaving(false);
    if(r.ok) {
      if(editForm.status==="תקין") showToast("success", `✅ ${eq.name} #${unit.id.split("_")[1]} חזר לציוד פעיל`);
      else showToast("success","הסטטוס עודכן");
      setEditUnit(null);
    } else showToast("error","❌ שגיאה בשמירה");
  };

  const STATUS_COLORS = { "פגום":"var(--red)","בתיקון":"var(--yellow)","נעלם":"#9b59b6" };
  const STATUS_ICONS  = { "פגום":"⚠️","בתיקון":"🔧","נעלם":"❓" };

  return (
    <div className="page">
      {/* Filters */}
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <div className="search-bar" style={{flex:1,minWidth:180}}><span>🔍</span>
          <input placeholder="חיפוש ציוד..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <span style={{fontSize:13,color:"var(--text3)"}}>סה״כ: <strong style={{color:"var(--red)"}}>{damagedItems.length}</strong> יחידות</span>
      </div>
      {/* Category filter */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
        {["הכל",...categories].map(c=>(
          <button key={c} type="button" onClick={()=>setCatFilter(c)}
            style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${catFilter===c?"var(--accent)":"var(--border)"}`,background:catFilter===c?"var(--accent-glow)":"transparent",color:catFilter===c?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
            {c==="הכל"?"📦 הכל":c}
          </button>
        ))}
      </div>

      {filtered.length===0
        ? <div className="empty-state"><div className="emoji">✅</div><p>{search||catFilter!=="הכל"?"לא נמצאו פריטים":"אין ציוד בדיקה — כל הציוד תקין!"}</p></div>
        : <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {filtered.map(({eq, unit},i)=>{
            const isImg = eq.image?.startsWith("data:")||eq.image?.startsWith("http");
            const unitNum = unit.id?.split("_")[1]||"?";
            return (
              <div key={unit.id} style={{background:"var(--surface)",border:`2px solid ${STATUS_COLORS[unit.status]||"var(--border)"}22`,borderRight:`4px solid ${STATUS_COLORS[unit.status]||"var(--border)"}`,borderRadius:"var(--r)",padding:"14px 16px",display:"flex",gap:12,alignItems:"flex-start"}}>
                <div style={{width:48,height:48,flexShrink:0,borderRadius:8,overflow:"hidden",background:"var(--surface2)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {isImg ? <img src={eq.image} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}}/> : <span style={{fontSize:28}}>{eq.image||"📦"}</span>}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
                    <span style={{fontWeight:800,fontSize:14}}>{eq.name}</span>
                    <span style={{fontSize:11,color:"var(--text3)"}}>יחידה #{unitNum}</span>
                    <span style={{fontSize:11,background:`${STATUS_COLORS[unit.status]||"var(--border)"}22`,border:`1px solid ${STATUS_COLORS[unit.status]||"var(--border)"}`,borderRadius:20,padding:"1px 8px",color:STATUS_COLORS[unit.status]||"var(--text3)",fontWeight:700}}>
                      {STATUS_ICONS[unit.status]||""} {unit.status}
                    </span>
                    <span style={{fontSize:11,color:"var(--text3)",marginRight:"auto"}}>{eq.category}</span>
                  </div>
                  {unit.fault&&<div style={{fontSize:12,color:"var(--text2)",marginBottom:2}}>⚠️ <strong>תקלה:</strong> {unit.fault}</div>}
                  {unit.repair&&<div style={{fontSize:12,color:"var(--green)"}}>🔧 <strong>תיקון:</strong> {unit.repair}</div>}
                </div>
                <button className="btn btn-secondary btn-sm" onClick={()=>{setEditUnit({eq,unit});setEditForm({status:unit.status,fault:unit.fault||"",repair:unit.repair||""});}}>✏️ עריכה</button>
              </div>
            );
          })}
        </div>
      }

      {/* Edit modal */}
      {editUnit&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}} onClick={e=>e.target===e.currentTarget&&setEditUnit(null)}>
          <div style={{width:"100%",maxWidth:500,background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",direction:"rtl"}}>
            <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",background:"var(--surface2)",borderRadius:"16px 16px 0 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontWeight:900,fontSize:16}}>✏️ עריכת יחידה — {editUnit.eq.name}</div>
                <div style={{fontSize:12,color:"var(--text3)"}}>יחידה #{editUnit.unit.id?.split("_")[1]}</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={()=>setEditUnit(null)}>✕</button>
            </div>
            <div style={{padding:"20px",display:"flex",flexDirection:"column",gap:14}}>
              <div className="form-group">
                <label className="form-label">סטטוס יחידה</label>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:6}}>
                  {["תקין","פגום","בתיקון","נעלם"].map(s=>{
                    const colors = {"תקין":"var(--green)","פגום":"var(--red)","בתיקון":"var(--yellow)","נעלם":"#9b59b6"};
                    const active = editForm.status===s;
                    return <button key={s} type="button" onClick={()=>setEditForm(p=>({...p,status:s}))}
                      style={{padding:"6px 14px",borderRadius:20,border:`2px solid ${active?colors[s]:"var(--border)"}`,background:active?`${colors[s]}22`:"transparent",color:active?colors[s]:"var(--text2)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                      {s}
                    </button>;
                  })}
                </div>
                {editForm.status==="תקין"&&<div style={{fontSize:12,color:"var(--green)",marginTop:6,fontWeight:700}}>✅ היחידה תחזור אוטומטית לציוד פעיל!</div>}
              </div>
              <div className="form-group">
                <label className="form-label">תיאור התקלה</label>
                <textarea className="form-textarea" rows={2} placeholder="תאר את התקלה שנמצאה..." value={editForm.fault} onChange={e=>setEditForm(p=>({...p,fault:e.target.value}))}/>
              </div>
              <div className="form-group">
                <label className="form-label">תיקונים שבוצעו</label>
                <textarea className="form-textarea" rows={2} placeholder="רשום אילו תיקונים בוצעו..." value={editForm.repair} onChange={e=>setEditForm(p=>({...p,repair:e.target.value}))}/>
              </div>
              {collegeManager.email&&(
                <div style={{background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:"10px",marginBottom:8}}>
                  <div style={{fontSize:12,fontWeight:700,color:"var(--text2)",marginBottom:6}}>📧 דיווח למנהל המכללה</div>
                  <div style={{fontSize:11,color:"var(--text3)",marginBottom:6}}>פרטי התקלה והתיקון ישלחו אוטומטית</div>
                  <button className="btn btn-secondary btn-sm" disabled={reportSending} onClick={sendDamageReport}>
                    {reportSending?"⏳ שולח...":"📧 שלח דיווח למנהל"}
                  </button>
                </div>
              )}
              <div style={{display:"flex",gap:8}}>
                <button className="btn btn-primary" disabled={saving} onClick={saveUnit}>{saving?"⏳ שומר...":"💾 שמור"}</button>
                <button className="btn btn-secondary" onClick={()=>setEditUnit(null)}>ביטול</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
