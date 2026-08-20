// run-student-identity-tests.mjs — guards src/utils/studentIdentity.js and the
// write paths that feed a student's name into the database.
//
// The bug this pins: a student's loan request went out under a name that
// existed in exactly ONE row of the whole database. She had renamed herself
// nowhere — students.name, users.full_name and auth metadata all agreed — but
// the loan form exposed שם פרטי / שם משפחה as free-text inputs, the value lived
// on in the sessionStorage draft, and the loan-type selector did not reset it,
// so a name typed into one loan type leaked into another's frozen snapshot.
// 31 rows across 3 students, two of them typos nobody could correct.
//
// It is not cosmetic: staff search, the production certification gate and the
// overdue cron all key on the NAME rather than the email.
//
// No network, no DB.
import { readFileSync } from "node:fs";
import {
  normalizeNameKey,
  emailKeyOf,
  splitFullName,
  joinName,
  resolveRosterName,
  nameNeedsCascade,
  isCascadableReservation,
  selectReservationIdsForRename,
  selectCrewReservationIds,
  selectStudioBookingIdsForRename,
  selectProductionIdsForRename,
  RENAME_EXCLUDED_LOAN_TYPES,
} from "../src/utils/studentIdentity.js";

let passed = 0;
const failures = [];
function check(name, cond) {
  if (cond) { passed++; console.log(`  \x1b[32mPASS\x1b[0m ${name}`); }
  else { failures.push(name); console.log(`  \x1b[31mFAIL\x1b[0m ${name}`); }
}
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(`${name}${ok ? "" : ` — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`, ok);
};

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

console.log("\nnormalizeNameKey — the cert gate and both search boxes key on this");
eq("collapses whitespace and lowercases", normalizeNameKey("  Yuli   Porat "), "yuli porat");
eq("Hebrew passes through unchanged apart from spacing", normalizeNameKey("יולי  יחזקאלי"), "יולי יחזקאלי");
eq("nullish in, empty out", normalizeNameKey(null), "");

// The certification matcher lives in TWO other files and must normalize
// identically; a gate that disagrees with the roster silently stops matching.
{
  const oneLiner = 'return String(value || "").trim().replace(/\\s+/g, " ").toLowerCase();';
  const identity = stripComments(read("../src/utils/studentIdentity.js"));
  const utils = stripComments(read("../src/utils.js"));
  const review = stripComments(read("../src/utils/reservationUpdateReview.js"));
  check("normalizeNameKey body is byte-identical to the utils.js copy",
    identity.includes(oneLiner) && utils.includes(oneLiner));
  check("…and to the reservationUpdateReview.js copy (the cert gate)",
    review.includes(oneLiner));
}

console.log("\nemailKeyOf — email is the identity key, never the name");
eq("trims and lowercases", emailKeyOf({ email: "  Yuli6197@GMAIL.com " }), "yuli6197@gmail.com");
eq("missing email ⇒ empty key", emailKeyOf({}), "");
eq("null row ⇒ empty key", emailKeyOf(null), "");

console.log("\nsplitFullName / joinName — a presentation split over ONE column");
eq("two-word name", splitFullName("יולי יחזקאלי"), { first: "יולי", last: "יחזקאלי" });
eq("three-word name keeps the rest together", splitFullName("אדר בן עובד"), { first: "אדר", last: "בן עובד" });
eq("single word ⇒ empty last", splitFullName("מדונה"), { first: "מדונה", last: "" });
eq("blank in, blank halves out", splitFullName("   "), { first: "", last: "" });
for (const name of ["יולי יחזקאלי", "אדר בן עובד", "יהודה אריה לייב אברמצ'יק", "מדונה"]) {
  const { first, last } = splitFullName(name);
  eq(`round-trips "${name}"`, joinName(first, last), name);
}
eq("joinName drops an empty half without a stray space", joinName("אדר", ""), "אדר");
eq("joinName collapses inner padding", joinName("  אדר ", " בן  עובד "), "אדר בן עובד");

console.log("\nresolveRosterName — the roster is the source of truth");
const roster = [
  { id: "s1", email: "yuli6197@gmail.com", name: "יולי יחזקאלי" },
  { id: "s2", email: "Ofek@example.com", name: " אופק  ירימי " },
];
eq("matches case-insensitively on email", resolveRosterName({ email: "YULI6197@Gmail.com" }, roster), "יולי יחזקאלי");
eq("collapses the roster value it returns", resolveRosterName({ email: "ofek@example.com" }, roster), "אופק ירימי");
eq("no email ⇒ empty, never a guess", resolveRosterName({ email: "" }, roster), "");
eq("no matching row ⇒ empty, never another student's name", resolveRosterName({ email: "nobody@x.com" }, roster), "");
eq("empty roster ⇒ empty", resolveRosterName({ email: "yuli6197@gmail.com" }, []), "");
eq("nullish roster ⇒ empty (no throw)", resolveRosterName({ email: "yuli6197@gmail.com" }, null), "");

console.log("\nnameNeedsCascade — a cascade may never blank a name");
check("real rename ⇒ true", nameNeedsCascade("נמרוד גרא", "נימרוד גרא"));
check("blank next ⇒ false — history keeps the name it displays", !nameNeedsCascade("נמרוד גרא", ""));
check("whitespace-only next ⇒ false", !nameNeedsCascade("נמרוד גרא", "   "));
check("nullish next ⇒ false", !nameNeedsCascade("נמרוד גרא", null));
check("whitespace-only difference ⇒ false (autosave fires per keystroke)",
  !nameNeedsCascade("נמרוד  גרא", "נמרוד גרא"));
check("padding-only difference ⇒ false", !nameNeedsCascade(" נמרוד גרא ", "נמרוד גרא"));
check("case change IS a rename — \"john\" → \"John\" is a real correction",
  nameNeedsCascade("john smith", "John Smith"));
check("blank prev filled in ⇒ true", nameNeedsCascade("", "יולי יחזקאלי"));

console.log("\nisCascadableReservation — lesson rows carry a LECTURER's name");
eq("RENAME_EXCLUDED_LOAN_TYPES is exactly the lesson type", RENAME_EXCLUDED_LOAN_TYPES, ["שיעור"]);
check("a private loan is cascadable", isCascadableReservation({ loan_type: "פרטית" }));
check("a production loan is cascadable", isCascadableReservation({ loan_type: "הפקה" }));
check("a staff loan IS cascadable — same human, same email", isCascadableReservation({ loan_type: "צוות" }));
check("a lesson loan is NOT", !isCascadableReservation({ loan_type: "שיעור" }));
check("lesson_auto is NOT, whatever the loan_type says",
  !isCascadableReservation({ loan_type: "פרטית", lesson_auto: true }));
check("null row is NOT", !isCascadableReservation(null));

console.log("\nselectReservationIdsForRename — BY EMAIL, never by the old name");
const RES = [
  { id: "r1", email: "yuli6197@gmail.com", loan_type: "הפקה", student_name: "יולי פורת" },
  { id: "r2", email: "YULI6197@gmail.com", loan_type: "פרטית", student_name: "יולי יחזקאלי" },
  { id: "r3", email: "someone@else.com", loan_type: "פרטית", student_name: "יולי פורת" },
  { id: "r4", email: "yuli6197@gmail.com", loan_type: "שיעור", student_name: "מרצה כלשהו" },
  { id: "r5", email: "yuli6197@gmail.com", loan_type: "פרטית", student_name: "יולי יחזקאלי", lesson_auto: true },
  { id: "r6", email: "", loan_type: "פרטית", student_name: "יולי פורת" },
];
const ARGS = { emailKey: "yuli6197@gmail.com", nextName: "יולי יחזקאלי" };
eq("picks only the row whose email matches and whose name differs",
  selectReservationIdsForRename(RES, ARGS), ["r1"]);
check("r3 carries the OLD name but somebody else's email — not selected",
  !selectReservationIdsForRename(RES, ARGS).includes("r3"));
check("r2 already correct — not selected (idempotence)",
  !selectReservationIdsForRename(RES, ARGS).includes("r2"));
check("r4 is a lesson — not selected", !selectReservationIdsForRename(RES, ARGS).includes("r4"));
check("r5 is lesson_auto — not selected", !selectReservationIdsForRename(RES, ARGS).includes("r5"));
check("r6 has no email — not selected", !selectReservationIdsForRename(RES, ARGS).includes("r6"));
eq("re-running over the post-write rows returns [] — this is what stops the autosave loop",
  selectReservationIdsForRename(
    RES.map(r => (r.id === "r1" ? { ...r, student_name: "יולי יחזקאלי" } : r)), ARGS), []);
eq("blank target name ⇒ [] (a cascade may not erase)",
  selectReservationIdsForRename(RES, { emailKey: "yuli6197@gmail.com", nextName: "  " }), []);
eq("blank email key ⇒ []", selectReservationIdsForRename(RES, { emailKey: "", nextName: "x" }), []);
eq("no arguments ⇒ [] (safe default)", selectReservationIdsForRename(RES), []);
eq("nullish rows ⇒ [] (no throw)", selectReservationIdsForRename(null, ARGS), []);
eq("a padded stored name is normalised, not skipped",
  selectReservationIdsForRename(
    [{ id: "p1", email: "yuli6197@gmail.com", loan_type: "פרטית", student_name: "יולי  יחזקאלי" }], ARGS),
  ["p1"]);

console.log("\nselectCrewReservationIds — BY production_id, never by the old name");
const CREW_ROWS = [
  { id: "c1", production_id: "prod_A", crew_photographer_name: "יולי פורת", crew_sound_name: "אחר" },
  { id: "c2", production_id: "prod_B", crew_photographer_name: "יולי פורת", crew_sound_name: "יולי פורת" },
  { id: "c3", production_id: "prod_A", crew_photographer_name: "יולי יחזקאלי", crew_sound_name: "אחר" },
  { id: "c4", production_id: null, crew_photographer_name: "יולי פורת", crew_sound_name: "אחר" },
];
const CREW_ARGS = { productionIds: ["prod_A"], nextName: "יולי יחזקאלי" };
eq("photographer: only rows on the named production, only if stale",
  selectCrewReservationIds(CREW_ROWS, { ...CREW_ARGS, role: "photographer" }), ["c1"]);
check("c2 still holds the old name but its production is not in the set — untouched",
  !selectCrewReservationIds(CREW_ROWS, { ...CREW_ARGS, role: "photographer" }).includes("c2"));
check("c3 already matches — untouched",
  !selectCrewReservationIds(CREW_ROWS, { ...CREW_ARGS, role: "photographer" }).includes("c3"));
check("c4 has no production_id — untouched",
  !selectCrewReservationIds(CREW_ROWS, { ...CREW_ARGS, role: "photographer" }).includes("c4"));
eq("sound reads its own column",
  selectCrewReservationIds(CREW_ROWS, { productionIds: ["prod_B"], role: "sound", nextName: "יולי יחזקאלי" }), ["c2"]);
eq("accepts a Set as well as an array",
  selectCrewReservationIds(CREW_ROWS, { productionIds: new Set(["prod_A"]), role: "photographer", nextName: "יולי יחזקאלי" }), ["c1"]);
eq("role \"custom\" has no snapshot column ⇒ []",
  selectCrewReservationIds(CREW_ROWS, { ...CREW_ARGS, role: "custom" }), []);
eq("unknown role ⇒ []", selectCrewReservationIds(CREW_ROWS, { ...CREW_ARGS, role: "director" }), []);
eq("empty production set ⇒ []",
  selectCrewReservationIds(CREW_ROWS, { productionIds: [], role: "photographer", nextName: "x" }), []);
eq("blank target name ⇒ []",
  selectCrewReservationIds(CREW_ROWS, { ...CREW_ARGS, role: "photographer", nextName: "" }), []);
eq("idempotent after the write",
  selectCrewReservationIds(
    CREW_ROWS.map(r => (r.id === "c1" ? { ...r, crew_photographer_name: "יולי יחזקאלי" } : r)),
    { ...CREW_ARGS, role: "photographer" }), []);

console.log("\nselectStudioBookingIdsForRename — BY studentId");
const BOOKINGS = [
  { id: "b1", studentId: "s1", studentName: "יולי פורת" },
  { id: "b2", studentId: "s1", studentName: "יולי יחזקאלי" },
  { id: "b3", studentId: "s2", studentName: "יולי פורת" },
  { id: "b4", studentId: "s1", studentName: "יולי פורת", lesson_auto: true },
  { id: "b5", studentName: "יולי פורת" },
];
const BARGS = { studentId: "s1", nextName: "יולי יחזקאלי" };
eq("only this student's stale bookings", selectStudioBookingIdsForRename(BOOKINGS, BARGS), ["b1"]);
check("b3 belongs to another student — untouched",
  !selectStudioBookingIdsForRename(BOOKINGS, BARGS).includes("b3"));
check("b4 is lesson_auto — never persisted, never written",
  !selectStudioBookingIdsForRename(BOOKINGS, BARGS).includes("b4"));
check("b5 has no studentId — untouched",
  !selectStudioBookingIdsForRename(BOOKINGS, BARGS).includes("b5"));
eq("blank studentId ⇒ []", selectStudioBookingIdsForRename(BOOKINGS, { studentId: "", nextName: "x" }), []);
eq("idempotent after the write",
  selectStudioBookingIdsForRename(
    BOOKINGS.map(b => (b.id === "b1" ? { ...b, studentName: "יולי יחזקאלי" } : b)), BARGS), []);

console.log("\nselectProductionIdsForRename — BY directorStudentId, both shapes");
const PRODS = [
  { id: "p1", directorStudentId: "s1", directorName: "יולי פורת" },
  { id: "p2", directorStudentId: "s1", directorName: "יולי יחזקאלי" },
  { id: "p3", director_student_id: "s1", director_name: "יולי פורת" },
  { id: "p4", directorStudentId: "s2", directorName: "יולי פורת" },
];
const PARGS = { studentId: "s1", nextName: "יולי יחזקאלי" };
eq("blob shape and raw row shape both resolve", selectProductionIdsForRename(PRODS, PARGS), ["p1", "p3"]);
check("p2 already matches — untouched", !selectProductionIdsForRename(PRODS, PARGS).includes("p2"));
check("p4 has another director — untouched", !selectProductionIdsForRename(PRODS, PARGS).includes("p4"));
eq("blank studentId ⇒ []", selectProductionIdsForRename(PRODS, { studentId: "", nextName: "x" }), []);
eq("idempotent after the write",
  selectProductionIdsForRename(
    PRODS.map(p => (p.id === "p1" ? { ...p, directorName: "יולי יחזקאלי" }
      : p.id === "p3" ? { ...p, director_name: "יולי יחזקאלי" } : p)), PARGS), []);

console.log("\nmodule contract");
{
  const code = stripComments(read("../src/utils/studentIdentity.js"));
  check("stays dependency-free — it must run under plain Node and from api/",
    !/^\s*import\s/m.test(code));
  check("no Date() — nothing here is time-dependent", !/new\s+Date\s*\(/.test(code));
}

console.log(
  failures.length === 0
    ? `\n\x1b[32m\x1b[1mOK ${passed}/${passed} student-identity tests passed\x1b[0m\n`
    : `\n\x1b[31m\x1b[1m${failures.length} FAILED\x1b[0m of ${passed + failures.length}:\n  ${failures.join("\n  ")}\n`
);
process.exit(failures.length === 0 ? 0 : 1);
