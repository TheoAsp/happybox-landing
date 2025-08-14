// api/mint.js
// Vercel Serverless Function — Crossmint "email to mint" + 1 NFT ανά email (Upstash KV)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

// ====== ENV ======
const API_KEY        = process.env.CROSSMINT_API_KEY || "";
const COLLECTION_ID  = process.env.CROSSMINT_COLLECTION_ID || "";
const CROSSMINT_ENV  = (process.env.CROSSMINT_ENV || "production").toLowerCase();
const CHAIN          = CROSSMINT_ENV === "staging" ? "polygon-mumbai" : "polygon";

// Upstash KV (REST)
const KV_URL   = process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";

// ====== helpers ======
function cut(s, n = 1200) { try { return String(s).slice(0, n); } catch { return ""; } }
function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

// Upstash pipeline helper (ασφαλές για όλα τα commands)
async function kvPipeline(commands){
  const resp = await fetch(`${KV_URL}/pipeline`, {
    method: "POST",
    headers: {
      "Content-Type":"application/json",
      "Authorization":`Bearer ${KV_TOKEN}`
    },
    body: JSON.stringify({ commands })
  });
  if (!resp.ok) throw new Error(`KV ${resp.status} ${await resp.text()}`);
  return resp.json(); // returns array of [result, ...]
}
async function kvGet(key){
  const out = await kvPipeline([["GET", key]]);
  return out?.[0] ?? null;
}
async function kvSetNX(key, value, exSeconds){
  // SET key value NX EX <seconds>  -> returns "OK" or null
  const out = await kvPipeline([["SET", key, value, "NX", "EX", String(exSeconds || 0)]]);
  return out?.[0] === "OK";
}
async function kvSet(key, value, exSeconds){
  const out = await kvPipeline([["SET", key, value, "EX", String(exSeconds || 0)]]);
  return out?.[0] === "OK";
}
async function kvDel(key){
  try { await kvPipeline([["DEL", key]]); } catch {}
}

// ----- Φόρτωση template IDs από env (TPL_<TIER>_<#>) -----
function getTierTemplates(prefix){
  return Object.keys(process.env)
    .filter(k => k.startsWith(prefix))
    .sort()
    .map(k => (process.env[k] || "").trim())
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

function chooseTemplateId(tier, stage){
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
  if (!wanted){
    if (stage === 1)      wanted = map["COMMON"];
    else if (stage === 2) wanted = ["RARE","ULTRARARE","UNIQUE"];
    else if (stage === 3) wanted = ["EPIC","LEGENDARY","MYTHIC"];
    else                  wanted = map["COMMON"];
  }
  for (const bucket of wanted){
    const key = bucket.replace(" ","");
    const arr = TPL[key] || TPL[bucket] || [];
    if (arr.length) return pickRandom(arr);
  }
  return null;
}

// ====== Handler ======
module.exports = async function handler(req, res){
  if (req.method !== "POST") {
    return res.status(405).json({ error:"Method not allowed" });
  }
  if (!API_KEY || !COLLECTION_ID) {
    return res.status(500).json({ error:"Server not configured (API key / COLLECTION missing)" });
  }
  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error:"Server not configured (KV URL / TOKEN missing)" });
  }

  try{
    const body  = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const email = (body.email || "").trim().toLowerCase();
    const stage = Number(body.stage || 0);
    const clientTier = body.tier || "";

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error:"Invalid email" });
    }

    const normalizedTier = String(clientTier).replace(/→/g," ").replace(/\s+/g," ").trim().toUpperCase();

    // ====== 1-per-email προστασία ======
    const FINAL_KEY = `minted:${email}`;   // οριστική σήμανση
    const LOCK_KEY  = `mintlock:${email}`; // προσωρινό lock 2 λεπτών

    // Αν έχει ήδη γίνει mint, μπλοκάρουμε
    const already = await kvGet(FINAL_KEY);
    if (already) {
      return res.status(409).json({ error:"This email has already minted an NFT", details: already });
    }

    // Βάλε lock (NX) για να αποφύγεις διπλά κλικ/requests
    const gotLock = await kvSetNX(LOCK_KEY, "1", 120); // 120s
    if (!gotLock) {
      return res.status(429).json({ error:"Please wait — a mint is already in progress for this email." });
    }

    // Διάλεξε template
    const templateId = chooseTemplateId(normalizedTier, stage);
    if (!templateId) {
      await kvDel(LOCK_KEY);
      return res.status(400).json({
        error:"No templates available for this tier/stage",
        details:{
          tier: normalizedTier || null,
          stage: stage || null,
          available: Object.fromEntries(Object.entries(TPL).map(([k,v])=>[k, v.length]))
        }
      });
    }

    // Κάλεσε Crossmint
    const endpoint = `https://www.crossmint.com/api/2022-06-09/collections/${COLLECTION_ID}/nfts`;
    const payload = {
      recipient: `email:${email}:${CHAIN}`,
      chain: CHAIN,
      templateId
    };

    const cm = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type":"application/json",
        "x-client-secret": API_KEY
      },
      body: JSON.stringify(payload)
    });

    const raw = await cm.text();

    if (!cm.ok){
      console.error("CROSSMINT ERROR", cm.status, cut(raw));
      await kvDel(LOCK_KEY); // αποτυχία -> άσε τον χρήστη να ξαναπροσπαθήσει
      return res.status(cm.status).json({ error:"Crossmint rejected request", status: cm.status, details: cut(raw) });
    }

    // Επιτυχία — μαρκάρισε οριστικά το email ως minted (λήγει σε 1 χρόνο)
    let data; try { data = JSON.parse(raw); } catch { data = { raw }; }
    const record = JSON.stringify({
      when: Date.now(),
      chain: CHAIN,
      templateId,
      tier: normalizedTier || null,
      crossmint: data
    });
    await kvSet(FINAL_KEY, record, 60 * 60 * 24 * 365); // 1 year
    await kvDel(LOCK_KEY);

    return res.status(200).json({
      ok: true,
      sent: { email, tier: normalizedTier || null, templateId, chain: CHAIN },
      crossmint: data
    });

  } catch (err){
    console.error("MINT HANDLER CRASH", err);
    // safety: καθάρισε lock αν κάτι έσκασε πριν το καθαρίσουμε
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const email = (body.email || "").trim().toLowerCase();
      if (EMAIL_RE.test(email)) await kvDel(`mintlock:${email}`);
    } catch {}
    return res.status(500).json({ error:"Internal server error" });
  }
};
