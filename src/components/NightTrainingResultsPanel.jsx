// NightTrainingResultsPanel.jsx — what staff see instead of the Google Sheet
// the night-training tool used to write to.
//
// Two views: who sat the theory exam (and who passed it), and which closings
// were reported. Read-only — passing the exam grants nothing on its own, so
// nothing here writes. The "עבר/ה 🌙" toggle in the certifications table below
// remains the only way to grant cert_night_studio; this panel exists so that
// decision is made with the exam results on screen.
//
// Expanding an attempt shows the full per-question breakdown INCLUDING the
// correct answers. That is staff-only by construction: the payload comes from
// /api/night-training staff-list/staff-attempt, both behind requireStaff, and
// the tables are service-role-only so the browser cannot reach them directly.

import { useCallback, useMemo, useState } from "react";
import { CheckCircle, ClipboardList, Moon, Search, XCircle } from "lucide-react";
import { staffGetNightAttempt } from "../utils/nightTrainingApi.js";

const NIGHT_COLOR = "#2196f3";

// These are timestamptz values, not the HH:MM:SS text columns formatTime exists
// for (lesson #18) — so they get a real locale format, pinned to Israel time.
function fmtDateTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("he-IL", {
      timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

function StatCard({ value, label, color }) {
  return (
    <div style={{
      background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10,
      padding: "10px 16px", textAlign: "center", minWidth: 110,
    }}>
      <div style={{ fontSize: 22, fontWeight: 900, color: color || "var(--text)" }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 700 }}>{label}</div>
    </div>
  );
}

function AttemptBreakdown({ answers }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
      {answers.map((a) => (
        <div
          key={a.question_number}
          style={{
            background: "var(--surface2)", borderRadius: 8, padding: "8px 10px",
            border: `1px solid ${a.is_correct ? "rgba(46,204,113,0.35)" : "rgba(231,76,60,0.35)"}`,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>
            <span style={{ color: "var(--text3)", fontWeight: 800 }}>{a.question_number}.</span> {a.question_text}
          </div>
          <div style={{ fontSize: 12, color: a.is_correct ? "var(--green)" : "var(--red)" }}>
            {a.is_correct ? "✓" : "✗"} סימן: {a.chosen_text || "(לא נענתה)"}
          </div>
          {!a.is_correct && (
            <div style={{ fontSize: 12, color: "var(--green)" }}>✔ התשובה הנכונה: {a.correct_text}</div>
          )}
        </div>
      ))}
      {answers.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--text3)" }}>אין פירוט שמור לניסיון הזה.</div>
      )}
    </div>
  );
}

