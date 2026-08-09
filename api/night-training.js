// night-training.js — the night-training theory exam and the closing checklist.
//
// PROTOCOL (all POST, action-routed)
//   { action: "start" }                          -> issue/resume an attempt
//   { action: "submit", attemptId, answers }     -> score it, once
//   { action: "checklist-complete" }             -> record a reported closing
//   { action: "my-status" }                      -> this student's own history
//   { action: "staff-list" }                     -> the staff results panel
//   { action: "staff-attempt", attemptId }       -> one attempt, with the key
//
// AUTH
//   Student actions: requireUser + resolveEligibleStudent
//   Staff actions:   requireStaff
//
// THIS ENDPOINT IS THE GATE, NOT THE UI.
// PublicForm hides the button from students whose track classification is not
// sound/cinema, but that is convenience only — eligibility is re-checked here
// on every action, from the caller's JWT (lesson #37+#41). Identity, name,
// email and track all come from the students row resolved by JWT email; nothing
// identity-bearing is ever read out of the request body. The original tool
// asked the student to type their own name, which is exactly the unverified
// identity hole that got api/activity-log tightened in PR #89.
//
// WHY SCORING LIVES HERE AND NOT IN THE BROWSER
// ---------------------------------------------
// Passing produces the "עבר עיוני" marker a staff member acts on when granting
// cert_night_studio. If the browser scored, a student could forge it from
// devtools. So correct answers never leave the server: "start" returns
// questions with no answer fields, and "submit" returns which questions were
// wrong and what the student picked — never what was right.
//
// HARD GUARANTEE — display and record only. Nothing here writes to
// student_certifications or touches reservations, equipment, studios or any RPC.

import { requireUser, requireStaff } from "./_auth-helper.js";
import {
  BANK_VERSION, QUIZ_SIZE, ATTEMPT_TTL_MINUTES, MAX_ATTEMPTS_PER_DAY,
  makeSeed, pickQuestionIds, buildAttemptView, scoreAttempt, toStudentResult,
} from "./_night-quiz.js";
import { CHECKLIST_ITEM_COUNT, CHECKLIST_VERSION } from "../src/utils/nightChecklist.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const H = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

const enc = (v) => encodeURIComponent(String(v));

// Tracks whose students sit this exam. These are the two values of the
// "סיווג מסלול" select in StudentsPage — labelled there as הנדסאי סאונד and
// הנדסאי קולנוע. Keep in sync with canSeeNightTraining in PublicForm.jsx.
const ELIGIBLE_TRACK_TYPES = new Set(["sound", "cinema"]);

async function sb(path, options = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: H, ...options });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { ok: r.ok, status: r.status, data, text };
}

// The "night of" date rather than the calendar date. A closing is reported
// after midnight by definition — the alarm-code step gives you three minutes to
// leave the building — so a report at 01:30 belongs to the night that began the
// previous evening, which is the night staff will look for. Shifting back six
// hours puts everything from 06:00 onwards on its own day and everything before
// it on the night before.
function nightOfDate(at = new Date()) {
  const shifted = new Date(at.getTime() - 6 * 60 * 60 * 1000);
  return shifted.toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" }).slice(0, 10);
}

// The caller's students row + track classification, or an error code.
//
// Matching is by lowercased email with eq., the same lookup api/auth.js and
// api/staff.js use for students (lecturers are the ilike. case).
async function resolveEligibleStudent(user) {
  const email = String(user?.email || "").toLowerCase().trim();
  if (!email) return { error: "no_student_record" };

  const r = await sb(
    `students?email=eq.${enc(email)}&select=id,name,email,track_id,tracks!track_id(name,track_type)&limit=1`
  );
  if (!r.ok) return { error: "network_error", detail: r.text };

  const row = r.data?.[0];
  if (!row) return { error: "no_student_record" };

  const trackType = row.tracks?.track_type || null;
  if (!ELIGIBLE_TRACK_TYPES.has(trackType)) return { error: "not_eligible" };

  return {
    student: {
      id: row.id,
      name: row.name || "",
      email: row.email || email,
      trackName: row.tracks?.name || null,
      trackType,
    },
  };
}

const fail = (res, status, error, detail) =>
  res.status(status).json(detail ? { ok: false, error, detail } : { ok: false, error });

// ── student actions ────────────────────────────────────────────────────────

