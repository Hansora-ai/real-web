// netlify/functions/imagen-check.js
// Poll Replicate for a prediction id and return image_url when succeeded.

const BASE = (process.env.REPLICATE_BASE_URL || 'https://api.replicate.com/v1').replace(/\/+$/,'');
const TOKEN = process.env.REPLICATE_API_KEY;

function cors(){ return {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*"
}; }

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: cors(), body: "Use GET" };

  try{
    if (!TOKEN) return json(500, { ok:false, error:"Missing REPLICATE_API_KEY" });
    const qs = event.queryStringParameters || {};
    const id = (qs.id || qs.prediction_id || "").toString().trim();
    if (!id) return json(400, { ok:false, error:"missing id" });

    const url = `${BASE}/predictions/${encodeURIComponent(id)}`;
    const r = await fetch(url, {
      headers: { "Authorization": `Token ${TOKEN}`, "Accept": "application/json" }
    });

    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { j = { raw: txt }; }

    const status = String(j?.status || "").toLowerCase();
    if (status === "succeeded"){
      const out = Array.isArray(j?.output) ? j.output[0] : (j?.output || null);
      const image_url = (typeof out === 'string') ? out : (out && out.url) || null;
      return json(200, { ok:true, status, image_url, output: j.output });
    }
    if (status === "failed" || status === "canceled"){
      return json(200, { ok:false, status });
    }
    return json(200, { ok:false, status: status || "pending" });

  }catch(e){
    return json(200, { ok:false, error:String(e) });
  }
};

function json(code, obj){ return { statusCode: code, headers: { "Content-Type":"application/json", ...cors() }, body: JSON.stringify(obj) }; }
