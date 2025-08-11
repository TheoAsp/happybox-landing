import { getUser, setUser, summary } from "./_db.js";

const ALLOWED_CODES = (process.env.QR_CODES || "").split(",").map(s => s.trim()).filter(Boolean);
// εναλλακτικά ένα shared secret:
const SHARED = process.env.QR_SECRET || "";

export async function POST(req) {
  const { uid, code, questId } = await req.json().catch(() => ({}));
  if (!uid || !code || !questId) {
    return new Response(JSON.stringify({ error: "uid, code, questId required" }), { status: 400 });
  }

  const okList = ALLOWED_CODES.length ? ALLOWED_CODES.includes(code) : (code === SHARED);
  if (!okList) {
    return new Response(JSON.stringify({ error: "invalid code" }), { status: 403 });
  }

  const u = getUser(uid);
  u.progress[questId] = true;
  setUser(uid, u);
  return Response.json(summary(uid));
}
