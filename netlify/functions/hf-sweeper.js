// netlify/functions/hf-sweeper.js
/*
 HIGGSFIELD SWEEPER (NO‑WEBHOOK) — Finalize pending jobs server‑side
 Only processes rows for provider = "higgsfield".
 - Finds pending rows in Supabase (result_url IS NULL, provider='higgsfield').
 - Polls Higgsfield GET /v1/job-sets/{job_set_id}.
 - Writes result_url + status when ready.
 - Treats 'succeeded', 'completed', 'complete', 'done' (and any non-empty video_url) as success.
*/

const https = require("https");
const { URL } = require("url");

const HF_BASE   = "https://platform.higgsfield.ai";
const HF_KEY    = process.env.HF_API_KEY || "";
const HF_SECRET = process.env.HF_SECRET  || "";

const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

// Tunables
const MAX_BATCH = Number(process.env.HF_SWEEP_BATCH || 50);
const MAX_CONC  = Number(process.env.HF_SWEEP_CONC  || 10);
const nowSec = () => Math.floor(Date.now()/1000);

function reqJson(method, rawUrl, headers, bodyObj){
  const url = new URL(rawUrl);
  const payload = bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : null;
  const opts = {
    method,
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: url.pathname + (url.search||""),
    headers: {
      "Accept": "application/json",
      ...(payload ? { "Content-Type":"application/json", "Content-Length": String(payload.length) } : {}),
      ...(headers||{}),
    },
  };
  return new Promise((resolve, reject)=>{
    const req = https.request(opts, (res)=>{
      let data = [];
      res.on("data", (c)=>data.push(c));
      res.on("end", ()=>{
        const text = Buffer.concat(data).toString("utf8");
        let json = null; try { json = JSON.parse(text||"{}"); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function findPending(limit){
  const q = new URL(UG_URL);
  q.searchParams.set("select", "id,user_id,prompt,created_at,provider,meta");
  q.searchParams.set("result_url", "is.null");
  q.searchParams.set("provider", "eq.higgsfield"); // <— ONLY Higgsfield rows
  // If meta->>status exists and is 'succeeded', skip; else include.
  q.searchParams.append("or", `(meta->>status.neq.succeeded,meta->>status.is.null)`);
  q.searchParams.set("order", "created_at.asc");
  q.searchParams.set("limit", String(limit));

  const res = await reqJson("GET", q.href, {
    "apikey": SERVICE_KEY,
    "Authorization": `Bearer ${SERVICE_KEY}`
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`supabase_select_failed ${res.status}: ${res.text}`);
  return Array.isArray(res.json) ? res.json : [];
}

function extractJobSetId(meta){
  if (!meta) return "";
  return meta.job_set_id || meta.jobSetId || meta.id || "";
}
function extractBackoff(meta){
  const attempts = Number(meta?.attempts || 0);
  const next_check = Number(meta?.next_check || 0);
  return { attempts, next_check };
}
function nextCheck(attempts){
  const steps = [10, 20, 40, 60, 120, 300];
  const idx = Math.min(attempts, steps.length-1);
  return nowSec() + steps[idx];
}
function pickUrls(j){
  const v = j?.video_url || j?.data?.video_url || j?.output?.video_url || j?.output?.url || null;
  const t = j?.thumb_url || j?.data?.thumb_url || j?.output?.thumb_url || null;
  let status = j?.status || j?.data?.status || j?.state || (v ? "succeeded" : "processing");
  const s = String(status || "").toLowerCase();
  if (["done","completed","complete"].includes(s)) status = "succeeded";
  return { video_url: v, thumb_url: t, status };
}
async function getJob(job_set_id){
  const url = `${HF_BASE}/v1/job-sets/${encodeURIComponent(job_set_id)}`;
  return await reqJson("GET", url, { "hf-api-key": HF_KEY, "hf-secret": HF_SECRET });
}
async function patchRow(id, patch){
  const url = new URL(UG_URL);
  url.searchParams.set("id", `eq.${id}`);
  return await reqJson("PATCH", url.href, {
    "apikey": SERVICE_KEY,
    "Authorization": `Bearer ${SERVICE_KEY}`,
    "Prefer": "return=minimal"
  }, patch);
}
async function mapLimit(items, limit, worker){
  const out = [];
  let i = 0, active = 0;
  return await new Promise((resolve)=>{
    const next = ()=>{
      if (i >= items.length && active === 0) return resolve(out);
      while (active < limit && i < items.length){
        const idx = i++; active++;
        Promise.resolve(worker(items[idx], idx))
          .then(v=>{ out[idx]=v; active--; next(); })
          .catch(()=>{ active--; next(); });
      }
    };
    next();
  });
}

exports.handler = async (event)=>{
  try{
    if (!HF_KEY || !HF_SECRET || !UG_URL || !SERVICE_KEY) {
      return { statusCode: 500, body: JSON.stringify({ ok:false, error:"server_not_configured" }) };
    }

    const rows = (await findPending(MAX_BATCH)).filter(r => {
      const { next_check } = extractBackoff(r.meta || {});
      return !next_check || next_check <= nowSec();
    });

    if (!rows.length) return { statusCode: 200, body: JSON.stringify({ ok:true, checked:0, updated:0 }) };

    let updated = 0;
    await mapLimit(rows, MAX_CONC, async (row)=>{
      const meta = row.meta || {};
      const job_set_id = extractJobSetId(meta);
      if (!job_set_id){
        const patch = { meta: { ...meta, attempts:(meta.attempts||0)+1, next_check: nextCheck((meta.attempts||0)+1) } };
        await patchRow(row.id, patch);
        return;
      }

      const r = await getJob(job_set_id);
      if (r.status < 200 || r.status >= 300){
        const patch = { meta: { ...meta, attempts:(meta.attempts||0)+1, last_error:`hf_${r.status}`, next_check: nextCheck((meta.attempts||0)+1) } };
        await patchRow(row.id, patch);
        return;
      }

      const { video_url, thumb_url, status } = pickUrls(r.json || {});

      if (video_url || String(status).toLowerCase() === "succeeded"){
        const patch = { result_url: video_url || null, meta: { ...meta, status:"succeeded", video_url, thumb_url, attempts: 0, next_check: null } };
        await patchRow(row.id, patch);
        updated++;
        return;
      }

      if (String(status).toLowerCase() === "failed"){
        const reason = r.json?.error || r.json?.message || null;
        const patch = { meta: { ...meta, status:"failed", fail_reason: reason || "unknown", attempts: 0, next_check: null } };
        await patchRow(row.id, patch);
        updated++;
        return;
      }

      const patch = { meta: { ...meta, status:"processing", attempts:(meta.attempts||0)+1, next_check: nextCheck((meta.attempts||0)+1) } };
      await patchRow(row.id, patch);
    });

    return { statusCode: 200, body: JSON.stringify({ ok:true, checked: rows.length, updated }) };
  }catch(e){
    return { statusCode: 500, body: JSON.stringify({ ok:false, error:"exception", message: e?.message || String(e) }) };
  }
};
