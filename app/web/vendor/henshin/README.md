Self-hosted, unmodified npm distributions for browser media processing:
- @ffmpeg/ffmpeg 0.12.15 (MIT), https://github.com/ffmpegwasm/ffmpeg.wasm
- @ffmpeg/core 0.12.10 (GPL-2.0-or-later), https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/packages/core
FFmpeg source/build scripts: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10
The single-thread core loads lazily and does not require cross-origin isolation.

- heic2any 0.0.4 (MIT), https://github.com/alexcorvi/heic2any
  Loaded only when a HEIC/HEIF photo needs conversion; bundled libheif notices remain in the distribution.
