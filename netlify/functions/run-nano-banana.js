// netlify/functions/run-nano-banana.js
// Nano Banana (KIE) launcher with server-side credit debit (idempotent per run_id).
// Client must NOT debit credits. Credits are charged only here using SUPABASE_SERVICE_ROLE_KEY.
//
// Env: KIE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Opt: KIE_BASE_URL, SITE_BASE
//
const KIE_BASE = (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/+$/, '');
const KIE_KEY  = process.env.KIE_API_KEY || '';
const SUPABASE_URL  = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SITE_BASE_ENV = (process.env.SITE_BASE || '').replace(/\/+$/,'');
const VERSION_TAG  = "nb_fn_idempotent_v3";

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function getHeader(event, name) {
  const h = event.headers || {};
  const key = Object.keys(h).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : '';
}

function getBaseFromEvent(event) {
  const proto = (getHeader(event, 'x-forwarded-proto') || 'https').split(',')[0].trim() || 'https';
  const host  = (getHeader(event, 'x-forwarded-host') || getHeader(event, 'host') || '').split(',')[0].trim();
  if (!host) return SITE_BASE_ENV || '';
  return `${proto}://${host}`;
}

function safeJsonParse(s) {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}

async function supaFetch(path, opts = {}) {
  const url = `${SUPABASE_URL}${path}`;
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    ...opts.headers,
  };
  return fetch(url, { ...opts, headers });
}

async function fetchUserGenByRunId(uid, run_id) {
  if (!SUPABASE_URL || !SERVICE_KEY || !uid || !run_id) return null;
  const q = new URLSearchParams();
  q.set('user_id', `eq.${uid}`);
  q.set('provider', `eq.nano-banana`);
  // PostgREST JSON path filter: meta->>run_id
  q.set('meta->>run_id', `eq.${run_id}`);
  q.set('select', 'id,status,result_url,meta,created_at');
  const r = await supaFetch(`/rest/v1/user_generations?${q.toString()}`, { method: 'GET' });
  if (!r.ok) return null;
  const arr = await r.json().catch(() => null);
  return (Array.isArray(arr) && arr[0]) ? arr[0] : null;
}

async function seedUserGeneration(uid, run_id, prompt) {
  if (!SUPABASE_URL || !SERVICE_KEY || !uid || !run_id) return null;
  const meta = {
    source: 'nano-banana',
    run_id,
    model: 'nano-banana',
    status: 'pending',
    charged: "false", // store as string for reliable meta->>charged filter
    version: VERSION_TAG,
  };
  const r = await supaFetch(`/rest/v1/user_generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: uid,
      provider: 'nano-banana',
      kind: 'image',
      prompt: prompt || null,
      status: 'pending',
      result_url: null,
      meta,
    }),
  });
  if (!r.ok) return null;
  const arr = await r.json().catch(() => null);
  return (Array.isArray(arr) && arr[0]) ? arr[0] : null;
}

async function claimChargeByRowId(rowId) {
  // Atomically flip meta.charged from "false" to "true".
  // If another invocation already claimed, this returns {claimed:false}.
  if (!SUPABASE_URL || !SERVICE_KEY || !rowId) return { claimed: false };
  const claim_id = crypto.randomUUID();
  const q = new URLSearchParams();
  q.set('id', `eq.${rowId}`);
  q.set('meta->>charged', 'eq.false');
  const r = await supaFetch(`/rest/v1/user_generations?${q.toString()}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      meta: {
        charged: "true",
        charge_claim_id: claim_id,
        charge_claimed_at: new Date().toISOString(),
        version: VERSION_TAG,
      }
    }),
  });
  if (!r.ok) return { claimed: false };
  const arr = await r.json().catch(() => null);
  const claimed = Array.isArray(arr) && arr.length > 0;
  return { claimed, claim_id };
}

