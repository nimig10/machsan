// PoliciesPage.jsx — policies management page
import { useState } from "react";
import { storageSet } from "../utils.js";

function uint8ToBase64(bytes) {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export function PoliciesPage({ policies, setPolicies, showToast }) {
  const LOAN_TYPES = [
    { key:"פרטית", icon:"👤", label:"השאלה פרטית" },
    { key:"הפקה",  icon:"🎬", label:"השאלה להפקה" },
    { key:"סאונד", icon:"🎙️", label:"השאלת סאונד" },
    { key:"קולנוע יומית", icon:"🎥", label:"השאלת קולנוע יומית" },
  ];
  const [draft, setDraft] = useState({ ...policies });
  const [saving, setSaving] = useState(false);
  const [fsEdit, setFsEdit] = useState(null); // key being fullscreen-edited
  const [pdfUploading, setPdfUploading] = useState(false);

  const handleCommitmentPdfUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    if (file.size > 10 * 1024 * 1024) { showToast("error", "הקובץ גדול מדי — עד 10MB"); return; }
    setPdfUploading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      let finalData, compressed = false;
      try {
        const cs = new CompressionStream("gzip");
        const w = cs.writable.getWriter();
        w.write(new Uint8Array(arrayBuffer)); w.close();
        const chunks = [];
        const reader = cs.readable.getReader();
        for (;;) { const { value, done } = await reader.read(); if (done) break; chunks.push(value); }
        const total = chunks.reduce((a, c) => a + c.length, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        finalData = uint8ToBase64(out);
        compressed = true;
      } catch {
        finalData = uint8ToBase64(new Uint8Array(arrayBuffer));
      }
      setDraft(p => ({ ...p, commitmentPdf: finalData, commitmentPdfCompressed: compressed, commitmentPdfName: file.name }));
      showToast("success", "המסמך הועלה בהצלחה ✅");
    } catch {
      showToast("error", "שגיאה בעיבוד הקובץ");
    }
    setPdfUploading(false);
  };

  const save = async () => {
    setSaving(true);
    setPolicies(draft);
    const r = await storageSet("policies", draft);
    setSaving(false);
    if(r.ok) showToast("success", "הנהלים נשמרו בהצלחה ✅");
    else showToast("error", "❌ שגיאה בשמירת הנהלים");
  };

  const lt_active = LOAN_TYPES.find(l=>l.key===fsEdit);

  return (
    <div className="page">
      <div style={{marginBottom:20,fontSize:13,color:"var(--text3)"}}>
        הנהלים שתכתוב כאן יוצגו לסטודנטים בשלב האישור בטופס ההשאלה. הסטודנט יחויב לגלול ולקרוא לפני שיוכל לשלוח.
      </div>
      {LOAN_TYPES.map(lt=>(
        <div key={lt.key} className="card" style={{marginBottom:20}}>
          <div className="card-header">
            <div className="card-title">{lt.icon} נהלי {lt.label}</div>
            <button className="btn btn-secondary btn-sm" onClick={()=>setFsEdit(lt.key)}>✏️ עריכה מורחבת</button>
          </div>
          <textarea
            className="form-input"
            rows={6}
            placeholder={`כתוב כאן את נהלי ${lt.label}...`}
            value={draft[lt.key]||""}
            onChange={e=>setDraft(p=>({...p,[lt.key]:e.target.value}))}
            style={{resize:"vertical",fontFamily:"inherit",lineHeight:1.7,fontSize:13}}
          />
        </div>
      ))}
      {/* Commitment PDF */}
      <div className="card" style={{marginBottom:20}}>
        <div className="card-header"><div className="card-title">📄 מסמך התחייבות — נהלי השאלת ציוד</div></div>
        <div style={{padding:"16px 20px"}}>
          <div style={{fontSize:12,color:"var(--text3)",marginBottom:14,lineHeight:1.7}}>
            המסמך יוצג לסטודנטים בפאנל "נהלים" עם אפשרות הורדה. הסטודנט נדרש להדפיסו ולחתום עליו לפני השאלה ראשונה.
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <label className="btn btn-secondary" style={{cursor:pdfUploading?"not-allowed":"pointer",opacity:pdfUploading?0.6:1}}>
              {pdfUploading ? "⏳ מעלה..." : "📤 העלה מסמך PDF"}
              <input type="file" accept="application/pdf" style={{display:"none"}} onChange={handleCommitmentPdfUpload} disabled={pdfUploading}/>
            </label>
            {draft.commitmentPdf && (
              <button type="button" className="btn btn-secondary" onClick={()=>setDraft(p=>({...p,commitmentPdf:"",commitmentPdfCompressed:false,commitmentPdfName:""}))} style={{fontSize:12}}>
                🗑️ הסר מסמך
              </button>
            )}
          </div>
          {draft.commitmentPdf && (
            <div style={{marginTop:12,padding:"10px 14px",background:"rgba(39,174,96,0.08)",border:"1px solid rgba(39,174,96,0.3)",borderRadius:8,display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:18}}>✅</span>
              <div>
                <div style={{fontSize:13,fontWeight:800,color:"var(--green)"}}>מסמך טעון</div>
                {draft.commitmentPdfName&&<div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{draft.commitmentPdfName}</div>}
              </div>
            </div>
          )}
        </div>
      </div>

      <button className="btn btn-primary" disabled={saving} onClick={save}>
        {saving ? "⏳ שומר..." : "💾 שמור נהלים"}
      </button>

      {/* Fullscreen editor */}
      {fsEdit&&lt_active&&(
        <div style={{position:"fixed",inset:0,background:"var(--bg)",zIndex:4000,display:"flex",flexDirection:"column",direction:"rtl"}}>
          <div style={{padding:"16px 20px",background:"var(--surface)",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
            <div style={{fontWeight:900,fontSize:17}}>{lt_active.icon} עריכת נהלי {lt_active.label}</div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-primary btn-sm" onClick={async()=>{ await save(); setFsEdit(null); }}>💾 שמור וסגור</button>
              <button className="btn btn-secondary btn-sm" onClick={()=>setFsEdit(null)}>✕ סגור</button>
            </div>
          </div>
          <textarea
            value={draft[fsEdit]||""}
            onChange={e=>setDraft(p=>({...p,[fsEdit]:e.target.value}))}
            style={{flex:1,padding:"20px",background:"var(--surface2)",border:"none",outline:"none",resize:"none",fontFamily:"inherit",fontSize:15,lineHeight:1.9,color:"var(--text)",direction:"rtl"}}
            placeholder={`כתוב כאן את נהלי ${lt_active.label}...`}
          />
        </div>
      )}
    </div>
  );
}
