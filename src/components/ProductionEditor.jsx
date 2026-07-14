// ProductionEditor — modal for creating/editing a production (לוח הפקות).
// Director-only. Sections: title + description, dates, crew, status CTA + delete.

import { useMemo, useState, useRef, useEffect } from "react";
import { Plus, Trash2, Send, AlertTriangle, ExternalLink } from "lucide-react";
import { Modal } from "./ui.jsx";
import { upsertProduction, notifyProductionCrewInvites, publishProduction, deleteProduction, autoApproveDirectorCrew } from "../utils/productionsApi.js";
import { isLegacyProduction, submittedDateIds } from "../utils/productionVisibility.js";

// Only photographer + sound are predefined: the equipment-loan certification
// check (crewIsCertifiedForEq) validates exactly these two roles, so they
// must be registered students. Any other crew (producer, assistant, color,
// gaffer…) is added freely via "תפקיד מותאם".
const ROLE_LABELS = {
  photographer: "צלם ראשי",
  sound:        "איש סאונד",
};
const ROLE_ORDER = ["photographer","sound"];
const REQUIRES_STUDENT = new Set(["photographer","sound"]);

// Color palette — taken from existing LOAN_TYPE_COLORS so it matches the
// app's visual language. Director picks one per production; it's used on
// the production card border and on the calendar block.
const COLOR_PALETTE = [
  "#e67e22",  // כתום
  "#3498db",  // כחול
  "#1abc9c",  // טורקיז
  "#9b59b6",  // סגול
  "#f1c40f",  // צהוב
  "#e74c3c",  // אדום
];
const DEFAULT_COLOR = "#e67e22";
// Yellow highlight shared by every "add" button (+ תאריך / + צלם ראשי /
// + איש סאונד / + תפקיד מותאם) so they read clearly as add actions.
const ADD_BTN_STYLE = { background: "#f5a623", color: "#1a1a1a", border: "1px solid #f5a623", fontWeight: 700 };
function getRoleLabel(c) {
  if (c?.role === "custom") return c.roleLabel || "תפקיד מותאם";
  return ROLE_LABELS[c?.role] || c?.role || "";
}
function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
}
// Time slots — must mirror PublicForm `loan_type="הפקה"` TIME_SLOTS exactly so the
// equipment loan that follows the production can match the borrow/return windows.
// Source of truth: PublicForm.jsx ~line 3024.
const PRODUCTION_TIME_SLOTS = ["09:00","09:30","14:30","15:00","15:30","16:00","16:30","17:00","17:30"];
function snapToProductionSlot(v) {
  if (!v) return v;
  if (PRODUCTION_TIME_SLOTS.includes(v)) return v;
  // Snap to the nearest valid slot (used when editing legacy data).
  const [h, m] = String(v).split(":").map(n => parseInt(n, 10));
  if (Number.isNaN(h)) return PRODUCTION_TIME_SLOTS[0];
  const target = h * 60 + (m || 0);
  let best = PRODUCTION_TIME_SLOTS[0], bestDiff = Infinity;
  for (const s of PRODUCTION_TIME_SLOTS) {
    const [sh, sm] = s.split(":").map(n => parseInt(n, 10));
    const diff = Math.abs((sh * 60 + sm) - target);
    if (diff < bestDiff) { best = s; bestDiff = diff; }
  }
  return best;
}
function isWeekendISO(dateStr) {
  if (!dateStr) return false;
  const d = new Date(`${dateStr}T00:00:00`);
  return d.getDay() === 5 || d.getDay() === 6;
}
// Earliest legal shoot date = today + 7 days, skipping Fri/Sat. Mirrors the
// equipment-loan form rule for loan_type="הפקה". The number 7 comes from the
// school's "8 days notice" policy where the count is inclusive of both the
// submission day and the shoot day (17/05 + "8 days" → 24/05).
function minShootISO() {
  const d = new Date();
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 7);
  while (d.getDay() === 5 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  // Use local components — toISOString() shifts to UTC which off-by-ones for IDT (+3).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
// "13/07/2026 – 15/07/2026" (or a single date when the range is one day).
function fmtRangeHe(d) {
  const f = (iso) => String(iso || "").split("-").reverse().join("/");
  return d.startDate === d.endDate ? f(d.startDate) : `${f(d.startDate)} – ${f(d.endDate)}`;
}

export function ProductionEditor({ initial, currentStudent, students = [], kits = [], showToast, onClose, onSaved, onDeleted, onOpenLoanForm, onOpenMyReservations, reservations = [] }) {
  const [title, setTitle]             = useState(initial?.title || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [driveUrl, setDriveUrl]       = useState(initial?.driveUrl || "");
  const [color, setColor]             = useState(initial?.color || DEFAULT_COLOR);
  const [selectedKitId, setSelectedKitId] = useState(initial?.kitId || "");
  const [dates, setDates]             = useState(() => Array.isArray(initial?.dates) ? initial.dates : []);
  const [crew, setCrew]               = useState(() => {
    // Legacy zombie guard: self-join requests (invited_by='self') that were
    // never approved belong to the removed join/approval flow — hide them here;
    // the next save's crew diff deletes their DB rows. Approved self rows
    // (joined under the old mechanism) are kept as regular crew.
    const existing = (Array.isArray(initial?.crew) ? initial.crew : [])
      .filter(c => !((c.invitedBy || "director") === "self" && c.status !== "approved"));
    if (existing.length > 0) return existing;
    // New production: seed with a photographer row — minimum crew required to take equipment out.
    return [{
      id: genId("pc"),
      role: "photographer",
      roleLabel: null,
      studentId: null,
      freeTextName: null,
      status: "invited",
      invitedBy: "director",
      crewEmail: null,
      notes: "",
    }];
  });
  const [saving, setSaving]           = useState(false);
  const [publishing, setPublishing]   = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [postSavePrompt, setPostSavePrompt] = useState(null); // { blob, pending: [dateRange] } | null
  const [errorField, setErrorField]   = useState(null);
  const [customRolePrompt, setCustomRolePrompt] = useState({ open: false, value: "" });
  const descriptionRef = useRef(null);
  useEffect(() => {
    const ta = descriptionRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [description]);

  const isNew = !initial?.id;
  // IMPORTANT: stabilize productionId across re-renders. If we recompute
  // `genId("prod")` every render, a failed publish retry would insert a NEW
  // row each time (root cause of the "3 duplicates created" bug).
  const [productionId] = useState(() => initial?.id || genId("prod"));
  // True once the production exists in the DB (existing on open, or after the
  // first successful persist). Gates the on-close pruning of list-less ranges —
  // a brand-new production that was never published has nothing to clean up.
  const persistedRef = useRef(!!initial?.id);
  const isPublished = initial?.status === "published";
  // Live (not persisted) check — uses local crew state so the button reflects
  // edits made in this session even before save.
  const hasApprovedPhotographer = crew.some(c => c.role === "photographer" && c.status === "approved" && c.studentId);
  // A photographer is ASSIGNED as soon as a student is picked — even before the
  // save auto-approves the row (status is still 'invited' pre-save). Gates the
  // per-range "הגש רשימת ציוד" shortcut in create mode.
  const hasPhotographerAssigned = crew.some(c => c.role === "photographer" && c.studentId);

  const linkedReservations = useMemo(() =>
    (reservations || []).filter(r => r.production_id === productionId),
    [reservations, productionId]);
  // Per-date-range lock: only the specific date range that already has an
  // active (non-cancelled) equipment-list reservation is locked. Other ranges
  // (and adding new ones) stay editable. Shared helper — also skips 'בוטל'
  // reservations, so cancelling a list re-opens its range for editing.
  const lockedDateIds = useMemo(() =>
    submittedDateIds({ id: productionId }, reservations),
    [reservations, productionId]);
  // Board-gate exemption: productions created before the cutoff keep the old
  // behavior (no pending warnings / post-save prompt). A brand-new production
  // (no `initial`) is always gated.
  const isLegacy = initial ? isLegacyProduction(initial) : false;
  const allDatesLocked = dates.length > 0 && dates.every(d => lockedDateIds.has(String(d.id)));
  // Iron rule: you may add a new date range only once every existing range has a
  // submitted equipment list. This guarantees at most ONE list-less range at any
  // time (the last one added), so submitting a list for one range can never leave
  // a sibling range dangling on the board. Legacy productions are exempt, and the
  // very first range (none yet) is always allowed.
  const canAddDate = isLegacy || dates.length === 0 || allDatesLocked;

  // Kits filtered to those usable for production loans.
  const productionKits = useMemo(
    () => (kits || []).filter(k => Array.isArray(k.loanTypes) && k.loanTypes.includes("הפקה")),
    [kits]
  );
  const selectedKit = useMemo(
    () => productionKits.find(k => String(k.id) === String(selectedKitId)) || null,
    [productionKits, selectedKitId]
  );
  // Legacy: production was bound to a kit whose loanTypes no longer include "הפקה"
  // (or the kit was removed from the production-eligible list). Keep it selectable
  // but flagged so the director knows it's a leftover.
  const legacyKit = useMemo(() => {
    if (selectedKit) return null;
    if (!selectedKitId) return null;
    return (kits || []).find(k => String(k.id) === String(selectedKitId)) || null;
  }, [kits, selectedKitId, selectedKit]);
  const kitFieldLocked = allDatesLocked;

  // Director can't be a crew member of their own production.
  const directorEmailLc = String(initial?.directorEmail || currentStudent?.email || "").toLowerCase();
  const sortedStudents = useMemo(() =>
    [...(students || [])]
      .filter(s => String(s.email || "").toLowerCase() !== directorEmailLc)
      .sort((a,b) => String(a.name||"").localeCompare(String(b.name||""), "he")),
    [students, directorEmailLc]);

  const minShoot = minShootISO();
  function addDate() {
    if (!canAddDate) {
      showToast?.("יש להגיש רשימת ציוד לטווח הקיים לפני הוספת טווח תאריכים נוסף", "error");
      return;
    }
    setDates(prev => [...prev, {
      id: genId("pd"),
      startDate: minShoot,
      startTime: PRODUCTION_TIME_SLOTS[0],   // 09:00
      endDate: minShoot,
      endTime: PRODUCTION_TIME_SLOTS[PRODUCTION_TIME_SLOTS.length - 1], // 17:30
      note: "",
      sortOrder: prev.length,
    }]);
  }
  function updateDate(idx, patch) {
    setDates(prev => prev.map((d,i) => i === idx ? { ...d, ...patch } : d));
  }
  function removeDate(idx) {
    setDates(prev => prev.filter((_,i) => i !== idx));
  }

  function addCrew(role, customLabel = null) {
    setCrew(prev => [...prev, {
      id: genId("pc"),
      role,
      roleLabel: role === "custom" ? (customLabel || "") : null,
      studentId: null,
      freeTextName: REQUIRES_STUDENT.has(role) ? null : "",
      status: "invited",
      invitedBy: "director",
      crewEmail: null,
      notes: "",
    }]);
  }
  function openCustomRolePrompt() {
    setCustomRolePrompt({ open: true, value: "" });
  }
  function confirmCustomRole() {
    const trimmed = customRolePrompt.value.trim().slice(0, 40);
    if (!trimmed) return;
    addCrew("custom", trimmed);
    setCustomRolePrompt({ open: false, value: "" });
  }
  function updateCrew(id, patch) {
    setCrew(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  }
  function removeCrew(id) {
    setCrew(prev => prev.filter(c => c.id !== id));
  }

  function getDirectorInviteCrewIds(nextCrew, { onlyNew } = { onlyNew: true }) {
    const previousById = new Map(
      (Array.isArray(initial?.crew) ? initial.crew : []).map(c => [String(c.id), c])
    );
    return (Array.isArray(nextCrew) ? nextCrew : [])
      .filter(c => {
        if (!c?.id || !c.studentId || !c.crewEmail) return false;
        if ((c.invitedBy || "director") !== "director") return false;
        if (!["invited", "approved"].includes(c.status || "invited")) return false;
        if (!onlyNew) return true;
        const prev = previousById.get(String(c.id));
        if (!prev) return true;
        if (!prev.studentId && !prev.crewEmail) return true;
        const sameStudent = String(prev.studentId || "") === String(c.studentId || "")
          && String(prev.crewEmail || "").toLowerCase() === String(c.crewEmail || "").toLowerCase();
        const roleChanged = String(prev.role || "") !== String(c.role || "")
          || String(prev.roleLabel || "") !== String(c.roleLabel || "");
        return sameStudent && roleChanged;
      })
      .map(c => c.id);
  }

  async function notifyCrewInvites(blob, opts) {
    const crewIds = getDirectorInviteCrewIds(blob?.crew, opts);
    if (crewIds.length === 0) return { ok: true, sent: 0 };
    const res = await notifyProductionCrewInvites(blob.id, crewIds);
    if (!res.ok) {
      console.warn("[ProductionEditor.notifyNewCrewInvites]", res);
      const detail = String(res.error || "").slice(0, 120);
      showToast?.(`ההפקה נשמרה, אבל שליחת מייל הזמנה לצוות נכשלה${detail ? `: ${detail}` : ""}`, "error");
      return { ok: false, sent: 0 };
    }
    if (res.sent > 0) {
      showToast?.("נשלח עדכון במייל לחברי הצוות ששובצו", "success");
    }
    return { ok: true, sent: res.sent || 0 };
  }

  function validate() {
    if (!title.trim()) return { field: "title", message: "חסר כותרת" };
    if (description.length > 800) return { field: "description", message: "תיאור ארוך מ-800 תווים" };
    const url = driveUrl.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      return { field: "drive_url", message: "קישור חייב להתחיל ב-http:// או https://" };
    }
    if (dates.length === 0) return { field: "dates", message: "הוסיפו לפחות תאריך צילום אחד" };
    // Grandfather pre-existing, UNCHANGED past dates so a director can add a NEW
    // future range to an ended production and save it (restore-from-archive flow).
    // New/edited dates still obey the 8-day / weekend / 7-day rules. Overlap and
    // end>start below apply to ALL dates (incl. grandfathered).
    const initialById = new Map(
      (Array.isArray(initial?.dates) ? initial.dates : []).map(d => [String(d.id), d])
    );
    function isGrandfathered(d) {
      const prev = initialById.get(String(d.id));
      if (!prev) return false;
      const unchanged =
        String(prev.startDate) === String(d.startDate) &&
        String(prev.endDate)   === String(d.endDate) &&
        String(prev.startTime) === String(d.startTime) &&
        String(prev.endTime)   === String(d.endTime);
      return unchanged && String(d.startDate) < minShoot;
    }
    for (const d of dates) {
      if (!d.startDate || !d.endDate || !d.startTime || !d.endTime) {
        return { field: "dates", message: "תאריך/שעה חסרים בלוח הצילום" };
      }
      if (!isGrandfathered(d)) {
        if (d.startDate < minShoot) {
          return { field: "dates", message: `תאריך צילום חייב להיות לפחות 9 ימי עבודה מהיום (החל מ-${minShoot})` };
        }
        if (isWeekendISO(d.startDate) || isWeekendISO(d.endDate)) {
          return { field: "dates", message: "שישי/שבת אינם זמינים — המחסן סגור בסופי שבוע" };
        }
        // 7-day max per shoot range — same rule as the equipment loan form for "הפקה".
        const daysDiff = Math.floor((new Date(`${d.endDate}T00:00:00`) - new Date(`${d.startDate}T00:00:00`)) / 86400000);
        if (daysDiff > 6) {
          return { field: "dates", message: "טווח צילום מקסימלי 7 ימים (כללי השאלת ציוד להפקה)" };
        }
      }
      const s = new Date(`${d.startDate}T${d.startTime}`);
      const e = new Date(`${d.endDate}T${d.endTime}`);
      if (e <= s) return { field: "dates", message: "תאריך סיום חייב להיות אחרי תאריך התחלה" };
    }
    // No two ranges within the same production may overlap (calendar-date level).
    for (let i = 0; i < dates.length; i++) {
      for (let j = i + 1; j < dates.length; j++) {
        const a = dates[i], b = dates[j];
        if (!a.startDate || !a.endDate || !b.startDate || !b.endDate) continue;
        if (a.startDate <= b.endDate && b.startDate <= a.endDate) {
          return { field: "dates", message: "לא ניתן לבחור זוג טווחי תאריכים חופפים עבור אותה הפקה" };
        }
      }
    }
    for (const c of crew) {
      // Custom roles still need a label — it identifies the open slot.
      if (c.role === "custom" && !(c.roleLabel || "").trim()) {
        return { field: `crew:${c.id}`, message: "תפקיד מותאם: חסר שם תפקיד" };
      }
      // photographer/sound rows: free-text not allowed (cert lookup needs a real student).
      // But empty is fine — it stays as an open slot for self-enrollment.
      if (REQUIRES_STUDENT.has(c.role) && !c.studentId && (c.freeTextName || "").trim()) {
        return { field: `crew:${c.id}`, message: `${getRoleLabel(c)}: חובה לבחור סטודנט רשום (לא טקסט חופשי)` };
      }
    }
    return null;
  }

  // Build the production blob from the current editor state. Shared by persist()
  // and the on-close cleanup so both write an identical shape.
  function buildBlob(targetStatus) {
    return {
      id:                 productionId,
      title:              title.trim(),
      description,
      driveUrl:           driveUrl.trim(),
      color,
      kitId:              selectedKitId || null,
      directorStudentId:  currentStudent?.id,
      directorEmail:      currentStudent?.email,
      directorName:       currentStudent?.name,
      directorPhone:      currentStudent?.phone,
      status:             targetStatus,
      publishedAt:        targetStatus === "published" ? (initial?.publishedAt || new Date().toISOString()) : initial?.publishedAt,
      dates,
      crew,
    };
  }

  async function persist(targetStatus) {
    const err = validate();
    if (err) {
      setErrorField(err.field);
      showToast?.(err.message, "error");
      return null;
    }
    setErrorField(null);
    setSaving(true);
    const blob = buildBlob(targetStatus);
    const res = await upsertProduction(blob);
    if (!res.ok) {
      setSaving(false);
      console.error("[ProductionEditor.persist]", { blob, error: res.error, raw: res });
      const detail = String(res.error || "").slice(0, 200);
      showToast?.(`שגיאה בשמירה: ${detail || "ראה Console"}`, "error");
      return null;
    }
    // The production (and its date rows) now exist in the DB — the on-close
    // cleanup may need to prune list-less ranges.
    persistedRef.current = true;
    // No approval flow: director-composed crew rows are auto-approved right
    // after the save. Rows are still WRITTEN as 'invited' (do not change that —
    // the approved→invited UPDATE is what fires the DB recheck trigger), and
    // production_approve_crew_v1 flips them + runs the cert-recheck/snapshot
    // refresh for photographer/sound. Best-effort: a failed row stays
    // 'invited' and converges on the next save.
    const auto = await autoApproveDirectorCrew(blob.crew);
    setSaving(false);
    if (auto.approvedIds.length > 0) {
      const flip = c => auto.approvedIds.includes(c.id) ? { ...c, status: "approved" } : c;
      blob.crew = blob.crew.map(flip);
      setCrew(prev => prev.map(flip));
    }
    if (auto.failures.length > 0) {
      const detail = String(auto.failures[0].error || "").slice(0, 120);
      showToast?.(`ההפקה נשמרה, אך שיבוץ איש צוות נכשל${detail ? `: ${detail}` : ""} — שמרו שוב כדי לנסות שוב`, "error");
    }
    return blob;
  }

  // After a successful publish/update: a gated (non-legacy) published production
  // that still has ranges without a submitted equipment list gets a BLOCKING
  // prompt. The director must either submit a list for each range or discard
  // them — there is no "later". Legacy productions close silently, as before.
  function closeOrPromptPending(blob) {
    const pending = isLegacy ? [] : (blob.dates || []).filter(d => !lockedDateIds.has(String(d.id)));
    if (blob.status === "published" && pending.length > 0) {
      setPostSavePrompt({ blob, pending });
    } else {
      onClose();
    }
  }

  // Persist + publish (or re-save if already published), returning the published
  // blob (null on failure). Shared by the "פרסם"/"עדכן" button and the per-range
  // "הגש רשימת ציוד" shortcut. Handles toast + onSaved + crew-invite mail; the
  // CALLER decides what happens next (pending-ranges prompt, or the loan form).
  async function persistAndPublish() {
    if (initial?.status === "published") {
      const blob = await persist("published");
      if (!blob) return null;
      showToast?.("עודכן", "success");
      onSaved?.(blob);
      void notifyCrewInvites(blob, { onlyNew: true });
      return blob;
    }
    setPublishing(true);
    const blob = await persist("draft");
    if (!blob) { setPublishing(false); return null; }
    const pubRes = await publishProduction(productionId);
    setPublishing(false);
    if (!pubRes.ok) {
      console.error("[ProductionEditor.publish]", { productionId, error: pubRes.error, raw: pubRes });
      const detail = String(pubRes.error || "").slice(0, 200);
      showToast?.(`שגיאה בפרסום: ${detail || "ראה Console"}`, "error");
      return null;
    }
    const publishedBlob = { ...blob, status: "published", publishedAt: new Date().toISOString() };
    showToast?.("ההפקה פורסמה", "success");
    onSaved?.(publishedBlob);
    void notifyCrewInvites(publishedBlob, { onlyNew: false });
    return publishedBlob;
  }

  async function onPublish() {
    const blob = await persistAndPublish();
    if (blob) closeOrPromptPending(blob);
  }

  // Per-range shortcut ("הגש רשימת ציוד"): publish the production (so the range +
  // crew exist in the DB and the production is board-eligible), then jump
  // straight to the equipment step of the loan form pre-filled for THIS range.
  // Needs a photographer — the loan's cert snapshot derives from the approved
  // photographer/sound.
  async function submitListForRange(dateId) {
    if (!hasPhotographerAssigned) {
      showToast?.("יש לשבץ צלם ראשי לפני הגשת רשימת ציוד", "error");
      return;
    }
    const blob = await persistAndPublish();
    if (!blob) return;
    onOpenLoanForm?.(blob, dateId);
    onClose();
  }

  // Close the editor. A date range the director entered but never submitted an
  // equipment list for is pruned automatically — a range only stays on the board
  // once its list is in. upsertProduction diffs the dates array and DELETEs the
  // production_dates rows no longer present (a DELETE does not fire the
  // director-overlap trigger). Only runs for a persisted non-legacy production;
  // navigating to the loan form (submitListForRange) uses raw onClose() and does
  // NOT prune, so other pending ranges survive until the next real close.
  async function handleEditorClose() {
    const pending = (persistedRef.current && !isLegacy)
      ? dates.filter(d => !lockedDateIds.has(String(d.id)))
      : [];
    if (pending.length === 0) { onClose(); return; }
    const dropIds = new Set(pending.map(d => String(d.id)));
    const keptDates = dates.filter(d => !dropIds.has(String(d.id)));
    const blob = { ...buildBlob("published"), dates: keptDates };
    const res = await upsertProduction(blob);
    if (res.ok) {
      onSaved?.(blob);
      showToast?.(
        pending.length === 1 ? "טווח תאריכים ללא רשימת ציוד הוסר מההפקה" : `${pending.length} טווחי תאריכים ללא רשימה הוסרו מההפקה`,
        "info"
      );
    } else {
      showToast?.(`שגיאה בהסרת טווח ללא רשימה: ${String(res.error || "").slice(0, 120)}`, "error");
    }
    onClose();
  }

  async function onDelete() {
    setDeleteConfirm(null);
    const res = await deleteProduction(productionId);
    if (!res.ok) {
      showToast?.(`שגיאה במחיקה: ${res.error || ""}`, "error");
      return;
    }
    showToast?.("ההפקה נמחקה", "success");
    onDeleted?.(productionId);
    onClose();
  }

  return (
    <Modal
      title={isNew ? "הפקה חדשה" : `עריכת הפקה: ${initial?.title || ""}`}
      onClose={handleEditorClose}
      size="modal-lg"
      footer={
        <div style={{display:"flex",gap:8,justifyContent:"space-between",flexWrap:"wrap"}}>
          <div>
            {!isNew && (
              <button className="btn btn-danger btn-sm"
                onClick={() => setDeleteConfirm(linkedReservations)}
                style={{background:"rgba(231,76,60,0.1)", color:"#e74c3c", border:"1px solid #e74c3c"}}>
                <Trash2 size={14} /> מחיקה
              </button>
            )}
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button className="btn btn-secondary btn-sm" onClick={handleEditorClose}>סגירה</button>
            {/* No drafts — a created production is published to everyone immediately. */}
            <button className="btn btn-primary btn-sm" onClick={onPublish} disabled={publishing}>
              <Send size={14} /> {isPublished ? "עדכן" : "פרסם"}
            </button>
            {!isNew && isPublished && allDatesLocked && onOpenMyReservations && (
              <button className="btn btn-secondary btn-sm" onClick={onOpenMyReservations}
                title="הוגשו רשימות לכל הטווחים — מעבר ל'ההזמנות שלי' לעריכה/מחיקה">
                <ExternalLink size={14}/> מעבר לרשימה
              </button>
            )}
          </div>
        </div>
      }>
      {/* ── כותרת + תיאור ── */}
      <div style={{marginBottom:18}}>
        <label className="form-label">שם ההפקה</label>
        <input className="form-input" value={title}
          onChange={e => { setTitle(e.target.value); if (errorField === "title") setErrorField(null); }}
          placeholder="לדוגמא: סרט גמר אביב 2026"
          style={errorField === "title" ? { outline: "2px solid #e74c3c", outlineOffset: 2 } : undefined}/>
      </div>
      <div style={{marginBottom:18}}>
        <label className="form-label" style={{display:"flex",justifyContent:"space-between"}}>
          <span>תיאור (עד 800 תווים)</span>
          <span style={{color: description.length > 800 ? "#e74c3c" : "var(--text3)", fontSize:12}}>{description.length}/800</span>
        </label>
        <textarea ref={descriptionRef} className="form-input" rows={3} value={description}
          onChange={e => { setDescription(e.target.value.slice(0,800)); if (errorField === "description") setErrorField(null); }}
          placeholder="פירוט הפרויקט, לוקיישנים, הערות לצוות..."
          style={{
            resize:"none",
            overflow:"hidden",
            minHeight: 80,
            ...(errorField === "description" ? { outline: "2px solid #e74c3c", outlineOffset: 2 } : {}),
          }}/>
      </div>

      {/* ── קישור לתסריט/סינופסיס (Drive) ── */}
      <div style={{marginBottom:18}}>
        <label className="form-label">קישור לתסריט / סינופסיס / תיקיית הפקה</label>
        <input
          type="url"
          className="form-input"
          dir="ltr"
          inputMode="url"
          placeholder="https://drive.google.com/... או כל קישור שיתופי"
          value={driveUrl}
          onChange={e => { setDriveUrl(e.target.value); if (errorField === "drive_url") setErrorField(null); }}
          style={errorField === "drive_url" ? { outline: "2px solid #e74c3c", outlineOffset: 2 } : undefined}
        />
        <div style={{fontSize:13,color:"var(--text)",marginTop:6,lineHeight:1.6,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:6,padding:"10px 12px"}}>
          <div style={{marginBottom:4}}>ⓘ <strong>אופציונלי</strong> — הדבק קישור שיתופי ל-Google Drive / Dropbox / OneDrive: תסריט, סינופסיס, treatment, או תיקייה שלמה.</div>
          <div>🔓 <strong>ודא שההרשאות פתוחות</strong> — "כל מי שיש לו את הקישור יכול לצפות".</div>
        </div>
      </div>

      {/* ── צבע ההפקה ── */}
      <div style={{marginBottom:18}}>
        <label className="form-label">צבע ההפקה</label>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          {COLOR_PALETTE.map(c => {
            const isActive = color === c;
            return (
              <button key={c} type="button" onClick={() => setColor(c)}
                title={c}
                style={{
                  width:34, height:34, borderRadius:"50%",
                  background:c,
                  border: isActive ? "3px solid var(--text)" : "2px solid var(--border)",
                  boxShadow: isActive ? `0 0 0 2px ${c}66` : "none",
                  cursor:"pointer",
                  padding:0,
                  transition:"all 0.15s",
                }}/>
            );
          })}
          <span style={{fontSize:12,color:"var(--text3)",marginInlineStart:8}}>הצבע יוצג על כרטיס ההפקה ועל ה-block בלוח השנה</span>
        </div>
      </div>

      {/* ── סוג ההפקה (kit binding) — sets the equipment scope; sits right above the dates ── */}
      <div style={{marginBottom:18}}>
        <label className="form-label">סוג ההפקה</label>
        <select
          className="form-input"
          value={selectedKitId}
          onChange={e => setSelectedKitId(e.target.value)}
          disabled={kitFieldLocked}
          title={kitFieldLocked ? "לא ניתן לשנות לאחר שהוגשה רשימת ציוד לכל הטווחים" : undefined}
          style={kitFieldLocked ? {opacity:0.6, cursor:"not-allowed"} : undefined}
        >
          <option value="">כללית — ללא הגבלת ציוד</option>
          {productionKits.map(k => (
            <option key={k.id} value={k.id}>{k.name}</option>
          ))}
          {legacyKit && (
            <option key={legacyKit.id} value={legacyKit.id}>
              {legacyKit.name} (לא זמינה יותר)
            </option>
          )}
        </select>
        <div style={{fontSize:12,color:"var(--text3)",marginTop:6}}>
          בחירת ערכה מגבילה את הצוות לפריטי ציוד בתוך הערכה בלבד בעת מילוי טופס ההשאלה.
          {kitFieldLocked && <span style={{color:"#2ecc71",marginInlineStart:6,fontWeight:700}}>🔒 נעול — הוגשה רשימת ציוד לכל הטווחים.</span>}
        </div>
      </div>

      {/* ── תאריכי צילום ── */}
      <div style={{marginBottom:18}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <h4 style={{margin:0, color: errorField === "dates" ? "#e74c3c" : undefined}}>
            תאריכי צילום {errorField === "dates" && <span style={{fontSize:12}}>⚠</span>}
          </h4>
          <button className="btn btn-secondary btn-sm"
            style={{...ADD_BTN_STYLE, ...(canAddDate ? {} : {opacity:0.5, cursor:"not-allowed"})}}
            disabled={!canAddDate}
            title={canAddDate ? undefined : "יש להגיש רשימת ציוד לטווח הקיים לפני הוספת טווח תאריכים נוסף"}
            onClick={() => { addDate(); if (errorField === "dates") setErrorField(null); }}>
            <Plus size={14}/> תאריך
          </button>
        </div>
        {!canAddDate && dates.length > 0 && !isLegacy && (
          <div style={{fontSize:12,color:"var(--text2)",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:6,padding:"8px 10px",marginBottom:10}}>
            💡 יש להגיש רשימת ציוד לטווח הקיים לפני הוספת טווח תאריכים נוסף.
          </div>
        )}
        {dates.length === 0 && <p style={{color:"var(--text3)",fontSize:13}}>הוסיפו לפחות תאריך אחד</p>}
        {dates.map((d, origIdx) => ({d, idx: origIdx}))
          .sort((a, b) => String(a.d.startDate || "").localeCompare(String(b.d.startDate || "")))
          .map(({d, idx}) => {
          const dateLocked = lockedDateIds.has(String(d.id));
          // Max end date = startDate + 6 days (7-day window incl). Use local
          // components — toISOString() shifts to UTC and off-by-ones in IDT.
          const addDaysLocalISO = (iso, days) => {
            const base = new Date(`${iso}T00:00:00`);
            base.setDate(base.getDate() + days);
            const y = base.getFullYear();
            const m = String(base.getMonth() + 1).padStart(2, "0");
            const day = String(base.getDate()).padStart(2, "0");
            return `${y}-${m}-${day}`;
          };
          const maxEndDate = d.startDate ? addDaysLocalISO(d.startDate, 6) : undefined;
          return (
            <div key={d.id} style={{display:"flex",flexWrap:"wrap",alignItems:"end",gap:8,marginBottom:8,padding:8,border:"1px solid var(--border)",borderRadius:6,background:"var(--surface2)"}}>
              <div style={{flex:"1 1 130px",minWidth:0}}>
                <label className="form-label" style={{fontSize:11}}>התחלה (תאריך)</label>
                <input type="date" className="form-input" min={minShoot} value={d.startDate} disabled={dateLocked} onChange={e => {
                  const v = e.target.value;
                  if (!v) return;
                  if (v < minShoot) { showToast?.(`לא ניתן לבחור תאריך לפני ${minShoot} (מינימום 8 ימי עבודה מהיום)`, "error"); return; }
                  if (isWeekendISO(v)) { showToast?.("שישי/שבת אינם זמינים — המחסן סגור בסופי שבוע", "error"); return; }
                  const newMaxEnd = addDaysLocalISO(v, 6);
                  let nextEnd = d.endDate || v;
                  if (nextEnd < v) nextEnd = v;
                  else if (nextEnd > newMaxEnd) nextEnd = newMaxEnd;
                  updateDate(idx, { startDate: v, endDate: nextEnd });
                }}/>
              </div>
              <div style={{flex:"1 1 100px",minWidth:0}}>
                <label className="form-label" style={{fontSize:11}}>התחלה (שעה)</label>
                <select className="form-input" value={snapToProductionSlot(d.startTime)} disabled={dateLocked} onChange={e => updateDate(idx, { startTime: e.target.value })}>
                  {PRODUCTION_TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={{flex:"1 1 130px",minWidth:0}}>
                <label className="form-label" style={{fontSize:11}}>סיום (תאריך)</label>
                <input type="date" className="form-input" min={d.startDate || minShoot} max={maxEndDate} value={d.endDate} disabled={dateLocked} onChange={e => {
                  const v = e.target.value;
                  if (!v) return;
                  if (v < minShoot) { showToast?.(`לא ניתן לבחור תאריך לפני ${minShoot} (מינימום 9 ימי עבודה מהיום)`, "error"); return; }
                  if (d.startDate && v < d.startDate) { showToast?.("תאריך סיום לא יכול להיות לפני תאריך התחלה", "error"); return; }
                  if (isWeekendISO(v)) { showToast?.("שישי/שבת אינם זמינים — המחסן סגור בסופי שבוע", "error"); return; }
                  if (maxEndDate && v > maxEndDate) {
                    showToast?.("טווח צילום מקסימלי 7 ימים", "error");
                    return;
                  }
                  updateDate(idx, { endDate: v });
                }}/>
              </div>
              <div style={{flex:"1 1 100px",minWidth:0}}>
                <label className="form-label" style={{fontSize:11}}>סיום (שעה)</label>
                <select className="form-input" value={snapToProductionSlot(d.endTime)} disabled={dateLocked} onChange={e => updateDate(idx, { endTime: e.target.value })}>
                  {PRODUCTION_TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={{display:"flex",alignItems:"end",flex:"0 0 auto"}}>
                <button className="btn btn-secondary btn-sm btn-icon" onClick={() => removeDate(idx)}
                  disabled={dateLocked}
                  style={dateLocked ? {opacity:0.4,cursor:"not-allowed"} : undefined}>
                  <Trash2 size={14}/>
                </button>
              </div>
              {dateLocked && (
                <div style={{flex:"1 1 100%",fontSize:13,fontWeight:700,color:"#2ecc71",background:"rgba(46,204,113,0.12)",border:"1px solid #2ecc71",borderRadius:6,padding:"6px 10px",marginTop:4,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",justifyContent:"space-between"}}>
                  <span>✓ 🔒 הבטחת את מקומך — הוגשה רשימת ציוד לטווח הזה</span>
                  {onOpenMyReservations && (
                    <button className="btn btn-secondary btn-sm" style={{padding:"2px 10px",fontSize:12}}
                      onClick={onOpenMyReservations}
                      title="מעבר ל'ההזמנות שלי' לעריכה/מחיקה של רשימת הציוד">
                      <ExternalLink size={12}/> מעבר לרשימה
                    </button>
                  )}
                </div>
              )}
              {/* Per-range shortcut: submit the equipment list for THIS range.
                  A range without a list won't appear on the board (and is
                  removed on close) — so this is the primary path, not optional.
                  Button on the right (RTL start); explanation flows to its left. */}
              {!dateLocked && !isLegacy && (
                <div style={{flex:"1 1 100%",marginTop:4,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  {hasPhotographerAssigned ? (
                    <button className="btn btn-primary btn-sm" onClick={() => submitListForRange(d.id)} disabled={saving || publishing}
                      title="פרסום ההפקה ומעבר ישיר להגשת רשימת ציוד לטווח זה">
                      🎬 הגש רשימת ציוד
                    </button>
                  ) : (
                    <span style={{fontSize:12,color:"#e74c3c",fontWeight:700}}>⚠ יש לשבץ צלם ראשי לפני הגשת רשימת ציוד</span>
                  )}
                  <span style={{fontSize:12.5,color:"#f5a623",fontWeight:800}}>
                    ⚠ טווח התאריכים יופיע בלוח רק לאחר הגשת רשימת ציוד — אחרת יימחק
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── צוות ── */}
      <div style={{marginBottom:18}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <h4 style={{margin:0, color: errorField === "crew" ? "#e74c3c" : undefined}}>
            צוות {errorField === "crew" && <span style={{fontSize:12}}>⚠</span>}
          </h4>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {ROLE_ORDER.map(role => (
              <button key={role} className="btn btn-secondary btn-sm" style={ADD_BTN_STYLE}
                onClick={() => { addCrew(role); if (errorField === "crew") setErrorField(null); }}
                title={role === "photographer" ? "חובה — צלם ראשי נדרש להגשת רשימת ציוד" : undefined}>
                <Plus size={12}/> {ROLE_LABELS[role]}
              </button>
            ))}
            <button className="btn btn-secondary btn-sm" style={ADD_BTN_STYLE}
              onClick={() => { openCustomRolePrompt(); if (errorField === "crew") setErrorField(null); }}
              title="הוסף תפקיד עם שם מותאם (למשל: תאורן, צבע, מנהל הפקה)">
              <Plus size={12}/> תפקיד מותאם
            </button>
          </div>
        </div>
        <div style={{fontSize:13,color:"var(--text)",marginBottom:8,lineHeight:1.5,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:6,padding:"10px 12px"}}>
          <div>🎥 <strong style={{color:"var(--accent)"}}>צלם ראשי מוסמך ורשום — חובה</strong>.</div>
          <div style={{marginTop:4}}>בשלב השאלת הציוד המערכת בודקת הסמכות ציוד של הצלם הראשי ואיש הסאונד (אם קיים) — לא של הבמאי.</div>
        </div>
        {crew.length === 0 && <p style={{color:"var(--text2)",fontSize:13}}>אין עדיין צוות. הוסיפו תפקיד מהכפתורים למעלה.</p>}
        {crew.map(c => {
          const isError = errorField === `crew:${c.id}`;
          const emailLc = String(c.crewEmail || "").toLowerCase();
          const selectedStudent =
            (c.studentId
              ? (sortedStudents.find(s => String(s.id) === String(c.studentId))
                 || (students || []).find(s => String(s.id) === String(c.studentId)))
              : null)
            || (emailLc
              ? (sortedStudents.find(s => String(s.email || "").toLowerCase() === emailLc)
                 || (students || []).find(s => String(s.email || "").toLowerCase() === emailLc))
              : null)
            || null;
          const displayName = c._typing !== undefined
            ? c._typing
            : (selectedStudent?.name || c.freeTextName || c.crewEmail || "");
          const datalistId = `students-list-${c.id}`;
          // Photographer: cinema students only. Sound: cinema OR sound students
          // (cinema-track students are also allowed to fill the sound role).
          const eligibleFilter = c.role === "photographer"
            ? (s => String(s.track || "").includes("קולנוע"))
            : c.role === "sound"
              ? (s => { const t = String(s.track || ""); return t.includes("סאונד") || t.includes("קולנוע"); })
              : null;
          const eligibleStudents = eligibleFilter
            ? sortedStudents.filter(eligibleFilter)
            : sortedStudents;
          return (
            <div key={c.id} style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:8,padding:8,border: isError ? "2px solid #e74c3c" : "1px solid var(--border)",borderRadius:6,alignItems:"center",background:"var(--surface2)"}}>
              <div style={{fontWeight:700,minWidth:90,flexShrink:0}}>{getRoleLabel(c)}</div>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",flex:"1 1 200px",minWidth:0}}>
                <input
                  className="form-input"
                  type="text"
                  list={datalistId}
                  autoComplete="off"
                  placeholder={
                    c.role === "photographer" ? "שם סטודנט (הנדסאי קולנוע בלבד)..."
                    : c.role === "sound"        ? "שם סטודנט (הנדסאי סאונד או קולנוע)..."
                    : "שם סטודנט או טקסט חופשי..."
                  }
                  value={displayName}
                  onChange={e => {
                    const v = e.target.value;
                    const match = eligibleStudents.find(s => s.name === v);
                    // Block adding the same student twice in the same production.
                    if (match && crew.some(other => other.id !== c.id && other.status !== "rejected" && String(other.studentId || "") === String(match.id))) {
                      showToast?.(`${match.name} כבר משויך לתפקיד אחר בהפקה הזו`, "error");
                      updateCrew(c.id, { _typing: "" });
                      return;
                    }
                    if (match) {
                      updateCrew(c.id, { studentId: match.id, freeTextName: null, crewEmail: match.email || null, status: "invited", _typing: undefined });
                    } else if (REQUIRES_STUDENT.has(c.role)) {
                      updateCrew(c.id, { studentId: null, freeTextName: null, crewEmail: null, _typing: v });
                    } else {
                      updateCrew(c.id, { studentId: null, freeTextName: v, crewEmail: null, status: "approved", _typing: v });
                    }
                    if (isError) setErrorField(null);
                  }}
                  style={{flex:"1 1 160px",minWidth:0}}
                />
                <datalist id={datalistId}>
                  {eligibleStudents.map(s => (
                    <option key={s.id} value={s.name}>{s.track ? s.track : ""}</option>
                  ))}
                </datalist>
                {(() => {
                  // No approval flow: a filled row is simply "assigned" (auto-
                  // approved on save); an empty row is an open placeholder.
                  const isOpenSlot = !c.studentId && !c.freeTextName && !c.crewEmail;
                  const statusColor = isOpenSlot ? "#3498db" : "#2ecc71";
                  const statusBg    = isOpenSlot ? "rgba(52,152,219,0.15)" : "rgba(46,204,113,0.15)";
                  const statusLabel = isOpenSlot ? "תפקיד פנוי" : "משובץ";
                  return (
                    <span style={{
                      fontSize:12, fontWeight:700, whiteSpace:"nowrap",
                      color: statusColor,
                      background: statusBg,
                      border: `1px solid ${statusColor}`,
                      borderRadius:10, padding:"2px 8px",
                    }}>{statusLabel}</span>
                  );
                })()}
              </div>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => removeCrew(c.id)}><Trash2 size={14}/></button>
            </div>
          );
        })}
      </div>

      {customRolePrompt.open && (
        <Modal title="תפקיד מותאם חדש" onClose={() => setCustomRolePrompt({ open: false, value: "" })} footer={
          <div style={{display:"flex",gap:8,justifyContent:"end"}}>
            <button className="btn btn-secondary btn-sm" onClick={() => setCustomRolePrompt({ open: false, value: "" })}>ביטול</button>
            <button className="btn btn-primary btn-sm" disabled={!customRolePrompt.value.trim()} onClick={confirmCustomRole}>
              הוסף תפקיד
            </button>
          </div>
        }>
          <div style={{marginBottom:8}}>
            <label className="form-label">שם התפקיד</label>
            <input
              className="form-input"
              autoFocus
              maxLength={40}
              placeholder="לדוגמה: תאורן, צבע, מנהל הפקה"
              value={customRolePrompt.value}
              onChange={e => setCustomRolePrompt(p => ({ ...p, value: e.target.value.slice(0, 40) }))}
              onKeyDown={e => { if (e.key === "Enter" && customRolePrompt.value.trim()) confirmCustomRole(); }}
            />
            <div style={{fontSize:11,color:"var(--text3)",marginTop:6,textAlign:"left"}}>
              {customRolePrompt.value.length}/40
            </div>
          </div>
        </Modal>
      )}

      {postSavePrompt && (
        <Modal title="חובה להגיש רשימת ציוד לכל טווח תאריכים"
          onClose={() => setPostSavePrompt(null)}
          footer={
            <div style={{display:"flex",gap:8,justifyContent:"end",alignItems:"center",flexWrap:"wrap"}}>
              {/* No delete button here — closing this dialog just returns to the
                  editor. Any range still without a list is pruned only when the
                  editor itself is closed (handleEditorClose). */}
              <button className="btn btn-secondary btn-sm" onClick={() => setPostSavePrompt(null)}>
                חזרה לעריכה
              </button>
            </div>
          }>
          <div style={{display:"flex",gap:10,alignItems:"start"}}>
            <AlertTriangle size={22} color="#e74c3c" style={{flexShrink:0,marginTop:2}}/>
            <div style={{flex:1,minWidth:0}}>
              <p style={{margin:"0 0 8px",fontWeight:700}}>
                {postSavePrompt.pending.length === 1
                  ? "טווח תאריכים אחד עדיין ללא רשימת ציוד."
                  : `${postSavePrompt.pending.length} טווחי תאריכים עדיין ללא רשימת ציוד.`}
              </p>
              <p style={{margin:"0 0 12px",fontSize:13,color:"var(--text2)",lineHeight:1.6}}>
                טווח תאריכים יופיע בלוח ההפקות <strong>רק</strong> אחרי שתוגש לו רשימת ציוד.
                טווח תאריכים שתשאיר ללא רשימה <strong style={{color:"#e74c3c"}}>יוסר</strong> מההפקה בעת סגירת החלון.
              </p>
              {!hasApprovedPhotographer && (
                <p style={{margin:"0 0 10px",fontSize:12,color:"#e74c3c",fontWeight:700}}>
                  ⚠ יש לשבץ צלם ראשי לפני הגשת רשימת ציוד
                </p>
              )}
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {postSavePrompt.pending.map(d => (
                  <div key={d.id} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",justifyContent:"space-between",border:"1px solid var(--border)",borderRadius:6,padding:"8px 10px",background:"var(--surface2)"}}>
                    <span style={{fontSize:13,fontWeight:700}}>{fmtRangeHe(d)}</span>
                    {hasApprovedPhotographer && (
                      <button className="btn btn-primary btn-sm"
                        onClick={() => onOpenLoanForm?.(postSavePrompt.blob, d.id)}>
                        <ExternalLink size={14}/> הגש רשימת ציוד
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {deleteConfirm && (
        <Modal title="אישור מחיקת הפקה" onClose={() => setDeleteConfirm(null)} footer={
          <div style={{display:"flex",gap:8,justifyContent:"end"}}>
            <button className="btn btn-secondary btn-sm" onClick={() => setDeleteConfirm(null)}>ביטול</button>
            <button className="btn btn-danger btn-sm" onClick={onDelete} style={{background:"#e74c3c",color:"#fff"}}>
              <Trash2 size={14}/> מחיקה סופית
            </button>
          </div>
        }>
          <div style={{display:"flex",gap:8,alignItems:"start",marginBottom:12}}>
            <AlertTriangle size={20} color="#c00" />
            <div>
              <p style={{margin:0,fontWeight:700}}>פעולה זו תמחק את ההפקה לחלוטין.</p>
              {deleteConfirm.length > 0 ? (
                <>
                  <p style={{margin:"8px 0 4px"}}>{deleteConfirm.length} השאלות ציוד מקושרות יימחקו אוטומטית:</p>
                  <ul style={{margin:"4px 0",paddingInlineStart:20,fontSize:13}}>
                    {deleteConfirm.map(r => <li key={r.id}>#{r.id} — {r.status} — {r.borrow_date}</li>)}
                  </ul>
                </>
              ) : (
                <p style={{margin:"8px 0",fontSize:13,color:"var(--text3)"}}>אין השאלות ציוד מקושרות.</p>
              )}
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