async function debitCredits(uid, cost) {
  if (!SUPABASE_URL || !SERVICE_KEY || !uid) return { ok: false, error: 'missing_env_or_uid' };
  const costNum = Number(cost);
  if (!Number.isFinite(costNum) || costNum <= 0) return { ok: false, error: 'invalid_cost' };

  // Read credits
  const q = new URLSearchParams();
  q.set('user_id', `eq.${uid}`);
  q.set('select', 'credits');
  const r0 = await supaFetch(`/rest/v1/profiles?${q.toString()}`, { method: 'GET' });
  if (!r0.ok) return { ok: false, error: 'profile_read_failed', status: r0.status };
  const arr = await r0.json().catch(() => null);
  const credits = Number(arr && arr[0] ? arr[0].credits : NaN);
  if (!Number.isFinite(credits)) return { ok: false, error: 'credits_missing' };
  if (credits < costNum) return { ok: false, error: 'not_enough_credits', credits };

  const newCredits = Math.round((credits - costNum) * 10) / 10;

  // Update with optimistic check to reduce double-debit risk further.
  // Only update if credits still equals previous credits.
  const q2 = new URLSearchParams();
  q2.set('user_id', `eq.${uid}`);
  q2.set('credits', `eq.${credits}`);
  const r1 = await supaFetch(`/rest/v1/profiles?${q2.toString()}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ credits: newCredits }),
  });
  if (!r1.ok) {
    return { ok: false, error: 'profile_update_failed', status: r1.status };
  }
  return { ok: true, credits_before: credits, credits_after: newCredits };
}

exports.handler = async (event) => {
  // CORS preflight: NEVER charge
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  if (!KIE_KEY) return json(500, { ok:false, error:'missing_kie_api_key' });
  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { ok:false, error:'missing_supabase_env' });

  const body = safeJsonParse(event.body);
  const uid = (getHeader(event, 'x-user-id') || body.uid || '').trim();
  const run_id = (body.run_id || body.runId || '').trim() || crypto.randomUUID();
  const prompt = (body.prompt || '.').toString();
  const image_urls = Array.isArray(body.urls) ? body.urls : (Array.isArray(body.image_urls) ? body.image_urls : []);
  const format = (body.format || body.output_format || 'png').toString();
  const size = (body.size || body.image_size || 'auto').toString();
  const cost = 0.5;

  if (!uid) return json(401, { ok:false, error:'missing_uid' });
  if (!image_urls.length) return json(400, { ok:false, error:'missing_image_urls' });

  // Ensure a user_generations row exists
  let row = await fetchUserGenByRunId(uid, run_id);
  if (!row) row = await seedUserGeneration(uid, run_id, prompt);
  if (!row || !row.id) return json(500, { ok:false, error:'cannot_create_or_find_user_generation' });

  // If already charged, do not charge again
  const alreadyCharged = row.meta && (row.meta.charged === true || row.meta.charged === "true");
  let debit = { ok: true, skipped: true };

  if (!alreadyCharged) {
    const claim = await claimChargeByRowId(row.id);
    if (claim.claimed) {
      debit = await debitCredits(uid, cost);
      if (!debit.ok) {
        // Mark charge failed and flip charged back to false so user can retry safely.
        try {
          await supaFetch(`/rest/v1/user_generations?id=eq.${encodeURIComponent(row.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ meta: { charged: "false", charge_failed: true, charge_error: debit.error, version: VERSION_TAG } }),
          });
        } catch {}
        return json(402, { ok:false, error: debit.error, run_id, version: VERSION_TAG });
      }
    } else {
      // Another invocation claimed; treat as charged elsewhere
      debit = { ok: true, skipped: true, note: 'charge_claimed_elsewhere' };
    }
  }

  // Build callback URL (use actual host unless SITE_BASE is set)
  const siteBase = SITE_BASE_ENV || getBaseFromEvent(event);
  const callbackBase = `${siteBase.replace(/\/+$/,'')}/.netlify/functions/kie-callback`;
  const cb = `${callbackBase}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}&model=nano-banana`;

  // Create KIE task
  const payload = {
    model: 'google/nano-banana-edit',
    input: {
      prompt,
      image_urls,
      output_format: format,
      image_size: size,
    },
    webhook_url: cb,
    callbackUrl: cb,
  };

  const create = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const js = await create.json().catch(() => null);

  // KIE response handling (store task_id/status best-effort)
  const taskId = js && (js.task_id || js.taskId || js.data?.task_id || js.data?.taskId);
  const ok = create.ok && !!taskId;

  try {
    await supaFetch(`/rest/v1/user_generations?id=eq.${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: ok ? 'processing' : 'create_failed',
        meta: {
          source: 'nano-banana',
          run_id,
          model: 'nano-banana',
          status: ok ? 'processing' : 'create_failed',
          task_id: taskId || null,
          callback: cb,
          version: VERSION_TAG,
        },
      }),
    });
  } catch {}

  if (!ok) {
    return json(create.status || 500, { ok:false, error:'kie_create_failed', run_id, response: js, version: VERSION_TAG });
  }

  return json(200, {
    ok: true,
    submitted: true,
    run_id,
    task_id: taskId,
    cost,
    credits_before: debit.credits_before,
    credits_after: debit.credits_after,
    version: VERSION_TAG,
  }, { 'Access-Control-Allow-Origin': '*' });
};
