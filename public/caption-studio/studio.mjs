import {
  uid,
  clamp,
  newProject,
  duration,
  baseDuration,
  audioClips,
  wordsForLength,
  insertScene,
  trimTimedItem,
  moveTimedItem,
  locate,
  timedWords,
  groupWords,
  regroupCaptions,
  generatedCaptionsForClip,
  timelineCaptions,
  splitClip,
  splitCue,
  frameSize,
  subtitles,
  parseSubtitles,
  styleFor,
  PRESETS,
  validateProject,
  captionCost,
} from "./core.mjs";
import { fit, drawOverlays, resizeHandles, drawSelection } from "./render.mjs";
import { exportVideo, cancelExport, reverseVideo } from "./export.mjs";
import {
  projectFile,
  unpackProject,
  saveProject,
  listProjects,
  loadProject,
  deleteProject,
  migrateDraft,
} from "./storage.mjs";
import { fastExport, cancelExport as cancelFastExport } from "./fast-export.mjs";
import { PreviewAudio } from "./preview-audio.mjs";
import { readGenerations } from "./generations.mjs";
const mixer = new PreviewAudio();
const $ = (id) => document.getElementById(id),
  video = $("source-video"),
  music = $("music-audio"),
  canvas = $("preview"),
  ctx = canvas.getContext("2d");
let zoomFactor = 1, maxZoom = 8;
let activeTab = "media",
  mediaPreviewId = null,
  timelineScale = 70,
  timelineSpan = null,
  trimPreview = null,
  videoLoad = null,
  trimming = false;
let p = newProject(),
  assets = new Map(),
  time = 0,
  playing = false,
  loading = false,
  seekRevision = 0,
  selectedClip = null,
  selectedAudio = null,
  playbackAnchor = null,
  inlineEditing = null,
  audioPlayers = new Map(),
  selectedOverlay = null,
  boxes = [],
  busy = false,
  history = [],
  future = [],
  pendingBefore = null,
  saveTimer = null,
  saveChain = Promise.resolve(),
  saveRevision = 0,
  toastTimer = null,
  resultURL = null,
  connection = { local: false, configured: false };
