// api/verify-qr.js
// 6 διαφορετικά QR (1 στο Στάδιο 1, 2 στο Στάδιο 2, 3 στο Στάδιο 3)
// + περιορισμός "μία φορά ανά email για ΚΑΘΕ QR" με Upstash KV.

import { getUser, setUser, summary } from "./_db.js";

// ---------- ENV ----------
// Βάλε αυτά στα Vercel env του project (All Environments):
// QR_S1, QR_S2A, QR_S2B, QR_S3A, QR_S3B, QR_S3C  (τα “μυστικά” strings των QR)
// (προαιρετικό) QR_SECRET  -> ένα shared master code για δοκιμές
//
// Upstash KV (από το Integration):
// KV_REST_API_URL, KV_REST_API_TOKEN

const QR = {
  S1:  (process.env.QR_S1  || "").trim(),
  S2A: (process.env.QR_S2A || "").trim(),
  S2B: (process.env.QR_S2B || "").trim(),
  S3A: (process.env.QR_S3A || "").trim(),
  S3B: (process.env.QR_S3B || "").trim(),
  S3C: (process.env.QR_S3C || "").trim(),
};
const SHARED = (process.env.QR_SECRET || "").trim();

// Upstash KV (REST)
const KV_BASE  = process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";

// ---------- helpers ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const cut = (s, n = 900) => { try { return String(s).slice(0, n); } catch { return ""; } };
const knownCodes = Object.values(QR).filter(Boolean);

// KV: read/write
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

// Ανακάλυψε ποιο “slot” είναι αυτό το code (π.χ. S2A)
function resolveSlotByCode(code) {
  if (!code) return null;
  for (const [slot, value] of Object.entries(QR)) {
    if (value && value === code) return slot; // ακριβής ταύτιση
  }
  // εναλλακτικά, επέτρεψε το SHARED μόνο για δοκιμές
  if (SHARED && code === SHARED) return "SHARED";
  return null;
}

// ---------- handler ----------
export async function POST(req) {
  if (!KV_BASE || !KV_TOKEN) {
    return new Response(JSON.stringify({ error: "KV not configured" }), { status: 500 });
  }

  let payload = {};
  try { payload = await req.json(); } catch { /* noop */ }

  const uid     = (payload.uid || "").trim();
  const email   = String(payload.email || "").trim().toLowerCase();
  const code    = (payload.code || "").trim();
  const questId = (payload.questId || "").trim(); // π.χ. "s2:shopA" όπως ήδη χρησιμοποιείς

  if (!uid || !email || !code || !questId) {
    return new Response(JSON.stringify({ error: "uid, email, code, questId required" }), { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return new Response(JSON.stringify({ error: "invalid email" }), { status: 400 });
  }

  // 1) Ταυτοποίησε ότι το code είναι ένα από τα 6 (ή το SHARED)
  const slot = resolveSlotByCode(code);
  if (!slot) {
    return new Response(JSON.stringify({ error: "invalid code" }), { status: 403 });
  }

  // 2) Έλεγξε "μία φορά ανά email για ΚΑΘΕ QR"
  const lockKey = `qrused:${slot}:${email}`; // π.χ. qrused:S2A:alice@gmail.com
  try {
    const got = await kvGet(lockKey);
    const used = (() => { try { return JSON.parse(got).result; } catch { return null; } })();
    if (used) {
      return new Response(JSON.stringify({
        error: "already used",
        details: `This QR (${slot}) has already been used by this email.`
      }), { status: 409 });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: "KV read failed", details: String(e.message || e) }), { status: 502 });
  }

  // 3) Μάρκαρε πρόοδο χρήστη (όπως πριν)
  try {
    const u = getUser(uid);
    if (email) u.email = email;            // κρατάμε και το email πάνω στο profile
    u.progress[questId] = true;            // ολοκληρωμένο αυτό το quest
    setUser(uid, u);
  } catch (e) {
    return new Response(JSON.stringify({ error: "progress update failed", details: String(e.message || e) }), { status: 500 });
  }

  // 4) Κλείδωσε το email για αυτό το QR (χωρίς TTL = μόνιμα)
  try {
    await kvSet(lockKey, String(Date.now()));
  } catch (e) {
    // δεν ρίχνουμε όλο το flow — απλά ενημερωτικό error
    console.error("KV SET (lock) error:", e);
  }

  // 5) Επιστροφή με συνοπτικά στοιχεία προόδου
  const info = summary(uid); // δικό σου helper
  return new Response(JSON.stringify({
    ok: true,
    slot,
    questId,
    email,
    progress: info.progress,
    rarity: info.rarity
  }), { status: 200 });
}
