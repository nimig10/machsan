// api/upload-cert-template.js
// Accepts { data: "data:application/...base64,..." , filename } JSON body.
// Uploads .docx to Cloudinary as raw resource. Returns { ok, url, filename }.

import { requireStaff } from "./_auth-helper.js";

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY    = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  const staff = await requireStaff(req, res);
  if (!staff) return;

  if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    return res.status(500).json({ error: "Missing Cloudinary env vars" });
  }

  const { data, filename } = req.body || {};
  if (!data || typeof data !== "string" || !data.startsWith("data:")) {
    return res.status(400).json({ error: "Invalid file payload" });
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const folder    = "machsan/cert-templates";

    const { createHash } = await import("crypto");
    const signature = createHash("sha1")
      .update(`folder=${folder}&timestamp=${timestamp}${API_SECRET}`)
      .digest("hex");

    const form = new URLSearchParams({
      file:      data,
      timestamp: String(timestamp),
      api_key:   API_KEY,
      signature,
      folder,
    });

    const upRes = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/raw/upload`,
      { method: "POST", body: form }
    );
    const result = await upRes.json();

    if (!upRes.ok || result.error) {
      console.error("Cloudinary error:", result.error);
      return res.status(500).json({ error: result.error?.message || "Cloudinary upload failed" });
    }

    return res.json({
      ok: true,
      url: result.secure_url,
      filename: filename || "template.docx",
    });
  } catch (err) {
    console.error("upload-cert-template error:", err);
    return res.status(500).json({ error: err.message });
  }
}
