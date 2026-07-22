// staff-review-reservation-update.js — a warehouse staff member reviews a
// pending equipment-list update on an approved reservation: approve in full,
// approve reduced quantities, or reject items / the whole update.
//
// Routes through public.staff_review_reservation_update_v3 (migration
// 20260722151000), which re-checks availability (peak-concurrent) under
// equipment row locks and applies the decision atomically. The reviewer's
// identity is derived from the JWT here (requireStaff + resolveUserRole) —
// never from the client (same contract as the returned_by stamp, PR #80).
//
// After a successful review with outcome 'rejected' or 'partial', this layer
// emails the student through the shared branded /api/send-email (type
// "reservation_update_review"), forwarding the staff JWT for authorization.
// A full approval sends no email (product spec); an email failure is logged
// but does not fail the request — the review itself already committed.
//
// PROTOCOL:
//   POST /api/staff-review-reservation-update
//   body: {
//     update_id: number,
//     decisions: [ { pending_item_id: number, decision: "approve"|"reject", approved_quantity?: number } ],
//     staff_message?: string,   // optional free text for the student email
//   }
//   200: { ok:true, outcome:"approved"|"partial"|"rejected"|"cancelled_started", ... }
//   400: validation / invalid decisions
//   401/403: not staff
//   404: update / reservation not found
//   409: not_pending | update_overbook | external_restricted | private_limit
//   5xx: rpc/network error

import { requireStaff, resolveUserRole } from "./_auth-helper.js";
import { getProductionCertBlockers } from "../src/utils/reservationUpdateReview.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SERVICE_HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

// Minimal HTML-escape for untrusted text injected into the email body.
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// Where to reach /api/send-email from inside this function (same pattern as
// api/calendar-sync.js — request headers first, they exist on every invocation).
function baseUrlFor(req) {
  const host = req?.headers?.["x-forwarded-host"] || req?.headers?.host;
  if (host) {
    const proto = req.headers["x-forwarded-proto"] || (String(host).startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:5174";
}

const ACTION_LABEL = { add: "הוספה", increase: "הגדלת כמות" };

function itemLine(it) {
  const label = ACTION_LABEL[it.action] || it.action;
  return `${esc(it.name || "פריט")} — ${label}, כמות: ${Number(it.requested) || 0}`;
}

// The pre-rendered details block for the email: what was asked, what was
// approved, what was rejected/reduced, and the staff message (or the default
// auto-text when none was written — a blank email is never sent).
function buildDetailsHtml({ outcome, approved, rejected, staffMessage }) {
  const parts = [];
  if (approved.length) {
    parts.push(
      `<div style="font-weight:800;color:#2ecc71;margin-bottom:6px;font-size:14px">✅ פריטים שאושרו</div>` +
      approved.map((it) => {
        const reduced = Number(it.approved) < Number(it.requested)
          ? ` <span style="color:#f5a623">(אושרו ${Number(it.approved)} מתוך ${Number(it.requested)})</span>` : "";
        return `<div style="color:#e8eaf0;font-size:13px;line-height:1.8">${itemLine(it)}${reduced}</div>`;
      }).join(""),
    );
  }
  if (rejected.length) {
    parts.push(
      `<div style="font-weight:800;color:#e74c3c;margin:${approved.length ? "12px" : "0"} 0 6px;font-size:14px">✖ פריטים שנדחו</div>` +
      rejected.map((it) => `<div style="color:#e8eaf0;font-size:13px;line-height:1.8"><s style="color:#8b93a7">${itemLine(it)}</s></div>`).join(""),
    );
  }
  const fallback = outcome === "rejected"
    ? "צוות המחסן בחן את הבקשה ולא ניתן היה לאשר את העדכון. רשימת הציוד המאושרת שלך נשארה ללא שינוי."
    : "צוות המחסן בחן את הבקשה; חלק מהפריטים לא היו זמינים או לא אושרו.";
  parts.push(
    `<div style="font-weight:800;color:#3498db;margin:12px 0 6px;font-size:14px">💬 הודעה מצוות המחסן</div>` +
    `<div style="color:#e8eaf0;font-size:13px;line-height:1.8;white-space:pre-wrap">${esc(staffMessage && staffMessage.trim() ? staffMessage.trim() : fallback)}</div>`,
  );
  return parts.join("");
}

const sbGet = async (path) => {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SERVICE_HEADERS });
  if (!r.ok) return null;
  return r.json();
};

