import crypto from 'node:crypto';
import { McpServer, createMcpHandler, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { authenticateToken, getAccount, getGeneration, listGenerations } from '../../lib/hansora-mcp/data.mjs';
import { buildAudioPayload, buildGenerationPayload, getModel, getRunner, listModels, quote } from '../../lib/hansora-mcp/registry.mjs';

const PUBLIC_ORIGIN = String(process.env.URL || 'https://hansora.co').replace(/\/+$/, '');
const MCP_URL = new URL('/mcp', PUBLIC_ORIGIN);

function jsonText(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

function toolError(error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown_error');
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function bearerToken(request) {
  return (String(request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i) || [])[1] || '';
}

function authenticationRequired() {
  return new Response(JSON.stringify({ error: 'invalid_token', error_description: 'Connect your Hansora account to continue.' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'WWW-Authenticate': `Bearer resource_metadata="${getOAuthProtectedResourceMetadataUrl(MCP_URL)}"`
    }
  });
}

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Expose-Headers', 'Mcp-Session-Id, WWW-Authenticate');
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const handler = createMcpHandler((ctx) => {
  const userId = String(ctx.authInfo?.extra?.userId || '');
  const token = String(ctx.authInfo?.token || '');
  const server = new McpServer({ name: 'Hansora AI', version: '1.0.0' }, { capabilities: { tools: {} } });

  server.registerTool('list_models', {
    title: 'List Hansora models',
    description: 'List every public Hansora image, video, and audio model or tool, including availability and supported inputs.',
    inputSchema: z.object({
      category: z.enum(['image', 'video', 'audio']).optional().describe('Optional category filter.'),
      include_unavailable: z.boolean().default(true).describe('Include announced models whose generation runner is not deployed yet.')
    }),
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ category, include_unavailable }) => {
    const models = listModels({ category, includeUnavailable: include_unavailable });
    return jsonText({ models, count: models.length });
  });

  server.registerTool('get_model', {
    title: 'Get Hansora model',
    description: 'Get capabilities, media requirements, allowed settings, availability and recommendations for one Hansora model.',
    inputSchema: z.object({ model_id: z.string().min(1) }),
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ model_id }) => {
    const model = getModel(model_id);
    return model ? jsonText(model) : toolError(new Error('unsupported_model'));
  });

  server.registerTool('quote_generation', {
    title: 'Quote a Hansora generation',
    description: 'Calculate the exact Hansora credit quote before submitting. Displayed credits are 10 times internal billing credits.',
    inputSchema: z.object({
      model_id: z.string().min(1),
      duration: z.number().positive().optional(),
      character_count: z.number().int().min(1).max(100000).optional(),
      audio_duration_seconds: z.number().positive().max(86400).optional(),
      resolution: z.string().optional(),
      quantity: z.number().int().min(1).max(50).default(1),
      sound: z.boolean().optional(),
      has_video_input: z.boolean().optional()
    }),
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ model_id, ...options }) => {
    try { return jsonText(quote(model_id, options)); } catch (error) { return toolError(error); }
  });

  server.registerTool('get_account', {
    title: 'Get Hansora balance',
    description: 'Read the connected Hansora account credit balance and active subscription.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async () => {
    try { return jsonText(await getAccount(userId)); } catch (error) { return toolError(error); }
  });

  server.registerTool('list_audio_voices', {
    title: 'List Hansora audio voices',
    description: 'List the current voices available for text to speech and voice changing.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: true }
  }, async () => {
    try {
      const origin = ctx.requestInfo ? new URL(ctx.requestInfo.url).origin : PUBLIC_ORIGIN;
      const response = await fetch(`${origin}/.netlify/functions/run-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind: 'voice-list' }),
        signal: AbortSignal.timeout(30000)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.submitted) throw new Error(result.error || `voice_list_failed_${response.status}`);
      return jsonText({ voices: result.voices || [], count: Array.isArray(result.voices) ? result.voices.length : 0 });
    } catch (error) { return toolError(error); }
  });

  server.registerTool('create_generation', {
    title: 'Create with Hansora',
    description: 'Submit an image or video generation to any available Hansora model. Call get_model and quote_generation first. Media inputs must be public HTTPS URLs.',
    inputSchema: z.object({
      model_id: z.string().min(1),
      prompt: z.string().min(1),
      aspect_ratio: z.string().optional(),
      duration: z.number().positive().optional(),
      resolution: z.string().optional(),
      quality: z.string().optional(),
      image_urls: z.array(z.string().url()).max(30).default([]),
      video_urls: z.array(z.string().url()).max(10).default([]),
      audio_urls: z.array(z.string().url()).max(5).default([]),
      first_frame_url: z.string().url().optional(),
      last_frame_url: z.string().url().optional(),
      source_video_url: z.string().url().optional(),
      sound: z.boolean().optional(),
      generate_audio: z.boolean().optional(),
      enable_web_search: z.boolean().optional(),
      prompt_extend: z.boolean().optional(),
      video_start: z.number().min(0).optional(),
      video_end: z.number().positive().optional(),
      audio_ids: z.array(z.string()).max(10).optional(),
      motion_model: z.enum(['kling26', 'kling30']).optional(),
      usage_mode: z.enum(['credits', 'unlimited']).default('credits')
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (input) => {
    try {
      const model = getModel(input.model_id);
      const endpoint = getRunner(input.model_id);
      if (!model) throw new Error('unsupported_model');
      if (!endpoint || model.availability !== 'available') throw new Error('model_not_available');

      const runId = `${userId}-mcp-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const payload = buildGenerationPayload(input.model_id, input, userId, runId);
      const origin = ctx.requestInfo ? new URL(ctx.requestInfo.url).origin : PUBLIC_ORIGIN;
      const response = await fetch(`${origin}/.netlify/functions/safe-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-USER-ID': userId },
        body: JSON.stringify({
          target_endpoint: endpoint,
          model_id: model.id,
          model_name: model.name,
          kind: model.category,
          prompt: input.prompt,
          usage_mode: input.usage_mode,
          payload
        }),
        signal: AbortSignal.timeout(58000)
      });
      const raw = await response.text();
      let result;
      try { result = JSON.parse(raw); } catch { result = { message: raw }; }
      if (!response.ok) throw new Error(result.message || result.error || `generation_submit_failed_${response.status}`);
      return jsonText({ ok: true, run_id: runId, model_id: model.id, status: response.status === 202 ? 'queued' : 'submitted', provider: result });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('create_audio', {
    title: 'Create audio with Hansora',
    description: 'Create speech, isolate a voice, change a voice, or generate music with Hansora. For file-based tools, audio_url must be a public HTTPS audio URL. Call quote_generation first.',
    inputSchema: z.object({
      audio_tool_id: z.enum(['voice', 'isolation', 'voice-change', 'music']),
      text: z.string().max(4200).optional(),
      dialogue: z.array(z.object({
        text: z.string().min(1).max(4200),
        voice_id: z.string().optional(),
        voice: z.string().optional()
      })).max(20).optional(),
      voice_id: z.string().optional(),
      language_code: z.string().max(8).optional(),
      stability: z.number().min(0).max(1).optional(),
      audio_url: z.string().url().optional(),
      audio_duration_seconds: z.number().positive().max(86400).optional(),
      remove_background_noise: z.boolean().default(true),
      prompt: z.string().max(5000).optional(),
      instrumental: z.boolean().default(false),
      style: z.string().max(1000).optional(),
      title: z.string().max(80).optional(),
      vocal_gender: z.enum(['m', 'f']).optional(),
      music_model: z.enum(['V5_5', 'V5', 'V4_5PLUS', 'V4_5', 'V4', 'V4_5ALL']).optional(),
      style_weight: z.number().min(0).max(1).optional(),
      weirdness_constraint: z.number().min(0).max(1).optional(),
      audio_weight: z.number().min(0).max(1).optional()
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (input) => {
    try {
      const model = getModel(input.audio_tool_id);
      if (!model || model.category !== 'audio') throw new Error('unsupported_audio_tool');
      const runId = `${userId}-mcp-audio-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const payload = buildAudioPayload(input.audio_tool_id, input, userId, runId);
      const origin = ctx.requestInfo ? new URL(ctx.requestInfo.url).origin : PUBLIC_ORIGIN;
      const response = await fetch(`${origin}/.netlify/functions/safe-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-USER-ID': userId },
        body: JSON.stringify({
          target_endpoint: '/.netlify/functions/run-audio',
          model_id: model.id,
          model_name: model.name,
          kind: 'audio',
          prompt: payload.prompt,
          usage_mode: 'credits',
          payload
        }),
        signal: AbortSignal.timeout(58000)
      });
      const raw = await response.text();
      let result;
      try { result = JSON.parse(raw); } catch { result = { message: raw }; }
      if (!response.ok || !result.submitted) throw new Error(result.message || result.error || `audio_submit_failed_${response.status}`);
      return jsonText({ ok: true, run_id: runId, model_id: model.id, status: 'queued', provider: result });
    } catch (error) { return toolError(error); }
  });

  server.registerTool('get_generation', {
    title: 'Get Hansora generation',
    description: 'Check one Hansora image, video, or audio generation by the run_id returned from a create tool.',
    inputSchema: z.object({ run_id: z.string().min(1) }),
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ run_id }) => {
    try {
      const generation = await getGeneration(userId, run_id);
      return generation ? jsonText(generation) : toolError(new Error('generation_not_found'));
    } catch (error) { return toolError(error); }
  });

  server.registerTool('list_generations', {
    title: 'List Hansora generations',
    description: 'List recent image, video, and audio generations for the connected Hansora account.',
    inputSchema: z.object({
      limit: z.number().int().min(1).max(50).default(10),
      status: z.string().optional()
    }),
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ limit, status }) => {
    try { return jsonText({ generations: await listGenerations(userId, limit, status) }); } catch (error) { return toolError(error); }
  });

  return server;
}, { legacy: 'stateless', responseMode: 'auto', onerror: (error) => console.error('hansora_mcp_error', error?.message || error) });

export default async function hansoraMcp(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id' } });
  }
  const token = bearerToken(request);
  const user = await authenticateToken(token).catch(() => null);
  if (!user) return authenticationRequired();
  const authInfo = { token, clientId: user.clientId, scopes: user.scopes, extra: { userId: user.id, email: user.email } };
  return withCors(await handler.fetch(request, { authInfo }));
}

export const config = { path: '/mcp' };
