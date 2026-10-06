# Hansora Henshin

`/henshin.html` adds Motion Transfer, Object Swap and Video Edit with the shared Hansora header/authentication, signed uploads, dedicated Henshin completion route and generation history. The default prompt explicitly assigns the source video to camera/framing/cuts/movement/timing and reference images to replacement identity. This is guidance to Seedance, not a guarantee of frame-perfect camera preservation or the proprietary Genjutsu workflow.

## Pricing

| Resolution | Stored credits / second | Displayed credits / second |
|---|---:|---:|
| 480p | 2 | 20 |
| 720p | 4.2 | 42 |
| 1080p | 9 | 90 |

Sources are normalized to compatible H.264/AAC MP4 while preserving their aspect ratio; video aspect ratios outside 0.4–2.5 and reference images outside the provider dimensions are rejected. Source duration is verified on the server with ffprobe, then rounded upward. A deterministic generation-row primary key reserves each run once. The Henshin balance update compares the current balance before patching; explicit provider submission rejection restores the debit. An ambiguous network failure retains the reservation until KIE's callback confirms the task; inspect `meta.submission_uncertain` if the callback never arrives. The dedicated `henshin-check` route authenticates user polling and uses a random per-run callback token. It verifies provider state rather than trusting callback result URLs, and can reconcile an uncertain submission using a signed callback task ID. Henshin polling queries the documented Market `/api/v1/jobs/recordInfo` endpoint. Temporary HTTP/provider errors remain pending. Result archival and refund claims reuse the existing `kie-check` internals. The Henshin checker has a 60-second function timeout; a provider timeout cannot overwrite a task/result already saved by a callback. Normal Seedance pricing is unchanged.

720p interprets the request's “780p” as the provider's supported resolution. KIE's live schema at https://docs.kie.ai/market/bytedance/seedance-2-5.md lists 480p, 720p and 1080p. Recheck provider availability before launch.

## Templates

Only the authenticated, email-confirmed `hansora.ai.bot@gmail.com` account may publish templates. The backend checks the owner independently of the UI. Templates use the existing `user_generations` table with provider `Henshin Template`; the public function exposes the example result, source video, reference images, transformation prompt, mode, resolution and audio setting. No schema migration is required. Browser FFmpeg compresses to H.264/AAC MP4 to approximately 921,600 pixels at 30 fps before upload. The owner publishes through `/henshin-template.html`, with separately compressed example and original source videos. A bounded detail overlay shows the result, source, images, prompt and mode. Recreate validates all saved assets before replacing the current generator inputs, and fills the source, images, prompt, mode, resolution and audio setting. Legacy video-only templates still load their motion and ask for references.

## Original audio

The server verifies the uploaded source and separates its soundtrack before submitting to Seedance. It saves the original audio stream in M4A, uploads a silent MP4 using video stream copy, and creates a 192 kbps MP3 timing reference. With Keep original audio enabled, Seedance receives the silent video and timing reference with generated audio disabled. Silent sources do not request new generated audio. Browser compression/upload still happens before the run is accepted; completion after acceptance needs no open browser.

The signed provider callback archives the generated video and saves a durable `restoring_audio` job. `henshin-finish-background` claims the job with an atomic lease, restores the saved soundtrack on the server, verifies audio/video streams and duration, uploads the final MP4 and only then fills `result_url`. It copies the generated video stream and encodes the final audio to AAC. It rejects duration differences over 0.3 seconds instead of stretching sound. Original audio has been transcoded during browser source compression and final output; there is no byte-identical audio claim.

The scheduled `henshin-sweep` runs every minute on production to recover missed callbacks, dispatch failures and expired leases. Retryable restoration errors persist in `audio_retry` with backoff; three attempts or a timing mismatch produce an explicit `audio_failed` state. Authenticated users can retry the server job or preview the intermediate generated video. Visitors cannot write their own final URL. The worker uses an internal HMAC token derived from the existing service key and only reads media archived in this Supabase project. Existing pre-update jobs with saved audio can also be finished by the worker. No additional API provider or media service is required.

## Deployment and validation

Uses the existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `KIE_API_KEY`, `SITE_BASE` and optional `KIE_BASE_URL` environment variables. The Netlify function configuration includes the single-thread FFmpeg WASM asset for source inspection/preparation, template inspection and the background finisher. Completion callbacks and worker dispatch use `DEPLOY_PRIME_URL` when present, then `SITE_BASE`/`URL`. Scheduled recovery runs on the published production deployment; callbacks still finish preview jobs. Media URLs must point to this Supabase project's public storage. Templates start empty until the owner publishes videos.

Run `npm run test:henshin` and `npm run test:runtime`. The 28 local/mock Henshin tests cover pricing, validation, camera/identity prompts, owner enforcement, verified duration, duplicate submissions, insufficient credits, refunds, callback races, silent source preparation, callback-to-server audio completion, concurrent worker claims, retryable errors, duration mismatch protection, internal authentication and scheduled recovery without browser polling. The fixture-based output retains its five-second duration and has both video and audio streams. The runtime checks bundle all 164 endpoints including the background worker and schedule. No paid generation was run; live provider generation, template publication and final deployed service integration remain unverified.

References:
- https://higgsfield.ai/genjutsu
- https://docs.kie.ai/market/bytedance/seedance-2-5
- https://ffmpegwasm.netlify.app/docs/getting-started/usage/

October 6 audio correction: finalization now runs entirely on the server after submission, including recovery when the visitor closes the page. Local/mock coverage passes without generation credits.

## Library and result interface

Henshin is first in the shared Video and Features menus, with a dark transformation icon. Change `heroVideoURL` in `public/henshin-config.js` to replace the banner video. Uploaded source, example and reference media all have removal controls. Result cards use portrait, landscape or square proportions inferred from saved metadata and the actual media. Clicking a result opens the bounded detail preview with Copy Prompt, Recreate and Download. Recreate restores the saved original source, references, user prompt, mode, resolution and audio option without submitting a paid run. Legacy Seedance rows without saved source inputs can be previewed and downloaded; their missing inputs cannot be reconstructed.

The public library prefetches and deduplicates recipe requests, keeps a 30-second session cache, and uses a 10-second shared response cache. New templates include a small JPEG poster and measured aspect ratio. Only visible videos load and loop automatically, muted; offscreen videos pause and reduced-motion preferences disable automatic playback. Older templates fall back to their existing video. Owner-only Delete unpublishes the matching template after checking the confirmed account on the server; the recipe and stored files remain intact. Templates also appear in Search Models because both use `user_generations`.
