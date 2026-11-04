# Hansora app (iPhone, iPad, Android)

The app has its own files in `web/`: a separate copy of the website's pages, design and functions, changed for the app.
The app never opens hansora.co pages and doesn't use the website's folder; it only talks to the same server
(login, credits, generations, chats). App-only parts: `web/app/app-shim.js` and `web/app/app.css`.
When the website changes, the same change is made in `web/` (listed in `docs/mobile-app/SYNC.md`).
Plan: [`docs/mobile-app/PLAN.md`](../docs/mobile-app/PLAN.md).

## iPhone (Mac with Xcode)

```bash
cd app
npm install
npm run ios
```

In Xcode: App target → Signing & Capabilities → choose your team, then pick your iPhone and press ▶.

## Android (Android Studio)

```bash
cd app
npm install
npm run android
```

## Checks

```bash
cd app
npm test
```
