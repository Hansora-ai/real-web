import assert from 'node:assert/strict';
import test from 'node:test';
import { planFlowAdvance } from '../../lib/automation/comment-flow.mjs';
import { executeFlowAdvance, safeWebhookUrl } from '../../lib/automation/flow-executor.mjs';
import { pickDmWorkflow, pickDefaultReply, makeFlowStarter } from '../../lib/automation/dm-triggers.mjs';
import { extractInstagramMessages, extractInstagramComments } from '../../lib/automation/meta.mjs';

const wf = (id, trigger_type, extra = {}) => ({ id, status: 'active', match_type: 'contains', keywords: [], dm_steps: [{ id: 'm', type: 'message', text: `from ${id}`, commentReply: true, nextId: null }], safety_config: { trigger_type, ...(extra.safety || {}) }, ...extra });

test('Instagram story replies, mentions, shared posts, photos and ig.me links are no longer dropped', () => {
  const base = { sender: { id: 'u1' }, recipient: { id: 'b1' }, timestamp: 1 };
  const read = event => extractInstagramMessages({ object: 'instagram', entry: [{ id: 'b1', messaging: [{ ...base, ...event }] }] })[0];
  assert.equal(read({ message: { mid: 'a', text: 'wow', reply_to: { story: { id: 's1', url: 'https://x' } } } }).kind, 'story_reply');
  assert.equal(read({ message: { mid: 'b', attachments: [{ type: 'story_mention', payload: { url: 'https://x' } }] } }).kind, 'story_mention');
  assert.equal(read({ message: { mid: 'c', attachments: [{ type: 'share', payload: { url: 'https://x' } }] } }).kind, 'share');
  assert.equal(read({ message: { mid: 'd', attachments: [{ type: 'image', payload: { url: 'https://x' } }] } }).kind, 'media');
  const referral = read({ referral: { ref: 'SUMMER', source: 'SHORTLINK' } });
  assert.equal(referral.kind, 'referral'); assert.equal(referral.ref, 'SUMMER');
  assert.equal(read({ message: { mid: 'e', text: 'hi' } }).kind, 'text');
  const live = extractInstagramComments({ object: 'instagram', entry: [{ id: 'b1', changes: [{ field: 'live_comments', value: { id: 'c1', media: { id: 'm1' }, from: { id: 'u1' }, text: 'hi' } }] }] });
  assert.equal(live[0].live, true);
});

test('the right DM automation starts, in ManyChat order', () => {
  const flows = [wf('kw', 'dm_keyword', { keywords: ['price'] }), wf('story', 'story_reply', { match_type: 'any' }), wf('mention', 'story_mention'), wf('share', 'share'), wf('ref', 'ref_link', { safety: { trigger: { ref: 'summer' } } }), wf('ice', 'ice_breaker'), wf('default', 'default_reply')];
  assert.equal(pickDmWorkflow(flows, { kind: 'text', text: 'what is the PRICE?' }).id, 'kw');
  assert.equal(pickDmWorkflow(flows, { kind: 'story_reply', text: 'nice' }).id, 'story');
  assert.equal(pickDmWorkflow(flows, { kind: 'story_mention', text: '' }).id, 'mention');
  assert.equal(pickDmWorkflow(flows, { kind: 'share', text: '' }).id, 'share');
  assert.equal(pickDmWorkflow(flows, { kind: 'referral', ref: 'Summer', text: '' }).id, 'ref');
  assert.equal(pickDmWorkflow(flows, { kind: 'postback', quickReplyPayload: 'HANSORA_START:ice', text: 'How do I order?' }).id, 'ice');
  assert.equal(pickDmWorkflow(flows, { kind: 'text', text: 'price', quickReplyPayload: 'HANSORA_FLOW:send' }), null, 'a button tap never starts a keyword automation');
  assert.equal(pickDmWorkflow(flows, { kind: 'text', text: 'hello' }), null);
  assert.equal(pickDefaultReply(flows).id, 'default');
});

