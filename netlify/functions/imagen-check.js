// netlify/functions/imagen-check.js
// Poll Replicate for a prediction id and return image_url when succeeded.
// Minimal addition: when succeeded, backfill a row in public.user_generations
// so the result appears on the Usage page. This mirrors Nano Banana's "backfill"
// behavior but does not add any placeholder insert.

const BASE = (process.env.REPLICATE_BASE_URL || 'https://api.replicate.com/v1').replace(/\/+$/,'');
const TOKEN = process.env.REPLICATE_API_KEY;

const SUPABASE_URL  = process.env.SUPABASE_URL || '';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function cors(){ return {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*"
}; }

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: cors(), body: "Use GET" };

  try{
    const qs = event.queryStringParameters || {};
    const id = (qs.id || '').trim();
    const uid = (qs.uid || '').trim();      // user id (uuid) coming from the page
    const run_id = (qs.run_id || '').trim();// client-generated run id

    if (!id) return json(400, { ok:false, error:"Missing id" });
    if (!TOKEN) return json(200, { ok:false, error:"Missing REPLICATE_API_KEY" });

    // 1) fetch prediction from Replicate
    const pred = await fetch(`${BASE}/predictions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    const j = await pred.json();

    const status = String(j.status || '').toLowerCase();
    if (status === "succeeded"){
      // Replicate outputs can be string URL(s) or objects with url fields or arrays
      let image_url = null;
      const out = j.output;
      if (Array.isArray(out)){
        // Prefer first url-ish element
        const first = out[0];
        image_url = typeof first === 'string' ? first : (first && first.url) || null;
      } else {
        image_url = typeof out === 'string' ? out : (out && out.url) || null;
      }

      // 2) Best-effort backfill Usage in Supabase (if we know the user)
      if (SUPABASE_URL && SERVICE_KEY && uid){
        try {
          const ug = `${SUPABASE_URL.replace(/\/+$/,'')}/rest/v1/user_generations`;

          // Build meta we want to persist
          const meta = {
            provider: 'imagen',
            source: 'imagen',
            run_id: run_id || null,
            prediction_id: id,
            model: j.model || (j.input && j.input.model) || null,
            aspect_ratio: (j.input && (j.input.aspect_ratio || j.input.size)) || null,
            status: 'succeeded'
          };

          const prompt = (j.input && j.input.prompt) || null;
          const providerLabel = (j.input && j.input.model === 'ultra') ? 'Imagen Ultra' :
                                (j.input && j.input.model === 'fast')  ? 'Imagen Fast'  :
                                'Imagen';

          // Try to UPDATE existing placeholder (match by user_id + meta->>run_id)
          let updated = false;
          if (run_id){
            const patch = await fetch(`${ug}?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}`, {
              method: 'PATCH',
              headers: {
                'apikey': SERVICE_KEY,
                'Authorization': `Bearer ${SERVICE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
              },
              body: JSON.stringify({ result_url: image_url, provider: providerLabel, kind: 'image', prompt, meta })
            });
            if (patch.ok){
              const arr = await patch.json().catch(()=>[]);
              updated = Array.isArray(arr) && arr.length > 0;
            }
          }

          if (!updated){
            // INSERT a fresh row
            await fetch(ug, {
              method: 'POST',
              headers: {
                'apikey': SERVICE_KEY,
                'Authorization': `Bearer ${SERVICE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({
                user_id: uid,
                provider: providerLabel,
                kind: 'image',
                prompt,
                result_url: image_url,
                meta
              })
            });
          }
        } catch (e) {
          console.warn('[imagen-check] usage backfill failed', e);
        }
      }

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
