# Wan 3.0 through reAPI

New `run-wan-3` jobs use reAPI's `wan3.0-video` model. The English, Russian and Armenian Search Models pages and MCP use the same customer pricing module. Existing KIE jobs keep their original task and checker.

## Features and limits

The existing website capabilities are preserved: text, first/last frames, up to 10 reference images, 5 reference videos, 5 reference audio clips, and native generated sound. Prompts accept up to 20,000 characters. Output stays at the existing 480p / 720p / 1080p choices, with explicit integer durations of 2–30 seconds. Frame inputs cannot mix with reference media.

Each reference video/audio clip must be 1–15 seconds. Videos combined may total 15 seconds; audio combined may total 15 seconds. Reference video plus output may total 30 seconds. The server downloads only this project's stored media and verifies durations before reserving credits. Media format and image-dimension limits are still enforced by the provider. Invalid submissions do not retain a charge.

Requests enable content filtering and disable the output watermark. Wan's `duration:-1` is intentionally rejected: reAPI bills automatic-length requests at the 30-second ceiling, and the website offers explicit durations.

Sources checked on 2026-10-21:
- https://reapi.ai/docs/wan-3-0
- https://reapi.ai/models/wan-3-0
- https://kie.ai/wan3.0-video

## Customer billing

Rates remain **6 / 10 / 20 displayed Hansora credits per billable second** at 480p / 720p / 1080p. One stored billing credit equals ten displayed credits.

Both providers bill input video seconds plus output seconds. The previous Wan route charged customers only for output; the new quote includes both, with an explanation beside the upload control. Images, audio references and generated sound add no extra video seconds.

| Example | 480p | 720p | 1080p |
| --- | ---: | ---: | ---: |
| 10-second output, no video input | 60 | 100 | 200 |
| 10-second reference + 10-second output | 120 | 200 | 400 |

Source durations retain their fractional seconds. Money is rounded upward once to the next whole displayed credit. Client duration claims are never trusted. If the server's measured quote differs, or an old client provides no video quote, the request returns 409 without a charge or provider submission. The website refreshes the quote; MCP returns the verified duration and asks for acceptance before retrying.

Using $0.01 per displayed Hansora credit and the published rounded reAPI rates ($0.036 / $0.071 / $0.142 per second), approximate gross generation margins become 40% / 29% / 29%. KIE's published $0.04 / $0.08 / $0.16 rates imply 33.3% / 20% / 20% at the same correctly billed customer rates. These estimates exclude payment fees, storage and other overhead, and use rounded provider prices rather than a paid invoice.

## Deployment and recovery

Reuse the existing secret `REAPI_API_KEY`. This change adds no environment variable or SQL migration. The existing `supabase/18_reapi_generation_billing.sql` from the Seedance integration must already be installed. Keep KIE configuration for existing jobs and other models.

Netlify includes the duration-probing WASM in `run-wan-3` and allows 60 seconds. The shared atomic billing transaction reserves once per run. Repeated clicks and retries cannot create a second paid task. Confirmed submission rejection or task failure refunds once. Uncertain submissions remain reserved while the signed webhook / scheduled sweep reconciles them. Successful output is archived through the existing history path, including its audio track.

Verification uses simulated provider responses and a local PostgreSQL-compatible database for transactions, real media probing, UI quote execution for all three locales, MCP tool requests and Netlify endpoint bundling. No paid provider generation or production deployment was performed.
