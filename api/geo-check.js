import { getUser, setUser, summary } from "./_db.js";

const TARGETS = {
  // ενδεικτικές συντεταγμένες — άλλαξέ τες με τις πραγματικές
  kapi: { lat: 38.0405, lon: 22.1082, radius: 250 }, // 250m
};

function haversine(a, b) {
  const R = 6371000; // m
  const toRad = d => d * Math.PI/180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export async function POST(req) {
  const { uid, lat, lon, checkpoint, questId } = await req.json().catch(() => ({}));
  if (!uid || lat == null || lon == null || !checkpoint || !questId) {
    return new Response(JSON.stringify({ error: "uid, lat, lon, checkpoint, questId required" }), { status: 400 });
  }

  const target = TARGETS[checkpoint];
  if (!target) return new Response(JSON.stringify({ error: "unknown checkpoint" }), { status: 400 });

  const dist = haversine({ lat: Number(lat), lon: Number(lon) }, target);
  const ok = dist <= (target.radius || 200);

  if (!ok) {
    return Response.json({ ok: false, distance: Math.round(dist) });
  }

  const u = getUser(uid);
  u.progress[questId] = true;
  setUser(uid, u);
  return Response.json({ ok: true, ...summary(uid) });
}
