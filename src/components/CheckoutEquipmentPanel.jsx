// CheckoutEquipmentPanel.jsx — the equipment-CHECKOUT screen for warehouse staff.
//
// The mirror of ReturnEquipmentPanel, and deliberately so: the two halves of a
// loan are the same physical job in opposite directions, and a warehouse worker
// should not have to learn a second interaction to do the second one. Same
// one-tap-per-card first step, same per-unit escalation only for what is
// unusual, same sticky footer.
//
// Replaces the item list inside a reservation whose checkoutState() is
// "pending" / "half_issued", in BOTH mounts (ReservationsPage's detail modal
// and the dashboard's request view), so the two can never drift apart.
//
// ── The one place it is NOT a mirror ────────────────────────────────────────
// The return screen refuses to edit the request ("changing what was borrowed is
// עריכת בקשה; this screen only records what came back"). Checkout has to break
// that rule, because the moment it matters is exactly here: the student is
// standing at the counter saying "actually I don't need the boom pole". Before
// this screen that meant leaving, opening עריכת בקשה, finding the line, and
// coming back — so in practice it was not done, and the gear stayed booked out
// to nobody. "החזר" is that act, and it is a distinct fourth state rather than
// an inference precisely so the rule is broken ON PURPOSE and only on purpose:
// פגום and נעלם are still documentation and still leave the quantity alone.
//
// The write itself lives in the parent (it owns `equipment`/`setEquipment`);
// this component hands it a flat outcomes array. The pure rules are in
// src/utils/checkoutFlow.js, under test.

import { useMemo, useState } from "react";
import { Package, CheckCircle, PackageCheck, AlertTriangle, Eraser, HelpCircle, Undo2, X } from "lucide-react";
import { groupReservationItemsByCategory } from "../utils.js";
import {
  UNIT_DAMAGED, UNIT_MISSING, UNIT_ISSUED, UNIT_RETURNED,
  CHECKOUT_OUTCOMES, CHECKOUT_COLOR, CHECKOUT_BG,
  pickUnitsForCheckout, summarizeCheckout, unitLabel,
  checkoutSeedItems, recordedCheckoutUnitIds, computeCheckoutItems,
} from "../utils/checkoutFlow.js";
import {
  useWarehouseMarks, toggleWarehouseGreen, setWarehouseVerdict, clearWarehouseMarks,
} from "../hooks/useWarehouseMarks.js";
import {
  FLOW_CHECKOUT, markKeysFor, visibleGreenKeys, countDroppedGreen, mergeUnitVerdicts, hasAnyMarks,
} from "../utils/markDraft.js";

// Green, where the return panel is blue. Gear going OUT and gear coming BACK
// are the two things a warehouse worker must never confuse at a glance, and the
// colour is the fastest thing on the screen to read. btn-primary (the accent)
// still belongs to אשר/שמור.
const GREEN_BTN = { background: "var(--green)", borderColor: "var(--green)", color: "#fff", fontWeight: 800 };

// Colours come from checkoutFlow.js so the archive renders a "פגום" chip in
// exactly the same red — one palette, two screens. The icons stay here: they
// are React components and that module must run under plain Node.
const OUTCOME_STYLE = {
  [UNIT_ISSUED]:   { color: CHECKOUT_COLOR[UNIT_ISSUED],   bg: CHECKOUT_BG[UNIT_ISSUED],   icon: CheckCircle },
  [UNIT_DAMAGED]:  { color: CHECKOUT_COLOR[UNIT_DAMAGED],  bg: CHECKOUT_BG[UNIT_DAMAGED],  icon: AlertTriangle },
  [UNIT_MISSING]:  { color: CHECKOUT_COLOR[UNIT_MISSING],  bg: CHECKOUT_BG[UNIT_MISSING],  icon: HelpCircle },
  [UNIT_RETURNED]: { color: CHECKOUT_COLOR[UNIT_RETURNED], bg: CHECKOUT_BG[UNIT_RETURNED], icon: Undo2 },
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
        {/* --text2 / 13px, not --text3 / 12px: this is the number the staff
            member counts against the pile in front of them, not a caption. */}
        <div style={{ fontSize: 13, color: "var(--text2)", fontWeight: 600, marginTop: 3 }}>
          כמות: <strong style={{ color: green ? "var(--green)" : "var(--accent)", fontSize: 14 }}>{item.quantity}</strong>
        </div>
      </div>
      {green
        ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--green)", fontWeight: 800, fontSize: 12, whiteSpace: "nowrap" }}>
            <CheckCircle size={16} strokeWidth={2} /> יוצא במלואו
          </span>
        : <span style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 700, whiteSpace: "nowrap" }}>לחצו לסימון</span>}
    </div>
  );
}

