// returnApi.js — the write half of the equipment-return flow.
//
// One function, used by BOTH mounts of the return panel (ReservationsPage's
// detail modal and the dashboard's request view). It exists so the ordering
// rule below is written down once: two screens each carrying their own copy is
// exactly how one of them ends up with the steps reversed.

import { writeEquipmentToDB, updateReservationStatus } from "../utils.js";
import {
  applyUnitOutcomes, summarizeOutcomes, describeExceptions, buildReturnOutcomesSnapshot,
} from "./returnFlow.js";

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
// The damage SNAPSHOT for the archive travels with the status change, and the
// endpoint writes it before invoking the RPC — so the same ordering rule holds
// on the server: the record of what came back is durable before the loan is
// allowed to close. A failure there surfaces as stage "outcomes".
//
// Returns:
//   { ok: true,  summary, note, returnOutcomes }
//   { ok: false, stage: "equipment" | "outcomes" | "reservation", error, inventoryWritten }
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
  // Built from `outcomes`, never from the equipment array: unit statuses drift
  // legitimately afterwards (פגום → בתיקון → תקין on "ציוד בדיקה") and the
  // archive must keep showing what was recorded at handover. null when nothing
  // was wrong, and then the column stays NULL — see returnFlow.js.
  const returnOutcomes = buildReturnOutcomesSnapshot({ outcomes, equipment: list, at: returnedAt });

  const rpc = await updateReservationStatus(reservation.id, "הוחזר", { returned_at: returnedAt, returnOutcomes });
  if (!rpc.ok) {
    // The snapshot write is the one failure that leaves the loan open on
    // purpose, so it gets its own stage and its own message.
    const stage = rpc.error === "return_outcomes_write_failed" ? "outcomes" : "reservation";
    return { ok: false, stage, error: rpc, inventoryWritten: inventoryChanged };
  }

  return { ok: true, returnedAt, rpc, summary, note: describeExceptions(summary), inventoryChanged, returnOutcomes };
}
