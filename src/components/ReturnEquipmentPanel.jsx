// ReturnEquipmentPanel.jsx — the equipment-return screen for warehouse staff.
//
// Replaces the item list inside a reservation whose effective status is
// פעילה / באיחור, in BOTH mounts (ReservationsPage's detail modal and the
// dashboard's request view), so the two can never drift apart.
//
// The shape of the interaction follows the shape of the work: nearly every
// return is "all of it came back fine", so that case is one tap per card and no
// second screen. Only when something is missing from the pile does the panel
// escalate to the per-unit step — and even there every unit starts at תקין, so
// 7-fine-out-of-8 is one click, not eight.
//
// Deliberately NOT here: checkboxes, +/- steppers, or any editing of the
// request. Changing what was borrowed is עריכת בקשה; this screen only records
// what came back.
//
// The write itself lives in the parent (it owns `equipment`/`setEquipment`);
// this component hands it a flat outcomes array. The pure rules — which units to
// offer, and how to fold outcomes into the equipment array without destroying
// the rest of the inventory — are in src/utils/returnFlow.js, under test.

import { useMemo, useState } from "react";
import { Package, CheckCircle, RotateCcw, AlertTriangle, HelpCircle } from "lucide-react";
import { groupReservationItemsByCategory } from "../utils.js";
import {
  UNIT_OK, UNIT_DAMAGED, UNIT_MISSING,
  pickUnitsForReturn, summarizeOutcomes, unitLabel,
} from "../utils/returnFlow.js";

const OUTCOME_STYLE = {
  [UNIT_OK]:      { color: "var(--green)",  bg: "rgba(46,204,113,0.15)", icon: CheckCircle },
  [UNIT_DAMAGED]: { color: "var(--red)",    bg: "rgba(231,76,60,0.15)",  icon: AlertTriangle },
  [UNIT_MISSING]: { color: "#9b59b6",       bg: "rgba(155,89,182,0.18)", icon: HelpCircle },
};

function EqImg({ eq, size = 32 }) {
  const img = eq?.image || null;
  if (!img) return <Package size={size} strokeWidth={1.75} />;
  return img.startsWith("data:") || img.startsWith("http")
    ? <img src={img} alt="" style={{ width: size, height: size, objectFit: "cover", borderRadius: 6, flex: "none" }} />
    : <span style={{ fontSize: size, lineHeight: 1, flex: "none" }}>{img}</span>;
}

// One borrowed line. The whole card is the control — no widget on top of it.
function ItemCard({ eq, item, green, onToggle }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", cursor: "pointer",
        borderRadius: "var(--r-sm)", userSelect: "none", transition: "background 0.12s, border-color 0.12s",
        background: green ? "rgba(46,204,113,0.12)" : "var(--surface2)",
        border: `1px solid ${green ? "var(--green)" : "var(--border)"}`,
      }}
    >
      <EqImg eq={eq} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, minWidth: 0 }}>{eq?.name || item.name || "?"}</div>
        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
          כמות: <strong style={{ color: green ? "var(--green)" : "var(--accent)" }}>{item.quantity}</strong>
        </div>
      </div>
      {green
        ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--green)", fontWeight: 800, fontSize: 12, whiteSpace: "nowrap" }}>
            <CheckCircle size={16} strokeWidth={2} /> חזר תקין
          </span>
        : <span style={{ fontSize: 11, color: "var(--text3)", whiteSpace: "nowrap" }}>לחצו לסימון</span>}
    </div>
  );
}

