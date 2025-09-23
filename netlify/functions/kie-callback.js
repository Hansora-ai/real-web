// netlify/functions/kie-callback.js
import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async (req) => {
  // Accept POST (and don't crash if someone GETs)
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const { searchParams } = new URL(req.url);
  const qs_uid   = searchParams.get("uid");
  const qs_runid = searchParams.get("run_id") || searchParams.get("runId") || searchParams.get("rid");

  // Read raw body
  let text = "";
  try { text = await req.text(); } catch { /* ignore */ }

  // Try to parse JSON; also handle form-encoded
  let payload = null;
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  if (text) {
    if (ct.includes("application/json")) {
      try { payload = JSON.parse(text); } catch { /* fall through */ }
    }
    if (!payload && ct.includes("application/x-www-form-urlencoded")) {
      const p = new URLSearchParams(text);
      payload = Object.fromEntries(p.entries());
    }
    if (!payload) payload = { raw: text };
  } else {
    payload = {};
  }

  // ----- Extract identifiers
  const meta =
    payload?.meta ||
    payload?.metadata ||
    payload?.data?.meta ||
    {};

  const user_id =
    meta?.uid ?? meta?.user_id ?? meta?.userId ?? qs_uid ?? null;

  const run_id =
    meta?.run_id ?? meta?.runId ?? meta?.rid ?? qs_runid ?? null;

  const task_id =
    payload?.taskId ?? payload?.id ?? payload?.data?.taskId ?? payload?.data?.id ?? null;

  // ----- Extract image URL from many possible shapes
  const urls = [];

  const push = (u) => { if (u && typeof u === "string") urls.push(u); };

  push(payload?.imageUrl);
  push(payload?.outputUrl);
  push(payload?.url);
  push(payload?.data?.imageUrl);

  const arrs = [
    payload?.images, payload?.output, payload?.result?.images, payload?.data?.images
  ];
  for (const a of arrs) {
    if (Array.isArray(a)) a.forEach(x => push(x?.url || (typeof x === "string" ? x : null)));
  }

  // Also scrape any URL from raw text as a last resort
  if (text) {
    const m = text.match(/https?:\/\/[^\s"']+/g);
    if (m) urls.push(...m);
  }

  const image_url =
    urls.find(u => /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(u)) || urls[0] || null;

  // If we don't have a run_id, we can't bind the row. Still 200 so KIE doesn't retry forever.
  if (!run_id) {
    return new Response("OK (missing run_id)", { status: 200 });
  }

  // Insert row using service key (bypasses RLS)
  const row = { user_id: user_id || "00000000-0000-0000-0000-000000000000", run_id, task_id, image_url };

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

    // Always return 200 to KIE
    const t = await r.text().catch(() => "");
    if (!r.ok) return new Response(`OK (insert_failed) ${t}`, { status: 200 });
    return new Response("OK", { status: 200 });
  } catch (e) {
    return new Response(`OK (insert_exception) ${String(e)}`, { status: 200 });
  }
};
