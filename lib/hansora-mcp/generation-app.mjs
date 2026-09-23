export const GENERATION_APP_URI = 'ui://hansora/generation-v9.html';
export const GENERATION_APP_MIME = 'text/html;profile=mcp-app';

export const GENERATION_APP_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Hansora generation</title>
  <style>
    :root{color-scheme:dark;--bg:#080b14;--panel:#111522;--panel2:#171b2a;--line:rgba(255,255,255,.11);--text:#f7f8fc;--muted:#a9afc0;--violet:#8358ff;--blue:#30bcff;--green:#48d8a5;--red:#ff6d7e;--shadow:0 22px 70px rgba(0,0,0,.34)}
    *{box-sizing:border-box}body{margin:0;background:transparent;color:var(--text);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{position:relative;overflow:hidden;min-height:238px;border:1px solid var(--line);border-radius:24px;background:linear-gradient(145deg,rgba(19,23,38,.98),rgba(8,11,20,.98));box-shadow:var(--shadow)}.glow{position:absolute;inset:-45% -25% auto;height:220px;background:radial-gradient(circle at 35% 50%,rgba(131,88,255,.30),transparent 42%),radial-gradient(circle at 67% 45%,rgba(48,188,255,.22),transparent 40%);filter:blur(20px);pointer-events:none}.head{position:relative;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:18px 20px;border-bottom:1px solid rgba(255,255,255,.07)}.brand{display:flex;align-items:center;gap:11px;min-width:0}.logo{display:grid;place-items:center;width:38px;height:38px;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:linear-gradient(145deg,rgba(131,88,255,.34),rgba(48,188,255,.18));font-weight:950;box-shadow:0 0 28px rgba(131,88,255,.18)}.brand-copy{min-width:0}.brand-name{font-size:14px;font-weight:900;letter-spacing:.02em}.model{overflow:hidden;margin-top:2px;color:var(--muted);font-size:12px;text-overflow:ellipsis;white-space:nowrap}.badge{flex:none;padding:7px 10px;border:1px solid rgba(255,255,255,.12);border-radius:999px;background:rgba(255,255,255,.06);font-size:11px;font-weight:850;letter-spacing:.04em;text-transform:uppercase}.badge.ready{border-color:rgba(72,216,165,.32);color:#8ff0ca;background:rgba(72,216,165,.10)}.badge.failed{border-color:rgba(255,109,126,.32);color:#ff9daa;background:rgba(255,109,126,.10)}.body{position:relative;padding:20px}.processing{display:grid;grid-template-columns:76px 1fr;align-items:center;gap:18px;min-height:118px}.orb-wrap{position:relative;display:grid;place-items:center;width:76px;height:76px}.orbit,.orbit:before,.orbit:after{position:absolute;border-radius:50%;content:""}.orbit{inset:0;border:2px solid transparent;border-top-color:var(--violet);border-right-color:var(--blue);animation:spin 1.15s linear infinite}.orbit:before{inset:8px;border:1px solid rgba(255,255,255,.15);border-left-color:var(--green);animation:spin 1.8s linear infinite reverse}.orbit:after{inset:21px;background:radial-gradient(circle at 32% 28%,#fff 0 4%,#8d6bff 28%,#2449d8 68%,#07112f 100%);box-shadow:0 0 30px rgba(89,102,255,.65);animation:pulse 1.8s ease-in-out infinite}.title{margin:0;font-size:21px;line-height:1.2}.sub{margin:7px 0 0;color:var(--muted);font-size:13px;line-height:1.45}.dots span{animation:blink 1.2s infinite}.dots span:nth-child(2){animation-delay:.18s}.dots span:nth-child(3){animation-delay:.36s}.meta{display:flex;flex-wrap:wrap;gap:7px;margin-top:14px}.chip{padding:6px 9px;border:1px solid rgba(255,255,255,.10);border-radius:9px;background:rgba(255,255,255,.045);color:#d9dced;font-size:11px;font-weight:720}.prompt{display:-webkit-box;overflow:hidden;margin:16px 0 0;color:#d4d7e3;font-size:13px;line-height:1.45;-webkit-box-orient:vertical;-webkit-line-clamp:2}.media{position:relative;overflow:hidden;border-bottom:1px solid rgba(255,255,255,.08);background:#03050a}.media img,.media video{display:block;width:100%;max-height:520px;object-fit:contain;background:#03050a}.media audio{display:block;width:calc(100% - 34px);margin:28px 17px}.result-body{padding:17px 20px 20px}.result-row{display:flex;align-items:flex-start;justify-content:space-between;gap:15px}.actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:16px}.button{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:0 14px;border:1px solid rgba(255,255,255,.13);border-radius:11px;background:rgba(255,255,255,.07);color:#fff;text-decoration:none;font:inherit;font-size:12px;font-weight:850;cursor:pointer}.button.primary{border-color:transparent;background:linear-gradient(105deg,var(--violet),#a05ff4 48%,var(--blue));box-shadow:0 8px 24px rgba(104,88,255,.22)}.button:focus-visible{outline:2px solid #7dd3fc;outline-offset:2px}.error{display:flex;gap:14px;align-items:flex-start}.error-icon{display:grid;place-items:center;flex:none;width:42px;height:42px;border:1px solid rgba(255,109,126,.30);border-radius:13px;background:rgba(255,109,126,.10);color:#ff94a1;font-weight:950}.hidden{display:none!important}@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{50%{transform:scale(.82);filter:brightness(1.3)}}@keyframes blink{0%,70%,100%{opacity:.25}35%{opacity:1}}@media(max-width:520px){.card{border-radius:18px}.head{padding:15px}.body{padding:17px}.processing{grid-template-columns:58px 1fr;gap:14px}.orb-wrap{width:58px;height:58px}.orbit:before{inset:6px}.orbit:after{inset:16px}.title{font-size:18px}.result-body{padding:15px}.button{flex:1}}
    .button:disabled{cursor:wait;opacity:.8}.button.busy::before{content:"";width:13px;height:13px;margin-right:8px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}.dropzone{display:grid;place-items:center;min-height:170px;padding:24px;border:2px dashed rgba(125,211,252,.34);border-radius:17px;background:rgba(48,188,255,.055);text-align:center;cursor:pointer;transition:border-color .18s,background .18s}.dropzone:hover,.dropzone.drag{border-color:var(--blue);background:rgba(48,188,255,.11)}.dropzone.has-file{display:block;padding:0;overflow:hidden;border-style:solid}.dropzone img,.dropzone video{display:block;width:100%;max-height:360px;object-fit:contain;background:#03050a}.dropzone audio{display:block;width:calc(100% - 32px);margin:42px 16px}.upload-copy strong{display:block;font-size:18px}.upload-copy span{display:block;margin-top:7px;color:var(--muted);font-size:13px}.progress{height:8px;margin-top:14px;overflow:hidden;border-radius:999px;background:rgba(255,255,255,.09)}.progress span{display:block;width:0;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--violet),var(--blue));transition:width .16s}.upload-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:15px}.upload-actions .button{flex:1}.upload-status{margin-top:12px}.multi-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:17px}.media-option{display:flex;min-height:112px;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:14px 10px;border:1px solid rgba(255,255,255,.12);border-radius:15px;background:rgba(255,255,255,.045);color:#fff;text-align:center;cursor:pointer}.media-option:hover{border-color:var(--blue);background:rgba(48,188,255,.09)}.media-icon{font-size:27px;line-height:1}.media-label{font-size:13px;font-weight:850}.media-count{color:var(--muted);font-size:11px;line-height:1.25}.multi-files{margin-top:13px;color:#d9dced;font-size:12px;line-height:1.5}.multi-files div{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}@media(max-width:520px){.multi-grid{grid-template-columns:1fr}.media-option{min-height:78px}}
  </style>
</head>
<body>
  <main class="card" aria-live="polite">
    <div class="glow"></div>
    <header class="head">
      <div class="brand"><div class="logo" aria-hidden="true">H</div><div class="brand-copy"><div class="brand-name">HANSORA AI</div><div class="model" id="model">AI generation</div></div></div>
      <div class="badge" id="badge">Starting</div>
    </header>
    <section id="upload" class="body hidden">
      <h1 class="title" id="uploadTitle">Animate your image</h1>
      <p class="sub" id="uploadDetails">Drop an image here. Hansora will upload it securely and use it as the first frame.</p>
      <button class="dropzone" id="dropzone" type="button"><span class="upload-copy"><strong>Drop image here</strong><span>or click to choose a JPG, PNG, WebP, GIF, AVIF, HEIC, or HEIF file</span></span></button>
      <input id="fileInput" class="hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif">
      <div class="meta" id="uploadMeta"></div>
      <div class="progress hidden" id="uploadProgress"><span id="uploadProgressBar"></span></div>
      <p class="sub upload-status" id="uploadStatus" role="status">Choose one image to continue.</p>
      <div class="upload-actions"><button class="button" id="changeImage" type="button" disabled>Choose image</button><button class="button primary" id="generate" type="button" disabled>Upload and generate</button></div>
    </section>
    <section id="multiUpload" class="body hidden">
      <h1 class="title">Add your reference media</h1>
      <p class="sub" id="multiDetails">Choose every file requested for this generation.</p>
      <div class="multi-grid">
        <button class="media-option" id="multiImageButton" type="button"><span class="media-icon" aria-hidden="true">🖼️</span><span class="media-label">Images</span><span class="media-count" id="multiImageCount">Choose images</span></button>
        <button class="media-option" id="multiVideoButton" type="button"><span class="media-icon" aria-hidden="true">🎬</span><span class="media-label">Videos</span><span class="media-count" id="multiVideoCount">Choose videos</span></button>
        <button class="media-option" id="multiAudioButton" type="button"><span class="media-icon" aria-hidden="true">🎧</span><span class="media-label">Audio</span><span class="media-count" id="multiAudioCount">Choose audio</span></button>
      </div>
      <input id="multiImageInput" class="hidden" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif">
      <input id="multiVideoInput" class="hidden" type="file" multiple accept="video/mp4,video/quicktime,video/webm">
      <input id="multiAudioInput" class="hidden" type="file" multiple accept="audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg,audio/flac,.mp3,.wav,.m4a,.aac,.ogg,.flac">
      <div class="multi-files" id="multiFiles"></div>
      <div class="meta" id="multiMeta"></div>
      <div class="progress hidden" id="multiProgress"><span id="multiProgressBar"></span></div>
      <p class="sub upload-status" id="multiStatus" role="status">Choose the required files to continue.</p>
      <div class="upload-actions"><button class="button primary" id="multiGenerate" type="button" disabled>Upload all and generate</button></div>
    </section>
    <section id="processing" class="body processing">
      <div class="orb-wrap" aria-hidden="true"><div class="orbit"></div></div>
      <div><h1 class="title">Creating your result<span class="dots"><span>.</span><span>.</span><span>.</span></span></h1><p class="sub" id="processingText">Hansora is generating your media. This card will update automatically.</p><div class="meta" id="processingMeta"></div><p class="prompt" id="processingPrompt"></p></div>
    </section>
    <section id="ready" class="hidden">
      <div class="media" id="media"></div>
      <div class="result-body"><div class="result-row"><div><h1 class="title">Your creation is ready</h1><p class="sub" id="readyDetails"></p></div></div><p class="prompt" id="readyPrompt"></p><div class="actions"><button class="button primary" id="download" type="button">Download result</button><button class="button" id="open" type="button">Open full size</button></div><p class="sub hidden" id="actionStatus" role="status"></p></div>
    </section>
    <section id="failed" class="body hidden"><div class="error"><div class="error-icon" aria-hidden="true">!</div><div><h1 class="title">Generation failed</h1><p class="sub" id="errorText">Hansora could not complete this request.</p><div class="actions"><button class="button" id="retry" type="button">Check again</button></div></div></div></section>
  </main>
  <script>
  (() => {
    'use strict';
    const el = (id) => document.getElementById(id);
    const pending = new Map();
    let nextId = 1;
    let initialized = false;
    let state = {};
    let pollTimer = 0;
    let pollStartedAt = 0;
    let pollBusy = false;
    let resizeFrame = 0;
    let lastHeight = 0;
    let selectedFile = null;
    let selectedMime = '';
    let previewUrl = '';
    let uploadBusy = false;
    const multiFiles = { image: [], video: [], audio: [] };
    const publicFailureMessage = 'Generation failed. Please try again and make sure your prompt and image do not violate any policy.';
    function reportSize() {
      if (!initialized || resizeFrame) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0;
        const card = document.querySelector('.card');
        const height = Math.ceil(card.getBoundingClientRect().height);
        if (!height || height === lastHeight) return;
        lastHeight = height;
        window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { height } }, '*');
      });
    }

    function request(method, params) {
      if (window.openai && typeof window.openai.callTool === 'function' && method === 'tools/call') {
        return window.openai.callTool(params.name, params.arguments || {});
      }
      const id = nextId++;
      window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        window.setTimeout(() => {
          const item = pending.get(id);
          if (!item) return;
          pending.delete(id);
          reject(new Error('host_timeout'));
        }, 30000);
      });
    }

    async function openResult(download) {
      const button = el(download ? 'download' : 'open');
      if (button.disabled) return;
      const resultUrl = urls(state)[0];
      if (!resultUrl) return;
      const url = new URL(resultUrl);
      const status = el('actionStatus');
      const canDownload = download && url.hostname === 'qmaealblegvcwodlmeht.supabase.co' && url.pathname.startsWith('/storage/v1/object/');
      if (canDownload) url.searchParams.set('download', '');
      button.disabled = true;
      button.classList.toggle('busy', true);
      button.setAttribute('aria-busy', 'true');
      button.textContent = download ? 'Starting download…' : 'Opening…';
      status.classList.toggle('hidden', false);
      status.textContent = download ? 'Requesting your file…' : 'Opening your result…';
      reportSize();
      try {
        const response = await request('ui/open-link', { url: url.href });
        if (response?.isError) throw new Error('open_failed');
        status.textContent = canDownload
          ? 'Download requested. Check your browser’s downloads for progress; large files can take longer.'
          : 'Opened in your browser.';
      } catch {
        status.textContent = download
          ? 'Could not start the download. Please try again or use Open full size.'
          : 'Could not open the result. Please try again.';
      } finally {
        button.disabled = false;
        button.classList.toggle('busy', false);
        button.setAttribute('aria-busy', 'false');
        button.textContent = download ? 'Download result' : 'Open full size';
        reportSize();
      }
    }

    function text(value, fallback = '') { return value == null ? fallback : String(value); }
    function safeUrl(value) {
      try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url.href : ''; }
      catch { return ''; }
    }
    function urls(value) {
      const meta = value && typeof value.meta === 'object' ? value.meta : {};
      const candidates = [value?.result_url, value?.url, value?.video_url, value?.image_url, value?.audio_url, meta.result_url, ...(Array.isArray(value?.result_urls) ? value.result_urls : []), ...(Array.isArray(meta.result_urls) ? meta.result_urls : []), ...(Array.isArray(meta.urls) ? meta.urls : [])];
      return [...new Set(candidates.map(safeUrl).filter(Boolean))];
    }
    function statusOf(value) {
      const meta = value && typeof value.meta === 'object' ? value.meta : {};
      if (urls(value).length) return 'ready';
      if (value?.failed === true || value?.isError === true) return 'failed';
      const status = text(value?.status || meta.status || value?.provider?.status || 'processing').toLowerCase();
      if (/(ready|done|complete|completed|success)/.test(status)) return 'ready';
      if (/(fail|error|refund|cancel)/.test(status)) return 'failed';
      return 'processing';
    }
    function mediaType(value, url) {
      const meta = value && typeof value.meta === 'object' ? value.meta : {};
      const known = text(value?.media_type || value?.category || value?.kind || meta.media_type || meta.kind).toLowerCase();
      if (known.includes('audio') || known.includes('music') || /\.(mp3|wav|m4a|aac|ogg)(?:$|\?)/i.test(url)) return 'audio';
      if (known.includes('video') || /\.(mp4|webm|mov|m4v)(?:$|\?)/i.test(url)) return 'video';
      return 'image';
    }
    function modelName(value) {
      const meta = value && typeof value.meta === 'object' ? value.meta : {};
      return text(value?.model_name || value?.model_id || meta.model_name || meta.model || value?.provider, 'AI generation');
    }
    function promptOf(value) {
      const meta = value && typeof value.meta === 'object' ? value.meta : {};
      return text(value?.prompt || meta.prompt || state.prompt);
    }
    function setMeta(container, value) {
      container.replaceChildren();
      const meta = value && typeof value.meta === 'object' ? value.meta : {};
      const values = [value?.resolution || meta.resolution, value?.aspect_ratio || meta.aspect_ratio || meta.aspectRatio, value?.duration || meta.duration ? text(value?.duration || meta.duration) + 's' : '', value?.credits_debited ? text(value.credits_debited) + ' credits' : ''].filter(Boolean);
      values.forEach((item) => { const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = text(item); container.appendChild(chip); });
    }
    function show(section) {
      ['upload', 'multiUpload', 'processing', 'ready', 'failed'].forEach((name) => el(name).classList.toggle('hidden', name !== section));
      reportSize();
    }
    function resultData(result) {
      const value = result?.structuredContent || result?.content?.find?.((item) => item.type === 'text')?.text;
      if (typeof value === 'string') { try { return JSON.parse(value); } catch { return {}; } }
      return value && typeof value === 'object' ? value : {};
    }
    function formatBytes(bytes) {
      const mb = Number(bytes || 0) / (1024 * 1024);
      return mb >= 1 ? mb.toFixed(mb >= 10 ? 0 : 1) + ' MB' : Math.max(1, Math.round(Number(bytes || 0) / 1024)) + ' KB';
    }
    function mediaMime(file, requestedKind = '') {
      const declared = text(file?.type).toLowerCase();
      const kind = requestedKind || uploadKind();
      const video = kind === 'video';
      const audio = kind === 'audio';
      const aliases = { 'audio/mp3': 'audio/mpeg', 'audio/x-wav': 'audio/wav', 'audio/x-m4a': 'audio/mp4' };
      const normalized = aliases[declared] || declared;
      const allowed = audio
        ? ['audio/mpeg','audio/wav','audio/mp4','audio/aac','audio/ogg','audio/flac']
        : video ? ['video/mp4','video/quicktime','video/webm'] : ['image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif'];
      if (allowed.includes(normalized)) return normalized;
      const extension = text(file?.name).toLowerCase().split('.').pop();
      const inferred = ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac' })[extension] || '';
      return allowed.includes(inferred) ? inferred : '';
    }
    function uploadKind() { return state.mode === 'audio_upload' ? 'audio' : state.mode === 'video_upload' ? 'video' : 'image'; }
    function requiredInputs() {
      const values = Array.isArray(state.required_inputs) ? state.required_inputs : [];
      return [...new Set(values.filter((kind) => ['image', 'video', 'audio'].includes(kind)))];
    }
    function multiLimit(kind) {
      const configured = state.upload_limits && typeof state.upload_limits === 'object' ? state.upload_limits[kind] : null;
      const defaults = { image: { max_files: 9, max_mb: 30 }, video: { max_files: 3, max_mb: 200 }, audio: { max_files: 3, max_mb: 15 } };
      return { ...defaults[kind], ...(configured && typeof configured === 'object' ? configured : {}) };
    }
    function updateMultiSelection() {
      const required = requiredInputs();
      const labels = { image: 'image', video: 'video', audio: 'audio' };
      required.forEach((kind) => {
        const limit = multiLimit(kind);
        const count = multiFiles[kind].length;
        const name = kind.charAt(0).toUpperCase() + kind.slice(1);
        el('multi' + name + 'Count').textContent = count + ' / ' + limit.max_files + ' ' + labels[kind] + (limit.max_files === 1 ? '' : 's');
      });
      const fileList = el('multiFiles'); fileList.replaceChildren();
      required.forEach((kind) => multiFiles[kind].forEach((file) => {
        const row = document.createElement('div');
        row.textContent = (kind === 'image' ? '🖼️ ' : kind === 'video' ? '🎬 ' : '🎧 ') + text(file.name, kind) + ' · ' + formatBytes(file.size);
        fileList.appendChild(row);
      }));
      const ready = required.length > 0 && required.every((kind) => multiFiles[kind].length > 0);
      el('multiGenerate').disabled = !ready || uploadBusy;
      if (ready) el('multiStatus').textContent = 'All requested media is ready. Upload everything and start the generation.';
      reportSize();
    }
    function chooseMultiFiles(kind, files) {
      const limit = multiLimit(kind);
      const selected = Array.from(files || []);
      if (!selected.length) return;
      if (selected.length > Number(limit.max_files || 1)) {
        el('multiStatus').textContent = 'This model accepts up to ' + limit.max_files + ' ' + kind + ' file' + (limit.max_files === 1 ? '' : 's') + '.';
        return;
      }
      for (const file of selected) {
        if (!mediaMime(file, kind)) {
          el('multiStatus').textContent = 'One selected file is not a supported ' + kind + ' format.';
          return;
        }
        if (!file.size || file.size > Number(limit.max_mb || 1) * 1024 * 1024) {
          el('multiStatus').textContent = 'Each ' + kind + ' file must be ' + limit.max_mb + ' MB or smaller.';
          return;
        }
      }
      multiFiles[kind] = selected;
      updateMultiSelection();
    }
    function renderMultiUpload() {
      stopPolling(); show('multiUpload');
      const required = requiredInputs();
      el('model').textContent = modelName(state);
      el('badge').className = 'badge'; el('badge').textContent = 'Add media';
      const names = required.map((kind) => kind.charAt(0).toUpperCase() + kind.slice(1));
      el('multiDetails').textContent = 'Add the ' + names.join(names.length > 1 ? ', ' : '') + ' reference' + (names.length > 1 ? 's' : '') + ' requested for ' + modelName(state) + '.';
      ['image', 'video', 'audio'].forEach((kind) => {
        const name = kind.charAt(0).toUpperCase() + kind.slice(1);
        el('multi' + name + 'Button').classList.toggle('hidden', !required.includes(kind));
      });
      const meta = el('multiMeta'); meta.replaceChildren();
      const quote = state.quote && typeof state.quote === 'object' ? state.quote : {};
      const values = [state.duration ? text(state.duration) + 's' : '', state.resolution, state.aspect_ratio, quote.displayedCredits == null ? '' : text(quote.displayedCredits) + ' credits'].filter(Boolean);
      values.forEach((item) => { const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = text(item); meta.appendChild(chip); });
      updateMultiSelection();
    }
    function renderUploadMeta() {
      const quote = state.quote && typeof state.quote === 'object' ? state.quote : {};
      const cost = quote.displayedCredits == null ? '' : text(quote.displayedCredits) + ' credits';
      const values = [state.audio_duration_seconds ? Math.ceil(Number(state.audio_duration_seconds)) + 's' : '', state.duration ? text(state.duration) + 's' : '', state.resolution, state.aspect_ratio, cost].filter(Boolean);
      const meta = el('uploadMeta'); meta.replaceChildren();
      values.forEach((item) => { const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = text(item); meta.appendChild(chip); });
    }
    function renderUpload() {
      stopPolling(); show('upload');
      const video = state.mode === 'video_upload';
      const audio = state.mode === 'audio_upload';
      el('model').textContent = modelName(state);
      el('badge').className = 'badge'; el('badge').textContent = audio ? 'Add audio' : video ? 'Add video' : 'Add image';
      el('uploadTitle').textContent = audio ? 'Upload your audio' : video ? 'Upload your video' : 'Animate your image';
      renderUploadMeta();
      el('uploadDetails').textContent = audio
        ? 'Drop an audio file for ' + modelName(state) + '. Hansora will read its duration, calculate the quote, and process it.'
        : video
        ? 'Drop a video for ' + modelName(state) + '. Hansora will upload it and use it as the source video.'
        : 'Drop an image for ' + modelName(state) + '. It stays in Hansora storage and becomes the first frame.';
      const zone = el('dropzone');
      if (!selectedFile) {
        zone.replaceChildren(); zone.classList.toggle('has-file', false);
        const copy = document.createElement('span'); copy.className = 'upload-copy';
        const strong = document.createElement('strong'); strong.textContent = audio ? 'Drop audio here' : video ? 'Drop video here' : 'Drop image here';
        const hint = document.createElement('span'); hint.textContent = audio ? 'or click to choose an MP3, WAV, M4A, AAC, OGG, or FLAC file up to 200 MB' : video ? 'or click to choose an MP4, MOV, or WebM file up to 200 MB' : 'or click to choose a JPG, PNG, WebP, GIF, AVIF, HEIC, or HEIF file';
        copy.appendChild(strong); copy.appendChild(hint); zone.appendChild(copy);
      }
      el('fileInput').accept = audio ? 'audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg,audio/flac,.mp3,.wav,.m4a,.aac,.ogg,.flac' : video ? 'video/mp4,video/quicktime,video/webm' : 'image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif';
      el('changeImage').textContent = audio ? 'Choose audio' : video ? 'Choose video' : 'Choose image';
      if (!selectedFile) el('uploadStatus').textContent = audio ? 'Choose one audio file to continue.' : video ? 'Choose one video to continue.' : 'Choose one image to continue.';
      reportSize();
    }
    async function finishAudioSelection(preview, file) {
      const duration = Number(preview.duration || 0);
      if (!Number.isFinite(duration) || duration <= 0) {
        el('uploadStatus').textContent = 'Hansora could not read this audio file. Please choose another supported file.';
        return;
      }
      state.audio_duration_seconds = duration;
      el('uploadStatus').textContent = 'Calculating the credit quote…';
      try {
        const result = await request('tools/call', { name: 'quote_generation', arguments: { model_id: state.audio_tool_id, audio_duration_seconds: duration, quantity: 1 } });
        if (result?.isError) throw new Error('quote_failed');
        state.quote = resultData(result);
        renderUploadMeta();
        el('generate').disabled = false;
        el('uploadStatus').textContent = text(file.name, 'Audio') + ' · ' + formatBytes(file.size) + ' · ' + Math.ceil(duration) + 's. Ready to upload and generate.';
      } catch {
        el('uploadStatus').textContent = 'Could not calculate the audio price. Please try another file.';
      }
      reportSize();
    }
    function chooseFile(file) {
      if (!file) return;
      const video = state.mode === 'video_upload';
      const audio = state.mode === 'audio_upload';
      const mime = mediaMime(file);
      if (!mime) { el('uploadStatus').textContent = audio ? 'Please choose an MP3, WAV, M4A, AAC, OGG, or FLAC audio file.' : video ? 'Please choose an MP4, MOV, or WebM video.' : 'Please choose a supported image file.'; return; }
      const maxBytes = (audio || video ? 200 : 25) * 1024 * 1024;
      if (!file.size || file.size > maxBytes) { el('uploadStatus').textContent = 'The ' + uploadKind() + ' must be ' + (audio || video ? '200' : '25') + ' MB or smaller.'; return; }
      selectedFile = file;
      selectedMime = mime;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(file);
      const zone = el('dropzone'); zone.replaceChildren(); zone.classList.toggle('has-file', true);
      const preview = document.createElement(audio ? 'audio' : video ? 'video' : 'img'); preview.src = previewUrl;
      if (video) { preview.controls = true; preview.playsInline = true; preview.preload = 'metadata'; }
      else if (audio) { preview.controls = true; preview.preload = 'metadata'; }
      else preview.alt = 'Selected image preview';
      zone.appendChild(preview);
      el('changeImage').disabled = false; el('generate').disabled = audio;
      if (audio) {
        el('uploadStatus').textContent = 'Reading audio duration…';
        preview.addEventListener('loadedmetadata', () => finishAudioSelection(preview, file), { once: true });
        preview.addEventListener('error', () => { el('uploadStatus').textContent = 'Hansora could not read this audio file. Please choose another supported file.'; }, { once: true });
      } else el('uploadStatus').textContent = text(file.name, video ? 'Video' : 'Image') + ' · ' + formatBytes(file.size) + '. Ready to upload and generate.';
      reportSize();
    }
    function uploadFile(url, file, mime, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url, true); xhr.timeout = 600000;
        xhr.setRequestHeader('Content-Type', mime || file.type || 'application/octet-stream');
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          const percent = Math.max(1, Math.min(100, Math.round((event.loaded / event.total) * 100)));
          if (typeof onProgress === 'function') { onProgress(percent); return; }
          el('uploadProgressBar').style.width = percent + '%';
          el('uploadStatus').textContent = 'Uploading ' + uploadKind() + '… ' + percent + '%';
        };
        xhr.onload = () => ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 409) ? resolve() : reject(new Error('upload_failed_' + xhr.status));
        xhr.onerror = () => reject(new Error('upload_network_error'));
        xhr.ontimeout = () => reject(new Error('upload_timeout'));
        xhr.send(file);
      });
    }
    function generationArguments(publicUrl) {
      const video = state.mode === 'video_upload';
      const args = { model_id: state.model_id, prompt: state.prompt, usage_mode: state.usage_mode || 'credits' };
      if (video) args.video_urls = [publicUrl];
      else args.image_urls = [publicUrl];
      if (video && state.image_url) args.image_urls = [state.image_url];
      ['aspect_ratio','duration','resolution','quality','sound','generate_audio','enable_web_search','prompt_extend','video_start','video_end','motion_model'].forEach((key) => {
        if (state[key] !== undefined && state[key] !== null && state[key] !== '') args[key] = state[key];
      });
      return args;
    }
    function multiGenerationArguments(uploaded) {
      const args = {
        model_id: state.model_id,
        prompt: state.prompt,
        usage_mode: state.usage_mode || 'credits',
        image_urls: uploaded.image,
        video_urls: uploaded.video,
        audio_urls: uploaded.audio
      };
      ['aspect_ratio','duration','resolution','quality','sound','generate_audio','enable_web_search','prompt_extend','video_start','video_end','motion_model'].forEach((key) => {
        if (state[key] !== undefined && state[key] !== null && state[key] !== '') args[key] = state[key];
      });
      return args;
    }
    function audioArguments(publicUrl) {
      const args = {
        audio_tool_id: state.audio_tool_id,
        audio_url: publicUrl,
        audio_duration_seconds: state.audio_duration_seconds,
        remove_background_noise: state.remove_background_noise !== false
      };
      if (state.voice_id) args.voice_id = state.voice_id;
      return args;
    }
    async function uploadAndGenerate() {
      if (!selectedFile || uploadBusy) return;
      uploadBusy = true;
      const generate = el('generate'); const change = el('changeImage');
      generate.disabled = true; change.disabled = true; generate.classList.toggle('busy', true); generate.textContent = 'Preparing upload…';
      el('uploadProgress').classList.toggle('hidden', false); el('uploadProgressBar').style.width = '2%';
      try {
        const mode = state.mode;
        const prepareTool = mode === 'audio_upload' ? 'prepare_audio_upload' : mode === 'video_upload' ? 'prepare_video_upload' : 'prepare_image_upload';
        const signedResult = await request('tools/call', { name: prepareTool, arguments: { filename: selectedFile.name, mime: selectedMime, size: selectedFile.size } });
        const signed = resultData(signedResult);
        if (!signed.upload_url || !signed.public_url) throw new Error('upload_not_authorized');
        generate.textContent = 'Uploading…';
        await uploadFile(signed.upload_url, selectedFile, signed.mime || selectedMime);
        el('uploadProgressBar').style.width = '100%'; el('uploadStatus').textContent = 'Upload complete. Starting generation…';
        generate.textContent = 'Starting generation…';
        const createdResult = await request('tools/call', { name: mode === 'audio_upload' ? 'create_audio' : 'create_generation', arguments: mode === 'audio_upload' ? audioArguments(signed.public_url) : generationArguments(signed.public_url) });
        if (createdResult?.isError) throw new Error(createdResult?.content?.[0]?.text || 'generation_failed');
        const created = resultData(createdResult);
        if (!created.run_id) throw new Error(created.error || created.message || 'generation_not_started');
        state = { ...state, mode: '', status: 'processing' };
        render({ ...created, mode: '' });
      } catch (error) {
        el('uploadStatus').textContent = error?.message === 'upload_timeout' ? 'The upload timed out. Please try again.' : 'Could not upload or start the generation. Please try again.';
        generate.disabled = false; change.disabled = false;
      } finally {
        uploadBusy = false; generate.classList.toggle('busy', false); generate.textContent = 'Upload and generate'; reportSize();
      }
    }
    async function uploadMultiAndGenerate() {
      if (uploadBusy) return;
      const required = requiredInputs();
      if (!required.length || !required.every((kind) => multiFiles[kind].length)) return;
      uploadBusy = true;
      const button = el('multiGenerate'); button.disabled = true; button.classList.toggle('busy', true); button.textContent = 'Preparing uploads…';
      el('multiProgress').classList.toggle('hidden', false); el('multiProgressBar').style.width = '2%';
      const uploaded = { image: [], video: [], audio: [] };
      const queue = required.flatMap((kind) => multiFiles[kind].map((file) => ({ kind, file, mime: mediaMime(file, kind) })));
      let completed = 0;
      try {
        for (const item of queue) {
          const position = completed + 1;
          el('multiStatus').textContent = 'Preparing ' + item.kind + ' ' + position + ' of ' + queue.length + '…';
          const signedResult = await request('tools/call', {
            name: 'prepare_' + item.kind + '_upload',
            arguments: { filename: item.file.name, mime: item.mime, size: item.file.size }
          });
          const signed = resultData(signedResult);
          if (!signed.upload_url || !signed.public_url) throw new Error('upload_not_authorized');
          await uploadFile(signed.upload_url, item.file, signed.mime || item.mime, (percent) => {
            const totalPercent = Math.round(((completed + percent / 100) / queue.length) * 100);
            el('multiProgressBar').style.width = Math.max(2, totalPercent) + '%';
            el('multiStatus').textContent = 'Uploading ' + item.kind + ' ' + position + ' of ' + queue.length + '… ' + percent + '%';
          });
          uploaded[item.kind].push(signed.public_url);
          completed += 1;
        }
        el('multiProgressBar').style.width = '100%';
        el('multiStatus').textContent = 'All files uploaded. Starting generation…';
        button.textContent = 'Starting generation…';
        const createdResult = await request('tools/call', { name: 'create_generation', arguments: multiGenerationArguments(uploaded) });
        if (createdResult?.isError) throw new Error(createdResult?.content?.[0]?.text || 'generation_failed');
        const created = resultData(createdResult);
        if (!created.run_id) throw new Error(created.error || created.message || 'generation_not_started');
        state = { ...state, mode: '', status: 'processing' };
        render({ ...created, mode: '' });
      } catch (error) {
        el('multiStatus').textContent = error?.message === 'upload_timeout' ? 'An upload timed out. Please try again.' : 'Could not upload the media or start the generation. Please try again.';
        button.disabled = false;
      } finally {
        uploadBusy = false; button.classList.toggle('busy', false); button.textContent = 'Upload all and generate'; updateMultiSelection();
      }
    }
    async function initializeApp() {
      try {
        await request('ui/initialize', {
          protocolVersion: '2026-01-26',
          appInfo: { name: 'Hansora Generation', version: '1.0.0' },
          appCapabilities: { availableDisplayModes: ['inline'] }
        });
        window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, '*');
        initialized = true;
        if (typeof ResizeObserver !== 'undefined') {
          const observer = new ResizeObserver(reportSize);
          observer.observe(document.querySelector('.card'));
        }
        window.addEventListener('resize', reportSize);
        document.addEventListener('load', reportSize, true);
        document.addEventListener('loadedmetadata', reportSize, true);
        reportSize();
        if (window.openai?.toolInput && typeof window.openai.toolInput === 'object') state = { ...state, ...window.openai.toolInput };
        if (window.openai?.toolOutput && typeof window.openai.toolOutput === 'object') render(window.openai.toolOutput);
        else if (statusOf(state) === 'processing') startPolling();
      } catch {
        el('processingText').textContent = 'Hansora could not connect this result card to the chat. Reconnect Hansora and try again.';
      }
    }
    function render(value) {
      if (!value || typeof value !== 'object') return;
      state = { ...state, ...value, meta: { ...(state.meta || {}), ...(value.meta || {}) } };
      if (state.mode === 'multi_upload') { renderMultiUpload(); return; }
      if (state.mode === 'image_upload' || state.mode === 'video_upload' || state.mode === 'audio_upload') { renderUpload(); return; }
      el('model').textContent = modelName(state);
      const status = statusOf(state);
      el('badge').className = 'badge' + (status === 'ready' ? ' ready' : status === 'failed' ? ' failed' : '');
      el('badge').textContent = status === 'ready' ? 'Ready' : status === 'failed' ? 'Failed' : 'Generating';
      if (status === 'ready') {
        stopPolling();
        const resultUrl = urls(state)[0];
        if (!resultUrl) return render({ status: 'processing' });
        show('ready');
        const media = el('media'); media.replaceChildren();
        const kind = mediaType(state, resultUrl);
        let node;
        if (kind === 'video') { node = document.createElement('video'); node.controls = true; node.playsInline = true; node.preload = 'metadata'; }
        else if (kind === 'audio') { node = document.createElement('audio'); node.controls = true; node.preload = 'metadata'; }
        else { node = document.createElement('img'); node.alt = 'Hansora AI generated image'; node.loading = 'eager'; }
        node.src = resultUrl; media.appendChild(node);

        el('readyDetails').textContent = [modelName(state), kind.charAt(0).toUpperCase() + kind.slice(1)].filter(Boolean).join(' · ');
        el('readyPrompt').textContent = promptOf(state);
        return;
      }
      if (status === 'failed') {
        stopPolling(); show('failed');
        el('errorText').textContent = publicFailureMessage;
        return;
      }
      show('processing');
      setMeta(el('processingMeta'), state);
      el('processingPrompt').textContent = promptOf(state);
      startPolling();
    }
    function runId() { return text(state.run_id || state.meta?.run_id); }
    async function poll() {
      if (pollBusy || document.hidden) return;
      const id = runId(); if (!id) return;
      pollBusy = true;
      try {
        const result = await request('tools/call', { name: 'get_generation', arguments: { run_id: id } });
        const next = result?.structuredContent || result?.content?.find?.((item) => item.type === 'text')?.text;
        if (typeof next === 'string') { try { render(JSON.parse(next)); } catch {} }
        else if (next && typeof next === 'object') render(next);
      } catch {}
      finally { pollBusy = false; }
      if (Date.now() - pollStartedAt > 15 * 60 * 1000 && statusOf(state) === 'processing') {
        stopPolling();
        el('processingText').textContent = 'This is taking longer than usual. You can keep this conversation open and check the generation again.';
      }
    }
    function startPolling() {
      if (!initialized || pollTimer || !runId()) return;
      pollStartedAt = pollStartedAt || Date.now();
      pollTimer = window.setInterval(poll, 6000);
      window.setTimeout(poll, 1200);
    }
    function stopPolling() { if (pollTimer) window.clearInterval(pollTimer); pollTimer = 0; }

    window.addEventListener('message', (event) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.jsonrpc !== '2.0') return;
      if (message.id !== undefined && pending.has(message.id)) {
        const item = pending.get(message.id); pending.delete(message.id);
        if (message.error) item.reject(message.error); else item.resolve(message.result);
        return;
      }
      if (message.method === 'ui/notifications/tool-input' && message.params && typeof message.params === 'object') state = { ...state, ...(message.params.arguments || message.params) };
      if (message.method === 'ui/notifications/tool-result') render(message.params?.structuredContent || {});
    }, { passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    el('download').addEventListener('click', () => openResult(true));
    el('open').addEventListener('click', () => openResult(false));
    el('retry').addEventListener('click', () => { render({ status: 'processing', failed: false, isError: false, error: '' }); poll(); });
    el('dropzone').addEventListener('click', () => el('fileInput').click());
    el('changeImage').addEventListener('click', () => el('fileInput').click());
    el('fileInput').addEventListener('change', (event) => chooseFile(event.target.files?.[0]));
    el('dropzone').addEventListener('dragover', (event) => { event.preventDefault(); el('dropzone').classList.toggle('drag', true); });
    el('dropzone').addEventListener('dragleave', () => el('dropzone').classList.toggle('drag', false));
    el('dropzone').addEventListener('drop', (event) => { event.preventDefault(); el('dropzone').classList.toggle('drag', false); chooseFile(event.dataTransfer?.files?.[0]); });
    el('generate').addEventListener('click', uploadAndGenerate);
    ['image', 'video', 'audio'].forEach((kind) => {
      const name = kind.charAt(0).toUpperCase() + kind.slice(1);
      el('multi' + name + 'Button').addEventListener('click', () => el('multi' + name + 'Input').click());
      el('multi' + name + 'Input').addEventListener('change', (event) => chooseMultiFiles(kind, event.target.files));
    });
    el('multiGenerate').addEventListener('click', uploadMultiAndGenerate);
    initializeApp();
  })();
  </script>
</body>
</html>`;

export function generationAppResource() {
  return {
    contents: [{
      uri: GENERATION_APP_URI,
      mimeType: GENERATION_APP_MIME,
      text: GENERATION_APP_HTML,
      _meta: {
        ui: {
          prefersBorder: false,
          csp: {
            connectDomains: ['https://qmaealblegvcwodlmeht.supabase.co'],
            resourceDomains: [
              'https://hansora.co',
              'https://qmaealblegvcwodlmeht.supabase.co'
            ]
          }
        },
        'openai/widgetPrefersBorder': false,
        'openai/widgetCSP': {
          connect_domains: ['https://qmaealblegvcwodlmeht.supabase.co'],
          resource_domains: [
            'https://hansora.co',
            'https://qmaealblegvcwodlmeht.supabase.co'
          ]
        }
      }
    }]
  };
}

export const GENERATION_TOOL_META = {
  ui: { resourceUri: GENERATION_APP_URI, visibility: ['model', 'app'] },
  'openai/outputTemplate': GENERATION_APP_URI,
  'openai/widgetAccessible': true
};
