// announcement.js — the daily one-off announcement shown to users in a
// floating modal on their first entry of the day.
//
// PROTOCOL
//   GET                              -> { announcement } | { announcement: null }
//   POST { action: "seen", id }      -> record that the caller was shown it today
//   POST { action: "admin-get" }     -> the active announcement + viewer count
//   POST { action: "save", ... }     -> edit the active row IN PLACE (id kept)
//   POST { action: "publish", ... }  -> deactivate current + insert a NEW row
//   POST { action: "deactivate" }    -> stop showing it
//
// AUTH
//   Viewer actions: requireUser  (any authenticated user)
//   Admin actions:  requireAdmin
// Authenticated from the first commit — an unauthenticated write endpoint is
// exactly the hole PR #89 had to close on /api/activity-log (lesson #41).
//
// WHO SEES WHAT IS DECIDED HERE, NOT IN THE CLIENT.
// announcements / announcement_views are RLS-on with no anon/authenticated
// policy, so the browser cannot read them directly. The caller's role flags
// come from public.users keyed by their JWT id — never from the request body —
// so a student cannot ask for a staff-targeted announcement (lesson #37).
//
// DISPLAY-ONLY: nothing here touches reservations, equipment, statuses,
// availability or any RPC.

import { requireUser, requireAdmin } from "./_auth-helper.js";
import { matchesAudience, shouldShow, AUDIENCES } from "../src/utils/announcementPolicy.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const H = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

const enc = (v) => encodeURIComponent(String(v));

// "Today" for a college in Israel — same helper shape as api/calendar-sync.js.
// Using the server's UTC date would flip the day at 02:00/03:00 local time and
// re-show a notice to anyone browsing late at night.
function todayInIsrael() {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" }).slice(0, 10);
}

async function sb(path, options = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: H, ...options });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { ok: r.ok, status: r.status, data, text };
}

async function loadActiveAnnouncement() {
  const r = await sb("announcements?active=is.true&select=*&limit=1");
  if (!r.ok) return { error: r.text };
  return { row: r.data?.[0] || null };
}

// The caller's live role flags. Same source of truth the rest of the app uses
// (public.users, kept in sync with students/lecturers by PR #73).
async function loadRoleFlags(userId) {
  const r = await sb(`users?id=eq.${enc(userId)}&select=is_student,is_lecturer,is_admin,is_warehouse,full_name&limit=1`);
  return r.ok ? (r.data?.[0] || {}) : {};
}

// Shape sent to the browser. Deliberately excludes anything the client has no
// business seeing (audience, counters, who wrote it).
function toPublicShape(row) {
  return {
    id: row.id,
    title: row.title || "",
    body: row.body || "",
    videoUrl: row.video_url || "",
    videoTitle: row.video_title || "",
    videoOrientation: row.video_orientation || "landscape",
  };
}

// Normalize an admin-supplied payload into DB columns. Unknown audiences and
// out-of-range day counts fall back to the safe defaults rather than 400ing —
// the CHECK constraints are the real backstop.
function toRow(body) {
  const audience = AUDIENCES.includes(body?.audience) ? body.audience : "all";
  const displayDays = Number(body?.displayDays) === 2 ? 2 : 1;
  const orientation = body?.videoOrientation === "vertical" ? "vertical" : "landscape";
  const videoUrl = String(body?.videoUrl || "").trim();
  return {
    title: String(body?.title || "").trim(),
    body: String(body?.body || "").trim(),
    audience,
    display_days: displayDays,
    // No video → clear all three columns together, never a half-set snapshot.
    video_url: videoUrl || null,
    video_title: videoUrl ? String(body?.videoTitle || "").trim() || null : null,
    video_orientation: videoUrl ? orientation : null,
  };
}

