// UnitsModal.jsx — modal for managing individual equipment units
import { useState } from "react";
import { storageSet } from "../utils.js";

export function UnitsModal({ eq, equipment, setEquipment, showToast, onClose }) {
  const [units, setUnits] = useState(eq.units || []);
  const [saving, setSaving] = useState(false);
  const [addCount, setAddCount] = useState(1);

  const STATUS_COLORS = {"תקין":"var(--green)","פגום":"var(--red)","בתיקון":"var(--yellow)","נעלם":"#9b59b6"};

  const setUnitStatus = (unitId, status) => {
    setUnits(prev => prev.map(u => u.id===unitId ? {...u, status} : u));
  };

  const removeUnit = (unitId) => {
    setUnits(prev => prev.filter(u => u.id !== unitId));
  };

  const addUnits = () => {
    const count = Math.max(1, Math.min(20, Number(addCount)||1));
    const existing = units.map(u => {
      const n = parseInt(u.id?.split("_")[1] || "0", 10);
      return isNaN(n) ? 0 : n;
    });
    let nextNum = (existing.length ? Math.max(...existing) : 0) + 1;
    const newUnits = Array.from({length: count}, () => ({
      id: `${eq.id}_${nextNum++}`,
      status: "תקין",
      fault: "",
      repair: "",
    }));
    setUnits(prev => [...prev, ...newUnits]);
  };

  const saveAll = async () => {
    setSaving(true);
    const updatedEq = {...eq, units, total_quantity: units.length};
    const updatedEquipment = equipment.map(e => e.id===eq.id ? updatedEq : e);
    setEquipment(updatedEquipment);
    const r = await storageSet("equipment", updatedEquipment);
    setSaving(false);
    if(r.ok) { showToast("success", "היחידות עודכנו"); onClose(); }
    else showToast("error","❌ שגיאה בשמירה");
  };

  const working = units.filter(u=>u.status==="תקין").length;
  const damaged = units.length - working;

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{width:"100%",maxWidth:520,maxHeight:"90vh",background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",direction:"rtl",display:"flex",flexDirection:"column"}}>
        <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",background:"var(--surface2)",borderRadius:"16px 16px 0 0",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div>
            <div style={{fontWeight:900,fontSize:16}}>🔧 ניהול יחידות — {eq.name}</div>
            <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
              <span style={{color:"var(--green)",fontWeight:700}}>{working} תקין</span>
              {damaged>0&&<span style={{color:"var(--red)",fontWeight:700,marginRight:8}}> · {damaged} בדיקה</span>}
              <span style={{color:"var(--text3)",marginRight:8}}> · סה"כ {units.length} יחידות</span>
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* ── Add units row ── */}
        <div style={{padding:"10px 20px",borderBottom:"1px solid var(--border)",background:"rgba(245,166,35,0.04)",display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          <span style={{fontSize:12,fontWeight:700,color:"var(--text2)"}}>➕ הוספת יחידות:</span>
          <input type="number" min={1} max={20} value={addCount} onChange={e=>setAddCount(e.target.value)}
            style={{width:56,padding:"4px 8px",borderRadius:"var(--r-sm)",border:"1px solid var(--border)",background:"var(--surface2)",color:"var(--text)",fontSize:13,textAlign:"center"}}/>
          <button className="btn btn-primary btn-sm" onClick={addUnits}>הוסף</button>
          <span style={{fontSize:11,color:"var(--text3)"}}>יחידות חדשות יתווספו כ"תקין"</span>
        </div>

        <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:8}}>
          {units.length===0 && (
            <div style={{textAlign:"center",color:"var(--text3)",padding:24,fontSize:13}}>אין יחידות — הוסף יחידות למעלה</div>
          )}
          {units.map((u,i)=>{
            const unitNum = u.id?.split("_")[1]||String(i+1);
            return (
              <div key={u.id} style={{background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:"10px 14px",border:`1px solid ${STATUS_COLORS[u.status]||"var(--border)"}44`}}>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <span style={{fontWeight:700,fontSize:13,minWidth:72}}>יחידה #{unitNum}</span>
                  <div style={{display:"flex",gap:6,flex:1,flexWrap:"wrap"}}>
                    {["תקין","פגום","בתיקון","נעלם"].map(s=>{
                      const active = u.status===s;
                      return (
                        <button key={s} type="button" onClick={()=>setUnitStatus(u.id,s)}
                          style={{padding:"4px 10px",borderRadius:20,border:`2px solid ${active?STATUS_COLORS[s]:"var(--border)"}`,background:active?`${STATUS_COLORS[s]}22`:"transparent",color:active?STATUS_COLORS[s]:"var(--text3)",fontWeight:700,fontSize:11,cursor:"pointer"}}>
                          {s}
                        </button>
                      );
                    })}
                  </div>
                  <button type="button" onClick={()=>removeUnit(u.id)}
                    title="הסר יחידה"
                    style={{padding:"3px 7px",borderRadius:"var(--r-sm)",border:"1px solid rgba(231,76,60,0.3)",background:"rgba(231,76,60,0.08)",color:"var(--red)",fontSize:12,cursor:"pointer",flexShrink:0}}>
                    🗑️
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{padding:"14px 20px",borderTop:"1px solid var(--border)",flexShrink:0,display:"flex",gap:8}}>
          <button className="btn btn-primary" disabled={saving} onClick={saveAll}>{saving?"⏳ שומר...":"💾 שמור שינויים"}</button>
          <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
        </div>
      </div>
    </div>
  );
}
