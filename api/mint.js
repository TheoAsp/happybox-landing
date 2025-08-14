const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

// --- ENV ---
const API_KEY       = process.env.CROSSMINT_API_KEY || "";
const COLLECTION_ID = process.env.CROSSMINT_COLLECTION_ID || "";
const CROSSMINT_ENV = (process.env.CROSSMINT_ENV || "production").toLowerCase();

const CHAIN = CROSSMINT_ENV === "staging" ? "polygon-mumbai" : "polygon";

// Upstash REST
const KV_URL   = process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";

// --- templates από ENV ---
function getTierTemplates(prefix) {
  return Object.keys(process.env)
    .filter((k) => k.startsWith(prefix))
    .sort()
    .map((k) => (process.env[k] || "").trim())
    .filter(Boolean);
}
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
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Επιλογή template ανά tier/stage (όπως είχαμε)
function chooseTemplateId(tier, stage) {
  const T = (tier || "").toString().trim().toUpperCase();
  const map = {
    "COMMON":     ["COMMON", "UNCOMMON", "RARE"],
    "UNCOMMON":   ["UNCOMMON", "COMMON", "RARE"],
    "RARE":       ["RARE", "ULTRARARE"],
    "ULTRA RARE": ["ULTRARARE", "RARE", "UNIQUE"],
    "ULTRARARE":  ["ULTRARARE", "RARE", "UNIQUE"],
    "UNIQUE":     ["UNIQUE"],
    "EPIC":       ["EPIC", "LEGENDARY"],
    "LEGENDARY":  ["LEGENDARY", "EPIC", "MYTHIC"],
    "MYTHIC":     ["MYTHIC", "LEGENDARY"]
  };

  let wanted = map[T];
  if (!wanted) {
    if (stage === 1)      wanted = map["COMMON"];
    else if (stage === 2) wanted = ["RARE", "ULTRARARE", "UNIQUE"];
    else if (stage === 3) wanted = ["EPIC", "LEGENDARY", "MYTHIC"];
    else                  wanted = map["COMMON"];
  }

  for (const bucket of wanted) {
    const arr = TPL[bucket.replace(" ", "")] || TPL[bucket] || [];
    if (arr.length) return pickRandom(arr);
  }
  return null;
}

// --- Upstash helpers ---
async function kvSetOnce(key, secondsTTL = 60 * 60 * 24 * 30) {
  // SETNX: βάλε value=1 μόνο αν δεν υπάρχει, με TTL
  const resp = await fetch(
    `${KV_URL}/set/${encodeURIComponent(key)}/1?nx=true&ttlSeconds=${secondsTTL}`,
    { method: "POST", headers: { Authorization: `Bearer ${KV_TOKEN}` } }
  );
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`KV set failed ${resp.status}: ${t}`);
  }
  const text = await resp.text();
  // Upstash επιστρέφει "OK" αν έβαλε, "null" αν υπήρχε ήδη
  return text.replace(/"/g, "") === "OK";
}

function cut(s, n = 1200) { try { return String(s).slice(0, n); } catch { return ""; } }

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!API_KEY || !COLLECTION_ID) return res.status(500).json({ error: "Server not configured" });
  if (!KV_URL || !KV_TOKEN) return res.status(500).json({ error: "KV not configured" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const email = (body.email || "").trim().toLowerCase();
    const stage = Number(body.stage || 0);
    const clientTier = body.tier || "";

    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Invalid email" });

    // Κλείδωμα: 1 NFT / email
    const lockKey = `minted:${email}`;
    const acquired = await kvSetOnce(lockKey, 60 * 60 * 24 * 30); // 30 ημέρες
    if (!acquired) {
      return res.status(429).json({ error: "This email has already minted a reward recently." });
    }

    // normalise tier
    const normalizedTier = String(clientTier).replace(/→/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
    const templateId = chooseTemplateId(normalizedTier, stage);
    if (!templateId) {
      return res.status(400).json({
        error: "No templates available for this tier/stage",
        details: Object.fromEntries(Object.entries(TPL).map(([k,v]) => [k, v.length]))
      });
    }

    // Crossmint call
    const payload = { recipient: `email:${email}:${CHAIN}`, chain: CHAIN, templateId };
    const endpoint = `https://www.crossmint.com/api/2022-06-09/collections/${COLLECTION_ID}/nfts`;

    const cm = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-client-secret": API_KEY },
      body: JSON.stringify(payload)
    });

    const txt = await cm.text();
    if (!cm.ok) {
      // Αν αποτύχει το mint, ελευθέρωσε το lock για να ξαναδοκιμάσει ο χρήστης
      await fetch(`${KV_URL}/del/${encodeURIComponent(lockKey)}`, {
        method: "POST", headers: { Authorization: `Bearer ${KV_TOKEN}` }
      }).catch(()=>{});
      return res.status(cm.status).json({ error: "Crossmint rejected request", details: cut(txt) });
    }

    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    return res.status(200).json({ ok: true, sent: { email, tier: normalizedTier || null, templateId, chain: CHAIN }, crossmint: data });

  } catch (err) {
    return res.status(500).json({ error: "Internal server error", details: String(err && err.message || err) });
  }
  }
