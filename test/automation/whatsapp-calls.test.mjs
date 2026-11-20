import test from 'node:test';
import assert from 'node:assert/strict';
import { enableWhatsAppCalls, disableWhatsAppCalls, explainMetaError, MetaCallingError, businessNumber, enableBody } from '../../lib/automation/whatsapp-calling.mjs';
import { handle } from '../../netlify/functions/automation-whatsapp-calls.mjs';
import { describePhoneCall } from '../../lib/automation/phone.mjs';

const BIZ = '14aeca3a-d3b4-4d9a-b876-e23954dd1826';
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function metaFetch({ refuse = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization });
    if (refuse) return reply(400, { error: refuse });
    if (String(url).includes('include_sip_credentials=true')) return reply(200, { calling: { status: 'ENABLED', sip: { status: 'ENABLED', servers: [{ hostname: 'sip.test', sip_user_password: 'meta-secret' }] } } });
    return reply(200, { success: true });
  };
  return { calls, fetchImpl };
}
function fakeSip() {
  const made = { trunks: [], rules: [], deleted: [] };
  return {
    made,
    createSipInboundTrunk: async (name, numbers, opts) => { made.trunks.push({ name, numbers, opts }); return { sipTrunkId: 'ST_1' }; },
    createSipDispatchRule: async (rule, opts) => { made.rules.push({ rule, opts }); return { sipDispatchRuleId: 'SDR_1' }; },
    deleteSipTrunk: async id => { made.deleted.push(id); },
    deleteSipDispatchRule: async id => { made.deleted.push(id); }
  };
}

test('the business number is read from the display number', () => {
  assert.deepEqual(businessNumber('+374 91 918868'), { e164: '+37491918868', digits: '37491918868' });
  assert.throws(() => businessNumber(''), /whatsapp_number_unknown/);
});

test('turning calls on: Meta settings, Meta SIP password, a LiveKit trunk for that number and a dispatch with the business', async () => {
  const meta = metaFetch(); const sip = fakeSip();
  const result = await enableWhatsAppCalls({ businessId: BIZ, phoneNumberId: '1414436445095320', displayNumber: '+374 91 918868', accessToken: 'tok', graphVersion: 'v23.0', host: 'sip.test', sip, fetchImpl: meta.fetchImpl });
  const [settings, credentials] = meta.calls;
  assert.equal(settings.method, 'POST');
  assert.match(settings.url, /\/v23\.0\/1414436445095320\/settings$/);
  assert.deepEqual(settings.body, enableBody('sip.test'));
  assert.deepEqual(settings.body.calling.sip.servers, [{ hostname: 'sip.test', port: 5061 }]);
  assert.equal(settings.body.calling.srtp_key_exchange_protocol, 'SDES');
  assert.equal(settings.auth, 'Bearer tok');
  assert.match(credentials.url, /settings\?include_sip_credentials=true$/);
  const trunk = sip.made.trunks[0];
  assert.deepEqual(trunk.numbers, ['+37491918868', '37491918868']);
  assert.equal(trunk.opts.authUsername, '37491918868');
  assert.equal(trunk.opts.authPassword, 'meta-secret');
  assert.equal(trunk.opts.mediaEncryption, 2);
  const dispatch = JSON.parse(sip.made.rules[0].opts.roomConfig.agents[0].metadata);
  assert.deepEqual(dispatch, { direction: 'inbound', business_id: BIZ, channel: 'whatsapp' });
  assert.deepEqual(result, { e164: '+37491918868', trunkId: 'ST_1', ruleId: 'SDR_1', sipStatus: 'ENABLED', callingStatus: 'ENABLED' });
});

test('the phone worker takes the business from that dispatch, whatever number was called', () => {
  const call = describePhoneCall({ jobMetadata: JSON.stringify({ direction: 'inbound', business_id: BIZ, channel: 'whatsapp' }), attributes: { 'sip.phoneNumber': '+15550001111', 'sip.trunkPhoneNumber': '+37491918868', 'sip.callID': 'c1' } });
  assert.equal(call.businessId, BIZ);
  assert.equal(call.direction, 'inbound');
  assert.equal(call.callerNumber, '+15550001111');
});

