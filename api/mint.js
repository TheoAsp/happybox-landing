// api/mint.js
// Email-to-mint με Crossmint + 1 mint ανά email (μόνιμο) μέσω Upstash KV

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const API_KEY       = process.env.CROSSMINT_API_KEY || "";
const COLLECTION_ID = process.env.CROSSMINT_COLLECTION_ID || "";
const CROSSMINT_ENV = (process.env.CROSSMINT_ENV || "production").toLowerCase();
const CHAIN = CROSSMINT_ENV === "staging" ? "polygon-mumbai" : "polygon";

// Upstash KV (REST)
const KV_BASE  = process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";

// -------- helpers --------
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
function cut(s, n = 1500) { try { return String(s).slice(0, n); } catch { return ""; } }

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
    else wanted = map["COMMON"];
  }

  for (const bucket of wanted) {
    const key = bucket.replace(" ", "");
    const arr = TPL[key] || [];
    if (arr.length) return pickRandom(arr);
  }
  return null;
}

// -------- KV ops (1 mint / email) --------
async function kvGet(key) {
  const r = await fetch(`${KV_BASE}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`KV GET ${r.status}: ${txt}`);
  return txt; // {"result":"..."} ή {"result":null}
}

async function kvSet(key, value) {
  const r = await fetch(`${KV_BASE}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`KV SET ${r.status}: ${txt}`);
  return txt;
}

// -----------------------------------------
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!API_KEY || !COLLECTION_ID) {
    return res.status(500).json({ error: "Server not configured (Crossmint envs missing)" });
  }
  if (!KV_BASE || !KV_TOKEN) {
    return res.status(500).json({ error: "Server not configured (KV envs missing)" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const email = String(body.email || "").trim().toLowerCase();
    const stage = Number(body.stage || 0);
    const clientTier = String(body.tier || "");

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Invalid email" });
    }

    const normalizedTier = clientTier
      .replace(/→/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();

    // 1) Έλεγχος: έχει ξανακάνει mint;
    const kvKey = `minted:${email}`;
    try {
      const existingTxt = await kvGet(kvKey);
      const existing = (() => { try { return JSON.parse(existingTxt).result; } catch { return null; } })();
      if (existing) {
        return res.status(429).json({
          error: "Already minted",
          details: "Each email can mint only once."
        });
      }
    } catch (e) {
      console.error("KV GET error:", e);
      return res.status(502).json({ error: "KV unavailable", details: String(e.message || e) });
    }

    // 2) Διάλεξε template
    const templateId = chooseTemplateId(normalizedTier, stage);
    if (!templateId) {
      return res.status(400).json({
        error: "No templates available for this tier/stage",
        details: Object.fromEntries(Object.entries(TPL).map(([k,v]) => [k, v.length]))
      });
    }

    // 3) Κάλεσε Crossmint
    const endpoint = `https://www.crossmint.com/api/2022-06-09/collections/${COLLECTION_ID}/nfts`;
    const payload = {
      recipient: `email:${email}:${CHAIN}`,
      chain: CHAIN,
      templateId
    };

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
      console.error("Crossmint error:", cm.status, cut(txt));
      return res.status(cm.status).json({
        error: "Crossmint rejected request",
        status: cm.status,
        details: cut(txt)
      });
    }

    // 4) Κλείδωσε το email
    try {
      await kvSet(kvKey, "1"); // χωρίς TTL => μόνιμο
    } catch (e) {
      console.error("KV SET error (post-mint):", e);
      // δεν αποτυγχάνει το mint, απλώς γράφουμε log
    }

    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    return res.status(200).json({
      ok: true,
      sent: { email, tier: normalizedTier || null, templateId, chain: CHAIN },
      crossmint: data
    });

  } catch (err) {
    console.error("MINT HANDLER CRASH:", err);
    return res.status(500).json({ error: "Internal server error", details: String(err.message || err) });
  }
};
