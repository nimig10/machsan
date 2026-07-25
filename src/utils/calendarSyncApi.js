// calendarSyncApi.js — client trigger for the course → Google Calendar sync.
//
// Fire-and-forget: pings /api/calendar-sync with a lessonId after a course is
// saved or deleted. The endpoint reconciles the lesson's sessions against the
// live DB state and emails ICS invites/updates/cancellations to the lecturers.
//
// It NEVER throws and NEVER blocks the caller — a sync failure must not affect
// the course save itself. Missed pings are recoverable via a manual
// `?reconcile=all` run.
//
// It DOES report failures, though: a silent swallow here means a lecturer never
// gets their calendar and nobody finds out. Every failure path resolves to
// { ok: false, reason }, so the caller can surface a warning. Callers that don't
// care may ignore the return value — this still never throws.

import { supabase } from "../supabaseClient.js";

export async function syncLessonCalendar(lessonId) {
  try {
    if (!lessonId) return { ok: false, reason: "no-lesson-id" };
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return { ok: false, reason: "no-session" }; // staff-only endpoint
    const res = await fetch("/api/calendar-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ lessonId }),
    });
    if (!res.ok) {
      console.warn("[calendarSyncApi] server returned", res.status);
      return { ok: false, reason: `http-${res.status}` };
    }
    // The endpoint answers 200 even when a send fails, so read the body. The
    // per-lesson result is { added, changed, removed, refreshed, invites,
    // notices, emailed, persisted } — these field names are the contract; an
    // earlier version checked `requests`/`cancels`, which the server has never
    // returned, so the condition was always false and this whole check was dead.
    const body = await res.json().catch(() => null);
    const r = body?.results?.[0];
    // A delta was computed but nothing left the building: SMTP rejected it after
    // its own retries. The lecturer has no calendar and only this line says so.
    const delta = (r?.added || 0) + (r?.changed || 0) + (r?.removed || 0);
    if (r && delta > 0 && !r.emailed) {
      console.warn("[calendarSyncApi] nothing emailed", r);
      return { ok: false, reason: "send-failed", detail: r };
    }
    // Mail went out but the snapshot did not save (PR #89 reports this and
    // nobody read it). The next run recomputes the identical delta and mails
    // the SAME change notice again — worth surfacing before that happens.
    if (r && r.persisted === false) {
      console.warn("[calendarSyncApi] snapshot not persisted", r);
      return { ok: false, reason: "not-persisted", detail: r };
    }
    return { ok: true, detail: r || null };
  } catch (e) {
    // Typically the dev server being down, or offline.
    console.warn("[calendarSyncApi.syncLessonCalendar]", e?.message || e);
    return { ok: false, reason: "network" };
  }
}
