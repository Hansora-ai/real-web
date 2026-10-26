import { automationPricesFor, canAfford, chargeCredits } from '../../lib/automation/billing.mjs';
import { byPriority, matchesCommentText, pickReplyVariation } from '../../lib/automation/comment-flow.mjs';
import { first, rows, serviceInsert, serviceUpdate, serviceUpsert, supabaseRequest } from '../../lib/automation/db.mjs';
import { generateAutomationReply } from '../../lib/automation/provider.mjs';
import { ensureAgentUpToDate } from '../../lib/automation/agent-sync.mjs';
import { getTikTokComment, getTikTokVideo, replyToTikTokComment, TIKTOK_COMMENT_LIMIT } from '../../lib/automation/tiktok.mjs';
import { tiktokAccountFor, tiktokTokenFor } from '../../lib/automation/tiktok-account.mjs';

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const enc = value => encodeURIComponent(String(value));

// A new comment under one of the business's TikTok videos. TikTok does not allow messaging people who have not written
// first, so a TikTok comment automation only replies publicly: a reply the owner wrote (one of their versions, so the
// replies are not identical, which TikTok hides as spam) or a short answer written by the AI employee.
export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!internalAuthorized(event)) return json(401, { error: 'unauthorized' });
  let eventId = '';
  try {
    const body = JSON.parse(event.body || '{}'); eventId = String(body.event_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) return json(400, { error: 'invalid_event_id' });
    const webhook = await first(`/rest/v1/automation_webhook_events?id=eq.${eventId}&event_type=eq.tiktok_comment&status=in.(received,failed)&select=*&limit=1`);
    if (!webhook) return json(200, { ok: true, replayed: true });
    const target = webhook.payload || {};
    const [, account] = await Promise.all([
      serviceUpdate('automation_webhook_events', `id=eq.${webhook.id}`, { status: 'processing', attempt_count: Number(webhook.attempt_count || 0) + 1, last_error: null }),
      tiktokAccountFor({ tiktokBusinessId: target.businessId })
    ]);
    if (!account) throw new Error('tiktok_account_not_connected');
    const businessId = account.business_id;
    const workflows = rows(await supabaseRequest(`/rest/v1/automation_comment_workflows?business_id=eq.${businessId}&status=eq.active&select=*&order=updated_at.desc`))
      .filter(workflow => workflow.safety_config?.trigger_type === 'tiktok_comment').sort(byPriority);
    if (!workflows.length) { await markProcessed(webhook.id, businessId); return json(200, { ok: true, no_automation: true }); }
    const token = await tiktokTokenFor(account);
    // The webhook is not signed: the comment is read back from TikTok, so only real comments are answered.
    const comment = await getTikTokComment({ businessId: account.provider_resource_id, videoId: target.videoId, commentId: target.commentId, token });
    if (!comment || comment.owner || !comment.text.trim()) { await markProcessed(webhook.id, businessId); return json(200, { ok: true, ignored: true }); }
    let handled = 0;
    for (const workflow of workflows) if (await runWorkflow({ workflow, comment, account, token })) { handled += 1; break; }
    await markProcessed(webhook.id, businessId);
    return json(200, { ok: true, handled });
  } catch (error) {
    console.error('automation-tiktok-comment-process error', { eventId, message: error?.message, providerCode: error?.providerCode, providerMessage: error?.providerMessage });
    if (eventId) await serviceUpdate('automation_webhook_events', `id=eq.${eventId}`, { status: 'failed', last_error: String(error?.message || 'processing_failed').slice(0, 2000) }).catch(() => null);
    return json(Number(error?.status) || 500, { error: 'tiktok_comment_processing_failed' });
  }
}

