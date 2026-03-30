export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY not configured on server" });
  }

  const { contents, systemInstruction, generationConfig } = req.body || {};
  if (!contents) {
    return res.status(400).json({ error: "Missing required field: contents" });
  }

  const requestBody = { contents };
  if (systemInstruction) requestBody.systemInstruction = systemInstruction;
  if (generationConfig) {
    // Strip thinkingConfig — not supported in gemini-1.5-flash
    const { thinkingConfig, ...restConfig } = generationConfig;
    if (Object.keys(restConfig).length > 0) requestBody.generationConfig = restConfig;
  }

  const model = "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;

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
