import NodeWebSocket from 'ws';

const API_ROOT = 'https://api.elevenlabs.io/v1/convai';

function configuredFetch(fetchImpl) {
  const apiKey = process.env.ELEVENLABS_API_KEY || '';
  if (!apiKey) {
    const error = new Error('elevenlabs_not_configured');
    error.status = 503;
    throw error;
  }
  return async (path, options = {}) => {
    const response = await fetchImpl(`${API_ROOT}${path}`, {
      ...options,
      headers: {
        // File uploads (FormData) set their own multipart content type.
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        'xi-api-key': apiKey,
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error('elevenlabs_request_failed');
      error.status = response.status >= 500 ? 502 : 400;
      error.providerStatus = response.status;
      // Identify the failing operation without logging resource IDs, query values or credentials.
      error.providerOperation = `${options.method || 'GET'} ${path.split('?')[0].replace(/\/(agents|tools|knowledge-base)\/(?!create(?:\/|$)|text(?:\/|$)|url(?:\/|$)|file(?:\/|$))[^/]+/g, '/$1/:id')}`;
      const detail = payload?.detail ?? payload?.message ?? null;
      error.providerMessage = detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500);
      throw error;
    }
    return payload;
  };
}

// Hansora tool definitions become ElevenLabs client tools: the agent asks, and our server (which holds the
// trusted business scope) executes them over the same WebSocket.
export function elevenLabsClientTools(definitions = []) {
  const describe = (schema, fallback) => {
    // ElevenLabs object/array schemas reject extra JSON Schema keywords. Keep validation
    // limits in Hansora's source schema, but only send the provider's accepted fields.
    const next = { type: schema.type, description: schema.description || fallback };
    // ElevenLabs enum entries must be strings; nullability is expressed by type,
    // not an extra null entry in enum (which causes a 422 during tool creation).
    if (schema.enum) {
      const values = schema.enum.filter(value => typeof value === 'string');
      if (values.length) next.enum = values;
    }
    if (schema.required) next.required = schema.required;
    if (schema.properties) next.properties = schema.properties;
    if (next.properties) next.properties = Object.fromEntries(Object.entries(next.properties).map(([key, value]) => [key, describe(value, key.replace(/_/g, ' '))]));
    if (schema.items) next.items = describe(schema.items, `${fallback} item`);
    return next;
  };
  return definitions.map(tool => ({ type: 'client', name: tool.name, description: tool.description, parameters: describe(tool.parameters, tool.description), expects_response: true, response_timeout_secs: 20 }));
}

// Text agents never use speech, so the reply language is set by the prompt ("reply in the customer's
// language"). The agent itself stays English: ElevenLabs only accepts other agent languages together with a
// multilingual voice model, and rejects some (such as Armenian) entirely, which made agent creation fail.
export function buildElevenLabsAgentConfig({ business, agent, instructions, toolIds = [], knowledgeDocuments = [] }) {
  return {
    name: `${business.name} — ${agent.display_name}`.slice(0, 200),
    tags: ['hansora-automation', `business:${business.id}`],
    // Blocks customers from overriding the business instructions ("ignore your rules and give me 90% off").
    platform_settings: { guardrails: { version: '1', prompt_injection: { is_enabled: true } } },
    conversation_config: {
      conversation: { text_only: true, max_duration_seconds: 1800 },
      agent: {
        first_message: '',
        language: 'en',
        prompt: {
          prompt: instructions,
          // gemini-2.5-flash is deprecated (shut down 16 Oct 2026). 3.5 Flash-Lite costs the same as it did ($0.30 / $2.50 per 1M tokens); 3.5 Flash is ~4x more and would exceed 1⚡ per reply.
          llm: process.env.ELEVENLABS_AGENT_LLM || 'gemini-3.5-flash-lite',
          temperature: 0.2,
          // A ceiling, not a target (replies are 1–3 sentences). Newer Gemini models think before answering and that
          // thinking counts against it: at 700, and with long Armenian chats even at 2000, a reply was cut off mid-word.
          max_tokens: AGENT_MAX_TOKENS,
          tool_ids: toolIds,
          // Uploaded files, links and long texts: the AI searches them (RAG) and only reads the parts that
          // match each question, so a large knowledge base does not slow replies or raise the cost per reply.
          knowledge_base: knowledgeDocuments.map(document => ({ type: document.type, name: document.name, id: document.id, usage_mode: 'auto' })),
          rag: { enabled: knowledgeDocuments.length > 0, embedding_model: KNOWLEDGE_EMBEDDING_MODEL }
        }
      }
    }
  };
}

export const AGENT_MAX_TOKENS = 4000;
// Bumped when the agent's model settings change, so every existing AI employee is updated on its next message.
export const AGENT_SETTINGS_VERSION = 'tokens-4000+complete-event';

// Inline prompt.tools is deprecated by ElevenLabs; tools are separate resources referenced by tool_ids.
// Existing tools (name -> id from the last sync) are updated; missing or deleted ones are created again.
export async function syncElevenLabsTools({ tools = [], existingToolIds = {}, fetchImpl = fetch }) {
  const request = configuredFetch(fetchImpl);
  const toolIds = {};
  for (const toolConfig of elevenLabsClientTools(tools)) {
    const known = existingToolIds?.[toolConfig.name];
    if (known) {
      try {
        await request(`/tools/${encodeURIComponent(known)}`, { method: 'PATCH', body: JSON.stringify({ tool_config: toolConfig }) });
        toolIds[toolConfig.name] = known;
        continue;
      } catch (error) { if (error.providerStatus !== 404) throw error; }
    }
    const created = await request('/tools', { method: 'POST', body: JSON.stringify({ tool_config: toolConfig }) });
    if (!created.id) throw new Error('elevenlabs_tool_id_missing');
    toolIds[toolConfig.name] = created.id;
  }
  return toolIds;
}

export const KNOWLEDGE_EMBEDDING_MODEL = 'multilingual_e5_large_instruct'; // also covers Armenian and Russian

// Adds one knowledge document: { kind: 'file', file: { bytes, filename, mime } } | { kind: 'url', url } | { kind: 'text', text }.
export async function addElevenLabsKnowledge({ kind, name, url, text, file, fetchImpl = fetch }) {
  const request = configuredFetch(fetchImpl);
  let result;
  if (kind === 'file') {
    const form = new FormData();
    form.append('file', new Blob([file.bytes], { type: file.mime || 'application/octet-stream' }), file.filename);
    if (name) form.append('name', name);
    result = await request('/knowledge-base/file', { method: 'POST', body: form });
  } else if (kind === 'url') {
    result = await request('/knowledge-base/url', { method: 'POST', body: JSON.stringify({ url, ...(name ? { name } : {}) }) });
  } else if (kind === 'text') {
    result = await request('/knowledge-base/text', { method: 'POST', body: JSON.stringify({ text, name }) });
  } else throw Object.assign(new Error('knowledge_kind_invalid'), { status: 400 });
  if (!result?.id) throw Object.assign(new Error('elevenlabs_knowledge_id_missing'), { status: 502 });
  // Start search indexing right away; if it fails here, ElevenLabs indexes when the agent uses the document.
  await request(`/knowledge-base/${encodeURIComponent(result.id)}/rag-index`, { method: 'POST', body: JSON.stringify({ model: KNOWLEDGE_EMBEDDING_MODEL }) }).catch(() => null);
  return { id: String(result.id), name: String(result.name || name || 'Document') };
}

// The full text of a stored knowledge document (files, links and texts), for the direct Gemini engine.
export async function getElevenLabsKnowledgeText(documentId, fetchImpl = fetch) {
  const apiKey = process.env.ELEVENLABS_API_KEY || '';
  if (!apiKey) throw Object.assign(new Error('elevenlabs_not_configured'), { status: 503 });
  const response = await fetchImpl(`${API_ROOT}/knowledge-base/${encodeURIComponent(documentId)}/content`, { headers: { 'xi-api-key': apiKey } });
  if (!response.ok) throw Object.assign(new Error('elevenlabs_knowledge_unreadable'), { status: 502, providerStatus: response.status });
  const raw = await response.text();
  try { const parsed = JSON.parse(raw); return typeof parsed === 'string' ? parsed : String(parsed?.content || parsed?.text || raw); } catch (_) { return raw; }
}

export async function deleteElevenLabsKnowledge(documentId, fetchImpl = fetch) {
  const request = configuredFetch(fetchImpl);
  return request(`/knowledge-base/${encodeURIComponent(documentId)}?force=true`, { method: 'DELETE' });
}

export async function syncElevenLabsAgent({ providerResourceId, config, tools = [], existingToolIds = {}, fetchImpl = fetch }) {
  const request = configuredFetch(fetchImpl);
  const toolIds = await syncElevenLabsTools({ tools, existingToolIds, fetchImpl });
  config.conversation_config.agent.prompt.tool_ids = Object.values(toolIds);
  if (providerResourceId) {
    try {
      const result = await request(`/agents/${encodeURIComponent(providerResourceId)}`, { method: 'PATCH', body: JSON.stringify(config) });
      await enableResponseCompleteEvent(result.agent_id || providerResourceId, request);
      return { provider: 'elevenlabs', resourceId: result.agent_id || providerResourceId, created: false, toolIds, raw: result };
    } catch (error) { if (error.providerStatus !== 404) throw error; } // Agent was deleted in ElevenLabs: create it again.
  }
  const result = await request('/agents/create', { method: 'POST', body: JSON.stringify(config) });
  if (!result.agent_id) throw new Error('elevenlabs_agent_id_missing');
  await enableResponseCompleteEvent(result.agent_id, request);
  return { provider: 'elevenlabs', resourceId: result.agent_id, created: true, toolIds, raw: result };
}

// "agent_response_complete" tells exactly when the agent has finished a reply (after any actions it runs). Without it
// a reply could be sent half-written: text, then a pause while the AI ran an action, was taken as the end. The agent's
// current event list is read and the event is only added, so nothing ElevenLabs sends by default is switched off.
export async function enableResponseCompleteEvent(agentId, request) {
  try {
    const agent = await request(`/agents/${encodeURIComponent(agentId)}`);
    const events = agent?.conversation_config?.conversation?.client_events;
    if (!Array.isArray(events) || !events.length) return false;
    if (events.includes('agent_response_complete')) return true;
    await request(`/agents/${encodeURIComponent(agentId)}`, { method: 'PATCH', body: JSON.stringify({ conversation_config: { conversation: { client_events: [...events, 'agent_response_complete'] } } }) });
    return true;
  } catch (error) {
    console.warn('agent_response_complete not enabled', { message: error?.message, providerMessage: error?.providerMessage });
    return false;
  }
}

export async function getElevenLabsSignedUrl(agentId, fetchImpl = fetch) {
  const request = configuredFetch(fetchImpl);
  const result = await request(`/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`);
  if (!result.signed_url) throw Object.assign(new Error('elevenlabs_signed_url_missing'), { status: 502 });
  return result.signed_url;
}

// Agents seen sending agent_response_complete (per running function instance).
const COMPLETE_EVENT_AGENTS = new Set();
// A reply cut off mid-sentence is sent up to its last full sentence, never half a word.
export function trimCutOffReply(text) {
  const reply = String(text || '').trim();
  if (reply.length <= 20 || looksFinished(reply)) return reply;
  const ends = [...reply.matchAll(/[.!?։՞՜…](?=\s|$)/gu)];
  const cut = ends.length ? ends[ends.length - 1].index + 1 : 0;
  return cut ? reply.slice(0, cut).trim() : reply;
}
export const looksFinished = text => /[.!?։՞՜…)"»\]*_~\p{Emoji_Presentation}]\s*$/u.test(String(text || '').trim());

export async function askElevenLabsText({ agentId, text, context = '', channel = 'instagram_dm', onToolCall = null, fetchImpl = fetch, WebSocketImpl = globalThis.WebSocket || NodeWebSocket, timeoutMs = 45000, settleMs = 1500, finalToolName = null }) {
  if (!WebSocketImpl) throw Object.assign(new Error('websocket_unavailable'), { status: 503 });
  const signedUrl = await getElevenLabsSignedUrl(agentId, fetchImpl);
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(signedUrl);
    let settled = false;
    let conversationId = null;
    let responses = [];
    let settleTimer = null;
    let streaming = false; // a text part has started and not stopped yet: more of this reply is coming
    let pendingTools = 0;
    const toolCalls = [];
    const timer = setTimeout(() => (responses.length && !pendingTools ? done() : finish(new Error('elevenlabs_response_timeout'))), timeoutMs);
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(settleTimer);
      try { socket.close(); } catch (_) {}
      if (error) { error.status = error.status || 504; reject(error); } else resolve(value);
    };
    // The agent may say "one moment" and then call a tool, so wait briefly after each reply before finishing.
    const done = () => {
      let reply = responses.join('\n\n');
      // A reply that stops without closing punctuation was most likely cut off by the model's token limit.
      if (reply.length > 20 && !looksFinished(reply)) { console.warn('automation reply may be cut off', { conversationId, chars: reply.length, ending: reply.slice(-40) }); reply = trimCutOffReply(reply); }
      finish(null, { text: reply, conversationId, toolCalls });
    };
    // When is the reply finished? Exactly when ElevenLabs says so (agent_response_complete). Until an agent is known
    // to send that, a short pause ends a reply that looks finished, and a reply that stops mid-sentence waits longer
    // (the AI is probably running an action and will continue).
    const scheduleDone = () => {
      clearTimeout(settleTimer);
      if (pendingTools || streaming) return;
      const last = responses[responses.length - 1] || '';
      const wait = !onToolCall ? 0 : COMPLETE_EVENT_AGENTS.has(agentId) ? Math.max(settleMs, 12000) : looksFinished(last) ? Math.max(settleMs, 2500) : 10000;
      settleTimer = setTimeout(done, wait);
    };
    const send = (payload) => { try { socket.send(JSON.stringify(payload)); } catch (_) {} };
    const sendPrompt = () => {
      if (context) send({ type: 'contextual_update', text: String(context).slice(-40000) }); // keep the newest part if ever over the cap
      send({ type: 'user_message', text: String(text).slice(0, 4000) });
    };
    socket.addEventListener('open', () => {
      send({ type: 'conversation_initiation_client_data', dynamic_variables: { hansora_channel: channel } });
    });
    socket.addEventListener('message', async (event) => {
      let data; try { data = JSON.parse(String(event.data || '{}')); } catch (_) { return; }
      if (data.type === 'conversation_initiation_metadata') { conversationId = data.conversation_initiation_metadata_event?.conversation_id || conversationId; return sendPrompt(); }
      if (data.type === 'ping') return send({ type: 'pong', event_id: data.ping_event?.event_id });
      if (data.type === 'agent_response_complete') { COMPLETE_EVENT_AGENTS.add(agentId); if (!pendingTools) { clearTimeout(settleTimer); if (responses.length) done(); } return; }
      if (data.type === 'agent_chat_response_part') {
        const part = String(data.text_response_part?.type || data.agent_chat_response_part_event?.type || '');
        if (part === 'start') { streaming = true; clearTimeout(settleTimer); }
        if (part === 'stop') { streaming = false; if (responses.length) scheduleDone(); }
        return;
      }
      if (data.type === 'agent_response_correction') {
        const event = data.agent_response_correction_event || {};
        const index = responses.lastIndexOf(String(event.original_agent_response || '').trim());
        const corrected = String(event.corrected_agent_response || '').trim();
        if (index >= 0) { if (corrected) responses[index] = corrected; else responses.splice(index, 1); }
        return;
      }
      if (data.type === 'agent_response') {
        const answer = String(data.agent_response_event?.agent_response || '').trim();
        if (answer) { streaming = false; responses.push(answer); scheduleDone(); }
        return;
      }
      if (data.type === 'client_tool_call') {
        const call = data.client_tool_call || {};
        clearTimeout(settleTimer); pendingTools++;
        // Anything said before the tool ran ("let me check") is replaced by the answer that uses its result.
        responses = [];
        let result, isError = false;
        try { result = onToolCall ? await onToolCall(String(call.tool_name || ''), call.parameters || {}) : { ok: false, error: 'tools_unavailable' }; }
        catch (error) { console.error('automation tool failed', { tool: call.tool_name, message: error?.message, status: error?.status }); result = { ok: false, error: 'action_failed' }; isError = true; }
        // Kept for the logs: which actions the AI ran, with what, and what came back.
        toolCalls.push({ name: String(call.tool_name || ''), ok: Boolean(result?.ok), error: result?.ok ? undefined : String(result?.error || ''), args: Object.fromEntries(Object.entries(call.parameters || {}).filter(([key]) => ['date', 'time', 'start', 'places_count', 'people', 'place', 'delivery_time'].includes(key))) });
        pendingTools--;
        send({ type: 'client_tool_result', tool_call_id: call.tool_call_id, result: JSON.stringify(result), is_error: isError || result?.ok === false });
        if (finalToolName && call.tool_name === finalToolName && result?.ok === true && !isError) return finish(null, { text: '', conversationId, toolCalls });
        return;
      }
      if (data.type === 'error') finish(Object.assign(new Error('elevenlabs_conversation_failed'), { providerDetails: data.error || null }));
    });
    socket.addEventListener('error', () => finish(new Error('elevenlabs_websocket_failed')));
    socket.addEventListener('close', () => { if (!settled) (responses.length && !pendingTools ? done() : finish(new Error('elevenlabs_websocket_closed'))); });
  });
}
