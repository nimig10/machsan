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
//
// No network, no DB. Exit 0 = all passed.

import {
  UNIT_OK, UNIT_DAMAGED, UNIT_MISSING, UNIT_ISSUED, UNIT_RETURNED,
  CHECKOUT_OUTCOMES, CHECKOUT_EXCEPTIONS,
  checkoutSeedItems, pickUnitsForCheckout, applyCheckoutOutcomes,
  computeCheckoutItems, summarizeCheckout, describeCheckoutExceptions,
  buildCheckoutOutcomesSnapshot, readCheckoutOutcomes, recordedCheckoutUnitIds,
  checkoutState, wasCheckedOut, checkoutWindowOpen, validateCheckoutOutcomes,
} from "../src/utils/checkoutFlow.js";

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

// ── 12. module hygiene + the derivation is really gone ─────────────────────
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
  const fn = utils.slice(utils.indexOf("export function getEffectiveStatus"));
  const body = fn.slice(0, fn.indexOf("\n}") + 2);
  check("getEffectiveStatus no longer returns \"פעילה\" — checkout is the only way in",
    !/return\s+"פעילה"/.test(body), body.trim());
  check("getEffectiveStatus still derives \"באיחור\" — the cron must not be the first to notice",
    /return\s+"באיחור"/.test(body));
  check("getEffectiveStatus now escalates a real פעילה row too",
    /"פעילה"/.test(body), body.trim());
}

console.log("");
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1mOK ${passed}/${passed} checkout-flow tests passed\x1b[0m`);
  process.exit(0);
}
console.log(`\x1b[31m\x1b[1mFAIL ${passed} passed, ${failed} failed\x1b[0m`);
process.exit(1);
