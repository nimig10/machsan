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

function normalizeStudioIdList(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const value of input) {
    if (!hasLinkedValue(value)) continue;
    const key = String(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function getSessionStudioIdsLegacy(session) {
  if (Array.isArray(session?.studioIds) && session.studioIds.length) {
    return normalizeStudioIdList(session.studioIds);
  }
  const legacy = [];
  if (hasLinkedValue(session?.studioId)) legacy.push(session.studioId);
  if (hasLinkedValue(session?.secondaryStudioId)) legacy.push(session.secondaryStudioId);
  return normalizeStudioIdList(legacy);
}

function getLessonCourseStudioIds(lesson) {
  const ids = [];
  if (Array.isArray(lesson?.studios)) {
    for (const entry of lesson.studios) {
      const value = entry && typeof entry === "object" ? entry.studioId : entry;
      if (hasLinkedValue(value)) ids.push(value);
    }
  }
  if (hasLinkedValue(lesson?.studioId)) ids.push(lesson.studioId);
  return normalizeStudioIdList(ids);
}

function normalizeSessionLecturerIdList(session) {
  // Position-independent list (no empty gaps) — used by display/filter callers
  // that only care about which lecturer ids appear in the session.
  if (Array.isArray(session?.lecturerIds)) {
    const out = [];
    const seen = new Set();
    for (const value of session.lecturerIds) {
      if (!hasLinkedValue(value)) continue;
      const key = String(value);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  }
  const legacy = session?.lecturerId || session?.alternateLecturerId;
  return hasLinkedValue(legacy) ? [String(legacy)] : [];
}

export function getEffectiveLessonLecturerIds(session, lesson) {
  // Prefer session-level lecturerIds[]; fall back to course-level (single)
  // lecturer when no session assignment is present.
  const sessionIds = normalizeSessionLecturerIdList(session);
  if (sessionIds.length) return sessionIds;
  const courseLevel = lesson?.lecturerId;
  return hasLinkedValue(courseLevel) ? [String(courseLevel)] : [];
}

function getLessonScheduleEntries(lesson) {
  return (Array.isArray(lesson?.schedule) ? lesson.schedule : [])
    .filter((session) => session?.date)
    .map((session) => ({
      date: session.date,
      startTime: session.startTime || "09:00",
      endTime: session.endTime || "12:00",
      topic: String(session.topic || "").trim(),
      studioIds: getSessionStudioIdsLegacy(session),
      kitId: session.kitId || null,
      lecturerId: session.lecturerId || session.alternateLecturerId || null,
      lecturerIds: normalizeSessionLecturerIdList(session),
      instructorName: String(session.instructorName || session.alternateInstructorName || "").trim(),
    }))
    .sort(compareDateTimeParts);
}

export function getEffectiveLessonStudioIds(session, lesson) {
  const sessionIds = getSessionStudioIdsLegacy(session);
  if (sessionIds.length) return sessionIds;
  return getLessonCourseStudioIds(lesson);
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
      // Multi-lecturer support: join all session lecturers with " + " for
      // display in public boards / daily tables / secretary dashboard.
      // Resolves names from lesson.lecturers[] (course chips) when present;
      // falls back to session.instructorName for the first slot.
      const lessonLecturerById = new Map();
      if (Array.isArray(lesson?.lecturers)) {
        for (const item of lesson.lecturers) {
          if (item?.lecturerId) lessonLecturerById.set(String(item.lecturerId), String(item.instructorName || "").trim());
        }
      }
      const sessionLecturerIds = Array.isArray(session?.lecturerIds) ? session.lecturerIds.filter(Boolean) : [];
      const joinedNames = sessionLecturerIds.length
        ? sessionLecturerIds.map(id => lessonLecturerById.get(String(id)) || "").filter(Boolean).join(" + ")
        : "";
      const instructorName = joinedNames || String(session.instructorName || lesson.instructorName || "").trim();
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
