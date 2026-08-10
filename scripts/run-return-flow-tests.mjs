#!/usr/bin/env node
// Unit tests for src/utils/returnFlow.js — the logic behind the equipment-return
// screen, and the only routine flow in the app that writes to INVENTORY.
//
// What is pinned here, and why each one matters:
//   1. applyUnitOutcomes returns the FULL equipment array. It feeds
//      writeEquipmentToDB → sync_equipment_from_json, which delete+reinserts
//      equipment_units; a partial array wipes every unit of every omitted item
//      (lesson #21). This is the single most destructive mistake available here.
//   2. It never adds or removes a unit, and never touches a unit that was not
//      named in the outcomes — one damaged cable must not disturb the other 24.
//   3. pickUnitsForReturn only ever offers תקין units, deterministically, and
//      never more than the borrowed quantity.
//   4. fault text survives on פגום and is cleared everywhere else.
//
// No network, no DB. Exit 0 = all passed.

import {
  UNIT_OK, UNIT_DAMAGED, UNIT_MISSING, RETURN_OUTCOMES,
  unitNumber, unitLabel,
  pickUnitsForReturn, applyUnitOutcomes, summarizeOutcomes, describeExceptions,
} from "../src/utils/returnFlow.js";

let passed = 0;
let failed = 0;
const check = (name, cond, detail = "") => {
  if (cond) { passed += 1; console.log(`  \x1b[32mPASS\x1b[0m ${name}`); }
  else { failed += 1; console.error(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
};

const unit = (id, status = UNIT_OK, fault = "") => ({ id, status, fault, repair: "" });
// "כבל XLR" — the real prod shape: 25 units, borrowed 6 at a time.
const xlr = () => ({
  id: "1776079954421", name: "כבל XLR", total_quantity: 25,
  units: Array.from({ length: 25 }, (_, i) => unit(`1776079954421_${i + 1}`)),
});
const ntg = () => ({
  id: "1773430190996", name: "NTG1", total_quantity: 3,
  units: [unit("1773430190996_1"), unit("1773430190996_2"), unit("1773430190996_3")],
});
const fleet = () => [xlr(), ntg()];

// ── 1. unit id parsing ─────────────────────────────────────────────────────
console.log("\n\x1b[1m> unit ids\x1b[0m");
check("unitNumber reads the suffix", unitNumber("1776079954421_12") === "12");
check("unitNumber splits on the LAST underscore (equipment id may contain a dot)",
  unitNumber("1774106383093.9417_2") === "2");
check("unitLabel formats as #n", unitLabel("1773430190996_3") === "#3");
check("unitLabel survives a malformed id", typeof unitLabel(undefined) === "string");

// ── 2. picking the units to ask about ──────────────────────────────────────
console.log("\n\x1b[1m> pickUnitsForReturn\x1b[0m");
{
  const eq = xlr();
  const picked = pickUnitsForReturn(eq, 6);
  check("returns exactly the borrowed quantity", picked.length === 6, `got ${picked.length}`);
  check("picks the lowest-numbered units, in order",
    picked.map(u => unitNumber(u.id)).join(",") === "1,2,3,4,5,6",
    picked.map(u => unitNumber(u.id)).join(","));

  // #10 must not sort between #1 and #2 — a plain string sort would do exactly that.
  const twelve = pickUnitsForReturn(eq, 12).map(u => Number(unitNumber(u.id)));
  check("numeric ordering, not lexicographic (#10 after #9)",
    JSON.stringify(twelve) === JSON.stringify([1,2,3,4,5,6,7,8,9,10,11,12]), JSON.stringify(twelve));
}
{
  // Units already out of circulation are not candidates — they cannot be the
  // hardware coming back.
  const eq = xlr();
  eq.units[0].status = UNIT_DAMAGED;
  eq.units[2].status = UNIT_MISSING;
  const picked = pickUnitsForReturn(eq, 3).map(u => unitNumber(u.id));
  check("skips units that are already פגום / נעלם",
    JSON.stringify(picked) === JSON.stringify(["2","4","5"]), JSON.stringify(picked));
}
{
  const eq = ntg();
  eq.units[0].status = UNIT_DAMAGED;
  const picked = pickUnitsForReturn(eq, 3);
  check("fewer healthy units than borrowed → returns what exists, invents nothing",
    picked.length === 2, `got ${picked.length}`);
}
check("quantity 0 → no rows", pickUnitsForReturn(xlr(), 0).length === 0);
check("garbage quantity → no rows, no throw", pickUnitsForReturn(xlr(), "abc").length === 0);
check("equipment with no units array → no rows", pickUnitsForReturn({ id: "x" }, 3).length === 0);

// ── 3. applying the outcomes — the destructive path ────────────────────────
console.log("\n\x1b[1m> applyUnitOutcomes\x1b[0m");
{
  const before = fleet();
  const next = applyUnitOutcomes(before, [
    { equipmentId: "1776079954421", unitId: "1776079954421_5", status: UNIT_DAMAGED, fault: "מחבר שבור" },
  ]);

  // THE critical one: a subset here deletes the other item's units in the DB.
  check("returns the FULL equipment array, not just the touched item",
    next.length === before.length, `${next.length} vs ${before.length}`);
  check("untouched equipment comes back by reference", next[1] === before[1]);

  const xlrNext = next.find(e => e.id === "1776079954421");
  check("unit count is preserved — nothing added or removed",
    xlrNext.units.length === 25, `got ${xlrNext.units.length}`);
  const u5 = xlrNext.units.find(u => u.id === "1776079954421_5");
  check("the named unit is now פגום", u5.status === UNIT_DAMAGED);
  check("the fault text is stored", u5.fault === "מחבר שבור");
  check("every OTHER unit of the same item is untouched",
    xlrNext.units.filter(u => u.status !== UNIT_OK).length === 1);
  check("the input array was not mutated",
    before.find(e => e.id === "1776079954421").units.find(u => u.id === "1776079954421_5").status === UNIT_OK);
}
{
  const before = fleet();
  const next = applyUnitOutcomes(before, [
    { equipmentId: "1773430190996", unitId: "1773430190996_2", status: UNIT_MISSING },
  ]);
  const u = next.find(e => e.id === "1773430190996").units.find(x => x.id === "1773430190996_2");
  check("נעלם is written", u.status === UNIT_MISSING);
  check("נעלם carries no fault text", u.fault === "");
}
{
  // The common case: everything came back fine. Nothing should change at all.
  const before = fleet();
  const next = applyUnitOutcomes(before, [
    { equipmentId: "1773430190996", unitId: "1773430190996_1", status: UNIT_OK },
    { equipmentId: "1773430190996", unitId: "1773430190996_2", status: UNIT_OK },
  ]);
  check("all-OK outcomes are a no-op (same references, no spurious write)",
    next[0] === before[0] && next[1] === before[1]);
}
{
  const before = fleet();
  check("empty outcomes → the array back untouched", applyUnitOutcomes(before, []) === before);
  check("null outcomes → no throw", applyUnitOutcomes(before, null) === before);
  check("unknown equipment id is ignored",
    applyUnitOutcomes(before, [{ equipmentId: "nope", unitId: "nope_1", status: UNIT_DAMAGED }])[0] === before[0]);
  check("unknown unit id is ignored",
    applyUnitOutcomes(before, [{ equipmentId: "1773430190996", unitId: "1773430190996_99", status: UNIT_DAMAGED }])
      .find(e => e.id === "1773430190996").units.length === 3);
  check("an out-of-vocabulary status is refused",
    applyUnitOutcomes(before, [{ equipmentId: "1773430190996", unitId: "1773430190996_1", status: "בתיקון" }])[1] === before[1]);
}
{
  // 8 borrowed, 7 fine, 1 damaged — the example from the spec.
  const before = fleet();
  const picked = pickUnitsForReturn(before[0], 8);
  const outcomes = picked.map((u, i) => ({
    equipmentId: before[0].id, unitId: u.id,
    status: i === 3 ? UNIT_DAMAGED : UNIT_OK,
    fault: i === 3 ? "כבל קרוע" : "",
  }));
  const next = applyUnitOutcomes(before, outcomes);
  const eqNext = next.find(e => e.id === before[0].id);
  check("8 borrowed / 1 damaged → exactly one unit leaves stock",
    eqNext.units.filter(u => u.status === UNIT_OK).length === 24, `${eqNext.units.filter(u => u.status === UNIT_OK).length}`);
}

// ── 4. summaries ───────────────────────────────────────────────────────────
console.log("\n\x1b[1m> summaries\x1b[0m");
{
  const s = summarizeOutcomes([
    { status: UNIT_OK }, { status: UNIT_OK }, { status: UNIT_DAMAGED }, { status: UNIT_MISSING },
    { status: "בתיקון" }, null,
  ]);
  check("counts by state and ignores anything unrecognised",
    s.ok === 2 && s.damaged === 1 && s.missing === 1 && s.total === 4, JSON.stringify(s));
  check("describeExceptions reads naturally",
    describeExceptions(s) === "יחידה אחת פגומה · יחידה אחת נעלמה", describeExceptions(s));
  check("plural form for more than one",
    describeExceptions({ damaged: 3, missing: 0 }) === "3 יחידות פגומות");
  check("no exceptions → empty string", describeExceptions({ ok: 5, damaged: 0, missing: 0 }) === "");
}
check("RETURN_OUTCOMES is exactly the three panel states, without בתיקון",
  JSON.stringify(RETURN_OUTCOMES) === JSON.stringify([UNIT_OK, UNIT_DAMAGED, UNIT_MISSING]));

// ── 5. the module stays dependency-free ────────────────────────────────────
console.log("\n\x1b[1m> module hygiene\x1b[0m");
{
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/utils/returnFlow.js", import.meta.url), "utf8");
  const imports = [...src.matchAll(/^\s*import\s.*?from\s+["']([^"']+)["']/gm)].map(m => m[1]);
  check("returnFlow.js imports nothing — it must run under plain Node",
    imports.length === 0, imports.join(", "));
}

console.log("");
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1mOK ${passed}/${passed} return-flow tests passed\x1b[0m`);
  process.exit(0);
}
console.log(`\x1b[31m\x1b[1mFAIL ${passed} passed, ${failed} failed\x1b[0m`);
process.exit(1);
