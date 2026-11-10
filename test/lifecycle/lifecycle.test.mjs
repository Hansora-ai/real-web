import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { planRun, languageOf, modelName, DAY } from '../../lib/lifecycle/plan.mjs';
import { renderEmail } from '../../lib/lifecycle/render.mjs';
import { runLifecycle } from '../../lib/lifecycle/run.mjs';
import { TEMPLATES } from '../../lib/lifecycle/templates.data.mjs';
import { rowsFromLog, importSql } from '../../scripts/import-lifecycle-bot-log.mjs';

const NOW = Date.parse('2026-11-04T20:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const H = 3600000;
const click = (id, email, extra = {}) => ({ id, email, kind: 'pricing', label: 'Pricing, 30% off', destination: '/pricing.html', page_path: '/index.html', created_at: ago(H), paid: false, ...extra });
const by = (result, campaign) => result.sends.filter(s => s.campaign === campaign).map(s => s.email);

test('language routing', () => {
  assert.equal(languageOf(['/index_arm.html']), 'hy');
  assert.equal(languageOf(['/course_ru', 'x']), 'ru');
  assert.equal(languageOf(['Цены со скидкой 30%']), 'ru');
  assert.equal(languageOf(['Գներ՝ 30% զեղչով']), 'hy');
  assert.equal(languageOf(['/index.html'], 'arm'), 'hy');
  assert.equal(languageOf(['/index.html'], 'ru'), 'ru');
  assert.equal(languageOf(['/index.html'], null), 'en');
});

test('model names', () => {
  assert.equal(modelName('grok-imagine-video'), 'Grok Imagine');
  assert.equal(modelName('nano-banana-2'), 'Nano Banana 2');
  assert.equal(modelName('suno-v5'), null);
  assert.equal(modelName('mystery'), undefined);
});

test('pricing click gets a prices email in the right language, once per run', () => {
  const r = planRun({ clicks: [click(1, 'A@x.com'), click(2, 'a@x.com'), click(3, 'b@x.com', { page_path: '/index_ru.html', destination: '/pricing_ru.html' })] }, { now: NOW });
  assert.deepEqual(by(r, 'prices'), ['a@x.com', 'b@x.com']);
  assert.equal(r.sends[1].lang, 'ru');
  assert.equal(r.sends[0].idempotency_key, 'prices-1');
  assert.equal(r.skips.find(s => s.event_key === 'click:2').reason, 'already in this run');
});

test('3-day dedupe, paid, internal and temp emails are skipped', () => {
  const r = planRun({
    clicks: [click(1, 'a@x.com'), click(2, 'paid@x.com', { paid: true }), click(3, 'me@hansora.co'), click(4, 'z@gtempaccount.com'), click(5, 'u@x.com')],
    history: [{ email: 'a@x.com', campaign: 'prices', sent_at: ago(2 * DAY) }],
    unsubscribed: ['u@x.com']
  }, { now: NOW });
  assert.deepEqual(r.sends, []);
  assert.deepEqual(r.skips.map(s => s.reason), ['prices in last 3 days', 'paid', 'internal account', 'temporary email', 'unsubscribed']);
  // with more than one email allowed, the old 3-day rule still applies
  const three = planRun({ settings: { max_emails_per_person: 3 }, clicks: [click(1, 'a@x.com')], history: [{ email: 'a@x.com', campaign: 'prices', sent_at: ago(2 * DAY) }] }, { now: NOW });
  assert.equal(three.skips[0].reason, 'prices in last 3 days');
});

test('A/C wins over B in the same run and for 3 days after', () => {
  const r = planRun({
    settings: { max_emails_per_person: 3 },
    checkouts: [{ id: 9, email: 'a@x.com', status: 'abandoned', page_path: '/pricing_arm.html', created_at: ago(2 * H), paid: false }],
    clicks: [click(1, 'a@x.com'), click(2, 'b@x.com')],
    history: [{ email: 'b@x.com', campaign: 'abandoned', sent_at: ago(DAY) }]
  }, { now: NOW });
  assert.deepEqual(by(r, 'abandoned'), ['a@x.com']);
  assert.equal(r.sends[0].lang, 'hy');
  assert.equal(r.sends[0].idempotency_key, 'abandoned-9');
  assert.deepEqual(by(r, 'prices'), []);
  assert.deepEqual(r.skips.map(s => s.reason), ['already in this run', 'cross-path (A/C wins)']);
});

test('practice offer click is Path C (abandoned), never prices', () => {
  const r = planRun({ clicks: [click(5, 'c@x.com', { kind: 'practice', label: 'course_ru_video_1_practice_offer_buy_clicked | x', page_path: '/course_ru' })] }, { now: NOW });
  assert.equal(r.sends[0].campaign, 'abandoned');
  assert.equal(r.sends[0].path, 'C');
  assert.equal(r.sends[0].lang, 'ru');
});

test('lifetime cap of 2: prices stops, only a NEW checkout reopens one abandoned email', () => {
  const history = [
    { email: 'a@x.com', campaign: 'prices', sent_at: ago(10 * DAY) },
    { email: 'a@x.com', campaign: 'abandoned', sent_at: ago(5 * DAY) }
  ];
  const settings = { max_emails_per_person: 5 };
  const old = planRun({ settings, checkouts: [{ id: 1, email: 'a@x.com', created_at: ago(6 * DAY), paid: false }], clicks: [click(2, 'a@x.com')], history }, { now: NOW });
  assert.deepEqual(old.sends, []);
  assert.deepEqual(old.skips.map(s => s.reason), ['lifetime cap (2)', 'lifetime cap (2)']);
  const fresh = planRun({ settings, checkouts: [{ id: 3, email: 'a@x.com', created_at: ago(H), paid: false }], history }, { now: NOW });
  assert.deepEqual(by(fresh, 'abandoned'), ['a@x.com']);
});

test('credits-used and welcome for new signups', () => {
  const r = planRun({
    signups: [
      { id: 'u1', email: 'low@x.com', videos: 1, images: 0, spent: 1, top_model: 'grok-video', balance: 0 },
      { id: 'u2', email: 'high@x.com', videos: 0, images: 3, spent: 5, top_model: 'nano-banana-2', balance: 4 },
      { id: 'u3', email: 'new@x.com', videos: 0, images: 0, spent: 0 },
      { id: 'u4', email: 'audio@x.com', videos: 0, images: 1, spent: 1, top_model: 'suno' },
      { id: 'u5', email: 'nudged@x.com', videos: 1, images: 0, spent: 1, top_model: 'kling' },
      { id: 'u6', email: 'done@x.com', videos: 0, images: 0, spent: 0 },
      { id: 'u7', email: null, videos: 0, images: 0, spent: 0 }
    ],
    history: [{ email: 'nudged@x.com', campaign: 'prices', sent_at: ago(DAY) }, { email: 'done@x.com', user_id: 'u6', campaign: 'welcome', sent_at: ago(H) }]
  }, { now: NOW });
  assert.deepEqual(by(r, 'credits_used'), ['high@x.com', 'low@x.com']); // highest spend first
  assert.deepEqual(by(r, 'welcome'), ['new@x.com']);
  const high = r.sends[0];
  assert.deepEqual(high.vars, { count: 3, word: 'images', isVideo: false, creditsSpent: 45, model: 'Nano Banana 2', usedUp: false });
  assert.deepEqual(r.skips.map(s => s.reason).sort(), ['audio only', 'no email']); // nudged@ and done@ already got their one email
});

test('one email per person, by priority: checkout > prices > credits-used > welcome', () => {
  const r = planRun({
    checkouts: [{ id: 1, email: 'a@x.com', user_id: 'ua', created_at: ago(2 * H), paid: false }],
    clicks: [click(2, 'a@x.com'), click(3, 'b@x.com', { user_id: 'ub' })],
    signups: [
      { id: 'ua', email: 'a@x.com', videos: 1, images: 0, spent: 1, top_model: 'grok', created_at: ago(3 * H) },
      { id: 'ub', email: 'b@x.com', videos: 1, images: 0, spent: 1, top_model: 'grok', created_at: ago(3 * H) },
      { id: 'uc', email: 'c@x.com', videos: 2, images: 0, spent: 2, top_model: 'grok', created_at: ago(3 * H) },
      { id: 'ud', email: 'd@x.com', videos: 0, images: 0, spent: 0, created_at: ago(3 * H) }
    ]
  }, { now: NOW });
  assert.deepEqual(r.sends.map(s => `${s.campaign}:${s.email}`), ['abandoned:a@x.com', 'prices:b@x.com', 'credits_used:c@x.com', 'welcome:d@x.com']);
});

test('a signup email does not block a later nudge; signup emails stay one per person', () => {
  const r = planRun({
    checkouts: [{ id: 1, email: 'a@x.com', created_at: ago(H), paid: false }],
    clicks: [click(2, 'p@x.com')],
    signups: [{ id: 'u1', email: 'w@x.com', videos: 3, images: 0, spent: 3, top_model: 'grok', created_at: ago(5 * H) }],
    history: [
      { email: 'a@x.com', campaign: 'welcome', sent_at: ago(10 * DAY) },
      { email: 'p@x.com', campaign: 'credits_used', sent_at: ago(DAY) },
      { user_id: 'u1', campaign: 'welcome', sent_at: ago(4 * H) }
    ]
  }, { now: NOW });
  assert.deepEqual(r.sends.map(s => `${s.campaign}:${s.email}`), ['abandoned:a@x.com', 'prices:p@x.com']);
});

test('signups wait an hour, so people who generate get credits-used instead of welcome', () => {
  const fresh = planRun({ signups: [{ id: 'u1', email: 'a@x.com', videos: 0, images: 0, created_at: ago(30 * 60000) }] }, { now: NOW });
  assert.deepEqual(fresh.sends, []);
  const later = planRun({ signups: [{ id: 'u1', email: 'a@x.com', videos: 1, images: 0, spent: 1, top_model: 'kling', created_at: ago(61 * 60000) }] }, { now: NOW });
  assert.deepEqual(by(later, 'credits_used'), ['a@x.com']);
  const custom = planRun({ settings: { signup_wait_minutes: 0 }, signups: [{ id: 'u1', email: 'a@x.com', videos: 0, images: 0, created_at: ago(60000) }] }, { now: NOW });
  assert.deepEqual(by(custom, 'welcome'), ['a@x.com']);
});

test('safety stop above 300', () => {
  const signups = Array.from({ length: 301 }, (_, i) => ({ id: `u${i}`, email: `p${i}@x.com`, videos: 0, images: 0 }));
  const r = planRun({ signups }, { now: NOW });
  assert.match(r.halted, /safety stop/);
  assert.equal(r.sends.length, 0);
});

test('templates render with no placeholders left', () => {
  for (const campaign of ['abandoned', 'prices']) for (const lang of ['en', 'hy', 'ru']) {
    const e = renderEmail({ campaign, lang });
    assert.ok(e.subject && e.html.startsWith('<!DOCTYPE html>') && e.text.includes('Unsubscribe') || e.text.includes('Отписаться') || e.text.includes('Հրաժարվել'));
  }
  const welcome = renderEmail({ campaign: 'welcome', lang: 'en' });
  assert.equal(welcome.subject, 'Create without a monthly subscription');
  assert.ok(welcome.html.includes('Hi there,') && !welcome.html.includes('RESEND_UNSUBSCRIBE_URL'));
  const used = renderEmail({ campaign: 'credits_used', vars: { count: 1, word: 'video', isVideo: true, creditsSpent: 16, model: 'Grok Imagine', usedUp: true } });
  assert.equal(used.subject, "You've made 1 video with Hansora");
  assert.ok(used.html.includes('Your free credits are used up.') && used.text.includes('and your free credits are used up.'));
  const notUsed = renderEmail({ campaign: 'credits_used', vars: { count: 2, word: 'images', isVideo: false, creditsSpent: 27, model: 'GPT Image', usedUp: false } });
  assert.ok(!notUsed.html.includes('used up') && notUsed.html.includes('images made') && notUsed.html.includes('>27<'));
  assert.ok(notUsed.text.includes("You've made 2 images with Hansora.\nSo far: 27 credits spent, 2 images made, top model GPT Image."));
});

test('templates.data.mjs matches the template files', async () => {
  for (const [name, content] of Object.entries(TEMPLATES)) {
    assert.equal(await readFile(new URL(`../../lib/lifecycle/templates/${name}`, import.meta.url), 'utf8'), content, name);
  }
});

function deps(facts, extra = {}) {
  const recorded = [], sent = [], notes = [];
  return {
    recorded, sent, notes,
    now: NOW, startedAt: Date.now(), gapMs: 0,
    facts: async () => ({ settings: { enabled: true, dry_run: false, max_per_run: 25 }, ...facts }),
    paidSince: async () => false,
    record: async (row) => { recorded.push(row); },
    saveRun: async () => {},
    send: async (send, email) => { sent.push({ to: send.email, subject: email.subject, key: send.idempotency_key }); return { ok: true, status: 200, id: `r${sent.length}` }; },
    notify: async (text) => { notes.push(text); },
    ...extra
  };
}

test('run sends, records sends and event skips, and re-checks payment', async () => {
  const d = deps({ clicks: [click(1, 'a@x.com'), click(2, 'a@x.com'), click(3, 'late@x.com')] }, { paidSince: async (_u, email) => email === 'late@x.com' });
  const summary = await runLifecycle(d);
  assert.deepEqual(d.sent, [{ to: 'a@x.com', subject: 'Quick question about prices', key: 'prices-1' }]);
  assert.deepEqual(summary.sent, { prices: 1 });
  assert.deepEqual(d.recorded.map(r => [r.event_key, r.status, r.reason || null]), [['click:2', 'skipped', 'already in this run'], ['click:1', 'sent', null], ['click:3', 'skipped', 'paid (re-check)']]);
});

test('dry run sends and records nothing', async () => {
  const d = deps({ clicks: [click(1, 'a@x.com')], settings: { enabled: true, dry_run: true } });
  const summary = await runLifecycle(d);
  assert.equal(d.sent.length, 0);
  assert.equal(d.recorded.length, 0);
  assert.equal(summary.would_send[0].email, 'a@x.com');
});

test('Resend rate limit stops the run and alerts; 4xx is recorded as failed', async () => {
  let calls = 0;
  const d = deps({ clicks: [click(1, 'bad@x.com'), click(2, 'b@x.com'), click(3, 'c@x.com')] }, {
    send: async () => (++calls === 1 ? { ok: false, status: 422, error: 'invalid to' } : { ok: false, status: 429 })
  });
  const summary = await runLifecycle(d);
  assert.equal(summary.stopped, 'Resend rate limit');
  assert.equal(summary.deferred, 2);
  assert.deepEqual(d.recorded.map(r => r.status), ['failed']);
  assert.equal(d.notes.length, 1);
});

test('per-run limit defers the rest to the next run', async () => {
  const d = deps({ clicks: [click(1, 'a@x.com'), click(2, 'b@x.com'), click(3, 'c@x.com')], settings: { enabled: true, dry_run: false, max_per_run: 2 } });
  const summary = await runLifecycle(d);
  assert.equal(d.sent.length, 2);
  assert.equal(summary.deferred, 1);
});

test('bot log import', () => {
  const log = [
    '{"_meta":"x"}',
    '{"email": "A@x.com", "campaign": "abandoned", "last_sent_at": "2026-09-14T18:05:48Z", "row_id": 58, "lang": "HY"}',
    '{"email": "b@x.com", "campaign": "prices", "last_sent_at": "2026-10-01T00:00:00Z", "idempotency_key": "prices-777"}',
    '{"campaign": "credits_used", "email": "c@x.com", "idempotency_key": "credits-used-b3dea5bb-8f76-41a7-846d-d148a0eb4250", "last_sent_at": "2026-11-04T18:44:00Z"}',
    '{"campaign": "skip", "run": "x", "note": "n"}',
    '{"type": "run_summary", "last_successful_run": "2026-11-04T18:50:00Z"}'
  ].join('\n');
  const { rows, latest } = rowsFromLog(log);
  assert.deepEqual(rows.map(r => [r.email, r.campaign, r.event_key]), [['a@x.com', 'abandoned', 'buy:58'], ['b@x.com', 'prices', 'click:777'], ['c@x.com', 'credits_used', 'credits_used:b3dea5bb-8f76-41a7-846d-d148a0eb4250']]);
  assert.equal(rows[2].user_id, 'b3dea5bb-8f76-41a7-846d-d148a0eb4250');
  assert.equal(latest, '2026-11-04T18:50:00.000Z');
  const sql = importSql({ rows, latest });
  assert.match(sql, /on conflict \(event_key\) do nothing/);
  assert.match(sql, /events_after = '2026-11-04T18:50:00.000Z'::timestamptz - interval '20 minutes'/);
});
