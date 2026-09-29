# Deploy Hansora Automation (private, hidden from Creative users)

Copy everything in this folder into your `real-web` repository **keeping the same folders**
(for example `public/automation.html` goes into `real-web/public/`), commit, and push to `main`.
Netlify deploys hansora.co as usual.

## New files (safe, only used by Automation)
- `public/automation*.html|js|css`, `public/vendor/` — the Automation pages
- `lib/automation/` — Automation server code
- `netlify/functions/automation-*` — Automation server functions
- `supabase/migrations/` — the SQL you already ran (kept for reference)
- `workers/automation-phone/` — phone worker (runs on Fly.io later, not on Netlify)
- `test/automation/`, `docs/` — tests and setup guides

## Replaced existing files (checked: GitHub main is still e9e04f2, so nothing newer is overwritten)
- `package.json`, `package-lock.json` — adds the libraries the functions need
- `netlify.toml` — adds the every-minute comment-automation job
- `netlify/edge-functions/inject-bottom-nav-inline.js` — only skips the Creative bottom bar on /automation pages
- `public/login.html` — after logging in from an Automation page you return to it; everyone else still goes to the homepage

## NOT included on purpose
- `public/header.js` — unchanged, so Creative users see no "AI Automation" link.

## After deploy, open
- https://hansora.co/automation.html  (landing)
- https://hansora.co/automation-dashboard.html  (log in, create an AI employee)
- https://hansora.co/automation-privacy.html, /automation-terms.html, /automation-data-deletion.html
