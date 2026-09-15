const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function request(url, key, path, options = {}) {
  const response = await fetch(`${String(url).replace(/\/+$/, '')}/rest/v1/${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
      apikey: key,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`chat_attribution_database_${response.status}`);
  return Array.isArray(data) ? data : [];
}

export async function attributePurchaseToChat({
  supabaseUrl, serviceKey, userId, requestedSessionId, provider, transactionId,
  paymentId = null, amountCents = null, currency = null
}) {
  if (!supabaseUrl || !serviceKey || !UUID.test(String(userId || '')) || !transactionId) return { attributed: false };
  let session = null;
  if (UUID.test(String(requestedSessionId || ''))) {
    const found = await request(supabaseUrl, serviceKey,
      `chat_sessions?id=eq.${encodeURIComponent(requestedSessionId)}&select=id,user_id,language&limit=1`);
    if (found[0]?.user_id === userId) session = found[0];
  }
  if (!session) {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const found = await request(supabaseUrl, serviceKey,
      `chat_sessions?user_id=eq.${encodeURIComponent(userId)}&updated_at=gte.${encodeURIComponent(since)}&select=id,user_id,language&order=updated_at.desc&limit=5`);
    if (found.length) {
      const ids = found.map((item) => item.id).filter((id) => UUID.test(String(id))).join(',');
      const engaged = ids ? await request(supabaseUrl, serviceKey,
        `chat_messages?session_id=in.(${ids})&role=eq.user&created_at=gte.${encodeURIComponent(since)}&select=session_id&order=created_at.desc&limit=1`) : [];
      session = found.find((item) => item.id === engaged[0]?.session_id) || null;
    }
  }
  if (!session) return { attributed: false };

  const inserted = await request(supabaseUrl, serviceKey, 'chat_purchase_attributions?on_conflict=provider,transaction_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify([{
      provider: String(provider), transaction_id: String(transactionId), payment_id: paymentId ? String(paymentId) : null,
      session_id: session.id, attribution_rule: requestedSessionId === session.id ? 'checkout_session_v1' : 'last_engaged_chat_7d_v1',
      amount_cents: Number.isFinite(Number(amountCents)) ? Number(amountCents) : null,
      currency: currency ? String(currency).slice(0, 12) : null
    }])
  });
  if (!inserted.length) return { attributed: true, replayed: true, sessionId: session.id };
  await request(supabaseUrl, serviceKey, 'chat_events?on_conflict=session_id,idempotency_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify([{
      session_id: session.id, user_id: userId, event_type: 'purchase_completed_after_chat', language: session.language,
      metadata: { provider, transaction_id: String(transactionId), attribution_rule: inserted[0].attribution_rule },
      idempotency_key: `purchase:${provider}:${transactionId}`
    }])
  });
  return { attributed: true, sessionId: session.id };
}
