// Kept dependency-free on purpose: this module is imported by the browser AND
// by api/staff-review-reservation-update.js (Node/Vercel), so it must not pull
// in src/utils.js — that file imports the browser supabase client and touches
// import.meta/window. normalizeName is a verbatim copy of the utils.js one-liner
// (src/utils.js:489), so client and server run byte-identical logic.
function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function matchByNamePhone(students, name, phone) {
  const normalizePhone = value => String(value || "").replace(/[^0-9]/g, "");
  const normalizedName = normalizeName(name || "");
  if (!normalizedName) return null;
  const matches = (students || []).filter(student => normalizeName(student.name) === normalizedName);
  if (matches.length <= 1) return matches[0] || null;
  const normalizedPhone = normalizePhone(phone);
  return matches.find(student => normalizePhone(student.phone) === normalizedPhone) || matches[0];
}

export function getProductionCertBlockers(reservation, equipment, certificationsState) {
  if (reservation?.loan_type !== "הפקה") return [];
  const students = certificationsState?.students || [];
  const certTypes = certificationsState?.types || [];
  const photographer = matchByNamePhone(students, reservation.crew_photographer_name, reservation.crew_photographer_phone);
  const sound = reservation.crew_sound_name
    ? matchByNamePhone(students, reservation.crew_sound_name, reservation.crew_sound_phone)
    : null;
  const photographerCerts = photographer?.certs || {};
  const soundCerts = sound?.certs || {};

  return (reservation.items || []).flatMap(item => {
    const eq = (equipment || []).find(candidate => String(candidate.id) === String(item.equipment_id));
    if (!eq?.certification_id) return [];
    const certId = eq.certification_id;
    if (photographerCerts[certId] === "עבר" || soundCerts[certId] === "עבר") return [];
    return [{
      equipment_name: eq.name,
      certification_name: certTypes.find(type => type.id === certId)?.name || certId,
    }];
  });
}
