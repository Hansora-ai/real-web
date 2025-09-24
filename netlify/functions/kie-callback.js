// netlify/functions/kie-callback.js
import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // --- parse query + body ----------------------------------------------------
  const { searchParams } = new URL(req.url);
  const qs_uid   = searchParams.get("uid");
  const qs_runid = searchParams.get("run_id") || searchParams.get("runId") || searchParams.get("rid");

  let text = "";
  try { text = await req.text(); } catch {}
  const ct = (req.headers.get("content-type") || "").toLowerCase();

  let payload = {};
  if (text) {
    if (ct.includes("application/json")) { try { payload = JSON.parse(text); } catch {} }
    if (!Object.keys(payload).length && ct.includes("application/x-www-form-urlencoded")) {
      payload = Object.fromEntries(new URLSearchParams(text).entries());
      // Some providers stick nested JSON in a field; try to parse shallowly if present
      for (const k of Object.keys(payload)) {
        if (typeof payload[k] === "string" && payload[k].startsWith("{")) {
          try { payload[k] = JSON.parse(payload[k]); } catch {}
        }
      }
    }
  }

  // --- figure out ids --------------------------------------------------------
  const meta = payload?.meta || payload?.metadata || payload?.data?.meta || {};
  const user_id = meta?.uid ?? meta?.user_id ?? meta?.userId ?? qs_uid ?? "00000000-0000-0000-0000-000000000000";
  const run_id  = meta?.run_id ?? meta?.runId ?? meta?.rid ?? qs_runid ?? null;
  const task_id = payload?.taskId ?? payload?.id ?? payload?.data?.taskId ?? payload?.data?.id ?? null;

  // --- collect input URLs so we can exclude them -----------------------------
  const inputSet = new Set();
  const addIn = (u) => { if (u && typeof u === "string") inputSet.add(u); };
  const addInArr = (arr) => { if (Array.isArray(arr)) arr.forEach(addIn); };

  addInArr(payload?.input?.image_urls);
  addInArr(payload?.data?.input?.image_urls);
  addInArr(payload?.image_urls);
  addInArr(payload?.data?.image_urls);

  // --- pick output URL, preferring result/output fields ----------------------
  const candidates = [];
  const pushOut = (u) => {
    if (!u || typeof u !== "string") return;
    if (!/\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(u)) return;
    if (inputSet.has(u)) return;              // exclude inputs
    candidates.push(u);
  };

  // Prefer known output shapes first
  pushOut(payload?.result?.imageUrl);
  (payload?.result?.images || []).forEach(x => pushOut(x?.url));
  (payload?.output || []).forEach(x => pushOut(x?.url || (typeof x === "string" ? x : null)));
  (payload?.data?.result?.images || []).forEach(x => pushOut(x?.url));
  pushOut(payload?.data?.imageUrl);
  (payload?.images || []).forEach(x => pushOut(x?.url || (typeof x === "string" ? x : null)));

  // As a fallback, scan the raw text (outputs usually come after inputs)
  if (text) {
    const m = text.match(/https?:\/\/[^\s"']+/g);
    if (m) m.forEach(pushOut);
  }

  // Prefer the last candidate (outputs often appear later in payload/log)
  const image_url = candidates.length ? candidates[candidates.length - 1] : null;

  if (!run_id) return new Response("OK (missing run_id)", { status: 200 });

  // --- write to Supabase -----------------------------------------------------
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
