import { createClient } from "@supabase/supabase-js";

const SB_URL  = import.meta.env.VITE_SUPABASE_URL;
const SB_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

// flowType: 'implicit' — password-reset links carry the access_token directly
// in the URL hash. This lets the link work even when opened in a different
// browser than the one that initiated the reset (e.g. WhatsApp/Telegram
// in-app browsers), where PKCE's code_verifier would be missing.
export const supabase = createClient(SB_URL, SB_ANON, {
  auth: {
    flowType: "implicit",
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
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
