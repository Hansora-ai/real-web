// /.netlify/functions/contact-email.js
// CommonJS + https, with a diagnostic mode (?diag=1) to echo runtime env usage.

const https = require('https');

function json(body, status) {
  return {
    statusCode: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  };
}
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function postJSON({ hostname, path, headers, data }) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'POST', headers }, res => {
      let chunks = '';
      res.on('data', d => { chunks += d; });
      res.on('end', () => resolve({ status: res.statusCode || 0, body: chunks }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

exports.handler = async function(event) {
  const params = new URLSearchParams(event.queryStringParameters || {});
  const diag = params.get('diag') === '1';

  const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
  const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL || '';
  const CONTACT_FROM_EMAIL = process.env.CONTACT_FROM_EMAIL || '';

  if (diag) {
    return json({
      diag: true,
      from_env: CONTACT_FROM_EMAIL || null,
      to_env: CONTACT_TO_EMAIL || null,
      api_key_present: RESEND_API_KEY ? true : false,
      api_key_prefix: RESEND_API_KEY ? RESEND_API_KEY.slice(0, 6) + '***' : null
    });
  }

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

  const from = CONTACT_FROM_EMAIL || 'onboarding@resend.dev';
  const to = CONTACT_TO_EMAIL;
  if (!RESEND_API_KEY) return json({ error: 'RESEND_API_KEY not set' }, 500);
  if (!to) return json({ error: 'CONTACT_TO_EMAIL not set' }, 500);

  const payload = JSON.stringify({
    from,
    to,
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
      return json({ ok: false, provider: 'resend', status: resp.status, error: parsed, from_used: from, to_used: to });
    }

    return json({ ok: true, data: parsed, from_used: from, to_used: to });
  } catch (e) {
    return json({ ok: false, error: String(e) });
  }
};
