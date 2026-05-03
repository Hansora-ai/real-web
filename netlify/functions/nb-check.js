      // do not early-return on pending/failed; try other endpoints
    } catch {}
  }

  if (sawSuccess && merged.length) {
    // Return a data shape that downstream understands (contains images array)
    return { ok: true, status: 'success', data: { images: merged } };
  }
  if (failed) {
    return { ok: false, status: 'failed', failed: true, error: extractError(failed), data: failed };
  }
  return { ok: false, status: 'pending' };
}

function normalizeStatus(d){
  const s = String(d?.status || d?.state || d?.result?.status || d?.data?.status || d?.data?.state || '').toLowerCase();
  if (['success','succeeded','completed','done'].includes(s)) return 'success';
  if (['failed','error','canceled','cancelled'].includes(s)) return 'failed';
  return 'pending';
}

function extractError(d){
  const msg =
    d?.error ||
    d?.message ||
    d?.msg ||
    d?.data?.error ||
    d?.data?.message ||
    d?.result?.error ||
    d?.result?.message ||
    d?.raw;
  if (typeof msg === 'string' && msg.trim()) return msg.slice(0, 500);
  try { return JSON.stringify(d).slice(0, 500); } catch {}
  return 'kie_failed';
}

function isUrl(x){ try { new URL(x); return true; } catch { return false; } }
function host(u){ try { return new URL(u).hostname; } catch { return ''; } }
function allowed(u){
  if (!isUrl(u)) return false;
  const h = host(u);
  if (!ALLOWED_HOSTS.has(h)) return false;
  if (!/\/(m|f|workers|r|h)\//i.test(u)) return false;
  return true;
}

function firstImageUrls(obj, limit=4){
  let acc = [];
  const cand = obj?.data?.result?.images || obj?.result?.images || obj?.data?.images || obj?.images;
  if (Array.isArray(cand)) acc = acc.concat(cand);

  (function walk(x){
    if (!x) return;
    if (typeof x === 'string'){
      const m = x.match(/https?:\/\/[^\s"']+/i);
      if (m) acc.push(m[0]);
    } else if (Array.isArray(x)) {
      for (const v of x) walk(v);
    } else if (typeof x === 'object') {
      for (const v of Object.values(x)) walk(v);
    }
  })(obj);

  const out = [];
  const seen = new Set();
  for (const it of acc){
    const u = typeof it === 'string' ? it : (it && it.url);
    if (u && allowed(u) && !seen.has(u)){
      seen.add(u);
      out.push(u);
      if (out.length >= limit) break;
    }
  }
  return out;
}

async function backfillAll({ uid, run_id, taskId, images }){
  if (!SUPABASE_URL || !SERVICE_KEY || !images?.length) return;
  const rows = images.slice(0,4).map(u => ({
    user_id: uid || '00000000-0000-0000-0000-000000000000',
    run_id:  run_id || null,
    task_id: taskId || null,
    image_url: u
  }));
  await fetch(`${SUPABASE_URL}/rest/v1/nb_results`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(rows)
  });
}

async function markFailedAndRefund({ uid, run_id, taskId, reason }){
  if (!SUPABASE_URL || !SERVICE_KEY) return { refunded:false };

  const row = await findGeneration({ uid, run_id, taskId });
  if (!row) return { refunded:false };

  const meta = row.meta || {};
  const now = new Date().toISOString();
  const refundAmount = Number(meta.charged_cost || meta.cost || 0) || 0;
  const failedMeta = {
    ...meta,
    status: 'failed',
    state: 'failed',
    fail_reason: reason || meta.fail_reason || 'kie_failed',
    failed_reason: reason || meta.failed_reason || 'kie_failed',
    failed_at: meta.failed_at || now
  };

  if (meta.refunded === true) {
    await patchGeneration(row.id, { meta: { ...failedMeta, refunded: true } });
    return { refunded:true, refund_amount: Number(meta.refund_amount || refundAmount || 0) };
  }

  if (refundAmount > 0 && row.user_id) {
    const claim = `rf_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const claimed = await claimRefund(row.id, { ...failedMeta, refund_claim: claim });
    if (!claimed) {
      return { refunded:false, refund_amount: 0 };
    }
    await refundCredits(row.user_id, refundAmount);
    await patchGeneration(row.id, {
      meta: {
        ...failedMeta,
        refunded: true,
        refund_amount: refundAmount,
        refunded_at: meta.refunded_at || now
      }
    });
    return { refunded:true, refund_amount: refundAmount };
  }

  await patchGeneration(row.id, { meta: failedMeta });
  return { refunded:false, refund_amount: 0 };
}

async function findGeneration({ uid, run_id, taskId }){
  const base = `${SUPABASE_URL}/rest/v1/user_generations`;
  const headers = sbHeaders();
  const queries = [];
  if (uid && run_id) queries.push(`user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}`);
  if (run_id) queries.push(`meta->>run_id=eq.${encodeURIComponent(run_id)}`);
  if (taskId) queries.push(`meta->>task_id=eq.${encodeURIComponent(taskId)}`);

  for (const q of queries) {
    const r = await fetch(`${base}?select=id,user_id,meta&${q}&order=created_at.desc&limit=1`, { headers });
    if (!r.ok) continue;
    const rows = await r.json().catch(()=>[]);
    if (Array.isArray(rows) && rows[0]) return rows[0];
  }
  return null;
}

async function patchGeneration(id, patch){
  await fetch(`${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify(patch)
  });
}

async function claimRefund(id, meta){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(id)}&meta->>refunded=is.null&meta->>refund_claim=is.null&select=id`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify({ meta })
  });
  const rows = await r.json().catch(()=>[]);
  return r.ok && Array.isArray(rows) && rows.length > 0;
}

async function refundCredits(userId, amount){
  const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_profile_credits`, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_user_id: userId, p_delta: amount })
  });
  if (rpc.ok) return;

  const prof = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=credits`, {
    headers: sbHeaders()
  });
  const rows = await prof.json().catch(()=>[]);
  const cur = Array.isArray(rows) && rows[0] && typeof rows[0].credits === 'number' ? rows[0].credits : 0;
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ credits: cur + amount })
  });
}

function sbHeaders(){
  return { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` };
}
