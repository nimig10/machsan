// ui.jsx — shared UI primitives: Toast, Modal, Loading, statusBadge
import { useState, useRef, useEffect } from "react";
import lottie from "lottie-web";
import loadingData from "../assets/loading-logo2.json";
import { normalizeReservationStatus } from "../utils.js";
export function statusBadge(s) {
  const normalizedStatus = normalizeReservationStatus(s);
  const m = { "מאושר":"badge-green","פעילה":"badge-teal","ממתין":"badge-yellow","נדחה":"badge-red","הוחזר":"badge-blue","באיחור":"badge-orange","אישור ראש מחלקה":"badge-purple","תקין":"badge-green","פגום":"badge-red","בתיקון":"badge-yellow","נעלם":"badge-red" };
  return <span className={`badge ${m[normalizedStatus]||"badge-gray"}`}>{normalizedStatus}</span>;
}
export function Toast({ toasts }) {
  return <div className="toast-container">{toasts.map(t=><div key={t.id} className={`toast toast-${t.type}`}><span>{t.type==="success"?"✅":t.type==="error"?"❌":"ℹ️"}</span>{t.msg}</div>)}</div>;
}
export function Modal({ title, onClose, children, footer, size="" }) {
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className={`modal ${size}`}>
        <div className="modal-header"><span className="modal-title">{title}</span><button className="btn btn-secondary btn-sm btn-icon" onClick={onClose}>✕</button></div>
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

const MIN_DISPLAY_MS = 4000;

export function Loading({ accentColor, ready = false, onDone }) {
  const ref = useRef(null);
  const [minDone, setMinDone] = useState(false);

  // 4-second minimum display timer
  useEffect(() => {
    const t = setTimeout(() => setMinDone(true), MIN_DISPLAY_MS);
    return () => clearTimeout(t);
  }, []);

  // Fire onDone only when BOTH conditions are met
  useEffect(() => {
    if (minDone && ready) onDone?.();
  }, [minDone, ready]);

  const color = accentColor || (() => {
    try { return JSON.parse(localStorage.getItem("cache_siteSettings"))?.accentColor; } catch { return null; }
  })() || "#f5a623";

  useEffect(() => {
    if (!ref.current) return;
    const tinted = tintLottieData(loadingData, color);
    const anim = lottie.loadAnimation({ container: ref.current, renderer: "svg", loop: true, autoplay: true, animationData: tinted, rendererSettings: { preserveAspectRatio: "xMidYMid meet" } });
    return () => anim.destroy();
  }, [color]);

  return (
    <div style={{position:"fixed",inset:0,width:"100vw",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",zIndex:9999}}>
      <style>{`@media(max-width:600px){.lottie-load{width:250px!important;height:250px!important}}`}</style>
      <div ref={ref} className="lottie-load" style={{width:350,height:350}} />
    </div>
  );
}
