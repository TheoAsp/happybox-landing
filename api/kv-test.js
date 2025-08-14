export default async function handler(req, res) {
  const base = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!base || !token) {
    return res.status(500).json({ ok: false, error: 'KV envs missing' });
  }

  const email = String(req.query.email || 'test@example.com').toLowerCase();
  const key = `minted:${email}`;

  // 1) write (set) με TTL 1 ώρα (3600s)
  const setResp = await fetch(`${base}/set/${encodeURIComponent(key)}/1?ttlSeconds=3600`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  const setTxt = await setResp.text();

  // 2) read (get)
  const getResp = await fetch(`${base}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const getTxt = await getResp.text();

  return res.status(200).json({
    ok: true,
    wrote: { status: setResp.status, body: setTxt },
    read:  { status: getResp.status, body: getTxt }
  });
}
