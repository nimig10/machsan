import { supabase } from '../supabaseClient.js';
import { useEffect, useMemo, useState } from "react";
import { formatDate, getAvailable, normalizeName, storageSet, storageGet, updateReservationStatus } from "../utils.js";
import { statusBadge } from "./ui.jsx";
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

function getCourseLinkedKit(lesson, lessonKits = []) {
  if (!lesson) return null;
  if (hasLinkedValue(lesson.kitId)) {
    return lessonKits.find((kit) => String(kit.id) === String(lesson.kitId)) || null;
  }
  return lessonKits.find((kit) => kit.kitType === "lesson" && hasLinkedValue(kit.lessonId) && String(kit.lessonId) === String(lesson.id)) || null;
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
  const [editorState, setEditorState] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftItems, setDraftItems] = useState([]);
  const [draftSearch, setDraftSearch] = useState("");
  const [selectedCats, setSelectedCats] = useState([]);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [saving, setSaving] = useState(false);

  const activeLecturers = useMemo(
    () => lecturers.filter((lecturer) => lecturer?.isActive !== false),
    [lecturers],
  );
  const lessonKits = useMemo(
    () => kits.filter((kit) => kit?.kitType === "lesson"),
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
      // Local state + blob cache refresh (non-blocking for UI feedback).
      const freshRes = await (supabase.from("reservations_new").select("*, reservation_items(*)").then(res => (res.data || []).map(r => ({ ...r, items: r.reservation_items || [] }))));
      const all = Array.isArray(freshRes) ? freshRes : reservations;
      const updated = all.map(r => String(r.id) === String(res.id) ? { ...r, status: newStatus } : r);
      if (setReservations) setReservations(updated);
      storageSet("reservations", updated).catch(err =>
        console.warn("blob cache refresh failed (DB is already updated):", err)
      );
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
        return {
          lesson,
          sessions,
          courseKit,
          fallbackSessions,
          futureFallbackSessions,
          nextSession,
        };
      })
      .sort((a, b) => {
        const aStamp = a.nextSession ? `${a.nextSession.date} ${a.nextSession.startTime || ""}` : `9999 ${a.lesson.name || ""}`;
        const bStamp = b.nextSession ? `${b.nextSession.date} ${b.nextSession.startTime || ""}` : `9999 ${b.lesson.name || ""}`;
        return aStamp.localeCompare(bStamp, "he");
      });
  }, [lecturerLessons, lessonKits]);

  const filteredCourseEntries = useMemo(() => {
    let entries = lecturerCourseEntries;
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
  }, [lecturerCourseEntries, search, courseFilter]);

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
        validationSessions: entry.futureFallbackSessions,
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
    setDraftName(
      String(sourceKit?.name || "").trim()
      || buildDefaultKitName(editorContext.lesson, editorContext.type, editorContext.session),
    );
    setDraftDescription(String(sourceKit?.description || "").trim());
    setDraftItems(
      (sourceKit?.items || [])
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
  }, [editorContext]);

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
    if (!term) return sorted;
    return sorted.filter((item) => {
      const haystack = `${item?.name || ""} ${item?.category || ""} ${item?.description || ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [draftSearch, equipment]);

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
      kitType: "lesson",
      name: draftName.trim(),
      instructorName: currentLecturer.fullName || editorContext.lesson.instructorName || "",
      instructorPhone: String(currentLecturer.phone || editorContext.lesson.instructorPhone || "").trim(),
      instructorEmail: String(currentLecturer.email || editorContext.lesson.instructorEmail || "").trim(),
      description: draftDescription.trim(),
      items: selectedItems.map((item) => ({
        equipment_id: item.equipment_id,
        quantity: Number(item.quantity) || 0,
        name: equipment.find((candidate) => String(candidate.id) === String(item.equipment_id))?.name || item.name || "",
      })),
      schedule: editorContext.targetSessions.map((session) => ({
        date: session.date,
        startTime: session.startTime || "",
        endTime: session.endTime || "",
      })),
      ...(editorContext.type === "course" ? { lessonId: currentKit?.lessonId ?? editorContext.lesson.id } : {}),
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
        schedule: (lesson.schedule || []).map((session, index) => (
          getSessionUid(session, index) === editorContext.session._lecturerUid
            ? { ...session, kitId: nextKitId }
            : session
        )),
      };
    });

    setSaving(true);
    setEditorError("");

    const kitsResult = await storageSet("kits", nextKits);
    if (!kitsResult?.ok) {
      setSaving(false);
      setEditorError("שמירת ערכת השיעור נכשלה. הנתונים לא נשמרו.");
      return;
    }

    const lessonsResult = await storageSet("lessons", nextLessons);
    if (!lessonsResult?.ok) {
      await storageSet("kits", kits);
      setSaving(false);
      setEditorError("שמירת הקישור לקורס/מפגש נכשלה. בוצע ביטול לשינוי בערכה.");
      return;
    }

    setKits(nextKits);
    setLessons(nextLessons);
    setSaving(false);
    setEditorState(null);
    showToast(
      "success",
      editorContext.type === "course"
        ? "השאלת הקורס נשמרה ותתעדכן דרך מסלול השיעור הקיים."
        : "השאלת המפגש נשמרה ותתעדכן דרך מסלול השיעור הקיים.",
    );
  };

  if (!loggedInLecturer || !currentLecturer) {
    return (
      <div className="form-page" style={{ "--accent": siteSettings.accentColor || "#f5a623" }}>
        <div style={{ width: "100%", maxWidth: 430, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "40px 32px", textAlign: "center", direction: "rtl" }}>
          {siteSettings.logo
            ? <img src={siteSettings.logo} alt="לוגו" style={{ width: 82, height: 82, objectFit: "contain", borderRadius: 12, marginBottom: 16, display: "block", marginInline: "auto" }} />
            : <div style={{ fontSize: 48, marginBottom: 16 }}>🎓</div>}
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
            : <div style={{ fontSize: 48, marginBottom: 16 }}>🎓</div>}
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

          {loginError && <div style={{ color: "var(--red)", fontSize: 13, fontWeight: 700, marginBottom: 12 }}>❌ {loginError}</div>}

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
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: lecturerCourseEntries.length > 1 ? 14 : 0 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 900, color: "var(--accent)", marginBottom: 4 }}>פורטל מרצה</div>
              <div style={{ fontSize: 14, color: "var(--text2)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>שלום, {currentLecturer?.fullName || loggedInLecturer.fullName}</span>
                {myDeptHead?.role && (
                  <span style={{ background: "rgba(155,89,182,0.12)", border: "1px solid rgba(155,89,182,0.35)", color: "#9b59b6", borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 800 }}>
                    🎓 {myDeptHead.role}
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
          {/* Course filter pills — only shown when there are 2+ courses */}
          {activeTab === "courses" && lecturerCourseEntries.length > 1 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingTop: 2 }}>
              {["הכל", ...lecturerCourseEntries.map(e => e.lesson?.name).filter(Boolean)].map(name => {
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
                { id: "courses", label: "📚 הקורסים שלי" },
                { id: "journal", label: "🎓 יומן השאלות תלמידים" },
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
                <div style={{ fontSize: 18, fontWeight: 900, color: "#9b59b6" }}>🎓 אישור בקשות השאלה — ראש מחלקה</div>
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
                  ✅ אין בקשות הממתינות לאישורך כרגע
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {pendingDhRequests.map(res => {
                    const LOAN_ICONS = { "פרטית": "👤", "הפקה": "🎬", "סאונד": "🎙️", "קולנוע יומית": "🎥", "שיעור": "📚" };
                    return (
                      <div key={res.id} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                          <div style={{ flex: 1, minWidth: 200 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                              <div style={{ fontWeight: 900, fontSize: 15, color: "var(--text)" }}>{res.student_name}</div>
                              {statusBadge(res.status)}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.8 }}>
                              <div>{LOAN_ICONS[res.loan_type] || "📦"} סוג: <strong>{res.loan_type}</strong></div>
                              {res.project_name && <div>🎬 פרויקט: {res.project_name}</div>}
                              <div>📅 {formatDate(res.borrow_date)}{res.borrow_time ? ` ${res.borrow_time}` : ""} — {formatDate(res.return_date)}{res.return_time ? ` ${res.return_time}` : ""}</div>
                              {res.email && <div>📧 {res.email}</div>}
                              {res.phone && <div>📞 {res.phone}</div>}
                              {res.crew_photographer_name && <div>📸 צלם: {res.crew_photographer_name}</div>}
                              {res.crew_sound_name && <div>🎙️ סאונד: {res.crew_sound_name}</div>}
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
                              {approvingId === res.id ? "⏳ מאשר..." : "✅ אשר"}
                            </button>
                            <button
                              className="btn"
                              onClick={() => rejectDhRequest(res)}
                              disabled={approvingId === res.id}
                              style={{ background: "rgba(231,76,60,0.12)", color: "#e74c3c", border: "2px solid rgba(231,76,60,0.3)", fontWeight: 800, fontSize: 13, padding: "10px 20px", borderRadius: 10, cursor: "pointer", opacity: approvingId === res.id ? 0.5 : 1 }}
                            >
                              ❌ דחה
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
              : "לא נמצאו קורסים שתואמים לחיפוש."}
          </div>
        ) : (
          filteredCourseEntries.map(({ lesson, sessions, courseKit, futureFallbackSessions }) => (
            <div key={lesson.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, overflow: "hidden" }}>
              <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "var(--text)" }}>{lesson.name}</div>
                  <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 4 }}>
                    {lesson.track ? `מסלול: ${lesson.track}` : "ללא מסלול לימודים"}
                    {courseKit ? ` · השאלת קורס: ${courseKit.name}` : " · ללא השאלת קורס"}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                  <button
                    className="btn btn-primary"
                    onClick={() => setEditorState({ scope: "course", lessonId: lesson.id })}
                    disabled={!futureFallbackSessions.length}
                  >
                    {courseKit ? "עדכון השאלת קורס" : "יצירת השאלת קורס"}
                  </button>
                  <div style={{ fontSize: 11, color: "var(--text3)", maxWidth: 320, textAlign: "right" }}>
                    {futureFallbackSessions.length
                      ? `חל על ${futureFallbackSessions.length} מפגשים עתידיים בלי השאלה ספציפית.`
                      : "אין כרגע מפגשים עתידיים פנויים להשאלת קורס."}
                  </div>
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
                            className="btn btn-secondary"
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

            <div style={{ background: "rgba(245,166,35,0.08)", border: "1px solid rgba(245,166,35,0.28)", borderRadius: 14, padding: "12px 14px", fontSize: 12, color: "var(--text2)", marginBottom: 18 }}>
              {editorContext.type === "course"
                ? "השאלת קורס מתחברת למסלול השיעור הקיים בדיוק כמו היום. היא תחול רק על מפגשים שאין להם השאלת מפגש ספציפית, ותמשיך לעבור דרך מנגנון lesson loan הקיים."
                : "השאלת מפגש יוצרת השאלת שיעור רק למפגש הספציפי הזה, ומחליפה באותו מפגש בלבד כל השאלת קורס שיורשת אליו."}
            </div>

            {editorError && (
              <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 12, background: "rgba(231,76,60,0.1)", border: "1px solid rgba(231,76,60,0.28)", color: "#ef4444", fontSize: 13, fontWeight: 700 }}>
                ❌ {editorError}
              </div>
            )}

            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="form-label">שם ההשאלה</label>
              <input className="form-input" value={draftName} onChange={(event) => setDraftName(event.target.value)} />
            </div>

            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">הערות</label>
              <textarea className="form-textarea" rows={2} value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} placeholder="הערות אופציונליות למרצה/לצוות" />
            </div>

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

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
              <button
                type="button"
                onClick={() => setShowSelectedOnly((current) => !current)}
                style={{ padding: "5px 12px", borderRadius: 20, border: `2px solid ${showSelectedOnly ? "var(--green)" : "var(--border)"}`, background: showSelectedOnly ? "rgba(46,204,113,0.12)" : "transparent", color: showSelectedOnly ? "var(--green)" : "var(--text3)", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}
              >
                {showSelectedOnly ? "✅ נבחרו" : "⬜"} {showSelectedOnly ? "הצג הכל" : "הצג נבחרים בלבד"}
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
                  ✕ נקה
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
                          : <span style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>{item.image || "📦"}</span>}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{item.name}</div>
                          <div style={{ fontSize: 12, color: overLimit ? "#ef4444" : "var(--text3)", marginTop: 4 }}>
                            זמין: <span style={{ color: availableQuantity === 0 ? "var(--red)" : availableQuantity <= 2 ? "var(--yellow)" : "var(--green)", fontWeight: 700 }}>{availableQuantity}</span>
                          </div>
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

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
              <button className="btn btn-secondary" onClick={closeEditor} disabled={saving}>ביטול</button>
              <button className="btn btn-primary" onClick={handleSaveLoan} disabled={saving}>
                {saving ? "שומר..." : (editorContext.currentKit ? "עדכון השאלת שיעור" : "יצירת השאלת שיעור")}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
