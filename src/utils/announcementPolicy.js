// announcementPolicy.js — the two rules that decide whether a user sees the
// daily announcement. Pure functions, no I/O.
//
// ⚠️ MUST STAY DEPENDENCY-FREE.
// api/announcement.js imports this from Node. Importing src/utils.js (or
// anything that reaches supabaseClient.js) would drag in `import.meta` and the
// browser Supabase client and break the serverless bundle — the same
// constraint that governs src/utils/loanPolicy.js (lesson #40ז).

export const AUDIENCES = ["all", "students", "lecturers", "staff"];

export const AUDIENCE_LABELS = {
  all:       "כל המשתמשים",
  students:  "סטודנטים בלבד",
  lecturers: "מרצים בלבד",
  staff:     "צוות בלבד",
};

// Does this announcement's audience cover a user with these role flags?
//
// Matching is an OR over the user's LIVE flags in public.users, not over the
// role they happen to be viewing as: a user who is both a student and a staff
// member sees a students-only announcement, because the point of the feature
// is that nobody misses an update. `active_role` is client-controlled and is
// deliberately not consulted.
//
// A user with no flags at all (authenticated but not registered anywhere) only
// ever matches "all".
export function matchesAudience(audience, flags) {
  const f = flags || {};
  switch (audience) {
    case "all":       return true;
    case "students":  return !!f.is_student;
    case "lecturers": return !!f.is_lecturer;
    case "staff":     return !!(f.is_admin || f.is_warehouse);
    default:          return false; // unknown audience → show to nobody
  }
}

// Should the announcement be shown to this user right now?
//
//   daysSeen  — on how many DISTINCT days they have already been shown it
//               (COUNT of their announcement_views rows).
//   seenToday — whether one of those days is today (Asia/Jerusalem).
//
// "Twice" means twice on two DIFFERENT days, so a second entry on the same day
// shows nothing; the second viewing waits for the next day they log in.
export function shouldShow({ displayDays = 1, daysSeen = 0, seenToday = false } = {}) {
  if (seenToday) return false;                 // one per calendar day, always
  const cap = displayDays === 2 ? 2 : 1;       // anything not 2 behaves as 1
  return daysSeen < cap;
}
