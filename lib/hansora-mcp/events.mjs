// One small row per ChatGPT tool call, so we can see where users stop before a generation
// (prices looked up, balance too low, nothing called at all). No media is stored, and prompts only
// for requests the content filter blocked.
// Logging must never affect the user: every write is capped in time, errors are ignored, and a
// missing table turns logging off until the next cold start.

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
const WRITE_TIMEOUT_MS = 1500;
// The card checks its generation every few seconds; logging those would only add load.
const SKIPPED_TOOLS = new Set(['get_generation']);

let disabled = process.env.HANSORA_MCP_EVENTS === 'off';

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function outcomeOf(result) {
  const value = result?.structuredContent || {};
  // Not a refusal: the server sent a new user's first video to a model their free credits cover.
  if (value.error === 'insufficient_credits' && value.first_generation) return 'switched_to_affordable';
  if (value.error) return String(value.error).slice(0, 60);
  if (value.status === 'temporarily_unavailable') return 'temporarily_unavailable';
  if (result?.isError) return 'error';
  return 'ok';
}

export function eventRow(userId, tool, input = {}, result = {}) {
  const value = result?.structuredContent || {};
  const isBalance = tool === 'get_account';
  return {
    user_id: userId || null,
    tool,
    model_id: String(input.model_id || input.audio_tool_id || value.model_id || '').slice(0, 60) || null,
    outcome: outcomeOf(result),
    credits: isBalance ? null : numberOrNull(value.credits_required ?? value.credits ?? value.displayedCredits),
    balance: numberOrNull(isBalance ? value.credits : value.credits_available),
    run_id: value.run_id ? String(value.run_id).slice(0, 160) : null,
    details: {
      ...(input.category ? { category: input.category } : {}),
      ...(input.duration != null ? { duration: input.duration } : {}),
      ...(input.resolution || input.quality ? { resolution: input.resolution || input.quality } : {}),
      ...(Array.isArray(value.options_within_balance) ? { options: value.options_within_balance.map((option) => option.model_id).slice(0, 4) } : {}),
      ...(value.first_generation ? { first_generation: true } : {}),
      ...(value.aspect_ratio && tool === 'create_generation' ? { aspect_ratio: value.aspect_ratio } : {}),
      ...(value.photo_shape ? { photo_shape: value.photo_shape } : {}),
      ...(value.next_option ? { next_option: value.next_option.model_id } : {}),
      // Blocked requests keep their prompt so false blocks can be found and fixed.
      ...(value.error === 'content_blocked' ? {
        category: value.category || null,
        blocked_by: value.blocked_by || null,
        prompt: String(input.prompt || '').slice(0, 3000)
      } : {}),
      ...(value.reason ? { reason: String(value.reason).slice(0, 200) } : {}),
      // Plain-text errors (no structured result) are what ChatGPT reports as "internal error".
      ...(result?.isError && !value.error && result?.content?.[0]?.text ? { reason: String(result.content[0].text).slice(0, 200) } : {})
    }
  };
}

export function recordToolEvent(userId, tool, input, result, waitUntil) {
  if (disabled || SKIPPED_TOOLS.has(tool) || !SUPABASE_URL || !SERVICE_KEY || !userId) return;
  let row;
  try { row = eventRow(userId, tool, input, result); } catch { return; }
  const write = fetch(`${SUPABASE_URL}/rest/v1/chatgpt_events`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(WRITE_TIMEOUT_MS)
  }).then((response) => {
    if (response.status === 404) disabled = true; // table not created yet
  }).catch(() => {});
  try { waitUntil?.(write); } catch { /* best effort */ }
  return write;
}
