// api/mint.js
// Vercel Serverless Function – Crossmint "email to mint" με templates ανά tier.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

// ----- διαβάζουμε βασικά env -----
const API_KEY = process.env.CROSSMINT_API_KEY || "";
const COLLECTION_ID = process.env.CROSSMINT_COLLECTION_ID || "";
const CROSSMINT_ENV = (process.env.CROSSMINT_ENV || "production").toLowerCase();

// chain: production -> polygon  (αν είσαι σε staging άλλαξε το σε "polygon-mumbai")
const CHAIN = CROSSMINT_ENV === "staging" ? "polygon-mumbai" : "polygon";

// ----- helper: μάζεψε όλα τα templateIds για ένα tier prefix -----
function getTierTemplates(prefix) {
  const arr = Object.keys(process.env)
    .filter((k) => k.startsWith(prefix))
    .sort() // σταθερή σειρά
    .map((k) => (process.env[k] || "").trim())
    .filter(Boolean);
  return arr;
}

// Μάζεψε λίστες από ENV (βάλε μόνο όσα χρησιμοποιείς)
const TPL = {
  COMMON:     getTierTemplates("TPL_COMMON_"),
  UNCOMMON:   getTierTemplates("TPL_UNCOMMON_"),
  RARE:       getTierTemplates("TPL_RARE_"),
  ULTRARARE:  getTierTemplates("TPL_ULTRARARE_"),
  UNIQUE:     getTierTemplates("TPL_UNIQUE_"),
  EPIC:       getTierTemplates("TPL_EPIC_"),
  LEGENDARY:  getTierTemplates("TPL_LEGENDARY_"),
  MYTHIC:     getTierTemplates("TPL_MYTHIC_"),
};

// helper
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Επιλογή templateId με βάση tier (και fallbacks αν λείπουν env)
function chooseTemplateId(tier, stage) {
  const T = (tier || "").toString().trim().toUpperCase();

  // κανόνες ανά tier
  const map = {
    "COMMON":     ["COMMON", "UNCOMMON", "RARE"],        // fallback σε UNCOMMON/RARE αν λείπει
    "UNCOMMON":   ["UNCOMMON", "COMMON", "RARE"],
    "RARE":       ["RARE", "ULTRARARE"],
    "ULTRA RARE": ["ULTRARARE", "RARE", "UNIQUE"],
    "ULTRARARE":  ["ULTRARARE", "RARE", "UNIQUE"],
    "UNIQUE":     ["UNIQUE"],
    "EPIC":       ["EPIC", "LEGENDARY"],
    "LEGENDARY":  ["LEGENDARY", "EPIC", "MYTHIC"],
    "MYTHIC":     ["MYTHIC", "LEGENDARY"]
  };

  // αν δεν έρθει "tier" από client, φτιάξε το από το stage
  let wanted = map[T];
  if (!wanted) {
    if (stage === 1)      wanted = map["COMMON"];
    else if (stage === 2) wanted = ["RARE", "ULTRARARE", "UNIQUE"];
    else if (stage === 3) wanted = ["EPIC", "LEGENDARY", "MYTHIC"];
    else wanted = map["COMMON"];
  }

  // ψάξε με προτεραιότητα και διάλεξε τυχαία από διαθέσιμα
  for (const bucket of wanted) {
    const arr = TPL[bucket.replace(" ", "")] || TPL[bucket] || [];
    if (arr.length) return pickRandom(arr);
  }
  return null; // τίποτα διαθέσιμο
}

// μικρό helper για να μην “πετάμε” τεράστια responses στα logs
function cut(s, n = 1200) { try { return String(s).slice(0, n); } catch { return ""; } }

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!API_KEY || !COLLECTION_ID) {
    return res.status(500).json({ error: "Server not configured (API key / COLLECTION missing)" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const email = (body.email || "").trim().toLowerCase();
    const stage = Number(body.stage || 0);
    const clientTier = body.tier || ""; // π.χ. "Common → Uncommon", "Legendary" κλπ.

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Invalid email" });
    }

    // καθάρισε το tier από “→” κλπ
    const normalizedTier = String(clientTier)
      .replace(/→/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();

    const templateId = chooseTemplateId(normalizedTier, stage);

    if (!templateId) {
      // Δεν υπάρχουν templates για το tier/stage – πες μας ποια λείπουν
      return res.status(400).json({
        error: "No templates available for this tier/stage",
        details: {
          tier: normalizedTier || null,
          stage: stage || null,
          available: Object.fromEntries(
            Object.entries(TPL).map(([k, v]) => [k, v.length])
          )
        }
      });
    }

    // φτιάξε σώμα για Crossmint
    const payload = {
      recipient: `email:${email}:${CHAIN}`,
      chain: CHAIN,
      templateId
      // εναλλακτικά αντί για templateId θα μπορούσες να στείλεις metadata
    };

    const endpoint = `https://www.crossmint.com/api/2022-06-09/collections/${COLLECTION_ID}/nfts`;

    const cm = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-secret": API_KEY
      },
      body: JSON.stringify(payload)
    });

    const txt = await cm.text();

    if (!cm.ok) {
      console.error("CROSSMINT ERROR", cm.status, cut(txt));
      return res.status(cm.status).json({
        error: "Crossmint rejected request",
        status: cm.status,
        details: cut(txt)
      });
    }

    // ok
    let data;
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

    return res.status(200).json({
      ok: true,
      sent: {
        email,
        tier: normalizedTier || null,
        templateId,
        chain: CHAIN
      },
      crossmint: data
    });
  } catch (err) {
    console.error("MINT HANDLER CRASH", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
