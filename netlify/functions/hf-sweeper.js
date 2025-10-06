// netlify/functions/hf-sweeper.js
/*
================================================================================
 HIGGSFIELD SWEEPER (NO‑WEBHOOK) — Finalize pending jobs server‑side
--------------------------------------------------------------------------------
 - Runs on a schedule (Netlify Scheduled Functions) or manual hit.
 - Finds pending rows in Supabase (result_url IS NULL, meta.status != 'succeeded').
 - For each row, calls Higgsfield GET /v1/job-sets/{job_set_id}.
 - If video_url exists → writes result_url + meta.status='succeeded' (+thumb_url).
 - If failed → writes meta.status='failed' (+reason).
 - If still running → backs off using meta.next_check (exponential backoff).
 - Safe under high traffic: batch, concurrency cap, and backoff.
 - No webhook required.
================================================================================
*/

const https = require("https");
const { URL } = require("url");

// ----- ENV -----
const HF_BASE   = "https://platform.higgsfield.ai";
const HF_KEY    = process.env.HF_API_KEY || "";
const HF_SECRET = process.env.HF_SECRET  || "";

const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

// ----- CONFIG -----
const MAX_BATCH = Number(process.env.HF_SWEEP_BATCH || 50);   // rows per sweep
const MAX_CONC  = Number(process.env.HF_SWEEP_CONC  || 10);   // concurrent HF fetches
const NOW_EPOCH = () => Math.floor(Date.now()/1000);

// ----- HTTP helpers -----
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

// ----- Supabase helpers -----
async function findPending(limit){
  const q = new URL(UG_URL);
  q.searchParams.set("select", "id,user_id,prompt,created_at,meta");
  q.searchParams.set("result_url", "is.null");
  q.searchParams.append("or", `(meta->>status.neq.succeeded,meta->>status.is.null)`);
  q.searchParams.set("order", "created_at.asc");
  q.searchParams.set("limit", String(limit));

  const res = await reqJson("GET", q.href, {
    "apikey": SERVICE_KEY,
    "Authorization": `Bearer ${SERVICE_KEY}`
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`supabase_select_failed ${res.status}: ${res.text}`);
  }

  const rows = Array.isArray(res.json) ? res.json : [];
  return rows;
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

function computeNextCheck(attempts){
  const steps = [10, 20, 40, 60, 120, 300];
  const idx = Math.min(attempts, steps.length-1);
  return Math.floor(Date.now()/1000) + steps[idx];
}

function pickUrls(j){
  const v = j?.video_url || j?.data?.video_url || j?.output?.video_url || j?.output?.url || null;
  const t = j?.thumb_url || j?.data?.thumb_url || j?.output?.thumb_url || null;
  const status = j?.status || j?.data?.status || j?.state || (v ? "succeeded" : "processing");
  const reason = j?.error || j?.message || null;
  return { video_url: v, thumb_url: t, status, reason };
}

async function getJob(job_set_id){
  const url = `${HF_BASE}/v1/job-sets/${encodeURIComponent(job_set_id)}`;
  const r = await reqJson("GET", url, { "hf-api-key": HF_KEY, "hf-secret": HF_SECRET });
  return r;
}

async function patchRow(id, patch){
  const url = new URL(UG_URL);
  url.searchParams.set("id", `eq.${id}`);
  const r = await reqJson("PATCH", url.href, {
    "apikey": SERVICE_KEY,
    "Authorization": `Bearer ${SERVICE_KEY}`,
    "Prefer": "return=minimal"
  }, patch);
  return r;
}

// ----- Concurrency limiter -----
async function mapLimit(items, limit, worker){
  const ret = [];
  let i = 0, active = 0;
  return await new Promise((resolve, reject)=>{
    const next = ()=>{
      if (i >= items.length && active === 0) return resolve(ret);
      while (active < limit && i < items.length){
        const idx = i++; active++;
        Promise.resolve(worker(items[idx], idx)).then((val)=>{
          ret[idx] = val;
          active--; next();
        }).catch(err=>{ active--; ret[idx] = { error: String(err) }; next(); });
      }
    };
    next();
  });
}

// ----- Handler -----
exports.handler = async (event)=>{
  try{
    if (!HF_KEY || !HF_SECRET || !UG_URL || !SERVICE_KEY) {
      return { statusCode: 500, body: JSON.stringify({ ok:false, error:"server_not_configured" }) };
    }

    const due = (await findPending(MAX_BATCH)).filter(row => {
      const { next_check } = extractBackoff(row.meta || {});
      return !next_check || next_check <= Math.floor(Date.now()/1000);
    });

    if (!due.length){
      return { statusCode: 200, body: JSON.stringify({ ok:true, checked:0, updated:0 }) };
    }

    let updated = 0;

    await mapLimit(due, MAX_CONC, async (row)=>{
      const meta = row.meta || {};
      const job_set_id = extractJobSetId(meta);
      if (!job_set_id) {
        const patch = { meta: { ...meta, attempts: (meta.attempts||0)+1, next_check: computeNextCheck((meta.attempts||0)+1) } };
        await patchRow(row.id, patch);
        return;
      }

      const r = await getJob(job_set_id);
      if (r.status < 200 || r.status >= 300) {
        const patch = { meta: { ...meta, attempts: (meta.attempts||0)+1, last_error:`hf_${r.status}`, next_check: computeNextCheck((meta.attempts||0)+1) } };
        await patchRow(row.id, patch);
        return;
      }

      const { video_url, thumb_url, status, reason } = pickUrls(r.json || {});

      if (status === "succeeded" && video_url){
        const patch = {
          result_url: video_url,
          meta: { ...meta, status, video_url, thumb_url, attempts: 0, next_check: null }
        };
        await patchRow(row.id, patch);
        updated++;
        return;
      }

      if (status === "failed"){
        const patch = {
          meta: { ...meta, status, fail_reason: reason || "unknown", attempts: 0, next_check: null }
        };
        await patchRow(row.id, patch);
        updated++;
        return;
      }

      const patch = { meta: { ...meta, status: "processing", attempts: (meta.attempts||0)+1, next_check: computeNextCheck((meta.attempts||0)+1) } };
      await patchRow(row.id, patch);
    });

    return { statusCode: 200, body: JSON.stringify({ ok:true, checked: due.length, updated }) };
  }catch(e){
    return { statusCode: 500, body: JSON.stringify({ ok:false, error:"exception", message: e?.message || String(e) }) };
  }
};
