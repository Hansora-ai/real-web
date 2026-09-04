'use strict';

const crypto = require('node:crypto');

const POLICY_VERSION = '2026-09-03.1';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const QUEUE_SECRET = process.env.HANSORA_QUEUE_SECRET || '';

// These terms are explicit enough to block without needing surrounding context.
const DIRECT_SEXUAL_TERMS = [
  'adult content', 'bare breasts', 'blow job', 'blowjob', 'boob', 'boobs',
  'clit', 'cock', 'dick', 'erotic', 'explicit sex',
  'fetish', 'fuck', 'fucking', 'genital', 'genitals', 'hardcore', 'hentai',
  'jerk off', 'masturbate', 'masturbating', 'masturbation', 'milf',
  'onlyfans', 'orgasm', 'penis', 'porn', 'pornographic', 'pussy',
  'sexual', 'slut', 'vagina', 'vergina', 'whore', 'xxx', 'sexo',
  'pornografia', 'sexe', 'порно', 'секс'
];

// These words are ambiguous and only block when they describe a human.
const HUMAN_NUDITY_WORDS = [
  'naked', 'nude', 'topless', 'desnuda', 'desnudo', 'nue', 'nu',
  'голая', 'голый', 'обнаженная', 'обнаженный'
];

const HUMAN_NOUNS = [
  'person', 'people', 'human', 'man', 'men', 'woman', 'women', 'male',
  'female', 'girl', 'girls', 'boy', 'boys', 'guy', 'guys', 'lady', 'ladies',
  'gentleman', 'child', 'children', 'baby', 'kid', 'kids', 'teen', 'teenager',
  'adult', 'model', 'subject', 'character', 'hero', 'warrior', 'actor',
  'actress', 'celebrity', 'singer', 'politician', 'president', 'body'
];

const HUMAN_REFERENCES = [
  ...HUMAN_NOUNS,
  'him', 'her', 'them', 'himself', 'herself', 'themselves', 'their body',
  'his body', 'her body'
];

const MINOR_TERMS = [
  'baby', 'child', 'children', 'high schooler', 'kid', 'kids', 'little boy',
  'little girl', 'minor', 'schoolgirl', 'schoolboy', 'teen', 'teenage',
  'teenager', 'underage', 'young boy', 'young girl', 'young looking'
];

const DECEPTIVE_DEEPFAKE_TERMS = [
  'deep fake', 'deepfake', 'face swap', 'face swapping', 'fake endorsement', 'fake identity',
  'fake interview', 'fake news clip', 'fake passport', 'fake statement',
  'impersonate', 'impersonation',
  'make it look like they said', 'make them confess', 'make them endorse',
  'pretend to be', 'without their consent'
];

const FRAUD_TERMS = [
  'bypass face id', 'bypass facial recognition', 'bypass identity check',
  'bypass identity verification', 'bypass kyc', 'evade identity verification',
  'fake id', 'fake verification', 'fraud call', 'scam video',
  'steal their identity', 'verification bypass'
];

