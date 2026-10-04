import { rows, serviceUpdate, supabaseRequest } from '../../lib/automation/db.mjs';
import { MEDIA_BUCKET } from '../../lib/automation/media.mjs';

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

// Photos, videos and voice notes customers sent are kept for a limited time (default 30 days), then deleted.
// The text (transcript or description) stays in the conversation. Runs once a day.
export async function handler(event) {
  const internal = String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET || '');
  const provided = String(event.headers?.['x-hansora-internal-secret'] || event.headers?.['X-Hansora-Internal-Secret'] || '');
  const scheduled = String(event.headers?.['x-nf-event'] || event.headers?.['X-Nf-Event'] || '') === 'schedule';
  if (!scheduled && !(internal.length >= 32 && provided === internal)) return json(401, { error: 'unauthorized' });
  const days = Math.max(1, Number(process.env.AUTOMATION_MEDIA_RETENTION_DAYS || 30));
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
  let removed = 0;
  try {
    const old = rows(await supabaseRequest(`/rest/v1/automation_messages?metadata->>media_path=not.is.null&occurred_at=lt.${encodeURIComponent(cutoff)}&select=id,metadata&order=occurred_at.asc&limit=500`));
    for (let index = 0; index < old.length; index += 100) {
      const batch = old.slice(index, index + 100);
      const response = await fetch(`${base}/storage/v1/object/${MEDIA_BUCKET}`, { method: 'DELETE', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: batch.map(row => row.metadata.media_path) }) });
      if (!response.ok) { console.error('media cleanup delete failed', { status: response.status }); continue; }
      for (const row of batch) {
        const { media_path: _path, media_mime: _mime, ...rest } = row.metadata || {};
        await serviceUpdate('automation_messages', `id=eq.${row.id}`, { metadata: { ...rest, media_removed_at: new Date().toISOString() } }).catch(() => null);
        removed += 1;
      }
    }
    return json(200, { ok: true, removed, retention_days: days });
  } catch (error) {
    console.error('automation-media-cleanup error', { message: error?.message });
    return json(500, { error: 'media_cleanup_failed', removed });
  }
}
