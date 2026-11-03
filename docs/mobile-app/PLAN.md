# Hansora mobile app — plan

Approved by the owner on 2026-11-02. This file is the source of truth: Claude sessions do not remember earlier
sessions, so every decision lives here. Change it only when the owner decides something new.

## Goal

One app for iPhone, iPad and Android with **all of Hansora**: Creative (every image and video model the website has)
and Automation (Inbox, orders & bookings, instant notifications). It always matches the website — the website is
the reference for features, prices, credits and wording.

## Decisions

| Topic | Decision |
|---|---|
| Platforms | iPhone, iPad, Android — one codebase |
| Tech | Capacitor 8 in `app/`. The app has **its own copy** of the website's files in `app/web/` (separate from the website, changed for the app). The app never opens hansora.co pages and never reads `public/`; it only calls the same server. App-only parts: `app/web/app/` |
| Bundle ID | `co.hansora.app` (owner owns hansora.co). Can never change after the first release |
| Backend | The same Supabase project and Netlify functions as the website. No second backend |
| Design | **Identical to the website** (owner's decision, 2026-11-02): same pages, banners, headers, bottom bars and menus. Two sections, Creative and Automation, with a clear door between them. Only add/remove what Apple and Google require |
| Languages | English first; Russian and Armenian after (the website's _ru/_arm pages are already packaged) |
| Login | Email + password, Google (≈90% of users), and **Sign in with Apple** (Apple requires it when Google is offered) |
| Credits | Same balance as the website. Stored credits shown ×10 with ⚡ (3 stored = 30⚡ welcome gift) |
| Buying credits | **Option A**: Apple / Google in-app purchases for the same packages, and website purchases still count |
| Orders & bookings | **Option B**: everything like the website — orders, bookings and leads, every status |
| Notifications | For each business owner about their own business: AI needs you, new order/sale, new booking, other alerts. Tapping opens the item |
| Delete account | At the bottom of both profile pages (Creative and Automation). The user chooses Automation data only, or the whole Hansora account. The app records a request (`account-deletion-request` function, `public.account_deletion_requests`); the owner gets a Telegram message and completes it within 30 days (allowed by Apple 5.1.1(v)) |
| Face ID | Not wanted |
| Setup | Creating AI employees and connecting channels stays on the website for now |
| Channels | Generic list (Instagram, TikTok, WhatsApp, Messenger, Telegram, Phone, unknown → "Other"). WhatsApp (Meta review since 2026-10-28) and phone calls appear without app changes. No "coming soon" screens |

## Steps

1. **Base** — design system, login (email, Google, Apple), languages, Account/settings, tabs. *(this PR)*
   Then: delete account (needs a new server function, own PR).
2. **Automation** — Inbox (Needs you first, take over, reply, give back to AI, 24h/48h window rules, WhatsApp templates),
   Orders & bookings (all kinds and statuses), push notifications (device tokens table, sending from the server, deep links).
3. **Creative** — every website model, generation, gallery, credit costs exactly like the website.
4. **Buying credits** — Apple StoreKit + Google Play Billing, server checks each purchase before adding credits.
5. **Stores** — privacy labels, screenshots from the final app, demo account for reviewers, Google 12 testers × 14 days.

## Apple review checklist (from the owner's video, "12 reasons Apple rejects")

1. No Stripe/Dodo/YooMoney inside the app → only Apple/Google payments (step 4).
2. Sign in with Apple next to Google → done in step 1 (needs owner setup, below).
3. Account deletion inside the app → after step 1.
4. Not a "website in a box" → native screens, tab bar, native sheets, push.
5. Working demo login with sample data for the reviewer → step 5.
6. iPad must look right → layouts capped at a readable width; check on iPad before review.
7. Store screenshots from the real final build.
8. No "coming soon" screens → the preview-only placeholders in step 1 are removed before any store build.
9. Support and privacy links must work; privacy policy must mention push tokens and in-app purchases.
10. "Report" for user content → not expected (private customer chats), re-check before review.
11. "Restore purchases" must work → step 4.
12. Screenshots must not show paid features without explaining in-app purchase.

## Things the owner sets up (never paste keys in chat)

- **Accounts (2026-11-02):** no Apple Developer account yet. Testing uses Xcode with a free Apple ID (own iPhone,
  re-install every 7 days). Create the Apple Developer Program account ($99/year, verification can take days)
  before Sign in with Apple, push notifications, TestFlight or App Store submission. Google Play: $25 once, later.

- Supabase → SQL editor: run `supabase/migrations/20261102150000_account_deletion_requests.sql` once (deletion requests table).
  The server function is in its own small PR (Hansora-ai/real-web#241), so it can go live without merging the app PR.

- Supabase → Authentication → URL configuration: add `co.hansora.app://auth/callback` to Redirect URLs.
- Supabase → Authentication → Providers → Apple: enable, using a Services ID + key from the Apple Developer account.
- Apple Developer: App ID `co.hansora.app` with "Sign in with Apple" and "Push Notifications".
- Google Play Console: app `co.hansora.app`, start the closed test early (12 testers × 14 days).
- Firebase project (Android push) and an APNs key (iPhone push) — step 2; keys go into Netlify environment settings.

## Known risks / follow-ups

- The website creates a new user's profile and welcome credits from the browser (`public/header.js`). The app does
  the same so app sign-ups get the same 30⚡. Both should move to the server later, in one change, so the numbers can
  never differ.
- Russian users: Apple/Google payments may not work in Russia; they keep buying on the website (check before step 4).
- Google sign-in inside the app opens the system browser and returns via `co.hansora.app://` — must be tested on real phones.
- Apple "Hide my email" creates a new empty account; the login screen tells people to sign in the same way they signed up.

## Before merging

- Remove the `[context.deploy-preview]` block from `netlify.toml` (it only exists so the PR preview link shows the app).
