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
import { X, Megaphone, Play } from "lucide-react";
import { supabase } from "../supabaseClient.js";
import { videoEmbedSrc, videoThumbnailSrc } from "../utils.js";
import { fetchMyAnnouncement, markAnnouncementSeen } from "../utils/announcementsApi.js";

// Long enough for the loading screen and the post-login routing to settle, so
// the notice lands on the page the user actually arrived at rather than
// flashing over a transition.
const SETTLE_MS = 1200;

// ─── body formatting ───────────────────────────────────────────────────────
// A deliberately tiny formatter — three things, not markdown:
//   **מודגש**   → bold
//   "- פריט"    → bullet list
//   "1. פריט"   → numbered list
//
// Rendered as React elements, never dangerouslySetInnerHTML. The text is
// admin-authored, but it is displayed to every user in the college, so a
// pasted <script> would be everyone's problem — React escaping keeps that
// impossible by construction.

// Splits one line into plain text and **bold** runs.
function renderInline(text, keyPrefix) {
  return String(text)
    .split(/(\*\*[^*\n]+\*\*)/g)
    .filter(Boolean)
    .map((part, i) =>
      part.length > 4 && part.startsWith("**") && part.endsWith("**")
        ? <strong key={`${keyPrefix}b${i}`} style={{ fontWeight: 900, color: "var(--text)" }}>{part.slice(2, -2)}</strong>
        : <span key={`${keyPrefix}t${i}`}>{part}</span>
    );
}

// Groups consecutive list lines into a single <ul>/<ol>; everything else stays
// a paragraph. A blank line becomes vertical space rather than an empty <div>,
// so spacing the admin typed survives.
function parseBlocks(body) {
  const blocks = [];
  let list = null;
  const flush = () => { if (list) { blocks.push(list); list = null; } };

  for (const raw of String(body || "").split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet) {
      if (list?.type !== "ul") { flush(); list = { type: "ul", items: [] }; }
      list.items.push(bullet[1]);
    } else if (numbered) {
      if (list?.type !== "ol") { flush(); list = { type: "ol", items: [] }; }
      list.items.push(numbered[1]);
    } else {
      flush();
      blocks.push({ type: "p", text: line });
    }
  }
  flush();
  return blocks;
}

function AnnouncementBody({ body }) {
  const blocks = parseBlocks(body);
  // paddingInlineStart, not paddingLeft — in RTL the markers belong on the right.
  const listStyle = { margin: "2px 0", paddingInlineStart: 24 };
  return (
    <div style={{ fontSize: 16, lineHeight: 1.85, color: "var(--text)", fontWeight: 500, overflowWrap: "break-word" }}>
      {blocks.map((b, i) => {
        if (b.type === "ul") {
          return (
            <ul key={i} style={{ ...listStyle, listStyleType: "disc" }}>
              {b.items.map((it, j) => <li key={j} style={{ marginBottom: 4 }}>{renderInline(it, `${i}-${j}-`)}</li>)}
            </ul>
          );
        }
        if (b.type === "ol") {
          return (
            <ol key={i} style={{ ...listStyle, listStyleType: "decimal" }}>
              {b.items.map((it, j) => <li key={j} style={{ marginBottom: 4 }}>{renderInline(it, `${i}-${j}-`)}</li>)}
            </ol>
          );
        }
        if (!b.text) return <div key={i} style={{ height: 10 }} />;
        return <div key={i}>{renderInline(b.text, `${i}-`)}</div>;
      })}
    </div>
  );
}

