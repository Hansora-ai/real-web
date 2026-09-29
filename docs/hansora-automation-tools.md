# Hansora Automation: business actions and owner notifications

The AI employee can check availability, book and cancel appointments, take orders, save leads and hand a
conversation to a person. The owner is notified from Hansora's own WhatsApp number and by email.

## Database

Apply `supabase/migrations/20260928_automation_tools.sql` after the two `20260927_*` migrations. It adds:

- `automation_outcomes`: `reference_number` (the #1042 the customer is given), `idempotency_key`,
  `customer_name`, `customer_phone`, `service_name`, `assignee`, plus a `btree_gist` exclusion constraint so two
  active bookings of one business can never overlap (the second insert fails with 409 / `23P01`).
- `automation_notification_settings` (owner can read; written only by `automation-notifications`).
- `automation_notification_verifications` (server only) and `automation_notification_deliveries` (owner can read).

## Environment variables

```
# Hansora's own WhatsApp Business number (not a customer's number)
HANSORA_NOTIFY_WA_PHONE_NUMBER_ID=
HANSORA_NOTIFY_WA_ACCESS_TOKEN=          # permanent System User token with whatsapp_business_messaging

# Email backup (RESEND_API_KEY already exists for the contact form)
RESEND_API_KEY=
AUTOMATION_NOTIFY_FROM_EMAIL=alerts@hansora.co   # falls back to CONTACT_FROM_EMAIL

# Google Calendar sync (optional feature)
GOOGLE_AUTOMATION_CLIENT_ID=
GOOGLE_AUTOMATION_CLIENT_SECRET=
GOOGLE_AUTOMATION_REDIRECT_URI=https://hansora.co/.netlify/functions/automation-google-callback
```

## WhatsApp templates for the Hansora number

Create these in WhatsApp Manager for Hansora's own WABA. Alerts use the **Utility** category; each has one
**Visit website** button with a dynamic URL `https://hansora.co/{{1}}` (Hansora fills in the page path).
Create each template in English (`en`); add Armenian (`hy`) and Russian (`ru`) translations with the same
variables if owners should receive alerts in those languages (chosen per business on the Notifications tab).

| Name | Body |
|---|---|
| `hansora_order_alert` | New order #{{1}} for {{2}}.<br>Customer: {{3}}<br>Details: {{4}}<br>Open it in Hansora to confirm the order. |
| `hansora_booking_alert` | New booking #{{1}} for {{2}}.<br>Customer: {{3}}<br>Time: {{4}}<br>Open it in Hansora to review the booking. |
| `hansora_booking_cancelled` | Booking #{{1}} for {{2}} was cancelled by the customer.<br>Customer: {{3}}<br>Time: {{4}}<br>This time slot is free again. |
| `hansora_handoff_alert` | A customer needs a person at {{1}}.<br>Customer: {{2}}<br>Reason: {{3}}<br>The AI is paused in this conversation until your team replies. |
| `hansora_lead_alert` | New lead for {{1}}.<br>Customer: {{2}}<br>Interest: {{3}}<br>Open Hansora to follow up. |
| `hansora_verify_code` | **Authentication** category, "Copy code" button (Meta writes the body). Used to confirm the owner's number. |

The "Send a test notification" button uses `hansora_lead_alert`.

## Google Calendar

1. Google Cloud console → create an OAuth client (Web application) with the redirect URI above.
2. Enable the Google Calendar API.
3. Scopes requested: `calendar.readonly` (busy times, calendar list) and `calendar.events` (create/cancel bookings).
   These are sensitive scopes: until Google verifies the app, only listed test users can connect.

## How it works

- Tool settings are saved on `automation-tools.html` (`automation_tool_configs`), then the page calls
  `automation-agent-sync`, which sends the enabled actions to ElevenLabs as **client tools** and adds rules to the
  agent's instructions. The order tool's parameters are the owner's own required fields.
- During a conversation the ElevenLabs WebSocket asks for a tool; the Netlify function runs it with the business,
  conversation and contact taken from the server context (`lib/automation/tools.mjs`) and returns the result.
  The model never chooses the business.
- Availability (`lib/automation/availability.mjs`) = working hours − closed days − active Hansora bookings −
  Google busy times, with buffer, minimum notice and time zone. `create_booking` recomputes it before saving.
- The live test chat runs actions in test mode: real availability, nothing saved or notified.
- `notifyOwner` records one delivery per channel per event (`automation_notification_deliveries`), so retries never
  alert twice. Without saved settings it emails the owner's account address.

## Functions

- `automation-notifications`: save preferences, send/verify the owner's WhatsApp code, remove the number, send a test
- `automation-google-start`, `automation-google-callback`, `automation-google-calendars`: connect, choose calendar, disconnect
- `automation-outcome-update`: owner changes status, assignee or note (cancelling a booking removes its Google event)

## Verify during final testing

- ElevenLabs: inline `conversation_config.agent.prompt.tools` client tools are accepted by the create/patch agent
  API, and `client_tool_call` / `client_tool_result` messages work in text-only WebSocket conversations. If the API
  now requires tools created separately and referenced by `tool_ids`, only `providers/elevenlabs.mjs` changes.
- Meta approves the five utility templates and the authentication template.
- Resend sender domain is verified for `AUTOMATION_NOTIFY_FROM_EMAIL`.
