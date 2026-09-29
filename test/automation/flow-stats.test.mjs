import assert from 'node:assert/strict';
import test from 'node:test';
import { clickedActionId, extractInstagramReads, nodeForAction, summarizeFlowStats, trackedLinkUrl, verifyTrackedLink, withTrackedLinks } from '../../lib/automation/flow-stats.mjs';
import { openingMessageIndex, preparePrivateReply } from '../../lib/automation/comment-flow.mjs';

process.env.HANSORA_AUTOMATION_INTERNAL_SECRET ||= 'x'.repeat(40);
process.env.URL = 'https://hansora.co';

const nodes = [
  { id: 'intro', type: 'message', text: 'Hi', actions: [{ id: 'more', type: 'quick_reply', label: 'Tell me more', nextId: 'details' }, { id: 'site', type: 'website', label: 'Site', url: 'https://ararat.am' }] },
  { id: 'details', type: 'message', text: 'Details', commentReply: false },
  { id: 'ai', type: 'ai' }
];

test('button taps and links are attributed to the right step', () => {
  assert.equal(clickedActionId('HANSORA_FLOW:more'), 'more');
  assert.equal(clickedActionId('HANSORA_HANDOFF'), 'handoff');
  assert.equal(clickedActionId('hello'), '');
  assert.equal(nodeForAction(nodes, 'more').id, 'intro');
  const url = trackedLinkUrl({ url: 'https://ararat.am/price', businessId: 'b', workflowId: 'w', nodeId: 'intro', actionId: 'site' });
  assert.match(url, /^https:\/\/hansora\.co\/\.netlify\/functions\/automation-link\?/);
  const params = Object.fromEntries(new URL(url).searchParams);
  assert.equal(verifyTrackedLink(params).u, 'https://ararat.am/price');
  assert.equal(verifyTrackedLink({ ...params, u: 'https://evil.example' }), null); // no open redirect
  const prepared = withTrackedLinks(preparePrivateReply(nodes[0]), { businessId: 'b', workflowId: 'w', nodeId: 'intro' });
  assert.match(prepared.buttons.find(button => button.type === 'web_url').url, /automation-link/);
});

test('the opening DM is the step marked as the private reply, like in the builder', () => {
  assert.equal(openingMessageIndex([{ id: 'a', type: 'message', text: 'later' }, { id: 'b', type: 'message', text: 'first', commentReply: true }]), 1);
  assert.equal(openingMessageIndex([{ id: 'a', type: 'delay' }, { id: 'b', type: 'message', text: 'only' }]), 1);
});

test('seen receipts are read from Instagram webhooks and stats are summarized per step', () => {
  assert.deepEqual(extractInstagramReads({ object: 'instagram', entry: [{ messaging: [{ sender: { id: 'u1' }, read: { mid: 'm1' }, timestamp: 5 }] }] }), [{ mid: 'm1', senderId: 'u1', timestamp: 5 }]);
  const stats = summarizeFlowStats({
    nodes,
    executions: [{ status: 'completed', public_reply_id: 'p', private_message_id: 'm' }, { status: 'failed' }],
    messages: [{ status: 'read', metadata: { node_id: 'intro' } }, { status: 'sent', metadata: { node_index: 0 } }, { status: 'failed', metadata: { node_id: 'intro' } }, { status: 'sent', metadata: { node_id: 'details' } }],
    events: [{ event_type: 'click', node_id: 'intro', action_id: 'more' }, { event_type: 'click', node_id: 'intro', action_id: 'more' }, { event_type: 'click', node_id: 'intro', action_id: 'site' }],
    sessions: [{ status: 'ai_active', current_node_index: 2 }]
  });
  assert.deepEqual(stats.trigger, { comments: 2, publicReplies: 1, privateReplies: 1, failed: 1 });
  assert.deepEqual(stats.nodes.intro, { sent: 2, seen: 1, failed: 1, clicks: { more: 2, site: 1 }, reached: 0 });
  assert.equal(stats.nodes.details.sent, 1);
  assert.equal(stats.nodes.ai.reached, 1);
});
