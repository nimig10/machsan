// studentIdentity.js — who a student IS, and which copy of their name wins.
//
// Written after a student's loan request went out under a name the college had
// never heard of. She had not renamed herself anywhere: `students.name`,
// `public.users.full_name` and `auth.users.metadata.full_name` all still held
// the roster spelling. The divergent name existed in exactly ONE row in the
// whole database — the reservation — because the loan form used to expose
// שם פרטי / שם משפחה as free-text inputs, the value survived in the
// sessionStorage draft, and the loan-type selector above it did not reset it.
// So a name typed into a "קולנוע יומית" form leaked into a "הפקה" submission,
// whose identity card only LOOKS read-only.
//
// It was not a one-off: 31 rows across 3 students, two of them plain typos
// ("נמרוד"/"נימרוד", "ירמי"/"ירימי") that nobody had a way to correct.
//
// And it is not cosmetic. A drifted name breaks three things that key on the
// name rather than on the email:
//   * staff search — `r.student_name?.includes(search)` finds nothing;
//   * the production certification gate — matchByNamePhone() matches crew to
//     certifications by NORMALIZED NAME, so the student's certs stop counting
//     and approval is blocked with a lie;
//   * api/check-overdue.js, which reads the name straight out of the DB for the
//     overdue email and the push-notification body.
// The last one is why this is fixed in the DATA and not in the display: a
// client-side "resolve it live" layer can never reach a cron job.
//
// ── the one rule ────────────────────────────────────────────────────────────
//
// `public.students` is the single source of a student's name. Every other copy
// — reservations_new.student_name, crew_photographer_name / crew_sound_name,
// studio_bookings.student_name, productions.director_name — is a photograph,
// and photographs go stale. No write path may accept a typed name, and a rename
// on the roster must reach every photograph.
//
// Dependency-free BY CONTRACT — unit-tested under plain Node, and staying
// import-free keeps it usable from api/ without dragging in the browser
// Supabase client (same rule as loanPolicy.js / studentPhone.js / returnFlow.js,
// lesson #40).

// ── keys ────────────────────────────────────────────────────────────────────

/**
 * The name key used by the certification matcher and by both search boxes.
 *
 * VERBATIM copy of normalizeName in src/utils.js and of the copy in
 * src/utils/reservationUpdateReview.js. The three must stay byte-identical —
 * a cert gate that normalizes differently from the roster silently stops
 * matching, which is the exact failure this module exists to prevent. Pinned
 * by a test that reads both files.
 */
