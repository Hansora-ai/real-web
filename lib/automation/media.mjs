// Media understanding for chats: what a customer sends that is not text becomes text the AI can answer and the
// owner can read in the inbox. Voice → ElevenLabs speech-to-text. Photos, videos, shared posts/reels and stories →
// Gemini describes them. Any failure returns null, and the caller falls back to the old "sent a photo" behaviour.

const LIMITS = { audio: 25 * 1024 * 1024, image: 10 * 1024 * 1024, video: 60 * 1024 * 1024 };
// Up to this size a file is sent inside the Gemini request; larger videos (long reels) go through Gemini's file upload.
export const INLINE_MAX_BYTES = 18 * 1024 * 1024;
const TIMEOUT_MS = 20000;
let workingVisionModel = '';

// What a describe call asks Gemini for: short, factual, useful for a shop assistant, never inventing.
const DESCRIBE_PROMPT = [
  'A customer sent this to a business in a chat. Describe it for the shop assistant who must reply, so they can answer without seeing it.',
  'Say what it shows: products, colours, sizes, quantities, brand names.',
  'Copy every visible number, price, amount, plan or package name, quantity and important text exactly as written (translate it to English in brackets if it is in another language). If it is a screenshot of a pricing or product page, list each plan or item that is visible with its exact price and amounts, and say which one is highlighted or selected.',
  'If it is a payment receipt or bank transfer screenshot, give the amount, currency, date, time, sender and recipient exactly as shown.',
  'If it is a menu, price list or screenshot of a chat, list the items with their prices.',
  'If you cannot see clearly, say so. Do not guess what is not visible. Answer in English, at most 180 words.'
].join(' ');

// Videos take Gemini much longer than photos (it watches the frames and listens to the sound): a 20-second limit cut
// every video off, so the AI said it could not see them. Downloads and video calls get a longer limit.
export const VIDEO_TIMEOUT_MS = 120000;
const withTimeout = (fetchImpl, url, options = {}, timeoutMs = TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetchImpl(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
};

const MIME_BY_EXTENSION = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', oga: 'audio/ogg', ogg: 'audio/ogg', opus: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
export function mimeFromName(url = '') {
  const name = String(url).split(/[?#]/)[0];
  return MIME_BY_EXTENSION[(name.match(/\.([a-z0-9]{2,5})$/i)?.[1] || '').toLowerCase()] || '';
}

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
  const response = await withTimeout(fetchImpl, url, { headers: token ? { Authorization: `Bearer ${token}` } : {} }, kind === 'image' ? TIMEOUT_MS : 60000);
  if (!response.ok) return null;
  // Some services (Telegram) send files as application/octet-stream: the type then comes from the file name.
  let mimeType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!mimeType || mimeType === 'application/octet-stream') mimeType = mimeFromName(url) || mimeType;
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
  return text ? { text: text.slice(0, 8000), language: String(data.language_code || '').toLowerCase() } : null;
}

export async function describeVisual({ buffer, mimeType = 'image/jpeg', caption = '', context = '', fetchImpl = fetch }) {
  const key = String(process.env.GOOGLE_API_KEY || '').trim();
  if (!key || !buffer?.length) return null;
  // The business and the recent chat let Gemini say what the picture means here, not only what it shows.
  const prompt = [
    DESCRIBE_PROMPT,
    context ? `Context (the business and the latest messages of this chat):\n${String(context).slice(-4000)}` : '',
    caption ? `The customer's caption: "${String(caption).slice(0, 500)}".` : '',
    context ? 'Then add one line starting with "Relevance:" saying how it relates to this business and conversation: which listed product, service or price it matches or resembles, what the customer most likely wants, or that it seems unrelated.' : ''
  ].filter(Boolean).join('\n\n');
  const uploaded = buffer.length > INLINE_MAX_BYTES ? await uploadGeminiFile({ key, buffer, mimeType, fetchImpl }) : null;
  if (buffer.length > INLINE_MAX_BYTES && !uploaded) return null;
  const filePart = uploaded ? { file_data: { mime_type: mimeType, file_uri: uploaded.uri } } : { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } };
  const result = await geminiGenerate({ key, parts: [filePart, { text: prompt }], fetchImpl, label: String(mimeType).startsWith('video/') ? 'video description' : 'media description', timeoutMs: String(mimeType).startsWith('video/') ? VIDEO_TIMEOUT_MS : TIMEOUT_MS });
  if (uploaded) withTimeout(fetchImpl, `https://generativelanguage.googleapis.com/v1beta/${uploaded.name}`, { method: 'DELETE', headers: { 'x-goog-api-key': key } }).catch(() => null);
  return result?.text ? { text: result.text.slice(0, 2500) } : null;
}

