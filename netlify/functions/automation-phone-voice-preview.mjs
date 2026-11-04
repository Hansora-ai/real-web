import { phoneVoice } from '../../lib/automation/phone.mjs';

// A short sample of one Gemini voice, so owners can hear it before choosing.
// GET ?voice=Leda&lang=hy → audio/wav. The text is fixed and the answer is cached by the CDN for a year,
// so each voice and language is generated only once (no login needed, nothing the caller controls is spoken).
const SAMPLES = {
  hy: 'Բարև ձեզ։ Ես ձեր բիզնեսի AI օգնականն եմ։ Ինչո՞վ կարող եմ օգնել ձեզ այսօր։',
  ru: 'Здравствуйте! Я AI-помощник вашего бизнеса. Чем могу помочь?',
  en: 'Hello! I am your business AI assistant. How can I help you today?'
};
const STYLE = 'warm, friendly and natural, like a helpful phone receptionist';
const API = 'https://generativelanguage.googleapis.com/v1beta';

const error = (statusCode, code) => ({ statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: code }) });

// Raw 16-bit mono PCM → a playable WAV file.
export function pcmToWav(pcm, sampleRate = 24000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// The audio block of an Interactions API answer (base64 WAV).
export function interactionAudio(data) {
  if (data?.output_audio?.data) return data.output_audio.data;
  const blocks = (Array.isArray(data?.steps) ? data.steps : []).filter(step => step?.type === 'model_output').flatMap(step => Array.isArray(step.content) ? step.content : []).filter(block => block?.type === 'audio' && block.data);
  return blocks.at(-1)?.data || '';
}

async function viaInteractions({ key, model, voice, text, fetchImpl }) {
  const response = await fetchImpl(`${API}/interactions`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style: STYLE }] }] }], response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice }] } })
  });
  if (!response.ok) throw new Error(`interactions_${response.status}`);
  const audio = interactionAudio(await response.json());
  if (!audio) throw new Error('interactions_no_audio');
  const buffer = Buffer.from(audio, 'base64');
  return buffer.subarray(0, 4).toString() === 'RIFF' ? buffer : pcmToWav(buffer);
}

// Older generateContent route, used only if the Interactions API refuses.
async function viaGenerateContent({ key, model, voice, text, fetchImpl }) {
  const response = await fetchImpl(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: `Say in a ${STYLE} voice: ${text}` }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } })
  });
  if (!response.ok) throw new Error(`generate_${response.status}`);
  const part = (await response.json())?.candidates?.[0]?.content?.parts?.find(item => item?.inlineData?.data);
  if (!part) throw new Error('generate_no_audio');
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1]) || 24000;
  const buffer = Buffer.from(part.inlineData.data, 'base64');
  return buffer.subarray(0, 4).toString() === 'RIFF' ? buffer : pcmToWav(buffer, rate);
}

export async function handler(event, _context, fetchImpl = fetch) {
  if (event.httpMethod !== 'GET') return error(405, 'method_not_allowed');
  const voice = phoneVoice(event.queryStringParameters?.voice);
  if (!voice) return error(400, 'unknown_voice');
  const lang = SAMPLES[event.queryStringParameters?.lang] ? event.queryStringParameters.lang : 'en';
  const key = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (!key) return error(503, 'voice_preview_not_configured');
  const model = String(process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts').trim();
  const request = { key, model, voice, text: SAMPLES[lang], fetchImpl };
  try {
    const wav = await viaInteractions(request).catch(first => { console.warn('voice preview: interactions failed, trying generateContent', { voice, message: first?.message }); return viaGenerateContent(request); });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'public, max-age=86400', 'Netlify-CDN-Cache-Control': 'public, durable, max-age=31536000, immutable' },
      body: wav.toString('base64'),
      isBase64Encoded: true
    };
  } catch (failure) {
    console.error('voice preview failed', { voice, lang, model, message: failure?.message });
    return error(502, 'voice_preview_failed');
  }
}
