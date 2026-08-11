// dateFormat.js — Hebrew DD/MM/YYYY ⟷ ISO yyyy-mm-dd.
//
// Why this exists: <input type="date"> renders in the BROWSER's locale, and
// that is not settable from the page — lang, dir and CSS are all ignored (MDN:
// "the displayed date is formatted based on the locale of the user's browser").
// An Israeli user with an English browser therefore read 10/18/2026 in the
// field while the notice directly above it said 18/08/2026. Two formats on one
// screen, on a form where the wrong month means the gear is not there on shoot
// day. The only fix is to stop rendering a native date input, which means
// owning the parsing and formatting here.
//
// Dependency-free BY CONTRACT — it is unit-tested under plain Node, and staying
// import-free keeps it usable from api/ without dragging in the Supabase client
// (same rule as loanPolicy.js / returnFlow.js / announcementPolicy.js).
//
// No Date objects either: leap years are pure arithmetic, and Date() has
// bitten this repo before around Asia/Jerusalem DST boundaries.

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

function daysInMonth(year, month) {
  if (month < 1 || month > 12) return 0;
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1];
}

const pad2 = (n) => String(n).padStart(2, "0");

// Is this a real day on the calendar? Rejects 31/04 and 29/02 of a common year
// rather than rolling them forward — a silently shifted shoot date is worse
// than an error message.
function isRealDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1000 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  return day <= daysInMonth(year, month);
}

// ISO (the value everything else in the app stores) → what the user reads.
// Anything unparseable becomes "" — never the string "Invalid Date", which has
// shipped to users in other codebases and reads like a corrupted record.
export function isoToHe(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  if (!m) return "";
  const [, y, mo, d] = m;
  if (!isRealDate(Number(y), Number(mo), Number(d))) return "";
  return `${d}/${mo}/${y}`;
}

// Is an ISO string a real calendar date? Used before min/max comparisons, which
// are lexicographic and would happily compare against garbage.
export function isValidIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  if (!m) return false;
  return isRealDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

// What the user typed → ISO, or null.
//
// Accepts 18/10/2026, 18.10.2026, 18-10-2026, 18102026 and 1/2/2026.
//
// Returns null for ANY partial value. That is the important half: this parser
// runs while the user is still typing, and a prefix that happened to look like
// a date is exactly how a half-entered year becomes a real (wrong) booking. A
// 2-digit year is rejected for the same reason — "26" could be 1926 or 2026,
// and guessing writes a wrong date into the warehouse.
export function heToIso(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;

  let day, month, year;
  const sep = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(raw);
  if (sep) {
    [, day, month, year] = sep;
  } else if (/^\d{8}$/.test(raw)) {
    day = raw.slice(0, 2); month = raw.slice(2, 4); year = raw.slice(4);
  } else {
    return null;
  }

  const y = Number(year), mo = Number(month), d = Number(day);
  if (!isRealDate(y, mo, d)) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

// Live typing mask: keep digits, insert the slashes, stop at 8 digits.
//
// Deliberately does NOT append a trailing slash after the 2nd or 4th digit —
// that fights backspace, because deleting the slash immediately re-adds it and
// the caret never gets past it.
export function maskDateInput(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}
