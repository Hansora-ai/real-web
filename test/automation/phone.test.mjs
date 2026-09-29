import test from 'node:test';
import assert from 'node:assert/strict';
import { billableVoiceSeconds, describePhoneCall, normalizePhoneNumber, renderCallTranscript, voiceInstructions } from '../../lib/automation/phone.mjs';

test('phone routing separates authenticated browser tests from inbound SIP calls', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  assert.deepEqual(describePhoneCall({ jobMetadata: JSON.stringify({ business_id:id, owner_user_id:'owner', direction:'test' }), roomName:'test-room', participantIdentity:'browser' }), {
    businessId:id, ownerUserId:'owner', direction:'test', callerNumber:'', calledNumber:'', providerCallId:'test-room', roomName:'test-room', participantIdentity:'browser'
  });
  const inbound = describePhoneCall({ attributes:{'sip.phoneNumber':'+374 99 111 222','sip.trunkPhoneNumber':'010 555 444','sip.callID':'call-1'}, roomName:'call-room' });
  assert.equal(inbound.direction, 'inbound');
  assert.equal(inbound.callerNumber, '+37499111222');
  assert.equal(inbound.calledNumber, '+010555444');
  assert.equal(inbound.providerCallId, 'call-1');
});

test('phone helpers validate numbers, bill connected seconds, and format transcripts', () => {
  assert.equal(normalizePhoneNumber('(+374) 99-123-456'), '+37499123456');
  assert.equal(normalizePhoneNumber('123'), '');
  assert.equal(billableVoiceSeconds('2026-09-28T10:00:00Z', '2026-09-28T10:00:10.001Z'), 11);
  assert.equal(renderCallTranscript([{role:'user',text:'Hello'}, {role:'assistant',text:'Hi'}]), 'Caller: Hello\nAI: Hi');
});

test('voice instructions include configured greeting and phone-specific safety rules', () => {
  const instructions = voiceInstructions('Business facts', 'Actions', { greeting:'Բարև' });
  assert.match(instructions, /Business facts/);
  assert.match(instructions, /Բարև/);
  assert.match(instructions, /Do not claim that an action succeeded/);
  assert.match(instructions, /transfer the call/);
});
