export const CHAT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export function chatCutoff(now = Date.now()) {
  return new Date(now - CHAT_RETENTION_MS).toISOString();
}

// A missing expiry is untrusted legacy memory, including before SQL is applied.
export function retainedSession(session, now = Date.now()) {
  if (Date.parse(session.memory_expires_at) > now) return session;
  return { ...session, summary: '', sales_memory: {}, summary_through_sequence: 0 };
}

export function memoryExpiry(session, history, now = Date.now()) {
  let expires = now + CHAT_RETENTION_MS;
  const priorExpiry = Date.parse(session.memory_expires_at);
  if (priorExpiry > now) expires = Math.min(expires, priorExpiry);
  // Derived preferences must not outlive the oldest message used to infer them.
  for (const message of history) {
    const created = Date.parse(message.created_at);
    if (Number.isFinite(created)) expires = Math.min(expires, created + CHAT_RETENTION_MS);
  }
  return new Date(expires).toISOString();
}
