// Decides who gets which lifecycle email in one run. Pure: takes what lifecycle_facts() returned, gives back the
// sends and the skips. Based on the rules the Grok Bot "Lifecycle" agent followed, plus Hansora's 2026-11-04 rule:
//
// Priority: 1. abandoned checkout (A/C)  2. prices (B)  3. credits-used  4. welcome; one email per person per run.
// Signup emails (credits-used, welcome): ONE per person (settings.max_emails_per_person, default 1), and none for
// anyone who already got any lifecycle email. Nudges (abandoned, prices) still go to people who got a signup email,
// within the bot's limits: one of each per 3 days, at most 2 nudges per person (2026-11-10: the prices email is the
// one that sells, and 58 pricing clickers had been skipped). Signups wait
// settings.signup_wait_minutes (default 60) first, so someone who generates soon after signing up gets
// credits-used instead of welcome.
//
// Tier 1 (nudges):
//   A  failed/abandoned checkout (buy_click_events)            -> abandoned email
//   C  course practice offer "buy_clicked" click, 20+ min old  -> abandoned email (same copy as A)
//   B  Pricing / Buy click, 20+ min old                         -> prices email
//   - at most one abandoned and one prices email per address per 3 days
//   - A/C are decided first; B is dropped for anyone getting A/C now or who got abandoned in the last 3 days
//   - lifetime cap: 2 nudges (abandoned + prices). After that only a NEW checkout (after their latest nudge)
//     reopens one abandoned email. Prices never goes past the cap.
//   - nobody who paid after the click/checkout
// Tier 2 credits-used: unpaid signups from the last 48 h with at least one charged generation, who never got a
//   prices or abandoned email (English only, highest spend first, once per person).
// Tier 3 welcome: the same signups with no generations and no lifecycle email at all (English only, once).

export const DAY = 86400000;
export const DEDUPE_MS = 3 * DAY;
export const LIFETIME_NUDGES = 2;
export const MAX_ELIGIBLE = 300;
export const DEFAULT_MAX_EMAILS = 1;
export const DEFAULT_SIGNUP_WAIT_MINUTES = 60;

export const INTERNAL_EMAILS = ['hansora.ai.bot@gmail.com', 'hansoraai.co@gmail.com'];
export const INTERNAL_DOMAINS = ['hansora.co'];
// Throwaway-mail domains seen so far. More can be added with the LIFECYCLE_SKIP_DOMAINS setting (comma separated).
export const TEMP_DOMAINS = ['gtempaccount.com', 'animecruise.net'];

const NUDGES = new Set(['abandoned', 'prices']);
const time = (value) => { const t = Date.parse(value || ''); return Number.isFinite(t) ? t : 0; };
const clean = (email) => String(email || '').trim().toLowerCase();

// HY / RU / EN from page paths, the clicked text and the profile language.
export function languageOf(texts = [], profileLanguage = '') {
  const joined = texts.filter(Boolean).map(String).join(' ');
  if (/(_arm\b|_arm\.|_arm\/|course_arm|pricing_arm)/i.test(joined) || /[Ա-֏]/.test(joined)) return 'hy';
  if (/(_ru\b|_ru\.|_ru\/|course_ru|pricing_ru)/i.test(joined) || /[Ѐ-ӿ]/.test(joined)) return 'ru';
  const profile = String(profileLanguage || '').toLowerCase();
  if (profile === 'arm' || profile === 'hy') return 'hy';
  if (profile === 'ru') return 'ru';
  return 'en';
}

// Model shown in the credits-used email. null = audio only (no email for those yet); undefined = unknown model.
export function modelName(raw) {
  const m = String(raw || '').toLowerCase();
  if (m.includes('grok')) return 'Grok Imagine';
  if (m.includes('nano-banana') || m.includes('nano_banana') || m.includes('nanobanana')) return 'Nano Banana 2';
  if (m.includes('gpt-image') || m.includes('gpt_image')) return 'GPT Image';
  if (m.includes('kling')) return 'Kling';
  if (m.includes('veo3') || m.includes('veo-3') || m.includes('veo31')) return 'Veo 3.1 Lite';
  if (m.includes('wan')) return 'Wan 3.0';
  if (m.includes('suno')) return null;
  return undefined;
}

