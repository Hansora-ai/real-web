import { authenticateRequest } from "../../lib/sales-agent/auth.mjs";
import {
  createCaptionToken,
  elevenLabsKey,
} from "../../lib/caption-studio/elevenlabs.mjs";
import { captionCost } from "../../public/caption-studio/core.mjs";

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || "";
const PROFILES_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";
const MAX_SECONDS = 4 * 3600;
const buckets = new Map();
const sb = () => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` });

async function readCredits(uid) {
  const r = await fetch(`${PROFILES_URL}?select=credits&user_id=eq.${encodeURIComponent(uid)}`, { headers: sb() });
  if (!r.ok) throw Object.assign(Error("Could not read your credits."), { status: 502 });
  const rows = await r.json().catch(() => []);
  const credits = Number(rows?.[0]?.credits || 0);
  return Number.isFinite(credits) ? credits : 0;
}

// Debit only if the balance is still the one we read, so two requests cannot spend the same credits.
async function debit(uid, cost) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readCredits(uid);
    if (current < cost) return { ok: false, credits: current };
    const next = Math.round((current - cost) * 100) / 100;
    const r = await fetch(
      `${PROFILES_URL}?user_id=eq.${encodeURIComponent(uid)}&credits=eq.${current}`,
      {
        method: "PATCH",
        headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ credits: next }),
      },
    );
    if (!r.ok) throw Object.assign(Error("Could not charge credits."), { status: 502 });
    const rows = await r.json().catch(() => []);
    if (Array.isArray(rows) && rows.length) return { ok: true, credits: next };
  }
  throw Object.assign(Error("Your balance changed. Please try again."), { status: 409 });
}

export default async function handler(request) {
  const json = (status, data) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  if (request.method !== "POST") return json(405, { error: "Use POST." });
  try {
    const user = await authenticateRequest({ headers: Object.fromEntries(request.headers) });
    if (!user) return json(401, { error: "Sign in to generate captions." });
    const body = await request.json().catch(() => ({}));
    const seconds = Number(body.seconds);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_SECONDS)
      return json(400, { error: "Videos up to 4 hours can be captioned." });
    const now = Date.now();
    for (const [id, b] of buckets) if (now - b.start > 60000) buckets.delete(id);
    const bucket = buckets.get(user.id) || { start: now, count: 0 };
    if (bucket.count >= 5)
      return json(429, { error: "Please wait a minute before requesting more captions." });
    bucket.count++;
    buckets.set(user.id, bucket);
    if (!PROFILES_URL || !SERVICE_KEY) return json(503, { error: "Auto captions are not available right now." });
    const cost = captionCost(seconds);
    if ((await readCredits(user.id)) < cost)
      return json(402, { error: `Not enough credits. Auto captions for this video cost ${cost}⚡.`, cost });
    const token = await createCaptionToken({ apiKey: elevenLabsKey() });
    const charged = await debit(user.id, cost);
    if (!charged.ok)
      return json(402, { error: `Not enough credits. Auto captions for this video cost ${cost}⚡.`, cost });
    return json(200, { ...token, cost, credits: charged.credits });
  } catch (error) {
    return json(error.status || 500, {
      error: error.status === 401 ? "Sign in to generate captions." : error.message || "Could not start transcription.",
    });
  }
}
