// public/kie-upload-bridge.js
(() => {
  const ORIG_FETCH = window.fetch.bind(window);

  function normalizeMime(m) {
    if (!m) return '';
    const s = m.toLowerCase();
    if (s === 'image/jpg' || s === 'image/pjpeg') return 'image/jpeg';
    if (s === 'image/x-png') return 'image/png';
    return s;
  }

  async function fdToFiles(fd) {
    const files = [];
    for (const [k, v] of fd.entries()) {
      if (v instanceof File) files.push(v);
      else if (typeof v === 'string' && v.startsWith('data:image/')) {
        const [head, b64] = v.split(',', 2);
        const mime = (head.match(/^data:([^;]+);base64$/i) || [,'application/octet-stream'])[1];
        const buf = Uint8Array.from(atob(b64), c=>c.charCodeAt(0));
        files.push(new File([buf], (k || 'image') + '.' + (mime.split('/')[1] || 'bin'), { type: mime }));
      }
    }
    return files;
  }

  async function signAndPut(file) {
    const signRes = await ORIG_FETCH('/.netlify/functions/sign-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, mime: normalizeMime(file.type) }),
    });
    if (!signRes.ok) {
      const txt = await signRes.text().catch(()=> '');
      throw new Error('sign_failed ' + signRes.status + (txt ? (': ' + txt) : ''));
    }
    const { uploadUrl, publicUrl } = await signRes.json();

    const putRes = await ORIG_FETCH(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': normalizeMime(file.type) || 'application/octet-stream' },
      body: file,
    });
    if (!putRes.ok) {
      const txt = await putRes.text().catch(()=> '');
      throw new Error('put_failed ' + putRes.status + (txt ? (': ' + txt) : ''));
    }
    return publicUrl;
  }

  window.fetch = async (input, init = {}) => {
    try {
      const url = (typeof input === 'string') ? input : (input && input.url) || '';
      const method = (init && init.method) || (typeof input !== 'string' && input && input.method) || 'GET';

      // Intercept ONLY the known upload call
      if (url.endsWith('/.netlify/functions/kie-upload') &&
          method.toUpperCase() === 'POST' &&
          init && init.body instanceof FormData) {

        const fd = init.body;
        const files = await fdToFiles(fd);
        if (!files.length) {
          return new Response(JSON.stringify({ error: 'no_file', detail: 'No files in FormData' }), {
            status: 400, headers: { 'Content-Type': 'application/json' }
          });
        }

        const urls = [];
        for (const f of files) {
          const u = await signAndPut(f);
          urls.push(u);
        }
        const body = JSON.stringify({ downloadUrl: urls[0], urls });
        return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' }});
      }

      // Passthrough for everything else
      return ORIG_FETCH(input, init);
    } catch (e) {
      return new Response(JSON.stringify({ error: 'bridge_error', detail: String(e && e.message ? e.message : e) }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }
  };
})();
