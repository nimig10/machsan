// api/upload-image.js
// Accepts { data: "data:image/jpeg;base64,..." } JSON body.
// Uploads to Cloudinary via REST API (no SDK — no extra npm packages).
// Returns { ok: true, url: "https://res.cloudinary.com/..." }

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY    = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    return res.status(500).json({ error: "Missing Cloudinary env vars" });
  }

  const { data } = req.body;
  if (!data || !data.startsWith("data:image")) {
    return res.status(400).json({ error: "Invalid image payload" });
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const folder    = "machsan";

    // Cloudinary signed upload: signature = SHA1("folder=X&timestamp=Y" + API_SECRET)
    const { createHash } = await import("crypto");
    const signature = createHash("sha1")
      .update(`folder=${folder}&timestamp=${timestamp}${API_SECRET}`)
      .digest("hex");

    // Send as URL-encoded form (Cloudinary REST accepts base64 data URIs as "file")
    const form = new URLSearchParams({
      file:      data,
      timestamp: String(timestamp),
      api_key:   API_KEY,
      signature,
      folder,
    });

    const upRes = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
      { method: "POST", body: form }
    );
    const result = await upRes.json();

    if (!upRes.ok || result.error) {
      console.error("Cloudinary error:", result.error);
      return res.status(500).json({ error: result.error?.message || "Cloudinary upload failed" });
    }

    // Return the HTTPS URL — stored in equipment record instead of Base64
    return res.json({ ok: true, url: result.secure_url });
  } catch (err) {
    console.error("upload-image error:", err);
    return res.status(500).json({ error: err.message });
  }
}