export function normalizeNameKey(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** The identity key. Email — never the name — links a person to their history. */
export function emailKeyOf(row) {
  return String(row?.email || "").trim().toLowerCase();
}

/** Collapse runs of whitespace without lowercasing: "א  ב " → "א ב". */
function collapse(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

// ── display halves ──────────────────────────────────────────────────────────
//
// `students.name` is ONE column. The "שם פרטי / שם משפחה" columns in the roster
// and the two halves the loan form used to carry are a presentation split, and
// they round-trip only because joinName(splitFullName(x)) === collapse(x).
// Nothing is stored split, so nothing may depend on the split being
// semantically right — 23 of 174 students in production have three-word names
// where "first word + rest" is a guess, not a fact.

/** "יהודה אריה לייב" → { first: "יהודה", last: "אריה לייב" }. */
export function splitFullName(full) {
  const parts = collapse(full).split(" ").filter(Boolean);
  return { first: parts[0] || "", last: parts.slice(1).join(" ") };
}

/** The exact inverse of splitFullName for any value it produced. */
export function joinName(first, last) {
  return [collapse(first), collapse(last)].filter(Boolean).join(" ");
}

// ── resolution ──────────────────────────────────────────────────────────────

/**
 * The roster's name for whoever `identity` is, by email.
 *
 * Returns "" when there is no email or no matching row — NEVER a fallback to
 * some other student. Callers treat "" as "keep what you had"; handing back a
 * near-match would put one student's name on another's request.
 */
export function resolveRosterName(identity, students) {
  const key = emailKeyOf(identity);
  if (!key) return "";
  const row = (students || []).find((s) => emailKeyOf(s) === key);
  return collapse(row?.name);
}

/**
 * Is this rename worth cascading?
 *
 * Blank `next` is never a rename — a cascade may not erase a name that history
 * still displays. A whitespace-only difference is not a rename either; without
 * this the roster's 700ms autosave would fire a cascade on every keystroke that
 * lands on a space. Case IS significant: "john" → "John" is a real correction.
 */
export function nameNeedsCascade(prev, next) {
  const nextName = collapse(next);
  if (!nextName) return false;
  return collapse(prev) !== nextName;
}

// ── cascade selectors ───────────────────────────────────────────────────────
//
// Every selector below is idempotent BY CONSTRUCTION: it only returns rows
// whose stored name differs from the target, so feeding it the post-write rows
// returns []. That is what keeps the autosave-driven cascade from looping.

/**
 * Lesson loans carry a LECTURER's name against a LECTURER's email. If one
 * person is both a student and a lecturer, an email-keyed cascade would
 * overwrite the lecturer's name on their own lessons.
 */
export const RENAME_EXCLUDED_LOAN_TYPES = ["שיעור"];

/** May a rename touch this reservation at all? */
export function isCascadableReservation(row) {
  if (!row) return false;
  if (row.lesson_auto === true) return false;
  return !RENAME_EXCLUDED_LOAN_TYPES.includes(String(row.loan_type || ""));
}

/**
 * Reservations to restamp, BY EMAIL.
 *
 * Deliberately not by the old name: the old name is the one value we have
 * already proved untrustworthy, and two students can share one. A row carrying
 * the old spelling but somebody else's email is NOT selected.
 */
export function selectReservationIdsForRename(rows, { emailKey, nextName } = {}) {
  const key = String(emailKey || "").trim().toLowerCase();
  const name = collapse(nextName);
  if (!key || !name) return [];
  return (rows || [])
    .filter((r) => isCascadableReservation(r)
      && emailKeyOf(r) === key
      && String(r?.student_name ?? "") !== name)
    .map((r) => r.id);
}

/**
 * Production-crew snapshots to restamp, BY `production_id`.
 *
 * The caller resolves which productions this student is approved crew on via
 * `production_crew.student_id` — a real foreign key — and passes the ids in.
 * Matching on the stored crew name instead would mean trusting the very value
 * being repaired, and unlike the borrower there is no crew email on the row to
 * fall back to. `role` is "photographer" or "sound"; "custom" has no snapshot.
 */
export function selectCrewReservationIds(rows, { productionIds, role, nextName } = {}) {
  const column = role === "photographer" ? "crew_photographer_name"
    : role === "sound" ? "crew_sound_name"
    : null;
  const name = collapse(nextName);
  if (!column || !name) return [];
  const ids = productionIds instanceof Set
    ? productionIds
    : new Set((productionIds || []).map((v) => String(v)));
  if (ids.size === 0) return [];
  return (rows || [])
    .filter((r) => r?.production_id != null
      && ids.has(String(r.production_id))
      && String(r?.[column] ?? "") !== name)
    .map((r) => r.id);
}

/**
 * Studio bookings to restamp, BY `studentId` (the blob shape from
 * studioBookingsApi.rowToBlob). `lesson_auto` entries are derived from
 * lessons.schedule and are never persisted — writing to them is meaningless.
 */
export function selectStudioBookingIdsForRename(bookings, { studentId, nextName } = {}) {
  const sid = String(studentId || "").trim();
  const name = collapse(nextName);
  if (!sid || !name) return [];
  return (bookings || [])
    .filter((b) => b?.lesson_auto !== true
      && String(b?.studentId || "") === sid
      && String(b?.studentName ?? "") !== name)
    .map((b) => b.id);
}

/**
 * Productions whose `director_name` snapshot is stale, BY `directorStudentId`.
 * Accepts either the blob shape (`directorStudentId`) or a raw row
 * (`director_student_id`), because the cascade queries the table directly.
 */
export function selectProductionIdsForRename(productions, { studentId, nextName } = {}) {
  const sid = String(studentId || "").trim();
  const name = collapse(nextName);
  if (!sid || !name) return [];
  return (productions || [])
    .filter((p) => String(p?.directorStudentId ?? p?.director_student_id ?? "") === sid
      && String(p?.directorName ?? p?.director_name ?? "") !== name)
    .map((p) => p.id);
}