// Re-check production certifications for the items about to be APPROVED.
// Returns [] when clear, a blocker array when not, or null on a fetch failure
// (fail closed — the caller turns that into a 502 rather than approving blind).
//
// Deliberately cheap on the common path: it exits before touching the students
// table unless this is a הפקה loan whose approved items actually carry a
// certification requirement.
async function checkCertBlockers(updateId, decisions) {
  const approvedIds = new Set(
    decisions.filter((d) => d.decision === "approve").map((d) => Number(d.pending_item_id)),
  );
  if (approvedIds.size === 0) return []; // full rejection needs no cert check

  const updates = await sbGet(
    `reservation_item_updates?id=eq.${Number(updateId)}&select=id,reservation_id,items:reservation_pending_items(id,equipment_id,name,quantity,review_state)&limit=1`,
  );
  if (!Array.isArray(updates)) return null;
  const update = updates[0];
  if (!update) return []; // the RPC will 404 on its own

  const items = (update.items || []).filter(
    (it) => it.review_state === "pending" && approvedIds.has(Number(it.id)),
  );
  if (items.length === 0) return [];

  const reservations = await sbGet(
    `reservations_new?id=eq.${encodeURIComponent(update.reservation_id)}&select=id,loan_type,crew_photographer_name,crew_photographer_phone,crew_sound_name,crew_sound_phone&limit=1`,
  );
  if (!Array.isArray(reservations)) return null;
  const reservation = reservations[0];
  if (!reservation || reservation.loan_type !== "הפקה") return []; // gate is production-only

  const eqIds = [...new Set(items.map((it) => String(it.equipment_id)).filter(Boolean))];
  if (eqIds.length === 0) return [];
  const equipment = await sbGet(
    `equipment?id=in.(${eqIds.map((id) => `"${id}"`).join(",")})&select=id,name,certification_id`,
  );
  if (!Array.isArray(equipment)) return null;
  if (!equipment.some((eq) => eq.certification_id)) return []; // nothing gated

  const [studentRows, certTypes] = await Promise.all([
    sbGet("students?select=id,name,phone,student_certifications(cert_type_id,status)"),
    sbGet("certification_types?select=id,name"),
  ]);
  if (!Array.isArray(studentRows) || !Array.isArray(certTypes)) return null;

  // Same shape the client builds in studentsApi.shapeStudents.
  const students = studentRows.map((s) => ({
    name: s.name,
    phone: s.phone ?? "",
    certs: Object.fromEntries(
      (s.student_certifications || [])
        .filter((c) => c.cert_type_id && c.status)
        .map((c) => [c.cert_type_id, c.status]),
    ),
  }));

  return getProductionCertBlockers(
    { ...reservation, items: items.map((it) => ({ equipment_id: it.equipment_id, quantity: it.quantity })) },
    equipment,
    { students, types: certTypes },
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const staff = await requireStaff(req, res);
  if (!staff) return;

  const { update_id, decisions, staff_message } = req.body || {};

  if (update_id == null || !Number.isFinite(Number(update_id))) {
    return res.status(400).json({ ok: false, error: "update_id is required" });
  }
  if (!Array.isArray(decisions) || decisions.length === 0 || decisions.length > 60) {
    return res.status(400).json({ ok: false, error: "invalid decisions" });
  }
  for (const d of decisions) {
    if (!d || !Number.isFinite(Number(d.pending_item_id))) {
      return res.status(400).json({ ok: false, error: "invalid decisions" });
    }
    if (d.decision !== "approve" && d.decision !== "reject") {
      return res.status(400).json({ ok: false, error: "invalid decisions" });
    }
    if (d.approved_quantity != null &&
        (!Number.isFinite(Number(d.approved_quantity)) || Number(d.approved_quantity) < 1)) {
      return res.status(400).json({ ok: false, error: "invalid decisions" });
    }
  }

  // Reviewer display name from the JWT-verified users row (never the client).
  const role = await resolveUserRole(req);
  const actorName = role.full_name || staff.email || "צוות המחסן";

  try {
    // ── Certification gate (server-side) ──────────────────────────────────
    // The review panel promises staff that certifications are re-checked on
    // approval. The RPC does availability / external-loan / private-4 but NOT
    // certifications, so without this the promise was false and a direct API
    // call bypassed the production cert rule entirely. Runs the SAME
    // getProductionCertBlockers the client pre-checks with, so both agree.
    const certBlockers = await checkCertBlockers(update_id, decisions);
    if (certBlockers === null) {
      return res.status(502).json({ ok: false, error: "cert_check_failed" });
    }
    if (certBlockers.length) {
      const names = [...new Set(certBlockers.map((b) => `${b.equipment_name} (${b.certification_name})`))];
      return res.status(409).json({
        ok: false,
        error: "cert_required",
        blockers: certBlockers,
        reason: `לא ניתן לאשר — הצלם/איש הסאונד טרם הוסמכו על: ${names.join(", ")}`,
      });
    }

    const r = await fetch(`${SB_URL}/rest/v1/rpc/staff_review_reservation_update_v3`, {
      method: "POST",
      headers: SERVICE_HEADERS,
      body: JSON.stringify({
        p_update_id:     Number(update_id),
        p_actor_id:      staff.staffId,
        p_actor_name:    actorName,
        p_decisions:     decisions.map((d) => ({
          pending_item_id: Number(d.pending_item_id),
          decision:        d.decision,
          ...(d.approved_quantity != null ? { approved_quantity: Number(d.approved_quantity) } : {}),
        })),
        p_staff_message: staff_message ? String(staff_message) : null,
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      const token =
        /not found/i.test(text)             ? ["not_found", 404]
        : /not_pending/i.test(text)         ? ["not_pending", 409]
        : /update_overbook/i.test(text)     ? ["update_overbook", 409]
        : /external_restricted/i.test(text) ? ["external_restricted", 409]
        : /private_limit/i.test(text)       ? ["private_limit", 409]
        : /missing_decision|invalid_decisions/i.test(text) ? ["invalid_decisions", 400]
        : ["rpc_error", r.status];
      console.error("staff-review-reservation-update RPC error:", r.status, text);
      return res.status(token[1]).json({ ok: false, error: token[0], detail: text });
    }

    const result = await r.json();

    // ── student email on rejection / partial approval (spec) ───────────────
    // Fire after the review committed; a mail failure must not undo it.
    if (result?.outcome === "rejected" || result?.outcome === "partial") {
      try {
        const resvRes = await fetch(
          `${SB_URL}/rest/v1/reservations_new?id=eq.${encodeURIComponent(result.reservation_id)}&select=email,student_name,project_name,loan_type,borrow_date,borrow_time,return_date,return_time&limit=1`,
          { headers: SERVICE_HEADERS },
        );
        const resv = resvRes.ok ? (await resvRes.json())?.[0] : null;
        if (resv?.email) {
          const approved = Array.isArray(result.approved_items) ? result.approved_items : [];
          const rejected = Array.isArray(result.rejected_items) ? result.rejected_items : [];
          const mailRes = await fetch(`${baseUrlFor(req)}/api/send-email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // Forward the staff JWT — send-email authorizes non-anon types
              // through resolveUserRole on this same token.
              Authorization: req.headers.authorization || "",
            },
            body: JSON.stringify({
              to:                  resv.email,
              type:                "reservation_update_review",
              update_outcome:      result.outcome,
              update_details_html: buildDetailsHtml({
                outcome:      result.outcome,
                approved, rejected,
                staffMessage: staff_message,
              }),
              student_name: resv.student_name || "",
              project_name: resv.project_name || "",
              loan_type:    resv.loan_type || "",
              borrow_date:  resv.borrow_date || "",
              borrow_time:  resv.borrow_time || "",
              return_date:  resv.return_date || "",
              return_time:  resv.return_time || "",
            }),
          });
          if (!mailRes.ok) {
            console.error("staff-review-reservation-update email failed:", mailRes.status, await mailRes.text());
          }
        }
      } catch (mailErr) {
        console.error("staff-review-reservation-update email error:", mailErr);
      }
    }

    return res.status(200).json(result);
  } catch (e) {
    console.error("staff-review-reservation-update network error:", e);
    return res.status(500).json({ ok: false, error: "network_error", detail: e.message });
  }
}
