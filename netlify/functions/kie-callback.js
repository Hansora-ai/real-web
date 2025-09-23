// netlify/functions/kie-callback.js
import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let payload = null;
  try {
    const text = await req.text();
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // KIE payloads vary; extract the fields we sent in meta and the final URL.
  const meta = payload?.meta || payload?.data?.meta || {};
  const taskId = payload?.taskId || payload?.id || payload?.data?.taskId;
  const imageUrl =
    payload?.imageUrl ||
    payload?.outputUrl ||
    payload?.url ||
    payload?.data?.imageUrl ||
    (Array.isArray(payload?.images) && payload.images[0]?.url) ||
    (Array.isArray(payload?.output) && payload.output[0]?.url) ||
    null;

  const user_id = meta.uid;
  const run_id  = meta.run_id;

  if (!user_id || !run_id) {
    // We require both to bind the result to the right user/session.
    return new Response("Missing uid/run_id", { status: 400 });
  }

  // Insert into Supabase (service role)
  const insertBody = {
    user_id,
    run_id,
    task_id: taskId || null,
    image_url: imageUrl || null
  };

  const r = await fetch(`${SUPABASE_URL}/rest/v1/nb_results`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Prefer": "return=representation"
    },
    body: JSON.stringify(insertBody)
  });

  if (!r.ok) {
    const errTxt = await r.text().catch(() => "");
    return new Response(`Supabase insert failed: ${errTxt}`, { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
