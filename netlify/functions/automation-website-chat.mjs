// Public endpoint for the website chat bubble (public/chat.js) on businesses' own websites.
// GET  ?key&visitor&after   → the bubble's settings, the visitor's messages since `after`, and whether a reply is coming.
// POST { key, visitor, message, client_id, details?, page? } → saves the visitor's message and starts the AI reply
//      (automation-website-process-background.mjs, same steps as Telegram).
// POST { key, visitor, action: 'details', details } → saves the visitor's name / phone / email from the form.
// Only websites the owner listed can use a key; visitors and network addresses have message limits, and every
// business has a daily total, so nobody can burn a business's credits by spamming its bubble.
import { first, rows, serviceInsert, serviceUpsert, supabaseRequest } from '../../lib/automation/db.mjs';
import { productPhotoUrl } from '../../lib/automation/product-photos.mjs';
import { cleanDetails, clientIp, ipHash, limitBreached, LIMITS, MAX_MESSAGE, missingDetail, originAllowed, publicConfig, validVisitorId, validWidgetKey, visibleMessage, DEFAULT_DAILY_LIMIT } from '../../lib/automation/website.mjs';

const enc = encodeURIComponent;

function headersFor(origin) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '600' } : {})
  };
}

export async function handler(event) {
  const origin = String(event.headers?.origin || event.headers?.Origin || '');
  const reply = (statusCode, body, allowed = false) => ({ statusCode, headers: headersFor(allowed ? origin : ''), body: JSON.stringify(body) });
  // The browser's preflight: allowed for any page; the real request below checks the website.
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: headersFor(origin || '*'), body: '' };
  if (!['GET', 'POST'].includes(event.httpMethod)) return reply(405, { error: 'method_not_allowed' });
  try {
    let body = {};
    if (event.httpMethod === 'POST') {
      if (String(event.body || '').length > 8000) return reply(413, { error: 'too_large' });
      try { body = JSON.parse(event.body || '{}'); } catch (_) { return reply(400, { error: 'invalid_json' }); }
    }
    const query = event.queryStringParameters || {};
    const key = String(body.key || query.key || '');
    const visitor = String(body.visitor || query.visitor || '');
    if (!validWidgetKey(key)) return reply(404, { error: 'unknown_widget' });

    const connection = await first(`/rest/v1/automation_channel_connections?channel_type=eq.website&settings->>widget_key=eq.${enc(key)}&select=*&limit=1`);
    if (!connection) return reply(404, { error: 'unknown_widget' });
    const settings = connection.settings || {};
    const siteHost = (() => { try { return new URL(String(process.env.URL || 'https://hansora.co')).hostname; } catch (_) { return 'hansora.co'; } })();
    if (!originAllowed(origin, settings.allowed_domains, { siteHost })) return reply(403, { error: 'website_not_allowed' });
    const ok = (statusCode, payload) => reply(statusCode, payload, true);
    const live = connection.status === 'connected';

    if (event.httpMethod === 'GET') {
      const [business, agent] = await Promise.all([
        first(`/rest/v1/automation_businesses?id=eq.${connection.business_id}&select=name&limit=1`),
        first(`/rest/v1/automation_agents?business_id=eq.${connection.business_id}&select=primary_language&limit=1`).catch(() => null)
      ]);
      const config = { enabled: live, ...publicConfig(settings, { businessName: business?.name, language: agent?.primary_language }) };
      if (!validVisitorId(visitor)) return ok(200, { config, messages: [], typing: false });
      const contact = await first(`/rest/v1/automation_contacts?business_id=eq.${connection.business_id}&channel_type=eq.website&external_contact_id=eq.${enc(visitor)}&select=id,display_name,primary_phone,primary_email&limit=1`);
      const conversation = contact ? await first(`/rest/v1/automation_conversations?business_id=eq.${connection.business_id}&channel_type=eq.website&external_thread_id=eq.${enc(visitor)}&select=id&limit=1`) : null;
      const details = contact ? { name: contact.display_name && contact.display_name !== 'Website visitor' ? contact.display_name : '', phone: contact.primary_phone || '', email: contact.primary_email || '' } : {};
      if (!conversation) return ok(200, { config, messages: [], typing: false, details_done: !missingDetail(settings, details) && Boolean(contact) });
      const after = Date.parse(String(query.after || ''));
      const filter = Number.isFinite(after) ? `&created_at=gt.${enc(new Date(after).toISOString())}` : '';
      const [messageRows, pending] = await Promise.all([
        supabaseRequest(`/rest/v1/automation_messages?conversation_id=eq.${conversation.id}&content_type=in.(text,image)&status=in.(received,sent)${filter}&select=id,direction,sender_type,content_type,content,metadata,occurred_at,created_at&order=created_at.${filter ? 'asc' : 'desc'}&limit=50`),
        first(`/rest/v1/automation_webhook_events?provider=eq.website&event_type=eq.website_message&status=in.(received,processing)&payload->>conversation_id=eq.${conversation.id}&received_at=gt.${enc(new Date(Date.now() - 180000).toISOString())}&select=id&limit=1`).catch(() => null)
      ]);
      const list = rows(messageRows);
      // Product photos the AI sent: a short-lived link to the picture (uploaded photos are private).
      const messages = (await Promise.all((filter ? list : list.reverse()).map(async row => {
        const message = visibleMessage(row);
        if (row.content_type === 'image') {
          const url = await productPhotoUrl({ url: row.metadata?.product_photo_url, path: row.metadata?.product_photo_path }).catch(() => '');
          if (!url) return null;
          message.image = url; message.text = message.text.replace(/^📷\s*/, '');
        }
        return message;
      }))).filter(message => message && (message.text || message.image));
      const cursor = list.length ? list.reduce((latest, row) => (row.created_at > latest ? row.created_at : latest), '') : null;
      return ok(200, { config, messages, cursor, typing: Boolean(pending), details_done: !missingDetail(settings, details) });
    }

    if (!live) return ok(409, { error: 'chat_offline' });
    if (!validVisitorId(visitor)) return ok(400, { error: 'invalid_visitor' });
    const businessId = connection.business_id;
    const contactQuery = `/rest/v1/automation_contacts?business_id=eq.${businessId}&channel_type=eq.website&external_contact_id=eq.${enc(visitor)}&select=*&limit=1`;
    const known = await first(contactQuery);
    const given = cleanDetails(body.details || {});
    const details = { name: given.name || (known?.display_name !== 'Website visitor' ? known?.display_name || '' : ''), phone: given.phone || known?.primary_phone || '', email: given.email || known?.primary_email || '' };
    const page = String(body.page || '').slice(0, 300);
    const now = new Date().toISOString();
    const saveContact = () => serviceUpsert('automation_contacts', 'business_id,channel_type,external_contact_id', {
      business_id: businessId, channel_type: 'website', external_contact_id: visitor,
      display_name: details.name || known?.display_name || 'Website visitor',
      primary_phone: details.phone || null, primary_email: details.email || null,
      last_seen_at: now,
      profile: { ...(known?.profile || {}), source: 'website', ...(page ? { last_page: page } : {}), ...(origin ? { website: origin } : {}) }
    });

    if (body.action === 'details') {
      const missing = missingDetail(settings, details);
      if (missing) return ok(400, { error: 'details_missing', field: missing });
      await saveContact();
      return ok(200, { ok: true, details_done: true });
    }

    const text = String(body.message || '').replace(/\u0000/g, '').trim();
    if (!text || text.length > MAX_MESSAGE) return ok(400, { error: 'invalid_message' });
    const clientId = /^[A-Za-z0-9_-]{8,64}$/.test(String(body.client_id || '')) ? String(body.client_id) : `${Date.now()}`;
    const missing = missingDetail(settings, details);
    if (missing) return ok(400, { error: 'details_missing', field: missing });

    // Limits: per visitor (a minute and a day), per network address (an hour) and the business's daily total.
    const hash = ipHash(clientIp(event.headers || {}));
    const since = ms => enc(new Date(Date.now() - ms).toISOString());
    const count = async (path, cap) => rows(await supabaseRequest(`${path}&select=id&limit=${cap + 1}`).catch(() => [])).length;
    const conversationRow = known ? await first(`/rest/v1/automation_conversations?business_id=eq.${businessId}&channel_type=eq.website&external_thread_id=eq.${enc(visitor)}&select=id&limit=1`) : null;
    const dailyLimit = Number(settings.daily_limit) || DEFAULT_DAILY_LIMIT;
    const [visitorLastMinute, visitorToday, ipLastHour, businessToday] = await Promise.all([
      conversationRow ? count(`/rest/v1/automation_messages?conversation_id=eq.${conversationRow.id}&direction=eq.inbound&created_at=gt.${since(60000)}`, LIMITS.visitorPerMinute) : 0,
      conversationRow ? count(`/rest/v1/automation_messages?conversation_id=eq.${conversationRow.id}&direction=eq.inbound&created_at=gt.${since(86400000)}`, LIMITS.visitorPerDay) : 0,
      hash ? count(`/rest/v1/automation_messages?business_id=eq.${businessId}&direction=eq.inbound&metadata->>source=eq.website&metadata->>ip_hash=eq.${hash}&created_at=gt.${since(3600000)}`, LIMITS.ipPerHour) : 0,
      count(`/rest/v1/automation_messages?business_id=eq.${businessId}&direction=eq.inbound&metadata->>source=eq.website&created_at=gt.${since(86400000)}`, dailyLimit)
    ]);
    const breached = limitBreached({ visitorLastMinute, visitorToday, ipLastHour, businessToday, dailyLimit });
    if (breached) return ok(429, { error: breached });

    const contact = await saveContact();
    const conversation = await serviceUpsert('automation_conversations', 'business_id,channel_type,external_thread_id', { business_id: businessId, contact_id: contact.id, channel_connection_id: connection.id, channel_type: 'website', external_thread_id: visitor, status: 'open', last_message_preview: text.slice(0, 1000), last_message_at: now });
    const inbound = await serviceInsert('automation_messages', { business_id: businessId, conversation_id: conversation.id, idempotency_key: `website:in:${visitor}:${clientId}`, direction: 'inbound', sender_type: 'customer', content_type: 'text', content: text, status: 'received', billable: false, provider: 'website', metadata: { source: 'website', ...(hash ? { ip_hash: hash } : {}), ...(page ? { page } : {}) }, occurred_at: now }, { ignoreDuplicates: true });
    if (!inbound) return ok(200, { ok: true, duplicate: true });

    await queueReply(event, { businessId, conversationId: conversation.id, contactId: contact.id, messageId: inbound.id });
    return ok(200, { ok: true, message: visibleMessage(inbound) });
  } catch (error) {
    console.error('automation-website-chat error', { message: error?.message, status: error?.status });
    return reply(500, { error: 'chat_unavailable' }, true);
  }
}

async function queueReply(event, { businessId, conversationId, contactId, messageId }) {
  const externalEventId = `website:${messageId}`;
  const inserted = await serviceInsert('automation_webhook_events', { provider: 'website', business_id: businessId, external_event_id: externalEventId, event_type: 'website_message', payload: { business_id: businessId, conversation_id: conversationId, contact_id: contactId, message_id: messageId }, status: 'received' }, { ignoreDuplicates: true });
  if (!inserted) return;
  const secret = String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET || '');
  const requestOrigin = (() => { try { return new URL(event.rawUrl || '').origin; } catch (_) { return ''; } })();
  const site = String(process.env.URL || process.env.DEPLOY_PRIME_URL || requestOrigin).replace(/\/$/, '');
  if (!secret || !site) throw new Error('automation_background_not_configured');
  const response = await fetch(`${site}/.netlify/functions/automation-website-process-background`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hansora-internal-secret': secret }, body: JSON.stringify({ event_id: inserted.id }) });
  if (!response.ok && response.status !== 202) throw new Error('automation_background_dispatch_failed');
}
