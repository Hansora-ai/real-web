# Hansora Automation — handoff (state on 2026-10-05)

Read this first. It says what is built, how the project is run, the rules the owner set, and exactly how to continue
(next: **phone calls** — test call quality in the website, then real numbers).

---

## 1. What Hansora Automation is

A separate product inside hansora.co (`/automation*` pages): a business creates an **AI employee** (business info,
knowledge, rules), connects channels, and the AI answers customers, takes orders/bookings/leads and hands chats to a
person when needed. Billing uses the shared Hansora credits (profiles.credits; the site shows ×10 as ⚡; 1 AI reply = 1⚡).

| Channel | State |
|---|---|
| Instagram DMs | ✅ live, tested a lot (text, voice, photos, videos, shared posts, own reels) |
| Instagram comments | ✅ ManyChat-style automation builder (flows, buttons, delays, conditions, follow-ups) |
| WhatsApp (Cloud API + coexistence with the WhatsApp Business app) | ✅ built; waiting for Meta App Review |
| Telegram (Telegram Business, one Hansora bot `@HansoraAssistant_bot`) | ✅ built; owner needs **Telegram Premium** (checked at Start) |
| Facebook Messenger (Page, Facebook Login for Business) | ✅ built; **not set up / not tested yet** (see §6) |
| TikTok | ❌ not built — Business Messaging API is partner/beta and region-limited; apply first |
| **Phone calls** | 🟡 code exists (LiveKit + Gemini Live), **never deployed or tested** → next work (§7) |

