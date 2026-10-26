import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTikTokComments, getTikTokComment, listTikTokVideos, replyToTikTokComment, subscribeTikTokComments } from '../../lib/automation/tiktok.mjs';
import { cleanReply, runWorkflow } from '../../netlify/functions/automation-tiktok-comment-process-background.mjs';

test('TikTok comment webhook: only new top-level comments, with exact big IDs', () => {
  const content = '{"comment_id":7247303576418566913,"video_id":7203946942097902849,"comment_type":"comment","comment_action":"insert","unique_identifier":"+ABc","timestamp":1687394416109,"text":"price?"}';
  const payload = { client_key: 'k', event: 'comment.update', create_time: 1615338610, user_openid: '_000biz', content };
  assert.deepEqual(extractTikTokComments(payload), [{ businessId: '_000biz', commentId: '7247303576418566913', videoId: '7203946942097902849', timestamp: 1687394416109 }]);
  const reply = { ...payload, content: content.replace('"comment_type":"comment"', '"comment_type":"reply"') };
  const deleted = { ...payload, content: content.replace('"insert"', '"delete"') };
  assert.deepEqual(extractTikTokComments(reply), []);
  assert.deepEqual(extractTikTokComments(deleted), []);
  assert.deepEqual(extractTikTokComments({ event: 'DIRECT_MESSAGE', user_openid: 'b', content: '{"conversation_id":"c"}' }), []);
  // Content already parsed (object): the IDs are taken from the raw body so they are not rounded.
  const raw = `{"event":"comment.update","user_openid":"_000biz","content":${content}}`;
  assert.equal(extractTikTokComments(JSON.parse(raw), raw)[0].commentId, '7247303576418566913');
});

test('TikTok comment API calls: videos, one comment, reply and the webhook subscription', async () => {
  const old = { ...process.env };
  process.env.TIKTOK_APP_ID = 'app1'; process.env.TIKTOK_APP_SECRET = 'sec';
  const calls = [];
  const reply = data => async (target, options = {}) => { calls.push({ url: new URL(String(target)), options }); return { ok: true, status: 200, json: async () => ({ code: 0, data }) }; };
  try {
    const page = await listTikTokVideos({ businessId: 'biz', token: 'tok', fetchImpl: reply({ videos: [{ item_id: '11', caption: 'Oak table', thumbnail_url: 'https://p16.tiktokcdn.com/x.jpg', create_time: '1700000000', share_url: 'https://www.tiktok.com/@a/video/11' }], has_more: true, cursor: 123 }) });
    assert.deepEqual(page.videos[0], { id: '11', caption: 'Oak table', thumbnail_url: 'https://p16.tiktokcdn.com/x.jpg', permalink: 'https://www.tiktok.com/@a/video/11', timestamp: new Date(1700000000000).toISOString() });
    assert.equal(page.hasMore, true); assert.equal(page.cursor, 123);
    assert.match(calls[0].url.pathname, /business\/video\/list\/$/); assert.equal(calls[0].url.searchParams.get('business_id'), 'biz');
    const comment = await getTikTokComment({ businessId: 'biz', videoId: '11', commentId: '99', token: 'tok', fetchImpl: reply({ comments: [{ comment_id: '99', video_id: '11', text: 'price?', owner: false, unique_identifier: 'u-1', username: 'ani', display_name: 'Ani', create_time: '1700000100' }] }) });
    assert.equal(comment.text, 'price?'); assert.equal(comment.userId, 'u-1'); assert.equal(comment.owner, false);
    assert.equal(calls[1].url.searchParams.get('comment_ids'), '["99"]');
    const posted = await replyToTikTokComment({ businessId: 'biz', videoId: '11', commentId: '99', text: 'It is $320', token: 'tok', fetchImpl: reply({ comment_id: 'r1' }) });
    assert.equal(posted.replyId, 'r1');
    assert.deepEqual(JSON.parse(calls[2].options.body), { business_id: 'biz', video_id: '11', comment_id: '99', text: 'It is $320' });
    await subscribeTikTokComments({ callbackUrl: 'https://hansora.co/.netlify/functions/automation-tiktok-webhook', fetchImpl: reply({}) });
    const body = JSON.parse(calls[3].options.body);
    assert.deepEqual(body, { app_id: 'app1', secret: 'sec', event_type: 'COMMENT', callback_url: 'https://hansora.co/.netlify/functions/automation-tiktok-webhook' });
    assert.equal('item_list' in body, false);
  } finally { process.env = old; }
});

