# Hansora Henshin

`/henshin.html` adds Motion Transfer and Object Swap with the shared Hansora header/authentication, signed uploads, KIE completion checker and generation history. The default prompt explicitly assigns the source video to camera/framing/cuts/movement/timing and reference images to replacement identity. This is guidance to Seedance, not a guarantee of frame-perfect camera preservation or the proprietary Genjutsu workflow.

## Pricing

| Resolution | Stored credits / second | Displayed credits / second |
|---|---:|---:|
| 480p | 2 | 20 |
| 720p | 4.2 | 42 |
| 1080p | 9 | 90 |

Sources are normalized to compatible H.264/AAC MP4 while preserving their aspect ratio; video aspect ratios outside 0.4–2.5 and reference images outside the provider dimensions are rejected. Source duration is verified on the server with ffprobe, then rounded upward. A deterministic generation-row primary key reserves each run once. The Henshin balance update compares the current balance before patching; explicit provider submission rejection restores the debit. An ambiguous network failure retains the reservation until KIE's callback confirms the task; inspect `meta.submission_uncertain` if the callback never arrives. Failed accepted generations use the existing `kie-check` refund path. Normal Seedance pricing is unchanged.

720p interprets the request's “780p” as the provider's supported resolution. KIE's live schema at https://docs.kie.ai/market/bytedance/seedance-2-5.md lists 480p, 720p and 1080p. Recheck provider availability before launch.

## Templates

Only the authenticated, email-confirmed `hansora.ai.bot@gmail.com` account may publish templates. The backend checks the owner independently of the UI. Templates use the existing `user_generations` table with provider `Henshin Template`; the public function exposes only id/title/video URL/duration. No schema migration is required. Browser FFmpeg compresses to H.264/AAC MP4 to approximately 921,600 pixels at 30 fps before upload. Recreate loads the video and asks users for their own replacement references.

## Original audio

When enabled, the browser extracts a 192 kbps MP3 soundtrack, uploads it as a timing reference and requests generation without generated audio. Once KIE finishes, browser FFmpeg replaces the generated soundtrack and copies the generated video stream into MP4. It rejects duration differences over 0.3 seconds rather than stretching the sound. The completed file is uploaded and saved to the user's own generation row. Silent sources skip extraction/restoration. Original audio is transcoded; no byte-identical audio claim is made.

Keep the page open for audio restoration; if it closes, opening Henshin again resumes restoration from saved audio references. Browser memory and CORS access to result URLs are required. Failed restoration has a Retry audio action and a clearly labeled preview of the generated video. A timing mismatch requires inspecting the generated result, not automatic stretching. Server generation continues with the existing callback even while the page is closed.

## Deployment and validation

Uses the existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `KIE_API_KEY`, `SITE_BASE` and optional `KIE_BASE_URL` environment variables. The Netlify function configuration includes the single-thread ffprobe WASM asset. Media URLs must point to this Supabase project's public storage. Templates start empty until the owner publishes videos.

Run `npm run test:henshin`. Tests cover all prices, validation, reference prompt construction, owner enforcement, actual source-duration inspection, duplicate submissions, insufficient credits, explicit refunds and uncertain submission handling. A browser test verified compression, audio extraction and restoration on a synthetic five-second H.264/AAC video; output remained five seconds. Live paid KIE generation still needs a deployment smoke test with the existing credentials.

References:
- https://higgsfield.ai/genjutsu
- https://docs.kie.ai/market/bytedance/seedance-2-5
- https://ffmpegwasm.netlify.app/docs/getting-started/usage/