test('a DM automation starts from its first step and replaces an older waiting one', async () => {
  const sent = [], updates = [];
  const deps = {
    serviceInsert: async (table, row) => ({ id: `${table}-1`, ...row }),
    serviceUpdate: async (table, query, value) => { updates.push({ table, query, value }); return [value]; },
    first: async () => null,
    executeFlowAdvance: async ({ session, workflow }) => { sent.push(`${workflow.id}@${session.current_node_index}`); return { plan: { status: 'completed' } }; }
  };
  const start = makeFlowStarter({ account: { business_id: 'b1' }, accessToken: 't', deps });
  const result = await start({ workflow: wf('kw', 'dm_keyword'), conversation: { id: 'c1' }, recipientId: 'u1', runKey: 'dm:mid1' });
  assert.equal(result.handled, true);
  assert.deepEqual(sent, ['kw@0']);
  assert.ok(updates.some(item => item.table === 'automation_flow_sessions' && item.value.status === 'completed'));
});

test('messages can have images, cards and typing pauses; delays can be seconds; follow-ups are scheduled', async () => {
  const nodes = [
    { id: 'p', type: 'delay', amount: 3, unit: 'second', nextId: 'm' },
    { id: 'm', type: 'message', text: 'Pick one', nextId: null, blocks: [{ type: 'image', url: 'https://img/1.jpg' }, { type: 'typing', seconds: 2 }, { type: 'cards', cards: [{ title: 'Kitchen', image: 'https://img/2.jpg', buttons: [{ label: 'See', url: 'https://site' }] }] }, { type: 'image', url: 'http://unsafe' }], actions: [{ id: 'a', type: 'quick_reply', label: 'Yes', nextId: null }], followUp: { enabled: true, amount: 2, unit: 'hour', text: 'Still interested?' } }
  ];
  const plan = planFlowAdvance({ nodes, startIndex: 0, canUseInbound: false });
  assert.deepEqual(plan.actions.map(action => action.type), ['pause', 'message']);
  assert.equal(plan.actions[1].blocks.length, 3, 'the non-https image is dropped');
  assert.equal(plan.actions[1].followUp.delayMs, 7_200_000);
  const rich = [], waits = [], jobs = [];
  await executeFlowAdvance({ session: { id: 's', business_id: 'b', current_node_index: 0, context: {} }, workflow: { id: 'w', dm_steps: nodes }, canUseInbound: false, account: { provider_resource_id: 'ig' }, accessToken: 't', conversation: { id: 'c', contact_id: null }, recipientId: 'u', deps: { first: async () => null, serviceInsert: async (table, row) => { if (table === 'automation_flow_jobs') jobs.push(row); return { id: 'x', ...row }; }, serviceUpdate: async () => [], sendInstagramMessage: async () => ({}), sendInstagramRich: async ({ block }) => { rich.push(block.type); return {}; }, sendInstagramAction: async () => ({}), wait: async ms => { waits.push(ms); }, getInstagramUserFacts: async () => ({}), notifyOwner: async () => {} } });
  assert.deepEqual(rich, ['image', 'cards']);
  assert.deepEqual(waits, [3000, 2000]);
  assert.match(jobs[0].idempotency_key, /^flow-followup:s:1:1$/);
});

