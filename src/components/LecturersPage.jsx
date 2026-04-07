// LecturersPage.jsx — central lecturers management
import { useEffect, useState, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { storageSet } from "../utils.js";

/* ── helpers ── */
let _idCounter = 0;
function makeLecturerId() {
  return `lec_${Date.now()}_${++_idCounter}`;
}

export function makeLecturer(fields = {}) {
  const now = new Date().toISOString();
  return {
    id:          fields.id          || makeLecturerId(),
    fullName:    String(fields.fullName  || "").trim(),
    phone:       String(fields.phone     || "").trim(),
    email:       String(fields.email     || "").trim(),
    studyTracks: Array.isArray(fields.studyTracks) ? fields.studyTracks : [],
    notes:       String(fields.notes     || "").trim(),
    isActive:    fields.isActive !== false,
    createdAt:   fields.createdAt  || now,
    updatedAt:   now,
  };
}

function findDuplicate(lecturers, { fullName, email, phone }, excludeId = null) {
  const name = String(fullName || "").trim().toLowerCase();
  const mail = String(email    || "").trim().toLowerCase();
  const tel  = String(phone    || "").trim();
  return (lecturers || []).find(l => {
    if (l.id === excludeId) return false;
    const ln = String(l.fullName || "").trim().toLowerCase();
    const lm = String(l.email    || "").trim().toLowerCase();
    const lt = String(l.phone    || "").trim();
    if (name && ln === name) return true;
    if (mail && lm === mail) return true;
    if (tel  && lt === tel)  return true;
    return false;
  });
}

/* ── Main exported component ── */
export function LecturersPage({ lecturers = [], setLecturers, showToast, trackOptions = [], lessons = [] }) {
  const [search,       setSearch]       = useState("");
  const [trackFilter,  setTrackFilter]  = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId,    setEditingId]    = useState(null);
  const [xlImporting,  setXlImporting]  = useState(false);
  const importRef = useRef(null);

  // Add-modal state
  const [addName,  setAddName]  = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [addDup,   setAddDup]   = useState(null);
  const [addSaving, setAddSaving] = useState(false);

  // Inline-edit state
  const [editName,  setEditName]  = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [inlineSaving, setInlineSaving] = useState(false);
  const inlineSaveTimeoutRef = useRef(null);
  const lastSavedInlineDraftRef = useRef("");
  const lastFailedInlineDraftRef = useRef("");

  // Derive tracks from lessons for each lecturer
  const UNASSIGNED = "לא משויך";
  const knownTracks = useMemo(() => new Set((trackOptions || []).map(t => String(t || "").trim()).filter(Boolean)), [trackOptions]);
  const normalizeTrack = (raw) => {
    const t = String(raw || "").trim();
    return (t && t !== "כללי" && knownTracks.has(t)) ? t : UNASSIGNED;
  };

  const lecturerTracks = useMemo(() => {
    const map = {};
    const nameToId = {};
    for (const lec of lecturers) {
      nameToId[String(lec.fullName || "").trim().toLowerCase()] = lec.id;
      map[lec.id] = new Set();
    }
    for (const l of lessons) {
      let lecId = l.lecturerId;
      if (!lecId && l.instructorName) lecId = nameToId[String(l.instructorName || "").trim().toLowerCase()];
      if (!lecId || !map[lecId]) continue;
      map[lecId].add(normalizeTrack(l.track));
    }
    return map;
  }, [lessons, lecturers, knownTracks]);

  const linkedLecturerIds = useMemo(() => {
    const ids = new Set();
    const nameToId = {};
    for (const lec of lecturers) nameToId[String(lec.fullName || "").trim().toLowerCase()] = lec.id;
    for (const l of lessons) {
      if (l.lecturerId) ids.add(l.lecturerId);
      else if (l.instructorName) {
        const id = nameToId[String(l.instructorName || "").trim().toLowerCase()];
        if (id) ids.add(id);
      }
    }
    return ids;
  }, [lessons, lecturers]);

  const allDerivedTracks = useMemo(() => {
    const set = new Set();
    for (const id in lecturerTracks) for (const t of lecturerTracks[id]) set.add(t);
    // Known tracks first (sorted), then "לא משויך" last
    const known = [...set].filter(t => t !== UNASSIGNED).sort((a, b) => a.localeCompare(b, "he"));
    if (set.has(UNASSIGNED)) known.push(UNASSIGNED);
    return known;
  }, [lecturerTracks]);

  /* ── Actions ── */
  const openAddModal = () => {
    setAddName(""); setAddPhone(""); setAddEmail(""); setAddNotes(""); setAddDup(null); setAddSaving(false);
    setShowAddModal(true);
  };

  const saveAdd = async (force = false) => {
    if (!addName.trim()) { showToast("error", "שם מלא הוא שדה חובה"); return; }
    if (!force) {
      const dup = findDuplicate(lecturers, { fullName: addName, email: addEmail, phone: addPhone });
      if (dup) { setAddDup(dup); return; }
    }
    setAddSaving(true);
    const newLec = makeLecturer({ fullName: addName.trim(), phone: addPhone.trim(), email: addEmail.trim(), notes: addNotes.trim() });
    const updated = [...lecturers, newLec];
    const result = await storageSet("lecturers", updated);
    if (!result?.ok) {
      setAddSaving(false);
      showToast("error", "שגיאה בשמירת המרצה. הנתונים לא נשמרו.");
      return;
    }
    setLecturers(updated);
    showToast("success", "המרצה נוסף");
    setShowAddModal(false);
  };

  const clearInlineSaveTimeout = () => {
    if (inlineSaveTimeoutRef.current) {
      clearTimeout(inlineSaveTimeoutRef.current);
      inlineSaveTimeoutRef.current = null;
    }
  };

  const resetInlineSaveState = () => {
    clearInlineSaveTimeout();
    lastSavedInlineDraftRef.current = "";
    lastFailedInlineDraftRef.current = "";
  };

  const openInlineEdit = (lec) => {
    resetInlineSaveState();
    setInlineSaving(false);
    setEditingId(lec.id);
    setEditName(lec.fullName || "");
    setEditPhone(lec.phone || "");
    setEditEmail(lec.email || "");
    setEditNotes(lec.notes || "");
  };

  const buildInlineDraft = () => ({
    fullName: String(editName || "").trim(),
    phone: String(editPhone || "").trim(),
    email: String(editEmail || "").trim(),
    notes: String(editNotes || "").trim(),
  });

  const getInlineDraftKey = (draft) => [draft.fullName, draft.phone, draft.email, draft.notes].join("\u0001");

  const isInlineDraftDirty = (lec, draft) => (
    String(lec?.fullName || "").trim() !== draft.fullName
    || String(lec?.phone || "").trim() !== draft.phone
    || String(lec?.email || "").trim() !== draft.email
    || String(lec?.notes || "").trim() !== draft.notes
  );

  const saveInlineEdit = async (lec, { closeOnSuccess = false, silent = false } = {}) => {
    clearInlineSaveTimeout();
    if (!lec) {
      if (closeOnSuccess) setEditingId(null);
      return true;
    }

    const draft = buildInlineDraft();
    const draftKey = getInlineDraftKey(draft);

    if (!draft.fullName) {
      showToast("error", "שם מלא הוא שדה חובה");
      return false;
    }

    if (!isInlineDraftDirty(lec, draft)) {
      lastSavedInlineDraftRef.current = draftKey;
      lastFailedInlineDraftRef.current = "";
      if (closeOnSuccess) setEditingId(null);
      return true;
    }

    setInlineSaving(true);
    const updated = lecturers.map((item) => (
      item.id === lec.id ? makeLecturer({ ...item, ...draft }) : item
    ));
    const result = await storageSet("lecturers", updated);
    setInlineSaving(false);

    if (!result?.ok) {
      lastFailedInlineDraftRef.current = draftKey;
      showToast("error", "שגיאה בעדכון המרצה. הנתונים לא נשמרו.");
      return false;
    }

    lastSavedInlineDraftRef.current = draftKey;
    lastFailedInlineDraftRef.current = "";
    setLecturers(updated);
    if (!silent) showToast("success", "המרצה עודכן");
    if (closeOnSuccess) setEditingId(null);
    return true;
  };

  const closeInlineEdit = async (lec) => {
    const didSave = await saveInlineEdit(lec, { closeOnSuccess: false, silent: true });
    if (didSave) setEditingId(null);
  };

  const startEdit = async (lec) => {
    if (editingId === lec.id) {
      await closeInlineEdit(lec);
      return;
    }

    if (editingId) {
      const current = lecturers.find((item) => item.id === editingId);
      const didSave = await saveInlineEdit(current, { closeOnSuccess: false, silent: true });
      if (!didSave) return;
    }

    openInlineEdit(lec);
  };

  const editingLecturer = editingId ? lecturers.find((item) => item.id === editingId) : null;

  useEffect(() => {
    clearInlineSaveTimeout();

    if (!editingLecturer || inlineSaving) return undefined;

    const draft = buildInlineDraft();
    const draftKey = getInlineDraftKey(draft);
    if (!draft.fullName || !isInlineDraftDirty(editingLecturer, draft)) return undefined;
    if (lastSavedInlineDraftRef.current === draftKey || lastFailedInlineDraftRef.current === draftKey) return undefined;

    inlineSaveTimeoutRef.current = setTimeout(() => {
      void saveInlineEdit(editingLecturer, { closeOnSuccess: false, silent: true });
    }, 700);

    return () => clearInlineSaveTimeout();
  }, [editingLecturer, editName, editPhone, editEmail, editNotes, inlineSaving]);

  const deleteLecturer = async (lec) => {
    const updated = lecturers.filter(l => l.id !== lec.id);
    const result = await storageSet("lecturers", updated);
    if (!result?.ok) {
      showToast("error", "שגיאה במחיקת המרצה. המחיקה לא נשמרה.");
      return;
    }
    setLecturers(updated);
    showToast("success", "המרצה נמחק");
    if (editingId === lec.id) {
      resetInlineSaveState();
      setInlineSaving(false);
      setEditingId(null);
    }
  };

  /* ── XL Import ── */
  const importXL = async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    setXlImporting(true);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
      if (rows.length < 2) { showToast("error", "הקובץ ריק או חסרת שורת כותרת"); return; }

      const header = rows[0].map(h => String(h || "").trim().toLowerCase());
      const nameIdx  = header.findIndex(h => /שם/.test(h));
      const phoneIdx = header.findIndex(h => /טלפון|נייד|phone/.test(h));
      const emailIdx = header.findIndex(h => /מייל|אימייל|email/.test(h));

      if (nameIdx < 0) { showToast("error", "לא נמצאה עמודת שם בקובץ"); return; }

      let addedCount = 0;
      let skippedCount = 0;
      const existingNames = new Set(lecturers.map(l => String(l.fullName || "").trim().toLowerCase()));
      const newLecs = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const fullName = String(row[nameIdx] || "").trim();
        if (!fullName) continue;
        if (existingNames.has(fullName.toLowerCase())) { skippedCount++; continue; }
        existingNames.add(fullName.toLowerCase());
        newLecs.push(makeLecturer({
          fullName,
          phone: phoneIdx >= 0 ? String(row[phoneIdx] || "").trim() : "",
          email: emailIdx >= 0 ? String(row[emailIdx] || "").trim() : "",
        }));
        addedCount++;
      }

      if (newLecs.length > 0) {
        const updated = [...lecturers, ...newLecs];
        const result = await storageSet("lecturers", updated);
        if (!result?.ok) {
          showToast("error", "שגיאה בשמירת ייבוא המרצים. הנתונים לא נשמרו.");
          return;
        }
        setLecturers(updated);
      }
      showToast("success", `יובאו ${addedCount} מרצים${skippedCount ? ` (${skippedCount} דולגו — כבר קיימים)` : ""}`);
    } catch (err) {
      console.error("Lecturer XL import failed", err);
      showToast("error", "שגיאה בייבוא מרצים מ־XL");
    } finally {
      setXlImporting(false);
      if (importRef.current) importRef.current.value = null;
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lecturers
      .filter(l => l.isActive !== false)
      .filter(l => !q || l.fullName.toLowerCase().includes(q) || (l.email||"").toLowerCase().includes(q) || (l.phone||"").includes(q))
      .filter(l => {
        if (trackFilter.length === 0) return true;
        const tracks = lecturerTracks[l.id];
        return tracks && trackFilter.some(t => tracks.has(t));
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName, "he"));
  }, [lecturers, search, trackFilter, lecturerTracks]);

  const th = { padding: "8px 12px", textAlign: "right", fontWeight: 800, fontSize: 12, color: "var(--text3)", borderBottom: "2px solid var(--border)", whiteSpace: "nowrap" };
  const td = { padding: "6px 12px", borderBottom: "1px solid var(--border)", fontSize: 13, verticalAlign: "middle" };
  const inpStyle = { width: "100%", boxSizing: "border-box", fontSize: 13, padding: "3px 6px", margin: 0, height: 28, border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface)", color: "var(--text)" };
  const lbl = { fontSize: 12, color: "var(--text3)", marginBottom: 4, display: "block" };
  return (
    <div className="page" style={{ direction: "rtl" }}>
      <style>{`
        .lecturers-table .lecturers-row {
          cursor: pointer;
        }

        .lecturers-table .lecturers-row td {
          transition: background-color 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
        }

        .lecturers-table .lecturers-row:hover td {
          background: rgba(245, 166, 35, 0.14);
          border-bottom-color: rgba(245, 166, 35, 0.28);
        }

        .lecturers-table .lecturers-row:hover td:first-child {
          box-shadow: inset -4px 0 0 var(--accent);
        }

        .lecturers-table .lecturers-inline-actions > button:first-child {
          display: none;
        }
      `}</style>
      {/* ── Add Modal ── */}
      {showAddModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setShowAddModal(false)}>
          <div style={{ background: "var(--surface)", borderRadius: 14, maxWidth: 480, width: "100%", border: "1px solid var(--border)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)", direction: "rtl" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 900, fontSize: 16 }}>➕ הוספת מרצה</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowAddModal(false)}>✕</button>
            </div>
            <div style={{ padding: "16px 20px" }}>
              {addDup && (
                <div style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 13 }}>
                  <div style={{ fontWeight: 700, color: "#f59e0b", marginBottom: 6 }}>⚠️ נמצא מרצה דומה: <strong>{addDup.fullName}</strong></div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setAddDup(null)}>ביטול</button>
                    <button className="btn btn-primary btn-sm" onClick={() => { setAddDup(null); saveAdd(true); }}>צור בכל זאת</button>
                  </div>
                </div>
              )}
              <div style={{ marginBottom: 14 }}>
                <span style={lbl}>שם מלא *</span>
                <input className="form-input" style={{ width: "100%", boxSizing: "border-box" }} placeholder='ד"ר ישראל ישראלי'
                  value={addName} onChange={e => setAddName(e.target.value)} autoFocus />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <span style={lbl}>טלפון</span>
                  <input className="form-input" style={{ width: "100%", boxSizing: "border-box" }} placeholder="05x-xxxxxxx"
                    value={addPhone} onChange={e => setAddPhone(e.target.value)} />
                </div>
                <div>
                  <span style={lbl}>מייל</span>
                  <input className="form-input" type="email" style={{ width: "100%", boxSizing: "border-box" }} placeholder="lecturer@example.com"
                    value={addEmail} onChange={e => setAddEmail(e.target.value)} />
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <span style={lbl}>הערות פנימיות</span>
                <textarea className="form-input" rows={2} placeholder="הערות..." value={addNotes} onChange={e => setAddNotes(e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", resize: "vertical" }} />
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-start" }}>
                <button className="btn btn-primary" onClick={() => saveAdd()} disabled={addSaving}>{addSaving ? "שומר..." : "הוסף מרצה"}</button>
                <button className="btn btn-secondary" onClick={() => setShowAddModal(false)}>ביטול</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>👩‍🏫 מרצים ({lecturers.filter(l => l.isActive !== false).length})</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <input ref={importRef} type="file" accept=".csv,.tsv,.xlsx,.xls" style={{ display: "none" }} onChange={importXL} disabled={xlImporting} />
          <button className="btn btn-secondary" onClick={() => importRef.current?.click()} disabled={xlImporting}>
            {xlImporting ? "⏳ מייבא..." : "📥 ייבוא XL"}
          </button>
          <button className="btn btn-primary" onClick={openAddModal}>➕ הוסף מרצה</button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input className="form-input" placeholder="🔍 חיפוש לפי שם / מייל / טלפון" value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: "1 1 220px", maxWidth: 320 }} />
      </div>

      {/* Track filter chips */}
      {allDerivedTracks.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--text3)", fontWeight: 600 }}>מסלולים:</span>
          {allDerivedTracks.map(t => {
            const active = trackFilter.includes(t);
            const isUnassigned = t === UNASSIGNED;
            return (
              <button key={t} type="button"
                onClick={() => setTrackFilter(prev => active ? prev.filter(x => x !== t) : [...prev, t])}
                style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12,
                  border: `1px solid ${isUnassigned ? (active ? "#ef4444" : "rgba(239,68,68,0.5)") : "var(--border)"}`,
                  background: active ? (isUnassigned ? "rgba(239,68,68,0.18)" : "var(--accent)") : "var(--surface2)",
                  color: active ? (isUnassigned ? "#ef4444" : "#000") : (isUnassigned ? "rgba(239,68,68,0.8)" : "var(--text)"),
                  cursor: "pointer", fontWeight: active ? 700 : 400, transition: "all 0.15s" }}
              >{t}</button>
            );
          })}
          {trackFilter.length > 0 && (
            <button type="button" onClick={() => setTrackFilter([])}
              style={{ fontSize: 11, padding: "3px 8px", borderRadius: 12, border: "none", background: "transparent", color: "var(--text3)", cursor: "pointer", textDecoration: "underline" }}>
              נקה
            </button>
          )}
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text3)" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>👩‍🏫</div>
          <div style={{ fontWeight: 700 }}>{search || trackFilter.length ? "לא נמצאו תוצאות" : "אין מרצים עדיין"}</div>
          {!search && !trackFilter.length && <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={openAddModal}>הוסף מרצה ראשון</button>}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="lecturers-table" style={{ width: "100%", borderCollapse: "collapse", background: "var(--surface2)", borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "22%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "28%" }} />
              <col style={{ width: "12%" }} />
            </colgroup>
            <thead>
              <tr style={{ background: "rgba(245,166,35,0.08)" }}>
                <th style={th}>שם מלא</th>
                <th style={th}>טלפון</th>
                <th style={th}>מייל</th>
                <th style={th}>מסלולי לימוד</th>
                <th style={{ ...th, textAlign: "center" }}>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(lec => {
                const isLinked = linkedLecturerIds.has(lec.id);
                const tracks = lecturerTracks[lec.id] ? [...lecturerTracks[lec.id]] : [];
                const isEditing = editingId === lec.id;

                if (isEditing) {
                  return (
                    <tr key={lec.id} style={{ background: "rgba(245,166,35,0.06)", cursor: "pointer" }}
                      onClick={e => { if (e.target.tagName !== "INPUT" && e.target.tagName !== "BUTTON") void closeInlineEdit(lec); }}>
                      <td style={td}>
                        <input className="form-input" value={editName} onChange={e => setEditName(e.target.value)}
                          style={{ ...inpStyle, fontWeight: 700 }} autoFocus />
                      </td>
                      <td style={td}>
                        <input className="form-input" value={editPhone} onChange={e => setEditPhone(e.target.value)}
                          style={inpStyle} />
                      </td>
                      <td style={td}>
                        <input className="form-input" type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)}
                          style={{ ...inpStyle, fontSize: 12 }} />
                      </td>
                      <td style={td}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {tracks.length > 0
                            ? tracks.map(t => <span key={t} style={{ background: t===UNASSIGNED?"rgba(239,68,68,0.15)":"rgba(245,166,35,0.15)", color: t===UNASSIGNED?"#ef4444":"#f5a623", borderRadius: 12, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>{t}</span>)
                            : <span style={{ color: "var(--text3)", fontSize: 12 }}>—</span>}
                        </div>
                      </td>
                      <td style={{ ...td, textAlign: "center" }}>
                        <div className="lecturers-inline-actions" style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center" }}
                          onClickCapture={(e) => {
                            if (e.target.tagName === "BUTTON") {
                              e.preventDefault();
                              e.stopPropagation();
                              void closeInlineEdit(lec);
                            }
                          }}>
                          <button className="btn btn-primary btn-sm" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => saveInlineEdit(lec)}>✓</button>
                          <button className="btn btn-secondary btn-sm" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => setEditingId(null)}>✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr
                    key={lec.id}
                    className="lecturers-row"
                    onClick={() => void startEdit(lec)}
                    style={{ cursor: "pointer" }}
                  >
                    <td style={{ ...td, fontWeight: 700 }}>
                      {lec.fullName}
                      {!isLinked && (
                        <div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 400, marginTop: 2 }}>לא משויך לקורס</div>
                      )}
                    </td>
                    <td style={td}>{lec.phone || <span style={{ color: "var(--text3)" }}>—</span>}</td>
                    <td style={td}><span style={{ fontSize: 12 }}>{lec.email || <span style={{ color: "var(--text3)" }}>—</span>}</span></td>
                    <td style={td}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {tracks.length > 0
                          ? tracks.map(t => (
                              <span key={t} style={{ background: "rgba(245,166,35,0.15)", color: "#f5a623", borderRadius: 12, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>{t}</span>
                            ))
                          : <span style={{ color: "var(--text3)", fontSize: 12 }}>—</span>}
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: "center" }} onClick={e => e.stopPropagation()}>
                      <button className="btn btn-secondary btn-sm" style={{ color: "var(--red)", borderColor: "var(--red)", fontSize: 11 }}
                        onClick={() => { if (window.confirm(`למחוק את המרצה "${lec.fullName}"?`)) deleteLecturer(lec); }}>
                        🗑️
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
