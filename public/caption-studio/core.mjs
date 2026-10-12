export const uid = () => globalThis.crypto.randomUUID();
export const clamp = (n, a, b) =>
  Math.min(b, Math.max(a, Number.isFinite(Number(n)) ? Number(n) : a));
export const DEFAULT_STYLE = {
  font: "Noto Sans",
  size: 5.2,
  color: "#ffffff",
  accent: "#c4f36a",
  background: "#101418",
  backgroundOpacity: 0.72,
  outline: 2,
  shadow: true,
  bold: true,
  x: 50,
  y: 78,
  align: "center",
  width: 88,
  animation: "highlight",
};
export const PRESETS = {
  spotlight: { ...DEFAULT_STYLE },
  clean: {
    ...DEFAULT_STYLE,
    backgroundOpacity: 0,
    size: 4.8,
    animation: "none",
    outline: 2,
  },
  pill: {
    ...DEFAULT_STYLE,
    background: "#c4f36a",
    color: "#101418",
    accent: "#ffffff",
    backgroundOpacity: 1,
    outline: 0,
    animation: "none",
    size: 4.5,
  },
  punch: {
    ...DEFAULT_STYLE,
    size: 6.4,
    backgroundOpacity: 0,
    outline: 4,
    animation: "pop",
    accent: "#ffba75",
  },
  cinema: {
    ...DEFAULT_STYLE,
    size: 4.2,
    y: 89,
    backgroundOpacity: 0.55,
    bold: false,
    animation: "none",
  },
};
// Auto captions: 0.5 credits (shown to users as 5⚡) per started 2 minutes of audio (ElevenLabs Scribe
// costs at most $0.40/hour; one credit sells for at least ~$0.09, so the margin stays above 60%).
export const captionCost = (seconds) =>
  Math.max(0.5, Math.ceil(Math.max(0, Number(seconds) || 0) / 120) * 0.5);
export function newProject() {
  return {
    id: uid(),
    version: 1,
    name: "Untitled video",
    aspect: "source",
    resolution: 720,
    style: { ...DEFAULT_STYLE },
    clips: [],
    transcripts: {},
    layers: [],
    music: null,
    audio: [],
    captionLength: 50,
    captionWords: 6,
  };
}
export const baseDuration = p => p.clips.reduce((sum, c) => sum + c.end - c.start, 0);
export const duration = p => Math.max(baseDuration(p), 0,
  ...(p.layers || []).map(l => l.end), ...(p.audio || []).map(a => a.end));
