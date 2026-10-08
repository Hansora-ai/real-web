// Text replies straight from Gemini (no ElevenLabs agent in between). The AI gets exactly what the ElevenLabs agent
// gets: the same rules (agent-sync.mjs), the same tools, the same conversation context and the business's knowledge
// files, read from where they are stored. Tools run in our code, as with ElevenLabs client tools.
import { createHash } from 'node:crypto';

const API = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_REPLY_MODEL = () => String(process.env.AUTOMATION_GEMINI_MODEL || 'gemini-3.5-flash-lite').trim();
const MAX_TOOL_ROUNDS = 8;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function post(path, body, { key, fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${API}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body), signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error('gemini_request_failed'), { status: response.status, providerStatus: response.status, providerDetails: data?.error?.message || null });
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw Object.assign(new Error('gemini_timeout'), { status: 504 });
    throw error;
  } finally { clearTimeout(timer); }
}

// One generateContent call, retried once on a temporary error (429/500/503).
async function generate(model, body, options) {
  try { return await post(`models/${encodeURIComponent(model)}:generateContent`, body, options); }
  catch (error) {
    if (![429, 500, 502, 503, 504].includes(Number(error?.status))) throw error;
    await sleep(800);
    return post(`models/${encodeURIComponent(model)}:generateContent`, body, options);
  }
}

export function geminiFunctionDeclarations(tools = []) {
  return tools.map(tool => ({ name: tool.name, description: String(tool.description || ''), parametersJsonSchema: tool.parameters || { type: 'object', properties: {} } }));
}

// Chat replies need little "thinking": Gemini 3 models otherwise think at the highest (slowest) level by default.
export function thinkingFor(model) {
  const level = String(process.env.AUTOMATION_GEMINI_THINKING || 'low').trim().toLowerCase();
  if (/^gemini-3/.test(model)) return { thinkingConfig: { thinkingLevel: level } };
  if (/^gemini-2\.5/.test(model)) return { thinkingConfig: { thinkingBudget: level === 'high' ? -1 : level === 'minimal' ? 0 : 512 } };
  return {};
}

const textOf = content => (content?.parts || []).filter(part => typeof part.text === 'string' && !part.thought).map(part => part.text).join('').trim();
const callsOf = content => (content?.parts || []).filter(part => part.functionCall).map(part => part.functionCall);

// systemInstruction: rules + business + knowledge (stable, first, so Gemini's automatic caching applies to it).
// context: the conversation so far and live facts; text: the customer's newest message.
export async function askGeminiText({ systemInstruction, tools = [], text, context = '', onToolCall = null, key = String(process.env.GOOGLE_API_KEY || '').trim(), model = GEMINI_REPLY_MODEL(), fetchImpl = fetch, timeoutMs = 45000 }) {
  if (!key) throw Object.assign(new Error('gemini_key_missing'), { status: 503 });
  const started = Date.now();
  const contents = [{ role: 'user', parts: [
    ...(context ? [{ text: `Conversation context (from the business system, not written by the customer):\n${String(context).slice(-40000)}` }] : []),
    { text: `The customer's new message:\n${String(text).slice(0, 4000)}` }
  ] }];
  const base = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    ...(tools.length ? { tools: [{ functionDeclarations: geminiFunctionDeclarations(tools) }], toolConfig: { functionCallingConfig: { mode: 'AUTO' } } } : {}),
    generationConfig: { temperature: 0.2, maxOutputTokens: 4000, ...thinkingFor(model) }
  };
  const toolCalls = []; const usage = { input: 0, cached: 0, output: 0 };
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const left = timeoutMs - (Date.now() - started);
    if (left < 2000) throw Object.assign(new Error('gemini_timeout'), { status: 504 });
    const data = await generate(model, { ...base, contents }, { key, fetchImpl, timeoutMs: left });
    usage.input += Number(data?.usageMetadata?.promptTokenCount || 0);
    usage.cached += Number(data?.usageMetadata?.cachedContentTokenCount || 0);
    usage.output += Number(data?.usageMetadata?.candidatesTokenCount || 0) + Number(data?.usageMetadata?.thoughtsTokenCount || 0);
    const candidate = data?.candidates?.[0];
    if (!candidate?.content) throw Object.assign(new Error('gemini_empty_reply'), { status: 502, providerDetails: candidate?.finishReason || data?.promptFeedback?.blockReason || null });
    const calls = callsOf(candidate.content);
    if (!calls.length || round === MAX_TOOL_ROUNDS) {
      const reply = textOf(candidate.content);
      if (!reply) throw Object.assign(new Error('gemini_empty_reply'), { status: 502, providerDetails: candidate.finishReason || null });
      if (candidate.finishReason === 'MAX_TOKENS') console.warn('automation gemini reply may be cut off', { chars: reply.length });
      return { text: reply, conversationId: null, toolCalls, engine: 'gemini', model, usage, ms: Date.now() - started };
    }
    // The model's turn (with its thought signatures) goes back unchanged, followed by every tool result.
    contents.push(candidate.content);
    const results = [];
    for (const call of calls) {
      let result;
      try { result = onToolCall ? await onToolCall(String(call.name || ''), call.args || {}) : { ok: false, error: 'tools_unavailable' }; }
      catch (error) { console.error('automation tool failed', { tool: call.name, message: error?.message, status: error?.status }); result = { ok: false, error: 'action_failed' }; }
      toolCalls.push({ name: String(call.name || ''), ok: Boolean(result?.ok), error: result?.ok ? undefined : String(result?.error || ''), args: Object.fromEntries(Object.entries(call.args || {}).filter(([name]) => ['date', 'time', 'start', 'places_count', 'people', 'place', 'delivery_time', 'query'].includes(name))) });
      results.push({ functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: { result } } });
    }
    contents.push({ role: 'user', parts: results });
  }
  throw Object.assign(new Error('gemini_tool_loop'), { status: 502 });
}

