import { getRecentRuns } from './data.mjs';
import { classifyFailure, modelIdOf } from './failures.mjs';

// A model is set aside when it failed with temporary errors (KIE 500s, internal errors, Kling
// "playground" errors) at least FAILURES times in the last WINDOW_MS with no success since. It comes
// back on its own: one success from anyone (the website keeps using it) or COOLDOWN_MS after its last
// failure, when the next run tries it again.
const WINDOW_MS = 15 * 60 * 1000;
const COOLDOWN_MS = 10 * 60 * 1000;
const FAILURES = 3;
const CACHE_MS = 60 * 1000;

let cached = { at: 0, value: new Set() };

function rowMeta(row) {
  if (row?.meta && typeof row.meta === 'object') return row.meta;
  const { provider: _provider, created_at: _created, result_url: _result, ...meta } = row || {};
  return meta;
}

export function unavailableFromRuns(rows, now = Date.now()) {
  const byModel = new Map();
  const sorted = [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  for (const row of sorted) {
    const at = Date.parse(row.created_at);
    if (!Number.isFinite(at) || now - at > WINDOW_MS) continue;
    const meta = rowMeta(row);
    const id = modelIdOf({ provider: row.provider, meta });
    if (!id) continue;
    const state = byModel.get(id) || { done: false, failures: 0, lastFailure: 0 };
    byModel.set(id, state);
    if (state.done) continue;
    const status = String(meta.status || '');
    if (row.result_url || /^(done|ready|completed|success|succeeded)$/i.test(status)) { state.done = true; continue; }
    if (!/(fail|error)/i.test(status) || classifyFailure(meta) !== 'temporary') continue;
    state.failures += 1;
    state.lastFailure = Math.max(state.lastFailure, at);
  }
  const unavailable = new Set();
  for (const [id, state] of byModel) {
    if (state.failures >= FAILURES && now - state.lastFailure < COOLDOWN_MS) unavailable.add(id);
  }
  return unavailable;
}

export async function unavailableModels() {
  if (Date.now() - cached.at < CACHE_MS) return cached.value;
  try {
    const rows = await getRecentRuns(new Date(Date.now() - WINDOW_MS).toISOString());
    cached = { at: Date.now(), value: unavailableFromRuns(rows) };
  } catch {
    cached = { at: Date.now(), value: new Set() };
  }
  return cached.value;
}

export function resetHealthCache() {
  cached = { at: 0, value: new Set() };
}
