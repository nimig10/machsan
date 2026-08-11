#!/usr/bin/env node
// Guards for the productions-board visibility gate.
//
// Background: the gate used to be exempted per-PRODUCTION via
// isLegacyProduction(p) — anything created before 2026-07-14 kept the old
// behavior forever. That exemption also covered ranges ADDED LATER to such a
// production, so a range created today on a May production silently rendered
// neither the "הגש רשימת ציוד" button nor the warning next to it: the editor's
// JSX gates both on `!dateLocked && !isLegacy`, and a range that is neither
// locked nor gated falls between the two branches and renders nothing at all.
// A student hit exactly this (PR of 2026-08-11) and had no way to submit.
//
// The rule is now uniform for every production. The ONE thing that stayed
// scoped is auto-deletion, because hiding is reversible and deleting is not:
// handleEditorClose prunes list-less ranges through upsertProduction's
// delete-missing diff, with no confirmation dialog. Applying that retroactively
// would have deleted a real future shoot from a production created under the
// old rules, just by opening and closing the editor.
//
// No network, no DB. Exit 0 = all passed.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  LEGACY_PRODUCTION_CUTOFF_ISO,
  submittedDateIds,
  getAssignedPhotographer,
  boardVisibleDates,
  pendingDates,
  isRangeAutoPrunable,
} from "../src/utils/productionVisibility.js";

