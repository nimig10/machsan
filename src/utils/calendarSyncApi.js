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
    // The endpoint answers 200 even when a send fails, so read the body: a
    // course with pending invites but emailed === 0 means nothing went out.
    const body = await res.json().catch(() => null);
    const r = body?.results?.[0];
    if (r && (r.requests || r.cancels) && !r.emailed) {
      console.warn("[calendarSyncApi] nothing emailed", r);
      return { ok: false, reason: "send-failed", detail: r };
    }
    return { ok: true, detail: r || null };
  } catch (e) {
    // Typically the dev server being down, or offline.
    console.warn("[calendarSyncApi.syncLessonCalendar]", e?.message || e);
    return { ok: false, reason: "network" };
  }
}