export function DailyAnnouncementModal({ preview = null, onClosePreview = null }) {
  const [item, setItem] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  // No iframe is ever mounted inside the notice (see the video panel), so the
  // only state the poster needs is whether its thumbnail actually loaded.
  const [thumbFailed, setThumbFailed] = useState(false);
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
    // Escape closes the video overlay first, the notice only once no video is
    // open — otherwise one press would dismiss a notice the user is watching.
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (fullscreen) setFullscreen(false);
      else close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, fullscreen]);

  if (!shown) return null;

  const src = videoEmbedSrc(shown.videoUrl);
  const thumb = videoThumbnailSrc(shown.videoUrl);
  // Shapes the poster and the nothing-else: no clip plays inside the notice in
  // either orientation, so this only decides how the still frame is framed.
  const isVertical = shown.videoOrientation === "vertical";

  // Where this viewer can find the guide videos again after closing the notice.
  // The three audiences keep their libraries in three different places, so the
  // note names the actual button rather than saying a vague "in the app".
  // Derived from the pathname, which is exactly right: it describes the surface
  // the user is standing on right now — a multi-role user browsing the student
  // side should be pointed at the student side.
  const guideLocation = (() => {
    const path = typeof window !== "undefined" ? window.location.pathname : "/";
    if (path.startsWith("/admin")) return 'ב-Staff Hub, בלחצן "המדריך למשתמש"';
    if (path.startsWith("/lecturer")) return 'בפורטל המרצה, בלחצן "המדריך למשתמש"';
    return 'במערכת הפניות — "מידע כללי" ← לשונית "מדריך"';
  })();

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
          <span className="modal-title" style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0, color: "var(--accent)" }}>
            <Megaphone size={18} strokeWidth={1.9} color="var(--accent)" style={{ flexShrink: 0 }} />
            <span style={{ overflowWrap: "break-word", lineHeight: 1.4 }}>{shown.title || "עדכון מערכת"}</span>
          </span>
          <button className="btn btn-secondary btn-sm btn-icon" onClick={close} aria-label="סגור">
            <X size={16} strokeWidth={1.75} color="var(--text3)" />
          </button>
        </div>

        <div className="modal-body" style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* The body is the whole point of the notice, so it is set as primary
              text, not as the muted secondary tone used for hints elsewhere in
              the app — on a dark background var(--text2) reads as "fine print"
              and people skim past it. */}
          {shown.body && <AnnouncementBody body={shown.body} />}

          {src && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {/* Sits above the player as its heading, so it is set a step
                  larger than the body rather than as a caption. */}
              {shown.videoTitle && (
                <div style={{ fontSize: 17, fontWeight: 800, color: "var(--accent)", lineHeight: 1.4, overflowWrap: "break-word" }}>
                  ▶ {shown.videoTitle}
                </div>
              )}
              {/* NO INLINE PLAYER, either orientation. Google Drive's toolbar
                  is a FIXED height inside its own cross-origin frame, so in the
                  narrow column of a notice it takes a share of the box that the
                  clip needed, and the video came out cut. Several attempts to
                  pad around it failed, and a full-width box made it worse — Drive
                  also sizes its CONTROLS to the frame width, so play/skip/volume/
                  CC/settings sprawled across the screen.

                  So the notice only ever shows a poster, and the player gets the
                  whole screen where none of that applies. Same shape as
                  UserGuideVideosModal and PublicForm's guide panel, which never
                  render an iframe inline either. Nothing here can be cropped,
                  because nothing here is a player.

                  The box keeps the video's own shape so the poster reads right;
                  the image is `contain`, so even a mismatch cannot crop it. */}
              <button
                type="button"
                onClick={() => setFullscreen(true)}
                aria-label={`נגן את הסרטון${shown.videoTitle ? `: ${shown.videoTitle}` : ""}`}
                style={{
                  position: "relative",
                  background: thumb && !thumbFailed ? "#000" : "linear-gradient(160deg, #141922, #05070a)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  overflow: "hidden",
                  padding: 0,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  ...(isVertical
                    ? { alignSelf: "center", width: "min(100%, 46vh)", aspectRatio: "9 / 16", maxHeight: "58vh" }
                    : { width: "100%", aspectRatio: "16 / 9" }),
                }}
              >
                {thumb && !thumbFailed && (
                  <img
                    src={thumb}
                    alt=""
                    onError={() => setThumbFailed(true)}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
                  />
                )}
                <span
                  style={{
                    position: "relative",
                    width: 64, height: 64, borderRadius: "50%", background: "var(--accent)",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 6px 20px rgba(0,0,0,0.55)",
                  }}
                >
                  {/* Nudged off-centre because a triangle's optical centre sits
                      left of its bounding box. */}
                  <Play size={27} strokeWidth={2} color="#0a0c10" fill="#0a0c10" style={{ marginInlineStart: 4 }} />
                </span>
                {/* Says what the tap will do, so opening fullscreen never feels
                    like the notice was closed by accident. */}
                <span
                  style={{
                    position: "absolute", insetInline: 0, bottom: 10,
                    fontSize: 12.5, fontWeight: 700, color: "#fff",
                    textShadow: "0 1px 6px rgba(0,0,0,0.9)",
                  }}
                >
                  נפתח במסך מלא
                </span>
              </button>
              {/* Standing footnote on every announcement that carries a video —
                  not something the admin writes. The notice is shown once and
                  then gone, so without this the video looks like a one-time
                  thing; it is really the same clip that lives in the user's
                  guide library, and they should know where to find it again. */}
              <div style={{ fontSize: 13.5, color: "var(--text2)", lineHeight: 1.7, marginTop: 4 }}>
                💡 הסרטון זמין לצפייה חוזרת בכל עת גם באפליקציה — {guideLocation}.
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

      {/* Fullscreen video overlay — same pattern as UserGuideVideosModal and
          PublicForm's guide panel. zIndex 6000 was already reserved for it by
          this modal's own 5400 (see the overlay comment above), so a playing
          video is never buried by the notice it came from. Closing it returns
          to the notice rather than dismissing it: the view is already recorded
          on show, but the user still has a body to finish reading. */}
      {fullscreen && src && (
        <div
          onClick={(e) => e.target === e.currentTarget && setFullscreen(false)}
          style={{ position: "fixed", inset: 0, background: "#000", zIndex: 6000, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <button
            type="button"
            onClick={() => setFullscreen(false)}
            aria-label="סגור"
            style={{
              position: "fixed",
              top: "max(16px, env(safe-area-inset-top))",
              left: "max(16px, env(safe-area-inset-left))",
              zIndex: 6010,
              background: "var(--accent)",
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
          {/* The frame takes the WHOLE viewport — no aspect-ratio box.
              Forcing one is what cropped the video: a 16:9 box on a portrait
              phone is only about a fifth of the screen tall, and Drive's fixed
              toolbar then eats a quarter of THAT, so the clip lost its bottom.
              Given the full screen, both players letterbox the video themselves
              and centre it — which is what they are built to do and what a
              fullscreen viewer should look like. Nothing is constrained, so
              nothing can be cut, in either orientation. */}
          <div style={{ position: "absolute", inset: 0, background: "#000" }}>
            <iframe
              src={src}
              title={shown.videoTitle || shown.title || "announcement video"}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{ width: "100%", height: "100%", border: 0, display: "block" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default DailyAnnouncementModal;
