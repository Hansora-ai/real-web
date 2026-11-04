import test from 'node:test';
import assert from 'node:assert/strict';
import { canCallFrom, outgoingLineFor, sameCountry } from '../../lib/automation/phone-outgoing.mjs';
import { describePhoneCall } from '../../lib/automation/phone.mjs';

const us = { e164: '+17432702705', country: 'US', livekit_outbound_trunk_id: 'ST_out', allow_international: false };

test('outgoing calls stay in the number’s country unless allowed', () => {
  assert.equal(sameCountry('US', '+12125550100'), true);
  assert.equal(sameCountry('US', '+37491000000'), false);
  assert.equal(sameCountry('ZZ', '+12125550100'), false);
  assert.equal(canCallFrom(us, '+37491000000'), false);
  assert.equal(canCallFrom({ ...us, allow_international: true }, '+37491000000'), true);
  assert.equal(canCallFrom({ ...us, livekit_outbound_trunk_id: null }, '+12125550100'), false);
  assert.equal(outgoingLineFor([{ ...us, allow_international: true }, { e164: '+37460000000', country: 'AM', livekit_outbound_trunk_id: 'ST_am' }], '+37491000000').e164, '+37460000000');
  assert.equal(outgoingLineFor([us], '+37491000000'), null);
});

test('an outgoing call describes the customer as the other side and keeps the reason', () => {
  const call = describePhoneCall({ jobMetadata: { direction: 'outbound', business_id: '14aeca3a-d3b4-4d9a-b876-e23954dd1826', to: '+37491000000', from: '+17432702705', purpose: 'Confirm Friday' }, attributes: {}, roomName: 'hansora-out-x' });
  assert.equal(call.direction, 'outbound');
  assert.equal(call.callerNumber, '+37491000000');
  assert.equal(call.calledNumber, '+17432702705');
  assert.equal(call.purpose, 'Confirm Friday');
  assert.equal(describePhoneCall({ jobMetadata: { direction: 'inbound' }, attributes: { 'sip.phoneNumber': '+1555' } }).purpose, '');
});


import { autoCallSettings, insideHours } from '../../lib/automation/phone-auto-calls.mjs';
test('call automations are off by default, clamped, with calling hours', () => {
  const off = autoCallSettings();
  assert.equal(off.order.on, false); assert.equal(off.reminder.on, false);
  assert.equal(off.from, '09:00'); assert.equal(off.to, '20:00');
  const on = autoCallSettings({ from: '10:30', to: '25:00', order: { on: true, delay_minutes: 99999 }, reminder: { on: true, hours_before: 0, purpose: '  ' } });
  assert.equal(on.order.delay_minutes, 1440);
  assert.equal(on.reminder.hours_before, 1);
  assert.match(on.reminder.purpose, /Remind/);
  assert.equal(on.from, '10:30'); assert.equal(on.to, '20:00');
  assert.equal(insideHours('12:00', '09:00', '20:00'), true);
  assert.equal(insideHours('20:00', '09:00', '20:00'), false);
  assert.equal(insideHours('23:00', '22:00', '06:00'), true);
  assert.equal(insideHours('07:00', '22:00', '06:00'), false);
});