export async function runWorkflow({ workflow, comment, account, token, deps = {} }) {
  const db = { first, serviceInsert, serviceUpdate, serviceUpsert, ...deps.db };
  const tiktok = { getTikTokVideo, replyToTikTokComment, ...deps.tiktok };
  const billing = { automationPricesFor, canAfford, chargeCredits, ...deps.billing };
  const writeReply = deps.writeReply || writeAiReply;
  const businessId = account.business_id, safety = workflow.safety_config || {};
  const contactKey = comment.userId || comment.username || comment.id;
  if (!matchesCommentText(workflow, comment.text, safety.exclude_keywords)) return false;
  if (!await matchesVideo({ workflow, comment, account, token, tiktok, db })) return false;
  if (safety.first_comment_only !== false) {
    const prior = await db.first(`/rest/v1/automation_comment_executions?workflow_id=eq.${workflow.id}&media_id=eq.${enc(comment.videoId)}&external_contact_id=eq.${enc(contactKey)}&status=in.(processing,completed,partial)&select=id&limit=1`);
    if (prior) return false;
  }
  const variations = (Array.isArray(workflow.public_reply_variations) ? workflow.public_reply_variations : []).map(value => String(value || '').trim()).filter(Boolean);
  const useAi = safety.reply_mode === 'ai';
  if (!useAi && !variations.length) return false;
  // A written reply costs one comment run (1⚡); an answer written by the AI costs one AI reply. Without credits
  // nothing is posted.
  const rates = await billing.automationPricesFor(businessId);
  const fee = useAi ? rates.aiReply : rates.commentRun;
  if (fee > 0) { const afford = await billing.canAfford(businessId, fee).catch(() => ({ ok: true })); if (!afford.ok) { console.warn('tiktok comment automation not started: out of credits', { businessId, workflowId: workflow.id }); return false; } }
  const execution = await db.serviceInsert('automation_comment_executions', { business_id: businessId, workflow_id: workflow.id, comment_id: comment.id, media_id: comment.videoId, external_contact_id: contactKey, comment_text: comment.text.slice(0, 24000), status: 'processing' }, { ignoreDuplicates: true });
  if (!execution) return false;

  // The commenter appears in the Inbox as a TikTok chat with the comment and the public reply.
  const occurredAt = new Date(comment.timestamp || Date.now()).toISOString();
  const name = comment.name || (comment.username ? `@${comment.username}` : 'TikTok customer');
  const connection = await db.first(`/rest/v1/automation_channel_connections?business_id=eq.${businessId}&channel_type=eq.tiktok&select=id&limit=1`).catch(() => null);
  const contact = await db.serviceUpsert('automation_contacts', 'business_id,channel_type,external_contact_id', { business_id: businessId, display_name: name, channel_type: 'tiktok', external_contact_id: `comment:${contactKey}`, last_seen_at: occurredAt, profile: { tiktok_comment_user: contactKey, username: comment.username, name: comment.name, ...(comment.picture ? { profile_pic: comment.picture } : {}), latest_video_id: comment.videoId, source: 'tiktok_comment' } });
  const conversation = await db.serviceUpsert('automation_conversations', 'business_id,channel_type,external_thread_id', { business_id: businessId, contact_id: contact.id, channel_connection_id: connection?.id || null, channel_type: 'tiktok', external_thread_id: `comment:${contactKey}`, status: 'open', last_message_preview: `💬 ${comment.text}`.slice(0, 1000), last_message_at: occurredAt });
  await db.serviceInsert('automation_messages', { business_id: businessId, conversation_id: conversation.id, external_message_id: comment.id, idempotency_key: `tiktok:comment:${comment.id}`, direction: 'inbound', sender_type: 'customer', content_type: 'text', content: `💬 Comment on your video: ${comment.text}`.slice(0, 24000), status: 'received', billable: false, provider: 'tiktok', provider_message_id: comment.id, metadata: { video_id: comment.videoId, workflow_id: workflow.id, username: comment.username }, occurred_at: occurredAt }, { ignoreDuplicates: true });

  let text = '', replyId = '', error = '', byAi = false, engine = '';
  if (useAi) {
    try { const written = await writeReply({ businessId, comment, instruction: safety.ai_instruction }); text = cleanReply(written?.text); engine = String(written?.engine || ''); byAi = Boolean(text); }
    catch (failure) { console.error('tiktok comment AI reply failed', { message: failure?.message }); }
  }
  if (!text && variations.length) text = pickReplyVariation(variations, comment.id);
  if (text) {
    try { replyId = (await tiktok.replyToTikTokComment({ businessId: account.provider_resource_id, videoId: comment.videoId, commentId: comment.id, text, token })).replyId; }
    catch (failure) { error = String(failure?.providerMessage || failure?.message || 'public_reply_failed'); }
  } else error = 'no_reply_text';
  const posted = Boolean(text && !error);
  const charged = posted && fee > 0 ? await billing.chargeCredits({ businessId, idempotencyKey: `comment-run:${execution.id}`, kind: byAi ? 'ai_reply' : 'comment_run', credits: byAi ? rates.aiReply : rates.commentRun, conversationId: conversation.id, reference: { workflow_id: workflow.id, comment_id: comment.id, channel: 'tiktok' } }).catch(failure => { console.error('tiktok comment charge failed', { message: failure?.message }); return null; }) : null;
  if (posted) {
    await db.serviceInsert('automation_messages', { business_id: businessId, conversation_id: conversation.id, external_message_id: replyId || null, idempotency_key: `tiktok:comment-reply:${comment.id}`, direction: 'outbound', sender_type: byAi ? 'ai' : 'system', content_type: 'text', content: `↩️ Public reply: ${text}`.slice(0, 24000), status: 'sent', billable: byAi, provider: 'tiktok', provider_message_id: replyId || null, metadata: { video_id: comment.videoId, comment_id: comment.id, workflow_id: workflow.id, public_reply: true }, occurred_at: new Date().toISOString() }, { ignoreDuplicates: true });
    await db.serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { last_message_preview: `↩️ ${text}`.slice(0, 1000), last_message_at: new Date().toISOString() });
    if (byAi) await db.serviceInsert('automation_usage_events', { business_id: businessId, conversation_id: conversation.id, channel_type: 'tiktok', unit_type: 'ai_message', quantity: 1, billable_quantity: 1, estimated_cost_minor: 0, currency: 'AMD', provider: engine === 'gemini' ? 'google' : 'elevenlabs', idempotency_key: `usage:tiktok-comment:${comment.id}`, credits: charged?.charged || 0, metadata: { tiktok_comment_id: comment.id, public_reply: true } }, { ignoreDuplicates: true }).catch(() => null);
  }
  await db.serviceUpdate('automation_comment_executions', `id=eq.${execution.id}`, { status: posted ? 'completed' : 'failed', public_reply_id: replyId || null, last_error: error.slice(0, 2000) || null, completed_at: new Date().toISOString() });
  await db.serviceUpdate('automation_comment_workflows', `id=eq.${workflow.id}`, { triggered_count: Number(workflow.triggered_count || 0) + 1, last_triggered_at: new Date().toISOString() });
  return true;
}

