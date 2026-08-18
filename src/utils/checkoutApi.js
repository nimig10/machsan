// checkoutApi.js — the write half of the equipment-CHECKOUT flow.
//
// One function, used by BOTH mounts of the checkout panel (ReservationsPage's
// detail modal and the dashboard's request view), for the same reason
// returnApi.js exists: the ordering rule below has to be written down once.
//
// This is the harder sibling. The return flow makes two groups of writes;
// checkout makes THREE, because it is the only routine action that touches
// inventory AND edits the request in the same gesture.

import { supabase } from "../supabaseClient.js";
import { writeEquipmentToDB, updateReservationStatus } from "../utils.js";
import {
  applyCheckoutOutcomes, summarizeCheckout, describeCheckoutExceptions,
  buildCheckoutOutcomesSnapshot, checkoutSeedItems, computeCheckoutItems,
} from "./checkoutFlow.js";

// Hand the gear over: record unit condition, adjust what is actually going out,
// then open the loan.
//
// ⚠️ THE ORDER IS DELIBERATE — inventory, then items, then status.
//
// The rule that generates it: EVERY PREFIX OF THIS SEQUENCE MUST BE
// OVER-CONSERVATIVE ABOUT STOCK. Stop anywhere and the world must believe less
// gear is available than really is, never more.
//
//   1. Unit statuses REMOVE hardware from the pool. Safe to do first: stop here
//      and a damaged unit is correctly out of circulation while the request
//      still holds its full quantity. Over-conservative.
//   2. The item decrement RELEASES stock. It must come after (1). Reversed, a
//      failure between them would leave the quantity released AND the broken
//      unit still marked תקין — broken hardware advertised as available, twice
//      over. That is the exact failure returnApi.js's ordering was written to
//      prevent, arriving from the other direction.
//   3. The status flip is the commit point. Until issued_at is stamped the
//      panel stays open and the whole thing can simply be run again.
//
// Retrying is safe by construction, not by luck:
//   • (1) is idempotent — the same outcomes produce the same unit statuses, and
//     applyCheckoutOutcomes returns untouched items by reference so a repeat
//     writes nothing at all.
//   • (2) is idempotent because computeCheckoutItems builds an ABSOLUTE target
//     list from original_items ?? items, and original_items is frozen before the
//     first decrement. Feeding it a delta, or seeding from the live (already
//     shrunk) list, would shrink the request again on every attempt.
//   • (3) is idempotent because the server's stamp PATCH is filtered on
//     issued_at=is.null.
//
// Returns:
//   { ok: true,  issuedAt, rpc, summary, note, inventoryChanged, itemsChanged, nextItems, checkoutOutcomes }
//   { ok: false, stage: "equipment"|"items"|"stamp"|"reservation", error, inventoryWritten, itemsWritten }
export async function completeEquipmentCheckout({ reservation, equipment, setEquipment, outcomes }) {
  const list = Array.isArray(equipment) ? equipment : [];
  const summary = summarizeCheckout(outcomes);

  // ── 1. unit condition ────────────────────────────────────────────────────
  const next = applyCheckoutOutcomes(list, outcomes);
  // Untouched items come back by reference, so this is an exact "did any unit
  // actually change" test — a clean checkout writes nothing.
  const inventoryChanged = next.length !== list.length || next.some((eq, i) => eq !== list[i]);

  if (inventoryChanged) {
    const previous = list;
    setEquipment(next); // optimistic, same as the return flow
    const w = await writeEquipmentToDB(next);
    if (!w.ok) {
      setEquipment(previous);
      return { ok: false, stage: "equipment", error: w.error || w, inventoryWritten: false, itemsWritten: false };
    }
  }

  // ── 2. what is actually going out ────────────────────────────────────────
  //
  // Seeded from original_items ?? items — see checkoutSeedItems. Skipped
  // entirely when nothing was marked החזר, which is the overwhelming majority
  // of checkouts, so the common path stays at one round-trip.
  const seedItems = checkoutSeedItems(reservation);
  const nextItems = computeCheckoutItems(seedItems, outcomes);

  // Compared against the LIVE list, not against the seed. Both cases matter:
  // a clean checkout must not write at all, and a retry whose first attempt
  // already decremented must not write again — but a retry whose first attempt
  // died BEFORE the decrement still must. Comparing the absolute target to
  // what is actually in the row answers all three.
  const currentItems = Array.isArray(reservation.items) ? reservation.items : [];
  const qtyOf = (rows, eqId) => {
    const hit = rows.find(r => String(r?.equipment_id) === String(eqId));
    return hit ? Math.max(0, Math.floor(Number(hit.quantity) || 0)) : 0;
  };
  const itemsChanged = nextItems.length !== currentItems.length
    || nextItems.some(n => qtyOf(currentItems, n.equipment_id) !== qtyOf(nextItems, n.equipment_id));

  if (itemsChanged) {
    // Freeze what was ORDERED before the decrement erases it, in the SAME
    // transaction as the decrement — a separate call would leave a window where
    // the list has shrunk with no snapshot behind it.
    //
    // Never overwritten if already present (lesson #35+#44): a second stamp
    // would be taken from the already-shrunk list and would lie.
    const alreadyStamped = Array.isArray(reservation.original_items) && reservation.original_items.length > 0;
    const originalItems = seedItems.map(i => ({
      equipment_id: i.equipment_id,
      name: i.name || "",
      quantity: Number(i.quantity) || 0,
    }));

    // ⚠️ Deliberately NOT routed through makeSaveEditedReservation. That helper
    // always sends original_items, and save_edited_reservation_v1 maps a JSON
    // null to SQL NULL — so a caller that did not hydrate the full row would
    // ERASE an existing stamp. It also ships twelve columns from a possibly
    // minutes-old client row, and fires a "הבקשה עודכנה" toast in the middle of
    // a checkout. An empty p_fields keeps every column by virtue of the RPC's
    // jsonb_exists guards, which is exactly what is wanted here.
    const { data, error } = await supabase.rpc("save_edited_reservation_v1", {
      p_reservation_id: String(reservation.id),
      p_fields: alreadyStamped ? {} : { original_items: originalItems },
      p_items: nextItems.map(i => ({
        equipment_id: i.equipment_id,
        name: i.name || "",
        quantity: Number(i.quantity) || 1,
        unit_id: i.unit_id || null,
      })),
    });
    if (error || data?.ok === false) {
      console.error("completeEquipmentCheckout: item write failed:", error || data);
      return {
        ok: false, stage: "items", error: error || data,
        inventoryWritten: inventoryChanged, itemsWritten: false,
      };
    }
  }

  // ── 3. stamp + open the loan ─────────────────────────────────────────────
  //
  // Built from `outcomes`, never from the equipment array: unit statuses drift
  // legitimately afterwards (פגום → בתיקון → תקין on "ציוד בדיקה") and the
  // archive must keep showing what was recorded at handover. null when nothing
  // unusual happened, and then the column stays NULL.
  const issuedAt = new Date().toISOString();
  const checkoutOutcomes = buildCheckoutOutcomesSnapshot({ outcomes, equipment: list, at: issuedAt });

  const rpc = await updateReservationStatus(reservation.id, "פעילה", { checkoutOutcomes });
  if (!rpc.ok) {
    // The stamp write is the one failure that leaves the request open on
    // purpose, so it gets its own stage and its own message.
    const stage = rpc.error === "checkout_stamp_write_failed" ? "stamp" : "reservation";
    return {
      ok: false, stage, error: rpc,
      inventoryWritten: inventoryChanged, itemsWritten: itemsChanged,
    };
  }

  return {
    ok: true,
    issuedAt: rpc.issued_at || issuedAt,
    rpc,
    summary,
    note: describeCheckoutExceptions(summary),
    inventoryChanged,
    itemsChanged,
    nextItems,
    checkoutOutcomes,
  };
}
