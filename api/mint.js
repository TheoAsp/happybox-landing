// /api/mint.js
// Next.js (Vercel) serverless API route – Crossmint "mint by email"
// Ταιριάζει τα tiers ανά στάδιο, επιλέγει τυχαίο template μέσα στο tier pool,
// και κάνει mint στο email του παίκτη.

export default async function handler(req, res) {
  // ---- Guard: method ----
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  // ---- ENV ----
  const API_KEY = process.env.CROSSMINT_API_KEY;
  const COLLECTION_ID = process.env.CROSSMINT_COLLECTION_ID;
  const ENV = (process.env.CROSSMINT_ENV || "staging").toLowerCase(); // "staging" | "production"
  const MAX_PER_EMAIL = parseInt(process.env.MAX_MINTS_PER_EMAIL || "1", 10);

  if (!API_KEY || !COLLECTION_ID) {
    return res.status(500).json({
      ok: false,
      error:
        "Server misconfigured: missing CROSSMINT_API_KEY or CROSSMINT_COLLECTION_ID",
    });
  }

  const HOST =
    ENV === "production"
      ? "https://www.crossmint.com"
      : "https://staging.crossmint.com";

  // ---- Input ----
  const { email, stage, completed, tier: clientTier } = req.body || {};

  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: "Invalid email" });
  }

  const st = Number(stage);
  if (![1, 2, 3].includes(st)) {
    return res.status(400).json({ ok: false, error: "Invalid stage" });
  }

  // ---- (Optional) very light throttle per email (stateless best-effort)
  // Σε production θα το έκανες με DB/ratelimit. Εδώ απλά προστατεύουμε λίγο.
  // Άφησα hook να τιμήσεις MAX_MINTS_PER_EMAIL αν αργότερα βάλεις DB.
  // Προς το παρόν δεν απορρίπτουμε — Crossmint θα αποτρέψει duplicates αν θες.
  // Αν ΘΕΣ να κόβεις αυστηρά 1/email, βάλε δικό σου storage/DB εδώ.

  // ---- Pools: βάλε εδώ τα TEMPLATE IDs που δημιούργησες στο Crossmint ----
  // Αν λείπουν COMMON/UNCOMMON προσωρινά, ο handler θα επιστρέψει καθαρό σφάλμα.
  const POOLS = {
    COMMON: [], // π.χ. ["TPL_COMMON_1", "TPL_COMMON_2"]
    UNCOMMON: [], // π.χ. ["TPL_UNCOMMON_1"]
    RARE: ["TPL_RARE_1", "TPL_RARE_2", "TPL_RARE_3"],
    ULTRARARE: ["TPL_ULTRARARE_1"],
    UNIQUE: ["TPL_UNIQUE_1", "TPL_UNIQUE_2"], // <-- προστέθηκε το TPL_UNIQUE_2
    EPIC: ["TPL_EPIC_1", "TPL_EPIC_2", "TPL_EPIC_3"],
    LEGENDARY: ["TPL_LEGENDARY_1", "TPL_LEGENDARY_2", "TPL_LEGENDARY_3", "TPL_LEGENDARY_4"],
    MYTHIC: ["TPL_MYTHIC_1", "TPL_MYTHIC_2", "TPL_MYTHIC_3"],
  };

  // ---- Tiers by stage (όπως ζήτησες) ----
  const ALLOWED_BY_STAGE = {
    1: ["COMMON", "UNCOMMON"],
    2: ["RARE", "ULTRARARE", "UNIQUE"],
    3: ["EPIC", "LEGENDARY", "MYTHIC"],
  };

  // Αν από το frontend έρχεται περιγραφικό Tier (π.χ. "Common → Uncommon"), δεν το εμπιστευόμαστε,
  // αποφασίζουμε στον server με βάση το stage. (ασφάλεια & δίκαιη λογική)
  const allowedTiers = ALLOWED_BY_STAGE[st];

  // Αν θες weights, μπορείς να αλλάξεις εδώ (ίσα βάρη προς το παρόν)
  const chosenTier = randomPick(allowedTiers);

  // Βρίσκουμε διαθέσιμα templates για το chosenTier
  const tierPool = POOLS[chosenTier] || [];
  if (tierPool.length === 0) {
    return res.status(400).json({
      ok: false,
      error:
        `No templates configured for tier ${chosenTier}. ` +
        `Create at least one template in Crossmint (e.g. TPL_${chosenTier}_1) and update POOLS.`,
    });
  }

  // Επιλογή τυχαίου template από το tier
  const templateId = randomPick(tierPool);

  // Μπορούμε να περάσουμε metadata — helpful για εμφάνιση στο wallet/marketplaces
  const metadata = {
    name: `my Happy Box — ${chosenTier}`,
    description: `Kalavryta Edition • Tier ${chosenTier}`,
    attributes: [
      { trait_type: "tier", value: chosenTier },
      { trait_type: "stage", value: st },
      ...(Array.isArray(completed)
        ? [{ trait_type: "tasks_completed", value: completed.length }]
        : []),
    ],
  };

  try {
    // Crossmint “mint by email”:
    // Endpoint (stable): /api/2022-06-09/collections/{collectionId}/nfts
    // Headers: X-API-KEY
    // Body: { recipient: "email:someone@example.com", templateId, metadata?, allowDuplicate? }
    const url = `${HOST}/api/2022-06-09/collections/${encodeURIComponent(
      COLLECTION_ID
    )}/nfts`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "X-API-KEY": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: `email:${email}`,
        templateId,
        metadata,
        allowDuplicate: false, // συνήθως false, ώστε να μη ξανακοπεί ίδιο NFT άθελά σου
      }),
    });

    const data = await safeJson(resp);

    if (!resp.ok) {
      // Eπιστρέφουμε το πραγματικό σφάλμα από Crossmint για debugging
      return res.status(resp.status).json({
        ok: false,
        error: data?.error || data?.message || `Crossmint error (${resp.status})`,
        details: data,
      });
    }

    // ΟΚ – Crossmint θα στείλει email στον χρήστη για το custodial wallet κ.λπ.
    return res.status(200).json({
      ok: true,
      email,
      stage: st,
      chosenTier,
      templateId,
      crossmint: data,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Mint request failed",
      details: err?.message || String(err),
    });
  }
}

// -------- Helpers --------
function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());
}

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function safeJson(resp) {
  try {
    return await resp.json();
  } catch {
    return null;
  }
               }