Meta App Review for **Instagram** (instagram_business_basic, _manage_messages, _manage_comments) was submitted
2026-10-01 and is **in review**. Only one review per app at a time: after it is decided, submit **WhatsApp + Messenger
together**. Keep the "ai" comment automation and its reel live until Instagram is approved. Never tell anyone to remove
Hansora under Instagram "Apps and websites" (it triggers the data-deletion callback and wipes that account's chats).

---

## 2. Where the code is and how work is shipped

- Repo: `Hansora-ai/real-web` (Netlify site hansora.co, Supabase project, schema **`automation`**).
- Local: main checkout `~/Documents/Codex/2026-09-27/files-pasted-by-the-user-i/work/real-web`, worktree used for
  releases `.../deploy/hansora-automation-release`. The **full test suite** (≈166 tests) lives in
  `work/real-web/test/automation/`; the repo's `test/automation/` has part of it. Copy changed files to the work copy and
  run `node --test test/automation/*.test.mjs`.
- **Shipping:** branch from latest `origin/main` → commit → push → open the PR yourself via the GitHub API as
  **non-draft** (the owner's GitHub button makes drafts and "Ready for review" fails) → give the owner the
  `https://github.com/Hansora-ai/real-web/pull/<n>` link → **the owner merges**. Never push to main.
- **The owner merges fast.** Never push follow-up commits to a PR after saying "merge it" — they get lost (happened
  twice). Make a new branch/PR, and check `git merge-base --is-ancestor <commit> origin/main` for older work.
- SQL is run by the owner in the Supabase SQL editor. Files: `supabase/10…13_*.sql` (+ older migrations in
  `work/real-web/supabase/migrations/`). Write SQL that is safe to run twice and **extends** check constraints (read the
  existing values, add, never replace). Postgres shows a one-value `in (...)` as `x = 'v'` (not `= ANY`).
- Secrets go into Netlify environment variables by the owner — never into chat, never ask for passwords. Customers
  never paste tokens.

## 3. Rules the owner cares about (follow them)

- **Plan first, then build carefully; don't rush.** Verify with real data/logs before "fixing". Say what is proven and
  what is only expected. Big design changes: propose, let the owner choose, then build.
- **Every business type, every country.** No Armenian/AMD/+374 examples or defaults in the UI (currency is chosen once,
  then reused; never assumed). Language support (hy/ru/en) is fine.
- **Test the real page path**, not only `?preview=1` (preview uses sample data; an inbox crash shipped because of
  that). In the browser you can `eval` the page script with a stubbed `window.HansoraAutomation` (`isLocalPreview:false`,
  fake `db.from()` chain).
- The AI must never be pushy: goal-aware (help to order/book/leave contact), one next step only when it helps, never
  repeat a declined offer, never invent discounts/urgency.
- Replies must be fast: nothing may add waiting before the AI answers (a 5-second wait was rejected).

## 4. Main building blocks (files)

`lib/automation/`
- `provider.mjs`, `providers/elevenlabs.mjs` — text AI = **ElevenLabs agents** (text-only WebSocket, client tools,
  `gemini-3.5-flash-lite`, max_tokens 2000). Agents re-sync automatically when the rules hash changes
  (`agent-sync.mjs`, `AGENT_SETTINGS_VERSION`). A reply ends on ElevenLabs' `agent_response_complete` event (enabled on
  every agent by adding it to the existing `client_events`), fallback timers otherwise.
- `instructions.mjs` (persona, language rules), `tools.mjs` (actions: bookings, orders, leads, handoff,
  `search_products`, `send_product_photos`; `goalInstructions`), `availability.mjs`, `google-calendar.mjs`.
- `turns.mjs` — one answer per customer turn: older message steps aside if a newer one exists (checked right before
  sending), waits up to 60 s for a photo/video of the same turn, burst note for several quick messages.
- `media.mjs` — voice → ElevenLabs Scribe; photos/videos → Gemini (videos 120 s limit, >18 MB via Gemini file upload);
  private bucket `automation-media`, 30-day cleanup (never touches `/products/`); `mediaFallback` when it can't open.
- `meta.mjs` (Instagram), `whatsapp.mjs`, `telegram.mjs`, `messenger.mjs` — channel APIs. Instagram shared reels arrive
  only as page link + caption + `reel_video_id`; own reels are found via `me/media` permalink match; other accounts'
  reels → handoff (owner's text from Business tools → Handoff, chat "Needs you").
- Owner typing in the Instagram app = echo with an id Hansora didn't save → AI paused in that chat until "Resume AI"
  (`automation-instagram-echo-background.mjs`). WhatsApp/Telegram/Messenger phone replies also pause until resumed.
- `catalog.mjs`, `xlsx.mjs`, `product-match.mjs`, `product-photos.mjs` — Products: variants (+colour), stock (goes down
  when an order is placed, back on cancel), photos, payment link per product, Excel/CSV import, Google Sheets and
  OneDrive/SharePoint Excel hourly sync, photo/video → exact product match.
- `sales-stage.mjs` — after each reply (background) Gemini Flash-Lite sets the chat stage new/interested/ready/done/lost
  + interest + value (needs SQL 13). Inbox shows stage tabs.
- `schedule.mjs` — scheduled jobs accept Netlify's `next_run` body (header not guaranteed).
- `phone.mjs` + `workers/automation-phone/` — see §7.

Scheduled functions (netlify.toml): flow jobs (every minute), media cleanup (03:20), catalog sync (hourly :07),
knowledge link refresh (04:40).

Pages: `public/automation-*.html/js/css` (dashboard, setup, agent, connect, comments/workflows, inbox, operations
(orders & bookings), products, tools (Business tools), usage, phone, pricing, profile, legal).

## 5. Environment variables (Netlify)

Core: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `HANSORA_AUTOMATION_INTERNAL_SECRET`, `HANSORA_AUTOMATION_ENCRYPTION_KEY`,
`ELEVENLABS_API_KEY`, `GOOGLE_API_KEY` (Gemini), `RESEND_API_KEY`, `AUTOMATION_NOTIFY_FROM_EMAIL`,
`HANSORA_NOTIFY_WA_ACCESS_TOKEN`, `HANSORA_NOTIFY_WA_PHONE_NUMBER_ID`.
Meta: `META_INSTAGRAM_APP_ID/SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_WHATSAPP_APP_SECRET`,
`META_WHATSAPP_CONFIGURATION_ID`, `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `META_MESSENGER_CONFIGURATION_ID` (not set yet),
`META_GRAPH_VERSION`. Telegram: `TELEGRAM_BOT_TOKEN`. Optional: `ELEVENLABS_AGENT_LLM`, `GEMINI_MEDIA_MODEL`,
`GEMINI_TEXT_MODEL`, `AUTOMATION_MEDIA_RETENTION_DAYS`, `AUTOMATION_PHONE_PAUSE_HOURS`.
Phone (not set yet): `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_PHONE_AGENT_NAME`,
`GEMINI_PHONE_MODEL`, `GEMINI_PHONE_VOICE`, `LIVEKIT_TRANSFER_RINGING_TIMEOUT`, `AUTOMATION_PHONE_COST_MINOR_PER_MINUTE`.

## 6. Open items besides phone

- SQL **13** (`13_automation_sales_stage.sql`) — confirm the owner ran it (inbox stage tabs appear only after).
- **Messenger setup** (when preparing the WhatsApp+Messenger review): Meta app → add use case "Engage with customers on
  Messenger"; permissions `pages_messaging`, `pages_show_list`, `pages_manage_metadata`; Page webhook →
  `/.netlify/functions/automation-messenger-webhook` (messages, messaging_postbacks, message_echoes); Facebook Login for
  Business configuration (User access token) → `META_MESSENGER_CONFIGURATION_ID`; test with app testers.
- WhatsApp review prep: a "Create template" page in Hansora is still needed for the review video.
- TikTok: write the Business Messaging API application; build only if approved for the region.
- Optional ideas not built: 🔥 "ready but went quiet" alert, one gentle follow-up.

---

## 7. NEXT: phone calls

### What exists (built by Codex on 2026-09-29, never deployed)
- `workers/automation-phone/src/worker.mjs` — LiveKit Agents worker (`@livekit/agents` 1.9.1 + Google plugin):
  **Gemini Live** speech-to-speech, model `PHONE_MODEL = 'gemini-3.8-live'`, voice `Laomedeia` (`lib/automation/phone.mjs`).
  Loads the business by the called number (`automation_provider_resources` provider `livekit`, resource_type
  `phone_number`), same instructions + actions as chat (bookings/orders/leads), transfer to a person via
  `sip.transferSipParticipant` (REFER) with callback-request fallback, transcript saved to the inbox, billing per
  connected minute (credits), test calls not billed. `Dockerfile` included (meant for Fly.io).
- `netlify/functions/automation-phone-token.mjs` — creates a LiveKit room + token + agent dispatch so the owner can make
  a **test call from the browser** (microphone) on `automation-phone.html` → "Try it". `public/vendor/livekit-client.umd.js`.
- `automation-phone.html/js` — steps: Number (new number / forward your own), Voice, Rules (every call / after hours /
  if nobody picks up, transfer number, save transcripts), Test.

### Decisions already made (don't re-open unless prices change)
- Stay on **LiveKit + Gemini Live** (~$0.045/min all-in vs price 8⚡ ≈ $0.08/min). ElevenLabs/Retell phone agents were
  rejected (too expensive).
- Numbers: **Armenia** through an Armenian operator SIP trunk (Telnyx has no Armenian numbers); **other countries**
  through Telnyx (or another SIP provider) later.
- WhatsApp-only calling is not a replacement for real numbers.

### Step-by-step plan
1. **Infrastructure (owner creates accounts, puts keys in Netlify/Fly secrets):** LiveKit Cloud project (URL, API key,
   secret) and Fly.io app for the worker (needs `SUPABASE_*`, `GOOGLE_API_KEY`, `LIVEKIT_*`, `HANSORA_AUTOMATION_*`).
   Check the worker builds on Node ≥ 22 and the Gemini Live model/voice names still exist (Google renames models; keep
   env overrides `GEMINI_PHONE_MODEL/VOICE`).
2. **Browser test calls first (no numbers needed):** deploy the worker, set `LIVEKIT_*` in Netlify, open
   `automation-phone.html` → Try it. Measure and log: time to first word, interruption handling (barge-in), Armenian /
   Russian / English quality and switching, numbers and prices read aloud, tool calls during a call (booking, order,
   catalog search), transcript in the inbox, credit charge. Fix until the owner is happy. Test on desktop and phone
   browsers. Write the results down (latency numbers, what failed).
3. **Optional: WhatsApp calls** — Meta's WhatsApp Business Calling API can let customers call the business on WhatsApp;
   research if it can be bridged to LiveKit (SIP/WebRTC) once WhatsApp is approved. Not a replacement for numbers.
4. **Armenian numbers:** the owner is contacting **Ucom, Viva, Team** with a written question list. Key fact:
   **LiveKit SIP cannot REGISTER** to an operator (feature still in development, livekit/sip PR #774); it only accepts
   INVITEs sent to its SIP URI. So the operator must offer an **IP/domain-based SIP trunk without registration**,
   pass **caller number** and **called number**, ideally the **Diversion/History-Info** header for forwarded calls,
   support **REFER** or an outbound trunk for transfers, G.711/G.722/Opus. Public info: Ucom SIP trunks use
   registration + outbound proxy (G.711 µ-law); Viva has a SIP Trunk product (mobile numbers, up to 10 simultaneous calls,
   2,000–16,500 AMD/month, B2B@vivaarmenia.am); Team — unknown. If only registration is possible, add a small SIP relay
   (Asterisk/FreeSWITCH/Kamailio on Fly) that registers to the operator and forwards INVITEs to LiveKit.
5. **Wire numbers:** LiveKit inbound trunk + dispatch rule → agent `hansora-phone-agent`; a numbers pool table/flow
   (assign a free number to a business at "Go live", or the business forwards its own number — unconditional, busy, or
   no-answer after N seconds); outbound trunk for transfers. Store numbers in `automation_provider_resources`
   (provider `livekit`, resource_type `phone_number`, `safe_config.e164`).
6. **Other countries:** Telnyx (or similar) trunk into the same LiveKit project; number search/purchase per country.
