export function requireAdmin(req) {
  const header = req.headers.get("authorization") || "";
  const token  = header.replace(/^Bearer\s+/i, "");
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  return null; // ok
}
