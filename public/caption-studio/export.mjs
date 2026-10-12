import { duration, audioClips, eventTimes, frameSize } from "./core.mjs";
import { exportPlan } from "./export-plan.mjs";
import { drawOverlays } from "./render.mjs";
let active = null;
export function cancelExport() {
  active?.terminate();
  active = null;
}
function loadScript() {
  return new Promise((resolve, reject) => {
    if (window.FFmpegWASM) return resolve();
    const s = document.createElement("script");
    s.src = "/vendor/henshin/ffmpeg.js";
    s.onload = resolve;
    s.onerror = () => {
      s.remove();
      reject(
        Error("Could not load export tools. Refresh the page and try again."),
      );
    };
    document.head.append(s);
  });
}
async function overlayFrames(p, assets, report, write, cancelled) {
  const { width, height } = frameSize(p, assets), total = duration(p);
  if (!Object.values(p.transcripts).some(a => a.length) && !p.layers.length) return [0, total];
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d"), times = eventTimes(p);
  for (let i = 0; i < times.length - 1; i++) {
    if (cancelled()) throw Error("Export cancelled.");
    ctx.clearRect(0, 0, width, height);
    drawOverlays(ctx, p, times[i] + .00001, width, height, assets);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw Error("Could not draw captions.");
    await write(`overlay${i}.png`, blob);
    report(3 + 17 * i / (times.length - 1), "Preparing captions…");
  }
  return times;
}
export async function exportVideo(p, assets, report) {
  if (!duration(p)) throw Error("Add media first.");
  await document.fonts.ready;
  const status = await fetch("/api/caption-studio/status").then(r => r.json()).catch(() => ({}));
  if (status.nativeExport) return exportLocal(p, assets, report);
  return exportBrowser(p, assets, report);
}
async function exportLocal(p, assets, report) {
  const controller = new AbortController();
  active = { terminate: () => controller.abort() };
  try {
    report(1, "Preparing local export…");
    const data = new FormData(), used = [...new Set(p.clips.map(c => c.assetId))];
    const times = await overlayFrames(p, assets, report, (name, blob) => data.append(name, blob, name), () => controller.signal.aborted);
    data.append("meta", JSON.stringify({ project: p, assets: used.map(id => ({ id, kind: assets.get(id).kind })), audioAssets: [...new Set(audioClips(p).map(a=>a.assetId))].map(id=>({id})), times }));
    used.forEach((id, i) => data.append(`media${i}`, assets.get(id).file, `media${i}`));
    [...new Set(audioClips(p).map(a=>a.assetId))].forEach((id,i)=>data.append(`audio${i}`,assets.get(id).file,`audio${i}`));
    report(22, "Sending media to the local renderer…");
    const response = await fetch("/api/caption-studio/render", { method: "POST", body: data, signal: controller.signal });
    if (!response.ok) throw Error((await response.json()).error || "Local export failed.");
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let pending = "", url;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n"); pending = lines.pop();
      for (const line of lines.filter(Boolean)) {
        const event = JSON.parse(line);
        if (event.error) throw Error(event.error);
        report(event.progress, event.label);
        if (event.url) url = event.url;
      }
    }
    if (!url) throw Error("Local export ended before the video was ready.");
    const video = await fetch(url, { signal: controller.signal });
    if (!video.ok) throw Error("Could not read the finished video.");
    return await video.blob();
  } catch (error) {
    if (controller.signal.aborted) throw Error("Export cancelled.");
    throw error;
  } finally { active = null; }
}
async function exportBrowser(p, assets, report) {
  await loadScript();
  const ff = new window.FFmpegWASM.FFmpeg();
  active = ff;
  let log = [];
  ff.on("log", ({ message }) => { log.push(message); log = log.slice(-12); });
  ff.on("progress", ({ time }) => report(Math.min(98, 25 + 73 * time / (duration(p) * 1e6)), "Rendering your video…"));
  try {
    report(1, "Loading browser export tools…");
    await ff.load({ coreURL: "/vendor/henshin/ffmpeg-core.js", wasmURL: "/vendor/henshin/ffmpeg-core.wasm" });
    const used = [...new Set(p.clips.map(c => c.assetId))], audio = new Map();
    for (let i = 0; i < used.length; i++) {
      await ff.writeFile(`media${i}`, new Uint8Array(await assets.get(used[i]).file.arrayBuffer()));
      if (assets.get(used[i]).kind === "image") { audio.set(used[i],false); continue; }
      await ff.deleteFile("probe.json").catch(() => {});
      await ff.ffprobe(["-v","error","-show_entries","stream=codec_type","-of","json",`media${i}`,"-o","probe.json"]);
      const probe = JSON.parse(new TextDecoder().decode(await ff.readFile("probe.json")));
      audio.set(used[i], probe.streams?.some(s => s.codec_type === "audio"));
    }
    let overlays = false;
    const times = await overlayFrames(p, assets, report, async (name, blob) => {
      overlays = true;
      await ff.writeFile(name, new Uint8Array(await blob.arrayBuffer()));
    }, () => active !== ff);
    if (overlays) {
      let manifest = "ffconcat version 1.0\n";
      for (let i = 0; i < times.length - 1; i++) manifest += `file 'overlay${i}.png'\noption framerate 1000\nduration ${(times[i+1]-times[i]).toFixed(6)}\n`;
      manifest += `file 'overlay${times.length-2}.png'\noption framerate 1000\n`;
      await ff.writeFile("overlays.txt", new TextEncoder().encode(manifest));
    }
    const audioIds = [...new Set(audioClips(p).map(a=>a.assetId))];
    for (let i=0;i<audioIds.length;i++) await ff.writeFile(`audio${i}`,new Uint8Array(await assets.get(audioIds[i]).file.arrayBuffer()));
    report(25, "Rendering your video in one pass…");
    if (await ff.exec(exportPlan(p, assets, audio, overlays))) throw Error("Export failed. " + (log.findLast(x => /error|invalid|failed/i.test(x)) || "Try a smaller resolution."));
    const bytes = await ff.readFile("finished.mp4");
    report(100, "Your video is ready.");
    return new Blob([bytes], { type: "video/mp4" });
  } finally { ff.terminate(); if (active === ff) active = null; }
}

