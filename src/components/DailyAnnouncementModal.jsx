// DailyAnnouncementModal.jsx — the floating notice a user gets on their first
// entry of the day when the admin has published an announcement.
//
// Self-contained on purpose: it watches the Supabase session itself instead of
// being handed an identity. App.jsx is the single root for every surface
// (student form, lecturer portal, staff shell), but the logged-in user lives in
// a different place on each one — PublicForm holds the student, LecturerPortal
// holds the lecturer, App holds staff. The session is the one thing they share.
//
// No session ⇒ nothing happens, so the login screen never gets a popup.
//
// Every decision about WHO sees WHAT is made server-side in /api/announcement
// from the caller's JWT. This component only renders what it is handed.
import { useEffect, useRef, useState } from "react";
import { X, Megaphone } from "lucide-react";
import { supabase } from "../supabaseClient.js";
import { videoEmbedSrc } from "../utils.js";
import { fetchMyAnnouncement, markAnnouncementSeen } from "../utils/announcementsApi.js";

// Long enough for the loading screen and the post-login routing to settle, so
// the notice lands on the page the user actually arrived at rather than
// flashing over a transition.
const SETTLE_MS = 1200;

export function DailyAnnouncementModal({ preview = null, onClosePreview = null }) {
  const [item, setItem] = useState(null);
  // Guards against a double fetch when getSession and onAuthStateChange both
  // fire for the same login.
  const loadedForRef = useRef(null);

  const isPreview = !!preview;

  useEffect(() => {
    if (isPreview) return undefined;
    let cancelled = false;
    let timer = null;

    const load = async (session) => {
      const uid = session?.user?.id;
      if (!uid) return;
      if (loadedForRef.current === uid) return;
      loadedForRef.current = uid;
      timer = setTimeout(async () => {
        const found = await fetchMyAnnouncement();
        if (cancelled || !found) return;
        setItem(found);
        // Recorded on SHOW, not on dismiss: closing the tab or refreshing must
        // not hand the same person the same notice again.
        markAnnouncementSeen(found.id);
      }, SETTLE_MS);
    };

    supabase.auth.getSession().then(({ data }) => load(data?.session)).catch(() => {});
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session?.user?.id) { loadedForRef.current = null; setItem(null); return; }
      load(session);
    });

    return () => { cancelled = true; if (timer) clearTimeout(timer); subscription?.unsubscribe?.(); };
  }, [isPreview]);

  const shown = isPreview ? preview : item;
  const close = () => (isPreview ? onClosePreview?.() : setItem(null));

  useEffect(() => {
    if (!shown) return undefined;
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  if (!shown) return null;

  const src = videoEmbedSrc(shown.videoUrl);
  const isVertical = shown.videoOrientation === "vertical";

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && close()}
      // Above the app but below UserGuideVideosModal's fullscreen video overlay
      // (6000) so nothing can bury a playing video.
      style={{ zIndex: 5400, direction: "rtl", padding: "max(12px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom))" }}
    >
      <div
        className="modal"
        style={{ maxWidth: 560, width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
      >
        <div className="modal-header">
          <span className="modal-title" style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <Megaphone size={18} strokeWidth={1.9} color="var(--accent)" style={{ flexShrink: 0 }} />
            <span style={{ overflowWrap: "anywhere" }}>{shown.title || "עדכון מערכת"}</span>
          </span>
          <button className="btn btn-secondary btn-sm btn-icon" onClick={close} aria-label="סגור">
            <X size={16} strokeWidth={1.75} color="var(--text3)" />
          </button>
        </div>

        <div className="modal-body" style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {shown.body && (
            <div style={{ fontSize: 14, lineHeight: 1.75, color: "var(--text2)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {shown.body}
            </div>
          )}

          {src && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {shown.videoTitle && (
                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--accent)" }}>▶ {shown.videoTitle}</div>
              )}
              {/* Vertical clips are capped by height so a 9:16 video cannot
                  push the buttons off a phone screen; landscape fills the width. */}
              <div
                style={{
                  position: "relative",
                  background: "#000",
                  borderRadius: 10,
                  overflow: "hidden",
                  alignSelf: isVertical ? "center" : "stretch",
                  width: isVertical ? "min(100%, 46vh)" : "100%",
                  aspectRatio: isVertical ? "9 / 16" : "16 / 9",
                  maxHeight: isVertical ? "58vh" : undefined,
                }}
              >
                <iframe
                  src={src}
                  title={shown.videoTitle || shown.title || "announcement video"}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                />
              </div>
            </div>
          )}

          {!src && shown.videoUrl && (
            <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(231,76,60,0.08)", border: "1px solid rgba(231,76,60,0.25)", color: "var(--text3)", fontSize: 13, lineHeight: 1.6 }}>
              לא ניתן להציג את הסרטון מהמקור הזה. נתמכים רק קישורי YouTube ו-Google Drive.
            </div>
          )}
        </div>

        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-start" }}>
          <button
            className="btn btn-primary"
            onClick={close}
            // Comfortable phone target; the notice is dismissed by hand, never
            // on a timer.
            style={{ fontSize: 14, fontWeight: 800, padding: "11px 22px", minHeight: 40 }}
          >
            הבנתי, תודה
          </button>
        </div>
      </div>
    </div>
  );
}

export default DailyAnnouncementModal;
