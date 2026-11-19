import test from 'node:test';
import assert from 'node:assert/strict';
process.env.META_WHATSAPP_APP_ID='app';process.env.META_WHATSAPP_APP_SECRET='secret';process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN='verify';
const { exchangeWhatsAppCode, sharedWhatsAppAccounts, whatsAppOnBusinessApp } = await import('../../lib/automation/whatsapp.mjs');
const reply = body => async () => ({ ok:true, json:async () => body });

test('phone flow: the code is exchanged with the same return address', async () => {
  let asked;
  await exchangeWhatsAppCode('c1', async url => { asked = new URL(url); return { ok:true, json:async () => ({ access_token:'t' }) }; }, 'https://hansora.co/automation-connect.html');
  assert.equal(asked.searchParams.get('redirect_uri'), 'https://hansora.co/automation-connect.html');
  await exchangeWhatsAppCode('c2', async url => { asked = new URL(url); return { ok:true, json:async () => ({ access_token:'t' }) }; });
  assert.equal(asked.searchParams.has('redirect_uri'), false);
});

test('phone flow: shared WhatsApp accounts come from the token', async () => {
  const ids = await sharedWhatsAppAccounts({ accessToken:'t', fetchImpl:reply({ data:{ granular_scopes:[{ scope:'business_management', target_ids:['1'] }, { scope:'whatsapp_business_management', target_ids:['111111', '222222'] }, { scope:'whatsapp_business_messaging', target_ids:['111111'] }] } }) });
  assert.deepEqual(ids, ['111111', '222222']);
});

test('phone flow: coexistence only when Meta says the number is on the Business app', async () => {
  assert.equal(await whatsAppOnBusinessApp({ phoneNumberId:'1', accessToken:'t', fetchImpl:reply({ is_on_biz_app:true }) }), true);
  assert.equal(await whatsAppOnBusinessApp({ phoneNumberId:'1', accessToken:'t', fetchImpl:async () => ({ ok:false, json:async () => ({}) }) }), false);
});
