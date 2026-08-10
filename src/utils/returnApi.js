// returnApi.js — the write half of the equipment-return flow.
//
// One function, used by BOTH mounts of the return panel (ReservationsPage's
// detail modal and the dashboard's request view). It exists so the ordering
// rule below is written down once: two screens each carrying their own copy is
// exactly how one of them ends up with the steps reversed.

import { writeEquipmentToDB, updateReservationStatus } from "../utils.js";
import { applyUnitOutcomes, summarizeOutcomes, describeExceptions } from "./returnFlow.js";

// Record what came back, then close the loan.
//
// ⚠️ THE ORDER IS DELIBERATE — inventory first, reservation second.
//
// If the reservation write fails after the units are saved, the damage is
// already recorded and visible in "ציוד בדיקה", and the loan simply stays open
// for another try. Nothing is lost.
//
// Reversed, a failure would close the loan and drop the damage on the floor:
// broken hardware silently back in the pool as תקין, with the request archived
// and no trace of what happened to it. That failure is unrecoverable without
// someone remembering, which is the whole problem this screen was built to fix.
//
// Returns:
//   { ok: true,  summary, note }
//   { ok: false, stage: "equipment" | "reservation", error, inventoryWritten }
export async function completeEquipmentReturn({ reservation, equipment, setEquipment, outcomes }) {
  const list = Array.isArray(equipment) ? equipment : [];
  const summary = summarizeOutcomes(outcomes);
  const next = applyUnitOutcomes(list, outcomes);
  // applyUnitOutcomes hands back untouched items by reference, so this is an
  // exact "did any unit actually change" test — an all-תקין return writes nothing.
  const inventoryChanged = next.length !== list.length || next.some((eq, i) => eq !== list[i]);

  if (inventoryChanged) {
    const previous = list;
    setEquipment(next); // optimistic, same as saveUnit in DamagedEquipmentPage
    const w = await writeEquipmentToDB(next);
    if (!w.ok) {
      setEquipment(previous);
      return { ok: false, stage: "equipment", error: w.error || w, inventoryWritten: false };
    }
  }

  const returnedAt = new Date().toISOString();
  const rpc = await updateReservationStatus(reservation.id, "הוחזר", { returned_at: returnedAt });
  if (!rpc.ok) {
    return { ok: false, stage: "reservation", error: rpc, inventoryWritten: inventoryChanged };
  }

  return { ok: true, returnedAt, rpc, summary, note: describeExceptions(summary), inventoryChanged };
}
