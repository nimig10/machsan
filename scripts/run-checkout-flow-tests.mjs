#!/usr/bin/env node
// Unit tests for src/utils/checkoutFlow.js — the logic behind the equipment
// CHECKOUT screen, and the only flow in the app that writes to INVENTORY and
// EDITS THE REQUEST in the same gesture.
//
// What is pinned here, and why each one matters:
//   1. applyCheckoutOutcomes returns the FULL equipment array (lesson #21), and
//      יוצא/החזר leave the unit תקין — equipment_units.status describes
//      condition, not location.
//   2. computeCheckoutItems is an ABSOLUTE TARGET LIST, so re-applying the same
//      outcomes after a mid-flight failure lands on the same rows. A delta
//      would subtract twice; that is the bug this whole module is shaped around.
//   3. Only החזר reduces a quantity. פגום/נעלם are documentation. If that ever
//      flips, a student silently loses gear they were told they had.
//   4. pickUnitsForCheckout honours `include`, so a retry asks about the SAME
//      hardware instead of burning a second healthy unit.
//   5. checkoutState answers "which panel", including the half-written row.
//   6. The archive snapshot degrades to null for every pre-feature row — that
//      branch is every archived loan in prod, so it is pinned hardest.
//   7. lateStatusFor splits "באיחור" into the two problems it was conflating, and
//      "לא יצא?" still ties up inventory. That second half is the dangerous one:
//      it is a label the browser invents over a row the DB still counts, so if any
//      availability list forgets it, the UI offers stock the RPC will refuse.
//
// No network, no DB. Exit 0 = all passed.

import {
  UNIT_OK, UNIT_DAMAGED, UNIT_MISSING, UNIT_ISSUED, UNIT_RETURNED,
  CHECKOUT_OUTCOMES, CHECKOUT_EXCEPTIONS,
  checkoutSeedItems, pickUnitsForCheckout, applyCheckoutOutcomes,
  computeCheckoutItems, summarizeCheckout, describeCheckoutExceptions,
  buildCheckoutOutcomesSnapshot, readCheckoutOutcomes, recordedCheckoutUnitIds,
  checkoutState, wasCheckedOut, checkoutWindowOpen, validateCheckoutOutcomes,
  lateStatusFor, STATUS_OVERDUE, STATUS_NOT_PICKED_UP,
  pickupOverdue, setNotPickedUpGraceMinutes, getNotPickedUpGraceMs,
  DEFAULT_NOT_PICKED_UP_GRACE_MIN, MAX_NOT_PICKED_UP_GRACE_MIN,
  CHECKOUT_COLOR,
} from "../src/utils/checkoutFlow.js";
import { OUTCOME_COLOR } from "../src/utils/returnFlow.js";
import {
  EMPTY_DRAFT, FLOW_CHECKOUT, FLOW_RETURN, draftKey, markKeysFor,
  visibleGreenKeys, countDroppedGreen, mergeUnitVerdicts, withGreen, withVerdict, hasAnyMarks,
} from "../src/utils/markDraft.js";

