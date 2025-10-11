// /.netlify/functions/contact-email.js
// Netlify Functions v1-compatible handler. No frontend changes required.

import { Resend } from 'resend';

/** JSON helper */
function json(body, status = 200) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  };
}

/** Parse request body safely */
function parseBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return {};
  }
}

export async function handler(event, context) {
  if (event.httpMethod !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const { email, message } = parseBody(event);

  if (!email || !message) {
    return json({ error: 'Missing email or message' }, 400);
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL;
  // Optional: allow override of FROM
  const CONTACT_FROM_EMAIL = process.env.CONTACT_FROM_EMAIL || 'HANSORA AI <onboarding@resend.dev>';

  if (!RESEND_API_KEY) {
    return json({ error: 'RESEND_API_KEY not set' }, 500);
  }
  if (!CONTACT_TO_EMAIL) {
    return json({ error: 'CONTACT_TO_EMAIL not set' }, 500);
  }

  const resend = new Resend(RESEND_API_KEY);

  const html = `
    <div style="font-family:Inter,system-ui,Arial,sans-serif;color:#111">
      <h2>New contact message</h2>
      <p><strong>From:</strong> ${email}</p>
      <p><strong>Message:</strong></p>
      <pre style="white-space:pre-wrap;background:#f6f6f8;padding:12px;border-radius:8px">${escapeHtml(message)}</pre>
    </div>
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: CONTACT_FROM_EMAIL,      // must be verified in Resend, otherwise use onboarding@resend.dev
      to: CONTACT_TO_EMAIL,          // can be a string or array
      subject: 'Contact form message',
      html,
      reply_to: email
    });

    if (error) {
      console.error('Resend error:', error);
      return json({ error: String(error) }, 500);
    }

    return json({ ok: true }, 200);
  } catch (e) {
    console.error('Function error:', e);
    return json({ error: String(e) }, 500);
  }
}

/** Minimal HTML escaper for the message body */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
