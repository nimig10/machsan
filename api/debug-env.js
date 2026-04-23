// Temporary: echo SUPABASE_URL + service-role ref so we can see what Vercel injects.
export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL || null;
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY || null;
  let ref = null;
  try {
    if (srk) {
      const payload = JSON.parse(Buffer.from(srk.split(".")[1], "base64").toString());
      ref = payload.ref;
    }
  } catch {}
  let probe = null;
  try {
    const r = await fetch(`${url}/rest/v1/store?select=key&limit=1`, {
      headers: { apikey: srk, Authorization: `Bearer ${srk}` },
    });
    probe = { status: r.status, body: await r.text() };
  } catch (e) { probe = { error: e.message }; }
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ url, serviceKeyRef: ref, probe });
}
