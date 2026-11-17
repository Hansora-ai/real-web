import { z } from 'zod';
import crypto from 'node:crypto';

export const OPENAI_FILE_PARAMS = Object.freeze(['image_files', 'video_files', 'audio_files']);

export const openAIFileSchema = z.object({
  download_url: z.string().url(),
  file_id: z.string().min(1),
  mime_type: z.string().optional(),
  file_name: z.string().optional()
}).strict();

function attachmentUrls(files, kind, max) {
  if (!Array.isArray(files)) return [];
  return files.slice(0, max).map((file) => {
    const mime = String(file?.mime_type || '').trim().toLowerCase();
    if (mime && !mime.startsWith(`${kind}/`)) throw new Error(`${kind}_file_mime_type_invalid`);
    return String(file?.download_url || '').trim();
  });
}

function unique(values, max) {
  return [...new Set(values.filter(Boolean))].slice(0, max);
}

export function normalizeGenerationFiles(input) {
  return {
    ...input,
    image_urls: unique([
      ...(Array.isArray(input.image_urls) ? input.image_urls : []),
      ...attachmentUrls(input.image_files, 'image', 30)
    ], 30),
    video_urls: unique([
      ...(Array.isArray(input.video_urls) ? input.video_urls : []),
      ...attachmentUrls(input.video_files, 'video', 10)
    ], 10),
    audio_urls: unique([
      ...(Array.isArray(input.audio_urls) ? input.audio_urls : []),
      ...attachmentUrls(input.audio_files, 'audio', 5)
    ], 5)
  };
}

const ATTACHMENT_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/avif': 'avif', 'image/heic': 'heic', 'image/heif': 'heif', 'image/bmp': 'bmp',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/flac': 'flac'
});
const ATTACHMENT_MAX_BYTES = Object.freeze({ image: 30 * 1024 * 1024, video: 200 * 1024 * 1024, audio: 200 * 1024 * 1024 });

function attachmentMime(file, kind, responseType) {
  const candidates = [file?.mime_type, String(responseType || '').split(';')[0]]
    .map((value) => String(value || '').trim().toLowerCase());
  const declared = candidates.find((value) => value.startsWith(`${kind}/`) && ATTACHMENT_EXTENSIONS[value]);
  if (declared) return declared;
  const ext = (String(file?.file_name || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1];
  const byExt = Object.entries(ATTACHMENT_EXTENSIONS).find(([mime, value]) => mime.startsWith(`${kind}/`) && value === (ext === 'jpeg' ? 'jpg' : ext));
  return byExt ? byExt[0] : '';
}

const AVIF_BRANDS = new Set(['avif', 'avis']);
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);

export function sniffMime(body, kind) {
  const hex = body.subarray(0, 12).toString('hex');
  const ascii = body.subarray(0, 12).toString('latin1');
  const brand = ascii.slice(4, 8) === 'ftyp' ? ascii.slice(8, 12) : '';
  const found = hex.startsWith('ffd8ff') ? 'image/jpeg'
    : hex.startsWith('89504e47') ? 'image/png'
      : ascii.startsWith('GIF8') ? 'image/gif'
        : ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP' ? 'image/webp'
          : ascii.startsWith('BM') && kind === 'image' ? 'image/bmp'
            : AVIF_BRANDS.has(brand) ? 'image/avif'
              : HEIC_BRANDS.has(brand) ? 'image/heic'
                : brand ? (kind === 'audio' ? 'audio/mp4' : 'video/mp4')
                  : ascii.startsWith('ID3') ? 'audio/mpeg'
                    : '';
  return found.startsWith(`${kind}/`) ? found : '';
}

// Many providers (Kling through KIE among them) take only JPG or PNG photos, and ChatGPT sometimes labels a WebP,
// AVIF or iPhone HEIC photo as PNG or JPG. Every other image is converted here, on Hansora's own server: to PNG
// when it has transparency, otherwise to JPG. The libraries load only when such a photo arrives.
const PROVIDER_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);
export async function convertImageForProviders(body, mime) {
  if (mime === 'image/heic' || mime === 'image/heif') {
    const { default: heicConvert } = await import('heic-convert');
    const jpeg = await heicConvert({ buffer: body, format: 'JPEG', quality: 0.92 });
    return { body: Buffer.from(jpeg), mime: 'image/jpeg' };
  }
  const { default: sharp } = await import('sharp');
  // The first frame of an animated GIF or WebP; rotate() applies the photo's orientation tag.
  const image = sharp(body, { animated: false, failOn: 'none' }).rotate();
  const { hasAlpha } = await image.metadata();
  if (hasAlpha) return { body: await image.png().toBuffer(), mime: 'image/png' };
  return { body: await image.jpeg({ quality: 92 }).toBuffer(), mime: 'image/jpeg' };
}

