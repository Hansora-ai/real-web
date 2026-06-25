// netlify/functions/run-kid-cartoon-seedance-2.js
// Dedicated KIE Seedance 2.0 launcher for the Kid Cartoon Studio page.
const KIE_BASE = (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/+$/, '');
const KIE_KEY = process.env.KIE_API_KEY || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SITE_BASE = (process.env.SITE_BASE || 'https://hansora.co').replace(/\/+$/, '');
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/kid-cartoon-check`;

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...cors() },
  body: JSON.stringify(body),
});

function getHeader(event, key) {
  return event.headers?.[key] || event.headers?.[key.toLowerCase()] || event.headers?.[key.toUpperCase()] || null;
}

function getUID(event, body) {
  const qs = new URLSearchParams(event.queryStringParameters || {});
  return String(getHeader(event, 'x-user-id') || body?.uid || body?.user_id || qs.get('uid') || '').trim();
}

async function verifyAuth(event, uid) {
  const auth = getHeader(event, 'authorization') || '';
  const token = (auth.match(/^Bearer\s+(.+)$/i) || [])[1] || '';
  if (!token) return { ok: false, error: 'missing_auth' };
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { ok: false, error: 'bad_auth', status: res.status };
  const user = await res.json().catch(() => null);
  const id = user && (user.id || user.user?.id);
  if (!id || String(id) !== String(uid)) return { ok: false, error: 'uid_mismatch' };
  return { ok: true };
}

function extractTaskId(data) {
  if (!data || typeof data !== 'object') return '';
  const direct = [
    data?.data?.taskId,
    data?.taskId,
    data?.result?.taskId,
    data?.data?.task_id,
    data?.task_id,
    data?.id,
  ].map((v) => (v == null ? '' : String(v))).find((v) => v.length > 3);
  if (direct) return direct;
  const seen = new Set();
  const scan = (value) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return '';
    seen.add(value);
    for (const [key, inner] of Object.entries(value)) {
      if (/^(task[_-]?id|request[_-]?id|id)$/i.test(key) && (typeof inner === 'string' || typeof inner === 'number')) {
        const out = String(inner);
        if (out.length > 3) return out;
      }
      const nested = scan(inner);
      if (nested) return nested;
    }
    return '';
  };
  return scan(data);
}

function clampDuration(value) {
  const duration = Number(value || 5);
  if (!Number.isFinite(duration)) return 5;
  return Math.min(15, Math.max(4, Math.round(duration)));
}

function normalizeAspect(value) {
  const aspect = String(value || '16:9').trim();
  return ['16:9', '9:16', '1:1', '4:3', '3:4'].includes(aspect) ? aspect : '16:9';
}

function normalizeResolution(value) {
  const resolution = String(value || '720p').trim();
  return ['720p', '1080p'].includes(resolution) ? resolution : '720p';
}

function costFor(body) {
  const duration = clampDuration(body.duration);
  const resolution = normalizeResolution(body.resolution);
  return Number((duration * (resolution === '1080p' ? 5.5 : 2.5)).toFixed(1));
}

function cleanUserPrompt(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\bwiht\b/gi, 'with')
    .replace(/\bgerl\b/gi, 'girl')
    .replace(/\bgril\b/gi, 'girl')
    .replace(/\banmials\b/gi, 'animals')
    .replace(/\banimals?\s+play(?:ing)?\b/gi, 'playing with animals')
    .trim()
    .slice(0, 500);
}

function detectMotion(action) {
  const text = String(action || '').toLowerCase();
  // Actions where the child is NOT standing on the ground — grounding rules must be relaxed.
  if (/\b(fly|flying|flies|flew|float|floating|hover|hovering|soar|soaring|glide|gliding|fall|falling|jump|jumping|leap|leaping|swim|swimming|dive|diving|underwater|in the (sky|air|clouds|water)|among the clouds)\b/i.test(text)) {
    return 'airborne';
  }
  return 'grounded';
}

function buildScenePlan(action, body) {
  const duration = clampDuration(body.duration);
  const aspect = normalizeAspect(body.aspect_ratio);
  const motion = detectMotion(action);
  const framing = aspect === '9:16'
    ? 'Vertical 9:16 framing: keep the full child and the main action inside the frame with safe headroom.'
    : aspect === '1:1'
      ? 'Square framing: keep the full child, hands, and the main action inside the frame.'
      : 'Wide cinematic framing: keep the child as the clear main subject while showing the full action around them.';

  // Always build the beats FROM the user's idea. Never substitute a different canned scene.
  const beats = [
    `Concrete ${duration}-second story beats built directly from the user's idea "${action}": open with an establishing shot that clearly shows the child already in the scene and beginning to do "${action}"; middle beat, the child fully performs "${action}" with readable body movement and a clear emotional reaction; final beat, the action resolves with a warm, expressive moment and small natural background motion.`,
    `The child must be actively doing exactly what the user described ("${action}") — not posing, not a still portrait, and never a different activity than the one requested.`,
    `Anything the user mentioned (such as animals, objects, or a setting) must appear in the role the user described, supporting "${action}" rather than replacing it.`,
  ];

  if (motion === 'airborne') {
    beats.push(`Because the action involves being off the ground, the child must be convincingly airborne/in motion: full body visible, a clear sense of height, lift, and movement, with hair and clothing reacting to the air. Do NOT force the child onto the ground and do NOT downgrade "${action}" into sitting, standing, or kneeling.`);
    beats.push('Anatomy: keep the body, arms, hands, legs, and face clean, connected, and proportional while in the air, with no duplicated or detached limbs.');
  } else {
    beats.push('Grounding and anatomy: keep the child visibly on solid ground or a seat (never half-buried or hidden by foreground objects), with hands, arms, legs, and face clean and readable.');
  }

  beats.push(framing);
  return beats;
}

