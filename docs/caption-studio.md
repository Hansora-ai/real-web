# Caption Studio — local testing build

Status: local implementation on `codex/caption-studio-local`, based on `Hansora-ai/real-web` main commit `8257a464d9218360c406c66dec496448c634f3a2`. No GitHub push, Netlify deployment, database migration, or live customer change has been made.

## Start and test

Use Node.js 22 or newer. Install dependencies with `npm install` when using the standalone source bundle. Native FFmpeg and FFprobe on the PATH enable fast local export; the browser fallback works without them.

```sh
npm run dev:caption-studio
```

Open `http://127.0.0.1:4173/caption-studio.html`. The local server binds to this computer only. The page is also linked from the existing English, Armenian, and Russian Video Edit pages.

Click **Try sample** to test immediately. This generated six-second video has example mixed-language captions and a quiet tone; it is not a sample of ElevenLabs transcription accuracy. Upload real speech to test transcription.

A suggested test:

1. Use **Upload media** for videos, images, and audio together. The first upload immediately adds a clip to the preview. All files appear in one media library. **＋** adds a video/image to the main sequence or audio to an audio track. Still images default to **3 seconds**, can be extended with their edges, and can sit before/between/after videos. Drag a library item onto a main clip to insert it before that clip. **＋ Layer** adds an image above your footage; **♫ Audio** extracts a video file’s sound into an editable track.
2. Generate captions, import SRT/VTT, or add captions manually.
3. Select a caption and edit its text or source timing; valid changes save automatically. Caption size applies to every subtitle, regardless of the selected style scope. Adjust **Caption length** to regroup all subtitles into shorter or longer phrases without calling ElevenLabs again. 25% groups up to 3 words, 50% up to 6, and 100% up to 12; natural pauses and sentence endings are preserved. Drag captions on the preview to reposition them. Double-click text to type on the preview; Enter finishes, Shift+Enter inserts a line break. Drag any selection handle to resize. Resizing a subtitle still changes every subtitle’s font size.
4. Drag clip edges to shorten footage. Move the playhead and click **Split**, **Duplicate**, **Delete**, or **Reverse**. Drag clips to reorder them; use timeline zoom for precision. Captions follow normal cuts. Reversal creates a new source without the old transcript, since its speech is now backwards; undo restores the original clip.
5. Add text in the Text tab. Image/text layers get separate tracks above the main sequence, and audio gets tracks below it. Drag a layer to move it; drag its edges to trim; Split/Duplicate/Delete operate on the selected layer or audio clip. Splits stay in the same lane. Drag the horizontal **volume line** on an audio clip up/down to change its gain; the inspector also offers volume and looping. Up/down toolbar buttons change selected image/text stacking order. Use **Layers** to expand the timeline and **Edit** to open selection controls. **Preview** opens a larger focused view. Choose an aspect ratio.
6. Export MP4. The finished file contains the video edits and styled captions.
7. Save the `.hansora` project, reload, and reopen it. Media is included in the project file. **Resume saved project** restores the browser's last draft.

## ElevenLabs connection

The Netlify endpoint uses the same key resolution as the existing audio functions: `Elevan_labs_api1` first, then `ELEVENLABS_API_KEY`, `Elevan_labs_api`, and the existing alternative names. No Netlify environment variable was changed. It verifies the existing Supabase session and gives the browser a short-lived, single-use `batch_scribe` token. The browser uploads the selected source video directly to ElevenLabs, requesting `scribe_v2`, word timestamps, and optional language hint. Auto leaves language selection to ElevenLabs for mixed speech. No private API key is included in frontend code or saved projects.

The currently running local preview is connected using the existing Netlify **Local development** value, kept in server memory. A live single-use token request and a spoken English transcription succeeded. The user-facing API-key form has been removed. No key is stored in frontend code, local projects, the source bundle, or these notes.

For a fresh local server, run it with the existing ElevenLabs environment variable available (for example through an authenticated Netlify development setup). Netlify's hosted environment is not automatically inherited by a standalone Node process. Restarting this particular preview server clears its memory-only connection. On Netlify, the authenticated endpoint reads the configured environment directly.

The editor now loads the repository's unmodified `header.js` and `header.css` in both local and hosted modes. It uses a compact project toolbar, a media library, a central preview, an inspector showing only the relevant controls, and a full-width timeline. Extra caption options are collapsed by default.

## Included

