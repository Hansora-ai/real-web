import crypto from 'node:crypto';
import { TOOL_DEFINITIONS } from './tools.mjs';
import { REPLY_JSON_SCHEMA, validateReply } from './reply.mjs';

const OPENAI_URL = 'https://api.openai.com/v1/responses';
const KIE_URL = 'https://api.kie.ai/codex/v1/responses';
const MAX_TOOL_ROUNDS = 4;

const SUBMIT_REPLY_TOOL = {
  type: 'function',
  name: 'submit_sales_reply',
  strict: true,
  description: 'Submit the final validated Hansora response after all required data tools have returned.',
  parameters: REPLY_JSON_SCHEMA
};

function providerConfig() {
  const requested = String(process.env.SALES_AGENT_PROVIDER || '').trim().toLowerCase();
  const useKie = requested ? requested === 'kie' : Boolean(process.env.KIE_API_KEY || process.env.KIEAI_API_KEY);
  if (useKie) {
    return {
      provider: 'kie',
      url: process.env.SALES_AGENT_API_URL || KIE_URL,
      key: process.env.KIE_API_KEY || process.env.KIEAI_API_KEY || '',
      model: process.env.SALES_AGENT_MODEL || 'gpt-5-6-luna'
    };
  }
  return {
    provider: 'openai',
    url: process.env.SALES_AGENT_API_URL || OPENAI_URL,
    key: process.env.OPENAI_API_KEY || '',
    model: process.env.SALES_AGENT_MODEL || 'gpt-5.6-luna'
  };
}

function parseArguments(value) {
  try {
    return JSON.parse(value || '{}');
  } catch (_) {
    return {};
  }
}

function extractText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) return response.output_text;
  return (response?.output || []).flatMap((item) => item?.content || [])
    .filter((item) => item?.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('');
}

async function requestProvider(config, body, deadlineAt) {
  if (!config.key) {
    const error = new Error(`${config.provider}_not_configured`);
    error.status = 503;
    throw error;
  }
  let lastError;
  // Kie continues processing after the client aborts. Retrying an aborted Kie
  // request creates a duplicate job and still misses the first valid response.
  // Give Kie one longer attempt that fits inside the Netlify function timeout.
  const maxAttempts = config.provider === 'kie' ? 1 : 2;
  const attemptTimeoutMs = config.provider === 'kie' ? 54_000 : 12_000;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const remaining = deadlineAt - Date.now();
    if (remaining < 1500) throw lastError || new Error('openai_deadline_exceeded');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(attemptTimeoutMs, remaining));
    try {
      const response = await fetch(config.url, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return { payload, retries: attempt };
      const error = new Error(payload?.error?.message || `openai_http_${response.status}`);
      error.status = response.status;
      if (![408, 409, 429, 500, 502, 503, 504].includes(response.status)) throw error;
      lastError = error;
    } catch (error) {
      if (error?.status && ![408, 409, 429, 500, 502, 503, 504].includes(error.status)) throw error;
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt + 1 < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw lastError || new Error('openai_request_failed');
}

function usageFrom(response) {
  const usage = response?.usage || {};
  const input = Number(usage.input_tokens || 0);
  const cached = Number(usage.input_tokens_details?.cached_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  return { input, cached, output };
}

export async function generateSalesReply({ instructions, messages, executeTool, safetyIdentifier }) {
  const config = providerConfig();
  const model = config.model;
  const startedAt = Date.now();
  const deadlineAt = startedAt + (config.provider === 'kie' ? 55_000 : 20_000);
  const input = messages.map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: String(message.content || '').slice(0, 12000)
  }));
  const usage = { input: 0, cached: 0, output: 0 };
  let providerCredits = 0;
  const toolCalls = [];
  let retries = 0;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const request = {
      model,
      stream: false,
      instructions,
      input,
      tools: [...TOOL_DEFINITIONS, SUBMIT_REPLY_TOOL],
      tool_choice: 'auto',
      parallel_tool_calls: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 1400
    };
    if (config.provider === 'openai') {
      request.store = false;
      request.prompt_cache_key = 'hansora-sales-agent-2026-09-15.2';
      request.safety_identifier = crypto.createHash('sha256').update(String(safetyIdentifier || 'anonymous')).digest('hex');
    }
    const result = await requestProvider(config, request, deadlineAt);
    retries += result.retries;
    const response = result.payload;
    const currentUsage = usageFrom(response);
    usage.input += currentUsage.input;
    usage.cached += currentUsage.cached;
    usage.output += currentUsage.output;
    providerCredits += Number(response.credits_consumed || 0);

    const calls = (response.output || []).filter((item) => item?.type === 'function_call');
    const submitted = calls.find((call) => call.name === 'submit_sales_reply');
    if (submitted) {
      return {
        reply: validateReply(parseArguments(submitted.arguments)),
        usage,
        provider: config.provider,
        providerCredits: Number(providerCredits.toFixed(6)),
        model,
        latencyMs: Date.now() - startedAt,
        retries,
        toolCalls
      };
    }
    if (!calls.length) {
      const raw = extractText(response);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        throw new Error('invalid_openai_json');
      }
      return {
        reply: validateReply(parsed),
        usage,
        provider: config.provider,
        providerCredits: Number(providerCredits.toFixed(6)),
        model,
        latencyMs: Date.now() - startedAt,
        retries,
        toolCalls
      };
    }
    if (round === MAX_TOOL_ROUNDS) throw new Error('tool_round_limit');

    input.push(...response.output);
    for (const call of calls.filter((item) => item.name !== 'submit_sales_reply')) {
      const args = parseArguments(call.arguments);
      let output;
      try {
        output = await executeTool(call.name, args);
      } catch (error) {
        output = { ok: false, error: 'tool_unavailable' };
      }
      toolCalls.push({ name: call.name, ok: output?.ok !== false });
      input.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(output)
      });
    }
  }
  throw new Error('reply_generation_failed');
}
