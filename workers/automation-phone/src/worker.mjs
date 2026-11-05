import { fileURLToPath } from 'node:url';
import { cli, defineAgent, llm, ServerOptions, tool, voice } from '@livekit/agents';
import * as google from '@livekit/agents-plugin-google';
import { ParticipantKind, RoomEvent } from '@livekit/rtc-node';
import { LiveKitAPI } from 'livekit-server-sdk';
import { buildAutomationInstructions, firstMessageFor } from '../../../lib/automation/instructions.mjs';
import { first, serviceInsert, serviceUpdate, serviceUpsert } from '../../../lib/automation/db.mjs';
import { notifyOwner } from '../../../lib/automation/notify.mjs';
import { affordableVoiceSeconds, automationPricesFor, canAfford, chargeCredits, handleOutOfCredits, voiceCredits } from '../../../lib/automation/billing.mjs';
import { PHONE_AGENT_NAME, PHONE_MODEL, PHONE_VOICE, billableVoiceSeconds, createPhoneMetrics, describePhoneCall, normalizePhoneNumber, parsePhoneMetadata, phoneLanguageSettings, phoneTestMaxSeconds, phoneTestSettings, phoneVoice, renderCallTranscript, voiceInstructions } from '../../../lib/automation/phone.mjs';
import { canCallFrom } from '../../../lib/automation/phone-outgoing.mjs';
import { businessClock, buildToolDefinitions, createToolRunner, loadToolConfigs, toolInstructions } from '../../../lib/automation/tools.mjs';

// The Google plugin (1.9.1) reports every model-started generation as caller
// speech. Right after a tool call that interrupts the reply that is running the
// tool, so its result is dropped; the plugin then holds back the caller's audio
// until that result arrives, and the call goes silent and deaf. While a tool
// call is pending, a generation start is the model continuing, not the caller.
// Real barge-in (Gemini's "interrupted" signal) is left untouched. As a last
// resort, a tool call still pending after STALE_TOOL_MS stops blocking audio.
const STALE_TOOL_MS = 12_000;
// The team member the AI calls during a warm transfer joins the call under this identity.
const TEAM_IDENTITY = 'hansora-team';
function guardToolTurns(model, counts) {
  if (typeof model?.session !== 'function') return model;
  const createSession = model.session.bind(model);
  model.session = (...args) => {
    const session = createSession(...args);
    // These are plugin internals; if a plugin update renames them, run unguarded rather than fail the call.
    if (!['handleInputSpeechStarted', 'startNewGeneration', 'shouldBlockRealtimeInputForPendingTools'].every(name => typeof session?.[name] === 'function')) return session;
    const speechStarted = session.handleInputSpeechStarted.bind(session);
    const startGeneration = session.startNewGeneration.bind(session);
    const shouldBlock = session.shouldBlockRealtimeInputForPendingTools.bind(session);
    let startingGeneration = false;
    session.startNewGeneration = (...startArgs) => {
      startingGeneration = true;
      try { return startGeneration(...startArgs); } finally { startingGeneration = false; }
    };
    session.handleInputSpeechStarted = () => {
      if (startingGeneration && session.pendingToolCallIds?.size > 0) { counts.tool_turns_kept++; return; }
      return speechStarted();
    };
    session.shouldBlockRealtimeInputForPendingTools = () => {
      if (!shouldBlock()) return false;
      const now = Date.now();
      for (const id of [...session.pendingToolCallIds]) {
        const createdAt = session.toolCallStatuses?.get(id)?.createdAt;
        if (createdAt && now - createdAt > STALE_TOOL_MS) { session.pendingToolCallIds.delete(id); counts.stale_tool_calls_released++; }
      }
      return shouldBlock();
    };
    return session;
  };
  return model;
}

// Saved caller lines come from Gemini's separate transcription, which guessed
// Armenian on phone audio as German or Spanish. Hint the employee's languages.
// This changes only the written transcript, not what the model hears.
function transcriptionLanguages(agent) {
  const configured = agent.supported_languages?.length ? agent.supported_languages : [agent.primary_language].filter(Boolean);
  const languageCodes = [...new Set(configured.flatMap(code => { try { return Intl.getCanonicalLocales(code); } catch { return []; } }))];
  return languageCodes.length ? { languageCodes } : {};
}

