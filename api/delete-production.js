import { requireUser } from "./_auth-helper.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SERVICE_HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  const { production_id } = req.body || {};
  const productionId = String(production_id || "").trim();
  if (!productionId) {
    return res.status(400).json({ ok: false, error: "production_id is required" });
  }

  try {
    const productionResp = await fetch(
      `${SB_URL}/rest/v1/productions?id=eq.${encodeURIComponent(productionId)}&select=id,director_email&limit=1`,
      { headers: SERVICE_HEADERS }
    );
    if (!productionResp.ok) {
      const detail = await readJson(productionResp);
      return res.status(productionResp.status).json({ ok: false, error: "production_lookup_failed", detail });
    }

    const productionRows = await productionResp.json();
    const production = productionRows?.[0];
    if (!production) {
      return res.status(404).json({ ok: false, error: "production_not_found" });
    }

    const usersResp = await fetch(
      `${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(user.id)}&select=is_admin,is_warehouse&limit=1`,
      { headers: SERVICE_HEADERS }
    );
    const usersRows = usersResp.ok ? await usersResp.json() : [];
    const callerRow = usersRows?.[0] || {};
    const isStaff = Boolean(callerRow.is_admin || callerRow.is_warehouse);
    const isDirector = String(production.director_email || "").toLowerCase() === String(user.email || "").toLowerCase();

    if (!isStaff && !isDirector) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }

    const reservationsResp = await fetch(
      `${SB_URL}/rest/v1/reservations_new?production_id=eq.${encodeURIComponent(productionId)}&select=id`,
      { headers: SERVICE_HEADERS }
    );
    if (!reservationsResp.ok) {
      const detail = await readJson(reservationsResp);
      return res.status(reservationsResp.status).json({ ok: false, error: "reservation_lookup_failed", detail });
    }

    const linkedReservations = await reservationsResp.json();
    const deletedReservationIds = [];
    for (const row of linkedReservations || []) {
      const reservationId = String(row.id || "");
      if (!reservationId) continue;
      const deleteResp = await fetch(`${SB_URL}/rest/v1/rpc/delete_reservation_v1`, {
        method: "POST",
        headers: SERVICE_HEADERS,
        body: JSON.stringify({ p_reservation_id: reservationId }),
      });
      if (!deleteResp.ok) {
        const detail = await readJson(deleteResp);
        return res.status(deleteResp.status).json({
          ok: false,
          error: "reservation_delete_failed",
          reservation_id: reservationId,
          detail,
        });
      }
      deletedReservationIds.push(reservationId);
    }

    const deleteProductionResp = await fetch(
      `${SB_URL}/rest/v1/productions?id=eq.${encodeURIComponent(productionId)}`,
      {
        method: "DELETE",
        headers: { ...SERVICE_HEADERS, Prefer: "return=representation" },
      }
    );
    if (!deleteProductionResp.ok) {
      const detail = await readJson(deleteProductionResp);
      return res.status(deleteProductionResp.status).json({ ok: false, error: "production_delete_failed", detail });
    }

    await fetch(`${SB_URL}/rest/v1/activity_logs`, {
      method: "POST",
      headers: SERVICE_HEADERS,
      body: JSON.stringify({
        user_id: user.id,
        user_name: user.email,
        action: "production_deleted",
        entity: "production",
        entity_id: productionId,
        details: {
          deleted_reservation_ids: deletedReservationIds,
          director_email: production.director_email || null,
          source: "api/delete-production",
        },
      }),
    }).catch(() => {});

    return res.status(200).json({
      ok: true,
      production_id: productionId,
      deleted_reservation_ids: deletedReservationIds,
    });
  } catch (error) {
    console.error("delete-production error:", error);
    return res.status(500).json({ ok: false, error: "network_error", detail: error.message });
  }
}
