// ui.jsx — shared UI primitives: Toast, Modal, Loading, statusBadge,
// WhatsAppLinkButton
import { useState, useRef, useEffect } from "react";
import { CheckCircle, Info, Phone, X, XCircle } from "lucide-react";
import lottie from "lottie-web";
import loadingData from "../assets/loading-logo2.json";
import { normalizeReservationStatus } from "../utils.js";

// The green "open WhatsApp" affordance, in one place.
//
// A plain anchor and NOT window.open: WhatsApp routes itself to web / desktop /
// mobile depending on the platform, and opening it programmatically breaks that
// hand-off (and trips popup blockers on iOS).
//
// `href` comes from one of the buildReservation*WhatsAppLink helpers, which
// return "" when the student has no usable phone. That is a normal outcome —
// most production loans never collected one — so an empty href renders the
// explanatory grey text instead of a link that goes nowhere.
export function WhatsAppLinkButton({ href, label = "שלח בוואטסאפ", title, emptyText = "אין טלפון — לא ניתן לשלוח וואטסאפ" }) {
  if (!href) return <span style={{fontSize:12,color:"var(--text3)",fontStyle:"italic"}}>{emptyText}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={title}
      style={{display:"inline-flex",alignItems:"center",gap:6,background:"#25D366",color:"#0a3d20",fontWeight:800,fontSize:13,padding:"9px 14px",borderRadius:8,textDecoration:"none",whiteSpace:"nowrap",boxShadow:"0 1px 4px rgba(37,211,102,0.35)"}}>
      <Phone size={15} strokeWidth={2} /> {label}
    </a>
  );
}

export function statusBadge(s) {
  const normalizedStatus = normalizeReservationStatus(s);
  // "בדיקת עדכון" is a DISPLAY state (a pending student equipment-update on an
  // approved reservation, derived from reservations_new.pending_update_id) —
  // never a base status, and deliberately NOT in the inventory-blocking set.
  //
  // "לא יצא?" is also display-only, derived from a NULL issued_at (lesson #51).
  // Slate on purpose: nothing is missing and nobody is in trouble — the gear
  // never left the shelf. Orange here would put it next to "באיחור", which is
  // exactly the conflation the label was added to end. It DOES still hold
  // inventory, though; see INVENTORY_BLOCKING_STATUSES in utils.js.
  //
  // badge-slate rather than badge-gray: gray is the fallback below for anything
  // unmapped, and it borrows --surface2/--text2, which made this status read as
  // disabled chrome instead of a status.
  const m = { "מאושר":"badge-green","פעילה":"badge-teal","ממתין":"badge-yellow","נדחה":"badge-red","הוחזר":"badge-blue","באיחור":"badge-orange","לא יצא?":"badge-slate","אישור ראש מחלקה":"badge-purple","בדיקת עדכון":"badge-orange","תקין":"badge-green","פגום":"badge-red","בתיקון":"badge-yellow","נעלם":"badge-red" };
  return <span className={`badge ${m[normalizedStatus]||"badge-gray"}`}>{normalizedStatus}</span>;
}
export function Toast({ toasts }) {
  return <div className="toast-container">{toasts.map(t=><div key={t.id} className={`toast toast-${t.type}`}><span>{t.type==="success"?<CheckCircle size={16} strokeWidth={1.75} />:t.type==="error"?<XCircle size={16} strokeWidth={1.75} />:<Info size={16} strokeWidth={1.75} />}</span>{t.msg}</div>)}</div>;
}
export function Modal({ title, onClose, children, footer, size="" }) {
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className={`modal ${size}`}>
        <div className="modal-header"><span className="modal-title">{title}</span><button className="btn btn-secondary btn-sm btn-icon" onClick={onClose}><X size={16} strokeWidth={1.75} color="var(--text3)" /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
// Replaces near-white colors in Lottie JSON with the accent hex color
function tintLottieData(data, hex) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return data;
  const r = parseInt(hex.slice(1,3),16)/255;
  const g = parseInt(hex.slice(3,5),16)/255;
  const b = parseInt(hex.slice(5,7),16)/255;
  function walk(obj) {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(walk);
    const out = {};
    for (const k of Object.keys(obj)) {
      if (k === "k" && Array.isArray(obj[k]) && obj[k].length === 4 &&
          typeof obj[k][0] === "number" && obj[k][0] > 0.8 && obj[k][1] > 0.8 && obj[k][2] > 0.8) {
        out[k] = [r, g, b, obj[k][3]];
      } else {
        out[k] = walk(obj[k]);
      }
    }
    return out;
  }
  return walk(JSON.parse(JSON.stringify(data)));
}

const MIN_DISPLAY_MS = 1500;
const FADE_OUT_MS = 350;

export function Loading({ accentColor, ready = false, onDone }) {
  const ref = useRef(null);
  const [minDone, setMinDone] = useState(false);
  const [fading, setFading] = useState(false);
  const firedRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setMinDone(true), MIN_DISPLAY_MS);
    return () => clearTimeout(t);
  }, []);

  // When both ready & minDone — start fade-out, then call onDone
  useEffect(() => {
    if (!(minDone && ready) || firedRef.current) return;
    firedRef.current = true;
    setFading(true);
    const t = setTimeout(() => onDone?.(), FADE_OUT_MS);
    return () => clearTimeout(t);
  }, [minDone, ready]);

  const colorRef = useRef(null);
  if (!colorRef.current) {
    colorRef.current = (() => {
      try { return JSON.parse(localStorage.getItem("cache_siteSettings"))?.accentColor; } catch { return null; }
    })() || accentColor || "#f5a623";
  }

  useEffect(() => {
    if (!ref.current) return;
    const tinted = tintLottieData(loadingData, colorRef.current);
    const anim = lottie.loadAnimation({ container: ref.current, renderer: "svg", loop: true, autoplay: true, animationData: tinted, rendererSettings: { preserveAspectRatio: "xMidYMid meet" } });
    return () => anim.destroy();
  }, []);

  return (
    <div style={{position:"fixed",inset:0,width:"100vw",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",zIndex:9999,background:"#1a1a2e",opacity:fading?0:1,transition:`opacity ${FADE_OUT_MS}ms ease`}}>
      <style>{`@media(max-width:600px){.lottie-load{width:250px!important;height:250px!important}}`}</style>
      <div ref={ref} className="lottie-load" style={{width:350,height:350}} />
    </div>
  );
}
