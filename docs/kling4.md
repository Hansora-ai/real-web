# Kling 4.0 and Henshin Lite

Kling 4.0 uses KIE's `kling-4.0/reference-to-video` Market endpoint and the existing `KIE_API_KEY` (or `KIEAI_API_KEY`). Standard Henshin continues to use reAPI Seedance 2.5.

Before deployment, apply `supabase/20_kling4_generation_billing.sql` after migration 18. This extends the existing atomic ledger and metadata protection to `kie-kling4` jobs. No new key is required. The Netlify build packages the FFmpeg WASM for both launchers.

## Prices

One displayed Hansora credit is $0.01; profiles store one tenth of the displayed amount. Provider credits are different units.

Search Models uses 25% gross margin: selling price = provider cost / 0.75, rounded up once to a whole displayed credit. KIE's regular rates, excluding top-up bonuses:

| Resolution | No video, per output second | With video, per billed second |
|---|---:|---:|
| 720p | $0.1425 | $0.085 |
| 1080p | $0.2125 | $0.1275 |

With video, billed duration = max(total input seconds + output seconds, 2 × output seconds). Without video, only output duration is billed. A 10-second source and 10-second result cost 227 / 340 displayed credits in Search Models.

Henshin Lite uses the owner's explicit retail rates: **220 / 340 displayed credits per 10 seconds** at 720p / 1080p. At regular KIE rates those give approximately **22.7% / 25% gross margin**, before fees. These fixed Lite prices intentionally override Search Models' 25% formula. Standard Henshin remains 175 / 380 / 900 displayed credits per 10 seconds.

## Source handling

Lite is the default model in Henshin. The server verifies source duration, requests the next whole output second (KIE accepts integers from 3 to 30), and uses the source aspect ratio. Henshin's source range remains 4–30 seconds. Quotes use that requested duration; fractional clips may therefore bill the next second. Lite delivers Kling’s finished video directly at that whole-second duration. Lite references are compressed to a maximum of 10 MB before upload; up to 10 images are supported.

Lite sends the verified source video with its audio intact and uses Kling's native `keep_original_sound` setting. It does not extract or reconnect a separate soundtrack. Standard Henshin also sends the original video and asks the model to retain or replace audio. Legacy soundtrack jobs retain their existing worker and recovery behavior.

Search Models exposes the reference-to-video variant with up to 10 images, 5 videos (2–30 seconds each, 30 seconds combined), and 3 named voice references, at most 15 items total. Prompts accept up to 10,000 characters; numbered references use `@image_1`, `@video_1`, `@voice_1`. Keyframe and subject creation are not exposed by this interface. Search Models always sends `keep_original_sound: true` automatically, with no audio settings panel.

## Billing and recovery

Launches authenticate the customer, verify source duration and quotes, and reserve credits atomically with the history row. Retries with the same run ID do not submit or charge again. Definite rejections and provider-confirmed task failures refund once. Timeouts or ambiguous submissions remain reserved for a signed callback or scheduled reconciliation, avoiding a duplicate paid task. Missing-task reservations refund after 30 minutes. Polling checks the task ID and model against KIE's canonical record; callback contents cannot forge a result. Output is archived before completion. Lite never queues a soundtrack or trimming job. Polling also recovers archived Lite results left in the older audio-finishing states into `result_url`, without another generation or charge.

Validation uses fixtures and mocked provider calls with a real PostgreSQL billing ledger. No paid provider generation is run automatically by tests.

Sources: https://kie.ai/kling-4-0 and https://docs.kie.ai/market/kling/v4-reference-to-video.md (checked 2026-10-22).
