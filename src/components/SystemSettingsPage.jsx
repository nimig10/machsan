// SystemSettingsPage.jsx — global system settings (admin only)
import { useState } from "react";

function uint8ToBase64(bytes) {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export function SystemSettingsPage({ siteSettings, setSiteSettings, showToast, storageSet }) {
  const [draft, setDraft] = useState({ aiMaxRequests: 5, publicDisplayInterval: 18, ...siteSettings });
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [soundLogoUploading, setSoundLogoUploading] = useState(false);
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
        w.write(new Uint8Array(arrayBuffer));
        w.close();
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

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    if (file.size > 500000) { showToast("error", "הקובץ גדול מדי — עד 500KB"); return; }
    setLogoUploading(true);
    const reader = new FileReader();
    reader.onload = (ev) => { setDraft(p => ({ ...p, logo: ev.target.result })); setLogoUploading(false); };
    reader.onerror = () => { showToast("error", "שגיאה בקריאת הקובץ"); setLogoUploading(false); };
    reader.readAsDataURL(file);
  };

  const handleSoundLogoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    if (file.size > 500000) { showToast("error", "הקובץ גדול מדי — עד 500KB"); return; }
    setSoundLogoUploading(true);
    const reader = new FileReader();
    reader.onload = (ev) => { setDraft(p => ({ ...p, soundLogo: ev.target.result })); setSoundLogoUploading(false); };
    reader.onerror = () => { showToast("error", "שגיאה בקריאת הקובץ"); setSoundLogoUploading(false); };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setSaving(true);
    setSiteSettings(draft);
    await storageSet("siteSettings", draft);
    setSaving(false);
    showToast("success", "ההגדרות נשמרו ✅");
  };

  return (
    <div className="page">

      {/* Logo */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><div className="card-title">🏫 לוגו המכללה</div></div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 8 }}>לוגו ראשי</div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>
            יוצג בסרגל הצדדי של לוח הבקרה ובראש טופס ההשאלה. מומלץ תמונה מרובעת עד 500KB.
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 20 }}>
            <div style={{ width: 80, height: 80, borderRadius: 12, border: "2px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface2)", overflow: "hidden", flexShrink: 0 }}>
              {draft.logo
                ? <img src={draft.logo} alt="לוגו" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                : <span style={{ fontSize: 32, color: "var(--text3)" }}>🎬</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label className="btn btn-secondary" style={{ cursor: logoUploading ? "not-allowed" : "pointer", opacity: logoUploading ? 0.6 : 1 }}>
                {logoUploading ? "⏳ מעלה..." : "📷 העלה לוגו"}
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleLogoUpload} disabled={logoUploading} />
              </label>
              {draft.logo && (
                <button type="button" className="btn btn-secondary" onClick={() => setDraft(p => ({ ...p, logo: "" }))} style={{ fontSize: 12 }}>
                  🗑️ הסר לוגו
                </button>
              )}
            </div>
          </div>
          <div style={{ borderTop: "1px solid var(--border)", marginBottom: 16 }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 8 }}>🎙️ לוגו סאונד (לוגו נוסף)</div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>
            לוגו נוסף שיוצג מתחת ללוגו הראשי בסרגל לוח הבקרה ובטופס ההשאלה. מומלץ עד 500KB.
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ width: 80, height: 80, borderRadius: 12, border: "2px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface2)", overflow: "hidden", flexShrink: 0 }}>
              {draft.soundLogo
                ? <img src={draft.soundLogo} alt="לוגו סאונד" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                : <span style={{ fontSize: 32, color: "var(--text3)" }}>🎙️</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label className="btn btn-secondary" style={{ cursor: soundLogoUploading ? "not-allowed" : "pointer", opacity: soundLogoUploading ? 0.6 : 1 }}>
                {soundLogoUploading ? "⏳ מעלה..." : "📷 העלה לוגו סאונד"}
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleSoundLogoUpload} disabled={soundLogoUploading} />
              </label>
              {draft.soundLogo && (
                <button type="button" className="btn btn-secondary" onClick={() => setDraft(p => ({ ...p, soundLogo: "" }))} style={{ fontSize: 12 }}>
                  🗑️ הסר לוגו סאונד
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Public Form Accent Color */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><div className="card-title">🎨 צבע לחצנים — טופס ציבורי</div></div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 14 }}>
            הצבע יוחל על הלחצנים, הכותרות והטקסטים הצבעוניים בטופס השאלת הציוד הציבורי.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <input type="color" value={draft.accentColor || "#f5a623"}
              onChange={e => setDraft(p => ({ ...p, accentColor: e.target.value }))}
              style={{ width: 52, height: 40, borderRadius: 8, border: "2px solid var(--border)", background: "none", cursor: "pointer", padding: 2 }} />
            <span style={{ fontSize: 13, color: "var(--text2)", fontFamily: "monospace" }}>{draft.accentColor || "#f5a623"}</span>
            <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }}
              onClick={() => setDraft(p => ({ ...p, accentColor: "#f5a623" }))}>
              ↩ איפוס לברירת מחדל
            </button>
          </div>
          <div style={{ marginTop: 14, padding: "12px 16px", borderRadius: 8, background: "var(--surface2)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>תצוגה מקדימה:</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" style={{ background: draft.accentColor || "#f5a623", color: "#0a0c10", border: "none", borderRadius: 8, padding: "8px 18px", fontWeight: 800, cursor: "default", fontSize: 13 }}>כפתור לדוגמה</button>
              <span style={{ color: draft.accentColor || "#f5a623", fontWeight: 800, fontSize: 14 }}>טקסט צבעוני</span>
            </div>
          </div>
        </div>
      </div>

      {/* Daily Display */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><div className="card-title">📺 לוח לוז יומי ציבורי</div></div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 14 }}>
            דף ציבורי לתצוגת לוז יומי על מסך/צג. הקישור:{" "}
            <code style={{ background: "var(--surface3)", padding: "2px 6px", borderRadius: 4 }}>{typeof window !== "undefined" ? window.location.origin : ""}/daily</code>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)" }}>זמן חילוף תצוגה (שניות)</label>
            <input
              type="number" min={5} max={300}
              value={draft.publicDisplayInterval ?? 18}
              onChange={e => setDraft(p => ({ ...p, publicDisplayInterval: Number(e.target.value) }))}
              style={{ width: 80, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 14, textAlign: "center" }}
            />
            <span style={{ fontSize: 12, color: "var(--text3)" }}>ברירת מחדל: 18 שניות</span>
          </div>
        </div>
      </div>

      {/* AI */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><div className="card-title">🤖 עוזר AI לסטודנטים</div></div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 14 }}>
            הגבלת מספר השאלות שכל סטודנט יכול לשאול את עוזר ה-AI ביום אחד.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)" }}>הגבלת בקשות AI לסטודנט (ליום)</label>
            <input
              type="number" min={1} max={50}
              value={draft.aiMaxRequests ?? 5}
              onChange={e => setDraft(p => ({ ...p, aiMaxRequests: Number(e.target.value) }))}
              style={{ width: 80, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 14, textAlign: "center" }}
            />
          </div>
        </div>
      </div>

      {/* Warehouse commitment PDF */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><div className="card-title">🏭 תפעול מחסן</div></div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text2)", marginBottom: 6 }}>📄 מסמך התחייבות — נהלי השאלת ציוד</div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 14, lineHeight: 1.7 }}>
            המסמך יוצג בפאנל "נהלים" בטופס הציבורי לסטודנטים, עם אפשרות הורדה. הסטודנט נדרש להדפיסו ולחתום עליו לפני השאלה ראשונה.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <label className="btn btn-secondary" style={{ cursor: pdfUploading ? "not-allowed" : "pointer", opacity: pdfUploading ? 0.6 : 1 }}>
              {pdfUploading ? "⏳ מעלה..." : "📤 העלה מסמך PDF"}
              <input type="file" accept="application/pdf" style={{ display: "none" }} onChange={handleCommitmentPdfUpload} disabled={pdfUploading} />
            </label>
            {draft.commitmentPdf && (
              <button type="button" className="btn btn-secondary" onClick={() => setDraft(p => ({ ...p, commitmentPdf: "", commitmentPdfCompressed: false, commitmentPdfName: "" }))} style={{ fontSize: 12 }}>
                🗑️ הסר מסמך
              </button>
            )}
          </div>
          {draft.commitmentPdf && (
            <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(39,174,96,0.08)", border: "1px solid rgba(39,174,96,0.3)", borderRadius: 8, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }}>✅</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "var(--green)" }}>מסמך טעון</div>
                {draft.commitmentPdfName && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{draft.commitmentPdfName}</div>}
              </div>
            </div>
          )}
        </div>
      </div>

      <button className="btn btn-primary" disabled={saving} onClick={save} style={{ fontSize: 15, padding: "12px 32px" }}>
        {saving ? "⏳ שומר..." : "💾 שמור הגדרות"}
      </button>
    </div>
  );
}
