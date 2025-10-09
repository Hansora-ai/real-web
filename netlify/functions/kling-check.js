// netlify/functions/kling-check.js
// Robust poller for KIE/Kling jobs. Tries multiple KIE endpoints (GET + POST)
// and extracts mp4 URLs from any shape (resultUrls/jsonUrl/resultJson/nested).
// Public contract preserved: GET ?id=<taskId>&uid=<uid>&run_id=<run_id>[&debug=1]

const VERSION_TAG = "kling-check-robust-2025-10-09+v5-meta-run_id-fallback";

const KIE_BASE = (process.env.KIE_BASE_URL || "https://api.kie.ai").replace(/\/+$/,'');
const KIE_KEY  = process.env.KIE_API_KEY || "";

const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-USER-ID"
  };
}
function json(code, obj){
  return { statusCode: code, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
function kieHeaders() {
  const h = { "Accept": "application/json" };
  if (KIE_KEY) h["Authorization"] = `Bearer ${KIE_KEY}`;
  return h;
}
function sb() { return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }

function isUrl(u){ return typeof u === "string" && /^https?:\/\//i.test(u); }
function isMp4(u){ return isUrl(u) && /\.mp4(\?|#|$)/i.test(u); }

function collect(x, out){
  if (x == null) return;
  if (typeof x === "string") {
    const m = x.match(/https?:\/\/[^\s"'<>]+/ig);
    if (m) for (const u of m) out.push(u);
    return;
  }
  if (Array.isArray(x)) { for (const v of x) collect(v, out); return; }
  if (typeof x === "object") { for (const v of Object.values(x)) collect(v, out); return; }
}
function collectUrls(x){
  const a = []; collect(x, a);
  const seen = new Set(), out=[];
  for (const u of a){ if (isUrl(u) && !seen.has(u)) { seen.add(u); out.push(u); } }
  return out;
}

// parse json-ish content that might contain the mp4 url
function firstMp4FromJsonish(x){
  try{
    if (typeof x === "string"){
      const s = x.trim();
      if (isMp4(s)) return s;
      try { x = JSON.parse(s); } catch { /* not JSON */ }
    }
    if (Array.isArray(x)){
      for (const v of x){ if (isMp4(v)) return v; }
    } else if (x && typeof x === "object"){
      // common keys
      const keys = ["url","result_url","video_url","download_url","mp4","file","href"];
      for (const k of keys){
        const v = x[k];
        if (isMp4(v)) return v;
      }
      // nested scan
      const urls = collectUrls(x);
      for (const u of urls){ if (isMp4(u)) return u; }
    }
  }catch{}
  return "";
}

async function fetchJsonAny(method, url, body) {
  try{
    const r = await fetch(url, { method, headers: { ...kieHeaders(), ...(method==="POST" ? {"Content-Type":"application/json"} : {}) }, body: body ? JSON.stringify(body) : undefined });
    const txt = await r.text();
    let data;
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    return { ok: r.ok, status: r.status, data, text: txt };
  }catch(e){
    return { ok:false, status: 0, error: String(e && e.message || e) };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok:true });
  const qs = event.queryStringParameters || {};
  const debug = qs.debug === "1" || qs.debug === "true";

  try{
    const taskId = (qs.id || qs.taskId || qs.taskid || "").toString().trim();
    const uid    = (qs.uid || "").toString().trim();
    const run_id = (qs.run_id || qs.runId || "").toString().trim();
    if (!taskId) return json(400, { ok:false, error:"missing taskId", version: VERSION_TAG });

    // Try multiple endpoints (GET + POST) to dodge Kling/Sora endpoint differences
    const attempts = [
      { m:"GET",  u:`${KIE_BASE}/api/v1/jobs/getTask?taskId=${encodeURIComponent(taskId)}` },
      { m:"POST", u:`${KIE_BASE}/api/v1/jobs/getTask`, body:{ taskId } },
      { m:"GET",  u:`${KIE_BASE}/api/v1/jobs/getTaskResult?taskId=${encodeURIComponent(taskId)}` },
      { m:"GET",  u:`${KIE_BASE}/api/v1/jobs/getResult?taskId=${encodeURIComponent(taskId)}` },
      { m:"GET",  u:`${KIE_BASE}/api/v1/jobs/getTaskDetails?taskId=${encodeURIComponent(taskId)}` },
    ];

    const tries = [];
    let video_url = "";
    let lastStatus = null;
    let lastData   = null;

    for (const t of attempts){
      const r = await fetchJsonAny(t.m, t.u, t.body);
      tries.push({ url: t.u, method: t.m, status: r.status, ok: r.ok });
      lastStatus = r.status; lastData = r.data;

      // pull direct mp4s
      const urls = collectUrls(r.data);
      for (const u of urls){ if (isMp4(u)) { video_url = u; break; } }
      if (video_url) break;

      // fallbacks via known keys
      const k1 = r.data && (r.data.jsonurl || r.data.jsonUrl || r.data.json_url || r.data.result?.jsonurl || r.data.result?.jsonUrl || r.data.data?.jsonurl || r.data.data?.jsonUrl);
      const k2 = r.data && (r.data.resultJson || r.data.data?.resultJson || r.data.result?.resultJson);
      const hit1 = firstMp4FromJsonish(k1);
      const hit2 = firstMp4FromJsonish(k2);
      if (hit1) { video_url = hit1; break; }
      if (hit2) { video_url = hit2; break; }

      // If jsonurl points to a JSON file, fetch it and scan too
      if (!video_url && typeof k1 === "string" && /^https?:\/\//i.test(k1)) {
        const r2 = await fetch(k1).then(res => res.text()).catch(()=>null);
        if (r2){
          try{
            const j = JSON.parse(r2);
            const v = firstMp4FromJsonish(j) || "";
            if (v) { video_url = v; break; }
            const u2 = collectUrls(j).find(isMp4);
            if (u2) { video_url = u2; break; }
          }catch{/* not json */}
        }
      }
      // continue to next attempt
    }

    // Normalize output
    const out = {
      ok: !!video_url,
      status: video_url ? "succeeded" : "pending",
      state: video_url ? "succeeded" : "pending",
      video_url: video_url || "",
      result_url: video_url || "",
      version: VERSION_TAG
    };

    // Debug info
    if (!video_url && debug) {
      out.debug = {
        lastStatus,
        sampleUrlsFromLast: collectUrls(lastData || {}).slice(0,6),
        attempts: tries
      };
    }

    // ---------- Supabase fallback (UPDATED) ----------
    // Try BOTH shapes:
    //  A) by explicit columns: user_id & run_id
    //  B) by JSON meta->>run_id (this matches your Sora flow)
    if (!video_url && SUPABASE_URL && SERVICE_KEY && uid && run_id) {
      try{
        // A) direct columns
        const ugA = `${SUPABASE_URL}/rest/v1/user_generations?user_id=eq.${encodeURIComponent(uid)}&run_id=eq.${encodeURIComponent(run_id)}&select=result_url,meta`;
        let rA = await fetch(ugA, { headers: sb() });
        let arrA = rA.ok ? await rA.json() : [];

        // B) JSON meta->>run_id
        let arrB = [];
        if (!arrA || !arrA.length) {
          const ugB = `${SUPABASE_URL}/rest/v1/user_generations?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=result_url,meta`;
          const rB = await fetch(ugB, { headers: sb() });
          arrB = rB.ok ? await rB.json() : [];
        }

        const candidate = (arrA && arrA[0]) || (arrB && arrB[0]) || null;
        if (candidate && typeof candidate.result_url === "string" && candidate.result_url){
          out.ok = true;
          out.status = "succeeded";
          out.state  = "succeeded";
          out.video_url = candidate.result_url;
          out.result_url = candidate.result_url;
        }
      }catch{}
    }

    // If we got a URL, backfill Supabase result_url/status
    if (out.ok && SUPABASE_URL && SERVICE_KEY) {
      try{
        // find row id by uid + (run_id column) OR meta->>run_id
        let idToPatch = null;

        // 1) columns
        const q1 = `${SUPABASE_URL}/rest/v1/user_generations?user_id=eq.${encodeURIComponent(uid)}&run_id=eq.${encodeURIComponent(run_id)}&select=id`;
        const r1 = await fetch(q1, { headers: sb() });
        if (r1.ok){
          const rows = await r1.json();
          if (Array.isArray(rows) && rows[0] && rows[0].id) idToPatch = rows[0].id;
        }
        // 2) json meta->>run_id
        if (!idToPatch) {
          const q2 = `${SUPABASE_URL}/rest/v1/user_generations?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
          const r2 = await fetch(q2, { headers: sb() });
          if (r2.ok){
            const rows2 = await r2.json();
            if (Array.isArray(rows2) && rows2[0] && rows2[0].id) idToPatch = rows2[0].id;
          }
        }

        const payload = { result_url: out.video_url, meta: { status: "done", task_id: taskId, engine: "kling", run_id } };
        if (idToPatch){
          await fetch(`${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(idToPatch)}`, {
            method: "PATCH",
            headers: { ...sb(), "Content-Type": "application/json", "Prefer":"return=minimal" },
            body: JSON.stringify(payload)
          });
        } else {
          await fetch(`${SUPABASE_URL}/rest/v1/user_generations`, {
            method: "POST",
            headers: { ...sb(), "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: uid, run_id, result_url: out.video_url, meta: payload.meta })
          });
        }
      }catch{}
    }

    return json(200, out);

  }catch(e){
    return json(200, { ok:false, error:String(e && e.message || e), version: VERSION_TAG });
  }
};
