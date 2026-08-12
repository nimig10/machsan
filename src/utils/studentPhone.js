// studentPhone.js — where a student's phone number lives, and which copy wins.
//
// Extracted here after this logic broke twice in two days:
//   * the priority order was inverted for production loans, so a stale
//     auto-filled number beat the one the director had just typed;
//   * fields were seeded from the login-time session snapshot instead of the
//     roster, so a new production offered a number already replaced twice.
//
// Both were pure functions buried in utils.js, which imports the Supabase
// client and therefore cannot be loaded under plain Node — meaning neither bug
// could be covered by a test. Hence this module.
//
// Dependency-free BY CONTRACT — unit-tested under plain Node, and staying
// import-free keeps it usable from api/ without dragging in the browser client
// (same rule as loanPolicy.js / returnFlow.js / announcementPolicy.js, lesson #40).

// ── the one rule ────────────────────────────────────────────────────────────
//
// `students.phone` is the single source of truth. Everything else — the
// reservation snapshot, the cached session, the sessionStorage form draft — is
// a photograph of it, and photographs go stale. A photograph may FILL an empty
// roster cell; it may never REPLACE a value already there. Only a number a
// human just typed may do that.

/** Digits-and-plus only, so separators never trip validation. */
export function stripPhone(raw) {
  return String(raw ?? "").trim().replace(/[^\d+]/g, "");
}

/**
 * Is this a usable phone number? 7–15 digits with an optional leading '+',
 * which covers Israeli locals, US, and international forms.
 *
 * Shared so the client field, the production editor and both API endpoints
 * cannot drift apart on what they accept.
 */
export function isValidPhone(raw) {
  const clean = stripPhone(raw);
  return !!clean && /^\+?\d{7,15}$/.test(clean);
}

/**
 * Israeli number → international digits for a wa.me deep link.
 * "054-123-4567" / "+972541234567" / "972541234567" → "972541234567".
 * Returns "" when there is nothing usable.
 */
export function normalizeIsraeliPhone(raw = "") {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("972")) return digits;
  if (digits.startsWith("0")) return `972${digits.slice(1)}`;
  return digits;
}

const emailKey = (row) => String(row?.email || "").trim().toLowerCase();
const phoneOf = (row) => String(row?.phone || "").trim();

/**
 * Where to find this reservation's student phone, in order of trust.
 *
 *   1. the reservation's own snapshot — right whenever it is filled;
 *   2. the roster row for that email — the source of truth;
 *   3. the newest other reservation by the same email.
 *
 * (3) exists because production loans never asked for a phone, so for most of
 * them (1) is empty and (2) was empty too — while the student had typed a
 * number into some private/sound request months earlier.
 *
 * Both lists are already in memory at every call site, so this costs no query.
 * Returns "" when the number exists nowhere, which is a real outcome for a
 * student whose only request is a production one.
 */
export function resolveStudentPhone(reservation, { students = [], reservations = [] } = {}) {
  const own = phoneOf(reservation);
  if (own) return own;

  const email = emailKey(reservation);
  if (!email) return "";
  const sameEmail = (row) => emailKey(row) === email;

  const fromRoster = (students || []).find(s => sameEmail(s) && phoneOf(s));
  if (fromRoster) return phoneOf(fromRoster);

  // Newest first — a number entered recently beats one from a year ago.
  const fromOtherRequest = (reservations || [])
    .filter(r => sameEmail(r) && phoneOf(r))
    .sort((a, b) => String(b?.borrow_date || "").localeCompare(String(a?.borrow_date || "")))[0];
  return fromOtherRequest ? phoneOf(fromOtherRequest) : "";
}

/**
 * Which number a submission should carry.
 *
 * The order flips for production loans, and that flip IS the bug this module
 * was extracted over. On a production, step 1 renders an identity card with no
 * phone input at all — so `formPhone` there is never something the student
 * typed, only what was auto-filled or restored from the session draft. The
 * production's own field is the explicit entry, so it goes first.
 *
 * Everywhere else the phone field is visible and required, so `formPhone` is
 * the student's real answer and wins.
 *
 * `sessionPhone` is last everywhere: it is the login-time snapshot.
 */
export function pickSubmissionPhone({ isProduction = false, formPhone = "", productionPhone = "", sessionPhone = "" } = {}) {
  const form = String(formPhone || "").trim();
  const production = String(productionPhone || "").trim();
  const session = String(sessionPhone || "").trim();
  const primary = isProduction ? (production || form) : form;
  return primary || session || "";
}

/**
 * May this number replace one the roster already holds?
 *
 * Only if a human typed it on this screen. An auto-filled value is an echo, not
 * an answer, and letting an echo write to the roster is how a number the office
 * had just corrected came back from the dead.
 *
 * NOTE: this decides INTENT only. Permission is a separate question, settled
 * server-side — the overwrite path runs through a JWT-verified endpoint that
 * identifies the student from the token, never from the request body.
 */
export function mayOverwriteRosterPhone({ isProduction = false, phoneTouched = false, productionPhone = "" } = {}) {
  if (isProduction) return !!String(productionPhone || "").trim();
  return !!phoneTouched;
}