// Gemini file upload (for videos too large to send inline): upload, then wait until Gemini has processed it.
export async function uploadGeminiFile({ key, buffer, mimeType, fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), maxWaitMs = 45000 }) {
  try {
    const start = await withTimeout(fetchImpl, 'https://generativelanguage.googleapis.com/upload/v1beta/files', { method: 'POST', headers: { 'x-goog-api-key': key, 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(buffer.length), 'X-Goog-Upload-Header-Content-Type': mimeType, 'Content-Type': 'application/json' }, body: JSON.stringify({ file: { display_name: 'customer-media' } }) });
    const uploadUrl = start.ok ? start.headers.get('x-goog-upload-url') : '';
    if (!uploadUrl) { console.warn('gemini file upload not started', { status: start.status }); return null; }
    const done = await fetchImpl(uploadUrl, { method: 'POST', headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize', 'Content-Length': String(buffer.length) }, body: buffer });
    let file = (await done.json().catch(() => ({}))).file;
    if (!done.ok || !file?.name) { console.warn('gemini file upload failed', { status: done.status }); return null; }
    const started = Date.now();
    while (file.state === 'PROCESSING' && Date.now() - started < maxWaitMs) {
      await sleep(2000);
      const check = await withTimeout(fetchImpl, `https://generativelanguage.googleapis.com/v1beta/${file.name}`, { headers: { 'x-goog-api-key': key } });
      file = check.ok ? await check.json().catch(() => file) : file;
    }
    if (file.state && file.state !== 'ACTIVE') { console.warn('gemini file not ready', { state: file.state }); return null; }
    return { name: file.name, uri: file.uri };
  } catch (error) { console.warn('gemini file upload failed', { message: error?.message }); return null; }
}

// One Gemini call with images and text. Newer Gemini models think before answering and that thinking counts against
// the output limit (it cut descriptions to one sentence), so thinking is kept minimal and the limit generous.
// Model names change over time: the configured one is tried, then current Flash models, and what works is kept.
// The last Gemini error (status and message), shown to the owner when a photo or video could not be read.
let lastGeminiFailure = '';
export async function geminiGenerate({ key = String(process.env.GOOGLE_API_KEY || '').trim(), parts, json = false, fetchImpl = fetch, label = 'gemini', timeoutMs = TIMEOUT_MS }) {
  if (!key) { lastGeminiFailure = 'GOOGLE_API_KEY is not set'; return null; }
  lastGeminiFailure = '';
  const contents = [{ role: 'user', parts }];
  const bodyFor = (model, withThinking = true) => JSON.stringify({ contents, generationConfig: { temperature: 0.2, maxOutputTokens: 2048, ...(json ? { responseMimeType: 'application/json' } : {}), ...(withThinking ? { thinkingConfig: /^gemini-2\.5/.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: 'low' } } : {}) } });
  const candidates = [...new Set([workingVisionModel, process.env.GEMINI_MEDIA_MODEL, 'gemini-3.5-flash', 'gemini-3-flash', 'gemini-2.5-flash', 'gemini-flash-latest'].filter(Boolean))];
  let response = null;
  for (const model of candidates) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const send = withThinking => withTimeout(fetchImpl, url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: bodyFor(model, withThinking) }, timeoutMs);
    response = await send(true);
    // A model that does not accept the thinking setting is asked again without it.
    if (response.status === 400) response = await send(false);
    if (response.status === 404) continue;
    if (response.ok) workingVisionModel = model;
    break;
  }
  if (!response?.ok) { const body = response ? (await response.text().catch(() => '')).slice(0, 300) : 'no model available'; lastGeminiFailure = `${response?.status || ''} ${body}`.trim().slice(0, 200); console.warn(`${label} failed`, { status: response?.status, body }); return null; }
  const data = await response.json().catch(() => ({}));
  const candidate = data.candidates?.[0] || {};
  if (candidate.finishReason === 'MAX_TOKENS') console.warn(`${label} was cut off`, { usage: data.usageMetadata });
  const text = (candidate.content?.parts || []).filter(part => !part.thought).map(part => part.text || '').join(' ').replace(/\s+/g, ' ').trim();
  return text ? { text } : null;
}

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/aac': 'aac' };
export const MEDIA_BUCKET = 'automation-media';
// ElevenLabs returns ISO 639-3 codes.
const LANGUAGE_BY_CODE = { eng: 'English', hye: 'Armenian', rus: 'Russian', spa: 'Spanish', fra: 'French', deu: 'German', ita: 'Italian', por: 'Portuguese', ukr: 'Ukrainian', pol: 'Polish', nld: 'Dutch', tur: 'Turkish', ara: 'Arabic', fas: 'Persian', hin: 'Hindi', zho: 'Chinese', cmn: 'Chinese', jpn: 'Japanese', kor: 'Korean', kat: 'Georgian', aze: 'Azerbaijani', kaz: 'Kazakh', heb: 'Hebrew', ell: 'Greek' };

