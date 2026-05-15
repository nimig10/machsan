// ProductionsPage — לוח הפקות. Three tabs: public board, my productions, new.
// Visible to all roles; behaviour differs for the logged-in director.

import { useMemo, useState } from "react";
import { Plus, Film, Users, Calendar as CalendarIcon, Inbox, Check, X as XIcon, ExternalLink } from "lucide-react";
import { Modal, statusBadge } from "./ui.jsx";
import { ProductionEditor } from "./ProductionEditor.jsx";
import {
  approveCrewMember,
  rejectCrewMember,
  requestJoinProduction,
} from "../utils/productionsApi.js";

const ROLE_LABELS = {
  photographer:           "צלם",
  sound:                  "סאונדמן",
  assistant_photographer: "עוזר צלם",
  assistant_director:     "עוזר במאי",
  producer:               "מפיק",
};
const ROLE_ORDER = ["photographer","sound","assistant_photographer","assistant_director","producer"];

function fmtDate(d) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("he-IL", { day:"2-digit", month:"2-digit", year:"numeric" });
  } catch { return d; }
}
function nextDateOf(p) {
  const dates = (p?.dates || []).map(d => `${d.startDate}T${d.startTime || "00:00"}`).filter(Boolean);
  if (dates.length === 0) return null;
  dates.sort();
  return dates[0];
}

function ProductionCard({ p, onClick }) {
  const next = nextDateOf(p);
  const crewByRole = (p.crew || []).filter(c => c.status === "approved")
    .reduce((acc, c) => { acc[c.role] = (acc[c.role] || 0) + 1; return acc; }, {});
  return (
    <div onClick={onClick} style={{
      border:"1px solid #ddd", borderRadius:8, padding:14, cursor:"pointer",
      background:"#fff", boxShadow:"0 1px 3px rgba(0,0,0,0.06)",
    }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:8}}>
        <h4 style={{margin:0,fontSize:16}}>{p.title}</h4>
        {statusBadge(p.status === "published" ? "מאושר" : "ממתין")}
      </div>
      <div style={{fontSize:13,color:"#666",marginBottom:4}}>במאי: {p.directorName}</div>
      {next && <div style={{fontSize:13,color:"#666",marginBottom:4}}>תאריך קרוב: {fmtDate(next.slice(0,10))}</div>}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8,fontSize:11}}>
        {ROLE_ORDER.map(role => crewByRole[role] ? (
          <span key={role} style={{background:"#eef",padding:"2px 8px",borderRadius:10}}>{ROLE_LABELS[role]}</span>
        ) : null)}
      </div>
    </div>
  );
}

function ProductionDetail({ p, currentStudent, students, onClose, onEdit, onJoinRequest, onApprove, onReject, onOpenLoanForm }) {
  if (!p) return null;
  const isDirector = currentStudent && p.directorEmail &&
    String(currentStudent.email || "").toLowerCase() === String(p.directorEmail).toLowerCase();
  const myStudentId = currentStudent?.id;
  const alreadyMember = (p.crew || []).some(c => c.studentId === myStudentId || c.crewEmail?.toLowerCase() === String(currentStudent?.email || "").toLowerCase());

  return (
    <Modal title={`הפקה: ${p.title}`} onClose={onClose} size="modal-lg" footer={
      <div style={{display:"flex",gap:8,justifyContent:"space-between",flexWrap:"wrap"}}>
        <div>
          {isDirector && (
            <button className="btn btn-secondary btn-sm" onClick={() => onEdit(p)}>עריכה</button>
          )}
        </div>
        <div style={{display:"flex",gap:8}}>
          {isDirector && p.status === "published" && (
            <button className="btn btn-primary btn-sm" onClick={() => onOpenLoanForm(p)}>
              <ExternalLink size={14}/> השאלת ציוד להפקה
            </button>
          )}
          {!isDirector && !alreadyMember && currentStudent?.id && p.status === "published" && (
            <button className="btn btn-primary btn-sm" onClick={() => onJoinRequest(p)}>
              <Users size={14}/> אני רוצה להצטרף
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={onClose}>סגירה</button>
        </div>
      </div>
    }>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:13,color:"#666"}}>במאי: {p.directorName}</div>
        {p.description && (
          <p style={{whiteSpace:"pre-wrap",marginTop:8,fontSize:14,lineHeight:1.5}}>{p.description}</p>
        )}
      </div>

      <h5 style={{margin:"12px 0 6px"}}><CalendarIcon size={14} style={{verticalAlign:"middle"}}/> תאריכי צילום</h5>
      {(p.dates || []).length === 0 ? <p style={{color:"#888",fontSize:13}}>אין תאריכים</p> : (
        <ul style={{margin:0,paddingInlineStart:20,fontSize:13}}>
          {p.dates.map(d => (
            <li key={d.id}>
              {fmtDate(d.startDate)} {d.startTime} – {d.startDate === d.endDate ? "" : fmtDate(d.endDate) + " "}{d.endTime}
              {d.note ? <span style={{color:"#888"}}> — {d.note}</span> : null}
            </li>
          ))}
        </ul>
      )}

      <h5 style={{margin:"12px 0 6px"}}><Users size={14} style={{verticalAlign:"middle"}}/> צוות</h5>
      {ROLE_ORDER.map(role => {
        const inRole = (p.crew || []).filter(c => c.role === role);
        if (inRole.length === 0) return (
          <div key={role} style={{fontSize:13,marginBottom:4}}>
            <strong>{ROLE_LABELS[role]}:</strong> <span style={{color:"#888"}}>— פנוי —</span>
          </div>
        );
        return inRole.map(c => {
          const stu = students.find(s => String(s.id) === String(c.studentId));
          const name = stu?.name || c.freeTextName || "?";
          return (
            <div key={c.id} style={{fontSize:13,marginBottom:4,display:"flex",alignItems:"center",gap:6}}>
              <strong>{ROLE_LABELS[role]}:</strong>
              <span>{name}</span>
              <span style={{
                fontSize:11,
                padding:"1px 6px",
                borderRadius:8,
                background: c.status === "approved" ? "#dfd" : c.status === "invited" ? "#ffe" : "#fdd",
                color: c.status === "approved" ? "#0a0" : c.status === "invited" ? "#a80" : "#a00",
              }}>
                {c.status === "approved" ? "מאושר" : c.status === "invited" ? "ממתין" : "נדחה"}
              </span>
              {isDirector && c.status === "invited" && (
                <>
                  <button className="btn btn-primary btn-sm" onClick={() => onApprove(c)}><Check size={12}/></button>
                  <button className="btn btn-secondary btn-sm" onClick={() => onReject(c)}><XIcon size={12}/></button>
                </>
              )}
            </div>
          );
        });
      })}
    </Modal>
  );
}

