// announcementsApi.js — thin client wrappers around /api/announcement.
//
// Both tables are RLS-on with no anon/authenticated policy, so there is no
// supabase.from("announcements") path — the endpoint is the only way in, and
// it decides what the caller is allowed to see based on their JWT.

import { getAuthToken } from "../utils.js";

async function authHeaders() {
  const token = await getAuthToken();
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function post(body) {
  const res = await fetch("/api/announcement", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    return { ok: false, error: data.error || `HTTP ${res.status}`, detail: data.detail };
  }
  return { ok: true, ...data };
}

// ─── viewer ────────────────────────────────────────────────────────────────

// The announcement this user should be shown right now, or null. Every rule
// (audience, day cap, already-seen-today) is applied server-side.
export async function fetchMyAnnouncement() {
  try {
    const res = await fetch("/api/announcement", { headers: await authHeaders() });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data?.announcement || null;
  } catch {
    return null; // a notice that fails to load is never worth an error to the user
  }
}

// Fire-and-forget: called the moment the modal renders, not on dismiss, so a
// refresh cannot re-show the same notice. Idempotent server-side.
export async function markAnnouncementSeen(id) {
  if (!id) return;
  try { await post({ action: "seen", id }); } catch { /* silent */ }
}

// ─── admin ─────────────────────────────────────────────────────────────────

export function adminGetAnnouncement()          { return post({ action: "admin-get" }); }
// Who saw the live announcement and when — one entry per person.
export function adminGetAnnouncementViewers()   { return post({ action: "viewers" }); }
// Edit in place — the id survives, so people who already read it are not
// shown it again.
export function adminSaveAnnouncement(payload)  { return post({ action: "save", ...payload }); }
// New row, new id — everyone in the audience sees it again from scratch.
export function adminPublishAnnouncement(p)     { return post({ action: "publish", ...p }); }
export function adminDeactivateAnnouncement()   { return post({ action: "deactivate" }); }
