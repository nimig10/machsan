// LecturersPage.jsx — central lecturers management
import { useState, useMemo } from "react";
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

/* ── Form ── */
function LecturerForm({ initial, onSave, onCancel, lecturers, trackOptions = [], showToast }) {
  const [fullName,    setFullName]    = useState(initial?.fullName    || "");
  const [phone,       setPhone]       = useState(initial?.phone       || "");
  const [email,       setEmail]       = useState(initial?.email       || "");
  const [tracksRaw,   setTracksRaw]   = useState((initial?.studyTracks || []).join(", "));
  const [notes,       setNotes]       = useState(initial?.notes       || "");
  const [isActive,    setIsActive]    = useState(initial?.isActive !== false);
  const [saving,      setSaving]      = useState(false);
  const [dupWarning,  setDupWarning]  = useState(null);

  const isEdit = !!initial?.id;

  const parseTracks = (raw) =>
    raw.split(",").map(s => s.trim()).filter(Boolean);

  const handleSave = async (force = false) => {
    if (!fullName.trim()) { showToast("error", "שם מלא הוא שדה חובה"); return; }
    const studyTracks = parseTracks(tracksRaw);

    if (!force) {
      const dup = findDuplicate(lecturers, { fullName, email, phone }, initial?.id);
      if (dup) {
        setDupWarning(dup);
        return;
      }
    }
    setSaving(true);
    onSave({ fullName: fullName.trim(), phone: phone.trim(), email: email.trim(), studyTracks, notes: notes.trim(), isActive });
  };

  const inp = { className: "form-input", style: { width: "100%", boxSizing: "border-box" } };
  const row = { marginBottom: 14 };
  const lbl = { fontSize: 12, color: "var(--text3)", marginBottom: 4, display: "block" };

  return (
    <div style={{ direction: "rtl" }}>
      {dupWarning && (
        <div style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 13 }}>
          <div style={{ fontWeight: 700, color: "#f59e0b", marginBottom: 6 }}>⚠️ נמצא מרצה דומה: <strong>{dupWarning.fullName}</strong></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setDupWarning(null)}>השתמש בקיים</button>
            <button className="btn btn-primary btn-sm" onClick={() => { setDupWarning(null); handleSave(true); }}>צור בכל זאת</button>
          </div>
        </div>
      )}

      <div style={row}>
        <span style={lbl}>שם מלא *</span>
        <input {...inp} placeholder='ד"ר ישראל ישראלי' value={fullName} onChange={e => setFullName(e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <div>
          <span style={lbl}>טלפון</span>
          <input {...inp} placeholder="05x-xxxxxxx" value={phone} onChange={e => setPhone(e.target.value)} />
        </div>
        <div>
          <span style={lbl}>מייל</span>
          <input {...inp} type="email" placeholder="lecturer@example.com" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
      </div>
      <div style={row}>
        <span style={lbl}>מסלולי לימוד (מופרדים בפסיק)</span>
        <input {...inp} placeholder="הנדסאי קולנוע שנה א, הנדסת קול" value={tracksRaw} onChange={e => setTracksRaw(e.target.value)} />
        {trackOptions.length > 0 && (
          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {trackOptions.map(t => (
              <button key={t} type="button"
                onClick={() => {
                  const cur = parseTracks(tracksRaw);
                  if (!cur.includes(t)) setTracksRaw([...cur, t].join(", "));
                }}
                style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, border: "1px solid var(--border)", background: parseTracks(tracksRaw).includes(t) ? "var(--accent)" : "var(--surface2)", color: parseTracks(tracksRaw).includes(t) ? "#000" : "var(--text)", cursor: "pointer" }}
              >{t}</button>
            ))}
          </div>
        )}
      </div>
      <div style={row}>
        <span style={lbl}>הערות פנימיות</span>
        <textarea {...inp} rows={2} placeholder="הערות..." value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inp.style, resize: "vertical" }} />
      </div>
      {isEdit && (
        <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" id="lec-active" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
          <label htmlFor="lec-active" style={{ fontSize: 13, cursor: "pointer" }}>פעיל</label>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-start" }}>
        <button className="btn btn-primary" onClick={() => handleSave()} disabled={saving}>{saving ? "שומר..." : isEdit ? "עדכן" : "הוסף מרצה"}</button>
        <button className="btn btn-secondary" onClick={onCancel}>ביטול</button>
      </div>
    </div>
  );
}