- Real media thumbnails and a preview before adding footage, timeline filmstrips, edge-drag trimming, splitting, deleting, duplication, reverse, button/drag reordering, playhead seeking, and timeline zoom.
- Source-based caption timing across edits; edited words get estimated timing within the edited caption's start/end interval.
- Automatically saved caption text/timing, global subtitle size, global percentage-based caption regrouping, line breaks, splitting, merging; SRT/VTT import and export.
- Five caption presets, fonts, font upload, colors, background opacity, outline, shadow, bold, alignment, width, and position.
- Word highlighting and pop-in animation; draggable captions and image/text layers.
- Original, 9:16, 16:9, 1:1, and 4:5 frame ratios. Footage is fitted with letterboxing, not cropped.
- Still images in the main sequence; simultaneous text/image overlay tracks; multiple trimmed/moved/split audio tracks with source offsets, loop option, waveform previews, and draggable volume lines. Old single-music projects migrate automatically into an editable audio lane.
- MP4 export at 480p, 720p, or 1080p resolution (the shorter frame edge), H.264 video and AAC audio.
- Browser draft autosave, portable `.hansora` projects with media, undo/redo, and desktop/phone layouts.

## Export implementation

Exports now use a shared **single-pass** FFmpeg graph: trim, normalize, concatenate, composite the styled captions/layers, mix music, and encode the final MP4 once. This removes the previous separate video encode for every clip followed by a second full-video encode for captions. Silent sources get a silent track. Timed transparent PNG states use the same canvas renderer as the preview, including uploaded fonts and word highlighting.

The local Node server detects installed FFmpeg/FFprobe and uses them for faster rendering on this computer. Media stays local, temporary files are removed after download/cancellation, unused results expire after ten minutes, and rendering progress is streamed to the dialog. The server accepts validated projects and media, never browser-supplied shell commands or paths. With native tools absent, the same one-pass graph runs through the repository's existing self-hosted FFmpeg WebAssembly. Set `CAPTION_STUDIO_BROWSER_EXPORT=1` to explicitly test this fallback. Native integration tests skip when FFmpeg is absent.

This local acceleration is **not a Netlify render service**. Netlify continues to use the browser fallback until a dedicated render worker is added. Long or complex browser exports remain limited by device CPU and memory. Reverse still uses short browser-rendered chunks joined in reverse order, bounding decoded-frame memory; the original source remains in the library.

The bundled FFprobe can report `-1` after successfully writing JSON, so the exporter validates the generated probe output rather than relying on its return value. A fresh probe file is required for every source.

## Verification completed

- 24 Caption Studio tests (including the existing Netlify key names): multilingual grouping, trims/cuts/reordering, silence gaps, SRT/VTT round trips, caption splitting, animation events, imported project validation, single-use-token secrecy, missing/rejected key behavior, and endpoint authentication/method handling. The native integration test verifies cuts, audio-free footage, overlay pixels, MP4 music, duration/codecs, download cleanup, invalid uploads, cross-origin rejection, cancellation and retry.
- 7 existing Netlify runtime tests, including bundling all 173 endpoints.
- Browser tests: source/sample loading, editing multilingual text, explicit line breaks, splitting and reordering footage, caption placement controls and direct dragging, title/logo/music layers, autosave/reload, and `.hansora` save/reopen. A separately uploaded clip without audio was also exported successfully.
- Actual browser-generated MP4 downloads checked with native FFprobe: landscape 480×270 H.264/AAC, 6.016 seconds; portrait 270×480 H.264/AAC with reordered footage, edited captions, title, logo, and music, 6.000 seconds. After standardizing resolution choices to the shorter frame edge, a further export at 480×854 with three clips including a silent video succeeded at 7.500 seconds.
- Layout checked at 393×852 and 1440×1000. The simplified layout is also checked at these sizes. Shared-header requests may report missing optional functions on the standalone static local server; the editor itself has no console errors.

- Revised browser checks: thumbnail import without automatically adding to the timeline, media preview and add, draggable trimming, split and duplicate, reverse, generated caption editing, MP4 export (480×854, H.264/AAC), and a live ElevenLabs transcription. A reversed segment was compared with a native FFmpeg reference (SSIM 0.999786; a three-second reversal across chunk boundaries scored 0.999810).

- Timeline fixes: the ruler scale stays fixed after trims, left-edge dragging holds the out-point in place, and source-aligned thumbnail tiles crop without stretching. The blue scrubber is removed; the white playhead supports dragging and keyboard seeking. Split uses the clip at the playhead, even when another clip was selected.
- Caption generation now validates that returned speech overlaps the selected trimmed clip, preserves existing captions if it does not, displays a persistent explanation, and selects/seeks the first visible caption on success. Live checks confirmed both successful captions on a speech fixture and the outside-trim message on the user's video.

