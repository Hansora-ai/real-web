'use strict';

const crypto = require('node:crypto');

const POLICY_VERSION = '2026-08-11.5';

const NSFW_TERMS = [
  'adult content', 'bare breasts', 'blow job', 'blowjob', 'boob', 'boobs',
  'breast', 'breasts', 'clit', 'cock', 'dick', 'erotic', 'explicit sex',
  'fetish', 'fuck', 'fucking', 'genital', 'genitals', 'hardcore', 'hentai',
  'jerk off', 'masturbate', 'masturbating', 'masturbation', 'milf', 'naked',
  'no clothes', 'nude', 'nudity', 'onlyfans', 'orgasm', 'penis', 'porn',
  'pornographic', 'pussy', 'sex', 'sexual', 'slut', 'strip naked', 'topless',
  'undress', 'vagina', 'vergina', 'whore', 'without clothes', 'xxx',
  'desnuda', 'desnudo', 'sexo', 'pornografia', 'nue', 'nu', 'sexe',
  'голая', 'голый', 'обнаженная', 'обнаженный', 'порно', 'секс'
];

const MINOR_TERMS = [
  'baby', 'boy', 'child', 'children', 'girl', 'high schooler', 'kid', 'kids',
  'minor', 'schoolgirl', 'schoolboy', 'teen', 'teenage', 'teenager',
  'underage', 'young looking'
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

function evaluatePrompt(prompt) {
  const normalized = normalizePrompt(prompt);
  if (!normalized) return { allowed: true, category: null, policyVersion: POLICY_VERSION };

  const sexual = containsTerm(normalized, NSFW_TERMS);
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

  const prompt = String(request.prompt || '');
  const targetEndpoint = String(request.target_endpoint || '');
  const modelId = String(request.model_id || '').slice(0, 100);
  const mediaKind = String(request.kind || '').slice(0, 20);

  if (prompt.length > 20000) {
    return json(413, { ok: false, error: 'Prompt is too long.' });
  }
  if (!ALLOWED_RUN_ENDPOINTS.has(targetEndpoint)) {
    return json(400, { ok: false, error: 'Unsupported generation endpoint.' });
  }
  if (!request.payload || typeof request.payload !== 'object' || Array.isArray(request.payload)) {
    return json(400, { ok: false, error: 'Generation payload is required.' });
  }

  const promptParts = [prompt];
  collectPromptLikeText(request.payload, 'payload', promptParts, 0);
  const moderationText = Array.from(new Set(promptParts.map((part) => String(part || '').trim()).filter(Boolean))).join('\n');
  if (moderationText.length > 60000) {
    return json(413, { ok: false, error: 'Combined prompt content is too long.' });
  }

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

  const baseUrl = requestBaseUrl(event);
  if (!baseUrl) {
    return json(503, {
      ok: false,
      code: 'CONTENT_SAFETY_UNAVAILABLE',
      message: 'Safety verification is temporarily unavailable. Please try again.'
    });
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