// ChatGPT hands over attachments as short-lived storage links without a file extension, which KIE
// rejects ("image_input file type not supported"). Copy each one into Hansora's upload bucket, next
// to files from the upload card, so providers receive a stable link that ends in the real extension.
async function storeAttachment(file, kind, { fetchImpl, supabaseUrl, serviceKey, bucket, now }) {
  const source = String(file?.download_url || '').trim();
  const download = await fetchImpl(source, { signal: AbortSignal.timeout(30000) });
  if (!download.ok) throw new Error(`attachment_download_failed_${download.status}`);
  const body = Buffer.from(await download.arrayBuffer());
  if (body.length > ATTACHMENT_MAX_BYTES[kind]) throw new Error(`${kind}_file_too_large`);
  // For a photo, what the file really is comes first: ChatGPT's label can be wrong (a WebP sent as "image/png").
  // Videos and audio keep their label first (a .mov is a QuickTime file the bytes alone would call MP4).
  const declared = attachmentMime(file, kind, download.headers.get('content-type'));
  let mime = kind === 'image' ? (sniffMime(body, kind) || declared) : (declared || sniffMime(body, kind));
  if (!mime) throw new Error('attachment_type_unknown');
  let stored = body;
  if (kind === 'image' && !PROVIDER_IMAGE_TYPES.has(mime)) {
    const from = mime;
    try {
      ({ body: stored, mime } = await convertImageForProviders(body, mime));
      console.log('hansora_mcp_image_converted', JSON.stringify({ from, to: mime, bytes: body.length, converted_bytes: stored.length }));
    } catch (error) {
      // Kept as it is: the provider may still read it, and a failed run is refunded.
      console.warn('hansora_mcp_image_convert_failed', JSON.stringify({ from, message: error?.message }));
    }
  }
  const date = now();
  const day = `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`;
  const objectPath = `images/user-uploads/${day}/${crypto.randomBytes(8).toString('hex')}-chatgpt.${ATTACHMENT_EXTENSIONS[mime]}`;
  const upload = await fetchImpl(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath}`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': mime, 'x-upsert': 'true' },
    body: stored,
    signal: AbortSignal.timeout(60000)
  });
  if (!upload.ok) throw new Error(`attachment_store_failed_${upload.status}`);
  return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectPath}`;
}

export async function storeGenerationFiles(input, options = {}) {
  const settings = {
    fetchImpl: options.fetchImpl || fetch,
    supabaseUrl: String(options.supabaseUrl ?? process.env.SUPABASE_URL ?? '').replace(/\/+$/, ''),
    serviceKey: options.serviceKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? '',
    bucket: options.bucket ?? process.env.SUPABASE_BUCKET ?? '',
    now: options.now || (() => new Date())
  };
  const fields = [['image_files', 'image', 30], ['video_files', 'video', 10], ['audio_files', 'audio', 5]];
  const hasFiles = fields.some(([field]) => Array.isArray(input[field]) && input[field].length);
  if (!hasFiles || !settings.supabaseUrl || !settings.serviceKey || !settings.bucket) return normalizeGenerationFiles(input);

  const stored = { ...input };
  for (const [field, kind, max] of fields) {
    if (!Array.isArray(input[field]) || !input[field].length) continue;
    attachmentUrls(input[field], kind, max);
    stored[field] = await Promise.all(input[field].slice(0, max).map(async (file) => {
      try {
        return { ...file, download_url: await storeAttachment(file, kind, settings) };
      } catch (error) {
        if (/mime_type_invalid|too_large/.test(String(error?.message))) throw error;
        // Fall back to the original link; providers that can read it still work.
        console.warn('hansora_mcp_attachment_store_failed', JSON.stringify({ kind, message: error?.message }));
        return file;
      }
    }));
  }
  return normalizeGenerationFiles(stored);
}
