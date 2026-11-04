// Tells the Hansora team (not a business owner), e.g. when an owner leaves a WhatsApp/Telegram to get a local number:
// a Telegram message when HANSORA_TEAM_TELEGRAM_BOT_TOKEN and HANSORA_TEAM_TELEGRAM_CHAT_ID are set, and an email
// (same Resend setup as the site's contact form). Never throws.
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

export async function notifyHansoraTeam({ subject, rows = [], replyTo = '', env = process.env, fetchImpl = fetch }) {
  const [telegram, email] = await Promise.all([telegramTeam({ subject, rows, env, fetchImpl }), emailTeam({ subject, rows, replyTo, env, fetchImpl })]);
  return { telegram, email };
}

async function telegramTeam({ subject, rows, env, fetchImpl }) {
  const token = String(env.HANSORA_TEAM_TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(env.HANSORA_TEAM_TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chatId) return { sent: false, reason: 'telegram_not_configured' };
  const text = [`🔔 ${subject}`, '', ...rows.map(([label, value]) => `${label}: ${value}`)].join('\n').slice(0, 4000);
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }) });
    if (!response.ok) { console.error('team telegram failed', { status: response.status }); return { sent: false, reason: `telegram_${response.status}` }; }
    return { sent: true };
  } catch (error) {
    console.error('team telegram failed', { message: error?.message });
    return { sent: false, reason: 'network' };
  }
}

async function emailTeam({ subject, rows, replyTo, env, fetchImpl }) {
  const apiKey = String(env.RESEND_API_KEY || '').trim();
  const to = String(env.HANSORA_TEAM_EMAIL || env.CONTACT_TO_EMAIL || 'contact@hansora.org').trim();
  if (!apiKey || !to) return { sent: false, reason: 'email_not_configured' };
  const from = String(env.AUTOMATION_NOTIFY_FROM_EMAIL || env.CONTACT_FROM_EMAIL || 'onboarding@resend.dev');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;padding:24px;color:#111"><p style="font-size:12px;letter-spacing:1.5px;color:#5b6b82;margin:0 0 8px">HANSORA AUTOMATION</p><h1 style="font-size:20px;margin:0 0 18px">${escape(subject)}</h1><table style="width:100%;border-collapse:collapse;font-size:14px">${rows.map(([label, value]) => `<tr><td style="padding:8px 0;color:#5b6b82;width:140px;vertical-align:top">${escape(label)}</td><td style="padding:8px 0">${escape(value)}</td></tr>`).join('')}</table></div>`;
  try {
    const response = await fetchImpl('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }) });
    if (!response.ok) { console.error('team email failed', { status: response.status }); return { sent: false, reason: `resend_${response.status}` }; }
    return { sent: true };
  } catch (error) {
    console.error('team email failed', { message: error?.message });
    return { sent: false, reason: 'network' };
  }
}
