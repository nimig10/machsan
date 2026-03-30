export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY not configured on server" });
  }

  const { contents, systemInstruction, generationConfig } = req.body || {};
  if (!Array.isArray(contents) || contents.length === 0) {
    return res.status(400).json({ error: "Missing required field: contents" });
  }

  // Inject system instruction as first turn in contents — most compatible with all API versions
  const fullContents = [];
  if (systemInstruction) {
    const instructionText =
      systemInstruction?.parts?.[0]?.text ||
      (typeof systemInstruction === "string" ? systemInstruction : "");
    if (instructionText) {
      fullContents.push(
        { role: "user", parts: [{ text: `[הנחיות מערכת]\n${instructionText}` }] },
        { role: "model", parts: [{ text: "מובן. אפעל בהתאם." }] }
      );
    }
  }
  fullContents.push(...contents);

  const requestBody = { contents: fullContents };
  if (generationConfig) {
    const { thinkingConfig, ...restConfig } = generationConfig;
    if (Object.keys(restConfig).length > 0) requestBody.generationConfig = restConfig;
  }

  const model = "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
}
