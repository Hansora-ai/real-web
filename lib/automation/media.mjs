// Media understanding for chats: what a customer sends that is not text becomes text the AI can answer and the
// owner can read in the inbox. Voice → ElevenLabs speech-to-text. Photos, videos, shared posts/reels and stories →
// Gemini describes them. Any failure returns null, and the caller falls back to the old "sent a photo" behaviour.

const LIMITS = { audio: 25 * 1024 * 1024, image: 10 * 1024 * 1024, video: 18 * 1024 * 1024 };
const TIMEOUT_MS = 20000;
let workingVisionModel = '';

// What a describe call asks Gemini for: short, factual, useful for a shop assistant, never inventing.
const DESCRIBE_PROMPT = [
  'A customer sent this to a business in a chat. Describe it briefly for the shop assistant who must reply.',
  'Say what it shows: products, colours, sizes, quantities, brand names, any visible text or prices.',
  'If it is a payment receipt or bank transfer screenshot, give the amount, currency, date, time, sender and recipient exactly as shown.',
  'If it is a menu, price list or screenshot of a chat, give the key items.',
  'If you cannot see clearly, say so. Do not guess what is not visible. Answer in English, at most 80 words.'
].join(' ');

const withTimeout = (fetchImpl, url, options = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetchImpl(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
};

export function mediaKindFromMime(mime = '') {
  const value = String(mime).toLowerCase();
  if (value.startsWith('audio/')) return 'audio';
  if (value.startsWith('video/')) return 'video';
  if (value.startsWith('image/')) return 'image';
  return '';
}

// Downloads a media file (with an optional bearer token, as WhatsApp requires) within the size limit for its kind.
export async function downloadMedia({ url, token = '', kind = '', fetchImpl = fetch }) {
  if (!/^https:\/\//i.test(String(url || ''))) return null;
  const response = await withTimeout(fetchImpl, url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) return null;
  const mimeType = String(response.headers.get('content-type') || '').split(';')[0].trim();
  const realKind = kind || mediaKindFromMime(mimeType);
  const limit = LIMITS[realKind] || LIMITS.image;
  const length = Number(response.headers.get('content-length') || 0);
  if (length && length > limit) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > limit) return null;
  return { buffer, mimeType: mimeType || (realKind === 'audio' ? 'audio/mp4' : realKind === 'video' ? 'video/mp4' : 'image/jpeg'), kind: realKind || 'image' };
}

export async function transcribeAudio({ buffer, mimeType = 'audio/mp4', fetchImpl = fetch }) {
  const key = String(process.env.ELEVENLABS_API_KEY || '').trim();
  if (!key || !buffer?.length) return null;
  const form = new FormData();
  form.append('model_id', process.env.ELEVENLABS_STT_MODEL || 'scribe_v1');
  form.append('tag_audio_events', 'false');
  form.append('file', new Blob([buffer], { type: mimeType }), `voice.${mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mpeg') ? 'mp3' : 'm4a'}`);
  const response = await withTimeout(fetchImpl, 'https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: form });
  if (!response.ok) { console.warn('voice transcription failed', { status: response.status, body: (await response.text().catch(() => '')).slice(0, 300) }); return null; }
  const data = await response.json().catch(() => ({}));
  const text = String(data.text || '').trim();
  return text ? { text: text.slice(0, 8000), language: String(data.language_code || '') } : null;
}

export async function describeVisual({ buffer, mimeType = 'image/jpeg', caption = '', fetchImpl = fetch }) {
  const key = String(process.env.GOOGLE_API_KEY || '').trim();
  if (!key || !buffer?.length) return null;
  const prompt = caption ? `${DESCRIBE_PROMPT} The customer's caption: "${String(caption).slice(0, 500)}".` : DESCRIBE_PROMPT;
  const body = JSON.stringify({ contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mimeType, data: buffer.toString('base64') } }, { text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 300 } });
  // Model names change over time: try the configured one, then current Flash models, and remember what works.
  const candidates = [...new Set([workingVisionModel, process.env.GEMINI_MEDIA_MODEL, 'gemini-3.5-flash', 'gemini-3-flash', 'gemini-2.5-flash', 'gemini-flash-latest'].filter(Boolean))];
  let response = null;
  for (const model of candidates) {
    response = await withTimeout(fetchImpl, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body });
    if (response.status === 404) continue;
    if (response.ok) workingVisionModel = model;
    break;
  }
  if (!response?.ok) { console.warn('media description failed', { status: response?.status, body: response ? (await response.text().catch(() => '')).slice(0, 300) : 'no model available' }); return null; }
  const data = await response.json().catch(() => ({}));
  const text = (data.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join(' ').replace(/\s+/g, ' ').trim();
  return text ? { text: text.slice(0, 1500) } : null;
}

// One call for any media: returns { kind, transcript?, description? } or null.
export async function understandMedia({ url, token = '', kind = '', caption = '', fetchImpl = fetch }) {
  try {
    const file = await downloadMedia({ url, token, kind, fetchImpl });
    if (!file) return null;
    if (file.kind === 'audio') {
      const result = await transcribeAudio({ buffer: file.buffer, mimeType: file.mimeType, fetchImpl });
      return result ? { kind: 'audio', transcript: result.text } : null;
    }
    const result = await describeVisual({ buffer: file.buffer, mimeType: file.mimeType, caption, fetchImpl });
    return result ? { kind: file.kind, description: result.text } : null;
  } catch (error) {
    console.warn('media understanding failed', { message: error?.message });
    return null;
  }
}

// How the result is written into the conversation (inbox + AI memory) and what the AI is told.
export function mediaMessage({ source, media, caption = '' }) {
  const said = String(caption || '').trim();
  if (media?.kind === 'audio') return { content: `🎤 Voice message: ${media.transcript}`, aiText: media.transcript, note: 'The customer sent a voice message; its words are given as their message. Reply as if they had typed it.' };
  if (!media?.description) return null;
  const label = { story_reply: '💬 Replied to your story', story_mention: '📣 Mentioned you in their story', share: '↪️ Shared a post', video: '🎬 Video', image: '📷 Photo' }[source] || (media.kind === 'video' ? '🎬 Video' : '📷 Photo');
  const content = `${label} — ${media.description}${said ? `\n${said}` : ''}`;
  const what = { story_reply: `The customer replied to your story. The story shows: ${media.description}`, story_mention: `The customer mentioned you in their story, which shows: ${media.description}`, share: `The customer shared a post or reel with you. It shows: ${media.description}` }[source] || `The customer sent a ${media.kind === 'video' ? 'video' : 'photo'}. It shows: ${media.description}`;
  return { content, aiText: said || (source === 'share' ? 'What about this post?' : 'What about this?'), note: `${what} Use this to understand what they mean. Never claim to see details that are not in this description.` };
}
