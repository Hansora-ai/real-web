// Automations that start from a DM (not a comment), like ManyChat: a keyword in a message, a reply to your story,
// a mention of you in someone's story, a post or reel shared to you, an ig.me link with a code (ref), a
// conversation starter tap, or a default reply when nothing else matches. "Start another automation" uses the same.
import { entryIndex, matchesCommentText } from './comment-flow.mjs';
import { executeFlowAdvance } from './flow-executor.mjs';
import { first, rows, serviceInsert, serviceUpdate, supabaseRequest } from './db.mjs';

export const DM_TRIGGERS = ['dm_keyword', 'story_reply', 'story_mention', 'share', 'ref_link', 'ice_breaker', 'default_reply'];
export const triggerType = workflow => String(workflow?.safety_config?.trigger_type || 'comment');
const isLive = workflow => workflow?.status === 'active';

// Which automation starts for this message, in ManyChat's order. Button taps inside a running automation never
// start a keyword automation.
export function pickDmWorkflow(workflows, message) {
  const live = (Array.isArray(workflows) ? workflows : []).filter(workflow => isLive(workflow) && DM_TRIGGERS.includes(triggerType(workflow)));
  const byType = type => live.filter(workflow => triggerType(workflow) === type);
  const payload = String(message?.quickReplyPayload || '');
  if (payload.startsWith('HANSORA_START:')) { const workflow = live.find(item => item.id === payload.slice('HANSORA_START:'.length)); if (workflow) return workflow; }
  if (payload) return null;
  const ref = String(message?.ref || '').trim().toLowerCase();
  if (ref) { const workflow = byType('ref_link').find(item => String(item.safety_config?.trigger?.ref || '').trim().toLowerCase() === ref); if (workflow) return workflow; }
  if (message?.kind === 'story_mention') return byType('story_mention')[0] || null;
  if (message?.kind === 'story_reply') { const workflow = byType('story_reply').find(item => matchesCommentText(item, message.text, item.safety_config?.exclude_keywords)); if (workflow) return workflow; }
  if (message?.kind === 'share') return byType('share')[0] || null;
  if (['text', 'story_reply'].includes(message?.kind) && String(message?.text || '').trim()) {
    const workflow = byType('dm_keyword').find(item => item.match_type !== 'any' && matchesCommentText(item, message.text, item.safety_config?.exclude_keywords));
    if (workflow) return workflow;
  }
  return null;
}
export const pickDefaultReply = workflows => (Array.isArray(workflows) ? workflows : []).find(item => isLive(item) && triggerType(item) === 'default_reply') || null;

// Starts an automation for one person in their DM and runs it until it waits (for a tap, a reply or a delay).
export function makeFlowStarter({ account, accessToken, deps = {} }) {
  const d = { first, rows, serviceInsert, serviceUpdate, supabaseRequest, executeFlowAdvance, ...deps };
  const start = async ({ workflow, workflowId, conversation, recipientId, runKey, mediaId = 'dm', text = '', depth = 0, session: from = null }) => {
    const flow = workflow || await d.first(`/rest/v1/automation_comment_workflows?id=eq.${encodeURIComponent(workflowId)}&business_id=eq.${account.business_id}&status=eq.active&select=*&limit=1`);
    if (!flow) return null;
    const nodes = Array.isArray(flow.dm_steps) ? flow.dm_steps : [];
    const found = entryIndex(nodes);
    const entry = found >= 0 ? found : (nodes.length ? 0 : -1);
    if (entry < 0) return null;
    const key = String(runKey || `chain:${from?.id || 'none'}:${flow.id}`).slice(0, 500);
    const execution = await d.serviceInsert('automation_comment_executions', { business_id: account.business_id, workflow_id: flow.id, comment_id: key, media_id: String(mediaId || 'dm').slice(0, 500), external_contact_id: String(recipientId), comment_text: String(text || '').slice(0, 24000), status: 'processing' }, { ignoreDuplicates: true });
    if (!execution) return { duplicate: true, handled: true };
    // One automation at a time per person: an older one still waiting is closed.
    await d.serviceUpdate('automation_flow_sessions', `business_id=eq.${account.business_id}&external_contact_id=eq.${encodeURIComponent(recipientId)}&status=in.(awaiting_reply,running,waiting)`, { status: 'completed', updated_at: new Date().toISOString() });
    const session = await d.serviceInsert('automation_flow_sessions', { business_id: account.business_id, workflow_id: flow.id, comment_execution_id: execution.id, conversation_id: conversation.id, external_contact_id: String(recipientId), current_node_index: entry, status: 'running', context: { trigger: triggerType(flow), chain_depth: depth } });
    const result = await d.executeFlowAdvance({ session, workflow: flow, canUseInbound: false, account, accessToken, conversation, recipientId: String(recipientId), deps: { startFlow: ({ workflowId: next, session: current, conversation: conv, recipientId: who, depth: level }) => start({ workflowId: next, conversation: conv, recipientId: who, depth: level, session: current }) } });
    await d.serviceUpdate('automation_comment_executions', `id=eq.${execution.id}`, { status: 'completed', completed_at: new Date().toISOString() });
    await d.serviceUpdate('automation_comment_workflows', `id=eq.${flow.id}`, { triggered_count: Number(flow.triggered_count || 0) + 1, last_triggered_at: new Date().toISOString() });
    return { ...result, handled: true, workflowId: flow.id };
  };
  return start;
}

// For the Instagram DM processor: starts a matching DM automation, if any. Default reply runs at most once per
// person per 24 hours (then the AI answers).
export async function maybeStartDmAutomation({ account, accessToken, conversation, message, hasActiveSession = false, deps = {} }) {
  const d = { rows, supabaseRequest, first, ...deps };
  const workflows = d.rows(await d.supabaseRequest(`/rest/v1/automation_comment_workflows?business_id=eq.${account.business_id}&status=eq.active&select=*&order=updated_at.desc`));
  if (!workflows.some(item => DM_TRIGGERS.includes(triggerType(item)))) return null;
  const start = makeFlowStarter({ account, accessToken, deps });
  const base = { conversation, recipientId: message.senderId, mediaId: message.storyId || (message.kind === 'share' ? 'shared' : 'dm'), text: message.text };
  const chosen = pickDmWorkflow(workflows, message);
  if (chosen) return start({ ...base, workflow: chosen, runKey: `dm:${message.externalEventId}` });
  const fallback = !hasActiveSession && message.kind === 'text' && !message.quickReplyPayload ? pickDefaultReply(workflows) : null;
  if (!fallback) return null;
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const recent = await d.first(`/rest/v1/automation_comment_executions?workflow_id=eq.${fallback.id}&external_contact_id=eq.${encodeURIComponent(message.senderId)}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`).catch(() => null);
  if (recent) return null;
  return start({ ...base, workflow: fallback, runKey: `dm:${message.externalEventId}` });
}
