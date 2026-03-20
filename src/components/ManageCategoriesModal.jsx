// ManageCategoriesModal.jsx — modal for managing equipment categories
import { useState } from "react";
import { Modal } from "./ui.jsx";

export function ManageCategoriesModal({ categories, categoryTypes, onSave, onClose, equipment=[] }) {
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState(""); // "" | "סאונד" | "צילום"
  const [editingCat, setEditingCat] = useState(null);
  const [editVal, setEditVal] = useState("");
  const [editType, setEditType] = useState("");
  const [typeFilters, setTypeFilters] = useState([]); // [] = all, else array of selected types

  const exists = categories.includes(newName.trim());
  const toggleTypeFilter = (t) => setTypeFilters(prev => prev.includes(t) ? prev.filter(x=>x!==t) : [...prev, t]);

  // Derive effective type — explicit categoryTypes takes priority, then derive from items
  const getEffectiveType = (cat) => {
    if (categoryTypes[cat] !== undefined && categoryTypes[cat] !== null) return categoryTypes[cat];
    const items = equipment.filter(e => e.category === cat);
    if (items.length) {
      const allSound = items.every(e => e.soundOnly) && !items.every(e => e.photoOnly);
      const allPhoto = items.every(e => e.photoOnly) && !items.every(e => e.soundOnly);
      if (allSound) return "סאונד";
      if (allPhoto) return "צילום";
    }
    return "";
  };

  // Sort categories: סאונד → צילום → כללי, then alphabetically within each group
  const sorted = [...categories].sort((a, b) => {
    const order = { "סאונד": 0, "צילום": 1 };
    const oa = order[getEffectiveType(a)] ?? 2;
    const ob = order[getEffectiveType(b)] ?? 2;
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b, "he");
  });

  const typeLabel = (t) => t === "סאונד" ? "🎙️ סאונד" : t === "צילום" ? "🎥 צילום" : "כללי";
  const typeBadgeStyle = (t) => ({
    display: "inline-flex", alignItems: "center", gap: 3,
    padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700,
    background: t === "סאונד" ? "rgba(155,89,182,0.15)" : t === "צילום" ? "rgba(39,174,96,0.12)" : "rgba(255,255,255,0.06)",
    color: t === "סאונד" ? "#9b59b6" : t === "צילום" ? "var(--green)" : "var(--text3)",
    border: `1px solid ${t === "סאונד" ? "rgba(155,89,182,0.35)" : t === "צילום" ? "rgba(39,174,96,0.3)" : "var(--border)"}`,
  });

  const filteredSorted = typeFilters.length===0 ? sorted : sorted.filter(c => {
    const t = getEffectiveType(c);
    return typeFilters.some(f => f==="" ? t==="" : t===f);
  });

  return (
    <Modal title="📂 ניהול קטגוריות" onClose={onClose}>
      {/* Type filter chips */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
        {[{k:"סאונד",l:"🎙️ סאונד"},{k:"צילום",l:"🎥 צילום"},{k:"",l:"כללי"}].map(({k,l})=>{
          const active=typeFilters.includes(k);
          return <button key={k} type="button" onClick={()=>toggleTypeFilter(k)}
            style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
            {l}
          </button>;
        })}
        {typeFilters.length>0&&<button type="button" onClick={()=>setTypeFilters([])} style={{padding:"4px 10px",borderRadius:20,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:11,cursor:"pointer"}}>✕ הכל</button>}
      </div>
      {/* Existing categories */}
      <div style={{marginBottom: 20}}>
        <div style={{fontSize: 12, fontWeight: 800, color: "var(--text3)", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5}}>
          קטגוריות קיימות ({filteredSorted.length}{typeFilters.length>0?` מתוך ${categories.length}`:""})</div>
        <div style={{display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto"}}>
          {filteredSorted.map(c => (
            <div key={c} style={{display: "flex", alignItems: "center", gap: 8, background: "var(--surface2)", borderRadius: 8, padding: "8px 12px", border: "1px solid var(--border)"}}>
              {editingCat === c ? (
                <>
                  <input
                    autoFocus
                    value={editVal}
                    onChange={e => setEditVal(e.target.value)}
                    onKeyDown={e => { if(e.key === "Escape") setEditingCat(null); }}
                    style={{flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 13}}
                  />
                  <select
                    value={editType}
                    onChange={e => setEditType(e.target.value)}
                    style={{background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 12}}
                  >
                    <option value="">כללי</option>
                    <option value="סאונד">🎙️ סאונד</option>
                    <option value="צילום">🎥 צילום</option>
                  </select>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => { onSave({action:"rename", oldName: c, newName: editVal.trim(), type: editType}); setEditingCat(null); }}
                    disabled={!editVal.trim() || (editVal.trim() !== c && categories.includes(editVal.trim()))}
                  >שמור</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditingCat(null)}>ביטול</button>
                </>
              ) : (
                <>
                  <span style={{flex: 1, fontSize: 13, fontWeight: 700}}>{c}</span>
                  <div style={{display:"flex",gap:4,flexShrink:0}}>
                    {[{v:"סאונד",l:"🎙️"},{v:"צילום",l:"🎥"},{v:"",l:"כללי"}].map(({v,l})=>{
                      const active = getEffectiveType(c)===v;
                      return <button key={v} type="button"
                        onClick={()=>onSave({action:"rename",oldName:c,newName:c,type:v})}
                        style={{padding:"2px 8px",borderRadius:6,border:`1.5px solid ${active?(v==="סאונד"?"rgba(155,89,182,0.8)":v==="צילום"?"rgba(39,174,96,0.7)":"var(--accent)"):"var(--border)"}`,background:active?(v==="סאונד"?"rgba(155,89,182,0.18)":v==="צילום"?"rgba(39,174,96,0.12)":"var(--accent-glow)"):"transparent",color:active?(v==="סאונד"?"#b97edc":v==="צילום"?"var(--green)":"var(--accent)"):"var(--text3)",fontWeight:active?800:500,fontSize:11,cursor:"pointer"}}>
                        {l}
                      </button>;
                    })}
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setEditingCat(c); setEditVal(c); setEditType(getEffectiveType(c) || ""); }}
                    title="ערוך שם">✏️</button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => onSave({action:"delete", name: c})}
                    title="מחק">🗑️</button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Add new category */}
      <div style={{borderTop: "1px solid var(--border)", paddingTop: 16}}>
        <div style={{fontSize: 12, fontWeight: 800, color: "var(--text3)", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5}}>הוסף קטגוריה חדשה</div>
        <div style={{display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap"}}>
          <div style={{flex: 1, minWidth: 140}}>
            <input
              className="form-input"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="שם הקטגוריה..."
              onKeyDown={e => { if(e.key === "Enter" && newName.trim() && !exists) { onSave({action:"add", name: newName.trim(), type: newType}); setNewName(""); setNewType(""); }}}
            />
            {exists && <div style={{color: "var(--red)", fontSize: 11, marginTop: 3}}>קטגוריה זו כבר קיימת</div>}
          </div>
          <select
            value={newType}
            onChange={e => setNewType(e.target.value)}
            className="form-select"
            style={{flex: "0 0 auto", minWidth: 120}}
          >
            <option value="">כללי</option>
            <option value="סאונד">🎙️ סאונד</option>
            <option value="צילום">🎥 צילום</option>
          </select>
          <button
            className="btn btn-primary"
            disabled={!newName.trim() || exists}
            onClick={() => { onSave({action:"add", name: newName.trim(), type: newType}); setNewName(""); setNewType(""); }}
          >+ הוסף</button>
        </div>
      </div>
    </Modal>
  );
}
