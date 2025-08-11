// In-memory "DB" (κρατιέται στη RAM του serverless runtime).
// Για production βάλε ένα πραγματικό DB (Upstash Redis, Supabase κ.λπ.)

export const QUESTS = {
  tier1: [
    { id: "t1_1", type: "photo",   label: "Photograph the central square of Kalavryta" },
    { id: "t1_2", type: "photo",   label: "Visit the Holocaust Museum" },
  ],
  tier2: [
    { id: "t2_1", type: "qr",      label: "Scan a QR code in shop X" },
    { id: "t2_2", type: "qr",      label: "Scan a QR code in shop Y" },
    { id: "t2_3", type: "geophoto",label: "Photograph the Hill of Kapi" },
  ],
};

const memory = {
  users: new Map(), // uid -> { progress: { questId: true }, tier: 1|2, email?:string }
};

export function getUser(uid) {
  if (!memory.users.has(uid)) {
    memory.users.set(uid, { progress: {}, tier: 1 });
  }
  return memory.users.get(uid);
}

export function setUser(uid, data) {
  memory.users.set(uid, data);
  return data;
}

// Helpers για λογική ανταμοιβών
export function summary(uid) {
  const u = getUser(uid);
  const doneTier1 = QUESTS.tier1.every(q => u.progress[q.id]);
  const doneTier2 = QUESTS.tier2.every(q => u.progress[q.id]);

  let rarity = "COMMON";
  if (doneTier1 && !doneTier2) rarity = "UNCOMMON";
  if (doneTier2) rarity = "RARE"; // Minimum
  // Bonus κλιμάκωση: πόσα tier2 έχουν γίνει;
  const tier2Count = QUESTS.tier2.filter(q => u.progress[q.id]).length;
  if (tier2Count >= 2) rarity = "ULTRA RARE";
  if (tier2Count === QUESTS.tier2.length) rarity = "LEGENDARY";

  return { tier: u.tier, progress: u.progress, rarity };
}
