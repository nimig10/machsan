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

  const models = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-preview-04-17",
    "gemini-2.0-flash-001",
    "gemini-2.0-flash-exp",
  ];

  let lastStatus = 500;
  let lastData = { error: "All models failed" };

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      const referer = req.headers?.origin || req.headers?.referer || "https://app.camera.org.il";
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Referer": referer,
          "Origin": referer,
          "X-Referer": referer,
        },
        body: JSON.stringify(requestBody),
      });
      const data = await response.json();
      if (response.status === 404 || response.status === 429) {
        lastStatus = response.status;
        lastData = data;
        continue;
      }
      return res.status(response.status).json(data);
    } catch (error) {
      lastData = { error: error.message || "Internal server error" };
      continue;
    }
  }

  return res.status(lastStatus).json(lastData);
}
