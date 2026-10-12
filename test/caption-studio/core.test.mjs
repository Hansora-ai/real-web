import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newProject,
  timedWords,
  timelineCaptions,
  splitClip,
  subtitles,
  parseSubtitles,
  groupWords,
  eventTimes,
  validateProject,
  duration,
  splitCue,
  frameSize,
} from "../../public/caption-studio/core.mjs";
function project() {
  const p = newProject();
  p.clips = [{ id: "a", assetId: "source", start: 0, end: 10, volume: 1 }];
  p.transcripts.source = [
    {
      id: "caption",
      start: 1,
      end: 5,
      text: "Բարև world привет",
      words: [
        { text: "Բարև", start: 1, end: 2 },
        { text: "world", start: 2, end: 3 },
        { text: "привет", start: 4, end: 5 },
      ],
    },
  ];
  return p;
}
test("split, remove, and reorder retain the correct source words and subtitle timing", () => {
  const p = project();
  splitClip(p, "a", 3);
  p.clips.shift();
  assert.equal(duration(p), 7);
  const q = timelineCaptions(p)[0];
  assert.equal(q.start, 1);
  assert.equal(q.end, 2);
  assert.equal(q.text, "привет");
  assert.deepEqual(q.words, [{ text: "привет", start: 1, end: 2 }]);
  p.clips.push({ id: "b", assetId: "source", start: 0, end: 3, volume: 1 });
  p.clips.reverse();
  const result = timelineCaptions(p);
  assert.equal(result[0].text, "Բարև world");
  assert.equal(result[1].start, 4);
  assert.equal(result[1].end, 5);
  assert.match(subtitles(p), /00:00:04,000 --> 00:00:05,000\nпривет/);
});
test("no captions leak from deleted source ranges", () => {
  const p = project();
  p.clips[0].start = 5;
  assert.deepEqual(timelineCaptions(p), []);
});
test("mixed language grouping preserves spelling, gaps and word timestamps", () => {
  const words = [
    { text: "Բարև", start: 0, end: 0.5, type: "word" },
    { text: " ", start: 0.5, end: 0.5, type: "spacing" },
    { text: "hello", start: 0.6, end: 1, type: "word" },
    { text: "привет", start: 2, end: 2.6, type: "word" },
  ];
  const q = groupWords({ words });
  assert.equal(q.length, 2);
  assert.equal(q[0].text, "Բարև hello");
  assert.equal(q[1].words[0].start, 2);
});
test("SRT and VTT round trip multilingual text and explicit line breaks", () => {
  const p = project();
  p.transcripts.source[0].text = "Բարև world\nпривет";
  for (const vtt of [false, true]) {
    const text = subtitles(p, vtt),
      q = parseSubtitles(text)[0];
    assert.equal(q.text, "Բարև world\nпривет");
    assert.equal(q.start, 1);
    assert.equal(q.end, 5);
  }
});
test("split captions preserve each original word timestamp", () => {
  const q = project().transcripts.source[0],
    parts = splitCue(q);
  assert.equal(parts[1].text, "привет");
  assert.equal(parts[1].words[0].start, 4);
  assert.equal(parts[0].end, parts[1].start);
});
test("export events include word changes, blank periods, and pop-in frames", () => {
  const p = project();
  const times = eventTimes(p);
  assert.deepEqual(times, [0, 1, 2, 3, 4, 5, 10]);
  p.style.animation = "pop";
  assert.ok(eventTimes(p).some((t) => Math.abs(t - (1 + 1 / 30)) < 1e-6));
});
test("project validation checks asset references and trims style values", () => {
  const p = project(),
    a = new Map([["source", { kind: "video", duration: 10 }]]);
  p.style.x = 1000;
  p.style.font = 'bad"; font';
  const restored = validateProject(p, a);
  assert.equal(restored.style.x, 100);
  assert.ok(!restored.style.font.includes(";"));
  assert.throws(() => validateProject(p, new Map()), /missing/);
  p.clips[0].end = 0;
  assert.throws(() => validateProject(p, a), /timing/);
});
test("split refuses clip boundaries and leaves project intact", () => {
  const p = project();
  assert.throws(() => splitClip(p, "a", 0), /inside/);
  assert.equal(p.clips.length, 1);
});

test("HD export dimensions use the short edge for portrait and landscape", () => {
  const p = newProject();
  p.aspect = "16:9";
  p.resolution = 1080;
  assert.deepEqual(frameSize(p, new Map()), { width: 1920, height: 1080 });
  p.aspect = "9:16";
  assert.deepEqual(frameSize(p, new Map()), { width: 1080, height: 1920 });
});


