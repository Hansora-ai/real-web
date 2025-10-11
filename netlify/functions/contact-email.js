// /.netlify/functions/contact-email.js
// CommonJS Netlify Function (v1) — no ESM, no SDK. Calls Resend via REST to avoid bundling issues.

/** @typedef {{ statusCode:number, headers?:Record<string,string>, body:string }} LambdaResponse */

/** @param {any} body @param {number} [status=200] @returns {LambdaResponse} */
function json(body, status) {
  return {
    statusCode: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  };
}

/** @param {string} s */
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

exports.handler = async function handler(event, context) {
  if (event.httpMethod !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let email, message;
  try {
    const body = JSON.parse(event.body || '{}');
    email = body.email;
    message = body.message;
  } catch (e) {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!email || !message) {
    return json({ error: 'Missing email or message' }, 400);
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL;
  const CONTACT_FROM_EMAIL = process.env.CONTACT_FROM_EMAIL || 'HANSORA AI <onboarding@resend.dev>';

  if (!RESEND_API_KEY) return json({ error: 'RESEND_API_KEY not set' }, 500);
  if (!CONTACT_TO_EMAIL) return json({ error: 'CONTACT_TO_EMAIL not set' }, 500);

  const html = `
    <div style="font-family:Inter,system-ui,Arial,sans-serif;color:#111">
      <h2>New contact message</h2>
      <p><strong>From:</strong> ${esc(email)}</p>
      <p><strong>Message:</strong></p>
      <pre style="white-space:pre-wrap;background:#f6f6f8;padding:12px;border-radius:8px">${esc(message)}</pre>
    </div>
  `;

  // Use native fetch to Resend REST API to avoid SDK/module issues
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: CONTACT_FROM_EMAIL,
        to: CONTACT_TO_EMAIL,
        subject: 'Contact form message',
        html,
        reply_to: email
      })
    });

    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!resp.ok) {
      // Surface Resend error back to frontend
      return json({ error: 'Resend API error', status: resp.status, data }, 502);
    }

    return json({ ok: true, data }, 200);
  } catch (e) {
    return json({ error: String(e) }, 502);
  }
};