// Reverse short chunks and join them backwards so long clips do not need
// every decoded frame in memory at once.
export async function reverseVideo(asset, start, end, report) {
  await loadScript();
  const ff = new window.FFmpegWASM.FFmpeg();
  active = ff;
  try {
    report(0, "Preparing reverse…");
    await ff.load({
      coreURL: "/vendor/henshin/ffmpeg-core.js",
      wasmURL: "/vendor/henshin/ffmpeg-core.wasm",
    });
    await ff.writeFile(
      "source",
      new Uint8Array(await asset.file.arrayBuffer()),
    );
    await ff.ffprobe([
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "json",
      "source",
      "-o",
      "probe.json",
    ]);
    const probe = JSON.parse(
      new TextDecoder().decode(await ff.readFile("probe.json")),
    );
    const audio = probe.streams?.some((s) => s.codec_type === "audio");
    const length = end - start;
    // Target at most about 96 MB of decoded RGBA frames per chunk.
    const chunk = Math.max(
      1 / 30,
      Math.floor(
        Math.min(
          2,
          (96 * 1048576) / Math.max(1, asset.width * asset.height * 4 * 30),
        ) * 30,
      ) / 30,
    );
    const count = Math.ceil(length / chunk);
    const exec = async (args) => {
      if (await ff.exec(["-y", ...args]))
        throw Error("Could not reverse this clip. Try a shorter selection.");
    };
    for (let i = 0; i < count; i++) {
      const d = Math.min(chunk, length - i * chunk);
      report(
        5 + (85 * i) / count,
        `Reversing clip… ${Math.round((100 * i) / count)}%`,
      );
      const args = [
        "-ss",
        String(start + i * chunk),
        "-t",
        String(d),
        "-i",
        "source",
      ];
      if (!audio) args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
      args.push(
        "-map",
        "0:v:0",
        "-map",
        audio ? "0:a:0" : "1:a:0",
        "-t",
        String(d),
        "-vf",
        "fps=30,reverse,setpts=PTS-STARTPTS,setsar=1",
        "-af",
        audio ? "aresample=48000,areverse,asetpts=PTS-STARTPTS" : "anull",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ac",
        "2",
        "-ar",
        "48000",
        `reverse${i}.mp4`,
      );
      await exec(args);
    }
    await ff.writeFile(
      "reverse.txt",
      new TextEncoder().encode(
        Array.from({ length: count }, (_, i) => {
          const part = count - 1 - i;
          return `file 'reverse${part}.mp4'\nduration ${Math.min(chunk, length - part * chunk).toFixed(6)}`;
        }).join("\n"),
      ),
    );
    await exec([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      "reverse.txt",
      "-t",
      String(length),
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      "reversed.mp4",
    ]);
    const bytes = await ff.readFile("reversed.mp4");
    return new File(
      [bytes],
      `Reversed ${asset.file.name.replace(/\.[^.]+$/, "")}.mp4`,
      { type: "video/mp4" },
    );
  } finally {
    ff.terminate();
    if (active === ff) active = null;
  }
}
