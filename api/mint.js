// api/mint.js
// Vercel Serverless Function
// - 1 mint ανά email με Upstash Redis (REST)
// - Crossmint email-to-mint με template ανά tier/stage
// - CORS + καθαρά errors

// ===================== C O N F I G =====================
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const API_KEY         = process.env.CROSSMINT_API_KEY || "";
const COLLECTION_ID   = process.env.CROSSMINT_COLLECTION_ID || "";
const CROSSMINT_ENV   = (process.env.CROSSMINT_ENV || "production").toLowerCase();
const CHAIN           = CROSSMINT_ENV === "staging" ? "polygon-mumbai" : "polygon";

// Upstash REST (απαραίτητο για "1 email → 1 mint")
const KV_URL   = process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";

// CORS (πρόσθεσε εδώ επιτρεπόμενα origins αν θες να περιορίσεις)
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ===================== U T I L S =====================
function json(res, status, data) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  res.status(status).json(data);
}

function cut(s, n = 900) { try { return String(s).slice(0, n); } catch { return ""; } }

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

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

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
    "MYTHIC":     ["MYTHIC", "LEGENDARY"],
  };

  let wanted = map[T];
  if (!wanted) {
    if (Number(stage) === 1) wanted = map["COMMON"];
    else if (Number(stage) === 2) wanted = ["RARE", "ULTRARARE", "UNIQUE"];
    else if (Number(stage) === 3) wanted = ["EPIC", "LEGENDARY", "MYTHIC"];
    else wanted = map["COMMON"];
  }

  for (const bucket of wanted) {
    const bkey = bucket.replace(" ", "");
    const arr = TPL[bkey] || TPL[bucket] || [];
    if (arr.length) return pickRandom(arr);
  }
  return null;
}

// ===================== U P S T A S H  (1 email → 1 mint) =====================
// θα γράψουμε κλειδί: "minted:email:<lowercase_email>" με NX ώστε να πετυχαίνει μόνο στο πρώτο mint
async function upstashSetNX(key, value, ttlSec = 31536000) {
  // REST path μορφής /SET/{key}/{value}?NX=true&EX=ttl
  const url = `${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?NX=true&EX=${ttlSec}`;
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  // Upstash επιστρέφει { result: "OK" } αν γράφτηκε, ή { result: null } αν υπήρχε ήδη
  const txt = await r.text();
  try {
    const j = JSON.parse(txt);
    return { ok: r.ok, written: j.result === "OK", raw: j };
  } catch {
    return { ok: r.ok, written: false, raw: txt };
  }
}

async function upstashGet(key) {
  const url = `${KV_URL}/get/${encodeURIComponent(key)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  const txt = await r.text();
  try {
    const j = JSON.parse(txt);
    return { ok: r.ok, value: j.result ?? null, raw: j };
  } catch {
    return { ok: r.ok, value: null, raw: txt };
  }
}

// ===================== H A N D L E R =====================
module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  if (!API_KEY || !COLLECTION_ID) {
    return json(res, 500, { error: "Server not configured (Missing Crossmint API key / Collection ID)" });
  }
  if (!KV_URL || !KV_TOKEN) {
    return json(res, 500, { error: "Server not configured (Missing Upstash KV credentials)" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const email = (body.email || "").trim().toLowerCase();
    const stage = Number(body.stage || 0);
    const clientTier = body.tier || "";

    if (!EMAIL_RE.test(email)) {
      return json(res, 400, { error: "Invalid email" });
    }

    // 1) atomic check: έχει ξανακάνει mint αυτό το email;
    const mintKey = `minted:email:${email}`;
    const nowIso = new Date().toISOString();

    const setTry = await upstashSetNX(mintKey, JSON.stringify({ at: nowIso }), 31536000);
    if (!setTry.ok) {
      console.error("UPSTASH SET NX FAILED:", cut(setTry.raw));
      return json(res, 502, { error: "KV store error" });
    }
    if (!setTry.written) {
      // Υπήρχε ήδη -> 1 mint ανά email
      return json(res, 409, { error: "This email has already minted" });
    }

    // 2) Επιλογή template
    const normalizedTier = String(clientTier).replace(/→/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
    const templateId = chooseTemplateId(normalizedTier, stage);
    if (!templateId) {
      return json(res, 400, {
        error: "No templates available for this tier/stage",
        details: Object.fromEntries(Object.entries(TPL).map(([k, v]) => [k, v.length])),
      });
    }

    // 3) Κλήση Crossmint
    const endpoint = `https://www.crossmint.com/api/2022-06-09/collections/${COLLECTION_ID}/nfts`;
    const payload = {
      recipient: `email:${email}:${CHAIN}`,
      chain: CHAIN,
      templateId,
    };

    const cm = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-client-secret": API_KEY },
      body: JSON.stringify(payload),
    });

    const respText = await cm.text();

    if (!cm.ok) {
      console.error("CROSSMINT ERROR", cm.status, cut(respText));
      // roll back το "κλείδωμα" για να μην καεί το email αν το Crossmint απέτυχε
      await fetch(`${KV_URL}/del/${encodeURIComponent(mintKey)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
      }).catch(() => {});
      return json(res, cm.status, { error: "Crossmint rejected request", status: cm.status, details: cut(respText) });
    }

    let data; try { data = JSON.parse(respText); } catch { data = { raw: respText }; }

    // 4) Αποθήκευση αποτελέσματος για ιστορικό (optional)
    const saveKey = `minted:email:${email}:last`;
    await fetch(`${KV_URL}/set/${encodeURIComponent(saveKey)}/${encodeURIComponent(JSON.stringify({
      at: nowIso, tier: normalizedTier || null, stage, templateId, chain: CHAIN, crossmint: data?.id || null
    }))}?EX=31536000`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    }).catch(() => {});

    return json(res, 200, {
      ok: true,
      sent: { email, tier: normalizedTier || null, stage, templateId, chain: CHAIN },
      crossmint: data,
    });
  } catch (err) {
    console.error("MINT HANDLER CRASH", err);
    return json(res, 500, { error: "Internal server error" });
  }
};