/* ── Main exported component ── */
export function LecturersPage({ lecturers = [], setLecturers, showToast, trackOptions = [] }) {
  const [search,      setSearch]      = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [mode,        setMode]        = useState(null); // "add" | "edit"
  const [editTarget,  setEditTarget]  = useState(null);

  const save = async (fields) => {
    let updated;
    if (editTarget) {
      updated = lecturers.map(l => l.id === editTarget.id ? makeLecturer({ ...editTarget, ...fields }) : l);
      showToast("success", "המרצה עודכן");
    } else {
      const newLec = makeLecturer(fields);
      updated = [...lecturers, newLec];
      showToast("success", "המרצה נוסף");
    }
    setLecturers(updated);
    await storageSet("lecturers", updated);
    setMode(null);
    setEditTarget(null);
  };

  const archive = async (lec) => {
    const updated = lecturers.map(l => l.id === lec.id ? makeLecturer({ ...l, isActive: !l.isActive }) : l);
    setLecturers(updated);
    await storageSet("lecturers", updated);
    showToast("success", lec.isActive ? "המרצה הועבר לארכיון" : "המרצה שוחזר");
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lecturers
      .filter(l => showInactive ? true : l.isActive !== false)
      .filter(l => !q || l.fullName.toLowerCase().includes(q) || (l.email||"").toLowerCase().includes(q) || (l.phone||"").includes(q))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, "he"));
  }, [lecturers, search, showInactive]);

  const inactiveCount = lecturers.filter(l => l.isActive === false).length;

  const th = { padding: "8px 12px", textAlign: "right", fontWeight: 800, fontSize: 12, color: "var(--text3)", borderBottom: "2px solid var(--border)", whiteSpace: "nowrap" };
  const td = { padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 13, verticalAlign: "middle" };

  if (mode) {
    return (
      <div className="page" style={{ direction: "rtl", maxWidth: 620 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => { setMode(null); setEditTarget(null); }}>← חזרה</button>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{mode === "edit" ? "עריכת מרצה" : "הוספת מרצה"}</h2>
        </div>
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
          <LecturerForm
            initial={editTarget}
            onSave={save}
            onCancel={() => { setMode(null); setEditTarget(null); }}
            lecturers={lecturers}
            trackOptions={trackOptions}
            showToast={showToast}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ direction: "rtl" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>👩‍🏫 מרצים ({lecturers.filter(l => l.isActive !== false).length})</h2>
        <button className="btn btn-primary" onClick={() => { setEditTarget(null); setMode("add"); }}>➕ הוסף מרצה</button>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <input className="form-input" placeholder="🔍 חיפוש לפי שם / מייל / טלפון" value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: "1 1 220px", maxWidth: 320 }} />
        {inactiveCount > 0 && (
          <button className={`btn btn-sm ${showInactive ? "btn-primary" : "btn-secondary"}`} onClick={() => setShowInactive(v => !v)} style={{ fontSize: 12 }}>
            {showInactive ? "הסתר" : `הצג לא פעילים (${inactiveCount})`}
          </button>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text3)" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>👩‍🏫</div>
          <div style={{ fontWeight: 700 }}>{search ? "לא נמצאו תוצאות" : "אין מרצים עדיין"}</div>
          {!search && <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => { setEditTarget(null); setMode("add"); }}>הוסף מרצה ראשון</button>}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", background: "var(--surface2)", borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)" }}>
            <thead>
              <tr style={{ background: "rgba(245,166,35,0.08)" }}>
                <th style={th}>שם מלא</th>
                <th style={th}>טלפון</th>
                <th style={th}>מייל</th>
                <th style={th}>מסלולי לימוד</th>
                <th style={th}>סטטוס</th>
                <th style={{ ...th, textAlign: "center" }}>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(lec => (
                <tr key={lec.id} style={{ opacity: lec.isActive === false ? 0.55 : 1 }}>
                  <td style={{ ...td, fontWeight: 700 }}>{lec.fullName}</td>
                  <td style={td}>{lec.phone || <span style={{ color: "var(--text3)" }}>—</span>}</td>
                  <td style={td}><span style={{ fontSize: 12 }}>{lec.email || <span style={{ color: "var(--text3)" }}>—</span>}</span></td>
                  <td style={td}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {(lec.studyTracks || []).length > 0
                        ? lec.studyTracks.map(t => (
                            <span key={t} style={{ background: "rgba(245,166,35,0.15)", color: "#f5a623", borderRadius: 12, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>{t}</span>
                          ))
                        : <span style={{ color: "var(--text3)", fontSize: 12 }}>—</span>}
                    </div>
                  </td>
                  <td style={td}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 12,
                      background: lec.isActive !== false ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.1)",
                      color: lec.isActive !== false ? "#22c55e" : "#ef4444" }}>
                      {lec.isActive !== false ? "פעיל" : "ארכיון"}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => { setEditTarget(lec); setMode("edit"); }}>✏️ ערוך</button>
                      <button className="btn btn-secondary btn-sm" style={{ color: lec.isActive !== false ? "var(--red)" : "#22c55e", borderColor: lec.isActive !== false ? "var(--red)" : "#22c55e", fontSize: 11 }}
                        onClick={() => archive(lec)}>
                        {lec.isActive !== false ? "העבר לארכיון" : "שחזר"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
