// Fast export: frames are drawn with the preview renderer and encoded by the
// device's own H.264 encoder (WebCodecs), sound is mixed once with Web Audio.
// Browsers without WebCodecs fall back to the FFmpeg exporter.
import { duration, locate, frameSize, audioClips, timelineCaptions } from "./core.mjs";
import { fit, drawOverlays } from "./render.mjs";
import { exportVideo, cancelExport as cancelFfmpeg, muxAudio } from "./export.mjs";
import { Muxer, ArrayBufferTarget } from "/vendor/mp4-muxer/mp4-muxer.mjs";

const FPS = 30, RATE = 48000;
let cancelled = false;
export function cancelExport() {
  cancelled = true;
  cancelFfmpeg();
}
const stop = () => { if (cancelled) throw Error("Export cancelled."); };

async function videoConfig(width, height) {
  if (!("VideoEncoder" in window) || !("VideoFrame" in window)) return null;
  const bitrate = Math.round(Math.min(12e6, Math.max(2e6, width * height * FPS * 0.12)));
  for (const codec of ["avc1.640034", "avc1.640028", "avc1.4d0034", "avc1.4d0028", "avc1.42003e", "avc1.42001f"])
    for (const hardwareAcceleration of ["prefer-hardware", "no-preference"]) {
      const config = { codec, width, height, bitrate, framerate: FPS, hardwareAcceleration, avc: { format: "avc" } };
      try { if ((await VideoEncoder.isConfigSupported(config)).supported) return config; } catch {}
    }
  return null;
}
async function aacSupported() {
  if (!("AudioEncoder" in window) || !("AudioData" in window)) return false;
  try { return (await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate: RATE, numberOfChannels: 2, bitrate: 160000 })).supported; }
  catch { return false; }
}

async function mixAudio(p, assets, total) {
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(total * RATE)), RATE), cache = new Map();
  const decode = (id) => {
    if (!cache.has(id)) cache.set(id, assets.get(id).file.arrayBuffer().then((b) => ctx.decodeAudioData(b)).catch(() => null));
    return cache.get(id);
  };
  const play = (buffer, volume, when, offset, length, loop = false) => {
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = buffer; source.loop = loop; gain.gain.value = volume;
    source.connect(gain).connect(ctx.destination);
    if (loop) { source.start(when, offset % buffer.duration); source.stop(when + length); }
    else source.start(when, offset, length);
  };
  let any = false, at = 0;
  for (const c of p.clips) {
    const length = c.end - c.start;
    if (assets.get(c.assetId)?.kind === "video" && (c.volume ?? 1) > 0) {
      const buffer = await decode(c.assetId);
      if (buffer) { play(buffer, c.volume ?? 1, at, c.start, length); any = true; }
    }
    at += length;
  }
  for (const t of audioClips(p)) {
    const buffer = await decode(t.assetId);
    if (buffer && t.volume > 0) { play(buffer, t.volume, t.start, t.in || 0, t.end - t.start, t.loop); any = true; }
  }
  return any ? ctx.startRendering() : null;
}
function wav(buffer) {
  const frames = buffer.length, out = new DataView(new ArrayBuffer(44 + frames * 4));
  const text = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  text(0, "RIFF"); out.setUint32(4, 36 + frames * 4, true); text(8, "WAVEfmt ");
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, RATE, true); out.setUint32(28, RATE * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true);
  text(36, "data"); out.setUint32(40, frames * 4, true);
  const l = buffer.getChannelData(0), r = buffer.getChannelData(1);
  for (let i = 0, o = 44; i < frames; i++, o += 4) {
    out.setInt16(o, Math.max(-1, Math.min(1, l[i])) * 0x7fff, true);
    out.setInt16(o + 2, Math.max(-1, Math.min(1, r[i])) * 0x7fff, true);
  }
  return new Blob([out], { type: "audio/wav" });
}
async function encodeAudio(muxer, buffer) {
  let failure = null;
  const encoder = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => (failure = e) });
  encoder.configure({ codec: "mp4a.40.2", sampleRate: RATE, numberOfChannels: 2, bitrate: 160000 });
  const step = RATE, l = buffer.getChannelData(0), r = buffer.getChannelData(1);
  for (let i = 0; i < buffer.length; i += step) {
    stop();
    const n = Math.min(step, buffer.length - i), data = new Float32Array(n * 2);
    data.set(l.subarray(i, i + n), 0); data.set(r.subarray(i, i + n), n);
    const chunk = new AudioData({ format: "f32-planar", sampleRate: RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / RATE) * 1e6), data });
    encoder.encode(chunk); chunk.close();
  }
  await encoder.flush(); encoder.close();
  if (failure) throw failure;
}

