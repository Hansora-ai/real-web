'use strict';
async function transition(action, id, uid, payload = {}) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${base}/rest/v1/rpc/reapi_generation_transition`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_action: action, p_id: id, p_user: uid, p_payload: payload }), signal: AbortSignal.timeout(25000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(Error(data.message === 'not_enough_credits' ? 'Not enough credits.' : 'Could not update generation billing. Check that the reAPI SQL migration is installed.'), { status: data.message === 'not_enough_credits' ? 402 : 503 });
  return data;
}
function callbackToken(uid,id) {
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!key)throw Error('Callback signing is not configured.');
  return require('node:crypto').createHmac('sha256',key).update(`reapi-callback-v1:${uid}:${id}`).digest('hex');
}
module.exports = { transition, callbackToken };
