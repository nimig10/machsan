// SystemSettingsPage.jsx — global system settings (admin only)
import { useEffect, useRef, useState } from "react";
import { Camera, FileText, FileSpreadsheet, Film, Mic, Video, Trash2, Plus, ChevronDown, ChevronUp, Save, Megaphone } from "lucide-react";
import { setSetting } from "../utils/siteSettingsApi.js";
import { USER_GUIDE_SLOTS, loadUserGuideAsset, upsertUserGuideAsset, deleteUserGuideAsset } from "../utils/userGuideAssetsApi.js";
import { XL_TEMPLATE_SLOTS, loadXlTemplate, upsertXlTemplate, deleteXlTemplate } from "../utils/xlTemplatesApi.js";
import { AUDIENCE_LABELS } from "../utils/announcementPolicy.js";
import * as XLSX from "xlsx";
import { adminGetAnnouncement, adminGetAnnouncementViewers, adminSaveAnnouncement, adminPublishAnnouncement, adminDeactivateAnnouncement } from "../utils/announcementsApi.js";
import { DailyAnnouncementModal } from "./DailyAnnouncementModal.jsx";

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
  // Which panel is mid-save, so the spinner sits on that panel alone. There is
  // no page-wide "saving" any more: every panel writes only its own keys.
  const [busyPanel, setBusyPanel] = useState(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [soundLogoUploading, setSoundLogoUploading] = useState(false);
  // PDF user-guide assets, keyed by slot. Uploading or removing one persists
  // immediately — the file dialog IS the confirmation — so there is no
  // "initial" snapshot to diff against any more.
  const [pdfDrafts, setPdfDrafts] = useState({});
  const [pdfUploading, setPdfUploading] = useState({});
  // XL templates — same immediate-write pattern as PDF assets
  const [xlDrafts, setXlDrafts] = useState({});
  const [xlUploading, setXlUploading] = useState({});
  // Daily announcement — its own load/save cycle through /api/announcement,
  // NOT part of `draft`/syncAllSiteSettings. It lives in its own table (the
  // text must not ship to every client inside the site_settings blob), and it
  // has two distinct save semantics that a single "שמור" button cannot express.
  const [annDraft, setAnnDraft] = useState({
    title: "", body: "", audience: "all", displayDays: 1,
    videoUrl: "", videoTitle: "", videoOrientation: "landscape",
  });
  const [annActive, setAnnActive] = useState(null); // the published row, or null
  const [annViewers, setAnnViewers] = useState(0);
  const [annBusy, setAnnBusy] = useState(false);
  const [annPreview, setAnnPreview] = useState(null);
  // Viewer list — loaded on demand when the admin opens the panel, never on
  // page load: it is a full read of the views table plus the user table, and
  // nobody needs it just for having opened הגדרות מערכת.
  const [annViewerList, setAnnViewerList] = useState(null); // null = closed
  const [annViewersLoading, setAnnViewersLoading] = useState(false);
  // The body textarea fits itself to its content. Reset to "auto" first —
  // scrollHeight can only grow past an explicit height, never report that the
  // text now needs LESS room, so without the reset the box would never shrink
  // back after deleting lines.
  const annBodyRef = useRef(null);
  const autoGrow = (el) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  // Runs for typing AND for the async load of an existing announcement, which
  // arrives long after the first render with a body the box has never measured.
  useEffect(() => { autoGrow(annBodyRef.current); }, [annDraft.body]);

  // Formatting toolbar for the announcement body. The modal understands three
  // marks — **bold**, "- " bullets and "1. " numbers — and these buttons write
  // that syntax so nobody has to memorise it.
  //
  // Line marks apply to every line the selection touches, which is what makes
  // "select three lines → bullet" behave the way people expect. An existing
  // mark on a line is stripped first, so pressing bullets on a numbered list
  // converts it instead of producing "- 1. item".
  const applyBodyFormat = (kind) => {
    const el = annBodyRef.current;
    if (!el) return;
    const text = annDraft.body || "";
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? start;
    let next, caret;

    if (kind === "bold") {
      const inner = text.slice(start, end) || "טקסט מודגש";
      next = `${text.slice(0, start)}**${inner}**${text.slice(end)}`;
      caret = start + inner.length + 4;
    } else {
      // Widen the selection to whole lines before prefixing them.
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const nextBreak = text.indexOf("\n", end);
      const lineEnd = nextBreak === -1 ? text.length : nextBreak;
      const block = text.slice(lineStart, lineEnd) || "פריט";
      const out = block.split("\n").map((line, i) => {
        const clean = line.replace(/^\s*(?:[-•*]\s+|\d+[.)]\s+)/, "");
        return kind === "ul" ? `- ${clean}` : `${i + 1}. ${clean}`;
      }).join("\n");
      next = text.slice(0, lineStart) + out + text.slice(lineEnd);
      caret = lineStart + out.length;
    }

    setAnnDraft(p => ({ ...p, body: next }));
    // After React commits the new value: restore focus, drop the caret at the
    // end of what was just written, and re-measure the auto-growing box.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
      autoGrow(el);
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const entries = await Promise.all(
          Object.values(USER_GUIDE_SLOTS).map(async (slot) => [slot, await loadUserGuideAsset(slot)])
        );
        if (cancelled) return;
        setPdfDrafts(Object.fromEntries(entries));
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
        setXlDrafts(Object.fromEntries(entries));
      } catch (err) {
        console.warn("[SystemSettingsPage] load XL templates failed", err);
      }
    })();
    (async () => {
      try {
        const r = await adminGetAnnouncement();
        if (cancelled || !r.ok) return;
        setAnnActive(r.announcement || null);
        setAnnViewers(r.viewers || 0);
        if (r.announcement) {
          const a = r.announcement;
          setAnnDraft({
            title: a.title || "", body: a.body || "",
            audience: a.audience || "all",
            displayDays: a.display_days === 2 ? 2 : 1,
            videoUrl: a.video_url || "", videoTitle: a.video_title || "",
            videoOrientation: a.video_orientation || "landscape",
          });
        }
      } catch (err) {
        console.warn("[SystemSettingsPage] load announcement failed", err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── persistence ──────────────────────────────────────────────────────────
  // Every panel writes ONLY its own keys, one at a time, through setSetting.
  // The page used to have a single "שמור הגדרות" that pushed the whole draft
  // via syncAllSiteSettings — which is what turned one stale key into a
  // page-wide data loss (see the DATA-LOSS GUARD above). With per-key writes,
  // an action can no longer touch a key it never loaded.
  //
  // setSiteSettings is state-only (createTrackedSetter in App), so the local
  // mirror is updated here; App's realtime subscription on site_settings
  // refreshes everyone else within ~400ms.
  const persistKeys = async (panelId, entries) => {
    setBusyPanel(panelId);
    try {
      for (const [key, value] of entries) {
        const r = await setSetting(key, value);
        if (!r.ok) throw new Error(r.error || key);
      }
      const patch = Object.fromEntries(entries);
      setDraft(p => ({ ...p, ...patch }));
      setSiteSettings(p => ({ ...p, ...patch }));
      showToast("success", "נשמר");
      return true;
    } catch (err) {
      console.warn("[SystemSettingsPage.persistKeys]", panelId, err);
      showToast("error", "שגיאה בשמירה — נסה שוב");
      return false;
    } finally {
      setBusyPanel(null);
    }
  };

  // Numeric settings save themselves when the field is done being edited —
  // on blur, or on Enter. No button.
  //
  // onBlur and not onChange: a debounce fires mid-typing (typing "20" would
  // write 2 and then 20), while blur is exactly "I finished with this field".
  // The value is clamped here because the min/max on the input only constrain
  // the spinner arrows — typing 999 straight in is not blocked by the browser.
  // Unchanged values are skipped so tabbing through the page writes nothing.
  const commitNumber = (panelId, key, raw, { min, max, fallback }) => {
    const n = Number(raw);
    const safe = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    if (safe !== n) setDraft(p => ({ ...p, [key]: safe }));       // reflect the clamp
    if (safe === (siteSettings?.[key] ?? fallback)) return;        // nothing to write
    persistKeys(panelId, [[key, safe]]);
  };
  // Enter should commit too; blurring is what actually triggers the save.
  const commitOnEnter = (e) => { if (e.key === "Enter") e.currentTarget.blur(); };

  // ── announcement viewer list ─────────────────────────────────────────────
  const annFmtDate = (d) => {
    if (!d) return "";
    const s = String(d).slice(0, 10).split("-");
    return s.length === 3 ? `${s[2]}/${s[1]}/${s[0]}` : String(d);
  };
  const annFmtDateTime = (ts) => {
    if (!ts) return "";
    try {
      // The DB stamps UTC; the college reads Israel time.
      const d = new Date(ts);
      const date = d.toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", year: "numeric" });
      const time = d.toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" });
      return `${date} ${time}`;
    } catch { return String(ts); }
  };

  const openAnnViewers = async () => {
    setAnnViewersLoading(true);
    setAnnViewerList([]);
    try {
      const r = await adminGetAnnouncementViewers();
      if (!r.ok) { showToast("error", "שגיאה בטעינת רשימת הצופים"); setAnnViewerList(null); return; }
      setAnnViewerList(r.viewers || []);
    } finally { setAnnViewersLoading(false); }
  };

  const annViewerRows = () => (annViewerList || []).map((v, i) => ({
    "#": i + 1,
    "שם": v.name || "",
    "אימייל": v.email || "",
    "מספר צפיות": (v.dates || []).length,
    "תאריכי צפייה": (v.dates || []).map(annFmtDate).join(", "),
    "צפייה אחרונה": annFmtDateTime(v.lastSeen),
  }));

  const exportAnnViewersXlsx = () => {
    const rows = annViewerRows();
    if (!rows.length) { showToast("error", "אין עדיין צפיות לייצוא"); return; }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "צפיות");
    XLSX.writeFile(wb, "צפיות_הודעה.xlsx");
  };

  // Browser-print, exactly like every other PDF in this app (lesson #28): the
  // browser renders real HTML text, which is the only thing that keeps Hebrew
  // and RTL correct. No PDF library — those need embedded fonts and bidi that
  // this repo does not have. Everything interpolated is escaped.
  const exportAnnViewersPdf = () => {
    const rows = annViewerRows();
    if (!rows.length) { showToast("error", "אין עדיין צפיות לייצוא"); return; }
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const cols = ["#", "שם", "אימייל", "מספר צפיות", "תאריכי צפייה", "צפייה אחרונה"];
    const html = `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8">
<title>צפיות בהודעה</title><style>
body{font-family:Arial,"Segoe UI",sans-serif;direction:rtl;padding:24px;color:#111}
h1{font-size:20px;margin:0 0 4px}h2{font-size:13px;font-weight:400;color:#555;margin:0 0 18px}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{border:1px solid #bbb;padding:6px 8px;text-align:right}
th{background:#eee;font-weight:700}
</style></head><body>
<h1>צפיות בהודעה היומית</h1>
<h2>${esc(annDraft.title || "")} — ${rows.length} משתמשים · הופק ${esc(annFmtDateTime(new Date().toISOString()))}</h2>
<table><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
<tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) { showToast("error", "החלון נחסם — אפשרו חלונות קופצים ונסו שוב"); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  // The save control every button-driven panel uses, so the wording, the busy
  // state and the touch target stay identical across the page.
  //
  // A render FUNCTION, not a component defined inside this one: a nested
  // component is a new type on every render, so React unmounts and remounts it
  // each keystroke — which would make the "שומר…" label flicker. Same style as
  // renderVideoPanel below.
  const renderPanelSave = (panelId, onSave, label = "שמור") => (
    <div style={{ display: "flex", justifyContent: "flex-start", marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
      <button type="button" className="btn btn-primary" disabled={busyPanel === panelId} onClick={onSave}
        style={{ fontSize: 14, fontWeight: 800, padding: "10px 24px", minHeight: 38 }}>
        {busyPanel === panelId ? "שומר…" : `💾 ${label}`}
      </button>
    </div>
  );

  // Files persist the moment they are chosen or removed: picking a file in the
  // OS dialog is already a deliberate confirmation, and an upload that silently
  // waits for a second button is an upload people lose.
  const persistAsset = async (panelId, run, onOk) => {
    setBusyPanel(panelId);
    try {
      await run();
      onOk?.();
      showToast("success", "נשמר");
    } catch (err) {
      console.warn("[SystemSettingsPage.persistAsset]", panelId, err);
      showToast("error", "שגיאה בשמירה — נסה שוב");
    } finally {
      setBusyPanel(null);
    }
  };

  const handlePdfUpload = (slot, file) => {
    if (!file) return;
    if (file.type !== "application/pdf") { showToast("error", "רק קבצי PDF נתמכים"); return; }
    if (file.size > PDF_MAX_BYTES) { showToast("error", "הקובץ גדול מדי — עד 5MB"); return; }
    setPdfUploading(p => ({ ...p, [slot]: true }));
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = String(ev.target?.result || "");
      const base64 = dataUrl.split(",")[1] || "";
      setPdfUploading(p => ({ ...p, [slot]: false }));
      await persistAsset(
        `pdf:${slot}`,
        () => upsertUserGuideAsset(slot, { filename: file.name, data_base64: base64 }),
        () => setPdfDrafts(p => ({ ...p, [slot]: { filename: file.name, data_base64: base64 } })),
      );
    };
    reader.onerror = () => { showToast("error", "שגיאה בקריאת הקובץ"); setPdfUploading(p => ({ ...p, [slot]: false })); };
    reader.readAsDataURL(file);
  };

  const removePdf = (slot) => persistAsset(
    `pdf:${slot}`,
    () => deleteUserGuideAsset(slot),
    () => setPdfDrafts(p => ({ ...p, [slot]: null })),
  );

  const handleXlUpload = (slot, file) => {
    if (!file) return;
    const name = (file.name || "").toLowerCase();
    const okExt = name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv") || name.endsWith(".tsv");
    if (!okExt) { showToast("error", "רק קבצי Excel/CSV נתמכים (.xlsx, .xls, .csv, .tsv)"); return; }
    if (file.size > XL_MAX_BYTES) { showToast("error", "הקובץ גדול מדי — עד 2MB"); return; }
    setXlUploading(p => ({ ...p, [slot]: true }));
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = String(ev.target?.result || "");
      const base64 = dataUrl.split(",")[1] || "";
      setXlUploading(p => ({ ...p, [slot]: false }));
      await persistAsset(
        `xl:${slot}`,
        () => upsertXlTemplate(slot, { filename: file.name, data_base64: base64 }),
        () => setXlDrafts(p => ({ ...p, [slot]: { filename: file.name, data_base64: base64 } })),
      );
    };
    reader.onerror = () => { showToast("error", "שגיאה בקריאת הקובץ"); setXlUploading(p => ({ ...p, [slot]: false })); };
    reader.readAsDataURL(file);
  };

  const removeXl = (slot) => persistAsset(
    `xl:${slot}`,
    () => deleteXlTemplate(slot),
    () => setXlDrafts(p => ({ ...p, [slot]: null })),
  );
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

  // Both logos persist on pick / remove, like every other file on this page.
  const handleImageUpload = (e, key, setUploading) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    if (file.size > 500000) { showToast("error", "הקובץ גדול מדי — עד 500KB"); return; }
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      setUploading(false);
      await persistKeys("logo", [[key, ev.target.result]]);
    };
    reader.onerror = () => { showToast("error", "שגיאה בקריאת הקובץ"); setUploading(false); };
    reader.readAsDataURL(file);
  };
  const handleLogoUpload = (e) => handleImageUpload(e, "logo", setLogoUploading);
  const handleSoundLogoUpload = (e) => handleImageUpload(e, "soundLogo", setSoundLogoUploading);

  // Every video already in the system, flattened into one picker and tagged
  // with the library it came from. The announcement audience and the library
  // audience are independent on purpose: a clip filmed for the student guide is
  // often exactly what the staff needs to see too.
  const announcementVideoOptions = [
    { key: "userGuideVideos", tag: "סטודנטים" },
    { key: "staffUserGuideVideos", tag: "צוות" },
    { key: "lecturerUserGuideVideos", tag: "מרצים" },
  ].flatMap(({ key, tag }) =>
    (Array.isArray(draft[key]) ? draft[key] : [])
      .filter(v => v && String(v.url || "").trim())
      .map(v => ({
        value: v.url,
        label: `[${tag}] ${v.title || v.description || v.url}`,
        title: v.title || "",
        orientation: v.orientation === "vertical" ? "vertical" : "landscape",
      }))
  );

  const annPayload = () => ({
    title: annDraft.title, body: annDraft.body,
    audience: annDraft.audience, displayDays: annDraft.displayDays,
    videoUrl: annDraft.videoUrl, videoTitle: annDraft.videoTitle,
    videoOrientation: annDraft.videoOrientation,
  });

  const applyAnnResult = (r) => {
    setAnnActive(r.announcement || null);
    // A fresh row has no views yet; an in-place edit keeps whatever it had.
    if (r.announcement && annActive && r.announcement.id !== annActive.id) setAnnViewers(0);
  };

  const runAnn = async (fn, okMsg) => {
    if (!annDraft.title.trim()) { showToast("error", "צריך כותרת להודעה"); return; }
    setAnnBusy(true);
    try {
      const r = await fn();
      if (!r.ok) { showToast("error", "שגיאה בשמירת ההודעה — נסה שוב"); return; }
      applyAnnResult(r);
      showToast("success", okMsg);
    } finally { setAnnBusy(false); }
  };

  const renderAnnouncementPanel = () => {
    const audienceOpts = ["all", "students", "lecturers", "staff"];
    const chosenVideo = announcementVideoOptions.find(o => o.value === annDraft.videoUrl) || null;
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div className="card-title" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Megaphone size={16} strokeWidth={1.75} color="var(--accent)" /> הודעה יומית למשתמשים
          </div>
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.7 }}>
            הודעה שתקפוץ בחלון צף למשתמש <strong style={{ color: "var(--text)" }}>בכניסה הראשונה שלו באותו יום</strong> — ואז לא תוצג לו שוב.
            מיועדת להודיע על <strong style={{ color: "var(--text)" }}>עדכון גדול באפליקציה</strong> כדי שהמשתמש ידע עליו וילמד אותו בעצמו.
          </div>

          {annActive ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px", borderRadius: 10, background: "rgba(46,204,113,0.08)", border: "1px solid rgba(46,204,113,0.35)", fontSize: 13 }}>
              <span style={{ fontWeight: 900, color: "#2ecc71", fontSize: 14 }}>● ההודעה משודרת כעת</span>
              <span style={{ color: "var(--text2)", lineHeight: 1.6 }}>
                עד כה <strong style={{ color: "var(--text)", fontSize: 15 }}>{annViewers}</strong> משתמשים ראו אותה לפחות פעם אחת
              </span>
              <button type="button" onClick={openAnnViewers} disabled={annViewersLoading}
                style={{ marginInlineStart: "auto", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 36 }}>
                {annViewersLoading ? "טוען…" : "👥 מי צפה?"}
              </button>
            </div>
          ) : (
            <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--surface2)", border: "1px dashed var(--border)", fontSize: 13, color: "var(--text2)" }}>
              אין הודעה פעילה כרגע. מלאו את הפרטים ולחצו על "פרסם כהודעה חדשה".
            </div>
          )}

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 4 }}>כותרת</label>
            <input type="text" value={annDraft.title}
              placeholder="לדוגמה: חדש — אפשר להוסיף פריטים לבקשת השאלה קיימת"
              onChange={e => setAnnDraft(p => ({ ...p, title: e.target.value }))}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 16 }} />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 6 }}>תוכן ההודעה</label>
            <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
              {[
                { kind: "bold", label: "B", title: "הדגשה — עוטף את הטקסט המסומן", style: { fontWeight: 900 } },
                { kind: "ul",   label: "• רשימה", title: "רשימת נקודות — חל על כל השורות המסומנות" },
                { kind: "ol",   label: "1. ממוספר", title: "רשימה ממוספרת — חל על כל השורות המסומנות" },
              ].map(b => (
                <button type="button" key={b.kind} title={b.title}
                  onClick={() => applyBodyFormat(b.kind)}
                  style={{ background: "var(--surface2)", color: "var(--text2)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 34, ...b.style }}>
                  {b.label}
                </button>
              ))}
            </div>
            {/* Grows with the text instead of scrolling inside a fixed box —
                the admin should see the whole notice while writing it, the way
                the reader will. overflow:"hidden" is required, not cosmetic:
                with it left at "auto" the element keeps its own scrollbar and
                scrollHeight stops reporting the full content. resize:"none"
                because a hand-dragged height would fight the auto-fit on the
                very next keystroke. */}
            <textarea ref={annBodyRef} rows={1} value={annDraft.body}
              placeholder={"מה השתנה, ואיפה זה נמצא במסך.\nירידת שורה נשמרת כמו שהיא."}
              onChange={e => { const v = e.target.value; setAnnDraft(p => ({ ...p, body: v })); autoGrow(e.target); }}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 16, fontFamily: "inherit", resize: "none", overflow: "hidden", lineHeight: 1.6, minHeight: 110, display: "block" }} />
            <div style={{ fontSize: 12.5, color: "var(--text2)", marginTop: 6, lineHeight: 1.65 }}>
              עיצוב: <code style={{ background: "var(--surface2)", padding: "1px 5px", borderRadius: 4 }}>**מודגש**</code> ·
              שורה שמתחילה ב-<code style={{ background: "var(--surface2)", padding: "1px 5px", borderRadius: 4 }}>- </code> תהפוך לנקודה ·
              שורה שמתחילה ב-<code style={{ background: "var(--surface2)", padding: "1px 5px", borderRadius: 4 }}>1. </code> תהפוך לרשימה ממוספרת.
              לחצו על <strong>תצוגה מקדימה</strong> כדי לראות את התוצאה.
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 6 }}>למי להציג</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {audienceOpts.map(a => {
                const on = annDraft.audience === a;
                return (
                  <button type="button" key={a} onClick={() => setAnnDraft(p => ({ ...p, audience: a }))}
                    style={{ padding: "9px 16px", borderRadius: 8, border: `2px solid ${on ? "var(--accent)" : "var(--border)"}`, background: on ? "var(--accent-glow)" : "var(--surface)", color: on ? "var(--accent)" : "var(--text2)", fontWeight: on ? 800 : 600, fontSize: 13, cursor: "pointer", minHeight: 38 }}>
                    {AUDIENCE_LABELS[a]}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text2)", marginTop: 6, lineHeight: 1.65 }}>
              מי שרשום בכמה תפקידים (למשל סטודנט שהוא גם איש צוות) יראה הודעה שמכוונת לכל אחד מהתפקידים שלו.
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 6 }}>כמה פעמים להציג</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                { n: 1, label: "פעם אחת", hint: "ביום הראשון בלבד" },
                { n: 2, label: "פעמיים", hint: "בשני ימים שונים" },
              ].map(o => {
                const on = annDraft.displayDays === o.n;
                return (
                  <button type="button" key={o.n} onClick={() => setAnnDraft(p => ({ ...p, displayDays: o.n }))}
                    style={{ padding: "9px 16px", borderRadius: 8, border: `2px solid ${on ? "var(--accent)" : "var(--border)"}`, background: on ? "var(--accent-glow)" : "var(--surface)", color: on ? "var(--accent)" : "var(--text2)", fontWeight: on ? 800 : 600, fontSize: 13, cursor: "pointer", display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 2, minHeight: 38 }}>
                    <span>{o.label}</span>
                    <span style={{ fontSize: 10, fontWeight: 500, color: on ? "var(--accent)" : "var(--text3)" }}>{o.hint}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text2)", marginTop: 6, lineHeight: 1.65 }}>
              בכל מקרה ההודעה מוצגת <strong>פעם אחת ביום לכל היותר</strong>. "פעמיים" = פעם ביום הראשון שהמשתמש נכנס, ופעם נוספת ביום הבא שהוא נכנס.
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 4 }}>סרטון מצורף (אופציונלי)</label>
            <select
              value={annDraft.videoUrl}
              onChange={e => {
                const url = e.target.value;
                const opt = announcementVideoOptions.find(o => o.value === url);
                // Snapshot the video into the announcement: editing or deleting
                // it in the library afterwards must not break a published notice.
                setAnnDraft(p => ({ ...p, videoUrl: url, videoTitle: opt?.title || "", videoOrientation: opt?.orientation || "landscape" }));
              }}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 16 }}>
              <option value="">— ללא סרטון —</option>
              {announcementVideoOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <div style={{ fontSize: 12.5, color: "var(--text2)", marginTop: 6, lineHeight: 1.65 }}>
              {announcementVideoOptions.length === 0
                ? "אין עדיין סרטונים במערכת — הוסיפו סרטון באחד מפאנלי \"המדריך למשתמש\" למטה."
                : `מתוך מאגר הסרטונים הקיים (${announcementVideoOptions.length} סרטונים). הסרטון נשמר בתוך ההודעה, כך ששינוי במאגר לא ישבור אותה.`}
              {chosenVideo && <> · פורמט: <strong>{chosenVideo.orientation === "vertical" ? "📱 אנכי" : "🖥️ אופקי"}</strong></>}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 6, borderTop: "1px solid var(--border)" }}>
            <button type="button" className="btn btn-secondary" disabled={!annDraft.title.trim()}
              onClick={() => setAnnPreview({
                id: "preview", title: annDraft.title, body: annDraft.body,
                videoUrl: annDraft.videoUrl, videoTitle: annDraft.videoTitle,
                videoOrientation: annDraft.videoOrientation,
              })}
              style={{ fontSize: 13, minHeight: 40 }}>
              👁 תצוגה מקדימה
            </button>

            {annActive && (
              <button type="button" className="btn btn-secondary" disabled={annBusy}
                onClick={() => runAnn(() => adminSaveAnnouncement(annPayload()), "ההודעה עודכנה")}
                style={{ fontSize: 13, minHeight: 40 }}>
                💾 שמור שינויים
              </button>
            )}

            <button type="button" className="btn btn-primary" disabled={annBusy}
              onClick={() => {
                if (annActive && !window.confirm("לפרסם כהודעה חדשה?\n\nכל מי שכבר ראה את ההודעה הנוכחית יראה את החדשה מחדש. לתיקון טעות כתיב בלבד השתמשו ב\"שמור שינויים\".")) return;
                runAnn(() => adminPublishAnnouncement(annPayload()), "ההודעה פורסמה");
              }}
              style={{ fontSize: 13, fontWeight: 800, minHeight: 40 }}>
              📣 פרסם כהודעה חדשה
            </button>

            {annActive && (
              <button type="button" className="btn btn-secondary" disabled={annBusy}
                onClick={async () => {
                  if (!window.confirm("להפסיק להציג את ההודעה למשתמשים?")) return;
                  setAnnBusy(true);
                  try {
                    const r = await adminDeactivateAnnouncement();
                    if (!r.ok) { showToast("error", "שגיאה — נסה שוב"); return; }
                    setAnnActive(null); setAnnViewers(0);
                    showToast("success", "ההודעה הופסקה");
                  } finally { setAnnBusy(false); }
                }}
                style={{ fontSize: 13, minHeight: 40, color: "#e74c3c", borderColor: "rgba(231,76,60,0.4)" }}>
                ⏹ הפסק להציג
              </button>
            )}
          </div>

          {/* Three buttons that look similar and do very different things —
              one is reversible, one resets everyone's counter, one cannot be
              undone. The difference belongs next to them, in a box people
              actually read, colour-matched to the button it describes. */}
          <div style={{
            display: "flex", flexDirection: "column", gap: 8,
            fontSize: 13, lineHeight: 1.7, color: "var(--text2)",
            background: "var(--surface2)", border: "1px solid var(--border)",
            borderRadius: 10, padding: "12px 14px",
          }}>
            <div>
              <strong style={{ color: "var(--text)", fontWeight: 900 }}>💾 שמור שינויים</strong>
              {" — מתקן את ההודעה הפעילה "}
              <strong style={{ color: "var(--text)" }}>בלי</strong>
              {" להציג אותה שוב למי שכבר ראה. לתיקוני נוסח."}
            </div>
            <div>
              <strong style={{ color: "var(--accent)", fontWeight: 900 }}>📣 פרסם כהודעה חדשה</strong>
              {" — מאפס את הצפיות. "}
              <strong style={{ color: "var(--accent)" }}>כל</strong>
              {" מי שבקהל היעד יראה אותה מחדש, כולל מי שכבר ראה."}
            </div>
            <div>
              <strong style={{ color: "#e74c3c", fontWeight: 900 }}>⏹ הפסק להציג</strong>
              {" — עוצר את ההצגה לכולם מיידית, גם למי שטרם ראה. "}
              <strong style={{ color: "#e74c3c" }}>פעולה חד-כיוונית</strong>
              {" — אין המשך שידור, רק פרסום מחדש (שמאפס את הצפיות)."}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Renders one audience-specific video-management panel (students / staff /
  // lecturers). Each panel reads + writes its own JSON array on `draft` so
  // the three lists stay independent. `pdfSlot` (optional) adds a PDF upload
  // section at the bottom for "הוראות הפעלה" for that audience.
  const renderVideoPanel = ({ draftKey, title, description, pdfSlot }) => {
    const list = draft[draftKey] || [];
    const setList = (updater) => setDraft(p => ({ ...p, [draftKey]: updater(p[draftKey] || []) }));
    // Persist THIS panel's list only. The list is computed from the current
    // draft rather than read back after setDraft, because setDraft is async and
    // would otherwise save the pre-change value.
    const saveList = (nextList) => persistKeys(`videos:${draftKey}`, [[draftKey, nextList ?? list]]);
    // Removing a video writes straight away — a delete that waits for another
    // button reads as "already gone" and is easy to leave unsaved.
    const removeVideo = (id) => {
      const next = list.filter(x => x.id !== id);
      closeVideo(id);
      saveList(next);
    };
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
                      onClick={e => { e.stopPropagation(); removeVideo(v.id); }}
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
                      onClick={e => { e.stopPropagation(); removeVideo(v.id); }}
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
                  {/* This button used to only collapse the row — the actual
                      write happened at the page-wide "שמור הגדרות". Now it is
                      the save for this list. */}
                  <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
                    <button type="button" className="btn btn-primary"
                      disabled={busyPanel === `videos:${draftKey}`}
                      onClick={async () => { const ok = await saveList(); if (ok) closeVideo(v.id); }}
                      style={{ fontSize: 14, padding: "10px 20px", minHeight: 38, display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Save size={14} strokeWidth={1.75} /> {busyPanel === `videos:${draftKey}` ? "שומר…" : "שמור וסגור"}
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
          {/* Button, not immediate: input[type=color] fires on every mouse move
              while the picker is open — writing per pixel would hammer the DB. */}
          {renderPanelSave("accent", () => persistKeys("accent", [["accentColor", draft.accentColor || "#f5a623"]]))}
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
              onChange={e => setDraft(p => ({ ...p, publicDisplayInterval: e.target.value }))}
              onBlur={e => commitNumber("display", "publicDisplayInterval", e.target.value, { min: 5, max: 300, fallback: 18 })}
              onKeyDown={commitOnEnter}
              disabled={busyPanel === "display"}
              style={{ width: 90, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 16, textAlign: "center" }}
            />
            <span style={{ fontSize: 12, color: "var(--text3)" }}>ברירת מחדל: 18 שניות · נשמר אוטומטית</span>
          </div>
        </div>
      </div>

      {renderAnnouncementPanel()}
      {/* Viewer list — a floating panel so it can be opened, scanned and closed
          without losing the admin's place in a long settings page. */}
      {annViewerList !== null && (
        <div className="modal-overlay" style={{ zIndex: 5300, direction: "rtl" }}
          onClick={e => e.target === e.currentTarget && setAnnViewerList(null)}>
          <div className="modal" style={{ maxWidth: 780, width: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column" }}>
            <div className="modal-header">
              <span className="modal-title">👥 מי צפה בהודעה</span>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setAnnViewerList(null)} aria-label="סגור">✕</button>
            </div>
            <div className="modal-body" style={{ overflowY: "auto" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
                <span style={{ fontSize: 13, color: "var(--text2)" }}>
                  <strong style={{ color: "var(--text)" }}>{annViewerList.length}</strong> משתמשים
                </span>
                <button type="button" className="btn btn-secondary" onClick={exportAnnViewersXlsx}
                  style={{ fontSize: 13, minHeight: 36, marginInlineStart: "auto" }}>📊 ייצוא Excel</button>
                <button type="button" className="btn btn-secondary" onClick={exportAnnViewersPdf}
                  style={{ fontSize: 13, minHeight: 36 }}>🖨️ ייצוא PDF</button>
              </div>

              {annViewerList.length === 0 ? (
                <div style={{ textAlign: "center", color: "var(--text3)", fontSize: 14, padding: "30px 0" }}>
                  עדיין אף אחד לא ראה את ההודעה.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr>
                        {["#", "שם", "אימייל", "צפיות", "תאריכי צפייה", "צפייה אחרונה"].map(h => (
                          <th key={h} style={{ textAlign: "right", padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text2)", fontWeight: 800, whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {annViewerList.map((v, i) => (
                        <tr key={v.userId || i}>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text3)" }}>{i + 1}</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text)", fontWeight: 700 }}>{v.name}</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text2)", direction: "ltr", textAlign: "right" }}>{v.email}</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text2)", textAlign: "center" }}>{(v.dates || []).length}</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text2)", whiteSpace: "nowrap" }}>{(v.dates || []).map(annFmtDate).join(", ")}</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text3)", whiteSpace: "nowrap" }}>{annFmtDateTime(v.lastSeen)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Preview renders the very same component the users get — the only way
          to be sure what was written is what will be seen. */}
      {annPreview && <DailyAnnouncementModal preview={annPreview} onClosePreview={() => setAnnPreview(null)} />}

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
              onChange={e => setDraft(p => ({ ...p, aiMaxRequests: e.target.value }))}
              onBlur={e => commitNumber("ai", "aiMaxRequests", e.target.value, { min: 1, max: 50, fallback: 5 })}
              onKeyDown={commitOnEnter}
              disabled={busyPanel === "ai"}
              style={{ width: 90, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 16, textAlign: "center" }}
            />
            <span style={{ fontSize: 12, color: "var(--text3)" }}>נשמר אוטומטית</span>
          </div>
        </div>
      </div>
    </div>
  );
}
