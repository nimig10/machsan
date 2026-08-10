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
//   5. The archive snapshot (return_outcomes) degrades to null for every row
//      written before the feature existed — that branch is the one the whole
//      display design rests on, so it is pinned harder than the happy path.
//
// No network, no DB. Exit 0 = all passed.

import {
  UNIT_OK, UNIT_DAMAGED, UNIT_MISSING, RETURN_OUTCOMES, RETURN_EXCEPTIONS,
  unitNumber, unitLabel,
  pickUnitsForReturn, applyUnitOutcomes, summarizeOutcomes, describeExceptions,
  buildReturnOutcomesSnapshot, readReturnOutcomes, returnExceptionSummary,
  validateReturnOutcomes, findUnitReturnRecord,
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

// ── 5. building the frozen archive snapshot ────────────────────────────────
const AT = "2026-08-10T09:41:22.113Z";
const outcome = (eqId, n, status, fault = "") => ({ equipmentId: eqId, unitId: `${eqId}_${n}`, status, fault });
const XLR_ID = "1776079954421";

console.log("\n\x1b[1m> buildReturnOutcomesSnapshot\x1b[0m");
{
  // The all-green path: ReturnEquipmentPanel calls onComplete([]) when every
  // card is marked, so this is the SHAPE OF THE COMMON CASE. It must produce
  // null and not an empty envelope — the archive treats null as "nothing to
  // show", and {items:[]} would light up every banner with zero content.
  check("no outcomes at all → null",
    buildReturnOutcomesSnapshot({ outcomes: [], equipment: fleet(), at: AT }) === null);
  check("every unit תקין → null (nothing was actually wrong)",
    buildReturnOutcomesSnapshot({
      outcomes: [outcome(XLR_ID, 1, UNIT_OK), outcome(XLR_ID, 2, UNIT_OK)],
      equipment: fleet(), at: AT,
    }) === null);

  const snap = buildReturnOutcomesSnapshot({
    outcomes: [
      outcome(XLR_ID, 1, UNIT_OK),
      outcome(XLR_ID, 3, UNIT_DAMAGED, "  מחבר שבור  "),
      outcome(XLR_ID, 5, UNIT_MISSING),
      outcome(XLR_ID, 6, UNIT_OK),
    ],
    equipment: fleet(), at: AT,
  });
  check("one item entry for the equipment that had exceptions", snap?.items?.length === 1);
  check("two unit entries — the תקין ones are dropped", snap?.items?.[0]?.units?.length === 2);
  // Deep scan rather than a count: a stray תקין nested anywhere would make the
  // "NULL means clean" contract a lie.
  check("תקין never appears anywhere in the snapshot",
    !JSON.stringify(snap).includes(UNIT_OK), JSON.stringify(snap));
  check("fault is trimmed", snap?.items?.[0]?.units?.[0]?.fault === "מחבר שבור");
  check("name is snapshotted from the equipment row", snap?.items?.[0]?.name === "כבל XLR");
  check("v is 1", snap?.v === 1);
  check("at is the injected timestamp, not a fresh Date()", snap?.at === AT);

  const missingUnit = snap.items[0].units.find(u => u.status === UNIT_MISSING);
  check("fault key is absent on נעלם, not empty-string",
    missingUnit && !("fault" in missingUnit), JSON.stringify(missingUnit));

  const blank = buildReturnOutcomesSnapshot({
    outcomes: [outcome(XLR_ID, 2, UNIT_DAMAGED, "   ")], equipment: fleet(), at: AT,
  });
  check("whitespace-only fault omits the key entirely",
    blank?.items?.[0]?.units?.[0] && !("fault" in blank.items[0].units[0]));

  const twoItems = buildReturnOutcomesSnapshot({
    outcomes: [outcome(XLR_ID, 3, UNIT_DAMAGED), outcome(XLR_ID, 9, UNIT_MISSING), outcome("1773430190996", 1, UNIT_DAMAGED)],
    equipment: fleet(), at: AT,
  });
  check("two units of one equipment collapse into a single items[] entry",
    twoItems.items.find(i => String(i.equipment_id) === XLR_ID)?.units?.length === 2);
  check("a second equipment gets its own entry", twoItems.items.length === 2);

  check("unknown equipmentId still records, with an empty name",
    buildReturnOutcomesSnapshot({ outcomes: [outcome("nope", 1, UNIT_DAMAGED)], equipment: fleet(), at: AT })
      ?.items?.[0]?.name === "");
  check("an unrecognised status is ignored, like summarizeOutcomes",
    buildReturnOutcomesSnapshot({
      outcomes: [{ equipmentId: XLR_ID, unitId: `${XLR_ID}_4`, status: "בתיקון" }],
      equipment: fleet(), at: AT,
    }) === null);
  check("RETURN_EXCEPTIONS is פגום+נעלם only — תקין must never be storable",
    JSON.stringify(RETURN_EXCEPTIONS) === JSON.stringify([UNIT_DAMAGED, UNIT_MISSING]));
}

// ── 6. reading it back — the degrade path ──────────────────────────────────
console.log("\n\x1b[1m> readReturnOutcomes\x1b[0m");
{
  // THE most important test in this file. Every reservation archived before
  // this feature shipped takes this branch, in prod, on every archive render.
  const empties = [undefined, null, {}, { return_outcomes: null }, { return_outcomes: {} },
    { return_outcomes: { items: [] } }, { return_outcomes: "…" }, { return_outcomes: [] },
    { return_outcomes: { items: "x" } }];
  check("every empty/legacy/garbage shape reads as null",
    empties.every(r => readReturnOutcomes(r) === null),
    empties.map(r => JSON.stringify(r)).find(r => readReturnOutcomes(JSON.parse(r || "null")) !== null) || "");

  const snap = buildReturnOutcomesSnapshot({
    outcomes: [outcome(XLR_ID, 3, UNIT_DAMAGED, "מחבר שבור"), outcome(XLR_ID, 5, UNIT_MISSING)],
    equipment: fleet(), at: AT,
  });
  const read = readReturnOutcomes({ return_outcomes: snap });
  check("round-trip: build → read reproduces the damaged set",
    read?.byEquipment?.[XLR_ID]?.damaged?.length === 1);
  check("round-trip: and the missing set", read?.byEquipment?.[XLR_ID]?.missing?.length === 1);
  check("round-trip: the fault text survives",
    read.byEquipment[XLR_ID].damaged[0].fault === "מחבר שבור");
  check("totals are exposed for the banner", read?.totals?.damaged === 1 && read?.totals?.missing === 1);
  check("at is carried through", read?.at === AT);

  // ArchivePage looks up by item.equipment_id, which arrives as a number on
  // some rows and a string on others.
  check("lookup key is string-normalised", !!readReturnOutcomes({
    return_outcomes: { v: 1, at: AT, items: [{ equipment_id: 123, units: [{ unit_id: "123_1", status: UNIT_DAMAGED }] }] },
  })?.byEquipment?.["123"]);

  check("a unit entry with no unit_id is dropped rather than rendered as #—",
    readReturnOutcomes({
      return_outcomes: { v: 1, at: AT, items: [{ equipment_id: XLR_ID, units: [{ status: UNIT_DAMAGED }] }] },
    }) === null);

  // Additive future changes must not blank out the archive.
  check("a future v still reads (forward compatible)", !!readReturnOutcomes({
    return_outcomes: { v: 2, at: AT, items: [{ equipment_id: XLR_ID, units: [{ unit_id: `${XLR_ID}_1`, status: UNIT_MISSING }] }] },
  }));
}

// ── 7. the collapsed archive card ──────────────────────────────────────────
console.log("\n\x1b[1m> returnExceptionSummary\x1b[0m");
{
  const snap = buildReturnOutcomesSnapshot({
    outcomes: [outcome(XLR_ID, 3, UNIT_DAMAGED), outcome(XLR_ID, 4, UNIT_DAMAGED), outcome(XLR_ID, 5, UNIT_MISSING)],
    equipment: fleet(), at: AT,
  });
  const ex = returnExceptionSummary({ return_outcomes: snap });
  check("counts damaged and missing", ex?.damaged === 2 && ex?.missing === 1);
  // Reuse, don't re-word: this string is already pinned by section 4 and shown
  // in the closing toast, so card and toast can never drift apart.
  check("feeds describeExceptions verbatim",
    describeExceptions(ex) === "2 יחידות פגומות · יחידה אחת נעלמה", describeExceptions(ex));
  check("a clean reservation yields null, so the card renders nothing new",
    returnExceptionSummary({ id: "1", status: "הוחזר" }) === null);
}

// ── 8. the reverse view — which loan was this unit marked in ───────────────
console.log("\n\x1b[1m> findUnitReturnRecord\x1b[0m");
{
  const mk = (id, student, at, unitN, status, fault = "") => ({
    id, student_name: student,
    return_outcomes: buildReturnOutcomesSnapshot({
      outcomes: [outcome(XLR_ID, unitN, status, fault)], equipment: fleet(), at,
    }),
  });
  const older  = mk("R1", "דנה", "2026-08-01T10:00:00.000Z", 3, UNIT_DAMAGED, "רעש");
  const newer  = mk("R2", "יוסי", "2026-08-09T10:00:00.000Z", 3, UNIT_DAMAGED, "מחבר שבור");
  const other  = mk("R3", "מיכל", "2026-08-10T10:00:00.000Z", 7, UNIT_MISSING);
  const clean  = { id: "R4", student_name: "אבי", return_outcomes: null };
  const all = [older, newer, other, clean];

  const hit = findUnitReturnRecord(`${XLR_ID}_3`, all);
  check("finds the reservation the unit was marked in", hit?.reservationId === "R2");
  check("picks the LATEST record when a unit was marked more than once",
    hit?.at === "2026-08-09T10:00:00.000Z", hit?.at);
  check("carries the student name for the card", hit?.studentName === "יוסי");
  check("carries status and fault", hit?.status === UNIT_DAMAGED && hit?.fault === "מחבר שבור");
  check("a נעלם unit is found too", findUnitReturnRecord(`${XLR_ID}_7`, all)?.reservationId === "R3");
  // Units damaged by hand on the units screen, and every unit in prod today,
  // have no record — the card must simply show nothing.
  check("a unit with no record → null", findUnitReturnRecord(`${XLR_ID}_2`, all) === null);
  check("empty/garbage inputs → null",
    findUnitReturnRecord("", all) === null && findUnitReturnRecord(`${XLR_ID}_3`, null) === null);
}

// ── 9. the server-side gate ────────────────────────────────────────────────
console.log("\n\x1b[1m> validateReturnOutcomes\x1b[0m");
{
  const good = buildReturnOutcomesSnapshot({
    outcomes: [outcome(XLR_ID, 3, UNIT_DAMAGED, "מחבר שבור")], equipment: fleet(), at: AT,
  });
  check("a well-formed snapshot passes", !!validateReturnOutcomes(good));
  check("non-objects are rejected",
    [null, undefined, "x", 5, []].every(v => validateReturnOutcomes(v) === null));
  check("missing items is rejected", validateReturnOutcomes({ v: 1, at: AT }) === null);

  // The injection guard. Anything the client bolts on must not reach the row.
  const dirty = validateReturnOutcomes({
    v: 1, at: AT, evil: true,
    items: [{ equipment_id: XLR_ID, name: "כבל XLR", extra: "no",
      units: [{ unit_id: `${XLR_ID}_3`, status: UNIT_DAMAGED, fault: "x", isAdmin: true }] }],
  });
  check("envelope keys are whitelisted",
    JSON.stringify(Object.keys(dirty).sort()) === JSON.stringify(["at", "items", "v"]));
  check("item keys are whitelisted",
    JSON.stringify(Object.keys(dirty.items[0]).sort()) === JSON.stringify(["equipment_id", "name", "units"]));
  check("unit keys are whitelisted",
    JSON.stringify(Object.keys(dirty.items[0].units[0]).sort()) === JSON.stringify(["fault", "status", "unit_id"]));

  check("תקין is dropped even if a client sends it", validateReturnOutcomes({
    v: 1, at: AT, items: [{ equipment_id: XLR_ID, units: [{ unit_id: `${XLR_ID}_1`, status: UNIT_OK }] }],
  }) === null, "a snapshot that reduces to zero units must become null");

  // A return must never fail because somebody typed an essay into the fault box.
  const essay = validateReturnOutcomes({
    v: 1, at: AT, items: [{ equipment_id: XLR_ID, units: [{ unit_id: `${XLR_ID}_1`, status: UNIT_DAMAGED, fault: "א".repeat(900) }] }],
  });
  check("an over-long fault is truncated, not rejected", essay?.items?.[0]?.units?.[0]?.fault?.length === 400,
    String(essay?.items?.[0]?.units?.[0]?.fault?.length));

  const flood = validateReturnOutcomes({
    v: 1, at: AT,
    items: Array.from({ length: 400 }, (_, i) => ({
      equipment_id: `eq${i}`, units: [{ unit_id: `eq${i}_1`, status: UNIT_MISSING }],
    })),
  });
  check("an absurd number of items is rejected outright", flood === null);
}

// ── 10. the module stays dependency-free ───────────────────────────────────
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
