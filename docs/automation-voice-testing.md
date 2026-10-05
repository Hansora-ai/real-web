# Browser voice testing

Prepared locally on 2026-10-05. Gemini Live voice: **Leda**. Nothing deployed. No live call has been measured yet.

Every authenticated account has a **Let’s talk** card in its AI employee workspace.
Its circular animated AI and phone icon sit above a Call button. Click Call to use
the microphone; the button becomes Hang up. No navigation or number setup is
needed. The same call controller also supports the existing phone setup Test step
at `automation-phone.html?business=<id>&test=1`.
A saved employee and knowledge profile are required; a phone number, connected
channel and positive credit balance are not required. The server verifies ownership
before dispatching the worker, and the worker checks the owner and caller identity.

Browser tests do not deduct Hansora credits. Bookings, orders, leads and handoffs use
the existing tool runner's dry-run mode. Tests still consume Google and LiveKit
resources. Each test ends after five minutes by default. Set
`AUTOMATION_PHONE_TEST_MAX_SECONDS` in both server and worker environments to change
the limit (30–600 seconds). Normal incoming phone calls keep their paid credit logic.

The browser waits for the AI to join before showing Connected. If the AI does not
join within 20 seconds, it disconnects and releases the microphone. Ending a call
clears timers and disconnects. The worker saves provider token counts and model
first-audio-token times in `automation_calls.outcome.provider_usage` and usage-event
metadata. These timings are model metrics, not measured end-to-end caller latency.
Audio recordings are disabled; inbox transcripts follow the existing transcript
setting. Google billing remains the source of truth for actual provider charges.

## Configuration still needed

The existing Netlify project visibly has `GOOGLE_API_KEY`, `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. Only their presence was checked; no secret was revealed
and Gemini Live access was not exercised.

Add `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` to Netlify when ready.
The worker is a separate Node.js process: Netlify variables do not automatically
become worker variables. It needs the same three LiveKit values plus the existing
Google and Supabase values, supplied as environment variables. Use Node >=22.22.0.
No keys belong in Git, browser code or chat.

For an initial laptop test, install the worker dependencies and run:

```sh
node workers/automation-phone/src/worker.mjs dev
```

LiveKit must be configured and the updated web code must be served locally or
published with the owner's authorization before that browser path can reach the
worker. Fly, phone purchases and WhatsApp calling are not part of this preparation.

## Validation

Automated tests cover new-account access without a phone row or credits, cross-account
rejection, incomplete employee setup, free worker finalization, tool dry runs,
token metrics, test deadlines, browser waiting, missing-worker cleanup and retry.
The full existing Automation suite is run in an isolated copy of the previous work
checkout so unrelated uncommitted work is preserved.

After LiveKit is available, real calls must verify audio quality, microphone and
playback permissions, interruptions, languages, actual model access, tool behavior,
transcripts and billing. Those remain unverified until live testing.
