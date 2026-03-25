// EquipmentPage.jsx — equipment management page
import { useState, useRef } from "react";
import {
  DEFAULT_CATEGORIES,
  STATUSES,
  storageSet,
  normalizeEquipmentTagFlags,
  ensureUnits,
  workingUnits,
  today,
} from "../utils.js";
import { Modal } from "./ui.jsx";
import { ManageCategoriesModal } from "./ManageCategoriesModal.jsx";
import { UnitsModal } from "./UnitsModal.jsx";

function statusBadge(s) {
  const m = { "תקין":"badge-green","פגום":"badge-red","בתיקון":"badge-yellow","נעלם":"badge-red" };
  return <span className={`badge ${m[s]||"badge-gray"}`}>{s}</span>;
}

const CATEGORY_LOAN_TYPE_OPTIONS = ["פרטית", "הפקה", "סאונד", "קולנוע יומית"];

function getCategoryLoanTypeSelection(categoryName, categoryLoanTypes = {}) {
  const allowedLoanTypes = CATEGORY_LOAN_TYPE_OPTIONS.filter((loanType) => Array.isArray(categoryLoanTypes?.[categoryName]) && categoryLoanTypes[categoryName].includes(loanType));
  return allowedLoanTypes.length ? allowedLoanTypes : [...CATEGORY_LOAN_TYPE_OPTIONS];
}

function buildCategoryLoanTypesMap(categories = [], draft = {}) {
  const next = {};
  (categories || []).forEach((categoryName) => {
    const allowedLoanTypes = CATEGORY_LOAN_TYPE_OPTIONS.filter((loanType) => Array.isArray(draft?.[categoryName]) && draft[categoryName].includes(loanType));
    if (allowedLoanTypes.length && allowedLoanTypes.length < CATEGORY_LOAN_TYPE_OPTIONS.length) {
      next[categoryName] = allowedLoanTypes;
    }
  });
  return next;
}

