import { useEffect, useMemo, useState } from "react";
import { formatDate, getAvailable, normalizeName, storageSet } from "../utils.js";

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

function normalizeLecturerIdentifier(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.includes("@") ? raw.toLowerCase() : digitsOnly(raw);
}

function lecturerMatchesLogin(lecturer, name, identifier) {
  if (normalizeName(lecturer?.fullName) !== normalizeName(name)) return false;
  const lecturerEmail = String(lecturer?.email || "").trim().toLowerCase();
  const lecturerPhone = digitsOnly(lecturer?.phone || "");
  if (!lecturerEmail && !lecturerPhone) return true;
  if (!identifier) return false;
  return identifier === lecturerEmail || identifier === lecturerPhone;
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
  showToast,
  siteSettings = {},
}) {
  const [loginForm, setLoginForm] = useState({ name: "", identifier: "" });
  const [loginError, setLoginError] = useState("");
  const [loggedInLecturer, setLoggedInLecturer] = useState(() => {
    try {
      const stored = sessionStorage.getItem("lecturer_portal_user");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [search, setSearch] = useState("");
  const [editorState, setEditorState] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftItems, setDraftItems] = useState([]);
  const [draftSearch, setDraftSearch] = useState("");
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

  useEffect(() => {
    if (loggedInLecturer) {
      sessionStorage.setItem("lecturer_portal_user", JSON.stringify(loggedInLecturer));
      return;
    }
    sessionStorage.removeItem("lecturer_portal_user");
  }, [loggedInLecturer]);

  useEffect(() => {
    if (!loggedInLecturer || currentLecturer) return;
    setLoggedInLecturer(null);
    setEditorState(null);
    setLoginError("רשומת המרצה כבר לא זמינה. צריך להתחבר מחדש.");
  }, [currentLecturer, loggedInLecturer]);

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
    const term = String(search || "").trim().toLowerCase();
    if (!term) return lecturerCourseEntries;
    return lecturerCourseEntries.filter(({ lesson, courseKit }) => {
      const haystack = [
        lesson?.name,
        lesson?.track,
        lesson?.description,
        courseKit?.name,
      ].map((value) => String(value || "").toLowerCase()).join(" ");
      return haystack.includes(term);
    });
  }, [lecturerCourseEntries, search]);

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

  const handleLogin = () => {
    const normalizedIdentifier = normalizeLecturerIdentifier(loginForm.identifier);
    const matchedLecturer = activeLecturers.find((lecturer) => lecturerMatchesLogin(lecturer, loginForm.name, normalizedIdentifier));
    if (!matchedLecturer) {
      setLoginError("לא נמצאה התאמה למרצה פעיל במערכת. אפשר להתחבר רק עם מרצה שקיים ברובריקת המרצים.");
      return;
    }
    setLoginError("");
    setLoggedInLecturer({
      id: matchedLecturer.id,
      fullName: matchedLecturer.fullName,
    });
  };

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
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 900, color: "var(--accent)", marginBottom: 4 }}>פורטל מרצה</div>
              <div style={{ fontSize: 14, color: "var(--text2)" }}>שלום, {currentLecturer?.fullName || loggedInLecturer.fullName}</div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                className="form-input"
                style={{ width: 260 }}
                placeholder="חיפוש קורס לפי שם או מסלול"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setLoggedInLecturer(null);
                  setEditorState(null);
                }}
              >
                התנתקות
              </button>
            </div>
          </div>
        </div>
        {filteredCourseEntries.length === 0 ? (
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
                      return (
                        <div key={session._lecturerUid} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 16px", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontWeight: 800, color: "var(--text)" }}>
                              {formatDate(session.date)} · {session.startTime || "--:--"}-{session.endTime || "--:--"}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>
                              {session.topic ? `${session.topic} · ` : ""}
                              {session.studioId && studioNameById[String(session.studioId)] ? `כיתה: ${studioNameById[String(session.studioId)]}` : "ללא כיתה משויכת"}
                            </div>
                            <div style={{ fontSize: 12, marginTop: 6, color: sessionKit ? "#4ade80" : inheritedKit ? "#f5a623" : "var(--text3)" }}>
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
                            disabled={session._isPast}
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
        )}
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

            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))" }}>
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
            </div>

            {!!selectedItems.length && (
              <div style={{ marginTop: 18, padding: "12px 14px", borderRadius: 14, background: "var(--surface2)", border: "1px solid var(--border)" }}>
                <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>ציוד שנבחר</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {selectedItems.map((item) => {
                    const eq = equipment.find((candidate) => String(candidate.id) === String(item.equipment_id));
                    return (
                      <div key={item.equipment_id} style={{ background: "rgba(245,166,35,0.12)", border: "1px solid rgba(245,166,35,0.26)", borderRadius: 999, padding: "6px 10px", fontSize: 12, fontWeight: 700 }}>
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