function normalizePrompt(value) {
  let text = String(value || '').normalize('NFKD').toLowerCase();
  text = text.replace(/[\u0300-\u036f]/g, '');
  text = text.replace(/[013457@$]/g, (character) => ({
    '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's'
  })[character] || character);
  text = text.replace(/(.)\1{2,}/g, '$1$1');
  return text.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function containsTerm(normalized, terms) {
  const padded = ` ${normalized} `;
  if (terms.some((term) => padded.includes(` ${normalizePrompt(term)} `))) return true;

  const termTokens = new Set(terms.map(normalizePrompt).filter((term) => term && !term.includes(' ')));
  const tokens = normalized.split(' ');
  for (let start = 0; start < tokens.length; start += 1) {
    if (!/^[a-z0-9]$/.test(tokens[start])) continue;
    let joined = '';
    for (let end = start; end < Math.min(tokens.length, start + 16); end += 1) {
      if (!/^[a-z0-9]$/.test(tokens[end])) break;
      joined += tokens[end];
      if (joined.length < 3) continue;
      for (const term of termTokens) {
        if (joined === term || joined.endsWith(term)) return true;
      }
    }
  }
  return false;
}

function regexAlternation(terms) {
  return terms
    .map((term) => normalizePrompt(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
    .sort((a, b) => b.length - a.length)
    .join('|');
}

function restoreSpacedSensitiveWords(normalized, words) {
  let result = normalized;
  for (const word of words) {
    const clean = normalizePrompt(word);
    if (!/^[a-z]{3,}$/.test(clean)) continue;
    const spaced = clean.split('').join('\\s+');
    result = result.replace(new RegExp(`\\b${spaced}\\b`, 'g'), clean);
  }
  return result;
}

function hasHumanNudityContext(normalized) {
  const text = restoreSpacedSensitiveWords(normalized, HUMAN_NUDITY_WORDS);
  const nudity = regexAlternation(HUMAN_NUDITY_WORDS);
  const humanNoun = regexAlternation(HUMAN_NOUNS);
  const humanReference = regexAlternation(HUMAN_REFERENCES);
  const stateWords = '(?:(?:is|are|was|were|be|being|shown|depicted|rendered|appears|looks|made|completely|fully|totally|entirely|standing|sitting|lying|posing)\\s+){0,5}';

  const patterns = [
    // "naked woman", "nude adult model", "topless person"
    new RegExp(`\\b(?:${nudity})\\b\\s+(?:(?:adult|young|realistic|photorealistic|beautiful|full body|male|female)\\s+){0,3}\\b(?:${humanNoun})\\b`),
    // "woman is naked", "show her completely nude", "the subject posing topless"
    new RegExp(`\\b(?:${humanReference})\\b\\s+${stateWords}\\b(?:${nudity})\\b`),
    // "make/show/render the person naked"
    new RegExp(`\\b(?:make|show|depict|render|generate|create)\\b(?:\\s+\\w+){0,5}\\s+\\b(?:${humanReference})\\b(?:\\s+\\w+){0,4}\\s+\\b(?:${nudity})\\b`),
    // "nude portrait", "naked selfie", "topless video"
    new RegExp(`\\b(?:${nudity})\\b\\s+(?:portrait|selfie|photo|photograph|image|video|scene)\\b`),
    // "person without clothes", "no clothes on the woman"
    new RegExp(`\\b(?:${humanReference})\\b(?:\\s+\\w+){0,5}\\s+\\b(?:without clothes|no clothes)\\b`),
    new RegExp(`\\b(?:without clothes|no clothes)\\b(?:\\s+\\w+){0,5}\\s+\\b(?:${humanReference})\\b`),
    // "undress her", "strip the model naked"
    new RegExp(`\\b(?:undress|strip)\\b(?:\\s+the)?\\s+\\b(?:${humanReference})\\b`)
  ];

  return patterns.some((pattern) => pattern.test(text));
}

// The standalone word "sex" is ambiguous: it can mean biological sex in an
// ordinary person or animal description. Only treat it as sexual content when
// the surrounding words describe sexual activity or sexualized media.
function hasSexualActivityContext(normalized) {
  const patterns = [
    /\b(?:have|having|had|has|engage|engaging|engaged)\s+(?:in\s+)?sex\b/,
    /\bsex\s+(?:act|acts|activity|activities|scene|scenes|position|positions|video|videos|image|images|photo|photos|content|show|tape|worker|workers|work)\b/,
    /\b(?:during|after|before|while|watching|depicting|showing|performing)\s+sex\b/,
    /\bsex\s+(?:with|between|involving)\b/,
    /\b(?:oral|anal|group|rough|explicit|graphic|hardcore)\s+sex\b/
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

function evaluatePrompt(prompt) {
  const normalized = normalizePrompt(prompt);
  if (!normalized) return { allowed: true, category: null, policyVersion: POLICY_VERSION };

  const sexual = containsTerm(normalized, DIRECT_SEXUAL_TERMS)
    || hasSexualActivityContext(normalized)
    || hasHumanNudityContext(normalized);
  const minor = containsTerm(normalized, MINOR_TERMS);
  if (sexual && minor) return { allowed: false, category: 'sexual_content_involving_minors', policyVersion: POLICY_VERSION };
  if (sexual) return { allowed: false, category: 'nsfw_sexual_content', policyVersion: POLICY_VERSION };
  if (containsTerm(normalized, FRAUD_TERMS)) return { allowed: false, category: 'identity_fraud', policyVersion: POLICY_VERSION };
  if (containsTerm(normalized, DECEPTIVE_DEEPFAKE_TERMS)) return { allowed: false, category: 'harmful_or_deceptive_deepfake', policyVersion: POLICY_VERSION };

  const deceptiveConstruction = /\b(?:make|show|create|generate)\b.{0,80}\b(?:celebrity|politician|president|prime minister|public figure|real person)\b.{0,80}\b(?:say|confess|endorse|promote|admit)\b/.test(normalized);
  const fabricatedMedia = /\bfake\b.{0,40}\b(?:video|photo|image|recording|speech)\b.{0,80}\b(?:celebrity|politician|president|public figure|real person)\b/.test(normalized);
  const faceReplacement = /\b(?:replace|swap|change)\b.{0,80}\bface\b.{0,80}\b(?:with|for|onto)\b.{0,80}\bface\b/.test(normalized)
    || /\bput\b.{0,80}\bface\b.{0,80}\b(?:on|onto)\b.{0,80}\b(?:person|body|video|image|photo)\b/.test(normalized);
  if (deceptiveConstruction || fabricatedMedia || faceReplacement) {
    return { allowed: false, category: 'harmful_or_deceptive_deepfake', policyVersion: POLICY_VERSION };
  }
  return { allowed: true, category: null, policyVersion: POLICY_VERSION };
}

function publicMessage(decision) {
  if (!decision || decision.allowed) return '';
  if (decision.category === 'nsfw_sexual_content' || decision.category === 'sexual_content_involving_minors') {
    return 'This request was blocked because NSFW or sexual content is not allowed.';
  }
  return 'This request was blocked because harmful or deceptive deepfake content is not allowed.';
}

function collectPromptLikeText(value, parentKey, output, depth) {
  if (depth > 8 || value == null) return;
  const key = String(parentKey || '').toLowerCase();
  if (typeof value === 'string') {
    if (/(?:prompt|instruction|description|caption|scenario|script|text)/.test(key)) {
      output.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.slice(0, 100).forEach((item) => collectPromptLikeText(item, key, output, depth + 1));
    return;
  }
  if (typeof value === 'object') {
    Object.entries(value).slice(0, 200).forEach(([childKey, childValue]) => {
      collectPromptLikeText(childValue, childKey, output, depth + 1);
    });
  }
}

const ALLOWED_RUN_ENDPOINTS = new Set([
  '/.netlify/functions/run-aleph',
  '/.netlify/functions/run-gemini-omni-flash-1-1',
  '/.netlify/functions/run-gemini-omni-video',
  '/.netlify/functions/run-gpt-image-1-5',
  '/.netlify/functions/run-gpt-image-2',
  '/.netlify/functions/run-grok-image',
  '/.netlify/functions/run-grok-video',
  '/.netlify/functions/run-happyhorse-1',
  '/.netlify/functions/run-kling',
  '/.netlify/functions/run-kling-26',
  '/.netlify/functions/run-kling-3-turbo',
  '/.netlify/functions/run-kling-30',
  '/.netlify/functions/run-kling-motion-control',
  '/.netlify/functions/run-kling21',
  '/.netlify/functions/run-midjourney',
  '/.netlify/functions/run-mj-video',
  '/.netlify/functions/run-nano-banana',
  '/.netlify/functions/run-nano-banana-2',
  '/.netlify/functions/run-nano-banana-2-lite',
  '/.netlify/functions/run-nano-banana-pro',
  '/.netlify/functions/run-qwen-2',
  '/.netlify/functions/run-seedance-2',
  '/.netlify/functions/run-seedance-2-mini',
  '/.netlify/functions/run-seedance-25',
  '/.netlify/functions/run-seedance-25-cheap',
  '/.netlify/functions/run-seedance-cheap',
  '/.netlify/functions/run-seedream-4-5',
  '/.netlify/functions/run-seedream-5-lite',
  '/.netlify/functions/run-seedream-5-pro',
  '/.netlify/functions/run-sora2',
  '/.netlify/functions/run-veo3',
  '/.netlify/functions/run-veo31',
  '/.netlify/functions/run-wan-2-7-image',
  '/.netlify/functions/run-wan-27-video',
  '/.netlify/functions/run-z-image'
]);

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }, extraHeaders || {}),
    body: JSON.stringify(body)
  };
}

function requestBaseUrl(event) {
  const headers = event.headers || {};
  const host = headers['x-forwarded-host'] || headers.host;
  const protocol = headers['x-forwarded-proto'] || 'https';
  if (!host || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return '';
  return `${protocol}://${host}`;
}

function getHeader(event, name) {
  const headers = event.headers || {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || '';
}

async function authenticateUser(event) {
  const token = String(getHeader(event, 'authorization')).match(/^Bearer\s+(.+)$/i)?.[1] || '';
  if (!token || !SUPABASE_URL || !SERVICE_KEY) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  return payload && (payload.id || payload.user?.id) ? { id: String(payload.id || payload.user.id) } : null;
}

async function serviceRequest(path, options = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('missing_queue_environment');
  return fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    },
    signal: options.signal || AbortSignal.timeout(15000)
  });
}

async function serviceRpc(name, body) {
  const response = await serviceRequest(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(body || {}) });
  if (!response.ok) throw new Error(`${name}_${response.status}_${await response.text().catch(() => '')}`);
  return response.json().catch(() => null);
}

