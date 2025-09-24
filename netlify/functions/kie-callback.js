// netlify/functions/kie-callback.js
import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Helper to safely parse body as JSON or form
async function readBody(req) {
  const text = await req.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch {}
  try {
    // handle x-www-form-urlencoded
    const p = new URLSearchParams(text);
    const obj = {};
    for (const [k,v] of p.entries()) obj[k] = v;
    return obj;
  } catch {}
  return { raw: text };
}

// Try hard to find a final image URL (avoid input image_urls)
function extractImageUrl(p) {
  if (!p || typeof p !== "object") return null;
  const tryObj = (o) => {
    if (!o || typeof o !== "object") return null;
    if (typeof o.image_url === "string") return o.image_url;
    if (typeof o.output_url === "string") return o.output_url;
    if (typeof o.url === "string")        return o.url;
    if (Array.isArray(o.output) && o.output[0]?.url) return o.output[0].url;
    if (Array.isArray(o.images) && o.images[0]?.url) return o.images[0].url;
    return null;
  };

  // common places KIE-like payloads use
  return (
    tryObj(p) ||
    tryObj(p.data) ||
    tryObj(p.result) ||
    tryObj(p.results) ||
    tryObj(p.response) ||
    tryObj(p.output?.[0]) ||
    null
  );
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // read payload and query params
  let payload;
  try { payload = await readBody(req); }
  catch { return new Response("Bad Request", { status: 400 }); }

  const url = new URL(req.url);
  const qs_uid   = url.searchParams.get("uid")    || url.searchParams.get("user_id");
  const qs_run   = url.searchParams.get("run_id") || url.searchParams.get("runId");

  const meta     = payload?.meta || payload?.metadata || {};
  const user_id  = meta.uid || qs_uid || null;
  const run_id   = meta.run_id || meta.runId || qs_run || null;

  // If we still don't have identifiers, we can't bind it to the user/session
  if (!user_id || !run_id) {
    return new Response("Missing uid/run_id", { status: 400 });
  }

  // Pull a final image URL (do NOT fall back to input.image_urls)
  const image_url =
    extractImageUrl(payload) ??
    extractImageUrl(payload?.data) ??
    null;

  // We still insert even if image_url is null (lets you see a row + debug)
  const row = {
    user_id,
    run_id,
    task_id:
      payload?.taskId ||
      payload?.id ||
      payload?.data?.taskId ||
      payload?.data?.id ||
      null,
    image_url
  };

  // Insert into Supabase (service role)
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/nb_results`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Prefer": "return=representation"
      },
      body: JSON.stringify(row)
    });

    // If RLS/table misconfig, this will show you the error text
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return new Response(`Supabase insert failed: ${t}`, { status: 500 });
    }
  } catch (e) {
    return new Response(`Supabase error: ${String(e)}`, { status: 500 });
  }

  return new Response("OK", { status: 200 });
};
