#!/usr/bin/env node
// Unit tests for src/utils/loanPolicy.js — the ONE source of truth for
// per-loan-type lead-time rules, shared by the creation form (PublicForm),
// the student update UI, and api/student-submit-reservation-update.js.
//
// Two things are pinned here:
//   1. computeMinBorrowDate / loanMaxDays are BYTE-IDENTICAL to the inline
//      logic PublicForm.jsx used before the extraction (the old computation
//      is reproduced verbatim below and swept across 40 days × 5 loan types).
//   2. getUpdateLeadTimeState boundary semantics: borrow_date === minDate is
//      allowed, exactly-3h sound lead is allowed, started loans are blocked.
//
// No network, no DB. Exit 0 = all passed.

import {
  formatLocalDateInput,
  parseLocalDate,
  toDateTime,
  moveToNextWeekday,
  loanMinDays,
  loanMaxDays,
  computeMinBorrowDate,
  getUpdateLeadTimeState,
  computeUpdateDeadline,
  SOUND_MIN_LEAD_TIME_MS,
} from "../src/utils/loanPolicy.js";

let passed = 0;
let failed = 0;
const check = (name, cond, detail = "") => {
  if (cond) { passed += 1; console.log(`  \x1b[32mPASS\x1b[0m ${name}`); }
  else { failed += 1; console.error(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
};

// ── 1. verbatim reproduction of the OLD PublicForm inline logic ────────────
const oldMinDate = (loanType, now) => {
  const isCinema = loanType === "קולנוע יומית";
  const minDays = loanType === "פרטית" ? 1 : loanType === "סאונד" ? 0 : isCinema ? 0 : loanType === "הפקה" ? 7 : 7;
  const d = new Date(now);
  d.setDate(d.getDate() + (isCinema ? 1 : minDays));
  const r = parseLocalDate(formatLocalDateInput(d));
  while (r.getDay() === 5 || r.getDay() === 6) r.setDate(r.getDate() + 1);
  return formatLocalDateInput(r);
};
const oldMaxDays = (lt) => (lt === "פרטית" ? 4 : lt === "קולנוע יומית" ? 1 : 7);

console.log("\n> identity sweep vs the old inline logic (40 days × 5 types)");
{
  const types = ["פרטית", "סאונד", "קולנוע יומית", "הפקה", "אחר"];
  let mismatches = 0;
  for (let off = 0; off < 40; off += 1) {
    const now = new Date(2026, 0, 1 + off, 10, 30, 0);
    for (const t of types) {
      if (oldMinDate(t, now) !== computeMinBorrowDate(t, now)) mismatches += 1;
      if (oldMaxDays(t) !== loanMaxDays(t)) mismatches += 1;
    }
  }
  check("computeMinBorrowDate + loanMaxDays identical to old inline logic", mismatches === 0, `${mismatches} mismatches`);
}

console.log("\n> constants");
check("loanMinDays: פרטית=1 סאונד=0 קולנוע=0 הפקה=7 default=7",
  loanMinDays("פרטית") === 1 && loanMinDays("סאונד") === 0 && loanMinDays("קולנוע יומית") === 0 &&
  loanMinDays("הפקה") === 7 && loanMinDays("אחר") === 7);
check("SOUND_MIN_LEAD_TIME_MS = 3h", SOUND_MIN_LEAD_TIME_MS === 3 * 60 * 60 * 1000);
check("moveToNextWeekday rolls Fri→Sun", moveToNextWeekday("2026-07-24") === "2026-07-26"); // 24/07/26 is a Friday

console.log("\n> getUpdateLeadTimeState boundaries");
{
  // Wednesday 2026-07-22 10:00 local
  const nowMs = new Date(2026, 6, 22, 10, 0, 0).getTime();

  // private / cinema use an EXACT 24h clock (not the calendar day).
  const at1430 = { loan_type: "פרטית", borrow_date: "2026-07-23", borrow_time: "14:30" };
  check("private: exactly 24h before pickup → allowed",
    getUpdateLeadTimeState(at1430, toDateTime("2026-07-22", "14:30")).allowed === true);
  check("private: 1ms under 24h → blocked",
    getUpdateLeadTimeState(at1430, toDateTime("2026-07-22", "14:30") + 1).allowed === false);
  // a next-day pickup is NOT automatically allowed any more — the clock decides
  const privBlocked = getUpdateLeadTimeState(at1430, toDateTime("2026-07-22", "18:00"));
  check("private: next-day pickup but <24h away → blocked with reason",
    privBlocked.allowed === false && privBlocked.reason.includes("24 שעות"));
  check("private: blocked reason still offers removal",
    privBlocked.reason.includes("להחסיר"));

  const cin1430 = { loan_type: "קולנוע יומית", borrow_date: "2026-07-23", borrow_time: "14:30" };
  check("cinema: exactly 24h before pickup → allowed",
    getUpdateLeadTimeState(cin1430, toDateTime("2026-07-22", "14:30")).allowed === true);
  check("cinema: 1ms under 24h → blocked",
    getUpdateLeadTimeState(cin1430, toDateTime("2026-07-22", "14:30") + 1).allowed === false);

  // production: Wed +7 = Wed 29/07. 29th allowed, 28th blocked.
  check("production: borrow == minDate (+7) → allowed",
    getUpdateLeadTimeState({ loan_type: "הפקה", borrow_date: "2026-07-29", borrow_time: "09:00" }, nowMs).allowed === true);
  check("production: borrow one day early → blocked",
    getUpdateLeadTimeState({ loan_type: "הפקה", borrow_date: "2026-07-28", borrow_time: "09:00" }, nowMs).allowed === false);

  // sound: exactly 3h lead → allowed; 1ms less → blocked.
  const at13 = { loan_type: "סאונד", borrow_date: "2026-07-22", borrow_time: "13:00" };
  check("sound: exactly 3h lead → allowed", getUpdateLeadTimeState(at13, toDateTime("2026-07-22", "10:00")).allowed === true);
  check("sound: under 3h lead → blocked", getUpdateLeadTimeState(at13, toDateTime("2026-07-22", "10:00") + 1).allowed === false);

  // universal: pickup moment passed → blocked for every type.
  check("started loan blocked (private)",
    getUpdateLeadTimeState({ loan_type: "פרטית", borrow_date: "2026-07-21", borrow_time: "09:00" }, nowMs).allowed === false);
  check("started loan blocked (sound)",
    getUpdateLeadTimeState({ loan_type: "סאונד", borrow_date: "2026-07-22", borrow_time: "10:00" }, nowMs).allowed === false);
  check("missing borrow_date → blocked",
    getUpdateLeadTimeState({ loan_type: "פרטית" }, nowMs).allowed === false);
}

console.log("\n> computeUpdateDeadline (the last day/instant the window is open)");
{
  const nowMs = new Date(2026, 6, 22, 10, 0, 0).getTime(); // Wed 22/07/2026

  // private: exactly 24h before pickup — same clock time, previous day.
  // 11/10 14:30 pickup → 10/10 14:30 (the case the product owner specified).
  const privDl = computeUpdateDeadline({ loan_type: "פרטית", borrow_date: "2026-10-11", borrow_time: "14:30" }, nowMs);
  check("private deadline = exactly 24h before pickup (10/10 14:30)",
    !!privDl && privDl.date === "2026-10-10" && privDl.time === "14:30", JSON.stringify(privDl));

  // sound: exact instant, 3h before the borrow time
  const sndDl = computeUpdateDeadline({ loan_type: "סאונד", borrow_date: "2026-07-30", borrow_time: "18:00" }, nowMs);
  check("sound deadline is 3h before session (15:00 on 30/07)",
    !!sndDl && sndDl.date === "2026-07-30" && sndDl.time === "15:00", JSON.stringify(sndDl));

  const cinemaDl = computeUpdateDeadline({ loan_type: "קולנוע יומית", borrow_date: "2026-07-30", borrow_time: "19:00" }, nowMs);
  check("cinema deadline = exactly 24h before pickup (29/07 19:00)",
    !!cinemaDl && cinemaDl.date === "2026-07-29" && cinemaDl.time === "19:00", JSON.stringify(cinemaDl));

  // window already shut → null (hour-precise types honour nowMs)
  check("private: deadline already passed → null",
    computeUpdateDeadline({ loan_type: "פרטית", borrow_date: "2026-07-22", borrow_time: "18:00" }, nowMs) === null);

  // production (7-weekday lead): a deadline date exists and is well before borrow
  const prodDl = computeUpdateDeadline({ loan_type: "הפקה", borrow_date: "2026-08-10", borrow_time: "09:00" }, nowMs);
  check("production deadline is the end of an allowed day before borrow",
    !!prodDl && prodDl.time === "23:59" && prodDl.date < "2026-08-10", JSON.stringify(prodDl));

  check("no borrow date → null deadline", computeUpdateDeadline({ loan_type: "פרטית" }, nowMs) === null);
}

console.log("");
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1mOK ${passed}/${passed} loan-policy tests passed\x1b[0m`);
  process.exit(0);
}
console.log(`\x1b[31m\x1b[1mFAIL ${passed} passed, ${failed} failed\x1b[0m`);
process.exit(1);
