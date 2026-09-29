# Hansora Automation — handoff (2026-09-28)

Read this first. It describes everything built so far, the rules the owner set, and what comes next.

## The product

Hansora Automation is a separate section of hansora.co. A business owner creates an **AI employee** (business info, prices, hours, rules), connects **Instagram DMs → Instagram comments → WhatsApp → phone**, and the AI answers customers, books appointments, takes orders, saves leads, hands off to a person, and notifies the owner. Text AI runs on **ElevenLabs** behind a Hansora provider layer (`lib/automation/provider.mjs`) so it can be replaced later. Phone will use **Gemini 3.8 Live, voice "Laomedeia"**, via LiveKit + an Armenian SIP line.

## Owner's rules (important)

- **Do not commit, push, deploy, or run SQL on Supabase** until everything is built. The owner tests only at the very end.
- **One shared header** for every Automation page: `public/automation-header.js` (+ `.css`). Never add a header inside a page.
- All Automation tables live in their **own Postgres schema `automation`** (not `public`), keeping their `automation_*` names. Only the Hansora login and `public.profiles.credits` are shared with Creative. Server code: `lib/automation/db.mjs` adds `Accept-Profile/Content-Profile: automation` for `/rest/v1/automation_*`; pages use `api.db` (= `client.schema('automation')`) for Automation tables and `api.client` for `profiles`. Supabase → Settings → API → Exposed schemas must include `automation`.
- Every page must work in **preview mode** (`?preview=1` or opened from disk) without login.
- Design: sharp, calm, professional (Linear/Stripe style) on app screens; moving blue glow only on the landing page. **Dark is the default theme**; the sun/moon button in the header switches to light.
- Keep things simple for non-technical owners; remove controls that do nothing.

## Where everything is

Project folder: `~/Documents/Codex/2026-09-27/files-pasted-by-the-user-i/work/real-web` (clone of GitHub `Hansora-ai/real-web` at `e9e04f2`, all changes uncommitted).

**Pages** (`public/`), all on the shared design system `automation-ui.css` + `automation-ui.js`, theme bootstrap `automation-theme.js` (sync script in every `<head>`):

| Page | Purpose |
|---|---|
| `automation.html` (+ `automation.css`, `automation.js`) | Landing page with glow and live channel demo |
| `automation-dashboard.html` | List of AI employees |
| `automation-setup.html` | 4-step create/edit wizard |
| `automation-agent.html` | Workspace: metrics, channels, actions, usage, live test chat, knowledge |
| `automation-connect.html?channel=instagram|whatsapp` | Meta OAuth / WhatsApp Embedded Signup (+ PIN registration) |
| `automation-workflows.html` (+ `.css`, `.js`) | Instagram automation manager: templates, multiple flows, status controls and per-flow results |
| `automation-comments.html` (+ `automation-flow.css`) | Connected comment → DM flow builder: message buttons route to messages, delays, conditions, AI or handoff; visual connections and journey preview |
| `automation-inbox.html` | 3-pane inbox, human takeover, WhatsApp 24h window + template picker |
| `automation-operations.html` | Orders, bookings, leads (status, assignee, notes, manual add) |
| `automation-tools.html` | Bookings (hours, services, days off, Google Calendar), orders fields, leads, handoff rules, notifications |
| `automation-usage.html` | Billed AI replies log and estimated bill |
| `automation-phone.html` | Phone setup UI (number, Laomedeia voice, rules, real browser-microphone test when configured; scripted local preview) |

`public/automation-app.css` is no longer used by any page (owner has not yet decided whether to delete it).

