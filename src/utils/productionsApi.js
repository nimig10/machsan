// productionsApi.js — normalized read/write for productions + production_dates + production_crew.
// Mirror of kitsApi/teamMembersApi style: singleton supabase client,
// blob<-->row shape converters, batched syncAll, RPC-backed lifecycle.

import { supabase } from "../supabaseClient.js";

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
    studentId:    r.student_id ?? null,
    freeTextName: r.free_text_name ?? null,
    status:       r.status,
    invitedBy:    r.invited_by,
    crewEmail:    r.crew_email ?? null,
    notes:        r.notes ?? "",
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
    status:             r.status,
    publishedAt:        r.published_at,
    createdAt:          r.created_at,
    updatedAt:          r.updated_at,
    dates: Array.isArray(r.production_dates)
      ? r.production_dates.map(dateRowToBlob).filter(Boolean).sort((a,b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      : [],
    crew: Array.isArray(r.production_crew)
      ? r.production_crew.map(crewRowToBlob).filter(Boolean)
      : [],
  };
}

function productionBlobToRow(p) {
  if (!p?.id) return null;
  const title = String(p.title || "").trim();
  if (!title) return null;
  return {
    id:                  String(p.id),
    title,
    description:         String(p.description || ""),
    director_student_id: String(p.directorStudentId || ""),
    director_email:      String(p.directorEmail || "").toLowerCase(),
    director_name:       String(p.directorName || ""),
    director_phone:      p.directorPhone ? String(p.directorPhone) : null,
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
    student_id:      c.studentId ? String(c.studentId) : null,
    free_text_name:  c.freeTextName ? String(c.freeTextName) : null,
    status:          c.status || "invited",
    invited_by:      c.invitedBy || "director",
    crew_email:      c.crewEmail ? String(c.crewEmail).toLowerCase() : null,
    notes:           c.notes ? String(c.notes) : null,
  };
}

// ─── read path ─────────────────────────────────────────────────────────────

const FULL_SELECT = "*, production_dates(*), production_crew(*)";

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

  try {
    const { error: pErr } = await supabase
      .from("productions")
      .upsert(prodRow, { onConflict: "id" });
    if (pErr) throw pErr;

    const wantedDates = (Array.isArray(blob.dates) ? blob.dates : [])
      .map((d, idx) => dateBlobToRow(blob.id, d, idx))
      .filter(Boolean);
    const wantedDateIds = new Set(wantedDates.map(d => d.id));

    const { data: existingDates, error: dlErr } = await supabase
      .from("production_dates")
      .select("id")
      .eq("production_id", blob.id);
    if (dlErr) throw dlErr;

    const datesToDelete = (existingDates ?? [])
      .map(r => r.id)
      .filter(id => !wantedDateIds.has(id));

    if (wantedDates.length > 0) {
      const { error: dUpErr } = await supabase
        .from("production_dates")
        .upsert(wantedDates, { onConflict: "id" });
      if (dUpErr) throw dUpErr;
    }
    for (const id of datesToDelete) {
      const { error: dDelErr } = await supabase
        .from("production_dates")
        .delete()
        .eq("id", id);
      if (dDelErr) throw dDelErr;
    }

    const wantedCrew = (Array.isArray(blob.crew) ? blob.crew : [])
      .map(c => crewBlobToRow(blob.id, c))
      .filter(Boolean);
    const wantedCrewIds = new Set(wantedCrew.map(c => c.id));

    const { data: existingCrew, error: clErr } = await supabase
      .from("production_crew")
      .select("id")
      .eq("production_id", blob.id);
    if (clErr) throw clErr;

    const crewToDelete = (existingCrew ?? [])
      .map(r => r.id)
      .filter(id => !wantedCrewIds.has(id));

    if (wantedCrew.length > 0) {
      const { error: cUpErr } = await supabase
        .from("production_crew")
        .upsert(wantedCrew, { onConflict: "id" });
      if (cUpErr) throw cUpErr;
    }
    for (const id of crewToDelete) {
      const { error: cDelErr } = await supabase
        .from("production_crew")
        .delete()
        .eq("id", id);
      if (cDelErr) throw cDelErr;
    }

    return { ok: true };
  } catch (err) {
    console.warn("[productionsApi.upsertProduction]", blob?.id, err);
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
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function deleteProduction(id) {
  if (!id) return { ok: false, error: "missing id" };
  try {
    const { data, error } = await supabase.rpc("production_delete_v1", { p_production_id: String(id) });
    if (error) throw error;
    return { ok: true, result: data };
  } catch (err) {
    console.warn("[productionsApi.deleteProduction]", id, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

// ─── crew self-service ─────────────────────────────────────────────────────

export async function requestJoinProduction(productionId, role, blob) {
  if (!productionId || !role) return { ok: false, error: "missing productionId or role" };
  try {
    const row = {
      id:              `pc_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      production_id:   String(productionId),
      role,
      student_id:      blob?.studentId ? String(blob.studentId) : null,
      free_text_name:  blob?.freeTextName ? String(blob.freeTextName) : null,
      status:          "invited",
      invited_by:      "self",
      crew_email:      String(blob?.crewEmail || "").toLowerCase() || null,
      notes:           blob?.notes ? String(blob.notes) : null,
    };
    if (!row.crew_email) return { ok: false, error: "missing crew_email" };
    if (row.role === "photographer" || row.role === "sound") {
      if (!row.student_id) return { ok: false, error: "photographer/sound requires student_id" };
    }
    const { error } = await supabase.from("production_crew").insert(row);
    if (error) throw error;
    return { ok: true, id: row.id };
  } catch (err) {
    console.warn("[productionsApi.requestJoinProduction]", err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function withdrawJoinRequest(crewId) {
  if (!crewId) return { ok: false, error: "missing crewId" };
  try {
    const { error } = await supabase.from("production_crew").delete().eq("id", String(crewId));
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
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
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function rejectCrewMember(crewId) {
  if (!crewId) return { ok: false, error: "missing crewId" };
  try {
    const { data, error } = await supabase.rpc("production_approve_crew_v1", {
      p_crew_id:  String(crewId),
      p_decision: "rejected",
    });
    if (error) throw error;
    return { ok: true, result: data };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function removeCrewMember(crewId) {
  if (!crewId) return { ok: false, error: "missing crewId" };
  try {
    const { error } = await supabase.from("production_crew").delete().eq("id", String(crewId));
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function checkCrewConflict(studentId, productionId) {
  if (!studentId || !productionId) return { ok: false, error: "missing studentId or productionId" };
  try {
    const { data, error } = await supabase.rpc("production_check_crew_conflict_v1", {
      p_student_id:    String(studentId),
      p_production_id: String(productionId),
    });
    if (error) throw error;
    return { ok: true, result: data };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}
