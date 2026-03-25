import { useRef, useState } from "react";
import * as XLSX from "xlsx";

const fetchWithRetry = async (url, options, maxRetries = 5) => {
  const delays = [2000, 5000, 10000, 20000, 32000];
  for (let i = 0; i < maxRetries; i += 1) {
    const response = await fetch(url, options);
    if (response.status === 429) {
      console.warn(`AI student import hit rate limit. Retrying in ${(delays[i] ?? delays[delays.length - 1]) / 1000} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, delays[i] ?? delays[delays.length - 1]));
      continue;
    }
    return response;
  }
  return fetch(url, options);
};

const parseGeneratedJson = (text = "") => {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned);
};

const normalizeImportedStudents = (students = []) => (
  (Array.isArray(students) ? students : [])
    .map((student) => ({
      name: String(student?.name || "").trim(),
      email: String(student?.email || "").trim().toLowerCase(),
      phone: String(student?.phone || "").trim(),
      track: String(student?.track || "").trim(),
    }))
    .filter((student) => student.email && student.email.includes("@"))
);

export default function SmartExcelImportButton({ showToast, onImportSuccess }) {
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheetName = workbook.SheetNames?.[0];
      if (!firstSheetName) {
        throw new Error("לא נמצא גיליון בקובץ.");
      }

      const worksheet = workbook.Sheets[firstSheetName];
      const csvData = XLSX.utils.sheet_to_csv(worksheet);
      if (!String(csvData || "").trim()) {
        throw new Error("הקובץ ריק או שלא ניתן לפענח את הגיליון הראשון.");
      }

      const apiKey = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.REACT_APP_GEMINI_API_KEY || "";
      if (!apiKey) {
        throw new Error("מפתח Gemini API לא מוגדר.");
      }

      const systemInstruction = `
אתה עוזר חכם לניהול סטודנטים במכללה.
תקבל טקסט CSV שחולץ מקובץ אקסל או CSV מבולגן.
המטרה שלך היא לזהות אך ורק שורות של סטודנטים אמיתיים ולהחזיר JSON תקני.

חוקים:
1. חלץ רק סטודנטים, והתעלם משורות כותרת, סיכומים, הערות, שורות ריקות ותאי עזר.
2. עבור כל סטודנט החזר: name, email, phone, track.
3. אם אין טלפון או מסלול, החזר מחרוזת ריקה.
4. החזר רק כתובות אימייל תקינות שנראות כמו אימייל אמיתי.
5. אם שם הסטודנט חסר אבל יש אימייל, אפשר להשתמש בחלק שלפני ה-@ כשם זמני.
6. החזר אך ורק JSON במבנה של מערך אובייקטים.
      `.trim();

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
                name: { type: "STRING" },
                email: { type: "STRING" },
                phone: { type: "STRING" },
                track: { type: "STRING" },
              },
              required: ["name", "email", "phone", "track"],
            },
          },
        },
      };

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`;
      const response = await fetchWithRetry(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
      }

      const jsonResponse = await response.json();
      const generatedText = jsonResponse?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const parsedStudents = normalizeImportedStudents(parseGeneratedJson(generatedText));

      if (!parsedStudents.length) {
        throw new Error("לא זוהו סטודנטים תקינים בקובץ.");
      }

      if (typeof onImportSuccess === "function") {
        await onImportSuccess(parsedStudents);
      } else if (typeof showToast === "function") {
        showToast("success", `יובאו ${parsedStudents.length} סטודנטים.`);
      }
    } catch (error) {
      console.error("SmartExcelImportButton error:", error);
      if (typeof showToast === "function") {
        showToast("error", error?.message || "שגיאה בייבוא החכם של הקובץ.");
      }
    } finally {
      setLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.tsv,.txt,.xls,.xlsx"
        style={{ display: "none" }}
        onChange={handleFileChange}
        disabled={loading}
      />
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => fileInputRef.current?.click()}
        disabled={loading}
      >
        {loading ? "⏳ מייבא חכם..." : "✨ ייבוא חכם (AI)"}
      </button>
    </>
  );
}
