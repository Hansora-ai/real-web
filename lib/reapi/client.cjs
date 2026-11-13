'use strict';
const base = () => (process.env.REAPI_BASE_URL || 'https://reapi.ai/api/v1').replace(/\/+$/, '');
const headers = () => ({ Authorization: `Bearer ${process.env.REAPI_API_KEY || ''}`, 'Content-Type': 'application/json' });
function taskId(data) {
  const id = data?.id || data?.task_id;
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(id) ? id : null;
}
// reAPI passes on some upstream errors in Chinese (e.g. code 80007, the content filter). Users get them in English;
// English messages are kept as they are.
const CJK = /[\u3400-\u9fff]/;
function readableError(message, code) {
  const text = String(message || '');
  if (!CJK.test(text)) return text || 'Generation failed.';
  if (/裸露|色情|情色/.test(text)) return 'Blocked by the content filter: the prompt may contain nudity or sexual content. Nothing was charged. Please change the prompt and try again.';
  if (/违反|政策|安全|审核|敏感/.test(text) || Number(code) === 80007) return 'Blocked by the content filter: the image may violate the content policy. Nothing was charged. Please change the prompt or image and try again.';
  return 'Generation failed at the provider. Please try again.';
}
async function submit(payload) {
  // reAPI has no submit idempotency key. Never retry this POST automatically.
  const res = await fetch(`${base()}/videos/generations`, { method: 'POST', headers: headers(), body: JSON.stringify(payload), signal: AbortSignal.timeout(25000) });
  const data = await res.json().catch(() => null);
  const id = taskId(data);
  if (res.ok && id) return { id, data };
  const error = Error(readableError(data?.error?.message || data?.message || 'reAPI submission could not be confirmed.', data?.error?.code));
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
  if (data.status === 'failed') return { failed: true, error: readableError(data.error?.message, data.error?.code), code: data.error?.code };
  const urls = Array.isArray(data.output?.video_urls) ? data.output.video_urls.filter(url => typeof url === 'string' && /^https:\/\//.test(url)) : [];
  if (data.status === 'completed' && urls.length) return { done: true, urls: urls.slice(0, 1), usage: data.usage, lastFrame: data.output.last_frame_url };
  return { pending: true, valid: true };
}
// Images (GPT Image 2.6): the same task flow on /images/generations, with the result in output.image_urls.
async function submitImage(payload) {
  // No submit idempotency key either: never retry this POST automatically.
  const res = await fetch(`${base()}/images/generations`, { method: 'POST', headers: headers(), body: JSON.stringify(payload), signal: AbortSignal.timeout(25000) });
  const data = await res.json().catch(() => null);
  const id = taskId(data);
  if (res.ok && id) return { id, data };
  const error = Error(readableError(data?.error?.message || data?.message || 'reAPI submission could not be confirmed.', data?.error?.code));
  error.rejected = [400, 401, 402, 403, 413, 422, 429].includes(res.status);
  error.status = error.rejected ? 422 : 502;
  error.code = data?.error?.code;
  throw error;
}
async function imageState(id) {
  if (!process.env.REAPI_API_KEY) return { pending: true };
  try {
    const res = await fetch(`${base()}/tasks/${encodeURIComponent(id)}`, { headers: headers(), signal: AbortSignal.timeout(20000) });
    if (!res.ok) return { pending: true };
    const data = await res.json();
    if (taskId(data) !== id) return { pending: true };
    if (data.status === 'failed') return { failed: true, error: readableError(data.error?.message, data.error?.code), code: data.error?.code ?? null };
    const urls = Array.isArray(data.output?.image_urls) ? data.output.image_urls.filter((url) => typeof url === 'string' && /^https:\/\//.test(url)) : [];
    if (data.status === 'completed' && urls.length) return { done: true, urls: urls.slice(0, 10), usage: data.usage };
    return { pending: true };
  } catch {
    return { pending: true };
  }
}
module.exports = { submit, state, taskId, submitImage, imageState, readableError };
