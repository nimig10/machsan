#!/usr/bin/env node
// Unit tests for the night-training quiz: the question bank, the deterministic
// draw/shuffle, the scoring, and the answer-leak boundary.
//
// Two things here are load-bearing and cheap to break silently:
//
//   1. THE ANSWER KEY MUST NEVER REACH A STUDENT. Scoring moved server-side
//      precisely so a student cannot forge "עבר עיוני" — a marker staff act on
//      when deciding who sits the practical exam. Tests 14-16 and 30 assert the
//      key stays server-side, including a static check that no file under src/
//      imports the bank at all.
//   2. PASSING IS 100%, NOT "MOST". 14/15 is a fail. One softened comparison
//      turns the gate into a formality; test 18 pins it.
//
// Also pinned: same seed ⇒ same quiz. The server stores only (seed, ids) and
// regenerates the presentation to score, so a non-deterministic draw would
// mis-score real students.
//
// No network, no DB. Exit 0 = all passed.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import {
  BANK_VERSION, QUIZ_SIZE, PASS_SCORE, ATTEMPT_TTL_MINUTES, MAX_ATTEMPTS_PER_DAY,
  makeSeed, pickQuestionIds, buildAttemptView, scoreAttempt, toStudentResult, _internal,
} from "../api/_night-quiz.js";
import { CHECKLIST_ITEMS, CHECKLIST_ITEM_COUNT, CHECKLIST_VERSION } from "../src/utils/nightChecklist.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BANK = _internal.QUESTION_BANK;