async function activeSubscription(userId) {
  const response = await serviceRequest(`/rest/v1/user_subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=status,plan_id,current_period_end&limit=1`);
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : null;
  const endMs = row?.current_period_end ? Date.parse(row.current_period_end) : 0;
  return row?.status === 'active' && Number.isFinite(endMs) && endMs > Date.now() ? row : null;
}

function normalizedToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[_\s.]+/g, '-').replace(/-+/g, '-');
}

function normalizedResolution(value) {
  const match = String(value || '').toLowerCase().match(/(720|1080|2160|1k|2k|4k)/);
  return match ? match[1].toUpperCase().replace(/^720$/, '720P').replace(/^1080$/, '1080P').replace(/^2160$/, '2160P') : '';
}

function unlimitedEligibility(planId, modelId, mediaKind, payload) {
  const model = normalizedToken(modelId);
  const kind = normalizedToken(mediaKind);
  const resolution = normalizedResolution(payload?.resolution || payload?.quality);
  const duration = Math.round(Number(payload?.duration || 0));
  const commonImage = new Set(['nano-banana-2-lite', 'z-image', 'seedream-5-lite', 'grok-image', 'qwen-2']);
  if (kind === 'image' && commonImage.has(model)) return true;
  if (kind === 'image' && model === 'nano-banana-2') {
    return resolution === '1K' || (planId === 'pro_max_monthly' && resolution === '2K');
  }
  if (kind === 'image' && model === 'gpt-image-2') {
    return resolution === '1K' || (planId === 'pro_max_monthly' && resolution === '2K');
  }
  if (kind === 'image' && model === 'wan-2-7-image') {
    return planId === 'pro_max_monthly' && normalizedToken(payload?.tier || payload?.quality || 'normal') === 'normal';
  }
  if (kind === 'video' && model === 'grok-video') return duration === 6;
  if (kind === 'video' && model === 'veo31-lite') {
    if (duration !== 8 || normalizedToken(payload?.model) !== 'veo3-lite') return false;
    if (planId === 'pro_monthly') return resolution === '720P';
    if (planId === 'pro_max_monthly') return resolution === '720P' || resolution === '1080P';
    return false;
  }
  if (kind === 'video' && (model === 'kling25' || model === 'kling-2-5-turbo')) {
    return planId === 'pro_max_monthly' && duration === 5 && (!resolution || resolution === '1080P');
  }
  return false;
}

