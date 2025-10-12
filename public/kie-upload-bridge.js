// public/js/kie-upload-bridge.js
// Robust client uploader that relies on /.netlify/functions/sign-upload.
// - PUTs file with only Content-Type header
// - Treats 2xx as success
// - Treats 409 as success if publicUrl exists (object already uploaded)
// - Exposes window.kieUploadBridge.upload(file, opts?) -> { publicUrl, uploadUrl, objectPath, bucket }
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
    const hdr = {
      projectHost: res.headers.get('x-project-host') || '',
      bucket: res.headers.get('x-bucket') || '',
      objectPath: res.headers.get('x-object') || '',
      handler: res.headers.get('x-handler-version') || ''
    };
    if (!res.ok) {
      const err = new Error((data && data.error) || 'sign_failed');
      err.body = data;
      err.headers = hdr;
      throw err;
    }
    const uploadUrl = data.uploadUrl;
    const publicUrl = data.publicUrl;
    if (!uploadUrl) {
      const err = new Error('sign_missing_url');
      err.body = data;
      err.headers = hdr;
      throw err;
    }
    return { uploadUrl, publicUrl, objectPath: data.objectPath || hdr.objectPath, bucket: data.bucket || hdr.bucket };
  }

  async function putUpload(uploadUrl, file, onProgress) {
    if (typeof onProgress === 'function') {
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl, true);
        xhr.setRequestHeader('Content-Type', (file.type || 'application/octet-stream'));
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress({ loaded: e.loaded, total: e.total });
        };
        xhr.onload = () => {
          // 2xx => success; 409 => already exists (treat as success)
          if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 409) resolve();
          else reject(new Error('upload_failed_' + xhr.status));
        };
        xhr.onerror = () => reject(new Error('upload_network_error'));
        xhr.send(file);
      });
      return;
    }

    // No progress
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': (file.type || 'application/octet-stream') },
      body: file
    });
    if (!res.ok && res.status !== 409) {
      const t = await res.text().catch(() => '');
      const err = new Error('upload_failed_' + res.status);
      err.detail = t;
      throw err;
    }
  }

  /**
   * Upload a File/Blob to Supabase via signed URL and return the public URL.
   * @param {File|Blob} file
   * @param {{ bucket?: string, onProgress?: (e:{loaded:number,total:number})=>void }} opts
   */
  async function upload(file, opts) {
    if (!file) throw new Error('no_file');
    const name = (file.name || 'upload.bin').replace(/[^A-Za-z0-9._-]/g, '_');
    const type = (file.type || '').toLowerCase();
    const bucket = (opts && opts.bucket) || 'video';

    const { uploadUrl, publicUrl, objectPath, bucket: outBucket } = await sign(name, type, bucket);
    await putUpload(uploadUrl, file, opts && opts.onProgress);

    // Ensure a URL to return
    const dl = publicUrl || uploadUrl;
    return { publicUrl: dl, uploadUrl, objectPath, bucket: outBucket || bucket };
  }

  const api = { upload };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.kieUploadBridge = api;
})(typeof window !== 'undefined' ? window : (globalThis || {}));