const clock = (t) => {
  const n = Math.max(0, t);
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${(n % 60).toFixed(1).padStart(4, "0")}`;
};
function toast(message, error = false) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").classList.toggle("error", error);
  $("toast").hidden = false;
  toastTimer = setTimeout(
    () => ($("toast").hidden = true),
    error ? 9000 : 4500,
  );
}
const run = (fn) => async (event) => {
  try {
    await fn(event);
  } catch (error) {
    toast(error.message || "Something went wrong. Please try again.", true);
  }
};
function click(id, fn) {
  $(id).addEventListener("click", run(fn));
}
function snapshot() {
  return JSON.stringify(p);
}
function checkpoint() {
  pendingBefore ??= snapshot();
}
function commit() {
  if (pendingBefore && pendingBefore !== snapshot()) {
    history.push(pendingBefore);
    if (history.length > 60) history.shift();
    future = [];
  }
  pendingBefore = null;
  time = clamp(time, 0, duration(p));
  if (!p.clips.some((c) => c.id === selectedClip))
    selectedClip = p.clips[0]?.id || null;
  if (!findOverlay()) selectedOverlay = null;
  if (!p.audio.some(a=>a.id===selectedAudio)) selectedAudio=null;
  renderUI();
  scheduleSave();
}
function change(fn) {
  if (busy) return;
  pause();
  checkpoint();
  fn();
  commit();
  seek(time);
}
function scheduleSave() {
  const revision = ++saveRevision;
  $("save-status").textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const project = structuredClone(p),
      list = new Map(assets);
    saveChain = saveChain
      .catch(() => {})
      .then(() => (project.clips.length || list.size) ? saveProject(project, list, thumbnail()) : null)
      .then(() => {
        if (revision === saveRevision)
          $("save-status").textContent = "Saved on this device";
      })
      .catch(() => {
        if (revision === saveRevision)
          $("save-status").textContent =
            "Save unavailable · download a project";
      });
  }, 700);
}
function thumbnail() {
  if (!duration(p)) return "";
  try {
    const c = document.createElement("canvas"), w = 160, h = Math.round(160 * canvas.height / canvas.width);
    c.width = w; c.height = Math.min(h, 240);
    c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.7);
  } catch { return ""; }
}
function currentClip() {
  return p.clips.find((c) => c.id === selectedClip) || p.clips[0];
}
function findOverlay() {
  if (selectedOverlay?.startsWith("scene:")) {
    const c = p.clips.find(c=>`scene:${c.id}` === selectedOverlay);
    return c ? { ...c, scene: true, source: c, clip: c, key: selectedOverlay } : null;
  }
  return (
    p.layers.find((l) => l.id === selectedOverlay) ||
    timelineCaptions(p).find((q) => q.key === selectedOverlay)
  );
}
function selectedSource() {
  const q = findOverlay();
  return q?.source || q;
}
function styleTarget() {
  const q = selectedSource();
  if (q?.kind) return (q.style ??= { ...p.style });
  clearCaptionOverrides();
  return p.style;
}
// Every caption follows the shared caption style (position, size, colours).
function clearCaptionOverrides() {
  for (const cues of Object.values(p.transcripts)) for (const q of cues) delete q.style;
}
const styleHome = $("text-options").parentElement;
function closeSheets() { document.body.classList.remove("tool-sheet-open", "properties-open"); }
// Phones use a CapCut-style timeline: the playhead stays in the centre and the tracks scroll under it.
const phone=matchMedia("(max-width: 700px)");
const centered=()=>phone.matches;
function lead() { return centered() ? Math.round($("timeline-scroll").clientWidth/2) : 70; }
let scrollSync=0, userScrolling=false, userScrollTimer=null;
function followPlayhead() {
  if(!centered() || userScrolling) return;
  const target=Math.round(time*timelineScale), scroller=$("timeline-scroll");
  if(Math.abs(scroller.scrollLeft-target)>=1) {scrollSync=performance.now();scroller.scrollLeft=target;}
}
function editMode(on) {
  document.body.classList.toggle("edit-mode",on);
  if(on) document.body.classList.remove("tool-sheet-open");
}
// Desktop: selecting something swaps the tool panel for its settings, keeping the preview large.
let toolTab="media";
function openProps() {
  if(centered()) return;
  if(!document.body.classList.contains("properties-open")) toolTab=activeTab;
  activeTab="media";
  document.body.classList.remove("tool-sheet-open");document.body.classList.add("properties-open");renderInspector();
}
function closeRatio() { $("ratio-sheet").hidden=true; document.body.classList.remove("ratio-open"); }
function sizePreview() {
  const wrap=$("preview-wrap"), scale=Math.min((wrap.clientWidth-24)/canvas.width,(wrap.clientHeight-16)/canvas.height);
  if(scale>0) {canvas.style.width=`${Math.floor(canvas.width*scale)}px`;canvas.style.height=`${Math.floor(canvas.height*scale)}px`;}
}
function focusPreview(focus) {
  document.body.classList.toggle("preview-focus",focus);
  $("preview-expand").querySelector("span").textContent=focus?"Timeline":"Focus";
  $("preview-expand").title=focus?"Show timeline and editing controls":"Enlarge preview";
  $("preview-expand").setAttribute("aria-pressed",String(focus));
}
// The timeline stays visible after an upload (CapCut-style); Focus is opt-in.
function focusPortrait() { closeSheets(); }
const SHEET_TITLES={media:"Media",captions:"Captions",layers:"Text",audio:"Audio"};
function tab(name) {
  activeTab = name;
  $("sheet-title").textContent=SHEET_TITLES[name];
  closeRatio();
  document.body.classList.add("tool-sheet-open");
  document.body.classList.remove("properties-open");
  if (name === "captions" && !selectedSource()) $("style-scope").value = "all";
  document.querySelectorAll("[data-tab]").forEach((b) => {
    const yes = b.dataset.tab === name;
    b.classList.toggle("active", yes);
    b.setAttribute("aria-selected", String(yes));
  });
  for (const t of ["media", "captions", "layers", "audio"])
    $(`tab-${t}`).hidden = t !== name;
  renderInspector();
}
function button(label, fn, cls = "") {
  const b = document.createElement("button");
  b.textContent = label;
  b.className = cls;
  b.addEventListener("click", run(fn));
  return b;
}
function renderUI() {
  $("project-name").value = p.name;
  $("aspect").value = p.aspect;
  $("resolution").value = p.resolution;
  $("empty-preview").hidden = duration(p) > 0;
  if (duration(p)) $("recent-projects").hidden = true;
  $("media-count").textContent =
    `${[...assets.values()].filter((a) => a.kind !== "font").length} files`;
  $("media-list").replaceChildren();
  for (const a of assets.values()) {
    if (a.kind === "font") continue;
    const card = document.createElement("div");
    card.className = "media-card";
    const thumb = button("", () => previewMedia(a.id), "media-thumb");
    thumb.setAttribute("aria-label", `Preview ${a.file.name}`);
    if (a.frames?.length) {
      const image = document.createElement("img");
      image.src = a.frames[0].url;
      image.alt = "";
      thumb.append(image);
    } else if (a.kind === "image") {
      const image=document.createElement("img");image.src=a.url;image.alt="";thumb.append(image);
    } else thumb.textContent = "♫";
    const length = document.createElement("span");
    length.className = "media-duration";
    length.textContent = a.kind === "image" ? "Image · 3s" : clock(a.duration);
    thumb.append(length);
    const name = document.createElement("strong");
    name.textContent = a.file.name;
    name.title = a.file.name;
    const add = button("＋", () => addToTimeline(a.id), "media-add");
    add.setAttribute("aria-label", `Add ${a.file.name} to timeline`);
    card.append(thumb, name, add);
    if (a.kind === "image") card.append(button("＋ Layer",()=>addImageLayer(a.id),"media-action"));
    if (a.kind === "video") card.append(button("♫ Audio",()=>addAudio(a.id),"media-action"));
    card.draggable = true;
    card.addEventListener("dragstart", (e) =>
      e.dataTransfer.setData("application/x-hansora-media", a.id),
    );
    $("media-list").append(card);
  }
  const d = duration(p),
    captions = timelineCaptions(p);
  $("timeline-duration").textContent = `${p.clips.length} clips · ${clock(d)}`;
  renderTimeline(d, captions);
  $("caption-count").textContent = `${captions.length} captions`;
  $("caption-list").replaceChildren();
  for (const q of captions) {
    const b = button(
      "",
      () => selectOverlay(q.key, q.start),
      `caption-row${selectedOverlay === q.key ? " active" : ""}`,
    );
    const timestamp = document.createElement("small");
    timestamp.textContent = `${clock(q.start)} → ${clock(q.end)}`;
    const text = document.createElement("span");
    text.textContent = q.text;
    b.append(timestamp, text);
    $("caption-list").append(b);
  }
  $("layer-list").replaceChildren();
  for (const l of p.layers) {
    $("layer-list").append(
      button(
        `${l.kind === "image" ? "▧" : "T"}  ${l.kind === "text" ? l.text : assets.get(l.assetId)?.file.name}`,
        () => selectOverlay(l.id, l.start),
        `caption-row${selectedOverlay === l.id ? " active" : ""}`,
      ),
    );
  }
  $("edit-selection").disabled=!duration(p)||busy;
  $("toggle-tracks").disabled=!duration(p)||busy;
  $("toggle-tracks").textContent=`Layers${p.layers.length+p.audio.length ? " · "+(p.layers.length+p.audio.length) : ""}`;
  $("words-label").textContent = `${Math.round(p.captionLength)}%`;
  $("caption-words").value = p.captionLength;
  for (const b of document.querySelectorAll("[data-length]")) b.classList.toggle("active", Math.abs(Number(b.dataset.length) - p.captionLength) < 1);
  renderInspector();
  renderSound();
  $("undo").disabled = !history.length || busy;
  $("redo").disabled = !future.length || busy;
  for (const id of [
    "split",
    "duplicate",
    "reverse",
    "delete-clip",
    "move-left",
    "move-right",
    "generate",
    "add-caption",
    "import-captions",
    "export-open",
  ])
    $(id).disabled = (id === "export-open" ? !duration(p) : ["split","duplicate","delete-clip","move-left","move-right"].includes(id) ? (!p.clips.length && !selectedTimedItem()) : !p.clips.length) || busy;
  const targets = captionTargets();
  $("generate").disabled = busy || !targets.length;
  const total = captionCost(targets.reduce((sum, id) => sum + assets.get(id).duration, 0));
  // Balances are shown ×10 across the site (see header.js), so the price is too.
  const shown = Number((total * (window.HansoraHeader?.creditDisplayMultiplier || 10)).toFixed(2));
  $("generate-label").textContent = targets.length ? `Auto captions · ${shown}⚡` : "Auto captions";
  $("reverse").disabled = busy || assets.get(currentClip()?.assetId)?.kind !== "video";
  const layerSelected=p.layers.some(l=>l.id===selectedOverlay);
  $("move-left").textContent=layerSelected?"↓":"←";$("move-right").textContent=layerSelected?"↑":"→";
  $("move-left").title=layerSelected?"Send layer backward":"Move earlier";
  $("move-right").title=layerSelected?"Bring layer forward":"Move later";
  const size = frameSize(p, assets);
  if (canvas.width !== size.width || canvas.height !== size.height) {
    canvas.width = size.width;
    canvas.height = size.height;
  }
  syncProxies();
  sizePreview();draw();
}
function renderInspector() {
  const c = currentClip();
  const q = selectedSource();
  const audio=p.audio.find(a=>a.id===selectedAudio);
  const captionTools=activeTab==="captions" && !q?.kind && !audio;
  const styleHost=captionTools?$("caption-style-host"):styleHome;
  if($("text-options").parentElement!==styleHost)styleHost.append($("text-options"));
  if(captionTools)$("style-scope").value="all";
  const showText = !audio && (Boolean(q) || activeTab === "captions");
  $("audio-inspector").hidden = !audio;
  if(audio) {
    $("audio-name").textContent=assets.get(audio.assetId)?.file.name;
    $("audio-volume").value=audio.volume;
    $("audio-volume-label").textContent=`${Math.round(audio.volume*100)}%`;
    $("audio-loop").checked=audio.loop;
  }
  $("text-options").hidden = !showText || q?.kind === "image";
  $("clip-inspector").hidden = !c || Boolean(q) || Boolean(audio) || activeTab === "captions";
  $("inspector-empty").hidden = Boolean(c) || showText || Boolean(audio);
  $("inspector-title").textContent = audio ? "Audio" : q
    ? q.kind === "image"
      ? "Image"
      : q.kind === "text"
        ? "Text"
        : "Caption"
    : showText
      ? "Caption style"
      : "Video";
  if (c) {
    $("selected-clip-name").textContent = assets.get(c.assetId)?.file.name;
    $("trim-start").value = c.start.toFixed(2);
    $("trim-end").value = c.end.toFixed(2);
    $("trim-start").max = assets.get(c.assetId)?.duration;
    $("trim-end").max = assets.get(c.assetId)?.duration;
    $("clip-volume").value = c.volume ?? 1;
  }
  $("caption-inspector").hidden = !q || Boolean(audio);
  $("caption-text-label").hidden = q?.kind === "image";
  if (q) {
    $("selected-heading").textContent =
      q.kind === "image"
        ? "Selected image"
        : q.kind === "text"
          ? "Selected text"
          : "Selected caption";
    if (document.activeElement !== $("caption-text")) $("caption-text").value = q.text || "";
    $("caption-text").disabled = q.kind === "image";
    if (document.activeElement !== $("cue-start")) $("cue-start").value = q.start.toFixed(2);
    if (document.activeElement !== $("cue-end")) $("cue-end").value = q.end.toFixed(2);
    $("split-caption").hidden = !!q.kind;
    $("split-caption").disabled = !q.kind && timedWords(q.text,q.start,q.end).length<2;
    $("split-caption").title = $("split-caption").disabled ? "A single word cannot be split" : "Split into two captions";
    $("merge-caption").hidden = !!q.kind;
  }
  const s = q?.kind ? styleFor(p, q) : p.style;
  $("bg-none").checked = Number(s.backgroundOpacity) === 0;
  for (const el of document.querySelectorAll("[data-style]")) {
    const v = s[el.dataset.style];
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = v;
  }
  $("size-label").textContent = `${s.size.toFixed(1)}%`;
  $("size-title").textContent = q?.kind ? "Text size" : "Caption size · all subtitles";
}
function selectOverlay(id, at) {
  pause();
  selectedAudio = null;
  selectedOverlay = id;
  const q = findOverlay();
  if (q?.clip) selectedClip = q.clip.id;
  $("style-scope").value = "selected";
  seek(at + 0.01);
  renderUI();
}
function draw() {
  const w = canvas.width,
    h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (duration(p)) {
    ctx.fillStyle = "#000"; ctx.fillRect(0,0,w,h);
    const located=locate(p,time), a=assets.get(located?.clip.assetId);
    let sceneBox=null;
    if (a?.kind === "image" && a.image) {
      const c=located.clip, s=c.style || {width:100,x:50,y:50}, fitted=fit(a.width,a.height,w,h);
      const bw=fitted.w*s.width/100,bh=fitted.h*s.width/100;
      const x=w*s.x/100-bw/2,y=h*s.y/100-bh/2;
      ctx.drawImage(a.image,x,y,bw,bh); sceneBox={x,y,w:bw,h:bh,key:`scene:${c.id}`};
    } else if (a?.kind === "video" && video.dataset.asset === a.id && video.readyState >= 2) {
      const box=fit(video.videoWidth,video.videoHeight,w,h);ctx.drawImage(video,box.x,box.y,box.w,box.h);
    }
    boxes=drawOverlays(ctx,p,time,w,h,assets,{selection:selectedOverlay,skipKey:inlineEditing});
    if(sceneBox) {boxes.unshift(sceneBox);if(selectedOverlay===sceneBox.key) drawSelection(ctx,sceneBox,w);}
  } else boxes=[];
  $("timecode").replaceChildren(document.createTextNode(clock(time) + " "));
  const total = document.createElement("span");
  total.textContent = "/ " + clock(duration(p));
  $("timecode").append(total);
  const short=t=>{const n=Math.max(0,t);return `${String(Math.floor(n/60)).padStart(2,"0")}:${String(Math.floor(n%60)).padStart(2,"0")}`;};
  $("timecode-m").innerHTML=`${short(time)} <span>/ ${short(duration(p))}</span>`;
  updatePlayhead();
}
function updatePlayhead() {
  const head = $("timeline-playhead");
  head.style.left = `${lead() + time * timelineScale}px`;
  followPlayhead();
  head.setAttribute("aria-valuemax", duration(p));
  head.setAttribute("aria-valuenow", time.toFixed(2));
  head.setAttribute("aria-valuetext", clock(time));
}
function loadPreview(asset) {
  if (video.dataset.asset === asset.id && videoLoad) return videoLoad.promise;
  videoLoad?.cancel();
  video.dataset.asset = asset.id;
  const state = { id: asset.id };
  state.promise = new Promise((resolve, reject) => {
    const clean = () => {
      video.removeEventListener("loadedmetadata", onload);
      video.removeEventListener("error", onerror);
      clearTimeout(timeout);
    };
    const onload = () => { clean(); resolve(); };
    const onerror = () => {
      clean();
      reject(Error("This browser cannot play this video codec. Try MP4 (H.264)."));
    };
    const timeout = setTimeout(() => {
      clean(); reject(Error("Could not load this video."));
    }, 10000);
    state.cancel = () => { clean(); resolve(); };
    video.addEventListener("loadedmetadata", onload);
    video.addEventListener("error", onerror);
    video.src = asset.url;
    video.load();
  });
  videoLoad = state;
  return state.promise;
}
async function seek(at, { play = false } = {}) {
  const revision=++seekRevision;
  time=clamp(at,0,duration(p)); video.pause(); loading=true;
  const located=locate(p,time), asset=assets.get(located?.clip.assetId);
  try {
    if(asset?.kind === "video") {
      await loadPreview(asset); if(revision!==seekRevision) return;
      video.currentTime=Math.min(located.sourceTime,Math.max(0,asset.duration-.001));
      mixer.set(video,located.clip.volume??1); applyPreviewMute();
      if(play) await video.play();
    }
    if(revision!==seekRevision) return;
    if(play) {playing=true;playbackAnchor={time,at:performance.now()};playIcon(true);}
    syncMusic(play);draw();
  } catch(error) {if(revision===seekRevision) {pause();toast(error.message,true);}}
  finally {if(revision===seekRevision) loading=false;}
}
function playIcon(on) {
  $("play").classList.toggle("is-playing",on);$("play").setAttribute("aria-label",on?"Pause":"Play");
}
function pause() {
  playing=false;playbackAnchor=null;video.pause();music.pause();
  for(const player of audioPlayers.values()) player.pause();
  playIcon(false);
}
function syncMusic(play=false, seekAudio=true) {
  const active=new Set(p.audio.map(a=>a.id));
  for(const [id,player] of audioPlayers) if(!active.has(id)) {player.pause();mixer.remove(player);player.removeAttribute("src");player.remove();audioPlayers.delete(id);}
  for(const track of p.audio) {
    const asset=assets.get(track.assetId);if(!asset) continue;
    let player=audioPlayers.get(track.id);
    if(!player) {player=document.createElement("audio");player.src=asset.url;player.preload="auto";
      player.addEventListener("loadedmetadata",()=>syncMusic(playing));$("preview-audio-host").append(player);audioPlayers.set(track.id,player);}
    mixer.set(player,track.volume);applyPreviewMute();
    const inside=time>=track.start && time<track.end;
    const input=track.in + Math.max(0,time-track.start);
    const target=track.loop ? input%asset.duration : Math.min(asset.duration-.001,input);
    if(inside && Number.isFinite(player.duration) && (seekAudio || player.paused || Math.abs(player.currentTime-target)>.35)) player.currentTime=target;
    if(play && inside && (track.loop || input<asset.duration)) {
      if(player.paused && !player.dataset.playPending) {player.dataset.playPending="1";player.play().catch(()=>{if(!player.dataset.playFailed){player.dataset.playFailed="1";toast("Audio could not start. Pause and press Play again.",true);}}).finally(()=>delete player.dataset.playPending);}
    } else player.pause();
  }
}
function applyPreviewMute() {
  const muted=$("preview-mute").checked;
  if(mixer.context) mixer.mute(muted);
  else {video.muted=muted;for(const player of audioPlayers.values())player.muted=muted;}
}
function frame() {
  if(playing && !loading && playbackAnchor) {
    const previous=locate(p,time);
    time=clamp(playbackAnchor.time+(performance.now()-playbackAnchor.at)/1000,0,duration(p));
    const next=locate(p,time);
    if(time>=duration(p)) pause();
    else if(previous?.clip.id!==next?.clip.id) seek(time,{play:true});
    else syncMusic(true,false);
    draw();
  }
  $("sound-meter").value=playing?Math.min(100,mixer.level()*200):0;
  requestAnimationFrame(frame);
}
video.addEventListener("seeked",draw);video.addEventListener("loadeddata",draw);
async function loadAsset(file, kind, stored = {}) {
  const id = stored.id || uid(),
    url = URL.createObjectURL(file),
    a = { ...stored, id, kind, file, url };
  try {
    if (kind === "video" || kind === "audio") {
      const el = document.createElement(kind === "video" ? "video" : "audio");
      el.preload = "metadata";
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              Error("Could not read this file. Try MP4 (H.264) for video."),
            ),
          12000,
        );
        el.onloadedmetadata = () => {
          clearTimeout(timer);
          resolve();
        };
        el.onerror = () => {
          clearTimeout(timer);
          reject(
            Error(
              "This browser cannot read this media. Try MP4 (H.264) or MP3.",
            ),
          );
        };
        el.src = url;
      });
      a.duration = el.duration;
      if (!Number.isFinite(a.duration) || a.duration <= 0)
        throw Error("The media has no valid duration.");
      if (kind === "video") {
        a.width = el.videoWidth;
        a.height = el.videoHeight;
        a.frames = await thumbnailFrames(el, a.duration);
      }
      el.removeAttribute("src");
      el.load();
    }
    if (kind === "image") {
      if (file.size > 20 * 1048576)
        throw Error("Choose an image smaller than 20 MB.");
      a.image = await createImageBitmap(file);
      a.duration = 3;
      a.width = a.image.width;
      a.height = a.image.height;
      if (a.width * a.height > 20000000) {
        a.image.close();
        throw Error("Choose an image smaller than 20 megapixels.");
      }
    }
    if (kind === "font") {
      a.fontName = stored.fontName || `Custom ${assets.size + 1}`;
      const font = new FontFace(a.fontName, await file.arrayBuffer());
      await font.load();
      document.fonts.add(font);
      addFontOption(a.fontName);
    }
    if (kind === "audio" || kind === "video") {
      try {
        if (file.size < 30 * 1048576) {
          const ac=new AudioContext();
          try {const buffer=await ac.decodeAudioData(await file.arrayBuffer()),data=buffer.getChannelData(0);
            const count=512,step=Math.max(1,Math.floor(data.length/count));a.peaks=[];
            for(let i=0;i<count;i++){let peak=0;for(let j=i*step;j<Math.min(data.length,(i+1)*step);j+=8)peak=Math.max(peak,Math.abs(data[j]));a.peaks.push(peak);}
            const max=Math.max(.01,...a.peaks);a.peaks=a.peaks.map(x=>x/max);
          } finally {await ac.close();}
        }
      } catch {}
    }
    return a;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
function addFontOption(name) {
  if (![...$("font").options].some((o) => o.value === name)) {
    const o = document.createElement("option");
    o.textContent = name;
    $("font").append(o);
  }
}
async function addVideos(files) {
  if (busy) return;
  const total =
    [...assets.values()].reduce((s, a) => s + a.file.size, 0) +
    [...files].reduce((s, f) => s + f.size, 0);
  if (total > 200 * 1048576)
    throw Error(
      "This local version supports up to 200 MB of media per project. Use shorter clips.",
    );
  pause();
  const firstImport=!duration(p) && !assets.size;
  const added = [];
  try {
    for (const file of files) {
      const kind=file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(file.name) ? "image" : file.type.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|aac|flac)$/i.test(file.name) ? "audio" : "video";
      added.push(await loadAsset(file,kind));
    }
  } catch (error) {
    for (const a of added) URL.revokeObjectURL(a.url);
    throw error;
  }
  for (const a of added) assets.set(a.id, a);
  renderUI();
  scheduleSave();
  tab("media");
  if(firstImport && added.length) {
    addToTimeline((added.find(a=>a.kind!=="audio")||added[0]).id);
    focusPortrait();
    toast("First clip added. Add more media with ＋.");
  } else toast(`${added.length} files ready. Press ＋ to add them to your timeline.`);
}
function usedAssets() {
  return new Map(assets);
}
async function restore(data) {
  setBusy(true);
  toast("Opening project…");
  const next = new Map();
  try {
    for (const stored of data.assets) {
      const a = await loadAsset(stored.file, stored.kind, stored);
      next.set(a.id, a);
    }
    const project = validateProject(data.project, next);
    pause();
    for (const a of assets.values()) {
      URL.revokeObjectURL(a.url);
      a.image?.close();
    }
    assets = next;
    p = project;
    timelineSpan = null;
    captionStatus("");
    history = [];
    future = [];
    pendingBefore = null;
    selectedClip = p.clips[0]?.id;
    selectedOverlay = null;
    selectedAudio = null;
    inlineEditing = null; $("preview-text-editor").hidden=true;
    time = 0;
    video.dataset.asset = "";
    music.dataset.asset = "";
    renderUI();
    await seek(0);
    focusPortrait();
    scheduleSave();
    toast("Project restored, including its media.");
  } catch (error) {
    for (const a of next.values()) URL.revokeObjectURL(a.url);
    throw error;
  } finally {
    setBusy(false);
  }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function fileName() {
  return (
    p.name
      .replace(/[^\p{L}\p{N}\-_ ]/gu, "")
      .trim()
      .slice(0, 100) || "hansora-video"
  );
}
function setBusy(value) {
  busy = value;
  for (const el of document.querySelectorAll(
    "#caption-editor button,#caption-editor input,#caption-editor select,#caption-editor textarea,.studio-dialog button,.studio-dialog input,.studio-dialog select",
  )) {
    if (el.id === "cancel-export") continue;
    el.disabled = value;
  }
  if (!value) renderUI();
}
async function checkConnection() {
  try {
    const r = await fetch("/api/caption-studio/status");
    if (r.ok) connection = await r.json();
  } catch {}

}
function openLogin() {
  if (window.HansoraHeader?.openAuth) window.HansoraHeader.openAuth("login");
  else toast("Sign-in is loading. Try again in a moment.");
}
function captionStatus(message, error = false) {
  const status = $("caption-status");
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle("error", error);
}
// Auto captions cover every video in the timeline. Videos that already have
// captions are skipped; when all have them, all are made again.
function captionTargets() {
  const ids = [...new Set(p.clips.map((c) => c.assetId))].filter((id) => assets.get(id)?.kind === "video");
  const missing = ids.filter((id) => !p.transcripts[id]?.length);
  return missing.length ? missing : ids;
}
async function generate() {
  const targets = captionTargets();
  if (!targets.length) throw Error("Add a video to make captions.");
  if (connection.local && !connection.configured) throw Error("Auto captions are not available on this computer.");
  const headers = { "Content-Type": "application/json" };
  if (!connection.local) {
    const token = (await window.__HANSORA_SB__?.auth.getSession())?.data?.session?.access_token;
    if (!token) {
      toast("Sign in to make auto captions.");
      openLogin();
      return;
    }
    headers.Authorization = `Bearer ${token}`;
  }
  pause();
  setBusy(true);
  const made = new Map();
  let failure = null;
  try {
    captionStatus("Making captions…"); toast("Making captions…");
    // One charge for the whole project; one single-use token per video.
    const r = await fetch("/.netlify/functions/caption-studio-token", { method: "POST", headers, body: JSON.stringify({ seconds: targets.map((id) => assets.get(id).duration) }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(data.error || "Could not start auto captions.");
    window.HansoraHeader?.refreshCredits?.()?.catch?.(() => {});
    const tokens = data.tokens || [data.token];
    for (let i = 0; i < targets.length; i++) {
      const asset = assets.get(targets[i]);
      if (targets.length > 1) { const label = `Making captions… video ${i + 1} of ${targets.length}`; captionStatus(label); toast(label); }
      try {
        const form = new FormData();
        form.append("file", asset.file, asset.file.name);
        form.append("model_id", "scribe_v2");
        form.append("timestamps_granularity", "word");
        if ($("language").value !== "auto") form.append("language_code", $("language").value);
        const response = await fetch(`https://api.elevenlabs.io/v1/speech-to-text?token=${encodeURIComponent(tokens[i])}`, { method: "POST", body: form, signal: AbortSignal.timeout(600000) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw Error(response.status === 429 ? "Auto captions are busy right now. Try again in a minute." : "Could not make captions for this video. Try again.");
        const cues = groupWords(result, p.captionWords);
        if (cues.length) made.set(asset.id, cues);
      } catch (error) { failure = error; break; }
    }
    if (made.size) {
      checkpoint();
      for (const [id, cues] of made) p.transcripts[id] = cues;
      const visible = timelineCaptions(p).filter((q) => made.has(q.clip.assetId));
      selectedOverlay = visible[0]?.key || null;
      commit();
      tab("captions");
      if (visible[0]) await seek((visible[0].start + visible[0].end) / 2);
      captionStatus(visible.length ? `${visible.length} captions added. Tap one to edit it.` : "Captions were made, but none fall inside your trimmed clips.", !visible.length);
      toast(`${visible.length} captions added.`);
    } else if (!failure) {
      throw Error("No speech was found in your video.");
    }
    if (failure) throw Error(made.size ? `${failure.message} Captions for the other videos were added.` : failure.message);
  } catch (error) {
    captionStatus(error.message || "Could not make captions. Try again.", true);
    throw error;
  } finally {
    setBusy(false);
  }
}
for (const b of document.querySelectorAll("[data-tab]"))
  b.addEventListener("click", () => tab(b.dataset.tab));
