// /api/mint.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});

  try {
    const { email, tier, stage } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    const API_KEY = process.env.CROSSMINT_API_KEY;
    const COLLECTION_ID = process.env.CROSSMINT_COLLECTION_ID; // π.χ. "default-polygon"
    if (!API_KEY || !COLLECTION_ID) {
      return res.status(500).json({ error: 'Missing env vars' });
    }

    // εδώ 1 κάρτα (ή βάλε 2 αν θες bundle)
    const body = {
      recipient: `email:${email}`,
      metadata: {
        name: `Happy Box — ${tier || 'Common'}`,
        description: `Stage ${stage} — myHappyBox`,
      }
    };

    const r = await fetch(`https://www.crossmint.com/api/2022-06-09/collections/${COLLECTION_ID}/nfts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-secret': API_KEY   // ή 'x-api-key': API_KEY, ανάλογα με το key σου
      },
      body: JSON.stringify(body)
    });

    const text = await r.text();
    if (!r.ok) {
      // Στείλε πίσω ό,τι είπε το Crossmint για να το δούμε στο UI/Logs
      return res.status(r.status).send(text || 'Mint failed');
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
