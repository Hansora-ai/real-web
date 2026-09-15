import { authenticateRequest, anonymousIdentity, isUuid, requestIpHash } from '../../lib/sales-agent/auth.mjs';
import { buildInstructions } from '../../lib/sales-agent/playbook.mjs';
import { generateSalesReply } from '../../lib/sales-agent/provider.mjs';
import { executeTool } from '../../lib/sales-agent/tools.mjs';
import { appendMessage, detectLanguage, ensureSession, getMessages, logUsage, recordEvent, reserveRequest, updateSessionMemory } from '../../lib/sales-agent/store.mjs';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

function response(statusCode, body, cookie) {
  return {
    statusCode,
    headers: { ...JSON_HEADERS, ...(cookie ? { 'Set-Cookie': cookie } : {}) },
    body: JSON.stringify(body)
  };
}

function parseBody(event) {
  if (Buffer.byteLength(event.body || '', 'utf8') > 16_384) {
    const error = new Error('request_too_large');
    error.status = 413;
    throw error;
  }
  try {
    return JSON.parse(event.body || '{}');
  } catch (_) {
    const error = new Error('invalid_json');
    error.status = 400;
    throw error;
  }
}

function publicMessages(messages) {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    response: message.role === 'assistant' ? message.response_json : null,
    created_at: message.created_at
  }));
}

function estimatedCost(usage) {
  const uncached = Math.max(0, usage.input - usage.cached);
  return Number(((uncached * 0.20 + usage.cached * 0.02 + usage.output * 1.20) / 1_000_000).toFixed(8));
}