test("generated captions outside a trimmed clip do not replace existing subtitles", async () => {
  const { generatedCaptionsForClip } = await import("../../public/caption-studio/core.mjs");
  const p = newProject();
  const clip = { id: "kept", assetId: "source", start: 11, end: 21.6 };
  p.clips = [clip];
  p.transcripts.source = [{ id: "manual", start: 13.4, end: 15.4, text: "Keep me" }];
  const before = JSON.stringify(p);
  const outside = [
    { id: "before", start: 9.16, end: 10.28, text: "Earlier speech" },
    { id: "after", start: 25, end: 29.98, text: "Later speech" },
  ];
  assert.throws(() => generatedCaptionsForClip(p, clip, outside), /outside this trimmed clip/);
  assert.throws(() => generatedCaptionsForClip(p, clip, []), /No speech/);
  assert.equal(JSON.stringify(p), before);
});

test("generated captions map to the selected clip after earlier clips and in-point trims", async () => {
  const { generatedCaptionsForClip } = await import("../../public/caption-studio/core.mjs");
  const p = newProject();
  const clip = { id: "selected", assetId: "speech", start: 1, end: 4 };
  p.clips = [{ id: "lead", assetId: "other", start: 0, end: 5 }, clip];
  const visible = generatedCaptionsForClip(p, clip, [{ id: "cue", start: 1.5, end: 2.5, text: "Visible speech" }]);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].start, 5.5);
  assert.equal(visible[0].end, 6.5);
  assert.equal(visible[0].key, "selected:cue");
});

test('caption size is global while added text layers retain their own size', async () => {
  const { styleFor } = await import('../../public/caption-studio/core.mjs');
  const p = project(); p.style.size = 7;
  assert.equal(styleFor(p, { style: { size: 2, y: 40 } }).size, 7);
  assert.equal(styleFor(p, { kind: 'text', style: { size: 2 } }).size, 2);
  assert.equal(styleFor(p, { style: { size: 2, y: 40 } }).y, 40);
});
test('global word count regrouping preserves edited text, languages, timestamps and gaps', async () => {
  const { regroupCaptions } = await import('../../public/caption-studio/core.mjs');
  const p = project(), before = p.transcripts.source.flatMap(q => q.words);
  regroupCaptions(p, 1);
  assert.equal(p.transcripts.source.length, 3);
  assert.deepEqual(p.transcripts.source.flatMap(q => q.words), before);
  regroupCaptions(p, 12);
  assert.equal(p.transcripts.source.length, 2); // the natural pause stays
  assert.equal(p.transcripts.source[0].text, 'Բարև world');
  assert.equal(p.captionWords, 12);
  assert.equal(validateProject(p, new Map([['source', {kind: 'video', duration: 10}]] )).captionWords, 12);
});

test('images insert as 3-second clips between videos and survive portable project validation', async () => {
  const { insertScene }=await import('../../public/caption-studio/core.mjs');
  const p=newProject();const video={id:'v',kind:'video',duration:5},image={id:'i',kind:'image',width:800,height:600,duration:3};
  insertScene(p,video);insertScene(p,video);const c=insertScene(p,image,1);
  assert.equal(c.end,3);assert.deepEqual(p.clips.map(c=>c.assetId),['v','i','v']);
  c.end=7;c.style.width=25;
  const restored=validateProject(p,new Map([['v',video],['i',image]]));
  assert.equal(duration(restored),17);assert.equal(restored.clips[1].style.width,25);
});
test('percentage grouping, layer moving and audio trimming preserve source offsets', async () => {
  const { wordsForLength, moveTimedItem, trimTimedItem }=await import('../../public/caption-studio/core.mjs');
  assert.equal(wordsForLength(25),3);assert.equal(wordsForLength(50),6);assert.equal(wordsForLength(100),12);
  const a={start:2,end:8,in:1,out:7,loop:false};
  trimTimedItem(a,'start',4,10);assert.equal(a.in,3);assert.equal(a.end,8);
  moveTimedItem(a,7);assert.equal(a.end,11);assert.equal(a.in,3);
  trimTimedItem(a,'end',100,10);assert.equal(a.end,14);assert.equal(a.out,10);
});
test('old music projects migrate into editable tracks and multiple audio tracks remain separate', () => {
  const p=project();p.music={assetId:'music',volume:.3};
  const assets=new Map([['source',{kind:'video',duration:10}],['music',{kind:'audio',duration:3}]]);
  const restored=validateProject(p,assets);assert.equal(restored.audio.length,1);
  assert.equal(restored.audio[0].volume,.3);assert.equal(restored.audio[0].loop,true);assert.equal(restored.audio[0].end,10);
  restored.audio.push({...restored.audio[0],id:'second',start:2,end:5,in:0,loop:false});
  assert.equal(validateProject(restored,assets).audio.length,2);
});

test("auto captions cost 0.5 credits per started 2 minutes", async () => {
  const { captionCost } = await import("../../public/caption-studio/core.mjs");
  assert.equal(captionCost(5), 0.5);
  assert.equal(captionCost(120), 0.5);
  assert.equal(captionCost(121), 1);
  assert.equal(captionCost(38.3), 0.5);
  assert.equal(captionCost(30 * 60), 7.5);
});
