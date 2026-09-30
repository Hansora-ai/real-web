import { planFlowAdvance } from './comment-flow.mjs';
import { first, serviceInsert, serviceUpdate } from './db.mjs';
import { getInstagramUserFacts, sendInstagramMessage } from './meta.mjs';
import { withTrackedLinks } from './flow-stats.mjs';
import { notifyOwner as defaultNotifyOwner } from './notify.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Runs one step of a comment automation for one person: plans with the saved customer data (tags, fields) and,
// only when a condition needs it, the live Instagram data (follows the business, follower count).
export async function executeFlowAdvance({ session, workflow, inboundText = '', inboundPayload = '', canUseInbound = true, account, accessToken, conversation, recipientId, deps = {} }) {
  const d = { first, serviceInsert, serviceUpdate, getInstagramUserFacts, sendInstagramMessage, notifyOwner: defaultNotifyOwner, wait, ...deps };
  const context = { ...(session.context || {}) };
  const contact = conversation?.contact_id ? await d.first(`/rest/v1/automation_contacts?id=eq.${conversation.contact_id}&select=id,display_name,profile,primary_email,primary_phone&limit=1`).catch(() => null) : null;
  const profile = contact?.profile || {};
  let facts = { tags: Array.isArray(profile.tags) ? profile.tags : [], fields: profile.fields && typeof profile.fields === 'object' ? profile.fields : {} };
  const planInput = { nodes: workflow.dm_steps, startIndex: session.current_node_index, inboundText, inboundPayload, canUseInbound, checks: context.checks || {} };
  let plan = planFlowAdvance({ ...planInput, facts });
  if (plan.status === 'needs_facts') {
    let live = await d.getInstagramUserFacts({ senderId: recipientId, accessToken });
    // Meta can take a few seconds to report a brand-new follow: after an "I followed" tap, look once more.
    if (live.follows === false && inboundPayload) { await d.wait(4000); live = await d.getInstagramUserFacts({ senderId: recipientId, accessToken }); }
    if (live.error) console.warn('automation flow follow check unavailable', { workflowId: workflow.id, message: live.error });
    facts = { ...facts, follows: live.follows, followerCount: live.followerCount ?? null };
    plan = planFlowAdvance({ ...planInput, facts });
  }

  let aiAction = null;
  const sends = { ...(context.sends || {}) };
  for (const action of plan.actions) {
    if (action.type === 'message') {
      const visit = (sends[action.nodeIndex] = Number(sends[action.nodeIndex] || 0) + 1);
      await sendFlowMessage({ d, action, visit, session, workflow, account, accessToken, conversation, recipientId });
    }
    if (action.type === 'ops') { const visit = (sends[`ops${action.nodeIndex}`] = Number(sends[`ops${action.nodeIndex}`] || 0) + 1); await applyOps({ d, action, visit, session, workflow, conversation, contact }); }
    if (action.type === 'delay') { const visit = (sends[`delay${action.nodeIndex}`] = Number(sends[`delay${action.nodeIndex}`] || 0) + 1); await scheduleFlowDelay({ d, action, visit, session }); }
    if (action.type === 'handoff') await handoffFlow({ d, action, session, conversation });
    if (action.type === 'ai') aiAction = action;
  }
  const status = plan.status === 'needs_facts' ? 'awaiting_reply' : plan.status;
  await d.serviceUpdate('automation_flow_sessions', `id=eq.${session.id}`, {
    conversation_id: conversation.id, current_node_index: plan.nextIndex, status,
    context: { ...context, sends, checks: { ...(context.checks || {}), ...(plan.checks || {}) } },
    updated_at: new Date().toISOString(), last_error: null
  });
  // Nothing sent by the flow (for example a typed question it has no route for): the AI answers instead.
  const handled = !aiAction && plan.actions.some(action => ['message', 'delay', 'handoff'].includes(action.type));
  return { plan, aiAction, handled };
}

