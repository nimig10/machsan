// studioOverlap.js — shared, night-aware overlap test for studio bookings.
//
// Single source of truth so every booking surface (PublicForm student bookings,
// StudioBookingPage team bookings, LessonsPage lesson-vs-booking checks) computes
// overlap the SAME way. Critically, night bookings (21:30 → 08:00 the next day)
// are normalized here, so callers must NOT gate overlap behind `!isNight`.
//
// The server-side EXCLUDE constraint (migration 20260621120000) is the atomic,
// race-proof guard; these helpers give instant client-side feedback and defense
// in depth, mirroring the same wall-clock + night-wrap math.

export const NIGHT_START_TIME = "21:30";
export const NIGHT_END_TIME = "08:00";

// Build a wall-clock [start, end) interval for a booking. Night bookings are
// normalized to NIGHT_START_TIME → NIGHT_END_TIME, and any range whose end is at
// or before its start (e.g. a night block) rolls the end over to the next day.
// Returns null when date/times are missing or unparseable (caller treats null as
// "no interval" → never overlaps).
export function buildStudioBookingInterval({ date, startTime, endTime, isNight = false } = {}) {
  if (!date) return null;
  const normalizedStartTime = isNight ? NIGHT_START_TIME : String(startTime || "").trim();
  const normalizedEndTime = isNight ? NIGHT_END_TIME : String(endTime || "").trim();
  if (!normalizedStartTime || !normalizedEndTime) return null;
  const start = new Date(`${date}T${normalizedStartTime}:00`);
  const end = new Date(`${date}T${normalizedEndTime}:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (end <= start) end.setDate(end.getDate() + 1);
  return { start, end };
}

// True when two bookings' time ranges overlap (half-open, so adjacent
// windows like 10:00–12:00 and 12:00–14:00 do NOT overlap). Each argument is a
// booking-shaped object: { date, startTime, endTime, isNight }.
export function rangesOverlap(left, right) {
  const leftInterval = buildStudioBookingInterval(left);
  const rightInterval = buildStudioBookingInterval(right);
  if (!leftInterval || !rightInterval) return false;
  return leftInterval.start < rightInterval.end && rightInterval.start < leftInterval.end;
}
