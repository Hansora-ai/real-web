// netlify/functions/rv-check.js
// Poll Runway (KIE) task status for video, and backfill DB when mp4 is ready.
// - GET params: taskId, uid, run_id
// - Returns: { ok:true, status:'success', video_url, thumb_url? }
// - Backfills: user_generations (and nb_results for compatibility) if env present.

const KIE_BASE = (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/+$/,'');
const KIE_KEY  = process.env.KIE_API_KEY;

const SUPABASE_URL  = process.env.SUPABASE_URL || '';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : '';
const TABLE_URL     = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/nb_results` : '';

const ALLOWED = new Set(['tempfile.aiquickdraw.com','tempfile.redpandaai.co']);

const VERSION_TAG = 'rv_check_v2';

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
    if (event.httpMethod !== 'GET') return json(405, { ok:false, error:'Use GET' });

    const taskId = (event.queryStringParameters?.taskId || '').trim();
    const uid    = (event.queryStringParameters?.uid || '').trim();
    const run_id = (event.queryStringParameters?.run_id || '').trim();
    if (!taskId) return json(200, { ok:false, status:'pending', note:'missing taskId' });

    const url = `${KIE_BASE}/api/v1/runway/record-detail?taskId=${encodeURIComponent(taskId)}`;
    const r   = await fetch(url, { headers: kieHeaders() });
    const txt = await r.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

    // Collect URLs and pick first mp4 + optional jpg
    const list = collectUrls(data);
    let video_url = '', thumb_url = '';
    for (const u of list) {
      if (!isAllowed(u)) continue;
      if (!video_url && /\.mp4(\?|#|$)/i.test(u)) video_url = u;
      else if (!thumb_url && /\.(jpg|jpeg|png)(\?|#|$)/i.test(u)) thumb_url = u;
    }

    if (!video_url) return json(200, { ok:false, status:'pending', version: VERSION_TAG });

    // Backfill (avoid duplicates; patch by id if exists)
    await backfill(uid, run_id, taskId, video_url, thumb_url).catch(()=>{});

    return json(200, { ok:true, status:'success', video_url, thumb_url, version: VERSION_TAG });

  } catch (e) {
    return json(200, { ok:false, error:String(e), version: VERSION_TAG });
  }
};

async function backfill(uid, run_id, taskId, video_url, thumb_url){
  if (!(SUPABASE_URL && SERVICE_KEY)) return;

  // user_generations
  try {
    const q = `${UG_URL}?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}`;
    const chk = await fetch(q + '&select=id', { headers: sb() });
    const arr = await chk.json().catch(()=>[]);
    const idToPatch = Array.isArray(arr) && arr.length ? arr[0].id : null;
    const body = {
      user_id: uid || '00000000-0000-0000-0000-000000000000',
      provider: 'runway',
      type: 'video',
      result_url: video_url,
      thumb_url: thumb_url || null,
      meta: { run_id, task_id: taskId, status: 'done' }
    };
    await fetch(UG_URL + (idToPatch ? `?id=eq.${idToPatch}` : ''), {
      method: idToPatch ? 'PATCH' : 'POST',
      headers: { ...sb(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify(idToPatch ? { result_url: video_url, thumb_url: body.thumb_url, meta: body.meta } : body)
    });
  } catch {}

  // nb_results (compat / optional)
  try {
    if (!TABLE_URL) return;
    await fetch(TABLE_URL, {
      method: 'POST',
      headers: { ...sb(), 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{
        user_id: uid || '00000000-0000-0000-0000-000000000000',
        run_id,
        task_id: taskId,
        image_url: video_url // stored as URL even if mp4
      }])
    });
  } catch {}
}

// helpers
function cors(){ return { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,OPTIONS', 'Access-Control-Allow-Headers':'*' }; }
function json(code, obj){ return { statusCode: code, headers: { ...cors(), 'Content-Type':'application/json' }, body: JSON.stringify(obj) }; }
function kieHeaders(){ return { 'Authorization': `Bearer ${KIE_KEY}`, 'Accept': 'application/json' }; }
function sb(){ return { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }; }
function isUrl(u){ return typeof u === 'string' && /^https?:\/\//i.test(u); }
function host(u){ try{ return new URL(u).hostname; } catch { return ''; } }
function isAllowed(u){ if (!isUrl(u)) return false; return ALLOWED.has(host(u)); }
function collect(x, out){
  if (!x) return;
  if (typeof x === 'string'){ const m = x.match(/https?:\/\/[^" '\s]+/i); if (m) out.push(m[0]); return; }
  if (Array.isArray(x)){ for (const v of x) collect(v, out); return; }
  if (typeof x === 'object'){ for (const v of Object.values(x)) collect(v, out); return; }
}
function collectUrls(x){ const a=[]; collect(x,a); const seen=new Set(), out=[]; for(const u of a){ if(isUrl(u) && !seen.has(u)){ seen.add(u); out.push(u); } } return out; }
