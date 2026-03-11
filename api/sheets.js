const GS_URL = "https://script.google.com/macros/s/AKfycbzgolfwnz7pDzuXz-FNX23yDoU50WgufLB_a48ZPBHq10TipT3v6FfnLsab5hpxL0hjaw/exec";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "GET") {
      const { action } = req.query;
      const response = await fetch(`${GS_URL}?action=${action}`, { redirect: "follow" });
      const data = await response.json();
      return res.json(data);
    }

    if (req.method === "POST") {
      const response = await fetch(GS_URL, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      const data = await response.json();
      return res.json(data);
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Sheets proxy error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