export function audioClips(p) {
  if (p.audio?.length) return p.audio;
  return p.music ? [{ id: "legacy-music", ...p.music, start: 0, end: duration(p), in: 0,
    out: duration(p), loop: true }] : [];
}
export const wordsForLength = percent => Math.max(1, Math.round(clamp(percent, 5, 100) * 12 / 100));
export function insertScene(p, asset, index = p.clips.length) {
  if (!["video", "image"].includes(asset.kind)) throw Error("Choose a video or image for the main track.");
  const c = { id: uid(), assetId: asset.id, kind: asset.kind, start: 0,
    end: asset.kind === "image" ? 3 : asset.duration, volume: 1 };
  if (asset.kind === "image") c.style = { ...DEFAULT_STYLE, x: 50, y: 50, width: 100 };
  p.clips.splice(clamp(index, 0, p.clips.length), 0, c);
  return c;
}
export function trimTimedItem(item, edge, value, sourceDuration = Infinity) {
  if (edge === "start") {
    const next = clamp(value, Math.max(0, item.in !== undefined ? item.start - item.in : 0), item.end - .1);
    if (item.in !== undefined) item.in += next - item.start;
    item.start = next;
  } else {
    const max = item.in !== undefined && !item.loop ? item.start + sourceDuration - item.in : 3600;
    item.end = clamp(value, item.start + .1, max);
    if (item.in !== undefined) item.out = item.in + item.end - item.start;
  }
}
export function moveTimedItem(item, start) {
  const length = item.end - item.start;
  item.start = clamp(start, 0, 3600 - length); item.end = item.start + length;
}
export function locate(p, time) {
  if (time >= baseDuration(p)) return null;
  let offset = 0;
  for (let i = 0; i < p.clips.length; i++) {
    const c = p.clips[i],
      d = c.end - c.start;
    if (time < offset + d || i === p.clips.length - 1)
      return {
        clip: c,
        index: i,
        offset,
        sourceTime: c.start + clamp(time - offset, 0, d),
      };
    offset += d;
  }
  return null;
}
export function timedWords(text, start, end) {
  const words = String(text).trim().split(/\s+/u).filter(Boolean);
  return words.map((text, i) => ({
    text,
    start: start + ((end - start) * i) / words.length,
    end: start + ((end - start) * (i + 1)) / words.length,
  }));
}
export function groupWords(payload, maxWords = 6) {
  maxWords = Math.round(clamp(maxWords, 1, 12));
  const words = (payload.words || [])
    .filter(
      (w) =>
        w.type === "word" &&
        Number.isFinite(w.start) &&
        Number.isFinite(w.end) &&
        w.end > w.start,
    )
    .map((w) => ({ text: String(w.text), start: w.start, end: w.end }));
  const cues = [];
  let group = [];
  const flush = () => {
    if (group.length)
      cues.push({
        id: uid(),
        start: group[0].start,
        end: group.at(-1).end,
        text: group.map((w) => w.text).join(" "),
        words: group,
      });
    group = [];
  };
  for (const word of words) {
    const last = group.at(-1);
    if (
      last &&
      (group.length >= maxWords ||
        word.start - last.end > 0.65 ||
        word.end - group[0].start > Math.max(3.5, maxWords * 0.6) ||
        group.map((w) => w.text).join(" ").length + word.text.length > Math.max(48, maxWords * 10))
    )
      flush();
    group.push(word);
    if (/[.!?։]$/u.test(word.text)) flush();
  }
  flush();
  return cues;
}
export function regroupCaptions(p, maxWords) {
  p.captionWords = Math.round(clamp(maxWords, 1, 12));
  for (const [id, cues] of Object.entries(p.transcripts)) {
    const words = cues.flatMap(q => (q.words?.length ? q.words : timedWords(q.text, q.start, q.end)))
      .map(w => ({ ...w, type: "word" })).sort((a, b) => a.start - b.start);
    p.transcripts[id] = groupWords({ words }, p.captionWords).map(q => {
      const source = cues.find(c => c.start <= q.start && c.end > q.start);
      return source?.style ? { ...q, style: { ...source.style } } : q;
    });
  }
}
export function generatedCaptionsForClip(p, clip, cues) {
  if (!cues.length)
    throw Error("No speech was detected. Existing captions were kept.");
  const visible = timelineCaptions({
    ...p, transcripts: { ...p.transcripts, [clip.assetId]: cues },
  }).filter((q) => q.clip.id === clip.id);
  if (!visible.length)
    throw Error("Speech was found outside this trimmed clip. Extend the clip to include it, then generate again. Existing captions were kept.");
  return visible;
}
export function timelineCaptions(p) {
  const output = [];
  let offset = 0;
  for (const c of p.clips) {
    for (const q of p.transcripts[c.assetId] || []) {
      const start = Math.max(c.start, q.start),
        end = Math.min(c.end, q.end);
      if (end <= start) continue;
      const words = (q.words || [])
        .filter((w) => w.end > start && w.start < end)
        .map((w) => ({
          ...w,
          start: offset + Math.max(w.start, start) - c.start,
          end: offset + Math.min(w.end, end) - c.start,
        }));
      if (q.words?.length && !words.length) continue;
      const captionStart =
        q.start < c.start && words.length
          ? words[0].start
          : offset + start - c.start;
      const captionEnd =
        q.end > c.end && words.length
          ? words.at(-1).end
          : offset + end - c.start;
      output.push({
        ...q,
        start: captionStart,
        end: captionEnd,
        words,
        text:
          words.length && words.length !== (q.words || []).length
            ? words.map((w) => w.text).join(" ")
            : q.text,
        source: q,
        clip: c,
        key: `${c.id}:${q.id}`,
      });
    }
    offset += c.end - c.start;
  }
  return output;
}
export function splitClip(p, id, time) {
  const at = p.clips.findIndex((c) => c.id === id);
  if (at < 0) throw Error("Select a clip first.");
  const c = p.clips[at];
  let offset = p.clips.slice(0, at).reduce((s, c) => s + c.end - c.start, 0);
  const source = c.start + time - offset;
  if (source <= c.start + 0.05 || source >= c.end - 0.05)
    throw Error("Place the playhead inside the selected clip.");
  p.clips.splice(
    at,
    1,
    { ...c, end: source },
    { ...c, id: uid(), start: source },
  );
}
export function splitCue(cue) {
  const words = cue.words?.length
    ? cue.words
    : timedWords(cue.text, cue.start, cue.end);
  if (words.length < 2)
    throw Error("This caption needs at least two words to split.");
  const n = Math.ceil(words.length / 2),
    a = words.slice(0, n),
    b = words.slice(n),
    middle = (a.at(-1).end + b[0].start) / 2;
  return [
    { ...cue, end: middle, text: a.map((w) => w.text).join(" "), words: a },
    {
      ...cue,
      id: uid(),
      start: middle,
      text: b.map((w) => w.text).join(" "),
      words: b,
    },
  ];
}
export function frameSize(p, assets) {
  const a = assets.get(p.clips[0]?.assetId),
    ratio =
      { "9:16": 9 / 16, "16:9": 16 / 9, "1:1": 1, "4:5": 4 / 5 }[p.aspect] ||
      (a?.width || 1280) / (a?.height || 720);
  const short = p.resolution || 720,
    rawW = ratio >= 1 ? short * ratio : short,
    rawH = ratio >= 1 ? short : short / ratio,
    scale = Math.min(1, 4096 / Math.max(rawW, rawH));
  return {
    width: Math.max(2, Math.round((rawW * scale) / 2) * 2),
    height: Math.max(2, Math.round((rawH * scale) / 2) * 2),
  };
}
function stamp(t, vtt = false) {
  let ms = Math.max(0, Math.round(t * 1000)),
    h = Math.floor(ms / 3600000),
    m = Math.floor(ms / 60000) % 60,
    s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${vtt ? "." : ","}${String(ms % 1000).padStart(3, "0")}`;
}
export function subtitles(p, vtt = false) {
  return (
    (vtt ? "WEBVTT\n\n" : "") +
    timelineCaptions(p)
      .map(
        (q, i) =>
          `${vtt ? "" : i + 1 + "\n"}${stamp(q.start, vtt)} --> ${stamp(q.end, vtt)}\n${q.text}\n`,
      )
      .join("\n")
  );
}
export function parseSubtitles(text) {
  const parse = (t) => {
    const x = t.replace(",", ".").split(":").map(Number);
    return x.reduce((s, n) => s * 60 + n, 0);
  };
  const cues = [];
  for (const block of String(text)
    .replace(/\r/g, "")
    .split(/\n\s*\n/)) {
    const lines = block.split("\n"),
      i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const match = lines[i].match(/([\d:. ,]+?)\s*-->\s*([\d:.,]+)/);
    if (!match) continue;
    const start = parse(match[1].trim()),
      end = parse(match[2]),
      value = lines
        .slice(i + 1)
        .join("\n")
        .replace(/<[^>]*>/g, "")
        .trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && value)
      cues.push({
        id: uid(),
        start,
        end,
        text: value,
        words: timedWords(value, start, end),
      });
  }
  if (!cues.length)
    throw Error("No valid subtitles found. Choose an SRT or VTT file.");
  return cues;
}
export function styleFor(p, q) {
  return { ...DEFAULT_STYLE, ...p.style, ...q?.style,
    ...(!q?.kind ? { size: p.style.size } : {}) };
}
export function eventTimes(p) {
  const d = duration(p),
    events = new Set([0, d]);
  for (const q of [...timelineCaptions(p), ...p.layers]) {
    events.add(clamp(q.start, 0, d));
    events.add(clamp(q.end, 0, d));
    const s = styleFor(p, q);
    if (s.animation === "highlight")
      for (const w of q.words || []) {
        events.add(w.start);
        events.add(w.end);
      }
    if (s.animation === "pop")
      for (let i = 1; i <= 5; i++)
        events.add(Math.min(q.end, q.start + i / 30));
  }
  return [...events]
    .filter((t) => t >= 0 && t <= d)
    .sort((a, b) => a - b)
    .filter((t, i, a) => i === 0 || t - a[i - 1] > 0.0001);
}
export function safeStyle(raw = {}) {
  const s = { ...DEFAULT_STYLE };
  for (const key of ["color", "accent", "background"])
    if (/^#[0-9a-f]{6}$/i.test(raw[key] || "")) s[key] = raw[key];
  for (const [key, min, max] of [
    ["size", 1, 14],
    ["x", 0, 100],
    ["y", 0, 100],
    ["width", 1, 100],
    ["outline", 0, 8],
    ["backgroundOpacity", 0, 1],
  ])
    s[key] = clamp(raw[key] ?? s[key], min, max);
  s.font = String(raw.font || s.font)
    .slice(0, 100)
    .replace(/["\\;]/g, "");
  s.animation = ["none", "highlight", "pop"].includes(raw.animation)
    ? raw.animation
    : s.animation;
  s.align = ["left", "center", "right"].includes(raw.align)
    ? raw.align
    : s.align;
  s.bold = raw.bold !== false;
  s.shadow = raw.shadow !== false;
  return s;
}
export function validateProject(raw, assets) {
  if (raw?.version !== 1 || !Array.isArray(raw.clips) || raw.clips.length > 100)
    throw Error("Unsupported project file.");
  const p = newProject();
  p.name = String(raw.name || p.name).slice(0, 150);
  if (/^[\w-]{8,64}$/.test(String(raw.id || ""))) p.id = raw.id;
  p.style = safeStyle(raw.style);
  p.captionWords = Math.round(clamp(raw.captionWords ?? 6, 1, 12));
  p.captionLength = clamp(raw.captionLength ?? p.captionWords / 12 * 100, 5, 100);
  p.aspect = ["source", "9:16", "16:9", "1:1", "4:5"].includes(raw.aspect)
    ? raw.aspect
    : "source";
  p.resolution = [480, 720, 1080].includes(raw.resolution)
    ? raw.resolution
    : 720;
  for (const c of raw.clips) {
    const a = assets.get(c.assetId);
    if (!a || !["video", "image"].includes(a.kind)) throw Error("Project media is missing.");
    const limit = a.kind === "image" ? 3600 : a.duration;
    const start = clamp(c.start, 0, limit),
      end = clamp(c.end, 0, limit);
    if (end - start < 0.05) throw Error("Invalid clip timing.");
    p.clips.push({
      id: uid(),
      assetId: c.assetId,
      kind: a.kind,
      ...(a.kind === "image" ? { style: safeStyle(c.style || { ...DEFAULT_STYLE, width: 100, x: 50, y: 50 }) } : {}),
      start,
      end,
      volume: clamp(c.volume ?? 1, 0, 1),
    });
  }
  for (const id of new Set(p.clips.map((c) => c.assetId))) {
    p.transcripts[id] = (raw.transcripts?.[id] || [])
      .slice(0, 10000)
      .filter(
        (q) =>
          Number.isFinite(q.start) && Number.isFinite(q.end) && q.end > q.start,
      )
      .map((q) => ({
        id: uid(),
        start: q.start,
        end: q.end,
        text: String(q.text || "").slice(0, 1000),
        words: (q.words || timedWords(q.text, q.start, q.end))
          .filter(
            (w) =>
              Number.isFinite(w.start) &&
              Number.isFinite(w.end) &&
              w.end > w.start,
          )
          .map((w) => ({
            text: String(w.text).slice(0, 100),
            start: w.start,
            end: w.end,
          })),
        ...(q.style ? { style: safeStyle(q.style) } : {}),
      }));
  }
  p.layers = (raw.layers || [])
    .slice(0, 100)
    .filter(
      (l) =>
        l.end > l.start &&
        (l.kind === "text" ||
          (l.kind === "image" && assets.get(l.assetId)?.kind === "image")),
    )
    .map((l) => ({
      id: uid(),
      kind: l.kind,
      track: String(l.track || l.id || uid()).slice(0,100),
      assetId: l.assetId,
      text: String(l.text || "").slice(0, 1000),
      start: clamp(l.start, 0, 3600),
      end: clamp(l.end, 0, 3600),
      style: safeStyle(l.style),
    }));
  const tracks = raw.audio?.length ? raw.audio : raw.music ? [{ ...raw.music, start: 0,
    end: baseDuration(p), in: 0, loop: true }] : [];
  p.audio = tracks.slice(0, 100).filter(a => ["audio", "video"].includes(assets.get(a.assetId)?.kind))
    .map(a => {
      const source = assets.get(a.assetId), start = clamp(a.start, 0, 3600);
      const input = clamp(a.in ?? 0, 0, source.duration || 3600);
      const end = clamp(a.end, start + .1, a.loop ? 3600 : start + Math.max(.1, source.duration - input));
      return { id: uid(), track: String(a.track || a.id || uid()).slice(0,100), assetId: a.assetId, start, end, in: input, out: input + end - start,
        loop: Boolean(a.loop), volume: clamp(a.volume ?? .25, 0, 1) };
    });
  return p;
}
