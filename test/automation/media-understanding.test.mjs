import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaMessage, understandMedia } from '../../lib/automation/media.mjs';

process.env.ELEVENLABS_API_KEY ||= 'test-eleven';
process.env.GOOGLE_API_KEY ||= 'test-google';

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const route = routes.find(item => String(url).includes(item.match));
    if (!route) return new Response('not found', { status: 404 });
    return new Response(route.body, { status: route.status || 200, headers: route.headers || { 'content-type': 'application/json' } });
  };
  impl.calls = calls;
  return impl;
}

test('a voice note is downloaded, transcribed and becomes what the customer said', async () => {
  const fetchImpl = fakeFetch([
    { match: 'cdn.example/voice', body: new Uint8Array([1, 2, 3, 4]), headers: { 'content-type': 'audio/mp4', 'content-length': '4' } },
    { match: 'api.elevenlabs.io/v1/speech-to-text', body: JSON.stringify({ text: 'Բարև, քանի՞ է պիցցան', language_code: 'hye' }) }
  ]);
  const media = await understandMedia({ url: 'https://cdn.example/voice.m4a', kind: 'audio', fetchImpl });
  assert.equal(media.kind, 'audio'); assert.equal(media.transcript, 'Բարև, քանի՞ է պիցցան'); assert.equal(media.language, 'hye');
  const stt = fetchImpl.calls.find(call => call.url.includes('speech-to-text'));
  assert.equal(stt.options.headers['xi-api-key'], 'test-eleven');
  const shown = mediaMessage({ source: 'audio', media });
  assert.equal(shown.content, '🎤 Voice message: Բարև, քանի՞ է պիցցան');
  assert.equal(shown.aiText, 'Բարև, քանի՞ է պիցցան');
});

test('a photo is described by Gemini and answered with the caption or a default question', async () => {
  const fetchImpl = fakeFetch([
    { match: 'lookaside.example/photo', body: new Uint8Array([9, 9, 9]), headers: { 'content-type': 'image/jpeg' } },
    { match: 'generativelanguage.googleapis.com', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'A grey two-seat sofa.' }] } }] }) }
  ]);
  const media = await understandMedia({ url: 'https://lookaside.example/photo.jpg', fetchImpl });
  assert.equal(media.kind, 'image'); assert.equal(media.description, 'A grey two-seat sofa.'); assert.equal(media.mediaPath, '');
  const gemini = fetchImpl.calls.find(call => call.url.includes('generativelanguage'));
  assert.equal(gemini.options.headers['x-goog-api-key'], 'test-google');
  assert.match(gemini.options.body, /"mime_type":"image\/jpeg"/);
  const withCaption = mediaMessage({ source: 'image', media, caption: 'Do you have it in blue?' });
  assert.equal(withCaption.content, '📷 Photo — A grey two-seat sofa.\nDo you have it in blue?');
  assert.equal(withCaption.aiText, 'Do you have it in blue?');
  assert.match(withCaption.note, /grey two-seat sofa/);
  assert.equal(mediaMessage({ source: 'share', media }).aiText, 'What about this post?');
  assert.equal(mediaMessage({ source: 'image', media }).aiText, 'What about this?');
});

test('a failed download, a too-large file or a provider error falls back to nothing (old behaviour)', async () => {
  assert.equal(await understandMedia({ url: 'https://x.example/gone', fetchImpl: fakeFetch([]) }), null);
  const huge = fakeFetch([{ match: 'x.example/video', body: new Uint8Array([1]), headers: { 'content-type': 'video/mp4', 'content-length': String(100 * 1024 * 1024) } }]);
  assert.equal(await understandMedia({ url: 'https://x.example/video.mp4', fetchImpl: huge }), null);
  const refused = fakeFetch([
    { match: 'x.example/photo', body: new Uint8Array([1]), headers: { 'content-type': 'image/png' } },
    { match: 'generativelanguage', body: '{"error":"quota"}', status: 429 }
  ]);
  assert.equal(await understandMedia({ url: 'https://x.example/photo.png', fetchImpl: refused }), null);
  assert.equal(await understandMedia({ url: 'http://insecure.example/a.jpg', fetchImpl: fakeFetch([]) }), null);
});

test('if a Gemini model name no longer exists, the next current one is used', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('x.example/pic')) return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } });
    if (String(url).includes('gemini-3.5-flash:')) return new Response('{"error":{"code":404}}', { status: 404 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'A menu.' }] } }] }), { headers: { 'content-type': 'application/json' } });
  };
  const media = await understandMedia({ url: 'https://x.example/pic.jpg', fetchImpl });
  assert.equal(media.description, 'A menu.');
  assert.ok(calls.some(url => url.includes('gemini-3.5-flash:')) && calls.some(url => url.includes('gemini-3-flash:')));
});

test('the voice language is passed on, so an English voice note is answered in English', () => {
  const shown = mediaMessage({ source: 'audio', media: { kind: 'audio', transcript: 'How much is the pizza?', language: 'eng' } });
  assert.match(shown.note, /They spoke English/);
  assert.doesNotMatch(mediaMessage({ source: 'audio', media: { kind: 'audio', transcript: 'x', language: '' } }).note, /They spoke/);
});

test('the photo is described with the business and the chat as context, and a private copy is stored', async () => {
  process.env.SUPABASE_URL = 'https://db.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('cdn.example/pricing')) return new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/png' } });
    if (String(url).includes('/storage/v1/object/automation-media/')) return new Response('{}', { status: 200 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'A pricing page. Relevance: matches your credit packs.' }] } }] }), { headers: { 'content-type': 'application/json' } });
  };
  const business = '11111111-1111-1111-1111-111111111111', conversation = '22222222-2222-2222-2222-222222222222';
  const media = await understandMedia({ url: 'https://cdn.example/pricing.png', caption: 'is that it', context: 'Business: Hansora\nLatest messages:\nCustomer: how much?', store: { businessId: business, channel: 'instagram_dm', conversationId: conversation, key: 'mid.123' }, fetchImpl });
  assert.equal(media.mediaPath, `${business}/instagram_dm/${conversation}/mid123.png`);
  const prompt = JSON.parse(calls.find(call => call.url.includes('generativelanguage')).options.body).contents[0].parts[1].text;
  assert.match(prompt, /Latest messages:\nCustomer: how much\?/);
  assert.match(prompt, /is that it/);
  assert.match(prompt, /Relevance:/);
});
