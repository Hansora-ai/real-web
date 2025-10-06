// netlify/functions/hf-callback.js
// Higgsfield webhook receiver (Veo-style).
// - Reads ?run_id=&uid= from query string (Netlify style) with fallbacks
// - Optional secret check via HF_WEBHOOK_SECRET (if empty -> no check)
// - Extracts video_url/thumb_url from tolerant payload keys
// - Updates Supabase `user_generations` row: match by run_id, fallback job_set_id
// - Node16-safe: uses https helpers (no global fetch dependency)

const https = require("https");
const { URL } = require("url");

const HF_WEBHOOK_SECRET = process.env.HF_WEBHOOK_SECRET || ""; // OPTIONAL
const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

// ----------------------- handler -----------------------
exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return ok({});
    if (event.httpMethod !== "POST")   return err(405, "Method Not Allowed");

    // Optional secret verification (only if provided)
    if (HF_WEBHOOK_SECRET) {
      const sent = event.headers["x-hf-signature"] || event.headers["x-hf-secret"];
      if (!sent || String(sent).trim() !== HF_WEBHOOK_SECRET) {
        return err(401, "Invalid webhook secret");
      }
    }

    const body = safeJson(event.body);

    // --- Robust query parsing (Netlify) ---
    let qp_run_id = "", qp_uid = "";
    try {
      if (event.queryStringParameters && typeof event.queryStringParameters === "object") {
        qp_run_id = (event.queryStringParameters.run_id || "").trim();
        qp_uid    = (event.queryStringParameters.uid || "").trim();
      } else if (event.rawUrl) {
        const u = new URL(event.rawUrl);
        qp_run_id = (u.searchParams.get("run_id") || "").trim();
        qp_uid    = (u.searchParams.get("uid") || "").trim();
      } else {
        const rawQS = event.rawQuery || event.rawQueryString || "";
        const qs = new URLSearchParams(rawQS);
        qp_run_id = (qs.get("run_id") || "").trim();
        qp_uid    = (qs.get("uid") || "").trim();
      }
    } catch {}

    // Provider payload (tolerant extraction)
    const job_id     = String(body?.id || body?.job_id || body?.data?.id || "").trim();
    const run_id     = String((qp_run_id || body?.metadata?.run_id || body?.run_id || "")).trim();
    const job_set_id = String(body?.job_set_id || body?.data?.job_set_id || "").trim();

    const video_url  = findFirstUrl(body, [
      "video_url","result_url","url","data.url","data.video_url","data.output.url"
    ]);
    const thumb_url  = findFirstUrl(body, [
      "thumb_url","thumbnail","poster","data.thumb_url","data.thumbnail","data.output.poster"
    ]);

    if (!UG_URL || !SERVICE_KEY) {
      return ok({ ok:false, reason:"missing_supabase_env" });
    }

    // Update record by run_id (preferred), fallback to job_set_id
    let updated = false;
    if (run_id) {
      const sel = await getJson(`${UG_URL}?select=id&meta->>run_id=eq.${encodeURIComponent(run_id)}`, sb());
      const rows = Array.isArray(sel.json) ? sel.json : [];
      if (rows.length) {
        await patchJson(`${UG_URL}?id=eq.${encodeURIComponent(rows[0].id)}`, {
          result_url: video_url || null,
          meta: { run_id, job_set_id, job_id, status: "succeeded", video_url, thumb_url }
        }, { ...sb(), "Prefer":"return=minimal", "Content-Type":"application/json" });
        updated = true;
      }
    }
    if (!updated && job_set_id) {
      const sel = await getJson(`${UG_URL}?select=id&meta->>job_set_id=eq.${encodeURIComponent(job_set_id)}`, sb());
      const rows = Array.isArray(sel.json) ? sel.json : [];
      if (rows.length) {
        await patchJson(`${UG_URL}?id=eq.${encodeURIComponent(rows[0].id)}`, {
          result_url: video_url || null,
          meta: { run_id, job_set_id, job_id, status: "succeeded", video_url, thumb_url }
        }, { ...sb(), "Prefer":"return=minimal", "Content-Type":"application/json" });
        updated = true;
      }
    }

    return ok({ ok:true, updated, run_id, job_set_id, video_url, thumb_url });
  } catch (e) {
    return ok({ ok:false, reason: String(e && e.message ? e.message : e) });
  }
};

// -------------------- helpers --------------------
function findFirstUrl(obj, keys){
  try {
    for (const k of keys) {
      const val = getPath(obj, k);
      if (val && /^https?:\/\//i.test(String(val))) return String(val);
    }
  } catch {}
  return "";
}
function getPath(o, p){
  try { return p.split(".").reduce((a, c) => (a && typeof a === "object" ? a[c] : undefined), o); }
  catch { return undefined; }
}

function httpRequest(method, urlStr, headers, body){
  const u = new URL(urlStr);
  const opts = {
    method,
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port || (u.protocol === "https:" ? 443 : 80),
    path: u.pathname + (u.search || ""),
    headers: headers || {}
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, text: data, json: safeJson(data) }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
function patchJson(url, obj, headers){
  return httpRequest("PATCH", url, { ...(headers||{}), "Content-Type": "application/json" }, JSON.stringify(obj));
}
function getJson(url, headers){
  return httpRequest("GET", url, headers || {});
}

function ok(obj){ return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(code, message){ return { statusCode: code, headers: cors(), body: JSON.stringify({ ok:false, error: message }) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization, X-USER-ID, x-hf-signature, x-hf-secret" }; }
function safeJson(s){ try { return JSON.parse(s || "{}"); } catch { return {}; } }
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }
