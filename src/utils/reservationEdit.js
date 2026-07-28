// reservationEdit.js — the one implementation of "save an edited reservation".
//
// Extracted from ReservationsPage so the dashboard can edit a request too. It
// is a factory rather than a plain function because the body needs the caller's
// React state (the reservations array and its setter) and the caller's idea of
// what "done" means: the requests page closes just the editor, the dashboard
// closes its quick-view as well.
//
// Deliberately NOT a lift of the whole edit mechanism into App.jsx. The
// requests page wires the editor's approve button through approveReservation,
// which depends on three modals local to that page and on the atomic
// over-allocation guard (lesson #22). Moving that would risk the approval path
// to gain an edit button; moving only the save keeps the two independent.
import { supabase } from "../supabaseClient.js";
import { normalizeReservationsForArchive } from "../utils.js";
import { listKits, syncAllKits } from "./kitsApi.js";

export function makeSaveEditedReservation({ reservations, setReservations, showToast, onSaved }) {
  return async (updated, { silent = false } = {}) => {
    const { items: updatedItems, reservation_items: _ri, ...rowFields } = updated;

    // Virtual lesson reservations (lesson_auto: true) have no row in reservations_new.
    // Their source of truth is store.kits — sync items there instead.
    const isVirtual = updated.lesson_auto === true || String(updated.id || "").startsWith("lesson_res_");
    const linkedKitId = updated.lesson_kit_id ? String(updated.lesson_kit_id) : null;

    const finish = () => {
      const all = normalizeReservationsForArchive(reservations.map(r => r.id === updated.id ? updated : r));
      setReservations(all);
      if (!silent) { showToast("success", "הבקשה עודכנה"); onSaved?.(); }
      return true;
    };

    if (isVirtual) {
      // Update kit items in store.kits so the LecturerPortal sees the change
      if (linkedKitId && updatedItems) {
        const freshKits = await listKits(); // Stage 11 Session B: read from public.kits
        if (Array.isArray(freshKits)) {
          const normalized = updatedItems.map(i => ({ equipment_id: i.equipment_id, quantity: Number(i.quantity) || 1, name: i.name || "" }));
          const newKits = freshKits.map(k => String(k.id) === linkedKitId ? { ...k, items: normalized } : k);
          const r = await syncAllKits(newKits);
          if (!r.ok) { showToast("error", "שגיאה בעדכון ערכת השיעור"); return false; }
        }
      }
      return finish();
    }

    // Real reservation — update reservations_new + reservation_items
    const { error: updErr } = await supabase.from("reservations_new").update({
      student_name:  rowFields.student_name,
      email:         rowFields.email,
      phone:         rowFields.phone,
      course:        rowFields.course,
      project_name:  rowFields.project_name || null,
      loan_type:     rowFields.loan_type,
      borrow_date:   rowFields.borrow_date,
      return_date:   rowFields.return_date,
      borrow_time:   rowFields.borrow_time,
      return_time:   rowFields.return_time,
      overdue_student_note: rowFields.overdue_student_note || null,
      // Frozen snapshot of the gear as it went out, stamped by the overdue
      // partial-return flow. `form` spreads the reservation, so an already-
      // stamped value flows straight back through — every other edit is a
      // no-op preserve. Never derived here; see migration 20260719120000.
      original_items: rowFields.original_items ?? null,
    }).eq("id", updated.id);
    if (updErr) {
      console.error("saveEditedReservation update error:", updErr);
      showToast("error", "שגיאה בעדכון הבקשה: " + (updErr.message || "לא ידוע"));
      return false;
    }
    if (updatedItems) {
      const { error: delErr } = await supabase.from("reservation_items").delete().eq("reservation_id", updated.id);
      if (delErr) {
        console.error("saveEditedReservation delete items error:", delErr);
        showToast("error", "שגיאה במחיקת הפריטים הישנים: " + (delErr.message || "לא ידוע"));
        return false;
      }
      if (updatedItems.length) {
        const { error: insErr } = await supabase.from("reservation_items").insert(
          updatedItems.map(i => ({
            reservation_id: updated.id,
            equipment_id:   i.equipment_id,
            name:           i.name || "",
            quantity:       Number(i.quantity) || 1,
            unit_id:        i.unit_id || null,
          }))
        );
        if (insErr) {
          console.error("saveEditedReservation insert items error:", insErr);
          showToast("error", "שגיאה בהוספת הפריטים החדשים: " + (insErr.message || "לא ידוע"));
          return false;
        }
      }
    }
    return finish();
  };
}
