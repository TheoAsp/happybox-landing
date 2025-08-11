import { getUser, setUser, summary, QUESTS } from "./_db.js";
import { requireAdmin } from "./_verify.js";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const uid = searchParams.get("uid");
  if (!uid) return new Response(JSON.stringify({ error: "uid required" }), { status: 400 });
  return Response.json(summary(uid));
}

export async function POST(req) {
  // Προαιρετικά προστασία admin για manual mark
  const guard = requireAdmin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({}));
  const { uid, questId } = body;
  if (!uid || !questId) {
    return new Response(JSON.stringify({ error: "uid and questId required" }), { status: 400 });
  }

  const u = getUser(uid);
  u.progress[questId] = true;

  // auto-unlock next tier όταν ολοκληρωθεί το tier1
  if (QUESTS.tier1.every(q => u.progress[q.id])) u.tier = 2;

  setUser(uid, u);
  return Response.json(summary(uid));
}
