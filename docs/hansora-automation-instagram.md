# Hansora Automation: Instagram DM and comment automation

This implementation connects one Instagram professional account to one Hansora Automation business. Incoming text DMs are stored, answered by the business's ElevenLabs agent, sent back through Instagram, and recorded in the usage ledger. Comment automations can watch every post, selected posts, or the next new post; match any comment, contained keywords, or an exact phrase; rotate public replies; and send a private opening message with quick replies or website links. A team member can pause the AI, take over, reply, and resume automation from the inbox.

## Required environment variables

Set these in the Netlify site environment. Never put their values in browser code or commit them to Git.

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ELEVENLABS_API_KEY
META_INSTAGRAM_APP_ID
META_INSTAGRAM_APP_SECRET
META_INSTAGRAM_REDIRECT_URI
META_WEBHOOK_VERIFY_TOKEN
HANSORA_AUTOMATION_OAUTH_SECRET
HANSORA_AUTOMATION_ENCRYPTION_KEY
HANSORA_AUTOMATION_INTERNAL_SECRET
```

Optional:

```text
META_GRAPH_VERSION=v23.0
ELEVENLABS_AGENT_LLM=gemini-2.5-flash
HANSORA_AUTOMATION_PROVIDER=elevenlabs
```

Use the deployed callback URL for `META_INSTAGRAM_REDIRECT_URI`:

```text
https://YOUR_DOMAIN/.netlify/functions/automation-meta-callback
```

Generate independent random values for the OAuth, webhook verification, and internal secrets. `HANSORA_AUTOMATION_ENCRYPTION_KEY` must be a 32-byte key encoded as base64 or 64 hexadecimal characters.

## Database

Apply the migrations in this order:

1. `supabase/migrations/20260927_automation_core.sql`
2. `supabase/migrations/20260927_automation_runtime.sql`

The runtime migration keeps provider access tokens in a service-role-only table and encrypts the token value before storage. User-facing tables use row-level security tied to the business owner.

## Meta app

In the Meta developer app:

1. Add Instagram API with Instagram Login.
2. Add the exact redirect URI shown above.
3. Request these permissions: `instagram_business_basic`, `instagram_business_manage_messages`, and `instagram_business_manage_comments`.
4. Subscribe the Instagram webhook to both `messages` and `messaging_postbacks`; connected flow buttons arrive through the postback field.
5. Configure the webhook callback as:

   ```text
   https://YOUR_DOMAIN/.netlify/functions/automation-meta-webhook
   ```

6. Enter the same value used for `META_WEBHOOK_VERIFY_TOKEN`.
7. Subscribe the Instagram webhook to comments events as well.
8. During development, add the Instagram professional account as an app tester. Before public use, complete Meta App Review and switch the app to Live.

## Runtime flow

1. The owner opens the Instagram connection wizard and selects **Continue with Meta**.
2. Hansora creates a signed, ten-minute, single-use OAuth state tied to the owner and business.
3. The callback exchanges the code, encrypts the long-lived access token, records the Instagram account, and leaves the channels in `connecting` state.
4. The owner reviews the reply settings and saves the connection. Only this final step changes Instagram DMs to `connected`, so authorization alone cannot start customer replies. The comments channel stays `connecting` until a comment workflow is activated.
5. Meta sends DM events to the webhook. Hansora validates `X-Hub-Signature-256` before accepting them.
6. A background function stores the inbound message, loads recent conversation context, asks the synchronized ElevenLabs agent for a response, sends the reply through Instagram, and records one billable AI-message event.
7. The inbox shows the real conversation. A human reply is sent through the same Instagram account and is marked nonbillable.

## Comment-to-DM flow

1. The owner opens the visual comment flow builder and chooses a post scope and comment rule.
2. **Specific posts** loads the connected account's real media through an authenticated server function; the Meta access token never reaches the browser.
3. Drafts may be incomplete. **Set live** validates the trigger and opening Instagram message, saves an activation time, and activates the comments connection.
4. Meta comment webhooks are signature checked and deduplicated before background processing.
5. The worker ignores excluded text and the business's own comments, applies the post and keyword rules, and enforces the first-comment-per-person setting.
6. It can rotate a public reply and send one private opening reply to the comment. Website actions are included as labeled HTTPS links; quick reply and handoff actions are sent as Instagram quick replies.
7. The public comment and private opening template are stored as nonbillable activity. When the customer replies, the DM conversation continues through the ElevenLabs agent and every generated AI reply is recorded in the billable usage ledger.
8. A durable flow session remembers the customer's current block. Conditions wait for a matching reply, message blocks send nonbillable templates, delay blocks create scheduled jobs, AI blocks activate the ElevenLabs conversation, and handoff blocks pause automation for the team.

## Functions

- `automation-meta-start`: authenticated OAuth start
- `automation-meta-callback`: OAuth callback and encrypted token storage
- `automation-meta-webhook`: verification, signature validation, and event ingestion
- `automation-instagram-process-background`: AI generation and Instagram delivery
- `automation-instagram-media`: authenticated post and reel picker data
- `automation-instagram-comment-process-background`: rule matching, public replies, private replies, and comment execution records
- `automation-flow-jobs`: scheduled continuation of due delay blocks
- `automation-conversation-reply`: authenticated human reply
- `automation-test-chat`: authenticated live test through the real ElevenLabs agent

## Pre-production check

After the migrations and environment values are installed, verify the following on a Meta test account:

1. Connect Instagram from a real Hansora business.
2. Send a DM from another Instagram account.
3. Confirm one inbound message, one AI reply, and one usage event in Supabase.
4. Pause AI in the inbox, send a human reply, and confirm that it is not counted as billable.
5. Reconnect a second Instagram account and confirm the first provider resource becomes revoked.
6. Activate a comment flow on a test post, comment from a different account, and confirm exactly one public reply and one private opening message.
7. Reply to the opening message and confirm that only the generated AI answer is billable.
