import crypto from "node:crypto";
import { authenticateRequest } from "../../lib/sales-agent/auth.mjs";

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || "";
const BUCKET = process.env.KIE_HISTORY_BUCKET || "generation-history";
const MAX_BYTES = 500 * 1048576;
const buckets = new Map();
const sb = () => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` });
const objectPath = (uid, id) => `${uid}/caption-studio/${id}.mp4`;
const encode = (path) => path.split("/").map(encodeURIComponent).join("/");

// Saves an exported Caption Studio video to the user's generations.
// "start" hands out a one-time upload URL, so the video goes straight to storage;
// "finish" checks the upload landed and adds the generations row.
export default async function handler(request) {
  const json = (status, data) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (request.method !== "POST") return json(405, { error: "Use POST." });
  try {
    const user = await authenticateRequest({ headers: Object.fromEntries(request.headers) });
    if (!user) return json(401, { error: "Sign in to save to your generations." });
    if (!SUPABASE_URL || !SERVICE_KEY) return json(503, { error: "Saving is not available right now." });
    const body = await request.json().catch(() => ({}));

    if (body.action === "start") {
      const size = Number(body.size);
      if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) return json(400, { error: "Videos up to 500 MB can be saved." });
      const now = Date.now();
      for (const [id, b] of buckets) if (now - b.start > 3600000) buckets.delete(id);
      const bucket = buckets.get(user.id) || { start: now, count: 0 };
      if (bucket.count >= 20) return json(429, { error: "Too many saves this hour. Try again later." });
      bucket.count++;
      buckets.set(user.id, bucket);
      const id = crypto.randomUUID();
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${encodeURIComponent(BUCKET)}/${encode(objectPath(user.id, id))}`, {
        method: "POST",
        headers: { ...sb(), "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.url) return json(502, { error: "Could not start the upload." });
      return json(200, { id, uploadUrl: `${SUPABASE_URL}/storage/v1${data.url}` });
    }

    if (body.action === "finish") {
      const id = String(body.id || "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "Unknown upload." });
      const url = `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${encode(objectPath(user.id, id))}`;
      const head = await fetch(url, { method: "HEAD" });
      if (!head.ok) return json(409, { error: "The upload did not finish." });
      const name = String(body.name || "").trim().slice(0, 100) || "Caption Studio video";
      const seconds = Number(body.seconds);
      const r = await fetch(`${SUPABASE_URL}/rest/v1/user_generations`, {
        method: "POST",
        headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal,resolution=ignore-duplicates" },
        body: JSON.stringify({
          id,
          user_id: user.id,
          provider: "Hansora Captions",
          kind: "video",
          prompt: name,
          result_url: url,
          meta: { source: "caption-studio", status: "completed", title: name, duration: Number.isFinite(seconds) ? Math.round(seconds * 10) / 10 : null },
        }),
      });
      if (!r.ok) return json(502, { error: "Could not add it to your generations." });
      return json(200, { ok: true, url });
    }

    return json(400, { error: "Unknown action." });
  } catch (error) {
    return json(error.status || 500, { error: error.status === 401 ? "Sign in to save to your generations." : "Could not save right now." });
  }
}
