// /api/mint.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email, tier, completed, stage } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email" });
    }

    // mapping tier -> template id (fallback σε TPL_COMMON)
    const tplCommon   = process.env.TPL_COMMON;
    const tplRare     = process.env.TPL_RARE;
    const tplUltra    = process.env.TPL_ULTRA;
    const tplLegend   = process.env.TPL_LEGENDARY;

    const pickTemplateId = () => {
      const t = (tier || "").toLowerCase();
      if (t.includes("legend")) return tplLegend || tplUltra || tplRare || tplCommon;
      if (t.includes("ultra"))  return tplUltra  || tplRare || tplCommon;
      if (t.includes("rare"))   return tplRare   || tplCommon;
      return tplCommon;
    };

    const templateId   = pickTemplateId();
    const collectionId = process.env.CROSSMINT_COLLECTION_ID;
    const API_KEY      = process.env.CROSSMINT_API_KEY;

    if (!API_KEY || !collectionId || !templateId) {
      return res.status(500).json({ error: "Server misconfigured: missing env vars" });
    }

    // recipient ως email (το chain το γνωρίζει από το collection)
    const recipient = `email:${email}`;

    // OPTIONAL: extra metadata που θες να “γραφτούν” επάνω στο minted NFT
    const metadata = {
      name: `Happy Box — ${tier || "Guest"}`,
      description: "Minted via Happy Box game (Kalavryta Edition).",
      attributes: [
        { trait_type: "Tier", value: tier || "—" },
        { trait_type: "Stage Reached", value: String(stage || 1) },
        { trait_type: "Completed keys", value: (completed || []).length }
      ]
    };

    const url = `https://www.crossmint.com/api/2022-06-09/collections/${collectionId}/nfts`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "X-Client-Secret": API_KEY,      // server key
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        recipient,            // "email:xxx"
        templateId,           // <<<< το κρίσιμο για mint-from-template
        // Αν θες να περάσεις επιπλέον metadata (προαιρετικό):
        metadata
      })
    });

    const out = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      console.error("Crossmint error", resp.status, out);
      return res.status(resp.status).json({ error: out?.error || "Crossmint mint failed" });
    }

    // Επιστρέφουμε κάτι χρήσιμο στο UI (π.χ. requestId)
    return res.status(200).json({ ok: true, requestId: out?.id || null });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Unexpected server error" });
  }
}
