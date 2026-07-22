#!/usr/bin/env node
// DB smoke tests: runs the existing in-DB regression suites and exits non-zero on any failure.
// Required env:
//   SUPABASE_URL                       https://<project-ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY          service-role key (NEVER prod)
// Optional env:
//   SUPABASE_EXPECTED_PROJECT_REF      default: mhvujejdlmtowypjdhjd (dev)
//
// Exit codes:
//   0  all scenarios passed
//   1  one or more scenarios failed (or an RPC errored)
//   2  config error (missing env, prod-ref guard tripped)

import { createClient } from "@supabase/supabase-js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function fail(msg, code = 2) {
  console.error(`${RED}${msg}${RESET}`);
  process.exit(code);
}

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const EXPECTED_REF = process.env.SUPABASE_EXPECTED_PROJECT_REF || "mhvujejdlmtowypjdhjd";

if (!SUPABASE_URL) fail("config: SUPABASE_URL is not set", 2);
if (!SUPABASE_SERVICE_ROLE_KEY) fail("config: SUPABASE_SERVICE_ROLE_KEY is not set", 2);

let actualRef;
try {
  actualRef = new URL(SUPABASE_URL).hostname.split(".")[0];
} catch {
  fail(`config: SUPABASE_URL is not a valid URL: ${SUPABASE_URL}`, 2);
}

if (actualRef !== EXPECTED_REF) {
  fail(
    `Refusing to run: URL host '${actualRef}' does not match expected dev ref '${EXPECTED_REF}'. ` +
      `Set SUPABASE_EXPECTED_PROJECT_REF if you really intend a different project.`,
    2,
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function truncate(s, n) {
  const str = String(s ?? "");
  if (str.length <= n) return str.padEnd(n, " ");
  return str.slice(0, n - 1) + "...";
}

function printTable(rows, columns) {
  const header = columns.map((c) => truncate(c.label, c.width)).join("  ");
  console.log(`${BOLD}${header}${RESET}`);
  console.log(DIM + columns.map((c) => "-".repeat(c.width)).join("  ") + RESET);
  for (const row of rows) {
    const line = columns
      .map((c) => {
        const val = row[c.key];
        const text = truncate(val, c.width);
        if (c.key === "passed") {
          return val === true ? `${GREEN}${text}${RESET}` : `${RED}${text}${RESET}`;
        }
        return text;
      })
      .join("  ");
    console.log(line);
  }
}

async function runSuite({ rpc, expectedCount, columns }) {
  console.log(`\n${BOLD}> ${rpc}${RESET}`);
  const { data, error } = await supabase.rpc(rpc);
  if (error) {
    console.error(`${RED}RPC error: ${error.message}${RESET}`);
    return { passed: 0, failed: expectedCount, errored: true };
  }
  const rows = Array.isArray(data) ? data : [];
  printTable(rows, columns);

  let passed = 0;
  let failed = 0;
  for (const r of rows) {
    if (r.passed === true) passed += 1;
    else failed += 1;
  }
  if (rows.length !== expectedCount) {
    console.warn(
      `${RED}Row count mismatch: expected ${expectedCount}, got ${rows.length}${RESET}`,
    );
    failed += Math.max(0, expectedCount - rows.length);
  }
  console.log(`${DIM}-> ${passed} passed, ${failed} failed${RESET}`);
  return { passed, failed, errored: false };
}

const overlapCols = [
  { key: "scenario", label: "scenario", width: 68 },
  { key: "expected_reserved", label: "exp", width: 4 },
  { key: "actual_reserved", label: "act", width: 4 },
  { key: "passed", label: "pass", width: 5 },
];

const productionCols = [
  { key: "scenario", label: "scenario", width: 56 },
  { key: "expected", label: "expected", width: 24 },
  { key: "actual", label: "actual", width: 24 },
  { key: "passed", label: "pass", width: 5 },
];

const studentOverlapCols = [
  { key: "scenario", label: "scenario", width: 56 },
  { key: "expected", label: "expected", width: 10 },
  { key: "actual", label: "actual", width: 14 },
  { key: "passed", label: "pass", width: 5 },
];

const results = [];
results.push(
  await runSuite({
    rpc: "run_reservation_overlap_tests",
    expectedCount: 13,
    columns: overlapCols,
  }),
);
results.push(
  await runSuite({
    rpc: "run_productions_regression_tests",
    expectedCount: 6,
    columns: productionCols,
  }),
);
results.push(
  await runSuite({
    rpc: "run_student_overlap_tests",
    expectedCount: 5,
    columns: studentOverlapCols,
  }),
);
results.push(
  await runSuite({
    rpc: "run_studio_overlap_tests",
    expectedCount: 6,
    columns: studentOverlapCols,
  }),
);
results.push(
  await runSuite({
    rpc: "run_availability_peak_tests",
    expectedCount: 3,
    columns: studentOverlapCols,
  }),
);
results.push(
  await runSuite({
    rpc: "run_reservation_update_tests",
    expectedCount: 16,
    columns: studentOverlapCols,
  }),
);
results.push(
  await runSuite({
    rpc: "run_reservation_update_v3_tests",
    expectedCount: 3,
    columns: studentOverlapCols,
  }),
);

const totalPassed = results.reduce((n, r) => n + r.passed, 0);
const totalFailed = results.reduce((n, r) => n + r.failed, 0);
const anyErrored = results.some((r) => r.errored);
const total = totalPassed + totalFailed;

console.log("");
if (totalFailed === 0 && !anyErrored) {
  console.log(`${GREEN}${BOLD}OK ${totalPassed}/${total} scenarios passed${RESET}`);
  process.exit(0);
}
console.log(`${RED}${BOLD}FAIL ${totalPassed}/${total} passed, ${totalFailed} failed${RESET}`);
process.exit(1);
