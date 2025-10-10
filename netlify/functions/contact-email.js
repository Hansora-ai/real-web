// /.netlify/functions/contact-email.js
import { Resend } from 'resend';

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { email, message } = await req.json();
    if (!email || !message) {
      return new Response(JSON.stringify({ error: 'Missing email or message' }), { status: 400 });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const to = process.env.CONTACT_TO_EMAIL;
    if (!to) {
      return new Response(JSON.stringify({ error: 'CONTACT_TO_EMAIL not set' }), { status: 500 });
    }

    const html = `
      <div style="font-family:Inter,system-ui,Arial,sans-serif;color:#111">
        <h2>New contact message</h2>
        <p><strong>From:</strong> ${email}</p>
        <p><strong>Message:</strong></p>
        <pre style="white-space:pre-wrap;background:#f6f6f8;padding:12px;border-radius:8px">${message}</pre>
      </div>
    `;

    const { error } = await resend.emails.send({
      from: 'HANSORA AI <no-reply@hansora.mail>',
      to,
      subject: 'Contact form message',
      html,
      reply_to: email
    });

    if (error) {
      return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
};
