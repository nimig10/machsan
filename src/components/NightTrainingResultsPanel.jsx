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
import { CheckCircle, ChevronDown, ChevronUp, ClipboardList, Moon, Search, XCircle } from "lucide-react";
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

// A closing report carries TWO dates that are trivially confused: `completed_at`
// is the moment the student pressed the button, `completed_on` is the night the
// report belongs to (01:30 belongs to the previous evening). Squeezed onto one
// line they read as a contradiction, so each gets its own labelled line.
function fmtReportMoment(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const tz = { timeZone: "Asia/Jerusalem" };
    return {
      day: d.toLocaleDateString("he-IL", { ...tz, weekday: "long" }),
      date: d.toLocaleDateString("he-IL", { ...tz, day: "2-digit", month: "2-digit", year: "numeric" }),
      time: d.toLocaleTimeString("he-IL", { ...tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    };
  } catch { return null; }
}

// completed_on is a plain YYYY-MM-DD date column — parsed by hand so no timezone
// ever shifts it a day, which is the whole point of storing it as a date.
function fmtNightDate(dateStr) {
  const [y, m, d] = String(dateStr || "").split("-");
  return y && m && d ? `${d}.${m}.${y}` : (dateStr || "—");
}

const ALL_TRACKS = "";      // the default filter value
const NO_TRACK = "__none__"; // rows whose track is empty
const trackKey = (t) => (String(t || "").trim() || NO_TRACK);

// Compact counter for the collapsed header row, so shutting the panel does not
// hide the one number staff actually scan for.
function SummaryChip({ value, label, color }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "baseline", gap: 4,
      background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 20,
      padding: "2px 10px", whiteSpace: "nowrap",
    }}>
      <strong style={{ fontSize: 13, fontWeight: 900, color: color || "var(--text)" }}>{value}</strong>
      <span style={{ fontSize: 11, color: "var(--text3)", fontWeight: 700 }}>{label}</span>
    </span>
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
  const [open, setOpen] = useState(false);  // reference panel — shut by default
  const [view, setView] = useState("quiz"); // quiz | checklist
  const [search, setSearch] = useState("");
  const [track, setTrack] = useState(ALL_TRACKS);
  const [openAttemptId, setOpenAttemptId] = useState(null);
  const [attemptDetail, setAttemptDetail] = useState({}); // attemptId -> answers[]
  const [loadingAttempt, setLoadingAttempt] = useState(null);

  const students = useMemo(() => data?.students || [], [data]);
  const checklists = useMemo(() => data?.checklists || [], [data]);

  // The search box is name-only now that tracks have their own dropdown —
  // typing a track name and getting name matches too was the ambiguity.
  const q = search.trim().toLowerCase();
  const matchesName = useCallback((name) => !q || String(name || "").toLowerCase().includes(q), [q]);
  const matchesTrack = useCallback((t) => track === ALL_TRACKS || trackKey(t) === track, [track]);

  // Options come from the rows the current tab actually renders, so the menu can
  // never offer a track that yields an empty list (lesson #34).
  const trackOptions = useMemo(() => {
    const raw = view === "quiz" ? students.map((s) => s.track) : checklists.map((c) => c.track_name);
    const named = [...new Set(raw.map((t) => String(t || "").trim()).filter(Boolean))];
    named.sort((a, b) => a.localeCompare(b, "he"));
    return { named, hasNone: raw.some((t) => !String(t || "").trim()) };
  }, [view, students, checklists]);

  // Switching tabs can drop the selected track out of the option list; falling
  // back to "all" here (a reaction to the click) keeps the select from showing
  // a blank value, and avoids a setState-in-effect cascade.
  const switchView = useCallback((next) => {
    setView(next);
    if (track === ALL_TRACKS) return;
    const raw = next === "quiz" ? students.map((s) => s.track) : checklists.map((c) => c.track_name);
    if (!raw.some((t) => trackKey(t) === track)) setTrack(ALL_TRACKS);
  }, [track, students, checklists]);

  const filteredStudents = useMemo(
    () => students.filter((s) => matchesName(s.name) && matchesTrack(s.track)),
    [students, matchesName, matchesTrack],
  );

  const filteredChecklists = useMemo(
    () => checklists.filter((c) => matchesName(c.student_name) && matchesTrack(c.track_name)),
    [checklists, matchesName, matchesTrack],
  );

  const passedCount = useMemo(() => students.filter((s) => s.passedTheory).length, [students]);

  const filtering = q !== "" || track !== ALL_TRACKS;
  const shown = view === "quiz" ? filteredStudents.length : filteredChecklists.length;
  const totalRows = view === "quiz" ? students.length : checklists.length;

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
      {/* Collapsed by default: this is a reference panel, and the page's real
          work is the certifications table below it. The counters stay on the
          collapsed row so it is still informative shut.
          NOTE: collapsing hides the body only — the fetch lives in
          CertificationsPage and runs either way, because the "עבר עיוני" badge
          in the table below is derived from the same data. */}
      <div
        onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", flexWrap: "wrap" }}
      >
        <div className="card-title" style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: 0 }}>
          <Moon size={16} strokeWidth={1.75} color={NIGHT_COLOR} /> מבחן לילה עיוני וצ'ק ליסט נעילה
        </div>

        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <SummaryChip value={passedCount} label="עברו עיוני" color="var(--green)" />
          <SummaryChip value={students.length} label="נבחנו" color={NIGHT_COLOR} />
          <SummaryChip value={checklists.length} label="דיווחי נעילה" color="var(--text3)" />
          {loading && <span style={{ fontSize: 11, color: "var(--text3)" }}>טוען…</span>}
        </div>

        {open && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={(e) => { e.stopPropagation(); onRefresh(); }}
            disabled={loading}
          >
            {loading ? "טוען…" : "🔄 רענן"}
          </button>
        )}
        {open
          ? <ChevronUp size={18} strokeWidth={1.75} color="var(--accent)" />
          : <ChevronDown size={18} strokeWidth={1.75} color="var(--text3)" />}
      </div>

      {open && (<>

      <div style={{ height: 12 }} />

      {/* The decision this panel informs is NOT automatic — say so where staff act. */}
      <div style={{
        fontSize: 12, color: "var(--text2)", background: "rgba(33,150,243,0.07)",
        border: `1px solid ${NIGHT_COLOR}40`, borderRadius: 8, padding: "8px 12px", marginBottom: 12, lineHeight: 1.6,
      }}>
        מעבר המבחן העיוני <strong>אינו מקנה הסמכה</strong> — הוא מסמן מי מוכן לגשת למבחן המעשי.
        הסמכת הלילה ניתנת ידנית בטבלה שלמטה.
      </div>

      {/* No stat cards here — the same three counters already sit in the header
          row, which stays visible whether the panel is open or shut. */}

      <div style={{ display: "flex", gap: 0, marginBottom: 12, borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)", width: "fit-content" }}>
        <button type="button" onClick={() => switchView("quiz")}
          style={{ padding: "8px 18px", border: "none", cursor: "pointer", fontWeight: 800, fontSize: 13,
            background: view === "quiz" ? NIGHT_COLOR : "var(--surface2)", color: view === "quiz" ? "#fff" : "var(--text3)" }}>
          תוצאות מבחן
        </button>
        <button type="button" onClick={() => switchView("checklist")}
          style={{ padding: "8px 18px", border: "none", borderRight: "1px solid var(--border)", cursor: "pointer", fontWeight: 800, fontSize: 13,
            background: view === "checklist" ? NIGHT_COLOR : "var(--surface2)", color: view === "checklist" ? "#fff" : "var(--text3)" }}>
          דיווחי סיום נעילה
        </button>
      </div>

      {view === "checklist" && (
        <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10, lineHeight: 1.6 }}>
          מי סיים את צ'ק ליסט הנעילה (26 השלבים) ודיווח על כך בסוף הלילה.
          «ליל» הוא הלילה שאליו הדיווח שייך — דיווח אחרי חצות נרשם על הלילה שהתחיל בערב הקודם.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div className="search-bar" style={{ flex: "1 1 220px", minWidth: 0, maxWidth: 320, marginBottom: 0 }}>
          <span><Search size={16} strokeWidth={1.75} color="var(--text3)" /></span>
          <input placeholder="חיפוש לפי שם הסטודנט..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <select
          className="form-select"
          value={track}
          onChange={(e) => setTrack(e.target.value)}
          style={{ flex: "0 1 220px", minWidth: 0, borderColor: track !== ALL_TRACKS ? NIGHT_COLOR : undefined }}
        >
          <option value={ALL_TRACKS}>כל המסלולים</option>
          {trackOptions.named.map((t) => <option key={t} value={t}>{t}</option>)}
          {trackOptions.hasNone && <option value={NO_TRACK}>ללא מסלול</option>}
        </select>

        {filtering && (
          <span style={{ fontSize: 12, color: "var(--text3)", whiteSpace: "nowrap" }}>
            מציג {shown} מתוך {totalRows}
          </span>
        )}
      </div>

      {view === "quiz" && (
        filteredStudents.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text3)", padding: "8px 0" }}>
            {loading ? "טוען…" : "אף סטודנט לא ניגש עדיין למבחן."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filteredStudents.map((s) => (
              // Green border for a pass, red for a fail — a neutral border read
              // as "no result yet" rather than "did not pass".
              <div key={s.studentId} style={{
                border: `1px solid ${s.passedTheory ? "rgba(46,204,113,0.35)" : "rgba(231,76,60,0.35)"}`,
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
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(231,76,60,0.15)", border: "1px solid var(--red)", color: "var(--red)", borderRadius: 20, padding: "3px 12px", fontSize: 11, fontWeight: 800 }}>
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
            {filteredChecklists.map((c) => {
              const at = fmtReportMoment(c.completed_at);
              return (
                <div key={c.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap",
                  border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", background: "var(--surface)",
                }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>
                      <ClipboardList size={13} strokeWidth={1.75} /> {c.student_name}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text3)", marginRight: 8 }}>{c.track_name || "ללא מסלול"}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--text2)", minWidth: 0 }}>
                    <div>
                      <span style={{ color: "var(--text3)" }}>הדיווח התקבל ב־</span>
                      <strong style={{ color: "var(--text)" }}>{at ? `${at.day}, ${at.date}` : "—"}</strong>
                      {at && <>
                        <span style={{ color: "var(--text3)" }}> בשעה </span>
                        <strong style={{ color: "var(--text)" }}>{at.time}</strong>
                      </>}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 2 }}>
                      <Moon size={11} strokeWidth={1.75} color={NIGHT_COLOR} />{" "}
                      שייך ללילה שהתחיל ב־{fmtNightDate(c.completed_on)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      </>)}
    </div>
  );
}

export default NightTrainingResultsPanel;
