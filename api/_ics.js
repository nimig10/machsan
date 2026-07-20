// _ics.js — minimal, dependency-free iCalendar (RFC 5545) builder for the
// course-session → Google Calendar sync (api/calendar-sync.js).
//
// We hand-build the VCALENDAR text (same philosophy as the HTML emails in
// send-email.js) — no ics/ical npm dependency. Times are emitted in UTC
// ("...Z") computed from Asia/Jerusalem wall-clock via Intl, so we don't have
// to ship a hand-crafted VTIMEZONE block with Israel's DST RRULEs.

const TZ = "Asia/Jerusalem";
const PRODID = "-//Camera Sound App//Course Calendar Sync//HE";

// Offset (minutes) that `tz` is ahead of UTC at the given UTC instant.
function tzOffsetMinutes(tz, utcMs) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const m = {};
  for (const p of parts) m[p.type] = p.value;
  const asUTC = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour, +m.minute, +m.second);
  return (asUTC - utcMs) / 60000;
}

// "YYYY-MM-DD" + "HH:MM" (Asia/Jerusalem wall time) -> Date (the UTC instant).
function wallTimeToDate(dateStr, timeStr) {
  const [y, mo, d] = String(dateStr || "").split("-").map(Number);
  const [h, mi] = String(timeStr || "00:00").split(":").map(Number);
  if (!y || !mo || !d) return null;
  const guess = Date.UTC(y, mo - 1, d, h || 0, mi || 0, 0);
  // Times are always well away from the 02:00–03:00 DST transition, so a single
  // offset lookup at the guessed instant is exact for our use.
  const off = tzOffsetMinutes(TZ, guess);
  return new Date(guess - off * 60000);
}

// Date -> "YYYYMMDDTHHMMSSZ" (UTC iCalendar timestamp).
function fmtUTC(dt) {
  if (!(dt instanceof Date) || isNaN(dt.getTime())) return null;
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}` +
    `T${p(dt.getUTCHours())}${p(dt.getUTCMinutes())}${p(dt.getUTCSeconds())}Z`
  );
}

// Escape a TEXT value per RFC 5545 §3.3.11.
function esc(value) {
  return String(value == null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Escape a PARAMETER value per RFC 5545 §3.2 (param-text / quoted-string).
// Backslash escaping is NOT defined for parameters — `esc()` here produces a
// parse error. A bare `:` would also terminate the property early. So: strip
// the forbidden characters and wrap in DQUOTE. Matters for real data — a
// lecturer named `כהן, דני` breaks the file under esc().
const PARAM_FORBIDDEN = new Set(["\\", '"', ";", ":", ","]);
function escParam(value) {
  let out = "";
  for (const ch of String(value == null ? "" : value)) {
    const code = ch.codePointAt(0);
    if (code < 0x20 || code === 0x7f) continue; // control characters
    out += PARAM_FORBIDDEN.has(ch) ? " " : ch;
  }
  return `"${out.replace(/\s+/g, " ").trim()}"`;
}

// Fold a content line to <=75 octets with CRLF + single-space continuation.
function fold(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Don't split a multi-byte UTF-8 char: back off until we're at a lead byte.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push(bytes.slice(start, end).toString("utf8"));
    start = end;
    limit = 74; // continuation lines are prefixed with one space
  }
  return out.join("\r\n ");
}

function line(key, value) {
  return fold(`${key}:${value}`);
}

// events: [{ uid, date, startTime, endTime, summary, description, location,
//            organizerName?, organizerEmail?, attendeeName?, attendeeEmail?,
//            sequence?, cancelled? }]
//
// method: "PUBLISH" (default) | "REQUEST" | "CANCEL"
//
// PUBLISH is what we send. It means "here are events you may add", which is
// exactly the product behaviour: one email, one "Add to Calendar" click, all
// the course sessions land in the lecturer's calendar. It also carries no
// attendee semantics, so ORGANIZER/ATTENDEE are omitted — those belong to
// REQUEST, and emitting them here only adds parse surface for no benefit.
//
// REQUEST (an actual RSVP invitation) was tried first and rejected by Gmail:
// with several VEVENTs carrying DIFFERENT UIDs it is not a conformant iTIP
// REQUEST (RFC 5546 — a REQUEST carries one UID), so Gmail refused to treat it
// as an invitation and fell back to scraping the message body. Verified
// 2026-07-20 against Gmail: PUBLISH + 4 VEVENTs + Hebrew renders "Add to
// Calendar" and one click adds all four. Do not "upgrade" this back to REQUEST
// without re-testing that whole path end to end.
export function buildIcs(events, { method = "PUBLISH" } = {}) {
  const list = Array.isArray(events) ? events : [];
  const stamp = fmtUTC(new Date());
  const isPublish = method === "PUBLISH";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    line("PRODID", PRODID),
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
  ];

  for (const ev of list) {
    const dtStart = fmtUTC(wallTimeToDate(ev.date, ev.startTime));
    const dtEnd = fmtUTC(wallTimeToDate(ev.date, ev.endTime || ev.startTime));
    if (!dtStart || !dtEnd) continue;
    lines.push(
      "BEGIN:VEVENT",
      line("UID", ev.uid),
      line("DTSTAMP", stamp),
      line("DTSTART", dtStart),
      line("DTEND", dtEnd),
      line("SUMMARY", esc(ev.summary || "")),
    );
    if (!isPublish) lines.push(line("SEQUENCE", String(ev.sequence || 0)));
    if (ev.description) lines.push(line("DESCRIPTION", esc(ev.description)));
    if (ev.location) lines.push(line("LOCATION", esc(ev.location)));
    if (!isPublish) {
      if (ev.organizerEmail) {
        lines.push(line(`ORGANIZER;CN=${escParam(ev.organizerName)}`, `mailto:${ev.organizerEmail}`));
      }
      if (ev.attendeeEmail) {
        lines.push(line(
          `ATTENDEE;CN=${escParam(ev.attendeeName || ev.attendeeEmail)};` +
            "ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE",
          `mailto:${ev.attendeeEmail}`,
        ));
      }
    }
    lines.push(
      line("STATUS", ev.cancelled ? "CANCELLED" : "CONFIRMED"),
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

// Exposed for unit sanity checks / reuse.
export const _internal = { wallTimeToDate, fmtUTC, esc, escParam, fold, tzOffsetMinutes };
