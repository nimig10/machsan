#!/usr/bin/env node
// Guards for the two auth regressions that cost a day of "the app keeps logging
// me out" — see the incident note of 2026-08-10.
//
// Both are STATIC source checks rather than behavioural ones, on purpose:
// src/supabaseClient.js calls createClient at module scope and needs Vite env
// vars, so it cannot be imported under plain Node. What actually has to be
// pinned here is not runtime behaviour but the SHAPE OF THE CODE — the bug was
// a plausible-looking line that someone will be tempted to add back.
//
// The failure being prevented:
//   Supabase rotates refresh tokens on every use, with a 10-second reuse
//   window; past it, reuse-detection revokes the token and its descendants.
//   Two unsynchronised refreshers therefore do not merely duplicate work — they
//   DESTROY the session ("Invalid Refresh Token: Refresh Token Not Found"), and
//   every subsequent API call is anon and 403s.
//
// No network, no DB. Exit 0 = all passed.

import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;
const check = (name, cond, detail = "") => {
  if (cond) { passed += 1; console.log(`  \x1b[32mPASS\x1b[0m ${name}`); }
  else { failed += 1; console.error(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
};

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
// Both files carry long comments explaining exactly what must NOT be written —
// including the forbidden identifiers themselves. Test the CODE, not the prose,
// or the documentation trips its own guard.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const client = stripComments(read("src/supabaseClient.js"));
const app = stripComments(read("src/App.jsx"));

// ── 1. exactly one refresher ───────────────────────────────────────────────
console.log("\n\x1b[1m> one refresher, not two\x1b[0m");
{
  // The line that caused it: setInterval(() => supabase.auth.refreshSession(), 4*60*1000)
  // in App.jsx's staff-auth effect. autoRefreshToken already covers expiry.
  const manualRefresh = /setInterval\s*\(\s*(async\s*)?\(\s*\)\s*=>[\s\S]{0,200}?refreshSession/;
  check("App.jsx has no manual refreshSession interval", !manualRefresh.test(app));

  // A refreshSession call is fine on a one-shot recovery path (utils.js retries
  // once after a 401/403). What must never come back is a TIMER driving it.
  const timerNearRefresh = /(setInterval|setTimeout)\s*\([^)]{0,120}refreshSession/;
  check("no timer of any kind drives refreshSession in App.jsx", !timerNearRefresh.test(app));

  // The naive "fix" for the collision is to switch autoRefreshToken off. That
  // trades random logouts for guaranteed ones the moment a JWT expires.
  check("autoRefreshToken stays ON", /autoRefreshToken:\s*true/.test(client));
  check("persistSession stays ON", /persistSession:\s*true/.test(client));
}

// ── 2. the lock: serialised, but never navigator.locks ─────────────────────
console.log("\n\x1b[1m> the auth lock\x1b[0m");
{
  check("an explicit lock override is present (never the supabase-js default)",
    /\block:\s*\(/.test(client) || /\block:\s*async\s*\(/.test(client));

  // Lesson #2: navigator.locks deadlocks under Edge tracking-prevention and in
  // PWA standalone, and does not exist at all on insecure origins (testing from
  // a phone against http://<LAN-ip>:5174).
  check("navigator.locks is never used", !/navigator\s*\.\s*locks/.test(client));

  // The no-op it replaced (`fn()` with nothing around it) left same-tab auth
  // operations completely unserialised. Require the queue.
  check("the lock queues through a promise chain", /authChain/.test(client));

  // .then(fn, fn) — the second argument is what keeps the queue alive after a
  // rejected operation. Without it one failed refresh wedges auth forever.
  check("the chain survives a rejected operation (.then(fn, fn))",
    /authChain\s*\.\s*then\s*\(\s*fn\s*,\s*fn\s*\)/.test(client),
    "a single-argument .then(fn) would wedge the queue on the first failure");

  // The caller must still see failures; only the CHAIN swallows them.
  check("the caller's promise keeps its rejection",
    /return\s+run\s*;/.test(client));
}

// ── 3. the queue semantics themselves ──────────────────────────────────────
// Mirrors the implementation above (pinned by the static checks in section 2)
// so the reasoning behind it is executable, not just asserted.
console.log("\n\x1b[1m> queue semantics\x1b[0m");
{
  let chain = Promise.resolve();
  const lock = (fn) => { const run = chain.then(fn, fn); chain = run.then(() => {}, () => {}); return run; };

  const order = [];
  const slow = () => new Promise(r => setTimeout(() => { order.push("slow"); r("slow"); }, 30));
  const fast = () => { order.push("fast"); return Promise.resolve("fast"); };

  const a = lock(slow);
  const b = lock(fast);
  await Promise.all([a, b]);
  check("a later operation waits for an earlier one (no overlap)",
    order.join(",") === "slow,fast", order.join(","));

  // The whole point: a failed refresh must not stop the next one from running.
  const boom = lock(() => Promise.reject(new Error("refresh failed")));
  let rejected = false;
  await boom.catch(() => { rejected = true; });
  check("a failed operation still rejects for its caller", rejected);

  const after = await lock(() => Promise.resolve("still working"));
  check("the queue keeps running after a failure", after === "still working");
}

console.log("");
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1mOK ${passed}/${passed} auth-guard tests passed\x1b[0m`);
  process.exit(0);
}
console.log(`\x1b[31m\x1b[1mFAIL ${passed} passed, ${failed} failed\x1b[0m`);
process.exit(1);
