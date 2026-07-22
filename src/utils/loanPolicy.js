// loanPolicy.js — the ONE source of truth for per-loan-type lead-time ("זמן
// התראה") and duration rules.
//
// Extracted verbatim from the inline computations in PublicForm.jsx (the
// creation form) so that the reservation-UPDATE flow ("ההזמנות שלי" →
// add/replace items) applies the exact same rules instead of growing a
// parallel rule system that drifts. PublicForm now calls these helpers for
// minDays/minDate/maxDays; api/student-submit-reservation-update.js re-checks
// the same rules server-side on submit.
//
// DELIBERATELY SELF-CONTAINED — zero imports. This module is shared with
// Vercel serverless functions (api/*), and src/utils.js pulls in
// supabaseClient.js (import.meta.env — Vite-only), so importing from there
// would break the server bundle. The three tiny date helpers below are
// byte-for-byte copies of their utils.js namesakes; they are stable
// primitives, not policy.
//
// SEMANTICS (mirrors the creation form exactly — keep in sync with nothing,
// this IS the source):
//   * minDate is computed from "now": today + minDays (cinema: forced +1),
//     then rolled forward off Fri/Sat to the next weekday.
//   * The rejection test is STRICT: borrow_date < minDate blocks;
//     borrow_date === minDate is allowed.
//   * Sound loans have no calendar lead — instead a 3-hour lead before the
//     borrow moment (which is aligned to the tied studio session).
//   * "8-day notice" for הפקה is INCLUSIVE (submission day + borrow day), so
//     the calendar gap is 7 days. Mirrored in ProductionEditor.minShootISO().

// ─── date primitives ──────────────────────────────────────────────────────
const POLICY_TIME_ZONE = "Asia/Jerusalem";

function zonedParts(dateOrMs, timeZone = POLICY_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(dateOrMs));
  const out = {};
  for (const part of parts) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return out;
}