test('new actions: assign to a team member, send to another app (safe addresses only), start another automation', async () => {
  assert.equal(safeWebhookUrl('https://hooks.zapier.com/abc'), 'https://hooks.zapier.com/abc');
  for (const bad of ['http://x.com', 'https://localhost/a', 'https://127.0.0.1/a', 'https://192.168.1.2/', 'https://10.0.0.1/', 'https://[::1]/', 'nonsense']) assert.equal(safeWebhookUrl(bad), null, bad);
  const updates = [], posts = [], started = [];
  const nodes = [{ id: 'a', type: 'action', ops: [{ type: 'assign', value: 'Anna' }, { type: 'webhook', value: 'https://hooks.example.com/x' }, { type: 'start_flow', value: '22222222-2222-4222-8222-222222222222' }], nextId: null }];
  const result = await executeFlowAdvance({ session: { id: 's', business_id: 'b', current_node_index: 0, context: {} }, workflow: { id: 'w', name: 'Leads', dm_steps: nodes }, canUseInbound: false, account: { provider_resource_id: 'ig' }, accessToken: 't', conversation: { id: 'c', contact_id: 'k' }, recipientId: 'u', deps: { first: async () => ({ id: 'k', display_name: 'Ani', profile: { tags: ['VIP'] } }), serviceInsert: async (t, row) => row, serviceUpdate: async (table, query, value) => { updates.push({ table, value }); return [value]; }, notifyOwner: async () => {}, fetch: async (url, options) => { posts.push({ url, body: JSON.parse(options.body) }); return { ok: true }; }, startFlow: async args => { started.push(args.workflowId); }, sendInstagramMessage: async () => ({}), getInstagramUserFacts: async () => ({}), wait: async () => {} } });
  assert.ok(updates.some(item => item.table === 'automation_conversations' && item.value.status === 'human_handling' && /Anna/.test(item.value.summary)));
  assert.equal(posts[0].url, 'https://hooks.example.com/x');
  assert.deepEqual(posts[0].body.customer.tags, ['VIP']);
  assert.deepEqual(started, ['22222222-2222-4222-8222-222222222222']);
  assert.equal(result.handled, true);
});

test('a comment automation can start with a condition or delay; its first message is the private reply', async () => {
  const nodes = [
    { id: 'tagcheck', type: 'condition', entry: true, rules: [{ field: 'tag', op: 'has', value: 'VIP' }], yesId: 'vip', noId: 'normal' },
    { id: 'vip', type: 'message', text: 'Hi VIP', nextId: null, actions: [{ id: 'a', type: 'quick_reply', label: 'Send', nextId: null }] },
    { id: 'normal', type: 'message', text: 'Hi there', nextId: null, actions: [{ id: 'b', type: 'quick_reply', label: 'Send', nextId: null }], blocks: [{ type: 'image', url: 'https://x/1.jpg' }] }
  ];
  const calls = [];
  const deps = { first: async () => ({ id: 'k', profile: { tags: [] } }), serviceInsert: async (t, row) => ({ id: 'x', ...row }), serviceUpdate: async () => [], sendInstagramPrivateReply: async args => { calls.push(['private', args.commentId, args.text]); return { message_id: 'p1' }; }, sendInstagramMessage: async args => { calls.push(['dm', args.text]); return {}; }, sendInstagramRich: async () => { calls.push(['rich']); return {}; }, getInstagramUserFacts: async () => ({}), wait: async () => {}, notifyOwner: async () => {} };
  await executeFlowAdvance({ session: { id: 's', business_id: 'b', current_node_index: 0, context: { comment_id: 'c77', private_reply_pending: true } }, workflow: { id: 'w', dm_steps: nodes }, canUseInbound: false, account: { provider_resource_id: 'ig' }, accessToken: 't', conversation: { id: 'c', contact_id: 'k' }, recipientId: 'u', deps });
  assert.deepEqual(calls, [['private', 'c77', 'Hi there']], 'one private reply, no image before it');
});

test('PDF, audio and Dynamic content: the server decides what to send, unsafe addresses are refused', async () => {
  const { dynamicContent } = await import('../../lib/automation/flow-executor.mjs');
  const { messageBlocks } = await import('../../lib/automation/comment-flow.mjs');
  assert.deepEqual(messageBlocks({ blocks: [{ type: 'file', url: 'https://x/a.pdf' }, { type: 'audio', url: 'https://x/a.mp3' }, { type: 'dynamic', url: 'https://api.x/c' }, { type: 'file', url: 'ftp://x' }] }).map(block => block.type), ['file', 'audio', 'dynamic']);
  let posted = null;
  const d = { fetch: async (url, options) => { posted = JSON.parse(options.body); return { ok: true, json: async () => ({ messages: [{ text: 'Hi Ani' }, { image: 'https://img/1.jpg' }, { nonsense: 1 }] }) }; } };
  const items = await dynamicContent({ d, url: 'https://api.example.com/hansora', workflow: { id: 'w', name: 'Promo' }, contact: { display_name: 'Ani', profile: { tags: ['VIP'] } }, recipientId: 'u1' });
  assert.deepEqual(items, [{ type: 'text', text: 'Hi Ani' }, { type: 'image', url: 'https://img/1.jpg' }]);
  assert.deepEqual(posted.customer.tags, ['VIP']);
  assert.deepEqual(await dynamicContent({ d, url: 'https://127.0.0.1/x', workflow: { id: 'w' }, contact: null, recipientId: 'u' }), []);
});

