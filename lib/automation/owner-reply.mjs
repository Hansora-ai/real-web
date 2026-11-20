// Did the owner write to this customer from the Instagram app since the customer's message? Checked right before the AI
// sends its answer. The echo handler (automation-instagram-echo-background) pauses the AI too, but it waits up to
// ~20 s to be sure an echo is not one of Hansora's own messages saved late; an AI reply ready inside that gap went out
// on top of the owner's answer (2026-11-18). This check needs no wait: the echo is already saved when it arrives.
import { first, rows, supabaseRequest } from './db.mjs';

const enc = value => encodeURIComponent(String(value));

export async function ownerRepliedOnInstagram({ businessId, conversationId, instagramAccountId, customerId, since }, overrides = {}) {
  const d = { first, rows, supabaseRequest, ...overrides };
  if (!businessId || !conversationId || !instagramAccountId || !customerId || !since) return false;
  const echoes = d.rows(await d.supabaseRequest(`/rest/v1/automation_webhook_events?event_type=eq.instagram_echo&received_at=gte.${enc(since)}&payload->>customerId=eq.${enc(customerId)}&payload->>businessId=eq.${enc(instagramAccountId)}&select=payload&order=received_at.asc&limit=20`));
  const textSince = new Date(Date.parse(since) - 120000).toISOString();
  for (const { payload: echo } of echoes) {
    if (!echo?.mid) continue;
    const saved = await d.first(`/rest/v1/automation_messages?business_id=eq.${businessId}&or=(external_message_id.eq.${enc(echo.mid)},provider_message_id.eq.${enc(echo.mid)})&select=sender_type,metadata&limit=1`);
    if (saved) {
      if (saved.metadata?.source === 'instagram_app') return true; // already recorded as the owner's message
      continue; // one of Hansora's own messages
    }
    // Not saved yet: Hansora's own messages are recognised by the same text sent in this chat; attachments cannot be told apart.
    const text = String(echo.text || '');
    if (!text || /^📎/.test(text)) continue;
    const same = await d.first(`/rest/v1/automation_messages?conversation_id=eq.${conversationId}&direction=eq.outbound&sender_type=in.(ai,system,automation,human)&occurred_at=gte.${enc(textSince)}&content=eq.${enc(text)}&select=metadata&limit=1`);
    if (same && same.metadata?.source !== 'instagram_app') continue;
    return true;
  }
  return false;
}
