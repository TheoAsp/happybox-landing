// /pages/api/mint.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, tier, stage } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Missing email' });
    }

    // Environment variables (βεβαιώσου ότι είναι σωστά στο Vercel)
    const CROSSMINT_API_KEY = process.env.CROSSMINT_API_KEY;
    const CROSSMINT_COLLECTION_ID = process.env.CROSSMINT_COLLECTION_ID;

    if (!CROSSMINT_API_KEY || !CROSSMINT_COLLECTION_ID) {
      return res.status(500).json({ error: 'Missing Crossmint config' });
    }

    // Κλήση στο Crossmint API
    const response = await fetch(
      `https://www.crossmint.com/api/2022-06-09/collections/${CROSSMINT_COLLECTION_ID}/nfts`,
      {
        method: 'POST',
        headers: {
          'x-client-secret': CROSSMINT_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: `email:${email}`,
          metadata: {
            name: 'Happy Box — Kalavryta Edition',
            image: 'https://myhappybox.gr/public/photos/cover.jpg',
            description: `Tier: ${tier || 'N/A'} • Stage: ${stage || 'N/A'}`,
            attributes: [
              { trait_type: 'Tier', value: tier || 'N/A' },
              { trait_type: 'Stage', value: String(stage) || 'N/A' },
            ],
          },
        }),
      }
    );

    const text = await response.text();

    if (!response.ok) {
      console.error('Crossmint error:', response.status, text);
      return res.status(response.status).json({
        error: 'Crossmint mint failed',
        details: text,
      });
    }

    // Αν όλα πάνε καλά
    return res.status(200).json({ success: true, details: JSON.parse(text) });
  } catch (err) {
    console.error('Mint API error:', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
}
