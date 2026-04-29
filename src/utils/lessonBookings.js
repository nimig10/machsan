// lessonBookings.js — extracted from App.jsx (Stage 10 Session B).
//
// `buildLessonStudioBookings(lessons)` regenerates the in-memory studio_bookings
// rows for lesson sessions on every load. These rows are NEVER persisted to
// public.studio_bookings — they're purely a derived view of lessons.schedule.
//
// Public pages (PublicForm/PublicDisplay/PublicDailyTable) need this helper too
// after Session B flips reads, so it lives in utils/ and is exported.

function hasLinkedValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function compareDateTimeParts(a = {}, b = {}) {
  const dateCompare = String(a.date || "").localeCompare(String(b.date || ""));
  if (dateCompare !== 0) return dateCompare;
  return String(a.startTime || "").localeCompare(String(b.startTime || ""));
}

function getLessonScheduleEntries(lesson) {
  return (Array.isArray(lesson?.schedule) ? lesson.schedule : [])
    .filter((session) => session?.date)
    .map((session) => ({
      date: session.date,
      startTime: session.startTime || "09:00",
      endTime: session.endTime || "12:00",
      topic: String(session.topic || "").trim(),
      studioId: session.studioId || null,
      kitId: session.kitId || null,
    }))
    .sort(compareDateTimeParts);
}

export function buildLessonStudioBookings(lessons = []) {
  const bookings = [];

  lessons.forEach((lesson) => {
    const schedule = getLessonScheduleEntries(lesson);
    if (!schedule.length) return;

    schedule.forEach((session, index) => {
      // שיוך כיתה ברמת המפגש עוקף שיוך ברמת הקורס
      const effectiveStudioId = hasLinkedValue(session.studioId) ? session.studioId
        : hasLinkedValue(lesson.studioId) ? lesson.studioId : null;
      // שיעור ללא כיתה עדיין מופיע בלו"ז — studioId יהיה null

      const lessonName = String(lesson.name || "").trim();
      const instructorName = String(lesson.instructorName || "").trim();
      const track = String(lesson.track || "").trim();
      bookings.push({
        id: `lesson_booking_${lesson.id}_${index}`,
        lesson_id: lesson.id,
        lesson_auto: true,
        bookingKind: "lesson",
        studioId: effectiveStudioId,
        date: session.date,
        startTime: session.startTime,
        endTime: session.endTime,
        courseName: lessonName,
        instructorName,
        track,
        subject: String(session.topic || "").trim(),
        studentName: lessonName && instructorName ? `${lessonName} · ${instructorName}` : (lessonName || instructorName),
        notes: String(lesson.description || "").trim(),
        isNight: false,
        createdAt: lesson.created_at || new Date().toISOString(),
      });
    });
  });

  return bookings.sort(compareDateTimeParts);
}