export function blockedReason(email, { unsubscribed = new Set(), skipDomains = [] } = {}) {
  const value = clean(email);
  if (!value || !value.includes('@')) return 'no email';
  const domain = value.split('@').pop();
  if (INTERNAL_EMAILS.includes(value) || INTERNAL_DOMAINS.includes(domain)) return 'internal account';
  if ([...TEMP_DOMAINS, ...skipDomains].includes(domain)) return 'temporary email';
  if (unsubscribed.has(value)) return 'unsubscribed';
  return '';
}

export function planRun(facts, { now = Date.now(), skipDomains = [] } = {}) {
  const settings = facts.settings || {};
  const maxEmails = Math.max(1, Number(settings.max_emails_per_person) || DEFAULT_MAX_EMAILS);
  const waitMs = Math.max(0, Number(settings.signup_wait_minutes ?? DEFAULT_SIGNUP_WAIT_MINUTES)) * 60000;
  const unsubscribed = new Set((facts.unsubscribed || []).map(clean));
  const blockOptions = { unsubscribed, skipDomains: skipDomains.map(clean).filter(Boolean) };

  // Everything already sent, by address and by user id.
  const byEmail = new Map(), byUser = new Map();
  for (const row of facts.history || []) {
    const entry = { campaign: row.campaign, at: time(row.sent_at) };
    const email = clean(row.email);
    if (email) { if (!byEmail.has(email)) byEmail.set(email, []); byEmail.get(email).push(entry); }
    if (row.user_id) { if (!byUser.has(row.user_id)) byUser.set(row.user_id, []); byUser.get(row.user_id).push(entry); }
  }
  const sentTo = (email, userId) => {
    const seen = new Set(), out = [];
    for (const h of [...(byEmail.get(clean(email)) || []), ...(userId ? byUser.get(userId) || [] : [])]) {
      const key = `${h.campaign}|${h.at}`;
      if (!seen.has(key)) { seen.add(key); out.push(h); }
    }
    return out;
  };

  const sends = [], skips = [];
  const plannedEmails = new Set(), plannedUsers = new Set();
  const isPlanned = (email, userId) => plannedEmails.has(email) || (userId && plannedUsers.has(userId));
  const plan = (send) => { sends.push(send); plannedEmails.add(send.email); if (send.user_id) plannedUsers.add(send.user_id); };
  const skip = (campaign, item, reason) => skips.push({ campaign, email: clean(item.email) || null, user_id: item.user_id || null, event_key: item.event_key || null, reason });

  // ---- Priority 1: abandoned checkout (A) and course practice offer (C)
  const abandonedEvents = [
    ...(facts.checkouts || []).map(row => ({ path: 'A', ...row, email: clean(row.email), event_key: `buy:${row.id}`, idempotency_key: `abandoned-${row.id}`, at: time(row.created_at), lang: languageOf([row.page_path], row.language) })),
    ...(facts.clicks || []).filter(row => row.kind === 'practice').map(row => ({ path: 'C', ...row, email: clean(row.email), event_key: `click:${row.id}`, idempotency_key: `abandoned-click-${row.id}`, at: time(row.created_at), lang: languageOf([row.page_path, row.destination, row.label], row.language) }))
  ].sort((a, b) => a.at - b.at);

  for (const event of abandonedEvents) {
    const blocked = blockedReason(event.email, blockOptions);
    if (blocked) { skip('abandoned', event, blocked); continue; }
    if (event.paid) { skip('abandoned', event, 'paid'); continue; }
    if (isPlanned(event.email, event.user_id)) { skip('abandoned', event, 'already in this run'); continue; }
    const history = sentTo(event.email, event.user_id);
    if (history.some(h => h.campaign === 'abandoned' && now - h.at < DEDUPE_MS)) { skip('abandoned', event, 'abandoned in last 3 days'); continue; }
    const nudges = history.filter(h => NUDGES.has(h.campaign));
    const lastNudge = Math.max(0, ...nudges.map(h => h.at));
    if (nudges.length >= LIFETIME_NUDGES && !(event.at > lastNudge)) { skip('abandoned', event, `lifetime cap (${LIFETIME_NUDGES})`); continue; }
    plan({ campaign: 'abandoned', path: event.path, email: event.email, user_id: event.user_id || null, lang: event.lang, event_key: event.event_key, idempotency_key: event.idempotency_key, event_at: new Date(event.at).toISOString() });
  }

  // ---- Priority 2: prices (Pricing / Buy clickers who did not buy)
  const priceClicks = (facts.clicks || []).filter(row => row.kind !== 'practice')
    .map(row => ({ ...row, email: clean(row.email), event_key: `click:${row.id}`, idempotency_key: `prices-${row.id}`, at: time(row.created_at), lang: languageOf([row.page_path, row.destination, row.label], row.language) }))
    .sort((a, b) => a.at - b.at);
  for (const click of priceClicks) {
    const blocked = blockedReason(click.email, blockOptions);
    if (blocked) { skip('prices', click, blocked); continue; }
    if (click.paid) { skip('prices', click, 'paid'); continue; }
    const history = sentTo(click.email, click.user_id);
    if (isPlanned(click.email, click.user_id)) { skip('prices', click, 'already in this run'); continue; }
    if (history.some(h => h.campaign === 'abandoned' && now - h.at < DEDUPE_MS)) { skip('prices', click, 'cross-path (A/C wins)'); continue; }
    if (history.some(h => h.campaign === 'prices' && now - h.at < DEDUPE_MS)) { skip('prices', click, 'prices in last 3 days'); continue; }
    if (history.filter(h => NUDGES.has(h.campaign)).length >= LIFETIME_NUDGES) { skip('prices', click, `lifetime cap (${LIFETIME_NUDGES})`); continue; }
    plan({ campaign: 'prices', path: 'B', email: click.email, user_id: click.user_id || null, lang: click.lang, event_key: click.event_key, idempotency_key: click.idempotency_key, event_at: new Date(click.at).toISOString() });
  }

  // ---- Priority 3 and 4: recent unpaid signups (already filtered to unpaid by the database), after the wait
  const signups = [...(facts.signups || [])].sort((a, b) => Number(b.spent || 0) - Number(a.spent || 0));
  for (const user of signups) {
    const email = clean(user.email);
    const userId = user.id || user.user_id;
    const made = Number(user.videos || 0) + Number(user.images || 0);
    const campaign = made > 0 ? 'credits_used' : 'welcome';
    const item = { email, user_id: userId };
    if (now - time(user.created_at) < waitMs) continue;          // too new: decided on a later run
    if (isPlanned(email, userId)) continue;                       // getting a higher-priority email now
    const history = sentTo(email, userId);
    if (history.length >= maxEmails || history.some(h => h.campaign === campaign)) continue; // already emailed
    const blocked = blockedReason(email, blockOptions);
    if (blocked) { skip(campaign, item, blocked); continue; }
    if (campaign === 'credits_used') {
      if (history.some(h => NUDGES.has(h.campaign))) { skip(campaign, item, 'got a prices/abandoned email'); continue; }
      const model = modelName(user.top_model);
      if (model === null) { skip(campaign, item, 'audio only'); continue; }
      if (model === undefined) { skip(campaign, item, `unknown model: ${String(user.top_model || '').slice(0, 60)}`); continue; }
      const videos = Number(user.videos || 0), images = Number(user.images || 0);
      const count = videos > 0 ? videos : images;
      const word = videos > 0 ? (videos === 1 ? 'video' : 'videos') : (images === 1 ? 'image' : 'images');
      plan({
        campaign, email, user_id: userId, lang: 'en', event_key: `credits_used:${userId}`, idempotency_key: `credits-used-${userId}`,
        vars: { count, word, isVideo: videos > 0, creditsSpent: Math.round(Number(user.spent || 0) * 9), model, usedUp: Number(user.balance || 0) < 1.8 }
      });
    } else {
      if (history.length) continue; // welcome only for people with no lifecycle email at all
      plan({ campaign, email, user_id: userId, lang: 'en', event_key: `welcome:${userId}`, idempotency_key: `welcome-${userId}` });
    }
  }

  if (sends.length > MAX_ELIGIBLE) return { sends: [], skips: [], halted: `safety stop: ${sends.length} eligible (more than ${MAX_ELIGIBLE})`, eligible: sends.length };
  return { sends, skips };
}
