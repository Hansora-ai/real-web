'use strict';
// Checks finished results before they are saved or shown (Google Play Sexual Content and AI-Generated
// Content policies, Nov 2026). The prompt filter (netlify/functions/safe-run.cjs) runs first; this
// catches what it cannot see: a harmless prompt that still produced a sexual or suggestive image.
// OpenAI's omni-moderation is free and works the same for every image model.
const MODERATION_URL = 'https://api.openai.com/v1/moderations';
// 0.5 let an AI-exaggerated cleavage/high-slit "red dress" result through (Nov 2026); results are what
// store reviewers judge, so they are held to the stricter photo threshold.
const RESULT_SEXUAL_THRESHOLD = 0.3;
const BLOCKED_MESSAGE = 'This result was blocked because sexual or sexually suggestive content is not allowed. Your credits were refunded.';

function looksLikeImage(url, kind) {
  const value = String(url || '');
  if (/\.(?:mp4|mov|webm|m4v|mp3|wav|m4a|ogg)(?:\?|$)/i.test(value)) return false;
  return /\.(?:png|jpe?g|webp|gif|avif)(?:\?|$)/i.test(value) || String(kind || '').toLowerCase() === 'image';
}

async function imageCategory(url, fetchImpl, scores) {
  const key = process.env.OPENAI_API_KEY || '';
  if (!key) return null;
  try {
    const response = await fetchImpl(MODERATION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: [{ type: 'image_url', image_url: { url } }] }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return null;
    const result = (await response.json())?.results?.[0];
    if (!result?.categories) return null;
    const score = Number(result?.category_scores?.sexual);
    if (Number.isFinite(score)) scores.push(Math.round(score * 1000) / 1000);
    if (result.categories['sexual/minors']) return 'sexual_content_involving_minors';
    if (Number.isFinite(score)) return score >= RESULT_SEXUAL_THRESHOLD ? 'nsfw_sexual_content' : '';
    return result.categories.sexual ? 'nsfw_sexual_content' : '';
  } catch {
    return null;
  }
}

// Returns { blocked, category, checked } for the first up to 4 image results. Videos and audio are not
// checked here (their prompt and input photos are checked before generation). If moderation is not
// reachable the result is allowed and logged, so generations never hang on it.
async function checkResults(urls, kind, fetchImpl = fetch) {
  const images = (Array.isArray(urls) ? urls : []).filter((url) => looksLikeImage(url, kind)).slice(0, 4);
  if (!images.length) return { blocked: false, category: '', checked: 0 };
  const scores = [];
  const categories = await Promise.all(images.map((url) => imageCategory(url, fetchImpl, scores)));
  const category = categories.find(Boolean) || '';
  const unavailable = categories.filter((value) => value === null).length;
  console.info('result_safety_decision', JSON.stringify({ blocked: Boolean(category), category, checked: images.length, unavailable, scores }));
  return { blocked: Boolean(category), category, checked: images.length, scores };
}

module.exports = { checkResults, looksLikeImage, BLOCKED_MESSAGE, RESULT_SEXUAL_THRESHOLD };
