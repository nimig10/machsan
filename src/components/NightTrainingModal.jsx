// NightTrainingModal.jsx — the night-training theory exam and the closing
// checklist, in one two-tab modal opened from קביעת חדרים.
//
// Ported from a standalone tool that stored results in a Google Sheet. Three
// things changed in the port, all deliberate:
//   * The student no longer types their own name — identity comes from the
//     session, server-side (lesson #37+#41).
//   * Scoring moved to the server. This file never sees a correct answer, so
//     there is nothing here to read out of devtools.
//   * The checklist's inline <span class="warn"> markup became structured
//     `parts`, rendered as React nodes rather than dangerouslySetInnerHTML
//     (lesson #43).
//
// The parent MOUNTS this conditionally rather than passing an `open` prop: the
// component has hooks, so an `if (!open) return null` above them would break
// rules-of-hooks (an ERROR in this repo), and unmounting gives a clean reset —
// matching the original, where every opening was a fresh quiz and a fresh
// checklist.
//
// Layout uses the global .modal-overlay/.modal classes, which a media query in
// src/utils.js already turns into a bottom sheet under 768px — no isMobile here.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, CheckCircle, ClipboardList, Moon, X, XCircle } from "lucide-react";
import { CHECKLIST_ITEMS } from "../utils/nightChecklist.js";
import {
  startNightQuiz, submitNightQuiz, completeNightChecklist, fetchMyNightStatus, nightErrorMessage,
} from "../utils/nightTrainingApi.js";

const NIGHT_COLOR = "#2196f3";

// Answers survive a reload so a resumed attempt comes back complete: the server
// hands back the same questions, this hands back the same selections.
const draftKey = (attemptId) => `night_quiz_draft_${attemptId}`;

// ── presentational pieces (module level — a nested definition would be a new
// component type on every render and would remount, wiping the answers) ──────

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, padding: "10px 16px", border: "none", cursor: "pointer",
        background: active ? NIGHT_COLOR : "var(--surface2)",
        color: active ? "#fff" : "var(--text3)",
        fontWeight: 800, fontSize: 14, transition: "all 0.15s",
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
      }}
    >
      {children}
    </button>
  );
}