export function NightTrainingResultsPanel({ data, loading, onRefresh, showToast }) {
  const [view, setView] = useState("quiz"); // quiz | checklist
  const [search, setSearch] = useState("");
  const [openAttemptId, setOpenAttemptId] = useState(null);
  const [attemptDetail, setAttemptDetail] = useState({}); // attemptId -> answers[]
  const [loadingAttempt, setLoadingAttempt] = useState(null);

  const students = useMemo(() => data?.students || [], [data]);
  const checklists = useMemo(() => data?.checklists || [], [data]);

  const q = search.trim().toLowerCase();
  const filteredStudents = useMemo(() => (
    !q ? students : students.filter((s) =>
      String(s.name || "").toLowerCase().includes(q) ||
      String(s.email || "").toLowerCase().includes(q) ||
      String(s.track || "").toLowerCase().includes(q))
  ), [students, q]);

  const filteredChecklists = useMemo(() => (
    !q ? checklists : checklists.filter((c) =>
      String(c.student_name || "").toLowerCase().includes(q) ||
      String(c.track_name || "").toLowerCase().includes(q))
  ), [checklists, q]);

  const passedCount = useMemo(() => students.filter((s) => s.passedTheory).length, [students]);

  const toggleAttempt = useCallback(async (attemptId) => {
    if (openAttemptId === attemptId) { setOpenAttemptId(null); return; }
    setOpenAttemptId(attemptId);
    if (attemptDetail[attemptId]) return;
    setLoadingAttempt(attemptId);
    const r = await staffGetNightAttempt(attemptId);
    setLoadingAttempt(null);
    if (!r.ok) { showToast?.("error", "לא ניתן לטעון את פירוט המבחן."); return; }
    setAttemptDetail((prev) => ({ ...prev, [attemptId]: r.answers || [] }));
  }, [openAttemptId, attemptDetail, showToast]);

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div className="card-title" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Moon size={16} strokeWidth={1.75} color={NIGHT_COLOR} /> מבחן לילה עיוני וצ'ק ליסט נעילה
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRefresh} disabled={loading}>
          {loading ? "טוען…" : "🔄 רענן"}
        </button>
      </div>

      {/* The decision this panel informs is NOT automatic — say so where staff act. */}
      <div style={{
        fontSize: 12, color: "var(--text2)", background: "rgba(33,150,243,0.07)",
        border: `1px solid ${NIGHT_COLOR}40`, borderRadius: 8, padding: "8px 12px", marginBottom: 12, lineHeight: 1.6,
      }}>
        מעבר המבחן העיוני <strong>אינו מקנה הסמכה</strong> — הוא מסמן מי מוכן לגשת למבחן המעשי.
        הסמכת הלילה ניתנת ידנית בטבלה שלמטה.
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <StatCard value={passedCount} label="עברו עיוני" color="var(--green)" />
        <StatCard value={students.length} label="נבחנו" color={NIGHT_COLOR} />
        <StatCard value={checklists.length} label="נעילות דווחו" />
      </div>

      <div style={{ display: "flex", gap: 0, marginBottom: 12, borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)", width: "fit-content" }}>
        <button type="button" onClick={() => setView("quiz")}
          style={{ padding: "8px 18px", border: "none", cursor: "pointer", fontWeight: 800, fontSize: 13,
            background: view === "quiz" ? NIGHT_COLOR : "var(--surface2)", color: view === "quiz" ? "#fff" : "var(--text3)" }}>
          תוצאות מבחן
        </button>
        <button type="button" onClick={() => setView("checklist")}
          style={{ padding: "8px 18px", border: "none", borderRight: "1px solid var(--border)", cursor: "pointer", fontWeight: 800, fontSize: 13,
            background: view === "checklist" ? NIGHT_COLOR : "var(--surface2)", color: view === "checklist" ? "#fff" : "var(--text3)" }}>
          נעילות שדווחו
        </button>
      </div>

      <div className="search-bar" style={{ marginBottom: 12, maxWidth: 320 }}>
        <span><Search size={16} strokeWidth={1.75} color="var(--text3)" /></span>
        <input placeholder="חיפוש לפי שם או מסלול..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {view === "quiz" && (
        filteredStudents.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text3)", padding: "8px 0" }}>
            {loading ? "טוען…" : "אף סטודנט לא ניגש עדיין למבחן."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filteredStudents.map((s) => (
              <div key={s.studentId} style={{
                border: `1px solid ${s.passedTheory ? "rgba(46,204,113,0.35)" : "var(--border)"}`,
                borderRadius: 10, padding: "10px 12px", background: "var(--surface)",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)" }}>
                      {s.track || "ללא מסלול"} · {s.attemptsCount} ניסיונות · אחרון: {fmtDateTime(s.lastAttemptAt)}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text2)" }}>
                      הכי טוב: {s.bestScore}/{s.total}
                    </span>
                    {s.passedTheory ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(46,204,113,0.15)", border: "1px solid var(--green)", color: "var(--green)", borderRadius: 20, padding: "3px 12px", fontSize: 11, fontWeight: 800 }}>
                        <CheckCircle size={12} strokeWidth={2} /> עבר עיוני
                      </span>
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text3)", borderRadius: 20, padding: "3px 12px", fontSize: 11, fontWeight: 800 }}>
                        <XCircle size={12} strokeWidth={2} /> טרם עבר
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {s.attempts.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggleAttempt(a.id)}
                      style={{
                        padding: "3px 10px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700,
                        border: `1px solid ${a.passed ? "var(--green)" : "var(--border)"}`,
                        background: openAttemptId === a.id ? "var(--surface2)" : "transparent",
                        color: a.passed ? "var(--green)" : "var(--text2)",
                      }}
                    >
                      {a.score}/{a.total} · {fmtDateTime(a.submittedAt)}
                    </button>
                  ))}
                </div>

                {openAttemptId && s.attempts.some((a) => a.id === openAttemptId) && (
                  loadingAttempt === openAttemptId
                    ? <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 8 }}>טוען פירוט…</div>
                    : <AttemptBreakdown answers={attemptDetail[openAttemptId] || []} />
                )}
              </div>
            ))}
          </div>
        )
      )}

      {view === "checklist" && (
        filteredChecklists.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text3)", padding: "8px 0" }}>
            {loading ? "טוען…" : "לא דווחו נעילות עדיין."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filteredChecklists.map((c) => (
              <div key={c.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap",
                border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", background: "var(--surface)",
              }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>
                    <ClipboardList size={13} strokeWidth={1.75} /> {c.student_name}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text3)", marginRight: 8 }}>{c.track_name || "ללא מסלול"}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text2)", whiteSpace: "nowrap" }}>
                  {fmtDateTime(c.completed_at)}
                  <span style={{ color: "var(--text3)", marginRight: 6 }}>(ליל {c.completed_on})</span>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

export default NightTrainingResultsPanel;
