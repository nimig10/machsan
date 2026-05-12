// UserGuideVideosModal.jsx — reusable "המדריך למשתמש" modal.
// Same UX as the student-facing InfoPanel userGuide tab (PublicForm.jsx
// ~lines 1384–1435 + 1549–1607): list of cards → "צפה במדריך" button →
// fullscreen iframe overlay that respects per-video orientation
// (landscape 16:9 vs vertical 9:16).
//
// videoEmbedSrc and the overlay markup are duplicated here on purpose —
// PublicForm.jsx has its own copy that the student panel still uses, and
// refactoring the public flow to import from here would be out of scope.
import { useEffect, useRef, useState } from "react";
import { BookOpen, X } from "lucide-react";

function videoEmbedSrc(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) return null;
  let m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  m = url.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/);
  if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
  return null;
}

export function UserGuideVideosModal({ open, onClose, title = "המדריך למשתמש", videos = [], accentColor }) {
  const [activeVideo, setActiveVideo] = useState(null);
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!open && !activeVideo) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (activeVideo) setActiveVideo(null);
      else if (open) onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, activeVideo, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="modal-overlay"
        onClick={(e) => e.target === e.currentTarget && onClose?.()}
        style={{ zIndex: 5500 }}
      >
        <div className="modal" style={{ maxWidth: 720, width: "100%" }}>
          <div className="modal-header">
            <span className="modal-title" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <BookOpen size={16} strokeWidth={1.75} color="var(--accent)" /> {title}
            </span>
            <button className="btn btn-secondary btn-sm btn-icon" onClick={onClose}>
              <X size={16} strokeWidth={1.75} color="var(--text3)" />
            </button>
          </div>
          <div className="modal-body" style={{ direction: "rtl", maxHeight: "70vh", overflowY: "auto" }}>
            {(videos || []).length === 0 ? (
              <div style={{ textAlign: "center", color: "var(--text3)", fontSize: 14, padding: "40px 0", lineHeight: 1.6 }}>
                <BookOpen size={36} strokeWidth={1.5} color="var(--text3)" style={{ marginBottom: 10 }} />
                <div>המדריך למשתמש בהכנה — חזרו בקרוב.</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {(videos || []).map((v, idx) => {
                  const src = videoEmbedSrc(v.url);
                  return (
                    <div key={v.id || idx} style={{ background: "var(--surface2)", borderRadius: "var(--r)", border: "1px solid var(--border)", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <BookOpen size={18} strokeWidth={2} />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", letterSpacing: 0.3 }}>סרטון {idx + 1}</div>
                          <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text)", lineHeight: 1.3, wordBreak: "break-word" }}>
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
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fullscreen video overlay — same pattern as PublicForm */}
      {activeVideo && (
        <div
          ref={overlayRef}
          onClick={(e) => { if (e.target === e.currentTarget) setActiveVideo(null); }}
          style={{
            position: "fixed", inset: 0, background: "#000",
            zIndex: 6000, display: "flex", alignItems: "center", justifyContent: "center",
            padding: 0,
          }}
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
    </>
  );
}

export default UserGuideVideosModal;
