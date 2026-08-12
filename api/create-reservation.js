// create-reservation.js — atomic reservation creation.
//
// PURPOSE:
//   Fix the race condition from the Gemini audit (#1 critical) by routing
//   every new reservation through the atomic RPC create_reservation_v2
//   (migration 003, section 6). The RPC takes a FOR UPDATE lock on each
//   equipment row it touches, re-checks availability under the lock, and
//   only then inserts — so two concurrent submits can never both succeed
//   for the last available unit.
//
// PROTOCOL:
//   POST /api/create-reservation
//   body: { reservation: {...}, items: [{equipment_id, name, quantity, unit_id?}, ...] }
//   200:  { ok: true, id: "<new id>" }
//   409:  { ok: false, error: "not_enough_stock", detail: "<rpc raise msg>" }
//   4xx:  validation errors
//   5xx:  server/network errors
//
// NOTES:
//   * Uses service_role key — never expose this endpoint details to the
//     client beyond the fields documented above.
//   * Does NOT touch store.reservations. The caller is expected to
//     follow up with storageSet("reservations", [...fresh, newRes]) to
//     keep the JSON blob in sync for stage-3 reads. The mirror then
//     runs with the 60-second grace period (migration 007) so a stale
//     blob cannot prune parallel atomic inserts.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Record the phone the student just typed onto their students row — but ONLY
// when that row has none.
//
// Why this exists: the phone was being kept as a per-request snapshot and never
// written back, so the roster in Administration → Students sat almost entirely
// empty while the numbers themselves existed, scattered across individual
// requests. The warehouse had no single place to look.
//
// FILL-ONLY, NEVER OVERWRITE. The `or=(phone.is.null,phone.eq.)` filter lives in
// the URL rather than in a read-then-write here, so the "only if empty" test and
// the write are one statement that two concurrent submits cannot interleave —
// the same trick the return-outcomes PATCH uses to stay one-shot (lesson #48).
// A student fat-fingering a digit can therefore never clobber a good number the
// office already has; correcting one stays a deliberate admin action.
//
// Same normalisation the self-service endpoint enforces (api/auth.js): strip
// separators, then 7–15 digits with an optional leading +.
async function recordStudentPhone(reservation) {
  const email = String(reservation?.email || "").trim().toLowerCase();
  const phone = String(reservation?.phone || "").trim();
  if (!email || !phone) return;
  if (!/^\+?\d{7,15}$/.test(phone.replace(/[^\d+]/g, ""))) return;

  const url = `${SB_URL}/rest/v1/students`
    + `?email=eq.${encodeURIComponent(email)}`
    + `&or=(phone.is.null,phone.eq.)`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ phone }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { reservation, items } = req.body || {};

  if (!reservation || typeof reservation !== "object") {
    return res.status(400).json({ ok: false, error: "Missing reservation object" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: "items must be a non-empty array" });
  }
  for (const it of items) {
    if (!it || typeof it !== "object") {
      return res.status(400).json({ ok: false, error: "Invalid item entry" });
    }
    if (!it.equipment_id) {
      return res.status(400).json({ ok: false, error: "Every item needs an equipment_id" });
    }
    const qty = Number(it.quantity ?? 1);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ ok: false, error: "quantity must be a positive number" });
    }
  }

  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/create_reservation_v2`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_reservation: reservation,
        p_items:       items,
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      // The RPC RAISEs with messages like
      //   "create_reservation_v2: not enough units for ... — requested X, available Y"
      // Map that to a 409 so the client can show a clean Hebrew error.
      const looksLikeStockIssue      = /not enough units/i.test(text);
      // Per-student overlap guard raise (see create_reservation_v2).
      const looksLikeStudentOverlap  = /student_overlap|same student already has/i.test(text);
      // External-loan restriction guard raise (see create_reservation_v2).
      const looksLikeExternalRestricted = /external_restricted|blocked from external loans/i.test(text);
      const status = (looksLikeStockIssue || looksLikeStudentOverlap || looksLikeExternalRestricted) ? 409 : r.status;
      console.error("create-reservation RPC error:", r.status, text);
      return res.status(status).json({
        ok: false,
        error: looksLikeExternalRestricted ? "external_restricted"
             : looksLikeStudentOverlap ? "student_overlap"
             : looksLikeStockIssue     ? "not_enough_stock"
             : "rpc_error",
        detail: text,
      });
    }

    // The RPC returns the new reservation id as a TEXT scalar.
    // PostgREST wraps it as a JSON scalar (string).
    const id = await r.json();

    // Stage 5 complete (migration 024): the store.reservations blob has been
    // retired. Reservations live exclusively in reservations_new /
    // reservation_items. The legacy append_to_store_reservations mirror call
    // was removed on 2026-04-24 together with migration 024.

    // Bookkeeping, not part of the booking: the reservation is already committed
    // and the student is owed their confirmation. A failure here is logged and
    // swallowed rather than turned into an error they cannot act on — the same
    // stance the actor-stamping PATCH takes (lesson #37+#41).
    try {
      await recordStudentPhone(reservation);
    } catch (phoneErr) {
      console.warn("create-reservation: student phone backfill failed:", phoneErr?.message || phoneErr);
    }

    return res.status(200).json({ ok: true, id });
  } catch (e) {
    console.error("create-reservation network error:", e);
    return res.status(500).json({ ok: false, error: "network_error", detail: e.message });
  }
}
