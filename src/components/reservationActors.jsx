// reservationActors.jsx — shared display of WHO on the staff acted on a
// reservation. Two small presentational components, reused by ReservationsPage,
// DashboardPage and ArchivePage so the wording stays identical everywhere.
//
// Both are display-only and read server-derived (JWT) data:
//   • ApprovedByLabel  ← reservations_new.approved_by_name  (who moved it to מאושר)
//   • UpdateHistoryList ← reservation_item_updates.reviewed_by_name (who reviewed
//                          each student item-update; PR #85 already stores it)
import { formatDate } from "../utils.js";

// "👤 מאשר הבקשה: [שם]". Renders nothing for a reservation that was never
// approved by a staff member (NULL stamp — pre-feature row or failed stamp).
export function ApprovedByLabel({ reservation, style }) {
  const name = String(reservation?.approved_by_name || "").trim();
  if (!name) return null;
  return (
    <span style={{ color: "var(--text2)", ...style }}>
      👤 מאשר הבקשה: <strong style={{ color: "var(--accent)", fontWeight: 800 }}>{name}</strong>
    </span>
  );
}

const REVIEW_STATUS_LABEL = {
  approved:     "אושר",
  partial:      "אושר חלקית",
  rejected:     "נדחה",
  cancelled:    "בוטל",
  auto_applied: "הוחל אוטומטית",
};
const REVIEW_STATUS_COLOR = {
  approved:     "#2ecc71",
  partial:      "#f5a623",
  rejected:     "#e74c3c",
  cancelled:    "var(--text3)",
  auto_applied: "#3b98e0",
};

// History of the student's item-updates on this reservation that have already
// been handled (pending ones are shown by the separate review panel, not here).
// Each line: "🔄 עדכון #N — <outcome> ע"י <staff> · <date>".
export function UpdateHistoryList({ updates = [], reservationId, style }) {
  const rows = (updates || [])
    .filter(u => String(u.reservation_id) === String(reservationId) && u.review_status !== "pending")
    .sort((a, b) => (a.update_number || 0) - (b.update_number || 0));
  if (!rows.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
      {rows.map(u => {
        const label = REVIEW_STATUS_LABEL[u.review_status] || u.review_status;
        const color = REVIEW_STATUS_COLOR[u.review_status] || "var(--text2)";
        const who   = String(u.reviewed_by_name || "").trim();
        const when  = u.reviewed_at ? formatDate(u.reviewed_at) : "";
        return (
          <span key={u.id} style={{ color: "var(--text2)", fontSize: 12 }}>
            🔄 עדכון #{u.update_number} — <strong style={{ color }}>{label}</strong>
            {/* auto_applied has no human reviewer */}
            {u.review_status !== "auto_applied" && who && (
              <> ע״י <strong style={{ color: "var(--text)" }}>{who}</strong></>
            )}
            {when && <span style={{ color: "var(--text3)" }}> · {when}</span>}
          </span>
        );
      })}
    </div>
  );
}
