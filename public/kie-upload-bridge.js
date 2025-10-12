
// public/js/kie-upload-bridge.js (override-safe, surgical)
(function (global) {
  'use strict';

  const ENDPOINT = '/.netlify/functions/sign-upload';

  function asJSON(res) {
    return res.text().then(t => { try { return JSON.parse(t); } catch { return {}; } });
  }

  async function sign(filename, mime, bucket) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, mime, bucket })
    });
    const data = await asJSON(res);
    if (!res.ok) {
      const err = new Error((data && data.error) || 'sign_failed');
      err.body = data;
      throw err;
    }
    if (!data || !data.uploadUrl) {
      const err = new Error('sign_missing_url');
      err.body = data;
      throw err;
    }
    return { uploadUrl: data.uploadUrl, publicUrl: data.publicUrl, objectPath: data.objectPath, bucket: data.bucket };
  }

  function xhrPut(uploadUrl, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl, true);
      xhr.setRequestHeader('Content-Type', (file.type || 'application/octet-stream'));
      if (typeof onProgress === 'function') {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress({ loaded: e.loaded, total: e.total });
        };
      }
      xhr.onload = () => {
        if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 409) resolve({ ok: true, status: xhr.status });
        else reject(Object.assign(new Error('upload_failed_' + xhr.status), { status: xhr.status }));
      };
      xhr.onerror = () => reject(new Error('upload_network_error'));
      xhr.send(file);
    });
  }

  async function headOk(url) {
    try {
      const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function upload(file, opts) {
    if (!file) throw new Error('no_file');
    const name = (file.name || 'upload.bin').replace(/[^A-Za-z0-9._-]/g, '_');
    const type = (file.type || '').toLowerCase();
    const bucket = (opts && opts.bucket) || 'video';

    const { uploadUrl, publicUrl, objectPath, bucket: outBucket } = await sign(name, type, bucket);

    try {
      await xhrPut(uploadUrl, file, opts && opts.onProgress);
    } catch (err) {
      // If we already got a publicUrl, check if the object is already visible;
      // if yes, treat as success so the UI can proceed.
      if (publicUrl && (err && err.status !== undefined)) {
        const visible = await headOk(publicUrl);
        if (visible) {
          return { publicUrl, uploadUrl, objectPath, bucket: outBucket || bucket };
        }
      }
      throw err;
    }

    return { publicUrl: (publicUrl || uploadUrl), uploadUrl, objectPath, bucket: outBucket || bucket };
  }

  const api = { upload };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.kieUploadBridge = api;
})(typeof window !== 'undefined' ? window : (globalThis || {}));
