// api/kv-test.js
// Γρήγορο τεστ Upstash KV (SET χωρίς TTL + GET)

const KV_BASE  = process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";

function j(res, code, data){ res.status(code).json(data); }

module.exports = async (req, res) => {
  try {
    const email = String(req.query.email || "debug@test.com").toLowerCase();
    const key = `minted:${email}`;

    // SET key=1 (χωρίς TTL)
    const wroteRes = await fetch(`${KV_BASE}/set/${encodeURIComponent(key)}/1`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const wroteTxt = await wroteRes.text();

    // GET key
    const readRes = await fetch(`${KV_BASE}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const readTxt = await readRes.text();

    return j(res, 200, {
      ok: true,
      wrote: { status: wroteRes.status, body: wroteTxt },
      read:  { status: readRes.status,  body: readTxt }
    });
  } catch (e) {
    return j(res, 500, { ok:false, error: String(e.message || e) });
  }
};
