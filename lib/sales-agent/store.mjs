import crypto from 'node:crypto';
import { insertRow, rows, rpc, supabaseRequest, updateRows } from './db.mjs';
import { isUuid } from './auth.mjs';

export function normalizeLanguage(value) {
  const language = String(value || '').trim().toLowerCase();
  if (language === 'hy' || language === 'arm' || language === 'hy-am') return 'hy';
  if (language === 'ru' || language.startsWith('ru-')) return 'ru';
  return 'en';
}

export function detectLanguage(message, fallback = 'en') {
  const text = String(message || '');
  if (/[\u0530-\u058f]/u.test(text)) return 'hy';
  if (/[\u0400-\u04ff]/u.test(text)) return 'ru';
  if (/[a-z]/i.test(text)) return 'en';
  return normalizeLanguage(fallback);
}

async function findSessionById(id) {
  if (!isUuid(id)) return null;
  const result = await supabaseRequest(`/rest/v1/chat_sessions?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  return rows(result)[0] || null;
}

export async function ensureSession({ user, anonymous, requestedSessionId, language }) {
  const normalizedLanguage = normalizeLanguage(language);
  let session = await findSessionById(requestedSessionId);
  if (session) {
    const belongsToUser = user && session.user_id === user.id;
    const belongsToAnonymous = !user && session.anonymous_secret_hash === anonymous.secretHash;
    if (!belongsToUser && !belongsToAnonymous) session = null;
  }

  if (!session && user) {
    const anonymousRows = rows(await supabaseRequest(
      `/rest/v1/chat_sessions?anonymous_secret_hash=eq.${anonymous.secretHash}&user_id=is.null&select=*&order=updated_at.desc&limit=1`
    ));
    if (anonymousRows[0]) {
      session = (await updateRows('chat_sessions', `id=eq.${anonymousRows[0].id}&anonymous_secret_hash=eq.${anonymous.secretHash}`, {
        user_id: user.id,
        anonymous_secret_hash: null,
        language: normalizedLanguage
      }))[0] || null;
    }
  }

  if (!session && user) {
    session = rows(await supabaseRequest(
      `/rest/v1/chat_sessions?user_id=eq.${encodeURIComponent(user.id)}&select=*&order=updated_at.desc&limit=1`
    ))[0] || null;
  }

  if (!session && !user) {
    session = rows(await supabaseRequest(
      `/rest/v1/chat_sessions?anonymous_secret_hash=eq.${anonymous.secretHash}&select=*&order=updated_at.desc&limit=1`
    ))[0] || null;
  }

  if (!session) {
    session = await insertRow('chat_sessions', user ? {
      user_id: user.id,
      anonymous_secret_hash: null,
      language: normalizedLanguage
    } : {
      user_id: null,
      anonymous_secret_hash: anonymous.secretHash,
      language: normalizedLanguage
    });
  } else if (session.language !== normalizedLanguage) {
    session = (await updateRows('chat_sessions', `id=eq.${session.id}`, { language: normalizedLanguage }))[0] || session;
  }
  return session;
}

export async function getMessages(sessionId, limit = 50) {
  const bounded = Math.max(1, Math.min(100, Number(limit) || 50));
  const recent = rows(await supabaseRequest(
    `/rest/v1/chat_messages?session_id=eq.${encodeURIComponent(sessionId)}&select=id,sequence,request_id,role,content,response_json,status,model_used,created_at&order=sequence.desc&limit=${bounded}`
  ));
  return recent.reverse();
}

export async function appendMessage(sessionId, requestId, role, content, extra = {}) {
  const result = await rpc('append_chat_message', {
    p_session_id: sessionId,
    p_request_id: requestId,
    p_role: role,
    p_content: String(content).slice(0, 12000),
    p_response_json: extra.responseJson || null,
    p_status: extra.status || 'completed',
    p_model_used: extra.modelUsed || null,
    p_input_tokens: extra.inputTokens ?? null,
    p_cached_input_tokens: extra.cachedInputTokens ?? null,
    p_output_tokens: extra.outputTokens ?? null
  });
  return Array.isArray(result) ? result[0] : result;
}

export async function reserveRequest({ user, anonymous, ipHash }) {
  const identity = user ? `user:${user.id}` : `anon:${anonymous.secretHash}`;
  const perHour = user ? Number(process.env.SALES_AGENT_USER_REQUESTS_PER_HOUR || 60) : Number(process.env.SALES_AGENT_ANON_REQUESTS_PER_HOUR || 20);
  const identityAllowed = await rpc('reserve_chat_request', {
    p_key_hash: crypto.createHash('sha256').update(identity).digest('hex'),
    p_window_seconds: 3600,
    p_max_requests: perHour
  });
  const ipAllowed = await rpc('reserve_chat_request', {
    p_key_hash: ipHash,
    p_window_seconds: 3600,
    p_max_requests: Number(process.env.SALES_AGENT_IP_REQUESTS_PER_HOUR || 100)
  });
  const globalAllowed = await rpc('reserve_chat_request', {
    p_key_hash: crypto.createHash('sha256').update(`global:${process.env.SALES_AGENT_RATE_LIMIT_SALT || 'hansora'}`).digest('hex'),
    p_window_seconds: 3600,
    p_max_requests: Number(process.env.SALES_AGENT_GLOBAL_REQUESTS_PER_HOUR || 300)
  });
  return Boolean(identityAllowed && ipAllowed && globalAllowed);
}

export async function updateSessionMemory(session, message, reply, assistantSequence) {
  const prior = session.sales_memory && typeof session.sales_memory === 'object' ? session.sales_memory : {};
  const extracted = reply.memory && typeof reply.memory === 'object' ? reply.memory : {};
  const memory = {
    ...prior,
    business_type: extracted.business_type || prior.business_type || null,
    main_goal: extracted.main_goal || prior.main_goal || null,
    objection: extracted.objection || null,
    purchase_intent: extracted.purchase_intent || prior.purchase_intent || 'unknown',
    language: reply.language,
    last_intent: reply.intent,
    last_recommended_model: reply.recommended_model || prior.last_recommended_model || null,
    last_recommended_package: reply.recommended_package || prior.last_recommended_package || null,
    updated_at: new Date().toISOString()
  };
  const summary = `Latest customer request: ${String(message).slice(0, 500)}\nLatest Hansora guidance: ${String(reply.message).slice(0, 700)}`;
  return (await updateRows('chat_sessions', `id=eq.${session.id}`, {
    language: reply.language,
    sales_memory: memory,
    summary,
    summary_through_sequence: Number(assistantSequence || session.summary_through_sequence || 0)
  }))[0] || session;
}

export async function logUsage(value) {
  return insertRow('ai_usage_logs', value);
}

export async function recordEvent(session, event) {
  return insertRow('chat_events', {
    session_id: session.id,
    user_id: session.user_id || null,
    message_id: event.messageId || null,
    event_type: event.type,
    language: event.language || session.language,
    model_id: event.modelId || null,
    package_id: event.packageId || null,
    metadata: event.metadata || {},
    idempotency_key: String(event.idempotencyKey).slice(0, 200)
  });
}
