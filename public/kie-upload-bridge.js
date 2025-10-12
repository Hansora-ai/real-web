// public/js/kie-upload-bridge.js
// Minimal, UI-preserving upload bridge for Supabase direct uploads via signed URL.
// Tries new signer first (`sign-upload`), falls back to legacy (`kie-upload-bridge`) if needed.
// Exposes: window.kieUploadBridge.upload(file, opts?) -> Promise<{publicUrl, uploadUrl, objectPath, bucket}>
//
// NOTE: No UI code here. Drop-in safe. It does not assume frameworks. No syntax changes elsewhere.

(function (global) {
  'use strict';

  const DEFAULT_ENDPOINTS = [
    '/.netlify/functions/sign-upload',        // new signer
    '/.netlify/functions/kie-upload-bridge',  // legacy name (fallback)
  ];

  function asJSON(res) {
    return res.text().then(t => {
      try { return JSON.parse(t); } catch (e) { return {}; }
    });
  }

  async function signRequest(ep, filename, mime) {
    const res = await fetch(ep, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, mime })
    });
    if (!res.ok) {
      const body = await asJSON(res);
      const err = new Error(`sign_failed ${res.status}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    const data = await res.json();
    // accept either `uploadUrl` or `signedUrl`; prefer `uploadUrl`
    const uploadUrl = data.uploadUrl || data.signedUrl || data.url;
    if (!uploadUrl) {
      const err = new Error('sign_missing_url');
      err.body = data;
      throw err;
    }
    return { uploadUrl, publicUrl: data.publicUrl, objectPath: data.objectPath, bucket: data.bucket };
  }

  async function trySign(filename, mime, endpoints) {
    let lastErr = null;
    for (const ep of endpoints) {
      try {
        return await signRequest(ep, filename, mime);
      } catch (e) {
        lastErr = e;
        // Only continue to next endpoint on 404/405/500-ish
        if (!(e && (e.status === 404 || e.status === 405 || e.status === 500 || e.status === 502 || e.status === 503))) {
          throw e;
        }
      }
    }
    if (lastErr) throw lastErr;
    throw new Error('signer_unreachable');
  }

  async function putUpload(uploadUrl, file, onProgress) {
    // Use XHR for progress if provided; otherwise use fetch
    if (typeof onProgress === 'function') {
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl, true);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress({ loaded: e.loaded, total: e.total, pct: (e.loaded / e.total) * 100 });
        };
        xhr.onerror = () => reject(new Error('upload_failed_network'));
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(new Error(`upload_failed ${xhr.status}`));
        };
        xhr.send(file);
      });
    } else {
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file
      });
      if (!res.ok) throw new Error(`upload_failed ${res.status}`);
    }
  }

  async function upload(file, opts) {
    if (!file) throw new Error('no_file');
    const name = (file.name || 'file').replace(/[^\w.\-]+/g, '-');
    const type = (file.type || '').toLowerCase();
    const endpoints = (opts && Array.isArray(opts.endpoints) && opts.endpoints.length ? opts.endpoints : DEFAULT_ENDPOINTS);

    const { uploadUrl, publicUrl, objectPath, bucket } = await trySign(name, type, endpoints);
    await putUpload(uploadUrl, file, opts && opts.onProgress);

    return { publicUrl, uploadUrl, objectPath, bucket };
  }

  // UMD-ish exposure
  const api = { upload };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.kieUploadBridge = api;
  }
})(typeof window !== 'undefined' ? window : (globalThis || {}));
