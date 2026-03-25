import { useCallback, useEffect, useMemo, useState } from "react";
import { storageSet, lsGet } from "../utils.js";
import { Modal } from "./ui.jsx";

const DAY_HOURS = ["09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00","21:00","21:30"];
const DAY_BOOKING_HOURS = DAY_HOURS.slice(0, -1);
const NIGHT_START_TIME = "21:30";
const NIGHT_END_TIME = "08:00";
const NIGHT_BOOKING_LABEL = `מ־${NIGHT_START_TIME} והלאה`;
const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
const HE_DAYS_SHORT = ["א׳","ב׳","ג׳","ד׳","ה׳","ו׳","ש׳"];
const NIGHT_COLOR = "#2196f3";
const STUDENT_COLOR = "var(--green)";
const TEAM_COLOR = "#9b59b6";
const LESSON_COLOR = "#f5a623";
const RANGE_OPTIONS = [7, 30, 90];
const DEFAULT_STUDIO_FUTURE_HOURS = 16;
const STUDIO_MAINTENANCE_MESSAGE = "האולפן בתחזוקה, מקווים שישוב לעבוד בקרוב";

function getTodayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const [year, month, day] = String(dateStr).split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 0, 0, 0, 0);
}

function getWeekDays(offset = 0) {
  const current = new Date();
  current.setDate(current.getDate() + offset * 7);
  const sunday = new Date(current);
  sunday.setDate(current.getDate() - current.getDay());
  const todayStr = getTodayStr();
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sunday);
    date.setDate(sunday.getDate() + index);
    const fullDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return {
      name: ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"][index],
      date: String(date.getDate()).padStart(2, "0"),
      fullDate,
      isToday: fullDate === todayStr,
    };
  });
}

