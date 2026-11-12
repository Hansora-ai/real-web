# Website chat

Businesses can add their AI employee to their own website as a chat bubble. Visitors chat with the same AI employee
that answers on Instagram, WhatsApp and Telegram, with the same knowledge, products, bookings, orders, leads and
handoff. Conversations appear in the Hansora inbox marked "Website chat", and the team can reply from there. The
visitor sees the reply in the bubble within a few seconds.

## For the business owner

AI employee → Channels → **Website chat** (`automation-website.html`):

1. **Your website.** The bubble only works on these websites and their subdomains.
2. **How it looks.** Title, colour, welcome message, bottom right or left, and "Powered by Hansora AI" on or off.
3. **Visitor details.** Don't ask, ask but let visitors skip, or require them before chatting. You choose which of
   name, phone number and email to ask for.
4. **Replies.** The AI answers automatically (or is off), an optional wait before replying, and a daily maximum of
   visitor messages.
5. **Add it to your website.** One line to paste just before `</body>`, with steps for WordPress, Shopify, Wix, Tilda
   and Squarespace:

   ```html
   <script src="https://hansora.co/chat.js" data-key="hw_…" async></script>
   ```

Then press **Go live**. The preview on the right of that page is the real bubble.

## Billing

Each AI reply costs the same credits as an Instagram or WhatsApp reply (`kind: ai_reply`). Website chat is available
on every plan.

## Protection against spam

The bubble works from a public page, so these limits stop someone from burning a business's credits:

- **Websites:** a key only works on the websites the owner listed. The `Origin` header is checked, and the browser
  blocks other sites too.
- **Per visitor:** at most 8 messages a minute and 150 a day.
- **Per network address:** at most 60 messages an hour. Only a salted hash of the address is stored, never the address
  itself.
- **Per business:** the owner's daily maximum (default 500, from 50 to 5,000). Once it's reached, nothing more is
  answered or charged that day.

## How it works

| Part | File |
| --- | --- |
| Bubble (shadow DOM, 7 languages, details form, product photos, team replies) | `public/chat.js` |
| Public endpoint: settings, sending, new messages | `netlify/functions/automation-website-chat.mjs` |
| AI reply, the same steps as Telegram | `netlify/functions/automation-website-process-background.mjs` |
| Owner settings, widget key, go live or pause | `netlify/functions/automation-website-setup.mjs` |
| Shared rules (websites, settings, limits) | `lib/automation/website.mjs` |
| Database: the `website` channel type, a row for every AI employee, indexes | `supabase/34_automation_website_chat.sql` |
| Team replies from the inbox | `automation-conversation-reply.mjs` (saved; the bubble picks them up) |

The bubble asks for new messages every 2.5 seconds while open (1.5 s while a reply is coming), and every 25 seconds
while closed once a chat exists, so team replies show an unread badge.

**Setup:** run `supabase/34_automation_website_chat.sql` once. No new environment variables are needed: it uses
`HANSORA_AUTOMATION_INTERNAL_SECRET` like the other channels.

**Tests:** `node --test test/automation/website-chat.test.mjs`.

## Not in this version

- **Visitors sending files or photos:** they can send text only. The AI can still send product photos.
- **A "prove you're human" check:** the limits above do this job for now.
