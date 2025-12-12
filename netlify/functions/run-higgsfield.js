// netlify/functions/run-higgsfield.js
// Node16-safe (no global fetch needed). Uses https requests internally.
// Only targeted change vs your original: ensure params.prompt and motions[*].strength are present.
// Everything else (naming, route, behavior) preserved.

const https = require("https");
const { URL } = require("url");

const HF_URL = "https://platform.higgsfield.ai/v1/image2video/dop";
const HF_KEY = process.env.HF_API_KEY || "";
const HF_SECRET = process.env.HF_SECRET || "";

const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROFILES_URL  = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";
const COST_CREDITS  = 7;

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return ok({});
    if (event.httpMethod !== "POST")   return err(405, "Method Not Allowed");

    if (!HF_KEY || !HF_SECRET) {
      return ok({ submitted:false, error:"missing_env", reason:"Missing HF_API_KEY or HF_SECRET" });
    }

    const body = safeJson(event.body);
    const uid       = String(body.uid || body.user_id || "").trim();
    const motion_id = String(body.motion_id || "").trim();
    const imageUrl  = normalizeUrl(body.imageUrl || body.fileUrl || "");
    const prompt    = typeof body.prompt === "string" ? body.prompt : "";

    const strength  = typeof body.motion_strength === "number"
      ? Math.max(0, Math.min(1, body.motion_strength))
      : 0.7;

    if (!uid)       return ok({ submitted:false, error:"missing_user_id" });
    if (!motion_id) return ok({ submitted:false, error:"missing_motion_id" });
    if (!imageUrl)  return ok({ submitted:false, error:"missing_image_url" });

    const run_id = String(body.run_id || `${uid}-${Date.now()}`);

    // Seed/patch user_generations (processing), guarded if envs missing
    await upsertGen(uid, { run_id, status:"processing", provider:"higgsfield", model:"dop-turbo", motion_id });

    const hfPayload = {
      params: {
        model: "dop-turbo",
        prompt, // ensure present
        motions: [{ id: motion_id, strength }], // ensure strength present
        input_images: [{ type: "image_url", image_url: imageUrl }],
        input_images_end: [],
        enhance_prompt: true
      }
    };

    const hfResp = await postJson(HF_URL, hfPayload, {
      "Content-Type": "application/json",
      "hf-api-key": HF_KEY,
      "hf-secret": HF_SECRET
    });

    if (hfResp.statusCode < 200 || hfResp.statusCode >= 300) {
      return ok({
        submitted:false,
        error:`hf_${hfResp.statusCode}`,
        reason: hfResp.json?.detail || hfResp.json || hfResp.text,
        sent: hfPayload
      });
    }

    const data = hfResp.json || safeJson(hfResp.text);
    const jobSetId = extractJobSetId(data);
    if (!jobSetId) {
      return ok({ submitted:false, error:"missing_job_set_id", data, sent: hfPayload });
    }

    // update record with job_set_id
    await upsertGen(uid, { run_id, status:"processing", provider:"higgsfield", model:"dop-turbo", motion_id, job_set_id: jobSetId });


    // Charge credits (Kling 2.6-style: server-side only, idempotent by run_id)
    const charge = await maybeChargeCredits(uid, run_id, COST_CREDITS);
    if (charge && charge.insufficient) {
      await upsertGen(uid, { run_id, status:"failed", provider:"higgsfield", model:"dop-turbo", motion_id, job_set_id: jobSetId, error:"insufficient_credits" });
      return ok({ submitted:false, error:"insufficient_credits", needed: COST_CREDITS });
    }

    return ok({ submitted:true, run_id, job_set_id: jobSetId, data, charged: !!(charge && charge.charged) });
  } catch (e) {
    return ok({ submitted:false, error:"exception", reason: String(e && e.message ? e.message : e) });
  }
};

async function upsertGen(uid, meta){
  try{
    if (!UG_URL || !SERVICE_KEY) return;
    // Try update; if none, insert
    const selectQ = `${UG_URL}?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(meta.run_id)}&select=id`;
    const chk = await getJson(selectQ, { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` });
    if (Array.isArray(chk.json) && chk.json.length){
      await patchJson(`${UG_URL}?id=eq.${encodeURIComponent(chk.json[0].id)}`, { meta }, {
        "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}`, "Prefer": "return=minimal"
      });
    } else {
      await postJson(UG_URL, { user_id: uid, provider:"higgsfield", kind:"video", prompt:null, result_url:null, meta }, {
        "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}`, "Prefer": "return=minimal"
      });
    }
  }catch{}
}