async function readQueueJob(userId, jobId) {
  const response = await serviceRequest(`/rest/v1/unlimited_generation_jobs?id=eq.${encodeURIComponent(jobId)}&user_id=eq.${encodeURIComponent(userId)}&select=id,status,eligible_at,model_id,model_name,media_kind,run_id,provider_status,provider_response,error_message&limit=1`);
  if (!response.ok) throw new Error(`queue_status_${response.status}`);
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function dispatchQueuedJob(baseUrl, jobId) {
  if (!QUEUE_SECRET) throw new Error('missing_queue_secret');
  const response = await fetch(`${baseUrl}/.netlify/functions/process-unlimited-generation-background`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hansora-Queue-Secret': QUEUE_SECRET },
    body: JSON.stringify({ job_id: jobId }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok && response.status !== 202) throw new Error(`queue_dispatch_${response.status}`);
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Cache-Control': 'no-store' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed.' }, { Allow: 'POST, OPTIONS' });
  }

  let request;
  try {
    request = JSON.parse(event.body || '{}');
  } catch (_) {
    return json(400, { ok: false, error: 'Invalid JSON request.' });
  }

  if (request.action === 'unlimited-status' || request.action === 'unlimited-list') {
    const user = await authenticateUser(event);
    if (!user) return json(401, { ok: false, error: 'Authentication required.' });
    try {
      if (request.action === 'unlimited-list') {
        const response = await serviceRequest(`/rest/v1/unlimited_generation_jobs?user_id=eq.${encodeURIComponent(user.id)}&status=in.(queued,running)&select=id,status,eligible_at,model_id,model_name,media_kind,run_id,prompt,created_at&order=created_at.asc`);
        if (!response.ok) throw new Error(`queue_list_${response.status}`);
        return json(200, { ok: true, jobs: await response.json().catch(() => []) });
      }
      const jobId = String(request.queue_job_id || '').trim();
      if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json(400, { ok: false, error: 'Invalid queue job.' });
      const job = await readQueueJob(user.id, jobId);
      if (!job) return json(404, { ok: false, error: 'Queue job not found.' });
      if (job.status === 'submitted') {
        return json(200, {
          ok: true,
          queue_status: 'submitted',
          queue_job_id: job.id,
          provider_status: job.provider_status,
          provider_response: job.provider_response || {}
        });
      }
      if (job.status === 'failed' || job.status === 'cancelled') {
        return json(200, {
          ok: false,
          queue_status: job.status,
          queue_job_id: job.id,
          error: job.error_message || job.provider_response?.message || job.provider_response?.error || 'Queued generation failed.'
        });
      }
      return json(202, {
        ok: true,
        queue_status: job.status,
        queue_job_id: job.id,
        eligible_at: job.eligible_at,
        model_id: job.model_id,
        media_kind: job.media_kind,
        message: 'Unlimited generation queued due to high recent usage. Credit generations remain available with priority processing.'
      });
    } catch (error) {
      console.error('unlimited_queue_status_failed', error && error.message);
      return json(503, { ok: false, error: 'Unlimited queue status is temporarily unavailable.' });
    }
  }

  const prompt = String(request.prompt || '');
  const targetEndpoint = String(request.target_endpoint || '');
  const modelId = String(request.model_id || '').slice(0, 100);
  const mediaKind = String(request.kind || '').slice(0, 20);

  if (!ALLOWED_RUN_ENDPOINTS.has(targetEndpoint)) {
    return json(400, { ok: false, error: 'Unsupported generation endpoint.' });
  }
  if (!request.payload || typeof request.payload !== 'object' || Array.isArray(request.payload)) {
    return json(400, { ok: false, error: 'Generation payload is required.' });
  }

  const promptParts = [prompt];
  collectPromptLikeText(request.payload, 'payload', promptParts, 0);
  const moderationText = Array.from(new Set(promptParts.map((part) => String(part || '').trim()).filter(Boolean))).join('\n');

  const decision = evaluatePrompt(moderationText);
  const decisionId = crypto.randomUUID();
  const promptHash = crypto.createHash('sha256').update(moderationText).digest('hex').slice(0, 16);
  console.info('content_safety_decision', JSON.stringify({
    decisionId,
    allowed: decision.allowed,
    category: decision.category,
    policyVersion: decision.policyVersion,
    modelId,
    mediaKind,
    promptHash,
    timestamp: new Date().toISOString()
  }));

  if (!decision.allowed) {
    return json(422, {
      ok: false,
      code: 'CONTENT_POLICY_BLOCKED',
      message: publicMessage(decision),
      category: decision.category,
      decision_id: decisionId,
      policy_version: decision.policyVersion
    }, { 'X-Content-Safety': 'blocked' });
  }

  if (request.check_only === true) {
    return json(200, {
      ok: true,
      allowed: true,
      decision_id: decisionId,
      policy_version: decision.policyVersion
    }, { 'X-Content-Safety': 'approved' });
  }

  const baseUrl = requestBaseUrl(event);
  if (!baseUrl) {
    return json(503, {
      ok: false,
      code: 'CONTENT_SAFETY_UNAVAILABLE',
      message: 'Safety verification is temporarily unavailable. Please try again.'
    });
  }

  const usageMode = normalizedToken(request.usage_mode || request.billing_mode);
  if (usageMode === 'unlimited') {
    const user = await authenticateUser(event);
    if (!user) return json(401, { ok: false, error: 'Authentication required for Unlimited generation.' });
    const claimedUid = String(getHeader(event, 'x-user-id') || request.payload.uid || request.payload.user_id || '').trim();
    if (claimedUid && claimedUid !== user.id) return json(403, { ok: false, error: 'User identity mismatch.' });
    if (!SUPABASE_URL || !SERVICE_KEY || !QUEUE_SECRET) {
      return json(503, { ok: false, error: 'Unlimited queue is temporarily unavailable.' });
    }
    try {
      const subscription = await activeSubscription(user.id);
      if (!subscription || !['premium_monthly', 'pro_monthly', 'pro_max_monthly'].includes(subscription.plan_id)) {
        return json(403, { ok: false, error: 'An active Unlimited subscription is required.' });
      }
      if (!unlimitedEligibility(subscription.plan_id, modelId, mediaKind, request.payload)) {
        return json(403, { ok: false, error: 'This model setting is not Unlimited on your current plan.' });
      }
      const queuedPayload = { ...request.payload, uid: user.id, user_id: user.id, billing_mode: 'unlimited' };
      const runId = String(queuedPayload.run_id || queuedPayload.runId || `${user.id}-${Date.now()}`);
      queuedPayload.run_id = runId;
      const queued = await serviceRpc('hansora_enqueue_unlimited_generation', {
        p_user_id: user.id,
        p_plan_id: subscription.plan_id,
        p_kind: mediaKind,
        p_model_id: modelId,
        p_model_name: String(request.model_name || modelId).slice(0, 200),
        p_target_endpoint: targetEndpoint,
        p_prompt: prompt,
        p_payload: queuedPayload,
        p_run_id: runId
      });
      if (!queued || !queued.id) throw new Error('queue_insert_failed');
      if (queued.already_active && queued.run_id !== runId) {
        return json(409, {
          ok: false,
          code: 'UNLIMITED_CATEGORY_BUSY',
          queue_job_id: queued.id,
          queue_status: queued.status,
          model_id: queued.model_id,
          message: `An Unlimited ${mediaKind} generation is already queued or starting. Credit generations remain available.`
        });
      }
      let queueStatus = queued.status || 'queued';
      if (Number(queued.delay_seconds || 0) <= 0 && queueStatus === 'queued') {
        const claimed = await serviceRpc('hansora_claim_due_unlimited_generation', { p_job_id: queued.id });
        if (claimed?.id) {
          queueStatus = 'running';
          try {
            await dispatchQueuedJob(baseUrl, queued.id);
          } catch (dispatchError) {
            console.error('unlimited_queue_immediate_dispatch_failed', dispatchError && dispatchError.message);
            await serviceRpc('hansora_release_unlimited_generation', { p_job_id: queued.id });
            queueStatus = 'queued';
          }
        }
      }
      return json(202, {
        ok: true,
        queue_job_id: queued.id,
        queue_status: queueStatus,
        eligible_at: queued.eligible_at,
        delay_seconds: Number(queued.delay_seconds || 0),
        run_id: queued.run_id,
        message: Number(queued.delay_seconds || 0) > 0
          ? 'Unlimited generation queued due to high recent usage. Credit generations remain available with priority processing.'
          : 'Unlimited generation is in queue and will begin shortly. Credit generations remain available with priority processing.'
      }, { 'X-Content-Safety': 'approved', 'X-Content-Safety-Decision': decisionId });
    } catch (error) {
      console.error('unlimited_queue_submit_failed', JSON.stringify({ modelId, mediaKind, message: error && error.message }));
      return json(503, { ok: false, error: 'Unlimited queue is temporarily unavailable. No provider request was made.' });
    }
  }

  if (usageMode === 'credits') {
    request.payload = { ...request.payload, billing_mode: 'credits' };
  }

  const incomingHeaders = event.headers || {};
  const forwardHeaders = {
    'Content-Type': 'application/json',
    'X-Content-Safety-Decision': decisionId,
    'X-Content-Safety-Policy': decision.policyVersion
  };
  if (incomingHeaders.authorization) forwardHeaders.Authorization = incomingHeaders.authorization;
  if (incomingHeaders['x-user-id']) forwardHeaders['X-USER-ID'] = incomingHeaders['x-user-id'];

  try {
    const response = await fetch(`${baseUrl}${targetEndpoint}`, {
      method: 'POST',
      headers: forwardHeaders,
      body: JSON.stringify(request.payload),
      redirect: 'manual',
      signal: AbortSignal.timeout(55000)
    });
    const responseBody = await response.text();
    return {
      statusCode: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Safety': 'approved',
        'X-Content-Safety-Decision': decisionId
      },
      body: responseBody
    };
  } catch (error) {
    console.error('safe_run_forward_failed', JSON.stringify({ decisionId, modelId, message: error && error.message }));
    return json(503, {
      ok: false,
      code: 'CONTENT_SAFETY_UNAVAILABLE',
      message: 'Safety verification is temporarily unavailable. Please try again.'
    });
  }
};

exports.evaluatePrompt = evaluatePrompt;
exports.POLICY_VERSION = POLICY_VERSION;
exports.unlimitedEligibility = unlimitedEligibility;
