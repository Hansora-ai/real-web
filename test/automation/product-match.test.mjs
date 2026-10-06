import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseCandidates, matchLine, matchProductPhoto } from '../../lib/automation/product-match.mjs';

process.env.GOOGLE_API_KEY ||= 'test-google';
const sofa = { id: 'aaaaaaaa-1111-1111-1111-111111111111', name: 'Oslo sofa', category: 'Sofas', variants: [{ name: 'Grey' }, { name: 'Blue' }], photos: [{ url: 'https://cdn.example/oslo-grey.jpg', variant: 'Grey' }] };
const sofa3 = { id: 'cccccccc-3333-3333-3333-333333333333', name: 'Oslo sofa 3-seat', category: 'Sofas', variants: [], photos: [{ url: 'https://cdn.example/oslo3.jpg' }] };
const lamp = { id: 'bbbbbbbb-2222-2222-2222-222222222222', name: 'Desk lamp', category: 'Lighting', variants: [], photos: [] };

test('only products with photos are compared; a big catalog is narrowed by the description', () => {
  assert.deepEqual(chooseCandidates([sofa, lamp, sofa3]).map(p => p.name), ['Oslo sofa', 'Oslo sofa 3-seat']);
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`, name: i === 17 ? 'Velvet armchair' : `Item ${i}`, photos: [{ url: 'https://x' }], variants: [] }));
  assert.equal(chooseCandidates(many, 'a green velvet armchair')[0].name, 'Velvet armchair');
});

test('the result line names the exact product and variant, and asks when unsure', () => {
  const byRef = new Map([['aaaaaaaa', sofa], ['cccccccc', sofa3]]);
  assert.match(matchLine({ match_ref: 'aaaaaaaa', variant: 'grey', confidence: 'high', similar_refs: ['cccccccc'] }, byRef), /^Catalog match: Oslo sofa — grey \(ref aaaaaaaa, high confidence\)\. Also similar: Oslo sofa 3-seat/);
  assert.match(matchLine({ match_ref: 'aaaaaaaa', variant: 'Purple', confidence: 'medium' }, byRef), /Oslo sofa \(ref aaaaaaaa, medium confidence\)\. Confirm with the customer/);
  assert.match(matchLine({ match_ref: null, similar_refs: ['aaaaaaaa'] }, byRef), /no exact product match.*ask the customer/);
  assert.equal(matchLine({ match_ref: null }, byRef), 'Catalog: no product in the catalog matches this photo.');
});

test('the customer photo is sent together with the product photos, and the catalog switch is respected', async () => {
  let geminiBody = null;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).startsWith('https://cdn.example/')) return new Response(new Uint8Array([7]), { headers: { 'content-type': 'image/jpeg' } });
    geminiBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"match_ref":"aaaaaaaa","variant":"Grey","confidence":"high","similar_refs":[]}' }] } }] }), { headers: { 'content-type': 'application/json' } });
  };
  const deps = { first: async () => ({ enabled: true }), supabaseRequest: async () => [sofa, lamp, sofa3], rows: v => v, fetchImpl };
  const line = await matchProductPhoto({ businessId: 'b1', buffer: Buffer.from([1, 2]), description: 'grey sofa' }, deps);
  assert.match(line, /^Catalog match: Oslo sofa — Grey/);
  const texts = geminiBody.contents[0].parts.filter(p => p.text).map(p => p.text);
  assert.equal(geminiBody.contents[0].parts.filter(p => p.inline_data).length, 3);
  assert.ok(texts.some(t => t.startsWith('PRODUCT ref aaaaaaaa: Oslo sofa')));
  assert.equal(geminiBody.generationConfig.responseMimeType, 'application/json');
  assert.equal(await matchProductPhoto({ businessId: 'b1', buffer: Buffer.from([1]) }, { ...deps, first: async () => ({ enabled: false }) }), '');
  assert.equal(await matchProductPhoto({ businessId: 'b1', buffer: Buffer.from([1]) }, { ...deps, supabaseRequest: async () => [lamp] }), '');
});

test('a shared reel or video story is matched too, and product photos stay within the request size', async () => {
  let geminiBody = null;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).startsWith('https://cdn.example/')) return new Response(new Uint8Array(3 * 1024 * 1024), { headers: { 'content-type': 'image/jpeg' } });
    geminiBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"match_ref":"aaaaaaaa","variant":"Grey","confidence":"high","similar_refs":[]}' }] } }] }), { headers: { 'content-type': 'application/json' } });
  };
  const deps = { first: async () => ({ enabled: true }), supabaseRequest: async () => [sofa, sofa3], rows: v => v, fetchImpl };
  const video = Buffer.alloc(14 * 1024 * 1024);
  const line = await matchProductPhoto({ businessId: 'b1', buffer: video, mimeType: 'video/mp4' }, deps);
  assert.match(line, /^Catalog match: Oslo sofa — Grey/);
  const parts = geminiBody.contents[0].parts;
  assert.equal(parts[0].text, 'CUSTOMER VIDEO (what the customer sent or shared):');
  assert.equal(parts.filter(p => p.inline_data).length, 2); // the video + one 3 MB photo fit in 19 MB, a second does not
  assert.equal(await matchProductPhoto({ businessId: 'b1', buffer: Buffer.alloc(19 * 1024 * 1024), mimeType: 'video/mp4' }, deps), '');
});
