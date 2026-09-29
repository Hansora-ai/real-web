// Knowledge documents for an AI employee: files, website links and long texts, stored in the ElevenLabs
// knowledge base and searched per question (RAG). Owner-only. Actions: list, add, remove.
import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { existingProviderResource, loadOwnedBusiness, storedKnowledgeDocuments, syncBusinessAgent } from '../../lib/automation/agent-sync.mjs';
import { addElevenLabsKnowledge, deleteElevenLabsKnowledge } from '../../lib/automation/providers/elevenlabs.mjs';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

export const MAX_FILE_BYTES = 4 * 1024 * 1024; // Netlify accepts requests up to 6 MB; base64 adds about a third.
export const MAX_DOCUMENTS = 50;
export const MAX_TEXT_CHARS = 300000;
const FILE_TYPES = { pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', html: 'text/html', htm: 'text/html', epub: 'application/epub+zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const cleanName = value => String(value || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120);

// Validates the request and returns what to send to ElevenLabs.
export function knowledgeInput(body) {
  const kind = String(body.kind || '');
  if (kind === 'file') {
    const filename = cleanName(body.filename);
    const extension = filename.toLowerCase().split('.').pop();
    if (!filename || !FILE_TYPES[extension]) throw fail('knowledge_file_type_not_supported');
    const bytes = Buffer.from(String(body.content_base64 || ''), 'base64');
    if (!bytes.length) throw fail('knowledge_file_empty');
    if (bytes.length > MAX_FILE_BYTES) throw fail('knowledge_file_too_large', 413);
    return { kind, name: filename, file: { bytes, filename, mime: FILE_TYPES[extension] }, meta: { size_bytes: bytes.length } };
  }
  if (kind === 'url') {
    let url; try { url = new URL(String(body.url || '').trim()); } catch (_) { throw fail('knowledge_url_invalid'); }
    if (url.protocol !== 'https:' || String(url).length > 2000) throw fail('knowledge_url_invalid');
    return { kind, name: cleanName(body.name) || url.hostname + url.pathname.replace(/\/$/, ''), url: String(url), meta: { url: String(url) } };
  }
  if (kind === 'text') {
    const text = String(body.text || '').trim();
    if (!text) throw fail('knowledge_text_empty');
    if (text.length > MAX_TEXT_CHARS) throw fail('knowledge_text_too_long', 413);
    return { kind, name: cleanName(body.name) || 'Business information', text, meta: { characters: text.length } };
  }
  throw fail('knowledge_kind_invalid');
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  try {
    const user = await authenticateRequest(event);
    if (!user) return json(401, { error: 'authentication_required' });
    let body; try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'invalid_json' }); }
    if (!isUuid(body.business_id)) return json(400, { error: 'invalid_business_id' });
    const { business, agent } = await loadOwnedBusiness(body.business_id, user.id);
    const resource = await existingProviderResource(business.id, agent.id);
    const documents = storedKnowledgeDocuments(resource);
    const action = String(body.action || 'list');
    if (action === 'list') return json(200, { documents });
    if (!resource) return json(409, { error: 'ai_employee_not_ready' });

    if (action === 'add') {
      if (documents.length >= MAX_DOCUMENTS) return json(409, { error: 'knowledge_limit_reached' });
      const input = knowledgeInput(body);
      const created = await addElevenLabsKnowledge(input);
      const next = [...documents, { id: created.id, type: input.kind, name: created.name, added_at: new Date().toISOString(), ...input.meta }];
      try { await syncBusinessAgent({ businessId: business.id, userId: user.id, knowledgeDocuments: next }); }
      catch (error) { await deleteElevenLabsKnowledge(created.id).catch(() => null); throw error; } // never leave an unused document behind
      return json(200, { documents: next });
    }

    if (action === 'remove') {
      const id = String(body.document_id || '');
      if (!documents.some(document => document.id === id)) return json(404, { error: 'knowledge_document_not_found' });
      const next = documents.filter(document => document.id !== id);
      await syncBusinessAgent({ businessId: business.id, userId: user.id, knowledgeDocuments: next });
      await deleteElevenLabsKnowledge(id).catch(error => console.warn('knowledge document not deleted at ElevenLabs', { message: error?.message }));
      return json(200, { documents: next });
    }
    return json(400, { error: 'invalid_action' });
  } catch (error) {
    console.error('automation-knowledge error', { message: error?.message, status: error?.status, providerStatus: error?.providerStatus, providerMessage: error?.providerMessage });
    const status = Number(error?.status) || 500;
    const known = /^(knowledge_|business_not_found|agent_configuration_incomplete|elevenlabs_not_configured|elevenlabs_request_failed)/.test(String(error?.message));
    return json(status, { error: known ? error.message : 'knowledge_unavailable', ...(error?.providerMessage ? { detail: error.providerMessage } : {}) });
  }
}
