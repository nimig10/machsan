/* global process */
import { sendTypedEmail } from "./send-email.js";

const SB_URL = process.env.VITE_SUPABASE_URL || "https://wxkyqgwwraojnbmyyfco.supabase.co";
const SB_KEY = process.env.VITE_SUPABASE_KEY || "sb_publishable_n-mkSq7xABjj58ZBBwk6BA_RbpVS2SU";
const ONE_HOUR_MS = 60 * 60 * 1000;

const SB_HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}

function toDateTime(dateStr, timeStr = "23:59") {
  const base = parseLocalDate(dateStr);
  if (!base) return null;
  const [hours, minutes] = String(timeStr || "23:59").split(":").map(Number);
  base.setHours(Number.isFinite(hours) ? hours : 23, Number.isFinite(minutes) ? minutes : 59, 0, 0);
  return base.getTime();
}

function formatDate(dateStr) {
  const parsed = parseLocalDate(dateStr);
  return parsed
    ? parsed.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "";
}

function normalizeReservationStatus(status) {
  return status === "ממתין לאישור ראש המחלקה" ? "אישור ראש מחלקה" : status;
}

function isValidEmailAddress(email) {
  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(String(email || "").trim());
}

async function getStoreData(key) {
  const response = await fetch(`${SB_URL}/rest/v1/store?key=eq.${key}&select=data`, { headers: SB_HEADERS });
  if (!response.ok) {
    throw new Error(`Failed loading ${key}: ${await response.text()}`);
  }
  const json = await response.json();
  return Array.isArray(json) && json[0]?.data ? json[0].data : [];
}

async function saveStoreData(key, data) {
  const response = await fetch(`${SB_URL}/rest/v1/store`, {
    method: "POST",
    headers: { ...SB_HEADERS, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ key, data, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    throw new Error(`Failed saving ${key}: ${await response.text()}`);
  }
}

function buildItemsRows(items = [], equipment = []) {
  return (items || []).map((item) => {
    const eq = (equipment || []).find((entry) => entry.id == item.equipment_id);
    const name = eq?.name || item.name || "פריט";
    const quantity = Number(item.quantity) || 0;
    return `<tr>
      <td style="padding:7px 12px;color:#e8eaf0;border-bottom:1px solid #1e2130">${name}</td>
      <td style="padding:7px 12px;color:#e8eaf0;border-bottom:1px solid #1e2130;text-align:center">${quantity}</td>
    </tr>`;
  }).join("");
}

function getUniqueTeamRecipients(teamMembers = []) {
  const seen = new Set();
  return (teamMembers || []).reduce((acc, member) => {
    const email = String(member?.email || "").trim().toLowerCase();
    if (!email || !isValidEmailAddress(email) || seen.has(email)) return acc;
    seen.add(email);
    acc.push({
      name: member?.name || "",
      email,
    });
    return acc;
  }, []);
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const [reservations, teamMembers, equipment] = await Promise.all([
      getStoreData("reservations"),
      getStoreData("teamMembers"),
      getStoreData("equipment"),
    ]);

    if (!Array.isArray(reservations)) {
      return res.status(200).json({ ok: true, updated: false, studentSent: 0, teamSent: 0, overdueReservations: 0 });
    }

    const now = new Date();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const uniqueTeamRecipients = getUniqueTeamRecipients(teamMembers);
    const updatedReservations = [...reservations];
    let changed = false;
    let overdueReservations = 0;
    let studentSent = 0;
    let teamSent = 0;

    for (let index = 0; index < updatedReservations.length; index += 1) {
      const reservation = updatedReservations[index];
      if (!reservation) continue;

      const normalizedStatus = normalizeReservationStatus(reservation.status);
      if (normalizedStatus !== "מאושר" || normalizedStatus === "הוחזר") continue;
      if (reservation.returned_at) continue;

      const returnAt = toDateTime(reservation.return_date, reservation.return_time || "23:59");
      if (!returnAt || nowMs < returnAt + ONE_HOUR_MS) continue;

      overdueReservations += 1;

      let nextReservation = normalizedStatus === reservation.status
        ? { ...reservation }
        : { ...reservation, status: normalizedStatus };

      const itemsList = buildItemsRows(nextReservation.items, equipment);

      if (!nextReservation.overdue_student_notified_at && isValidEmailAddress(nextReservation.email)) {
        try {
          await sendTypedEmail({
            to: String(nextReservation.email).trim().toLowerCase(),
            type: "overdue_student",
            student_name: nextReservation.student_name || "",
            borrow_date: formatDate(nextReservation.borrow_date),
            borrow_time: nextReservation.borrow_time || "",
            return_date: formatDate(nextReservation.return_date),
            return_time: nextReservation.return_time || "",
            items_list: itemsList,
            loan_type: nextReservation.loan_type || "",
          });
          nextReservation = {
            ...nextReservation,
            overdue_student_notified_at: nowIso,
          };
          studentSent += 1;
          changed = true;
        } catch (error) {
          console.error("overdue student email failed", nextReservation.id, error);
        }
      }

      const notifiedTeamEmails = Array.isArray(nextReservation.overdue_team_notified_emails)
        ? nextReservation.overdue_team_notified_emails.map((email) => String(email || "").trim().toLowerCase()).filter(Boolean)
        : [];
      const pendingTeamRecipients = uniqueTeamRecipients.filter((recipient) => !notifiedTeamEmails.includes(recipient.email));

      if (pendingTeamRecipients.length > 0) {
        const sentTeamEmails = [...notifiedTeamEmails];
        for (const recipient of pendingTeamRecipients) {
          try {
            await sendTypedEmail({
              to: recipient.email,
              type: "overdue_team",
              recipient_name: recipient.name,
              student_name: nextReservation.student_name || "",
              borrow_date: formatDate(nextReservation.borrow_date),
              borrow_time: nextReservation.borrow_time || "",
              return_date: formatDate(nextReservation.return_date),
              return_time: nextReservation.return_time || "",
              items_list: itemsList,
              loan_type: nextReservation.loan_type || "",
            });
            sentTeamEmails.push(recipient.email);
            teamSent += 1;
            changed = true;
          } catch (error) {
            console.error("overdue team email failed", nextReservation.id, recipient.email, error);
          }
        }

        nextReservation = {
          ...nextReservation,
          overdue_team_notified_emails: [...new Set(sentTeamEmails)],
        };

        if (nextReservation.overdue_team_notified_emails.length >= uniqueTeamRecipients.length && uniqueTeamRecipients.length > 0) {
          nextReservation.overdue_team_notified_at = nextReservation.overdue_team_notified_at || nowIso;
        }
      }

      updatedReservations[index] = nextReservation;
    }

    if (changed) {
      await saveStoreData("reservations", updatedReservations);
    }

    return res.status(200).json({
      ok: true,
      updated: changed,
      overdueReservations,
      studentSent,
      teamSent,
    });
  } catch (error) {
    console.error("overdue-reminders error", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
