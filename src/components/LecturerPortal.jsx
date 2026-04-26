import { supabase } from '../supabaseClient.js';
import { useEffect, useMemo, useState } from "react";
import { formatDate, getAvailable, normalizeName, storageSet, storageGet, updateReservationStatus, getAuthToken } from "../utils.js";
import { listStudents } from "../utils/studentsApi.js";
import { statusBadge } from "./ui.jsx";
import { Backpack, BookOpen, Calendar, CheckCircle, Film, GraduationCap, Info, Mic, Minus, Package, X, XCircle } from "lucide-react";
import { DeptHeadCalendarPage } from "./CalendarViews.jsx";

function hasLinkedValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function sortSessions(schedule = []) {
  return [...schedule].sort((a, b) => {
    const dateCompare = String(a?.date || "").localeCompare(String(b?.date || ""));
    if (dateCompare !== 0) return dateCompare;
    return String(a?.startTime || "").localeCompare(String(b?.startTime || ""));
  });
}

function getSessionUid(session = {}, index = 0) {
  return String(
    session?._key
      || `${session?.date || ""}__${session?.startTime || ""}__${session?.endTime || ""}__${session?.topic || ""}__${index}`,
  );
}

function getSessionTimeKey(session = {}) {
  return `${session?.date || ""}__${session?.startTime || ""}__${session?.endTime || ""}`;
}

function getReservationSessionKey(reservation = {}) {
  return `${reservation?.borrow_date || ""}__${reservation?.borrow_time || ""}__${reservation?.return_time || ""}`;
}

function computeMaxKitCopies(kit, availabilityMap) {
  const items = kit?.items || [];
  if (!items.length) return 0;
  let min = Infinity;
  for (const it of items) {
    const avail = Number(availabilityMap[it.equipment_id] ?? 0);
    const perCopy = Number(it.quantity) || 0;
    if (perCopy <= 0) continue;
    min = Math.min(min, Math.floor(avail / perCopy));
  }
  return Number.isFinite(min) ? min : 0;
}

function getCourseLinkedKit(lesson, lessonKits = []) {
  if (!lesson) return null;
  if (hasLinkedValue(lesson.kitId)) {
    return lessonKits.find((kit) => String(kit.id) === String(lesson.kitId)) || null;
  }
  return null;
}

function sessionHasEnded(session) {
  if (!session?.date) return false;
  const endTime = session?.endTime || session?.startTime || "23:59";
  const timestamp = new Date(`${session.date}T${endTime}:00`).getTime();
  return Number.isFinite(timestamp) ? Date.now() >= timestamp : false;
}