let passed = 0;
let failed = 0;
const check = (name, cond, detail = "") => {
  if (cond) { passed += 1; console.log(`  \x1b[32mPASS\x1b[0m ${name}`); }
  else { failed += 1; console.error(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
};

const unit = (id, status = UNIT_OK, fault = "") => ({ id, status, fault, repair: "" });
const xlr = () => ({
  id: "1776079954421", name: "כבל XLR", total_quantity: 25,
  units: Array.from({ length: 25 }, (_, i) => unit(`1776079954421_${i + 1}`)),
});
const ntg = () => ({
  id: "1773430190996", name: "NTG1", total_quantity: 3,
  units: [unit("1773430190996_1"), unit("1773430190996_2"), unit("1773430190996_3")],
});
const fleet = () => [xlr(), ntg()];
const AT = "2026-08-13T09:41:22.113Z";
const oc = (equipmentId, unitId, status, fault = "") => ({ equipmentId, unitId, status, fault });

// ── 1. the vocabulary ──────────────────────────────────────────────────────
console.log("\n\x1b[1m> states\x1b[0m");
check("four states are offered", CHECKOUT_OUTCOMES.length === 4);
check("יוצא is the default and is offered", CHECKOUT_OUTCOMES[0] === UNIT_ISSUED);
check("יוצא is NEVER stored — it is the default, like תקין on the return screen",
  !CHECKOUT_EXCEPTIONS.includes(UNIT_ISSUED));
check("החזר IS stored — it changes the request, so it must be explainable later",
  CHECKOUT_EXCEPTIONS.includes(UNIT_RETURNED));
check("תקין is not a checkout verdict", !CHECKOUT_OUTCOMES.includes(UNIT_OK));

// ── 2. seeding: original_items ?? items ────────────────────────────────────
console.log("\n\x1b[1m> checkoutSeedItems (the retry-safety seed)\x1b[0m");
{
  const live = [{ equipment_id: "1776079954421", quantity: 2 }];
  const frozen = [{ equipment_id: "1776079954421", quantity: 6 }];
  check("plain request seeds from the live items",
    checkoutSeedItems({ items: live })[0].quantity === 2);
  check("a request already stamped seeds from original_items, NOT the shrunk list",
    checkoutSeedItems({ items: live, original_items: frozen })[0].quantity === 6);
  check("an empty original_items falls back to items (never treat [] as frozen)",
    checkoutSeedItems({ items: live, original_items: [] })[0].quantity === 2);
  check("a request with neither yields []", checkoutSeedItems({}).length === 0);
  check("null reservation does not throw", Array.isArray(checkoutSeedItems(null)));
}

// ── 3. picking the units to ask about ──────────────────────────────────────
console.log("\n\x1b[1m> pickUnitsForCheckout\x1b[0m");
{
  const eq = xlr();
  const picked = pickUnitsForCheckout(eq, 6);
  check("returns exactly the borrowed quantity", picked.length === 6, `got ${picked.length}`);
  check("lowest-numbered healthy units, in order",
    picked.map(u => u.id.split("_")[1]).join(",") === "1,2,3,4,5,6");
  const twelve = pickUnitsForCheckout(eq, 12).map(u => Number(u.id.split("_")[1]));
  check("numeric ordering, not lexicographic (#10 after #9)",
    JSON.stringify(twelve) === JSON.stringify([1,2,3,4,5,6,7,8,9,10,11,12]));
}
{
  const eq = xlr();
  eq.units[0].status = UNIT_DAMAGED;
  eq.units[2].status = UNIT_MISSING;
  const picked = pickUnitsForCheckout(eq, 3).map(u => u.id);
  check("units already out of circulation are not offered",
    !picked.includes("1776079954421_1") && !picked.includes("1776079954421_3"), picked.join(","));
}
{
  // THE retry hazard. Attempt #1 marked #3 damaged and then died; #3 is no
  // longer תקין, so without `include` the panel would offer #4 and the operator
  // would mark a SECOND healthy unit as broken.
  const eq = xlr();
  eq.units[2].status = UNIT_DAMAGED;
  const naive = pickUnitsForCheckout(eq, 3).map(u => u.id);
  check("without include, a damaged unit drops out and a fresh one takes its place",
    !naive.includes("1776079954421_3") && naive.includes("1776079954421_4"));

  const pinned = pickUnitsForCheckout(eq, 3, { include: ["1776079954421_3"] }).map(u => u.id);
  check("include forces the already-recorded unit back in",
    pinned.includes("1776079954421_3"), pinned.join(","));
  check("include does not grow the list beyond the borrowed quantity",
    pinned.length === 3, String(pinned.length));
  check("include keeps numeric ordering",
    JSON.stringify(pinned) === JSON.stringify(["1776079954421_1","1776079954421_2","1776079954421_3"]),
    pinned.join(","));
  check("include accepts a Set as well as an array",
    pickUnitsForCheckout(eq, 3, { include: new Set(["1776079954421_3"]) })
      .map(u => u.id).includes("1776079954421_3"));
}
{
  const eq = xlr();
  eq.units = eq.units.slice(0, 2);
  check("never invents a unit id when stock is short",
    pickUnitsForCheckout(eq, 6).length === 2);
  check("quantity 0 asks about nothing", pickUnitsForCheckout(xlr(), 0).length === 0);
  check("an item with no units array does not throw",
    pickUnitsForCheckout({ id: "x" }, 3).length === 0);
}

// ── 4. applying verdicts to inventory ──────────────────────────────────────
console.log("\n\x1b[1m> applyCheckoutOutcomes\x1b[0m");
{
  const list = fleet();
  const next = applyCheckoutOutcomes(list, [oc("1773430190996", "1773430190996_2", UNIT_DAMAGED, "כבל קרוע")]);
  check("returns the FULL equipment array, never a subset (lesson #21)",
    next.length === list.length, `${next.length} vs ${list.length}`);
  check("untouched items come back by reference", next[0] === list[0]);
  check("the named unit is marked", next[1].units[1].status === UNIT_DAMAGED);
  check("fault text is kept on פגום", next[1].units[1].fault === "כבל קרוע");
  check("sibling units are untouched",
    next[1].units[0].status === UNIT_OK && next[1].units[2].status === UNIT_OK);
  check("unit count is preserved", next[1].units.length === list[1].units.length);
}
{
  // The load-bearing difference from the return screen.
  const list = fleet();
  const next = applyCheckoutOutcomes(list, [
    oc("1773430190996", "1773430190996_1", UNIT_ISSUED),
    oc("1773430190996", "1773430190996_2", UNIT_RETURNED),
  ]);
  check("יוצא leaves the unit תקין — gear in a bag is not damaged gear",
    next[1].units[0].status === UNIT_OK);
  check("החזר leaves the unit תקין — it never left the shelf",
    next[1].units[1].status === UNIT_OK);
  check("a clean checkout writes nothing at all (identity preserved)",
    applyCheckoutOutcomes(list, [oc("1773430190996", "1773430190996_1", UNIT_ISSUED)])[1] === list[1]);
}
{
  const list = fleet();
  const next = applyCheckoutOutcomes(list, [
    oc("1773430190996", "1773430190996_1", UNIT_DAMAGED, "רעש"),
    oc("1773430190996", "1773430190996_1", UNIT_ISSUED),
  ]);
  check("the last verdict for a unit wins, and clears the fault",
    next[1].units[0].status === UNIT_OK && !next[1].units[0].fault);
  check("garbage outcomes are ignored, not thrown on",
    applyCheckoutOutcomes(list, [null, {}, oc("nope", "nope_1", "מצב מומצא")]) === list);
}

// ── 5. the item decrement — the heart of it ────────────────────────────────
console.log("\n\x1b[1m> computeCheckoutItems (absolute target list)\x1b[0m");
const seed6 = () => [
  { equipment_id: "1776079954421", name: "כבל XLR", quantity: 6 },
  { equipment_id: "1773430190996", name: "NTG1", quantity: 3 },
];
{
  const outcomes = [
    oc("1776079954421", "1776079954421_1", UNIT_ISSUED),
    oc("1776079954421", "1776079954421_2", UNIT_RETURNED),
    oc("1776079954421", "1776079954421_3", UNIT_RETURNED),
    oc("1776079954421", "1776079954421_4", UNIT_ISSUED),
    oc("1776079954421", "1776079954421_5", UNIT_ISSUED),
    oc("1776079954421", "1776079954421_6", UNIT_ISSUED),
  ];
  const once = computeCheckoutItems(seed6(), outcomes);
  check("two החזר marks drop the line from 6 to 4",
    once.find(i => i.equipment_id === "1776079954421").quantity === 4,
    JSON.stringify(once));
  check("a line with no outcomes at all is untouched",
    once.find(i => i.equipment_id === "1773430190996").quantity === 3);

  // THE test this module exists for.
  const twice = computeCheckoutItems(seed6(), outcomes);
  check("re-applying the SAME outcomes to the SAME seed is idempotent (no double-shrink)",
    JSON.stringify(twice) === JSON.stringify(once), JSON.stringify(twice));

  // And the failure mode it protects against, spelled out: feeding the SHRUNK
  // list back in is what a naive retry would do.
  const wrong = computeCheckoutItems(once, outcomes);
  check("feeding the shrunk list back in DOES shrink again — which is why the seed is original_items",
    wrong.find(i => i.equipment_id === "1776079954421").quantity === 2);
}
{
  const outcomes = [
    oc("1776079954421", "1776079954421_1", UNIT_DAMAGED, "מחבר שבור"),
    oc("1776079954421", "1776079954421_2", UNIT_MISSING),
    oc("1776079954421", "1776079954421_3", UNIT_ISSUED),
    oc("1776079954421", "1776079954421_4", UNIT_ISSUED),
    oc("1776079954421", "1776079954421_5", UNIT_ISSUED),
    oc("1776079954421", "1776079954421_6", UNIT_ISSUED),
  ];
  const out = computeCheckoutItems(seed6(), outcomes);
  check("פגום does NOT reduce the quantity — it is documentation",
    out.find(i => i.equipment_id === "1776079954421").quantity === 6, JSON.stringify(out));
  check("נעלם does NOT reduce the quantity either",
    out.find(i => i.equipment_id === "1776079954421").quantity === 6);
}
{
  const seed = [{ equipment_id: "1773430190996", name: "NTG1", quantity: 1 }];
  const out = computeCheckoutItems(seed, [oc("1773430190996", "1773430190996_1", UNIT_RETURNED)]);
  check("a line that reaches 0 is DROPPED, never written as quantity 0",
    out.length === 0, JSON.stringify(out));
}
{
  const seed = [{ equipment_id: "1773430190996", name: "NTG1", quantity: 2 }];
  const over = computeCheckoutItems(seed, [
    oc("1773430190996", "1773430190996_1", UNIT_RETURNED),
    oc("1773430190996", "1773430190996_2", UNIT_RETURNED),
    oc("1773430190996", "1773430190996_3", UNIT_RETURNED),
  ]);
  check("more החזר marks than the line held drops it, never goes negative",
    over.length === 0, JSON.stringify(over));
}
{
  check("no outcomes at all returns the seed unchanged (identity)",
    computeCheckoutItems(seed6(), []).length === 2);
  const seed = seed6();
  check("outcomes referencing an item not on the request change nothing",
    JSON.stringify(computeCheckoutItems(seed, [oc("ghost", "ghost_1", UNIT_RETURNED)]))
      === JSON.stringify(seed));
  check("it never INCREASES a quantity",
    computeCheckoutItems(seed6(), [
      oc("1776079954421", "1776079954421_1", UNIT_ISSUED),
      oc("1776079954421", "1776079954421_2", UNIT_ISSUED),
    ]).find(i => i.equipment_id === "1776079954421").quantity === 6);
  check("garbage outcomes do not throw",
    computeCheckoutItems(seed6(), [null, {}, { equipmentId: "x" }]).length === 2);
}

// ── 6. summary wording ─────────────────────────────────────────────────────
console.log("\n\x1b[1m> summary\x1b[0m");
{
  const s = summarizeCheckout([
    oc("a", "a_1", UNIT_ISSUED), oc("a", "a_2", UNIT_DAMAGED),
    oc("a", "a_3", UNIT_MISSING), oc("a", "a_4", UNIT_RETURNED), oc("a", "a_5", UNIT_RETURNED),
  ]);
  check("counts every state", s.issued === 1 && s.damaged === 1 && s.missing === 1 && s.returned === 2);
  check("total is the sum", s.total === 5);
  check("singular vs plural in Hebrew",
    describeCheckoutExceptions(s) === "יחידה אחת פגומה · יחידה אחת נעלמה · 2 יחידות הוחזרו למלאי",
    describeCheckoutExceptions(s));
  check("a clean checkout describes as empty string",
    describeCheckoutExceptions(summarizeCheckout([oc("a", "a_1", UNIT_ISSUED)])) === "");
}

// ── 7. the frozen snapshot ─────────────────────────────────────────────────
console.log("\n\x1b[1m> checkout_outcomes snapshot\x1b[0m");
{
  check("a clean checkout stores NULL, not an empty envelope — the archive rests on this",
    buildCheckoutOutcomesSnapshot({ outcomes: [oc("a", "a_1", UNIT_ISSUED)], equipment: fleet(), at: AT }) === null);
  check("no outcomes at all is also NULL",
    buildCheckoutOutcomesSnapshot({ outcomes: [], equipment: fleet(), at: AT }) === null);

  const snap = buildCheckoutOutcomesSnapshot({
    outcomes: [
      oc("1776079954421", "1776079954421_3", UNIT_DAMAGED, "מחבר שבור"),
      oc("1776079954421", "1776079954421_5", UNIT_RETURNED),
      oc("1776079954421", "1776079954421_6", UNIT_ISSUED),
    ],
    equipment: fleet(), at: AT,
  });
  check("versioned and time-stamped", snap.v === 1 && snap.at === AT);
  check("only exceptions are stored — יוצא is dropped", snap.items[0].units.length === 2);
  check("the item name is snapshotted (equipment can be renamed later)",
    snap.items[0].name === "כבל XLR");
  check("an empty fault omits the KEY rather than storing \"\"",
    !("fault" in snap.items[0].units.find(u => u.status === UNIT_RETURNED)));
  check("החזר carries no fault even if one was typed",
    !("fault" in (buildCheckoutOutcomesSnapshot({
      outcomes: [oc("a", "a_1", UNIT_RETURNED, "בכל זאת")], equipment: [], at: AT,
    }).items[0].units[0])));
}

// ── 8. reading it back ─────────────────────────────────────────────────────
console.log("\n\x1b[1m> readCheckoutOutcomes\x1b[0m");
{
  // The hot branch: every row in prod that predates this feature.
  check("a pre-feature row reads as null", readCheckoutOutcomes({ id: "r1" }) === null);
  check("an explicit null column reads as null", readCheckoutOutcomes({ checkout_outcomes: null }) === null);
  check("a malformed column reads as null, never throws",
    readCheckoutOutcomes({ checkout_outcomes: "לא json" }) === null);
  check("an array instead of an object reads as null",
    readCheckoutOutcomes({ checkout_outcomes: [] }) === null);
  check("an envelope with no items reads as null",
    readCheckoutOutcomes({ checkout_outcomes: { v: 1, at: AT, items: [] } }) === null);
  check("an envelope whose units are all non-exceptional reads as null",
    readCheckoutOutcomes({ checkout_outcomes: { v: 1, at: AT, items: [
      { equipment_id: "a", units: [{ unit_id: "a_1", status: UNIT_ISSUED }] }] } }) === null);

  const row = { checkout_outcomes: buildCheckoutOutcomesSnapshot({
    outcomes: [
      oc("1776079954421", "1776079954421_3", UNIT_DAMAGED, "מחבר שבור"),
      oc("1776079954421", "1776079954421_5", UNIT_MISSING),
      oc("1773430190996", "1773430190996_1", UNIT_RETURNED),
    ], equipment: fleet(), at: AT }) };
  const read = readCheckoutOutcomes(row);
  check("round-trips the totals",
    read.totals.damaged === 1 && read.totals.missing === 1 && read.totals.returned === 1,
    JSON.stringify(read.totals));
  check("groups by equipment", Object.keys(read.byEquipment).length === 2);
  check("keeps the fault text", read.byEquipment["1776079954421"].damaged[0].fault === "מחבר שבור");
  check("a numeric equipment_id is normalised to a string",
    !!readCheckoutOutcomes({ checkout_outcomes: { v: 1, at: AT, items: [
      { equipment_id: 1776079954421, units: [{ unit_id: "x_1", status: UNIT_MISSING }] }] } }));
  check("a unit with no id is dropped rather than rendered as #—",
    readCheckoutOutcomes({ checkout_outcomes: { v: 1, at: AT, items: [
      { equipment_id: "a", units: [{ status: UNIT_MISSING }] }] } }) === null);

  const ids = recordedCheckoutUnitIds(row);
  check("recordedCheckoutUnitIds collects every recorded unit for the retry seed",
    ids.size === 3 && ids.has("1776079954421_3") && ids.has("1773430190996_1"),
    [...ids].join(","));
  check("recordedCheckoutUnitIds on a pre-feature row is an empty Set",
    recordedCheckoutUnitIds({ id: "r1" }).size === 0);
}

// ── 9. which panel — the state machine ─────────────────────────────────────
console.log("\n\x1b[1m> checkoutState\x1b[0m");
{
  check("מאושר, never issued → the checkout panel",
    checkoutState({ status: "מאושר" }) === "pending");
  check("באיחור with no stamp means NOBODY EVER COLLECTED IT → still the checkout panel",
    checkoutState({ status: "באיחור" }) === "pending");
  check("פעילה → the return panel", checkoutState({ status: "פעילה", issued_at: AT }) === "issued");
  check("באיחור WITH a stamp is gear that went out and came back late → the return panel",
    checkoutState({ status: "באיחור", issued_at: AT }) === "issued");
  check("the stamp landed but the status RPC did not → a visible recovery state",
    checkoutState({ status: "מאושר", issued_at: AT }) === "half_issued");
  check("פעילה with a NULL stamp still reads as issued — never offer a second checkout",
    checkoutState({ status: "פעילה" }) === "issued");
  check("closed statuses get no panel",
    checkoutState({ status: "הוחזר" }) === "none" && checkoutState({ status: "ממתין" }) === "none");
  check("wasCheckedOut is true for both issued and half_issued",
    wasCheckedOut({ status: "פעילה" }) && wasCheckedOut({ status: "מאושר", issued_at: AT }));
  check("wasCheckedOut is false for a request nobody has touched",
    !wasCheckedOut({ status: "מאושר" }) && !wasCheckedOut({ status: "באיחור" }));
  check("null does not throw", checkoutState(null) === "none" && !wasCheckedOut(null));

  // ⚠️ THE CASE THIS WHOLE SUITE MISSED.
  //
  // Every assertion above feeds checkoutState a RAW status. The UI never has
  // one: normalizeReservationsForArchive replaces status with lateStatusFor()
  // before a row reaches any component, so what actually arrives for an
  // uncollected late request is the LABEL. Reading it as unknown returned
  // "none" — no checkout panel, no "הוצא עכשיו", no "עריכת בקשה" — on the one
  // request whose checkout window is still open. 164 assertions passed while
  // the screen was blank.
  check("a NORMALIZED uncollected row still gets the checkout panel",
    checkoutState({ status: STATUS_NOT_PICKED_UP }) === "pending");
  check("the label with a stamp corrects itself to the return panel",
    checkoutState({ status: STATUS_NOT_PICKED_UP, issued_at: AT }) === "issued");
  check("wasCheckedOut stays false for the label without a stamp",
    !wasCheckedOut({ status: STATUS_NOT_PICKED_UP }));
  // lateStatusFor → wasCheckedOut → checkoutState is a cycle; re-normalising an
  // already-normalised row must be a fixed point or the label would oscillate.
  check("re-normalising a row already labelled לא יצא? is stable",
    lateStatusFor({ status: STATUS_NOT_PICKED_UP }) === STATUS_NOT_PICKED_UP);

  // Lessons come from the timetable and are never handed over at a counter. The
  // backfill in 20260813120000 excludes them in SQL; the UI did not, so a
  // checkout panel appeared for a loan no human is meant to process.
  check("a lesson loan gets no panel, whatever its status",
    checkoutState({ status: "מאושר", loan_type: "שיעור" }) === "none"
    && checkoutState({ status: "באיחור", loan_type: "שיעור" }) === "none");
  check("lesson_auto rows are excluded too",
    checkoutState({ status: "מאושר", lesson_auto: true }) === "none");
}

// ── 10. the window ─────────────────────────────────────────────────────────
console.log("\n\x1b[1m> checkoutWindowOpen\x1b[0m");
{
  const now = 1_770_000_000_000;
  const H = 3600_000;
  const lead = 3 * H;
  const at = (offset) => checkoutWindowOpen({ status: "מאושר", borrowTs: now + offset }, { nowMs: now, leadMs: lead });
  check("closed a day before pickup", at(24 * H) === false);
  check("closed just outside the window", at(3 * H + 1) === false);
  check("open exactly on the boundary", at(3 * H) === true);
  check("open two hours before pickup", at(2 * H) === true);
  check("open at pickup time", at(0) === true);
  // No lower bound: a student who turns up two days late must still be servable.
  check("STILL OPEN two days after pickup — the window never closes", at(-48 * H) === true);
  check("open for באיחור too — that is the never-collected case",
    checkoutWindowOpen({ status: "באיחור", borrowTs: now - 48 * H }, { nowMs: now, leadMs: lead }) === true);
  // Callers pass reservation.status, which the normalizer has already replaced
  // with the label — so the raw-only guard shut the window on exactly the row
  // the line above was written for.
  check("open for the NORMALIZED label as well",
    checkoutWindowOpen({ status: STATUS_NOT_PICKED_UP, borrowTs: now - 48 * H }, { nowMs: now, leadMs: lead }) === true);
  check("closed for a status that holds no gear",
    checkoutWindowOpen({ status: "ממתין", borrowTs: now }, { nowMs: now, leadMs: lead }) === false);
  check("a lead of 0 opens exactly at pickup time",
    checkoutWindowOpen({ status: "מאושר", borrowTs: now }, { nowMs: now, leadMs: 0 }) === true &&
    checkoutWindowOpen({ status: "מאושר", borrowTs: now + 1 }, { nowMs: now, leadMs: 0 }) === false);
  check("a missing borrow timestamp never opens the window",
    checkoutWindowOpen({ status: "מאושר" }, { nowMs: now, leadMs: lead }) === false);
  check("garbage arguments do not throw",
    checkoutWindowOpen() === false && checkoutWindowOpen({}, {}) === false);
}

// ── 11. the server gate ────────────────────────────────────────────────────
console.log("\n\x1b[1m> validateCheckoutOutcomes\x1b[0m");
{
  check("null / garbage in, null out",
    validateCheckoutOutcomes(null) === null && validateCheckoutOutcomes("x") === null &&
    validateCheckoutOutcomes([]) === null && validateCheckoutOutcomes({ items: [] }) === null);

  const clean = validateCheckoutOutcomes({
    v: 1, at: AT,
    items: [{ equipment_id: "a", name: "כבל", units: [
      { unit_id: "a_1", status: UNIT_DAMAGED, fault: "שבור", evil: "drop table" },
      { unit_id: "a_2", status: UNIT_RETURNED },
      { unit_id: "a_3", status: UNIT_ISSUED },
    ] }],
  });
  check("rebuilt key by key — stray client fields never reach the row",
    !("evil" in clean.items[0].units[0]));
  check("non-exceptional verdicts are stripped", clean.items[0].units.length === 2);
  check("a payload of only יוצא is rejected outright — nothing to store",
    validateCheckoutOutcomes({ v: 1, at: AT, items: [
      { equipment_id: "a", units: [{ unit_id: "a_1", status: UNIT_ISSUED }] }] }) === null);

  const essay = validateCheckoutOutcomes({ v: 1, at: AT, items: [
    { equipment_id: "a", units: [{ unit_id: "a_1", status: UNIT_DAMAGED, fault: "x".repeat(900) }] }] });
  check("an over-long fault is truncated, not rejected", essay.items[0].units[0].fault.length === 400);

  check("an absurd number of items is rejected outright",
    validateCheckoutOutcomes({ v: 1, at: AT, items: Array.from({ length: 400 }, (_, i) => ({
      equipment_id: `eq${i}`, units: [{ unit_id: `eq${i}_1`, status: UNIT_MISSING }] })) }) === null);
  check("an absurd number of units is rejected outright",
    validateCheckoutOutcomes({ v: 1, at: AT, items: [{ equipment_id: "a",
      units: Array.from({ length: 600 }, (_, i) => ({ unit_id: `a_${i}`, status: UNIT_MISSING })) }] }) === null);
}

// ── 12. lateStatusFor — one "באיחור" split into two problems ────────────────
console.log("\n\x1b[1m> late status\x1b[0m");
{
  const late = (status, issued_at = null) => lateStatusFor({ status, issued_at });

  check("gear that went out and is late reads באיחור",
    late("פעילה") === STATUS_OVERDUE);
  check("a באיחור row WITH a stamp reads באיחור — it really is out",
    late("באיחור", AT) === STATUS_OVERDUE);
  check("a half-written checkout (stamp, status never flipped) reads באיחור — the gear left",
    late("מאושר", AT) === STATUS_OVERDUE);

  check("an approved request nobody collected reads לא יצא?",
    late("מאושר") === STATUS_NOT_PICKED_UP);
  // The case the whole label exists for: the 5-minute cron stamps באיחור on any
  // open row past its return time WITHOUT consulting issued_at, so this row is
  // what the warehouse actually finds in the DB, and it must not read "late".
  check("a באיחור row with NO stamp reads לא יצא? — the cron never checked issued_at",
    late("באיחור") === STATUS_NOT_PICKED_UP);

  check("the two labels are different strings",
    STATUS_OVERDUE !== STATUS_NOT_PICKED_UP);
  check("the label is exactly wasCheckedOut — the badge and the panel cannot disagree",
    [["מאושר", null], ["מאושר", AT], ["באיחור", null], ["באיחור", AT], ["פעילה", null]]
      .every(([s, i]) => lateStatusFor({ status: s, issued_at: i })
        === (wasCheckedOut({ status: s, issued_at: i }) ? STATUS_OVERDUE : STATUS_NOT_PICKED_UP)));
}

// ── 13. markDraft — marks that outlive the modal ───────────────────────────
//
// The panels used to keep every mark in local useState, and they are rendered
// conditionally inside their host modal — so closing the request view (a stray
// backdrop click will do it) unmounted them and React destroyed the operator's
// work. These pin the rules that make restoring it safe.
console.log("\n\x1b[1m> markDraft: stable keys\x1b[0m");
{
  const item = (equipment_id, quantity) => ({ equipment_id, quantity, name: String(equipment_id) });

  check("one key per item, keyed by equipment id",
    JSON.stringify(markKeysFor([item("A", 1), item("B", 2)])) === JSON.stringify(["A#0", "B#0"]));
  check("two lines of the SAME equipment get distinct keys",
    JSON.stringify(markKeysFor([item("A", 1), item("A", 2)])) === JSON.stringify(["A#0", "A#1"]));

  // THE regression this key scheme exists for. Not one reservation_items select
  // in the repo carries an ORDER BY, so the nested rows can come back in a
  // different order — and a mark keyed by array position would then light up a
  // completely different piece of equipment.
  {
    const rows = [item("A", 1), item("B", 2), item("C", 3)];
    const forward = markKeysFor(rows);
    const reversed = markKeysFor([...rows].reverse());
    check("reversing the row order does not change any item's key",
      forward[0] === reversed[2] && forward[1] === reversed[1] && forward[2] === reversed[0]);
  }

  check("a row with no equipment_id falls back to a positional key",
    markKeysFor([{ quantity: 1 }])[0] === "@0");
  check("garbage in, empty array out — never a throw",
    markKeysFor(null).length === 0 && markKeysFor(undefined).length === 0);
}

console.log("\n\x1b[1m> markDraft: validating a restored mark\x1b[0m");
{
  const lines = [{ key: "A#0", qty: 3 }, { key: "B#0", qty: 1 }];

  check("an empty draft marks nothing — first open behaves exactly as before",
    visibleGreenKeys(EMPTY_DRAFT, lines).size === 0);

  const marked = withGreen(EMPTY_DRAFT, "A#0", true, 3);
  check("a mark is honoured when its line and quantity are unchanged",
    visibleGreenKeys(marked, lines).has("A#0"));

  check("a mark for equipment no longer on the request is dropped",
    visibleGreenKeys(marked, [{ key: "B#0", qty: 1 }]).size === 0);
  // A green mark asserts "all N of this line go out". For a different N the
  // operator never said that, and applying it anyway is how gear leaves
  // the building uncounted.
  check("a mark whose quantity changed under the operator is dropped",
    visibleGreenKeys(marked, [{ key: "A#0", qty: 5 }]).size === 0);

  const dupes = withGreen(EMPTY_DRAFT, "A#1", true, 2);
  const dupeLines = [{ key: "A#0", qty: 2 }, { key: "A#1", qty: 2 }];
  check("a mark on A#1 never leaks onto A#0 — duplicate lines stay separate",
    !visibleGreenKeys(dupes, dupeLines).has("A#0") && visibleGreenKeys(dupes, dupeLines).has("A#1"));

  check("countDroppedGreen reports exactly the marks visibleGreenKeys refused",
    countDroppedGreen(marked, [{ key: "A#0", qty: 5 }]) === 1
    && countDroppedGreen(marked, lines) === 0
    && countDroppedGreen(EMPTY_DRAFT, lines) === 0);
}

console.log("\n\x1b[1m> markDraft: writers are replacements, never mutations\x1b[0m");
{
  // useSyncExternalStore compares getSnapshot by identity. Mutating a draft in
  // place would leave the identity unchanged after a change and the panel would
  // silently stop re-rendering; returning a fresh object for the empty case
  // makes React throw "The result of getSnapshot should be cached".
  const a = withGreen(EMPTY_DRAFT, "A#0", true, 3);
  const b = withGreen(a, "B#0", true, 1);
  check("withGreen returns a NEW draft and leaves the input alone",
    a !== b && Object.keys(a.green).length === 1 && Object.keys(b.green).length === 2);
  check("withGreen(…, false) removes the mark",
    Object.keys(withGreen(a, "A#0", false).green).length === 0);
  check("EMPTY_DRAFT is frozen and survives being written through",
    Object.isFrozen(EMPTY_DRAFT) && Object.keys(EMPTY_DRAFT.green).length === 0);
  check("clearing the last mark collapses back to the shared EMPTY_DRAFT identity",
    withGreen(a, "A#0", false) === EMPTY_DRAFT);

  const v1 = withVerdict(EMPTY_DRAFT, "A#0", "A_1", { status: UNIT_DAMAGED });
  const v2 = withVerdict(v1, "A#0", "A_1", { fault: "כבל קרוע" });
  check("withVerdict merges the patch, keeping the field it does not mention",
    v2.verdicts["A#0|A_1"].status === UNIT_DAMAGED && v2.verdicts["A#0|A_1"].fault === "כבל קרוע");
  check("hasAnyMarks sees both kinds of mark",
    !hasAnyMarks(EMPTY_DRAFT) && hasAnyMarks(a) && hasAnyMarks(v1));

  check("checkout and return marks for one reservation never share a bucket",
    draftKey(FLOW_CHECKOUT, "123") !== draftKey(FLOW_RETURN, "123"));
  // res.id arrives as a number in the success handlers and as a string on the
  // reservation object. Without String() on both sides a completed checkout
  // would leave its marks behind.
  check("a numeric id and a string id address the same bucket",
    draftKey(FLOW_RETURN, 123) === draftKey(FLOW_RETURN, "123"));
}

console.log("\n\x1b[1m> markDraft: restoring the per-unit step\x1b[0m");
{
  const OPTS = { defaultStatus: UNIT_ISSUED, damagedStatus: UNIT_DAMAGED, allowed: CHECKOUT_OUTCOMES };
  const units = [{ id: "A_1" }, { id: "A_2" }, { id: "A_3" }];

  const fresh = mergeUnitVerdicts(EMPTY_DRAFT, "A#0", units, OPTS);
  check("no saved verdicts ⇒ every unit יוצא with an empty fault — identical to the old from-scratch seed",
    fresh.length === 3 && fresh.every(u => u.status === UNIT_ISSUED && u.fault === ""));

  let draft = withVerdict(EMPTY_DRAFT, "A#0", "A_2", { status: UNIT_DAMAGED });
  draft = withVerdict(draft, "A#0", "A_2", { fault: "מחבר שבור" });
  const restored = mergeUnitVerdicts(draft, "A#0", units, OPTS);
  check("a saved verdict comes back with its status AND its typed fault",
    restored[1].status === UNIT_DAMAGED && restored[1].fault === "מחבר שבור");
  check("the untouched units around it stay on the default",
    restored[0].status === UNIT_ISSUED && restored[2].status === UNIT_ISSUED);

  // Closing the detail overlay and reopening it is exactly two merges over the
  // same draft — this is the reported bug, one level in.
  check("typed fault text survives closing and reopening the detail overlay",
    JSON.stringify(mergeUnitVerdicts(draft, "A#0", units, OPTS)) === JSON.stringify(restored));

  const moved = withVerdict(draft, "A#0", "A_2", { status: UNIT_RETURNED });
  check("fault is dropped when the restored status is no longer פגום",
    mergeUnitVerdicts(moved, "A#0", units, OPTS)[1].fault === "");

  // Mapping over the REBUILT list is the pruning — there is no pruning code.
  check("a unit the picker no longer offers is dropped, never resurrected",
    mergeUnitVerdicts(draft, "A#0", [{ id: "A_1" }, { id: "A_3" }], OPTS)
      .every(u => u.status === UNIT_ISSUED)
    && mergeUnitVerdicts(draft, "A#0", [{ id: "A_1" }, { id: "A_3" }], OPTS).length === 2);
  check("the replacement unit offered instead is seeded to the default, not the dropped verdict",
    mergeUnitVerdicts(draft, "A#0", [{ id: "A_1" }, { id: "A_4" }], OPTS)[1].status === UNIT_ISSUED);

  check("a saved status that is illegal for this flow falls back to the default",
    mergeUnitVerdicts(withVerdict(EMPTY_DRAFT, "A#0", "A_1", { status: "תקין" }), "A#0", units, OPTS)[0]
      .status === UNIT_ISSUED);

  const twoLines = withVerdict(
    withVerdict(EMPTY_DRAFT, "A#0", "A_1", { status: UNIT_DAMAGED }),
    "A#1", "A_1", { status: UNIT_MISSING });
  check("duplicate lines keep separate verdicts for the same unit id",
    mergeUnitVerdicts(twoLines, "A#0", [{ id: "A_1" }], OPTS)[0].status === UNIT_DAMAGED
    && mergeUnitVerdicts(twoLines, "A#1", [{ id: "A_1" }], OPTS)[0].status === UNIT_MISSING);
}

console.log("\n\x1b[1m> markDraft: the derived outcomes are unchanged\x1b[0m");
{
  // Mirrors what the panel does: green cards contribute nothing, the rest are
  // merged onto a freshly picked unit list. Only MARKS are stored — the outcomes
  // are still derived at confirm time, which is what keeps the retry idempotent.
  const OPTS = { defaultStatus: UNIT_ISSUED, damagedStatus: UNIT_DAMAGED, allowed: CHECKOUT_OUTCOMES };
  const seed = [{ equipment_id: "1776079954421", name: "כבל XLR", quantity: 3 }];
  const eq = xlr();
  const keys = markKeysFor(seed);

  const deriveOutcomes = (draft) => {
    const green = visibleGreenKeys(draft, seed.map((it, i) => ({ key: keys[i], qty: it.quantity })));
    return seed.flatMap((it, i) => green.has(keys[i]) ? [] :
      mergeUnitVerdicts(draft, keys[i], pickUnitsForCheckout(eq, it.quantity), OPTS)
        .map(u => ({ equipmentId: eq.id, unitId: u.id, status: u.status, fault: u.fault })));
  };

  check("a card marked green contributes no rows, and therefore no outcomes",
    deriveOutcomes(withGreen(EMPTY_DRAFT, keys[0], true, 3)).length === 0);
  check("with an empty draft the outcomes match a from-scratch seed exactly",
    JSON.stringify(deriveOutcomes(EMPTY_DRAFT)) === JSON.stringify(
      pickUnitsForCheckout(eq, 3).map(u => ({ equipmentId: eq.id, unitId: u.id, status: UNIT_ISSUED, fault: "" }))));

  // The one that matters most: a draft-restored החזר must produce the same
  // absolute target list every time, or a retry shrinks the request twice.
  const returned = withVerdict(EMPTY_DRAFT, keys[0], "1776079954421_1", { status: UNIT_RETURNED });
  const first = computeCheckoutItems(seed, deriveOutcomes(returned));
  const second = computeCheckoutItems(seed, deriveOutcomes(returned));
  check("re-deriving a restored החזר yields a byte-identical item list — no double decrement",
    JSON.stringify(first) === JSON.stringify(second) && first[0].quantity === 2);
}

// ── 14. module hygiene + the derivation is really gone ─────────────────────
console.log("\n\x1b[1m> module hygiene\x1b[0m");
{
  const { readFileSync } = await import("node:fs");

  const src = readFileSync(new URL("../src/utils/checkoutFlow.js", import.meta.url), "utf8");
  const imports = [...src.matchAll(/^\s*import\s[\s\S]*?from\s+["']([^"']+)["']/gm)].map(m => m[1]);
  check("checkoutFlow.js imports only returnFlow.js — it must run under plain Node",
    imports.length === 1 && imports[0] === "./returnFlow.js", imports.join(", "));

  // The point of the whole feature: "פעילה" must no longer be conjured from a
  // clock. Comments are stripped first — the documentation explaining what was
  // removed must not trip the guard that enforces the removal.
  const utils = readFileSync(new URL("../src/utils.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const slice = (marker) => {
    const from = utils.slice(utils.indexOf(marker));
    return from.slice(0, from.indexOf("\n}") + 2);
  };
  const body = slice("export function getEffectiveStatus");
  check("getEffectiveStatus no longer returns \"פעילה\" — checkout is the only way in",
    !/return\s+"פעילה"/.test(body), body.trim());
  // It must still notice lateness itself — the cron is not allowed to be the first
  // to know — but WHICH late label it picks is lateStatusFor's job now, so that the
  // badge, the panel and the archive normalizer can never drift apart (lesson #19).
  check("getEffectiveStatus delegates the late label to lateStatusFor",
    /return\s+lateStatusFor\(/.test(body), body.trim());
  check("getEffectiveStatus hardcodes neither late label",
    !/return\s+"באיחור"/.test(body) && !/return\s+"לא יצא\?"/.test(body), body.trim());
  check("getEffectiveStatus still treats a real פעילה row as escalatable",
    /LATE_CANDIDATE_STATUSES/.test(body) && /"פעילה"/.test(utils.slice(utils.indexOf("const LATE_CANDIDATE_STATUSES"), utils.indexOf("const LATE_CANDIDATE_STATUSES") + 200)));

  // ⚠️ THE LOAD-BEARING HALF OF THE WHOLE LABEL.
  //
  // "לא יצא?" exists only in the browser; the row underneath is still מאושר/באיחור
  // and create_reservation_v2 still counts it. If the availability maths stops
  // counting it, the failure is silent and one-sided — the form shows stock as
  // free, the student submits, and the RPC answers 409 with nothing to explain it.
  check("INVENTORY_BLOCKING_STATUSES counts \"לא יצא?\" as holding stock",
    /export const INVENTORY_BLOCKING_STATUSES[^\n]*STATUS_NOT_PICKED_UP/.test(utils));
  check("the 48h overdue grace window covers both late labels",
    /export function isOverdueLikeStatus[\s\S]{0,200}STATUS_NOT_PICKED_UP/.test(utils));
  const avail = slice("export function computeEquipmentAvailability");
  check("computeEquipmentAvailability gates on the shared list, not its own literal",
    /INVENTORY_BLOCKING_STATUSES\.includes/.test(avail) && !/\["מאושר","פעילה","באיחור"\]/.test(avail), avail.trim());
  check("computeEquipmentAvailability picks the buffer via isOverdueLikeStatus",
    /isOverdueLikeStatus\(/.test(avail) && !/===\s*"באיחור"/.test(avail), avail.trim());

  // The pair from lesson #19: two copies of the normalizer that must derive the
  // same thing. App.jsx keeps its own, so both have to call the same helper.
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("App.jsx's normalizeReservationsForArchive uses lateStatusFor too",
    /status:\s*lateStatusFor\(/.test(app));
  check("neither normalizer hardcodes \"באיחור\" as the escalation target",
    !/status:\s*"באיחור"/.test(app) && !/status:\s*"באיחור"/.test(utils));
}

// ── 15. the in-flight freeze on both per-unit overlays ─────────────────────
//
// Static, because the bug is a render-time re-derivation and this repo has no
// DOM test harness — and because what needs pinning is the SHAPE of the code.
// The failure was invisible in every pure test: the outcomes array was always
// correct, the write always landed, and the archive always showed the right
// thing. Only the screen lied, for the length of one HTTP request, at the exact
// moment the operator could no longer do anything about it.
//
// Both flows call setEquipment optimistically BEFORE their round trip, so a unit
// just marked פגום/נעלם stops being תקין and drops out of the picker; the row
// re-derives onto different hardware at the default verdict. Freezing the rows
// while `busy` is what stops the operator watching their own mark undo itself.
console.log("\n\x1b[1m> in-flight freeze (checkout + return overlays)\x1b[0m");
{
  const { readFileSync } = await import("node:fs");
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  for (const [label, file] of [
    ["checkout", "../src/components/CheckoutEquipmentPanel.jsx"],
    ["return",   "../src/components/ReturnEquipmentPanel.jsx"],
  ]) {
    const src = strip(readFileSync(new URL(file, import.meta.url), "utf8"));

    // The memo must not BE detailRows any more — if it is, nothing is frozen.
    check(`${label}: the per-unit memo is named liveDetailRows, not detailRows`,
      /const liveDetailRows = useMemo\(/.test(src) && !/const detailRows = useMemo\(/.test(src));

    // The freeze itself, and that it is gated on busy rather than unconditional
    // (an unconditional hold would strand the retry on a stale unit list).
    check(`${label}: detailRows falls back to the submitted rows while busy`,
      /const detailRows = busy && submittedRows \? submittedRows : liveDetailRows/.test(src));

    // Captured in the click handler. Doing it during render would make the
    // component impure — the react-compiler lint says so out loud — and an
    // event is the honest place to record "what was on screen when they pressed".
    check(`${label}: the snapshot is taken in the commit handler, before onComplete`,
      /onClick=\{\(\) => \{ setSubmittedRows\(detailRows\); onComplete\(outcomes\); \}\}/.test(src));

    // No refs in this file: the earlier attempt at the freeze used one during
    // render, and this is what stops it coming back.
    check(`${label}: no useRef — the snapshot is state, not a render-time ref`,
      !/\buseRef\b/.test(src));

    // outcomes must still be read off detailRows — reading it off the live memo
    // would submit units the operator never saw.
    check(`${label}: outcomes is derived from detailRows, not from liveDetailRows`,
      /outcomes = useMemo\(\(\) => detailRows\.flatMap/.test(src));
  }

  // ── the two flows must never wear the same colour ────────────────────────
  //
  // The panels are near-identical in shape — same cards, same tap-to-mark, same
  // per-unit overlay — so colour is the only thing telling an operator at a
  // glance whether they are handing gear OUT or taking it BACK. Both marked
  // state green, and they were mistaken for each other in real use.
  //
  // The rule: BLUE = the gear is at the warehouse, GREEN = it is out.
  check("marked-state colours differ between the two flows",
    CHECKOUT_COLOR[UNIT_ISSUED] !== OUTCOME_COLOR[UNIT_OK],
    `${CHECKOUT_COLOR[UNIT_ISSUED]} vs ${OUTCOME_COLOR[UNIT_OK]}`);
  check("checkout's יוצא is green — gear leaving the building",
    CHECKOUT_COLOR[UNIT_ISSUED] === "var(--green)", CHECKOUT_COLOR[UNIT_ISSUED]);
  check("return's תקין is blue — gear back on the shelf",
    OUTCOME_COLOR[UNIT_OK] === "var(--blue)", OUTCOME_COLOR[UNIT_OK]);
  check("checkout's החזר is blue too — it never left, same meaning as תקין",
    CHECKOUT_COLOR[UNIT_RETURNED] === "var(--blue)", CHECKOUT_COLOR[UNIT_RETURNED]);
  {
    const { readFileSync } = await import("node:fs");
    const ret = strip(readFileSync(new URL("../src/components/ReturnEquipmentPanel.jsx", import.meta.url), "utf8"));
    // greenKeys/allGreen/toggleWarehouseGreen are the STORE's vocabulary and are
    // pinned by markDraft's tests — only the painted values must be free of it.
    check("no green paint left on the return panel",
      !/var\(--green\)/.test(ret) && !/46,\s*204,\s*113/.test(ret));
    check("the return card's prop is `marked`, not a colour name",
      /function ItemCard\(\{ eq, item, marked, onToggle \}\)/.test(ret));
  }

  // ── the shared status lists, not scattered literals ──────────────────────
  //
  // Both regressions below were the same mistake: a status list spelled out
  // inline, which then silently fell behind when the set grew. Pinning the
  // SHAPE is the only thing that stops the next copy appearing.
  {
    const { readFileSync } = await import("node:fs");
    const read = (p) => strip(readFileSync(new URL(p, import.meta.url), "utf8"));

    const res  = read("../src/components/ReservationsPage.jsx");
    const dash = read("../src/components/DashboardPage.jsx");
    check("both עריכת בקשה gates use STAFF_EDITABLE_STATUSES",
      (res.match(/STAFF_EDITABLE_STATUSES\.includes/g) || []).length === 2
      && /STAFF_EDITABLE_STATUSES\.includes\(dashViewRes\.status\)/.test(dash));
    check("no inline copy of the edit-status list survives",
      !/status===?"ממתין"\s*\|\|\s*\w*\.?status===?"מאושר"/.test(res)
      && !/\["ממתין","מאושר","פעילה","נדחה","באיחור"\]/.test(dash));

    // The dashboard tile that lost every checked-out loan due back today.
    check("allApproved counts through INVENTORY_BLOCKING_STATUSES",
      /allApproved = reservations\.filter\(r => INVENTORY_BLOCKING_STATUSES\.includes\(r\.status\)\)/.test(dash));

    // The student-facing bot is an inventory surface and must agree with
    // computeEquipmentAvailability exactly — it reported gear as available
    // while it was in a student's bag.
    const bot = read("../src/components/AIChatBot.jsx");
    check("AIChatBot derives its active set from INVENTORY_BLOCKING_STATUSES",
      /ACTIVE_RESERVATION_STATUSES = new Set\(\[\s*\.\.\.INVENTORY_BLOCKING_STATUSES/.test(bot));
    check("AIChatBot no longer hardcodes Hebrew statuses",
      !/'מאושר'/.test(bot) && !/'באיחור'/.test(bot) && !/'פעילה'/.test(bot));
  }

  // ── staff button affordances ─────────────────────────────────────────────
  {
    const { readFileSync } = await import("node:fs");
    const read = (p) => strip(readFileSync(new URL(p, import.meta.url), "utf8"));
    const res  = read("../src/components/ReservationsPage.jsx");
    const dash = read("../src/components/DashboardPage.jsx");

    // One button, three screens — it must not be amber on two of them. Solid
    // .btn-primary (var(--accent) fill, dark text), matching "השאלת איש צוות";
    // the tinted .btn-yellow was tried first and read as too faint on screen.
    // Line-based: the onClick arrows contain ">" so an attribute-spanning
    // regex silently under-counts.
    const NL = String.fromCharCode(10);
    const amberEdits = [...res.split(NL), ...dash.split(NL)]
      .filter(l => /btn btn-primary/.test(l) && /עריכת/.test(l)).length;
    check("all three עריכת בקשה buttons are solid btn-primary", amberEdits === 3, String(amberEdits));
    check("no עריכת בקשה button was left btn-secondary or btn-yellow",
      !/btn btn-secondary[^"]*"[^>]*>\s*(<Pencil|✏️)/.test(res)
      && !/btn btn-secondary" title="עריכת/.test(dash)
      && !/btn-yellow/.test(res) && !/btn-yellow/.test(dash));
    check("the ✏️ emoji variant is gone — same button, same icon", !/✏️ עריכת בקשה/.test(res));

    // ⚠️ RTL: the row paints right-to-left, so DOM order after WhatsApp is the
    // ONLY thing putting delete on its left. Swapping them looks like a no-op
    // in the diff and moves the button across the row.
    const waIdx  = dash.indexOf("<WhatsAppLinkButton");
    const delIdx = dash.indexOf("deleteNotPickedUp(dashViewRes)");
    check("the dashboard delete button renders AFTER WhatsApp (⇒ left of it in RTL)",
      waIdx !== -1 && delIdx !== -1 && delIdx > waIdx);
    // "לא יצא?" is never stored, so a raw-status gate would never fire — but the
    // effective status alone is no longer enough either. The badge now appears
    // half an hour after the PICKUP slot, and this is a hard delete with no undo
    // (lesson #47), so it must stay behind the RETURN deadline that
    // mayDeleteNotPickedUp adds. A bare label gate here would let staff destroy
    // a live loan whose student is simply running late.
    check("delete is gated on mayDeleteNotPickedUp, not the bare label",
      /mayDeleteNotPickedUp\(dashViewRes\)/.test(dash));
    check("…and the bare-label gate is gone from the delete button",
      !/getEffectiveStatus\(dashViewRes\)===STATUS_NOT_PICKED_UP&&/.test(dash));
    check("delete guards the row against a mid-flight refetch",
      /markReservationDeleting\(id\)/.test(dash) && /unmarkReservationDeleting\(id, 0\)/.test(dash));
  }

  // The two warehouse panels are mirror images and drifted apart once already
  // (lesson #55). Their quiet control must stay byte-identical.
  {
    const { readFileSync } = await import("node:fs");
    const grab = (p) => {
      const src = readFileSync(new URL(p, import.meta.url), "utf8");
      const m = src.match(/style=\{\{ background: "transparent"[^}]*\}\}/);
      return m ? m[0] : null;
    };
    const co = grab("../src/components/CheckoutEquipmentPanel.jsx");
    const rt = grab("../src/components/ReturnEquipmentPanel.jsx");
    check("נקה סימונים is styled identically in both panels", co !== null && co === rt, `${co}\n${rt}`);
    // It erases work the operator did, so it must never outrank the primary.
    check("נקה סימונים stays quieter than the primary action",
      co !== null && /border: "1px solid var\(--border\)"/.test(co) && !/fontWeight: 800/.test(co));
  }

  // The other half of the story: the optimistic write is what makes the freeze
  // necessary, so pin that it really is optimistic (setEquipment BEFORE await).
  // If someone ever makes these pessimistic the freeze becomes dead weight, and
  // this test is where they will find out.
  for (const [label, file] of [
    ["checkoutApi", "../src/utils/checkoutApi.js"],
    ["returnApi",   "../src/utils/returnApi.js"],
  ]) {
    const src = strip(readFileSync(new URL(file, import.meta.url), "utf8"));
    const setEq = src.indexOf("setEquipment(next)");
    const write = src.indexOf("await writeEquipmentToDB");
    check(`${label}: setEquipment(next) still runs before writeEquipmentToDB`,
      setEq !== -1 && write !== -1 && setEq < write);
  }
}


// ── The "הוצא עכשיו" override is gone, and must stay gone ──────────────────
//
// It rendered on checkoutState === "pending" with NO time check at all, and set
// forceCheckoutId, which bypassed checkoutWindowOpen entirely. Gear could leave
// days before borrow_date — and because computeEquipmentAvailability AND
// create_reservation_v2 both derive their blocking window from borrow_date and
// never from issued_at, that gear read as AVAILABLE for the whole time it sat in
// a student's bag. Neither layer catches it, which is why the button had to go
// rather than be time-limited. A student who turns up early is served by moving
// the pickup time in עריכת בקשה — that fixes the availability window too.
console.log("\n\x1b[1m> checkout override removed (static)\x1b[0m");
{
  const { readFileSync } = await import("node:fs");
  // The comments explaining the removal legitimately name the button. Scanning
  // raw text would make this guard fail on its own documentation.
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const [label, file] of [
    ["ReservationsPage", "../src/components/ReservationsPage.jsx"],
    ["DashboardPage",    "../src/components/DashboardPage.jsx"],
  ]) {
    const src = strip(readFileSync(new URL(file, import.meta.url), "utf8"));
    check(`${label}: no "הוצא עכשיו" button`, !src.includes("הוצא עכשיו"));
    check(`${label}: no forceCheckoutId state left`, !/[Ff]orceCheckoutId/.test(src));
    check(`${label}: checkoutWindowOpen is still the gate`, src.includes("checkoutWindowOpen("));
    // half_issued sat inside the same || as the override — trivially deleted
    // along with it, and that would strip the mid-write recovery screen.
    check(`${label}: half_issued still bypasses the window`, src.includes("half_issued"));
  }
  const settings = strip(readFileSync(new URL("../src/components/SystemSettingsPage.jsx", import.meta.url), "utf8"));
  // 72h = 3 days would reopen the same hole through the settings back door, so
  // the visual cap and the commit clamp must BOTH be 12 — they disagreed once.
  //
  // Scoped to the checkoutLeadHours field rather than searched across the whole
  // file: there is now a SECOND numeric field in the same card, so a bare
  // includes("max={12}") would be satisfied by any unrelated input and this
  // guard would quietly stop guarding anything.
  const leadIdx = settings.indexOf("checkoutLeadHours");
  const leadBlock = settings.slice(
    settings.lastIndexOf("<input", leadIdx),
    settings.indexOf("/>", leadIdx) + 2,
  );
  check("settings: lead-hours input caps at 12", /max=\{12\}/.test(leadBlock));
  check("settings: commitNumber clamps that same field to 12",
    /commitNumber\("checkout",\s*"checkoutLeadHours"[^)]*max:\s*12/.test(leadBlock));
  check("settings: no 72-hour ceiling left", !/max=\{72\}/.test(settings) && !/max:\s*72/.test(settings));
  check("settings: copy no longer advertises the button", !settings.includes("הוצא עכשיו"));
}


console.log("\n\x1b[1m> staff may correct a live loan (static)\x1b[0m");
{
  const { readFileSync } = await import("node:fs");
  // Comments here name the very things that must not come back, so the scan
  // runs over comment-stripped source — same rule as the section above.
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const modal = strip(readFileSync(new URL("../src/components/EditReservationModal.jsx", import.meta.url), "utf8"));

  // PR #118 promoted "פעילה" to a real status, which switched this modal into a
  // mode that pinned every quantity to original_items — so a warehouse worker
  // who handed over an item and forgot to record it could not add it afterwards.
  check("edit: the quantity ceiling is availability, in every status",
    /const ceiling = getAvail\(eqId\);/.test(modal));
  check("edit: no originalQtyFor ceiling left anywhere",
    !/originalQtyFor/.test(modal));
  check("edit: the + button is capped by availability alone",
    /disabled=\{remaining<=0\}/.test(modal));
  check("edit: the item pool is the full catalogue, not the loan's own rows",
    /catalogueEq\.filter\(/.test(modal) && !/overdueEqItems/.test(modal));
  check("edit: gear deleted from the catalogue is still renderable",
    /const catalogueEq = /.test(modal) && /orphans/.test(modal));
  check("edit: availability is really computed once the gear is out",
    !/available:\s*0,\s*usedByOthers:\s*0/.test(modal));

  // The archive reads original_items ?? items, so without a re-stamp a
  // correction would show up everywhere EXCEPT the finished record.
  const save = modal.slice(modal.indexOf("const save = async"), modal.indexOf("setSaving(true)"));
  check("edit: a staff save re-stamps original_items from the saved list",
    /updatedReservation\.original_items = items\.map/.test(save));
  check("edit: …unconditionally, not only when the stamp is missing",
    /if \(isOverdueReservation \|\| wasCheckedOut\(reservation\)\) \{\s*updatedReservation\.original_items/.test(save));
  // half_issued: a checkout whose write died after stamping issued_at but before
  // the status flip leaves issued_at set with status still "מאושר". The gear is
  // out, so an edit must reach the archive — the two-status test alone cannot see
  // that row. Additive only: everything that stamped before still stamps.
  check("edit: a half-written checkout still re-stamps — the gear IS out",
    /wasCheckedOut\(reservation\)/.test(save));
  check("edit: isOverdueReservation itself was NOT widened — it also drives the UI",
    /const isOverdueReservation = reservation\.status==="באיחור" \|\| reservation\.status==="פעילה";/.test(modal));
  check("edit: the over-booking gate still runs for מאושר and for gear that is out",
    /getReservationApprovalConflicts\(updatedReservation, reservations, equipment\)/.test(save)
    && /reservation\.status === "מאושר" \|\| isOverdueReservation/.test(save));

  // The relaxation above is scoped to THIS path. These two are what keep
  // lesson #35+#44 alive everywhere else, and they must not follow suit.
  const checkoutApi = strip(readFileSync(new URL("../src/utils/checkoutApi.js", import.meta.url), "utf8"));
  check("checkout still stamps original_items once and never overwrites",
    /alreadyStamped \? \{\} : \{ original_items/.test(checkoutApi));
  const returnApi = strip(readFileSync(new URL("../src/utils/returnApi.js", import.meta.url), "utf8"));
  check("the return flow still never writes original_items",
    !/original_items/.test(returnApi));
  check("…nor reservation_items — it only moves units and status",
    !/reservation_items/.test(returnApi));
}

// ── the pickup trigger — "לא יצא?" no longer waits for the return deadline ──
console.log("\n\x1b[1m> pickupOverdue\x1b[0m");
{
  const now = 1_770_000_000_000;
  const MIN = 60_000;
  // Always inject graceMs here: these assertions must not depend on whatever
  // the module-level register happens to hold when this block runs.
  const at = (offset, graceMs = 30 * MIN) =>
    pickupOverdue({ borrowTs: now - offset, nowMs: now, graceMs });

  check("not yet — pickup was five minutes ago", at(5 * MIN) === false);
  check("not yet — one millisecond short of the grace", at(30 * MIN - 1) === false);
  check("fires exactly on the grace boundary", at(30 * MIN) === true);
  check("fires an hour after pickup", at(60 * MIN) === true);
  // The old rule waited for the return deadline; a week-long loan meant a
  // week-late alert. Distance past pickup is now the only thing that matters.
  check("still fires a week after pickup", at(7 * 24 * 60 * MIN) === true);
  check("never fires before the pickup moment", at(-1 * MIN) === false);
  check("a grace of 0 fires exactly at the pickup moment",
    pickupOverdue({ borrowTs: now, nowMs: now, graceMs: 0 }) === true &&
    pickupOverdue({ borrowTs: now + 1, nowMs: now, graceMs: 0 }) === false);
  check("a missing pickup timestamp never fires",
    pickupOverdue({ nowMs: now, graceMs: 0 }) === false &&
    pickupOverdue({ borrowTs: 0, nowMs: now, graceMs: 0 }) === false);
  check("garbage arguments do not throw",
    pickupOverdue() === false && pickupOverdue({}, {}) === false &&
    pickupOverdue({ borrowTs: "x", nowMs: now }) === false);
  check("a non-finite graceMs falls back to the register, it does not become NaN",
    pickupOverdue({ borrowTs: now - 60 * MIN, nowMs: now, graceMs: NaN }) === true);
}

console.log("\n\x1b[1m> the grace register\x1b[0m");
{
  const MIN = 60_000;
  check("ships at 30 minutes", DEFAULT_NOT_PICKED_UP_GRACE_MIN === 30);
  check("the register starts at the default",
    getNotPickedUpGraceMs() === DEFAULT_NOT_PICKED_UP_GRACE_MIN * MIN);

  check("the setter reports and stores the value it applied",
    setNotPickedUpGraceMinutes(45) === 45 && getNotPickedUpGraceMs() === 45 * MIN);
  // The settings field and this clamp must agree — they disagreed once for
  // checkoutLeadHours, and typing past the spinner is not blocked by the browser.
  check("clamps above the ceiling", setNotPickedUpGraceMinutes(9999) === MAX_NOT_PICKED_UP_GRACE_MIN);
  check("clamps below zero", setNotPickedUpGraceMinutes(-5) === 0);
  check("0 is a legal setting — the badge appears at the pickup moment",
    setNotPickedUpGraceMinutes(0) === 0 && getNotPickedUpGraceMs() === 0);
  check("garbage falls back to the default rather than poisoning every badge",
    setNotPickedUpGraceMinutes("abc") === DEFAULT_NOT_PICKED_UP_GRACE_MIN &&
    setNotPickedUpGraceMinutes(undefined) === DEFAULT_NOT_PICKED_UP_GRACE_MIN &&
    setNotPickedUpGraceMinutes(null) === 0);

  setNotPickedUpGraceMinutes(10);
  check("pickupOverdue reads the register when no override is passed",
    pickupOverdue({ borrowTs: 1000 * MIN, nowMs: 1010 * MIN }) === true &&
    pickupOverdue({ borrowTs: 1000 * MIN, nowMs: 1009 * MIN }) === false);
  check("an explicit graceMs still wins over the register",
    pickupOverdue({ borrowTs: 1000 * MIN, nowMs: 1010 * MIN, graceMs: 60 * MIN }) === false);

  setNotPickedUpGraceMinutes(DEFAULT_NOT_PICKED_UP_GRACE_MIN);
  check("restored to the default for the rest of the suite",
    getNotPickedUpGraceMs() === DEFAULT_NOT_PICKED_UP_GRACE_MIN * MIN);
}

// The earlier trigger must not disturb the fold. checkoutState and
// checkoutWindowOpen both treat "לא יצא?" as באיחור, and their safety argument
// is that the label is only ever emitted when issued_at IS NULL. Branch A keeps
// that true — it is gated on !wasCheckedOut — so re-pinning it here is what
// catches a future edit that drops the gate.
console.log("\n\x1b[1m> the fold survives the earlier trigger\x1b[0m");
{
  const now = 1_770_000_000_000;
  const H = 3600_000;
  check("a row labelled at pickup time still gets the checkout panel",
    checkoutState({ status: STATUS_NOT_PICKED_UP }) === "pending");
  check("…and its checkout window is still open",
    checkoutWindowOpen({ status: STATUS_NOT_PICKED_UP, borrowTs: now - 1 * H },
      { nowMs: now, leadMs: 3 * H }) === true);
  check("…and staff may still edit it",
    checkoutState({ status: STATUS_NOT_PICKED_UP }) !== "none");
  check("the label is still a fixed point",
    lateStatusFor({ status: STATUS_NOT_PICKED_UP }) === STATUS_NOT_PICKED_UP);
  // Branch A is gated on !wasCheckedOut, so a handed-over loan can never take
  // the pickup trigger however long ago its pickup slot was.
  check("a loan that DID go out is never a pickup problem",
    wasCheckedOut({ status: "פעילה" }) &&
    wasCheckedOut({ status: "מאושר", issued_at: AT }) &&
    wasCheckedOut({ status: "פעילה", issued_at: AT }));
  check("lateStatusFor still calls a handed-over loan באיחור, not לא יצא?",
    lateStatusFor({ status: "פעילה" }) === STATUS_OVERDUE &&
    lateStatusFor({ status: "מאושר", issued_at: AT }) === STATUS_OVERDUE);
}

// src/utils.js cannot be imported under Node — it pulls in the Supabase client —
// so the wiring is pinned by reading the source. Comments are stripped first:
// they name the very things these guards forbid.
console.log("\n\x1b[1m> the pickup trigger is wired (static)\x1b[0m");
{
  const { readFileSync } = await import("node:fs");
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const read = p => strip(readFileSync(new URL(p, import.meta.url), "utf8"));

  const utils = read("../src/utils.js");
  const app = read("../src/App.jsx");

  // ONE implementation, three callers. This pair of normalizers has already
  // drifted once (the "צוות" early-return utils.js has and App.jsx does not),
  // and lesson #19 is what that costs — so the new rule gets no second copy to
  // drift with. If either normalizer ever inlines its own version, the count of
  // pickupOverdue callers outside the helper is what catches it.
  check("pickupNeverHappened exists and is exported once",
    (utils.match(/export function pickupNeverHappened/g) || []).length === 1);
  check("getEffectiveStatus calls it", /pickupNeverHappened\(r\)/.test(utils));
  check("the utils.js normalizer calls it",
    /pickupNeverHappened\(normalizedReservation, nowMs\)/.test(utils));
  check("the App.jsx normalizer calls the SAME helper, imported not re-implemented",
    /pickupNeverHappened\(normalizedReservation, nowMs\)/.test(app)
    && !/function pickupNeverHappened/.test(app));
  check("no second call to pickupOverdue outside the one helper",
    (utils.match(/pickupOverdue\(/g) || []).length === 1
    && !/pickupOverdue\(/.test(app));

  // The gate is what keeps checkoutState's fold safe by construction: the label
  // is only ever emitted while the gear is still on the shelf. Drop it and a
  // handed-over loan starts reading "לא יצא?".
  const helper = (() => {
    const from = utils.slice(utils.indexOf("export function pickupNeverHappened"));
    return from.slice(0, from.indexOf("\n}") + 2);
  })();
  check("pickupNeverHappened is gated on wasCheckedOut, not on issued_at directly",
    /wasCheckedOut\(reservation\)/.test(helper) && !/issued_at/.test(helper), helper.trim());
  check("…and excludes lessons, as checkoutState and the migration both do",
    /"שיעור"/.test(helper) && /lesson_auto/.test(helper), helper.trim());
  check("…and reads the PICKUP fields, not the return ones",
    /borrow_date/.test(helper) && /borrow_time/.test(helper)
    && !/return_date/.test(helper), helper.trim());

  // ⚠️ THE INVENTORY REGRESSION THIS FEATURE COULD CAUSE.
  //
  // The 48h buffer is a grace AFTER the return moment. Now that the label fires
  // at pickup time it lands on rows whose return moment has not arrived and
  // whose raw status create_reservation_v2 reads as a plain "מאושר" — so
  // granting them the buffer would withhold 48h of stock the DB considers free,
  // with no 409 to explain it. The nowMs test is what stops that.
  check("the 48h buffer is gated on the return moment having passed",
    /isOverdueLikeStatus\(effStatus\)\s*&&\s*nowMs\s*>=\s*endTs/.test(utils));
  check("computeEquipmentAvailability accepts an injectable nowMs",
    /computeEquipmentAvailability\([^)]*nowMs = Date\.now\(\)/.test(utils));
  check("the label still blocks its own window — it stayed in the shared list",
    /INVENTORY_BLOCKING_STATUSES\s*=\s*\[[^\]]*STATUS_NOT_PICKED_UP/.test(utils));

  // Hard delete, no undo (lesson #47): the badge may appear at pickup+grace, the
  // delete button may not.
  const del = (() => {
    const from = utils.slice(utils.indexOf("export function mayDeleteNotPickedUp"));
    return from.slice(0, from.indexOf("\n}") + 2);
  })();
  check("mayDeleteNotPickedUp requires the return deadline as well as the label",
    /STATUS_NOT_PICKED_UP/.test(del) && /getReservationReturnTimestamp/.test(del), del.trim());

  // The student is not the audience. Folded at the display so every staff
  // surface, the inventory maths and the archive keep the one derivation.
  const form = read("../src/components/PublicForm.jsx");
  check("the student portal folds the label away",
    /derivedStatus === STATUS_NOT_PICKED_UP \? "מאושר"/.test(form));
  check("…and folds to a literal, not back to r.status which IS the label",
    !/derivedStatus === STATUS_NOT_PICKED_UP \? \(?r\.status/.test(form));

  // ⚠️ NEGATIVE GUARD — this feature must not leak into the cron.
  //
  // check-overdue.js WRITES "באיחור" to the DB. Deriving it from borrow_date
  // would stamp a real status on every loan the warehouse is half an hour behind
  // on, and that status IS what the RPCs count.
  const cron = read("../api/check-overdue.js");
  check("the overdue cron still derives only from return_date",
    /toDateTime\(r\.return_date/.test(cron) && !/toDateTime\(r\.borrow_date/.test(cron));
  check("the cron writes no display label",
    !cron.includes("לא יצא?") && !/pickupOverdue|pickupNeverHappened/.test(cron));

  // The field and the clamp disagreed once for checkoutLeadHours; the new field
  // must not repeat it, and 240 has to match MAX_NOT_PICKED_UP_GRACE_MIN.
  const settings = read("../src/components/SystemSettingsPage.jsx");
  const graceIdx = settings.indexOf("notPickedUpGraceMinutes");
  const graceBlock = settings.slice(
    settings.lastIndexOf("<input", graceIdx),
    settings.indexOf("/>", graceIdx) + 2,
  );
  check("the grace field caps at 240 in the input", /max=\{240\}/.test(graceBlock));
  check("…and commitNumber clamps the same field to 240",
    /commitNumber\("checkout",\s*"notPickedUpGraceMinutes"[^)]*max:\s*240/.test(graceBlock));
  check("…and the ceiling matches the module constant",
    MAX_NOT_PICKED_UP_GRACE_MIN === 240);
  check("…and the default matches too",
    /fallback:\s*30/.test(graceBlock) && DEFAULT_NOT_PICKED_UP_GRACE_MIN === 30);

  // Written during render, deliberately: an effect would leave the rows on
  // screen normalised with the previous value and nothing would re-render.
  check("App.jsx keeps the register in step with the setting",
    /setNotPickedUpGraceMinutes\(siteSettings\?\.notPickedUpGraceMinutes/.test(app));
  check("…outside any useEffect",
    !/useEffect\([^)]*setNotPickedUpGraceMinutes/.test(app));
}


console.log("");
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1mOK ${passed}/${passed} checkout-flow tests passed\x1b[0m`);
  process.exit(0);
}
console.log(`\x1b[31m\x1b[1mFAIL ${passed} passed, ${failed} failed\x1b[0m`);
process.exit(1);
