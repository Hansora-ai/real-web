# Hansora app (iPhone, iPad, Android)

Plan and decisions: [`docs/mobile-app/PLAN.md`](../docs/mobile-app/PLAN.md). Website changes still to copy:
[`docs/mobile-app/SYNC.md`](../docs/mobile-app/SYNC.md).

Separate from the website build: nothing in this folder is deployed to hansora.co.

## Try it in a browser

```bash
cd app
npm install
npm run dev
```

Open the address it prints, then in Chrome press F12 → the phone icon to see it at iPhone size.
It uses the real Hansora login and data.

## Run it on your iPhone (Mac with Xcode)

```bash
cd app
npm install
npm run build
npx cap sync ios
npx cap open ios
```

In Xcode: select the **App** target → *Signing & Capabilities* → choose your team, add **Sign in with Apple**,
then pick your iPhone at the top and press ▶.

## Run it on Android (Android Studio)

```bash
cd app
npm install
npm run build
npx cap sync android
npx cap open android
```

## Checks

```bash
npm test
npm run build
```