function digitsOnly(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function buildDefaultKitName(lesson, scope, session) {
  const courseName = String(lesson?.name || "").trim() || "קורס";
  if (scope === "session" && session?.date) {
    return `השאלת מפגש - ${courseName} - ${formatDate(session.date)}`;
  }
  return `השאלת קורס - ${courseName}`;
}

function createLessonKitId() {
  return `lesson_kit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function LecturerPortal({
  lecturers = [],
  lessons = [],
  kits = [],
  equipment = [],
  reservations = [],
  studios = [],
  certifications = { types: [], students: [] },
  setLessons,
  setKits,
  setReservations,
  showToast,
  siteSettings = {},
  deptHeads = [],
  onLogout,
}) {
  const [loggedInLecturer, setLoggedInLecturer] = useState(() => {
    try {
      const stored = sessionStorage.getItem("lecturer_portal_user");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("הכל");
  // archiveView: false = active courses, true = courses whose last meeting
  // already passed (course archive). Lessons stay in the system until the
  // admin deletes them — the lecturer can still update student statuses
  // here for late submissions (computeStatusWindow keeps the window open
  // post-end).
  const [archiveView, setArchiveView] = useState(false);

  // Stage 6 step 5b: students for getStudentsForLesson() come from
  // public.students via studentsApi. Falls back to certifications.students
  // (blob) until the fetch resolves so the UI is never empty.
  const [studentsFromTable, setStudentsFromTable] = useState(() => certifications?.students ?? []);
  useEffect(() => {
    let alive = true;
    listStudents().then(s => { if (alive && Array.isArray(s)) setStudentsFromTable(s); });
    return () => { alive = false; };
  }, []);
  const [editorState, setEditorState] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftItems, setDraftItems] = useState([]);
  const [draftSearch, setDraftSearch] = useState("");
  const [selectedCats, setSelectedCats] = useState([]);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [eqTypeFilter, setEqTypeFilter] = useState("all");
  const [editorError, setEditorError] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeKitIds, setActiveKitIds] = useState(new Set());

  // ── Student status modal ──
  // studentListLessonId: which lesson's student-list modal is open (null = closed).
  // studentStatusDraft: per-row draft map { [studentId]: "passed" | "failed" | "" }
  // savingStudentStatuses: spinner flag for the modal Save button.
  const [studentListLessonId, setStudentListLessonId] = useState(null);
  const [studentStatusDraft, setStudentStatusDraft] = useState({});
  const [savingStudentStatuses, setSavingStudentStatuses] = useState(false);

  const activeLecturers = useMemo(
    () => lecturers.filter((lecturer) => lecturer?.isActive !== false),
    [lecturers],
  );
  const lessonKits = useMemo(
    () => kits.filter((kit) => (kit?.loanTypes || []).includes("שיעור")),
    [kits],
  );
  const studioNameById = useMemo(() => {
    const entries = (studios || []).map((studio) => [String(studio.id), studio.name]);
    return Object.fromEntries(entries);
  }, [studios]);

  const currentLecturer = useMemo(() => {
    if (!loggedInLecturer) return null;
    const byId = activeLecturers.find((lecturer) => String(lecturer.id) === String(loggedInLecturer.id));
    if (byId) return byId;
    return activeLecturers.find((lecturer) => normalizeName(lecturer.fullName) === normalizeName(loggedInLecturer.fullName)) || null;
  }, [activeLecturers, loggedInLecturer]);

  // ── Dept head panel ── (MUST come after currentLecturer)
  const [activeTab, setActiveTab] = useState("courses"); // courses | journal
  const [approvingId, setApprovingId] = useState(null);

  const myDeptHead = useMemo(() => {
    if (!currentLecturer) return null;
    const lecId = String(currentLecturer.id);
    const lecEmail = String(currentLecturer.email || "").trim().toLowerCase();
    return (deptHeads || []).find(dh => {
      if (dh.lecturerId && String(dh.lecturerId) === lecId) return true;
      if (lecEmail && dh.email?.toLowerCase().trim() === lecEmail) return true;
      return false;
    }) || null;
  }, [currentLecturer, deptHeads]);

  const pendingDhRequests = useMemo(() => {
    if (!myDeptHead) return [];
    const myLoanTypes = myDeptHead.loanTypes || [];
    return (reservations || []).filter(r =>
      r.status === "אישור ראש מחלקה" &&
      myLoanTypes.includes(r.loan_type)
    ).sort((a, b) => (b.id || 0) - (a.id || 0));
  }, [myDeptHead, reservations]);

  // Route status changes through the atomic RPC (migration 009).
  // The RPC locks the reservation row FOR UPDATE, so two dept-heads clicking
  // approve at the same time can't both "succeed". The blob write afterwards
  // is just a cache refresh — the DB is already the source of truth.
  const changeDhStatus = async (res, newStatus, successMsg) => {
    setApprovingId(res.id);
    try {
      const rpcResult = await updateReservationStatus(res.id, newStatus);
      if (!rpcResult.ok) {
        console.error("changeDhStatus RPC failed:", rpcResult);
        showToast("error", "שגיאה בעדכון הסטטוס בשרת");
        return;
      }
      // Local state refresh — re-read from Supabase for accurate post-update list
      const freshRes = await (supabase.from("reservations_new").select("*, reservation_items(*)").then(res => (res.data || []).map(r => ({ ...r, items: r.reservation_items || [] }))));
      const all = Array.isArray(freshRes) ? freshRes : reservations;
      const updated = all.map(r => String(r.id) === String(res.id) ? { ...r, status: newStatus } : r);
      if (setReservations) setReservations(updated);
      showToast("success", successMsg);
    } catch (err) {
      console.error("changeDhStatus error:", err);
      showToast("error", "שגיאה בעדכון הסטטוס");
    } finally {
      setApprovingId(null);
    }
  };

  const approveDhRequest = (res) =>
    changeDhStatus(res, "ממתין", `בקשת "${res.student_name}" אושרה והועברה לצוות המחסן`);

  const rejectDhRequest = (res) =>
    changeDhStatus(res, "נדחה", `בקשת "${res.student_name}" נדחתה`);

  useEffect(() => {
    if (loggedInLecturer) {
      sessionStorage.setItem("lecturer_portal_user", JSON.stringify(loggedInLecturer));
      return;
    }
    sessionStorage.removeItem("lecturer_portal_user");
  }, [loggedInLecturer]);

  useEffect(() => {
    if (!loggedInLecturer || currentLecturer) return;
    try {
      sessionStorage.setItem("public_login_role", "lecturer");
      sessionStorage.setItem("public_login_notice", "צריך להתחבר כמרצה ממסך הכניסה הראשי.");
    } catch {}
    setLoggedInLecturer(null);
    setEditorState(null);
  }, [currentLecturer, loggedInLecturer]);

  useEffect(() => {
    if (loggedInLecturer) return undefined;
    const timeoutId = window.setTimeout(() => {
      window.location.replace("/");
    }, 120);
    return () => window.clearTimeout(timeoutId);
  }, [loggedInLecturer]);

  const lecturerLessons = useMemo(() => {
    if (!currentLecturer) return [];
    const lecturerId = String(currentLecturer.id);
    const lecturerName = normalizeName(currentLecturer.fullName);
    const lecturerEmail = String(currentLecturer.email || "").trim().toLowerCase();

    return lessons.filter((lesson) => {
      if (!lesson) return false;
      if (hasLinkedValue(lesson.lecturerId) && String(lesson.lecturerId) === lecturerId) return true;
      if (normalizeName(lesson.instructorName) === lecturerName) return true;
      if (lecturerEmail && String(lesson.instructorEmail || "").trim().toLowerCase() === lecturerEmail) return true;
      return false;
    });
  }, [currentLecturer, lessons]);

  const lecturerCourseEntries = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    return lecturerLessons
      .map((lesson) => {
        const sessions = sortSessions((lesson.schedule || []).filter((session) => session?.date))
          .map((session, index) => ({
            ...session,
            _lecturerUid: getSessionUid(session, index),
            _timeKey: getSessionTimeKey(session),
            _isPast: sessionHasEnded(session),
          }));
        const courseKit = getCourseLinkedKit(lesson, lessonKits);
        const futureSessions = sessions.filter((session) => !session._isPast);
        const fallbackSessions = sessions.filter((session) => !hasLinkedValue(session.kitId));
        const futureFallbackSessions = fallbackSessions.filter((session) => !session._isPast);
        const nextSession = futureSessions[0] || sessions[0] || null;
        // A course is considered "archived" only when it has at least one
        // scheduled meeting AND the last meeting's date is strictly before
        // today (Israel local — same calendar day as everywhere else in this
        // file). Courses without any schedule never auto-archive — there's
        // no end date to compare to.
        const sessionDates = sessions.map((s) => String(s?.date || "")).filter(Boolean);
        const lastMeetingISO = sessionDates[sessionDates.length - 1] || "";
        const isArchived = !!lastMeetingISO && lastMeetingISO < todayIso;
        return {
          lesson,
          sessions,
          futureSessions,
          courseKit,
          fallbackSessions,
          futureFallbackSessions,
          nextSession,
          isArchived,
          lastMeetingISO,
        };
      })
      .sort((a, b) => {
        const aStamp = a.nextSession ? `${a.nextSession.date} ${a.nextSession.startTime || ""}` : `9999 ${a.lesson.name || ""}`;
        const bStamp = b.nextSession ? `${b.nextSession.date} ${b.nextSession.startTime || ""}` : `9999 ${b.lesson.name || ""}`;
        return aStamp.localeCompare(bStamp, "he");
      });
  }, [lecturerLessons, lessonKits]);

  // Split entries into active vs archived for the two views.
  const activeCourseEntries = useMemo(
    () => lecturerCourseEntries.filter((e) => !e.isArchived),
    [lecturerCourseEntries],
  );
  const archivedCourseEntries = useMemo(
    () => lecturerCourseEntries.filter((e) => e.isArchived),
    [lecturerCourseEntries],
  );
  const visibleCourseEntries = archiveView ? archivedCourseEntries : activeCourseEntries;

  const filteredCourseEntries = useMemo(() => {
    let entries = visibleCourseEntries;
    // Apply course name filter
    if (courseFilter && courseFilter !== "הכל") {
      entries = entries.filter(({ lesson }) => lesson?.name === courseFilter);
    }
    // Apply text search
    const term = String(search || "").trim().toLowerCase();
    if (!term) return entries;
    return entries.filter(({ lesson, courseKit }) => {
      const haystack = [
        lesson?.name,
        lesson?.track,
        lesson?.description,
        courseKit?.name,
      ].map((value) => String(value || "").toLowerCase()).join(" ");
      return haystack.includes(term);
    });
  }, [visibleCourseEntries, search, courseFilter]);

  const editorContext = useMemo(() => {
    if (!editorState) return null;
    const entry = lecturerCourseEntries.find(({ lesson }) => String(lesson.id) === String(editorState.lessonId));
    if (!entry) return null;

    if (editorState.scope === "course") {
      return {
        type: "course",
        lesson: entry.lesson,
        courseKit: entry.courseKit,
        currentKit: entry.courseKit,
        templateKit: entry.courseKit,
        targetSessions: entry.fallbackSessions,
        allSessions: entry.futureSessions,
        validationSessions: entry.futureSessions,
        affectedReservationKeys: new Set((entry.courseKit ? entry.fallbackSessions : []).map((session) => session._timeKey)),
      };
    }

    const session = entry.sessions.find((candidate) => candidate._lecturerUid === editorState.sessionUid);
    if (!session) return null;
    const sessionKit = hasLinkedValue(session.kitId)
      ? lessonKits.find((kit) => String(kit.id) === String(session.kitId)) || null
      : null;

    return {
      type: "session",
      lesson: entry.lesson,
      session,
      courseKit: entry.courseKit,
      currentKit: sessionKit,
      templateKit: sessionKit || entry.courseKit,
      targetSessions: [session],
      validationSessions: session._isPast ? [] : [session],
      affectedReservationKeys: new Set([session._timeKey]),
    };
  }, [editorState, lecturerCourseEntries, lessonKits]);

  useEffect(() => {
    if (!editorContext) return;
    const sourceKit = editorContext.currentKit || editorContext.templateKit;

    // Prefer items from an actual (non-auto) reservation — reflects staff edits
    // that updated reservation_items without touching store.kits.
    const lessonId = String(editorContext.lesson.id);
    const realReservation = reservations.find(r =>
      r.lesson_auto === false &&
      String(r.lesson_id || "") === lessonId &&
      Array.isArray(r.items) && r.items.length > 0 &&
      editorContext.targetSessions.some(s => s.date === r.borrow_date)
    );
    const itemSource = realReservation || sourceKit;

    // Reservation name is auto-built from the course name + meeting date.
    // The lecturer doesn't set this manually anymore — the field was removed
    // from the modal because it always boils down to the same template.
    setDraftName(buildDefaultKitName(editorContext.lesson, editorContext.type, editorContext.session));
    setDraftDescription(String(sourceKit?.description || "").trim());
    setDraftItems(
      (itemSource?.items || [])
        .filter((item) => Number(item?.quantity) > 0)
        .map((item) => ({
          equipment_id: item.equipment_id,
          quantity: Number(item.quantity) || 0,
          name: item.name || "",
        })),
    );
    setDraftSearch("");
    setSelectedCats([]);
    setShowSelectedOnly(false);
    setEditorError("");
    setActiveKitIds(new Set());
  }, [editorContext, reservations]);

  const baseReservations = useMemo(() => {
    if (!editorContext) return reservations;
    const lessonId = String(editorContext.lesson.id);
    return reservations.filter((reservation) => {
      if (String(reservation?.lesson_id || "") !== lessonId) return true;
      return !editorContext.affectedReservationKeys.has(getReservationSessionKey(reservation));
    });
  }, [editorContext, reservations]);

  const availabilityByEquipmentId = useMemo(() => {
    if (!editorContext) return {};
    const targetSessions = editorContext.validationSessions;
    const map = {};
    (equipment || []).forEach((item) => {
      const totalQuantity = Number(item?.total_quantity) || 0;
      if (!targetSessions.length) {
        map[item.id] = totalQuantity;
        return;
      }
      const availabilityBySession = targetSessions.map((session) => getAvailable(
        item.id,
        session.date,
        session.date,
        baseReservations,
        equipment,
        null,
        session.startTime || "",
        session.endTime || "",
      ));
      map[item.id] = Math.min(...availabilityBySession);
    });
    return map;
  }, [baseReservations, editorContext, equipment]);

  const selectedItems = useMemo(
    () => draftItems.filter((item) => Number(item.quantity) > 0),
    [draftItems],
  );

  const filteredEquipment = useMemo(() => {
    const term = String(draftSearch || "").trim().toLowerCase();
    const sorted = [...equipment].sort((a, b) => {
      const categoryCompare = String(a?.category || "").localeCompare(String(b?.category || ""), "he");
      if (categoryCompare !== 0) return categoryCompare;
      return String(a?.name || "").localeCompare(String(b?.name || ""), "he");
    });
    const typeMatch = (item) => {
      if (eqTypeFilter === "all") return true;
      const isGeneral = !item.soundOnly && !item.photoOnly;
      if (eqTypeFilter === "sound") return item.soundOnly || isGeneral;
      if (eqTypeFilter === "photo") return item.photoOnly || isGeneral;
      return true;
    };
    const byType = sorted.filter(typeMatch);
    if (!term) return byType;
    return byType.filter((item) => {
      const haystack = `${item?.name || ""} ${item?.category || ""} ${item?.description || ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [draftSearch, equipment, eqTypeFilter]);

  const filteredEquipmentGroups = useMemo(() => {
    const groups = new Map();
    filteredEquipment.forEach((item) => {
      const category = String(item?.category || "").trim() || "ללא קטגוריה";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(item);
    });
    return Array.from(groups.entries());
  }, [filteredEquipment]);

  const baseCategories = useMemo(
    () => filteredEquipmentGroups.map(([category]) => category),
    [filteredEquipmentGroups],
  );

  const visibleEquipmentGroups = useMemo(() => (
    filteredEquipmentGroups
      .filter(([category]) => selectedCats.length === 0 || selectedCats.includes(category))
      .map(([category, items]) => [
        category,
        showSelectedOnly
          ? items.filter((item) => draftItems.some((draftItem) => String(draftItem.equipment_id) === String(item.id) && Number(draftItem.quantity) > 0))
          : items,
      ])
      .filter(([, items]) => items.length > 0)
  ), [filteredEquipmentGroups, selectedCats, showSelectedOnly, draftItems]);

  const closeEditor = () => {
    if (saving) return;
    setEditorState(null);
    setEditorError("");
    setEqTypeFilter("all");
    setActiveKitIds(new Set());
  };

  // ── Student-status helpers ──────────────────────────────────────────────
  // Compute the last meeting date (YYYY-MM-DD) and whether the 7-day window
  // is open. Window opens 7 days before the last meeting and stays open
  // forever afterwards (so the lecturer can submit a late update).
  function computeStatusWindow(lesson) {
    const sched = Array.isArray(lesson?.schedule) ? lesson.schedule : [];
    const dates = sched
      .map((s) => (typeof s?.date === "string" ? s.date : ""))
      .filter(Boolean)
      .sort();
    const lastMeetingDate = dates[dates.length - 1] || "";
    if (!lastMeetingDate) {
      return { windowOpen: false, lastMeetingDate: "", windowOpensISO: "", isPostEnd: false };
    }
    const lastMs = new Date(`${lastMeetingDate}T00:00:00`).getTime();
    const opensMs = lastMs - 7 * 24 * 60 * 60 * 1000;
    const opens = new Date(opensMs);
    const yyyy = opens.getFullYear();
    const mm = String(opens.getMonth() + 1).padStart(2, "0");
    const dd = String(opens.getDate()).padStart(2, "0");
    const windowOpensISO = `${yyyy}-${mm}-${dd}`;
    const today = new Date().toISOString().slice(0, 10);
    const windowOpen = today >= windowOpensISO;
    const isPostEnd = today > lastMeetingDate;
    return { windowOpen, lastMeetingDate, windowOpensISO, isPostEnd };
  }

  function getStudentsForLesson(lesson) {
    const trk = String(lesson?.track || "").trim();
    if (!trk) return [];
    const all = Array.isArray(studentsFromTable) ? studentsFromTable : [];
    return all
      .filter((s) => String(s?.track || "").trim() === trk)
      .map((s) => ({
        ...s,
        _displayName: String(s?.name || `${s?.firstName || ""} ${s?.lastName || ""}`).trim() || "—",
      }));
  }

  const openStudentList = (lesson) => {
    if (!lesson) return;
    const draft = {};
    const existing = (lesson.studentStatuses && typeof lesson.studentStatuses === "object") ? lesson.studentStatuses : {};
    getStudentsForLesson(lesson).forEach((s) => {
      const v = existing[s.id];
      draft[s.id] = (v === "passed" || v === "failed") ? v : "";
    });
    setStudentStatusDraft(draft);
    setStudentListLessonId(lesson.id);
  };

  const closeStudentList = () => {
    if (savingStudentStatuses) return;
    setStudentListLessonId(null);
    setStudentStatusDraft({});
  };

  const saveStudentStatuses = async () => {
    const lesson = lessons.find((l) => String(l.id) === String(studentListLessonId));
    if (!lesson) {
      closeStudentList();
      return;
    }
    setSavingStudentStatuses(true);
    try {
      const cleanMap = {};
      Object.entries(studentStatusDraft || {}).forEach(([sid, val]) => {
        if (val === "passed" || val === "failed") cleanMap[sid] = val;
      });
      const updatedLesson = { ...lesson, studentStatuses: cleanMap };
      const updatedLessons = lessons.map((l) => String(l.id) === String(lesson.id) ? updatedLesson : l);
      await storageSet("lessons", updatedLessons);
      if (setLessons) setLessons(updatedLessons);
      showToast && showToast("success", "סטטוסי התלמידים נשמרו");
      setStudentListLessonId(null);
      setStudentStatusDraft({});
    } catch (err) {
      console.error("saveStudentStatuses error", err);
      showToast && showToast("error", "שמירה נכשלה. נסה שוב.");
    } finally {
      setSavingStudentStatuses(false);
    }
  };

  const setItemQuantity = (equipmentId, quantity) => {
    const eq = equipment.find((item) => String(item.id) === String(equipmentId));
    if (!eq) return;
    const nextQuantity = Math.max(0, Number(quantity) || 0);
    setDraftItems((currentItems) => {
      const existing = currentItems.find((item) => String(item.equipment_id) === String(equipmentId));
      if (nextQuantity <= 0) {
        return currentItems.filter((item) => String(item.equipment_id) !== String(equipmentId));
      }
      if (existing) {
        return currentItems.map((item) => (
          String(item.equipment_id) === String(equipmentId)
            ? { ...item, quantity: nextQuantity, name: eq.name || item.name || "" }
            : item
        ));
      }
      return [...currentItems, { equipment_id: eq.id, quantity: nextQuantity, name: eq.name || "" }];
    });
  };

  const getSelectedQuantity = (equipmentId) => (
    draftItems.find((item) => String(item.equipment_id) === String(equipmentId))?.quantity || 0
  );

  const applyKitToDraft = (kit, copies = 1) => {
    if (!kit || !Array.isArray(kit.items) || !kit.items.length) return;
    const kitId = String(kit.id);
    if (activeKitIds.has(kitId)) {
      // Deselect: subtract this kit's quantities from draft; remove item if result <=0
      const kitQtyMap = new Map(kit.items.map((i) => [String(i.equipment_id), Number(i.quantity) || 0]));
      setDraftItems((current) =>
        current
          .map((x) => {
            const eqId = String(x.equipment_id);
            const subtract = kitQtyMap.get(eqId) || 0;
            return subtract ? { ...x, quantity: Math.max(0, (x.quantity || 0) - subtract) } : x;
          })
          .filter((x) => (x.quantity || 0) > 0)
      );
      setActiveKitIds((prev) => { const next = new Set(prev); next.delete(kitId); return next; });
      return;
    }
    // Select: inject kit items into draft
    const mult = Math.max(1, Number(copies) || 1);
    setDraftItems((current) => {
      const next = [...current];
      kit.items.forEach((item) => {
        const eqId = item.equipment_id;
        const eqRec = equipment.find((e) => String(e.id) === String(eqId));
        if (!eqRec) return;
        const perCopy = Number(item.quantity) || 0;
        const want = perCopy * mult;
        if (want <= 0) return;
        const avail = Number(availabilityByEquipmentId[eqId] ?? 0);
        const bounded = Math.min(want, avail);
        const idx = next.findIndex((x) => String(x.equipment_id) === String(eqId));
        if (idx >= 0) { const combined = Math.min((next[idx].quantity || 0) + bounded, avail); next[idx] = { ...next[idx], quantity: combined, name: eqRec.name || next[idx].name || "" }; }
        else next.push({ equipment_id: eqId, quantity: bounded, name: eqRec.name || item.name || "" });
      });
      return next;
    });
    setActiveKitIds((prev) => new Set([...prev, kitId]));
  };

  const handleSaveLoan = async () => {
    if (!editorContext || !currentLecturer) return;
    if (!draftName.trim()) {
      setEditorError("צריך לתת שם להשאלת השיעור לפני שמירה.");
      return;
    }
    if (!selectedItems.length) {
      setEditorError("צריך לבחור לפחות פריט ציוד אחד להשאלת השיעור.");
      return;
    }
    if (!editorContext.validationSessions.length) {
      setEditorError("אפשר ליצור השאלת שיעור רק למפגשים עתידיים.");
      return;
    }

    const invalidItem = selectedItems.find((item) => Number(item.quantity) > Number(availabilityByEquipmentId[item.equipment_id] ?? 0));
    if (invalidItem) {
      const eq = equipment.find((candidate) => String(candidate.id) === String(invalidItem.equipment_id));
      const available = Number(availabilityByEquipmentId[invalidItem.equipment_id] ?? 0);
      setEditorError(`אין מספיק מלאי עבור "${eq?.name || "פריט"}". נדרשו ${invalidItem.quantity} וזמינים ${available}.`);
      return;
    }

    const validationSessions = [...editorContext.validationSessions].sort((a, b) => {
      const left = `${a.date || ""} ${a.startTime || ""}`;
      const right = `${b.date || ""} ${b.startTime || ""}`;
      return left.localeCompare(right, "he");
    });
    for (let sessionIndex = 0; sessionIndex < validationSessions.length; sessionIndex += 1) {
      const session = validationSessions[sessionIndex];
      for (const item of selectedItems) {
        const rollingReservations = [...baseReservations];
        for (let previousIndex = 0; previousIndex < sessionIndex; previousIndex += 1) {
          const previousSession = validationSessions[previousIndex];
          rollingReservations.push({
            id: `__lecturer_validation_${previousIndex}`,
            status: "מאושר",
            borrow_date: previousSession.date,
            borrow_time: previousSession.startTime || "00:00",
            return_date: previousSession.date,
            return_time: previousSession.endTime || "23:59",
            items: selectedItems,
          });
        }
        const available = getAvailable(
          item.equipment_id,
          session.date,
          session.date,
          rollingReservations,
          equipment,
          null,
          session.startTime || "",
          session.endTime || "",
        );
        if (Number(item.quantity) > Number(available || 0)) {
          const eq = equipment.find((candidate) => String(candidate.id) === String(item.equipment_id));
          setEditorError(`אין מספיק מלאי עבור "${eq?.name || "פריט"}" במפגש של ${formatDate(session.date)} ${session.startTime || ""}-${session.endTime || ""}.`);
          return;
        }
      }
    }

    const currentKit = editorContext.currentKit;
    const nextKitId = currentKit?.id || createLessonKitId();
    const nextKit = {
      ...(currentKit || {}),
      id: nextKitId,
      loanTypes: ["שיעור"],
      name: draftName.trim(),
      description: draftDescription.trim(),
      items: selectedItems.map((item) => ({
        equipment_id: item.equipment_id,
        quantity: Number(item.quantity) || 0,
        name: equipment.find((candidate) => String(candidate.id) === String(item.equipment_id))?.name || item.name || "",
      })),
    };

    const nextKits = currentKit
      ? kits.map((kit) => (String(kit.id) === String(nextKitId) ? nextKit : kit))
      : [...kits, nextKit];

    const nextLessons = lessons.map((lesson) => {
      if (String(lesson.id) !== String(editorContext.lesson.id)) return lesson;
      if (editorContext.type === "course") {
        return { ...lesson, kitId: nextKitId };
      }
      return {
        ...lesson,
        schedule: (lesson.schedule || []).map((session, index) => {
          if (getSessionUid(session, index) !== editorContext.session._lecturerUid) return session;
          const { cancelledRequest, ...rest } = session || {};
          return { ...rest, kitId: nextKitId };
        }),
      };
    });

    setSaving(true);
    setEditorError("");

    const token = await getAuthToken().catch(() => null);
    const authHeaders = { "Content-Type": "application/json" };
    if (token) authHeaders["Authorization"] = `Bearer ${token}`;

    if (editorContext.type === "course") {
      try {
        const result = await fetch("/api/lecturer-kit", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            kitType: "course",
            lessonId: editorContext.lesson.id,
            allSessions: editorContext.allSessions.map((s) => ({ date: s.date, startTime: s.startTime || "", endTime: s.endTime || "" })),
            items: selectedItems.map((item) => ({
              equipment_id: item.equipment_id,
              quantity: Number(item.quantity) || 0,
              name: equipment.find((e) => String(e.id) === String(item.equipment_id))?.name || item.name || "",
            })),
            reservationName: draftName.trim(),
            description: draftDescription.trim(),
            lecturer: {
              name: currentLecturer.fullName || editorContext.lesson.instructorName || "",
              email: String(currentLecturer.email || editorContext.lesson.instructorEmail || "").trim(),
              phone: String(currentLecturer.phone || editorContext.lesson.instructorPhone || "").trim(),
              course: editorContext.lesson.name || "",
            },
          }),
        });
        if (!result.ok) {
          const err = await result.text();
          console.error("lecturer-kit course error", err);
          setSaving(false);
          setEditorError("יצירת ההשאלות נכשלה. נסה שוב.");
          return;
        }
      } catch (e) {
        console.error("lecturer-kit course fetch error", e);
        setSaving(false);
        setEditorError("יצירת ההשאלות נכשלה. בדוק חיבור לאינטרנט.");
        return;
      }
      setSaving(false);
      setEditorState(null);
      showToast("success", `ההשאלות נוצרו בהצלחה עבור ${editorContext.allSessions.length} מפגשי הקורס.`);
      // Refresh so staff edits and new reservations are immediately visible
      supabase.from("reservations_new").select("*, reservation_items(*)").then(({ data }) => {
        if (data && setReservations) setReservations(data.map(r => ({ ...r, items: r.reservation_items || [] })));
      });
      return;
    }

    try {
      const result = await fetch("/api/lecturer-kit", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          kit: nextKit,
          lessonId: editorContext.lesson.id,
          sessionUid: editorContext.session._lecturerUid,
          kitType: "session",
        }),
      });
      if (!result.ok) {
        const err = await result.text();
        console.error("lecturer-kit error", err);
        setSaving(false);
        setEditorError("שמירת ההשאלה נכשלה. נסה שוב.");
        return;
      }
    } catch (e) {
      console.error("lecturer-kit fetch error", e);
      setSaving(false);
      setEditorError("שמירת ההשאלה נכשלה. בדוק חיבור לאינטרנט.");
      return;
    }

    setKits(nextKits);
    setLessons(nextLessons);
    setSaving(false);
    setEditorState(null);
    showToast("success", "השאלת המפגש נשמרה.");
    supabase.from("reservations_new").select("*, reservation_items(*)").then(({ data }) => {
      if (data && setReservations) setReservations(data.map(r => ({ ...r, items: r.reservation_items || [] })));
    });
  };

  if (!loggedInLecturer || !currentLecturer) {
    return (
      <div className="form-page" style={{ "--accent": siteSettings.accentColor || "#f5a623" }}>
        <div style={{ width: "100%", maxWidth: 430, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "40px 32px", textAlign: "center", direction: "rtl" }}>
          {siteSettings.logo
            ? <img src={siteSettings.logo} alt="לוגו" style={{ width: 82, height: 82, objectFit: "contain", borderRadius: 12, marginBottom: 16, display: "block", marginInline: "auto" }} />
            : <div style={{ fontSize: 48, marginBottom: 16 }}><GraduationCap size={48} strokeWidth={1.75} color="var(--accent)" /></div>}
          <h2 style={{ fontSize: "clamp(15px,4vw,20px)", fontWeight: 900, color: "var(--accent)", marginBottom: 6 }}>מעביר למסך הכניסה</h2>
          <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 24 }}>
            כניסת מרצים מתבצעת עכשיו ממסך הכניסה הראשי של מערכת הפניות.
          </div>
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <a href="/" style={{ fontSize: 12, color: "var(--text3)", textDecoration: "none" }}>
              חזרה למסך הכניסה
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (!loggedInLecturer) {
    return (
      <div className="form-page" style={{ "--accent": siteSettings.accentColor || "#f5a623" }}>
        <div style={{ width: "100%", maxWidth: 430, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "40px 32px", textAlign: "center", direction: "rtl" }}>
          {siteSettings.logo
            ? <img src={siteSettings.logo} alt="לוגו" style={{ width: 82, height: 82, objectFit: "contain", borderRadius: 12, marginBottom: 16, display: "block", marginInline: "auto" }} />
            : <div style={{ fontSize: 48, marginBottom: 16 }}><GraduationCap size={48} strokeWidth={1.75} color="var(--accent)" /></div>}
          <h2 style={{ fontSize: "clamp(15px,4vw,20px)", fontWeight: 900, color: "var(--accent)", marginBottom: 6 }}>כניסת מרצים למערכת ההשאלות</h2>
          <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 24 }}>גישה מוגבלת לקורסים ולמפגשים של המרצה בלבד</div>

          <div style={{ textAlign: "right", marginBottom: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)", display: "block", marginBottom: 4 }}>שם מלא</label>
            <input
              className="form-input"
              placeholder="הקלד/י שם מלא"
              value={loginForm.name}
              onChange={(event) => {
                setLoginForm((current) => ({ ...current, name: event.target.value }));
                setLoginError("");
              }}
              onKeyDown={(event) => event.key === "Enter" && handleLogin()}
            />
          </div>

          <div style={{ textAlign: "right", marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)", display: "block", marginBottom: 4 }}>אימייל או טלפון</label>
            <input
              className="form-input"
              placeholder="האימייל או הטלפון שהוגדרו למרצה"
              value={loginForm.identifier}
              onChange={(event) => {
                setLoginForm((current) => ({ ...current, identifier: event.target.value }));
                setLoginError("");
              }}
              onKeyDown={(event) => event.key === "Enter" && handleLogin()}
            />
          </div>

          {loginError && <div style={{ color: "var(--red)", fontSize: 13, fontWeight: 700, marginBottom: 12 }}><XCircle size={16} strokeWidth={1.75} /> {loginError}</div>}

          <button
            className="btn btn-primary"
            style={{ width: "100%", padding: "12px", fontSize: 15 }}
            onClick={handleLogin}
            disabled={!loginForm.name.trim()}
          >
            כניסת מרצה
          </button>

          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 16 }}>
            אפשר להתחבר רק עם מרצה פעיל שכבר קיים ברובריקת "מרצים"
          </div>

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <a href="/" style={{ fontSize: 12, color: "var(--text3)", textDecoration: "none" }}>
              חזרה למסך הבקשות הראשי
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="form-page" style={{ "--accent": siteSettings.accentColor || "#f5a623", direction: "rtl" }}>
      <div style={{ width: "min(1180px, 100%)", display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: "22px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: visibleCourseEntries.length > 1 ? 14 : 0 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 900, color: "var(--accent)", marginBottom: 4 }}>פורטל מרצה</div>
              <div style={{ fontSize: 14, color: "var(--text2)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>שלום, {currentLecturer?.fullName || loggedInLecturer.fullName}</span>
                {myDeptHead?.role && (
                  <span style={{ background: "rgba(155,89,182,0.12)", border: "1px solid rgba(155,89,182,0.35)", color: "#9b59b6", borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 800 }}>
                    <GraduationCap size={16} strokeWidth={1.75} color="var(--accent)" /> {myDeptHead.role}
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {activeTab === "courses" && (
                <input
                  className="form-input"
                  style={{ width: 260 }}
                  placeholder="חיפוש קורס לפי שם או מסלול"
                  value={search}
                  onChange={(event) => { setSearch(event.target.value); setCourseFilter("הכל"); }}
                />
              )}
              {/* Archive toggle: switches between active courses and the archive
                  (courses whose last meeting already passed). Only rendered
                  when the archive has anything to show — otherwise it's noise. */}
              {activeTab === "courses" && archivedCourseEntries.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setArchiveView((v) => !v); setCourseFilter("הכל"); setSearch(""); }}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 20,
                    border: `2px solid ${archiveView ? "var(--accent)" : "var(--border)"}`,
                    background: archiveView ? "var(--accent-glow)" : "var(--surface2)",
                    color: archiveView ? "var(--accent)" : "var(--text2)",
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                  title={archiveView ? "חזרה לקורסים פעילים" : "הצג קורסים שהסתיימו"}
                >
                  {archiveView ? "← קורסים פעילים" : `🗂 ארכיון קורסים (${archivedCourseEntries.length})`}
                </button>
              )}
              {(() => { try { const r = loggedInLecturer || {}; return r.is_admin || r.is_warehouse; } catch { return false; } })() && (
                <button
                  className="btn"
                  onClick={() => { sessionStorage.setItem("active_role", "staff"); sessionStorage.removeItem("lecturer_portal_user"); window.location.assign("/"); }}
                  style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.3)", color: "#8b5cf6", fontWeight: 600 }}
                >
                  ניהול מערכת
                </button>
              )}
            </div>
          </div>
          {/* Course filter pills — only shown when the current view (active or
              archive) has 2+ courses. Pills filter within the visible subset. */}
          {activeTab === "courses" && visibleCourseEntries.length > 1 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingTop: 2 }}>
              {["הכל", ...visibleCourseEntries.map(e => e.lesson?.name).filter(Boolean)].map(name => {
                const active = courseFilter === name;
                return (
                  <button key={name} type="button" onClick={() => { setCourseFilter(name); setSearch(""); }}
                    style={{ padding: "5px 14px", borderRadius: 20, border: `2px solid ${active ? "var(--accent)" : "var(--border)"}`, background: active ? "var(--accent-glow)" : "var(--surface2)", color: active ? "var(--accent)" : "var(--text2)", fontWeight: active ? 800 : 600, fontSize: 12, cursor: "pointer", transition: "all 0.15s" }}>
                    {name}
                  </button>
                );
              })}
            </div>
          )}
          {/* Tabs — only when lecturer is also dept head */}
          {myDeptHead && (
            <div style={{ display: "flex", gap: 8, marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
              {[
                { id: "courses", label: <><BookOpen size={16} strokeWidth={1.75} color="var(--accent)" /> הקורסים שלי</> },
                { id: "journal", label: <><GraduationCap size={16} strokeWidth={1.75} color="var(--accent)" /> יומן השאלות תלמידים</> },
              ].map(tab => {
                const active = activeTab === tab.id;
                return (
                  <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                    style={{ padding: "10px 20px", borderRadius: 12, border: `2px solid ${active ? "var(--accent)" : "var(--border)"}`, background: active ? "var(--accent-glow)" : "var(--surface2)", color: active ? "var(--accent)" : "var(--text2)", fontWeight: active ? 900 : 700, fontSize: 14, cursor: "pointer", transition: "all 0.15s" }}>
                    {tab.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {/* ── Dept Head Approval Panel ── */}
        {myDeptHead && activeTab === "journal" && (
          <div style={{ background: "var(--surface)", border: "2px solid rgba(155,89,182,0.3)", borderRadius: 18, overflow: "hidden" }}>
            <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", background: "rgba(155,89,182,0.06)" }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 900, color: "#9b59b6", display: "flex", alignItems: "center", gap: 6 }}><GraduationCap size={16} strokeWidth={1.75} color="#9b59b6" /> אישור בקשות השאלה — ראש מחלקה</div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>
                  {myDeptHead.role ? `${myDeptHead.role} · ` : ""}סוגי השאלה: {(myDeptHead.loanTypes || []).join(", ")}
                </div>
              </div>
              {pendingDhRequests.length > 0 && (
                <div style={{ background: "#9b59b6", color: "#fff", borderRadius: 999, padding: "4px 14px", fontSize: 13, fontWeight: 800 }}>
                  {pendingDhRequests.length} ממתינות
                </div>
              )}
            </div>
            <div style={{ padding: "16px 22px" }}>
              {pendingDhRequests.length === 0 ? (
                <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text3)", fontSize: 14 }}>
                  <CheckCircle size={16} strokeWidth={1.75} /> אין בקשות הממתינות לאישורך כרגע
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {pendingDhRequests.map(res => {
                    return (
                      <div key={res.id} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                          <div style={{ flex: 1, minWidth: 200 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                              <div style={{ fontWeight: 900, fontSize: 15, color: "var(--text)" }}>{res.student_name}</div>
                              {statusBadge(res.status)}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.8 }}>
                              <div><Package size={16} strokeWidth={1.75} color="var(--accent)" /> סוג: <strong>{res.loan_type}</strong></div>
                              {res.project_name && <div><Film size={16} strokeWidth={1.75} color="var(--accent)" /> פרויקט: {res.project_name}</div>}
                              <div><Calendar size={16} strokeWidth={1.75} color="var(--accent)" /> {formatDate(res.borrow_date)}{res.borrow_time ? ` ${res.borrow_time}` : ""} — {formatDate(res.return_date)}{res.return_time ? ` ${res.return_time}` : ""}</div>
                              {res.email && <div>📧 {res.email}</div>}
                              {res.phone && <div>📞 {res.phone}</div>}
                              {res.crew_photographer_name && <div>📸 צלם: {res.crew_photographer_name}</div>}
                              {res.crew_sound_name && <div><Mic size={16} strokeWidth={1.75} color="var(--accent)" /> סאונד: {res.crew_sound_name}</div>}
                            </div>
                            {res.production_reason && (
                              <div style={{ background: "rgba(245,166,35,0.07)", border: "1px solid rgba(245,166,35,0.25)", borderRadius: 10, padding: "10px 14px", marginTop: 8 }}>
                                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--accent)", marginBottom: 4 }}>📝 סיבת ההפקה</div>
                                <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{res.production_reason}</div>
                              </div>
                            )}
                            {Array.isArray(res.items) && res.items.length > 0 && (
                              <div style={{ marginTop: 8 }}>
                                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text3)", marginBottom: 4 }}>ציוד מבוקש:</div>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                  {res.items.map((item, idx) => {
                                    const eq = equipment.find(e => String(e.id) === String(item.equipment_id));
                                    return (
                                      <span key={idx} style={{ background: "rgba(155,89,182,0.1)", border: "1px solid rgba(155,89,182,0.25)", borderRadius: 999, padding: "3px 10px", fontSize: 11, fontWeight: 700, color: "#9b59b6" }}>
                                        {eq?.name || item.name || "פריט"} ×{item.quantity}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "flex-start" }}>
                            <button
                              className="btn"
                              onClick={() => approveDhRequest(res)}
                              disabled={approvingId === res.id}
                              style={{ background: "#2ecc71", color: "#fff", border: "none", fontWeight: 800, fontSize: 13, padding: "10px 20px", borderRadius: 10, cursor: "pointer", opacity: approvingId === res.id ? 0.5 : 1 }}
                            >
                              {approvingId === res.id ? "מאשר..." : <><CheckCircle size={16} strokeWidth={1.75} /> אשר</>}
                            </button>
                            <button
                              className="btn"
                              onClick={() => rejectDhRequest(res)}
                              disabled={approvingId === res.id}
                              style={{ background: "rgba(231,76,60,0.12)", color: "#e74c3c", border: "2px solid rgba(231,76,60,0.3)", fontWeight: 800, fontSize: 13, padding: "10px 20px", borderRadius: 10, cursor: "pointer", opacity: approvingId === res.id ? 0.5 : 1 }}
                            >
                              <XCircle size={16} strokeWidth={1.75} /> דחה
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "courses" && (filteredCourseEntries.length === 0 ? (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: 28, textAlign: "center", color: "var(--text2)" }}>
            {lecturerCourseEntries.length === 0
              ? "עדיין לא נמצאו קורסים שמקושרים למרצה הזה."
              : archiveView
                ? (visibleCourseEntries.length === 0
                  ? "אין קורסים בארכיון."
                  : "לא נמצאו קורסים בארכיון שתואמים לחיפוש.")
                : (visibleCourseEntries.length === 0
                  ? "אין קורסים פעילים כרגע. ניתן לעיין בארכיון הקורסים."
                  : "לא נמצאו קורסים שתואמים לחיפוש.")}
          </div>
        ) : (
          filteredCourseEntries.map(({ lesson, sessions, futureSessions, courseKit, futureFallbackSessions, isArchived, lastMeetingISO }) => (
            <div key={lesson.id} style={{ background: "var(--surface)", border: `1px solid ${isArchived ? "rgba(245,166,35,0.35)" : "var(--border)"}`, borderRadius: 18, overflow: "hidden", opacity: isArchived ? 0.96 : 1 }}>
              <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "var(--text)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span>{lesson.name}</span>
                    {isArchived && (
                      <span
                        title={lastMeetingISO ? `מפגש אחרון: ${formatDate(lastMeetingISO)}` : ""}
                        style={{ background: "rgba(245,166,35,0.12)", border: "1px solid rgba(245,166,35,0.4)", color: "var(--accent)", borderRadius: 999, padding: "2px 10px", fontSize: 11, fontWeight: 800 }}
                      >
                        🗂 הסתיים{lastMeetingISO ? ` · ${formatDate(lastMeetingISO)}` : ""}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 4 }}>
                    {lesson.track ? `מסלול: ${lesson.track}` : "ללא מסלול לימודים"}
                    {courseKit ? ` · השאלת קורס: ${courseKit.name}` : " · ללא השאלת קורס"}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                  {(() => {
                    const trackStudents = getStudentsForLesson(lesson);
                    const statusMap = (lesson.studentStatuses && typeof lesson.studentStatuses === "object") ? lesson.studentStatuses : {};
                    const decided = trackStudents.filter((s) => statusMap[s.id] === "passed" || statusMap[s.id] === "failed").length;
                    const win = computeStatusWindow(lesson);
                    return (
                      <>
                        {/* Two primary actions side-by-side. In RTL the first
                            DOM child sits on the right, so '\u05e8\u05e9\u05d9\u05de\u05ea \u05ea\u05dc\u05de\u05d9\u05d3\u05d9\u05dd' is
                            placed first to land to the right of '\u05d9\u05e6\u05d9\u05e8\u05ea \u05d4\u05e9\u05d0\u05dc\u05ea \u05e7\u05d5\u05e8\u05e1'. */}
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => openStudentList(lesson)}
                            style={{ background: "rgba(155,89,182,0.12)", color: "#9b59b6", border: "2px solid rgba(155,89,182,0.4)", fontWeight: 800, fontSize: 13, padding: "8px 14px", borderRadius: 10, cursor: "pointer" }}
                          >
                            🎓 תעודות סיום{trackStudents.length ? ` (${decided}/${trackStudents.length})` : ""}
                          </button>
                          <button
                            className="btn btn-primary"
                            onClick={() => setEditorState({ scope: "course", lessonId: lesson.id })}
                            disabled={!futureSessions.length}
                          >
                            יצירת השאלת קורס
                          </button>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>

              <div style={{ padding: 18 }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: "var(--text2)", marginBottom: 12 }}>מפגשי הקורס</div>
                {sessions.length === 0 ? (
                  <div style={{ color: "var(--text3)", fontSize: 13 }}>עדיין לא הוגדרו מפגשים לקורס הזה.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {sessions.map((session) => {
                      const sessionKit = hasLinkedValue(session.kitId)
                        ? lessonKits.find((kit) => String(kit.id) === String(session.kitId)) || null
                        : null;
                      const inheritedKit = !sessionKit && courseKit ? courseKit : null;
                      const isPast = session._isPast;
                      return (
                        <div key={session._lecturerUid} style={{ background: isPast ? "rgba(0,0,0,0.12)" : "var(--surface2)", border: `1px solid ${isPast ? "rgba(128,128,128,0.15)" : "var(--border)"}`, borderRadius: 14, padding: "14px 16px", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", opacity: isPast ? 0.45 : 1, transition: "opacity 0.15s" }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ fontWeight: 800, color: isPast ? "var(--text3)" : "var(--text)" }}>
                                {formatDate(session.date)} · {session.startTime || "--:--"}-{session.endTime || "--:--"}
                              </div>
                              {isPast && <span style={{ fontSize: 10, fontWeight: 700, background: "rgba(128,128,128,0.2)", color: "var(--text3)", borderRadius: 6, padding: "2px 7px" }}>עבר</span>}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>
                              {session.topic ? `${session.topic} · ` : ""}
                              {session.studioId && studioNameById[String(session.studioId)] ? `כיתה: ${studioNameById[String(session.studioId)]}` : "ללא כיתה משויכת"}
                            </div>
                            <div style={{ fontSize: 12, marginTop: 6, color: isPast ? "var(--text3)" : sessionKit ? "#4ade80" : inheritedKit ? "#f5a623" : "var(--text3)" }}>
                              {sessionKit
                                ? `השאלת מפגש: ${sessionKit.name}`
                                : inheritedKit
                                  ? `יורש מהשאלת הקורס: ${inheritedKit.name}`
                                  : "ללא השאלת מפגש"}
                            </div>
                          </div>
                          <button
                            className="btn"
                            style={sessionKit
                              ? { background: "#15803d", color: "#000", border: "none", fontWeight: 800 }
                              : { background: "#d97706", color: "#000", border: "none", fontWeight: 800 }}
                            onClick={() => setEditorState({ scope: "session", lessonId: lesson.id, sessionUid: session._lecturerUid })}
                            disabled={isPast}
                          >
                            {sessionKit ? "עדכון השאלת מפגש" : "יצירת השאלת מפגש"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))
        ))}

        {/* ── Dept Head Calendar (journal tab) ── */}
        {myDeptHead && activeTab === "journal" && (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, overflow: "hidden" }}>
            <DeptHeadCalendarPage
              reservations={reservations || []}
              kits={kits}
              equipment={equipment}
              siteSettings={siteSettings}
            />
          </div>
        )}

        {/* ── כפתור התנתקות בתחתית ── */}
        <div style={{ display: "flex", justifyContent: "center", paddingBottom: 8 }}>
          <button
            onClick={() => onLogout ? onLogout() : (() => { sessionStorage.removeItem("active_role"); sessionStorage.removeItem("lecturer_portal_user"); window.location.assign("/"); })()}
            style={{ background: "rgba(239,68,68,0.08)", border: "2px solid #ef4444", color: "#ef4444", borderRadius: 10, padding: "10px 32px", fontWeight: 700, fontSize: 15, cursor: "pointer" }}
          >
            התנתקות
          </button>
        </div>
      </div>

      {editorContext && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.68)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 1000 }}>
          <div style={{ width: "min(980px, 100%)", maxHeight: "calc(100vh - 32px)", overflow: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "var(--accent)" }}>
                  {editorContext.type === "course" ? "השאלת קורס" : "השאלת מפגש"}
                </div>
                <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 6 }}>
                  {editorContext.lesson.name}
                  {editorContext.type === "session" && editorContext.session?.date
                    ? ` · ${formatDate(editorContext.session.date)} ${editorContext.session.startTime || ""}-${editorContext.session.endTime || ""}`
                    : ""}
                </div>
              </div>
              <button className="btn btn-secondary" onClick={closeEditor} disabled={saving}>סגירה</button>
            </div>

            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">הערות</label>
              <textarea className="form-textarea" rows={2} value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} placeholder="הערות אופציונליות למרצה/לצוות" />
            </div>

            {lessonKits.length > 0 && (
              <div style={{ marginBottom: 14, padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface2)" }}>
                <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <Backpack size={14} strokeWidth={1.75} /> ערכות שיעור
                  <span style={{ fontSize: 11, color: "var(--text3)", fontWeight: 400 }}>· לחצו על ערכה להוספת הציוד לרשימה</span>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {lessonKits.map((kit) => {
                    const maxCopies = computeMaxKitCopies(kit, availabilityByEquipmentId);
                    const disabled = maxCopies < 1;
                    const isActive = activeKitIds.has(String(kit.id));
                    return (
                      <button
                        key={kit.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => applyKitToDraft(kit, 1)}
                        title={isActive ? "לחץ שוב להסרת ציוד הערכה" : disabled ? "אין מלאי מספיק לעותק שלם" : `זמינים עד ${maxCopies} עותקים`}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 20,
                          border: `2px solid ${disabled ? "var(--border)" : isActive ? "var(--green)" : "var(--accent)"}`,
                          background: disabled ? "transparent" : isActive ? "rgba(46,204,113,0.14)" : "var(--accent-glow)",
                          color: disabled ? "var(--text3)" : isActive ? "var(--green)" : "var(--accent)",
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: disabled ? "not-allowed" : "pointer",
                          opacity: disabled ? 0.5 : 1,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          transition: "all 0.15s",
                        }}
                      >
                        <Backpack size={12} strokeWidth={1.75} /> {kit.name}
                        {isActive && <span style={{ fontSize: 10, fontWeight: 400 }}>· לחץ להסרה</span>}
                        {!isActive && !disabled && maxCopies >= 2 && (
                          <span style={{ fontSize: 10, color: "var(--text3)", fontWeight: 400 }}>· עד {maxCopies}</span>
                        )}
                        {disabled && <span style={{ fontSize: 10, color: "var(--red)", fontWeight: 700 }}>· אין מלאי</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>בחירת ציוד</div>
              <input
                className="form-input"
                style={{ width: 280 }}
                placeholder="חיפוש ציוד לפי שם או קטגוריה"
                value={draftSearch}
                onChange={(event) => setDraftSearch(event.target.value)}
              />
            </div>

            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {[{k:"all",l:<><Package size={16} strokeWidth={1.75} color="var(--accent)" /> הכל</>},{k:"photo",l:"🎥 צילום"},{k:"sound",l:<><Mic size={16} strokeWidth={1.75} color="var(--accent)" /> סאונד</>}].map(({k,l}) => (
                <button key={k} type="button" onClick={() => setEqTypeFilter(k)}
                  style={{ padding: "5px 14px", borderRadius: 20, border: `2px solid ${eqTypeFilter===k ? "var(--accent)" : "var(--border)"}`, background: eqTypeFilter===k ? "var(--accent-glow)" : "transparent", color: eqTypeFilter===k ? "var(--accent)" : "var(--text3)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  {l}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
              <button
                type="button"
                onClick={() => { if (!showSelectedOnly) setSelectedCats([]); setShowSelectedOnly((current) => !current); }}
                style={{ padding: "5px 12px", borderRadius: 20, border: `2px solid ${showSelectedOnly ? "var(--green)" : selectedItems.length > 0 ? "var(--accent)" : "var(--border)"}`, background: showSelectedOnly ? "rgba(46,204,113,0.12)" : selectedItems.length > 0 ? "var(--accent-glow)" : "transparent", color: showSelectedOnly ? "var(--green)" : selectedItems.length > 0 ? "var(--accent)" : "var(--text3)", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", boxShadow: selectedItems.length > 0 && !showSelectedOnly ? "0 0 0 3px rgba(255,193,7,0.15)" : "none", transition: "all 0.2s" }}
              >
                {showSelectedOnly ? <><CheckCircle size={12} strokeWidth={1.75} /> הצג הכל</> : <><CheckCircle size={12} strokeWidth={1.75} /> הצג נבחרים{selectedItems.length > 0 ? ` (${selectedItems.length})` : ""}</>}
              </button>
              <div style={{ width: 1, height: 20, background: "var(--border)", flexShrink: 0 }} />
              {baseCategories.map((category) => {
                const active = selectedCats.includes(category);
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setSelectedCats((current) => current.includes(category) ? current.filter((value) => value !== category) : [...current, category])}
                    style={{ padding: "4px 10px", borderRadius: 20, border: `2px solid ${active ? "var(--accent)" : "var(--border)"}`, background: active ? "var(--accent-glow)" : "transparent", color: active ? "var(--accent)" : "var(--text3)", fontWeight: 700, fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    {category}
                  </button>
                );
              })}
              {selectedCats.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedCats([])}
                  style={{ padding: "4px 8px", borderRadius: 20, border: "1px solid var(--border)", background: "transparent", color: "var(--text3)", fontSize: 11, cursor: "pointer" }}
                >
                  <X size={16} strokeWidth={1.75} color="var(--text3)" /> נקה
                </button>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {visibleEquipmentGroups.map(([category, categoryItems]) => (
                <div key={category}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text3)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                    {category}
                  </div>
                  {categoryItems.map((item) => {
                    const selectedQuantity = getSelectedQuantity(item.id);
                    const availableQuantity = Number(availabilityByEquipmentId[item.id] ?? item.total_quantity ?? 0);
                    const overLimit = selectedQuantity > availableQuantity;
                    const atMax = selectedQuantity >= availableQuantity;
                    const isImage = item.image?.startsWith("data:") || item.image?.startsWith("http");
                    return (
                      <div
                        key={item.id}
                        className="item-row"
                        style={{
                          opacity: availableQuantity === 0 && selectedQuantity === 0 ? 0.45 : 1,
                          borderColor: overLimit ? "rgba(239,68,68,0.45)" : selectedQuantity > 0 ? "rgba(245,166,35,0.32)" : "var(--border)",
                          background: selectedQuantity > 0 ? "rgba(245,166,35,0.06)" : "var(--surface2)",
                        }}
                      >
                        {isImage
                          ? <img src={item.image} alt={item.name} style={{ width: 42, height: 42, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />
                          : <span style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>{item.image || <Package size={28} strokeWidth={1.75} color="var(--accent)" />}</span>}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{item.name}</div>
                          <div style={{ fontSize: 12, color: overLimit ? "#ef4444" : "var(--text3)", marginTop: 4 }}>
                            זמין: <span style={{ color: availableQuantity === 0 ? "var(--red)" : availableQuantity <= 2 ? "var(--yellow)" : "var(--green)", fontWeight: 700 }}>{availableQuantity}</span>
                          </div>
                          {item.notes && (
                            <div style={{ fontSize: 11, color: "var(--yellow)", fontWeight: 600, display: "flex", alignItems: "flex-start", gap: 4, marginTop: 4, lineHeight: 1.4 }}>
                              <Info size={11} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />{item.notes}
                            </div>
                          )}
                          {overLimit && (
                            <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, marginTop: 4 }}>
                              הכמות שנבחרה גבוהה מהמלאי הזמין למפגש הזה.
                            </div>
                          )}
                        </div>
                        {availableQuantity > 0 || selectedQuantity > 0 ? (
                          <div className="qty-ctrl">
                            <button
                              type="button"
                              className="qty-btn"
                              disabled={selectedQuantity <= 0}
                              style={{ opacity: selectedQuantity <= 0 ? 0.35 : 1 }}
                              onClick={() => setItemQuantity(item.id, selectedQuantity - 1)}
                            >
                              −
                            </button>
                            <span className="qty-num">{selectedQuantity}</span>
                            <button
                              type="button"
                              className="qty-btn"
                              disabled={atMax}
                              style={{ opacity: atMax ? 0.3 : 1 }}
                              onClick={() => {
                                if (!atMax) setItemQuantity(item.id, Math.min(selectedQuantity + 1, availableQuantity));
                              }}
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          <span className="badge badge-red">לא זמין</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
              {!visibleEquipmentGroups.length && (
                <div style={{ textAlign: "center", color: "var(--text3)", padding: "22px 0", fontSize: 13 }}>
                  {showSelectedOnly ? "לא נבחר ציוד עדיין." : "לא נמצא ציוד שתואם לחיפוש."}
                </div>
              )}
            </div>

            {false && <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))" }}>
              {filteredEquipment.map((item) => {
                const selectedQuantity = getSelectedQuantity(item.id);
                const availableQuantity = Number(availabilityByEquipmentId[item.id] ?? item.total_quantity ?? 0);
                const overLimit = selectedQuantity > availableQuantity;
                return (
                  <div key={item.id} style={{ background: "var(--surface2)", border: overLimit ? "1px solid rgba(239,68,68,0.4)" : "1px solid var(--border)", borderRadius: 14, padding: 14 }}>
                    <div style={{ fontWeight: 800, color: "var(--text)" }}>{item.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>{item.category || "ללא קטגוריה"}</div>
                    <div style={{ fontSize: 12, color: overLimit ? "#ef4444" : "var(--text2)", marginTop: 8 }}>
                      זמין לחלון השיעור: <strong>{availableQuantity}</strong>
                    </div>
                    <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                      <label style={{ fontSize: 12, color: "var(--text3)" }}>כמות</label>
                      <input
                        className="form-input"
                        type="number"
                        min={0}
                        value={selectedQuantity}
                        onChange={(event) => setItemQuantity(item.id, event.target.value)}
                        style={{ width: 100 }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>}

            {!!selectedItems.length && (
              <div style={{ marginTop: 18, padding: "12px 14px", borderRadius: 14, background: "var(--surface2)", border: "1px solid var(--border)" }}>
                <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>ציוד שנבחר</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {selectedItems.map((item) => {
                    const eq = equipment.find((candidate) => String(candidate.id) === String(item.equipment_id));
                    return (
                      <div key={item.equipment_id} style={{ background: "rgba(245,166,35,0.12)", border: "1px solid rgba(245,166,35,0.26)", borderRadius: 999, padding: "6px 10px", fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 8 }}>
                        {eq?.name || item.name || "פריט"} · {item.quantity}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {editorError && (
              <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 12, background: "rgba(231,76,60,0.1)", border: "1px solid rgba(231,76,60,0.28)", color: "#ef4444", fontSize: 13, fontWeight: 700 }}>
                <XCircle size={16} strokeWidth={1.75} /> {editorError}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
              <button className="btn btn-secondary" onClick={closeEditor} disabled={saving}>ביטול</button>
              <button className="btn btn-primary" onClick={handleSaveLoan} disabled={saving}>
                {saving ? "שומר..." : (editorContext.currentKit ? "עדכון השאלת שיעור" : "יצירת השאלת שיעור")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Student-status modal (lecturer marks each student passed/failed) ── */}
      {studentListLessonId && (() => {
        const lesson = lessons.find((l) => String(l.id) === String(studentListLessonId));
        if (!lesson) return null;
        const trackStudents = getStudentsForLesson(lesson);
        const win = computeStatusWindow(lesson);
        const banner = (() => {
          if (!win.lastMeetingDate) {
            return { color: "#8891a8", background: "rgba(136,145,168,0.10)", border: "rgba(136,145,168,0.35)", text: "לקורס זה אין מפגשים מתוזמנים — לא ניתן לחשב חלון עדכון סטטוסים." };
          }
          if (!win.windowOpen) {
            return { color: "#8891a8", background: "rgba(136,145,168,0.10)", border: "rgba(136,145,168,0.35)", text: `ניתן יהיה לעדכן סטטוסים החל מ-${formatDate(win.windowOpensISO)} (7 ימים לפני סיום הקורס).` };
          }
          if (win.isPostEnd) {
            return { color: "#f5a623", background: "rgba(245,166,35,0.10)", border: "rgba(245,166,35,0.4)", text: "הקורס הסתיים. ניתן עדיין לעדכן סטטוסים מאוחרים." };
          }
          return { color: "#2ecc71", background: "rgba(46,204,113,0.10)", border: "rgba(46,204,113,0.4)", text: `ניתן לעדכן סטטוסים עכשיו. סיום הקורס: ${formatDate(win.lastMeetingDate)}.` };
        })();
        const editable = !!win.windowOpen;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.68)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 1000 }}>
            <div style={{ width: "min(820px, 100%)", maxHeight: "calc(100vh - 32px)", overflow: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: "#9b59b6", display: "flex", alignItems: "center", gap: 8 }}>
                    <GraduationCap size={20} strokeWidth={1.75} /> תעודות סיום
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 6 }}>
                    {lesson.name}{lesson.track ? ` · מסלול: ${lesson.track}` : ""}
                  </div>
                </div>
                <button className="btn btn-secondary" onClick={closeStudentList} disabled={savingStudentStatuses}>סגירה</button>
              </div>

              {/* How-it-works explainer — keep short and concrete so the
                  lecturer immediately knows why this matters. */}
              <div style={{ padding: "12px 14px", marginBottom: 12, borderRadius: 12, background: "rgba(155,89,182,0.08)", border: "1px solid rgba(155,89,182,0.3)", color: "var(--text2)", fontSize: 12.5, lineHeight: 1.7 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 800, color: "#9b59b6", marginBottom: 4 }}>
                  <Info size={14} strokeWidth={1.75} /> איך זה עובד?
                </div>
                סמן לכל תלמיד אם <b style={{ color: "#2ecc71" }}>סיים</b> את הקורס בהצלחה או <b style={{ color: "#e74c3c" }}>לא סיים</b>. אחרי שתסמן את כולם ותלחץ "שמירה" — המזכירות תוכל לייצר תעודות גמר רק לתלמידים שסומנו כ"סיים". העדכון נפתח 7 ימים לפני סיום הקורס ונשאר פתוח גם לאחר הסיום ובארכיון הקורסים.
              </div>

              <div style={{ padding: "10px 14px", marginBottom: 14, borderRadius: 12, background: banner.background, border: `1px solid ${banner.border}`, color: banner.color, fontSize: 13, fontWeight: 700 }}>
                {banner.text}
              </div>

              {trackStudents.length === 0 ? (
                <div style={{ padding: "18px 14px", borderRadius: 12, background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text3)", fontSize: 13, textAlign: "center" }}>
                  לא נמצאו תלמידים במסלול הזה. ודא שהקורס משויך למסלול הנכון ושהמסלול מאוכלס בעמוד "סטודנטים".
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "var(--surface2)" }}>
                        <th style={{ textAlign: "right", padding: "10px 12px", color: "var(--text2)", fontWeight: 800, borderBottom: "1px solid var(--border)" }}>שם מלא</th>
                        <th style={{ textAlign: "right", padding: "10px 12px", color: "var(--text2)", fontWeight: 800, borderBottom: "1px solid var(--border)" }}>אימייל</th>
                        <th style={{ textAlign: "right", padding: "10px 12px", color: "var(--text2)", fontWeight: 800, borderBottom: "1px solid var(--border)", width: 200 }}>סטטוס</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trackStudents.map((s) => {
                        const value = studentStatusDraft[s.id] || "";
                        return (
                          <tr key={s.id} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "10px 12px", color: "var(--text)", fontWeight: 700 }}>{s._displayName}</td>
                            <td style={{ padding: "10px 12px", color: "var(--text3)" }}>{s.email || "—"}</td>
                            <td style={{ padding: "10px 12px" }}>
                              <select
                                className="form-select"
                                value={value}
                                disabled={!editable || savingStudentStatuses}
                                onChange={(e) => setStudentStatusDraft((prev) => ({ ...prev, [s.id]: e.target.value }))}
                                style={{ width: "100%" }}
                              >
                                <option value="">אין סטטוס</option>
                                <option value="passed">סיים</option>
                                <option value="failed">לא סיים</option>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
                <button className="btn btn-secondary" onClick={closeStudentList} disabled={savingStudentStatuses}>ביטול</button>
                <button
                  className="btn btn-primary"
                  onClick={saveStudentStatuses}
                  disabled={!editable || savingStudentStatuses || trackStudents.length === 0}
                  style={{ background: "#9b59b6", borderColor: "#9b59b6" }}
                >
                  {savingStudentStatuses ? "שומר..." : "💾 שמירה"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