function buildCartoonPrompt(body) {
  const userAction = cleanUserPrompt(body.prompt || body.short_prompt);
  const styleMode = String(body.style_mode || body.character_style || 'cartoon').toLowerCase() === 'realistic'
    ? 'realistic'
    : 'cartoon';
  const action = userAction || 'the child having a joyful gentle adventure with friendly animals';
  const intro = styleMode === 'realistic'
    ? 'Create a cinematic video set in a beautiful, polished 3D Pixar-style animated world, with a photorealistic, real human child (matching the uploaded reference photo) already present in the scene from the very first frame. The child stays 100% photorealistic, like real camera footage, while everything around them — environment, props, animals, sky, and lighting — is rendered as a gorgeous high-end 3D Pixar-style scene.'
    : 'Create a polished, high-end 3D Pixar-style animated video from the uploaded child reference photo(s), where both the child and the whole world are rendered in beautiful Pixar-style 3D animation.';
  const scenePlan = buildScenePlan(action, body);
  const actionBlock = [
    `Core user scene idea: ${action}. Treat this as the required centerpiece: follow it literally, then creatively ENHANCE and expand it into a vivid, beautiful, imaginative animated sequence — keep the exact requested action as the main event and add complementary, related secondary actions, charming details, and rich atmosphere around it. Never swap the user's action for a different one.`,
    ...scenePlan,
  ];
  const identity = [
    'Use the reference photo(s) to preserve the child exactly: face shape, hair, skin tone, age, proportions, expression, clothing cues, and recognizable personality.',
    'If more than one child is shown, preserve each child individually and keep their relative ages and appearances distinct.',
    'Do not replace the child with a different character, do not age them up or down, do not change ethnicity, and do not invent extra children unless the action clearly requires background extras.',
  ];
  const shared = [
    'Camera direction: smooth gentle dolly-in or slow arc camera movement, no random cuts, no sudden zooms, keep the child and the main action readable throughout.',
    'Make the scene warm, charming, cinematic, safe, colorful, and emotionally expressive, with soft natural lighting, clean composition, a richly detailed beautiful background, and playful storybook energy.',
  ];
  const style = styleMode === 'realistic'
    ? [
        'Character treatment: keep the referenced child FULLY photorealistic and highly detailed — real human skin with natural texture and pores, lifelike facial details, normal human eyes, realistic proportions, and realistic hair. The child must NOT be cartoon, NOT Pixar-stylized, and NOT a CGI/3D-render look; they must look like the real child from the photo, as if filmed by a real camera.',
        'Environment treatment: render everything around the child — setting, props, sky, animals, and effects — in a beautiful, polished, high-end 3D Pixar animation style, so the realistic real child belongs naturally inside a charming Pixar-style world. Match the lighting so the realistic child sits naturally and believably within the stylized 3D world.',
      ]
    : [
        'Character treatment: transform the referenced child into an appealing 3D Pixar-style animated character while preserving a strict one-to-one (1:1) likeness to the uploaded photo — the exact same face, hair, skin tone, age, and proportions, instantly recognizable as the same child, just rendered as polished Pixar-style 3D.',
        'Environment treatment: render the entire world — child, setting, props, animals, and effects — in one consistent, beautiful, high-end 3D Pixar animation style with expressive eyes, soft rounded forms, and polished Pixar-like materials.',
      ];
  const quality = [
    'Avoid distorted faces, identity drift, duplicate limbs, warped hands, missing fingers, fused bodies, creepy expressions, text, logos, watermarks, and low-quality motion.',
    'Do not make a simple still portrait. Do not crop the body in a way that hides the action. Do not bury the child in grass, flowers, blankets, fog, or foreground objects.',
    'Keep the child as the main subject and make the action easy to understand within the selected duration.',
  ];
  return [intro, ...actionBlock, ...style, ...identity, ...shared, ...quality].join(' ');
}

async function fetchGeneration(uid, runId) {
  const url = `${SUPABASE_URL}/rest/v1/user_generations?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(runId)}&select=id,meta`;
  const res = await fetch(url, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function insertGeneration(uid, runId, prompt, meta) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_generations`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ user_id: uid, provider: 'Kid Cartoon Studio', kind: 'video', prompt, result_url: null, meta }),
  });
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0].id : null;
}

async function patchGeneration(rowId, meta) {
  if (!rowId) return;
  await fetch(`${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(rowId)}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ meta }),
  });
}