function dateStrInPolicyZone(dateOrMs) {
  const p = zonedParts(dateOrMs);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function addCalendarDays(dateStr, days) {
  const [y, m, d] = String(dateStr || "").split("-").map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function policyWeekday(dateStr) {
  const [y, m, d] = String(dateStr || "").split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
}

// Convert an Asia/Jerusalem wall-clock value to an absolute timestamp. This
// keeps the browser and the UTC-based Vercel runtime on the same clock and
// handles Israel daylight-saving transitions through Intl.
function policyWallTimeMs(dateStr, timeStr) {
  const [y, m, d] = String(dateStr || "").split("-").map(Number);
  const [h, min] = String(timeStr || "00:00").split(":").map(Number);
  if (!y || !m || !d) return 0;
  const wallUtc = Date.UTC(y, m - 1, d, Number.isFinite(h) ? h : 0, Number.isFinite(min) ? min : 0, 0);
  let guess = wallUtc;
  for (let i = 0; i < 3; i += 1) {
    const p = zonedParts(guess);
    const representedAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess = wallUtc - (representedAsUtc - guess);
  }
  return guess;
}

export function formatLocalDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}

export function toDateTime(dateStr, timeStr) {
  return policyWallTimeMs(dateStr, timeStr);
}

// Fri(5)/Sat(6) → the warehouse is closed.
export function isWeekendDateStr(dateStr) {
  if (!dateStr) return false;
  const d = parseLocalDate(dateStr);
  return d.getDay() === 5 || d.getDay() === 6;
}

export function moveToNextWeekday(dateStr) {
  let next = dateStr;
  while (policyWeekday(next) === 5 || policyWeekday(next) === 6) next = addCalendarDays(next, 1);
  return next;
}

// ─── policy ────────────────────────────────────────────────────────────────
// Sound loan: equipment must be requested at least 3 hours before the start
// of the studio session it's tied to.
export const SOUND_MIN_LEAD_TIME_MS = 3 * 60 * 60 * 1000;

// פרטית / קולנוע יומית: the published policy is "24 שעות התראה מוקדמת", and for
// the UPDATE window the product owner wants that read literally — a precise
// 24-hour clock against the pickup moment, not the calendar-day approximation
// the creation form uses. (This reverses the earlier "keep it day-based"
// decision; see HANDOFF-D.) הפקה stays on the calendar/weekday rule.
export const DAY_LOAN_MIN_LEAD_TIME_MS = 24 * 60 * 60 * 1000;

// Loan types whose UPDATE window is measured in exact hours rather than in
// calendar days. Returns null for the calendar-based types (הפקה and anything
// unrecognised), which keep the weekday-rolled minDate rule.
export function hourlyUpdateLeadMs(loanType) {
  const t = String(loanType || "").trim();
  if (t === "סאונד") return SOUND_MIN_LEAD_TIME_MS;
  if (t === "פרטית" || t === "קולנוע יומית") return DAY_LOAN_MIN_LEAD_TIME_MS;
  return null;
}

export function loanMinDays(loanType) {
  return loanType === "פרטית" ? 1
    : loanType === "סאונד" ? 0
    : loanType === "קולנוע יומית" ? 0
    : loanType === "הפקה" ? 7
    : 7;
}

export function loanMaxDays(loanType) {
  return loanType === "פרטית" ? 4 : loanType === "קולנוע יומית" ? 1 : 7;
}

// The earliest borrow_date a new submission may target, as of `now`.
// Cinema-daily is minDays=0 on paper but forces a +1 ("24h ahead") — the same
// branch the creation form always had.
export function computeMinBorrowDate(loanType, now = new Date()) {
  const isCinema = loanType === "קולנוע יומית";
  const todayInIsrael = dateStrInPolicyZone(now);
  return moveToNextWeekday(addCalendarDays(todayInIsrael, isCinema ? 1 : loanMinDays(loanType)));
}

// ─── the update-flow gate ─────────────────────────────────────────────────
// May this reservation still receive an ADD / INCREASE / REPLACE update?
// (Removal is NOT gated by lead time — only by status, elsewhere.)
//
// The question asked is: "if the student were submitting this borrow window
// right now, would the creation form accept it?" — which is exactly
// borrow_date < computeMinBorrowDate(...) for calendar-lead types, and the
// 3-hour rule for sound. Boundary semantics are identical to the creation
// form (equal-to-minDate allowed; exactly-3h allowed).
//
// Returns { allowed, reason } — reason is a student-facing Hebrew string.
export function getUpdateLeadTimeState(reservation, nowMs = Date.now()) {
  const loanType = String(reservation?.loan_type || "").trim();
  const borrowDate = String(reservation?.borrow_date || "").trim();
  const borrowTime = String(reservation?.borrow_time || "").trim();
  if (!borrowDate) return { allowed: false, reason: "להזמנה אין תאריך איסוף." };

  // Universal: once the borrow moment has passed, nothing may be added —
  // regardless of type. (Status gating also blocks this; belt and braces.)
  if (toDateTime(borrowDate, borrowTime || "00:00") <= nowMs) {
    return { allowed: false, reason: "מועד האיסוף כבר הגיע — לא ניתן להוסיף או לעדכן פריטים." };
  }

  // Hour-precise types (סאונד 3h · פרטית / קולנוע יומית 24h) — measured against
  // the actual pickup moment, so the cutoff lands on the same clock time.
  const hourlyLead = hourlyUpdateLeadMs(loanType);
  if (hourlyLead != null) {
    const remainingMs = toDateTime(borrowDate, borrowTime || "00:00") - nowMs;
    if (remainingMs < hourlyLead) {
      const reason = loanType === "סאונד"
        ? "נותרו פחות מ-3 שעות לתחילת הסשן — לא ניתן להוסיף או לעדכן פריטים. ניתן עדיין להחסיר פריטים."
        : "נותרו פחות מ-24 שעות למועד האיסוף — לא ניתן להוסיף או לעדכן פריטים. ניתן עדיין להחסיר פריטים.";
      return { allowed: false, reason };
    }
    return { allowed: true, reason: "" };
  }

  const minDate = computeMinBorrowDate(loanType, new Date(nowMs));
  if (borrowDate < minDate) {
    const label = loanType === "פרטית" ? "השאלה פרטית דורשת התראה של 24 שעות לפחות"
      : loanType === "קולנוע יומית" ? "השאלת קולנוע יומית דורשת הזמנה של 24 שעות מראש"
      : loanType === "הפקה" ? "השאלת הפקה דורשת התראה של 8 ימים"
      : "סוג ההשאלה דורש התראה של שבוע לפחות";
    return { allowed: false, reason: `חלון ההתראה נסגר — ${label}. ניתן עדיין להחסיר פריטים.` };
  }
  return { allowed: true, reason: "" };
}

// The LAST moment a student may still submit an add/increase update for this
// reservation — i.e. when the lead-time window closes. Derived from the exact
// same rules as getUpdateLeadTimeState, so the two can never disagree.
//
// Returns { date:"YYYY-MM-DD", time:"HH:MM" } or null when there is no
// meaningful deadline (missing borrow date, or the window is already shut):
//   * hour-precise types — an exact instant: סאונד 3h, and פרטית / קולנוע יומית
//     24h, before the pickup moment. A 14:30 pickup therefore closes at 14:30
//     the day before, not at 23:59.
//   * calendar-lead types (הפקה) — a whole DAY: the latest calendar day on
//     which computeMinBorrowDate() still allows the borrow date. That gate is
//     date-granular, so the window stays open through 23:59 on that day.
export function computeUpdateDeadline(reservation, nowMs = Date.now()) {
  const loanType = String(reservation?.loan_type || "").trim();
  const borrowDate = String(reservation?.borrow_date || "").trim();
  const borrowTime = String(reservation?.borrow_time || "").trim();
  if (!borrowDate) return null;

  const hourlyLead = hourlyUpdateLeadMs(loanType);
  if (hourlyLead != null) {
    const at = toDateTime(borrowDate, borrowTime || "00:00") - hourlyLead;
    if (at <= nowMs) return null; // window already shut
    const p = zonedParts(at);
    return {
      date: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`,
      time: `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`,
    };
  }

  // Walk back from the borrow date to the latest day whose minDate still fits.
  let cursor = borrowDate;
  for (let i = 0; i < 400 && cursor; i += 1) {
    const cursorNoon = policyWallTimeMs(cursor, "12:00");
    if (computeMinBorrowDate(loanType, new Date(cursorNoon)) <= borrowDate) {
      return { date: cursor, time: "23:59" };
    }
    cursor = addCalendarDays(cursor, -1);
  }
  return null;
}
