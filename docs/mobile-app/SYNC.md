# Website → app change list

The owner keeps improving the website while the app is built. Every website change the owner reports goes here, and
gets ticked when the app has it too. Newest at the top.

| Date | Website change | Where in the app | Done in app |
|---|---|---|---|
| — | *(nothing reported yet)* | | |

## Copied from the website by hand (check these when the website changes)

| Website code | App copy |
|---|---|
| `getModelUnitCreditValue()` in `public/search-models.html` (prices) | `app/src/creative/pricing.ts` |
| `buildBodyForModel()` in `public/search-models.html` (request per model) | `app/src/creative/requests.ts` |
| `getOrCreateProfileOnce()` in `public/header.js` (welcome credits) | `app/src/lib/account.ts` |
| Inbox queries/actions in `public/automation-inbox.js` | `app/src/automation/api.ts` |
| Orders queries/actions in `public/automation-operations.js` | `app/src/automation/api.ts` |

The model list itself (`const MODELS`) is copied automatically on every app build.