for (const b of document.querySelectorAll("[data-close]"))
  b.addEventListener("click", () => {
    if (!busy) $(b.dataset.close).close();
  });
for (const id of ["add-video", "empty-upload"])
  click(id, () => $("video-input").click());
$("video-input").addEventListener(
  "change",
  run(async (e) => {
    await addVideos(e.target.files);
    e.target.value = "";
  }),
);
document.addEventListener("dragover", (e) => {
  if (e.dataTransfer.types.includes("Files")) {
    e.preventDefault();
    $("add-video").classList.add("drag-over");
  }
});
document.addEventListener("dragleave", () =>
  $("add-video").classList.remove("drag-over"),
);
document.addEventListener(
  "drop",
  run(async (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    $("add-video").classList.remove("drag-over");
    await addVideos(e.dataTransfer.files);
  }),
);
click("play", async () => {
  if (!duration(p)) return;
  if (playing) pause();
  else {await mixer.unlock();for(const player of audioPlayers.values())delete player.dataset.playFailed;await seek(time >= duration(p) - 0.05 ? 0 : time, { play: true });}
});
click("back", () => {
  pause();
  seek(time - 5);
});
click("forward", () => {
  pause();
  seek(time + 5);
});
$("preview-mute").addEventListener("change", () => {
  applyPreviewMute();
});
function selectedTimedItem() {
  return p.audio.find(a=>a.id===selectedAudio) || p.layers.find(l=>l.id===selectedOverlay);
}
click("split",()=>change(()=>{
  const item=selectedTimedItem();
  if(item) {
    if(time<=item.start+.05 || time>=item.end-.05) throw Error("Place the playhead inside the selected layer.");
    item.track??=item.id;
    const right={...structuredClone(item),id:uid(),start:time};
    if(item.in!==undefined) {right.in=item.in+time-item.start;item.out=right.in;}
    item.end=time;(item.in!==undefined?p.audio:p.layers).push(right);
  } else splitClip(p,locate(p,time)?.clip.id,time);
}));
click("duplicate",()=>change(()=>{
  const item=selectedTimedItem();
  if(item) {
    item.track??=item.id;
    const copy={...structuredClone(item),id:uid(),start:item.end,end:item.end+item.end-item.start};
    if(item.in!==undefined) {p.audio.push(copy);selectedAudio=copy.id;}else{p.layers.push(copy);selectedOverlay=copy.id;}
  } else {
    const i=p.clips.findIndex(c=>c.id===selectedClip);if(i<0)return;
    const c={...structuredClone(p.clips[i]),id:uid()};p.clips.splice(i+1,0,c);selectedClip=c.id;
    if(c.kind==="image") selectedOverlay=`scene:${c.id}`;
  }
}));
click("delete-clip",()=>change(()=>{
  if(selectedAudio) {p.audio=p.audio.filter(a=>a.id!==selectedAudio);selectedAudio=null;syncMusic();}
  else if(p.layers.some(l=>l.id===selectedOverlay)) {p.layers=p.layers.filter(l=>l.id!==selectedOverlay);selectedOverlay=null;}
  else p.clips=p.clips.filter(c=>c.id!==selectedClip);
}));
for(const [id,delta] of [["move-left",-1],["move-right",1]]) click(id,()=>change(()=>{
  const item=selectedTimedItem();
  if(item?.in!==undefined) moveTimedItem(item,item.start+delta);
  else if(item) {
    const i=p.layers.indexOf(item),j=clamp(i+delta,0,p.layers.length-1);
    [p.layers[i],p.layers[j]]=[p.layers[j],p.layers[i]];
  } else {
    const i=p.clips.findIndex(c=>c.id===selectedClip),j=i+delta;
    if(i>=0 && j>=0 && j<p.clips.length) [p.clips[i],p.clips[j]]=[p.clips[j],p.clips[i]];
  }
}));
click("apply-trim", () => {
  const c = currentClip();
  if (!c) return;
  const start = Number($("trim-start").value),
    end = Number($("trim-end").value);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end - start < 0.05 ||
    end > (assets.get(c.assetId).kind === "image" ? 3600 : assets.get(c.assetId).duration) + 0.001
  )
    throw Error("Choose valid in/out times within the source video.");
  change(() => {
    c.start = start;
    c.end = end;
  });
});
$("clip-volume").addEventListener("input", () => {
  checkpoint();
  const c = currentClip();
  if (c) c.volume = Number($("clip-volume").value);
  mixer.set(video,c?.volume??1);applyPreviewMute();renderSound();
});
$("clip-volume").addEventListener("change", commit);
$("project-name").addEventListener("input", () => {
  checkpoint();
  p.name = $("project-name").value.trim() || "Untitled video";
  scheduleSave();
});
$("project-name").addEventListener("change", commit);
$("aspect").addEventListener("change", () => {
  const value = $("aspect").value;
  change(() => (p.aspect = value));
  focusPortrait();
});
click("safe-area", () => {
  $("safe-guide").hidden = !$("safe-guide").hidden;
});
click("generate", generate);
click("import-captions", () => $("subtitle-input").click());
$("subtitle-input").addEventListener(
  "change",
  run(async (e) => {
    const c = currentClip();
    if (!c) return;
    const cues = parseSubtitles(await e.target.files[0].text());
    change(() => (p.transcripts[c.assetId] = cues));
    e.target.value = "";
    toast("Subtitles imported. Word highlights use estimated timing.");
  }),
);
click("add-caption", () => {
  const l = locate(p, time);
  if (!l) return;
  change(() => {
    const start = clamp(
        l.sourceTime,
        0,
        assets.get(l.clip.assetId).duration - 0.05,
      ),
      end = Math.min(start + 2, assets.get(l.clip.assetId).duration),
      q = {
        id: uid(),
        start,
        end,
        text: "Your caption",
        words: timedWords("Your caption", start, end),
      };
    p.transcripts[l.clip.assetId] ??= [];
    p.transcripts[l.clip.assetId].push(q);
    p.transcripts[l.clip.assetId].sort((a, b) => a.start - b.start);
    selectedClip = l.clip.id;
    selectedOverlay = `${l.clip.id}:${q.id}`;
    $("style-scope").value = "selected";
  });
});
function saveCaptionEdit(event) {
  if (busy) return;
  const selected = findOverlay(),
    q = selected?.source || selected;
  if (!q) return;
  const start = event?.target.id === "cue-start" ? Number($("cue-start").value) : q.start,
    end = event?.target.id === "cue-end" ? Number($("cue-end").value) : q.end,
    text = $("caption-text").value.trim();
  const limit = q.kind
    ? 3600
    : assets.get(findOverlay().clip.assetId).duration;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start ||
    end > limit + 0.001
  )
    return $("caption-edit-status").textContent = "Choose start and end times within the video.";
  if (q.kind !== "image" && !text)
    return $("caption-edit-status").textContent = "Enter text, or use Delete to remove this caption.";
  if (q.start === start && q.end === end && q.text === text) return;
  checkpoint();
  {
    const timingChanged = q.start !== start || q.end !== end,
      textChanged = q.text !== text;
    q.start = start;
    q.end = end;
    q.text = text;
    if (!q.kind && (timingChanged || textChanged)) {
      q.words = timedWords(text, start, end);
      p.transcripts[selected.clip.assetId].sort((a, b) => a.start - b.start);
    }
  }
  commit();
  draw();
  $("caption-edit-status").textContent = "Saved automatically.";
}
for (const id of ["caption-text", "cue-start", "cue-end"])
  $(id).addEventListener("input", saveCaptionEdit);
