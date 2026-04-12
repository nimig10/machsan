// EditReservationModal.jsx — modal for editing an existing reservation
import { useState } from "react";
import { Modal } from "./ui.jsx";
import {
  formatDate,
  toDateTime,
  FAR_FUTURE,
  getReservationApprovalConflicts,
  cloudinaryThumb,
} from "../utils.js";

export function EditReservationModal({ reservation, equipment, reservations, onSave, onApprove, onClose, collegeManager={}, managerToken="", siteSettings={} }) {
  const TIME_SLOTS = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30"];
  const isOverdueReservation = reservation.status==="באיחור";
  const [form, setForm]   = useState({...reservation});
  const [items, setItems] = useState(reservation.items ? [...reservation.items] : []);
  const [saving, setSaving] = useState(false);
  const [editConflicts, setEditConflicts] = useState([]);
  const [showLoanedOnly, setShowLoanedOnly] = useState(false);
  const [editSearch, setEditSearch] = useState("");
  const [editTypeFilter, setEditTypeFilter] = useState("all");
  const [editCategoryFilters, setEditCategoryFilters] = useState([]);
  const [reportNote, setReportNote] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [overdueEditMailText, setOverdueEditMailText] = useState(reservation.overdue_student_note || "");
  const [overdueEditMailSending, setOverdueEditMailSending] = useState(false);

  const sendManagerReport = async () => {
    if(!collegeManager.email) return;
    setReportSending(true);
    try {
      const eqList = items.map(i=>`${i.name} ×${i.quantity}`).join(", ");
      await fetch("/api/send-email", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          to: collegeManager.email,
          type: "manager_report",
          student_name: form.student_name||reservation.student_name,
          reservation_id: String(reservation.id),
          loan_type: form.loan_type||reservation.loan_type,
          borrow_date: formatDate(form.borrow_date||reservation.borrow_date),
          return_date: formatDate(form.return_date||reservation.return_date),
          items_list: eqList,
          report_note: reportNote,
          calendar_url: managerToken ? `${window.location.origin}/manager-calendar?token=${managerToken}` : "",
          logo_url: siteSettings.logo || "",
          sound_logo_url: siteSettings.soundLogo || "",
        }),
      });
      setReportNote("");
      alert("✅ הדיווח נשלח למנהל המכללה");
    } catch(e) { console.error(e); }
    setReportSending(false);
  };
  const set = (k,v) => setForm(p=>({...p,[k]:v}));
  const overdueEqItems = items
    .map((item) => {
      const eq = equipment.find((e) => e.id == item.equipment_id) || {};
      return {
        ...item,
        id: item.equipment_id,
        name: item.name || eq.name || "?",
        category: eq.category || "",
        image: eq.image || "📦",
        soundOnly: !!eq.soundOnly,
        photoOnly: !!eq.photoOnly,
      };
    })
    .filter((item) => {
      const searchText = editSearch.trim().toLowerCase();
      if (searchText) {
        const haystack = `${item.name||""} ${item.category||""}`.toLowerCase();
        if (!haystack.includes(searchText)) return false;
      }
      if (editTypeFilter === "sound" && !item.soundOnly) return false;
      if (editTypeFilter === "photo" && !item.photoOnly) return false;
      if (editCategoryFilters.length && !editCategoryFilters.includes(item.category)) return false;
      return true;
    });
  const overdueEquipmentCategories = [...new Set(overdueEqItems.map((item) => item.category).filter(Boolean))];
  const sendOverdueMailFromEdit = async () => {
    if (!reservation?.email || !overdueEditMailText.trim()) return;
    setOverdueEditMailSending(true);
    try {
      await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: reservation.email,
          type: "overdue",
          student_name: reservation.student_name,
          borrow_date: formatDate(reservation.borrow_date),
          borrow_time: reservation.borrow_time || "",
          return_date: formatDate(reservation.return_date),
          return_time: reservation.return_time || "",
          custom_message: overdueEditMailText.trim(),
          logo_url: siteSettings.logo || "",
          sound_logo_url: siteSettings.soundLogo || "",
        }),
      });
      setOverdueEditMailText("");
      alert(`✅ המייל נשלח אל ${reservation.email}`);
    } catch (e) {
      console.error(e);
      alert("שגיאה בשליחת המייל לסטודנט המאחר");
    }
    setOverdueEditMailSending(false);
  };

  const getEquipmentBlockingDetails = (eqId) => {
    const eq = equipment.find(e=>e.id==eqId);
    if(!eq) return { total: 0, usedByOthers: 0, available: 0, blockers: [] };

    const reqStart = toDateTime(form.borrow_date, form.borrow_time || "00:00");
    const reqEnd   = toDateTime(form.return_date, form.return_time || "23:59");
    let usedByOthers = 0;
    const blockers = [];

    for (const res of reservations) {
      if (res.id === reservation.id) continue;
      if (res.status !== "מאושר" && res.status !== "באיחור") continue;

      const resStart = toDateTime(res.borrow_date, res.borrow_time || "00:00");
      // Overdue items are physically out of the warehouse — block every future request
      const resEnd = res.status === "באיחור" ? FAR_FUTURE : toDateTime(res.return_date, res.return_time || "23:59");
      const overlaps = reqStart < resEnd && reqEnd > resStart;
      if (!overlaps) continue;

      const blockingItem = (res.items || []).find(i => i.equipment_id == eqId);
      if (!blockingItem || !blockingItem.quantity) continue;

      const blockingQty = Number(blockingItem.quantity) || 0;
      usedByOthers += blockingQty;
      blockers.push({
        reservation_id: res.id,
        student_name: res.student_name || "ללא שם",
        quantity: blockingQty,
        borrow_date: res.borrow_date,
        borrow_time: res.borrow_time || "00:00",
        return_date: res.return_date,
        return_time: res.return_time || "23:59",
        status: res.status,
      });
    }

    return {
      total: Number(eq.total_quantity) || 0,
      usedByOthers,
      available: Math.max(0, (Number(eq.total_quantity) || 0) - usedByOthers),
      blockers,
    };
  };

  const getAvail = (eqId) => getEquipmentBlockingDetails(eqId).available;

  const setQty = (eqId, qty) => {
    const totalAvail = getAvail(eqId);
    const q = Math.max(0, Math.min(qty, totalAvail));
    const name = equipment.find(e=>e.id==eqId)?.name||"";
    setItems(prev => q===0 ? prev.filter(i=>i.equipment_id!=eqId)
      : prev.find(i=>i.equipment_id==eqId) ? prev.map(i=>i.equipment_id==eqId?{...i,quantity:q}:i)
      : [...prev,{equipment_id:eqId,quantity:q,name}]);
  };
  const getQty = (eqId) => items.find(i=>i.equipment_id==eqId)?.quantity||0;

  const equipmentCategories = [...new Set(equipment.map(e=>e.category).filter(Boolean))];
  const toggleEditCategoryFilter = (category) => {
    setEditCategoryFilters((prev) => prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]);
  };
  const matchesEditEquipmentFilters = (eq) => {
    const searchText = editSearch.trim().toLowerCase();
    if (searchText) {
      const haystack = `${eq.name||""} ${eq.category||""}`.toLowerCase();
      if (!haystack.includes(searchText)) return false;
    }
    const isGeneral = (!eq.soundOnly && !eq.photoOnly) || (eq.soundOnly && eq.photoOnly);
    if (editTypeFilter === "sound" && !eq.soundOnly && !isGeneral) return false;
    if (editTypeFilter === "photo" && !eq.photoOnly && !isGeneral) return false;
    if (editCategoryFilters.length && !editCategoryFilters.includes(eq.category)) return false;
    if (showLoanedOnly && getQty(eq.id) <= 0) return false;
    return true;
  };
  const stripConflictingItems = () => {
    const nextItems = items.reduce((acc, item) => {
      const details = getEquipmentBlockingDetails(item.equipment_id);
      const nextQty = Math.max(0, Math.min(Number(item.quantity) || 0, details.available));
      if (nextQty > 0) acc.push({ ...item, quantity: nextQty });
      return acc;
    }, []);
    setItems(nextItems);
    setEditConflicts([]);
  };

  const save = async () => {
    const updatedReservation = { ...form, id: reservation.id, status: reservation.status, items };
    if (reservation.status === "מאושר") {
      const conflicts = getReservationApprovalConflicts(updatedReservation, reservations, equipment);
      if (conflicts.length) {
        setEditConflicts(conflicts);
        return;
      }
    }

    setSaving(true);
    await onSave(updatedReservation);
    setSaving(false);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:3000,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"24px 16px",overflowY:"auto"}}>
      <div style={{width:"100%",maxWidth:760,background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",direction:"rtl"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"20px 24px",borderBottom:"1px solid var(--border)",background:"var(--surface2)",borderRadius:"16px 16px 0 0"}}>
          <div>
            <div style={{fontWeight:900,fontSize:18}}>✏️ עריכת בקשה</div>
            <div style={{fontSize:14,color:"var(--text2)",marginTop:4,fontWeight:700}}>{reservation.student_name}</div>
            <div style={{fontSize:13,color:"var(--text)",marginTop:6,fontWeight:800}}>סטטוס: {reservation.status}</div>
            <div style={{display:"flex",gap:8,marginTop:4,alignItems:"center",flexWrap:"wrap"}}>
              <span style={{fontSize:12,color:"var(--accent)",fontWeight:700,background:"var(--surface3)",borderRadius:20,padding:"2px 10px"}}>
                {reservation.loan_type==="פרטית"?"👤":reservation.loan_type==="הפקה"?"🎬":reservation.loan_type==="קולנוע יומית"?"🎥":"🎙️"} {reservation.loan_type==="סאונד"?"השאלת סאונד":reservation.loan_type==="קולנוע יומית"?"קולנוע יומית":`השאלה ${reservation.loan_type}`}
              </span>
              <span style={{fontSize:11,color:"var(--text3)"}}>· {formatDate(reservation.borrow_date)}</span>
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>✕ סגור</button>
        </div>

        <div style={{padding:24,display:"flex",flexDirection:"column",gap:24}}>

          {isOverdueReservation ? (
            <div>
              <div className="form-section-title">תאריכים ושעות</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12}}>
                {[["תאריך השאלה", formatDate(reservation.borrow_date)],["שעת איסוף", reservation.borrow_time || "לא הוזנה"],["תאריך החזרה", formatDate(reservation.return_date)],["שעת החזרה", reservation.return_time || "לא הוזנה"]].map(([label,value])=>(
                  <div key={label} style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r-sm)",padding:"14px 16px"}}>
                    <div style={{fontSize:12,color:"var(--text3)",marginBottom:6,fontWeight:700}}>{label}</div>
                    <div style={{fontSize:18,fontWeight:900,color:"var(--text)"}}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div className="form-section-title">תאריכים ושעות</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div className="form-group">
                  <label className="form-label">תאריך השאלה</label>
                  <input type="date" className="form-input" value={form.borrow_date} onChange={e=>set("borrow_date",e.target.value)}/>
                </div>
                <div className="form-group">
                  <label className="form-label">שעת איסוף</label>
                  <select className="form-select" value={form.borrow_time||""} onChange={e=>set("borrow_time",e.target.value)}>
                    <option value="">-- בחר שעה --</option>
                    {TIME_SLOTS.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">תאריך החזרה</label>
                  <input type="date" className="form-input" value={form.return_date} min={form.borrow_date} onChange={e=>set("return_date",e.target.value)}/>
                </div>
                <div className="form-group">
                  <label className="form-label">שעת החזרה</label>
                  <select className="form-select" value={form.return_time||""} onChange={e=>set("return_time",e.target.value)}>
                    <option value="">-- בחר שעה --</option>
                    {TIME_SLOTS.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap",marginBottom:8}}>
              <div className="form-section-title" style={{marginBottom:0}}>ציוד ({items.reduce((s,i)=>s+i.quantity,0)} פריטים)</div>
              {!isOverdueReservation && (
                <button
                  type="button"
                  className={`btn btn-sm ${showLoanedOnly ? "btn-primary" : "btn-secondary"}`}
                  onClick={()=>setShowLoanedOnly(prev=>!prev)}
                >
                  פריטים בלבד
                </button>
              )}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:14}}>
              <input
                className="form-input"
                placeholder="חיפוש ציוד לעריכה..."
                value={editSearch}
                onChange={e=>setEditSearch(e.target.value)}
              />
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {[{k:"all",l:"📦 הכל"},{k:"sound",l:"🎙️ ציוד סאונד"},{k:"photo",l:"🎥 ציוד צילום"}].map(({k,l})=>(
                  <button
                    key={k}
                    type="button"
                    className={`btn btn-sm ${editTypeFilter===k?"btn-primary":"btn-secondary"}`}
                    onClick={()=>setEditTypeFilter(k)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {equipmentCategories.map((cat)=>(
                  <button
                    key={cat}
                    type="button"
                    onClick={()=>toggleEditCategoryFilter(cat)}
                    style={{
                      padding:"5px 12px",
                      borderRadius:999,
                      border:`1px solid ${editCategoryFilters.includes(cat)?"var(--accent)":"var(--border)"}`,
                      background:editCategoryFilters.includes(cat)?"var(--accent-glow)":"var(--surface2)",
                      color:editCategoryFilters.includes(cat)?"var(--accent)":"var(--text2)",
                      fontWeight:700,
                      fontSize:12,
                      cursor:"pointer",
                    }}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
            <div className="highlight-box" style={{marginBottom:16}}>
              {isOverdueReservation
                ? "הציוד כבר יצא מהמחסן. כאן מוצגת רק רשימת הפריטים שהושאלו בפועל, עם פילטרים לצפייה נוחה."
                : <>המערכת סופרת מלאי רק מול בקשות <strong>מאושרות</strong> שחופפות בזמן לבקשה הזאת. אם ציוד חסום, יוצגו כאן שמות הסטודנטים והכמויות שחוסמות אותו כדי שתוכל לעבור לבקשות החופפות ולהפחית משם.</>}
            </div>
            {(isOverdueReservation ? overdueEquipmentCategories : equipmentCategories).map(cat=>{
              const catEq = isOverdueReservation
                ? overdueEqItems.filter(item=>item.category===cat)
                : equipment.filter(e=>e.category===cat && matchesEditEquipmentFilters(e));
              if(!catEq.length) return null;
              return (
                <div key={cat} style={{marginBottom:16}}>
                  <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>{cat}</div>
                  {catEq.map(eq=>{
                    const qty = isOverdueReservation ? Number(eq.quantity) || 0 : getQty(eq.id);
                    const details = isOverdueReservation ? { available: 0, usedByOthers: 0, total: 0, blockers: [] } : getEquipmentBlockingDetails(eq.id);
                    const totalAvail = details.available;
                    const remaining = Math.max(0, totalAvail - qty);
                    const missingForApproval = Math.max(0, qty - totalAvail);
                    const hasApprovalConflict = missingForApproval > 0;
                    const blockedCompletely = totalAvail === 0;
                    return (
                      <div key={eq.id} style={{marginBottom:10}}>
                        <div
                          className="item-row"
                          style={{
                            opacity: isOverdueReservation ? 1 : blockedCompletely && !hasApprovalConflict ? 0.55 : 1,
                            marginBottom: !isOverdueReservation && details.blockers.length ? 6 : 0,
                            border: !isOverdueReservation && hasApprovalConflict ? "2px solid rgba(241,196,15,0.95)" : "1px solid var(--border)",
                            background: !isOverdueReservation && hasApprovalConflict ? "rgba(241,196,15,0.22)" : "var(--surface2)",
                            boxShadow: !isOverdueReservation && hasApprovalConflict ? "0 0 0 1px rgba(241,196,15,0.2)" : "none",
                          }}
                        >
                          {eq.image?.startsWith("data:")||eq.image?.startsWith("http")
                            ? <img src={cloudinaryThumb(eq.image)} alt="" style={{width:32,height:32,objectFit:"cover",borderRadius:6}}/>
                            : <span style={{fontSize:22}}>{eq.image||"📦"}</span>}
                          <div style={{flex:1}}>
                            <div style={{fontWeight:700,fontSize:13,color:!isOverdueReservation && hasApprovalConflict?"var(--yellow)":"var(--text)"}}>{eq.name}</div>
                            <div style={{fontSize:11,color:"var(--text3)",display:"flex",gap:10,flexWrap:"wrap",marginTop:2}}>
                              <span>כמות: <strong style={{color:"var(--accent)"}}>{qty}</strong></span>
                              {eq.category && <span>{eq.category}</span>}
                              {eq.soundOnly && <span style={{color:"var(--accent)"}}>🎙️ ציוד סאונד</span>}
                              {eq.photoOnly && <span style={{color:"var(--green)"}}>🎥 ציוד צילום</span>}
                              {!isOverdueReservation && <span>זמין: <span style={{color:remaining===0?"var(--red)":remaining<=2?"var(--yellow)":"var(--green)",fontWeight:700}}>{remaining}</span></span>}
                              {!isOverdueReservation && details.usedByOthers>0 && <span>חסום ע"י אחרים: <strong style={{color:"var(--red)"}}>{details.usedByOthers}</strong></span>}
                              {!isOverdueReservation && <span>סה"כ במלאי: <strong>{details.total}</strong></span>}
                              {!isOverdueReservation && hasApprovalConflict && <span style={{color:"var(--yellow)",fontWeight:800}}>חסר לאישור: <strong>{missingForApproval}</strong></span>}
                            </div>
                            {!isOverdueReservation && hasApprovalConflict && (
                              <div style={{marginTop:4,fontSize:11,fontWeight:800,color:"var(--yellow)"}}>
                                פריט זה חוסם את אישור הבקשה בגלל חוסר מלאי בחפיפה.
                              </div>
                            )}
                          </div>
                          {!isOverdueReservation && (
                            <div className="qty-ctrl">
                              <button className="qty-btn" onClick={()=>setQty(eq.id,qty-1)}>−</button>
                              <span className="qty-num">{qty}</span>
                              <button className="qty-btn" disabled={remaining<=0} onClick={()=>setQty(eq.id,qty+1)}>+</button>
                            </div>
                          )}
                        </div>
                        {!isOverdueReservation && details.blockers.length > 0 && (
                          <div style={{background:"rgba(241,196,15,0.1)",border:"1px solid rgba(241,196,15,0.28)",borderRadius:10,padding:10,marginBottom:6}}>
                            <div style={{fontSize:12,fontWeight:800,color:"var(--yellow)",marginBottom:8}}>הציוד הזה חסום כרגע ע"י הבקשות הבאות:</div>
                            <div style={{display:"flex",flexDirection:"column",gap:6}}>
                              {details.blockers.map((blocker, idx) => {
                                const isOvd = blocker.status === "באיחור";
                                return (
                                <div key={idx} style={{background: isOvd ? "rgba(231,76,60,0.07)" : "var(--surface3)", border: isOvd ? "1.5px solid rgba(231,76,60,0.4)" : "1px solid var(--border)", borderRadius:8, padding:"8px 10px"}}>
                                  <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",fontSize:12,alignItems:"center"}}>
                                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                                      <strong>{blocker.student_name}</strong>
                                      {isOvd && <span className="badge badge-orange" style={{fontSize:10}}>⚠️ באיחור</span>}
                                    </div>
                                    <span>כמות שהושאלה: <strong style={{color: isOvd ? "var(--red)" : "var(--accent)"}}>{blocker.quantity}</strong></span>
                                  </div>
                                  <div style={{fontSize:11,color:"var(--text2)",marginTop:4,display:"flex",gap:10,flexWrap:"wrap"}}>
                                    <span>מ־{formatDate(blocker.borrow_date)} {blocker.borrow_time}</span>
                                    {isOvd
                                      ? <span style={{color:"var(--red)",fontWeight:700}}>היה אמור לחזור {formatDate(blocker.return_date)} — עדיין לא הוחזר</span>
                                      : <span>עד {formatDate(blocker.return_date)} {blocker.return_time}</span>
                                    }
                                  </div>
                                </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div style={{display:"flex",gap:10,justifyContent:"flex-end",paddingTop:8,borderTop:"1px solid var(--border)",flexWrap:"wrap"}}>
            {collegeManager.email&&(
            <div style={{width:"100%",background:"var(--surface2)",borderRadius:"var(--r-sm)",padding:"12px",marginBottom:8,border:"1px solid var(--border)"}}>
              <div style={{fontWeight:700,fontSize:12,marginBottom:6,color:"var(--text2)"}}>📧 דיווח למנהל המכללה</div>
              <textarea className="form-textarea" rows={2} style={{marginBottom:6}} placeholder="פרט את הבעיה בבקשה..." value={reportNote} onChange={e=>setReportNote(e.target.value)}/>
              <button className="btn btn-secondary btn-sm" disabled={!reportNote.trim()||reportSending} onClick={sendManagerReport}>
                {reportSending?"⏳ שולח...":"📧 שלח דיווח למנהל"}
              </button>
            </div>
          )}
          {isOverdueReservation&&(
            <div style={{width:"100%",background:"rgba(230,126,34,0.08)",borderRadius:"var(--r-sm)",padding:"12px",marginBottom:8,border:"1px solid rgba(230,126,34,0.28)"}}>
              <div style={{fontWeight:700,fontSize:12,marginBottom:6,color:"#e67e22"}}>📧 דיווח לסטודנט המאחר</div>
              <textarea
                className="form-textarea"
                rows={4}
                style={{marginBottom:6}}
                placeholder="כתוב לסטודנט שהוא חייב להחזיר את הציוד למחסן המכללה בהקדם..."
                value={overdueEditMailText}
                onChange={e=>setOverdueEditMailText(e.target.value)}
              />
              <button
                className="btn btn-primary btn-sm"
                style={{background:"#e67e22",borderColor:"#e67e22"}}
                disabled={!overdueEditMailText.trim()||overdueEditMailSending||!reservation.email}
                onClick={sendOverdueMailFromEdit}
              >
                {overdueEditMailSending?"⏳ שולח...":"📧 שלח מייל לסטודנט המאחר"}
              </button>
              <span style={{fontSize:12,color:"var(--text3)",marginRight:10}}>
                {reservation.email ? `יישלח אל ${reservation.email}` : "אין כתובת מייל"}
              </span>
            </div>
          )}
          <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
            {!isOverdueReservation && reservation.status==="ממתין"&&(
              <button
                className="btn btn-secondary"
                disabled={saving}
                onClick={stripConflictingItems}
                style={{borderColor:"var(--red)",color:"var(--red)"}}
              >
                החסר פרטים חופפים
              </button>
            )}
            {!isOverdueReservation && reservation.status==="ממתין"&&onApprove&&(
              <button
                className="btn btn-success"
                disabled={saving}
                onClick={async()=>{
                  setSaving(true);
                  await onApprove({...form, items, status:"מאושר"});
                  setSaving(false);
                }}
              >
                ✅ אשר והעבר למאושר
              </button>
            )}
            {!isOverdueReservation && reservation.status==="נדחה"&&onApprove&&(
              <button className="btn btn-success" disabled={saving} onClick={async()=>{
                setSaving(true);
                await onApprove({...form, items, status:"מאושר"});
                setSaving(false);
              }}>✅ שמור ואשר</button>
            )}
            {!isOverdueReservation && <button className="btn btn-primary" disabled={saving} onClick={save}>{saving?"⏳ שומר...":"💾 שמור שינויים"}</button>}
          </div>
        </div>
      </div>

      {editConflicts.length > 0 && (
        <Modal
          title={`⛔ אי אפשר לשמור את העריכה של ${reservation.student_name}`}
          onClose={()=>setEditConflicts([])}
          size="modal-lg"
          footer={<button className="btn btn-secondary" onClick={()=>setEditConflicts([])}>סגור</button>}
        >
          <div className="highlight-box" style={{marginBottom:20}}>
            העריכה הזאת יוצרת חפיפה מול בקשות שכבר תופסות את הציוד. אלו רק הפריטים שחוסמים כרגע את השמירה.
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            {editConflicts.map((conflict, idx)=>(
              <div key={idx} style={{background:"var(--surface2)",border:"1px solid rgba(231,76,60,0.28)",borderRadius:"var(--r-sm)",padding:16}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
                  <div style={{fontWeight:900,fontSize:21,color:"var(--red)"}}>{conflict.equipment_name}</div>
                  <div style={{background:"rgba(231,76,60,0.12)",border:"1px solid rgba(231,76,60,0.35)",borderRadius:999,padding:"6px 14px",fontWeight:900,fontSize:16,color:"var(--red)"}}>
                    חסומות {conflict.missing} יחידות
                  </div>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {conflict.blockers.map((blocker, bIdx)=>(
                    <div key={bIdx} style={{background:"var(--surface3)",border:"1px solid var(--border)",borderRadius:10,padding:12}}>
                      <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",alignItems:"center",marginBottom:6}}>
                        <strong style={{fontSize:14}}>{blocker.student_name}</strong>
                        <span style={{fontWeight:900,fontSize:15,color:"var(--red)"}}>כמות חסומה: {blocker.quantity}</span>
                      </div>
                      <div style={{fontSize:12,color:"var(--text2)",display:"flex",flexWrap:"wrap",gap:10}}>
                        <span>📅 {formatDate(blocker.borrow_date)} {blocker.borrow_time || ""}</span>
                        <span>↩ {formatDate(blocker.return_date)} {blocker.return_time || ""}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
