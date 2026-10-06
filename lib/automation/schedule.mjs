// Is this call Netlify's scheduler (or our own internal call)? Netlify documents a JSON body with "next_run" for
// scheduled runs; some runtimes also send an x-nf-event: schedule header. Either is accepted. Netlify does not let a
// scheduled function be called through its URL, and these jobs only ever process work that is already due.
export function isScheduledRun(event = {}) {
  const header = String(event.headers?.['x-nf-event'] || event.headers?.['X-Nf-Event'] || event.headers?.['X-NF-Event'] || '');
  if (header === 'schedule') return true;
  try { const body = JSON.parse(event.isBase64Encoded ? Buffer.from(String(event.body || ''), 'base64').toString('utf8') : String(event.body || '')); return Boolean(body && typeof body.next_run === 'string' && body.next_run); } catch (_) { return false; }
}
export function isInternalCall(event = {}) {
  const internal = String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET || '');
  const provided = String(event.headers?.['x-hansora-internal-secret'] || event.headers?.['X-Hansora-Internal-Secret'] || '');
  return internal.length >= 32 && provided === internal;
}