function CategoryLoanTypesModal({ categories, categoryLoanTypes = {}, onSave, onClose }) {
  const [draft, setDraft] = useState(() => {
    const initialDraft = {};
    (categories || []).forEach((categoryName) => {
      initialDraft[categoryName] = getCategoryLoanTypeSelection(categoryName, categoryLoanTypes);
    });
    return initialDraft;
  });

  const toggleLoanType = (categoryName, loanType) => {
    setDraft((prev) => {
      const current = Array.isArray(prev?.[categoryName]) && prev[categoryName].length ? prev[categoryName] : [...CATEGORY_LOAN_TYPE_OPTIONS];
      const nextSelection = current.includes(loanType)
        ? current.filter((value) => value !== loanType)
        : [...current, loanType];
      if (!nextSelection.length) return prev;
      return { ...prev, [categoryName]: nextSelection };
    });
  };

  const setAllLoanTypes = (categoryName) => {
    setDraft((prev) => ({ ...prev, [categoryName]: [...CATEGORY_LOAN_TYPE_OPTIONS] }));
  };

  return (
    <Modal
      title="🗂️ סיווג לסוגי ההשאלות"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => onSave(buildCategoryLoanTypesMap(categories, draft))}>שמור</button>
          <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
        </>
      }
    >
      <div style={{display:"grid",gap:12}}>
        <div style={{fontSize:13,color:"var(--text3)",lineHeight:1.7}}>
          בחרו לכל רובריקת ציוד אילו סוגי השאלה יכולים לראות אותה בטופס ההשאלה.
          אם כל סוגי ההשאלות מסומנים, הרובריקה תהיה זמינה לכולם.
        </div>
        {(categories || []).map((categoryName) => {
          const selectedLoanTypes = Array.isArray(draft?.[categoryName]) && draft[categoryName].length ? draft[categoryName] : [...CATEGORY_LOAN_TYPE_OPTIONS];
          const isAllSelected = selectedLoanTypes.length === CATEGORY_LOAN_TYPE_OPTIONS.length;
          return (
            <div key={categoryName} style={{border:"1px solid var(--border)",borderRadius:12,padding:12,background:"var(--surface2)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                <div style={{fontWeight:800,fontSize:14}}>{categoryName}</div>
                <button
                  type="button"
                  className={`btn btn-sm ${isAllSelected ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setAllLoanTypes(categoryName)}
                >
                  כל סוגי ההשאלות
                </button>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {CATEGORY_LOAN_TYPE_OPTIONS.map((loanType) => (
                  <button
                    key={loanType}
                    type="button"
                    className={`btn btn-sm ${selectedLoanTypes.includes(loanType) ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => toggleLoanType(categoryName, loanType)}
                  >
                    {loanType}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

export function EquipmentPage({ equipment, reservations, setEquipment, showToast, categories=DEFAULT_CATEGORIES, setCategories, categoryTypes={}, setCategoryTypes, categoryLoanTypes={}, setCategoryLoanTypes=()=>{}, certifications={types:[],students:[]} }) {
  const [search, setSearch] = useState("");
  const [trackFilter, setTrackFilter] = useState("הכל");
  const [selectedCats, setSelectedCats] = useState([]);
  const [typeFilter, setTypeFilter] = useState("הכל"); // "הכל" | "סאונד" | "צילום"
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [importModal, setImportModal] = useState(null);
  const csvInputRef = useRef(null);
  const equipmentCertTypes = (certifications?.types || []).filter(t => t.category !== "studio" && t.id !== "cert_night_studio");

  const parseCSVLine = (line) => {
    const result = []; let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    result.push(cur.trim());
    return result;
  };

  const handleCSVImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) { showToast("error", "הקובץ ריק או לא תקין"); return; }

    const header = parseCSVLine(lines[0]).map(h => h.replace(/^\uFEFF/, "")); // strip BOM
    const nameIdx = header.findIndex(h => ["שם פריט","name","שם"].includes(h));
    const qtyIdx  = header.findIndex(h => ["כמות","qty","quantity"].includes(h));
    const catIdx  = header.findIndex(h => ["רובריקה","קטגוריה","category"].includes(h));
    const descIdx = header.findIndex(h => ["תיאור","description"].includes(h));
    const notesIdx= header.findIndex(h => ["הערות","notes"].includes(h));

    if (nameIdx === -1 || catIdx === -1) {
      showToast("error", 'חסרות עמודות חובה: "שם פריט" ו-"רובריקה"'); return;
    }

    let newEquipment = [...equipment];
    let newCategories = [...categories];
    let added = 0, skipped = 0, newCats = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      const name  = cols[nameIdx]?.trim();
      const cat   = cols[catIdx]?.trim();
      const qty   = Math.max(1, parseInt(cols[qtyIdx]) || 1);
      const desc  = descIdx  >= 0 ? (cols[descIdx]?.trim()  || "") : "";
      const notes = notesIdx >= 0 ? (cols[notesIdx]?.trim() || "") : "";
      if (!name || !cat) continue;

      if (!newCategories.includes(cat)) { newCategories.push(cat); newCats.push(cat); }
      if (newEquipment.some(eq => eq.name === name && eq.category === cat)) { skipped++; continue; }

      newEquipment.push(ensureUnits(normalizeEquipmentTagFlags([{
        id: Date.now() + i + Math.random(),
        name, category: cat, description: desc, notes,
        total_quantity: qty, image: "📦", status: "תקין",
      }])[0]));
      added++;
    }

    setEquipment(newEquipment);
    await storageSet("equipment", newEquipment);
    if (setCategories && newCats.length) {
      setCategories(newCategories);
      await storageSet("categories", newCategories);
    }
    setImportModal({ added, skipped, newCats });
    e.target.value = "";
  };

  const downloadTemplate = () => {
    const csv = "\uFEFFשם פריט,כמות,רובריקה,תיאור,הערות\nגמביל DJI RS3,3,מייצבי מצלמה,גמביל 3 צירים,\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "תבנית_ייבוא_ציוד.csv";
    a.click();
  };

  // Derive category effective type: explicit tag wins, else from items
  const getCatType = (catName) => {
    if (Object.prototype.hasOwnProperty.call(categoryTypes, catName)) {
      return categoryTypes[catName] === "סאונד" || categoryTypes[catName] === "צילום" ? categoryTypes[catName] : "כללי";
    }
    const catItems = equipment.filter(e => e.category === catName);
    if (!catItems.length) return "כללי";
    if (catItems.every(e => e.soundOnly)) return "סאונד";
    if (catItems.every(e => e.photoOnly)) return "צילום";
    return "כללי";
  };

  const filtered = equipment.filter(e =>
    (selectedCats.length===0||selectedCats.includes(e.category)) &&
    e.name.includes(search) &&
    (typeFilter==="הכל" || getCatType(e.category)===typeFilter)
  );

  const updateQty = async (eq, delta) => {
    const newTotal = Math.max(1, (Number(eq.total_quantity) || 1) + delta);
    let updatedUnits = Array.isArray(eq.units) ? [...eq.units] : [];
    if (delta > 0) {
      for (let i = 0; i < delta; i++) {
        updatedUnits.push({ id: `unit-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, status: "תקין", notes: "" });
      }
    } else if (delta < 0) {
      let removed = 0;
      updatedUnits = updatedUnits.filter(u => {
        if (removed < Math.abs(delta) && u.status === "תקין") { removed++; return false; }
        return true;
      });
    }
    const updated = equipment.map(e => e.id === eq.id ? { ...e, total_quantity: newTotal, units: updatedUnits } : e);
    setEquipment(updated);
    await storageSet("equipment", updated);
    showToast("success", `כמות עודכנה: ${newTotal} יחידות`);
  };

  const save = async (form) => {
    setSaving(true);
    const normalizedForm = normalizeEquipmentTagFlags([form])[0];
    let updated;
    if (modal.type==="add") {
      const item = ensureUnits({ ...normalizedForm, id: Date.now() });
      updated = [...equipment, item];
    } else {
      const merged = ensureUnits({...equipment.find(e=>e.id===modal.item.id)||{}, ...normalizedForm});
      updated = equipment.map(e => e.id===modal.item.id ? merged : e);
    }
    setEquipment(updated);
    const _saveRes = await storageSet("equipment", updated);
    if(_saveRes.ok) showToast("success", modal.type==="add" ? `"${form.name}" נוסף בהצלחה` : "הציוד עודכן בהצלחה");
    else showToast("error", "❌ שגיאה בשמירה — נסה שוב");
    setSaving(false);
    setModal(null);
  };

  const del = async (eq) => {
    const updated = equipment.filter(e => e.id!==eq.id);
    setEquipment(updated);
    await storageSet("equipment", updated);
    showToast("success", `"${eq.name}" נמחק`);
    setModal(null);
  };

  const setCategoryClassification = async (categoryName, nextType) => {
    const updated = equipment.map((item) => (
      item.category === categoryName
        ? { ...item, soundOnly: nextType === "סאונד", photoOnly: nextType === "צילום" }
        : item
    ));
    const updatedTypes = { ...categoryTypes };
    if (nextType === "סאונד" || nextType === "צילום") updatedTypes[categoryName] = nextType;
    else delete updatedTypes[categoryName];
    setEquipment(updated);
    setCategoryTypes(updatedTypes);
    await Promise.all([storageSet("equipment", updated), storageSet("categoryTypes", updatedTypes)]);
    showToast("success", nextType === "סאונד"
      ? `כל הפריטים בקטגוריית "${categoryName}" סווגו כציוד סאונד`
      : nextType === "צילום"
        ? `כל הפריטים בקטגוריית "${categoryName}" סווגו כציוד צילום`
        : `כל הפריטים בקטגוריית "${categoryName}" סווגו ככלליים`);
  };

  const toggleCategoryPrivateLoanUnlimited = async (categoryName) => {
    const categoryItems = equipment.filter((item) => item.category === categoryName);
    if (!categoryItems.length) return;
    const shouldEnable = !categoryItems.every((item) => !!item.privateLoanUnlimited);
    const updated = equipment.map((item) =>
      item.category === categoryName ? { ...item, privateLoanUnlimited: shouldEnable } : item
    );
    setEquipment(updated);
    await storageSet("equipment", updated);
    showToast("success", shouldEnable ? `הקטגוריה "${categoryName}" הוחרגה ממגבלת השאלה פרטית` : `הוחזרה מגבלת השאלה פרטית לקטגוריה "${categoryName}"`);
  };

  const saveCategoryLoanTypes = async (nextCategoryLoanTypes) => {
    setCategoryLoanTypes(nextCategoryLoanTypes);
    await storageSet("categoryLoanTypes", nextCategoryLoanTypes);
    showToast("success", "סיווג סוגי ההשאלות עודכן");
    setModal(null);
  };

  const deleteEmptyCategoryFromFilters = async (categoryName) => {
    const hasItems = equipment.some((item) => item.category === categoryName);
    if (hasItems) {
      showToast("error", "לא ניתן למחוק — יש ציוד ברובריקה זו");
      return;
    }
    const updatedCats = categories.filter((category) => category !== categoryName);
    const updatedTypes = { ...categoryTypes };
    const updatedCategoryLoanTypes = { ...categoryLoanTypes };
    delete updatedTypes[categoryName];
    delete updatedCategoryLoanTypes[categoryName];
    setSelectedCats((prev) => prev.filter((category) => category !== categoryName));
    setCategories(updatedCats);
    setCategoryTypes(updatedTypes);
    setCategoryLoanTypes(updatedCategoryLoanTypes);
    await Promise.all([storageSet("categories", updatedCats), storageSet("categoryTypes", updatedTypes), storageSet("categoryLoanTypes", updatedCategoryLoanTypes)]);
    showToast("success", `הרובריקה "${categoryName}" נמחקה`);
  };

  const todayStr2 = today();
  const used = (id) => reservations
    .filter(r=>{
      if(r.status==="באיחור") return true; // overdue = item still out, regardless of dates
      if(r.status!=="מאושר"&&r.status!=="ממתין") return false;
      return r.borrow_date<=todayStr2 && r.return_date>=todayStr2;
    })
    .reduce((s,r)=>s+(r.items?.find(i=>i.equipment_id==id)?.quantity||0),0);

  const EqForm = ({ initial }) => {
    const [f, setF] = useState(initial||{name:"",category:"מצלמות",description:"",total_quantity:1,image:"📷",notes:"",status:"תקין",certification_id:""});
    const s = (k,v) => setF(p=>({...p,[k]:v}));
    const [imgUploading, setImgUploading] = useState(false);
    const [imgError, setImgError]         = useState("");
    const [isGeneratingDesc, setIsGeneratingDesc] = useState(false);

    const generateAutoDescription = async (itemName) => {
      if (!itemName) {
        alert("נא להזין שם פריט קודם");
        return;
      }

      setIsGeneratingDesc(true);
      try {
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
        if (!apiKey) throw new Error("חסר מפתח Gemini במשתני הסביבה");
        const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

        const systemInstruction = "You are a professional AV and film equipment expert. The user will provide an equipment name. Write a concise, professional technical description of this item in Hebrew (around 2-3 sentences), highlighting its main uses and features. Output ONLY the Hebrew text, without formatting or markdown.";

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: itemName }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || "API request failed");
        }

        const data = await response.json();
        const generatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!generatedText) throw new Error("לא התקבל טקסט מה־API");

        setF(prev => ({ ...prev, description: generatedText }));
      } catch (error) {
        console.error("Error generating description:", error);
        alert(`שגיאה ביצירת התיאור. ${error?.message || "נסה שוב."}`);
      } finally {
        setIsGeneratingDesc(false);
      }
    };

    const handleImageUpload = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      setImgError("");
      setImgUploading(true);
      try {
        // Read file as base64 data-URI
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload  = ev => resolve(ev.target.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        // POST to Cloudinary proxy — returns { ok, url }
        const res  = await fetch("/api/upload-image", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ data: dataUrl }),
        });
        const json = await res.json();
        if (!res.ok || !json.url) throw new Error(json.error || "שגיאת שרת");
        s("image", json.url);          // store only the URL — no Base64 in DB
      } catch (err) {
        console.error("Image upload failed:", err);
        setImgError("שגיאה בהעלאת התמונה — נסה שנית");
      } finally {
        setImgUploading(false);
      }
    };

    // Legacy Base64 items (data:) still preview correctly; new items use https: URLs
    const isImage = f.image?.startsWith("data:") || f.image?.startsWith("http");

    return (
      <div>
        <div className="grid-2">
          <div className="form-group"><label className="form-label">שם הציוד *</label><input className="form-input" value={f.name} onChange={e=>s("name",e.target.value)}/></div>
          <div className="form-group"><label className="form-label">קטגוריה</label><select className="form-select" value={f.category} onChange={e=>s("category",e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select></div>
        </div>
        <div className="form-group">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={()=>generateAutoDescription(f.name)}
              disabled={isGeneratingDesc}
              style={{display:"inline-flex",alignItems:"center",gap:6,fontWeight:800}}
            >
              <span aria-hidden="true">✨</span>
              {isGeneratingDesc ? "מייצר תיאור..." : "תיאור אוטומטי"}
            </button>
            <label className="form-label" style={{margin:0}}>תיאור</label>
          </div>
          <textarea className="form-textarea" rows={2} value={f.description} onChange={e=>s("description",e.target.value)}/>
        </div>
        <div className="grid-2">
          <div className="form-group"><label className="form-label">כמות *</label><input type="number" min="0" className="form-input" value={f.total_quantity} onChange={e=>s("total_quantity",Number(e.target.value))}/></div>
          <div className="form-group">
            <label className="form-label">תמונה / אימוג׳י</label>
            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
              {imgUploading
                ? <div style={{width:48,height:48,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:8,border:"1px solid var(--border)",background:"var(--surface2)",fontSize:20}}>⏳</div>
                : isImage
                  ? <img src={f.image} alt="" style={{width:48,height:48,objectFit:"cover",borderRadius:8,border:"1px solid var(--border)"}}/>
                  : <span style={{fontSize:36}}>{f.image}</span>
              }
              <div style={{flex:1}}>
                <input className="form-input" value={isImage?"":f.image} placeholder="אימוג׳י (למשל 📷)" onChange={e=>s("image",e.target.value)} style={{marginBottom:6}} disabled={imgUploading}/>
                <label style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",background:"var(--surface3)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",cursor:imgUploading?"not-allowed":"pointer",fontSize:12,color:"var(--text2)",opacity:imgUploading?0.6:1}}>
                  {imgUploading ? "⏳ מעלה תמונה..." : "🖼️ העלה תמונה מהמחשב"}
                  <input type="file" accept="image/*" style={{display:"none"}} onChange={handleImageUpload} disabled={imgUploading}/>
                </label>
                {f.name && <button type="button" onClick={()=>window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(f.name)}`, "_blank")} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",background:"var(--surface3)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",cursor:"pointer",fontSize:12,color:"var(--text2)",marginTop:4,width:"100%"}}>
                  🔍 חפש תמונה ב-Google Images
                </button>}
                {imgError && <div style={{color:"#e74c3c",fontSize:11,marginTop:4}}>{imgError}</div>}
              </div>
            </div>
          </div>
        </div>
        <div className="grid-2">
          <div className="form-group"><label className="form-label">מצב</label><select className="form-select" value={f.status} onChange={e=>s("status",e.target.value)}>{STATUSES.map(st=><option key={st}>{st}</option>)}</select></div>
          <div className="form-group"><label className="form-label">הערות</label><input className="form-input" value={f.notes} onChange={e=>s("notes",e.target.value)}/></div>
        </div>
        <div className="form-group">
          <label className="form-label">🎓 הסמכה נדרשת</label>
          <select className="form-select" value={f.certification_id||""} onChange={e=>s("certification_id",e.target.value)}>
            <option value="">ללא הסמכה (כולם רשאים)</option>
            {equipmentCertTypes.map(ct=>(
              <option key={ct.id} value={ct.id}>{ct.name}</option>
            ))}
          </select>
          <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>רק סטודנטים שעברו הסמכה זו יוכלו להשאיל פריט זה</div>
        </div>
        <div className="flex gap-2" style={{paddingTop:8}}>
          <button className="btn btn-primary" disabled={!f.name||saving||imgUploading} onClick={()=>save(f)}>{saving?"⏳ שומר...":initial?"💾 שמור":"➕ הוסף"}</button>
          <button className="btn btn-secondary" onClick={()=>setModal(null)}>ביטול</button>
        </div>
      </div>
    );
  };

  return (
    <div className="page">
      <div className="flex-between mb-4">
        <div className="search-bar"><span>🔍</span><input placeholder="חיפוש ציוד..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div className="flex gap-2" style={{flexWrap:"wrap",justifyContent:"flex-end"}}>
          <button className="btn btn-secondary" onClick={downloadTemplate} title="הורד תבנית CSV">📥 תבנית</button>
          <button className="btn btn-secondary" onClick={()=>csvInputRef.current?.click()}>📤 ייבוא CSV</button>
          <input ref={csvInputRef} type="file" accept=".csv,text/csv" style={{display:"none"}} onChange={handleCSVImport}/>
          <button className="btn btn-primary" onClick={()=>setModal({type:"addcat"})}>📂 ניהול קטגוריות</button>
          <button className="btn btn-primary" onClick={()=>setModal({type:"loan-types"})}>🗂️ סיווג לסוגי ההשאלות</button>
          <button className="btn btn-primary" onClick={()=>setModal({type:"add"})}>➕ הוסף ציוד</button>
        </div>
      </div>

      {/* ── Type filter (sound / photo) ── */}
      <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
        {[{k:"הכל",label:"📦 הכל"},{k:"סאונד",label:"🎙️ סאונד"},{k:"צילום",label:"🎥 צילום"},{k:"כללי",label:"🧩 כללי"}].map(({k,label})=>{
          const active=typeFilter===k;
          return <button key={k} type="button" onClick={()=>setTypeFilter(k)}
            style={{padding:"5px 14px",borderRadius:8,border:`2px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"transparent",color:active?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
            {label}
          </button>;
        })}
        {typeFilter!=="הכל"&&<span style={{fontSize:11,color:"var(--text3)"}}>מציג {filtered.length} פריטים</span>}
      </div>

      {/* ── Category pills ── */}
      <div className="flex gap-2 mb-6" style={{flexWrap:"wrap",alignItems:"center"}}>
        {(typeFilter === "הכל" ? categories : categories.filter(c => getCatType(c) === typeFilter)).map(c=>{
          const active = selectedCats.includes(c);
          const isEmptyCategory = !equipment.some((item) => item.category === c);
          return (
            <div key={c} style={{display:"flex",alignItems:"center",borderRadius:8,overflow:"hidden",border:`1px solid ${active?"var(--accent)":"var(--border)"}`,background:active?"var(--accent-glow)":"var(--surface2)"}}>
              <button
                className="btn btn-sm"
                style={{borderRadius:0,border:"none",background:"transparent",color:active?"var(--accent)":"var(--text2)",fontWeight:700,padding:"5px 10px"}}
                onClick={()=>setSelectedCats(prev=>active?prev.filter(x=>x!==c):[...prev,c])}>
                {c}
              </button>
              {isEmptyCategory && (
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{borderRadius:0,border:"none",borderRight:"1px solid var(--border)",background:"transparent",color:"var(--red)",fontWeight:900,padding:"5px 8px"}}
                  title="מחק רובריקה ריקה"
                  onClick={(e)=>{
                    e.stopPropagation();
                    deleteEmptyCategoryFromFilters(c);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length===0 ? <div className="empty-state"><div className="emoji">📦</div><p>לא נמצא ציוד</p></div> : (
        <>
          {(selectedCats.length>0?selectedCats:categories)
            .filter(c=>filtered.some(e=>e.category===c)).map(c=>(
            <div key={c} style={{marginBottom:32}}>
              <div style={{fontSize:13,fontWeight:800,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,marginBottom:12,paddingBottom:8,borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:8,justifyContent:"space-between",flexWrap:"wrap"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <span>{c}</span>
                <span style={{fontSize:11,color:"var(--text3)",fontWeight:400}}>({filtered.filter(e=>e.category===c).length} פריטים)</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  {[
                    { key:"סאונד", label:"ציוד סאונד" },
                    { key:"צילום", label:"ציוד צילום" },
                    { key:"כללי", label:"כללי" },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      className={`btn btn-sm ${getCatType(c) === key ? "btn-primary" : "btn-secondary"}`}
                      onClick={()=>setCategoryClassification(c, key)}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`btn btn-sm ${equipment.filter(e=>e.category===c).every(e=>e.privateLoanUnlimited) ? "btn-purple" : "btn-secondary"}`}
                    onClick={()=>toggleCategoryPrivateLoanUnlimited(c)}
                  >
                    לא מוגבל בהשאלה פרטית
                  </button>
                </div>
              </div>
              <div className="eq-grid">
                {filtered.filter(e=>e.category===c).map(eq=>{const avail=workingUnits(eq)-used(eq.id);const isEmpty=avail<=0;return(
                  <div key={eq.id} className="eq-card" style={{position:"relative",cursor:"pointer",border:isEmpty?"2px solid var(--red)":undefined,boxShadow:isEmpty?"0 0 0 1px rgba(231,76,60,0.35)":undefined}} onClick={()=>setModal({type:"edit",item:eq})}>
                    {/* ── Cert badge ── */}
                    {eq.certification_id&&(
                      <div title={`דורש הסמכה: ${certifications?.types?.find(t=>t.id===eq.certification_id)?.name||"הסמכה"}`}
                        style={{position:"absolute",top:8,left:8,background:"rgba(245,166,35,0.18)",border:"2px solid var(--accent)",borderRadius:8,padding:"3px 7px",display:"flex",alignItems:"center",gap:3,zIndex:2}}>
                        <span style={{fontSize:14}}>🎓</span>
                        <span style={{fontSize:10,fontWeight:900,color:"var(--accent)"}}>הסמכה</span>
                      </div>
                    )}
                    <div style={{marginBottom:10,display:"flex",justifyContent:"center"}}>
                      {eq.image?.startsWith("data:")||eq.image?.startsWith("http")
                        ? <img src={eq.image} alt={eq.name} style={{width:72,height:72,objectFit:"cover",borderRadius:10,border:"1px solid var(--border)"}}/>
                        : <span style={{fontSize:36}}>{eq.image||"📦"}</span>
                      }
                    </div>
                    <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>{eq.name}</div>
                    <div style={{fontSize:11,color:"var(--text3)",marginBottom:8}}>{eq.category}</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
                      {eq.soundOnly && <div className="chip" style={{color:"var(--accent)",borderColor:"var(--accent)"}}>🎙️ ציוד סאונד</div>}
                      {eq.photoOnly && <div className="chip" style={{color:"var(--green)",borderColor:"rgba(39,174,96,0.45)"}}>🎥 ציוד צילום</div>}
                    </div>
                    <div style={{fontSize:13,display:"flex",alignItems:"center",justifyContent:"space-between",gap:6}}>
                      <div>
                        <strong style={{color:isEmpty?"var(--red)":"var(--accent)",fontSize:20}}>{avail}</strong>
                        <span style={{color:"var(--text3)"}}> / {workingUnits(eq)} זמין</span>
                        {workingUnits(eq)<eq.total_quantity&&<span style={{color:"var(--red)",fontSize:11,fontWeight:700,marginRight:6}}> · {eq.total_quantity-workingUnits(eq)} בדיקה 🔧</span>}
                      </div>
                      {isEmpty&&<span style={{fontSize:10,fontWeight:900,color:"var(--red)",background:"rgba(231,76,60,0.12)",border:"1px solid rgba(231,76,60,0.4)",borderRadius:6,padding:"2px 7px",whiteSpace:"nowrap"}}>אזל במלאי</span>}
                    </div>
                    {eq.notes && <div className="chip" style={{marginTop:6}}>💬 {eq.notes}</div>}
                    <div style={{marginTop:8}}>{statusBadge(eq.status)}</div>
                    <div className="flex gap-2" style={{marginTop:12,flexWrap:"wrap"}} onClick={e=>e.stopPropagation()}>
                      <button className="btn btn-secondary btn-sm" onClick={()=>setModal({type:"edit",item:eq})}>✏️ עריכה</button>
                      <button className="btn btn-secondary btn-sm" onClick={()=>setModal({type:"units",item:eq})}>🔧 יחידות</button>
                      <button className="btn btn-danger btn-sm" onClick={()=>setModal({type:"delete",item:eq})}>🗑️</button>
                    </div>
                  </div>
                );})}
              </div>
            </div>
          ))}
        </>
      )}
      {(modal?.type==="add"||modal?.type==="edit") && <Modal title={modal.type==="add"?"➕ הוספת ציוד":"✏️ עריכת ציוד"} onClose={()=>setModal(null)}><EqForm initial={modal.type==="edit"?modal.item:null}/></Modal>}
      {modal?.type==="units" && <UnitsModal eq={modal.item} equipment={equipment} setEquipment={setEquipment} showToast={showToast} onClose={()=>setModal(null)}/>}
      {modal?.type==="delete" && <Modal title="🗑️ מחיקת ציוד" onClose={()=>setModal(null)} footer={<><button className="btn btn-danger" onClick={()=>del(modal.item)}>כן, מחק</button><button className="btn btn-secondary" onClick={()=>setModal(null)}>ביטול</button></>}><p>האם למחוק את <strong>{modal.item.name}</strong>?</p></Modal>}
      {modal?.type==="loan-types" && <CategoryLoanTypesModal categories={categories} categoryLoanTypes={categoryLoanTypes} onSave={saveCategoryLoanTypes} onClose={()=>setModal(null)}/>}
      {modal?.type==="addcat" && <ManageCategoriesModal
        categories={categories}
        categoryTypes={categoryTypes}
        equipment={equipment}
        onClose={()=>setModal(null)}
        onSave={async(action)=>{
          if(action.action==="add") {
            const updatedCats = [...categories, action.name];
            const updatedTypes = {...categoryTypes, ...(action.type ? {[action.name]: action.type} : {})};
            setCategories(updatedCats);
            setCategoryTypes(updatedTypes);
            await Promise.all([storageSet("categories", updatedCats), storageSet("categoryTypes", updatedTypes)]);
            showToast("success", `קטגוריה "${action.name}" נוספה`);
          } else if(action.action==="rename") {
            const updatedCats = categories.map(c => c===action.oldName ? action.newName : c);
            const updatedEq = equipment.map(e => {
              if(e.category !== action.oldName) return e;
              const base = {...e, category: action.newName};
              if(action.type !== undefined) {
                base.soundOnly = action.type === "סאונד";
                base.photoOnly = action.type === "צילום";
              }
              return base;
            });
            const updatedTypes = {...categoryTypes};
            const updatedCategoryLoanTypes = {...categoryLoanTypes};
            if(action.oldName !== action.newName) { delete updatedTypes[action.oldName]; }
            if(action.type) updatedTypes[action.newName] = action.type;
            else delete updatedTypes[action.newName];
            if (action.oldName !== action.newName && Object.prototype.hasOwnProperty.call(updatedCategoryLoanTypes, action.oldName)) {
              updatedCategoryLoanTypes[action.newName] = updatedCategoryLoanTypes[action.oldName];
              delete updatedCategoryLoanTypes[action.oldName];
            }
            setCategories(updatedCats);
            setEquipment(updatedEq);
            setCategoryTypes(updatedTypes);
            setCategoryLoanTypes(updatedCategoryLoanTypes);
            await Promise.all([storageSet("categories", updatedCats), storageSet("equipment", updatedEq), storageSet("categoryTypes", updatedTypes), storageSet("categoryLoanTypes", updatedCategoryLoanTypes)]);
            showToast("success", `קטגוריה עודכנה`);
          } else if(action.action==="delete") {
            const hasItems = equipment.some(e => e.category===action.name);
            if(hasItems) { showToast("error", "לא ניתן למחוק — יש ציוד בקטגוריה זו"); return; }
            const updatedCats = categories.filter(c => c!==action.name);
            const updatedTypes = {...categoryTypes};
            const updatedCategoryLoanTypes = {...categoryLoanTypes};
            delete updatedTypes[action.name];
            delete updatedCategoryLoanTypes[action.name];
            setCategories(updatedCats);
            setCategoryTypes(updatedTypes);
            setCategoryLoanTypes(updatedCategoryLoanTypes);
            await Promise.all([storageSet("categories", updatedCats), storageSet("categoryTypes", updatedTypes), storageSet("categoryLoanTypes", updatedCategoryLoanTypes)]);
            showToast("success", `קטגוריה "${action.name}" נמחקה`);
          }
        }}
      />}
      {importModal && (
        <Modal title="📤 תוצאות ייבוא" onClose={()=>setImportModal(null)}
          footer={<button className="btn btn-primary" onClick={()=>setImportModal(null)}>סגור</button>}>
          <div style={{display:"flex",flexDirection:"column",gap:12,direction:"rtl"}}>
            <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
              <div style={{flex:1,background:"rgba(46,204,113,0.1)",border:"1px solid var(--green)",borderRadius:8,padding:"12px 16px",textAlign:"center"}}>
                <div style={{fontSize:28,fontWeight:900,color:"var(--green)"}}>{importModal.added}</div>
                <div style={{fontSize:12,color:"var(--text3)"}}>פריטים נוספו</div>
              </div>
              <div style={{flex:1,background:"rgba(245,166,35,0.1)",border:"1px solid var(--accent)",borderRadius:8,padding:"12px 16px",textAlign:"center"}}>
                <div style={{fontSize:28,fontWeight:900,color:"var(--accent)"}}>{importModal.skipped}</div>
                <div style={{fontSize:12,color:"var(--text3)"}}>פריטים דולגו (כבר קיימים)</div>
              </div>
            </div>
            {importModal.newCats.length > 0 && (
              <div style={{background:"rgba(52,152,219,0.1)",border:"1px solid var(--blue)",borderRadius:8,padding:"12px 16px"}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:6}}>רובריקות חדשות שנוצרו:</div>
                {importModal.newCats.map(c=><div key={c} style={{fontSize:13,color:"var(--blue)"}}>📂 {c}</div>)}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
