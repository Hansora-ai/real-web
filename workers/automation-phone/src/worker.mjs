import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cli, defineAgent, llm, ServerOptions, tool, voice } from '@livekit/agents';
import * as google from '@livekit/agents-plugin-google';
import { ParticipantKind } from '@livekit/rtc-node';
import { LiveKitAPI } from 'livekit-server-sdk';
import { buildAutomationInstructions, firstMessageFor } from '../../../lib/automation/instructions.mjs';
import { first, rows, serviceInsert, serviceUpdate, serviceUpsert, supabaseRequest } from '../../../lib/automation/db.mjs';
import { notifyOwner } from '../../../lib/automation/notify.mjs';
import { affordableVoiceSeconds, automationPrices, canAfford, chargeCredits, handleOutOfCredits, voiceCredits } from '../../../lib/automation/billing.mjs';
import { PHONE_AGENT_NAME, PHONE_MODEL, PHONE_VOICE, billableVoiceSeconds, describePhoneCall, normalizePhoneNumber, renderCallTranscript, voiceInstructions } from '../../../lib/automation/phone.mjs';
import { buildToolDefinitions, createToolRunner, loadToolConfigs, toolInstructions } from '../../../lib/automation/tools.mjs';

function one(value) { return Array.isArray(value) ? value[0] : value; }
function text(value, max = 500) { return String(value || '').trim().slice(0, max); }

async function loadBusinessById(businessId) {
  const select = 'id,owner_user_id,name,description,timezone,automation_agents(*),automation_business_knowledge(*),automation_channel_connections(*)';
  return first(`/rest/v1/automation_businesses?id=eq.${encodeURIComponent(businessId)}&select=${encodeURIComponent(select)}&limit=1`);
}

async function loadBusinessByNumber(calledNumber) {
  if (!calledNumber) return null;
  let resource = await first(`/rest/v1/automation_provider_resources?provider=eq.livekit&resource_type=eq.phone_number&provider_resource_id=eq.${encodeURIComponent(calledNumber)}&status=eq.active&select=business_id&limit=1`);
  if (!resource) resource = await first(`/rest/v1/automation_provider_resources?provider=eq.livekit&resource_type=eq.phone_number&safe_config-%3E%3Ee164=eq.${encodeURIComponent(calledNumber)}&status=eq.active&select=business_id&limit=1`);
  return resource ? loadBusinessById(resource.business_id) : null;
}

function phoneSettings(business) {
  const channels = Array.isArray(business?.automation_channel_connections) ? business.automation_channel_connections : [];
  return channels.find(channel => channel.channel_type === 'phone')?.settings || {};
}

async function createCallbackRequest({ business, conversation, contact, callerNumber, reason, providerCallId }) {
  const key = `${conversation.id}:phone_callback`;
  const saved = await serviceInsert('automation_outcomes', {
    business_id: business.id,
    conversation_id: conversation.id,
    contact_id: contact.id,
    outcome_type: 'lead',
    title: 'Callback request',
    status: 'new',
    created_by: 'ai',
    idempotency_key: key,
    customer_name: contact.display_name || 'Caller',
    customer_phone: callerNumber || '',
    collected_fields: { Reason: reason || 'Requested a person', Phone: callerNumber || 'Not available', Call: providerCallId },
    summary: `Caller requested a person. Transfer did not complete. ${reason || ''}`.trim()
  }, { ignoreDuplicates: true });
  const outcome = saved || await first(`/rest/v1/automation_outcomes?business_id=eq.${business.id}&idempotency_key=eq.${encodeURIComponent(key)}&select=*&limit=1`);
  await notifyOwner({
    businessId: business.id,
    event: 'handoff_requested',
    idempotencyKey: `phone_callback:${providerCallId}`,
    data: { businessId: business.id, outcomeId: outcome?.id || null, conversationId: conversation.id, business: business.name, channel: 'Phone', customer: [contact.display_name, callerNumber].filter(Boolean).join(' · ') || 'Caller', details: reason || 'Callback requested' }
  }).catch(error => console.error('phone callback notification failed', { message: error?.message }));
  return outcome;
}