async function sendFlowMessage({ d, action: planned, visit, session, workflow, account, accessToken, conversation, recipientId }) {
  const nodeId = (Array.isArray(workflow.dm_steps) ? workflow.dm_steps : [])[planned.nodeIndex]?.id || null;
  const action = withTrackedLinks(planned, { businessId: session.business_id, workflowId: workflow.id, sessionId: session.id, nodeId: nodeId || '' });
  // A step can be sent again on a later visit (a follow reminder, a "please try again"), never twice for one visit.
  const idempotencyKey = `flow:${session.id}:node:${action.nodeIndex}${visit > 1 ? `:visit:${visit}` : ''}`;
  const reserved = await d.serviceInsert('automation_messages', {
    business_id: session.business_id, conversation_id: conversation.id, idempotency_key: idempotencyKey,
    direction: 'outbound', sender_type: 'system', content_type: (action.buttons?.length || action.quickReplies?.length) ? 'interactive' : 'text',
    content: action.text, status: 'queued', billable: false, provider: 'meta',
    metadata: { workflow_id: workflow.id, flow_session_id: session.id, node_id: nodeId, node_index: action.nodeIndex, quick_replies: action.quickReplies || [], buttons: action.buttons || [] },
    occurred_at: new Date().toISOString()
  }, { ignoreDuplicates: true });
  if (!reserved) return;
  try {
    const sent = await d.sendInstagramMessage({ instagramUserId: account.provider_resource_id, recipientId, text: action.text, quickReplies: action.quickReplies || [], buttons: action.buttons || [], accessToken });
    await d.serviceUpdate('automation_messages', `id=eq.${reserved.id}`, { status: 'sent', external_message_id: String(sent.message_id || '') || null, provider_message_id: String(sent.message_id || '') || null });
    await d.serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { last_message_preview: action.text.slice(0, 1000), last_message_at: new Date().toISOString() });
    const handoffLabels = (action.quickReplies || []).filter(reply => reply.payload === 'HANSORA_HANDOFF').map(reply => reply.title);
    if (handoffLabels.length) await d.serviceUpdate('automation_flow_sessions', `id=eq.${session.id}`, { context: { ...(session.context || {}), handoff_labels: [...new Set([...(session.context?.handoff_labels || []), ...handoffLabels])] } });
  } catch (error) {
    await d.serviceUpdate('automation_messages', `id=eq.${reserved.id}`, { status: 'failed', metadata: { ...reserved.metadata, error: String(error?.message || 'instagram_send_failed') } }).catch(() => null);
    throw error;
  }
}

// Actions step and collect-info answers: tags and saved fields live on the customer (profile.tags / profile.fields),
// so later automations and the AI can use them. Also: notify the team, mark the chat "Needs you".
async function applyOps({ d, action, visit = 1, session, workflow, conversation, contact }) {
  const ops = action.ops || [];
  if (contact && ops.some(op => ['add_tag', 'remove_tag', 'set_field', 'clear_field'].includes(op.type))) {
    const fresh = await d.first(`/rest/v1/automation_contacts?id=eq.${contact.id}&select=profile&limit=1`).catch(() => null);
    const profile = { ...(fresh?.profile || contact.profile || {}) };
    let tags = Array.isArray(profile.tags) ? [...profile.tags] : [];
    const fields = { ...(profile.fields || {}) };
    for (const op of ops) {
      const value = String(op.value || '').trim();
      if (op.type === 'add_tag' && value && !tags.some(tag => tag.toLocaleLowerCase() === value.toLocaleLowerCase())) tags.push(value.slice(0, 60));
      if (op.type === 'remove_tag') tags = tags.filter(tag => tag.toLocaleLowerCase() !== value.toLocaleLowerCase());
      if (op.type === 'set_field' && op.key) fields[String(op.key).slice(0, 60)] = value.slice(0, 1000);
      if (op.type === 'clear_field' && op.key) delete fields[String(op.key)];
    }
    const update = { profile: { ...profile, tags: tags.slice(0, 100), fields } };
    if (action.contact?.email) update.primary_email = action.contact.email;
    if (action.contact?.phone) update.primary_phone = action.contact.phone;
    await d.serviceUpdate('automation_contacts', `id=eq.${contact.id}`, update);
    contact.profile = update.profile;
  }
  for (const op of ops) {
    if (op.type === 'mark_needs_you') await d.serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { status: 'needs_attention' });
    if (op.type === 'notify') {
      await d.notifyOwner({ businessId: session.business_id, event: 'handoff_requested', idempotencyKey: `flow-notify:${session.id}:${action.nodeIndex}:${visit}`, data: { businessId: session.business_id, conversationId: conversation.id, outcomeId: null, business: '', channel: 'Instagram DM', customer: contact?.display_name || 'Customer', reference: '', details: String(op.value || `Automation “${workflow.name || ''}” needs your attention.`).slice(0, 500) } }).catch(error => console.error('automation flow notify failed', { message: error?.message }));
    }
  }
}

async function scheduleFlowDelay({ d, action, visit = 1, session }) {
  await d.serviceInsert('automation_flow_jobs', {
    business_id: session.business_id, session_id: session.id, node_index: action.nextIndex,
    run_at: new Date(Date.now() + action.delayMs).toISOString(), status: 'pending',
    idempotency_key: `flow-delay:${session.id}:${action.nodeIndex}:${action.nextIndex}${visit > 1 ? `:visit:${visit}` : ''}`
  }, { ignoreDuplicates: true });
}

async function handoffFlow({ d, action, session, conversation }) {
  await d.serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { ai_enabled: false, status: 'needs_attention', summary: action.note });
  await d.serviceInsert('automation_messages', {
    business_id: session.business_id, conversation_id: conversation.id, idempotency_key: `flow-handoff:${session.id}:${action.nodeIndex}`,
    direction: 'internal', sender_type: 'system', content_type: 'text', content: action.note, status: 'received', billable: false,
    provider: 'hansora', metadata: { flow_session_id: session.id, node_index: action.nodeIndex }, occurred_at: new Date().toISOString()
  }, { ignoreDuplicates: true });
}
