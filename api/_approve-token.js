// _approve-token.js — HMAC-signed tokens for the dept-head approval link.
//
// The /api/approve-production endpoint used to accept a bare `?id=<n>` query
// string, so anyone who guessed a reservation id could flip its status to
// "ממתין" (IDOR). This helper closes that gap:
//
//   * signApproveToken(id) — returns `<exp>.<sig>` where
//       - exp is seconds-since-epoch when the token becomes invalid
//       - sig is HMAC-SHA256(secret, `${id}:${exp}`), base64url-encoded
//     The token is embedded in the email link: `?id=123&token=...`.
//
//   * verifyApproveToken(id, token) — returns true iff the signature matches
//     AND the token has not expired AND the id matches the one inside the
//     signed payload. Uses timingSafeEqual to avoid signature-timing leaks.
//
// The secret (APPROVE_TOKEN_SECRET) lives only on the server. If it is not
// configured, BOTH sign and verify return null/false — old and new links
// become unusable, failing closed instead of open.

import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.APPROVE_TOKEN_SECRET || "";
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function b64urlEncode(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 2 ? "==" : str.length % 4 === 3 ? "=" : "";
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

function hmac(message) {
  return createHmac("sha256", SECRET).update(message).digest();
}

export function signApproveToken(id, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!SECRET) {
    console.error("APPROVE_TOKEN_SECRET env var is not set — cannot sign approve token");
    return null;
  }
  if (!id && id !== 0) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = b64urlEncode(hmac(`${id}:${exp}`));
  return `${exp}.${sig}`;
}

export function verifyApproveToken(id, token) {
  if (!SECRET) return false;
  if (!id && id !== 0) return false;
  if (typeof token !== "string" || !token.includes(".")) return false;

  const [expStr, sigStr] = token.split(".", 2);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;

  let given;
  try { given = b64urlDecode(sigStr); } catch { return false; }
  const expected = hmac(`${id}:${exp}`);
  if (given.length !== expected.length) return false;
  try { return timingSafeEqual(given, expected); } catch { return false; }
}