export default defineAgent({
  entry: async (ctx) => {
    await ctx.connect();
    const participant = await ctx.waitForParticipant();
    const descriptor = describePhoneCall({
      jobMetadata: ctx.job.metadata,
      participantMetadata: participant.metadata,
      attributes: participant.attributes,
      roomName: ctx.room.name,
      participantIdentity: participant.identity
    });
    const business = descriptor.businessId ? await loadBusinessById(descriptor.businessId) : await loadBusinessByNumber(descriptor.calledNumber);
    if (!business) throw new Error('phone_business_not_found');
    const agent = one(business.automation_agents);
    const knowledge = one(business.automation_business_knowledge);
    if (!agent || !knowledge) throw new Error('phone_agent_configuration_incomplete');
    const settings = phoneSettings(business);
    const isTest = descriptor.direction === 'test';
    const externalContactId = isTest ? `phone-test:${descriptor.ownerUserId || participant.identity}` : (descriptor.callerNumber || participant.identity);
    const now = new Date().toISOString();
    const contact = await serviceUpsert('automation_contacts', 'business_id,channel_type,external_contact_id', {
      business_id: business.id,
      display_name: isTest ? 'Live phone test' : (participant.name || 'Phone caller'),
      primary_phone: descriptor.callerNumber,
      channel_type: 'phone',
      external_contact_id: externalContactId,
      last_seen_at: now,
      profile: { source: isTest ? 'workspace_phone_test' : 'livekit_sip', called_number: descriptor.calledNumber }
    });
    const conversation = await serviceUpsert('automation_conversations', 'business_id,channel_type,external_thread_id', {
      business_id: business.id,
      contact_id: contact.id,
      channel_type: 'phone',
      external_thread_id: descriptor.providerCallId,
      status: 'open',
      ai_enabled: true,
      last_message_preview: isTest ? 'Live phone test started' : 'Incoming phone call',
      last_message_at: now
    });
    const call = await serviceInsert('automation_calls', {
      business_id: business.id,
      conversation_id: conversation.id,
      provider_call_id: descriptor.providerCallId,
      direction: descriptor.direction,
      status: 'connected',
      started_at: now,
      connected_at: now,
      outcome: { room_name: descriptor.roomName, caller_number: descriptor.callerNumber, called_number: descriptor.calledNumber, participant_identity: descriptor.participantIdentity, model: process.env.GEMINI_PHONE_MODEL || PHONE_MODEL, voice: process.env.GEMINI_PHONE_VOICE || PHONE_VOICE }
    }, { ignoreDuplicates: true }) || await first(`/rest/v1/automation_calls?business_id=eq.${business.id}&provider_call_id=eq.${encodeURIComponent(descriptor.providerCallId)}&select=*&limit=1`);

    // Pay as you go: the call only runs as long as the owner's credits cover it.
    const perMinute = isTest ? automationPrices().testVoiceMinute : automationPrices().voiceMinute;
    const funds = await canAfford(business.id, perMinute);
    const maxSeconds = funds.balance === null ? Infinity : affordableVoiceSeconds(funds.balance, perMinute);
    const outOfCredits = !funds.ok;
    if (outOfCredits && !isTest) await handleOutOfCredits({ businessId: business.id, conversationId: conversation.id, businessName: business.name, channel: 'Phone', customer: descriptor.callerNumber || 'Caller', notifyOwner });

    const configs = await loadToolConfigs(business.id);
    const definitions = buildToolDefinitions({ tools: configs });
    const runTool = createToolRunner(
      { businessId: business.id, conversationId: conversation.id, contactId: contact.id, channel: 'phone', contact: { name: contact.display_name, phone: descriptor.callerNumber }, dryRun: isTest },
      { notifyOwner: async payload => payload.event === 'handoff_requested' ? { delayed_for_phone_transfer:true } : notifyOwner(payload) }
    );
    const livekitApi = new LiveKitAPI();
    let callStatus = 'completed';
    const liveTools = definitions.map(definition => tool({
      name: definition.name,
      description: definition.name === 'handoff_to_human'
        ? `${definition.description} Before calling this tool, tell the caller you are transferring them and wait for that sentence to finish.`
        : definition.description,
      parameters: definition.parameters,
      execute: async (args, runContext) => {
        const result = await runTool(definition.name, args);
        if (definition.name !== 'handoff_to_human' || !result.ok || isTest) return result;
        const transferNumber = normalizePhoneNumber(settings.transfer_number);
        if (!transferNumber || participant.kind !== ParticipantKind.SIP) {
          await createCallbackRequest({ business, conversation, contact, callerNumber: descriptor.callerNumber, reason: text(args.reason, 300), providerCallId: descriptor.providerCallId });
          return { ok: true, callback_requested: true, note: 'The transfer line is unavailable. Tell the caller the team has their callback request and will contact them.' };
        }
        try {
          await runContext.waitForPlayout();
          await livekitApi.sip.transferSipParticipant(ctx.room.name, participant.identity, `tel:${transferNumber}`, { playDialtone: false, ringingTimeout: Number(process.env.LIVEKIT_TRANSFER_RINGING_TIMEOUT || 25), timeout: Number(process.env.LIVEKIT_TRANSFER_REQUEST_TIMEOUT || 35) });
          callStatus = 'transferred';
          return { ok: true, transferred: true, note: 'The caller was transferred successfully.' };
        } catch (error) {
          console.error('phone transfer failed', { message: error?.message });
          await createCallbackRequest({ business, conversation, contact, callerNumber: descriptor.callerNumber, reason: text(args.reason, 300), providerCallId: descriptor.providerCallId });
          return { ok: true, callback_requested: true, note: 'Nobody answered the transfer. Tell the caller a callback request was saved and the team will contact them.' };
        }
      }
    }));

    const instructions = voiceInstructions(
      buildAutomationInstructions({ business, agent, knowledge }),
      toolInstructions(definitions, configs),
      settings
    );
    const session = new voice.AgentSession({
      llm: new google.realtime.RealtimeModel({
        model: process.env.GEMINI_PHONE_MODEL || PHONE_MODEL,
        voice: process.env.GEMINI_PHONE_VOICE || PHONE_VOICE,
        apiKey: process.env.GOOGLE_API_KEY,
        temperature: 0.5,
        inputAudioTranscription: {},
        outputAudioTranscription: {}
      })
    });
    const turns = [];
    let writeQueue = Promise.resolve();
    const enqueue = task => { writeQueue = writeQueue.then(task).catch(error => console.error('phone transcript write failed', { message: error?.message })); };
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, event => {
      if (!(event.item instanceof llm.ChatMessage)) return;
      const role = event.item.role;
      if (role !== 'user' && role !== 'assistant') return;
      const content = text(event.item.textContent, 24000);
      if (!content) return;
      const turn = { role, text: content, at: new Date(event.item.createdAt || Date.now()).toISOString(), id: event.item.id };
      turns.push(turn);
      if (settings.save_transcripts === false) return;
      enqueue(async () => {
        await serviceInsert('automation_messages', {
          business_id: business.id,
          conversation_id: conversation.id,
          idempotency_key: `livekit:${descriptor.providerCallId}:${event.item.id}`,
          direction: role === 'user' ? 'inbound' : 'outbound',
          sender_type: role === 'user' ? 'customer' : 'ai',
          content_type: 'text',
          content,
          status: role === 'user' ? 'received' : 'sent',
          billable: false,
          provider: 'livekit',
          model: role === 'assistant' ? (process.env.GEMINI_PHONE_MODEL || PHONE_MODEL) : null,
          metadata: { call_id: call.id, interrupted: Boolean(event.item.interrupted), direction: descriptor.direction },
          occurred_at: turn.at
        }, { ignoreDuplicates: true });
        await serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { last_message_preview: content.slice(0, 1000), last_message_at: turn.at });
      });
    });
    session.on(voice.AgentSessionEventTypes.Error, event => { if (callStatus !== 'transferred') callStatus = 'failed'; console.error('phone session error', { error: event.error?.message || String(event.error) }); });

    let finalized = false;
    async function finalize() {
      if (finalized) return;
      finalized = true;
      await writeQueue;
      const endedAt = new Date().toISOString();
      const seconds = billableVoiceSeconds(call.started_at, endedAt, call.connected_at);
      const transcript = settings.save_transcripts === false ? '' : renderCallTranscript(turns);
      await serviceUpdate('automation_calls', `id=eq.${call.id}`, { status: callStatus, ended_at: endedAt, billable_seconds: seconds, transcript });
      await serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { status: callStatus === 'transferred' ? 'human_handling' : 'resolved', resolved_at: callStatus === 'transferred' ? null : endedAt, summary: transcript.slice(0, 8000) });
      if (seconds > 0) {
        // Charge once, at the end; if the balance ran short take what is left (never below zero).
        const charge = await chargeCredits({ businessId: business.id, idempotencyKey: `usage:phone:${descriptor.providerCallId}`, kind: isTest ? 'test_voice' : 'voice', credits: voiceCredits(seconds, perMinute), conversationId: conversation.id, reference: { call_id: call.id, seconds }, allowPartial: true }).catch(error => { console.error('phone credit charge failed', { message: error?.message }); return { ok: false, charged: 0 }; });
        const rate = Math.max(0, Number(process.env.AUTOMATION_PHONE_COST_MINOR_PER_MINUTE || 0));
        await serviceInsert('automation_usage_events', {
          business_id: business.id,
          conversation_id: conversation.id,
          channel_type: 'phone',
          unit_type: 'voice_second',
          quantity: seconds,
          billable_quantity: isTest ? 0 : seconds,
          estimated_cost_minor: isTest ? 0 : Math.ceil((seconds / 60) * rate),
          currency: 'USD',
          provider: 'gemini',
          provider_usage_id: descriptor.providerCallId,
          idempotency_key: `usage:phone:${descriptor.providerCallId}`,
          credits: charge.charged || 0,
          metadata: { call_id: call.id, model: process.env.GEMINI_PHONE_MODEL || PHONE_MODEL, voice: process.env.GEMINI_PHONE_VOICE || PHONE_VOICE, test: isTest }
        }, { ignoreDuplicates: true });
      }
    }
    ctx.addShutdownCallback(finalize);
    session.once(voice.AgentSessionEventTypes.Close, () => { finalize().catch(error => console.error('phone finalize failed', { message: error?.message })); });

    await session.start({
      room: ctx.room,
      agent: voice.Agent.create({ instructions, tools: liveTools }),
      record: settings.save_transcripts === false ? { audio: false, transcript: false, traces: true, logs: true } : true
    });
    const hangUp = async () => { try { await livekitApi.room.deleteRoom(ctx.room.name); } catch (_) { ctx.shutdown?.('out_of_credits'); } };
    if (outOfCredits) {
      callStatus = 'failed';
      const transferNumber = normalizePhoneNumber(settings.transfer_number);
      if (!isTest && transferNumber && participant.kind === ParticipantKind.SIP) {
        try { await livekitApi.sip.transferSipParticipant(ctx.room.name, participant.identity, `tel:${transferNumber}`, { playDialtone: false }); callStatus = 'transferred'; return; } catch (error) { console.error('out of credits transfer failed', { message: error?.message }); }
      }
      session.generateReply({ instructions: 'Say briefly and politely, in the caller\'s language if you can tell it, that nobody can take the call right now and they can send a message or call back later. Then say goodbye.' });
      setTimeout(hangUp, 12000);
      return;
    }
    if (Number.isFinite(maxSeconds)) {
      // Wrap up politely shortly before the credits run out, then end the call.
      setTimeout(() => session.generateReply({ instructions: 'Politely tell the caller you need to end the call now, that the team will follow up, and say goodbye.' }), Math.max(0, maxSeconds - 20) * 1000);
      setTimeout(hangUp, maxSeconds * 1000);
    }
    const greeting = text(settings.greeting, 300) || firstMessageFor({ business, agent });
    session.generateReply({ instructions: `Say this opening sentence exactly, then wait for the caller: ${greeting}` });
  }
});

cli.runApp(new ServerOptions({
  agent: fileURLToPath(import.meta.url),
  agentName: process.env.LIVEKIT_PHONE_AGENT_NAME || PHONE_AGENT_NAME
}));