function harness({ priorExecution = false, credits = true, replyFails = false, video = null } = {}) {
  const log = { inserts: [], updates: [], charges: [], replies: [] };
  const deps = {
    db: {
      first: async path => (path.includes('automation_comment_executions') && priorExecution ? { id: 'old' } : path.includes('automation_channel_connections') ? { id: 'conn' } : null),
      serviceInsert: async (table, row) => { log.inserts.push({ table, row }); return { id: `${table}-id`, ...row }; },
      serviceUpsert: async (table, keys, row) => ({ id: `${table}-id`, ...row }),
      serviceUpdate: async (table, filter, row) => { log.updates.push({ table, filter, row }); return row; }
    },
    tiktok: {
      getTikTokVideo: async () => video,
      replyToTikTokComment: async args => { if (replyFails) throw Object.assign(new Error('tiktok_request_failed'), { providerMessage: 'spam' }); log.replies.push(args); return { replyId: 'reply-1' }; }
    },
    billing: {
      automationPricesFor: async () => ({ aiReply: 0.12, commentRun: 0.1 }),
      canAfford: async () => ({ ok: credits }),
      chargeCredits: async args => { log.charges.push(args); return { ok: true, charged: args.credits }; }
    },
    writeReply: async () => ({ text: '"Yes! It is $320 🌳"', engine: 'gemini' })
  };
  return { log, deps };
}
const account = { business_id: 'b1', provider_resource_id: 'biz' };
const comment = { id: 'c1', videoId: 'v1', text: 'What is the price?', userId: 'u-1', username: 'ani', name: 'Ani', timestamp: 1700000000000 };
const workflow = over => ({ id: 'w1', post_scope: 'all', selected_post_ids: [], match_type: 'contains', keywords: ['price'], public_reply_variations: ['Thanks! 🙌', 'Thank you! 💛'], triggered_count: 0, activated_at: '2026-10-01T00:00:00Z', safety_config: { trigger_type: 'tiktok_comment', platform: 'tiktok', first_comment_only: true }, ...over });

test('TikTok comment automation: written reply, charged one comment run, shown in the Inbox', async () => {
  const { log, deps } = harness();
  assert.equal(await runWorkflow({ workflow: workflow(), comment, account, token: 'tok', deps }), true);
  assert.equal(log.replies.length, 1); assert.ok(['Thanks! 🙌', 'Thank you! 💛'].includes(log.replies[0].text));
  assert.equal(log.replies[0].commentId, 'c1'); assert.equal(log.replies[0].videoId, 'v1'); assert.equal(log.replies[0].businessId, 'biz');
  assert.deepEqual(log.charges.map(charge => [charge.kind, charge.credits]), [['comment_run', 0.1]]);
  const messages = log.inserts.filter(item => item.table === 'automation_messages').map(item => item.row.content);
  assert.deepEqual(messages, ['💬 Comment on your video: What is the price?', `↩️ Public reply: ${log.replies[0].text}`]);
  assert.equal(log.updates.find(item => item.table === 'automation_comment_executions').row.status, 'completed');
});

test('TikTok comment automation: AI reply is cleaned and charged as an AI reply', async () => {
  const { log, deps } = harness();
  await runWorkflow({ workflow: workflow({ public_reply_variations: [], safety_config: { trigger_type: 'tiktok_comment', reply_mode: 'ai' } }), comment, account, token: 'tok', deps });
  assert.equal(log.replies[0].text, 'Yes! It is $320 🌳');
  assert.deepEqual(log.charges.map(charge => [charge.kind, charge.credits]), [['ai_reply', 0.12]]);
  assert.ok(log.inserts.some(item => item.table === 'automation_usage_events'));
});

test('TikTok comment automation: skips other words, repeat commenters, no credits; failed replies are not charged', async () => {
  let run = harness();
  assert.equal(await runWorkflow({ workflow: workflow(), comment: { ...comment, text: 'nice video' }, account, token: 'tok', deps: run.deps }), false);
  run = harness({ priorExecution: true });
  assert.equal(await runWorkflow({ workflow: workflow(), comment, account, token: 'tok', deps: run.deps }), false);
  run = harness({ credits: false });
  assert.equal(await runWorkflow({ workflow: workflow(), comment, account, token: 'tok', deps: run.deps }), false);
  assert.equal(run.log.replies.length, 0);
  run = harness({ replyFails: true });
  assert.equal(await runWorkflow({ workflow: workflow(), comment, account, token: 'tok', deps: run.deps }), true);
  assert.equal(run.log.charges.length, 0);
  const execution = run.log.updates.find(item => item.table === 'automation_comment_executions').row;
  assert.equal(execution.status, 'failed'); assert.equal(execution.last_error, 'spam');
});

test('TikTok comment automation: chosen videos and "the next video I post"', async () => {
  let run = harness();
  assert.equal(await runWorkflow({ workflow: workflow({ post_scope: 'selected', selected_post_ids: ['other'] }), comment, account, token: 'tok', deps: run.deps }), false);
  assert.equal(await runWorkflow({ workflow: workflow({ post_scope: 'selected', selected_post_ids: ['v1'] }), comment, account, token: 'tok', deps: run.deps }), true);
  run = harness({ video: { id: 'v1', timestamp: '2026-09-01T00:00:00Z' } });
  assert.equal(await runWorkflow({ workflow: workflow({ post_scope: 'next' }), comment, account, token: 'tok', deps: run.deps }), false);
  run = harness({ video: { id: 'v1', timestamp: '2026-10-05T00:00:00Z' } });
  assert.equal(await runWorkflow({ workflow: workflow({ post_scope: 'next' }), comment, account, token: 'tok', deps: run.deps }), true);
  assert.deepEqual(run.log.updates.find(item => item.table === 'automation_comment_workflows' && item.row.selected_post_ids).row.selected_post_ids, ['v1']);
});

test('AI comment replies lose wrapping quotes and extra spaces', () => {
  assert.equal(cleanReply('  "Hi   there!"  '), 'Hi there!');
  assert.equal(cleanReply('x'.repeat(1300)).length, 1200);
});
