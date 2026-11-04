# Website → app change list

The owner keeps improving the website while the app is built. Every website change the owner reports goes here, and
gets ticked when the app has it too. Newest at the top.

| Date | Website change | Where in the app | Done in app |
|---|---|---|---|
| 2026-11-04 | Phone: SIP number waits for a test call ("Finish connecting" box, no option pre-chosen), voice samples preloaded; server: voice preview key/fallbacks, team alert for left contacts (PRs 247–249) | `automation-phone.html/js` (server parts need nothing in the app) | ✅ |
| 2026-11-04 | Phone: voice picker with ▶ samples, own SIP trunk number, call automations (warm transfer, order confirm, booking reminder, calling hours), Call with AI from the Inbox; Instagram account photo after connecting; Comments-only "Add AI employee" (PRs 240–246) | `automation-phone.*`, `automation-inbox.*`, `automation-connect.js`, `automation-header.js`, `automation-ui.css`, `automation-setup.js`; app-shim plays server sounds from hansora.co | ✅ |
| 2026-11-03 | Phone calls: several numbers per business, 3 options (new number / forward / WhatsApp calls), contact box for countries without numbers (PRs 216, 237) | `automation-phone.html/js` | ✅ |
| 2026-11-03 | Comments-only mode: choose AI employee or Comments only when starting, "Add AI employee" later (PR 238) | `automation-setup.html/js`, `automation-dashboard.js`, `automation-agent.js`, `automation-comments.js`, `automation-connect.js` | ✅ |
| 2026-11-03 | Video Edit moved into Henshin (`/henshin.html?mode=edit`); background change, video relight, lipsync updates (PR 239) | `henshin.js`, `background-change.html`, `video-relight.html`, `lipsync.html`, menu link on every page | ✅ |

## How website changes reach the app

The app has its own copy of the website files in `app/web/` (made 2026-11-02 from `public/`, English pages).
The app does not read the website's folder, so each website change the owner reports is made again in `app/web/`
and listed in the table above.
