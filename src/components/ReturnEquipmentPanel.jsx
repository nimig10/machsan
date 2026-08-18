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
import { Package, CheckCircle, RotateCcw, AlertTriangle, Eraser, HelpCircle, X } from "lucide-react";
import { groupReservationItemsByCategory } from "../utils.js";
import {
  UNIT_OK, UNIT_DAMAGED, UNIT_MISSING, OUTCOME_COLOR, OUTCOME_BG, RETURN_OUTCOMES,
  pickUnitsForReturn, summarizeOutcomes, unitLabel,
} from "../utils/returnFlow.js";
import {
  useWarehouseMarks, toggleWarehouseGreen, setWarehouseVerdict, clearWarehouseMarks,
} from "../hooks/useWarehouseMarks.js";
import {
  FLOW_RETURN, markKeysFor, visibleGreenKeys, countDroppedGreen, mergeUnitVerdicts, hasAnyMarks,
} from "../utils/markDraft.js";

// The return action stayed blue when it moved off the old "🔄 הוחזר" button, so
// it still reads as the same act the archive labels "🔵 הוחזר". btn-primary is
// the accent colour and belongs to אשר/שמור — not to closing a loan.
const BLUE_BTN = { background: "var(--blue)", borderColor: "var(--blue)", color: "#fff", fontWeight: 800 };

// Colours come from returnFlow.js so the archive renders a "פגום" chip in
// exactly the same red — one palette, two screens. The icons stay here: they
// are React components and that module must run under plain Node.
const OUTCOME_STYLE = {
  [UNIT_OK]:      { color: OUTCOME_COLOR[UNIT_OK],      bg: OUTCOME_BG[UNIT_OK],      icon: CheckCircle },
  [UNIT_DAMAGED]: { color: OUTCOME_COLOR[UNIT_DAMAGED], bg: OUTCOME_BG[UNIT_DAMAGED], icon: AlertTriangle },
  [UNIT_MISSING]: { color: OUTCOME_COLOR[UNIT_MISSING], bg: OUTCOME_BG[UNIT_MISSING], icon: HelpCircle },
};

function EqImg({ eq, size = 32 }) {
  const img = eq?.image || null;
  if (!img) return <Package size={size} strokeWidth={1.75} />;
  return img.startsWith("data:") || img.startsWith("http")
    ? <img src={img} alt="" style={{ width: size, height: size, objectFit: "cover", borderRadius: 6, flex: "none" }} />
    : <span style={{ fontSize: size, lineHeight: 1, flex: "none" }}>{img}</span>;
}

