// _night-quiz.js — the night-training question bank and every piece of logic
// that knows a correct answer.
//
// WHY THIS FILE LIVES IN api/ AND NOT src/
// ----------------------------------------
// It holds the answer key. A file under src/utils/ stays out of the browser
// bundle only as long as nobody imports it from a component — one careless
// import ships all 32 correct answers to every student, silently, with a green
// CI. Under api/ that is structurally impossible: api/ is not in the Vite
// client graph at all. The leading underscore keeps it from being served as a
// route (scripts/vite-api-plugin.mjs skips "_" files; Vercel does the same),
// exactly like _auth-helper.js / _ics.js / _push.js.
// scripts/run-night-quiz-tests.mjs asserts that no file under src/ imports it.
//
// ⚠️ MUST STAY DEPENDENCY-FREE except for node:crypto.
// Importing src/utils.js (or anything reaching supabaseClient.js) would drag
// import.meta and the browser Supabase client into the serverless bundle — the
// same constraint that governs announcementPolicy.js and loanPolicy.js
// (lesson #40).
//
// THE PRESENTATION IS NEVER STORED — IT IS REGENERATED.
// An attempt persists only (seed, question_ids). buildAttemptView(seed, ids)
// rebuilds the exact same 15 questions in the exact same order with the exact
// same option permutations, on demand. That is what lets the server score a
// submission without holding session state, and what lets a page refresh drop
// the student back into an identical quiz.
//
// Determinism contract — do not break either half:
//   * which questions, and their order  = f(seed)
//   * option order for question Q        = f(seed, Q.id)   ← by ID, never by
//     array position, so reordering QUESTION_BANK below cannot change an
//     in-flight attempt's presentation.

import { randomBytes } from "node:crypto";

// ⚠️ BUMP BANK_VERSION ON ANY EDIT TO QUESTION_BANK (add/remove/reword/reorder
// an answer). An attempt issued before the edit is scored against the bank it
// was drawn from; api/night-training.js compares versions and returns
// bank_changed rather than silently mis-scoring. Blast radius of a deploy is
// therefore at most one ATTEMPT_TTL_MINUTES window.
export const BANK_VERSION = 1;

export const QUIZ_SIZE = 15;
// 100% only. This is the rule the whole feature exists to enforce — 14/15 is a
// fail. See the score-boundary tests.
export const PASS_SCORE = 15;
export const ATTEMPT_TTL_MINUTES = 60;
// A cap on how many quizzes one student may open per day. The questions are not
// secret, but without a cap "start" can be farmed to enumerate the bank and the
// attempts table becomes unreadable for staff.
export const MAX_ATTEMPTS_PER_DAY = 10;

const TRUE_LABEL = "נכון";
const FALSE_LABEL = "לא נכון";