// "All videos", chosen videos, or "the next video I post" (the first video published after the automation went live;
// it is then remembered as the chosen one).
async function matchesVideo({ workflow, comment, account, token, tiktok, db }) {
  if (workflow.post_scope === 'all') return true;
  const selected = Array.isArray(workflow.selected_post_ids) ? workflow.selected_post_ids.map(String) : [];
  if (workflow.post_scope === 'selected' || selected.length) return selected.includes(String(comment.videoId));
  const video = await tiktok.getTikTokVideo({ businessId: account.provider_resource_id, videoId: comment.videoId, token });
  const publishedAt = Date.parse(video?.timestamp || ''), activatedAt = Date.parse(workflow.activated_at || workflow.updated_at || '');
  if (!Number.isFinite(publishedAt) || !Number.isFinite(activatedAt) || publishedAt <= activatedAt) return false;
  await db.serviceUpdate('automation_comment_workflows', `id=eq.${workflow.id}&selected_post_ids=eq.%7B%7D`, { selected_post_ids: [String(comment.videoId)] });
  return true;
}

// One short public answer from the AI employee's knowledge. It is public, so nothing private, and it cannot promise
// a DM (TikTok does not allow messaging people who have not written first).
async function writeAiReply({ businessId, comment, instruction }) {
  await ensureAgentUpToDate({ businessId }).catch(error => console.error('automation agent auto-update failed', { message: error?.message }));
  const aiResource = await first(`/rest/v1/automation_provider_resources?business_id=eq.${businessId}&provider=eq.elevenlabs&resource_type=eq.agent&status=eq.active&select=*&limit=1`);
  if (!aiResource) throw new Error('ai_provider_agent_not_ready');
  const context = [
    'A person commented publicly under one of the business\'s TikTok videos. Write ONE short public reply to the comment, in the same language as the comment: at most 2 sentences and under 250 characters, friendly and natural.',
    'Answer the question directly when the business information has the answer (for example the price). Everything you write is public: never ask for or mention phone numbers, addresses or other private details, and do not take orders or bookings here.',
    'You cannot send them a private message. If they need more help, invite them to send the business a message on TikTok.',
    instruction ? `The owner's instruction for these replies: ${String(instruction).slice(0, 500)}` : '',
    'Reply with the comment text only, without quotes.'
  ].filter(Boolean).join('\n\n');
  const generated = await generateAutomationReply({ businessId, rulesHash: aiResource.safe_config?.rules_hash || null, providerResourceId: aiResource.provider_resource_id, text: comment.text, context, channel: 'tiktok' });
  return { text: generated.text, engine: generated.engine };
}

export function cleanReply(text) {
  const value = String(text || '').trim().replace(/^["“'«]+|["”'»]+$/g, '').replace(/\s+/g, ' ').trim();
  return value.slice(0, TIKTOK_COMMENT_LIMIT);
}

function internalAuthorized(event) { const expected = String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET || ''); const actual = String(event.headers?.['x-hansora-internal-secret'] || event.headers?.['X-Hansora-Internal-Secret'] || ''); return expected.length >= 32 && actual === expected; }
async function markProcessed(id, businessId) { await serviceUpdate('automation_webhook_events', `id=eq.${id}`, { business_id: businessId, status: 'processed', processed_at: new Date().toISOString(), last_error: null }); }
