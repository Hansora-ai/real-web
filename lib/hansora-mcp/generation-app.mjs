export const GENERATION_APP_URI = 'ui://hansora/generation-v6.html';
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
    .button:disabled{cursor:wait;opacity:.8}.button.busy::before{content:"";width:13px;height:13px;margin-right:8px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}.dropzone{display:grid;place-items:center;min-height:170px;padding:24px;border:2px dashed rgba(125,211,252,.34);border-radius:17px;background:rgba(48,188,255,.055);text-align:center;cursor:pointer;transition:border-color .18s,background .18s}.dropzone:hover,.dropzone.drag{border-color:var(--blue);background:rgba(48,188,255,.11)}.dropzone.has-file{display:block;padding:0;overflow:hidden;border-style:solid}.dropzone img{display:block;width:100%;max-height:360px;object-fit:contain;background:#03050a}.upload-copy strong{display:block;font-size:18px}.upload-copy span{display:block;margin-top:7px;color:var(--muted);font-size:13px}.progress{height:8px;margin-top:14px;overflow:hidden;border-radius:999px;background:rgba(255,255,255,.09)}.progress span{display:block;width:0;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--violet),var(--blue));transition:width .16s}.upload-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:15px}.upload-actions .button{flex:1}.upload-status{margin-top:12px}
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
      <h1 class="title">Animate your image</h1>
      <p class="sub" id="uploadDetails">Drop an image here. Hansora will upload it securely and use it as the first frame.</p>
      <button class="dropzone" id="dropzone" type="button"><span class="upload-copy"><strong>Drop image here</strong><span>or click to choose a JPG, PNG, WebP, GIF, AVIF, HEIC, or HEIF file</span></span></button>
      <input id="fileInput" class="hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif">
      <div class="meta" id="uploadMeta"></div>
      <div class="progress hidden" id="uploadProgress"><span id="uploadProgressBar"></span></div>
      <p class="sub upload-status" id="uploadStatus" role="status">Choose one image to continue.</p>
      <div class="upload-actions"><button class="button" id="changeImage" type="button" disabled>Choose image</button><button class="button primary" id="generate" type="button" disabled>Upload and generate</button></div>
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
      ['upload', 'processing', 'ready', 'failed'].forEach((name) => el(name).classList.toggle('hidden', name !== section));
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
    function imageMime(file) {
      const declared = text(file?.type).toLowerCase();
      const allowed = ['image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif'];
      if (allowed.includes(declared)) return declared;
      const extension = text(file?.name).toLowerCase().split('.').pop();
      return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif' })[extension] || '';
    }
    function renderUpload() {
      stopPolling(); show('upload');
      el('model').textContent = modelName(state);
      el('badge').className = 'badge'; el('badge').textContent = 'Add image';
      const quote = state.quote && typeof state.quote === 'object' ? state.quote : {};
      const cost = quote.displayedCredits == null ? '' : text(quote.displayedCredits) + ' credits';
      const values = [state.duration ? text(state.duration) + 's' : '', state.resolution, state.aspect_ratio, cost].filter(Boolean);
      const meta = el('uploadMeta'); meta.replaceChildren();
      values.forEach((item) => { const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = text(item); meta.appendChild(chip); });
      el('uploadDetails').textContent = 'Drop an image for ' + modelName(state) + '. It stays in Hansora storage and becomes the first frame.';
      reportSize();
    }
    function chooseFile(file) {
      if (!file) return;
      const mime = imageMime(file);
      if (!mime) { el('uploadStatus').textContent = 'Please choose a supported image file.'; return; }
      if (!file.size || file.size > 25 * 1024 * 1024) { el('uploadStatus').textContent = 'The image must be 25 MB or smaller.'; return; }
      selectedFile = file;
      selectedMime = mime;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(file);
      const zone = el('dropzone'); zone.replaceChildren(); zone.classList.toggle('has-file', true);
      const image = document.createElement('img'); image.alt = 'Selected image preview'; image.src = previewUrl; zone.appendChild(image);
      el('changeImage').disabled = false; el('generate').disabled = false;
      el('uploadStatus').textContent = text(file.name, 'Image') + ' · ' + formatBytes(file.size) + '. Ready to upload and generate.';
      reportSize();
    }
    function uploadFile(url, file, mime) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url, true); xhr.timeout = 120000;
        xhr.setRequestHeader('Content-Type', mime || file.type || 'application/octet-stream');
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          const percent = Math.max(1, Math.min(100, Math.round((event.loaded / event.total) * 100)));
          el('uploadProgressBar').style.width = percent + '%';
          el('uploadStatus').textContent = 'Uploading image… ' + percent + '%';
        };
        xhr.onload = () => ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 409) ? resolve() : reject(new Error('upload_failed_' + xhr.status));
        xhr.onerror = () => reject(new Error('upload_network_error'));
        xhr.ontimeout = () => reject(new Error('upload_timeout'));
        xhr.send(file);
      });
    }
    function generationArguments(publicUrl) {
      const args = { model_id: state.model_id, prompt: state.prompt, image_urls: [publicUrl], usage_mode: state.usage_mode || 'credits' };
      ['aspect_ratio','duration','resolution','quality','sound','generate_audio','prompt_extend'].forEach((key) => {
        if (state[key] !== undefined && state[key] !== null && state[key] !== '') args[key] = state[key];
      });
      return args;
    }
    async function uploadAndGenerate() {
      if (!selectedFile || uploadBusy) return;
      uploadBusy = true;
      const generate = el('generate'); const change = el('changeImage');
      generate.disabled = true; change.disabled = true; generate.classList.toggle('busy', true); generate.textContent = 'Preparing upload…';
      el('uploadProgress').classList.toggle('hidden', false); el('uploadProgressBar').style.width = '2%';
      try {
        const signedResult = await request('tools/call', { name: 'prepare_image_upload', arguments: { filename: selectedFile.name, mime: selectedMime, size: selectedFile.size } });
        const signed = resultData(signedResult);
        if (!signed.upload_url || !signed.public_url) throw new Error('upload_not_authorized');
        generate.textContent = 'Uploading…';
        await uploadFile(signed.upload_url, selectedFile, signed.mime || selectedMime);
        el('uploadProgressBar').style.width = '100%'; el('uploadStatus').textContent = 'Upload complete. Starting generation…';
        generate.textContent = 'Starting generation…';
        const createdResult = await request('tools/call', { name: 'create_generation', arguments: generationArguments(signed.public_url) });
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
      if (state.mode === 'image_upload') { renderUpload(); return; }
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
        const meta = state.meta || {};
        el('errorText').textContent = text(state.error || state.message || meta.error || meta.fail_reason, 'Hansora could not complete this request.');
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
