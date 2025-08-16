// api/verify-qr.js
// 6 διαφορετικά QR (S1, S2A, S2B, S3A, S3B, S3C)
// - 1 χρήση ανά email για ΚΑΘΕ QR (Upstash KV)
// - STRICT mapping: κάθε questId δέχεται μόνο το σωστό slot
// - Anti-leak hardening: per-IP throttle + per-slot daily cap (+ optional geofence)

import { getUser, setUser, summary } from "./_db.js";

// ---------- ENV (βάλε/σίγουρεψέ τα στο Vercel) ----------
const QR = {
  S1:  (process.env.QR_S1  || "").trim(),
  S2A: (process.env.QR_S2A || "").trim(),
  S2B: (process.env.QR_S2B || "").trim(),
  S3A: (process.env.QR_S3A || "").trim(),
  S3B: (process.env.QR_S3B || "").trim(),
  S3C: (process.env.QR_S3C || "").trim(),
};
// άφησέ το ΚΕΝΟ στην παραγωγή. Μόνο για dev δοκιμές.
const SHARED = (process.env.QR_SECRET || "").trim();

// Upstash KV (Integration)
const KV_BASE  = process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";

// Anti-leak ρυθμίσεις (μπορείς να τα αλλάξεις από env)
const MAX_PER_IP_PER_HOUR   = Number(process.env.QR_MAX_PER_IP_PER_HOUR   || 6);   // π.χ. 6 δοκιμές/ώρα/ΙP
const MAX_PER_SLOT_PER_DAY  = Number(process.env.QR_MAX_PER_SLOT_PER_DAY  || 500); // π.χ. 500 έγκυρες χρήσεις ημερησίως/slot
const GEOFENCE_TOLERANCE_M  = Number(process.env.QR_GEOFENCE_TOLERANCE_M  || 120); // προαιρετικό, δείτε παρακάτω

// Προαιρετικές γεω-ζώνες ανά κατάστημα (αν δεν θες, άφησέ τες κενές)
const SHOPS_GEOFENCE = {
  S1:  null, // ή { lat: 38.03, lon: 22.11, radius: 200 }
  S2A: null,
  S2B: null,
  S3A: null,
  S3B: null,
  S3C: null,
};

// ---------- helpers ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

// Κάθε quest τι slot δέχεται;
const ALLOWED_SLOT_FOR_QUEST = {
  "s1:shop":   "S1",
  "s2:shopA":  "S2A",
  "s2:shopB":  "S2B",
  "s3:shopA":  "S3A",
  "s3:shopB":  "S3B",
  "s3:shopC":  "S3C",
};

function todayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

