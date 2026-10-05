import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolRunner, buildToolDefinitions, toolInstructions } from '../../lib/automation/tools.mjs';
import { extractInstagramMessages } from '../../lib/automation/meta.mjs';
import { mediaFallback } from '../../lib/automation/media.mjs';
import { isScheduledRun } from '../../lib/automation/schedule.mjs';
import { planFlowAdvance } from '../../lib/automation/comment-flow.mjs';

const BUSINESS = '11111111-1111-1111-1111-111111111111';
const rug = { id: 'cccccccc-3333-3333-3333-333333333333', name: 'Soft wool rug', active: true, price: 75000, currency: 'AMD', stock: 5, variants: [{ name: 'Grey', stock: 5 }, { name: 'Beige', stock: 0 }], photos: [{ path: `${BUSINESS}/products/c/1.jpg`, variant: 'Grey' }, { url: 'https://cdn.example/rug-beige.jpg', variant: 'Beige' }], payment_link: 'https://pay.example/rug' };
const orderFields = ['Customer name', 'Phone number', 'Delivery address'];

function runner({ reduceStock = true, sendImage } = {}) {
  const inserted = [], updated = [];
  const tools = [
    { tool_type: 'orders', enabled: true, config: { required_fields: orderFields } },
    { tool_type: 'catalog', enabled: true, config: { reduce_stock: reduceStock } }
  ];
  const run = createToolRunner({ businessId: BUSINESS, conversationId: '22222222-2222-2222-2222-222222222222', contactId: null, channel: 'instagram_dm', ...(sendImage ? { sendImage } : {}) }, {
    first: async path => path.includes('automation_businesses') ? { id: BUSINESS, name: 'Casa', timezone: 'Asia/Yerevan' } : path.includes('automation_products') && path.includes('cccccccc') ? structuredClone(rug) : null,
    supabaseRequest: async path => path.includes('automation_tool_configs') ? tools : [],
    rows: value => value,
    serviceInsert: async (table, row) => { inserted.push({ table, row }); return { id: 'o1', reference_number: 7, ...row }; },
    serviceUpdate: async (table, query, value) => { updated.push({ table, query, value }); return [value]; },
    notifyOwner: async () => null
  });
  return { run, inserted, updated };
}
const order = { customer_name: 'Hovhannes', phone_number: '091918868', delivery_address: 'Aygektsi 10/4', customer_confirmed: true };

test('an order for a colour that does not exist or is sold out is refused with the reason', async () => {
  const { run, inserted } = runner();
  const green = await run('create_order', { ...order, catalog_items: 'cccccccc (Green) x3' });
  assert.equal(green.ok, false); assert.equal(green.error, 'catalog_problem');
  assert.match(green.problems[0], /does not come in "Green"; it comes in: Grey, Beige/);
  const beige = await run('create_order', { ...order, catalog_items: 'cccccccc (Beige) x1' });
  assert.match(beige.problems[0], /Beige\) is out of stock/);
  assert.equal(inserted.length, 0);
});

test('stock goes down as soon as the AI places the order (not only when confirmed)', async () => {
  const { run, updated } = runner();
  const result = await run('create_order', { ...order, catalog_items: 'cccccccc (Grey) x2' });
  assert.equal(result.ok, true);
  const stock = updated.find(item => item.table === 'automation_products');
  assert.deepEqual(stock.value.variants.map(v => v.stock), [3, 0]);
  assert.equal(stock.value.stock, 3);
  assert.equal(updated.find(item => item.table === 'automation_outcomes').value.collected_fields._stock_reduced, true);
  const { run: off, updated: none } = runner({ reduceStock: false });
  await off('create_order', { ...order, catalog_items: 'cccccccc (Grey) x1' });
  assert.equal(none.some(item => item.table === 'automation_products'), false);
});

test('payment is an ordinary order question; a product payment link comes back with the order', async () => {
  const fields = [...orderFields, 'Payment: cash or card'];
  const definition = buildToolDefinitions({ tools: { orders: { enabled: true, config: { required_fields: fields } } } }).find(item => item.name === 'create_order');
  assert.equal(definition.parameters.properties.payment_method, undefined);
  const instructions = toolInstructions([definition], { orders: { enabled: true, config: { required_fields: fields } } });
  assert.match(instructions, /in this order, and get an answer for each: Customer name; Phone number; Delivery address; Payment: cash or card\./);
  const { run } = runner();
  const result = await run('create_order', { ...order, catalog_items: 'cccccccc (Grey) x1' });
  assert.deepEqual(result.payment_links, ['https://pay.example/rug']);
  rug.payment_link = '';
  assert.equal((await run('create_order', { ...order, catalog_items: 'cccccccc (Grey) x2' })).payment_links, undefined);
  rug.payment_link = 'https://pay.example/rug';
});

test('the AI sends the photo of the asked colour into the chat', async () => {
  const sent = [];
  const { run } = runner({ sendImage: async item => { sent.push(item); return { messageId: 'm1' }; } });
  const result = await run('send_product_photos', { products: 'cccccccc (Beige)' });
  assert.equal(result.ok, true);
  assert.equal(sent[0].photo.url, 'https://cdn.example/rug-beige.jpg');
  assert.equal(sent[0].caption, 'Soft wool rug — Beige');
  const { run: noPhotos } = runner();
  assert.equal((await noPhotos('send_product_photos', { products: 'cccccccc' })).error, 'photos_not_available_here');
});

