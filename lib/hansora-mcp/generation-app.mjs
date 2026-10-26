export const GENERATION_APP_URI = 'ui://hansora/generation-v9.html';
export const GENERATION_APP_MIME = 'text/html;profile=mcp-app';

// Supabase's public (anon) key, the same one the website ships. It can only call rate_generation here.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtYWVhbGJsZWd2Y3dvZGxtZWh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg2MjkzNzMsImV4cCI6MjA3NDIwNTM3M30.bUV6W0zBtkd_6gtfPGBSpskybUmpLC-1znljoDpYy4c';

export const GENERATION_APP_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Hansora generation</title>
  <style>
    :root{color-scheme:dark;--card:#1c1c21;--subtle:#26262d;--subtle2:#2e2e36;--line:rgba(255,255,255,.09);--line-strong:rgba(255,255,255,.18);--text:#f4f4f6;--muted:#a1a1ab;--accent:#6366f1;--accent-hover:#7375f5;--accent-soft:rgba(99,102,241,.16);--accent-text:#a5a8ff;--green:#34d399;--green-soft:rgba(52,211,153,.14);--red:#f87171;--red-soft:rgba(248,113,113,.14);--media:#0e0e12}
    @media (prefers-color-scheme:light){:root:not([data-theme="dark"]){color-scheme:light;--card:#ffffff;--subtle:#f4f4f6;--subtle2:#ebebef;--line:rgba(0,0,0,.09);--line-strong:rgba(0,0,0,.2);--text:#18181b;--muted:#6b6b76;--accent:#5b5bd6;--accent-hover:#4f4fc7;--accent-soft:rgba(91,91,214,.1);--accent-text:#4b4bc4;--green:#059669;--green-soft:rgba(5,150,105,.1);--red:#dc2626;--red-soft:rgba(220,38,38,.08);--media:#f4f4f6}}
    :root[data-theme="light"]{color-scheme:light;--card:#ffffff;--subtle:#f4f4f6;--subtle2:#ebebef;--line:rgba(0,0,0,.09);--line-strong:rgba(0,0,0,.2);--text:#18181b;--muted:#6b6b76;--accent:#5b5bd6;--accent-hover:#4f4fc7;--accent-soft:rgba(91,91,214,.1);--accent-text:#4b4bc4;--green:#059669;--green-soft:rgba(5,150,105,.1);--red:#dc2626;--red-soft:rgba(220,38,38,.08);--media:#f4f4f6}
    *{box-sizing:border-box}body{margin:0;background:transparent;color:var(--text);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
    .card{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:20px;background:var(--card)}
    .head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line)}
    .brand{display:flex;align-items:center;gap:10px;min-width:0}.logo{display:grid;place-items:center;flex:none;width:28px;height:28px;border-radius:50%;background:#6366f1;color:#fff;font-size:14px;font-weight:800}
    .brand-copy{min-width:0;line-height:1.25}.brand-name{font-size:13px;font-weight:700}.model{overflow:hidden;color:var(--muted);font-size:12px;text-overflow:ellipsis;white-space:nowrap}
    .badge{display:inline-flex;align-items:center;gap:6px;flex:none;padding:5px 10px;border-radius:999px;background:var(--accent-soft);color:var(--accent-text);font-size:12px;font-weight:600}
    .badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;animation:pulse 1.4s ease-in-out infinite}
    .badge.ready{background:var(--green-soft);color:var(--green)}.badge.failed{background:var(--red-soft);color:var(--red)}.badge.ready::before,.badge.failed::before{animation:none}
    .body{padding:16px}.title{margin:0;font-size:17px;font-weight:650;line-height:1.3}.sub{margin:4px 0 0;color:var(--muted);font-size:13px;line-height:1.45}
    .meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}.meta:empty{display:none}
    .chip{padding:4px 9px;border-radius:999px;background:var(--subtle);color:var(--muted);font-size:12px;font-weight:550}.chip.cost{background:var(--accent-soft);color:var(--accent-text);font-weight:650}
    .prompt{display:-webkit-box;overflow:hidden;margin:12px 0 0;padding:0 12px 0 15px;border-top:10px solid transparent;border-bottom:10px solid transparent;border-radius:12px;box-shadow:inset 3px 0 0 var(--accent);background:var(--subtle);color:var(--text);font-size:13px;line-height:1.45;-webkit-box-orient:vertical;-webkit-line-clamp:3}.prompt:empty{display:none}
    .processing-title{display:flex;align-items:center;gap:10px}
    .spinner{flex:none;width:18px;height:18px;border:2px solid var(--accent-soft);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}
    .placeholder{position:relative;overflow:hidden;width:100%;max-height:220px;margin-bottom:14px;border-radius:14px;background:var(--subtle);aspect-ratio:16/9}
    .placeholder::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 20%,var(--subtle2) 50%,transparent 80%);transform:translateX(-100%);animation:shimmer 1.6s ease-in-out infinite}
    .media{position:relative;overflow:hidden;background:var(--media)}.media img,.media video{display:block;width:100%;max-height:520px;object-fit:contain;background:var(--media)}.media audio{display:block;width:calc(100% - 32px);margin:24px 16px}
    .result-body{padding:14px 16px 16px}.result-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
    .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
    .rate{display:flex;align-items:center;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}
    .rate-btn{display:grid;place-items:center;width:36px;height:36px;padding:0;border:1px solid var(--line);border-radius:999px;background:var(--subtle);font-size:17px;line-height:1;cursor:pointer}
    .rate-btn:hover{background:var(--subtle2)}.rate-btn[aria-pressed="true"]{border-color:var(--accent);background:var(--accent-soft)}
    .rate-more{margin-top:10px}.reasons{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
    .reason{min-height:32px;padding:0 12px;border:1px solid var(--line);border-radius:999px;background:var(--subtle);color:var(--text);font:inherit;font-size:13px;cursor:pointer}
    .reason[aria-pressed="true"]{border-color:var(--accent);background:var(--accent-soft);color:var(--accent-text)}
    .rate-comment{display:flex;gap:8px;margin-top:8px}.rate-comment input{flex:1;min-width:0;min-height:36px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:var(--subtle);color:var(--text);font:inherit;font-size:14px}
    .button{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 16px;border:1px solid var(--line);border-radius:12px;background:var(--subtle);color:var(--text);text-decoration:none;font:inherit;font-size:14px;font-weight:600;cursor:pointer;transition:background .15s,opacity .15s}
    .button:hover{background:var(--subtle2)}.button.primary{border-color:transparent;background:var(--accent);color:#fff}.button.primary:hover{background:var(--accent-hover)}
    .button[aria-pressed="true"]{border-color:var(--accent);color:var(--accent-text)}
    .button:focus-visible,.dropzone:focus-visible,.media-option:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .button:disabled{opacity:.4;cursor:not-allowed}.button.busy{opacity:.85;cursor:wait}
    .button.busy::before{content:"";width:14px;height:14px;margin-right:8px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}
    .button.link{min-height:0;padding:0;border:0;background:none;color:var(--accent-text);font-size:13px}.button.link:hover{background:none;text-decoration:underline}
    .error{display:flex;gap:12px;align-items:flex-start}.error-icon{display:grid;place-items:center;flex:none;width:36px;height:36px;border-radius:50%;background:var(--red-soft);color:var(--red);font-weight:800}
    .dropzone{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;width:100%;min-height:176px;margin-top:14px;padding:22px;border:1.5px dashed var(--line-strong);border-radius:14px;background:var(--subtle);color:var(--text);font:inherit;text-align:center;cursor:pointer;transition:border-color .15s,background .15s}
    .dropzone:hover,.dropzone.drag{border-color:var(--accent);background:var(--accent-soft)}
    .dropzone.has-file{display:block;min-height:0;padding:0;overflow:hidden;border-style:solid;border-color:var(--line);background:var(--media)}
    .dropzone img,.dropzone video{display:block;width:100%;max-height:320px;object-fit:contain;background:var(--media)}.dropzone audio{display:block;width:calc(100% - 32px);margin:40px 16px}
    .upload-icon{display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:var(--card);color:var(--accent-text)}
    .upload-copy strong{display:block;font-size:14px;font-weight:600}.upload-copy span{display:block;margin-top:3px;color:var(--muted);font-size:12px}
    .progress{height:6px;margin-top:12px;overflow:hidden;border-radius:999px;background:var(--subtle)}.progress span{display:block;width:0;height:100%;border-radius:inherit;background:var(--accent);transition:width .16s}
    .upload-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px}.upload-row .upload-status{margin:0;min-width:0}
    .upload-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.upload-actions .button{flex:1}
    .multi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:14px}
    .media-option{display:flex;align-items:center;gap:12px;min-height:64px;padding:12px 14px;border:1.5px dashed var(--line-strong);border-radius:14px;background:var(--subtle);color:var(--text);font:inherit;text-align:left;cursor:pointer;transition:border-color .15s,background .15s}
    .media-option:hover{border-color:var(--accent);background:var(--accent-soft)}.media-option.done{border-style:solid;border-color:var(--accent)}
    .media-icon{display:grid;place-items:center;flex:none;width:36px;height:36px;border-radius:10px;background:var(--card);color:var(--accent-text)}
    .media-text{display:flex;flex-direction:column;min-width:0}.media-label{font-size:14px;font-weight:600}.media-count{color:var(--muted);font-size:12px}
    .multi-files{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.multi-files:empty{display:none}
    .multi-files div{overflow:hidden;max-width:100%;padding:4px 9px;border-radius:999px;background:var(--subtle);color:var(--muted);font-size:12px;text-overflow:ellipsis;white-space:nowrap}
    .gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-top:14px}
    .tile{position:relative;display:grid;place-items:center;overflow:hidden;aspect-ratio:1/1;padding:0;border:1px solid var(--line);border-radius:12px;background:var(--subtle);color:var(--muted);font:inherit;font-size:12px;font-weight:600}
    .tile.ready:hover{border-color:var(--accent)}
    .tile-open{position:absolute;inset:0;display:grid;place-items:center;width:100%;height:100%;padding:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer}
    .tile-open:focus-visible,.tile-dl:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
    .tile-dl{position:absolute;right:6px;bottom:6px;display:grid;place-items:center;width:30px;height:30px;padding:0;border:0;border-radius:999px;background:rgba(0,0,0,.65);color:#fff;font-size:16px;line-height:1;cursor:pointer}
    .tile-dl:hover{background:var(--accent)}
    .tile img,.tile video{display:block;width:100%;height:100%;object-fit:cover}
    .tile.processing::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 20%,var(--subtle2) 50%,transparent 80%);transform:translateX(-100%);animation:shimmer 1.6s ease-in-out infinite}
    .tile.failed{background:var(--red-soft);color:var(--red)}
    .tile-index{position:absolute;top:6px;left:6px;pointer-events:none;min-width:20px;padding:2px 7px;border-radius:999px;background:rgba(0,0,0,.6);color:#fff;font-size:11px;font-weight:600;text-align:center}
    .hidden{display:none!important}
    @keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{50%{opacity:.35}}@keyframes shimmer{to{transform:translateX(100%)}}
    @media (prefers-reduced-motion:reduce){*{animation-duration:0s!important;animation-iteration-count:1!important}}
    @media (max-width:520px){.card{border-radius:16px}.head{padding:12px 14px}.body{padding:14px}.result-body{padding:12px 14px 14px}.title{font-size:16px}.actions .button{flex:1}}
  </style>
</head>
<body>
  <main class="card" aria-live="polite">
        <header class="head">
      <div class="brand"><div class="logo" aria-hidden="true">H</div><div class="brand-copy"><div class="brand-name">Hansora AI</div><div class="model" id="model">AI generation</div></div></div>
      <div class="badge" id="badge">Starting</div>
    </header>
    <section id="upload" class="body hidden">
      <h1 class="title" id="uploadTitle">Animate your image</h1>
      <p class="sub" id="uploadDetails">Drop an image here. Hansora will upload it securely and use it as the first frame.</p>
      <p class="prompt" id="uploadPrompt"></p>
      <button class="dropzone" id="dropzone" type="button"><span class="upload-copy"><strong>Drop image here</strong><span>or click to choose a file</span></span></button>
      <input id="fileInput" class="hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif">
      <div class="meta" id="uploadMeta"></div>
      <div class="progress hidden" id="uploadProgress"><span id="uploadProgressBar"></span></div>
      <div class="upload-row"><p class="sub upload-status" id="uploadStatus" role="status">Choose one image to continue.</p><button class="button link hidden" id="changeImage" type="button">Choose another</button></div>
      <div class="upload-actions"><button class="button primary" id="generate" type="button" disabled>Generate</button></div>
    </section>
    <section id="multiUpload" class="body hidden">
      <h1 class="title">Add your reference media</h1>
      <p class="sub" id="multiDetails">Choose every file requested for this generation.</p>
      <p class="prompt" id="multiPrompt"></p>
      <div class="multi-grid">
        <button class="media-option" id="multiImageButton" type="button"><span class="media-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L5 21"/></svg></span><span class="media-text"><span class="media-label">Images</span><span class="media-count" id="multiImageCount">Choose images</span></span></button>
        <button class="media-option" id="multiVideoButton" type="button"><span class="media-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="14" height="14" rx="3"/><path d="m16 10 6-3v10l-6-3"/></svg></span><span class="media-text"><span class="media-label">Videos</span><span class="media-count" id="multiVideoCount">Choose videos</span></span></button>
        <button class="media-option" id="multiAudioButton" type="button"><span class="media-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg></span><span class="media-text"><span class="media-label">Audio</span><span class="media-count" id="multiAudioCount">Choose audio</span></span></button>
      </div>
      <input id="multiImageInput" class="hidden" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif">
      <input id="multiVideoInput" class="hidden" type="file" multiple accept="video/mp4,video/quicktime,video/webm">
      <input id="multiAudioInput" class="hidden" type="file" multiple accept="audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg,audio/flac,.mp3,.wav,.m4a,.aac,.ogg,.flac">
      <div class="multi-files" id="multiFiles"></div>
      <div class="meta" id="multiMeta"></div>
      <div class="progress hidden" id="multiProgress"><span id="multiProgressBar"></span></div>
      <p class="sub upload-status" id="multiStatus" role="status">Choose the required files to continue.</p>
      <div class="upload-actions"><button class="button primary" id="multiGenerate" type="button" disabled>Generate</button></div>
    </section>
    <section id="processing" class="body hidden">
      <div class="placeholder" id="placeholder" aria-hidden="true"></div>
      <div class="processing-title"><span class="spinner" aria-hidden="true"></span><h1 class="title" id="processingTitle">Creating your result</h1></div>
      <p class="sub" id="processingText">Hansora is generating your media. This card will update automatically.</p><div class="meta" id="processingMeta"></div><p class="prompt" id="processingPrompt"></p>
    </section>
    <section id="batch" class="body hidden">
      <h1 class="title" id="batchTitle">Your results</h1><p class="sub" id="batchText"></p>
      <div class="gallery" id="gallery"></div>
      <p class="sub hidden" id="batchStatus" role="status"></p>
    </section>
    <section id="ready" class="hidden">
      <div class="media" id="media"></div>
      <div class="actions hidden" id="audioVersions" style="padding:0 16px" role="group" aria-label="Song versions"></div>
      <div class="result-body"><div class="result-row"><div><h1 class="title">Your creation is ready</h1><p class="sub" id="readyDetails"></p></div></div><p class="prompt" id="readyPrompt"></p><div class="actions"><button class="button primary" id="download" type="button">Download result</button><button class="button" id="open" type="button">Open full size</button></div><p class="sub hidden" id="actionStatus" role="status"></p>
      <div class="rate" id="rate"><span class="sub" id="rateLabel">Like it?</span><button class="rate-btn" id="rateUp" type="button" aria-label="I like it" aria-pressed="false">👍</button><button class="rate-btn" id="rateDown" type="button" aria-label="I don't like it" aria-pressed="false">👎</button></div>
      <div class="rate-more hidden" id="rateMore"><p class="sub">What didn't you like?</p><div class="reasons" id="rateReasons"><button class="reason" type="button" aria-pressed="false">Too expensive</button><button class="reason" type="button" aria-pressed="false">Too slow</button><button class="reason" type="button" aria-pressed="false">Didn't match my request</button><button class="reason" type="button" aria-pressed="false">Low quality</button></div><div class="rate-comment"><input id="rateComment" type="text" maxlength="300" placeholder="A few words (optional)" aria-label="What didn't you like?"><button class="button" id="rateSend" type="button">Send</button></div></div></div>
    </section>
    <section id="failed" class="body hidden"><div class="error"><div class="error-icon" aria-hidden="true">!</div><div><h1 class="title" id="failedTitle">Generation failed</h1><p class="sub" id="errorText">Hansora could not complete this request.</p><div class="actions"><button class="button" id="retry" type="button">Check again</button></div></div></div></section>
    <section id="unavailable" class="body"><h1 class="title" id="statusTitle">Checking your result</h1><p class="sub" id="statusText">Loading the saved generation from this conversation…</p><div class="actions hidden" id="statusActions"><button class="button" id="refresh" type="button">Check again</button><button class="button" id="history" type="button">Open Hansora history</button></div></section>
  </main>
  <script>
  (() => {
    'use strict';
    const el = (id) => document.getElementById(id);
    const pending = new Map();
    let nextId = 1;
    let initialized = false;
    let state = {};
    let selectedAudioIndex = 0;
    let pollTimer = 0;
    let pollStartedAt = 0;
    let pollBusy = false;
    let pollFailures = 0;
    let lastPollAt = 0;
    let waitingTimer = 0;
    let inView = true;
    let savedSnapshot = '';
    let ratedRun = '';
    let myRating = 0;
    let ratingSent = false;
    let renderedMediaKey = '';
    let renderedBatchKey = '';
    let refreshUnavailable = false;
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
        if (params.name !== 'get_generation') return window.openai.callTool(params.name, params.arguments || {});
        // A disconnected host can leave callTool unresolved indefinitely.
        return new Promise((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error('host_timeout')), 30000);
          Promise.resolve().then(() => window.openai.callTool(params.name, params.arguments || {}))
            .then(resolve, reject).finally(() => window.clearTimeout(timer));
        });
      }
      const id = nextId++;
      return new Promise((resolve, reject) => {
        // The iframe can run before its parent installs the bridge listener on a
        // cold chat reload. Resend only this read-only handshake, with the same
        // request ID, until the parent responds. Never retry a tool invocation.
        const initializing = method === 'ui/initialize';
        let retryTimer = 0;
        const finish = (callback, value) => {
          pending.delete(id);
          window.clearTimeout(timer);
          window.clearInterval(retryTimer);
          callback(value);
        };
        const timer = window.setTimeout(() => {
          if (pending.has(id)) finish(reject, new Error('host_timeout'));
        }, initializing ? 5000 : 30000);
        pending.set(id, { resolve: (value) => finish(resolve, value), reject: (error) => finish(reject, error), timer });
        const send = () => window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
        if (initializing) retryTimer = window.setInterval(send, 500);
        send();
      });
    }

    async function openResult(download) {
      const button = el(download ? 'download' : 'open');
      if (button.disabled) return;
      const resultUrl = urls(state)[selectedAudioIndex] || urls(state)[0];
      if (!resultUrl) return;
      const url = new URL(resultUrl);
      const status = el('actionStatus');
      const canDownload = download && isStorageUrl(url);
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
      const candidates = [value?.result_url, value?.url, value?.video_url, value?.image_url, value?.audio_url, meta.audio_url, meta.result_url, ...(Array.isArray(value?.audio_urls) ? value.audio_urls : []), ...(Array.isArray(meta.audio_urls) ? meta.audio_urls : []), ...(Array.isArray(value?.result_urls) ? value.result_urls : []), ...(Array.isArray(meta.result_urls) ? meta.result_urls : []), ...(Array.isArray(meta.urls) ? meta.urls : [])];
      return [...new Set(candidates.map(safeUrl).filter(Boolean))];
    }
    function statusOf(value) {
      const meta = value && typeof value.meta === 'object' ? value.meta : {};
      if (urls(value).length) return 'ready';
      if (value?.failed === true || value?.isError === true) return 'failed';
      const status = text(value?.status || meta.status || value?.provider?.status || 'processing').toLowerCase();
      if (/^(ready|done|complete|completed|success|succeeded)$/.test(status)) return 'ready';
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
      const name = text(value?.model_name || meta.model_name || value?.model_id || meta.model || value?.provider, 'AI generation');
      // Older results only carry an id such as "nano-banana-2"; show it as "Nano Banana 2".
      return /^[a-z0-9]+(?:[-_.][a-z0-9]+)+$/.test(name) && !name.includes('/')
        ? name.split(/[-_]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
        : name;
    }
    function promptOf(value) {
      const meta = value && typeof value.meta === 'object' ? value.meta : {};
      return text(value?.prompt || meta.prompt || state.prompt);
    }
    function setMeta(container, value) {
      container.replaceChildren();
      const meta = value && typeof value.meta === 'object' ? value.meta : {};
      const credits = value?.credits ?? value?.credits_debited;
      chips(container, [value?.duration || meta.duration ? text(value?.duration || meta.duration) + 's' : '', value?.resolution || meta.resolution, value?.aspect_ratio || meta.aspect_ratio || meta.aspectRatio, credits != null ? text(credits) + ' credits' : '']);
    }
    function chips(container, values) {
      container.replaceChildren();
      values.filter(Boolean).forEach((item) => {
        const chip = document.createElement('span');
        chip.className = / credits$/.test(item) ? 'chip cost' : 'chip';
        chip.textContent = text(item);
        container.appendChild(chip);
      });
    }
    function costText() {
      const quote = state.quote && typeof state.quote === 'object' ? state.quote : {};
      const credits = quote.credits ?? quote.displayedCredits;
      if (credits == null && state.price_by_video_length && state.credits_per_10_seconds != null) return text(state.credits_per_10_seconds) + ' credits / 10s';
      return credits == null ? '' : text(credits) + ' credits';
    }
    function generateLabel() { return costText() ? 'Generate · ' + costText() : 'Generate'; }
    function ratioOf(value) {
      const raw = text(value?.aspect_ratio || value?.meta?.aspect_ratio).match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/);
      return raw ? raw[1] + '/' + raw[2] : '';
    }
    function applyTheme(theme) {
      const root = document.documentElement;
      if ((theme === 'light' || theme === 'dark') && root?.dataset) root.dataset.theme = theme;
    }
    function show(section) {
      ['upload', 'multiUpload', 'processing', 'batch', 'ready', 'failed', 'unavailable'].forEach((name) => el(name).classList.toggle('hidden', name !== section));
      reportSize();
    }
    function resultData(result, depth = 0) {
      if (!result || depth > 5) return {};
      if (typeof result === 'string') { try { return resultData(JSON.parse(result), depth + 1); } catch { return {}; } }
      if (typeof result !== 'object' || Array.isArray(result)) return {};
      // ChatGPT can restore the canonical envelope rather than toolOutput.
      if (result.isError) return { isError: true, busy: result.structuredContent?.error === 'temporarily_unavailable' };
      const nested = result.mcp_tool_result || result.call_tool_result || result.structuredContent;
      if (nested) return resultData(nested, depth + 1);
      if (Array.isArray(result.content)) {
        for (const item of result.content) {
          if (item.type !== 'text') continue;
          const value = resultData(item.text, depth + 1);
          if (Object.keys(value).length) return value;
        }
        return {};
      }
      return result;
    }
    function generationId(value) { return text(value?.run_id || value?.meta?.run_id); }
    function isUpload(value) { return /^(multi|image|video|audio)_upload$/.test(value?.mode || ''); }
    function persistResult() {
      if (!runId() || typeof window.openai?.setWidgetState !== 'function') return;
      // Keep only presentation data, never provider payloads or upload credentials.
      const result = { run_id: runId(), status: statusOf(state), result_urls: urls(state) };
      for (const key of ['model_name', 'model_id', 'media_type', 'kind', 'prompt', 'resolution', 'aspect_ratio', 'duration']) {
        const value = state[key] ?? state.meta?.[key];
        if (typeof value === 'string' || typeof value === 'number') result[key] = value;
      }
      if (Array.isArray(state.batch)) {
        result.batch = state.batch.slice(0, 50).map((item) => ({ run_id: text(item.run_id), status: statusOf(item), result_url: urls(item)[0] || null, media_type: text(item.media_type), model_name: text(item.model_name) }));
      }
      const snapshot = { version: 1, result, selectedAudioIndex, ...(myRating && ratedRun === runId() ? { rating: myRating, ratingSent } : {}) };
      const encoded = JSON.stringify(snapshot);
      if (encoded === savedSnapshot) return;
      savedSnapshot = encoded;
      try {
        window.openai.setWidgetState({ privateContent: { hansoraGeneration: snapshot } });
      } catch { savedSnapshot = ''; /* Refresh still works without widget persistence. */ }
    }
    function restoreResult(widgetState) {
      const snapshot = widgetState?.privateContent?.hansoraGeneration;
      if (snapshot?.version !== 1 || !generationId(snapshot.result)) return;
      if (runId() && runId() !== generationId(snapshot.result)) return;
      if (runId() && statusOf(state) !== 'processing') return;
      render(snapshot.result);
      if (snapshot.rating === 1 || snapshot.rating === -1) { myRating = snapshot.rating; ratingSent = Boolean(snapshot.ratingSent); showRating(); }
      selectedAudioIndex = Math.min(Math.max(0, Math.floor(Number(snapshot.selectedAudioIndex) || 0)), Math.max(0, urls(state).length - 1));
      if (selectedAudioIndex) render({});
    }
    function receiveResult(result) {
      const value = resultData(result);
      if (value.isError) { showUnavailable('The chat could not load this result. Check again or open your Hansora history.'); return; }
      if (generationId(value) || isUpload(value) || urls(value).length) render(value);
    }
    function syncGlobals(globals = window.openai || {}) {
      // Restore first so replaying the original queued response cannot erase a result.
      applyTheme(globals.theme);
      restoreResult(globals.widgetState);
      const input = globals.toolInput;
      // Creation arguments can contain reference URLs; they are not result files.
      if (generationId(input)) render(input);
      if (globals.toolResponseMetadata) receiveResult(globals.toolResponseMetadata);
      if (globals.toolOutput) receiveResult(globals.toolOutput);
    }
    function showUnavailable(message, title = 'Result status unavailable') {
      stopPolling();
      if (urls(state).length) {
        refreshUnavailable = true;
        el('actionStatus').classList.remove('hidden');
        el('actionStatus').textContent = 'Showing your saved result. The latest status could not be refreshed.';
        reportSize(); return;
      }
      el('model').textContent = modelName(state);
      el('badge').className = 'badge'; el('badge').textContent = 'Check status';
      el('statusTitle').textContent = title;
      el('statusText').textContent = message;
      el('statusActions').classList.remove('hidden');
      show('unavailable');
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
        el('multi' + name + 'Count').textContent = count ? count + ' of up to ' + limit.max_files + ' selected' : 'Up to ' + limit.max_files + ' ' + labels[kind] + (limit.max_files === 1 ? '' : 's') + ' · ' + limit.max_mb + ' MB each';
        el('multi' + name + 'Button').classList.toggle('done', count > 0);
      });
      const fileList = el('multiFiles'); fileList.replaceChildren();
      required.forEach((kind) => multiFiles[kind].forEach((file) => {
        const row = document.createElement('div');
        row.textContent = text(file.name, kind) + ' · ' + formatBytes(file.size);
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
      chips(el('multiMeta'), [state.duration ? text(state.duration) + 's' : '', state.resolution, state.aspect_ratio, costText()]);
      el('multiPrompt').textContent = promptOf(state);
      el('badge').classList.add('hidden');
      if (!uploadBusy) el('multiGenerate').textContent = generateLabel();
      updateMultiSelection();
    }
    function renderUploadMeta() {
      chips(el('uploadMeta'), [state.audio_duration_seconds ? Math.ceil(Number(state.audio_duration_seconds)) + 's' : '', state.duration ? text(state.duration) + 's' : '', state.resolution, state.aspect_ratio, costText()]);
      if (!uploadBusy) el('generate').textContent = generateLabel();
    }
    function renderUpload() {
      stopPolling(); show('upload');
      const video = state.mode === 'video_upload';
      const audio = state.mode === 'audio_upload';
      el('model').textContent = modelName(state);
      const imageModel = !audio && !video && text(state.media_type).toLowerCase() === 'image';
      el('badge').className = 'badge hidden';
      el('uploadTitle').textContent = audio ? 'Add your audio' : video ? 'Add your video' : imageModel ? 'Add your image' : 'Animate your image';
      el('uploadPrompt').textContent = promptOf(state);
      renderUploadMeta();
      el('uploadDetails').textContent = audio
        ? modelName(state) + ' will process this audio. The price depends on its length.'
        : video
        ? modelName(state) + ' will use this as the source video.'
        : imageModel
        ? modelName(state) + ' will use this image as its reference.'
        : 'This image becomes the first frame of your ' + modelName(state) + ' video.';
      const zone = el('dropzone');
      if (!selectedFile) {
        zone.replaceChildren(); zone.classList.toggle('has-file', false);
        const icon = document.createElement('span'); icon.className = 'upload-icon'; icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>';
        zone.appendChild(icon);
        const copy = document.createElement('span'); copy.className = 'upload-copy';
        const strong = document.createElement('strong'); strong.textContent = audio ? 'Drop audio here' : video ? 'Drop video here' : 'Drop image here';
        const hint = document.createElement('span'); hint.textContent = audio ? 'or click to browse · MP3, WAV, M4A · up to 200 MB' : video ? 'or click to browse · MP4, MOV, WebM · up to 200 MB' : 'or click to browse · JPG, PNG, WebP, HEIC · up to 25 MB';
        copy.appendChild(strong); copy.appendChild(hint); zone.appendChild(copy);
      }
      el('fileInput').accept = audio ? 'audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg,audio/flac,.mp3,.wav,.m4a,.aac,.ogg,.flac' : video ? 'video/mp4,video/quicktime,video/webm' : 'image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif';
      el('changeImage').textContent = 'Choose another';
      el('changeImage').classList.toggle('hidden', !selectedFile);
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
    // Henshin is priced by the source video's length: read it from the chosen file, then quote.
    async function finishVideoSelection(preview, file) {
      const seconds = Number(preview.duration || 0);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        el('uploadStatus').textContent = 'Hansora could not read this video. Please choose another MP4, MOV, or WebM file.';
        return;
      }
      const min = Number(state.min_video_seconds) || 0;
      const max = Number(state.max_video_seconds) || 0;
      if ((min && seconds < min) || (max && seconds > max)) {
        el('uploadStatus').textContent = 'This video is ' + Math.round(seconds) + 's. Please choose a video from ' + (min || 1) + ' to ' + (max || 30) + ' seconds.';
        return;
      }
      state.duration = Math.ceil(seconds);
      el('uploadStatus').textContent = 'Calculating the credit quote…';
      try {
        const args = { model_id: state.model_id, duration: state.duration, quantity: 1 };
        if (state.resolution) args.resolution = state.resolution;
        const result = await request('tools/call', { name: 'quote_generation', arguments: args });
        if (result?.isError) throw new Error('quote_failed');
        state.quote = resultData(result);
        if (state.quote?.credits == null && state.quote?.displayedCredits == null) throw new Error('quote_failed');
        renderUploadMeta();
        el('generate').disabled = false;
        el('uploadStatus').textContent = text(file.name, 'Video') + ' · ' + formatBytes(file.size) + ' · ' + state.duration + 's. Ready to upload and generate.';
      } catch {
        state.quote = null;
        renderUploadMeta();
        el('uploadStatus').textContent = 'Could not calculate the video price. Please try again or choose another video.';
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
      const priceByLength = video && state.price_by_video_length;
      el('changeImage').disabled = false; el('changeImage').classList.remove('hidden'); el('generate').disabled = audio || priceByLength;
      if (priceByLength) {
        state.quote = null; state.duration = null;
        renderUploadMeta();
        el('uploadStatus').textContent = 'Reading video length…';
        preview.addEventListener('loadedmetadata', () => finishVideoSelection(preview, file), { once: true });
        preview.addEventListener('error', () => { el('uploadStatus').textContent = 'Hansora could not read this video. Please choose another MP4, MOV, or WebM file.'; }, { once: true });
      } else if (audio) {
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
        if (createdResult?.isError) throw creditError(createdResult);
        const created = resultData(createdResult);
        if (!created.run_id) throw new Error(created.error || created.message || 'generation_not_started');
        state = { ...state, mode: '', status: 'processing' };
        render({ ...created, mode: '' });
      } catch (error) {
        el('uploadStatus').textContent = error?.credits ? creditText(error.credits) : error?.message === 'upload_timeout' ? 'The upload timed out. Please try again.' : 'Could not upload or start the generation. Please try again.';
        generate.disabled = false; change.disabled = false;
      } finally {
        uploadBusy = false; generate.classList.toggle('busy', false); generate.textContent = generateLabel(); reportSize();
      }
    }
    function creditError(result) {
      const value = result?.structuredContent;
      const error = new Error(result?.content?.[0]?.text || 'generation_failed');
      if (value?.error === 'insufficient_credits') error.credits = value;
      return error;
    }
    function creditText(value) {
      return 'Not enough credits: this needs ' + text(value.credits_required) + ' credits and your balance is ' + text(value.credits_available) + '. Nothing was charged.';
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
        if (createdResult?.isError) throw creditError(createdResult);
        const created = resultData(createdResult);
        if (!created.run_id) throw new Error(created.error || created.message || 'generation_not_started');
        state = { ...state, mode: '', status: 'processing' };
        render({ ...created, mode: '' });
      } catch (error) {
        el('multiStatus').textContent = error?.credits ? creditText(error.credits) : error?.message === 'upload_timeout' ? 'An upload timed out. Please try again.' : 'Could not upload the media or start the generation. Please try again.';
        button.disabled = false;
      } finally {
        uploadBusy = false; button.classList.toggle('busy', false); button.textContent = generateLabel(); updateMultiSelection();
      }
    }
    async function initializeApp() {
      syncGlobals();
      try {
        await request('ui/initialize', {
          protocolVersion: '2026-01-26',
          appInfo: { name: 'Hansora Generation', version: '1.0.0' },
          appCapabilities: { availableDisplayModes: ['inline'] }
        });
      } catch {
        if (typeof window.openai?.callTool !== 'function') {
          showUnavailable('This card could not connect to the chat. Reconnect Hansora or open your Hansora history.');
          return;
        }
      }
      // A native compatibility bridge is also usable after the standard bridge
      // times out. In either case acknowledge readiness before fetching status.
      window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
      initialized = true;
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(reportSize).observe(document.querySelector('.card'));
      if (typeof IntersectionObserver !== 'undefined') {
        new IntersectionObserver((entries) => {
          const visible = entries.some((entry) => entry.isIntersecting);
          const returning = visible && !inView;
          inView = visible;
          if (returning) refreshCurrent();
        }).observe(document.querySelector('.card'));
      }
      window.addEventListener('resize', reportSize);
      document.addEventListener('load', reportSize, true);
      document.addEventListener('loadedmetadata', reportSize, true);
      reportSize();
      syncGlobals();
      if (runId()) refreshCurrent();
      else if (!isUpload(state) && !urls(state).length) {
        waitingTimer = window.setTimeout(() => {
          if (!runId() && !isUpload(state)) showUnavailable('This card is missing its generation reference. Open your Hansora history to find the result.');
        }, 15000);
      }
    }
    function render(value) {
      if (!value || typeof value !== 'object') return;
      const oldId = runId();
      const nextId = generationId(value);
      if (oldId && !nextId && isUpload(value)) return;
      if (nextId && nextId !== oldId) {
        stopPolling(); pollStartedAt = 0; pollFailures = 0; lastPollAt = 0;
        selectedAudioIndex = 0;
        state = {};
      } else if (oldId && (value.status || value.meta?.status || isUpload(value)) && statusOf(state) !== 'processing' && statusOf(value) === 'processing') {
        // Host output is the original submission snapshot, not the current job.
        return;
      }
      state = { ...state, ...value, meta: { ...(state.meta || {}), ...(value.meta || {}) } };
      if (nextId) { state.mode = ''; window.clearTimeout(waitingTimer); }
      // A terminal failure from the server must not retain a previous preview URL.
      if (value.status === 'failed') {
        for (const key of ['result_url', 'url', 'video_url', 'image_url', 'audio_url', 'audio_urls', 'result_urls']) { delete state[key]; delete state.meta[key]; }
        delete state.meta.urls;
      }
      persistResult();
      if (state.mode === 'multi_upload') { renderMultiUpload(); return; }
      if (state.mode === 'image_upload' || state.mode === 'video_upload' || state.mode === 'audio_upload') { renderUpload(); return; }
      if (Array.isArray(state.batch) && state.batch.filter(generationId).length > 1) { renderBatch(); return; }
      el('model').textContent = modelName(state);
      const status = statusOf(state);
      el('badge').className = 'badge' + (status === 'ready' ? ' ready' : status === 'failed' ? ' failed' : '');
      el('badge').textContent = status === 'ready' ? 'Ready' : status === 'failed' ? 'Failed' : 'Generating';
      if (status === 'ready') {
        stopPolling();
        const resultUrl = urls(state)[selectedAudioIndex] || urls(state)[0];
        if (!resultUrl) { showUnavailable('Hansora reports this generation as complete, but no result file was returned. Check again or open your Hansora history.', 'Result file unavailable'); return; }
        show('ready');
        const kind = mediaType(state, resultUrl);
        const mediaKey = JSON.stringify([runId(), kind, resultUrl, urls(state), selectedAudioIndex]);
        // Refreshes and host state echoes must not interrupt audio/video playback.
        if (mediaKey !== renderedMediaKey) {
          renderedMediaKey = mediaKey;
          const media = el('media'); media.replaceChildren();
          const versions = el('audioVersions'); versions.replaceChildren();
          const audioUrls = kind === 'audio' ? urls(state) : [];
          versions.classList.toggle('hidden', audioUrls.length < 2);
          audioUrls.forEach((url, index) => {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'button';
            button.textContent = 'Version ' + (index + 1);
            button.setAttribute('aria-pressed', String(index === selectedAudioIndex));
            button.addEventListener('click', () => { selectedAudioIndex = index; render({}); });
            versions.appendChild(button);
          });
          let node;
          if (kind === 'video') { node = document.createElement('video'); node.controls = true; node.playsInline = true; node.preload = 'metadata'; }
          else if (kind === 'audio') {
            node = document.createElement('audio'); node.controls = true; node.preload = 'metadata';
            node.setAttribute('aria-label', audioUrls.length > 1 ? 'Song version ' + (selectedAudioIndex + 1) : 'Generated audio');
          }
          else { node = document.createElement('img'); node.alt = 'Hansora AI generated image'; node.loading = 'eager'; }
          node.addEventListener('error', () => {
            const status = el('actionStatus'); status.classList.remove('hidden');
            status.textContent = 'The ' + kind + ' preview could not load. Try Open full size or find the result in Hansora history.';
            reportSize();
          });
          const source = new URL(resultUrl);
          // ChatGPT permits media from our published origins. The existing cache
          // downloads provider audio server-side and redirects to our own storage.
          node.src = kind === 'audio' && !['https://hansora.co', 'https://qmaealblegvcwodlmeht.supabase.co'].includes(source.origin)
            ? 'https://hansora.co/.netlify/functions/audio-download?preview=1&url=' + encodeURIComponent(resultUrl)
            : resultUrl;
          media.appendChild(node);
          el('actionStatus').classList.add('hidden');
        }

        resetRating(runId());
        el('readyDetails').textContent = [modelName(state), kind.charAt(0).toUpperCase() + kind.slice(1)].filter(Boolean).join(' · ');
        el('readyPrompt').textContent = promptOf(state);
        return;
      }
      if (status === 'failed') {
        stopPolling(); show('failed');
        // The server explains the failure (temporary model issue, refused content, unusable file)
        // and whether credits were refunded; older results fall back to the generic text.
        el('failedTitle').textContent = text(state.failure_title, 'Generation failed');
        el('errorText').textContent = text(state.card_message || state.message, publicFailureMessage);
        return;
      }
      show('processing');
      const kind = mediaType(state, '');
      el('processingTitle').textContent = kind === 'video' ? 'Creating your video' : kind === 'audio' ? 'Creating your audio' : 'Creating your image';
      el('processingText').textContent = kind === 'video' ? 'Videos usually take a few minutes. This card updates automatically.' : 'This card updates automatically when it is ready.';
      el('placeholder').classList.toggle('hidden', kind === 'audio');
      el('placeholder').style.aspectRatio = ratioOf(state) || (kind === 'video' ? '16/9' : '1/1');
      setMeta(el('processingMeta'), state);
      el('processingPrompt').textContent = promptOf(state);
      startPolling();
    }
    function isStorageUrl(url) {
      return url.hostname === 'qmaealblegvcwodlmeht.supabase.co' && url.pathname.startsWith('/storage/v1/object/');
    }
    function downloadLink(value) {
      try {
        const url = new URL(value);
        if (isStorageUrl(url)) url.searchParams.set('download', '');
        return url.href;
      } catch { return value; }
    }
    // 👍 / 👎 under a finished result. The card has no user session: the database accepts a rating only
    // for an existing ChatGPT run and copies the account, model and prompt from that run itself.
    const RATING_URL = 'https://qmaealblegvcwodlmeht.supabase.co/rest/v1/rpc/rate_generation';
    const RATING_KEY = '${SUPABASE_ANON_KEY}';
    function showRating() {
      el('rateUp').setAttribute('aria-pressed', myRating === 1 ? 'true' : 'false');
      el('rateDown').setAttribute('aria-pressed', myRating === -1 ? 'true' : 'false');
      el('rateMore').classList.toggle('hidden', myRating !== -1 || ratingSent);
      el('rateLabel').textContent = ratingSent || myRating === 1 ? 'Thanks for your feedback!' : myRating === -1 ? 'Sorry about that.' : 'Like it?';
      reportSize();
    }
    function resetRating(id) {
      if (ratedRun === id) return;
      ratedRun = id; myRating = 0; ratingSent = false;
      for (const chip of el('rateReasons').children) chip.setAttribute('aria-pressed', 'false');
      el('rateComment').value = '';
      showRating();
    }
    async function rate(value, withDetails = false) {
      const id = runId();
      if (!id) return;
      myRating = value;
      ratingSent = value === 1 || withDetails;
      showRating();
      const reasons = withDetails ? [...el('rateReasons').children].filter((chip) => chip.getAttribute('aria-pressed') === 'true').map((chip) => chip.textContent) : [];
      const comment = withDetails ? String(el('rateComment').value || '').trim().slice(0, 300) : '';
      try {
        await fetch(RATING_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: RATING_KEY, Authorization: 'Bearer ' + RATING_KEY },
          body: JSON.stringify({ p_run_id: id, p_rating: value, p_reasons: reasons, p_comment: comment || null })
        });
      } catch { /* A lost rating is not worth interrupting the user. */ }
      persistResult();
    }
    async function openLink(url, statusId) {
      try {
        const response = await request('ui/open-link', { url });
        if (response?.isError) throw new Error('open_failed');
      } catch {
        const status = el(statusId); status.classList.remove('hidden');
        status.textContent = 'Could not open this result. Please try again.';
        reportSize();
      }
    }
    // ChatGPT shows one card per answer, so several generations started together appear here as a gallery.
    function renderBatch() {
      const items = state.batch.filter(generationId);
      const counts = { ready: 0, processing: 0, failed: 0 };
      items.forEach((item) => { counts[statusOf(item)] += 1; });
      const pending = counts.processing > 0;
      show('batch');
      const names = [...new Set(items.map(modelName).filter((name) => name !== 'AI generation'))];
      el('model').textContent = names.length ? names.join(', ') : modelName(state);
      el('badge').className = 'badge' + (pending ? '' : counts.ready ? ' ready' : ' failed');
      el('badge').textContent = pending ? 'Generating' : counts.ready ? 'Ready' : 'Failed';
      const kinds = [...new Set(items.map((item) => mediaType(item, urls(item)[0] || '')))];
      const noun = kinds.length === 1 ? kinds[0] : 'result';
      el('batchTitle').textContent = items.length + ' ' + (noun === 'audio' ? 'audio files' : noun + 's');
      el('batchText').textContent = [counts.ready + ' ready', counts.processing ? counts.processing + ' generating' : '', counts.failed ? counts.failed + ' failed' : ''].filter(Boolean).join(' · ')
        + (pending ? ' · updates automatically' : ' · tap a result to open it, or ↓ to download');
      const key = JSON.stringify(items.map((item) => [generationId(item), statusOf(item), urls(item)[0] || '']));
      if (key !== renderedBatchKey) {
        renderedBatchKey = key;
        const gallery = el('gallery'); gallery.replaceChildren();
        items.forEach((item, index) => {
          const status = statusOf(item);
          const url = urls(item)[0] || '';
          const tile = document.createElement('div');
          tile.className = 'tile ' + status;
          if (status === 'ready') {
            const open = document.createElement('button');
            open.type = 'button'; open.className = 'tile-open';
            open.setAttribute('aria-label', 'Open result ' + (index + 1));
            const kind = mediaType(item, url);
            let node;
            if (kind === 'video') { node = document.createElement('video'); node.muted = true; node.playsInline = true; node.preload = 'metadata'; node.src = url; }
            else if (kind === 'audio') { node = document.createElement('span'); node.textContent = 'Audio'; }
            else { node = document.createElement('img'); node.alt = 'Result ' + (index + 1); node.loading = 'lazy'; node.src = url; }
            open.appendChild(node);
            open.addEventListener('click', () => openLink(url, 'batchStatus'));
            const download = document.createElement('button');
            download.type = 'button'; download.className = 'tile-dl'; download.textContent = '↓';
            download.setAttribute('aria-label', 'Download result ' + (index + 1));
            download.addEventListener('click', () => openLink(downloadLink(url), 'batchStatus'));
            tile.appendChild(open); tile.appendChild(download);
          } else if (status === 'failed') {
            tile.textContent = 'Failed';
          } else {
            const spinner = document.createElement('span'); spinner.className = 'spinner'; spinner.setAttribute('aria-label', 'Generating');
            tile.appendChild(spinner);
          }
          const number = document.createElement('span'); number.className = 'tile-index'; number.textContent = String(index + 1);
          tile.appendChild(number);
          gallery.appendChild(tile);
        });
      }
      if (pending) startPolling(); else stopPolling();
      reportSize();
    }
    function runId() { return generationId(state); }
    async function poll(force = false) {
      if (!initialized || pollBusy || document.hidden || !inView) return;
      const id = runId(); if (!id) return;
      if (!force && Date.now() - lastPollAt < 2000) return;
      lastPollAt = Date.now();
      pollBusy = true;
      el('refresh').disabled = true; el('refresh').textContent = 'Checking…';
      try {
        const result = await request('tools/call', { name: 'get_generation', arguments: { run_id: id } });
        if (runId() !== id) return;
        const next = resultData(result);
        // Hansora's database is briefly slow: keep checking quietly instead of reporting a failure.
        if (next.busy && !urls(state).length) {
          pollFailures = 0;
          el('processingText').textContent = 'Hansora is busy for a moment. Still checking…';
          return;
        }
        if (next.isError || !generationId(next) || generationId(next) !== id) throw new Error('status_unavailable');
        pollFailures = 0;
        render(next);
        if (refreshUnavailable && urls(state).length) {
          refreshUnavailable = false;
          el('actionStatus').classList.add('hidden');
        }
      } catch {
        if (runId() !== id) return;
        pollFailures += 1;
        if (urls(state).length || pollFailures >= 3 || !pollTimer) {
          showUnavailable('The chat could not refresh this generation. Check again or open your Hansora history. This does not mean the generation failed.');
        } else {
          el('processingText').textContent = 'The status connection was interrupted. Retrying…';
        }
      }
      finally { pollBusy = false; el('refresh').disabled = false; el('refresh').textContent = 'Check again'; }
      if (Date.now() - pollStartedAt > 15 * 60 * 1000 && statusOf(state) === 'processing') {
        showUnavailable('Hansora has not reported a finished result yet. Check again or open your Hansora history. Checking again will not start a new generation.', 'Still waiting for a result');
      }
    }
    function startPolling() {
      if (!initialized || pollTimer || !runId()) return;
      pollStartedAt = pollStartedAt || Date.now();
      pollTimer = window.setInterval(() => poll(), 6000);
    }
    function stopPolling() { if (pollTimer) window.clearInterval(pollTimer); pollTimer = 0; }
    function refreshCurrent(force = false) {
      if (!initialized) return;
      syncGlobals();
      if (!runId() || isUpload(state)) return;
      if (force) { pollStartedAt = 0; pollFailures = 0; }
      if (statusOf(state) === 'processing') startPolling();
      poll(force);
    }

    window.addEventListener('message', (event) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.jsonrpc !== '2.0') return;
      if (message.id !== undefined && pending.has(message.id)) {
        const item = pending.get(message.id); pending.delete(message.id);
        window.clearTimeout(item.timer);
        if (message.error) item.reject(message.error); else item.resolve(message.result);
        return;
      }
      if (message.method === 'ui/notifications/tool-input' && message.params && typeof message.params === 'object') {
        const input = message.params.arguments || message.params;
        if (generationId(input)) { render(input); refreshCurrent(); }
      }
      if (message.method === 'ui/notifications/tool-result') { receiveResult(message.params); refreshCurrent(); }
    }, { passive: true });
    window.addEventListener('openai:set_globals', (event) => { syncGlobals(event.detail?.globals); refreshCurrent(); }, { passive: true });
    window.addEventListener('focus', () => refreshCurrent());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCurrent(); });
    el('download').addEventListener('click', () => openResult(true));
    el('rateUp').addEventListener('click', () => rate(1));
    el('rateDown').addEventListener('click', () => rate(-1));
    el('rateSend').addEventListener('click', () => rate(-1, true));
    for (const chip of el('rateReasons').children) {
      chip.addEventListener('click', () => chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'));
    }
    el('open').addEventListener('click', () => openResult(false));
    el('retry').addEventListener('click', () => refreshCurrent(true));
    el('refresh').addEventListener('click', () => refreshCurrent(true));
    el('history').addEventListener('click', () => request('ui/open-link', { url: 'https://hansora.co/usage.html' }).catch(() => {
      el('statusText').textContent = 'Open hansora.co/usage.html in your browser to find your saved generations.';
    }));
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
