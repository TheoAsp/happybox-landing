// api/geo-check.js
// Geolocation verification για πολλά αξιοθέατα.
// Body (POST): { uid, lat, lon, checkpoint, questId }

import { getUser, setUser, summary } from "./_db.js";

// Συνάρτηση Haversine (απόσταση σε μέτρα)
function haversine(a, b) {
  const R = 6371000; // ακτίνα Γης σε μέτρα
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// ---- ΟΡΙΣΜΟΙ ΣΗΜΕΙΩΝ (lat/lon/radius σε μέτρα) ----
// Μπορείς να αλλάξεις τα radius όπου θες (έβαλα ρεαλιστικά default).
const TARGETS = {
  museum: {                // Δημοτικό Μουσείο Καλαβρυτινού Ολοκαυτώματος
    lat: 38.03316613755724,
    lon: 22.110534198887482,
    radius: 200,
  },
  agiaLavra: {             // Μονή Αγίας Λαύρας
    lat: 38.012839509071014,
    lon: 22.081038001749636,
    radius: 220,
  },
  petmezaionSquare: {      // Πλατεία Πετμεζαίων
    lat: 38.03179458833854,
    lon: 22.110687574022126,
    radius: 120,
  },
  heroes1821: {            // Μνημείο Ηρώων Αγωνιστών του 1821
    lat: 38.019184364397326,
    lon: 22.07491208354384,
    radius: 180,
  },
  skiCenter: {             // Χιονοδρομικό Κέντρο Καλαβρύτων
    lat: 38.00621667786167,
    lon: 22.196732352856966,
    radius: 450,           // πιο μεγάλο γιατί ο χώρος είναι εκτεταμένος
  },
  caveOfLakes: {           // Σπήλαιο των Λιμνών
    lat: 37.96057577148243,
    lon: 22.140337167466512,
    radius: 250,
  },
  vouraikosGorge: {        // Φαράγγι του Βουραϊκού
    lat: 38.06087873699804,
    lon: 22.155548799403732,
    radius: 600,           // μεγάλο σημείο ενδιαφέροντος
  },
  moniMakellarias: {       // Ιερά Μονή Μακελλαριάς
    lat: 38.098775060646396,
    lon: 21.981152497039083,
    radius: 250,
  },
  pyrgosPetmezaion: {      // Πύργος Πετμεζαίων
    lat: 37.99362366520894,
    lon: 22.14033075470718,
    radius: 180,
  },
  kapi: {                  // Τόπος Θυσίας / Λόφος του Καπί (άφησα κι αυτό)
    lat: 38.0405,
    lon: 22.1082,
    radius: 250,
  },
};

// ---- Handler ----
export async function POST(req) {
  let payload = {};
  try { payload = await req.json(); } catch { /* noop */ }

  const uid       = payload?.uid;
  const lat       = Number(payload?.lat);
  const lon       = Number(payload?.lon);
  const checkpoint= String(payload?.checkpoint || "").trim();
  const questId   = String(payload?.questId || "").trim();

  if (!uid || !Number.isFinite(lat) || !Number.isFinite(lon) || !checkpoint || !questId) {
    return new Response(
      JSON.stringify({ error: "uid, lat, lon, checkpoint, questId required" }),
      { status: 400 }
    );
  }

  const target = TARGETS[checkpoint];
  if (!target) {
    return new Response(JSON.stringify({ error: "unknown checkpoint" }), { status: 400 });
  }

  const distance = haversine({ lat, lon }, target);
  const inside = distance <= (target.radius || 200);

  if (!inside) {
    // Εκτός ζώνης — δεν μαρκάρουμε πρόοδο
    return new Response(
      JSON.stringify({
        ok: false,
        checkpoint,
        distance: Math.round(distance),     // σε μέτρα
        radius: target.radius,
      }),
      { status: 200 }
    );
  }

  // Εντός ζώνης — μαρκάρουμε πρόοδο
  const u = getUser(uid);
  u.progress[questId] = true;
  setUser(uid, u);

  return new Response(
    JSON.stringify({
      ok: true,
      checkpoint,
      distance: Math.round(distance),
      radius: target.radius,
      ...summary(uid),
    }),
    { status: 200 }
  );
}
