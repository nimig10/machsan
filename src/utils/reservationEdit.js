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

    // Real reservation — one RPC, one transaction.
    //
    // This used to be three round trips: UPDATE the row, DELETE every item,
    // INSERT the new list. Between the DELETE and the INSERT the request
    // existed with no gear on it, and a failure there — a dropped connection
    // is the realistic one — made that state permanent while the two earlier
    // steps had already been reported as fine. Nothing downstream can tell an
    // interrupted save apart from a list that was legitimately emptied.
    //
    // save_edited_reservation_v1 is SECURITY INVOKER, so the permission surface
    // is unchanged: the same rows this code could already write, governed by
    // the same RLS. See migration 20260731120000.
    const { error: rpcErr } = await supabase.rpc("save_edited_reservation_v1", {
      p_reservation_id: updated.id,
      p_fields: {
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
        // A key left out entirely is preserved by the RPC rather than nulled.
        original_items: rowFields.original_items ?? null,
      },
      // null = "items are not part of this edit". An array, empty included,
      // replaces the list wholesale — the same distinction the old `if
      // (updatedItems)` guard drew.
      p_items: updatedItems
        ? updatedItems.map(i => ({
            equipment_id: i.equipment_id,
            name:         i.name || "",
            quantity:     Number(i.quantity) || 1,
            unit_id:      i.unit_id || null,
          }))
        : null,
    });
    if (rpcErr) {
      console.error("saveEditedReservation rpc error:", rpcErr);
      const msg = String(rpcErr.message || "");
      // The RPC raises this when the UPDATE matched nothing. The old code
      // could not report it at all: postgrest calls a zero-row UPDATE a
      // success, so a vanished request still toasted "הבקשה עודכנה".
      showToast("error", msg.includes("reservation_not_found")
        ? "הבקשה לא נמצאה — ייתכן שנמחקה בינתיים. רענן את הדף."
        : "שגיאה בעדכון הבקשה: " + (rpcErr.message || "לא ידוע"));
      return false;
    }
    return finish();
  };
}
