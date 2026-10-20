'use strict';
const base = () => (process.env.REAPI_BASE_URL || 'https://reapi.ai/api/v1').replace(/\/+$/, '');
const headers = () => ({ Authorization: `Bearer ${process.env.REAPI_API_KEY || ''}`, 'Content-Type': 'application/json' });
function taskId(data) {
  const id = data?.id || data?.task_id;
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(id) ? id : null;
}
async function submit(payload) {
  // reAPI has no submit idempotency key. Never retry this POST automatically.
  const res = await fetch(`${base()}/videos/generations`, { method: 'POST', headers: headers(), body: JSON.stringify(payload), signal: AbortSignal.timeout(25000) });
  const data = await res.json().catch(() => null);
  const id = taskId(data);
  if (res.ok && id) return { id, data };
  const error = Error(data?.error?.message || data?.message || 'reAPI submission could not be confirmed.');
  // Only definite validation/auth/balance/rate-limit rejections can be refunded
  // immediately. A timeout, malformed response or 5xx may have created a task.
  error.rejected = [400, 401, 402, 403, 413, 422, 429].includes(res.status);
  error.status = error.rejected ? 422 : 502;
  throw error;
}
async function state(id, expectedModel) {
  if (!process.env.REAPI_API_KEY) throw Error('reAPI is not configured.');
  const res = await fetch(`${base()}/tasks/${encodeURIComponent(id)}`, { headers: headers(), signal: AbortSignal.timeout(25000) });
  if (!res.ok) return { pending: true };
  const data = await res.json();
  if (taskId(data) !== id || data.model !== expectedModel) return { pending: true };
  if (data.status === 'failed') return { failed: true, error: data.error?.message || 'Generation failed.', code: data.error?.code };
  const urls = Array.isArray(data.output?.video_urls) ? data.output.video_urls.filter(url => typeof url === 'string' && /^https:\/\//.test(url)) : [];
  if (data.status === 'completed' && urls.length) return { done: true, urls: urls.slice(0, 1), usage: data.usage, lastFrame: data.output.last_frame_url };
  return { pending: true, valid: true };
}
module.exports = { submit, state, taskId };