function sameStudioId(a, b) {
  return String(a) === String(b);
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function isStudioDisabled(studio) {
  return Boolean(studio?.isDisabled);
}

function isRejectedBooking(booking) {
  return booking?.status === "נדחה";
}

function getRangeDiff(dateStr) {
  const target = parseDate(dateStr);
  const today = parseDate(getTodayStr());
  if (!target || !today) return Number.POSITIVE_INFINITY;
  return Math.floor((target.getTime() - today.getTime()) / 86400000);
}

function getBookingSortTime(booking) {
  return new Date(`${booking.date}T${booking.startTime || "00:00"}:00`).getTime();
}

function getStudioFutureHoursLimit(settings = {}) {
  const parsed = Number(settings?.studioFutureHoursLimit);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_STUDIO_FUTURE_HOURS;
}

function formatStudioHoursValue(value = 0) {
  const normalized = Math.max(0, Math.round((Number(value) || 0) * 10) / 10);
  return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(1);
}

function buildStudioBookingInterval({ date, startTime, endTime, isNight = false }) {
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

function rangesOverlap(left, right) {
  const leftInterval = buildStudioBookingInterval(left);
  const rightInterval = buildStudioBookingInterval(right);
  if (!leftInterval || !rightInterval) return false;
  return leftInterval.start < rightInterval.end && rightInterval.start < leftInterval.end;
}

function addDaysToDateString(dateStr, daysToAdd = 0) {
  const base = parseDate(dateStr);
  if (!base) return dateStr;
  base.setDate(base.getDate() + daysToAdd);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
}

const thStyle = { padding:"8px 10px", background:"var(--surface2)", fontSize:12, fontWeight:700, textAlign:"center", border:"1px solid var(--border)" };
const tdStyle = { padding:"6px 8px", border:"1px solid var(--border)", textAlign:"center" };
const labelStyle = { display:"flex", flexDirection:"column", gap:4, fontSize:13, fontWeight:600, color:"var(--text2)" };

export default function StudioBookingPage(props) {
  const { showToast, teamMembers = [], certifications = { types: [], students: [] }, role = "admin", studios: studiosProp, setStudios: setStudiosProp, bookings: bookingsProp, setBookings: setBookingsProp, siteSettings: siteSettingsProp = {}, setSiteSettings: setSiteSettingsProp } = props;
  const [localStudios, setLocalStudios] = useState(() => lsGet("studios") || []);
  const [localBookings, setLocalBookings] = useState(() => lsGet("studio_bookings") || []);
  const [localSiteSettings, setLocalSiteSettings] = useState(() => lsGet("siteSettings") || {});
  const studios = studiosProp ?? localStudios;
  const setStudios = setStudiosProp ?? setLocalStudios;
  const bookings = bookingsProp ?? localBookings;
  const setBookings = setBookingsProp ?? setLocalBookings;
  const siteSettings = Object.keys(siteSettingsProp || {}).length ? siteSettingsProp : localSiteSettings;
  const setSiteSettings = setSiteSettingsProp ?? setLocalSiteSettings;

  const [weekOffset, setWeekOffset] = useState(0);
  const [todayOnly, setTodayOnly] = useState(false);
  const [sortMode, setSortMode] = useState("urgency");
  const [futureRangeDays, setFutureRangeDays] = useState(7);
  const [activeView, setActiveView] = useState("calendar");
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [miniMonth, setMiniMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [studioImage, setStudioImage] = useState("");
  const [editImage, setEditImage] = useState("");
  const [imgUploading, setImgUploading] = useState(false);
  const [formTeamMember, setFormTeamMember] = useState("");
  const [cancelMessage, setCancelMessage] = useState("");

  const todayStr = getTodayStr();
  const weekDays = getWeekDays(weekOffset);
  const studioFutureHoursLimit = getStudioFutureHoursLimit(siteSettings);

  const saveStudios = useCallback(async (nextStudios) => {
    setStudios(nextStudios);
    await storageSet("studios", nextStudios);
  }, [setStudios]);

  const saveBookings = useCallback(async (nextBookings) => {
    setBookings(nextBookings);
    await storageSet("studio_bookings", nextBookings);
  }, [setBookings]);

  const saveSiteSettings = useCallback(async (nextSettings) => {
    setSiteSettings(nextSettings);
    await storageSet("siteSettings", nextSettings);
  }, [setSiteSettings]);

  const teamMemberOptions = useMemo(() => {
    const names = new Set();
    return (teamMembers || []).reduce((list, member) => {
      const normalized = typeof member === "string" ? { id: member, name: member } : { id: member?.id ?? member?.name, name: member?.name || "" };
      if (!normalized.name || names.has(normalized.name)) return list;
      names.add(normalized.name);
      return [...list, normalized];
    }, []);
  }, [teamMembers]);

  const studioCertTypes = useMemo(() => (certifications?.types || []).filter((type) => type.category === "studio" && type.id !== "cert_night_studio"), [certifications]);

  const getStudioCertIds = useCallback((studio) => {
    if (Array.isArray(studio?.studioCertIds)) return studio.studioCertIds.filter(Boolean);
    return studio?.studioCertId ? [studio.studioCertId] : [];
  }, []);

  const getStudioCertNames = useCallback((studio) => (
    getStudioCertIds(studio)
      .map((certId) => studioCertTypes.find((type) => type.id === certId)?.name)
      .filter(Boolean)
  ), [getStudioCertIds, studioCertTypes]);

  const activeBookings = useMemo(() => (Array.isArray(bookings) ? bookings : []).filter((booking) => !isRejectedBooking(booking)), [bookings]);

  const getBookingKind = useCallback((booking) => {
    if (!booking) return "student";
    if (booking.bookingKind === "lesson" || booking.lesson_auto || hasValue(booking.lesson_id)) return "lesson";
    if (booking.bookingKind === "team" || hasValue(booking.teamMemberId) || hasValue(booking.teamMemberName) || booking.ownerType === "team") return "team";
    return "student";
  }, []);

  const getBookingColor = useCallback((booking) => {
    const kind = getBookingKind(booking);
    if (kind === "lesson") return LESSON_COLOR;
    if (kind === "team") return TEAM_COLOR;
    if (booking?.isNight) return NIGHT_COLOR;
    return STUDENT_COLOR;
  }, [getBookingKind]);

  const getBookingTypeLabel = useCallback((booking) => {
    const kind = getBookingKind(booking);
    if (kind === "lesson") return "שיעור";
    if (kind === "team") return "קביעת צוות";
    return booking?.isNight ? "קביעת סטודנט לילה" : "קביעת סטודנט";
  }, [getBookingKind]);

  const getBookingTitle = useCallback((booking) => {
    const kind = getBookingKind(booking);
    if (kind === "lesson") return booking?.courseName || booking?.studentName || "שיעור";
    if (kind === "team") return booking?.teamMemberName || booking?.studentName || "איש צוות";
    return booking?.studentName || "סטודנט";
  }, [getBookingKind]);

  const getBookingSubtitle = useCallback((booking) => {
    const kind = getBookingKind(booking);
    if (kind === "lesson") return [booking?.subject, booking?.instructorName, booking?.track].filter(Boolean).join(" · ");
    if (kind === "team") return "צוות המחסן";
    return "";
  }, [getBookingKind]);
  const getBookingTimeLabel = useCallback((booking) => (
    booking?.isNight ? NIGHT_BOOKING_LABEL : `${booking?.startTime || ""}–${booking?.endTime || ""}`
  ), []);

  const weekMiddle = new Date();
  weekMiddle.setDate(weekMiddle.getDate() + weekOffset * 7);
  const weekMonthLabel = `${HE_MONTHS[weekMiddle.getMonth()]} ${weekMiddle.getFullYear()}`;

  const miniDays = (() => {
    const firstDay = new Date(miniMonth.year, miniMonth.month, 1).getDay();
    const daysInMonth = new Date(miniMonth.year, miniMonth.month + 1, 0).getDate();
    const cells = [];
    for (let index = 0; index < firstDay; index += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
    return cells;
  })();

  const filteredBookings = useMemo(() => (
    activeBookings
      .filter((booking) => {
        if (todayOnly) return booking.date === todayStr;
        const diff = getRangeDiff(booking.date);
        return diff >= 0 && diff < futureRangeDays;
      })
      .sort((left, right) => {
        if (sortMode === "request_time") {
          return new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime();
        }
        return getBookingSortTime(left) - getBookingSortTime(right);
      })
  ), [activeBookings, futureRangeDays, sortMode, todayOnly, todayStr]);

  const lessonBookings = filteredBookings.filter((booking) => getBookingKind(booking) === "lesson");
  const studentBookings = filteredBookings.filter((booking) => getBookingKind(booking) === "student" && !booking.isNight);
  const nightBookings = filteredBookings.filter((booking) => getBookingKind(booking) === "student" && booking.isNight);
  const teamBookings = filteredBookings.filter((booking) => getBookingKind(booking) === "team");

  const findBookingConflict = useCallback((candidate, pendingBookings = [], excludeBookingId = null) => (
    [...activeBookings, ...pendingBookings].find((booking) => (
      (!excludeBookingId || String(booking.id) !== String(excludeBookingId))
      && sameStudioId(booking.studioId, candidate.studioId)
      && rangesOverlap(booking, candidate)
    ))
  ), [activeBookings]);

  const getConflictMessage = useCallback((booking, date) => {
    if (!booking) return "";
    if (getBookingKind(booking) === "student") {
      return `לא ניתן לקיים את ההזמנה בגלל שהיא תנגשת עם ההזמנה של סטודנט ${booking.studentName || ""}${date ? ` בתאריך ${date}` : ""}`.trim();
    }
    return date
      ? `לא ניתן לקיים את ההזמנה בתאריך ${date} בגלל שהיא מתנגשת עם הזמנה קיימת`
      : "לא ניתן לקיים את ההזמנה בגלל שהיא מתנגשת עם הזמנה קיימת";
  }, [getBookingKind]);

  const bookingRequiredCert = useMemo(() => {
    if (!modal?.studioId) return [];
    const studio = studios.find((item) => sameStudioId(item.id, modal.studioId));
    return studioCertTypes.filter((type) => getStudioCertIds(studio).includes(type.id));
  }, [getStudioCertIds, modal?.studioId, studioCertTypes, studios]);

  useEffect(() => {
    if (!Array.isArray(studios) || studios.length === 0) return;
    const needsMigration = studios.some((studio) => studio?.image?.startsWith("data:"));
    if (!needsMigration) return;

    let cancelled = false;
    const migrate = async () => {
      const migrated = await Promise.all(studios.map(async (studio) => {
        if (!studio?.image?.startsWith("data:")) return studio;
        try {
          const response = await fetch("/api/upload-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: studio.image }),
          });
          const json = await response.json();
          if (response.ok && json.url) return { ...studio, image: json.url };
        } catch (error) {
          console.error("Studio image migration failed", studio?.name, error);
        }
        return studio;
      }));
      if (cancelled) return;
      await saveStudios(migrated);
      showToast("success", "תמונות האולפנים עודכנו");
    };

    void migrate();
    return () => {
      cancelled = true;
    };
  }, [saveStudios, showToast, studios]);

  const jumpToDate = (day) => {
    const target = new Date(miniMonth.year, miniMonth.month, day);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const diff = Math.round((target.getTime() - now.getTime()) / 86400000);
    const targetWeekStart = diff - target.getDay() + now.getDay();
    setWeekOffset(Math.round(targetWeekStart / 7));
  };

  const isInCurrentWeek = (day) => {
    if (!day) return false;
    const fullDate = `${miniMonth.year}-${String(miniMonth.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return weekDays.some((weekDay) => weekDay.fullDate === fullDate);
  };

  const isTodayMini = (day) => {
    if (!day) return false;
    const fullDate = `${miniMonth.year}-${String(miniMonth.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return fullDate === todayStr;
  };

  const StudioImg = ({ studio, size = 32 }) => {
    if (!studio) return null;
    if (studio.image?.startsWith("http") || studio.image?.startsWith("data:")) {
      return <img src={studio.image} alt={studio.name} style={{ width:size, height:size, borderRadius:6, objectFit:"cover" }} />;
    }
    return <span style={{ fontSize:size * 0.65 }}>{studio.image || "🎙️"}</span>;
  };

  const openAddBookingModal = (studioId, studioName, date, dayName) => {
    const studio = studios.find((item) => sameStudioId(item.id, studioId));
    if (isStudioDisabled(studio)) {
      showToast("error", STUDIO_MAINTENANCE_MESSAGE);
      return;
    }
    setFormTeamMember("");
    setModal({ type:"addBooking", studioId, studioName, date, dayName, isNightTeam:false });
  };

  const openViewBookingModal = (booking, studioName) => {
    setCancelMessage("");
    setModal({ type:"viewBooking", booking, studioName });
  };

  const closeModal = () => {
    setCancelMessage("");
    setFormTeamMember("");
    setEditImage("");
    setModal(null);
  };

  const cellBookings = useCallback((studioId, fullDate) => (
    activeBookings
      .filter((booking) => sameStudioId(booking.studioId, studioId) && booking.date === fullDate)
      .sort((left, right) => (left.startTime || "").localeCompare(right.startTime || ""))
  ), [activeBookings]);

  const uploadToCloudinary = async (file) => {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const response = await fetch("/api/upload-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: dataUrl }),
    });
    const json = await response.json();
    if (!response.ok || !json.url) throw new Error(json.error || "שגיאת שרת");
    return json.url;
  };

  const handleImageUpload = async (event, setter) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImgUploading(true);
    try {
      const imageUrl = await uploadToCloudinary(file);
      setter(imageUrl);
      showToast("success", "התמונה הועלתה");
    } catch (error) {
      console.error("Studio image upload failed", error);
      showToast("error", "שגיאה בהעלאת התמונה");
    } finally {
      setImgUploading(false);
    }
  };

  const handleAddStudio = async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const name = String(formData.get("name") || "").trim();
    if (!name) return;
    if (studios.some((studio) => studio.name === name)) {
      showToast("error", "אולפן בשם הזה כבר קיים");
      return;
    }
    const studioCertId = formData.get("studioCertId") || undefined;
    const studioTrackType = formData.get("studioTrackType") || "";
    const nextStudios = [...studios, { id:Date.now(), name, studioCertId, studioCertIds:studioCertId ? [studioCertId] : [], image:studioImage || formData.get("emoji") || "🎙️", isDisabled:false, studioTrackType }];
    await saveStudios(nextStudios);
    setStudioImage("");
    closeModal();
    showToast("success", `האולפן "${name}" נוסף`);
  };

  const handleEditStudio = async (event) => {
    event.preventDefault();
    if (!modal?.studio) return;
    const formData = new FormData(event.target);
    const name = String(formData.get("name") || "").trim();
    if (!name) return;
    const studioCertId = formData.get("studioCertId") || undefined;
    const isDisabled = formData.get("isDisabled") === "on";
    const studioTrackType = formData.get("studioTrackType") || "";
    const image = editImage || String(formData.get("emoji") || "").trim() || modal.studio.image;
    const previousIds = getStudioCertIds(modal.studio);
    const nextStudioCertIds = !studioCertId ? [] : (previousIds.length > 1 && previousIds.includes(studioCertId) ? previousIds : [studioCertId]);
    const nextStudios = studios.map((studio) => studio.id === modal.studio.id ? { ...studio, name, studioCertId, studioCertIds:nextStudioCertIds, image, isDisabled, studioTrackType } : studio);
    await saveStudios(nextStudios);
    showToast("success", `האולפן "${name}" עודכן`);
    closeModal();
  };

  const updateStudioFutureHoursLimit = async (value) => {
    const parsed = Math.max(0, Number(value) || 0);
    const nextSettings = { ...siteSettings, studioFutureHoursLimit: parsed };
    await saveSiteSettings(nextSettings);
    showToast("success", "בנק השעות העתידיות עודכן");
  };

  const resetStudioFutureHoursLimit = async () => {
    const nextSettings = { ...siteSettings, studioFutureHoursLimit: DEFAULT_STUDIO_FUTURE_HOURS };
    await saveSiteSettings(nextSettings);
    showToast("success", "בנק השעות העתידיות אופס ל־16 שעות");
  };

  const deleteStudio = async (studioId) => {
    if (!window.confirm("למחוק את האולפן הזה ואת כל ההזמנות שלו?")) return;
    await saveStudios(studios.filter((studio) => studio.id !== studioId));
    await saveBookings(bookings.filter((booking) => !sameStudioId(booking.studioId, studioId)));
    showToast("success", "האולפן נמחק");
  };

  const sendStudioEmail = async (type, booking, customMessage = "") => {
    if (getBookingKind(booking) !== "student") return;
    const studio = studios.find((item) => sameStudioId(item.id, booking.studioId));
    const studentRecord = (certifications?.students || []).find((student) => student.name === booking.studentName);
    const email = studentRecord?.email;
    if (!email) return;
    try {
      await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: email,
          type,
          student_name: booking.studentName,
          project_name: studio?.name || "האולפן",
          borrow_date: booking.date,
          borrow_time: booking.startTime,
          return_time: booking.endTime,
          custom_message: customMessage,
        }),
      });
    } catch (error) {
      console.error("Studio email failed", error);
    }
  };

  const submitBooking = async (event) => {
    event.preventDefault();
    if (!modal?.studioId || !modal?.date) return;
    setSaving(true);

    const selectedMember = teamMemberOptions.find((member) => String(member.id) === String(formTeamMember));
    const memberName = selectedMember?.name || "";
    const formData = new FormData(event.target);
    const studio = studios.find((item) => sameStudioId(item.id, modal.studioId));
    const notes = String(formData.get("notes") || "").trim();
    const isNight = formData.get("isNight") === "on";
    const startTime = isNight ? NIGHT_START_TIME : String(formData.get("startTime") || "");
    const endTime = isNight ? NIGHT_END_TIME : String(formData.get("endTime") || "");
    const repeatCount = Math.max(0, Math.min(24, Number(formData.get("repeatCount") || 0) || 0));
    const recurringGroupId = repeatCount > 0 ? `team_repeat_${Date.now()}` : null;

    if (!memberName || !startTime || !endTime) {
      showToast("error", "נא לבחור איש צוות ולהשלים את פרטי הקביעה");
      setSaving(false);
      return;
    }
    if (isStudioDisabled(studio)) {
      showToast("error", STUDIO_MAINTENANCE_MESSAGE);
      setSaving(false);
      return;
    }
    if (!isNight && startTime >= endTime) {
      showToast("error", "שעת סיום חייבת להיות אחרי שעת התחלה");
      setSaving(false);
      return;
    }

    if (repeatCount > 0) {
      const pendingBookings = [];
      for (let occurrence = 0; occurrence <= repeatCount; occurrence += 1) {
        const occurrenceDate = addDaysToDateString(modal.date, occurrence * 7);
        const candidateBooking = { studioId: modal.studioId, date: occurrenceDate, startTime, endTime, isNight };
        const conflict = findBookingConflict(candidateBooking, pendingBookings);
        if (conflict) {
          showToast("error", getConflictMessage(conflict, occurrenceDate));
          setSaving(false);
          return;
        }
        pendingBookings.push({
          id: Date.now() + occurrence,
          bookingKind: "team",
          ownerType: "team",
          teamMemberId: selectedMember?.id ?? null,
          teamMemberName: memberName,
          studentName: memberName,
          studioId: modal.studioId,
          date: occurrenceDate,
          startTime,
          endTime,
          notes,
          isNight,
          recurringGroupId,
          createdAt: new Date().toISOString(),
        });
      }

      await saveBookings([...bookings, ...pendingBookings]);
      setSaving(false);
      closeModal();
      showToast("success", `קביעת הצוות נשמרה עם ${repeatCount + 1} מופעים`);
      return;
    }

    const overlap = activeBookings.some((booking) => (
      sameStudioId(booking.studioId, modal.studioId)
      && booking.date === modal.date
      && !(endTime <= booking.startTime || startTime >= booking.endTime)
    ));
    if (!isNight && overlap) {
      showToast("error", "קיימת כבר קביעה חופפת בשעות האלו");
      setSaving(false);
      return;
    }

    const nextBooking = {
      id: Date.now(),
      bookingKind: "team",
      ownerType: "team",
      teamMemberId: selectedMember?.id ?? null,
      teamMemberName: memberName,
      studentName: memberName,
      studioId: modal.studioId,
      date: modal.date,
      startTime,
      endTime,
      notes,
      isNight,
      createdAt: new Date().toISOString(),
    };

    await saveBookings([...bookings, nextBooking]);
    setSaving(false);
    closeModal();
    showToast("success", "קביעת הצוות נשמרה בלוח האולפנים");
  };

  const deleteBooking = async (bookingId) => {
    const booking = bookings.find((item) => item.id === bookingId);
    if (!booking) return;
    const kind = getBookingKind(booking);
    if (kind === "lesson") {
      showToast("info", "קביעת שיעור מנוהלת מתוך רובריקת שיעורים");
      return;
    }
    const confirmText = kind === "student" ? "למחוק את הקביעה ולשלוח לסטודנט הודעת ביטול?" : "למחוק את קביעת הצוות הזאת?";
    if (!window.confirm(confirmText)) return;

    await saveBookings(bookings.filter((item) => item.id !== bookingId));
    if (kind === "student") {
      await sendStudioEmail("studio_deleted", booking, cancelMessage.trim());
      showToast("success", "הקביעה נמחקה ונשלח מייל לסטודנט");
    } else {
      showToast("success", "קביעת הצוות נמחקה");
    }
    closeModal();
  };

  const canDeleteBooking = (booking) => role === "admin" && getBookingKind(booking) !== "lesson";

  const SectionHeader = ({ label, color, count, icon }) => {
    if (count === 0) return null;
    return (
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 14px", background:`${color}12`, borderRadius:10, border:`1px solid ${color}33`, borderRight:`4px solid ${color}`, marginTop:12 }}>
        <span style={{ fontSize:16 }}>{icon}</span>
        <span style={{ fontWeight:800, fontSize:14, color }}>{label}</span>
        <span style={{ background:color, color:"#fff", borderRadius:20, padding:"1px 9px", fontSize:12, fontWeight:800, marginRight:"auto" }}>{count}</span>
      </div>
    );
  };

  const BookingRow = (booking) => {
    const studio = studios.find((item) => sameStudioId(item.id, booking.studioId));
    const color = getBookingColor(booking);
    const kind = getBookingKind(booking);
    const subtitle = getBookingSubtitle(booking);
    return (
      <div
        key={booking.id}
        style={{ background:"var(--surface2)", borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, flexWrap:"wrap", cursor:"pointer", border:`1px solid ${color}33`, borderRight:`4px solid ${color}` }}
        onClick={() => openViewBookingModal(booking, studio?.name || "?")}
      >
        <div style={{ flex:1, minWidth:220 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, flexWrap:"wrap" }}>
            {studio && <StudioImg studio={studio} size={24} />}
            <span style={{ fontWeight:800, fontSize:14 }}>{studio?.name || "?"}</span>
            <span style={{ background:`${color}22`, color, borderRadius:20, padding:"2px 10px", fontSize:11, fontWeight:800 }}>{getBookingTypeLabel(booking)}</span>
            {booking.isNight && kind !== "lesson" && <span style={{ background:`${NIGHT_COLOR}22`, color:NIGHT_COLOR, borderRadius:20, padding:"2px 10px", fontSize:11, fontWeight:800 }}>לילה</span>}
          </div>
          <div style={{ fontSize:14, fontWeight:700, color:"var(--text)" }}>{getBookingTitle(booking)}</div>
          {subtitle && <div style={{ fontSize:12, color:"var(--text2)", marginTop:2 }}>{subtitle}</div>}
          <div style={{ fontSize:12, color:"var(--text3)", marginTop:2 }}>📅 {booking.date} · ⏰ {getBookingTimeLabel(booking)}</div>
          {booking.notes && <div style={{ fontSize:11, color:"var(--text3)", marginTop:2 }}>📝 {booking.notes}</div>}
        </div>
        {canDeleteBooking(booking) && (
          <button
            className="btn btn-secondary btn-sm"
            style={{ color:"var(--red)", borderColor:"var(--red)" }}
            onClick={(event) => {
              event.stopPropagation();
              openViewBookingModal(booking, studio?.name || "?");
            }}
          >
            {kind === "student" ? "מחק ושלח" : "מחק"}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="page" style={{ direction:"rtl" }}>
      <div className="flex-between mb-4" style={{ flexWrap:"wrap", gap:8 }}>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <button className={`btn ${activeView==="calendar" ? "btn-primary" : "btn-secondary"}`} onClick={() => setActiveView("calendar")}>📅 לוח שנה</button>
          <button className={`btn ${activeView==="list" ? "btn-primary" : "btn-secondary"}`} onClick={() => setActiveView("list")}>
            📋 כל ההזמנות {activeBookings.length > 0 && <span style={{ background:"var(--accent)", color:"#000", borderRadius:"50%", padding:"1px 6px", fontSize:11, marginRight:4 }}>{activeBookings.length}</span>}
          </button>
          {role === "admin" && <button className={`btn ${activeView==="manage" ? "btn-primary" : "btn-secondary"}`} onClick={() => setActiveView("manage")}>🏛️ ניהול אולפנים</button>}
        </div>
        {role === "admin" && activeView === "manage" && <button className="btn btn-primary" onClick={() => setModal({ type:"addStudio" })}>➕ אולפן חדש</button>}
      </div>

      {activeView === "calendar" && (
        <div>
          <div style={{ textAlign:"center", marginBottom:16 }}>
            <div style={{ fontSize:22, fontWeight:900, color:"var(--accent)" }}>{weekMonthLabel}</div>
          </div>

          <div style={{ display:"flex", gap:20, marginBottom:20, flexWrap:"wrap", alignItems:"flex-start" }}>
            <div style={{ minWidth:220, maxWidth:260, background:"var(--surface2)", borderRadius:"var(--r)", border:"1px solid var(--border)", padding:12 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                <button onClick={() => setMiniMonth((current) => current.month === 0 ? { year:current.year - 1, month:11 } : { year:current.year, month:current.month - 1 })} style={{ background:"none", border:"none", color:"var(--text2)", cursor:"pointer", fontSize:16, padding:"2px 6px" }}>→</button>
                <span style={{ fontWeight:800, fontSize:14, color:"var(--text)" }}>{HE_MONTHS[miniMonth.month]} {miniMonth.year}</span>
                <button onClick={() => setMiniMonth((current) => current.month === 11 ? { year:current.year + 1, month:0 } : { year:current.year, month:current.month + 1 })} style={{ background:"none", border:"none", color:"var(--text2)", cursor:"pointer", fontSize:16, padding:"2px 6px" }}>←</button>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:1, textAlign:"center" }}>
                {HE_DAYS_SHORT.map((day) => <div key={day} style={{ fontSize:10, fontWeight:700, color:"var(--text3)", padding:"4px 0" }}>{day}</div>)}
                {miniDays.map((day, index) => (
                  <div key={index} onClick={() => day && jumpToDate(day)} style={{ fontSize:12, fontWeight:isInCurrentWeek(day) ? 800 : 500, padding:"5px 0", cursor:day ? "pointer" : "default", borderRadius:"50%", background:isTodayMini(day) ? "var(--accent)" : isInCurrentWeek(day) ? "rgba(245,166,35,0.15)" : "transparent", color:isTodayMini(day) ? "#000" : isInCurrentWeek(day) ? "var(--accent)" : day ? "var(--text)" : "transparent" }}>{day || ""}</div>
                ))}
              </div>
              <button onClick={() => { setWeekOffset(0); const now = new Date(); setMiniMonth({ year:now.getFullYear(), month:now.getMonth() }); }} style={{ width:"100%", marginTop:8, padding:"6px 0", borderRadius:6, border:"1px solid var(--accent)", background:"transparent", color:"var(--accent)", fontWeight:700, fontSize:12, cursor:"pointer" }}>📅 היום</button>
            </div>

            <div style={{ flex:1, minWidth:280, display:"flex", flexDirection:"column", gap:10, justifyContent:"center" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, justifyContent:"center" }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset((current) => current - 1)}>→ שבוע קודם</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset(0)}>היום</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset((current) => current + 1)}>← שבוע הבא</button>
              </div>
              <div style={{ fontSize:13, color:"var(--text3)", textAlign:"center" }}>
                {weekDays[0].date}/{String(new Date(weekDays[0].fullDate).getMonth() + 1).padStart(2, "0")} – {weekDays[6].date}/{String(new Date(weekDays[6].fullDate).getMonth() + 1).padStart(2, "0")}
              </div>
            </div>
          </div>

          {studios.length === 0 ? (
            <div style={{ textAlign:"center", padding:48, color:"var(--text3)" }}>
              <div style={{ fontSize:48, marginBottom:12 }}>🎙️</div>
              <div style={{ fontWeight:700, fontSize:16, marginBottom:8 }}>אין אולפנים עדיין</div>
            </div>
          ) : (
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", minWidth:760 }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, width:120 }}>אולפן</th>
                    {weekDays.map((day) => (
                      <th key={day.fullDate} style={{ ...thStyle, background:day.isToday ? "rgba(245,166,35,0.15)" : undefined }}>
                        <div style={{ fontWeight:700 }}>{day.name}</div>
                        <div style={{ fontSize:11, color:day.isToday ? "var(--accent)" : "var(--text3)" }}>{day.date}/{String(new Date(day.fullDate).getMonth() + 1).padStart(2, "0")}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {studios.map((studio) => (
                    <tr key={studio.id}>
                      <td style={{ ...tdStyle, fontWeight:700, fontSize:13, background:"var(--surface2)" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          <StudioImg studio={studio} size={32} />
                          <span>{studio.name}</span>
                        </div>
                        <div style={{ fontSize:10, color:"var(--text3)", marginTop:2 }}>
                          {(() => {
                            const certNames = getStudioCertNames(studio);
                            return certNames.length ? <span style={{ color:"var(--accent)" }}>🎓 {certNames.join(", ")}</span> : "ללא הסמכת אולפן";
                          })()}
                        </div>
                        {isStudioDisabled(studio) && <div style={{ fontSize:10, color:"var(--red)", fontWeight:800, marginTop:4 }}>🔧 מושבת לתחזוקה</div>}
                      </td>
                      {isStudioDisabled(studio) ? (
                        <td colSpan={weekDays.length} style={{ ...tdStyle, background:"rgba(231,76,60,0.08)", color:"var(--red)", fontWeight:800, textAlign:"center", padding:"14px 18px" }}>
                          {STUDIO_MAINTENANCE_MESSAGE}
                        </td>
                      ) : weekDays.map((day) => {
                        const dayBookings = cellBookings(studio.id, day.fullDate);
                        return (
                          <td key={day.fullDate} style={{ ...tdStyle, verticalAlign:"top", cursor:"pointer", minHeight:70, background:day.isToday ? "rgba(245,166,35,0.05)" : undefined }} onClick={() => openAddBookingModal(studio.id, studio.name, day.fullDate, day.name)}>
                            {dayBookings.map((booking) => {
                              const color = getBookingColor(booking);
                              const subtitle = getBookingSubtitle(booking);
                              return (
                                <div key={booking.id} style={{ background:`${color}20`, border:`1px solid ${color}`, borderRadius:6, padding:"4px 6px", marginBottom:4, fontSize:11, cursor:"pointer" }} onClick={(event) => { event.stopPropagation(); openViewBookingModal(booking, studio.name); }}>
                                  <div style={{ fontWeight:800, color }}>{getBookingTimeLabel(booking)}</div>
                                  <div style={{ color:"var(--text)", fontWeight:700 }}>{getBookingTitle(booking)}</div>
                                  {subtitle && <div style={{ color:"var(--text3)", fontSize:10 }}>{subtitle}</div>}
                                </div>
                              );
                            })}
                            {dayBookings.length === 0 && <div style={{ color:"var(--text3)", fontSize:11, textAlign:"center", paddingTop:12 }}>+ הוסף</div>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeView === "list" && (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", padding:"10px 14px", background:"var(--surface2)", borderRadius:10, marginBottom:4 }}>
            <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, cursor:"pointer", fontWeight:600 }}>
              <input type="checkbox" checked={todayOnly} onChange={(event) => setTodayOnly(event.target.checked)} style={{ accentColor:"var(--accent)", width:15, height:15 }} />
              היום בלבד
            </label>
            <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
              <span style={{ fontSize:12, color:"var(--text3)" }}>טווח קדימה:</span>
              {RANGE_OPTIONS.map((days) => {
                const active = futureRangeDays === days;
                return <button key={days} type="button" onClick={() => setFutureRangeDays(days)} style={{ padding:"3px 10px", borderRadius:6, border:`1px solid ${active ? "var(--accent)" : "var(--border)"}`, background:active ? "var(--accent)22" : "transparent", color:active ? "var(--accent)" : "var(--text3)", fontSize:12, fontWeight:700, cursor:"pointer" }}>{days} יום</button>;
              })}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginRight:"auto", flexWrap:"wrap" }}>
              <span style={{ fontSize:12, color:"var(--text3)" }}>מיון:</span>
              <button onClick={() => setSortMode("urgency")} style={{ padding:"3px 10px", borderRadius:6, border:`1px solid ${sortMode==="urgency" ? "var(--accent)" : "var(--border)"}`, background:sortMode==="urgency" ? "var(--accent)22" : "transparent", color:sortMode==="urgency" ? "var(--accent)" : "var(--text3)", fontSize:12, fontWeight:700, cursor:"pointer" }}>דחיפות</button>
              <button onClick={() => setSortMode("request_time")} style={{ padding:"3px 10px", borderRadius:6, border:`1px solid ${sortMode==="request_time" ? "var(--accent)" : "var(--border)"}`, background:sortMode==="request_time" ? "var(--accent)22" : "transparent", color:sortMode==="request_time" ? "var(--accent)" : "var(--text3)", fontSize:12, fontWeight:700, cursor:"pointer" }}>זמן יצירה</button>
            </div>
          </div>

          {filteredBookings.length === 0 ? (
            <div style={{ textAlign:"center", padding:48, color:"var(--text3)" }}>אין הזמנות להצגה בטווח שנבחר</div>
          ) : (
            <>
              <SectionHeader label="קביעות שיעורים" color={LESSON_COLOR} count={lessonBookings.length} icon="📚" />
              {lessonBookings.map(BookingRow)}
              <SectionHeader label="קביעות סטודנטים" color={STUDENT_COLOR} count={studentBookings.length} icon="🎓" />
              {studentBookings.map(BookingRow)}
              <SectionHeader label="קביעות לילה" color={NIGHT_COLOR} count={nightBookings.length} icon="🌙" />
              {nightBookings.map(BookingRow)}
              <SectionHeader label="קביעות צוות" color={TEAM_COLOR} count={teamBookings.length} icon="🧑‍💼" />
              {teamBookings.map(BookingRow)}
            </>
          )}
        </div>
      )}

      {activeView === "manage" && role === "admin" && (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <div style={{ background:"var(--surface2)", borderRadius:10, padding:"14px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap" }}>
            <div>
              <div style={{ fontWeight:800 }}>בנק שעות עתידיות</div>
              <div style={{ fontSize:12, color:"var(--text3)", marginTop:4 }}>מספר השעות העתידיות שכל סטודנט יכול להחזיק במקביל בלוח קביעת האולפנים.</div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              <input type="number" min="0" step="0.5" className="form-input" value={studioFutureHoursLimit} onChange={(event) => void updateStudioFutureHoursLimit(event.target.value)} style={{ width:120 }} />
              <span style={{ fontSize:12, color:"var(--text3)", fontWeight:700 }}>שעות</span>
              <button className="btn btn-secondary btn-sm" onClick={() => void resetStudioFutureHoursLimit()}>איפוס</button>
            </div>
          </div>
          {studios.length === 0 ? <div style={{ textAlign:"center", padding:48, color:"var(--text3)" }}>אין אולפנים עדיין</div> : studios.map((studio) => (
            <div key={studio.id} style={{ background:"var(--surface2)", borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <StudioImg studio={studio} size={44} />
                <div>
                  <div style={{ fontWeight:700 }}>{studio.name}</div>
                  <div style={{ fontSize:12, color:"var(--text3)" }}>
                    {(() => {
                      const certNames = getStudioCertNames(studio);
                      return certNames.length ? <span style={{ color:"var(--accent)" }}>🎓 {certNames.join(", ")}</span> : "ללא הסמכה";
                    })()}
                    {" · "}
                    {activeBookings.filter((booking) => sameStudioId(booking.studioId, studio.id)).length} קביעות
                    {isStudioDisabled(studio) && <span style={{ color:"var(--red)", fontWeight:800 }}> · מושבת לתחזוקה</span>}
                  </div>
                </div>
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => { setEditImage(""); setModal({ type:"editStudio", studio }); }}>✏️ עריכה</button>
                <button className="btn btn-secondary btn-sm" style={{ color:"var(--red)", borderColor:"var(--red)" }} onClick={() => deleteStudio(studio.id)}>🗑️ מחק</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal?.type === "addStudio" && (
        <Modal title="➕ הוסף אולפן" onClose={closeModal} footer={<><button className="btn btn-secondary" onClick={closeModal}>ביטול</button><button form="addStudioForm" type="submit" className="btn btn-primary" disabled={imgUploading}>{imgUploading ? "מעלה תמונה..." : "שמור"}</button></>}>
          <form id="addStudioForm" onSubmit={handleAddStudio} style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <label style={labelStyle}>שם האולפן *<input name="name" className="form-input" placeholder='למשל: אולפן A' required /></label>
            <label style={labelStyle}>הסמכת אולפן<select name="studioCertId" className="form-input" defaultValue=""><option value="">ללא הסמכה</option>{studioCertTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
            <div style={{ fontSize:11, color:"var(--text3)", marginTop:-6 }}>שיוכים מרובים ממשיכים להתנהל מתוך רובריקת ההסמכות.</div>
            <label style={labelStyle}>סיווג מסלול לימודים
              <select name="studioTrackType" className="form-input" defaultValue="">
                <option value="sound">🎧 הנדסאי סאונד</option>
                <option value="cinema">🎬 הנדסאי קולנוע</option>
              </select>
            </label>
            <label style={labelStyle}>תמונה<input type="file" accept="image/*" onChange={(event) => void handleImageUpload(event, setStudioImage)} style={{ fontSize:13 }} disabled={imgUploading} />{imgUploading && <div style={{ fontSize:12, color:"var(--accent)", marginTop:4 }}>מעלה תמונה...</div>}{studioImage && <img src={studioImage} alt="תצוגה מקדימה" style={{ width:80, height:80, objectFit:"cover", borderRadius:8, marginTop:4 }} />}</label>
            <label style={labelStyle}>או אימוג'י<input name="emoji" className="form-input" placeholder="🎙️" maxLength={4} /></label>
          </form>
        </Modal>
      )}

      {modal?.type === "editStudio" && (
        <Modal title="✏️ עריכת אולפן" onClose={closeModal} footer={<><button className="btn btn-secondary" onClick={closeModal}>ביטול</button><button form="editStudioForm" type="submit" className="btn btn-primary" disabled={imgUploading}>{imgUploading ? "מעלה תמונה..." : "שמור"}</button></>}>
          <form id="editStudioForm" onSubmit={handleEditStudio} style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <label style={labelStyle}>שם האולפן *<input name="name" className="form-input" defaultValue={modal.studio.name} required /></label>
            <label style={labelStyle}>הסמכת אולפן<select name="studioCertId" className="form-input" defaultValue={modal.studio.studioCertId || modal.studio.studioCertIds?.[0] || ""}><option value="">ללא הסמכה</option>{studioCertTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
            <div style={{ fontSize:11, color:"var(--text3)", marginTop:-6 }}>שיוכים מרובים נשמרים מתוך רובריקת ההסמכות.</div>
            <label style={labelStyle}>סיווג מסלול לימודים
              <select name="studioTrackType" className="form-input" defaultValue={modal.studio.studioTrackType || "sound"}>
                <option value="sound">🎧 הנדסאי סאונד</option>
                <option value="cinema">🎬 הנדסאי קולנוע</option>
              </select>
            </label>
            <div style={{ fontSize:11, color:"var(--text3)", marginTop:-6 }}>בחירת סיווג תגביל את האולפן לסטודנטים ממסלול מאותו סוג בטופס ההשאלה.</div>
            <div style={{ fontSize:13, fontWeight:600, color:"var(--text2)" }}>תמונה נוכחית:<div style={{ marginTop:4 }}>{(editImage || modal.studio.image)?.startsWith("http") ? <img src={editImage || modal.studio.image} alt="תמונה" style={{ width:80, height:80, objectFit:"cover", borderRadius:8 }} /> : <span style={{ fontSize:32 }}>{modal.studio.image || "🎙️"}</span>}</div></div>
            <label style={labelStyle}>החלף תמונה<input type="file" accept="image/*" onChange={(event) => void handleImageUpload(event, setEditImage)} style={{ fontSize:13 }} disabled={imgUploading} />{imgUploading && <div style={{ fontSize:12, color:"var(--accent)", marginTop:4 }}>מעלה תמונה...</div>}</label>
            <label style={labelStyle}>או אימוג'י<input name="emoji" className="form-input" placeholder="🎙️" maxLength={4} /></label>
            <label style={{ display:"flex", alignItems:"center", gap:10, fontSize:13, fontWeight:700, color:"var(--text2)", background:"rgba(231,76,60,0.06)", border:"1px solid rgba(231,76,60,0.14)", borderRadius:8, padding:"10px 12px" }}>
              <input type="checkbox" name="isDisabled" defaultChecked={Boolean(modal.studio.isDisabled)} style={{ width:18, height:18, accentColor:"var(--red)" }} />
              השבתת אולפן
            </label>
            <div style={{ fontSize:12, color:"var(--text3)", marginTop:-4 }}>כאשר האפשרות פעילה, האולפן ייחסם בלוח ויוצג כתחזוקה.</div>
          </form>
        </Modal>
      )}

      {modal?.type === "addBooking" && (
        <Modal title={`📅 קביעת אולפן לצוות — ${modal.studioName} · ${modal.dayName} ${modal.date}`} onClose={closeModal} footer={<><button className="btn btn-secondary" onClick={closeModal}>ביטול</button><button form="addBookingForm" type="submit" className="btn btn-primary" disabled={saving || !teamMemberOptions.length}>{saving ? "שומר..." : "שמור קביעה"}</button></>}>
          <form id="addBookingForm" onSubmit={submitBooking} style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <label style={labelStyle}>
              מופעים חוזרים שבועיים
              <input name="repeatCount" type="number" min="0" max="24" defaultValue="0" className="form-input" />
              <span style={{ fontSize:11, color:"var(--text3)", fontWeight:500 }}>0 = בלי שכפול. כל ערך אחר ייצור מופעים נוספים שבוע אחרי שבוע באותו יום ובאותן שעות.</span>
            </label>
            {bookingRequiredCert.length > 0 && <div style={{ background:"rgba(52,152,219,0.08)", border:"1px solid rgba(52,152,219,0.2)", borderRadius:8, padding:"8px 12px", fontSize:12, color:"var(--blue)", fontWeight:600 }}>🎓 האולפן הזה דורש לסטודנטים הסמכה: {bookingRequiredCert.map((type) => type.name).join(" / ")}. קביעת צוות ממשיכה לעבוד גם בלי הסמכה.</div>}
            <label style={labelStyle}>איש צוות *{teamMemberOptions.length > 0 ? <select className="form-input" value={formTeamMember} onChange={(event) => setFormTeamMember(event.target.value)} required><option value="" disabled>בחר איש צוות...</option>{teamMemberOptions.map((member) => <option key={String(member.id)} value={String(member.id)}>{member.name}</option>)}</select> : <div style={{ background:"rgba(231,76,60,0.08)", border:"1px solid rgba(231,76,60,0.2)", borderRadius:8, padding:"10px 12px", color:"var(--red)", fontWeight:700 }}>אין כרגע אנשי צוות ברובריקת "צוות"</div>}</label>
            <div style={{ display:"flex", gap:8 }}>
              <label style={{ ...labelStyle, flex:1 }}>
                שעת התחלה *
                {modal?.isNightTeam ? (
                  <div className="form-input" style={{ display:"flex", alignItems:"center", minHeight:42, color:NIGHT_COLOR, fontWeight:700 }}>{NIGHT_BOOKING_LABEL}</div>
                ) : (
                  <select name="startTime" className="form-input" required defaultValue="09:00">
                    {DAY_BOOKING_HOURS.map((hour) => <option key={hour}>{hour}</option>)}
                  </select>
                )}
              </label>
              <label style={{ ...labelStyle, flex:1 }}>
                שעת סיום *
                {modal?.isNightTeam ? (
                  <div className="form-input" style={{ display:"flex", alignItems:"center", minHeight:42, color:NIGHT_COLOR, fontWeight:700 }}>קביעת לילה כללית</div>
                ) : (
                  <select name="endTime" className="form-input" required defaultValue="12:00">
                    {DAY_HOURS.map((hour) => <option key={hour}>{hour}</option>)}
                  </select>
                )}
              </label>
            </div>
            <label style={labelStyle}>
              <span style={{ color:NIGHT_COLOR }}>קביעת לילה לצוות</span>
              <input
                type="checkbox"
                name="isNight"
                checked={Boolean(modal?.isNightTeam)}
                onChange={(event) => setModal((prev) => prev?.type === "addBooking" ? { ...prev, isNightTeam: event.target.checked } : prev)}
                style={{ width:18, height:18, accentColor:NIGHT_COLOR }}
              />
            </label>
            {modal?.isNightTeam && <div style={{ fontSize:12, color:"var(--text2)", background:`${NIGHT_COLOR}12`, border:`1px solid ${NIGHT_COLOR}44`, borderRadius:8, padding:"10px 12px" }}>קביעת לילה לצוות נשמרת כטווח כללי {NIGHT_BOOKING_LABEL}.</div>}
            <label style={labelStyle}>הערות<textarea name="notes" className="form-input" rows={2} placeholder="למשל: הכנת אולפן / עבודה של איש צוות" /></label>
            <div style={{ fontSize:12, color:"var(--text3)" }}>קביעת צוות נשמרת ישירות בלוח, בלי סטטוס ובלי בדיקות הסמכה.</div>
          </form>
        </Modal>
      )}

      {modal?.type === "viewBooking" && (
        <Modal title={`📋 הזמנה — ${modal.studioName}`} onClose={closeModal} footer={<div style={{ display:"flex", gap:8, flexWrap:"wrap", justifyContent:"space-between", width:"100%" }}><div>{canDeleteBooking(modal.booking) && <button className="btn btn-secondary btn-sm" style={{ color:"var(--red)", borderColor:"var(--red)" }} onClick={() => void deleteBooking(modal.booking.id)}>{getBookingKind(modal.booking) === "student" ? "מחק ושלח" : "מחק"}</button>}</div><button className="btn btn-secondary btn-sm" onClick={closeModal}>סגור</button></div>}>
          {(() => {
            const booking = modal.booking;
            const kind = getBookingKind(booking);
            const color = getBookingColor(booking);
            return (
              <div style={{ display:"flex", flexDirection:"column", gap:10, direction:"rtl" }}>
                <Row label="סוג" value={<span style={{ color, fontWeight:700 }}>{getBookingTypeLabel(booking)}</span>} />
                <Row label="תאריך" value={booking.date} />
                <Row label="חלון שעות" value={getBookingTimeLabel(booking)} />
                {kind === "lesson" && <><Row label="קורס" value={booking.courseName || "—"} /><Row label="מרצה" value={booking.instructorName || "—"} /><Row label="מסלול" value={booking.track || "—"} /><Row label="נושא השיעור" value={booking.subject || "—"} /></>}
                {kind === "student" && <Row label="סטודנט" value={booking.studentName} />}
                {kind === "team" && <Row label="איש צוות" value={booking.teamMemberName || booking.studentName} />}
                {booking.isNight && kind !== "lesson" && <Row label="זמן" value={<span style={{ color:NIGHT_COLOR, fontWeight:700 }}>קביעת לילה</span>} />}
                {booking.notes && <Row label="הערות" value={booking.notes} />}
                {kind === "lesson" && <div style={{ background:"rgba(245,166,35,0.10)", border:"1px solid rgba(245,166,35,0.25)", borderRadius:8, padding:"12px 14px", fontSize:13, color:"var(--text2)", lineHeight:1.7 }}>קביעת שיעור מנוהלת מתוך רובריקת "שיעורים". כדי לשנות או לבטל אותה צריך לערוך את הקורס עצמו.</div>}
                {kind === "student" && role === "admin" && <div style={{ display:"flex", flexDirection:"column", gap:6 }}><label style={{ fontSize:13, fontWeight:700, color:"var(--text2)" }}>הודעה לסטודנט במקרה ביטול</label><textarea className="form-input" rows={3} value={cancelMessage} onChange={(event) => setCancelMessage(event.target.value)} placeholder="למשל: נאלצנו לבטל את הקביעה בגלל חסימת אולפן / תחזוקה / שיעור" /><div style={{ fontSize:11, color:"var(--text3)" }}>ההודעה תצורף למייל הביטול שנשלח אוטומטית לסטודנט.</div></div>}
              </div>
            );
          })()}
        </Modal>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
      <span style={{ color:"var(--text3)", fontSize:13, minWidth:72 }}>{label}:</span>
      <span style={{ fontWeight:600, fontSize:13 }}>{value}</span>
    </div>
  );
}