function JoinRequestDialog({ p, currentStudent, onClose, onConfirm, showToast }) {
  const taken = useMemo(() => new Set((p.crew || []).filter(c => c.status === "approved").map(c => c.role)), [p]);
  const available = ROLE_ORDER.filter(r => !taken.has(r));
  const [role, setRole] = useState(available[0] || "assistant_director");
  const [notes, setNotes] = useState("");
  return (
    <Modal title={`בקשת הצטרפות להפקה: ${p.title}`} onClose={onClose} footer={
      <div style={{display:"flex",gap:8,justifyContent:"end"}}>
        <button className="btn btn-secondary btn-sm" onClick={onClose}>ביטול</button>
        <button className="btn btn-primary btn-sm" onClick={async () => {
          const res = await requestJoinProduction(p.id, role, {
            studentId: currentStudent.id,
            freeTextName: null,
            crewEmail: currentStudent.email,
            notes: notes.trim() || null,
          });
          if (!res.ok) {
            showToast?.(`שגיאה: ${res.error}`, "error");
            return;
          }
          showToast?.("הבקשה נשלחה לבמאי", "success");
          onConfirm();
        }}>שלח בקשה</button>
      </div>
    }>
      <div style={{marginBottom:12}}>
        <label className="form-label">תפקיד</label>
        <select className="form-input" value={role} onChange={e => setRole(e.target.value)}>
          {available.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </div>
      <div style={{marginBottom:12}}>
        <label className="form-label">הערה לבמאי (אופציונלי)</label>
        <textarea className="form-input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="מה את/ה רוצה לעשות בפרויקט?"/>
      </div>
    </Modal>
  );
}

export function ProductionsPage({ productions = [], currentStudent, students = [], reservations = [], showToast, onOpenLoanForm, refresh }) {
  const [tab, setTab]                     = useState("board"); // board | mine | inbox
  const [editorOpen, setEditorOpen]       = useState(null);    // { initial: ... } | null
  const [detail, setDetail]               = useState(null);
  const [joinTarget, setJoinTarget]       = useState(null);

  const myEmail = String(currentStudent?.email || "").toLowerCase();

  const myDirectorProds = useMemo(() =>
    productions.filter(p => p.directorEmail?.toLowerCase() === myEmail),
    [productions, myEmail]);
  const myCrewProds = useMemo(() =>
    productions.filter(p => p.directorEmail?.toLowerCase() !== myEmail &&
      (p.crew || []).some(c => c.crewEmail?.toLowerCase() === myEmail && c.status === "approved")),
    [productions, myEmail]);
  const inboxRequests = useMemo(() => {
    const out = [];
    for (const p of myDirectorProds) {
      for (const c of (p.crew || [])) {
        if (c.status === "invited" && c.invitedBy === "self") out.push({ production: p, crew: c });
      }
    }
    return out;
  }, [myDirectorProds]);

  const published = useMemo(() => productions.filter(p => p.status === "published"), [productions]);

  function openEditor(initial) {
    setEditorOpen({ initial: initial || null });
  }
  function closeEditor() { setEditorOpen(null); refresh?.(); }

  return (
    <div style={{padding:"0 20px"}}>
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",gap:6}}>
          <button onClick={() => setTab("board")} className={tab === "board" ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}>
            <Film size={14}/> לוח הפקות {published.length ? `(${published.length})` : ""}
          </button>
          {currentStudent?.id && (
            <button onClick={() => setTab("mine")} className={tab === "mine" ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}>
              <Users size={14}/> שלי {(myDirectorProds.length + myCrewProds.length) ? `(${myDirectorProds.length + myCrewProds.length})` : ""}
            </button>
          )}
          {currentStudent?.id && (
            <button onClick={() => setTab("inbox")} className={tab === "inbox" ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}>
              <Inbox size={14}/> בקשות {inboxRequests.length ? `(${inboxRequests.length})` : ""}
            </button>
          )}
        </div>
        {currentStudent?.id && (
          <button className="btn btn-primary btn-sm" onClick={() => openEditor(null)}>
            <Plus size={14}/> הפקה חדשה
          </button>
        )}
      </div>

      {tab === "board" && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
          {published.length === 0 ? <p style={{color:"#888"}}>אין כרגע הפקות מפורסמות</p> :
            published.map(p => <ProductionCard key={p.id} p={p} onClick={() => setDetail(p)}/>)}
        </div>
      )}

      {tab === "mine" && (
        <div>
          {myDirectorProds.length > 0 && (
            <>
              <h4 style={{marginTop:0}}>אני במאי/ת</h4>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12,marginBottom:18}}>
                {myDirectorProds.map(p => <ProductionCard key={p.id} p={p} onClick={() => setDetail(p)}/>)}
              </div>
            </>
          )}
          {myCrewProds.length > 0 && (
            <>
              <h4>אני בצוות</h4>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
                {myCrewProds.map(p => <ProductionCard key={p.id} p={p} onClick={() => setDetail(p)}/>)}
              </div>
            </>
          )}
          {myDirectorProds.length === 0 && myCrewProds.length === 0 && (
            <p style={{color:"#888"}}>עוד לא הצטרפת לאף הפקה. אפשר ליצור חדשה או להירשם דרך לוח ההפקות.</p>
          )}
        </div>
      )}

      {tab === "inbox" && (
        <div>
          {inboxRequests.length === 0 ? <p style={{color:"#888"}}>אין בקשות הצטרפות ממתינות</p> :
            inboxRequests.map(({ production, crew }) => {
              const stu = students.find(s => String(s.id) === String(crew.studentId));
              return (
                <div key={crew.id} style={{border:"1px solid #ddd",borderRadius:6,padding:12,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <div>
                    <div><strong>{stu?.name || crew.freeTextName || crew.crewEmail}</strong> מבקש/ת להצטרף ל-<strong>{production.title}</strong> כ-{ROLE_LABELS[crew.role]}</div>
                    {crew.notes && <div style={{fontSize:13,color:"#666",marginTop:4}}>"{crew.notes}"</div>}
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <button className="btn btn-primary btn-sm" onClick={async () => {
                      const r = await approveCrewMember(crew.id);
                      if (!r.ok) showToast?.(`שגיאה: ${r.error}`, "error");
                      else { showToast?.("אושר", "success"); refresh?.(); }
                    }}><Check size={14}/> אשר</button>
                    <button className="btn btn-secondary btn-sm" onClick={async () => {
                      const r = await rejectCrewMember(crew.id);
                      if (!r.ok) showToast?.(`שגיאה: ${r.error}`, "error");
                      else { showToast?.("נדחה", "success"); refresh?.(); }
                    }}><XIcon size={14}/> דחה</button>
                  </div>
                </div>
              );
            })
          }
        </div>
      )}

      {editorOpen && (
        <ProductionEditor
          initial={editorOpen.initial}
          currentStudent={currentStudent}
          students={students}
          reservations={reservations}
          showToast={showToast}
          onClose={closeEditor}
          onSaved={() => refresh?.()}
          onDeleted={() => refresh?.()}
        />
      )}

      {detail && !editorOpen && (
        <ProductionDetail
          p={detail}
          currentStudent={currentStudent}
          students={students}
          onClose={() => setDetail(null)}
          onEdit={(p) => { setDetail(null); openEditor(p); }}
          onJoinRequest={(p) => setJoinTarget(p)}
          onApprove={async (c) => {
            const r = await approveCrewMember(c.id);
            if (!r.ok) showToast?.(`שגיאה: ${r.error}`, "error");
            else { showToast?.("אושר", "success"); refresh?.(); setDetail(null); }
          }}
          onReject={async (c) => {
            const r = await rejectCrewMember(c.id);
            if (!r.ok) showToast?.(`שגיאה: ${r.error}`, "error");
            else { showToast?.("נדחה", "success"); refresh?.(); setDetail(null); }
          }}
          onOpenLoanForm={(p) => { setDetail(null); onOpenLoanForm?.(p); }}
        />
      )}

      {joinTarget && (
        <JoinRequestDialog
          p={joinTarget}
          currentStudent={currentStudent}
          showToast={showToast}
          onClose={() => setJoinTarget(null)}
          onConfirm={() => { setJoinTarget(null); setDetail(null); refresh?.(); }}
        />
      )}
    </div>
  );
}