async function maybeChargeCredits(uid, run_id, cost){
  try{
    if (!PROFILES_URL || !UG_URL || !SERVICE_KEY) return { charged:false, reason:"missing_service" };

    // Find generation row by run_id
    const q = `${UG_URL}?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id,meta`;
    const chk = await getJson(q, sbHeaders());
    const row = Array.isArray(chk.json) && chk.json.length ? chk.json[0] : null;
    if (!row) return { charged:false, reason:"no_gen_row" };

    const meta0 = row.meta || {};
    if (meta0.charged === true) return { charged:false, already:true };

    // Claim charging (best-effort idempotency)
    const claim = String(meta0.charge_claim || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    if (!meta0.charge_claim){
      await patchJson(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}`, {
        meta: { ...meta0, charge_claim: claim, charge_amount: cost, charge_claim_at: new Date().toISOString() }
      }, { ...sbHeaders(), "Prefer":"return=minimal" });
    }

    // Re-check after claim
    const chk2 = await getJson(q, sbHeaders());
    const row2 = Array.isArray(chk2.json) && chk2.json.length ? chk2.json[0] : null;
    const meta = row2?.meta || {};
    if (meta.charged === true) return { charged:false, already:true };
    if (meta.charge_claim && meta.charge_claim !== claim) return { charged:false, reason:"claimed_by_other" };

    // Read credits
    const pr = await getJson(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(uid)}&select=credits`, sbHeaders());
    const cur = (Array.isArray(pr.json) && pr.json.length) ? Number(pr.json[0].credits) : NaN;
    const credits = Number.isFinite(cur) ? cur : 0;

    if (credits < cost){
      await patchJson(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}`, {
        meta: { ...meta, charged:false, charge_failed:true, charge_failed_reason:"insufficient_credits", needed: cost, credits_at_charge: credits }
      }, { ...sbHeaders(), "Prefer":"return=minimal" });
      return { charged:false, insufficient:true, credits };
    }

    const newCredits = credits - cost;

    // Update credits
    const upd = await patchJson(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(uid)}`, { credits: newCredits }, { ...sbHeaders(), "Prefer":"return=representation" });
    if (upd.statusCode < 200 || upd.statusCode >= 300){
      await patchJson(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}`, {
        meta: { ...meta, charged:false, charge_failed:true, charge_failed_reason:"credits_update_failed", credits_at_charge: credits }
      }, { ...sbHeaders(), "Prefer":"return=minimal" });
      return { charged:false, reason:"credits_update_failed" };
    }

    // Mark charged
    await patchJson(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}`, {
      meta: { ...meta, charged:true, charged_amount: cost, charged_at: new Date().toISOString(), credits_before: credits, credits_after: newCredits }
    }, { ...sbHeaders(), "Prefer":"return=minimal" });

    return { charged:true, credits_before: credits, credits_after: newCredits };
  }catch(e){
    return { charged:false, reason:"exception", error: String(e && e.message ? e.message : e) };
  }
}

function sbHeaders(){
  return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` };
}


// ---------- tiny https helpers (no external deps) ----------
function httpRequest(method, urlStr, headers, body){
  const url = new URL(urlStr);
  const opts = {
    method,
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: url.pathname + (url.search || ""),
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
function postJson(url, obj, headers){
  return httpRequest("POST", url, { ...(headers||{}), "Content-Type": "application/json" }, JSON.stringify(obj));
}
function patchJson(url, obj, headers){
  return httpRequest("PATCH", url, { ...(headers||{}), "Content-Type": "application/json" }, JSON.stringify(obj));
}
function getJson(url, headers){
  return httpRequest("GET", url, headers || {});
}

// ---------- utils ----------
function ok(obj){ return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(code, message){ return { statusCode: code, headers: cors(), body: JSON.stringify({ submitted:false, error: message }) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization, X-USER-ID" }; }
function safeJson(s){ try{ return JSON.parse(s || "{}"); } catch { return null; } }
function normalizeUrl(u){ try{ const url = new URL(String(u||"")); return url.href; } catch { return ""; } }
function extractJobSetId(data){
  if (!data || typeof data !== "object") return "";
  if (data.id) return String(data.id);
  if (data.data?.id) return String(data.data.id);
  return "";
}
