# Hansora Automation: phone calls

The phone channel uses one long-running LiveKit Agents worker. It accepts browser microphone tests and inbound SIP
calls, streams native audio to Gemini 3.8 Live with the Laomedeia voice, and runs the same business-scoped booking,
order, lead and handoff tools used by Instagram and WhatsApp.

## Components

- `workers/automation-phone/src/worker.mjs`: the long-running agent; do not deploy this as a Netlify function.
- `netlify/functions/automation-phone-token.mjs`: authenticates the Hansora owner, creates an explicit agent dispatch,
  and returns a ten-minute, room-scoped browser token.
- `public/automation-phone.html` and `.js`: saves the phone rules and starts a real microphone test when keys exist.
- `lib/automation/phone.mjs`: routing, instruction, transcript and billing helpers.
- `automation_provider_resources`: maps each dialed E.164 number to one business.

## Environment

Add these to Netlify for the browser token endpoint:

```text
LIVEKIT_URL=wss://YOUR_PROJECT.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_PHONE_AGENT_NAME=hansora-phone-agent
```

The worker needs the same values plus:

```text
GOOGLE_API_KEY=
GEMINI_PHONE_MODEL=gemini-3.8-live
GEMINI_PHONE_VOICE=Laomedeia
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
HANSORA_AUTOMATION_ENCRYPTION_KEY=
AUTOMATION_PHONE_COST_MINOR_PER_MINUTE=0
LIVEKIT_TRANSFER_RINGING_TIMEOUT=25
LIVEKIT_TRANSFER_REQUEST_TIMEOUT=35
```

`AUTOMATION_PHONE_COST_MINOR_PER_MINUTE` is Hansora's internal estimated provider cost in minor AMD units. Test calls
record their duration but always have zero billable seconds and zero estimated cost.

## Run the worker

The included Dockerfile expects the repository root as its build context:

```sh
docker build -f workers/automation-phone/Dockerfile -t hansora-phone .
docker run --env-file workers/automation-phone/.env hansora-phone
```

The worker uses explicit dispatch under `hansora-phone-agent`. It runs continuously and cannot use a request-based
serverless host. Fly.io, LiveKit Cloud Agents, Render background workers, or another container host are suitable.

## Inbound SIP routing

1. Obtain an Armenian phone number from a SIP provider that can route the number to LiveKit. Transfer requires the
   provider trunk to support SIP REFER.
2. Create the LiveKit inbound trunk and a reusable dispatch rule whose room config dispatches
   `hansora-phone-agent` to each call room.
3. For the assigned number, create one active `automation_provider_resources` row:

```text
provider              livekit
resource_type         phone_number
provider_resource_id  +374XXXXXXXX
business_id           the Hansora automation business UUID
safe_config           {"e164":"+374XXXXXXXX","trunk_id":"ST_...","dispatch_rule_id":"SDR_..."}
status                active
```

The worker reads `sip.trunkPhoneNumber`, resolves this row, and loads that business's published knowledge and phone
settings. It reads the caller from `sip.phoneNumber`. Keep phone-number hiding disabled on the dispatch rule if caller
callback is required.

## Transfer and callback behavior

When the caller asks for a person, the agent first says it will transfer them and then uses LiveKit SIP REFER with the
saved `transfer_number`. A successful transfer ends the AI call. If the line is missing, does not answer, or rejects
the transfer, Hansora saves a `Callback request` lead, pauses the conversation, and sends the owner's configured
handoff notification once.

## Stored records

- Every call creates `automation_calls` with direction, status, timestamps, transcript and billable seconds.
- Final user and assistant turns are written to `automation_messages` and appear in the unified inbox when transcript
  saving is enabled.
- One idempotent `automation_usage_events` row stores `voice_second` quantity for the call. Browser tests are free.
- Real phone tools write bookings, orders and leads through `createToolRunner`; browser tests use dry-run tools.

## Final verification

After the existing migrations and environment values are applied:

1. Start the worker and confirm it registers as `hansora-phone-agent`.
2. Open the phone page on the deployed authenticated site, allow microphone access, and verify two-way audio plus
   live transcript. A `file://` or `?preview=1` page intentionally shows a scripted preview because it has no session.
3. Call the Armenian number and verify the worker selects the business from `sip.trunkPhoneNumber`.
4. Test a booking, an order, a successful transfer, and a timed-out transfer that creates one callback notification.
5. Confirm the call, messages and voice seconds appear in Inbox and Usage.

No live call has been made yet because the LiveKit, Google and SIP credentials have not been added.
