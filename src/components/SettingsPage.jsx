// SettingsPage.jsx — site settings management page
import { useState } from "react";
import { storageSet } from "../utils.js";

export function SettingsPage({ siteSettings, setSiteSettings, showToast }) {
  const [draft, setDraft] = useState({ ...siteSettings });
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [soundLogoUploading, setSoundLogoUploading] = useState(false);

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    if (file.size > 500000) { showToast("error", "הקובץ גדול מדי — עד 500KB"); return; }
    setLogoUploading(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setDraft(p => ({ ...p, logo: ev.target.result }));
      setLogoUploading(false);
    };
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
    reader.onload = (ev) => {
      setDraft(p => ({ ...p, soundLogo: ev.target.result }));
      setSoundLogoUploading(false);
    };
    reader.onerror = () => { showToast("error", "שגיאה בקריאת הקובץ"); setSoundLogoUploading(false); };
    reader.readAsDataURL(file);
  };

  const toggleTheme = (theme) => {
    setDraft(p => ({ ...p, theme }));
    document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "");
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
      {/* Theme */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><div className="card-title">🎨 מצב תצוגה</div></div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {[{ k: "dark", icon: "🌙", label: "מצב כהה" }, { k: "light", icon: "☀️", label: "מצב בהיר" }].map(({ k, icon, label }) => (
              <button key={k} type="button" onClick={() => toggleTheme(k)}
                style={{ flex: 1, minWidth: 140, padding: "20px 16px", borderRadius: "var(--r)", border: `2px solid ${draft.theme === k ? "var(--accent)" : "var(--border)"}`, background: draft.theme === k ? "var(--accent-glow)" : "var(--surface2)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 32 }}>{icon}</span>
                <span style={{ fontWeight: 800, fontSize: 14, color: draft.theme === k ? "var(--accent)" : "var(--text)" }}>{label}</span>
                {draft.theme === k && <span style={{ fontSize: 14, color: "var(--green)", fontWeight: 900 }}>✓ פעיל</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Logo */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><div className="card-title">🏫 לוגו המכללה</div></div>
        <div style={{ padding: "16px 20px" }}>
          {/* לוגו ראשי */}
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
          {/* מפריד */}
          <div style={{ borderTop: "1px solid var(--border)", marginBottom: 16 }} />
          {/* לוגו סאונד */}
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

      {/* Accent Color */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><div className="card-title">🎨 בחירת צבע לחצנים / טקסט</div></div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 14 }}>
            הצבע יוחל על הלחצנים, הכותרות והטקסטים הצבעוניים בטופס השאלת הציוד ועל אייקון המידע.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <input type="color" value={draft.accentColor||"#f5a623"}
              onChange={e => setDraft(p => ({ ...p, accentColor: e.target.value }))}
              style={{ width: 52, height: 40, borderRadius: 8, border: "2px solid var(--border)", background: "none", cursor: "pointer", padding: 2 }} />
            <span style={{ fontSize: 13, color: "var(--text2)", fontFamily: "monospace" }}>{draft.accentColor||"#f5a623"}</span>
            <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }}
              onClick={() => setDraft(p => ({ ...p, accentColor: "#f5a623" }))}>
              ↩ איפוס לברירת מחדל
            </button>
          </div>
          <div style={{ marginTop: 14, padding: "12px 16px", borderRadius: 8, background: "var(--surface2)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>תצוגה מקדימה:</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" style={{ background: draft.accentColor||"#f5a623", color: "#0a0c10", border: "none", borderRadius: 8, padding: "8px 18px", fontWeight: 800, cursor: "default", fontSize: 13 }}>כפתור לדוגמה</button>
              <span style={{ color: draft.accentColor||"#f5a623", fontWeight: 800, fontSize: 14 }}>טקסט צבעוני</span>
              <svg width="32" height="32" viewBox="0 0 42 42" fill="none" style={{ color: draft.accentColor||"#f5a623" }}>
                <circle cx="21" cy="21" r="19" stroke="currentColor" strokeWidth="2.2"/>
                <circle cx="21" cy="14.5" r="2.2" fill="currentColor"/>
                <rect x="19.4" y="19.5" width="3.2" height="10.5" rx="1.6" fill="currentColor"/>
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Admin Accent Color + Font Size */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><div className="card-title">🖥️ בחירת צבע לחצים / טקסט לוח בקרה</div></div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 14 }}>
            הצבע יוחל על הלחצנים, הכותרות והטקסטים הצבעוניים בלוח הבקרה (בנפרד מטופס ההשאלה).
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
            <input type="color" value={draft.adminAccentColor||"#f5a623"}
              onChange={e => setDraft(p => ({ ...p, adminAccentColor: e.target.value }))}
              style={{ width: 52, height: 40, borderRadius: 8, border: "2px solid var(--border)", background: "none", cursor: "pointer", padding: 2 }} />
            <span style={{ fontSize: 13, color: "var(--text2)", fontFamily: "monospace" }}>{draft.adminAccentColor||"#f5a623"}</span>
            <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }}
              onClick={() => setDraft(p => ({ ...p, adminAccentColor: "#f5a623" }))}>
              ↩ איפוס לברירת מחדל
            </button>
          </div>
          <div style={{ borderTop: "1px solid var(--border)", marginBottom: 16 }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 10 }}>גודל פונט (דסקטופ בלבד)</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <input type="range" min={11} max={20} step={1}
              value={draft.adminFontSize||14}
              onChange={e => setDraft(p => ({ ...p, adminFontSize: Number(e.target.value) }))}
              style={{ width: 180, accentColor: draft.adminAccentColor||"#f5a623" }} />
            <span style={{ fontSize: 14, fontWeight: 700, minWidth: 32, color: "var(--text2)" }}>{draft.adminFontSize||14}px</span>
            <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }}
              onClick={() => setDraft(p => ({ ...p, adminFontSize: 14 }))}>
              ↩ איפוס
            </button>
          </div>
          <div style={{ marginTop: 14, padding: "12px 16px", borderRadius: 8, background: "var(--surface2)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>תצוגה מקדימה:</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: draft.adminFontSize||14 }}>
              <button type="button" style={{ background: draft.adminAccentColor||"#f5a623", color: "#0a0c10", border: "none", borderRadius: 8, padding: "8px 18px", fontWeight: 800, cursor: "default", fontSize: "inherit" }}>כפתור לדוגמה</button>
              <span style={{ color: draft.adminAccentColor||"#f5a623", fontWeight: 800, fontSize: "inherit" }}>טקסט צבעוני</span>
            </div>
          </div>
        </div>
      </div>

      {/* AI Chatbot */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><div className="card-title">🤖 עוזר AI לסטודנטים</div></div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 14 }}>
            הגבלת מספר שאלות שסטודנט יכול לשאול את עוזר ה-AI ביום אחד.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)" }}>הגבלת בקשות AI לסטודנט (ליום)</label>
            <input type="number" min={1} max={50}
              value={draft.aiMaxRequests ?? 5}
              onChange={e => setDraft(p => ({ ...p, aiMaxRequests: Number(e.target.value) }))}
              style={{ width: 80, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 14, textAlign: "center" }} />
          </div>
        </div>
      </div>

      <button className="btn btn-primary" disabled={saving} onClick={save} style={{ fontSize: 15, padding: "12px 32px" }}>
        {saving ? "⏳ שומר..." : "💾 שמור הגדרות"}
      </button>
    </div>
  );
}
