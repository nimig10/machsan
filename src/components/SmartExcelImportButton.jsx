import { useRef, useState } from "react";
import * as XLSX from "xlsx";

const DEFAULT_GUIDANCE = `אני מעביר לך תוכן גולמי (CSV) שחולץ מקובץ אקסל של סטודנטים.
המשימה שלך:
1. חלץ את הסטודנטים: שם מלא (name), טלפון (phone), אימייל (email).
2. חפש מסלול לימודים — עשוי להופיע כ"מסלול", "תוכנית לימודים", "מחלקה", "קורס", "מגמה" — ושייך אותו (track) לכל הסטודנטים.
3. זיהוי חכם של שמות עמודות: "תלמיד"/"סטודנט"/"שם" = name, "דוא"ל"/"מייל"/"email"/"mail" = email, "נייד"/"סל"/"טל"/"phone" = phone.
4. IMPORTANT: חלץ את כתובת המייל בדיוק כפי שהיא מופיעה — כולל כתובות @example.com, @test.com, כתובות פיקטיביות, או כל כתובת אחרת. אל תסנן ואל תדלג על כתובות מייל.
5. התעלם משורות ריקות, כותרות לא רלוונטיות, מספרי סידורי ושורות סיכום.`;

const fetchWithRetry = async (url, options, maxRetries = 5) => {
  const delays = [2000, 5000, 10000, 20000, 32000];
  for (let i = 0; i < maxRetries; i += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, delays[i] ?? delays[delays.length - 1]));
        continue;
      }
      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        if (i < maxRetries - 1) continue;
        throw new Error("timeout — לא הגיב תוך 2 דקות");
      }
      throw err;
    }
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") throw new Error("timeout — לא הגיב תוך 2 דקות");
    throw err;
  }
};

const notify = (showToast, type, message) => {
  if (typeof showToast !== "function") return;
  try {
    showToast(type, message);
  } catch {
    showToast({ type, message });
  }
};

const parseGeneratedJson = (text = "") => {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return JSON.parse((fenced ? fenced[1] : raw).trim());
};

const normalizeImportedStudents = (students = []) => (
  (Array.isArray(students) ? students : [])
    .map((student) => {
      const name = String(student?.name || "").trim();
      const email = String(student?.email || "").trim().toLowerCase();
      const phone = String(student?.phone || "").trim();
      const track = String(student?.track || "").trim();
      return {
        name,
        email: email.includes("@") ? email : "",
        phone,
        track,
      };
    })
    .filter((student) => student.name)
);

