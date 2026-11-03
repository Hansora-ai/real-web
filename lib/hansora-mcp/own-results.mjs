// ChatGPT copies Hansora result links into the next step (a picture, then the video made from it). The links
// are long, and ChatGPT sometimes changes or drops a few characters, so the provider cannot download the file
// and the video fails. A link into Hansora's storage is therefore never sent as typed: it is replaced by the
// matching file the user's own generations saved. Links elsewhere (the user's uploads, other sites) are left as
// they are.

const URL_FIELDS = ['first_frame_url', 'last_frame_url', 'source_video_url'];
const LIST_FIELDS = ['image_urls', 'video_urls', 'audio_urls'];
const STORAGE = /\/storage\/v1\/object\/public\/generation-history\//;

export function isHansoraResultLink(url) {
  return typeof url === 'string' && STORAGE.test(url);
}

function distance(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

// The saved file the link means: the same link, or the one clearly closest to it (a few characters changed or
// missing, and no other saved file nearly as close). Null when none fits.
export function matchSavedFile(url, saved) {
  if (saved.includes(url)) return url;
  const path = (u) => u.split('/storage/v1/object/public/')[1] || u;
  const typed = path(url);
  const ranked = saved
    .map((candidate) => ({ candidate, d: distance(typed, path(candidate)) }))
    .sort((a, b) => a.d - b.d);
  const [best, second] = ranked;
  if (!best) return null;
  const limit = Math.max(4, Math.round(typed.length * 0.1));
  if (best.d > limit) return null;
  if (second && second.d - best.d < 3) return null;
  return best.candidate;
}

// { input, fixed: [{from, to}], missing: [url] } — input with every Hansora link replaced by the saved file.
export async function useSavedFiles(input, loadSaved) {
  const links = [
    ...URL_FIELDS.map((field) => input[field]),
    ...LIST_FIELDS.flatMap((field) => (Array.isArray(input[field]) ? input[field] : []))
  ].filter(isHansoraResultLink);
  if (!links.length) return { input, fixed: [], missing: [] };
  const saved = await loadSaved();
  const fixed = [], missing = [];
  const resolve = (url) => {
    if (!isHansoraResultLink(url)) return url;
    const match = matchSavedFile(url, saved);
    if (!match) { missing.push(url); return url; }
    if (match !== url) fixed.push({ from: url, to: match });
    return match;
  };
  const next = { ...input };
  for (const field of URL_FIELDS) if (next[field]) next[field] = resolve(next[field]);
  for (const field of LIST_FIELDS) if (Array.isArray(next[field])) next[field] = next[field].map(resolve);
  return { input: next, fixed, missing };
}
