// ui.jsx — shared UI primitives: Toast, Modal, Loading, statusBadge
import { useRef, useEffect } from "react";
import lottie from "lottie-web";
import loadingData from "../assets/loading-logo.json";
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
export function Loading() {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const anim = lottie.loadAnimation({ container: ref.current, renderer: "svg", loop: true, autoplay: true, animationData: loadingData });
    return () => anim.destroy();
  }, []);
  return (
    <div style={{position:"fixed",inset:0,width:"100vw",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"transparent",overflow:"hidden",zIndex:9999}}>
      <div ref={ref} style={{width:300,maxWidth:"60vw"}} />
    </div>
  );
}
