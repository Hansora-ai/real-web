import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// In-app purchases (app/iap.js): every Buy button on the two pricing pages maps to a store product, and the
// products are the same as on the server (lib/business/app-purchases.mjs on the website branch).
const web = new URL('../web/', import.meta.url);
const read = path => readFileSync(new URL(path, web), 'utf8');
const SERVER_PACKS = { 'co.hansora.app.credits.900': 90, 'co.hansora.app.credits.2000': 200, 'co.hansora.app.credits.5100': 510, 'co.hansora.app.credits.10500': 1050 };
const SERVER_PLANS = ['premium_monthly', 'pro_monthly', 'pro_max_monthly', 'automation_lite_monthly', 'automation_starter_monthly', 'automation_growth_monthly', 'automation_business_monthly', 'automation_scale_monthly'];

function loadIap() {
  const window = { Capacitor: null };
  const document = { readyState: 'complete', addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, getElementById: () => null, documentElement: {} };
  vm.runInNewContext(read('app/iap.js'), { window, document, location: { pathname: '/', search: '' }, URLSearchParams, MutationObserver: class { observe() {} }, requestAnimationFrame: f => f(), setTimeout, console });
  return window.HansoraIAP;
}

test('store products match the server', () => {
  const iap = loadIap();
  for (const [credits, id] of Object.entries(iap.PACKS)) assert.equal(SERVER_PACKS[id], Number(credits), id);
  assert.deepEqual(Object.keys(iap.PLANS).sort(), [...SERVER_PLANS].sort());
});

test('every Buy button on the Creative pricing page has a store product', () => {
  const html = read('pricing.html'); const iap = loadIap();
  const packs = [...html.matchAll(/class="[^"]*buy-credits[^"]*"[^>]*data-credits="(\d+)"/g)].map(m => m[1]);
  const plans = [...html.matchAll(/class="buy-subscription" data-plan-id="([a-z_]+)"/g)].map(m => m[1]);
  assert.ok(packs.length >= 4 && plans.length === 3);
  for (const c of packs) assert.ok(iap.PACKS[c], 'pack ' + c);
  for (const p of plans) assert.ok(iap.PLANS[p], 'plan ' + p);
  assert.match(html, /app\/iap\.js/);
});

test('every pack and plan on the Automation pricing page has a store product', () => {
  const js = read('automation-pricing.js'); const iap = loadIap();
  const packIds = [...js.matchAll(/\{ id: '(starter|growth|business|scale)'/g)].map(m => m[1]);
  const planIds = [...js.matchAll(/\{ id: '(automation_[a-z]+_monthly)'/g)].map(m => m[1]);
  assert.deepEqual(packIds, ['starter', 'growth', 'business', 'scale']);
  // Lite, Starter, Growth, Business on sale + Scale (no longer sold, kept for people who already have it).
  assert.equal(planIds.length, 5);
  for (const p of planIds) assert.ok(iap.PLANS[p], p);
  assert.match(read('automation-pricing.html'), /app\/iap\.js/);
});
