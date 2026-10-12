import { authenticateRequest } from "../../lib/sales-agent/auth.mjs";
import {
  createCaptionToken,
  elevenLabsKey,
} from "../../lib/caption-studio/elevenlabs.mjs";
const buckets = new Map();
export default async function handler(request) {
  const json = (status, data) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  if (request.method !== "POST") return json(405, { error: "Use POST." });
  try {
    const user = await authenticateRequest({
      headers: Object.fromEntries(request.headers),
    });
    if (!user) return json(401, { error: "Sign in to generate captions." });
    const now = Date.now();
    for (const [id, b] of buckets)
      if (now - b.start > 60000) buckets.delete(id);
    const bucket = buckets.get(user.id) || { start: now, count: 0 };
    if (bucket.count >= 5)
      return json(429, {
        error: "Please wait a minute before requesting more captions.",
      });
    bucket.count++;
    buckets.set(user.id, bucket);
    return json(200, await createCaptionToken({ apiKey: elevenLabsKey() }));
  } catch (error) {
    return json(error.status || 500, {
      error:
        error.status === 401
          ? "Sign in to generate captions."
          : error.message || "Could not start transcription.",
    });
  }
}
