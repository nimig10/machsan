// LessonsPage.jsx — course & lesson schedule management
import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { storageSet, formatDate, formatLocalDateInput, parseLocalDate, today } from "../utils.js";

const AI_IMPORT_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];

function sortScheduleEntries(entries = []) {
  return [...entries].sort((a, b) => {
    const aDateTime = `${a?.date || ""} ${a?.startTime || "00:00"}`;
    const bDateTime = `${b?.date || ""} ${b?.startTime || "00:00"}`;
    return aDateTime.localeCompare(bDateTime, "he");
  });
}

function normalizeScheduleEntry(entry = {}) {
  return {
    date: entry?.date || "",
    startTime: entry?.startTime || "09:00",
    endTime: entry?.endTime || "12:00",
    topic: String(entry?.topic || "").trim(),
  };
}

function dedupeScheduleEntries(entries = []) {
  const seen = new Set();
  return sortScheduleEntries(entries).filter((entry) => {
    const normalized = normalizeScheduleEntry(entry);
    const key = `${normalized.date}__${normalized.startTime}__${normalized.endTime}__${normalized.topic}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeHebrewDay(dayOfWeek = "") {
  const cleaned = String(dayOfWeek || "").trim().replace(/^יום\s+/, "");
  const aliasMap = {
    ראשון: 0,
    א: 0,
    "א׳": 0,
    שני: 1,
    ב: 1,
    "ב׳": 1,
    שלישי: 2,
    ג: 2,
    "ג׳": 2,
    רביעי: 3,
    ד: 3,
    "ד׳": 3,
    חמישי: 4,
    ה: 4,
    "ה׳": 4,
    שישי: 5,
    ו: 5,
    "ו׳": 5,
    שבת: 6,
    ש: 6,
    "ש׳": 6,
  };
  return aliasMap[cleaned];
}

function getNextDateForHebrewDay(dayOfWeek = "") {
  const targetDay = normalizeHebrewDay(dayOfWeek);
  if (targetDay === undefined) return today();
  const now = new Date();
  const diff = (targetDay - now.getDay() + 7) % 7;
  const nextDate = new Date(now);
  nextDate.setDate(now.getDate() + diff);
  return formatLocalDateInput(nextDate);
}

function isValidImportedDate(dateStr = "") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return (
    date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
  );
}

function normalizeImportedLessonDate(dateValue = "", dayOfWeek = "") {
  const raw = String(dateValue || "").trim();
  if (!raw) return getNextDateForHebrewDay(dayOfWeek);

  if (isValidImportedDate(raw)) return raw;

  const localMatch = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (localMatch) {
    const [, day, month, yearRaw] = localMatch;
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    const normalized = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (isValidImportedDate(normalized)) return normalized;
  }

  return getNextDateForHebrewDay(dayOfWeek);
}

function normalizeImportedLessonTime(timeValue = "") {
  const raw = String(timeValue || "").trim();
  const match = raw.match(/(\d{1,2}):(\d{1,2})/);
  if (!match) return "00:00";
  const hours = Math.max(0, Math.min(23, Number(match[1]) || 0));
  const minutes = Math.max(0, Math.min(59, Number(match[2]) || 0));
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseGeneratedLessonsJson(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

export function LessonsPage({ lessons=[], setLessons, studios=[], kits=[], showToast, reservations=[], setReservations, equipment=[], trackOptions=[] }) {
  const [mode, setMode] = useState(null); // null | "add" | "edit"
  const [editTarget, setEditTarget] = useState(null);
  const [search, setSearch] = useState("");
  const [trackFilter, setTrackFilter] = useState("הכל");
  const [xlImporting, setXlImporting] = useState(false);
  const [aiImporting, setAiImporting] = useState(false);
  const importInputRef = useRef(null);
  const aiImportInputRef = useRef(null);

  const lessonKits = kits.filter(k=>k.kitType==="lesson");
  const getLinkedKit = (lesson) => {
    if(!lesson) return null;
    if(lesson.kitId !== null && lesson.kitId !== undefined && String(lesson.kitId).trim() !== "") {
      return lessonKits.find(k=>String(k.id)===String(lesson.kitId)) || null;
    }
    return lessonKits.find(k=>k.lessonId !== null && k.lessonId !== undefined && String(k.lessonId).trim() !== "" && String(k.lessonId)===String(lesson.id)) || null;
  };

  const save = async (lesson) => {
    const updated = editTarget
      ? lessons.map(l=>l.id===editTarget.id?lesson:l)
      : [...lessons, lesson];
    setLessons(updated);
    await storageSet("lessons", updated);
    showToast("success", `קורס "${lesson.name}" ${editTarget?"עודכן":"נוצר"}`);
    setMode(null);
    setEditTarget(null);
  };

  const del = async (id, name) => {
    if(!window.confirm(`למחוק את הקורס "${name}"?`)) return;
    const updated = lessons.filter(l=>l.id!==id);
    setLessons(updated);
    await storageSet("lessons", updated);
    showToast("success", `קורס "${name}" נמחק`);
  };

  const getLessonTrackLabel = (lesson) => String(lesson?.track || "").trim() || "ללא מסלול";
  const allTrackFilters = [
    "הכל",
    ...new Set([
      ...(trackOptions || []).map((option) => String(option || "").trim()).filter(Boolean),
      ...lessons.map((lesson) => String(lesson?.track || "").trim()).filter(Boolean),
      ...(lessons.some((lesson) => !String(lesson?.track || "").trim()) ? ["ללא מסלול"] : []),
    ]),
  ];
  const filtered = lessons.filter((lesson) => {
    const matchesSearch = !search || lesson.name?.includes(search) || lesson.instructorName?.includes(search);
    const trackLabel = getLessonTrackLabel(lesson);
    const matchesTrack = trackFilter === "הכל" || trackLabel === trackFilter;
    return matchesSearch && matchesTrack;
  });
  const groupedLessons = filtered.reduce((groups, lesson) => {
    const trackLabel = getLessonTrackLabel(lesson);
    if (!groups[trackLabel]) groups[trackLabel] = [];
    groups[trackLabel].push(lesson);
    return groups;
  }, {});

  const importLessonsXL = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    setXlImporting(true);
    try {
      const ensureXlsx = async () => {
        if (window.XLSX) return window.XLSX;
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
        return window.XLSX;
      };

      const readRows = async () => {
        if (/\.xlsx?$/i.test(file.name)) {
          const XLSX = await ensureXlsx();
          const buf = await file.arrayBuffer();
          const wb = XLSX.read(buf, { type:"array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          return XLSX.utils.sheet_to_json(ws, { header:1, defval:"" });
        }
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter(line => line.trim());
        const sep = lines[0]?.includes("\t") ? "\t" : ",";
        return lines.map(line => line.split(sep).map(cell => cell.trim().replace(/^"|"$/g, "")));
      };

      const rows = await readRows();
      if (!rows.length) {
        showToast("error", "קובץ ה־XL ריק");
        setXlImporting(false);
        return;
      }

      const headers = rows[0].map((header) => String(header || "").trim().replace(/[\uFEFF\u200B-\u200D\u00A0]/g, "").toLowerCase());
      const findHeader = (...patterns) => headers.findIndex((header) => patterns.some((pattern) => header.includes(pattern)));
      const courseIdx = findHeader("קורס", "course", "שם קורס");
      const dateIdx = findHeader("תאריך", "date");
      const startIdx = findHeader("התחלה", "start", "שעת התחלה");
      const endIdx = findHeader("סיום", "end", "שעת סיום");
      if (courseIdx === -1 || dateIdx === -1) {
        showToast("error", 'חסרות עמודות חובה: "קורס" ו-"תאריך"');
        setXlImporting(false);
        return;
      }

      const instructorIdx = findHeader("מרצה", "מורה", "lecturer", "teacher", "instructor");
      const phoneIdx = findHeader("טלפון", "phone", "נייד");
      const emailIdx = findHeader("מייל", "email", "mail");
      const trackIdx = findHeader("מסלול", "track", "קבוצה", "class");
      const studioIdx = findHeader("אולפן", "studio");
      const kitIdx = findHeader("ערכה", "kit");
      const topicIdx = findHeader("נושא", "topic", "subject");
      const notesIdx = findHeader("הערות", "description", "notes", "תיאור");

      const groups = new Map();
      const toIsoDate = (rawValue) => {
        let value = String(rawValue || "").trim();
        if (!value) return "";
        if (/^\d{5}$/.test(value)) {
          const date = new Date(Math.round((Number(value) - 25569) * 86400000));
          return formatLocalDateInput(date);
        }
        const parts = value.includes("/") ? value.split("/") : value.split("-");
        if (parts.length !== 3) return value;
        if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
        return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
      };

      for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        const courseName = String(row[courseIdx] || "").trim();
        const date = toIsoDate(row[dateIdx]);
        if (!courseName || !date) continue;
        if (!groups.has(courseName)) {
          groups.set(courseName, {
            name: courseName,
            instructorName: instructorIdx >= 0 ? String(row[instructorIdx] || "").trim() : "",
            instructorPhone: phoneIdx >= 0 ? String(row[phoneIdx] || "").trim() : "",
            instructorEmail: emailIdx >= 0 ? String(row[emailIdx] || "").trim() : "",
            track: trackIdx >= 0 ? String(row[trackIdx] || "").trim() : "",
            studioName: studioIdx >= 0 ? String(row[studioIdx] || "").trim() : "",
            kitName: kitIdx >= 0 ? String(row[kitIdx] || "").trim() : "",
            description: notesIdx >= 0 ? String(row[notesIdx] || "").trim() : "",
            schedule: [],
          });
        }
        const group = groups.get(courseName);
        if (!group.instructorName && instructorIdx >= 0) group.instructorName = String(row[instructorIdx] || "").trim();
        if (!group.instructorPhone && phoneIdx >= 0) group.instructorPhone = String(row[phoneIdx] || "").trim();
        if (!group.instructorEmail && emailIdx >= 0) group.instructorEmail = String(row[emailIdx] || "").trim();
        if (!group.track && trackIdx >= 0) group.track = String(row[trackIdx] || "").trim();
        if (!group.studioName && studioIdx >= 0) group.studioName = String(row[studioIdx] || "").trim();
        if (!group.kitName && kitIdx >= 0) group.kitName = String(row[kitIdx] || "").trim();
        if (!group.description && notesIdx >= 0) group.description = String(row[notesIdx] || "").trim();
        group.schedule.push(normalizeScheduleEntry({
          date,
          startTime: startIdx >= 0 ? String(row[startIdx] || "").trim() || "09:00" : "09:00",
          endTime: endIdx >= 0 ? String(row[endIdx] || "").trim() || "12:00" : "12:00",
          topic: topicIdx >= 0 ? String(row[topicIdx] || "").trim() : "",
        }));
      }

      if (groups.size === 0) {
        showToast("error", "לא נמצאו קורסים תקינים לייבוא");
        setXlImporting(false);
        return;
      }

      let addedCount = 0;
      let updatedCount = 0;
      const updatedLessons = [...lessons];
      groups.forEach((group) => {
        const studioId = studios.find((studio) => studio.name === group.studioName)?.id ?? null;
        const kitId = lessonKits.find((kit) => kit.name === group.kitName)?.id ?? null;
        const existingIndex = updatedLessons.findIndex((lesson) => lesson.name === group.name);
        const nextSchedule = dedupeScheduleEntries(group.schedule);
        if (existingIndex >= 0) {
          const existing = updatedLessons[existingIndex];
          updatedLessons[existingIndex] = {
            ...existing,
            track: group.track || existing.track || "",
            instructorName: group.instructorName || existing.instructorName || "",
            instructorPhone: group.instructorPhone || existing.instructorPhone || "",
            instructorEmail: group.instructorEmail || existing.instructorEmail || "",
            description: group.description || existing.description || "",
            studioId: studioId ?? existing.studioId ?? null,
            kitId: kitId ?? existing.kitId ?? null,
            schedule: dedupeScheduleEntries([...(existing.schedule || []), ...nextSchedule]),
          };
          updatedCount += 1;
          return;
        }
        updatedLessons.push({
          id: `lesson_${Date.now()}_${addedCount + updatedCount}`,
          name: group.name,
          track: group.track,
          instructorName: group.instructorName,
          instructorPhone: group.instructorPhone,
          instructorEmail: group.instructorEmail,
          description: group.description,
          studioId,
          kitId,
          schedule: nextSchedule,
          created_at: new Date().toISOString(),
        });
        addedCount += 1;
      });

      setLessons(updatedLessons);
      await storageSet("lessons", updatedLessons);
      showToast("success", `יובאו ${addedCount} קורסים ועודכנו ${updatedCount} קורסים`);
    } catch (error) {
      console.error("Lessons XL import failed", error);
      showToast("error", "שגיאה בייבוא קורסים מ־XL");
    } finally {
      setXlImporting(false);
    }
  };

  const importLessonsSmartAI = async (event) => {
    const input = event.target;
    const file = input?.files?.[0];
    if (!file) return;

    setAiImporting(true);

    try {
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const result = e?.target?.result;
          const data = new Uint8Array(result instanceof ArrayBuffer ? result : new ArrayBuffer(0));
          const workbook = XLSX.read(data, { type: "array" });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          if (!worksheet) throw new Error("לא נמצא גיליון ראשון בקובץ.");

          const csvData = XLSX.utils.sheet_to_csv(worksheet);
          if (!String(csvData || "").trim()) throw new Error("לא נמצא תוכן קריא בקובץ.");

          const apiKey = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.REACT_APP_GEMINI_API_KEY;
          if (!apiKey) {
            throw new Error("API Key is missing. Check your .env or Vercel settings.");
          }

          const systemInstruction = `
          אתה מנהל מערכת חכם במכללת קולנוע וסאונד. מטרתך לחלץ שיעורים מקובץ CSV מבולגן ולהחזירם כ-JSON.
          חוקים קריטיים:
          1. התעלם לחלוטין משורות של חופשות, חגים או שבתות (למשל: 'פורים', 'שבת', '9 באב', 'יום השואה'). אל תיצור עבורם שיעור!
          2. התעלם משורות של טקסט חופשי או הערות מנהלה.
          3. חלץ שעות לפורמט HH:MM.
          4. אם חסרה שעה - הגדר '00:00'.
          5. נסה להבין את מסלול הלימודים מהכותרות. אם לא ברור, כתוב 'כללי'.
          6. אם קיים תאריך מפורש בקובץ, החזר אותו בפורמט YYYY-MM-DD.
        `;

          const requestBody = {
            contents: [{ parts: [{ text: csvData }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    id: { type: "STRING" },
                    date: { type: "STRING" },
                    courseName: { type: "STRING" },
                    teacher: { type: "STRING" },
                    track: { type: "STRING" },
                    dayOfWeek: { type: "STRING" },
                    startTime: { type: "STRING" },
                    endTime: { type: "STRING" },
                  },
                  required: ["id", "date", "courseName", "teacher", "track", "dayOfWeek", "startTime", "endTime"],
                },
              },
            },
          };

          let jsonResponse = null;
          let lastError = null;

          for (const modelName of AI_IMPORT_MODELS) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
            const response = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
              const errText = await response.text();
              // נסה מודל הבא על שגיאות שרת נפוצות
              if ([400, 404, 429, 503].includes(response.status)) {
                console.error(`Lessons AI import failed on ${modelName} (${response.status})`, errText);
                lastError = new Error(
                  response.status === 429 || response.status === 503
                    ? "שירות ה-AI עמוס כרגע. נסה שוב בעוד כמה דקות."
                    : `שגיאה ${response.status} במודל ${modelName} — מנסה מודל אחר`
                );
                continue;
              }
              throw new Error(`שגיאת API (${response.status}): ${errText}`);
            }

            jsonResponse = await response.json();
            lastError = null;
            break;
          }

          if (lastError) throw new Error(`כל המודלים נכשלו. ${lastError.message}`);
          if (!jsonResponse?.candidates || jsonResponse.candidates.length === 0) {
            throw new Error("Gemini לא החזיר תוצאות. נסה שוב.");
          }

          const generatedText = jsonResponse.candidates[0]?.content?.parts?.[0]?.text;
          if (!generatedText) throw new Error("Gemini לא החזיר JSON.");

          const parsedLessons = parseGeneratedLessonsJson(generatedText);
          if (!Array.isArray(parsedLessons) || parsedLessons.length === 0) {
            throw new Error("לא נמצאו שיעורים בקובץ לפי הפענוח של Gemini.");
          }

          const blockedKeywords = ["פורים", "שבת", "9 באב", "יום השואה", "חופשה", "חג", "הערה", "מזכירות", "הודעה", "ביטול"];
          blockedKeywords.push("פגרה", "סגור", "בית הספר יהיה סגור");
          const cleanedLessons = parsedLessons.filter((item) => {
            const mergedText = [item?.courseName, item?.teacher, item?.track, item?.dayOfWeek, item?.date]
              .map((value) => String(value || ""))
              .join(" ");
            return !blockedKeywords.some((keyword) => mergedText.includes(keyword));
          });

          if (cleanedLessons.length === 0) {
            throw new Error("Gemini לא החזיר שיעורים תקינים אחרי סינון חגים והערות.");
          }

          const groupedLessons = new Map();
          cleanedLessons.forEach((item, index) => {
            const courseName = String(item?.courseName || "").trim();
            const teacher = String(item?.teacher || "").trim() || "לא צוין";
            const track = String(item?.track || "").trim() || "כללי";
            const dayOfWeek = String(item?.dayOfWeek || "").trim();
            const lessonDate = normalizeImportedLessonDate(item?.date, dayOfWeek);
            const startTime = normalizeImportedLessonTime(item?.startTime);
            const endTime = normalizeImportedLessonTime(item?.endTime);
            if (!courseName) return;

            const groupKey = `${courseName}__${teacher}__${track}`;
            if (!groupedLessons.has(groupKey)) {
              groupedLessons.set(groupKey, {
                id: `lesson_ai_${Date.now()}_${index}`,
                name: courseName,
                instructorName: teacher,
                instructorPhone: "",
                instructorEmail: "",
                track,
                description: "יובא באמצעות ייבוא אקסל חכם (AI)",
                studioId: null,
                kitId: null,
                created_at: new Date().toISOString(),
                schedule: [],
              });
            }

            groupedLessons.get(groupKey).schedule.push(normalizeScheduleEntry({
              date: lessonDate,
              startTime,
              endTime,
              topic: dayOfWeek ? `מערכת קבועה · יום ${dayOfWeek}` : "",
            }));
          });

          if (groupedLessons.size === 0) {
            throw new Error("לא נוצרו קורסים תקינים מהפענוח.");
          }

          let addedCount = 0;
          let updatedCount = 0;
          const updatedLessons = [...lessons];
          groupedLessons.forEach((group) => {
            const existingIndex = updatedLessons.findIndex((lesson) => (
              String(lesson?.name || "").trim() === group.name
              && String(lesson?.instructorName || "").trim() === group.instructorName
              && String(lesson?.track || "").trim() === group.track
            ));

            if (existingIndex >= 0) {
              const existing = updatedLessons[existingIndex];
              updatedLessons[existingIndex] = {
                ...existing,
                track: group.track || existing.track || "",
                schedule: dedupeScheduleEntries([...(existing.schedule || []), ...group.schedule]),
              };
              updatedCount += 1;
              return;
            }

            updatedLessons.push({
              ...group,
              schedule: dedupeScheduleEntries(group.schedule),
            });
            addedCount += 1;
          });

          setLessons(updatedLessons);
          await storageSet("lessons", updatedLessons);
          showToast("success", `פוענחו ${cleanedLessons.length} שיעורים. נוספו ${addedCount} קורסים ועודכנו ${updatedCount} קורסים.`);
        } catch (err) {
          console.error("Error processing Excel:", err);
          showToast("error", `שגיאה בייבוא: ${err?.message || "שגיאה לא ידועה"}`);
        } finally {
          setAiImporting(false);
          if (input) input.value = null;
        }
      };

      reader.onerror = () => {
        console.error("File upload error: failed to read file");
        showToast("error", "שגיאה בקריאת הקובץ.");
        setAiImporting(false);
        if (input) input.value = null;
      };

      reader.readAsArrayBuffer(file);
    } catch (error) {
      console.error("File upload error:", error);
      showToast("error", "שגיאה בהעלאת הקובץ.");
      setAiImporting(false);
      if (input) input.value = null;
    }
  };

  return (
    <div className="page">
      {mode ? (
        <LessonForm
          initial={editTarget}
          onSave={save}
          onCancel={()=>{setMode(null);setEditTarget(null);}}
          studios={studios}
          lessonKits={lessonKits}
          equipment={equipment}
          reservations={reservations}
          setReservations={setReservations}
          kits={kits}
          showToast={showToast}
          trackOptions={trackOptions}
        />
      ) : (
        <>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:16,flexWrap:"wrap"}}>
            <div className="search-bar" style={{flex:1,minWidth:180}}><span>🔍</span>
              <input placeholder="חיפוש קורס או מרצה..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <input ref={aiImportInputRef} type="file" accept=".csv,.xlsx,.xls" style={{display:"none"}} onChange={importLessonsSmartAI} disabled={aiImporting}/>
              <button className="btn btn-primary" style={{display:"inline-flex",alignItems:"center",gap:6}} onClick={()=>aiImportInputRef.current?.click()} disabled={aiImporting}>
                {aiImporting ? "מפענח את קובץ האקסל..." : "✨ ייבוא אקסל חכם (AI)"}
              </button>
              <input ref={importInputRef} type="file" accept=".csv,.tsv,.xlsx,.xls" style={{display:"none"}} onChange={importLessonsXL} disabled={xlImporting}/>
              <button className="btn btn-secondary" onClick={()=>importInputRef.current?.click()} disabled={xlImporting}>{xlImporting ? "מייבא..." : "ייבוא XL"}</button>
              <button className="btn btn-primary" onClick={()=>{setMode("add");setEditTarget(null);}}>➕ קורס חדש</button>
            </div>
          </div>

          {allTrackFilters.length > 1 && (
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
              {allTrackFilters.map((trackName) => {
                const active = trackFilter === trackName;
                return (
                  <button
                    key={trackName}
                    type="button"
                    onClick={() => setTrackFilter(trackName)}
                    style={{
                      padding:"5px 12px",
                      borderRadius:20,
                      border:`2px solid ${active ? "#f5a623" : "var(--border)"}`,
                      background:active ? "rgba(245,166,35,0.14)" : "transparent",
                      color:active ? "#f5a623" : "var(--text3)",
                      fontWeight:700,
                      fontSize:12,
                      cursor:"pointer",
                    }}
                  >
                    {trackName === "הכל" ? "כל המסלולים" : trackName}
                  </button>
                );
              })}
            </div>
          )}

          {filtered.length===0
            ? <div className="empty-state"><div className="emoji">📽️</div><div>{lessons.length===0 ? "אין קורסים עדיין" : "לא נמצאו קורסים למסלול שנבחר"}</div><div style={{fontSize:13,color:"var(--text3)"}}>{lessons.length===0 ? 'לחץ "➕ קורס חדש" כדי להתחיל' : "נסה לשנות חיפוש או מסלול לימודים"}</div></div>
            : <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {Object.entries(groupedLessons)
                  .sort(([left], [right]) => left.localeCompare(right, "he"))
                  .map(([trackName, trackLessons]) => (
                    <div key={trackName} style={{display:"flex",flexDirection:"column",gap:10,background:"rgba(245,166,35,0.04)",border:"1px solid rgba(245,166,35,0.18)",borderRadius:14,padding:"14px 16px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                        <span style={{fontWeight:900,fontSize:15,color:"#f5a623"}}>🎓 {trackName}</span>
                        <span style={{background:"rgba(245,166,35,0.16)",color:"#f5a623",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:800}}>{trackLessons.length} קורסים</span>
                      </div>
                      {trackLessons.map(l=>{
                        const studio = studios.find(s=>String(s.id)===String(l.studioId));
                        const kit = getLinkedKit(l);
                        const upcoming = (l.schedule||[]).filter(s=>s.date>=today()).length;
                        return (
                          <div key={l.id} style={{background:"var(--surface2)",borderRadius:10,padding:"14px 16px",border:"1px solid var(--border)",borderRight:"4px solid #9b59b6"}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,flexWrap:"wrap"}}>
                              <div style={{flex:1,minWidth:200}}>
                                <div style={{fontWeight:800,fontSize:16,marginBottom:4}}>{l.name}</div>
                                {l.instructorName && <div style={{fontSize:13,color:"var(--text2)"}}>👨‍🏫 {l.instructorName}{l.instructorPhone?` · ${l.instructorPhone}`:""}</div>}
                                {l.instructorEmail && <div style={{fontSize:12,color:"var(--text3)"}}>✉️ {l.instructorEmail}</div>}
                                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
                                  <span style={{background:"rgba(155,89,182,0.12)",color:"#9b59b6",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>📅 {(l.schedule||[]).length} שיעורים</span>
                                  {upcoming>0 && <span style={{background:"rgba(46,204,113,0.12)",color:"var(--green)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>🟢 {upcoming} קרובים</span>}
                                  <span style={{background:"rgba(245,166,35,0.12)",color:"var(--accent)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>🎓 {getLessonTrackLabel(l)}</span>
                                  {studio && <span style={{background:"rgba(52,152,219,0.12)",color:"var(--blue)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>🎙️ {studio.name}</span>}
                                  {kit && <span style={{background:"rgba(245,166,35,0.12)",color:"var(--accent)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>🎒 {kit.name}</span>}
                                </div>
                                {l.description && <div style={{fontSize:12,color:"var(--text3)",marginTop:6}}>📝 {l.description}</div>}
                              </div>
                              <div style={{display:"flex",gap:6}}>
                                <button className="btn btn-secondary btn-sm" onClick={()=>{setEditTarget(l);setMode("edit");}}>✏️ עריכה</button>
                                <button className="btn btn-secondary btn-sm" style={{color:"var(--red)",borderColor:"var(--red)"}} onClick={()=>del(l.id,l.name)}>🗑️ מחק</button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
              </div>
          }
        </>
      )}
    </div>
  );
}

// ── Lesson/Course Form ────────────────────────────────────────────────────────
function LessonForm({ initial, onSave, onCancel, studios, lessonKits, equipment, reservations, setReservations, kits, showToast, trackOptions=[] }) {
  const initialLinkedKitId = initial?.kitId || lessonKits.find(k=>k.lessonId !== null && k.lessonId !== undefined && String(k.lessonId).trim() !== "" && String(k.lessonId)===String(initial?.id||""))?.id || "";
  const [name, setName]                       = useState(initial?.name||"");
  const [track, setTrack]                     = useState(initial?.track||"");
  const [instructorName, setInstructorName]   = useState(initial?.instructorName||"");
  const [instructorPhone, setInstructorPhone] = useState(initial?.instructorPhone||"");
  const [instructorEmail, setInstructorEmail] = useState(initial?.instructorEmail||"");
  const [description, setDescription]         = useState(initial?.description||"");
  const [studioId, setStudioId]               = useState(initial?.studioId||"");
  const [kitId, setKitId]                     = useState(initialLinkedKitId);
  const [schedule, setSchedule]               = useState((initial?.schedule||[]).map(normalizeScheduleEntry));
  const [saving, setSaving]                   = useState(false);
  const [localMsg, setLocalMsg]               = useState(null);
  const [teacherMessage, setTeacherMessage]   = useState("");
  const [teacherEmailSending, setTeacherEmailSending] = useState(false);
  const normalizedTrackOptions = [...new Set((trackOptions || []).map(option => String(option || "").trim()).filter(Boolean))];

  // Manual schedule builder
  const [manStartDate, setManStartDate] = useState("");
  const [manStartTime, setManStartTime] = useState("10:00");
  const [manEndTime, setManEndTime]     = useState("13:00");
  const [manCount, setManCount]         = useState(1);

  const LESSON_TIMES = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30",
    "13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30",
    "17:00","17:30","18:00","18:30","19:00","19:30","20:00","20:30","21:00","21:30","22:00"];

  const buildAndAppendSchedule = () => {
    if(!manStartDate) { setLocalMsg({type:"error",text:"יש לבחור תאריך"}); return; }
    const count = Math.max(1, Math.min(52, Number(manCount)||1));
    const sessions = [];
    let d = parseLocalDate(manStartDate);
    for(let i=0;i<count;i++) {
      sessions.push({ date: formatLocalDateInput(d), startTime: manStartTime, endTime: manEndTime, topic: "" });
      d.setDate(d.getDate()+7);
    }
    setSchedule(prev => dedupeScheduleEntries([...prev, ...sessions]));
    setLocalMsg({type:"success",text:`נוספו ${sessions.length} שיעורים`});
  };

  const appendLessonFromExisting = () => {
    if(!schedule.length) return;
    const firstLesson = schedule[0];
    const lastLesson = schedule[schedule.length-1];
    const nextDateObj = parseLocalDate(lastLesson.date || today());
    nextDateObj.setDate(nextDateObj.getDate()+7);
    setSchedule(prev=>dedupeScheduleEntries([...prev, {
      date: formatLocalDateInput(nextDateObj),
      startTime: firstLesson.startTime||"09:00",
      endTime: firstLesson.endTime||"12:00",
      topic: "",
    }]));
  };

  const updateSessionField = (index, field, value) => {
    setSchedule(prev => prev.map((session, sessionIndex) => (
      sessionIndex === index
        ? { ...session, [field]: field === "topic" ? value : value || (field === "date" ? "" : session[field]) }
        : session
    )));
  };

  const sendTeacherEmail = async () => {
    const recipient = String(instructorEmail||"").trim();
    if(!recipient) { setLocalMsg({type:"error",text:"יש להזין מייל למרצה"}); return; }
    const message = String(teacherMessage||"").trim();
    if(!message) { setLocalMsg({type:"error",text:"יש למלא נוסח הודעה"}); return; }
    setTeacherEmailSending(true);
    try {
      const scheduleList = (schedule||[]).map((s,i)=>
        `<div style="margin-bottom:6px;color:#c7cedf">שיעור ${i+1}: ${formatDate(s.date)} ${s.startTime||""}${s.endTime?`–${s.endTime}`:""}${s.topic?` · ${s.topic}`:""}</div>`
      ).join("");
      await fetch("/api/send-email", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          to: recipient,
          type: "lesson_kit_ready",
          student_name: instructorName.trim()||name.trim()||"מורה",
          recipient_name: instructorName.trim()||name.trim()||"",
          lesson_kit_name: name.trim(),
          custom_message: message,
          items_list: "",
          lesson_schedule: scheduleList,
        }),
      });
      setLocalMsg({type:"success",text:`המייל נשלח אל ${recipient}`});
    } catch(err) {
      console.error("email error",err);
      setLocalMsg({type:"error",text:"שגיאה בשליחת המייל"});
    } finally {
      setTeacherEmailSending(false);
    }
  };

  const handleSave = async () => {
    if(!name.trim()) { setLocalMsg({type:"error",text:"חובה למלא שם קורס"}); return; }
    let finalSchedule = [...schedule];
    if(manStartDate && finalSchedule.length===0) {
      const count = Math.max(1,Math.min(52,Number(manCount)||1));
      let d = parseLocalDate(manStartDate);
      for(let i=0;i<count;i++) {
        finalSchedule.push({date:formatLocalDateInput(d),startTime:manStartTime,endTime:manEndTime,topic:""});
        d.setDate(d.getDate()+7);
      }
    }
    finalSchedule = dedupeScheduleEntries(finalSchedule.map(normalizeScheduleEntry));
    const invalidSession = finalSchedule.find(session => !session.date || session.startTime >= session.endTime);
    if(invalidSession) { setLocalMsg({type:"error",text:"יש לתקן תאריך או שעות לא תקינים בלוח השיעורים"}); return; }
    setSaving(true);
    const lesson = {
      id: initial?.id||`lesson_${Date.now()}`,
      name: name.trim(),
      track: track.trim(),
      instructorName: instructorName.trim(),
      instructorPhone: instructorPhone.trim(),
      instructorEmail: instructorEmail.trim(),
      description: description.trim(),
      studioId: studioId||null,
      kitId: kitId||null,
      schedule: finalSchedule,
      created_at: initial?.created_at||new Date().toISOString(),
    };
    await onSave(lesson);
    setSaving(false);
  };

  return (
    <div className="card" style={{marginBottom:20}}>
      <div className="card-header">
        <div className="card-title">📽️ {initial?"עריכת קורס":"קורס חדש"}</div>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>✕ ביטול</button>
      </div>

      {localMsg && (
        <div style={{padding:"10px 16px",marginBottom:12,borderRadius:"var(--r-sm)",fontSize:13,fontWeight:700,
          background:localMsg.type==="error"?"rgba(231,76,60,0.12)":"rgba(46,204,113,0.12)",
          border:`1px solid ${localMsg.type==="error"?"rgba(231,76,60,0.3)":"rgba(46,204,113,0.3)"}`,
          color:localMsg.type==="error"?"#e74c3c":"#2ecc71",
          display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>{localMsg.type==="error"?"❌":"✅"} {localMsg.text}</span>
          <button onClick={()=>setLocalMsg(null)} style={{background:"none",border:"none",color:"inherit",cursor:"pointer",fontSize:16,padding:"0 4px"}}>×</button>
        </div>
      )}

      {/* Course & Instructor details */}
      <div style={{background:"rgba(155,89,182,0.06)",border:"1px solid rgba(155,89,182,0.2)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16}}>
        <div style={{fontWeight:800,fontSize:13,color:"#9b59b6",marginBottom:12}}>👨‍🏫 פרטי הקורס והמרצה</div>
        <div className="form-group" style={{marginBottom:10}}>
          <label className="form-label">שם הקורס *</label>
          <input className="form-input" placeholder='לדוגמה: "אולפן טלוויזיה א"' value={name} onChange={e=>setName(e.target.value)}/>
        </div>
        <div className="grid-2" style={{marginBottom:10}}>
          <div className="form-group"><label className="form-label">שם המרצה</label>
            <input className="form-input" placeholder='ד"ר ישראל ישראלי' value={instructorName} onChange={e=>setInstructorName(e.target.value)}/></div>
          <div className="form-group"><label className="form-label">טלפון מרצה</label>
            <input className="form-input" placeholder="05x-xxxxxxx" value={instructorPhone} onChange={e=>setInstructorPhone(e.target.value)}/></div>
        </div>
        <div className="grid-2" style={{marginBottom:10}}>
          <div className="form-group">
            <label className="form-label">מייל מרצה</label>
            <input className="form-input" type="email" placeholder="lecturer@college.ac.il" value={instructorEmail} onChange={e=>setInstructorEmail(e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="form-label">מסלול לימודים</label>
            <datalist id="lesson-track-options">
              {normalizedTrackOptions.map(option => <option key={option} value={option}/>)}
            </datalist>
            <input className="form-input" list="lesson-track-options" placeholder='למשל: "הנדסאי קולנוע ב"' value={track} onChange={e=>setTrack(e.target.value)}/>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">הערות</label>
          <textarea className="form-textarea" rows={2} placeholder="הערות על הקורס..." value={description} onChange={e=>setDescription(e.target.value)}/>
        </div>
      </div>

      {/* Link to studio (optional) */}
      <div style={{background:"rgba(52,152,219,0.06)",border:"1px solid rgba(52,152,219,0.2)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16}}>
        <div style={{fontWeight:800,fontSize:13,color:"#3498db",marginBottom:10}}>🔗 שיוך (אופציונלי)</div>
        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">🎙️ שיוך לאולפן</label>
            <select className="form-select" value={studioId} onChange={e=>setStudioId(e.target.value)}>
              <option value="">ללא שיוך</option>
              {studios.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">🎒 שיוך לערכת שיעור</label>
            <select className="form-select" value={kitId} onChange={e=>setKitId(e.target.value)}>
              <option value="">ללא שיוך</option>
              {lessonKits.map(k=><option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Schedule builder */}
      <div style={{background:"rgba(155,89,182,0.06)",border:"1px solid rgba(155,89,182,0.2)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16}}>
        <div style={{fontWeight:800,fontSize:13,color:"#9b59b6",marginBottom:12}}>📅 לוח שיעורים</div>
        <div style={{fontSize:12,color:"var(--text3)",marginBottom:10}}>הוספת מפגשים ידנית נשארת כאן. ייבוא XL עבר לראש דף "שיעורים" כדי לאפשר העלאה מהירה של כמה קורסים במקביל.</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end",marginBottom:12}}>
          <div className="form-group" style={{flex:"1 1 130px",minWidth:120}}>
            <label className="form-label">תאריך התחלה</label>
            <input className="form-input" type="date" value={manStartDate} onChange={e=>setManStartDate(e.target.value)}/>
          </div>
          <div className="form-group" style={{flex:"0 0 90px"}}>
            <label className="form-label">שעת התחלה</label>
            <select className="form-select" value={manStartTime} onChange={e=>setManStartTime(e.target.value)}>
              {LESSON_TIMES.map(t=><option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group" style={{flex:"0 0 90px"}}>
            <label className="form-label">שעת סיום</label>
            <select className="form-select" value={manEndTime} onChange={e=>setManEndTime(e.target.value)}>
              {LESSON_TIMES.map(t=><option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group" style={{flex:"0 0 80px"}}>
            <label className="form-label">מס׳ שבועות</label>
            <input className="form-input" type="number" min={1} max={52} value={manCount} onChange={e=>setManCount(e.target.value)}/>
          </div>
          <button className="btn btn-primary" style={{background:"#9b59b6",borderColor:"#9b59b6",whiteSpace:"nowrap"}} onClick={buildAndAppendSchedule}>➕ הוסף</button>
        </div>

        {schedule.length>0 && (
          <div style={{marginBottom:16}}>
            <div style={{fontWeight:700,fontSize:12,color:"#9b59b6",marginBottom:6}}>📅 {schedule.length} שיעורים בלוח:</div>
            <div style={{maxHeight:260,overflow:"auto",display:"flex",flexDirection:"column",gap:4}}>
              {schedule.map((s,i)=>(
                <div key={`${s.date}-${s.startTime}-${i}`} style={{display:"grid",gridTemplateColumns:"minmax(34px,40px) minmax(130px,1.1fr) minmax(90px,0.6fr) minmax(90px,0.6fr) minmax(180px,1.5fr) auto",alignItems:"end",gap:8,fontSize:12,padding:"10px 12px",background:"var(--surface2)",borderRadius:8,border:"1px solid rgba(155,89,182,0.14)"}}>
                  <div style={{fontWeight:800,color:"#9b59b6",paddingBottom:10}}>#{i+1}</div>
                  <div className="form-group" style={{margin:0}}>
                    <label className="form-label">תאריך</label>
                    <input className="form-input" type="date" value={s.date} onChange={e=>updateSessionField(i, "date", e.target.value)}/>
                  </div>
                  <div className="form-group" style={{margin:0}}>
                    <label className="form-label">התחלה</label>
                    <select className="form-select" value={s.startTime} onChange={e=>updateSessionField(i, "startTime", e.target.value)}>
                      {LESSON_TIMES.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="form-group" style={{margin:0}}>
                    <label className="form-label">סיום</label>
                    <select className="form-select" value={s.endTime} onChange={e=>updateSessionField(i, "endTime", e.target.value)}>
                      {LESSON_TIMES.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="form-group" style={{margin:0}}>
                    <label className="form-label">נושא השיעור</label>
                    <input className="form-input" placeholder="אופציונלי" value={s.topic||""} onChange={e=>updateSessionField(i, "topic", e.target.value)}/>
                  </div>
                  <button onClick={()=>setSchedule(prev=>prev.filter((_,j)=>j!==i))}
                    style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:18,padding:"0 4px",alignSelf:"center"}} title="מחק מפגש">×</button>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:6,marginTop:8}}>
              <button className="btn btn-secondary btn-sm" onClick={appendLessonFromExisting}>➕ שיעור נוסף</button>
              <button className="btn btn-secondary btn-sm" style={{color:"var(--red)",borderColor:"var(--red)"}} onClick={()=>{
                if(window.confirm("לנקות את כל לוח השיעורים?")) {
                  setSchedule([]);
                }
              }}>🗑️ נקה הכל</button>
            </div>
          </div>
        )}
      </div>

      {/* Email to teacher */}
      {instructorEmail && (
        <div style={{background:"rgba(52,152,219,0.06)",border:"1px solid rgba(52,152,219,0.2)",borderRadius:"var(--r-sm)",padding:"14px 16px",marginBottom:16}}>
          <div style={{fontWeight:800,fontSize:13,color:"#3498db",marginBottom:10}}>✉️ שליחת מייל למרצה</div>
          <textarea className="form-textarea" rows={3} placeholder="נוסח ההודעה למרצה..." value={teacherMessage} onChange={e=>setTeacherMessage(e.target.value)}/>
          <button className="btn btn-secondary" style={{marginTop:8}} onClick={sendTeacherEmail} disabled={teacherEmailSending}>
            {teacherEmailSending?"⏳ שולח...":"📧 שלח מייל למרצה"}
          </button>
        </div>
      )}

      {/* Save */}
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <button className="btn btn-secondary" onClick={onCancel}>ביטול</button>
        <button className="btn btn-primary" style={{background:"#9b59b6",borderColor:"#9b59b6"}} onClick={handleSave} disabled={saving}>
          {saving?"⏳ שומר...":`💾 ${initial?"עדכן":"צור"} קורס`}
        </button>
      </div>
    </div>
  );
}