for (const b of document.querySelectorAll("[data-length]")) b.addEventListener("click", () => {
  $("caption-words").value = b.dataset.length;
  $("caption-words").dispatchEvent(new Event("change"));
});
$("caption-words").addEventListener("input", () => {
  $("words-label").textContent = `${$("caption-words").value}%`;
});
$("caption-words").addEventListener("change", () => change(() => {
  p.captionLength=Number($("caption-words").value);
  regroupCaptions(p, wordsForLength(p.captionLength));
  selectedOverlay = null;
}));

click("delete-caption", () => {
  const q = findOverlay();
  if (!q) return;
  change(() => {
    if (q.scene) p.clips=p.clips.filter(c=>c.id!==q.id);
    else if (q.kind) p.layers = p.layers.filter((l) => l.id !== q.id);
    else
      p.transcripts[q.clip.assetId] = p.transcripts[q.clip.assetId].filter(
        (a) => a.id !== q.source.id,
      );
    selectedOverlay = null;
  });
});
click("split-caption", () => {
  const q = findOverlay();
  if (!q?.source) return;
  const next = splitCue(q.source);
  change(() => {
    const array = p.transcripts[q.clip.assetId],
      i = array.findIndex((a) => a.id === q.source.id);
    array.splice(i, 1, ...next);
  });
});
click("merge-caption", () => {
  const q = findOverlay();
  if (!q?.source) return;
  const arr = p.transcripts[q.clip.assetId],
    i = arr.findIndex((a) => a.id === q.source.id),
    next = arr[i + 1];
  if (!next) throw Error("There is no next caption to merge.");
  change(() => {
    q.source.text += " " + next.text;
    q.source.end = next.end;
    q.source.words = [...(q.source.words || []), ...(next.words || [])];
    arr.splice(i + 1, 1);
  });
});
$("style-scope").addEventListener("change", renderInspector);
$("bg-none").addEventListener("change", run(() => change(() => {
  styleTarget().backgroundOpacity = $("bg-none").checked ? 0 : 0.72;
})));
for (const el of document.querySelectorAll("[data-style]")) {
  el.addEventListener(
    "input",
    run(() => {
      checkpoint();
      const target = styleTarget();
      target[el.dataset.style] =
        el.type === "checkbox"
          ? el.checked
          : ["range", "number"].includes(el.type)
            ? Number(el.value)
            : el.value;
      if (el.id === "size")
        $("size-label").textContent = `${Number(el.value).toFixed(1)}%`;
      draw();
    }),
  );
  el.addEventListener("change", commit);
}
for (const b of document.querySelectorAll("[data-preset]"))
  b.addEventListener(
    "click",
    run(() => {
      change(() => {
        Object.assign(styleTarget(), PRESETS[b.dataset.preset]);
        if (!selectedSource()?.kind) p.style.size = PRESETS[b.dataset.preset].size;
      });
      document
        .querySelectorAll("[data-preset]")
        .forEach((x) => x.classList.toggle("active", x === b));
    }),
  );
let drag = null;
function point(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) * canvas.width) / r.width,
    y: ((e.clientY - r.top) * canvas.height) / r.height,
  };
}
function handleAt(pos,touch=false) {
  const box=boxes.find(b=>b.key===selectedOverlay);
  const radius=(touch?18:8)*canvas.width/canvas.getBoundingClientRect().width;
  return resizeHandles(box).find(h=>Math.abs(pos.x-h.x)<radius && Math.abs(pos.y-h.y)<radius);
}
canvas.addEventListener("pointerdown",e=>{
  if(busy || inlineEditing) return;
  const pos=point(e), handle=handleAt(pos,e.pointerType==="touch");
  const box=handle ? boxes.find(b=>b.key===selectedOverlay) : [...boxes].reverse().find(b=>pos.x>=b.x && pos.x<=b.x+b.w && pos.y>=b.y && pos.y<=b.y+b.h);
  if(!box) {selectedOverlay=null;selectedAudio=null;renderInspector();draw();return;}
  pause();selectedOverlay=box.key;selectedAudio=null;$("style-scope").value="selected";
  const q=findOverlay();if(q?.clip) selectedClip=q.clip.id;
  const style=q?.kind?styleFor(p,q):p.style;checkpoint();if(!q?.kind) clearCaptionOverrides();
  if(centered()) editMode(true);
  drag={start:pos,x:style.x,y:style.y,size:style.size,width:style.width,box,handle};
  canvas.setPointerCapture(e.pointerId);openProps();renderInspector();draw();
});
canvas.addEventListener("pointermove",e=>{
  const pos=point(e);
  if(!drag) {canvas.style.cursor=handleAt(pos)?.cursor || "grab";return;}
  const q=selectedSource();if(!q) return;const target=q.kind?(q.style??={...p.style}):p.style;
  if(drag.handle) {
    const h=drag.handle,b=drag.box;
    const anchor={x:b.x+(1-h.fx)*b.w,y:b.y+(1-h.fy)*b.h};
    const initial={x:h.x-anchor.x,y:h.y-anchor.y}, next={x:pos.x-anchor.x,y:pos.y-anchor.y};
    const factor=clamp((initial.x*next.x+initial.y*next.y)/Math.max(1,initial.x**2+initial.y**2),.05,10);
    target.width=clamp(drag.width*factor,1,100);
    if(q.kind!=="image") target.size=clamp(drag.size*factor,1,14);
    const center={x:anchor.x+(b.x+b.w/2-anchor.x)*factor,y:anchor.y+(b.y+b.h/2-anchor.y)*factor};
    target.x=clamp(center.x/canvas.width*100,0,100);target.y=clamp(center.y/canvas.height*100,0,100);
  } else {
    target.x=clamp(drag.x+(pos.x-drag.start.x)/canvas.width*100,0,100);
    target.y=clamp(drag.y+(pos.y-drag.start.y)/canvas.height*100,0,100);
  }
  draw();
});
for(const event of ["pointerup","pointercancel"]) canvas.addEventListener(event,()=>{if(drag){drag=null;commit();}});
function editOnPreview(key) {
  const box=boxes.find(b=>b.key===key);if(!box) return;
  selectedOverlay=key;const q=selectedSource();if(!q || q.kind==="image") return;
  pause();checkpoint();inlineEditing=key;
  const field=$("preview-text-editor"),rect=canvas.getBoundingClientRect(),wrap=$("preview-wrap").getBoundingClientRect(),s=styleFor(p,q);
  field.value=q.text;field.hidden=false;
  field.style.left=`${rect.left-wrap.left+box.x/canvas.width*rect.width}px`;
  field.style.top=`${rect.top-wrap.top+box.y/canvas.height*rect.height}px`;
  field.style.width=`${Math.max(80,box.w/canvas.width*rect.width)}px`;
  field.style.height=`${Math.max(40,box.h/canvas.height*rect.height+16)}px`;
  field.style.font=`${s.bold?800:400} ${s.size/100*rect.width}px "${s.font}", "Noto Sans Armenian", sans-serif`;
  field.style.color=s.color;field.style.textAlign=s.align;
  field.focus();field.select();draw();
}
canvas.addEventListener("dblclick",e=>{
  const pos=point(e),box=[...boxes].reverse().find(b=>pos.x>=b.x&&pos.x<=b.x+b.w&&pos.y>=b.y&&pos.y<=b.y+b.h);
  if(box) editOnPreview(box.key);
});
$("preview-text-editor").addEventListener("input",()=>{
  const q=selectedSource(),text=$("preview-text-editor").value;
  if(!q || !text.trim()) return;q.text=text;
  if(!q.kind) q.words=timedWords(text,q.start,q.end);
  scheduleSave();draw();
});
function finishInlineText() {
  if(!inlineEditing) return;inlineEditing=null;$("preview-text-editor").hidden=true;commit();draw();
}
$("preview-text-editor").addEventListener("blur",finishInlineText);
$("preview-text-editor").addEventListener("keydown",e=>{if(e.key==="Escape"||(e.key==="Enter"&&!e.shiftKey)){e.preventDefault();finishInlineText();}});
click("add-text", () => {
  change(() => {
    const l = {
      id: uid(),
      kind: "text",
      text: "Your title",
      start: time,
      end: time + 3,
      style: { ...p.style, y: 20, animation: "none" },
    };
    p.layers.push(l);
    selectedAudio = null;
    selectedOverlay = l.id;
    $("style-scope").value = "selected";
  });
  closeSheets();
});
click("add-music-quick",()=>{tab("media");$("video-input").click();});
click("add-font",()=>$("font-input").click());
$("font-input").addEventListener("change",run(async e=>{
  const file=e.target.files[0];if(!file) return;
  if(file.size>10*1048576) throw Error("Choose a font smaller than 10 MB.");
  const a=await loadAsset(file,"font");assets.set(a.id,a);change(()=>styleTarget().font=a.fontName);e.target.value="";
}));
$("audio-volume").addEventListener("input",()=>{
  const a=p.audio.find(a=>a.id===selectedAudio);if(!a) return;
  checkpoint();a.volume=Number($("audio-volume").value);$("audio-volume-label").textContent=`${Math.round(a.volume*100)}%`;
  syncMusic(playing,false);renderTimeline();
});
$("audio-volume").addEventListener("change",commit);
$("audio-loop").addEventListener("change",()=>change(()=>{const a=p.audio.find(a=>a.id===selectedAudio);if(a) a.loop=$("audio-loop").checked;}));
function undo() {
  if (busy || !history.length) return;
  pause();
  future.push(snapshot());
  p = JSON.parse(history.pop());
  pendingBefore = null;
  commit();
  seek(time);
}
function redo() {
  if (busy || !future.length) return;
  pause();
  history.push(snapshot());
  p = JSON.parse(future.pop());
  pendingBefore = null;
  commit();
  seek(time);
}
click("undo", undo);
click("redo", redo);
document.addEventListener("keydown", (e) => {
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  }
  if ((e.key === "Delete" || e.key === "Backspace") && !busy && !document.querySelector("dialog[open]")) {
    const q = findOverlay();
    if (!q && !selectedAudio && !p.clips.length) return;
    e.preventDefault();
    if (q && !q.kind && !q.scene) $("delete-caption").click();
    else $("delete-clip").click();
    return;
  }
  if (e.code === "Space" && !busy && !document.querySelector("dialog[open]")) {
    e.preventDefault();
    $("play").click();
  }
});
click("save-project", async () => {
  pause();
  toast("Preparing the editable project…");
  download(await projectFile(p, usedAssets()), fileName() + ".hansora");
  toast("Project saved with its media, captions, and styles.");
});
click("open-project", () => $("project-input").click());
$("project-input").addEventListener(
  "change",
  run(async (e) => {
    const f = e.target.files[0];
    if (f.size > 300 * 1048576) throw Error("This project file is too large.");
    await restore(unpackProject(JSON.parse(await f.text())));
    e.target.value = "";
  }),
);

