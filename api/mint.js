// /api/mint.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email, tier, stage, completed } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email" });
    }

    const COLLECTION_ID = process.env.CROSSMINT_COLLECTION_ID; // π.χ. "default-polygon"
    const API_KEY = process.env.CROSSMINT_API_KEY;             // το server API key (NOT client)

    if (!COLLECTION_ID || !API_KEY) {
      return res.status(500).json({ error: "Missing server env vars" });
    }

    // build metadata για το NFT
    const metadata = {
      name: `Happy Box — ${tier || "Common"}`,
      image: "https://myhappybox.gr/public/photos/1.png",
      description: `Stage: ${stage} | Completed: ${(completed || []).join(", ")}`,
      attributes: [
        { trait_type: "Tier", value: tier || "-" },
        { trait_type: "Stage", value: String(stage || 1) }
      ]
    };

    // Crossmint (email mint). Το endpoint αυτό συχνά επιστρέφει 400 με σαφές μήνυμα.
    const url = `https://www.crossmint.com/api/2022-06-09/collections/${COLLECTION_ID}/nfts/emails`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Προσοχή: εδώ μπαίνει το SERVER API KEY
        "X-API-KEY": API_KEY
      },
      body: JSON.stringify({
        // Μερικοί λογαριασμοί θέλουν recipients ως array, άλλοι ως αντικείμενο με recipient
        // Στέλνουμε το πιο πρόσφατο format:
        recipients: [{ email }],
        metadata
      })
    });

    const text = await resp.text(); // πάρ’το ωμά για debug
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!resp.ok) {
      // Επιστρέφουμε ΟΛΟ το λάθος για να φανεί στα Vercel logs και στο UI
      return res.status(resp.status).json({
        error: "Crossmint error",
        status: resp.status,
        details: data
      });
    }

    return res.status(200).json({ ok: true, crossmint: data });
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
}
