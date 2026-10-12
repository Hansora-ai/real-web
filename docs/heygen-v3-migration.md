# HeyGen API v3 migration

Hansora's Avatar III and Avatar IV image/audio generator uses only HeyGen v3
endpoints. HeyGen retires v1/v2 on November 1, 2026; complete the cutover before
October 31, 2026.

## Provider contracts

Checked against HeyGen's official documentation on October 12, 2026:

- [Endpoint comparison](https://developers.heygen.com/endpoint-version-comparison)
- [Photo creation](https://developers.heygen.com/docs/avatar-from-photo)
- [Create Avatar](https://developers.heygen.com/reference/create-avatar)
- [Get Avatar Look](https://developers.heygen.com/reference/get-avatar-look)
- [Avatar III](https://developers.heygen.com/avatar-iii)
- [Create Video](https://developers.heygen.com/reference/create-video)
- [Audio to Video](https://developers.heygen.com/audio-to-video)
- [Get Video](https://developers.heygen.com/reference/get-video)
- [Webhook events](https://developers.heygen.com/docs/webhook-events)

Avatar IV submits `POST /v3/videos` with `type: "image"`, a URL image source,
and `audio_url`. Avatar IV is the documented default image engine.

Avatar III does **not** support raw `type: "image"` input. It creates a photo
look using `POST /v3/avatars` with `type: "photo"` and `file: { type: "url", url }`.
The look ID is `data.avatar_item.id`, not the avatar group ID. It is saved in
the existing generation row's JSON metadata before any video submission.

Authenticated browser polls resume the submission by checking
`GET /v3/avatars/looks/{look_id}`. A processing look stays pending. A completed
look must advertise `avatar_iii` in `supported_api_engines`; then Hansora submits
`POST /v3/videos` with `type: "avatar"`, `avatar_id`,
`engine: { type: "avatar_iii" }`, and `audio_url`.

Both paths keep 1080p output, the existing aspect-ratio setting, callbacks, and
the existing Hansora duration-based prices. Credits are debited after a video
ID is accepted, not while the photo is processing. Repeated polls reuse the
saved inputs, a database submission lease, and deterministic provider
`Idempotency-Key` headers. No new environment variables or SQL migrations are
required.

All videos, including existing legacy jobs, are polled through
`GET /v3/videos/{video_id}`. The explicit status controls completion/failure;
HTTP errors are retryable polling errors. Callbacks support `event_data` but
act only as signals to fetch authoritative provider state. Completed video
files are validated and archived using the existing storage flow. Uncharged
photo failures do not receive credit refunds.

## Validation and release

Run `node --test test/heygen/migration.test.cjs` for mocked provider/database
coverage of both engines, delayed processing, retries, concurrent polls,
authorization, failures/refunds, legacy jobs, callbacks, and archival. Run
`npm run test:runtime` to verify Netlify packaging.

The automated checks do not make real HeyGen requests or spend credits. Before
production cutover, use the deployed preview and its server-side HeyGen key to
generate one short Avatar III and one Avatar IV video. Check completion, credit
debits, and history playback, then reload the page during photo processing to
verify resumption. Photo processing resumes while the owner has a lip-sync
page open; reopening the page also resumes pending history cards.