// Ported verbatim from sagivo56/geyra-night questions.js (32 questions:
// 17 multiple-choice, 15 true/false). Do not hand-edit ids.
const QUESTION_BANK = [
  { id: 1, type: "mc", question: "מהי ההגדרה של \"תרגול לילה\" לפי הנהלים?",
    options: [
      "תרגול בבית הספר בכל שעה שהיא",
      "תרגול במתקני בית הספר אחרי השעה 21:30 בימים א'-ה'",
      "תרגול בסופי שבוע בלבד",
      "תרגול המתבצע רק בליווי מדריך",
    ], correctIndex: 1 },
  { id: 2, type: "mc", question: "כמה תרגולים בשעות הפעילות הרגילות צריך תלמיד לתאם לפני שיוכל לקבל הרשאה לתרגל בלילות?",
    options: [
      "1",
      "2",
      "3",
      "5",
    ], correctIndex: 2 },
  { id: 3, type: "tf", question: "תלמיד יכול לגשת למבחן הלילה המעשי גם אם עדיין לא עבר את המבחן העיוני.", correctAnswer: false },
  { id: 4, type: "mc", question: "לאחר קבלת הרשאה לתרגל בלילות בימים א'-ה', כמה זמן על התלמיד להמתין לפני שיוכל לבקש לתרגל בימי שישי/שבת?",
    options: [
      "חודש",
      "חודשיים",
      "3 חודשים",
      "חצי שנה",
    ], correctIndex: 2 },
  { id: 5, type: "mc", question: "כמה תלמידים מקסימום רשאים לתאם תרגול באותו סוף שבוע ספציפי (שישי/שבת)?",
    options: [
      "תלמיד אחד בלבד",
      "שניים",
      "שלושה",
      "אין הגבלה",
    ], correctIndex: 0 },
  { id: 6, type: "mc", question: "מהו היחס המומלץ בין תלמיד מורשה לבין מספר האורחים שהוא יכול להביא?",
    options: [
      "אורח אחד לתלמיד",
      "2 אורחים לתלמיד",
      "3 אורחים לתלמיד",
      "אין הגבלה",
    ], correctIndex: 1 },
  { id: 7, type: "tf", question: "לאורחים מותר לגעת בציוד בית הספר אם הם מקצוענים מוסמכים.", correctAnswer: false },
  { id: 8, type: "tf", question: "תלמיד שעבר את הסמכת הלילה, ומגיע כאורח של תלמיד מוסמך אחר — מותר לו לגעת בציוד.", correctAnswer: true },
  { id: 9, type: "mc", question: "עד איזו שעה יש לשלוח למדריך התורן הודעת וואטסאפ עם שם מלא וחדר התרגול?",
    options: [
      "20:00",
      "21:00",
      "21:30",
      "22:00",
    ], correctIndex: 2 },
  { id: 10, type: "tf", question: "אם תלמיד לא שלח הודעה למדריך התורן עד 21:30, הוא עדיין יכול לתרגל אם כבר הגיש רשימת ציוד.", correctAnswer: false },
  { id: 11, type: "mc", question: "עד איזו שעה יש להגיש רשימת ציוד באתר לצורך תרגול לילה?",
    options: [
      "12:00",
      "15:00",
      "18:00",
      "21:00",
    ], correctIndex: 1 },
  { id: 12, type: "tf", question: "ניתן להגיש רשימת ציוד בכתב (על נייר) בצורה ספונטנית בשעה 21:30.", correctAnswer: false },
  { id: 13, type: "mc", question: "מי מוסמך להעביר את תדרוך הלילה לתלמידים?",
    options: [
      "רק שגיב",
      "כל עובד בית ספר שנמצא במקום",
      "מי שסוגר את בית הספר באותו יום",
      "תורן הלילה תמיד, ללא קשר למי שסוגר",
    ], correctIndex: 2 },
  { id: 14, type: "tf", question: "מי שסוגר את בית הספר ומעביר את התדרוך הוא תמיד אותו אדם שהוא תורן הלילה.", correctAnswer: false },
  { id: 15, type: "tf", question: "תלמיד שקיבל מפתחות נעילה ללא תדרוך פיזי מפורט צריך לדווח על כך מיד לשגיב.", correctAnswer: true },
  { id: 16, type: "mc", question: "החל מאיזו שעה חייבות דלת הכניסה הראשית ודלת הכניסה לבניין להיות נעולות מבפנים?",
    options: [
      "20:00",
      "21:00",
      "21:30",
      "22:00",
    ], correctIndex: 2 },
  { id: 17, type: "tf", question: "מותר להשתמש במעלית אחרי השעה 21:30 במקרה הצורך.", correctAnswer: false },
  { id: 18, type: "mc", question: "איפה מותר להניח מזון ושתייה בזמן תרגול לילה?",
    options: [
      "בתוך האולפנים בבקבוקים סגורים בלבד",
      "במסדרון בית הספר בלבד",
      "בכל מקום בבית הספר חוץ מהאולפן הגדול",
      "אסור לחלוטין להכניס מזון ושתייה לבניין",
    ], correctIndex: 1 },
  { id: 19, type: "tf", question: "הליכה עם גרביים בלבד (ללא נעליים) מותרת כי זה לא נחשב יחף.", correctAnswer: false },
  { id: 20, type: "mc", question: "מה עליכם לעשות ראשית במקרה חירום אמיתי (שריפה/הצפה/פציעה)?",
    options: [
      "להתקשר מיד למדריך התורן",
      "להתקשר קודם לשירותי החירום הרלוונטיים (כבאות/משטרה/מד\"א)",
      "לצאת מהבניין ולא להתקשר לאף אחד",
      "לחכות להוראות מהמדריך",
    ], correctIndex: 1 },
  { id: 21, type: "mc", question: "אם מדריך התורן לא עונה כמה פעמים בבקשה טכנית לא דחופה, מה עליכם לעשות?",
    options: [
      "להמשיך לנסות ללא הגבלה",
      "אחרי 5 ניסיונות להתקשר למדריך תורן אחר",
      "לוותר ולא לפעול",
      "לשלוח הודעת מייל בלבד",
    ], correctIndex: 1 },
  { id: 22, type: "tf", question: "הפלאפון האישי חייב להיות מחובר לרשת ה-WiFi ובכיס במהלך כל זמן השהות בבית הספר בלילה.", correctAnswer: true },
  { id: 23, type: "mc", question: "מי האחראי הבלעדי (מבחינת נזק/הפרת נהלים) על אורחים שהביא תלמיד לתרגול לילה?",
    options: [
      "בית הספר",
      "התלמיד המארח",
      "המדריך התורן",
      "אף אחד, האורח אחראי בעצמו",
    ], correctIndex: 1 },
  { id: 24, type: "tf", question: "מותר להשאיר את בית הספר ללא נוכחות של אף תלמיד מורשה, כל עוד הדלתות נעולות.", correctAnswer: false },
  { id: 25, type: "mc", question: "איזה חלק בבית הספר אסור לכבות בו את התאורה בסוף התרגול?",
    options: [
      "תוך החדרים בהם תרגלתם",
      "המסדרון והסטודיו הגדול",
      "חדרי השירותים",
      "חדר המטבח",
    ], correctIndex: 1 },
  { id: 26, type: "mc", question: "תוך כמה דקות ממועד הנחת המפתחות בכספת (או מהיציאה/נעילה) יש לשלוח את הסרטונים/הודעת \"יצאתי\" למדריך התורן?",
    options: [
      "דקה",
      "3 דקות",
      "5 דקות",
      "10 דקות",
    ], correctIndex: 1 },
  { id: 27, type: "tf", question: "מותר לשלוח את הסרטונים הנדרשים לפני היציאה/הנעילה בפועל, כדי לא לשכוח.", correctAnswer: false },
  { id: 28, type: "mc", question: "כמה זמן נתון לתלמיד לצאת מגבולות בית הספר לאחר שהוקש הקוד בפאנל האזעקה והחלה ספירה לאחור?",
    options: [
      "60 שניות",
      "120 שניות (2 דקות)",
      "180 שניות (3 דקות)",
      "240 שניות (4 דקות)",
    ], correctIndex: 2 },
  { id: 29, type: "tf", question: "אם המפתח נתקע בצינור השחור, יש לדחוף אותו באמצעות מוט האלומיניום המחובר לדלת בעזרת חבל שחור.", correctAnswer: true },
  { id: 30, type: "mc", question: "מה קורה לכל התיאומים העתידיים של תלמיד שהושעה, גם אם תואמו לפני מועד ההשעיה?",
    options: [
      "הם נשארים בתוקף עד תום ההשעיה",
      "הם מתבטלים אוטומטית",
      "הם מועברים לתלמיד אחר",
      "יש לתאם אותם מחדש רק אחרי אישור שגיב",
    ], correctIndex: 1 },
  { id: 31, type: "tf", question: "תלמיד שהושעה מתרגולי לילה יכול עדיין להגיע לבית הספר בלילה במעמד \"אורח\" בלבד (בכפוף לאישור).", correctAnswer: true },
  { id: 32, type: "tf", question: "תלמיד שהושעה ומעוניין לחזור לתרגל בלילות חייב לעבור מחדש את מבחן הלילה העיוני והמעשי.", correctAnswer: true },
];

