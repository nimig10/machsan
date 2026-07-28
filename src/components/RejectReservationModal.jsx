// RejectReservationModal.jsx — the dialog that stands between "דחה" and a
// rejected request.
//
// Rejecting used to be a single click: the request moved to "נדחות" and the
// student got a mail that said only that it was rejected. With no reason given
// they would phone the warehouse to ask why. This dialog collects that reason
// once, and sends it two ways — inside the rejection mail, and (optionally) as
// a prefilled WhatsApp message.
//
// The reason is recommended, NOT required: a request can still be rejected with
// an empty box, in which case the mail simply carries no explanation block.
import { useState } from "react";
import { XCircle, Phone, MessageSquare } from "lucide-react";
import { Modal } from "./ui.jsx";
import { buildReservationWhatsAppLink } from "../utils.js";
import { useAutoGrowTextarea, AUTO_GROW_TEXTAREA_STYLE } from "../hooks/useAutoGrowTextarea.js";

export function RejectReservationModal({ reservation, busy = false, onCancel, onConfirm }) {
  const [reason, setReason] = useState("");
  // Destructured rather than kept as an object: passing `box.ref` straight to a
  // ref prop trips react-hooks/refs, which reads the property access as a ref
  // read during render.
  const { ref: reasonRef, fit: fitReason } = useAutoGrowTextarea(reason);

  if (!reservation) return null;

  // Rebuilt every render so the link tracks the reason as it is typed.
  const waLink = buildReservationWhatsAppLink(reservation, {
    headline: "בקשת השאלת הציוד שלך במכללה נדחתה.",
    note: reason.trim() ? `סיבת הדחייה:\n${reason.trim()}` : "",
  });

  return (
    <Modal
      title={<><XCircle size={16} strokeWidth={1.9} color="var(--red)" /> דחיית בקשה — {reservation.student_name}</>}
      // A submit in flight must not be dismissable by the backdrop, or the
      // staff member is left unsure whether the rejection went through.
      onClose={() => { if (!busy) onCancel?.(); }}
      footer={<>
        <button className="btn btn-secondary" disabled={busy} onClick={() => onCancel?.()}>ביטול</button>
        <button className="btn btn-danger" disabled={busy} onClick={() => onConfirm?.(reason)}>
          {busy ? "דוחה…" : "דחה ושלח הודעה"}
        </button>
      </>}
    >
      <div style={{ background: "rgba(231,76,60,0.1)", border: "1px solid rgba(231,76,60,0.35)", borderRadius: "var(--r-sm)", padding: "12px 14px", marginBottom: 16, fontSize: 13, lineHeight: 1.7, color: "var(--text2)" }}>
        הבקשה תעבור לסטטוס <strong style={{ color: "var(--red)" }}>נדחה</strong>, ומייל יישלח לסטודנט
        {reservation.email ? <> אל <strong style={{ color: "var(--text)", direction: "ltr", unicodeBidi: "plaintext" }}>{reservation.email}</strong></> : null}.
        הנימוק שתכתוב/י יופיע בתוך המייל.
      </div>

      <label style={{ fontSize: 13, fontWeight: 800, color: "var(--text2)", display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <MessageSquare size={15} strokeWidth={1.9} /> סיבת הדחייה (מומלץ — אפשר גם להשאיר ריק)
      </label>
      {/* Height comes from the measurement, so rows={1} is only a floor —
          minHeight is what makes it comfortable while empty. */}
      <textarea
        ref={reasonRef}
        rows={1}
        value={reason}
        disabled={busy}
        onChange={e => { setReason(e.target.value); fitReason(e.target); }}
        placeholder="לדוגמה: הציוד שביקשת כבר מושאל בתאריכים האלה. אפשר להגיש בקשה חדשה לתאריך אחר."
        style={{
          ...AUTO_GROW_TEXTAREA_STYLE,
          width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8,
          border: "1px solid var(--border)", background: "var(--surface2)",
          color: "var(--text)", fontFamily: "inherit", lineHeight: 1.6,
          minHeight: 96,
          fontSize: 16,
        }}
      />

      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {waLink ? (
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            title="פתח שיחת WhatsApp עם הסטודנט — הטקסט מתעדכן לפי מה שנכתב למעלה"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#25D366", color: "#0a3d20", fontWeight: 800, fontSize: 13, padding: "8px 14px", borderRadius: 8, textDecoration: "none", whiteSpace: "nowrap", boxShadow: "0 1px 4px rgba(37,211,102,0.35)" }}
          >
            <Phone size={15} strokeWidth={2} /> שלח גם בוואטסאפ
          </a>
        ) : (
          <span style={{ fontSize: 12, color: "var(--text3)", fontStyle: "italic" }}>אין טלפון לסטודנט — לא ניתן לשלוח וואטסאפ</span>
        )}
        <span style={{ fontSize: 12, color: "var(--text3)" }}>
          הוואטסאפ נפתח בלשונית חדשה; הדחייה עצמה מתבצעת בלחיצה על "דחה ושלח הודעה".
        </span>
      </div>
    </Modal>
  );
}

export default RejectReservationModal;