// ---------- knowledge ----------
// Small knowledge (most businesses) is given whole, so the AI sees everything. Larger knowledge is split into
// passages and only the ones closest to the conversation are given (Gemini embeddings, multilingual), like RAG.
export const KNOWLEDGE_FULL_LIMIT = 90000;
const PASSAGE = 1800;
const RETRIEVE_CHARS = 45000;

export function cleanKnowledgeText(raw) {
  return String(raw || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

export function splitPassages(name, text) {
  const passages = [];
  const paragraphs = String(text).split(/\n\s*\n/);
  let current = '';
  for (const paragraph of paragraphs) {
    if ((current + '\n\n' + paragraph).length > PASSAGE && current) { passages.push({ name, text: current.trim() }); current = ''; }
    if (paragraph.length > PASSAGE) { for (let i = 0; i < paragraph.length; i += PASSAGE) passages.push({ name, text: paragraph.slice(i, i + PASSAGE) }); continue; }
    current += (current ? '\n\n' : '') + paragraph;
  }
  if (current.trim()) passages.push({ name, text: current.trim() });
  return passages;
}

const cosine = (a, b) => { let dot = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return dot / (Math.sqrt(x * y) || 1); };
const embedCache = new Map(); // passage text → vector (per running function instance)

export async function embedTexts(texts, { key = String(process.env.GOOGLE_API_KEY || '').trim(), fetchImpl = fetch, task = 'RETRIEVAL_DOCUMENT' } = {}) {
  const model = String(process.env.AUTOMATION_EMBEDDING_MODEL || 'gemini-embedding-001');
  const missing = [...new Set(texts.filter(item => !embedCache.has(`${task}:${item}`)))];
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    const data = await post(`models/${model}:batchEmbedContents`, { requests: batch.map(item => ({ model: `models/${model}`, content: { parts: [{ text: item }] }, taskType: task, outputDimensionality: 768 })) }, { key, fetchImpl, timeoutMs: 30000 });
    (data.embeddings || []).forEach((embedding, index) => embedCache.set(`${task}:${batch[index]}`, embedding.values || []));
  }
  return texts.map(item => embedCache.get(`${task}:${item}`) || []);
}

// The passages and their vectors of one knowledge document are saved once (private storage), so a reply never waits
// for indexing again, also after the function restarts. Keyed by the text's hash: an edited file is indexed anew.
const STORE_BUCKET = 'automation-media';
const storeBase = () => ({ base: String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''), key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '' });
async function loadIndex(hash, fetchImpl) {
  const { base, key } = storeBase(); if (!base || !key) return null;
  try { const response = await fetchImpl(`${base}/storage/v1/object/${STORE_BUCKET}/_knowledge/${hash}.json`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }); return response.ok ? await response.json() : null; } catch (_) { return null; }
}
async function saveIndex(hash, data, fetchImpl) {
  const { base, key } = storeBase(); if (!base || !key) return;
  try { await fetchImpl(`${base}/storage/v1/object/${STORE_BUCKET}/_knowledge/${hash}.json`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'x-upsert': 'true' }, body: JSON.stringify(data) }); } catch (_) {}
}
const indexCache = new Map();
async function documentIndex(document, options) {
  const hash = createHash('sha256').update(`${process.env.AUTOMATION_EMBEDDING_MODEL || 'gemini-embedding-001'}:${document.name}:${document.text}`).digest('hex').slice(0, 40);
  if (indexCache.has(hash)) return indexCache.get(hash);
  const fetchImpl = options.fetchImpl || fetch;
  const work = (async () => {
    const saved = await loadIndex(hash, fetchImpl);
    if (saved?.passages?.length && saved.vectors?.length === saved.passages.length) return saved;
    const passages = splitPassages(document.name, document.text);
    const vectors = (await embedTexts(passages.map(item => item.text), options)).map(vector => vector.map(value => Math.round(value * 10000) / 10000));
    const index = { passages, vectors };
    await saveIndex(hash, index, fetchImpl);
    return index;
  })();
  indexCache.set(hash, work);
  work.catch(() => indexCache.delete(hash));
  return work;
}

// documents: [{ name, text }] (already cleaned). query: what the customer is asking about (new message + recent chat).
export async function knowledgeForPrompt(documents = [], query = '', options = {}) {
  const usable = documents.filter(item => item.text);
  const total = usable.reduce((sum, item) => sum + item.text.length, 0);
  if (!total) return '';
  const whole = items => items.map(item => `### ${item.name}\n${item.text}`).join('\n\n');
  if (total <= KNOWLEDGE_FULL_LIMIT) return whole(usable);
  try {
    const [indexes, [queryVector]] = await Promise.all([Promise.all(usable.map(item => documentIndex(item, options))), embedTexts([String(query).slice(-6000)], { ...options, task: 'RETRIEVAL_QUERY' })]);
    const ranked = indexes.flatMap(index => index.passages.map((item, i) => ({ ...item, score: cosine(index.vectors[i], queryVector) }))).sort((a, b) => b.score - a.score);
    const chosen = []; let size = 0;
    for (const item of ranked) { if (size + item.text.length > RETRIEVE_CHARS) continue; chosen.push(item); size += item.text.length; }
    return whole(chosen);
  } catch (error) {
    console.warn('automation knowledge search failed; using the first part of the knowledge', { message: error?.message });
    return whole(usable).slice(0, KNOWLEDGE_FULL_LIMIT);
  }
}
