// netlify/functions/kie-callback.js
// Robust KIE → Supabase callback: parses varied payloads, extracts image URL, inserts row.

import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Read raw body and try to parse JSON
  let text;
  try {
    text = await req.text();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }

  // ---- Extract meta (uid/run_id) sent from the create call
  const meta =
    payload?.meta ||
    payload?.metadata ||
    payload?.data?.meta ||
    {};

  const user_id =
    meta?.uid ?? meta?.user_id ?? meta?.userId ?? "anon";

  const run_id =
    meta?.run_id ?? meta?.runId ?? meta?.rid ?? null;

  // ---- Extract task id (optional)
  const task_id =
    payload?.taskId ??
    payload?.id ??
    payload?.data?.taskId ??
    payload?.data?.id ??
    payload?.result?.taskId ??
    null;

  // ---- Extract final image URL (handles many possible shapes)
  const urlCandidates = [];

  const push = (u) => {
    if (u && typeof u === "string") urlCandidates.push(u);
  };

  // common fields
  push(payload?.imageUrl);
  push(payload?.outputUrl);
  push(payload?.url);
  push(payload?.data?.imageUrl);

  // arrays of images/outputs in various wrappers
  if (Array.isArray(payload?.images)) {
    payload.images.forEach(x => push(x?.url || x));
  }
  if (Array.isArray(payload?.output)) {
    payload.output.forEach(x => push(x?.url || x));
  }
  if (Array.isArray(payload?.result?.images)) {
    payload.result.images.forEach(x => push(x?.url || x));
  }
  if (Array.isArray(payload?.data?.images)) {
    payload.data.images.forEach(x => push(x?.url || x));
  }

  // fallback: scan any URLs in the raw text
  const urlRegex = /https?:\/\/[^\s"']+/g;
  let m;
  while ((m = urlRegex.exec(text)) !== null) {
    urlCandidates.push(m[0]);
  }

  // prefer obvious image links
  const image_url =
    urlCandidates.find(u => /\.(png|jpg|jpeg|webp|gif)(\?|#|$)/i.test(u)) ||
    urlCandidates[0] ||
    null;

  // If we somehow don't have run_id, keep 200 so KIE doesn't retry forever.
  if (!run_id) {
    return new Response("OK (missing run_id)", { status: 200 });
  }

  // Insert into Supabase (service role)
  const row = { user_id, run_id, task_id, image_url };

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

    // Always return 200 to KIE. Include insert response for debugging.
    const respText = await r.text().catch(() => "");
    if (!r.ok) {
      return new Response(`OK (insert_failed) ${respText}`, { status: 200 });
    }
    return new Response("OK", { status: 200 });
  } catch (e) {
    // Still 200 so KIE considers callback delivered
    return new Response(`OK (insert_exception) ${String(e)}`, { status: 200 });
  }
};