// Product results say how many photos a product has; on a call that only
// leads the assistant to offer photos it cannot show.
function withoutPhotoCounts(result) {
  if (!Array.isArray(result?.products)) return result;
  return { ...result, products: result.products.map(product => { const { photos, ...rest } = product || {}; return rest; }) };
}

function one(value) { return Array.isArray(value) ? value[0] : value; }
function text(value, max = 500) { return String(value || '').trim().slice(0, max); }

async function loadBusinessById(businessId) {
  const select = 'id,owner_user_id,name,description,timezone,automation_agents(*),automation_business_knowledge(*),automation_channel_connections(*)';
  return first(`/rest/v1/automation_businesses?id=eq.${encodeURIComponent(businessId)}&select=${encodeURIComponent(select)}&limit=1`);
}

// Inbound calls are routed only by the server-assigned number pool. Owners can
// write automation_provider_resources, so it must never decide routing.
async function loadBusinessByNumber(calledNumber) {
  if (!calledNumber) return null;
  const number = await first(`/rest/v1/automation_phone_numbers?e164=eq.${encodeURIComponent(calledNumber)}&status=eq.assigned&select=business_id&limit=1`);
  return number?.business_id ? loadBusinessById(number.business_id) : null;
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
    const job = parsePhoneMetadata(ctx.job.metadata);
    // The test phone number dispatches with test_transport 'sip' and no browser identity.
    const sipTest = job.direction === 'test' && job.test_transport === 'sip';
    if (job.direction === 'test' && !job.participant_identity && !sipTest) throw new Error('phone_test_identity_missing');
    await ctx.connect();
    const livekitApi = new LiveKitAPI();
    // Outgoing call: the server already checked the owner, the number, the country and the credits.
    // The AI dials, waits until the person answers, and only then starts talking.
    if (job.direction === 'outbound') {
      const to = normalizePhoneNumber(job.to), from = normalizePhoneNumber(job.from);
      if (!to || !from || !job.trunk_id || !job.business_id) throw new Error('phone_outbound_metadata_missing');
      try {
        await livekitApi.sip.createSipParticipant(String(job.trunk_id), to, ctx.room.name, { fromNumber: from, participantIdentity: `sip_${to.slice(1)}`, participantName: text(job.contact_name, 80) || 'Customer', waitUntilAnswered: true, ringingTimeout: 40, timeout: 55 });
      } catch (error) {
        console.error('outgoing call not answered', { message: error?.message });
        const at = new Date().toISOString();
        const key = `outbound:${ctx.room.name}`.slice(0, 500);
        const missed = { status: 'missed', ended_at: at, billable_seconds: 0, outcome: { called_number: to, line_number: from, purpose: text(job.purpose, 500), reason: text(error?.message, 200), ...(job.trigger_key ? { trigger_key: text(job.trigger_key, 200) } : {}) } };
        // The server recorded the call as 'ringing' when it started it; mark that row missed (or add one).
        const updated = await serviceUpdate('automation_calls', `business_id=eq.${encodeURIComponent(job.business_id)}&provider_call_id=eq.${encodeURIComponent(key)}`, missed).catch(() => []);
        if (!updated?.length) await serviceInsert('automation_calls', { business_id: job.business_id, provider_call_id: key, direction: 'outbound', started_at: at, ...missed }, { ignoreDuplicates: true }).catch(() => null);
        await livekitApi.room.deleteRoom(ctx.room.name).catch(() => null);
        ctx.shutdown?.('no_answer');
        return;
      }
    }
    const participant = await ctx.waitForParticipant(job.direction === 'test' && !sipTest ? job.participant_identity : undefined);
    if (sipTest && participant.kind !== ParticipantKind.SIP) throw new Error('phone_test_sip_participant_required');
    const descriptor = describePhoneCall({
      jobMetadata: ctx.job.metadata,
      participantMetadata: participant.metadata,
      attributes: participant.attributes,
      roomName: ctx.room.name,
      participantIdentity: participant.identity
    });
    const business = descriptor.businessId ? await loadBusinessById(descriptor.businessId) : await loadBusinessByNumber(descriptor.calledNumber);
    if (!business) throw new Error('phone_business_not_found');
    const isTest = descriptor.direction === 'test';
    const isOutbound = descriptor.direction === 'outbound';
    // The first real call on an imported SIP number proves the owner's provider is set up: it is connected from now on.
    if (descriptor.direction === 'inbound' && descriptor.calledNumber) {
      const verified = await serviceUpdate('automation_phone_numbers', `e164=eq.${encodeURIComponent(descriptor.calledNumber)}&business_id=eq.${business.id}&provider=eq.sip&verified_at=is.null`, { verified_at: new Date().toISOString() }).catch(() => []);
      if (verified?.length) await serviceUpdate('automation_channel_connections', `business_id=eq.${business.id}&channel_type=eq.phone`, { status: 'connected', last_error_code: null }).catch(() => null);
    }
    if (isTest && (!descriptor.ownerUserId || descriptor.ownerUserId !== business.owner_user_id)) throw new Error('phone_test_owner_mismatch');
    const agent = one(business.automation_agents);
    const knowledge = one(business.automation_business_knowledge);
    if (!agent || !knowledge) throw new Error('phone_agent_configuration_incomplete');
    const settings = isTest && job.test_settings ? { ...phoneSettings(business), ...phoneTestSettings(job.test_settings) } : phoneSettings(business);
    // The owner's chosen voice; else the deployment default (Leda).
    const callVoice = phoneVoice(settings.voice) || process.env.GEMINI_PHONE_VOICE || PHONE_VOICE;
    const externalContactId = isTest ? `phone-test:${descriptor.ownerUserId || participant.identity}` : (descriptor.callerNumber || participant.identity);
    const now = new Date().toISOString();
    const contact = await serviceUpsert('automation_contacts', 'business_id,channel_type,external_contact_id', {
      business_id: business.id,
      display_name: isTest ? 'Live phone test' : isOutbound ? (text(job.contact_name, 120) || 'Phone contact') : (participant.name || 'Phone caller'),
      primary_phone: descriptor.callerNumber,
      channel_type: 'phone',
      external_contact_id: externalContactId,
      last_seen_at: now,
      profile: { source: isTest ? 'workspace_phone_test' : isOutbound ? 'outbound_call' : 'livekit_sip', called_number: descriptor.calledNumber }
    });
    const conversation = await serviceUpsert('automation_conversations', 'business_id,channel_type,external_thread_id', {
      business_id: business.id,
      contact_id: contact.id,
      channel_type: 'phone',
      external_thread_id: descriptor.providerCallId,
      status: 'open',
      ai_enabled: true,
      last_message_preview: isTest ? 'Live phone test started' : isOutbound ? 'Outgoing phone call' : 'Incoming phone call',
      last_message_at: now
    });
    // An outgoing call already has its row (saved as 'ringing' by the server), so it is read, not inserted twice.
    const existingCall = isOutbound ? await first(`/rest/v1/automation_calls?business_id=eq.${business.id}&provider_call_id=eq.${encodeURIComponent(descriptor.providerCallId)}&select=*&limit=1`) : null;
    const call = existingCall || await serviceInsert('automation_calls', {
      business_id: business.id,
      conversation_id: conversation.id,
      provider_call_id: descriptor.providerCallId,
      direction: descriptor.direction,
      status: 'connected',
      started_at: now,
      connected_at: now,
      outcome: { room_name: descriptor.roomName, caller_number: descriptor.callerNumber, called_number: descriptor.calledNumber, participant_identity: descriptor.participantIdentity, model: process.env.GEMINI_PHONE_MODEL || PHONE_MODEL, voice: callVoice, ...(isOutbound ? { purpose: descriptor.purpose } : {}) }
    }, { ignoreDuplicates: true }) || await first(`/rest/v1/automation_calls?business_id=eq.${business.id}&provider_call_id=eq.${encodeURIComponent(descriptor.providerCallId)}&select=*&limit=1`);
    // An outgoing call was saved as 'ringing' when it was started: it is answered now, so billing starts now.
    if (call?.status === 'ringing') {
      Object.assign(call, { status: 'connected', started_at: now, connected_at: now, outcome: { ...call.outcome, room_name: descriptor.roomName, caller_number: descriptor.callerNumber, called_number: descriptor.calledNumber, model: process.env.GEMINI_PHONE_MODEL || PHONE_MODEL, voice: callVoice } });
      await serviceUpdate('automation_calls', `id=eq.${call.id}`, { status: call.status, started_at: now, connected_at: now, conversation_id: conversation.id, outcome: call.outcome });
    }

    // Pay as you go: the call only runs as long as the owner's credits cover it.
    const perMinute = isTest ? 0 : (await automationPricesFor(business.id)).voiceMinute;
    const funds = await canAfford(business.id, perMinute);
    const maxSeconds = isTest ? phoneTestMaxSeconds() : (funds.balance === null ? Infinity : affordableVoiceSeconds(funds.balance, perMinute));
    const outOfCredits = !funds.ok;
    if (outOfCredits && !isTest) await handleOutOfCredits({ businessId: business.id, conversationId: conversation.id, businessName: business.name, channel: 'Phone', customer: descriptor.callerNumber || 'Caller', notifyOwner });

    const configs = await loadToolConfigs(business.id);
    // A phone call cannot show photos, so the photo tool (and its instructions) is left out.
    const definitions = buildToolDefinitions({ tools: configs }).filter(definition => definition.name !== 'send_product_photos');
    const runTool = createToolRunner(
      { businessId: business.id, conversationId: conversation.id, contactId: contact.id, channel: 'phone', contact: { name: contact.display_name, phone: descriptor.callerNumber }, dryRun: isTest },
      { notifyOwner: async payload => payload.event === 'handoff_requested' ? { delayed_for_phone_transfer:true } : notifyOwner(payload) }
    );
    let callStatus = 'completed';
    // The business number this call is on: it decides whether the AI can call the team for a warm transfer.
    const lineNumber = isTest || !descriptor.calledNumber ? null : await first(`/rest/v1/automation_phone_numbers?e164=eq.${encodeURIComponent(descriptor.calledNumber)}&business_id=eq.${business.id}&status=eq.assigned&select=e164,country,livekit_outbound_trunk_id,allow_international&limit=1`).catch(() => null);
    // Warm transfer: briefing (the AI tells the team member about the caller) → bridged (AI silent) → done.
    const handover = { phase: '' };
    const liveTools = definitions.map(definition => tool({
      name: definition.name,
      description: definition.name === 'handoff_to_human'
        ? `${definition.description} Before calling this tool, tell the caller you are transferring them and wait for that sentence to finish.`
        : definition.description,
      parameters: definition.parameters,
      execute: async (args, runContext) => {
        const result = withoutPhotoCounts(await runTool(definition.name, args));
        if (definition.name !== 'handoff_to_human' || !result.ok || isTest) return result;
        const transferNumber = (settings.transfer_on === false ? '' : normalizePhoneNumber(settings.transfer_number));
        if (!transferNumber || participant.kind !== ParticipantKind.SIP) {
          await createCallbackRequest({ business, conversation, contact, callerNumber: descriptor.callerNumber, reason: text(args.reason, 300), providerCallId: descriptor.providerCallId });
          return { ok: true, callback_requested: true, note: 'The transfer line is unavailable. Tell the caller the team has their callback request and will contact them.' };
        }
        // Warm transfer: the AI calls the team member into this call, tells them who is calling and why, then goes quiet.
        if (settings.transfer_mode !== 'direct' && canCallFrom(lineNumber, transferNumber)) {
          await runContext.waitForPlayout();
          session.input?.setAudioEnabled?.(false);
          try {
            await livekitApi.sip.createSipParticipant(lineNumber.livekit_outbound_trunk_id, transferNumber, ctx.room.name, { fromNumber: lineNumber.e164, participantIdentity: TEAM_IDENTITY, participantName: 'Team', waitUntilAnswered: true, ringingTimeout: Number(process.env.LIVEKIT_TRANSFER_RINGING_TIMEOUT || 25), timeout: 45, playDialtone: true });
          } catch (error) {
            console.error('warm transfer not answered', { message: error?.message });
            session.input?.setAudioEnabled?.(true);
            await createCallbackRequest({ business, conversation, contact, callerNumber: descriptor.callerNumber, reason: text(args.reason, 300), providerCallId: descriptor.providerCallId });
            return { ok: true, callback_requested: true, note: 'Nobody from the team answered. Tell the caller a callback request was saved and the team will contact them soon.' };
          }
          callStatus = 'transferred';
          handover.phase = 'briefing';
          later(silenceAi, 30000);
          return { ok: true, connected: true, note: 'A team member has just answered and now hears you and the caller. In one or two short sentences, tell the team member who is calling and what they need, then say they are connected now. Say nothing after that.' };
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

    // Same as the chats: the AI knows the business's current date and time and, when bookings or deliveries are
    // on, the live free times and places at the start of the call (it still checks with the tools before confirming).
    const liveBrief = await runTool.liveBrief?.().catch(error => { console.error('phone live brief failed', { message: error?.message }); return ''; }) || '';
    const instructions = voiceInstructions(
      buildAutomationInstructions({ business, agent, knowledge, channel: 'phone', phoneLanguages: phoneLanguageSettings(settings).languages }),
      [toolInstructions(definitions, configs), `Current business date and time: ${businessClock(business.timezone)}.`, liveBrief, isOutbound ? `This is an OUTGOING call: you called ${descriptor.callerNumber} on behalf of ${business.name}. Reason for the call: ${descriptor.purpose || 'follow up with the customer'}. Say you are ${business.name}'s AI assistant. If you reach voicemail, leave one short message with the reason and say goodbye.` : ''].filter(Boolean).join('\n\n'),
      settings
    );
    const toolTurns = { tool_turns_kept: 0, stale_tool_calls_released: 0 };
    const session = new voice.AgentSession({
      llm: guardToolTurns(new google.realtime.RealtimeModel({
        model: process.env.GEMINI_PHONE_MODEL || PHONE_MODEL,
        voice: callVoice,
        apiKey: process.env.GOOGLE_API_KEY,
        temperature: 0.5,
        inputAudioTranscription: transcriptionLanguages(agent),
        outputAudioTranscription: {}
      }), toolTurns)
    });
    const turns = [];
    const providerMetrics = createPhoneMetrics();
    const timers = new Set();
    const later = (task, ms) => { const timer = setTimeout(() => { timers.delete(timer); task(); }, ms); timers.add(timer); return timer; };
    session.on(voice.AgentSessionEventTypes.MetricsCollected, event => providerMetrics.collect(event.metrics));
    let writeQueue = Promise.resolve();
    const enqueue = task => { writeQueue = writeQueue.then(task).catch(error => console.error('phone transcript write failed', { message: error?.message })); };
    // Transcripts went missing from 7 October with no error. Count what the
    // session hands over so the call record shows where the text is lost.
    const transcriptEvents = { items: 0, items_without_text: 0, user_final: 0, user_final_saved: 0 };
    const savedTurnIds = new Set();
    // A caller line is finalised only after the reply to it has started, so it
    // is stamped with when its words first arrived; otherwise the inbox shows
    // it after the answer.
    const callerHeardAt = new Map();
    function saveTurn({ role, content, id, createdAt, interrupted = false }) {
      if (!content || savedTurnIds.has(id)) return;
      savedTurnIds.add(id);
      const turn = { role, text: content, at: new Date(createdAt || Date.now()).toISOString(), id };
      turns.push(turn);
      if (settings.save_transcripts === false) return;
      enqueue(async () => {
        await serviceInsert('automation_messages', {
          business_id: business.id,
          conversation_id: conversation.id,
          idempotency_key: `livekit:${descriptor.providerCallId}:${id}`,
          direction: role === 'user' ? 'inbound' : 'outbound',
          sender_type: role === 'user' ? 'customer' : 'ai',
          content_type: 'text',
          content,
          status: role === 'user' ? 'received' : 'sent',
          billable: false,
          provider: 'livekit',
          model: role === 'assistant' ? (process.env.GEMINI_PHONE_MODEL || PHONE_MODEL) : null,
          metadata: { call_id: call.id, interrupted: Boolean(interrupted), direction: descriptor.direction },
          occurred_at: turn.at
        }, { ignoreDuplicates: true });
        await serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { last_message_preview: content.slice(0, 1000), last_message_at: turn.at });
      });
    }
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, event => {
      if (!(event.item instanceof llm.ChatMessage)) return;
      const role = event.item.role;
      if (role !== 'user' && role !== 'assistant') return;
      transcriptEvents.items++;
      const content = text(event.item.textContent, 24000);
      if (!content) { transcriptEvents.items_without_text++; return; }
      saveTurn({ role, content, id: event.item.id, createdAt: (role === 'user' && callerHeardAt.get(event.item.id)) || event.item.createdAt, interrupted: event.item.interrupted });
    });
    // Backup for the caller's side: the final recognised speech, keyed by the
    // same item id so a later conversation item does not save it twice.
    // Gemini finalises a caller line only when its reply completes, so words
    // said just before hanging up stay interim. Keep the latest interim line
    // and save it when the call ends if it was never finalised.
    let interimCaller = null;
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, event => {
      if (!event.isFinal) {
        if (event.itemId && !callerHeardAt.has(event.itemId)) callerHeardAt.set(event.itemId, Date.now());
        if (event.itemId && event.transcript) interimCaller = { id: event.itemId, transcript: event.transcript, createdAt: callerHeardAt.get(event.itemId) };
        return;
      }
      transcriptEvents.user_final++;
      const content = text(event.transcript, 24000);
      if (!content || !event.itemId) return;
      transcriptEvents.user_final_saved++;
      saveTurn({ role: 'user', content, id: event.itemId, createdAt: callerHeardAt.get(event.itemId) ?? event.createdAt });
    });
    // Warm transfer: once the AI has finished telling the team member about the caller, it goes silent and stops listening.
    function silenceAi() {
      if (handover.phase !== 'briefing') return;
      handover.phase = 'bridged';
      session.output?.setAudioEnabled?.(false);
      session.input?.setAudioEnabled?.(false);
    }
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, event => { if (handover.phase === 'briefing' && event.oldState === 'speaking' && event.newState !== 'speaking') silenceAi(); });
    // If the team member hangs up first, the AI comes back for the caller.
    ctx.room.on(RoomEvent.ParticipantDisconnected, left => {
      if (left?.identity !== TEAM_IDENTITY || !['briefing', 'bridged'].includes(handover.phase)) return;
      handover.phase = 'done';
      session.output?.setAudioEnabled?.(true);
      session.input?.setAudioEnabled?.(true);
      session.generateReply({ instructions: 'The team member has left the call. Briefly ask the caller if there is anything else you can help with.' });
    });
    session.on(voice.AgentSessionEventTypes.Error, event => { if (callStatus !== 'transferred') callStatus = 'failed'; console.error('phone session error', { error: event.error?.message || String(event.error) }); });

    let finalized = false;
    async function finalize() {
      if (finalized) return;
      finalized = true;
      // After a warm transfer the team member is still on the line; end the call for them too.
      if (['briefing', 'bridged'].includes(handover.phase)) livekitApi.room.deleteRoom(ctx.room.name).catch(() => null);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      if (interimCaller && !savedTurnIds.has(interimCaller.id)) {
        const content = text(interimCaller.transcript, 24000);
        if (content) { transcriptEvents.user_interim_saved = 1; saveTurn({ role: 'user', content, id: interimCaller.id, createdAt: interimCaller.createdAt }); }
      }
      await writeQueue;
      const endedAt = new Date().toISOString();
      const seconds = billableVoiceSeconds(call.started_at, endedAt, call.connected_at);
      const transcript = settings.save_transcripts === false ? '' : renderCallTranscript([...turns].sort((a, b) => a.at.localeCompare(b.at)));
      const metrics = providerMetrics.snapshot();
      console.log('phone transcript events', { call: call.id, ...transcriptEvents, ...toolTurns, turns: turns.length });
      await serviceUpdate('automation_calls', `id=eq.${call.id}`, { status: callStatus, ended_at: endedAt, billable_seconds: isTest ? 0 : seconds, transcript, outcome: { ...call.outcome, duration_seconds: seconds, test: isTest, provider_usage: metrics, transcript_events: transcriptEvents, tool_turns: toolTurns } });
      await serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { status: callStatus === 'transferred' ? 'human_handling' : 'resolved', resolved_at: callStatus === 'transferred' ? null : endedAt, summary: transcript.slice(0, 8000) });
      if (seconds > 0) {
        // Charge once, at the end; if the balance ran short take what is left (never below zero).
        const charge = isTest ? { ok: true, charged: 0 } : await chargeCredits({ businessId: business.id, idempotencyKey: `usage:phone:${descriptor.providerCallId}`, kind: 'voice', credits: voiceCredits(seconds, perMinute), conversationId: conversation.id, reference: { call_id: call.id, seconds }, allowPartial: true }).catch(error => { console.error('phone credit charge failed', { message: error?.message }); return { ok: false, charged: 0 }; });
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
          metadata: { call_id: call.id, model: process.env.GEMINI_PHONE_MODEL || PHONE_MODEL, voice: callVoice, test: isTest, provider_usage: metrics }
        }, { ignoreDuplicates: true });
      }
    }
    ctx.addShutdownCallback(finalize);
    session.once(voice.AgentSessionEventTypes.Close, () => { finalize().catch(error => console.error('phone finalize failed', { message: error?.message })).finally(() => ctx.shutdown?.('call_ended')); });

    // The greeting comes first: until it has played, line noise or an early "hello" must not
    // reach the model, which would answer that instead of greeting (and could skip the greeting).
    if (!outOfCredits) session.input?.setAudioEnabled?.(false);
    await session.start({
      room: ctx.room,
      agent: voice.Agent.create({ instructions, tools: liveTools }),
      inputOptions: { participantIdentity: participant.identity, closeOnDisconnect: true },
      record: { audio: false, transcript: settings.save_transcripts !== false, traces: true, logs: true }
    });
    const hangUp = async () => { try { await livekitApi.room.deleteRoom(ctx.room.name); } finally { ctx.shutdown?.(isTest ? 'test_limit_reached' : 'out_of_credits'); } };
    if (outOfCredits) {
      callStatus = 'failed';
      const transferNumber = (settings.transfer_on === false ? '' : normalizePhoneNumber(settings.transfer_number));
      if (!isTest && transferNumber && participant.kind === ParticipantKind.SIP) {
        try { await livekitApi.sip.transferSipParticipant(ctx.room.name, participant.identity, `tel:${transferNumber}`, { playDialtone: false }); callStatus = 'transferred'; return; } catch (error) { console.error('out of credits transfer failed', { message: error?.message }); }
      }
      session.generateReply({ instructions: 'Say briefly and politely, in the caller\'s language if you can tell it, that nobody can take the call right now and they can send a message or call back later. Then say goodbye.' });
      later(() => hangUp().catch(error => console.error('phone hangup failed', { message: error?.message })), 12000);
      return;
    }
    if (Number.isFinite(maxSeconds)) {
      // Wrap up politely shortly before the credits run out, then end the call.
      later(() => session.generateReply({ instructions: isTest ? 'Briefly tell the caller this test is ending, and say goodbye.' : 'Politely tell the caller you need to end the call now, that the team will follow up, and say goodbye.' }), Math.max(0, maxSeconds - 20) * 1000);
      later(() => hangUp().catch(error => console.error('phone hangup failed', { message: error?.message })), maxSeconds * 1000);
    }
    const greeting = text(settings.greeting, 300) || firstMessageFor({ business, agent });
    const opening = isOutbound
      ? session.generateReply({ instructions: `The person you called has just answered. Greet them, say you are the AI assistant of ${business.name}, and say in one short sentence why you are calling: ${descriptor.purpose || 'to follow up'}. Then wait for their answer.` })
      : session.generateReply({ instructions: `Say this opening sentence exactly, then wait for the caller: ${greeting}` });
    // Listen once the greeting has played (or after 15 s at most, so a stalled greeting never leaves the call deaf).
    const listen = () => session.input?.setAudioEnabled?.(true);
    Promise.race([opening?.waitForPlayout?.() ?? Promise.resolve(), new Promise(resolve => later(resolve, 15000))]).then(listen, listen);
  }
});

cli.runApp(new ServerOptions({
  agent: fileURLToPath(import.meta.url),
  agentName: process.env.LIVEKIT_PHONE_AGENT_NAME || PHONE_AGENT_NAME
}));
