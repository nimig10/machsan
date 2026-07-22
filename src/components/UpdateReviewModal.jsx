import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle, Clock, MessageSquare, Package, RotateCcw, Shield, User, X, XCircle } from "lucide-react";
import { cloudinaryThumb, formatDate, formatTime } from "../utils.js";
import { getProductionCertBlockers } from "../utils/reservationUpdateReview.js";
import { MAX_RESERVATION_UPDATES, reviewReservationUpdate } from "../utils/reservationUpdatesApi.js";
import { Modal } from "./ui.jsx";

function sectionTitle(icon, title, count, color = "var(--accent)") {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, fontSize: 14, fontWeight: 900, color }}>
      {icon} {title} <span style={{ fontSize: 11, color: "var(--text3)", fontWeight: 700 }}>({count})</span>
    </div>
  );
}

export function UpdateReviewModal({ reservation, pendingUpdate, updatesUsed = 0, equipment = [], certifications, showToast, onReviewed, onClose }) {
  const pendingItems = useMemo(
    () => (pendingUpdate?.items || []).filter(item => item.review_state === "pending"),
    [pendingUpdate],
  );
  const [decisions, setDecisions] = useState(() => Object.fromEntries(
    pendingItems.map(item => [item.id, { decision: "approve", qty: Number(item.quantity) || 1 }]),
  ));
  const [staffMessage, setStaffMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const staffMessageRef = useRef(null);

  const equipmentById = useMemo(
    () => new Map((equipment || []).map(item => [String(item.id), item])),
    [equipment],
  );
  const setDecision = (id, patch) => setDecisions(previous => ({
    ...previous,
    [id]: { ...previous[id], ...patch },
  }));

  const rejectedCount = pendingItems.filter(item => decisions[item.id]?.decision === "reject").length;
  const reducedCount = pendingItems.filter(item => {
    const decision = decisions[item.id];
    return decision?.decision !== "reject" && Number(decision?.qty) < Number(item.quantity);
  }).length;
  const hasPartialDecision = rejectedCount > 0 || reducedCount > 0;
  const allRejected = pendingItems.length > 0 && rejectedCount === pendingItems.length;

  // The textarea is controlled, so resize after React commits each new value.
  // This prevents a re-render from restoring the browser's default fixed height.
  useLayoutEffect(() => {
    const textarea = staffMessageRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [staffMessage, hasPartialDecision]);

  const submitReview = async () => {
    if (busy || pendingItems.length === 0) return;
    const approvedItems = pendingItems
      .filter(item => decisions[item.id]?.decision !== "reject")
      .map(item => ({ equipment_id: item.equipment_id, quantity: decisions[item.id]?.qty || item.quantity }));
    const certBlockers = getProductionCertBlockers(
      { ...reservation, items: approvedItems },
      equipment,
      certifications,
    );
    if (certBlockers.length) {
      showToast?.("error", `לא ניתן לאשר את העדכון — נדרשת הסמכה עבור ${certBlockers.map(item => item.equipment_name).join(", ")}`);
      return;
    }

    setBusy(true);
    try {
      const payload = pendingItems.map(item => {
        const decision = decisions[item.id] || { decision: "approve", qty: item.quantity };
        return decision.decision === "reject"
          ? { pending_item_id: item.id, decision: "reject" }
          : {
              pending_item_id: item.id,
              decision: "approve",
              approved_quantity: Math.max(1, Math.min(Number(decision.qty) || 1, Number(item.quantity) || 1)),
            };
      });
      const result = await reviewReservationUpdate(pendingUpdate.id, payload, staffMessage.trim());
      if (!result?.ok) {
        const itemName = (String(result?.detail || "").match(/"([^"]+)"/) || [])[1] || "";
        const message = result?.error === "update_overbook"
          ? `אין מספיק מלאי${itemName ? ` עבור "${itemName}"` : " לאחד הפריטים"} — ניתן להסיר או להקטין אותו.`
          : result?.error === "not_pending"
            ? "העדכון כבר טופל על ידי איש צוות אחר. הבחירות שלך נשמרו בפאנל עד לסגירתו."
            : result?.error === "external_restricted"
              ? `הפריט${itemName ? ` "${itemName}"` : ""} מוגבל להשאלת חוץ ויש להסיר אותו.`
              : result?.error === "private_limit"
                ? "אישור העדכון יחרוג ממגבלת ארבעת הפריטים בהשאלה פרטית."
                : "שגיאה באישור העדכון. הבחירות נשמרו וניתן לנסות שוב.";
        showToast?.("error", message);
        return;
      }

      const successMessage = result.outcome === "approved"
        ? "העדכון אושר והפריטים נוספו לבקשה"
        : result.outcome === "partial"
          ? "העדכון אושר חלקית ונשלח מייל לסטודנט"
          : result.outcome === "rejected"
            ? "העדכון נדחה ונשלח מייל לסטודנט"
            : "ההשאלה כבר יצאה לדרך — העדכון נסגר ולא הוחל";
      showToast?.(result.outcome === "cancelled_started" ? "info" : "success", successMessage);
      await onReviewed?.(result);
      onClose?.();
    } finally {
      setBusy(false);
    }
  };

  // qty is seeded here too: an entry written without it survives a later
  // "restore" as { decision:"approve" } with no qty, which makes the −/+ pair
  // compute NaN and both buttons render enabled.
  const markAllRejected = () => setDecisions(previous => Object.fromEntries(
    pendingItems.map(item => [item.id, {
      qty: Number(previous[item.id]?.qty) || Number(item.quantity) || 1,
      ...(previous[item.id] || {}),
      decision: "reject",
    }]),
  ));
  const primaryLabel = allRejected
    ? "דחה את העדכון ושלח"
    : hasPartialDecision
      ? "אשר חלקית ושלח"
      : "אשר את כל העדכון";

  return (
    <Modal
      title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#e67e22" }}><Clock size={18} /> בדיקת עדכון</span>}
      onClose={() => { if (!busy) onClose?.(); }}
      size="modal-lg"
      footer={(
        <div className="upd-review-footer" style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-secondary" disabled={busy} onClick={onClose}>ביטול וסגירה</button>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!allRejected && <button className="btn btn-danger" disabled={busy} onClick={markAllRejected}><XCircle size={15} /> סמן דחייה לכל העדכון</button>}
            <button className={allRejected ? "btn btn-danger" : "btn btn-success"} disabled={busy || pendingItems.length === 0} onClick={submitReview}>
              {busy ? <><Clock size={15} /> מעבד...</> : <><CheckCircle size={15} /> {primaryLabel}</>}
            </button>
          </div>
        </div>
      )}
    >
      <div style={{ direction: "rtl", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ background: "rgba(230,126,34,0.08)", border: "1px solid rgba(230,126,34,0.35)", borderRadius: 12, padding: "12px 14px", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, display: "flex", alignItems: "center", gap: 7 }}><User size={16} /> {reservation?.student_name || "סטודנט"}</div>
            <div style={{ color: "var(--text3)", fontSize: 12, marginTop: 4 }}>{reservation?.email || ""}</div>
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.7, color: "var(--text2)" }}>
            <div><strong>השאלה:</strong> {formatDate(reservation?.borrow_date)}{reservation?.borrow_time ? ` · ${formatTime(reservation.borrow_time)}` : ""}</div>
            <div><strong>עדכון:</strong> {pendingUpdate?.update_number || updatesUsed} מתוך {MAX_RESERVATION_UPDATES}</div>
          </div>
        </div>

        <section style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          {sectionTitle(<Package size={16} />, "פריטים בבדיקה", pendingItems.length, "#e67e22")}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {pendingItems.map(item => {
              // Merge, don't short-circuit: a truthy-but-partial entry (no qty)
              // would otherwise reach the steppers as undefined and yield NaN.
              const decision = { decision: "approve", qty: Number(item.quantity) || 1, ...(decisions[item.id] || {}) };
              const rejected = decision.decision === "reject";
              const itemEquipment = equipmentById.get(String(item.equipment_id));
              const image = itemEquipment?.image;
              const hasImage = typeof image === "string" && (image.startsWith("data:") || image.startsWith("http"));
              const certBlocked = getProductionCertBlockers(
                { ...reservation, items: [{ equipment_id: item.equipment_id, quantity: decision.qty || item.quantity }] },
                equipment,
                certifications,
              ).length > 0;
              const actionLabel = item.action === "increase" ? "הגדלת כמות" : "הוספה";
              return (
                <div key={item.id} style={{ border: `1.5px solid ${rejected ? "rgba(231,76,60,0.5)" : "rgba(230,126,34,0.42)"}`, background: rejected ? "rgba(231,76,60,0.06)" : "rgba(230,126,34,0.05)", borderRadius: 12, padding: 12, opacity: rejected ? 0.78 : 1 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 190, display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 42, height: 42, flexShrink: 0, borderRadius: 8, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface2)", border: "1px solid var(--border)" }}>
                        {hasImage
                          ? <img src={cloudinaryThumb(image, 96)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          : image
                            ? <span style={{ fontSize: 22 }}>{image}</span>
                            : <Package size={19} strokeWidth={1.75} color="var(--text3)" />}
                      </div>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                          <strong style={{ textDecoration: rejected ? "line-through" : "none" }}>{item.name || itemEquipment?.name || "פריט"}</strong>
                          <span style={{ fontSize: 10, fontWeight: 800, color: "#e67e22", background: "rgba(230,126,34,0.13)", borderRadius: 999, padding: "2px 8px" }}>{actionLabel}</span>
                        </div>
                        <div style={{ marginTop: 5, fontSize: 12, color: "var(--text2)", fontWeight: 750 }}>הסטודנט ביקש: <strong style={{ color: "var(--text)" }}>{item.quantity} יח׳</strong></div>
                        {certBlocked && <div style={{ marginTop: 5, fontSize: 10, fontWeight: 800, color: "#f59e0b", display: "inline-flex", alignItems: "center", gap: 4 }}><Shield size={11} /> דרושה הסמכה לפני אישור</div>}
                      </div>
                    </div>
                    {!rejected && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 800 }}>כמות שתאושר:</span>
                        <button className="btn btn-secondary btn-sm btn-icon upd-step-btn" disabled={busy || Number(decision.qty) <= 1} onClick={() => setDecision(item.id, { qty: Math.max(1, Number(decision.qty) - 1) })}>−</button>
                        <strong style={{ minWidth: 20, textAlign: "center", color: Number(decision.qty) < Number(item.quantity) ? "#e67e22" : "var(--text)" }}>{decision.qty}</strong>
                        <button className="btn btn-secondary btn-sm btn-icon upd-step-btn" disabled={busy || Number(decision.qty) >= Number(item.quantity)} onClick={() => setDecision(item.id, { qty: Math.min(Number(item.quantity), Number(decision.qty) + 1) })} style={{ opacity: Number(decision.qty) >= Number(item.quantity) ? 0.28 : 1, cursor: Number(decision.qty) >= Number(item.quantity) ? "not-allowed" : "pointer" }}>+</button>
                      </div>
                    )}
                    <button className={rejected ? "btn btn-secondary btn-sm" : "btn btn-danger btn-sm"} disabled={busy} onClick={() => setDecision(item.id, { decision: rejected ? "approve" : "reject" })}>
                      {rejected ? <><RotateCcw size={13} /> שחזר לאישור</> : <><X size={13} /> הסר מהעדכון</>}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {hasPartialDecision && (
          <section style={{ border: "1px solid rgba(231,76,60,0.35)", background: "rgba(231,76,60,0.05)", borderRadius: 12, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 900, fontSize: 14, marginBottom: 6 }}><MessageSquare size={16} /> הודעה לסטודנט</div>
            <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6, marginBottom: 9 }}>
              {allRejected ? "העדכון כולו יידחה." : `${rejectedCount} פריטים יוסרו ו־${reducedCount} כמויות יוקטנו.`} ניתן לצרף הסבר אישי; ללא טקסט יישלח הנוסח האוטומטי.
            </div>
            <textarea ref={staffMessageRef} className="form-textarea upd-msg-box" rows={4} value={staffMessage} disabled={busy} onChange={event => setStaffMessage(event.target.value)} placeholder="הסבר לסטודנט (אופציונלי)..." style={{ width: "100%", boxSizing: "border-box", minHeight: 96, overflowY: "hidden", resize: "none" }} />
          </section>
        )}

        <div style={{ display: "flex", gap: 7, alignItems: "flex-start", color: "var(--text3)", fontSize: 11, lineHeight: 1.6 }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          הציוד המאושר אינו נבדק מחדש. הזמינות, מגבלות ההשאלה וההסמכות נבדקות שוב אוטומטית בעת האישור.
        </div>

        <section style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          {sectionTitle(<CheckCircle size={16} />, "ציוד שכבר אושר", reservation?.items?.length || 0, "var(--green)")}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 8 }}>
            {(reservation?.items || []).map(item => {
              const eq = equipmentById.get(String(item.equipment_id));
              return (
                <div key={item.id || `${item.equipment_id}-${item.quantity}`} style={{ border: "1px solid var(--border)", background: "var(--surface2)", borderRadius: 10, padding: "9px 11px", display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 750 }}>{eq?.name || item.name || "פריט"}</span>
                  <strong style={{ color: "var(--green)", whiteSpace: "nowrap" }}>×{item.quantity}</strong>
                </div>
              );
            })}
            {!reservation?.items?.length && <div style={{ color: "var(--text3)", fontSize: 12 }}>אין ציוד מאושר להצגה</div>}
          </div>
        </section>
      </div>
    </Modal>
  );
}