// Three-state control for a single physical unit. Defaults to תקין, so the
// common "only this one is broken" edit is a single tap.
function UnitRow({ unitId, status, fault, onStatus, onFault }) {
  return (
    <div style={{
      background: "var(--surface2)", border: `1px solid ${status === UNIT_OK ? "var(--border)" : OUTCOME_STYLE[status].color}`,
      borderRadius: 8, padding: "8px 10px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 800, fontSize: 13, minWidth: 42 }}>{unitLabel(unitId)}</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
          {[UNIT_OK, UNIT_DAMAGED, UNIT_MISSING].map((s) => {
            const on = status === s;
            const st = OUTCOME_STYLE[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => onStatus(s)}
                style={{
                  padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 800, cursor: "pointer",
                  background: on ? st.bg : "transparent",
                  border: `1px solid ${on ? st.color : "var(--border)"}`,
                  color: on ? st.color : "var(--text3)",
                }}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>
      {status === UNIT_DAMAGED && (
        <input
          className="form-input"
          style={{ marginTop: 8, fontSize: 12 }}
          placeholder="מה התקלה? (אופציונלי)"
          value={fault}
          onChange={(e) => onFault(e.target.value)}
        />
      )}
    </div>
  );
}

export function ReturnEquipmentPanel({ reservation, equipment = [], onComplete, busy = false }) {
  const [greenKeys, setGreenKeys] = useState(() => new Set());
  const [exceptions, setExceptions] = useState(null); // null | [{key, eq, item, units:[{id,status,fault}]}]

  const groups = useMemo(
    () => groupReservationItemsByCategory(reservation?.items || [], equipment),
    [reservation, equipment],
  );
  const allEntries = useMemo(() => groups.flatMap(g => g.entries), [groups]);
  const total = allEntries.length;
  const greenCount = allEntries.filter(e => greenKeys.has(String(e.index))).length;

  const toggle = (key) => setGreenKeys((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // "הוחזר": straight through when every card is green, otherwise open the
  // per-unit step for the cards that are not.
  const startReturn = () => {
    const pending = allEntries.filter(e => !greenKeys.has(String(e.index)));
    if (pending.length === 0) { onComplete([]); return; }
    setExceptions(pending.map(({ item, eq, index }) => ({
      key: String(index),
      item,
      eq,
      units: pickUnitsForReturn(eq, item.quantity).map(u => ({ id: u.id, status: UNIT_OK, fault: "" })),
    })));
  };

  const patchUnit = (rowKey, unitId, patch) => setExceptions(prev => prev.map(row =>
    row.key !== rowKey ? row : { ...row, units: row.units.map(u => u.id === unitId ? { ...u, ...patch } : u) },
  ));

  const outcomes = useMemo(() => (exceptions || []).flatMap(row =>
    row.units.map(u => ({ equipmentId: row.eq?.id, unitId: u.id, status: u.status, fault: u.fault })),
  ), [exceptions]);
  const summary = summarizeOutcomes(outcomes);

  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12,
        background: "rgba(52,152,219,0.08)", border: "1px solid rgba(52,152,219,0.3)",
        borderRadius: 8, padding: "8px 12px", fontSize: 12.5, lineHeight: 1.7,
      }}>
        <RotateCcw size={14} strokeWidth={1.75} color="var(--blue)" style={{ flex: "none" }} />
        <span style={{ minWidth: 0 }}>
          <strong>קבלת ציוד בחזרה.</strong> לחצו על כל פריט שחזר תקין במלואו — הוא ייצבע בירוק.
          פריט שלא סומן יעבור לשלב פירוט לפני השלמת ההחזרה.
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {groups.map(group => (
          <div key={group.category} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "var(--accent)" }}>{group.category}</div>
            {group.entries.map(({ item, eq, index }) => (
              <ItemCard
                key={index}
                eq={eq}
                item={item}
                green={greenKeys.has(String(index))}
                onToggle={() => toggle(String(index))}
              />
            ))}
          </div>
        ))}
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 14,
        paddingTop: 14, borderTop: "1px solid var(--border)",
      }}>
        <span style={{ fontSize: 12.5, color: "var(--text2)", minWidth: 0 }}>
          סומנו <strong style={{ color: greenCount === total ? "var(--green)" : "var(--text)" }}>{greenCount}</strong> מתוך {total} פריטים
          {greenCount < total && <span style={{ color: "var(--text3)" }}> — השאר יפורטו בשלב הבא</span>}
        </span>
        <button
          className="btn btn-primary"
          style={{ marginInlineStart: "auto" }}
          disabled={busy}
          onClick={startReturn}
        >
          {busy ? "שומר…" : <><RotateCcw size={14} strokeWidth={1.75} /> הוחזר</>}
        </button>
      </div>

      {exceptions && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setExceptions(null)}>
          <div className="modal modal-lg">
            <div className="modal-header">
              <span className="modal-title">
                <AlertTriangle size={16} strokeWidth={1.75} color="var(--accent)" /> טיפול בפריטים חריגים
              </span>
              <button className="btn btn-secondary btn-sm" onClick={() => setExceptions(null)}>סגור</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 12.5, color: "var(--text2)", lineHeight: 1.8, marginBottom: 12 }}>
                כל היחידות מסומנות <strong style={{ color: "var(--green)" }}>תקין</strong> כברירת מחדל —
                שנו רק את מה שחזר פגום או לא חזר.
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {exceptions.map(row => (
                  <div key={row.key} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                      <EqImg eq={row.eq} size={28} />
                      <div style={{ fontWeight: 800, fontSize: 14, minWidth: 0 }}>{row.eq?.name || row.item.name}</div>
                      <span style={{ fontSize: 12, color: "var(--text3)" }}>{row.item.quantity} יחידות בהשאלה</span>
                    </div>
                    {row.units.length === 0 ? (
                      <div style={{ fontSize: 12, color: "var(--text3)" }}>
                        אין יחידות זמינות לסימון עבור הפריט הזה — הוא יושלם ללא שינוי מלאי.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {row.units.map(u => (
                          <UnitRow
                            key={u.id}
                            unitId={u.id}
                            status={u.status}
                            fault={u.fault}
                            onStatus={(s) => patchUnit(row.key, u.id, { status: s, ...(s === UNIT_DAMAGED ? {} : { fault: "" }) })}
                            onFault={(v) => patchUnit(row.key, u.id, { fault: v })}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer" style={{ gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, color: "var(--text2)", marginInlineEnd: "auto", minWidth: 0 }}>
                <strong style={{ color: "var(--green)" }}>{summary.ok}</strong> תקינות ·{" "}
                <strong style={{ color: "var(--red)" }}>{summary.damaged}</strong> פגומות ·{" "}
                <strong style={{ color: "#9b59b6" }}>{summary.missing}</strong> נעלמו
              </span>
              <button className="btn btn-secondary" onClick={() => setExceptions(null)} disabled={busy}>חזור</button>
              <button className="btn btn-primary" disabled={busy} onClick={() => onComplete(outcomes)}>
                {busy ? "שומר…" : <><CheckCircle size={14} strokeWidth={1.75} /> השלם החזרה</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ReturnEquipmentPanel;