let passed = 0;
let failed = 0;
const check = (name, cond, detail = "") => {
  if (cond) { passed += 1; console.log(`  \x1b[32mPASS\x1b[0m ${name}`); }
  else { failed += 1; console.error(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
};
const ids = (arr) => arr.map(d => d.id).join(",");

// Mirrors the real prod shapes: "סרט גמר שושי" (created 2026-05-20, two
// pre-cutoff ranges + one added 2026-08-11) and a post-cutoff production.
const OLD_PROD = {
  id: "p_old",
  createdAt: "2026-05-20T08:00:00.000Z",
  dates: [
    { id: "d_may1", createdAt: "2026-05-20T08:00:00.000Z" },
    { id: "d_may2", createdAt: "2026-05-21T08:00:00.000Z" },
    { id: "d_aug",  createdAt: "2026-08-11T08:00:00.000Z" },
  ],
};
const NEW_PROD = {
  id: "p_new",
  createdAt: "2026-07-20T08:00:00.000Z",
  dates: [{ id: "n_1", createdAt: "2026-07-20T08:00:00.000Z" }],
};
// Only the two May ranges have a list; the August one does not.
const RES = [
  { production_id: "p_old", production_date_id: "d_may1", status: "מאושר" },
  { production_id: "p_old", production_date_id: "d_may2", status: "הוחזר" },
];

// ── 1. the gate is uniform — this is the whole change ──────────────────────
console.log("\n\x1b[1m> one rule for every production\x1b[0m");
{
  // The old code short-circuited to `dates` here because p.createdAt < cutoff.
  check("an OLD production shows only ranges that have a list",
    ids(boardVisibleDates(OLD_PROD, RES)) === "d_may1,d_may2",
    ids(boardVisibleDates(OLD_PROD, RES)));

  check("a NEW production behaves identically",
    ids(boardVisibleDates(NEW_PROD, [])) === "" &&
    ids(boardVisibleDates(NEW_PROD, [{ production_id: "p_new", production_date_id: "n_1", status: "מאושר" }])) === "n_1");

  // The user-visible bug: this range rendered no button and no warning.
  check("the list-less range on an OLD production is reported as pending",
    ids(pendingDates(OLD_PROD, RES)) === "d_aug",
    ids(pendingDates(OLD_PROD, RES)));

  check("pendingDates is the exact complement of boardVisibleDates",
    boardVisibleDates(OLD_PROD, RES).length + pendingDates(OLD_PROD, RES).length === OLD_PROD.dates.length);

  // createdAt must no longer influence visibility AT ALL. A production with no
  // timestamp used to be treated as legacy ("the safe default") and showed
  // everything; now it is gated like the rest.
  const noStamp = { id: "p_x", dates: [{ id: "x1" }, { id: "x2" }] };
  check("a production with NO createdAt is gated, not exempted",
    ids(boardVisibleDates(noStamp, [{ production_id: "p_x", production_date_id: "x2", status: "ממתין" }])) === "x2");
}

// ── 2. submittedDateIds — unchanged semantics ──────────────────────────────
console.log("\n\x1b[1m> submittedDateIds\x1b[0m");
{
  const mixed = [
    { production_id: "p_old", production_date_id: "d_may1", status: "מאושר" },
    { production_id: "p_old", production_date_id: "d_aug",  status: "בוטל" },   // cancelled
    { production_id: "p_other", production_date_id: "d_may2", status: "מאושר" }, // foreign
    { production_id: "p_old", production_date_id: null,      status: "מאושר" },  // no range
  ];
  const set = submittedDateIds(OLD_PROD, mixed);
  check("a cancelled list does not lock its range", !set.has("d_aug"));
  check("a reservation of another production is ignored", !set.has("d_may2"));
  check("a reservation with no production_date_id is ignored", set.size === 1);
  check("the live reservation is counted", set.has("d_may1"));
  check("null reservations array is tolerated", submittedDateIds(OLD_PROD, null).size === 0);
  check("null production is tolerated", submittedDateIds(null, mixed).size === 0);
}

// ── 3. auto-prune scope — the data-loss guard ──────────────────────────────
// The most important section in this file. handleEditorClose DELETES whatever
// this returns true for, with no confirmation dialog.
console.log("\n\x1b[1m> auto-prune stays scoped (data-loss guard)\x1b[0m");
{
  check("cutoff constant is still exported", LEGACY_PRODUCTION_CUTOFF_ISO === "2026-07-14");

  check("a range created BEFORE the cutoff is never auto-deleted",
    isRangeAutoPrunable({ id: "d", createdAt: "2026-06-15T00:00:00.000Z" }) === false);

  check("a range with NO createdAt is never auto-deleted (safe default)",
    isRangeAutoPrunable({ id: "d" }) === false);

  check("empty / null / undefined createdAt is never auto-deleted",
    isRangeAutoPrunable({ createdAt: "" }) === false &&
    isRangeAutoPrunable({ createdAt: null }) === false &&
    isRangeAutoPrunable(undefined) === false);

  check("a range created AFTER the cutoff is prunable",
    isRangeAutoPrunable({ id: "d", createdAt: "2026-08-11T08:00:00.000Z" }) === true);

  // The prod row this was measured against: עידן's 27-30/09 shoot on a
  // production created 2026-06-15. Opening and closing the editor must not
  // delete it.
  check("the real pre-cutoff prod range survives (טלית בשלושה דורות)",
    OLD_PROD.dates.filter(isRangeAutoPrunable).map(d => d.id).join(",") === "d_aug");
}

// ── 4. crew helper — untouched by this change ──────────────────────────────
console.log("\n\x1b[1m> getAssignedPhotographer (regression)\x1b[0m");
{
  const p = { crew: [
    { role: "photographer", studentId: null, status: "invited" },
    { role: "sound", studentId: "s2", status: "approved" },
    { role: "photographer", studentId: "s1", status: "invited" },
  ]};
  check("an 'invited' photographer with a student still counts",
    getAssignedPhotographer(p)?.studentId === "s1");
  check("a rejected photographer does not count",
    getAssignedPhotographer({ crew: [{ role: "photographer", studentId: "s1", status: "rejected" }] }) === null);
  check("no crew → null", getAssignedPhotographer({}) === null);
}

// ── 5. static: the per-production exemption must not come back ─────────────
console.log("\n\x1b[1m> isLegacyProduction is gone for good\x1b[0m");
{
  const stripComments = (s) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const walk = (dir, out = []) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(js|jsx)$/.test(name)) out.push(full);
    }
    return out;
  };
  const srcDir = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const offenders = walk(srcDir)
    .filter(f => /isLegacyProduction/.test(stripComments(readFileSync(f, "utf8"))));
  check("no file under src/ references isLegacyProduction",
    offenders.length === 0, offenders.join(", "));

  const mod = readFileSync(new URL("../src/utils/productionVisibility.js", import.meta.url), "utf8");
  check("the module stays dependency-free (Node-testable)",
    !/^\s*import\s/m.test(mod));
}

console.log("");
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1mOK ${passed}/${passed} production-visibility tests passed\x1b[0m`);
  process.exit(0);
}
console.log(`\x1b[31m\x1b[1mFAIL ${passed} passed, ${failed} failed\x1b[0m`);
process.exit(1);
