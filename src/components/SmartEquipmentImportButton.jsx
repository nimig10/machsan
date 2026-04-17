import { useRef, useState } from "react";
import { getAuthToken } from "../utils.js";

const loadXLSX = () => (
  new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    const existing = document.querySelector('script[data-xlsx-loader="smart-equipment-import"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.XLSX), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load XLSX library")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.dataset.xlsxLoader = "smart-equipment-import";
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error("Failed to load XLSX library"));
    document.head.appendChild(script);
  })
);

const fetchWithRetry = async (url, options, maxRetries = 5) => {
  const delays = [1000, 2000, 5000, 10000, 20000];
  for (let i = 0; i < maxRetries; i += 1) {
    const response = await fetch(url, options);
    if (response.status === 429 || response.status === 503 || response.status === 500) {
      const delay = delays[i] ?? delays[delays.length - 1];
      console.warn(`Equipment AI import error ${response.status}. Retrying in ${delay / 1000}s (attempt ${i + 1}/${maxRetries})...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
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

export default function SmartEquipmentImportButton({
  onImportSuccess,
  showToast,
  existingCategories = [],
}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingItems, setPendingItems] = useState(null);
  const [newCategoriesToApprove, setNewCategoriesToApprove] = useState([]);
  const fileInputRef = useRef(null);


  const notify = (type, msg) => {
    if (typeof showToast === "function") showToast(type, msg);
  };

  const resetPending = () => {
    setPendingItems(null);
    setNewCategoriesToApprove([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const processWithGemini = async (csvText, categories) => {
    const endpoint = '/api/gemini';
    const prompt = `
אני מעביר לך תוכן גולמי (CSV) מקובץ ייבוא של ציוד מחסן. הקובץ מכיל כנראה רק שמות פריטים וכמויות.

קטגוריות קיימות במערכת: [${(categories || []).join(", ")}]

המשימה:
1. חלץ את שם הפריט (name) והכמות שלו (total).
2. שיוך לקטגוריה (category): נסה לשייך את הפריט לאחת מהקטגוריות הקיימות שסיפקתי. אם אף קטגוריה קיימת לא מתאימה, צור קטגוריה חדשה והגיונית וסמן isNewCategory: true.
3. תיאור (desc): כתוב משפט אחד בעברית שמתאר את הפריט ואת השימוש שלו.
4. מפרט טכני (techSpecs): כתוב מפרט טכני בסיסי וקצר בעברית עבור הפריט.

הנתונים:
${csvText}
    `.trim();

    const token = await getAuthToken();
    const response = await fetchWithRetry(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: {
          parts: [{ text: "אתה עוזר למנהל מחסן ציוד. החזר אך ורק JSON חוקי של מערך, ללא טקסט נוסף או Markdown." }],
        },
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                total: { type: "INTEGER", description: "כמות הפריטים. אם לא צוין, שים 1." },
                category: { type: "STRING" },
                isNewCategory: { type: "BOOLEAN", description: "true אם הקטגוריה לא קיימת ברשימה שקיבלת" },
                desc: { type: "STRING", description: "תיאור קצר בעברית" },
                techSpecs: { type: "STRING", description: "מפרט טכני קצר בעברית" },
              },
              required: ["name", "total", "category", "isNewCategory", "desc", "techSpecs"],
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    const textResponse = result?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return parseGeneratedJson(textResponse);
  };

  const finalizeImport = async (itemsToImport, approvedCategories = []) => {
    const now = Date.now();
    const formattedItems = (Array.isArray(itemsToImport) ? itemsToImport : [])
      .map((item, index) => ({
        id: `ai_eq_${now}_${index}_${Math.random().toString(36).slice(2, 8)}`,
        name: String(item?.name || "").trim(),
        category: String(item?.category || "").trim(),
        total_quantity: Math.max(1, Number(item?.total) || 1),
        image: "📦",
        description: String(item?.desc || "").trim(),
        technical_details: String(item?.techSpecs || "").trim(),
        notes: "",
        status: "תקין",
        certification_id: "",
      }))
      .filter((item) => item.name && item.category);

    if (!formattedItems.length) {
      notify("warning", "לא נמצאו פריטי ציוד תקינים לייבוא.");
      resetPending();
      return;
    }

    await onImportSuccess?.(formattedItems, approvedCategories);
    notify("success", `יובאו ${formattedItems.length} פריטים בהצלחה יחד עם מפרט טכני!`);
    resetPending();
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    notify("success", "קורא את קובץ הציוד...");

    try {
      const XLSX = await loadXLSX();
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const csvData = XLSX.utils.sheet_to_csv(worksheet);
      if (!String(csvData || "").trim()) throw new Error("הקובץ ריק או לא תקין.");

      notify("success", "מנתח נתונים, כותב תיאורים ומפרטים טכניים...");
      const extractedItems = await processWithGemini(csvData, existingCategories);

      if (!Array.isArray(extractedItems) || !extractedItems.length) {
        notify("warning", "לא זוהה ציוד תקין בקובץ.");
        resetPending();
        return;
      }

      const newCategories = [...new Set(
        extractedItems
          .filter((item) => item?.isNewCategory && String(item?.category || "").trim())
          .map((item) => String(item.category).trim())
      )];

      if (newCategories.length) {
        setPendingItems(extractedItems);
        setNewCategoriesToApprove(newCategories);
      } else {
        await finalizeImport(extractedItems, []);
      }
    } catch (error) {
      console.error("Equipment AI import error:", error);
      notify("error", error?.message || "שגיאה בניתוח הקובץ. ודא שהקובץ תקין.");
      resetPending();
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current && !pendingItems) fileInputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        style={{ display: "none" }}
        ref={fileInputRef}
        onChange={handleFileUpload}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={isProcessing}
        className="btn btn-secondary"
        style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
      >
        <span aria-hidden="true">{isProcessing ? "⏳" : "⚡"}</span>
        {isProcessing ? "יוצר ציוד עם AI..." : "ייבוא ציוד חכם (AI)"}
      </button>

      {pendingItems && newCategoriesToApprove.length > 0 && (
        <div style={{ position: "fixed", inset: 0, zIndex: 5000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.72)", padding: 16 }}>
          <div style={{ width: "100%", maxWidth: 520, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, boxShadow: "0 24px 80px rgba(0,0,0,0.35)", padding: 24, direction: "rtl" }}>
            <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 8 }}>זיהינו קטגוריות חדשות</div>
            <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.8, marginBottom: 16 }}>
              הבינה המלאכותית לא מצאה קטגוריה קיימת מתאימה לכל הפריטים, והיא מציעה לפתוח את הקטגוריות הבאות:
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 14, marginBottom: 20 }}>
              {newCategoriesToApprove.map((category) => (
                <div key={category} style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: "var(--accent)" }}>
                  <span aria-hidden="true">✨</span>
                  <span>{category}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-secondary" onClick={resetPending}>בטל ייבוא</button>
              <button type="button" className="btn btn-primary" onClick={() => finalizeImport(pendingItems, newCategoriesToApprove)}>אשר והוסף ציוד</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
