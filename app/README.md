# Hansora app (iPhone, iPad, Android)

The app's pages are the website's own files from `public/`, packaged into `app/www` when the app is built.
The app never opens hansora.co pages; it only talks to the same server (login, credits, generations, chats).
Everything app-only is in `additions/` (store rules, login through the phone's browser, Creative ↔ Automation door).
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
