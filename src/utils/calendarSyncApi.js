// calendarSyncApi.js — client trigger for the course → Google Calendar sync.
//
// Fire-and-forget: pings /api/calendar-sync with a lessonId after a course is
// saved or deleted. The endpoint reconciles the lesson's sessions against the
// live DB state and emails ICS invites/updates/cancellations to the lecturers.
//
// It NEVER throws and NEVER blocks the caller — a sync failure must not affect
// the course save itself. Missed pings are recoverable via a manual
// `?reconcile=all` run.

import { supabase } from "../supabaseClient.js";

export async function syncLessonCalendar(lessonId) {
  try {
    if (!lessonId) return;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return; // staff-only endpoint; silently skip if unauthenticated
    await fetch("/api/calendar-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ lessonId }),
    });
  } catch (e) {
    console.warn("[calendarSyncApi.syncLessonCalendar]", e?.message || e);
  }
}
