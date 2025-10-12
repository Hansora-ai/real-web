// public/js/kie-upload-bridge.js
// STRICT: only uses `/.netlify/functions/sign-upload`
// Exposes: window.kieUploadBridge.upload(file, opts?) -> { publicUrl, uploadUrl, objectPath, bucket }
(function (global) {
  'use strict';

  const ENDPOINT = '/.netlify/functions/sign-upload';

  function asJSON(res) {
    return res.text().then(t => { try { return JSON.parse(t); } catch { return {}; } });
  }

  async function sign(filename, mime) {
    const res = await fetch(ENDPOINT, {
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
    const uploadUrl = data.uploadUrl || data.signedUrl || data.url;
    if (!uploadUrl) {
      const err = new Error('sign_missing_url');
      err.body = data;
      throw err;
    }
    return { uploadUrl, publicUrl: data.publicUrl, objectPath: data.objectPath, bucket: data.bucket };
  }

  async function putUpload(uploadUrl, file, onProgress) {
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

    const { uploadUrl, publicUrl, objectPath, bucket } = await sign(name, type);
    await putUpload(uploadUrl, file, opts && opts.onProgress);
    return { publicUrl, uploadUrl, objectPath, bucket };
  }

  const api = { upload };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.kieUploadBridge = api;
})(typeof window !== 'undefined' ? window : (globalThis || {}));
