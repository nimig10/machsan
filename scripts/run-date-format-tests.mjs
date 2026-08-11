#!/usr/bin/env node
// Guards for the Hebrew date field (DD/MM/YYYY).
//
// Two real bugs motivated this module:
//
// 1. <input type="date"> renders in the BROWSER's locale, not the page's. An
//    Israeli user with an English browser saw 10/18/2026 in the field while the
//    notice right above it said 18/08/2026 — two formats on one screen, on a
//    form where picking the wrong month means the gear isn't there on shoot day.
//    The format is not settable from the app (lang/dir/CSS all ignored), so the
//    field had to stop being a native date input.
//
// 2. The native field could not be typed into at all. It was controlled, and
//    onChange REJECTED anything below the minimum without calling the setter —
//    so typing a year digit by digit produced 0002-.. / 0020-.. / 0202-.., each
//    rejected, each reverting the DOM. Same root cause as lesson #42 (validate
//    on blur, not on every keystroke), in a different field type.
//
// Hence the parser must never accept a PARTIAL value as a real date: that is
// exactly what turns keystrokes into silently-wrong data.
//
// No network, no DB. Exit 0 = all passed.

import { isoToHe, heToIso, maskDateInput, maskWhileTyping, isValidIso } from "../src/utils/dateFormat.js";
import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;
const check = (name, cond, detail = "") => {
  if (cond) { passed += 1; console.log(`  \x1b[32mPASS\x1b[0m ${name}`); }
  else { failed += 1; console.error(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
};

// ── 1. display ─────────────────────────────────────────────────────────────
console.log("\n\x1b[1m> isoToHe — what the user reads\x1b[0m");
{
  check("day comes first", isoToHe("2026-10-18") === "18/10/2026", isoToHe("2026-10-18"));
  check("single-digit day/month keep their zero padding", isoToHe("2026-01-05") === "05/01/2026");
  check("the value in the screenshot renders unambiguously",
    isoToHe("2026-08-18") === "18/08/2026");
  check("empty in → empty out (never 'Invalid Date')",
    isoToHe("") === "" && isoToHe(null) === "" && isoToHe(undefined) === "");
  check("junk in → empty out", isoToHe("not-a-date") === "" && isoToHe("2026-13-40") === "");
}

// ── 2. parsing ─────────────────────────────────────────────────────────────
console.log("\n\x1b[1m> heToIso — what the user types\x1b[0m");
{
  check("canonical DD/MM/YYYY", heToIso("18/10/2026") === "2026-10-18");
  check("dots are accepted (18.10.2026)", heToIso("18.10.2026") === "2026-10-18");
  check("dashes are accepted (18-10-2026)", heToIso("18-10-2026") === "2026-10-18");
  check("bare digits are accepted (18102026)", heToIso("18102026") === "2026-10-18");
  check("single-digit day and month (1/2/2026)", heToIso("1/2/2026") === "2026-02-01");
  check("surrounding whitespace is ignored", heToIso("  18/10/2026  ") === "2026-10-18");
  check("round-trip iso → he → iso", heToIso(isoToHe("2026-03-07")) === "2026-03-07");
}

// ── 3. the calendar is real ────────────────────────────────────────────────
console.log("\n\x1b[1m> impossible dates are rejected, not rounded\x1b[0m");
{
  check("31/02/2026 is rejected", heToIso("31/02/2026") === null);
  check("31/04/2026 is rejected (April has 30)", heToIso("31/04/2026") === null);
  check("00/01/2026 is rejected", heToIso("00/01/2026") === null);
  check("32/01/2026 is rejected", heToIso("32/01/2026") === null);
  check("18/13/2026 is rejected", heToIso("18/13/2026") === null);
  check("18/00/2026 is rejected", heToIso("18/00/2026") === null);
  check("29/02/2024 is accepted (leap year)", heToIso("29/02/2024") === "2024-02-29");
  check("29/02/2026 is rejected (not a leap year)", heToIso("29/02/2026") === null);
  check("29/02/2100 is rejected (century, not a leap year)", heToIso("29/02/2100") === null);
  check("29/02/2000 is accepted (400-year rule)", heToIso("29/02/2000") === "2000-02-29");
}

// ── 4. THE regression: a half-typed date is never a date ───────────────────
// This is the whole reason the field commits on blur instead of on change.
console.log("\n\x1b[1m> partial input is never mistaken for a value\x1b[0m");
{
  const keystrokes = ["", "1", "18", "18/", "18/1", "18/10", "18/10/", "18/10/2",
                      "18/10/20", "18/10/202"];
  const accepted = keystrokes.filter(k => heToIso(k) !== null);
  check("every prefix of '18/10/2026' parses to null", accepted.length === 0,
    `accepted: ${JSON.stringify(accepted)}`);
  check("only the complete value parses", heToIso("18/10/2026") === "2026-10-18");

  // A 2-digit year must NOT be silently widened — "18/10/26" could mean 1926 or
  // 2026, and guessing writes a wrong shoot date into the warehouse.
  check("a 2-digit year is rejected, not guessed", heToIso("18/10/26") === null);
  check("a 3-digit year is rejected", heToIso("18/10/202") === null);
  check("5+ digits of year are rejected", heToIso("18/10/20265") === null);
  check("null / undefined / empty are null",
    heToIso(null) === null && heToIso(undefined) === null && heToIso("") === null);
  check("letters are rejected", heToIso("ab/cd/efgh") === null);
}

// ── 5. the typing mask ─────────────────────────────────────────────────────
console.log("\n\x1b[1m> maskDateInput — slashes appear as you type\x1b[0m");
{
  check("digits gain separators", maskDateInput("18102026") === "18/10/2026");
  check("a partial entry stays partial", maskDateInput("1810") === "18/10");
  check("one digit stays one digit", maskDateInput("1") === "1");
  check("two digits do not force a trailing slash (backspace must work)",
    maskDateInput("18") === "18", maskDateInput("18"));
  check("already-formatted text is idempotent", maskDateInput("18/10/2026") === "18/10/2026");
  check("non-digits are stripped", maskDateInput("18a/1b0/20c26") === "18/10/2026");
  check("overflow beyond 8 digits is dropped", maskDateInput("1810202699") === "18/10/2026");
  check("empty stays empty", maskDateInput("") === "" && maskDateInput(null) === "");
}

// ── 5b. editing in the MIDDLE — the bug that shipped ───────────────────────
// Reported from production: "אני רוצה רק לשנות את היום או החודש ואז הוא
// מתבלגן". maskDateInput rebuilds from digits, which is lossless only when
// appending at the end. Anywhere else it destroys the value AND (because the
// rendered string then differs from the DOM) drops the caret at the end, so a
// single digit cannot be corrected.
console.log("\n\x1b[1m> maskWhileTyping — mid-string edits survive\x1b[0m");
{
  const at = (s, i) => i; // readability: caret index

  // THE reported failure. Day selected, "1" typed → "1/08/2026", caret at 1.
  // The old code produced "10/82/026".
  check("replacing the day does not scramble the date",
    maskWhileTyping("18/08/2026", "1/08/2026", at("1/08/2026", 1)) === "1/08/2026",
    maskWhileTyping("18/08/2026", "1/08/2026", 1));

  // …and finishing the edit still parses.
  check("the finished mid-edit is a valid date", heToIso("19/08/2026") === "2026-08-19");

  check("editing the month mid-string is left alone",
    maskWhileTyping("18/08/2026", "18/0/2026", at("18/0/2026", 4)) === "18/0/2026");

  check("deleting from the middle is left alone",
    maskWhileTyping("18/08/2026", "1808/2026", at("1808/2026", 2)) === "1808/2026");

  // Appending at the end is the one safe case — that is where slashes appear.
  check("appending at the end still auto-formats",
    maskWhileTyping("1810", "18102", 5) === "18/10/2");
  check("typing the first digits auto-formats",
    maskWhileTyping("18", "181", 3) === "18/1");

  // Backspace at the end must not re-add what was just deleted.
  check("backspace at the end is not re-formatted",
    maskWhileTyping("18/10", "18/1", 4) === "18/1");
  check("deleting the slash at the end stays deleted",
    maskWhileTyping("18/", "18", 2) === "18");

  // Select-all then retype.
  check("select-all + one digit is left alone",
    maskWhileTyping("18/08/2026", "1", 1) === "1");

  // Paste over a selection in the middle.
  check("pasting into the middle is left alone",
    maskWhileTyping("18/08/2026", "18/12/2026", at("18/12/2026", 5)) === "18/12/2026");

  // A caret anywhere but the end must never trigger a rewrite, even when the
  // text grew — that combination is exactly the reported bug.
  check("growth with the caret NOT at the end never reformats",
    maskWhileTyping("18/2026", "18/0/2026", 4) === "18/0/2026");
}

// ── 6. isValidIso — the min/max comparisons rely on it ─────────────────────
console.log("\n\x1b[1m> isValidIso\x1b[0m");
{
  check("a real ISO date passes", isValidIso("2026-10-18") === true);
  check("an impossible ISO date fails", isValidIso("2026-02-31") === false);
  check("a partial ISO fails", isValidIso("2026-10") === false);
  check("empty fails without throwing", isValidIso("") === false && isValidIso(null) === false);
}

// ── 7. module hygiene ──────────────────────────────────────────────────────
console.log("\n\x1b[1m> module hygiene\x1b[0m");
{
  const src = readFileSync(new URL("../src/utils/dateFormat.js", import.meta.url), "utf8");
  check("stays dependency-free (Node-testable, safe for api/)", !/^\s*import\s/m.test(src));
  // Date arithmetic across a DST boundary in Asia/Jerusalem has bitten this repo
  // before; the leap rule is arithmetic, so no Date object is needed here.
  check("does not construct Date objects", !/new\s+Date\s*\(/.test(src));
}

console.log("");
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1mOK ${passed}/${passed} date-format tests passed\x1b[0m`);
  process.exit(0);
}
console.log(`\x1b[31m\x1b[1mFAIL ${passed} passed, ${failed} failed\x1b[0m`);
process.exit(1);
