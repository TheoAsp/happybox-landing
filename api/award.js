import { getUser, setUser, summary } from "./_db.js";

export async function POST(req) {
  const { uid, email } = await req.json().catch(() => ({}));
  if (!uid) return new Response(JSON.stringify({ error: "uid required" }), { status: 400 });

  const u = getUser(uid);
  if (email) u.email = email;
  setUser(uid, u);

  // Υπολόγισε rarity από την πρόοδο
  const info = summary(uid);

  // εδώ θα φτιάξεις integration με thirdweb/paper για mint,
  // π.χ. στέλνεις email claim link ανάλογα με το info.rarity

  return Response.json({ ok: true, rarity: info.rarity, progress: info.progress });
}
