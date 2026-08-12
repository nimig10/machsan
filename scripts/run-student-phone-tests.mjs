// run-student-phone-tests.mjs — guards src/utils/studentPhone.js.
//
// Every assertion here corresponds to a bug that actually shipped, twice in two
// days, on the student-phone plumbing:
//
//   * the submission order was inverted for production loans, so a stale
//     auto-filled number beat the one the director had just typed, and then got
//     written back over the roster;
//   * an auto-filled value was treated as a user answer and allowed to replace
//     a number the office had already corrected.
//
// No network, no DB.
import { readFileSync } from "node:fs";
import {
  stripPhone,
  isValidPhone,
  normalizeIsraeliPhone,
  resolveStudentPhone,
  pickSubmissionPhone,
  mayOverwriteRosterPhone,
} from "../src/utils/studentPhone.js";

let passed = 0;
const failures = [];
function check(name, cond) {
  if (cond) { passed++; console.log(`  \x1b[32mPASS\x1b[0m ${name}`); }
  else { failures.push(name); console.log(`  \x1b[31mFAIL\x1b[0m ${name}`); }
}
const eq = (name, actual, expected) => {
  const ok = actual === expected;
  check(`${name}${ok ? "" : ` — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`, ok);
};

console.log("\nstripPhone / isValidPhone");
eq("strips dashes and spaces", stripPhone(" 050-123 4567 "), "0501234567");
eq("keeps a leading +", stripPhone("+972-54-1234567"), "+972541234567");
eq("empty in, empty out", stripPhone(null), "");
check("050-123-4567 is valid", isValidPhone("050-123-4567"));
check("+972541234567 is valid", isValidPhone("+972541234567"));
check("05012 is too short", !isValidPhone("05012"));
check("16 digits is too long", !isValidPhone("1234567890123456"));
check("empty is not valid", !isValidPhone(""));
check("letters alone are not valid", !isValidPhone("abcdefg"));

console.log("\nnormalizeIsraeliPhone (wa.me deep links)");
eq("local → international", normalizeIsraeliPhone("054-123-4567"), "972541234567");
eq("already international is left alone", normalizeIsraeliPhone("972541234567"), "972541234567");
eq("+ prefix is stripped", normalizeIsraeliPhone("+972541234567"), "972541234567");
eq("no digits → empty", normalizeIsraeliPhone("—"), "");

console.log("\nresolveStudentPhone — order of trust");
const roster = [{ email: "A@Camera.ORG.il", phone: "0501111111" }];
const history = [
  { email: "a@camera.org.il", phone: "0502222222", borrow_date: "2026-01-01" },
  { email: "a@camera.org.il", phone: "0503333333", borrow_date: "2026-06-01" },
];
eq("the reservation's own snapshot wins",
  resolveStudentPhone({ email: "a@camera.org.il", phone: "0509999999" }, { students: roster, reservations: history }),
  "0509999999");
eq("falls back to the roster row",
  resolveStudentPhone({ email: "a@camera.org.il", phone: "" }, { students: roster, reservations: history }),
  "0501111111");
eq("falls back to the NEWEST other reservation",
  resolveStudentPhone({ email: "a@camera.org.il" }, { students: [], reservations: history }),
  "0503333333");
eq("email match ignores case and surrounding space",
  resolveStudentPhone({ email: "  A@CAMERA.ORG.IL " }, { students: roster, reservations: [] }),
  "0501111111");
eq("a roster row with an empty phone is skipped",
  resolveStudentPhone({ email: "a@camera.org.il" }, { students: [{ email: "a@camera.org.il", phone: "" }], reservations: history }),
  "0503333333");
eq("no email → empty, never a wrong student's number",
  resolveStudentPhone({ phone: "" }, { students: roster, reservations: history }), "");
eq("nothing anywhere → empty", resolveStudentPhone({ email: "ghost@x.il" }, { students: roster, reservations: history }), "");
eq("missing options object does not throw", resolveStudentPhone({ email: "a@camera.org.il" }), "");
eq("undefined reservation does not throw", resolveStudentPhone(undefined, { students: roster }), "");

console.log("\npickSubmissionPhone — THE inverted-order bug");
eq("production: טלפון הבמאי beats the auto-filled form value",
  pickSubmissionPhone({ isProduction: true, formPhone: "0500000000", productionPhone: "0546598752" }),
  "0546598752");
eq("production: falls back to the form when the production has none",
  pickSubmissionPhone({ isProduction: true, formPhone: "0500000000", productionPhone: "" }),
  "0500000000");
eq("non-production: the visible field wins over the production value",
  pickSubmissionPhone({ isProduction: false, formPhone: "0500000000", productionPhone: "0546598752" }),
  "0500000000");
eq("the login-time snapshot is always LAST",
  pickSubmissionPhone({ isProduction: false, formPhone: "", sessionPhone: "0507777777" }),
  "0507777777");
eq("production also puts the snapshot last",
  pickSubmissionPhone({ isProduction: true, formPhone: "", productionPhone: "", sessionPhone: "0507777777" }),
  "0507777777");
eq("whitespace-only is not a number", pickSubmissionPhone({ isProduction: false, formPhone: "   ", sessionPhone: "0507777777" }), "0507777777");
eq("nothing at all → empty", pickSubmissionPhone({}), "");

console.log("\nmayOverwriteRosterPhone — an echo may not replace an answer");
check("typed in the visible field ⇒ may overwrite",
  mayOverwriteRosterPhone({ isProduction: false, phoneTouched: true }));
check("auto-filled and untouched ⇒ may NOT overwrite",
  !mayOverwriteRosterPhone({ isProduction: false, phoneTouched: false }));
check("production with a director phone ⇒ may overwrite",
  mayOverwriteRosterPhone({ isProduction: true, productionPhone: "0546598752" }));
check("production without one ⇒ may NOT overwrite",
  !mayOverwriteRosterPhone({ isProduction: true, productionPhone: "" }));
check("production ignores phoneTouched from the hidden form",
  !mayOverwriteRosterPhone({ isProduction: true, phoneTouched: true, productionPhone: "  " }));
check("no arguments ⇒ may NOT overwrite (safe default)", !mayOverwriteRosterPhone());

console.log("\nmodule contract");
const src = readFileSync(new URL("../src/utils/studentPhone.js", import.meta.url), "utf8");
const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
check("stays dependency-free — it must run under plain Node and from api/",
  !/^\s*import\s/m.test(withoutComments));
check("no Date() — nothing here is time-dependent",
  !/new\s+Date\s*\(/.test(withoutComments));

// The anonymous endpoint must never take an overwrite instruction from the body.
const createRes = readFileSync(new URL("../api/create-reservation.js", import.meta.url), "utf8");
const createResCode = createRes.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
check("create-reservation keeps the fill-only filter unconditional",
  /or=\(phone\.is\.null,phone\.eq\.\)/.test(createResCode));
check("create-reservation takes no phoneTyped flag from the request body",
  !/phoneTyped/.test(createResCode));

console.log(
  failures.length === 0
    ? `\n\x1b[32m\x1b[1mOK ${passed}/${passed} student-phone tests passed\x1b[0m\n`
    : `\n\x1b[31m\x1b[1m${failures.length} FAILED\x1b[0m of ${passed + failures.length}:\n  ${failures.join("\n  ")}\n`
);
process.exit(failures.length === 0 ? 0 : 1);