// Issue a quiz, or hand back the one already open.
//
// Resuming matters twice over: a refresh mid-exam returns the byte-identical
// quiz (same seed ⇒ same questions, same order, same option order) instead of
// silently restarting, and it stops every reload from minting a row.
async function handleStart(res, student) {
  const nowIso = new Date().toISOString();

  const open = await sb(
    `night_quiz_attempts?student_id=eq.${enc(student.id)}&submitted_at=is.null` +
    `&expires_at=gt.${enc(nowIso)}&select=id,seed,question_ids,total_questions,expires_at,bank_version` +
    `&order=started_at.desc&limit=1`
  );
  if (!open.ok) return fail(res, 500, "network_error", open.text);

  const existing = open.data?.[0];
  if (existing && existing.bank_version === BANK_VERSION) {
    const view = buildAttemptView(existing.seed, existing.question_ids);
    return res.status(200).json({
      ok: true,
      attemptId: existing.id,
      expiresAt: existing.expires_at,
      totalQuestions: existing.total_questions,
      resumed: true,
      questions: view.public,
    });
  }

  // Cap how many quizzes one student may open. The questions are not a secret,
  // but without a cap "start" can be farmed to enumerate the bank, and the
  // attempts table stops being readable for staff.
  //
  // A rolling 24h window rather than a calendar day, deliberately: it needs no
  // timezone arithmetic (a naive "today T00:00" string would be read as UTC, not
  // Asia/Jerusalem, and silently drift the window by three hours) and it is the
  // stricter reading for someone hammering the endpoint at midnight.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recent = await sb(
    `night_quiz_attempts?student_id=eq.${enc(student.id)}&started_at=gte.${enc(since)}` +
    `&select=id&limit=${MAX_ATTEMPTS_PER_DAY}`
  );
  if (recent.ok && Array.isArray(recent.data) && recent.data.length >= MAX_ATTEMPTS_PER_DAY) {
    return fail(res, 429, "daily_limit");
  }

  const seed = makeSeed();
  const questionIds = pickQuestionIds(seed);
  const expiresAt = new Date(Date.now() + ATTEMPT_TTL_MINUTES * 60 * 1000).toISOString();

  const ins = await sb("night_quiz_attempts?select=id,expires_at,total_questions", {
    method: "POST",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({
      student_id: student.id,
      student_name: student.name,
      student_email: student.email,
      track_name: student.trackName,
      track_type: student.trackType,
      bank_version: BANK_VERSION,
      seed,
      question_ids: questionIds,
      total_questions: questionIds.length,
      expires_at: expiresAt,
    }),
  });
  if (!ins.ok) return fail(res, 500, "network_error", ins.text);

  const row = ins.data?.[0];
  const view = buildAttemptView(seed, questionIds);
  return res.status(200).json({
    ok: true,
    attemptId: row.id,
    expiresAt: row.expires_at,
    totalQuestions: row.total_questions,
    resumed: false,
    questions: view.public,
  });
}

