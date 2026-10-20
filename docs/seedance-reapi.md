# Seedance migration to reAPI

## Deployment order

1. Run `supabase/18_reapi_generation_billing.sql` in the project's Supabase SQL editor **before deploying this branch**. It is safe to run again. The new launchers fail closed if its RPC is missing; they never fall back to a non-atomic balance update.
2. Netlify needs the secret `REAPI_API_KEY` in the Functions environment for the deployment context being tested. Keep the existing Supabase service credentials and KIE credentials: earlier KIE generations and other models still use them. No provider key belongs in public JavaScript.
3. Deploy through the normal Netlify build (`npm run build:functions`). The build includes the new checker and minute-by-minute recovery function. The existing Henshin audio worker and recovery schedule remain active.

This branch has not run a paid generation or changed production data. After deployment, test a short approved generation, check its saved row and balance, and check the original-audio option on Henshin. Mocked integration tests cover rejection/refund paths without spending provider credits.

## Routes and modes

- Search Models: `run-seedance-2` and `run-seedance-25` now call reAPI for text, images, frames, video and audio references. The former text-only `*-cheap` routes forward to the same launchers, so stale clients also migrate. Standard uses `doubao-seedance-2.0-face` / `doubao-seedance-2.5-face`; 2.0 Fast uses `doubao-seedance-2.0-fast-face`. Eco is not selected. Seedance 2.0 Mini is a separate model and is unchanged.
- Henshin: Seedance 2.5 with `omni_reference_task_type: "edit"`, `duration: -1` and `size: "adaptive"`. The server verifies the source length. Original audio is extracted and restored by the existing durable worker when selected.
- New jobs use authenticated `reapi-check` polling and signed callbacks. Callback tokens are derived server-side and are not stored in customer-readable history metadata. Callback data never supplies a trusted result or failure: the server checks `GET /api/v1/tasks/{id}` itself.
- Existing KIE/BytePlus rows retain their original checker, price and refund amount. They are not resubmitted to reAPI.
- Prompts are forwarded without shortening; the request limit is 20,000 characters. Henshin allows 18,000 user characters to leave room for its built-in instructions. Watermark is off, original encoding is requested with `bitrate_mode: "default"`, and content filtering remains enabled.

## Customer prices

`public/seedance-pricing.js` supplies browser, server and catalog quotes. One stored balance credit is ten displayed credits. Prices round up to whole displayed credits because the balance column stores 0.1 steps. Gross margins exclude payment processing, storage and other operating costs. Provider rate-card snapshot: 2026-10-20; revisit it when reAPI changes prices.

| Standard model / ten seconds | 480p | 720p | 1080p |
| --- | ---: | ---: | ---: |
| 2.5 without video input | 146 | 318 | 757 |
| 2.0 without video input | 88 | 184 | 451 |
| 2.5 edit, ten-second source → ten-second result (Henshin or Search) | 175 | 380 | 900 |

Non-video-input 480p/720p/1080p prices target 18%/16%/15% gross margin using the published rounded rate card. Seedance 2.0 4K uses 15%; Fast uses the margin for its selected resolution. The 2.5 video-input prices are the explicitly agreed 175/380/900 table, not an exact percentage target.

Video references add their **measured combined length** to output seconds. Seedance 2.5 also applies the provider's `ceil(5 × output / 3)` minimum. With multiple clips or different input/output lengths, the live quote reflects these seconds rather than assuming a blanket 2× multiplier. Images/audio add no video seconds. The server refuses a changed quote before billing and the interface updates the quote for review.

## Billing and recovery

The SQL transition function reserves the run and debits the balance in one transaction. A deterministic row ID prevents duplicate paid submissions for the same account/run, including concurrent requests. The server-owned history guard prevents clients changing charge/refund fields or deleting an unfinished reAPI row.

Confirmed submit rejections and failed tasks refund the frozen original charge once, atomically with the failure state. Temporary HTTP/polling errors never count as provider failure. Submission POSTs are never automatically retried. An ambiguous submission waits for its signed webhook; if no task ID can be recovered after thirty minutes, recovery refunds it without resubmitting. Known provider task IDs are never expired by this orphan policy.

Successful outputs are archived to the existing history bucket before completion. Missed callbacks and archival retries are recovered by `reapi-sweep`; Henshin soundtrack retries retain their existing worker.

## Validation and sources

Run `npm run test:reapi`, `npm run test:henshin`, `npm run test:kie`, `npm run test:mcp` and `npm run test:runtime`.

- [Seedance 2.5 API](https://reapi.ai/docs/seedance-2-5), [price card](https://reapi.ai/models/seedance-2-5)
- [Seedance 2.0 API](https://reapi.ai/docs/seedance-2-0), [price card](https://reapi.ai/models/seedance-2-0)
- [Tasks, polling and callbacks](https://reapi.ai/docs/api/tasks)

The 2.0 playground still mentions a 4,000-character prompt cap; its API reference documents 3–20,000. This implementation follows the API reference. No paid test has yet verified the upstream's long-prompt behavior.
