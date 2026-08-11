import { createClient } from "@supabase/supabase-js";

const SB_URL  = import.meta.env.VITE_SUPABASE_URL;
const SB_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

// flowType: 'implicit' — password-reset links carry the access_token directly
// in the URL hash. This lets the link work even when opened in a different
// browser than the one that initiated the reset (e.g. WhatsApp/Telegram
// in-app browsers), where PKCE's code_verifier would be missing.
//
// lock: a promise chain, NOT navigator.locks.
//
// ⛔ Do not restore the supabase-js default (lesson #2): navigator.locks
// deadlocks under Edge tracking-prevention and in PWA standalone mode, hanging
// signInWithPassword past the 10s safety timeout ("זמן התגובה חרג מהצפוי").
// It is also unavailable outright on insecure origins, e.g. testing from a
// phone against http://<LAN-ip>:5174.
//
// But a bare no-op was too far the other way. It left auth operations in THIS
// tab completely unserialised, and Supabase rotates refresh tokens on every
// use with only a 10-second reuse window — past it, reuse-detection revokes the
// token AND its descendants. Two overlapping refreshes therefore destroy the
// session outright: "Invalid Refresh Token: Refresh Token Not Found", after
// which every API call is anon and 403s. On mobile this was routine, because
// frozen background timers all fire at once on resume.
//
// Chaining costs nothing when there is no contention (the common case is an
// already-resolved promise) and cannot deadlock: there is no lock to acquire,
// only a queue. `.then(fn, fn)` runs the next operation whether the previous
// one resolved or rejected, so one failure cannot wedge the queue forever.
//
// What we still do NOT get is cross-TAB coordination — same as before this
// change. Two tabs can still collide; one tab, which is every phone, cannot.
let authChain = Promise.resolve();

export const supabase = createClient(SB_URL, SB_ANON, {
  auth: {
    flowType: "implicit",
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    lock: (_name, _acquireTimeout, fn) => {
      const run = authChain.then(fn, fn);
      // Swallow on the CHAIN only — `run` keeps its rejection for the caller.
      authChain = run.then(() => {}, () => {});
      return run;
    },
  },
});

// Track the latest access token via onAuthStateChange — no navigator.locks needed.
// supabase.auth.getSession() acquires a navigator.lock which can time-out under
// Edge tracking-prevention or when multiple calls contend (e.g. autoRefreshToken
// fires at the same time). Reading from this variable is synchronous and safe.
let _latestToken = null;
export const getLatestToken = () => _latestToken;

supabase.auth.onAuthStateChange((_event, session) => {
  _latestToken = session?.access_token ?? null;
});