// ── deterministic PRNG (xmur3 → mulberry32) ────────────────────────────────
// Small, seedable and dependency-free. Math.random() cannot be used anywhere in
// this file: the whole design depends on the same seed rebuilding the same quiz.

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a) {
  let t = a >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function rngFor(label) {
  return mulberry32(xmur3(label)());
}

// Fisher-Yates. Note the loop runs down to i > 0 and swaps with j <= i — the
// classic bug is "j <= i" becoming "j < i", which pins index 0 and skews the
// correct-answer distribution. There is a distribution test for exactly that.
function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── public API ─────────────────────────────────────────────────────────────

export function makeSeed() {
  return randomBytes(16).toString("hex");
}

// Which questions this attempt asks, and in which order. f(seed) only.
export function pickQuestionIds(seed) {
  const ids = QUESTION_BANK.map((q) => q.id);
  return shuffle(ids, rngFor(`pick:${seed}`)).slice(0, Math.min(QUIZ_SIZE, ids.length));
}

function questionById(id) {
  return QUESTION_BANK.find((q) => q.id === id) || null;
}

// Normalizes one bank entry into the uniform {options, correctIndex} shape and
// applies this attempt's option permutation.
//
// A tf question becomes a 2-option multiple choice, shape-identical to an mc
// one, so the wire format never reveals the answer through its "type" alone.
function presentQuestion(q, seed) {
  const rand = rngFor(`opt:${seed}:${q.id}`);
  if (q.type === "tf") {
    const options = shuffle([TRUE_LABEL, FALSE_LABEL], rand);
    return {
      id: q.id,
      type: "tf",
      question: q.question,
      options,
      correctIndex: options.indexOf(q.correctAnswer === true ? TRUE_LABEL : FALSE_LABEL),
    };
  }
  const correctText = q.options[q.correctIndex];
  const options = shuffle(q.options, rand);
  return {
    id: q.id,
    type: "mc",
    question: q.question,
    options,
    correctIndex: options.indexOf(correctText),
  };
}

// Rebuilds an attempt from its persisted (seed, questionIds).
//
// Returns two projections:
//   .public   — {n, id, type, question, options}  ← the ONLY thing a student
//               may ever receive. Carries no answer field at any depth.
//   .solution — adds correctIndex / correctText. Never leaves the server.
export function buildAttemptView(seed, questionIds) {
  const solution = [];
  const pub = [];
  (questionIds || []).forEach((id, idx) => {
    const q = questionById(id);
    if (!q) return;
    const p = presentQuestion(q, seed);
    const n = idx + 1;
    solution.push({
      n,
      id: p.id,
      type: p.type,
      question: p.question,
      options: p.options,
      correctIndex: p.correctIndex,
      correctText: p.options[p.correctIndex],
    });
    pub.push({ n, id: p.id, type: p.type, question: p.question, options: p.options });
  });
  return { public: pub, solution };
}

// Scores a submission against the regenerated presentation.
//
// `answers` is [{n, choice}] where n is the 1-based PRESENTED position and
// choice is the 0-based index into the PRESENTED options array. Both coordinates
// are interpreted against a server-owned mapping — nothing the client sends is
// ever trusted as a question identity. (If the client named questions by bank
// id, a student could remap ids to move a known-correct answer onto another
// question.)
//
// Anything unrecognisable — null, out of range, wrong type — counts wrong and
// never throws. Validation of the envelope itself lives in the endpoint.
export function scoreAttempt(seed, questionIds, answers) {
  const { solution } = buildAttemptView(seed, questionIds);
  const byN = new Map();
  (Array.isArray(answers) ? answers : []).forEach((a) => {
    if (a && Number.isInteger(a.n)) byN.set(a.n, a.choice);
  });

  let score = 0;
  const details = solution.map((q) => {
    const choice = byN.has(q.n) ? byN.get(q.n) : null;
    const valid = Number.isInteger(choice) && choice >= 0 && choice < q.options.length;
    const isCorrect = valid && choice === q.correctIndex;
    if (isCorrect) score += 1;
    return {
      n: q.n,
      questionId: q.id,
      questionText: q.question,
      chosenText: valid ? q.options[choice] : null,
      correctText: q.correctText,
      isCorrect,
    };
  });

  const total = solution.length;
  return { score, total, passed: total > 0 && score >= PASS_SCORE, details };
}

// The single choke point between a scored attempt and the student's screen.
//
// Drops correctText. The original app deliberately showed a failing student
// WHICH questions they got wrong and WHAT THEY PICKED, but never the right
// answer — that is what keeps a failed attempt from being a free answer key.
// Every student-facing response must go through here.
export function toStudentResult(scored) {
  return {
    score: scored.score,
    total: scored.total,
    passed: scored.passed,
    wrong: scored.details
      .filter((d) => !d.isCorrect)
      .map((d) => ({ n: d.n, question: d.questionText, chosen: d.chosenText })),
  };
}

// Test-only surface. Not imported by api/night-training.js.
export const _internal = { xmur3, mulberry32, shuffle, presentQuestion, QUESTION_BANK, TRUE_LABEL, FALSE_LABEL };
