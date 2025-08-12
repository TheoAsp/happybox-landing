// /api/mint.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, tier } = JSON.parse(req.body || '{}');
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return res.status(400).json({ error: 'Invalid email' });

    // Επιλογή εικόνας με βάση tier (απλό demo — προσαρμόζεις όπως θέλεις)
    const pick = pickImageForTier(tier); // π.χ. { name, imageUrl, attributes }

    const COLLECTION_ID = process.env.CROSSMINT_COLLECTION_ID; // π.χ. "default-polygon"
    const API_KEY = process.env.CROSSMINT_API_KEY;

    // Mint to email (Crossmint: recipient = `email:xxxx@yyy.com:polygon`)
    const resp = await fetch(
      `https://www.crossmint.com/api/2022-06-09/collections/${COLLECTION_ID}/nfts`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-secret': API_KEY,       // Crossmint server key
        },
        body: JSON.stringify({
          // Μπορείς και metadataUri, εδώ στέλνουμε inline metadata
          metadata: {
            name: pick.name,
            image: pick.imageUrl, // absolute URL
            description: 'my Happy Box — Kalavryta Edition',
            attributes: pick.attributes,    // [{trait_type, value}, ...]
          },
          recipient: `email:${email}:polygon`,
          reuploadLinkedFiles: true, // να ανεβάσει το image στη Crossmint/IPFS
        }),
      }
    );

    const data = await resp.json();
    if (!resp.ok) {
      console.error('Crossmint error:', data);
      return res.status(500).json({ error: 'Mint failed', details: data });
    }

    return res.status(200).json({ ok: true, crossmint: data });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}

// -------- Helpers --------

// Δώσε absolute URL για τις εικόνες σου (π.χ. φιλοξενούνται στο /public/photos/)
function baseUrl(req) {
  // Vercel παρέχει το host στο header
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host || '';
  const proto = (req?.headers?.['x-forwarded-proto'] || 'https');
  return `${proto}://${host}`;
}

// Pools για rarity. Προσαρμόζεις/επεκτείνεις.
const POOLS = {
  common:    [2,3,4,5,6,7,8,9,10,11,12],     // filenames 2..12
  uncommon:  [13,14,15],
  rare:      [16,17,18,19],
  ultra:     [20,21,22,23],
  legendary: [24,25,26,27],
};

// Απλή λογική επιλογής εικόνας με βάση tier
function pickImageForTier(tier) {
  // Ταιριάζουμε το tier του παιχνιδιού σε pools
  let pool = POOLS.common;
  if (/Legendary/i.test(tier)) pool = POOLS.legendary;
  else if (/Ultra/i.test(tier)) pool = POOLS.ultra;
  else if (/Rare/.test(tier))   pool = POOLS.rare;
  else if (/Uncommon/i.test(tier)) pool = POOLS.uncommon;

  const fileNo = pool[Math.floor(Math.random() * pool.length)];
  const imageUrl = `${process.env.SELF_BASE_URL || ''}/public/photos/${fileNo}.png`; // Δες σημείωση παρακάτω

  return {
    name: `Happy Box — ${tier} #${fileNo}`,
    imageUrl,
    attributes: [{ trait_type: 'Tier', value: tier }, { trait_type: 'Image', value: fileNo }],
  };
}
