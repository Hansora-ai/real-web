// /.netlify/functions/contact-email.js
// CommonJS, dependency-free (uses https.request), compatible with older Netlify runtimes without global fetch.

const https = require('https');

/** @param {any} body @param {number} [status=200] */
function json(body, status) {
  return {
    statusCode: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  };
}

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/** POST JSON via https, return a Promise<{status:number, body:string}> */
function postJSON({ hostname, path, headers, data }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'POST', headers },
      res => {
        let chunks = '';
        res.on('data', d => { chunks += d; });
        res.on('end', () => resolve({ status: res.statusCode || 0, body: chunks }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let email, message;
  try {
    const body = JSON.parse(event.body || '{}');
    email = body.email;
    message = body.message;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!email || !message) return json({ error: 'Missing email or message' }, 400);

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL;
  const CONTACT_FROM_EMAIL = process.env.CONTACT_FROM_EMAIL || 'HANSORA AI <onboarding@resend.dev>';
  if (!RESEND_API_KEY) return json({ error: 'RESEND_API_KEY not set' }, 500);
  if (!CONTACT_TO_EMAIL) return json({ error: 'CONTACT_TO_EMAIL not set' }, 500);

  const payload = JSON.stringify({
    from: CONTACT_FROM_EMAIL,
    to: CONTACT_TO_EMAIL,
    subject: 'Contact form message',
    html: `
      <div style="font-family:Inter,system-ui,Arial,sans-serif;color:#111">
        <h2>New contact message</h2>
        <p><strong>From:</strong> ${esc(email)}</p>
        <p><strong>Message:</strong></p>
        <pre style="white-space:pre-wrap;background:#f6f6f8;padding:12px;border-radius:8px">${esc(message)}</pre>
      </div>
    `,
    reply_to: email
  });

  try {
    const resp = await postJSON({
      hostname: 'api.resend.com',
      path: '/emails',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      data: payload
    });

    let parsed;
    try { parsed = JSON.parse(resp.body); } catch { parsed = resp.body; }

    if (resp.status < 200 || resp.status >= 300) {
      // Return 200 to avoid browser 502 banner; surface error in JSON instead.
      return json({ ok: false, provider: 'resend', status: resp.status, error: parsed });
    }

    return json({ ok: true, data: parsed });
  } catch (e) {
    // Return 200 with error payload to avoid generic 502 in browser; frontend can read details if needed.
    return json({ ok: false, error: String(e) });
  }
};