let passed = 0;
let failed = 0;
const check = (name, cond, detail = "") => {
  if (cond) { passed += 1; console.log(`  \x1b[32mPASS\x1b[0m ${name}`); }
  else { failed += 1; console.error(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
};

// Deterministic seeds so a failure is reproducible.
const SEED_A = "a".repeat(32);
const SEED_B = "0123456789abcdef0123456789abcdef";

// ── 1. bank integrity ──────────────────────────────────────────────────────
console.log("\nbank integrity");

check("exactly 32 questions", BANK.length === 32, `got ${BANK.length}`);
check("ids are unique", new Set(BANK.map(q => q.id)).size === BANK.length);
check("ids are all positive integers", BANK.every(q => Number.isInteger(q.id) && q.id > 0));

const mc = BANK.filter(q => q.type === "mc");
const tf = BANK.filter(q => q.type === "tf");
// A slip during the port changes this split and nothing else would notice.
check("17 multiple-choice + 15 true/false", mc.length === 17 && tf.length === 15, `${mc.length}/${tf.length}`);
check("no question has an unknown type", mc.length + tf.length === BANK.length);

check("every mc has exactly 4 non-empty options",
  mc.every(q => Array.isArray(q.options) && q.options.length === 4 && q.options.every(o => typeof o === "string" && o.trim())));
check("every mc correctIndex is in range",
  mc.every(q => Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < q.options.length));
check("every tf correctAnswer is a boolean", tf.every(q => typeof q.correctAnswer === "boolean"));
check("no tf carries options/correctIndex", tf.every(q => q.options === undefined && q.correctIndex === undefined));

check("every question text is non-empty", BANK.every(q => typeof q.question === "string" && q.question.trim()));
// The source had no markup in question text; keeping it that way is what lets
// the renderer stay plain React (lesson #43).
check("no question text contains markup", BANK.every(q => !/[<>]/.test(q.question)));
check("no duplicate question texts", new Set(BANK.map(q => q.question.trim())).size === BANK.length);
// A repeated option is unanswerable-correctly once the order is shuffled.
check("no mc repeats an option within itself", mc.every(q => new Set(q.options).size === q.options.length));

check("BANK_VERSION is a positive integer", Number.isInteger(BANK_VERSION) && BANK_VERSION > 0);
check("PASS_SCORE === QUIZ_SIZE (100% only)", PASS_SCORE === QUIZ_SIZE, `${PASS_SCORE} vs ${QUIZ_SIZE}`);
check("QUIZ_SIZE is 15", QUIZ_SIZE === 15);
check("ATTEMPT_TTL_MINUTES is a positive integer", Number.isInteger(ATTEMPT_TTL_MINUTES) && ATTEMPT_TTL_MINUTES > 0);
check("MAX_ATTEMPTS_PER_DAY is a positive integer", Number.isInteger(MAX_ATTEMPTS_PER_DAY) && MAX_ATTEMPTS_PER_DAY > 0);

// ── 2. selection & shuffle ─────────────────────────────────────────────────
console.log("\nselection & shuffle");

const idsA = pickQuestionIds(SEED_A);
check("draws exactly 15 questions", idsA.length === QUIZ_SIZE, `got ${idsA.length}`);
check("drawn ids are distinct", new Set(idsA).size === idsA.length);
check("drawn ids all exist in the bank", idsA.every(id => BANK.some(q => q.id === id)));

// The property the whole stateless design rests on: the server persists only
// (seed, ids) and rebuilds the quiz to score it.
const viewA1 = buildAttemptView(SEED_A, idsA);
const viewA2 = buildAttemptView(SEED_A, idsA);
check("same seed ⇒ identical drawn ids", JSON.stringify(pickQuestionIds(SEED_A)) === JSON.stringify(idsA));
check("same seed ⇒ identical presentation (order + options)",
  JSON.stringify(viewA1.public) === JSON.stringify(viewA2.public));
check("different seeds ⇒ different presentation",
  JSON.stringify(buildAttemptView(SEED_B, pickQuestionIds(SEED_B)).public) !== JSON.stringify(viewA1.public));

// Option order must be keyed by question ID, not array position, so reordering
// QUESTION_BANK cannot change an in-flight attempt.
const reordered = [...idsA].reverse();
const viewRev = buildAttemptView(SEED_A, reordered);
const optsById = (v) => Object.fromEntries(v.public.map(q => [q.id, q.options.join("|")]));
check("option order depends on question id, not position",
  JSON.stringify(optsById(viewA1)) === JSON.stringify(optsById(viewRev)));

const seeds = Array.from({ length: 200 }, (_, i) => `seed-${i}`);
const draws = seeds.map(s => pickQuestionIds(s));
check("no draw ever repeats a question", draws.every(d => new Set(d).size === d.length));
check("200 seeds produce >95% distinct question sets",
  new Set(draws.map(d => [...d].sort((a, b) => a - b).join(","))).size > 190);
// Catches an off-by-one that makes the last bank entry unreachable.
const seen = new Set(draws.flat());
check("every question in the bank is reachable", seen.size === BANK.length, `${seen.size}/${BANK.length}`);

// The classic Fisher-Yates bug pins index 0; that would make "always pick the
// first option" a winning strategy.
const slotHits = [0, 0, 0, 0];
for (let i = 0; i < 2000; i += 1) {
  const s = `dist-${i}`;
  const v = buildAttemptView(s, pickQuestionIds(s));
  v.solution.forEach(q => { if (q.options.length === 4) slotHits[q.correctIndex] += 1; });
}
const totalHits = slotHits.reduce((a, b) => a + b, 0);
const expected = totalHits / 4;
check("correct answer is spread evenly across the 4 slots (±20%)",
  slotHits.every(h => Math.abs(h - expected) < expected * 0.2), JSON.stringify(slotHits));

let trueFirst = 0;
let tfSeen = 0;
for (let i = 0; i < 400; i += 1) {
  const s = `tf-${i}`;
  buildAttemptView(s, pickQuestionIds(s)).solution
    .filter(q => q.type === "tf")
    .forEach(q => { tfSeen += 1; if (q.options[0] === _internal.TRUE_LABEL) trueFirst += 1; });
}
check('true/false options are shuffled ("נכון" is not always first)',
  tfSeen > 0 && trueFirst > tfSeen * 0.3 && trueFirst < tfSeen * 0.7, `${trueFirst}/${tfSeen}`);

check("makeSeed returns a 32-char hex string", /^[0-9a-f]{32}$/.test(makeSeed()));
check("makeSeed is not constant", makeSeed() !== makeSeed());

// ── 3. answer-leak guard ───────────────────────────────────────────────────
console.log("\nanswer-leak guard");

const FORBIDDEN = ["correctindex", "correctanswer", "correcttext", "iscorrect", "solution", "correct"];
function findForbiddenKey(value, path = "") {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findForbiddenKey(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) {
      if (FORBIDDEN.includes(k.toLowerCase())) return `${path}.${k}`;
      const hit = findForbiddenKey(value[k], `${path}.${k}`);
      if (hit) return hit;
    }
  }
  return null;
}

const leak = findForbiddenKey(viewA1.public, "public");
check("buildAttemptView().public carries no answer key at any depth", leak === null, leak || "");
check("public questions expose exactly {n,id,type,question,options}",
  viewA1.public.every(q => JSON.stringify(Object.keys(q)) === JSON.stringify(["n", "id", "type", "question", "options"])));
// `type` alone must not disclose the answer, so a tf question is shape-identical
// to an mc one on the wire.
check("tf and mc are shape-identical in the public projection", (() => {
  const t = viewA1.public.find(q => q.type === "tf");
  const m = viewA1.public.find(q => q.type === "mc");
  return !t || !m || JSON.stringify(Object.keys(t)) === JSON.stringify(Object.keys(m));
})());
check("solution DOES carry the key (it is the server-side projection)",
  viewA1.solution.every(q => typeof q.correctText === "string" && Number.isInteger(q.correctIndex)));

const perfect = viewA1.solution.map(q => ({ n: q.n, choice: q.correctIndex }));
const oneOff = perfect.map((a, i) => (i === 2
  ? { n: a.n, choice: (a.choice + 1) % viewA1.solution[i].options.length }
  : a));
const studentResult = toStudentResult(scoreAttempt(SEED_A, idsA, oneOff));
const leak2 = findForbiddenKey(studentResult, "result");
check("toStudentResult carries no answer key", leak2 === null, leak2 || "");
check("toStudentResult keeps the student's own choice", studentResult.wrong.every(w => "chosen" in w));
check("toStudentResult exposes exactly {score,total,passed,wrong}",
  JSON.stringify(Object.keys(studentResult)) === JSON.stringify(["score", "total", "passed", "wrong"]));

// ── 4. scoring ─────────────────────────────────────────────────────────────
console.log("\nscoring");

const sPerfect = scoreAttempt(SEED_A, idsA, perfect);
check("all correct ⇒ 15/15 and passed", sPerfect.score === 15 && sPerfect.passed === true);
// THE business rule. 14/15 must fail.
const sOne = scoreAttempt(SEED_A, idsA, oneOff);
check("exactly one wrong ⇒ 14/15 and NOT passed", sOne.score === 14 && sOne.passed === false,
  `${sOne.score}/${sOne.total} passed=${sOne.passed}`);

const allWrong = viewA1.solution.map(q => ({ n: q.n, choice: (q.correctIndex + 1) % q.options.length }));
const sZero = scoreAttempt(SEED_A, idsA, allWrong);
check("all wrong ⇒ 0/15 and not passed", sZero.score === 0 && sZero.passed === false);

const oneRight = allWrong.map((a, i) => (i === 0 ? perfect[0] : a));
check("exactly one right ⇒ 1/15 and not passed", (() => {
  const r = scoreAttempt(SEED_A, idsA, oneRight);
  return r.score === 1 && r.passed === false;
})());

const withNull = perfect.map((a, i) => (i === 5 ? { n: a.n, choice: null } : a));
check("an unanswered question counts wrong and does not throw", (() => {
  const r = scoreAttempt(SEED_A, idsA, withNull);
  return r.score === 14 && r.passed === false && r.details[5].chosenText === null;
})());

check("junk choices count wrong and never throw", (() => {
  const junk = [-1, 4, 99, "2", NaN, undefined, {}, [], true];
  return junk.every((bad, i) => {
    const answers = perfect.map((a, idx) => (idx === 0 ? { n: a.n, choice: bad } : a));
    try {
      const r = scoreAttempt(SEED_A, idsA, answers);
      return r.score === 14 && r.passed === false;
    } catch (e) {
      console.error(`      junk[${i}]=${String(bad)} threw: ${e.message}`);
      return false;
    }
  });
})());

check("missing answers array does not throw", (() => {
  for (const bad of [null, undefined, "nope", 42, {}]) {
    const r = scoreAttempt(SEED_A, idsA, bad);
    if (r.score !== 0 || r.total !== 15 || r.passed !== false) return false;
  }
  return true;
})());

// The client may submit in any order; scoring must key off `n`, not position.
check("submission order does not affect the score", (() => {
  const shuffled = [...perfect].reverse();
  return scoreAttempt(SEED_A, idsA, shuffled).score === 15;
})());

check("a duplicated n does not inflate the score", (() => {
  const dup = [...perfect.slice(0, 14), { n: perfect[0].n, choice: perfect[0].choice }];
  const r = scoreAttempt(SEED_A, idsA, dup);
  return r.score === 14 && r.passed === false;
})());

// Proves the {n, choice} coordinate system round-trips against the regenerated
// presentation — if it did not, students would be scored against the wrong option.
check("chosenText matches the option the index pointed at", (() => {
  const r = scoreAttempt(SEED_A, idsA, oneOff);
  return r.details.every((d, i) => {
    const submitted = oneOff.find(a => a.n === d.n);
    return d.chosenText === viewA1.solution[i].options[submitted.choice];
  });
})());
check("details carry the correct answer for staff", (() => {
  const r = scoreAttempt(SEED_A, idsA, oneOff);
  return r.details.every(d => typeof d.correctText === "string" && d.correctText.length > 0);
})());
check("details length always equals the quiz size", scoreAttempt(SEED_A, idsA, []).details.length === 15);

// ── 5. checklist ───────────────────────────────────────────────────────────
console.log("\nclosing checklist");

check("exactly 26 items", CHECKLIST_ITEMS.length === 26, `got ${CHECKLIST_ITEMS.length}`);
check("CHECKLIST_ITEM_COUNT matches the array", CHECKLIST_ITEM_COUNT === CHECKLIST_ITEMS.length);
check("CHECKLIST_VERSION is a positive integer", Number.isInteger(CHECKLIST_VERSION) && CHECKLIST_VERSION > 0);
check("ids are sequential 1..26", CHECKLIST_ITEMS.every((it, i) => it.id === i + 1));
check("every item has at least one part", CHECKLIST_ITEMS.every(it => Array.isArray(it.parts) && it.parts.length > 0));
check("every part has non-empty text",
  CHECKLIST_ITEMS.every(it => it.parts.every(p => typeof p.text === "string" && p.text.length > 0)));
check("warn is boolean when present",
  CHECKLIST_ITEMS.every(it => it.parts.every(p => p.warn === undefined || typeof p.warn === "boolean")));
// The mechanized lesson-#43 guard: proves the <span class="warn"> markup became
// structure rather than being smuggled through as a string.
check("no part text contains markup",
  CHECKLIST_ITEMS.every(it => it.parts.every(p => !/[<>]/.test(p.text))));
check("at least 3 items carry an emphasised segment",
  CHECKLIST_ITEMS.filter(it => it.parts.some(p => p.warn)).length >= 3);

// ── 6. static guards ───────────────────────────────────────────────────────
console.log("\nstatic guards");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const srcFiles = walk(join(ROOT, "src"));
// The compile-time proof that the answer key never enters the Vite bundle.
const importers = srcFiles.filter(f => /_night-quiz/.test(readFileSync(f, "utf8")));
check("no file under src/ references the quiz bank", importers.length === 0,
  importers.map(f => f.replace(ROOT, "")).join(", "));

const bankSrc = readFileSync(join(ROOT, "api", "_night-quiz.js"), "utf8");
const bankImports = [...bankSrc.matchAll(/^import .*? from ["'](.+?)["'];?$/gm)].map(m => m[1]);
check("the bank imports nothing but node:crypto",
  bankImports.length === 1 && bankImports[0] === "node:crypto", bankImports.join(", "));
// Comments are stripped first — the file's own header explains WHY Math.random
// is banned, and matching that sentence would fail the check it documents.
const bankCode = bankSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
check("the bank never calls Math.random (the draw must stay reproducible)",
  !/Math\.random/.test(bankCode));

const checklistSrc = readFileSync(join(ROOT, "src", "utils", "nightChecklist.js"), "utf8");
check("nightChecklist.js imports nothing (lesson #40)",
  !/^import /m.test(checklistSrc));

const migrations = readdirSync(join(ROOT, "supabase", "migrations")).filter(f => /night/.test(f));
check("the night-training migration exists", migrations.length === 1, migrations.join(", "));
if (migrations.length === 1) {
  const sql = readFileSync(join(ROOT, "supabase", "migrations", migrations[0]), "utf8");
  const policies = [...sql.matchAll(/CREATE POLICY[\s\S]*?FOR ALL TO (\w+)/g)].map(m => m[1]);
  // A read policy on night_quiz_answers publishes correct_text — the answer key.
  check("no night_* table grants anon or authenticated a policy",
    policies.length > 0 && policies.every(r => r === "service_role"), policies.join(", "));
  check("RLS is enabled on all three night tables",
    (sql.match(/ENABLE ROW LEVEL SECURITY/g) || []).length === 3);
}

// ── summary ────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