test("Instagram's own card for a phone number is not a photo, and never a separate customer message", () => {
  const payload = { object: 'instagram', entry: [{ id: 'ig', messaging: [
    { sender: { id: 'cust' }, recipient: { id: 'ig' }, timestamp: 1, message: { mid: 'm1', text: 'Hovhannes, 091918868, aygekci 10/4', attachments: [{ type: 'fallback', payload: { url: 'https://example.com' } }] } },
    { sender: { id: 'cust' }, recipient: { id: 'ig' }, timestamp: 2, message: { mid: 'm2', attachments: [{ type: 'template', payload: {} }] } },
    { sender: { id: 'cust' }, recipient: { id: 'ig' }, timestamp: 3, message: { mid: 'm3', attachments: [{ type: 'ig_reel', payload: { url: 'https://lookaside.example/reel', title: 'Grey rug in our living room' } }] } }
  ] }] };
  const messages = extractInstagramMessages(payload);
  assert.deepEqual(messages.map(item => [item.externalEventId, item.kind, item.attachmentTypes.length]), [['m1', 'text', 0], ['m3', 'share', 1]]);
  assert.equal(messages[1].attachmentTitle, 'Grey rug in our living room');
});

test('a reel that cannot be opened is still answered honestly, with its caption', () => {
  const fallback = mediaFallback({ source: 'share', kind: 'video', title: 'Grey rug in our living room' });
  assert.equal(fallback.aiText, 'What about this post?');
  assert.match(fallback.note, /could not be opened, so you cannot see it\. Its caption says: "Grey rug in our living room"/);
  assert.match(fallback.content, /Shared a post or reel — caption: Grey rug/);
});

test('scheduled runs are recognised by the next_run body as well as the header', () => {
  assert.equal(isScheduledRun({ body: JSON.stringify({ next_run: '2026-10-05T10:00:00Z' }) }), true);
  assert.equal(isScheduledRun({ headers: { 'x-nf-event': 'schedule' } }), true);
  assert.equal(isScheduledRun({ body: '{}' }), false);
  assert.equal(isScheduledRun({ body: 'nonsense' }), false);
});

test('a button added with "Decide later" ends the automation when tapped (it never jumps to another step)', () => {
  const nodes = [
    { id: 'm1', type: 'message', text: 'Pick one', replyNextId: null, actions: [{ id: 'a1', type: 'quick_reply', label: 'Later one', nextId: null }, { id: 'a2', type: 'quick_reply', label: 'Go', nextId: 'm3' }] },
    { id: 'm2', type: 'message', text: 'Should never be sent', replyNextId: null, actions: [] },
    { id: 'm3', type: 'message', text: 'Connected step', replyNextId: null, actions: [] }
  ];
  const later = planFlowAdvance({ nodes, startIndex: 0, inboundPayload: 'HANSORA_FLOW:a1', inboundText: 'Later one' });
  assert.equal(later.actions.length, 0);
  assert.equal(later.nextIndex, nodes.length);
  const go = planFlowAdvance({ nodes, startIndex: 0, inboundPayload: 'HANSORA_FLOW:a2', inboundText: 'Go' });
  assert.equal(go.actions[0].text, 'Connected step');
});

test('a shared reel is only a page link: its id is kept, and the video is read only for the business\'s own reels', async () => {
  const payload = { object: 'instagram', entry: [{ id: 'ig', messaging: [{ sender: { id: 'cust' }, recipient: { id: 'ig' }, timestamp: 1, message: { mid: 'r1', attachments: [{ type: 'ig_reel', payload: { url: 'https://www.instagram.com/reel/DY4BoYct6u5/', title: 'may chair', reel_video_id: '18119571112663732' } }] } }] }] };
  const [message] = extractInstagramMessages(payload);
  assert.equal(message.attachmentMediaId, '18119571112663732');
  const { getInstagramMediaFile } = await import('../../lib/automation/meta.mjs');
  for (const name of ['META_INSTAGRAM_APP_ID', 'META_INSTAGRAM_APP_SECRET', 'META_INSTAGRAM_REDIRECT_URI', 'META_WEBHOOK_VERIFY_TOKEN', 'HANSORA_AUTOMATION_OAUTH_SECRET']) process.env[name] ||= 'test-value';
  const own = await getInstagramMediaFile({ mediaId: '18119571112663732', accessToken: 't', fetchImpl: async url => { assert.match(String(url), /18119571112663732\?fields=media_type%2Cmedia_url/); return new Response(JSON.stringify({ media_type: 'VIDEO', media_url: 'https://scontent.cdninstagram.com/v/reel.mp4' }), { status: 200 }); } });
  assert.deepEqual(own, { url: 'https://scontent.cdninstagram.com/v/reel.mp4', type: 'video' });
  const other = await getInstagramMediaFile({ mediaId: '18119571112663732', accessToken: 't', fetchImpl: async () => new Response(JSON.stringify({ error: { code: 10, message: 'not owned' } }), { status: 400 }) });
  assert.equal(other, null);
  assert.equal(await getInstagramMediaFile({ mediaId: 'https://evil', accessToken: 't' }), null);
  // The id is not accepted, but the reel is one of the account's own posts: found by its link.
  const byLink = await getInstagramMediaFile({ mediaId: '18119571112663732', pageUrl: 'https://www.instagram.com/reel/DY4BoYct6u5/', instagramUserId: '17841400000000000', accessToken: 't', fetchImpl: async url => {
    if (String(url).includes('/17841400000000000/media')) return new Response(JSON.stringify({ data: [{ media_type: 'IMAGE', media_url: 'https://cdn/x.jpg', permalink: 'https://www.instagram.com/p/OTHER123/' }, { media_type: 'VIDEO', media_url: 'https://cdn/own.mp4', permalink: 'https://www.instagram.com/reel/DY4BoYct6u5/' }] }), { status: 200 });
    return new Response(JSON.stringify({ error: { code: 100 } }), { status: 400 });
  } });
  assert.deepEqual(byLink, { url: 'https://cdn/own.mp4', type: 'video' });
});
