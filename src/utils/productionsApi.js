// productionsApi.js — normalized read/write for productions + production_dates + production_crew.
// Mirror of kitsApi/teamMembersApi style: singleton supabase client,
// blob<-->row shape converters, batched syncAll, RPC-backed lifecycle.

import { getLatestToken, supabase } from "../supabaseClient.js";

// ─── shape converters ──────────────────────────────────────────────────────

function dateRowToBlob(r) {
  if (!r) return null;
  return {
    id:         r.id,
    startDate:  r.start_date,
    startTime:  r.start_time,
    endDate:    r.end_date,
    endTime:    r.end_time,
    note:       r.note ?? "",
    sortOrder:  r.sort_order ?? 0,
  };
}

function crewRowToBlob(r) {
  if (!r) return null;
  return {
    id:           r.id,
    role:         r.role,
    roleLabel:    r.role_label ?? null,
    studentId:    r.student_id ?? null,
    freeTextName: r.free_text_name ?? null,
    status:       r.status,
    invitedBy:    r.invited_by,
    crewEmail:    r.crew_email ?? null,
    notes:        r.notes ?? "",
  };
}

function slotRowToBlob(r) {
  if (!r) return null;
  return {
    id:        r.id,
    role:      r.role,
    roleLabel: r.role_label ?? null,
    quantity:  r.quantity ?? 1,
    sortOrder: r.sort_order ?? 0,
  };
}

function slotBlobToRow(productionId, s, sortOrder) {
  if (!s?.id || !s?.role) return null;
  if (!["photographer","sound","custom"].includes(s.role)) return null;
  if (s.role === "custom" && !String(s.roleLabel || "").trim()) return null;
  const qty = Math.max(1, Math.min(20, Number(s.quantity) || 1));
  return {
    id:            String(s.id),
    production_id: String(productionId),
    role:          s.role,
    role_label:    s.role === "custom" ? String(s.roleLabel).trim().slice(0, 40) : null,
    quantity:      qty,
    sort_order:    Number.isFinite(sortOrder) ? sortOrder : 0,
  };
}