// One borrowed line. The whole card is the control — no widget on top of it.
//
// ⚠️ MARKED IS BLUE HERE AND GREEN IN THE CHECKOUT PANEL — see OUTCOME_COLOR in
// returnFlow.js for why. The prop is `marked`, not `green`: the store still
// calls the set greenKeys (that vocabulary is pinned by markDraft.js and its
// tests) but nothing on this screen is green any more, and a prop that names a
// colour it does not use is how the two panels drifted into looking identical.
function ItemCard({ eq, item, marked, onToggle }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", cursor: "pointer",
        borderRadius: "var(--r-sm)", userSelect: "none", transition: "background 0.12s, border-color 0.12s",
        background: marked ? "rgba(52,152,219,0.12)" : "var(--surface2)",
        border: `1px solid ${marked ? "var(--blue)" : "var(--border)"}`,
      }}
    >
      <EqImg eq={eq} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, minWidth: 0 }}>{eq?.name || item.name || "?"}</div>
        {/* --text2 / 13px, not --text3 / 12px: this is the number the staff
            member counts against the pile in front of them, not a caption. */}
        <div style={{ fontSize: 13, color: "var(--text2)", fontWeight: 600, marginTop: 3 }}>
          כמות: <strong style={{ color: marked ? "var(--blue)" : "var(--accent)", fontSize: 14 }}>{item.quantity}</strong>
        </div>
      </div>
      {marked
        ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--blue)", fontWeight: 800, fontSize: 12, whiteSpace: "nowrap" }}>
            <CheckCircle size={16} strokeWidth={2} /> חזר תקין
          </span>
        /* Plain text, no frame — it was the dimmest thing on the card while
           being the only instruction on it, so it only needed the contrast. */
        : <span style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 700, whiteSpace: "nowrap" }}>לחצו לסימון</span>}
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
  // ⚠️ THE MARKS DO NOT LIVE HERE ANY MORE — see src/hooks/useWarehouseMarks.js,
  // and the identical note at the top of CheckoutEquipmentPanel. Closing the
  // request view unmounted this panel and destroyed everything the operator had
  // marked; the store holds it above the modal instead.
  //
  // `detailOpen` replaces the old `exceptions === null`, which meant BOTH "the
  // overlay is shut" and "there is no per-unit work" — which is why "סגור" threw
  // the per-unit work away.
  const draft = useWarehouseMarks(FLOW_RETURN, reservation?.id);
  const [detailOpen, setDetailOpen] = useState(false);

  const groups = useMemo(
    () => groupReservationItemsByCategory(reservation?.items || [], equipment),
    [reservation, equipment],
  );
  const allEntries = useMemo(() => groups.flatMap(g => g.entries), [groups]);
  const total = allEntries.length;

  // Keyed by equipment id, never by array position — the nested item rows come
  // back unordered, so a position key would re-attach a mark to different gear.
  const markKeys = useMemo(() => markKeysFor(reservation?.items || []), [reservation]);
  const lines = useMemo(
    () => allEntries.map(e => ({ key: markKeys[e.index], qty: e.item.quantity })),
    [allEntries, markKeys],
  );
  const greenKeys = useMemo(() => visibleGreenKeys(draft, lines), [draft, lines]);
  const droppedCount = useMemo(() => countDroppedGreen(draft, lines), [draft, lines]);
  const greenCount = greenKeys.size;
  const allGreen = greenCount === total;

  const toggle = (markKey, qty) =>
    toggleWarehouseGreen(FLOW_RETURN, reservation?.id, markKey, !greenKeys.has(markKey), qty);

  // "הוחזר": straight through when every card is green, otherwise open the
  // per-unit step for the cards that are not.
  const startReturn = () => {
    if (allGreen) { onComplete([]); return; }
    setDetailOpen(true);
  };

  // Derived, not stored — that is what lets the overlay close and reopen without
  // losing anything. Mapping over the freshly picked list IS the pruning: a unit
  // that is no longer תקין drops out of pickUnitsForReturn, so a saved verdict
  // for it has no row to land on and cannot resurrect it. This is exactly why
  // pickUnitsForReturn keeps its two-argument signature — a return must never
  // offer a unit already out of circulation.
  const liveDetailRows = useMemo(() => {
    if (!detailOpen) return [];
    return allEntries
      .filter(e => !greenKeys.has(markKeys[e.index]))
      .map(({ item, eq, index }) => {
        const key = markKeys[index];
        return {
          key,
          item,
          eq,
          units: mergeUnitVerdicts(
            draft,
            key,
            pickUnitsForReturn(eq, item.quantity),
            { defaultStatus: UNIT_OK, damagedStatus: UNIT_DAMAGED, allowed: RETURN_OUTCOMES },
          ),
        };
      });
  }, [detailOpen, allEntries, markKeys, greenKeys, draft]);

  // ⚠️ THE OVERLAY FREEZES THE MOMENT THE OPERATOR COMMITS. Correctness of
  // display, not polish.
  //
  // completeEquipmentReturn calls setEquipment OPTIMISTICALLY, before its network
  // round trip. So the unit just marked פגום stops being תקין while this overlay
  // is still on screen — and pickUnitsForReturn offers תקין units only. The row
  // re-derives onto the next healthy unit, drawn at the default תקין, and the
  // tally flips back to "1 תקינות · 0 פגומות". For the length of an HTTP request
  // the operator watches their own mark undo itself.
  //
  // Nothing was ever actually lost — onComplete already holds the outcomes array
  // and the write goes through — but it reads exactly like a failure, at the one
  // moment there is nothing left to do about it.
  //
  // Snapshotted in the CLICK HANDLER, not during render: an event is the honest
  // place to capture "what was on screen when they pressed it", and it keeps this
  // component pure (a ref read during render is what the React compiler warns
  // about, and it would be the wrong shape here anyway).
  //
  // Never cleared: it is only ever consulted while busy, so the next submit
  // simply overwrites it. Releasing it when busy clears is deliberate — on the
  // failure paths that already wrote inventory, the replaced unit list IS the
  // truth, and the retry has to be made against it.
  const [submittedRows, setSubmittedRows] = useState(null);
  const detailRows = busy && submittedRows ? submittedRows : liveDetailRows;

  const patchUnit = (markKey, unitId, patch) =>
    setWarehouseVerdict(FLOW_RETURN, reservation?.id, markKey, unitId, patch);

  const outcomes = useMemo(() => detailRows.flatMap(row =>
    row.units.map(u => ({ equipmentId: row.eq?.id, unitId: u.id, status: u.status, fault: u.fault })),
  ), [detailRows]);
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
                marked={greenKeys.has(markKeys[index])}
                onToggle={() => toggle(markKeys[index], item.quantity)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* The button's label says which of the two things pressing it does, so
          nobody presses "הוחזר" expecting to close the loan and lands in the
          per-unit step instead. */}
      <div className="return-panel-footer" style={{
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 14,
        paddingTop: 14, borderTop: "1px solid var(--border)",
      }}>
        <span style={{ fontSize: 12.5, color: "var(--text2)", minWidth: 0, flex: "1 1 180px", display: "flex", flexDirection: "column", gap: 2 }}>
          <span>
            סומנו <strong style={{ color: allGreen ? "var(--blue)" : "var(--text)" }}>{greenCount}</strong> מתוך {total} פריטים
            {!allGreen && <span style={{ color: "var(--text3)" }}> — השאר יפורטו בשלב הבא</span>}
          </span>
          {greenCount > 0 && (
            <span style={{ fontSize: 11, color: "var(--text3)" }}>
              הסימונים נשמרים — אפשר לצאת מהבקשה ולחזור אליה
            </span>
          )}
          {droppedCount > 0 && (
            <span style={{ fontSize: 11, color: "#e67e22", fontWeight: 700 }}>
              {droppedCount === 1 ? "סימון אחד לא שוחזר" : `${droppedCount} סימונים לא שוחזרו`} — הפריט או הכמות בבקשה השתנו
            </span>
          )}
        </span>
        {/* Replaces the escape hatch that closing the modal used to provide. */}
        {hasAnyMarks(draft) && (
          <button
            className="btn"
            disabled={busy}
            onClick={() => clearWarehouseMarks(FLOW_RETURN, reservation?.id)}
            style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text2)", fontSize: 12.5, fontWeight: 700, padding: "9px 14px" }}
          >
            <Eraser size={13} strokeWidth={1.75} /> נקה סימונים
          </button>
        )}
        <button
          className="btn"
          style={{ ...BLUE_BTN, fontSize: 14, padding: "10px 28px" }}
          disabled={busy}
          onClick={startReturn}
        >
          {busy ? "שומר…" : <><RotateCcw size={15} strokeWidth={2} /> {allGreen ? "הוחזר" : "המשך לפירוט"}</>}
        </button>
      </div>

      {detailOpen && (
        <div className="modal-overlay return-exceptions-overlay" onClick={(e) => { if (!busy && e.target === e.currentTarget) setDetailOpen(false); }}>
          <div className="modal modal-lg">
            <div className="modal-header">
              <span className="modal-title">
                <AlertTriangle size={16} strokeWidth={1.75} color="var(--accent)" /> טיפול בפריטים חריגים
              </span>
              {/* Backs out to the card list. It no longer discards anything —
                  the verdicts live in the store and are merged back on the way
                  in — so this is a close, not a cancel. There is deliberately no
                  second "חזור" in the footer: one escape, in the place every
                  other modal in the app puts it. Disabled mid-write so the panel
                  can't be dismissed while the units are being saved. */}
              <button
                className="btn"
                onClick={() => setDetailOpen(false)}
                disabled={busy}
                style={{
                  background: "var(--surface2)", color: "var(--text)",
                  border: "1px solid var(--text3)", fontWeight: 800,
                  padding: "8px 18px", gap: 5,
                }}
              >
                <X size={15} strokeWidth={2.25} /> סגור
              </button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 12.5, color: "var(--text2)", lineHeight: 1.8, marginBottom: 12 }}>
                כל היחידות מסומנות <strong style={{ color: "var(--blue)" }}>תקין</strong> כברירת מחדל —
                שנו רק את מה שחזר פגום או לא חזר.
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {detailRows.map(row => (
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
            {/* Sticky (see .return-exceptions-footer): the tally and the button
                that commits it stay on screen while the unit list scrolls, so a
                long list can never hide the only way to finish. */}
            <div className="modal-footer return-exceptions-footer" style={{ gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, color: "var(--text2)", marginInlineEnd: "auto", minWidth: 0 }}>
                <strong style={{ color: "var(--blue)" }}>{summary.ok}</strong> תקינות ·{" "}
                <strong style={{ color: "var(--red)" }}>{summary.damaged}</strong> פגומות ·{" "}
                <strong style={{ color: "#9b59b6" }}>{summary.missing}</strong> נעלמו
              </span>
              {/* Snapshot first, then commit — both read from this render, so
                  what stays on screen is exactly what was submitted. */}
              <button
                className="btn"
                style={{ ...BLUE_BTN, fontSize: 14, padding: "10px 28px" }}
                disabled={busy}
                onClick={() => { setSubmittedRows(detailRows); onComplete(outcomes); }}
              >
                {busy ? "שומר…" : <><CheckCircle size={15} strokeWidth={2} /> השלם החזרה</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ReturnEquipmentPanel;
