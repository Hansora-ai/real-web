// netlify/functions/kie-callback.js
import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const KIE_API_KEY = process.env.KIE_API_KEY;

// try multiple result endpoints (KIE isn't consistent)
const RESULT_URLS = [
  (id) => `https://api.kie.ai/api/v1/jobs/getTaskResult?taskId=${id}`,
  (id) => `https://api.kie.ai/api/v1/jobs/result?taskId=${id}`,
  (id) => `https://api.kie.ai/api/v1/jobs/getTask?taskId=${id}`,
];

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // uid/run_id can be passed in the query string
  const url = new URL(req.url);
  const qs_uid = url.searchParams.get("uid");
  const qs_run = url.searchParams.get("run_id");

  // read body as text, then try JSON; if not, try form-encoded
  let payload = null;
  const raw = await req.text();
  try {
    payload = JSON.parse(raw);
  } catch {
    try {
      const form = new URLSearchParams(raw);
      payload = {};
      for (const [k, v] of form.entries()) payload[k] = v;
    } catch {
      payload = { raw };
    }
  }

  const meta = payload?.meta || payload?.metadata || payload?.data?.meta || {};
  const user_id =
    qs_uid || meta?.uid || payload?.uid || payload?.user_id || null;
  const run_id =
    qs_run || meta?.run_id || payload?.run_id || payload?.data?.run_id || null;

  const taskId =
    payload?.taskId ||
    payload?.id ||
    payload?.data?.taskId ||
    payload?.data?.id ||
    null;

  // try to grab a final image URL directly from webhook
  let imageUrl =
    payload?.imageUrl ||
    payload?.outputUrl ||
    payload?.url ||
    payload?.result_url ||
    payload?.data?.imageUrl ||
    null;

  // common array shapes
  const candidates = [
    payload?.images,
    payload?.output,
    payload?.outputs,
    payload?.result,
    payload?.data?.images,
    payload?.data?.output,
    payload?.data?.outputs,
  ];
  if (!imageUrl) {
    for (const arr of candidates) {
      if (Array.isArray(arr) && arr[0]?.url) {
        imageUrl = arr[0].url;
        break;
      }
    }
  }

  // if webhook didn't include it, fetch the result from KIE by taskId
  if (!imageUrl && taskId && KIE_API_KEY) {
    for (const mk of RESULT_URLS) {
      try {
        const r = await fetch(mk(taskId), {
          headers: { Authorization: `Bearer ${KIE_API_KEY}` },
        });
        const t = await r.text();
        let j;
        try {
          j = JSON.parse(t);
        } catch {
          continue;
        }
        imageUrl =
          j?.imageUrl ||
          j?.outputUrl ||
          j?.url ||
          (Array.isArray(j?.images) && j.images[0]?.url) ||
          (Array.isArray(j?.output) && j.output[0]?.url) ||
          (Array.isArray(j?.outputs) && j.outputs[0]?.url) ||
          null;
        if (imageUrl) break;
      } catch {}
    }
  }

  if (!user_id || !run_id) {
    return new Response("Missing uid/run_id", { status: 400 });
  }

  // write one row per callback (even if imageUrl is still null)
  const insertBody = {
    user_id,
    run_id,
    task_id: taskId || null,
    image_url: imageUrl || null,
  };

  const ins = await fetch(`${SUPABASE_URL}/rest/v1/nb_results`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(insertBody),
  });

  if (!ins.ok) {
    const errTxt = await ins.text().catch(() => "");
    return new Response(`Supabase insert failed: ${errTxt}`, { status: 500 });
  }

  return new Response("OK", { status: 200 });
};