// Score a submission — exactly once.
async function handleSubmit(req, res, student) {
  const attemptId = Number(req.body?.attemptId);
  const answers = req.body?.answers;

  if (!Number.isInteger(attemptId) || attemptId <= 0) return fail(res, 400, "invalid_answers");

  // Validate the envelope BEFORE touching the row, so a malformed request never
  // burns the student's attempt.
  if (!Array.isArray(answers) || answers.length !== QUIZ_SIZE) return fail(res, 400, "invalid_answers");
  const positions = new Set();
  for (const a of answers) {
    if (!a || !Number.isInteger(a.n) || a.n < 1 || a.n > QUIZ_SIZE) return fail(res, 400, "invalid_answers");
    if (positions.has(a.n)) return fail(res, 400, "invalid_answers");
    positions.add(a.n);
  }

  const got = await sb(
    `night_quiz_attempts?id=eq.${attemptId}&select=id,student_id,seed,question_ids,total_questions,submitted_at,expires_at,bank_version&limit=1`
  );
  if (!got.ok) return fail(res, 500, "network_error", got.text);

  const row = got.data?.[0];
  if (!row) return fail(res, 404, "attempt_not_found");
  // Ownership is checked against the JWT-resolved student, not the body.
  if (String(row.student_id) !== String(student.id)) return fail(res, 404, "attempt_not_found");
  if (row.submitted_at) return fail(res, 409, "already_submitted");
  if (new Date(row.expires_at).getTime() <= Date.now()) return fail(res, 409, "attempt_expired");
  // The bank changed under an in-flight attempt. Refusing beats mis-scoring;
  // the student simply starts a fresh quiz.
  if (row.bank_version !== BANK_VERSION) return fail(res, 409, "bank_changed");

  // Score first, in memory, then claim. Doing it in this order means a crash can
  // never leave a claimed-but-unscored row.
  const scored = scoreAttempt(row.seed, row.question_ids, answers);

  // THE REPLAY DEFENCE. The submitted_at=is.null filter makes this a row-level
  // compare-and-set: whoever updates the row first wins, everyone else gets zero
  // rows back. Without it, the fail screen — which names the questions you got
  // wrong — becomes an oracle: resubmit varying one answer at a time and the
  // whole key falls out in under 60 requests, then a clean 15/15 produces a real
  // passed=true row that a staff member acts on. Do not remove this filter and
  // do not replace it with a read-then-write.
  const claim = await sb(
    `night_quiz_attempts?id=eq.${attemptId}&student_id=eq.${enc(student.id)}&submitted_at=is.null`,
    {
      method: "PATCH",
      headers: { ...H, Prefer: "return=representation" },
      body: JSON.stringify({
        submitted_at: new Date().toISOString(),
        score: scored.score,
        passed: scored.passed,
      }),
    }
  );
  if (!claim.ok) return fail(res, 500, "network_error", claim.text);
  if (!Array.isArray(claim.data) || claim.data.length === 0) return fail(res, 409, "already_submitted");

  // Per-question detail for the staff review. The authoritative result is
  // already committed above, so a failure here is logged and swallowed — losing
  // the breakdown must not show the student an error after they finished.
  const answerRows = scored.details.map((d) => ({
    attempt_id: attemptId,
    question_number: d.n,
    question_id: d.questionId,
    question_text: d.questionText,
    chosen_text: d.chosenText,
    correct_text: d.correctText,
    is_correct: d.isCorrect,
  }));
  const detail = await sb("night_quiz_answers", { method: "POST", body: JSON.stringify(answerRows) });
  if (!detail.ok) console.error("[night-training] answer detail insert failed:", detail.text);

  // toStudentResult is the single choke point that strips correct answers.
  return res.status(200).json({ ok: true, ...toStudentResult(scored) });
}

// Record a reported closing. Takes NO payload — name, email and track come from
// the resolved student, and the totals from the imported constants, so the
// stored row cannot disagree with the list the student actually worked through.
async function handleChecklistComplete(res, student) {
  const now = new Date();
  const ins = await sb("night_closing_checklists?select=id,completed_at,completed_on", {
    method: "POST",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({
      student_id: student.id,
      student_name: student.name,
      student_email: student.email,
      track_name: student.trackName,
      items_total: CHECKLIST_ITEM_COUNT,
      list_version: CHECKLIST_VERSION,
      completed_on: nightOfDate(now),
      completed_at: now.toISOString(),
    }),
  });
  if (!ins.ok) return fail(res, 500, "network_error", ins.text);
  const row = ins.data?.[0];
  return res.status(200).json({ ok: true, id: row?.id, completedAt: row?.completed_at });
}

// This student's own history — drives "כבר עברת את המבחן העיוני" in the modal.
async function handleMyStatus(res, student) {
  const [attempts, lastChecklist] = await Promise.all([
    sb(`night_quiz_attempts?student_id=eq.${enc(student.id)}&submitted_at=not.is.null` +
       `&select=id,submitted_at,score,total_questions,passed&order=submitted_at.desc&limit=20`),
    sb(`night_closing_checklists?student_id=eq.${enc(student.id)}&select=completed_at&order=completed_at.desc&limit=1`),
  ]);
  if (!attempts.ok) return fail(res, 500, "network_error", attempts.text);

  const rows = attempts.data || [];
  return res.status(200).json({
    ok: true,
    passedTheory: rows.some((a) => a.passed),
    attempts: rows.map((a) => ({
      id: a.id,
      submittedAt: a.submitted_at,
      score: a.score,
      total: a.total_questions,
      passed: a.passed,
    })),
    lastChecklistAt: lastChecklist.ok ? (lastChecklist.data?.[0]?.completed_at || null) : null,
  });
}

// ── staff actions ──────────────────────────────────────────────────────────