async function debitCredits(uid, cost) {
  const profileUrl = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
  const profileRes = await fetch(profileUrl, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  const rows = await profileRes.json().catch(() => []);
  const current = Number(Array.isArray(rows) && rows[0] ? rows[0].credits : 0);
  if (current < cost) return { ok: false, error: 'not_enough_credits', credits: current };
  const next = Number((current - cost).toFixed(2));
  const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ credits: next }),
  });
  if (!updateRes.ok) return { ok: false, error: 'profile_update_failed', status: updateRes.status };
  return { ok: true, credits: next };
}

async function getCredits(uid) {
  const profileUrl = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
  const profileRes = await fetch(profileUrl, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  const rows = await profileRes.json().catch(() => []);
  return Number(Array.isArray(rows) && rows[0] ? rows[0].credits : 0);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  try {
    if (!KIE_KEY || !SUPABASE_URL || !SERVICE_KEY) return json(500, { ok: false, error: 'missing_env' });
    const body = JSON.parse(event.body || '{}');
    const uid = getUID(event, body);
    if (!uid) return json(401, { ok: false, error: 'missing_uid' });
    const auth = await verifyAuth(event, uid);
    if (!auth.ok) return json(401, { ok: false, error: auth.error, details: auth });

    const referenceImageUrls = Array.isArray(body.image_urls)
      ? body.image_urls.filter(Boolean).map(String).slice(0, 4)
      : [];
    if (!referenceImageUrls.length) return json(400, { ok: false, error: 'missing_child_photo' });

    const prompt = buildCartoonPrompt(body);
    const runId = String(body.run_id || `${uid}-${Date.now()}`);
    const existing = await fetchGeneration(uid, runId);
    const existingTask = existing?.meta?.task_id || existing?.meta?.taskId || '';
    if (existingTask) return json(200, { ok: true, submitted: true, taskId: existingTask, run_id: runId, already_submitted: true });

    const duration = clampDuration(body.duration);
    const resolution = normalizeResolution(body.resolution);
    const aspectRatio = normalizeAspect(body.aspect_ratio);
    const cost = costFor({ duration, resolution });
    const metaBase = {
      source: 'kie',
      engine: 'kid-cartoon-seedance-2.0',
      model: 'bytedance/seedance-2',
      style_mode: String(body.style_mode || 'cartoon').toLowerCase() === 'realistic' ? 'realistic' : 'cartoon',
      run_id: runId,
      status: 'pending',
      refund_amount: cost,
      reference_image_urls: referenceImageUrls,
    };
    const rowId = existing?.id || await insertGeneration(uid, runId, prompt, metaBase);

    const currentCredits = await getCredits(uid);
    if (currentCredits < cost) {
      return json(402, { ok: false, error: 'not_enough_credits', credits: currentCredits, need: cost });
    }

    const input = {
      prompt,
      resolution,
      duration,
      aspect_ratio: aspectRatio,
      generate_audio: body.generate_audio !== false,
      return_last_frame: false,
      web_search: false,
      nsfw_checker: body.nsfw_checker === undefined ? false : !!body.nsfw_checker,
      reference_image_urls: referenceImageUrls,
    };
    const callback = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(runId)}`;
    const kieRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'bytedance/seedance-2', input, callBackUrl: callback }),
    });
    const data = await kieRes.json().catch(() => ({}));
    if (!kieRes.ok) {
      await patchGeneration(rowId, { ...metaBase, status: 'failed', error: data });
      return json(kieRes.status || 502, { ok: false, error: 'kie_create_failed', details: data });
    }
    if (data && data.code && Number(data.code) !== 200) {
      await patchGeneration(rowId, { ...metaBase, status: 'failed', error: data });
      return json(422, { ok: false, error: 'kie_create_failed', details: data });
    }
    const taskId = extractTaskId(data);
    if (!taskId) {
      await patchGeneration(rowId, { ...metaBase, status: 'failed', error: data || 'missing_task_id' });
      return json(502, { ok: false, error: 'missing_task_id', details: data });
    }

    const debit = await debitCredits(uid, cost);
    if (!debit.ok) return json(402, { ok: false, error: debit.error, details: debit });

    const meta = {
      ...metaBase,
      status: 'processing',
      task_id: taskId,
      charged: true,
      charged_at: new Date().toISOString(),
      charged_cost: cost,
      debited: cost,
      refund_amount: cost,
      reference_count: referenceImageUrls.length,
    };
    await patchGeneration(rowId, meta);
    return json(201, {
      ok: true,
      submitted: true,
      taskId,
      id: taskId,
      run_id: runId,
      row_id: rowId,
      debited: cost,
      credits: debit.credits,
      prompt,
    });
  } catch (error) {
    return json(500, { ok: false, error: 'server_error', details: String(error && error.message || error) });
  }
};
