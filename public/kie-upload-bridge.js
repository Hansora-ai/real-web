
// public/js/kie-upload-bridge.js (override-safe, surgical)
(function (global) {
  'use strict';

  const ENDPOINT = '/.netlify/functions/sign-upload';

  // Hard timeouts to prevent rare Safari hangs (no UI changes; just bounded async).
  const SIGN_TIMEOUT_MS = 20000;   // signing request
  const UPLOAD_TIMEOUT_MS = 120000; // PUT upload
  const HEAD_TIMEOUT_MS = 8000;    // visibility check

  function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    const opts = Object.assign({}, options || {}, { signal: controller.signal });
    return fetch(url, opts).finally(() => clearTimeout(id));
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function isTransientUploadError(err) {
    const msg = (err && err.message) ? String(err.message) : '';
    return msg === 'upload_network_error' || msg === 'upload_timeout' || msg === 'upload_aborted' || msg === 'upload_failed_0';
  }

  function isTransientSignError(err) {
    const msg = (err && err.message) ? String(err.message) : '';
    return msg === 'sign_timeout' || msg === 'sign_network_error';
  }

  function asJSON(res) {
    return res.text().then(t => { try { return JSON.parse(t); } catch { return {}; } });
  }

  async function sign(filename, mime, bucket) {
    let res;
    try {
      res = await fetchWithTimeout(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, mime, bucket })
    }, SIGN_TIMEOUT_MS);
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('sign_timeout');
      throw new Error('sign_network_error');
    }
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

  function xhrPut(uploadUrl, file, onProgress, opts) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl, true);
      xhr.setRequestHeader('Content-Type', (file.type || 'application/octet-stream'));
      xhr.timeout = (opts && typeof opts.timeoutMs === 'number') ? opts.timeoutMs : UPLOAD_TIMEOUT_MS;
      xhr.ontimeout = () => reject(new Error('upload_timeout'));
      xhr.onabort = () => reject(new Error('upload_aborted'));
      if (typeof onProgress === 'function') {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress({ loaded: e.loaded, total: e.total });
        };
      }
      xhr.onload = () => {
        if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 409) resolve({ ok: true, status: xhr.status });
        else if (xhr.status === 0) reject(Object.assign(new Error('upload_failed_0'), { status: 0 }));
        else reject(Object.assign(new Error('upload_failed_' + xhr.status), { status: xhr.status }));
      };
      xhr.onerror = () => reject(Object.assign(new Error('upload_network_error'), { status: 0 }));
      xhr.send(file);
    });
  }
  async function headOk(url) {
    try {
      const res = await fetchWithTimeout(url, { method: 'HEAD', cache: 'no-store' }, HEAD_TIMEOUT_MS);
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

    let signed;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        signed = await sign(name, type, bucket);
        break;
      } catch (e) {
        if (attempt === 0 && isTransientSignError(e)) { await sleep(500); continue; }
        throw e;
      }
    }
    const { uploadUrl, publicUrl, objectPath, bucket: outBucket } = signed;

    try {
      try {
        await xhrPut(uploadUrl, file, opts && opts.onProgress, opts);
      } catch (e) {
        if (isTransientUploadError(e)) {
          await sleep(700);
          await xhrPut(uploadUrl, file, opts && opts.onProgress, opts);
        } else {
          throw e;
        }
      }
    } catch (err) {
      // If we already got a publicUrl, check if the object is already visible;
      // if yes, treat as success so the UI can proceed.
      if (publicUrl) {
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
