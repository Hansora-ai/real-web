# Buying credits in the app (Apple, Google, RevenueCat)

The app sells exactly what the website sells: the same 4 credit packs and the same monthly plans (Creative and
Automation), with the same credits and benefits. Payment goes through Apple (iPhone) or Google Play (Android);
RevenueCat checks every payment and tells our server, which adds the credits and plans to the same account as the
website. Credits work everywhere (Creative and Automation).

- App: `app/web/app/iap.js` (Buy buttons on `pricing.html` and `automation-pricing.html`), keys in `app/web/app/iap-config.js`.
- Server: `netlify/functions/revenuecat-webhook.mjs` + `lib/business/app-purchases.mjs` (separate PR).
- Prices: same as the website until approval; raise them later in App Store Connect / Play Console (no app update needed).

## The products (11 to create; Scale is no longer sold) (create them with exactly these IDs)

| Product ID | Type | Grants | Price |
|---|---|---|---|
| `co.hansora.app.credits.900` | Consumable | 900⚡ | $9.99 |
| `co.hansora.app.credits.2000` | Consumable | 2,000⚡ (1,800 + 200 free) | $19.99 |
| `co.hansora.app.credits.5100` | Consumable | 5,100⚡ (4,500 + 600 free) | $49.99 |
| `co.hansora.app.credits.10500` | Consumable | 10,500⚡ (9,000 + 1,500 free) | $99.99 |
| `co.hansora.app.creative.premium.monthly` | Auto-renewable, 1 month, group "Hansora Creative" | Premium, 2,500⚡/month | $40.00 (or $39.99) |
| `co.hansora.app.creative.pro.monthly` | same group | Pro, 4,500⚡/month | $64.00 (or $63.99) |
| `co.hansora.app.creative.promax.monthly` | same group | Pro Max, 10,000⚡/month | $120.00 (or $119.99) |
| `co.hansora.app.automation.lite.monthly` | Auto-renewable, 1 month, group "Hansora Automation" | Lite, 2,500⚡/month | $25.00 (or $24.99) |
| `co.hansora.app.automation.starter.monthly` | Auto-renewable, 1 month, group "Hansora Automation" | Starter, 4,900⚡/month | $49.00 (or $48.99) |
| `co.hansora.app.automation.growth.monthly` | same group | Growth, 9,900⚡/month | $99.00 (or $98.99) |
| `co.hansora.app.automation.business.monthly2` (the first ID was used by mistake in App Store Connect) | same group | Business, 14,900⚡/month | $149.00 (or $148.99) |
| `co.hansora.app.automation.scale.monthly` | same group | Scale, 19,900⚡/month (no longer sold on the website: do **not** create it) | — |

Two subscription groups, so a person can have a Creative plan and an Automation plan at the same time (like the website).
On Google Play, subscriptions get one base plan each (monthly, auto-renewing); the base plan ID can be `monthly`.

## Setup steps (owner; keys never go in chat)

1. **Apple Developer account** ($99/year) → App Store Connect → new app, bundle ID `co.hansora.app`.
   Agreements, Tax and Banking: accept the Paid Apps agreement and add bank + tax (required to sell).
   Join the **App Store Small Business Program** (15% instead of 30%).
2. **Google Play Console** ($25) → new app `co.hansora.app`, payments profile, join the 15% service-fee tier.
3. Create the 11 products above in both stores.
4. **RevenueCat** (free until $2,500/month of app revenue): create a project "Hansora", add the iOS app
   (App Store Connect API key / in-app purchase key) and the Android app (Google service account), import the products.
5. RevenueCat → API keys: copy the **public** app keys (`appl_…`, `goog_…`) into `app/web/app/iap-config.js`
   (these are made to be inside apps; they can't spend money or read data).
6. RevenueCat → Integrations → **Webhooks**: URL `https://hansora.co/.netlify/functions/revenuecat-webhook`,
   Authorization header: a long random password. Put the same password in Netlify → Environment variables →
   `REVENUECAT_WEBHOOK_AUTH` (secret). Then press "Send test event": it must answer 200.
7. Test on the iPhone with an Apple **Sandbox** tester (App Store Connect → Users and Access → Sandbox): buy a pack and a
   plan; the credits must appear in the account within seconds. Record this for App Review if they ask.

## Rules kept in the app
- No website checkout, Dodo, YooMoney or "Russian card" inside the app; no links to cheaper website prices.
- Restore purchases, Manage subscription (opens Apple / Google subscription settings), the auto-renew terms and links to
  Terms of use and Privacy policy are on both pricing pages.
- A person who has a monthly plan from the website is not offered a second plan of the same kind.
- The store price in the person's own currency shows under a Buy button when it is not US dollars.