function ChecklistRow({ item, index, done, onToggle }) {
  return (
    <li
      onClick={onToggle}
      style={{
        display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px",
        borderRadius: 10, cursor: "pointer", marginBottom: 6,
        border: `1px solid ${done ? "var(--green)" : "var(--border)"}`,
        background: done ? "rgba(46,204,113,0.08)" : "var(--surface2)",
        opacity: done ? 0.72 : 1, transition: "all 0.15s",
      }}
    >
      <span
        aria-hidden
        style={{
          flex: "none", width: 22, height: 22, borderRadius: 6, marginTop: 1,
          border: `2px solid ${done ? "var(--green)" : "var(--border)"}`,
          background: done ? "var(--green)" : "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        {done && <Check size={14} strokeWidth={3} color="#fff" />}
      </span>
      <span style={{ flex: "none", fontWeight: 800, fontSize: 13, color: "var(--text3)", marginTop: 2 }}>
        {index + 1}.
      </span>
      {/* minWidth:0 so a long Hebrew line wraps instead of stretching the row (lesson #30+#32) */}
      <span style={{ minWidth: 0, fontSize: 14, lineHeight: 1.6, textDecoration: done ? "line-through" : "none" }}>
        {item.parts.map((p, i) => (
          <span key={i} style={p.warn ? { color: "var(--red)", fontWeight: 800 } : undefined}>{p.text}</span>
        ))}
      </span>
    </li>
  );
}

function QuizQuestion({ question, chosen, onChoose }) {
  return (
    <div>
      <span style={{
        display: "inline-block", fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 20,
        marginBottom: 12,
        background: question.type === "tf" ? "rgba(46,204,113,0.14)" : "rgba(33,150,243,0.14)",
        color: question.type === "tf" ? "var(--green)" : NIGHT_COLOR,
      }}>
        {question.type === "tf" ? "נכון / לא נכון" : "שאלה אמריקאית"}
      </span>
      <p style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.55, margin: "0 0 18px" }}>{question.question}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {question.options.map((opt, i) => {
          const selected = chosen === i;
          return (
            <label
              key={i}
              onClick={() => onChoose(i)}
              style={{
                display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", borderRadius: 10,
                cursor: "pointer", fontSize: 15,
                border: `1.5px solid ${selected ? NIGHT_COLOR : "var(--border)"}`,
                background: selected ? "rgba(33,150,243,0.10)" : "var(--surface2)",
                transition: "all 0.12s",
              }}
            >
              <span style={{
                flex: "none", width: 20, height: 20, borderRadius: "50%", position: "relative",
                border: `2px solid ${selected ? NIGHT_COLOR : "var(--text3)"}`,
              }}>
                {selected && (
                  <span style={{ position: "absolute", inset: 3, borderRadius: "50%", background: NIGHT_COLOR }} />
                )}
              </span>
              <span style={{ minWidth: 0 }}>{opt}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// The result screen. On failure it lists the questions that were missed and the
// student's own choice — but NOT the right answer. That was a deliberate design
// in the original tool (a failed attempt must not be a free answer key) and the
// server enforces it: `wrong` simply has no correct field to render.
function QuizResult({ result, onRetry, onClose }) {
  const [showReview, setShowReview] = useState(false);
  const { score, total, passed, wrong } = result;

  return (
    <div style={{ textAlign: "center" }}>
      <div style={{
        width: 76, height: 76, borderRadius: "50%", margin: "0 auto 16px",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: passed ? "rgba(46,204,113,0.14)" : "rgba(231,76,60,0.12)",
      }}>
        {passed
          ? <CheckCircle size={40} strokeWidth={1.75} color="var(--green)" />
          : <XCircle size={40} strokeWidth={1.75} color="var(--red)" />}
      </div>

      <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 8, color: passed ? "var(--green)" : "var(--red)" }}>
        {passed ? "כל הכבוד, עברת!" : "לא עברת הפעם"}
      </div>

      <div style={{ fontSize: 15, color: "var(--text2)", marginBottom: 16 }}>
        ענית נכון על <strong style={{ color: "var(--text)" }}>{score} מתוך {total}</strong> השאלות
        {passed ? " — ציון מלא 🎉" : ". כדי לעבור יש לענות נכון על כל השאלות."}
      </div>

      {passed ? (
        // Wording matters: passing the theory grants nothing by itself. A staff
        // member still decides on the practical exam and the certification.
        <div style={{
          padding: "12px 14px", borderRadius: 10, fontSize: 14, lineHeight: 1.6, textAlign: "right",
          background: "rgba(46,204,113,0.08)", border: "1px solid rgba(46,204,113,0.3)", marginBottom: 16,
        }}>
          עברת את <strong>המבחן העיוני</strong>. התוצאה נרשמה ונשלחה לצוות.
          <br />
          פנו לצוות כדי לתאם את <strong>המבחן המעשי</strong> — הסמכת הלילה ניתנת רק אחריו.
        </div>
      ) : (
        <>
          <div style={{
            padding: "12px 14px", borderRadius: 10, fontSize: 14, textAlign: "right", marginBottom: 12,
            background: "rgba(231,76,60,0.08)", border: "1px solid rgba(231,76,60,0.3)",
          }}>
            טעית בשאלות מספר:{" "}
            <span style={{ fontWeight: 800, color: "var(--red)", letterSpacing: 1 }}>
              {wrong.map((w) => w.n).join(", ")}
            </span>
            <div style={{ color: "var(--text3)", marginTop: 4 }}>
              חזרו על הנהלים ונסו שוב — בכל ניסיון מוגרלות שאלות חדשות.
            </div>
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowReview((v) => !v)}
            style={{ width: "100%", justifyContent: "center", marginBottom: 12 }}
          >
            {showReview ? "🔽 הסתר את השאלות שטעיתי בהן" : "📋 הצג את השאלות שטעיתי בהן"}
          </button>

          {showReview && (
            <div style={{ textAlign: "right", marginBottom: 12 }}>
              {wrong.map((w) => (
                <div key={w.n} style={{
                  background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10,
                  padding: "10px 12px", marginBottom: 8,
                }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                    <span style={{ color: "var(--text3)", fontWeight: 800 }}>{w.n}.</span> {w.question}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--red)" }}>
                    ✗ הבחירה שלך: {w.chosen || "(לא נענתה)"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" onClick={onRetry} style={{ flex: 1, justifyContent: "center" }}>
          {passed ? "התחל מבחן חדש ↺" : "נסה שוב ↺"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>
          סגירה
        </button>
      </div>
    </div>
  );
}

// ── the modal ───────────────────────────────────────────────────────────────

export function NightTrainingModal({ onClose, showToast, studentName = "" }) {
  const [tab, setTab] = useState("quiz");

  // quiz
  const [phase, setPhase] = useState("intro"); // intro | running | result
  const [busy, setBusy] = useState(false);
  const [attemptId, setAttemptId] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});   // presented position n -> option index
  const [current, setCurrent] = useState(0);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState(null);   // { passedTheory, attempts, lastChecklistAt }

  // checklist
  const [checked, setChecked] = useState(() => CHECKLIST_ITEMS.map(() => false));
  const [checklistSaving, setChecklistSaving] = useState(false);
  const [checklistDone, setChecklistDone] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchMyNightStatus().then((r) => { if (alive && r.ok) setStatus(r); });
    return () => { alive = false; };
  }, []);

  const beginQuiz = useCallback(async () => {
    setBusy(true);
    const r = await startNightQuiz();
    setBusy(false);
    if (!r.ok) { showToast("error", nightErrorMessage(r.error)); return; }

    setAttemptId(r.attemptId);
    setQuestions(r.questions || []);
    setResult(null);
    setCurrent(0);

    // A resumed attempt keeps its questions; restore the selections to match.
    let restored = {};
    if (r.resumed) {
      try { restored = JSON.parse(sessionStorage.getItem(draftKey(r.attemptId)) || "{}") || {}; } catch { restored = {}; }
    }
    setAnswers(restored);
    setPhase("running");
    if (r.resumed && Object.keys(restored).length) {
      showToast("success", "חזרת למבחן שכבר התחלת.");
    }
  }, [showToast]);

  const choose = useCallback((n, choice) => {
    setAnswers((prev) => {
      const next = { ...prev, [n]: choice };
      if (attemptId) {
        try { sessionStorage.setItem(draftKey(attemptId), JSON.stringify(next)); } catch { /* quota — the answer still counts */ }
      }
      return next;
    });
  }, [attemptId]);

  const finish = useCallback(async () => {
    if (!attemptId) return;
    setBusy(true);
    const payload = questions.map((q) => ({
      n: q.n,
      choice: Number.isInteger(answers[q.n]) ? answers[q.n] : null,
    }));
    const r = await submitNightQuiz(attemptId, payload);
    setBusy(false);
    if (!r.ok) { showToast("error", nightErrorMessage(r.error)); return; }

    try { sessionStorage.removeItem(draftKey(attemptId)); } catch { /* ignore */ }
    setResult({ score: r.score, total: r.total, passed: r.passed, wrong: r.wrong || [] });
    setPhase("result");
    if (r.passed) setStatus((s) => ({ ...(s || {}), passedTheory: true }));
  }, [attemptId, answers, questions, showToast]);

  // Ticking the last box opens the confirmation, as in the original. Done here
  // rather than in an effect watching `allChecked`: this is a reaction to a
  // click, not to a render, and an effect would be a cascading setState.
  const toggleChecklistItem = useCallback((i) => {
    const next = [...checked];
    next[i] = !next[i];
    setChecked(next);
    if (!checklistDone && next.every(Boolean)) setConfirmOpen(true);
  }, [checked, checklistDone]);

  const doneCount = useMemo(() => checked.filter(Boolean).length, [checked]);
  const allChecked = doneCount === CHECKLIST_ITEMS.length;

  const submitChecklist = useCallback(async () => {
    setChecklistSaving(true);
    const r = await completeNightChecklist();
    setChecklistSaving(false);
    if (!r.ok) { showToast("error", nightErrorMessage(r.error)); return; }
    setChecklistDone(true);
    setConfirmOpen(false);
    showToast("success", "הנעילה דווחה. תודה!");
  }, [showToast]);

  const answeredCurrent = questions[current] && Number.isInteger(answers[questions[current].n]);
  const unanswered = questions.filter((q) => !Number.isInteger(answers[q.n])).length;
  const isLast = current === questions.length - 1;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <span className="modal-title" style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <Moon size={16} strokeWidth={1.75} color={NIGHT_COLOR} /> תרגול לילה
          </span>
          <button className="btn btn-secondary btn-sm btn-icon" onClick={onClose} aria-label="סגור">
            <X size={16} strokeWidth={1.75} color="var(--text3)" />
          </button>
        </div>

        <div className="modal-body" style={{ direction: "rtl" }}>
          <div style={{
            display: "flex", borderRadius: 10, overflow: "hidden",
            border: "1px solid var(--border)", marginBottom: 16,
          }}>
            <TabButton active={tab === "quiz"} onClick={() => setTab("quiz")}>
              📝 מבחן לילה
            </TabButton>
            <TabButton active={tab === "checklist"} onClick={() => setTab("checklist")}>
              <ClipboardList size={15} strokeWidth={1.75} /> צ'ק ליסט נעילה
            </TabButton>
          </div>

          {tab === "quiz" && phase === "intro" && (
            <div>
              <p style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.7, margin: "0 0 14px" }}>
                מבחן קצר על נהלי תרגול הלילה. מוגרלות <strong>15 שאלות</strong>, ויש לענות נכון על
                <strong> כולן</strong> כדי לעבור. בכל ניסיון מוגרלות שאלות חדשות.
              </p>
              {status?.passedTheory && (
                <div style={{
                  padding: "10px 12px", borderRadius: 10, fontSize: 13, marginBottom: 14,
                  background: "rgba(46,204,113,0.08)", border: "1px solid rgba(46,204,113,0.3)",
                }}>
                  <CheckCircle size={14} strokeWidth={1.75} color="var(--green)" /> כבר עברת את המבחן העיוני.
                  אפשר לתרגל שוב בכל עת.
                </div>
              )}
              <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 16 }}>
                נבחן/ת: <strong style={{ color: "var(--text)" }}>{studentName || "—"}</strong>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={beginQuiz}
                disabled={busy}
                style={{ width: "100%", justifyContent: "center" }}
              >
                {busy ? "טוען…" : "התחל מבחן ▸"}
              </button>
            </div>
          )}

          {tab === "quiz" && phase === "running" && questions.length > 0 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ fontWeight: 800, fontSize: 14 }}>
                  שאלה {current + 1} מתוך {questions.length}
                </span>
                <span style={{ fontSize: 12, color: "var(--text3)", minWidth: 0, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {studentName}
                </span>
              </div>
              <div style={{ height: 7, background: "var(--surface2)", borderRadius: 99, overflow: "hidden", margin: "0 0 18px" }}>
                <div style={{
                  height: "100%", width: `${(current / questions.length) * 100}%`,
                  background: NIGHT_COLOR, borderRadius: 99, transition: "width 0.25s ease",
                }} />
              </div>

              <QuizQuestion
                question={questions[current]}
                chosen={answers[questions[current].n]}
                onChoose={(choice) => choose(questions[current].n, choice)}
              />

              <div style={{ display: "flex", gap: 8, marginTop: 22 }}>
                {current > 0 && (
                  <button type="button" className="btn btn-secondary" onClick={() => setCurrent((c) => c - 1)}
                    style={{ flex: 1, justifyContent: "center" }}>
                    ◂ הקודם
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!answeredCurrent || busy}
                  onClick={() => {
                    if (!isLast) { setCurrent((c) => c + 1); return; }
                    if (unanswered > 0 && !window.confirm(`נותרו ${unanswered} שאלות ללא מענה. לסיים בכל זאת?`)) return;
                    finish();
                  }}
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  {busy ? "שולח…" : isLast ? "סיים מבחן ✓" : "הבא ▸"}
                </button>
              </div>
            </div>
          )}

          {tab === "quiz" && phase === "result" && result && (
            <QuizResult result={result} onRetry={beginQuiz} onClose={onClose} />
          )}

          {tab === "checklist" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <p style={{ fontSize: 13, color: "var(--text2)", margin: 0 }}>
                  סמנו כל משימה לפי הסדר בסוף הלילה.
                </p>
                <span style={{ fontWeight: 800, fontSize: 13, color: NIGHT_COLOR, whiteSpace: "nowrap" }}>
                  {doneCount}/{CHECKLIST_ITEMS.length}
                </span>
              </div>
              <div style={{ height: 7, background: "var(--surface2)", borderRadius: 99, overflow: "hidden", marginBottom: 14 }}>
                <div style={{
                  height: "100%", width: `${(doneCount / CHECKLIST_ITEMS.length) * 100}%`,
                  background: "var(--green)", borderRadius: 99, transition: "width 0.25s ease",
                }} />
              </div>

              {checklistDone && (
                <div style={{
                  padding: "12px 14px", borderRadius: 10, fontSize: 14, marginBottom: 14,
                  background: "rgba(46,204,113,0.08)", border: "1px solid rgba(46,204,113,0.3)",
                }}>
                  <CheckCircle size={15} strokeWidth={1.75} color="var(--green)" /> הנעילה דווחה. אפשר לצאת בבטחה 🌙
                </div>
              )}

              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {CHECKLIST_ITEMS.map((item, i) => (
                  <ChecklistRow
                    key={item.id}
                    item={item}
                    index={i}
                    done={checked[i]}
                    onToggle={() => toggleChecklistItem(i)}
                  />
                ))}
              </ul>

              <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { setChecked(CHECKLIST_ITEMS.map(() => false)); setChecklistDone(false); }}
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  איפוס הסימונים ↺
                </button>
                {allChecked && !checklistDone && (
                  <button type="button" className="btn btn-primary" onClick={() => setConfirmOpen(true)}
                    style={{ flex: 1, justifyContent: "center" }}>
                    דיווח סיום נעילה
                  </button>
                )}
              </div>

              {confirmOpen && !checklistDone && (
                <div style={{
                  marginTop: 14, padding: 16, borderRadius: 12, textAlign: "center",
                  background: "var(--surface2)", border: `1px solid ${NIGHT_COLOR}`,
                }}>
                  <div style={{ fontSize: 30, marginBottom: 6 }}>🎉</div>
                  <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>סיימת את כל הצ'ק ליסט!</div>
                  <p style={{ fontSize: 13, color: "var(--text2)", margin: "0 0 12px", lineHeight: 1.6 }}>
                    הדיווח יירשם על שם <strong style={{ color: "var(--text)" }}>{studentName || "המשתמש המחובר"}</strong>.
                  </p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-primary" onClick={submitChecklist} disabled={checklistSaving}
                      style={{ flex: 1, justifyContent: "center" }}>
                      {checklistSaving ? "שולח…" : "אני מאשר/ת שביצעתי את כל שלבי הנעילה"}
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => setConfirmOpen(false)}
                      style={{ justifyContent: "center" }}>
                      עוד לא
                    </button>
                  </div>
                </div>
              )}

              <div style={{
                marginTop: 14, fontSize: 12, color: "var(--text3)", display: "flex", alignItems: "flex-start", gap: 6,
              }}>
                <AlertTriangle size={13} strokeWidth={1.75} style={{ flex: "none", marginTop: 2 }} />
                <span style={{ minWidth: 0 }}>הסימונים אינם נשמרים — הם מתאפסים בסגירת החלון. רק דיווח הסיום נרשם.</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default NightTrainingModal;