click("export-open", () => {
  pause();
  $("export-result").hidden = true;
  $("export-video").hidden = false;
  $("export-details").textContent =
    `${clock(duration(p))} · ${p.clips.length} clips`;
  $("export-dialog").showModal();
});
$("export-dialog").addEventListener("cancel", (e) => {
  if (busy) e.preventDefault();
});
click("export-video", async () => {
  if (busy) return;
  p.resolution = Number($("resolution").value);
  renderUI();
  scheduleSave();
  const project = structuredClone(p);
  setBusy(true);
  let exported = false;
  $("export-progress").hidden = false;
  $("export-result").hidden = true;
  $("export-video").hidden = true;
  try {
    const blob = await fastExport(project, assets, (progress, label) => {
      $("progress").value = progress;
      $("progress-label").textContent = label;
    });
    if (resultURL) URL.revokeObjectURL(resultURL);
    resultURL = URL.createObjectURL(blob);
    $("download-video").href = resultURL;
    $("download-video").download = fileName() + ".mp4";
    $("export-preview").src = resultURL;
    $("export-result").hidden = false;
    exported = true;
    toast("Your MP4 is ready to download.");
  } catch (error) {
    if (!/terminate|cancel/i.test(error.message || ""))
      toast(error.message || "Export cancelled.", true);
  } finally {
    $("export-progress").hidden = true;
    $("export-video").hidden = exported;
    setBusy(false);
  }
});
click("cancel-export", () => {
  cancelFastExport();
  toast("Export cancelled. Your project is safe.");
});
click("download-srt", () =>
  download(
    new Blob([subtitles(p)], { type: "text/plain;charset=utf-8" }),
    fileName() + ".srt",
  ),
);
click("download-vtt", () =>
  download(
    new Blob([subtitles(p, true)], { type: "text/vtt;charset=utf-8" }),
    fileName() + ".vtt",
  ),
);
click("demo", async () => {
  const r = await fetch("/caption-studio/demo.mp4");
  if (!r.ok) throw Error("Could not load the sample.");
  const a = await loadAsset(
    new File([await r.blob()], "Sample · mixed languages.mp4", {
      type: "video/mp4",
    }),
    "video",
  );
  checkpoint();
  assets.set(a.id, a);
  const c = { id: uid(), assetId: a.id, start: 0, end: a.duration, volume: 1 };
  p.clips.push(c);
  p.transcripts[a.id] = [
    {
      id: uid(),
      start: 0,
      end: 2,
      text: "Բարև, սա մեր նոր video-ն է",
      words: timedWords("Բարև, սա մեր նոր video-ն է", 0, 2),
    },
    {
      id: uid(),
      start: 2,
      end: 4,
      text: "Можно менять subtitle-ի ոճը",
      words: timedWords("Можно менять subtitle-ի ոճը", 2, 4),
    },
    {
      id: uid(),
      start: 4,
      end: 6,
      text: "Make every բառ stand out",
      words: timedWords("Make every բառ stand out", 4, 6),
    },
  ];
  selectedClip = c.id;
  p.name = "My first caption project";
  commit();
  await seek(duration(p) - a.duration + 0.3);
  tab("captions");
  toast(
    "Sample loaded with example captions. Upload your own video to make real captions.",
  );
});
function addToTimeline(id, index=p.clips.length) {
  const a=assets.get(id);if(!a || busy) return;
  if(a.kind==="audio") return addAudio(id);
  const at=p.clips.slice(0,index).reduce((sum,c)=>sum+c.end-c.start,0);
  change(()=>{const c=insertScene(p,a,index);selectedClip=c.id;selectedAudio=null;
    selectedOverlay=a.kind==="image" ? `scene:${c.id}` : null;});
  tab("media");closeSheets();seek(at);
}
function addImageLayer(id) {
  if(busy) return;
  change(()=>{const l={id:uid(),kind:"image",assetId:id,start:time,end:time+3,style:{...p.style,x:50,y:50,width:35}};
    p.layers.push(l);selectedOverlay=l.id;selectedAudio=null;$("style-scope").value="selected";});
  seek(time+.001);
}
function addAudio(id) {
  if(busy) return;
  const asset=assets.get(id), start=time, length=duration(p)>start ? Math.min(asset.duration,duration(p)-start) : asset.duration;
  change(()=>{const a={id:uid(),assetId:id,start,end:start+length,in:0,out:length,volume:.5,loop:false};
    p.audio.push(a);selectedAudio=a.id;selectedOverlay=null;
    if(asset.kind==="video") for(const clip of p.clips.filter(c=>c.assetId===id))clip.volume=0;});
  closeSheets();document.body.classList.add("tracks-expanded");$("toggle-tracks").setAttribute("aria-expanded","true");syncMusic();
}
function previewMedia(id) {
  const a=assets.get(id);if(!a) return;pause();mediaPreviewId=id;
  $("media-preview-name").textContent=a.file.name;
  $("media-preview-image").hidden=a.kind!=="image";$("media-preview-video").hidden=a.kind==="image";
  if(a.kind==="image") $("media-preview-image").src=a.url;else $("media-preview-video").src=a.url;
  $("media-preview-dialog").showModal();
}
click("media-preview-add",()=>{$("media-preview-dialog").close();addToTimeline(mediaPreviewId);});
$("media-preview-dialog").addEventListener("close",()=>$("media-preview-video").pause());
async function thumbnailFrames(el, d) {
  const frames = [],
    c = document.createElement("canvas");
  c.width = 192;
  c.height = 108;
  const cx = c.getContext("2d");
  el.muted = true;
  el.preload = "auto";
  for (let i = 0; i < 8; i++) {
    const at = Math.min(d - 0.001, (d * (i + 0.2)) / 8);
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          clean();
          reject(Error("thumbnail timeout"));
        }, 4000);
        const clean = () => {
          clearTimeout(timeout);
          el.removeEventListener("seeked", done);
          el.removeEventListener("error", failed);
        };
        const done = () => {
          clean();
          resolve();
        };
        const failed = () => {
          clean();
          reject(Error("thumbnail unavailable"));
        };
        el.addEventListener("seeked", done);
        el.addEventListener("error", failed);
        el.currentTime = at;
      });
      cx.fillStyle = "#000";
      cx.fillRect(0, 0, 192, 108);
      const box = fit(el.videoWidth, el.videoHeight, 192, 108);
      cx.drawImage(el, box.x, box.y, box.w, box.h);
      frames.push({ time: at, url: c.toDataURL("image/jpeg", 0.7) });
    } catch {
      break;
    }
  }
  return frames;
}
function renderTimeline(d = duration(p), captions = timelineCaptions(p)) {
  const pad = lead(), viewport = Math.max(260, $("timeline-scroll").clientWidth - (centered() ? 0 : pad)) * (centered() ? 0.85 : 1);
  // Keep seconds at the same scale after edits; only zoom/resize changes it.
  // Fully zoomed out shows at least 50 seconds (or the whole video); fully zoomed in ~600px per second.
  const outSpan = Math.max(50, d * 1.15);
  if (timelineSpan === null && d > 0) {
    timelineSpan = outSpan;
    zoomFactor = outSpan / (centered() ? 5 : Math.max(d * 1.15, 8));
  } else if (timelineSpan !== null && outSpan > timelineSpan) {
    zoomFactor *= outSpan / timelineSpan;
    timelineSpan = outSpan;
  }
  maxZoom = Math.max(1.5, 600 * (timelineSpan || 50) / viewport);
  zoomFactor = clamp(zoomFactor, 1, maxZoom);
  $("timeline-zoom").value = Math.log(zoomFactor) / Math.log(maxZoom);
  timelineScale = (viewport / (timelineSpan || 50)) * zoomFactor;
  const width = Math.max(viewport, d * timelineScale);
  $("timeline-content").style.setProperty("--lead", `${pad}px`);
  $("timeline-content").style.width = `${width + pad + (centered() ? pad : 40)}px`;
  $("clip-track").replaceChildren();
  $("caption-track").replaceChildren();
  $("timeline-ruler").replaceChildren();
  const interval = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((step) => step * timelineScale >= 90) || 900;
  for (let at = 0; at <= width / timelineScale; at += interval) {
    const mark = document.createElement("span");
    mark.className = "ruler-mark";
    mark.style.left = `${at * timelineScale}px`;
    mark.textContent = clock(at);
    $("timeline-ruler").append(mark);
  }
  if (!p.clips.length) {
    const e = document.createElement("div");
    e.className = "timeline-empty";
    const add = button("", () => $("video-input").click(), "empty-add");
    add.innerHTML = '<svg class="i"><use href="#i-plus"/></svg><span>Add media</span>';
    const tip = document.createElement("span");
    tip.textContent = "or drag a file here";
    e.append(add, tip);
    $("clip-track").append(e);
  }
  let offset = 0;
  for (const c of p.clips) {
    const start = offset,
      a = assets.get(c.assetId),
      w = (c.end - c.start) * timelineScale;
    const b = document.createElement("div");
    b.className = `clip-block${selectedClip === c.id ? " selected" : ""}`;
    b.style.width = `${w}px`;
    // During an in-point drag the out-point stays under its original pixel.
    if (trimPreview?.clipId === c.id && trimPreview.edge === "start")
      b.style.marginLeft = `${(c.start - trimPreview.initial) * timelineScale}px`;
    b.tabIndex = 0;
    b.role = "button";
    b.dataset.clip = c.id;
    b.setAttribute(
      "aria-label",
      `Clip ${a?.file.name}, ${clock(c.end - c.start)}`,
    );
    const select = () => {
      if (trimming || busy) return;
      pause();
      selectedClip = c.id;
      selectedAudio=null;
      selectedOverlay = a.kind === "image" ? `scene:${c.id}` : null;
      if (centered()) { editMode(true); seek(Math.max(start, Math.min(time, start + c.end - c.start - 0.01))); }
      else { seek(start); openProps(); }
      renderUI();
    };
    b.addEventListener("click", select);
    b.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        select();
      }
    });
    const strip = document.createElement("div");
    strip.className = "clip-filmstrip";
    // Source-aligned tiles crop at the dragged edge instead of resizing every frame.
    const sourceWidth = (a?.kind === "image" ? Math.max(c.end,3) : a?.duration || c.end) * timelineScale;
    strip.style.width = `${sourceWidth}px`;
    strip.style.transform = `translateX(${-c.start * timelineScale}px)`;
    const n = Math.max(1, Math.ceil(sourceWidth / 75));
    for (let i = 0; i < n; i++) {
      const at = ((i + 0.5) * 75) / timelineScale;
      const frame = a?.kind === "image" ? {url:a.url} : a?.frames?.reduce(
        (best, f) =>
          !best || Math.abs(f.time - at) < Math.abs(best.time - at) ? f : best,
        null,
      );
      if (frame) {
        const im = document.createElement("img");
        im.src = frame.url;
        im.alt = "";
        strip.append(im);
      }
    }
    const name = document.createElement("span");
    name.className = "clip-name";
    name.textContent = a?.file.name || "Video";
    const length = document.createElement("small");
    length.className = "clip-duration";
    length.textContent = clock(c.end - c.start);
    b.append(strip, name, length);
    for (const edge of ["start", "end"]) {
      const handle = document.createElement("span");
      handle.className = `trim-handle ${edge}`;
      handle.setAttribute("aria-label", `Trim ${edge}`);
      handle.addEventListener("pointerdown", (e) =>
        trimPointer(e, c, edge, start),
      );
      b.append(handle);
    }
    b.draggable = true;
    b.addEventListener("dragstart", (e) => {
      if (trimming) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData("text/plain", c.id);
    });
    b.addEventListener("dragover", (e) => e.preventDefault());
    b.addEventListener(
      "drop",
      run((e) => {
        e.preventDefault();
        e.stopPropagation();
        if (busy) return;
        const media = e.dataTransfer.getData("application/x-hansora-media");
        if (media) {
          addToTimeline(media,p.clips.findIndex(x=>x.id===c.id));
          return;
        }
        const id = e.dataTransfer.getData("text/plain"),
          from = p.clips.findIndex((x) => x.id === id),
          to = p.clips.findIndex((x) => x.id === c.id);
        if (from >= 0 && from !== to)
          change(() => p.clips.splice(to, 0, p.clips.splice(from, 1)[0]));
      }),
    );
    $("clip-track").append(b);
    offset += c.end - c.start;
  }
  if (p.clips.length) {
    const add = button("", () => $("video-input").click(), "clip-add");
    add.innerHTML = '<svg class="i"><use href="#i-plus"/></svg>';
    add.setAttribute("aria-label", "Add media to the end");
    add.title = "Add media";
    $("clip-track").append(add);
  }
  if (p.clips.length && !captions.length) {
    const add = button("", () => tab("captions"), "track-placeholder");
    add.innerHTML = '<span class="ph"><svg class="i"><use href="#i-captions"/></svg><span>Add captions</span></span>';
    $("caption-track").append(add);
  }
  for (const q of captions) {
    const b = button(
      q.text,
      () => {if(trimming) return;selectOverlay(q.key, q.start);editMode(true);openProps();},
      `caption-segment${selectedOverlay === q.key ? " selected" : ""}`,
    );
    b.style.left = `${q.start * timelineScale}px`;
    b.style.width = `${(q.end - q.start) * timelineScale}px`;
    b.title = q.text;
    b.disabled = busy;
    b.setAttribute("aria-label", q.text);
    for (const edge of ["start", "end"]) {
      const handle = document.createElement("span");
      handle.className = `trim-handle ${edge}`;
      handle.setAttribute("aria-label", edge === "start" ? "Make caption start earlier or later" : "Make caption longer or shorter");
      handle.addEventListener("pointerdown", (e) => captionTrim(e, q, edge));
      b.append(handle);
    }
    $("caption-track").append(b);
  }
  renderExtraTracks();
  for(const label of document.querySelectorAll(".track-label")) label.style.transform=`translateX(${$("timeline-scroll").scrollLeft}px)`;
  updatePlayhead();
}
function renderExtraTracks() {
  $("layer-tracks").replaceChildren();$("audio-tracks").replaceChildren();
  const makeRow=(item,kind,index)=>{
    const audio=kind==="audio",row=document.createElement("div");row.className="track-row extra-track";
    const label=document.createElement("span");label.className="track-label";
    label.textContent=`${audio?"Audio":kind==="image"?"Image":"Text"} ${index+1}`;
    const track=document.createElement("div");track.className="layer-track";track.dataset.layer=item.id;
    const b=document.createElement("div");b.className=`layer-clip ${kind}${(audio?selectedAudio:selectedOverlay)===item.id?" selected":""}`;
    b.tabIndex=0;b.role="button";b.dataset.item=item.id;
    b.style.left=`${item.start*timelineScale}px`;b.style.width=`${(item.end-item.start)*timelineScale}px`;
    const asset=assets.get(item.assetId),name=kind==="text"?item.text:asset?.file.name||"Audio";
    b.setAttribute("aria-label",`${audio?"Audio":kind==="image"?"Image layer":"Text layer"} ${name}`);
    const title=document.createElement("span");title.className="layer-clip-name";title.textContent=name;b.append(title);
    if(kind==="image") {const image=document.createElement("img");image.src=asset.url;image.alt="";image.className="layer-thumb";b.append(image);}
    if(audio) {
      const wave=document.createElement("canvas");wave.className="audio-waveform";wave.width=512;wave.height=40;
      wave.style.width=`${asset.duration*timelineScale}px`;wave.style.transform=`translateX(${-item.in*timelineScale}px)`;
      const cx=wave.getContext("2d"),peaks=asset.peaks;
      if(peaks?.length) {cx.fillStyle="#a2d7c6";for(let i=0;i<512;i++){const peak=peaks[Math.min(peaks.length-1,i)]||0;cx.fillRect(i,20-peak*18,1,Math.max(1,peak*36));}}
      b.append(wave);
      if(item.loop) for(let n=1;n<=Math.ceil((item.in+item.end-item.start)/asset.duration);n++){const copy=document.createElement("canvas");copy.className=wave.className;copy.width=512;copy.height=40;copy.getContext("2d").drawImage(wave,0,0);copy.style.width=wave.style.width;copy.dataset.cycle=n;copy.style.transform=`translateX(${(n*asset.duration-item.in)*timelineScale}px)`;b.append(copy);}
      const length=document.createElement("span");length.className="audio-duration";length.textContent=clock(item.end-item.start);b.append(length);
      const line=document.createElement("div");line.className="volume-line";line.tabIndex=0;line.role="slider";
      line.setAttribute("aria-label",`Volume ${name}`);line.setAttribute("aria-valuemin","0");line.setAttribute("aria-valuemax","100");
      const display=()=>{line.style.top=`${volumeLineTop(item.volume)}px`;line.setAttribute("aria-valuenow",Math.round(item.volume*100));line.setAttribute("aria-valuetext",`${Math.round(item.volume*100)}%`);line.dataset.volume=Math.round(item.volume*100);};display();
      line.addEventListener("pointerdown",e=>volumePointer(e,item,line,display));
      line.addEventListener("keydown",e=>{const delta={ArrowUp:.05,ArrowRight:.05,ArrowDown:-.05,ArrowLeft:-.05}[e.key];if(delta===undefined)return;e.preventDefault();e.stopPropagation();change(()=>item.volume=clamp(item.volume+delta,0,1));syncMusic(playing,false);});
      b.append(line);
    }
    for(const edge of ["start","end"]) {const handle=document.createElement("span");handle.className=`trim-handle ${edge}`;handle.setAttribute("aria-label",`Trim ${edge}`);handle.addEventListener("pointerdown",e=>timedPointer(e,item,edge,b,audio));b.append(handle);}
    b.addEventListener("pointerdown",e=>{if(e.target.closest(".trim-handle,.volume-line")||e.button!==0)return;timedPointer(e,item,"move",b,audio);});
    b.addEventListener("keydown",e=>{if(busy || e.target!==b)return;if(e.key==="Enter"){selectTimed(item,audio);renderUI();}else if(["ArrowLeft","ArrowRight"].includes(e.key)){e.preventDefault();change(()=>moveTimedItem(item,item.start+(e.key==="ArrowRight"?1:-1)*(e.shiftKey?1:.1)));}});
    if(!audio) {
      track.addEventListener("dragover",e=>e.preventDefault());track.addEventListener("drop",run(e=>{e.preventDefault();const id=e.dataTransfer.getData("application/x-hansora-media");if(assets.get(id)?.kind==="image") addImageLayer(id);}));
    }
    track.append(b);row.append(label,track);return row;
  };
  const groups=new Map();
  const add=(item,kind,container)=>{
    const key=`${kind}:${item.track||item.id}`,row=makeRow(item,kind,groups.size);
    if(groups.has(key)) groups.get(key).querySelector(".layer-track").append(row.querySelector(".layer-track").firstChild);
    else {groups.set(key,row);$(container).append(row);}
  };
  [...p.layers].reverse().forEach(item=>add(item,item.kind,"layer-tracks"));
  groups.clear();p.audio.forEach(item=>add(item,"audio","audio-tracks"));
  if(!p.clips.length) return;
  const placeholder=(container,label,icon,fn)=>{
    const row=document.createElement("div");row.className="track-row extra-track empty-track";
    const name=document.createElement("span");name.className="track-label";name.textContent=label;
    const b=button("",fn,"track-placeholder");b.innerHTML=`<span class="ph"><svg class="i"><use href="#${icon}"/></svg><span>Add ${label.toLowerCase()}</span></span>`;
    const track=document.createElement("div");track.className="layer-track";track.append(b);row.append(name,track);$(container).append(row);
  };
  if(!p.layers.length) placeholder("layer-tracks","Text","i-text",()=>$("add-text").click());
  if(!p.audio.length) placeholder("audio-tracks","Audio","i-audio",()=>{tab("audio");$("video-input").click();});
}
// Stretch a caption by dragging its edge; word timings scale with it.
function retimeCue(cue, start, end, from = { start: cue.start, end: cue.end, words: cue.words }) {
  const span = Math.max(0.001, from.end - from.start), k = (end - start) / span;
  cue.words = (from.words?.length ? from.words : timedWords(cue.text, from.start, from.end)).map((w) => ({
    ...w, start: start + (w.start - from.start) * k, end: start + (w.end - from.start) * k,
  }));
  cue.start = start; cue.end = end;
}
function cueBounds(q) {
  const list = p.transcripts[q.clip.assetId] || [], i = list.indexOf(q.source);
  return { min: Math.max(q.clip.start, list[i - 1]?.end ?? 0), max: Math.min(q.clip.end, list[i + 1]?.start ?? Infinity, assets.get(q.clip.assetId)?.duration ?? Infinity) };
}
function resizeCaption(q, delta) {
  const cue = q.source, { max } = cueBounds(q);
  const end = clamp(cue.end + delta, cue.start + 0.3, max);
  if (end === cue.end) throw Error(delta > 0 ? "The next caption starts here. Shorten it first." : "This caption is already very short.");
  change(() => retimeCue(cue, cue.start, end));
}
function captionTrim(e, q, edge) {
  if (busy) return;
  e.preventDefault(); e.stopPropagation(); pause();
  selectedOverlay = q.key; selectedAudio = null; selectedClip = q.clip.id;
  checkpoint(); trimming = true;
  const cue = q.source, from = { start: cue.start, end: cue.end, words: structuredClone(cue.words || []) };
  const { min, max } = cueBounds(q), x = e.clientX, scale = timelineScale;
  const move = (ev) => {
    const delta = (ev.clientX - x) / scale;
    const start = edge === "start" ? clamp(from.start + delta, min, from.end - 0.3) : from.start;
    const end = edge === "end" ? clamp(from.end + delta, from.start + 0.3, max) : from.end;
    retimeCue(cue, start, end, from);
    renderTimeline(); renderInspector(); draw();
  };
  const up = () => {
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
    commit(); editMode(true); setTimeout(() => (trimming = false), 0);
  };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up, { once: true }); window.addEventListener("pointercancel", up, { once: true });
}
function selectTimed(item,audio) {
  if(busy) return;
  editMode(true);openProps();
  pause();selectedAudio=audio?item.id:null;selectedOverlay=audio?null:item.id;
  $("style-scope").value="selected";seek(item.start+.001);renderInspector();draw();
}
function timedPointer(e,item,mode,block,audio) {
  if(busy) return;e.preventDefault();e.stopPropagation();selectTimed(item,audio);checkpoint();trimming=true;
  block.classList.add("selected");const initial=structuredClone(item),x=e.clientX,scale=timelineScale;
  const move=ev=>{
    const delta=(ev.clientX-x)/scale;
    Object.assign(item,structuredClone(initial));
    if(mode==="move") moveTimedItem(item,initial.start+delta);
    else trimTimedItem(item,mode,initial[mode]+delta,assets.get(item.assetId)?.duration);
    block.style.left=`${item.start*scale}px`;block.style.width=`${(item.end-item.start)*scale}px`;
    if(audio){const d=assets.get(item.assetId)?.duration;for(const wave of block.querySelectorAll(".audio-waveform"))wave.style.transform=`translateX(${((Number(wave.dataset.cycle)||0)*d-item.in)*scale}px)`;block.querySelector(".audio-duration").textContent=clock(item.end-item.start);}
    draw();renderInspector();updatePlayhead();
  };
  const up=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up);window.removeEventListener("pointercancel",up);commit();syncMusic();setTimeout(()=>trimming=false,0);};
  window.addEventListener("pointermove",move);window.addEventListener("pointerup",up,{once:true});window.addEventListener("pointercancel",up,{once:true});
}
const volumeLineTop=volume=>16+(1-volume)*22;
function volumePointer(e,item,line,display) {
  if(busy)return;e.preventDefault();e.stopPropagation();selectedAudio=item.id;selectedOverlay=null;checkpoint();
  const y=e.clientY,initial=item.volume;
  const move=ev=>{item.volume=clamp(initial+(y-ev.clientY)/22,0,1);display();syncMusic(playing,false);renderInspector();};
  const up=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up);window.removeEventListener("pointercancel",up);commit();};
  window.addEventListener("pointermove",move);window.addEventListener("pointerup",up,{once:true});window.addEventListener("pointercancel",up,{once:true});
}
function trimPointer(e, c, edge, offset) {
  if (busy) return;
  e.preventDefault();
  e.stopPropagation();
  pause();
  checkpoint();
  trimming = true;
  selectedClip = c.id;
  selectedOverlay = assets.get(c.assetId).kind === "image" ? `scene:${c.id}` : null;
  selectedAudio=null;
  const x = e.clientX,
    initial = c[edge],
    scale = timelineScale;
  trimPreview = { clipId: c.id, edge, initial };
  const move = (ev) => {
    const delta = (ev.clientX - x) / scale;
    c[edge] =
      edge === "start"
        ? clamp(initial + delta, 0, c.end - 0.1)
        : clamp(initial + delta, c.start + 0.1, assets.get(c.assetId).kind === "image" ? 3600 : assets.get(c.assetId).duration);
    renderTimeline();
    renderInspector();
    time = offset + (edge === "end" ? c.end - c.start - 0.01 : 0);
    seek(time);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    trimPreview = null;
    commit();
    seek(time);
    setTimeout(() => (trimming = false), 0);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
  window.addEventListener("pointercancel", up, { once: true });
}
$("timeline-resize").addEventListener("pointerdown",e=>{
  e.preventDefault();const workspace=document.querySelector(".workspace"),rect=workspace.getBoundingClientRect();
  const move=ev=>workspace.style.setProperty("--preview-share",`${clamp((ev.clientY-rect.top)/rect.height*100,25,65)}%`);
  const up=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up);window.removeEventListener("pointercancel",up);};
  window.addEventListener("pointermove",move);window.addEventListener("pointerup",up,{once:true});window.addEventListener("pointercancel",up,{once:true});
});
$("timeline-resize").addEventListener("keydown",e=>{
  const delta={ArrowUp:-5,ArrowDown:5}[e.key];if(delta===undefined)return;e.preventDefault();
  const workspace=document.querySelector(".workspace"),percent=parseFloat(workspace.style.getPropertyValue("--preview-share"))||48;
  workspace.style.setProperty("--preview-share",`${clamp(percent+delta,25,65)}%`);
});
function setZoom(next) {
  const scroller = $("timeline-scroll"), before = lead() + time * timelineScale - scroller.scrollLeft;
  zoomFactor = clamp(next, 1, maxZoom);
  renderTimeline();
  if (!centered()) scroller.scrollLeft = lead() + time * timelineScale - before;
}
$("timeline-zoom").addEventListener("input", () => setZoom(Math.exp(Number($("timeline-zoom").value) * Math.log(maxZoom))));
// Trackpad pinch (and ⌘/Ctrl + scroll) zooms the timeline.
$("timeline-scroll").addEventListener("wheel", (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  setZoom(zoomFactor * Math.exp(-e.deltaY * 0.01));
}, { passive: false });
function scrubPointer(e) {
  if (busy || e.button !== 0 || (centered() && e.pointerType !== "mouse")) return;
  e.preventDefault();
  e.stopPropagation();
  pause();
  $("timeline-playhead").focus({ preventScroll: true });
  const move = (ev) => {
    const at = (ev.clientX - $("timeline-ruler").getBoundingClientRect().left) / timelineScale;
    seek(at);
    // Move the handle immediately, including while a different source loads.
    updatePlayhead();
  };
  const up = (ev) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    if (ev.type !== "pointercancel") move(ev);
  };
  move(e);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
  window.addEventListener("pointercancel", up, { once: true });
}
$("timeline-ruler").addEventListener("pointerdown", scrubPointer);
$("timeline-playhead").addEventListener("pointerdown", scrubPointer);
$("timeline-playhead").addEventListener("keydown", (e) => {
  if (busy) return;
  const step = e.shiftKey ? 1 : 0.1;
  const next = { ArrowLeft: time - step, ArrowRight: time + step,
    Home: 0, End: duration(p) }[e.key];
  if (next === undefined) return;
  e.preventDefault(); pause(); seek(next); updatePlayhead();
});
$("clip-track").addEventListener("dragover", (e) => e.preventDefault());
$("clip-track").addEventListener(
  "drop",
  run((e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("application/x-hansora-media");
    if (id) addToTimeline(id);
  }),
);
$("timeline-scroll").addEventListener("scroll",()=>{
  for(const label of document.querySelectorAll(".track-label")) label.style.transform=`translateX(${$("timeline-scroll").scrollLeft}px)`;
  if(!centered() || busy || trimming || performance.now()-scrollSync<120) return;
  userScrolling=true;clearTimeout(userScrollTimer);
  userScrollTimer=setTimeout(()=>{userScrolling=false;},180);
  if(playing) pause();
  seek($("timeline-scroll").scrollLeft/timelineScale);
},{passive:true});
// Pinch the phone timeline to zoom, like CapCut.
{
  let pinch=null;
  const gap=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
  $("timeline-scroll").addEventListener("touchstart",e=>{if(e.touches.length===2) pinch={gap:gap(e.touches),zoom:zoomFactor};},{passive:true});
  $("timeline-scroll").addEventListener("touchmove",e=>{
    if(!pinch || e.touches.length!==2) return;e.preventDefault();
    setZoom(pinch.zoom*gap(e.touches)/pinch.gap);
  },{passive:false});
  $("timeline-scroll").addEventListener("touchend",()=>{pinch=null;});
}
new ResizeObserver(() => renderTimeline()).observe($("timeline-scroll"));
new ResizeObserver(sizePreview).observe($("preview-wrap"));
click("reverse", async () => {
  const c = currentClip();
  if (!c) return;
  pause();
  setBusy(true);
  const originalLength = c.end - c.start;
  try {
    const file = await reverseVideo(
      assets.get(c.assetId),
      c.start,
      c.end,
      (percent, message) => toast(message),
    );
    if (
      [...assets.values()].reduce((sum, a) => sum + a.file.size, file.size) >
      200 * 1048576
    )
      throw Error(
        "Reversing this selection would exceed the 200 MB project limit. Choose a shorter selection.",
      );
    const a = await loadAsset(file, "video");
    assets.set(a.id, a);
    checkpoint();
    c.assetId = a.id;
    c.start = 0;
    c.end = Math.min(originalLength, a.duration);
    selectedOverlay = null;
    commit();
    await seek(time);
    toast("Clip reversed. Captions on this copy can be added again.");
  } finally {
    setBusy(false);
  }
});

