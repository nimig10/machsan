// SystemSettingsPage.jsx — global system settings (admin only)
import { useEffect, useRef, useState } from "react";
import { Camera, FileText, FileSpreadsheet, Film, Mic, Video, Trash2, Plus, ChevronDown, ChevronUp, Save } from "lucide-react";
import { syncAllSiteSettings } from "../utils/siteSettingsApi.js";
import { USER_GUIDE_SLOTS, loadUserGuideAsset, upsertUserGuideAsset, deleteUserGuideAsset } from "../utils/userGuideAssetsApi.js";
import { XL_TEMPLATE_SLOTS, loadXlTemplate, upsertXlTemplate, deleteXlTemplate } from "../utils/xlTemplatesApi.js";

const PDF_MAX_BYTES = 5 * 1024 * 1024; // 5MB
const XL_MAX_BYTES = 2 * 1024 * 1024;  // 2MB

export function SystemSettingsPage({ siteSettings, setSiteSettings, showToast }) {
  const [draft, setDraft] = useState({ aiMaxRequests: 5, publicDisplayInterval: 18, ...siteSettings });

  // DATA-LOSS GUARD — do not remove without reading this.
  //
  // `draft` is seeded by a useState initializer, which runs EXACTLY ONCE. If
  // this page mounts before App finishes loading site_settings (it does: the
  // admin view is restored from sessionStorage, so a refresh while sitting on
  // this page re-mounts it immediately), `draft` freezes on App's placeholder —
  // which contains `userGuideVideos: []`. The panels then show "אין סרטונים"
  // for lists that are perfectly intact in the DB, and pressing שמור writes
  // that empty array straight over them, because syncAllSiteSettings upserts
  // every key present in the blob.
  //
  // The rule below only ever FILLS IN blanks: a key already holding something
  // in the draft is never overwritten, so an edit in progress survives, while a
  // stale-empty list gets repaired the moment the real settings arrive.
  const seededFrom = useRef(siteSettings);
  useEffect(() => {
    if (siteSettings === seededFrom.current) return; // same object, nothing new
    seededFrom.current = siteSettings;
    setDraft(prev => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(siteSettings || {})) {
        const cur = next[k];
        const blank = cur === undefined || cur === null || cur === ""
          || (Array.isArray(cur) && cur.length === 0);
        if (blank) next[k] = v;
      }
      return next;
    });
  }, [siteSettings]);
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [soundLogoUploading, setSoundLogoUploading] = useState(false);
  // PDF user-guide assets — keyed by slot. `pdfDrafts` holds the editable state;
  // `pdfInitial` is the snapshot at mount used to diff on save (upsert/delete).
  const [pdfDrafts, setPdfDrafts] = useState({});
  const [pdfInitial, setPdfInitial] = useState({});
  const [pdfUploading, setPdfUploading] = useState({});
  // XL templates — same pattern as PDF assets
  const [xlDrafts, setXlDrafts] = useState({});
  const [xlInitial, setXlInitial] = useState({});
  const [xlUploading, setXlUploading] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const entries = await Promise.all(
          Object.values(USER_GUIDE_SLOTS).map(async (slot) => [slot, await loadUserGuideAsset(slot)])
        );
        if (cancelled) return;
        const map = Object.fromEntries(entries);
        setPdfDrafts(map);
        setPdfInitial(map);
      } catch (err) {
        console.warn("[SystemSettingsPage] load user-guide PDFs failed", err);
      }
    })();
    (async () => {
      try {
        const entries = await Promise.all(
          Object.values(XL_TEMPLATE_SLOTS).map(async (slot) => [slot, await loadXlTemplate(slot)])
        );
        if (cancelled) return;
        const map = Object.fromEntries(entries);
        setXlDrafts(map);
        setXlInitial(map);
      } catch (err) {
        console.warn("[SystemSettingsPage] load XL templates failed", err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handlePdfUpload = (slot, file) => {
    if (!file) return;
    if (file.type !== "application/pdf") { showToast("error", "רק קבצי PDF נתמכים"); return; }
    if (file.size > PDF_MAX_BYTES) { showToast("error", "הקובץ גדול מדי — עד 5MB"); return; }
    setPdfUploading(p => ({ ...p, [slot]: true }));
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = String(ev.target?.result || "");
      const base64 = dataUrl.split(",")[1] || "";
      setPdfDrafts(p => ({ ...p, [slot]: { filename: file.name, data_base64: base64 } }));
      setPdfUploading(p => ({ ...p, [slot]: false }));
    };
    reader.onerror = () => { showToast("error", "שגיאה בקריאת הקובץ"); setPdfUploading(p => ({ ...p, [slot]: false })); };
    reader.readAsDataURL(file);
  };

  const removePdf = (slot) => setPdfDrafts(p => ({ ...p, [slot]: null }));

  const handleXlUpload = (slot, file) => {
    if (!file) return;
    const name = (file.name || "").toLowerCase();
    const okExt = name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv") || name.endsWith(".tsv");
    if (!okExt) { showToast("error", "רק קבצי Excel/CSV נתמכים (.xlsx, .xls, .csv, .tsv)"); return; }
    if (file.size > XL_MAX_BYTES) { showToast("error", "הקובץ גדול מדי — עד 2MB"); return; }
    setXlUploading(p => ({ ...p, [slot]: true }));
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = String(ev.target?.result || "");
      const base64 = dataUrl.split(",")[1] || "";
      setXlDrafts(p => ({ ...p, [slot]: { filename: file.name, data_base64: base64 } }));
      setXlUploading(p => ({ ...p, [slot]: false }));
    };
    reader.onerror = () => { showToast("error", "שגיאה בקריאת הקובץ"); setXlUploading(p => ({ ...p, [slot]: false })); };
    reader.readAsDataURL(file);
  };

  const removeXl = (slot) => setXlDrafts(p => ({ ...p, [slot]: null }));
  // Track which video editors are open. Existing videos load collapsed (a
  // compact row); newly-added or just-saved videos collapse too. Adding a
  // new video opens it automatically. The "save" button collapses the row.
  const [openVideoIds, setOpenVideoIds] = useState(new Set());
  const toggleVideoOpen = (id) => setOpenVideoIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const closeVideo = (id) => setOpenVideoIds(prev => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev); next.delete(id); return next;
  });

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
    try {
      await syncAllSiteSettings(draft);
      // Diff PDF drafts vs initial — upsert when content changed, delete when cleared.
      const slots = Object.values(USER_GUIDE_SLOTS);
      await Promise.all(slots.map(async (slot) => {
        const next = pdfDrafts[slot] || null;
        const prev = pdfInitial[slot] || null;
        const sameBase64 = (next?.data_base64 || null) === (prev?.data_base64 || null);
        const sameName = (next?.filename || null) === (prev?.filename || null);
        if (sameBase64 && sameName) return;
        if (next && next.data_base64) {
          await upsertUserGuideAsset(slot, { filename: next.filename, data_base64: next.data_base64 });
        } else if (prev) {
          await deleteUserGuideAsset(slot);
        }
      }));
      setPdfInitial(pdfDrafts);
      // XL templates — same diff/upsert/delete logic
      const xlSlots = Object.values(XL_TEMPLATE_SLOTS);
      await Promise.all(xlSlots.map(async (slot) => {
        const next = xlDrafts[slot] || null;
        const prev = xlInitial[slot] || null;
        const sameBase64 = (next?.data_base64 || null) === (prev?.data_base64 || null);
        const sameName = (next?.filename || null) === (prev?.filename || null);
        if (sameBase64 && sameName) return;
        if (next && next.data_base64) {
          await upsertXlTemplate(slot, { filename: next.filename, data_base64: next.data_base64 });
        } else if (prev) {
          await deleteXlTemplate(slot);
        }
      }));
      setXlInitial(xlDrafts);
      showToast("success", "ההגדרות נשמרו");
    } catch (err) {
      console.warn("[SystemSettingsPage.save]", err);
      showToast("error", "שגיאה בשמירה — נסה שוב");
    } finally {
      setSaving(false);
    }
  };

  // Renders one audience-specific video-management panel (students / staff /
  // lecturers). Each panel reads + writes its own JSON array on `draft` so
  // the three lists stay independent. `pdfSlot` (optional) adds a PDF upload
  // section at the bottom for "הוראות הפעלה" for that audience.
  const renderVideoPanel = ({ draftKey, title, description, pdfSlot }) => {
    const list = draft[draftKey] || [];
    const setList = (updater) => setDraft(p => ({ ...p, [draftKey]: updater(p[draftKey] || []) }));
    const pdf = pdfSlot ? pdfDrafts[pdfSlot] : null;
    const isPdfUploading = pdfSlot ? !!pdfUploading[pdfSlot] : false;
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><div className="card-title"><Video size={16} strokeWidth={1.75} color="var(--accent)" style={{ verticalAlign: "middle", marginLeft: 6 }} /> {title}</div></div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 14, lineHeight: 1.5 }}>
            {description} הסרטונים יוטמעו אוטומטית כשהם מ-YouTube או מ-Google Drive. הוסיפו את הקישור (URL) ופיסקת תיאור קצרה לכל סרטון.
          </div>
          <div style={{ fontSize: 12, color: "var(--warning,#f59e0b)", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 8, padding: "10px 12px", marginBottom: 14, lineHeight: 1.6 }}>
            <strong>⚠️ חשוב — סרטוני Google Drive:</strong> הקובץ חייב להיות משותף עם <strong>"כל מי שיש לו את הקישור" (Anyone with the link)</strong> בהרשאת צפייה. אחרת המשתמשים יקבלו 403 ולא יוכלו לראות את הסרטון. לבדוק: לחצו ימני על הקובץ ב-Drive → שיתוף → גישה כללית → "כל מי שיש לו את הקישור".
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {list.length === 0 && (
              <div style={{ padding: "12px 14px", borderRadius: 8, background: "var(--surface2)", border: "1px dashed var(--border)", fontSize: 13, color: "var(--text3)" }}>
                עדיין אין סרטונים. לחצו על "הוסף סרטון" כדי להתחיל.
              </div>
            )}
            {list.map((v, idx) => {
              const isOpen = openVideoIds.has(v.id);
              const orientationLabel = v.orientation === "vertical" ? "📱 אנכי" : "🖥️ אופקי";
              if (!isOpen) {
                return (
                  <div key={v.id}
                    onClick={() => toggleVideoOpen(v.id)}
                    style={{ padding: "10px 14px", borderRadius: 10, background: "var(--surface2)", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", transition: "border-color 0.15s, background 0.15s" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "var(--accent)", flexShrink: 0 }}>סרטון {idx + 1}</div>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {v.title || v.description || (v.url ? v.url : <span style={{ color: "var(--text3)", fontStyle: "italic" }}>סרטון ריק — לחץ לעריכה</span>)}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", flexShrink: 0 }}>{orientationLabel}</span>
                    <button type="button" className="btn btn-secondary"
                      onClick={e => { e.stopPropagation(); setList(arr => arr.filter(x => x.id !== v.id)); closeVideo(v.id); }}
                      style={{ fontSize: 12, padding: "4px 8px", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}
                      title="הסר סרטון">
                      <Trash2 size={12} strokeWidth={1.75} />
                    </button>
                    <ChevronDown size={16} strokeWidth={1.75} color="var(--text3)" />
                  </div>
                );
              }
              return (
                <div key={v.id} style={{ padding: "12px 14px", borderRadius: 10, background: "var(--surface2)", border: "1px solid var(--accent)", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div onClick={() => toggleVideoOpen(v.id)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer" }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "var(--accent)", display: "flex", alignItems: "center", gap: 6 }}>
                      <ChevronUp size={14} strokeWidth={1.75} color="var(--accent)" />
                      סרטון {idx + 1}
                    </div>
                    <button type="button" className="btn btn-secondary"
                      onClick={e => { e.stopPropagation(); setList(arr => arr.filter(x => x.id !== v.id)); closeVideo(v.id); }}
                      style={{ fontSize: 12, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Trash2 size={12} strokeWidth={1.75} /> הסר
                    </button>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 4 }}>כותרת הסרטון</label>
                    <input
                      type="text"
                      placeholder="לדוגמה: איך לקבוע חדר ולהשאיל ציוד סאונד"
                      value={v.title || ""}
                      onChange={e => { const next = e.target.value; setList(arr => arr.map(x => x.id === v.id ? { ...x, title: next } : x)); }}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13 }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 4 }}>קישור (YouTube / Google Drive)</label>
                    <input
                      type="url"
                      placeholder="https://www.youtube.com/watch?v=... או https://drive.google.com/file/d/.../view"
                      value={v.url || ""}
                      onChange={e => { const next = e.target.value; setList(arr => arr.map(x => x.id === v.id ? { ...x, url: next } : x)); }}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, direction: "ltr", textAlign: "left" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 4 }}>תיאור קצר</label>
                    <textarea
                      rows={3}
                      placeholder="לדוגמה: איך לקבוע חדר ולהשאיל ציוד סאונד"
                      value={v.description || ""}
                      onChange={e => { const next = e.target.value; setList(arr => arr.map(x => x.id === v.id ? { ...x, description: next } : x)); }}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, fontFamily: "inherit", resize: "vertical" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 4 }}>פורמט הסרטון</label>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {[
                        { key: "landscape", label: "🖥️ אופקי 16:9", hint: "סרטון רגיל" },
                        { key: "vertical",  label: "📱 אנכי 9:16",  hint: "story / shorts" },
                      ].map(opt => {
                        const isActive = (v.orientation || "landscape") === opt.key;
                        return (
                          <button
                            type="button"
                            key={opt.key}
                            onClick={() => setList(arr => arr.map(x => x.id === v.id ? { ...x, orientation: opt.key } : x))}
                            style={{ flex: "0 1 auto", padding: "8px 14px", borderRadius: 8, border: `2px solid ${isActive ? "var(--accent)" : "var(--border)"}`, background: isActive ? "var(--accent-glow)" : "var(--surface)", color: isActive ? "var(--accent)" : "var(--text2)", fontWeight: isActive ? 800 : 600, fontSize: 12, cursor: "pointer", display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                            <span>{opt.label}</span>
                            <span style={{ fontSize: 10, fontWeight: 500, color: isActive ? "var(--accent)" : "var(--text3)" }}>{opt.hint}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
                    <button type="button" className="btn btn-primary" onClick={() => closeVideo(v.id)}
                      style={{ fontSize: 13, padding: "8px 18px", display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Save size={14} strokeWidth={1.75} /> שמור וסגור
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <button type="button" className="btn btn-secondary"
            onClick={() => {
              const newId = `video_${Date.now()}_${list.length}`;
              setList(arr => [...arr, { id: newId, title: "", url: "", description: "", orientation: "landscape" }]);
              setOpenVideoIds(prev => { const next = new Set(prev); next.add(newId); return next; });
            }}
            style={{ marginTop: 14, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Plus size={14} strokeWidth={1.75} /> הוסף סרטון
          </button>

          {pdfSlot && (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                <FileText size={12} strokeWidth={1.75} color="var(--accent)" /> מסמך PDF נלווה (אופציונלי)
              </div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 12, lineHeight: 1.5 }}>
                אם יועלה — יופיע כפתור "הוראות הפעלה" צהוב ליד הסרטונים בדף של הקהל הזה. עד 5MB.
              </div>
              {pdf && pdf.data_base64 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 14px", borderRadius: 10, background: "var(--surface2)", border: "1px solid var(--border)" }}>
                  <FileText size={18} strokeWidth={1.75} color="var(--accent)" />
                  <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {pdf.filename || "מסמך"}
                  </div>
                  <label className="btn btn-secondary" style={{ cursor: isPdfUploading ? "not-allowed" : "pointer", opacity: isPdfUploading ? 0.6 : 1, fontSize: 12 }}>
                    {isPdfUploading ? "מעלה..." : "החלף"}
                    <input type="file" accept="application/pdf" style={{ display: "none" }} disabled={isPdfUploading}
                      onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; handlePdfUpload(pdfSlot, f); }} />
                  </label>
                  <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }}
                    onClick={() => removePdf(pdfSlot)}>
                    <Trash2 size={12} strokeWidth={1.75} /> הסר
                  </button>
                </div>
              ) : (
                <label className="btn btn-secondary" style={{ cursor: isPdfUploading ? "not-allowed" : "pointer", opacity: isPdfUploading ? 0.6 : 1, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {isPdfUploading ? "מעלה..." : <><FileText size={14} strokeWidth={1.75} /> העלה מסמך PDF</>}
                  <input type="file" accept="application/pdf" style={{ display: "none" }} disabled={isPdfUploading}
                    onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; handlePdfUpload(pdfSlot, f); }} />
                </label>
              )}
            </div>
          )}
        </div>
      </div>
    );
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
                : <Film size={32} strokeWidth={1.75} color="var(--text3)" />}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label className="btn btn-secondary" style={{ cursor: logoUploading ? "not-allowed" : "pointer", opacity: logoUploading ? 0.6 : 1 }}>
                {logoUploading ? "מעלה..." : <><Camera size={14} strokeWidth={1.75} /> העלה לוגו</>}
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
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}><Mic size={12} strokeWidth={1.75} color="var(--accent)" /> לוגו סאונד (לוגו נוסף)</div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>
            לוגו נוסף שיוצג מתחת ללוגו הראשי בסרגל לוח הבקרה ובטופס ההשאלה. מומלץ עד 500KB.
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ width: 80, height: 80, borderRadius: 12, border: "2px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface2)", overflow: "hidden", flexShrink: 0 }}>
              {draft.soundLogo
                ? <img src={draft.soundLogo} alt="לוגו סאונד" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                : <Mic size={32} strokeWidth={1.75} color="var(--text3)" />}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label className="btn btn-secondary" style={{ cursor: soundLogoUploading ? "not-allowed" : "pointer", opacity: soundLogoUploading ? 0.6 : 1 }}>
                {soundLogoUploading ? "מעלה..." : <><Camera size={14} strokeWidth={1.75} /> העלה לוגו סאונד</>}
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

      {/* User Guide Videos — three independent panels, one per audience:
          - userGuideVideos          → students (PublicForm "המדריך למשתמש" tab)
          - staffUserGuideVideos     → staff (Staff Hub button)
          - lecturerUserGuideVideos  → lecturers (LecturerPortal button)
          URLs are YouTube or Drive; UserGuideVideosModal embeds them via
          videoEmbedSrc and respects per-video orientation (landscape/vertical). */}
      {renderVideoPanel({
        draftKey: "userGuideVideos",
        title: "המדריך למשתמש — סטודנטים (מערכת הפניות)",
        description: "סרטונים שיופיעו בטאב \"המדריך למשתמש\" שב\"מידע כללי\" של הטופס הציבורי — קהל היעד: סטודנטים.",
        pdfSlot: USER_GUIDE_SLOTS.students,
      })}
      {renderVideoPanel({
        draftKey: "staffUserGuideVideos",
        title: "המדריך למשתמש — צוות (Staff Hub)",
        description: "סרטונים שיופיעו בלחצן \"המדריך למשתמש\" ב-Staff Hub — קהל היעד: צוות / אדמין.",
        pdfSlot: USER_GUIDE_SLOTS.staff,
      })}
      {renderVideoPanel({
        draftKey: "lecturerUserGuideVideos",
        title: "המדריך למשתמש — מרצים (פורטל מרצה)",
        description: "סרטונים שיופיעו בלחצן \"המדריך למשתמש\" בפורטל המרצה — קהל היעד: מרצים וראשי מחלקה.",
        pdfSlot: USER_GUIDE_SLOTS.lecturers,
      })}

      {/* XL Import Templates */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><div className="card-title" style={{display:"inline-flex",alignItems:"center",gap:6}}><FileSpreadsheet size={16} strokeWidth={1.75} color="var(--accent)"/> טמפלטים לייבוא Excel (XL)</div></div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 14, lineHeight: 1.6 }}>
            העלה את קבצי הטמפלט שמשתמשים בתת אדמין "אדמיניסטרציה" יכולים להוריד תחת "טמפלטים להורדה — ייבוא מקובץ XL". אם לא יועלה קובץ — תוצג ברירת המחדל המובנית בקוד. עד 2MB. סוגים נתמכים: .xlsx, .xls, .csv, .tsv.
          </div>
          {[
            { slot: XL_TEMPLATE_SLOTS.courses,  label: "טמפלט העלאת קורסים", hint: "מבנה לייבוא שיעורים / קורסים" },
            { slot: XL_TEMPLATE_SLOTS.students, label: "טמפלט ייבוא סטודנטים", hint: "מבנה לייבוא רשימת סטודנטים" },
          ].map(({ slot, label, hint }) => {
            const file = xlDrafts[slot] || null;
            const isUploading = !!xlUploading[slot];
            return (
              <div key={slot} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>{hint}</div>
                {file && file.data_base64 ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 14px", borderRadius: 10, background: "var(--surface2)", border: "1px solid var(--border)" }}>
                    <FileSpreadsheet size={18} strokeWidth={1.75} color="var(--accent)" />
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {file.filename || "קובץ"}
                    </div>
                    <label className="btn btn-secondary" style={{ cursor: isUploading ? "not-allowed" : "pointer", opacity: isUploading ? 0.6 : 1, fontSize: 12 }}>
                      {isUploading ? "מעלה..." : "החלף"}
                      <input type="file" accept=".xlsx,.xls,.csv,.tsv" style={{ display: "none" }} disabled={isUploading}
                        onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; handleXlUpload(slot, f); }} />
                    </label>
                    <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }}
                      onClick={() => removeXl(slot)}>
                      <Trash2 size={12} strokeWidth={1.75} /> הסר
                    </button>
                  </div>
                ) : (
                  <label className="btn btn-secondary" style={{ cursor: isUploading ? "not-allowed" : "pointer", opacity: isUploading ? 0.6 : 1, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {isUploading ? "מעלה..." : <><FileSpreadsheet size={14} strokeWidth={1.75} /> העלה טמפלט</>}
                    <input type="file" accept=".xlsx,.xls,.csv,.tsv" style={{ display: "none" }} disabled={isUploading}
                      onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; handleXlUpload(slot, f); }} />
                  </label>
                )}
              </div>
            );
          })}
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

<button className="btn btn-primary" disabled={saving} onClick={save} style={{ fontSize: 15, padding: "12px 32px" }}>
        {saving ? "שומר..." : "שמור הגדרות"}
      </button>
    </div>
  );
}