// One hidden <video> per source; frames are reached by seeking.
function seeker() {
  const players = new Map();
  return {
    async frame(asset, at) {
      let v = players.get(asset.id);
      if (!v) {
        v = document.createElement("video");
        v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = asset.url;
        players.set(asset.id, v);
        await new Promise((resolve, reject) => {
          if (v.readyState >= 1) return resolve();
          v.onloadedmetadata = resolve; v.onerror = () => reject(Error("Could not read a video for export."));
        });
      }
      const target = Math.min(Math.max(0, at), Math.max(0, asset.duration - 0.001));
      if (Math.abs(v.currentTime - target) > 0.0005 || v.readyState < 2) {
        await new Promise((resolve) => {
          const done = () => { clearTimeout(timer); v.removeEventListener("seeked", done); resolve(); };
          const timer = setTimeout(done, 4000);
          v.addEventListener("seeked", done);
          v.currentTime = target;
        });
      }
      return v;
    },
    close() { for (const v of players.values()) { v.removeAttribute("src"); v.load(); } },
  };
}

export async function fastExport(p, assets, report) {
  cancelled = false;
  const total = duration(p);
  if (!total) throw Error("Add media first.");
  await document.fonts.ready;
  const { width, height } = frameSize(p, assets);
  const config = await videoConfig(width, height);
  if (!config) return exportVideo(p, assets, report);
  report(1, "Mixing sound…");
  const sound = await mixAudio(p, assets, total);
  const nativeAac = sound ? await aacSupported() : false;
  stop();
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width, height, frameRate: FPS },
    ...(nativeAac ? { audio: { codec: "aac", numberOfChannels: 2, sampleRate: RATE } } : {}),
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  let failure = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (failure = e) });
  encoder.configure(config);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false }), captions = timelineCaptions(p), videos = seeker();
  const frames = Math.max(1, Math.round(total * FPS));
  try {
    for (let i = 0; i < frames; i++) {
      stop();
      if (failure) throw failure;
      const t = i / FPS;
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, width, height);
      const at = locate(p, t), a = assets.get(at?.clip.assetId);
      if (a?.kind === "video") {
        const v = await videos.frame(a, at.sourceTime), box = fit(v.videoWidth, v.videoHeight, width, height);
        ctx.drawImage(v, box.x, box.y, box.w, box.h);
      } else if (a?.kind === "image" && a.image) {
        const s = at.clip.style || { width: 100, x: 50, y: 50 }, f = fit(a.width, a.height, width, height);
        const bw = f.w * s.width / 100, bh = f.h * s.width / 100;
        ctx.drawImage(a.image, width * s.x / 100 - bw / 2, height * s.y / 100 - bh / 2, bw, bh);
      }
      drawOverlays(ctx, p, t, width, height, assets, { captions });
      const frame = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / FPS) });
      encoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
      if (i % 10 === 0) report(3 + 85 * i / frames, `Rendering ${Math.round(100 * i / frames)}%`);
    }
    await encoder.flush();
    if (failure) throw failure;
    if (nativeAac) { report(90, "Adding sound…"); await encodeAudio(muxer, sound); }
    muxer.finalize();
  } finally {
    if (encoder.state !== "closed") encoder.close();
    videos.close();
  }
  let blob = new Blob([target.buffer], { type: "video/mp4" });
  if (sound && !nativeAac) blob = await muxAudio(blob, wav(sound), report);
  report(100, "Your video is ready.");
  return blob;
}