export default async function handler(req, res) {
  if (!SB_URL || !SB_KEY) {
    return res.status(500).json({ ok: false, error: "supabase env missing" });
  }

  // ── Viewer: what should I be shown right now? ────────────────────────────
  if (req.method === "GET") {
    const user = await requireUser(req, res);
    if (!user) return; // response already sent

    try {
      const { row, error } = await loadActiveAnnouncement();
      if (error) {
        console.error("announcement: load active failed:", error);
        return res.status(500).json({ ok: false, error: "load_failed" });
      }
      if (!row) return res.status(200).json({ ok: true, announcement: null });

      const flags = await loadRoleFlags(user.id);
      if (!matchesAudience(row.audience, flags)) {
        return res.status(200).json({ ok: true, announcement: null });
      }

      // How many DISTINCT days this user has already been shown it, and
      // whether one of them is today.
      const views = await sb(
        `announcement_views?announcement_id=eq.${enc(row.id)}&user_id=eq.${enc(user.id)}&select=seen_on`
      );
      const seenDays = views.ok && Array.isArray(views.data) ? views.data : [];
      const today = todayInIsrael();
      const seenToday = seenDays.some((v) => String(v.seen_on) === today);

      if (!shouldShow({ displayDays: row.display_days, daysSeen: seenDays.length, seenToday })) {
        return res.status(200).json({ ok: true, announcement: null });
      }
      return res.status(200).json({ ok: true, announcement: toPublicShape(row) });
    } catch (e) {
      console.error("announcement GET error:", e);
      return res.status(500).json({ ok: false, error: "network_error" });
    }
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method not allowed" });
  }

  const body = req.body && typeof req.body === "object"
    ? req.body
    : (() => { try { return JSON.parse(req.body || "{}"); } catch { return {}; } })();
  const action = String(body.action || "");

  // ── Viewer: record that it was shown ────────────────────────────────────
  // Called the moment the modal renders, not on dismiss: otherwise a page
  // refresh (or closing the tab) would re-show the same notice forever.
  if (action === "seen") {
    const user = await requireUser(req, res);
    if (!user) return;
    const id = body.id;
    if (!id) return res.status(400).json({ ok: false, error: "missing id" });
    try {
      // The PK (announcement_id, user_id, seen_on) makes this idempotent, so a
      // double render cannot inflate the day counter.
      const r = await sb("announcement_views?on_conflict=announcement_id,user_id,seen_on", {
        method: "POST",
        headers: { ...H, Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({ announcement_id: id, user_id: user.id, seen_on: todayInIsrael() }),
      });
      if (!r.ok) console.error("announcement: view insert failed:", r.text);
      // Always 200 — failing to record a view must never surface an error to
      // someone who just read a notice.
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error("announcement seen error:", e);
      return res.status(200).json({ ok: true });
    }
  }

  // ── Admin ───────────────────────────────────────────────────────────────
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    if (action === "admin-get") {
      const { row, error } = await loadActiveAnnouncement();
      if (error) return res.status(500).json({ ok: false, error: "load_failed" });
      if (!row) return res.status(200).json({ ok: true, announcement: null, viewers: 0 });
      // Distinct viewers, not view rows: a 2-day notice writes two rows per
      // person and "נצפתה ע״י N" must not double-count them.
      const v = await sb(`announcement_views?announcement_id=eq.${enc(row.id)}&select=user_id`);
      const viewers = v.ok && Array.isArray(v.data)
        ? new Set(v.data.map((x) => x.user_id)).size
        : 0;
      return res.status(200).json({ ok: true, announcement: row, viewers });
    }

    if (action === "save") {
      // Edit in place: the id is preserved, so announcement_views survive and
      // whoever already read it is NOT shown it again. This is the "fix a typo"
      // path — republishing is a separate, explicit action.
      const { row, error } = await loadActiveAnnouncement();
      if (error) return res.status(500).json({ ok: false, error: "load_failed" });
      if (!row) return res.status(404).json({ ok: false, error: "no_active_announcement" });
      const patch = toRow(body);
      if (!patch.title) return res.status(400).json({ ok: false, error: "missing_title" });
      const r = await sb(`announcements?id=eq.${enc(row.id)}`, {
        method: "PATCH",
        headers: { ...H, Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) {
        console.error("announcement save failed:", r.text);
        return res.status(500).json({ ok: false, error: "save_failed", detail: r.text });
      }
      return res.status(200).json({ ok: true, announcement: r.data?.[0] || null });
    }

    if (action === "publish") {
      // A NEW row (new id) ⇒ nobody has views against it ⇒ everyone in the
      // audience sees it again. The old row is deactivated, not deleted, so
      // past announcements remain as history.
      const patch = toRow(body);
      if (!patch.title) return res.status(400).json({ ok: false, error: "missing_title" });
      // Deactivate first: uq_announcements_one_active permits a single active
      // row, so the insert would be rejected while the old one is still live.
      const off = await sb("announcements?active=is.true", {
        method: "PATCH",
        headers: { ...H, Prefer: "return=minimal" },
        body: JSON.stringify({ active: false }),
      });
      if (!off.ok) {
        console.error("announcement publish: deactivate failed:", off.text);
        return res.status(500).json({ ok: false, error: "publish_failed", detail: off.text });
      }
      const r = await sb("announcements", {
        method: "POST",
        headers: { ...H, Prefer: "return=representation" },
        body: JSON.stringify({
          ...patch,
          active: true,
          published_at: new Date().toISOString(),
          created_by_name: admin.email || null,
        }),
      });
      if (!r.ok) {
        console.error("announcement publish failed:", r.text);
        return res.status(500).json({ ok: false, error: "publish_failed", detail: r.text });
      }
      return res.status(200).json({ ok: true, announcement: r.data?.[0] || null });
    }

    if (action === "deactivate") {
      const r = await sb("announcements?active=is.true", {
        method: "PATCH",
        headers: { ...H, Prefer: "return=minimal" },
        body: JSON.stringify({ active: false }),
      });
      if (!r.ok) return res.status(500).json({ ok: false, error: "deactivate_failed", detail: r.text });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: "unknown action" });
  } catch (e) {
    console.error("announcement POST error:", e);
    return res.status(500).json({ ok: false, error: "network_error", detail: e.message });
  }
}
