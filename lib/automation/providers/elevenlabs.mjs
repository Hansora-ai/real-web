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
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error('elevenlabs_request_failed');
      error.status = response.status >= 500 ? 502 : 400;
      error.providerStatus = response.status;
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
    const next = { ...schema, description: schema.description || fallback };
    if (next.properties) next.properties = Object.fromEntries(Object.entries(next.properties).map(([key, value]) => [key, describe(value, key.replace(/_/g, ' '))]));
    return next;
  };
  return definitions.map(tool => ({ type: 'client', name: tool.name, description: tool.description, parameters: describe(tool.parameters, tool.description), expects_response: true, response_timeout_secs: 20 }));
}

// Text agents never use speech, so the reply language is set by the prompt ("reply in the customer's
// language"). The agent itself stays English: ElevenLabs only accepts other agent languages together with a
// multilingual voice model, and rejects some (such as Armenian) entirely, which made agent creation fail.
export function buildElevenLabsAgentConfig({ business, agent, instructions, toolIds = [] }) {
  return {
    name: `${business.name} — ${agent.display_name}`.slice(0, 200),
    tags: ['hansora-automation', `business:${business.id}`],
    conversation_config: {
      conversation: { text_only: true, max_duration_seconds: 1800 },
      agent: {
        first_message: '',
        language: 'en',
        prompt: {
          prompt: instructions,
          llm: process.env.ELEVENLABS_AGENT_LLM || 'gemini-2.5-flash',
          temperature: 0.2,
          max_tokens: 700,
          tool_ids: toolIds
        }
      }
    }
  };
}

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

export async function syncElevenLabsAgent({ providerResourceId, config, tools = [], existingToolIds = {}, fetchImpl = fetch }) {
  const request = configuredFetch(fetchImpl);
  const toolIds = await syncElevenLabsTools({ tools, existingToolIds, fetchImpl });
  config.conversation_config.agent.prompt.tool_ids = Object.values(toolIds);
  if (providerResourceId) {
    try {
      const result = await request(`/agents/${encodeURIComponent(providerResourceId)}`, { method: 'PATCH', body: JSON.stringify(config) });
      return { provider: 'elevenlabs', resourceId: result.agent_id || providerResourceId, created: false, toolIds, raw: result };
    } catch (error) { if (error.providerStatus !== 404) throw error; } // Agent was deleted in ElevenLabs: create it again.
  }
  const result = await request('/agents/create', { method: 'POST', body: JSON.stringify(config) });
  if (!result.agent_id) throw new Error('elevenlabs_agent_id_missing');
  return { provider: 'elevenlabs', resourceId: result.agent_id, created: true, toolIds, raw: result };
}

export async function getElevenLabsSignedUrl(agentId, fetchImpl = fetch) {
  const request = configuredFetch(fetchImpl);
  const result = await request(`/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`);
  if (!result.signed_url) throw Object.assign(new Error('elevenlabs_signed_url_missing'), { status: 502 });
  return result.signed_url;
}

export async function askElevenLabsText({ agentId, text, context = '', channel = 'instagram_dm', onToolCall = null, fetchImpl = fetch, WebSocketImpl = globalThis.WebSocket || NodeWebSocket, timeoutMs = 45000, settleMs = 1500 }) {
  if (!WebSocketImpl) throw Object.assign(new Error('websocket_unavailable'), { status: 503 });
  const signedUrl = await getElevenLabsSignedUrl(agentId, fetchImpl);
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(signedUrl);
    let settled = false;
    let conversationId = null;
    let responses = [];
    let settleTimer = null;
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
    const done = () => finish(null, { text: responses.join('\n\n'), conversationId, toolCalls });
    const scheduleDone = () => { clearTimeout(settleTimer); if (!pendingTools) settleTimer = setTimeout(done, onToolCall ? settleMs : 0); };
    const send = (payload) => { try { socket.send(JSON.stringify(payload)); } catch (_) {} };
    const sendPrompt = () => {
      if (context) send({ type: 'contextual_update', text: String(context).slice(0, 10000) });
      send({ type: 'user_message', text: String(text).slice(0, 4000) });
    };
    socket.addEventListener('open', () => {
      send({ type: 'conversation_initiation_client_data', dynamic_variables: { hansora_channel: channel } });
    });
    socket.addEventListener('message', async (event) => {
      let data; try { data = JSON.parse(String(event.data || '{}')); } catch (_) { return; }
      if (data.type === 'conversation_initiation_metadata') { conversationId = data.conversation_initiation_metadata_event?.conversation_id || conversationId; return sendPrompt(); }
      if (data.type === 'ping') return send({ type: 'pong', event_id: data.ping_event?.event_id });
      if (data.type === 'agent_response') {
        const answer = String(data.agent_response_event?.agent_response || '').trim();
        if (answer) { responses.push(answer); scheduleDone(); }
        return;
      }
      if (data.type === 'client_tool_call') {
        const call = data.client_tool_call || {};
        clearTimeout(settleTimer); pendingTools++;
        // Anything said before the tool ran ("let me check") is replaced by the answer that uses its result.
        responses = [];
        let result, isError = false;
        try { result = onToolCall ? await onToolCall(String(call.tool_name || ''), call.parameters || {}) : { ok: false, error: 'tools_unavailable' }; }
        catch (error) { result = { ok: false, error: 'action_failed' }; isError = true; }
        toolCalls.push({ name: String(call.tool_name || ''), ok: Boolean(result?.ok) });
        pendingTools--;
        send({ type: 'client_tool_result', tool_call_id: call.tool_call_id, result: JSON.stringify(result), is_error: isError || result?.ok === false });
        return;
      }
      if (data.type === 'error') finish(Object.assign(new Error('elevenlabs_conversation_failed'), { providerDetails: data.error || null }));
    });
    socket.addEventListener('error', () => finish(new Error('elevenlabs_websocket_failed')));
    socket.addEventListener('close', () => { if (!settled) (responses.length && !pendingTools ? done() : finish(new Error('elevenlabs_websocket_closed'))); });
  });
}