// The panel that replaces the Google Sheet: one row per student who has sat the
// exam, plus the reported closings. Only SUBMITTED attempts are counted —
// abandoned rows (opened the quiz, closed the tab) stay as audit but would be
// pure noise here.
async function handleStaffList(res) {
  const [attempts, checklists] = await Promise.all([
    sb("night_quiz_attempts?submitted_at=not.is.null" +
       "&select=id,student_id,student_name,student_email,track_name,score,total_questions,passed,submitted_at" +
       "&order=submitted_at.desc&limit=2000"),
    sb("night_closing_checklists?select=id,student_id,student_name,track_name,completed_at,completed_on" +
       "&order=completed_at.desc&limit=1000"),
  ]);
  if (!attempts.ok) return fail(res, 500, "network_error", attempts.text);

  const byStudent = new Map();
  for (const a of attempts.data || []) {
    const key = String(a.student_id);
    let s = byStudent.get(key);
    if (!s) {
      s = {
        studentId: a.student_id,
        name: a.student_name,
        email: a.student_email,
        track: a.track_name,
        passedTheory: false,
        bestScore: 0,
        total: a.total_questions,
        attemptsCount: 0,
        lastAttemptAt: a.submitted_at,
        lastAttemptId: a.id,
        attempts: [],
      };
      byStudent.set(key, s);
    }
    s.attemptsCount += 1;
    if (a.passed) s.passedTheory = true;
    if ((a.score ?? 0) > s.bestScore) s.bestScore = a.score ?? 0;
    s.attempts.push({
      id: a.id,
      submittedAt: a.submitted_at,
      score: a.score,
      total: a.total_questions,
      passed: a.passed,
    });
  }

  // Passed first, then most recently examined.
  const students = [...byStudent.values()].sort((x, y) => {
    if (x.passedTheory !== y.passedTheory) return x.passedTheory ? -1 : 1;
    return String(y.lastAttemptAt).localeCompare(String(x.lastAttemptAt));
  });

  return res.status(200).json({
    ok: true,
    students,
    checklists: (checklists.ok ? checklists.data : []) || [],
  });
}

// One attempt in full, INCLUDING the correct answers. Staff-only by definition —
// this is the payload the Google Sheet used to carry.
async function handleStaffAttempt(req, res) {
  const attemptId = Number(req.body?.attemptId);
  if (!Number.isInteger(attemptId) || attemptId <= 0) return fail(res, 400, "invalid_answers");

  const [attempt, answers] = await Promise.all([
    sb(`night_quiz_attempts?id=eq.${attemptId}` +
       `&select=id,student_id,student_name,student_email,track_name,score,total_questions,passed,started_at,submitted_at&limit=1`),
    sb(`night_quiz_answers?attempt_id=eq.${attemptId}` +
       `&select=question_number,question_id,question_text,chosen_text,correct_text,is_correct&order=question_number.asc`),
  ]);
  if (!attempt.ok) return fail(res, 500, "network_error", attempt.text);

  const row = attempt.data?.[0];
  if (!row) return fail(res, 404, "attempt_not_found");

  return res.status(200).json({
    ok: true,
    attempt: {
      id: row.id,
      studentId: row.student_id,
      name: row.student_name,
      email: row.student_email,
      track: row.track_name,
      score: row.score,
      total: row.total_questions,
      passed: row.passed,
      startedAt: row.started_at,
      submittedAt: row.submitted_at,
    },
    answers: (answers.ok ? answers.data : []) || [],
  });
}

// ── handler ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "method_not_allowed");
  if (!SB_URL || !SB_KEY) return fail(res, 500, "supabase env missing");

  const action = String(req.body?.action || "");

  if (action === "staff-list" || action === "staff-attempt") {
    const staff = await requireStaff(req, res);
    if (!staff) return;
    try {
      if (action === "staff-list") return await handleStaffList(res);
      return await handleStaffAttempt(req, res);
    } catch (err) {
      console.error("[night-training] staff action failed:", err);
      return fail(res, 500, "network_error", String(err?.message || err));
    }
  }

  const user = await requireUser(req, res);
  if (!user) return;

  const resolved = await resolveEligibleStudent(user);
  if (resolved.error) {
    const status = resolved.error === "network_error" ? 500 : 403;
    return fail(res, status, resolved.error, resolved.detail);
  }
  const student = resolved.student;

  try {
    switch (action) {
      case "start":              return await handleStart(res, student);
      case "submit":             return await handleSubmit(req, res, student);
      case "checklist-complete": return await handleChecklistComplete(res, student);
      case "my-status":          return await handleMyStatus(res, student);
      default:                   return fail(res, 400, "unknown action");
    }
  } catch (err) {
    console.error(`[night-training] ${action} failed:`, err);
    return fail(res, 500, "network_error", String(err?.message || err));
  }
}
