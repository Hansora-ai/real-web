// Once a day: website links in an AI employee's knowledge are read again when they are older than a week, so
// changed prices, hours or pages reach the AI. The fresh copy replaces the old one only after it was read
// successfully; if the site is down, the old copy stays and the next run tries again.
import { rows, supabaseRequest } from '../../lib/automation/db.mjs';
import { storedKnowledgeDocuments, syncBusinessAgent } from '../../lib/automation/agent-sync.mjs';
import { automationProviderName } from '../../lib/automation/provider.mjs';
import { addElevenLabsKnowledge, deleteElevenLabsKnowledge } from '../../lib/automation/providers/elevenlabs.mjs';

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
export const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PER_RUN = 6; // scheduled functions have about 30 seconds

export function dueUrlDocuments(documents, now = Date.now()) {
  return documents.filter(document => document.type === 'url' && document.url && now - Date.parse(document.refreshed_at || document.added_at || 0) >= REFRESH_AFTER_MS);
}

export async function refreshKnowledge(overrides = {}) {
  const d = { rows, supabaseRequest, syncBusinessAgent, addElevenLabsKnowledge, deleteElevenLabsKnowledge, now: Date.now(), ...overrides };
  const resources = d.rows(await d.supabaseRequest(`/rest/v1/automation_provider_resources?provider=eq.${encodeURIComponent(automationProviderName())}&resource_type=eq.agent&status=eq.active&select=id,business_id,safe_config,automation_businesses(owner_user_id)&limit=1000`));
  const results = [];
  for (const resource of resources) {
    if (results.length >= MAX_PER_RUN) break;
    const owner = Array.isArray(resource.automation_businesses) ? resource.automation_businesses[0]?.owner_user_id : resource.automation_businesses?.owner_user_id;
    const documents = storedKnowledgeDocuments(resource);
    const due = dueUrlDocuments(documents, d.now).slice(0, MAX_PER_RUN - results.length);
    if (!owner || !due.length) continue;
    let current = documents;
    for (const old of due) {
      let created = null;
      try {
        created = await d.addElevenLabsKnowledge({ kind: 'url', url: old.url, name: old.name });
        const next = current.map(document => document.id === old.id ? { ...document, id: created.id, refreshed_at: new Date(d.now).toISOString() } : document);
        await d.syncBusinessAgent({ businessId: resource.business_id, userId: owner, knowledgeDocuments: next });
        current = next;
        await d.deleteElevenLabsKnowledge(old.id).catch(error => console.warn('old knowledge copy not deleted', { message: error?.message }));
        results.push({ business_id: resource.business_id, url: old.url, ok: true });
      } catch (error) {
        if (created) await d.deleteElevenLabsKnowledge(created.id).catch(() => null);
        console.warn('knowledge link refresh failed', { businessId: resource.business_id, url: old.url, message: error?.message, providerMessage: error?.providerMessage });
        results.push({ business_id: resource.business_id, url: old.url, ok: false, error: error?.message });
      }
    }
  }
  return results;
}

export async function handler(event) {
  const internal = String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET || '');
  const provided = String(event.headers?.['x-hansora-internal-secret'] || event.headers?.['X-Hansora-Internal-Secret'] || '');
  const scheduled = String(event.headers?.['x-nf-event'] || event.headers?.['X-Nf-Event'] || '') === 'schedule';
  if (!scheduled && !(internal.length >= 32 && provided === internal)) return json(401, { error: 'unauthorized' });
  try {
    const results = await refreshKnowledge();
    return json(200, { ok: true, refreshed: results.filter(item => item.ok).length, results });
  } catch (error) {
    console.error('automation-knowledge-refresh error', { message: error?.message });
    return json(500, { error: 'refresh_failed' });
  }
}
