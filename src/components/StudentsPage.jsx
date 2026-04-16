// StudentsPage.jsx — student management page (CRUD + import)
import { useEffect, useRef, useState } from "react";
import { storageSet, logActivity } from "../utils.js";
import { Modal } from "./ui.jsx";
import SmartExcelImportButton from "./SmartExcelImportButton.jsx";

const TRACK_LOAN_TYPES = ["פרטית", "הפקה", "סאונד", "קולנוע יומית"];
const TRACK_TYPE_LABELS = { sound: "🎧 הנדסאי סאונד", cinema: "🎬 הנדסאי קולנוע", "": "ללא סיווג" };
const normalizeTrackName = (value = "") => String(value || "").trim();

// Name helpers — support both new {firstName,lastName} shape and legacy {name} records.
// `name` is always kept in sync on write so the rest of the app (cascades, auth sync,
// reservation.student_name lookups) continues to work without changes.
const getDisplayName = (s) => {
  const fn = String(s?.firstName || "").trim();
  const ln = String(s?.lastName || "").trim();
  if (fn || ln) return [fn, ln].filter(Boolean).join(" ");
  return String(s?.name || "").trim();
};
const splitName = (full) => {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") };
};
const getFirstName = (s) => {
  const fn = String(s?.firstName || "").trim();
  if (fn) return fn;
  return splitName(s?.name).firstName;
};
const getLastName = (s) => {
  const ln = String(s?.lastName || "").trim();
  if (ln) return ln;
  // If firstName is present but lastName is missing, assume record was edited with firstName only
  if (String(s?.firstName || "").trim()) return "";
  return splitName(s?.name).lastName;
};
const buildTrackSettings = (students = [], existingTrackSettings = [], explicitTracks = []) => {
  const existing = Array.isArray(existingTrackSettings) ? existingTrackSettings : [];
  const explicitNames = (Array.isArray(explicitTracks) ? explicitTracks : []).map(t => normalizeTrackName(t?.name)).filter(Boolean);
  const studentNames = (students || []).map(student => normalizeTrackName(student?.track)).filter(Boolean);
  const allNames = [...new Set([...explicitNames, ...studentNames])];
  const explicit = Array.isArray(explicitTracks) ? explicitTracks : [];
  return allNames.map((name) => {
    const match = existing.find((setting) => normalizeTrackName(setting?.name) === name);
    const explicitMatch = explicit.find(t => normalizeTrackName(t?.name) === name);
    const allowedLoanTypes = TRACK_LOAN_TYPES.filter((loanType) => Array.isArray(match?.loanTypes) && match.loanTypes.includes(loanType));
    const trackType = explicitMatch?.trackType ?? match?.trackType
      ?? (/סאונד|sound/i.test(name) ? "sound" : /קולנוע|cinema|film/i.test(name) ? "cinema" : "");
    return {
      name,
      loanTypes: allowedLoanTypes.length ? allowedLoanTypes : [...TRACK_LOAN_TYPES],
      trackType,
    };
  });
};

