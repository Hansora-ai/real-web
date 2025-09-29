// netlify/functions/run-imagen.js
// Submit Replicate Imagen prediction (fast or ultra) and return the prediction id.
// 1:1 with working image logic: minimal fields, server-side debit according to model.

const BASE = (process.env.REPLICATE_BASE_URL || 'https://api.replicate.com/v1').replace(/\/+$/,'');
const TOKEN = process.env.REPLICATE_API_KEY;

const SUPABASE_URL  = process.env.SUPABASE_URL || '';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function cors(){ return {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-USER-ID, x-user-id"
}; }

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: "Use POST" };

  try{
    if (!TOKEN) return { statusCode: 500, headers: cors(), body: "Missing REPLICATE_API_KEY" };

    const body = JSON.parse(event.body || "{}");
    const prompt = (body.prompt || "").toString();
    const aspect_ratio = (body.aspect_ratio || "1:1").toString();
    const model = (body.model === 'ultra') ? 'ultra' : 'fast';
    const uid = event.headers["x-user-id"] || event.headers["X-USER-ID"] || "anon";
    const run_id = body.run_id || `${uid}-${Date.now()}`;

    if (!prompt) return json(400, { ok:false, error:"missing_prompt" });

    const endpoint = model === 'ultra'
      ? `${BASE}/models/google/imagen-4-ultra/predictions`
      : `${BASE}/models/google/imagen-4-fast/predictions`;

    const payload = {
      input: {
        prompt,
        aspect_ratio
      }
    };

    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Token ${TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { j = { raw: txt }; }

    // Extract prediction id
    const id = j?.id || j?.prediction?.id || j?.data?.id || null;

    // Server-side debit according to model (0.5 fast, 1 ultra)
    try{
      if (SUPABASE_URL && SERVICE_KEY && uid && uid !== 'anon') {
        const cost = model === 'ultra' ? 1.0 : 0.5;
        const profGet = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
        const r0 = await fetch(profGet, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
        const j0 = await r0.json();
        const c0 = (Array.isArray(j0) && j0[0] && j0[0].credits) || 0;
        const next = Math.max(0, c0 - cost);
        await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`, {
          method: 'PATCH',
          headers: {
            'apikey': SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ credits: next })
        });
      }
    }catch(e){ console.warn('[run-imagen] debit failed', e); }

    // Return created
    const code = (r.status >= 200 && r.status < 300) ? r.status : 200;
    return { statusCode: code, headers: { "Content-Type":"application/json", ...cors() }, body: JSON.stringify({ submitted:true, id }) };

  }catch(e){
    return { statusCode: 200, headers: { "Content-Type":"application/json", ...cors() }, body: JSON.stringify({ submitted:true, note:"exception", message:String(e) }) };
  }
};

function json(code, obj){ return { statusCode: code, headers: { "Content-Type":"application/json", ...cors() }, body: JSON.stringify(obj) }; }
