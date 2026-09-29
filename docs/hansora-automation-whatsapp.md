# Hansora Automation: WhatsApp Business setup

Hansora connects a business-owned WhatsApp number through Meta Embedded Signup. Authorization codes and access tokens are handled only by Netlify functions. Tokens are encrypted before storage and never returned to browser code.

## Required environment variables

```text
META_WHATSAPP_APP_ID
META_WHATSAPP_APP_SECRET
META_WHATSAPP_CONFIGURATION_ID
META_WHATSAPP_WEBHOOK_VERIFY_TOKEN
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ELEVENLABS_API_KEY
HANSORA_AUTOMATION_ENCRYPTION_KEY
HANSORA_AUTOMATION_INTERNAL_SECRET
```

If Instagram and WhatsApp use the same Meta app, the WhatsApp app ID, app secret, and webhook verification token may intentionally use the same values as the Instagram variables. Keeping explicit WhatsApp variables makes separate Meta apps possible later.

Optional:

```text
META_WHATSAPP_GRAPH_VERSION=v23.0
```

## Meta configuration

1. Create a Facebook Login for Business configuration using the WhatsApp Embedded Signup variation.
2. Store its configuration ID as `META_WHATSAPP_CONFIGURATION_ID`.
3. Request the permissions required by Embedded Signup, including `whatsapp_business_management` and `whatsapp_business_messaging`.
4. Set the WhatsApp webhook callback to:

   ```text
   https://YOUR_DOMAIN/.netlify/functions/automation-whatsapp-webhook
   ```

5. Enter `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` as the verification token and subscribe to the `messages` field.
6. Complete Meta App Review and business verification before onboarding customers outside the app's test roles.

## Runtime

1. The owner launches Embedded Signup from the Hansora channel wizard.
2. Meta returns a one-time authorization code plus the selected WABA and phone-number IDs.
3. `automation-whatsapp-connect` authenticates the Hansora owner, exchanges the code, validates the phone number, subscribes the WABA to the app, encrypts the token, and saves the provider resource as `pending`. If the number is not yet on Cloud API it is registered with a generated 6-digit PIN (stored encrypted as `registration_pin`). If the number already has two-step verification, the wizard asks the owner for that PIN and retries with `phone_number_id` + `pin` only, reusing the stored token because the signup code is single-use. The resource becomes `active` once registration succeeds.
4. The final wizard step activates the channel and its reply settings.
5. `automation-whatsapp-webhook` validates the Meta signature, records delivery/read/failure statuses, and deduplicates incoming messages.
6. `automation-whatsapp-process-background` stores the customer message, runs the shared ElevenLabs agent, sends the WhatsApp response, and writes one billable WhatsApp AI-message usage event. Every inbound message gets a read receipt. Photos, videos, voice notes, files and locations are stored with their content type and passed to the AI as a text placeholder (plus any caption) so it asks the customer to describe them instead of guessing.
7. Human replies from the unified inbox are nonbillable. Free-form replies are blocked after 24 hours from the customer's last inbound message; an approved template is required outside that window. The inbox shows the time left in the window and switches to a template picker (approved body-text templates, with or without `{{n}}` variables) once it closes. The server re-checks that the template is still approved and stores the rendered text in the conversation.

## Functions

- `automation-whatsapp-start`: authenticated public Embedded Signup configuration
- `automation-whatsapp-connect`: code exchange, phone validation, webhook subscription, and encrypted token storage
- `automation-whatsapp-webhook`: webhook verification, signature checking, status updates, and event ingestion
- `automation-whatsapp-process-background`: AI generation, delivery, conversation storage, and usage records
- `automation-conversation-reply`: authenticated human reply for Instagram and WhatsApp, including WhatsApp templates
- `automation-whatsapp-templates`: approved templates for the connected WABA (templates with media headers are not offered yet)
