import test from 'node:test';
import assert from 'node:assert/strict';
import { PHONE_VOICES, PHONE_RECOMMENDED_VOICES, phoneTestSettings, phoneVoice } from '../../lib/automation/phone.mjs';
import { handler, interactionAudio, pcmToWav } from '../../netlify/functions/automation-phone-voice-preview.mjs';

test('voice names are validated and normalised', () => {
  assert.equal(PHONE_VOICES.length, 30);
  assert.deepEqual(PHONE_RECOMMENDED_VOICES, ['Leda', 'Callirrhoe', 'Schedar', 'Sadachbia']);
  assert.equal(phoneVoice('callirrhoe'), 'Callirrhoe');
  assert.equal(phoneVoice('Nope'), '');
  assert.equal(phoneTestSettings({ voice: 'schedar' }).voice, 'Schedar');
  assert.equal('voice' in phoneTestSettings({ voice: 'x' }), false);
});

test('preview finds audio in an Interactions answer and wraps raw PCM as WAV', () => {
  assert.equal(interactionAudio({ steps: [{ type: 'model_output', content: [{ type: 'text' }, { type: 'audio', data: 'QUJD' }] }] }), 'QUJD');
  const wav = pcmToWav(Buffer.alloc(10));
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  assert.equal(wav.length, 54);
});

test('preview rejects unknown voices and returns cached WAV audio', async () => {
  assert.equal((await handler({ httpMethod: 'GET', queryStringParameters: { voice: 'bad' } })).statusCode, 400);
  process.env.GEMINI_API_KEY = 'test-key';
  let sent;
  const fetchImpl = async (url, options) => { sent = { url, body: JSON.parse(options.body) }; return { ok: true, json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: pcmToWav(Buffer.alloc(4)).toString('base64') }] }] }) }; };
  const response = await handler({ httpMethod: 'GET', queryStringParameters: { voice: 'leda', lang: 'hy' } }, {}, fetchImpl);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Content-Type'], 'audio/wav');
  assert.match(sent.url, /\/interactions$/);
  assert.equal(sent.body.generation_config.speech_config[0].voice, 'Leda');
  delete process.env.GEMINI_API_KEY;
});
