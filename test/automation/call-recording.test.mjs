import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { callerCorrections, compressRecording, correctCallerLines, ffmpegWorks, recordingOn } from '../../lib/automation/call-recording.mjs';

const turns = [
  { id: 'a1', role: 'assistant', text: 'Բարև, ինչո՞վ կարող եմ օգնել։' },
  { id: 'u1', role: 'user', text: 'Schattenlauf Artzberg' },
  { id: 'a2', role: 'assistant', text: 'Մենք աշխատում ենք 10-ից 19-ը։' },
  { id: 'u2', role: 'user', text: 'Շնորհակալություն' }
];

test('recording is on unless the owner turned it off', () => {
  assert.equal(recordingOn({}), true);
  assert.equal(recordingOn(undefined), true);
  assert.equal(recordingOn({ record_calls: false }), false);
});

test('only changed caller lines are taken from Gemini; AI lines and junk are ignored', () => {
  const raw = JSON.stringify({ caller: [{ n: 2, text: 'Ժամը քանիսի՞ն եք բացվում' }, { n: 1, text: 'AI line must not change' }, { n: 4, text: 'Շնորհակալություն' }, { n: 9, text: 'no such line' }, { n: 2.5, text: 'x' }] });
  assert.deepEqual(callerCorrections(raw, turns), [{ id: 'u1', text: 'Ժամը քանիսի՞ն եք բացվում' }]);
  assert.deepEqual(callerCorrections('not json', turns), []);
  assert.deepEqual(callerCorrections('```json\n{"caller":[{"n":2,"text":"Բարև"}]}\n```', turns), [{ id: 'u1', text: 'Բարև' }]);
});

test('Gemini gets the recording and the numbered transcript, and a failure changes nothing', async () => {
  let sent;
  const ok = async (url, options) => { sent = JSON.parse(options.body); return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"caller":[{"n":2,"text":"Ժամը քանիսի՞ն եք բացվում"}]}' }] } }] }) }; };
  const changes = await correctCallerLines({ audio: Buffer.from('ogg'), turns, languages: ['Armenian'], key: 'k', fetchImpl: ok });
  assert.deepEqual(changes, [{ id: 'u1', text: 'Ժամը քանիսի՞ն եք բացվում' }]);
  assert.equal(sent.contents[0].parts[0].inline_data.mime_type, 'audio/ogg');
  assert.match(sent.contents[0].parts[1].text, /2\. Caller: Schattenlauf Artzberg/);
  assert.match(sent.contents[0].parts[1].text, /usually speak Armenian/);
  assert.deepEqual(await correctCallerLines({ audio: Buffer.from('ogg'), turns, key: 'k', fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'down' }) }), []);
  assert.deepEqual(await correctCallerLines({ audio: Buffer.from('ogg'), turns: turns.filter(turn => turn.role === 'assistant'), key: 'k', fetchImpl: ok }), [], 'no caller lines: nothing to ask');
  assert.deepEqual(await correctCallerLines({ audio: Buffer.from('ogg'), turns, key: '', fetchImpl: ok }), [], 'no key: nothing to ask');
});

// The phone worker's bundled ffmpeg (Opus/Ogg build), when installed locally.
const ffmpeg = path.resolve('workers/automation-phone/node_modules/@livekit/av-linux-x64/ffmpeg');
test('a stereo recording becomes one small mono Opus file', { skip: !existsSync(ffmpeg) }, async () => {
  assert.equal(await ffmpegWorks(ffmpeg), true);
  const dir = await mkdtemp(path.join(tmpdir(), 'rec-'));
  // Two seconds of a stereo tone as WAV.
  const rate = 24000, seconds = 2, frames = rate * seconds;
  const data = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++) { const v = Math.round(Math.sin(i / 20) * 8000); data.writeInt16LE(v, i * 4); data.writeInt16LE(-v, i * 4 + 2); }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8); header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  const input = path.join(dir, 'in.wav'), output = path.join(dir, 'out.ogg');
  await writeFile(input, Buffer.concat([header, data]));
  assert.equal(await compressRecording({ ffmpeg, input, output }), true);
  const file = await readFile(output);
  assert.equal(file.subarray(0, 4).toString(), 'OggS');
  assert.ok(file.length < data.length / 5, 'much smaller than the raw audio');
  assert.equal(await compressRecording({ ffmpeg, input: path.join(dir, 'missing.ogg'), output }), false);
});
