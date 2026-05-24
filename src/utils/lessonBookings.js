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

export function normalizeLessonStudioName(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
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
      secondaryStudioId: session.secondaryStudioId || null,
      kitId: session.kitId || null,
      lecturerId: session.lecturerId || session.alternateLecturerId || null,
      instructorName: String(session.instructorName || session.alternateInstructorName || "").trim(),
    }))
    .sort(compareDateTimeParts);
}

export function getEffectiveLessonStudioIds(session, lesson) {
  const ids = [];
  const primaryId = hasLinkedValue(session.studioId) ? session.studioId
    : hasLinkedValue(lesson.studioId) ? lesson.studioId : null;
  const secondaryId = hasLinkedValue(session.secondaryStudioId) ? session.secondaryStudioId : null;
  if (primaryId) ids.push(primaryId);
  if (secondaryId && !ids.some((id) => String(id) === String(secondaryId))) ids.push(secondaryId);
  return ids;
}

export function buildLessonStudioBookings(lessons = []) {
  const bookings = [];

  lessons.forEach((lesson) => {
    const schedule = getLessonScheduleEntries(lesson);
    if (!schedule.length) return;

    schedule.forEach((session, index) => {
      const sessionStudioIds = getEffectiveLessonStudioIds(session, lesson);
      // שיעור ללא כיתה עדיין מופיע בלו"ז — studioId יהיה null

      const lessonName = String(lesson.name || "").trim();
      const instructorName = String(session.instructorName || lesson.instructorName || "").trim();
      const track = String(lesson.track || "").trim();
      const pushBooking = (studioId, studioIndex = 0) => bookings.push({
        id: `lesson_booking_${lesson.id}_${index}${studioIndex ? `_secondary_${studioIndex}` : ""}`,
        lesson_id: lesson.id,
        lesson_auto: true,
        bookingKind: "lesson",
        studioId,
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
      if (sessionStudioIds.length) {
        sessionStudioIds.forEach((studioId, studioIndex) => pushBooking(studioId, studioIndex));
      } else {
        pushBooking(null, 0);
      }
    });
  });

  return bookings.sort(compareDateTimeParts);
}