// Four-state control for a single physical unit. Defaults to יוצא, so the
// common "only this one is a problem" edit is a single tap.
function UnitRow({ unitId, status, fault, onStatus, onFault }) {
  return (
    <div style={{
      background: "var(--surface2)",
      border: `1px solid ${status === UNIT_ISSUED ? "var(--border)" : OUTCOME_STYLE[status].color}`,
      borderRadius: 8, padding: "8px 10px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 800, fontSize: 13, minWidth: 42 }}>{unitLabel(unitId)}</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
          {CHECKOUT_OUTCOMES.map((s) => {
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
      {status === UNIT_RETURNED && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--blue)", fontWeight: 600 }}>
          תרד מרשימת הבקשה ותחזור למלאי הזמין
        </div>
      )}
    </div>
  );
}

export function CheckoutEquipmentPanel({ reservation, equipment = [], onComplete, busy = false, recovering = false }) {
  // ⚠️ THE MARKS DO NOT LIVE HERE ANY MORE — see src/hooks/useWarehouseMarks.js.
  //
  // This panel is rendered conditionally inside its host modal, so closing the
  // request view (including by clicking the backdrop, which is one stray click)
  // unmounted it and React destroyed every mark the operator had made. Holding
  // them above the modal is the fix; reading the store during render, rather
  // than seeding state from it, is what keeps lesson #42 away.
  //
  // `detailOpen` is the only local state left, and it is a pure view flag.
  // `exceptions` used to be BOTH "is the overlay open" AND "the per-unit work",
  // which is exactly why pressing "סגור" threw the work away. Two things now.
  const draft = useWarehouseMarks(FLOW_CHECKOUT, reservation?.id);
  const [detailOpen, setDetailOpen] = useState(false);

  // ⚠️ Seeded from original_items ?? items, NEVER from items alone. If an
  // earlier attempt already decremented the list, seeding from the live rows
  // would ask about fewer units and shrink the request a second time. See
  // checkoutSeedItems.
  const seedItems = useMemo(() => checkoutSeedItems(reservation), [reservation]);
  const groups = useMemo(
    () => groupReservationItemsByCategory(seedItems, equipment),
    [seedItems, equipment],
  );
  const allEntries = useMemo(() => groups.flatMap(g => g.entries), [groups]);
  const total = allEntries.length;

  // Marks hang on equipment ids, never on array position — the nested item rows
  // come back from PostgREST unordered, so a position key would re-attach a mark
  // to a different piece of gear. `lines` carries each quantity so a mark made
  // against a quantity somebody has since changed is refused, not re-applied.
  const markKeys = useMemo(() => markKeysFor(seedItems), [seedItems]);
  const lines = useMemo(
    () => allEntries.map(e => ({ key: markKeys[e.index], qty: e.item.quantity })),
    [allEntries, markKeys],
  );
  const greenKeys = useMemo(() => visibleGreenKeys(draft, lines), [draft, lines]);
  const droppedCount = useMemo(() => countDroppedGreen(draft, lines), [draft, lines]);
  const greenCount = greenKeys.size;
  const allGreen = greenCount === total;

  // Units a previous attempt already ruled on. Without this the panel would
  // offer DIFFERENT hardware on the retry (the unit it marked damaged is no
  // longer תקין, so it drops out of the candidate list) and the operator would
  // condemn a second healthy unit.
  const recorded = useMemo(() => recordedCheckoutUnitIds(reservation), [reservation]);

  const toggle = (markKey, qty) =>
    toggleWarehouseGreen(FLOW_CHECKOUT, reservation?.id, markKey, !greenKeys.has(markKey), qty);

  // "הוצא": straight through when every card is green, otherwise open the
  // per-unit step for the cards that are not.
  const startCheckout = () => {
    if (allGreen) { onComplete([]); return; }
    setDetailOpen(true);
  };

  // The per-unit rows are DERIVED, not stored — which is what lets the overlay
  // be closed and reopened without losing anything. mergeUnitVerdicts lays the
  // saved verdicts onto a freshly picked unit list, and mapping over that fresh
  // list IS the pruning: a unit the picker no longer offers (another screen
  // marked it פגום) simply has no row, so a stale verdict cannot resurrect it.
  //
  // ⚠️ The detailOpen gate is load bearing. `outcomes` below must stay [] while
  // the overlay is shut, exactly as it was when `exceptions` was null — that is
  // the contract computeCheckoutItems is read against everywhere else.
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
            pickUnitsForCheckout(eq, item.quantity, { include: recorded }),
            { defaultStatus: UNIT_ISSUED, damagedStatus: UNIT_DAMAGED, allowed: CHECKOUT_OUTCOMES },
          ),
        };
      });
  }, [detailOpen, allEntries, markKeys, greenKeys, recorded, draft]);

  // ⚠️ THE OVERLAY FREEZES THE MOMENT THE OPERATOR COMMITS — see the long note on
  // the same lines in ReturnEquipmentPanel. The failure mode is identical because
  // completeEquipmentCheckout also calls setEquipment optimistically, before its
  // round trip: a unit marked פגום or נעלם stops being תקין, drops out of
  // pickUnitsForCheckout, and the row re-derives onto different hardware drawn at
  // the default יוצא. The operator watches their own mark undo itself while the
  // button still says "שומר…".
  //
  // `recorded` does NOT cover this. It is read off reservation.checkout_outcomes,
  // which the server has not written yet at this point in the flow — it rescues
  // the NEXT mount (the recovery banner), not this one.
  //
  // Once the operator commits, this overlay is a receipt, not an editor.
  const [submittedRows, setSubmittedRows] = useState(null);
  const detailRows = busy && submittedRows ? submittedRows : liveDetailRows;

  const patchUnit = (markKey, unitId, patch) =>
    setWarehouseVerdict(FLOW_CHECKOUT, reservation?.id, markKey, unitId, patch);

  const outcomes = useMemo(() => detailRows.flatMap(row =>
    row.units.map(u => ({ equipmentId: row.eq?.id, unitId: u.id, status: u.status, fault: u.fault })),
  ), [detailRows]);
  const summary = summarizeCheckout(outcomes);

  // What the request will actually say afterwards — shown per line so nobody
  // discovers the decrement only after committing it.
  const nextItems = useMemo(() => computeCheckoutItems(seedItems, outcomes), [seedItems, outcomes]);
  const nextQtyFor = (eqId) => {
    const hit = nextItems.find(i => String(i.equipment_id) === String(eqId));
    return hit ? Number(hit.quantity) || 0 : 0;
  };

  return (
    <div>
      {recovering && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10,
          background: "rgba(230,126,34,0.10)", border: "1px solid rgba(230,126,34,0.45)",
          borderRadius: 8, padding: "8px 12px", fontSize: 12.5, lineHeight: 1.7,
        }}>
          <AlertTriangle size={14} strokeWidth={1.75} color="var(--accent)" style={{ flex: "none" }} />
          <span style={{ minWidth: 0 }}>
            <strong>ההוצאה הזו לא הושלמה.</strong> חלק מהשינויים כבר נשמרו — סמנו שוב ולחצו "הוצא"
            כדי לסיים. סימון חוזר של אותן יחידות לא יבצע את השינוי פעמיים.
          </span>
        </div>
      )}

      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12,
        background: "rgba(46,204,113,0.08)", border: "1px solid rgba(46,204,113,0.3)",
        borderRadius: 8, padding: "8px 12px", fontSize: 12.5, lineHeight: 1.7,
      }}>
        <PackageCheck size={14} strokeWidth={1.75} color="var(--green)" style={{ flex: "none" }} />
        <span style={{ minWidth: 0 }}>
          <strong>מסירת ציוד לסטודנט.</strong> לחצו על כל פריט שיוצא במלואו — הוא ייצבע בירוק.
          פריט שלא סומן יעבור לשלב פירוט, שם אפשר גם להחזיר למלאי מה שלא נלקח.
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
                green={greenKeys.has(markKeys[index])}
                onToggle={() => toggle(markKeys[index], item.quantity)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* The button's label says which of the two things pressing it does, so
          nobody presses "הוצא" expecting to finish and lands in the per-unit
          step instead. */}
      <div className="return-panel-footer" style={{
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 14,
        paddingTop: 14, borderTop: "1px solid var(--border)",
      }}>
        <span style={{ fontSize: 12.5, color: "var(--text2)", minWidth: 0, flex: "1 1 180px", display: "flex", flexDirection: "column", gap: 2 }}>
          <span>
            סומנו <strong style={{ color: allGreen ? "var(--green)" : "var(--text)" }}>{greenCount}</strong> מתוך {total} פריטים
            {!allGreen && <span style={{ color: "var(--text3)" }}> — השאר יפורטו בשלב הבא</span>}
          </span>
          {/* Said out loud, because the only other way to discover it is to lose
              work once and be pleasantly surprised the next time. */}
          {greenCount > 0 && (
            <span style={{ fontSize: 11, color: "var(--text3)" }}>
              הסימונים נשמרים — אפשר לצאת מהבקשה ולחזור אליה
            </span>
          )}
          {/* A mark refused by visibleGreenKeys is otherwise invisible, and looks
              exactly like the bug this whole change fixes. */}
          {droppedCount > 0 && (
            <span style={{ fontSize: 11, color: "#e67e22", fontWeight: 700 }}>
              {droppedCount === 1 ? "סימון אחד לא שוחזר" : `${droppedCount} סימונים לא שוחזרו`} — הפריט או הכמות בבקשה השתנו
            </span>
          )}
        </span>
        {/* Closing the modal USED to be how an operator abandoned a half-marked
            request. Keeping the marks takes that away, so this replaces it —
            deliberately the quietest control in the row, so it can never be
            mistaken for the green one next to it. */}
        {hasAnyMarks(draft) && (
          <button
            className="btn"
            disabled={busy}
            onClick={() => clearWarehouseMarks(FLOW_CHECKOUT, reservation?.id)}
            style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text2)", fontSize: 12.5, fontWeight: 700, padding: "9px 14px" }}
          >
            <Eraser size={13} strokeWidth={1.75} /> נקה סימונים
          </button>
        )}
        <button
          className="btn"
          style={{ ...GREEN_BTN, fontSize: 14, padding: "10px 28px" }}
          disabled={busy}
          onClick={startCheckout}
        >
          {busy ? "שומר…" : <><PackageCheck size={15} strokeWidth={2} /> {allGreen ? "הוצא" : "המשך לפירוט"}</>}
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
                  in — so this is a close, not a cancel. Disabled mid-write. */}
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
                כל היחידות מסומנות <strong style={{ color: "var(--green)" }}>יוצא</strong> כברירת מחדל —
                שנו רק את מה שנמצא פגום, חסר במחסן, או שהסטודנט לא לוקח.{" "}
                <strong style={{ color: "var(--blue)" }}>החזר</strong> הוא היחיד שמשנה את כמות הבקשה.
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {detailRows.map(row => {
                  const before = Number(row.item.quantity) || 0;
                  const after = nextQtyFor(row.eq?.id);
                  return (
                    <div key={row.key} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                        <EqImg eq={row.eq} size={28} />
                        <div style={{ fontWeight: 800, fontSize: 14, minWidth: 0 }}>{row.eq?.name || row.item.name}</div>
                        {/* Only shown once they diverge — an unchanged line must
                            not gain a number nobody needs to read. */}
                        {after !== before
                          ? <span style={{ fontSize: 12, fontWeight: 800, color: "var(--blue)" }}>
                              {before} בבקשה → <span style={{ fontSize: 13 }}>{after} יוצאות</span>
                            </span>
                          : <span style={{ fontSize: 12, color: "var(--text3)" }}>{before} יחידות בבקשה</span>}
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
                  );
                })}
              </div>
            </div>
            {/* Sticky (see .return-exceptions-footer): the tally and the button
                that commits it stay on screen while the unit list scrolls. */}
            <div className="modal-footer return-exceptions-footer" style={{ gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, color: "var(--text2)", marginInlineEnd: "auto", minWidth: 0 }}>
                <strong style={{ color: "var(--green)" }}>{summary.issued}</strong> יוצאות ·{" "}
                <strong style={{ color: "var(--red)" }}>{summary.damaged}</strong> פגומות ·{" "}
                <strong style={{ color: "#9b59b6" }}>{summary.missing}</strong> נעלמו ·{" "}
                <strong style={{ color: "var(--blue)" }}>{summary.returned}</strong> חוזרות למלאי
              </span>
              {/* Snapshot first, then commit — both read from this render, so
                  what stays on screen is exactly what was submitted. */}
              <button
                className="btn"
                style={{ ...GREEN_BTN, fontSize: 14, padding: "10px 28px" }}
                disabled={busy}
                onClick={() => { setSubmittedRows(detailRows); onComplete(outcomes); }}
              >
                {busy ? "שומר…" : <><PackageCheck size={15} strokeWidth={2} /> השלם הוצאה</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CheckoutEquipmentPanel;
