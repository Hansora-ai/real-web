// Reads a video's frames in order with the device's own decoder (WebCodecs),
// instead of seeking a <video> element once per frame. Seeking restarts decoding
// at the previous keyframe every time, which made exports take minutes or hours.
// Only MP4/MOV sources are read this way; anything else returns null.

let library = null;
function loadMp4box() {
  if (window.MP4Box) return Promise.resolve();
  library ||= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/mp4box/mp4box.all.min.js";
    script.onload = () => resolve();
    script.onerror = () => { library = null; reject(Error("Could not load the video reader.")); };
    document.head.append(script);
  });
  return library;
}

async function demux(file) {
  await loadMp4box();
  const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const mp4 = window.MP4Box.createFile();
    let track = null;
    const samples = [];
    mp4.onError = (e) => reject(Error(String(e)));
    mp4.onReady = (info) => {
      track = info.videoTracks?.[0];
      if (!track) return resolve(null);
      mp4.setExtractionOptions(track.id, null, { nbSamples: Infinity });
      mp4.start();
    };
    mp4.onSamples = (_id, _user, list) => samples.push(...list);
    buffer.fileStart = 0;
    mp4.appendBuffer(buffer);
    mp4.flush();
    if (!track) return resolve(null);
    const entry = mp4.getTrackById(track.id).mdia.minf.stbl.stsd.entries[0];
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    let description;
    if (box) {
      const stream = new window.DataStream(undefined, 0, window.DataStream.BIG_ENDIAN);
      box.write(stream);
      description = new Uint8Array(stream.buffer, 8); // without the box header
    }
    resolve({ track, samples, description });
  });
}

export async function openVideo(asset) {
  if (!("VideoDecoder" in window) || !("EncodedVideoChunk" in window)) return null;
  if (!/\.(mp4|m4v|mov)$/i.test(asset.file?.name || "") && !/mp4|quicktime/i.test(asset.file?.type || "")) return null;
  let parsed;
  try { parsed = await demux(asset.file); } catch { return null; }
  if (!parsed?.samples.length) return null;
  const { track, samples, description } = parsed;
  const config = { codec: track.codec, codedWidth: track.video.width, codedHeight: track.video.height, ...(description ? { description } : {}) };
  try { if (!(await VideoDecoder.isConfigSupported(config)).supported) return null; } catch { return null; }
  // Presentation times in microseconds, starting at 0 like <video>.currentTime.
  const first = Math.min(...samples.map((s) => s.cts));
  const chunks = samples.map((s) => ({
    time: ((s.cts - first) * 1e6) / s.timescale,
    key: s.is_sync,
    chunk: () => new EncodedVideoChunk({ type: s.is_sync ? "key" : "delta", timestamp: ((s.cts - first) * 1e6) / s.timescale, duration: (s.duration * 1e6) / s.timescale, data: s.data }),
  }));
  return new SequentialVideo(config, chunks);
}

const hasDequeue = () => "ondequeue" in VideoDecoder.prototype;

class SequentialVideo {
  constructor(config, chunks) {
    this.config = config;
    this.chunks = chunks;
    this.keys = chunks.flatMap((c, i) => (c.key ? [i] : []));
    this.queue = [];
    this.next = 0;
    this.flushed = false;
    this.failure = null;
    this.wake = null;
    this.decoder = null;
  }
  // Last keyframe (decode order index) whose time is at or before `at`.
  keyBefore(at) {
    let k = this.keys[0] ?? 0;
    for (const i of this.keys) if (this.chunks[i].time <= at) k = i; else break;
    return k;
  }
  reset(at) {
    this.close();
    this.flushed = false;
    this.failure = null;
    this.decoder = new VideoDecoder({
      output: (frame) => {
        this.queue.push(frame);
        this.queue.sort((a, b) => a.timestamp - b.timestamp);
        this.wake?.();
      },
      error: (e) => { this.failure = e; this.wake?.(); },
    });
    if (hasDequeue()) this.decoder.addEventListener("dequeue", () => this.wake?.());
    this.decoder.configure(this.config);
    this.next = this.keyBefore(at);
  }
  // The frame on screen at `seconds`. Export asks for times in order, so frames
  // are decoded once, front to back; a jump back or far ahead restarts at a keyframe.
  async frame(seconds) {
    const at = seconds * 1e6 + 500;
    const fed = this.chunks[this.next - 1]?.time ?? -Infinity, key = this.keyBefore(at);
    if (!this.decoder || this.decoder.state === "closed" || (this.queue.length && at < this.queue[0].timestamp - 1000) ||
        (key >= this.next && this.chunks[key].time - fed > 2e6)) this.reset(at);
    for (;;) {
      if (this.failure) throw this.failure;
      while (this.queue.length >= 2 && this.queue[1].timestamp <= at) this.queue.shift().close();
      const [head, after] = this.queue;
      if (head && (after || this.flushed || head.timestamp > at)) return head;
      if (this.next < this.chunks.length) {
        while (this.next < this.chunks.length && this.decoder.decodeQueueSize < 8) this.decoder.decode(this.chunks[this.next++].chunk());
        // Wait for a decoded frame, or for room to send more chunks.
        await new Promise((resolve) => {
          this.wake = resolve;
          if (!hasDequeue() || this.decoder.decodeQueueSize < 8) setTimeout(resolve, hasDequeue() ? 50 : 1);
        });
        this.wake = null;
      } else if (!this.flushed) {
        await this.decoder.flush().catch((e) => (this.failure ||= e));
        this.flushed = true;
      } else if (head) return head;
      else throw Error("Could not read a frame of this video.");
    }
  }
  close() {
    for (const f of this.queue) f.close();
    this.queue = [];
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
  }
}