export default function SmartExcelImportButton({ onImportSuccess, showToast }) {
  const fileInputRef = useRef(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showRetryModal, setShowRetryModal] = useState(false);
  const [failedCsvData, setFailedCsvData] = useState("");
  const [customGuidance, setCustomGuidance] = useState(DEFAULT_GUIDANCE);

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.REACT_APP_GEMINI_API_KEY || "";

  const processWithGemini = async (csvText, guidance) => {
    if (!apiKey) {
      throw new Error("מפתח Gemini API לא מוגדר.");
    }

    const prompt = `
הנחיות חילוץ נתונים מותאמות:
${guidance}

הנתונים הגולמיים (CSV):
${csvText}
    `.trim();

    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      systemInstruction: {
        parts: [{ text: "אתה מומחה לחילוץ נתונים. החזר אך ורק JSON של מערך אובייקטים לפי הסכמה, ללא טקסט נוסף או מסגרות Markdown." }],
      },
      generationConfig: {
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING" },
              phone: { type: "STRING" },
              email: { type: "STRING" },
              track: { type: "STRING" },
            },
            required: ["name", "email", "phone", "track"],
          },
        },
      },
    };

    let lastError = null;
    for (const modelName of ["gemini-2.5-flash", "gemini-2.5-flash-lite"]) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const response = await fetchWithRetry(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        const errorText = await response.text();
        lastError = new Error(`API Error ${response.status}: ${errorText}`);
        if (response.status === 404 || response.status === 429 || response.status === 503) continue;
        throw lastError;
      }
      const result = await response.json();
      if (!result?.candidates?.length) continue;
      const textResponse = result.candidates[0]?.content?.parts?.[0]?.text || "";
      return normalizeImportedStudents(parseGeneratedJson(textResponse));
    }
    throw lastError || new Error("כל המודלים נכשלו. נסה שוב.");
  };

  const handleFailure = (csv, reason) => {
    setFailedCsvData(String(csv || ""));
    setCustomGuidance(DEFAULT_GUIDANCE);
    setShowRetryModal(true);
    notify(showToast, "warning", `${reason} ניתן לכוון את ה-AI ולנסות שוב.`);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    let csvData = "";
    setIsProcessing(true);
    notify(showToast, "info", "קורא את הקובץ...");

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheetNames = workbook.SheetNames || [];
      if (!sheetNames.length) {
        throw new Error("לא נמצא גיליון תקין בקובץ.");
      }

      const sheets = [];
      for (const name of sheetNames) {
        const ws = workbook.Sheets[name];
        if (!ws) continue;
        const csv = XLSX.utils.sheet_to_csv(ws);
        const cleanLines = String(csv || "").split("\n").filter(line => line.replace(/,/g, "").trim());
        if (cleanLines.length) {
          sheets.push({ name, csv: cleanLines.join("\n") });
        }
      }
      if (!sheets.length) {
        throw new Error("לא נמצא תוכן לייבוא בקובץ.");
      }

      // For single sheet — send as-is; for multiple sheets — process each separately and merge
      let extractedStudents = [];
      if (sheets.length === 1) {
        csvData = sheets[0].csv;
        notify(showToast, "info", "מנתח נתונים עם AI...");
        extractedStudents = await processWithGemini(csvData, DEFAULT_GUIDANCE);
      } else {
        csvData = sheets.map(s => `--- גיליון: ${s.name} ---\n${s.csv}`).join("\n\n");
        notify(showToast, "info", `מנתח ${sheets.length} גיליונות עם AI...`);
        for (let i = 0; i < sheets.length; i += 1) {
          notify(showToast, "info", `מנתח גיליון ${i + 1}/${sheets.length}: "${sheets[i].name}"...`);
          try {
            const result = await processWithGemini(sheets[i].csv, DEFAULT_GUIDANCE);
            if (result?.length) extractedStudents.push(...result);
          } catch (err) {
            console.warn(`Sheet "${sheets[i].name}" failed:`, err);
          }
        }
      }

      if (extractedStudents?.length > 0) {
        const importResult = await onImportSuccess?.(extractedStudents);
        if (importResult !== false) {
          if (fileInputRef.current) fileInputRef.current.value = "";
        }
      } else {
        handleFailure(csvData, "לא זוהו סטודנטים בקובץ.");
      }
    } catch (error) {
      console.error("AI student import error:", error);
      if (csvData) {
        handleFailure(csvData, "הבינה המלאכותית התקשתה לפענח את הקובץ.");
      } else {
        notify(showToast, "error", error?.message || "שגיאה בקריאת הקובץ.");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRetryWithCustomPrompt = async () => {
    setShowRetryModal(false);
    setIsProcessing(true);
    notify(showToast, "info", "מנסה שוב עם ההנחיות החדשות...");

    try {
      const extractedStudents = await processWithGemini(failedCsvData, customGuidance);
      if (extractedStudents?.length > 0) {
        notify(showToast, "success", `הצלחנו! יובאו ${extractedStudents.length} סטודנטים.`);
        await onImportSuccess?.(extractedStudents);
        setFailedCsvData("");
      } else {
        notify(showToast, "error", "עדיין לא זוהו סטודנטים. נסה לבדוק את הקובץ ידנית.");
      }
    } catch (error) {
      console.error("AI student retry error:", error);
      notify(showToast, "error", error?.message || "שגיאה בניסיון החוזר. ודא שההנחיות ברורות.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        style={{ display: "none" }}
        onChange={handleFileUpload}
      />
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => fileInputRef.current?.click()}
        disabled={isProcessing}
      >
        {isProcessing ? "⏳ מנתח עם AI..." : "✨ ייבוא קובץ XL"}
      </button>

      {showRetryModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 5000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)", padding: 16 }}>
          <div style={{ width: "100%", maxWidth: 680, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, boxShadow: "0 20px 70px rgba(0,0,0,0.35)", direction: "rtl" }}>
            <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 24 }}>🤖</span>
              <div style={{ fontSize: 20, fontWeight: 900 }}>הייבוא לא צלח</div>
            </div>
            <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.7 }}>
                הבינה המלאכותית התקשתה לחלץ את הסטודנטים מהקובץ הזה.
                אפשר לחדד כאן את ההנחיות, למשל:
                "השמות נמצאים בעמודה 3" או "התעלם משלוש השורות הראשונות".
              </div>
              <textarea
                className="form-input"
                rows={8}
                value={customGuidance}
                onChange={(e) => setCustomGuidance(e.target.value)}
                placeholder="כתוב כאן הנחיות לבינה המלאכותית..."
                style={{ resize: "vertical", minHeight: 180 }}
              />
              <div style={{ display: "flex", justifyContent: "flex-start", gap: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowRetryModal(false)}>
                  ביטול
                </button>
                <button type="button" className="btn btn-primary" onClick={handleRetryWithCustomPrompt}>
                  נסה שוב עם ההנחיות
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
