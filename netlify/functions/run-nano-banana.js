// netlify/functions/kie-callback.js
import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // ---- parse query + body (JSON or x-www-form-urlencoded)
  const { searchParams } = new URL(req.url);
  const qs_uid   = searchParams.get("uid");
  const qs_runid = searchParams.get("run_id") || searchParams.get("runId") || searchParams.get("rid");

  let text = "";
  try { text = await req.text(); } catch {}

  const ct = (req.headers.get("content-type") || "").toLowerCase();
  let payload = {};
  if (text) {
    if (ct.includes("application/json")) {
      try { payload = JSON.parse(text); } catch {}
    }
    if (!Object.keys(payload).length && ct.includes("application/x-www-form-urlencoded")) {
      payload = Object.fromEntries(new URLSearchParams(text).entries());
      // some providers nest json inside fields; shallow-parse if possible
      for (const k of Object.keys(payload)) {
        if (typeof payload[k] === "string" && payload[k].startsWith("{")) {
          try { payload[k] = JSON.parse(payload[k]); } catch {}
        }
      }
    }
  }

  // ---- ids
  const meta = payload?.meta || payload?.metadata || payload?.data?.meta || {};
  const user_id = meta?.uid ?? meta?.user_id ?? meta?.userId ?? qs_uid ?? "00000000-0000-0000-0000-000000000000";
  const run_id  = meta?.run_id ?? meta?.runId ?? meta?.rid ?? qs_runid ?? null;
  const task_id = payload?.taskId ?? payload?.id ?? payload?.data?.taskId ?? payload?.data?.id ?? null;

  if (!run_id) return new Response("OK (missing run_id)", { status: 200 });

  // ---- collect INPUT urls to exclude (your uploads / origin)
  const inputSet = new Set();
  const addIn = (u) => { if (u && typeof u === "string") inputSet.add(u); };
  const addInArr = (arr) => { if (Array.isArray(arr)) arr.forEach(addIn); };

  addInArr(payload?.input?.image_urls);
  addInArr(payload?.data?.input?.image_urls);
  addInArr(payload?.image_urls);
  addInArr(payload?.data?.image_urls);
  addInArr(payload?.originUrls);
  addInArr(payload?.data?.originUrls);
  addInArr(payload?.data?.info?.originUrls);

  // helper: push candidate output urls
  const outs = [];
  const pushOut = (u) => {
    if (!u || typeof u !== "string") return;
    if (!/^https?:\/\//.test(u)) return;
    if (!/\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(u)) return;
    if (inputSet.has(u)) return;
    if (/user-uploads|upload|input/i.test(u)) return;
    outs.push(u);
  };
  const pushArr = (arr) => { if (Array.isArray(arr)) arr.forEach(x => pushOut(x?.url || (typeof x === "string" ? x : null))); };

  // ---- prefer known image result locations (Nano Banana callbacks vary)
  // 1) resultUrls under data/info (mirroring Veo-style but used by some image jobs too)
  pushArr(payload?.data?.info?.resultUrls);
  pushArr(payload?.data?.resultUrls);
  pushArr(payload?.resultUrls);

  // 2) images/output arrays
  pushArr(payload?.result?.images);
  pushArr(payload?.data?.result?.images);
  pushArr(payload?.images);
  pushArr(payload?.data?.images);
  pushArr(payload?.output);
  pushArr(payload?.data?.output);

  // 3) single fields
  pushOut(payload?.imageUrl);
  pushOut(payload?.outputUrl);
  pushOut(payload?.data?.imageUrl);
  pushOut(payload?.data?.outputUrl);

  // 4) last-resort: scan text for any URLs (outputs usually appear later in the payload/log)
  if (!outs.length && text) {
    const m = text.match(/https?:\/\/[^\s"'<>]+/g);
    if (m) m.forEach(pushOut);
  }

  // prefer the last candidate (often the final output)
  const image_url = outs.length ? outs[outs.length - 1] : null;

  // ---- insert into Supabase (service role bypasses RLS)
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/nb_results`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Prefer": "return=representation"
      },
      body: JSON.stringify({ user_id, run_id, task_id, image_url })
    });
    const t = await r.text().catch(() => "");
    if (!r.ok) return new Response(`OK (insert_failed) ${t}`, { status: 200 });
    return new Response("OK", { status: 200 });
  } catch (e) {
    return new Response(`OK (insert_exception) ${String(e)}`, { status: 200 });
  }
};