function instantSalesReply(message, language) {
  const text = String(message || '').trim().toLowerCase();
  const isCheapestVideo = /cheapest|most affordable/.test(text)
    || /ամենամատչելի/.test(text)
    || /сам(?:ая|ый|ое).*деш|сам(?:ая|ый|ое).*доступ/.test(text);
  const isArmenianVideo = /armenian.*(?:speak|speech|video)/.test(text)
    || /հայերեն.*(?:խոս|տեսանյութ|վիդեո)/.test(text)
    || /армянск.*(?:реч|говор|видео)/.test(text);
  const isPackageChoice = /(?:which|what).*credit package|credit package.*(?:choose|fit)/.test(text)
    || /կրեդիտային.*փաթեթ|փաթեթ.*ընտր/.test(text)
    || /какой.*пакет.*кредит|пакет.*кредит.*выб/.test(text);

  if (isCheapestVideo) {
    const messages = {
      en: 'Grok Video is Hansora’s most affordable and most-used video model. It is a good starting point for frequent Reels and testing ideas with lower credit risk.',
      hy: 'Grok Video-ը Hansora-ի ամենամատչելի և ամենաշատ օգտագործվող վիդեո մոդելն է։ Այն հարմար մեկնարկային տարբերակ է հաճախակի Reels ստեղծելու և գաղափարները քիչ կրեդիտային ռիսկով փորձարկելու համար։',
      ru: 'Grok Video — самая доступная и наиболее используемая видеомодель Hansora. Это хороший стартовый вариант для регулярных Reels и тестирования идей с меньшими затратами кредитов.'
    };
    const labels = { en: 'Open Grok Video', hy: 'Բացել Grok Video-ը', ru: 'Открыть Grok Video' };
    return {
      message: messages[language] || messages.en,
      language,
      intent: 'model_recommendation',
      recommended_model: 'grok-video',
      recommended_package: null,
      quote_id: null,
      memory: { business_type: null, main_goal: 'Affordable video', objection: 'price', purchase_intent: 'low' },
      actions: [{ type: 'open_model', label: labels[language] || labels.en, model: 'grok-video', package: null }]
    };
  }

  if (isArmenianVideo) {
    const messages = {
      en: 'For Armenian-speaking video, Gemini Omni or a suitable Veo model is the best direction. Do you need a talking person/avatar, or a narrated advertising video?',
      hy: 'Հայերեն խոսող տեսանյութի համար լավագույն ուղղությունը Gemini Omni-ն կամ համապատասխան Veo մոդելն է։ Ձեզ խոսող անձ/ավատա՞ր է անհրաժեշտ, թե՞ ձայնային գովազդային տեսանյութ։',
      ru: 'Для видео с армянской речью лучше всего подойдут Gemini Omni или соответствующая модель Veo. Вам нужен говорящий человек/аватар или рекламный ролик с озвучкой?'
    };
    return {
      message: messages[language] || messages.en,
      language,
      intent: 'qualification',
      recommended_model: null,
      recommended_package: null,
      quote_id: null,
      memory: { business_type: null, main_goal: 'Armenian-speaking video', objection: null, purchase_intent: 'unknown' },
      actions: []
    };
  }

  if (isPackageChoice) {
    const messages = {
      en: 'To recommend the smallest suitable package, will you create images or videos, and approximately how many?',
      hy: 'Ամենափոքր համապատասխան փաթեթն առաջարկելու համար նշեք՝ պատկերնե՞ր եք ստեղծելու, թե՞ տեսանյութեր, և մոտավորապես քանի հատ։',
      ru: 'Чтобы предложить минимальный подходящий пакет, уточните: Вы будете создавать изображения или видео и примерно в каком количестве?'
    };
    return {
      message: messages[language] || messages.en,
      language,
      intent: 'qualification',
      recommended_model: null,
      recommended_package: null,
      quote_id: null,
      memory: { business_type: null, main_goal: 'Choose a credit package', objection: null, purchase_intent: 'medium' },
      actions: []
    };
  }

  return null;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return response(204, {});
  if (!['GET', 'POST'].includes(event.httpMethod)) return response(405, { error: 'method_not_allowed' });

  const anonymous = anonymousIdentity(event);
  let trackedSession = null;
  let trackedRequestId = null;
  try {
    const user = await authenticateRequest(event);
    if (String(process.env.SALES_AGENT_ENABLED || 'false').toLowerCase() !== 'true') {
      return response(503, { error: 'sales_agent_disabled' }, anonymous.setCookie);
    }

    const params = event.queryStringParameters || {};
    if (event.httpMethod === 'GET') {
      const language = detectLanguage('', params.language || 'en');
      const session = await ensureSession({ user, anonymous, requestedSessionId: params.session_id, language });
      const messages = await getMessages(session.id, 50);
      return response(200, {
        session_id: session.id,
        language: session.language,
        authenticated: Boolean(user),
        messages: publicMessages(messages)
      }, anonymous.setCookie);
    }

    const body = parseBody(event);
    const message = String(body.message || '').trim();
    if (!message || message.length > 4000 || !isUuid(body.request_id)) {
      return response(400, { error: 'invalid_message_or_request_id' }, anonymous.setCookie);
    }
    const language = detectLanguage(message, body.language || 'en');
    const session = await ensureSession({
      user,
      anonymous,
      requestedSessionId: body.session_id,
      language
    });
    trackedSession = session;
    trackedRequestId = body.request_id;
    const existing = (await getMessages(session.id, 50)).find(
      (item) => item.request_id === body.request_id && item.role === 'assistant'
    );
    if (existing) {
      return response(200, {
        session_id: session.id,
        message_id: existing.id,
        reply: existing.response_json,
        replayed: true
      }, anonymous.setCookie);
    }

    const allowed = await reserveRequest({ user, anonymous, ipHash: requestIpHash(event) });
    if (!allowed) return response(429, { error: 'rate_limit_exceeded' }, anonymous.setCookie);

    const before = await getMessages(session.id, 30);
    await appendMessage(session.id, body.request_id, 'user', message);
    if (!before.some((item) => item.role === 'user')) {
      await recordEvent(session, {
        type: 'first_message_sent',
        language,
        idempotencyKey: `first-message:${body.request_id}`
      }).catch(() => null);
    }

    const history = [...before, { role: 'user', content: message }].slice(-16);
    const instantReply = instantSalesReply(message, language);
    const generated = instantReply ? {
      reply: instantReply,
      usage: { input: 0, cached: 0, output: 0 },
      provider: 'local',
      providerCredits: 0,
      model: 'hansora-instant-v1',
      latencyMs: 0,
      retries: 0,
      toolCalls: []
    } : await generateSalesReply({
      instructions: buildInstructions({ language, summary: session.summary, salesMemory: session.sales_memory }),
      messages: history,
      executeTool: (name, args) => executeTool(name, args, { user }),
      safetyIdentifier: user?.id || anonymous.secretHash
    });
    const publicReply = { ...generated.reply };
    delete publicReply.memory;
    const assistant = await appendMessage(session.id, body.request_id, 'assistant', publicReply.message, {
      responseJson: publicReply,
      modelUsed: generated.model,
      inputTokens: generated.usage.input,
      cachedInputTokens: generated.usage.cached,
      outputTokens: generated.usage.output
    });
    await updateSessionMemory(session, message, generated.reply, assistant?.sequence).catch(() => null);
    await logUsage({
      session_id: session.id,
      message_id: assistant?.id || null,
      request_id: body.request_id,
      model: generated.model,
      provider: generated.provider,
      provider_credits: generated.providerCredits,
      input_tokens: generated.usage.input,
      cached_input_tokens: generated.usage.cached,
      output_tokens: generated.usage.output,
      tool_calls: generated.toolCalls.length,
      retry_count: generated.retries,
      latency_ms: generated.latencyMs,
      estimated_cost_usd: generated.provider === 'openai' ? estimatedCost(generated.usage) : null
    }).catch(() => null);

    if (generated.reply.recommended_model) {
      await recordEvent(session, {
        type: 'model_recommended',
        language: generated.reply.language,
        modelId: generated.reply.recommended_model,
        messageId: assistant?.id,
        idempotencyKey: `model:${body.request_id}`
      }).catch(() => null);
    }
    if (generated.reply.recommended_package) {
      await recordEvent(session, {
        type: 'package_recommended',
        language: generated.reply.language,
        packageId: generated.reply.recommended_package,
        messageId: assistant?.id,
        idempotencyKey: `package:${body.request_id}`
      }).catch(() => null);
    }
    return response(200, {
      session_id: session.id,
      message_id: assistant?.id,
      reply: publicReply
    }, anonymous.setCookie);
  } catch (error) {
    console.error('sales-chat error', {
      message: error?.message,
      status: error?.status,
      requestId: event?.headers?.['x-nf-request-id'] || null
    });
    if (trackedSession) {
      await logUsage({
        session_id: trackedSession.id,
        request_id: trackedRequestId,
        provider: process.env.SALES_AGENT_PROVIDER || (process.env.KIE_API_KEY ? 'kie' : 'openai'),
        model: process.env.SALES_AGENT_MODEL || (process.env.KIE_API_KEY ? 'gpt-5-6-luna' : 'gpt-5.6-luna'),
        error_category: String(error?.message || 'request_failed').slice(0, 120)
      }).catch(() => null);
    }
    const status = Number(error?.status) || 500;
    const publicError = status === 401 ? 'authentication_failed'
      : ['openai_not_configured', 'kie_not_configured'].includes(error?.message) ? 'sales_agent_not_configured'
        : status >= 500 ? 'sales_agent_unavailable' : String(error?.message || 'request_failed');
    return response(status, { error: publicError }, anonymous.setCookie);
  }
}