// Upstash KV μικρές συναρτήσεις
async function kvGet(key) {
  const r = await fetch(`${KV_BASE}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`KV GET ${r.status}`);
  return txt; // {"result":"..."} ή {"result":null}
}
async function kvSet(key, value, ttlSec = 0) {
  // /set/<key>/<value>  (+optional ?EX=ttl)
  const url = new URL(`${KV_BASE}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`);
  if (ttlSec > 0) url.searchParams.set("EX", String(ttlSec));
  const r = await fetch(url.toString(), { method: "POST", headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  if (!r.ok) throw new Error(`KV SET ${r.status}`);
}
async function kvIncr(key, ttlSec = 0) {
  const url = new URL(`${KV_BASE}/incrby/${encodeURIComponent(key)}/1`);
  if (ttlSec > 0) url.searchParams.set("EX", String(ttlSec));
  const r = await fetch(url.toString(), { method: "POST", headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  const txt = await r.text();
  if (!r.ok) throw new Error(`KV INCR ${r.status}`);
  // txt = {"result":<number>}
  try { return JSON.parse(txt).result; } catch { return 0; }
}

// Βρες ποιο slot είναι αυτό το code (ή token)
function resolveSlotByCode(code) {
  if (!code) return null;
  for (const [slot, value] of Object.entries(QR)) {
    if (value && value === code) return slot; // ακριβής ταύτιση
  }
  if (SHARED && code === SHARED) return "SHARED"; // DEV ONLY
  return null;
}

// Haversine (για προαιρετικό geofence σε καταστήματα)
function haversineM(a, b) {
  const R = 6371000;
  const toRad = (d)=> d*Math.PI/180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const x = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}

// ---------- handler ----------
export async function POST(req) {
  if (!KV_BASE || !KV_TOKEN) {
    return new Response(JSON.stringify({ error: "KV not configured" }), { status: 500 });
  }

  // πάρ’ το IP (best effort από headers)
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
          || req.headers.get("x-real-ip")
          || "0.0.0.0";

  let payload = {};
  try { payload = await req.json(); } catch {}

  const uid     = String(payload.uid || "").trim();
  const email   = String(payload.email || "").trim().toLowerCase();
  // υποστηρίζουμε ΚΑΙ token ΚΑΙ code για συμβατότητα με frontend
  const code    = String(payload.token || payload.code || "").trim();
  const questId = String(payload.questId || "").trim();

  const lat = (payload.lat != null ? Number(payload.lat) : null);
  const lon = (payload.lon != null ? Number(payload.lon) : null);

  if (!uid || !email || !code || !questId) {
    return new Response(JSON.stringify({ error: "uid, email, code, questId required" }), { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return new Response(JSON.stringify({ error: "invalid email" }), { status: 400 });
  }

  // 0) Per-IP throttle (βασική προστασία από bots/διαρροές)
  try {
    const ipKey = `qr:ip:${ip}:${todayKey()}`;
    const hits = await kvIncr(ipKey, 3600); // TTL 1 ώρα
    if (hits > MAX_PER_IP_PER_HOUR) {
      return new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });
    }
  } catch { /* δεν “ρίχνουμε” το flow αν χαλάσει το KV */ }

  // 1) Map code -> slot
  const slot = resolveSlotByCode(code);
  if (!slot) {
    return new Response(JSON.stringify({ error: "invalid code" }), { status: 403 });
  }

  // 2) STRICT questId->slot
  const mustBe = ALLOWED_SLOT_FOR_QUEST[questId];
  if (!mustBe) {
    return new Response(JSON.stringify({ error: "unknown questId" }), { status: 400 });
  }
  if (slot !== mustBe && slot !== "SHARED") {
    return new Response(JSON.stringify({ error: "wrong code for this quest" }), { status: 403 });
  }

  // 3) (Προαιρετικά) geofence για ΚΑΤΑΣΤΗΜΑΤΑ αν μας ήρθαν lat/lon και υπάρχει ζώνη
  const fence = SHOPS_GEOFENCE[mustBe];
  if (fence && Number.isFinite(lat) && Number.isFinite(lon)) {
    const d = haversineM({lat,lon}, fence);
    if (d > (fence.radius || GEOFENCE_TOLERANCE_M)) {
      return new Response(JSON.stringify({ error: "outside area", distance: Math.round(d) }), { status: 403 });
    }
  }

  // 4) Per-slot daily cap (αν διαρρεύσει, δεν “φεύγουν” άπειρα)
  try {
    const capKey = `qr:cap:${mustBe}:${todayKey()}`;
    const used = await kvIncr(capKey, 86400); // TTL 1 μέρα
    if (used > MAX_PER_SLOT_PER_DAY) {
      return new Response(JSON.stringify({ error: "temporarily disabled" }), { status: 503 });
    }
  } catch { /* αν αποτύχει, συνεχίζουμε */ }

  // 5) 1 φορά ανά email ΓΙΑ ΑΥΤΟ ΤΟ SLOT
  const lockKey = `qrused:${mustBe}:${email}`;
  try {
    const got = await kvGet(lockKey);
    const prev = (()=>{ try{ return JSON.parse(got).result }catch{ return null } })();
    if (prev) {
      return new Response(JSON.stringify({ error: "already used" }), { status: 409 });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: "KV read failed" }), { status: 502 });
  }

  // 6) Μάρκαρε πρόοδο
  try {
    const u = getUser(uid);
    u.email = email;
    u.progress[questId] = true;
    setUser(uid, u);
  } catch (e) {
    return new Response(JSON.stringify({ error: "progress update failed" }), { status: 500 });
  }

  // 7) Κλείδωσε email για αυτό το slot (χωρίς TTL)
  try { await kvSet(lockKey, String(Date.now())); } catch {}

  // 8) ΤΕΛΟΣ — απαντάμε μινιμαλιστικά (χωρίς να αποκαλύψουμε code/slot)
  const info = summary(uid);
  return new Response(JSON.stringify({
    ok: true,
    questId,
    email,
    progress: info.progress,
    rarity: info.rarity
  }), { status: 200 });
                                       }
