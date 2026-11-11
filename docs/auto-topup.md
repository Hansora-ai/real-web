# Auto top-up

Customers can choose to have credits bought automatically when their balance runs low. This uses Dodo's on-demand
subscriptions. The customer approves their card once on a Dodo checkout and pays nothing then. When their balance
falls below the level they picked, the server charges that card for the pack they picked.

## What the customer sees

On their profile page (all three languages), the **Auto top-up** card has:

- A **pack**: 900 credits for $9.99, 2,000 for $19.99, 5,100 for $49.99 or 10,500 for $99.99. These match the Creative
  packs.
- A **level**: top up when credits fall below 100, 300, 500 or 1,000.
- Buttons to **turn on** (the first time this opens the Dodo checkout to save a card), **turn off** (the card stays
  saved) and **remove saved card** (this cancels the mandate at Dodo).
- Their last few top-ups, and the reason when a charge failed.

## Pricing page

Under the International / Russian card switch, people who have bought before see a small **🔁 Auto top-up** button.
It opens the same choices in a popup. The pricing page doesn't wait for it: `public/auto-topup-widget.js` runs only
after the page has loaded and asks the server whether the signed-in person has a paid payment. Signed-out visitors and
people who never bought see nothing.

## What the owner sees

- **Business dashboard → Auto top-up:** how many people have it on, who saved a card, who opened the checkout but
  didn't finish, the top-ups paid in the period, and failed charges with the reason.
- **Business dashboard → Sales:** auto top-up payments show "Dodo · 🔁 auto top-up" in the Via column. Normal purchases
  just show "Dodo".
- **Telegram sale message:** auto top-ups say "🔁 auto top-up".
- **In Supabase:** every auto top-up is a row in `auto_topup_charges`, and its `payment_id` is the Dodo payment id, so
  it matches `payments.transaction_id`.

## How it works

| Step | Where |
| --- | --- |
| Save the pack and level, then open a checkout with `subscription_data.on_demand.mandate_only = true` and metadata `auto_topup=1` | `netlify/functions/auto-topup.mjs` |
| `subscription.active` saves the card and turns auto top-up on | `dodo-webhook.mjs` → `lib/business/auto-topup.mjs` |
| Every 2 minutes, find everyone who needs a top-up (`auto_topup_due`) and call `POST /subscriptions/{id}/charge` | `netlify/functions/auto-topup-run.mjs` |
| `payment.succeeded` adds the credits written on the charge row to the pay-as-you-go bucket, once per payment id | `lib/business/auto-topup.mjs` |
| `payment.failed` counts a failure | `lib/business/auto-topup.mjs` |

Safeguards:

- **Credits:** the number of credits always comes from the server's own charge row, never from what the payload or
  metadata says.
- **One charge at a time:** each person has at most one charge in progress (a unique index).
- **Daily limit:** at most 3 top-ups in 24 hours.
- **Retry wait:** after a failed charge, the next try waits 6 hours.
- **Failures:** after 3 failures in a row, or a card that can never be charged again (stolen or lost card, mandate
  gone), auto top-up turns off. The owner gets a Telegram message, and the customer sees why on their profile.
- **Lost webhooks:** a charge with no webhook after 2 hours is marked expired. If the webhook arrives later, the
  credits are still added.

## Owner setup (once)

1. In the Dodo dashboard, create a **subscription** product in **USD**, for example "Hansora auto top-up". Its price
   does not matter, because every charge sends its own amount.
2. In Netlify, set `DODO_AUTO_TOPUP_PRODUCT_ID` to that product's id (`pdt_…`). `DODO_PAYMENTS_API_KEY` and the webhook
   are already set up. Until this variable is set, the profile card says auto top-up is not available yet, and the
   2-minute job does nothing.
3. Apply `supabase/migrations/20261111120000_auto_topup.sql`.
4. Make sure the Dodo webhook sends `subscription.*`, `payment.succeeded` and `payment.failed`. It already does for
   plans and packs.

Before going live, try it once in Dodo test mode: save a card, set the level above your balance, and check that the
credits arrive within about 2 minutes.

Tests: `npm run test:auto-topup`.