// Keeps a private copy so the owner sees the photo / hears the voice note in the inbox (Instagram and WhatsApp
// links expire). Path: <business>/<channel>/<conversation>/<message key>.<ext>. Returns the path or ''.
export async function storeMedia({ buffer, mimeType, businessId, channel, conversationId, key, fetchImpl = fetch }) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
  if (!base || !service || !buffer?.length || !/^[0-9a-f-]{36}$/i.test(String(businessId)) || !/^[0-9a-f-]{36}$/i.test(String(conversationId))) return '';
  const safeKey = String(key || Date.now()).replace(/[^A-Za-z0-9_-]/g, '').slice(-80) || String(Date.now());
  const path = `${businessId}/${String(channel).replace(/[^a-z_]/g, '')}/${conversationId}/${safeKey}.${EXTENSIONS[mimeType] || 'bin'}`;
  try {
    const response = await withTimeout(fetchImpl, `${base}/storage/v1/object/${MEDIA_BUCKET}/${path}`, { method: 'POST', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': mimeType || 'application/octet-stream', 'x-upsert': 'true' }, body: buffer });
    if (!response.ok) { console.warn('media copy not stored', { status: response.status, body: (await response.text().catch(() => '')).slice(0, 200) }); return ''; }
    return path;
  } catch (error) { console.warn('media copy not stored', { message: error?.message }); return ''; }
}

// One call for any media: returns { kind, transcript?, language?, description?, mediaPath, mimeType } or null.
export async function understandMedia({ url, token = '', kind = '', caption = '', context = '', store = null, afterVisual = null, fetchImpl = fetch, report = null }) {
  try {
    const file = await downloadMedia({ url, token, kind, fetchImpl });
    if (!file) { report?.('the file could not be downloaded (link expired, or larger than 60 MB)'); return null; }
    const storedP = store ? storeMedia({ buffer: file.buffer, mimeType: file.mimeType, ...store, fetchImpl }) : Promise.resolve('');
    if (file.kind === 'audio') {
      const [result, mediaPath] = await Promise.all([transcribeAudio({ buffer: file.buffer, mimeType: file.mimeType, fetchImpl }), storedP]);
      if (!result) report?.('the voice message could not be transcribed');
      return result ? { kind: 'audio', transcript: result.text, language: result.language, mediaPath, mimeType: file.mimeType } : null;
    }
    const [result, mediaPath] = await Promise.all([describeVisual({ buffer: file.buffer, mimeType: file.mimeType, caption, context, fetchImpl }), storedP]);
    if (!result) { report?.(`Gemini could not read the ${file.kind} (${file.mimeType}, ${Math.round(file.buffer.length / 1024)} KB): ${lastGeminiFailure || 'no answer'}`); return null; }
    // Photos and videos (shared posts, reels, stories) are also compared with the catalog's product photos
    // (exact product and variant), when there is one.
    const match = ['image', 'video'].includes(file.kind) && afterVisual ? await afterVisual({ buffer: file.buffer, mimeType: file.mimeType, description: result.text }).catch(() => '') : '';
    return { kind: file.kind, description: match ? `${result.text}\n${match}` : result.text, mediaPath, mimeType: file.mimeType };
  } catch (error) {
    console.warn('media understanding failed', { message: error?.message });
    report?.(`error: ${String(error?.message || 'unknown').slice(0, 160)}`);
    return null;
  }
}

// When a shared post, reel, story or video could not be opened: the AI is told so plainly (with the caption Instagram
// gave, if any), so it answers honestly instead of staying silent or guessing.
export function mediaFallback({ source = '', kind = '', title = '', caption = '' }) {
  const said = String(caption || '').trim();
  const what = { share: 'shared a post or reel', story_reply: 'replied to your story', story_mention: 'mentioned you in their story' }[source] || `sent a ${kind === 'video' ? 'video' : kind === 'audio' ? 'voice message' : 'photo'}`;
  const label = { share: '↪️ Shared a post or reel', story_reply: '💬 Replied to your story', story_mention: '📣 Mentioned you in their story' }[source] || (kind === 'video' ? '🎬 Video' : kind === 'audio' ? '🎤 Voice message' : '📷 Photo');
  const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
  return {
    content: `${label}${cleanTitle ? ` — caption: ${cleanTitle}` : ''}${said ? `\n${said}` : ''}`,
    aiText: said || (source === 'share' ? 'What about this post?' : 'What about this?'),
    note: `The customer ${what}, but it could not be opened, so you cannot see it.${cleanTitle ? ` Its caption says: "${cleanTitle}".` : ''} Never say you see, saw or watched it. Say briefly that you cannot open the video itself, then use its caption and the chat to help (for example: "I can't open the video, but from its description it is about …"). If it is still unclear, ask which product they mean or for a screenshot.`
  };
}

// How the result is written into the conversation (inbox + AI memory) and what the AI is told.
export function mediaMessage({ source, media, caption = '' }) {
  const said = String(caption || '').trim();
  if (media?.kind === 'audio') {
    const spoken = LANGUAGE_BY_CODE[String(media.language || '').slice(0, 3)];
    return { content: `🎤 Voice message: ${media.transcript}`, aiText: media.transcript, note: `The customer sent a voice message; its words are given as their message. Reply as if they had typed it.${spoken ? ` They spoke ${spoken}: treat this message as written in ${spoken} when choosing the reply language.` : ''}` };
  }
  if (!media?.description) return null;
  const label = { story_reply: '💬 Replied to your story', story_mention: '📣 Mentioned you in their story', share: '↪️ Shared a post', video: '🎬 Video', image: '📷 Photo' }[source] || (media.kind === 'video' ? '🎬 Video' : '📷 Photo');
  const content = `${label} — ${media.description}${said ? `\n${said}` : ''}`;
  const what = { story_reply: `The customer replied to your story. The story shows: ${media.description}`, story_mention: `The customer mentioned you in their story, which shows: ${media.description}`, share: `The customer shared a post or reel with you. It shows: ${media.description}` }[source] || `The customer sent a ${media.kind === 'video' ? 'video' : 'photo'}. It shows: ${media.description}`;
  return { content, aiText: said || (source === 'share' ? 'What about this post?' : 'What about this?'), note: `${what} Use this to understand what they mean. Never claim to see details that are not in this description.` };
}