**Backend**
- `lib/automation/`: `provider.mjs`, `providers/elevenlabs.mjs` (agent sync + WebSocket text bridge with **client tools**), `tools.mjs` (AI actions: check_availability, create_booking, cancel_booking, create_order, create_lead, handoff_to_human — business scope always from server context), `availability.mjs` (slots, time zones, buffers), `notify.mjs` (owner alerts: WhatsApp templates from Hansora's own number + Resend email, idempotent), `google-calendar.mjs`, `whatsapp.mjs`, `meta.mjs`, `comment-flow.mjs`, `flow-executor.mjs`, `crypto.mjs`, `db.mjs`, `instructions.mjs`.
- The comment-flow JSON now uses stable node/action IDs and explicit connections (`nextId`, `replyNextId`, button `nextId`, condition `yesId`/`noId`). Old linear drafts are normalized in the browser when opened. The server routes quick-reply payloads to the connected node and durable delay jobs resume at the chosen target.
- `netlify/functions/automation-*.mjs` (21 functions): Meta OAuth/webhook, Instagram DM + comment processing, WhatsApp connect/webhook/process/templates, test chat, agent sync, flow jobs, conversation reply, notifications, Google start/callback/calendars, outcome update, and secure LiveKit phone-test token/dispatch.
- `workers/automation-phone/`: long-running LiveKit agent for Gemini 3.8 Live native audio, Laomedeia, inbound SIP routing, shared AI tools, transfers/callback fallback, transcripts and voice-second usage.
- Migrations (run in this order at final setup): `supabase/migrations/20260927_automation_core.sql`, `20260927_automation_runtime.sql`, `20260928_automation_tools.sql` (needs `btree_gist`; blocks double bookings), `20260929_automation_credits.sql` (credit charges ledger, `credits` on usage events, `credits_used` in the monthly views), `20260929_automation_privacy.sql` (Meta data-deletion requests), `20260930_automation_flow_events.sql` (per-step automation results).
- Tests: `npm run test:automation` → 40 passing (uses fakes; no real provider calls yet).
- Setup guides: `docs/hansora-automation-instagram.md`, `docs/hansora-automation-whatsapp.md`, `docs/hansora-automation-tools.md`, `docs/hansora-automation-phone.md`.

Local preview: `python3 -m http.server 4174 --directory public` then open `http://localhost:4174/automation.html?preview=1`.

## Not verified yet (needs real keys)

Nothing has called real Meta, ElevenLabs, Google, Resend, LiveKit or SIP. At final testing confirm especially:
- ElevenLabs accepts inline `conversation_config.agent.prompt.tools` client tools and `client_tool_call`/`client_tool_result` in text-only WebSocket chats. If it requires tools created separately (`tool_ids`), only `lib/automation/providers/elevenlabs.mjs` changes.
- Meta: WhatsApp phone registration + templates; Instagram webhooks.
- LiveKit: browser microphone audio, inbound Armenian SIP routing, Gemini tool calls, SIP REFER transfer and callback fallback.
- All Automation SQL migrations were applied to the production Supabase project by the owner on 2026-09-29. Do not run the cleanup or migrations again unless a later migration explicitly requires it.

## Phone calls implemented, awaiting credentials

The worker, secure browser test, inbound routing, shared tools, transfer/callback behavior, transcripts and voice-second
usage are implemented. See `docs/hansora-automation-phone.md`. No real call has been made because LiveKit, Google and
SIP credentials are not present, and no service has been deployed.

## Pricing: pay as you go with shared Hansora credits (done 2026-09-29)

- No subscription. Automation spends the same `profiles.credits` balance as Hansora Creative. The site shows credits ×10 as ⚡ (`CREDIT_DISPLAY_MULTIPLIER` in `public/header.js`), so 0.1 stored credit = 1⚡ ≈ $0.01.
- Prices (stored credits, in `lib/automation/billing.mjs`, overridable with env `AUTOMATION_CREDITS_PER_AI_REPLY`, `_PER_TEST_REPLY`, `_PER_VOICE_MINUTE`, `_PER_TEST_VOICE_MINUTE`): AI reply 0.1 (1⚡), phone 0.8/min (8⚡/min, charged once at call end, rounded up to the next ⚡), test chat/test calls same as real, pre-written flow messages and team replies free.
- Charging: balance checked before the AI generates; charged only after the reply is actually sent; exactly once per idempotency key (`automation_credit_charges`, unique key = the usage key); compare-and-swap on `profiles.credits` like `run-imagen.js`; never below zero; `refundCredits(key)` returns a charge once.
- Out of credits: no AI reply, the conversation becomes `needs_attention` ("Out of credits") and the owner gets one alert per day. Phone: transfer to the owner if set, otherwise a short polite message and hang up. Long calls end politely before the balance runs out.
- UI: Usage page shows balance ⚡, ⚡ used this month (AI vs phone), "Buy credits" → `/pricing.html`; workspace shows the balance and credits this month; test chat says when credits run out.
- Before launch: run ~1,000 real replies through ElevenLabs, check the real cost, then adjust the prices above (target 30–40%+ margin).

## Legal pages and Meta app URLs (done 2026-09-28)

New Automation-only pages in the Automation design (existing `/termsofuse.html` and `/policy.html` stay for Creative and are linked from them): `automation-terms.html`, `automation-privacy.html` (includes the Meta Platform data section and Google API Limited Use statement), `automation-data-deletion.html` (instructions + status check by confirmation code). Shared script `automation-legal.js`. Header shows "Hansora Creative ↗"; footer links on landing and legal pages; consent line on setup review.

Enter these in the Meta app (App settings → Basic, and Instagram/Facebook Login settings):
- Privacy Policy URL: `https://hansora.co/automation-privacy.html`
- Terms of Service URL: `https://hansora.co/automation-terms.html`
- Data Deletion Callback URL: `https://hansora.co/.netlify/functions/automation-meta-data-deletion`
- Deauthorize Callback URL: `https://hansora.co/.netlify/functions/automation-meta-data-deletion?type=deauthorize`
Google OAuth consent screen: same privacy and terms URLs.

The callback verifies Meta's `signed_request` with the app secret, deletes tokens + that channel's contacts/conversations/messages (+ comment history for Instagram), and returns a confirmation code. Owners can also disconnect on the connect page (`automation-channel-disconnect` function). Legal text is a careful draft, not legal advice: have a lawyer review it, and update the operator name/address once the company is registered.

## Comment builder v2 + shared sidebar (done 2026-09-29)

- **Shared left sidebar** (ManyChat-style) on every signed-in page, built in `automation-header.js`/`.css` only: Overview, Inbox, Automations, Orders & bookings, Business tools, Channels, Phone, Usage; AI employees / Edit at the bottom; collapsible; remembers the current business in localStorage; on phones the links move into the header menu.
- **Builder canvas** (`automation-comments.*`, `automation-flow.css`): pan (drag background / scroll), zoom (pinch, Ctrl+wheel, +/−, Fit), drag steps (positions saved on each node as `pos`, trigger in `safety_config.layout.trigger`), "•••" menu with Duplicate/Delete, Delete key, ⌘Z undo. Left library replaced by a floating "+" panel (Trigger, Content, AI, Logic).
- **View vs edit**: live flows open in view mode with a banner and results; "Edit automation" → edit; live edits are not auto-saved, they are published with "Publish changes" (or discarded).
- **Results per step**: `lib/automation/flow-stats.mjs`, `automation_flow_events` table, `automation-flow-stats` (owner-only) and `automation-link` (signed tracked website links) functions. Recorded: opening-DM and flow messages tagged with `node_id`; button taps (`HANSORA_FLOW:<actionId>` payloads); Instagram "seen" receipts via the webhook (subscribe to the `messaging_seen` field in the Meta app); link clicks. Opening DM now uses the step marked `commentReply` (same as the builder).

## Private deployment on hansora.co (decided 2026-09-28)

The owner deploys Automation to hansora.co but keeps it hidden from Creative users until launch:
- **No link from Hansora Creative.** The "AI Automation" links Codex added to `public/header.js` and to the mobile menu in `netlify/edge-functions/inject-bottom-nav-inline.js` were removed. Add them back only at launch.
- Every `public/automation*.html` page has `<meta name="robots" content="noindex, nofollow">`. Remove it at launch.
- Changed existing files that ARE needed and invisible to Creative users: `package.json`/`package-lock.json` (dependencies), `netlify.toml` (every-minute comment-flow job), and the edge function (skips the Creative bottom bar on /automation pages only). `public/login.html` only adds "return to the Automation page after login"; everyone else still lands on the homepage.
- The Automation schema and migrations are already applied in Supabase. Deploy the website code without rerunning them.

## After that: final setup with the owner

Add env vars (see the three docs), deploy, test with the owner's own Instagram/WhatsApp (works in Meta development mode without app review), record screen videos, then submit Meta App Review. The SQL migrations are already applied.

**Business status:** the owner has no registered company yet. Meta business verification needs one (suggested: register as an individual entrepreneur in Armenia). Phone calls do not need Meta approval.

## International round (2026-09-28)

- Hansora Automation is international: no Armenia-specific copy, numbers, currency or sample data.
- Languages: 18 codes (`api.languages` in automation-client.js, `LANGUAGE_NAMES` in lib/automation/instructions.mjs); an agent supports 1–10. Migration `20260930_automation_languages.sql` widens the checks and sets defaults to en / UTC / USD.
- The setup page defaults to the browser's language and saves the browser's time zone on the business. Business tools lists every IANA time zone (`Intl.supportedValuesOf`).
- Orders & bookings: manual records have a currency (remembered per browser) and values are formatted with `Intl.NumberFormat`. "Open value" sums the most-used currency.
- The terms page still names the laws of Armenia as governing law, because that is where the operator is based.
- Comment builder: a click selects a step (pointer capture starts only after a 4px drag). The floating duplicate/delete toolbar sits above the selected step and keeps a constant size at any zoom (`--z` on `#flow-map`). The inspector ✕ only closes the panel.
