#!/usr/bin/env node
// Unit tests for src/utils/announcementPolicy.js — the ONE source of truth for
// "who sees the daily announcement, and on how many days".
//
// Shared by api/announcement.js (server, authoritative) and the admin preview.
// Both rules are cheap to get subtly wrong and expensive to notice in
// production — a too-narrow audience silently reaches nobody, and a broken
// day-cap either nags every refresh or shows the notice once and never again.
//
// No network, no DB. Exit 0 = all passed.

import { matchesAudience, shouldShow, AUDIENCES } from "../src/utils/announcementPolicy.js";

let passed = 0;
let failed = 0;
const check = (name, cond, detail = "") => {
  if (cond) { passed += 1; console.log(`  \x1b[32mPASS\x1b[0m ${name}`); }
  else { failed += 1; console.error(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
};

// ── 1. audience matching ───────────────────────────────────────────────────
console.log("\naudience matching");

const student  = { is_student: true };
const lecturer = { is_lecturer: true };
const admin    = { is_admin: true };
const warehouse = { is_warehouse: true };
const nobody   = {};

check('"all" reaches a student',   matchesAudience("all", student));
check('"all" reaches a lecturer',  matchesAudience("all", lecturer));
check('"all" reaches staff',       matchesAudience("all", admin));
check('"all" reaches a flagless authenticated user', matchesAudience("all", nobody));

check('"students" reaches a student',        matchesAudience("students", student));
check('"students" skips a lecturer',        !matchesAudience("students", lecturer));
check('"students" skips staff',             !matchesAudience("students", admin));

check('"lecturers" reaches a lecturer',      matchesAudience("lecturers", lecturer));
check('"lecturers" skips a student',        !matchesAudience("lecturers", student));

// Staff is the union of the two authoritative staff flags — a warehouse user
// is staff even though they are not an admin.
check('"staff" reaches an admin',            matchesAudience("staff", admin));
check('"staff" reaches a warehouse user',    matchesAudience("staff", warehouse));
check('"staff" skips a plain student',      !matchesAudience("staff", student));

// Multi-role (PR #73): matching is an OR over live flags, never over the role
// the user is currently viewing as. Nobody misses an update.
const studentAndStaff = { is_student: true, is_warehouse: true };
check("multi-role student+staff sees a students-only notice", matchesAudience("students", studentAndStaff));
check("multi-role student+staff sees a staff-only notice",    matchesAudience("staff", studentAndStaff));
const lecturerAndStudent = { is_student: true, is_lecturer: true };
check("multi-role student+lecturer sees a lecturers-only notice", matchesAudience("lecturers", lecturerAndStudent));

// A flagless user must NOT leak into a targeted audience.
check('"students" skips a flagless user',  !matchesAudience("students", nobody));
check('"staff" skips a flagless user',     !matchesAudience("staff", nobody));

// Defensive: an unrecognised audience shows to nobody rather than everybody.
check("unknown audience reaches nobody", !matchesAudience("everyone", admin));
check("null flags never crash",           matchesAudience("all", null) === true && matchesAudience("staff", null) === false);
check("AUDIENCES lists exactly the four supported values",
  AUDIENCES.length === 4 && ["all","students","lecturers","staff"].every(a => AUDIENCES.includes(a)));

// ── 2. how many days it shows ──────────────────────────────────────────────
console.log("\nday cap");

// once
check("1-day: first ever entry shows it",       shouldShow({ displayDays: 1, daysSeen: 0, seenToday: false }));
check("1-day: second entry the SAME day hides", !shouldShow({ displayDays: 1, daysSeen: 1, seenToday: true }));
check("1-day: the next day still hides",        !shouldShow({ displayDays: 1, daysSeen: 1, seenToday: false }));

// twice, on two DIFFERENT days — the whole point of the option
check("2-day: first entry shows it",            shouldShow({ displayDays: 2, daysSeen: 0, seenToday: false }));
check("2-day: second entry the SAME day hides", !shouldShow({ displayDays: 2, daysSeen: 1, seenToday: true }));
check("2-day: the NEXT day shows it again",     shouldShow({ displayDays: 2, daysSeen: 1, seenToday: false }));
check("2-day: third entry on a third day hides",!shouldShow({ displayDays: 2, daysSeen: 2, seenToday: false }));
check("2-day: second viewing does not repeat later that day",
  !shouldShow({ displayDays: 2, daysSeen: 2, seenToday: true }));

// seenToday always wins, whatever the counter says
check("seenToday overrides an empty counter",  !shouldShow({ displayDays: 2, daysSeen: 0, seenToday: true }));

// defaults / junk
check("no args → shows (fresh 1-day notice)",   shouldShow());
check("displayDays 0 behaves as 1",             shouldShow({ displayDays: 0, daysSeen: 0 }) && !shouldShow({ displayDays: 0, daysSeen: 1 }));
check("displayDays 99 does not become unlimited", !shouldShow({ displayDays: 99, daysSeen: 1, seenToday: false }));

// ── report ─────────────────────────────────────────────────────────────────
const total = passed + failed;
if (failed) {
  console.error(`\n\x1b[31m\x1b[1mFAILED ${failed}/${total} announcement-policy tests\x1b[0m\n`);
  process.exit(1);
}
console.log(`\n\x1b[32m\x1b[1mOK ${passed}/${total} announcement-policy tests passed\x1b[0m\n`);