function renderSound() {
  const list=$("sound-list");list.replaceChildren();
  const entries=[...p.clips.filter(c=>assets.get(c.assetId)?.kind==="video").map(c=>({item:c,kind:"Video sound"})),...p.audio.map(item=>({item,kind:"Audio track"}))];
  if(!entries.length){const empty=document.createElement("p");empty.className="muted small";empty.textContent="Add a video, music, or voice file to control its sound.";list.append(empty);}
  for(const {item,kind} of entries){
    const card=document.createElement("div");card.className="sound-card";
    const label=document.createElement("label");label.textContent=`${kind} · ${assets.get(item.assetId)?.file.name}`;
    const output=document.createElement("output");output.textContent=`${Math.round(item.volume*100)}%`;
    const slider=document.createElement("input");slider.type="range";slider.min=0;slider.max=1;slider.step=.01;slider.value=item.volume;slider.setAttribute("aria-label",`${kind} volume ${assets.get(item.assetId)?.file.name}`);
    slider.addEventListener("input",()=>{checkpoint();item.volume=Number(slider.value);output.textContent=`${Math.round(item.volume*100)}%`;const c=locate(p,time)?.clip;if(c)mixer.set(video,c.volume??1);syncMusic(playing,false);applyPreviewMute();renderInspector();
      const line=document.querySelector(`[data-item="${item.id}"] .volume-line`);if(line){line.style.top=`${volumeLineTop(item.volume)}px`;line.setAttribute("aria-valuenow",Math.round(item.volume*100));line.dataset.volume=Math.round(item.volume*100);}
    });
    slider.addEventListener("change",commit);label.append(output,slider);card.append(label);list.append(card);
  }
}
for(const b of document.querySelectorAll("[data-tool]")) b.addEventListener("click",()=>{editMode(false);tab(b.dataset.tool);});
for(const b of document.querySelectorAll("[data-proxy]")) b.addEventListener("click",()=>$(b.dataset.proxy).click());
click("mute-main",()=>{
  const videos=p.clips.filter(c=>assets.get(c.assetId)?.kind==="video");if(!videos.length) return;
  const muted=videos.every(c=>(c.volume??1)===0);
  change(()=>videos.forEach(c=>c.volume=muted?1:0));
  toast(muted?"Clip audio on.":"Clip audio muted.");
});
function syncProxies() {
  const sel=findOverlay();
  document.body.dataset.sel=sel && !sel.scene && sel.kind!=="image" ? "text" : "clip";
  const videos=p.clips.filter(c=>assets.get(c.assetId)?.kind==="video"),muted=videos.length>0&&videos.every(c=>(c.volume??1)===0);
  $("mute-main").setAttribute("aria-pressed",String(muted));$("mute-main").querySelector("span").textContent=muted?"Clip audio off":"Mute clip audio";
  $("mute-main").disabled=!videos.length||busy;
  for(const b of document.querySelectorAll("[data-proxy]")) {const target=$(b.dataset.proxy);b.disabled=target.disabled;b.hidden=target.hidden;}
  for(const b of document.querySelectorAll("[data-aspect]")) b.classList.toggle("active",b.dataset.aspect===p.aspect);
}
function textLength(delta) {
  const q=findOverlay();if(!q) return;
  if(q.kind) { const l=p.layers.find(x=>x.id===q.id); change(()=>trimTimedItem(l,"end",l.end+delta)); }
  else resizeCaption(q,delta);
}
const mobileActions={
  edit:()=>{
    if(!p.clips.length) return tab("media");
    closeSheets();closeRatio();
    if(!selectedTimedItem() && !selectedOverlay) selectedClip=locate(p,time)?.clip.id||selectedClip;
    editMode(true);renderUI();
  },
  back:()=>{editMode(false);selectedOverlay=null;selectedAudio=null;renderUI();},
  ratio:()=>{editMode(false);closeSheets();$("ratio-sheet").hidden=false;document.body.classList.add("ratio-open");},
  "ratio-done":closeRatio,
  "edit-text":()=>{const q=findOverlay();if(!q) return;document.body.classList.add("properties-open");activeTab="media";renderInspector();setTimeout(()=>{$("caption-text").focus();$("caption-text").select();},320);},
  longer:()=>textLength(0.5),
  shorter:()=>textLength(-0.5),
  "split-text":()=>{const q=findOverlay();if(!q) return;if(q.kind)$("split").click();else $("split-caption").click();},
  "delete-text":()=>{const q=findOverlay();if(!q) return;if(q.kind)$("delete-clip").click();else $("delete-caption").click();editMode(false);},
  generations:()=>{editMode(false);closeRatio();return showGenerations();},
  style:()=>{editMode(false);closeRatio();tab("captions");$("caption-style-host").closest("details").open=true;},
};
for(const b of document.querySelectorAll("[data-mobile]")) b.addEventListener("click",run(()=>mobileActions[b.dataset.mobile]()));
for(const b of document.querySelectorAll("[data-aspect]")) b.addEventListener("click",()=>{$("aspect").value=b.dataset.aspect;$("aspect").dispatchEvent(new Event("change"));syncProxies();});
document.querySelector(".sheet-scrim").addEventListener("click",()=>{closeSheets();closeRatio();});
// Desktop: selection settings sit under the tool tabs, so the tabs stay one click away.
function placeInspector() {
  const left=document.querySelector(".left-panel"),right=document.querySelector(".right-panel");
  if(centered()) {if(right.parentElement!==left.parentElement) left.parentElement.insertBefore(right,document.querySelector(".timeline"));}
  else if(right.parentElement!==left) left.insertBefore(right,left.querySelector(".tab-content"));
}
placeInspector();
phone.addEventListener("change",()=>{timelineSpan=null;placeInspector();renderUI();});
click("close-tools",closeSheets);
click("close-properties",()=>{const wasOpen=document.body.classList.contains("properties-open");closeSheets();if(!centered()&&wasOpen){tab(toolTab);document.body.classList.remove("tool-sheet-open");}});
click("toggle-tracks",()=>{const expanded=document.body.classList.toggle("tracks-expanded");$("toggle-tracks").setAttribute("aria-expanded",String(expanded));});
click("edit-selection",()=>{if(centered())activeTab="media";document.body.classList.remove("tool-sheet-open");document.body.classList.add("properties-open");renderInspector();});
click("preview-expand",()=>{closeSheets();focusPreview(!document.body.classList.contains("preview-focus"));});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeSheets();closeRatio();focusPreview(false);}});
click("audio-upload",()=>$("video-input").click());
// 6: generations open as a gallery, 30 per page. Pick several, then add them in the order picked.
let genPage=1, genFilter="all", genPages=1, genLoad=0;
const picked=new Map();
function syncPicked() {
  const n=picked.size;
  $("generation-add").disabled=!n;$("generation-clear").hidden=!n;
  $("generation-add-label").textContent=n?`Add ${n} to video`:"Select media to add";
  const order=[...picked.keys()];
  for(const card of $("generation-list").children){
    const i=order.indexOf(card.dataset.id);
    card.classList.toggle("picked",i>=0);card.setAttribute("aria-pressed",String(i>=0));
    card.querySelector(".gen-add").textContent=i>=0?String(i+1):"";
    if(i<0) card.querySelector(".gen-add").innerHTML='<svg class="i"><use href="#i-plus"/></svg>';
  }
}
function renderPages() {
  const nav=$("generation-pages");nav.replaceChildren();
  if(genPages<2) return;
  const go=(n,label=String(n))=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.disabled=n<1||n>genPages;if(n===genPage)b.className="active";b.addEventListener("click",()=>loadGenerations(n));nav.append(b);};
  go(genPage-1,"‹");
  const shown=new Set([1,genPages,genPage-1,genPage,genPage+1].filter(n=>n>=1&&n<=genPages));
  let last=0;
  for(const n of [...shown].sort((x,y)=>x-y)){ if(n-last>1){const gap=document.createElement("span");gap.textContent="…";nav.append(gap);} go(n); last=n; }
  go(genPage+1,"›");
}
async function loadGenerations(page=1) {
  const ticket=++genLoad;genPage=page;
  $("generation-sign-in").hidden=true;$("generation-list").replaceChildren();$("generation-pages").replaceChildren();
  $("generation-status").textContent="Loading your generations…";
  try {
    const result=await readGenerations(window.__HANSORA_SB__,{page,kind:genFilter});
    if(ticket!==genLoad) return;
    genPages=result.pages;
    $("generation-status").textContent=result.items.length?"Tap to select. You can pick several.":"Nothing here yet.";
    for(const item of result.items){
      const card=document.createElement("button");card.className="gen-card";card.type="button";card.dataset.id=item.id;
      const preview=document.createElement(item.kind==="image"?"img":item.kind==="video"?"video":"span");
      if(item.kind!=="audio"){preview.loading="lazy";if(item.kind==="video"){preview.muted=true;preview.preload="metadata";preview.playsInline=true;preview.src=item.url+"#t=0.5";}else preview.src=item.url;}
      else preview.innerHTML='<svg class="i"><use href="#i-audio"/></svg>';
      preview.className="gen-thumb";
      const badge=document.createElement("span");badge.className="gen-kind";badge.textContent=item.kind==="video"?"Video":item.kind==="image"?"Image":"Audio";
      const mark=document.createElement("span");mark.className="gen-add";
      card.append(preview,badge,mark);card.title=item.title||"";
      card.addEventListener("click",()=>{if(picked.has(item.id))picked.delete(item.id);else picked.set(item.id,item);syncPicked();});
      $("generation-list").append(card);
    }
    $("generation-list").scrollTop=0;
    syncPicked();renderPages();
  }catch(error){if(ticket!==genLoad)return;$("generation-status").textContent=error.message;$("generation-sign-in").hidden=!/Sign in/i.test(error.message);}
}
async function importGeneration(item) {
  let response;try{response=await fetch(item.url);}catch{throw Error("A file could not be imported. Download it from your library and use Upload.");}
  if(!response.ok || /text\/html/.test(response.headers.get("content-type")||""))throw Error("A file could not be imported. Download it from your library and use Upload.");
  const blob=await response.blob(),ext=item.kind==="image"?"png":item.kind==="audio"?"mp3":"mp4";
  const asset=await loadAsset(new File([blob],`Hansora ${String(item.id).replace(':','-')}.${ext}`,{type:blob.type}),item.kind);
  const total=[...assets.values()].reduce((n,a)=>n+a.file.size,asset.file.size);
  if(total>200*1048576){URL.revokeObjectURL(asset.url);throw Error("This project supports up to 200 MB of media.");}
  return asset;
}
click("generation-add",async()=>{
  const items=[...picked.values()];if(!items.length) return;
  $("generation-add").disabled=true;
  let added=0;
  try{
    for(const item of items){
      $("generation-add-label").textContent=`Adding ${added+1} of ${items.length}…`;
      const asset=await importGeneration(item);
      assets.set(asset.id,asset);addToTimeline(asset.id);added++;picked.delete(item.id);
    }
    $("generations-dialog").close();
    toast(`${added} added to your video.`);
  }finally{syncPicked();}
});
click("generation-clear",()=>{picked.clear();syncPicked();});
async function showGenerations() {
  closeSheets();editMode(false);
  if(!$("generations-dialog").open) $("generations-dialog").showModal();
  await loadGenerations(1);
}
for(const b of document.querySelectorAll("[data-gen-filter]")) b.addEventListener("click",()=>{
  genFilter=b.dataset.genFilter;document.querySelectorAll("[data-gen-filter]").forEach(x=>x.classList.toggle("active",x===b));loadGenerations(1);
});
click("my-generations",showGenerations);click("empty-generations",showGenerations);
click("generation-sign-in",()=>{$("generations-dialog").close();openLogin();});

