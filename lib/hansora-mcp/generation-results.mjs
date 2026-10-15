import suno from './suno-results.cjs';

// Read-only recovery: older callbacks saved final tracks without updating status.
export function normalizeGenerationResult(generation) {
  if (!generation) return generation;
  const meta = generation.meta || {};
  const kind = String(meta.audio_kind || meta.kind || '').toLowerCase();
  if (kind !== 'music' || generation.result_url || meta.failed || meta.refunded ||
      /fail|error|refund|cancel/i.test(String(meta.status || '')) ||
      suno.normalizeSunoStatus(meta.callback) !== 'success') return generation;
  const urls = suno.extractSunoFinalAudioUrls(meta.callback, meta).filter((url) => url.startsWith('https://'));
  if (!urls.length) return generation;
  return {
    ...generation,
    status: 'ready',
    result_url: urls[0],
    result_urls: urls,
    meta: { ...meta, status: 'ready', audio_url: urls[0], audio_urls: urls, suno_complete: true }
  };
}
