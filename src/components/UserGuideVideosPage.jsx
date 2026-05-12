// UserGuideVideosPage.jsx — full-page guide viewer for Staff Hub.
// Unlike UserGuideVideosModal (used by LecturerPortal), this renders as a
// regular in-app page with a "back to Staff Hub" header at the top and the
// video cards laid out one under the other.
import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronRight, FileText, X } from "lucide-react";

function downloadPdfFromBase64(base64, filename) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename || "user-guide.pdf"; a.click();
  URL.revokeObjectURL(url);
}

function videoEmbedSrc(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) return null;
  let m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  m = url.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/);
  if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
  return null;
}

export function UserGuideVideosPage({ title = "המדריך למשתמש", videos = [], onBack, accentColor, pdfAsset = null, pdfButtonLabel = "הוראות הפעלה" }) {
  const [activeVideo, setActiveVideo] = useState(null);
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!activeVideo) return;
    const onKey = (e) => { if (e.key === "Escape") setActiveVideo(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [activeVideo]);

  return (
    <div className="page" style={{ direction: "rtl" }}>
      {/* Page header — back link + title */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--accent)", color: "#0a0c10", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <BookOpen size={20} strokeWidth={2} />
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "var(--text)" }}>{title}</h1>
        </div>
        {typeof onBack === "function" && (
          <button
            type="button"
            onClick={onBack}
            className="btn btn-secondary"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700 }}
          >
            <ChevronRight size={16} strokeWidth={1.75} /> חזרה ל-Staff Hub
          </button>
        )}
      </div>

      {/* Video cards */}
      {(videos || []).length === 0 && !pdfAsset ? (
        <div style={{ textAlign: "center", color: "var(--text3)", fontSize: 14, padding: "60px 0", lineHeight: 1.6, background: "var(--surface)", borderRadius: "var(--r)", border: "1px solid var(--border)" }}>
          <BookOpen size={48} strokeWidth={1.5} color="var(--text3)" style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text2)" }}>המדריך למשתמש בהכנה</div>
          <div style={{ marginTop: 6, fontSize: 13 }}>אדמין יעלה סרטונים בקרוב דרך "הגדרות מערכת".</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {(videos || []).map((v, idx) => {
            const src = videoEmbedSrc(v.url);
            return (
              <div key={v.id || idx} style={{ background: "var(--surface)", borderRadius: "var(--r)", border: "1px solid var(--border)", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <BookOpen size={18} strokeWidth={2} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", letterSpacing: 0.3 }}>סרטון {idx + 1}</div>
                    <div style={{ fontSize: 17, fontWeight: 900, color: "var(--text)", lineHeight: 1.3, wordBreak: "break-word" }}>
                      {v.title || "ללא כותרת"}
                    </div>
                  </div>
                </div>
                {v.description && (
                  <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text2)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                    {v.description}
                  </div>
                )}
                {src ? (
                  <button
                    type="button"
                    onClick={() => setActiveVideo({ ...v, src })}
                    className="btn btn-primary"
                    style={{ alignSelf: "flex-start", fontSize: 14, padding: "10px 18px", display: "inline-flex", alignItems: "center", gap: 8 }}
                  >
                    <span style={{ fontSize: 16, lineHeight: 1 }}>▶</span> צפה במדריך
                  </button>
                ) : (v.url && v.url.trim()) ? (
                  <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(231,76,60,0.08)", border: "1px solid rgba(231,76,60,0.25)", color: "var(--text3)", fontSize: 13, lineHeight: 1.6 }}>
                    לא ניתן להציג סרטון מהמקור הזה. נתמכים רק קישורי YouTube ו-Google Drive.
                  </div>
                ) : null}
              </div>
            );
          })}
          {pdfAsset && pdfAsset.data_base64 && (
            <button
              type="button"
              onClick={() => downloadPdfFromBase64(pdfAsset.data_base64, pdfAsset.filename)}
              style={{
                alignSelf: "flex-start",
                marginTop: 8,
                background: accentColor || "var(--accent)",
                color: "#0a0c10",
                border: "none",
                borderRadius: 10,
                padding: "12px 22px",
                fontWeight: 900,
                fontSize: 14,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <FileText size={16} strokeWidth={2} /> ⬇ {pdfButtonLabel}
            </button>
          )}
        </div>
      )}

      {/* Fullscreen video player — same pattern as PublicForm + Modal version */}
      {activeVideo && (
        <div
          ref={overlayRef}
          onClick={(e) => { if (e.target === e.currentTarget) setActiveVideo(null); }}
          style={{ position: "fixed", inset: 0, background: "#000", zIndex: 6000, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
        >
          <button
            type="button"
            onClick={() => setActiveVideo(null)}
            aria-label="סגור"
            style={{
              position: "fixed",
              top: "max(16px, env(safe-area-inset-top))",
              left: "max(16px, env(safe-area-inset-left))",
              zIndex: 6010,
              background: accentColor || "#f5a623",
              color: "#0a0c10",
              border: "2px solid #fff",
              boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
              borderRadius: 999,
              padding: "10px 18px",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              fontSize: 15,
              fontWeight: 900,
              lineHeight: 1,
              fontFamily: "inherit",
            }}
          >
            <X size={20} strokeWidth={2.5} color="#0a0c10" />
            <span>סגור</span>
          </button>
          {(() => {
            const isVertical = activeVideo.orientation === "vertical";
            const wrapStyle = isVertical
              ? { height: "100vh", aspectRatio: "9 / 16", maxWidth: "100vw" }
              : { width: "100vw", aspectRatio: "16 / 9", maxHeight: "100vh" };
            return (
              <div style={{ ...wrapStyle, background: "#000", position: "relative" }}>
                <iframe
                  src={activeVideo.src}
                  title={activeVideo.description || activeVideo.title || "user guide video"}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                />
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

export default UserGuideVideosPage;