test('a specific-post automation wins over an all-posts one, a keyword over any comment', async () => {
  const { byPriority, matchesCommentText } = await import('../../lib/automation/comment-flow.mjs');
  const flows = [
    { id: 'all-any', post_scope: 'all', match_type: 'any', keywords: [] },
    { id: 'all-ai', post_scope: 'all', match_type: 'exact', keywords: ['ai'] },
    { id: 'post-ai', post_scope: 'selected', match_type: 'exact', keywords: ['ai'] },
    { id: 'post-any', post_scope: 'selected', match_type: 'any', keywords: [] }
  ].sort(byPriority);
  assert.deepEqual(flows.map(flow => flow.id), ['post-ai', 'post-any', 'all-ai', 'all-any']);
  const firstMatch = text => flows.find(flow => matchesCommentText(flow, text)).id;
  assert.equal(firstMatch('AI'), 'post-ai');
  assert.equal(firstMatch('hello'), 'post-any');
});

test('the AI employee card reads the connected Instagram name and photo', async () => {
  for (const name of ['META_INSTAGRAM_APP_ID','META_INSTAGRAM_APP_SECRET','META_INSTAGRAM_REDIRECT_URI','META_WEBHOOK_VERIFY_TOKEN','HANSORA_AUTOMATION_OAUTH_SECRET']) process.env[name] ||= 'test';
  const { getInstagramAccountCard } = await import('../../lib/automation/meta.mjs');
  let asked = '';
  const card = await getInstagramAccountCard('token', async url => { asked = String(url); return new Response(JSON.stringify({ username: 'luma.studio', name: 'Luma', profile_picture_url: 'https://cdn.example/p.jpg' }), { status: 200 }); });
  assert.match(asked, /fields=username%2Cname%2Cprofile_picture_url/);
  assert.deepEqual(card, { username: 'luma.studio', name: 'Luma', picture: 'https://cdn.example/p.jpg' });
  const unsafe = await getInstagramAccountCard('token', async () => new Response(JSON.stringify({ username: 'x', profile_picture_url: 'javascript:alert(1)' }), { status: 200 }));
  assert.equal(unsafe.picture, '');
});

test('Comment keywords ignore capitals, punctuation, emojis and @mentions, and allow a one-letter typo', async () => {
  const { matchesCommentText } = await import('../../lib/automation/comment-flow.mjs');
  const exact = { match_type: 'exact', keywords: ['prompt'] };
  for (const text of ['Prompt', 'prompt!', ' PROMPT 🔥', '@hansora_.ai prompt', 'Promt', 'promptt', '#prompt'])
    assert.equal(matchesCommentText(exact, text), true, text);
  for (const text of ['prompts please', 'pro', 'send prompt', 'promo'])
    assert.equal(matchesCommentText(exact, text), false, text);
  const shortWord = { match_type: 'exact', keywords: ['ai'] };
  assert.equal(matchesCommentText(shortWord, 'Ai'), true); assert.equal(matchesCommentText(shortWord, 'a'), false);
  const contains = { match_type: 'contains', keywords: ['price'] };
  assert.equal(matchesCommentText(contains, 'What is the PRICE?'), true);
  assert.equal(matchesCommentText(contains, 'what is the prise'), true);
  assert.equal(matchesCommentText(contains, 'nice'), false);
  assert.equal(matchesCommentText({ match_type: 'any' }, 'hello', ['spam']), true);
  assert.equal(matchesCommentText({ match_type: 'any' }, 'buy SPAM now', ['spam']), false);
});
