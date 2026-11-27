// Phone call recordings: the phone AI records the call (caller and AI together), keeps a small private copy the
// owner can play in the inbox, and uses it once to correct the caller's lines in the transcript. Recordings are
// deleted with the other media after the retention period (automation-media-cleanup, 30 days by default).
import { spawn } from 'node:child_process';

// On unless the owner turned it off in the phone settings.
export function recordingOn(settings) { return settings?.record_calls !== false; }

// The short sentence the AI adds after its greeting while calls are recorded.
export const RECORDING_NOTICE = 'Then add one short sentence, in the same language, that the call may be recorded to improve the service.';

// The recorder's stereo file (caller left, AI right) → one small mono Opus file for listening and for Gemini.
export function compressRecording({ ffmpeg, input, output, timeoutMs = 20000 }) {
  return new Promise(resolve => {
    let done = false;
    const finish = ok => { if (!done) { done = true; clearTimeout(timer); resolve(ok); } };
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-ac', '1', '-c:a', 'libopus', '-b:a', '24k', '-f', 'ogg', output], { stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-500); });
    child.on('error', error => { console.warn('call recording compress failed', { message: error?.message }); finish(false); });
    child.on('close', code => { if (code !== 0) console.warn('call recording compress failed', { code, errors }); finish(code === 0); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(false); }, timeoutMs);
  });
}

// Whether ffmpeg runs at all (checked once): without it nothing is recorded and calls work as before.
let ffmpegChecked = null;
export function ffmpegWorks(ffmpeg) {
  if (!ffmpeg) return Promise.resolve(false);
  ffmpegChecked ||= new Promise(resolve => {
    try {
      const child = spawn(ffmpeg, ['-hide_banner', '-version'], { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('close', code => resolve(code === 0));
    } catch (_) { resolve(false); }
  });
  return ffmpegChecked;
}

// The live transcript of the caller is written in real time and is often wrong (Armenian heard as German). Gemini
// listens to the whole recording once and corrects only the caller's lines; the AI's lines are what it said and stay.
// turns: [{ id, role: 'user'|'assistant', text }]. Returns [{ id, text }] for caller lines that changed.
export async function correctCallerLines({ audio, mimeType = 'audio/ogg', turns, languages = [], key = String(process.env.GOOGLE_API_KEY || '').trim(), fetchImpl = fetch, timeoutMs = 30000 }) {
  const lines = turns.filter(turn => turn?.text && (turn.role === 'user' || turn.role === 'assistant'));
  if (!key || !audio?.length || audio.length > 14 * 1024 * 1024 || !lines.some(turn => turn.role === 'user')) return [];
  const numbered = lines.map((turn, index) => `${index + 1}. ${turn.role === 'user' ? 'Caller' : 'AI'}: ${String(turn.text).replace(/\s+/g, ' ').trim()}`).join('\n');
  const prompt = [
    'This is a recording of a phone call between a caller and the AI assistant of a business.',
    'Below is the live transcript, one numbered line per turn. The AI lines are exactly what the AI said. The Caller lines were written by a fast live speech recognizer and are often wrong, for example Armenian words written as German or Spanish.',
    `Listen to the recording and write what the caller really said in each Caller line, in the language they spoke, in that language's normal alphabet (Armenian in Armenian letters, Russian in Cyrillic).${languages.length ? ` The callers usually speak ${languages.join(', ')}.` : ''}`,
    'Keep the same line numbers. If a Caller line is already right, or you cannot hear that part, return it unchanged. Do not merge, split or add lines, and never invent words that were not said.',
    'Return JSON only: {"caller":[{"n":<line number>,"text":"<what the caller said>"}]}',
    '',
    numbered
  ].join('\n');
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mimeType, data: Buffer.from(audio).toString('base64') } }, { text: prompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 8192, responseMimeType: 'application/json' }
  });
  const models = [...new Set([process.env.GEMINI_TRANSCRIBE_MODEL, 'gemini-3.5-flash', 'gemini-3-flash', 'gemini-2.5-flash'].filter(Boolean))];
  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body, signal: controller.signal });
      if (response.status === 404) continue;
      if (!response.ok) { console.warn('call transcript correction failed', { model, status: response.status, body: (await response.text().catch(() => '')).slice(0, 200) }); return []; }
      const data = await response.json().catch(() => ({}));
      const raw = (data.candidates?.[0]?.content?.parts || []).filter(part => !part.thought).map(part => part.text || '').join('');
      return callerCorrections(raw, lines);
    } catch (error) {
      console.warn('call transcript correction failed', { model, message: error?.message });
      return [];
    } finally { clearTimeout(timer); }
  }
  return [];
}

// Only real caller lines that changed, each a plausible length; anything else from the model is ignored.
export function callerCorrections(raw, lines) {
  let parsed;
  try { parsed = JSON.parse(String(raw || '').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (_) { return []; }
  const items = Array.isArray(parsed?.caller) ? parsed.caller : [];
  const changes = [];
  for (const item of items) {
    const turn = lines[Number(item?.n) - 1];
    const text = String(item?.text || '').replace(/\s+/g, ' ').trim();
    if (!turn || turn.role !== 'user' || !text || text.length > 4000 || text === String(turn.text).replace(/\s+/g, ' ').trim()) continue;
    changes.push({ id: turn.id, text });
  }
  return changes;
}