function productionRowToBlob(r) {
  if (!r) return null;
  return {
    id:                 r.id,
    title:              r.title ?? "",
    description:        r.description ?? "",
    directorStudentId:  r.director_student_id,
    directorEmail:      r.director_email,
    directorName:       r.director_name,
    directorPhone:      r.director_phone ?? "",
    driveUrl:           r.drive_url ?? "",
    color:              r.color ?? null,
    kitId:              r.kit_id ?? null,
    status:             r.status,
    publishedAt:        r.published_at,
    archivedAt:         r.archived_at ?? null,
    createdAt:          r.created_at,
    updatedAt:          r.updated_at,
    dates: Array.isArray(r.production_dates)
      ? r.production_dates.map(dateRowToBlob).filter(Boolean).sort((a,b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      : [],
    crew: Array.isArray(r.production_crew)
      ? r.production_crew.map(crewRowToBlob).filter(Boolean)
      : [],
    slots: Array.isArray(r.production_slots)
      ? r.production_slots.map(slotRowToBlob).filter(Boolean).sort((a,b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      : [],
  };
}

function productionBlobToRow(p) {
  if (!p?.id) return null;
  const title = String(p.title || "").trim();
  if (!title) return null;
  const driveUrl = String(p.driveUrl || "").trim();
  return {
    id:                  String(p.id),
    title,
    description:         String(p.description || ""),
    director_student_id: String(p.directorStudentId || ""),
    director_email:      String(p.directorEmail || "").toLowerCase(),
    director_name:       String(p.directorName || ""),
    director_phone:      p.directorPhone ? String(p.directorPhone) : null,
    drive_url:           driveUrl || null,
    color:               p.color && /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : null,
    kit_id:              p.kitId ? String(p.kitId) : null,
    status:              p.status || "draft",
    published_at:        p.publishedAt ?? null,
  };
}

function dateBlobToRow(productionId, d, sortOrder) {
  if (!d?.id || !d?.startDate || !d?.endDate || !d?.startTime || !d?.endTime) return null;
  return {
    id:            String(d.id),
    production_id: String(productionId),
    start_date:    d.startDate,
    start_time:    d.startTime,
    end_date:      d.endDate,
    end_time:      d.endTime,
    note:          d.note ? String(d.note) : null,
    sort_order:    Number.isFinite(sortOrder) ? sortOrder : 0,
  };
}

function crewBlobToRow(productionId, c) {
  if (!c?.id || !c?.role) return null;
  return {
    id:              String(c.id),
    production_id:   String(productionId),
    role:            c.role,
    role_label:      c.role === "custom" && c.roleLabel ? String(c.roleLabel).trim().slice(0, 40) : null,
    student_id:      c.studentId ? String(c.studentId) : null,
    free_text_name:  c.freeTextName ? String(c.freeTextName) : null,
    status:          c.status || "invited",
    invited_by:      c.invitedBy || "director",
    crew_email:      c.crewEmail ? String(c.crewEmail).toLowerCase() : null,
    notes:           c.notes ? String(c.notes) : null,
  };
}

// ─── read path ─────────────────────────────────────────────────────────────

const FULL_SELECT = "*, production_dates(*), production_crew(*), production_slots(*)";

export async function listProductions(opts = {}) {
  const { onlyPublished = false, directorEmail = null, crewEmail = null } = opts;
  let q = supabase.from("productions").select(FULL_SELECT);

  if (onlyPublished) q = q.eq("status", "published");
  if (directorEmail) q = q.ilike("director_email", String(directorEmail).toLowerCase());

  q = q.order("created_at", { ascending: false });

  const { data, error } = await q;
  if (error) {
    console.warn("[productionsApi.listProductions]", error);
    return [];
  }
  let rows = (data ?? []).map(productionRowToBlob);

  if (crewEmail) {
    const em = String(crewEmail).toLowerCase();
    rows = rows.filter(p => (p.crew || []).some(c => (c.crewEmail || "").toLowerCase() === em));
  }
  return rows;
}

export async function getProduction(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from("productions")
    .select(FULL_SELECT)
    .eq("id", String(id))
    .maybeSingle();
  if (error) {
    console.warn("[productionsApi.getProduction]", id, error);
    return null;
  }
  return productionRowToBlob(data);
}

// ─── write path ────────────────────────────────────────────────────────────
// upsertProduction performs three diffs in sequence:
//   1. productions row (single upsert)
//   2. production_dates: upsert wanted rows, delete missing
//   3. production_crew:  upsert wanted rows, delete missing
// Director email is set by the caller (typically currentUser.email).

export async function upsertProduction(blob) {
  const prodRow = productionBlobToRow(blob);
  if (!prodRow) return { ok: false, error: "missing id or title" };

  let step = "productions";
  try {
    step = "productions";
    const { error: pErr } = await supabase
      .from("productions")
      .upsert(prodRow, { onConflict: "id" });
    if (pErr) throw pErr;

    const wantedDates = (Array.isArray(blob.dates) ? blob.dates : [])
      .map((d, idx) => dateBlobToRow(blob.id, d, idx))
      .filter(Boolean);
    const wantedDateIds = new Set(wantedDates.map(d => d.id));

    step = "production_dates:list";
    const { data: existingDates, error: dlErr } = await supabase
      .from("production_dates")
      .select("id")
      .eq("production_id", blob.id);
    if (dlErr) throw dlErr;

    const datesToDelete = (existingDates ?? [])
      .map(r => r.id)
      .filter(id => !wantedDateIds.has(id));

    if (wantedDates.length > 0) {
      step = "production_dates:upsert";
      const { error: dUpErr } = await supabase
        .from("production_dates")
        .upsert(wantedDates, { onConflict: "id" });
      if (dUpErr) throw dUpErr;
    }
    for (const id of datesToDelete) {
      step = `production_dates:delete:${id}`;
      const { error: dDelErr } = await supabase
        .from("production_dates")
        .delete()
        .eq("id", id);
      if (dDelErr) throw dDelErr;
    }

    // ─── production_slots ───────────────────────────────────────────────────
    const wantedSlots = (Array.isArray(blob.slots) ? blob.slots : [])
      .map((s, idx) => slotBlobToRow(blob.id, s, idx))
      .filter(Boolean);
    const wantedSlotIds = new Set(wantedSlots.map(s => s.id));

    step = "production_slots:list";
    const { data: existingSlots, error: slErr } = await supabase
      .from("production_slots")
      .select("id")
      .eq("production_id", blob.id);
    if (slErr) throw slErr;

    const slotsToDelete = (existingSlots ?? [])
      .map(r => r.id)
      .filter(id => !wantedSlotIds.has(id));

    if (wantedSlots.length > 0) {
      step = "production_slots:upsert";
      const { error: sUpErr } = await supabase
        .from("production_slots")
        .upsert(wantedSlots, { onConflict: "id" });
      if (sUpErr) throw sUpErr;
    }
    for (const id of slotsToDelete) {
      step = `production_slots:delete:${id}`;
      const { error: sDelErr } = await supabase
        .from("production_slots")
        .delete()
        .eq("id", id);
      if (sDelErr) throw sDelErr;
    }

    const wantedCrew = (Array.isArray(blob.crew) ? blob.crew : [])
      .map(c => crewBlobToRow(blob.id, c))
      .filter(Boolean);
    const wantedCrewIds = new Set(wantedCrew.map(c => c.id));

    step = "production_crew:list";
    const { data: existingCrew, error: clErr } = await supabase
      .from("production_crew")
      .select("id")
      .eq("production_id", blob.id);
    if (clErr) throw clErr;

    const crewToDelete = (existingCrew ?? [])
      .map(r => r.id)
      .filter(id => !wantedCrewIds.has(id));

    if (wantedCrew.length > 0) {
      step = "production_crew:upsert";
      const { error: cUpErr } = await supabase
        .from("production_crew")
        .upsert(wantedCrew, { onConflict: "id" });
      if (cUpErr) throw cUpErr;
    }
    for (const id of crewToDelete) {
      step = `production_crew:delete:${id}`;
      const { error: cDelErr } = await supabase
        .from("production_crew")
        .delete()
        .eq("id", id);
      if (cDelErr) throw cDelErr;
    }

    // Recompute archive state now that dates are written — instant archive/restore
    // (no wait for the daily cron). Best-effort: never fail the save if this errors.
    step = "productions_refresh_archive";
    try {
      const { error: aErr } = await supabase.rpc("productions_refresh_archive_v1", {
        p_production_id: String(blob.id),
      });
      if (aErr) console.warn("[productionsApi.upsertProduction] archive refresh", aErr);
    } catch (aErr) {
      console.warn("[productionsApi.upsertProduction] archive refresh", aErr);
    }

    return { ok: true };
  } catch (err) {
    console.error(`[productionsApi.upsertProduction] step=${step} id=${blob?.id}`, err);
    return { ok: false, error: `[${step}] ${err?.message || String(err)}` };
  }
}

export async function notifyProductionCrewInvites(productionId, crewIds) {
  const ids = Array.isArray(crewIds)
    ? [...new Set(crewIds.map(id => String(id || "").trim()).filter(Boolean))]
    : [];
  if (!productionId || ids.length === 0) return { ok: true, sent: 0 };

  try {
    let token = getLatestToken();
    if (!token) {
      const { data } = await supabase.auth.getSession();
      token = data?.session?.access_token || null;
    }
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch("/api/notify-production-crew", {
      method: "POST",
      headers,
      body: JSON.stringify({
        production_id: String(productionId),
        crew_ids: ids,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 207) {
      const failure = Array.isArray(data?.failures) && data.failures[0] ? data.failures[0] : null;
      return {
        ok: false,
        error: failure?.error || data?.error || `notify failed (${res.status})`,
        details: data,
      };
    }
    return { ok: true, sent: Number(data?.sent || 0), details: data };
  } catch (err) {
    console.warn("[productionsApi.notifyProductionCrewInvites]", err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function publishProduction(id) {
  if (!id) return { ok: false, error: "missing id" };
  try {
    const { error } = await supabase
      .from("productions")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", String(id));
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.error("[productionsApi.publishProduction]", id, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function deleteProduction(id) {
  if (!id) return { ok: false, error: "missing id" };
  try {
    const { data, error } = await supabase.rpc("production_delete_v1", {
      p_production_id: String(id),
    });
    if (error) throw error;
    return { ok: true, result: data };
  } catch (err) {
    console.warn("[productionsApi.deleteProduction]", id, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

// ─── crew approval (director-only, automatic) ──────────────────────────────
// The self-join / invitation-acceptance flow was removed (2026-07): the
// director composes the crew directly and rows are auto-approved on save via
// production_approve_crew_v1 (which also runs the reservation cert-recheck +
// crew-snapshot refresh for photographer/sound — the recheck RPC itself is
// service_role-only, so this RPC is the only client-reachable path to it).

function translateCrewError(rawMsg) {
  const msg = String(rawMsg || "");
  // Overlap conflict: parse the JSON array of conflicting productions and format in Hebrew.
  if (msg.includes("already approved on another production with overlapping dates")) {
    const jsonMatch = msg.match(/\[\{.*\}\]/);
    if (jsonMatch) {
      try {
        const conflicts = JSON.parse(jsonMatch[0]);
        const lines = conflicts.map(c => {
          const title = c.other_title || "הפקה אחרת";
          const s = (c.start_date || "").split("-").reverse().join("/");
          const e = (c.end_date || "").split("-").reverse().join("/");
          const range = s === e ? s : `${s}–${e}`;
          return `"${title}" (${range})`;
        });
        return `כבר מאושר/ת כצוות בהפקה חופפת בתאריכים: ${lines.join(", ")}. אי-אפשר לאשר השתתפות בשתי הפקות חופפות.`;
      } catch {/* fall through */}
    }
    return "כבר מאושר/ת בהפקה אחרת בתאריכים חופפים — אי-אפשר לאשר השתתפות בשתי הפקות חופפות.";
  }
  if (msg.includes("caller is neither the director nor the invited student")) {
    return "רק הבמאי או הסטודנט המוזמן יכולים לאשר/לדחות הזמנה זו.";
  }
  if (msg.includes("crew row") && msg.includes("not found")) {
    return "השורה לא נמצאה — ייתכן שכבר טופלה. רענן את הדף.";
  }
  return msg;
}

export async function approveCrewMember(crewId) {
  if (!crewId) return { ok: false, error: "missing crewId" };
  try {
    const { data, error } = await supabase.rpc("production_approve_crew_v1", {
      p_crew_id:  String(crewId),
      p_decision: "approved",
    });
    if (error) throw error;
    return { ok: true, result: data };
  } catch (err) {
    return { ok: false, error: translateCrewError(err?.message || String(err)) };
  }
}

// Auto-approve director-composed crew rows after a save. Sequential (few
// rows), best-effort: a failed row stays 'invited' and converges on the next
// save (the RPC no-ops on already-approved rows). Only rows the editor wrote
// as pending are targeted — self-join zombies (legacy) are never touched.
export async function autoApproveDirectorCrew(crew) {
  const targets = (crew || []).filter(c =>
    c.status === "invited" && (c.invitedBy || "director") !== "self" && c.studentId);
  const approvedIds = [], failures = [];
  for (const c of targets) {
    const r = await approveCrewMember(c.id);
    if (r.ok) approvedIds.push(c.id);
    else failures.push({ id: c.id, error: r.error });
  }
  return { ok: failures.length === 0, approvedIds, failures };
}
