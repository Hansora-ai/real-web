import { EventEmitter } from "node:events";
import { GoogleGenAI, Modality } from "@google/genai";
import { diagnosticObservers, DIAGNOSTIC_TOPIC, toolDiagnostic } from '../../../lib/automation/phone-call-diagnostic.mjs';
import {
  AudioSource,
  AudioFrame,
  AudioStream,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
  RoomEvent,
} from "@livekit/rtc-node";

// Narrow owner-test transport. No SDK conversation recorder, transcript forwarding,
// instruction watchdog, or alternative recognition/TTS model is involved.
export class NativePhoneTestSession extends EventEmitter {
  constructor(
    options,
    dependencies = {
      GoogleGenAI,
      AudioSource,
      AudioFrame,
      AudioStream,
      LocalAudioTrack,
      TrackPublishOptions,
      TrackSource,
      RoomEvent,
    },
  ) {
    super();
    if (options.nativeTestOnly !== true && options.nativeVoice !== true)
      throw Error("native_transport_test_only");
    this.config = options;
    this.deps = dependencies;
    this.closed = false;
    this.output = Promise.resolve();
    this.epoch = 0;
    this.version = 0;
    this.audioVersion = 0; this.stateUpdates=Promise.resolve(); this.requestedState=undefined;
    this.readers = new Set();
    this.tracks = new Set();
    this.toolIds = new Set();
    this.cancelledToolIds = new Set();
    this.pendingTools = new Map();
    this.inputId = 0;
    this.hasInput = false;
    this.counts = {
      generations: 0,
      interrupted_replies: 0,
      tool_calls: 0,
      cancelled_tool_calls: 0,
      tool_errors: 0,
      audio_frames: 0,
    };
    this.lastInputAt = 0;
    this.firstAudioPending = false;
    this.delays = [];
    this.toolEvents = []; this.diagnosticSequence = 0;
    this.captionBuffers = new Map();
  }
  async start(options) {
    this.options = options;
    if (
      ["audio", "transcript", "traces", "logs"].some(
        (k) => options.record?.[k] !== false,
      )
    )
      throw Error("native_test_recording_disabled");
    this.room = options.room;
    this.identity = options.inputOptions.participantIdentity;
    if (
      this.config.nativeSyntheticCaptions &&
      (!this.room.name?.startsWith("hansora-private-address-") ||
        !this.identity?.startsWith("address-synthetic-"))
    )
      throw Error("synthetic_caption_room_required");
    this.source = new this.deps.AudioSource(24000, 1, 80);
    const opts = new this.deps.TrackPublishOptions();
    opts.source = this.deps.TrackSource.SOURCE_MICROPHONE;
    await this.room.localParticipant.publishTrack(
      this.deps.LocalAudioTrack.createAudioTrack("gemini-native", this.source),
      opts,
    );
    const n = this.config.nativeOptions;
    try {this.provider = await new this.deps.GoogleGenAI({
      apiKey: n.apiKey,
    }).live.connect({
      model: n.model,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: n.instructions,
        temperature: 0.5,
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: n.voice } },
        },
        inputAudioTranscription: n.inputAudioTranscription || {},
        outputAudioTranscription: {},
        realtimeInputConfig: n.realtimeInputConfig,
        tools: [
          {
            functionDeclarations: n.definitions.map((d) => ({
              name: d.name,
              description: d.description,
              parametersJsonSchema: d.parameters,
              behavior: "NON_BLOCKING",
            })),
          },
        ],
      },
      callbacks: {
        onmessage: (m) => {
          void this.receive(m).catch(() => this.fail("native_message_error"));
        },
        onerror: () => this.fail("native_provider_error"),
        onclose: () => {
          if (!this.closed) void this.end();
        },
      },
    });
    } catch {this.fail('native_connect_error');throw new Error('native_connect_error');}
    this.onTrack = (track, publication, participant) => {
      if (participant.identity === this.identity) this.attach(track);
    };
    this.onParticipant = (participant) => {
      if (participant.identity === this.identity) void this.end();
    };
    this.room.on(this.deps.RoomEvent.TrackSubscribed, this.onTrack);
    this.room.on(
      this.deps.RoomEvent.ParticipantDisconnected,
      this.onParticipant,
    );
    for (const participant of this.room.remoteParticipants.values())
      if (participant.identity === this.identity)
        for (const publication of participant.trackPublications.values())
          if (publication.track) this.attach(publication.track);
    await this.state("listening");
  }
  state(value) {
    if(value===this.requestedState)return this.stateUpdates;
    this.requestedState=value;
    this.stateUpdates=this.stateUpdates.then(async()=>{if(!this.closed)await this.room?.localParticipant.setAttributes({'lk.agent.state':value});}).catch(()=>{});
    return this.stateUpdates;
  }
  audioDrained(version, epoch) {
    if (this.closed || version !== this.audioVersion || epoch !== this.epoch) return;
    clearTimeout(this.playoutTimer);
    const delay = Math.max(0, Number(this.source.queuedDuration) || 0) + 200;
    this.playoutTimer = setTimeout(() => {
      if (this.closed || version !== this.audioVersion || epoch !== this.epoch || this.requestedState !== 'speaking') return;
      if (Number(this.source.queuedDuration) > 0) { this.audioDrained(version, epoch); return; }
      // Some nonblocking replies send their completion marker before a final
      // audio packet. Release only the UI state after actual local audio drain;
      // this never clears audio, cancels generation, or ends the caller's turn.
      void this.state('listening');
    }, delay);
  }
  attach(track) {
    if (track.kind !== 1 || this.tracks.has(track.sid) || this.closed) return;
    this.tracks.add(track.sid);
    const reader = new this.deps.AudioStream(track, {
      sampleRate: 16000,
      numChannels: 1,
      frameSizeMs: 20,
    }).getReader();
    this.readers.add(reader);
    void (async () => {
      try {
        while (!this.closed) {
          const item = await reader.read();
          if (item.done || this.closed) break;
          const f = item.value;
          let energy = 0;
          for (const sample of f.data) energy += sample * sample;
          if (Math.sqrt(energy / f.data.length) > 300) {
            this.lastInputAt = Date.now();
            this.firstAudioPending = true;
          }
          this.provider.sendRealtimeInput({
            audio: {
              mimeType: "audio/pcm;rate=16000",
              data: Buffer.from(
                f.data.buffer,
                f.data.byteOffset,
                f.data.byteLength,
              ).toString("base64"),
            },
          });
        }
      } catch {
        if (!this.closed) this.fail("native_input_error");
      } finally {
        reader.releaseLock();
        this.readers.delete(reader);
      }
    })();
  }
  caption(text, role) {
    if (this.config.nativeOptions.createConversationItem) {
      const key = role === 'caller' ? 'user' : 'assistant';
      const buffer = this.captionBuffers.get(key) || { text: '', createdAt: Date.now() };
      buffer.text += text;
      this.captionBuffers.set(key, buffer);
    }
    this.diagnostic({kind:'caption',role,text,turn:this.inputId});
    if (this.config.nativeSyntheticCaptions)
      void this.room.localParticipant
        .sendText(text, {
          topic: "lk.transcription",
          attributes: { synthetic_role: role },
        })
        .catch(() => {});
  }
  flushCaptions({ assistantOnly = false, interrupted = false } = {}) {
    const create = this.config.nativeOptions.createConversationItem;
    if (!create) return;
    for (const role of ['user', 'assistant']) {
      if (assistantOnly && role !== 'assistant') continue;
      const value = this.captionBuffers.get(role);
      if (!value) continue;
      this.captionBuffers.delete(role);
      if (!value.text.trim()) continue;
      this.emit(this.config.nativeEvents.ConversationItemAdded, {
        item: create({role, content:[value.text], createdAt:value.createdAt, interrupted:role === 'assistant' && interrupted})
      });
    }
  }
  diagnostic(event) {
    const recipients = diagnosticObservers(this.room, this.config.nativeOptions.diagnosticOwner);
    if (!recipients.length || this.closed) return;
    const data = {...event,sequence:++this.diagnosticSequence,at:Date.now()};
    void this.room.localParticipant.sendText(JSON.stringify(data), {
      topic:DIAGNOSTIC_TOPIC,destinationIdentities:recipients,
    }).catch(()=>{});
  }
  cancelEnd(reason) {
    if (!this.pendingEnd) return;
    clearTimeout(this.endTimer);clearTimeout(this.endDeadline);
    this.pendingEnd=null;this.diagnostic({kind:'end_cancelled',reason});
  }
  armEnd() {
    const pending=this.pendingEnd;
    if(!pending || this.closed || !pending.completed || this.audioVersion<=pending.audioVersion)return;
    const version=this.audioVersion;
    clearTimeout(this.endTimer);
    this.endTimer=setTimeout(async()=>{
      if(this.closed||this.pendingEnd!==pending||version!==this.audioVersion)return;
      await this.output;await this.source.waitForPlayout();
      if(this.closed||this.pendingEnd!==pending||version!==this.audioVersion)return;
      // Wait for the final local playout, never clear or cut its audio.
      if(Number(this.source.queuedDuration)>0){this.armEnd();return;}
      clearTimeout(this.endDeadline);this.pendingEnd=null;
      this.diagnostic({kind:'call_ending'});
      try {await this.config.nativeOptions.endCall();}
      catch {this.diagnostic({kind:'end_failed'});}
    },350);
  }
  requestEnd() {
    if(this.pendingEnd)return;
    this.pendingEnd={audioVersion:this.audioVersion,requestedAt:Date.now(),completed:false};
    this.endDeadline=setTimeout(()=>this.cancelEnd('no_goodbye_completion'),20_000);
  }
  async receive(message) {
    if (this.closed) return;
    for (const id of message.toolCallCancellation?.ids || []) {
      this.cancelledToolIds.add(id);
      this.pendingTools.get(id)?.abort();
    }
    const sc = message.serverContent;
    const memory = this.config.nativeOptions.addressMemory;
    if (sc?.inputTranscription?.text) {
      if (!this.hasInput) {
        this.inputId++;
        this.hasInput = true;
      }
      memory?.inputCompleted({
        itemId: String(this.inputId),
        transcript: sc.inputTranscription.text,
      });
      this.caption(sc.inputTranscription.text, "caller");
      if(this.pendingEnd && this.lastInputAt>this.pendingEnd.requestedAt+200)this.cancelEnd('caller_continued');
    }
    if (message.usageMetadata) {
      const u = message.usageMetadata;
      const count =
        (modality) =>
        (values = []) =>
          values
            .filter((v) => v.modality === modality)
            .reduce((sum, v) => sum + (Number(v.tokenCount) || 0), 0);
      this.emit(this.config.nativeEvents.MetricsCollected, {
        metrics: {
          type: "realtime_model_metrics",
          requestId: "native-" + this.counts.generations + "-" + this.inputId,
          inputTokens: u.promptTokenCount,
          outputTokens: u.responseTokenCount,
          inputTokenDetails: {
            audioTokens: count("AUDIO")(u.promptTokensDetails),
            textTokens: count("TEXT")(u.promptTokensDetails),
          },
          outputTokenDetails: {
            audioTokens: count("AUDIO")(u.responseTokensDetails),
            textTokens: count("TEXT")(u.responseTokensDetails),
          },
          reasoningTokens: u.thoughtsTokenCount,
        },
      });
    }
    if (sc?.outputTranscription?.text)
      this.caption(sc.outputTranscription.text, "assistant");
    if (sc?.interrupted) {
      this.flushCaptions({assistantOnly:true,interrupted:true});
      this.epoch++;this.audioVersion++;
      this.source.clearQueue();
      this.counts.interrupted_replies++;
      void this.state("listening");
    }
    for (const part of sc?.modelTurn?.parts || [])
      if (part.inlineData?.data) {
        this.version++;this.audioVersion++;
        this.counts.audio_frames++;
        void this.state("speaking");
        if (this.firstAudioPending && this.lastInputAt) {
          this.delays.push(Date.now() - this.lastInputAt);
          this.firstAudioPending = false;
        }
        const epoch = this.epoch;
        const audioVersion = this.audioVersion;
        const bytes = Buffer.from(part.inlineData.data, "base64");
        const data = new Int16Array(
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
        );
        this.output = this.output
          .then(async () => {
            for (let i = 0; i < data.length; i += 480) {
              if (this.closed || epoch !== this.epoch) return;
              const frame = data.slice(i, Math.min(data.length, i + 480));
              await this.source.captureFrame(
                new this.deps.AudioFrame(frame, 24000, 1, frame.length),
              );
            }
          })
          .catch(() => {
            if (!this.closed) this.fail("native_output_error");
          });
        void this.output.then(() => this.audioDrained(audioVersion, epoch));
        if(this.pendingEnd)void this.output.then(()=>this.armEnd());
      }
    if (sc?.turnComplete || sc?.generationComplete) {
      if (sc.turnComplete) this.flushCaptions();
      if(sc?.turnComplete)this.counts.generations++;
      this.hasInput = false;
      if(this.pendingEnd && this.audioVersion>this.pendingEnd.audioVersion){this.pendingEnd.completed=true;this.armEnd();}
      const version = this.audioVersion;
      void this.output
        .then(() => this.source.waitForPlayout())
        .then(() => {
          if (!this.closed && version === this.audioVersion)
            void this.state("listening");
        })
        .catch(() => {});
    }
    for (const fc of message.toolCall?.functionCalls || []) {
      if (this.closed || !fc.id || this.toolIds.has(fc.id) || this.cancelledToolIds.has(fc.id)) continue;
      this.toolIds.add(fc.id);
      this.version++;
      this.counts.tool_calls++;
      void this.state("thinking");
      this.provider.sendToolResponse({
        functionResponses: [
          {
            id: fc.id,
            name: fc.name,
            response: {},
            willContinue: true,
            scheduling: "SILENT",
          },
        ],
      });
      const declared = this.config.nativeOptions.definitions.some(
        (d) => d.name === fc.name,
      );
      const invocation=this.counts.tool_calls;
      const started={kind:'tool_call',invocation,turn:this.inputId,...toolDiagnostic(declared?fc.name:'unknown_tool',fc.args)};
      const submittedPhone=fc.name==='create_order'&&declared ? (fc.args?.phone_number ?? fc.args?.customer_phone) : undefined;
      this.diagnostic({...started,...(typeof submittedPhone==='string'?{submitted_phone:submittedPhone.slice(0,100)}:{})});
      this.toolEvents.push({...started,at:Date.now()});this.toolEvents=this.toolEvents.slice(-24);
      let result;
      const controller = new AbortController();
      this.pendingTools.set(fc.id, controller);
      try {result = declared
        ? await this.config.nativeOptions.execute(fc.name, fc.args, {
            waitForPlayout: () => this.source.waitForPlayout(),
            signal: controller.signal,
          })
        : { ok: false, error: "unknown_tool" };
      } catch {
        this.counts.tool_errors++;
        result = { ok: false, error: 'execution_failed' };
      } finally {
        this.pendingTools.delete(fc.id);
      }
      const finished={kind:'tool_result',invocation,turn:this.inputId,...toolDiagnostic(declared?fc.name:'unknown_tool',fc.args,result)};
      this.diagnostic(finished);this.toolEvents.push({...finished,at:Date.now()});this.toolEvents=this.toolEvents.slice(-24);
      // Cancellation withdraws this response, not any business action already
      // committed. Never guess at undoing an order or feed a cancelled lookup
      // back into a conversation that the caller has moved on from.
      if (this.closed || this.cancelledToolIds.has(fc.id)) {
        this.counts.cancelled_tool_calls++;
        continue;
      }
      if(fc.name==='end_call'&&declared&&result?.ok&&this.config.nativeOptions.endCall)this.requestEnd();
      if (!this.closed)
        this.provider.sendToolResponse({
          functionResponses: [
            {
              id: fc.id,
              name: fc.name,
              response: { output: result },
              willContinue: false,
              scheduling:
                ["remember_delivery_address", "spell_delivery_street"].includes(fc.name)
                  ? "INTERRUPT"
                  : "WHEN_IDLE",
            },
          ],
        });
    }
  }
  generateReply({ instructions }) {
    if (!this.closed)
      this.provider.sendClientContent({
        turns: [{ role: "model", parts: [{ text: instructions }] }],
        turnComplete: true,
      });
  }
  interrupt() {
    this.epoch++;
    this.source?.clearQueue();
    return { await: Promise.resolve() };
  }
  snapshot() {
    return {
      ...this.counts,
      input_level_to_received_audio_ms: [...this.delays],
      transport: "native_livekit_test",
      recording: false,
      tool_events: this.toolEvents.map(event=>({...event})),
    };
  }
  fail(code) {
    if (this.closed) return;
    this.emit(this.config.nativeEvents.Error, { error: new Error(code) });
    void this.end();
  }
  async dispose() {
    if (this.disposal) return this.disposal;
    this.closed = true;
    this.flushCaptions();
    clearTimeout(this.playoutTimer);
    clearTimeout(this.endTimer);clearTimeout(this.endDeadline);this.pendingEnd=null;
    this.epoch++;
    for (const controller of this.pendingTools.values()) controller.abort();
    this.provider?.close();
    if (this.onTrack)
      this.room?.off(this.deps.RoomEvent.TrackSubscribed, this.onTrack);
    if (this.onParticipant)
      this.room?.off(
        this.deps.RoomEvent.ParticipantDisconnected,
        this.onParticipant,
      );
    this.disposal = (async () => {
      await Promise.allSettled([...this.readers].map((r) => r.cancel()));
      this.source?.clearQueue();
      await this.output;
      await this.source?.close();
      this.readers.clear();
      this.toolIds.clear();
      this.pendingTools.clear();
      this.cancelledToolIds.clear();
    })();
    return this.disposal;
  }
  async end() {
    if (this.ended) return;
    this.ended = true;
    await this.dispose();
    this.emit(this.config.nativeEvents.Close);
  }
}