test("Meta's refusal is kept word for word, with a plain hint", async () => {
  const meta = metaFetch({ refuse: { message: 'Calling is not available for coexistence phone numbers', code: 138000, error_data: { details: 'WhatsApp Business app number' } } });
  const sip = fakeSip();
  const error = await enableWhatsAppCalls({ businessId: BIZ, phoneNumberId: '1', displayNumber: '+37491918868', accessToken: 't', graphVersion: 'v23.0', sip, fetchImpl: meta.fetchImpl }).catch(e => e);
  assert.ok(error instanceof MetaCallingError);
  assert.equal(sip.made.trunks.length, 0);
  const shown = explainMetaError(error);
  assert.equal(shown.meta_code, 138000);
  assert.match(shown.meta_message, /coexistence/);
  assert.match(shown.hint, /WhatsApp Business app/);
  const limit = explainMetaError(new MetaCallingError('enable', 400, { message: 'Phone number messaging limit is below 2000' }));
  assert.match(limit.hint, /2,000/);
});

test('turning calls off: Meta disabled, LiveKit trunk and rule removed', async () => {
  const meta = metaFetch(); const sip = fakeSip();
  await disableWhatsAppCalls({ phoneNumberId: '1', accessToken: 't', graphVersion: 'v23.0', trunkId: 'ST_1', ruleId: 'SDR_1', sip, fetchImpl: meta.fetchImpl });
  assert.deepEqual(meta.calls[0].body, { calling: { status: 'DISABLED', sip: { status: 'DISABLED' } } });
  assert.deepEqual(sip.made.deleted.sort(), ['SDR_1', 'ST_1']);
});

// The endpoint, with the database and the two services replaced.
function endpointDeps({ account = { id: 'r1', provider_resource_id: 'pn1', safe_config: { display_phone_number: '+374 91 918868', coexistence: true } }, enable } = {}) {
  const saved = [];
  return {
    saved,
    deps: {
      authenticateRequest: async event => (event.headers?.authorization === 'Bearer good' ? { id: 'u1' } : null),
      first: async path => {
        if (path.includes('automation_businesses')) return { id: BIZ };
        if (path.includes('resource_type=eq.whatsapp_account')) return account;
        if (path.includes('automation_provider_credentials')) return { encrypted: 'x' };
        return null;
      },
      serviceUpdate: async (table, filter, patch) => { saved.push(patch.safe_config.calling); return [{}]; },
      decryptSecret: () => 'tok',
      enableWhatsAppCalls: enable || (async () => ({ e164: '+37491918868', trunkId: 'ST_1', ruleId: 'SDR_1' })),
      disableWhatsAppCalls: async () => ({ metaError: null })
    }
  };
}
const call = (deps, method, body, query) => handle({ httpMethod: method, headers: { authorization: 'Bearer good' }, body: body ? JSON.stringify({ business_id: BIZ, ...body }) : undefined, queryStringParameters: query || { business_id: BIZ } }, deps);

test('the endpoint shows the connected number and turns calls on and off', async () => {
  const { deps, saved } = endpointDeps();
  const view = JSON.parse((await call(deps, 'GET')).body);
  assert.deepEqual(view, { connected: true, number: { display: '+374 91 918868', name: '', coexistence: true }, calling: { enabled: false, enabled_at: null, last_error: null } });
  const on = await call(deps, 'POST', { action: 'enable' });
  assert.equal(on.statusCode, 200);
  assert.equal(JSON.parse(on.body).calling.enabled, true);
  assert.equal(saved[0].trunk_id, 'ST_1');
  const off = await call(deps, 'POST', { action: 'disable' });
  assert.equal(JSON.parse(off.body).calling.enabled, false);
});

test("the endpoint saves and returns Meta's refusal", async () => {
  const { deps, saved } = endpointDeps({ enable: async () => { throw new MetaCallingError('enable', 400, { message: 'Not eligible for calling', code: 138039 }); } });
  const res = await call(deps, 'POST', { action: 'enable' });
  assert.equal(res.statusCode, 409);
  const body = JSON.parse(res.body);
  assert.equal(body.calling.enabled, false);
  assert.equal(body.calling.last_error.meta_message, 'Not eligible for calling');
  assert.equal(saved[0].last_error.meta_code, 138039);
});

test('without a connected WhatsApp, or signed out, nothing is changed', async () => {
  const { deps } = endpointDeps({ account: null });
  assert.equal(JSON.parse((await call(deps, 'GET')).body).connected, false);
  assert.equal((await call(deps, 'POST', { action: 'enable' })).statusCode, 409);
  assert.equal((await handle({ httpMethod: 'GET', headers: {}, queryStringParameters: { business_id: BIZ } }, deps)).statusCode, 401);
});
