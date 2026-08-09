// nightTrainingApi.js — thin client wrappers around /api/night-training.
//
// All three night_* tables are RLS-on with no anon/authenticated policy, so
// there is no supabase.from("night_quiz_attempts") path — the endpoint is the
// only way in. It also owns eligibility and scoring: the browser never sees a
// correct answer and never decides whether an attempt passed.

import { getAuthToken } from "../utils.js";

async function authHeaders() {
  const token = await getAuthToken();
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function post(body) {
  try {
    const res = await fetch("/api/night-training", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return { ok: false, error: data.error || `HTTP ${res.status}`, detail: data.detail };
    }
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: "network_error", detail: String(e?.message || e) };
  }
}

// ─── student ───────────────────────────────────────────────────────────────

// Issues a quiz, or returns the one already open (same questions, same order) —
// so a refresh mid-exam does not silently restart it.
export function startNightQuiz() { return post({ action: "start" }); }

// answers: [{ n, choice }] — n is the 1-based presented position, choice the
// 0-based index into that question's presented options (null = unanswered).
// Scoring happens server-side; the reply names the questions that were wrong
// and what was picked, never what was right.
export function submitNightQuiz(attemptId, answers) {
  return post({ action: "submit", attemptId, answers });
}

// Takes no payload on purpose — who reported the closing comes from the JWT.
export function completeNightChecklist() { return post({ action: "checklist-complete" }); }

export function fetchMyNightStatus() { return post({ action: "my-status" }); }

// ─── staff ─────────────────────────────────────────────────────────────────

export function staffListNightTraining() { return post({ action: "staff-list" }); }

// One attempt with its full per-question breakdown, including correct answers.
export function staffGetNightAttempt(attemptId) {
  return post({ action: "staff-attempt", attemptId });
}

// ─── shared copy ───────────────────────────────────────────────────────────

// Endpoint error codes → Hebrew. Kept here so the modal and the staff panel
// cannot drift apart on wording.
export const NIGHT_ERROR_MESSAGES = {
  no_student_record: "לא נמצא רישום סטודנט עבור המשתמש הזה.",
  not_eligible: "המבחן פתוח לסטודנטים במסלול הנדסאי סאונד או הנדסאי קולנוע בלבד.",
  attempt_not_found: "המבחן לא נמצא. אפשר להתחיל מבחן חדש.",
  attempt_expired: "המבחן פג תוקף. יש להתחיל מבחן חדש.",
  already_submitted: "המבחן הזה כבר הוגש.",
  bank_changed: "בנק השאלות עודכן באמצע המבחן. יש להתחיל מבחן חדש.",
  invalid_answers: "אירעה שגיאה בשליחת התשובות. נסו שוב.",
  daily_limit: "הגעת למספר המרבי של ניסיונות להיום. נסו שוב מחר.",
  network_error: "שגיאת רשת. נסו שוב.",
};

export function nightErrorMessage(code) {
  return NIGHT_ERROR_MESSAGES[code] || "אירעה שגיאה. נסו שוב.";
}
