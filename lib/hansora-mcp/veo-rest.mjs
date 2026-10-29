import { getRecentVeoRuns } from './data.mjs';

// While Google has an outage, every Veo video fails with "Internal Error" (yesterday about 11 in a row for
// almost an hour). Then Veo "rests": new ChatGPT Veo videos are made with Grok instead, with a notice, until
// 20 minutes after the last such failure, or until any Veo video succeeds again (the website keeps using
// Veo). Two Internal Errors in a row are needed, so one random failure never sends everyone to Grok.
export const VEO_REST_MS = 20 * 60 * 1000;
const CACHE_MS = 60 * 1000;
const OUTAGE = /internal error/i;

let cached = { at: 0, value: false };

export function veoRestingFromRuns(rows) {
  const finished = [];
  for (const row of [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))) {
    const status = String(row.status || '');
    if (row.result_url || /^(done|ready|completed|success|succeeded)$/i.test(status)) finished.push('ok');
    else if (/fail|error/i.test(status) && OUTAGE.test(String(row.error || ''))) finished.push('outage');
    if (finished.length === 2) break;
  }
  return finished.length === 2 && finished.every((kind) => kind === 'outage');
}

export async function veoResting(now = Date.now()) {
  if (now - cached.at < CACHE_MS) return cached.value;
  const rows = await getRecentVeoRuns(new Date(now - VEO_REST_MS).toISOString());
  cached = { at: now, value: veoRestingFromRuns(rows) };
  return cached.value;
}

export function resetVeoRestCache() {
  cached = { at: 0, value: false };
}
