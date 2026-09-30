import { z } from 'zod';

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
