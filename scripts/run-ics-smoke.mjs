#!/usr/bin/env node
// run-ics-smoke.mjs — guard rails for the course→calendar ICS contract.
//
// Every assertion here encodes a failure that actually happened on 2026-07-20
// while getting this feature to work against Gmail. They are cheap to run and
// they exist so nobody has to rediscover any of it:
//   * METHOD:REQUEST with several UIDs is not valid iTIP — Gmail refused it.
//   * encoding:"base64" on the calendar part made Gmail answer "Unable to load
//     event". The nodemailer default is what works.
//   * A room name prefixed onto LOCATION moved the map pin off the college.
//   * An ASCII " in the address gets HTML-escaped by Google into &quot;.
//
// No network, no DB. Run with: npm run test:ics

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildIcs, _internal } from "../api/_ics.js";

const { escParam } = _internal;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    const problem = fn();
    if (problem) failures.push(`${name}\n    ${problem}`);
    else passed += 1;
  } catch (e) {
    failures.push(`${name}\n    threw: ${e.message}`);
  }
}

const SESSION = {
  uid: "machsan-l1-sk1-lec1@camera.org.il",
  date: "2026-12-01",
  startTime: "10:00",
  endTime: "13:00",
  summary: "קורס בדיקה — מבוא",
  description: "מסלול: הנדסאי סאונד ב\nחדר: DIGITAL MIX ROOM",
  location: 'רחוב ריב״ל 5, תל אביב',
};

// ── 1. PUBLISH shape ──────────────────────────────────────────────────────
check("buildIcs defaults to METHOD:PUBLISH", () => {
  const ics = buildIcs([SESSION]);
  if (!ics.includes("METHOD:PUBLISH")) return "METHOD:PUBLISH missing";
  return null;
});

check("PUBLISH omits ORGANIZER / ATTENDEE / SEQUENCE", () => {
  const ics = buildIcs(
    [{ ...SESSION, organizerEmail: "x@y.com", organizerName: "Org", attendeeEmail: "a@b.com", sequence: 3 }],
    { method: "PUBLISH" },
  );
  const bad = ["ORGANIZER", "ATTENDEE", "SEQUENCE"].filter((k) => ics.includes(`${k}:`) || ics.includes(`${k};`));
  // Those properties carry attendee semantics that only apply to REQUEST. Gmail
  // handles PUBLISH as "here are events to add"; adding them is pure parse risk.
  return bad.length ? `unexpected properties in PUBLISH: ${bad.join(", ")}` : null;
});

check("every VEVENT carries a UID", () => {
  const ics = buildIcs([SESSION, { ...SESSION, uid: "second@camera.org.il", date: "2026-12-08" }]);
  const events = ics.split("BEGIN:VEVENT").length - 1;
  const uids = (ics.match(/^UID:/gm) || []).length;
  return events === uids ? null : `${events} VEVENTs but ${uids} UIDs`;
});

// ── 2. Line folding / encoding integrity ──────────────────────────────────
check("no content line exceeds 75 octets", () => {
  const ics = buildIcs([SESSION]);
  const over = ics.split("\r\n").filter((l) => Buffer.from(l, "utf8").length > 75);
  return over.length ? `${over.length} over-long line(s), first: ${over[0].slice(0, 40)}…` : null;
});

check("base64 round-trip is byte-identical", () => {
  const ics = buildIcs([SESSION]);
  const back = Buffer.from(Buffer.from(ics, "utf8").toString("base64"), "base64").toString("utf8");
  return back === ics ? null : "ICS changed across base64 round-trip";
});

// ── 3. Parameter escaping ─────────────────────────────────────────────────
check("escParam quotes and strips forbidden characters", () => {
  // RFC 5545 §3.2: parameter values are param-text / quoted-string. Backslash
  // escaping is undefined there, and a bare ':' would end the property early.
  const out = escParam('כהן, דני; "ראשי": מרצה');
  if (!out.startsWith('"') || !out.endsWith('"')) return `not quoted: ${out}`;
  const inner = out.slice(1, -1);
  const bad = [",", ";", ":", '"', "\\"].filter((c) => inner.includes(c));
  return bad.length ? `forbidden chars survived: ${bad.join(" ")}` : null;
});

// ── 4. The college address contract ───────────────────────────────────────
const calendarSyncSrc = readFileSync(resolve(ROOT, "api/calendar-sync.js"), "utf8");
const addressLine = calendarSyncSrc.match(/^const COLLEGE_ADDRESS = .*$/m)?.[0] || "";

check("COLLEGE_ADDRESS uses the Hebrew gershayim, not an ASCII quote", () => {
  if (!addressLine) return "COLLEGE_ADDRESS not found";
  const value = addressLine.slice(addressLine.indexOf("=") + 1).trim().replace(/^["']|["'];?$/g, "");
  // Google Calendar HTML-escapes a `"` when storing the location, so Directions
  // ends up searching `רחוב ריב&quot;ל 5` and finds nothing. U+05F4 is the
  // correct Hebrew character anyway and is not HTML-special.
  if (value.includes('"')) return "address contains an ASCII double quote";
  if (!value.includes("״")) return "address is missing the gershayim ״ (U+05F4)";
  return null;
});

check("LOCATION is the address alone — no room name prefix", () => {
  // Google geocodes LOCATION verbatim; "DIGITAL MIX ROOM · <address>" drops the
  // pin in the wrong place. The room belongs in DESCRIPTION.
  const assignment = calendarSyncSrc.match(/const location = .*/)?.[0] || "";
  if (!assignment) return "location assignment not found";
  return assignment.includes("COLLEGE_ADDRESS") && !assignment.includes("rooms")
    ? null
    : `LOCATION is built from more than the address: ${assignment.trim()}`;
});

// ── 5. Mail transport contract ────────────────────────────────────────────
const sendEmailSrc = readFileSync(resolve(ROOT, "api/send-email.js"), "utf8");

check("calendar part does not force base64 encoding", () => {
  const block = sendEmailSrc.slice(sendEmailSrc.indexOf("const icalEvent"), sendEmailSrc.indexOf("try {", sendEmailSrc.indexOf("const icalEvent")));
  if (!block) return "icalEvent block not found";
  return /encoding\s*:/.test(block)
    ? "icalEvent sets an explicit encoding — the nodemailer default is what Gmail accepts"
    : null;
});

// ── report ────────────────────────────────────────────────────────────────
const total = passed + failures.length;
if (failures.length) {
  console.error(`\nICS smoke: ${passed}/${total} passed\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error("");
  process.exit(1);
}
console.log(`ICS smoke: ${passed}/${total} passed`);