- Latest UI checks: text saves without an Apply button; a font-size change on one selected caption also appears on the next caption; global word-count changes turned the edited sample into 14 one-word captions and then two longer captions. MP4 audio and MP3 imports both succeeded; music volume was checked at 90% and 10%.
- Performance fixtures on this computer: a 36.2-second black-screen/audio video exported at 1920×1080 in 1.96 seconds through the local renderer; a three-clip 8.03-second edit with animated multilingual captions and MP4 background audio reached its download in 1.93 seconds. These are measured fixtures, not a guarantee for every project. The browser fallback produced a 12-second, two-clip 854×480 H.264/AAC export with captions and music.

- Multitrack revision: mixed image/MP3 import through one picker, 3-second images between videos, simultaneous image/two-text layers, preview resizing and direct typing, percentage regrouping, timeline movement, audio-edge trimming, dragging volume from 60% to 24%, and audio split into two pieces on the same lane were checked in the browser. A portable project reopened with its layers, resized styles and audio tracks intact; playback crossed the still-image segment into the following video.
- Export checks for this revision: native integration tests verify image pixels between video segments plus multiple offset audio tracks; the main local editor produced a 15-second 854×480 H.264/AAC multitrack MP4. The browser fallback produced a 3-second 480×480 image/text/audio MP4. The desktop editor now keeps its toolbar below the shared header and scrolls tracks within the timeline.

## First-version boundaries

The project media limit is 200 MB total; images are limited to 20 MB / 20 megapixels, and custom fonts to 10 MB. Browser memory and CPU still limit how large an export can be. Export takes place with the tab open. Keep portable project files as backups; browsers may remove stored drafts.

A transcription is associated with a source asset, so changes to its caption text/style apply to all reused segments of that same asset. Independent title/image layers use edited timeline times and do not automatically move with a clip.

Before a public rollout, connect transcription to Hansora's chosen credit/subscription policy and a durable server-side quota. The current endpoint's per-instance token throttle is for testing, and does not provide global account billing limits. Long projects should use a server render worker. Translation, automatic silence removal, transitions, and advanced cropping are outside this version.

Fonts are self-hosted Noto Sans and Noto Sans Armenian under the included OFL licenses. FFmpeg licensing files remain alongside its existing vendor distributions.

## Preview-first desktop and phone revision

The workspace reserves most of its height for the preview, fits the canvas explicitly to its aspect ratio, and opens the inspector only with **Edit**. The shared Hansora header/auth controls remain; the editor uses an opaque header backdrop to avoid a WebKit blur bleeding over Project/Export. **Layers** expands the timeline. **Preview** hides the timeline for a larger view; **Timeline** or Escape returns to cutting. Desktop editing tabs remain available in the larger view. At phone widths the preview and Export stay on screen, while Media/Captions/Text/Audio open a closable bottom drawer. Portrait uploads/reopened projects use a larger focused preview with those four tools available on desktop and phone; **Timeline** returns to cutting and layer controls. This layout is checked at 420×669 and 1280×800; this is browser responsive testing, not a physical iOS/Android device certification.

**My generations** reads the existing `user_generations` table with the current Supabase session, an explicit owner filter, and existing row-level security. It lists completed image/video/audio result URLs and imports selected media locally. No database write is made. The test browser is logged out, so the actual private-library download flow still needs a signed-in check. A remote host that blocks browser downloads will require downloading from the existing library and importing that file.

Preview sound now passes through independent Web Audio gain nodes. **Audio** shows each video's original sound separately from added music/voice tracks. Extracting a video’s sound into a track mutes reused clips of that same source to avoid duplicate playback. Preview mute is a master gain; track volumes remain unchanged for export. Audio start/end drags crop a waveform drawn against the original source duration, with a live duration label; the waveform no longer compresses into the shorter clip.

Verification for this revision includes actual preview output levels at 100%, 25%, and 0%; a decoded export check that 25% is about 12 dB quieter and 0% is silent; and a two-tone source trim proving the correct later tone is selected without stretching its pitch. All 24 tests pass. The preview mixer and owner-scoped generation query also have targeted regression tests.

The final UI export check produced an 8-second 480×854 H.264/AAC portrait MP4 with imported multilingual captions and a trimmed 25% audio track. The phone preview and its Caption drawer were also checked in the larger focused mode.