// 9: the last five projects, saved on this device.
const ago=t=>{const m=Math.round((Date.now()-t)/60000);return m<1?"Just now":m<60?`${m} min ago`:m<1440?`${Math.round(m/60)} h ago`:`${Math.round(m/1440)} d ago`;};
async function projectCards(container, compact=false) {
  const items=await listProjects().catch(()=>[]);
  container.replaceChildren();
  for(const item of items){
    const card=document.createElement("div");card.className="project-card"+(item.id===p.id?" current":"");
    const open=document.createElement("button");open.type="button";open.className="project-open";
    const img=document.createElement(item.thumb?"img":"span");if(item.thumb){img.src=item.thumb;img.alt="";}img.className="project-thumb";
    const text=document.createElement("span");text.className="project-text";
    const name=document.createElement("strong");name.textContent=item.name||"Untitled video";
    const when=document.createElement("small");when.textContent=item.id===p.id?"Open now":ago(item.updatedAt);
    text.append(name,when);open.append(img,text);
    open.addEventListener("click",run(async()=>{
      if(item.id===p.id){$("projects-dialog").close();return;}
      const data=await loadProject(item.id);if(!data) throw Error("This project is no longer saved.");
      $("projects-dialog").close();await restore(data);
    }));
    card.append(open);
    if(!compact){
      const del=button("",async()=>{await deleteProject(item.id);projectCards(container);if(item.id===p.id) p.id=newProject().id;},"project-delete");
      del.innerHTML='<svg class="i"><use href="#i-trash"/></svg>';del.setAttribute("aria-label",`Delete ${item.name}`);card.append(del);
    }
    container.append(card);
  }
  return items.length;
}
async function showProjects() {
  $("project-menu-details")?.removeAttribute("open");
  const n=await projectCards($("projects-list"));
  if(!n) $("projects-list").innerHTML='<p class="hint">No saved projects yet. Your work is saved automatically as you edit.</p>';
  $("projects-dialog").showModal();
}
async function renderRecent() {
  if(duration(p)) {$("recent-projects").hidden=true;return;}
  const n=await projectCards($("recent-projects"),true);
  if(n) $("recent-projects").prepend(Object.assign(document.createElement("h2"),{textContent:"Continue editing"}));
  $("recent-projects").hidden=!n;
}
click("your-projects",showProjects);click("resume",showProjects);
click("save-now",async()=>{
  document.querySelector(".project-menu").removeAttribute("open");
  if(!p.clips.length && !assets.size) return toast("Add media first.");
  await saveProject(structuredClone(p),new Map(assets),thumbnail());$("save-status").textContent="Saved on this device";toast("Saved. Find it in Your projects.");
});
click("new-video",()=>{
  document.querySelector(".project-menu").removeAttribute("open");
  pause();for(const a of assets.values()){URL.revokeObjectURL(a.url);a.image?.close?.();}
  assets=new Map();p=newProject();history=[];future=[];pendingBefore=null;selectedClip=null;selectedOverlay=null;selectedAudio=null;time=0;timelineSpan=null;
  video.dataset.asset="";editMode(false);closeSheets();renderUI();renderRecent();toast("New video started. Your last project is saved.");
});
document.addEventListener("click",e=>{const menu=document.querySelector(".project-menu");if(menu.open&&!menu.contains(e.target))menu.removeAttribute("open");});

// 15: the phone back arrow returns to the page the user came from.
$("editor-back").addEventListener("click",e=>{
  e.preventDefault();
  let same=false;try{same=new URL(document.referrer).origin===location.origin;}catch{}
  if(same && window.history.length>1) window.history.back(); else location.href="/";
});

renderUI();
requestAnimationFrame(frame);
await checkConnection();
await Promise.all([
  document.fonts.load('800 32px "Noto Sans"'),
  document.fonts.load('800 32px "Noto Sans Armenian"'),
]);
draw();
migrateDraft().catch(()=>{}).then(renderRecent);