export function StudentsPage({ certifications, setCertifications, showToast, onLogCreated = () => {}, studioBookings = [], setStudioBookings, reservations = [], setReservations }) {
  const { types = [], students = [], tracks: explicitTracks = [] } = certifications;
  const trackSettings = buildTrackSettings(students, certifications?.trackSettings, explicitTracks);
  const [addingStudent, setAddingStudent] = useState(false);
  const [studentForm, setStudentForm] = useState({ firstName:"", lastName:"", email:"", phone:"", track:"" });

  // ── Inline-edit state (replaces modal) ──
  const [editingId,      setEditingId]      = useState(null);
  const [editFirstName,  setEditFirstName]  = useState("");
  const [editLastName,   setEditLastName]   = useState("");
  const [editEmail,      setEditEmail]      = useState("");
  const [editPhone,      setEditPhone]      = useState("");
  const [editTrackInl,   setEditTrackInl]   = useState("");
  const [inlineSaving,   setInlineSaving]   = useState(false);
  const inlineSaveTimeout    = useRef(null);
  const lastSavedDraftRef    = useRef("");
  const lastFailedDraftRef   = useRef("");
  const originalEmailRef     = useRef("");
  const originalNameRef      = useRef("");
  const [editTrack, setEditTrack] = useState(null);
  const [editTrackName, setEditTrackName] = useState("");
  const [editTrackType, setEditTrackType] = useState("");
  const [addingTrack, setAddingTrack] = useState(false);
  const [trackForm, setTrackForm] = useState({ name: "", trackType: "" });
  const [search, setSearch] = useState("");
  const [trackFilter, setTrackFilter] = useState([]);
  const [saving, setSaving] = useState(false);
  const [xlImporting, setXlImporting] = useState(false);
  const xlInputRef = useRef(null);

  const save = async (updatedPatch) => {
    const nextStudents = updatedPatch?.students ?? students;
    const nextTypes = updatedPatch?.types ?? types;
    const nextExplicitTracks = updatedPatch?.tracks ?? (certifications?.tracks ?? []);
    const nextTrackSettings = buildTrackSettings(nextStudents, updatedPatch?.trackSettings ?? certifications?.trackSettings, nextExplicitTracks);
    const updated = {
      ...certifications,
      ...updatedPatch,
      types: nextTypes,
      students: nextStudents,
      tracks: nextExplicitTracks,
      trackSettings: nextTrackSettings,
    };
    setSaving(true);
    setCertifications(updated);
    const r = await storageSet("certifications", updated);
    setSaving(false);
    if(!r.ok) showToast("error","❌ שגיאה בשמירה");
    return r.ok;
  };

  // ── Add track ──
  const addTrack = async () => {
    const name = trackForm.name.trim();
    if (!name) return;
    const currentTracks = certifications?.tracks || [];
    if (currentTracks.some(t => normalizeTrackName(t.name) === name)) {
      showToast("error", "מסלול לימודים בשם זה כבר קיים");
      return;
    }
    if (await save({ tracks: [...currentTracks, { name, trackType: trackForm.trackType || "" }] })) {
      showToast("success", `המסלול "${name}" נוסף`);
      setTrackForm({ name: "", trackType: "" });
      setAddingTrack(false);
    }
  };

  // ── Delete track ──
  const deleteTrack = async (trackName) => {
    const studentsOnTrack = students.filter(s => normalizeTrackName(s.track) === trackName);
    const currentTracks = certifications?.tracks || [];
    if (await save({ tracks: currentTracks.filter(t => normalizeTrackName(t.name) !== trackName) })) {
      showToast("success", `המסלול "${trackName}" הוסר`);
    }
  };

  const handleAiImport = async (newStudents) => {
    const currentStudents = certifications?.students || [];
    const existingEmails = new Set(
      currentStudents.map((s) => String(s?.email || "").trim().toLowerCase()).filter(Boolean)
    );
    const existingNames = new Set(
      currentStudents.map((s) => String(s?.name || "").trim().toLowerCase()).filter(Boolean)
    );
    const seenKeys = new Set();
    const baseId = Date.now();
    const normalizedStudents = (Array.isArray(newStudents) ? newStudents : [])
      .map((student, index) => {
        // Prefer explicit firstName/lastName from AI (שם פרטי + שם משפחה columns);
        // fall back to splitting the combined `name` when only one column exists.
        const rawFirst = String(student?.firstName || "").trim();
        const rawLast  = String(student?.lastName  || "").trim();
        let firstName  = rawFirst;
        let lastName   = rawLast;
        let name       = String(student?.name || "").trim();
        if (!firstName && !lastName && name) {
          const split = splitName(name);
          firstName = split.firstName;
          lastName  = split.lastName;
        }
        if (!name) name = [firstName, lastName].filter(Boolean).join(" ");
        return {
          id: student?.id || `stu_ai_${baseId}_${index}`,
          firstName,
          lastName,
          name,
          email: String(student?.email || "").trim().toLowerCase(),
          phone: String(student?.phone || "").trim(),
          track: String(student?.track || "").trim(),
          certs: typeof student?.certs === "object" && student?.certs ? student.certs : {},
        };
      })
      .filter((student) => {
        if (!student.name) return false;
        // dedup key: prefer email, fallback to name
        const key = student.email?.includes("@") ? student.email : student.name.toLowerCase();
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        // skip if already exists (by email OR by name)
        if (student.email?.includes("@") && existingEmails.has(student.email)) return false;
        if (!student.email?.includes("@") && existingNames.has(student.name.toLowerCase())) return false;
        return true;
      });

    const total = Array.isArray(newStudents) ? newStudents.length : 0;
    const skippedCount = total - normalizedStudents.length;

    if (!normalizedStudents.length) {
      if (skippedCount > 0) {
        showToast("warning", `כל ${skippedCount} הסטודנטים כבר קיימים במערכת.`);
      } else {
        showToast("error", "לא נמצאו סטודנטים תקינים לייבוא.");
      }
      return false;
    }

    if (await save({ types, students: [...currentStudents, ...normalizedStudents] })) {
      const skippedMsg = skippedCount > 0 ? ` · ${skippedCount} דולגו (כבר קיימים)` : "";
      showToast("success", `✅ יובאו ${normalizedStudents.length} סטודנטים${skippedMsg}`);
      return true;
    }
    return false;
  };

  // ── Add student ──
  const addStudent = async () => {
    const { firstName, lastName, email, phone } = studentForm;
    const fn = firstName.trim();
    const ln = lastName.trim();
    if(!fn || !email.trim()) return;
    if(students.find(s=>s.email?.toLowerCase()===email.toLowerCase().trim())) {
      showToast("error","סטודנט עם מייל זה כבר קיים"); return;
    }
    const id = `stu_${Date.now()}`;
    const fullName = [fn, ln].filter(Boolean).join(" ");
    const newStu = {id, firstName: fn, lastName: ln, name: fullName, email:email.toLowerCase().trim(), phone:phone.trim(), track:studentForm.track.trim(), certs:{}};
    const updated = { types, students:[...students, newStu] };
    if(await save(updated)) {
      showToast("success",`${fullName} נוסף/ה`);
      setStudentForm({firstName:"",lastName:"",email:"",phone:"",track:""});
      setAddingStudent(false);
      const caller = JSON.parse(sessionStorage.getItem("staff_user")||"{}");
      logActivity({ user_id: caller.id, user_name: caller.full_name, action: "student_add", entity: "student", entity_id: id, details: { name: newStu.name, email: newStu.email } });
    }
  };

  // ── Delete student ──
  const deleteStudent = async (stuId) => {
    const stu = students.find(s => s.id === stuId);
    if (!stu) return;
    const stuName = getDisplayName(stu);
    const stuEmail = (stu.email || "").toLowerCase().trim();
    const updated = { types, students: students.filter(s=>s.id!==stuId) };
    if(await save(updated)) {
      // Cascade: delete studio bookings for this student
      if (setStudioBookings) {
        const filteredBookings = studioBookings.filter(b => b.studentName !== stuName);
        if (filteredBookings.length !== studioBookings.length) {
          setStudioBookings(filteredBookings);
          await storageSet("studio_bookings", filteredBookings);
        }
      }
      // Cascade: delete non-returned reservations for this student
      if (setReservations) {
        const filteredRes = reservations.filter(r => {
          if (r.status === "הוחזר") return true;
          const matchName = r.student_name === stuName;
          const matchEmail = stuEmail && (r.email || "").toLowerCase().trim() === stuEmail;
          return !(matchName || matchEmail);
        });
        if (filteredRes.length !== reservations.length) {
          setReservations(filteredRes);
          await storageSet("reservations", filteredRes);
        }
      }
      showToast("success","הסטודנט הוסר");
      // Part A.3: remove the Supabase Auth user as well, so a deleted student
      // cannot reuse their old credentials to re-enter the portal. This is
      // fire-and-forget — the store deletion is already committed, and the
      // server gatekeeper (`delete-student-auth`) re-verifies that the email
      // is no longer present in certifications.students before removing it.
      if (stuEmail) {
        fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete-student-auth", email: stuEmail }),
        })
          .then((r) => r.json().catch(() => ({})))
          .then((j) => {
            if (j && j.ok === false && j.code !== "no_auth_user") {
              console.warn("delete-student-auth failed:", j);
            }
          })
          .catch((err) => console.warn("delete-student-auth error:", err));
      }
      const caller = JSON.parse(sessionStorage.getItem("staff_user")||"{}");
      const logId = await logActivity({ user_id: caller.id, user_name: caller.full_name, action: "student_delete", entity: "student", entity_id: String(stuId), details: { name: stu?.name || stuId } });
      onLogCreated(logId);
    }
  };

  // ── Inline-edit helpers ──
  const clearInlineSaveTimeout = () => { clearTimeout(inlineSaveTimeout.current); };

  const buildDraft = () => {
    const fn = String(editFirstName || "").trim();
    const ln = String(editLastName  || "").trim();
    return {
      firstName: fn,
      lastName:  ln,
      name:  [fn, ln].filter(Boolean).join(" "),
      email: String(editEmail || "").trim().toLowerCase(),
      phone: String(editPhone || "").trim(),
      track: String(editTrackInl || "").trim(),
    };
  };

  const getDraftKey = (d) => [d.firstName, d.lastName, d.email, d.phone, d.track].join("\u0001");

  const isDirty = (stu, d) => {
    const prev = {
      firstName: String(stu?.firstName || "").trim(),
      lastName:  String(stu?.lastName  || "").trim(),
    };
    // If stu has no firstName/lastName yet (legacy), derive from name for comparison
    if (!prev.firstName && !prev.lastName) {
      const split = splitName(stu?.name);
      prev.firstName = split.firstName;
      prev.lastName  = split.lastName;
    }
    return (
      prev.firstName                                     !== d.firstName ||
      prev.lastName                                      !== d.lastName  ||
      String(stu?.email || "").trim().toLowerCase()      !== d.email     ||
      String(stu?.phone || "").trim()                    !== d.phone     ||
      String(stu?.track || "").trim()                    !== d.track
    );
  };

  const openInlineEdit = (stu) => {
    clearInlineSaveTimeout();
    lastSavedDraftRef.current  = "";
    lastFailedDraftRef.current = "";
    setInlineSaving(false);
    setEditingId(stu.id);
    // Prefer new fields; fallback to splitting legacy `name`
    let fn = String(stu.firstName || "").trim();
    let ln = String(stu.lastName  || "").trim();
    if (!fn && !ln) {
      const split = splitName(stu.name);
      fn = split.firstName;
      ln = split.lastName;
    }
    setEditFirstName(fn);
    setEditLastName(ln);
    setEditEmail(stu.email || "");
    setEditPhone(stu.phone || "");
    setEditTrackInl(stu.track || "");
    originalEmailRef.current = String(stu.email || "").trim().toLowerCase();
    originalNameRef.current  = [fn, ln].filter(Boolean).join(" ");
  };

  // Fire-and-forget: push admin edits (name / email) to the Supabase Auth user.
  // This keeps the student's login credentials aligned with the admin table,
  // which is the single source of truth. Failures are logged but never block
  // the admin UI — the store update has already succeeded by this point.
  const syncStudentAuthUser = async (oldEmail, newEmail, newName) => {
    const o = String(oldEmail || "").trim().toLowerCase();
    const n = String(newEmail || "").trim().toLowerCase();
    const name = String(newName || "").trim();
    if (!o || !n) return;
    if (o === n && name === originalNameRef.current) return; // nothing changed
    try {
      const resp = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync-student-auth", oldEmail: o, newEmail: n, newName: name }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok && j?.code !== "no_auth_user") {
        console.warn("sync-student-auth failed:", j);
      }
    } catch (err) {
      console.warn("sync-student-auth error:", err);
    }
  };

  const saveInlineEdit = async (stu, { closeOnSuccess = false, silent = false } = {}) => {
    clearInlineSaveTimeout();
    if (!stu) { if (closeOnSuccess) setEditingId(null); return true; }

    const draft = buildDraft();
    const key   = getDraftKey(draft);

    if (!isDirty(stu, draft)) {
      lastSavedDraftRef.current = key;
      lastFailedDraftRef.current = "";
      if (closeOnSuccess) setEditingId(null);
      return true;
    }

    if (!draft.firstName) { if (!silent) showToast("error", "שם פרטי הוא שדה חובה"); return false; }
    if (!draft.email || !draft.email.includes("@")) { if (!silent) showToast("error", "נדרש אימייל תקין"); return false; }

    const dup = students.find(s => s.email === draft.email && s.id !== stu.id);
    if (dup) { if (!silent) showToast("error", "מייל זה כבר קיים לסטודנט אחר"); return false; }

    setInlineSaving(true);
    const updatedStudents = students.map(s => s.id === stu.id ? { ...s, ...draft } : s);
    const ok = await save({ types, students: updatedStudents });
    setInlineSaving(false);

    if (!ok) {
      lastFailedDraftRef.current = key;
      showToast("error", "שגיאה בעדכון. הנתונים לא נשמרו.");
      return false;
    }

    lastSavedDraftRef.current = key;
    lastFailedDraftRef.current = "";
    // Propagate name/email change to Supabase Auth user (fire-and-forget).
    // Must happen after the store save succeeded, because sync-student-auth
    // only accepts an email that's already present in certifications.students.
    const prevEmail = originalEmailRef.current;
    const prevName  = originalNameRef.current;
    if (prevEmail && (prevEmail !== draft.email || prevName !== draft.name)) {
      void syncStudentAuthUser(prevEmail, draft.email, draft.name);
    }
    originalEmailRef.current = draft.email;
    originalNameRef.current  = draft.name;
    if (!silent) showToast("success", "פרטי הסטודנט עודכנו");
    if (closeOnSuccess) setEditingId(null);
    const caller = JSON.parse(sessionStorage.getItem("staff_user") || "{}");
    logActivity({ user_id: caller.id, user_name: caller.full_name, action: "student_edit", entity: "student", entity_id: String(stu.id), details: { name: draft.name } });
    return true;
  };

  const closeInlineEdit = async (stu) => {
    await saveInlineEdit(stu, { closeOnSuccess: false, silent: true });
    setEditingId(null);
  };

  const startEdit = async (stu) => {
    if (editingId === stu.id) { await closeInlineEdit(stu); return; }
    if (editingId) {
      const cur = students.find(s => s.id === editingId);
      await saveInlineEdit(cur, { closeOnSuccess: false, silent: true });
      setEditingId(null);
    }
    openInlineEdit(stu);
  };

  const editingStudent = editingId ? students.find(s => s.id === editingId) : null;

  // Auto-save debounce — 700ms after last keystroke (mirrors LecturersPage)
  useEffect(() => {
    clearInlineSaveTimeout();
    if (!editingStudent || inlineSaving) return;
    const draft = buildDraft();
    const key   = getDraftKey(draft);
    if (!draft.firstName || !isDirty(editingStudent, draft)) return;
    if (lastSavedDraftRef.current === key || lastFailedDraftRef.current === key) return;
    inlineSaveTimeout.current = setTimeout(() => {
      void saveInlineEdit(editingStudent, { closeOnSuccess: false, silent: true });
    }, 700);
    return () => clearInlineSaveTimeout();
  }, [editingStudent, editFirstName, editLastName, editEmail, editPhone, editTrackInl, inlineSaving]);



  const openTrackEditor = (trackName) => {
    const trackObj = (certifications?.tracks || []).find(t => normalizeTrackName(t.name) === trackName);
    setEditTrack(trackName);
    setEditTrackName(trackName);
    setEditTrackType(trackObj?.trackType || "");
  };

  const saveTrackEdit = async () => {
    const previousTrackName = normalizeTrackName(editTrack);
    const nextTrackName = normalizeTrackName(editTrackName);
    if (!previousTrackName || !nextTrackName) {
      showToast("error", "יש למלא שם מסלול לימודים");
      return;
    }
    if (previousTrackName !== nextTrackName && trackSettings.some((setting) => normalizeTrackName(setting.name) === nextTrackName)) {
      showToast("error", "מסלול לימודים בשם זה כבר קיים");
      return;
    }
    const updatedStudents = students.map((student) => (
      normalizeTrackName(student.track) === previousTrackName
        ? { ...student, track: nextTrackName }
        : student
    ));
    const updatedTrackSettings = trackSettings.map((setting) => (
      normalizeTrackName(setting.name) === previousTrackName
        ? { ...setting, name: nextTrackName }
        : setting
    ));
    const currentExplicitTracks = certifications?.tracks || [];
    const existsInExplicit = currentExplicitTracks.some(t => normalizeTrackName(t.name) === previousTrackName);
    const updatedExplicitTracks = existsInExplicit
      ? currentExplicitTracks.map(t => normalizeTrackName(t.name) === previousTrackName ? { ...t, name: nextTrackName, trackType: editTrackType } : t)
      : [...currentExplicitTracks, { name: nextTrackName, trackType: editTrackType }];
    if (await save({ types, students: updatedStudents, trackSettings: updatedTrackSettings, tracks: updatedExplicitTracks })) {
      showToast("success", `המסלול עודכן`);
      setTrackFilter((current) => {
        if (!Array.isArray(current) || !current.includes(previousTrackName)) return current;
        return [...new Set(current.map((tn) => tn === previousTrackName ? nextTrackName : tn))];
      });
      setEditTrack(null);
      setEditTrackName("");
      setEditTrackType("");
    }
  };

  // ── Import XL (AI) — used by SmartExcelImportButton ──
  const importXL = async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    setXlImporting(true);
    e.target.value = "";
    try {
      const isXlsx = /\.xlsx?$/i.test(file.name);
      const processRows = async (rows) => {
        if(!rows.length) { showToast("error","הקובץ ריק"); setXlImporting(false); return; }
        const headers = rows[0].map(h=>{
          let s = String(h||"").trim();
          s = s.replace(/[\uFEFF\u200B-\u200D\u00A0]/g,"");
          return s.toLowerCase();
        });
        const nameIdx  = headers.findIndex(h=>h.includes("שם")||h.includes("name"));
        const emailIdx = headers.findIndex(h=>h.includes("מייל")||h.includes("mail")||h.includes("email")||h.includes("אימייל")||h.includes("e-mail")||h.includes("@"));
        const phoneIdx = headers.findIndex(h=>h.includes("טלפון")||h.includes("phone")||h.includes("tel")||h.includes("נייד")||h.includes("מספר"));
        const trackIdx = headers.findIndex(h=>h.includes("מסלול")||h.includes("קבוצה")||h.includes("כיתה")||h.includes("track")||h.includes("group")||h.includes("class"));
        if(emailIdx===-1) {
          const autoEmailIdx = rows[1] ? rows[1].findIndex(c=>String(c||"").includes("@")) : -1;
          if(autoEmailIdx<0) { showToast("error",`לא נמצאה עמודת מייל. כותרות: "${headers.join('", "')}"`); setXlImporting(false); return; }
        }
        const eIdx = emailIdx >= 0 ? emailIdx : rows[1].findIndex(c=>String(c||"").includes("@"));
        let added=0, skipped=0;
        const newStudents = [...students];
        for(let i=1;i<rows.length;i++) {
          const row = rows[i];
          const email = String(row[eIdx]||"").toLowerCase().trim();
          const name  = nameIdx>=0 ? String(row[nameIdx]||"").trim() : "";
          const phone = phoneIdx>=0 ? String(row[phoneIdx]||"").trim() : "";
          if(!email||!email.includes("@")) { skipped++; continue; }
          if(newStudents.find(s=>s.email===email)) { skipped++; continue; }
          const track = trackIdx>=0 ? String(rows[i][trackIdx]||"").trim() : "";
          const fullName = name || email;
          const split = splitName(fullName);
          newStudents.push({ id:`stu_${Date.now()}_${i}`, firstName: split.firstName, lastName: split.lastName, name: fullName, email, phone, track, certs:{} });
          added++;
        }
        const updated = { types, students: newStudents };
        if(await save(updated)) showToast("success", `✅ יובאו ${added} סטודנטים${skipped>0?` · ${skipped} דולגו`:""}`);
        setXlImporting(false);
      };

      if(isXlsx) {
        if(!window.XLSX) {
          await new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
            s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
          });
        }
        const buf = await file.arrayBuffer();
        const wb  = window.XLSX.read(buf, { type:"array" });
        const ws  = wb.Sheets[wb.SheetNames[0]];
        const rows = window.XLSX.utils.sheet_to_json(ws, { header:1, defval:"" });
        await processRows(rows);
      } else {
        const reader = new FileReader();
        reader.onload = async (ev) => {
          try {
            const text = ev.target.result;
            const lines = text.split(/\r?\n/).filter(l=>l.trim());
            const sep = lines[0]?.includes("\t") ? "\t" : ",";
            const rows = lines.map(l=>l.split(sep).map(c=>c.trim().replace(/^"|"$/g,"")));
            await processRows(rows);
          } catch { showToast("error","שגיאה בקריאת הקובץ"); setXlImporting(false); }
        };
        reader.readAsText(file, "UTF-8");
      }
    } catch(err) {
      console.error("importXL error:", err);
      showToast("error","שגיאה בייבוא הקובץ");
      setXlImporting(false);
    }
  };

  // ── Import XL Basic (no AI) — supports multi-sheet ──
  const [xlBasicImporting, setXlBasicImporting] = useState(false);

  const importXLBasic = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    setXlBasicImporting(true);

    const ensureXLSX = () => !window.XLSX ? new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    }) : Promise.resolve();

    const detectHeaders = (rows) => {
      // Find the first row that looks like a header (contains recognizable column names)
      for (let ri = 0; ri < Math.min(rows.length, 5); ri++) {
        const normalized = rows[ri].map(h => String(h||"").trim().replace(/[\uFEFF\u200B-\u200D\u00A0]/g,"").toLowerCase());
        // Separate first-name / last-name detection — must be checked BEFORE generic "שם"
        const firstNameIdx = normalized.findIndex(h =>
          h.includes("שם פרטי") || h === "פרטי" || h.includes("first") || h.includes("firstname") || h.includes("given"));
        const lastNameIdx  = normalized.findIndex(h =>
          h.includes("שם משפחה") || h.includes("משפחה") || h.includes("last") || h.includes("lastname") || h.includes("surname") || h.includes("family"));
        // Generic name column — fallback when the sheet uses a single "שם" / "שם מלא" column.
        // Exclude the already-matched firstName/lastName indices so we don't re-pick them.
        const nameIdx = normalized.findIndex((h, idx) =>
          idx !== firstNameIdx && idx !== lastNameIdx &&
          (h.includes("שם") || h.includes("name")));
        const emailIdx = normalized.findIndex(h=>h.includes("מייל")||h.includes("mail")||h.includes("email")||h.includes("אימייל")||h.includes("e-mail"));
        const phoneIdx = normalized.findIndex(h=>h.includes("טלפון")||h.includes("phone")||h.includes("tel")||h.includes("נייד")||h.includes("מספר"));
        const trackIdx = normalized.findIndex(h=>h.includes("מסלול")||h.includes("קבוצה")||h.includes("כיתה")||h.includes("track")||h.includes("group")||h.includes("class"));
        if (firstNameIdx >= 0 || lastNameIdx >= 0 || nameIdx >= 0 || emailIdx >= 0) {
          return { headerRow: ri, firstNameIdx, lastNameIdx, nameIdx, emailIdx, phoneIdx, trackIdx };
        }
      }
      return null;
    };

    const processSheet = (rows, sheetName, newStudents) => {
      if (!rows.length) return { added: 0, skipped: 0 };
      const detected = detectHeaders(rows);
      if (!detected) return { added: 0, skipped: 0 };
      const { headerRow, firstNameIdx, lastNameIdx, nameIdx, emailIdx, phoneIdx, trackIdx } = detected;

      // Try to find email column by scanning data rows if not found in headers
      let eIdx = emailIdx;
      if (eIdx < 0 && rows[headerRow + 1]) {
        eIdx = rows[headerRow + 1].findIndex(c => String(c||"").includes("@"));
      }
      if (eIdx < 0) return { added: 0, skipped: 0 };

      let added = 0, skipped = 0;
      for (let i = headerRow + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.every(c => !String(c||"").trim())) continue; // skip empty rows
        const email = String(row[eIdx]||"").toLowerCase().trim();
        if (!email || !email.includes("@")) { skipped++; continue; }
        if (newStudents.find(s => s.email === email)) { skipped++; continue; }

        // ── Name handling: three supported layouts ──
        //  A) Explicit firstName + lastName columns → use as-is
        //  B) Only firstName column (no lastName) → treat as a single name; split on first space
        //  C) Generic "שם" / "שם מלא" column → split on first space (backward compat)
        let firstName = "";
        let lastName  = "";
        if (firstNameIdx >= 0 && lastNameIdx >= 0) {
          firstName = String(row[firstNameIdx]||"").trim();
          lastName  = String(row[lastNameIdx]||"").trim();
        } else {
          const raw = firstNameIdx >= 0
            ? String(row[firstNameIdx]||"").trim()
            : nameIdx >= 0 ? String(row[nameIdx]||"").trim() : "";
          const sp = splitName(raw);
          firstName = sp.firstName;
          lastName  = sp.lastName;
        }
        const fullName = [firstName, lastName].filter(Boolean).join(" ") || email;
        const phone = phoneIdx >= 0 ? String(row[phoneIdx]||"").trim() : "";
        // Track: use cell value; fallback to sheet name if empty
        let track = trackIdx >= 0 ? String(row[trackIdx]||"").trim() : "";
        if (!track) track = sheetName || "";
        newStudents.push({
          id: `stu_${Date.now()}_${i}_${Math.random().toString(36).slice(2,6)}`,
          firstName,
          lastName,
          name: fullName,
          email, phone, track, certs: {},
        });
        added++;
      }
      return { added, skipped };
    };

    try {
      const isXlsx = /\.xlsx?$/i.test(file.name);
      const newStudents = [...students];
      let totalAdded = 0, totalSkipped = 0;

      if (isXlsx) {
        await ensureXLSX();
        const buf = await file.arrayBuffer();
        const wb = window.XLSX.read(buf, { type: "array" });
        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
          const { added, skipped } = processSheet(rows, sheetName, newStudents);
          totalAdded += added;
          totalSkipped += skipped;
        }
      } else {
        // CSV / TSV — single sheet
        const text = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = ev => res(ev.target.result);
          reader.onerror = rej;
          reader.readAsText(file, "UTF-8");
        });
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        const sep = lines[0]?.includes("\t") ? "\t" : ",";
        const rows = lines.map(l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, "")));
        const { added, skipped } = processSheet(rows, "", newStudents);
        totalAdded += added;
        totalSkipped += skipped;
      }

      if (totalAdded === 0 && totalSkipped === 0) {
        showToast("error", "לא נמצאו שורות תקינות לייבוא — ודא שיש עמודת מייל בקובץ");
      } else {
        const updated = { types, students: newStudents };
        if (await save(updated)) {
          showToast("success", `✅ יובאו ${totalAdded} סטודנטים${totalSkipped > 0 ? ` · ${totalSkipped} דולגו` : ""}`);
        }
      }
    } catch (err) {
      console.error("importXLBasic error:", err);
      showToast("error", "שגיאה בייבוא הקובץ");
    } finally {
      setXlBasicImporting(false);
    }
  };

  const downloadSampleFile = () => {
    const csv = [
      "שם פרטי,שם משפחה,אימייל,טלפון,מסלול לימודים",
      "נועה,כהן,noa.cohen@example.com,0501234567,הנדסאי סאונד א",
      "יואב,לוי,yoav.levi@example.com,0527654321,הנדסאי קולנוע א",
    ].join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "תבנית_ייבוא_סטודנטים.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  // ── Filtering ──
  const allTracks = ["הכל", ...trackSettings.map((setting) => setting.name)];
  const allTracksSelected = !trackFilter.length;
  const isTrackSelected = (trackName) => trackName === "הכל" ? allTracksSelected : trackFilter.includes(trackName);
  const toggleTrackFilter = (trackName) => {
    if (trackName === "הכל") {
      setTrackFilter([]);
      return;
    }
    setTrackFilter((current) => (
      current.includes(trackName)
        ? current.filter((item) => item !== trackName)
        : [...current, trackName]
    ));
  };
  const filteredStudents = students
    .filter(s=>{
      const display = getDisplayName(s);
      return (allTracksSelected || trackFilter.includes(s.track||"")) &&
        (!search || display.includes(search) || s.email?.includes(search) || s.phone?.includes(search));
    })
    .sort((a, b) => {
      const ta = a.track || "";
      const tb = b.track || "";
      if (ta !== tb) {
        if (!ta) return 1;
        if (!tb) return -1;
        return ta.localeCompare(tb, "he");
      }
      // Same track — sort alphabetically by first letter of first name (Hebrew-aware)
      return getFirstName(a).localeCompare(getFirstName(b), "he");
    });

  const closeAddModal = () => { setAddingStudent(false); setStudentForm({firstName:"",lastName:"",email:"",phone:"",track:""}); };

  return (
    <div className="page" style={{direction:"rtl"}}>

      {/* ── Add student modal ── */}
      {addingStudent && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px"}}
          onClick={e=>e.target===e.currentTarget&&closeAddModal()}>
          <div style={{width:"100%",maxWidth:480,background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",direction:"rtl",boxShadow:"0 8px 32px rgba(0,0,0,0.5)"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:"1px solid var(--border)",background:"var(--surface2)",borderRadius:"16px 16px 0 0"}}>
              <div style={{fontWeight:900,fontSize:16}}>➕ הוספת סטודנט</div>
              <button className="btn btn-secondary btn-sm" onClick={closeAddModal}>✕</button>
            </div>
            <div style={{padding:"20px"}}>
              <div className="grid-2" style={{marginBottom:12}}>
                <div className="form-group"><label className="form-label">שם פרטי *</label>
                  <input className="form-input" autoFocus value={studentForm.firstName} onChange={e=>setStudentForm(p=>({...p,firstName:e.target.value}))}
                    onKeyDown={e=>e.key==="Enter"&&addStudent()} placeholder="שם פרטי"/></div>
                <div className="form-group"><label className="form-label">שם משפחה</label>
                  <input className="form-input" value={studentForm.lastName} onChange={e=>setStudentForm(p=>({...p,lastName:e.target.value}))}
                    onKeyDown={e=>e.key==="Enter"&&addStudent()} placeholder="שם משפחה"/></div>
              </div>
              <div className="grid-2" style={{marginBottom:12}}>
                <div className="form-group"><label className="form-label">אימייל *</label>
                  <input className="form-input" type="email" value={studentForm.email} onChange={e=>setStudentForm(p=>({...p,email:e.target.value}))}
                    onKeyDown={e=>e.key==="Enter"&&addStudent()} placeholder="email@example.com"/></div>
                <div className="form-group"><label className="form-label">טלפון</label>
                  <input className="form-input" value={studentForm.phone} onChange={e=>setStudentForm(p=>({...p,phone:e.target.value}))} placeholder="05x-xxxxxxx"/></div>
              </div>
              <div className="form-group"><label className="form-label">מסלול לימודים</label>
                <select className="form-input" value={studentForm.track||""} onChange={e=>setStudentForm(p=>({...p,track:e.target.value}))}>
                  <option value="">-- בחר מסלול --</option>
                  {trackSettings.map(s=><option key={s.name} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
                <button className="btn btn-secondary" onClick={closeAddModal}>ביטול</button>
                <button className="btn btn-primary" disabled={!studentForm.firstName.trim()||!studentForm.email.trim()||saving} onClick={addStudent}>
                  {saving?"⏳ שומר...":"✅ הוסף סטודנט"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{display:"flex",gap:10,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
        <button className="btn btn-primary" onClick={()=>setAddingStudent(true)}>➕ הוספת סטודנט</button>
          <button className="btn btn-secondary" onClick={()=>setAddingTrack(true)}>🎓 הוסף מסלול</button>
          <label className="btn btn-secondary" style={{cursor:xlBasicImporting?"not-allowed":"pointer",opacity:xlBasicImporting?0.6:1,marginBottom:0}}>
            {xlBasicImporting ? "⏳ מייבא..." : "📊 ייבוא XL"}
            <input type="file" accept=".csv,.tsv,.xls,.xlsx" style={{display:"none"}} onChange={importXLBasic} disabled={xlBasicImporting}/>
          </label>
          <SmartExcelImportButton showToast={showToast} onImportSuccess={handleAiImport} />
          <div className="search-bar" style={{flex:1,minWidth:180}}><span>🔍</span>
            <input placeholder="חיפוש לפי שם, מייל או טלפון..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
          <span style={{fontSize:13,color:"var(--text3)"}}>סה״כ: <strong style={{color:"var(--text)"}}>{filteredStudents.length}</strong> / {students.length}</span>
        </div>
        {allTracks.length>1&&(
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
            {allTracks.map(t=>(
              <button key={t} type="button" onClick={()=>toggleTrackFilter(t)}
                style={{padding:"4px 12px",borderRadius:20,border:`2px solid ${isTrackSelected(t)?"var(--accent)":"var(--border)"}`,background:isTrackSelected(t)?"var(--accent-glow)":"transparent",color:isTrackSelected(t)?"var(--accent)":"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                {t==="הכל"?"📦 כל המסלולים":"🎓 "+t}
              </button>
            ))}
          </div>
        )}
        {allTracks.length>1 && (
          <div style={{fontSize:11,color:"var(--text3)",marginTop:-4,marginBottom:12}}>
            💡 אפשר לבחור כמה מסלולי לימוד יחד כדי להציג אותם במקביל.
          </div>
        )}
        {trackSettings.length>0 && (
          <div style={{marginBottom:16,padding:"12px 14px",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)"}}>
            <div style={{fontSize:12,fontWeight:800,color:"var(--accent)",marginBottom:8}}>ניהול מסלולי לימודים</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {trackSettings.map((setting) => {
                const tObj = (certifications?.tracks||[]).find(t=>normalizeTrackName(t.name)===setting.name);
                const tType = tObj?.trackType||"";
                const tLabel = tType==="sound"?"🎧 סאונד":tType==="cinema"?"🎬 קולנוע":null;
                return (
                  <div key={setting.name} onClick={()=>openTrackEditor(setting.name)}
                    style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 10px",borderRadius:20,border:"1px solid var(--border)",background:"var(--surface3)",cursor:"pointer",transition:"border-color 0.15s"}}
                    onMouseEnter={e=>e.currentTarget.style.borderColor="var(--accent)"}
                    onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}>
                    <span style={{fontSize:12,fontWeight:700,color:"var(--text2)"}}>🎓 {setting.name}</span>
                    {tLabel && <span style={{fontSize:11,fontWeight:700,color:"var(--accent)",background:"rgba(99,102,241,0.12)",borderRadius:10,padding:"1px 7px"}}>{tLabel}</span>}
                    <span style={{fontSize:11,color:"var(--text3)"}}>✏️</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      {/* ── Students list ── */}
      <style>{`
        .students-table .students-row td {
          transition: background-color 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
        }
        .students-table .students-row:hover td {
          background: rgba(245, 166, 35, 0.14);
          border-bottom-color: rgba(245, 166, 35, 0.28);
        }
        .students-table .students-row:hover td:last-child {
          box-shadow: inset 4px 0 0 var(--accent);
        }
      `}</style>

      {filteredStudents.length===0 && !addingStudent ? (
        <div className="empty-state"><div className="emoji">👨‍🎓</div><p>{search?"לא נמצאו סטודנטים":"לא נוספו סטודנטים עדיין"}</p></div>
      ) : (
        <>
          {/* Desktop — table */}
          <div className="cert-desktop" style={{overflowX:"auto",borderRadius:"var(--r)",border:"1px solid var(--border)"}}>
            <table className="students-table" style={{width:"100%",borderCollapse:"collapse",minWidth:620,direction:"rtl",tableLayout:"fixed"}}>
              <colgroup>
                <col style={{width:"13%"}}/>
                <col style={{width:"13%"}}/>
                <col style={{width:"26%"}}/>
                <col style={{width:"14%"}}/>
                <col style={{width:"26%"}}/>
                <col style={{width:"8%"}}/>
              </colgroup>
              <thead>
                <tr style={{background:"var(--surface2)",borderBottom:"2px solid var(--border)"}}>
                  <th style={thS}>שם פרטי</th>
                  <th style={thS}>שם משפחה</th>
                  <th style={thS}>אימייל</th>
                  <th style={thS}>טלפון</th>
                  <th style={thS}>מסלול לימודים</th>
                  <th style={{...thS,textAlign:"center"}}></th>
                </tr>
              </thead>
              <tbody>
                {(()=>{
                  const rows=[]; let lastTrack=undefined;
                  const inpS = { padding:"4px 8px", fontSize:13, height:32, borderRadius:6, border:"1px solid var(--border)", background:"var(--surface)", color:"var(--text)", width:"100%", minWidth:0 };
                  filteredStudents.forEach((s,i)=>{
                    const t=s.track||"";
                    if(t!==lastTrack){
                      rows.push(
                        <tr key={`grp_${t}_${i}`}>
                          <td colSpan={6} style={{background:"rgba(245,166,35,0.06)",padding:"5px 14px",fontWeight:800,fontSize:11,color:"var(--accent)",borderBottom:"1px solid var(--border)",letterSpacing:0.5}}>
                            {t?"🎓 "+t:"📋 ללא מסלול"}
                          </td>
                        </tr>
                      );
                      lastTrack=t;
                    }
                    const isEditing = editingId === s.id;
                    if (isEditing) {
                      rows.push(
                        <tr key={s.id}
                          style={{background:"rgba(245,166,35,0.06)",borderBottom:"1px solid var(--border)",cursor:"pointer"}}
                          onClick={()=>void startEdit(s)}>
                          <td style={{...tdS,padding:"4px 8px"}}>
                            <input style={{...inpS,fontWeight:700}} value={editFirstName} autoFocus placeholder="שם פרטי"
                              onClick={e=>e.stopPropagation()}
                              onChange={e=>setEditFirstName(e.target.value)}/>
                          </td>
                          <td style={{...tdS,padding:"4px 8px"}}>
                            <input style={{...inpS,fontWeight:700}} value={editLastName} placeholder="שם משפחה"
                              onClick={e=>e.stopPropagation()}
                              onChange={e=>setEditLastName(e.target.value)}/>
                          </td>
                          <td style={{...tdS,padding:"4px 8px"}}>
                            <input style={{...inpS,fontWeight:700,fontSize:14}} type="email" value={editEmail}
                              onClick={e=>e.stopPropagation()}
                              onChange={e=>setEditEmail(e.target.value)}/>
                          </td>
                          <td style={{...tdS,padding:"4px 8px"}}>
                            <input style={inpS} value={editPhone}
                              onClick={e=>e.stopPropagation()}
                              onChange={e=>setEditPhone(e.target.value)}/>
                          </td>
                          <td style={{...tdS,padding:"4px 8px"}}>
                            <select style={{...inpS}} value={editTrackInl}
                              onClick={e=>e.stopPropagation()}
                              onChange={e=>setEditTrackInl(e.target.value)}>
                              <option value="">-- ללא מסלול --</option>
                              {trackSettings.map(ts=><option key={ts.name} value={ts.name}>{ts.name}</option>)}
                            </select>
                          </td>
                          <td style={{...tdS,width:48}}/>
                        </tr>
                      );
                    } else {
                      rows.push(
                        <tr key={s.id} className="students-row"
                          onClick={()=>void startEdit(s)}
                          style={{borderBottom:"1px solid var(--border)",cursor:"pointer"}}>
                          <td style={{...tdS,fontWeight:700,fontSize:14}}>{getFirstName(s) || <span style={{color:"var(--text3)"}}>—</span>}</td>
                          <td style={{...tdS,fontWeight:700,fontSize:14}}>{getLastName(s) || <span style={{color:"var(--text3)"}}>—</span>}</td>
                          <td style={{...tdS,fontWeight:700,fontSize:14,overflow:"hidden",textOverflow:"ellipsis"}}>{s.email || <span style={{color:"var(--text3)"}}>—</span>}</td>
                          <td style={{...tdS,fontSize:12,color:"var(--text3)"}}>{s.phone||"—"}</td>
                          <td style={tdS}>
                            {s.track
                              ? <span style={{background:"rgba(245,166,35,0.1)",border:"1px solid rgba(245,166,35,0.3)",borderRadius:20,padding:"3px 10px",fontSize:11,color:"var(--accent)",fontWeight:700}}>🎓 {s.track}</span>
                              : <span style={{fontSize:11,color:"var(--text3)"}}>—</span>}
                          </td>
                          <td style={{...tdS,width:80,textAlign:"center"}} onClick={e=>e.stopPropagation()}>
                            <button className="btn btn-secondary btn-sm" style={{color:"var(--red)",borderColor:"var(--red)",padding:"3px 8px"}}
                              onClick={()=>deleteStudent(s.id)}>🗑️</button>
                          </td>
                        </tr>
                      );
                    }
                  });
                  return rows;
                })()}
              </tbody>
            </table>
          </div>

          {/* Mobile — cards (inline edit on tap) */}
          <div className="cert-mobile" style={{flexDirection:"column",gap:10}}>
            {filteredStudents.map(s=>{
              const isEditing = editingId === s.id;
              return isEditing ? (
                <div key={s.id}
                  style={{background:"rgba(245,166,35,0.06)",border:"1px solid rgba(245,166,35,0.3)",borderRadius:"var(--r)",padding:"14px 16px",direction:"rtl",cursor:"pointer"}}
                  onClick={()=>void startEdit(s)}>
                  <div style={{display:"flex",flexDirection:"column",gap:8}} onClick={e=>e.stopPropagation()}>
                    <div style={{display:"flex",gap:8}}>
                      <input className="form-input" style={{flex:1,minWidth:0}} placeholder="שם פרטי" value={editFirstName} autoFocus onChange={e=>setEditFirstName(e.target.value)}/>
                      <input className="form-input" style={{flex:1,minWidth:0}} placeholder="שם משפחה" value={editLastName} onChange={e=>setEditLastName(e.target.value)}/>
                    </div>
                    <input className="form-input" placeholder="אימייל" type="email" value={editEmail} onChange={e=>setEditEmail(e.target.value)}/>
                    <input className="form-input" placeholder="טלפון" value={editPhone} onChange={e=>setEditPhone(e.target.value)}/>
                    <select className="form-input" value={editTrackInl} onChange={e=>setEditTrackInl(e.target.value)}>
                      <option value="">-- ללא מסלול --</option>
                      {trackSettings.map(ts=><option key={ts.name} value={ts.name}>{ts.name}</option>)}
                    </select>
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:10,alignItems:"center"}} onClick={e=>e.stopPropagation()}>
                    {inlineSaving && <span style={{fontSize:12,color:"var(--text3)"}}>⏳ שומר...</span>}
                    <button className="btn btn-secondary btn-sm" onClick={()=>void closeInlineEdit(s)}>✕ סגור</button>
                    <button className="btn btn-secondary btn-sm" style={{color:"var(--red)",borderColor:"var(--red)",marginRight:"auto"}}
                      onClick={()=>{deleteStudent(s.id);setEditingId(null);}}>🗑️</button>
                  </div>
                </div>
              ) : (
                <div key={s.id} onClick={()=>void startEdit(s)}
                  style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"14px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,transition:"background 0.16s"}}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(245,166,35,0.08)"}
                  onMouseLeave={e=>e.currentTarget.style.background="var(--surface)"}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:800,fontSize:15}}>{getDisplayName(s)}</div>
                    {s.track&&<div style={{fontSize:11,color:"var(--accent)",fontWeight:700}}>🎓 {s.track}</div>}
                    <div style={{fontSize:15,fontWeight:800,marginTop:2,wordBreak:"break-all"}}>{s.email}</div>
                    {s.phone&&<div style={{fontSize:11,color:"var(--text3)"}}>{s.phone}</div>}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                    <button className="btn btn-secondary btn-sm" style={{color:"var(--red)",borderColor:"var(--red)",padding:"4px 8px",fontSize:15}}
                      onClick={e=>{e.stopPropagation();deleteStudent(s.id);}}>🗑️</button>
                    <span style={{fontSize:18,color:"var(--text3)"}}>✏️</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {editTrack && (
        <Modal
          title="✏️ עריכת מסלול לימודים"
          onClose={()=>{ setEditTrack(null); setEditTrackName(""); setEditTrackType(""); }}
          footer={(
            <div style={{display:"flex",justifyContent:"space-between",width:"100%",flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",gap:8}}>
                <button className="btn btn-primary" onClick={saveTrackEdit} disabled={!editTrackName.trim() || saving}>
                  {saving ? "⏳ שומר..." : "💾 שמור"}
                </button>
                <button className="btn btn-secondary" onClick={()=>{ setEditTrack(null); setEditTrackName(""); setEditTrackType(""); }}>
                  ביטול
                </button>
              </div>
              <button className="btn btn-secondary" style={{color:"var(--red)",borderColor:"var(--red)"}} disabled={saving}
                onClick={async()=>{ if(confirm(`למחוק את המסלול "${editTrack}"?`)){await deleteTrack(editTrack);setEditTrack(null);setEditTrackName("");setEditTrackType("");} }}>
                🗑️ מחק מסלול
              </button>
            </div>
          )}
        >
          <div className="form-group">
            <label className="form-label">שם מסלול לימודים</label>
            <input className="form-input" value={editTrackName} onChange={e=>setEditTrackName(e.target.value)} placeholder="שם המסלול"/>
          </div>
          <div className="form-group" style={{marginBottom:0}}>
            <label className="form-label">סיווג מסלול</label>
            <select className="form-input" value={editTrackType} onChange={e=>setEditTrackType(e.target.value)}>
              <option value="">ללא סיווג</option>
              <option value="sound">🎧 הנדסאי סאונד</option>
              <option value="cinema">🎬 הנדסאי קולנוע</option>
            </select>
          </div>
        </Modal>
      )}
      {addingTrack && (
        <Modal
          title="🎓 הוספת מסלול לימודים"
          onClose={()=>{ setAddingTrack(false); setTrackForm({ name:"", trackType:"" }); }}
          footer={(
            <>
              <button className="btn btn-primary" onClick={addTrack} disabled={!trackForm.name.trim() || saving}>
                {saving ? "⏳ שומר..." : "✅ הוסף מסלול"}
              </button>
              <button className="btn btn-secondary" onClick={()=>{ setAddingTrack(false); setTrackForm({ name:"", trackType:"" }); }}>
                ביטול
              </button>
            </>
          )}
        >
          <div className="form-group">
            <label className="form-label">שם מסלול לימודים *</label>
            <input className="form-input" value={trackForm.name} onChange={e=>setTrackForm(p=>({...p,name:e.target.value}))} placeholder='למשל: "הנדסאי קולנוע ב"'/>
          </div>
          <div className="form-group" style={{marginBottom:0}}>
            <label className="form-label">סיווג מסלול</label>
            <select className="form-input" value={trackForm.trackType} onChange={e=>setTrackForm(p=>({...p,trackType:e.target.value}))}>
              <option value="">ללא סיווג</option>
              <option value="sound">🎧 הנדסאי סאונד</option>
              <option value="cinema">🎬 הנדסאי קולנוע</option>
            </select>
            <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>הסיווג קובע לאיזה סטודנטים יוצגו אולפנים שמשויכים לסוג מסלול זה.</div>
          </div>
        </Modal>
      )}
    </div>
  );
}

const thS = { padding:"10px 14px", textAlign:"right", fontWeight:800, fontSize:13, color:"var(--text2)", whiteSpace:"nowrap" };
const tdS = { padding:"0 14px", whiteSpace:"nowrap", overflow:"hidden", height:48, verticalAlign:"middle" };
